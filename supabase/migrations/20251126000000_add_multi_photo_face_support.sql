-- Migration: Add Multi-Photo Support for Face Recognition
-- Date: 2025-11-26
-- Description: Enables multiple photos per driver for improved face recognition accuracy

-- =====================================================
-- 1. Create sport_category_face_photos table
-- =====================================================
CREATE TABLE IF NOT EXISTS sport_category_face_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  face_id UUID NOT NULL REFERENCES sport_category_faces(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  face_descriptor FLOAT8[128],  -- NULL until processed by desktop app
  photo_type TEXT DEFAULT 'reference',  -- 'reference', 'action', 'podium', 'helmet_off'
  detection_confidence NUMERIC(5,3),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comment
COMMENT ON TABLE sport_category_face_photos IS 'Multiple photos per driver for improved face recognition. Each photo has its own face descriptor.';
COMMENT ON COLUMN sport_category_face_photos.photo_type IS 'Type of photo: reference (official), action (racing), podium (ceremony), helmet_off (informal)';
COMMENT ON COLUMN sport_category_face_photos.is_primary IS 'Primary photo used for display in UI';

-- =====================================================
-- 2. Indexes for performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_face_photos_face_id
ON sport_category_face_photos(face_id);

CREATE INDEX IF NOT EXISTS idx_face_photos_primary
ON sport_category_face_photos(face_id) WHERE is_primary = true;

-- =====================================================
-- 3. Add photo_count to sport_category_faces
-- =====================================================
ALTER TABLE sport_category_faces
ADD COLUMN IF NOT EXISTS photo_count INTEGER DEFAULT 0;

COMMENT ON COLUMN sport_category_faces.photo_count IS 'Cached count of photos in sport_category_face_photos table';

-- =====================================================
-- 4. Function to update photo_count automatically
-- =====================================================
CREATE OR REPLACE FUNCTION update_face_photo_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE sport_category_faces
    SET photo_count = photo_count + 1
    WHERE id = NEW.face_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE sport_category_faces
    SET photo_count = photo_count - 1
    WHERE id = OLD.face_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update photo_count
DROP TRIGGER IF EXISTS update_face_photo_count_trigger ON sport_category_face_photos;
CREATE TRIGGER update_face_photo_count_trigger
  AFTER INSERT OR DELETE ON sport_category_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION update_face_photo_count();

-- =====================================================
-- 5. Function to ensure only one primary photo per driver
-- =====================================================
CREATE OR REPLACE FUNCTION ensure_single_primary_photo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    -- Set all other photos for this driver to non-primary
    UPDATE sport_category_face_photos
    SET is_primary = false
    WHERE face_id = NEW.face_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to ensure single primary
DROP TRIGGER IF EXISTS ensure_single_primary_trigger ON sport_category_face_photos;
CREATE TRIGGER ensure_single_primary_trigger
  BEFORE INSERT OR UPDATE ON sport_category_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_primary_photo();

-- =====================================================
-- 6. Row Level Security (RLS)
-- =====================================================
ALTER TABLE sport_category_face_photos ENABLE ROW LEVEL SECURITY;

-- Anyone can read face photos
CREATE POLICY "Anyone can read face photos"
ON sport_category_face_photos
FOR SELECT
USING (true);

-- Authenticated users can insert photos
CREATE POLICY "Authenticated can insert face photos"
ON sport_category_face_photos
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Authenticated users can update photos
CREATE POLICY "Authenticated can update face photos"
ON sport_category_face_photos
FOR UPDATE
USING (auth.uid() IS NOT NULL);

-- Authenticated users can delete photos
CREATE POLICY "Authenticated can delete face photos"
ON sport_category_face_photos
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- =====================================================
-- 7. Grant permissions
-- =====================================================
GRANT SELECT ON sport_category_face_photos TO anon;
GRANT SELECT ON sport_category_face_photos TO authenticated;
GRANT ALL ON sport_category_face_photos TO service_role;

-- =====================================================
-- 8. Migrate existing single photos to new table
-- =====================================================
-- This migrates any existing photos from sport_category_faces
-- to the new sport_category_face_photos table
INSERT INTO sport_category_face_photos (face_id, photo_url, face_descriptor, photo_type, is_primary, detection_confidence)
SELECT
  id as face_id,
  reference_photo_url as photo_url,
  face_descriptor,
  'reference' as photo_type,
  true as is_primary,
  1.0 as detection_confidence
FROM sport_category_faces
WHERE face_descriptor IS NOT NULL
  AND reference_photo_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sport_category_face_photos WHERE face_id = sport_category_faces.id
  );

-- Update photo_count for migrated records
UPDATE sport_category_faces
SET photo_count = (
  SELECT COUNT(*) FROM sport_category_face_photos WHERE face_id = sport_category_faces.id
)
WHERE photo_count = 0;
