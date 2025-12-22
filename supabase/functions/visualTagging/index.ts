/**
 * Visual Tagging Edge Function
 *
 * Extracts visual descriptive tags from racing images for marketing search.
 * Uses Gemini 2.5 Flash Lite for fast, cost-effective tagging.
 *
 * Categories extracted:
 * - Location: landmarks, track features, cities
 * - Weather: conditions, lighting, time of day
 * - Scene Type: action, podium, pit stop, portrait
 * - Subjects: vehicles, people, objects
 * - Visual Style: motion blur, panning, close-up
 * - Emotion: excitement, tension, celebration
 *
 * Token Cost: 0.5 tokens per image (configured in desktop client)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Modules
import { extractTags, isVertexConfigured } from './modules/tag-extractor.ts';
import { normalizeTags, enrichWithParticipant } from './modules/tag-normalizer.ts';
import { saveVisualTags, calculateCost } from './modules/database-writer.ts';

// Types and constants
import {
  VisualTaggingRequest,
  VisualTaggingSuccessResponse,
  VisualTaggingErrorResponse
} from './types/index.ts';
import { CORS_HEADERS, LOG_PREFIX, VERTEX_AI } from './config/constants.ts';

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body: VisualTaggingRequest = await req.json();
    const {
      imageUrl,
      imageId,
      executionId,
      userId,
      recognitionResult
    } = body;

    // Validate required fields
    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    console.log(`${LOG_PREFIX} Processing: ${imageUrl.substring(0, 60)}...`);

    // Check Vertex AI configuration
    if (!isVertexConfigured()) {
      throw new Error('Vertex AI not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Extract tags using Gemini
    const tagResult = await extractTags(imageUrl);

    // 2. Normalize tags
    const normalizedTags = normalizeTags(tagResult.rawResponse);

    // 3. Enrich with participant data
    const { tags: enrichedTags, participant } = enrichWithParticipant(
      normalizedTags,
      recognitionResult
    );

    // 4. Calculate metrics
    const processingTimeMs = Date.now() - startTime;
    const estimatedCostUSD = calculateCost(tagResult.inputTokens, tagResult.outputTokens);

    // 5. Save to database
    await saveVisualTags(supabase, {
      imageId,
      executionId,
      userId,
      tags: enrichedTags,
      participant,
      usage: {
        inputTokens: tagResult.inputTokens,
        outputTokens: tagResult.outputTokens,
        estimatedCostUSD
      },
      processingTimeMs,
      modelUsed: VERTEX_AI.DEFAULT_MODEL
    });

    // 6. Build success response
    const response: VisualTaggingSuccessResponse = {
      success: true,
      data: {
        tags: enrichedTags,
        participant,
        usage: {
          inputTokens: tagResult.inputTokens,
          outputTokens: tagResult.outputTokens,
          estimatedCostUSD
        },
        processingTimeMs,
        modelUsed: VERTEX_AI.DEFAULT_MODEL
      }
    };

    const totalTags = Object.values(enrichedTags).flat().length;
    console.log(`${LOG_PREFIX} Success: ${totalTags} tags, ${processingTimeMs}ms, $${estimatedCostUSD.toFixed(6)}`);

    return new Response(JSON.stringify(response), {
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error:`, error);

    const errorResponse: VisualTaggingErrorResponse = {
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
