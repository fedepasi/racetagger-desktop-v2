-- Fix RLS policies for analysis_log_metadata table
-- Both user_id and auth.uid() are UUID type, no casting needed

-- Ensure RLS is enabled on the table
ALTER TABLE public.analysis_log_metadata ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert their own analysis log metadata" ON public.analysis_log_metadata;
DROP POLICY IF EXISTS "Users can view their own analysis log metadata" ON public.analysis_log_metadata;
DROP POLICY IF EXISTS "Users can update their own analysis log metadata" ON public.analysis_log_metadata;
DROP POLICY IF EXISTS "Users can delete their own analysis log metadata" ON public.analysis_log_metadata;

-- Create RLS policies (UUID = UUID comparison, no casting needed)

-- INSERT policy: Users can insert their own metadata
CREATE POLICY "Users can insert their own analysis log metadata"
ON public.analysis_log_metadata
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- SELECT policy: Users can view their own metadata
CREATE POLICY "Users can view their own analysis log metadata"
ON public.analysis_log_metadata
FOR SELECT
USING (user_id = auth.uid());

-- UPDATE policy: Users can update their own metadata
CREATE POLICY "Users can update their own analysis log metadata"
ON public.analysis_log_metadata
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- DELETE policy: Users can delete their own metadata
CREATE POLICY "Users can delete their own analysis log metadata"
ON public.analysis_log_metadata
FOR DELETE
USING (user_id = auth.uid());

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_log_metadata TO authenticated;

-- Verify the policies were created correctly
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'analysis_log_metadata';