-- Update sport_categories recognition_config to support plate number detection and bbox format
-- This migration adds support for:
-- 1. detectPlateNumber: enables/disables license plate recognition (useful for motorsport)
-- 2. boundingBoxFormat: specifies bbox format ('gemini_native' for [y1,x1,y2,x2] 0-1000)

-- Note: sport_categories table should already exist with recognition_config JSONB field
-- If the table doesn't exist, create it first with the web app admin interface

-- Example recognition_config structure after this migration:
-- {
--   "maxResults": 5,
--   "minConfidence": 0.7,
--   "focusMode": "foreground",
--   "ignoreBackground": true,
--   "prioritizeForeground": true,
--   "detectPlateNumber": true,              -- NEW: Enable plate number detection
--   "boundingBoxFormat": "gemini_native"    -- NEW: Use [y1,x1,y2,x2] 0-1000 format
-- }

-- Update existing motorsport category to enable plate detection and use new bbox format
UPDATE sport_categories
SET recognition_config = jsonb_set(
  jsonb_set(
    COALESCE(recognition_config, '{}'::jsonb),
    '{detectPlateNumber}',
    'true'::jsonb
  ),
  '{boundingBoxFormat}',
  '"gemini_native"'::jsonb
)
WHERE code = 'motorsport'
AND is_active = true;

-- Update all other categories to use new bbox format but disable plate detection
UPDATE sport_categories
SET recognition_config = jsonb_set(
  jsonb_set(
    COALESCE(recognition_config, '{}'::jsonb),
    '{detectPlateNumber}',
    'false'::jsonb
  ),
  '{boundingBoxFormat}',
  '"gemini_native"'::jsonb
)
WHERE code != 'motorsport'
AND is_active = true;

-- Add comment to document the new fields
COMMENT ON COLUMN sport_categories.recognition_config IS 'JSON configuration for AI recognition including maxResults, minConfidence, focusMode, ignoreBackground, prioritizeForeground, detectPlateNumber (bool), and boundingBoxFormat (string: gemini_native or legacy)';
