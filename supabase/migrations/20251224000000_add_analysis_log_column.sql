-- Migration: Add analysis_log JSONB column to analysis_results
-- Purpose: Store the complete IMAGE_ANALYSIS event from JSONL in the database
-- This enables SQL queries on temporal context, recognition method, visual tags, etc.

-- Add the analysis_log column
ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS analysis_log JSONB;

-- Add comment explaining the column
COMMENT ON COLUMN analysis_results.analysis_log IS
  'Complete IMAGE_ANALYSIS event from JSONL log. Contains: aiResponse, temporalContext, segmentationPreprocessing, visualTags, recognitionMethod, thumbnailPath, etc.';

-- Create index for querying by recognition method
CREATE INDEX IF NOT EXISTS idx_analysis_results_recognition_method
ON analysis_results ((analysis_log->>'recognitionMethod'));

-- Create index for querying by burst mode
CREATE INDEX IF NOT EXISTS idx_analysis_results_burst_mode
ON analysis_results ((analysis_log->'temporalContext'->>'burstMode'));

-- Create GIN index for full JSONB searches (useful for complex queries)
CREATE INDEX IF NOT EXISTS idx_analysis_results_analysis_log_gin
ON analysis_results USING GIN (analysis_log);
