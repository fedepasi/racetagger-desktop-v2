-- Migration: Add person_shown_template to participant_presets
-- This field stores the template for IPTC PersonInImage metadata field
-- Example: "{name} ({nationality}) {team} {car_model}"

-- Add person_shown_template column to participant_presets
ALTER TABLE participant_presets
ADD COLUMN IF NOT EXISTS person_shown_template VARCHAR(255);

-- Add comment for documentation
COMMENT ON COLUMN participant_presets.person_shown_template IS 'Template for IPTC PersonInImage field. Placeholders: {name}, {surname}, {number}, {team}, {car_model}, {nationality}';
