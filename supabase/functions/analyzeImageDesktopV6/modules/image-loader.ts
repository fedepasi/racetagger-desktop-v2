/**
 * Image Loader Module
 *
 * Loads images from Supabase Storage and converts to base64.
 * This enables V6 to work with the V3-compatible payload format
 * where Desktop sends `imagePath` instead of base64 data.
 *
 * Pattern based on V3 edge function (lines 97-128).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { LOG_PREFIX } from '../config/constants.ts';

const BUCKET_NAME = 'uploaded-images';
const SIGNED_URL_EXPIRY = 60 * 5; // 5 minutes

/**
 * Load an image from Supabase Storage and convert to base64
 *
 * @param imagePath - Path in the Storage bucket (e.g., "1703156789_abc123.jpg")
 * @returns Base64 encoded image data
 */
export async function loadImageFromStorage(imagePath: string): Promise<string> {
  console.log(`${LOG_PREFIX} [ImageLoader] Loading image from storage: ${imagePath}`);
  const loadStart = Date.now();

  // 1. Initialize Supabase client with service role
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2. Create signed URL for the image
  const { data: signedUrlData, error: signedUrlError } = await supabase
    .storage
    .from(BUCKET_NAME)
    .createSignedUrl(imagePath, SIGNED_URL_EXPIRY);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error(`Error creating signed URL for ${imagePath}: ${signedUrlError?.message || 'No URL returned'}`);
  }

  // 3. Fetch image from signed URL
  const response = await fetch(signedUrlData.signedUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image ${imagePath}: ${response.status} ${response.statusText}`);
  }

  // 4. Convert to base64
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Build binary string for base64 encoding
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  const base64 = btoa(binary);

  const loadDuration = Date.now() - loadStart;
  const sizeKB = (arrayBuffer.byteLength / 1024).toFixed(1);

  console.log(`${LOG_PREFIX} [ImageLoader] Image loaded: ${sizeKB}KB in ${loadDuration}ms`);

  return base64;
}
