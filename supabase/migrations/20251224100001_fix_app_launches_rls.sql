-- Migration: Add INSERT policy for app_launches table
-- Purpose: Allow authenticated users to insert their own app launch records
-- Date: 2025-12-24
-- Fixes: "new row violates row-level security policy for table app_launches"

-- ============================================================================
-- Add INSERT policy for authenticated users
-- ============================================================================

-- Users can insert their own launches (user_id must match their auth.uid())
CREATE POLICY "Users can insert own launches"
ON app_launches FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Also allow inserting with NULL user_id (for pre-login tracking)
-- This requires service_role which bypasses RLS anyway, but let's be explicit
CREATE POLICY "Allow anonymous launches before login"
ON app_launches FOR INSERT
WITH CHECK (user_id IS NULL);

-- ============================================================================
-- Add UPDATE policy so users can link anonymous launches to their account
-- ============================================================================

CREATE POLICY "Users can update own launches"
ON app_launches FOR UPDATE
USING (user_id = auth.uid() OR user_id IS NULL)
WITH CHECK (user_id = auth.uid());
