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
    const { reportId, userEmail, platform, appVersion, storagePath, signedUrl, summary } = await req.json();

    if (!reportId) {
      return new Response(
        JSON.stringify({ success: false, error: 'reportId is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    await sendDiagnosticNotificationEmail({
      reportId,
      userEmail: userEmail || 'unknown',
      platform: platform || 'unknown',
      appVersion: appVersion || 'unknown',
      storagePath: storagePath || '',
      signedUrl: signedUrl || '',
      summary: summary || '',
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Notification email sent' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[DiagnosticEmail] Error:', error);

    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

interface DiagnosticEmailData {
  reportId: string;
  userEmail: string;
  platform: string;
  appVersion: string;
  storagePath: string;
  signedUrl: string;
  summary: string;
}

async function sendDiagnosticNotificationEmail(data: DiagnosticEmailData) {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');

  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY not configured');
  }

  const emailSubject = `🔧 Diagnostic Report - ${data.userEmail} (${data.platform})`;

  // Build the download button/link section
  const downloadSection = data.signedUrl
    ? `
      <div style="text-align: center; margin: 25px 0;">
        <a href="${data.signedUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px;
                  border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
          📄 Download Full Diagnostic Report
        </a>
        <p style="color: #6b7280; font-size: 11px; margin-top: 8px;">Link valid for 7 days</p>
      </div>
    `
    : `
      <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 8px; margin: 20px 0;">
        <p style="color: #d97706; margin: 0; font-size: 13px;">
          ⚠️ Signed URL not available. View file manually:<br>
          <code style="font-size: 11px;">Supabase Dashboard → Storage → ${data.storagePath}</code>
        </p>
      </div>
    `;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333; border-bottom: 3px solid #3b82f6;">
        🔧 New Diagnostic Report
      </h2>

      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>User:</strong> ${data.userEmail}</p>
        <p><strong>Platform:</strong> ${data.platform}</p>
        <p><strong>App Version:</strong> ${data.appVersion}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString('it-IT')}</p>
        <p style="color: #9ca3af; font-size: 11px; margin-bottom: 0;"><strong>Report ID:</strong> ${data.reportId}</p>
      </div>

      ${downloadSection}

      ${data.summary ? `
      <div style="background: #fff; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
        <h4 style="margin-top: 0; color: #f59e0b;">⚡ Quick Summary:</h4>
        <pre style="margin-bottom: 0; white-space: pre-wrap; font-size: 12px; color: #374151;">${data.summary}</pre>
      </div>
      ` : ''}

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

      <div style="font-size: 12px; color: #6b7280; text-align: center;">
        <p>RaceTagger Desktop - Remote Diagnostics</p>
      </div>
    </div>
  `;

  const emailPayload = {
    sender: {
      name: "RaceTagger Diagnostics",
      email: "info@racetagger.cloud"
    },
    to: [{
      email: ADMIN_EMAIL,
      name: "RaceTagger Admin"
    }],
    subject: emailSubject,
    htmlContent: emailHtml,
    tags: ['diagnostic-report', data.platform.split(' ')[0]]
  };

  console.log('[DiagnosticEmail] Sending notification via Brevo...');

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
    console.error('[DiagnosticEmail] Brevo error:', response.status, errorData);
    throw new Error(`Failed to send email: ${errorData}`);
  }

  const responseData = await response.json();
  console.log('[DiagnosticEmail] Email sent successfully:', responseData);

  return responseData;
}
