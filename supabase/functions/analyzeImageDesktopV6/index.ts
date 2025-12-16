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
 * Cost-optimized: Single API call for multiple crops + context
 *
 * BACKWARD COMPATIBILITY:
 * - This is a NEW edge function, does not modify V3/V4/V5
 * - Only called when sport_category.crop_config.enabled = true
 * - Desktop client falls back to V4/V5 if crop_config is null or disabled
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

// ==================== TYPE DEFINITIONS ====================

interface BoundingBox {
  x: number;      // Normalized 0-1
  y: number;      // Normalized 0-1
  width: number;  // Normalized 0-1
  height: number; // Normalized 0-1
}

interface CropData {
  imageData: string;        // Base64 encoded JPEG
  detectionId: string;      // Unique ID for tracking
  isPartial: boolean;       // True if subject touches frame edge
  originalBbox?: BoundingBox;
}

interface NegativeData {
  imageData: string;        // Base64 encoded JPEG
  maskedRegions: BoundingBox[];
}

interface ParticipantInfo {
  numero?: string;
  nome?: string;
  navigatore?: string;
  squadra?: string;
  sponsor?: string;
  metatag?: string;
}

interface RequestBody {
  crops: CropData[];
  negative?: NegativeData;
  category?: string;
  userId?: string;
  executionId?: string;
  imageId?: string;           // Image ID for linking to images/analysis_results tables
  originalFileName?: string;  // Original filename for reference
  storagePath?: string;       // Storage path if image was uploaded
  participantPreset?: {
    name: string;
    participants: ParticipantInfo[];
  };
  modelName?: string;       // Gemini model to use
}

interface CropAnalysisResult {
  imageIndex: number;       // 1-based index matching prompt
  detectionId: string;
  raceNumber: string | null;
  confidence: number;
  drivers: string[];
  teamName: string | null;
  otherText: string[];
  isPartial: boolean;
  originalBbox?: BoundingBox;  // Bounding box usato per il crop (per logging)
}

interface ContextAnalysisResult {
  sponsors: string[];
  otherRaceNumbers: string[];
  category: string | null;
  teamColors: string[];
  confidence: number;
}

interface SuccessResponse {
  success: true;
  cropAnalysis: CropAnalysisResult[];
  contextAnalysis: ContextAnalysisResult | null;
  correlation: {
    validated: boolean;
    notes: string[];
  };
  usage: {
    cropsCount: number;
    hasNegative: boolean;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  };
  inferenceTimeMs: number;
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}

// ==================== CONSTANTS ====================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

// ==================== PROMPT GENERATION ====================

function generateMultiImagePrompt(
  cropCount: number,
  hasNegative: boolean,
  participants?: ParticipantInfo[],
  partialFlags?: boolean[]
): string {
  const participantContext = participants && participants.length > 0
    ? `\n\nPartecipanti noti in questa gara:\n${participants.map(p =>
        `- Numero ${p.numero || '?'}: ${p.nome || 'N/A'}${p.squadra ? ` (${p.squadra})` : ''}${p.sponsor ? ` - Sponsor: ${p.sponsor}` : ''}`
      ).join('\n')}`
    : '';

  const partialNotes = partialFlags?.some(p => p)
    ? '\n\nNOTA: Alcuni ritagli mostrano soggetti parzialmente visibili (tagliati dal bordo della foto). Per questi, indica ciò che riesci a vedere.'
    : '';

  const contextImageNote = hasNegative
    ? `\n\nIMAGINE ${cropCount + 1}: Contesto (soggetti mascherati in nero)
Analizza questa immagine per identificare:
- sponsorVisibili: Array di sponsor/loghi visibili nella scena
- altriNumeri: Altri numeri di gara visibili (per cross-reference)
- categoria: Categoria di gara se identificabile (F1, GT3, MotoGP, ecc.)
- coloriTeam: Colori predominanti che potrebbero identificare il team`
    : '';

  return `Sei un esperto di fotografia sportiva e motorsport. Stai analizzando ${cropCount} immagine/i ritagliate di veicoli/atleti da gara${hasNegative ? ' più 1 immagine di contesto' : ''}.

IMMAGINI 1-${cropCount}: Ritagli dei soggetti principali
Per ogni ritaglio, identifica:
- raceNumber: Il numero di gara visibile (stringa, null se non visibile)
- confidence: La tua confidenza nell'identificazione (0.0-1.0)
- drivers: Array di nomi piloti/atleti se visibili (array vuoto se nessuno)
- teamName: Nome del team se identificabile (stringa o null)
- otherText: Altri testi significativi visibili (sponsor su casco, tuta, ecc.)
${contextImageNote}
${participantContext}
${partialNotes}

CORRELAZIONE: Se gli sponsor o i colori nel contesto corrispondono a team noti nella lista partecipanti, usa questa informazione per validare o correggere i numeri identificati nei ritagli.

Rispondi SOLO con un oggetto JSON valido in questo formato esatto:
{
  "crops": [
    {"imageIndex": 1, "raceNumber": "16", "confidence": 0.95, "drivers": ["Charles Leclerc"], "teamName": "Ferrari", "otherText": ["Shell", "Santander"]}
  ]${hasNegative ? `,
  "context": {
    "sponsorVisibili": ["Shell", "Pirelli"],
    "altriNumeri": [],
    "categoria": "Formula 1",
    "coloriTeam": ["rosso", "giallo"]
  }` : ''}
}`;
}

// ==================== GEMINI API CALL ====================

async function analyzeWithGemini(
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string,
  modelName: string
): Promise<{ result: any; inputTokens: number; outputTokens: number }> {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  // Build multi-image content array
  const contentParts: any[] = [{ text: prompt }];

  // Add all crop images
  for (const crop of crops) {
    contentParts.push({
      inlineData: {
        data: crop.imageData,
        mimeType: 'image/jpeg',
      },
    });
  }

  // Add negative/context image if present
  if (negative) {
    contentParts.push({
      inlineData: {
        data: negative.imageData,
        mimeType: 'image/jpeg',
      },
    });
  }

  console.log(`[V6] Calling Gemini with ${crops.length} crops${negative ? ' + 1 context' : ''}`);

  // Make the API call
  const result = await model.generateContent(contentParts, {
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  const response = await result.response;

  // Extract token usage
  const usageMetadata = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  return {
    result: response.text(),
    inputTokens,
    outputTokens,
  };
}

// ==================== RESPONSE PARSING ====================

function parseGeminiResponse(
  responseText: string,
  crops: CropData[],
  hasNegative: boolean
): { cropAnalysis: CropAnalysisResult[]; contextAnalysis: ContextAnalysisResult | null } {
  try {
    // Clean potential markdown formatting
    const cleaned = responseText
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // Map crop results
    const cropAnalysis: CropAnalysisResult[] = (parsed.crops || []).map((crop: any, idx: number) => ({
      imageIndex: crop.imageIndex || idx + 1,
      detectionId: crops[idx]?.detectionId || `det_${idx}`,
      raceNumber: crop.raceNumber || null,
      confidence: typeof crop.confidence === 'number' ? crop.confidence : 0.5,
      drivers: Array.isArray(crop.drivers) ? crop.drivers : [],
      teamName: crop.teamName || null,
      otherText: Array.isArray(crop.otherText) ? crop.otherText : [],
      isPartial: crops[idx]?.isPartial || false,
      originalBbox: crops[idx]?.originalBbox || undefined,  // Include bbox for logging
    }));

    // Map context result if present
    let contextAnalysis: ContextAnalysisResult | null = null;
    if (hasNegative && parsed.context) {
      contextAnalysis = {
        sponsors: Array.isArray(parsed.context.sponsorVisibili) ? parsed.context.sponsorVisibili : [],
        otherRaceNumbers: Array.isArray(parsed.context.altriNumeri) ? parsed.context.altriNumeri : [],
        category: parsed.context.categoria || null,
        teamColors: Array.isArray(parsed.context.coloriTeam) ? parsed.context.coloriTeam : [],
        confidence: 0.8, // Default confidence for context
      };
    }

    return { cropAnalysis, contextAnalysis };
  } catch (error) {
    console.error('[V6] Failed to parse Gemini response:', error);
    console.error('[V6] Raw response:', responseText.substring(0, 500));

    // Return empty results on parse failure
    return {
      cropAnalysis: crops.map((crop, idx) => ({
        imageIndex: idx + 1,
        detectionId: crop.detectionId,
        raceNumber: null,
        confidence: 0,
        drivers: [],
        teamName: null,
        otherText: [],
        isPartial: crop.isPartial,
        originalBbox: crop.originalBbox || undefined,  // Preserve bbox even on parse failure
      })),
      contextAnalysis: null,
    };
  }
}

// ==================== CORRELATION LOGIC ====================

function correlateResults(
  cropAnalysis: CropAnalysisResult[],
  contextAnalysis: ContextAnalysisResult | null,
  participants?: ParticipantInfo[]
): { validated: boolean; notes: string[] } {
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

// ==================== MAIN HANDLER ====================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body: RequestBody = await req.json();
    const { crops, negative, category, userId, executionId, imageId, originalFileName, storagePath, participantPreset, modelName } = body;

    // Validate required fields
    if (!crops || crops.length === 0) {
      throw new Error('No crops provided. Use V4/V5 for single-image analysis.');
    }

    console.log(`[V6] Request received: ${crops.length} crops, negative: ${!!negative}, category: ${category}`);
    console.log(`[V6] User: ${userId}, Execution: ${executionId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate prompt
    const partialFlags = crops.map(c => c.isPartial);
    const prompt = generateMultiImagePrompt(
      crops.length,
      !!negative,
      participantPreset?.participants,
      partialFlags
    );

    // Call Gemini API
    const modelToUse = modelName || DEFAULT_MODEL;
    const { result: responseText, inputTokens, outputTokens } = await analyzeWithGemini(
      crops,
      negative,
      prompt,
      modelToUse
    );

    const inferenceTimeMs = Date.now() - startTime;
    console.log(`[V6] Gemini returned in ${inferenceTimeMs}ms`);

    // Parse response
    const { cropAnalysis, contextAnalysis } = parseGeminiResponse(responseText, crops, !!negative);

    // Correlate results
    const correlation = correlateResults(cropAnalysis, contextAnalysis, participantPreset?.participants);

    // Calculate cost (approximate)
    const INPUT_COST_PER_MILLION = 0.10;  // $0.10 per million input tokens
    const OUTPUT_COST_PER_MILLION = 0.40; // $0.40 per million output tokens
    const estimatedCostUSD = (inputTokens / 1_000_000 * INPUT_COST_PER_MILLION) +
                             (outputTokens / 1_000_000 * OUTPUT_COST_PER_MILLION);

    // Log to database if execution tracking needed
    if (executionId && userId) {
      try {
        await supabase.from('execution_logs').insert({
          execution_id: executionId,
          log_type: 'v6_crop_context',
          log_data: {
            cropsCount: crops.length,
            hasNegative: !!negative,
            inputTokens,
            outputTokens,
            estimatedCostUSD,
            inferenceTimeMs,
            recognizedNumbers: cropAnalysis.map(c => c.raceNumber).filter(Boolean),
          },
        });
      } catch (logError) {
        console.warn('[V6] Failed to log execution:', logError);
      }
    }

    // Save to images and analysis_results tables (like V3/V4/V5 for consistency)
    // This ensures V6 data is queryable from database, not just JSONL
    if (userId && imageId) {
      try {
        // 1. Upsert image record
        const { error: imageError } = await supabase
          .from('images')
          .upsert({
            id: imageId,
            user_id: userId,
            original_filename: originalFileName || 'unknown',
            storage_path: storagePath || null,
            execution_id: executionId || null,
            status: 'analyzed'
          }, { onConflict: 'id' });

        if (imageError) {
          console.warn('[V6] Failed to upsert image:', imageError);
        }

        // 2. Insert analysis_results with V6-specific columns
        const primaryCrop = cropAnalysis[0];
        const { error: analysisError } = await supabase
          .from('analysis_results')
          .insert({
            image_id: imageId,
            analysis_provider: 'gemini-v6-seg',
            recognized_number: primaryCrop?.raceNumber || null,
            confidence_score: primaryCrop?.confidence || 0,
            confidence_level: primaryCrop?.confidence >= 0.8 ? 'HIGH' : primaryCrop?.confidence >= 0.5 ? 'MEDIUM' : 'LOW',
            raw_response: {
              crops: cropAnalysis,
              context: contextAnalysis,
              correlation: correlation,
              modelSource: 'gemini-v6-seg'
            },
            // V6-specific columns
            crop_analysis: cropAnalysis,
            context_analysis: contextAnalysis,
            edge_function_version: 6,
            // Token usage
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            estimated_cost_usd: estimatedCostUSD,
            execution_time_ms: inferenceTimeMs
          });

        if (analysisError) {
          console.warn('[V6] Failed to insert analysis_results:', analysisError);
        } else {
          console.log(`[V6] Saved to analysis_results for image ${imageId}`);
        }
      } catch (dbError) {
        console.warn('[V6] DB save failed (non-blocking):', dbError);
        // Don't fail the request - JSONL backup will still work
      }
    }

    // Build success response
    const response: SuccessResponse = {
      success: true,
      cropAnalysis,
      contextAnalysis,
      correlation,
      usage: {
        cropsCount: crops.length,
        hasNegative: !!negative,
        inputTokens,
        outputTokens,
        estimatedCostUSD,
      },
      inferenceTimeMs,
    };

    console.log(`[V6] Success: ${cropAnalysis.length} crops analyzed, ${correlation.notes.length} correlation notes`);

    return new Response(JSON.stringify(response), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[V6] Error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: error.message || 'Unknown error',
      details: error.stack,
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
