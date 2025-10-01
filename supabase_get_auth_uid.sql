-- Funzione per ottenere l'ID utente corrente (auth.uid())
CREATE OR REPLACE FUNCTION public.get_auth_uid()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN auth.uid()::text;
END;
$$;

-- Concedi l'accesso alla funzione a tutti gli utenti autenticati
GRANT EXECUTE ON FUNCTION public.get_auth_uid() TO authenticated;
