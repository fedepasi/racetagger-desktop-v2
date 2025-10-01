-- Migration: Unify Token Request Status Values (Desktop)
-- Date: 2025-08-31
-- Description: Updates existing token request records to use unified status values
-- This unifies desktop and web app token request statuses for consistency

-- Create migration_log table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.migration_log (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT
);

-- Update existing token requests to use unified status values
BEGIN;

-- Convert old desktop statuses to unified statuses
UPDATE token_requests 
SET status = 'pending' 
WHERE status = 'pending_payment';

UPDATE token_requests 
SET status = 'approved' 
WHERE status = 'approved_free';

UPDATE token_requests 
SET status = 'approved' 
WHERE status = 'completed';

-- Log the migration
INSERT INTO public.migration_log (migration_name, executed_at, description) VALUES 
('20250831000003_unify_token_request_statuses', NOW(), 'Unified token request status values between desktop and web app - Desktop version');

COMMIT;

-- Verify the migration results
DO $$
DECLARE
    pending_count INTEGER;
    approved_count INTEGER;
    rejected_count INTEGER;
    total_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO pending_count FROM token_requests WHERE status = 'pending';
    SELECT COUNT(*) INTO approved_count FROM token_requests WHERE status = 'approved';
    SELECT COUNT(*) INTO rejected_count FROM token_requests WHERE status = 'rejected';
    SELECT COUNT(*) INTO total_count FROM token_requests;
    
    RAISE NOTICE 'Desktop Token Request Status Migration Complete:';
    RAISE NOTICE '  - Pending: %', pending_count;
    RAISE NOTICE '  - Approved: %', approved_count;
    RAISE NOTICE '  - Rejected: %', rejected_count;
    RAISE NOTICE '  - Total: %', total_count;
END $$;