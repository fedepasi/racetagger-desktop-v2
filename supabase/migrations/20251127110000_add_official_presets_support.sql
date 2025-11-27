-- Migration: Add Official RT Presets support
-- Official presets are admin-managed, read-only for users, and duplicatable

-- Add is_official flag and approval tracking columns
ALTER TABLE participant_presets
ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient queries on official presets
CREATE INDEX IF NOT EXISTS idx_participant_presets_official
ON participant_presets(is_official)
WHERE is_official = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN participant_presets.is_official IS 'True if this is an official RT preset managed by admins';
COMMENT ON COLUMN participant_presets.approved_by IS 'Admin user who approved this preset as official';
COMMENT ON COLUMN participant_presets.approved_at IS 'Timestamp when preset was approved as official';

-- Update RLS policy to allow all authenticated users to read official presets
-- First, check if policy exists and drop it if needed
DO $$
BEGIN
    -- Drop existing select policy if it exists
    DROP POLICY IF EXISTS "Users can view own presets" ON participant_presets;
    DROP POLICY IF EXISTS "Official presets readable by all" ON participant_presets;
EXCEPTION
    WHEN undefined_object THEN
        NULL; -- Policy doesn't exist, continue
END $$;

-- Create new policies
-- Policy 1: Users can view their own presets
CREATE POLICY "Users can view own presets" ON participant_presets
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy 2: All authenticated users can view official presets
CREATE POLICY "Official presets readable by all" ON participant_presets
    FOR SELECT
    USING (is_official = TRUE);

-- Policy for admins to manage official presets (uses admin_users table)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Admins can manage official presets" ON participant_presets;
EXCEPTION
    WHEN undefined_object THEN
        NULL;
END $$;

CREATE POLICY "Admins can manage official presets" ON participant_presets
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM admin_users
            WHERE admin_users.user_id = auth.uid()
        )
    );
