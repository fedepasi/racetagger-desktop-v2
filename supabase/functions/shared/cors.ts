// CORS headers for Edge Functions
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Allow all origins to fix CORS issues
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, Cache-Control, pragma, Pragma',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};
