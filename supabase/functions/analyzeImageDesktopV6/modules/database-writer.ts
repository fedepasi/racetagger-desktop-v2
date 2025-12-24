/**
 * Database Writer Module
 *
 * Gestisce la scrittura dei risultati su Supabase:
 * - analysis_results (crop_analysis, context_analysis)
 * - images (create record with UUID)
 *
 * NON tocca user_tokens - la deduction token avviene sul desktop client.
 *
 * FIX December 2024: Generate UUID server-side like V3, don't rely on
 * desktop-provided imageId which may be a local temporary ID.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SaveResultsParams,
  CropAnalysisResult,
  ContextAnalysisResult,
  CorrelationResult,
  UsageStats
} from '../types/index.ts';
import { LOG_PREFIX, EDGE_FUNCTION_VERSION, ANALYSIS_PROVIDER, VERTEX_AI } from '../config/constants.ts';
import { getCurrentModel, getVertexLocation } from './gemini-analyzer.ts';

/**
 * Check if a string is a valid UUID v4
 */
function isValidUUID(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Save analysis results to database
 *
 * This function saves to multiple tables for queryability and tracking.
 * Errors are logged but don't fail the request (JSONL backup still works).
 *
 * FIX: Now generates UUID server-side if imageId is not a valid UUID,
 * matching V3 behavior where the edge function creates the images record.
 *
 * @param supabase - Supabase client instance
 * @param params - Save parameters including results and metadata
 * @returns The actual database imageId used (for token tracking)
 */
export async function saveAnalysisResults(
  supabase: SupabaseClient,
  params: SaveResultsParams
): Promise<string | null> {
  const {
    imageId: providedImageId,
    executionId,
    userId,
    cropAnalysis,
    contextAnalysis,
    correlation,
    usage,
    categoryCode,
    originalFileName,
    storagePath,
    mimeType,
    sizeBytes,
    inferenceTimeMs,
    analysisLog
  } = params;

  // Save to images and analysis_results (requires userId)
  if (!userId) {
    console.warn(`${LOG_PREFIX} Cannot save to DB: userId is missing`);
    return null;
  }

  // Create image record and get the actual database UUID
  const dbImageId = await createImageRecord(supabase, {
    providedImageId,
    userId,
    executionId,
    originalFileName,
    storagePath,
    mimeType,
    sizeBytes
  });

  if (!dbImageId) {
    console.warn(`${LOG_PREFIX} Failed to create image record, skipping analysis_results save`);
    return null;
  }

  // Save analysis results with the database UUID
  await saveAnalysisRecord(supabase, {
    imageId: dbImageId,
    userId,  // Pass userId for RLS policy
    cropAnalysis,
    contextAnalysis,
    correlation,
    usage,
    inferenceTimeMs,
    analysisLog
  });

  return dbImageId;
}

/**
 * Create image record in database (like V3)
 *
 * If providedImageId is a valid UUID, use it. Otherwise, let the database
 * generate a new UUID. This fixes the issue where desktop app sends
 * local temporary IDs instead of valid UUIDs.
 *
 * @returns The actual database UUID, or null on failure
 */
async function createImageRecord(
  supabase: SupabaseClient,
  params: {
    providedImageId?: string;
    userId: string;
    executionId?: string;
    originalFileName?: string;
    storagePath?: string;
    mimeType?: string;
    sizeBytes?: number;
  }
): Promise<string | null> {
  try {
    // Build image data object
    const imageData: Record<string, any> = {
      user_id: params.userId,
      original_filename: params.originalFileName || 'unknown',
      storage_path: params.storagePath || null,
      mime_type: params.mimeType || 'image/jpeg',
      size_bytes: params.sizeBytes || 0,
      status: 'analyzed'
    };

    // Add execution_id if provided
    if (params.executionId) {
      imageData.execution_id = params.executionId;
    }

    // Only use providedImageId if it's a valid UUID
    // Otherwise, let the database generate the UUID
    if (params.providedImageId && isValidUUID(params.providedImageId)) {
      imageData.id = params.providedImageId;
      console.log(`${LOG_PREFIX} Using provided UUID: ${params.providedImageId}`);
    } else {
      console.log(`${LOG_PREFIX} Provided imageId is not a valid UUID ('${params.providedImageId}'), letting DB generate one`);
    }

    // Insert the record and get the generated/used ID back
    const { data: newImageRecord, error: imageInsertError } = await supabase
      .from('images')
      .insert(imageData)
      .select('id')
      .single();

    if (imageInsertError || !newImageRecord) {
      console.error(`${LOG_PREFIX} Database Image Insert Error:`, imageInsertError);
      console.error(`${LOG_PREFIX} INSERT payload was: user_id=${params.userId}, execution_id=${params.executionId}, filename=${params.originalFileName}`);
      return null;
    }

    const dbImageId = newImageRecord.id;
    console.log(`${LOG_PREFIX} Image record created with ID: ${dbImageId}`);

    return dbImageId;
  } catch (dbError) {
    console.error(`${LOG_PREFIX} Exception creating image record:`, dbError);
    return null;
  }
}

/**
 * Insert analysis results with V6-specific columns
 */
async function saveAnalysisRecord(
  supabase: SupabaseClient,
  params: {
    imageId: string;
    userId: string;  // Added for RLS policy
    cropAnalysis: CropAnalysisResult[];
    contextAnalysis: ContextAnalysisResult | null;
    correlation: CorrelationResult;
    usage: UsageStats;
    inferenceTimeMs: number;
    analysisLog?: Record<string, any>;
  }
): Promise<void> {
  try {
    const primaryCrop = params.cropAnalysis[0];

    const { error } = await supabase
      .from('analysis_results')
      .insert({
        image_id: params.imageId,
        user_id: params.userId,  // Save user_id for RLS policy
        analysis_provider: ANALYSIS_PROVIDER,

        // Primary result (for backward compatibility with V3/V4/V5 queries)
        recognized_number: primaryCrop?.raceNumber || null,
        confidence_score: primaryCrop?.confidence || 0,
        confidence_level: getConfidenceLevel(primaryCrop?.confidence || 0),

        // Raw response for debugging
        raw_response: {
          crops: params.cropAnalysis,
          context: params.contextAnalysis,
          correlation: params.correlation,
          modelSource: getCurrentModel(),
          vertexLocation: getVertexLocation(),
          thinkingLevel: VERTEX_AI.THINKING_LEVEL,
          mediaResolution: VERTEX_AI.MEDIA_RESOLUTION
        },

        // V6-specific columns
        crop_analysis: params.cropAnalysis,
        context_analysis: params.contextAnalysis,
        edge_function_version: EDGE_FUNCTION_VERSION,

        // Token usage
        input_tokens: params.usage.inputTokens,
        output_tokens: params.usage.outputTokens,
        estimated_cost_usd: params.usage.estimatedCostUSD,
        execution_time_ms: params.inferenceTimeMs,

        // Complete IMAGE_ANALYSIS log event (same as JSONL)
        analysis_log: params.analysisLog || null
      });

    if (error) {
      console.warn(`${LOG_PREFIX} Failed to insert analysis_results:`, error);
    } else {
      console.log(`${LOG_PREFIX} Saved to analysis_results for image ${params.imageId}`);
    }
  } catch (dbError) {
    console.warn(`${LOG_PREFIX} Exception inserting analysis_results:`, dbError);
  }
}

/**
 * Convert confidence score to level string
 */
function getConfidenceLevel(confidence: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (confidence >= 0.8) return 'HIGH';
  if (confidence >= 0.5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate estimated cost from token usage
 */
export function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 0.50;  // $0.50 per million
  const outputCost = (outputTokens / 1_000_000) * 3.00; // $3.00 per million
  return inputCost + outputCost;
}
