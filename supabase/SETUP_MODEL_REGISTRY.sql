-- ============================================================================
-- SETUP: Model Registry per Local ONNX Inference
-- ============================================================================
-- Esegui questa query in Supabase SQL Editor (https://supabase.com/dashboard)
--
-- Questo script:
-- 1. Crea la tabella model_registry
-- 2. Aggiunge colonne a sport_categories
-- 3. Aggiorna i constraint per recognition_method
-- 4. Crea helper functions
-- ============================================================================

-- STEP 1: Rimuovi constraint esistente su recognition_method (se esiste)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sport_categories_recognition_method_check'
  ) THEN
    ALTER TABLE sport_categories DROP CONSTRAINT sport_categories_recognition_method_check;
  END IF;
END $$;

-- STEP 2: Crea tabella model_registry
CREATE TABLE IF NOT EXISTS model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_category_id UUID REFERENCES sport_categories(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  onnx_storage_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  input_size INTEGER[] DEFAULT '{512,512}',
  confidence_threshold DECIMAL(3,2) DEFAULT 0.70,
  iou_threshold DECIMAL(3,2) DEFAULT 0.50,
  classes TEXT[] DEFAULT '{}',
  min_app_version TEXT,
  is_active BOOLEAN DEFAULT true,
  release_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(sport_category_id, version)
);

-- STEP 3: Aggiungi colonne a sport_categories
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS active_model_id UUID;

ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS use_local_onnx BOOLEAN DEFAULT false;

-- Aggiungi FK se non esiste (prima verifica che la colonna esista)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sport_categories_active_model_id_fkey'
  ) THEN
    ALTER TABLE sport_categories
    ADD CONSTRAINT sport_categories_active_model_id_fkey
    FOREIGN KEY (active_model_id) REFERENCES model_registry(id);
  END IF;
END $$;

-- STEP 4: Aggiungi nuovo constraint per recognition_method con local-onnx
DO $$
BEGIN
  -- Prima rimuovi il constraint esistente se c'è
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sport_categories_recognition_method_check'
  ) THEN
    ALTER TABLE sport_categories DROP CONSTRAINT sport_categories_recognition_method_check;
  END IF;

  -- Aggiungi il nuovo constraint
  ALTER TABLE sport_categories
  ADD CONSTRAINT sport_categories_recognition_method_check
  CHECK (recognition_method IN ('gemini', 'rf-detr', 'local-onnx'));
EXCEPTION WHEN duplicate_object THEN
  NULL; -- Ignora se già esiste
END $$;

-- STEP 5: Indici per model_registry
CREATE INDEX IF NOT EXISTS idx_model_registry_category
  ON model_registry(sport_category_id, is_active);

CREATE INDEX IF NOT EXISTS idx_model_registry_classes
  ON model_registry USING GIN(classes);

-- STEP 6: Trigger per updated_at
CREATE OR REPLACE FUNCTION update_model_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_registry_updated_at ON model_registry;
CREATE TRIGGER model_registry_updated_at
  BEFORE UPDATE ON model_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_model_registry_updated_at();

-- STEP 7: Row Level Security
ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;

-- Rimuovi policy esistenti se ci sono
DROP POLICY IF EXISTS "Authenticated users can read model registry" ON model_registry;
DROP POLICY IF EXISTS "Admins can manage model registry" ON model_registry;
DROP POLICY IF EXISTS "Anyone can read model registry" ON model_registry;
DROP POLICY IF EXISTS "Authenticated can manage model registry" ON model_registry;

-- Policy: Tutti possono leggere (necessario per download)
CREATE POLICY "Anyone can read model registry"
  ON model_registry
  FOR SELECT
  USING (true);

-- Policy: Authenticated users possono gestire (per semplicità, in prod limitare ad admin)
-- NOTA: auth.uid() IS NOT NULL è la sintassi corretta per verificare l'autenticazione
CREATE POLICY "Authenticated can manage model registry"
  ON model_registry
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- STEP 8: Helper function per ottenere il modello attivo
CREATE OR REPLACE FUNCTION get_active_model_for_category(category_code TEXT)
RETURNS TABLE (
  model_id UUID,
  onnx_storage_path TEXT,
  version TEXT,
  size_bytes BIGINT,
  checksum_sha256 TEXT,
  input_size INTEGER[],
  confidence_threshold DECIMAL,
  iou_threshold DECIMAL,
  classes TEXT[],
  min_app_version TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mr.id AS model_id,
    mr.onnx_storage_path,
    mr.version,
    mr.size_bytes,
    mr.checksum_sha256,
    mr.input_size,
    mr.confidence_threshold,
    mr.iou_threshold,
    mr.classes,
    mr.min_app_version
  FROM model_registry mr
  JOIN sport_categories sc ON sc.active_model_id = mr.id
  WHERE sc.code = category_code
    AND mr.is_active = true
    AND sc.use_local_onnx = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_active_model_for_category(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_model_for_category(TEXT) TO anon;

-- STEP 9: Colonne per execution_settings (opzionale, potrebbero già esistere)
DO $$
BEGIN
  ALTER TABLE execution_settings ADD COLUMN IF NOT EXISTS local_onnx_model_version TEXT;
  ALTER TABLE execution_settings ADD COLUMN IF NOT EXISTS local_onnx_inference_count INTEGER DEFAULT 0;
  ALTER TABLE execution_settings ADD COLUMN IF NOT EXISTS local_onnx_avg_inference_ms DECIMAL(10,2);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'execution_settings table not found, skipping';
END $$;

-- ============================================================================
-- VERIFICA FINALE
-- ============================================================================

-- Verifica che le tabelle esistano
SELECT 'model_registry exists' as check, EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'model_registry'
) as result;

SELECT 'sport_categories has active_model_id' as check, EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sport_categories' AND column_name = 'active_model_id'
) as result;

SELECT 'sport_categories has use_local_onnx' as check, EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'sport_categories' AND column_name = 'use_local_onnx'
) as result;

-- ============================================================================
-- OUTPUT: Mostra le categorie disponibili
-- ============================================================================

SELECT
  id,
  code,
  name,
  icon,
  recognition_method,
  use_local_onnx,
  active_model_id
FROM sport_categories
ORDER BY name;
