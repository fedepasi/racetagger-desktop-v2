-- Migration: Update signup bonus tokens from 1500 to 500
-- Purpose: Change default signup bonus to reflect new policy
-- Date: 2025-10-17

-- Update the signup_bonus_tokens value if it exists and is still at 1500
UPDATE system_config
SET
  value = '500'::jsonb,
  updated_at = NOW()
WHERE key = 'signup_bonus_tokens'
AND value::text = '1500';

-- Add comment
COMMENT ON TABLE system_config IS 'Centralized system configuration. signup_bonus_tokens default changed from 1500 to 500 on 2025-10-17';
