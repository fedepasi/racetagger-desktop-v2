-- Migration: Fix token consumption logic
-- Purpose: Separate CONSUMPTION (increment tokens_used) from PURCHASE (increment tokens_purchased)
-- Date: 2025-12-30
-- Bug: increment_user_tokens was updating tokens_purchased instead of tokens_used for consumption

-- ============================================================================
-- Fix 1: increment_user_tokens - Now updates tokens_used (for CONSUMPTION)
-- Called by: v1.0.10 desktop app to consume tokens during analysis
-- ============================================================================

DROP FUNCTION IF EXISTS increment_user_tokens(uuid, numeric);

CREATE OR REPLACE FUNCTION increment_user_tokens(
  p_user_id uuid,
  p_increment_amount numeric
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_purchased numeric;
  new_used numeric;
BEGIN
  RAISE NOTICE 'increment_user_tokens: CONSUMING % tokens from user %', p_increment_amount, p_user_id;

  -- Get current values
  SELECT COALESCE(tokens_purchased, 0), COALESCE(tokens_used, 0)
  INTO current_purchased, new_used
  FROM user_tokens
  WHERE user_id = p_user_id;

  -- If no record exists, create one
  IF current_purchased IS NULL THEN
    INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
    VALUES (p_user_id, 0, p_increment_amount)
    RETURNING tokens_purchased, tokens_used INTO current_purchased, new_used;
  ELSE
    -- FIX: Update tokens_used (NOT tokens_purchased!)
    new_used := new_used + p_increment_amount;
    UPDATE user_tokens
    SET tokens_used = new_used,
        last_updated = now()
    WHERE user_id = p_user_id;
  END IF;

  RAISE NOTICE 'increment_user_tokens: Success - purchased: %, used: %, remaining: %',
    current_purchased, new_used, (current_purchased - new_used);

  RETURN json_build_object(
    'success', true,
    'new_balance', current_purchased,
    'tokens_used', new_used,
    'remaining', current_purchased - new_used,
    'tokens_consumed', p_increment_amount
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Fix 2: add_tokens_to_profile - Directly updates tokens_purchased (for PURCHASE)
-- Called by: handle-token-request edge function when admin approves tokens
-- No longer delegates to increment_user_tokens to avoid confusion
-- ============================================================================

DROP FUNCTION IF EXISTS add_tokens_to_profile(uuid, numeric);

CREATE OR REPLACE FUNCTION add_tokens_to_profile(
  profile_id uuid,
  token_amount numeric
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_purchased numeric;
  current_used numeric;
BEGIN
  RAISE NOTICE 'add_tokens_to_profile: ADDING % purchased tokens to user %', token_amount, profile_id;

  -- Try to update existing record
  UPDATE user_tokens
  SET tokens_purchased = COALESCE(tokens_purchased, 0) + token_amount,
      last_updated = now()
  WHERE user_id = profile_id
  RETURNING tokens_purchased, tokens_used INTO new_purchased, current_used;

  -- If no row was updated, insert new record
  IF new_purchased IS NULL THEN
    INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
    VALUES (profile_id, token_amount, 0)
    RETURNING tokens_purchased, tokens_used INTO new_purchased, current_used;
  END IF;

  RAISE NOTICE 'add_tokens_to_profile: Success - purchased: %, used: %, remaining: %',
    new_purchased, COALESCE(current_used, 0), (new_purchased - COALESCE(current_used, 0));

  RETURN json_build_object(
    'success', true,
    'new_balance', new_purchased,
    'tokens_used', COALESCE(current_used, 0),
    'remaining', new_purchased - COALESCE(current_used, 0),
    'tokens_added', token_amount
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION increment_user_tokens(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_user_tokens(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION add_tokens_to_profile(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION add_tokens_to_profile(uuid, numeric) TO service_role;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON FUNCTION increment_user_tokens IS
'CONSUMES tokens by incrementing tokens_used. Used by desktop app (v1.0.10+) for AI analysis token deduction.';

COMMENT ON FUNCTION add_tokens_to_profile IS
'ADDS purchased tokens by incrementing tokens_purchased. Used by handle-token-request when admin approves tokens.';
