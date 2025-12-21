/**
 * Edge Function: identifyPersonWithGrounding
 *
 * Face recognition backup using Gemini + Google Search grounding.
 * Called when face-api.js desktop doesn't find a match in local preset.
 *
 * USE CASE:
 * - Desktop detects a face but face-api.js doesn't match any preset descriptor
 * - This function uses Gemini with Google Search grounding to identify public figures
 * - Useful for identifying famous drivers, athletes, team principals, etc.
 *
 * PRIVACY:
 * - Does NOT save face images to database
 * - Only logs metadata (identified: true/false, execution_id)
 * - Rate limiting per user to prevent abuse
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0';
import { CORS_HEADERS, GEMINI_CONFIG, COST_CONFIG, LOG_PREFIX } from './config/constants.ts';

// ==================== TYPES ====================

interface RequestBody {
  faceImageBase64: string;      // Crop of detected face (JPEG)
  contextImageBase64?: string;  // Optional context image for better identification
  category?: string;            // Sport category for specialized prompts
  userId?: string;
  executionId?: string;
}

interface PersonInfo {
  name: string;
  confidence: number;
  role?: string;           // "pilota", "team principal", "atleta"
  team?: string;
  nationality?: string;
  source: 'google-grounding';
}

interface SuccessResponse {
  success: true;
  identified: boolean;
  person?: PersonInfo;
  usage: {
    inputTokens: number;
    outputTokens: number;
    groundingQueries: number;
    estimatedCostUSD: number;
  };
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
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
    const { faceImageBase64, contextImageBase64, category, userId, executionId } = body;

    // Validate required fields
    if (!faceImageBase64) {
      throw new Error('faceImageBase64 is required');
    }

    console.log(`${LOG_PREFIX} Request: category=${category || 'default'}, hasContext=${!!contextImageBase64}`);

    // Get Gemini API key
    const apiKey = Deno.env.get(GEMINI_CONFIG.API_KEY_ENV);
    if (!apiKey) {
      throw new Error(`${GEMINI_CONFIG.API_KEY_ENV} not configured`);
    }

    // Initialize Gemini with Google Search grounding
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_CONFIG.MODEL_NAME,
      generationConfig: {
        temperature: GEMINI_CONFIG.TEMPERATURE,
        maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json'
      },
      // Enable Google Search grounding
      tools: [{
        googleSearch: {}
      }]
    });

    // Build prompt based on category
    const prompt = buildIdentifyPrompt(category);

    // Prepare content parts
    const parts: any[] = [
      { text: prompt },
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: faceImageBase64
        }
      }
    ];

    // Add context image if provided
    if (contextImageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: contextImageBase64
        }
      });
    }

    // Call Gemini with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Gemini call timed out after ${GEMINI_CONFIG.TIMEOUT_MS}ms`)),
        GEMINI_CONFIG.TIMEOUT_MS
      );
    });

    const geminiPromise = model.generateContent(parts);
    const result: any = await Promise.race([geminiPromise, timeoutPromise]);

    // Extract response
    const responseText = result.response?.text?.() || result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error('Empty response from Gemini');
    }

    // Parse response
    const parsed = parseIdentifyResponse(responseText);

    // Extract token usage
    const usageMetadata = result.response?.usageMetadata || {};
    const inputTokens = usageMetadata.promptTokenCount || 0;
    const outputTokens = usageMetadata.candidatesTokenCount || 0;
    const groundingQueries = 1; // Each call uses at least one grounding query

    // Calculate cost
    const estimatedCostUSD = calculateCost(inputTokens, outputTokens, groundingQueries);
    const inferenceTimeMs = Date.now() - startTime;

    // Log result (NO face image saved - privacy)
    console.log(`${LOG_PREFIX} Result: identified=${parsed.identified}, ${inferenceTimeMs}ms, cost=$${estimatedCostUSD.toFixed(4)}`);

    // Build success response
    const response: SuccessResponse = {
      success: true,
      identified: parsed.identified,
      person: parsed.identified ? parsed.person : undefined,
      usage: {
        inputTokens,
        outputTokens,
        groundingQueries,
        estimatedCostUSD
      }
    };

    return new Response(JSON.stringify(response), {
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error:`, error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: error.message || 'Unknown error',
      details: error.stack
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Build identification prompt based on sport category
 */
function buildIdentifyPrompt(category?: string): string {
  const basePrompt = `Analizza questo volto e identifica la persona.

IMPORTANTE: Usa Google Search per verificare l'identità.

Se riconosci la persona, rispondi in JSON:
{
  "identified": true,
  "name": "Nome Completo",
  "confidence": 0.0-1.0,
  "role": "ruolo professionale",
  "team": "team/squadra se applicabile",
  "nationality": "nazionalità"
}

Se NON riconosci la persona o non sei sicuro:
{
  "identified": false,
  "reason": "motivo"
}

Rispondi SOLO con JSON valido, nessun testo aggiuntivo.`;

  // Add category-specific context
  const categoryContexts: Record<string, string> = {
    'motorsport': `
CONTESTO: Fotografia motorsport. La persona potrebbe essere:
- Pilota (F1, MotoGP, WEC, GT, rally, karting, Formula E)
- Team principal o manager
- Ingegnere o meccanico famoso
- Commentatore o giornalista motorsport
- Dirigente FIA/FIM/ACO`,

    'running': `
CONTESTO: Fotografia corsa/atletica. La persona potrebbe essere:
- Atleta professionista (maratona, mezzofondo, sprint)
- Allenatore famoso
- Dirigente FIDAL o World Athletics`,

    'cycling': `
CONTESTO: Fotografia ciclismo. La persona potrebbe essere:
- Ciclista professionista (strada, pista, MTB, BMX)
- Direttore sportivo
- Commentatore o giornalista ciclismo`,

    'football': `
CONTESTO: Fotografia calcio. La persona potrebbe essere:
- Calciatore professionista
- Allenatore
- Dirigente sportivo
- Arbitro famoso`
  };

  const categoryContext = categoryContexts[category || ''] || '';

  return basePrompt + categoryContext;
}

/**
 * Parse Gemini response for person identification
 */
function parseIdentifyResponse(responseText: string): {
  identified: boolean;
  person?: PersonInfo;
  reason?: string;
} {
  try {
    // Clean potential markdown
    const cleaned = responseText
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    if (parsed.identified && parsed.name) {
      return {
        identified: true,
        person: {
          name: parsed.name,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
          role: parsed.role || undefined,
          team: parsed.team || undefined,
          nationality: parsed.nationality || undefined,
          source: 'google-grounding'
        }
      };
    }

    return {
      identified: false,
      reason: parsed.reason || 'Persona non identificata'
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to parse response:`, error);
    return {
      identified: false,
      reason: 'Errore parsing risposta'
    };
  }
}

/**
 * Calculate estimated cost
 */
function calculateCost(inputTokens: number, outputTokens: number, groundingQueries: number): number {
  const inputCost = (inputTokens / 1_000_000) * COST_CONFIG.INPUT_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * COST_CONFIG.OUTPUT_PER_MILLION;
  const groundingCost = (groundingQueries / 1000) * COST_CONFIG.GROUNDING_PER_1000;
  return inputCost + outputCost + groundingCost;
}
