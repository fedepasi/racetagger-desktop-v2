/**
 * Gemini Analyzer Module
 *
 * Gestisce la chiamata a Vertex AI Gemini per l'analisi delle immagini.
 * Usa il nuovo SDK @google/genai che supporta endpoint global.
 * Supporta retry con fallback_prompt se il primario fallisce.
 */

import { GoogleGenAI } from 'npm:@google/genai@1.34.0';
import { CropData, NegativeData, GeminiAnalysisResult } from '../types/index.ts';
import { VERTEX_AI, LOG_PREFIX } from '../config/constants.ts';

// Cached AI client
let aiClient: GoogleGenAI | null = null;
let projectId: string | null = null;

/**
 * Initialize Google GenAI client for Vertex AI
 */
function initAIClient(): GoogleGenAI {
  if (aiClient) return aiClient;

  projectId = Deno.env.get(VERTEX_AI.PROJECT_ID_ENV);
  const serviceAccountKey = Deno.env.get(VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV);

  if (!projectId || !serviceAccountKey) {
    throw new Error(
      `Vertex AI not configured. Set ${VERTEX_AI.PROJECT_ID_ENV} and ${VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV}`
    );
  }

  const credentials = JSON.parse(serviceAccountKey);

  // Initialize with new SDK - supports global endpoint
  aiClient = new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location: VERTEX_AI.DEFAULT_LOCATION,  // 'global'
    googleAuthOptions: {
      credentials: credentials
    }
  });

  console.log(`${LOG_PREFIX} Vertex AI configured: Project=${projectId}, Location=${VERTEX_AI.DEFAULT_LOCATION}, Model=${VERTEX_AI.DEFAULT_MODEL}`);

  return aiClient;
}

/**
 * Check if Vertex AI is properly configured
 */
export function isVertexConfigured(): boolean {
  try {
    initAIClient();
    return true;
  } catch {
    return false;
  }
}

/**
 * Analyze images with Gemini via Vertex AI
 *
 * @param crops - Array of crop images (base64 JPEG)
 * @param negative - Optional negative/context image
 * @param prompt - Analysis prompt built by prompt-builder
 * @param fallbackPrompt - Optional fallback prompt if primary fails
 * @returns Analysis result with raw response and token usage
 */
export async function analyzeWithGemini(
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string,
  fallbackPrompt?: string | null
): Promise<GeminiAnalysisResult> {
  const client = initAIClient();

  // Try primary prompt first
  try {
    return await callGemini(client, crops, negative, prompt);
  } catch (primaryError: any) {
    console.warn(`${LOG_PREFIX} Primary prompt failed: ${primaryError.message}`);

    // Try fallback if available
    if (fallbackPrompt) {
      console.log(`${LOG_PREFIX} Retrying with fallback prompt...`);
      try {
        return await callGemini(client, crops, negative, fallbackPrompt);
      } catch (fallbackError: any) {
        console.error(`${LOG_PREFIX} Fallback prompt also failed: ${fallbackError.message}`);
        throw fallbackError;
      }
    }

    throw primaryError;
  }
}

/**
 * Internal function to call Gemini API
 */
async function callGemini(
  client: GoogleGenAI,
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string
): Promise<GeminiAnalysisResult> {
  // Build content parts: images first, then prompt
  const parts: any[] = [];

  // Add all crop images
  for (const crop of crops) {
    parts.push({
      inlineData: {
        data: crop.imageData,
        mimeType: 'image/jpeg',
      },
    });
  }

  // Add negative/context image if present
  if (negative) {
    parts.push({
      inlineData: {
        data: negative.imageData,
        mimeType: 'image/jpeg',
      },
    });
  }

  // Add text prompt last
  parts.push({ text: prompt });

  console.log(`${LOG_PREFIX} Calling ${VERTEX_AI.DEFAULT_MODEL} with ${crops.length} crops${negative ? ' + 1 context' : ''}`);
  console.log(`${LOG_PREFIX} Config: thinkingLevel=${VERTEX_AI.THINKING_LEVEL}, mediaResolution=${VERTEX_AI.MEDIA_RESOLUTION}`);

  // Build generation config with Gemini 3 Flash specific parameters
  const config = {
    thinkingConfig: {
      thinkingLevel: VERTEX_AI.THINKING_LEVEL
    },
    mediaResolution: VERTEX_AI.MEDIA_RESOLUTION,
    responseMimeType: 'application/json',
    temperature: VERTEX_AI.TEMPERATURE,
    maxOutputTokens: VERTEX_AI.MAX_OUTPUT_TOKENS,
  };

  // Build contents array
  const contents = [{
    role: 'user' as const,
    parts: parts
  }];

  // Call with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Vertex AI call timed out after ${VERTEX_AI.TIMEOUT_MS}ms`)),
      VERTEX_AI.TIMEOUT_MS
    );
  });

  const geminiPromise = client.models.generateContent({
    model: VERTEX_AI.DEFAULT_MODEL,
    config: config,
    contents: contents
  });

  const result: any = await Promise.race([geminiPromise, timeoutPromise]);

  console.log(`${LOG_PREFIX} Vertex AI response received`);

  // Extract token usage
  const usageMetadata = result.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  // Get text response
  const text = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text in Gemini response');
  }

  return {
    rawResponse: text,
    inputTokens,
    outputTokens,
  };
}

/**
 * Get current model name being used
 */
export function getCurrentModel(): string {
  return VERTEX_AI.DEFAULT_MODEL;
}

/**
 * Get current Vertex AI location
 */
export function getVertexLocation(): string {
  return VERTEX_AI.DEFAULT_LOCATION;
}
