import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { EventEmitter } from 'events';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, APP_CONFIG, RESIZE_PRESETS, ResizePreset, DEBUG_MODE } from './config';
import { getSupabaseClient, getSportCategories } from './database-service';
import { authService } from './auth-service';
import { getSharp, createImageProcessor } from './utils/native-modules';
import { rawPreviewExtractor } from './utils/raw-preview-native';
import { createXmpSidecar } from './utils/xmp-manager';
import { writeDescriptionToImage, writeKeywordsToImage, writeSpecialInstructions, writeExtendedDescription, writePersonInImage, buildPersonShownString } from './utils/metadata-writer';
import { CleanupManager, getCleanupManager } from './utils/cleanup-manager';
import { SmartMatcher, MatchResult, AnalysisResult as SmartMatcherAnalysisResult, getParticipantDriverNames, getPrimaryDriverName } from './matching/smart-matcher';
import { CacheManager } from './matching/cache-manager';
import { AnalysisLogger, CorrectionData } from './utils/analysis-logger';
import { TemporalClusterManager, ImageTimestamp } from './matching/temporal-clustering';
import { FilesystemTimestampExtractor, FileTimestamp } from './utils/filesystem-timestamp';
import { HardwareDetector } from './utils/hardware-detector';
import { NetworkMonitor } from './utils/network-monitor';
import { PerformanceTimer } from './utils/performance-timer';
import { ErrorTracker } from './utils/error-tracker';
import { errorTelemetryService } from './utils/error-telemetry-service';
import { SceneClassifierONNX, SceneCategory, SceneClassificationResult } from './scene-classifier-onnx';
import { OnnxDetector, getOnnxDetector, OnnxAnalysisResult } from './onnx-detector';
import { ModelManager, getModelManager, ModelStatus } from './model-manager';
import { GenericSegmenter, getGenericSegmenter, SegmentationResult, GenericSegmenterOutput } from './generic-segmenter';
import { parseSegmentationConfig, getDefaultModelId } from './yolo-model-registry';
import { createComponentLogger } from './utils/logger';
import { FaceRecognitionOnnxProcessor, FaceRecognitionOnnxResult, FaceWithEmbedding } from './face-recognition-onnx-processor';
import { faceRecognitionProcessor, FaceContext, PersonMatch } from './face-recognition-processor';

// Bridge-compatible result type for face recognition (replaces old face-detection-bridge)
interface FaceRecognitionResult {
  success: boolean;
  matches: Array<{
    matched: boolean;
    driverInfo?: {
      driverId: string;
      driverName: string;
      teamName: string;
      raceNumber: string;
    };
    similarity: number;
    faceIndex: number;
  }>;
  detectionTimeMs: number;
  matchingTimeMs: number;
  totalTimeMs: number;
  error?: string;
}
import { consentService } from './consent-service';
import {
  extractCropContext,
  cropsToBase64,
  negativeToBase64,
  CropContextResult,
  BoundingBox as CropBoundingBox,
  CropConfig,
  NegativeConfig,
  DEFAULT_CROP_CONFIG,
  DEFAULT_NEGATIVE_CONFIG,
  // Mask-based crop extraction (V6 with segmentation)
  extractCropsWithMasks,
  maskedCropsToBase64,
  SegmentedDetection,
  MaskedCropResult,
  MaskCropConfig,
  DEFAULT_MASK_CROP_CONFIG,
  SegmentationMaskData,
  MaskedCropBase64Result,
  ExtractMaskOptions
} from './utils/crop-context-extractor';

// Create component loggers for macro-flow visibility
const log = createComponentLogger('Processor');
const workerLog = createComponentLogger('Worker');

const sharp = getSharp();

/**
 * Interfaccia per le immagini da processare nel sistema unificato
 */
export interface UnifiedImageFile {
  id: string;
  originalPath: string;
  fileName: string;
  isRaw: boolean;
  originalFormat: string | null;
}

/**
 * Risultato del processamento unificato
 */
export interface UnifiedProcessingResult {
  fileId: string;
  fileName: string;
  originalPath: string;
  success: boolean;
  analysis?: any[];
  csvMatch?: any;
  error?: string;
  processingTimeMs: number;
  previewDataUrl?: string;
  compressedPath?: string;
  thumbnailPath?: string | null;
  microThumbPath?: string | null;
  // Path after folder organization (move/copy)
  organizedPath?: string;
  // RF-DETR Metrics (from worker)
  rfDetrDetections?: number;
  rfDetrCost?: number;
  recognitionMethod?: 'gemini' | 'rf-detr' | 'local-onnx';
  // Local ONNX inference metrics
  localOnnxInferenceMs?: number;
  // Scene Classification
  sceneCategory?: SceneCategory;
  sceneConfidence?: number;
  sceneSkipped?: boolean; // True if AI analysis was skipped due to scene classification
  // Face Recognition
  faceRecognitionUsed?: boolean; // True if face recognition was used for identification
  // Metadata writing status
  metadataWritten?: boolean;
  metadataSkipReason?: 'no_keywords' | 'no_preset_match';
  // Pending database update (passed from worker to processor for batch flushing)
  pendingUpdate?: {
    imageId: string;
    updateData: any;
    timestamp: number;
  };
  // Pending analysis_results insert (ONNX batch optimization - passed from worker to processor)
  pendingAnalysisInsert?: {
    data: any;
    timestamp: number;
  };
}

/**
 * RAW preview extraction strategy determined by calibration sampling
 */
interface RawPreviewStrategy {
  method: 'full' | 'preview' | 'fallback';
  bestWidth: number;
  bestHeight: number;
  bestSizeKB: number;
  targetMaxSize: number;  // bytes
  sampleFile: string;
}

/**
 * Configurazione del processore unificato
 */
export interface UnifiedProcessorConfig {
  maxConcurrentWorkers: number;
  maxImageSizeKB: number;
  jpegQuality: number;
  maxDimension: number;
  csvData?: any[]; // Legacy support
  participantPresetData?: any[]; // Direct participant data array from frontend
  category?: string;
  executionId?: string; // Add execution_id for linking images to desktop executions
  presetId?: string; // Preset ID for loading face descriptors specific to this preset
  keywordsMode?: 'append' | 'overwrite'; // How to handle existing keywords
  descriptionMode?: 'append' | 'overwrite'; // How to handle existing description
  enableAdvancedAnnotations?: boolean; // V3 bounding box annotations
  // Person Shown template for IPTC PersonInImage field (e.g., "{name} ({nationality}) {team} {car_model}")
  personShownTemplate?: string;
  // ADMIN FEATURE: Folder organization configuration
  folderOrganization?: {
    enabled: boolean;
    mode: 'copy' | 'move';
    pattern: 'number' | 'number_name' | 'custom';
    customPattern?: string;
    createUnknownFolder: boolean;
    unknownFolderName: string;
    includeXmpFiles?: boolean;
    destinationPath?: string;
  };
  // Callback per notificare l'uso dei token
  onTokenUsed?: (balance: any) => void;
  // Cancellation support
  isCancelled?: () => boolean; // Function to check if processing should be cancelled
  // Visual Tagging configuration
  visualTagging?: {
    enabled: boolean;
    embedInMetadata: boolean;
  };
  // Pre-auth system flag (v1.1.0+) - quando true, i worker NON chiamano useTokens
  usePreAuthSystem?: boolean;
  // PERFORMANCE: Pre-fetched sport categories (batch optimization - avoids repeated Supabase calls)
  sportCategories?: any[];
}

/**
 * Worker unificato che gestisce il ciclo completo di una singola immagine:
 * RAW → JPEG → Compressione → Upload → AI → Metadata
 */
class UnifiedImageWorker extends EventEmitter {
  private supabase: any;
  private config: UnifiedProcessorConfig;
  private csvData: any[];
  private participantsData: any[]; // Loaded from preset
  private category: string;
  private cleanupManager: CleanupManager;
  private smartMatcher: SmartMatcher;
  private cacheManager: CacheManager;
  private filesystemTimestampExtractor: FilesystemTimestampExtractor;
  private analysisLogger?: AnalysisLogger;
  private networkMonitor?: NetworkMonitor;
  private sportCategories: any[] = []; // Store sport categories data
  private currentSportCategory: any = null; // Current category config
  // RF-DETR Metrics Tracking
  private totalRfDetrDetections: number = 0;
  private totalRfDetrCost: number = 0;
  private recognitionMethod: 'gemini' | 'rf-detr' | 'local-onnx' | null = null;
  private edgeFunctionLogged: boolean = false; // Log edge function selection only once
  // Scene Classification (ONNX Runtime for fast inference)
  private sceneClassifier: SceneClassifierONNX | null = null;
  private sceneClassificationEnabled: boolean = true;
  private sceneSkipThreshold: number = 0.75; // Skip AI if crowd_scene confidence > 75%
  // Local ONNX Detection (RF-DETR replacement)
  private onnxDetector: OnnxDetector | null = null;
  private onnxDetectorEnabled: boolean = false;
  private onnxModelLoaded: boolean = false;
  // ONNX Circuit Breaker (PERFORMANCE: Auto-disable after consecutive failures)
  private onnxConsecutiveFailures: number = 0;
  private onnxCircuitBreakerThreshold: number = 5;
  private onnxCircuitOpen: boolean = false;
  private onnxCircuitBreakerLogged: boolean = false;
  // Generic Segmenter (YOLOv8-seg for universal subject isolation before recognition)
  private genericSegmenter: GenericSegmenter | null = null;
  private genericSegmenterEnabled: boolean = false;
  private genericSegmenterLoaded: boolean = false;
  // Cache for segmentation results (avoid running segmentation twice per image)
  private cachedSegmentationResults: SegmentedDetection[] | null = null;
  // Face Recognition (ONNX-based: YuNet detection + AuraFace embedding)
  private faceRecognitionEnabled: boolean = false;
  private faceDescriptorsLoaded: boolean = false;
  private _dimMismatchWarned: boolean = false;
  // RAW preview calibration strategy (set by processor from calibration results)
  private rawPreviewStrategies: Map<string, RawPreviewStrategy> = new Map();
  private faceDescriptorCount: number = 0;
  // Training consent tracking (default true for opt-out model)
  private userTrainingConsent: boolean = true;
  // Visual Tagging cache (stores tags by imageId for metadata embedding)
  private visualTagsCache: Map<string, any> = new Map();
  // Pending analysis_results insert data (for batch insert optimization with ONNX)
  // Set by analyzeImageLocal(), read by Processor via getPendingAnalysisInsert()
  private pendingAnalysisInsertData: any = null;

  private constructor(config: UnifiedProcessorConfig, analysisLogger?: AnalysisLogger, networkMonitor?: NetworkMonitor) {
    super();
    // TEMPORARY: Force V3 bounding box detection to be enabled by default for testing
    if (config.enableAdvancedAnnotations === undefined) {
      config.enableAdvancedAnnotations = true;
    }
    this.config = config;
    this.csvData = config.csvData || []; // Legacy support
    this.participantsData = [];
    this.category = config.category || 'motorsport';
    this.cleanupManager = getCleanupManager(); // PERFORMANCE: Use singleton to avoid memory leak
    // Use authenticated client from database-service (includes user session)
    this.supabase = getSupabaseClient();
    this.analysisLogger = analysisLogger;
    this.networkMonitor = networkMonitor;

    // Initialize intelligent matching system
    this.smartMatcher = new SmartMatcher(this.category);
    this.cacheManager = new CacheManager();

    // Initialize filesystem timestamp extractor for cross-platform temporal sorting
    this.filesystemTimestampExtractor = new FilesystemTimestampExtractor();
  }

  /**
   * Factory method to create and initialize a UnifiedImageWorker
   */
  static async create(config: UnifiedProcessorConfig, analysisLogger?: AnalysisLogger, networkMonitor?: NetworkMonitor): Promise<UnifiedImageWorker> {
    const worker = new UnifiedImageWorker(config, analysisLogger, networkMonitor);

    await worker.initializeParticipantsData();
    await worker.initializeSportConfigurations();

    // Initialize Scene Classifier for smart routing
    await worker.initializeSceneClassifier();

    // Initialize ONNX Detector for local inference (after sport configs are loaded)
    await worker.initializeOnnxDetector();

    // Initialize Generic Segmenter for V6 crop-context with masks (YOLOv8-seg)
    await worker.initializeGenericSegmenter();

    // Initialize Face Recognition for driver identification (uses category's face descriptors)
    await worker.initializeFaceRecognition();

    // Load user training consent preference
    await worker.initializeTrainingConsent();

    return worker;
  }

  /**
   * Initialize user training consent preference
   */
  private async initializeTrainingConsent(): Promise<void> {
    try {
      this.userTrainingConsent = await consentService.getTrainingConsent();
      log.info(`[Processor] User training consent: ${this.userTrainingConsent ? 'ENABLED' : 'DISABLED'}`);
    } catch (error) {
      log.warn('[Processor] Failed to load training consent, defaulting to true:', error);
      this.userTrainingConsent = true;
    }
  }

  /**
   * Initialize Scene Classifier for local ML-based scene detection
   * Uses ONNX Runtime for fast inference (~20-50ms vs 3-15s with TensorFlow.js)
   */
  private async initializeSceneClassifier(): Promise<void> {
    // Check if scene classifier is enabled for this sport category
    // Default to FALSE if not explicitly enabled (safer for unknown categories)
    if (this.currentSportCategory?.scene_classifier_enabled !== true) {
      log.info(`Scene classifier DISABLED for category ${this.category} (per category config)`);
      this.sceneClassificationEnabled = false;
      return;
    }

    try {
      this.sceneClassifier = SceneClassifierONNX.getInstance();
      const loaded = await this.sceneClassifier.loadModel();

      if (loaded) {
        log.info('Scene classifier ONNX initialized (87.68% accuracy, ~20-50ms inference)');
        this.sceneClassificationEnabled = true;
      } else {
        log.warn('Scene classifier ONNX not available - all images will be sent to AI');
        this.sceneClassificationEnabled = false;
      }
    } catch (error) {
      log.warn('Scene classifier ONNX initialization failed - using fallback', error);
      this.sceneClassificationEnabled = false;
    }
  }

  /**
   * Initialize ONNX Detector for local race number detection
   * Called after sport configurations are loaded (needs category code for model selection)
   */
  private async initializeOnnxDetector(): Promise<void> {
    // DEBUG: Log sport category configuration
    console.log(`[ONNX-Init] Current category: ${this.category}, sportCategory exists: ${!!this.currentSportCategory}`);
    if (this.currentSportCategory) {
      console.log(`[ONNX-Init] Category config: use_local_onnx=${this.currentSportCategory.use_local_onnx}, recognition_method=${this.currentSportCategory.recognition_method}`);
      console.log(`[ONNX-Init] Recognition config:`, JSON.stringify(this.currentSportCategory.recognition_config));
      console.log(`[ONNX-Init] Crop config:`, JSON.stringify(this.currentSportCategory.crop_config));
    }

    // Check if local ONNX is enabled for this sport category
    if (!this.currentSportCategory?.use_local_onnx) {
      console.log(`[ONNX-Init] Local ONNX detection DISABLED for category ${this.category} (use_local_onnx=false or undefined)`);
      this.onnxDetectorEnabled = false;
      return;
    }

    try {
      console.log(`[ONNX-Init] ✅ Local ONNX ENABLED - Initializing detector for category: ${this.category}`);
      this.onnxDetector = getOnnxDetector();

      // Set the authenticated Supabase client for model downloads
      const modelManager = getModelManager();
      modelManager.setSupabaseClient(this.supabase);

      // Load model for this category
      console.log(`[ONNX-Init] Loading model for ${this.category}...`);
      const loaded = await this.onnxDetector.loadModel(this.category);

      if (loaded) {
        this.onnxDetectorEnabled = true;
        this.onnxModelLoaded = true;
        console.log(`[ONNX-Init] ✅ SUCCESS: ONNX detector initialized for ${this.category} - local inference enabled`);
      } else {
        log.warn(`[ONNX-Init] ⚠️ FAILED: ONNX model not available for ${this.category} - falling back to API`);
        this.onnxDetectorEnabled = false;
      }
    } catch (error) {
      log.warn(`[ONNX-Init] ❌ ERROR: ONNX detector initialization failed for ${this.category}`, error);
      this.onnxDetectorEnabled = false;
      this.onnxModelLoaded = false;
    }
  }

  /**
   * Initialize Generic Segmenter for universal subject isolation (YOLO-seg)
   * This model runs BEFORE any recognition to extract clean crops with segmentation masks.
   * Automatically enabled when crop_config.enabled = true (no separate flag needed)
   *
   * Supports multiple YOLO models via sport_categories.segmentation_config:
   * - modelId: Which YOLO model to use (e.g., 'yolov11-detector-v1', 'yolov8n-seg')
   * - relevantClasses: Which classes to detect for this category (e.g., ['vehicle'], ['runner', 'bib-number'])
   */
  private async initializeGenericSegmenter(): Promise<void> {
    // Segmentation is automatically used when crop_config is enabled
    // No separate "use_segmentation" flag - keep config simple
    let cropConfig = this.currentSportCategory?.crop_config;

    // Parse if stored as JSON string (Supabase TEXT column)
    if (typeof cropConfig === 'string') {
      try {
        cropConfig = JSON.parse(cropConfig);
      } catch (e) {
        cropConfig = null;
      }
    }

    if (!cropConfig?.enabled) {
      log.info(`Generic segmenter DISABLED for category ${this.category} (crop_config not enabled)`);
      this.genericSegmenterEnabled = false;
      return;
    }

    try {
      // Parse segmentation config from sport_categories
      const segConfig = parseSegmentationConfig(this.currentSportCategory?.segmentation_config);
      const modelId = segConfig?.model_id || getDefaultModelId();
      const relevantClasses = segConfig?.relevant_classes || [];

      log.info(`Initializing Generic Segmenter for category: ${this.category}`);
      log.info(`  Model: ${modelId}`);
      log.info(`  Relevant classes: ${relevantClasses.length > 0 ? relevantClasses.join(', ') : 'all'}`);

      // Get singleton instance
      this.genericSegmenter = getGenericSegmenter();

      // Apply segmentation config from sport_categories
      if (segConfig) {
        this.genericSegmenter.updateConfig(segConfig);
      }

      // Check if we need to reload model (different modelId)
      if (this.genericSegmenter.needsModelReload(modelId)) {
        log.info(`Model change detected (${this.genericSegmenter.getModelId()} -> ${modelId}), disposing old model`);
        this.genericSegmenter.dispose();
      }

      // Set the authenticated Supabase client for model downloads
      const modelManager = getModelManager();
      modelManager.setSupabaseClient(this.supabase);

      // Load model (will download from Supabase if not cached locally)
      const loaded = await this.genericSegmenter.loadModel();

      if (loaded) {
        this.genericSegmenterEnabled = true;
        this.genericSegmenterLoaded = true;
        log.info(`Generic Segmenter initialized - ${modelId} ready for subject isolation`);
      } else {
        log.warn(`Generic Segmenter not available - falling back to bbox-based crops`);
        this.genericSegmenterEnabled = false;
      }
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : (error?.message || String(error));
      log.warn(`Generic Segmenter initialization failed: ${errMsg}`);
      this.genericSegmenterEnabled = false;
      this.genericSegmenterLoaded = false;
    }
  }

  /**
   * PERFORMANCE: Quick check descriptor count before full initialization.
   * Queries the database for the number of face descriptors (512-dim or 128-dim)
   * in the given preset. Returns 0 if none, >0 if found, -1 on error.
   */
  private async checkPresetDescriptorCount(presetId: string): Promise<number> {
    try {
      // Query through preset_participants → preset_participant_face_photos
      // Photos can be linked via participant_id OR via driver_id (through preset_participant_drivers)
      const { data: participants, error: pError } = await this.supabase
        .from('preset_participants')
        .select('id')
        .eq('preset_id', presetId);

      if (pError || !participants || participants.length === 0) {
        if (pError) log.warn(`[FaceRecognition] Pre-check participants query failed: ${pError.message}`);
        return participants?.length === 0 ? 0 : -1;
      }

      const participantIds = participants.map((p: any) => p.id);
      let totalCount = 0;

      // 1. Count participant-level face photos (linked via participant_id)
      const { count: participantPhotoCount, error: fError } = await this.supabase
        .from('preset_participant_face_photos')
        .select('id', { count: 'exact', head: true })
        .in('participant_id', participantIds)
        .or('face_descriptor_512.not.is.null,face_descriptor.not.is.null');

      if (fError) {
        log.warn(`[FaceRecognition] Pre-check participant photos query failed: ${fError.message}`);
      } else {
        totalCount += participantPhotoCount ?? 0;
      }

      // 2. Count driver-level face photos (linked via driver_id through preset_participant_drivers)
      const { data: drivers, error: dError } = await this.supabase
        .from('preset_participant_drivers')
        .select('id')
        .in('participant_id', participantIds);

      if (!dError && drivers && drivers.length > 0) {
        const driverIds = drivers.map((d: any) => d.id);
        const { count: driverPhotoCount, error: dfError } = await this.supabase
          .from('preset_participant_face_photos')
          .select('id', { count: 'exact', head: true })
          .in('driver_id', driverIds)
          .or('face_descriptor_512.not.is.null,face_descriptor.not.is.null');

        if (dfError) {
          log.warn(`[FaceRecognition] Pre-check driver photos query failed: ${dfError.message}`);
        } else {
          totalCount += driverPhotoCount ?? 0;
        }
      }

      return totalCount;
    } catch (err: any) {
      log.warn(`[FaceRecognition] Pre-check error: ${err.message || err}`);
      return -1;
    }
  }

  /**
   * Initialize Face Recognition for driver identification
   * Uses ONNX pipeline (YuNet detection + AuraFace embedding) in main process.
   *
   * Face descriptors are loaded ONLY from the participant preset.
   * Each preset has its own face recognition database.
   */
  private async initializeFaceRecognition(): Promise<void> {
    // Face recognition requires a preset with face descriptors
    if (!this.config.presetId) {
      log.info('Face recognition: No preset selected - disabled');
      this.faceRecognitionEnabled = false;
      return;
    }

    try {
      // OPTIMIZATION: Pre-check descriptor count (saves 200-500ms if none)
      const preCheckCount = await this.checkPresetDescriptorCount(this.config.presetId);

      if (preCheckCount === 0) {
        log.info('Face recognition: No descriptors - skipping initialization');
        this.faceRecognitionEnabled = false;
        return;
      }

      if (preCheckCount > 0) {
        log.info(`Face recognition: ${preCheckCount} descriptors found, initializing ONNX pipeline...`);
      }
      // If -1 (error), proceed with full initialization (safe fallback)

      // Initialize ONNX face recognition processor (YuNet + AuraFace)
      const onnxProcessor = FaceRecognitionOnnxProcessor.getInstance();
      const onnxInitOk = await onnxProcessor.initialize();
      if (!onnxInitOk) {
        log.warn('Face recognition: ONNX pipeline failed to initialize (YuNet not loaded) - disabling');
        this.faceRecognitionEnabled = false;
        return;
      }
      // Ensure AuraFace embedder is loaded (may not have loaded during initialize if model was downloading)
      await onnxProcessor.ensureEmbedderReady();
      const onnxStatus = onnxProcessor.getStatus();
      log.info(`Face recognition: ONNX pipeline initialized (detector: ${onnxStatus.detectorLoaded}, embedder: ${onnxStatus.embedderLoaded})`);

      // Initialize matching processor
      await faceRecognitionProcessor.initialize();

      // Load face descriptors from the participant preset
      const descriptorCount = await faceRecognitionProcessor.loadFromPreset(this.config.presetId);
      log.info(`Face recognition: Loaded ${descriptorCount} descriptors from preset ${this.config.presetId}`);

      if (descriptorCount > 0) {
        this.faceRecognitionEnabled = true;
        this.faceDescriptorsLoaded = true;
        this.faceDescriptorCount = descriptorCount;
        log.info(`Face recognition initialized with ${descriptorCount} descriptors`);
      } else {
        log.info(`No face descriptors in preset - face recognition disabled`);
        this.faceRecognitionEnabled = false;
      }
    } catch (error) {
      log.warn(`Face recognition initialization failed:`, error);
      this.faceRecognitionEnabled = false;
    }
  }

  /**
   * Determine recognition strategy based on scene classification AND segmentation results
   * @param sceneCategory Scene classification category (optional)
   * @param segmentationResults YOLOv8 segmentation results (optional) - used to detect subjects
   */
  private getRecognitionStrategy(
    sceneCategory: SceneCategory | null,
    segmentationResults?: SegmentedDetection[]
  ): { useFaceRecognition: boolean; useNumberRecognition: boolean; context: 'portrait' | 'action' | 'podium' | 'auto' } {

    // PRIORITY 1: Use segmentation results if available (most accurate)
    if (segmentationResults && segmentationResults.length > 0) {
      const hasPerson = segmentationResults.some(det => det.classId === 0); // COCO class 0 = PERSON
      const hasVehicles = segmentationResults.some(det =>
        [2, 3, 5, 7].includes(det.classId) // CAR, MOTORCYCLE, BUS, TRUCK
      );

      log.info(`[RecognitionStrategy] Segmentation: ${segmentationResults.length} subjects (PERSON: ${hasPerson}, VEHICLES: ${hasVehicles})`);

      // Only vehicles detected → Skip face recognition
      if (hasVehicles && !hasPerson) {
        log.info(`[RecognitionStrategy] Only vehicles detected → Face recognition DISABLED`);
        return {
          useFaceRecognition: false,  // ✅ SKIP face recognition
          useNumberRecognition: true,
          context: 'action'
        };
      }

      // Persons detected → Enable face recognition
      if (hasPerson) {
        log.info(`[RecognitionStrategy] Persons detected → Face recognition ENABLED`);
        return {
          useFaceRecognition: this.faceRecognitionEnabled,  // ✅ Enable if preset has descriptors
          useNumberRecognition: true,
          context: hasVehicles ? 'action' : 'auto' // 'action' if mixed person+vehicle
        };
      }

      // Other subjects (bicycle, etc.) → Use face recognition as fallback
      log.info(`[RecognitionStrategy] Other subjects detected → Face recognition as configured`);
    }

    // PRIORITY 2: Fall back to scene classification if no segmentation
    const useFaceRecognition = this.faceRecognitionEnabled;

    if (!sceneCategory) {
      return { useFaceRecognition, useNumberRecognition: true, context: 'auto' };
    }

    switch (sceneCategory) {
      case SceneCategory.CROWD_SCENE:
        // Crowd scenes: face recognition active, number recognition disabled (too many people)
        return { useFaceRecognition, useNumberRecognition: false, context: 'auto' };
      case SceneCategory.GARAGE_PITLANE:
        return { useFaceRecognition, useNumberRecognition: true, context: 'action' };
      case SceneCategory.PODIUM_CELEBRATION:
        return { useFaceRecognition, useNumberRecognition: false, context: 'podium' };
      case SceneCategory.PORTRAIT_PADDOCK:
        return { useFaceRecognition, useNumberRecognition: false, context: 'portrait' };
      case SceneCategory.RACING_ACTION:
        // Racing action: face recognition active (will likely not find faces due to helmets)
        return { useFaceRecognition, useNumberRecognition: true, context: 'action' };
      default:
        return { useFaceRecognition, useNumberRecognition: true, context: 'auto' };
    }
  }

  /**
   * Perform face recognition on an image
   */
  private async performFaceRecognition(imagePath: string, context: 'portrait' | 'action' | 'podium' | 'auto'): Promise<FaceRecognitionResult | null> {
    if (!this.faceRecognitionEnabled || !this.faceDescriptorsLoaded) {
      return null;
    }

    try {
      const startTime = Date.now();

      // Step 1: Detect faces + generate embeddings via ONNX (main process)
      const onnxProcessor = FaceRecognitionOnnxProcessor.getInstance();
      const onnxResult = await onnxProcessor.detectAndEmbed(imagePath);

      if (!onnxResult.success || onnxResult.faces.length === 0) {
        log.info(`[FaceRecognition] No faces detected in image (detection: ${onnxResult.detectionTimeMs}ms)`);
        return {
          success: true,
          matches: [],
          detectionTimeMs: onnxResult.detectionTimeMs,
          matchingTimeMs: 0,
          totalTimeMs: Date.now() - startTime
        };
      }

      log.info(`[FaceRecognition] Detected ${onnxResult.faces.length} face(s), generating embeddings...`);

      // Step 2: Match embeddings against loaded descriptors
      const matchStartTime = Date.now();
      const embeddings = onnxResult.faces
        .filter(f => f.embedding && f.embedding.length > 0)
        .map(f => ({ faceIndex: f.faceIndex, embedding: f.embedding }));

      // Warn once about dimension mismatch (512-dim AuraFace vs 128-dim face-api.js)
      if (embeddings.length > 0 && !this._dimMismatchWarned) {
        const storedDim = faceRecognitionProcessor.getDescriptorDimension();
        const queryDim = embeddings[0].embedding.length;
        if (storedDim > 0 && storedDim !== queryDim) {
          log.warn(`[FaceRecognition] ⚠️  Dimension mismatch: stored descriptors are ${storedDim}-dim but AuraFace generates ${queryDim}-dim. Re-upload face photos to generate 512-dim descriptors.`);
          this._dimMismatchWarned = true;
        }
      }

      const personMatches = faceRecognitionProcessor.matchEmbeddings(embeddings, context as FaceContext);
      const matchingTimeMs = Date.now() - matchStartTime;

      // Convert to bridge-compatible format
      const matches: FaceRecognitionResult['matches'] = personMatches.map((pm: PersonMatch) => ({
        matched: true,
        driverInfo: {
          driverId: pm.personId,
          driverName: pm.personName,
          teamName: pm.team,
          raceNumber: pm.carNumber
        },
        similarity: pm.confidence,
        faceIndex: pm.faceIndex
      }));

      // Add unmatched faces
      for (let i = 0; i < onnxResult.faces.length; i++) {
        if (!matches.some(m => m.faceIndex === i)) {
          matches.push({
            matched: false,
            similarity: 0,
            faceIndex: i
          });
        }
      }

      const result: FaceRecognitionResult = {
        success: true,
        matches,
        detectionTimeMs: onnxResult.detectionTimeMs,
        matchingTimeMs,
        totalTimeMs: Date.now() - startTime
      };

      if (result.matches.length > 0) {
        const matchedCount = result.matches.filter(m => m.matched).length;
        log.info(`Face recognition: ${matchedCount}/${result.matches.length} faces matched in ${result.totalTimeMs}ms`);
      }

      return result;
    } catch (error) {
      log.warn('Face recognition failed:', error);
      return null;
    }
  }

  /**
   * Perform local ONNX inference for race number detection
   * Now includes: image upload, DB tracking, and token deduction (feature parity with cloud API)
   * Returns analysis results in the same format as edge function
   */
  private async analyzeImageLocal(imageBuffer: Buffer, fileName: string, mimeType: string): Promise<any> {
    if (!this.onnxDetector || !this.onnxModelLoaded) {
      throw new Error('ONNX detector not initialized');
    }

    const startTime = Date.now();
    log.info(`[Local ONNX] Analyzing ${fileName}...`);

    // Get user authentication info
    const authState = authService.getAuthState();
    const userId = authState.isAuthenticated ? authState.user?.id : null;

    // Diagnostic logging for tracking issues
    log.info(`[Local ONNX] Auth state: isAuthenticated=${authState.isAuthenticated}, userId=${userId || 'NULL'}, executionId=${this.config.executionId || 'NULL'}`);

    try {
      // 1. Perform local ONNX inference
      const { results: detections, imageSize } = await this.onnxDetector.detect(imageBuffer);
      const inferenceMs = Date.now() - startTime;

      // Convert OnnxAnalysisResult[] to edge function format
      const analysis = detections.map((d, index) => ({
        raceNumber: d.raceNumber,
        confidence: d.confidence,
        drivers: [],  // Local ONNX doesn't detect drivers
        teamName: null,
        otherText: [],
        boundingBox: d.boundingBox,
        vehicleIndex: index,
        modelSource: 'local-onnx' as const
      }));

      log.info(`[Local ONNX] Detected ${analysis.length} race numbers in ${inferenceMs}ms - ${fileName}`);

      // Check if no detections passed confidence threshold - fallback to Gemini
      if (analysis.length === 0) {
        log.warn(`[Local ONNX] No detections above confidence threshold, falling back to Gemini`);

        // Upload image if not already done
        let fallbackStoragePath: string | null = null;
        try {
          fallbackStoragePath = await this.uploadToStorage(fileName, imageBuffer, mimeType);
          log.info(`[Local ONNX Fallback] Image uploaded for Gemini: ${fallbackStoragePath}`);
        } catch (uploadError) {
          log.error(`[Local ONNX Fallback] Upload failed, cannot fallback to Gemini: ${uploadError}`);
          // Return empty result instead of throwing
          return {
            success: false,
            error: 'No detections above threshold and upload failed for Gemini fallback'
          };
        }

        // Call standard Gemini analysis
        try {
          const geminiResult = await this.analyzeImage(fileName, fallbackStoragePath, imageBuffer.length, mimeType);
          log.info(`[Local ONNX Fallback] Gemini analysis succeeded after ONNX returned no detections`);
          return geminiResult;
        } catch (geminiError) {
          log.error(`[Local ONNX Fallback] Gemini also failed: ${geminiError}`);
          return {
            success: false,
            error: `Both ONNX (no detections above threshold) and Gemini failed: ${geminiError}`
          };
        }
      }

      // Variables for cloud tracking
      let imageId: string | null = null;
      let storagePath: string | null = null;
      let tokenDeducted = false;

      // 2. Upload image to Supabase Storage (same as cloud API)
      try {
        storagePath = await this.uploadToStorage(fileName, imageBuffer, mimeType);
        log.info(`[Local ONNX] Image uploaded to storage: ${storagePath}`);
      } catch (uploadError) {
        log.error(`[Local ONNX] Upload FAILED - image will not be saved to database: ${uploadError}`);
        // Continue processing even if upload fails, but log as error for visibility
      }

      // 3. Create image record in database (same as cloud API)
      // Log which conditions are met/not met for debugging
      log.info(`[Local ONNX] DB tracking check: storagePath=${storagePath ? 'OK' : 'NULL'}, userId=${userId ? 'OK' : 'NULL'}`);

      if (!storagePath) {
        log.error(`[Local ONNX] Cannot save to database: storagePath is null (upload failed)`);
      }
      if (!userId) {
        log.error(`[Local ONNX] Cannot save to database: userId is null (not authenticated)`);
      }

      if (storagePath && userId) {
        try {
          const { data: imageRecord, error: imageError } = await this.supabase
            .from('images')
            .insert({
              user_id: userId,
              original_filename: fileName,
              storage_path: storagePath,
              mime_type: mimeType,
              size_bytes: imageBuffer.length,
              execution_id: this.config.executionId || null,
              status: 'analyzed'
            })
            .select('id')
            .single();

          if (imageError) {
            log.error(`[Local ONNX] CRITICAL: Failed to create image record: ${imageError.message}`, imageError);
            log.error(`[Local ONNX] INSERT payload was: user_id=${userId}, execution_id=${this.config.executionId}`);
          } else if (imageRecord) {
            imageId = imageRecord.id;
            log.info(`[Local ONNX] Image record created: ${imageId}`);

            // 4. Save analysis results to database
            const primaryResult = analysis[0] || {};
            let confidenceLevel = 'LOW';
            if ((primaryResult.confidence || 0) >= 0.97) confidenceLevel = 'HIGH';
            else if ((primaryResult.confidence || 0) >= 0.92) confidenceLevel = 'MEDIUM';

            // Build Gemini-compatible vehicles array for management portal
            const vehicles = analysis.map((result: any, index: number) => ({
              raceNumber: result.raceNumber || null,
              confidence: result.confidence || 0,
              boundingBox: result.boundingBox,
              drivers: result.drivers || [],
              teamName: result.teamName || null,
              category: this.category,
              sponsors: [],
              modelSource: 'local-onnx',
              vehicleIndex: index,
              corrections: [],
              finalResult: {
                raceNumber: result.raceNumber || null,
                matchedBy: 'onnx-local'
              }
            }));

            // Queue analysis_results insert for batch processing by the Processor
            // With local ONNX (~200ms/image), 10+ concurrent inserts cause DB timeouts
            // The insert data is returned as part of the worker result and accumulated by UnifiedImageProcessor
            this.pendingAnalysisInsertData = {
              image_id: imageId,
              analysis_provider: `local-onnx_${this.category}`,
              recognized_number: primaryResult.raceNumber || null,
              additional_text: primaryResult.otherText || [],
              confidence_score: primaryResult.confidence || 0,
              confidence_level: confidenceLevel,
              raw_response: {
                // Gemini-compatible format for management portal
                vehicles,
                totalVehicles: vehicles.length,
                // Original ONNX data
                analysis,
                inferenceMs,
                modelSource: 'local-onnx',
                modelCategory: this.category,
                timestamp: new Date().toISOString()
              },
              input_tokens: 0,  // No API tokens for local inference
              output_tokens: 0,
              estimated_cost_usd: 0,  // Free local processing
              execution_time_ms: inferenceMs,
              training_eligible: this.userTrainingConsent,
              user_consent_at_analysis: this.userTrainingConsent
            };
            log.info(`[Local ONNX] Analysis results queued for batch insert - image ${imageId}`);
          }
        } catch (dbError) {
          log.error(`[Local ONNX] CRITICAL: Database tracking failed: ${dbError}`);
        }
      }

      // 5. Deduct token (same as cloud API - 1 token per image)
      // NOTA: Con pre-auth system (v1.1.0+), il token tracking avviene nel processor
      if (userId && !this.config.usePreAuthSystem) {
        try {
          log.info(`[Local ONNX] About to deduct token for ${fileName}, imageId: ${imageId}`);
          await authService.useTokens(1, imageId || undefined, this.config.onTokenUsed);
          tokenDeducted = true;
          log.info(`[Local ONNX] Token deducted successfully for ${fileName}`);
        } catch (tokenError) {
          log.warn(`[Local ONNX] Token deduction failed (non-blocking): ${tokenError}`);
        }
      } else if (!userId) {
        log.warn(`[Local ONNX] No userId available, skipping token deduction`);
      }

      return {
        success: true,
        analysis,
        recognitionMethod: 'local-onnx',
        localOnnxInferenceMs: inferenceMs,
        imageId,  // Now populated when upload succeeds
        tokensUsed: tokenDeducted ? 1 : 0,
        storagePath,  // For debugging
        imageSize,  // Original image dimensions for bbox mapping
        localOnnxUsage: {
          detectionsCount: analysis.length,
          inferenceMs,
          modelCategory: this.category
        }
      };
    } catch (error) {
      log.error(`[Local ONNX] Detection failed for ${fileName}`, error);

      // FALLBACK to Gemini if ONNX fails completely
      if (this.currentSportCategory?.recognition_method === 'local-onnx') {
        log.warn(`[Local ONNX] Falling back to Gemini cloud analysis`);

        // Upload image if not already done
        let fallbackStoragePath: string | null = null;
        try {
          fallbackStoragePath = await this.uploadToStorage(fileName, imageBuffer, mimeType);
          log.info(`[Local ONNX Fallback] Image uploaded for Gemini: ${fallbackStoragePath}`);
        } catch (uploadError) {
          log.error(`[Local ONNX Fallback] Upload failed, cannot fallback to Gemini: ${uploadError}`);
          throw error;  // Re-throw original ONNX error
        }

        // Call standard Gemini analysis
        try {
          const geminiResult = await this.analyzeImage(fileName, fallbackStoragePath, imageBuffer.length, mimeType);
          log.info(`[Local ONNX Fallback] Gemini analysis succeeded`);
          return geminiResult;
        } catch (geminiError) {
          log.error(`[Local ONNX Fallback] Gemini also failed: ${geminiError}`);
          throw error;  // Re-throw original ONNX error
        }
      }

      throw error;  // If not local-onnx, propagate the error
    }
  }

  /**
   * Check if local ONNX should be used for analysis
   * PERFORMANCE: Circuit breaker prevents wasted inference after consecutive failures
   */
  private shouldUseLocalOnnx(): boolean {
    // Must have local ONNX enabled and model loaded
    if (!this.onnxDetectorEnabled || !this.onnxModelLoaded) {
      return false;
    }

    // PERFORMANCE: Circuit breaker - auto-disable after repeated failures
    if (this.onnxCircuitOpen) {
      if (!this.onnxCircuitBreakerLogged) {
        log.warn(`[ONNX] Circuit breaker OPEN: Auto-disabled after ${this.onnxConsecutiveFailures} consecutive failures. Consider different model or configuration.`);
        this.onnxCircuitBreakerLogged = true;
      }
      return false;
    }

    // If crop-context is active, ONNX is managed there (not here)
    if (this.shouldUseCropContext()) {
      return false;
    }

    // Check sport category recognition method
    const recognitionMethod = this.currentSportCategory?.recognition_method;
    return recognitionMethod === 'local-onnx';
  }

  /**
   * Check if crop-context strategy should be used for analysis
   * BACKWARD COMPATIBLE: Returns false if crop_config is null or disabled
   */
  private shouldUseCropContext(): boolean {
    // Check if crop_config exists and is enabled
    let cropConfig = this.currentSportCategory?.crop_config;

    // BACKWARD COMPATIBILITY: If crop_config is null/undefined, use standard flow
    if (!cropConfig) {
      return false;
    }

    // Parse if stored as JSON string (Supabase TEXT column)
    if (typeof cropConfig === 'string') {
      try {
        cropConfig = JSON.parse(cropConfig);
      } catch (e) {
        log.warn(`[CropContext] Failed to parse crop_config JSON: ${e}`);
        return false;
      }
    }

    // Check if enabled flag is explicitly true
    if (cropConfig.enabled !== true) {
      return false;
    }

    // Crop-context compatible with local-onnx AND gemini (only rf-detr excluded)
    const recognitionMethod = this.currentSportCategory?.recognition_method;
    if (recognitionMethod === 'rf-detr') {
      log.debug(`[CropContext] Disabled for rf-detr (uses cloud detection+recognition)`);
      return false;
    }

    // local-onnx can use crops for better accuracy

    log.info(`[CropContext] Enabled for category ${this.category}`);
    return true;
  }

  /**
   * Get crop configuration from sport category or defaults
   */
  private getCropContextConfig(): {
    crop: CropConfig;
    negative: NegativeConfig;
    maxCrops: number;
    strategy: 'batch' | 'sequential';
  } {
    let categoryConfig = this.currentSportCategory?.crop_config;

    // Parse if stored as JSON string (Supabase TEXT column)
    if (typeof categoryConfig === 'string') {
      try {
        categoryConfig = JSON.parse(categoryConfig);
      } catch (e) {
        categoryConfig = null;
      }
    }

    return {
      crop: {
        ...DEFAULT_CROP_CONFIG,
        ...(categoryConfig?.crop || {})
      },
      negative: {
        ...DEFAULT_NEGATIVE_CONFIG,
        ...(categoryConfig?.negative || {})
      },
      maxCrops: categoryConfig?.multiSubject?.maxCropsPerRequest || 5,
      strategy: categoryConfig?.multiSubject?.strategy || 'batch'
    };
  }

  /**
   * Run generic detection to get bounding boxes for crop extraction
   * Uses ONNX detector with a generic model or falls back to edge detection
   */
  private async runGenericDetection(imageBuffer: Buffer): Promise<Array<{ boundingBox: CropBoundingBox; confidence: number; detectionId: string }>> {
    try {
      // Try ONNX detector if available (even for non-ONNX categories)
      if (this.onnxDetector && this.onnxModelLoaded) {
        const result = await this.onnxDetector.detect(imageBuffer);

        if (result.results.length > 0) {
          log.info(`[CropContext] ONNX detected ${result.results.length} subjects`);
          return result.results.map((r, idx) => ({
            boundingBox: r.boundingBox || { x: 0, y: 0, width: 1, height: 1 },
            confidence: r.confidence,
            detectionId: `det_${idx}`
          }));
        }
      }

      // Fallback: No detections found, return empty array
      // The calling code will handle this by falling back to standard analysis
      log.warn(`[CropContext] No detections found, will fallback to standard analysis`);
      return [];
    } catch (error) {
      log.error(`[CropContext] Generic detection failed:`, error);
      return [];
    }
  }

  /**
   * Run generic segmentation using YOLOv8-seg to get bounding boxes + masks
   * This is the PRIMARY detection method when segmentation is enabled - runs BEFORE any recognition.
   * Returns SegmentedDetection[] for use with extractCropsWithMasks()
   */
  /**
   * Result from generic segmentation including metadata for logging
   */
  private lastSegmentationMetadata: {
    used: boolean;
    modelId: string;
    detectionsCount: number;
    inferenceMs: number;
    masksApplied: boolean;
    // Bounding boxes for visualization (normalized 0-100)
    detections?: Array<{
      bbox: { x: number; y: number; width: number; height: number };
      classId: number;
      className: string;
      confidence: number;
      detectionId: string;
    }>;
  } | null = null;

  private async runGenericSegmentation(imageBuffer: Buffer): Promise<SegmentedDetection[]> {
    // Reset metadata
    this.lastSegmentationMetadata = null;

    if (!this.genericSegmenter || !this.genericSegmenterLoaded) {
      log.debug(`[Segmentation] Generic segmenter not available, falling back to bbox detection`);
      return [];
    }

    try {
      const startTime = Date.now();

      // PERFORMANCE: Timeout segmentation to prevent hanging (15s max, reduced from 30s)
      const SEGMENTATION_TIMEOUT_MS = 15000;
      const result: GenericSegmenterOutput = await Promise.race([
        this.genericSegmenter.detect(imageBuffer),
        new Promise<GenericSegmenterOutput>((_, reject) =>
          setTimeout(() => reject(new Error('Segmentation timeout')), SEGMENTATION_TIMEOUT_MS)
        )
      ]).catch((error) => {
        log.warn(`[Segmentation] Timeout after ${SEGMENTATION_TIMEOUT_MS}ms:`, error);
        return { detections: [], imageSize: { width: 0, height: 0 }, inferenceTimeMs: Date.now() - startTime };
      });

      const modelId = this.genericSegmenter?.getModelId() || 'unknown';

      if (result.detections.length === 0) {
        log.info(`[Segmentation] ${modelId} found no subjects (${result.inferenceTimeMs}ms)`);
        // Track even empty segmentation attempts
        this.lastSegmentationMetadata = {
          used: true,
          modelId,
          detectionsCount: 0,
          inferenceMs: result.inferenceTimeMs,
          masksApplied: false
        };
        return [];
      }

      log.info(`[Segmentation] ${modelId} detected ${result.detections.length} subjects in ${result.inferenceTimeMs}ms`);

      // Convert SegmentationResult to SegmentedDetection for crop extraction
      const segmentedDetections: SegmentedDetection[] = result.detections.map((det: SegmentationResult) => ({
        bbox: {
          x: det.bbox.x,
          y: det.bbox.y,
          width: det.bbox.width,
          height: det.bbox.height,
        },
        mask: {
          data: det.mask,
          width: det.maskDims[0],
          height: det.maskDims[1],
        },
        confidence: det.confidence,
        classId: det.classId,
        className: det.className,
        detectionId: det.detectionId,
      }));

      // Track segmentation metadata for logging (including detection bboxes for visualization)
      this.lastSegmentationMetadata = {
        used: true,
        modelId,
        detectionsCount: result.detections.length,
        inferenceMs: result.inferenceTimeMs,
        masksApplied: true,
        // Store detection bboxes for visualization (even when AI returns no results)
        detections: segmentedDetections.map(det => ({
          bbox: det.bbox,
          classId: det.classId,
          className: det.className,
          confidence: det.confidence,
          detectionId: det.detectionId,
        }))
      };

      return segmentedDetections;
    } catch (error) {
      log.error(`[Segmentation] Generic segmentation failed:`, error);
      return [];
    }
  }

  /**
   * Analyze image using crop-context strategy (V6 edge function)
   * Now supports two modes:
   * 1. SEGMENTATION MODE (preferred): Uses YOLOv8-seg to isolate subjects with masks
   * 2. BBOX MODE (fallback): Uses ONNX detector for simple bounding boxes
   */

  /**
   * Analyze extracted crops using local ONNX inference
   * Returns results + flag indicating if Gemini fallback is needed
   */
  private async analyzeCropsWithOnnx(
    cropsPayload: any[],
    extractedCrops: any[],
    detectionSource: 'yolo-seg' | 'onnx-detr'
  ): Promise<{
    results: any[];
    needsGeminiFallback: boolean;
    lowConfidenceCrops: number[];
  }> {
    const results: any[] = [];
    const lowConfidenceCrops: number[] = [];

    // Use sport category's recognition_config.minConfidence (same as Gemini flow)
    // This ensures consistent confidence thresholds across all recognition methods
    const recognitionConfig = this.currentSportCategory?.recognition_config || {
      minConfidence: 0.35  // Default for RF-DETR small models
    };
    const CONFIDENCE_THRESHOLD = recognitionConfig.minConfidence || 0.35;

    console.log(`[ONNX-Crop] Analyzing ${cropsPayload.length} crops with ONNX detector (confidence threshold: ${CONFIDENCE_THRESHOLD})`);

    for (let i = 0; i < cropsPayload.length; i++) {
      try {
        const cropBase64 = cropsPayload[i].imageData;
        const cropBuffer = Buffer.from(cropBase64, 'base64');

        // ONNX inference on crop
        const startMs = Date.now();
        const onnxResult = await this.onnxDetector!.detect(cropBuffer);
        const inferenceMs = Date.now() - startMs;

        if (onnxResult.results.length === 0) {
          log.warn(`[ONNX-Crop] Crop ${i + 1}: No detections found`);
          lowConfidenceCrops.push(i);
          this.onnxConsecutiveFailures++; // PERFORMANCE: Track for circuit breaker
          continue;
        }

        // Take highest confidence detection
        const bestDetection = onnxResult.results.reduce((best, curr) =>
          curr.confidence > best.confidence ? curr : best
        );

        if (bestDetection.confidence < CONFIDENCE_THRESHOLD) {
          log.warn(`[ONNX-Crop] Crop ${i + 1}: Low confidence ${bestDetection.confidence.toFixed(3)} < ${CONFIDENCE_THRESHOLD}`);
          lowConfidenceCrops.push(i);
          this.onnxConsecutiveFailures++; // PERFORMANCE: Track for circuit breaker
          continue;
        }

        // Map ONNX bbox (relative to crop) back to original image coordinates
        const cropInfo = extractedCrops[i] || null;
        const originalBbox = cropInfo?.originalBbox;

        let boundingBox: any = undefined;
        if (originalBbox && bestDetection.boundingBox) {
          // ONNX bbox is relative to crop (0-1), map to original image (0-100 percentage)
          const cropX = originalBbox.x;  // 0-1 normalized (crop position in original image)
          const cropY = originalBbox.y;
          const cropW = originalBbox.width;  // 0-1 normalized (crop size)
          const cropH = originalBbox.height;

          // Convert from crop-relative to image-relative coordinates
          boundingBox = {
            x: (cropX + bestDetection.boundingBox.x * cropW) * 100,
            y: (cropY + bestDetection.boundingBox.y * cropH) * 100,
            width: bestDetection.boundingBox.width * cropW * 100,
            height: bestDetection.boundingBox.height * cropH * 100
          };

          log.info(`[ONNX-Crop] Crop ${i + 1} bbox mapped: crop(${(bestDetection.boundingBox.x * 100).toFixed(1)}%, ${(bestDetection.boundingBox.y * 100).toFixed(1)}%) → image(${boundingBox.x.toFixed(1)}%, ${boundingBox.y.toFixed(1)}%)`);
        } else {
          // Fallback: if originalBbox is missing, log warning
          log.warn(`[ONNX-Crop] Crop ${i + 1}: Missing originalBbox, bbox will not be mapped to full image!`);
          // Use bbox relative to crop (not ideal, but better than nothing)
          if (bestDetection.boundingBox) {
            boundingBox = {
              x: bestDetection.boundingBox.x * 100,
              y: bestDetection.boundingBox.y * 100,
              width: bestDetection.boundingBox.width * 100,
              height: bestDetection.boundingBox.height * 100
            };
          }
        }

        results.push({
          raceNumber: bestDetection.raceNumber,
          confidence: bestDetection.confidence,
          className: bestDetection.className,
          boundingBox,
          drivers: [],  // ONNX doesn't extract drivers
          teamName: null,
          otherText: [],
          modelSource: 'local-onnx-crop',
          bboxSource: detectionSource,  // Track original detection source
          inferenceTimeMs: inferenceMs
        });

        log.info(`[ONNX-Crop] Crop ${i + 1}: Found ${bestDetection.raceNumber} (confidence: ${bestDetection.confidence.toFixed(3)}, ${inferenceMs}ms)`);

        // PERFORMANCE: Reset circuit breaker on success
        this.onnxConsecutiveFailures = 0;

      } catch (error) {
        log.error(`[ONNX-Crop] Crop ${i + 1} failed:`, error);
        lowConfidenceCrops.push(i);
      }
    }

    const needsGeminiFallback = results.length === 0 || lowConfidenceCrops.length > 0;

    log.info(`[ONNX-Crop] Complete: ${results.length}/${cropsPayload.length} crops analyzed successfully`);
    if (needsGeminiFallback) {
      log.info(`[ONNX-Crop] ${lowConfidenceCrops.length} crops need Gemini fallback`);
    }

    // PERFORMANCE: Trigger circuit breaker if too many consecutive failures
    if (this.onnxConsecutiveFailures >= this.onnxCircuitBreakerThreshold && !this.onnxCircuitOpen) {
      this.onnxCircuitOpen = true;
      log.warn(`[ONNX] Circuit breaker TRIGGERED: ${this.onnxConsecutiveFailures} consecutive failures. Auto-disabled for remainder of batch.`);
    }

    return { results, needsGeminiFallback, lowConfidenceCrops };
  }

  /**
   * Analyze image using crop-context strategy (V6 edge function)
   * Now supports two modes:
   * 1. SEGMENTATION MODE (preferred): Uses YOLOv8-seg to isolate subjects with masks
   * 2. BBOX MODE (fallback): Uses ONNX detector for simple bounding boxes
   */
  private async analyzeWithCropContext(
    imageFile: UnifiedImageFile,
    compressedBuffer: Buffer,
    mimeType: string,
    uploadReadyPath?: string,
    storagePath?: string  // Storage path from Supabase upload
  ): Promise<any> {
    const startTime = Date.now();
    // Detailed timing for AI analysis breakdown
    const aiTiming: Record<string, number> = {};
    let phaseStart = Date.now();

    log.info(`[CropContext] Starting crop-context analysis for ${imageFile.fileName}`);

    // Use uploadReadyPath for crop extraction (supports RAW files converted to JPEG)
    // Falls back to originalPath for already-supported formats
    const effectivePath = uploadReadyPath || imageFile.originalPath;
    log.info(`[CropContext] Using image path for crop extraction: ${effectivePath}`);

    try {
      const cropContextConfig = this.getCropContextConfig();

      // ==================== ONNX FULL-IMAGE FIRST (FIX 2026) ====================
      // CRITICAL: ONNX models were trained on FULL generic images (640x640px)
      // where cars are a portion of the frame, NOT on crops.
      // Try ONNX on full image BEFORE extracting crops.
      // Only extract crops for Gemini if ONNX fails.
      const currentRecognitionMethod = this.currentSportCategory?.recognition_method;
      const recognitionConfig = this.currentSportCategory?.recognition_config || {};
      const CONFIDENCE_THRESHOLD = recognitionConfig.minConfidence || 0.35;

      if (currentRecognitionMethod === 'local-onnx' && this.onnxDetectorEnabled && this.onnxModelLoaded) {
        log.info(`[CropContext] Trying local ONNX on FULL IMAGE first (threshold: ${CONFIDENCE_THRESHOLD})`);

        try {
          const fullImageStartTime = Date.now();
          const { results: detections, imageSize } = await this.onnxDetector!.detect(compressedBuffer);
          const inferenceMs = Date.now() - fullImageStartTime;

          // Filter by confidence threshold
          const validDetections = detections.filter(d => d.confidence >= CONFIDENCE_THRESHOLD);

          if (validDetections.length > 0) {
            log.info(`[CropContext] ✓ ONNX full-image SUCCESS: ${validDetections.length} detections in ${inferenceMs}ms - SKIPPING crop extraction and Gemini`);

            // Reset circuit breaker on success
            this.onnxConsecutiveFailures = 0;

            // Convert to edge function format
            const analysis = validDetections.map((d, index) => ({
              raceNumber: d.raceNumber,
              confidence: d.confidence,
              drivers: [],
              teamName: null,
              otherText: [],
              boundingBox: d.boundingBox,
              vehicleIndex: index,
              modelSource: 'local-onnx' as const,
              bboxSource: 'full-image' as const
            }));

            // Upload to storage and save to database (same as analyzeImageLocal)
            const authState = authService.getAuthState();
            const userId = authState.isAuthenticated ? authState.user?.id : null;

            let imageId: string | null = null;
            let uploadedStoragePath: string | null = storagePath || null;

            // Upload if not already uploaded
            if (!uploadedStoragePath) {
              try {
                uploadedStoragePath = await this.uploadToStorage(imageFile.fileName, compressedBuffer, mimeType);
                log.info(`[CropContext-ONNX-Full] Image uploaded to storage: ${uploadedStoragePath}`);
              } catch (uploadError) {
                log.error(`[CropContext-ONNX-Full] Upload failed: ${uploadError}`);
              }
            }

            // Create image record in database
            if (uploadedStoragePath && userId) {
              try {
                const { data: imageRecord, error: imageError } = await this.supabase
                  .from('images')
                  .insert({
                    user_id: userId,
                    original_filename: imageFile.fileName,
                    storage_path: uploadedStoragePath,
                    mime_type: mimeType,
                    size_bytes: compressedBuffer.length,
                    execution_id: this.config.executionId || null,
                    status: 'analyzed'
                  })
                  .select('id')
                  .single();

                if (imageError) {
                  log.error(`[CropContext-ONNX-Full] Failed to create image record: ${imageError.message}`);
                } else if (imageRecord) {
                  imageId = imageRecord.id;
                  log.info(`[CropContext-ONNX-Full] Image record created: ${imageId}`);

                  // Save analysis results to database
                  for (const result of analysis) {
                    let confidenceLevel = 'LOW';
                    if ((result.confidence || 0) >= 0.97) confidenceLevel = 'HIGH';
                    else if ((result.confidence || 0) >= 0.92) confidenceLevel = 'MEDIUM';

                    const vehicleData = {
                      raceNumber: result.raceNumber || null,
                      confidence: result.confidence || 0,
                      boundingBox: result.boundingBox,
                      drivers: result.drivers || [],
                      teamName: result.teamName || null,
                      category: this.category,
                      sponsors: [],
                      modelSource: 'local-onnx-full',
                      vehicleIndex: analysis.indexOf(result),
                      corrections: [],
                      finalResult: {
                        raceNumber: result.raceNumber || null,
                        matchedBy: 'onnx-local-full'
                      }
                    };

                    await this.supabase.from('analysis_results').insert({
                      image_id: imageId,
                      execution_id: this.config.executionId || null,
                      detected_numbers: result.raceNumber ? [result.raceNumber] : [],
                      confidence_scores: [result.confidence || 0],
                      confidence_level: confidenceLevel,
                      raw_response: { vehicle: vehicleData },
                      processing_time_ms: inferenceMs,
                      model_used: 'local-onnx-full'
                    });
                  }

                  log.info(`[CropContext-ONNX-Full] Saved ${analysis.length} analysis results to database`);
                }
              } catch (dbError) {
                log.error(`[CropContext-ONNX-Full] Database error: ${dbError}`);
              }
            }

            // Return success immediately (skip crop extraction and Gemini)
            return {
              success: true,
              analysis,
              imageId,
              storagePath: uploadedStoragePath,
              tokensConsumed: 0,  // Local ONNX doesn't consume tokens
              inferenceTimeMs: inferenceMs,
              bboxSource: 'full-image',
              modelSource: 'local-onnx-full'
            };
          } else {
            log.warn(`[CropContext] ✗ ONNX full-image FAILED: ${detections.length} detections, ${validDetections.length} above threshold ${CONFIDENCE_THRESHOLD} - falling back to Gemini with crops`);
            this.onnxConsecutiveFailures++;

            // CIRCUIT BREAKER: Disable ONNX after 5 consecutive failures
            if (this.onnxConsecutiveFailures >= 5) {
              log.error(`[CropContext] CIRCUIT BREAKER: Disabling ONNX after ${this.onnxConsecutiveFailures} consecutive failures`);
              this.onnxDetectorEnabled = false;
            }

            // Continue to crop extraction + Gemini fallback below
          }
        } catch (onnxError) {
          log.error(`[CropContext] ONNX full-image error: ${onnxError} - falling back to Gemini with crops`);
          this.onnxConsecutiveFailures++;
          // Continue to crop extraction + Gemini fallback below
        }
      }

      // ==================== CROP EXTRACTION (for Gemini fallback) ====================
      let cropsPayload: any[] = [];
      let negativePayload: any | undefined;
      let extractedCrops: any[] = [];
      // V6 Baseline 2026: Track detection source for bboxSource field
      let detectionSource: 'yolo-seg' | 'onnx-detr' | 'full-image' | 'gemini' = 'gemini';

      // Step 1: Try SEGMENTATION first (YOLO with masks) if enabled
      phaseStart = Date.now();
      if (this.genericSegmenterEnabled && this.genericSegmenterLoaded) {
        const segModelId = this.genericSegmenter?.getModelId() || 'yolo-seg';
        log.info(`[CropContext] Using SEGMENTATION mode (${segModelId} with masks)`);

        // PERFORMANCE: Reuse cached segmentation results if available (avoid running twice)
        let segmentations: SegmentedDetection[];
        if (this.cachedSegmentationResults !== null) {
          log.info(`[CropContext] Reusing cached segmentation results (${this.cachedSegmentationResults.length} subjects)`);
          segmentations = this.cachedSegmentationResults;
          aiTiming['segmentation'] = 0; // Already executed earlier
        } else {
          log.info(`[CropContext] Running fresh segmentation`);
          segmentations = await this.runGenericSegmentation(compressedBuffer);
          aiTiming['segmentation'] = Date.now() - phaseStart;
        }

        if (segmentations.length > 0) {
          // Use mask-based crop extraction
          const maskConfig: Partial<MaskCropConfig> = {
            enabled: true,
            backgroundMode: 'black',  // Mask other subjects with black
            maskOtherSubjects: true,
          };

          // Check if we should save raw mask data for visualization
          const saveSegmentationMasks = this.currentSportCategory?.save_segmentation_masks ?? false;
          const extractMaskOptions: ExtractMaskOptions = {
            includeRawMaskData: saveSegmentationMasks,
          };

          phaseStart = Date.now();
          const maskedCropResult = await extractCropsWithMasks(
            effectivePath,  // Use JPEG-converted path for RAW file support
            segmentations,
            cropContextConfig.crop,
            maskConfig,
            cropContextConfig.maxCrops,
            extractMaskOptions
          );
          aiTiming['cropExtraction'] = Date.now() - phaseStart;

          if (maskedCropResult.crops.length > 0) {
            log.info(`[CropContext] Extracted ${maskedCropResult.crops.length} masked crops in ${maskedCropResult.processingTimeMs}ms${saveSegmentationMasks ? ' (with RLE mask data)' : ''}`);

            // Convert to base64 payload for V6, optionally including RLE mask data
            cropsPayload = maskedCropsToBase64(maskedCropResult.crops, { includeRawMaskData: saveSegmentationMasks });
            extractedCrops = maskedCropResult.crops;
            // V6 Baseline 2026: Mark as yolo-seg detection source
            detectionSource = 'yolo-seg';

            // Note: Negative is not typically needed with segmentation since masks already isolate subjects
            negativePayload = undefined;
          } else {
            log.warn(`[CropContext] Mask crop extraction failed, falling back to bbox mode`);
          }
        } else {
          // YOLO-seg found no subjects - handle fallback based on sport_categories settings
          log.info(`[CropContext] ${segModelId} found no subjects, checking fallback strategy`);

          // V6 Baseline 2026: Send fullImage to V6 instead of returning null
          if (this.currentSportCategory?.edge_function_version === 6) {
            log.info(`[CropContext] V6: Sending full image (no subjects detected by ${segModelId})`);
            return await this.sendFullImageToV6(imageFile, compressedBuffer, effectivePath, storagePath, mimeType);
          }

          // Legacy behavior: Return null to trigger standard analysis flow
          if (this.currentSportCategory?.use_scene_classifier && this.sceneClassificationEnabled) {
            log.info(`[CropContext] Using scene classifier for routing (no subjects detected)`);
            return null;
          } else {
            log.info(`[CropContext] Analyzing full image with Gemini (no subjects detected)`);
            return null;
          }
        }
      }

      // Step 2: If no segmentation crops, fall back to BBOX mode (original detection)
      if (!cropsPayload || cropsPayload.length === 0) {
        log.info(`[CropContext] Using BBOX mode (fallback to ONNX detector)`);

        phaseStart = Date.now();
        const detections = await this.runGenericDetection(compressedBuffer);
        aiTiming['onnxDetection'] = Date.now() - phaseStart;

        // If no detections, fallback to standard analysis or V6 fullImage
        if (detections.length === 0) {
          // V6 Baseline 2026: Send fullImage to V6 instead of returning null
          if (this.currentSportCategory?.edge_function_version === 6) {
            log.info(`[CropContext] V6: Sending full image (no subjects detected by ONNX)`);
            return await this.sendFullImageToV6(imageFile, compressedBuffer, effectivePath, storagePath, mimeType);
          }
          log.warn(`[CropContext] No detections found, falling back to standard upload+analyze`);
          return null; // Signal to caller to use standard flow
        }

        // Extract crops using bbox-only method
        const bboxesWithIds = detections.map(d => ({
          ...d.boundingBox,
          detectionId: d.detectionId
        }));

        phaseStart = Date.now();
        const cropContextResult = await extractCropContext(
          effectivePath,  // Use JPEG-converted path for RAW file support
          compressedBuffer,
          bboxesWithIds,
          cropContextConfig.crop,
          cropContextConfig.negative,
          cropContextConfig.maxCrops
        );
        aiTiming['cropExtraction'] = Date.now() - phaseStart;

        // If crop extraction failed, fallback
        if (cropContextResult.crops.length === 0) {
          log.warn(`[CropContext] Crop extraction failed, falling back to standard analysis`);
          return null;
        }

        log.info(`[CropContext] Extracted ${cropContextResult.crops.length} bbox crops${cropContextResult.negative ? ' + negative' : ''} in ${cropContextResult.processingTimeMs}ms`);

        // Prepare payload for V6 edge function (bbox mode)
        cropsPayload = cropsToBase64(cropContextResult.crops);
        negativePayload = cropContextResult.negative
          ? negativeToBase64(cropContextResult.negative)
          : undefined;
        extractedCrops = cropContextResult.crops;
        // V6 Baseline 2026: Mark as onnx-detr detection source
        detectionSource = 'onnx-detr';
      }

      // Get auth info
      const authState = authService.getAuthState();
      const userId = authState.isAuthenticated ? authState.user?.id : null;

      let allAnalysis: any[] = [];
      let totalUsage = { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 };
      let tokensUsed = 0;
      let v6ImageId: string | undefined;  // DB UUID from V6 response for analysis_log UPDATE

      // ==================== DECIDE: ONNX vs GEMINI ====================
      const recognitionMethod = this.currentSportCategory?.recognition_method;

      if (recognitionMethod === 'local-onnx' && this.onnxDetectorEnabled && this.onnxModelLoaded) {
        // ==================== ONNX INFERENCE ON CROPS ====================
        log.info(`[CropContext] Using local ONNX inference on ${cropsPayload.length} extracted crops`);

        phaseStart = Date.now();
        const onnxCropResult = await this.analyzeCropsWithOnnx(
          cropsPayload,
          extractedCrops,
          detectionSource === 'gemini' ? 'onnx-detr' : detectionSource  // Default to onnx-detr if gemini
        );
        aiTiming['onnxCropInference'] = Date.now() - phaseStart;

        // If ONNX provided high-confidence results for all crops, use them
        if (onnxCropResult.results.length === cropsPayload.length) {
          log.info(`[CropContext] ONNX inference successful for all ${cropsPayload.length} crops - skipping Gemini`);
          allAnalysis = onnxCropResult.results;

          // Still upload to storage and create DB records (same logic as analyzeImageLocal)
          let imageId: string | null = null;
          let uploadedStoragePath: string | null = storagePath || null;  // May already be set from earlier upload

          // Upload if not already uploaded
          if (!uploadedStoragePath) {
            try {
              uploadedStoragePath = await this.uploadToStorage(imageFile.fileName, compressedBuffer, mimeType);
              log.info(`[CropContext-ONNX] Image uploaded to storage: ${uploadedStoragePath}`);
            } catch (uploadError) {
              log.error(`[CropContext-ONNX] Upload failed: ${uploadError}`);
            }
          }

          // Create image record in database
          if (uploadedStoragePath && userId) {
            try {
              const { data: imageRecord, error: imageError } = await this.supabase
                .from('images')
                .insert({
                  user_id: userId,
                  original_filename: imageFile.fileName,
                  storage_path: uploadedStoragePath,
                  mime_type: mimeType,
                  size_bytes: compressedBuffer.length,
                  execution_id: this.config.executionId || null,
                  status: 'analyzed'
                })
                .select('id')
                .single();

              if (imageError) {
                log.error(`[CropContext-ONNX] Failed to create image record: ${imageError.message}`);
              } else if (imageRecord) {
                imageId = imageRecord.id;
                log.info(`[CropContext-ONNX] Image record created: ${imageId}`);

                // Save analysis results to database (one per crop/detection)
                for (const result of allAnalysis) {
                  let confidenceLevel = 'LOW';
                  if ((result.confidence || 0) >= 0.97) confidenceLevel = 'HIGH';
                  else if ((result.confidence || 0) >= 0.92) confidenceLevel = 'MEDIUM';

                  // Build Gemini-compatible vehicle structure for management portal
                  const vehicleData = {
                    raceNumber: result.raceNumber || null,
                    confidence: result.confidence || 0,
                    boundingBox: result.boundingBox,  // Already mapped to full image coordinates (0-100%)
                    drivers: result.drivers || [],
                    teamName: result.teamName || null,
                    category: this.category,
                    sponsors: [],
                    modelSource: 'local-onnx-crop',
                    vehicleIndex: allAnalysis.indexOf(result),
                    corrections: [],
                    finalResult: {
                      raceNumber: result.raceNumber || null,
                      matchedBy: 'onnx-local'
                    }
                  };

                  // Log bbox for verification
                  if (result.boundingBox) {
                    log.info(`[CropContext-ONNX] Saving bbox for ${result.raceNumber}: (${result.boundingBox.x.toFixed(1)}%, ${result.boundingBox.y.toFixed(1)}%, ${result.boundingBox.width.toFixed(1)}% x ${result.boundingBox.height.toFixed(1)}%)`);
                  } else {
                    log.warn(`[CropContext-ONNX] No boundingBox for ${result.raceNumber} - will not be visualizable in portal!`);
                  }

                  const { error: analysisError } = await this.supabase
                    .from('analysis_results')
                    .insert({
                      image_id: imageId,
                      analysis_provider: `local-onnx-crop_${this.category}`,
                      recognized_number: result.raceNumber || null,
                      additional_text: result.otherText || [],
                      confidence_score: result.confidence || 0,
                      confidence_level: confidenceLevel,
                      raw_response: {
                        // Gemini-compatible format for management portal
                        vehicles: [vehicleData],
                        totalVehicles: 1,
                        // Original ONNX data
                        ...result,
                        modelSource: 'local-onnx-crop',
                        bboxSource: detectionSource,
                        cropIndex: allAnalysis.indexOf(result),
                        timestamp: new Date().toISOString()
                      },
                      input_tokens: 0,
                      output_tokens: 0,
                      estimated_cost_usd: 0,
                      execution_time_ms: result.inferenceTimeMs || 0,
                      training_eligible: this.userTrainingConsent,
                      user_consent_at_analysis: this.userTrainingConsent
                    });

                  if (analysisError) {
                    log.error(`[CropContext-ONNX] Failed to save analysis result: ${analysisError.message}`);
                  }
                }
              }
            } catch (dbError) {
              log.error(`[CropContext-ONNX] Database tracking failed: ${dbError}`);
            }
          }

          // Deduct tokens (1 token per image, even with multiple crops)
          if (userId && !this.config.usePreAuthSystem) {
            try {
              await authService.useTokens(1, imageId || undefined, this.config.onTokenUsed);
              log.info(`[CropContext-ONNX] Token deducted successfully`);
            } catch (tokenError) {
              log.warn(`[CropContext-ONNX] Token deduction failed: ${tokenError}`);
            }
          }

          const inferenceTimeMs = Date.now() - startTime;
          log.info(`[CropContext] Local ONNX analysis complete in ${inferenceTimeMs}ms (0 API cost)`);

          return {
            success: true,
            analysis: allAnalysis,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUSD: 0
            },
            inferenceTimeMs,
            recognitionMethod: 'local-onnx',
            detectionSource,
            v6ImageId: imageId,
            processingTimings: aiTiming
          };
        }

        // PARTIAL SUCCESS: Some crops worked with ONNX, some need Gemini fallback
        if (onnxCropResult.results.length > 0 && onnxCropResult.needsGeminiFallback) {
          log.info(`[CropContext] ONNX: ${onnxCropResult.results.length}/${cropsPayload.length} crops successful, calling Gemini for ${onnxCropResult.lowConfidenceCrops.length} low-confidence crops`);

          // Prepare reduced payload with only low-confidence crops
          const fallbackCrops = onnxCropResult.lowConfidenceCrops.map(idx => cropsPayload[idx]);

          // Continue to Gemini V6 call below with reduced payload
          cropsPayload = fallbackCrops;
          allAnalysis = onnxCropResult.results;  // Keep ONNX results, add Gemini results below

          log.info(`[CropContext] Proceeding with Gemini fallback for ${fallbackCrops.length} crops`);
        }

        // TOTAL FAILURE: ONNX found nothing with confidence > threshold
        if (onnxCropResult.results.length === 0) {
          log.warn(`[CropContext] ONNX inference failed for all crops (low confidence or errors), falling back to Gemini V6`);
          // Continue to normal Gemini V6 flow below
        }
      }
      // ==================== END ONNX LAYER ====================

      // ==================== GEMINI V6 FLOW ====================
      // This block executes IF:
      // 1. recognition_method === 'gemini' (or other)
      // 2. recognition_method === 'local-onnx' BUT ONNX partially failed (see above)

      // Step 4: Call V6 edge function based on strategy
      if (cropContextConfig.strategy === 'sequential') {
        // SEQUENTIAL: Process each crop one at a time
        log.info(`[CropContext] Using SEQUENTIAL strategy - processing ${cropsPayload.length} crops one by one`);

        for (let i = 0; i < cropsPayload.length; i++) {
          const singleCropPayload = {
            crops: [cropsPayload[i]],
            negative: negativePayload, // Include context with each call
            category: this.category,
            userId,
            executionId: this.config.executionId,
            // DB write support: imageId for analysis_results correlation
            imageId: imageFile.id,
            originalFileName: imageFile.fileName,
            // Storage tracking for database writes
            storagePath,
            mimeType,
            sizeBytes: compressedBuffer.length,
            participantPreset: this.participantsData.length > 0 ? {
              name: 'Preset Dynamic',
              participants: this.participantsData
            } : undefined,
            modelName: APP_CONFIG.defaultModel,
            // V6 Baseline 2026: Track detection source
            bboxSources: [detectionSource]
          };

          log.info(`[CropContext] Sequential call ${i + 1}/${cropsPayload.length}`);

          const response = await Promise.race([
            this.supabase.functions.invoke('analyzeImageDesktopV6', { body: singleCropPayload }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('V6 function invocation timeout')), 60000)
            )
          ]) as any;

          if (response.error) {
            log.warn(`[CropContext] Sequential call ${i + 1} failed:`, response.error);
            continue; // Continue with next crop
          }

          if (response.data.success && response.data.cropAnalysis) {
            // Capture imageId from first successful response
            if (!v6ImageId && response.data.imageId) {
              v6ImageId = response.data.imageId;
            }
            const cropResult = response.data.cropAnalysis[0];
            if (cropResult) {
              // Get bbox from response or local data, convert from 0-1 to 0-100 for logging
              const rawBbox = cropResult.originalBbox || extractedCrops.find((c: any) => c.detectionId === cropResult.detectionId)?.originalBbox;
              const boundingBox = rawBbox ? {
                x: rawBbox.x * 100,
                y: rawBbox.y * 100,
                width: rawBbox.width * 100,
                height: rawBbox.height * 100
              } : undefined;

              allAnalysis.push({
                raceNumber: cropResult.raceNumber,
                drivers: cropResult.drivers || [],
                category: this.category,
                teamName: cropResult.teamName,
                otherText: cropResult.otherText || [],
                confidence: cropResult.confidence,
                boundingBox,
                modelSource: 'gemini-v6-crop-seq'
              });
            }
            // Accumulate usage
            if (response.data.usage) {
              totalUsage.inputTokens += response.data.usage.inputTokens || 0;
              totalUsage.outputTokens += response.data.usage.outputTokens || 0;
              totalUsage.estimatedCostUSD += response.data.usage.estimatedCostUSD || 0;
            }
          }

          // Deduct token for each sequential call
          // NOTA: Con pre-auth system (v1.1.0+), il token tracking avviene nel processor
          if (userId && !this.config.usePreAuthSystem) {
            await authService.useTokens(1, undefined, this.config.onTokenUsed);
            tokensUsed++;
          }
        }

        log.info(`[CropContext] Sequential processing complete: ${allAnalysis.length} results from ${cropsPayload.length} crops`);

      } else {
        // BATCH: Send all crops in a single call (default)
        log.info(`[CropContext] Using BATCH strategy - sending ${cropsPayload.length} crops in single call`);

        phaseStart = Date.now();
        const v6Payload = {
          crops: cropsPayload,
          negative: negativePayload,
          category: this.category,
          userId,
          executionId: this.config.executionId,
          // DB write support: imageId for analysis_results correlation
          imageId: imageFile.id,
          originalFileName: imageFile.fileName,
          // Storage tracking for database writes
          storagePath,
          mimeType,
          sizeBytes: compressedBuffer.length,
          participantPreset: this.participantsData.length > 0 ? {
            name: 'Preset Dynamic',
            participants: this.participantsData
          } : undefined,
          modelName: APP_CONFIG.defaultModel,
          // V6 Baseline 2026: Track detection source for all crops
          bboxSources: cropsPayload.map(() => detectionSource)
        };

        const response = await Promise.race([
          this.supabase.functions.invoke('analyzeImageDesktopV6', { body: v6Payload }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('V6 function invocation timeout')), 60000)
          )
        ]) as any;
        aiTiming['edgeFunctionV6'] = Date.now() - phaseStart;

        if (response.error) {
          log.error(`[CropContext] V6 edge function error:`, response.error);
          throw new Error(`V6 function error: ${response.error.message || 'Unknown error'}`);
        }

        if (!response.data.success) {
          log.error(`[CropContext] V6 analysis failed:`, response.data.error);
          throw new Error(`V6 analysis failed: ${response.data.error || 'Unknown error'}`);
        }

        // Transform V6 response to standard analysis format
        const v6Result = response.data;
        v6ImageId = v6Result.imageId;  // Capture DB UUID for analysis_log UPDATE
        allAnalysis = v6Result.cropAnalysis.map((crop: any) => {
          // Get bbox from response or local data, convert from 0-1 to 0-100 for logging
          const rawBbox = crop.originalBbox || extractedCrops.find((c: any) => c.detectionId === crop.detectionId)?.originalBbox;
          const boundingBox = rawBbox ? {
            x: rawBbox.x * 100,
            y: rawBbox.y * 100,
            width: rawBbox.width * 100,
            height: rawBbox.height * 100
          } : undefined;

          return {
            raceNumber: crop.raceNumber,
            drivers: crop.drivers || [],
            category: this.category,
            teamName: crop.teamName,
            otherText: crop.otherText || [],
            confidence: crop.confidence,
            boundingBox,
            modelSource: 'gemini-v6-crop'
          };
        });

        totalUsage = v6Result.usage || totalUsage;

        // Deduct single token for batch call
        // NOTA: Con pre-auth system (v1.1.0+), il token tracking avviene nel processor
        if (userId && !this.config.usePreAuthSystem) {
          await authService.useTokens(1, undefined, this.config.onTokenUsed);
          tokensUsed = 1;
        }
      }

      // ==================== FINAL FALLBACK: ONNX on Full Image ====================
      // If ONNX is enabled but crops didn't work, try full image as last resort
      if (this.onnxDetectorEnabled &&
          this.onnxModelLoaded &&
          allAnalysis.length === 0) {

        log.warn(`[CropContext] All crop-based methods failed, trying ONNX on full image`);

        try {
          phaseStart = Date.now();
          const fullImageOnnxResult = await this.onnxDetector!.detect(compressedBuffer);
          aiTiming['onnxFullImage'] = Date.now() - phaseStart;

          if (fullImageOnnxResult.results.length > 0) {
            log.info(`[CropContext] ONNX full image found ${fullImageOnnxResult.results.length} results`);

            allAnalysis = fullImageOnnxResult.results.map(r => ({
              ...r,
              modelSource: 'local-onnx-full-image',
              bboxSource: 'full-image',
              drivers: [],
              teamName: null,
              otherText: []
            }));

            // Upload and create DB records (same logic as ONNX crop success)
            let imageId: string | null = null;
            let uploadedStoragePath: string | null = storagePath || null;

            if (!uploadedStoragePath) {
              try {
                uploadedStoragePath = await this.uploadToStorage(imageFile.fileName, compressedBuffer, mimeType);
                log.info(`[CropContext-ONNX-Full] Image uploaded to storage: ${uploadedStoragePath}`);
              } catch (uploadError) {
                log.error(`[CropContext-ONNX-Full] Upload failed: ${uploadError}`);
              }
            }

            if (uploadedStoragePath && userId) {
              try {
                const { data: imageRecord, error: imageError } = await this.supabase
                  .from('images')
                  .insert({
                    user_id: userId,
                    original_filename: imageFile.fileName,
                    storage_path: uploadedStoragePath,
                    mime_type: mimeType,
                    size_bytes: compressedBuffer.length,
                    execution_id: this.config.executionId || null,
                    status: 'analyzed'
                  })
                  .select('id')
                  .single();

                if (imageError) {
                  log.error(`[CropContext-ONNX-Full] Failed to create image record: ${imageError.message}`);
                } else if (imageRecord) {
                  imageId = imageRecord.id;
                  v6ImageId = imageId || undefined;
                  log.info(`[CropContext-ONNX-Full] Image record created: ${imageId}`);

                  // Save analysis results
                  for (const result of allAnalysis) {
                    let confidenceLevel = 'LOW';
                    if ((result.confidence || 0) >= 0.97) confidenceLevel = 'HIGH';
                    else if ((result.confidence || 0) >= 0.92) confidenceLevel = 'MEDIUM';

                    // Build Gemini-compatible vehicle structure for management portal
                    const vehicleData = {
                      raceNumber: result.raceNumber || null,
                      confidence: result.confidence || 0,
                      boundingBox: result.boundingBox,
                      drivers: result.drivers || [],
                      teamName: result.teamName || null,
                      category: this.category,
                      sponsors: [],
                      modelSource: 'local-onnx-full-image',
                      vehicleIndex: allAnalysis.indexOf(result),
                      corrections: [],
                      finalResult: {
                        raceNumber: result.raceNumber || null,
                        matchedBy: 'onnx-local-full'
                      }
                    };

                    const { error: analysisError } = await this.supabase
                      .from('analysis_results')
                      .insert({
                        image_id: imageId,
                        analysis_provider: `local-onnx-full_${this.category}`,
                        recognized_number: result.raceNumber || null,
                        additional_text: result.otherText || [],
                        confidence_score: result.confidence || 0,
                        confidence_level: confidenceLevel,
                        raw_response: {
                          // Gemini-compatible format for management portal
                          vehicles: [vehicleData],
                          totalVehicles: 1,
                          // Original ONNX data
                          ...result,
                          modelSource: 'local-onnx-full-image',
                          bboxSource: 'full-image',
                          timestamp: new Date().toISOString()
                        },
                        input_tokens: 0,
                        output_tokens: 0,
                        estimated_cost_usd: 0,
                        execution_time_ms: aiTiming['onnxFullImage'] || undefined,
                        training_eligible: this.userTrainingConsent,
                        user_consent_at_analysis: this.userTrainingConsent
                      });

                    if (analysisError) {
                      log.error(`[CropContext-ONNX-Full] Failed to save analysis result: ${analysisError.message}`);
                    }
                  }
                }
              } catch (dbError) {
                log.error(`[CropContext-ONNX-Full] Database tracking failed: ${dbError}`);
              }
            }

            // Deduct token
            if (userId && !this.config.usePreAuthSystem) {
              try {
                await authService.useTokens(1, imageId || undefined, this.config.onTokenUsed);
                tokensUsed = 1;
              } catch (tokenError) {
                log.warn(`[CropContext-ONNX-Full] Token deduction failed: ${tokenError}`);
              }
            }

            // Track recognition method
            if (!this.recognitionMethod) {
              this.recognitionMethod = 'local-onnx';
            }
          }
        } catch (error) {
          log.error(`[CropContext] ONNX full image fallback failed:`, error);
          // Continue to final check below
        }
      }
      // ==================== END FULL IMAGE FALLBACK ====================

      // Check if we got any results
      if (allAnalysis.length === 0) {
        log.warn(`[CropContext] No analysis results obtained, falling back to standard`);
        return null;
      }

      log.info(`[CropContext] Token(s) deducted: ${tokensUsed} for ${imageFile.fileName}`);

      // Track recognition method
      if (!this.recognitionMethod) {
        this.recognitionMethod = 'gemini';
      }

      const processingTimeMs = Date.now() - startTime;
      aiTiming['total'] = processingTimeMs;

      // Log detailed AI timing breakdown
      console.log(`[AI-Timing] ${imageFile.fileName}: ${JSON.stringify(aiTiming, null, 0)}`);
      log.info(`[CropContext] Analysis complete in ${processingTimeMs}ms: ${allAnalysis.length} results, strategy: ${cropContextConfig.strategy}`);

      // Include segmentation preprocessing info if available
      // Extract mask data from cropsPayload (only if save_segmentation_masks is enabled)
      const extractedMasks = (cropsPayload as MaskedCropBase64Result[])
        .filter(crop => crop.maskData)
        .map(crop => crop.maskData!);

      const segmentationPreprocessing = this.lastSegmentationMetadata ? {
        used: this.lastSegmentationMetadata.used,
        modelId: this.lastSegmentationMetadata.modelId,
        detectionsCount: this.lastSegmentationMetadata.detectionsCount,
        inferenceMs: this.lastSegmentationMetadata.inferenceMs,
        cropsExtracted: extractedCrops.length,
        masksApplied: this.lastSegmentationMetadata.masksApplied,
        // Include detection bboxes for visualization (always available when detections exist)
        ...(this.lastSegmentationMetadata.detections ? { detections: this.lastSegmentationMetadata.detections } : {}),
        // Include RLE mask data only if available (non-empty array)
        ...(extractedMasks.length > 0 ? { masks: extractedMasks } : {})
      } : undefined;

      return {
        success: true,
        analysis: allAnalysis,
        usage: totalUsage,
        cropContextUsed: true,
        strategy: cropContextConfig.strategy,
        segmentationPreprocessing,
        recognitionMethod: 'gemini-v6-seg',
        imageId: v6ImageId  // Pass DB UUID for analysis_log UPDATE
      };

    } catch (error: any) {
      log.error(`[CropContext] Analysis failed:`, error);
      // Return null to signal fallback to standard flow
      return null;
    }
  }

  /**
   * V6 Baseline 2026: Send full image to V6 when no subjects detected
   * This replaces the legacy fallback to V5 when crop-context detection fails
   */
  private async sendFullImageToV6(
    imageFile: UnifiedImageFile,
    compressedBuffer: Buffer,
    effectivePath: string,
    storagePath?: string,  // Storage path from Supabase upload
    mimeType?: string      // MIME type of the image
  ): Promise<any> {
    const startTime = Date.now();

    log.info(`[CropContext] V6 fullImage: Sending full image for analysis`);

    const authState = authService.getAuthState();
    const userId = authState.isAuthenticated ? authState.user?.id : null;

    const fullImagePayload = {
      crops: [],  // Empty crops array
      fullImage: compressedBuffer.toString('base64'),  // Full image as base64
      category: this.category,
      userId,
      executionId: this.config.executionId,
      imageId: imageFile.id,
      originalFileName: imageFile.fileName,
      // Storage tracking for database writes
      storagePath,
      mimeType,
      sizeBytes: compressedBuffer.length,
      participantPreset: this.participantsData.length > 0 ? {
        name: 'Preset Dynamic',
        participants: this.participantsData
      } : undefined,
      bboxSources: ['full-image']  // Mark as full image source
    };

    try {
      const response = await Promise.race([
        this.supabase.functions.invoke('analyzeImageDesktopV6', { body: fullImagePayload }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('V6 fullImage function invocation timeout')), 60000)
        )
      ]) as any;

      if (response.error) {
        log.error(`[CropContext] V6 fullImage error:`, response.error);
        throw new Error(`V6 fullImage error: ${response.error.message || 'Unknown error'}`);
      }

      if (!response.data.success) {
        log.error(`[CropContext] V6 fullImage analysis failed:`, response.data.error);
        throw new Error(`V6 fullImage analysis failed: ${response.data.error || 'Unknown error'}`);
      }

      const inferenceTimeMs = Date.now() - startTime;
      const v6Result = response.data;

      // Transform V6 response to standard analysis format
      const analysis = v6Result.cropAnalysis.map((crop: any) => ({
        raceNumber: crop.raceNumber,
        drivers: crop.drivers || [],
        category: this.category,
        teamName: crop.teamName,
        otherText: crop.otherText || [],
        confidence: crop.confidence,
        boundingBox: undefined,  // No bounding box for full image
        modelSource: 'gemini-v6-full-image',
        bboxSource: crop.bboxSource || 'full-image'
      }));

      // Deduct token
      // NOTA: Con pre-auth system (v1.1.0+), il token tracking avviene nel processor
      if (userId && !this.config.usePreAuthSystem) {
        await authService.useTokens(1, undefined, this.config.onTokenUsed);
      }

      log.info(`[CropContext] V6 fullImage success: ${analysis.length} results in ${inferenceTimeMs}ms`);

      return {
        success: true,
        analysis,
        usage: v6Result.usage || { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
        cropContextUsed: true,
        strategy: 'full-image',
        usedFullImage: true,
        recognitionMethod: 'gemini-v6-full-image',
        imageId: v6Result.imageId  // Pass DB UUID for analysis_log UPDATE
      };

    } catch (error: any) {
      log.error(`[CropContext] V6 fullImage failed:`, error);
      // Return null to signal fallback to standard flow (legacy V5)
      return null;
    }
  }

  /**
   * Initialize participants data from preset
   */
  private async initializeParticipantsData() {
    if (this.config.participantPresetData && this.config.participantPresetData.length > 0) {
      // Use participant data passed directly from frontend
      this.participantsData = this.config.participantPresetData;
    } else if (this.config.csvData && this.config.csvData.length > 0) {
      // Fallback to legacy CSV data
      this.participantsData = this.config.csvData;
    }
  }

  /**
   * Initialize sport configurations from Supabase sport categories
   */
  private async initializeSportConfigurations() {
    try {
      // PERFORMANCE: Use pre-fetched categories if available (batch optimization)
      // This avoids redundant Supabase calls when processing multiple images
      let sportCategories: any[];

      if (this.config.sportCategories && this.config.sportCategories.length > 0) {
        console.log(`[Worker] 🚀 Using cached sport categories (${this.config.sportCategories.length} categories)`);
        sportCategories = this.config.sportCategories;
      } else {
        console.log(`[Worker] ⚠️ No cached categories, fetching from Supabase...`);
        sportCategories = await getSportCategories();
      }

      if (!sportCategories || sportCategories.length === 0) {
        return;
      }

      // Store categories for later use
      this.sportCategories = sportCategories;

      // Find current category config
      this.currentSportCategory = sportCategories.find(
        (cat: any) => cat.code.toLowerCase() === this.category.toLowerCase()
      );

      // Initialize SmartMatcher configurations from Supabase data
      if (this.smartMatcher) {
        this.smartMatcher.initializeFromSportCategories(sportCategories);
      }
    } catch (error) {
      console.error(`[UnifiedWorker] Error initializing sport configurations:`, error);
    }
  }

  /**
   * Filter recognitions based on sport's individual_competition setting and recognition_config
   */
  private filterRecognitionsByCompetitionType(
    analysis: any[],
    isIndividual: boolean
  ): any[] {
    if (!analysis || analysis.length === 0) return [];

    // Get recognition configuration from current sport category
    const recognitionConfig = this.currentSportCategory?.recognition_config || {
      maxResults: 5,
      minConfidence: 0.35,  // Lowered for RF-DETR small models (was 0.7)
      confidenceDecayFactor: 0.9,
      relativeConfidenceGap: 0.3,
      focusMode: 'auto',
      ignoreBackground: true,
      prioritizeForeground: true
    };

    // 1. Filter out low confidence results using dynamic threshold
    let validResults = analysis.filter(r =>
      (r.confidence || 0) >= recognitionConfig.minConfidence
    );

    if (validResults.length === 0) return [];

    // 2. Sort by confidence (highest first)
    validResults.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    // 3. Apply confidence decay and relative gap filtering for multiple results
    if (validResults.length > 1 && !isIndividual) {
      const bestConfidence = validResults[0].confidence || 0;

      validResults = validResults.filter((r, index) => {
        if (index === 0) return true; // Always keep the best

        // Apply confidence decay factor
        const decayedConfidence = (r.confidence || 0) * Math.pow(recognitionConfig.confidenceDecayFactor, index);

        // Check if it's within acceptable gap from best
        const confidenceGap = bestConfidence - (r.confidence || 0);
        const withinGap = confidenceGap <= recognitionConfig.relativeConfidenceGap;

        return withinGap && decayedConfidence >= recognitionConfig.minConfidence;
      });
    }

    // 4. Apply individual competition rule (overrides maxResults)
    if (isIndividual && validResults.length > 1) {
      validResults = [validResults[0]]; // Take only the best
    }

    // 5. Apply maximum results limit based on category configuration
    const maxResults = isIndividual ? 1 : recognitionConfig.maxResults;
    if (validResults.length > maxResults) {
      validResults = validResults.slice(0, maxResults);
    }

    return validResults;
  }

  /**
   * Controlla se il processing è stato cancellato
   */
  private checkCancellation(): boolean {
    if (this.config.isCancelled && this.config.isCancelled()) {
      return true;
    }
    return false;
  }

  /**
   * Processa una singola immagine attraverso l'intero workflow
   */
  async processImage(imageFile: UnifiedImageFile, processor?: UnifiedImageProcessor, temporalContext?: { imageTimestamp: ImageTimestamp; temporalNeighbors: ImageTimestamp[] } | null): Promise<UnifiedProcessingResult> {
    const startTime = Date.now();
    let uploadReadyFileId: string | null = null;
    // let compressedFileId: string | null = null; // Not used anymore - compressed files are preserved
    let thumbnailFileId: string | null = null;
    let microThumbFileId: string | null = null;

    // Timing tracker for performance analysis
    const timing: Record<string, number> = {};
    let phaseStart = Date.now();

    // BATCH UPDATE: Pending database update data (to be accumulated by processor)
    let pendingUpdateData: {imageId: string; updateData: any; timestamp: number} | undefined = undefined;

    // Reset segmentation cache for this image
    this.cachedSegmentationResults = null;

    // Check for cancellation before starting
    if (this.checkCancellation()) {
      return {
        fileId: imageFile.id,
        fileName: imageFile.fileName,
        originalPath: imageFile.originalPath,
        success: false,
        error: 'Processing cancelled by user',
        processingTimeMs: Date.now() - startTime
      };
    }

    // Initialize SmartMatcher for this image
    if (this.smartMatcher) {
      this.smartMatcher.startImageAnalysis(imageFile.id);
    }

    // Copy RAW preview strategies from processor (if available)
    if (processor) {
      const strategies = processor.getRawPreviewStrategies();
      if (strategies.size > 0) {
        this.rawPreviewStrategies = strategies;
      }
    }

    try {
      // Fase 1: Preparazione dell'immagine per upload (RAW→JPEG o compressione JPEG)
      phaseStart = Date.now();
      const uploadReadyPath = await this.prepareImageForUpload(imageFile);
      timing['1_prepareImage'] = Date.now() - phaseStart;

      // Check for cancellation after preparation
      if (this.checkCancellation()) {
        return {
          fileId: imageFile.id,
          fileName: imageFile.fileName,
          originalPath: imageFile.originalPath,
          success: false,
          error: 'Processing cancelled by user',
          processingTimeMs: Date.now() - startTime
        };
      }
      
      // Track the temporary file created during preparation
      if (uploadReadyPath !== imageFile.originalPath) {
        uploadReadyFileId = await this.cleanupManager.trackTempFile(uploadReadyPath, 'jpeg');
      }
      
      // Fase 2: Compressione per garantire <500KB
      phaseStart = Date.now();
      const { compressedPath, buffer, mimeType } = await this.compressForUpload(uploadReadyPath, imageFile.fileName);
      timing['2_compress'] = Date.now() - phaseStart;

      // Check for cancellation after compression
      if (this.checkCancellation()) {
        return {
          fileId: imageFile.id,
          fileName: imageFile.fileName,
          originalPath: imageFile.originalPath,
          success: false,
          error: 'Processing cancelled by user',
          processingTimeMs: Date.now() - startTime
        };
      }

      // DON'T track the compressed file so it persists for gallery viewing
      // The compressed file (1080-1920px) is needed for high-quality gallery display

      // Fase 2.5: Genera thumbnail multi-livello per performance ottimizzata
      // PERFORMANCE OPTIMIZATION: Pass compressed buffer to avoid re-reading from disk
      phaseStart = Date.now();
      const { thumbnailPath, microThumbPath } = await this.generateThumbnails(compressedPath, imageFile.fileName, buffer);
      timing['2.5_thumbnails'] = Date.now() - phaseStart;

      // Track thumbnail files
      if (thumbnailPath) {
        thumbnailFileId = await this.cleanupManager.trackTempFile(thumbnailPath, 'other');
      }
      if (microThumbPath) {
        microThumbFileId = await this.cleanupManager.trackTempFile(microThumbPath, 'other');
      }

      // ============================================
      // FASE 2.7: Scene Classification (Local ML)
      // ============================================
      phaseStart = Date.now();
      let sceneClassification: SceneClassificationResult | null = null;
      let shouldSkipAI = false;

      if (this.sceneClassificationEnabled && this.sceneClassifier) {
        try {
          sceneClassification = await this.sceneClassifier.classify(buffer);

          // Log scene classification result
          workerLog.info(`Scene: ${sceneClassification.category} (${(sceneClassification.confidence * 100).toFixed(0)}%) - ${imageFile.fileName}`);

          // Check if we should skip AI analysis for crowd scenes
          if (sceneClassification.category === SceneCategory.CROWD_SCENE &&
              sceneClassification.confidence >= this.sceneSkipThreshold) {
            shouldSkipAI = true;
            workerLog.info(`SKIP AI: crowd_scene with ${(sceneClassification.confidence * 100).toFixed(0)}% confidence - ${imageFile.fileName}`);
          }
        } catch (sceneError) {
          workerLog.warn(`Scene classification failed - proceeding with AI`, sceneError);
          sceneClassification = null;
        }
      }
      timing['2.7_sceneClassification'] = Date.now() - phaseStart;

      // If skipping AI, return early with scene classification info
      if (shouldSkipAI && sceneClassification) {
        const processingTimeMs = Date.now() - startTime;
        workerLog.info(`Completed (SKIPPED AI): ${imageFile.fileName} in ${processingTimeMs}ms`);

        // Generate preview for UI even when skipping AI
        const previewDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

        // Log the skipped scene analysis for results page
        if (this.analysisLogger) {
          this.analysisLogger.logImageAnalysis({
            imageId: imageFile.id,
            fileName: imageFile.fileName,
            originalFileName: path.basename(imageFile.originalPath),
            originalPath: imageFile.originalPath,
            supabaseUrl: `local://${imageFile.originalPath}`,
            previewDataUrl, // Include base64 preview for management portal
            aiResponse: {
              rawText: `SKIPPED: ${sceneClassification.category} scene (${(sceneClassification.confidence * 100).toFixed(0)}% confidence)`,
              totalVehicles: 0,
              vehicles: []
            },
            thumbnailPath,
            microThumbPath,
            compressedPath,
            sceneCategory: sceneClassification.category,
            sceneSkipped: true
          });
        }

        // Folder organization removed from pipeline - now a post-analysis action
        // Scene-skipped images will be organized to "Others" folder via log-visualizer post-analysis

        return {
          fileId: imageFile.id,
          fileName: imageFile.fileName,
          originalPath: imageFile.originalPath,
          success: true,
          analysis: [], // Empty analysis - no race numbers
          processingTimeMs,
          previewDataUrl,
          compressedPath,
          thumbnailPath,
          microThumbPath,
          sceneCategory: sceneClassification.category,
          sceneConfidence: sceneClassification.confidence,
          sceneSkipped: true
        };
      }

      // ============================================
      // Fase 2.7: Segmentation for Recognition Strategy
      // ============================================
      phaseStart = Date.now();

      // STEP 1: Run segmentation FIRST if available (to detect subjects)
      // This allows us to intelligently skip face recognition for vehicle-only images
      let segmentationForStrategy: SegmentedDetection[] | null = null;
      if (this.genericSegmenterEnabled && this.genericSegmenterLoaded) {
        try {
          workerLog.info(`Running segmentation to determine recognition strategy...`);
          segmentationForStrategy = await this.runGenericSegmentation(buffer);

          // Cache results for later reuse in crop-context V6
          this.cachedSegmentationResults = segmentationForStrategy;

          if (segmentationForStrategy.length > 0) {
            const detectedClasses = segmentationForStrategy.map(d => `${d.className}(${d.classId})`).join(', ');
            workerLog.info(`Segmentation found ${segmentationForStrategy.length} subjects: ${detectedClasses}`);
          } else {
            workerLog.info(`Segmentation found no subjects`);
          }
        } catch (segError: any) {
          workerLog.warn(`Segmentation failed, using fallback strategy: ${segError.message}`);
          segmentationForStrategy = null;
        }
      }
      timing['2.7_segmentationStrategy'] = Date.now() - phaseStart;

      // ============================================
      // Fase 2.8: Face Recognition (ONNX - YuNet + AuraFace)
      // ============================================
      phaseStart = Date.now();

      // STEP 2: Determine recognition strategy (using segmentation results if available)
      const recognitionStrategy = this.getRecognitionStrategy(
        sceneClassification?.category || null,
        segmentationForStrategy || undefined
      );
      let faceRecognitionResult: FaceRecognitionResult | null = null;

      // STEP 3: Perform face recognition if strategy dictates
      if (recognitionStrategy.useFaceRecognition) {
        workerLog.info(`Face recognition enabled for ${sceneClassification?.category || 'unknown'} scene`);
        faceRecognitionResult = await this.performFaceRecognition(
          uploadReadyPath,
          recognitionStrategy.context
        );
      } else {
        workerLog.info(`Face recognition DISABLED (segmentation detected only vehicles)`);
      }

      // Check if we should skip number recognition (portrait/podium scenes)
      if (!recognitionStrategy.useNumberRecognition && faceRecognitionResult?.success) {
        // For portrait/podium scenes, we only use face recognition IF we found matches
        const matchedDrivers = faceRecognitionResult.matches
          .filter(m => m.matched)
          .map(m => ({
            raceNumber: m.driverInfo?.raceNumber || null,
            drivers: m.driverInfo?.driverName ? [m.driverInfo.driverName] : [],
            teamName: m.driverInfo?.teamName || null,
            confidence: m.similarity,
            matchedBy: 'face_recognition'
          }));

        // FIX: Only use face-only results if we actually found matches
        // Otherwise, fall through to AI analysis for number recognition
        if (matchedDrivers.length > 0) {
          const processingTimeMs = Date.now() - startTime;
          workerLog.info(`Face-only recognition: ${matchedDrivers.length} drivers identified for ${imageFile.fileName}`);

          // Generate preview for UI even with face-only recognition
          const previewDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

          // Write metadata from face recognition matches
          for (const match of matchedDrivers) {
            const raceNumber = match.raceNumber;

            // Find participant in preset data
            const participant = this.participantsData.length > 0
              ? this.participantsData.find((p: any) =>
                  String(p.numero) === String(raceNumber) ||
                  String(p.number) === String(raceNumber)
                )
              : null;

            // Write metatag to XMP:Description if available
            if (participant?.metatag) {
              workerLog.info(`[FaceRecognition] Writing metatag "${participant.metatag}" for race number ${raceNumber}`);
              const descriptionMode = this.config.descriptionMode || 'append';
              await writeExtendedDescription(imageFile.originalPath, participant.metatag, descriptionMode);
            }

            // Build and write keywords from face recognition data
            const faceKeywords: string[] = [];

            // Add race number
            if (raceNumber) {
              faceKeywords.push(String(raceNumber));
            }

            // Add driver name (from match or participant)
            const driverName = match.drivers[0] || (participant ? getPrimaryDriverName(participant) : undefined);
            if (driverName) {
              // Split name into individual words (filter words > 1 char)
              const nameWords = driverName.split(/\s+/).filter((w: string) => w.length > 1);
              faceKeywords.push(...nameWords);
            }

            // Add team
            const team = match.teamName || participant?.squadra || participant?.team;
            if (team) {
              faceKeywords.push(team);
            }

            // Write keywords if we have any
            if (faceKeywords.length > 0) {
              workerLog.info(`[FaceRecognition] Writing keywords [${faceKeywords.join(', ')}] for ${imageFile.fileName}`);
              const keywordsMode = this.config.keywordsMode || 'append';
              await writeKeywordsToImage(imageFile.originalPath, faceKeywords, false, keywordsMode);
            }
          }

          // Build csvMatch array for folder organization from face recognition matches
          const faceRecognitionCsvMatches = matchedDrivers.map(driver => {
            // Find participant in preset data to get folder_1, folder_2, folder_3
            const participant = this.participantsData.find((p: any) =>
              String(p.numero) === String(driver.raceNumber) ||
              String(p.number) === String(driver.raceNumber)
            );

            // For face recognition without race number, use person name as folder
            const personName = driver.drivers[0];
            const folderName = driver.raceNumber
              ? String(driver.raceNumber)
              : personName?.replace(/\s+/g, '_') || 'Unknown';

            return {
              entry: participant || {
                numero: folderName,  // Use raceNumber OR person name as folder identifier
                nome: personName,
                squadra: driver.teamName
              },
              matchedNumber: driver.raceNumber || folderName,
              confidence: driver.confidence
            };
          });

          // Folder organization removed from pipeline - now a post-analysis action

          // ============================================
          // Upload to Supabase Storage and save to database (like normal flow)
          // ============================================
          let faceRecognitionStoragePath: string | null = null;
          let faceRecognitionImageId: string | null = null;

          try {
            // Get userId from authService (same as other flows)
            const { authService } = await import('./auth-service');
            const authState = authService.getAuthState();
            const faceRecUserId = authState.isAuthenticated ? authState.user?.id : null;

            // 1. Upload image to Supabase Storage
            faceRecognitionStoragePath = await this.uploadToStorage(
              imageFile.fileName,
              buffer,
              mimeType
            );
            workerLog.info(`[FaceRecognition] Uploaded to Supabase: ${faceRecognitionStoragePath}`);

            // 2. Save to 'images' table
            if (this.supabase && faceRecognitionStoragePath && faceRecUserId) {
              const { data: imageRecord, error: imageError } = await this.supabase
                .from('images')
                .insert({
                  user_id: faceRecUserId,
                  original_filename: imageFile.fileName,
                  storage_path: faceRecognitionStoragePath,
                  mime_type: mimeType,
                  size_bytes: buffer.length,
                  execution_id: this.config.executionId || null,
                  status: 'analyzed'
                })
                .select('id')
                .single();

              if (imageError) {
                workerLog.error(`[FaceRecognition] Error saving to images table: ${imageError.message}`);
              } else if (imageRecord) {
                faceRecognitionImageId = imageRecord.id;
                workerLog.info(`[FaceRecognition] Saved to images table: ${faceRecognitionImageId}`);

                // 3. Save to 'analysis_results' table
                const primaryMatch = matchedDrivers[0];
                const { error: analysisError } = await this.supabase
                  .from('analysis_results')
                  .insert({
                    image_id: faceRecognitionImageId,
                    analysis_provider: 'face_recognition',
                    recognized_number: primaryMatch.raceNumber,
                    confidence_score: primaryMatch.confidence,
                    confidence_level: primaryMatch.confidence >= 0.8 ? 'high' : primaryMatch.confidence >= 0.6 ? 'medium' : 'low',
                    raw_response: {
                      modelSource: 'face_recognition',
                      matchedDrivers: matchedDrivers,
                      sceneCategory: sceneClassification?.category,
                      inferenceTimeMs: faceRecognitionResult?.detectionTimeMs || 0
                    },
                    input_tokens: 0,
                    output_tokens: 0,
                    estimated_cost_usd: 0,
                    execution_time_ms: processingTimeMs
                  });

                if (analysisError) {
                  workerLog.error(`[FaceRecognition] Error saving to analysis_results: ${analysisError.message}`);
                }
              }
            } else if (!faceRecUserId) {
              workerLog.warn(`[FaceRecognition] Skipping DB save: user not authenticated`);
            }

            // 4. Deduct 1 token
            // NOTA: Con pre-auth system (v1.1.0+), il token tracking avviene nel processor
            if (faceRecUserId && !this.config.usePreAuthSystem) {
              await authService.useTokens(1, faceRecUserId);
              workerLog.info(`[FaceRecognition] Deducted 1 token for user ${faceRecUserId}`);
            }

            // 5. Visual Tagging for face recognition path (same as standard flow)
            let faceVisualTagsResult: { tags: any; usage: any } | null = null;
            if (this.config.visualTagging?.enabled && faceRecognitionStoragePath) {
              try {
                faceVisualTagsResult = await this.invokeVisualTagging(faceRecognitionStoragePath, {
                  imageId: faceRecognitionImageId,
                  analysis: matchedDrivers
                });
                if (faceVisualTagsResult) {
                  workerLog.info(`[FaceRecognition] Visual tags extracted: ${Object.values(faceVisualTagsResult.tags).flat().length} tags`);
                }
              } catch (err: any) {
                workerLog.warn(`[FaceRecognition] Visual tagging failed (continuing): ${err.message}`);
              }
            }

            // 6. Log to JSONL with real Supabase URL
            if (this.analysisLogger) {
              const { SUPABASE_CONFIG } = await import('./config');
              const faceSupabaseUrl = faceRecognitionStoragePath
                ? `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${faceRecognitionStoragePath}`
                : `local://${imageFile.originalPath}`;

              const faceVehiclesForLog = matchedDrivers.map((driver, idx) => ({
                vehicleIndex: idx,
                raceNumber: driver.raceNumber ?? undefined,
                drivers: driver.drivers,
                team: driver.teamName ?? undefined,
                confidence: driver.confidence,
                corrections: [] as any[],
                finalResult: {
                  raceNumber: driver.raceNumber ?? undefined,
                  team: driver.teamName ?? undefined,
                  drivers: driver.drivers,
                  matchedBy: 'face_recognition'
                }
              }));

              this.analysisLogger.logImageAnalysis({
                imageId: imageFile.id,
                fileName: imageFile.fileName,
                originalFileName: path.basename(imageFile.originalPath),
                originalPath: imageFile.originalPath,
                supabaseUrl: faceSupabaseUrl,
                aiResponse: {
                  rawText: `FACE_RECOGNITION: ${matchedDrivers.length} drivers identified`,
                  totalVehicles: matchedDrivers.length,
                  vehicles: faceVehiclesForLog
                },
                thumbnailPath,
                microThumbPath,
                compressedPath,
                visualTags: faceVisualTagsResult?.tags,
                recognitionMethod: 'face_recognition'
              });
              workerLog.info(`[FaceRecognition] Logged to JSONL with URL: ${faceSupabaseUrl}`);
            }

          } catch (uploadError: any) {
            workerLog.error(`[FaceRecognition] Error during Supabase upload/save: ${uploadError.message}`);
            // Non bloccare il processing per errori di upload
          }

          return {
            fileId: imageFile.id,
            fileName: imageFile.fileName,
            originalPath: imageFile.originalPath,
            success: true,
            analysis: matchedDrivers,
            processingTimeMs,
            previewDataUrl,
            compressedPath,
            thumbnailPath,
            microThumbPath,
            sceneCategory: sceneClassification?.category,
            sceneConfidence: sceneClassification?.confidence,
            faceRecognitionUsed: true
          };
        } else {
          // Face recognition found no matches - fallback to AI analysis
          workerLog.info(`Face recognition found 0 matches for ${imageFile.fileName}, falling back to AI analysis`);
        }
      }
      timing['2.8_faceRecognition'] = Date.now() - phaseStart;

      // ============================================
      // Fase 3 & 4: Analysis (Local ONNX, Crop-Context V6, or Standard Cloud API)
      // ============================================
      phaseStart = Date.now();
      let analysisResult: any;
      let storagePath: string | null = null;

      // DEBUG: Log decision path with detailed configuration
      const useCropContext = this.shouldUseCropContext();
      const useLocalOnnx = this.shouldUseLocalOnnx();
      const cropConfig = this.currentSportCategory?.crop_config;
      const cropEnabled = typeof cropConfig === 'string' ? JSON.parse(cropConfig)?.enabled : cropConfig?.enabled;
      log.info(`🔍 [DECISION] crop=${useCropContext}, onnx=${useLocalOnnx}, category=${this.currentSportCategory?.code}, recognition=${this.currentSportCategory?.recognition_method}, crop_config.enabled=${cropEnabled}, onnxEnabled=${this.onnxDetectorEnabled}, onnxLoaded=${this.onnxModelLoaded}`);

      if (useCropContext) {
        // CROP-CONTEXT STRATEGY (V6) - High-res crops + context negative
        // BACKWARD COMPATIBLE: Only used if crop_config.enabled = true in sport_categories
        // PRIORITY 1: Crop-context handles both ONNX and Gemini internally
        log.info(`[CropContext] Using crop-context strategy for ${imageFile.fileName}`);

        // ALWAYS upload compressed image to Supabase Storage for reference in management portal
        // This ensures supabaseUrl is available in JSONL logs for image visualization
        storagePath = await this.uploadToStorage(imageFile.fileName, buffer, mimeType);
        log.info(`[CropContext] Uploaded reference image to storage: ${storagePath}`);

        if (this.checkCancellation()) {
          return {
            fileId: imageFile.id,
            fileName: imageFile.fileName,
            originalPath: imageFile.originalPath,
            success: false,
            error: 'Processing cancelled by user',
            processingTimeMs: Date.now() - startTime
          };
        }

        // Try crop-context analysis (uses base64 crops, not the uploaded image)
        // Pass uploadReadyPath for RAW file support - this is the JPEG conversion of RAW files
        // Pass storagePath for database tracking - the image was already uploaded above
        // PERFORMANCE: Run AI analysis and visual tagging IN PARALLEL
        const visualTaggingEnabled = this.config.visualTagging?.enabled && storagePath;
        const [cropContextResult, parallelVisualTags] = await Promise.all([
          this.analyzeWithCropContext(imageFile, buffer, mimeType, uploadReadyPath, storagePath),
          visualTaggingEnabled
            ? this.invokeVisualTagging(storagePath, null).catch(err => {
                log.warn(`[VisualTagging] Failed in parallel (continuing): ${err.message}`);
                return null;
              })
            : Promise.resolve(null)
        ]);

        analysisResult = cropContextResult;

        // If crop-context returns null, it signals fallback to standard flow
        if (analysisResult === null) {
          log.warn(`[CropContext] Falling back to standard cloud analysis for ${imageFile.fileName}`);

          // storagePath already available from upload above
          analysisResult = await this.analyzeImage(imageFile.fileName, storagePath, buffer.length, mimeType);
        }

        // Store parallel visual tags result for later use (avoid duplicate call)
        if (parallelVisualTags) {
          (analysisResult as any)._parallelVisualTags = parallelVisualTags;
        }
      } else if (this.shouldUseLocalOnnx()) {
        // PRIORITY 2: LOCAL ONNX INFERENCE on full image (when crop disabled)
        // Now with full cloud tracking for feature parity
        log.info(`[Local ONNX] Using local inference on full image for ${imageFile.fileName}`);

        analysisResult = await this.analyzeImageLocal(buffer, imageFile.fileName, mimeType);

        // Update storagePath from local ONNX result (for downstream processing)
        if (analysisResult.storagePath) {
          storagePath = analysisResult.storagePath;
        }

        // Track local ONNX usage
        if (analysisResult.localOnnxUsage) {
          if (!this.recognitionMethod) {
            this.recognitionMethod = 'local-onnx';
          }
          log.info(`[Local ONNX] Completed: ${analysisResult.localOnnxUsage.detectionsCount} detections in ${analysisResult.localOnnxUsage.inferenceMs}ms`);
        }
      } else {
        // PRIORITY 3: STANDARD CLOUD API - Upload and analyze via Edge Function (V2/V3/V4/V5)
        // Fase 3: Upload su Supabase Storage
        storagePath = await this.uploadToStorage(imageFile.fileName, buffer, mimeType);

        // Check for cancellation after upload
        if (this.checkCancellation()) {
          return {
            fileId: imageFile.id,
            fileName: imageFile.fileName,
            originalPath: imageFile.originalPath,
            success: false,
            error: 'Processing cancelled by user',
            processingTimeMs: Date.now() - startTime
          };
        }

        // Fase 4: Analisi AI via Edge Function
        // PERFORMANCE: Run AI analysis and visual tagging IN PARALLEL
        const stdVisualTaggingEnabled = this.config.visualTagging?.enabled && storagePath;
        const [stdAnalysisResult, stdParallelVisualTags] = await Promise.all([
          this.analyzeImage(imageFile.fileName, storagePath, buffer.length, mimeType),
          stdVisualTaggingEnabled
            ? this.invokeVisualTagging(storagePath, null).catch(err => {
                log.warn(`[VisualTagging] Failed in parallel (continuing): ${err.message}`);
                return null;
              })
            : Promise.resolve(null)
        ]);

        analysisResult = stdAnalysisResult;

        // Store parallel visual tags result for later use
        if (stdParallelVisualTags) {
          (analysisResult as any)._parallelVisualTags = stdParallelVisualTags;
        }

        // Track RF-DETR usage metrics if present
        if (analysisResult.rfDetrUsage) {
          this.totalRfDetrDetections += analysisResult.rfDetrUsage.detectionsCount || 0;
          this.totalRfDetrCost += analysisResult.rfDetrUsage.estimatedCostUSD || 0;

          // Set recognition method based on actual usage
          if (!this.recognitionMethod) {
            this.recognitionMethod = 'rf-detr';
          }
        } else if (!this.recognitionMethod && analysisResult.success) {
          // If no RF-DETR usage but analysis succeeded, it's Gemini
          this.recognitionMethod = 'gemini';
        }
      }
      timing['3_4_aiAnalysis'] = Date.now() - phaseStart;

      // Check for cancellation after AI analysis
      if (this.checkCancellation()) {
        return {
          fileId: imageFile.id,
          fileName: imageFile.fileName,
          originalPath: imageFile.originalPath,
          success: false,
          error: 'Processing cancelled by user',
          processingTimeMs: Date.now() - startTime
        };
      }

      // Visual Tagging: Use parallel result if available, otherwise skip (already ran in parallel)
      phaseStart = Date.now();
      let visualTagsResult: { tags: any; usage: any } | null = null;

      // Check if we already have parallel visual tags result from Promise.all
      if ((analysisResult as any)?._parallelVisualTags) {
        visualTagsResult = (analysisResult as any)._parallelVisualTags;
        delete (analysisResult as any)._parallelVisualTags;  // Clean up temporary property
        timing['5_visualTagging_parallel'] = true as any;  // Mark as parallel execution
        log.info(`[VisualTagging] Using parallel result (0ms additional latency)`);

        // FIX: In parallel mode, the edge function couldn't save tags because imageId wasn't
        // available yet. Now that analysis is complete, persist the tags to the database.
        if (analysisResult?.imageId && visualTagsResult?.tags) {
          this.persistParallelVisualTags(
            analysisResult.imageId,
            this.config.executionId || '',
            visualTagsResult.tags,
            visualTagsResult.usage,
            analysisResult
          ).catch(err => log.warn(`[VisualTagging] Persist failed: ${err.message}`));
        }
      } else if (this.config.visualTagging?.enabled && storagePath && !this.shouldUseCropContext() && !this.shouldUseLocalOnnx()) {
        // Fallback: Only run sequentially if not already parallelized (shouldn't happen normally)
        try {
          visualTagsResult = await this.invokeVisualTagging(storagePath, analysisResult);
        } catch (err: any) {
          log.warn(`[VisualTagging] Failed (continuing without tags): ${err.message}`);
        }
      }
      timing['5_visualTagging'] = Date.now() - phaseStart;

      // PUNTO DI CONVERGENZA POST-AI: Qui tutti i workflow si incontrano
      phaseStart = Date.now();
      const processedAnalysis = await this.processAnalysisResults(
        imageFile,
        analysisResult,
        uploadReadyPath,
        processor,
        temporalContext,
        visualTagsResult,
        faceRecognitionResult
      );
      timing['6_smartMatcher'] = Date.now() - phaseStart;

      // Log detailed analysis with corrections if logger is available (now supports multi-vehicle)
      phaseStart = Date.now();
      let imageAnalysisEvent: any = null;
      if (this.analysisLogger && this.smartMatcher) {
        const corrections = this.smartMatcher.getCorrections();
        // For local ONNX, use local path; for cloud API, use Supabase URL
        const supabaseUrl = storagePath
          ? `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storagePath}`
          : `local://${imageFile.originalPath}`;

        // Use FILTERED analysis data instead of original AI response
        const filteredAnalysis = processedAnalysis.analysis || [];
        const csvMatches = Array.isArray(processedAnalysis.csvMatch) ? processedAnalysis.csvMatch : (processedAnalysis.csvMatch ? [processedAnalysis.csvMatch] : []);

        // Build vehicle data from filtered analysis (only vehicles that passed preset filtering)
        const vehicles = filteredAnalysis.map((vehicle: any, index: number) => {
          const csvMatch = csvMatches[index];

          // TEMPORAL FIX: Extract temporal fields directly from csvMatch.matchResult.bestMatch
          let temporalBonus = 0;
          let temporalClusterSize = 0;
          let isBurstModeCandidate = false;

          if (csvMatch?.matchResult?.bestMatch) {
            temporalBonus = csvMatch.matchResult.bestMatch.temporalBonus || 0;
            temporalClusterSize = csvMatch.matchResult.bestMatch.temporalClusterSize || 0;
            isBurstModeCandidate = csvMatch.matchResult.bestMatch.isBurstModeCandidate || false;
          }

          // Preserve original box_2d from Gemini if present (standard 2025: keep raw data)
          // box_2d format: [y1, x1, y2, x2] normalized 0-1000
          const box_2d = vehicle.box_2d;

          // Convert boundingBox to standard percentage format (0-100) for compatibility
          let boundingBox: { x: number; y: number; width: number; height: number } | undefined;
          if (vehicle.boundingBox) {
            const bbox = vehicle.boundingBox;
            if (vehicle.modelSource === 'local-onnx') {
              // ONNX: 0-1 normalized -> convert to 0-100 percentage
              boundingBox = {
                x: bbox.x * 100,
                y: bbox.y * 100,
                width: bbox.width * 100,
                height: bbox.height * 100
              };
            } else {
              // RF-DETR or other: pass through (viewer handles conversion)
              boundingBox = {
                x: bbox.x,
                y: bbox.y,
                width: bbox.width,
                height: bbox.height
              };
            }
          }

          return {
            vehicleIndex: index,
            raceNumber: vehicle.raceNumber,
            drivers: vehicle.drivers || [],
            team: vehicle.teamName || vehicle.team,
            sponsors: vehicle.otherText || [],
            confidence: vehicle.confidence || 0,
            plateNumber: vehicle.plateNumber,
            plateConfidence: vehicle.plateConfidence,
            // V6 Vehicle DNA fields
            make: vehicle.make || null,           // Manufacturer (Ferrari, Porsche, etc.)
            model: vehicle.model || null,         // Model (296 GT3, 911 RSR, etc.)
            category: vehicle.category || null,   // Race category (GT3, LMP2, Hypercar, etc.)
            livery: vehicle.livery || null,       // { primary: string, secondary: string[] }
            context: vehicle.context || null,     // Scene context (race, pit, podium, portrait)
            // Include both formats for maximum compatibility
            box_2d,  // Original Gemini format [y1, x1, y2, x2] (0-1000)
            boundingBox,  // Converted format {x, y, width, height}
            modelSource: vehicle.modelSource, // Recognition method used (gemini/rf-detr)
            corrections: corrections.filter((c: any) => c.vehicleIndex === index),
            participantMatch: csvMatch,
            // Temporal information from SmartMatcher (FIXED)
            temporalBonus: temporalBonus,
            temporalClusterSize: temporalClusterSize,
            isBurstMode: isBurstModeCandidate,
            finalResult: {
              raceNumber: csvMatch?.entry?.numero || vehicle.raceNumber,
              team: csvMatch?.entry?.squadra || vehicle.teamName,
              drivers: this.extractDriversFromMatch(csvMatch) || vehicle.drivers,
              matchedBy: csvMatch?.matchType || 'none'
            }
          };
        });

        // Get temporal context for logging
        const temporalContextData = temporalContext;
        let temporalContextLog = undefined;

        if (temporalContextData && vehicles.length > 0) {
          // Find the best match among all vehicles to get temporal info
          const bestVehicleMatch = vehicles.find(v => v.temporalBonus && v.temporalBonus > 0);

          if (bestVehicleMatch) {
            const neighbors = temporalContextData.temporalNeighbors.map(neighbor => ({
              fileName: neighbor.fileName,
              timeDiff: Math.abs((neighbor.timestamp?.getTime() || 0) - (temporalContextData.imageTimestamp.timestamp?.getTime() || 0))
            }));

            temporalContextLog = {
              burstMode: bestVehicleMatch.isBurstMode || false,
              bonusApplied: bestVehicleMatch.temporalBonus || 0,
              clusterSize: bestVehicleMatch.temporalClusterSize || neighbors.length,
              neighbors: neighbors.slice(0, 5) // Limit to first 5 neighbors for log size
            };
          }
        }

        // Build the complete analysis event (same structure for JSONL and database)
        imageAnalysisEvent = {
          imageId: imageFile.id,
          fileName: imageFile.fileName,
          originalFileName: path.basename(imageFile.originalPath),
          originalPath: imageFile.originalPath,
          supabaseUrl,
          aiResponse: {
            // Keep raw AI response for debugging - UI will use vehicles array which contains filtered data
            rawText: `FILTERED (${filteredAnalysis.length} from ${(analysisResult.analysis || []).length}): ${JSON.stringify(filteredAnalysis)}`,
            totalVehicles: filteredAnalysis.length, // This is what the UI will use
            vehicles // This contains only filtered vehicles
          },
          temporalContext: temporalContextLog,
          // Save local thumbnail paths for image display
          thumbnailPath,
          microThumbPath,
          compressedPath,
          // Recognition method tracking
          recognitionMethod: analysisResult.recognitionMethod || undefined,
          // Original image dimensions for bbox mapping (especially useful for local-onnx)
          imageSize: analysisResult.imageSize || undefined,
          // Segmentation preprocessing info (YOLOv8-seg used before recognition)
          segmentationPreprocessing: analysisResult.segmentationPreprocessing || undefined,
          // Visual tags extracted by AI (if enabled)
          visualTags: visualTagsResult?.tags || undefined,
          // Backward compatibility - use first vehicle as primary
          primaryVehicle: vehicles.length > 0 ? vehicles[0] : undefined
        };

        // PREPARE database update for batch flushing (performance optimization)
        // Worker returns update data to processor, which accumulates and flushes in batches
        // This prevents Supabase timeout by sending updates in controlled batches
        // Full event is already logged to JSONL file for debugging
        const dbImageId = analysisResult.imageId;
        console.log(`[DBUpdate] Check: dbImageId=${dbImageId}, vehicles.length=${vehicles.length}`);

        if (dbImageId && vehicles.length > 0) {
          // PERFORMANCE: Prepare update data to be accumulated by processor
          // Processor will flush updates every BATCH_UPDATE_THRESHOLD images or at end of batch
          pendingUpdateData = {
            imageId: dbImageId,
            updateData: {
              raw_response: {
                vehicles,
                totalVehicles: filteredAnalysis.length,
                recognitionMethod: analysisResult.recognitionMethod || undefined,
                modelSource: analysisResult.recognitionMethod || 'gemini',
                segmentationPreprocessing: analysisResult.segmentationPreprocessing || undefined,
                imageSize: analysisResult.imageSize || undefined,
                visualTags: visualTagsResult?.tags || undefined,
                temporalContext: temporalContextLog,
                enrichedByDesktop: true,
                enrichedAt: new Date().toISOString()
              }
              // ❌ Removed analysis_log - reduces payload size by ~70%
              // Full data already in JSONL for debugging
            },
            timestamp: Date.now()
          };

          console.log(`[DBUpdate] Prepared update for ${dbImageId} (will be queued by processor)`);
        }
      }
      timing['7_jsonlAndDbUpdate'] = Date.now() - phaseStart;

      // Fase 5: Scrittura dei metadata (XMP per RAW, IPTC per JPEG) con dual-mode system
      phaseStart = Date.now();
      const hasKeywords = processedAnalysis.keywords && processedAnalysis.keywords.length > 0;
      await this.writeMetadata(imageFile, processedAnalysis.keywords, uploadReadyPath, processedAnalysis.analysis, processedAnalysis.csvMatch);
      timing['8_writeMetadata'] = Date.now() - phaseStart;

      // Folder organization removed from pipeline - now a post-analysis action
      const organizedPath: string | undefined = undefined;

      // Enrich JSONL event with metadata writing status
      if (imageAnalysisEvent) {
        imageAnalysisEvent.metadataWritten = !!hasKeywords;
        if (!hasKeywords) {
          imageAnalysisEvent.metadataSkipReason = this.participantsData.length > 0 ? 'no_preset_match' : 'no_keywords';
        }
      }

      // Log to JSONL file
      if (imageAnalysisEvent && this.analysisLogger) {
        this.analysisLogger.logImageAnalysis(imageAnalysisEvent);
      }

      // Calculate total processing time
      timing['total'] = Date.now() - startTime;

      // Log timing breakdown for performance analysis
      console.log(`[Timing] ${imageFile.fileName}: ${JSON.stringify(timing, null, 0)}`);

      // Generazione anteprima per UI
      const previewDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      
      const result: UnifiedProcessingResult = {
        fileId: imageFile.id,
        fileName: imageFile.fileName,
        originalPath: imageFile.originalPath,
        success: true,
        analysis: processedAnalysis.analysis,
        csvMatch: processedAnalysis.csvMatch,
        processingTimeMs: Date.now() - startTime,
        previewDataUrl,
        compressedPath,
        thumbnailPath,
        microThumbPath,
        // Path after folder organization (move/copy)
        organizedPath,
        // RF-DETR Metrics from worker
        rfDetrDetections: this.totalRfDetrDetections,
        rfDetrCost: this.totalRfDetrCost,
        recognitionMethod: this.recognitionMethod || undefined,
        // Local ONNX inference metrics
        localOnnxInferenceMs: analysisResult.localOnnxInferenceMs,
        // Scene Classification info
        sceneCategory: sceneClassification?.category,
        sceneConfidence: sceneClassification?.confidence,
        // Metadata writing status
        metadataWritten: !!hasKeywords,
        metadataSkipReason: !hasKeywords
          ? (this.participantsData.length > 0 ? 'no_preset_match' : 'no_keywords')
          : undefined,
        // Pending database update (returned to processor for batch flushing)
        pendingUpdate: pendingUpdateData,
        // Pending analysis_results insert (ONNX batch optimization)
        pendingAnalysisInsert: this.pendingAnalysisInsertData ? {
          data: this.pendingAnalysisInsertData,
          timestamp: Date.now()
        } : undefined
      };

      // Clear the pending insert data after returning it
      this.pendingAnalysisInsertData = null;

      return result;

    } catch (error: any) {
      console.error(`[UnifiedWorker] Failed to process ${imageFile.fileName}:`, error);
      
      return {
        fileId: imageFile.id,
        fileName: imageFile.fileName,
        originalPath: imageFile.originalPath,
        success: false,
        error: error.message || 'Unknown error',
        processingTimeMs: Date.now() - startTime
      };
    } finally {
      // CRITICAL FIX: Always cleanup temporary files, even on errors
      try {
        // PRESERVE THUMBNAILS: Don't cleanup thumbnails immediately to allow viewing in results page
        // Only cleanup upload-ready files (compressed files are preserved for gallery viewing)
        if (uploadReadyFileId) {
          await this.cleanupManager.cleanupFile(uploadReadyFileId);
        }
      } catch (cleanupError) {
        console.error(`[UnifiedWorker] Cleanup error for ${imageFile.fileName}:`, cleanupError);
        // Don't throw cleanup errors, just log them
      }
    }
  }

  /**
   * Fase 1: Prepara l'immagine per l'upload - estrazione preview per RAW, copia per JPEG
   * Uses calibrated strategy per RAW extension when available (from batch calibration).
   */
  private async prepareImageForUpload(imageFile: UnifiedImageFile): Promise<string> {
    if (imageFile.isRaw) {
      // Use centralized temp directory instead of original image directory
      const tempJpegPath = this.cleanupManager.generateTempPath(
        imageFile.originalPath,
        'preview',
        '.jpg',
        'jpeg-processing'
      );

      try {
        // Determine extraction strategy from calibration data
        const ext = path.extname(imageFile.fileName).toLowerCase();
        const strategy = this.rawPreviewStrategies.get(ext);

        let previewData: Buffer | null = null;
        let previewWidth = 0;
        let previewHeight = 0;
        let extractionMethod = 'unknown';
        let previewOrientation: number | undefined;

        if (strategy && strategy.method === 'full') {
          // CALIBRATED: Use extractFullPreview for maximum quality
          try {
            const fullResult = await rawPreviewExtractor.extractFullPreview(imageFile.originalPath, { timeout: 15000 });
            if (fullResult.success && fullResult.data) {
              // Verify dimensions — native extractFullPreview() may return a smaller preview
              // than what extractAllPreviews() found during calibration (common with ARW on Windows)
              let extractedWidth = fullResult.width || 0;
              let extractedHeight = fullResult.height || 0;
              if (extractedWidth === 0 || extractedHeight === 0) {
                try {
                  const verifyProcessor = await createImageProcessor(fullResult.data);
                  const verifyMeta = await verifyProcessor.metadata();
                  extractedWidth = verifyMeta.width || 0;
                  extractedHeight = verifyMeta.height || 0;
                } catch { /* non-critical */ }
              }

              // Validate the extracted buffer is actually JPEG (magic bytes 0xFF 0xD8)
              const isValidJpeg = fullResult.data.length >= 2 &&
                fullResult.data[0] === 0xFF && fullResult.data[1] === 0xD8;

              // Check if extracted preview is large enough compared to calibration
              const expectedWidth = strategy.bestWidth || 0;
              const isPreviewTooSmall = expectedWidth > 0 && extractedWidth > 0 && extractedWidth < expectedWidth * 0.5;

              // Flag suspiciously large buffers (>15MB) — native lib may return uncompressed pixel data
              // or JPEG lossless that Sharp can't handle well. A proper JPEG preview is typically 1-8MB.
              const dataSizeKB = Math.round(fullResult.data.length / 1024);
              const isSuspiciouslyLarge = fullResult.data.length > 15 * 1024 * 1024;

              let shouldReject = false;
              if (!isValidJpeg) {
                console.warn(`[RAW-Extract] ${imageFile.fileName}: Native extractFullPreview returned non-JPEG data (${dataSizeKB}KB). Trying ExifTool...`);
                shouldReject = true;
              } else if (isPreviewTooSmall) {
                console.warn(`[RAW-Extract] ${imageFile.fileName}: Native extractFullPreview returned ${extractedWidth}x${extractedHeight} but calibration expected ~${strategy.bestWidth}x${strategy.bestHeight}. Trying ExifTool...`);
                shouldReject = true;
              } else if (isSuspiciouslyLarge) {
                console.warn(`[RAW-Extract] ${imageFile.fileName}: Native extractFullPreview returned unusually large JPEG (${dataSizeKB}KB for ${extractedWidth}x${extractedHeight}). Trying ExifTool for a standard JPEG preview...`);
                shouldReject = true;
              }

              if (!shouldReject) {
                previewData = fullResult.data;
                previewWidth = extractedWidth;
                previewHeight = extractedHeight;
                extractionMethod = 'calibrated-full';
                previewOrientation = fullResult.metadata?.orientation;
              }
            }
          } catch (fullErr: any) {
            console.warn(`[RAW-Extract] extractFullPreview failed for ${imageFile.fileName}, falling back: ${fullErr.message}`);
          }
        } else if (strategy && strategy.method === 'preview') {
          // CALIBRATED: Use extractPreview with optimal targetMaxSize
          try {
            const previewResult = await rawPreviewExtractor.extractPreview(imageFile.originalPath, {
              targetMinSize: 200 * 1024,
              targetMaxSize: strategy.targetMaxSize,
              timeout: 10000,
              preferQuality: 'preview',
              includeMetadata: true,
              useNativeLibrary: true
            });
            if (previewResult.success && previewResult.data) {
              previewData = previewResult.data;
              previewWidth = previewResult.width || 0;
              previewHeight = previewResult.height || 0;
              extractionMethod = 'calibrated-preview';
              previewOrientation = previewResult.metadata?.orientation;
            }
          } catch (prevErr: any) {
            console.warn(`[RAW-Extract] calibrated preview failed for ${imageFile.fileName}, falling back: ${prevErr.message}`);
          }
        }

        // Fallback 1: ExifTool -JpgFromRaw (or -PreviewImage if JpgFromRaw fails)
        if (!previewData) {
          try {
            const exifResult = await rawPreviewExtractor.extractFullPreviewWithExifTool(imageFile.originalPath, { timeout: 15000 });
            if (exifResult.success && exifResult.data && exifResult.data.length > 100 * 1024) {
              // Verify dimensions — ExifTool JpgFromRaw may return a small preview (e.g., Sony A1 returns 1616x1080)
              let exifWidth = exifResult.width || 0;
              let exifHeight = exifResult.height || 0;
              if (exifWidth === 0 || exifHeight === 0) {
                try {
                  const exifProc = await createImageProcessor(exifResult.data);
                  const exifMeta = await exifProc.metadata();
                  exifWidth = exifMeta.width || 0;
                  exifHeight = exifMeta.height || 0;
                } catch { /* non-critical */ }
              }
              // Accept if ≥1920px wide (high-res), or if no strategy info to compare against
              const minAcceptableWidth = strategy ? Math.min(strategy.bestWidth * 0.5, 1920) : 1920;
              if (exifWidth >= minAcceptableWidth) {
                previewData = exifResult.data;
                previewWidth = exifWidth;
                previewHeight = exifHeight;
                extractionMethod = 'fallback-exiftool-jpgfromraw';
                previewOrientation = exifResult.metadata?.orientation;
              } else {
                console.warn(`[RAW-Extract] ${imageFile.fileName}: ExifTool JpgFromRaw returned ${exifWidth}x${exifHeight} (too small, need ≥${minAcceptableWidth}px). Trying extractAllPreviews...`);
              }
            }
          } catch {
            // Continue to next fallback
          }
        }

        // Fallback 2: extractAllPreviews — enumerate all embedded JPEGs and pick the best valid one.
        // This is the most robust method for cameras like Sony A1 where:
        // - JpgFromRaw tag points to a small preview (1616x1080)
        // - extractFullPreview returns corrupted/non-JPEG tile data
        // - But extractAllPreviews correctly finds the real HQ preview (e.g., 5616x3744)
        if (!previewData) {
          try {
            const allResult = await rawPreviewExtractor.extractAllPreviews(imageFile.originalPath);
            if (allResult.success && allResult.previews.length > 0) {
              // Find the best valid JPEG preview: largest dimensions, reasonable size (< 15MB)
              let bestPreview: typeof allResult.previews[0] | null = null;
              let bestPixels = 0;

              for (const p of allResult.previews) {
                // Skip non-JPEG and suspiciously large buffers (tile concatenations)
                if (!p.data || p.data.length < 100 * 1024 || p.data.length > 15 * 1024 * 1024) continue;
                if (p.data[0] !== 0xFF || p.data[1] !== 0xD8) continue;

                // Get actual dimensions
                let pw = p.width || 0;
                let ph = p.height || 0;
                if (pw === 0 || ph === 0) {
                  try {
                    const pProc = await createImageProcessor(p.data);
                    const pMeta = await pProc.metadata();
                    pw = pMeta.width || 0;
                    ph = pMeta.height || 0;
                  } catch { continue; }
                }

                const pixels = pw * ph;
                if (pixels > bestPixels && pw >= 1920) {
                  bestPixels = pixels;
                  bestPreview = p;
                  // Store detected dimensions on the preview object
                  p.width = pw;
                  p.height = ph;
                }
              }

              if (bestPreview) {
                previewData = bestPreview.data;
                previewWidth = bestPreview.width;
                previewHeight = bestPreview.height;
                extractionMethod = 'fallback-all-previews';
                previewOrientation = undefined; // Will be read from RAW file later
                console.log(`[RAW-Extract] ${imageFile.fileName}: extractAllPreviews found best preview: ${previewWidth}x${previewHeight} (${Math.round(previewData.length / 1024)}KB)`);
              }
            }
          } catch {
            // Continue to next fallback
          }
        }

        // Fallback 3: native extractFullPreview (may work for some camera models)
        if (!previewData) {
          try {
            const fullResult = await rawPreviewExtractor.extractFullPreview(imageFile.originalPath, { timeout: 15000 });
            if (fullResult.success && fullResult.data) {
              previewData = fullResult.data;
              previewWidth = fullResult.width || 0;
              previewHeight = fullResult.height || 0;
              extractionMethod = 'fallback-full';
              previewOrientation = fullResult.metadata?.orientation;
            }
          } catch {
            // Continue to next fallback
          }
        }

        if (!previewData) {
          // Last resort: standard extraction (original behavior)
          const previewResult = await rawPreviewExtractor.extractPreview(imageFile.originalPath, {
            targetMinSize: 200 * 1024,
            targetMaxSize: 3 * 1024 * 1024,
            timeout: 10000,
            preferQuality: 'full',
            includeMetadata: true,
            useNativeLibrary: true
          });
          if (previewResult.success && previewResult.data) {
            previewData = previewResult.data;
            previewWidth = previewResult.width || 0;
            previewHeight = previewResult.height || 0;
            extractionMethod = 'fallback-standard';
            previewOrientation = previewResult.metadata?.orientation;
          }
        }

        if (!previewData) {
          throw new Error('All preview extraction methods failed');
        }

        // Detect actual dimensions if not reported by extractor
        if (previewWidth === 0 || previewHeight === 0) {
          try {
            const diagProcessor = await createImageProcessor(previewData);
            const diagMeta = await diagProcessor.metadata();
            previewWidth = diagMeta.width || 0;
            previewHeight = diagMeta.height || 0;
          } catch {
            // Non-critical
          }
        }

        workerLog.info(`[RAW-Extract] ${imageFile.fileName}: ${extractionMethod} ${previewWidth}x${previewHeight} (${Math.round(previewData.length / 1024)}KB)`);

        // Salva la preview estratta come file temporaneo JPEG
        await fsPromises.writeFile(tempJpegPath, previewData);

        // MEMORY FIX: Rilascia esplicitamente il Buffer della preview per evitare accumulo memoria
        const previewBufferSize = previewData.length;
        previewData = null as any; // Nullifica reference per permettere GC

        // Forza garbage collection per Buffer grandi (>1MB)
        if (previewBufferSize > 1024 * 1024 && global.gc) {
          global.gc();
        }

        // Apply rotation based on the RAW file's EXIF Orientation.
        // The embedded JPEG preview (especially in NEF) often has Orientation=1 even for
        // portrait shots — the real orientation is in the RAW file's main IFD.
        // So we read it from the original RAW file via ExifTool and apply explicit rotation.
        try {
          // First try Sharp auto-rotate (works if JPEG has correct EXIF orientation)
          const processor = await createImageProcessor(tempJpegPath);
          const jpegMeta = await processor.metadata();
          const jpegOrientation = jpegMeta.orientation || 1;

          if (jpegOrientation !== 1) {
            // JPEG has orientation info — use Sharp auto-rotate
            let rotatedBuffer = await (await createImageProcessor(tempJpegPath))
              .rotate()
              .jpeg({ quality: 90 })
              .toBuffer();
            await fsPromises.writeFile(tempJpegPath, rotatedBuffer);
            const rotatedBufferSize = rotatedBuffer.length;
            rotatedBuffer = null as any;
            if (rotatedBufferSize > 1024 * 1024 && global.gc) { global.gc(); }
            workerLog.info(`[RAW-Rotate] ${imageFile.fileName}: Applied JPEG EXIF orientation ${jpegOrientation}`);
          } else {
            // JPEG has orientation=1 — read from the original RAW file (authoritative source)
            const rawOrientation = await rawPreviewExtractor.readOrientation(imageFile.originalPath);
            if (rawOrientation !== 1) {
              // Map EXIF orientation to Sharp rotation angle
              // 1=0°, 2=flip, 3=180°, 4=flip+180°, 5=flip+270°, 6=90°CW, 7=flip+90°, 8=270°CW
              let angle = 0;
              let flip = false;
              let flop = false;
              switch (rawOrientation) {
                case 2: flop = true; break;                       // Horizontal flip
                case 3: angle = 180; break;                       // Rotate 180°
                case 4: flip = true; break;                       // Vertical flip
                case 5: flop = true; angle = 270; break;          // Flip + rotate 270°
                case 6: angle = 90; break;                        // Rotate 90° CW (portrait)
                case 7: flop = true; angle = 90; break;           // Flip + rotate 90°
                case 8: angle = 270; break;                       // Rotate 270° CW (portrait)
              }

              let sharpPipeline = (await createImageProcessor(tempJpegPath));
              if (flip) sharpPipeline = sharpPipeline.flip();
              if (flop) sharpPipeline = sharpPipeline.flop();
              if (angle !== 0) sharpPipeline = sharpPipeline.rotate(angle);

              let rotatedBuffer = await sharpPipeline
                .jpeg({ quality: 90 })
                .toBuffer();
              await fsPromises.writeFile(tempJpegPath, rotatedBuffer);
              const rotatedBufferSize = rotatedBuffer.length;
              rotatedBuffer = null as any;
              if (rotatedBufferSize > 1024 * 1024 && global.gc) { global.gc(); }
              workerLog.info(`[RAW-Rotate] ${imageFile.fileName}: Applied RAW EXIF orientation ${rawOrientation} (angle=${angle}°, flip=${flip}, flop=${flop})`);
            }
          }
        } catch (rotationError: any) {
          // Non bloccare il processo se la rotazione fallisce
          console.warn(`[RAW-Rotate] ${imageFile.fileName}: Rotation failed: ${rotationError.message}`);
        }

        return tempJpegPath;

      } catch (error) {
        console.error(`[UnifiedWorker] RAW preview extraction failed for ${imageFile.fileName}:`, error);
        throw error;
      }
    } else {
      // PERFORMANCE OPTIMIZATION: Use JPEG directly without creating unnecessary temporary copy
      return imageFile.originalPath;
    }
  }

  /**
   * Fase 2: Comprime l'immagine per garantire <500KB per upload
   * PERFORMANCE OPTIMIZATION: Uses predictive formula for single-pass compression
   */
  private async compressForUpload(imagePath: string, fileName: string): Promise<{
    compressedPath: string;
    buffer: Buffer;
    mimeType: string;
  }> {
    if (!sharp) {
      throw new Error('Sharp module not available for compression');
    }

    const maxSizeBytes = this.config.maxImageSizeKB * 1024;

    // Read file ONCE and keep in memory for all operations
    const imageBuffer = await fsPromises.readFile(imagePath);

    // Get image metadata to calculate optimal quality
    let metadata;
    try {
      const processor = await createImageProcessor(imageBuffer);
      metadata = await processor.metadata();
    } catch (error) {
      console.error(`[UnifiedWorker] Failed to read image metadata for ${fileName}:`, error);
      throw new Error(`Failed to read image metadata: ${error}`);
    }

    const originalWidth = metadata.width || 1920;
    const originalHeight = metadata.height || 1080;

    // Calculate resize dimensions
    const maxDim = this.config.maxDimension;
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;

    if (originalWidth > maxDim || originalHeight > maxDim) {
      const aspectRatio = originalWidth / originalHeight;
      if (aspectRatio > 1) {
        targetWidth = maxDim;
        targetHeight = Math.round(maxDim / aspectRatio);
      } else {
        targetHeight = maxDim;
        targetWidth = Math.round(maxDim * aspectRatio);
      }
    }

    // PREDICTIVE FORMULA: Calculate optimal quality based on target size
    const megapixels = (targetWidth * targetHeight) / 1_000_000;
    const estimatedQuality = Math.round((maxSizeBytes / (megapixels * 10000)) * 100);
    const initialQuality = Math.max(30, Math.min(95, estimatedQuality));

    if (DEBUG_MODE) {
      console.log(`[Compress] ${fileName}: ${originalWidth}x${originalHeight} -> ${targetWidth}x${targetHeight}, quality=${initialQuality}%, input=${Math.round(imageBuffer.length / 1024)}KB`);
    }

    let compressedBuffer: Buffer;
    let compressionAttempts = 0;

    // First attempt with predicted quality
    try {
      const processor = await createImageProcessor(imageBuffer);
      compressedBuffer = await processor
        .rotate() // Auto-rotate basato su EXIF per correggere orientamento
        .resize(this.config.maxDimension, this.config.maxDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: initialQuality,
          mozjpeg: true // Enable mozjpeg for better compression
        })
        .toBuffer();

      compressionAttempts++;

      // If predictive compression overshot, fallback to binary search
      if (compressedBuffer.length > maxSizeBytes) {
        compressedBuffer = await this.compressWithBinarySearch(
          imageBuffer,
          maxSizeBytes,
          initialQuality,
          compressionAttempts
        );
      }

    } catch (error) {
      console.error(`[UnifiedWorker] Sharp compression failed for ${fileName}:`, error);
      throw new Error(`Image compression failed: ${error}`);
    }

    // Use centralized temp directory for compressed file
    const compressedPath = this.cleanupManager.generateTempPath(
      imagePath,
      'compressed',
      '.jpg',
      'compressed'
    );

    try {
      await fsPromises.writeFile(compressedPath, compressedBuffer);
    } catch (error) {
      console.error(`[UnifiedWorker] Failed to write compressed file for ${fileName}:`, error);
      throw new Error(`Failed to save compressed image: ${error}`);
    }

    return {
      compressedPath,
      buffer: compressedBuffer,
      mimeType: 'image/jpeg'
    };
  }

  /**
   * Binary search compression fallback for when predictive formula overshoots
   * PERFORMANCE OPTIMIZATION: Uses in-memory buffer (no disk reads)
   */
  private async compressWithBinarySearch(
    imageBuffer: Buffer,
    maxSizeBytes: number,
    initialQuality: number,
    initialAttempts: number
  ): Promise<Buffer> {
    let minQuality = 30;
    let maxQuality = initialQuality;
    let bestBuffer: Buffer | null = null;
    let attempts = initialAttempts;
    const maxAttempts = 4; // Max 4 binary search iterations

    while (maxQuality - minQuality > 5 && attempts < maxAttempts) {
      const quality = Math.round((minQuality + maxQuality) / 2);
      attempts++;

      const processor = await createImageProcessor(imageBuffer);
      const buffer = await processor
        .rotate()
        .resize(this.config.maxDimension, this.config.maxDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: quality,
          mozjpeg: true
        })
        .toBuffer();

      if (buffer.length <= maxSizeBytes) {
        bestBuffer = buffer;
        minQuality = quality; // File small enough, try higher quality
      } else {
        maxQuality = quality; // File too large, reduce quality
      }
    }

    if (!bestBuffer) {
      // Last resort: use minimum quality
      const processor = await createImageProcessor(imageBuffer);
      bestBuffer = await processor
        .rotate()
        .resize(this.config.maxDimension, this.config.maxDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: minQuality,
          mozjpeg: true
        })
        .toBuffer();
    }

    return bestBuffer;
  }

  /**
   * Genera thumbnail multi-livello per performance ottimizzata
   * PERFORMANCE OPTIMIZATION: Uses in-memory buffer and parallel generation
   */
  private async generateThumbnails(
    compressedPath: string,
    fileName: string,
    compressedBuffer?: Buffer
  ): Promise<{
    thumbnailPath: string | null;
    microThumbPath: string | null;
  }> {
    let thumbnailPath: string | null = null;
    let microThumbPath: string | null = null;

    try {
      // Use provided buffer or read from disk as fallback
      const imageBuffer = compressedBuffer || await fsPromises.readFile(compressedPath);

      // PERFORMANCE OPTIMIZATION: Generate both thumbnails in parallel using Promise.all
      const [thumbnailResult, microResult] = await Promise.all([
        // Thumbnail 280x280px per card view
        (async () => {
          try {
            const processor = await createImageProcessor(imageBuffer);
            const thumbnailBuffer = await processor
              .resize(280, 280, {
                fit: 'inside',
                withoutEnlargement: true
              })
              .jpeg({ quality: 85 })
              .toBuffer();

            const thumbPath = this.cleanupManager.generateTempPath(
              compressedPath,
              'thumb_280',
              '.jpg',
              'thumbnails'
            );

            await fsPromises.writeFile(thumbPath, thumbnailBuffer);
            return thumbPath;
          } catch (thumbError) {
            console.error(`[UnifiedWorker] Failed to create thumbnail for ${fileName}:`, thumbError);
            return null;
          }
        })(),

        // Micro-thumbnail 32x32px per lista veloce
        (async () => {
          try {
            const processor = await createImageProcessor(imageBuffer);
            const microBuffer = await processor
              .resize(32, 32, {
                fit: 'cover',
                position: 'center',
                withoutEnlargement: true
              })
              .jpeg({ quality: 70 })
              .toBuffer();

            const microPath = this.cleanupManager.generateTempPath(
              compressedPath,
              'micro_32',
              '.jpg',
              'micro-thumbs'
            );

            await fsPromises.writeFile(microPath, microBuffer);
            return microPath;
          } catch (microError) {
            console.error(`[UnifiedWorker] Failed to create micro-thumbnail for ${fileName}:`, microError);
            return null;
          }
        })()
      ]);

      thumbnailPath = thumbnailResult;
      microThumbPath = microResult;

    } catch (error) {
      console.error(`[UnifiedWorker] Failed to generate thumbnails for ${fileName}:`, error);
    }

    return {
      thumbnailPath,
      microThumbPath
    };
  }

  /**
   * Fase 3: Upload su Supabase Storage (riuso da parallel-analyzer)
   */
  private async uploadToStorage(fileName: string, buffer: Buffer, mimeType: string): Promise<string> {
    // Determina l'estensione corretta basata sul MIME type reale
    let fileExt: string;

    switch(mimeType) {
      case 'image/jpeg':
        fileExt = 'jpg';  // Sempre .jpg per JPEG
        break;
      case 'image/png':
        fileExt = 'png';
        break;
      case 'image/webp':
        fileExt = 'webp';
        break;
      default:
        // Solo come fallback estremo usa l'estensione originale
        fileExt = fileName.split('.').pop()?.toLowerCase() || 'jpg';
    }

    const storageFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;

    // Track upload time and size for network monitoring
    const uploadStartTime = Date.now();

    const { error: uploadError } = await this.supabase.storage
      .from('uploaded-images')
      .upload(storageFileName, buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeType
      });

    const uploadEndTime = Date.now();
    const uploadDurationMs = uploadEndTime - uploadStartTime;

    // Record upload metrics for network monitoring (if available)
    if (this.networkMonitor) {
      this.networkMonitor.recordUploadAttempt(!uploadError, uploadDurationMs, buffer.length);
    }

    if (uploadError) {
      throw new Error(`Upload failed for ${fileName}: ${uploadError.message}`);
    }
    
    // Costruisci l'URL pubblico Supabase per questa immagine
    const publicUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storageFileName}`;
    
    // Emetti evento per la cache nel processo principale (per RAW files)
    this.emit('image-uploaded', {
      originalFileName: fileName,
      publicUrl: publicUrl
    });

    return storageFileName;
  }

  /**
   * Fase 4: Analisi AI (riuso da parallel-analyzer)
   */
  private async analyzeImage(fileName: string, storagePath: string, sizeBytes: number, mimeType: string): Promise<any> {
    // Ottieni l'ID utente corrente se autenticato
    const authState = authService.getAuthState();
    const userId = authState.isAuthenticated ? authState.user?.id : null;
    const userEmail = authState.isAuthenticated ? authState.user?.email : null;

    // Prepara il corpo della richiesta
    const invokeBody: any = {
      imagePath: storagePath,
      originalFilename: fileName,
      mimeType: mimeType,
      sizeBytes: sizeBytes,
      modelName: APP_CONFIG.defaultModel,
      category: this.category
    };

    if (userId) {
      invokeBody.userId = userId;
    }

    if (userEmail) {
      invokeBody.userEmail = userEmail;
    }

    // Add executionId if available (for linking images to desktop executions)
    if (this.config.executionId) {
      invokeBody.executionId = this.config.executionId;
    }

    // Add participant preset data if available
    if (this.participantsData.length > 0) {
      invokeBody.participantPreset = {
        name: `Preset Dynamic`,
        participants: this.participantsData
      };
    }

    // Determine which Edge Function to use based on sport category edge_function_version or fallback to settings
    let functionName: string;
    let functionSource: string;

    if (this.currentSportCategory?.edge_function_version) {
      const version = this.currentSportCategory.edge_function_version;
      if (version === 6) {
        functionName = 'analyzeImageDesktopV6';
      } else if (version === 5) {
        functionName = 'analyzeImageDesktopV5';
      } else if (version === 4) {
        functionName = 'analyzeImageDesktopV4';
      } else if (version === 3) {
        functionName = 'analyzeImageDesktopV3';
      } else if (version === 2) {
        functionName = 'analyzeImageDesktopV2';
      } else {
        functionName = 'analyzeImageDesktopV3'; // Default to V3 for unknown versions
      }
      functionSource = `sport_category.edge_function_version=${version}`;
    } else {
      // Default to V3 for standard single-image analysis
      // V6 is only for Crop-Context flow (performCropContextAnalysis)
      functionName = 'analyzeImageDesktopV3';
      functionSource = 'default (V3 for single-image, V6 only via Crop-Context)';
    }

    // Log edge function selection (first image only to avoid spam)
    if (!this.edgeFunctionLogged) {
      log.info(`[EdgeFunction] Using ${functionName} (${functionSource}) for category: ${this.config.category}`);
      this.edgeFunctionLogged = true;
    }

    let response: any;
    try {
      response = await Promise.race([
        this.supabase.functions.invoke(functionName, { body: invokeBody }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Function invocation timeout')), 60000)
        )
      ]) as any;

      if (response.error) {
        console.error(`[UnifiedProcessor] Edge Function error for ${fileName}:`, response.error.message || response.error.statusText);
        throw new Error(`Function error: ${response.error.message || response.error.statusText || 'Unknown error'}`);
      }
    } catch (edgeFunctionError: any) {
      console.error(`[UnifiedProcessor] Edge Function call failed for ${fileName}:`, edgeFunctionError.message);
      // Report Edge Function failure to telemetry (non-blocking)
      errorTelemetryService.reportCriticalError({
        errorType: 'edge_function',
        severity: 'recoverable',
        error: edgeFunctionError,
        executionId: this.config.executionId,
        batchPhase: 'ai_analysis',
        categoryName: this.config.category
      });
      throw new Error(`Edge Function failed: ${edgeFunctionError.message || 'Network or server error'}`);
    }

    if (!response.data.success) {
      console.error(`[UnifiedProcessor] Analysis failed for ${fileName}:`, response.data.error);
      throw new Error(`Analysis failed: ${response.data.error || 'Unknown function error'}`);
    }

    // Registra l'utilizzo del token
    // NOTA: Con pre-auth system (v1.1.0+), il tracking avviene nel processor
    // La chiamata useTokens rimane per retrocompatibilità con vecchie versioni senza pre-auth
    if (userId && !this.config.usePreAuthSystem) {
      await authService.useTokens(1, response.data.imageId, this.config.onTokenUsed);
    }

    return response.data;
  }

  /**
   * Visual Tagging: Invokes the visualTagging edge function to extract visual descriptive tags
   * Runs in parallel with recognition for zero additional latency
   */
  private async invokeVisualTagging(
    storagePath: string,
    analysisResult: any | null  // Now accepts null for parallel execution
  ): Promise<{ tags: any; usage: any } | null> {
    // Only run if visual tagging is enabled
    if (!this.config.visualTagging?.enabled) {
      return null;
    }

    try {
      const userId = await authService.getCurrentUserId();
      const imageUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storagePath}`;

      log.debug(`[VisualTagging] Invoking for image: ${storagePath}${analysisResult ? '' : ' (parallel mode, no recognition data)'}`);

      // Build recognitionResult with ALL detected vehicles (not just first)
      let recognitionResult: { raceNumber?: string; driverName?: string; teamName?: string } | undefined;
      if (analysisResult) {
        const vehicles = analysisResult.analysis || [];
        const allDrivers: string[] = [];
        const allTeams: string[] = [];
        const allNumbers: string[] = [];
        for (const v of vehicles) {
          if (v.raceNumber && !allNumbers.includes(v.raceNumber)) allNumbers.push(v.raceNumber);
          if (v.teamName && !allTeams.includes(v.teamName)) allTeams.push(v.teamName);
          for (const d of (v.drivers || [])) {
            if (d && !allDrivers.includes(d)) allDrivers.push(d);
          }
        }
        recognitionResult = {
          raceNumber: allNumbers.join('; ') || undefined,
          driverName: allDrivers.join('; ') || undefined,
          teamName: allTeams.join('; ') || undefined
        };
      }

      const response = await Promise.race([
        this.supabase.functions.invoke('visualTagging', {
          body: {
            imageUrl,
            imageId: analysisResult?.imageId || '',
            executionId: this.config.executionId || '',
            userId: userId || '',
            recognitionResult  // undefined when running in parallel (edge function handles this)
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Visual tagging timeout')), 65000)  // 65s to allow 60s edge function timeout + buffer
        )
      ]) as any;

      if (response.error) {
        log.warn(`[VisualTagging] Edge function error: ${response.error.message}`);
        return null;
      }

      if (!response.data?.success) {
        log.warn(`[VisualTagging] Tagging failed: ${response.data?.error}`);
        return null;
      }

      // Deduct 0.5 token for visual tagging
      // NOTA: Con pre-auth system (v1.1.0+), il costo visual tagging è già incluso (1.5x)
      if (userId && !this.config.usePreAuthSystem) {
        await authService.useTokens(0.5, analysisResult?.imageId, this.config.onTokenUsed);
      }

      // Cache tags for metadata embedding
      if (analysisResult?.imageId) {
        this.visualTagsCache.set(analysisResult.imageId, response.data.data.tags);
      }

      log.debug(`[VisualTagging] Success: ${Object.values(response.data.data.tags).flat().length} tags extracted`);

      return {
        tags: response.data.data.tags,
        usage: response.data.data.usage
      };
    } catch (error: any) {
      log.warn(`[VisualTagging] Failed (non-blocking): ${error.message}`);
      return null;
    }
  }

  /**
   * Persist visual tags to database after parallel extraction.
   * In parallel mode, imageId is not available when the edge function runs,
   * so tags are extracted but not saved. This method saves them once imageId is known.
   */
  private async persistParallelVisualTags(
    imageId: string,
    executionId: string,
    tags: any,
    usage: any,
    analysisResult: any
  ): Promise<void> {
    if (!imageId) return;

    try {
      const userId = await authService.getCurrentUserId();

      // Collect ALL drivers, teams, and numbers from all detected vehicles
      const vehicles = analysisResult?.analysis || [];
      const allDrivers: string[] = [];
      const allTeams: string[] = [];
      const allNumbers: string[] = [];
      for (const v of vehicles) {
        if (v.raceNumber && !allNumbers.includes(v.raceNumber)) allNumbers.push(v.raceNumber);
        if (v.teamName && !allTeams.includes(v.teamName)) allTeams.push(v.teamName);
        for (const d of (v.drivers || [])) {
          if (d && !allDrivers.includes(d)) allDrivers.push(d);
        }
      }
      const participantName = allDrivers.length > 0 ? allDrivers.join('; ') : null;
      const participantTeam = allTeams.length > 0 ? allTeams.join('; ') : null;
      const participantNumber = allNumbers.length > 0 ? allNumbers.join('; ') : null;

      const { error } = await this.supabase
        .from('visual_tags')
        .upsert({
          image_id: imageId,
          execution_id: executionId || null,
          user_id: userId,
          location_tags: tags.location || [],
          weather_tags: tags.weather || [],
          scene_type_tags: tags.sceneType || [],
          subject_tags: tags.subjects || [],
          visual_style_tags: tags.visualStyle || [],
          emotion_tags: tags.emotion || [],
          participant_name: participantName,
          participant_team: participantTeam,
          participant_number: participantNumber,
          model_used: 'gemini-2.5-flash-lite',
          input_tokens: usage?.inputTokens || 0,
          output_tokens: usage?.outputTokens || 0,
          estimated_cost_usd: usage?.estimatedCostUSD || 0
        }, {
          onConflict: 'image_id'
        });

      if (error) {
        log.warn(`[VisualTagging] Failed to persist parallel tags: ${error.message}`);
      } else {
        log.debug(`[VisualTagging] Persisted parallel tags for image: ${imageId}`);
      }
    } catch (err: any) {
      log.warn(`[VisualTagging] Error persisting parallel tags: ${err.message}`);
    }
  }

  /**
   * PUNTO DI CONVERGENZA POST-AI: Processa i risultati dell'analisi AI
   * Qui si incontrano tutti i workflow (RAW e non-RAW) per future modifiche
   */
  private async processAnalysisResults(
    imageFile: UnifiedImageFile,
    analysisResult: any,
    processedImagePath: string,
    processor?: UnifiedImageProcessor,
    temporalContext?: { imageTimestamp: ImageTimestamp; temporalNeighbors: ImageTimestamp[] } | null,
    visualTags?: { tags: any; usage: any } | null,
    faceRecognitionResult?: FaceRecognitionResult | null
  ): Promise<{
    analysis: any[];
    csvMatch: any | null;
    description: string | null;
    keywords: string[] | null;
    visualTags?: any;
  }> {
    let csvMatch: any = null;
    let description: string | null = null;

    // Merge face recognition matches into csvMatches
    // This ensures face-matched participants are included in metadata even when number recognition also runs
    const faceMatchedCsvEntries: any[] = [];
    if (faceRecognitionResult?.success && faceRecognitionResult.matches) {
      const matchedFaces = faceRecognitionResult.matches.filter(m => m.matched && m.driverInfo);
      for (const faceMatch of matchedFaces) {
        const raceNumber = faceMatch.driverInfo?.raceNumber;
        // Find matching participant in preset data
        const participant = this.participantsData.find((p: any) =>
          (raceNumber && (String(p.numero) === String(raceNumber) || String(p.number) === String(raceNumber))) ||
          (faceMatch.driverInfo?.driverName && (
            (p.nome && p.nome.includes(faceMatch.driverInfo.driverName)) ||
            (p.drivers && p.drivers.some((d: any) => d.nome?.includes(faceMatch.driverInfo!.driverName)))
          ))
        );

        if (participant) {
          faceMatchedCsvEntries.push({
            entry: participant,
            matchedNumber: raceNumber || participant.numero,
            confidence: faceMatch.similarity,
            matchedBy: 'face_recognition'
          });
          log.info(`[FaceRecognition→Metadata] Face match merged: ${faceMatch.driverInfo?.driverName} → participant #${participant.numero}`);
        }
      }
    }

    if (analysisResult.analysis && analysisResult.analysis.length > 0) {
      // Apply competition type filter based on sport category configuration
      // Use smart default based on category instead of hardcoded true
      const smartDefault = ['running', 'cycling', 'triathlon'].includes(this.category.toLowerCase()) ? true : false;
      const isIndividual = this.currentSportCategory?.individual_competition ?? smartDefault;
      const originalCount = analysisResult.analysis.length;

      analysisResult.analysis = this.filterRecognitionsByCompetitionType(
        analysisResult.analysis,
        isIndividual
      );

      // Enhanced intelligent matching using SmartMatcher with temporal context for ALL vehicles
      let csvMatches = await this.findIntelligentMatches(analysisResult.analysis, imageFile, processor, temporalContext);

      // Merge face recognition matches (avoid duplicates by race number)
      if (faceMatchedCsvEntries.length > 0) {
        const existingNumbers = new Set(
          (Array.isArray(csvMatches) ? csvMatches : csvMatches ? [csvMatches] : [])
            .filter((m: any) => m?.entry?.numero)
            .map((m: any) => String(m.entry.numero))
        );

        for (const faceEntry of faceMatchedCsvEntries) {
          if (!existingNumbers.has(String(faceEntry.entry.numero))) {
            if (Array.isArray(csvMatches)) {
              csvMatches.push(faceEntry);
            } else if (csvMatches) {
              csvMatches = [csvMatches, faceEntry];
            } else {
              csvMatches = [faceEntry];
            }
            log.info(`[FaceRecognition→Metadata] Added face-only match for #${faceEntry.entry.numero} (not found by number recognition)`);
          } else {
            log.info(`[FaceRecognition→Metadata] Skipping #${faceEntry.entry.numero} - already matched by number recognition`);
          }
        }
      }

      // Costruisci i keywords usando la logica esistente (utilizzeremo tutti i matches)
      const keywords = this.buildMetatag(analysisResult.analysis, csvMatches);
      description = keywords && keywords.length > 0 ? keywords.join(', ') : null; // Backward compatibility

      // Store all matches for further processing
      csvMatch = csvMatches;
    } else if (faceMatchedCsvEntries.length > 0) {
      // No AI analysis results, but face recognition found matches — use them directly
      log.info(`[FaceRecognition→Metadata] No AI analysis results, using ${faceMatchedCsvEntries.length} face-only match(es)`);
      csvMatch = faceMatchedCsvEntries;
      const keywords = this.buildMetatag([], faceMatchedCsvEntries);
      description = keywords && keywords.length > 0 ? keywords.join(', ') : null;
    }

    // Apply SmartMatcher corrections to analysis data for UI display (now handles all vehicles)
    const correctedAnalysis = this.applyCorrectionsToAnalysis(analysisResult.analysis || [], csvMatch);

    // Filter csvMatch to align with corrected analysis (removing matches for filtered vehicles)
    let filteredCsvMatch = csvMatch;
    if (Array.isArray(csvMatch) && correctedAnalysis.length < (analysisResult.analysis || []).length) {
      // When using preset, some vehicles were filtered out - align csvMatch with corrected analysis
      const isUsingParticipantPreset = this.participantsData.length > 0;
      if (isUsingParticipantPreset) {
        // Filter csvMatch to only include entries for vehicles that weren't filtered out
        const originalAnalysis = analysisResult.analysis || [];
        filteredCsvMatch = [];
        let correctedIndex = 0;

        for (let originalIndex = 0; originalIndex < originalAnalysis.length; originalIndex++) {
          const originalVehicle = originalAnalysis[originalIndex];
          const match = csvMatch[originalIndex];

          // Check if this vehicle has a match in participant preset
          if (match && match.entry) {
            // Vehicle has match - include in filtered csvMatch
            filteredCsvMatch.push(match);
            correctedIndex++;
          }
          // If no match and using preset, vehicle was filtered out - don't include in csvMatch
        }

        // Preserve face recognition matches appended beyond the analysis array
        for (let i = originalAnalysis.length; i < csvMatch.length; i++) {
          if (csvMatch[i]?.matchedBy === 'face_recognition' && csvMatch[i]?.entry) {
            filteredCsvMatch.push(csvMatch[i]);
          }
        }
      }
    }

    // Build base keywords from recognition
    let keywords = this.buildMetatag(correctedAnalysis, filteredCsvMatch) || [];

    // Integrate visual tags into keywords if embedding is enabled
    if (visualTags?.tags && this.config.visualTagging?.embedInMetadata) {
      const flatVisualTags = [
        ...(visualTags.tags.location || []),
        ...(visualTags.tags.weather || []),
        ...(visualTags.tags.sceneType || []),
        ...(visualTags.tags.subjects || []),
        ...(visualTags.tags.visualStyle || []),
        ...(visualTags.tags.emotion || [])
      ];
      // Add visual tags to keywords (avoid duplicates)
      const existingLower = new Set(keywords.map((k: string) => k.toLowerCase()));
      for (const tag of flatVisualTags) {
        if (!existingLower.has(tag.toLowerCase())) {
          keywords.push(tag);
        }
      }
      log.debug(`[VisualTagging] Added ${flatVisualTags.length} visual tags to keywords`);
    }

    return {
      analysis: correctedAnalysis,
      csvMatch: filteredCsvMatch,
      description,
      keywords: keywords.length > 0 ? keywords : null,
      visualTags: visualTags?.tags
    };
  }

  /**
   * Fase 5: Scrittura metadata usando dual-mode system (Keywords + ExtendedDescription)
   */
  private async writeMetadata(imageFile: UnifiedImageFile, keywords: string[] | null, processedImagePath: string, analysis?: any[], csvMatch?: any): Promise<void> {
    if (!keywords || keywords.length === 0) {
      console.warn(`[MetadataWriter] No keywords for ${imageFile.fileName} - metadata not written`);
      return;
    }

    // Generate formatted data for ExtendedDescription
    const extendedDescriptionData = this.buildExtendedDescription(analysis || [], csvMatch);

    // Build Person Shown strings from matched participants
    const personShownStrings = this.buildPersonShownStrings(csvMatch);

    if (imageFile.isRaw) {
      // Per i file RAW, crea un file XMP sidecar con keywords e descrizione
      await createXmpSidecar(imageFile.originalPath, keywords, extendedDescriptionData || undefined);
      // TODO: Add PersonInImage support to XMP sidecar in future iteration
    } else {
      // Per i file non-RAW, scrivi sia Keywords semplificati che ExtendedDescription
      const keywordsMode = this.config.keywordsMode || 'append';
      await writeKeywordsToImage(imageFile.originalPath, keywords, false, keywordsMode);

      // Write formatted data to ExtendedDescription (only if participant preset provided data)
      if (extendedDescriptionData) {
        const descriptionMode = this.config.descriptionMode || 'append';
        await writeExtendedDescription(imageFile.originalPath, extendedDescriptionData, descriptionMode);
      }

      // Write Person Shown (IPTC PersonInImage) if template is configured and we have matches
      if (personShownStrings.length > 0) {
        await writePersonInImage(imageFile.originalPath, personShownStrings);
      }
    }
  }

  /**
   * Build Person Shown strings from CSV matches using the configured template.
   * Returns an array of formatted person names for IPTC PersonInImage field.
   */
  private buildPersonShownStrings(csvMatch?: any): string[] {
    // Check if personShownTemplate is configured
    const template = this.config.personShownTemplate;
    if (!template) {
      return [];
    }

    if (!csvMatch) {
      return [];
    }

    const personStrings: string[] = [];
    const matches = Array.isArray(csvMatch) ? csvMatch : [csvMatch];

    for (const match of matches) {
      if (!match || !match.entry) continue;

      const participant = match.entry;

      // Get all driver names from preset_participant_drivers
      const driverNames = getParticipantDriverNames(participant);
      const primaryName = driverNames[0] || '';

      // Build participant data for primary driver
      const participantData = {
        name: primaryName,
        surname: '', // Will be extracted from name in buildPersonShownString
        number: participant.numero || participant.number || '',
        team: participant.squadra || participant.team || '',
        car_model: participant.car_model || participant.modello || '',
        nationality: participant.nationality || participant.nazionalita || '',
      };

      // Only generate Person Shown if we have at least a name
      if (participantData.name) {
        const personShown = buildPersonShownString(template, participantData);
        if (personShown) {
          personStrings.push(personShown);
        }
      }

      // Handle additional drivers (co-driver, navigator, etc.)
      for (let dIdx = 1; dIdx < driverNames.length; dIdx++) {
        const additionalDriverData = {
          name: driverNames[dIdx],
          surname: '',
          number: participantData.number,
          team: participantData.team,
          car_model: participantData.car_model,
          nationality: '',
        };
        const driverShown = buildPersonShownString(template, additionalDriverData);
        if (driverShown) {
          personStrings.push(driverShown);
        }
      }
    }

    // Remove duplicates
    const uniquePersons = [...new Set(personStrings)];
    return uniquePersons;
  }

  /**
   * Apply SmartMatcher corrections to analysis results for UI display
   * This ensures the UI table shows corrected data instead of raw Gemini results
   * Now processes ALL vehicles in the analysis, not just the first one
   */
  private applyCorrectionsToAnalysis(originalAnalysis: any[], csvMatches: any[]): any[] {
    if (!originalAnalysis || originalAnalysis.length === 0) {
      return originalAnalysis;
    }

    if (!csvMatches || csvMatches.length === 0) {
      return originalAnalysis;
    }

    // Create corrected copy of analysis array
    const correctedAnalysis = originalAnalysis.map((vehicle, index) => {
      const csvMatch = csvMatches[index]; // Get match for this specific vehicle

      if (!csvMatch || !csvMatch.entry) {
        const isUsingParticipantPreset = this.participantsData.length > 0;

        if (isUsingParticipantPreset) {
          // When using a preset and no match found, filter out this vehicle
          return null; // Return null to filter out this vehicle when using preset
        } else {
          // When not using preset, keep original behavior (show all AI recognitions)
          return vehicle; // Return unchanged if no match and no preset
        }
      }

      const correctedVehicle = { ...vehicle };
      const participant = csvMatch.entry;

      // Store original values for debugging
      correctedVehicle._original = {
        raceNumber: vehicle.raceNumber,
        drivers: vehicle.drivers,
        teamName: vehicle.teamName
      };

      // Track corrections for this vehicle
      const corrections = {
        vehicleIndex: index,
        raceNumber: false,
        drivers: false,
        team: false
      };

      // Apply race number correction
      if (participant.numero || participant.number) {
        const correctedNumber = String(participant.numero || participant.number);
        if (correctedVehicle.raceNumber !== correctedNumber) {
          correctedVehicle.raceNumber = correctedNumber;
          corrections.raceNumber = true;
        }
      }

      // Apply driver corrections from preset_participant_drivers
      const correctedDrivers: string[] = getParticipantDriverNames(participant);

      if (correctedDrivers.length > 0) {
        const originalDrivers = vehicle.drivers || [];
        const driversChanged = JSON.stringify(originalDrivers.sort()) !== JSON.stringify(correctedDrivers.sort());
        if (driversChanged) {
          correctedVehicle.drivers = correctedDrivers;
          corrections.drivers = true;
        }
      }

      // Apply team correction
      if (participant.squadra) {
        const originalTeam = vehicle.teamName || '';
        if (originalTeam !== participant.squadra) {
          correctedVehicle.teamName = participant.squadra;
          corrections.team = true;
        }
      }

      // Add corrections metadata for logging
      correctedVehicle._corrections = corrections;

      return correctedVehicle;
    });

    // Filter out null entries (unmatched vehicles when using preset)
    const filteredAnalysis = correctedAnalysis.filter(vehicle => vehicle !== null);

    return filteredAnalysis;
  }

  /**
   * Enhanced intelligent matching using SmartMatcher system
   * Now processes ALL vehicles in the analysis array, not just the first one
   *
   * TODO_ML_INTEGRATION: This method orchestrates the intelligent matching
   * and is the integration point for future ML enhancements.
   */
  private async findIntelligentMatches(analysis: any[], imageFile?: UnifiedImageFile, processor?: UnifiedImageProcessor, temporalContext?: { imageTimestamp: ImageTimestamp; temporalNeighbors: ImageTimestamp[] } | null): Promise<any[]> {
    if (!analysis || analysis.length === 0) {
      return [];
    }

    // Use preset data if available, otherwise fall back to CSV
    const participantData = this.participantsData.length > 0 ? this.participantsData : this.csvData;
    if (!participantData || participantData.length === 0) {
      return [];
    }

    const matches: any[] = [];

    try {
      // Process each vehicle in the analysis
      for (let vehicleIndex = 0; vehicleIndex < analysis.length; vehicleIndex++) {
        const vehicle = analysis[vehicleIndex];

        // Convert analysis to SmartMatcher format
        const smartMatcherAnalysis: SmartMatcherAnalysisResult = {
          raceNumber: vehicle.raceNumber,
          drivers: vehicle.drivers || [],
          category: vehicle.category,
          teamName: vehicle.teamName || vehicle.team,
          otherText: vehicle.otherText || [],
          confidence: vehicle.confidence,
          plateNumber: vehicle.plateNumber,
          plateConfidence: vehicle.plateConfidence
        };

        // Generate cache keys for caching
        const analysisHash = this.generateAnalysisHash(smartMatcherAnalysis);
        const participantHash = this.generateParticipantHash(participantData);
        const cacheKey = `${analysisHash}_${participantHash}_v${vehicleIndex}`;

        // Try to get cached result first
        const cachedResult = await this.cacheManager.getMatch(cacheKey, participantHash, this.category);
        if (cachedResult && cachedResult.bestMatch) {
          matches.push(this.convertMatchResultToLegacyFormat(cachedResult));
          continue;
        }

        // Set temporal context if available (same for all vehicles in the image)
        if (temporalContext) {
          smartMatcherAnalysis.imageTimestamp = temporalContext.imageTimestamp;
          smartMatcherAnalysis.temporalNeighbors = temporalContext.temporalNeighbors;
        }

        // Perform intelligent matching for this vehicle
        const isUsingParticipantPreset = this.participantsData.length > 0;
        const matchResult = await this.smartMatcher.findMatches(smartMatcherAnalysis, participantData, isUsingParticipantPreset, vehicleIndex);

        // Cache the result for future use
        await this.cacheManager.setMatch(cacheKey, participantHash, this.category, matchResult);

        // Log detailed match information
        this.logMatchResults(matchResult, vehicleIndex);

        // Convert to legacy format for compatibility
        if (matchResult.bestMatch) {
          const legacyMatch = this.convertMatchResultToLegacyFormat(matchResult);

          // Store result in temporal cache for neighbor analysis
          if (imageFile && smartMatcherAnalysis.imageTimestamp?.timestamp) {
            const participantNumber = String(matchResult.bestMatch.participant.numero || matchResult.bestMatch.participant.number || '');
            this.smartMatcher.storeTemporalAnalysisResult(
              imageFile.originalPath,
              participantNumber,
              matchResult.bestMatch.confidence,
              smartMatcherAnalysis.imageTimestamp.timestamp
            );
          }

          matches.push(legacyMatch);
        } else {
          // Try fallback simple matching for this vehicle
          const fallbackMatch = this.fallbackSimpleMatch(vehicle, participantData);
          if (fallbackMatch) {
            // Store fallback result in temporal cache with lower confidence
            if (imageFile && smartMatcherAnalysis.imageTimestamp?.timestamp) {
              const participantNumber = String(fallbackMatch.entry.numero || fallbackMatch.entry.number || '');
              this.smartMatcher.storeTemporalAnalysisResult(
                imageFile.originalPath,
                participantNumber,
                0.6, // Lower confidence for fallback matches
                smartMatcherAnalysis.imageTimestamp.timestamp
              );
            }

            matches.push(fallbackMatch);
          } else {
            matches.push(null); // Maintain array alignment
          }
        }
      }

      return matches;

    } catch (error) {
      console.error(`[UnifiedWorker] Error during intelligent matching:`, error);

      // Fallback to simple legacy matching for all vehicles on error
      const fallbackMatches = analysis.map(vehicle =>
        this.fallbackSimpleMatch(vehicle, participantData)
      );

      return fallbackMatches;
    }
  }

  /**
   * Helper method to generate a hash for analysis data (for caching)
   */
  private generateAnalysisHash(analysis: SmartMatcherAnalysisResult): string {
    const key = `${analysis.raceNumber || 'none'}_${(analysis.drivers || []).join('_')}_${analysis.category || 'none'}_${analysis.teamName || 'none'}_${(analysis.otherText || []).slice(0, 3).join('_')}_${analysis.plateNumber || 'none'}`;
    return Buffer.from(key).toString('base64').substring(0, 32);
  }

  /**
   * Helper method to generate a hash for participant data (for caching)
   */
  private generateParticipantHash(participants: any[]): string {
    const key = participants.map(p => `${p.numero || p.number || 'none'}_${getPrimaryDriverName(p) || 'none'}`).join('|');
    return Buffer.from(key).toString('base64').substring(0, 32);
  }

  /**
   * Convert SmartMatcher MatchResult to legacy format for compatibility
   */
  private convertMatchResultToLegacyFormat(matchResult: MatchResult): any {
    if (!matchResult.bestMatch) {
      return null;
    }

    const bestMatch = matchResult.bestMatch;
    const evidence = bestMatch.evidence;

    // Determine match type based on evidence
    let matchType = 'intelligent';
    let matchedValue = 'multiple_evidence';

    // Find the highest scoring evidence type
    if (evidence.length > 0) {
      const topEvidence = evidence.reduce((max, current) =>
        (current.score || 0) > (max.score || 0) ? current : max
      );

      switch (topEvidence.type) {
        case 'race_number':
          matchType = 'raceNumber';
          matchedValue = topEvidence.value;
          break;
        case 'person_name':
          matchType = 'personName';
          matchedValue = topEvidence.value;
          break;
        case 'sponsor':
          matchType = 'sponsor';
          matchedValue = topEvidence.value;
          break;
        case 'team':
          matchType = 'team';
          matchedValue = topEvidence.value;
          break;
      }
    }

    // Get additional matching details from SmartMatcher
    const thresholds = this.smartMatcher.getActiveThresholds();
    const weights = this.smartMatcher.getActiveWeights();
    const sportCategory = this.smartMatcher.getCurrentSport();
    const scoreBreakdown = this.smartMatcher.getScoreBreakdown(bestMatch);

    // Get top 3 alternative candidates for comparison
    const topAlternatives = matchResult.allCandidates
      .slice(0, 3)
      .map(candidate => ({
        participantNumber: candidate.participant.numero || candidate.participant.number,
        participantName: getPrimaryDriverName(candidate.participant),
        score: candidate.score,
        confidence: candidate.confidence,
        evidenceCount: candidate.evidence.length,
        temporalBonus: candidate.temporalBonus || 0,
        isBurstMode: candidate.isBurstModeCandidate || false
      }));

    return {
      matchType,
      matchedValue,
      entry: bestMatch.participant,
      // Enhanced SmartMatcher data for detailed analysis
      smartMatch: {
        score: bestMatch.score,
        confidence: bestMatch.confidence,
        evidenceCount: evidence.length,
        multipleHighScores: matchResult.multipleHighScores,
        resolvedByOverride: matchResult.resolvedByOverride,
        reasoning: bestMatch.reasoning,
        // NEW: Additional details for improved UI
        thresholds: {
          minimumScore: thresholds.minimumScore,
          clearWinner: thresholds.clearWinner,
          nameSimilarity: thresholds.nameSimilarity,
          strongNonNumberEvidence: thresholds.strongNonNumberEvidence
        },
        weights: {
          raceNumber: weights.raceNumber,
          driverName: weights.driverName,
          sponsor: weights.sponsor,
          team: weights.team
        },
        sportCategory: sportCategory,
        scoreBreakdown: scoreBreakdown,
        alternativeCandidates: topAlternatives,
        // Status indicators
        isClearWinner: !matchResult.multipleHighScores,
        passedMinimumThreshold: bestMatch.score >= thresholds.minimumScore,
        winMargin: topAlternatives.length > 1 ? (topAlternatives[0].score - topAlternatives[1].score) : null
      },
      // TEMPORAL FIX: Add temporal context from bestMatch for JSONL logging
      matchResult: {
        bestMatch: {
          temporalBonus: bestMatch.temporalBonus || 0,
          temporalClusterSize: bestMatch.temporalClusterSize || 0,
          isBurstModeCandidate: bestMatch.isBurstModeCandidate || false
        }
      }
    };
  }

  /**
   * Log detailed match results for debugging and analysis
   * Now includes vehicle index for multi-vehicle scenarios
   */
  private logMatchResults(matchResult: MatchResult, vehicleIndex?: number): void {
    // Logging disabled for production - uncomment for debugging
  }

  /**
   * Fallback simple matching for error cases
   */
  private fallbackSimpleMatch(analysis: any, participants: any[]): any | null {
    if (!analysis.raceNumber) return null;

    const match = participants.find(p =>
      (p.numero && String(p.numero) === String(analysis.raceNumber)) ||
      (p.number && String(p.number) === String(analysis.raceNumber))
    );

    if (match) {
      return {
        matchType: 'raceNumber',
        matchedValue: analysis.raceNumber,
        entry: match
      };
    }

    return null;
  }

  /**
   * Costruisce i keywords da usare per i metadati usando tutti i risultati di analisi
   * Ora supporta array di matches per gestire tutti i veicoli riconosciuti
   */
  private buildMetatag(analysis: any[], csvMatches?: any | any[]): string[] | null {
    // Handle both single match (legacy) and array of matches (new multi-vehicle support)
    const matches = Array.isArray(csvMatches) ? csvMatches : (csvMatches ? [csvMatches] : []);
    const validMatches = matches.filter(match => match && match.entry);

    // Check if we're using a participant preset but found no matches
    const isUsingParticipantPreset = this.participantsData.length > 0;
    const hasNoValidMatches = validMatches.length === 0;

    if (isUsingParticipantPreset && hasNoValidMatches) {
      console.warn(`[buildMetatag] Participant preset active but no matches found - metadata not written`);
      return null;
    }

    // Enhanced metadata building for preset participants (multi-vehicle support)
    if (validMatches.length > 0) {
      const allKeywords: string[] = [];

      validMatches.forEach((csvMatch, vehicleIndex) => {
        const participant = csvMatch.entry;
        const vehicleKeywords: string[] = [];

        // Add race number if available (no prefix)
        if (participant.numero) {
          vehicleKeywords.push(participant.numero);
        }

        // Add driver information from preset_participant_drivers
        const driverNames = getParticipantDriverNames(participant);
        for (const dName of driverNames) {
          // Split names and add each as individual keyword
          const nameWords = dName.split(/[,&\/\-\s]+/).map((name: string) => name.trim()).filter((name: string) => name);
          vehicleKeywords.push(...nameWords);
        }

        // Add team information (no prefix)
        if (participant.squadra) {
          vehicleKeywords.push(participant.squadra);
        }

        // Add individual words from custom metatag (but not for description)
        if (participant.metatag) {
          // Split metatag into individual keywords, exclude common connecting words
          const metatagWords = participant.metatag
            .split(/[,\s\-\/&]+/)
            .map((word: string) => word.trim())
            .filter((word: string) => word && word.length > 2) // Filter out very short words
            .filter((word: string) => !['the', 'and', 'or', 'for', 'with', 'by', 'at', 'in', 'on'].includes(word.toLowerCase()));
          vehicleKeywords.push(...metatagWords);
        }

        allKeywords.push(...vehicleKeywords);
      });

      return allKeywords.length > 0 ? allKeywords : null;
    }

    // Fallback to original metadata formatting if no match and not using preset
    if (!isUsingParticipantPreset) {
      const keywords = this.formatMetadataByCategory(analysis, this.category);
      return keywords.length > 0 ? keywords : null;
    }

    // Using preset but no matches - return null (already logged above)
    return null;
  }

  /**
   * Costruisce una stringa formattata per IPTC:SpecialInstructions
   */
  private buildSpecialInstructions(analysis: any[], csvMatch?: any): string | null {
    if (!analysis || analysis.length === 0) {
      return null;
    }

    const parts: string[] = [];

    // Enhanced formatting for preset participants
    if (csvMatch && csvMatch.entry) {
      const participant = csvMatch.entry;

      // Add race number if available
      if (participant.numero) {
        parts.push(`Number: ${participant.numero}`);
      }

      // Add team information
      if (participant.squadra) {
        parts.push(`Team: ${participant.squadra}`);
      }

      // Add driver information from preset_participant_drivers
      const drivers = getParticipantDriverNames(participant);

      if (drivers.length > 0) {
        parts.push(`Drivers: ${drivers.join(', ')}`);
      }

      return parts.join(' | ');
    }

    // Fallback to analysis data formatting
    for (let i = 0; i < analysis.length; i++) {
      const result = analysis[i];
      const resultParts: string[] = [];

      // Race number
      const raceNumber = result.raceNumber || result.race_number || result.number;
      if (raceNumber) {
        resultParts.push(`Number: ${raceNumber}`);
      }

      // Category
      const category = result.category || result.class || result.vehicleClass;
      if (category) {
        resultParts.push(`Category: ${category}`);
      }

      // Team (for motorsport)
      if (result.teamName && this.category && this.category.toLowerCase() === 'motorsport') {
        resultParts.push(`Team: ${result.teamName}`);
      }

      if (resultParts.length > 0) {
        parts.push(resultParts.join(' | '));
      }
    }

    // If no matches found, add NO-MATCH tag
    if (!csvMatch && parts.length === 0) {
      return 'NO-MATCH';
    }

    return parts.length > 0 ? parts.join(' | ') : null;
  }

  /**
   * Costruisce una stringa formattata per XMP:Description (Extended Description)
   * Gestisce sia oggetti singoli che array di csvMatch per immagini multi-veicolo
   */
  private buildExtendedDescription(analysis: any[], csvMatch?: any): string | null {
    // Handle both single match (legacy) and array of matches (multi-vehicle)
    if (!csvMatch) {
      return null;
    }

    const matches = Array.isArray(csvMatch) ? csvMatch : [csvMatch];
    const descriptions: string[] = [];

    // Process each match to collect metatag content
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];

      if (!match || !match.entry) {
        continue;
      }

      const participant = match.entry;

      // Only use the metatag field from the participant preset
      if (!participant.metatag || participant.metatag.trim() === '') {
        continue;
      }

      // Add metatag content for this vehicle
      const vehicleDescription = participant.metatag.trim();
      descriptions.push(vehicleDescription);
    }

    // If no valid descriptions found, return null
    if (descriptions.length === 0) {
      return null;
    }

    // Combine all descriptions with separator for multi-vehicle images
    const finalDescription = descriptions.join(' | ');
    return finalDescription;
  }

  /**
   * Formatta i metadata per categoria per tutti i risultati di analisi
   */
  private formatMetadataByCategory(
    analysisData?: any | any[], 
    category: string = 'motorsport',
    csvMetatag?: string
  ): string[] {
    // Priorità 1: Se c'è un metatag dal CSV, usa quello
    if (csvMetatag) {
      return [csvMetatag];
    }

    // Priorità 2: Se non ci sono dati AI, usa un messaggio generico
    if (!analysisData) {
      const fallback = `Processed by Racetagger - Category: ${category}`;
      return [fallback];
    }

    // Converti in array se è un singolo oggetto
    const analysisArray = Array.isArray(analysisData) ? analysisData : [analysisData];
    const allKeywords: string[] = [];

    // Processa ogni risultato di analisi
    for (let i = 0; i < analysisArray.length; i++) {
      const analysis = analysisArray[i];
      const vehicleKeywords: string[] = [];

      // Numero (universale per tutti gli sport)
      const raceNumber = analysis.raceNumber || analysis.race_number || analysis.number;
      if (raceNumber) {
        const keyword = `Number: ${raceNumber}`;
        vehicleKeywords.push(keyword);
      }

      // Gestione piloti/atleti in base alla categoria
      const drivers = analysis.drivers || (analysis.driver ? [analysis.driver] : []);
      if (drivers && drivers.length > 0) {
        const driversText = Array.isArray(drivers) ? drivers.join(', ') : String(drivers);

        let driverLabel: string;
        switch (category.toLowerCase()) {
          case 'motorsport':
            driverLabel = drivers.length === 1 ? 'Driver' : 'Drivers';
            break;
          case 'running':
            driverLabel = drivers.length === 1 ? 'Athlete' : 'Athletes';
            break;
          default:
            driverLabel = drivers.length === 1 ? 'Participant' : 'Participants';
            break;
        }

        const keyword = `${driverLabel}: ${driversText}`;
        vehicleKeywords.push(keyword);
      }

      // Categoria/Disciplina
      const vehicleCategory = analysis.category || analysis.class || analysis.vehicleClass;
      if (vehicleCategory) {
        const keyword = `Category: ${vehicleCategory}`;
        vehicleKeywords.push(keyword);
      }

      // Team/Squadra (più rilevante per motorsport)
      if (analysis.teamName && category.toLowerCase() === 'motorsport') {
        vehicleKeywords.push(analysis.teamName);
      }

      // Altri testi rilevati (se presenti e non ridondanti) - aggiunti come keywords separati
      if (analysis.otherText && analysis.otherText.length > 0) {
        const relevantTexts = analysis.otherText
          .filter((text: string) => text.length > 0); // Include tutti i testi non vuoti

        if (relevantTexts.length > 0) {
          // Add each text as separate keyword without prefix
          for (const text of relevantTexts) {
            vehicleKeywords.push(text);
          }
        }
      }

      // Aggiungi le keywords del veicolo corrente
      allKeywords.push(...vehicleKeywords);

      // Aggiungi divider se ci sono più veicoli e non è l'ultimo
      if (analysisArray.length > 1 && i < analysisArray.length - 1) {
        allKeywords.push('...');
      }
    }

    // Se non abbiamo dati utili, usa un fallback
    if (allKeywords.length === 0) {
      const fallback = `Analyzed by Racetagger - Category: ${category}`;
      return [fallback];
    }

    return allKeywords;
  }

  /**
   * ADMIN FEATURE: Organizza l'immagine in cartelle basate sul numero di gara
   */
  private async organizeToFolders(
    imageFile: UnifiedImageFile,
    processedAnalysis: any,
    processedImagePath: string
  ): Promise<string | undefined> {
    // Verifica se la funzionalità è abilitata
    const { APP_CONFIG } = await import('./config');
    if (!APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION || !this.config.folderOrganization?.enabled) {
      return undefined;
    }

    try {
      // Import dinamico del modulo organizer per mantenere la modularità
      const { FolderOrganizer } = await import('./utils/folder-organizer');

      // Crea configurazione organizer da config del processor
      const organizerConfig = {
        enabled: this.config.folderOrganization.enabled,
        mode: this.config.folderOrganization.mode,
        pattern: this.config.folderOrganization.pattern,
        customPattern: this.config.folderOrganization.customPattern,
        createUnknownFolder: this.config.folderOrganization.createUnknownFolder,
        unknownFolderName: this.config.folderOrganization.unknownFolderName,
        destinationPath: this.config.folderOrganization.destinationPath,
        includeXmpFiles: this.config.folderOrganization.includeXmpFiles
      };

      // Crea istanza organizer
      const organizer = new FolderOrganizer(organizerConfig);

      // Estrai numeri di gara dall'analisi
      const allDetectedNumbers = this.extractRaceNumbers(processedAnalysis.analysis);

      // Check if we're using a participant preset
      const isUsingParticipantPreset = this.participantsData.length > 0;

      // Extract numbers that have valid matches in the preset
      const numbersWithMatches = this.extractNumbersWithMatches(processedAnalysis.csvMatch);

      let organizeResult: import('./utils/folder-organizer').FolderOrganizationResult | undefined;

      if (!allDetectedNumbers || allDetectedNumbers.length === 0) {
        organizeResult = await organizer.organizeUnknownImage(
          imageFile.originalPath,
          path.dirname(imageFile.originalPath)
        );
      } else if (isUsingParticipantPreset && numbersWithMatches.length === 0) {
        // Numbers detected but NONE found in preset - use Unknown_Numbers folder
        // Log unknown number event
        if (this.analysisLogger) {
          this.analysisLogger.logUnknownNumber({
            imageId: imageFile.id,
            fileName: imageFile.fileName,
            detectedNumbers: allDetectedNumbers,
            participantPresetName: 'Dynamic Preset',
            participantCount: this.participantsData.length,
            appliedFuzzyCorrection: this.smartMatcher ? this.smartMatcher.getCorrections().some(c => c.type === 'FUZZY') : false,
            organizationFolder: 'Unknown_Numbers'
          });
        }

        organizeResult = await organizer.organizeToUnknownNumbers(
          imageFile.originalPath,
          path.dirname(imageFile.originalPath)
        );
      } else {
        // At least some numbers have matches - organize by matched numbers only
        const numbersToOrganize = isUsingParticipantPreset ? numbersWithMatches : allDetectedNumbers;

        // COLLECT ALL csvData entries for matched numbers
        const csvDataList: any[] = [];

        if (processedAnalysis.csvMatch && Array.isArray(processedAnalysis.csvMatch)) {
          // For each number to organize, find its corresponding csvData
          numbersToOrganize.forEach(number => {
            const match = processedAnalysis.csvMatch.find((m: any) => m.entry?.numero === number);
            if (match?.entry) {
              csvDataList.push(match.entry);
            }
          });
        }

        // Organizza l'immagine solo con i numeri che hanno match
        organizeResult = await organizer.organizeImage(
          imageFile.originalPath,
          numbersToOrganize,
          csvDataList,
          path.dirname(imageFile.originalPath)
        );

        if (!organizeResult.success) {
          console.error(`[UnifiedWorker] Failed to organize ${imageFile.fileName}:`, organizeResult.error);
        }
      }

      return organizeResult?.organizedPath;

    } catch (error: any) {
      console.error(`[UnifiedWorker] Error during folder organization for ${imageFile.fileName}:`, error);
      // Non bloccare il processamento per errori di organizzazione
      return undefined;
    }
  }

  /**
   * Organize skipped scene images to "Others" folder
   * Called for images that were classified by scene detector but skipped from AI analysis
   * (e.g., crowd_scene, portrait_paddock, podium_celebration)
   */
  private async organizeSkippedScene(
    imageFile: UnifiedImageFile,
    sceneCategory: string
  ): Promise<void> {
    // Verifica se la funzionalità è abilitata
    const { APP_CONFIG } = await import('./config');
    if (!APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION || !this.config.folderOrganization?.enabled) {
      return;
    }

    try {
      // Import dinamico del modulo organizer
      const { FolderOrganizer } = await import('./utils/folder-organizer');

      // Crea configurazione organizer da config del processor
      const organizerConfig = {
        enabled: this.config.folderOrganization.enabled,
        mode: this.config.folderOrganization.mode,
        pattern: this.config.folderOrganization.pattern,
        customPattern: this.config.folderOrganization.customPattern,
        createUnknownFolder: this.config.folderOrganization.createUnknownFolder,
        unknownFolderName: this.config.folderOrganization.unknownFolderName,
        destinationPath: this.config.folderOrganization.destinationPath,
        includeXmpFiles: this.config.folderOrganization.includeXmpFiles
      };

      // Crea istanza organizer
      const organizer = new FolderOrganizer(organizerConfig);

      // Organizza l'immagine nella cartella "Others"
      const result = await organizer.organizeGenericScene(
        imageFile.originalPath,
        sceneCategory,
        path.dirname(imageFile.originalPath)
      );

      if (!result.success) {
        console.error(`[UnifiedWorker] Failed to organize skipped scene ${imageFile.fileName}:`, result.error);
      }

    } catch (error: any) {
      console.error(`[UnifiedWorker] Error during skipped scene organization for ${imageFile.fileName}:`, error);
      // Non bloccare il processamento per errori di organizzazione
    }
  }

  /**
   * Estrae i numeri di gara dall'analisi AI
   */
  private extractRaceNumbers(analysis: any[]): string[] {
    if (!analysis || analysis.length === 0) {
      return [];
    }

    const numbers: string[] = [];

    // Estrai numeri da tutti i veicoli rilevati
    for (const vehicle of analysis) {
      if (vehicle.raceNumber && !numbers.includes(vehicle.raceNumber)) {
        numbers.push(vehicle.raceNumber);
      }
    }

    return numbers;
  }

  /**
   * Extract only race numbers that have valid matches in the participant preset
   */
  private extractNumbersWithMatches(csvMatches: any): string[] {
    if (!csvMatches) {
      return [];
    }

    const numbersWithMatches: string[] = [];

    // Handle both single match (legacy) and array of matches (multi-vehicle)
    const matches = Array.isArray(csvMatches) ? csvMatches : [csvMatches];

    for (const match of matches) {
      if (match && match.entry && match.entry.numero) {
        const matchedNumber = String(match.entry.numero);
        if (!numbersWithMatches.includes(matchedNumber)) {
          numbersWithMatches.push(matchedNumber);
        }
      }
    }

    return numbersWithMatches;
  }

  /**
   * Fuzzy matching for sponsor names with common abbreviations and variations
   */
  private isFuzzySponsorMatch(detected: string, sponsor: string): boolean {
    // Define common abbreviations and variations
    const commonAbbreviations: { [key: string]: string[] } = {
      // Automotive brands and common sponsors
      'ferrari': ['fer', 'scuderia', 'sf'],
      'lamborghini': ['lambo', 'lamb'],
      'mercedes': ['merc', 'benz', 'amg'],
      'bmw': ['bayerische', 'motoren'],
      'audi': ['quattro', 'sport'],
      'porsche': ['por', 'porshe'],
      'nissan': ['niss'],
      'toyota': ['toy'],
      'honda': ['hon'],
      'red bull': ['redbull', 'rb'],
      'monster': ['mons'],
      'shell': ['sh'],
      'esso': ['es'],
      'castrol': ['cas'],
      'pirelli': ['pir'],
      'michelin': ['mich'],
      'bridgestone': ['bridge', 'bs'],
      'goodyear': ['good', 'gy'],
      // Italian racing terms
      'racing': ['race', 'corse'],
      'team': ['scuderia', 'squadra'],
      'motor': ['motori'],
      'sport': ['sportivo']
    };

    // Check if detected text contains any abbreviation of the sponsor
    for (const [fullName, abbreviations] of Object.entries(commonAbbreviations)) {
      if (sponsor.includes(fullName)) {
        if (abbreviations.some(abbr => detected.includes(abbr))) {
          return true;
        }
      }
      if (detected.includes(fullName)) {
        if (abbreviations.some(abbr => sponsor.includes(abbr))) {
          return true;
        }
      }
    }

    // Check for word-level matching (split by spaces and check individual words)
    const detectedWords = detected.split(/\s+/).filter(w => w.length > 2);
    const sponsorWords = sponsor.split(/\s+/).filter(w => w.length > 2);

    for (const detectedWord of detectedWords) {
      for (const sponsorWord of sponsorWords) {
        // If any word matches or is contained in the other
        if (detectedWord.includes(sponsorWord) || sponsorWord.includes(detectedWord)) {
          return true;
        }

        // Check for similar length words with 1-2 character differences (typos)
        if (Math.abs(detectedWord.length - sponsorWord.length) <= 2) {
          const similarity = this.calculateLevenshteinDistance(detectedWord, sponsorWord);
          if (similarity <= 2 && detectedWord.length >= 4) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Calculate Levenshtein distance for fuzzy string matching
   */
  private calculateLevenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Extract drivers from participant match for logging
   */
  private extractDriversFromMatch(csvMatch: any): string[] | undefined {
    if (!csvMatch?.entry) return undefined;

    const drivers = getParticipantDriverNames(csvMatch.entry);
    return drivers.length > 0 ? drivers : undefined;
  }
}

/**
 * Processore unificato che gestisce il pool di worker
 */
export class UnifiedImageProcessor extends EventEmitter {
  private config: UnifiedProcessorConfig;
  private activeWorkers: number = 0;
  private processingQueue: UnifiedImageFile[] = [];
  private totalImages: number = 0;
  private processedImages: number = 0;
  private ghostVehicleCount: number = 0; // Track images with potential ghost vehicle warnings
  private analysisLogger?: AnalysisLogger;
  private temporalManager: TemporalClusterManager;
  private filesystemTimestampExtractor: FilesystemTimestampExtractor;
  private imageTimestamps: Map<string, ImageTimestamp> = new Map(); // Store timestamps by file path
  // Optional telemetry trackers (initialized only if execution_id exists)
  private hardwareDetector?: HardwareDetector;
  private networkMonitor?: NetworkMonitor;
  private performanceTimer?: PerformanceTimer;
  private errorTracker?: ErrorTracker;
  private systemEnvironment?: any; // Store for updating with final network speed
  // RF-DETR Metrics Tracking (aggregated from workers)
  private totalRfDetrDetections: number = 0;
  private totalRfDetrCost: number = 0;
  private recognitionMethod: 'gemini' | 'rf-detr' | 'local-onnx' | null = null;
  private currentSportCategory: any = null; // Current category config from Supabase
  // PERFORMANCE: Cache sport categories once per batch (avoids 12-13 redundant Supabase calls per 100 images)
  private batchSportCategories: any[] | undefined = undefined;
  // PERFORMANCE: ONNX Circuit Breaker (shared across all workers in batch)
  private onnxConsecutiveFailures: number = 0;
  private onnxCircuitBreakerThreshold: number = 5;
  private onnxCircuitOpen: boolean = false;
  private onnxCircuitBreakerLogged: boolean = false;

  // ============================================================================
  // WORKER POOL (v1.1.0+) - Reusable workers to avoid redundant ONNX initialization
  // ============================================================================
  private USE_WORKER_POOL = true; // Re-enabled: ONNX workers are reused across images (avoids N×init overhead)
  private workerPool: UnifiedImageWorker[] = [];
  private availableWorkers: UnifiedImageWorker[] = [];
  private busyWorkers: Set<UnifiedImageWorker> = new Set();

  // ============================================================================
  // BATCH TOKEN PRE-AUTHORIZATION (v1.1.0+)
  // ============================================================================
  private currentReservationId: string | null = null;
  private reservationExpiresAt: string | null = null;
  private batchUsage = {
    processed: 0,
    errors: 0,
    cancelled: 0,
    sceneSkipped: 0,        // FASE 2: predisposto ma non usato per rimborso
    noVehicleDetected: 0,   // FASE 2: predisposto ma non usato per rimborso
    emptyResults: 0         // FASE 2: predisposto ma non usato per rimborso
  };
  private usePreAuthSystem: boolean = false; // Flag per usare pre-auth (v1.1.0+)

  // ============================================================================
  // BATCH DATABASE UPDATES (Performance optimization to avoid Supabase timeout)
  // ============================================================================
  private pendingUpdates: Array<{
    imageId: string;
    updateData: any;
    timestamp: number;
  }> = [];
  private readonly BATCH_UPDATE_THRESHOLD = 25; // Flush every 25 images
  private readonly UPDATE_TIMEOUT_MS = 3000; // Timeout per singolo update

  // ============================================================================
  // BATCH DATABASE INSERTS for analysis_results (ONNX local inference optimization)
  // With local ONNX, inference is ~200ms per image, causing 10+ concurrent inserts
  // that overwhelm Supabase with statement timeouts. Batch them instead.
  // ============================================================================
  private pendingAnalysisInserts: Array<{
    data: any;
    timestamp: number;
  }> = [];
  private readonly BATCH_INSERT_THRESHOLD = 5; // Flush every 5 analysis inserts (smaller batches = faster DB processing)
  private readonly INSERT_TIMEOUT_MS = 20000; // 20s timeout for batch insert (Supabase RLS + triggers need time)

  // ============================================================================
  // RAW PREVIEW CALIBRATION (dynamic extraction strategy per extension)
  // ============================================================================
  private rawPreviewStrategies: Map<string, RawPreviewStrategy> = new Map();

  constructor(config: Partial<UnifiedProcessorConfig> = {}) {
    super();
    
    // Auto-configure worker count based on system resources
    const optimalWorkers = this.calculateOptimalWorkerCount();
    
    // Use default resize preset configuration
    const defaultPresetConfig = RESIZE_PRESETS[APP_CONFIG.defaultResizePreset];

    this.config = {
      maxConcurrentWorkers: optimalWorkers,
      maxImageSizeKB: 500,
      jpegQuality: defaultPresetConfig.jpegQuality,
      maxDimension: defaultPresetConfig.maxDimension,
      csvData: [],
      category: 'motorsport',
      ...config
    };
    
    // Initialize temporal clustering manager
    this.temporalManager = new TemporalClusterManager();

    // Initialize filesystem timestamp extractor for cross-platform temporal sorting
    this.filesystemTimestampExtractor = new FilesystemTimestampExtractor();

    if (DEBUG_MODE) if (DEBUG_MODE) console.log(`[UnifiedProcessor] Initialized with ${this.config.maxConcurrentWorkers} workers`);
  }

  /**
   * Flush pending database updates in batches to avoid Supabase timeout
   * Updates are sent in chunks of 10 with 3-second timeout per update
   */
  private async flushPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.length === 0) {
      return;
    }

    const updateCount = this.pendingUpdates.length;
    log.info(`[DBUpdate] Flushing ${updateCount} pending updates...`);

    try {
      const { getSupabaseClient } = await import('./database-service');
      const supabase = getSupabaseClient();

      // Process updates in chunks of 10 to avoid overwhelming Supabase
      const CHUNK_SIZE = 10;
      const chunks: typeof this.pendingUpdates[] = [];

      for (let i = 0; i < this.pendingUpdates.length; i += CHUNK_SIZE) {
        chunks.push(this.pendingUpdates.slice(i, i + CHUNK_SIZE));
      }

      let successCount = 0;
      let errorCount = 0;

      for (const chunk of chunks) {
        // Process chunk updates in parallel (max 10 concurrent)
        const updatePromises = chunk.map(async (pendingUpdate) => {
          try {
            // Add timeout to prevent hanging
            const updatePromise = supabase
              .from('analysis_results')
              .update(pendingUpdate.updateData)
              .eq('image_id', pendingUpdate.imageId)
              .maybeSingle(); // More efficient than .select()

            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Update timeout')), this.UPDATE_TIMEOUT_MS)
            );

            // Race between update and timeout
            await Promise.race([updatePromise, timeoutPromise]);
            successCount++;
          } catch (error: any) {
            errorCount++;
            if (DEBUG_MODE) {
              console.warn(`[DBUpdate] Failed to update image ${pendingUpdate.imageId}:`, error.message);
            }
          }
        });

        // Wait for chunk to complete before next chunk
        await Promise.allSettled(updatePromises);
      }

      log.info(`[DBUpdate] Flush complete: ${successCount} success, ${errorCount} errors`);

      // Clear pending updates after flush
      this.pendingUpdates = [];

    } catch (error: any) {
      log.error(`[DBUpdate] Failed to flush updates: ${error.message}`);
      // Don't clear pending updates on critical error - they'll be retried
    }
  }

  /**
   * Flush pending analysis_results inserts as a single batch operation.
   * With local ONNX inference (~200ms/image), 10 workers produce results nearly
   * simultaneously, causing statement timeouts on individual inserts.
   * Batching reduces DB calls from N to 1 and avoids connection contention.
   */
  private async flushPendingInserts(): Promise<void> {
    if (this.pendingAnalysisInserts.length === 0) {
      return;
    }

    const insertCount = this.pendingAnalysisInserts.length;
    log.info(`[DBInsert] Flushing ${insertCount} pending analysis_results inserts...`);

    try {
      const { getSupabaseClient } = await import('./database-service');
      const supabase = getSupabaseClient();

      // Extract just the data objects for batch insert
      const insertData = this.pendingAnalysisInserts.map(item => item.data);

      // Single batch insert with timeout protection
      const insertPromise = supabase
        .from('analysis_results')
        .insert(insertData);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Batch insert timeout')), this.INSERT_TIMEOUT_MS)
      );

      const { error } = await Promise.race([insertPromise, timeoutPromise]) as any;

      if (error) {
        log.error(`[DBInsert] Batch insert failed: ${error.message}`);

        // Fallback: try inserting one by one with small delay to avoid connection contention
        let successCount = 0;
        let errorCount = 0;
        for (let idx = 0; idx < insertData.length; idx++) {
          const item = insertData[idx];
          try {
            // Small staggered delay to avoid overwhelming Supabase
            if (idx > 0) await new Promise(r => setTimeout(r, 200));

            const { error: singleError } = await supabase
              .from('analysis_results')
              .insert(item);
            if (singleError) {
              errorCount++;
              log.warn(`[DBInsert] Single insert failed for image ${item.image_id}: ${singleError.message} (code=${(singleError as any)?.code || ''})`);
            } else {
              successCount++;
            }
          } catch {
            errorCount++;
          }
        }
        log.info(`[DBInsert] Fallback complete: ${successCount} success, ${errorCount} errors`);
      } else {
        log.info(`[DBInsert] Batch insert complete: ${insertCount} analysis results saved`);
      }

      // Clear pending inserts after flush
      this.pendingAnalysisInserts = [];

    } catch (error: any) {
      log.error(`[DBInsert] Failed to flush inserts: ${error.message}`);
      // Don't clear pending inserts on critical error - they'll be retried
    }
  }

  /**
   * Initialize temporal clustering configurations from Supabase sport categories
   */
  private async initializeTemporalConfigurations() {
    try {
      // Create temporary Supabase client
      const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

      // Get sport categories from Supabase
      const { data: sportCategories, error } = await supabase
        .from('sport_categories')
        .select('*')
        .eq('is_active', true);

      if (error) {
        if (DEBUG_MODE) if (DEBUG_MODE) console.warn(`[UnifiedProcessor] Failed to load sport categories from Supabase:`, error);
        return;
      }

      if (!sportCategories || sportCategories.length === 0) {
        if (DEBUG_MODE) if (DEBUG_MODE) console.warn(`[UnifiedProcessor] No sport categories found in Supabase`);
        return;
      }

      if (DEBUG_MODE) if (DEBUG_MODE) console.log(`[UnifiedProcessor] Loaded ${sportCategories.length} sport categories from Supabase`);

      // Initialize TemporalClusterManager configurations from Supabase data
      if (this.temporalManager) {
        this.temporalManager.initializeFromSportCategories(sportCategories);
      }

      // Find and store current sport category for RF-DETR tracking
      this.currentSportCategory = sportCategories.find(
        (cat: any) => cat.code.toLowerCase() === (this.config.category || 'motorsport').toLowerCase()
      );

      if (!this.currentSportCategory && DEBUG_MODE) {
        if (DEBUG_MODE) console.warn(`[UnifiedProcessor] Sport category '${this.config.category}' not found in Supabase`);
      }
    } catch (error) {
      console.error(`[UnifiedProcessor] Error initializing temporal configurations:`, error);
    }
  }

  /**
   * Extract timestamps from all images using batch processing for temporal clustering
   */
  private async extractTimestampsFromImagesBatch(imageFiles: UnifiedImageFile[]): Promise<ImageTimestamp[]> {
    const filePaths = imageFiles.map(file => file.originalPath);
    const imageTimestamps = await this.temporalManager.extractTimestampsBatch(filePaths);

    // Store timestamps in the map for later use during analysis
    this.imageTimestamps.clear();
    for (const timestamp of imageTimestamps) {
      this.imageTimestamps.set(timestamp.filePath, timestamp);
    }

    return imageTimestamps;
  }

  /**
   * Extract timestamps from all images for temporal clustering (legacy single-file method)
   */
  private async extractTimestampsFromImages(imageFiles: UnifiedImageFile[]): Promise<ImageTimestamp[]> {
    const imageTimestamps: ImageTimestamp[] = [];

    // Process images in parallel for faster timestamp extraction
    const timestampPromises = imageFiles.map(async (imageFile): Promise<ImageTimestamp | null> => {
      try {
        const timestamp = await this.temporalManager.extractTimestamp(imageFile.originalPath);
        return timestamp;
      } catch (error) {
        if (DEBUG_MODE) if (DEBUG_MODE) console.warn(`[UnifiedProcessor] Failed to extract timestamp from ${imageFile.fileName}`);
        return null;
      }
    });

    const results = await Promise.all(timestampPromises);

    // Filter out failed extractions and store in map
    for (const timestamp of results) {
      if (timestamp) {
        imageTimestamps.push(timestamp);
        this.imageTimestamps.set(timestamp.filePath, timestamp);
      }
    }

    return imageTimestamps;
  }

  /**
   * Get temporal context for a specific image (timestamp and neighbors)
   */
  getTemporalContext(imagePath: string): { imageTimestamp: ImageTimestamp; temporalNeighbors: ImageTimestamp[] } | null {
    const imageTimestamp = this.imageTimestamps.get(imagePath);
    if (!imageTimestamp) {
      return null;
    }

    // Get all timestamps and find temporal neighbors
    const allTimestamps = Array.from(this.imageTimestamps.values());
    const temporalNeighbors = this.temporalManager.getTemporalNeighbors(
      imageTimestamp,
      allTimestamps,
      this.config.category
    );

    return {
      imageTimestamp,
      temporalNeighbors
    };
  }

  /**
   * Calculate optimal worker count based on system resources
   */
  private calculateOptimalWorkerCount(): number {
    const cpuCount = require('os').cpus().length;
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);

    // Base calculation: use 85% of CPU cores, minimum 3, maximum 16
    // Increased from 75% after testing showed low memory usage (~10MB per worker vs 200MB estimated)
    let workers = Math.max(3, Math.min(16, Math.floor(cpuCount * 0.85)));

    // Adjust based on available memory (each worker needs ~150MB conservative estimate)
    // Real usage is much lower (~10-20MB), so we can be more aggressive
    const maxWorkersByMemory = Math.floor(totalMemoryGB * 0.4 * 6.67); // 40% of memory, ~150MB per worker
    workers = Math.min(workers, maxWorkersByMemory);

    // Ensure minimum of 3 workers for good performance
    workers = Math.max(3, workers);

    if (DEBUG_MODE) if (DEBUG_MODE) console.log(`[UnifiedProcessor] System: ${cpuCount} CPUs, ${totalMemoryGB.toFixed(1)}GB RAM → ${workers} workers`);
    return workers;
  }

  /**
   * Processa un batch di immagini con chunking automatico per batch molto grandi
   */
  async processBatch(imageFiles: UnifiedImageFile[]): Promise<UnifiedProcessingResult[]> {
    // FILTRO: Rimuovi file metadata di macOS (iniziano con ._) che causano loop infiniti
    const filteredFiles = imageFiles.filter(file => {
      const basename = path.basename(file.fileName);
      return !basename.startsWith('._');
    });

    // ========================================================================
    // PRE-AUTORIZZAZIONE TOKEN BATCH (v1.1.0+)
    // ========================================================================
    if (this.config.executionId && authService.isAuthenticated()) {
      // Calcola token necessari
      const visualTaggingEnabled = this.config.visualTagging?.enabled || false;
      const tokensNeeded = authService.calculateTokensNeeded(filteredFiles.length, visualTaggingEnabled);

      // Pre-autorizza
      const preAuth = await authService.preAuthorizeTokens(
        tokensNeeded,
        this.config.executionId,
        filteredFiles.length,
        visualTaggingEnabled
      );

      if (!preAuth.authorized) {
        // Token insufficienti - emetti evento e ritorna vuoto
        this.emit('preAuthFailed', {
          error: preAuth.error,
          available: preAuth.available,
          needed: preAuth.needed
        });
        throw new Error(`Token insufficienti: ${preAuth.available || 0} disponibili, ${tokensNeeded} richiesti`);
      }

      // Salva stato reservation
      this.currentReservationId = preAuth.reservationId || null;
      this.reservationExpiresAt = preAuth.expiresAt || null;
      this.usePreAuthSystem = true;
      // Propaga il flag alla config per i worker
      this.config.usePreAuthSystem = true;

      // Reset contatori batch
      this.batchUsage = {
        processed: 0,
        errors: 0,
        cancelled: 0,
        sceneSkipped: 0,
        noVehicleDetected: 0,
        emptyResults: 0
      };

      if (DEBUG_MODE) console.log(`[UnifiedProcessor] Pre-authorized ${tokensNeeded} tokens, reservation: ${this.currentReservationId}`);
    }
    // ========================================================================

    // ========================================================================
    // PERFORMANCE OPTIMIZATION: Cache sport categories once per batch
    // ========================================================================
    // This avoids 12-13 redundant Supabase calls per 100 images (one per worker)
    // Expected impact: 600-2600ms saved per batch
    if (!this.batchSportCategories) {
      this.batchSportCategories = await getSportCategories();
      console.log(`[UnifiedProcessor] 🚀 Cached ${this.batchSportCategories?.length || 0} sport categories for batch`);
    } else {
      console.log(`[UnifiedProcessor] ♻️  Reusing cached sport categories (${this.batchSportCategories?.length || 0} categories)`);
    }
    // ========================================================================

    // ========================================================================
    // WORKER POOL INITIALIZATION: Pre-create workers with ONNX loaded once
    // ========================================================================
    // This avoids redundant ONNX initialization for each image
    // Expected impact: Eliminates N×(ONNX init time) overhead per batch
    if (this.USE_WORKER_POOL) {
      await this.initializeWorkerPool();
    } else {
      console.log('[WorkerPool] ⚠️  Worker pool DISABLED - using legacy one-worker-per-image mode');
    }
    // ========================================================================

    // ========================================================================
    // RAW PREVIEW CALIBRATION: Sample one file per RAW extension to determine
    // optimal extraction strategy (full vs preview vs fallback)
    // ========================================================================
    await this.calibrateRawPreviews(filteredFiles);
    // ========================================================================

    let results: UnifiedProcessingResult[];

    try {
      // Per batch grandi, dividi in chunk per prevenire crash di memoria
      if (filteredFiles.length > 1500) {
        if (DEBUG_MODE) console.log(`[UnifiedProcessor] Large batch (${filteredFiles.length} images), processing in chunks`);
        results = await this.processBatchInChunks(filteredFiles);
      } else {
        results = await this.processBatchInternal(filteredFiles);
      }

      // Finalizza la reservation se attiva
      if (this.usePreAuthSystem && this.currentReservationId) {
        await this.finalizeBatchTokens();
      }

      return results;
    } catch (error) {
      // In caso di errore, finalizza comunque la reservation
      if (this.usePreAuthSystem && this.currentReservationId) {
        // Calcola immagini non processate come cancelled
        const totalExpected = filteredFiles.length;
        const actualProcessed = this.batchUsage.processed + this.batchUsage.errors;
        this.batchUsage.cancelled = Math.max(0, totalExpected - actualProcessed);
        await this.finalizeBatchTokens();
      }
      throw error;
    } finally {
      // Cleanup worker pool (allows garbage collection)
      if (this.USE_WORKER_POOL) {
        this.disposeWorkerPool();
      }
    }
  }

  /**
   * Calibrate RAW preview extraction by sampling one file per RAW extension.
   * Determines the best extraction method (full/preview/fallback) for each format.
   * When crop-context is active, prefers larger previews for better crop quality.
   */
  private async calibrateRawPreviews(imageFiles: UnifiedImageFile[]): Promise<void> {
    // Group RAW files by extension
    const rawExtensions = new Map<string, UnifiedImageFile>();
    for (const file of imageFiles) {
      if (file.isRaw) {
        const ext = path.extname(file.fileName).toLowerCase();
        if (!rawExtensions.has(ext)) {
          rawExtensions.set(ext, file);
        }
      }
    }

    if (rawExtensions.size === 0) {
      return; // No RAW files in batch
    }

    const cropContextActive = this.shouldUseCropContextForCalibration();
    console.log(`[RAW-Calibration] Calibrating ${rawExtensions.size} RAW format(s), crop-context: ${cropContextActive}`);

    for (const [ext, sampleFile] of rawExtensions) {
      try {
        console.log(`[RAW-Calibration] Sampling ${ext} with ${sampleFile.fileName}...`);

        // Use extractAllPreviews to discover what's available
        const allResult = await rawPreviewExtractor.extractAllPreviews(sampleFile.originalPath);

        if (!allResult.success || !allResult.previews || allResult.previews.length === 0) {
          // extractAllPreviews failed - try extractFullPreview as calibration probe
          console.log(`[RAW-Calibration]   extractAllPreviews returned empty, probing with extractFullPreview...`);
          try {
            const probeResult = await rawPreviewExtractor.extractFullPreview(sampleFile.originalPath, { timeout: 15000 });
            if (probeResult.success && probeResult.data) {
              // Detect dimensions
              let probeWidth = probeResult.width || 0;
              let probeHeight = probeResult.height || 0;
              if (probeWidth === 0 || probeHeight === 0) {
                try {
                  const probeProcessor = await createImageProcessor(probeResult.data);
                  const probeMeta = await probeProcessor.metadata();
                  probeWidth = probeMeta.width || 0;
                  probeHeight = probeMeta.height || 0;
                } catch { /* non-critical */ }
              }

              const probeSizeKB = Math.round(probeResult.data.length / 1024);
              const probeMethod: 'full' | 'preview' = probeWidth >= 1920 ? 'full' : 'preview';
              const targetMax = probeMethod === 'full' ? 8 * 1024 * 1024 : 3 * 1024 * 1024;

              // Release probe buffer immediately
              probeResult.data = null as any;

              this.rawPreviewStrategies.set(ext, {
                method: probeMethod,
                bestWidth: probeWidth,
                bestHeight: probeHeight,
                bestSizeKB: probeSizeKB,
                targetMaxSize: targetMax,
                sampleFile: sampleFile.fileName
              });
              console.log(`[RAW-Calibration]   Probe success: ${ext} -> '${probeMethod}' ${probeWidth}x${probeHeight} (${probeSizeKB}KB)`);
              continue;
            }
          } catch (probeErr: any) {
            console.warn(`[RAW-Calibration]   Probe also failed: ${probeErr.message}`);
          }

          // Complete fallback
          console.log(`[RAW-Calibration]   Using fallback strategy for ${ext}`);
          this.rawPreviewStrategies.set(ext, {
            method: 'fallback',
            bestWidth: 0,
            bestHeight: 0,
            bestSizeKB: 0,
            targetMaxSize: 3 * 1024 * 1024,
            sampleFile: sampleFile.fileName
          });
          continue;
        }

        // Detect actual dimensions with Sharp when native lib reports 0x0
        for (const p of allResult.previews) {
          if ((p.width === 0 || p.height === 0) && p.data && p.data.length > 0) {
            try {
              const dimProcessor = await createImageProcessor(p.data);
              const dimMeta = await dimProcessor.metadata();
              if (dimMeta.width && dimMeta.height) {
                p.width = dimMeta.width;
                p.height = dimMeta.height;
              }
            } catch { /* non-critical */ }
          }
        }

        // Sort previews by pixel count (largest first), fallback to byte size
        const sorted = [...allResult.previews].sort((a, b) => {
          const pixelDiff = (b.width * b.height) - (a.width * a.height);
          if (pixelDiff !== 0) return pixelDiff;
          return (b.data?.length || 0) - (a.data?.length || 0); // Fallback: sort by byte size
        });

        // Log all available previews
        for (const p of sorted) {
          console.log(`[RAW-Calibration]   Found: ${p.quality} ${p.width}x${p.height} (${Math.round(p.data.length / 1024)}KB)`);
        }

        // Normalize quality labels based on actual dimensions.
        // Some native extractors (e.g., raw-preview-extractor on Windows for NEF) label
        // the full JpgFromRaw as "thumbnail". A preview ≥3000px wide is sensor-resolution
        // and should be classified as "full" so the correct extraction method is used.
        for (const p of sorted) {
          if (p.quality !== 'full' && p.width >= 3000) {
            console.log(`[RAW-Calibration]   Reclassified ${p.quality} ${p.width}x${p.height} → full (sensor-resolution preview)`);
            p.quality = 'full';
          }
        }

        // If crop-context is active and no preview is wide enough, probe extractFullPreview
        // which uses ExifTool -JpgFromRaw for the full-resolution embedded JPEG
        const maxAvailableWidth = sorted.length > 0 ? sorted[0].width : 0;
        if (cropContextActive && maxAvailableWidth < 1920) {
          console.log(`[RAW-Calibration]   Best preview ${maxAvailableWidth}px wide, probing extractFullPreview for JpgFromRaw...`);
          try {
            const fullProbe = await rawPreviewExtractor.extractFullPreview(sampleFile.originalPath, { timeout: 15000 });
            if (fullProbe.success && fullProbe.data && fullProbe.data.length > 0) {
              let fpWidth = fullProbe.width || 0;
              let fpHeight = fullProbe.height || 0;
              if (fpWidth === 0 || fpHeight === 0) {
                try {
                  const fpProcessor = await createImageProcessor(fullProbe.data);
                  const fpMeta = await fpProcessor.metadata();
                  fpWidth = fpMeta.width || 0;
                  fpHeight = fpMeta.height || 0;
                } catch { /* non-critical */ }
              }
              const fpSizeKB = Math.round(fullProbe.data.length / 1024);
              console.log(`[RAW-Calibration]   JpgFromRaw probe: ${fpWidth}x${fpHeight} (${fpSizeKB}KB)`);

              // If JpgFromRaw is significantly larger, use "full" strategy directly
              if (fpWidth >= 1920 || fullProbe.data.length > (sorted[0]?.data?.length || 0) * 1.5) {
                // Release probe buffer
                fullProbe.data = null as any;
                const targetMax = 8 * 1024 * 1024;
                this.rawPreviewStrategies.set(ext, {
                  method: 'full',
                  bestWidth: fpWidth,
                  bestHeight: fpHeight,
                  bestSizeKB: fpSizeKB,
                  targetMaxSize: targetMax,
                  sampleFile: sampleFile.fileName
                });
                console.log(`[RAW-Calibration]   ✅ ${ext}: Using 'full' strategy (JpgFromRaw) → ${fpWidth}x${fpHeight} (${fpSizeKB}KB, maxTarget=${Math.round(targetMax / 1024 / 1024)}MB)`);
                continue; // Skip normal strategy selection below
              }
              // Release probe buffer
              fullProbe.data = null as any;
            }
          } catch (fpErr: any) {
            console.warn(`[RAW-Calibration]   JpgFromRaw probe failed: ${fpErr.message}`);
          }
        }

        // Choose strategy based on crop-context and available previews
        const fullPreview = sorted.find(p => p.quality === 'full');
        const mediumPreview = sorted.find(p => p.quality === 'preview');
        const bestPreview = sorted[0]; // Largest available

        let chosen: typeof sorted[0];
        let method: 'full' | 'preview' | 'fallback';

        if (cropContextActive) {
          // Crop-context needs maximum detail for accurate bbox crops
          // Prefer full preview (JpgFromRaw) if available
          if (fullPreview && fullPreview.width >= 1920) {
            chosen = fullPreview;
            method = 'full';
          } else if (bestPreview.width >= 1920) {
            chosen = bestPreview;
            method = bestPreview.quality === 'full' ? 'full' : 'preview';
          } else {
            // Even the best preview is small - still use it, but log warning
            chosen = bestPreview;
            method = 'preview';
            console.warn(`[RAW-Calibration]   ⚠️ ${ext}: Best preview only ${chosen.width}x${chosen.height} - may affect crop quality`);
          }
        } else {
          // No crop-context: we only need enough resolution for the maxDimension resize (1920px default)
          // Prefer medium-sized preview to avoid wasting time resizing huge JpgFromRaw
          const minAcceptableWidth = this.config.maxDimension || 1920;

          if (mediumPreview && mediumPreview.width >= minAcceptableWidth) {
            // Medium preview is big enough - use it (faster than full)
            chosen = mediumPreview;
            method = 'preview';
          } else if (fullPreview && fullPreview.width >= minAcceptableWidth) {
            // Need full preview to reach target dimension
            chosen = fullPreview;
            method = 'full';
          } else if (bestPreview.width >= minAcceptableWidth) {
            chosen = bestPreview;
            method = bestPreview.quality === 'full' ? 'full' : 'preview';
          } else {
            // All previews are smaller than target - use the largest available
            chosen = bestPreview;
            method = bestPreview.quality === 'full' ? 'full' : 'preview';
            console.warn(`[RAW-Calibration]   ⚠️ ${ext}: Best preview ${chosen.width}x${chosen.height} is below target ${minAcceptableWidth}px`);
          }
        }

        // Set targetMaxSize based on strategy
        // For full: allow up to 8MB (JpgFromRaw can be large)
        // For preview: allow up to 3MB
        const targetMaxSize = method === 'full'
          ? 8 * 1024 * 1024
          : 3 * 1024 * 1024;

        const strategy: RawPreviewStrategy = {
          method,
          bestWidth: chosen.width,
          bestHeight: chosen.height,
          bestSizeKB: Math.round(chosen.data.length / 1024),
          targetMaxSize,
          sampleFile: sampleFile.fileName
        };

        this.rawPreviewStrategies.set(ext, strategy);
        console.log(`[RAW-Calibration]   ✅ ${ext}: Using '${method}' strategy → ${chosen.width}x${chosen.height} (${strategy.bestSizeKB}KB, maxTarget=${Math.round(targetMaxSize / 1024 / 1024)}MB)`);

      } catch (error: any) {
        console.error(`[RAW-Calibration]   ❌ Failed to calibrate ${ext}: ${error.message}`);
        // Fallback: use current default behavior
        this.rawPreviewStrategies.set(ext, {
          method: 'fallback',
          bestWidth: 0,
          bestHeight: 0,
          bestSizeKB: 0,
          targetMaxSize: 3 * 1024 * 1024,
          sampleFile: sampleFile.fileName
        });
      }
    }

    console.log(`[RAW-Calibration] Calibration complete: ${this.rawPreviewStrategies.size} strategies configured`);
  }

  /**
   * Check if crop-context is likely to be used for this batch.
   * Used during calibration to determine preview size requirements.
   */
  private shouldUseCropContextForCalibration(): boolean {
    // Check current sport category crop_config
    if (this.currentSportCategory?.crop_config) {
      let cropConfig = this.currentSportCategory.crop_config;
      if (typeof cropConfig === 'string') {
        try {
          cropConfig = JSON.parse(cropConfig);
        } catch {
          return false;
        }
      }
      return cropConfig?.enabled === true;
    }

    // Also check batch sport categories if available
    if (this.batchSportCategories) {
      for (const cat of this.batchSportCategories) {
        if (cat.code === this.config.category && cat.crop_config) {
          let cropConfig = cat.crop_config;
          if (typeof cropConfig === 'string') {
            try {
              cropConfig = JSON.parse(cropConfig);
            } catch {
              continue;
            }
          }
          return cropConfig?.enabled === true;
        }
      }
    }

    return false;
  }

  /**
   * Get the calibrated RAW preview strategy for a given file extension.
   * Returns null if no calibration data exists (use default behavior).
   */
  getRawPreviewStrategy(ext: string): RawPreviewStrategy | null {
    return this.rawPreviewStrategies.get(ext.toLowerCase()) || null;
  }

  /**
   * Get all calibrated RAW preview strategies (for passing to workers).
   */
  getRawPreviewStrategies(): Map<string, RawPreviewStrategy> {
    return this.rawPreviewStrategies;
  }

  /**
   * Finalizza la reservation batch e calcola rimborso
   */
  async finalizeBatchTokens(): Promise<void> {
    if (!this.currentReservationId) {
      return;
    }

    try {
      const result = await authService.finalizeTokenReservation(
        this.currentReservationId,
        {
          processed: this.batchUsage.processed,
          errors: this.batchUsage.errors,
          cancelled: this.batchUsage.cancelled,
          sceneSkipped: this.batchUsage.sceneSkipped,
          noVehicleDetected: this.batchUsage.noVehicleDetected,
          emptyResults: this.batchUsage.emptyResults,
          visualTaggingUsed: this.config.visualTagging?.enabled || false
        }
      );

      if (result.success) {
        this.emit('tokensFinalized', {
          consumed: result.consumed,
          refunded: result.refunded,
          newBalance: result.newBalance
        });
        if (DEBUG_MODE) console.log(`[UnifiedProcessor] Tokens finalized: ${result.consumed} consumed, ${result.refunded} refunded`);
      } else {
        console.error('[UnifiedProcessor] Failed to finalize tokens:', result.error);
      }
    } catch (error) {
      console.error('[UnifiedProcessor] Exception finalizing tokens:', error);
    } finally {
      // Reset stato
      this.currentReservationId = null;
      this.reservationExpiresAt = null;
    }
  }

  /**
   * Chiamato quando il batch viene cancellato dall'utente
   */
  async handleBatchCancellation(): Promise<void> {
    if (!this.usePreAuthSystem || !this.currentReservationId) {
      return;
    }

    // Calcola immagini non processate come cancelled
    const remaining = this.totalImages - this.processedImages;
    this.batchUsage.cancelled = remaining;

    await this.finalizeBatchTokens();
  }

  /**
   * Incrementa il contatore di immagini processate (usato da worker)
   */
  trackImageProcessed(): void {
    if (this.usePreAuthSystem) {
      this.batchUsage.processed++;
    }
  }

  /**
   * Incrementa il contatore di errori (usato da worker)
   */
  trackImageError(): void {
    if (this.usePreAuthSystem) {
      this.batchUsage.errors++;
    }
  }

  /**
   * Processa un batch molto grande in chunk più piccoli
   */
  private async processBatchInChunks(imageFiles: UnifiedImageFile[]): Promise<UnifiedProcessingResult[]> {
    const chunkSize = 500;
    const allResults: UnifiedProcessingResult[] = [];

    for (let i = 0; i < imageFiles.length; i += chunkSize) {
      // Check for cancellation before each chunk
      if (this.config.isCancelled && this.config.isCancelled()) {
        if (DEBUG_MODE) if (DEBUG_MODE) console.log(`[UnifiedProcessor] Processing cancelled at chunk ${Math.floor(i / chunkSize) + 1}`);
        break;
      }

      const chunk = imageFiles.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(imageFiles.length / chunkSize);

      // Forza garbage collection prima di ogni chunk
      if (global.gc) {
        global.gc();
      }

      // Aggiorna i contatori totali per il progress reporting
      this.totalImages = imageFiles.length;
      this.processedImages = allResults.length;

      // Processa il chunk (passa true per indicare che è chunk processing)
      const chunkResults = await this.processBatchInternal(chunk);
      allResults.push(...chunkResults);

      // Aggiorna progress finale del chunk
      this.processedImages = allResults.length;

      // Emetti progress per il chunk completato
      this.emit('imageProcessed', {
        processed: this.processedImages,
        total: this.totalImages,
        ghostVehicleCount: this.ghostVehicleCount,
        phase: 'recognition',
        step: 2,
        totalSteps: 2,
        progress: Math.round((this.processedImages / this.totalImages) * 100),
        chunkInfo: {
          currentChunk: chunkNumber,
          totalChunks: totalChunks,
          chunkCompleted: true
        }
      });

      // Pausa più lunga tra chunk per permettere alla memoria di stabilizzarsi
      if (chunkNumber < totalChunks) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    return allResults;
  }

  /**
   * Processa un batch di immagini (implementazione interna)
   */
  private async processBatchInternal(imageFiles: UnifiedImageFile[]): Promise<UnifiedProcessingResult[]> {
    // Controllo memoria preventivo
    const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const totalMemoryMB = require('os').totalmem() / 1024 / 1024;
    const memoryUsagePercent = (memoryMB / totalMemoryMB) * 100;

    // Se l'uso memoria è già alto, forza garbage collection
    if (memoryUsagePercent > 70) {
      if (DEBUG_MODE) if (DEBUG_MODE) console.warn(`[UnifiedProcessor] High memory usage detected (${memoryUsagePercent.toFixed(1)}%), forcing GC`);
      if (global.gc) {
        global.gc();
      }
    }

    // Solo imposta i contatori se non stiamo processando chunk
    // (i chunk mantengono i contatori globali impostati da processBatchInChunks)
    // Se totalImages è già maggiore del batch corrente, siamo in modalità chunk
    const isChunkProcessing = this.totalImages > imageFiles.length;
    if (!isChunkProcessing) {
      this.totalImages = imageFiles.length;
      this.processedImages = 0;
      this.ghostVehicleCount = 0; // Reset ghost vehicle counter for new batch
    }
    this.processingQueue = [...imageFiles];

    // Initialize temporal configurations from Supabase
    await this.initializeTemporalConfigurations();

    // Initialize analysis logger if execution ID is available
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Checking for executionId in config:`, {
      executionId: this.config.executionId,
      hasExecutionId: !!this.config.executionId,
      configKeys: Object.keys(this.config)
    });

    if (this.config.executionId) {
      const { authService } = await import('./auth-service');
      const authState = authService.getAuthState();
      const userId = authState.isAuthenticated ? authState.user?.id : 'anonymous';

      this.analysisLogger = new AnalysisLogger(
        this.config.executionId,
        this.config.category || 'motorsport',
        userId
      );

      // TIER 1 TELEMETRY: Collect enhanced system environment (optional, safe)
      this.systemEnvironment = undefined;

      try {
        // Initialize telemetry trackers (optional)
        this.hardwareDetector = new HardwareDetector();
        this.networkMonitor = new NetworkMonitor();
        this.performanceTimer = new PerformanceTimer();
        this.errorTracker = new ErrorTracker();

        // Collect hardware info (with 5s timeout)
        const hardwareInfo = await Promise.race([
          this.hardwareDetector.getHardwareInfo(),
          new Promise((resolve) => setTimeout(() => resolve(undefined), 5000))
        ]);

        // Collect network metrics (with 5s timeout)
        const networkMetrics = await Promise.race([
          this.networkMonitor.measureInitialMetrics(5000),
          new Promise((resolve) => setTimeout(() => resolve({}), 5000))
        ]);

        // Collect environment info
        const { app } = await import('electron');
        const os = await import('os');
        const crypto = await import('crypto');

        // Generate a persistent machine ID based on hardware characteristics
        // This ID remains consistent across app restarts but is unique per machine
        const machineIdSource = [
          os.hostname(),
          os.platform(),
          os.arch(),
          os.cpus()[0]?.model || '',
          os.totalmem().toString()
        ].join('|');
        const machineId = crypto.createHash('sha256').update(machineIdSource).digest('hex').substring(0, 16);

        this.systemEnvironment = {
          hardware: hardwareInfo,
          network: networkMetrics,
          environment: {
            node_version: process.version,
            electron_version: process.versions.electron || 'N/A',
            dcraw_version: undefined, // TODO: Add dcraw version detection
            sharp_version: 'N/A', // TODO: Get Sharp version safely
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: app.getLocale()
          },
          // Device identification for license management
          device: {
            hostname: os.hostname(),
            machineId: machineId, // Unique per machine, persistent across restarts
            platform: os.platform(),
            username: os.userInfo().username,
            appVersion: app.getVersion()
          }
        };

        if (DEBUG_MODE) console.log('[UnifiedProcessor] ✅ Enhanced telemetry collected');
      } catch (telemetryError) {
        console.warn('[UnifiedProcessor] ⚠️ Failed to collect telemetry (non-critical):', telemetryError);
        // Continue processing even if telemetry fails
      }

      // Log execution start with optional telemetry
      this.analysisLogger.logExecutionStart(
        imageFiles.length,
        undefined, // participantPresetId not needed anymore with direct data passing
        this.systemEnvironment // Optional enhanced telemetry
      );

      if (DEBUG_MODE) console.log(`[UnifiedProcessor] Analysis logging enabled for execution ${this.config.executionId}`);

      // CREATE EXECUTION RECORD IN DATABASE
      // This ensures the execution is tracked in Supabase for later correlation with analysis logs
      try {
        const { getSupabaseClient } = await import('./database-service');
        const { authService: auth } = await import('./auth-service');
        const supabase = getSupabaseClient();
        const authState = auth.getAuthState();
        const currentUserId = authState.isAuthenticated ? authState.user?.id : null;

        if (!currentUserId) {
          if (DEBUG_MODE) console.warn(`[UnifiedProcessor] ⚠️ User not authenticated, skipping execution record creation`);
        } else {
          const executionData = {
            id: this.config.executionId, // Use existing execution ID
            user_id: currentUserId,
            project_id: null, // Desktop executions have no project association
            name: `Desktop - ${(this.config.category || 'motorsport').charAt(0).toUpperCase() + (this.config.category || 'motorsport').slice(1)} - ${new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
            category: this.config.category || 'motorsport',
            total_images: imageFiles.length,
            processed_images: 0, // Will be updated at the end
            status: 'processing',
            execution_settings: {
              maxDimension: this.config.maxDimension,
              jpegQuality: this.config.jpegQuality,
              maxImageSizeKB: this.config.maxImageSizeKB,
              category: this.config.category,
              hasParticipantPreset: !!(this.config.participantPresetData && this.config.participantPresetData.length > 0),
              participantPresetId: this.config.presetId || null,
              participantCount: this.config.participantPresetData?.length || 0,
              folderOrganizationEnabled: !!this.config.folderOrganization?.enabled,
              enableAdvancedAnnotations: this.config.enableAdvancedAnnotations,
              // RF-DETR Tracking
              recognition_method: null, // Will be updated after first image
              recognition_method_version: this.currentSportCategory?.edge_function_version ? `V${this.currentSportCategory.edge_function_version}` : 'V2',
              rf_detr_workflow_url: this.currentSportCategory?.rf_detr_workflow_url || null,
              rf_detr_detections_count: 0, // Will be updated at the end
              rf_detr_total_cost: 0 // Will be updated at the end
            },
            // TIER 1 TELEMETRY: Add system environment telemetry
            system_environment: this.systemEnvironment
          };

          // Use UPSERT to handle case where execution was already created by main.ts
          const { data, error } = await supabase
            .from('executions')
            .upsert(executionData, { onConflict: 'id' })
            .select()
            .single();

          if (error) {
            console.error(`[UnifiedProcessor] ❌ Failed to upsert execution record:`, JSON.stringify(error, null, 2));
            console.error(`[UnifiedProcessor] Error details - code: ${error.code}, message: ${error.message}, details: ${error.details}, hint: ${error.hint}`);
          } else {
            if (DEBUG_MODE) console.log(`[UnifiedProcessor] ✅ Execution record upserted in database: ${data.id}`);
          }
        }
      } catch (executionError) {
        console.error(`[UnifiedProcessor] ❌ Exception creating execution record:`, executionError);
        // Don't fail the entire processing - continue anyway
      }
    } else {
      if (DEBUG_MODE) console.log(`[UnifiedProcessor] Analysis logging DISABLED - no execution ID provided`);
    }

    // Emit temporal analysis started event
    this.emit('temporal-analysis-started', {
      totalImages: this.totalImages,
      phase: 'temporal',
      step: 1,
      totalSteps: 2
    });

    // Extract timestamps using batch processing with progress updates
    this.temporalManager.setBatchProgressCallback((processed, total, currentBatch, totalBatches) => {
      this.emit('temporal-batch-progress', {
        processed,
        total,
        currentBatch,
        totalBatches,
        phase: 'temporal',
        step: 1,
        totalSteps: 2,
        progress: Math.round((processed / total) * 100)
      });
    });

    // 🎯 PRECISION APPROACH: Use EXIF DateTimeOriginal with SubSecTimeOriginal for accurate temporal clustering
    // This provides millisecond-precision needed for burst mode detection in racing photography
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] 🎯 Extracting EXIF timestamps with subsecond precision for ${imageFiles.length} files...`);
    const filePaths = imageFiles.map(f => f.originalPath);

    // Use EXIF extraction for precise temporal clustering (burst mode detection requires millisecond precision)
    const imageTimestamps = await this.temporalManager.extractTimestampsBatch(filePaths);

    const temporalClusters = this.temporalManager.createClusters(imageTimestamps, this.config.category);

    // Store timestamps in the map for later use during temporal context calculations
    this.imageTimestamps.clear();
    for (const timestamp of imageTimestamps) {
      this.imageTimestamps.set(timestamp.filePath, timestamp);
    }

    // 🚀 FALLBACK: Use filesystem timestamps for processing queue ordering only (keeps speed benefit)
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] 🎯 Extracting filesystem timestamps for processing order optimization...`);
    const filesystemTimestamps = await this.filesystemTimestampExtractor.extractCreationTimes(filePaths);

    // 🎯 MULTI-CAMERA FIX: Riordina la processing queue per filesystem timestamp invece che per nome file
    // Questo approccio è 10x più veloce di ExifTool e funziona per tutti i file (non solo i primi 500)
    const timestampMap = new Map<string, number>();
    filesystemTimestamps.forEach((ft: FileTimestamp) => {
      // Usa filesystem creation time se disponibile, altrimenti Infinity per metterle alla fine
      const timestamp = ft.creationTime ? ft.creationTime.getTime() : Infinity;
      timestampMap.set(ft.filePath, timestamp);
    });

    // Sort processing queue by filesystem creation time instead of alphabetical file name order
    const originalOrder = this.processingQueue.map(f => f.fileName).slice(0, 10); // Sample first 10 for logging
    this.processingQueue.sort((a, b) => {
      const timeA = timestampMap.get(a.originalPath) || Infinity;
      const timeB = timestampMap.get(b.originalPath) || Infinity;
      return timeA - timeB;
    });
    const temporalOrder = this.processingQueue.map(f => f.fileName).slice(0, 10); // Sample first 10 for logging

    if (DEBUG_MODE) console.log(`[UnifiedProcessor] 🚀 Reordered processing queue by filesystem timestamp for optimal multi-camera temporal clustering`);
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Original order (sample): ${originalOrder.join(', ')}`);
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Temporal order (sample): ${temporalOrder.join(', ')}`);
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Successfully processed ${filesystemTimestamps.filter((f: FileTimestamp) => f.creationTime).length}/${filesystemTimestamps.length} filesystem timestamps`);

    // Emit temporal analysis completed event
    this.emit('temporal-analysis-complete', {
      totalImages: this.totalImages,
      processedImages: imageTimestamps.length,
      excludedImages: imageTimestamps.filter(t => t.timestamp === null).length,
      totalClusters: temporalClusters.length,
      phase: 'temporal',
      step: 1,
      totalSteps: 2
    });

    // Connect temporal manager to analysis logger
    if (this.analysisLogger && this.temporalManager) {
      this.temporalManager.setAnalysisLogger(this.analysisLogger);
    }

    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Created ${temporalClusters.length} temporal clusters from ${imageTimestamps.length} filesystem timestamps`);

    // Emit recognition phase started event
    this.emit('recognition-phase-started', {
      totalImages: this.totalImages,
      phase: 'recognition',
      step: 2,
      totalSteps: 2
    });

    const results: UnifiedProcessingResult[] = [];
    // Nuovo sistema di tracciamento worker con ID numerici
    interface WorkerTracker {
      id: number;
      promise: Promise<UnifiedProcessingResult>;
      fileName: string;
      startTime: number;
    }
    
    const activeWorkers = new Map<number, WorkerTracker>();
    let nextWorkerId = 0;
    
    // Verifica token balance per l'intero batch
    const canProcessBatch = await authService.canUseToken(imageFiles.length);
    if (!canProcessBatch) {
      throw new Error(`Token insufficienti per elaborare ${imageFiles.length} immagini`);
    }
    
    // Avvia worker iniziali
    while (activeWorkers.size < this.config.maxConcurrentWorkers && this.processingQueue.length > 0) {
      const imageFile = this.processingQueue.shift()!;
      const workerId = nextWorkerId++;
      const workerPromise = this.processWithWorker(imageFile);
      
      activeWorkers.set(workerId, {
        id: workerId,
        promise: workerPromise,
        fileName: imageFile.fileName,
        startTime: Date.now()
      });
      
      if (DEBUG_MODE) console.log(`[UnifiedProcessor] Started worker ${workerId} for ${imageFile.fileName} (${activeWorkers.size}/${this.config.maxConcurrentWorkers} active)`);
    }
    
    // Processa immagini fino al completamento
    while (activeWorkers.size > 0) {
      // Check for cancellation before processing next batch
      if (this.config.isCancelled && this.config.isCancelled()) {
        console.log(`[UnifiedProcessor] Processing cancelled, awaiting ${activeWorkers.size} in-flight workers before stopping...`);
        // Await all in-flight workers to complete gracefully (don't orphan them)
        try {
          const inFlightPromises = Array.from(activeWorkers.values()).map(tracker =>
            tracker.promise
              .then(result => {
                results.push(result);
                this.processedImages++;
                // Track for pre-auth token system during cancellation too
                if (result.success) { this.trackImageProcessed(); } else { this.trackImageError(); }
              })
              .catch(error => {
                console.warn(`[UnifiedProcessor] In-flight worker for ${tracker.fileName} failed during cancel:`, error);
                this.trackImageError();
              })
          );
          await Promise.allSettled(inFlightPromises);
        } catch (error) {
          console.warn('[UnifiedProcessor] Error awaiting in-flight workers during cancellation:', error);
        }
        activeWorkers.clear();
        console.log(`[UnifiedProcessor] All in-flight workers settled, cancellation complete`);
        break;
      }

      try {
        // Crea promise con ID per identificare quale completa
        const racers = Array.from(activeWorkers.entries()).map(([workerId, tracker]) =>
          tracker.promise.then(result => ({ workerId, result, fileName: tracker.fileName }))
            .catch(error => ({ workerId, result: { success: false, error: error.message, fileName: tracker.fileName } as UnifiedProcessingResult, fileName: tracker.fileName }))
        );
        
        // Race per ottenere il primo worker completato
        const { workerId, result, fileName } = await Promise.race(racers);
        
        // Rimuovi worker completato
        activeWorkers.delete(workerId);
        results.push(result);
        this.processedImages++;

        // Track token consumption for pre-auth system (P0 fix: these were never called!)
        if (result.success) {
          this.trackImageProcessed();
        } else {
          this.trackImageError();
        }

        // Check for ghost vehicle warning and increment counter
        if (result.csvMatch?.ghostVehicleWarning) {
          this.ghostVehicleCount++;
          if (DEBUG_MODE) console.warn(`[UnifiedProcessor] 🚨 Ghost vehicle detected in ${fileName} (${this.ghostVehicleCount} total ghost vehicles so far)`);
        }

        if (DEBUG_MODE) console.log(`[UnifiedProcessor] Worker ${workerId} completed for ${fileName} (${activeWorkers.size} remaining, ${this.processedImages}/${this.totalImages} total)`);

        // Emetti progress
        this.emit('imageProcessed', {
          ...result,
          processed: this.processedImages,
          total: this.totalImages,
          ghostVehicleCount: this.ghostVehicleCount,
          phase: 'recognition',
          step: 2,
          totalSteps: 2,
          progress: Math.round((this.processedImages / this.totalImages) * 100)
        });
        
        // Avvia nuovo worker SOLO se ci sono ancora immagini da processare E la memoria è sotto controllo
        if (this.processingQueue.length > 0) {
          // Monitoraggio memoria e backpressure per grandi batch
          const currentMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
          const memoryUsagePercent = (currentMemoryMB / (require('os').totalmem() / 1024 / 1024)) * 100;

          // Se la memoria è troppo alta, aspetta prima di avviare nuovi worker
          if (memoryUsagePercent > 75) {
            if (DEBUG_MODE) console.warn(`[UnifiedProcessor] High memory usage (${memoryUsagePercent.toFixed(1)}%), pausing new workers and forcing GC`);
            if (global.gc) {
              global.gc();
              await new Promise(resolve => setTimeout(resolve, 100)); // Breve pausa per consentire il GC
            }

            // Ricontrolla la memoria dopo GC
            const afterGCMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
            const afterGCPercent = (afterGCMemoryMB / (require('os').totalmem() / 1024 / 1024)) * 100;

            if (afterGCPercent > 70) {
              if (DEBUG_MODE) console.warn(`[UnifiedProcessor] Memory still high after GC (${afterGCPercent.toFixed(1)}%), reducing active workers`);
              // Non avviare nuovi worker se la memoria è ancora alta
            } else {
              // Avvia nuovo worker solo se la memoria è ora sotto controllo
              const nextImageFile = this.processingQueue.shift()!;
              const newWorkerId = nextWorkerId++;
              const newWorkerPromise = this.processWithWorker(nextImageFile);

              activeWorkers.set(newWorkerId, {
                id: newWorkerId,
                promise: newWorkerPromise,
                fileName: nextImageFile.fileName,
                startTime: Date.now()
              });

              if (DEBUG_MODE) console.log(`[UnifiedProcessor] Started new worker ${newWorkerId} for ${nextImageFile.fileName} (${activeWorkers.size}/${this.config.maxConcurrentWorkers} active, memory: ${afterGCPercent.toFixed(1)}%)`);
            }
          } else {
            // Memoria normale, procedi normalmente
            const nextImageFile = this.processingQueue.shift()!;
            const newWorkerId = nextWorkerId++;
            const newWorkerPromise = this.processWithWorker(nextImageFile);

            activeWorkers.set(newWorkerId, {
              id: newWorkerId,
              promise: newWorkerPromise,
              fileName: nextImageFile.fileName,
              startTime: Date.now()
            });

            if (DEBUG_MODE) console.log(`[UnifiedProcessor] Started new worker ${newWorkerId} for ${nextImageFile.fileName} (${activeWorkers.size}/${this.config.maxConcurrentWorkers} active, memory: ${memoryUsagePercent.toFixed(1)}%)`);
          }
        }
        
        // Garbage collection più frequente ogni 3 immagini per batch grandi, ogni 5 per batch piccoli
        // Più frequente GC per batch molto grandi
        const gcInterval = imageFiles.length > 3000 ? 2 : imageFiles.length > 1000 ? 3 : 5;
        if (this.processedImages % gcInterval === 0) {
          if (global.gc) {
            global.gc();
            if (DEBUG_MODE) console.log(`[UnifiedProcessor] Forced garbage collection after ${this.processedImages} images (interval: ${gcInterval})`);
          }
        }
        
      } catch (error) {
        console.error(`[UnifiedProcessor] Unexpected error in worker management:`, error);
        // Emergency cleanup: rimuovi tutti i worker per prevenire deadlock
        activeWorkers.clear();
        break;
      }
    }
    
    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Batch completed: ${results.length} images processed successfully`);

    // FINAL FLUSH: Send any remaining pending database inserts (ONNX analysis_results)
    if (this.pendingAnalysisInserts.length > 0) {
      console.log(`[Finalize] Flushing ${this.pendingAnalysisInserts.length} remaining analysis_results inserts...`);
      await this.flushPendingInserts();
    }

    // FINAL FLUSH: Send any remaining pending database updates
    if (this.pendingUpdates.length > 0) {
      console.log(`[Finalize] Flushing ${this.pendingUpdates.length} remaining database updates...`);
      await this.flushPendingUpdates();
    }

    // Aggregate RF-DETR metrics from all worker results
    for (const result of results) {
      if (result.success && result.rfDetrDetections !== undefined) {
        this.totalRfDetrDetections += result.rfDetrDetections;
        this.totalRfDetrCost += result.rfDetrCost || 0;

        // Set recognition method from first successful result
        if (!this.recognitionMethod && result.recognitionMethod) {
          this.recognitionMethod = result.recognitionMethod;
        }
      }
    }

    if (this.totalRfDetrDetections > 0) {
      if (DEBUG_MODE) console.log(`[UnifiedProcessor] RF-DETR Total Metrics - Detections: ${this.totalRfDetrDetections}, Total Cost: $${this.totalRfDetrCost.toFixed(4)}`);
    }

    // Finalize analysis logging
    if (this.analysisLogger) {
      const successful = results.filter(r => r.success).length;

      // TIER 1 TELEMETRY: Collect final telemetry stats (optional)
      let performanceBreakdown: any = undefined;
      let memoryStats: any = undefined;
      let networkStats: any = undefined;
      let errorSummary: any = undefined;

      try {
        if (this.performanceTimer) {
          performanceBreakdown = this.performanceTimer.getTimings();
        }

        if (this.networkMonitor) {
          networkStats = this.networkMonitor.getMetrics();

          // Update systemEnvironment.network with final upload speed for backward compatibility
          if (this.systemEnvironment && this.systemEnvironment.network && networkStats.upload_speed_mbps !== undefined) {
            this.systemEnvironment.network.upload_speed_mbps = networkStats.upload_speed_mbps;
            if (DEBUG_MODE) console.log(`[UnifiedProcessor] ✅ Updated system_environment.network with final upload speed: ${networkStats.upload_speed_mbps} Mbps`);
          }
        }

        if (this.errorTracker) {
          errorSummary = this.errorTracker.getErrorSummary();
        }

        // Memory stats
        const currentMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
        memoryStats = {
          peak_mb: currentMemoryMB, // TODO: Track actual peak during execution
          average_mb: currentMemoryMB,
          baseline_mb: currentMemoryMB
        };

        if (DEBUG_MODE) console.log('[UnifiedProcessor] ✅ Final telemetry collected');
      } catch (telemetryError) {
        console.warn('[UnifiedProcessor] ⚠️ Failed to collect final telemetry:', telemetryError);
      }

      // Log execution complete with enhanced telemetry
      this.analysisLogger.logExecutionComplete(
        results.length,
        successful,
        {
          performanceBreakdown,
          memoryStats,
          networkStats,
          errorSummary,
          // Recognition method statistics
          recognitionStats: this.recognitionMethod ? {
            method: this.recognitionMethod,
            rfDetrDetections: this.totalRfDetrDetections > 0 ? this.totalRfDetrDetections : undefined,
            rfDetrCost: this.totalRfDetrCost > 0 ? this.totalRfDetrCost : undefined
          } : undefined
        }
      );

      try {
        const logUrl = await this.analysisLogger.finalize();
        if (DEBUG_MODE) console.log(`[ADMIN] Analysis log available at: ${logUrl || 'upload failed - local only'}`);
      } catch (error) {
        console.error('[ADMIN] Failed to finalize analysis log:', error);
      }

      // UPDATE EXECUTION RECORD IN DATABASE WITH FINAL RESULTS
      try {
        const { getSupabaseClient } = await import('./database-service');
        const { authService: auth } = await import('./auth-service');
        const supabase = getSupabaseClient();
        const authState = auth.getAuthState();
        const currentUserId = authState.isAuthenticated ? authState.user?.id : null;

        if (currentUserId && this.config.executionId) {
          // Get current execution_settings from database
          const { data: currentExecution } = await supabase
            .from('executions')
            .select('execution_settings')
            .eq('id', this.config.executionId)
            .single();

          // Update execution_settings with RF-DETR metrics
          const updatedExecutionSettings = {
            ...(currentExecution?.execution_settings || {}),
            recognition_method: this.recognitionMethod,
            rf_detr_detections_count: this.totalRfDetrDetections,
            rf_detr_total_cost: this.totalRfDetrCost
          };

          const executionUpdate = {
            processed_images: successful,
            status: successful === results.length ? 'completed' : 'completed_with_errors',
            updated_at: new Date().toISOString(),
            // TIER 1 TELEMETRY: Add telemetry fields
            performance_breakdown: performanceBreakdown,
            memory_stats: memoryStats,
            network_stats: networkStats,
            error_summary: errorSummary,
            // Update system_environment with final network speed (backward compatibility)
            system_environment: this.systemEnvironment,
            // Update execution_settings with RF-DETR metrics
            execution_settings: updatedExecutionSettings
          };

          const { error } = await supabase
            .from('executions')
            .update(executionUpdate)
            .eq('id', this.config.executionId)
            .eq('user_id', currentUserId);

          if (error) {
            console.error(`[UnifiedProcessor] ❌ Failed to update execution record:`, error);
          } else {
            if (DEBUG_MODE) console.log(`[UnifiedProcessor] ✅ Execution record updated: ${successful}/${results.length} successful`);
          }
        }
      } catch (updateError) {
        console.error(`[UnifiedProcessor] ❌ Exception updating execution record:`, updateError);
        // Don't fail - this is just metadata
      }
    }

    // Zero results anomaly detection: batch >20 images with 0 recognized numbers
    const successfulResults = results.filter(r => r.success);
    const totalImages = results.length;
    if (totalImages > 20 && successfulResults.length > 0) {
      const hasAnyNumbers = successfulResults.some(r =>
        r.analysis && r.analysis.length > 0 && r.analysis.some((a: any) => a.number)
      );
      if (!hasAnyNumbers) {
        errorTelemetryService.reportCriticalError({
          errorType: 'zero_results',
          severity: 'warning',
          error: `Batch of ${totalImages} images completed with 0 recognized numbers`,
          executionId: this.config.executionId,
          batchPhase: 'batch_complete',
          totalImages,
          categoryName: this.config.category
        });
      }
    }

    this.emit('batchComplete', {
      successful: successfulResults.length,
      errors: results.filter(r => !r.success).length,
      total: totalImages
    });

    return results;
  }

  /**
   * Initialize worker pool for batch processing
   * Pre-creates and initializes workers to avoid redundant ONNX loading
   */
  private async initializeWorkerPool(): Promise<void> {
    if (this.workerPool.length > 0) {
      if (DEBUG_MODE) console.log('[WorkerPool] Pool already initialized, skipping');
      return;
    }

    const poolSize = this.config.maxConcurrentWorkers;
    console.log(`[WorkerPool] Initializing pool with ${poolSize} workers...`);

    const workerConfig = { ...this.config, sportCategories: this.batchSportCategories };
    const workerPromises: Promise<UnifiedImageWorker>[] = [];

    for (let i = 0; i < poolSize; i++) {
      workerPromises.push(UnifiedImageWorker.create(workerConfig, this.analysisLogger, this.networkMonitor));
    }

    this.workerPool = await Promise.all(workerPromises);
    this.availableWorkers = [...this.workerPool];
    this.busyWorkers.clear();

    console.log(`[WorkerPool] ✅ Pool initialized with ${this.workerPool.length} workers (ONNX loaded once per worker)`);
    console.log(`[WorkerPool] Available workers: ${this.availableWorkers.length}, Busy workers: ${this.busyWorkers.size}`);
  }

  /**
   * Get an available worker from the pool
   * Waits if all workers are busy
   */
  private async getWorkerFromPool(): Promise<UnifiedImageWorker> {
    // Safety check: ensure pool was initialized
    if (this.workerPool.length === 0) {
      throw new Error('[WorkerPool] Worker pool not initialized! Call initializeWorkerPool() first.');
    }

    // Wait until a worker becomes available (with timeout protection)
    const maxWaitTime = 300000; // 5 minutes max wait
    const startTime = Date.now();

    while (this.availableWorkers.length === 0) {
      // Check timeout to prevent infinite loop
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`[WorkerPool] Timeout waiting for available worker after ${maxWaitTime}ms. Pool might be deadlocked.`);
      }

      if (DEBUG_MODE) console.log(`[WorkerPool] All workers busy (${this.busyWorkers.size}/${this.workerPool.length}), waiting...`);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before checking again
    }

    const worker = this.availableWorkers.shift()!;
    this.busyWorkers.add(worker);

    if (DEBUG_MODE) console.log(`[WorkerPool] Worker acquired (${this.busyWorkers.size} busy, ${this.availableWorkers.length} available)`);

    return worker;
  }

  /**
   * Return a worker to the pool after processing
   */
  private releaseWorkerToPool(worker: UnifiedImageWorker): void {
    this.busyWorkers.delete(worker);
    this.availableWorkers.push(worker);

    if (DEBUG_MODE) console.log(`[WorkerPool] Worker released (${this.busyWorkers.size} busy, ${this.availableWorkers.length} available)`);
  }

  /**
   * Dispose all workers in the pool
   */
  private disposeWorkerPool(): void {
    if (this.workerPool.length === 0) return;

    console.log(`[WorkerPool] Disposing ${this.workerPool.length} workers...`);

    // Note: UnifiedImageWorker doesn't have a dispose method yet,
    // but we clear the pool references to allow garbage collection
    this.workerPool = [];
    this.availableWorkers = [];
    this.busyWorkers.clear();

    console.log('[WorkerPool] ✅ Worker pool disposed');
  }

  /**
   * Processa una singola immagine con un worker
   */
  private async processWithWorker(imageFile: UnifiedImageFile): Promise<UnifiedProcessingResult> {
    let worker: UnifiedImageWorker;
    let usePool = false;

    if (this.USE_WORKER_POOL && this.workerPool.length > 0) {
      // NEW: Get worker from pool (reuses initialized workers with pre-loaded ONNX)
      // Do this BEFORE incrementing activeWorkers to avoid counter mismatch on error
      worker = await this.getWorkerFromPool();
      usePool = true;
    } else {
      // LEGACY: Create new worker per image (old behavior before worker pool)
      const workerConfig = { ...this.config, sportCategories: this.batchSportCategories };
      worker = await UnifiedImageWorker.create(workerConfig, this.analysisLogger, this.networkMonitor);
    }

    this.activeWorkers++;

    try {
      // Calculate temporal context in main process and pass to worker
      const temporalContext = this.getTemporalContext(imageFile.originalPath);
      const result = await worker.processImage(imageFile, this, temporalContext);

      // BATCH INSERT ACCUMULATION: Collect pending analysis_results inserts from worker (ONNX optimization)
      if (result.pendingAnalysisInsert) {
        this.pendingAnalysisInserts.push(result.pendingAnalysisInsert);
        console.log(`[Processor] Accumulated analysis insert from worker (${this.pendingAnalysisInserts.length} pending)`);

        // PERIODIC FLUSH: Flush inserts every BATCH_INSERT_THRESHOLD images
        if (this.pendingAnalysisInserts.length >= this.BATCH_INSERT_THRESHOLD) {
          console.log(`[Processor] Insert threshold reached (${this.BATCH_INSERT_THRESHOLD}), flushing analysis inserts...`);
          await this.flushPendingInserts();
        }
      }

      // BATCH UPDATE ACCUMULATION: Collect pending updates from worker
      if (result.pendingUpdate) {
        this.pendingUpdates.push(result.pendingUpdate);
        console.log(`[Processor] Accumulated update from worker (${this.pendingUpdates.length} pending)`);

        // PERIODIC FLUSH: Flush updates every BATCH_UPDATE_THRESHOLD images
        if (this.pendingUpdates.length >= this.BATCH_UPDATE_THRESHOLD) {
          console.log(`[Processor] Threshold reached (${this.BATCH_UPDATE_THRESHOLD}), flushing updates...`);
          await this.flushPendingUpdates();
        }
      }

      return result;
    } catch (error) {
      // Log error and re-throw
      console.error(`[WorkerPool] Error processing ${imageFile.fileName}:`, error);
      throw error;
    } finally {
      this.activeWorkers--;
      if (usePool) {
        this.releaseWorkerToPool(worker); // Return worker to pool for reuse
      }
      // If not using pool, worker is discarded (garbage collected)
    }
  }

  /**
   * Aggiorna la configurazione
   * IMPORTANT: Also resets processing counters to fix bug where consecutive analyses
   * showed incorrect totals (e.g., "0 of 18" when only 4 images were loaded)
   */
  updateConfig(newConfig: Partial<UnifiedProcessorConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Reset processing counters for new analysis session
    // This fixes the bug where totalImages from previous analysis caused
    // isChunkProcessing to be incorrectly set to true in processBatch()
    this.totalImages = 0;
    this.processedImages = 0;
    this.ghostVehicleCount = 0;
    this.processingQueue = [];

    // PERFORMANCE: Reset ONNX circuit breaker for new batch
    this.onnxConsecutiveFailures = 0;
    this.onnxCircuitOpen = false;
    this.onnxCircuitBreakerLogged = false;

    if (DEBUG_MODE) console.log(`[UnifiedProcessor] Configuration updated with participantPresetData length: ${this.config.participantPresetData?.length || 0}`);
  }

  /**
   * Ottieni statistiche
   */
  getStats() {
    return {
      activeWorkers: this.activeWorkers,
      queueLength: this.processingQueue.length,
      processed: this.processedImages,
      total: this.totalImages,
      maxWorkers: this.config.maxConcurrentWorkers
    };
  }
}

// Esporta un'istanza singleton
export const unifiedImageProcessor = new UnifiedImageProcessor();