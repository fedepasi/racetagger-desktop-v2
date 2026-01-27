-- Check IMSA model configuration
SELECT
  mr.id as model_id,
  mr.version,
  mr.is_active,
  mr.onnx_storage_path,
  jsonb_array_length(mr.class_manifest->'classes') as num_classes_in_manifest,
  sc.id as category_id,
  sc.code as category_code,
  sc.name as category_name,
  sc.use_local_onnx,
  sc.recognition_method,
  sc.recognition_config->>'minConfidence' as min_confidence
FROM model_registry mr
JOIN sport_categories sc ON mr.sport_category_id = sc.id
WHERE sc.code ILIKE '%imsa%' OR sc.name ILIKE '%imsa%'
ORDER BY mr.is_active DESC, mr.version DESC;

-- Show first 5 classes from manifest
SELECT
  sc.name,
  jsonb_array_elements_text(mr.class_manifest->'classes') as class_name
FROM model_registry mr
JOIN sport_categories sc ON mr.sport_category_id = sc.id
WHERE sc.code ILIKE '%imsa%' OR sc.name ILIKE '%imsa%'
  AND mr.is_active = true
LIMIT 5;
