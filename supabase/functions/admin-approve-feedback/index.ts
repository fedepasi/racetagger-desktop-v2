// Edge Function: admin-approve-feedback
// Purpose: Admin function to approve/reject feedback and award tokens
// Used by: Admin dashboard for feedback management

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../shared/cors.ts'

interface RequestBody {
  feedbackId: string;
  action: 'approve' | 'reject';
  tokensToAward?: number;
  qualityScore?: number; // 1-5 rating
  adminNotes?: string;
}

interface BatchRequestBody {
  feedbackIds: string[];
  action: 'approve' | 'reject';
  tokensToAward?: number;
  qualityScore?: number;
  adminNotes?: string;
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

    // Get authenticated user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Set auth header for client
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader }
        }
      }
    )

    // Verify user is admin
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const { data: adminUser, error: adminError } = await supabaseClient
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (adminError || !adminUser) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const requestBody = await req.json()
    
    // Handle batch operations
    if ('feedbackIds' in requestBody) {
      return await handleBatchApproval(supabaseClient, requestBody as BatchRequestBody, user.id)
    }
    
    // Handle single feedback approval
    const { 
      feedbackId, 
      action, 
      tokensToAward = 10, 
      qualityScore,
      adminNotes 
    }: RequestBody = requestBody

    if (!feedbackId || !action) {
      return new Response(
        JSON.stringify({ error: 'feedbackId and action are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get feedback details
    const { data: feedback, error: feedbackError } = await supabaseClient
      .from('image_feedback')
      .select(`
        id,
        image_id,
        feedback_type,
        user_email,
        user_id,
        session_id,
        submitted_at,
        admin_approved,
        tokens_earned
      `)
      .eq('id', feedbackId)
      .single()

    if (feedbackError || !feedback) {
      return new Response(
        JSON.stringify({ error: 'Feedback not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    if (feedback.admin_approved !== null) {
      return new Response(
        JSON.stringify({ error: 'Feedback already processed' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    let tokensAwarded = 0
    
    if (action === 'approve') {
      // Preserve existing tokens if already set, otherwise use tokensToAward
      const finalTokens = (feedback.tokens_earned && feedback.tokens_earned > 0) 
        ? feedback.tokens_earned 
        : tokensToAward;
      
      // Token calculation completed
      
      // Update feedback record directly
      const { error: updateError } = await supabaseClient
        .from('image_feedback')
        .update({
          admin_approved: true,
          approved_by: adminUser.id,
          approved_at: new Date().toISOString(),
          quality_score: qualityScore,
          admin_notes: adminNotes,
          tokens_earned: finalTokens
        })
        .eq('id', feedbackId)
      
      if (updateError) {
        console.error('Feedback update error:', updateError)
        throw updateError
      }

      // Log admin action
      await supabaseClient
        .from('admin_actions_log')
        .insert({
          admin_id: adminUser.id,
          action_type: 'approve_feedback',
          target_id: feedbackId,
          target_type: 'feedback',
          action_details: {
            tokens_awarded: tokensToAward,
            quality_score: qualityScore,
            notes: adminNotes,
            user_email: feedback.user_email
          }
        })

      tokensAwarded = finalTokens
    } else {
      // Reject feedback
      await supabaseClient
        .from('image_feedback')
        .update({
          admin_approved: false,
          approved_by: adminUser.id,
          approved_at: new Date().toISOString(),
          quality_score: qualityScore,
          admin_notes: adminNotes
        })
        .eq('id', feedbackId)

      // Log admin action
      await supabaseClient
        .from('admin_actions_log')
        .insert({
          admin_id: adminUser.id,
          action_type: 'reject_feedback',
          target_id: feedbackId,
          target_type: 'feedback',
          action_details: {
            reason: adminNotes,
            quality_score: qualityScore,
            user_email: feedback.user_email
          }
        })
    }

    // Get updated feedback record
    const { data: updatedFeedback } = await supabaseClient
      .from('image_feedback')
      .select(`
        id,
        admin_approved,
        tokens_earned,
        quality_score,
        admin_notes,
        approved_at
      `)
      .eq('id', feedbackId)
      .single()

    const response = {
      success: true,
      action,
      feedback: updatedFeedback,
      tokensAwarded,
      message: action === 'approve' 
        ? `Feedback approved and ${tokensAwarded} tokens awarded`
        : 'Feedback rejected'
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in admin-approve-feedback:', error)
    
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

async function handleBatchApproval(
  supabaseClient: any, 
  requestBody: BatchRequestBody, 
  userId: string
) {
  const { feedbackIds, action, tokensToAward = 10, qualityScore, adminNotes } = requestBody

  if (!feedbackIds || feedbackIds.length === 0) {
    return new Response(
      JSON.stringify({ error: 'feedbackIds array is required' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  const results = []
  let totalTokensAwarded = 0

  for (const feedbackId of feedbackIds) {
    try {
      if (action === 'approve') {
        // Get feedback details first
        const { data: feedbackToApprove, error: feedbackFetchError } = await supabaseClient
          .from('image_feedback')
          .select('user_email, tokens_earned')
          .eq('id', feedbackId)
          .single()
        
        // Preserve existing tokens if already set
        const finalTokens = (feedbackToApprove?.tokens_earned && feedbackToApprove.tokens_earned > 0) 
          ? feedbackToApprove.tokens_earned 
          : tokensToAward;
        
        // Update feedback record directly
        const { error: updateError } = await supabaseClient
          .from('image_feedback')
          .update({
            admin_approved: true,
            approved_at: new Date().toISOString(),
            quality_score: qualityScore,
            admin_notes: adminNotes,
            tokens_earned: finalTokens
          })
          .eq('id', feedbackId)

        if (!updateError) {
          totalTokensAwarded += finalTokens
          results.push({ feedbackId, success: true, tokensAwarded: finalTokens })
          
          // Send token balance email notification for approved feedback
          if (feedbackToApprove?.user_email) {
            try {
              await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-token-balance-email`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  email: feedbackToApprove.user_email,
                  trigger: 'feedback_approved'
                })
              });
            } catch (emailError) {
              console.error('Failed to send token balance email:', emailError);
              // Don't fail the approval if email fails
            }
          }
        } else {
          results.push({ feedbackId, success: false, error: updateError.message })
        }
      } else {
        // Batch reject
        const { error: updateError } = await supabaseClient
          .from('image_feedback')
          .update({
            admin_approved: false,
            approved_at: new Date().toISOString(),
            quality_score: qualityScore,
            admin_notes: adminNotes
          })
          .eq('id', feedbackId)

        if (!updateError) {
          results.push({ feedbackId, success: true })
        } else {
          results.push({ feedbackId, success: false, error: updateError.message })
        }
      }
    } catch (error) {
      results.push({ feedbackId, success: false, error: error.message })
    }
  }

  const successCount = results.filter(r => r.success).length
  
  return new Response(
    JSON.stringify({
      success: true,
      action,
      results,
      summary: {
        total: feedbackIds.length,
        successful: successCount,
        failed: feedbackIds.length - successCount,
        totalTokensAwarded
      },
      message: `Batch ${action}: ${successCount}/${feedbackIds.length} processed successfully`
    }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}

/* Usage examples:

1. Single approval:
POST /functions/v1/admin-approve-feedback
Authorization: Bearer <jwt_token>
{
  "feedbackId": "uuid-123",
  "action": "approve",
  "tokensToAward": 5,
  "qualityScore": 4,
  "adminNotes": "Good quality feedback"
}

2. Batch approval:
POST /functions/v1/admin-approve-feedback
Authorization: Bearer <jwt_token>
{
  "feedbackIds": ["uuid-1", "uuid-2", "uuid-3"],
  "action": "approve",
  "tokensToAward": 5,
  "qualityScore": 3
}

3. Rejection:
POST /functions/v1/admin-approve-feedback
Authorization: Bearer <jwt_token>
{
  "feedbackId": "uuid-123",
  "action": "reject",
  "qualityScore": 1,
  "adminNotes": "Not helpful feedback"
}

*/