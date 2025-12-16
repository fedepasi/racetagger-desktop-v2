-- Migration: Create temporal_clusters table for burst mode and clustering analysis
-- This table stores temporal clustering decisions that were previously only in JSONL logs

CREATE TABLE IF NOT EXISTS public.temporal_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Cluster composition
    cluster_images TEXT[] NOT NULL,
    cluster_size INTEGER NOT NULL,

    -- Timing analysis
    duration_ms INTEGER,
    is_burst_mode BOOLEAN DEFAULT FALSE,

    -- Analysis results
    common_number TEXT,
    sport TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_temporal_clusters_execution_id ON public.temporal_clusters(execution_id);
CREATE INDEX IF NOT EXISTS idx_temporal_clusters_user_id ON public.temporal_clusters(user_id);
CREATE INDEX IF NOT EXISTS idx_temporal_clusters_burst_mode ON public.temporal_clusters(is_burst_mode);
CREATE INDEX IF NOT EXISTS idx_temporal_clusters_common_number ON public.temporal_clusters(common_number);

-- Enable RLS
ALTER TABLE public.temporal_clusters ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own clusters
CREATE POLICY "users_insert_own_clusters" ON public.temporal_clusters
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_select_own_clusters" ON public.temporal_clusters
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_clusters" ON public.temporal_clusters
    FOR DELETE USING (auth.uid() = user_id);

-- Admin policy for service role
CREATE POLICY "service_role_all_clusters" ON public.temporal_clusters
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Comments for documentation
COMMENT ON TABLE public.temporal_clusters IS 'Stores temporal clustering analysis results for burst mode detection';
COMMENT ON COLUMN public.temporal_clusters.cluster_images IS 'Array of filenames in this cluster';
COMMENT ON COLUMN public.temporal_clusters.is_burst_mode IS 'True if cluster was detected as burst mode shooting';
COMMENT ON COLUMN public.temporal_clusters.common_number IS 'Most common race number detected across cluster images';
