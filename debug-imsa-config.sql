-- ============================================
-- QUERY 1: Verifica Config Categoria IMSA
-- ============================================
SELECT
  id,
  code,
  name,
  use_local_onnx,
  recognition_method,
  recognition_config,
  active_model_id,
  edge_function_version
FROM sport_categories
WHERE name ILIKE '%imsa%' OR code ILIKE '%imsa%' OR code = 'motorsport';

-- ============================================
-- QUERY 2: Verifica Modelli Disponibili
-- ============================================
SELECT
  mr.id,
  mr.version,
  mr.model_type,
  mr.onnx_storage_path,
  mr.is_active,
  mr.performance_metrics,
  sc.code as category_code,
  sc.name as category_name
FROM model_registry mr
JOIN sport_categories sc ON mr.sport_category_id = sc.id
WHERE sc.name ILIKE '%imsa%' OR sc.code ILIKE '%imsa%' OR sc.code = 'motorsport'
ORDER BY mr.created_at DESC;

-- ============================================
-- QUERY 3: Verifica File ONNX nello Storage
-- ============================================
-- Esegui manualmente in Storage > onnx-models bucket
-- Cerca file .onnx per motorsport/imsa
