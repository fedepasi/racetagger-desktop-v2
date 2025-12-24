-- Migration: Change token columns from INTEGER to NUMERIC(10,2)
-- Purpose: Support fractional token costs (e.g., 0.5 for visual tagging)
-- Date: 2025-12-24

-- ============================================================================
-- STEP 1: Alter table columns from INTEGER to NUMERIC(10,2)
-- ============================================================================

ALTER TABLE user_tokens
  ALTER COLUMN tokens_purchased TYPE NUMERIC(10,2) USING tokens_purchased::NUMERIC(10,2),
  ALTER COLUMN tokens_used TYPE NUMERIC(10,2) USING tokens_used::NUMERIC(10,2);

-- Set default values
ALTER TABLE user_tokens
  ALTER COLUMN tokens_purchased SET DEFAULT 0,
  ALTER COLUMN tokens_used SET DEFAULT 0;

COMMENT ON COLUMN user_tokens.tokens_purchased IS 'Total tokens purchased by user (supports decimals for granular pricing)';
COMMENT ON COLUMN user_tokens.tokens_used IS 'Total tokens consumed by user (supports decimals, e.g., 0.5 for visual tagging)';

-- ============================================================================
-- STEP 2: Recreate increment_user_tokens function with NUMERIC parameter
-- Note: Parameter names match those used in auth-service.ts RPC call
-- ============================================================================

DROP FUNCTION IF EXISTS increment_user_tokens(uuid, integer);
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
  new_purchased numeric;
  current_used numeric;
BEGIN
  RAISE NOTICE 'increment_user_tokens: Adding % tokens to user %', p_increment_amount, p_user_id;

  -- Try to update existing record
  UPDATE user_tokens
  SET tokens_purchased = COALESCE(tokens_purchased, 0) + p_increment_amount
  WHERE user_tokens.user_id = increment_user_tokens.p_user_id
  RETURNING tokens_purchased, tokens_used INTO new_purchased, current_used;

  -- If no row was updated, record doesn't exist
  IF new_purchased IS NULL THEN
    RAISE NOTICE 'increment_user_tokens: Creating new user_tokens record for user %', p_user_id;

    INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
    VALUES (increment_user_tokens.p_user_id, p_increment_amount, 0)
    RETURNING tokens_purchased, tokens_used INTO new_purchased, current_used;
  END IF;

  RAISE NOTICE 'increment_user_tokens: Success - purchased: %, used: %, remaining: %',
    new_purchased, current_used, (new_purchased - current_used);

  RETURN json_build_object(
    'success', true,
    'new_balance', new_purchased,
    'tokens_used', current_used,
    'remaining', new_purchased - current_used,
    'tokens_added', p_increment_amount
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: Recreate add_tokens_to_profile function with NUMERIC parameter
-- ============================================================================

DROP FUNCTION IF EXISTS add_tokens_to_profile(uuid, integer);
DROP FUNCTION IF EXISTS add_tokens_to_profile(uuid, numeric);

CREATE OR REPLACE FUNCTION add_tokens_to_profile(
  profile_id uuid,
  token_amount numeric
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'add_tokens_to_profile: Delegating to increment_user_tokens for user %', profile_id;
  -- Call with named parameters matching the new signature
  RETURN increment_user_tokens(p_user_id := profile_id, p_increment_amount := token_amount);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: Recreate get_user_token_balance function with NUMERIC return
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_token_balance(uuid);

CREATE OR REPLACE FUNCTION get_user_token_balance(
  user_id uuid
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purchased numeric;
  used numeric;
BEGIN
  SELECT COALESCE(tokens_purchased, 0), COALESCE(tokens_used, 0)
  INTO purchased, used
  FROM user_tokens
  WHERE user_tokens.user_id = get_user_token_balance.user_id;

  -- If record doesn't exist, return zero balance
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

-- ============================================================================
-- STEP 5: Recreate consume_tokens_for_analysis function with NUMERIC parameter
-- ============================================================================

DROP FUNCTION IF EXISTS consume_tokens_for_analysis(text, integer);
DROP FUNCTION IF EXISTS consume_tokens_for_analysis(text, numeric);

CREATE OR REPLACE FUNCTION consume_tokens_for_analysis(
  p_user_email text,
  p_tokens_to_consume numeric DEFAULT 1
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_uuid uuid;
  current_purchased numeric;
  current_used numeric;
  available_balance numeric;
BEGIN
  -- Get user ID from email
  SELECT id INTO user_uuid
  FROM auth.users
  WHERE email = p_user_email;

  -- If user not found, return error
  IF user_uuid IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found with email: ' || p_user_email
    );
  END IF;

  -- Get current token balance
  SELECT COALESCE(tokens_purchased, 0), COALESCE(tokens_used, 0)
  INTO current_purchased, current_used
  FROM user_tokens
  WHERE user_id = user_uuid;

  -- If no record exists, create one with 0 balance
  IF current_purchased IS NULL THEN
    INSERT INTO user_tokens (user_id, user_email, tokens_purchased, tokens_used)
    VALUES (user_uuid, p_user_email, 0, 0);
    current_purchased := 0;
    current_used := 0;
  END IF;

  available_balance := current_purchased - current_used;

  -- Check if user has enough tokens
  IF available_balance < p_tokens_to_consume THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient tokens',
      'available_balance', available_balance,
      'tokens_requested', p_tokens_to_consume
    );
  END IF;

  -- Consume the tokens by updating tokens_used
  UPDATE user_tokens
  SET tokens_used = tokens_used + p_tokens_to_consume,
      updated_at = now()
  WHERE user_id = user_uuid;

  -- Return success with updated balance
  RETURN json_build_object(
    'success', true,
    'tokens_consumed', p_tokens_to_consume,
    'previous_balance', available_balance,
    'new_balance', available_balance - p_tokens_to_consume
  );
END;
$$ LANGUAGE plpgsql;

