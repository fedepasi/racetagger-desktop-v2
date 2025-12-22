/**
 * PDF Entry List Parser - Constants
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

  // Gemini 2.5 Flash - good balance of speed and accuracy for document parsing
  DEFAULT_LOCATION: 'us-central1',
  DEFAULT_MODEL: 'gemini-2.5-flash-preview-05-20',

  // Generation parameters
  TEMPERATURE: 0.1,  // Low for consistent extraction
  MAX_OUTPUT_TOKENS: 8192,  // Higher for large entry lists

  // Timeouts
  TIMEOUT_MS: 60000,  // 60s for large PDFs
  RETRY_ATTEMPTS: 1
};

// ==================== COST TRACKING ====================

export const COST_CONFIG = {
  // Gemini 2.5 Flash pricing (December 2024)
  INPUT_PER_MILLION: 0.075,   // $0.075 per million input tokens
  OUTPUT_PER_MILLION: 0.30    // $0.30 per million output tokens
};

// ==================== VALIDATION ====================

export const VALIDATION_CONFIG = {
  // Minimum confidence score to accept document as valid entry list
  MIN_CONFIDENCE: 0.7,

  // Required fields for a valid participant
  REQUIRED_FIELDS: ['numero'],

  // Supported document types
  VALID_DOCUMENT_TYPES: [
    'entry_list',
    'start_list',
    'starting_grid',
    'race_entry',
    'participant_list',
    'competitor_list'
  ]
};

// ==================== PROMPT ====================

export const DOCUMENT_VALIDATION_PROMPT = `Analyze this PDF document and determine if it's a motorsport/sports entry list, start list, or participant list.

Return ONLY valid JSON in this exact format:
{
  "is_valid_entry_list": true/false,
  "confidence": 0.0-1.0,
  "document_type": "entry_list" | "start_list" | "starting_grid" | "race_entry" | "participant_list" | "competitor_list" | "other",
  "rejection_reason": "string if not valid, null otherwise",
  "detected_language": "en" | "it" | "es" | "fr" | "de" | "other"
}

A valid entry/start list typically contains:
- Race number columns (pettorale, numero, #, n., no.)
- Driver/Rider/Athlete names
- Team/Manufacturer names
- Categories or classes
- Event name or date

Reject documents that are:
- Race results or classifications
- General news articles
- Random images or photos
- Non-racing documents
- Invoices, contracts, or administrative documents`;

export const EXTRACTION_PROMPT = `Extract ALL participants from this entry list/start list document.

Return ONLY valid JSON in this exact format:
{
  "event_name": "Event title if found",
  "event_date": "Date if found (YYYY-MM-DD)",
  "category": "Main category/championship name if found",
  "participants": [
    {
      "numero": "Race number (REQUIRED)",
      "nome": "Driver/Rider full name",
      "squadra": "Team name",
      "categoria": "Category/Class",
      "navigatore": "Co-driver/Navigator if applicable",
      "sponsor": "Main sponsors visible",
      "nationality": "Country code if visible (ITA, GER, etc.)"
    }
  ],
  "extraction_notes": "Any issues or notes about extraction"
}

IMPORTANT RULES:
1. "numero" is REQUIRED - skip entries without a visible race number
2. Extract ALL participants, not just a sample
3. Handle multi-page documents - extract from all pages
4. For rally documents, include "navigatore" (co-driver)
5. If team name appears multiple times (e.g., "Team XYZ Racing" and "#1 XYZ"), use the cleaner version
6. Clean up formatting (remove extra spaces, fix capitalization)
7. Merge duplicate entries if same number appears multiple times
8. For nationality, use standard 3-letter codes (ITA, GER, FRA, ESP, etc.)`;

// ==================== LOGGING ====================

export const LOG_PREFIX = '[ParsePdfEntryList]';
