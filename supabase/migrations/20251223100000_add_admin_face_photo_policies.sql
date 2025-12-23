-- Migration: Fix RLS Policies for Preset Face Photos
-- Date: 2025-12-23
-- Description: Correct RLS policies following Supabase best practices
-- Reference: https://supabase.com/docs/guides/database/postgres/row-level-security
--
-- Business Logic:
-- 1. Official Presets (is_official = true): READ-ONLY for everyone, only service_role can modify
-- 2. User Presets (is_official = false): Users can only modify their OWN presets
-- 3. To make a preset official: Admin COPIES it to create a new official preset
-- 4. Users can DUPLICATE official presets to get their own modifiable copy

-- =====================================================
-- 1. Drop existing policies
-- =====================================================
DROP POLICY IF EXISTS "Users can read own preset face photos" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users can insert face photos for own presets" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users can update face photos for own presets" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users can delete face photos for own presets" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users or admins can insert face photos" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users or admins can update face photos" ON preset_participant_face_photos;
DROP POLICY IF EXISTS "Users or admins can delete face photos" ON preset_participant_face_photos;

-- =====================================================
-- 2. SELECT Policy - Anyone can read face photos for:
--    - Their own presets
--    - Public presets
--    - Official presets
-- =====================================================
CREATE POLICY "select_preset_face_photos"
ON preset_participant_face_photos
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND (
      p.user_id = auth.uid()  -- Own preset
      OR p.is_public = true   -- Public preset
      OR p.is_official = true -- Official preset
    )
  )
);

-- =====================================================
-- 3. INSERT Policy - Users can ONLY insert for their OWN NON-OFFICIAL presets
--    Official presets are managed via service_role (backend/admin functions)
-- =====================================================
CREATE POLICY "insert_preset_face_photos"
ON preset_participant_face_photos
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false  -- Cannot modify official presets
  )
);

-- =====================================================
-- 4. UPDATE Policy - Users can ONLY update their OWN NON-OFFICIAL presets
-- =====================================================
CREATE POLICY "update_preset_face_photos"
ON preset_participant_face_photos
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- =====================================================
-- 5. DELETE Policy - Users can ONLY delete from their OWN NON-OFFICIAL presets
-- =====================================================
CREATE POLICY "delete_preset_face_photos"
ON preset_participant_face_photos
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM preset_participants pp
    JOIN participant_presets p ON pp.preset_id = p.id
    WHERE pp.id = preset_participant_face_photos.participant_id
    AND p.user_id = auth.uid()
    AND p.is_official = false
  )
);

-- =====================================================
-- 6. Service Role has full access (for admin operations)
-- =====================================================
-- Note: service_role bypasses RLS by default, so admins using
-- supabase.auth.admin or service_role key can manage official presets

-- =====================================================
-- 7. Storage Bucket Notes
-- =====================================================
-- The storage bucket 'preset-participant-photos' should be created in Supabase Dashboard
-- with these policies:
--
-- SELECT (public read): true (photos need to be viewable)
-- INSERT: authenticated AND (
--   storage.foldername(name)[1] = auth.uid()::text  -- Users can only upload to their own folder
-- )
-- DELETE: same as INSERT
