/**
 * Tag Extractor Module
 *
 * Calls Gemini to extract visual tags from image URL.
 * Uses the new @google/genai SDK (same as V6).
 * Primary: Vertex AI, Fallback: Google AI Studio
 */

import { GoogleGenAI } from 'npm:@google/genai@1.34.0';
import { GEMINI_CONFIG, VISUAL_TAGGING_PROMPT, LOG_PREFIX } from '../config/constants.ts';
import { GeminiTagResult, VisualTags } from '../types/index.ts';

// Environment variables (same as V6)
const VERTEX_PROJECT_ID = Deno.env.get(GEMINI_CONFIG.PROJECT_ID_ENV);
const VERTEX_LOCATION = Deno.env.get(GEMINI_CONFIG.LOCATION_ENV) || GEMINI_CONFIG.DEFAULT_LOCATION;
const VERTEX_SERVICE_ACCOUNT_KEY = Deno.env.get(GEMINI_CONFIG.SERVICE_ACCOUNT_KEY_ENV);
const USE_VERTEX = !!(VERTEX_PROJECT_ID && VERTEX_SERVICE_ACCOUNT_KEY);
const GEMINI_API_KEY = Deno.env.get(GEMINI_CONFIG.API_KEY_ENV);

console.log(`${LOG_PREFIX} Vertex AI ${USE_VERTEX ? 'ENABLED' : 'DISABLED'} (Project: ${VERTEX_PROJECT_ID || 'none'}, Location: ${VERTEX_LOCATION})`);
console.log(`${LOG_PREFIX} AI Studio ${GEMINI_API_KEY ? 'AVAILABLE' : 'DISABLED'} (fallback)`);

// Cached AI clients
let vertexClient: GoogleGenAI | null = null;
let aiStudioClient: GoogleGenAI | null = null;

/**
 * Initialize Vertex AI client
 */
function initVertexClient(): GoogleGenAI {
  if (vertexClient) return vertexClient;

  if (!VERTEX_PROJECT_ID || !VERTEX_SERVICE_ACCOUNT_KEY) {
    throw new Error('Vertex AI not configured');
  }

  const credentials = JSON.parse(VERTEX_SERVICE_ACCOUNT_KEY);

  vertexClient = new GoogleGenAI({
    vertexai: true,
    project: VERTEX_PROJECT_ID,
    location: VERTEX_LOCATION,
    googleAuthOptions: { credentials }
  });

  console.log(`${LOG_PREFIX} Vertex AI client initialized`);
  return vertexClient;
}

/**
 * Call AI Studio directly via REST API (more reliable than SDK for non-Vertex)
 */
async function callAIStudioREST(imageBase64: string): Promise<GeminiTagResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log(`${LOG_PREFIX} [AI STUDIO REST] Calling ${GEMINI_CONFIG.MODEL}...`);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const requestBody = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageBase64
          }
        },
        { text: VISUAL_TAGGING_PROMPT }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: VISUAL_TAGS_SCHEMA,
      temperature: GEMINI_CONFIG.TEMPERATURE,
      maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_CONFIG.TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${LOG_PREFIX} [AI STUDIO REST] Error:`, errorText);
      throw new Error(`AI Studio request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return parseRESTResponse(result);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if any AI provider is configured
 */
export function isVertexConfigured(): boolean {
  return USE_VERTEX || !!GEMINI_API_KEY;
}

/**
 * Extract visual tags from image using Gemini
 * Primary: Vertex AI, Fallback: Google AI Studio
 */
export async function extractTags(imageUrl: string): Promise<GeminiTagResult> {
  console.log(`${LOG_PREFIX} Extracting tags from: ${imageUrl.substring(0, 80)}...`);

  // Fetch image as base64 first (used by both providers)
  const imageBase64 = await fetchImageAsBase64(imageUrl);

  let vertexError: any = null;

  // Try Vertex AI first (primary provider)
  if (USE_VERTEX) {
    try {
      const client = initVertexClient();
      const result = await callGemini(client, imageBase64);
      console.log(`${LOG_PREFIX} ✅ Used Vertex AI (${VERTEX_LOCATION})`);
      return result;
    } catch (error: any) {
      vertexError = error;
      console.warn(`${LOG_PREFIX} ⚠️ Vertex AI failed: ${error.message}, trying AI Studio fallback...`);
    }
  }

  // Fallback to Google AI Studio via REST API
  if (GEMINI_API_KEY) {
    try {
      const result = await callAIStudioREST(imageBase64);
      console.log(`${LOG_PREFIX} ✅ Used AI Studio REST ${vertexError ? '(fallback)' : '(primary)'}`);
      return result;
    } catch (aiStudioError: any) {
      console.error(`${LOG_PREFIX} ❌ AI Studio error: ${aiStudioError.message}`);
      if (vertexError) {
        throw new Error(`All AI providers failed. Vertex: ${vertexError.message}, AI Studio: ${aiStudioError.message}`);
      }
      throw aiStudioError;
    }
  }

  throw new Error('No AI provider configured');
}

/**
 * Parse REST API response into GeminiTagResult
 */
function parseRESTResponse(result: any): GeminiTagResult {
  // Extract token usage
  const usageMetadata = result.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  // Get text response
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text in Gemini response');
  }

  // Parse JSON response - structured output guarantees valid JSON
  let parsedTags: VisualTags;
  try {
    parsedTags = JSON.parse(text);
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse response:`, text);
    throw new Error('Failed to parse Gemini response');
  }

  // Ensure all arrays exist
  const tags: VisualTags = {
    location: Array.isArray(parsedTags.location) ? parsedTags.location : [],
    weather: Array.isArray(parsedTags.weather) ? parsedTags.weather : [],
    sceneType: Array.isArray(parsedTags.sceneType) ? parsedTags.sceneType : [],
    subjects: Array.isArray(parsedTags.subjects) ? parsedTags.subjects : [],
    visualStyle: Array.isArray(parsedTags.visualStyle) ? parsedTags.visualStyle : [],
    emotion: Array.isArray(parsedTags.emotion) ? parsedTags.emotion : []
  };

  console.log(`${LOG_PREFIX} Extracted ${Object.values(tags).flat().length} tags, tokens: ${inputTokens}/${outputTokens}`);

  return {
    rawResponse: tags,
    inputTokens,
    outputTokens
  };
}

// JSON Schema for structured output
const VISUAL_TAGS_SCHEMA = {
  type: 'object',
  properties: {
    location: {
      type: 'array',
      items: { type: 'string' },
      description: 'Location/landmarks: track name, city, corners, pit lane (max 5)'
    },
    weather: {
      type: 'array',
      items: { type: 'string' },
      description: 'Weather/lighting: sunny, rainy, cloudy, golden hour, night (max 3)'
    },
    sceneType: {
      type: 'array',
      items: { type: 'string' },
      description: 'Scene type: action, podium, pit stop, portrait, crash, start, overtake (max 3)'
    },
    subjects: {
      type: 'array',
      items: { type: 'string' },
      description: 'Subjects visible: car, motorcycle, runner, crowd, team crew, marshals (max 5)'
    },
    visualStyle: {
      type: 'array',
      items: { type: 'string' },
      description: 'Photography style: motion blur, panning, close-up, wide angle, aerial (max 3)'
    },
    emotion: {
      type: 'array',
      items: { type: 'string' },
      description: 'Emotion/mood: excitement, tension, celebration, focus, disappointment (max 3)'
    }
  },
  required: ['location', 'weather', 'sceneType', 'subjects', 'visualStyle', 'emotion']
};

/**
 * Call Gemini API with the given client
 * Uses structured output (responseSchema) for reliable JSON parsing
 * Config matches V6 for Gemini 3 Flash specific parameters
 */
async function callGemini(client: GoogleGenAI, imageBase64: string): Promise<GeminiTagResult> {
  console.log(`${LOG_PREFIX} Calling ${GEMINI_CONFIG.MODEL} with structured output...`);
  console.log(`${LOG_PREFIX} Config: thinkingLevel=${GEMINI_CONFIG.THINKING_LEVEL}, mediaResolution=${GEMINI_CONFIG.MEDIA_RESOLUTION}`);

  // Build content parts
  const parts = [
    {
      inlineData: {
        data: imageBase64,
        mimeType: 'image/jpeg'
      }
    },
    { text: VISUAL_TAGGING_PROMPT }
  ];

  // Build generation config with Gemini 3 Flash specific parameters (same as V6)
  const config = {
    thinkingConfig: {
      thinkingLevel: GEMINI_CONFIG.THINKING_LEVEL
    },
    mediaResolution: GEMINI_CONFIG.MEDIA_RESOLUTION,
    responseMimeType: 'application/json',
    responseSchema: VISUAL_TAGS_SCHEMA,
    temperature: GEMINI_CONFIG.TEMPERATURE,
    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS
  };

  // Build contents
  const contents = [{
    role: 'user' as const,
    parts: parts
  }];

  // Call with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Gemini call timed out after ${GEMINI_CONFIG.TIMEOUT_MS}ms`)),
      GEMINI_CONFIG.TIMEOUT_MS
    );
  });

  const geminiPromise = client.models.generateContent({
    model: GEMINI_CONFIG.MODEL,
    config: config,
    contents: contents
  });

  const result: any = await Promise.race([geminiPromise, timeoutPromise]);

  // Extract token usage
  const usageMetadata = result.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  // Get text response - with structured output, this should be clean JSON
  const text = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text in Gemini response');
  }

  // Parse JSON response - structured output guarantees valid JSON
  let parsedTags: VisualTags;
  try {
    parsedTags = JSON.parse(text);
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse structured response:`, text);
    throw new Error('Failed to parse Gemini structured response');
  }

  // Ensure all arrays exist (defensive)
  const tags: VisualTags = {
    location: Array.isArray(parsedTags.location) ? parsedTags.location : [],
    weather: Array.isArray(parsedTags.weather) ? parsedTags.weather : [],
    sceneType: Array.isArray(parsedTags.sceneType) ? parsedTags.sceneType : [],
    subjects: Array.isArray(parsedTags.subjects) ? parsedTags.subjects : [],
    visualStyle: Array.isArray(parsedTags.visualStyle) ? parsedTags.visualStyle : [],
    emotion: Array.isArray(parsedTags.emotion) ? parsedTags.emotion : []
  };

  console.log(`${LOG_PREFIX} Extracted ${Object.values(tags).flat().length} tags, tokens: ${inputTokens}/${outputTokens}`);

  return {
    rawResponse: tags,
    inputTokens,
    outputTokens
  };
}

/**
 * Fetch image from URL and convert to base64
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binary);
}
