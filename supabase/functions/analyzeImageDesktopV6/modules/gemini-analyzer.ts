/**
 * Gemini Analyzer Module
 *
 * Gestisce la chiamata a Vertex AI Gemini per l'analisi delle immagini.
 * Supporta retry con fallback_prompt se il primario fallisce.
 */

import { VertexAI } from 'https://esm.sh/@google-cloud/vertexai@1.1.0';
import { CropData, NegativeData, GeminiAnalysisResult } from '../types/index.ts';
import { VERTEX_AI, LOG_PREFIX } from '../config/constants.ts';

// Cached Vertex AI configuration
let vertexConfig: {
  projectId: string;
  location: string;
  credentials: any;
} | null = null;

/**
 * Initialize Vertex AI configuration from environment variables
 */
function initVertexConfig(): typeof vertexConfig {
  if (vertexConfig) return vertexConfig;

  const projectId = Deno.env.get(VERTEX_AI.PROJECT_ID_ENV);
  const location = Deno.env.get(VERTEX_AI.LOCATION_ENV) || VERTEX_AI.DEFAULT_LOCATION;
  const serviceAccountKey = Deno.env.get(VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV);

  if (!projectId || !serviceAccountKey) {
    throw new Error(
      `Vertex AI not configured. Set ${VERTEX_AI.PROJECT_ID_ENV}, ${VERTEX_AI.LOCATION_ENV}, and ${VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV}`
    );
  }

  const credentials = JSON.parse(serviceAccountKey);

  vertexConfig = { projectId, location, credentials };
  console.log(`${LOG_PREFIX} Vertex AI configured: Project=${projectId}, Location=${location}`);

  return vertexConfig;
}

/**
 * Check if Vertex AI is properly configured
 */
export function isVertexConfigured(): boolean {
  try {
    initVertexConfig();
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
  const config = initVertexConfig();
  if (!config) {
    throw new Error('Vertex AI not configured');
  }

  // Try primary prompt first
  try {
    return await callGemini(config, crops, negative, prompt);
  } catch (primaryError: any) {
    console.warn(`${LOG_PREFIX} Primary prompt failed: ${primaryError.message}`);

    // Try fallback if available
    if (fallbackPrompt) {
      console.log(`${LOG_PREFIX} Retrying with fallback prompt...`);
      try {
        return await callGemini(config, crops, negative, fallbackPrompt);
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
  config: NonNullable<typeof vertexConfig>,
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string
): Promise<GeminiAnalysisResult> {
  // Initialize Vertex AI client
  const vertexAI = new VertexAI({
    project: config.projectId,
    location: config.location,
    googleAuthOptions: {
      credentials: config.credentials
    }
  });

  // Get generative model
  const model = vertexAI.getGenerativeModel({ model: VERTEX_AI.DEFAULT_MODEL });

  // Build content parts: prompt + images
  const parts: any[] = [{ text: prompt }];

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

  console.log(`${LOG_PREFIX} Calling Vertex AI ${VERTEX_AI.DEFAULT_MODEL} with ${crops.length} crops${negative ? ' + 1 context' : ''}`);
  console.log(`${LOG_PREFIX} Config: thinkingLevel=${VERTEX_AI.THINKING_LEVEL}, mediaResolution=${VERTEX_AI.MEDIA_RESOLUTION}`);

  // Build request with Gemini specific parameters
  const request = {
    contents: [{
      role: 'user',
      parts: parts
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      // Gemini 3 Flash specific configurations
      thinkingConfig: {
        thinkingLevel: VERTEX_AI.THINKING_LEVEL
      },
      mediaResolution: VERTEX_AI.MEDIA_RESOLUTION
    }
  };

  // Call Vertex AI with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Vertex AI call timed out after ${VERTEX_AI.TIMEOUT_MS}ms`)),
      VERTEX_AI.TIMEOUT_MS
    );
  });

  const vertexPromise = model.generateContent(request);
  const result: any = await Promise.race([vertexPromise, timeoutPromise]);

  console.log(`${LOG_PREFIX} Vertex AI response received`);

  // Extract token usage from Vertex AI response
  const usageMetadata = result.response?.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  // Get text response from Vertex AI format
  const candidate = result.response?.candidates?.[0];
  if (!candidate) {
    throw new Error('No candidates in Vertex AI response');
  }

  const textPart = candidate.content?.parts?.find((p: any) => p.text);
  if (!textPart) {
    throw new Error('No text part in Vertex AI response');
  }

  return {
    rawResponse: textPart.text,
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
  const config = initVertexConfig();
  return config?.location || VERTEX_AI.DEFAULT_LOCATION;
}
