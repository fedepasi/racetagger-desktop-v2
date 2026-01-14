-- Migration: Remove person_shown_template from participant_presets
-- This field is no longer needed as per issue #22

-- Remove person_shown_template column from participant_presets
ALTER TABLE participant_presets
DROP COLUMN IF EXISTS person_shown_template;
