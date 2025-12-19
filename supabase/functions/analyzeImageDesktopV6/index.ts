/**
 * Edge Function V6: Multi-Image Crop + Context Analysis
 *
 * Receives multiple high-resolution crop images from desktop client
 * plus a "negative" context image with subject areas masked.
 *
 * Uses Gemini multi-image capability to analyze:
 * 1. Each crop for race number, driver, team identification
 * 2. Context negative for sponsors, other numbers, category identification
 *
 * MODULAR ARCHITECTURE (December 2024):
 * - Loads configuration from sport_categories table
 * - Uses ai_prompt from database (not hardcoded)
 * - Applies recognition_config filters
 * - NO token deduction (desktop client handles tokens)
 *
 * BACKWARD COMPATIBILITY:
 * - Only called when sport_category.crop_config.enabled = true
 * - Desktop client falls back to V4/V5 if crop_config is null or disabled
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Modules
import { loadSportCategory, validateV6Config } from './modules/sport-category-loader.ts';
import { buildAnalysisPrompt } from './modules/prompt-builder.ts';
import { analyzeWithGemini, isVertexConfigured } from './modules/gemini-analyzer.ts';
import { parseGeminiResponse, correlateResults, getPrimaryResult } from './modules/response-parser.ts';
import { saveAnalysisResults, calculateCost } from './modules/database-writer.ts';

// Types and constants
import { RequestBody, SuccessResponse, ErrorResponse } from './types/index.ts';
import { CORS_HEADERS, LOG_PREFIX } from './config/constants.ts';

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body: RequestBody = await req.json();
    const { crops, negative, category, userId, executionId, imageId, originalFileName, storagePath, participantPreset } = body;

    // Validate required fields
    if (!crops || crops.length === 0) {
      throw new Error('No crops provided. Use V4/V5 for single-image analysis.');
    }

    console.log(`${LOG_PREFIX} Request: ${crops.length} crops, negative: ${!!negative}, category: ${category || 'default'}`);

    // Check Vertex AI configuration
    if (!isVertexConfigured()) {
      throw new Error('Vertex AI not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Load sport category config from database
    const categoryConfig = await loadSportCategory(supabase, category || 'motorsport');
    validateV6Config(categoryConfig);

    // 2. Build prompt using ai_prompt from database + participant context
    const partialFlags = crops.map(c => c.isPartial);
    const prompt = buildAnalysisPrompt(
      categoryConfig,
      crops.length,
      !!negative,
      participantPreset?.participants,
      partialFlags
    );

    // 3. Call Gemini via Vertex AI
    const geminiResult = await analyzeWithGemini(
      crops,
      negative,
      prompt,
      categoryConfig.fallbackPrompt
    );

    // 4. Parse and filter response using recognition_config
    const { cropAnalysis, contextAnalysis } = parseGeminiResponse(
      geminiResult.rawResponse,
      crops,
      !!negative,
      categoryConfig.recognitionConfig
    );

    // 5. Correlate results with participant data
    const correlation = correlateResults(
      cropAnalysis,
      contextAnalysis,
      participantPreset?.participants
    );

    // Calculate cost
    const estimatedCostUSD = calculateCost(geminiResult.inputTokens, geminiResult.outputTokens);
    const inferenceTimeMs = Date.now() - startTime;

    // 6. Save to database (non-blocking, no token deduction)
    await saveAnalysisResults(supabase, {
      imageId: imageId || '',
      executionId,
      userId: userId || '',
      cropAnalysis,
      contextAnalysis,
      correlation,
      usage: {
        cropsCount: crops.length,
        hasNegative: !!negative,
        inputTokens: geminiResult.inputTokens,
        outputTokens: geminiResult.outputTokens,
        estimatedCostUSD
      },
      categoryCode: categoryConfig.code,
      originalFileName,
      storagePath,
      inferenceTimeMs
    });

    // 7. Build success response
    const response: SuccessResponse = {
      success: true,
      cropAnalysis,
      contextAnalysis,
      correlation,
      usage: {
        cropsCount: crops.length,
        hasNegative: !!negative,
        inputTokens: geminiResult.inputTokens,
        outputTokens: geminiResult.outputTokens,
        estimatedCostUSD,
      },
      inferenceTimeMs,
    };

    console.log(`${LOG_PREFIX} Success: ${cropAnalysis.length} crops, ${inferenceTimeMs}ms`);

    return new Response(JSON.stringify(response), {
      headers: CORS_HEADERS,
    });

  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error:`, error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: error.message || 'Unknown error',
      details: error.stack,
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
