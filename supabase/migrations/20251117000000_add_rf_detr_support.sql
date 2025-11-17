-- Migration: Add RF-DETR Support to Sport Categories
-- Date: 2025-11-17
-- Description: Adds columns for RF-DETR (Roboflow) recognition method configuration

-- Add recognition_method column (default to 'gemini' for backward compatibility)
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS recognition_method TEXT DEFAULT 'gemini'
CHECK (recognition_method IN ('gemini', 'rf-detr'));

-- Add RF-DETR workflow URL
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS rf_detr_workflow_url TEXT;

-- Add RF-DETR API key environment variable name
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS rf_detr_api_key_env TEXT DEFAULT 'ROBOFLOW_DEFAULT_API_KEY';

-- Add comment to explain the columns
COMMENT ON COLUMN sport_categories.recognition_method IS
'Recognition method to use: gemini (Google AI Vision) or rf-detr (Roboflow object detection)';

COMMENT ON COLUMN sport_categories.rf_detr_workflow_url IS
'Roboflow workflow URL for RF-DETR recognition (e.g., https://serverless.roboflow.com/workspace/workflows/workflow-id)';

COMMENT ON COLUMN sport_categories.rf_detr_api_key_env IS
'Environment variable name containing the Roboflow API key (e.g., ROBOFLOW_F1_API_KEY)';

-- Update execution_settings table to track RF-DETR usage
ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS recognition_method TEXT;

ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS recognition_method_version TEXT;

ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS rf_detr_workflow_url TEXT;

ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS rf_detr_detections_count INTEGER DEFAULT 0;

ALTER TABLE execution_settings
ADD COLUMN IF NOT EXISTS rf_detr_total_cost DECIMAL(10, 4) DEFAULT 0.0;

-- Add comments
COMMENT ON COLUMN execution_settings.recognition_method IS
'Recognition method used: gemini or rf-detr';

COMMENT ON COLUMN execution_settings.recognition_method_version IS
'Edge function version used (e.g., V4, V3, V2)';

COMMENT ON COLUMN execution_settings.rf_detr_workflow_url IS
'Roboflow workflow URL used (if RF-DETR was used)';

COMMENT ON COLUMN execution_settings.rf_detr_detections_count IS
'Total number of RF-DETR detections across all images';

COMMENT ON COLUMN execution_settings.rf_detr_total_cost IS
'Total cost of RF-DETR API calls in USD';

-- Example: Create F1 2025 category with RF-DETR (commented out - configure via UI)
-- INSERT INTO sport_categories (
--   code,
--   name,
--   description,
--   recognition_method,
--   rf_detr_workflow_url,
--   rf_detr_api_key_env,
--   edge_function_version,
--   is_active
-- ) VALUES (
--   'f1-2025',
--   'Formula 1 2025',
--   'F1 2025 season with car-specific models (SF-25, MCL39, etc.)',
--   'rf-detr',
--   'https://serverless.roboflow.com/federico-gsbo7/workflows/f1-2025-workflow',
--   'ROBOFLOW_F1_API_KEY',
--   4,
--   true
-- );
