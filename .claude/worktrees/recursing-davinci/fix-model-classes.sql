-- ============================================
-- FIX: Model Manifest - Correct Class Count
-- ============================================
-- Il tensor ha 64 features = 4 bbox + 60 classi
-- Ma il manifest dice 61 classi (SBAGLIATO)

-- 1. Verifica quante classi sono nell'allowed_labels
SELECT
  code,
  array_length(allowed_labels, 1) as num_labels,
  jsonb_array_length(
    CASE
      WHEN jsonb_typeof(allowed_labels::jsonb) = 'array'
      THEN allowed_labels::jsonb
      ELSE '[]'::jsonb
    END
  ) as num_labels_alt
FROM sport_categories
WHERE code = 'IMSA_WeatherTech';

-- 2. Verifica il modello nel registry
SELECT
  id,
  version,
  manifest,
  metadata
FROM model_registry
WHERE id = '2dcd3456-701b-44f7-be14-c9b2ef3f9db2';

-- ============================================
-- Se il manifest ha "classes" con 61 elementi,
-- ma allowed_labels ha 60 elementi, allora:
-- ============================================
-- Il modello ha 60 classi (corretto)
-- Il manifest deve essere aggiornato a 60
