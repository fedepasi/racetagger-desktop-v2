/**
 * Database Writer Module
 *
 * Saves visual tags to Supabase visual_tags table
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DatabaseWriteParams } from '../types/index.ts';
import { COST_CONFIG, LOG_PREFIX } from '../config/constants.ts';

/**
 * Calculate cost from token usage
 */
export function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * COST_CONFIG.INPUT_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * COST_CONFIG.OUTPUT_PER_MILLION;
  return inputCost + outputCost;
}

/**
 * Save visual tags to database
 */
export async function saveVisualTags(
  supabase: SupabaseClient,
  params: DatabaseWriteParams
): Promise<void> {
  const {
    imageId,
    executionId,
    userId,
    tags,
    participant,
    usage,
    processingTimeMs,
    modelUsed
  } = params;

  // Skip if no imageId
  if (!imageId) {
    console.log(`${LOG_PREFIX} Skipping save - no imageId provided`);
    return;
  }

  try {
    // Upsert to handle potential duplicate calls
    const { error } = await supabase
      .from('visual_tags')
      .upsert({
        image_id: imageId,
        execution_id: executionId || null,
        user_id: userId,

        // Tags by category
        location_tags: tags.location,
        weather_tags: tags.weather,
        scene_type_tags: tags.sceneType,
        subject_tags: tags.subjects,
        visual_style_tags: tags.visualStyle,
        emotion_tags: tags.emotion,

        // Participant enrichment
        participant_name: participant?.name || null,
        participant_team: participant?.team || null,
        participant_number: participant?.raceNumber || null,

        // Metadata
        model_used: modelUsed,
        processing_time_ms: processingTimeMs,

        // Token tracking
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        estimated_cost_usd: usage.estimatedCostUSD,

        // Confidence (average based on tag count)
        confidence_score: calculateConfidenceScore(tags)
      }, {
        onConflict: 'image_id'
      });

    if (error) {
      console.error(`${LOG_PREFIX} Database error:`, error);
      throw error;
    }

    console.log(`${LOG_PREFIX} Saved tags for image: ${imageId}`);

  } catch (error: any) {
    // Log but don't throw - tagging failure shouldn't break the flow
    console.error(`${LOG_PREFIX} Failed to save tags:`, error.message);
  }
}

/**
 * Calculate confidence score based on tag coverage
 */
function calculateConfidenceScore(tags: DatabaseWriteParams['tags']): number {
  const categories = [
    tags.location,
    tags.weather,
    tags.sceneType,
    tags.subjects,
    tags.visualStyle,
    tags.emotion
  ];

  // Count non-empty categories
  const nonEmptyCategories = categories.filter(c => c.length > 0).length;

  // Base score on category coverage (0-1)
  // 6 categories = 1.0, 3 categories = 0.5, etc.
  return Math.min(1.0, nonEmptyCategories / 6 + 0.3);  // Min 0.3 if any tags
}
