-- Migration: Visual Tags Table
-- Description: Creates table for storing visual tags extracted by AI for marketing search
-- Date: 2024-12-22

-- Create visual_tags table
CREATE TABLE IF NOT EXISTS visual_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  execution_id UUID REFERENCES executions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,

  -- Tag per categoria (arrays per GIN indexing)
  location_tags TEXT[] DEFAULT '{}',
  weather_tags TEXT[] DEFAULT '{}',
  scene_type_tags TEXT[] DEFAULT '{}',
  subject_tags TEXT[] DEFAULT '{}',
  visual_style_tags TEXT[] DEFAULT '{}',
  emotion_tags TEXT[] DEFAULT '{}',

  -- All tags flattened per ricerca combinata
  all_tags TEXT[] GENERATED ALWAYS AS (
    location_tags || weather_tags || scene_type_tags ||
    subject_tags || visual_style_tags || emotion_tags
  ) STORED,

  -- Participant enrichment (dal recognition result)
  participant_name TEXT,
  participant_team TEXT,
  participant_number TEXT,

  -- Metadata
  confidence_score DECIMAL(3,2),
  model_used TEXT DEFAULT 'gemini-2.5-flash-lite',
  processing_time_ms INTEGER,

  -- Token tracking
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd DECIMAL(10,8),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- One tag record per image
  UNIQUE(image_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_visual_tags_image ON visual_tags(image_id);
CREATE INDEX IF NOT EXISTS idx_visual_tags_user ON visual_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_visual_tags_execution ON visual_tags(execution_id);
CREATE INDEX IF NOT EXISTS idx_visual_tags_created ON visual_tags(created_at DESC);

-- GIN indexes for array search (fast tag filtering)
CREATE INDEX IF NOT EXISTS idx_visual_tags_location ON visual_tags USING GIN(location_tags);
CREATE INDEX IF NOT EXISTS idx_visual_tags_weather ON visual_tags USING GIN(weather_tags);
CREATE INDEX IF NOT EXISTS idx_visual_tags_scene ON visual_tags USING GIN(scene_type_tags);
CREATE INDEX IF NOT EXISTS idx_visual_tags_subject ON visual_tags USING GIN(subject_tags);
CREATE INDEX IF NOT EXISTS idx_visual_tags_style ON visual_tags USING GIN(visual_style_tags);
CREATE INDEX IF NOT EXISTS idx_visual_tags_emotion ON visual_tags USING GIN(emotion_tags);
CREATE INDEX IF NOT EXISTS idx_visual_tags_all ON visual_tags USING GIN(all_tags);

-- Enable RLS
ALTER TABLE visual_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own visual tags"
  ON visual_tags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own visual tags"
  ON visual_tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own visual tags"
  ON visual_tags FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own visual tags"
  ON visual_tags FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypass for edge functions
CREATE POLICY "Service role has full access to visual tags"
  ON visual_tags FOR ALL
  USING (auth.role() = 'service_role');

-- Comment for documentation
COMMENT ON TABLE visual_tags IS 'Stores AI-extracted visual tags for marketing search (location, weather, scene, subjects, etc.)';
COMMENT ON COLUMN visual_tags.all_tags IS 'Auto-generated flattened array of all tags for combined search';
COMMENT ON COLUMN visual_tags.model_used IS 'AI model used for extraction (default: gemini-2.5-flash-lite)';
