-- ============================================
-- AI Models: Update from official Google docs
-- Date: 2026-02-22
-- Sources:
--   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite
--   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash
--   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro
--   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash
--   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro
--   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro
--   https://cloud.google.com/vertex-ai/generative-ai/pricing
-- ============================================

-- ============================================
-- FIX existing models: pricing, regions, capabilities
-- ============================================

-- gemini-3-flash-preview
-- Pricing verified: $0.50/$3.00. Regions: global ONLY.
-- Max images: 900 (NOT 3000). Max output: 65536.
-- Supports: thinking (MINIMAL/LOW/MEDIUM/HIGH), media_resolution, structured output
-- Released: Dec 17, 2025
UPDATE ai_models SET
  display_name = 'Gemini 3 Flash',
  status = 'preview',
  available_locations = ARRAY['global'],
  input_cost_per_million = 0.50,
  output_cost_per_million = 3.00,
  supports_multi_image = true,
  supports_structured_output = true,
  supports_thinking = true,
  max_images_per_request = 900,
  max_output_tokens = 65536,
  recommended_config = '{"thinkingLevel": "MINIMAL", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2}'::jsonb,
  badge = 'NEW',
  badge_color = 'bg-green-500',
  notes = 'Best quality for race number detection. Preview, global only. NOT GDPR compliant for EU data. Max 900 images/prompt. Supports media_resolution (low/medium/high/ultra-high). Released Dec 17, 2025.',
  updated_at = now()
WHERE code = 'gemini-3-flash-preview';

-- gemini-2.5-flash
-- PRICING FIX: was $0.15/$0.60, correct is $0.30/$2.50
-- Regions: extensive EU coverage including europe-west2, europe-west3
-- Max images: 3000. Max output: 65535.
-- GA, released June 17, 2025. Discontinuation: June 17, 2026
UPDATE ai_models SET
  display_name = 'Gemini 2.5 Flash',
  status = 'ga',
  available_locations = ARRAY[
    'global',
    'us-central1', 'us-east1', 'us-east4', 'us-east5', 'us-south1', 'us-west1', 'us-west4',
    'northamerica-northeast1', 'southamerica-east1',
    'europe-central2', 'europe-north1', 'europe-southwest1',
    'europe-west1', 'europe-west2', 'europe-west3', 'europe-west4', 'europe-west8', 'europe-west9',
    'asia-northeast1', 'asia-northeast3', 'asia-south1', 'asia-southeast1', 'australia-southeast1'
  ],
  input_cost_per_million = 0.30,
  output_cost_per_million = 2.50,
  supports_multi_image = true,
  supports_structured_output = true,
  supports_thinking = true,
  max_images_per_request = 3000,
  max_output_tokens = 65535,
  recommended_config = '{"thinkingLevel": "MINIMAL", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2}'::jsonb,
  notes = 'Best price/performance ratio. GA, wide EU coverage. Supports thinking. Discontinuation: June 17, 2026.',
  updated_at = now()
WHERE code = 'gemini-2.5-flash';

-- gemini-2.5-flash-lite
-- Regions: good EU coverage (europe-west1, west4, west8, west9, etc.) but NOT europe-west2/west3
-- Max images: 3000. Max output: 65535.
-- GA, released July 22, 2025. Discontinuation: July 22, 2026
UPDATE ai_models SET
  display_name = 'Gemini 2.5 Flash Lite',
  status = 'ga',
  available_locations = ARRAY[
    'global',
    'us-central1', 'us-east1', 'us-east4', 'us-east5', 'us-south1', 'us-west1', 'us-west4',
    'europe-central2', 'europe-north1', 'europe-southwest1',
    'europe-west1', 'europe-west4', 'europe-west8', 'europe-west9'
  ],
  supports_multi_image = true,
  supports_structured_output = true,
  supports_thinking = true,
  max_images_per_request = 3000,
  max_output_tokens = 65535,
  recommended_config = '{"mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.1}'::jsonb,
  notes = 'Most cost-effective. GA, EU available. Ideal for visual tagging. Discontinuation: July 22, 2026.',
  updated_at = now()
WHERE code = 'gemini-2.5-flash-lite';

-- gemini-2.5-pro
-- PRICING FIX: output was $5.00, correct is $10.00 (up to 200K context)
-- Regions: EU coverage (europe-west1, west4, west8, west9), also asia-northeast1
-- GA, released June 17, 2025. Discontinuation: June 17, 2026
UPDATE ai_models SET
  display_name = 'Gemini 2.5 Pro',
  status = 'ga',
  available_locations = ARRAY[
    'global',
    'us-central1', 'us-east1', 'us-east4', 'us-east5', 'us-south1', 'us-west1', 'us-west4',
    'northamerica-northeast1',
    'europe-central2', 'europe-north1', 'europe-southwest1',
    'europe-west1', 'europe-west4', 'europe-west8', 'europe-west9',
    'asia-northeast1'
  ],
  input_cost_per_million = 1.25,
  output_cost_per_million = 10.00,
  supports_multi_image = true,
  supports_structured_output = true,
  supports_thinking = true,
  max_images_per_request = 3000,
  max_output_tokens = 65535,
  recommended_config = '{"thinkingLevel": "MEDIUM", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2}'::jsonb,
  notes = 'Most advanced reasoning (2.5 gen). GA, EU available. Price shown for <=200K context; longer context costs more. Discontinuation: June 17, 2026.',
  updated_at = now()
WHERE code = 'gemini-2.5-pro';

-- gemini-2.0-flash
-- PRICING FIX: was $0.10/$0.40, correct is $0.15/$0.60
UPDATE ai_models SET
  input_cost_per_million = 0.15,
  output_cost_per_million = 0.60,
  notes = 'Previous generation. GA, EU available. No thinking support.',
  updated_at = now()
WHERE code = 'gemini-2.0-flash';

-- gemini-2.0-flash-lite
-- Pricing: ~$0.075/$0.30 (estimated from tier structure)
UPDATE ai_models SET
  notes = 'Previous generation lite. GA, EU available. Cheapest option but older model.',
  updated_at = now()
WHERE code = 'gemini-2.0-flash-lite';

-- ============================================
-- ADD new models from docs
-- ============================================

-- gemini-3-pro-preview (NEW)
-- Regions: global ONLY. Max images: 900. Max output: 65536.
-- Pricing: $2.00/$12.00 (base, may vary with context length)
-- Released: Nov 18, 2025
INSERT INTO ai_models (
  code, display_name, provider, model_family, status,
  available_locations, input_cost_per_million, output_cost_per_million,
  supports_multi_image, supports_structured_output, supports_thinking,
  max_images_per_request, max_output_tokens, recommended_config,
  badge, badge_color, sort_order, notes
) VALUES (
  'gemini-3-pro-preview',
  'Gemini 3 Pro',
  'vertex-ai',
  'gemini-3',
  'preview',
  ARRAY['global'],
  2.00, 12.00,
  true, true, true,
  900, 65536,
  '{"thinkingLevel": "LOW", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2}'::jsonb,
  'PRO', 'bg-purple-500', 8,
  'Most advanced reasoning (3.0 gen). Preview, global only. NOT GDPR compliant. Price may vary with context length. Released Nov 18, 2025.'
) ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  available_locations = EXCLUDED.available_locations,
  input_cost_per_million = EXCLUDED.input_cost_per_million,
  output_cost_per_million = EXCLUDED.output_cost_per_million,
  supports_multi_image = EXCLUDED.supports_multi_image,
  supports_structured_output = EXCLUDED.supports_structured_output,
  supports_thinking = EXCLUDED.supports_thinking,
  max_images_per_request = EXCLUDED.max_images_per_request,
  max_output_tokens = EXCLUDED.max_output_tokens,
  recommended_config = EXCLUDED.recommended_config,
  badge = EXCLUDED.badge,
  badge_color = EXCLUDED.badge_color,
  notes = EXCLUDED.notes,
  updated_at = now();

-- gemini-3.1-pro-preview (NEW)
-- Regions: global ONLY. Max images: 900. Max output: 65536.
-- Pricing: same as 3 Pro ($2.00/$12.00)
-- Released: Feb 19, 2026 (3 days ago!)
-- New: MEDIUM thinking level, improved SWE/agentic capabilities
INSERT INTO ai_models (
  code, display_name, provider, model_family, status,
  available_locations, input_cost_per_million, output_cost_per_million,
  supports_multi_image, supports_structured_output, supports_thinking,
  max_images_per_request, max_output_tokens, recommended_config,
  badge, badge_color, sort_order, notes
) VALUES (
  'gemini-3.1-pro-preview',
  'Gemini 3.1 Pro',
  'vertex-ai',
  'gemini-3',
  'preview',
  ARRAY['global'],
  2.00, 12.00,
  true, true, true,
  900, 65536,
  '{"thinkingLevel": "MEDIUM", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2}'::jsonb,
  'NEW', 'bg-red-500', 0,
  'Latest and most advanced. Preview, global only. NOT GDPR compliant. Adds MEDIUM thinking level. Improved SWE and agentic. Released Feb 19, 2026.'
) ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  available_locations = EXCLUDED.available_locations,
  input_cost_per_million = EXCLUDED.input_cost_per_million,
  output_cost_per_million = EXCLUDED.output_cost_per_million,
  supports_multi_image = EXCLUDED.supports_multi_image,
  supports_structured_output = EXCLUDED.supports_structured_output,
  supports_thinking = EXCLUDED.supports_thinking,
  max_images_per_request = EXCLUDED.max_images_per_request,
  max_output_tokens = EXCLUDED.max_output_tokens,
  recommended_config = EXCLUDED.recommended_config,
  badge = EXCLUDED.badge,
  badge_color = EXCLUDED.badge_color,
  sort_order = EXCLUDED.sort_order,
  notes = EXCLUDED.notes,
  updated_at = now();
