/**
 * Edge Function V4: Unified Recognition Engine
 *
 * Supports both:
 * - Gemini Vision AI (V3 logic)
 * - RF-DETR (Roboflow object detection)
 *
 * Recognition method is determined by sport_categories.recognition_method
 * Automatic fallback from RF-DETR to Gemini on failure
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';
import { encode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

// ==================== TYPE DEFINITIONS ====================

interface RequestBody {
  imagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  modelName?: string;           // Used for Gemini only
  userId?: string;
  category?: string;
  userEmail?: string;
  executionId?: string;
  participantPreset?: {
    name: string;
    participants: Array<{
      numero?: string;
      nome?: string;
      navigatore?: string;
      squadra?: string;
      sponsor?: string;
      metatag?: string;
    }>;
  };
}

interface SportCategory {
  id: string;
  code: string;
  name: string;
  recognition_method: 'gemini' | 'rf-detr';
  rf_detr_workflow_url?: string;  // Can be direct model URL or workflow URL
  rf_detr_api_key_env?: string;
  ai_prompt?: string;
  fallback_prompt?: string;
  recognition_config?: any;
  edge_function_version?: number;
}

interface RoboflowPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class_id: number;
  class: string;                // Format: "MODEL_NUMBER" e.g., "SF-25_16"
  detection_id: string;
  parent_id: string;
}

interface RoboflowResponse {
  model_predictions: {
    image: {
      width: number;
      height: number;
    };
    predictions: RoboflowPrediction[];
  };
}

interface AnalysisResult {
  raceNumber: string | null;
  drivers: string[];
  category: string | null;
  teamName: string | null;
  otherText: string[];
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  detectionId?: string;
  modelSource?: 'gemini' | 'rf-detr';
}

interface SuccessResponse {
  success: true;
  analysis: AnalysisResult[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  };
  rfDetrUsage?: {
    detectionsCount: number;
    inferenceTimeMs: number;        // Actual inference time in milliseconds
    inferenceTimeSec: number;       // Actual inference time in seconds
    estimatedCostUSD: number;       // Estimated cost ($0.0045 baseline)
    actualCostUSD: number;          // Actual cost based on inference time
  };
  tokenInfo?: {
    tokensConsumed: number;
    remainingTokens: number;
    consumptionSuccessful: boolean;
  };
  imageId: string;
  recognitionMethod: 'gemini' | 'rf-detr';
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}

// ==================== CONFIGURATION ====================

const ROBOFLOW_CONFIG = {
  overlapThreshold: 0.5,          // IoU threshold for filtering overlapping detections
  minConfidence: 0.7,             // Minimum confidence score
  estimatedCostPerImage: 0.0045,  // ~$0.0045 per image
  timeout: 30000                  // 30 seconds
};

// ==================== RF-DETR UTILITY FUNCTIONS ====================

/**
 * Extract race number from RF-DETR class label
 * Supports multiple formats:
 * - "MODEL_NUMBER" format: "SF-25_16" → "16"
 * - Direct number: "16" → "16"
 * - Multiple underscores: "MODEL_VARIANT_16" → "16"
 */
function extractRaceNumberFromLabel(classLabel: string): string | null {
  console.log(`[RF-DETR] Parsing label: "${classLabel}"`);

  // Check if label is already just a number (e.g., "16")
  if (/^\d+$/.test(classLabel)) {
    console.log(`[RF-DETR] ✓ Direct number format: ${classLabel}`);
    return classLabel;
  }

  // Try to extract from "MODEL_NUMBER" format
  const parts = classLabel.split('_');

  if (parts.length >= 2) {
    // Last part should be race number
    const raceNumber = parts[parts.length - 1];

    // Validate it's numeric
    if (/^\d+$/.test(raceNumber)) {
      console.log(`[RF-DETR] ✓ Extracted from format "${classLabel}": ${raceNumber}`);
      return raceNumber;
    } else {
      console.warn(`[RF-DETR] ✗ Last part not numeric in label: ${classLabel}`);
    }
  }

  // Try to find any numeric sequence in the label as fallback
  const numericMatch = classLabel.match(/\d+/);
  if (numericMatch) {
    console.warn(`[RF-DETR] ⚠ Fallback: extracted first number from "${classLabel}": ${numericMatch[0]}`);
    return numericMatch[0];
  }

  console.error(`[RF-DETR] ✗ Failed to extract race number from: ${classLabel}`);
  return null;
}

/**
 * Calculate Intersection over Union (IoU) between two bounding boxes
 */
function calculateIoU(box1: RoboflowPrediction, box2: RoboflowPrediction): number {
  // Calculate intersection
  const x1 = Math.max(box1.x - box1.width / 2, box2.x - box2.width / 2);
  const y1 = Math.max(box1.y - box1.height / 2, box2.y - box2.height / 2);
  const x2 = Math.min(box1.x + box1.width / 2, box2.x + box2.width / 2);
  const y2 = Math.min(box1.y + box1.height / 2, box2.y + box2.height / 2);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;

  // Calculate union
  const box1Area = box1.width * box1.height;
  const box2Area = box2.width * box2.height;
  const unionArea = box1Area + box2Area - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

/**
 * Filter overlapping detections using Non-Maximum Suppression (NMS)
 * Keeps highest confidence detection when boxes overlap above threshold
 */
function filterOverlappingDetections(
  predictions: RoboflowPrediction[],
  iouThreshold: number = ROBOFLOW_CONFIG.overlapThreshold
): RoboflowPrediction[] {
  if (predictions.length === 0) return [];

  // Sort by confidence descending
  const sorted = [...predictions].sort((a, b) => b.confidence - a.confidence);
  const filtered: RoboflowPrediction[] = [];

  for (const pred of sorted) {
    // Check if overlaps with already selected predictions
    const hasOverlap = filtered.some(
      selected => calculateIoU(pred, selected) > iouThreshold
    );

    if (!hasOverlap) {
      filtered.push(pred);
      console.log(`[RF-DETR] Keeping detection: ${pred.class} (confidence: ${pred.confidence.toFixed(3)})`);
    } else {
      console.log(`[RF-DETR] Filtering overlapping detection: ${pred.class} (confidence: ${pred.confidence.toFixed(3)})`);
    }
  }

  console.log(`[RF-DETR] Filtered ${predictions.length} → ${filtered.length} detections`);
  return filtered;
}

/**
 * Convert RF-DETR response to standard analysis format
 * Supports both direct model API and workflow API response formats
 */
function convertRfDetrToAnalysisFormat(
  rfDetrResponse: any,
  iouThreshold: number = ROBOFLOW_CONFIG.overlapThreshold
): AnalysisResult[] {
  if (!rfDetrResponse) {
    console.warn('[RF-DETR] Empty response');
    return [];
  }

  // Auto-detect response format
  // Direct Model API: { predictions: [...], image: {...} }
  // Workflow API: [{ model_predictions: { predictions: [...], image: {...} } }]
  let modelPredictions;
  if (Array.isArray(rfDetrResponse) && rfDetrResponse[0]?.model_predictions) {
    // Workflow format
    console.log('[RF-DETR] Detected workflow API response format');
    modelPredictions = rfDetrResponse[0].model_predictions;
  } else if (rfDetrResponse.predictions && rfDetrResponse.image) {
    // Direct model format
    console.log('[RF-DETR] Detected direct model API response format');
    modelPredictions = rfDetrResponse;
  } else {
    console.warn('[RF-DETR] Unknown response format');
    return [];
  }

  if (!modelPredictions?.predictions) {
    console.warn('[RF-DETR] No predictions in response');
    return [];
  }

  console.log(`[RF-DETR] Raw predictions: ${modelPredictions.predictions.length}`);

  // Log all raw predictions for debugging
  modelPredictions.predictions.forEach((pred: any, idx: number) => {
    console.log(`[RF-DETR] Prediction ${idx + 1}: class="${pred.class}", confidence=${pred.confidence.toFixed(3)}`);
  });

  // Filter overlapping detections
  const filtered = filterOverlappingDetections(
    modelPredictions.predictions,
    iouThreshold
  );

  console.log(`[RF-DETR] After NMS filtering: ${filtered.length} detections`);

  // Convert to standard format
  const analysis = filtered.map(pred => {
    const raceNumber = extractRaceNumberFromLabel(pred.class);

    return {
      raceNumber,
      drivers: [],              // Empty - will be populated by SmartMatcher
      category: null,           // Not available from RF-DETR
      teamName: null,           // Not available from RF-DETR
      otherText: [],
      confidence: pred.confidence,
      boundingBox: {
        x: pred.x,
        y: pred.y,
        width: pred.width,
        height: pred.height
      },
      detectionId: pred.detection_id,
      modelSource: 'rf-detr' as const
    };
  });

  // Log results before filtering
  console.log(`[RF-DETR] Before label validation: ${analysis.length} results`);
  const validResults = analysis.filter(result => result.raceNumber !== null);
  const invalidCount = analysis.length - validResults.length;

  if (invalidCount > 0) {
    console.warn(`[RF-DETR] ⚠ Filtered out ${invalidCount} results with invalid race numbers`);
  }

  console.log(`[RF-DETR] Final valid analysis results: ${validResults.length}`);
  return validResults;
}

/**
 * Call Roboflow Model API (Direct Model Inference)
 * Supports direct model URLs: https://serverless.roboflow.com/model-id/version
 * Returns: { response, inferenceTimeMs, inferenceTimeSec }
 */
async function callRoboflowModel(
  imageUrl: string,
  modelUrl: string,
  apiKey: string
): Promise<{ response: any; inferenceTimeMs: number; inferenceTimeSec: number }> {
  console.log(`[RF-DETR] Calling model: ${modelUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROBOFLOW_CONFIG.timeout);

  // Track inference time
  const startTime = Date.now();

  try {
    // Build URL with query parameters for direct model inference
    const url = new URL(modelUrl);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('image', imageUrl);

    const response = await fetch(url.toString(), {
      method: 'POST',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RF-DETR API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Calculate inference time
    const inferenceTimeMs = Date.now() - startTime;
    const inferenceTimeSec = inferenceTimeMs / 1000;

    console.log(`[RF-DETR] ✓ Inference completed in ${inferenceTimeMs}ms (${inferenceTimeSec.toFixed(3)}s)`);

    return {
      response: data,
      inferenceTimeMs,
      inferenceTimeSec
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`RF-DETR API timeout after ${ROBOFLOW_CONFIG.timeout}ms`);
    }

    throw error;
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
      }
    });
  }

  try {
    console.log('[V4] ========== New request ==========');

    // Parse request body
    const body: RequestBody = await req.json();
    const {
      imagePath,
      originalFilename,
      mimeType,
      sizeBytes,
      modelName,
      userId,
      category,
      userEmail,
      executionId,
      participantPreset
    } = body;

    // Validate required fields
    if (!imagePath || !originalFilename || !mimeType || !sizeBytes) {
      throw new Error('Missing required fields');
    }

    console.log(`[V4] Processing: ${originalFilename}, category: ${category || 'motorsport'}`);

    // Initialize Supabase client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Load sport category configuration
    console.log(`[V4] Loading sport category: ${category || 'motorsport'}`);
    const { data: sportCategory, error: categoryError } = await supabaseAdmin
      .from('sport_categories')
      .select('*')
      .eq('code', category || 'motorsport')
      .eq('is_active', true)
      .single();

    if (categoryError || !sportCategory) {
      console.warn(`[V4] Category not found, using default motorsport`);
      // Continue with default Gemini fallback
    }

    const recognitionMethod = sportCategory?.recognition_method || 'gemini';
    console.log(`[V4] Recognition method: ${recognitionMethod}`);

    // Get signed URL for image
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
      .storage
      .from('uploaded-images')
      .createSignedUrl(imagePath, 3600); // 1 hour validity

    if (signedUrlError) {
      throw new Error(`Error creating signed URL: ${signedUrlError.message}`);
    }

    const imageUrl = signedUrlData.signedUrl;
    console.log(`[V4] Image URL generated`);

    // Route to appropriate recognition method
    let analysisResult: SuccessResponse;

    if (recognitionMethod === 'rf-detr' && sportCategory?.rf_detr_workflow_url) {
      // Attempt RF-DETR recognition (direct model or workflow API)
      try {
        console.log('[V4] Attempting RF-DETR recognition...');

        // Get API key from environment
        const apiKeyEnv = sportCategory.rf_detr_api_key_env || 'ROBOFLOW_DEFAULT_API_KEY';
        const apiKey = Deno.env.get(apiKeyEnv);

        if (!apiKey) {
          console.warn(`[V4] API key ${apiKeyEnv} not found, falling back to Gemini`);
          throw new Error(`Missing API key: ${apiKeyEnv}`);
        }

        // Call RF-DETR with timing tracking
        const rfDetrResult = await callRoboflowModel(
          imageUrl,
          sportCategory.rf_detr_workflow_url,
          apiKey
        );

        // Calculate actual cost based on inference time
        // V2 API pricing: $4 per 500 seconds = $0.008 per second
        const actualCostUSD = rfDetrResult.inferenceTimeSec * (4 / 500);

        console.log(`[RF-DETR] 💰 Cost: $${actualCostUSD.toFixed(5)} (actual) vs $${ROBOFLOW_CONFIG.estimatedCostPerImage} (estimated)`);

        // Convert to standard format
        const analysis = convertRfDetrToAnalysisFormat(rfDetrResult.response);

        if (analysis.length === 0) {
          console.warn('[V4] RF-DETR returned no valid detections, falling back to Gemini');
          throw new Error('No valid RF-DETR detections');
        }

        console.log(`[V4] ✓ RF-DETR SUCCESS: ${analysis.length} detections with confidence ${analysis[0]?.confidence.toFixed(3)}`);

        // Create image record for tracking
        const { data: imageData, error: imageError } = await supabaseAdmin
          .from('images')
          .insert({
            user_id: userId,
            file_name: originalFilename,
            file_path: imagePath,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            execution_id: executionId
          })
          .select()
          .single();

        const imageId = imageData?.id || '';

        // Save analysis results with bounding boxes and timing
        if (imageId && analysis.length > 0) {
          // Extract predictions and image info (works for both formats)
          const predictions = Array.isArray(rfDetrResult.response)
            ? rfDetrResult.response[0].model_predictions.predictions
            : rfDetrResult.response.predictions;
          const imageSize = Array.isArray(rfDetrResult.response)
            ? rfDetrResult.response[0].model_predictions.image
            : rfDetrResult.response.image;

          await supabaseAdmin.from('analysis_results').insert({
            image_id: imageId,
            analysis_provider: 'rf-detr',
            recognized_number: analysis[0].raceNumber,
            confidence_score: analysis[0].confidence,
            raw_response: {
              modelSource: 'rf-detr',
              modelUrl: sportCategory.rf_detr_workflow_url,
              predictions,
              analysis,
              boundingBoxes: analysis.map(a => a.boundingBox),
              imageSize,
              inferenceTimeMs: rfDetrResult.inferenceTimeMs,
              inferenceTimeSec: rfDetrResult.inferenceTimeSec,
              actualCostUSD,
              timestamp: new Date().toISOString()
            }
          });
        }

        analysisResult = {
          success: true,
          analysis,
          rfDetrUsage: {
            detectionsCount: analysis.length,
            inferenceTimeMs: rfDetrResult.inferenceTimeMs,
            inferenceTimeSec: rfDetrResult.inferenceTimeSec,
            estimatedCostUSD: ROBOFLOW_CONFIG.estimatedCostPerImage,
            actualCostUSD
          },
          imageId,
          recognitionMethod: 'rf-detr'
        };

        console.log(`[V4] ✓ RF-DETR analysisResult set with recognitionMethod: ${analysisResult.recognitionMethod}`);

      } catch (rfDetrError: any) {
        console.error('[V4] ✗ RF-DETR FAILED, falling back to Gemini:', rfDetrError.message);
        // Fall through to Gemini
        analysisResult = null as any; // Will be set by Gemini fallback
      }
    }

    // Gemini fallback or primary method
    if (!analysisResult) {
      console.log('[V4] Using Gemini recognition (delegating to V3)...');

      // Delegate to analyzeImageDesktopV3 for Gemini processing
      // This reuses all the tested V3 logic (prompts, parsing, token management, etc.)
      const v3Url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyzeImageDesktopV3`;
      const v3Response = await fetch(v3Url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!v3Response.ok) {
        throw new Error(`V3 delegation failed: ${v3Response.statusText}`);
      }

      const v3Data = await v3Response.json();
      console.log(`[V4] V3 delegation successful: ${v3Data.analysis?.length || 0} results`);

      // Add recognitionMethod to response
      analysisResult = {
        ...v3Data,
        recognitionMethod: 'gemini'
      };
    }

    // Return success response
    return new Response(
      JSON.stringify(analysisResult),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        }
      }
    );

  } catch (error) {
    console.error('[V4] Error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: error.message || 'Unknown error',
      details: error
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  }
});
