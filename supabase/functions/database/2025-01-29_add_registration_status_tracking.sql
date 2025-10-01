-- Migration: Add registration status tracking to subscribers table
-- Date: 2025-01-29
-- Purpose: Track users who have access but haven't completed registration

BEGIN;

-- Add registration_status column to subscribers table
ALTER TABLE subscribers 
ADD COLUMN IF NOT EXISTS registration_status TEXT DEFAULT 'access_granted' 
CHECK (registration_status IN (
  'access_granted',     -- User has been given access but hasn't started activation
  'code_verification',  -- User is in the process of verifying their access code
  'setting_password',   -- User has verified code and is setting up their account
  'completed',          -- User has fully completed registration and can use the app
  'abandoned'           -- User started but didn't complete registration (inactive for 30+ days)
));

-- Add index for better performance on status queries
CREATE INDEX IF NOT EXISTS idx_subscribers_registration_status ON subscribers(registration_status);

-- Add timestamps to track registration progress
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS code_verification_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS password_setup_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS registration_completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for timestamp queries
CREATE INDEX IF NOT EXISTS idx_subscribers_last_activity ON subscribers(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_subscribers_registration_completed ON subscribers(registration_completed_at);

-- Update existing subscribers based on their current state
-- Users with user_id are considered completed
UPDATE subscribers 
SET 
  registration_status = 'completed',
  registration_completed_at = COALESCE(last_activity_at, signup_date)
WHERE user_id IS NOT NULL AND registration_status = 'access_granted';

-- Users with access but no user_id remain as access_granted
-- (This is already the default value)

-- Function to update registration status based on user actions
CREATE OR REPLACE FUNCTION update_registration_status(
  p_subscriber_email TEXT,
  p_new_status TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
  v_current_status TEXT;
BEGIN
  -- Find subscriber by email
  SELECT id, registration_status INTO v_subscriber_id, v_current_status
  FROM subscribers 
  WHERE email = p_subscriber_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Update status and corresponding timestamp
  CASE p_new_status
    WHEN 'code_verification' THEN
      UPDATE subscribers 
      SET 
        registration_status = p_new_status,
        code_verification_started_at = NOW(),
        last_activity_at = NOW()
      WHERE id = v_subscriber_id;
      
    WHEN 'setting_password' THEN
      UPDATE subscribers 
      SET 
        registration_status = p_new_status,
        password_setup_started_at = NOW(),
        last_activity_at = NOW()
      WHERE id = v_subscriber_id;
      
    WHEN 'completed' THEN
      UPDATE subscribers 
      SET 
        registration_status = p_new_status,
        registration_completed_at = NOW(),
        last_activity_at = NOW(),
        user_id = COALESCE(p_user_id, user_id)
      WHERE id = v_subscriber_id;
      
    WHEN 'abandoned' THEN
      UPDATE subscribers 
      SET 
        registration_status = p_new_status,
        last_activity_at = NOW()
      WHERE id = v_subscriber_id;
      
    ELSE
      UPDATE subscribers 
      SET 
        registration_status = p_new_status,
        last_activity_at = NOW()
      WHERE id = v_subscriber_id;
  END CASE;
  
  RETURN TRUE;
END;
$$;

-- Function to automatically mark abandoned registrations
-- This should be called periodically (e.g., daily cron job)
CREATE OR REPLACE FUNCTION mark_abandoned_registrations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- Mark as abandoned if no activity for 30+ days and not completed
  UPDATE subscribers 
  SET registration_status = 'abandoned'
  WHERE 
    registration_status != 'completed' 
    AND registration_status != 'abandoned'
    AND (
      last_activity_at < NOW() - INTERVAL '30 days'
      OR (last_activity_at IS NULL AND signup_date < NOW() - INTERVAL '30 days')
    );
    
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

COMMIT;

-- Verification queries
SELECT 
  registration_status, 
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
FROM subscribers 
GROUP BY registration_status
ORDER BY count DESC;

-- Show recent registration activity
SELECT 
  email,
  name,
  registration_status,
  has_access,
  user_id IS NOT NULL as is_activated,
  code_verification_started_at,
  password_setup_started_at,
  registration_completed_at,
  last_activity_at
FROM subscribers 
WHERE has_access = true
ORDER BY 
  CASE registration_status
    WHEN 'access_granted' THEN 1
    WHEN 'code_verification' THEN 2
    WHEN 'setting_password' THEN 3
    WHEN 'completed' THEN 4
    WHEN 'abandoned' THEN 5
  END,
  signup_date DESC
LIMIT 20;