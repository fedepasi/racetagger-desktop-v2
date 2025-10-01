import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';

// Ottieni la chiave segreta dalle variabili d'ambiente
const RECAPTCHA_SECRET_KEY = Deno.env.get('RECAPTCHA_SECRET_KEY') || '6LeygDErAAAAAMKQ2c9GbbqsZuTeAMib2WcRNJhs';

// Soglia di punteggio per considerare valida la verifica (0.0-1.0)
const SCORE_THRESHOLD = 0.5;

interface RecaptchaResponse {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  error_codes?: string[];
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    // Estrai il token e l'azione dal corpo della richiesta
    const { token, action } = await req.json();
    
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token mancante' }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Prepara i dati per la verifica con l'API di Google reCAPTCHA
    const formData = new FormData();
    formData.append('secret', RECAPTCHA_SECRET_KEY);
    formData.append('response', token);
    
    // Ottieni l'IP del client se disponibile
    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
    if (clientIp) {
      formData.append('remoteip', clientIp);
    }
    
    // Invia la richiesta all'API di Google reCAPTCHA
    const verificationResponse = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        body: new URLSearchParams({
          secret: RECAPTCHA_SECRET_KEY,
          response: token,
          ...(clientIp ? { remoteip: clientIp } : {})
        })
      }
    );
    
    // Analizza la risposta
    const recaptchaResult: RecaptchaResponse = await verificationResponse.json();
    
    // Verifica il punteggio e l'azione
    const isValidScore = recaptchaResult.score && recaptchaResult.score >= SCORE_THRESHOLD;
    const isValidAction = !action || (recaptchaResult.action && recaptchaResult.action === action);
    
    // Restituisci il risultato
    return new Response(
      JSON.stringify({ 
        success: recaptchaResult.success && isValidScore && isValidAction,
        score: recaptchaResult.score,
        action: recaptchaResult.action,
        ...(recaptchaResult.error_codes ? { errors: recaptchaResult.error_codes } : {})
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error verifying reCAPTCHA:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: 'Errore durante la verifica del reCAPTCHA' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
