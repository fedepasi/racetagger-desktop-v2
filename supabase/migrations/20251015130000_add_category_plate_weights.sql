-- Add category and plateNumber weights to sport_categories matching_config
-- This migration adds support for:
-- 1. category: weight for category matches (GT3, F1, MotoGP, etc.)
-- 2. plateNumber: weight for license plate matches

-- Note: sport_categories table should already exist with matching_config JSONB field

-- Example matching_config structure after this migration:
-- {
--   "weights": {
--     "raceNumber": 100,
--     "driverName": 80,
--     "sponsor": 40,
--     "team": 60,
--     "category": 60,        -- NEW: Category weight (0 = disabled)
--     "plateNumber": 150     -- NEW: Plate number weight (0 = disabled)
--   },
--   "thresholds": { ... },
--   "multiEvidenceBonus": 0.2
-- }

-- ============================================================================
-- MOTORSPORT CATEGORIES - Enable plate detection and category matching
-- ============================================================================

-- WEC / IMSA / Endurance - Plate numbers visible, category important
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '60'::jsonb
  ),
  '{weights,plateNumber}',
  '150'::jsonb
)
WHERE code IN ('motorsport', 'wec', 'imsa', 'endurance')
AND is_active = true;

-- Track Racing (F1, F2, Formula E, GT Sprint) - Plates usually covered/removed
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '70'::jsonb
  ),
  '{weights,plateNumber}',
  '0'::jsonb  -- DISABLED - plates not visible
)
WHERE code IN ('f1', 'f2', 'f3', 'formula-e', 'gt-sprint', 'formula')
AND is_active = true;

-- Rally / Hillclimb - Plates always visible, category very important
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '80'::jsonb
  ),
  '{weights,plateNumber}',
  '130'::jsonb
)
WHERE code IN ('rally', 'hillclimb', 'stage-rally')
AND is_active = true;

-- Motocross / Off-road - Category important, plates sometimes visible
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '70'::jsonb
  ),
  '{weights,plateNumber}',
  '80'::jsonb
)
WHERE code IN ('motocross', 'supercross', 'enduro')
AND is_active = true;

-- ============================================================================
-- NON-MOTORSPORT CATEGORIES - Disable plate detection
-- ============================================================================

-- Running - No plates, category less critical for matching
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '30'::jsonb
  ),
  '{weights,plateNumber}',
  '0'::jsonb  -- DISABLED - not applicable
)
WHERE code IN ('running', 'marathon', 'trail-running', 'athletics')
AND is_active = true;

-- Cycling - No plates, category useful for road vs MTB
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '40'::jsonb
  ),
  '{weights,plateNumber}',
  '0'::jsonb  -- DISABLED - not applicable
)
WHERE code IN ('cycling', 'mtb', 'road-cycling')
AND is_active = true;

-- ============================================================================
-- FALLBACK - Set defaults for any remaining categories
-- ============================================================================

-- Any other active categories get conservative defaults
UPDATE sport_categories
SET matching_config = jsonb_set(
  jsonb_set(
    COALESCE(matching_config, '{"weights":{}, "thresholds":{}}'::jsonb),
    '{weights,category}',
    '0'::jsonb  -- DISABLED by default
  ),
  '{weights,plateNumber}',
  '0'::jsonb  -- DISABLED by default
)
WHERE is_active = true
AND matching_config IS NOT NULL
AND NOT (matching_config->'weights' ? 'category')  -- Only update if category weight doesn't exist
AND NOT (matching_config->'weights' ? 'plateNumber');  -- Only update if plate weight doesn't exist

-- ============================================================================
-- DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN sport_categories.matching_config IS 'JSON configuration for participant matching including weights (raceNumber, driverName, sponsor, team, category, plateNumber), thresholds (minimumScore, clearWinner, nameSimilarity, lowOcrConfidence, strongNonNumberEvidence), and multiEvidenceBonus';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
-- Run this to verify the migration worked correctly:
/*
SELECT
  code,
  name,
  matching_config->'weights'->>'category' as category_weight,
  matching_config->'weights'->>'plateNumber' as plate_number_weight,
  recognition_config->>'detectPlateNumber' as ai_detects_plate
FROM sport_categories
WHERE is_active = true
ORDER BY display_order;
*/
