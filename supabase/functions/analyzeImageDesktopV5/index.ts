/**
 * Edge Function V5: Unified Recognition Engine with Face Recognition Support
 *
 * Supports:
 * - Gemini Vision AI (V3 logic)
 * - RF-DETR (Roboflow object detection)
 * - Face Recognition (from desktop client)
 *
 * Recognition method priority:
 * 1. Face Recognition (if high confidence match from desktop)
 * 2. RF-DETR (if configured for category)
 * 3. Gemini Vision AI (fallback)
 *
 * Face recognition is performed locally on desktop using face-api.js
 * and results are sent to this edge function for final analysis composition
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== TYPE DEFINITIONS ====================

interface FaceRecognitionMatch {
  driverId: string;
  driverName: string;
  team: string;
  carNumber: string;
  confidence: number;
  source: 'global' | 'preset';
  referencePhotoUrl?: string;
  faceBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface FaceRecognitionResult {
  success: boolean;
  facesDetected: number;
  matchedDrivers: FaceRecognitionMatch[];
  inferenceTimeMs: number;
  context: 'portrait' | 'action' | 'podium' | 'auto';
}

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
  // V5: Face recognition from desktop
  faceRecognition?: FaceRecognitionResult;
}

interface SportCategory {
  id: string;
  code: string;
  name: string;
  recognition_method: 'gemini' | 'rf-detr';
  rf_detr_workflow_url?: string;
  rf_detr_api_key_env?: string;
  ai_prompt?: string;
  fallback_prompt?: string;
  recognition_config?: any;
  edge_function_version?: number;
  face_recognition_enabled?: boolean;
  face_recognition_config?: {
    minConfidence?: number;
    priorityOverOcr?: boolean;
    contexts?: string[];
  };
}

interface RoboflowPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class_id: number;
  class: string;
  detection_id: string;
  parent_id: string;
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
  modelSource?: 'gemini' | 'rf-detr' | 'face_recognition';
  // V5: Face recognition specific fields
  faceMatch?: FaceRecognitionMatch;
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
    inferenceTimeMs: number;
    inferenceTimeSec: number;
    estimatedCostUSD: number;
    actualCostUSD: number;
  };
  // V5: Face recognition usage
  faceRecognition?: {
    facesDetected: number;
    matchedDrivers: number;
    topMatch?: FaceRecognitionMatch;
    inferenceTimeMs: number;
  };
  tokenInfo?: {
    tokensConsumed: number;
    remainingTokens: number;
    consumptionSuccessful: boolean;
  };
  imageId: string;
  recognitionMethod: 'gemini' | 'rf-detr' | 'face_recognition' | 'hybrid';
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}

// ==================== CONFIGURATION ====================

const ROBOFLOW_CONFIG = {
  overlapThreshold: 0.5,
  minConfidence: 0.7,
  estimatedCostPerImage: 0.0045,
  timeout: 30000
};

const FACE_RECOGNITION_CONFIG = {
  minConfidence: 0.65,          // Minimum confidence for face match to be used
  priorityOverOcr: true,        // Face recognition takes priority when confident
  hybridThreshold: 0.8          // Use face for driver info, OCR for number verification
};

// ==================== RF-DETR UTILITY FUNCTIONS ====================

function extractRaceNumberFromLabel(classLabel: string): string | null {
  console.log(`[RF-DETR] Parsing label: "${classLabel}"`);

  if (/^\d+$/.test(classLabel)) {
    return classLabel;
  }

  const parts = classLabel.split('_');
  if (parts.length >= 2) {
    const raceNumber = parts[parts.length - 1];
    if (/^\d+$/.test(raceNumber)) {
      return raceNumber;
    }
  }

  const numericMatch = classLabel.match(/\d+/);
  if (numericMatch) {
    return numericMatch[0];
  }

  return null;
}

function calculateIoU(box1: RoboflowPrediction, box2: RoboflowPrediction): number {
  const x1 = Math.max(box1.x - box1.width / 2, box2.x - box2.width / 2);
  const y1 = Math.max(box1.y - box1.height / 2, box2.y - box2.height / 2);
  const x2 = Math.min(box1.x + box1.width / 2, box2.x + box2.width / 2);
  const y2 = Math.min(box1.y + box1.height / 2, box2.y + box2.height / 2);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;

  const box1Area = box1.width * box1.height;
  const box2Area = box2.width * box2.height;
  const unionArea = box1Area + box2Area - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

function filterOverlappingDetections(
  predictions: RoboflowPrediction[],
  iouThreshold: number = ROBOFLOW_CONFIG.overlapThreshold
): RoboflowPrediction[] {
  if (predictions.length === 0) return [];

  const sorted = [...predictions].sort((a, b) => b.confidence - a.confidence);
  const filtered: RoboflowPrediction[] = [];

  for (const pred of sorted) {
    const hasOverlap = filtered.some(
      selected => calculateIoU(pred, selected) > iouThreshold
    );

    if (!hasOverlap) {
      filtered.push(pred);
    }
  }

  return filtered;
}

function convertRfDetrToAnalysisFormat(
  rfDetrResponse: any,
  iouThreshold: number = ROBOFLOW_CONFIG.overlapThreshold
): AnalysisResult[] {
  if (!rfDetrResponse) {
    return [];
  }

  let modelPredictions;
  if (Array.isArray(rfDetrResponse) && rfDetrResponse[0]?.model_predictions) {
    modelPredictions = rfDetrResponse[0].model_predictions;
  } else if (rfDetrResponse.predictions && rfDetrResponse.image) {
    modelPredictions = rfDetrResponse;
  } else {
    return [];
  }

  if (!modelPredictions?.predictions) {
    return [];
  }

  const filtered = filterOverlappingDetections(
    modelPredictions.predictions,
    iouThreshold
  );

  const analysis = filtered.map(pred => {
    const raceNumber = extractRaceNumberFromLabel(pred.class);

    return {
      raceNumber,
      drivers: [],
      category: null,
      teamName: null,
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

  return analysis.filter(result => result.raceNumber !== null);
}

async function callRoboflowModel(
  imageUrl: string,
  modelUrl: string,
  apiKey: string
): Promise<{ response: any; inferenceTimeMs: number; inferenceTimeSec: number }> {
  console.log(`[RF-DETR] Calling model: ${modelUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROBOFLOW_CONFIG.timeout);

  const startTime = Date.now();

  try {
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
    const inferenceTimeMs = Date.now() - startTime;
    const inferenceTimeSec = inferenceTimeMs / 1000;

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

// ==================== FACE RECOGNITION UTILITY FUNCTIONS ====================

/**
 * Convert face recognition results to analysis format
 */
function convertFaceRecognitionToAnalysis(
  faceResult: FaceRecognitionResult,
  minConfidence: number = FACE_RECOGNITION_CONFIG.minConfidence
): AnalysisResult[] {
  if (!faceResult?.success || !faceResult.matchedDrivers?.length) {
    return [];
  }

  return faceResult.matchedDrivers
    .filter(match => match.confidence >= minConfidence)
    .map(match => ({
      raceNumber: match.carNumber || null,
      drivers: match.driverName ? [match.driverName] : [],
      category: null,
      teamName: match.team || null,
      otherText: [],
      confidence: match.confidence,
      boundingBox: match.faceBox,
      modelSource: 'face_recognition' as const,
      faceMatch: match
    }));
}

/**
 * Merge face recognition results with OCR/detection results
 * Face recognition provides driver identity, OCR confirms race number
 */
function mergeAnalysisResults(
  faceAnalysis: AnalysisResult[],
  ocrAnalysis: AnalysisResult[],
  priorityConfig: typeof FACE_RECOGNITION_CONFIG
): { merged: AnalysisResult[]; method: 'face_recognition' | 'gemini' | 'rf-detr' | 'hybrid' } {

  // If no face matches, return OCR only
  if (faceAnalysis.length === 0) {
    const method = ocrAnalysis[0]?.modelSource || 'gemini';
    return { merged: ocrAnalysis, method: method as any };
  }

  // If no OCR results, return face only
  if (ocrAnalysis.length === 0) {
    return { merged: faceAnalysis, method: 'face_recognition' };
  }

  // High confidence face match - use face as primary
  const topFace = faceAnalysis[0];
  const topOcr = ocrAnalysis[0];

  if (topFace.confidence >= priorityConfig.hybridThreshold) {
    // Strong face match - use face data, but verify with OCR number if available
    if (topOcr.raceNumber && topFace.raceNumber) {
      if (topOcr.raceNumber === topFace.raceNumber) {
        // Numbers match - highest confidence result
        console.log(`[V5] Face + OCR agree on number: ${topFace.raceNumber}`);
        return {
          merged: [{
            ...topFace,
            confidence: Math.max(topFace.confidence, topOcr.confidence),
            otherText: [`Verified by ${topOcr.modelSource}`]
          }],
          method: 'hybrid'
        };
      } else {
        // Numbers disagree - log warning but trust face for driver identity
        console.warn(`[V5] Number mismatch: Face=${topFace.raceNumber} vs OCR=${topOcr.raceNumber}`);
        return {
          merged: [{
            ...topFace,
            otherText: [`OCR detected: ${topOcr.raceNumber}`]
          }, ...ocrAnalysis],
          method: 'hybrid'
        };
      }
    }

    // Face match without OCR number verification
    return { merged: faceAnalysis, method: 'face_recognition' };
  }

  // Medium confidence face match - include both
  if (priorityConfig.priorityOverOcr && topFace.confidence >= priorityConfig.minConfidence) {
    // Put face first but include OCR
    return {
      merged: [...faceAnalysis, ...ocrAnalysis],
      method: 'hybrid'
    };
  }

  // Low confidence face match - prefer OCR
  return {
    merged: [...ocrAnalysis, ...faceAnalysis],
    method: ocrAnalysis[0]?.modelSource as any || 'gemini'
  };
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
    console.log('[V5] ========== New request ==========');

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
      participantPreset,
      faceRecognition
    } = body;

    // Validate required fields
    if (!imagePath || !originalFilename || !mimeType || !sizeBytes) {
      throw new Error('Missing required fields');
    }

    console.log(`[V5] Processing: ${originalFilename}, category: ${category || 'motorsport'}`);

    // Log face recognition input
    if (faceRecognition) {
      console.log(`[V5] Face Recognition received: ${faceRecognition.facesDetected} faces, ${faceRecognition.matchedDrivers?.length || 0} matches`);
    }

    // Initialize Supabase client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Load sport category configuration
    const { data: sportCategory, error: categoryError } = await supabaseAdmin
      .from('sport_categories')
      .select('*')
      .eq('code', category || 'motorsport')
      .eq('is_active', true)
      .single();

    if (categoryError || !sportCategory) {
      console.warn(`[V5] Category not found, using default motorsport`);
    }

    // Get face recognition config from category or use defaults
    const faceConfig = {
      ...FACE_RECOGNITION_CONFIG,
      ...(sportCategory?.face_recognition_config || {})
    };

    const recognitionMethod = sportCategory?.recognition_method || 'gemini';
    const faceEnabled = sportCategory?.face_recognition_enabled !== false; // Default true

    console.log(`[V5] Recognition method: ${recognitionMethod}, Face enabled: ${faceEnabled}`);

    // Get signed URL for image
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
      .storage
      .from('uploaded-images')
      .createSignedUrl(imagePath, 3600);

    if (signedUrlError) {
      throw new Error(`Error creating signed URL: ${signedUrlError.message}`);
    }

    const imageUrl = signedUrlData.signedUrl;

    // ==================== PROCESS FACE RECOGNITION ====================

    let faceAnalysis: AnalysisResult[] = [];
    let faceRecognitionUsage = null;

    if (faceEnabled && faceRecognition?.success && faceRecognition.matchedDrivers?.length > 0) {
      console.log('[V5] Processing face recognition results...');

      faceAnalysis = convertFaceRecognitionToAnalysis(faceRecognition, faceConfig.minConfidence);

      faceRecognitionUsage = {
        facesDetected: faceRecognition.facesDetected,
        matchedDrivers: faceRecognition.matchedDrivers.length,
        topMatch: faceRecognition.matchedDrivers[0],
        inferenceTimeMs: faceRecognition.inferenceTimeMs
      };

      console.log(`[V5] Face analysis: ${faceAnalysis.length} valid matches above threshold`);

      // High confidence face match - may skip OCR entirely
      if (faceAnalysis.length > 0 && faceAnalysis[0].confidence >= faceConfig.hybridThreshold) {
        console.log(`[V5] High confidence face match (${faceAnalysis[0].confidence.toFixed(2)}) - using as primary`);
      }
    }

    // ==================== ROUTE TO OCR RECOGNITION ====================

    let ocrAnalysis: AnalysisResult[] = [];
    let analysisResult: SuccessResponse | null = null;

    // Attempt RF-DETR if configured
    if (recognitionMethod === 'rf-detr' && sportCategory?.rf_detr_workflow_url) {
      try {
        console.log('[V5] Attempting RF-DETR recognition...');

        const apiKeyEnv = sportCategory.rf_detr_api_key_env || 'ROBOFLOW_DEFAULT_API_KEY';
        const apiKey = Deno.env.get(apiKeyEnv);

        if (!apiKey) {
          throw new Error(`Missing API key: ${apiKeyEnv}`);
        }

        const rfDetrResult = await callRoboflowModel(
          imageUrl,
          sportCategory.rf_detr_workflow_url,
          apiKey
        );

        const actualCostUSD = rfDetrResult.inferenceTimeSec * (4 / 500);
        ocrAnalysis = convertRfDetrToAnalysisFormat(rfDetrResult.response);

        if (ocrAnalysis.length === 0) {
          throw new Error('No valid RF-DETR detections');
        }

        console.log(`[V5] RF-DETR: ${ocrAnalysis.length} detections`);

        // Create image record
        const { data: imageData } = await supabaseAdmin
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

        // Merge face + RF-DETR results
        const { merged, method } = mergeAnalysisResults(faceAnalysis, ocrAnalysis, faceConfig);

        // Save analysis results
        if (imageId && merged.length > 0) {
          await supabaseAdmin.from('analysis_results').insert({
            image_id: imageId,
            analysis_provider: method,
            recognized_number: merged[0].raceNumber,
            confidence_score: merged[0].confidence,
            driver_name: merged[0].faceMatch?.driverName || null,
            raw_response: {
              modelSource: method,
              analysis: merged,
              faceRecognition: faceRecognitionUsage,
              rfDetr: {
                modelUrl: sportCategory.rf_detr_workflow_url,
                inferenceTimeMs: rfDetrResult.inferenceTimeMs
              },
              timestamp: new Date().toISOString()
            }
          });
        }

        analysisResult = {
          success: true,
          analysis: merged,
          rfDetrUsage: {
            detectionsCount: ocrAnalysis.length,
            inferenceTimeMs: rfDetrResult.inferenceTimeMs,
            inferenceTimeSec: rfDetrResult.inferenceTimeSec,
            estimatedCostUSD: ROBOFLOW_CONFIG.estimatedCostPerImage,
            actualCostUSD
          },
          faceRecognition: faceRecognitionUsage || undefined,
          imageId,
          recognitionMethod: method
        };

      } catch (rfDetrError: any) {
        console.error('[V5] RF-DETR failed, falling back to Gemini:', rfDetrError.message);
        analysisResult = null;
      }
    }

    // Gemini fallback or primary method
    if (!analysisResult) {
      console.log('[V5] Using Gemini recognition (delegating to V3)...');

      // Delegate to V3 for Gemini processing
      const v3Url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyzeImageDesktopV3`;
      const v3Response = await fetch(v3Url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          faceRecognition: undefined // Don't pass face data to V3
        })
      });

      if (!v3Response.ok) {
        throw new Error(`V3 delegation failed: ${v3Response.statusText}`);
      }

      const v3Data = await v3Response.json();
      console.log(`[V5] V3 delegation successful: ${v3Data.analysis?.length || 0} results`);

      // Merge face + Gemini results
      ocrAnalysis = v3Data.analysis || [];
      const { merged, method } = mergeAnalysisResults(faceAnalysis, ocrAnalysis, faceConfig);

      analysisResult = {
        ...v3Data,
        analysis: merged,
        faceRecognition: faceRecognitionUsage || undefined,
        recognitionMethod: method
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
    console.error('[V5] Error:', error);

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
