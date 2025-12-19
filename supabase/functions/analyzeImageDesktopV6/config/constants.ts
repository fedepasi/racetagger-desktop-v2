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

  // Defaults
  DEFAULT_LOCATION: 'europe-west1',
  DEFAULT_MODEL: 'gemini-2.0-flash-001',

  // Gemini 3 Flash specific parameters
  THINKING_LEVEL: 'MINIMAL' as const,     // MINIMAL, LOW, MEDIUM, HIGH
  MEDIA_RESOLUTION: 'ULTRA_HIGH' as const, // LOW, MEDIUM, HIGH, ULTRA_HIGH

  // Timeouts
  TIMEOUT_MS: 60000,
  RETRY_ATTEMPTS: 1
};

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
