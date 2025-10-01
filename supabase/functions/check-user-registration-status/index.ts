// Edge Function: check-user-registration-status
// Purpose: Check if a user email is already registered and return their status
// Used by: Popup post-feedback to determine if user needs registration

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, Cache-Control, pragma, Pragma',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

interface RequestBody {
  email: string;
  sessionId?: string;
}

interface UserStatus {
  isRegistered: boolean;
  hasAccess: boolean;
  approvalStatus?: string;
  bonusTokens?: number;
  totalReferrals?: number;
  canEarnTokens: boolean;
  registrationStep?: 'not_registered' | 'pending_approval' | 'approved' | 'activated';
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { email, sessionId }: RequestBody = await req.json()

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check if user exists in subscribers table
    const { data: subscriber, error: subscriberError } = await supabaseClient
      .from('subscribers')
      .select(`
        id,
        email,
        has_access,
        approval_status,
        base_tokens,
        bonus_tokens,
        earned_tokens,
        admin_bonus_tokens,
        total_referrals,
        user_id,
        signup_date
      `)
      .eq('email', email.toLowerCase().trim())
      .single()

    if (subscriberError && subscriberError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is expected for non-registered users
      throw subscriberError
    }

    // Check feedback history for this email/session
    const { data: feedbackHistory, error: feedbackError } = await supabaseClient
      .from('image_feedback')
      .select('id, tokens_earned, admin_approved, submitted_at')
      .or(`user_email.eq.${email},session_id.eq.${sessionId || ''}`)
      .order('submitted_at', { ascending: false })

    if (feedbackError) {
      console.error('Error fetching feedback history:', feedbackError)
    }

    // Count pending feedback rewards
    const pendingFeedback = feedbackHistory?.filter(f => f.admin_approved === null) || []
    const approvedFeedback = feedbackHistory?.filter(f => f.admin_approved === true) || []
    const totalTokensEarned = approvedFeedback.reduce((sum, f) => sum + (f.tokens_earned || 0), 0)

    // Determine user status
    let userStatus: UserStatus

    if (!subscriber) {
      // User not registered
      userStatus = {
        isRegistered: false,
        hasAccess: false,
        canEarnTokens: true, // Can earn tokens that will be credited when they register
        registrationStep: 'not_registered'
      }
    } else {
      // User is registered
      const isActivated = !!subscriber.user_id
      
      userStatus = {
        isRegistered: true,
        hasAccess: subscriber.has_access,
        approvalStatus: subscriber.approval_status,
        bonusTokens: (subscriber.base_tokens || 1000) + (subscriber.bonus_tokens || 500) + (subscriber.earned_tokens || 0) + (subscriber.admin_bonus_tokens || 0),
        totalReferrals: subscriber.total_referrals,
        canEarnTokens: true,
        registrationStep: isActivated ? 'activated' : 
                         subscriber.approval_status === 'pending' ? 'pending_approval' : 'approved'
      }
    }

    // Prepare response
    const response = {
      success: true,
      userStatus,
      feedbackStats: {
        totalFeedbackSubmitted: feedbackHistory?.length || 0,
        pendingFeedbackCount: pendingFeedback.length,
        approvedFeedbackCount: approvedFeedback.length,
        totalTokensEarned,
        canSubmitMoreFeedback: true // Could add rate limiting logic here
      },
      incentives: {
        tokensPerFeedback: 5,
        referralBonus: 50,
        earlyAccessTokens: 1500
      }
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in check-user-registration-status:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

/* Test cases for this function:

1. Non-registered user with no feedback:
POST /functions/v1/check-user-registration-status
{
  "email": "newuser@example.com",
  "sessionId": "session_123"
}

Expected response:
{
  "success": true,
  "userStatus": {
    "isRegistered": false,
    "hasAccess": false,
    "canEarnTokens": true,
    "registrationStep": "not_registered"
  },
  "feedbackStats": {
    "totalFeedbackSubmitted": 0,
    "pendingFeedbackCount": 0,
    "approvedFeedbackCount": 0,
    "totalTokensEarned": 0,
    "canSubmitMoreFeedback": true
  }
}

2. Registered user with pending feedback:
{
  "email": "existing@example.com"
}

Expected response includes userStatus.isRegistered: true and feedbackStats

*/