import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts'; // Assicurati che il percorso sia corretto
import { getSignupBonusTokens } from '../_shared/get-signup-bonus.ts';

// --- Funzione Helper per generare codice casuale ---
// Semplice implementazione, considera librerie più robuste se necessario
function generateAccessCode(length = 12): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// --- Funzione Helper per inviare email (adattata da register-subscriber) ---
async function sendAccessGrantedEmail(email: string, name: string | null, accessCode: string, tokensGranted: number) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
  const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL') || 'noreply@racetagger.cloud'; // Usa un default sensato
  const ACTIVATE_ACCESS_URL = Deno.env.get('ACTIVATE_ACCESS_PAGE_URL') || 'https://www.racetagger.cloud/activate-access'; // URL della pagina di attivazione

  if (!BREVO_API_KEY) {
    console.error('Missing BREVO_API_KEY environment variable.');
    throw new Error('Brevo API Key is not configured.');
  }

  const recipientName = name || 'Racer'; // Usa un fallback se il nome non c'è

  // Configura la richiesta all'API di Brevo per inviare l'email
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        name: 'RaceTagger Team',
        email: SMTP_FROM_EMAIL
      },
      to: [
        {
          email,
          name: recipientName
        }
      ],
      subject: 'Your RaceTagger Demo Access Code!',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Welcome to the RaceTagger Demo!</h2>
          <p>Hello ${recipientName},</p>
          <p>You've been granted access to the RaceTagger demo. You have been assigned <strong>${tokensGranted} tokens</strong> to get started.</p>
          <p>To activate your access, please use the following code:</p>
          <p style="font-size: 1.5em; font-weight: bold; text-align: center; margin: 20px 0; letter-spacing: 2px;">${accessCode}</p>
          <p>Enter this code on the activation page:</p>
          <p style="text-align: center; margin: 20px 0;">
            <a href="${ACTIVATE_ACCESS_URL}?email=${email}&code=${accessCode}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Activate Access Now</a>
          </p>
          <p>If the button doesn't work, copy and paste this URL into your browser: ${ACTIVATE_ACCESS_URL}?email=${email}&code=${accessCode}</p>
          <p>We're excited for you to try RaceTagger!</p>
          <p>Best regards,<br>The RaceTagger Team</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error(`Failed to send access email to ${email}:`, JSON.stringify(errorData));
    
    // Verifica se l'errore è relativo all'IP non autorizzato
    if (errorData.message && errorData.message.includes('unrecognised IP address')) {
      const ipMatch = errorData.message.match(/unrecognised IP address ([^\s]+)/);
      const ipAddress = ipMatch ? ipMatch[1] : 'unknown';
      
      throw new Error(`Email not sent: unauthorized IP (${ipAddress}). Administrator must add this IP in Brevo: https://app.brevo.com/security/authorised_ips`);
    }
    
    throw new Error(`Failed to send access email: ${errorData.message || response.statusText}`);
  }
  console.log(`Access email successfully sent to ${email}`);
}


// --- Funzione Principale ---
serve(async (req: Request) => {
  console.log('[PROCESS-ACCESS-GRANTS] Function execution started.'); // LOG INIZIALE

  // Gestione della richiesta preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Accetta solo richieste POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase URL or Service Role Key environment variables.');
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 1. Autenticazione dell'utente come admin (come in get-registrants)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication failed', details: userError?.message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (adminCheckError) throw adminCheckError;
    if (!adminUser) {
      return new Response(JSON.stringify({ error: 'Access denied: User is not an administrator.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const adminUserId = user.id; // ID dell'admin che esegue l'azione

    // 2. Estrai e valida i dati dal body
    let registrantEmails: string[] = [];
    let tokensToGrant: number = 1000; // Default
    
    console.log('[PROCESS-ACCESS-GRANTS] Authenticating admin and preparing to read body.');
    console.log('[PROCESS-ACCESS-GRANTS] Request Method:', req.method);
    console.log('[PROCESS-ACCESS-GRANTS] Content-Type header:', req.headers.get('content-type'));
    console.log('[PROCESS-ACCESS-GRANTS] Content-Length header:', req.headers.get('content-length'));
    
    try {
      console.log('[PROCESS-ACCESS-GRANTS] Attempting to read request body.');
      
      // Approccio più robusto per leggere il corpo della richiesta
      let body;
      
      // Metodo 1: Prova a leggere direttamente come JSON
      try {
        body = await req.json();
        console.log('[PROCESS-ACCESS-GRANTS] Successfully read body as JSON:', body);
      } catch (jsonError) {
        console.log('[PROCESS-ACCESS-GRANTS] Failed to read as JSON, trying text method:', jsonError);
        
        // Metodo 2: Se fallisce, prova a leggere come testo e poi fare il parsing
        try {
          const rawBody = await req.text();
          console.log('[PROCESS-ACCESS-GRANTS] Raw request body string:', rawBody);
          
          if (!rawBody || rawBody.trim() === "") {
            throw new Error('Request body is empty after text() method.');
          }
          
          body = JSON.parse(rawBody);
          console.log('[PROCESS-ACCESS-GRANTS] Successfully parsed text body:', body);
        } catch (textError) {
          console.log('[PROCESS-ACCESS-GRANTS] Failed to read as text or parse:', textError);
          
          // Metodo 3: Ultimo tentativo con un approccio manuale usando ReadableStream
          try {
            const reader = req.body?.getReader();
            if (!reader) throw new Error('Request body is not readable');
            
            let result = '';
            let done = false;
            
            while (!done) {
              const { value, done: doneReading } = await reader.read();
              done = doneReading;
              if (value) {
                result += new TextDecoder().decode(value);
              }
            }
            
            console.log('[PROCESS-ACCESS-GRANTS] Raw body from stream:', result);
            
            if (!result || result.trim() === "") {
              throw new Error('Request body is empty after stream reading.');
            }
            
            body = JSON.parse(result);
            console.log('[PROCESS-ACCESS-GRANTS] Successfully parsed stream body:', body);
          } catch (streamError) {
            console.log('[PROCESS-ACCESS-GRANTS] All body reading methods failed:', streamError);
            throw new Error('Failed to read request body after multiple attempts.');
          }
        }
      }

      if (!Array.isArray(body?.registrantEmails) || body.registrantEmails.length === 0) {
        throw new Error('Missing or invalid "registrantEmails" array in request body.');
      }
      registrantEmails = body.registrantEmails;
      // Valida emails (semplice check)
      registrantEmails = registrantEmails.filter(email => typeof email === 'string' && email.includes('@'));
      if (registrantEmails.length === 0) {
         throw new Error('No valid emails provided in "registrantEmails".');
      }

      if (body?.tokensToGrant !== undefined) {
        if (typeof body.tokensToGrant !== 'number' || !Number.isInteger(body.tokensToGrant) || body.tokensToGrant < 0) {
          throw new Error('"tokensToGrant" must be a non-negative integer.');
        }
        tokensToGrant = body.tokensToGrant;
      }
    } catch (parseError) {
       console.error('process-access-grants: Error parsing or validating body:', parseError);
       return new Response(JSON.stringify({ error: 'Invalid request body.', details: parseError.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // 3. Processa ogni email
    const results: { email: string; success: boolean; message: string; code?: string }[] = [];

    for (const email of registrantEmails) {
      try {
        // TODO: Aggiungere logica per verificare se l'utente è già stato invitato o è attivo?
        // Esempio:
        // const { data: existingCode } = await supabaseAdmin.from('access_codes').select('id').eq('subscriber_email', email).eq('is_used', false).maybeSingle();
        // if (existingCode) {
        //   results.push({ email, success: false, message: 'User already has an active invite code.' });
        //   continue;
        // }
        // const { data: existingActiveUser } = await supabaseAdmin.from('access_codes').select('id').eq('subscriber_email', email).eq('is_used', true).maybeSingle();
        // if (existingActiveUser) {
        //   results.push({ email, success: false, message: 'User has already activated access.' });
        //   continue;
        // }

        // Genera codice univoco (potrebbe essere necessario un loop per garantire l'unicità se c'è molto traffico)
        let accessCode = generateAccessCode();
        // TODO: Aggiungere un controllo opzionale per verificare se il codice esiste già nel DB e rigenerare se necessario.

        // NEW TOKEN LOGIC: Access approval grants signup bonus tokens from system_config
        // Earned tokens (referrals/feedback) are handled separately
        const GIFT_TOKENS = await getSignupBonusTokens(supabaseAdmin);
        
        // Recupera il nome dell'utente (no token calculation needed here)
        const { data: registrantData } = await supabaseAdmin
          .from('subscribers') // Cerca prima in subscribers
          .select('name')
          .eq('email', email)
          .maybeSingle();
        
        let registrantName = registrantData?.name;
        
        if (!registrantData) {
          // Se non è in subscribers, cerca in waiting_list
          const { data: waitingListData } = await supabaseAdmin
            .from('waiting_list')
            .select('name')
            .eq('email', email)
            .maybeSingle();
          registrantName = waitingListData?.name;
        }
        
        console.log(`[DEBUG] Access approval for ${email}:`);
        console.log(`- Granting ${GIFT_TOKENS} gift tokens`);
        console.log(`- User will keep any existing earned tokens separate`);

        // Salva il codice nel database con 1500 gift tokens standard
        const { data: newCodeData, error: insertError } = await supabaseAdmin
          .from('access_codes')
          .insert({
            subscriber_email: email,
            code_value: accessCode,
            tokens_to_grant: GIFT_TOKENS, // Always 1500 gift tokens
            status: 'pending_email', // Stato iniziale
            granted_by_admin_id: adminUserId
          })
          .select('id') // Restituisce l'ID per riferimento
          .single(); // Assicura che venga inserito un solo record

        if (insertError) {
          console.error(`Error inserting access code for ${email}:`, insertError);
          throw new Error(`Database error while saving code: ${insertError.message}`);
        }
        const accessCodeId = newCodeData.id;

        // Use new grant_gift_tokens function to properly grant access + 1500 tokens
        const { error: grantTokensError } = await supabaseAdmin.rpc('grant_gift_tokens', {
          p_user_email: email,
          p_admin_user_id: adminUserId
        });
        
        if (grantTokensError) {
          console.error(`Error granting gift tokens for ${email}:`, grantTokensError);
          throw new Error(`Failed to grant gift tokens: ${grantTokensError.message}`);
        }
        
        // Update access_code after successful token granting
        const { error: updateSubscriberError } = await supabaseAdmin
          .from('subscribers')
          .update({ access_code: accessCode })
          .eq('email', email);

        if (updateSubscriberError) {
          console.warn(`Failed to update access_code in subscribers table for ${email}:`, updateSubscriberError.message);
          // Prova ad aggiornare waiting_list se non trovato in subscribers o c'è stato un errore
          const { error: updateWaitingListError } = await supabaseAdmin
            .from('waiting_list')
            .update({ access_code: accessCode }) // Assumendo che waiting_list abbia un campo access_code, altrimenti va adattato
            .eq('email', email);
          if (updateWaitingListError) {
            console.warn(`Failed to update access_code in waiting_list table for ${email}:`, updateWaitingListError.message);
            // Non bloccare il processo per questo, ma loggare l'errore
          }
        }


        // Invia l'email di notifica con i gift tokens
        try {
          await sendAccessGrantedEmail(email, registrantName, accessCode, GIFT_TOKENS);
          
          // Aggiorna lo stato del codice a 'email_sent' dopo l'invio riuscito
          const { error: updateStatusError } = await supabaseAdmin
            .from('access_codes')
            .update({ status: 'email_sent' })
            .eq('id', accessCodeId);
            
          if (updateStatusError) {
             console.warn(`Failed to update access code status to 'email_sent' for ${email} (ID: ${accessCodeId}):`, updateStatusError);
             // Non trattare questo come un errore fatale per l'utente, l'email è partita
          }
          
          results.push({ email, success: true, message: `Access granted with ${GIFT_TOKENS} gift tokens. Any existing earned tokens preserved. Email sent successfully.`, code: accessCode });

        } catch (emailError) {
           // Se l'invio email fallisce, registra l'errore ma considera l'operazione parzialmente riuscita (codice generato e utente aggiornato)
           console.error(`Failed to send email for ${email} (Code ID: ${accessCodeId}):`, emailError);
           // Aggiorna lo stato del codice a 'email_error'
           await supabaseAdmin.from('access_codes').update({ status: 'email_error' }).eq('id', accessCodeId);
           results.push({ email, success: false, message: `Access granted with ${GIFT_TOKENS} gift tokens, but failed to send email: ${emailError.message}`, code: accessCode });
        }
        
        // Registration status updated above with access_code update

      } catch (processError) {
        console.error(`Error processing access grant for ${email}:`, processError);
        results.push({ email, success: false, message: processError.message });
      }
    }

    // 4. Restituisci i risultati
    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, // Anche se ci sono errori parziali, la richiesta è stata processata
    });

  } catch (error) {
    console.error('Error in process-access-grants function:', error);
    return new Response(JSON.stringify({ error: error.message || 'An unexpected error occurred.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
