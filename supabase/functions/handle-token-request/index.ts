import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verifica autenticazione
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized - Missing authorization header', { 
        status: 401,
        headers: corsHeaders 
      })
    }

    // Crea client con service role (disponibile automaticamente nelle Edge Functions)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // Chiave admin, sicura server-side
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Verifica utente dal token JWT
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      console.error('[Token Request] Auth error:', userError)
      return new Response('Invalid authentication token', { 
        status: 401,
        headers: corsHeaders 
      })
    }

    console.log(`[Token Request] Authenticated user: ${user.email}`)

    // Parse request body
    const { tokensRequested, message } = await req.json()
    
    if (!tokensRequested || isNaN(tokensRequested) || tokensRequested <= 0) {
      return new Response('Invalid tokens requested amount', { 
        status: 400,
        headers: corsHeaders 
      })
    }

    // Calcola i token gratuiti già ricevuti questo mese
    console.log(`[Token Request] Checking free tokens usage for this month...`);
    
    const { data: monthlyTokens, error: monthlyError } = await supabaseAdmin
      .from('token_requests')
      .select('tokens_requested')
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .gte('request_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
      .lt('request_date', new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString());

    if (monthlyError) {
      console.error('[Token Request] Error fetching monthly tokens:', monthlyError);
      // In caso di errore, procedi con cautela - non approvare automaticamente
      throw new Error(`Failed to check monthly token usage: ${monthlyError.message}`);
    }

    const freeTokensThisMonth = monthlyTokens?.reduce((sum, req) => sum + req.tokens_requested, 0) || 0;
    const remainingFreeTokens = Math.max(0, 100 - freeTokensThisMonth);

    console.log(`[Token Request] Monthly free tokens used: ${freeTokensThisMonth}/100, remaining: ${remainingFreeTokens}`);

    // Verifica se questa richiesta può essere gratuita
    const isFreeTier = tokensRequested <= remainingFreeTokens;

    console.log(`[Token Request] Processing: ${tokensRequested} tokens, Free Tier: ${isFreeTier}, Monthly remaining: ${remainingFreeTokens}`)

    // Se il limite mensile è raggiunto, gestisci di conseguenza
    if (!isFreeTier && remainingFreeTokens === 0) {
      console.log('[Token Request] Monthly limit completely reached, saving request for payment processing');
      
      // Salva comunque la richiesta per elaborazione manuale
      const tokenRequest = {
        user_id: user.id,
        user_email: user.email || '',
        tokens_requested: parseInt(tokensRequested),
        message: message || null,
        request_date: new Date().toISOString(),
        status: 'pending'
      }

      const { data: requestData, error: insertError } = await supabaseAdmin
        .from('token_requests')
        .insert([tokenRequest])
        .select()
        .single()

      if (insertError) {
        console.error('[Token Request] DB insert error:', insertError)
        throw new Error(`Failed to create token request: ${insertError.message}`)
      }

      // Send email notification for payment-required case
      try {
        console.log('[Token Request] Sending email notification for payment-required request...')
        
        const emailResponse = await supabaseAdmin.functions.invoke('send-token-request-email', {
          body: { 
            tokenRequest: requestData, 
            isFreeTier: false 
          }
        })
        
        if (emailResponse.error) {
          console.error('[Token Request] Email notification error:', emailResponse.error)
        } else {
          console.log('[Token Request] Email notification sent successfully')
        }
      } catch (emailError) {
        console.error('[Token Request] Email notification failed:', emailError)
      }

      // Restituisci risposta con informazioni sul limite raggiunto
      return new Response(
        JSON.stringify({
          success: false,
          message: `🎯 Your request for ${tokensRequested} tokens has been submitted! You've reached the 100 free tokens monthly limit. Our team will contact you within 24-48 hours with a personalized offer.`,
          requestSaved: true,
          requestId: requestData.id,
          paymentRequired: true,
          tokenRequest: requestData, // Add this for main process email sending
          monthlyUsage: {
            used: freeTokensThisMonth,
            limit: 100,
            remaining: 0
          }
        }),
        { 
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders 
          },
          status: 200  // Status 200 ma success: false per indicare limite raggiunto
        }
      )
    }

    if (!isFreeTier && remainingFreeTokens > 0) {
      console.log(`[Token Request] Request exceeds remaining free tokens (${remainingFreeTokens}), saving for payment processing`);
      
      // Salva la richiesta per elaborazione manuale
      const tokenRequest = {
        user_id: user.id,
        user_email: user.email || '',
        tokens_requested: parseInt(tokensRequested),
        message: message || null,
        request_date: new Date().toISOString(),
        status: 'pending'
      }

      const { data: requestData, error: insertError } = await supabaseAdmin
        .from('token_requests')
        .insert([tokenRequest])
        .select()
        .single()

      if (insertError) {
        console.error('[Token Request] DB insert error:', insertError)
        throw new Error(`Failed to create token request: ${insertError.message}`)
      }

      // Send email notification for payment-required case (exceeds remaining free tokens)
      try {
        console.log('[Token Request] Sending email notification for payment-required request (partial limit)...')
        
        const emailResponse = await supabaseAdmin.functions.invoke('send-token-request-email', {
          body: { 
            tokenRequest: requestData, 
            isFreeTier: false 
          }
        })
        
        if (emailResponse.error) {
          console.error('[Token Request] Email notification error:', emailResponse.error)
        } else {
          console.log('[Token Request] Email notification sent successfully')
        }
      } catch (emailError) {
        console.error('[Token Request] Email notification failed:', emailError)
      }

      // Restituisci risposta con suggerimento per richiesta parziale
      return new Response(
        JSON.stringify({
          success: false,
          message: `📋 Your request for ${tokensRequested} tokens has been submitted! You have ${remainingFreeTokens} free tokens remaining this month. Our team will contact you within 24-48 hours with a personalized offer for the additional tokens.`,
          requestSaved: true,
          requestId: requestData.id,
          paymentRequired: true,
          tokenRequest: requestData, // Add this for main process email sending
          monthlyUsage: {
            used: freeTokensThisMonth,
            limit: 100,
            remaining: remainingFreeTokens
          },
          suggestion: remainingFreeTokens > 0 ? `💡 Alternative: You can make a new request for ${remainingFreeTokens} free tokens instead.` : null
        }),
        { 
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders 
          },
          status: 200
        }
      )
    }

    // Crea il token request nel database con service role (bypassa RLS) - solo per richieste approvate
    const tokenRequest = {
      user_id: user.id,
      user_email: user.email || '',
      tokens_requested: parseInt(tokensRequested),
      message: message || null,
      request_date: new Date().toISOString(),
      status: 'approved'
    }

    const { data: requestData, error: insertError } = await supabaseAdmin
      .from('token_requests')
      .insert([tokenRequest])
      .select()
      .single()

    if (insertError) {
      console.error('[Token Request] DB insert error:', insertError)
      throw new Error(`Failed to create token request: ${insertError.message}`)
    }

    console.log('[Token Request] Successfully created:', requestData.id)

    // Se Free Tier, assegna automaticamente i token
    if (isFreeTier) {
      try {
        console.log(`[Token Request] Auto-granting ${tokensRequested} tokens...`)
        
        // Usa RPC function per aggiornamento atomico
        const { data: tokenData, error: tokenError } = await supabaseAdmin.rpc('increment_user_tokens', {
          user_id: user.id,
          token_amount: tokensRequested
        })

        if (tokenError) {
          console.error('[Token Request] Token increment error:', tokenError)
          
          // Fallback: prova aggiornamento diretto
          const { error: fallbackError } = await supabaseAdmin.rpc('add_tokens_to_profile', {
            profile_id: user.id,
            token_amount: tokensRequested
          })
          
          if (fallbackError) {
            console.error('[Token Request] Fallback token update failed:', fallbackError)
          } else {
            console.log('[Token Request] Tokens added via fallback method')
          }
        } else {
          console.log('[Token Request] Tokens added successfully:', tokenData)
        }

        // Aggiorna la data di completamento senza cambiare lo status
        await supabaseAdmin
          .from('token_requests')
          .update({ 
            completed_date: new Date().toISOString() 
          })
          .eq('id', requestData.id)

      } catch (tokenError) {
        console.error('[Token Request] Error during token assignment:', tokenError)
      }
    }

    // Invia notifica email tramite l'altra Edge Function
    try {
      console.log('[Token Request] Sending email notification...')
      
      const emailResponse = await supabaseAdmin.functions.invoke('send-token-request-email', {
        body: {
          tokenRequest: requestData,
          isFreeTier
        }
      })
      
      if (emailResponse.error) {
        console.error('[Token Request] Email notification error:', emailResponse.error)
      } else {
        console.log('[Token Request] Email notification sent successfully')
      }
    } catch (emailError) {
      console.error('[Token Request] Email notification failed:', emailError)
    }

    // Prepara risposta per il client con informazioni sul limite mensile
    const newRemainingTokens = isFreeTier ? (remainingFreeTokens - tokensRequested) : remainingFreeTokens;

    const successMessage = isFreeTier
      ? `🎉 Free Tier: ${tokensRequested} tokens granted for free! You have ${newRemainingTokens} free tokens remaining this month.`
      : `Request submitted for ${tokensRequested} tokens. You have used ${freeTokensThisMonth}/100 free tokens this month${remainingFreeTokens > 0 ? ` (${remainingFreeTokens} remaining)` : ' (limit reached)'}. Payment coordination required - we'll contact you within 24 hours.`

    const response = {
      success: true,
      message: successMessage,
      requestId: requestData.id,
      isFreeTier,
      tokensGranted: isFreeTier ? tokensRequested : 0,
      paymentRequired: !isFreeTier,
      tokenRequest: requestData, // Add this for main process email sending
      monthlyUsage: {
        used: freeTokensThisMonth + (isFreeTier ? tokensRequested : 0),
        limit: 100,
        remaining: newRemainingTokens
      }
    }

    console.log('[Token Request] Request completed successfully')

    return new Response(
      JSON.stringify(response),
      { 
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders 
        } 
      }
    )

  } catch (error) {
    console.error('[Token Request] Unexpected error:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders 
        }, 
        status: 500 
      }
    )
  }
})