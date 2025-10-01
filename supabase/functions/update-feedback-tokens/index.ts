// Temporary Edge Function: update-feedback-tokens
// Purpose: Update all existing feedback records to have 10 tokens

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    console.log('=== Starting feedback tokens update ===');
    
    // First, get all feedback records with 0 or null tokens
    const { data: feedbackToUpdate, error: fetchError } = await supabaseAdmin
      .from('image_feedback')
      .select('id, tokens_earned, feedback_type')
      .or('tokens_earned.is.null,tokens_earned.eq.0');
    
    if (fetchError) {
      throw new Error(`Error fetching feedback: ${fetchError.message}`);
    }
    
    console.log(`Found ${feedbackToUpdate?.length || 0} feedback records to update`);
    
    if (!feedbackToUpdate || feedbackToUpdate.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No feedback records need updating',
          updated: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Update all feedback records to have 10 tokens
    const { data: updatedFeedback, error: updateError } = await supabaseAdmin
      .from('image_feedback')
      .update({ tokens_earned: 10 })
      .or('tokens_earned.is.null,tokens_earned.eq.0')
      .select('id, tokens_earned');
    
    if (updateError) {
      throw new Error(`Error updating feedback: ${updateError.message}`);
    }
    
    console.log(`Successfully updated ${updatedFeedback?.length || 0} feedback records`);
    
    // Get summary statistics
    const { data: allFeedback, error: statsError } = await supabaseAdmin
      .from('image_feedback')
      .select('id, tokens_earned, admin_approved');
    
    if (statsError) {
      console.error('Error getting stats:', statsError);
    }
    
    const stats = {
      totalFeedback: allFeedback?.length || 0,
      withTokens: allFeedback?.filter(f => f.tokens_earned > 0).length || 0,
      approved: allFeedback?.filter(f => f.admin_approved === true).length || 0,
      pending: allFeedback?.filter(f => f.admin_approved === null).length || 0,
      rejected: allFeedback?.filter(f => f.admin_approved === false).length || 0
    };
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Successfully updated ${updatedFeedback?.length || 0} feedback records with 10 tokens`,
        updated: updatedFeedback?.length || 0,
        feedbackToUpdate: feedbackToUpdate.map(f => ({
          id: f.id,
          previousTokens: f.tokens_earned,
          newTokens: 10,
          type: f.feedback_type
        })),
        stats
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in update-feedback-tokens:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to update feedback tokens' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});