-- Migration: Enhanced Referral and Marketing System
-- Date: 2025-08-16
-- Purpose: Implement tiered referral system, enhanced feedback rewards, and milestone bonuses
-- Author: Marketing Strategy Implementation

BEGIN;

-- ====================================
-- 1. UPDATE SUBSCRIBERS TABLE FOR ENHANCED SYSTEM
-- ====================================

-- Add new fields for enhanced referral system
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referral_tier INTEGER DEFAULT 1 CHECK (referral_tier >= 1 AND referral_tier <= 3);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS milestone_bonuses_earned INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS social_shares_count INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS feedback_quality_score DECIMAL(3,2) DEFAULT 0.0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS trusted_feedback_multiplier DECIMAL(3,2) DEFAULT 1.0;

-- Update bonus_tokens default to new amount (2000 instead of 1500)
ALTER TABLE subscribers ALTER COLUMN bonus_tokens SET DEFAULT 1500;

-- Update existing subscribers to have the new bonus amount
UPDATE subscribers SET bonus_tokens = 1500 WHERE bonus_tokens = 2000;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_subscribers_referral_tier ON subscribers(referral_tier);
CREATE INDEX IF NOT EXISTS idx_subscribers_milestone_bonuses ON subscribers(milestone_bonuses_earned);

-- ====================================
-- 2. ENHANCED REFERRALS TABLE
-- ====================================

-- Add tier information to referrals
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referral_tier INTEGER DEFAULT 1;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bonus_multiplier DECIMAL(3,2) DEFAULT 1.0;

-- Update existing referrals to use new token amounts (100 instead of 50)
UPDATE referrals SET tokens_earned = 100 WHERE tokens_earned = 50;

-- ====================================
-- 3. MILESTONE BONUSES TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS milestone_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  milestone_type TEXT NOT NULL CHECK (milestone_type IN ('referral_5', 'referral_10', 'referral_25', 'feedback_10', 'feedback_50', 'feedback_100', 'social_share', 'company_referral')),
  milestone_value INTEGER NOT NULL, -- Number achieved (e.g., 5 for referral_5)
  tokens_awarded INTEGER NOT NULL,
  achieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  
  -- Prevent duplicate milestone bonuses
  UNIQUE(subscriber_id, milestone_type, milestone_value)
);

CREATE INDEX IF NOT EXISTS idx_milestone_bonuses_subscriber_id ON milestone_bonuses(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_milestone_bonuses_type ON milestone_bonuses(milestone_type);

-- ====================================
-- 4. SOCIAL SHARING REWARDS TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS social_sharing_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('twitter', 'linkedin', 'facebook', 'instagram', 'youtube', 'blog', 'review_site')),
  share_type TEXT NOT NULL CHECK (share_type IN ('post', 'story', 'review', 'testimonial', 'case_study')),
  share_url TEXT,
  engagement_count INTEGER DEFAULT 0,
  tokens_awarded INTEGER NOT NULL,
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_social_sharing_subscriber_id ON social_sharing_rewards(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_social_sharing_platform ON social_sharing_rewards(platform);
CREATE INDEX IF NOT EXISTS idx_social_sharing_status ON social_sharing_rewards(verification_status);

-- ====================================
-- 5. COMPANY REFERRALS TABLE
-- ====================================

CREATE TABLE IF NOT EXISTS company_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  company_email TEXT NOT NULL,
  contact_person TEXT,
  employees_count INTEGER DEFAULT 0,
  subscribers_converted INTEGER DEFAULT 0,
  tokens_awarded INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'converted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  converted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_company_referrals_referrer_id ON company_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_company_referrals_status ON company_referrals(status);

-- ====================================
-- 6. ENHANCED FEEDBACK REWARDS
-- ====================================

-- Add quality scoring to feedback rewards
ALTER TABLE feedback_rewards ADD COLUMN IF NOT EXISTS quality_score INTEGER CHECK (quality_score >= 1 AND quality_score <= 5);
ALTER TABLE feedback_rewards ADD COLUMN IF NOT EXISTS feedback_category TEXT CHECK (feedback_category IN ('basic', 'detailed', 'critical'));
ALTER TABLE feedback_rewards ADD COLUMN IF NOT EXISTS multiplier_applied DECIMAL(3,2) DEFAULT 1.0;

-- Update default tokens_awarded to new amount (10 instead of 5)
ALTER TABLE feedback_rewards ALTER COLUMN tokens_awarded SET DEFAULT 10;

-- ====================================
-- 7. ROW LEVEL SECURITY FOR NEW TABLES
-- ====================================

-- Enable RLS on new tables
ALTER TABLE milestone_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_sharing_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_referrals ENABLE ROW LEVEL SECURITY;

-- Milestone bonuses: Users can see their own bonuses
CREATE POLICY "Users can view their own milestone bonuses" ON milestone_bonuses
  FOR SELECT USING (
    subscriber_id IN (
      SELECT id FROM subscribers WHERE user_id = auth.uid()
    )
  );

-- Social sharing rewards: Users can see their own rewards
CREATE POLICY "Users can view their own social sharing rewards" ON social_sharing_rewards
  FOR SELECT USING (
    subscriber_id IN (
      SELECT id FROM subscribers WHERE user_id = auth.uid()
    )
  );

-- Company referrals: Users can see their own referrals
CREATE POLICY "Users can view their own company referrals" ON company_referrals
  FOR SELECT USING (
    referrer_id IN (
      SELECT id FROM subscribers WHERE user_id = auth.uid()
    )
  );

-- Admin policies for new tables
CREATE POLICY "Only admins can manage milestone bonuses" ON milestone_bonuses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Only admins can manage social sharing rewards" ON social_sharing_rewards
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Only admins can manage company referrals" ON company_referrals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- ====================================
-- 8. ENHANCED HELPER FUNCTIONS
-- ====================================

-- Updated function to process referral with tiered system
CREATE OR REPLACE FUNCTION process_referral_signup_enhanced(
  p_new_subscriber_id UUID,
  p_referral_code UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id UUID;
  v_referrer_total_referrals INTEGER := 0;
  v_tokens_to_award INTEGER;
  v_referral_tier INTEGER := 1;
  v_referrer_user_id UUID;
  v_milestone_bonus INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Find the referrer
  SELECT id, total_referrals INTO v_referrer_id, v_referrer_total_referrals
  FROM subscribers 
  WHERE referral_code = p_referral_code;
  
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;
  
  -- Determine referral tier and tokens based on current referrals
  IF v_referrer_total_referrals >= 15 THEN
    v_referral_tier := 3;
    v_tokens_to_award := 200;
  ELSIF v_referrer_total_referrals >= 5 THEN
    v_referral_tier := 2;
    v_tokens_to_award := 150;
  ELSE
    v_referral_tier := 1;
    v_tokens_to_award := 100;
  END IF;
  
  -- Update referred_by in new subscriber
  UPDATE subscribers 
  SET referred_by = v_referrer_id 
  WHERE id = p_new_subscriber_id;
  
  -- Insert referral record with tier info
  INSERT INTO referrals (referrer_id, referred_id, referral_code, tokens_earned, referral_tier)
  VALUES (v_referrer_id, p_new_subscriber_id, p_referral_code, v_tokens_to_award, v_referral_tier);
  
  -- Update referrer's bonus tokens, referral count, and tier
  UPDATE subscribers 
  SET 
    bonus_tokens = bonus_tokens + v_tokens_to_award,
    total_referrals = total_referrals + 1,
    referral_tier = CASE 
      WHEN total_referrals + 1 >= 15 THEN 3
      WHEN total_referrals + 1 >= 5 THEN 2
      ELSE 1
    END
  WHERE id = v_referrer_id;
  
  -- Check for milestone bonuses
  CASE v_referrer_total_referrals + 1
    WHEN 5 THEN v_milestone_bonus := 500;
    WHEN 10 THEN v_milestone_bonus := 1000;
    WHEN 25 THEN v_milestone_bonus := 2500;
    ELSE v_milestone_bonus := 0;
  END CASE;
  
  -- Award milestone bonus if applicable
  IF v_milestone_bonus > 0 THEN
    INSERT INTO milestone_bonuses (subscriber_id, milestone_type, milestone_value, tokens_awarded)
    VALUES (v_referrer_id, 'referral_' || (v_referrer_total_referrals + 1), v_referrer_total_referrals + 1, v_milestone_bonus);
    
    UPDATE subscribers 
    SET 
      bonus_tokens = bonus_tokens + v_milestone_bonus,
      milestone_bonuses_earned = milestone_bonuses_earned + v_milestone_bonus
    WHERE id = v_referrer_id;
  END IF;
  
  -- Get referrer's user_id if linked to auth.users
  SELECT user_id INTO v_referrer_user_id 
  FROM subscribers 
  WHERE id = v_referrer_id AND user_id IS NOT NULL;
  
  -- Add tokens to the referrer's account if they're activated
  IF v_referrer_user_id IS NOT NULL THEN
    INSERT INTO token_transactions (user_id, amount, transaction_type, description)
    VALUES (v_referrer_user_id, v_tokens_to_award + v_milestone_bonus, 'referral_bonus', 
            'Referral bonus (Tier ' || v_referral_tier || ') + milestone bonus');
  END IF;
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'tokens_awarded', v_tokens_to_award,
    'referral_tier', v_referral_tier,
    'milestone_bonus', v_milestone_bonus,
    'total_referrals', v_referrer_total_referrals + 1
  );
  
  RETURN v_result;
END;
$$;

-- Enhanced function to award feedback tokens with quality scoring
CREATE OR REPLACE FUNCTION award_feedback_tokens_enhanced(
  p_feedback_id UUID,
  p_admin_id UUID,
  p_quality_score INTEGER DEFAULT 3,
  p_feedback_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_email TEXT;
  v_user_id UUID;
  v_admin_user_id UUID;
  v_base_tokens INTEGER := 10;
  v_tokens_to_award INTEGER;
  v_feedback_category TEXT := 'basic';
  v_multiplier DECIMAL(3,2) := 1.0;
  v_subscriber_id UUID;
  v_result JSONB;
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
    RETURN jsonb_build_object('success', false, 'error', 'Feedback not found');
  END IF;
  
  -- Determine feedback category and tokens based on quality score and notes
  IF p_quality_score >= 5 OR (p_feedback_notes IS NOT NULL AND length(p_feedback_notes) > 100) THEN
    v_feedback_category := 'critical';
    v_tokens_to_award := 50;
  ELSIF p_quality_score >= 4 OR (p_feedback_notes IS NOT NULL AND length(p_feedback_notes) > 50) THEN
    v_feedback_category := 'detailed';
    v_tokens_to_award := 25;
  ELSE
    v_feedback_category := 'basic';
    v_tokens_to_award := v_base_tokens;
  END IF;
  
  -- Get subscriber info for multiplier
  SELECT id, trusted_feedback_multiplier INTO v_subscriber_id, v_multiplier
  FROM subscribers 
  WHERE email = v_user_email;
  
  -- Apply trusted user multiplier if applicable
  IF v_multiplier > 1.0 THEN
    v_tokens_to_award := ROUND(v_tokens_to_award * v_multiplier);
  END IF;
  
  -- Mark feedback as approved
  UPDATE image_feedback 
  SET 
    admin_approved = TRUE,
    approved_by = (SELECT id FROM admin_users WHERE user_id = p_admin_id),
    approved_at = NOW(),
    tokens_earned = v_tokens_to_award,
    quality_score = p_quality_score
  WHERE id = p_feedback_id;
  
  -- Insert enhanced reward record
  INSERT INTO feedback_rewards (feedback_id, user_email, user_id, tokens_awarded, awarded_by, quality_score, feedback_category, multiplier_applied)
  VALUES (
    p_feedback_id, 
    v_user_email, 
    v_user_id, 
    v_tokens_to_award,
    (SELECT id FROM admin_users WHERE user_id = p_admin_id),
    p_quality_score,
    v_feedback_category,
    v_multiplier
  );
  
  -- If user is registered and activated, add tokens to their balance
  IF v_user_id IS NOT NULL THEN
    INSERT INTO token_transactions (user_id, amount, transaction_type, description)
    VALUES (v_user_id, v_tokens_to_award, 'feedback_reward', 
            'Enhanced feedback reward (' || v_feedback_category || ')');
  ELSE
    -- User not yet registered, add bonus tokens to their future account
    UPDATE subscribers 
    SET bonus_tokens = bonus_tokens + v_tokens_to_award 
    WHERE email = v_user_email;
  END IF;
  
  -- Check for feedback milestone bonuses
  IF v_subscriber_id IS NOT NULL THEN
    DECLARE
      v_approved_feedback_count INTEGER;
      v_milestone_bonus INTEGER := 0;
    BEGIN
      SELECT COUNT(*) INTO v_approved_feedback_count
      FROM image_feedback 
      WHERE user_email = v_user_email AND admin_approved = TRUE;
      
      -- Award milestone bonuses
      IF v_approved_feedback_count = 10 THEN
        v_milestone_bonus := 100;
        INSERT INTO milestone_bonuses (subscriber_id, milestone_type, milestone_value, tokens_awarded)
        VALUES (v_subscriber_id, 'feedback_10', 10, v_milestone_bonus);
      ELSIF v_approved_feedback_count = 50 THEN
        v_milestone_bonus := 500;
        INSERT INTO milestone_bonuses (subscriber_id, milestone_type, milestone_value, tokens_awarded)
        VALUES (v_subscriber_id, 'feedback_50', 50, v_milestone_bonus);
      ELSIF v_approved_feedback_count = 100 THEN
        v_milestone_bonus := 1000;
        INSERT INTO milestone_bonuses (subscriber_id, milestone_type, milestone_value, tokens_awarded)
        VALUES (v_subscriber_id, 'feedback_100', 100, v_milestone_bonus);
      END IF;
      
      -- Update subscriber with milestone bonus
      IF v_milestone_bonus > 0 THEN
        UPDATE subscribers 
        SET 
          bonus_tokens = bonus_tokens + v_milestone_bonus,
          milestone_bonuses_earned = milestone_bonuses_earned + v_milestone_bonus
        WHERE id = v_subscriber_id;
      END IF;
    END;
  END IF;
  
  -- Log admin action
  INSERT INTO admin_actions_log (admin_id, action_type, target_id, target_type, action_details)
  VALUES (
    (SELECT id FROM admin_users WHERE user_id = p_admin_id),
    'approve_feedback',
    p_feedback_id,
    'feedback',
    jsonb_build_object(
      'tokens_awarded', v_tokens_to_award, 
      'user_email', v_user_email,
      'quality_score', p_quality_score,
      'feedback_category', v_feedback_category,
      'multiplier_applied', v_multiplier
    )
  );
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'tokens_awarded', v_tokens_to_award,
    'feedback_category', v_feedback_category,
    'quality_score', p_quality_score,
    'multiplier_applied', v_multiplier
  );
  
  RETURN v_result;
END;
$$;

-- Function to process social sharing rewards
CREATE OR REPLACE FUNCTION process_social_sharing_reward(
  p_subscriber_id UUID,
  p_platform TEXT,
  p_share_type TEXT,
  p_share_url TEXT DEFAULT NULL,
  p_engagement_count INTEGER DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tokens_to_award INTEGER;
  v_result JSONB;
BEGIN
  -- Determine tokens based on share type
  CASE p_share_type
    WHEN 'case_study' THEN v_tokens_to_award := 200;
    WHEN 'testimonial' THEN v_tokens_to_award := 100;
    WHEN 'review' THEN v_tokens_to_award := 100;
    WHEN 'post' THEN v_tokens_to_award := 50;
    WHEN 'story' THEN v_tokens_to_award := 25;
    ELSE v_tokens_to_award := 25;
  END CASE;
  
  -- Bonus for high engagement
  IF p_engagement_count > 100 THEN
    v_tokens_to_award := v_tokens_to_award + 50;
  ELSIF p_engagement_count > 50 THEN
    v_tokens_to_award := v_tokens_to_award + 25;
  ELSIF p_engagement_count > 10 THEN
    v_tokens_to_award := v_tokens_to_award + 10;
  END IF;
  
  -- Insert social sharing reward
  INSERT INTO social_sharing_rewards (subscriber_id, platform, share_type, share_url, engagement_count, tokens_awarded)
  VALUES (p_subscriber_id, p_platform, p_share_type, p_share_url, p_engagement_count, v_tokens_to_award);
  
  -- Update subscriber social shares count
  UPDATE subscribers 
  SET social_shares_count = social_shares_count + 1
  WHERE id = p_subscriber_id;
  
  v_result := jsonb_build_object(
    'success', true,
    'tokens_awarded', v_tokens_to_award,
    'status', 'pending_verification'
  );
  
  RETURN v_result;
END;
$$;

COMMIT;

-- ====================================
-- 9. VERIFICATION QUERIES
-- ====================================

-- Verify new tables exist
SELECT 
  schemaname, 
  tablename, 
  tableowner 
FROM pg_tables 
WHERE tablename IN ('milestone_bonuses', 'social_sharing_rewards', 'company_referrals')
  AND schemaname = 'public';

-- Verify updated columns in subscribers
SELECT 
  column_name, 
  data_type, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'subscribers' 
  AND column_name IN ('referral_tier', 'milestone_bonuses_earned', 'bonus_tokens')
  AND table_schema = 'public';
