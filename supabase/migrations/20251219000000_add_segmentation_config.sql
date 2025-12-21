-- Migration: Add segmentation_config to sport_categories
-- Date: 2025-12-19
-- Description: Adds support for custom YOLO models with per-category class filtering

-- Add segmentation_config column
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS segmentation_config JSONB DEFAULT '{}'::jsonb;

-- Add comment explaining the structure
COMMENT ON COLUMN sport_categories.segmentation_config IS
'Configuration for YOLO instance segmentation per category.
Structure:
{
  "model_id": "yolov11-detector-v1",      -- Model identifier
  "relevant_classes": ["vehicle"],         -- Classes to detect for this category
  "confidence_threshold": 0.3,             -- Min confidence (0-1)
  "iou_threshold": 0.45,                   -- NMS IoU threshold
  "max_detections": 5                      -- Max detections per image
}';

-- Update motorsport category
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["vehicle"],
  "confidence_threshold": 0.30,
  "iou_threshold": 0.45,
  "max_detections": 5
}'::jsonb
WHERE code = 'motorsport';

-- Update motorsport_v2 category (if exists)
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["vehicle"],
  "confidence_threshold": 0.30,
  "iou_threshold": 0.45,
  "max_detections": 5
}'::jsonb
WHERE code = 'motorsport_v2';

-- Update motocross category
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["rider", "helmet"],
  "confidence_threshold": 0.25,
  "iou_threshold": 0.40,
  "max_detections": 3
}'::jsonb
WHERE code = 'motocross';

-- Update running category
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["runner", "bib-number"],
  "confidence_threshold": 0.35,
  "iou_threshold": 0.50,
  "max_detections": 3
}'::jsonb
WHERE code = 'running';

-- Update cycling category
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["rider", "bib-number"],
  "confidence_threshold": 0.30,
  "iou_threshold": 0.45,
  "max_detections": 3
}'::jsonb
WHERE code = 'cycling';

-- Update rally category (if exists)
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["vehicle"],
  "confidence_threshold": 0.30,
  "iou_threshold": 0.45,
  "max_detections": 3
}'::jsonb
WHERE code = 'rally';

-- Update endurance-wec category (if exists)
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["vehicle"],
  "confidence_threshold": 0.25,
  "iou_threshold": 0.40,
  "max_detections": 5
}'::jsonb
WHERE code = 'endurance-wec';

-- Update altro (generic) category
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["vehicle", "rider", "runner", "soccer-player"],
  "confidence_threshold": 0.30,
  "iou_threshold": 0.45,
  "max_detections": 5
}'::jsonb
WHERE code = 'altro';

-- Fallback for categories without specific config (use all classes)
UPDATE sport_categories
SET segmentation_config = '{
  "model_id": "yolov11-detector-v1",
  "relevant_classes": ["vehicle", "rider", "runner", "bib-number", "helmet", "soccer-player"],
  "confidence_threshold": 0.30,
  "iou_threshold": 0.45,
  "max_detections": 5
}'::jsonb
WHERE segmentation_config = '{}'::jsonb OR segmentation_config IS NULL;
