-- Migration: Fix registration status tracking flow
-- Date: 2025-01-29
-- Purpose: Correct registration states to match actual admin approval workflow

BEGIN;

-- Drop existing check constraint to modify allowed values
ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_registration_status_check;

-- Update the registration_status column with correct states and default
ALTER TABLE subscribers 
ALTER COLUMN registration_status SET DEFAULT 'pending_admin_approval';

-- Add corrected check constraint with proper states
ALTER TABLE subscribers 
ADD CONSTRAINT subscribers_registration_status_check 
CHECK (registration_status IN (
  'pending_admin_approval', -- User has signed up, waiting for admin approval
  'access_granted',         -- Admin has approved access, email sent
  'code_verification',      -- User is in the process of verifying their access code
  'setting_password',       -- User has verified code and is setting up their account
  'active',                -- User has fully completed registration and can use the app
  'abandoned'              -- User started but didn't complete registration (inactive for 30+ days)
));

-- Update existing records to reflect correct states:

-- 1. Users who already have user_id (activated) should be 'active'
UPDATE subscribers 
SET registration_status = 'active'
WHERE user_id IS NOT NULL AND registration_status != 'active';

-- 2. Users who have access codes but no user_id should be 'access_granted' 
--    (assuming admin has already approved them)
UPDATE subscribers 
SET registration_status = 'access_granted'
WHERE user_id IS NULL 
  AND access_code IS NOT NULL 
  AND has_access = true
  AND registration_status != 'access_granted';

-- 3. Users without access codes should be 'pending_admin_approval'
UPDATE subscribers 
SET registration_status = 'pending_admin_approval'
WHERE access_code IS NULL 
  AND has_access = false
  AND registration_status != 'pending_admin_approval';

-- Update the helper function to use correct states
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
    WHEN 'access_granted' THEN
      UPDATE subscribers 
      SET 
        registration_status = p_new_status,
        last_activity_at = NOW()
      WHERE id = v_subscriber_id;
      
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
      
    WHEN 'active' THEN
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

-- Update the abandoned registrations function to exclude 'active' users
CREATE OR REPLACE FUNCTION mark_abandoned_registrations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- Mark as abandoned if no activity for 30+ days and not active
  UPDATE subscribers 
  SET registration_status = 'abandoned'
  WHERE 
    registration_status NOT IN ('active', 'abandoned')
    AND (
      last_activity_at < NOW() - INTERVAL '30 days'
      OR (last_activity_at IS NULL AND signup_date < NOW() - INTERVAL '30 days')
    );
    
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

-- Function to help with admin approval workflow
CREATE OR REPLACE FUNCTION approve_subscriber_access(
  p_subscriber_email TEXT,
  p_admin_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscriber_id UUID;
  v_is_admin BOOLEAN := FALSE;
BEGIN
  -- Verify admin permission
  SELECT EXISTS(SELECT 1 FROM admin_users WHERE user_id = p_admin_user_id) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Not an admin user';
  END IF;
  
  -- Find subscriber
  SELECT id INTO v_subscriber_id 
  FROM subscribers 
  WHERE email = p_subscriber_email;
  
  IF v_subscriber_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Update subscriber to access_granted status
  UPDATE subscribers 
  SET 
    registration_status = 'access_granted',
    has_access = true,
    last_activity_at = NOW()
  WHERE id = v_subscriber_id;
  
  RETURN TRUE;
END;
$$;

COMMIT;

-- Verification queries
SELECT 
  registration_status, 
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percentage
FROM subscribers 
GROUP BY registration_status
ORDER BY 
  CASE registration_status
    WHEN 'pending_admin_approval' THEN 1
    WHEN 'access_granted' THEN 2
    WHEN 'code_verification' THEN 3
    WHEN 'setting_password' THEN 4
    WHEN 'active' THEN 5
    WHEN 'abandoned' THEN 6
  END;

-- Show sample of updated records
SELECT 
  email,
  name,
  registration_status,
  has_access,
  access_code IS NOT NULL as has_access_code,
  user_id IS NOT NULL as is_activated,
  signup_date
FROM subscribers 
ORDER BY 
  CASE registration_status
    WHEN 'pending_admin_approval' THEN 1
    WHEN 'access_granted' THEN 2
    WHEN 'code_verification' THEN 3
    WHEN 'setting_password' THEN 4
    WHEN 'active' THEN 5
    WHEN 'abandoned' THEN 6
  END,
  signup_date DESC
LIMIT 10;