import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const { email, name, attributes = {} } = await req.json();
    
    // Configura la richiesta all'API di Brevo
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': Deno.env.get('BREVO_API_KEY')!
      },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: name?.split(' ')[0] || '',
          LASTNAME: name?.split(' ').slice(1).join(' ') || '',
          ...attributes
        },
        listIds: [parseInt(Deno.env.get('BREVO_LIST_ID')!)]
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Se il contatto esiste già, aggiorniamo solo le liste
      if (response.status === 400 && data.code === 'duplicate_parameter') {
        // Ottieni il contatto esistente
        const getContactResponse = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'api-key': Deno.env.get('BREVO_API_KEY')!
          }
        });
        
        if (getContactResponse.ok) {
          const contactData = await getContactResponse.json();
          
          // Aggiungi l'ID della lista se non è già presente
          const listIds = new Set([
            ...(contactData.listIds || []),
            parseInt(Deno.env.get('BREVO_LIST_ID')!)
          ]);
          
          // Aggiorna il contatto
          const updateResponse = await fetch(`https://api.brevo.com/v3/contacts`, {
            method: 'PUT',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'api-key': Deno.env.get('BREVO_API_KEY')!
            },
            body: JSON.stringify({
              email,
              attributes: {
                FIRSTNAME: name?.split(' ')[0] || contactData.attributes?.FIRSTNAME || '',
                LASTNAME: name?.split(' ').slice(1).join(' ') || contactData.attributes?.LASTNAME || '',
                ...attributes
              },
              listIds: Array.from(listIds)
            })
          });
          
          if (!updateResponse.ok) {
            throw new Error(`Failed to update contact in Brevo: ${await updateResponse.text()}`);
          }
          
          return new Response(
            JSON.stringify({ success: true, message: 'Contact updated in Brevo' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          throw new Error(`Failed to get contact from Brevo: ${await getContactResponse.text()}`);
        }
      } else {
        throw new Error(`Failed to add contact to Brevo: ${JSON.stringify(data)}`);
      }
    }
    
    return new Response(
      JSON.stringify({ success: true, message: 'Contact added to Brevo' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error syncing to Brevo:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
