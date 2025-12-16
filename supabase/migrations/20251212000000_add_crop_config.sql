-- Migration: Add Crop Config for Crop + Context Strategy
-- Date: 2025-12-12
-- Description: Adds crop_config JSONB column to sport_categories for high-resolution
--              crop extraction and context negative generation.
--
-- BACKWARD COMPATIBILITY:
-- - Column has DEFAULT NULL (not an empty object)
-- - Existing app versions will see NULL and use existing flow
-- - New app versions check for crop_config?.enabled before using new features
-- - Edge functions V3/V4/V5 remain unchanged, V6 is additive

-- ============================================================================
-- PHASE 1: Add crop_config column with NULL default
-- ============================================================================

-- Add column only if it doesn't exist
-- DEFAULT NULL ensures backward compatibility: old apps see NULL and ignore
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS crop_config JSONB DEFAULT NULL;

-- ============================================================================
-- DOCUMENTATION: Expected crop_config structure (when enabled)
-- ============================================================================
-- {
--   "enabled": true,                    -- Must be true to activate feature
--   "crop": {
--     "paddingPercent": 0.15,           -- Padding around bbox (15%)
--     "minPaddingPx": 50,               -- Minimum padding in pixels
--     "minDimension": 640,              -- Minimum crop size
--     "maxDimension": 1024,             -- Maximum crop size
--     "jpegQuality": 90                 -- JPEG quality for crops
--   },
--   "negative": {
--     "enabled": true,                  -- Generate context negative
--     "maskColor": "#000000",           -- Black mask over subjects
--     "maxDimension": 1440,             -- Max negative dimension
--     "jpegQuality": 80                 -- Lower quality for context
--   },
--   "multiSubject": {
--     "maxCropsPerRequest": 5,          -- Limit crops per API call
--     "strategy": "batch"               -- batch | sequential
--   }
-- }

-- ============================================================================
-- PHASE 2: Add index for performance (optional, only if querying by config)
-- ============================================================================

-- Index for checking enabled status efficiently
CREATE INDEX IF NOT EXISTS idx_sport_categories_crop_config_enabled
  ON sport_categories ((crop_config->>'enabled'))
  WHERE crop_config IS NOT NULL;

-- ============================================================================
-- PHASE 3: NO automatic enablement
-- ============================================================================
--
-- DO NOT enable crop_config automatically for any category.
-- This must be done manually via management dashboard after testing.
--
-- Example (DO NOT RUN AUTOMATICALLY):
-- UPDATE sport_categories
-- SET crop_config = '{
--   "enabled": true,
--   "crop": { "paddingPercent": 0.15, "minPaddingPx": 50, "minDimension": 640, "maxDimension": 1024, "jpegQuality": 90 },
--   "negative": { "enabled": true, "maskColor": "#000000", "maxDimension": 1440, "jpegQuality": 80 },
--   "multiSubject": { "maxCropsPerRequest": 5, "strategy": "batch" }
-- }'::JSONB
-- WHERE code = 'motorsport' AND recognition_method = 'gemini';

-- ============================================================================
-- ROLLBACK (if needed):
-- ALTER TABLE sport_categories DROP COLUMN IF EXISTS crop_config;
-- DROP INDEX IF EXISTS idx_sport_categories_crop_config_enabled;
-- ============================================================================
