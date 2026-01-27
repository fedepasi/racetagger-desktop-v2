-- ============================================
-- ABILITA ONNX PER CATEGORIA IMSA/MOTORSPORT
-- ============================================
-- ⚠️ ESEGUI SOLO SE QUERY 2 HA MOSTRATO UN MODELLO DISPONIBILE!

UPDATE sport_categories
SET
  use_local_onnx = true,
  recognition_method = 'local-onnx',
  recognition_config = jsonb_set(
    COALESCE(recognition_config, '{}'::jsonb),
    '{minConfidence}',
    '0.35'::jsonb
  ),
  -- Se hai un active_model_id dalla QUERY 2, sostituisci NULL con l'ID:
  active_model_id = NULL  -- ← CAMBIA CON ID DEL MODELLO (es: 'abc-123-xyz')
WHERE
  -- Adatta il filtro in base al risultato di QUERY 1:
  code = 'motorsport' OR name ILIKE '%imsa%';

-- Verifica che sia stato applicato:
SELECT
  code,
  use_local_onnx,
  recognition_method,
  recognition_config,
  active_model_id
FROM sport_categories
WHERE code = 'motorsport' OR name ILIKE '%imsa%';
