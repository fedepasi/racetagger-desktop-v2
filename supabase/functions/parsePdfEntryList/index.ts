/**
 * Parse PDF Entry List Edge Function
 *
 * Extracts participant data from PDF entry lists and start lists using Gemini 2.5 Flash.
 * Includes validation to ensure the document is actually an entry/start list.
 *
 * Features:
 * - Document type validation (rejects non-entry-list documents)
 * - Multi-page PDF support
 * - Support for multiple languages (IT, EN, ES, FR, DE)
 * - Rally co-driver extraction
 * - Event metadata extraction
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

import {
  CORS_HEADERS,
  VERTEX_AI,
  COST_CONFIG,
  VALIDATION_CONFIG,
  DOCUMENT_VALIDATION_PROMPT,
  EXTRACTION_PROMPT,
  LOG_PREFIX
} from './config/constants.ts';

import {
  ParsePdfRequest,
  ParsePdfResponse,
  ParsePdfSuccessResponse,
  ParsePdfErrorResponse,
  ValidationResult,
  ExtractionResult,
  GeminiResult
} from './types/index.ts';

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Parse request body
    const body: ParsePdfRequest = await req.json();
    const { pdfBase64, userId, sportHint } = body;

    // Validate required fields
    if (!pdfBase64) {
      throw new Error('pdfBase64 is required');
    }

    console.log(`${LOG_PREFIX} Processing PDF for user: ${userId || 'anonymous'}`);

    // Check Vertex AI configuration
    if (!isVertexConfigured()) {
      throw new Error('Vertex AI not configured');
    }

    // Step 1: Validate document type
    console.log(`${LOG_PREFIX} Step 1: Validating document type...`);
    const validationResult = await validateDocument(pdfBase64);
    totalInputTokens += validationResult.inputTokens;
    totalOutputTokens += validationResult.outputTokens;

    const validation = validationResult.parsedResponse;

    // Check if document is valid
    if (!validation.is_valid_entry_list || validation.confidence < VALIDATION_CONFIG.MIN_CONFIDENCE) {
      console.log(`${LOG_PREFIX} Document rejected: ${validation.rejection_reason || 'Low confidence'}`);

      const errorResponse: ParsePdfErrorResponse = {
        success: false,
        error: 'Document is not a valid entry list or start list',
        validation: {
          document_type: validation.document_type,
          confidence: validation.confidence,
          rejection_reason: validation.rejection_reason || 'Document does not appear to be a motorsport/sports entry list'
        }
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    console.log(`${LOG_PREFIX} Document validated: ${validation.document_type} (${(validation.confidence * 100).toFixed(1)}% confidence)`);

    // Step 2: Extract participants
    console.log(`${LOG_PREFIX} Step 2: Extracting participants...`);
    const extractionResult = await extractParticipants(pdfBase64);
    totalInputTokens += extractionResult.inputTokens;
    totalOutputTokens += extractionResult.outputTokens;

    const extraction = extractionResult.parsedResponse;

    // Validate extraction results
    if (!extraction.participants || extraction.participants.length === 0) {
      throw new Error('No participants could be extracted from the document');
    }

    // Filter out invalid participants (missing required fields)
    const validParticipants = extraction.participants.filter(p =>
      p.numero && p.numero.trim().length > 0
    );

    if (validParticipants.length === 0) {
      throw new Error('No valid participants found (all entries missing race numbers)');
    }

    // Calculate metrics
    const processingTimeMs = Date.now() - startTime;
    const estimatedCostUSD = calculateCost(totalInputTokens, totalOutputTokens);

    console.log(`${LOG_PREFIX} Success: Extracted ${validParticipants.length} participants in ${processingTimeMs}ms, cost: $${estimatedCostUSD.toFixed(6)}`);

    // Build success response
    const response: ParsePdfSuccessResponse = {
      success: true,
      data: {
        validation: {
          document_type: validation.document_type,
          confidence: validation.confidence,
          detected_language: validation.detected_language
        },
        event: {
          name: extraction.event_name,
          date: extraction.event_date,
          category: extraction.category
        },
        participants: validParticipants,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUSD
        },
        processingTimeMs,
        modelUsed: VERTEX_AI.DEFAULT_MODEL,
        notes: extraction.extraction_notes
      }
    };

    return new Response(JSON.stringify(response), {
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error:`, error);

    const errorResponse: ParsePdfErrorResponse = {
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
 * Check if Vertex AI is configured
 */
function isVertexConfigured(): boolean {
  const projectId = Deno.env.get(VERTEX_AI.PROJECT_ID_ENV);
  const serviceAccountKey = Deno.env.get(VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV);
  return !!(projectId && serviceAccountKey);
}

/**
 * Get access token from service account
 */
async function getAccessToken(): Promise<string> {
  const serviceAccountKeyJson = Deno.env.get(VERTEX_AI.SERVICE_ACCOUNT_KEY_ENV);
  if (!serviceAccountKeyJson) {
    throw new Error('VERTEX_SERVICE_ACCOUNT_KEY not configured');
  }

  const serviceAccount = JSON.parse(serviceAccountKeyJson);

  // Create JWT header and payload
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  // Encode header and payload
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signInput = `${headerB64}.${payloadB64}`;

  // Import private key and sign
  const privateKeyPem = serviceAccount.private_key;
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(signInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signInput}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to get access token: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

/**
 * Call Gemini API with PDF and prompt
 */
async function callGemini<T>(pdfBase64: string, prompt: string): Promise<GeminiResult<T>> {
  const projectId = Deno.env.get(VERTEX_AI.PROJECT_ID_ENV);
  const location = Deno.env.get(VERTEX_AI.LOCATION_ENV) || VERTEX_AI.DEFAULT_LOCATION;

  if (!projectId) {
    throw new Error('VERTEX_PROJECT_ID not configured');
  }

  const accessToken = await getAccessToken();

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${VERTEX_AI.DEFAULT_MODEL}:generateContent`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: VERTEX_AI.TEMPERATURE,
      maxOutputTokens: VERTEX_AI.MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} Gemini API error:`, errorText);
    throw new Error(`Gemini API request failed: ${response.status}`);
  }

  const result = await response.json();

  // Extract response text
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new Error('Empty response from Gemini');
  }

  // Parse JSON response
  let parsedResponse: T;
  try {
    // Clean response (remove markdown code blocks if present)
    const cleanedResponse = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    parsedResponse = JSON.parse(cleanedResponse);
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse response:`, responseText);
    throw new Error('Failed to parse Gemini response as JSON');
  }

  // Extract token usage
  const usageMetadata = result.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  return {
    parsedResponse,
    inputTokens,
    outputTokens
  };
}

/**
 * Validate that the document is an entry list
 */
async function validateDocument(pdfBase64: string): Promise<GeminiResult<ValidationResult>> {
  return callGemini<ValidationResult>(pdfBase64, DOCUMENT_VALIDATION_PROMPT);
}

/**
 * Extract participants from the document
 */
async function extractParticipants(pdfBase64: string): Promise<GeminiResult<ExtractionResult>> {
  return callGemini<ExtractionResult>(pdfBase64, EXTRACTION_PROMPT);
}

/**
 * Calculate estimated cost
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * COST_CONFIG.INPUT_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * COST_CONFIG.OUTPUT_PER_MILLION;
  return inputCost + outputCost;
}
