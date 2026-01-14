-- Migration: Sistema Pre-autorizzazione Token Batch (v1.1.0+)
-- Descrizione: Crea tabella e RPC per pre-autorizzazione token batch
-- Data: 2025-12-30

-- ============================================================================
-- TABELLA: batch_token_reservations
-- ============================================================================

CREATE TABLE IF NOT EXISTS batch_token_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,           -- = execution_id per conteggio da DB
  tokens_reserved INTEGER NOT NULL,
  tokens_consumed INTEGER DEFAULT 0,
  tokens_refunded INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  metadata JSONB,

  CONSTRAINT valid_status CHECK (status IN ('pending', 'finalized', 'auto_finalized', 'expired'))
);

-- Index per cleanup automatico (partial index su reservation scadute pending)
CREATE INDEX IF NOT EXISTS idx_reservations_expires
  ON batch_token_reservations(expires_at)
  WHERE status = 'pending';

-- Index per lookup veloce per user + batch
CREATE INDEX IF NOT EXISTS idx_reservations_user_batch
  ON batch_token_reservations(user_id, batch_id);

-- Index per query utente per status
CREATE INDEX IF NOT EXISTS idx_reservations_user_status
  ON batch_token_reservations(user_id, status);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE batch_token_reservations ENABLE ROW LEVEL SECURITY;

-- Users can view their own reservations
CREATE POLICY "Users can view own reservations"
  ON batch_token_reservations FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own reservations
CREATE POLICY "Users can insert own reservations"
  ON batch_token_reservations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending reservations
CREATE POLICY "Users can update own pending reservations"
  ON batch_token_reservations FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

-- ============================================================================
-- RPC: pre_authorize_tokens
-- Pre-autorizza token per un batch, bloccandoli temporaneamente
-- ============================================================================

CREATE OR REPLACE FUNCTION pre_authorize_tokens(
  p_user_id UUID,
  p_tokens_needed INTEGER,
  p_batch_id TEXT,
  p_image_count INTEGER,          -- Per calcolo TTL dinamico
  p_visual_tagging BOOLEAN DEFAULT FALSE
) RETURNS JSONB AS $$
DECLARE
  v_available NUMERIC;
  v_reservation_id UUID;
  v_ttl_minutes INTEGER;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Calcola TTL dinamico: max(30 min, min(12h, images * 3sec / 60))
  v_ttl_minutes := GREATEST(30, LEAST(720, CEIL(p_image_count * 3.0 / 60)));
  v_expires_at := NOW() + (v_ttl_minutes || ' minutes')::INTERVAL;

  -- Lock row per evitare race conditions
  SELECT (tokens_purchased - tokens_used) INTO v_available
  FROM user_tokens
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_available IS NULL THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'error', 'USER_NOT_FOUND',
      'available', 0,
      'needed', p_tokens_needed
    );
  END IF;

  IF v_available < p_tokens_needed THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'error', 'INSUFFICIENT_TOKENS',
      'available', v_available::INTEGER,
      'needed', p_tokens_needed
    );
  END IF;

  -- Crea reservation
  INSERT INTO batch_token_reservations (
    user_id, batch_id, tokens_reserved, expires_at,
    metadata
  ) VALUES (
    p_user_id, p_batch_id, p_tokens_needed, v_expires_at,
    jsonb_build_object(
      'imageCount', p_image_count,
      'visualTagging', p_visual_tagging,
      'ttlMinutes', v_ttl_minutes
    )
  ) RETURNING id INTO v_reservation_id;

  -- Scala temporaneamente (prenotazione) - tokens_used e' numeric
  UPDATE user_tokens
  SET tokens_used = tokens_used + p_tokens_needed,
      last_updated = NOW()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'authorized', true,
    'reservationId', v_reservation_id,
    'tokensReserved', p_tokens_needed,
    'expiresAt', v_expires_at,
    'ttlMinutes', v_ttl_minutes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: finalize_token_reservation
-- Finalizza una reservation, calcolando token effettivi e rimborso
-- ============================================================================

CREATE OR REPLACE FUNCTION finalize_token_reservation(
  p_reservation_id UUID,
  p_actual_usage JSONB  -- {processed, emptyResults, errors, cancelled}
) RETURNS JSONB AS $$
DECLARE
  v_reservation RECORD;
  v_tokens_to_consume INTEGER;
  v_tokens_to_refund INTEGER;
  v_new_balance NUMERIC;
BEGIN
  -- Get and lock reservation
  SELECT * INTO v_reservation
  FROM batch_token_reservations
  WHERE id = p_reservation_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'RESERVATION_NOT_FOUND');
  END IF;

  -- Calcola token effettivi (FASE 1: solo errors rimborsati)
  -- processed - errors = token effettivamente consumati
  -- emptyResults tracciato ma NON rimborsato in FASE 1
  v_tokens_to_consume := GREATEST(0,
    COALESCE((p_actual_usage->>'processed')::INTEGER, 0)
    - COALESCE((p_actual_usage->>'errors')::INTEGER, 0)
  );

  v_tokens_to_refund := v_reservation.tokens_reserved - v_tokens_to_consume;

  -- Aggiorna reservation
  UPDATE batch_token_reservations
  SET status = 'finalized',
      tokens_consumed = v_tokens_to_consume,
      tokens_refunded = v_tokens_to_refund,
      finalized_at = NOW(),
      metadata = COALESCE(metadata, '{}'::jsonb) || p_actual_usage
  WHERE id = p_reservation_id;

  -- Rimborsa token non usati (tokens_used e' numeric)
  UPDATE user_tokens
  SET tokens_used = tokens_used - v_tokens_to_refund,
      last_updated = NOW()
  WHERE user_id = v_reservation.user_id
  RETURNING (tokens_purchased - tokens_used) INTO v_new_balance;

  -- Log transaction (usa 'usage' come transaction_type standard da DATABASE.md)
  INSERT INTO token_transactions (user_id, amount, transaction_type, description)
  VALUES (
    v_reservation.user_id,
    -v_tokens_to_consume,
    'usage',
    format('Batch %s: %s consumed, %s refunded',
           v_reservation.batch_id, v_tokens_to_consume, v_tokens_to_refund)
  );

  RETURN jsonb_build_object(
    'success', true,
    'consumed', v_tokens_to_consume,
    'refunded', v_tokens_to_refund,
    'newBalance', v_new_balance::INTEGER
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: cleanup_expired_reservations
-- Job di cleanup per reservation scadute - conta immagini da DB
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS TABLE(
  reservation_id UUID,
  processed_count INTEGER,
  consumed INTEGER,
  refunded INTEGER
) AS $$
DECLARE
  r RECORD;
  v_processed_count INTEGER;
  v_to_consume INTEGER;
  v_to_refund INTEGER;
BEGIN
  -- Per ogni reservation scaduta
  FOR r IN
    SELECT * FROM batch_token_reservations
    WHERE status = 'pending' AND expires_at < NOW()
    FOR UPDATE SKIP LOCKED  -- Evita deadlock se piu job paralleli
  LOOP
    -- Conta immagini EFFETTIVAMENTE processate
    -- batch_id corrisponde a execution_id in images
    SELECT COUNT(*) INTO v_processed_count
    FROM analysis_results ar
    JOIN images i ON ar.image_id = i.id
    WHERE i.execution_id = r.batch_id::UUID
      AND i.user_id = r.user_id;

    -- Calcola token da consumare (min tra processate e riservate)
    v_to_consume := LEAST(v_processed_count, r.tokens_reserved);
    v_to_refund := r.tokens_reserved - v_to_consume;

    -- Rimborsa la differenza
    IF v_to_refund > 0 THEN
      UPDATE user_tokens
      SET tokens_used = tokens_used - v_to_refund,
          last_updated = NOW()
      WHERE user_id = r.user_id;
    END IF;

    -- Aggiorna reservation con dati reali
    UPDATE batch_token_reservations
    SET status = 'auto_finalized',
        tokens_consumed = v_to_consume,
        tokens_refunded = v_to_refund,
        finalized_at = NOW(),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'autoFinalizeReason', 'timeout_with_db_count',
          'countedFromDb', v_processed_count,
          'originalReserved', r.tokens_reserved,
          'cleanupTimestamp', NOW()
        )
    WHERE id = r.id;

    -- Log transaction (usa 'usage' come transaction_type standard)
    IF v_to_consume > 0 THEN
      INSERT INTO token_transactions (user_id, amount, transaction_type, description)
      VALUES (
        r.user_id,
        -v_to_consume,
        'usage',
        format('Auto-finalized batch %s after timeout: %s processed, %s refunded (cleanup)',
               r.batch_id, v_to_consume, v_to_refund)
      );
    END IF;

    -- Return row per monitoring
    reservation_id := r.id;
    processed_count := v_processed_count;
    consumed := v_to_consume;
    refunded := v_to_refund;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- CRON JOB: Scheduling cleanup ogni 5 minuti
-- Nota: pg_cron deve essere abilitato nel progetto Supabase
-- ============================================================================

-- Uncomment se pg_cron e' disponibile:
-- SELECT cron.schedule(
--   'cleanup-expired-reservations',
--   '*/5 * * * *',
--   'SELECT * FROM cleanup_expired_reservations()'
-- );

-- ============================================================================
-- GRANT per edge functions
-- ============================================================================

GRANT EXECUTE ON FUNCTION pre_authorize_tokens TO authenticated;
GRANT EXECUTE ON FUNCTION finalize_token_reservation TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_reservations TO service_role;

-- ============================================================================
-- COMMENTO sulla tabella
-- ============================================================================

COMMENT ON TABLE batch_token_reservations IS 'Pre-autorizzazione token batch per v1.1.0+. batch_id = execution_id per conteggio da DB.';
COMMENT ON COLUMN batch_token_reservations.batch_id IS 'Corrisponde a execution_id nella tabella images per permettere conteggio automatico';
COMMENT ON COLUMN batch_token_reservations.status IS 'pending = in corso, finalized = completato da client, auto_finalized = completato da cleanup, expired = scaduto senza elaborazione';
