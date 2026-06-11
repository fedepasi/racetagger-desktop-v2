import { app } from 'electron';
import * as config from './config';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const ADMIN_EMAIL = 'info@racetagger.cloud';
const GALLERY_PORTAL_BASE = 'https://photos.racetagger.cloud';

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
  isFreeTier: boolean
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
      tags: ['token-request', isFreeTier ? 'free-tier' : 'payment-required']
    };

    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoApiKey,
        'Accept': 'application/json'
      },
      body: JSON.stringify(emailPayload),
    });

    const responseData = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: `Brevo API error: ${responseData.message || response.statusText}`
      };
    }

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

// ==================== CLIENT INVITE EMAIL ====================

export interface ClientInviteEmailData {
  recipientEmail: string;
  recipientName: string;
  inviteToken: string;
  clientName: string;
  portalSlug: string;
}

/**
 * Send an invite email to a client user so they can complete registration.
 * The email contains a link to the gallery portal with the invite token.
 */
export async function sendClientInviteEmailViaBrevo(data: ClientInviteEmailData): Promise<EmailResult> {
  try {
    const brevoApiKey = config.getBREVO_API_KEY();
    if (!brevoApiKey) {
      console.error('[Email Service] BREVO_API_KEY not found');
      return { success: false, error: 'BREVO_API_KEY not configured' };
    }

    const inviteUrl = data.portalSlug
      ? `${GALLERY_PORTAL_BASE}/c/${data.portalSlug}/invite?token=${data.inviteToken}`
      : `${GALLERY_PORTAL_BASE}/invite?token=${data.inviteToken}`;

    const emailSubject = `You're invited to access ${data.clientName} photos on RaceTagger`;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 32px 32px 24px;">
          <div style="font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">RaceTagger</div>
          <div style="font-size: 13px; color: #64748b;">Photo Delivery Portal</div>
        </div>

        <div style="padding: 24px 32px 32px;">
          <p style="font-size: 15px; color: #e2e8f0; margin: 0 0 16px;">
            Hi ${data.recipientName},
          </p>
          <p style="font-size: 15px; color: #94a3b8; margin: 0 0 24px; line-height: 1.6;">
            You've been invited to access <strong style="color: #e2e8f0;">${data.clientName}</strong> race photography on RaceTagger.
            Click the button below to create your account and start viewing your galleries.
          </p>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${inviteUrl}" style="display: inline-block; background: #06b6d4; color: #0f172a; font-weight: 700; font-size: 15px; padding: 14px 36px; border-radius: 8px; text-decoration: none; letter-spacing: 0.3px;">
              Accept Invitation
            </a>
          </div>

          <p style="font-size: 12px; color: #64748b; margin: 24px 0 0; line-height: 1.5;">
            This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
          </p>

          <hr style="border: none; border-top: 1px solid #1e293b; margin: 24px 0;">

          <p style="font-size: 11px; color: #475569; margin: 0; text-align: center;">
            Sent via <a href="https://racetagger.com" style="color: #06b6d4; text-decoration: none;">RaceTagger</a> — AI-powered race photography
          </p>
        </div>
      </div>
    `;

    const emailPayload = {
      sender: { name: 'RaceTagger', email: 'info@racetagger.cloud' },
      to: [{ email: data.recipientEmail, name: data.recipientName }],
      subject: emailSubject,
      htmlContent: emailHtml,
      replyTo: { email: ADMIN_EMAIL, name: 'RaceTagger Support' },
      tags: ['client-invite', 'delivery-portal'],
    };

    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoApiKey,
        'Accept': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return { success: false, error: `Brevo API error: ${responseData.message || response.statusText}` };
    }

    console.log(`[Email Service] Invite email sent to ${data.recipientEmail} (messageId: ${responseData.messageId})`);
    return { success: true, messageId: responseData.messageId };

  } catch (error: any) {
    console.error('[Email Service] Error sending invite email:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}