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
import { DEBUG_MODE } from '../config';
import type { HardwareInfo } from './hardware-detector';
import type { NetworkMetrics } from './network-monitor';
import type { PhaseTimings } from './performance-timer';
import type { ErrorEvent as TrackedError, ErrorSummary } from './error-tracker';

export interface LogEvent {
  type:
    | 'EXECUTION_START'
    | 'IMAGE_ANALYSIS'
    | 'CORRECTION'
    | 'TEMPORAL_CLUSTER'
    | 'PARTICIPANT_MATCH'
    | 'UNKNOWN_NUMBER'
    | 'EXECUTION_COMPLETE'
    | 'EXECUTION_META_UPDATE'
    | 'ERROR'
    // v1.2.0+ — edge-function persistence channel (persistOnnxAnalysis):
    //   PERSIST_FAILED    — a local-ONNX analysis row did NOT land in analysis_results
    //                       (edge function returned it in failures[] or a batch failed
    //                       after retries). JSONL is still the durable record.
    //   PERSIST_RECOVERED — the reconciliation pass successfully retried a row that
    //                       was previously PERSIST_FAILED. Lets the support digest
    //                       show "N failed, M recovered" instead of just counting
    //                       failures.
    | 'PERSIST_FAILED'
    | 'PERSIST_RECOVERED';
  timestamp: string;
  executionId: string;
}

export interface ExecutionStartEvent extends LogEvent {
  type: 'EXECUTION_START';
  totalImages: number;
  category: string;
  participantPresetId?: string;
  participantPreset?: {
    id: string;
    name: string;
    participantCount: number;
  };
  /** Source folder path the user selected for this execution (used for at-a-glance identification on the Home page) */
  folderPath?: string;
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
    x: number;      // Percentage 0-100 from left edge (or pixels for non-normalized sources)
    y: number;      // Percentage 0-100 from top edge (or pixels for non-normalized sources)
    width: number;  // Percentage 0-100 of image width (or pixels for non-normalized sources)
    height: number; // Percentage 0-100 of image height (or pixels for non-normalized sources)
  };
  // Segmentation mask info (YOLOv8-seg) - full mask data NOT stored (too large)
  segmentation?: {
    used: boolean;           // Was segmentation mask applied
    cocoClass: string;       // 'car', 'motorcycle', 'person', etc.
    cocoClassId: number;     // COCO class ID (2=car, 3=motorcycle, 0=person)
    maskConfidence: number;  // Segmentation confidence (0-1)
    maskedOthers: number;    // Number of other subjects masked out in this crop
  };
  modelSource?: 'gemini' | 'local-onnx' | 'gemini-v6-seg';  // Recognition method used for this vehicle
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
  // Supabase analysis_results.image_id (UUID). Separate from the legacy client-side imageId
  // (format: `img_{index}_{timestamp}`) to allow DB updates for user corrections.
  // Optional for backward compatibility with older JSONL logs.
  dbImageId?: string;
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
  // Path after folder organization (move/copy)
  organizedPath?: string;
  // Recognition method tracking
  recognitionMethod?: 'gemini' | 'local-onnx' | 'gemini-v6-seg' | 'face_recognition';
  // Original image dimensions for bbox mapping (especially useful for local-onnx)
  imageSize?: { width: number; height: number };
  // ONNX preprocessing method used (determines bbox coordinate space)
  // 'stretch': bbox in stretched input space, 'letterbox': bbox in original image space (unletterboxed)
  preprocessingMethod?: 'stretch' | 'letterbox';
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
  // Scene classification (ONNX) — populated when sport_categories.scene_classifier_enabled = true
  // sceneCategory: 'crowd_scene' | 'garage_pitlane' | 'podium_celebration' | 'portrait_paddock' | 'racing_action'
  sceneCategory?: string;
  sceneConfidence?: number;
  // True when AI analysis was skipped (e.g. crowd_scene above threshold). Undefined/false means the image went through AI normally.
  sceneSkipped?: boolean;
  // Per-image error/warning tracking for debugging processing issues
  processingErrors?: Array<{
    phase: string;         // e.g., 'upload', 'onnx-detection', 'gemini-v6', 'crop-context', 'standard-analysis'
    message: string;       // Error message
    recoverable: boolean;  // Whether processing continued after this error
    timestamp: string;     // ISO timestamp of when the error occurred
  }>;
  processingWarnings?: Array<{
    phase: string;         // e.g., 'yolo-seg', 'v6-fullimage', 'defensive-upload'
    message: string;       // Warning message
    timestamp: string;     // ISO timestamp
  }>;
  // Metadata writing status
  metadataWritten?: boolean;
  metadataSkipReason?: string;
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
  // Recognition method statistics
  recognitionStats?: {
    method: 'gemini' | 'local-onnx' | 'mixed';
    // Local ONNX metrics
    localOnnxInferenceMs?: number;         // Total local inference time
    localOnnxDetections?: number;          // Total local detections
  };
}

/**
 * Lightweight metadata update event – written AFTER the run (e.g. user renames the
 * execution from the completion screen or the Home page). Appended to the JSONL file
 * so the log remains the single source of truth for local executions.
 *
 * Multiple updates are allowed; readers should use the MOST RECENT update.
 */
export interface ExecutionMetaUpdateEvent extends LogEvent {
  type: 'EXECUTION_META_UPDATE';
  /** Custom display name chosen by the user ("Giro di Lombardia 2026", etc.) */
  executionName?: string;
}

/**
 * Emitted when a local-ONNX analysis row failed to reach `analysis_results`.
 *
 * The edge function `persistOnnxAnalysis` reports per-row failures either
 * inline in its 207 Multi-Status response (code comes from Postgres, e.g.
 * '57014' / '23503' / 'image_not_found'), or the client may emit one per
 * row when a whole batch errors out (code = 'retries_exhausted',
 * 'invoke_500', 'no_auth', etc.).
 *
 * The reconciliation pass (and the external backfill script) reads these
 * events at finalize-time to rebuild the retry queue. Crucially, the FULL
 * `analysis_results` row payload is carried in `rowData` so reconciliation
 * can retry the INSERT verbatim — no need to reconstruct it from the lossy
 * IMAGE_ANALYSIS translation. This makes the JSONL the true durable source
 * of truth: even if the app crashes mid-execution, the on-disk PERSIST_FAILED
 * events are self-contained for retry on next launch.
 *
 * The extra bytes are only paid on rows that actually failed (rare in normal
 * operation) — successful rows carry no payload duplication.
 */
export interface PersistFailedEvent extends LogEvent {
  type: 'PERSIST_FAILED';
  imageId: string;
  /** Postgres code (57014, 23503, …) or client-side marker (retries_exhausted, invoke_500, …) */
  code: string;
  message: string;
  /**
   * Where the failure was observed:
   *   'chunk'     — edge function reported it in the pre-insert phase
   *                 (e.g. image row missing) or whole-batch failed
   *   'row'       — edge function's per-row fallback rejected this specific row
   *   'batch'     — client-side whole-batch failure (invoke error, retries exhausted)
   *   'reconcile' — reconciliation pass re-attempted the row and it failed again
   */
  stage: string;
  /**
   * Full analysis_results row payload — same object passed to `persistOnnxAnalysis`.
   * Present for failures originating client-side (batch/row/chunk/reconcile).
   * Optional for backward compatibility with older JSONL files (< v1.2.0) and
   * for pathological cases where the payload was unavailable at emit time.
   */
  rowData?: Record<string, any>;
}

/**
 * Emitted when the reconciliation pass successfully persists a row that
 * was previously reported as PERSIST_FAILED. Pairs 1:1 with an earlier
 * PERSIST_FAILED event for the same imageId.
 */
export interface PersistRecoveredEvent extends LogEvent {
  type: 'PERSIST_RECOVERED';
  imageId: string;
  /** How many attempts it took (client-side retries during reconciliation, 1-based) */
  attempts: number;
  /** Source of the recovery — mirrors the persistOnnxAnalysis `source` field */
  source: 'reconcile' | 'backfill';
}

/**
 * Suffix appended to the JSONL filename to mark a successful upload.
 * Used by both AnalysisLogger.finalize() and the JSONL upload reconciler.
 *
 * The marker's presence is a fast-path local cache: it lets the reconciler
 * skip a Supabase round-trip for files we already know are uploaded.
 * Authoritative truth remains the analysis_log_metadata row on the server.
 */
export const UPLOAD_MARKER_SUFFIX = '.uploaded';

/**
 * Atomically write the upload marker for a JSONL file. Fsync'd so the marker
 * survives a crash immediately after.
 *
 * Best-effort: any failure is logged and swallowed. The reconciler will
 * recover by querying the metadata table.
 */
export function writeUploadedMarker(jsonlPath: string): void {
  const markerPath = jsonlPath + UPLOAD_MARKER_SUFFIX;
  try {
    // Open + write empty + fsync + close. We don't use writeFileSync alone
    // because we want fsync durability — losing the marker on a power cut
    // wastes a Supabase query but is still correct.
    const fd = fs.openSync(markerPath, 'w');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    // Defensive: never throw from a marker write. The metadata row is the
    // ground truth; the marker is just an optimisation.
    if (DEBUG_MODE) {
      console.warn('[AnalysisLogger] Failed to write upload marker:', markerPath, err);
    }
  }
}

/**
 * @returns true if the marker file exists, false otherwise (incl. on stat errors).
 */
export function hasUploadedMarker(jsonlPath: string): boolean {
  try {
    return fs.existsSync(jsonlPath + UPLOAD_MARKER_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Filename suffix for the sidecar JSON describing a finished execution.
 * The home page (`get-local-executions`) uses this as a fallback when the
 * primary JSONL is missing or has a corrupt EXECUTION_START line. Without
 * the sidecar, an analysis whose JSONL gets corrupted (truncated header,
 * partial flush before crash, etc.) disappears from the home view even
 * though the work was paid for and the data is in the cloud DB.
 *
 * Filename pattern: `exec_{id}.jsonl.summary.json` (sits next to the JSONL
 * for easy correlation; survives independently if the JSONL is deleted).
 */
export const SUMMARY_SIDECAR_SUFFIX = '.summary.json';

/**
 * Shape of the sidecar — intentionally a STRICT subset of the fields the
 * home page renderer needs (`get-local-executions`), so we never carry
 * invalidated state. Versioned so future schema changes can be detected.
 */
export interface ExecutionSummary {
  schemaVersion: 1;
  id: string;
  createdAt: string; // ISO
  completedAt: string; // ISO
  status: 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  sportCategory: string;
  totalImages: number;
  imagesWithNumbers: number;
  folderPath: string;
  executionName: string | null;
  participantPreset: {
    id: string;
    name: string;
    participantCount: number;
  } | null;
  /** UserId at the time of writing — lets the home page filter on shared machines. */
  userId: string | null;
  /** App version that wrote the sidecar — useful for back-compat triage. */
  appVersion: string | null;
}

/**
 * Atomically write the execution summary sidecar.
 *
 * Strategy: write to `<path>.summary.json.tmp`, fsync, rename. The rename is
 * atomic on the same filesystem, so a reader can never see a partial JSON.
 *
 * Best-effort: any failure is swallowed and logged in DEBUG_MODE only. The
 * sidecar is a recovery aid; absence of it is not fatal.
 */
export function writeExecutionSummary(
  jsonlPath: string,
  summary: Omit<ExecutionSummary, 'schemaVersion'>
): void {
  const finalPath = jsonlPath + SUMMARY_SIDECAR_SUFFIX;
  const tmpPath = finalPath + '.tmp';
  const payload: ExecutionSummary = { schemaVersion: 1, ...summary };
  let tmpFd: number | null = null;
  try {
    const json = JSON.stringify(payload);
    tmpFd = fs.openSync(tmpPath, 'w');
    fs.writeSync(tmpFd, json);
    try {
      fs.fsyncSync(tmpFd);
    } catch {
      // fsync may fail on some FS (e.g. SMB shares); proceed anyway.
    }
    fs.closeSync(tmpFd);
    tmpFd = null;
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    if (DEBUG_MODE) {
      console.warn('[AnalysisLogger] Failed to write summary sidecar:', finalPath, err);
    }
    // Cleanup leftover tmp on failure — best-effort.
    try {
      if (tmpFd !== null) fs.closeSync(tmpFd);
    } catch {}
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Read and validate an execution summary sidecar. Returns null on missing,
 * parse error, or schema mismatch. NEVER throws.
 */
export function readExecutionSummary(jsonlPath: string): ExecutionSummary | null {
  const summaryPath = jsonlPath + SUMMARY_SIDECAR_SUFFIX;
  try {
    if (!fs.existsSync(summaryPath)) return null;
    const raw = fs.readFileSync(summaryPath, 'utf-8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (obj.schemaVersion !== 1) return null;
    if (typeof obj.id !== 'string' || !obj.id) return null;
    return obj as ExecutionSummary;
  } catch {
    return null;
  }
}

// ===========================================================================
// Privacy/portability sanitizer
// ===========================================================================
//
// Vehicles produced by the smart-matcher carry a `participantMatch.entry`
// payload that, in turn, may include `folder_1_path` / `folder_2_path` /
// `folder_3_path` — absolute paths from the photographer's filesystem
// (e.g. "/Users/<name>/Desktop/Client X/...").
//
// These absolute paths leak personal info (computer name, home directory,
// client folder structure) into:
//   - the JSONL log we keep on disk and sync to Supabase Storage,
//   - downstream `analysis_results.raw_response` rows that mirror the
//     vehicles array,
//   - any future cross-machine reconstruction (paths from machine A would
//     never resolve on machine B anyway).
//
// We strip them at the boundary between in-memory state (where they're
// useful at runtime) and any persistence layer. Folder NAMES (`folder_1`,
// `folder_2`, `folder_3`) and `folders[]` are kept — they're enough to
// reconstruct the destination on any machine.

const ABSOLUTE_PATH_KEYS = ['folder_1_path', 'folder_2_path', 'folder_3_path'] as const;

/**
 * Returns a shallow-cloned vehicles array with `participantMatch.entry`'s
 * absolute path fields removed. Inputs are NOT mutated. Safe to pass any
 * shape — non-objects are returned as-is.
 *
 * @internal exported for use by persistence sites that bypass logImageAnalysis
 *           (e.g. direct `analysis_results` inserts that build their own
 *           payload). Most callers should not need this — go through
 *           `logImageAnalysis` instead.
 */
export function stripAbsolutePathsFromVehicles<T = any>(vehicles: T[] | undefined): T[] {
  if (!Array.isArray(vehicles)) return vehicles as any;
  return vehicles.map(stripAbsolutePathsFromVehicle);
}

function stripAbsolutePathsFromVehicle<T>(vehicle: T): T {
  if (!vehicle || typeof vehicle !== 'object') return vehicle;
  const v: any = vehicle;
  if (!v.participantMatch || typeof v.participantMatch !== 'object') return vehicle;

  const entry = v.participantMatch.entry;
  if (!entry || typeof entry !== 'object') return vehicle;

  let touched = false;
  const cleanEntry: any = { ...entry };
  for (const key of ABSOLUTE_PATH_KEYS) {
    if (key in cleanEntry) {
      delete cleanEntry[key];
      touched = true;
    }
  }
  if (!touched) return vehicle;

  return {
    ...v,
    participantMatch: {
      ...v.participantMatch,
      entry: cleanEntry,
    },
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
    corrections: { OCR: 0, TEMPORAL: 0, FUZZY: 0, PARTICIPANT: 0, SPONSOR: 0, FAST_TRACK: 0, USER_MANUAL: 0 },
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
    systemEnvironment?: ExecutionStartEvent['systemEnvironment'],
    participantPreset?: ExecutionStartEvent['participantPreset'],
    folderPath?: string
  ): void {
    const event: ExecutionStartEvent = {
      type: 'EXECUTION_START',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      totalImages,
      category: this.category,
      participantPresetId,
      participantPreset,
      folderPath,
      userId: this.userId,
      appVersion: app.getVersion(),
      systemEnvironment // Optional enhanced telemetry
    };

    this.stats.totalImages = totalImages;
    this.writeLine(event);
  }

  /**
   * Append an EXECUTION_META_UPDATE event to the JSONL log.
   *
   * Used when the user renames an execution from the completion screen or the
   * Home page. Because this may run AFTER {@link finalize}, we open the file in
   * append mode on demand rather than relying on the persistent fileStream.
   *
   * Safe to call on a finalized logger or a read-only logger — the write
   * happens against the file on disk, not the (possibly closed) stream.
   */
  static async appendExecutionMetaUpdate(
    executionId: string,
    executionName: string
  ): Promise<boolean> {
    try {
      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const filePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      // If the file doesn't exist we cannot rename a non-existing execution.
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const event: ExecutionMetaUpdateEvent = {
        type: 'EXECUTION_META_UPDATE',
        timestamp: new Date().toISOString(),
        executionId,
        executionName
      };

      await fs.promises.appendFile(filePath, JSON.stringify(event) + '\n', 'utf-8');
      return true;
    } catch (error) {
      console.error('[AnalysisLogger] Failed to append EXECUTION_META_UPDATE:', error);
      return false;
    }
  }

  /**
   * Log complete image analysis (now supports multi-vehicle scenarios)
   *
   * Privacy/portability: vehicle `participantMatch.entry` payloads are
   * sanitized via `stripAbsolutePathsFromVehicles` before persistence so that
   * (a) absolute filesystem paths from the user's home directory never enter
   * the JSONL or downstream DB, and (b) the resulting payload is portable
   * across machines (folder NAMES are kept; only the per-machine absolute
   * resolution is stripped).
   */
  logImageAnalysis(data: Omit<ImageAnalysisEvent, 'type' | 'timestamp' | 'executionId'>): void {
    const sanitizedData = {
      ...data,
      aiResponse: data.aiResponse
        ? {
            ...data.aiResponse,
            vehicles: stripAbsolutePathsFromVehicles(data.aiResponse.vehicles),
          }
        : data.aiResponse,
      primaryVehicle: data.primaryVehicle
        ? stripAbsolutePathsFromVehicles([data.primaryVehicle as any])[0]
        : data.primaryVehicle,
    };

    const event: ImageAnalysisEvent = {
      type: 'IMAGE_ANALYSIS',
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
      ...sanitizedData,
    };

    // Update stats (aggregate confidence from all vehicles)
    if (sanitizedData.aiResponse?.vehicles && sanitizedData.aiResponse.vehicles.length > 0) {
      const totalConfidence = sanitizedData.aiResponse.vehicles.reduce((sum, vehicle) => sum + (vehicle.confidence || 0), 0);
      const avgConfidence = totalConfidence / sanitizedData.aiResponse.vehicles.length;
      this.stats.totalConfidence += avgConfidence;
    } else if (sanitizedData.primaryVehicle?.confidence) {
      // Fallback for backward compatibility
      this.stats.totalConfidence += sanitizedData.primaryVehicle.confidence;
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
   * Log that a local-ONNX analysis row did NOT reach `analysis_results`.
   *
   * The JSONL is the authoritative source of truth — every IMAGE_ANALYSIS
   * event is preserved regardless — but PERSIST_FAILED gives the
   * reconciliation pass a precise list of which rows need to be retried.
   *
   * Best-effort: failures to emit this event must never block the processor.
   */
  logPersistFailed(data: Omit<PersistFailedEvent, 'type' | 'timestamp' | 'executionId'>): void {
    try {
      const event: PersistFailedEvent = {
        type: 'PERSIST_FAILED',
        timestamp: new Date().toISOString(),
        executionId: this.executionId,
        ...data,
      };
      this.writeLine(event);
    } catch (error) {
      // Never throw out of logging — writeLine already queues asynchronously
      // and swallows its own errors, so this catch is belt-and-braces.
      console.error('[AnalysisLogger] Failed to log PERSIST_FAILED:', error);
    }
  }

  /**
   * Log that a previously-failed persist has now succeeded. Emitted by the
   * finalize-time reconciliation pass (and the one-shot backfill script).
   *
   * Pair with the earlier PERSIST_FAILED event for the same imageId — a
   * reader of the JSONL can compute "net failures" as
   *   count(PERSIST_FAILED) - count(PERSIST_RECOVERED)
   * grouped by imageId.
   */
  logPersistRecovered(data: Omit<PersistRecoveredEvent, 'type' | 'timestamp' | 'executionId'>): void {
    try {
      const event: PersistRecoveredEvent = {
        type: 'PERSIST_RECOVERED',
        timestamp: new Date().toISOString(),
        executionId: this.executionId,
        ...data,
      };
      this.writeLine(event);
    } catch (error) {
      console.error('[AnalysisLogger] Failed to log PERSIST_RECOVERED:', error);
    }
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
          return `Corrected "${correction.field}" from "${correction.originalValue}" to "${correction.correctedValue}" via burst mode: nearby photos (±${correction.details.maxTimeDiff}ms) all show "${correction.correctedValue}"`;
        } else {
          return `Corrected "${correction.field}" from "${correction.originalValue}" to "${correction.correctedValue}" via temporal proximity: nearby photos confirm "${correction.correctedValue}"`;
        }

      case 'FUZZY':
        const similarity = Math.round((correction.confidence || 0) * 100);
        return `Fuzzy match: "${correction.originalValue}" → "${correction.correctedValue}" (${similarity}% similarity${correction.details?.participantName ? ` with ${correction.details.participantName}` : ''})`;

      case 'PARTICIPANT':
        return `Identified via participant data: ${correction.details?.matchType || 'match'} with ${correction.details?.participantName || 'participant'} (score: ${correction.details?.score || 'N/A'})`;

      case 'SPONSOR':
        return `Recognized sponsor "${correction.correctedValue}" (confidence: ${Math.round((correction.confidence || 0) * 100)}%), confirmed ${correction.field} "${correction.originalValue}"`;

      case 'OCR':
        return `OCR correction: "${correction.originalValue}" → "${correction.correctedValue}" (${correction.reason})`;

      default:
        return correction.reason || `Correction ${correction.correctionType}: ${correction.originalValue} → ${correction.correctedValue}`;
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
      // Refresh the Supabase client to ensure we have a valid auth session
      // The client cached at constructor time may have an expired token or
      // may have been created before auth was fully initialized
      const freshClient = getSupabaseClient();
      if (freshClient) {
        this.supabase = freshClient;
      }

      // Group by type for batch inserts
      const corrections = batch.filter(b => b.type === 'correction').map(b => b.data);
      const clusters = batch.filter(b => b.type === 'cluster').map(b => b.data);
      const unknowns = batch.filter(b => b.type === 'unknown').map(b => b.data);

      const promises: Promise<void>[] = [];

      if (corrections.length > 0) {
        promises.push(
          (async () => {
            const { error } = await this.supabase.from('image_corrections').insert(corrections);
            if (error) {
              console.warn(`[AnalysisLogger] DB write to image_corrections failed (${corrections.length} rows): ${error.message} [code: ${error.code}]`);
            } else if (DEBUG_MODE) {
              console.log(`[AnalysisLogger] ✅ Wrote ${corrections.length} corrections to DB`);
            }
          })()
        );
      }

      if (clusters.length > 0) {
        promises.push(
          (async () => {
            const { error } = await this.supabase.from('temporal_clusters').insert(clusters);
            if (error) {
              console.warn(`[AnalysisLogger] DB write to temporal_clusters failed (${clusters.length} rows): ${error.message} [code: ${error.code}]`);
            }
          })()
        );
      }

      if (unknowns.length > 0) {
        promises.push(
          (async () => {
            const { error } = await this.supabase.from('unknown_numbers').insert(unknowns);
            if (error) {
              console.warn(`[AnalysisLogger] DB write to unknown_numbers failed (${unknowns.length} rows): ${error.message} [code: ${error.code}]`);
            }
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
        // Upload failed — leave the local file in place WITHOUT a marker so the
        // reconciliation job (jsonl-upload-reconciler) can retry on next boot
        // or login. This is the entry point that protects users from losing
        // their analysis when the 15s upload-side timeout in
        // unified-image-processor.ts fires before storage finishes accepting
        // the file (typical for 2k+ image batches on slow uplinks).
        return null;
      }

      // Write the local sentinel so the reconciler can fast-path skip this
      // execution without a Supabase round-trip. Best-effort: a marker write
      // failure does NOT invalidate the upload — the reconciler still has the
      // analysis_log_metadata row as authoritative truth.
      writeUploadedMarker(this.localFilePath);

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
