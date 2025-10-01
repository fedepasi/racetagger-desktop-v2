-- Migration: Fix Double Token Allocation Issue
-- Date: 2025-01-30
-- Purpose: Resolve the issue where users receive 3000 tokens instead of 1500 + bonuses
-- Issue: Users get both gift_tokens (1500) AND bonus_tokens (1500) = 3000 total

BEGIN;

-- ====================================
-- 1. ADD NEW TOKEN FIELDS TO SUBSCRIBERS
-- ====================================

-- Add new token fields for proper separation
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS gift_tokens INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS earned_tokens INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS admin_bonus_tokens INTEGER DEFAULT 0;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscribers_gift_tokens ON subscribers(gift_tokens);
CREATE INDEX IF NOT EXISTS idx_subscribers_earned_tokens ON subscribers(earned_tokens);
CREATE INDEX IF NOT EXISTS idx_subscribers_admin_bonus_tokens ON subscribers(admin_bonus_tokens);

-- Add comments for clarity
COMMENT ON COLUMN subscribers.gift_tokens IS 'Base 1500 tokens granted upon access approval';
COMMENT ON COLUMN subscribers.earned_tokens IS 'Tokens earned through referrals and feedback';
COMMENT ON COLUMN subscribers.admin_bonus_tokens IS 'Additional tokens granted by admin for special cases';

-- ====================================
-- 2. DATA MIGRATION - FIX EXISTING RECORDS
-- ====================================

-- Step 1: For users with access, move their bonus_tokens to gift_tokens
-- This fixes the double allocation where users get both bonus_tokens AND gift_tokens
UPDATE subscribers 
SET 
  gift_tokens = CASE 
    WHEN has_access = true AND bonus_tokens >= 1500 THEN 1500
    ELSE 0
  END,
  earned_tokens = CASE
    WHEN has_access = true AND bonus_tokens > 1500 THEN bonus_tokens - 1500
    ELSE 0
  END
WHERE has_access = true AND gift_tokens = 0;

-- Step 2: Clear bonus_tokens for users who now have gift_tokens to prevent double counting
UPDATE subscribers 
SET bonus_tokens = 0
WHERE has_access = true AND gift_tokens = 1500;

-- ====================================
-- 3. CREATE UPDATED TOKEN CALCULATION FUNCTION
-- ====================================

-- Function to get user's total available tokens (new system)
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
    COALESCE(bonus_tokens, 0), -- Keep legacy support for transition
    user_id
  INTO v_gift_tokens, v_earned_tokens, v_admin_bonus_tokens, v_legacy_bonus_tokens, v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  -- Calculate total granted tokens
  -- Priority: Use new system (gift_tokens + earned_tokens + admin_bonus_tokens)
  -- Fallback: If gift_tokens = 0, use legacy bonus_tokens (for users without access yet)
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

-- Function to get token breakdown for debugging
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
-- VERIFICATION QUERIES
-- ====================================

-- Show token distribution after fix
SELECT 
  'Fixed Token Distribution' as info,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE has_access = true) as users_with_access,
  COUNT(*) FILTER (WHERE gift_tokens > 0) as users_with_gift_tokens,
  COUNT(*) FILTER (WHERE bonus_tokens > 0) as users_with_legacy_bonus,
  COUNT(*) FILTER (WHERE gift_tokens = 1500 AND bonus_tokens = 0) as properly_allocated,
  AVG(COALESCE(gift_tokens, 0) + COALESCE(earned_tokens, 0) + COALESCE(admin_bonus_tokens, 0)) as avg_new_system_tokens
FROM subscribers;