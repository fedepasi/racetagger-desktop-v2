-- Add admin policies for participant_presets and preset_participants tables
-- Migration: 20251017000000_add_admin_policies_for_participant_presets.sql
-- Purpose: Allow admin users to view all participant presets regardless of ownership
-- This enables the admin dashboard to show all users' presets for management purposes

-- Policy for admins to view ALL participant presets
CREATE POLICY "Admins can view all participant presets"
ON participant_presets FOR SELECT
TO authenticated
USING (
  -- Check if user email is in admin list
  -- Note: JWT email claim is lowercase
  auth.jwt() ->> 'email' IN (
    'info@federicopasinetti.it',
    'info@racetagger.cloud',
    'test@admin.com'
  )
);

-- Policy for admins to view ALL preset participants
CREATE POLICY "Admins can view all preset participants"
ON preset_participants FOR SELECT
TO authenticated
USING (
  -- Check if user email is in admin list
  -- Note: JWT email claim is lowercase
  auth.jwt() ->> 'email' IN (
    'info@federicopasinetti.it',
    'info@racetagger.cloud',
    'test@admin.com'
  )
);

-- Add comments for documentation
COMMENT ON POLICY "Admins can view all participant presets" ON participant_presets
IS 'Allows admin users (by email) to view all participant presets regardless of ownership. Used for admin dashboard and user management.';

COMMENT ON POLICY "Admins can view all preset participants" ON preset_participants
IS 'Allows admin users (by email) to view all preset participants regardless of preset ownership. Works in conjunction with admin preset policy.';

-- Note: These policies work in OR with existing user policies
-- Regular users will still only see their own presets + public ones via existing policies
-- Admin users will see everything via these new policies
