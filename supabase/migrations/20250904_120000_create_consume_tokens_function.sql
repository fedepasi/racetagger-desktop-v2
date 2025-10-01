-- Create consume_tokens_for_analysis function that the Edge Function needs

CREATE OR REPLACE FUNCTION consume_tokens_for_analysis(
  p_user_email text,
  p_tokens_to_consume integer DEFAULT 1
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_uuid uuid;
  current_purchased integer;
  current_used integer;
  available_balance integer;
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