// Configuration file for Racetagger Desktop App
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { app } from 'electron';
import { PRODUCTION_CONFIG } from './config.production';

// Detect if we're running in a packaged app
const isPackaged = app?.isPackaged || false;

// =============================================================================
// DEBUG MODE - Set to true for verbose logging during development
// In production (packaged app), this is always false
// =============================================================================
export const DEBUG_MODE = !isPackaged && process.env.DEBUG_MODE === 'true';

// Function to get configuration values
function getConfigValue(envVar: string, productionKey: keyof typeof PRODUCTION_CONFIG): string {
  if (isPackaged) {
    return PRODUCTION_CONFIG[productionKey];
  }
  return process.env[envVar] || '';
}

// Load environment variables from .env file (only in development)
if (!isPackaged) {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }
}

// Get configuration values
const supabaseUrl = getConfigValue('SUPABASE_URL', 'SUPABASE_URL');
const supabaseKey = getConfigValue('SUPABASE_KEY', 'SUPABASE_KEY');

// Configuration validation function
function validateConfiguration(url: string, key: string): void {
  const errors: string[] = [];

  if (!url || url.trim() === '') {
    errors.push('Supabase URL is required');
  } else {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('supabase.co') && !urlObj.hostname.includes('localhost')) {
        errors.push('Invalid Supabase URL format');
      }
    } catch (error) {
      errors.push('Invalid URL format');
    }
  }

  if (!key || key.trim() === '') {
    errors.push('Supabase API key is required');
  } else if (key.length < 100) {
    errors.push('API key appears to be too short');
  }

  if (errors.length > 0) {
    const errorMessage = [
      'Configuration validation failed:',
      ...errors.map(e => `  - ${e}`),
      '',
      isPackaged 
        ? 'This appears to be a build configuration issue. Please contact support.'
        : 'Please check your .env file and ensure all required variables are set correctly.'
    ].join('\n');

    throw new Error(errorMessage);
  }

}

// Validate configuration on startup
try {
  validateConfiguration(supabaseUrl, supabaseKey);
} catch (error) {
  console.error('❌ Configuration Error:', error instanceof Error ? error.message : String(error));
  // In development, we might want to continue with warnings
  // In production, we should exit
  if (isPackaged || process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Supabase configuration
export const SUPABASE_CONFIG = {
  url: supabaseUrl,
  key: supabaseKey,
  offlineMode: false
};

// Edge Function Version Compatibility
// This defines the maximum edge_function_version this app version supports
// Categories with a higher edge_function_version will be hidden from the user
// Version history:
// - V2: Basic analysis (app 1.0.0 - 1.0.7)
// - V3: Advanced annotations (app 1.0.8+)
// - V4: RF-DETR support (app 1.0.9+)
// - V5: Vehicle recognition, face recognition (app 1.0.11+)
// - V6: Crop + Context multi-image analysis (app 1.0.12+)
export const MAX_SUPPORTED_EDGE_FUNCTION_VERSION = 6;

// Resize presets for image optimization before upload
export enum ResizePreset {
  VELOCE = 'veloce',
  BILANCIATO = 'bilanciato', 
  QUALITA = 'qualita'
}

export interface ResizeConfig {
  maxDimension: number;
  jpegQuality: number;
  enabled: boolean;
}

export const RESIZE_PRESETS: Record<ResizePreset, ResizeConfig> = {
  [ResizePreset.VELOCE]: {
    maxDimension: 1080,
    jpegQuality: 75,
    enabled: true
  },
  [ResizePreset.BILANCIATO]: {
    maxDimension: 1440,
    jpegQuality: 85,
    enabled: true
  },
  [ResizePreset.QUALITA]: {
    maxDimension: 1920,
    jpegQuality: 90,
    enabled: true
  }
};

// Performance optimization levels
export enum OptimizationLevel {
  DISABLED = 'disabled',           // No optimizations (legacy behavior)
  CONSERVATIVE = 'conservative',   // Safe optimizations only
  BALANCED = 'balanced',          // Default optimizations
  AGGRESSIVE = 'aggressive'       // Maximum performance optimizations
}

// Performance optimization configuration
export interface PerformanceOptimizations {
  enabled: boolean;                    // Master switch for all optimizations
  level: OptimizationLevel;           // Optimization preset level
  
  // Phase 1: Foundation optimizations
  enablePerformanceMonitoring: boolean;     // Enable performance tracking
  enableSessionResume: boolean;              // Enable session state persistence
  
  // Phase 2: Parallelization optimizations  
  enableParallelOptimizations: boolean;     // Enhanced API parallelization
  maxConcurrentUploads: number;             // Upload concurrency (4 → 20)
  maxConcurrentAnalysis: number;            // Analysis concurrency (100 → 125)
  rateLimitPerSecond: number;               // API rate limit
  enableConnectionPooling: boolean;          // Database connection pooling
  
  // Phase 3: RAW processing optimizations
  enableRawOptimizations: boolean;          // Batch RAW processing
  rawBatchSize: number;                     // Files per batch (10-15)
  enableRawCache: boolean;                  // Cache converted files
  enableAsyncFileOps: boolean;              // Async file operations
  
  // Phase 4: Database & storage optimizations
  enableDatabaseOptimizations: boolean;     // Async DB ops, batch inserts
  databaseConnectionPoolSize: number;       // SQLite connection pool size
  enableBatchOperations: boolean;           // Batch DB operations
  enableStorageOptimizations: boolean;      // Parallel uploads/streaming
  
  // Phase 5: Memory & CPU optimizations
  enableMemoryOptimizations: boolean;       // Streaming processing, GC
  maxMemoryUsageMB: number;                 // Memory usage limit
  enableMemoryPooling: boolean;             // Buffer pooling system
  memoryPoolBuffersPerCategory: number;     // Buffers per size category
  enableCpuOptimizations: boolean;          // CPU-aware scaling
  enableResourcePooling: boolean;           // Resource pools
  
  // Phase 6: Advanced optimizations
  enableStreamingProcessing: boolean;       // Pipeline streaming
  enableAutoTuning: boolean;                // Performance auto-tuning
  enablePredictiveLoading: boolean;         // Smart prefetching
}

// Default optimization configurations for each level
export const OPTIMIZATION_PRESETS: Record<OptimizationLevel, Partial<PerformanceOptimizations>> = {
  [OptimizationLevel.DISABLED]: {
    enabled: false,
    level: OptimizationLevel.DISABLED
  },
  
  [OptimizationLevel.CONSERVATIVE]: {
    enabled: true,
    level: OptimizationLevel.CONSERVATIVE,
    enablePerformanceMonitoring: true,
    enableSessionResume: true,
    enableParallelOptimizations: true,
    maxConcurrentUploads: 8,
    maxConcurrentAnalysis: 110,
    rateLimitPerSecond: 110,
    enableConnectionPooling: true,
    enableRawOptimizations: false, // Skip potentially risky RAW optimizations
    enableDatabaseOptimizations: true,
    databaseConnectionPoolSize: 4,
    enableBatchOperations: true,
    enableStorageOptimizations: true,
    enableMemoryOptimizations: true,
    maxMemoryUsageMB: 1024,
    enableMemoryPooling: true,
    memoryPoolBuffersPerCategory: 6,
    enableCpuOptimizations: false,
    enableResourcePooling: true,
    enableStreamingProcessing: false,
    enableAutoTuning: false,
    enablePredictiveLoading: false
  },
  
  [OptimizationLevel.BALANCED]: {
    enabled: true,
    level: OptimizationLevel.BALANCED,
    enablePerformanceMonitoring: true,
    enableSessionResume: true,
    enableParallelOptimizations: true,
    maxConcurrentUploads: 12,
    maxConcurrentAnalysis: 120,
    rateLimitPerSecond: 120,
    enableConnectionPooling: true,
    enableRawOptimizations: true,
    rawBatchSize: 12,
    enableRawCache: true,
    enableAsyncFileOps: true,
    enableDatabaseOptimizations: true,
    databaseConnectionPoolSize: 6,
    enableBatchOperations: true,
    enableStorageOptimizations: true,
    enableMemoryOptimizations: true,
    maxMemoryUsageMB: 1536,
    enableMemoryPooling: true,
    memoryPoolBuffersPerCategory: 8,
    enableCpuOptimizations: true,
    enableResourcePooling: true,
    enableStreamingProcessing: true,
    enableAutoTuning: true,
    enablePredictiveLoading: false
  },
  
  [OptimizationLevel.AGGRESSIVE]: {
    enabled: true,
    level: OptimizationLevel.AGGRESSIVE,
    enablePerformanceMonitoring: true,
    enableSessionResume: true,
    enableParallelOptimizations: true,
    maxConcurrentUploads: 20,
    maxConcurrentAnalysis: 125,
    rateLimitPerSecond: 125,
    enableConnectionPooling: true,
    enableRawOptimizations: true,
    rawBatchSize: 15,
    enableRawCache: true,
    enableAsyncFileOps: true,
    enableDatabaseOptimizations: true,
    databaseConnectionPoolSize: 8,
    enableBatchOperations: true,
    enableStorageOptimizations: true,
    enableMemoryOptimizations: true,
    maxMemoryUsageMB: 2048,
    enableMemoryPooling: true,
    memoryPoolBuffersPerCategory: 12,
    enableCpuOptimizations: true,
    enableResourcePooling: true,
    enableStreamingProcessing: true,
    enableAutoTuning: true,
    enablePredictiveLoading: true
  }
};

// Get optimization level from environment or default to BALANCED
function getOptimizationLevel(): OptimizationLevel {
  const envLevel = process.env.RACETAGGER_OPTIMIZATION_LEVEL as OptimizationLevel;
  return Object.values(OptimizationLevel).includes(envLevel) ? envLevel : OptimizationLevel.BALANCED;
}

// Create performance config based on selected level
function createPerformanceConfig(): PerformanceOptimizations {
  const level = getOptimizationLevel();
  const preset = OPTIMIZATION_PRESETS[level];
  
  // Default fallback configuration
  const defaultConfig: PerformanceOptimizations = {
    enabled: false,
    level: OptimizationLevel.DISABLED,
    enablePerformanceMonitoring: false,
    enableSessionResume: false,
    enableParallelOptimizations: false,
    maxConcurrentUploads: 4,
    maxConcurrentAnalysis: 100,
    rateLimitPerSecond: 100,
    enableConnectionPooling: false,
    enableRawOptimizations: false,
    rawBatchSize: 1,
    enableRawCache: false,
    enableAsyncFileOps: false,
    enableDatabaseOptimizations: false,
    databaseConnectionPoolSize: 1,
    enableBatchOperations: false,
    enableStorageOptimizations: false,
    enableMemoryOptimizations: false,
    maxMemoryUsageMB: 512,
    enableMemoryPooling: false,
    memoryPoolBuffersPerCategory: 2,
    enableCpuOptimizations: false,
    enableResourcePooling: false,
    enableStreamingProcessing: false,
    enableAutoTuning: false,
    enablePredictiveLoading: false
  };
  
  return { ...defaultConfig, ...preset };
}

// Application settings
export const APP_CONFIG = {
  isDevelopment: process.env.NODE_ENV === 'development',
  name: 'Racetagger Desktop',
  version: '1.0.0',
  // Default Gemini model to use for analysis
  defaultModel: 'gemini-2.5-flash-lite',
  // Default resize preset
  defaultResizePreset: ResizePreset.QUALITA,
  // Feature flags for experimental functionality
  features: {
    // ADMIN FEATURE: Folder organization - Easy to remove by setting to false
    ENABLE_FOLDER_ORGANIZATION: true,  // Enable folder organization by race number (admin-only)
    // FACE RECOGNITION: AuraFace v1 ONNX (512-dim cosine similarity)
    // When true: uses YuNet + AuraFace in main process (no face-api.js / canvas)
    // When false: face recognition disabled (Coming Soon state)
    AURAFACE_ENABLED: true
  },
  // Face Recognition ONNX model configuration
  faceRecognition: {
    // YuNet face detector (~90KB, bundled with app)
    yunetModelName: 'face_detection_yunet_2023mar.onnx',
    yunetConfidenceThreshold: 0.7,
    yunetNmsThreshold: 0.5,
    // AuraFace v1 face embedder (~250MB, downloaded on-demand)
    aurafaceModelName: 'auraface_v1.onnx',
    aurafaceEmbeddingDim: 512,
    aurafaceInputSize: 112,  // 112x112 px
    // Supabase Storage bucket for model downloads
    modelStorageBucket: 'ml-models',
    modelStoragePath: 'face-recognition/auraface-v1/',
    // Local cache directory: ~/.racetagger/models/
    localModelCacheDir: 'models',
  },
  // Legacy performance optimizations (kept for backward compatibility)
  performance: {
    enableAsyncExifProcessing: true,    // Use async yield processing for EXIF operations
    enableMemoryOptimization: true,     // Force garbage collection after heavy operations
    enableDetailedPerfLogging: false,   // Show detailed performance measurements
    enableEventLoopYields: true         // Add yields to prevent UI freeze
  }
};

// Roboflow RF-DETR Configuration
export interface RoboflowConfig {
  defaultApiKey: string;               // Default Roboflow API key
  overlapThreshold: number;            // IoU threshold for filtering overlapping detections (0.0-1.0)
  minConfidence: number;               // Minimum confidence score for detections (0.0-1.0)
  estimatedCostPerImage: number;       // Estimated cost per image in USD
  timeout: number;                     // API request timeout in milliseconds
}

export const ROBOFLOW_CONFIG: RoboflowConfig = {
  defaultApiKey: getConfigValue('ROBOFLOW_DEFAULT_API_KEY', 'ROBOFLOW_DEFAULT_API_KEY'),
  overlapThreshold: 0.5,               // 50% IoU threshold
  minConfidence: 0.7,                  // 70% minimum confidence
  estimatedCostPerImage: 0.0045,       // ~$0.0045 per image
  timeout: 30000                       // 30 seconds timeout
};

// Validate Roboflow configuration
export function validateRoboflowConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (!ROBOFLOW_CONFIG.defaultApiKey || ROBOFLOW_CONFIG.defaultApiKey === '') {
    warnings.push('ROBOFLOW_DEFAULT_API_KEY is not set. RF-DETR recognition will fail. Please set this environment variable.');
  }

  if (ROBOFLOW_CONFIG.overlapThreshold < 0 || ROBOFLOW_CONFIG.overlapThreshold > 1) {
    warnings.push(`Invalid overlapThreshold: ${ROBOFLOW_CONFIG.overlapThreshold}. Must be between 0 and 1.`);
  }

  if (ROBOFLOW_CONFIG.minConfidence < 0 || ROBOFLOW_CONFIG.minConfidence > 1) {
    warnings.push(`Invalid minConfidence: ${ROBOFLOW_CONFIG.minConfidence}. Must be between 0 and 1.`);
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}

// Validate Roboflow config on load (warnings suppressed)
const roboflowValidation = validateRoboflowConfig();

// ============================================================================
// CROP-CONTEXT CONFIGURATION (V6 Edge Function)
// ============================================================================

/**
 * Configuration for crop extraction from original images
 */
export interface CropContextCropConfig {
  paddingPercent: number;   // Padding around bbox (0.15 = 15%)
  minPaddingPx: number;     // Minimum padding in pixels (50px)
  minDimension: number;     // Minimum crop dimension (640px)
  maxDimension: number;     // Maximum crop dimension (1024px)
  jpegQuality: number;      // JPEG quality (90)
}

/**
 * Configuration for negative/context image generation
 */
export interface CropContextNegativeConfig {
  enabled: boolean;         // Whether to generate negative
  maskColor: string;        // Mask color (#000000 for black)
  maxDimension: number;     // Maximum dimension (1440px)
  jpegQuality: number;      // JPEG quality (80)
}

/**
 * Configuration for multi-subject handling
 */
export interface CropContextMultiSubjectConfig {
  maxCropsPerRequest: number;  // Maximum crops in single API call (5)
  strategy: 'batch' | 'sequential';
}

/**
 * Full crop-context configuration (stored in sport_categories.crop_config)
 * When enabled=true, YOLOv8-seg segmentation is automatically used for subject isolation
 */
export interface CropContextConfig {
  enabled: boolean;
  crop: CropContextCropConfig;
  negative: CropContextNegativeConfig;
  multiSubject: CropContextMultiSubjectConfig;
}

/**
 * Default crop-context configuration
 * Used when sport_categories.crop_config has partial data
 */
export const DEFAULT_CROP_CONTEXT_CONFIG: CropContextConfig = {
  enabled: false,
  crop: {
    paddingPercent: 0.15,
    minPaddingPx: 50,
    minDimension: 640,
    maxDimension: 1024,
    jpegQuality: 90
  },
  negative: {
    enabled: true,
    maskColor: '#000000',
    maxDimension: 1440,
    jpegQuality: 80
  },
  multiSubject: {
    maxCropsPerRequest: 5,
    strategy: 'batch'
  }
};

// ============================================================================
// GENERIC SEGMENTER CONFIGURATION (YOLOv8-seg)
// ============================================================================

/**
 * Configuration for the generic segmentation model (YOLOv8-seg)
 * This model runs BEFORE recognition to isolate subjects in images
 */
export interface GenericSegmenterConfig {
  enabled: boolean;                   // Enable generic segmentation
  modelType: 'yolov8n-seg' | 'yolov8s-seg';  // Model variant
  confidenceThreshold: number;        // Minimum confidence for detections (0-1)
  iouThreshold: number;               // IoU threshold for NMS (0-1)
  maskThreshold: number;              // Threshold for mask binarization (0-1)
  relevantClasses: number[];          // COCO class IDs to detect
}

/**
 * Configuration for mask-based crop extraction
 */
export interface MaskCropConfig {
  enabled: boolean;                   // Enable mask-based isolation
  backgroundMode: 'black' | 'blur' | 'transparent';  // How to handle background
  blurRadius: number;                 // Blur radius if backgroundMode is 'blur'
  maskOtherSubjects: boolean;         // Mask overlapping subjects in crop
  featherEdge: number;                // Pixels to feather mask edges
}

/**
 * COCO class IDs for relevant subjects
 */
export const COCO_RELEVANT_CLASSES = {
  PERSON: 0,
  BICYCLE: 1,
  CAR: 2,
  MOTORCYCLE: 3,
  BUS: 5,
  TRUCK: 7,
} as const;

/**
 * Default generic segmenter configuration
 */
export const DEFAULT_GENERIC_SEGMENTER_CONFIG: GenericSegmenterConfig = {
  enabled: true,
  modelType: 'yolov8n-seg',
  confidenceThreshold: 0.25,
  iouThreshold: 0.45,
  maskThreshold: 0.5,
  relevantClasses: [
    COCO_RELEVANT_CLASSES.PERSON,
    COCO_RELEVANT_CLASSES.CAR,
    COCO_RELEVANT_CLASSES.MOTORCYCLE,
    COCO_RELEVANT_CLASSES.BUS,
    COCO_RELEVANT_CLASSES.TRUCK,
  ],
};

/**
 * Default mask crop configuration
 */
export const DEFAULT_MASK_CROP_CONFIG: MaskCropConfig = {
  enabled: true,
  backgroundMode: 'black',
  blurRadius: 20,
  maskOtherSubjects: true,
  featherEdge: 2,
};

// New performance optimization configuration
export const PERFORMANCE_CONFIG: PerformanceOptimizations = createPerformanceConfig();

// Configuration management utilities
export class ConfigManager {
  private static userConfigPath: string;
  
  static initialize(): void {
    if (app?.getPath) {
      this.userConfigPath = path.join(app.getPath('userData'), 'optimization-config.json');
    }
  }
  
  /**
   * Override specific optimization settings at runtime
   */
  static setOptimization(key: keyof PerformanceOptimizations, value: any): void {
    (PERFORMANCE_CONFIG as any)[key] = value;
    this.saveUserConfig();
  }
  
  /**
   * Enable/disable optimization level
   */
  static setOptimizationLevel(level: OptimizationLevel): void {
    const preset = OPTIMIZATION_PRESETS[level];
    Object.assign(PERFORMANCE_CONFIG, preset);
    this.saveUserConfig();
  }
  
  /**
   * Emergency disable all optimizations (instant rollback)
   */
  static disableAllOptimizations(): void {
    PERFORMANCE_CONFIG.enabled = false;
    this.saveUserConfig();
  }
  
  /**
   * Get current optimization status
   */
  static getOptimizationStatus(): {
    level: OptimizationLevel;
    enabled: boolean;
    activeOptimizations: string[];
  } {
    const activeOptimizations: string[] = [];
    
    // Check which optimizations are currently enabled
    if (PERFORMANCE_CONFIG.enableParallelOptimizations) activeOptimizations.push('Parallelization');
    if (PERFORMANCE_CONFIG.enableRawOptimizations) activeOptimizations.push('RAW Processing');
    if (PERFORMANCE_CONFIG.enableDatabaseOptimizations) activeOptimizations.push('Database');
    if (PERFORMANCE_CONFIG.enableMemoryOptimizations) activeOptimizations.push('Memory');
    if (PERFORMANCE_CONFIG.enableStreamingProcessing) activeOptimizations.push('Streaming');
    
    return {
      level: PERFORMANCE_CONFIG.level,
      enabled: PERFORMANCE_CONFIG.enabled,
      activeOptimizations
    };
  }
  
  /**
   * Save current configuration to user data directory
   */
  private static saveUserConfig(): void {
    if (!this.userConfigPath) return;
    
    try {
      const configData = {
        optimizations: PERFORMANCE_CONFIG,
        lastModified: new Date().toISOString()
      };
      
      fs.writeFileSync(this.userConfigPath, JSON.stringify(configData, null, 2));
    } catch (error) {
      console.error('Error saving user configuration:', error);
    }
  }
  
  /**
   * Load user configuration from disk
   */
  static loadUserConfig(): void {
    if (!this.userConfigPath || !fs.existsSync(this.userConfigPath)) return;
    
    try {
      const configData = JSON.parse(fs.readFileSync(this.userConfigPath, 'utf8'));
      if (configData.optimizations) {
        Object.assign(PERFORMANCE_CONFIG, configData.optimizations);
      }
    } catch (error) {
      console.error('Error loading user configuration:', error);
    }
  }
}

// Initialize configuration manager
if (app && typeof app.getPath === 'function') {
  ConfigManager.initialize();
  ConfigManager.loadUserConfig();
}


// Email service configuration
export function getBREVO_API_KEY(): string {
  return getConfigValue('BREVO_API_KEY', 'BREVO_API_KEY' as keyof typeof PRODUCTION_CONFIG);
}

// Streaming Pipeline Configuration
export interface StreamingPipelineConfig {
  enabled: boolean;
  threshold: number;          // Numero minimo di immagini per attivare streaming
  workers: {
    rawConverter: number;       // Worker per conversione RAW → DNG
    dngToJpeg: number;         // Worker per estrazione JPEG da DNG
    upload: number;            // Worker per upload
    recognition: number;       // Worker per riconoscimento
  };
  diskManagement: {
    minFreeSpaceGB: number;    // Spazio minimo richiesto per continuare
    checkIntervalMs: number;   // Frequenza controllo spazio disco
    alertThresholdGB: number;  // Soglia per warning (ma continua)
  };
  performance: {
    batchSize: number;         // Dimensione batch per operazioni
    timeoutMs: number;         // Timeout per singole operazioni
    retryAttempts: number;     // Numero retry automatici
    retryDelayMs: number;      // Delay base per retry (con backoff)
  };
}

// Default configuration per la streaming pipeline
const DEFAULT_PIPELINE_CONFIG: StreamingPipelineConfig = {
  enabled: true, // Abilitata per default per gestire batch grandi
  threshold: 50,
  workers: {
    rawConverter: 3,
    dngToJpeg: 2,
    upload: 4,
    recognition: 2
  },
  diskManagement: {
    minFreeSpaceGB: 5,
    checkIntervalMs: 5000,
    alertThresholdGB: 8
  },
  performance: {
    batchSize: 10,
    timeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 1000
  }
};

// Crea configurazione pipeline da environment variables o default
function createPipelineConfig(): StreamingPipelineConfig {
  return {
    enabled: process.env.ENABLE_STREAMING_PIPELINE === 'true',
    threshold: parseInt(process.env.STREAMING_PIPELINE_THRESHOLD || String(DEFAULT_PIPELINE_CONFIG.threshold)),
    workers: {
      rawConverter: parseInt(process.env.RAW_CONVERTER_WORKERS || String(DEFAULT_PIPELINE_CONFIG.workers.rawConverter)),
      dngToJpeg: parseInt(process.env.DNG_TO_JPEG_WORKERS || String(DEFAULT_PIPELINE_CONFIG.workers.dngToJpeg)),
      upload: parseInt(process.env.UPLOAD_WORKERS || String(DEFAULT_PIPELINE_CONFIG.workers.upload)),
      recognition: parseInt(process.env.RECOGNITION_WORKERS || String(DEFAULT_PIPELINE_CONFIG.workers.recognition))
    },
    diskManagement: {
      minFreeSpaceGB: parseFloat(process.env.MIN_FREE_SPACE_GB || String(DEFAULT_PIPELINE_CONFIG.diskManagement.minFreeSpaceGB)),
      checkIntervalMs: parseInt(process.env.DISK_CHECK_INTERVAL_MS || String(DEFAULT_PIPELINE_CONFIG.diskManagement.checkIntervalMs)),
      alertThresholdGB: parseFloat(process.env.ALERT_THRESHOLD_GB || String(DEFAULT_PIPELINE_CONFIG.diskManagement.alertThresholdGB))
    },
    performance: {
      batchSize: parseInt(process.env.PIPELINE_BATCH_SIZE || String(DEFAULT_PIPELINE_CONFIG.performance.batchSize)),
      timeoutMs: parseInt(process.env.PIPELINE_TIMEOUT_MS || String(DEFAULT_PIPELINE_CONFIG.performance.timeoutMs)),
      retryAttempts: parseInt(process.env.PIPELINE_RETRY_ATTEMPTS || String(DEFAULT_PIPELINE_CONFIG.performance.retryAttempts)),
      retryDelayMs: parseInt(process.env.PIPELINE_RETRY_DELAY_MS || String(DEFAULT_PIPELINE_CONFIG.performance.retryDelayMs))
    }
  };
}

// Export della configurazione pipeline
export const PIPELINE_CONFIG: StreamingPipelineConfig = createPipelineConfig();
