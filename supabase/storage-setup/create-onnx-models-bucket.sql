-- ============================================================================
-- Supabase Storage Bucket Setup: onnx-models
-- ============================================================================
-- Run this via Supabase Dashboard SQL Editor or use the CLI commands below
--
-- CLI Alternative:
--   supabase storage create onnx-models --public
--
-- Dashboard Steps:
--   1. Go to Storage in Supabase Dashboard
--   2. Click "New bucket"
--   3. Name: "onnx-models"
--   4. Check "Public bucket" (for download access)
--   5. File size limit: 500 MB (524288000 bytes)
-- ============================================================================

-- Create bucket (may fail if already exists or insufficient permissions)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'onnx-models',
  'onnx-models',
  true,                          -- Public for authenticated download
  524288000,                     -- 500MB max file size
  ARRAY['application/octet-stream', 'application/x-onnx']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 524288000;

-- ============================================================================
-- Storage Policies
-- ============================================================================

-- Policy: Anyone can download ONNX models (public bucket)
DROP POLICY IF EXISTS "Public read access for ONNX models" ON storage.objects;
CREATE POLICY "Public read access for ONNX models"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'onnx-models');

-- Policy: Authenticated users can upload (admin check via RLS on model_registry)
DROP POLICY IF EXISTS "Authenticated upload for ONNX models" ON storage.objects;
CREATE POLICY "Authenticated upload for ONNX models"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'onnx-models'
    AND auth.role() = 'authenticated'
  );

-- Policy: Authenticated users can update their uploads
DROP POLICY IF EXISTS "Authenticated update for ONNX models" ON storage.objects;
CREATE POLICY "Authenticated update for ONNX models"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'onnx-models'
    AND auth.role() = 'authenticated'
  );

-- Policy: Authenticated users can delete
DROP POLICY IF EXISTS "Authenticated delete for ONNX models" ON storage.objects;
CREATE POLICY "Authenticated delete for ONNX models"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'onnx-models'
    AND auth.role() = 'authenticated'
  );
