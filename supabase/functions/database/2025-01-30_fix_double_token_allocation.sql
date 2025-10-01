-- Migration: Fix Double Token Allocation Issue
-- Date: 2025-01-30
-- Purpose: Resolve the issue where users receive 3000 tokens instead of 1500 + bonuses
-- Issue: Users get both gift_tokens (1500) AND bonus_tokens (1500) = 3000 total

BEGIN;

-- ====================================
-- 1. ANALYSIS: Identify the problem scope
-- ====================================

-- Check if the comprehensive token system columns exist
DO $$
BEGIN
  -- Check if gift_tokens column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'subscribers' 
    AND column_name = 'gift_tokens'
    AND table_schema = 'public'
  ) THEN
    -- Apply the comprehensive token system migration first
    RAISE NOTICE 'Gift tokens column does not exist. Need to apply comprehensive token system migration first.';
    
    -- Add the new token columns
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS gift_tokens INTEGER DEFAULT 0;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS earned_tokens INTEGER DEFAULT 0;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS admin_bonus_tokens INTEGER DEFAULT 0;
    
    -- Add comments
    COMMENT ON COLUMN subscribers.gift_tokens IS 'Base 1500 tokens granted upon access approval';
    COMMENT ON COLUMN subscribers.earned_tokens IS 'Tokens earned through referrals and feedback';
    COMMENT ON COLUMN subscribers.admin_bonus_tokens IS 'Additional tokens granted by admin';
    
  END IF;
END $$;

-- ====================================
-- 2. DATA CORRECTION: Fix double allocation
-- ====================================

-- For users who have access but have both bonus_tokens and no gift_tokens:
-- Move bonus_tokens to gift_tokens and zero out bonus_tokens
UPDATE subscribers 
SET 
  gift_tokens = CASE 
    -- If they have 1500 bonus_tokens, that should be their base gift
    WHEN bonus_tokens = 1500 AND gift_tokens = 0 THEN 1500
    -- If they already have gift_tokens, don't change them
    ELSE gift_tokens
  END,
  bonus_tokens = CASE
    -- If bonus_tokens is exactly 1500 and they have access, this is the double allocation
    WHEN bonus_tokens = 1500 AND has_access = true AND gift_tokens = 0 THEN 0
    -- If bonus_tokens > 1500, keep the extra as earned tokens
    WHEN bonus_tokens > 1500 AND has_access = true THEN bonus_tokens - 1500
    -- Otherwise keep bonus_tokens as is (for users without access yet)
    ELSE bonus_tokens
  END,
  earned_tokens = CASE
    -- If bonus_tokens > 1500, the extra goes to earned_tokens
    WHEN bonus_tokens > 1500 AND has_access = true THEN 
      COALESCE(earned_tokens, 0) + (bonus_tokens - 1500)
    ELSE COALESCE(earned_tokens, 0)
  END
WHERE has_access = true 
  AND (bonus_tokens >= 1500 OR gift_tokens = 0);

-- ====================================
-- 3. CONSISTENCY CHECK: Ensure proper allocation
-- ====================================

-- All users with access should have exactly 1500 gift_tokens
UPDATE subscribers 
SET gift_tokens = 1500
WHERE has_access = true 
  AND gift_tokens = 0;

-- Clear bonus_tokens for users who now have gift_tokens to avoid confusion
UPDATE subscribers 
SET bonus_tokens = 0
WHERE has_access = true 
  AND gift_tokens = 1500 
  AND bonus_tokens = 1500;

-- ====================================
-- 4. UPDATE CALCULATION FUNCTIONS
-- ====================================

-- Create or update the main token calculation function
CREATE OR REPLACE FUNCTION get_user_total_available_tokens(p_user_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gift_tokens INTEGER := 0;
  v_earned_tokens INTEGER := 0;
  v_admin_bonus_tokens INTEGER := 0;
  v_legacy_bonus_tokens INTEGER := 0;
  v_consumed_tokens INTEGER := 0;
  v_total_available INTEGER := 0;
  v_user_id UUID;
BEGIN
  -- Get token amounts from subscribers table
  SELECT 
    COALESCE(gift_tokens, 0),
    COALESCE(earned_tokens, 0),
    COALESCE(admin_bonus_tokens, 0),
    COALESCE(bonus_tokens, 0), -- Keep legacy support for now
    user_id
  INTO v_gift_tokens, v_earned_tokens, v_admin_bonus_tokens, v_legacy_bonus_tokens, v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  -- Calculate total granted tokens
  -- Priority: Use new system (gift_tokens + earned_tokens + admin_bonus_tokens)
  -- Fallback: If gift_tokens = 0, use legacy bonus_tokens
  IF v_gift_tokens > 0 THEN
    v_total_available := v_gift_tokens + v_earned_tokens + v_admin_bonus_tokens;
  ELSE
    v_total_available := v_legacy_bonus_tokens + v_earned_tokens + v_admin_bonus_tokens;
  END IF;
  
  -- Subtract consumed tokens if user is activated
  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(tokens_used, 0) INTO v_consumed_tokens
    FROM user_tokens 
    WHERE user_id = v_user_id;
    
    v_total_available := GREATEST(v_total_available - v_consumed_tokens, 0);
  END IF;
  
  RETURN v_total_available;
END;
$$;

-- Function to get token breakdown for admin/debugging
CREATE OR REPLACE FUNCTION get_user_token_breakdown(p_user_email TEXT)
RETURNS TABLE(
  gift_tokens INTEGER,
  earned_tokens INTEGER, 
  admin_bonus_tokens INTEGER,
  legacy_bonus_tokens INTEGER,
  consumed_tokens INTEGER,
  available_balance INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get user_id
  SELECT user_id INTO v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  RETURN QUERY
  SELECT 
    COALESCE(s.gift_tokens, 0),
    COALESCE(s.earned_tokens, 0),
    COALESCE(s.admin_bonus_tokens, 0),
    COALESCE(s.bonus_tokens, 0) as legacy_bonus_tokens,
    COALESCE(ut.tokens_used, 0) as consumed_tokens,
    get_user_total_available_tokens(p_user_email) as available_balance
  FROM subscribers s
  LEFT JOIN user_tokens ut ON ut.user_id = s.user_id
  WHERE s.email = p_user_email;
END;
$$;

COMMIT;

-- ====================================
-- 5. VERIFICATION QUERIES
-- ====================================

-- Show token distribution after fix
SELECT 
  'Fixed Token Distribution' as info,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE has_access = true) as users_with_access,
  COUNT(*) FILTER (WHERE gift_tokens > 0) as users_with_gift_tokens,
  COUNT(*) FILTER (WHERE bonus_tokens > 0) as users_with_legacy_bonus,
  COUNT(*) FILTER (WHERE gift_tokens = 1500 AND bonus_tokens = 0) as properly_allocated,
  COUNT(*) FILTER (WHERE gift_tokens = 1500 AND bonus_tokens = 1500) as still_double_allocated,
  AVG(COALESCE(gift_tokens, 0) + COALESCE(earned_tokens, 0) + COALESCE(admin_bonus_tokens, 0)) as avg_new_system_tokens
FROM subscribers;

-- Show sample of corrected users
SELECT 
  email,
  has_access,
  gift_tokens,
  earned_tokens,
  admin_bonus_tokens,
  bonus_tokens as legacy_bonus,
  (COALESCE(gift_tokens, 0) + COALESCE(earned_tokens, 0) + COALESCE(admin_bonus_tokens, 0)) as new_system_total,
  signup_date
FROM subscribers 
WHERE has_access = true
ORDER BY signup_date DESC
LIMIT 10;