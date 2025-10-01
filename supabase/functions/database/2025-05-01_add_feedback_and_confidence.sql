-- Migration: Add IP tracking, confidence level, and feedback table (2025-05-01)

-- 1. Add requester_ip to images
ALTER TABLE images
ADD COLUMN IF NOT EXISTS requester_ip text;

-- 1b. Add requester_geo to images
ALTER TABLE images
ADD COLUMN IF NOT EXISTS requester_geo jsonb;

-- 2. Add confidence_level to analysis_results
ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS confidence_level text;

-- 3. Create image_feedback table
CREATE TABLE IF NOT EXISTS image_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id uuid NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    feedback_type text NOT NULL, -- 'correct', 'incorrect', 'other'
    feedback_notes text,
    submitted_at timestamp with time zone DEFAULT now()
);

-- Optionally, add index for faster lookup
CREATE INDEX IF NOT EXISTS idx_image_feedback_image_id ON image_feedback(image_id);
