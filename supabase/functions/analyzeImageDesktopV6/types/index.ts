/**
 * V6 Edge Function Types
 *
 * Interfacce TypeScript per il sistema modulare V6
 */

// ==================== SPORT CATEGORY CONFIG ====================

export interface SportCategoryConfig {
  id: string;
  code: string;
  name: string;
  aiPrompt: string;
  fallbackPrompt: string | null;
  recognitionConfig: RecognitionConfig;
  cropConfig: CropConfig;
}

export interface RecognitionConfig {
  maxResults?: number;        // Default: 10
  minConfidence?: number;     // Default: 0.5
  focusMode?: 'foreground' | 'closest' | 'primary' | 'all';
  ignoreBackground?: boolean;
  prioritizeForeground?: boolean;
  detectPlateNumber?: boolean;
  boundingBoxFormat?: 'gemini_native' | 'legacy';
}

export interface CropConfig {
  enabled: boolean;
  crop: {
    paddingPercent: number;
    minPaddingPx?: number;
    minDimension: number;
    maxDimension: number;
    jpegQuality: number;
  };
  negative: {
    enabled: boolean;
    maskColor: string;
    maxDimension: number;
    jpegQuality: number;
  };
  multiSubject?: {
    maxCropsPerRequest: number;
    strategy: 'all' | 'largest' | 'highest_confidence';
  };
}

export const DEFAULT_SPORT_CONFIG: SportCategoryConfig = {
  id: 'default',
  code: 'motorsport',
  name: 'Motorsport (Default)',
  aiPrompt: `Sei un esperto di fotografia sportiva e motorsport. Analizza le immagini ritagliate di veicoli/atleti da gara.

Per ogni ritaglio, identifica:
- raceNumber: Il numero di gara visibile (stringa, null se non visibile)
- confidence: La tua confidenza nell'identificazione (0.0-1.0)
- drivers: Array di nomi piloti/atleti se visibili (array vuoto se nessuno)
- teamName: Nome del team se identificabile (stringa o null)
- otherText: Altri testi significativi visibili (sponsor su casco, tuta, ecc.)`,
  fallbackPrompt: null,
  recognitionConfig: {
    maxResults: 10,
    minConfidence: 0.5,
    focusMode: 'foreground',
    ignoreBackground: false,
    detectPlateNumber: false
  },
  cropConfig: {
    enabled: true,
    crop: {
      paddingPercent: 15,
      minDimension: 224,
      maxDimension: 1024,
      jpegQuality: 85
    },
    negative: {
      enabled: true,
      maskColor: '#808080',
      maxDimension: 1024,
      jpegQuality: 75
    }
  }
};

// ==================== REQUEST/RESPONSE TYPES ====================

export interface BoundingBox {
  x: number;      // Normalized 0-1
  y: number;      // Normalized 0-1
  width: number;  // Normalized 0-1
  height: number; // Normalized 0-1
}

export interface CropData {
  imageData: string;        // Base64 encoded JPEG
  detectionId: string;      // Unique ID for tracking
  isPartial: boolean;       // True if subject touches frame edge
  originalBbox?: BoundingBox;
}

export interface NegativeData {
  imageData: string;        // Base64 encoded JPEG
  maskedRegions: BoundingBox[];
}

export interface ParticipantInfo {
  numero?: string;
  nome?: string;
  navigatore?: string;
  squadra?: string;
  sponsor?: string;
  metatag?: string;
}

export interface RequestBody {
  crops: CropData[];
  negative?: NegativeData;
  category?: string;
  userId?: string;
  executionId?: string;
  imageId?: string;
  originalFileName?: string;
  storagePath?: string;
  participantPreset?: {
    name: string;
    participants: ParticipantInfo[];
  };
  modelName?: string;  // Ignored - V6 controls model
}

// ==================== ANALYSIS RESULT TYPES ====================

export interface CropAnalysisResult {
  imageIndex: number;       // 1-based index matching prompt
  detectionId: string;
  raceNumber: string | null;
  confidence: number;
  drivers: string[];
  teamName: string | null;
  otherText: string[];
  isPartial: boolean;
  originalBbox?: BoundingBox;
}

export interface ContextAnalysisResult {
  sponsors: string[];
  otherRaceNumbers: string[];
  category: string | null;
  teamColors: string[];
  confidence: number;
}

export interface CorrelationResult {
  validated: boolean;
  notes: string[];
}

export interface GeminiAnalysisResult {
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStats {
  cropsCount: number;
  hasNegative: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

// ==================== RESPONSE TYPES ====================

export interface SuccessResponse {
  success: true;
  cropAnalysis: CropAnalysisResult[];
  contextAnalysis: ContextAnalysisResult | null;
  correlation: CorrelationResult;
  usage: UsageStats;
  inferenceTimeMs: number;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}

export type V6Response = SuccessResponse | ErrorResponse;

// ==================== DATABASE TYPES ====================

export interface SaveResultsParams {
  imageId: string;
  executionId?: string;
  userId: string;
  cropAnalysis: CropAnalysisResult[];
  contextAnalysis: ContextAnalysisResult | null;
  correlation: CorrelationResult;
  usage: UsageStats;
  categoryCode: string;
  originalFileName?: string;
  storagePath?: string;
  inferenceTimeMs: number;
}
