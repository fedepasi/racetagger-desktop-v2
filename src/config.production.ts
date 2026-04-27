// Production configuration - embedded credentials for packaged app
// These are safe to embed since they're public Supabase anon keys

export const PRODUCTION_CONFIG = {
  SUPABASE_URL: 'https://taompbzifylmdzgbbrpv.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8',
  // BREVO_API_KEY should be set via environment variable BREVO_API_KEY
  BREVO_API_KEY: process.env.BREVO_API_KEY || ''
};
