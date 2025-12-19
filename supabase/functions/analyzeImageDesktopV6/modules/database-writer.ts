/**
 * Database Writer Module
 *
 * Gestisce la scrittura dei risultati su Supabase:
 * - analysis_results (crop_analysis, context_analysis)
 * - execution_logs (tracking)
 * - images (status update)
 *
 * NON tocca user_tokens - la deduction token avviene sul desktop client.
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
 * Save analysis results to database
 *
 * This function saves to multiple tables for queryability and tracking.
 * Errors are logged but don't fail the request (JSONL backup still works).
 *
 * @param supabase - Supabase client instance
 * @param params - Save parameters including results and metadata
 */
export async function saveAnalysisResults(
  supabase: SupabaseClient,
  params: SaveResultsParams
): Promise<void> {
  const {
    imageId,
    executionId,
    userId,
    cropAnalysis,
    contextAnalysis,
    correlation,
    usage,
    categoryCode,
    originalFileName,
    storagePath,
    inferenceTimeMs
  } = params;

  // Save to execution_logs for tracking
  if (executionId && userId) {
    await saveExecutionLog(supabase, {
      executionId,
      cropAnalysis,
      usage,
      inferenceTimeMs,
      categoryCode
    });
  }

  // Save to images and analysis_results
  if (userId && imageId) {
    await saveImageRecord(supabase, {
      imageId,
      userId,
      executionId,
      originalFileName,
      storagePath
    });

    await saveAnalysisRecord(supabase, {
      imageId,
      cropAnalysis,
      contextAnalysis,
      correlation,
      usage,
      inferenceTimeMs
    });
  }
}

/**
 * Save execution log for tracking and analytics
 */
async function saveExecutionLog(
  supabase: SupabaseClient,
  params: {
    executionId: string;
    cropAnalysis: CropAnalysisResult[];
    usage: UsageStats;
    inferenceTimeMs: number;
    categoryCode: string;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from('execution_logs').insert({
      execution_id: params.executionId,
      log_type: 'v6_crop_context',
      log_data: {
        cropsCount: params.usage.cropsCount,
        hasNegative: params.usage.hasNegative,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        estimatedCostUSD: params.usage.estimatedCostUSD,
        inferenceTimeMs: params.inferenceTimeMs,
        recognizedNumbers: params.cropAnalysis.map(c => c.raceNumber).filter(Boolean),
        categoryCode: params.categoryCode,
        // Gemini config
        modelUsed: getCurrentModel(),
        vertexLocation: getVertexLocation(),
        thinkingLevel: VERTEX_AI.THINKING_LEVEL,
        mediaResolution: VERTEX_AI.MEDIA_RESOLUTION,
      },
    });

    if (error) {
      console.warn(`${LOG_PREFIX} Failed to log execution:`, error);
    }
  } catch (logError) {
    console.warn(`${LOG_PREFIX} Exception logging execution:`, logError);
  }
}

/**
 * Upsert image record with status='analyzed'
 */
async function saveImageRecord(
  supabase: SupabaseClient,
  params: {
    imageId: string;
    userId: string;
    executionId?: string;
    originalFileName?: string;
    storagePath?: string;
  }
): Promise<void> {
  try {
    const { error } = await supabase
      .from('images')
      .upsert({
        id: params.imageId,
        user_id: params.userId,
        original_filename: params.originalFileName || 'unknown',
        storage_path: params.storagePath || null,
        execution_id: params.executionId || null,
        status: 'analyzed'
      }, { onConflict: 'id' });

    if (error) {
      console.warn(`${LOG_PREFIX} Failed to upsert image:`, error);
    }
  } catch (dbError) {
    console.warn(`${LOG_PREFIX} Exception upserting image:`, dbError);
  }
}

/**
 * Insert analysis results with V6-specific columns
 */
async function saveAnalysisRecord(
  supabase: SupabaseClient,
  params: {
    imageId: string;
    cropAnalysis: CropAnalysisResult[];
    contextAnalysis: ContextAnalysisResult | null;
    correlation: CorrelationResult;
    usage: UsageStats;
    inferenceTimeMs: number;
  }
): Promise<void> {
  try {
    const primaryCrop = params.cropAnalysis[0];

    const { error } = await supabase
      .from('analysis_results')
      .insert({
        image_id: params.imageId,
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
        execution_time_ms: params.inferenceTimeMs
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
