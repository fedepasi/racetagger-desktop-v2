/**
 * Visual Tagging Edge Function Constants
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

  // Gemini 2.5 Flash Lite - faster and cheaper for tagging
  DEFAULT_LOCATION: 'us-central1',
  DEFAULT_MODEL: 'gemini-2.5-flash-preview-05-20',

  // Generation parameters
  TEMPERATURE: 0.1,  // Lower for more consistent tags
  MAX_OUTPUT_TOKENS: 1024,  // Tags are small

  // Timeouts
  TIMEOUT_MS: 30000,
  RETRY_ATTEMPTS: 1
};

// ==================== COST TRACKING ====================

export const COST_CONFIG = {
  // Gemini 2.5 Flash pricing (December 2024)
  INPUT_PER_MILLION: 0.075,   // $0.075 per million input tokens
  OUTPUT_PER_MILLION: 0.30    // $0.30 per million output tokens
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

export const VISUAL_TAGGING_PROMPT = `Extract visual tags from this racing photo for marketing search. Return ONLY valid JSON:

{
  "loc": [],
  "wth": [],
  "scn": [],
  "sub": [],
  "sty": [],
  "emo": []
}

Categories:
- loc: location/landmarks (track name, city, specific corners, pit lane) - max 5
- wth: weather/lighting (sunny, rainy, cloudy, golden hour, night) - max 3
- scn: scene type (action, podium, pit stop, portrait, crash, start, overtake) - max 3
- sub: subjects visible (car, motorcycle, runner, crowd, team crew, marshals) - max 5
- sty: photography style (motion blur, panning, close-up, wide angle, aerial) - max 3
- emo: emotion/mood (excitement, tension, celebration, focus, disappointment) - max 3

Rules:
- Lowercase English only
- Be specific: "monza pit lane" better than "pit"
- Include visible sponsor/brand names in subjects
- Empty array [] if nothing relevant for category
- Never invent - only tag what you see`;

// ==================== LOGGING ====================

export const LOG_PREFIX = '[VisualTagging]';
