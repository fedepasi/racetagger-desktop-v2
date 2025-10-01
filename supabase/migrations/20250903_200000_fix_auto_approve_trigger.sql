-- Migration: Fix the auto-approve token requests trigger
-- The previous trigger had incorrect RPC function parameter order
-- This fixes the trigger to use the correct increment_user_tokens(token_amount, user_id) signature

-- First, drop the existing trigger and function
DROP TRIGGER IF EXISTS trigger_auto_approve_tokens ON token_requests;
DROP FUNCTION IF EXISTS handle_token_request_approval();

-- Create the corrected function with proper parameter order
CREATE OR REPLACE FUNCTION handle_token_request_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if status changed from something other than 'approved' to 'approved'
  IF OLD.status != 'approved' AND NEW.status = 'approved' THEN
    -- Add tokens to user's balance using existing RPC function with CORRECT parameter order
    -- Function signature is: increment_user_tokens(token_amount, user_id)
    PERFORM increment_user_tokens(NEW.tokens_requested, NEW.user_id);
    
    -- Update completion date
    NEW.completed_date = CURRENT_TIMESTAMP;
    
    -- Log the approval
    RAISE NOTICE 'Token request % approved: Added % tokens to user % using corrected RPC signature', 
      NEW.id, NEW.tokens_requested, NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the corrected trigger
CREATE TRIGGER trigger_auto_approve_tokens
  BEFORE UPDATE ON token_requests
  FOR EACH ROW
  EXECUTE FUNCTION handle_token_request_approval();

-- Add helpful comments
COMMENT ON FUNCTION handle_token_request_approval() IS 
'Automatically adds requested tokens to user balance when token_request status changes to approved (FIXED: uses correct RPC parameter order)';

COMMENT ON TRIGGER trigger_auto_approve_tokens ON token_requests IS 
'Triggers automatic token approval when status changes to approved (FIXED: uses correct increment_user_tokens signature)';

-- Migration applied: Fixed trigger installed with correct RPC function signature