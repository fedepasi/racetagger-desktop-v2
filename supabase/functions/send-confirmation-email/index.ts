import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { email, name, position, referralCode, bonusTokens } = await req.json();
    
    console.log('Received email request:', { email, name, position, referralCode, bonusTokens });
    
    // Verify Brevo API environment variables
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const fromEmail = Deno.env.get("SMTP_FROM_EMAIL") || "info@racetagger.cloud";
    const fromName = Deno.env.get("SMTP_FROM_NAME") || "RaceTagger Team";
    
    console.log('Brevo Config:', { brevoApiKey: !!brevoApiKey, fromEmail, fromName });
    
    if (!brevoApiKey) {
      throw new Error('Missing Brevo API key');
    }
    
    // Prepara il contenuto dell'email
    const isEarlyAccess = position <= 50;
    const totalTokens = bonusTokens || 1500;
    const tokenValue = Math.round(totalTokens * 0.02); // $0.02 per token
    const baseUrl = Deno.env.get("FRONTEND_URL") || "https://racetagger.cloud";
    const referralLink = `${baseUrl}/?ref=${referralCode}`;
    
    const subject = isEarlyAccess 
      ? `🎉 Welcome to RaceTagger Early Access - ${totalTokens} Free Tokens!` 
      : `🎁 You're on the RaceTagger Waitlist - ${totalTokens} Tokens Await You!`;
    
    const htmlBody = isEarlyAccess 
      ? `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: rgba(255,255,255,0.1); padding: 30px; text-align: center; backdrop-filter: blur(10px);">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">🎉 Congratulations, ${name || 'User'}!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 18px;">You're <strong>#${position}</strong> on the Early Access list</p>
          </div>
          
          <!-- Main Content -->
          <div style="background: white; padding: 40px;">
            <!-- Token Bonus Section -->
            <div style="background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%); border-radius: 15px; padding: 25px; margin-bottom: 30px; text-align: center;">
              <h2 style="color: #2d3436; margin: 0 0 15px 0; font-size: 24px;">🎁 Your Free Tokens</h2>
              <div style="font-size: 36px; font-weight: bold; color: #e17055; margin: 10px 0;">${totalTokens} TOKENS</div>
              <p style="color: #636e72; margin: 5px 0; font-size: 16px;">Value: <strong>$${tokenValue}</strong> • Already credited to your account!</p>
              <div style="background: rgba(255,255,255,0.7); border-radius: 10px; padding: 15px; margin-top: 15px;">
                <p style="margin: 0; color: #2d3436; font-size: 14px;"><strong>💡 What you can do:</strong></p>
                <p style="margin: 5px 0 0 0; color: #636e72; font-size: 14px;">• Analyze up to ${Math.floor(totalTokens/1)} photos for free<br>• Test all premium features<br>• Earn extra tokens with referrals and feedback</p>
              </div>
            </div>

            <!-- Referral Section -->
            <div style="background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%); border-radius: 15px; padding: 25px; margin-bottom: 30px; color: white;">
              <h2 style="margin: 0 0 20px 0; font-size: 22px; text-align: center;">🚀 Earn Extra Tokens with Referrals</h2>
              
              <div style="background: rgba(255,255,255,0.15); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Your Referral Link:</p>
                <div style="background: rgba(255,255,255,0.9); border-radius: 8px; padding: 12px; word-break: break-all;">
                  <a href="${referralLink}" style="color: #0984e3; text-decoration: none; font-weight: 600;">${referralLink}</a>
                </div>
                <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Code: <strong>${referralCode}</strong></p>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 15px; text-align: center;">
                  <div style="font-size: 24px; font-weight: bold;">100</div>
                  <div style="font-size: 12px; opacity: 0.8;">Tokens per referral<br>(1-5 referrals)</div>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 15px; text-align: center;">
                  <div style="font-size: 24px; font-weight: bold;">150</div>
                  <div style="font-size: 12px; opacity: 0.8;">Tokens per referral<br>(6-15 referrals)</div>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 15px; text-align: center;">
                  <div style="font-size: 24px; font-weight: bold;">200</div>
                  <div style="font-size: 12px; opacity: 0.8;">Tokens per referral<br>(16+ referrals)</div>
                </div>
              </div>

              <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 15px;">
                <p style="margin: 0 0 10px 0; font-weight: 600;">🎯 Bonus Milestones:</p>
                <p style="margin: 0; font-size: 14px; opacity: 0.9;">• 5 referrals → +500 token bonus<br>• 10 referrals → +1,000 token bonus<br>• 25 referrals → +2,500 token bonus</p>
              </div>
            </div>


            <!-- Next Steps -->
            <div style="background: #2d3436; border-radius: 15px; padding: 25px; color: white; text-align: center;">
              <h3 style="margin: 0 0 15px 0; font-size: 20px;">🚀 Next Steps</h3>
              <p style="margin: 0 0 20px 0; opacity: 0.9;">We'll send you an email with access instructions when the app is ready.</p>
              <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 14px;"><strong>📅 Expected Timeline:</strong></p>
                <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">Alpha Release: September 2025<br>Stable Release: Early 2026</p>
              </div>
              <p style="margin: 0; font-size: 14px; opacity: 0.8;">In the meantime, start sharing your referral link!</p>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #2d3436; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.7); margin: 0; font-size: 14px;">
              Have questions? Reply to this email or contact us at 
              <a href="mailto:info@racetagger.cloud" style="color: #74b9ff;">info@racetagger.cloud</a>
            </p>
            <p style="color: rgba(255,255,255,0.5); margin: 10px 0 0 0; font-size: 12px;">
              The RaceTagger Team • Powered by AI • Made with ❤️ for photographers
            </p>
          </div>
        </div>
      `
      : `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background: linear-gradient(135deg, #a29bfe 0%, #6c5ce7 100%); border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: rgba(255,255,255,0.1); padding: 30px; text-align: center; backdrop-filter: blur(10px);">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">🎁 Thank you for your interest, ${name || 'User'}!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 18px;">You're on the waitlist for RaceTagger Desktop</p>
          </div>
          
          <!-- Main Content -->
          <div style="background: white; padding: 40px;">
            <!-- Token Bonus Section -->
            <div style="background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%); border-radius: 15px; padding: 25px; margin-bottom: 30px; text-align: center;">
              <h2 style="color: #2d3436; margin: 0 0 15px 0; font-size: 24px;">🎁 Your Tokens Are Waiting!</h2>
              <div style="font-size: 36px; font-weight: bold; color: #e17055; margin: 10px 0;">${totalTokens} TOKENS</div>
              <p style="color: #636e72; margin: 5px 0; font-size: 16px;">Value: <strong>$${tokenValue}</strong> • Will be credited when you get access!</p>
            </div>

            <!-- Referral Section -->
            <div style="background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%); border-radius: 15px; padding: 25px; margin-bottom: 30px; color: white;">
              <h2 style="margin: 0 0 20px 0; font-size: 22px; text-align: center;">🚀 Skip the Queue with Referrals!</h2>
              
              <div style="background: rgba(255,255,255,0.15); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Your Referral Link:</p>
                <div style="background: rgba(255,255,255,0.9); border-radius: 8px; padding: 12px; word-break: break-all;">
                  <a href="${referralLink}" style="color: #0984e3; text-decoration: none; font-weight: 600;">${referralLink}</a>
                </div>
                <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Code: <strong>${referralCode}</strong></p>
              </div>

              <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 20px; text-align: center;">
                <h3 style="margin: 0 0 15px 0; font-size: 18px;">💡 Early Access Strategy</h3>
                <p style="margin: 0; font-size: 14px; opacity: 0.9;">Bring 3+ friends and you might skip the waitlist!<br>More referrals = higher priority + more bonus tokens</p>
              </div>
            </div>

            <!-- Status -->
            <div style="background: #f8f9fa; border-radius: 15px; padding: 25px; margin-bottom: 30px; text-align: center;">
              <h3 style="color: #2d3436; margin: 0 0 15px 0; font-size: 20px;">📊 Your Status</h3>
              <p style="color: #636e72; margin: 0; font-size: 16px;">The first 50 spots are taken, but with referrals you can earn early access!</p>
              <div style="background: #e17055; color: white; border-radius: 10px; padding: 15px; margin-top: 15px;">
                <p style="margin: 0; font-weight: 600;">🎯 Goal: Bring 3+ friends for priority access</p>
              </div>
            </div>

            <!-- Next Steps -->
            <div style="background: #2d3436; border-radius: 15px; padding: 25px; color: white; text-align: center;">
              <h3 style="margin: 0 0 15px 0; font-size: 20px;">🚀 What to Do Now</h3>
              <p style="margin: 0 0 20px 0; opacity: 0.9;">Start sharing your referral link right away to earn early access!</p>
              <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 15px;">
                <p style="margin: 0; font-size: 14px;"><strong>📅 We'll keep you updated via email on your progress</strong></p>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #2d3436; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.7); margin: 0; font-size: 14px;">
              Have questions? Reply to this email or contact us at 
              <a href="mailto:info@racetagger.cloud" style="color: #74b9ff;">info@racetagger.cloud</a>
            </p>
            <p style="color: rgba(255,255,255,0.5); margin: 10px 0 0 0; font-size: 12px;">
              The RaceTagger Team • Powered by AI • Made with ❤️ for photographers
            </p>
          </div>
        </div>
      `;
    
    // Invia l'email tramite Brevo API
    console.log('Sending email via Brevo API...', { from: fromEmail, to: email, subject });
    
    const emailPayload = {
      sender: {
        name: fromName,
        email: fromEmail
      },
      to: [
        {
          email: email,
          name: name || email
        }
      ],
      subject: subject,
      htmlContent: htmlBody
    };
    
    console.log('Email payload prepared');
    
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': brevoApiKey
      },
      body: JSON.stringify(emailPayload)
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Brevo API error:', response.status, errorData);
      throw new Error(`Failed to send email via Brevo: ${response.status} - ${errorData}`);
    }
    
    const result = await response.json();
    console.log('Email sent successfully via Brevo API:', result);
    
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending email:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
