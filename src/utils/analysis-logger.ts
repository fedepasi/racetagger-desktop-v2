/**
 * Analysis Logger System for RaceTagger
 *
 * Logs detailed analysis decisions, corrections, and processing flow to JSONL files
 * with automatic upload to Supabase Storage for remote monitoring and debugging.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../database-service';
import type { HardwareInfo } from './hardware-detector';
import type { NetworkMetrics } from './network-monitor';
import type { PhaseTimings } from './performance-timer';
import type { ErrorEvent as TrackedError, ErrorSummary } from './error-tracker';

export interface LogEvent {
  type: 'EXECUTION_START' | 'IMAGE_ANALYSIS' | 'CORRECTION' | 'TEMPORAL_CLUSTER' | 'PARTICIPANT_MATCH' | 'UNKNOWN_NUMBER' | 'RF_DETR_TIMING' | 'EXECUTION_COMPLETE' | 'ERROR';
  timestamp: string;
  executionId: string;
}

export interface ExecutionStartEvent extends LogEvent {
  type: 'EXECUTION_START';
  totalImages: number;
  category: string;
  participantPresetId?: string;
  userId: string;
  appVersion: string;
  // Optional enhanced telemetry (backward compatible)
  systemEnvironment?: {
    hardware?: HardwareInfo;
    network?: Partial<NetworkMetrics>;
    environment?: {
      node_version: string;
      electron_version: string;
      dcraw_version?: string;
      sharp_version?: string;
      timezone?: string;
      locale?: string;
    };
  };
}

export interface VehicleAnalysisData {
  vehicleIndex: number;
  raceNumber?: string;
  drivers?: string[];
  team?: string;
  sponsors?: string[];
  confidence: number;
  plateNumber?: string;       // License plate number detected by AI
  plateConfidence?: number;   // Confidence score for plate number (0.0-1.0)
  // Original Gemini bounding box format (preserved for training data export)
  box_2d?: [number, number, number, number];  // [y1, x1, y2, x2] normalized 0-1000
  // Converted bounding box format for compatibility
  boundingBox?: {
    x: number;      // Percentage 0-100 from left edge (or pixels for RF-DETR)
    y: number;      // Percentage 0-100 from top edge (or pixels for RF-DETR)
    width: number;  // Percentage 0-100 of image width (or pixels for RF-DETR)
    height: number; // Percentage 0-100 of image height (or pixels for RF-DETR)
  };
  // Segmentation mask info (YOLOv8-seg) - full mask data NOT stored (too large)
  segmentation?: {
    used: boolean;           // Was segmentation mask applied
    cocoClass: string;       // 'car', 'motorcycle', 'person', etc.
    cocoClassId: number;     // COCO class ID (2=car, 3=motorcycle, 0=person)
    maskConfidence: number;  // Segmentation confidence (0-1)
    maskedOthers: number;    // Number of other subjects masked out in this crop
  };
  modelSource?: 'gemini' | 'rf-detr' | 'local-onnx' | 'gemini-v6-seg';  // Recognition method used for this vehicle
  corrections: CorrectionData[];
  participantMatch?: any;
  finalResult: {
    raceNumber?: string;
    team?: string;
    drivers?: string[];
    matchedBy: string;
  };
}

export interface VisualTagsData {
  location?: string[];
  weather?: string[];
  sceneType?: string[];
  subjects?: string[];
  visualStyle?: string[];
  emotion?: string[];
}

export interface ImageAnalysisEvent extends LogEvent {
  type: 'IMAGE_ANALYSIS';
  imageId: string;
  fileName: string;
  originalFileName?: string;
  originalPath?: string;
  supabaseUrl?: string;
  // Base64 preview image for display in management portal (when no Supabase URL available)
  previewDataUrl?: string;
  aiResponse: {
    rawText: string;
    totalVehicles: number;
    vehicles: VehicleAnalysisData[];
  };
  temporalContext?: {
    previousImage?: { fileName: string; raceNumber: string; timeDiff: number };
    nextImage?: { fileName: string; raceNumber: string; timeDiff: number };
    burstMode: boolean;
    bonusApplied: number;
    clusterSize?: number;
    neighbors?: { fileName: string; timeDiff: number }[];
  };
  // Local thumbnail paths for image display
  thumbnailPath?: string | null;
  microThumbPath?: string | null;
  compressedPath?: string | null;
  // Recognition method tracking
  recognitionMethod?: 'gemini' | 'rf-detr' | 'local-onnx' | 'gemini-v6-seg';
  // Original image dimensions for bbox mapping (especially useful for local-onnx)
  imageSize?: { width: number; height: number };
  // Segmentation preprocessing info (YOLO model used before recognition)
  segmentationPreprocessing?: {
    used: boolean;           // Was YOLO segmentation used
    modelId?: string;        // Model ID used (e.g., 'yolov11-detector-v1')
    detectionsCount: number; // Number of subjects detected by YOLO
    inferenceMs: number;     // YOLO inference time in milliseconds
    cropsExtracted: number;  // Number of masked crops created
    masksApplied: boolean;   // Were masks applied to isolate subjects
    // Detection bounding boxes for visualization (always available when detections exist)
    detections?: Array<{
      bbox: { x: number; y: number; width: number; height: number };
      classId: number;
      className: string;
      confidence: number;
      detectionId: string;
    }>;
  };
  // Visual tags extracted by AI (location, weather, scene, subjects, style, emotion)
  visualTags?: VisualTagsData;
  // Backward compatibility fields (uses first vehicle data)
  primaryVehicle?: VehicleAnalysisData;
}

export interface CorrectionData {
  type: 'OCR' | 'TEMPORAL' | 'FUZZY' | 'PARTICIPANT' | 'SPONSOR' | 'FAST_TRACK';
  field: string;
  originalValue: any;
  correctedValue: any;
  reason: string;
  confidence: number;
  vehicleIndex?: number; // Optional vehicle index for multi-vehicle scenarios
  details?: any;
}

export interface UnknownNumberEvent extends LogEvent {
  type: 'UNKNOWN_NUMBER';
  imageId: string;
  fileName: string;
  detectedNumbers: string[];
  participantPresetName?: string;
  participantCount: number;
  appliedFuzzyCorrection: boolean;
  fuzzyAttempts?: Array<{
    original: string;
    candidate: string;
    score: number;
    rejected: boolean;
  }>;
  organizationFolder: string;
}

export interface CorrectionEvent extends LogEvent {
  type: 'CORRECTION';
  imageId: string;
  correctionType: CorrectionData['type'];
  field: string;
  originalValue: any;
  correctedValue: any;
  reason: string;
  confidence: number;
  message: string; // Human-readable explanation
  details?: any;
}

export interface TemporalClusterEvent extends LogEvent {
  type: 'TEMPORAL_CLUSTER';
  clusterImages: string[];
  duration: number;
  burstMode: boolean;
  commonNumber?: string;
  sport: string;
}

export interface ParticipantMatchEvent extends LogEvent {
  type: 'PARTICIPANT_MATCH';
  imageId: string;
  matchedNumber: string;
  participant: {
    nome: string;
    squadra?: string;
    categoria?: string;
  };
  score: number;
  evidenceUsed: string[];
  reasoning: string[];
}

export interface RfDetrTimingEvent extends LogEvent {
  type: 'RF_DETR_TIMING';
  imageId: string;
  fileName: string;
  inferenceTimeMs: number;
  inferenceTimeSec: number;
  estimatedCostUSD: number;    // Baseline estimate ($0.0045)
  actualCostUSD: number;        // Actual cost based on time (V2 API: $0.008/sec)
  detectionsCount: number;
  modelUrl: string;
}

export interface ExecutionCompleteEvent extends LogEvent {
  type: 'EXECUTION_COMPLETE';
  totalProcessed: number;
  successful: number;
  corrections: {
    OCR: number;
    TEMPORAL: number;
    FUZZY: number;
    PARTICIPANT: number;
    SPONSOR: number;
  };
  temporalClusters: number;
  participantMatches: number;
  averageConfidence: number;
  processingTimeMs: number;
  // Optional enhanced telemetry (backward compatible)
  performanceBreakdown?: PhaseTimings;
  memoryStats?: {
    peak_mb: number;
    average_mb: number;
    baseline_mb: number;
  };
  cpuStats?: {
    average_percent?: number;
    peak_percent?: number;
  };
  networkStats?: NetworkMetrics;
  errorSummary?: ErrorSummary;
  // Recognition method statistics
  recognitionStats?: {
    method: 'gemini' | 'rf-detr' | 'local-onnx' | 'mixed';
    rfDetrDetections?: number;
    rfDetrCost?: number;
    rfDetrTotalInferenceTimeMs?: number;  // Total inference time across all images
    rfDetrAverageInferenceTimeMs?: number; // Average inference time per image
    rfDetrActualCost?: number;             // Actual cost based on timing (V2 API)
    rfDetrEstimatedCost?: number;          // Estimated cost baseline
    // Local ONNX metrics
    localOnnxInferenceMs?: number;         // Total local inference time
    localOnnxDetections?: number;          // Total local detections
  };
}

export class AnalysisLogger {
  private fileStream: fs.WriteStream;
  private executionId: string;
  private userId: string;
  private category: string;
  private localFilePath: string;
  private supabaseUploadPath: string;
  private uploadInterval: NodeJS.Timeout | null = null;
  private supabase: SupabaseClient;
  private stats = {
    totalImages: 0,
    corrections: { OCR: 0, TEMPORAL: 0, FUZZY: 0, PARTICIPANT: 0, SPONSOR: 0, FAST_TRACK: 0 },
    temporalClusters: 0,
    participantMatches: 0,
    totalConfidence: 0,
    startTime: Date.now()
  };

  // Backpressure management for large batches
  private writeQueue: string[] = [];
  private isWriting: boolean = false;
  private writeCount: number = 0;
  private readonly FLUSH_INTERVAL = 50; // Flush to disk every 50 writes

  // Database dual-write system (corrections, clusters, unknown numbers)
  private dbWriteQueue: Array<{ type: 'correction' | 'cluster' | 'unknown'; data: any }> = [];
  private dbWriteInterval: NodeJS.Timeout | null = null;
  private readonly DB_FLUSH_INTERVAL_MS = 5000; // Flush to DB every 5 seconds

  constructor(executionId: string, category: string, userId: string, options: { appendMode?: boolean; readOnly?: boolean } = {}) {
    this.executionId = executionId;
    this.userId = userId;
    this.category = category;

    // Initialize authenticated Supabase client
    this.supabase = getSupabaseClient();

    // Create local file path
    const date = new Date().toISOString().split('T')[0];
    const fileName = `exec_${executionId}.jsonl`;

    const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.localFilePath = path.join(logsDir, fileName);

    // Supabase upload path
    this.supabaseUploadPath = `${userId}/${date}/${fileName}`;

    // Initialize file stream based on options
    if (options.readOnly) {
      // Read-only mode: don't create or modify file stream
      this.fileStream = null as any; // Will not write to file
    } else if (options.appendMode && fs.existsSync(this.localFilePath)) {
      // Append mode: don't overwrite existing file
      this.fileStream = fs.createWriteStream(this.localFilePath, { flags: 'a' });
    } else {
      // Default mode: create new file (original behavior)
      this.fileStream = fs.createWriteStream(this.localFilePath, { flags: 'w' });
    }

    // NOTE: Incremental uploads disabled to avoid RLS policy conflicts
    // Upload will only happen once at the end via finalize() method

    // Start database dual-write interval (non-blocking best-effort)
    if (!options.readOnly) {
      this.dbWriteInterval = setInterval(() => {
        this.flushDatabaseWrites().catch(() => {
          // Silently ignore DB flush errors - JSONL is primary backup
        });
      }, this.DB_FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Log execution start (with optional enhanced telemetry)
   */
  logExecutionStart(
    totalImages: number,
    participantPresetId?: string,
    systemEnvironment?: ExecutionStartEvent['systemEnvironment']
  ): void {
    const event: ExecutionStartEvent = {
      type: 'EXECUTION_START',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      totalImages,
      category: this.category,
      participantPresetId,
      userId: this.userId,
      appVersion: app.getVersion(),
      systemEnvironment // Optional enhanced telemetry
    };

    this.stats.totalImages = totalImages;
    this.writeLine(event);
  }

  /**
   * Log complete image analysis (now supports multi-vehicle scenarios)
   */
  logImageAnalysis(data: Omit<ImageAnalysisEvent, 'type' | 'timestamp' | 'executionId'>): void {
    const event: ImageAnalysisEvent = {
      type: 'IMAGE_ANALYSIS',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...data
    };

    // Update stats (aggregate confidence from all vehicles)
    if (data.aiResponse.vehicles && data.aiResponse.vehicles.length > 0) {
      const totalConfidence = data.aiResponse.vehicles.reduce((sum, vehicle) => sum + (vehicle.confidence || 0), 0);
      const avgConfidence = totalConfidence / data.aiResponse.vehicles.length;
      this.stats.totalConfidence += avgConfidence;
    } else if (data.primaryVehicle?.confidence) {
      // Fallback for backward compatibility
      this.stats.totalConfidence += data.primaryVehicle.confidence;
    }

    this.writeLine(event);
  }

  /**
   * Log a correction with human-readable explanation
   */
  logCorrection(data: Omit<CorrectionEvent, 'type' | 'timestamp' | 'executionId' | 'message'>): void {
    const message = this.formatCorrectionMessage(data);

    const event: CorrectionEvent = {
      type: 'CORRECTION',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      message,
      ...data
    };

    // Update stats
    this.stats.corrections[data.correctionType]++;

    // Write to JSONL (primary)
    this.writeLine(event);

    // Queue for DB write (dual-write for redundancy)
    this.dbWriteQueue.push({
      type: 'correction',
      data: {
        execution_id: this.executionId,
        user_id: this.userId,
        image_id: data.imageId,
        correction_type: data.correctionType,
        field: data.field,
        original_value: data.originalValue,
        corrected_value: data.correctedValue,
        confidence: data.confidence,
        reason: data.reason,
        message: message,
        vehicle_index: (data as any).vehicleIndex || null,
        details: data.details || null
      }
    });
  }

  /**
   * Log when numbers are detected but not found in participant preset
   */
  logUnknownNumber(data: Omit<UnknownNumberEvent, 'type' | 'timestamp' | 'executionId'>): void {
    const event: UnknownNumberEvent = {
      type: 'UNKNOWN_NUMBER',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...data
    };

    // Write to JSONL (primary)
    this.writeLine(event);

    // Queue for DB write (dual-write for redundancy)
    this.dbWriteQueue.push({
      type: 'unknown',
      data: {
        execution_id: this.executionId,
        user_id: this.userId,
        image_id: data.imageId,
        file_name: data.fileName,
        detected_numbers: data.detectedNumbers,
        participant_preset_name: data.participantPresetName || null,
        participant_count: data.participantCount,
        applied_fuzzy_correction: data.appliedFuzzyCorrection,
        fuzzy_attempts: data.fuzzyAttempts || null,
        organization_folder: data.organizationFolder
      }
    });
  }

  /**
   * Log temporal cluster analysis
   */
  logTemporalCluster(data: Omit<TemporalClusterEvent, 'type' | 'timestamp' | 'executionId'> | { excludedImages?: string[]; excludedCount?: number; reason?: string }): void {
    // Handle excluded images case (different format)
    if ('excludedImages' in data && !('clusterImages' in data)) {
      // Log excluded images as a special event
      const excludedEvent = {
        type: 'TEMPORAL_CLUSTER_EXCLUDED' as const,
        timestamp: new Date().toISOString(),
        executionId: this.executionId,
        excludedImages: (data as any).excludedImages || [],
        excludedCount: (data as any).excludedCount || 0,
        reason: (data as any).reason || 'Unknown'
      };
      this.writeLine(excludedEvent);
      return;
    }

    // Standard cluster event
    const clusterData = data as Omit<TemporalClusterEvent, 'type' | 'timestamp' | 'executionId'>;
    const event: TemporalClusterEvent = {
      type: 'TEMPORAL_CLUSTER',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...clusterData
    };

    this.stats.temporalClusters++;

    // Write to JSONL (primary)
    this.writeLine(event);

    // Queue for DB write (dual-write for redundancy) - with safety check
    if (clusterData.clusterImages && Array.isArray(clusterData.clusterImages)) {
      this.dbWriteQueue.push({
        type: 'cluster',
        data: {
          execution_id: this.executionId,
          user_id: this.userId,
          cluster_images: clusterData.clusterImages,
          cluster_size: clusterData.clusterImages.length,
          duration_ms: clusterData.duration,
          is_burst_mode: clusterData.burstMode,
          common_number: clusterData.commonNumber || null,
          sport: clusterData.sport
        }
      });
    }
  }

  /**
   * Log participant matching
   */
  logParticipantMatch(data: Omit<ParticipantMatchEvent, 'type' | 'timestamp' | 'executionId'>): void {
    const event: ParticipantMatchEvent = {
      type: 'PARTICIPANT_MATCH',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...data
    };

    this.stats.participantMatches++;
    this.writeLine(event);
  }

  /**
   * Log RF-DETR timing and cost information
   */
  logRfDetrTiming(data: Omit<RfDetrTimingEvent, 'type' | 'timestamp' | 'executionId'>): void {
    const event: RfDetrTimingEvent = {
      type: 'RF_DETR_TIMING',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...data
    };

    this.writeLine(event);
  }

  /**
   * Log error (new in enhanced telemetry)
   */
  logError(errorData: TrackedError): void {
    try {
      const event: TrackedError & LogEvent = {
        ...errorData,
        type: 'ERROR',
        executionId: this.executionId
      };

      this.writeLine(event);

      // Log to console based on severity
      if (errorData.severity === 'fatal') {
        console.error(`[AnalysisLogger] FATAL ERROR:`, errorData.message);
      }
    } catch (error) {
      // Error logging should never throw
      console.error('[AnalysisLogger] Failed to log error:', error);
    }
  }

  /**
   * Log execution completion (with optional enhanced telemetry)
   */
  logExecutionComplete(
    totalProcessed: number,
    successful: number,
    enhancedStats?: {
      performanceBreakdown?: PhaseTimings;
      memoryStats?: ExecutionCompleteEvent['memoryStats'];
      cpuStats?: ExecutionCompleteEvent['cpuStats'];
      networkStats?: NetworkMetrics;
      errorSummary?: ErrorSummary;
      recognitionStats?: ExecutionCompleteEvent['recognitionStats'];
    }
  ): void {
    const processingTimeMs = Date.now() - this.stats.startTime;
    const averageConfidence = this.stats.totalImages > 0 ? this.stats.totalConfidence / this.stats.totalImages : 0;

    const event: ExecutionCompleteEvent = {
      type: 'EXECUTION_COMPLETE',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      totalProcessed,
      successful,
      corrections: this.stats.corrections,
      temporalClusters: this.stats.temporalClusters,
      participantMatches: this.stats.participantMatches,
      averageConfidence,
      processingTimeMs,
      // Optional enhanced telemetry
      ...enhancedStats
    };

    this.writeLine(event);
  }

  /**
   * Format correction message for human readability
   */
  private formatCorrectionMessage(correction: any): string {
    switch (correction.correctionType) {
      case 'TEMPORAL':
        if (correction.details?.burstMode) {
          return `Corretto "${correction.field}" da "${correction.originalValue}" a "${correction.correctedValue}" per burst mode: foto vicine (±${correction.details.maxTimeDiff}ms) mostrano tutte "${correction.correctedValue}"`;
        } else {
          return `Corretto "${correction.field}" da "${correction.originalValue}" a "${correction.correctedValue}" per vicinanza temporale: foto vicine confermano "${correction.correctedValue}"`;
        }

      case 'FUZZY':
        const similarity = Math.round((correction.confidence || 0) * 100);
        return `Match fuzzy: "${correction.originalValue}" → "${correction.correctedValue}" (${similarity}% similarità${correction.details?.participantName ? ` con ${correction.details.participantName}` : ''})`;

      case 'PARTICIPANT':
        return `Identificato tramite participant data: ${correction.details?.matchType || 'match'} con ${correction.details?.participantName || 'participant'} (score: ${correction.details?.score || 'N/A'})`;

      case 'SPONSOR':
        return `Riconosciuto sponsor "${correction.correctedValue}" (confidence: ${Math.round((correction.confidence || 0) * 100)}%), confermato ${correction.field} "${correction.originalValue}"`;

      case 'OCR':
        return `Correzione OCR: "${correction.originalValue}" → "${correction.correctedValue}" (${correction.reason})`;

      default:
        return correction.reason || `Correzione ${correction.correctionType}: ${correction.originalValue} → ${correction.correctedValue}`;
    }
  }

  /**
   * Write a line to the JSONL file with backpressure handling
   * Uses a queue system to prevent data loss when buffer fills up
   */
  private writeLine(data: any): void {
    try {
      // Skip if in read-only mode
      if (!this.fileStream) {
        return;
      }

      const line = JSON.stringify(data) + '\n';
      this.writeQueue.push(line);
      this.processWriteQueue();
    } catch (error) {
      console.error('[AnalysisLogger] Error queueing write:', error);
    }
  }

  /**
   * Process the write queue with backpressure handling
   * Ensures all data is written even when buffer fills up
   */
  private processWriteQueue(): void {
    if (this.isWriting || this.writeQueue.length === 0 || !this.fileStream || this.fileStream.destroyed) {
      return;
    }

    this.isWriting = true;

    const writeNext = (): void => {
      if (this.writeQueue.length === 0 || !this.fileStream || this.fileStream.destroyed) {
        this.isWriting = false;
        return;
      }

      const line = this.writeQueue.shift()!;
      const canContinue = this.fileStream.write(line);
      this.writeCount++;

      // Periodic flush to ensure data is persisted to disk
      if (this.writeCount % this.FLUSH_INTERVAL === 0) {
        // Force a sync write to disk for durability
        try {
          const fd = (this.fileStream as any).fd;
          if (fd !== undefined && fd !== null) {
            fs.fsyncSync(fd);
          }
        } catch (syncError) {
          // fsync may fail if fd is not available, continue anyway
        }
      }

      if (canContinue) {
        // Buffer has space, continue immediately
        setImmediate(writeNext);
      } else {
        // Buffer is full, wait for drain event
        this.fileStream.once('drain', () => {
          writeNext();
        });
      }
    };

    writeNext();
  }

  /**
   * Flush all pending writes and ensure they're persisted to disk
   * Call this before finalize() for guaranteed data persistence
   */
  async flushWrites(): Promise<void> {
    // Wait for write queue to empty
    while (this.writeQueue.length > 0 || this.isWriting) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Ensure all data is written to disk
    if (this.fileStream && !this.fileStream.destroyed) {
      await new Promise<void>((resolve) => {
        // Wait for drain if needed
        if (this.fileStream.writableNeedDrain) {
          this.fileStream.once('drain', () => resolve());
        } else {
          resolve();
        }
      });

      // Force sync to disk
      try {
        const fd = (this.fileStream as any).fd;
        if (fd !== undefined && fd !== null) {
          fs.fsyncSync(fd);
        }
      } catch (syncError) {
        // Silently ignore fsync errors
      }
    }
  }

  /**
   * Flush all pending database writes (corrections, clusters, unknown numbers)
   * Best-effort: failures don't block execution, JSONL is primary backup
   */
  async flushDatabaseWrites(): Promise<void> {
    if (this.dbWriteQueue.length === 0) {
      return;
    }

    const batch = [...this.dbWriteQueue];
    this.dbWriteQueue = [];

    try {
      // Group by type for batch inserts
      const corrections = batch.filter(b => b.type === 'correction').map(b => b.data);
      const clusters = batch.filter(b => b.type === 'cluster').map(b => b.data);
      const unknowns = batch.filter(b => b.type === 'unknown').map(b => b.data);

      const promises: Promise<void>[] = [];

      if (corrections.length > 0) {
        promises.push(
          (async () => {
            const { error } = await this.supabase.from('image_corrections').insert(corrections);
            // Silently ignore errors - JSONL is primary backup
          })()
        );
      }

      if (clusters.length > 0) {
        promises.push(
          (async () => {
            const { error } = await this.supabase.from('temporal_clusters').insert(clusters);
            // Silently ignore errors - JSONL is primary backup
          })()
        );
      }

      if (unknowns.length > 0) {
        promises.push(
          (async () => {
            const { error } = await this.supabase.from('unknown_numbers').insert(unknowns);
            // Silently ignore errors - JSONL is primary backup
          })()
        );
      }

      await Promise.allSettled(promises);

    } catch (error: any) {
      console.error('[AnalysisLogger] DB flush failed:', error.message);
      // Put failed items back in queue for retry (up to a limit to prevent memory bloat)
      if (this.dbWriteQueue.length < 1000) {
        this.dbWriteQueue = [...batch, ...this.dbWriteQueue];
      }
    }
  }

  /**
   * Upload current log to Supabase Storage with retry logic
   * Returns true if upload succeeded, false otherwise
   */
  private async uploadToSupabase(final: boolean = false): Promise<boolean> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Ensure all data is flushed to disk (only if we have an active fileStream)
        if (this.fileStream && !this.fileStream.destroyed) {
          await new Promise<void>((resolve) => {
            // Use drain event or direct sync
            if (this.fileStream.pending) {
              this.fileStream.once('drain', () => resolve());
            } else {
              resolve();
            }
          });
        }

        if (!fs.existsSync(this.localFilePath)) {
          return false;
        }

        const fileContent = fs.readFileSync(this.localFilePath);

        const { error } = await this.supabase.storage
          .from('analysis-logs')
          .upload(this.supabaseUploadPath, fileContent, {
            cacheControl: '3600',
            upsert: true, // Allow overwriting for incremental updates
            contentType: 'application/x-ndjson'
          });

        if (error) {
          if (attempt === maxRetries) {
            return false;
          }

          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        } else {
          // If final upload, create metadata record
          if (final) {
            await this.createLogMetadata();
          }

          return true; // Success
        }

      } catch (error) {
        if (attempt === maxRetries) {
          return false;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    return false; // Should never reach here, but TypeScript requires it
  }

  /**
   * Create metadata record for easy log discovery with retry logic
   * Returns true if metadata was created successfully, false otherwise
   */
  private async createLogMetadata(): Promise<boolean> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const totalCorrections = Object.values(this.stats.corrections).reduce((sum, count) => sum + count, 0);

        const { error } = await this.supabase
          .from('analysis_log_metadata')
          .insert({
            execution_id: this.executionId,
            user_id: this.userId,
            storage_path: this.supabaseUploadPath,
            total_images: this.stats.totalImages,
            total_corrections: totalCorrections,
            correction_types: this.stats.corrections,
            category: this.category,
            app_version: app.getVersion()
          });

        if (error) {
          if (attempt === maxRetries) {
            return false;
          }

          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        } else {
          return true; // Success
        }

      } catch (error) {
        if (attempt === maxRetries) {
          return false;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    return false; // Should never reach here
  }

  /**
   * Get public URL for the log file
   */
  getPublicUrl(): string {
    const { data: { publicUrl } } = this.supabase.storage
      .from('analysis-logs')
      .getPublicUrl(this.supabaseUploadPath);
    return publicUrl;
  }

  /**
   * Finalize logging and perform final upload
   * Returns public URL if upload succeeded, null if failed (file only available locally)
   */
  async finalize(): Promise<string | null> {
    try {
      // Stop periodic uploads
      if (this.uploadInterval) {
        clearInterval(this.uploadInterval);
        this.uploadInterval = null;
      }

      // CRITICAL: Flush all pending writes before closing stream
      // This ensures all queued data is written to disk, preventing data loss
      await this.flushWrites();

      // Stop database write interval
      if (this.dbWriteInterval) {
        clearInterval(this.dbWriteInterval);
        this.dbWriteInterval = null;
      }

      // Flush all pending database writes (best-effort, non-blocking for finalize)
      if (this.dbWriteQueue.length > 0) {
        await this.flushDatabaseWrites();
      }

      // Close file stream
      if (this.fileStream && !this.fileStream.destroyed) {
        await new Promise<void>((resolve) => {
          this.fileStream.end(() => resolve());
        });
      }

      // Final upload
      const uploadSuccess = await this.uploadToSupabase(true);

      if (!uploadSuccess) {
        return null;
      }

      const publicUrl = this.getPublicUrl();

      return publicUrl;

    } catch (error) {
      console.error('[AnalysisLogger] Error finalizing JSONL:', error);
      return null;
    }
  }

  /**
   * Get local file path (for admin access when upload fails)
   */
  getLocalPath(): string {
    return this.localFilePath;
  }

  /**
   * Cleanup resources if needed
   * WARNING: This may lose pending writes. Use finalize() for graceful shutdown.
   */
  cleanup(): void {
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
      this.uploadInterval = null;
    }

    // Stop database write interval
    if (this.dbWriteInterval) {
      clearInterval(this.dbWriteInterval);
      this.dbWriteInterval = null;
    }

    // Clear write queues
    this.writeQueue = [];
    this.dbWriteQueue = [];
    this.isWriting = false;

    if (this.fileStream && !this.fileStream.destroyed) {
      this.fileStream.destroy();
    }
  }

  /**
   * Get current write statistics for debugging
   */
  getWriteStats(): { writeCount: number; pendingWrites: number; pendingDbWrites: number; isWriting: boolean } {
    return {
      writeCount: this.writeCount,
      pendingWrites: this.writeQueue.length,
      pendingDbWrites: this.dbWriteQueue.length,
      isWriting: this.isWriting
    };
  }
}

/**
 * Helper function to format timing information
 */
export function formatTimeDiff(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}min`;
  }
}
