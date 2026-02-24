/**
 * Gemini Analyzer Module - Multi-Provider Failover
 *
 * Gestisce la chiamata a Vertex AI Gemini per l'analisi delle immagini.
 * Usa il nuovo SDK @google/genai che supporta endpoint global.
 *
 * V6 2026: Multi-provider failover chain
 * - Loads provider chain from ai_provider_configs table (or falls back to DEFAULT_PROVIDER_CHAIN)
 * - Tries providers in priority order: gemini-3-flash@global → 2.5-flash@EU → 2.5-flash-lite@EU
 * - Each location requires a new GoogleGenAI client instance (@google/genai limitation)
 * - Returns providerUsed info for telemetry tracking
 * - Retrocompatible: same function signatures, providerUsed is additive
 *
 * Issues: #55 (timeout), #57 (429 Resource Exhausted), #58 (Failed to send)
 */

import { GoogleGenAI } from 'npm:@google/genai@1.34.0';
import { CropData, NegativeData, GeminiAnalysisResult, ProviderUsedInfo } from '../types/index.ts';
import {
  VERTEX_AI, LOG_PREFIX,
  DEFAULT_PROVIDER_CHAIN, RETRYABLE_ERROR_PATTERNS,
  type ProviderEntry
} from '../config/constants.ts';

// ==================== CLIENT CACHE ====================
// @google/genai requires a new client per location, so we cache by location key
const clientCache: Map<string, GoogleGenAI> = new Map();
let cachedProjectId: string | null = null;
let cachedCredentials: any = null;

/**
 * Get or create a GoogleGenAI client for a specific location.
 * Clients are cached per location since the SDK binds location at init time.
 */
function getClientForLocation(location: string): GoogleGenAI {
  const cacheKey = location;

  const existingClient = clientCache.get(cacheKey);
  if (existingClient) return existingClient;

  // Load credentials on first call
  if (!cachedProjectId || !cachedCredentials) {
    cachedProjectId = Deno.env.get(VERTEX_AI.PROJECT_ID_ENV) || null;
    const serviceAccountKey = Deno.env.get(VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV);

    if (!cachedProjectId || !serviceAccountKey) {
      throw new Error(
        `Vertex AI not configured. Set ${VERTEX_AI.PROJECT_ID_ENV} and ${VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV}`
      );
    }

    cachedCredentials = JSON.parse(serviceAccountKey);
  }

  const client = new GoogleGenAI({
    vertexai: true,
    project: cachedProjectId,
    location: location,
    googleAuthOptions: {
      credentials: cachedCredentials
    }
  });

  clientCache.set(cacheKey, client);
  console.log(`${LOG_PREFIX} Created Vertex AI client: Project=${cachedProjectId}, Location=${location}`);

  return client;
}

/**
 * Check if Vertex AI is properly configured (credentials available)
 */
export function isVertexConfigured(): boolean {
  try {
    getClientForLocation(VERTEX_AI.DEFAULT_LOCATION);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an error is retryable (should trigger failover to next provider)
 */
function isRetryableError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return RETRYABLE_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
}

/**
 * Load provider chain from ai_provider_configs table.
 * Falls back to DEFAULT_PROVIDER_CHAIN if table not available or empty.
 *
 * @param supabase - Supabase client (optional, passed from index.ts)
 * @param sportCategoryId - Sport category UUID for category-specific chains (null = global)
 * @param purpose - 'analysis' or 'visual-tagging'
 */
export async function loadProviderChain(
  supabase: any | null,
  sportCategoryId: string | null = null,
  purpose: string = 'analysis'
): Promise<ProviderEntry[]> {
  if (!supabase) {
    console.log(`${LOG_PREFIX} No Supabase client — using default provider chain`);
    return DEFAULT_PROVIDER_CHAIN;
  }

  try {
    // Try category-specific chain first, then global (NULL category)
    const categoryIds = sportCategoryId
      ? [sportCategoryId, null]  // Category-specific, then global fallback
      : [null];                   // Global only

    for (const catId of categoryIds) {
      let query = supabase
        .from('ai_provider_configs')
        .select(`
          priority,
          location,
          sdk_type,
          ai_models!inner ( code, recommended_config )
        `)
        .eq('purpose', purpose)
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (catId === null) {
        query = query.is('sport_category_id', null);
      } else {
        query = query.eq('sport_category_id', catId);
      }

      const { data, error } = await query;

      if (error) {
        console.warn(`${LOG_PREFIX} Failed to load provider chain from DB: ${error.message}`);
        continue;
      }

      if (data && data.length > 0) {
        const chain: ProviderEntry[] = data.map((row: any) => {
          const recommendedConfig = row.ai_models?.recommended_config || {};
          return {
            modelCode: row.ai_models.code,
            location: row.location,
            sdkType: row.sdk_type,
            config: {
              // Only include thinkingLevel if model explicitly supports it (present in recommended_config)
              ...(recommendedConfig.thinkingLevel ? { thinkingLevel: recommendedConfig.thinkingLevel } : {}),
              mediaResolution: recommendedConfig.mediaResolution || VERTEX_AI.MEDIA_RESOLUTION,
              temperature: recommendedConfig.temperature ?? VERTEX_AI.TEMPERATURE,
              maxOutputTokens: recommendedConfig.maxOutputTokens || VERTEX_AI.MAX_OUTPUT_TOKENS,
            }
          };
        });

        const source = catId ? `category ${catId}` : 'global';
        console.log(`${LOG_PREFIX} Loaded provider chain from DB (${source}): ${chain.map(p => `${p.modelCode}@${p.location}`).join(' → ')}`);
        return chain;
      }
    }

    console.log(`${LOG_PREFIX} No provider chain in DB — using default`);
    return DEFAULT_PROVIDER_CHAIN;

  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Error loading provider chain: ${err.message} — using default`);
    return DEFAULT_PROVIDER_CHAIN;
  }
}

/**
 * Analyze images with Gemini via multi-provider failover chain.
 *
 * Tries each provider in the chain. If a retryable error occurs (429, 503, timeout),
 * moves to the next provider. Non-retryable errors (bad prompt, invalid response)
 * are thrown immediately.
 *
 * RETROCOMPATIBLE: Same function signature as before. providerUsed is new in the result
 * but callers that don't use it are unaffected (GeminiAnalysisResult has optional field).
 *
 * @param crops - Array of crop images (base64 JPEG)
 * @param negative - Optional negative/context image
 * @param prompt - Analysis prompt built by prompt-builder
 * @param fallbackPrompt - Optional fallback prompt if primary fails
 * @param contextImageBase64 - Optional context image from Storage
 * @param providerChain - Optional provider chain (loaded from DB or defaults)
 */
export async function analyzeWithGemini(
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string,
  fallbackPrompt?: string | null,
  contextImageBase64?: string | undefined,
  providerChain?: ProviderEntry[]
): Promise<GeminiAnalysisResult> {
  // Use contextImageBase64 (fetched from Storage) over legacy negative base64
  const effectiveNegative: NegativeData | undefined = contextImageBase64
    ? { imageData: contextImageBase64, maskedRegions: [] }
    : negative;

  // Use provided chain or default
  const chain = providerChain && providerChain.length > 0
    ? providerChain
    : DEFAULT_PROVIDER_CHAIN;

  const failedProviders: string[] = [];
  let lastError: Error | null = null;

  // Try each provider in the chain
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const providerLabel = `${provider.modelCode}@${provider.location}`;

    if (i > 0) {
      console.log(`${LOG_PREFIX} Failover → trying provider ${i + 1}/${chain.length}: ${providerLabel}`);
    }

    try {
      const client = getClientForLocation(provider.location);

      // Try primary prompt
      const result = await callGeminiWithProvider(client, provider, crops, effectiveNegative, prompt);

      // Success — attach provider info
      result.providerUsed = {
        modelCode: provider.modelCode,
        location: provider.location,
        sdkType: provider.sdkType,
        priority: i,
        wasFallback: i > 0,
        failedProviders: failedProviders.length > 0 ? [...failedProviders] : undefined,
      };

      if (i > 0) {
        console.log(`${LOG_PREFIX} ✓ Failover successful on provider ${i + 1}: ${providerLabel} (after ${failedProviders.length} failures)`);
      }

      return result;

    } catch (primaryError: any) {
      const errorMsg = primaryError.message || String(primaryError);

      // If primary prompt failed but we have a fallback prompt, try it on SAME provider
      // (fallback prompt is for content issues, not capacity — don't move to next provider)
      if (fallbackPrompt && !isRetryableError(errorMsg)) {
        console.log(`${LOG_PREFIX} Primary prompt failed on ${providerLabel} (non-retryable), trying fallback prompt...`);
        try {
          const client = getClientForLocation(provider.location);
          const result = await callGeminiWithProvider(client, provider, crops, effectiveNegative, fallbackPrompt);

          result.providerUsed = {
            modelCode: provider.modelCode,
            location: provider.location,
            sdkType: provider.sdkType,
            priority: i,
            wasFallback: i > 0,
            failedProviders: failedProviders.length > 0 ? [...failedProviders] : undefined,
          };

          return result;
        } catch (fallbackError: any) {
          console.error(`${LOG_PREFIX} Fallback prompt also failed on ${providerLabel}: ${fallbackError.message}`);
          // Fall through to check if this is retryable for next provider
          lastError = fallbackError;
          if (!isRetryableError(fallbackError.message || '')) {
            throw fallbackError;  // Non-retryable — no point trying other providers
          }
          failedProviders.push(providerLabel);
          continue;
        }
      }

      // Check if error is retryable → try next provider
      if (isRetryableError(errorMsg)) {
        console.warn(`${LOG_PREFIX} ✗ Provider ${providerLabel} failed (retryable): ${errorMsg}`);
        failedProviders.push(providerLabel);
        lastError = primaryError;
        continue;  // Try next provider
      }

      // Non-retryable error → throw immediately (no point trying other providers)
      console.error(`${LOG_PREFIX} ✗ Provider ${providerLabel} failed (non-retryable): ${errorMsg}`);
      throw primaryError;
    }
  }

  // All providers exhausted
  const allProviders = chain.map(p => `${p.modelCode}@${p.location}`).join(', ');
  const finalError = new Error(
    `All ${chain.length} providers exhausted. Last error: ${lastError?.message || 'unknown'}. Tried: ${allProviders}`
  );
  console.error(`${LOG_PREFIX} ✗ ${finalError.message}`);
  throw finalError;
}

/**
 * Call Gemini API with a specific provider configuration.
 * Uses provider-specific model, location (via client), and generation config.
 */
async function callGeminiWithProvider(
  client: GoogleGenAI,
  provider: ProviderEntry,
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string
): Promise<GeminiAnalysisResult> {
  // Build content parts: images first, then prompt
  const parts: any[] = [];

  for (const crop of crops) {
    parts.push({
      inlineData: {
        data: crop.imageData,
        mimeType: 'image/jpeg',
      },
    });
  }

  if (negative) {
    parts.push({
      inlineData: {
        data: negative.imageData,
        mimeType: 'image/jpeg',
      },
    });
  }

  parts.push({ text: prompt });

  // Merge provider-specific config with defaults
  const providerConfig = provider.config || {};
  // Use provider's explicit thinkingLevel; only fall back to default if provider config has it
  const thinkingLevel = providerConfig.thinkingLevel ?? null;
  const mediaResolution = providerConfig.mediaResolution || VERTEX_AI.MEDIA_RESOLUTION;
  const temperature = providerConfig.temperature ?? VERTEX_AI.TEMPERATURE;
  const maxOutputTokens = providerConfig.maxOutputTokens || VERTEX_AI.MAX_OUTPUT_TOKENS;

  console.log(`${LOG_PREFIX} Calling ${provider.modelCode}@${provider.location} with ${crops.length} crops${negative ? ' + 1 context' : ''}`);
  console.log(`${LOG_PREFIX} Config: thinkingLevel=${thinkingLevel || 'NONE'}, mediaResolution=${mediaResolution}, temp=${temperature}`);

  // Build generation config
  const config: any = {
    mediaResolution: mediaResolution,
    responseMimeType: 'application/json',
    temperature: temperature,
    maxOutputTokens: maxOutputTokens,
  };

  // Only add thinkingConfig if model explicitly supports it (provider config has thinkingLevel)
  // Models like gemini-2.5-flash-lite do NOT support thinking and will error if included
  if (thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: thinkingLevel };
  }

  const contents = [{
    role: 'user' as const,
    parts: parts
  }];

  // Call with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Vertex AI call timed out after ${VERTEX_AI.TIMEOUT_MS}ms (${provider.modelCode}@${provider.location})`)),
      VERTEX_AI.TIMEOUT_MS
    );
  });

  const geminiPromise = client.models.generateContent({
    model: provider.modelCode,
    config: config,
    contents: contents
  });

  const result: any = await Promise.race([geminiPromise, timeoutPromise]);

  console.log(`${LOG_PREFIX} Response received from ${provider.modelCode}@${provider.location}`);

  // Extract token usage
  const usageMetadata = result.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  // Get text response
  const text = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`No text in Gemini response from ${provider.modelCode}@${provider.location}`);
  }

  return {
    rawResponse: text,
    inputTokens,
    outputTokens,
  };
}

/**
 * Get current default model name
 */
export function getCurrentModel(): string {
  return VERTEX_AI.DEFAULT_MODEL;
}

/**
 * Get current default Vertex AI location
 */
export function getVertexLocation(): string {
  return VERTEX_AI.DEFAULT_LOCATION;
}
