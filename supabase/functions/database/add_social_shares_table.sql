-- Add social_shares table for tracking social media sharing verification
CREATE TABLE IF NOT EXISTS social_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'twitter', 'instagram', 'tiktok', 'other')),
  post_url TEXT NOT NULL,
  description TEXT,
  share_type TEXT NOT NULL CHECK (share_type IN ('post', 'story', 'review', 'case_study')),
  estimated_tokens INTEGER NOT NULL,
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  tokens_awarded INTEGER DEFAULT 0,
  verified_by UUID REFERENCES admin_users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, post_url) -- Prevent duplicate submissions of same post
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_social_shares_user_id ON social_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_social_shares_verification_status ON social_shares(verification_status);
CREATE INDEX IF NOT EXISTS idx_social_shares_platform ON social_shares(platform);
CREATE INDEX IF NOT EXISTS idx_social_shares_submitted_at ON social_shares(submitted_at);

-- RLS policies
ALTER TABLE social_shares ENABLE ROW LEVEL SECURITY;

-- Users can only see their own shares
CREATE POLICY "Users can view own social shares" ON social_shares
  FOR SELECT USING (auth.jwt() ->> 'email' = user_email);

-- Users can insert their own shares
CREATE POLICY "Users can insert own social shares" ON social_shares
  FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = user_email);

-- Admins can see and modify all shares
CREATE POLICY "Admin can view all social shares" ON social_shares
  FOR SELECT USING (auth.uid() IN (SELECT user_id FROM admin_users));

CREATE POLICY "Admin can update social shares" ON social_shares
  FOR UPDATE USING (auth.uid() IN (SELECT user_id FROM admin_users));

-- Add social shares tracking to subscribers
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS total_social_shares INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS verified_social_shares INTEGER DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS social_tokens_earned INTEGER DEFAULT 0;

-- Function to update subscriber social stats when share is verified
CREATE OR REPLACE FUNCTION update_subscriber_social_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update subscriber stats when verification status changes to 'verified'
  IF NEW.verification_status = 'verified' AND OLD.verification_status != 'verified' THEN
    UPDATE subscribers 
    SET 
      verified_social_shares = verified_social_shares + 1,
      social_tokens_earned = social_tokens_earned + NEW.tokens_awarded,
      bonus_tokens = bonus_tokens + NEW.tokens_awarded
    WHERE id = NEW.user_id;
  END IF;
  
  -- Revert stats if verification is removed
  IF OLD.verification_status = 'verified' AND NEW.verification_status != 'verified' THEN
    UPDATE subscribers 
    SET 
      verified_social_shares = GREATEST(0, verified_social_shares - 1),
      social_tokens_earned = GREATEST(0, social_tokens_earned - OLD.tokens_awarded),
      bonus_tokens = GREATEST(1500, bonus_tokens - OLD.tokens_awarded) -- Don't go below base 1500
    WHERE id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update subscriber stats
DROP TRIGGER IF EXISTS trigger_update_subscriber_social_stats ON social_shares;
CREATE TRIGGER trigger_update_subscriber_social_stats
  AFTER UPDATE ON social_shares
  FOR EACH ROW
  EXECUTE FUNCTION update_subscriber_social_stats();

-- Function to update total_social_shares when new share is submitted
CREATE OR REPLACE FUNCTION update_total_social_shares()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE subscribers 
  SET total_social_shares = total_social_shares + 1
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for new submissions
DROP TRIGGER IF EXISTS trigger_update_total_social_shares ON social_shares;
CREATE TRIGGER trigger_update_total_social_shares
  AFTER INSERT ON social_shares
  FOR EACH ROW
  EXECUTE FUNCTION update_total_social_shares();