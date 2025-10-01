-- Migration: Complete Token System - Base + Bonus + Earned + Admin
-- Date: 2025-01-30
-- Purpose: Implement complete token separation with proper defaults

BEGIN;

-- ====================================
-- 1. ADD ALL TOKEN FIELDS WITH PROPER DEFAULTS
-- ====================================

-- Add all token fields if they don't exist
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS base_tokens INTEGER DEFAULT 1000;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS earned_tokens INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS admin_bonus_tokens INTEGER DEFAULT 0;

-- Update bonus_tokens default from 1500 to 500
ALTER TABLE subscribers ALTER COLUMN bonus_tokens SET DEFAULT 500;

-- Add clear comments
COMMENT ON COLUMN subscribers.base_tokens IS 'Base 1000 tokens granted to all users (constant)';
COMMENT ON COLUMN subscribers.bonus_tokens IS 'Default bonus tokens - 500 for standard users';
COMMENT ON COLUMN subscribers.earned_tokens IS 'Tokens earned through referrals and feedback';
COMMENT ON COLUMN subscribers.admin_bonus_tokens IS 'Additional tokens granted by admin';

-- ====================================
-- 2. FIX EXISTING DATA - RESOLVE DOUBLE ALLOCATION
-- ====================================

-- Initialize base_tokens for existing users
UPDATE subscribers 
SET base_tokens = 1000
WHERE base_tokens IS NULL OR base_tokens = 0;

-- Initialize earned_tokens and admin_bonus_tokens 
UPDATE subscribers 
SET 
  earned_tokens = COALESCE(earned_tokens, 0),
  admin_bonus_tokens = COALESCE(admin_bonus_tokens, 0)
WHERE earned_tokens IS NULL OR admin_bonus_tokens IS NULL;

-- Fix the double allocation issue:
-- Users with 3000 bonus_tokens = 1500 (old default) + 1500 (double grant)
-- Should become: base_tokens=1000, bonus_tokens=500, rest goes to earned_tokens
UPDATE subscribers 
SET 
  bonus_tokens = CASE 
    WHEN bonus_tokens >= 3000 THEN 500 + (bonus_tokens - 3000) -- Fix double allocation
    WHEN bonus_tokens >= 1500 THEN 500 + (bonus_tokens - 1500) -- Normal excess goes to earned
    WHEN bonus_tokens < 500 THEN bonus_tokens -- Keep if less than standard
    ELSE 500 -- Standard case
  END,
  earned_tokens = CASE
    WHEN bonus_tokens >= 1500 THEN COALESCE(earned_tokens, 0) + GREATEST(bonus_tokens - 1500, 0)
    ELSE COALESCE(earned_tokens, 0)
  END
WHERE bonus_tokens > 500;

-- ====================================
-- 3. CREATE COMPREHENSIVE TOKEN FUNCTIONS
-- ====================================

-- Main function to get total available tokens
CREATE OR REPLACE FUNCTION get_user_total_tokens_complete(p_user_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_base_tokens INTEGER := 0;
  v_bonus_tokens INTEGER := 0;
  v_earned_tokens INTEGER := 0;
  v_admin_bonus_tokens INTEGER := 0;
  v_consumed_tokens INTEGER := 0;
  v_user_id UUID;
BEGIN
  -- Get all token amounts from subscribers table
  SELECT 
    COALESCE(base_tokens, 1000),
    COALESCE(bonus_tokens, 500),
    COALESCE(earned_tokens, 0),
    COALESCE(admin_bonus_tokens, 0),
    user_id
  INTO v_base_tokens, v_bonus_tokens, v_earned_tokens, v_admin_bonus_tokens, v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  -- Get consumed tokens if user is activated
  IF v_user_id IS NOT NULL THEN
    SELECT COALESCE(tokens_used, 0) INTO v_consumed_tokens
    FROM user_tokens 
    WHERE user_id = v_user_id;
  END IF;
  
  -- Return available balance
  RETURN GREATEST((v_base_tokens + v_bonus_tokens + v_earned_tokens + v_admin_bonus_tokens) - v_consumed_tokens, 0);
END;
$$;

-- Function to get detailed token breakdown
CREATE OR REPLACE FUNCTION get_user_token_breakdown_complete(p_user_email TEXT)
RETURNS TABLE(
  base_tokens INTEGER,
  bonus_tokens INTEGER,
  earned_tokens INTEGER,
  admin_bonus_tokens INTEGER,
  total_granted INTEGER,
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
    COALESCE(s.base_tokens, 1000),
    COALESCE(s.bonus_tokens, 500),
    COALESCE(s.earned_tokens, 0),
    COALESCE(s.admin_bonus_tokens, 0),
    COALESCE(s.base_tokens, 1000) + COALESCE(s.bonus_tokens, 500) + COALESCE(s.earned_tokens, 0) + COALESCE(s.admin_bonus_tokens, 0) as total_granted,
    COALESCE(ut.tokens_used, 0) as consumed_tokens,
    get_user_total_tokens_complete(p_user_email) as available_balance
  FROM subscribers s
  LEFT JOIN user_tokens ut ON ut.user_id = s.user_id
  WHERE s.email = p_user_email;
END;
$$;

-- Function to award earned tokens (for referrals/feedback)
CREATE OR REPLACE FUNCTION award_earned_tokens(
  p_user_email TEXT,
  p_tokens_amount INTEGER,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
BEGIN
  -- Find subscriber
  SELECT id INTO v_subscriber_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Add to earned_tokens
  UPDATE subscribers 
  SET earned_tokens = COALESCE(earned_tokens, 0) + p_tokens_amount
  WHERE id = v_subscriber_id;
  
  RETURN TRUE;
END;
$$;

-- Function to grant admin bonus tokens
CREATE OR REPLACE FUNCTION grant_admin_bonus_tokens_complete(
  p_user_email TEXT,
  p_bonus_amount INTEGER,
  p_reason TEXT DEFAULT 'Admin bonus'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
BEGIN
  -- Find subscriber
  SELECT id INTO v_subscriber_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Add to admin_bonus_tokens
  UPDATE subscribers 
  SET admin_bonus_tokens = COALESCE(admin_bonus_tokens, 0) + p_bonus_amount
  WHERE id = v_subscriber_id;
  
  RETURN TRUE;
END;
$$;

COMMIT;

-- ====================================
-- VERIFICATION QUERIES
-- ====================================

-- Show complete token distribution
SELECT 
  'Complete Token System Status' as info,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE has_access = true) as users_with_access,
  AVG(COALESCE(base_tokens, 1000)) as avg_base_tokens,
  AVG(COALESCE(bonus_tokens, 500)) as avg_bonus_tokens,
  AVG(COALESCE(earned_tokens, 0)) as avg_earned_tokens,
  AVG(COALESCE(admin_bonus_tokens, 0)) as avg_admin_bonus_tokens,
  AVG(COALESCE(base_tokens, 1000) + COALESCE(bonus_tokens, 500) + COALESCE(earned_tokens, 0) + COALESCE(admin_bonus_tokens, 0)) as avg_total_tokens
FROM subscribers;

-- Show sample of corrected users
SELECT 
  email,
  has_access,
  COALESCE(base_tokens, 1000) as base_tokens,
  COALESCE(bonus_tokens, 500) as bonus_tokens,
  COALESCE(earned_tokens, 0) as earned_tokens,
  COALESCE(admin_bonus_tokens, 0) as admin_bonus_tokens,
  (COALESCE(base_tokens, 1000) + COALESCE(bonus_tokens, 500) + COALESCE(earned_tokens, 0) + COALESCE(admin_bonus_tokens, 0)) as total_tokens
FROM subscribers 
WHERE has_access = true
ORDER BY signup_date DESC
LIMIT 10;