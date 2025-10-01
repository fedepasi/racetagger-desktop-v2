-- Migration: Fix Token Defaults - Set base 1000 + bonus 500 = 1500 total
-- Date: 2025-01-30
-- Purpose: Resolve double token allocation by setting proper defaults

BEGIN;

-- ====================================
-- 1. ADD BASE_TOKENS FIELD AND UPDATE DEFAULTS
-- ====================================

-- Add base_tokens field with default 1000
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS base_tokens INTEGER DEFAULT 1000;

-- Update bonus_tokens default from 1500 to 500
ALTER TABLE subscribers ALTER COLUMN bonus_tokens SET DEFAULT 500;

-- Add comments for clarity
COMMENT ON COLUMN subscribers.base_tokens IS 'Base 1000 tokens granted to all users (constant)';
COMMENT ON COLUMN subscribers.bonus_tokens IS 'Bonus tokens - default 500, can vary based on referrals/feedback';

-- ====================================
-- 2. FIX EXISTING DATA
-- ====================================

-- For existing users, split their current bonus_tokens:
-- If they have 1500 or more: set base_tokens=1000, bonus_tokens=500
-- If they have 3000: this indicates double allocation, fix to base_tokens=1000, bonus_tokens=500

UPDATE subscribers 
SET 
  base_tokens = 1000,
  bonus_tokens = CASE 
    WHEN bonus_tokens >= 3000 THEN 500 + (bonus_tokens - 3000) -- Fix double allocation, keep extra
    WHEN bonus_tokens >= 1500 THEN 500 + (bonus_tokens - 1500) -- Normal case, keep extra as bonus
    ELSE bonus_tokens -- Keep as is if less than 1500
  END
WHERE base_tokens IS NULL OR base_tokens = 0;

-- ====================================
-- 3. CREATE HELPER FUNCTION FOR TOTAL TOKENS
-- ====================================

CREATE OR REPLACE FUNCTION get_user_total_tokens_simple(p_user_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_base_tokens INTEGER := 0;
  v_bonus_tokens INTEGER := 0;
  v_consumed_tokens INTEGER := 0;
  v_user_id UUID;
BEGIN
  -- Get token amounts from subscribers table
  SELECT 
    COALESCE(base_tokens, 1000),
    COALESCE(bonus_tokens, 500),
    user_id
  INTO v_base_tokens, v_bonus_tokens, v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  -- Get consumed tokens if user is activated
  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(tokens_used, 0) INTO v_consumed_tokens
    FROM user_tokens 
    WHERE user_id = v_user_id;
  END IF;
  
  -- Return available balance
  RETURN GREATEST((v_base_tokens + v_bonus_tokens) - v_consumed_tokens, 0);
END;
$$;

-- ====================================
-- 4. UPDATE ACCESS_CODES DEFAULT
-- ====================================

-- Update access_codes to grant 1500 tokens total (1000 base + 500 bonus)
ALTER TABLE access_codes ALTER COLUMN tokens_to_grant SET DEFAULT 1500;

COMMIT;

-- ====================================
-- 5. VERIFICATION QUERIES
-- ====================================

-- Show token distribution after fix
SELECT 
  'Fixed Token Distribution' as info,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE has_access = true) as users_with_access,
  AVG(COALESCE(base_tokens, 1000) + COALESCE(bonus_tokens, 500)) as avg_total_tokens,
  COUNT(*) FILTER (WHERE base_tokens = 1000 AND bonus_tokens = 500) as users_with_standard_allocation,
  COUNT(*) FILTER (WHERE base_tokens + bonus_tokens > 1500) as users_with_extra_bonus
FROM subscribers;