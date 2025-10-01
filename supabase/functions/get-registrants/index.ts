import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, Cache-Control, pragma, Pragma',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

interface Subscriber {
  id: string;
  email: string | null;
  name: string | null;
  position: number | null;
  signup_date: string | null;
  has_access: boolean | null;
  access_code: string | null;
  referral_source: string | null;
  bonus_tokens?: number | null;
  status?: string | null;
  tokens_to_grant?: number | null;
  tokens_used?: number | null;
  tokens_remaining?: number | null;
  registration_status?: string | null;
  code_verification_started_at?: string | null;
  password_setup_started_at?: string | null;
  registration_completed_at?: string | null;
  last_activity_at?: string | null;
}

interface WaitingListUser {
  id: string;
  email: string | null;
  name:string | null;
  signup_date: string | null;
  is_early_access: boolean | null; // Questo potrebbe indicare se sono stati promossi
}

serve(async (req: Request) => {
  // Gestione della richiesta preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase URL or Service Role Key environment variables.');
    }

    // Crea un client Supabase con privilegi di servizio per bypassare RLS se necessario per leggere admin_users,
    // ma l'autenticazione dell'utente chiamante viene fatta prima.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 1. Autenticazione dell'utente come admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Authentication failed', details: userError?.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // 2. Verifica se l'utente è un admin
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminCheckError) {
      console.error('Error checking admin status:', adminCheckError);
      throw adminCheckError;
    }

    if (!adminUser) {
      return new Response(JSON.stringify({ error: 'Access denied: User is not an administrator.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403, // Forbidden
      });
    }

    // 3. Recupera i dati da 'subscribers' with complete token fields
    const { data: subscribersData, error: subscribersError } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, name, position, signup_date, has_access, access_code, referral_source, base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens, registration_status, code_verification_started_at, password_setup_started_at, registration_completed_at, last_activity_at')
      .order('position', { ascending: true });

    if (subscribersError) {
      console.error('Error fetching subscribers:', subscribersError);
      throw subscribersError;
    }
    
      // 3b. Efficient data enrichment
    const accessCodes = (subscribersData || []).map(s => s.access_code).filter(Boolean);
    
    const { data: accessCodeDetails, error: accessCodeError } = await supabaseAdmin
      .from('access_codes')
      .select('code_value, status, tokens_to_grant, user_id_activated')
      .in('code_value', accessCodes);

    if (accessCodeError) {
      console.error('Error fetching access code details:', accessCodeError);
      throw accessCodeError;
    }

    const userIds = accessCodeDetails.map(ac => ac.user_id_activated).filter(Boolean);
    
    const { data: tokenDetails, error: tokenError } = await supabaseAdmin
      .from('user_tokens')
      .select('user_id, tokens_purchased, tokens_used')
      .in('user_id', userIds);

    if (tokenError) {
      console.error('Error fetching token details:', tokenError);
      throw tokenError;
    }

    const accessCodeMap = new Map(accessCodeDetails.map(ac => [ac.code_value, ac]));
    const tokenMap = new Map(tokenDetails.map(td => [td.user_id, td]));

    const enrichedSubscribers = (subscribersData || []).map(sub => {
      const accessCodeInfo = sub.access_code ? accessCodeMap.get(sub.access_code) : null;
      const userInfo = accessCodeInfo?.user_id_activated ? tokenMap.get(accessCodeInfo.user_id_activated) : null;

      // COMPLETE TOKEN LOGIC: All token types
      const base_tokens = sub.base_tokens || 1000;
      const bonus_tokens = sub.bonus_tokens || 500;
      const earned_tokens = sub.earned_tokens || 0;
      const admin_bonus_tokens = sub.admin_bonus_tokens || 0;
      
      // Calculate totals
      const total_available = base_tokens + bonus_tokens + earned_tokens + admin_bonus_tokens;
      const tokens_used = userInfo?.tokens_used ?? 0;
      const tokens_remaining = Math.max(total_available - tokens_used, 0);

      return {
        ...sub,
        status: accessCodeInfo?.status ?? 'pending_email',
        // Complete token structure
        base_tokens: base_tokens,
        bonus_tokens: bonus_tokens,
        earned_tokens: earned_tokens,
        admin_bonus_tokens: admin_bonus_tokens,
        // Display fields
        bonus_credits: bonus_tokens + earned_tokens + admin_bonus_tokens, // All bonus types combined
        total_credits: total_available,
        // Legacy compatibility
        tokens_to_grant: total_available,
        tokens_used: tokens_used,
        tokens_remaining: tokens_remaining,
      };
    });

    // 4. Recupera i dati da 'waiting_list'
    const { data: waitingListData, error: waitingListError } = await supabaseAdmin
      .from('waiting_list')
      .select('id, email, name, signup_date, is_early_access')
      .order('signup_date', { ascending: true });

    if (waitingListError) {
      console.error('Error fetching waiting list:', waitingListError);
      throw waitingListError;
    }
    
    const responsePayload = {
      subscribers: enrichedSubscribers as Subscriber[] || [],
      waitingList: waitingListData as WaitingListUser[] || [],
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error in get-registrants function:', error);
    return new Response(JSON.stringify({ error: error.message || 'An unexpected error occurred.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
