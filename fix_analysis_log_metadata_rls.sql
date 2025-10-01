-- Fix RLS policies for analysis_log_metadata table
-- This script creates the table if it doesn't exist and sets up proper RLS policies

-- Create the analysis_log_metadata table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.analysis_log_metadata (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    execution_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    total_images INTEGER DEFAULT 0,
    total_corrections INTEGER DEFAULT 0,
    correction_types JSONB DEFAULT '{}',
    category TEXT,
    app_version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_analysis_log_metadata_user_id ON public.analysis_log_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_log_metadata_execution_id ON public.analysis_log_metadata(execution_id);
CREATE INDEX IF NOT EXISTS idx_analysis_log_metadata_created_at ON public.analysis_log_metadata(created_at);

-- Enable RLS on the table
ALTER TABLE public.analysis_log_metadata ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert their own analysis log metadata" ON public.analysis_log_metadata;
DROP POLICY IF EXISTS "Users can view their own analysis log metadata" ON public.analysis_log_metadata;
DROP POLICY IF EXISTS "Users can update their own analysis log metadata" ON public.analysis_log_metadata;
DROP POLICY IF EXISTS "Users can delete their own analysis log metadata" ON public.analysis_log_metadata;

-- Create RLS policies

-- INSERT policy: Users can insert their own metadata
CREATE POLICY "Users can insert their own analysis log metadata"
ON public.analysis_log_metadata
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- SELECT policy: Users can view their own metadata
CREATE POLICY "Users can view their own analysis log metadata"
ON public.analysis_log_metadata
FOR SELECT
USING (auth.uid() = user_id);

-- UPDATE policy: Users can update their own metadata
CREATE POLICY "Users can update their own analysis log metadata"
ON public.analysis_log_metadata
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- DELETE policy: Users can delete their own metadata
CREATE POLICY "Users can delete their own analysis log metadata"
ON public.analysis_log_metadata
FOR DELETE
USING (auth.uid() = user_id);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_log_metadata TO authenticated;

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_analysis_log_metadata_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic updated_at timestamp
DROP TRIGGER IF EXISTS update_analysis_log_metadata_updated_at ON public.analysis_log_metadata;
CREATE TRIGGER update_analysis_log_metadata_updated_at
    BEFORE UPDATE ON public.analysis_log_metadata
    FOR EACH ROW
    EXECUTE FUNCTION public.update_analysis_log_metadata_updated_at();

-- Verify the policies work by testing with a sample user
-- Note: This requires a valid user UUID, replace with actual user ID for testing
-- SELECT policy_name, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'analysis_log_metadata';

COMMENT ON TABLE public.analysis_log_metadata IS 'Metadata for analysis log files stored in Supabase Storage. Used for searching and organizing log files.';
COMMENT ON COLUMN public.analysis_log_metadata.execution_id IS 'Unique identifier for the desktop app execution that generated this log';
COMMENT ON COLUMN public.analysis_log_metadata.user_id IS 'User who performed the analysis';
COMMENT ON COLUMN public.analysis_log_metadata.storage_path IS 'Path to the log file in Supabase Storage (analysis-logs bucket)';
COMMENT ON COLUMN public.analysis_log_metadata.total_images IS 'Total number of images processed in this execution';
COMMENT ON COLUMN public.analysis_log_metadata.total_corrections IS 'Total number of corrections applied during analysis';
COMMENT ON COLUMN public.analysis_log_metadata.correction_types IS 'JSON object with counts for each correction type (OCR, TEMPORAL, FUZZY, etc.)';
COMMENT ON COLUMN public.analysis_log_metadata.category IS 'Category/sport type for this analysis execution';
COMMENT ON COLUMN public.analysis_log_metadata.app_version IS 'Version of the desktop app that created this log';