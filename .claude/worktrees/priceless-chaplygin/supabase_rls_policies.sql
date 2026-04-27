-- Policy RLS per la tabella 'projects'

-- Abilita RLS sulla tabella (se non già fatto dallo script precedente)
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Policy per SELECT: Permette agli utenti di vedere solo i propri progetti.
CREATE POLICY "Allow authenticated users to select their own projects"
ON public.projects
FOR SELECT
USING (auth.uid() = user_id);

-- Policy per INSERT: Permette agli utenti autenticati di inserire nuovi progetti per se stessi.
CREATE POLICY "Allow authenticated users to insert their own projects"
ON public.projects
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy per UPDATE: Permette agli utenti di aggiornare solo i propri progetti.
CREATE POLICY "Allow authenticated users to update their own projects"
ON public.projects
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id); -- Aggiunto WITH CHECK anche qui per coerenza

-- Policy per DELETE: Permette agli utenti di cancellare solo i propri progetti.
CREATE POLICY "Allow authenticated users to delete their own projects"
ON public.projects
FOR DELETE
USING (auth.uid() = user_id);

--------------------------------------------------------------------------------

-- Policy RLS per la tabella 'executions'

-- Abilita RLS sulla tabella (se non già fatto dallo script precedente)
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

-- Policy per SELECT: Permette agli utenti di vedere solo le proprie esecuzioni.
CREATE POLICY "Allow authenticated users to select their own executions"
ON public.executions
FOR SELECT
USING (auth.uid() = user_id);

-- Policy per INSERT: Permette agli utenti autenticati di inserire nuove esecuzioni per se stessi.
CREATE POLICY "Allow authenticated users to insert their own executions"
ON public.executions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy per UPDATE: Permette agli utenti di aggiornare solo le proprie esecuzioni.
CREATE POLICY "Allow authenticated users to update their own executions"
ON public.executions
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id); -- Aggiunto WITH CHECK anche qui per coerenza

-- Policy per DELETE: Permette agli utenti di cancellare solo le proprie esecuzioni.
CREATE POLICY "Allow authenticated users to delete their own executions"
ON public.executions
FOR DELETE
USING (auth.uid() = user_id);

--------------------------------------------------------------------------------

SELECT 'Script SQL per la creazione delle policy RLS completato.';
SELECT 'Ricorda di configurare anche le policy di sicurezza per il bucket di Storage ''project-files'' dall''interfaccia di Supabase.';
