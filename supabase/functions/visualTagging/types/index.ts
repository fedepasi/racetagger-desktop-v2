/**
 * Visual Tagging Edge Function Types
 */

// ==================== REQUEST ====================

export interface VisualTaggingRequest {
  /** Public URL of image from Supabase Storage */
  imageUrl: string;

  /** Image ID in images table */
  imageId: string;

  /** Execution ID for tracking */
  executionId: string;

  /** User ID */
  userId: string;

  /** Recognition result for participant enrichment */
  recognitionResult?: {
    raceNumber?: string;
    driverName?: string;
    teamName?: string;
  };
}

// ==================== RESPONSE ====================

export interface VisualTags {
  location: string[];
  weather: string[];
  sceneType: string[];
  subjects: string[];
  visualStyle: string[];
  emotion: string[];
}

export interface VisualTaggingSuccessResponse {
  success: true;
  data: {
    tags: VisualTags;
    participant?: {
      name: string;
      team: string;
      raceNumber: string;
    };
    usage: {
      inputTokens: number;
      outputTokens: number;
      estimatedCostUSD: number;
    };
    processingTimeMs: number;
    modelUsed: string;
  };
}

export interface VisualTaggingErrorResponse {
  success: false;
  error: string;
  details?: string;
}

export type VisualTaggingResponse = VisualTaggingSuccessResponse | VisualTaggingErrorResponse;

// ==================== INTERNAL ====================

export interface GeminiTagResult {
  rawResponse: VisualTags;
  inputTokens: number;
  outputTokens: number;
}

export interface DatabaseWriteParams {
  imageId: string;
  executionId: string;
  userId: string;
  tags: VisualTags;
  participant?: {
    name: string;
    team: string;
    raceNumber: string;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  };
  processingTimeMs: number;
  modelUsed: string;
}
