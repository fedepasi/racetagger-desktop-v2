-- Racetagger V3: Image Annotations Table
-- This table stores bounding box annotations and detection data for images

-- Create image_annotations table
CREATE TABLE IF NOT EXISTS public.image_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id UUID, -- Link to existing execution_tracking for batch operations
  image_id UUID,     -- Optional: Link to processed_images or other image tracking table

  -- Image information
  image_path TEXT NOT NULL,  -- Path in Supabase storage (e.g., "user123/photo.jpg")
  image_url TEXT,            -- Signed URL or public URL for the image
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,

  -- Category and metadata
  category TEXT NOT NULL DEFAULT 'motorsport', -- motorsport, running, cycling, altro
  category_path TEXT,        -- Hierarchical: motorsport/wec/hypercar

  -- Annotations data (JSONB array of detections)
  annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
  /* Expected structure:
  [
    {
      "raceNumber": "51",
      "drivers": ["A. Pier Guidi", "J. Calado"],
      "category": "Hypercar",
      "teamName": "Ferrari AF Corse",
      "otherText": ["Shell", "Santander"],
      "confidence": 0.95,
      "boundingBox": {
        "x": 25.5,
        "y": 30.0,
        "width": 45.0,
        "height": 60.0
      }
    }
  ]
  */

  -- Image metadata
  image_metadata JSONB,  -- EXIF, dimensions, etc.

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'draft', -- draft, reviewed, approved, exported, archived

  -- AI analysis info
  model_used TEXT,           -- gemini-2.5-flash, gemini-2.5-pro, etc.
  analysis_provider TEXT,    -- gemini_2.5_flash_multi, etc.
  execution_time_ms INTEGER,
  tokens_used INTEGER,

  -- Review/quality control
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  quality_score INTEGER CHECK (quality_score >= 1 AND quality_score <= 5),

  -- Export tracking
  exported_at TIMESTAMPTZ,
  export_format TEXT, -- coco_json, yolo_txt, csv, etc.
  export_path TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Version tracking for optimistic locking
  version INTEGER NOT NULL DEFAULT 1
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON public.image_annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_execution_id ON public.image_annotations(execution_id);
CREATE INDEX IF NOT EXISTS idx_annotations_image_path ON public.image_annotations(image_path);
CREATE INDEX IF NOT EXISTS idx_annotations_category ON public.image_annotations(category);
CREATE INDEX IF NOT EXISTS idx_annotations_category_path ON public.image_annotations(category_path);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON public.image_annotations(status);
CREATE INDEX IF NOT EXISTS idx_annotations_created_at ON public.image_annotations(created_at DESC);

-- GIN index for JSONB annotations search
CREATE INDEX IF NOT EXISTS idx_annotations_jsonb ON public.image_annotations USING GIN (annotations);

-- Enable Row Level Security
ALTER TABLE public.image_annotations ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Users can view their own annotations
CREATE POLICY "Users can view own annotations"
  ON public.image_annotations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own annotations
CREATE POLICY "Users can insert own annotations"
  ON public.image_annotations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own annotations
CREATE POLICY "Users can update own annotations"
  ON public.image_annotations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own annotations
CREATE POLICY "Users can delete own annotations"
  ON public.image_annotations
  FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_image_annotations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_image_annotations_updated_at
  BEFORE UPDATE ON public.image_annotations
  FOR EACH ROW
  EXECUTE FUNCTION update_image_annotations_updated_at();

-- View: Annotations with statistics
CREATE OR REPLACE VIEW public.image_annotations_stats AS
SELECT
  user_id,
  category,
  status,
  COUNT(*) as total_annotations,
  COUNT(DISTINCT image_path) as unique_images,
  AVG(jsonb_array_length(annotations)) as avg_detections_per_image,
  SUM(jsonb_array_length(annotations)) as total_detections,
  AVG(execution_time_ms) as avg_execution_time_ms,
  MIN(created_at) as first_annotation_at,
  MAX(created_at) as last_annotation_at
FROM public.image_annotations
GROUP BY user_id, category, status;

-- Grant access to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_annotations TO authenticated;
GRANT SELECT ON public.image_annotations_stats TO authenticated;

-- Comments for documentation
COMMENT ON TABLE public.image_annotations IS 'V3: Stores image annotations with bounding boxes from Gemini AI analysis';
COMMENT ON COLUMN public.image_annotations.annotations IS 'JSONB array of detection objects with boundingBox, raceNumber, drivers, etc.';
COMMENT ON COLUMN public.image_annotations.category_path IS 'Hierarchical category path for efficient filtering and model training organization';
COMMENT ON COLUMN public.image_annotations.status IS 'Workflow status: draft (initial), reviewed (human checked), approved (ready for training), exported (included in training set)';
COMMENT ON COLUMN public.image_annotations.version IS 'Optimistic locking version - increments on each update';
