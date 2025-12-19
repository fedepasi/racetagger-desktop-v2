/**
 * Sport Category Loader Module
 *
 * Carica la configurazione sport_categories dal database Supabase.
 * Fornisce fallback a configurazione default se categoria non trovata.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SportCategoryConfig, DEFAULT_SPORT_CONFIG, RecognitionConfig, CropConfig } from '../types/index.ts';
import { LOG_PREFIX } from '../config/constants.ts';

/**
 * Load sport category configuration from database
 *
 * @param supabase - Supabase client instance
 * @param categoryCode - Sport category code (e.g., 'motorsport', 'running')
 * @returns SportCategoryConfig with all relevant fields
 * @throws Error if category exists but crop_config is not enabled
 */
export async function loadSportCategory(
  supabase: SupabaseClient,
  categoryCode: string
): Promise<SportCategoryConfig> {
  console.log(`${LOG_PREFIX} Loading sport category: ${categoryCode}`);

  const { data, error } = await supabase
    .from('sport_categories')
    .select(`
      id,
      code,
      name,
      ai_prompt,
      fallback_prompt,
      recognition_config,
      crop_config,
      edge_function_version
    `)
    .eq('code', categoryCode)
    .eq('is_active', true)
    .single();

  // Handle not found - use default
  if (error || !data) {
    console.warn(`${LOG_PREFIX} Sport category '${categoryCode}' not found or inactive, using default`);
    console.warn(`${LOG_PREFIX} Error: ${error?.message || 'No data returned'}`);
    return DEFAULT_SPORT_CONFIG;
  }

  // Validate: V6 requires crop_config.enabled = true
  const cropConfig = data.crop_config as CropConfig | null;
  if (!cropConfig?.enabled) {
    throw new Error(
      `Sport category '${categoryCode}' does not have crop_config enabled. ` +
      `V6 requires crop mode. Use V4/V5 for single-image analysis.`
    );
  }

  // Map database fields to TypeScript interface
  const config: SportCategoryConfig = {
    id: data.id,
    code: data.code,
    name: data.name,
    aiPrompt: data.ai_prompt || DEFAULT_SPORT_CONFIG.aiPrompt,
    fallbackPrompt: data.fallback_prompt || null,
    recognitionConfig: mapRecognitionConfig(data.recognition_config),
    cropConfig: cropConfig
  };

  console.log(`${LOG_PREFIX} Loaded category '${config.name}' (version: ${data.edge_function_version || 6})`);
  console.log(`${LOG_PREFIX} Recognition config: minConfidence=${config.recognitionConfig.minConfidence}, maxResults=${config.recognitionConfig.maxResults}`);

  return config;
}

/**
 * Map database recognition_config to TypeScript interface with defaults
 */
function mapRecognitionConfig(dbConfig: any): RecognitionConfig {
  if (!dbConfig) {
    return DEFAULT_SPORT_CONFIG.recognitionConfig;
  }

  return {
    maxResults: dbConfig.maxResults ?? DEFAULT_SPORT_CONFIG.recognitionConfig.maxResults,
    minConfidence: dbConfig.minConfidence ?? DEFAULT_SPORT_CONFIG.recognitionConfig.minConfidence,
    focusMode: dbConfig.focusMode ?? DEFAULT_SPORT_CONFIG.recognitionConfig.focusMode,
    ignoreBackground: dbConfig.ignoreBackground ?? false,
    prioritizeForeground: dbConfig.prioritizeForeground ?? false,
    detectPlateNumber: dbConfig.detectPlateNumber ?? false,
    boundingBoxFormat: dbConfig.boundingBoxFormat ?? 'gemini_native'
  };
}

/**
 * Validate that the loaded config is suitable for V6
 */
export function validateV6Config(config: SportCategoryConfig): void {
  if (!config.aiPrompt || config.aiPrompt.trim().length === 0) {
    throw new Error('Sport category ai_prompt is empty or missing');
  }

  if (!config.cropConfig?.enabled) {
    throw new Error('V6 requires crop_config.enabled = true');
  }

  // Validate crop dimensions
  const crop = config.cropConfig.crop;
  if (crop.maxDimension < crop.minDimension) {
    console.warn(`${LOG_PREFIX} Warning: crop.maxDimension < crop.minDimension, may cause issues`);
  }
}
