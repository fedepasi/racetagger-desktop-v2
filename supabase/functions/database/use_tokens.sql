-- Funzione per utilizzare i token da un account utente
-- Questa funzione decrementa il contatore dei token utilizzati e restituisce true se l'operazione è riuscita
CREATE OR REPLACE FUNCTION use_tokens(p_user_id UUID, p_token_count INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tokens_remaining INTEGER;
BEGIN
    -- Verifica che l'ID utente sia valido
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'ID utente non può essere NULL';
        RETURN FALSE;
    END IF;

    -- Verifica che il numero di token sia valido
    IF p_token_count <= 0 THEN
        RAISE EXCEPTION 'Il numero di token deve essere maggiore di zero';
        RETURN FALSE;
    END IF;

    -- Controlla il bilancio tokens dell'utente
    SELECT (tokens_purchased - tokens_used) INTO v_tokens_remaining
    FROM user_tokens
    WHERE user_id = p_user_id;

    -- Se non ci sono record o tokens insufficienti
    IF v_tokens_remaining IS NULL THEN
        RAISE EXCEPTION 'Nessun bilancio token trovato per questo utente';
        RETURN FALSE;
    END IF;

    IF v_tokens_remaining < p_token_count THEN
        RAISE EXCEPTION 'Token insufficienti: % richiesti, % disponibili', p_token_count, v_tokens_remaining;
        RETURN FALSE;
    END IF;

    -- Aggiorna il contatore dei token utilizzati
    UPDATE user_tokens
    SET tokens_used = tokens_used + p_token_count,
        last_updated = NOW()
    WHERE user_id = p_user_id;

    -- Operazione completata con successo
    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Errore durante l''utilizzo dei token: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- Concedi i permessi per eseguire la funzione
GRANT EXECUTE ON FUNCTION use_tokens(UUID, INTEGER) TO authenticated;
