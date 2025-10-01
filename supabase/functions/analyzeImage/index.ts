import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0' // Updated SDK version
import { encode } from "https://deno.land/std@0.177.0/encoding/base64.ts"; // Import Deno's base64 encoder

// TODO: Implement CORS handling for local development/specific origins

// Function initialized

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
        'Access-Control-Allow-Origin': '*', // Adjust for production
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
    } })
  }

  try {
    // 1. Extract image details AND modelName from request body
    const { imagePath, originalFilename, mimeType, sizeBytes, modelName: requestedModelName } = await req.json()
    if (!imagePath || !originalFilename || !mimeType || typeof sizeBytes !== 'number') {
      throw new Error('Missing required image details in request body (imagePath, originalFilename, mimeType, sizeBytes)')
    }
    // Use requested model or default if not provided
    const modelToUse = requestedModelName || 'gemini-2.5-pro-preview-03-25';
    // Processing image request

    // 2. Create Supabase client to interact with storage and database
    // Note: Use Service Role Key for admin access from Edge Function
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Use Service Role Key
    )
    // Database connection established

    // 3. Get a signed URL for the image from Supabase Storage
    // Bucket name should match the one created ('uploaded-images')
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
      .storage
      .from('uploaded-images') // Make sure this bucket name is correct
      .createSignedUrl(imagePath, 60 * 5) // Signed URL valid for 5 minutes

    if (signedUrlError) {
      throw new Error(`Error creating signed URL: ${signedUrlError.message}`)
    }
    const imageUrl = signedUrlData.signedUrl
    // Image URL generated

    // 4. Initialize Google Generative AI client
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') // Use the secret name
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set')
    }
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    // Use the requested model name
    const model = genAI.getGenerativeModel({ model: modelToUse })
    // AI service initialized

    // 5. Prepare the image data for Gemini API
    // Fetching the image data from the signed URL:
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image from signed URL: ${imageResponse.statusText}`)
    }
    // We already have mimeType from the request body, use that.
    // Read the body as ArrayBuffer
    const imageBuffer = await imageResponse.arrayBuffer();
    // Convert ArrayBuffer to base64 string using Deno's standard library (more robust)
    const imageBase64 = encode(imageBuffer);
    // Image processed


    // 6. Define the NEW prompt for Gemini (multi-vehicle analysis)
    const prompt = `Analyze the provided image for all identifiable race vehicles (cars, motorcycles, karts, etc.). For each vehicle detected, extract the following information if clearly visible:
- raceNumber: The primary race number (string, or null if not found/readable).
- drivers: An array of driver names (strings, empty array if none found). Include co-drivers or multiple drivers if applicable and identifiable.
- category: The race category if visible (string, or null).
- teamName: The team name if visible (string, or null).
- otherText: An array of other relevant short texts found on the vehicle (e.g., main sponsors, max 5 items).
- confidence: An estimated confidence score (number 0.0-1.0) for the identified raceNumber.

Respond ONLY with a valid JSON array where each object represents one detected vehicle and contains the fields above. If no vehicles or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List vehicles generally from foreground to background or left to right if possible. Example object: {"raceNumber": "99", "drivers": ["J. Doe"], "category": "GT3", "teamName": "Racing Team", "otherText": ["Sponsor A", "Sponsor B"], "confidence": 0.9}
`;

    // 7. Call Gemini API
    // Processing with AI service
    const startTime = Date.now(); // Start timing
    const generationConfig = { responseMimeType: "application/json" }; // Request JSON output
    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: imageBase64,
                mimeType: mimeType,
            },
        },
    ], generationConfig); // Pass config here if needed by the SDK version

    const response = await result.response;
    const executionTimeMs = Date.now() - startTime; // Calculate execution time
    const analysisText = response.text(); // Gemini should return JSON string directly
    // AI analysis completed

    // --- BEGIN Cost Calculation ---
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;

    // --- Pricing Logic based on model ---
    // IMPORTANT: Verify these prices! These are examples/placeholders.
    let INPUT_PRICE_PER_MILLION_TOKENS = 0;
    let OUTPUT_PRICE_PER_MILLION_TOKENS = 0;
    let analysisProviderString = modelToUse; // Default provider string

    switch (modelToUse) {
        case 'gemini-2.5-flash-lite-preview-06-17':
            INPUT_PRICE_PER_MILLION_TOKENS = 0.10; // $0.10/million tokens
            OUTPUT_PRICE_PER_MILLION_TOKENS = 0.40; // $0.40/million tokens
            analysisProviderString = 'gemini_2.5_flash_lite_preview_multi';
            break;
        case 'gemini-2.5-pro':
            INPUT_PRICE_PER_MILLION_TOKENS = 1.25; // $1.25/million tokens
            OUTPUT_PRICE_PER_MILLION_TOKENS = 10.00; // $10.00/million tokens
            analysisProviderString = 'gemini_2.5_pro_multi';
            break;
        case 'gemini-2.5-flash':
            INPUT_PRICE_PER_MILLION_TOKENS = 0.30; // $0.30/million tokens
            OUTPUT_PRICE_PER_MILLION_TOKENS = 2.50; // $2.50/million tokens
            analysisProviderString = 'gemini_2.5_flash_multi';
            break;
        case 'gemini-2.5-pro-preview-03-25':
            INPUT_PRICE_PER_MILLION_TOKENS = 7.00; // Legacy pricing
            OUTPUT_PRICE_PER_MILLION_TOKENS = 21.00; // Legacy pricing
            analysisProviderString = 'gemini_2.5_pro_preview_multi';
            break;
        case 'gemini-2.5-flash-preview-04-17':
             INPUT_PRICE_PER_MILLION_TOKENS = 0.70; // Legacy pricing
             OUTPUT_PRICE_PER_MILLION_TOKENS = 2.10; // Legacy pricing
             analysisProviderString = 'gemini_2.5_flash_preview_multi';
             break;
        case 'gemini-1.5-flash-latest':
            INPUT_PRICE_PER_MILLION_TOKENS = 0.35; // Legacy pricing
            OUTPUT_PRICE_PER_MILLION_TOKENS = 1.05; // Legacy pricing
            analysisProviderString = 'gemini_1.5_flash_latest_multi';
            break;
        // Add cases for other models (GPT, Claude) here later
        default:
            console.warn(`Unknown model requested: ${modelToUse}. Using default pricing.`);
            // Use default Pro pricing as a fallback or set to 0
            INPUT_PRICE_PER_MILLION_TOKENS = 7.00;
            OUTPUT_PRICE_PER_MILLION_TOKENS = 21.00;
            analysisProviderString = `${modelToUse}_multi`; // Generic provider string
    }
    // --- End Pricing Logic ---

    // Extract token usage from metadata (check SDK docs for exact structure)
    // Common patterns: result.response.usageMetadata or result.response.promptFeedback?.tokenCount
    // Adjust based on actual response structure from console logs if needed
    if (result.response.usageMetadata) {
        inputTokens = result.response.usageMetadata.promptTokenCount ?? 0;
        // Use candidatesTokenCount if available, otherwise fallback might be needed
        outputTokens = result.response.usageMetadata.candidatesTokenCount ?? result.response.usageMetadata.totalTokenCount ?? 0;
        if (outputTokens === result.response.usageMetadata.totalTokenCount && inputTokens > 0) {
             // If only total is available, estimate output tokens
             outputTokens = result.response.usageMetadata.totalTokenCount - inputTokens;
        }
        // Usage metrics recorded

        // Calculate cost
        const inputCost = (inputTokens / 1000000) * INPUT_PRICE_PER_MILLION_TOKENS;
        const outputCost = (outputTokens / 1000000) * OUTPUT_PRICE_PER_MILLION_TOKENS;
        estimatedCost = inputCost + outputCost;
        // Cost calculated
    } else {
        console.warn('Could not find token usage metadata in Gemini response.');
    }
    // --- END Cost Calculation ---

    // 8. Parse the response (expecting a JSON array)
    let analysisResultsArray: any[] = []; // Expecting an array now
    let cleanedJsonText = analysisText; // Initialize cleaned text variable
    try {
        // Clean potential Markdown fences and trim whitespace
        cleanedJsonText = analysisText
            .replace(/^```json\s*/, '') // Remove starting fence and optional whitespace
            .replace(/\s*```$/, '')     // Remove ending fence and optional whitespace
            .trim();                    // Trim leading/trailing whitespace

        // Ensure the cleaned text looks like an array before parsing
        if (!cleanedJsonText.startsWith('[') || !cleanedJsonText.endsWith(']')) {
             // If not an array, maybe Gemini failed? Log and return empty array or throw error.
             console.warn('Gemini response did not look like a JSON array, attempting to parse anyway:', cleanedJsonText);
             // Attempt parse anyway, might be single object or error message
        }

        analysisResultsArray = JSON.parse(cleanedJsonText); // Parse the cleaned text (should be an array)

        // Optional: Add validation for each object in the array if needed
        if (!Array.isArray(analysisResultsArray)) {
            console.error('Parsed response is not an array:', analysisResultsArray);
            throw new Error('Parsed analysis result from Gemini was not an array.');
        }

    } catch (parseError) {
        console.error('Error parsing Gemini JSON array response:', parseError)
        // Log the raw response for debugging
        console.error('Raw Gemini response was:', analysisText) // Log original for comparison
        throw new Error(`Failed to parse analysis result array from Gemini. Cleaned response: ${cleanedJsonText}`); // Throw error with cleaned text
    }
    // Results processed

    // --- BEGIN NEW STEP: Create image record in DB within the function ---
    // Saving to database
    const { data: newImageRecord, error: imageInsertError } = await supabaseAdmin
      .from('images')
      .insert({
        storage_path: imagePath,
        original_filename: originalFilename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        status: 'processing', // Set initial status
        // user_id: null // Assuming anonymous for now
      })
      .select('id') // Select the ID of the newly inserted row
      .single(); // Expect exactly one row back

    if (imageInsertError || !newImageRecord) {
      console.error('Database Image Insert Error:', imageInsertError);
      // If image insert fails, we probably shouldn't proceed
      // Optionally delete the uploaded file?
      await supabaseAdmin.storage.from('uploaded-images').remove([imagePath]);
      // Cleanup completed
      throw new Error(`Failed to create image record in database: ${imageInsertError?.message || 'No record returned'}`);
    }
    const imageId = newImageRecord.id;
    // Record created successfully
    // --- END NEW STEP ---


    // 9. Store analysis results in the database, linking to the new imageId

    // Insert analysis results
    // For now, store the whole array in raw_response.
    // Extract primary vehicle data for the main columns if possible.
    const primaryVehicleResult = analysisResultsArray.length > 0 ? analysisResultsArray[0] : {};

    const { error: insertError } = await supabaseAdmin
      .from('analysis_results')
      .insert({
        image_id: imageId,
        analysis_provider: analysisProviderString, // Use dynamic provider string
        recognized_number: primaryVehicleResult.raceNumber ?? null,
        additional_text: primaryVehicleResult.otherText ?? [],
        confidence_score: primaryVehicleResult.confidence ?? 0.0,
        raw_response: analysisResultsArray, // Store the full array of results
        input_tokens: inputTokens, // Save token count
        output_tokens: outputTokens, // Save token count
        estimated_cost_usd: estimatedCost, // Save calculated cost
        execution_time_ms: executionTimeMs, // Save execution time
      })

    if (insertError) {
      throw new Error(`Error inserting analysis results: ${insertError.message}`)
    }
    // Analysis saved

    // Update image status to 'analyzed'
    const { error: updateError } = await supabaseAdmin
        .from('images')
        .update({ status: 'analyzed' }) // updated_at is handled by trigger
        .eq('id', imageId);

    if (updateError) {
        // Log error but don't fail the whole process if status update fails
        console.error(`Error updating image status to 'analyzed': ${updateError.message}`)
        // Non-critical error, proceed
    } else {
        // Status updated
    }


    // 10. Return success response including CORS headers
    // Return the full array AND cost/token info in the response
    return new Response(
      JSON.stringify({
        success: true,
        analysis: analysisResultsArray,
        usage: { // Add usage details to the response
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            estimatedCostUSD: estimatedCost
        }
      }),
      { headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Adjust for production
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        }
      }
    )

  } catch (error) {
    console.error('Error in analyzeImage function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Adjust for production
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        }
      }
    )
  }
})

// Service ready
