-- Migration: Comprehensive Token System Fix
-- Date: 2025-01-29
-- Purpose: Implement proper token separation and fix calculation logic

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
-- 2. CREATE TOKEN TRANSACTION LOG TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS token_transactions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'gift_granted',     -- 1500 tokens on access approval
    'referral_earned',  -- 50 tokens per referral
    'feedback_earned',  -- 5 tokens per approved feedback
    'admin_bonus',      -- Admin manually granted tokens
    'image_analysis',   -- 1 token consumed per analysis
    'admin_adjustment'  -- Manual admin correction
  )),
  amount INTEGER NOT NULL, -- Positive for grants, negative for consumption
  description TEXT,
  reference_id UUID, -- Links to related records (referral_id, feedback_id, etc.)
  admin_id UUID REFERENCES admin_users(id), -- For admin-initiated transactions
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_transactions_user_id ON token_transactions_log(user_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_user_email ON token_transactions_log(user_email);
CREATE INDEX IF NOT EXISTS idx_token_transactions_type ON token_transactions_log(transaction_type);
CREATE INDEX IF NOT EXISTS idx_token_transactions_created_at ON token_transactions_log(created_at);

-- Enable RLS
ALTER TABLE token_transactions_log ENABLE ROW LEVEL SECURITY;

-- Users can see their own transactions
CREATE POLICY "Users can view their own token transactions" ON token_transactions_log
  FOR SELECT USING (user_id = auth.uid() OR user_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Only admins can insert/update
CREATE POLICY "Only admins can manage token transactions" ON token_transactions_log
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- ====================================
-- 3. DATA MIGRATION - FIX EXISTING RECORDS
-- ====================================

-- Step 1: Initialize gift_tokens for users who have access
-- All users with access should have received 1500 gift tokens
UPDATE subscribers 
SET gift_tokens = 1500
WHERE has_access = true AND gift_tokens = 0;

-- Step 2: Migrate existing bonus_tokens to appropriate categories
-- For now, move all existing bonus_tokens to earned_tokens (assuming they came from referrals/feedback)
UPDATE subscribers 
SET earned_tokens = COALESCE(bonus_tokens, 0)
WHERE earned_tokens = 0 AND bonus_tokens > 0;

-- Step 3: Create transaction log entries for existing data (for audit trail)
INSERT INTO token_transactions_log (user_id, user_email, transaction_type, amount, description)
SELECT 
  user_id,
  email,
  'gift_granted',
  1500,
  'Initial gift tokens granted during migration'
FROM subscribers 
WHERE has_access = true 
  AND gift_tokens = 1500
  AND user_id IS NOT NULL;

-- Log existing earned tokens
INSERT INTO token_transactions_log (user_id, user_email, transaction_type, amount, description)
SELECT 
  user_id,
  email,
  'referral_earned',
  earned_tokens,
  'Migrated from legacy bonus_tokens field'
FROM subscribers 
WHERE earned_tokens > 0
  AND user_id IS NOT NULL;

-- ====================================
-- 4. CREATE HELPER FUNCTIONS
-- ====================================

-- Function to get user's total available tokens
CREATE OR REPLACE FUNCTION get_user_total_tokens_v2(p_user_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gift_tokens INTEGER := 0;
  v_earned_tokens INTEGER := 0;
  v_admin_bonus_tokens INTEGER := 0;
  v_total INTEGER := 0;
BEGIN
  -- Get token amounts from subscribers table
  SELECT 
    COALESCE(gift_tokens, 0),
    COALESCE(earned_tokens, 0),
    COALESCE(admin_bonus_tokens, 0)
  INTO v_gift_tokens, v_earned_tokens, v_admin_bonus_tokens
  FROM subscribers 
  WHERE email = p_user_email;
  
  v_total := v_gift_tokens + v_earned_tokens + v_admin_bonus_tokens;
  
  RETURN v_total;
END;
$$;

-- Function to get user's consumed tokens from user_tokens table
CREATE OR REPLACE FUNCTION get_user_consumed_tokens(p_user_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_consumed INTEGER := 0;
  v_user_id UUID;
BEGIN
  -- Get user_id from subscribers
  SELECT user_id INTO v_user_id
  FROM subscribers 
  WHERE email = p_user_email AND user_id IS NOT NULL;
  
  IF v_user_id IS NOT NULL THEN
    -- Get consumed tokens from user_tokens table
    SELECT COALESCE(tokens_used, 0) INTO v_consumed
    FROM user_tokens 
    WHERE user_id = v_user_id;
  END IF;
  
  RETURN COALESCE(v_consumed, 0);
END;
$$;

-- Function to get user's available balance
CREATE OR REPLACE FUNCTION get_user_available_balance(p_user_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER;
  v_consumed INTEGER;
BEGIN
  v_total := get_user_total_tokens_v2(p_user_email);
  v_consumed := get_user_consumed_tokens(p_user_email);
  
  RETURN GREATEST(v_total - v_consumed, 0);
END;
$$;

-- Function to grant gift tokens (1500 on access approval)
CREATE OR REPLACE FUNCTION grant_gift_tokens(
  p_user_email TEXT,
  p_admin_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
  v_admin_id UUID;
  v_user_id UUID;
BEGIN
  -- Verify admin permission
  SELECT id INTO v_admin_id FROM admin_users WHERE user_id = p_admin_user_id;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Not an admin user';
  END IF;
  
  -- Find subscriber
  SELECT id, user_id INTO v_subscriber_id, v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Grant 1500 gift tokens
  UPDATE subscribers 
  SET 
    gift_tokens = 1500,
    has_access = true,
    registration_status = 'access_granted'
  WHERE id = v_subscriber_id;
  
  -- Log transaction
  INSERT INTO token_transactions_log (user_id, user_email, transaction_type, amount, description, admin_id)
  VALUES (v_user_id, p_user_email, 'gift_granted', 1500, 'Gift tokens granted on access approval', v_admin_id);
  
  RETURN TRUE;
END;
$$;

-- Function to grant admin bonus tokens
CREATE OR REPLACE FUNCTION grant_admin_bonus_tokens(
  p_user_email TEXT,
  p_bonus_amount INTEGER,
  p_reason TEXT,
  p_admin_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
  v_admin_id UUID;
  v_user_id UUID;
BEGIN
  -- Verify admin permission
  SELECT id INTO v_admin_id FROM admin_users WHERE user_id = p_admin_user_id;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Not an admin user';
  END IF;
  
  -- Find subscriber
  SELECT id, user_id INTO v_subscriber_id, v_user_id
  FROM subscribers 
  WHERE email = p_user_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Grant admin bonus tokens
  UPDATE subscribers 
  SET admin_bonus_tokens = admin_bonus_tokens + p_bonus_amount
  WHERE id = v_subscriber_id;
  
  -- Log transaction
  INSERT INTO token_transactions_log (user_id, user_email, transaction_type, amount, description, admin_id)
  VALUES (v_user_id, p_user_email, 'admin_bonus', p_bonus_amount, p_reason, v_admin_id);
  
  RETURN TRUE;
END;
$$;

-- Function to consume tokens (for image analysis)
CREATE OR REPLACE FUNCTION consume_tokens_for_analysis(
  p_user_email TEXT,
  p_tokens_to_consume INTEGER DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_available_balance INTEGER;
  v_user_id UUID;
BEGIN
  -- Check available balance
  v_available_balance := get_user_available_balance(p_user_email);
  
  IF v_available_balance < p_tokens_to_consume THEN
    RETURN FALSE; -- Insufficient balance
  END IF;
  
  -- Get user_id
  SELECT user_id INTO v_user_id
  FROM subscribers 
  WHERE email = p_user_email AND user_id IS NOT NULL;
  
  IF v_user_id IS NULL THEN
    RETURN FALSE; -- User not activated
  END IF;
  
  -- Update tokens_used in user_tokens table
  INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
  VALUES (v_user_id, 0, p_tokens_to_consume)
  ON CONFLICT (user_id) DO UPDATE SET
    tokens_used = user_tokens.tokens_used + p_tokens_to_consume;
  
  -- Log transaction
  INSERT INTO token_transactions_log (user_id, user_email, transaction_type, amount, description)
  VALUES (v_user_id, p_user_email, 'image_analysis', -p_tokens_to_consume, 'Token consumed for image analysis');
  
  RETURN TRUE;
END;
$$;

COMMIT;

-- ====================================
-- 5. VERIFICATION QUERIES
-- ====================================

-- Show token distribution after migration
SELECT 
  'Token Distribution After Migration' as info,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE gift_tokens > 0) as users_with_gift_tokens,
  COUNT(*) FILTER (WHERE earned_tokens > 0) as users_with_earned_tokens,
  COUNT(*) FILTER (WHERE admin_bonus_tokens > 0) as users_with_admin_bonus,
  AVG(gift_tokens + earned_tokens + admin_bonus_tokens) as avg_total_tokens
FROM subscribers;

-- Show sample of migrated data
SELECT 
  email,
  has_access,
  gift_tokens,
  earned_tokens,
  admin_bonus_tokens,
  (gift_tokens + earned_tokens + admin_bonus_tokens) as total_tokens,
  COALESCE(bonus_tokens, 0) as old_bonus_tokens
FROM subscribers 
WHERE has_access = true
ORDER BY signup_date DESC
LIMIT 10;