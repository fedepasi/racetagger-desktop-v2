-- Migration: Create unknown_numbers table for tracking numbers not found in participant preset
-- This table stores unknown number events that were previously only in JSONL logs

CREATE TABLE IF NOT EXISTS public.unknown_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_id TEXT NOT NULL,
    file_name TEXT NOT NULL,

    -- Detection info
    detected_numbers TEXT[] NOT NULL,

    -- Preset context
    participant_preset_name TEXT,
    participant_count INTEGER DEFAULT 0,

    -- Fuzzy matching attempts
    applied_fuzzy_correction BOOLEAN DEFAULT FALSE,
    fuzzy_attempts JSONB,

    -- Organization result
    organization_folder TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_unknown_numbers_execution_id ON public.unknown_numbers(execution_id);
CREATE INDEX IF NOT EXISTS idx_unknown_numbers_user_id ON public.unknown_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_unknown_numbers_image_id ON public.unknown_numbers(image_id);
CREATE INDEX IF NOT EXISTS idx_unknown_numbers_detected ON public.unknown_numbers USING GIN(detected_numbers);
CREATE INDEX IF NOT EXISTS idx_unknown_numbers_created_at ON public.unknown_numbers(created_at);

-- Enable RLS
ALTER TABLE public.unknown_numbers ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own unknown numbers
CREATE POLICY "users_insert_own_unknown_numbers" ON public.unknown_numbers
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_select_own_unknown_numbers" ON public.unknown_numbers
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_unknown_numbers" ON public.unknown_numbers
    FOR DELETE USING (auth.uid() = user_id);

-- Admin policy for service role
CREATE POLICY "service_role_all_unknown_numbers" ON public.unknown_numbers
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Comments for documentation
COMMENT ON TABLE public.unknown_numbers IS 'Tracks detected race numbers that were not found in participant preset';
COMMENT ON COLUMN public.unknown_numbers.detected_numbers IS 'Array of numbers detected by AI that did not match any participant';
COMMENT ON COLUMN public.unknown_numbers.fuzzy_attempts IS 'Array of fuzzy matching attempts: {original, candidate, score, rejected}';
COMMENT ON COLUMN public.unknown_numbers.organization_folder IS 'Folder where the image was organized (e.g., Unknown_Numbers)';
