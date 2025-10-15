-- Add tracking fields to executions table for better monitoring and statistics
-- This migration adds fields that are used by the UnifiedImageProcessor to track execution progress

-- Add processed_images field to track how many images have been successfully processed
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS processed_images INTEGER DEFAULT 0;

-- Add total_images field to track total number of images in the execution
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS total_images INTEGER DEFAULT 0;

-- Add category field to track the sport category (motorsport, running, altro)
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'motorsport';

-- Add execution_settings JSONB field to store execution configuration
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS execution_settings JSONB DEFAULT '{}'::jsonb;

-- Add helpful comments
COMMENT ON COLUMN executions.processed_images IS 'Number of images successfully processed in this execution';
COMMENT ON COLUMN executions.total_images IS 'Total number of images to process in this execution';
COMMENT ON COLUMN executions.category IS 'Sport category for this execution (motorsport, running, altro)';
COMMENT ON COLUMN executions.execution_settings IS 'JSONB object containing execution configuration (maxDimension, jpegQuality, hasParticipantPreset, etc.)';

-- Create index for filtering by category
CREATE INDEX IF NOT EXISTS idx_executions_category ON executions(category);

-- Create index for filtering by status
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
