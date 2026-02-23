/**
 * V6 Edge Function Constants
 *
 * Costanti condivise tra i moduli V6
 */

// ==================== CORS ====================

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

// ==================== VERTEX AI ====================

export const VERTEX_AI = {
  // Environment variables
  PROJECT_ID_ENV: 'VERTEX_PROJECT_ID',
  LOCATION_ENV: 'VERTEX_LOCATION',
  SERVICE_ACCOUNT_KEY_ENV: 'VERTEX_SERVICE_ACCOUNT_KEY',

  // Defaults (used when ai_provider_configs not available)
  DEFAULT_LOCATION: 'global',  // Gemini 3 Flash only available on global endpoints
  DEFAULT_MODEL: 'gemini-3-flash-preview',

  // Gemini 3 Flash specific parameters
  THINKING_LEVEL: 'MINIMAL' as const,                     // MINIMAL, LOW, MEDIUM, HIGH
  MEDIA_RESOLUTION: 'MEDIA_RESOLUTION_HIGH' as const,     // MEDIA_RESOLUTION_LOW, MEDIUM, HIGH
  TEMPERATURE: 0.2,
  MAX_OUTPUT_TOKENS: 4096,

  // Timeouts
  TIMEOUT_MS: 60000,
  RETRY_ATTEMPTS: 1
};

// ==================== PROVIDER CHAIN (DEFAULT FALLBACK) ====================
// Used when ai_provider_configs table is not available or empty.
// Mirrors the seed data in migration 20260222100000.
// Order: best quality → GA EU-compliant → cheapest EU-compliant

export interface ProviderEntry {
  modelCode: string;
  location: string;
  sdkType: 'vertex' | 'aistudio';
  // Model-specific overrides (merged with VERTEX_AI defaults)
  config?: {
    thinkingLevel?: string;
    mediaResolution?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export const DEFAULT_PROVIDER_CHAIN: ProviderEntry[] = [
  {
    modelCode: 'gemini-3-flash-preview',
    location: 'global',
    sdkType: 'vertex',
    config: { thinkingLevel: 'MINIMAL', mediaResolution: 'MEDIA_RESOLUTION_HIGH', temperature: 0.2, maxOutputTokens: 4096 }
  },
  {
    modelCode: 'gemini-2.5-flash',
    location: 'europe-west4',
    sdkType: 'vertex',
    config: { thinkingLevel: 'MINIMAL', mediaResolution: 'MEDIA_RESOLUTION_HIGH', temperature: 0.2, maxOutputTokens: 4096 }
  },
  {
    modelCode: 'gemini-2.5-flash-lite',
    location: 'europe-west4',
    sdkType: 'vertex',
    config: { mediaResolution: 'MEDIA_RESOLUTION_HIGH', temperature: 0.1, maxOutputTokens: 4096 }
  }
];

// Errors that should trigger failover to next provider
export const RETRYABLE_ERROR_PATTERNS = [
  '429', 'resource exhausted', 'resource_exhausted',
  '503', 'service unavailable', 'overloaded',
  'quota', 'rate limit', 'rate_limit', 'too many requests',
  'timeout', 'timed out', 'deadline exceeded',
  'internal error', '500',
];

// ==================== COST TRACKING ====================

export const COST_CONFIG = {
  // Gemini 3 Flash Preview pricing (December 2024)
  INPUT_PER_MILLION: 0.50,   // $0.50 per million input tokens
  OUTPUT_PER_MILLION: 3.00   // $3.00 per million output tokens
};

// ==================== RESPONSE DEFAULTS ====================

export const RESPONSE_DEFAULTS = {
  MIN_CONFIDENCE: 0.5,
  MAX_RESULTS: 10,
  DEFAULT_CONTEXT_CONFIDENCE: 0.8
};

// ==================== LOGGING ====================

export const LOG_PREFIX = '[V6]';
export const EDGE_FUNCTION_VERSION = 6;
export const ANALYSIS_PROVIDER = 'gemini-v6-seg';
