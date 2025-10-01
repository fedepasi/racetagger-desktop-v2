import { app } from 'electron';
import * as config from './config';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const ADMIN_EMAIL = 'info@racetagger.cloud';

export interface TokenRequestData {
  id: string;
  user_email: string;
  tokens_requested: number;
  status: string;
  request_date: string;
  message?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send token request notification email to admin
 */
export async function sendTokenRequestEmail(
  tokenRequest: TokenRequestData,
  isEarlyAccessFree: boolean
): Promise<EmailResult> {
  try {
    const brevoApiKey = config.getBREVO_API_KEY();
    
    if (!brevoApiKey) {
      console.error('[Email Service] BREVO_API_KEY not found in environment');
      return {
        success: false,
        error: 'BREVO_API_KEY not configured'
      };
    }

    console.log('[Email Service] Preparing token request email...');

    const earlyAccessNote = isEarlyAccessFree 
      ? '🎁 EARLY ACCESS FREE GRANT' 
      : '💰 PAYMENT REQUIRED';
    
    const emailSubject = `Token Request - ${tokenRequest.user_email} (${tokenRequest.tokens_requested} tokens)`;
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 3px solid ${isEarlyAccessFree ? '#10b981' : '#f59e0b'};">
          Token Request - ${earlyAccessNote}
        </h2>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>User Email:</strong> ${tokenRequest.user_email}</p>
          <p><strong>Tokens Requested:</strong> ${tokenRequest.tokens_requested}</p>
          <p><strong>Status:</strong> 
            <span style="color: ${isEarlyAccessFree ? '#10b981' : '#f59e0b'}; font-weight: bold;">
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

        <div style="padding: 15px; border-radius: 8px; margin: 20px 0; ${isEarlyAccessFree ? 'background: #dcfce7; border: 1px solid #10b981;' : 'background: #fef3c7; border: 1px solid #f59e0b;'}">
          ${isEarlyAccessFree ? 
            '<p style="color: #059669; margin: 0;"><strong>✅ This request was automatically approved</strong> (under 500 tokens/month Early Access policy). Tokens have been added to the user\'s account.</p>' :
            '<p style="color: #d97706; margin: 0;"><strong>⚠️ This request requires manual processing</strong> (exceeds 500 tokens/month Early Access limit). Payment coordination needed.</p>'}
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
        name: 'Racetagger Desktop',
        email: 'info@racetagger.cloud'
      },
      to: [
        {
          email: ADMIN_EMAIL,
          name: 'Racetagger Admin'
        }
      ],
      subject: emailSubject,
      htmlContent: emailHtml,
      replyTo: {
        email: tokenRequest.user_email,
        name: tokenRequest.user_email
      },
      tags: ['token-request', isEarlyAccessFree ? 'early-access-free' : 'payment-required']
    };

    console.log('[Email Service] Sending email to Brevo API...');
    console.log('[Email Service] Email payload:', JSON.stringify(emailPayload, null, 2));
    
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoApiKey,
        'Accept': 'application/json'
      },
      body: JSON.stringify(emailPayload),
    });

    console.log('[Email Service] Brevo API response status:', response.status);
    
    const responseData = await response.json();
    console.log('[Email Service] Brevo API response:', responseData);
    
    if (!response.ok) {
      console.error('[Email Service] Brevo API error:', {
        status: response.status,
        statusText: response.statusText,
        response: responseData
      });
      
      return {
        success: false,
        error: `Brevo API error: ${responseData.message || response.statusText}`
      };
    }

    console.log('[Email Service] Email sent successfully:', responseData);
    
    return {
      success: true,
      messageId: responseData.messageId
    };

  } catch (error: any) {
    console.error('[Email Service] Error sending email:', error);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}