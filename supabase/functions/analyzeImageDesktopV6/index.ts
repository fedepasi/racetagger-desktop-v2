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
 * V6 BASELINE 2026:
 * - Supports fullImage fallback when no crops detected
 * - Tracks bboxSource for each crop (yolo-seg, onnx-detr, full-image, etc.)
 * - Desktop routing maintained via sport_categories.edge_function_version
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Modules
import { loadSportCategory, validateV6Config } from './modules/sport-category-loader.ts';
import { buildAnalysisPrompt } from './modules/prompt-builder.ts';
import { analyzeWithGemini, isVertexConfigured } from './modules/gemini-analyzer.ts';
import { parseGeminiResponse, correlateResults, getPrimaryResult } from './modules/response-parser.ts';
import { saveAnalysisResults, calculateCost } from './modules/database-writer.ts';
import { analyzeFullImage, buildFullImagePrompt } from './modules/full-image-handler.ts';
import { loadImageFromStorage } from './modules/image-loader.ts';

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
    const {
      crops,
      negative,
      category,
      userId,
      executionId,
      imageId,
      originalFileName,
      storagePath,
      participantPreset,
      fullImage,      // V6 Baseline 2026
      bboxSources,    // V6 Baseline 2026
      imagePath,      // V6 2026: V3-compatible mode
      mimeType,       // V6 2026: for logging and database
      sizeBytes,      // V6 2026: for database
      analysisLog     // V6 2026: complete IMAGE_ANALYSIS event from desktop
    } = body;

    // V6 2026: Support multiple input modes (crops, fullImage, or imagePath)
    const hasCrops = crops && crops.length > 0;
    let hasFullImage = !!fullImage;
    const hasImagePath = !!imagePath;

    // V6 2026: If imagePath provided without crops/fullImage, load from Storage
    let loadedFullImage = fullImage;
    if (!hasCrops && !hasFullImage && hasImagePath) {
      console.log(`${LOG_PREFIX} V3-compatible mode: loading from imagePath (${mimeType || 'unknown type'})`);
      try {
        loadedFullImage = await loadImageFromStorage(imagePath);
        hasFullImage = true;
      } catch (loadError: any) {
        throw new Error(`Failed to load image from storage: ${loadError.message}`);
      }
    }

    if (!hasCrops && !hasFullImage) {
      throw new Error('Either crops[], fullImage, or imagePath must be provided');
    }

    const inputMode = hasCrops ? `${crops.length} crops` : (hasImagePath ? 'imagePath' : 'fullImage');
    console.log(`${LOG_PREFIX} Request: ${inputMode}, negative: ${!!negative}, category: ${category || 'default'}`);

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

    // V6 Baseline 2026: Track if we used fullImage fallback
    let usedFullImage = false;
    let geminiResult;
    let effectiveBboxSources = bboxSources;

    if (hasCrops) {
      // 2a. Normal path: Build prompt for crops
      const partialFlags = crops.map(c => c.isPartial);
      const prompt = buildAnalysisPrompt(
        categoryConfig,
        crops.length,
        !!negative,
        participantPreset?.participants,
        partialFlags
      );

      // 3a. Call Gemini with crops
      geminiResult = await analyzeWithGemini(
        crops,
        negative,
        prompt,
        categoryConfig.fallbackPrompt
      );
    } else {
      // 2b. V6 2026: fullImage mode (from base64 or loaded from imagePath)
      const imageSource = hasImagePath ? 'imagePath' : 'fullImage';
      console.log(`${LOG_PREFIX} Using full image analysis (source: ${imageSource})`);
      usedFullImage = true;

      // Build modified prompt for full image analysis
      const basePrompt = buildAnalysisPrompt(
        categoryConfig,
        1,  // Single "crop" (the full image)
        false,  // No negative for full image
        participantPreset?.participants,
        [false]  // Not partial
      );
      const fullImagePrompt = buildFullImagePrompt(basePrompt);

      // 3b. Call Gemini with full image (use loadedFullImage which may come from imagePath)
      geminiResult = await analyzeFullImage(
        loadedFullImage!,
        fullImagePrompt,
        categoryConfig.fallbackPrompt
      );

      // Mark all results as full-image source
      effectiveBboxSources = ['full-image'];
    }

    // 4. Parse and filter response using recognition_config + bboxSources
    const { cropAnalysis, contextAnalysis } = parseGeminiResponse(
      geminiResult.rawResponse,
      hasCrops ? crops : [{ imageData: '', detectionId: 'full_image_0', isPartial: false }],
      !usedFullImage && !!negative,
      categoryConfig.recognitionConfig,
      effectiveBboxSources  // V6 Baseline 2026: Pass bbox sources
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

    // 6. Save to database and get the actual database imageId
    // FIX December 2024: Now generates UUID server-side like V3
    const dbImageId = await saveAnalysisResults(supabase, {
      imageId: imageId || '',
      executionId,
      userId: userId || '',
      cropAnalysis,
      contextAnalysis,
      correlation,
      usage: {
        cropsCount: hasCrops ? crops.length : 1,  // V6 Baseline 2026: Count fullImage as 1
        hasNegative: !usedFullImage && !!negative,
        inputTokens: geminiResult.inputTokens,
        outputTokens: geminiResult.outputTokens,
        estimatedCostUSD
      },
      categoryCode: categoryConfig.code,
      originalFileName,
      storagePath,
      mimeType,
      sizeBytes,
      inferenceTimeMs,
      analysisLog  // Complete IMAGE_ANALYSIS event from desktop JSONL
    });

    // 7. Build success response (include imageId for token tracking, like V3)
    const response: SuccessResponse = {
      success: true,
      cropAnalysis,
      contextAnalysis,
      correlation,
      usage: {
        cropsCount: hasCrops ? crops.length : 1,  // V6 Baseline 2026
        hasNegative: !usedFullImage && !!negative,
        inputTokens: geminiResult.inputTokens,
        outputTokens: geminiResult.outputTokens,
        estimatedCostUSD,
      },
      inferenceTimeMs,
      usedFullImage,  // V6 Baseline 2026: Indicate if fullImage fallback was used
      imageId: dbImageId || undefined,  // FIX: Return actual database UUID for token tracking
    };

    console.log(`${LOG_PREFIX} Success: ${cropAnalysis.length} results${usedFullImage ? ' (fullImage)' : ''}, ${inferenceTimeMs}ms`);

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
