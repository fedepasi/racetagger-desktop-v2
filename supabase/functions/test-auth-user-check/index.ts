// supabase/functions/test-auth-user-check/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts'; // Assumendo che tu abbia cors.ts in shared

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase URL or Service Role Key');
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const requestBody = await req.json();
    const emailToTest = requestBody.email;

    if (!emailToTest || typeof emailToTest !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid "email" in request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = emailToTest.toLowerCase();
    console.log(`[TEST_AUTH_CHECK] Testing email: ${emailToTest}, Normalized: ${normalizedEmail}`);

    // Usa l'API admin per cercare l'utente per email
    const { data: usersData, error: adminError } = await supabaseAdmin.auth.admin.listUsers({ email: normalizedEmail });
    console.log(`[TEST_AUTH_CHECK] listUsers result:`, JSON.stringify(usersData, null, 2));
    if (adminError) {
      console.error(`[TEST_AUTH_CHECK] Admin API error for ${normalizedEmail}:`, adminError);
      return new Response(JSON.stringify({
        error: 'Admin API error',
        details: adminError
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let userRecord = null;
    let userExistsAndIsActive = false;
    if (usersData && usersData.users && usersData.users.length > 0) {
      // Cerca la corrispondenza esatta (case-insensitive) tra le email
      userRecord = usersData.users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
      userExistsAndIsActive = !!(userRecord && userRecord.email_confirmed_at);
    }

    console.log(`[TEST_AUTH_CHECK] User record for ${normalizedEmail}:`, userRecord);
    console.log(`[TEST_AUTH_CHECK] Exists and active? ${userExistsAndIsActive}`);

    return new Response(JSON.stringify({
      emailTested: emailToTest,
      normalizedEmail: normalizedEmail,
      userRecord: userRecord || null,
      existsAndIsActive: userExistsAndIsActive,
      message: userRecord ? `User record found.` : `No user record found for ${normalizedEmail}.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('[TEST_AUTH_CHECK] Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Unexpected error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
