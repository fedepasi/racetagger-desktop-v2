-- ============================================
-- AI Model Registry, Provider Configs & Telemetry
-- ============================================
-- Central configuration for AI models, failover chains,
-- and inference performance tracking.
-- Integrates with existing benchmark_* tables.
-- ============================================

-- ==========================================
-- 1. AI Models Registry
-- ==========================================
-- Central registry of all AI models (Gemini, ONNX, etc.)
-- Used by Edge Functions, benchmark system, and admin UI.

CREATE TABLE IF NOT EXISTS ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  code TEXT NOT NULL UNIQUE,              -- 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', etc.
  display_name TEXT NOT NULL,              -- 'Gemini 3 Flash (Preview)'
  provider TEXT NOT NULL,                  -- 'vertex-ai', 'ai-studio', 'local-onnx'
  model_family TEXT NOT NULL,              -- 'gemini-3', 'gemini-2.5', 'yolo'

  -- Availability
  status TEXT NOT NULL DEFAULT 'preview'
    CHECK (status IN ('ga', 'preview', 'deprecated', 'disabled')),
  available_locations TEXT[] NOT NULL DEFAULT '{global}',
  eu_available BOOLEAN GENERATED ALWAYS AS (
    'europe-west1' = ANY(available_locations) OR
    'europe-west3' = ANY(available_locations) OR
    'europe-west4' = ANY(available_locations)
  ) STORED,

  -- Pricing (per 1M tokens)
  input_cost_per_million NUMERIC(10,4),    -- 0.5000
  output_cost_per_million NUMERIC(10,4),   -- 3.0000

  -- Capabilities
  supports_multi_image BOOLEAN DEFAULT false,
  supports_structured_output BOOLEAN DEFAULT false,
  supports_thinking BOOLEAN DEFAULT false,
  max_images_per_request INTEGER DEFAULT 1,
  max_output_tokens INTEGER DEFAULT 4096,

  -- Recommended parameters for this model
  recommended_config JSONB DEFAULT '{}'::jsonb,
  -- e.g. { "thinkingLevel": "MINIMAL", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2 }

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- 2. AI Provider Configs (failover chains)
-- ==========================================
-- Defines the ordered failover chain per sport category.
-- Each row = one provider in the chain.
-- NULL sport_category_id = global default chain.

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_category_id UUID REFERENCES sport_categories(id) ON DELETE CASCADE,

  -- Provider
  ai_model_id UUID NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
  location TEXT NOT NULL,                  -- 'global', 'europe-west4', etc.
  sdk_type TEXT NOT NULL DEFAULT 'vertex'
    CHECK (sdk_type IN ('vertex', 'aistudio')),

  -- Priority in chain (0 = primary, 1 = first fallback, ...)
  priority INTEGER NOT NULL DEFAULT 0,

  -- Purpose
  purpose TEXT NOT NULL DEFAULT 'analysis'
    CHECK (purpose IN ('analysis', 'visual-tagging')),

  -- Activation
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One provider per priority slot per category per purpose
  UNIQUE(sport_category_id, purpose, priority)
);

-- ==========================================
-- 3. AI Inference Telemetry
-- ==========================================
-- Tracks every AI call from production AND benchmarks.
-- source field distinguishes 'production' vs 'benchmark'.

CREATE TABLE IF NOT EXISTS ai_inference_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source context
  source TEXT NOT NULL DEFAULT 'production'
    CHECK (source IN ('production', 'benchmark', 'test')),

  -- Production context (nullable for benchmarks)
  execution_id UUID,
  image_id UUID,
  user_id UUID,
  sport_category_code TEXT,

  -- Benchmark context (nullable for production)
  benchmark_run_id UUID REFERENCES benchmark_runs(id) ON DELETE SET NULL,
  benchmark_dataset_image_id UUID REFERENCES benchmark_dataset_images(id) ON DELETE SET NULL,

  -- Provider used
  ai_model_code TEXT NOT NULL,             -- 'gemini-3-flash-preview' (matches ai_models.code)
  location TEXT NOT NULL,                   -- 'global', 'europe-west4'
  sdk_type TEXT NOT NULL DEFAULT 'vertex',  -- 'vertex', 'aistudio'
  purpose TEXT DEFAULT 'analysis',          -- 'analysis', 'visual-tagging'

  -- Performance
  inference_time_ms INTEGER NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) DEFAULT 0,

  -- Result
  success BOOLEAN NOT NULL,
  error_message TEXT,
  error_code TEXT,                          -- '429', '503', 'TIMEOUT', etc.
  retry_count INTEGER DEFAULT 0,
  was_fallback BOOLEAN DEFAULT false,

  -- Response quality (optional)
  results_count INTEGER,                    -- Number of detections returned
  avg_confidence NUMERIC(5,3),              -- Average confidence of results

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- Indexes
-- ==========================================

-- ai_models
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider);
CREATE INDEX IF NOT EXISTS idx_ai_models_status ON ai_models(status);
CREATE INDEX IF NOT EXISTS idx_ai_models_family ON ai_models(model_family);

-- ai_provider_configs
CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_category ON ai_provider_configs(sport_category_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_model ON ai_provider_configs(ai_model_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_purpose ON ai_provider_configs(sport_category_id, purpose, priority)
  WHERE is_active = true;

-- ai_inference_telemetry
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_model_date ON ai_inference_telemetry(ai_model_code, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_category_date ON ai_inference_telemetry(sport_category_code, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_source ON ai_inference_telemetry(source, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_benchmark_run ON ai_inference_telemetry(benchmark_run_id)
  WHERE benchmark_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_user ON ai_inference_telemetry(user_id, created_at)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_telemetry_success ON ai_inference_telemetry(success, created_at);

-- ==========================================
-- RLS Policies
-- ==========================================

ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_inference_telemetry ENABLE ROW LEVEL SECURITY;

-- ai_models: readable by all authenticated users (it's configuration, not user data)
CREATE POLICY "Authenticated users can read ai_models"
  ON ai_models FOR SELECT
  USING (auth.role() = 'authenticated');

-- ai_models: only service role can modify
CREATE POLICY "Service role manages ai_models"
  ON ai_models FOR ALL
  USING (auth.role() = 'service_role');

-- ai_provider_configs: readable by all authenticated users
CREATE POLICY "Authenticated users can read provider configs"
  ON ai_provider_configs FOR SELECT
  USING (auth.role() = 'authenticated');

-- ai_provider_configs: only service role can modify
CREATE POLICY "Service role manages provider configs"
  ON ai_provider_configs FOR ALL
  USING (auth.role() = 'service_role');

-- ai_inference_telemetry: users see only their own data
CREATE POLICY "Users can view own telemetry"
  ON ai_inference_telemetry FOR SELECT
  USING (auth.uid() = user_id);

-- ai_inference_telemetry: insert allowed for authenticated users (edge functions use service role)
CREATE POLICY "Service role manages telemetry"
  ON ai_inference_telemetry FOR ALL
  USING (auth.role() = 'service_role');

-- ==========================================
-- Auto-update triggers
-- ==========================================

CREATE OR REPLACE FUNCTION update_ai_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_models_updated_at
  BEFORE UPDATE ON ai_models
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_models_updated_at();

-- ==========================================
-- Bridge: benchmark tables ↔ ai_models
-- ==========================================
-- Add columns to existing benchmark tables for
-- proper integration with ai_models registry.

-- benchmark_run_results: link to ai_models and track location/failover
ALTER TABLE benchmark_run_results
  ADD COLUMN IF NOT EXISTS ai_model_code TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS sdk_type TEXT DEFAULT 'vertex',
  ADD COLUMN IF NOT EXISTS was_fallback BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- benchmark_run_metrics: add location for per-location aggregation
ALTER TABLE benchmark_run_metrics
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS avg_retry_count NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_rate NUMERIC(5,4) DEFAULT 0;

-- benchmark_runs: add provider chain snapshot
ALTER TABLE benchmark_runs
  ADD COLUMN IF NOT EXISTS provider_chain JSONB;

-- ==========================================
-- Seed: Initial AI Models
-- ==========================================

INSERT INTO ai_models (code, display_name, provider, model_family, status, available_locations, input_cost_per_million, output_cost_per_million, supports_multi_image, supports_structured_output, supports_thinking, max_images_per_request, max_output_tokens, recommended_config, notes)
VALUES
  (
    'gemini-2.5-flash-lite',
    'Gemini 2.5 Flash Lite',
    'vertex-ai',
    'gemini-2.5',
    'ga',
    ARRAY['global', 'europe-west1', 'europe-west3', 'europe-west4', 'us-central1'],
    0.1000, 0.4000,
    true, true, false,
    16, 8192,
    '{"temperature": 0.2, "mediaResolution": "MEDIA_RESOLUTION_HIGH"}'::jsonb,
    'Most cost-effective. GA, available in EU. Recommended for visual tagging.'
  ),
  (
    'gemini-2.5-flash',
    'Gemini 2.5 Flash',
    'vertex-ai',
    'gemini-2.5',
    'ga',
    ARRAY['global', 'europe-west1', 'europe-west3', 'europe-west4', 'us-central1'],
    0.1500, 0.6000,
    true, true, true,
    16, 8192,
    '{"thinkingLevel": "MINIMAL", "temperature": 0.2, "mediaResolution": "MEDIA_RESOLUTION_HIGH"}'::jsonb,
    'Good balance of quality and cost. GA, available in EU.'
  ),
  (
    'gemini-3-flash-preview',
    'Gemini 3 Flash (Preview)',
    'vertex-ai',
    'gemini-3',
    'preview',
    ARRAY['global'],
    0.5000, 3.0000,
    true, true, true,
    16, 8192,
    '{"thinkingLevel": "MINIMAL", "temperature": 0.2, "mediaResolution": "MEDIA_RESOLUTION_HIGH"}'::jsonb,
    'Best quality for race number detection. Preview, global only. NOT GDPR compliant for EU data.'
  ),
  (
    'gemini-3.1-pro',
    'Gemini 3.1 Pro',
    'vertex-ai',
    'gemini-3',
    'preview',
    ARRAY['global'],
    2.0000, 12.0000,
    true, true, true,
    16, 8192,
    '{"thinkingLevel": "MEDIUM", "temperature": 0.2, "mediaResolution": "MEDIA_RESOLUTION_HIGH"}'::jsonb,
    'Highest quality, highest cost. Preview, global only. For complex cases or benchmark comparison.'
  )
ON CONFLICT (code) DO NOTHING;

-- ==========================================
-- Seed: Default Provider Chain (global fallback)
-- ==========================================
-- sport_category_id = NULL means default for all categories
-- without a specific chain.

INSERT INTO ai_provider_configs (sport_category_id, ai_model_id, location, sdk_type, priority, purpose, notes)
VALUES
  -- Analysis chain: gemini-3-flash → 2.5-flash EU → 2.5-flash-lite EU
  (NULL, (SELECT id FROM ai_models WHERE code = 'gemini-3-flash-preview'), 'global', 'vertex', 0, 'analysis',
   'Primary: best quality, global endpoint'),
  (NULL, (SELECT id FROM ai_models WHERE code = 'gemini-2.5-flash'), 'europe-west4', 'vertex', 1, 'analysis',
   'Fallback 1: GA model, EU compliant'),
  (NULL, (SELECT id FROM ai_models WHERE code = 'gemini-2.5-flash-lite'), 'europe-west4', 'vertex', 2, 'analysis',
   'Fallback 2: cheapest, EU compliant'),

  -- Visual tagging chain: always 2.5-flash-lite in EU (cheap + fast)
  (NULL, (SELECT id FROM ai_models WHERE code = 'gemini-2.5-flash-lite'), 'europe-west4', 'vertex', 0, 'visual-tagging',
   'Primary: cost-effective, EU compliant, sufficient quality for tags')
ON CONFLICT (sport_category_id, purpose, priority) DO NOTHING;
