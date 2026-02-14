-- Migration: Fix pre_authorize_tokens to include ALL token sources
-- Bug: RPC only checked user_tokens.tokens_purchased - tokens_used,
--       ignoring subscribers.earned_tokens, subscribers.admin_bonus_tokens,
--       and approved token_requests. Dashboard showed correct balance but
--       processing failed with INSUFFICIENT_TOKENS.
-- Fix: Calculate available tokens using same logic as getTokenBalance() in auth-service.ts
-- Date: 2026-02-14

CREATE OR REPLACE FUNCTION pre_authorize_tokens(
  p_user_id UUID,
  p_tokens_needed INTEGER,
  p_batch_id TEXT,
  p_image_count INTEGER,          -- Per calcolo TTL dinamico
  p_visual_tagging BOOLEAN DEFAULT FALSE
) RETURNS JSONB AS $$
DECLARE
  v_tokens_purchased NUMERIC;
  v_tokens_used NUMERIC;
  v_earned_tokens INTEGER;
  v_admin_bonus_tokens INTEGER;
  v_approved_requests NUMERIC;
  v_total_tokens NUMERIC;
  v_available NUMERIC;
  v_user_email TEXT;
  v_reservation_id UUID;
  v_ttl_minutes INTEGER;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Calcola TTL dinamico: max(30 min, min(12h, images * 3sec / 60))
  v_ttl_minutes := GREATEST(30, LEAST(720, CEIL(p_image_count * 3.0 / 60)));
  v_expires_at := NOW() + (v_ttl_minutes || ' minutes')::INTERVAL;

  -- Lock user_tokens row per evitare race conditions
  SELECT tokens_purchased, tokens_used INTO v_tokens_purchased, v_tokens_used
  FROM user_tokens
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_tokens_purchased IS NULL THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'error', 'USER_NOT_FOUND',
      'available', 0,
      'needed', p_tokens_needed
    );
  END IF;

  -- Get user email for subscribers lookup
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = p_user_id;

  -- Get additional token sources from subscribers (earned_tokens, admin_bonus_tokens)
  SELECT
    COALESCE(s.earned_tokens, 0),
    COALESCE(s.admin_bonus_tokens, 0)
  INTO v_earned_tokens, v_admin_bonus_tokens
  FROM subscribers s
  WHERE s.email = LOWER(v_user_email);

  -- If no subscriber row found, default to 0
  IF v_earned_tokens IS NULL THEN
    v_earned_tokens := 0;
    v_admin_bonus_tokens := 0;
  END IF;

  -- Get approved token requests
  SELECT COALESCE(SUM(tokens_requested), 0) INTO v_approved_requests
  FROM token_requests
  WHERE user_id = p_user_id
    AND status IN ('approved', 'completed');

  -- Calculate total available (same formula as getTokenBalance in auth-service.ts)
  v_total_tokens := v_tokens_purchased + v_earned_tokens + v_admin_bonus_tokens + v_approved_requests;
  v_available := v_total_tokens - v_tokens_used;

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

  -- Scala temporaneamente (prenotazione)
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
