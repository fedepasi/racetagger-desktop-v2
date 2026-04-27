// Edge Function: track-execution-settings
// Questa edge function gestisce il tracciamento delle impostazioni di execution
// in modo asincrono e non bloccante

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      console.warn('User not authenticated, skipping tracking')
      // Non blocchiamo, restituiamo success
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'User not authenticated' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Parse request body
    const body = await req.json()
    const { execution_id, config, stats, app_version } = body

    if (!execution_id) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'execution_id is required' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      )
    }

    // Estrai le impostazioni dal config
    const settings = {
      execution_id,
      user_id: user.id,
      
      // Informazioni versione app (utile per analisi)
      app_version: app_version || 'unknown',
      
      // Impostazioni AI
      ai_model: config?.model || null,
      sport_category: config?.category || 'motorsport',
      
      // Gestione Metadati
      metadata_strategy: config?.metadataStrategy || null,
      manual_metadata_value: config?.manualMetadataValue || null,
      update_exif: config?.updateExif !== false,
      save_preview_images: config?.savePreviewImages || false,
      preview_folder: config?.previewFolder || null,
      
      // Resize
      resize_enabled: config?.resize?.enabled || false,
      resize_preset: config?.resize?.preset || null,
      
      // Elaborazione Parallela
      parallel_processing_enabled: config?.useParallelProcessing || false,
      streaming_pipeline_enabled: config?.useStreamingPipeline || false,
      max_concurrent_uploads: config?.parallelization?.maxConcurrentUploads || null,
      max_concurrent_analysis: config?.parallelization?.maxConcurrentAnalysis || null,
      rate_limit_per_second: config?.parallelization?.rateLimitPerSecond || null,
      batch_size: config?.parallelization?.batchSize || null,
      
      // Folder Organization (Admin feature)
      folder_organization_enabled: config?.folderOrganization?.enabled || false,
      folder_organization_mode: config?.folderOrganization?.mode || null,
      folder_organization_pattern: config?.folderOrganization?.pattern || null,
      folder_organization_custom_pattern: config?.folderOrganization?.customPattern || null,
      create_unknown_folder: config?.folderOrganization?.createUnknownFolder !== false,
      unknown_folder_name: config?.folderOrganization?.unknownFolderName || 'Unknown',
      include_xmp_files: config?.folderOrganization?.includeXmpFiles !== false,
      
      // Performance Settings (potrebbero arrivare dal client)
      optimization_level: config?.optimizationLevel || 'balanced',
      performance_monitoring_enabled: config?.performanceMonitoring !== false,
      session_resume_enabled: config?.sessionResume !== false,
      
      // Statistiche Execution
      total_images_processed: stats?.totalImages || 0,
      total_raw_files: stats?.totalRawFiles || 0,
      total_standard_files: stats?.totalStandardFiles || 0,
      csv_data_used: !!(config?.csvData && config.csvData.length > 0),
      csv_entries_count: config?.csvData?.length || 0,
      
      // Timing
      execution_duration_ms: stats?.executionDurationMs || null,
      average_image_processing_time_ms: stats?.averageImageProcessingTimeMs || null,
    }

    // Verifica che l'execution esista (opzionale, per validazione)
    const { data: execution, error: execError } = await supabaseClient
      .from('executions')
      .select('id')
      .eq('id', execution_id)
      .eq('user_id', user.id)
      .single()

    if (execError || !execution) {
      console.warn(`Execution ${execution_id} not found for user ${user.id}`)
      // Non blocchiamo, restituiamo success con warning
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: 'Execution not found, tracking skipped' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Salva le impostazioni
    const { data, error } = await supabaseClient
      .from('execution_settings')
      .insert([settings])
      .select()
      .single()

    if (error) {
      console.error('Error saving execution settings:', error)
      // Non blocchiamo l'app, restituiamo success con warning
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: 'Failed to save settings', 
          error: error.message 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Success!
    console.log(`Settings tracked for execution ${execution_id}`)
    
    // Opzionale: Trigger analisi real-time o notifiche
    // await triggerAnalytics(settings);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        data: { id: data.id } 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Unexpected error in track-execution-settings:', error)
    // Non blocchiamo mai l'app principale
    return new Response(
      JSON.stringify({ 
        success: true, 
        warning: 'Tracking failed but execution continues',
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }
})