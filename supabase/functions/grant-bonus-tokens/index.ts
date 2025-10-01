// Edge Function: grant-bonus-tokens
// Purpose: Allow admin to grant bonus tokens to selected users and send notification emails
// Used by: Admin management portal

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts';

interface RequestBody {
  userEmails: string[];
  bonusTokens: number;
  reason?: string;
}

interface ProcessResult {
  email: string;
  success: boolean;
  message: string;
  tokensGranted?: number;
  newTotalTokens?: number;
}

// Function to send bonus token notification email
async function sendBonusTokensEmail(
  email: string, 
  name: string | null, 
  tokensGranted: number, 
  newTotalTokens: number,
  reason?: string
) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
  const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL') || 'info@racetagger.cloud';

  if (!BREVO_API_KEY) {
    throw new Error('Brevo API Key is not configured.');
  }

  const recipientName = name || 'User';
  const estimatedValue = (tokensGranted * 0.02).toFixed(2);

  const subject = `🎁 You've Received ${tokensGranted} Bonus Tokens!`;
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bonus Tokens Awarded</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px 20px; text-align: center; }
        .content { padding: 30px; }
        .token-card { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center; }
        .big-number { font-size: 48px; font-weight: bold; color: #d97706; margin: 10px 0; }
        .gift-icon { font-size: 60px; margin-bottom: 15px; }
        .footer { background: #374151; color: white; padding: 20px; text-align: center; font-size: 14px; }
        .cta-button { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 15px 30px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: bold; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="gift-icon">🎁</div>
            <h1 style="margin: 0; font-size: 28px;">Surprise! Bonus Tokens Awarded</h1>
            <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">You've received a special gift from the RaceTagger team!</p>
        </div>
        
        <div class="content">
            <div class="token-card">
                <h2 style="color: #78350f; margin: 0 0 15px 0; font-size: 24px;">🎉 Bonus Tokens Awarded</h2>
                <div class="big-number">+${tokensGranted.toLocaleString()}</div>
                <p style="color: #78350f; margin: 5px 0; font-size: 16px;">New Tokens • Value: <strong>$${estimatedValue}</strong></p>
                <div style="background: rgba(255,255,255,0.7); border-radius: 10px; padding: 15px; margin-top: 15px;">
                    <p style="margin: 0; color: #78350f; font-size: 16px; font-weight: 600;">Your New Total Balance: ${newTotalTokens.toLocaleString()} tokens</p>
                </div>
            </div>
            
            ${reason ? `
            <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0; color: #374151;">📝 Reason for Bonus</h3>
                <p style="margin: 0; color: #6b7280; font-style: italic;">"${reason}"</p>
            </div>
            ` : ''}
            
            <div style="background: #e0f2fe; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h4 style="margin-top: 0; color: #0f172a;">🚀 What You Can Do With Your Tokens</h4>
                <ul style="margin: 10px 0; padding-left: 20px; color: #374151;">
                    <li>Analyze up to ${Math.floor(tokensGranted/1)} additional photos</li>
                    <li>Access premium AI features</li>
                    <li>Get priority customer support</li>
                    <li>Early access to new features</li>
                </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.racetagger.cloud/#demo" class="cta-button">
                    ✨ Start Using Your Tokens
                </a>
                <br>
                <small style="color: #6b7280;">Your tokens are ready to use immediately!</small>
            </div>
        </div>
        
        <div class="footer">
            <p><strong>RaceTagger Team</strong> - AI-Powered Race Photography Analysis</p>
            <p style="font-size: 12px; color: #9ca3af;">This bonus was awarded by an administrator. Enjoy your extra tokens!</p>
        </div>
    </div>
</body>
</html>
  `;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        name: 'RaceTagger Team',
        email: SMTP_FROM_EMAIL
      },
      to: [{
        email,
        name: recipientName
      }],
      subject: subject,
      htmlContent: htmlContent
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to send bonus tokens email: ${errorData}`);
  }

  return await response.json();
}

serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase URL or Service Role Key environment variables.');
    }
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Authenticate admin user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication failed', details: userError?.message }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Check if user is admin
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminCheckError) throw adminCheckError;
    
    if (!adminUser) {
      return new Response(JSON.stringify({ error: 'Access denied: User is not an administrator.' }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Parse request body
    const { userEmails, bonusTokens, reason }: RequestBody = await req.json();

    if (!Array.isArray(userEmails) || userEmails.length === 0) {
      return new Response(JSON.stringify({ error: 'userEmails array is required and cannot be empty' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (typeof bonusTokens !== 'number' || bonusTokens <= 0 || !Number.isInteger(bonusTokens)) {
      return new Response(JSON.stringify({ error: 'bonusTokens must be a positive integer' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const results: ProcessResult[] = [];

    // Process each user email
    for (const email of userEmails) {
      try {
        // Check if user exists in subscribers table
        const { data: subscriber, error: subscriberError } = await supabaseAdmin
          .from('subscribers')
          .select('id, name, base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens')
          .eq('email', email.toLowerCase().trim())
          .maybeSingle();

        if (subscriberError) {
          console.error(`Error checking subscriber ${email}:`, subscriberError);
          results.push({ 
            email, 
            success: false, 
            message: `Database error: ${subscriberError.message}` 
          });
          continue;
        }

        if (!subscriber) {
          results.push({ 
            email, 
            success: false, 
            message: 'User not found in subscribers. Only registered users can receive bonus tokens.' 
          });
          continue;
        }

        // Use admin_bonus_tokens for admin-granted tokens
        const currentAdminBonus = subscriber.admin_bonus_tokens || 0;
        const newAdminBonus = currentAdminBonus + bonusTokens;
        
        const { error: updateError } = await supabaseAdmin
          .from('subscribers')
          .update({ admin_bonus_tokens: newAdminBonus })
          .eq('id', subscriber.id);

        if (updateError) {
          console.error(`Error updating admin bonus tokens for ${email}:`, updateError);
          results.push({ 
            email, 
            success: false, 
            message: `Failed to grant bonus tokens: ${updateError.message}` 
          });
          continue;
        }
        
        // Calculate new totals for email notification
        const base_tokens = subscriber.base_tokens || 1000;
        const bonus_tokens = subscriber.bonus_tokens || 500;
        const earned_tokens = subscriber.earned_tokens || 0;
        const newTotalTokens = base_tokens + bonus_tokens + earned_tokens + newAdminBonus;

        // Admin action and transaction already logged by grant_admin_bonus_tokens function

        // Send notification email
        try {
          await sendBonusTokensEmail(
            email, 
            subscriber.name, 
            bonusTokens, 
            newTotalTokens,
            reason
          );

          results.push({ 
            email, 
            success: true, 
            message: `Successfully granted ${bonusTokens} bonus tokens and sent notification email.`,
            tokensGranted: bonusTokens,
            newTotalTokens: newTotalTokens
          });
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
          results.push({ 
            email, 
            success: true, 
            message: `Tokens granted successfully, but failed to send notification email: ${emailError.message}`,
            tokensGranted: bonusTokens,
            newTotalTokens: newTotalTokens
          });
        }

      } catch (processError) {
        console.error(`Error processing bonus tokens for ${email}:`, processError);
        results.push({ 
          email, 
          success: false, 
          message: `Processing error: ${processError.message}` 
        });
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      results,
      summary: {
        total: userEmails.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        totalTokensGranted: results.filter(r => r.success).reduce((sum, r) => sum + (r.tokensGranted || 0), 0)
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in grant-bonus-tokens function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message || 'An unexpected error occurred.' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/* Usage example:
POST /functions/v1/grant-bonus-tokens
Authorization: Bearer <admin_jwt_token>
{
  "userEmails": ["user1@example.com", "user2@example.com"],
  "bonusTokens": 500,
  "reason": "Special contribution to community feedback"
}
*/