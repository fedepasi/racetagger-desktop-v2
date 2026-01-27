-- ============================================
-- URGENT FIX: IMSA WeatherTech Confidence
-- ============================================
-- CRITICAL: Confidence è ancora 0.7 invece di 0.35!

UPDATE sport_categories
SET
  recognition_config = jsonb_set(
    recognition_config,
    '{minConfidence}',
    '0.35'::jsonb
  ),
  updated_at = NOW()
WHERE
  code = 'IMSA_WeatherTech';

-- ============================================
-- VERIFICA IMMEDIATA
-- ============================================
SELECT
  code,
  recognition_config->>'minConfidence' as min_confidence,
  crop_config->'crop'->>'minDimension' as crop_min_dimension,
  use_local_onnx,
  recognition_method,
  active_model_id
FROM sport_categories
WHERE code = 'IMSA_WeatherTech';

-- ============================================
-- RISULTATO ATTESO:
-- ============================================
-- min_confidence: "0.35"  ← DEVE essere questo!
-- crop_min_dimension: "256"
-- use_local_onnx: true
-- recognition_method: "local-onnx"
