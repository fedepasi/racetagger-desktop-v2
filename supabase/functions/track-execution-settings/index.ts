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
    const { execution_settings, validation_info } = body

    // Handle new comprehensive format or legacy format
    let settings: any;
    
    if (execution_settings) {
      // New comprehensive format
      console.log('Processing comprehensive execution settings for:', execution_settings.execution_id)
      
      if (!execution_settings.execution_id) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'execution_id is required in execution_settings' 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
      }

      // Use the comprehensive execution settings directly
      settings = {
        ...execution_settings,
        // Ensure user_id matches authenticated user
        user_id: user.id
      }

      // Log validation info if provided
      if (validation_info && !validation_info.isValid) {
        console.warn('Validation warnings for execution settings:', validation_info.errors)
      }

    } else {
      // Legacy format support (old format)
      const { execution_id, config, stats, app_version } = body
      console.log('Processing legacy execution settings format for:', execution_id)

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

      // Legacy mapping (for backward compatibility)
      settings = {
        execution_id,
        user_id: user.id,
        
        // Basic system info (legacy doesn't have comprehensive data)
        client_version: app_version || 'unknown',
        operating_system: 'Unknown',
        os_version: 'Unknown',
        system_arch: 'unknown',
        client_session_id: `legacy_${Date.now()}`,
        client_machine_id: `legacy_${user.id.substring(0, 8)}`,
        client_build_number: 'legacy',
        
        // AI settings
        ai_model: config?.model || null,
        sport_category: config?.category || 'motorsport',
        
        // Processing settings
        metadata_strategy: config?.metadataStrategy || null,
        manual_metadata_value: config?.manualMetadataValue || null,
        update_exif: config?.updateExif !== false,
        save_preview_images: config?.savePreviewImages || false,
        preview_folder: config?.previewFolder || null,
        resize_enabled: config?.resize?.enabled || false,
        resize_preset: config?.resize?.preset || null,
        parallel_processing_enabled: config?.useParallelProcessing || false,
        streaming_pipeline_enabled: config?.useStreamingPipeline || false,
        max_concurrent_uploads: config?.parallelization?.maxConcurrentUploads || null,
        max_concurrent_analysis: config?.parallelization?.maxConcurrentAnalysis || null,
        rate_limit_per_second: config?.parallelization?.rateLimitPerSecond || null,
        batch_size: config?.parallelization?.batchSize || null,
        
        // Folder organization
        folder_organization_enabled: config?.folderOrganization?.enabled || false,
        folder_organization_mode: config?.folderOrganization?.mode || null,
        folder_organization_pattern: config?.folderOrganization?.pattern || null,
        folder_organization_custom_pattern: config?.folderOrganization?.customPattern || null,
        create_unknown_folder: config?.folderOrganization?.createUnknownFolder !== false,
        unknown_folder_name: config?.folderOrganization?.unknownFolderName || 'Unknown',
        include_xmp_files: config?.folderOrganization?.includeXmpFiles !== false,
        
        // Performance
        optimization_level: config?.optimizationLevel || 'balanced',
        performance_monitoring_enabled: config?.performanceMonitoring !== false,
        session_resume_enabled: config?.sessionResume !== false,
        
        // Statistics
        total_images_processed: stats?.totalImages || 0,
        total_raw_files: stats?.totalRawFiles || 0,
        total_standard_files: stats?.totalStandardFiles || 0,
        csv_data_used: !!(config?.csvData && config.csvData.length > 0),
        csv_entries_count: config?.csvData?.length || 0,
        execution_duration_ms: stats?.executionDurationMs || null,
        average_image_processing_time_ms: stats?.averageImageProcessingTimeMs || null,
        
        // Default values for missing fields
        raw_optimizations_enabled: false,
        raw_cache_enabled: false,
        connection_pooling_enabled: false,
        async_file_ops_enabled: false,
        database_optimizations_enabled: false,
        batch_operations_enabled: false,
        storage_optimizations_enabled: false,
        memory_optimizations_enabled: false,
        memory_pooling_enabled: false,
        cpu_optimizations_enabled: false,
        streaming_processing_enabled: false,
        auto_tuning_enabled: false,
        predictive_loading_enabled: false
      }
    }

    // Validate execution exists (optional, for data integrity)
    const { data: execution, error: execError } = await supabaseClient
      .from('executions')
      .select('id')
      .eq('id', settings.execution_id)
      .eq('user_id', user.id)
      .single()

    if (execError || !execution) {
      console.warn(`Execution ${settings.execution_id} not found for user ${user.id}`)
      // Don't block, return success with warning
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: 'Execution not found, tracking skipped',
          execution_id: settings.execution_id
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Log comprehensive settings being saved (for debugging)
    console.log('Saving comprehensive execution settings:', {
      execution_id: settings.execution_id,
      client_version: settings.client_version,
      operating_system: settings.operating_system,
      ai_model: settings.ai_model,
      sport_category: settings.sport_category,
      total_images: settings.total_images_processed,
      csv_used: settings.csv_data_used,
      field_count: Object.keys(settings).length
    })

    // Save the comprehensive execution settings
    const { data, error } = await supabaseClient
      .from('execution_settings')
      .insert([settings])
      .select()
      .single()

    if (error) {
      console.error('Error saving execution settings:', error)
      console.error('Settings that failed to save:', JSON.stringify(settings, null, 2))
      
      // Check for specific database errors
      if (error.message?.includes('violates not-null constraint')) {
        console.error('NULL constraint violation - check required fields')
      }
      if (error.message?.includes('invalid input syntax')) {
        console.error('Data type mismatch - check field types')
      }
      
      // Don't block the app, return success with warning
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: 'Failed to save comprehensive settings', 
          error: error.message,
          error_code: error.code,
          execution_id: settings.execution_id
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Success!
    console.log(`Comprehensive settings tracked successfully for execution ${settings.execution_id}`)
    console.log(`Saved ${Object.keys(settings).length} fields including system info and performance metrics`)
    
    // Return detailed success response
    return new Response(
      JSON.stringify({ 
        success: true, 
        data: { 
          id: data.id,
          execution_id: settings.execution_id,
          fields_saved: Object.keys(settings).length,
          system_info_included: !!(settings.client_version && settings.operating_system),
          performance_metrics_included: !!(settings.execution_duration_ms || settings.total_images_processed)
        }
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