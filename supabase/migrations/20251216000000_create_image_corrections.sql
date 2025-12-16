-- Migration: Create image_corrections table for detailed correction logging
-- This table stores individual correction events that were previously only in JSONL logs

CREATE TABLE IF NOT EXISTS public.image_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_id TEXT NOT NULL,

    -- Correction details
    correction_type TEXT NOT NULL CHECK (correction_type IN ('OCR', 'TEMPORAL', 'FUZZY', 'PARTICIPANT', 'SPONSOR', 'FAST_TRACK')),
    field TEXT NOT NULL,
    original_value JSONB,
    corrected_value JSONB,
    confidence REAL DEFAULT 0.0,
    reason TEXT,
    message TEXT,
    vehicle_index INTEGER,
    details JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_image_corrections_execution_id ON public.image_corrections(execution_id);
CREATE INDEX IF NOT EXISTS idx_image_corrections_user_id ON public.image_corrections(user_id);
CREATE INDEX IF NOT EXISTS idx_image_corrections_image_id ON public.image_corrections(image_id);
CREATE INDEX IF NOT EXISTS idx_image_corrections_type ON public.image_corrections(correction_type);
CREATE INDEX IF NOT EXISTS idx_image_corrections_created_at ON public.image_corrections(created_at);

-- Enable RLS
ALTER TABLE public.image_corrections ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own corrections
CREATE POLICY "users_insert_own_corrections" ON public.image_corrections
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_select_own_corrections" ON public.image_corrections
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_corrections" ON public.image_corrections
    FOR DELETE USING (auth.uid() = user_id);

-- Admin policy for service role
CREATE POLICY "service_role_all_corrections" ON public.image_corrections
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Comments for documentation
COMMENT ON TABLE public.image_corrections IS 'Stores individual correction events (OCR, TEMPORAL, FUZZY, etc.) for audit trail and analytics';
COMMENT ON COLUMN public.image_corrections.correction_type IS 'Type of correction: OCR, TEMPORAL, FUZZY, PARTICIPANT, SPONSOR, FAST_TRACK';
COMMENT ON COLUMN public.image_corrections.message IS 'Human-readable explanation of the correction';
COMMENT ON COLUMN public.image_corrections.details IS 'Type-specific details (e.g., temporal neighbors, fuzzy scores)';
