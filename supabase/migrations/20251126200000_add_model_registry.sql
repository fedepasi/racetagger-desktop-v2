-- Migration: Add Model Registry for ONNX Models
-- Date: 2025-11-26
-- Description: Creates model_registry table and storage bucket for local ONNX inference
--              Eliminates dependency on Roboflow API calls (~$0.0045/image)

-- ============================================================================
-- PHASE 1: Create model_registry table
-- ============================================================================

CREATE TABLE IF NOT EXISTS model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to sport_categories
  sport_category_id UUID REFERENCES sport_categories(id) ON DELETE CASCADE,

  -- Version control
  version TEXT NOT NULL,                    -- "4.0", "4.1", etc.

  -- Storage reference
  onnx_storage_path TEXT NOT NULL,          -- "onnx-models/f1-2025-v4.0.onnx"
  size_bytes BIGINT NOT NULL,               -- File size for progress bar
  checksum_sha256 TEXT NOT NULL,            -- Integrity validation

  -- Model configuration
  input_size INTEGER[] DEFAULT '{640,640}', -- [width, height]
  confidence_threshold DECIMAL(3,2) DEFAULT 0.70,
  iou_threshold DECIMAL(3,2) DEFAULT 0.50,

  -- Classes for this model (extracted from training)
  classes TEXT[] DEFAULT '{}',              -- ["SF-25_1", "SF-25_4", "MCL39_1", ...]

  -- App compatibility
  min_app_version TEXT,                     -- Minimum desktop app version required

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  release_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),

  -- Constraints
  UNIQUE(sport_category_id, version)
);

-- Index for fast lookups by category
CREATE INDEX IF NOT EXISTS idx_model_registry_category
  ON model_registry(sport_category_id, is_active);

-- Index for searching by classes (GIN for array)
CREATE INDEX IF NOT EXISTS idx_model_registry_classes
  ON model_registry USING GIN(classes);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_model_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_registry_updated_at
  BEFORE UPDATE ON model_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_model_registry_updated_at();

-- ============================================================================
-- PHASE 2: Add columns to sport_categories for ONNX support
-- ============================================================================

-- Reference to active ONNX model
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS active_model_id UUID REFERENCES model_registry(id);

-- Flag to enable local ONNX inference instead of API
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS use_local_onnx BOOLEAN DEFAULT false;

-- Update recognition_method constraint to include 'local-onnx'
ALTER TABLE sport_categories
DROP CONSTRAINT IF EXISTS sport_categories_recognition_method_check;

ALTER TABLE sport_categories
ADD CONSTRAINT sport_categories_recognition_method_check
CHECK (recognition_method IN ('gemini', 'rf-detr', 'local-onnx'));

-- Comments
COMMENT ON COLUMN sport_categories.active_model_id IS
'Reference to the active ONNX model in model_registry for local inference';

COMMENT ON COLUMN sport_categories.use_local_onnx IS
'When true, desktop app uses local ONNX inference instead of API calls';

-- ============================================================================
-- PHASE 3: Row Level Security (RLS)
-- ============================================================================

ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read models (needed for download)
CREATE POLICY "Authenticated users can read model registry"
  ON model_registry
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can insert/update/delete models
-- Note: Admin check based on user_roles table if exists, otherwise allow all authenticated
CREATE POLICY "Admins can manage model registry"
  ON model_registry
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT user_id FROM user_roles WHERE role = 'admin'
    )
    OR
    NOT EXISTS (SELECT 1 FROM user_roles LIMIT 1) -- Allow if no roles table populated
  );

-- ============================================================================
-- PHASE 4: Create Storage Bucket for ONNX models
-- ============================================================================

-- Note: Bucket creation via SQL may not work in all Supabase setups
-- Alternative: Create bucket via Supabase Dashboard or CLI
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('onnx-models', 'onnx-models', true, 524288000) -- 500MB limit
-- ON CONFLICT (id) DO NOTHING;

-- Storage policies (if bucket exists)
-- These allow authenticated users to download models
-- CREATE POLICY "Public read access for ONNX models"
--   ON storage.objects
--   FOR SELECT
--   USING (bucket_id = 'onnx-models');

-- CREATE POLICY "Admins can upload ONNX models"
--   ON storage.objects
--   FOR INSERT
--   WITH CHECK (
--     bucket_id = 'onnx-models'
--     AND auth.uid() IN (SELECT user_id FROM user_roles WHERE role = 'admin')
--   );

-- ============================================================================
-- PHASE 5: Helper function to get active model for category
-- ============================================================================

CREATE OR REPLACE FUNCTION get_active_model_for_category(category_code TEXT)
RETURNS TABLE (
  model_id UUID,
  onnx_storage_path TEXT,
  version TEXT,
  size_bytes BIGINT,
  checksum_sha256 TEXT,
  input_size INTEGER[],
  confidence_threshold DECIMAL,
  iou_threshold DECIMAL,
  classes TEXT[],
  min_app_version TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mr.id AS model_id,
    mr.onnx_storage_path,
    mr.version,
    mr.size_bytes,
    mr.checksum_sha256,
    mr.input_size,
    mr.confidence_threshold,
    mr.iou_threshold,
    mr.classes,
    mr.min_app_version
  FROM model_registry mr
  JOIN sport_categories sc ON sc.active_model_id = mr.id
  WHERE sc.code = category_code
    AND mr.is_active = true
    AND sc.use_local_onnx = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_active_model_for_category(TEXT) TO authenticated;

-- ============================================================================
-- PHASE 6: Tracking columns for execution_settings
-- ============================================================================

-- Add columns to track local ONNX usage in executions
ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS local_onnx_model_version TEXT;

ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS local_onnx_inference_count INTEGER DEFAULT 0;

ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS local_onnx_avg_inference_ms DECIMAL(10,2);

COMMENT ON COLUMN execution_settings.local_onnx_model_version IS
'Version of the ONNX model used for local inference';

COMMENT ON COLUMN execution_settings.local_onnx_inference_count IS
'Number of images processed with local ONNX inference';

COMMENT ON COLUMN execution_settings.local_onnx_avg_inference_ms IS
'Average inference time in milliseconds per image';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE model_registry IS
'Registry of ONNX models for local inference, enabling cost-free race number detection';

COMMENT ON COLUMN model_registry.sport_category_id IS
'Link to sport_categories - each category can have multiple model versions';

COMMENT ON COLUMN model_registry.version IS
'Semantic version of the model (e.g., 4.0, 4.1)';

COMMENT ON COLUMN model_registry.onnx_storage_path IS
'Path in Supabase Storage bucket onnx-models (e.g., f1-2025-v4.0.onnx)';

COMMENT ON COLUMN model_registry.size_bytes IS
'File size for download progress tracking';

COMMENT ON COLUMN model_registry.checksum_sha256 IS
'SHA256 hash for integrity verification after download';

COMMENT ON COLUMN model_registry.input_size IS
'Expected input dimensions [width, height], typically {640,640}';

COMMENT ON COLUMN model_registry.classes IS
'Array of class labels the model can detect (e.g., SF-25_1, MCL39_4)';

COMMENT ON COLUMN model_registry.min_app_version IS
'Minimum desktop app version required to run this model';
