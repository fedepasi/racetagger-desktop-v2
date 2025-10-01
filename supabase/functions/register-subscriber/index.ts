import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

// Crea un client Supabase con la chiave di servizio per bypassare RLS
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

// Soglia di punteggio per considerare valida la verifica reCAPTCHA (0.0-1.0)
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
    // Extract URL parameters
    const url = new URL(req.url);
    const referralCodeFromUrl = url.searchParams.get('ref');
    
    // Estrai i dati dalla richiesta
    const { email, name, token, referralCode, company } = await req.json();
    
    // Determine the referral code to use (request body takes precedence over URL param)
    const finalReferralCode = referralCode || referralCodeFromUrl;
    
    if (!email || !name || !token) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Please fill in all required fields (email, name, and complete the verification). If you continue to experience issues, contact info@racetagger.cloud for assistance.',
          errorType: 'missing_fields'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Verifica il token reCAPTCHA
    console.log('Starting reCAPTCHA verification...');
    const recaptchaResult = await verifyRecaptcha(token);
    console.log('reCAPTCHA result:', recaptchaResult);
    
    if (!recaptchaResult.success) {
      console.log('reCAPTCHA verification failed:', recaptchaResult.error_codes);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Security verification failed. Please try refreshing the page and completing the verification again. If the problem persists, contact info@racetagger.cloud for assistance.',
          errorType: 'recaptcha_failed',
          details: recaptchaResult.error_codes || ['unknown error']
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    if (recaptchaResult.score && recaptchaResult.score < SCORE_THRESHOLD) {
      console.log('reCAPTCHA score too low:', recaptchaResult.score);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Security verification score too low. Please try again or contact info@racetagger.cloud if you continue to experience issues.',
          errorType: 'recaptcha_score_low',
          score: recaptchaResult.score
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Verifica se l'email è già registrata
    const { data: existingUser } = await supabaseAdmin
      .from('subscribers')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    
    if (existingUser) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'You have already registered with this email address! If you haven\'t received the confirmation email, please check your spam folder or contact info@racetagger.cloud for assistance.',
          errorType: 'duplicate_email'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Ottieni il conteggio attuale degli iscritti
    const { count } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true });
    
    const subscriberCount = count || 0;
    
    // Verifica se abbiamo già 50 iscritti
    if (subscriberCount >= 50) {
      // Aggiungi alla lista d'attesa
      const { data: waitingListEntry, error: waitingListError } = await supabaseAdmin
        .from('waiting_list')
        .insert([{ email, name, is_early_access: false }])
        .select()
        .single();
      
      if (waitingListError) throw waitingListError;
      
      // Sincronizza con Brevo
      await syncToBrevo(email, name, {
        EARLY_ACCESS: 'No',
        POSITION: 'Waiting List',
        SIGNUP_DATE: new Date().toISOString(),
        REFERRAL_CODE: finalReferralCode || 'None'
      });
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'The early access list is full. We have added you to the waiting list!',
          referralCode: finalReferralCode || null,
          waitingList: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Aggiungi alla lista degli iscritti
      const position = subscriberCount + 1;
      
      const { data: newSubscriber, error: subscriberError } = await supabaseAdmin
        .from('subscribers')
        .insert([{ email, name, position, company }])
        .select('*, referral_code, base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens')
        .single();
      
      if (subscriberError) throw subscriberError;
      
      // Process referral signup if referral code is provided
      let referralResult = null;
      if (finalReferralCode && newSubscriber) {
        try {
          const referralResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-referral-signup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              newSubscriberId: newSubscriber.id,
              referralCode: finalReferralCode,
              email: email,
              name: name,
              company: company
            })
          });
          
          if (referralResponse.ok) {
            referralResult = await referralResponse.json();
          } else {
            console.error('Referral processing failed:', await referralResponse.text());
          }
        } catch (error) {
          console.error('Error calling process-referral-signup:', error);
          // Continue with normal flow even if referral processing fails
        }
      }
      
      // Sincronizza con Brevo
      await syncToBrevo(email, name, {
        EARLY_ACCESS: 'Yes',
        POSITION: position.toString(),
        SIGNUP_DATE: new Date().toISOString(),
        REFERRAL_CODE: finalReferralCode || 'None'
      });
      
      // Invia email di conferma con referral code e bonus tokens
      try {
        const totalTokens = (newSubscriber.base_tokens || 1000) + (newSubscriber.bonus_tokens || 500) + (newSubscriber.earned_tokens || 0) + (newSubscriber.admin_bonus_tokens || 0);
        await sendConfirmationEmail(email, name, position, newSubscriber.referral_code, totalTokens);
      } catch (emailError) {
        console.error('Error sending confirmation email:', emailError);
        // Continue with registration even if email fails
      }
      
      // Prepare enhanced response with referral information
      const responseData = {
        success: true,
        message: referralResult?.message || `Thank you! You are #${position} in the early access list.`,
        position,
        subscriber: referralResult?.subscriber || newSubscriber,
        referral: referralResult?.referral || { processed: false, details: null },
        rewards: referralResult?.rewards || { 
          pendingFeedbackTokens: 0,
          totalBonusTokens: 1500,
          earlyAccessTokens: 1500 
        }
      };
      
      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error in register-subscriber:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'We encountered an unexpected error while processing your registration. Please try again in a few moments. If the problem persists, contact info@racetagger.cloud for assistance.',
        errorType: 'server_error'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Funzione per verificare il token reCAPTCHA
async function verifyRecaptcha(token: string): Promise<RecaptchaResponse> {
  const RECAPTCHA_SECRET_KEY = Deno.env.get('RECAPTCHA_SECRET_KEY') || '';
  
  if (!RECAPTCHA_SECRET_KEY) {
    console.error('RECAPTCHA_SECRET_KEY not found in environment variables');
    return { success: false, error_codes: ['missing-secret-key'] };
  }
  
  try {
    console.log('Sending request to Google reCAPTCHA API...');
    const verificationResponse = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        body: new URLSearchParams({
          secret: RECAPTCHA_SECRET_KEY,
          response: token
        })
      }
    );
    
    if (!verificationResponse.ok) {
      console.error('reCAPTCHA API returned non-200 status:', verificationResponse.status);
      return { success: false, error_codes: ['api-error'] };
    }
    
    const result = await verificationResponse.json();
    console.log('reCAPTCHA API response:', result);
    return result;
  } catch (error) {
    console.error('Error calling reCAPTCHA API:', error);
    return { success: false, error_codes: ['network-error'] };
  }
}

// Funzione per sincronizzare con Brevo
async function syncToBrevo(email: string, name: string, attributes: Record<string, string>) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
  const BREVO_LIST_ID = Deno.env.get('BREVO_LIST_ID') || '';
  
  // Configura la richiesta all'API di Brevo
  const response = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify({
      email,
      attributes: {
        FIRSTNAME: name?.split(' ')[0] || '',
        LASTNAME: name?.split(' ').slice(1).join(' ') || '',
        ...attributes
      },
      listIds: [parseInt(BREVO_LIST_ID)]
    })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    // Se il contatto esiste già, aggiorniamo solo le liste
    if (response.status === 400 && data.code === 'duplicate_parameter') {
      // Ottieni il contatto esistente
      const getContactResponse = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'api-key': BREVO_API_KEY
        }
      });
      
      if (getContactResponse.ok) {
        const contactData = await getContactResponse.json();
        
        // Aggiungi l'ID della lista se non è già presente
        const listIds = new Set([
          ...(contactData.listIds || []),
          parseInt(BREVO_LIST_ID)
        ]);
        
        // Aggiorna il contatto
        const updateResponse = await fetch(`https://api.brevo.com/v3/contacts`, {
          method: 'PUT',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'api-key': BREVO_API_KEY
          },
          body: JSON.stringify({
            email,
            attributes: {
              FIRSTNAME: name?.split(' ')[0] || contactData.attributes?.FIRSTNAME || '',
              LASTNAME: name?.split(' ').slice(1).join(' ') || contactData.attributes?.LASTNAME || '',
              ...attributes
            },
            listIds: Array.from(listIds)
          })
        });
        
        if (!updateResponse.ok) {
          throw new Error(`Failed to update contact in Brevo: ${await updateResponse.text()}`);
        }
      } else {
        throw new Error(`Failed to get contact from Brevo: ${await getContactResponse.text()}`);
      }
    } else {
      throw new Error(`Failed to add contact to Brevo: ${JSON.stringify(data)}`);
    }
  }
}

// Funzione per inviare l'email di conferma
async function sendConfirmationEmail(email: string, name: string, position: number, referralCode?: string, bonusTokens?: number) {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-confirmation-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        name,
        position,
        referralCode,
        bonusTokens
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to send confirmation email: ${JSON.stringify(errorData)}`);
    }
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    // Don't fail the whole registration if email fails
  }
}
