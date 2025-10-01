import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from '../shared/cors.ts'

interface SocialShareSubmission {
  userEmail: string;
  platform: 'linkedin' | 'facebook' | 'twitter' | 'instagram' | 'tiktok' | 'other';
  postUrl: string;
  description?: string;
  shareType: 'post' | 'story' | 'review' | 'case_study';
  estimatedTokens: number;
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
      userEmail, 
      platform, 
      postUrl, 
      description, 
      shareType, 
      estimatedTokens 
    }: SocialShareSubmission = await req.json()

    // Validate required fields
    if (!userEmail || !platform || !postUrl || !shareType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Validate URL format
    try {
      new URL(postUrl)
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check if user exists and is registered
    const { data: subscriber, error: subscriberError } = await supabaseClient
      .from('subscribers')
      .select('id, email')
      .eq('email', userEmail.toLowerCase().trim())
      .single()

    if (subscriberError || !subscriber) {
      return new Response(
        JSON.stringify({ 
          error: 'User not found. Please register first to earn tokens from social sharing.' 
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check for duplicate submissions
    const { data: existingShare } = await supabaseClient
      .from('social_shares')
      .select('id')
      .eq('user_id', subscriber.id)
      .eq('post_url', postUrl)
      .single()

    if (existingShare) {
      return new Response(
        JSON.stringify({ 
          error: 'This post has already been submitted for verification.' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Insert social share submission
    const { data: shareRecord, error: shareError } = await supabaseClient
      .from('social_shares')
      .insert({
        user_id: subscriber.id,
        user_email: userEmail.toLowerCase().trim(),
        platform,
        post_url: postUrl,
        description: description || '',
        share_type: shareType,
        estimated_tokens: estimatedTokens,
        verification_status: 'pending', // pending, verified, rejected
        tokens_awarded: 0,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single()

    if (shareError) {
      throw shareError
    }

    // Send notification to admin (optional - could be implemented later)
    console.log(`New social share submission: ${platform} ${shareType} by ${userEmail}`)

    const response = {
      success: true,
      message: `Your ${platform} ${shareType} has been submitted for verification. You'll earn ${estimatedTokens} tokens once approved!`,
      shareId: shareRecord.id,
      estimatedTokens,
      verificationStatus: 'pending'
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in submit-social-share:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Failed to submit social share',
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

POST /functions/v1/submit-social-share
{
  "userEmail": "user@example.com",
  "platform": "linkedin",
  "postUrl": "https://linkedin.com/posts/user-post-123",
  "description": "Posted about AI photo tagging for motorsport",
  "shareType": "post",
  "estimatedTokens": 50
}

Response:
{
  "success": true,
  "message": "Your linkedin post has been submitted for verification. You'll earn 50 tokens once approved!",
  "shareId": "share-uuid",
  "estimatedTokens": 50,
  "verificationStatus": "pending"
}

*/