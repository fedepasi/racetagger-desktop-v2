-- ====================================
-- AGGIUNTA CONFIGURAZIONI TEMPORALI E DI MATCHING ALLE SPORT CATEGORIES
-- Eseguire in Supabase SQL Editor
-- ====================================

-- Add temporal_config and matching_config columns to sport_categories table
ALTER TABLE sport_categories
ADD COLUMN temporal_config JSONB,
ADD COLUMN matching_config JSONB;

-- Update existing motorsport category with its specific configuration
UPDATE sport_categories
SET
  temporal_config = '{
    "clusterWindow": 3000,
    "burstThreshold": 100,
    "proximityBonus": 30
  }'::jsonb,
  matching_config = '{
    "weights": {
      "raceNumber": 100,
      "driverName": 80,
      "sponsor": 40,
      "team": 60
    },
    "thresholds": {
      "minimumScore": 50,
      "clearWinner": 30,
      "nameSimilarity": 0.75,
      "lowOcrConfidence": 0.6,
      "strongNonNumberEvidence": 80
    },
    "multiEvidenceBonus": 0.2
  }'::jsonb
WHERE code = 'motorsport';

-- Update running category with its specific configuration
UPDATE sport_categories
SET
  temporal_config = '{
    "clusterWindow": 2000,
    "burstThreshold": 100,
    "proximityBonus": 25
  }'::jsonb,
  matching_config = '{
    "weights": {
      "raceNumber": 120,
      "driverName": 60,
      "sponsor": 20,
      "team": 30
    },
    "thresholds": {
      "minimumScore": 60,
      "clearWinner": 40,
      "nameSimilarity": 0.8,
      "lowOcrConfidence": 0.7,
      "strongNonNumberEvidence": 100
    },
    "multiEvidenceBonus": 0.15
  }'::jsonb
WHERE code = 'running';

-- Update cycling category with its specific configuration
UPDATE sport_categories
SET
  temporal_config = '{
    "clusterWindow": 4000,
    "burstThreshold": 100,
    "proximityBonus": 25
  }'::jsonb,
  matching_config = '{
    "weights": {
      "raceNumber": 110,
      "driverName": 50,
      "sponsor": 60,
      "team": 70
    },
    "thresholds": {
      "minimumScore": 55,
      "clearWinner": 35,
      "nameSimilarity": 0.75,
      "lowOcrConfidence": 0.65,
      "strongNonNumberEvidence": 85
    },
    "multiEvidenceBonus": 0.25
  }'::jsonb
WHERE code = 'cycling';

-- Update altro (generic) category with default configuration
UPDATE sport_categories
SET
  temporal_config = '{
    "clusterWindow": 2000,
    "burstThreshold": 100,
    "proximityBonus": 20
  }'::jsonb,
  matching_config = '{
    "weights": {
      "raceNumber": 90,
      "driverName": 70,
      "sponsor": 35,
      "team": 50
    },
    "thresholds": {
      "minimumScore": 45,
      "clearWinner": 25,
      "nameSimilarity": 0.7,
      "lowOcrConfidence": 0.6,
      "strongNonNumberEvidence": 75
    },
    "multiEvidenceBonus": 0.2
  }'::jsonb
WHERE code = 'altro';

-- Add motocross if it doesn't exist, or update if it does
INSERT INTO sport_categories (code, name, description, icon, ai_prompt, display_order, temporal_config, matching_config, expected_fields, is_active)
VALUES (
  'motocross',
  'Motocross',
  'Motocross e sport motoristici fuoristrada',
  '🏍️',
  'Analyze the provided image for motocross riders and vehicles. For each detected element, extract:
- raceNumber: The rider number (often 3-digit, clearly visible on bike or jersey)
- riderName: Name if visible on jersey or gear
- teamName: Team or sponsor names visible
- bikeNumber: Number on motorcycle if different from rider number
- sponsors: Visible sponsor text on bike or gear
Focus on 3-digit numbers and motocross-specific elements.',
  5,
  '{
    "clusterWindow": 3000,
    "burstThreshold": 100,
    "proximityBonus": 30
  }'::jsonb,
  '{
    "weights": {
      "raceNumber": 110,
      "driverName": 70,
      "sponsor": 50,
      "team": 40
    },
    "thresholds": {
      "minimumScore": 50,
      "clearWinner": 25,
      "nameSimilarity": 0.7,
      "lowOcrConfidence": 0.5,
      "strongNonNumberEvidence": 70
    },
    "multiEvidenceBonus": 0.3
  }'::jsonb,
  '{"fields": ["numero", "nome", "squadra", "sponsor"]}'::jsonb,
  true
)
ON CONFLICT (code) DO UPDATE SET
  temporal_config = EXCLUDED.temporal_config,
  matching_config = EXCLUDED.matching_config,
  updated_at = now();

-- Set default configurations for any categories that don't have them yet
UPDATE sport_categories
SET
  temporal_config = '{
    "clusterWindow": 2000,
    "burstThreshold": 100,
    "proximityBonus": 20
  }'::jsonb,
  matching_config = '{
    "weights": {
      "raceNumber": 90,
      "driverName": 70,
      "sponsor": 35,
      "team": 50
    },
    "thresholds": {
      "minimumScore": 45,
      "clearWinner": 25,
      "nameSimilarity": 0.7,
      "lowOcrConfidence": 0.6,
      "strongNonNumberEvidence": 75
    },
    "multiEvidenceBonus": 0.2
  }'::jsonb
WHERE temporal_config IS NULL OR matching_config IS NULL;

-- Add helpful comments
COMMENT ON COLUMN sport_categories.temporal_config IS 'Configurazione temporale per clustering e analisi di prossimità (clusterWindow: ms tra foto stesso gruppo, burstThreshold: ms per burst mode, proximityBonus: punti bonus vicinanza)';
COMMENT ON COLUMN sport_categories.matching_config IS 'Configurazione pesi e soglie per matching intelligente (weights: pesi elementi, thresholds: soglie decisione, multiEvidenceBonus: bonus evidenze multiple)';

-- ====================================
-- FINE MIGRATION
-- Copiare ed eseguire tutto insieme in Supabase SQL Editor
-- ====================================