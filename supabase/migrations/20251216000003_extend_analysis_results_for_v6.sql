-- Migration: Extend analysis_results table with V6-specific columns
-- These columns are nullable to maintain backward compatibility with V2/V3/V4/V5

-- Add V6 crop+context analysis columns
ALTER TABLE public.analysis_results
ADD COLUMN IF NOT EXISTS crop_analysis JSONB,
ADD COLUMN IF NOT EXISTS context_analysis JSONB,
ADD COLUMN IF NOT EXISTS edge_function_version INTEGER DEFAULT 3;

-- Comments for documentation
COMMENT ON COLUMN public.analysis_results.crop_analysis IS 'V6: Array of individual crop analysis results with bounding boxes';
COMMENT ON COLUMN public.analysis_results.context_analysis IS 'V6: Contextual analysis from negative/masked image';
COMMENT ON COLUMN public.analysis_results.edge_function_version IS 'Version of edge function that produced this analysis (3, 4, 5, or 6)';

-- Index for filtering by version
CREATE INDEX IF NOT EXISTS idx_analysis_results_edge_version ON public.analysis_results(edge_function_version);
