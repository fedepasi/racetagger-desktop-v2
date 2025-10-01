import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.15.0'
import { encode } from "https://deno.land/std@0.177.0/encoding/base64.ts"

console.log('[ADMIN-0] analyzeImageAdmin function starting up - specialized for admin testing')

// Helper function for detailed logging
function logDebug(stepId: string, message: string, data: any = null) {
  const logObj = {
    step: stepId,
    message: message,
    timestamp: new Date().toISOString()
  };
  
  // Add data if provided, but don't log large base64 content
  if (data) {
    if (typeof data === 'object' && data !== null) {
      // Create a safe copy to avoid mutating the original
      const safeData = {...data};
      
      // Remove any base64 image data that would flood logs
      if (safeData.inlineData?.data && typeof safeData.inlineData.data === 'string') {
        safeData.inlineData.data = '[BASE64_IMAGE_DATA_REMOVED]';
      }
      
      // Add the sanitized data to log object
      Object.assign(logObj, { data: safeData });
    } else {
      Object.assign(logObj, { data });
    }
  }
  
  console.log(JSON.stringify(logObj));
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
        'Access-Control-Allow-Origin': '*', // Adjust for production
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
    } })
  }

  try {
    logDebug('ADMIN-1', 'Admin test request received');
    
    // 1. Check environment variables first - this will help debug missing variables
    ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'].forEach(key => {
      const value = Deno.env.get(key);
      logDebug('ENV-CHECK', `Environment variable ${key}`, { 
        exists: !!value, 
        length: value ? value.length : 0 
      });
    });
    
    // 2. Extract image details from request body
    let requestBody;
    try {
      requestBody = await req.json();
      logDebug('ADMIN-2', 'Request body parsed successfully', {
        hasImagePath: !!requestBody.imagePath,
        hasOriginalFilename: !!requestBody.originalFilename,
        hasMimeType: !!requestBody.mimeType,
        sizeBytes: requestBody.sizeBytes,
        modelRequested: requestBody.modelName
      });
    } catch (parseError) {
      logDebug('ERROR-1', 'Failed to parse request JSON', { error: String(parseError) });
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to parse request body as JSON',
          details: String(parseError)
        }),
        { 
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
    
    const { imagePath, originalFilename, mimeType, sizeBytes, modelName: requestedModelName, category } = requestBody;
    
    // Validate required fields
    if (!imagePath || !originalFilename || !mimeType || typeof sizeBytes !== 'number') {
      logDebug('ERROR-2', 'Missing required parameters', { 
        received: Object.keys(requestBody),
        required: ['imagePath', 'originalFilename', 'mimeType', 'sizeBytes']
      });
      
      throw new Error('Missing required image details in request body');
    }
    
    // Check image size limit (4MB max to avoid 413 errors when converted to base64)
    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
    if (sizeBytes > MAX_IMAGE_SIZE) {
      logDebug('ERROR-2.1', 'Image size exceeds limit', { 
        sizeMB: Math.round(sizeBytes / 1024 / 1024),
        maxMB: MAX_IMAGE_SIZE / 1024 / 1024
      });
      throw new Error(`Image size (${Math.round(sizeBytes / 1024 / 1024)}MB) exceeds maximum allowed size of ${MAX_IMAGE_SIZE / 1024 / 1024}MB`)
    }
    
    // Use requested model or default
    const modelToUse = requestedModelName || 'gemini-2.5-pro-preview-03-25';
    logDebug('ADMIN-3', 'Using model', { modelToUse });
    
    // Use specific admin user ID for all admin tests
    const ADMIN_USER_ID = '12ad7060-5914-4868-b162-9b846580af21';
    logDebug('ADMIN-4', 'Using admin user ID', { ADMIN_USER_ID });

    // 3. Create Supabase client
    let supabaseAdmin;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase credentials');
      }
      
      supabaseAdmin = createClient(supabaseUrl, supabaseKey);
      logDebug('ADMIN-5', 'Supabase admin client created');
    } catch (clientError) {
      logDebug('ERROR-3', 'Failed to create Supabase client', {
        error: String(clientError),
        stack: clientError instanceof Error ? clientError.stack : 'No stack trace'
      });
      throw new Error(`Failed to create Supabase client: ${String(clientError)}`);
    }

    // 4. Get a signed URL for the image
    let imageUrl;
    try {
      logDebug('ADMIN-6', 'Getting signed URL', { bucket: 'uploaded-images', path: imagePath });
      
      const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
        .storage
        .from('uploaded-images')
        .createSignedUrl(imagePath, 60 * 5); // 5 minutes

      if (signedUrlError) {
        logDebug('ERROR-4', 'Signed URL creation failed', signedUrlError);
        throw new Error(`Error creating signed URL: ${signedUrlError.message}`);
      }
      
      imageUrl = signedUrlData.signedUrl;
      logDebug('ADMIN-7', 'Signed URL created successfully', { urlLength: imageUrl.length });
    } catch (storageError) {
      logDebug('ERROR-5', 'Storage operation failed', { 
        error: String(storageError),
        stack: storageError instanceof Error ? storageError.stack : 'No stack trace'
      });
      throw new Error(`Storage error: ${String(storageError)}`);
    }

    // 5. Initialize Gemini AI client
    let model;
    try {
      const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
      if (!geminiApiKey) {
        throw new Error('GEMINI_API_KEY environment variable not set');
      }
      
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      model = genAI.getGenerativeModel({ model: modelToUse });
      logDebug('ADMIN-8', 'Gemini client initialized', { model: modelToUse });
    } catch (aiClientError) {
      logDebug('ERROR-6', 'Failed to initialize Gemini client', { 
        error: String(aiClientError),
        stack: aiClientError instanceof Error ? aiClientError.stack : 'No stack trace'
      });
      throw new Error(`Failed to initialize Gemini client: ${String(aiClientError)}`);
    }

    // 6. Fetch and prepare the image data
    let imageBase64;
    try {
      logDebug('ADMIN-9', 'Fetching image from signed URL');
      
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image from signed URL: ${imageResponse.statusText}`);
      }
      
      const imageBuffer = await imageResponse.arrayBuffer();
      imageBase64 = encode(imageBuffer);
      logDebug('ADMIN-10', 'Image fetched and converted to base64', { 
        mimeType, 
        sizeBytes,
        base64Length: imageBase64.length 
      });
    } catch (imageError) {
      logDebug('ERROR-7', 'Failed to process image', { 
        error: String(imageError),
        stack: imageError instanceof Error ? imageError.stack : 'No stack trace'
      });
      throw new Error(`Image processing error: ${String(imageError)}`);
    }

    // 7. Define category-specific prompts
    function getPromptForCategory(category: string): string {
      switch (category) {
        case 'motorsport':
          return `Analyze the provided image for all identifiable race vehicles (cars, motorcycles, karts, etc.). For each vehicle detected, extract the following information if clearly visible:
- raceNumber: The primary race number (string, or null if not found/readable) don't invent data.
- drivers: An array of driver names (strings, empty array if none found). Include co-drivers or multiple drivers if applicable and identifiable don't invent data.
- category: The race category if visible (string, or null) don't invent data.
- teamName: The team name if visible (string, or null) don't invent data.
- otherText: An array of other relevant short texts found on the vehicle (e.g., main sponsors, max 5 items), don't invent data.
- confidence: An estimated confidence score (number 0.00-1.00) for the identified raceNumber.

Respond ONLY with a valid JSON array where each object represents one detected vehicle and contains the fields above. If no vehicles or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List vehicles generally from foreground to background or left to right if possible. Example object: {"raceNumber": "99", "drivers": ["J. Doe"], "category": "GT3", "teamName": "Racing Team", "otherText": ["Sponsor A", "Sponsor B"], "confidence": 0.9}`;

        case 'running':
          return `Analyze the provided image for all identifiable runners or cyclists. For each athlete detected, extract the following information if clearly visible:
- raceNumber: The primary race number or bib number (string, or null if not found/readable) don't invent data.
- drivers: An array of athlete names (strings, empty array if none found). Include team members if identifiable don't invent data.
- category: The race category, age group, or division if visible (string, or null) don't invent data.
- teamName: The team name, club, or organization if visible (string, or null) don't invent data.
- otherText: An array of other relevant short texts found on the athlete (e.g., sponsors, event name, max 5 items), don't invent data.
- confidence: An estimated confidence score (number 0.00-1.00) for the identified raceNumber.

Respond ONLY with a valid JSON array where each object represents one detected athlete and contains the fields above. If no athletes or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List athletes generally from foreground to background or left to right if possible. Example object: {"raceNumber": "1234", "drivers": ["M. Runner"], "category": "Marathon", "teamName": "Running Club", "otherText": ["Nike", "Boston Marathon"], "confidence": 0.9}`;

        case 'altro':
          return `Analyze the provided image for all identifiable participants or competitors. For each participant detected, extract the following information if clearly visible:
- raceNumber: The primary number, identifier, or bib (string, or null if not found/readable) don't invent data.
- drivers: An array of participant names (strings, empty array if none found). Include team members if identifiable don't invent data.
- category: The category, division, or class if visible (string, or null) don't invent data.
- teamName: The team name or organization if visible (string, or null) don't invent data.
- otherText: An array of other relevant short texts found on the participant (e.g., sponsors, event details, max 5 items), don't invent data.
- confidence: An estimated confidence score (number 0.00-1.00) for the identified raceNumber.

Respond ONLY with a valid JSON array where each object represents one detected participant and contains the fields above. If no participants or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List participants generally from foreground to background or left to right if possible. Example object: {"raceNumber": "42", "drivers": ["A. Competitor"], "category": "Open", "teamName": "Local Team", "otherText": ["Sponsor X", "Event 2024"], "confidence": 0.9}`;

        default:
          // Default to motorsport if category is not recognized
          return `Analyze the provided image for all identifiable race vehicles (cars, motorcycles, karts, etc.). For each vehicle detected, extract the following information if clearly visible:
- raceNumber: The primary race number (string, or null if not found/readable) don't invent data.
- drivers: An array of driver names (strings, empty array if none found). Include co-drivers or multiple drivers if applicable and identifiable don't invent data.
- category: The race category if visible (string, or null) don't invent data.
- teamName: The team name if visible (string, or null) don't invent data.
- otherText: An array of other relevant short texts found on the vehicle (e.g., main sponsors, max 5 items), don't invent data.
- confidence: An estimated confidence score (number 0.00-1.00) for the identified raceNumber.

Respond ONLY with a valid JSON array where each object represents one detected vehicle and contains the fields above. If no vehicles or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List vehicles generally from foreground to background or left to right if possible. Example object: {"raceNumber": "99", "drivers": ["J. Doe"], "category": "GT3", "teamName": "Racing Team", "otherText": ["Sponsor A", "Sponsor B"], "confidence": 0.9}`;
      }
    }

    const prompt = getPromptForCategory(category || 'motorsport');
    console.log(`Using prompt for category: ${category || 'motorsport'}`);

    // 8. Call Gemini API
    const startTime = Date.now(); // Start timing
    let result;
    let analysisText;
    let executionTimeMs = 0; // Declare at function level for scope access
    try {
      logDebug('ADMIN-11', 'Calling Gemini API', { prompt: prompt.substring(0, 100) + '...' });
      
      const generationConfig = { responseMimeType: "application/json" };
      result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType,
          },
        },
      ], generationConfig);
      
      const response = await result.response;
      executionTimeMs = Date.now() - startTime; // Calculate execution time
      analysisText = response.text();
      logDebug('ADMIN-12', 'Received Gemini response', { 
        responseLength: analysisText.length,
        firstChars: analysisText.substring(0, 50) + '...',
        executionTimeMs: executionTimeMs
      });
    } catch (aiError) {
      logDebug('ERROR-8', 'Gemini API call failed', { 
        error: String(aiError),
        stack: aiError instanceof Error ? aiError.stack : 'No stack trace'
      });
      throw new Error(`Gemini API error: ${String(aiError)}`);
    }

    // 9. Calculate token usage and cost
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let analysisProviderString = modelToUse;

    try {
      // Pricing logic based on model
      let INPUT_PRICE_PER_MILLION_TOKENS = 0;
      let OUTPUT_PRICE_PER_MILLION_TOKENS = 0;

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
          INPUT_PRICE_PER_MILLION_TOKENS = 1.20; // Legacy pricing
          OUTPUT_PRICE_PER_MILLION_TOKENS = 15.00; // Legacy pricing
          analysisProviderString = 'gemini_2.5_pro_preview_multi';
          break;
        case 'gemini-2.5-pro-preview-05-06':
          INPUT_PRICE_PER_MILLION_TOKENS = 1.20; // Legacy pricing
          OUTPUT_PRICE_PER_MILLION_TOKENS = 15.00; // Legacy pricing
          analysisProviderString = 'gemini_2.5_pro_may2025_multi';
          break;
        case 'gemini-2.5-flash-preview-04-17':
          INPUT_PRICE_PER_MILLION_TOKENS = 0.15; // Legacy pricing
          OUTPUT_PRICE_PER_MILLION_TOKENS = 3.50; // Legacy pricing
          analysisProviderString = 'gemini_2.5_flash_preview_multi';
          break;
        case 'gemini-2.0-flash-lite':
          INPUT_PRICE_PER_MILLION_TOKENS = 0.075; // Legacy pricing
          OUTPUT_PRICE_PER_MILLION_TOKENS = 0.30; // Legacy pricing
          analysisProviderString = 'gemini-2.0-flash-lite';
          break;
        case 'gemini-1.5-flash-latest':
          INPUT_PRICE_PER_MILLION_TOKENS = 0.10; // Legacy pricing
          OUTPUT_PRICE_PER_MILLION_TOKENS = 0.35; // Legacy pricing
          analysisProviderString = 'gemini-1.5-flash-latest';
          break;
        default:
          logDebug('WARN-1', 'Unknown model, using default pricing', { modelToUse });
          INPUT_PRICE_PER_MILLION_TOKENS = 7.00;
          OUTPUT_PRICE_PER_MILLION_TOKENS = 21.00;
          analysisProviderString = `${modelToUse}_multi`;
      }

      // Extract token usage from metadata
      if (result.response.usageMetadata) {
        inputTokens = result.response.usageMetadata.promptTokenCount ?? 0;
        outputTokens = result.response.usageMetadata.candidatesTokenCount ?? 
                       (result.response.usageMetadata.totalTokenCount ? 
                        result.response.usageMetadata.totalTokenCount - inputTokens : 0);
        
        const inputCost = (inputTokens / 1000000) * INPUT_PRICE_PER_MILLION_TOKENS;
        const outputCost = (outputTokens / 1000000) * OUTPUT_PRICE_PER_MILLION_TOKENS;
        estimatedCost = inputCost + outputCost;
        
        logDebug('ADMIN-13', 'Token usage and cost calculated', { 
          inputTokens, 
          outputTokens, 
          estimatedCostUSD: estimatedCost
        });
      } else {
        logDebug('WARN-2', 'No token usage metadata in Gemini response');
      }
    } catch (costError) {
      logDebug('WARN-3', 'Error calculating token usage', { error: String(costError) });
      // Non-critical - continue with default values
    }

    // 10. Parse the Gemini response
    let analysisResultsArray = [];
    try {
      logDebug('ADMIN-14', 'Parsing Gemini response');
      
      // Clean potential Markdown fences and trim whitespace
      const cleanedJsonText = analysisText
        .replace(/^```json\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
      
      analysisResultsArray = JSON.parse(cleanedJsonText);
      
      if (!Array.isArray(analysisResultsArray)) {
        throw new Error('Parsed response is not an array');
      }
      
      logDebug('ADMIN-15', 'Successfully parsed response', { 
        arrayLength: analysisResultsArray.length,
        firstItem: analysisResultsArray.length > 0 ? 
          JSON.stringify(analysisResultsArray[0]).substring(0, 100) + '...' : 'none'
      });
    } catch (parseError) {
      logDebug('ERROR-9', 'Failed to parse Gemini response', { 
        error: String(parseError),
        rawResponse: analysisText
      });
      throw new Error(`Failed to parse Gemini response: ${String(parseError)}`);
    }

    // 11. Create image record in database
    let imageId;
    try {
      logDebug('ADMIN-16', 'Creating image record');
      
      const requesterIp = req.headers.get('x-forwarded-for') || null;
      
      // Admin test metadata - store as requester_geo since metadata column doesn't exist
      const adminTestGeo = {
        is_admin_test: true,
        test_timestamp: new Date().toISOString(),
        test_model: modelToUse,
        admin_user_id: ADMIN_USER_ID
      };
      
      const { data: newImageRecord, error: imageInsertError } = await supabaseAdmin
        .from('images')
        .insert({
          storage_path: imagePath,
          original_filename: originalFilename,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          status: 'analyzed', // Direct to analyzed for admin tests
          requester_ip: requesterIp,
          requester_geo: adminTestGeo, // Store admin test metadata in requester_geo field
          user_id: ADMIN_USER_ID
        })
        .select('id')
        .single();

      if (imageInsertError || !newImageRecord) {
        throw new Error(`Failed to create image record: ${imageInsertError?.message || 'No record returned'}`);
      }
      
      imageId = newImageRecord.id;
      logDebug('ADMIN-17', 'Image record created', { imageId });
    } catch (dbError) {
      logDebug('ERROR-10', 'Database error creating image record', { 
        error: String(dbError),
        stack: dbError instanceof Error ? dbError.stack : 'No stack trace'
      });
      throw new Error(`Database error: ${String(dbError)}`);
    }

    // 12. Store analysis results
    try {
      logDebug('ADMIN-18', 'Saving analysis results');
      
      // Extract primary vehicle data if available
      const primaryVehicleResult = analysisResultsArray.length > 0 ? analysisResultsArray[0] : {};

      // Calculate confidence level
      let confidenceScore = primaryVehicleResult.confidence ?? 0.0;
      let confidenceLevel = 'LOW';
      if (confidenceScore >= 0.97) {
        confidenceLevel = 'HIGH';
      } else if (confidenceScore >= 0.92) {
        confidenceLevel = 'MEDIUM';
      }

      const { error: insertError } = await supabaseAdmin
        .from('analysis_results')
        .insert({
          image_id: imageId,
          analysis_provider: analysisProviderString,
          recognized_number: primaryVehicleResult.raceNumber ?? null,
          additional_text: primaryVehicleResult.otherText ?? [],
          confidence_score: confidenceScore,
          confidence_level: confidenceLevel,
          raw_response: analysisResultsArray,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCost,
          execution_time_ms: executionTimeMs,
        });

      if (insertError) {
        throw new Error(`Error inserting analysis results: ${insertError.message}`);
      }
      
      logDebug('ADMIN-19', 'Analysis results saved');
    } catch (analysisDbError) {
      logDebug('ERROR-11', 'Database error saving analysis results', { 
        error: String(analysisDbError),
        stack: analysisDbError instanceof Error ? analysisDbError.stack : 'No stack trace'
      });
      throw new Error(`Database error: ${String(analysisDbError)}`);
    }

    // 13. Record token usage for admin user
    try {
      if (inputTokens > 0 || outputTokens > 0) {
        logDebug('ADMIN-20', 'Recording token usage for admin user', { userId: ADMIN_USER_ID });
        
        const totalTokens = inputTokens + outputTokens;
        
        // Check if user already has a token record
        const { data: userTokenRecord } = await supabaseAdmin
          .from('user_tokens')
          .select('*')
          .eq('user_id', ADMIN_USER_ID)
          .single();

        if (userTokenRecord) {
          // Update existing record
          await supabaseAdmin
            .from('user_tokens')
            .update({
              tokens_used: userTokenRecord.tokens_used + totalTokens,
              last_updated: new Date().toISOString()
            })
            .eq('user_id', ADMIN_USER_ID);
          
          logDebug('ADMIN-21', 'Updated token record', { newTokens: totalTokens });
        } else {
          // Create new token record with high allocation for admin testing
          await supabaseAdmin
            .from('user_tokens')
            .insert({
              user_id: ADMIN_USER_ID,
              tokens_purchased: 1000000, // Large allocation for admin testing
              tokens_used: totalTokens
            });
          
          logDebug('ADMIN-21', 'Created new token record', { totalTokens });
        }

        // Record transaction
        await supabaseAdmin
          .from('token_transactions')
          .insert({
            user_id: ADMIN_USER_ID,
            amount: totalTokens,
            transaction_type: 'usage',
            image_id: imageId,
            description: 'Admin testing via management portal'
          });
        
        logDebug('ADMIN-22', 'Recorded token transaction', { totalTokens });
      }
    } catch (tokenError) {
      // Non-critical - log but continue
      logDebug('WARN-4', 'Error recording token usage', { error: String(tokenError) });
    }

    // 14. Return success response
    logDebug('ADMIN-23', 'Operation completed successfully');
    
    return new Response(
      JSON.stringify({
        success: true,
        analysis: analysisResultsArray,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCostUSD: estimatedCost
        },
        imageId,
        model: modelToUse,
        adminTest: true
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        }
      }
    );

  } catch (error) {
    // Top-level error handler
    logDebug('ERROR-FINAL', 'Unhandled error in admin function', { 
      errorMessage: error.message || String(error),
      stack: error.stack || 'No stack trace available'
    });
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        }
      }
    );
  }
});

console.log('analyzeImageAdmin function initialized');
