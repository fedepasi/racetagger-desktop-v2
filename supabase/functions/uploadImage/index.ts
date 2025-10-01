import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

console.log('uploadImage function starting up')

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin': '*', // Adjust for production
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }})
  }

  try {
    // Create a Supabase client with the service role key that bypasses RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    console.log('Supabase admin client created')

    // Accetta application/json invece di multipart/form-data
    let requestData;
    try {
      requestData = await req.json();
      console.log("Received request data:", JSON.stringify(requestData, null, 2));
    } catch (e) {
      console.error("Error parsing request JSON:", e);
      throw new Error('Expected JSON request: ' + e.message);
    }

    const { fileBase64, fileName, fileType, fileSize } = requestData;
    
    if (!fileBase64 || !fileName || !fileType) {
      throw new Error('Missing required fields: fileBase64, fileName, fileType');
    }

    // Decodifica il file da base64
    const base64Data = fileBase64.split(';base64,').pop();
    if (!base64Data) {
      throw new Error('Invalid base64 data');
    }

    // Converti da base64 a Uint8Array
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Genera un nome file univoco usando UUID
    const fileExt = fileName.split('.').pop();
    const uniqueFileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = uniqueFileName;

    console.log(`Uploading ${fileName} to ${filePath}...`);

    // Upload del file usando il client admin che bypassa RLS
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('uploaded-images')
      .upload(filePath, binaryData, {
        contentType: fileType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload Error:', uploadError)
      throw new Error(`Upload failed: ${uploadError.message}`)
    }

    console.log('Upload successful:', filePath)

    // Estrai info richiedente per salvataggio log
    let requesterIp = null
    let requesterGeo = null
    try {
      requesterIp = req.headers.get('x-forwarded-for') || null
      // Se c'è un IP, prova a geolocalizzarlo
      if (requesterIp) {
        // Se IP multipli (comma-separated), prendi solo il primo
        const firstIp = requesterIp.split(',')[0].trim()
        // Usa un'API pubblica di geolocalizzazione IP
        const geoRes = await fetch(`http://ip-api.com/json/${firstIp}?fields=status,message,country,regionName,city,lat,lon,query`)
        if (geoRes.ok) {
          const geoData = await geoRes.json()
          if (geoData.status === "success") {
            requesterGeo = {
              country: geoData.country,
              region: geoData.regionName,
              city: geoData.city,
              lat: geoData.lat,
              lon: geoData.lon,
              ip: geoData.query
            }
          }
        }
        requesterIp = firstIp
      }
    } catch (e) {
      console.error('Error getting geolocation:', e)
      requesterIp = null
      requesterGeo = null
    }

    // Restituisci i dettagli del file caricato
    return new Response(
      JSON.stringify({
        success: true,
        filePath: filePath,
        originalFilename: fileName,
        mimeType: fileType,
        sizeBytes: fileSize,
        requesterIp: requesterIp,
        requesterGeo: requesterGeo
      }),
      { 
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Adjust for production
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        } 
      }
    )

  } catch (error) {
    console.error('Error in uploadImage function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Adjust for production
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control',
        } 
      }
    )
  }
})

console.log('uploadImage function initialized')
