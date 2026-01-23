-- Migration: Add Per-Driver Face Recognition Support
-- Date: 2026-01-22
-- Description: Allows each driver in a participant entry to have individual face photos and metatags
--              Solves WEC scenario: Car #51 with 3 drivers, each needs own photos and metatag

-- =====================================================
-- 1. Create preset_participant_drivers table
-- =====================================================
CREATE TABLE IF NOT EXISTS preset_participant_drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID NOT NULL REFERENCES preset_participants(id) ON DELETE CASCADE,
  driver_name TEXT NOT NULL,
  driver_metatag TEXT,  -- Specific metatag for this driver (written to IPTC when face is recognized)
  driver_order INTEGER NOT NULL DEFAULT 0,  -- Display order (0-based)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments
COMMENT ON TABLE preset_participant_drivers IS 'Individual drivers within a participant entry. Enables per-driver face photos and metatags for multi-driver vehicles (e.g., WEC endurance racing).';
COMMENT ON COLUMN preset_participant_drivers.driver_name IS 'Name of the driver (e.g., "A. Pier Guidi"). Synced from participant.nome field.';
COMMENT ON COLUMN preset_participant_drivers.driver_metatag IS 'Metatag specific to this driver. Written to IPTC keywords only when this driver face is recognized.';
COMMENT ON COLUMN preset_participant_drivers.driver_order IS 'Display order in UI (0 = first driver, 1 = second, etc.)';

-- =====================================================
-- 2. Indexes for performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_participant_drivers_participant_id
ON preset_participant_drivers(participant_id);

CREATE INDEX IF NOT EXISTS idx_participant_drivers_order
ON preset_participant_drivers(participant_id, driver_order);

-- =====================================================
-- 3. Modify preset_participant_face_photos to support driver_id
-- =====================================================

-- Add driver_id column (nullable for backward compatibility)
ALTER TABLE preset_participant_face_photos
ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES preset_participant_drivers(id) ON DELETE CASCADE;

-- Make participant_id nullable (either participant_id OR driver_id must be set)
ALTER TABLE preset_participant_face_photos
ALTER COLUMN participant_id DROP NOT NULL;

-- Add constraint: must have EITHER participant_id OR driver_id (not both, not neither)
ALTER TABLE preset_participant_face_photos
ADD CONSTRAINT preset_face_photos_participant_or_driver_check
CHECK (
  (participant_id IS NOT NULL AND driver_id IS NULL) OR
  (participant_id IS NULL AND driver_id IS NOT NULL)
);

COMMENT ON COLUMN preset_participant_face_photos.driver_id IS 'FK to specific driver. Use this for per-driver face photos. Mutually exclusive with participant_id.';

-- Create index for driver_id lookups
CREATE INDEX IF NOT EXISTS idx_preset_face_photos_driver_id
ON preset_participant_face_photos(driver_id);

-- =====================================================
-- 4. Update face_photo_count trigger for driver support
-- =====================================================

-- Drop old trigger and function
DROP TRIGGER IF EXISTS update_preset_face_photo_count_trigger ON preset_participant_face_photos;
DROP FUNCTION IF EXISTS update_preset_face_photo_count();

-- New function that handles both participant_id and driver_id
CREATE OR REPLACE FUNCTION update_preset_face_photo_count()
RETURNS TRIGGER AS $$
DECLARE
  target_participant_id UUID;
BEGIN
  -- Determine the participant_id (either direct or via driver)
  IF TG_OP = 'INSERT' THEN
    IF NEW.participant_id IS NOT NULL THEN
      target_participant_id := NEW.participant_id;
    ELSIF NEW.driver_id IS NOT NULL THEN
      SELECT participant_id INTO target_participant_id
      FROM preset_participant_drivers
      WHERE id = NEW.driver_id;
    END IF;

    IF target_participant_id IS NOT NULL THEN
      UPDATE preset_participants
      SET face_photo_count = face_photo_count + 1
      WHERE id = target_participant_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.participant_id IS NOT NULL THEN
      target_participant_id := OLD.participant_id;
    ELSIF OLD.driver_id IS NOT NULL THEN
      SELECT participant_id INTO target_participant_id
      FROM preset_participant_drivers
      WHERE id = OLD.driver_id;
    END IF;

    IF target_participant_id IS NOT NULL THEN
      UPDATE preset_participants
      SET face_photo_count = GREATEST(0, face_photo_count - 1)
      WHERE id = target_participant_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger
CREATE TRIGGER update_preset_face_photo_count_trigger
  AFTER INSERT OR DELETE ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION update_preset_face_photo_count();

-- =====================================================
-- 5. Update max photos trigger for driver support
-- =====================================================

-- Drop old trigger and function
DROP TRIGGER IF EXISTS enforce_max_preset_face_photos_trigger ON preset_participant_face_photos;
DROP FUNCTION IF EXISTS enforce_max_preset_face_photos();

-- New function: max 5 photos per driver (not per participant)
CREATE OR REPLACE FUNCTION enforce_max_preset_face_photos()
RETURNS TRIGGER AS $$
DECLARE
  photo_count INTEGER;
BEGIN
  -- Check limit based on participant_id or driver_id
  IF NEW.participant_id IS NOT NULL THEN
    SELECT COUNT(*) INTO photo_count
    FROM preset_participant_face_photos
    WHERE participant_id = NEW.participant_id;
  ELSIF NEW.driver_id IS NOT NULL THEN
    SELECT COUNT(*) INTO photo_count
    FROM preset_participant_face_photos
    WHERE driver_id = NEW.driver_id;
  END IF;

  IF photo_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 face photos per driver allowed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger
CREATE TRIGGER enforce_max_preset_face_photos_trigger
  BEFORE INSERT ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_preset_face_photos();

-- =====================================================
-- 6. Update primary photo trigger for driver support
-- =====================================================

-- Drop old trigger and function
DROP TRIGGER IF EXISTS ensure_single_preset_primary_trigger ON preset_participant_face_photos;
DROP FUNCTION IF EXISTS ensure_single_preset_primary_photo();

-- New function: only one primary per participant OR driver
CREATE OR REPLACE FUNCTION ensure_single_preset_primary_photo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    -- Set all other photos for this participant/driver to non-primary
    IF NEW.participant_id IS NOT NULL THEN
      UPDATE preset_participant_face_photos
      SET is_primary = false
      WHERE participant_id = NEW.participant_id AND id != NEW.id;
    ELSIF NEW.driver_id IS NOT NULL THEN
      UPDATE preset_participant_face_photos
      SET is_primary = false
      WHERE driver_id = NEW.driver_id AND id != NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger
CREATE TRIGGER ensure_single_preset_primary_trigger
  BEFORE INSERT OR UPDATE ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_preset_primary_photo();

-- =====================================================
-- 7. Row Level Security (RLS) for preset_participant_drivers
-- =====================================================
ALTER TABLE preset_participant_drivers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read drivers for their own presets, public presets, or official presets
CREATE POLICY "Users can read preset drivers"
ON preset_participant_drivers
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_drivers.participant_id
    AND (p.user_id = auth.uid() OR p.is_public = true OR p.is_official = true)
  )
);

-- Policy: Users can insert drivers only for their own non-official presets
CREATE POLICY "Users can insert drivers for own presets"
ON preset_participant_drivers
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_drivers.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- Policy: Users can update drivers only for their own non-official presets
CREATE POLICY "Users can update drivers for own presets"
ON preset_participant_drivers
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_drivers.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- Policy: Users can delete drivers only for their own non-official presets
CREATE POLICY "Users can delete drivers for own presets"
ON preset_participant_drivers
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_drivers.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- =====================================================
-- 8. Update RLS policies for preset_participant_face_photos
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read own preset face photos" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users can insert face photos for own presets" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users can update face photos for own presets" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users can delete face photos for own presets" ON preset_participant_face_photos;

-- Policy: Users can read face photos for their own presets, public presets, or official presets
CREATE POLICY "Users can read preset face photos"
ON preset_participant_face_photos
FOR SELECT
USING (
  -- Via participant_id
  (participant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND (p.user_id = auth.uid() OR p.is_public = true OR p.is_official = true)
  ))
  OR
  -- Via driver_id
  (driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participant_drivers pd
    JOIN preset_participants pp ON pd.participant_id = pp.id
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pd.id = preset_participant_face_photos.driver_id
    AND (p.user_id = auth.uid() OR p.is_public = true OR p.is_official = true)
  ))
);

-- Policy: Users can insert face photos only for their own non-official presets
CREATE POLICY "Users can insert preset face photos"
ON preset_participant_face_photos
FOR INSERT
WITH CHECK (
  -- Via participant_id
  (participant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  ))
  OR
  -- Via driver_id
  (driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participant_drivers pd
    JOIN preset_participants pp ON pd.participant_id = pp.id
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pd.id = preset_participant_face_photos.driver_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  ))
);

-- Policy: Users can update face photos only for their own non-official presets
CREATE POLICY "Users can update preset face photos"
ON preset_participant_face_photos
FOR UPDATE
USING (
  -- Via participant_id
  (participant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  ))
  OR
  -- Via driver_id
  (driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participant_drivers pd
    JOIN preset_participants pp ON pd.participant_id = pp.id
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pd.id = preset_participant_face_photos.driver_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  ))
);

-- Policy: Users can delete face photos only for their own non-official presets
CREATE POLICY "Users can delete preset face photos"
ON preset_participant_face_photos
FOR DELETE
USING (
  -- Via participant_id
  (participant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  ))
  OR
  -- Via driver_id
  (driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM preset_participant_drivers pd
    JOIN preset_participants pp ON pd.participant_id = pp.id
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pd.id = preset_participant_face_photos.driver_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  ))
);

-- =====================================================
-- 9. Grant permissions
-- =====================================================
GRANT SELECT ON preset_participant_drivers TO authenticated;
GRANT ALL ON preset_participant_drivers TO service_role;

-- =====================================================
-- MIGRATION NOTES
-- =====================================================
-- This migration is backward compatible:
-- - Existing face photos with participant_id will continue to work
-- - New face photos can use driver_id for per-driver recognition
-- - The constraint ensures data integrity (either participant OR driver, not both)
-- - RLS policies protect user data appropriately
