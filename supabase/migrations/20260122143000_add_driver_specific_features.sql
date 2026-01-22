-- Migration: Add Driver-Specific Face Photos and Metatags
-- Date: 2026-01-22
-- Description: Enables per-driver face photo organization (3 photos each) and custom metatags per driver

-- =====================================================
-- 1. Add driver_name to preset_participant_face_photos
-- =====================================================
ALTER TABLE preset_participant_face_photos
ADD COLUMN IF NOT EXISTS driver_name TEXT;

COMMENT ON COLUMN preset_participant_face_photos.driver_name IS 'Name of the specific driver this photo belongs to (for multi-driver vehicles like WEC)';

-- Index for driver-specific queries
CREATE INDEX IF NOT EXISTS idx_preset_face_photos_driver
ON preset_participant_face_photos(participant_id, driver_name);

-- =====================================================
-- 2. Add driver_specific_metatags to preset_participants
-- =====================================================
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS driver_specific_metatags JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN preset_participants.driver_specific_metatags IS 'Custom metatags for each driver (e.g., {"Molina": "Ferrari Hypercar Driver", "Fuoco": "Italian Racing Star"})';

-- =====================================================
-- 3. Update max photos constraint: 3 per driver instead of 5 total
-- =====================================================
-- Drop old trigger
DROP TRIGGER IF EXISTS enforce_max_preset_face_photos_trigger ON preset_participant_face_photos;
DROP FUNCTION IF EXISTS enforce_max_preset_face_photos();

-- New function: enforce 3 photos per driver
CREATE OR REPLACE FUNCTION enforce_max_preset_face_photos_per_driver()
RETURNS TRIGGER AS $$
DECLARE
  photo_count INTEGER;
BEGIN
  -- If driver_name is specified, count photos for that specific driver
  IF NEW.driver_name IS NOT NULL THEN
    SELECT COUNT(*) INTO photo_count
    FROM preset_participant_face_photos
    WHERE participant_id = NEW.participant_id
    AND driver_name = NEW.driver_name;

    IF photo_count >= 3 THEN
      RAISE EXCEPTION 'Maximum 3 face photos per driver allowed';
    END IF;
  ELSE
    -- For backward compatibility: if no driver_name, enforce global limit of 5
    SELECT COUNT(*) INTO photo_count
    FROM preset_participant_face_photos
    WHERE participant_id = NEW.participant_id
    AND driver_name IS NULL;

    IF photo_count >= 5 THEN
      RAISE EXCEPTION 'Maximum 5 face photos per participant allowed (use driver_name for multi-driver vehicles)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- New trigger to enforce per-driver limit
CREATE TRIGGER enforce_max_preset_face_photos_per_driver_trigger
  BEFORE INSERT ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_preset_face_photos_per_driver();

-- =====================================================
-- 4. Validation function to ensure driver_name matches participant's drivers list
-- =====================================================
CREATE OR REPLACE FUNCTION validate_driver_name()
RETURNS TRIGGER AS $$
DECLARE
  driver_exists BOOLEAN;
  drivers_list TEXT;
BEGIN
  -- Only validate if driver_name is specified
  IF NEW.driver_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the participant's nome (drivers field)
  SELECT nome INTO drivers_list
  FROM preset_participants
  WHERE id = NEW.participant_id;

  -- Check if driver_name is in the comma-separated drivers list
  driver_exists := EXISTS (
    SELECT 1 FROM unnest(string_to_array(drivers_list, ',')) AS driver
    WHERE TRIM(driver) = TRIM(NEW.driver_name)
  );

  IF NOT driver_exists THEN
    RAISE EXCEPTION 'Driver "%" not found in participant drivers list. Available drivers: %', NEW.driver_name, drivers_list;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate driver_name
DROP TRIGGER IF EXISTS validate_driver_name_trigger ON preset_participant_face_photos;
CREATE TRIGGER validate_driver_name_trigger
  BEFORE INSERT OR UPDATE ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION validate_driver_name();

-- =====================================================
-- 5. Helper function to get driver-specific metatag
-- =====================================================
CREATE OR REPLACE FUNCTION get_driver_metatag(
  p_participant_id UUID,
  p_driver_name TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_result TEXT;
  v_driver_metatags JSONB;
  v_general_metatag TEXT;
BEGIN
  -- Get both driver_specific_metatags and general metatag
  SELECT driver_specific_metatags, metatag
  INTO v_driver_metatags, v_general_metatag
  FROM preset_participants
  WHERE id = p_participant_id;

  -- Try to get driver-specific metatag
  IF v_driver_metatags ? p_driver_name THEN
    v_result := v_driver_metatags->>p_driver_name;
  END IF;

  -- Fallback to general metatag if no driver-specific one exists
  IF v_result IS NULL OR v_result = '' THEN
    v_result := v_general_metatag;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_driver_metatag IS 'Get metatag for specific driver, falling back to general metatag if not found';

-- =====================================================
-- 6. Update ensure_single_preset_primary_photo to work per-driver
-- =====================================================
DROP TRIGGER IF EXISTS ensure_single_preset_primary_trigger ON preset_participant_face_photos;
DROP FUNCTION IF EXISTS ensure_single_preset_primary_photo();

CREATE OR REPLACE FUNCTION ensure_single_preset_primary_photo_per_driver()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    -- Set all other photos for this participant AND driver to non-primary
    IF NEW.driver_name IS NOT NULL THEN
      UPDATE preset_participant_face_photos
      SET is_primary = false
      WHERE participant_id = NEW.participant_id
      AND driver_name = NEW.driver_name
      AND id != NEW.id;
    ELSE
      -- For photos without driver_name, keep old behavior (global primary)
      UPDATE preset_participant_face_photos
      SET is_primary = false
      WHERE participant_id = NEW.participant_id
      AND driver_name IS NULL
      AND id != NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_preset_primary_per_driver_trigger
  BEFORE INSERT OR UPDATE ON preset_participant_face_photos
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_preset_primary_photo_per_driver();
