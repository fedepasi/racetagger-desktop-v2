-- ====================================
-- MIGRATION: Aggiunta Folder Organization per Participant Presets
-- Eseguire in Supabase SQL Editor
-- ====================================

-- 1. Aggiungi colonne folder_1, folder_2, folder_3 alla tabella preset_participants
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS folder_1 TEXT,
ADD COLUMN IF NOT EXISTS folder_2 TEXT,
ADD COLUMN IF NOT EXISTS folder_3 TEXT;

-- 2. Aggiungi colonna custom_folders alla tabella participant_presets per salvare la lista di folder custom
ALTER TABLE participant_presets
ADD COLUMN IF NOT EXISTS custom_folders JSONB DEFAULT '[]'::jsonb;

-- 3. Commenti sulle nuove colonne per documentazione
COMMENT ON COLUMN preset_participants.folder_1 IS 'Prima cartella di organizzazione personalizzata';
COMMENT ON COLUMN preset_participants.folder_2 IS 'Seconda cartella di organizzazione personalizzata (sotto-cartella di folder_1)';
COMMENT ON COLUMN preset_participants.folder_3 IS 'Terza cartella di organizzazione personalizzata (sotto-cartella di folder_2)';
COMMENT ON COLUMN participant_presets.custom_folders IS 'Array di nomi custom folder definite dall utente per questo preset';

-- 4. Crea indici per performance sulle nuove colonne folder
CREATE INDEX IF NOT EXISTS idx_preset_participants_folder_1 ON preset_participants(folder_1) WHERE folder_1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_preset_participants_folder_2 ON preset_participants(folder_2) WHERE folder_2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_preset_participants_folder_3 ON preset_participants(folder_3) WHERE folder_3 IS NOT NULL;

-- ====================================
-- FINE MIGRATION
-- Le colonne folder_1, folder_2, folder_3 sono ora disponibili
-- Default behavior: se tutte le colonne folder sono NULL, la folder sarà uguale al 'numero'
-- ====================================
