import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { EventEmitter } from 'events';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, APP_CONFIG, RESIZE_PRESETS, ResizePreset } from './config';
import { authService } from './auth-service';
import { getSharp, createImageProcessor } from './utils/native-modules';
import { rawPreviewExtractor } from './utils/raw-preview-native';
import { createXmpSidecar } from './utils/xmp-manager';
import { writeDescriptionToImage, writeKeywordsToImage, writeSpecialInstructions, writeExtendedDescription } from './utils/metadata-writer';
import { CleanupManager } from './utils/cleanup-manager';
import { SmartMatcher, MatchResult, AnalysisResult as SmartMatcherAnalysisResult } from './matching/smart-matcher';
import { CacheManager } from './matching/cache-manager';
import { AnalysisLogger, CorrectionData } from './utils/analysis-logger';
import { TemporalClusterManager, ImageTimestamp } from './matching/temporal-clustering';
import { FilesystemTimestampExtractor, FileTimestamp } from './utils/filesystem-timestamp';
import { HardwareDetector } from './utils/hardware-detector';
import { NetworkMonitor } from './utils/network-monitor';
import { PerformanceTimer } from './utils/performance-timer';
import { ErrorTracker } from './utils/error-tracker';

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
  keywordsMode?: 'append' | 'overwrite'; // How to handle existing keywords
  descriptionMode?: 'append' | 'overwrite'; // How to handle existing description
  enableAdvancedAnnotations?: boolean; // V3 bounding box annotations
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

  private constructor(config: UnifiedProcessorConfig, analysisLogger?: AnalysisLogger, networkMonitor?: NetworkMonitor) {
    super();
    // TEMPORARY: Force V3 bounding box detection to be enabled by default for testing
    if (config.enableAdvancedAnnotations === undefined) {
      config.enableAdvancedAnnotations = true;
      console.log('[UnifiedProcessor] ✅ V3 Bounding Box Detection ENABLED by default');
    }
    this.config = config;
    this.csvData = config.csvData || []; // Legacy support
    this.participantsData = [];
    this.category = config.category || 'motorsport';
    this.cleanupManager = new CleanupManager();
    this.supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
    this.analysisLogger = analysisLogger;
    this.networkMonitor = networkMonitor;

    // DEBUG: Log the full config to trace participant preset data
    console.log(`[UnifiedWorker] Constructor called with config:`, {
      participantPresetDataLength: config.participantPresetData?.length || 0,
      csvDataLength: config.csvData?.length || 0,
      category: config.category,
      executionId: config.executionId
    });

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
    return worker;
  }

  /**
   * Initialize participants data from preset
   */
  private async initializeParticipantsData() {
    console.log(`[UnifiedWorker] initializeParticipantsData called with participantPresetData length: ${this.config.participantPresetData?.length || 0}`);

    if (this.config.participantPresetData && this.config.participantPresetData.length > 0) {
      // Use participant data passed directly from frontend
      this.participantsData = this.config.participantPresetData;
      console.log(`[UnifiedWorker] Using participant data passed from frontend: ${this.participantsData.length} participants`);
      console.log(`[UnifiedWorker] Sample participant:`, this.participantsData[0]);
    } else if (this.config.csvData && this.config.csvData.length > 0) {
      // Fallback to legacy CSV data
      this.participantsData = this.config.csvData;
      console.log(`[UnifiedWorker] Using legacy CSV data: ${this.participantsData.length} participants`);
    } else {
      console.log(`[UnifiedWorker] No participant data provided, skipping participant loading`);
    }
  }

  /**
   * Initialize sport configurations from Supabase sport categories
   */
  private async initializeSportConfigurations() {
    console.log(`[UnifiedWorker] Initializing sport configurations from Supabase...`);

    try {
      // Get sport categories from Supabase
      const { data: sportCategories, error } = await this.supabase
        .from('sport_categories')
        .select('*')
        .eq('is_active', true);

      if (error) {
        console.warn(`[UnifiedWorker] Failed to load sport categories from Supabase:`, error);
        console.log(`[UnifiedWorker] Using default hardcoded configurations`);
        return;
      }

      if (!sportCategories || sportCategories.length === 0) {
        console.warn(`[UnifiedWorker] No sport categories found in Supabase`);
        console.log(`[UnifiedWorker] Using default hardcoded configurations`);
        return;
      }

      console.log(`[UnifiedWorker] Loaded ${sportCategories.length} sport categories from Supabase`);

      // Store categories for later use
      this.sportCategories = sportCategories;

      // Find current category config
      this.currentSportCategory = sportCategories.find(
        (cat: any) => cat.code.toLowerCase() === this.category.toLowerCase()
      );

      // Determine smart default based on category
      const smartDefault = ['running', 'cycling', 'triathlon'].includes(this.category.toLowerCase()) ? true : false;

      console.log(`[UnifiedWorker] Current sport category config:`, {
        category: this.category,
        individual_competition: this.currentSportCategory?.individual_competition ?? smartDefault,
        categoryFound: !!this.currentSportCategory,
        smartDefault: smartDefault
      });

      // Initialize SmartMatcher configurations from Supabase data
      if (this.smartMatcher) {
        this.smartMatcher.initializeFromSportCategories(sportCategories);
        console.log(`[UnifiedWorker] SmartMatcher configurations updated from Supabase`);
      }

      console.log(`[UnifiedWorker] Sport configurations initialization completed`);
    } catch (error) {
      console.error(`[UnifiedWorker] Error initializing sport configurations:`, error);
      console.log(`[UnifiedWorker] Falling back to default hardcoded configurations`);
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
      minConfidence: 0.7,
      confidenceDecayFactor: 0.9,
      relativeConfidenceGap: 0.3,
      focusMode: 'auto',
      ignoreBackground: true,
      prioritizeForeground: true
    };

    console.log(`[UnifiedWorker] Using recognition config for ${this.category}:`, recognitionConfig);

    // 1. Filter out low confidence results using dynamic threshold
    let validResults = analysis.filter(r =>
      (r.confidence || 0) >= recognitionConfig.minConfidence
    );

    console.log(`[UnifiedWorker] After confidence filter (>=${recognitionConfig.minConfidence}): ${validResults.length} results`);

    if (validResults.length === 0) return [];

    // 2. Sort by confidence (highest first)
    validResults.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    // 3. Apply confidence decay and relative gap filtering for multiple results
    if (validResults.length > 1 && !isIndividual) {
      const bestConfidence = validResults[0].confidence || 0;
      console.log(`[UnifiedWorker] Best confidence: ${bestConfidence}, applying decay and gap filtering`);

      validResults = validResults.filter((r, index) => {
        if (index === 0) return true; // Always keep the best

        // Apply confidence decay factor
        const decayedConfidence = (r.confidence || 0) * Math.pow(recognitionConfig.confidenceDecayFactor, index);

        // Check if it's within acceptable gap from best
        const confidenceGap = bestConfidence - (r.confidence || 0);
        const withinGap = confidenceGap <= recognitionConfig.relativeConfidenceGap;

        console.log(`[UnifiedWorker] Result ${index}: confidence=${r.confidence}, decayed=${decayedConfidence.toFixed(3)}, gap=${confidenceGap.toFixed(3)}, withinGap=${withinGap}`);

        return withinGap && decayedConfidence >= recognitionConfig.minConfidence;
      });

      console.log(`[UnifiedWorker] After decay and gap filtering: ${validResults.length} results`);
    }

    // 4. Apply individual competition rule (overrides maxResults)
    if (isIndividual && validResults.length > 1) {
      console.log(`[UnifiedWorker] Individual competition mode: keeping only the best result`);
      validResults = [validResults[0]]; // Take only the best
    }

    // 5. Apply maximum results limit based on category configuration
    const maxResults = isIndividual ? 1 : recognitionConfig.maxResults;
    if (validResults.length > maxResults) {
      console.log(`[UnifiedWorker] Limiting results to ${maxResults} (was ${validResults.length})`);
      validResults = validResults.slice(0, maxResults);
    }

    console.log(`[UnifiedWorker] Final filtering result: ${validResults.length} valid results for ${this.category} (individual: ${isIndividual})`);

    return validResults;
  }

  /**
   * Controlla se il processing è stato cancellato
   */
  private checkCancellation(): boolean {
    if (this.config.isCancelled && this.config.isCancelled()) {
      console.log(`[UnifiedWorker] Processing cancellation detected`);
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

    console.log(`[UnifiedWorker] Starting unified processing of ${imageFile.fileName}`);

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

    try {
      // Fase 1: Preparazione dell'immagine per upload (RAW→JPEG o compressione JPEG)
      const uploadReadyPath = await this.prepareImageForUpload(imageFile);

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
        console.log(`[UnifiedWorker] Tracking upload-ready file: ${uploadReadyPath} (ID: ${uploadReadyFileId})`);
      }
      
      // Fase 2: Compressione per garantire <500KB
      const { compressedPath, buffer, mimeType } = await this.compressForUpload(uploadReadyPath, imageFile.fileName);

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
      if (compressedPath !== uploadReadyPath) {
        // compressedFileId = await this.cleanupManager.trackTempFile(compressedPath, 'jpeg');
        console.log(`[UnifiedWorker] NOT tracking compressed file for preservation: ${compressedPath}`);
      }

      // Fase 2.5: Genera thumbnail multi-livello per performance ottimizzata
      // PERFORMANCE OPTIMIZATION: Pass compressed buffer to avoid re-reading from disk
      const { thumbnailPath, microThumbPath } = await this.generateThumbnails(compressedPath, imageFile.fileName, buffer);

      // Track thumbnail files
      if (thumbnailPath) {
        thumbnailFileId = await this.cleanupManager.trackTempFile(thumbnailPath, 'other');
        console.log(`[UnifiedWorker] Tracking thumbnail file: ${thumbnailPath} (ID: ${thumbnailFileId})`);
      }
      if (microThumbPath) {
        microThumbFileId = await this.cleanupManager.trackTempFile(microThumbPath, 'other');
        console.log(`[UnifiedWorker] Tracking micro-thumbnail file: ${microThumbPath} (ID: ${microThumbFileId})`);
      }

      // Fase 3: Upload su Supabase Storage
      const storagePath = await this.uploadToStorage(imageFile.fileName, buffer, mimeType);

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

      // Fase 4: Analisi AI
      const analysisResult = await this.analyzeImage(imageFile.fileName, storagePath, buffer.length, mimeType);

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
      
      // PUNTO DI CONVERGENZA POST-AI: Qui tutti i workflow si incontrano
      const processedAnalysis = await this.processAnalysisResults(
        imageFile,
        analysisResult,
        uploadReadyPath,
        processor,
        temporalContext
      );

      // Log detailed analysis with corrections if logger is available (now supports multi-vehicle)
      if (this.analysisLogger && this.smartMatcher) {
        const corrections = this.smartMatcher.getCorrections();
        const supabaseUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storagePath}`;

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

            // Debug only for the first image to verify fix
            if (index === 0) {
              console.log(`🎯 [TEMPORAL FIX] Vehicle ${index} extracted temporal data:`, {
                temporalBonus,
                temporalClusterSize,
                isBurstModeCandidate,
                source: 'csvMatch.matchResult.bestMatch'
              });
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
            boundingBox: vehicle.boundingBox ? {
              x: vehicle.boundingBox.x,
              y: vehicle.boundingBox.y,
              width: vehicle.boundingBox.width,
              height: vehicle.boundingBox.height
            } : undefined,
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

        this.analysisLogger.logImageAnalysis({
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
          // Backward compatibility - use first vehicle as primary
          primaryVehicle: vehicles.length > 0 ? vehicles[0] : undefined
        });

        console.log(`[UnifiedWorker] Logged filtered analysis for ${imageFile.fileName}: ${vehicles.length} vehicles (filtered from ${(analysisResult.analysis || []).length} original)`);
      }
      
      // Fase 5: Scrittura dei metadata (XMP per RAW, IPTC per JPEG) con dual-mode system
      await this.writeMetadata(imageFile, processedAnalysis.keywords, uploadReadyPath, processedAnalysis.analysis, processedAnalysis.csvMatch);
      
      // ADMIN FEATURE: Fase 6 - Organizzazione in cartelle (condizionale)
      await this.organizeToFolders(imageFile, processedAnalysis, uploadReadyPath);
      
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
        microThumbPath
      };
      
      console.log(`[UnifiedWorker] Successfully processed ${imageFile.fileName} in ${result.processingTimeMs}ms`);
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
      console.log(`[UnifiedWorker] Cleaning up temporary files for ${imageFile.fileName}`);
      
      try {
        // 🖼️ PRESERVE THUMBNAILS: Don't cleanup thumbnails immediately to allow viewing in results page
        // They will be cleaned up later by the periodic cleanup or on app exit
        console.log(`[UnifiedWorker] 🖼️ PRESERVING thumbnails for ${imageFile.fileName} - not cleaning up immediately`);

        // Only cleanup upload-ready files (compressed files are preserved for gallery viewing)
        if (uploadReadyFileId) {
          await this.cleanupManager.cleanupFile(uploadReadyFileId);
        }

        console.log(`[UnifiedWorker] Cleanup completed for ${imageFile.fileName}`);
      } catch (cleanupError) {
        console.error(`[UnifiedWorker] Cleanup error for ${imageFile.fileName}:`, cleanupError);
        // Don't throw cleanup errors, just log them
      }
    }
  }

  /**
   * Fase 1: Prepara l'immagine per l'upload - estrazione preview per RAW, copia per JPEG
   */
  private async prepareImageForUpload(imageFile: UnifiedImageFile): Promise<string> {
    if (imageFile.isRaw) {
      console.log(`[UnifiedWorker] Extracting preview from RAW file ${imageFile.fileName} using raw-preview-extractor`);
      
      // Use centralized temp directory instead of original image directory
      const tempJpegPath = this.cleanupManager.generateTempPath(
        imageFile.originalPath,
        'preview',
        '.jpg',
        'jpeg-processing'
      );
      
      try {
        // Estrazione preview veloce con raw-preview-extractor
        const previewResult = await rawPreviewExtractor.extractPreview(imageFile.originalPath, {
          targetMinSize: 200 * 1024,     // 200KB min
          targetMaxSize: 2 * 1024 * 1024, // 2MB max
          timeout: 10000,                  // 10s timeout
          preferQuality: 'preview',        // Usa preview embedded
          includeMetadata: true,           // Include metadata EXIF
          useNativeLibrary: true          // Priorità a libreria nativa
        });
        
        if (!previewResult.success || !previewResult.data) {
          throw new Error(previewResult.error || 'Preview extraction failed');
        }
        
        console.log(`[UnifiedWorker] ✅ RAW preview extracted successfully: ${previewResult.data.length} bytes via ${previewResult.method}`);
        console.log(`[UnifiedWorker] Extraction time: ${previewResult.extractionTimeMs}ms`);

        // Salva la preview estratta come file temporaneo JPEG
        await fsPromises.writeFile(tempJpegPath, previewResult.data);

        // MEMORY FIX: Rilascia esplicitamente il Buffer della preview per evitare accumulo memoria
        const previewBufferSize = previewResult.data.length;
        previewResult.data = null as any; // Nullifica reference per permettere GC
        console.log(`[UnifiedWorker] 🧹 Released preview buffer (${previewBufferSize} bytes)`);

        // Forza garbage collection per Buffer grandi (>1MB)
        if (previewBufferSize > 1024 * 1024 && global.gc) {
          global.gc();
          const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
          console.log(`[UnifiedWorker] 🔄 Forced GC after ${(previewBufferSize/1024/1024).toFixed(1)}MB buffer release, heap: ${memoryMB.toFixed(0)}MB`);
        }
        
        // Applica rotazione automatica basata sui metadata EXIF se disponibili
        if (previewResult.metadata?.orientation && previewResult.metadata.orientation !== 1) {
          console.log(`[UnifiedWorker] Applying EXIF rotation (orientation: ${previewResult.metadata.orientation}) to RAW preview`);
          try {
            const processor = await createImageProcessor(tempJpegPath);
            let rotatedBuffer = await processor
              .rotate()  // Auto-rotate based on EXIF orientation data
              .jpeg({ quality: 90 })  // Maintain good quality
              .toBuffer();
            
            // Scrivi l'immagine ruotata sovrascrivendo il file temporaneo
            await fsPromises.writeFile(tempJpegPath, rotatedBuffer);

            // MEMORY FIX: Rilascia esplicitamente il Buffer di rotazione
            const rotatedBufferSize = rotatedBuffer.length;
            rotatedBuffer = null as any; // Nullifica reference per permettere GC
            console.log(`[UnifiedWorker] ✅ RAW preview rotated successfully, released rotation buffer (${rotatedBufferSize} bytes)`);

            // Forza garbage collection per Buffer grandi (>1MB)
            if (rotatedBufferSize > 1024 * 1024 && global.gc) {
              global.gc();
              const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
              console.log(`[UnifiedWorker] 🔄 Forced GC after ${(rotatedBufferSize/1024/1024).toFixed(1)}MB rotation buffer release, heap: ${memoryMB.toFixed(0)}MB`);
            }
          } catch (rotationError) {
            console.warn(`[UnifiedWorker] ⚠️ Failed to apply rotation to RAW preview: ${rotationError}`);
            // Non bloccare il processo se la rotazione fallisce
          }
        }
        
        return tempJpegPath;
        
      } catch (error) {
        console.error(`[UnifiedWorker] RAW preview extraction failed for ${imageFile.fileName}:`, error);
        throw error;
      }
    } else {
      // PERFORMANCE OPTIMIZATION: Use JPEG directly without creating unnecessary temporary copy
      // Sharp can read the original file safely without modifying it
      console.log(`[UnifiedWorker] Using JPEG file directly for processing: ${imageFile.fileName}`);
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
    console.log(`[UnifiedWorker] Compressing ${fileName} to ensure <${this.config.maxImageSizeKB}KB`);

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
    // Empirical formula: fileSize ≈ (megapixels * quality * 12000) bytes
    // With mozjpeg optimization, this factor can be reduced to ~10000
    const estimatedQuality = Math.round((maxSizeBytes / (megapixels * 10000)) * 100);
    const initialQuality = Math.max(30, Math.min(95, estimatedQuality));

    console.log(`[UnifiedWorker] Predictive compression for ${fileName}:`);
    console.log(`  - Original: ${originalWidth}x${originalHeight}px (${(originalWidth * originalHeight / 1_000_000).toFixed(1)}MP)`);
    console.log(`  - Target: ${targetWidth}x${targetHeight}px (${megapixels.toFixed(1)}MP)`);
    console.log(`  - Calculated quality: ${initialQuality} (target: <${this.config.maxImageSizeKB}KB)`);

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
      console.log(`[UnifiedWorker] Predictive compression result: ${compressedBuffer.length} bytes (${(compressedBuffer.length / 1024).toFixed(1)}KB)`);

      // If predictive compression succeeded within target, we're done!
      if (compressedBuffer.length <= maxSizeBytes) {
        console.log(`[UnifiedWorker] ✅ Predictive compression succeeded on first attempt!`);
      } else {
        // Fallback to binary search if prediction overshot
        console.log(`[UnifiedWorker] Predictive compression overshot target, using binary search fallback...`);
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

    console.log(`[UnifiedWorker] ✅ Compressed ${fileName}: ${compressedBuffer.length} bytes (${(compressedBuffer.length / 1024).toFixed(1)}KB, attempts: ${compressionAttempts})`);

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

    console.log(`[UnifiedWorker] Starting binary search compression (quality range: ${minQuality}-${maxQuality})`);

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

      console.log(`[UnifiedWorker] Binary search attempt ${attempts}: quality=${quality}, size=${buffer.length} bytes (${(buffer.length / 1024).toFixed(1)}KB)`);

      if (buffer.length <= maxSizeBytes) {
        bestBuffer = buffer;
        minQuality = quality; // File small enough, try higher quality
      } else {
        maxQuality = quality; // File too large, reduce quality
      }
    }

    if (!bestBuffer) {
      // Last resort: use minimum quality
      console.log(`[UnifiedWorker] Binary search failed, using minimum quality ${minQuality}`);
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

    console.log(`[UnifiedWorker] Binary search completed: final size=${bestBuffer.length} bytes (${(bestBuffer.length / 1024).toFixed(1)}KB, total attempts: ${attempts})`);
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
    console.log(`[UnifiedWorker] Generating multi-level thumbnails for ${fileName}`);

    let thumbnailPath: string | null = null;
    let microThumbPath: string | null = null;

    try {
      // Use provided buffer or read from disk as fallback
      const imageBuffer = compressedBuffer || await fsPromises.readFile(compressedPath);

      if (compressedBuffer) {
        console.log(`[UnifiedWorker] ✅ Using in-memory buffer for thumbnail generation (${(compressedBuffer.length / 1024).toFixed(1)}KB)`);
      } else {
        console.log(`[UnifiedWorker] ⚠️ Reading compressed file from disk for thumbnail generation`);
      }

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
            console.log(`[UnifiedWorker] ✅ Thumbnail created: ${(thumbnailBuffer.length / 1024).toFixed(1)}KB`);
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
            console.log(`[UnifiedWorker] ✅ Micro-thumbnail created: ${(microBuffer.length / 1024).toFixed(1)}KB`);
            return microPath;
          } catch (microError) {
            console.error(`[UnifiedWorker] Failed to create micro-thumbnail for ${fileName}:`, microError);
            return null;
          }
        })()
      ]);

      thumbnailPath = thumbnailResult;
      microThumbPath = microResult;

      console.log(`[UnifiedWorker] Thumbnail generation completed for ${fileName}`);

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
        console.warn(`[UnifiedWorker] Unknown mimeType ${mimeType}, using extension: ${fileExt}`);
    }

    const storageFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;

    // Log quando l'estensione viene cambiata per tracciabilità
    const originalExt = fileName.split('.').pop()?.toLowerCase();
    if (originalExt !== fileExt) {
      console.log(`[UnifiedWorker] Extension conversion: ${fileName} (${originalExt}) → storage as .${fileExt} (${mimeType})`);
    }
    
    console.log(`[UnifiedWorker] Uploading ${fileName} to storage (${(buffer.length / 1024).toFixed(1)}KB)...`);

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
    
    console.log(`[UnifiedWorker] Upload completed: ${fileName} -> ${storageFileName}`);
    console.log(`[UnifiedWorker] Public URL: ${publicUrl}`);
    return storageFileName;
  }

  /**
   * Fase 4: Analisi AI (riuso da parallel-analyzer)
   */
  private async analyzeImage(fileName: string, storagePath: string, sizeBytes: number, mimeType: string): Promise<any> {
    console.log(`[UnifiedWorker] Analyzing ${fileName}...`);
    
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
      console.log(`[UnifiedWorker] Sending participant preset with ${this.participantsData.length} participants to edge function`);
    }

    // Determine which Edge Function to use based on sport category edge_function_version or fallback to settings
    let functionName: string;

    if (this.currentSportCategory?.edge_function_version) {
      // Use sport category's edge_function_version if available
      const version = this.currentSportCategory.edge_function_version;
      if (version === 4) {
        functionName = 'analyzeImageDesktopV4';
      } else if (version === 3) {
        functionName = 'analyzeImageDesktopV3';
      } else if (version === 2) {
        functionName = 'analyzeImageDesktopV2';
      } else {
        // Version 1 or unknown - fallback to V2
        functionName = 'analyzeImageDesktopV2';
        console.warn(`[UnifiedProcessor] Unknown edge_function_version ${version} for category ${this.category}, using V2`);
      }
      console.log(`[UnifiedProcessor] Using Edge Function ${functionName} based on sport category version ${version}`);
    } else {
      // Fallback to config setting if no version specified in category
      functionName = this.config.enableAdvancedAnnotations
        ? 'analyzeImageDesktopV3'
        : 'analyzeImageDesktopV2';
      console.log(`[UnifiedProcessor] Using Edge Function ${functionName} based on enableAdvancedAnnotations setting`);
    }

    console.log(`🔥 [UnifiedProcessor] About to call ${functionName} for ${fileName} with userId: ${userId}, executionId: ${this.config.executionId || 'none'}`);

    let response: any;
    try {
      response = await Promise.race([
        this.supabase.functions.invoke(functionName, { body: invokeBody }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Function invocation timeout')), 60000)
        )
      ]) as any;

      console.log(`🔥 [UnifiedProcessor] ${functionName} response for ${fileName}:`, {
        hasError: !!response.error,
        hasData: !!response.data,
        dataSuccess: response.data?.success,
        dataImageId: response.data?.imageId,
        dataKeys: response.data ? Object.keys(response.data) : []
      });

      if (response.error) {
        console.error(`🔥 [UnifiedProcessor] ${functionName} function error for ${fileName}:`, response.error);
        console.error(`🔥 [UnifiedProcessor] Full response data for debugging:`, response.data);
        console.error(`🔥 [UnifiedProcessor] Error details - name:`, response.error.name);
        console.error(`🔥 [UnifiedProcessor] Error details - message:`, response.error.message);
        console.error(`🔥 [UnifiedProcessor] Error details - status:`, response.error.status);
        console.error(`🔥 [UnifiedProcessor] Error details - statusText:`, response.error.statusText);
        console.error(`🔥 [UnifiedProcessor] Error details - details:`, response.error.details);
        throw new Error(`Function error: ${response.error.message || response.error.statusText || 'Unknown error'}`);
      }
    } catch (edgeFunctionError: any) {
      console.error(`🔥 [UnifiedProcessor] Edge Function call failed for ${fileName} with catch error:`, edgeFunctionError);
      console.error(`🔥 [UnifiedProcessor] Catch error type:`, typeof edgeFunctionError);
      console.error(`🔥 [UnifiedProcessor] Catch error name:`, edgeFunctionError.name);
      console.error(`🔥 [UnifiedProcessor] Catch error message:`, edgeFunctionError.message);
      console.error(`🔥 [UnifiedProcessor] Catch error stack:`, edgeFunctionError.stack);

      // Check if this is a FunctionsHttpError with more details
      if (edgeFunctionError.context) {
        console.error(`🔥 [UnifiedProcessor] FunctionsHttpError context:`, edgeFunctionError.context);
      }
      if (edgeFunctionError.details) {
        console.error(`🔥 [UnifiedProcessor] FunctionsHttpError details:`, edgeFunctionError.details);
      }
      if (edgeFunctionError.status) {
        console.error(`🔥 [UnifiedProcessor] HTTP status:`, edgeFunctionError.status);
      }

      throw new Error(`Edge Function failed: ${edgeFunctionError.message || 'Network or server error'}`);
    }
    
    if (!response.data.success) {
      console.error(`🔥 [UnifiedProcessor] Analysis failed for ${fileName}:`, response.data.error);
      throw new Error(`Analysis failed: ${response.data.error || 'Unknown function error'}`);
    }
    
    // Registra l'utilizzo del token
    console.log(`🔥 [UnifiedProcessor] About to call useTokens for ${fileName} - userId: ${userId}, imageId: ${response.data.imageId}`);
    if (userId) {
      if (!response.data.imageId) {
        console.warn(`🔥 [UnifiedProcessor] WARNING: No imageId in response for ${fileName}, but still calling useTokens`);
      }
      await authService.useTokens(1, response.data.imageId, this.config.onTokenUsed);
      console.log(`🔥 [UnifiedProcessor] useTokens call completed for ${fileName}`);
    } else {
      console.warn(`🔥 [UnifiedProcessor] WARNING: No userId available, skipping useTokens for ${fileName}`);
    }
    
    console.log(`[UnifiedWorker] Analysis completed: ${fileName}`);

    // DEBUG: Log the response data structure to identify analysis field issues
    console.log(`🔥 [UnifiedWorker] DEBUG response.data structure for ${fileName}:`, {
      hasData: !!response.data,
      dataKeys: response.data ? Object.keys(response.data) : [],
      hasAnalysis: !!response.data?.analysis,
      analysisType: typeof response.data?.analysis,
      analysisLength: Array.isArray(response.data?.analysis) ? response.data.analysis.length : 'not array',
      analysisContent: response.data?.analysis ? JSON.stringify(response.data.analysis) : 'undefined/null'
    });

    return response.data;
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
    temporalContext?: { imageTimestamp: ImageTimestamp; temporalNeighbors: ImageTimestamp[] } | null
  ): Promise<{
    analysis: any[];
    csvMatch: any | null;
    description: string | null;
    keywords: string[] | null;
  }> {
    console.log(`[UnifiedWorker] Processing AI results for ${imageFile.fileName} at convergence point`);
    console.log(`[UnifiedWorker] Analysis result:`, JSON.stringify(analysisResult, null, 2));
    console.log(`[UnifiedWorker] analysisResult.analysis type:`, typeof analysisResult.analysis);
    console.log(`[UnifiedWorker] analysisResult.analysis length:`, analysisResult.analysis?.length);
    console.log(`[UnifiedWorker] Available CSV data: ${this.csvData.length} rows`);
    console.log(`[UnifiedWorker] Available participants data: ${this.participantsData.length} participants`);

    // DEBUG: More detailed analysis data structure logging
    console.log(`🔥 [UnifiedWorker] DEBUG analysisResult structure for ${imageFile.fileName}:`, {
      hasAnalysisResult: !!analysisResult,
      analysisResultKeys: analysisResult ? Object.keys(analysisResult) : [],
      hasAnalysisField: !!analysisResult.analysis,
      analysisFieldType: typeof analysisResult.analysis,
      analysisIsArray: Array.isArray(analysisResult.analysis),
      analysisFieldContent: analysisResult.analysis ? JSON.stringify(analysisResult.analysis) : 'undefined/null'
    });

    let csvMatch: any = null;
    let description: string | null = null;

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

      if (originalCount !== analysisResult.analysis.length) {
        console.log(`[UnifiedWorker] Filtered recognitions from ${originalCount} to ${analysisResult.analysis.length} for ${this.category} (individual=${isIndividual})`);
      }

      // Enhanced intelligent matching using SmartMatcher with temporal context for ALL vehicles
      const csvMatches = await this.findIntelligentMatches(analysisResult.analysis, imageFile, processor, temporalContext);

      // Costruisci i keywords usando la logica esistente (utilizzeremo tutti i matches)
      const keywords = this.buildMetatag(analysisResult.analysis, csvMatches);
      description = keywords && keywords.length > 0 ? keywords.join(', ') : null; // Backward compatibility

      console.log(`[UnifiedWorker] Generated keywords at convergence point for ${analysisResult.analysis.length} vehicles: ${keywords}`);

      // Store all matches for further processing
      csvMatch = csvMatches;
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

        console.log(`[UnifiedWorker] Filtered csvMatch array from ${csvMatch.length} to ${filteredCsvMatch.length} entries (preset mode)`);
      }
    }

    // DEBUG: Log data flow for N/A issue investigation
    console.log(`[UnifiedWorker] Data flow debug for ${imageFile.fileName}:`);
    console.log(`[UnifiedWorker] - Original analysis:`, analysisResult.analysis);
    console.log(`[UnifiedWorker] - CSV matches:`, csvMatch);
    console.log(`[UnifiedWorker] - Filtered CSV matches:`, filteredCsvMatch);
    console.log(`[UnifiedWorker] - Corrected analysis:`, correctedAnalysis);

    return {
      analysis: correctedAnalysis,
      csvMatch: filteredCsvMatch,
      description,
      keywords: this.buildMetatag(correctedAnalysis, filteredCsvMatch) // Use filtered data for keywords
    };
  }

  /**
   * Fase 5: Scrittura metadata usando dual-mode system (Keywords + ExtendedDescription)
   */
  private async writeMetadata(imageFile: UnifiedImageFile, keywords: string[] | null, processedImagePath: string, analysis?: any[], csvMatch?: any): Promise<void> {
    if (!keywords || keywords.length === 0) {
      console.log(`[UnifiedWorker] No keywords to write for ${imageFile.fileName}`);
      return;
    }

    console.log(`[UnifiedWorker] Writing metadata for ${imageFile.fileName}: ${keywords.length} keywords - ${keywords.join(', ')}`);

    // Generate formatted data for ExtendedDescription
    const extendedDescriptionData = this.buildExtendedDescription(analysis || [], csvMatch);
    console.log(`[UnifiedWorker] DEBUG - extendedDescriptionData result: ${extendedDescriptionData ? `"${extendedDescriptionData}"` : 'NULL'}`);
    console.log(`[UnifiedWorker] DEBUG - csvMatch type: ${Array.isArray(csvMatch) ? 'Array' : typeof csvMatch}, isRaw: ${imageFile.isRaw}`);

    if (imageFile.isRaw) {
      // Per i file RAW, crea un file XMP sidecar con keywords e descrizione
      console.log(`[UnifiedWorker] Creating XMP sidecar for RAW file: ${imageFile.originalPath}`);
      await createXmpSidecar(imageFile.originalPath, keywords, extendedDescriptionData || undefined);
    } else {
      // Per i file non-RAW, scrivi sia Keywords semplificati che ExtendedDescription
      console.log(`[UnifiedWorker] Writing dual metadata to JPEG file: ${imageFile.originalPath}`);

      // Write complete keywords (same as XMP format)
      console.log(`[UnifiedWorker] Writing complete keywords to IPTC:Keywords`);
      const keywordsMode = this.config.keywordsMode || 'append';
      await writeKeywordsToImage(imageFile.originalPath, keywords, false, keywordsMode); // false = use complete format like XMP

      // Write formatted data to ExtendedDescription (only if participant preset provided data)
      if (extendedDescriptionData) {
        console.log(`[UnifiedWorker] ✅ CALLING writeExtendedDescription with: "${extendedDescriptionData}"`);
        const descriptionMode = this.config.descriptionMode || 'append';
        await writeExtendedDescription(imageFile.originalPath, extendedDescriptionData, descriptionMode);
        console.log(`[UnifiedWorker] ✅ writeExtendedDescription COMPLETED for ${imageFile.fileName}`);
      } else {
        console.log(`[UnifiedWorker] ❌ SKIPPING writeExtendedDescription - extendedDescriptionData is NULL`);
      }
    }
  }

  /**
   * Apply SmartMatcher corrections to analysis results for UI display
   * This ensures the UI table shows corrected data instead of raw Gemini results
   * Now processes ALL vehicles in the analysis, not just the first one
   */
  private applyCorrectionsToAnalysis(originalAnalysis: any[], csvMatches: any[]): any[] {
    if (!originalAnalysis || originalAnalysis.length === 0) {
      console.log(`[UnifiedWorker] No analysis data to correct`);
      return originalAnalysis;
    }

    if (!csvMatches || csvMatches.length === 0) {
      console.log(`[UnifiedWorker] No SmartMatcher corrections available, returning original analysis`);
      console.log(`[UnifiedWorker] DEBUG - Original analysis being returned:`, originalAnalysis);
      return originalAnalysis;
    }

    console.log(`[UnifiedWorker] Applying SmartMatcher corrections to analysis data for UI display`);
    console.log(`[UnifiedWorker] Processing ${originalAnalysis.length} vehicles with ${csvMatches.length} matches available`);

    // Create corrected copy of analysis array
    const correctedAnalysis = originalAnalysis.map((vehicle, index) => {
      const csvMatch = csvMatches[index]; // Get match for this specific vehicle

      if (!csvMatch || !csvMatch.entry) {
        const isUsingParticipantPreset = this.participantsData.length > 0;

        if (isUsingParticipantPreset) {
          // When using a preset and no match found, filter out this vehicle
          console.log(`[UnifiedWorker] No match found for vehicle ${index} (preset mode), filtering out result`);
          return null; // Return null to filter out this vehicle when using preset
        } else {
          // When not using preset, keep original behavior (show all AI recognitions)
          console.log(`[UnifiedWorker] No match found for vehicle ${index} (free mode), returning original data`);
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
          console.log(`[UnifiedWorker] Vehicle ${index}: Correcting race number: ${correctedVehicle.raceNumber} → ${correctedNumber}`);
          correctedVehicle.raceNumber = correctedNumber;
          corrections.raceNumber = true;
        }
      }

      // Apply driver corrections
      const correctedDrivers: string[] = [];
      if (participant.nome_pilota) correctedDrivers.push(participant.nome_pilota);
      if (participant.nome_navigatore) correctedDrivers.push(participant.nome_navigatore);
      if (participant.nome_terzo) correctedDrivers.push(participant.nome_terzo);
      if (participant.nome_quarto) correctedDrivers.push(participant.nome_quarto);

      // Fallback to legacy CSV format
      if (correctedDrivers.length === 0 && participant.nome) {
        correctedDrivers.push(participant.nome);
      }

      if (correctedDrivers.length > 0) {
        const originalDrivers = vehicle.drivers || [];
        const driversChanged = JSON.stringify(originalDrivers.sort()) !== JSON.stringify(correctedDrivers.sort());
        if (driversChanged) {
          console.log(`[UnifiedWorker] Vehicle ${index}: Correcting drivers: [${originalDrivers.join(', ')}] → [${correctedDrivers.join(', ')}]`);
          correctedVehicle.drivers = correctedDrivers;
          corrections.drivers = true;
        }
      }

      // Apply team correction
      if (participant.squadra) {
        const originalTeam = vehicle.teamName || '';
        if (originalTeam !== participant.squadra) {
          console.log(`[UnifiedWorker] Vehicle ${index}: Correcting team: "${originalTeam}" → "${participant.squadra}"`);
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

    // Log filtering statistics
    const filteredCount = correctedAnalysis.length - filteredAnalysis.length;
    if (filteredCount > 0) {
      console.log(`[UnifiedWorker] Filtered out ${filteredCount} unmatched vehicles when using participant preset`);
    }

    const totalCorrections = filteredAnalysis.reduce((sum, vehicle) => {
      const corrections = vehicle._corrections || {};
      return sum + (corrections.raceNumber ? 1 : 0) + (corrections.drivers ? 1 : 0) + (corrections.team ? 1 : 0);
    }, 0);

    console.log(`[UnifiedWorker] Applied corrections to ${filteredAnalysis.length} vehicles (${totalCorrections} total corrections)`);
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

    console.log(`[UnifiedWorker] Starting intelligent matching for ${analysis.length} vehicles with ${participantData.length} participants`);

    const matches: any[] = [];

    try {
      // Process each vehicle in the analysis
      for (let vehicleIndex = 0; vehicleIndex < analysis.length; vehicleIndex++) {
        const vehicle = analysis[vehicleIndex];
        console.log(`[UnifiedWorker] Processing vehicle ${vehicleIndex}/${analysis.length}: ${vehicle.raceNumber || 'unknown'}`);

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
          console.log(`[UnifiedWorker] Found cached match for vehicle ${vehicleIndex}`);
          matches.push(this.convertMatchResultToLegacyFormat(cachedResult));
          continue;
        }

        // Set temporal context if available (same for all vehicles in the image)
        if (temporalContext) {
          console.log(`[UnifiedWorker] Adding temporal context to vehicle ${vehicleIndex}: ${temporalContext.temporalNeighbors.length} neighbors`);
          smartMatcherAnalysis.imageTimestamp = temporalContext.imageTimestamp;
          smartMatcherAnalysis.temporalNeighbors = temporalContext.temporalNeighbors;
        }

        // Perform intelligent matching for this vehicle
        console.log(`[UnifiedWorker] Performing intelligent matching for vehicle ${vehicleIndex} with SmartMatcher`);
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

          // Add detailed logging for transparency
          console.log(`[UnifiedWorker] Vehicle ${vehicleIndex}: Best match found:`, {
            participant: legacyMatch.entry.numero || legacyMatch.entry.number,
            matchType: legacyMatch.matchType,
            score: matchResult.bestMatch.score.toFixed(1),
            confidence: (matchResult.bestMatch.confidence * 100).toFixed(1) + '%',
            evidence: matchResult.bestMatch.evidence.length,
            reasoning: matchResult.bestMatch.reasoning.slice(0, 3) // First 3 reasons
          });

          matches.push(legacyMatch);
        } else {
          console.log(`[UnifiedWorker] Vehicle ${vehicleIndex}: No suitable match found through intelligent matching`);

          // Try fallback simple matching for this vehicle
          const fallbackMatch = this.fallbackSimpleMatch(vehicle, participantData);
          if (fallbackMatch) {
            console.log(`[UnifiedWorker] Vehicle ${vehicleIndex}: Found fallback match: ${fallbackMatch.entry.numero || fallbackMatch.entry.number}`);

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
            console.log(`[UnifiedWorker] Vehicle ${vehicleIndex}: No match found`);
            matches.push(null); // Maintain array alignment
          }
        }
      }

      const successfulMatches = matches.filter(match => match !== null).length;
      console.log(`[UnifiedWorker] Intelligent matching completed: ${successfulMatches}/${analysis.length} vehicles matched`);

      return matches;

    } catch (error) {
      console.error(`[UnifiedWorker] Error during intelligent matching:`, error);

      // Fallback to simple legacy matching for all vehicles on error
      console.log(`[UnifiedWorker] Falling back to simple race number matching for all vehicles`);
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
    const key = participants.map(p => `${p.numero || p.number || 'none'}_${p.nome_pilota || p.nome || 'none'}`).join('|');
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
        case 'driver_name':
          matchType = 'driverName';
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
        participantName: candidate.participant.nome_pilota || candidate.participant.nome,
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
    const vehiclePrefix = vehicleIndex !== undefined ? `Vehicle ${vehicleIndex}: ` : '';

    console.log(`[UnifiedWorker] ${vehiclePrefix}SmartMatcher Results:`, {
      bestMatch: matchResult.bestMatch ? {
        score: matchResult.bestMatch.score.toFixed(1),
        confidence: (matchResult.bestMatch.confidence * 100).toFixed(1) + '%',
        evidenceTypes: matchResult.bestMatch.evidence.map(e => e.type),
        participant: matchResult.bestMatch.participant.numero || matchResult.bestMatch.participant.number
      } : null,
      totalCandidates: matchResult.allCandidates.length,
      multipleHighScores: matchResult.multipleHighScores,
      resolvedByOverride: matchResult.resolvedByOverride,
      debugInfo: matchResult.debugInfo
    });

    // Log top 3 candidates for analysis
    console.log(`[UnifiedWorker] ${vehiclePrefix}Top candidates:`,
      matchResult.allCandidates.slice(0, 3).map(candidate => ({
        participant: candidate.participant.numero || candidate.participant.number,
        score: candidate.score.toFixed(1),
        confidence: (candidate.confidence * 100).toFixed(1) + '%',
        evidence: candidate.evidence.length
      }))
    );
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
      console.log(`[UnifiedWorker] Fallback match found for number: ${analysis.raceNumber}`);
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
      console.log(`[UnifiedWorker] Using participant preset but no matches found - skipping metadata generation`);
      return null; // Don't write any metadata when using preset but no matches found
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

        // Add driver information from nome_pilota field (split individual names)
        if (participant.nome_pilota) {
          // Split names and add each as individual keyword
          const driverNames = participant.nome_pilota.split(/[,&\/\-\s]+/).map((name: string) => name.trim()).filter((name: string) => name);
          vehicleKeywords.push(...driverNames);
        } else if (participant.nome) {
          // Legacy CSV support - single name
          vehicleKeywords.push(participant.nome.trim());
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

      console.log(`[UnifiedWorker] Built enhanced metadata for ${validMatches.length} vehicles: ${allKeywords.join(' | ')}`);
      return allKeywords.length > 0 ? allKeywords : null;
    }

    // Fallback to original metadata formatting if no match and not using preset
    if (!isUsingParticipantPreset) {
      const keywords = this.formatMetadataByCategory(analysis, this.category);

      // Generate keywords without NO-MATCH tag
      if (!csvMatches && keywords.length > 0) {
        console.log(`[UnifiedWorker] No participant match - generated keywords: ${keywords.join(' | ')}`);
      }

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

      // Add driver information
      const drivers: string[] = [];
      if (participant.nome_pilota) drivers.push(participant.nome_pilota);
      if (participant.nome_navigatore) drivers.push(participant.nome_navigatore);
      if (participant.nome_terzo) drivers.push(participant.nome_terzo);
      if (participant.nome_quarto) drivers.push(participant.nome_quarto);

      if (drivers.length > 0) {
        parts.push(`Drivers: ${drivers.join(', ')}`);
      } else if (participant.nome) {
        parts.push(`Driver: ${participant.nome}`);
      }

      console.log(`[UnifiedWorker] Built special instructions from CSV match: ${parts.join(' | ')}`);
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

    console.log(`[UnifiedWorker] Built special instructions from analysis: ${parts.join(' | ')}`);
    return parts.length > 0 ? parts.join(' | ') : null;
  }

  /**
   * Costruisce una stringa formattata per XMP:Description (Extended Description)
   * Gestisce sia oggetti singoli che array di csvMatch per immagini multi-veicolo
   */
  private buildExtendedDescription(analysis: any[], csvMatch?: any): string | null {
    // Handle both single match (legacy) and array of matches (multi-vehicle)
    if (!csvMatch) {
      console.log(`[UnifiedWorker] No participant preset match - skipping extended description`);
      return null;
    }

    const matches = Array.isArray(csvMatch) ? csvMatch : [csvMatch];
    const descriptions: string[] = [];

    // Process each match to collect metatag content
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];

      if (!match || !match.entry) {
        console.log(`[UnifiedWorker] Match ${i} has no entry - skipping`);
        continue;
      }

      const participant = match.entry;

      // Only use the metatag field from the participant preset
      if (!participant.metatag || participant.metatag.trim() === '') {
        console.log(`[UnifiedWorker] Match ${i} participant preset has empty metatag field - skipping`);
        continue;
      }

      // Add metatag content for this vehicle
      const vehicleDescription = participant.metatag.trim();
      descriptions.push(vehicleDescription);
      console.log(`[UnifiedWorker] Added metatag for vehicle ${i}: ${vehicleDescription.substring(0, 50)}${vehicleDescription.length > 50 ? '...' : ''}`);
    }

    // If no valid descriptions found, return null
    if (descriptions.length === 0) {
      console.log(`[UnifiedWorker] No valid metatag content found in any participant match`);
      return null;
    }

    // Combine all descriptions with separator for multi-vehicle images
    const finalDescription = descriptions.join(' | ');
    console.log(`[UnifiedWorker] Built extended description from ${descriptions.length} participant metatag(s): ${finalDescription.substring(0, 100)}${finalDescription.length > 100 ? '...' : ''}`);
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
      console.log(`[UnifiedWorker] Using CSV metatag: ${csvMetatag}`);
      return [csvMetatag];
    }
    
    // Priorità 2: Se non ci sono dati AI, usa un messaggio generico
    if (!analysisData) {
      const fallback = `Processed by Racetagger - Category: ${category}`;
      console.log(`[UnifiedWorker] Using fallback: ${fallback}`);
      return [fallback];
    }

    // Converti in array se è un singolo oggetto
    const analysisArray = Array.isArray(analysisData) ? analysisData : [analysisData];
    const allKeywords: string[] = [];

    // Processa ogni risultato di analisi
    for (let i = 0; i < analysisArray.length; i++) {
      const analysis = analysisArray[i];
      const vehicleKeywords: string[] = [];
      
      console.log(`[UnifiedWorker] Processing analysis result ${i + 1}/${analysisArray.length}:`, analysis);
      
      // Numero (universale per tutti gli sport)
      const raceNumber = analysis.raceNumber || analysis.race_number || analysis.number;
      if (raceNumber) {
        const keyword = `Number: ${raceNumber}`;
        vehicleKeywords.push(keyword);
        console.log(`[UnifiedWorker] Added number keyword: ${keyword}`);
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
        console.log(`[UnifiedWorker] Added driver keyword: ${keyword}`);
      }
      
      // Categoria/Disciplina
      const vehicleCategory = analysis.category || analysis.class || analysis.vehicleClass;
      if (vehicleCategory) {
        const keyword = `Category: ${vehicleCategory}`;
        vehicleKeywords.push(keyword);
        console.log(`[UnifiedWorker] Added category keyword: ${keyword}`);
      }
      
      // Team/Squadra (più rilevante per motorsport)
      if (analysis.teamName && category.toLowerCase() === 'motorsport') {
        vehicleKeywords.push(analysis.teamName);
        console.log(`[UnifiedWorker] Added team keyword: ${analysis.teamName}`);
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
          console.log(`[UnifiedWorker] Added ${relevantTexts.length} sponsor keywords: ${relevantTexts.join(', ')}`);
        }
      }
      
      // Aggiungi le keywords del veicolo corrente
      allKeywords.push(...vehicleKeywords);
      
      // Aggiungi divider se ci sono più veicoli e non è l'ultimo
      if (analysisArray.length > 1 && i < analysisArray.length - 1) {
        allKeywords.push('•••');
      }
    }
    
    // Se non abbiamo dati utili, usa un fallback
    if (allKeywords.length === 0) {
      const fallback = `Analyzed by Racetagger - Category: ${category}`;
      console.log(`[UnifiedWorker] Using analysis fallback: ${fallback}`);
      return [fallback];
    }
    
    console.log(`[UnifiedWorker] Generated ${allKeywords.length} keywords:`, allKeywords);
    return allKeywords;
  }

  /**
   * ADMIN FEATURE: Organizza l'immagine in cartelle basate sul numero di gara
   */
  private async organizeToFolders(
    imageFile: UnifiedImageFile, 
    processedAnalysis: any, 
    processedImagePath: string
  ): Promise<void> {
    // Verifica se la funzionalità è abilitata
    const { APP_CONFIG } = await import('./config');
    if (!APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION || !this.config.folderOrganization?.enabled) {
      console.log(`[UnifiedWorker] Folder organization disabled or not configured for ${imageFile.fileName}`);
      return;
    }

    try {
      console.log(`[UnifiedWorker] Starting folder organization for ${imageFile.fileName}`);

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
      const numbersWithoutMatches = allDetectedNumbers.filter(num => !numbersWithMatches.includes(num));

      if (!allDetectedNumbers || allDetectedNumbers.length === 0) {
        console.log(`[UnifiedWorker] No race numbers found for ${imageFile.fileName}, organizing as unknown`);
        await organizer.organizeUnknownImage(
          imageFile.originalPath,
          path.dirname(imageFile.originalPath)
        );
      } else if (isUsingParticipantPreset && numbersWithMatches.length === 0) {
        // Numbers detected but NONE found in preset - use Unknown_Numbers folder
        console.log(`[UnifiedWorker] Race numbers [${allDetectedNumbers.join(', ')}] found but NONE in participant preset for ${imageFile.fileName}, organizing to Unknown_Numbers`);

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

        await organizer.organizeToUnknownNumbers(
          imageFile.originalPath,
          path.dirname(imageFile.originalPath)
        );
      } else {
        // At least some numbers have matches - organize by matched numbers only
        const numbersToOrganize = isUsingParticipantPreset ? numbersWithMatches : allDetectedNumbers;

        if (isUsingParticipantPreset && numbersWithoutMatches.length > 0) {
          console.log(`[UnifiedWorker] Found race numbers [${allDetectedNumbers.join(', ')}] for ${imageFile.fileName} - organizing by matched numbers [${numbersWithMatches.join(', ')}], ignoring [${numbersWithoutMatches.join(', ')}]`);
        } else {
          console.log(`[UnifiedWorker] Found race numbers [${numbersToOrganize.join(', ')}] for ${imageFile.fileName}`);
        }

        // ====== COLLECT ALL csvData entries for matched numbers ======
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

        // ====== DEBUG LOGGING: Trace csvDataList before passing to organizer ======
        console.log('[Processor] 🔍 DEBUG - csvDataList length:', csvDataList.length);
        console.log('[Processor] 🔍 DEBUG - csvDataList:', csvDataList.length > 0 ? JSON.stringify(csvDataList, null, 2) : 'empty array');
        csvDataList.forEach((data, index) => {
          console.log(`[Processor] 🔍 DEBUG - Vehicle ${index + 1} (#${data.numero}):`, {
            folder_1: data.folder_1 || '(empty)',
            folder_2: data.folder_2 || '(empty)',
            folder_3: data.folder_3 || '(empty)'
          });
        });
        // ===========================================================================

        // Organizza l'immagine solo con i numeri che hanno match
        const result = await organizer.organizeImage(
          imageFile.originalPath,
          numbersToOrganize, // Only numbers with matches in preset
          csvDataList, // ← ARRAY of csvData instead of single object
          path.dirname(imageFile.originalPath)
        );

        if (result.success) {
          console.log(`[UnifiedWorker] Successfully organized ${imageFile.fileName} to folder: ${result.folderName}`);
        } else {
          console.error(`[UnifiedWorker] Failed to organize ${imageFile.fileName}:`, result.error);
        }
      }

      // Log delle statistiche finali di organizzazione
      const summary = organizer.getOrganizationSummary();
      if (summary.totalFiles > 0) {
        console.log(`[UnifiedWorker] Organization summary: ${summary.organizedFiles}/${summary.totalFiles} files organized, ${summary.foldersCreated} folders created`);
      }

    } catch (error: any) {
      console.error(`[UnifiedWorker] Error during folder organization for ${imageFile.fileName}:`, error);
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

    const participant = csvMatch.entry;
    const drivers: string[] = [];

    if (participant.nome_pilota) drivers.push(participant.nome_pilota);
    if (participant.nome_navigatore) drivers.push(participant.nome_navigatore);
    if (participant.nome_terzo) drivers.push(participant.nome_terzo);
    if (participant.nome_quarto) drivers.push(participant.nome_quarto);
    if (participant.nome && drivers.length === 0) drivers.push(participant.nome); // Legacy support

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

    console.log(`[UnifiedProcessor] Initialized with ${this.config.maxConcurrentWorkers} workers (auto-configured from ${optimalWorkers} optimal), max size: ${this.config.maxImageSizeKB}KB`);
  }

  /**
   * Initialize temporal clustering configurations from Supabase sport categories
   */
  private async initializeTemporalConfigurations() {
    console.log(`[UnifiedProcessor] Initializing temporal configurations from Supabase...`);

    try {
      // Create temporary Supabase client
      const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

      // Get sport categories from Supabase
      const { data: sportCategories, error } = await supabase
        .from('sport_categories')
        .select('*')
        .eq('is_active', true);

      if (error) {
        console.warn(`[UnifiedProcessor] Failed to load sport categories from Supabase:`, error);
        console.log(`[UnifiedProcessor] Using default hardcoded temporal configurations`);
        return;
      }

      if (!sportCategories || sportCategories.length === 0) {
        console.warn(`[UnifiedProcessor] No sport categories found in Supabase`);
        console.log(`[UnifiedProcessor] Using default hardcoded temporal configurations`);
        return;
      }

      console.log(`[UnifiedProcessor] Loaded ${sportCategories.length} sport categories from Supabase`);

      // Initialize TemporalClusterManager configurations from Supabase data
      if (this.temporalManager) {
        this.temporalManager.initializeFromSportCategories(sportCategories);
        console.log(`[UnifiedProcessor] TemporalClusterManager configurations updated from Supabase`);
      }

      console.log(`[UnifiedProcessor] Temporal configurations initialization completed`);
    } catch (error) {
      console.error(`[UnifiedProcessor] Error initializing temporal configurations:`, error);
      console.log(`[UnifiedProcessor] Falling back to default hardcoded temporal configurations`);
    }
  }

  /**
   * Extract timestamps from all images using batch processing for temporal clustering
   */
  private async extractTimestampsFromImagesBatch(imageFiles: UnifiedImageFile[]): Promise<ImageTimestamp[]> {
    console.log(`[UnifiedProcessor] Extracting timestamps from ${imageFiles.length} images using batch processing`);

    const filePaths = imageFiles.map(file => file.originalPath);
    const imageTimestamps = await this.temporalManager.extractTimestampsBatch(filePaths);

    // Store timestamps in the map for later use during analysis
    this.imageTimestamps.clear();
    for (const timestamp of imageTimestamps) {
      this.imageTimestamps.set(timestamp.filePath, timestamp);
    }

    const successCount = imageTimestamps.filter(t => t.timestamp !== null).length;
    const excludedCount = imageTimestamps.length - successCount;

    console.log(`[UnifiedProcessor] Batch timestamp extraction completed: ${successCount}/${imageTimestamps.length} successful, ${excludedCount} excluded`);

    return imageTimestamps;
  }

  /**
   * Extract timestamps from all images for temporal clustering (legacy single-file method)
   */
  private async extractTimestampsFromImages(imageFiles: UnifiedImageFile[]): Promise<ImageTimestamp[]> {
    console.log(`[UnifiedProcessor] Extracting timestamps from ${imageFiles.length} images for temporal clustering`);

    const imageTimestamps: ImageTimestamp[] = [];

    // Process images in parallel for faster timestamp extraction
    const timestampPromises = imageFiles.map(async (imageFile): Promise<ImageTimestamp | null> => {
      try {
        const timestamp = await this.temporalManager.extractTimestamp(imageFile.originalPath);
        return timestamp;
      } catch (error) {
        console.warn(`[UnifiedProcessor] Failed to extract timestamp from ${imageFile.fileName}:`, error);
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

    console.log(`[UnifiedProcessor] Successfully extracted ${imageTimestamps.length}/${imageFiles.length} timestamps`);
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

    console.log(`[UnifiedProcessor] System: ${cpuCount} CPUs, ${totalMemoryGB.toFixed(1)}GB RAM → ${workers} workers (optimized)`);
    return workers;
  }

  /**
   * Processa un batch di immagini con chunking automatico per batch molto grandi
   */
  async processBatch(imageFiles: UnifiedImageFile[]): Promise<UnifiedProcessingResult[]> {
    // FILTRO: Rimuovi file metadata di macOS (iniziano con ._) che causano loop infiniti
    const filteredFiles = imageFiles.filter(file => {
      const basename = path.basename(file.fileName);
      if (basename.startsWith('._')) {
        console.log(`[UnifiedProcessor] ⚠️ Skipping macOS metadata file: ${basename}`);
        return false;
      }
      return true;
    });

    const filteredCount = imageFiles.length - filteredFiles.length;
    if (filteredCount > 0) {
      console.log(`[UnifiedProcessor] Filtered out ${filteredCount} macOS metadata files (._*)`);
    }

    // Per batch grandi, dividi in chunk per prevenire crash di memoria
    if (filteredFiles.length > 1500) {
      console.log(`[UnifiedProcessor] Large batch (${filteredFiles.length} images), processing in chunks to prevent memory issues`);
      return this.processBatchInChunks(filteredFiles);
    }

    return this.processBatchInternal(filteredFiles);
  }

  /**
   * Processa un batch molto grande in chunk più piccoli
   */
  private async processBatchInChunks(imageFiles: UnifiedImageFile[]): Promise<UnifiedProcessingResult[]> {
    const chunkSize = 500; // Processa max 500 immagini alla volta per evitare OOM
    const allResults: UnifiedProcessingResult[] = [];

    console.log(`[UnifiedProcessor] Processing ${imageFiles.length} images in chunks of ${chunkSize}`);

    for (let i = 0; i < imageFiles.length; i += chunkSize) {
      // Check for cancellation before each chunk
      if (this.config.isCancelled && this.config.isCancelled()) {
        console.log(`[UnifiedProcessor] Processing cancelled at chunk ${Math.floor(i / chunkSize) + 1}`);
        break;
      }

      const chunk = imageFiles.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(imageFiles.length / chunkSize);

      console.log(`[UnifiedProcessor] Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} images)`);

      // Forza garbage collection prima di ogni chunk
      if (global.gc) {
        global.gc();
        const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log(`[UnifiedProcessor] Memory before chunk ${chunkNumber}: ${memoryMB.toFixed(0)}MB`);
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
        console.log(`[UnifiedProcessor] Chunk ${chunkNumber} completed. Pausing 3 seconds before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log(`[UnifiedProcessor] All chunks completed. Total results: ${allResults.length}`);
    return allResults;
  }

  /**
   * Processa un batch di immagini (implementazione interna)
   */
  private async processBatchInternal(imageFiles: UnifiedImageFile[]): Promise<UnifiedProcessingResult[]> {
    console.log(`[UnifiedProcessor] Starting batch processing of ${imageFiles.length} images`);

    // Controllo memoria preventivo
    const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const totalMemoryMB = require('os').totalmem() / 1024 / 1024;
    const memoryUsagePercent = (memoryMB / totalMemoryMB) * 100;

    console.log(`[UnifiedProcessor] Memory check: ${memoryMB.toFixed(0)}MB used (${memoryUsagePercent.toFixed(1)}% of ${totalMemoryMB.toFixed(0)}MB total)`);

    // Se l'uso memoria è già alto, forza garbage collection
    if (memoryUsagePercent > 70) {
      console.warn(`[UnifiedProcessor] High memory usage detected (${memoryUsagePercent.toFixed(1)}%), forcing garbage collection`);
      if (global.gc) {
        global.gc();
        const afterGC = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log(`[UnifiedProcessor] After GC: ${afterGC.toFixed(0)}MB (freed ${(memoryMB - afterGC).toFixed(0)}MB)`);
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
    console.log(`[UnifiedProcessor] Checking for executionId in config:`, {
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
          }
        };

        console.log('[UnifiedProcessor] ✅ Enhanced telemetry collected');
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

      console.log(`[UnifiedProcessor] Analysis logging enabled for execution ${this.config.executionId}`);

      // CREATE EXECUTION RECORD IN DATABASE
      // This ensures the execution is tracked in Supabase for later correlation with analysis logs
      try {
        const { getSupabaseClient } = await import('./database-service');
        const { authService: auth } = await import('./auth-service');
        const supabase = getSupabaseClient();
        const authState = auth.getAuthState();
        const currentUserId = authState.isAuthenticated ? authState.user?.id : null;

        if (!currentUserId) {
          console.warn(`[UnifiedProcessor] ⚠️ User not authenticated, skipping execution record creation`);
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
              participantCount: this.config.participantPresetData?.length || 0,
              folderOrganizationEnabled: !!this.config.folderOrganization?.enabled,
              enableAdvancedAnnotations: this.config.enableAdvancedAnnotations
            },
            // TIER 1 TELEMETRY: Add system environment telemetry
            system_environment: this.systemEnvironment
          };

          const { data, error } = await supabase
            .from('executions')
            .insert(executionData)
            .select()
            .single();

          if (error) {
            console.error(`[UnifiedProcessor] ❌ Failed to create execution record:`, JSON.stringify(error, null, 2));
            console.error(`[UnifiedProcessor] Error details - code: ${error.code}, message: ${error.message}, details: ${error.details}, hint: ${error.hint}`);
          } else {
            console.log(`[UnifiedProcessor] ✅ Execution record created in database: ${data.id}`);
          }
        }
      } catch (executionError) {
        console.error(`[UnifiedProcessor] ❌ Exception creating execution record:`, executionError);
        // Don't fail the entire processing - continue anyway
      }
    } else {
      console.log(`[UnifiedProcessor] Analysis logging DISABLED - no execution ID provided`);
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
    console.log(`[UnifiedProcessor] 🎯 Extracting EXIF timestamps with subsecond precision for ${imageFiles.length} files...`);
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
    console.log(`[UnifiedProcessor] 🎯 Extracting filesystem timestamps for processing order optimization...`);
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

    console.log(`[UnifiedProcessor] 🚀 Reordered processing queue by filesystem timestamp for optimal multi-camera temporal clustering`);
    console.log(`[UnifiedProcessor] Original order (sample): ${originalOrder.join(', ')}`);
    console.log(`[UnifiedProcessor] Temporal order (sample): ${temporalOrder.join(', ')}`);
    console.log(`[UnifiedProcessor] Successfully processed ${filesystemTimestamps.filter((f: FileTimestamp) => f.creationTime).length}/${filesystemTimestamps.length} filesystem timestamps`);

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

    console.log(`[UnifiedProcessor] Created ${temporalClusters.length} temporal clusters from ${imageTimestamps.length} filesystem timestamps`);

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
      
      console.log(`[UnifiedProcessor] Started worker ${workerId} for ${imageFile.fileName} (${activeWorkers.size}/${this.config.maxConcurrentWorkers} active)`);
    }
    
    // Processa immagini fino al completamento
    while (activeWorkers.size > 0) {
      // Check for cancellation before processing next batch
      if (this.config.isCancelled && this.config.isCancelled()) {
        console.log(`[UnifiedProcessor] Processing cancelled, stopping workers`);
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

        // Check for ghost vehicle warning and increment counter
        if (result.csvMatch?.ghostVehicleWarning) {
          this.ghostVehicleCount++;
          console.warn(`[UnifiedProcessor] 🚨 Ghost vehicle detected in ${fileName} (${this.ghostVehicleCount} total ghost vehicles so far)`);
        }

        console.log(`[UnifiedProcessor] Worker ${workerId} completed for ${fileName} (${activeWorkers.size} remaining, ${this.processedImages}/${this.totalImages} total)`);

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
            console.warn(`[UnifiedProcessor] High memory usage (${memoryUsagePercent.toFixed(1)}%), pausing new workers and forcing GC`);
            if (global.gc) {
              global.gc();
              await new Promise(resolve => setTimeout(resolve, 100)); // Breve pausa per consentire il GC
            }

            // Ricontrolla la memoria dopo GC
            const afterGCMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
            const afterGCPercent = (afterGCMemoryMB / (require('os').totalmem() / 1024 / 1024)) * 100;

            if (afterGCPercent > 70) {
              console.warn(`[UnifiedProcessor] Memory still high after GC (${afterGCPercent.toFixed(1)}%), reducing active workers`);
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

              console.log(`[UnifiedProcessor] Started new worker ${newWorkerId} for ${nextImageFile.fileName} (${activeWorkers.size}/${this.config.maxConcurrentWorkers} active, memory: ${afterGCPercent.toFixed(1)}%)`);
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

            console.log(`[UnifiedProcessor] Started new worker ${newWorkerId} for ${nextImageFile.fileName} (${activeWorkers.size}/${this.config.maxConcurrentWorkers} active, memory: ${memoryUsagePercent.toFixed(1)}%)`);
          }
        }
        
        // Garbage collection più frequente ogni 3 immagini per batch grandi, ogni 5 per batch piccoli
        // Più frequente GC per batch molto grandi
        const gcInterval = imageFiles.length > 3000 ? 2 : imageFiles.length > 1000 ? 3 : 5;
        if (this.processedImages % gcInterval === 0) {
          if (global.gc) {
            global.gc();
            console.log(`[UnifiedProcessor] Forced garbage collection after ${this.processedImages} images (interval: ${gcInterval})`);
          }
        }
        
      } catch (error) {
        console.error(`[UnifiedProcessor] Unexpected error in worker management:`, error);
        // Emergency cleanup: rimuovi tutti i worker per prevenire deadlock
        activeWorkers.clear();
        break;
      }
    }
    
    console.log(`[UnifiedProcessor] Batch completed: ${results.length} images processed successfully`);

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
            console.log(`[UnifiedProcessor] ✅ Updated system_environment.network with final upload speed: ${networkStats.upload_speed_mbps} Mbps`);
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

        console.log('[UnifiedProcessor] ✅ Final telemetry collected');
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
          errorSummary
        }
      );

      try {
        const logUrl = await this.analysisLogger.finalize();
        console.log(`[ADMIN] Analysis log available at: ${logUrl || 'upload failed - local only'}`);
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
            system_environment: this.systemEnvironment
          };

          const { error } = await supabase
            .from('executions')
            .update(executionUpdate)
            .eq('id', this.config.executionId)
            .eq('user_id', currentUserId);

          if (error) {
            console.error(`[UnifiedProcessor] ❌ Failed to update execution record:`, error);
          } else {
            console.log(`[UnifiedProcessor] ✅ Execution record updated: ${successful}/${results.length} successful`);
          }
        }
      } catch (updateError) {
        console.error(`[UnifiedProcessor] ❌ Exception updating execution record:`, updateError);
        // Don't fail - this is just metadata
      }
    }

    this.emit('batchComplete', {
      successful: results.filter(r => r.success).length,
      errors: results.filter(r => !r.success).length,
      total: results.length
    });

    return results;
  }

  /**
   * Processa una singola immagine con un worker
   */
  private async processWithWorker(imageFile: UnifiedImageFile): Promise<UnifiedProcessingResult> {
    this.activeWorkers++;

    const worker = await UnifiedImageWorker.create(this.config, this.analysisLogger, this.networkMonitor);

    try {
      // Calculate temporal context in main process and pass to worker
      const temporalContext = this.getTemporalContext(imageFile.originalPath);
      const result = await worker.processImage(imageFile, this, temporalContext);
      return result;
    } finally {
      this.activeWorkers--;
    }
  }

  /**
   * Aggiorna la configurazione
   */
  updateConfig(newConfig: Partial<UnifiedProcessorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log(`[UnifiedProcessor] Configuration updated with participantPresetData length: ${this.config.participantPresetData?.length || 0}`);
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