-- Migration: Add recognition_config to sport_categories
-- Description: Adds configurable recognition settings for filtering blurry/background objects

-- Add recognition_config column with default values
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS recognition_config JSONB DEFAULT '{
  "maxResults": 5,
  "minConfidence": 0.6,
  "confidenceDecayFactor": 0.9,
  "relativeConfidenceGap": 0.3,
  "focusMode": "auto",
  "ignoreBackground": true,
  "prioritizeForeground": true
}'::jsonb;

-- Update existing categories with optimized configurations
UPDATE sport_categories
SET recognition_config = '{
  "maxResults": 5,
  "minConfidence": 0.7,
  "confidenceDecayFactor": 0.85,
  "relativeConfidenceGap": 0.35,
  "focusMode": "foreground",
  "ignoreBackground": true,
  "prioritizeForeground": true,
  "description": "Motorsport: max 5 vehicles, focus on foreground"
}'::jsonb
WHERE code = 'motorsport';

UPDATE sport_categories
SET recognition_config = '{
  "maxResults": 2,
  "minConfidence": 0.75,
  "confidenceDecayFactor": 0.9,
  "relativeConfidenceGap": 0.3,
  "focusMode": "primary",
  "ignoreBackground": true,
  "prioritizeForeground": true,
  "description": "Rally: max 2 vehicles, higher confidence required"
}'::jsonb
WHERE code = 'rally';

UPDATE sport_categories
SET recognition_config = '{
  "maxResults": 1,
  "minConfidence": 0.8,
  "confidenceDecayFactor": 1.0,
  "relativeConfidenceGap": 0.5,
  "focusMode": "closest",
  "ignoreBackground": true,
  "prioritizeForeground": true,
  "description": "Running: only 1 runner, highest confidence"
}'::jsonb
WHERE code = 'running';

UPDATE sport_categories
SET recognition_config = '{
  "maxResults": 1,
  "minConfidence": 0.75,
  "confidenceDecayFactor": 1.0,
  "relativeConfidenceGap": 0.5,
  "focusMode": "closest",
  "ignoreBackground": true,
  "prioritizeForeground": true,
  "description": "Cycling: only 1 cyclist, focus on closest"
}'::jsonb
WHERE code = 'cycling';

UPDATE sport_categories
SET recognition_config = '{
  "maxResults": 3,
  "minConfidence": 0.65,
  "confidenceDecayFactor": 0.85,
  "relativeConfidenceGap": 0.35,
  "focusMode": "foreground",
  "ignoreBackground": true,
  "prioritizeForeground": true,
  "description": "Motocross: max 3 bikes, moderate confidence"
}'::jsonb
WHERE code = 'motocross';

UPDATE sport_categories
SET recognition_config = '{
  "maxResults": 3,
  "minConfidence": 0.65,
  "confidenceDecayFactor": 0.9,
  "relativeConfidenceGap": 0.35,
  "focusMode": "auto",
  "ignoreBackground": true,
  "prioritizeForeground": true,
  "description": "Other sports: max 3 subjects, auto mode"
}'::jsonb
WHERE code = 'altro';

-- Add comment to explain the fields
COMMENT ON COLUMN sport_categories.recognition_config IS 'Configuration for AI recognition filtering:
- maxResults: Maximum number of subjects to detect per image
- minConfidence: Minimum confidence score to accept a detection (0.0-1.0)
- confidenceDecayFactor: Factor to reduce confidence for subsequent detections
- relativeConfidenceGap: Maximum gap from best confidence to accept
- focusMode: Detection focus strategy (auto/foreground/closest/primary/all)
- ignoreBackground: Whether to ignore background/distant subjects
- prioritizeForeground: Whether to prioritize foreground subjects';