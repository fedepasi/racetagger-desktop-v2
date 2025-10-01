-- Migration: Auto-approve token requests when status changes to 'approved'
-- This ensures that when token_requests are manually approved in the management portal,
-- the tokens are automatically added to the user's balance

-- Function to handle token request approval
CREATE OR REPLACE FUNCTION handle_token_request_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if status changed from something other than 'approved' to 'approved'
  IF OLD.status != 'approved' AND NEW.status = 'approved' THEN
    -- Add tokens to user's balance using existing RPC function
    PERFORM increment_user_tokens(NEW.user_id, NEW.tokens_requested);
    
    -- Update completion date
    NEW.completed_date = CURRENT_TIMESTAMP;
    
    -- Log the approval
    RAISE NOTICE 'Token request % approved: Added % tokens to user %', 
      NEW.id, NEW.tokens_requested, NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that fires before UPDATE on token_requests table
DROP TRIGGER IF EXISTS trigger_auto_approve_tokens ON token_requests;
CREATE TRIGGER trigger_auto_approve_tokens
  BEFORE UPDATE ON token_requests
  FOR EACH ROW
  EXECUTE FUNCTION handle_token_request_approval();

-- Add helpful comments
COMMENT ON FUNCTION handle_token_request_approval() IS 
'Automatically adds requested tokens to user balance when token_request status changes to approved';

COMMENT ON TRIGGER trigger_auto_approve_tokens ON token_requests IS 
'Triggers automatic token approval when status changes to approved';