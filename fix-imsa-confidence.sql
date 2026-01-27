-- ============================================
-- FIX: IMSA WeatherTech per Veicoli Distanti
-- ============================================
-- 1. Abbassa minConfidence: 0.7 → 0.35
-- 2. Alza minDimension crop: 200 → 256

UPDATE sport_categories
SET
  -- Abbassa confidence threshold (per veicoli distanti)
  recognition_config = jsonb_set(
    recognition_config,
    '{minConfidence}',
    '0.35'::jsonb
  ),
  -- Alza minDimension (crop piccoli ora accettati)
  crop_config = jsonb_set(
    crop_config,
    '{crop,minDimension}',
    '256'::jsonb
  ),
  updated_at = NOW()
WHERE
  code = 'IMSA_WeatherTech';

-- ============================================
-- VERIFICA: Controlla che sia stato applicato
-- ============================================
SELECT
  code,
  name,
  use_local_onnx,
  recognition_method,
  active_model_id,
  recognition_config->>'minConfidence' as min_confidence,
  recognition_config->>'maxResults' as max_results,
  crop_config->'crop'->>'minDimension' as crop_min_dimension
FROM sport_categories
WHERE code = 'IMSA_WeatherTech';

-- ============================================
-- Risultato atteso:
-- ============================================
-- min_confidence: "0.35" (era "0.7")
-- crop_min_dimension: "256" (era "200")
-- use_local_onnx: true
-- recognition_method: "local-onnx"
