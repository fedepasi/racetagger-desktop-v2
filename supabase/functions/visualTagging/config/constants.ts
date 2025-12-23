/**
 * Visual Tagging Edge Function Constants
 */

// ==================== CORS ====================

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

// ==================== GEMINI CONFIG ====================

export const GEMINI_CONFIG = {
  // Environment variables (same as V6)
  PROJECT_ID_ENV: 'VERTEX_PROJECT_ID',
  LOCATION_ENV: 'VERTEX_LOCATION',
  SERVICE_ACCOUNT_KEY_ENV: 'VERTEX_SERVICE_ACCOUNT_KEY',
  API_KEY_ENV: 'GEMINI_API_KEY',

  // Gemini 3 Flash Preview - same as V6
  MODEL: 'gemini-3-flash-preview',
  DEFAULT_LOCATION: 'global',  // Gemini 3 Flash only available on global endpoints

  // Gemini 3 Flash specific parameters (same as V6)
  THINKING_LEVEL: 'MINIMAL' as const,                     // MINIMAL, LOW, MEDIUM, HIGH
  MEDIA_RESOLUTION: 'MEDIA_RESOLUTION_HIGH' as const,     // MEDIA_RESOLUTION_LOW, MEDIUM, HIGH

  // Generation parameters
  TEMPERATURE: 0.1,  // Lower for more consistent tags
  MAX_OUTPUT_TOKENS: 1024,  // Tags are small

  // Timeouts (same as V6)
  TIMEOUT_MS: 60000,
  RETRY_ATTEMPTS: 1
};

// Keep backward compatibility alias
export const VERTEX_AI = GEMINI_CONFIG;

// ==================== COST TRACKING ====================

export const COST_CONFIG = {
  // Gemini 3 Flash Preview pricing (December 2024)
  INPUT_PER_MILLION: 0.50,   // $0.50 per million input tokens
  OUTPUT_PER_MILLION: 3.00   // $3.00 per million output tokens
};

// ==================== TAGGING ====================

export const TAGGING_CONFIG = {
  // Max tags per category
  MAX_LOCATION_TAGS: 5,
  MAX_WEATHER_TAGS: 3,
  MAX_SCENE_TAGS: 3,
  MAX_SUBJECT_TAGS: 5,
  MAX_STYLE_TAGS: 3,
  MAX_EMOTION_TAGS: 3
};

// ==================== PROMPT ====================

// Simplified prompt - structure is enforced by responseSchema
export const VISUAL_TAGGING_PROMPT = `Extract visual tags from this racing photo for marketing search.

Rules:
- Lowercase English only
- Be specific: "monza pit lane" better than "pit"
- Include visible sponsor/brand names in subjects
- Empty array [] if nothing relevant for category
- Never invent - only tag what you actually see in the image
- Max 5 tags per location/subjects, max 3 for other categories`;

// ==================== LOGGING ====================

export const LOG_PREFIX = '[VisualTagging]';
