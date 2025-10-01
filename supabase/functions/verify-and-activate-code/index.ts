import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, User } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts'; // Assicurati che il percorso sia corretto

// Funzione helper per verificare se un utente esiste già in auth
async function checkUserExistsInAuth(supabaseAdmin: any, email: string): Promise<boolean> {
  try {
    const { data: existingUsers, error: findUserError } = await supabaseAdmin.auth.admin.listUsers({ 
      email: email 
    });
    
    if (findUserError) {
      console.error(`[AUTH ERROR] Error finding user ${email}:`, findUserError);
      return false;
    }

    return existingUsers && existingUsers.users && existingUsers.users.length > 0;
  } catch (error) {
    console.error(`[AUTH ERROR] Unexpected error checking user ${email}:`, error);
    return false;
  }
}

serve(async (req: Request) => {
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
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
       auth: {
         // Necessario per usare admin actions come createUser
         autoRefreshToken: false,
         persistSession: false
       }
    });

    // 1. Estrai e valida i dati dal body
    let accessCode: string | null = null;
    let email: string | null = null;
    let password: string | null = null;
    let mode: 'verify' | 'activate' = 'verify'; // Default a 'verify'
    let verificationToken: string | null = null;
    
    try {
      const body = await req.json();
      
      // Valida il codice di accesso
      if (!body?.accessCode || typeof body.accessCode !== 'string') {
        console.error(`[ERROR] Missing or invalid accessCode:`, body?.accessCode);
        throw new Error('Missing or invalid "accessCode" in request body.');
      }
      accessCode = body.accessCode;
      console.log(`[DEBUG] Extracted accessCode:`, accessCode);
      
      // Valida l'email
      if (!body?.email || typeof body.email !== 'string' || !body.email.includes('@')) {
        console.error(`[ERROR] Missing or invalid email:`, body?.email);
        throw new Error('Missing or invalid "email" in request body.');
      }
      email = body.email;
      console.log(`[DEBUG] Extracted email:`, email);
      
      // Valida la modalità
      if (body?.mode) {
        if (body.mode !== 'verify' && body.mode !== 'activate') {
          throw new Error('Invalid "mode" in request body. Must be "verify" or "activate".');
        }
        mode = body.mode;
      }
      
      // Se la modalità è 'activate', verifica la password
      if (mode === 'activate') {
        if (!body?.password || typeof body.password !== 'string' || body.password.length < 8) {
          throw new Error('Missing or invalid "password" in request body. Password must be at least 8 characters.');
        }
        password = body.password;
        
        // Verifica il token di verifica (opzionale)
        if (body?.verificationToken) {
          verificationToken = body.verificationToken;
        }
      }
      
    } catch (parseError) {
       return new Response(JSON.stringify({ error: 'Invalid request body.', details: parseError.message }), { 
         status: 400, 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       });
    }

    // 2. Cerca il codice nella tabella access_codes
    const { data: codeData, error: codeError } = await supabaseAdmin
      .from('access_codes')
      .select('id, subscriber_email, tokens_to_grant, status, is_used, expires_at, user_id_activated')
      .eq('code_value', accessCode)
      .maybeSingle();

    if (codeError) {
      console.error(`Error fetching access code ${accessCode}:`, codeError);
      throw new Error('Database error while verifying code.');
    }

    // 3. Valida il codice
    if (!codeData) {
      return new Response(JSON.stringify({ error: 'Invalid access code.' }), { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    // Verifica che l'email corrisponda
    if (codeData.subscriber_email !== email) {
      return new Response(JSON.stringify({ error: 'Email does not match the access code.' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    // Verifica che il codice non sia già stato usato
    if (codeData.is_used || codeData.status === 'activated') {
       return new Response(JSON.stringify({ error: 'Access code has already been used.' }), { 
         status: 410, 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       });
    }
    
    // Verifica che il codice non sia scaduto
    if (codeData.expires_at && new Date(codeData.expires_at) < new Date()) {
       // Aggiorna lo stato a 'expired'
       await supabaseAdmin.from('access_codes').update({ status: 'expired' }).eq('id', codeData.id);
       return new Response(JSON.stringify({ error: 'Access code has expired.' }), { 
         status: 410, 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       });
    }
    
    // Se c'è un user_id associato ma is_used è false, correggi lo stato
    if (codeData.user_id_activated && !codeData.is_used) {
       console.warn(`Code ${accessCode} (ID: ${codeData.id}) has user_id_activated but is_used is false. Auto-correcting...`);
       await supabaseAdmin
         .from('access_codes')
         .update({ is_used: true, status: 'activated' })
         .eq('id', codeData.id);
       // Continuiamo l'esecuzione normalmente...
    }

    // Estrai i dati necessari dal codice
    const userEmail = codeData.subscriber_email;
    const tokensToGrant = codeData.tokens_to_grant;
    const accessCodeId = codeData.id;

    // 4. Gestisci la modalità 'verify'
    if (mode === 'verify') {
      // Update registration status to 'code_verification'
      await supabaseAdmin.rpc('update_registration_status', {
        p_subscriber_email: userEmail,
        p_new_status: 'code_verification'
      });
      
      // In modalità 'verify', restituisci successo senza modificare lo stato del codice
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Access code verified successfully.',
        email: userEmail,
        verificationToken: accessCode
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 5. Gestisci la modalità 'activate'
    // A questo punto sappiamo che mode === 'activate' e password è definito
    
    // Update registration status to 'setting_password'
    await supabaseAdmin.rpc('update_registration_status', {
      p_subscriber_email: userEmail,
      p_new_status: 'setting_password'
    });

    try {
      // Prova a creare l'utente in Supabase Auth
      const { data: newUserResponse, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: userEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          source: 'access_code_activation'
        }
      });

      if (createUserError) {
        // Gestione errore 422 email_exists
        if (createUserError.status === 422 && createUserError.code === 'email_exists') {
          return new Response(JSON.stringify({
            error: 'User already exists',
            message: 'This email is already registered. Please login or reset your password.'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 409,
          });
        }
        // Altri errori
        console.error(`[AUTH ERROR] Error creating auth user for ${userEmail}:`, createUserError);
        throw new Error(`Failed to create user account: ${createUserError.message}`);
      }

      if (!newUserResponse || !newUserResponse.user) {
        console.error(`[AUTH ERROR] User creation succeeded but no user data returned`);
        throw new Error('User creation succeeded but no user data returned');
      }

      const authUser = newUserResponse.user;
      const authUserId = authUser.id;

      // Crea o aggiorna il record in user_tokens
      const { error: tokenInsertError } = await supabaseAdmin
        .from('user_tokens')
        .insert({
          user_id: authUserId,
          tokens_purchased: tokensToGrant,
          tokens_used: 0
        });

      // Gestisci il caso in cui l'utente esista già in user_tokens
      if (tokenInsertError && tokenInsertError.code !== '23505') { // Ignora errore di violazione UNIQUE
        console.error(`Error inserting user_tokens for user ${authUserId}:`, tokenInsertError);
        throw new Error(`Failed to grant tokens: ${tokenInsertError.message}`);
      } else if (tokenInsertError && tokenInsertError.code === '23505') {
        console.warn(`User ${authUserId} already exists in user_tokens. Updating tokens.`);
        // Aggiorna i token esistenti aggiungendo i nuovi chiamando la funzione RPC 'add_tokens'
        const { error: updateTokensError } = await supabaseAdmin.rpc('add_tokens', {
          p_user_id: authUserId,
          p_token_count: tokensToGrant,
          p_description: `Tokens granted from access code ${accessCode}`
        });
        if (updateTokensError) {
          console.error(`Error updating tokens for user ${authUserId}:`, updateTokensError);
          throw new Error(`Failed to update tokens: ${updateTokensError.message}`);
        }
      } else {
        // Tokens granted successfully
      }

      // Aggiorna lo stato del codice a 'activated'
      const { error: updateCodeError } = await supabaseAdmin
        .from('access_codes')
        .update({
          status: 'activated',
          is_used: true,
          used_at: new Date().toISOString(),
          user_id_activated: authUserId
        })
        .eq('id', accessCodeId);

      if (updateCodeError) {
        console.error(`CRITICAL: Failed to mark access code ${accessCodeId} as used for user ${authUserId}:`, updateCodeError);
        // Questo è problematico, ma continuiamo comunque
      }
      
      // Update registration status to 'active'
      await supabaseAdmin.rpc('update_registration_status', {
        p_subscriber_email: userEmail,
        p_new_status: 'active',
        p_user_id: authUserId
      });

      // Restituisci successo
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Account activated successfully!',
        userId: authUserId,
        email: userEmail
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } catch (activationError) {
      // Se qualcosa va storto durante l'attivazione, non segnare il codice come usato
      console.error(`Activation process failed for code ${accessCode} (ID: ${accessCodeId}):`, activationError);
      // Aggiorna lo stato del codice a 'activation_error'
      await supabaseAdmin.from('access_codes').update({ status: 'activation_error' }).eq('id', accessCodeId);
      return new Response(JSON.stringify({ 
        error: 'Failed to activate access.', 
        details: activationError.message 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

  } catch (error) {
    console.error('Error in verify-and-activate-code function:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'An unexpected error occurred.' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
