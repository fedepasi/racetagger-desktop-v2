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
    // Processing request
    
    // 1. Extract image details AND modelName from request body
    let requestBody;
    try {
      requestBody = await req.json();
      // Request parsed
    } catch (jsonError) {
      console.error('Failed to parse request body as JSON:', jsonError);
      throw new Error(`Failed to parse request body: ${jsonError.message}`);
    }
    
    const { imagePath, originalFilename, mimeType, sizeBytes, modelName: requestedModelName, userId, category, userEmail, executionId, participantPreset } = requestBody;
    
    // Validate required fields
    if (!imagePath) {
      throw new Error('Missing required field: imagePath');
    }
    if (!originalFilename) {
      throw new Error('Missing required field: originalFilename');
    }
    if (!mimeType) {
      throw new Error('Missing required field: mimeType');
    }
    if (typeof sizeBytes !== 'number') {
      throw new Error('Missing or invalid field: sizeBytes (must be a number)');
    }
    if (!userEmail) {
      throw new Error('Missing required field: userEmail (required for token validation)');
    }
    
    // Use requested model or default if not provided
    const modelToUse = requestedModelName || 'gemini-2.5-flash-lite';
    // Processing image request
    
    // Initialize token variables at function level to ensure they're available in catch blocks
    let availableBalance = 0;
    let consumeError = null;
    let remainingTokens = 0;

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


    // 6. Define category-specific prompts with optional preset enhancement
    function getPromptForCategory(category: string, preset?: any): string {
      switch (category) {
        case 'motorsport':
          let motorsportPrompt = `Analyze the provided image for all identifiable race vehicles (cars, motorcycles, karts, etc.). For each vehicle detected, extract the following information if clearly visible:
- raceNumber: The primary race number (string, or null if not found/readable) don't invent data.
- drivers: An array of driver names (strings, empty array if none found). Include co-drivers or multiple drivers if applicable and identifiable don't invent data.
- category: The race category if visible (string, or null) don't invent data.
- teamName: The team name if visible (string, or null) don't invent data.
- otherText: An array of other relevant short texts found on the vehicle (e.g., main sponsors, max 5 items), don't invent data.
- confidence: An estimated confidence score (number 0.00-1.00) for the identified raceNumber.`;

          // Add preset-specific context if available
          if (preset && preset.participants && preset.participants.length > 0) {
            const numbers = preset.participants.map((p: any) => p.numero || p.number).filter(Boolean);
            const sponsors = preset.participants
              .map((p: any) => p.sponsor || p.sponsors)
              .filter(Boolean)
              .flat()
              .filter((s: string) => s && s.length > 2);
            const teams = preset.participants.map((p: any) => p.squadra || p.team).filter(Boolean);

            motorsportPrompt += `\n\nCONTEXT: This image is from an event with known participants. Pay special attention to these details:`;

            if (numbers.length > 0) {
              motorsportPrompt += `\n- Expected race numbers: ${numbers.slice(0, 20).join(', ')}${numbers.length > 20 ? '...' : ''}`;
            }

            if (sponsors.length > 0) {
              const uniqueSponsors = [...new Set(sponsors)];
              motorsportPrompt += `\n- Known sponsors to look for: ${uniqueSponsors.slice(0, 15).join(', ')}${uniqueSponsors.length > 15 ? '...' : ''}`;
            }

            if (teams.length > 0) {
              const uniqueTeams = [...new Set(teams)];
              motorsportPrompt += `\n- Known teams: ${uniqueTeams.slice(0, 10).join(', ')}${uniqueTeams.length > 10 ? '...' : ''}`;
            }
          }

          motorsportPrompt += `\n\nRespond ONLY with a valid JSON array where each object represents one detected vehicle and contains the fields above. If no vehicles or data are found, return an empty array []. Do not include explanations or markdown formatting in the response. List vehicles generally from foreground to background or left to right if possible. Example object: {"raceNumber": "99", "drivers": ["J. Doe"], "category": "GT3", "teamName": "Racing Team", "otherText": ["Sponsor A", "Sponsor B"], "confidence": 0.9}`;

          return motorsportPrompt;

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

    const prompt = getPromptForCategory(category || 'motorsport', participantPreset);
    // Analysis category set

    // Log preset usage for debugging
    if (participantPreset && participantPreset.participants) {
      console.log(`[GEMINI API] Using participant preset: ${participantPreset.name} with ${participantPreset.participants.length} participants`);
    }

    // 7. Call Gemini API
    // Processing with AI service
    console.log(`[GEMINI API] Starting analysis with model: ${modelToUse}`);
    console.log(`[GEMINI API] Image size: ${sizeBytes} bytes, MIME type: ${mimeType}`);
    console.log(`[GEMINI API] Category: ${category}, User: ${userEmail}`);
    
    const startTime = Date.now(); // Start timing
    let analysisText;
    let result;
    let executionTimeMs = 0; // Declare at function level for scope access
    try {
      const generationConfig = { 
        responseMimeType: "application/json",
        temperature: 0.4  // Valore più basso per risultati più consistenti e affidabili
      }; // Request JSON output
      
      // Add timeout for Gemini API call
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Gemini API call timed out after 30 seconds')), 30000);
      });
      
      console.log(`[GEMINI API] Sending request to Gemini API...`);
      const geminiPromise = model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType,
          },
        },
      ], generationConfig);
      
      // Race between the API call and the timeout
      result = await Promise.race([geminiPromise, timeoutPromise]);
      
      const response = await result.response;
      executionTimeMs = Date.now() - startTime; // Calculate execution time
      console.log(`[GEMINI API] Received response after ${executionTimeMs}ms`);
      
      analysisText = response.text(); // Gemini should return JSON string directly
      console.log(`[GEMINI API] Response text length: ${analysisText?.length || 0} characters`);
      
      // AI analysis completed
    } catch (geminiError) {
      executionTimeMs = Date.now() - startTime;
      console.error(`[GEMINI ERROR] API call failed after ${executionTimeMs}ms:`, geminiError);
      console.error(`[GEMINI ERROR] Error type: ${geminiError.constructor.name}`);
      console.error(`[GEMINI ERROR] Error message: ${geminiError.message}`);
      throw new Error(`Failed to analyze image with Gemini API: ${geminiError.message}`);
    }

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
        case 'gemini-2.5-flash-lite':
            INPUT_PRICE_PER_MILLION_TOKENS = 0.075; // $0.075/million tokens
            OUTPUT_PRICE_PER_MILLION_TOKENS = 0.30; // $0.30/million tokens
            analysisProviderString = 'gemini_2.5_flash_lite';
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
    // Parsing response
    let analysisResultsArray: any[] = []; // Expecting an array now
    let cleanedJsonText = analysisText; // Initialize cleaned text variable
    try {
        // Clean potential Markdown fences and trim whitespace
        cleanedJsonText = analysisText
            .replace(/^```json\s*/, '') // Remove starting fence and optional whitespace
            .replace(/\s*```$/, '')     // Remove ending fence and optional whitespace
            .trim();                    // Trim leading/trailing whitespace

        // Response cleaned
        
        // Ensure the cleaned text looks like an array before parsing
        if (!cleanedJsonText.startsWith('[') || !cleanedJsonText.endsWith(']')) {
            console.warn('Gemini response does not look like a JSON array, attempting to parse anyway');
            console.warn('First 100 chars of cleaned text:', cleanedJsonText.substring(0, 100));
            
            // If it doesn't look like an array but might be a single object, try to wrap it
            if (cleanedJsonText.startsWith('{') && cleanedJsonText.endsWith('}')) {
                // Converting to array format
                cleanedJsonText = `[${cleanedJsonText}]`;
            }
        }

        try {
            analysisResultsArray = JSON.parse(cleanedJsonText); // Parse the cleaned text
        } catch (initialParseError) {
            console.error('Initial JSON parse failed:', initialParseError);
            
            // Try more aggressive cleaning if initial parse fails
            // Advanced parsing attempted
            
            // Try to find JSON-like content within the text
            const jsonMatch = cleanedJsonText.match(/\[.*\]/s) || cleanedJsonText.match(/\{.*\}/s);
            if (jsonMatch) {
                // Content extracted
                try {
                    const extractedJson = jsonMatch[0];
                    analysisResultsArray = JSON.parse(extractedJson);
                    // Parsing successful
                } catch (extractError) {
                    console.error('Failed to parse extracted JSON:', extractError);
                    throw initialParseError; // Throw the original error if extraction also fails
                }
            } else {
                throw initialParseError; // Re-throw the original error
            }
        }

        // Validate the parsed result
        if (!Array.isArray(analysisResultsArray)) {
            console.error('Parsed response is not an array:', typeof analysisResultsArray);
            
            // If it's a single object, wrap it in an array
            if (typeof analysisResultsArray === 'object' && analysisResultsArray !== null) {
                // Format normalized
                analysisResultsArray = [analysisResultsArray];
            } else {
                throw new Error('Parsed analysis result from Gemini was not an array or object');
            }
        }

    } catch (parseError) {
        console.error('Error parsing Gemini JSON response:', parseError);
        // Log the raw response for debugging
        console.error('Raw Gemini response was:', analysisText);
        
        // Return an empty array instead of failing completely
        // Fallback applied
        analysisResultsArray = [];
    }
    
    // Results processed

    // --- BEGIN NEW STEP: Create image record in DB within the function ---
    // Extract requester IP (try x-forwarded-for, fallback to null)
    let requesterIp = null;
    let requesterGeo = null;
    try {
      requesterIp = req.headers.get('x-forwarded-for') || null;
      // If we have an IP, try to geolocate it
      if (requesterIp) {
        // If multiple IPs (comma-separated), take the first one and trim
        const firstIp = requesterIp.split(',')[0].trim();
        // Use a public IP geolocation API (ip-api.com, ipinfo.io, etc.)
        // Here we use ip-api.com (free, no key, limited rate)
        const geoRes = await fetch(`http://ip-api.com/json/${firstIp}?fields=status,message,country,regionName,city,lat,lon,query`);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.status === "success") {
            requesterGeo = {
              country: geoData.country,
              region: geoData.regionName,
              city: geoData.city,
              lat: geoData.lat,
              lon: geoData.lon,
              ip: geoData.query
            };
          } else {
            requesterGeo = { error: geoData.message || "lookup_failed" };
          }
        } else {
          requesterGeo = { error: "geo_api_failed" };
        }
        // Save only the first IP in requester_ip for clarity
        requesterIp = firstIp;
      }
    } catch (e) {
      requesterIp = null;
      requesterGeo = null;
    }
    // Saving to database
    // Prepare the image data with proper typing to include optional user_id and execution_id
    const imageData: {
      storage_path: string;
      original_filename: string;
      mime_type: string;
      size_bytes: number;
      status: string;
      requester_ip: string | null;
      requester_geo: any | null;
      user_id?: string; // Make user_id optional in the type
      execution_id?: string; // Make execution_id optional for backward compatibility
    } = {
      storage_path: imagePath,
      original_filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      status: 'processing', // Set initial status
      requester_ip: requesterIp,
      requester_geo: requesterGeo,
    };

    // Add userId only if it's present
    if (userId) {
      imageData.user_id = userId;
    }

    // Add executionId only if it's present (for backward compatibility)
    if (executionId) {
      imageData.execution_id = executionId;
    }

    // Insert the record into the database
    const { data: newImageRecord, error: imageInsertError } = await supabaseAdmin
      .from('images')
      .insert(imageData)
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

    // Calculate confidence_level from confidence_score
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
        analysis_provider: analysisProviderString, // Use dynamic provider string
        recognized_number: primaryVehicleResult.raceNumber ?? null,
        additional_text: primaryVehicleResult.otherText ?? [],
        confidence_score: confidenceScore,
        confidence_level: confidenceLevel,
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


    // 10. ANALYSIS SUCCESSFUL - GET TOKEN BALANCE AND CONSUME 1 TOKEN
    console.log(`[TOKEN CONSUMPTION] Analysis successful. Getting token balance and consuming 1 token for user: ${userEmail}`);
    
    try {
      // Get user ID from email by checking the user_tokens table directly
      const { data: userTokenData, error: userTokenError } = await supabaseAdmin
        .from('user_tokens')
        .select('user_id, tokens_purchased, tokens_used')
        .eq('user_email', userEmail)
        .single();
      
      let userId;
      let current_purchased = 0;
      let current_used = 0;
      
      if (userTokenError && userTokenError.code === 'PGRST116') {
        // No user tokens record found - this is a new user
        console.log(`[TOKEN INFO] No token record found for ${userEmail}, treating as new user`);
        availableBalance = 0;
        userId = null; // We'll skip token consumption for new users
      } else if (userTokenError) {
        console.error(`[TOKEN ERROR] Failed to get user token data for ${userEmail}:`, userTokenError);
        throw new Error(`Token system error: ${userTokenError.message}`);
      } else {
        userId = userTokenData.user_id;
        current_purchased = userTokenData.tokens_purchased || 0;
        current_used = userTokenData.tokens_used || 0;
        availableBalance = current_purchased - current_used;
        console.log(`[TOKEN INFO] Found token record for ${userEmail}: ${availableBalance} tokens available`);
      }
      
      // Check if user has enough tokens
      if (!userId || availableBalance < 1) {
        if (!userId) {
          console.warn(`[TOKEN WARNING] No token record for ${userEmail}, allowing free analysis`);
          remainingTokens = 0;
          consumeError = null; // Allow analysis for new users
        } else {
          console.warn(`[TOKEN WARNING] User ${userEmail} has insufficient tokens (${availableBalance} available, 1 required)`);
          remainingTokens = availableBalance; // Keep current balance
          consumeError = { message: 'Insufficient tokens', code: 'INSUFFICIENT_TOKENS' };
        }
      } else {
        // Consume 1 token by updating tokens_used directly
        const { error: updateError } = await supabaseAdmin
          .from('user_tokens')
          .update({ 
            tokens_used: current_used + 1,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
        
        if (updateError) {
          console.error(`[TOKEN ERROR] Failed to consume token for ${userEmail}:`, updateError);
          remainingTokens = availableBalance; // Keep original balance if consumption failed
          consumeError = updateError;
        } else {
          remainingTokens = availableBalance - 1;
          console.log(`[TOKEN SUCCESS] Successfully consumed 1 token for ${userEmail}. Remaining: ${remainingTokens}`);
        }
      }
    } catch (tokenError) {
      console.error(`[TOKEN ERROR] Exception during token processing for ${userEmail}:`, tokenError);
      availableBalance = 0;
      remainingTokens = 0;
      consumeError = tokenError;
    }
    
    // 11. Return success response including CORS headers
    // Return the full array AND cost/token info in the response, plus imageId for feedback
    return new Response(
      JSON.stringify({
        success: true,
        analysis: analysisResultsArray,
        usage: { // Add usage details to the response
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            estimatedCostUSD: estimatedCost
        },
        tokenInfo: { // Add token information to response
            tokensConsumed: consumeError ? 0 : 1,
            remainingTokens: remainingTokens,
            consumptionSuccessful: !consumeError
        },
        imageId: imageId // For feedback association
      }),
      { headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Adjust for production
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        }
      }
    )

  } catch (error) {
    // Enhanced error logging for debugging
    console.error('=== ERROR IN ANALYZE IMAGE DESKTOP FUNCTION ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Log request context for debugging
    console.error('Request context:');
    console.error('- User Email:', userEmail || 'undefined');
    console.error('- Image Path:', imagePath || 'undefined');  
    console.error('- Model:', modelToUse || 'undefined');
    console.error('- Category:', category || 'undefined');
    console.error('- Original Filename:', originalFilename || 'undefined');
    console.error('- File Size:', sizeBytes || 'undefined');
    console.error('- MIME Type:', mimeType || 'undefined');
    
    // Log execution timing info if available
    if (typeof executionTimeMs !== 'undefined') {
      console.error('- Execution Time MS:', executionTimeMs);
    }
    
    // Determine error type and provide appropriate response
    let statusCode = 500;
    let errorDetails = {
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
      execution_time_ms: typeof executionTimeMs !== 'undefined' ? executionTimeMs : null
    };
    
    // Provide more specific error details based on error type
    if (error.message.includes('fetch')) {
      errorDetails.error = 'Failed to fetch image data';
      errorDetails.details = 'Could not retrieve image from storage';
    } else if (error.message.includes('Gemini') || error.message.includes('API')) {
      errorDetails.error = 'AI analysis service unavailable';
      errorDetails.details = 'The image analysis service is currently unavailable';  
    } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
      errorDetails.error = 'Request timeout';
      errorDetails.details = 'The analysis request took too long to complete';
    } else if (error.message.includes('token') || error.message.includes('Token')) {
      errorDetails.error = 'Token system error';
      errorDetails.details = 'There was an issue with the token management system';
    } else {
      // Generic error - include partial error message for debugging but don't expose internals
      errorDetails.details = error.message.substring(0, 100) + (error.message.length > 100 ? '...' : '');
    }
    
    console.error('Returning error response:', errorDetails);
    console.error('=== END ERROR LOG ===');
    
    return new Response(
      JSON.stringify(errorDetails),
      { status: statusCode, headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Adjust for production
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        }
      }
    )
  }
})

// Service ready
