/**
 * Response Parser Module
 *
 * Parse e filtra le risposte JSON da Gemini.
 * Applica filtri da recognition_config (minConfidence, maxResults).
 *
 * SOTA v2: Supports both compact (short keys) and expanded response formats.
 * Auto-detects format and normalizes to expanded format for processing.
 */

import {
  CropData,
  CropAnalysisResult,
  ContextAnalysisResult,
  RecognitionConfig,
  CorrelationResult,
  ParticipantInfo,
  BboxSource
} from '../types/index.ts';
import { RESPONSE_DEFAULTS, LOG_PREFIX } from '../config/constants.ts';
import {
  normalizeGeminiResponse,
  normalizeVehicleResponse,
  detectResponseFormat,
  ExpandedVehicleResponse
} from './response-mapper.ts';

/**
 * Parse Gemini response and extract crop/context analysis
 *
 * @param responseText - Raw JSON response from Gemini
 * @param crops - Original crop data for metadata
 * @param hasNegative - Whether context image was included
 * @param recognitionConfig - Config for filtering results
 * @param bboxSources - V6 Baseline 2026: Source of each crop's bounding box
 * @returns Parsed crop and context analysis
 */
export function parseGeminiResponse(
  responseText: string,
  crops: CropData[],
  hasNegative: boolean,
  recognitionConfig?: RecognitionConfig,
  bboxSources?: BboxSource[]
): { cropAnalysis: CropAnalysisResult[]; contextAnalysis: ContextAnalysisResult | null } {
  try {
    // Clean potential markdown formatting
    const cleaned = responseText
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // SOTA v2: Auto-detect and normalize response format (compact or expanded)
    const format = detectResponseFormat(parsed);
    console.log(`${LOG_PREFIX} Response format detected: ${format}`);

    // Normalize response to expanded format
    const normalized = normalizeGeminiResponse(parsed);

    // Parse crop results with bboxSource tracking and DNA fields
    let cropAnalysis = parseCropResults(normalized.crops, crops, bboxSources);

    // Apply filters from recognition_config
    cropAnalysis = filterCropResults(cropAnalysis, recognitionConfig);

    // Parse context result if present
    let contextAnalysis: ContextAnalysisResult | null = null;
    if (hasNegative && normalized.context) {
      contextAnalysis = parseContextResult(normalized.context);
    }

    console.log(`${LOG_PREFIX} Parsed ${cropAnalysis.length} crop results${contextAnalysis ? ' + context' : ''}`);

    return { cropAnalysis, contextAnalysis };
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to parse Gemini response:`, error);
    console.error(`${LOG_PREFIX} Raw response (first 500 chars): ${responseText.substring(0, 500)}`);

    // Return empty results on parse failure
    return {
      cropAnalysis: createEmptyCropResults(crops, bboxSources),
      contextAnalysis: null,
    };
  }
}

/**
 * Parse crop results from Gemini response
 * V6 Baseline 2026: Now includes bboxSource tracking
 * SOTA v2: Now includes Vehicle DNA fields (livery, make, model, etc.)
 */
function parseCropResults(
  normalizedCrops: ExpandedVehicleResponse[],
  originalCrops: CropData[],
  bboxSources?: BboxSource[]
): CropAnalysisResult[] {
  return normalizedCrops.map((crop: ExpandedVehicleResponse, idx: number) => ({
    // Core fields
    imageIndex: idx + 1,
    detectionId: originalCrops[idx]?.detectionId || `det_${idx}`,
    raceNumber: crop.raceNumber || null,
    confidence: typeof crop.confidence === 'number' ? crop.confidence : 0.5,
    drivers: Array.isArray(crop.drivers) ? crop.drivers : [],
    teamName: crop.teamName || null,
    otherText: Array.isArray(crop.otherText) ? crop.otherText : [],
    isPartial: originalCrops[idx]?.isPartial || false,
    originalBbox: originalCrops[idx]?.originalBbox || undefined,
    bboxSource: bboxSources?.[idx] || 'gemini',

    // Vehicle DNA fields (SOTA v2)
    livery: crop.livery || null,
    make: crop.make || null,
    model: crop.model || null,
    category: crop.category || null,
    plateNumber: crop.plateNumber || null,
    context: crop.context || null,
  }));
}

/**
 * Filter crop results based on recognition_config
 */
function filterCropResults(
  results: CropAnalysisResult[],
  config?: RecognitionConfig
): CropAnalysisResult[] {
  if (!config) return results;

  let filtered = [...results];

  // Filter by minimum confidence
  const minConfidence = config.minConfidence ?? RESPONSE_DEFAULTS.MIN_CONFIDENCE;
  if (minConfidence > 0) {
    const beforeCount = filtered.length;
    filtered = filtered.filter(r => r.confidence >= minConfidence || r.raceNumber === null);

    if (filtered.length < beforeCount) {
      console.log(`${LOG_PREFIX} Filtered ${beforeCount - filtered.length} results below minConfidence=${minConfidence}`);
    }
  }

  // Limit results
  const maxResults = config.maxResults ?? RESPONSE_DEFAULTS.MAX_RESULTS;
  if (maxResults > 0 && filtered.length > maxResults) {
    // Sort by confidence descending, then take top N
    filtered.sort((a, b) => b.confidence - a.confidence);
    filtered = filtered.slice(0, maxResults);
    console.log(`${LOG_PREFIX} Limited to top ${maxResults} results by confidence`);
  }

  return filtered;
}

/**
 * Parse context result from Gemini response
 */
function parseContextResult(context: any): ContextAnalysisResult {
  return {
    sponsors: Array.isArray(context.sponsorVisibili) ? context.sponsorVisibili : [],
    otherRaceNumbers: Array.isArray(context.altriNumeri) ? context.altriNumeri : [],
    category: context.categoria || null,
    teamColors: Array.isArray(context.coloriTeam) ? context.coloriTeam : [],
    confidence: RESPONSE_DEFAULTS.DEFAULT_CONTEXT_CONFIDENCE,
  };
}

/**
 * Create empty crop results for error cases
 * V6 Baseline 2026: Now includes bboxSource tracking
 * SOTA v2: Now includes Vehicle DNA fields
 */
function createEmptyCropResults(crops: CropData[], bboxSources?: BboxSource[]): CropAnalysisResult[] {
  return crops.map((crop, idx) => ({
    // Core fields
    imageIndex: idx + 1,
    detectionId: crop.detectionId,
    raceNumber: null,
    confidence: 0,
    drivers: [],
    teamName: null,
    otherText: [],
    isPartial: crop.isPartial,
    originalBbox: crop.originalBbox || undefined,
    bboxSource: bboxSources?.[idx] || 'gemini',

    // Vehicle DNA fields (SOTA v2) - null for empty results
    livery: null,
    make: null,
    model: null,
    category: null,
    plateNumber: null,
    context: null,
  }));
}

/**
 * Correlate crop results with context and participant data
 *
 * @param cropAnalysis - Parsed crop analysis results
 * @param contextAnalysis - Parsed context analysis (optional)
 * @param participants - Participant list for correlation (optional)
 * @returns Correlation result with validation status and notes
 */
export function correlateResults(
  cropAnalysis: CropAnalysisResult[],
  contextAnalysis: ContextAnalysisResult | null,
  participants?: ParticipantInfo[]
): CorrelationResult {
  const notes: string[] = [];
  let validated = false;

  if (!contextAnalysis || !participants || participants.length === 0) {
    return { validated: false, notes: ['No context or participants for correlation'] };
  }

  // Check if sponsors match known teams
  for (const crop of cropAnalysis) {
    if (!crop.raceNumber) continue;

    const participant = participants.find(p => p.numero === crop.raceNumber);
    if (!participant) continue;

    // Check sponsor correlation
    if (participant.sponsor && contextAnalysis.sponsors.length > 0) {
      const sponsorMatch = contextAnalysis.sponsors.some(s =>
        participant.sponsor?.toLowerCase().includes(s.toLowerCase()) ||
        s.toLowerCase().includes(participant.sponsor?.toLowerCase() || '')
      );
      if (sponsorMatch) {
        notes.push(`Sponsor correlated for #${crop.raceNumber}: ${participant.sponsor}`);
        validated = true;
      }
    }

    // Check team color correlation
    if (participant.squadra && contextAnalysis.teamColors.length > 0) {
      notes.push(`Team ${participant.squadra} colors: ${contextAnalysis.teamColors.join(', ')}`);
    }
  }

  // Check for potential OCR errors using context numbers
  if (contextAnalysis.otherRaceNumbers.length > 0) {
    notes.push(`Other numbers in context: ${contextAnalysis.otherRaceNumbers.join(', ')}`);
  }

  return { validated, notes };
}

/**
 * Extract primary race number from crop analysis
 * Returns the highest confidence result
 */
export function getPrimaryResult(cropAnalysis: CropAnalysisResult[]): CropAnalysisResult | null {
  if (cropAnalysis.length === 0) return null;

  // Sort by confidence descending
  const sorted = [...cropAnalysis].sort((a, b) => b.confidence - a.confidence);

  // Return first one with a race number, or just the first one
  return sorted.find(c => c.raceNumber !== null) || sorted[0];
}
