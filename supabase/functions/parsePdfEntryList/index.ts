/**
 * Parse PDF Entry List Edge Function
 *
 * Extracts participant data from PDF entry lists and start lists using Gemini.
 * Includes validation to ensure the document is actually an entry/start list.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

const LOG_PREFIX = '[ParsePdfEntryList]';

// Prompts
const DOCUMENT_VALIDATION_PROMPT = `Analyze this PDF document and determine if it contains a list of racing/sports participants with their race numbers.

Return ONLY valid JSON in this exact format:
{
  "is_valid_entry_list": true/false,
  "confidence": 0.0-1.0,
  "document_type": "entry_list" | "start_list" | "starting_grid" | "race_entry" | "participant_list" | "competitor_list" | "race_results" | "classification" | "final_results" | "other",
  "rejection_reason": "string if not valid, null otherwise",
  "detected_language": "en" | "it" | "es" | "fr" | "de" | "other"
}

VALID documents (accept these):
- Entry lists, start lists, starting grids
- Participant lists, competitor lists
- Race results, classifications, final standings (these contain valid participant data!)
- Any document with race numbers and driver/rider names

REJECT only these:
- General news articles or press releases
- Random images or photos without data
- Non-racing documents (invoices, contracts, tickets)
- Documents without race numbers`;

const EXTRACTION_PROMPT = `Extract ALL participants from this racing document (entry list, start list, or race results).

Return ONLY valid JSON in this exact format:
{
  "event_name": "Event title if found",
  "event_date": "Date if found (YYYY-MM-DD)",
  "category": "Main category/championship name if found",
  "participants": [
    {
      "numero": "Race number (REQUIRED)",
      "drivers": ["Driver 1 full name", "Driver 2 if any", "Driver 3 if any"],
      "squadra": "Team name",
      "categoria": "Category/Class",
      "sponsors": ["Sponsor 1", "Sponsor 2"],
      "nationality": "Country code if visible (ITA, GER, etc.)"
    }
  ],
  "extraction_notes": "Any issues or notes about extraction"
}

IMPORTANT RULES:
1. "numero" is REQUIRED - skip entries without a visible race number
2. "drivers" is an ARRAY - include ALL drivers/riders for this entry (main driver, co-driver, endurance teammates)
3. Extract ALL participants, not just a sample
4. Handle multi-page documents - extract from all pages
5. For rally: include both driver and co-driver/navigator in the drivers array
6. For endurance races: include all team drivers in the drivers array
7. For race results: ignore position/classification columns, extract race NUMBER not finishing position
8. "sponsors" should be an array of visible sponsor names`;

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body = await req.json();
    const { pdfBase64, userId } = body;

    // Validate required fields
    if (!pdfBase64) {
      throw new Error('pdfBase64 is required');
    }

    console.log(`${LOG_PREFIX} Processing PDF for user: ${userId || 'anonymous'}`);

    // Get Gemini API key
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    // Step 1: Validate document type
    console.log(`${LOG_PREFIX} Step 1: Validating document type...`);

    let validationResult;
    try {
      validationResult = await model.generateContent([
        DOCUMENT_VALIDATION_PROMPT,
        {
          inlineData: {
            data: pdfBase64,
            mimeType: 'application/pdf'
          }
        }
      ]);
      console.log(`${LOG_PREFIX} Validation API call successful`);
    } catch (apiError: any) {
      console.error(`${LOG_PREFIX} Gemini API error during validation:`, apiError.message);
      throw new Error(`Gemini API error: ${apiError.message}`);
    }

    const validationText = validationResult.response.text();
    console.log(`${LOG_PREFIX} Validation response length: ${validationText.length}`);

    let validation;
    try {
      const cleanedValidation = validationText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      console.log(`${LOG_PREFIX} Cleaned validation: ${cleanedValidation.substring(0, 200)}...`);
      validation = JSON.parse(cleanedValidation);
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to parse validation response:`, validationText.substring(0, 500));
      throw new Error(`Failed to parse validation response: ${validationText.substring(0, 200)}`);
    }

    // Check if document is valid
    if (!validation.is_valid_entry_list || validation.confidence < 0.7) {
      console.log(`${LOG_PREFIX} Document rejected: ${validation.rejection_reason || 'Low confidence'}`);

      return new Response(JSON.stringify({
        success: false,
        error: 'Document is not a valid entry list or start list',
        validation: {
          document_type: validation.document_type,
          confidence: validation.confidence,
          rejection_reason: validation.rejection_reason || 'Document does not appear to be a motorsport/sports entry list'
        }
      }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    console.log(`${LOG_PREFIX} Document validated: ${validation.document_type} (${(validation.confidence * 100).toFixed(1)}% confidence)`);

    // Step 2: Extract participants
    console.log(`${LOG_PREFIX} Step 2: Extracting participants...`);

    let extractionResult;
    try {
      extractionResult = await model.generateContent([
        EXTRACTION_PROMPT,
        {
          inlineData: {
            data: pdfBase64,
            mimeType: 'application/pdf'
          }
        }
      ]);
      console.log(`${LOG_PREFIX} Extraction API call successful`);
    } catch (apiError: any) {
      console.error(`${LOG_PREFIX} Gemini API error during extraction:`, apiError.message);
      throw new Error(`Gemini API error during extraction: ${apiError.message}`);
    }

    const extractionText = extractionResult.response.text();
    console.log(`${LOG_PREFIX} Extraction response length: ${extractionText.length}`);

    let extraction;
    try {
      const cleanedExtraction = extractionText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      console.log(`${LOG_PREFIX} Cleaned extraction preview: ${cleanedExtraction.substring(0, 300)}...`);
      extraction = JSON.parse(cleanedExtraction);
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to parse extraction response:`, extractionText.substring(0, 500));
      throw new Error(`Failed to parse extraction response: ${extractionText.substring(0, 200)}`);
    }

    // Validate extraction results
    if (!extraction.participants || extraction.participants.length === 0) {
      throw new Error('No participants could be extracted from the document');
    }

    // Filter out invalid participants (missing required fields) and transform
    const validParticipants = extraction.participants
      .filter((p: any) => p.numero && p.numero.toString().trim().length > 0)
      .map((p: any) => ({
        numero: p.numero.toString().trim(),
        // Comma-separated driver names for legacy nome field
        nome: Array.isArray(p.drivers)
          ? p.drivers.filter((d: string) => d && d.trim()).join(', ')
          : (p.nome || p.drivers || ''),
        squadra: p.squadra || '',
        categoria: p.categoria || '',
        // Convert sponsors array to array (keep as-is if already array)
        sponsors: Array.isArray(p.sponsors) ? p.sponsors : [],
        nationality: p.nationality || '',
        // Keep raw drivers array for creating preset_participant_drivers records
        drivers: Array.isArray(p.drivers) ? p.drivers.filter((d: string) => d && d.trim()) : []
      }));

    if (validParticipants.length === 0) {
      throw new Error('No valid participants found (all entries missing race numbers)');
    }

    // Calculate metrics
    const processingTimeMs = Date.now() - startTime;

    console.log(`${LOG_PREFIX} Success: Extracted ${validParticipants.length} participants in ${processingTimeMs}ms`);

    // Build success response
    const response = {
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
        processingTimeMs,
        modelUsed: 'gemini-3-flash-preview',
        notes: extraction.extraction_notes
      }
    };

    return new Response(JSON.stringify(response), {
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error:`, error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Unknown error',
      details: error.stack
    }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
});
