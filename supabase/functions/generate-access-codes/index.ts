import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
import { corsHeaders } from '../shared/cors.ts';

// Funzione per generare un codice casuale
function generateAccessCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Esclusi caratteri ambigui
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  // Verifica autenticazione admin
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Verifica che il token appartenga a un admin
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Verifica se l'utente è admin
    const { data: adminCheck } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single();
      
    if (!adminCheck) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Ottieni i primi 50 iscritti che non hanno ancora un codice di accesso
    const { data: subscribers } = await supabase
      .from('subscribers')
      .select('id, email, name')
      .eq('has_access', false)
      .order('position', { ascending: true })
      .limit(50);
    
    if (!subscribers || subscribers.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No subscribers need access codes' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Configura il client SMTP per Brevo
    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get("SMTP_HOST")!,
        port: parseInt(Deno.env.get("SMTP_PORT")!),
        tls: Deno.env.get("SMTP_SECURE") === "true",
        auth: {
          username: Deno.env.get("SMTP_USER")!,
          password: Deno.env.get("SMTP_PASSWORD")!,
        },
      },
    });
    
    // Genera e invia codici di accesso
    const results = [];
    
    for (const subscriber of subscribers) {
      // Genera un codice univoco
      const accessCode = generateAccessCode(10);
      
      // Aggiorna il database (tabella subscribers)
      const { error: updateSubscriberError } = await supabase
        .from('subscribers')
        .update({
          access_code: accessCode,
          has_access: true // Indica che un codice è stato generato per questo iscritto
        })
        .eq('id', subscriber.id);
      
      if (updateSubscriberError) {
        results.push({
          email: subscriber.email,
          success: false,
          error: `Failed to update subscriber: ${updateSubscriberError.message}`
        });
        continue;
      }

      // Inserisci nella tabella access_codes
      // Definisci una data di scadenza, ad esempio 1 anno da ora
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      const { error: insertAccessCodeError } = await supabase
        .from('access_codes')
        .insert({
          code_value: accessCode,
          subscriber_email: subscriber.email,
          tokens_to_grant: 0, // O un valore di default se preferisci
          status: 'active',
          is_used: false,
          expires_at: expiryDate.toISOString()
        });

      if (insertAccessCodeError) {
        results.push({
          email: subscriber.email,
          success: false,
          error: `Failed to insert into access_codes: ${insertAccessCodeError.message}`
        });
        // Potresti voler considerare un rollback o una gestione dell'errore più complessa qui,
        // ad esempio, se l'aggiornamento di 'subscribers' è riuscito ma l'inserimento in 'access_codes' fallisce.
        // Per ora, continuiamo con il prossimo iscritto.
        continue;
      }
      
      // Invia email con il codice
      try {
        await client.send({
          from: Deno.env.get("SMTP_FROM_EMAIL")!,
          to: subscriber.email,
          subject: "Il tuo codice di accesso per RaceTagger Desktop",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #2563eb;">RaceTagger Desktop è pronto!</h1>
              <p>Ciao ${subscriber.name || 'Utente'},</p>
              <p>Siamo lieti di informarti che RaceTagger Desktop è ora disponibile per l'accesso anticipato.</p>
              <p>Ecco il tuo codice di accesso esclusivo:</p>
              <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0;">
                ${accessCode}
              </div>
              <p>Per utilizzare il codice:</p>
              <ol>
                <li>Download RaceTagger Desktop from our website</li>
                <li>Launch the application</li>
                <li>Enter the code when prompted</li>
              </ol>
              <p>Thank you for being among our first users!</p>
              <p>The RaceTagger Team</p>
            </div>
          `,
        });
        
        results.push({
          email: subscriber.email,
          success: true
        });
      } catch (emailError) {
        results.push({
          email: subscriber.email,
          success: false,
          error: emailError.message
        });
      }
    }
    
    await client.close();
    
    return new Response(
      JSON.stringify({ 
        message: `Processed ${subscribers.length} subscribers`,
        results 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
