-- Migration: Add referral system, feedback rewards, and admin approval workflow (CORRECTED)
-- Date: 2025-01-16
-- Purpose: Implement referral tracking, feedback rewards, and admin approval system
-- Fix: Corrected to work with existing schema without user_id in subscribers table

BEGIN;

-- ====================================
-- 1. EXTEND SUBSCRIBERS TABLE
-- ====================================

-- Add user_id column to subscribers table to link with auth.users
-- This column will be populated when users activate their access codes
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Add referral system fields to subscribers
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referral_code UUID DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES subscribers(id);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS bonus_tokens INTEGER DEFAULT 1500;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS total_referrals INTEGER DEFAULT 0;

-- Add admin approval workflow fields
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'auto_approved' 
  CHECK (approval_status IN ('pending', 'auto_approved', 'admin_approved', 'rejected'));
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES admin_users(id);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add company field (was optional in form)
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS company TEXT;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscribers_user_id ON subscribers(user_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_referral_code ON subscribers(referral_code);
CREATE INDEX IF NOT EXISTS idx_subscribers_referred_by ON subscribers(referred_by);
CREATE INDEX IF NOT EXISTS idx_subscribers_approval_status ON subscribers(approval_status);

-- Update existing subscribers to have referral codes
UPDATE subscribers SET referral_code = gen_random_uuid() WHERE referral_code IS NULL;

-- ====================================
-- 2. REFERRAL TRACKING TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  referral_code UUID NOT NULL REFERENCES subscribers(referral_code),
  tokens_earned INTEGER DEFAULT 50,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_id ON referrals(referred_id);

-- ====================================
-- 3. EXTEND IMAGE_FEEDBACK TABLE
-- ====================================

-- Add user tracking and reward system to feedback
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS tokens_earned INTEGER DEFAULT 0;
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS admin_approved BOOLEAN DEFAULT NULL; -- NULL = pending, TRUE = approved, FALSE = rejected
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES admin_users(id);
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS quality_score INTEGER CHECK (quality_score >= 1 AND quality_score <= 5);
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Add session tracking for anonymous users
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE image_feedback ADD COLUMN IF NOT EXISTS ip_address INET;

CREATE INDEX IF NOT EXISTS idx_image_feedback_user_email ON image_feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_image_feedback_admin_approved ON image_feedback(admin_approved);
CREATE INDEX IF NOT EXISTS idx_image_feedback_session_id ON image_feedback(session_id);

-- ====================================
-- 4. FEEDBACK REWARDS TRACKING TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS feedback_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES image_feedback(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  tokens_awarded INTEGER DEFAULT 5,
  reward_reason TEXT DEFAULT 'feedback_contribution',
  awarded_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent duplicate rewards for same feedback
  UNIQUE(feedback_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_rewards_user_email ON feedback_rewards(user_email);
CREATE INDEX IF NOT EXISTS idx_feedback_rewards_user_id ON feedback_rewards(user_id);

-- ====================================
-- 5. ADMIN ACTIONS LOG TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS admin_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('approve_subscriber', 'reject_subscriber', 'approve_feedback', 'reject_feedback', 'award_tokens', 'revoke_referral')),
  target_id UUID NOT NULL, -- ID of subscriber, feedback, etc.
  target_type TEXT NOT NULL CHECK (target_type IN ('subscriber', 'feedback', 'referral')),
  action_details JSONB,
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_log_admin_id ON admin_actions_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_action_type ON admin_actions_log(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_target_id ON admin_actions_log(target_id);

-- ====================================
-- 6. ROW LEVEL SECURITY POLICIES
-- ====================================

-- Enable RLS on new tables
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions_log ENABLE ROW LEVEL SECURITY;

-- Referrals: Users can see their own referrals (CORRECTED to handle missing user_id)
CREATE POLICY "Users can view their own referrals" ON referrals
  FOR SELECT USING (
    auth.uid() IN (
      -- Check if the current user is linked to the referrer subscriber
      SELECT s.user_id FROM subscribers s WHERE s.id = referrer_id AND s.user_id IS NOT NULL
      UNION
      -- Check if the current user is linked to the referred subscriber
      SELECT s.user_id FROM subscribers s WHERE s.id = referred_id AND s.user_id IS NOT NULL
    )
  );

-- Referrals: Only admins can insert/update
CREATE POLICY "Only admins can manage referrals" ON referrals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- Feedback rewards: Users can see their own rewards
CREATE POLICY "Users can view their own feedback rewards" ON feedback_rewards
  FOR SELECT USING (
    user_id = auth.uid() OR 
    user_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Feedback rewards: Only admins can manage
CREATE POLICY "Only admins can manage feedback rewards" ON feedback_rewards
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- Admin actions log: Only admins can access
CREATE POLICY "Only admins can access admin actions log" ON admin_actions_log
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- ====================================
-- 7. HELPER FUNCTIONS
-- ====================================

-- Function to process referral when new user signs up
CREATE OR REPLACE FUNCTION process_referral_signup(
  p_new_subscriber_id UUID,
  p_referral_code UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id UUID;
  v_tokens_to_award INTEGER := 50;
  v_referrer_user_id UUID;
BEGIN
  -- Find the referrer
  SELECT id INTO v_referrer_id 
  FROM subscribers 
  WHERE referral_code = p_referral_code;
  
  IF v_referrer_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Update referred_by in new subscriber
  UPDATE subscribers 
  SET referred_by = v_referrer_id 
  WHERE id = p_new_subscriber_id;
  
  -- Insert referral record
  INSERT INTO referrals (referrer_id, referred_id, referral_code, tokens_earned)
  VALUES (v_referrer_id, p_new_subscriber_id, p_referral_code, v_tokens_to_award);
  
  -- Update referrer's bonus tokens and referral count
  UPDATE subscribers 
  SET 
    bonus_tokens = bonus_tokens + v_tokens_to_award,
    total_referrals = total_referrals + 1
  WHERE id = v_referrer_id;
  
  -- Get referrer's user_id if linked to auth.users
  SELECT user_id INTO v_referrer_user_id 
  FROM subscribers 
  WHERE id = v_referrer_id AND user_id IS NOT NULL;
  
  -- Add tokens to the referrer's account if they're activated
  IF v_referrer_user_id IS NOT NULL THEN
    -- If referrer is activated, add tokens to their balance
    INSERT INTO token_transactions (user_id, amount, transaction_type, description)
    VALUES (v_referrer_user_id, v_tokens_to_award, 'referral_bonus', 'Referral bonus for successful signup');
  END IF;
  
  RETURN TRUE;
END;
$$;

-- Function to award feedback tokens
CREATE OR REPLACE FUNCTION award_feedback_tokens(
  p_feedback_id UUID,
  p_admin_id UUID,
  p_tokens INTEGER DEFAULT 5
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_email TEXT;
  v_user_id UUID;
  v_admin_user_id UUID;
BEGIN
  -- Verify admin permission
  SELECT user_id INTO v_admin_user_id FROM admin_users WHERE user_id = p_admin_id;
  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Not an admin user';
  END IF;
  
  -- Get feedback details
  SELECT user_email, user_id INTO v_user_email, v_user_id
  FROM image_feedback 
  WHERE id = p_feedback_id;
  
  IF v_user_email IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Mark feedback as approved
  UPDATE image_feedback 
  SET 
    admin_approved = TRUE,
    approved_by = (SELECT id FROM admin_users WHERE user_id = p_admin_id),
    approved_at = NOW(),
    tokens_earned = p_tokens
  WHERE id = p_feedback_id;
  
  -- Insert reward record
  INSERT INTO feedback_rewards (feedback_id, user_email, user_id, tokens_awarded, awarded_by)
  VALUES (
    p_feedback_id, 
    v_user_email, 
    v_user_id, 
    p_tokens,
    (SELECT id FROM admin_users WHERE user_id = p_admin_id)
  );
  
  -- If user is registered and activated, add tokens to their balance
  IF v_user_id IS NOT NULL THEN
    INSERT INTO token_transactions (user_id, amount, transaction_type, description)
    VALUES (v_user_id, p_tokens, 'feedback_reward', 'Reward for approved feedback');
  ELSE
    -- User not yet registered, add bonus tokens to their future account
    UPDATE subscribers 
    SET bonus_tokens = bonus_tokens + p_tokens 
    WHERE email = v_user_email;
  END IF;
  
  -- Log admin action
  INSERT INTO admin_actions_log (admin_id, action_type, target_id, target_type, action_details)
  VALUES (
    (SELECT id FROM admin_users WHERE user_id = p_admin_id),
    'approve_feedback',
    p_feedback_id,
    'feedback',
    jsonb_build_object('tokens_awarded', p_tokens, 'user_email', v_user_email)
  );
  
  RETURN TRUE;
END;
$$;

-- Function to get user's total available tokens (including bonuses) - CORRECTED
CREATE OR REPLACE FUNCTION get_user_total_tokens(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER := 0;
  v_bonus_tokens INTEGER := 0;
BEGIN
  -- Get current token balance from user_tokens table
  SELECT COALESCE((tokens_purchased - tokens_used), 0) INTO v_balance
  FROM user_tokens 
  WHERE user_id = p_user_id;
  
  -- Get unclaimed bonus tokens from subscribers table
  SELECT COALESCE(bonus_tokens, 0) INTO v_bonus_tokens
  FROM subscribers 
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus_tokens, 0);
END;
$$;

-- Function to link subscriber to auth.users when they activate access code
CREATE OR REPLACE FUNCTION link_subscriber_to_user(
  p_subscriber_email TEXT,
  p_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
  v_bonus_tokens INTEGER := 0;
BEGIN
  -- Find subscriber by email
  SELECT id, bonus_tokens INTO v_subscriber_id, v_bonus_tokens
  FROM subscribers 
  WHERE email = p_subscriber_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Link subscriber to user
  UPDATE subscribers 
  SET user_id = p_user_id 
  WHERE id = v_subscriber_id;
  
  -- Transfer bonus tokens to user's token balance if any
  IF v_bonus_tokens > 0 THEN
    -- Ensure user has a token record
    INSERT INTO user_tokens (user_id, tokens_purchased, tokens_used)
    VALUES (p_user_id, v_bonus_tokens, 0)
    ON CONFLICT (user_id) DO UPDATE SET
      tokens_purchased = user_tokens.tokens_purchased + v_bonus_tokens;
    
    -- Record the transaction
    INSERT INTO token_transactions (user_id, amount, transaction_type, description)
    VALUES (p_user_id, v_bonus_tokens, 'bonus_transfer', 'Bonus tokens transferred from subscriber account');
    
    -- Clear bonus tokens from subscriber (they're now in user_tokens)
    UPDATE subscribers 
    SET bonus_tokens = 0 
    WHERE id = v_subscriber_id;
  END IF;
  
  RETURN TRUE;
END;
$$;

COMMIT;

-- ====================================
-- 8. VERIFICATION QUERIES
-- ====================================

-- Verify all tables exist
SELECT 
  schemaname, 
  tablename, 
  tableowner 
FROM pg_tables 
WHERE tablename IN ('referrals', 'feedback_rewards', 'admin_actions_log')
  AND schemaname = 'public';

-- Verify new columns exist in subscribers
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name = 'subscribers' 
  AND column_name IN ('user_id', 'referral_code', 'referred_by', 'bonus_tokens', 'approval_status', 'company')
  AND table_schema = 'public';

-- Verify new columns exist in image_feedback
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name = 'image_feedback' 
  AND column_name IN ('user_email', 'tokens_earned', 'admin_approved', 'session_id')
  AND table_schema = 'public';