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
  type: 'EXECUTION_START' | 'IMAGE_ANALYSIS' | 'CORRECTION' | 'TEMPORAL_CLUSTER' | 'PARTICIPANT_MATCH' | 'UNKNOWN_NUMBER' | 'EXECUTION_COMPLETE' | 'ERROR';
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
  boundingBox?: {
    x: number;      // Percentage 0-100 from left edge
    y: number;      // Percentage 0-100 from top edge
    width: number;  // Percentage 0-100 of image width
    height: number; // Percentage 0-100 of image height
  };
  corrections: CorrectionData[];
  participantMatch?: any;
  finalResult: {
    raceNumber?: string;
    team?: string;
    drivers?: string[];
    matchedBy: string;
  };
}

export interface ImageAnalysisEvent extends LogEvent {
  type: 'IMAGE_ANALYSIS';
  imageId: string;
  fileName: string;
  originalFileName?: string;
  originalPath?: string;
  supabaseUrl?: string;
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
      console.log(`[AnalysisLogger] Initialized in READ-ONLY mode for execution ${executionId}`);
      this.fileStream = null as any; // Will not write to file
    } else if (options.appendMode && fs.existsSync(this.localFilePath)) {
      // Append mode: don't overwrite existing file
      console.log(`[AnalysisLogger] Initialized in APPEND mode for existing execution ${executionId}`);
      this.fileStream = fs.createWriteStream(this.localFilePath, { flags: 'a' });
    } else {
      // Default mode: create new file (original behavior)
      console.log(`[AnalysisLogger] Initialized in WRITE mode for new execution ${executionId}`);
      this.fileStream = fs.createWriteStream(this.localFilePath, { flags: 'w' });
    }

    // NOTE: Incremental uploads disabled to avoid RLS policy conflicts
    // Upload will only happen once at the end via finalize() method
    // this.uploadInterval = setInterval(() => {
    //   this.uploadToSupabase(false);
    // }, 30000);

    console.log(`[AnalysisLogger] Local file: ${this.localFilePath}`);
    console.log(`[AnalysisLogger] Supabase path: ${this.supabaseUploadPath}`);
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

    console.log(`[AnalysisLogger] Started execution ${this.executionId} with ${totalImages} images`);
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

    console.log(`[AnalysisLogger] Logged analysis for ${data.fileName} with ${data.aiResponse.totalVehicles || 1} vehicles`);
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

    this.writeLine(event);

    console.log(`[AnalysisLogger] Correction: ${message}`);
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

    this.writeLine(event);

    const fuzzyInfo = data.appliedFuzzyCorrection ?
      ` (attempted fuzzy correction on ${data.fuzzyAttempts?.length || 0} candidates)` : '';

    console.log(`[AnalysisLogger] Unknown number: ${data.detectedNumbers.join(', ')} not found in preset with ${data.participantCount} participants${fuzzyInfo} → ${data.organizationFolder}`);
  }

  /**
   * Log temporal cluster analysis
   */
  logTemporalCluster(data: Omit<TemporalClusterEvent, 'type' | 'timestamp' | 'executionId'>): void {
    const event: TemporalClusterEvent = {
      type: 'TEMPORAL_CLUSTER',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...data
    };

    this.stats.temporalClusters++;
    this.writeLine(event);
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
      } else if (errorData.severity === 'recoverable') {
        console.warn(`[AnalysisLogger] Recoverable error:`, errorData.message);
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

    console.log(`[AnalysisLogger] Execution completed:`, {
      processed: totalProcessed,
      successful,
      corrections: this.stats.corrections,
      timeMs: processingTimeMs
    });
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
   * Write a line to the JSONL file
   */
  private writeLine(data: any): void {
    try {
      const line = JSON.stringify(data) + '\n';
      this.fileStream.write(line);
    } catch (error) {
      console.error('[AnalysisLogger] Error writing line:', error);
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
          console.warn('[ADMIN] ⚠️ Local JSONL file does not exist for upload:', this.localFilePath);
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
          console.error(`[ADMIN] ❌ JSONL upload attempt ${attempt}/${maxRetries} failed:`, {
            message: error.message,
            path: this.supabaseUploadPath,
            fileSize: fileContent.length,
            localPath: this.localFilePath
          });

          if (attempt === maxRetries) {
            console.error(`[ADMIN] ❌ All JSONL upload attempts failed. File available locally at: ${this.localFilePath}`);
            return false;
          }

          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        } else {
          console.log(`[ADMIN] ✅ JSONL upload successful (attempt ${attempt}): ${this.supabaseUploadPath}`);

          // If final upload, create metadata record
          if (final) {
            const metadataSuccess = await this.createLogMetadata();
            if (!metadataSuccess) {
              console.warn(`[ADMIN] ⚠️ JSONL uploaded but metadata creation failed`);
            }
          }

          return true; // Success
        }

      } catch (error) {
        console.error(`[ADMIN] ❌ JSONL upload attempt ${attempt}/${maxRetries} exception:`, error);

        if (attempt === maxRetries) {
          console.error(`[ADMIN] ❌ All JSONL upload attempts failed due to exceptions. File available locally at: ${this.localFilePath}`);
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
          console.error(`[ADMIN] ❌ Metadata creation attempt ${attempt}/${maxRetries} failed:`, error);

          if (attempt === maxRetries) {
            console.error('[ADMIN] ❌ All metadata creation attempts failed');
            return false;
          }

          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        } else {
          console.log(`[ADMIN] ✅ Metadata record created successfully (attempt ${attempt})`);
          return true; // Success
        }

      } catch (error) {
        console.error(`[ADMIN] ❌ Metadata creation attempt ${attempt}/${maxRetries} exception:`, error);

        if (attempt === maxRetries) {
          console.error('[ADMIN] ❌ All metadata creation attempts failed due to exceptions');
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

      // Close file stream
      if (this.fileStream && !this.fileStream.destroyed) {
        await new Promise<void>((resolve) => {
          this.fileStream.end(() => resolve());
        });
      }

      // Final upload
      const uploadSuccess = await this.uploadToSupabase(true);

      if (!uploadSuccess) {
        console.warn(`[ADMIN] ⚠️ JSONL upload failed - log only available locally at: ${this.localFilePath}`);
        return null;
      }

      const publicUrl = this.getPublicUrl();
      console.log(`[ADMIN] ✅ Analysis log finalized and available at: ${publicUrl}`);

      return publicUrl;

    } catch (error) {
      console.error('[ADMIN] ❌ Error finalizing JSONL:', error);
      console.warn(`[ADMIN] ⚠️ Log file available locally at: ${this.localFilePath}`);
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
   */
  cleanup(): void {
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
      this.uploadInterval = null;
    }

    if (this.fileStream && !this.fileStream.destroyed) {
      this.fileStream.destroy();
    }
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