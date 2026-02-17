-- ============================================================================
-- Migration: AuraFace v1 descriptor 512-dim support
-- Date: 2026-02-17
-- Description: Add 512-dimensional face descriptor columns for AuraFace v1
--              migration from face-api.js (128-dim) to AuraFace (512-dim).
--              Backward compatible: both dimensions coexist during transition.
-- ============================================================================

-- =========================
-- 1. preset_participant_face_photos
-- =========================

-- Add new 512-dim descriptor column (coexists with existing face_descriptor)
ALTER TABLE preset_participant_face_photos
  ADD COLUMN IF NOT EXISTS face_descriptor_512 float8[] DEFAULT NULL;

-- Add column to track which model generated the descriptor
ALTER TABLE preset_participant_face_photos
  ADD COLUMN IF NOT EXISTS descriptor_model text DEFAULT NULL;

-- Index for performance on 512-dim lookups
CREATE INDEX IF NOT EXISTS idx_preset_face_photos_descriptor_512
  ON preset_participant_face_photos USING gin(face_descriptor_512)
  WHERE face_descriptor_512 IS NOT NULL;

-- Deprecation comment on old column
COMMENT ON COLUMN preset_participant_face_photos.face_descriptor
  IS 'DEPRECATED v1.2.0: Legacy 128-dim face-api.js descriptor. Use face_descriptor_512 (AuraFace v1) for new data.';

COMMENT ON COLUMN preset_participant_face_photos.face_descriptor_512
  IS 'AuraFace v1 512-dim face embedding. L2-normalized, use cosine similarity for matching.';

COMMENT ON COLUMN preset_participant_face_photos.descriptor_model
  IS 'Model that generated the descriptor: "face-api-js" (128d) or "auraface-v1" (512d)';

-- =========================
-- 2. sport_category_faces
-- =========================

-- Add new 512-dim descriptor column
ALTER TABLE sport_category_faces
  ADD COLUMN IF NOT EXISTS face_descriptor_512 float8[] DEFAULT NULL;

-- Add descriptor model tracking
ALTER TABLE sport_category_faces
  ADD COLUMN IF NOT EXISTS descriptor_model text DEFAULT NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_sport_category_faces_descriptor_512
  ON sport_category_faces USING gin(face_descriptor_512)
  WHERE face_descriptor_512 IS NOT NULL;

-- Comments
COMMENT ON COLUMN sport_category_faces.face_descriptor
  IS 'DEPRECATED v1.2.0: Legacy 128-dim face-api.js descriptor. Use face_descriptor_512 (AuraFace v1) for new data.';

COMMENT ON COLUMN sport_category_faces.face_descriptor_512
  IS 'AuraFace v1 512-dim face embedding. L2-normalized, use cosine similarity for matching.';

-- =========================
-- 3. sport_category_face_photos
-- =========================

-- Add new 512-dim descriptor column
ALTER TABLE sport_category_face_photos
  ADD COLUMN IF NOT EXISTS face_descriptor_512 float8[] DEFAULT NULL;

-- Add descriptor model tracking
ALTER TABLE sport_category_face_photos
  ADD COLUMN IF NOT EXISTS descriptor_model text DEFAULT NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_sport_category_face_photos_descriptor_512
  ON sport_category_face_photos USING gin(face_descriptor_512)
  WHERE face_descriptor_512 IS NOT NULL;

-- Comments
COMMENT ON COLUMN sport_category_face_photos.face_descriptor
  IS 'DEPRECATED v1.2.0: Legacy 128-dim face-api.js descriptor. Use face_descriptor_512 (AuraFace v1) for new data.';

COMMENT ON COLUMN sport_category_face_photos.face_descriptor_512
  IS 'AuraFace v1 512-dim face embedding. L2-normalized, use cosine similarity for matching.';

-- =========================
-- 4. Verification
-- =========================

-- Verify columns exist
DO $$
BEGIN
  -- Check preset_participant_face_photos
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'preset_participant_face_photos'
    AND column_name = 'face_descriptor_512'
  ) THEN
    RAISE EXCEPTION 'Migration failed: face_descriptor_512 not added to preset_participant_face_photos';
  END IF;

  -- Check sport_category_faces
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sport_category_faces'
    AND column_name = 'face_descriptor_512'
  ) THEN
    RAISE EXCEPTION 'Migration failed: face_descriptor_512 not added to sport_category_faces';
  END IF;

  -- Check sport_category_face_photos
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sport_category_face_photos'
    AND column_name = 'face_descriptor_512'
  ) THEN
    RAISE EXCEPTION 'Migration failed: face_descriptor_512 not added to sport_category_face_photos';
  END IF;

  RAISE NOTICE 'Migration 20260217180000_auraface_descriptor_512: SUCCESS - All 512-dim columns added';
END
$$;
