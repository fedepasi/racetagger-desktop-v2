-- ============================================================
-- Error Telemetry System
-- Automatic error reporting with deduplication and GitHub issue tracking
-- ============================================================

-- 1. Error Reports (deduplicated by fingerprint - one row per unique error globally)
CREATE TABLE IF NOT EXISTS error_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE,
  error_type TEXT NOT NULL,           -- raw_conversion, edge_function, onnx_model, token_reservation, segmentation, zero_results, memory, uncaught
  severity TEXT NOT NULL DEFAULT 'recoverable',  -- fatal, recoverable, warning
  error_message TEXT,                 -- First 500 chars, sanitized
  error_stack TEXT,                   -- First 1000 chars, sanitized
  first_app_version TEXT,
  latest_app_version TEXT,
  total_occurrences INTEGER NOT NULL DEFAULT 1,
  affected_user_count INTEGER NOT NULL DEFAULT 1,
  affected_user_ids UUID[] NOT NULL DEFAULT '{}',
  github_issue_number INTEGER,
  github_issue_url TEXT,
  is_widespread BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE error_reports IS 'Deduplicated error reports - one row per unique error fingerprint across all users';
COMMENT ON COLUMN error_reports.fingerprint IS 'SHA-256 hash of error_type + normalized_message + batch_phase + os for deduplication';
COMMENT ON COLUMN error_reports.is_widespread IS 'Automatically set to TRUE when affected_user_count >= 5';

-- 2. Error Occurrences (individual tracking - one row per occurrence per user)
CREATE TABLE IF NOT EXISTS error_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_report_id UUID NOT NULL REFERENCES error_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  execution_id UUID,
  app_version TEXT,
  batch_phase TEXT,
  image_index INTEGER,
  total_images INTEGER,
  os TEXT,
  os_version TEXT,
  arch TEXT,
  cpu_model TEXT,
  ram_available_gb NUMERIC,
  log_snapshot TEXT,                  -- 50-100 contextual lines, sanitized
  log_storage_path TEXT,             -- Path in Supabase Storage for full log
  execution_context JSONB,           -- Category, preset, config details
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE error_occurrences IS 'Individual error occurrences with full context per user per event';

-- 3. Error Issue Mappings (fingerprint -> GitHub issue)
CREATE TABLE IF NOT EXISTS error_issue_mappings (
  fingerprint TEXT PRIMARY KEY REFERENCES error_reports(fingerprint) ON DELETE CASCADE,
  github_issue_number INTEGER NOT NULL,
  github_issue_url TEXT,
  issue_state TEXT NOT NULL DEFAULT 'open',
  last_commented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE error_issue_mappings IS 'Maps error fingerprints to GitHub issue numbers for deduplication';

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_error_reports_error_type ON error_reports(error_type);
CREATE INDEX IF NOT EXISTS idx_error_reports_last_seen ON error_reports(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_reports_severity ON error_reports(severity);
CREATE INDEX IF NOT EXISTS idx_error_reports_widespread ON error_reports(is_widespread) WHERE is_widespread = TRUE;

CREATE INDEX IF NOT EXISTS idx_error_occurrences_report ON error_occurrences(error_report_id);
CREATE INDEX IF NOT EXISTS idx_error_occurrences_user ON error_occurrences(user_id);
CREATE INDEX IF NOT EXISTS idx_error_occurrences_created ON error_occurrences(created_at DESC);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_issue_mappings ENABLE ROW LEVEL SECURITY;

-- error_reports: anyone authenticated can INSERT (via RPC), admin can SELECT all
CREATE POLICY error_reports_insert_authenticated ON error_reports
  FOR INSERT TO authenticated
  WITH CHECK (TRUE);

CREATE POLICY error_reports_select_admin ON error_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  );

CREATE POLICY error_reports_update_service ON error_reports
  FOR UPDATE TO service_role
  USING (TRUE);

-- error_occurrences: users see their own, admin sees all, authenticated can INSERT
CREATE POLICY error_occurrences_insert_authenticated ON error_occurrences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY error_occurrences_select_own ON error_occurrences
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  );

-- error_issue_mappings: service_role for INSERT/UPDATE, admin for SELECT
CREATE POLICY error_issue_mappings_select_admin ON error_issue_mappings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  );

CREATE POLICY error_issue_mappings_all_service ON error_issue_mappings
  FOR ALL TO service_role
  USING (TRUE);

-- ============================================================
-- RPC: upsert_error_report
-- Atomic operation: deduplicates by fingerprint, tracks occurrences
-- Called by the desktop app via Edge Function
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_error_report(
  p_fingerprint TEXT,
  p_error_type TEXT,
  p_severity TEXT,
  p_error_message TEXT,
  p_error_stack TEXT,
  p_user_id UUID,
  p_execution_id UUID DEFAULT NULL,
  p_batch_phase TEXT DEFAULT NULL,
  p_image_index INTEGER DEFAULT NULL,
  p_total_images INTEGER DEFAULT NULL,
  p_app_version TEXT DEFAULT NULL,
  p_os TEXT DEFAULT NULL,
  p_os_version TEXT DEFAULT NULL,
  p_arch TEXT DEFAULT NULL,
  p_cpu_model TEXT DEFAULT NULL,
  p_ram_available_gb NUMERIC DEFAULT NULL,
  p_log_snapshot TEXT DEFAULT NULL,
  p_log_storage_path TEXT DEFAULT NULL,
  p_execution_context JSONB DEFAULT NULL
)
RETURNS TABLE(
  report_id UUID,
  is_new_fingerprint BOOLEAN,
  total_occurrences INTEGER,
  affected_user_count INTEGER,
  github_issue_number INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_total_occurrences INTEGER;
  v_affected_user_count INTEGER;
  v_github_issue_number INTEGER;
  v_existing RECORD;
BEGIN
  -- Try to find existing report by fingerprint
  SELECT er.id, er.total_occurrences, er.affected_user_count, er.affected_user_ids, er.github_issue_number
  INTO v_existing
  FROM error_reports er
  WHERE er.fingerprint = p_fingerprint;

  IF v_existing IS NULL THEN
    -- New fingerprint: create report
    INSERT INTO error_reports (
      fingerprint, error_type, severity, error_message, error_stack,
      first_app_version, latest_app_version,
      total_occurrences, affected_user_count, affected_user_ids,
      first_seen_at, last_seen_at
    ) VALUES (
      p_fingerprint, p_error_type, p_severity,
      LEFT(p_error_message, 500), LEFT(p_error_stack, 1000),
      p_app_version, p_app_version,
      1, 1, ARRAY[p_user_id],
      NOW(), NOW()
    )
    RETURNING id INTO v_report_id;

    v_is_new := TRUE;
    v_total_occurrences := 1;
    v_affected_user_count := 1;
    v_github_issue_number := NULL;
  ELSE
    -- Existing fingerprint: update counters
    v_report_id := v_existing.id;
    v_github_issue_number := v_existing.github_issue_number;

    -- Check if this user is new to this error
    IF p_user_id = ANY(v_existing.affected_user_ids) THEN
      -- Same user, just increment occurrences
      UPDATE error_reports SET
        total_occurrences = total_occurrences + 1,
        last_seen_at = NOW(),
        latest_app_version = COALESCE(p_app_version, latest_app_version)
      WHERE id = v_report_id;

      v_affected_user_count := v_existing.affected_user_count;
    ELSE
      -- New user affected
      UPDATE error_reports SET
        total_occurrences = total_occurrences + 1,
        affected_user_count = affected_user_count + 1,
        affected_user_ids = array_append(affected_user_ids, p_user_id),
        is_widespread = (affected_user_count + 1) >= 5,
        last_seen_at = NOW(),
        latest_app_version = COALESCE(p_app_version, latest_app_version)
      WHERE id = v_report_id;

      v_affected_user_count := v_existing.affected_user_count + 1;
    END IF;

    v_total_occurrences := v_existing.total_occurrences + 1;
  END IF;

  -- Always insert individual occurrence
  INSERT INTO error_occurrences (
    error_report_id, user_id, execution_id, app_version,
    batch_phase, image_index, total_images,
    os, os_version, arch, cpu_model, ram_available_gb,
    log_snapshot, log_storage_path, execution_context
  ) VALUES (
    v_report_id, p_user_id, p_execution_id, p_app_version,
    p_batch_phase, p_image_index, p_total_images,
    p_os, p_os_version, p_arch, p_cpu_model, p_ram_available_gb,
    p_log_snapshot, p_log_storage_path, p_execution_context
  );

  RETURN QUERY SELECT
    v_report_id,
    v_is_new,
    v_total_occurrences,
    v_affected_user_count,
    v_github_issue_number;
END;
$$;

-- Grant execute to service_role (Edge Function uses this)
GRANT EXECUTE ON FUNCTION upsert_error_report TO service_role;

-- ============================================================
-- RPC: update_error_report_issue
-- Called by Edge Function after creating/finding GitHub issue
-- ============================================================

CREATE OR REPLACE FUNCTION update_error_report_issue(
  p_fingerprint TEXT,
  p_github_issue_number INTEGER,
  p_github_issue_url TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update error_reports with issue info
  UPDATE error_reports SET
    github_issue_number = p_github_issue_number,
    github_issue_url = p_github_issue_url
  WHERE fingerprint = p_fingerprint;

  -- Upsert issue mapping
  INSERT INTO error_issue_mappings (
    fingerprint, github_issue_number, github_issue_url, last_commented_at
  ) VALUES (
    p_fingerprint, p_github_issue_number, p_github_issue_url, NOW()
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    last_commented_at = NOW(),
    issue_state = 'open';
END;
$$;

GRANT EXECUTE ON FUNCTION update_error_report_issue TO service_role;
