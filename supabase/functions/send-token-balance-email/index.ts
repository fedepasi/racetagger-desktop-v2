// Edge Function: send-token-balance-email
// Purpose: Calculate user's token balance and send detailed email report
// Used by: User dashboard, admin panel, or automatic triggers

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { getSignupBonusTokens } from '../_shared/get-signup-bonus.ts';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

interface RequestBody {
  email: string;
  trigger?: 'manual' | 'feedback_approved' | 'milestone' | 'periodic';
  adminRequested?: boolean;
}

interface TokenData {
  totalTokens: number;
  bonusTokens: number;
  feedbackTokensEarned: number;
  pendingFeedbackTokens: number;
  totalFeedbackSubmitted: number;
  approvedFeedback: number;
  pendingFeedback: number;
  lastFeedbackDate: string | null;
  earlyAccessBonus: number;
  referralBonus: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const { email, trigger = 'manual', adminRequested = false }: RequestBody = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Email is required'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Get dynamic signup bonus from system_config
    const signupBonus = await getSignupBonusTokens(supabaseAdmin);
    
    const normalizedEmail = email.toLowerCase().trim();
    
    // Get subscriber data
    const { data: subscriber, error: subscriberError } = await supabaseAdmin
      .from('subscribers')
      .select(`
        id,
        email,
        name,
        bonus_tokens,
        total_referrals,
        signup_date,
        has_access,
        approval_status,
        user_id
      `)
      .eq('email', normalizedEmail)
      .single();
    
    if (subscriberError || !subscriber) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'User not found. Please register first.' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }
    
    // Get feedback history and tokens
    const { data: feedbackHistory, error: feedbackError } = await supabaseAdmin
      .from('image_feedback')
      .select(`
        id,
        feedback_type,
        tokens_earned,
        admin_approved,
        submitted_at,
        feedback_notes
      `)
      .eq('user_email', normalizedEmail);
    
    if (feedbackError) {
      console.error('Error fetching feedback history:', feedbackError);
      // Continue without feedback data
    }
    
    // Calculate token data
    const feedback = feedbackHistory || [];
    const approvedFeedback = feedback.filter(f => f.admin_approved === true);
    const pendingFeedback = feedback.filter(f => f.admin_approved === null);
    const rejectedFeedback = feedback.filter(f => f.admin_approved === false);
    
    const feedbackTokensEarned = approvedFeedback.reduce((sum, f) => sum + (f.tokens_earned || 0), 0);
    const pendingFeedbackTokens = pendingFeedback.reduce((sum, f) => sum + (f.tokens_earned || 0), 0);
    
    const tokenData: TokenData = {
      totalTokens: (subscriber.bonus_tokens || 0) + feedbackTokensEarned,
      bonusTokens: subscriber.bonus_tokens || 0,
      feedbackTokensEarned,
      pendingFeedbackTokens,
      totalFeedbackSubmitted: feedback.length,
      approvedFeedback: approvedFeedback.length,
      pendingFeedback: pendingFeedback.length,
      lastFeedbackDate: feedback.length > 0 ? feedback[0]?.submitted_at : null,
      earlyAccessBonus: subscriber.has_access ? signupBonus : 0,
      referralBonus: (subscriber.total_referrals || 0) * 100
    };
    
    // Send email with token balance
    await sendTokenBalanceEmail(
      subscriber.email,
      subscriber.name,
      tokenData,
      trigger,
      {
        subscriberSince: subscriber.signup_date,
        hasEarlyAccess: subscriber.has_access,
        approvalStatus: subscriber.approval_status,
        totalReferrals: subscriber.total_referrals || 0,
        rejectedFeedbackCount: rejectedFeedback.length
      }
    );
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Token balance email sent successfully',
        tokenData,
        emailSent: true
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in send-token-balance-email:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Failed to send token balance email' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

async function sendTokenBalanceEmail(
  email: string, 
  name: string, 
  tokenData: TokenData, 
  trigger: string,
  additionalInfo: any
) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
  
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY not configured');
  }
  
  // Create trigger-specific subject and intro
  let subject = '';
  let introMessage = '';
  
  switch (trigger) {
    case 'feedback_approved':
      subject = '🎉 Your Feedback was Approved! Token Balance Updated';
      introMessage = 'Great news! Your recent feedback has been approved and tokens have been added to your account.';
      break;
    case 'milestone':
      subject = '🏆 Token Milestone Reached! Your Balance Update';
      introMessage = 'Congratulations! You\'ve reached a new token milestone.';
      break;
    case 'periodic':
      subject = '📊 Your Monthly Token Balance Report';
      introMessage = 'Here\'s your monthly summary of token activity and current balance.';
      break;
    default:
      subject = '💰 Your RaceTagger Token Balance';
      introMessage = 'Here\'s your current token balance and recent activity.';
  }
  
  // Calculate estimated value (assuming 1 token = $0.02)
  const estimatedValue = (tokenData.totalTokens * 0.02).toFixed(2);
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Token Balance</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; }
        .header { background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); color: white; padding: 30px 20px; text-align: center; }
        .content { padding: 30px; }
        .token-card { background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 2px solid #0ea5e9; border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center; }
        .big-number { font-size: 48px; font-weight: bold; color: #0ea5e9; margin: 10px 0; }
        .breakdown { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .breakdown-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
        .breakdown-item:last-child { border-bottom: none; }
        .activity-section { margin: 25px 0; }
        .activity-item { background: #f1f5f9; border-radius: 6px; padding: 15px; margin: 10px 0; }
        .cta-button { background: linear-gradient(135deg, #0ea5e9, #06b6d4); color: white; padding: 15px 30px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: bold; margin: 20px 0; }
        .footer { background: #334155; color: white; padding: 20px; text-align: center; font-size: 14px; }
        .milestone-badge { background: #fbbf24; color: #78350f; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏎️ RaceTagger Token Balance</h1>
            <p>${introMessage}</p>
        </div>
        
        <div class="content">
            <div class="token-card">
                <h2>Your Current Balance</h2>
                <div class="big-number">${tokenData.totalTokens.toLocaleString()}</div>
                <p style="color: #64748b; font-size: 16px;">Total Tokens Available</p>
                <p style="color: #059669; font-weight: bold;">≈ $${estimatedValue} estimated value</p>
                ${tokenData.totalTokens >= 1000 ? '<span class="milestone-badge">🏆 Token Collector</span>' : ''}
                ${tokenData.totalTokens >= 500 ? '<span class="milestone-badge">⭐ Active Contributor</span>' : ''}
            </div>
            
            <div class="breakdown">
                <h3 style="margin-top: 0;">Token Breakdown</h3>
                <div class="breakdown-item">
                    <span>🎁 Early Access Bonus</span>
                    <strong>${tokenData.bonusTokens.toLocaleString()}</strong>
                </div>
                <div class="breakdown-item">
                    <span>✅ Feedback Approved</span>
                    <strong>${tokenData.feedbackTokensEarned.toLocaleString()}</strong>
                </div>
                <div class="breakdown-item">
                    <span>⏳ Pending Approval</span>
                    <strong>${tokenData.pendingFeedbackTokens.toLocaleString()}</strong>
                </div>
                <div class="breakdown-item">
                    <span>👥 Referral Bonus</span>
                    <strong>${tokenData.referralBonus.toLocaleString()}</strong>
                </div>
                <div class="breakdown-item" style="border-top: 2px solid #0ea5e9; margin-top: 10px; padding-top: 15px; font-size: 18px;">
                    <span><strong>Total Available</strong></span>
                    <strong style="color: #0ea5e9;">${tokenData.totalTokens.toLocaleString()}</strong>
                </div>
            </div>
            
            <div class="activity-section">
                <h3>Recent Activity</h3>
                <div class="activity-item">
                    <strong>📊 Feedback Submitted:</strong> ${tokenData.totalFeedbackSubmitted}
                    <br><small>Approved: ${tokenData.approvedFeedback} | Pending: ${tokenData.pendingFeedback}</small>
                </div>
                ${additionalInfo.totalReferrals > 0 ? `
                <div class="activity-item">
                    <strong>🤝 Successful Referrals:</strong> ${additionalInfo.totalReferrals}
                    <br><small>Earned ${tokenData.referralBonus} tokens from referrals</small>
                </div>
                ` : ''}
                ${tokenData.lastFeedbackDate ? `
                <div class="activity-item">
                    <strong>🕒 Last Feedback:</strong> ${new Date(tokenData.lastFeedbackDate).toLocaleDateString()}
                </div>
                ` : ''}
            </div>
            
            ${tokenData.pendingFeedback > 0 ? `
            <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <strong>⏳ Pending Review:</strong> You have ${tokenData.pendingFeedback} feedback submissions being reviewed. 
                You'll earn approximately ${tokenData.pendingFeedbackTokens} more tokens when they're approved!
            </div>
            ` : ''}
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.racetagger.cloud/#demo" class="cta-button">
                    🚀 Submit More Feedback & Earn Tokens
                </a>
                <br>
                <small style="color: #64748b;">Each quality feedback submission earns 10 tokens when approved</small>
            </div>
            
            <div style="background: #e0f2fe; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h4 style="margin-top: 0;">💡 How to Use Your Tokens</h4>
                <p style="margin-bottom: 0;">Your tokens will be automatically credited to your account when the RaceTagger desktop app launches. Use them for:</p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>AI image analysis credits</li>
                    <li>Premium features and advanced tools</li>
                    <li>Priority customer support</li>
                    <li>Early access to new features</li>
                </ul>
            </div>
        </div>
        
        <div class="footer">
            <p><strong>RaceTagger</strong> - AI-Powered Race Photography Analysis</p>
            <p>Subscriber since ${new Date(additionalInfo.subscriberSince).toLocaleDateString()} | Status: ${additionalInfo.approvalStatus}</p>
            <p style="font-size: 12px; color: #94a3b8;">This email was sent because you requested your token balance. To unsubscribe or update preferences, contact info@racetagger.cloud</p>
        </div>
    </div>
</body>
</html>
  `.trim();
  
  const emailPayload = {
    sender: {
      name: "RaceTagger Token System",
      email: "info@racetagger.cloud"
    },
    to: [{
      email: email,
      name: name
    }],
    subject: subject,
    htmlContent: htmlContent
  };
  
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify(emailPayload)
  });
  
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to send email: ${errorData}`);
  }
  
  return await response.json();
}