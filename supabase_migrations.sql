-- =================================================================
-- SUPABASE SETUP: USER CSV METADATA TABLE
-- =================================================================
-- Questo file contiene tutte le query necessarie per configurare
-- il sistema di cache cleanup con preservazione dati CSV.
--
-- ISTRUZIONI:
-- 1. Copia tutto il contenuto di questo file
-- 2. Vai su https://supabase.com/dashboard -> SQL Editor
-- 3. Incolla ed esegui le query
-- =================================================================

-- 1. CREAZIONE TABELLA user_csv_metadata
-- Memorizza i metadati dei CSV caricati dagli utenti
CREATE TABLE public.user_csv_metadata (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    csv_name text NOT NULL,
    storage_path text NOT NULL,
    last_used timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);

-- 2. COMMENTI SULLA TABELLA
COMMENT ON TABLE public.user_csv_metadata IS 'Metadati dei file CSV caricati dagli utenti per il ripristino automatico al login';
COMMENT ON COLUMN public.user_csv_metadata.id IS 'Identificativo univoco del record';
COMMENT ON COLUMN public.user_csv_metadata.user_id IS 'ID dell''utente proprietario del CSV (foreign key a auth.users)';
COMMENT ON COLUMN public.user_csv_metadata.csv_name IS 'Nome del file CSV originale';
COMMENT ON COLUMN public.user_csv_metadata.storage_path IS 'Percorso del file CSV su Supabase Storage';
COMMENT ON COLUMN public.user_csv_metadata.last_used IS 'Timestamp dell''ultimo utilizzo del CSV';
COMMENT ON COLUMN public.user_csv_metadata.created_at IS 'Timestamp di creazione del record';

-- 3. INDICI PER PERFORMANCE
-- Indice principale per query per utente
CREATE INDEX idx_user_csv_metadata_user_id ON public.user_csv_metadata(user_id);

-- Indice per ordinamento per ultimo utilizzo (per caricare il CSV più recente)
CREATE INDEX idx_user_csv_metadata_last_used ON public.user_csv_metadata(user_id, last_used DESC);

-- Indice per ricerca per nome CSV
CREATE INDEX idx_user_csv_metadata_csv_name ON public.user_csv_metadata(user_id, csv_name);

-- 4. ROW LEVEL SECURITY (RLS)
-- Abilita RLS per sicurezza
ALTER TABLE public.user_csv_metadata ENABLE ROW LEVEL SECURITY;

-- Policy: Gli utenti possono vedere solo i propri CSV
CREATE POLICY "Users can view their own CSV metadata" 
ON public.user_csv_metadata
FOR SELECT 
USING (auth.uid() = user_id);

-- Policy: Gli utenti possono inserire solo i propri CSV
CREATE POLICY "Users can insert their own CSV metadata" 
ON public.user_csv_metadata
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Policy: Gli utenti possono aggiornare solo i propri CSV
CREATE POLICY "Users can update their own CSV metadata" 
ON public.user_csv_metadata
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Policy: Gli utenti possono cancellare solo i propri CSV
CREATE POLICY "Users can delete their own CSV metadata" 
ON public.user_csv_metadata
FOR DELETE 
USING (auth.uid() = user_id);

-- 5. GRANT PERMISSIONS
-- Assicura che gli utenti autenticati abbiano i permessi necessari
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_csv_metadata TO authenticated;

-- =================================================================
-- QUERY DI VERIFICA
-- =================================================================
-- Dopo aver eseguito le query sopra, puoi verificare che tutto sia configurato correttamente:

-- Verifica creazione tabella
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'user_csv_metadata' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verifica indici
SELECT 
    indexname, 
    indexdef
FROM pg_indexes 
WHERE tablename = 'user_csv_metadata' 
  AND schemaname = 'public';

-- Verifica RLS abilitato
SELECT 
    schemaname, 
    tablename, 
    rowsecurity
FROM pg_tables 
WHERE tablename = 'user_csv_metadata' 
  AND schemaname = 'public';

-- Verifica policies
SELECT 
    policyname, 
    cmd, 
    qual, 
    with_check
FROM pg_policies 
WHERE tablename = 'user_csv_metadata' 
  AND schemaname = 'public';

-- =================================================================
-- NOTE IMPORTANTI
-- =================================================================
-- 1. Questa tabella è essenziale per il sistema di cache cleanup
-- 2. Senza di essa, i CSV non verranno salvati/ripristinati automaticamente
-- 3. Le RLS policies garantiscono la privacy tra utenti diversi
-- 4. Gli indici ottimizzano le performance per il caricamento dell'ultimo CSV usato
-- =================================================================