// Edge Function: process-referral-signup
// Purpose: Handle referral tracking when new users sign up
// Used by: Updated register-subscriber function

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, Cache-Control, pragma, Pragma',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

interface RequestBody {
  newSubscriberId: string;
  referralCode?: string;
  email: string;
  name: string;
  company?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { newSubscriberId, referralCode, email, name, company }: RequestBody = await req.json()

    if (!newSubscriberId || !email || !name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: newSubscriberId, email, name' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    let referralProcessed = false
    let referralDetails = null

    // Process referral if code provided
    if (referralCode) {
      try {
        // Call the enhanced database function to process referral
        const { data: referralResult, error: referralError } = await supabaseClient
          .rpc('process_referral_signup_enhanced', {
            p_new_subscriber_id: newSubscriberId,
            p_referral_code: referralCode
          })

        if (referralError) {
          console.error('Referral processing error:', referralError)
          // Continue with registration even if referral fails
        } else if (referralResult) {
          referralProcessed = true

          // Get referrer details for response
          const { data: referrer } = await supabaseClient
            .from('subscribers')
            .select('name, email, total_referrals')
            .eq('referral_code', referralCode)
            .single()

          referralDetails = {
            referrerName: referrer?.name || 'Anonymous',
            tokensEarned: referralResult.tokens_awarded || 100,
            referralTier: referralResult.referral_tier || 1,
            milestoneBonus: referralResult.milestone_bonus || 0,
            referrerTotalReferrals: referralResult.total_referrals || 0
          }
        }
      } catch (error) {
        console.error('Referral processing failed:', error)
        // Continue with registration
      }
    }

    // Update subscriber with company info if provided
    if (company) {
      await supabaseClient
        .from('subscribers')
        .update({ company: company.trim() })
        .eq('id', newSubscriberId)
    }

    // Check if user has pending feedback rewards to claim
    const { data: pendingRewards } = await supabaseClient
      .from('image_feedback')
      .select('id, tokens_earned')
      .eq('user_email', email.toLowerCase().trim())
      .eq('admin_approved', true)
      .is('user_id', null)

    let pendingTokens = 0
    if (pendingRewards && pendingRewards.length > 0) {
      pendingTokens = pendingRewards.reduce((sum, reward) => sum + (reward.tokens_earned || 0), 0)
      
      // Update subscriber's earned_tokens with pending feedback rewards
      // base_tokens (1000) and bonus_tokens (500) will use defaults
      await supabaseClient
        .from('subscribers')
        .update({ 
          earned_tokens: pendingTokens // pending feedback rewards
        })
        .eq('id', newSubscriberId)
    }

    // Get updated subscriber info
    const { data: updatedSubscriber } = await supabaseClient
      .from('subscribers')
      .select(`
        id,
        email,
        name,
        company,
        position,
        referral_code,
        referred_by,
        base_tokens,
        bonus_tokens,
        earned_tokens,
        admin_bonus_tokens,
        total_referrals,
        approval_status
      `)
      .eq('id', newSubscriberId)
      .single()

    // Prepare response
    const response = {
      success: true,
      subscriber: updatedSubscriber,
      referral: {
        processed: referralProcessed,
        details: referralDetails
      },
      rewards: {
        pendingFeedbackTokens: pendingTokens,
        totalBonusTokens: (updatedSubscriber?.base_tokens || 1000) + (updatedSubscriber?.bonus_tokens || 500) + (updatedSubscriber?.earned_tokens || 0) + (updatedSubscriber?.admin_bonus_tokens || 0),
        earlyAccessTokens: 1500
      },
      message: referralProcessed 
        ? `Welcome! You've been referred by ${referralDetails?.referrerName}. You start with ${(updatedSubscriber?.base_tokens || 1000) + (updatedSubscriber?.bonus_tokens || 500) + (updatedSubscriber?.earned_tokens || 0) + (updatedSubscriber?.admin_bonus_tokens || 0)} bonus tokens!`
        : `Welcome! You start with ${(updatedSubscriber?.base_tokens || 1000) + (updatedSubscriber?.bonus_tokens || 500) + (updatedSubscriber?.earned_tokens || 0) + (updatedSubscriber?.admin_bonus_tokens || 0)} bonus tokens!`
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in process-referral-signup:', error)
    
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

/* Usage example:

This function should be called from the updated register-subscriber function:

// In register-subscriber/index.ts, after creating the subscriber:
const { data: referralResult } = await supabase.functions.invoke('process-referral-signup', {
  body: {
    newSubscriberId: newSubscriber.id,
    referralCode: req.body.referralCode, // from URL param ?ref=ABC123
    email: newSubscriber.email,
    name: newSubscriber.name,
    company: req.body.company
  }
})

*/
