-- Migration: Add Face Recognition Support
-- Date: 2025-11-25
-- Description: Adds tables and columns for face recognition feature
--              Supports F1 2025 initially, extensible to all sport categories

-- =====================================================
-- 1. Create sport_category_faces table (global face DB)
-- =====================================================
CREATE TABLE IF NOT EXISTS sport_category_faces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sport_category_id UUID NOT NULL REFERENCES sport_categories(id) ON DELETE CASCADE,
  driver_name TEXT NOT NULL,
  team TEXT,
  car_number TEXT,
  face_descriptor FLOAT8[128],  -- NULL allowed, descriptor can be added later
  reference_photo_url TEXT,
  season TEXT DEFAULT '2025',
  nationality TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique driver per category per season
  CONSTRAINT unique_driver_category_season UNIQUE (sport_category_id, driver_name, season)
);

-- Index for fast queries by category
CREATE INDEX IF NOT EXISTS idx_sport_category_faces_category
ON sport_category_faces(sport_category_id) WHERE is_active = true;

-- Index for searching by name
CREATE INDEX IF NOT EXISTS idx_sport_category_faces_name
ON sport_category_faces(driver_name);

-- Comment
COMMENT ON TABLE sport_category_faces IS 'Global face database for all sport categories. Stores 128-dimensional face descriptors for driver identification.';

-- =====================================================
-- 2. Add face recognition config to sport_categories
-- =====================================================
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS face_recognition_enabled BOOLEAN DEFAULT false;

ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS face_recognition_config JSONB DEFAULT '{
  "minConfidence": 0.6,
  "maxFaces": 3,
  "contextModes": ["portrait", "podium"]
}'::jsonb;

-- Comment
COMMENT ON COLUMN sport_categories.face_recognition_enabled IS 'Whether face recognition is enabled for this category';
COMMENT ON COLUMN sport_categories.face_recognition_config IS 'Face recognition configuration: minConfidence, maxFaces, contextModes';

-- =====================================================
-- 3. Add face descriptors to preset_participants
-- =====================================================
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS face_descriptor FLOAT8[128];

ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS reference_photo_url TEXT;

-- Comment
COMMENT ON COLUMN preset_participants.face_descriptor IS 'Optional face descriptor for preset participant';
COMMENT ON COLUMN preset_participants.reference_photo_url IS 'Reference photo URL for face recognition';

-- =====================================================
-- 4. Add face detection tracking to analysis_results
-- =====================================================
ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS face_detections JSONB;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS face_match_source TEXT;

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS face_confidence NUMERIC(5,3);

-- Add check constraint for face_match_source
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analysis_results_face_match_source_check'
  ) THEN
    ALTER TABLE analysis_results
    ADD CONSTRAINT analysis_results_face_match_source_check
    CHECK (face_match_source IN ('global', 'preset', 'none') OR face_match_source IS NULL);
  END IF;
END $$;

-- Comment
COMMENT ON COLUMN analysis_results.face_detections IS 'JSON array of detected faces with bounding boxes and confidence';
COMMENT ON COLUMN analysis_results.face_match_source IS 'Source of face match: global (sport_category_faces), preset, or none';
COMMENT ON COLUMN analysis_results.face_confidence IS 'Confidence score of the best face match (0-1)';

-- =====================================================
-- 5. Enable face recognition for F1
-- =====================================================
UPDATE sport_categories
SET face_recognition_enabled = true,
    face_recognition_config = '{
      "minConfidence": 0.6,
      "maxFaces": 3,
      "contextModes": ["portrait", "podium"],
      "matchThreshold": 0.6
    }'::jsonb
WHERE code = 'f1';

-- =====================================================
-- 6. Row Level Security (RLS) for sport_category_faces
-- =====================================================

-- Enable RLS
ALTER TABLE sport_category_faces ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read active faces (needed for desktop app)
CREATE POLICY "Anyone can read active faces"
ON sport_category_faces
FOR SELECT
USING (is_active = true);

-- Policy: Authenticated users can insert faces (admin check done in app)
CREATE POLICY "Authenticated can insert faces"
ON sport_category_faces
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Policy: Authenticated users can update faces (admin check done in app)
CREATE POLICY "Authenticated can update faces"
ON sport_category_faces
FOR UPDATE
USING (auth.uid() IS NOT NULL);

-- Policy: Authenticated users can delete faces (admin check done in app)
CREATE POLICY "Authenticated can delete faces"
ON sport_category_faces
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- =====================================================
-- 7. Create Supabase Storage bucket for driver photos
-- =====================================================
-- Note: This needs to be done via Supabase Dashboard or API
-- Bucket name: driver-photos
-- Public access: true (for reference photos)

-- =====================================================
-- 8. Helper function to update timestamps
-- =====================================================
CREATE OR REPLACE FUNCTION update_sport_category_faces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS sport_category_faces_updated_at ON sport_category_faces;
CREATE TRIGGER sport_category_faces_updated_at
  BEFORE UPDATE ON sport_category_faces
  FOR EACH ROW
  EXECUTE FUNCTION update_sport_category_faces_updated_at();

-- =====================================================
-- 9. Grant permissions
-- =====================================================
GRANT SELECT ON sport_category_faces TO anon;
GRANT SELECT ON sport_category_faces TO authenticated;
GRANT ALL ON sport_category_faces TO service_role;
