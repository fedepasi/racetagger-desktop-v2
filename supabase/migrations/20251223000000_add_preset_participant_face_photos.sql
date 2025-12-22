-- Migration: Add Face Photos Support for Participant Presets
-- Date: 2025-12-23
-- Description: Enables multiple face photos (up to 5) per participant for face recognition

-- =====================================================
-- 1. Create preset_participant_face_photos table
-- =====================================================
CREATE TABLE IF NOT EXISTS preset_participant_face_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID NOT NULL REFERENCES preset_participants(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  face_descriptor FLOAT8[128],  -- 128-dim vector from face-api.js
  photo_type TEXT DEFAULT 'reference',  -- 'reference', 'action', 'podium', 'helmet_off'
  detection_confidence NUMERIC(5,3),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments
COMMENT ON TABLE preset_participant_face_photos IS 'Multiple face photos per participant in presets for improved face recognition. Max 5 photos per participant.';
COMMENT ON COLUMN preset_participant_face_photos.photo_type IS 'Type of photo: reference (official), action (racing), podium (ceremony), helmet_off (informal)';
COMMENT ON COLUMN preset_participant_face_photos.is_primary IS 'Primary photo used for display in UI';
COMMENT ON COLUMN preset_participant_face_photos.face_descriptor IS '128-dimensional face embedding from face-api.js';

-- =====================================================
-- 2. Indexes for performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_preset_face_photos_participant_id
ON preset_participant_face_photos(participant_id);

CREATE INDEX IF NOT EXISTS idx_preset_face_photos_primary
ON preset_participant_face_photos(participant_id) WHERE is_primary = true;

-- =====================================================
-- 3. Add face_photo_count to preset_participants
-- =====================================================
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS face_photo_count INTEGER DEFAULT 0;

COMMENT ON COLUMN preset_participants.face_photo_count IS 'Cached count of face photos in preset_participant_face_photos table';

-- =====================================================
-- 4. Function to update face_photo_count automatically
-- =====================================================
CREATE OR REPLACE FUNCTION update_preset_face_photo_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE preset_participants
    SET face_photo_count = face_photo_count + 1
    WHERE id = NEW.participant_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE preset_participants
    SET face_photo_count = face_photo_count - 1
    WHERE id = OLD.participant_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update face_photo_count
DROP TRIGGER IF EXISTS update_preset_face_photo_count_trigger ON preset_participant_face_photos;
CREATE TRIGGER update_preset_face_photo_count_trigger
  AFTER INSERT OR DELETE ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION update_preset_face_photo_count();

-- =====================================================
-- 5. Function to enforce max 5 photos per participant
-- =====================================================
CREATE OR REPLACE FUNCTION enforce_max_preset_face_photos()
RETURNS TRIGGER AS $$
DECLARE
  photo_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO photo_count
  FROM preset_participant_face_photos
  WHERE participant_id = NEW.participant_id;

  IF photo_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 face photos per participant allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce max photos
DROP TRIGGER IF EXISTS enforce_max_preset_face_photos_trigger ON preset_participant_face_photos;
CREATE TRIGGER enforce_max_preset_face_photos_trigger
  BEFORE INSERT ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_preset_face_photos();

-- =====================================================
-- 6. Function to ensure only one primary photo per participant
-- =====================================================
CREATE OR REPLACE FUNCTION ensure_single_preset_primary_photo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    -- Set all other photos for this participant to non-primary
    UPDATE preset_participant_face_photos
    SET is_primary = false
    WHERE participant_id = NEW.participant_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to ensure single primary
DROP TRIGGER IF EXISTS ensure_single_preset_primary_trigger ON preset_participant_face_photos;
CREATE TRIGGER ensure_single_preset_primary_trigger
  BEFORE INSERT OR UPDATE ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_preset_primary_photo();

-- =====================================================
-- 7. Row Level Security (RLS)
-- =====================================================
ALTER TABLE preset_participant_face_photos ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read face photos for their own presets, public presets, or official presets
CREATE POLICY "Users can read own preset face photos"
ON preset_participant_face_photos
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND (p.user_id = auth.uid() OR p.is_public = true OR p.is_official = true)
  )
);

-- Policy: Users can insert face photos only for their own non-official presets
CREATE POLICY "Users can insert face photos for own presets"
ON preset_participant_face_photos
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- Policy: Users can update face photos only for their own non-official presets
CREATE POLICY "Users can update face photos for own presets"
ON preset_participant_face_photos
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- Policy: Users can delete face photos only for their own non-official presets
CREATE POLICY "Users can delete face photos for own presets"
ON preset_participant_face_photos
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- =====================================================
-- 8. Grant permissions
-- =====================================================
GRANT SELECT ON preset_participant_face_photos TO authenticated;
GRANT ALL ON preset_participant_face_photos TO service_role;
