-- Tabella per i piani di abbonamento
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  monthly_price NUMERIC(10,2) NOT NULL,
  annual_price NUMERIC(10,2) NOT NULL,
  tokens_included INTEGER NOT NULL,
  features JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per le sottoscrizioni degli utenti
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  end_date TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  auto_renew BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per il bilancio token degli utenti
CREATE TABLE IF NOT EXISTS user_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) UNIQUE,
  tokens_purchased INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per le transazioni di token
CREATE TABLE IF NOT EXISTS token_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  image_id UUID REFERENCES images(id),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Policy RLS per proteggere i dati
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_transactions ENABLE ROW LEVEL SECURITY;

-- Policy per subscription_plans (lettura pubblica, scrittura solo admin)
CREATE POLICY "Anyone can read subscription plans" ON subscription_plans
  FOR SELECT USING (true);

-- Policy per user_subscriptions (solo proprietario e admin)
CREATE POLICY "Users can read their own subscriptions" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Policy per user_tokens (solo proprietario e admin)
CREATE POLICY "Users can read their own token balance" ON user_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Policy per token_transactions (solo proprietario e admin)
CREATE POLICY "Users can read their own token transactions" ON token_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Funzione per l'utilizzo dei token
CREATE OR REPLACE FUNCTION use_tokens(p_user_id UUID, p_token_count INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    tokens_remaining INTEGER;
BEGIN
    -- Verifica i parametri
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID cannot be NULL';
        RETURN FALSE;
    END IF;

    IF p_token_count <= 0 THEN
        RAISE EXCEPTION 'Token count must be greater than zero';
        RETURN FALSE;
    END IF;

    -- Verifica se l'utente ha abbastanza token
    SELECT (tokens_purchased - tokens_used) INTO tokens_remaining
    FROM user_tokens
    WHERE user_id = p_user_id;

    IF tokens_remaining IS NULL THEN
        RAISE EXCEPTION 'User has no token balance record';
        RETURN FALSE;
    END IF;

    IF tokens_remaining < p_token_count THEN
        RAISE EXCEPTION 'Insufficient tokens: % available, % required', tokens_remaining, p_token_count;
        RETURN FALSE;
    END IF;

    -- Aggiorna il conteggio dei token utilizzati
    UPDATE user_tokens
    SET tokens_used = tokens_used + p_token_count,
        last_updated = NOW()
    WHERE user_id = p_user_id;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error using tokens: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- Funzione per aggiungere token
CREATE OR REPLACE FUNCTION add_tokens(p_user_id UUID, p_token_count INTEGER, p_description TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_token_record_exists BOOLEAN;
BEGIN
    -- Verifica i parametri
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID cannot be NULL';
        RETURN FALSE;
    END IF;

    IF p_token_count <= 0 THEN
        RAISE EXCEPTION 'Token count must be greater than zero';
        RETURN FALSE;
    END IF;

    -- Verifica se esiste già un record per l'utente
    SELECT EXISTS(
        SELECT 1 FROM user_tokens WHERE user_id = p_user_id
    ) INTO user_token_record_exists;

    -- Se non esiste, crea un nuovo record
    IF NOT user_token_record_exists THEN
        INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
        VALUES (p_user_id, p_token_count, 0);
    ELSE
        -- Altrimenti, aggiorna il record esistente
        UPDATE user_tokens
        SET tokens_purchased = tokens_purchased + p_token_count,
            last_updated = NOW()
        WHERE user_id = p_user_id;
    END IF;

    -- Registra la transazione
    INSERT INTO token_transactions (
        user_id,
        amount,
        transaction_type,
        description
    ) VALUES (
        p_user_id,
        p_token_count,
        'purchase',
        p_description
    );
    
    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error adding tokens: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- Concedi i permessi per eseguire le funzioni
GRANT EXECUTE ON FUNCTION use_tokens(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION add_tokens(UUID, INTEGER, TEXT) TO service_role;
