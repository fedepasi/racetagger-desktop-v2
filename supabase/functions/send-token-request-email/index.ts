import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';

const ADMIN_EMAIL = 'info@racetagger.cloud';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { tokenRequest, isFreeTier } = await req.json();

    if (!tokenRequest) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'tokenRequest is required' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Send email using the same pattern as send-token-balance-email
    await sendTokenRequestEmail(tokenRequest, isFreeTier);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email sent successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Email] Error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error occurred' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 500 
      }
    );
  }
});

async function sendTokenRequestEmail(tokenRequest: any, isFreeTier: boolean) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
  
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY not configured');
  }
  
  console.log('[Email] BREVO_API_KEY check:', { 
    hasKey: !!BREVO_API_KEY, 
    keyLength: BREVO_API_KEY?.length || 0 
  });

  const freeTierNote = isFreeTier
    ? '🎁 FREE TIER GRANT'
    : '💰 PAYMENT REQUIRED';
  
  const emailSubject = `Token Request - ${tokenRequest.user_email} (${tokenRequest.tokens_requested} tokens)`;
  
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333; border-bottom: 3px solid ${isFreeTier ? '#10b981' : '#f59e0b'};">
        Token Request - ${freeTierNote}
      </h2>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>User Email:</strong> ${tokenRequest.user_email}</p>
        <p><strong>Tokens Requested:</strong> ${tokenRequest.tokens_requested}</p>
        <p><strong>Status:</strong> 
          <span style="color: ${isFreeTier ? '#10b981' : '#f59e0b'}; font-weight: bold;">
            ${tokenRequest.status}
          </span>
        </p>
        <p><strong>Request Date:</strong> ${new Date(tokenRequest.request_date).toLocaleString('it-IT')}</p>
        <p><strong>Request ID:</strong> ${tokenRequest.id}</p>
      </div>

      ${tokenRequest.message ? `
      <div style="background: #fff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
        <h4 style="margin-top: 0; color: #3b82f6;">Additional Notes:</h4>
        <p style="margin-bottom: 0;">${tokenRequest.message}</p>
      </div>
      ` : ''}

      <div style="padding: 15px; border-radius: 8px; margin: 20px 0; ${isFreeTier ? 'background: #dcfce7; border: 1px solid #10b981;' : 'background: #fef3c7; border: 1px solid #f59e0b;'}">
        ${isFreeTier ?
          '<p style="color: #059669; margin: 0;"><strong>✅ This request was automatically approved</strong> (under 100 tokens/month Free Tier). Tokens have been added to the user\'s account.</p>' :
          '<p style="color: #d97706; margin: 0;"><strong>⚠️ This request requires manual processing</strong> (exceeds 100 tokens/month Free Tier limit). Payment coordination needed.</p>'}
      </div>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
      
      <div style="font-size: 12px; color: #6b7280; text-align: center;">
        <p>Racetagger Desktop Token Request System</p>
        <p>Generated on ${new Date().toLocaleString('it-IT')}</p>
      </div>
    </div>
  `;

  const emailPayload = {
    sender: {
      name: "Racetagger Desktop",
      email: "info@racetagger.cloud"
    },
    to: [{
      email: ADMIN_EMAIL,
      name: "Racetagger Admin"
    }],
    subject: emailSubject,
    htmlContent: emailHtml,
    replyTo: {
      email: tokenRequest.user_email,
      name: tokenRequest.user_email
    },
    tags: ['token-request', isFreeTier ? 'free-tier' : 'payment-required']
  };
  
  console.log('[Email] Sending email via Brevo API...');
  console.log('[Email] Email payload:', JSON.stringify(emailPayload, null, 2));
  
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify(emailPayload)
  });
  
  console.log('[Email] Brevo API response status:', response.status);
  console.log('[Email] Brevo API response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
  
  if (!response.ok) {
    const errorData = await response.text();
    console.error('[Email] Brevo API error details:', {
      status: response.status,
      statusText: response.statusText,
      response: errorData
    });
    throw new Error(`Failed to send email: ${errorData}`);
  }
  
  const responseData = await response.json();
  console.log('[Email] Email sent successfully via Brevo:', responseData);
  
  return responseData;
}