-- Abilita l'estensione uuid-ossp se non già abilitata (necessaria per uuid_generate_v4())
-- Potrebbe essere necessario eseguirla separatamente o verificare se è già attiva nel tuo progetto Supabase.
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabella: projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  base_csv_storage_path TEXT, -- Percorso al file CSV in Supabase Storage
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Commenti per la tabella projects
COMMENT ON TABLE public.projects IS 'Tabella per memorizzare i progetti degli utenti.';
COMMENT ON COLUMN public.projects.id IS 'Identificativo univoco del progetto (UUID).';
COMMENT ON COLUMN public.projects.user_id IS 'ID dell''utente proprietario del progetto (foreign key a auth.users).';
COMMENT ON COLUMN public.projects.name IS 'Nome del progetto.';
COMMENT ON COLUMN public.projects.base_csv_storage_path IS 'Percorso del file CSV base associato al progetto in Supabase Storage.';
COMMENT ON COLUMN public.projects.created_at IS 'Timestamp di creazione del progetto.';
COMMENT ON COLUMN public.projects.updated_at IS 'Timestamp dell''ultimo aggiornamento del progetto.';

-- Vincolo di unicità per nome progetto per utente
ALTER TABLE public.projects
ADD CONSTRAINT unique_project_name_for_user UNIQUE (user_id, name);

-- Tabella: executions
CREATE TABLE public.executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL, -- Denormalizzato per RLS più semplice e per tracciamento
  name TEXT NOT NULL,
  specific_csv_storage_path TEXT, -- Percorso al file CSV specifico per l'esecuzione in Supabase Storage
  execution_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  status TEXT, -- Esempi: 'pending', 'running', 'completed', 'failed'
  results_reference TEXT, -- Potrebbe essere un JSON con i risultati o un riferimento ad essi
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Commenti per la tabella executions
COMMENT ON TABLE public.executions IS 'Tabella per memorizzare le esecuzioni (batch di analisi) associate ai progetti.';
COMMENT ON COLUMN public.executions.id IS 'Identificativo univoco dell''esecuzione (UUID).';
COMMENT ON COLUMN public.executions.project_id IS 'ID del progetto a cui questa esecuzione appartiene (foreign key a projects).';
COMMENT ON COLUMN public.executions.user_id IS 'ID dell''utente proprietario dell''esecuzione (foreign key a auth.users).';
COMMENT ON COLUMN public.executions.name IS 'Nome dell''esecuzione (es. "Gara 1 - Monza").';
COMMENT ON COLUMN public.executions.specific_csv_storage_path IS 'Percorso del file CSV specifico per questa esecuzione in Supabase Storage (se diverso da quello del progetto).';
COMMENT ON COLUMN public.executions.execution_at IS 'Timestamp di quando l''esecuzione è stata avviata o schedulata.';
COMMENT ON COLUMN public.executions.status IS 'Stato corrente dell''esecuzione.';
COMMENT ON COLUMN public.executions.results_reference IS 'Riferimento ai risultati dell''analisi (es. JSON, percorso file).';
COMMENT ON COLUMN public.executions.created_at IS 'Timestamp di creazione del record dell''esecuzione.';
COMMENT ON COLUMN public.executions.updated_at IS 'Timestamp dell''ultimo aggiornamento del record dell''esecuzione.';

-- Funzione per aggiornare automaticamente il campo updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = timezone('utc'::text, now());
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per la tabella 'projects' per aggiornare 'updated_at'
CREATE TRIGGER update_projects_updated_at_trigger
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger per la tabella 'executions' per aggiornare 'updated_at'
CREATE TRIGGER update_executions_updated_at_trigger
BEFORE UPDATE ON public.executions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Abilitazione Row Level Security (RLS) per le tabelle
-- Le policy specifiche dovranno essere create tramite l'interfaccia di Supabase o comandi SQL separati.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

-- Indici consigliati (opzionali, ma utili per le performance)
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_project_id ON public.executions(project_id);
CREATE INDEX IF NOT EXISTS idx_executions_user_id ON public.executions(user_id);

-- Messaggio di completamento
SELECT 'Script SQL per la creazione delle tabelle projects ed executions completato.';
SELECT 'Ricorda di impostare le policy di Row Level Security (RLS) per entrambe le tabelle dall''interfaccia di Supabase.';
SELECT 'Inoltre, crea un bucket in Supabase Storage (es. "project_files") e configura le relative policy di accesso.';
