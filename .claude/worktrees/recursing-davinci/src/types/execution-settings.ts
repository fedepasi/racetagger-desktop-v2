import { SystemInfo } from '../utils/system-info';

/**
 * Comprehensive execution settings tracking interface
 * Maps to the execution_settings table in Supabase
 */
export interface ExecutionSettingsData {
  // Core identifiers
  execution_id: string;
  user_id: string;

  // System information (Phase 1 - Critical)
  client_version: string;
  client_build_number: string;
  operating_system: string;
  os_version: string;
  system_arch: string;
  client_session_id: string;
  client_machine_id: string;

  // AI Configuration (Critical)
  ai_model: string;
  sport_category: string;
  enable_bounding_boxes: boolean;  // V3 Edge Function with bounding box detection

  // Performance Metrics (Phase 2 - Important)
  execution_duration_ms?: number;
  average_image_processing_time_ms?: number;
  total_images_processed: number;
  total_raw_files: number;
  total_standard_files: number;

  // CSV Data Usage
  csv_data_used: boolean;
  csv_entries_count?: number;

  // Image Processing Settings
  resize_enabled: boolean;
  resize_preset?: string;
  update_exif: boolean;
  save_preview_images: boolean;
  preview_folder?: string;

  // Performance Settings
  parallel_processing_enabled: boolean;
  streaming_pipeline_enabled: boolean;
  max_concurrent_uploads?: number;
  max_concurrent_analysis?: number;
  optimization_level?: string;
  batch_size?: number;

  // Folder Organization
  folder_organization_enabled: boolean;
  folder_organization_mode?: string;
  folder_organization_pattern?: string;
  folder_organization_custom_pattern?: string;
  create_unknown_folder?: boolean;
  unknown_folder_name?: string;

  // RAW Processing Settings
  raw_optimizations_enabled: boolean;
  raw_cache_enabled: boolean;
  raw_batch_size?: number;

  // Advanced Performance Options
  max_memory_usage_mb?: number;
  performance_monitoring_enabled?: boolean;
  session_resume_enabled?: boolean;
  connection_pooling_enabled?: boolean;
  async_file_ops_enabled?: boolean;
  database_optimizations_enabled?: boolean;
  batch_operations_enabled?: boolean;
  storage_optimizations_enabled?: boolean;
  memory_optimizations_enabled?: boolean;
  memory_pooling_enabled?: boolean;
  cpu_optimizations_enabled?: boolean;
  streaming_processing_enabled?: boolean;
  auto_tuning_enabled?: boolean;
  predictive_loading_enabled?: boolean;

  // Additional Performance Settings
  rate_limit_per_second?: number;

  // Metadata Options
  metadata_strategy?: string;
  manual_metadata_value?: string;
  include_xmp_files?: boolean;

  // RF-DETR Recognition Tracking
  recognition_method?: 'gemini' | 'rf-detr';
  recognition_method_version?: string;  // e.g., "V4", "V3", "V2"
  rf_detr_workflow_url?: string;        // Roboflow workflow URL used
  rf_detr_detections_count?: number;    // Total RF-DETR detections across all images
  rf_detr_total_cost?: number;          // Total RF-DETR cost in USD
}

/**
 * Statistics collected during execution
 */
export interface ExecutionStats {
  totalImages?: number;
  totalRawFiles?: number;
  totalStandardFiles?: number;
  executionDurationMs?: number;
  averageImageProcessingTimeMs?: number;
}

/**
 * Configuration object from batch processing
 */
export interface BatchProcessConfig {
  // Core settings
  folderPath: string;
  model?: string;
  category?: string;
  executionName?: string;
  projectId?: string;

  // AI Settings
  enableAdvancedAnnotations?: boolean;  // Use V3 Edge Function with bounding boxes

  // Processing options
  updateExif: boolean;
  savePreviewImages?: boolean;
  previewFolder?: string;
  resize?: { enabled: boolean; preset: string; };
  useParallelProcessing?: boolean;
  useStreamingPipeline?: boolean;
  parallelization?: {
    maxConcurrentUploads?: number;
    maxConcurrentAnalysis?: number;
    rateLimitPerSecond?: number;
    batchSize?: number;
  };

  // CSV and metadata
  csvData?: any[];
  metadataStrategy?: string;
  manualMetadataValue?: string;

  // Participant preset data (optional)
  participantPreset?: {
    id: string;
    name: string;
    participants: Array<{
      numero?: string;
      nome?: string;
      navigatore?: string;
      squadra?: string;
      sponsor?: string;
      metatag?: string;
    }>;
  };

  // Folder organization
  folderOrganization?: {
    enabled: boolean;
    mode?: 'copy' | 'move';
    pattern?: 'number' | 'number_name' | 'custom';
    customPattern?: string;
    createUnknownFolder?: boolean;
    unknownFolderName?: string;
    includeXmpFiles?: boolean;
    destinationPath?: string;
    conflictStrategy?: 'rename' | 'skip' | 'overwrite';
  };

  // Visual Tagging
  visualTagging?: {
    enabled: boolean;
    embedInMetadata: boolean;
  };

  // Keywords and Description mode
  keywordsMode?: 'append' | 'overwrite';
  descriptionMode?: 'append' | 'overwrite';
}

/**
 * Payload sent to the edge function
 */
export interface TrackingPayload {
  execution_id: string;
  config: BatchProcessConfig;
  stats?: ExecutionStats;
  system_info: SystemInfo;
  app_version: string;
}

/**
 * Response from the edge function
 */
export interface TrackingResponse {
  success: boolean;
  message?: string;
  data?: any;
}

/**
 * Helper function to convert BatchProcessConfig to ExecutionSettingsData
 */
export function mapConfigToExecutionSettings(
  executionId: string,
  userId: string,
  config: BatchProcessConfig,
  systemInfo: SystemInfo,
  stats: ExecutionStats = {}
): ExecutionSettingsData {
  const csvUsed = !!(config.csvData && config.csvData.length > 0);
  
  return {
    // Core identifiers
    execution_id: executionId,
    user_id: userId,

    // System information
    ...systemInfo,

    // AI Configuration
    ai_model: config.model || 'unknown',
    sport_category: config.category || 'unknown',
    enable_bounding_boxes: config.enableAdvancedAnnotations === true,

    // Performance Metrics
    execution_duration_ms: stats.executionDurationMs,
    average_image_processing_time_ms: stats.averageImageProcessingTimeMs,
    total_images_processed: stats.totalImages || 0,
    total_raw_files: stats.totalRawFiles || 0,
    total_standard_files: stats.totalStandardFiles || 0,

    // CSV Data Usage
    csv_data_used: csvUsed,
    csv_entries_count: csvUsed ? config.csvData!.length : 0,

    // Image Processing Settings
    resize_enabled: config.resize?.enabled === true,
    resize_preset: config.resize?.preset,
    update_exif: config.updateExif,
    save_preview_images: config.savePreviewImages === true,
    preview_folder: config.previewFolder,

    // Performance Settings
    parallel_processing_enabled: config.useParallelProcessing === true,
    streaming_pipeline_enabled: config.useStreamingPipeline === true,
    max_concurrent_uploads: config.parallelization?.maxConcurrentUploads,
    max_concurrent_analysis: config.parallelization?.maxConcurrentAnalysis,
    batch_size: config.parallelization?.batchSize,
    optimization_level: 'normal', // Default value
    rate_limit_per_second: undefined, // Will be populated from PERFORMANCE_CONFIG

    // Folder Organization
    folder_organization_enabled: config.folderOrganization?.enabled === true,
    folder_organization_mode: config.folderOrganization?.mode,
    folder_organization_pattern: config.folderOrganization?.pattern,
    folder_organization_custom_pattern: config.folderOrganization?.customPattern,
    create_unknown_folder: config.folderOrganization?.createUnknownFolder !== false,
    unknown_folder_name: config.folderOrganization?.unknownFolderName || 'Unknown',

    // RAW Processing Settings (defaults from config)
    raw_optimizations_enabled: false, // Will be populated from global config
    raw_cache_enabled: false, // Will be populated from global config

    // Metadata Options
    metadata_strategy: config.metadataStrategy,
    manual_metadata_value: config.manualMetadataValue,
    include_xmp_files: true, // Default value

    // Performance monitoring defaults
    performance_monitoring_enabled: true,
    session_resume_enabled: true,
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
  };
}

/**
 * Helper function to validate execution settings data
 */
export function validateExecutionSettings(data: ExecutionSettingsData): { 
  isValid: boolean; 
  errors: string[] 
} {
  const errors: string[] = [];

  // Required fields
  if (!data.execution_id) errors.push('execution_id is required');
  if (!data.user_id) errors.push('user_id is required');
  if (!data.client_version) errors.push('client_version is required');
  if (!data.operating_system) errors.push('operating_system is required');
  if (!data.ai_model) errors.push('ai_model is required');
  if (!data.sport_category) errors.push('sport_category is required');

  // Validate numeric fields
  if (data.total_images_processed < 0) errors.push('total_images_processed must be >= 0');
  if (data.total_raw_files < 0) errors.push('total_raw_files must be >= 0');
  if (data.total_standard_files < 0) errors.push('total_standard_files must be >= 0');

  // Validate CSV consistency
  if (data.csv_data_used && (!data.csv_entries_count || data.csv_entries_count <= 0)) {
    errors.push('csv_entries_count must be > 0 when csv_data_used is true');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}