/**
 * PDF Entry List Parser - Type Definitions
 */

// ==================== REQUEST ====================

export interface ParsePdfRequest {
  /** Base64 encoded PDF file */
  pdfBase64: string;
  /** User ID for logging */
  userId?: string;
  /** Optional: hint about expected sport type */
  sportHint?: 'motorsport' | 'running' | 'cycling' | 'other';
}

// ==================== VALIDATION ====================

export interface ValidationResult {
  is_valid_entry_list: boolean;
  confidence: number;
  document_type: DocumentType;
  rejection_reason: string | null;
  detected_language: string;
}

export type DocumentType =
  | 'entry_list'
  | 'start_list'
  | 'starting_grid'
  | 'race_entry'
  | 'participant_list'
  | 'competitor_list'
  | 'other';

// ==================== EXTRACTION ====================

export interface ExtractedParticipant {
  numero: string;
  nome?: string;
  squadra?: string;
  categoria?: string;
  navigatore?: string;
  sponsor?: string;
  nationality?: string;
}

export interface ExtractionResult {
  event_name: string | null;
  event_date: string | null;
  category: string | null;
  participants: ExtractedParticipant[];
  extraction_notes: string | null;
}

// ==================== RESPONSE ====================

export interface ParsePdfSuccessResponse {
  success: true;
  data: {
    /** Document validation info */
    validation: {
      document_type: DocumentType;
      confidence: number;
      detected_language: string;
    };
    /** Event information extracted */
    event: {
      name: string | null;
      date: string | null;
      category: string | null;
    };
    /** Extracted participants */
    participants: ExtractedParticipant[];
    /** Processing metrics */
    usage: {
      inputTokens: number;
      outputTokens: number;
      estimatedCostUSD: number;
    };
    processingTimeMs: number;
    modelUsed: string;
    /** Any extraction warnings or notes */
    notes: string | null;
  };
}

export interface ParsePdfErrorResponse {
  success: false;
  error: string;
  /** Validation-specific error details */
  validation?: {
    document_type: string;
    confidence: number;
    rejection_reason: string;
  };
  details?: string;
}

export type ParsePdfResponse = ParsePdfSuccessResponse | ParsePdfErrorResponse;

// ==================== GEMINI ====================

export interface GeminiResult<T> {
  parsedResponse: T;
  inputTokens: number;
  outputTokens: number;
}
