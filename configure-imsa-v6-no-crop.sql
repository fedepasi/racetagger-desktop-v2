-- ============================================
-- CONFIGURA IMSA per V6 senza Crop
-- ============================================
-- Usa V6 Edge Function in modalità full-image (senza crop)

UPDATE sport_categories
SET
  edge_function_version = 6,        -- Usa V6 (ora supporta entrambe le modalità)
  use_local_onnx = true,            -- Mantieni ONNX locale
  recognition_method = 'local-onnx',-- Usa ONNX con fallback a Gemini
  crop_config = NULL,               -- Disabilita crop (modalità full-image)
  recognition_config = jsonb_set(
    COALESCE(recognition_config, '{}'::jsonb),
    '{minConfidence}',
    '0.35'::jsonb                   -- Confidence threshold per ONNX
  ),
  updated_at = NOW()
WHERE
  code = 'IMSA_WeatherTech';

-- ============================================
-- VERIFICA CONFIGURAZIONE
-- ============================================
SELECT
  code,
  name,
  edge_function_version,
  use_local_onnx,
  recognition_method,
  crop_config,
  recognition_config->>'minConfidence' as min_confidence,
  active_model_id
FROM sport_categories
WHERE code = 'IMSA_WeatherTech';

-- ============================================
-- RISULTATO ATTESO:
-- ============================================
-- edge_function_version: 6
-- use_local_onnx: true
-- recognition_method: "local-onnx"
-- crop_config: null
-- min_confidence: "0.35"
-- active_model_id: (UUID del modello ONNX IMSA)
