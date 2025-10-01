// Edge Function: submit-feedback-with-rewards
// Purpose: Simple feedback submission with fixed 10 token reward
// Used by: DemoSection feedback buttons

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../shared/cors.ts'

interface RequestBody {
  imageId: string;
  feedbackType: 'correct' | 'incorrect';
  sessionId?: string;
  ipAddress?: string;
  feedbackNotes?: string;
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

    const { 
      imageId, 
      feedbackType, 
      sessionId, 
      ipAddress,
      feedbackNotes 
    }: RequestBody = await req.json()

    if (!imageId || !feedbackType) {
      return new Response(
        JSON.stringify({ error: 'imageId and feedbackType are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get IP from request if not provided (parse first IP from comma-separated list)
    let clientIP = ipAddress || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '0.0.0.0'
    
    // Handle comma-separated IPs (take the first one)
    if (clientIP.includes(',')) {
      clientIP = clientIP.split(',')[0].trim()
    }

    // Insert feedback record with fixed 10 tokens, no user assignment
    const { data: feedbackRecord, error: feedbackError } = await supabaseClient
      .from('image_feedback')
      .insert({
        image_id: imageId,
        feedback_type: feedbackType,
        feedback_notes: feedbackNotes,
        user_email: null, // Always null initially
        user_id: null,    // Always null initially
        session_id: sessionId,
        ip_address: clientIP,
        tokens_earned: 10, // Fixed 10 tokens for all feedback
        admin_approved: null // Pending approval
      })
      .select()
      .single()

    if (feedbackError) {
      throw feedbackError
    }

    const response = {
      success: true,
      message: 'Thank you for your feedback!',
      feedbackId: feedbackRecord.id,
      rewards: {
        potentialTokens: 10,
        message: 'You can earn 10 tokens when this feedback is approved - register to claim them!'
      },
      incentives: {
        tokensPerApprovedFeedback: 10,
        earlyAccessBonus: 1500,
        referralBonus: 100
      }
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in submit-feedback-with-rewards:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Failed to submit feedback',
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

POST /functions/v1/submit-feedback-with-rewards
{
  "imageId": "uuid-123",
  "feedbackType": "correct",
  "userEmail": "user@example.com",
  "sessionId": "session_abc123",
  "feedbackNotes": "The detection was accurate"
}

Response for unregistered user:
{
  "success": true,
  "message": "Thank you! Your feedback is pending review.",
  "feedbackId": "feedback-uuid",
  "userStatus": {
    "isRegistered": false,
    "showRegistrationPrompt": true,
    "totalFeedbackSubmitted": 1,
    "approvedFeedback": 0,
    "pendingFeedback": 1
  },
  "rewards": {
    "potentialTokens": 5,
    "message": "Earn 5 tokens when this feedback is approved!"
  }
}

*/
