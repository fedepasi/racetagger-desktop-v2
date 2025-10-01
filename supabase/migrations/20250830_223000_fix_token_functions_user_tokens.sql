-- Rimuoviamo le funzioni esistenti che usano la tabella profiles
DROP FUNCTION IF EXISTS increment_user_tokens(uuid, integer);
DROP FUNCTION IF EXISTS add_tokens_to_profile(uuid, integer);
DROP FUNCTION IF EXISTS get_user_token_balance(uuid);

-- Rimuoviamo la tabella profiles che non serve
DROP TABLE IF EXISTS profiles;

-- Funzione principale per incrementare i token dell'utente nella tabella user_tokens
CREATE OR REPLACE FUNCTION increment_user_tokens(
  user_id uuid,
  token_amount integer
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_purchased integer;
  current_used integer;
BEGIN
  -- Log dell'operazione
  RAISE NOTICE 'increment_user_tokens: Adding % tokens to user %', token_amount, user_id;
  
  -- Tenta update del record esistente
  UPDATE user_tokens 
  SET tokens_purchased = COALESCE(tokens_purchased, 0) + token_amount
  WHERE user_tokens.user_id = increment_user_tokens.user_id
  RETURNING tokens_purchased, tokens_used INTO new_purchased, current_used;
  
  -- Se nessuna riga è stata aggiornata, il record non esiste
  IF new_purchased IS NULL THEN
    RAISE NOTICE 'increment_user_tokens: Creating new user_tokens record for user %', user_id;
    
    -- Inserisci nuovo record con token iniziali
    INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
    VALUES (increment_user_tokens.user_id, token_amount, 0)
    RETURNING tokens_purchased, tokens_used INTO new_purchased, current_used;
  END IF;
  
  RAISE NOTICE 'increment_user_tokens: Success - purchased: %, used: %, remaining: %', 
    new_purchased, current_used, (new_purchased - current_used);
  
  RETURN json_build_object(
    'success', true,
    'new_balance', new_purchased,
    'tokens_used', current_used,
    'remaining', new_purchased - current_used,
    'tokens_added', token_amount
  );
END;
$$ LANGUAGE plpgsql;

-- Funzione di fallback per aggiungere token (compatibilità con Edge Function)
CREATE OR REPLACE FUNCTION add_tokens_to_profile(
  profile_id uuid,
  token_amount integer
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delega alla funzione principale
  RETURN increment_user_tokens(profile_id, token_amount);
END;
$$ LANGUAGE plpgsql;

-- Funzione di utilità per ottenere il bilancio token corrente
CREATE OR REPLACE FUNCTION get_user_token_balance(
  user_id uuid
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purchased integer;
  used integer;
BEGIN
  SELECT COALESCE(tokens_purchased, 0), COALESCE(tokens_used, 0)
  INTO purchased, used
  FROM user_tokens
  WHERE user_tokens.user_id = get_user_token_balance.user_id;
  
  -- Se il record non esiste, restituisci balance zero
  IF purchased IS NULL THEN
    purchased := 0;
    used := 0;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'tokens_purchased', purchased,
    'tokens_used', used,
    'remaining', purchased - used
  );
END;
$$ LANGUAGE plpgsql;