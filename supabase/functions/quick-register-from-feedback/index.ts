// Edge Function: quick-register-from-feedback
// Purpose: Simplified registration for users coming from feedback popup
// No reCAPTCHA required since user already interacted with the app

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

interface RequestBody {
  email: string;
  name: string;
  feedbackId?: string; // Direct feedback ID to link
  feedbackContext?: {
    source: string;
    totalFeedbackSubmitted: number;
  };
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    console.log('=== Quick Register From Feedback - Starting ===');
    const requestBody = await req.json();
    console.log('Request body received:', JSON.stringify(requestBody, null, 2));
    
    const { email, name, feedbackId, feedbackContext }: RequestBody = requestBody;
    
    if (!email || !name) {
      console.log('Validation failed: missing email or name', { email: !!email, name: !!name });
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Email and name are required',
          errorType: 'missing_fields'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log('Normalized email:', normalizedEmail);
    
    // Check if email is already registered
    console.log('Checking if email already exists...');
    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from('subscribers')
      .select('email, id, base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens, referral_code')
      .eq('email', normalizedEmail)
      .maybeSingle();
    
    if (existingUserError) {
      console.error('Error checking existing user:', existingUserError);
      throw new Error(`Database error checking existing user: ${existingUserError.message}`);
    }
    
    console.log('Existing user check result:', { found: !!existingUser });
    
    // Link feedback to user if feedbackId provided (regardless of registration status)
    if (feedbackId) {
      try {
        console.log('Linking feedback to user:', feedbackId);
        const { error: feedbackUpdateError } = await supabaseAdmin
          .from('image_feedback')
          .update({ 
            user_email: normalizedEmail,
            user_id: existingUser?.user_id || null 
          })
          .eq('id', feedbackId);
        
        if (feedbackUpdateError) {
          console.error('Failed to link feedback to user:', feedbackUpdateError);
        } else {
          console.log('Successfully linked feedback to user');
        }
      } catch (feedbackUpdateError) {
        console.error('Failed to link feedback to user:', feedbackUpdateError);
      }
    }
    
    if (existingUser) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'You are already registered! You\'ll receive tokens when feedback is approved.',
          errorType: 'already_registered',
          subscriber: existingUser
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Get current subscriber count
    console.log('Getting current subscriber count...');
    const { count, error: countError } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('Error getting subscriber count:', countError);
      throw new Error(`Database error getting count: ${countError.message}`);
    }
    
    const subscriberCount = count || 0;
    console.log('Current subscriber count:', subscriberCount);
    
    // Check if we have reached the limit
    if (subscriberCount >= 50) {
      // Add to waiting list
      const { data: waitingListEntry, error: waitingListError } = await supabaseAdmin
        .from('waiting_list')
        .insert([{ 
          email: normalizedEmail, 
          name, 
          is_early_access: false
        }])
        .select()
        .single();
      
      if (waitingListError) throw waitingListError;
      
      // Sync to Brevo (without failing if it errors)
      try {
        await syncToBrevo(normalizedEmail, name, {
          EARLY_ACCESS: 'No',
          POSITION: 'Waiting List',
          SIGNUP_DATE: new Date().toISOString(),
          SOURCE: 'Feedback Popup'
        });
      } catch (brevoError) {
        console.error('Brevo sync failed for waiting list:', brevoError);
        // Continue without failing
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Early access is full, but you\'re on the waiting list! You\'ll still earn tokens when feedback is approved.',
          waitingList: true,
          rewards: {
            earlyAccessBonus: 0,
            feedbackTokens: feedbackId ? 10 : 0,
            totalExpected: feedbackId ? 10 : 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Add to subscribers with early access
    const position = subscriberCount + 1;
    console.log('Adding new subscriber at position:', position);
    
    const insertData = { 
      email: normalizedEmail, 
      name, 
      position
      // base_tokens (1000) and bonus_tokens (500) will use defaults = 1500 total
    };
    console.log('Insert data:', JSON.stringify(insertData, null, 2));
    
    const { data: newSubscriber, error: subscriberError } = await supabaseAdmin
      .from('subscribers')
      .insert([insertData])
      .select('*, referral_code, base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens')
      .single();
    
    if (subscriberError) {
      console.error('Error inserting new subscriber:', subscriberError);
      throw new Error(`Database error inserting subscriber: ${subscriberError.message}`);
    }
    
    console.log('New subscriber created:', { id: newSubscriber?.id, email: newSubscriber?.email });
    
    // Sync to Brevo (without failing if it errors)
    try {
      await syncToBrevo(normalizedEmail, name, {
        EARLY_ACCESS: 'Yes',
        POSITION: position.toString(),
        SIGNUP_DATE: new Date().toISOString(),
        SOURCE: 'Feedback Popup'
      });
    } catch (brevoError) {
      console.error('Brevo sync failed:', brevoError);
      // Continue without failing
    }
    
    // Send confirmation email
    try {
      await sendConfirmationEmail(
        normalizedEmail, 
        name, 
        position, 
        newSubscriber.referral_code, 
        (newSubscriber.base_tokens || 1000) + (newSubscriber.bonus_tokens || 500) + (newSubscriber.earned_tokens || 0) + (newSubscriber.admin_bonus_tokens || 0)
      );
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Continue with registration even if email fails
    }
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Welcome! You're #${position} in early access and will earn tokens when feedback is approved.`,
        position,
        subscriber: newSubscriber,
        rewards: {
          earlyAccessBonus: 1500,
          feedbackTokens: feedbackId ? 10 : 0,
          totalExpected: 1500 + (feedbackId ? 10 : 0)
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('=== ERROR in quick-register-from-feedback ===');
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Registration failed. Please try again or contact support.',
        errorType: 'server_error',
        debug: {
          message: error.message,
          code: error.code
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Sync to Brevo function
async function syncToBrevo(email: string, name: string, attributes: Record<string, string>) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
  const BREVO_LIST_ID = Deno.env.get('BREVO_LIST_ID') || '';
  
  if (!BREVO_API_KEY || !BREVO_LIST_ID) {
    console.error('Missing Brevo configuration');
    return;
  }
  
  try {
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: name?.split(' ')[0] || '',
          LASTNAME: name?.split(' ').slice(1).join(' ') || '',
          ...attributes
        },
        listIds: [parseInt(BREVO_LIST_ID)]
      })
    });
    
    if (!response.ok && response.status !== 400) {
      console.error('Brevo sync failed:', await response.text());
    }
  } catch (error) {
    console.error('Error syncing to Brevo:', error);
  }
}

// Send confirmation email function
async function sendConfirmationEmail(email: string, name: string, position: number, referralCode?: string, bonusTokens?: number) {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-confirmation-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        name,
        position,
        referralCode,
        bonusTokens
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to send confirmation email: ${JSON.stringify(errorData)}`);
    }
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    // Don't fail the whole registration if email fails
  }
}