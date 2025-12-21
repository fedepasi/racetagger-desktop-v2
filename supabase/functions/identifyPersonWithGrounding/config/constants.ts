/**
 * identifyPersonWithGrounding Constants
 *
 * Face recognition backup using Gemini + Google Search grounding.
 * Called when face-api.js desktop doesn't find a match in local preset.
 */

// ==================== CORS ====================

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

// ==================== GEMINI CONFIG ====================

export const GEMINI_CONFIG = {
  // Environment variable for API key
  API_KEY_ENV: 'GEMINI_API_KEY',

  // Model with Google Search grounding support
  MODEL_NAME: 'gemini-2.0-flash-exp',

  // Generation config
  TEMPERATURE: 0.3,
  MAX_OUTPUT_TOKENS: 1024,

  // Timeout
  TIMEOUT_MS: 30000
};

// ==================== COST TRACKING ====================

export const COST_CONFIG = {
  // Gemini + Grounding pricing (December 2024)
  // Note: Grounding has additional cost ~$0.035/1000 queries
  INPUT_PER_MILLION: 0.075,   // Gemini Flash input
  OUTPUT_PER_MILLION: 0.30,   // Gemini Flash output
  GROUNDING_PER_1000: 0.035   // Google Search grounding
};

// ==================== LOGGING ====================

export const LOG_PREFIX = '[IdentifyPerson]';
export const EDGE_FUNCTION_VERSION = 1;
