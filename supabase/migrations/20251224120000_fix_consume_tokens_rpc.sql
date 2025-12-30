-- Migration: Fix token consumption RPC function
-- Purpose: Create consume_user_tokens function that correctly updates tokens_used
-- Date: 2025-12-24
-- Bug: increment_user_tokens was updating tokens_purchased instead of tokens_used

-- ============================================================================
-- Create consume_user_tokens function for desktop app token deduction
-- ============================================================================

DROP FUNCTION IF EXISTS consume_user_tokens(uuid, numeric);

CREATE OR REPLACE FUNCTION consume_user_tokens(
  p_user_id uuid,
  p_amount numeric
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_purchased numeric;
  current_used numeric;
  new_used numeric;
  available_balance numeric;
BEGIN
  RAISE NOTICE 'consume_user_tokens: Consuming % tokens from user %', p_amount, p_user_id;

  -- Get current token balance
  SELECT COALESCE(tokens_purchased, 0), COALESCE(tokens_used, 0)
  INTO current_purchased, current_used
  FROM user_tokens
  WHERE user_id = p_user_id;

  -- If no record exists, create one with 0 balance
  IF current_purchased IS NULL THEN
    INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
    VALUES (p_user_id, 0, 0);
    current_purchased := 0;
    current_used := 0;
  END IF;

  available_balance := current_purchased - current_used;

  -- Check if user has enough tokens
  IF available_balance < p_amount THEN
    RAISE NOTICE 'consume_user_tokens: Insufficient tokens (available: %, requested: %)', available_balance, p_amount;
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient tokens',
      'available_balance', available_balance,
      'tokens_requested', p_amount
    );
  END IF;

  -- Consume the tokens by incrementing tokens_used
  new_used := current_used + p_amount;

  UPDATE user_tokens
  SET tokens_used = new_used,
      last_updated = now()
  WHERE user_id = p_user_id;

  RAISE NOTICE 'consume_user_tokens: Success - purchased: %, used: % -> %, remaining: %',
    current_purchased, current_used, new_used, (current_purchased - new_used);

  RETURN json_build_object(
    'success', true,
    'tokens_consumed', p_amount,
    'tokens_purchased', current_purchased,
    'tokens_used', new_used,
    'remaining', current_purchased - new_used
  );
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION consume_user_tokens(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION consume_user_tokens(uuid, numeric) TO service_role;

COMMENT ON FUNCTION consume_user_tokens IS 'Consumes tokens by incrementing tokens_used (NOT tokens_purchased). Used by desktop app for AI analysis and visual tagging token deduction.';
