/**
 * Full Image Handler Module
 *
 * Handles full image analysis when no crops are detected.
 * Part of V6 Baseline 2026 - eliminates need for V5 fallback.
 *
 * When desktop detects 0 subjects, instead of falling back to V5,
 * V6 can now analyze the full image directly.
 */

import { analyzeWithGemini } from './gemini-analyzer.ts';
import { CropData, GeminiAnalysisResult } from '../types/index.ts';
import { LOG_PREFIX } from '../config/constants.ts';

/**
 * Analyze a full image when no crops are detected
 *
 * Converts the full image into a single "crop" format for compatibility
 * with the existing Gemini analyzer pipeline.
 *
 * @param fullImageBase64 - Base64 encoded full image
 * @param prompt - Analysis prompt
 * @param fallbackPrompt - Optional fallback prompt
 * @returns Analysis result from Gemini
 */
export async function analyzeFullImage(
  fullImageBase64: string,
  prompt: string,
  fallbackPrompt?: string | null
): Promise<GeminiAnalysisResult> {
  console.log(`${LOG_PREFIX} Analyzing full image (no crops detected)`);

  // Create a synthetic crop from the full image
  const syntheticCrop: CropData = {
    imageData: fullImageBase64,
    detectionId: 'full_image_0',
    isPartial: false,
    // No originalBbox since it's the full image
  };

  // Call Gemini with the synthetic crop
  const result = await analyzeWithGemini(
    [syntheticCrop],
    undefined,  // No negative for full image analysis
    prompt,
    fallbackPrompt
  );

  console.log(`${LOG_PREFIX} Full image analysis completed`);

  return result;
}

/**
 * Build a modified prompt for full image analysis
 *
 * Optionally modifies the standard prompt to account for
 * the fact that we're analyzing a full image, not a crop.
 *
 * @param basePrompt - Original prompt from sport category
 * @returns Modified prompt for full image context
 */
export function buildFullImagePrompt(basePrompt: string): string {
  const fullImagePreamble = `NOTA: Questa è un'immagine intera, non un ritaglio.
Cerca di identificare tutti i soggetti principali nell'immagine.
Se trovi veicoli/atleti con numeri di gara, riportali tutti.

`;

  return fullImagePreamble + basePrompt;
}
