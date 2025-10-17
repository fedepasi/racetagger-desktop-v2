import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

// Create Supabase admin client with service role key to bypass RLS
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

// reCAPTCHA score threshold (0.0-1.0)
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const referralCodeFromUrl = url.searchParams.get('ref');

    const {
      email,
      name,
      password,
      token,
      referralCode,
      company,
      source
    } = await req.json();

    const finalReferralCode = referralCode || referralCodeFromUrl;

    if (!email || !name || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Please provide email, name, and password.',
          errorType: 'missing_fields'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (password.length < 8) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Password must be at least 8 characters long.',
          errorType: 'weak_password'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // reCAPTCHA verification (only for web registrations)
    if (source === 'web' && token) {
      const recaptchaResult = await verifyRecaptcha(token);
      if (!recaptchaResult.success || (recaptchaResult.score && recaptchaResult.score < SCORE_THRESHOLD)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security verification failed.',
            errorType: 'recaptcha_failed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
    }

    // Check duplicate email
    const { data: existingSubscriber } = await supabaseAdmin
      .from('subscribers')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (existingSubscriber) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Email already registered.',
          errorType: 'duplicate_email'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { count } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true });

    const position = (count || 0) + 1;

    // Create auth user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, source: source || 'unknown' }
    });

    if (authError || !authUser?.user) {
      throw new Error(`Failed to create user: ${authError?.message}`);
    }

    const authUserId = authUser.user.id;

    // Create subscriber
    const { data: newSubscriber, error: subscriberError } = await supabaseAdmin
      .from('subscribers')
      .insert([{
        email,
        name,
        position,
        company,
        user_id: authUserId,
        has_access: true,
        registration_status: 'active'
      }])
      .select('*, referral_code')
      .single();

    if (subscriberError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw subscriberError;
    }

    // Get signup bonus from system_config
    let signupBonusTokens = 500; // Default fallback changed to 500
    try {
      const { data: configData } = await supabaseAdmin
        .from('system_config')
        .select('value')
        .eq('key', 'signup_bonus_tokens')
        .single();

      if (configData?.value) {
        signupBonusTokens = parseInt(configData.value as string);
      }
    } catch (e) {
      console.warn('Using default signup bonus (500):', e);
    }

    // Assign tokens
    await supabaseAdmin
      .from('user_tokens')
      .insert({
        user_id: authUserId,
        tokens_purchased: signupBonusTokens,
        tokens_used: 0
      });

    // Track transaction
    await supabaseAdmin
      .from('token_transactions')
      .insert({
        user_id: authUserId,
        amount: signupBonusTokens,
        transaction_type: 'bonus',
        description: `Signup bonus - ${signupBonusTokens} free tokens`
      });

    // Process referral
    if (finalReferralCode) {
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-referral-signup`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            newSubscriberId: newSubscriber.id,
            referralCode: finalReferralCode,
            email,
            name,
            company
          })
        });
      } catch (e) {
        console.error('Referral processing failed:', e);
      }
    }

    // Send welcome email
    try {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-welcome-email-v2`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          name,
          tokens: signupBonusTokens,
          referralCode: newSubscriber.referral_code
        })
      });
    } catch (e) {
      console.error('Email sending failed:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Welcome to RaceTagger!',
        position,
        userId: authUserId,
        tokensGranted: signupBonusTokens
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Registration failed.',
        errorType: 'server_error'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

async function verifyRecaptcha(token: string): Promise<RecaptchaResponse> {
  const RECAPTCHA_SECRET_KEY = Deno.env.get('RECAPTCHA_SECRET_KEY') || '';
  if (!RECAPTCHA_SECRET_KEY) {
    return { success: false, error_codes: ['missing-secret-key'] };
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token
      })
    });

    return await response.json();
  } catch (error) {
    return { success: false, error_codes: ['network-error'] };
  }
}
