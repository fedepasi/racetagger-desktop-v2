/**
 * Tag Extractor Module
 *
 * Calls Gemini 2.5 Flash to extract visual tags from image URL
 */

import { VERTEX_AI, VISUAL_TAGGING_PROMPT, LOG_PREFIX } from '../config/constants.ts';
import { GeminiTagResult, VisualTags } from '../types/index.ts';

/**
 * Check if Vertex AI is configured
 */
export function isVertexConfigured(): boolean {
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
 * Extract visual tags from image using Gemini
 */
export async function extractTags(imageUrl: string): Promise<GeminiTagResult> {
  const projectId = Deno.env.get(VERTEX_AI.PROJECT_ID_ENV);
  const location = Deno.env.get(VERTEX_AI.LOCATION_ENV) || VERTEX_AI.DEFAULT_LOCATION;

  if (!projectId) {
    throw new Error('VERTEX_PROJECT_ID not configured');
  }

  console.log(`${LOG_PREFIX} Extracting tags from: ${imageUrl.substring(0, 80)}...`);

  // Get access token
  const accessToken = await getAccessToken();

  // Build Vertex AI request
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${VERTEX_AI.DEFAULT_MODEL}:generateContent`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: {
              mimeType: 'image/jpeg',
              fileUri: imageUrl
            }
          },
          {
            text: VISUAL_TAGGING_PROMPT
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

  // Call Vertex AI
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
    console.error(`${LOG_PREFIX} Vertex AI error:`, errorText);
    throw new Error(`Vertex AI request failed: ${response.status}`);
  }

  const result = await response.json();

  // Extract response text
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new Error('Empty response from Gemini');
  }

  // Parse JSON response
  let parsedTags: any;
  try {
    // Clean response (remove markdown code blocks if present)
    const cleanedResponse = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    parsedTags = JSON.parse(cleanedResponse);
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse response:`, responseText);
    throw new Error('Failed to parse Gemini response as JSON');
  }

  // Extract token usage
  const usageMetadata = result.usageMetadata || {};
  const inputTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;

  // Map compact keys to full names
  const tags: VisualTags = {
    location: Array.isArray(parsedTags.loc) ? parsedTags.loc : [],
    weather: Array.isArray(parsedTags.wth) ? parsedTags.wth : [],
    sceneType: Array.isArray(parsedTags.scn) ? parsedTags.scn : [],
    subjects: Array.isArray(parsedTags.sub) ? parsedTags.sub : [],
    visualStyle: Array.isArray(parsedTags.sty) ? parsedTags.sty : [],
    emotion: Array.isArray(parsedTags.emo) ? parsedTags.emo : []
  };

  console.log(`${LOG_PREFIX} Extracted ${Object.values(tags).flat().length} tags, tokens: ${inputTokens}/${outputTokens}`);

  return {
    rawResponse: tags,
    inputTokens,
    outputTokens
  };
}
