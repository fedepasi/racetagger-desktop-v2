-- Migration: Create app_launches table for tracking app opens
-- Date: 2025-12-23
-- Description: Tracks every app launch to understand user engagement funnel
-- Use case: Identify users who downloaded/installed but never ran an analysis

CREATE TABLE IF NOT EXISTS app_launches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User identification (nullable for anonymous launches before login)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Device identification
  machine_id TEXT NOT NULL, -- SHA256 hash of hardware characteristics
  hostname TEXT,
  platform TEXT, -- darwin, win32, linux
  username TEXT, -- OS username

  -- App info
  app_version TEXT NOT NULL,
  electron_version TEXT,
  node_version TEXT,

  -- Hardware info
  cpu TEXT,
  cores INTEGER,
  ram_gb INTEGER,
  architecture TEXT,

  -- Launch context
  is_first_launch BOOLEAN DEFAULT false, -- First launch ever on this machine
  is_first_launch_this_version BOOLEAN DEFAULT false, -- First launch of this version
  launch_count INTEGER DEFAULT 1, -- How many times this machine has launched

  -- Timestamps
  launched_at TIMESTAMPTZ DEFAULT NOW(),

  -- Session tracking
  session_id UUID, -- To correlate with executions in same session

  -- Index for quick lookups
  CONSTRAINT unique_machine_session UNIQUE (machine_id, session_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_app_launches_user_id ON app_launches(user_id);
CREATE INDEX IF NOT EXISTS idx_app_launches_machine_id ON app_launches(machine_id);
CREATE INDEX IF NOT EXISTS idx_app_launches_launched_at ON app_launches(launched_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_launches_app_version ON app_launches(app_version);

-- RLS Policies
ALTER TABLE app_launches ENABLE ROW LEVEL SECURITY;

-- Users can see their own launches
CREATE POLICY "Users can view own launches"
ON app_launches FOR SELECT
USING (user_id = auth.uid());

-- Service role can do everything (for anonymous launches before login)
-- Note: service_role bypasses RLS by default

-- Useful views for analytics
CREATE OR REPLACE VIEW app_launch_stats AS
SELECT
  user_id,
  machine_id,
  hostname,
  platform,
  app_version,
  MIN(launched_at) as first_launch,
  MAX(launched_at) as last_launch,
  COUNT(*) as total_launches
FROM app_launches
GROUP BY user_id, machine_id, hostname, platform, app_version;

-- View: Users who opened app but never ran analysis
CREATE OR REPLACE VIEW users_without_executions AS
SELECT DISTINCT
  al.user_id,
  al.machine_id,
  al.hostname,
  al.app_version,
  al.first_launch,
  al.total_launches
FROM app_launch_stats al
LEFT JOIN executions e ON al.user_id = e.user_id
WHERE e.id IS NULL AND al.user_id IS NOT NULL;

COMMENT ON TABLE app_launches IS 'Tracks every app launch to understand user engagement and identify drop-off points';
COMMENT ON VIEW users_without_executions IS 'Users who downloaded and opened the app but never ran an analysis';
