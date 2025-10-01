-- Rendere project_id opzionale nella tabella executions per supportare executions standalone
-- Questo consente di tracciare anche le analisi dalla pagina "analysis" senza dover creare progetti fittizi

ALTER TABLE executions 
ALTER COLUMN project_id DROP NOT NULL;

COMMENT ON COLUMN executions.project_id IS 'ID del progetto a cui questa esecuzione appartiene (foreign key a projects). Può essere NULL per executions standalone (analisi singole senza progetto).';

-- Verifica che il vincolo foreign key gestisca correttamente i valori NULL
-- (PostgreSQL gestisce automaticamente NULL nei foreign keys - sono sempre permessi)