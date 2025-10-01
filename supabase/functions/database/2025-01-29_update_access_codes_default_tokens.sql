-- Migration: Update access_codes default tokens to 1500
-- Date: 2025-01-29  
-- Purpose: Ensure tokens_to_grant default matches landing page promise of 1500 credits

BEGIN;

-- Update the default value for tokens_to_grant to 1500
ALTER TABLE access_codes 
ALTER COLUMN tokens_to_grant SET DEFAULT 1500;

-- Update existing access codes that have 0 or very low token counts
-- This assumes codes with less than 1000 tokens were created with the old system
UPDATE access_codes 
SET tokens_to_grant = 1500
WHERE tokens_to_grant < 1000 AND status NOT IN ('used', 'activated');

-- Update comment to reflect the new default
COMMENT ON COLUMN access_codes.tokens_to_grant IS 'Number of tokens to grant to the user upon activation. Default: 1500 (base credits promised in landing page).';

COMMIT;

-- Verification query
SELECT 
  'Access Codes Token Distribution' as info,
  tokens_to_grant,
  COUNT(*) as count,
  status
FROM access_codes 
GROUP BY tokens_to_grant, status
ORDER BY tokens_to_grant DESC, status;