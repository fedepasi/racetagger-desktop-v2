-- ============================================
-- VERIFICA: Modello ONNX per IMSA WeatherTech
-- ============================================

SELECT
  mr.id,
  mr.version,
  mr.model_type,
  mr.onnx_storage_path,
  mr.is_active,
  mr.performance_metrics,
  mr.created_at,
  sc.code as category_code,
  sc.name as category_name
FROM model_registry mr
JOIN sport_categories sc ON mr.sport_category_id = sc.id
WHERE mr.id = '2dcd3456-701b-44f7-be14-c9b2ef3f9db2';

-- ============================================
-- Risultato atteso:
-- ============================================
-- id: 2dcd3456-701b-44f7-be14-c9b2ef3f9db2
-- version: vX.X.X
-- onnx_storage_path: motorsport/imsa_2026.onnx (o simile)
-- is_active: true
-- category_code: IMSA_WeatherTech
