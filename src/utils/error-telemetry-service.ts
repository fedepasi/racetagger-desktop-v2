/**
 * Error Telemetry Service
 *
 * Automatically detects critical failures, collects diagnostic context,
 * and reports them to Supabase for deduplication and GitHub issue creation.
 *
 * Design principles:
 * - 100% non-blocking: never slows down or crashes the main pipeline
 * - Privacy-first: sanitizes all personal data before transmission
 * - Respects opt-out: checks user preference before reporting
 * - Rate-limited: max 5 per execution, 20 per day per user
 * - Deduplicated: fingerprint-based, one GitHub issue per unique problem
 */

import * as crypto from 'crypto';
import * as os from 'os';
import { app } from 'electron';
import { getSystemInfo, SystemInfo } from './system-info';
import { diagnosticLogger } from './diagnostic-logger';
import { errorTracker } from './error-tracker';

// ============================================================
// Types
// ============================================================

export type ErrorType =
  | 'raw_conversion'
  | 'edge_function'
  | 'onnx_model'
  | 'token_reservation'
  | 'segmentation'
  | 'zero_results'
  | 'memory'
  | 'uncaught';

export type ErrorSeverity = 'fatal' | 'recoverable' | 'warning';

export interface CriticalErrorReport {
  errorType: ErrorType;
  severity: ErrorSeverity;
  error: Error | string;
  executionId?: string;
  batchPhase?: string;
  imageIndex?: number;
  totalImages?: number;
  categoryName?: string;
  presetName?: string;
}

interface QueuedReport {
  fingerprint: string;
  errorType: ErrorType;
  severity: ErrorSeverity;
  errorMessage: string;
  errorStack: string;
  executionId?: string;
  batchPhase?: string;
  imageIndex?: number;
  totalImages?: number;
  appVersion: string;
  osName: string;
  osVersion: string;
  arch: string;
  cpuModel: string;
  ramAvailableGb: number;
  logSnapshot: string;
  executionContext: Record<string, unknown>;
  queuedAt: number;
}

interface TelemetryStatus {
  queued: number;
  sentToday: number;
  enabled: boolean;
}

// ============================================================
// Constants
// ============================================================

const MAX_REPORTS_PER_EXECUTION = 5;
const MAX_REPORTS_PER_DAY = 20;
const FLUSH_INTERVAL_MS = 30_000;       // 30 seconds
const MAX_QUEUE_SIZE = 5;               // Flush when queue reaches this
const LOG_SNAPSHOT_LINES = 2000;        // Lines to read from diagnostic log
const LOG_SNAPSHOT_MAX_OUTPUT = 100;    // Max lines in final snapshot
const LOG_CONTEXT_WINDOW_S = 30;        // Seconds before error to include

// ============================================================
// Privacy Sanitization
// ============================================================

const PRIVACY_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Absolute paths (macOS, Windows, Linux)
  { pattern: /\/Users\/[^\s/]+/g, replacement: '/Users/<REDACTED>' },
  { pattern: /\/home\/[^\s/]+/g, replacement: '/home/<REDACTED>' },
  { pattern: /C:\\Users\\[^\s\\]+/g, replacement: 'C:\\Users\\<REDACTED>' },
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '<EMAIL>' },
  // Full file paths with usernames
  { pattern: /(?:\/Users|\/home|C:\\Users)\/[^\s]+/g, replacement: '<PATH>' },
];

function sanitize(text: string): string {
  if (!text) return '';
  let result = text;
  for (const { pattern, replacement } of PRIVACY_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ============================================================
// Service
// ============================================================

export class ErrorTelemetryService {
  private static instance: ErrorTelemetryService | null = null;

  private queue: QueuedReport[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sentToday = 0;
  private sentTodayResetAt = 0;
  private executionCounters: Map<string, number> = new Map(); // executionId -> count
  private recentFingerprints: Map<string, number> = new Map(); // fingerprint -> timestamp
  private enabled = true;
  private supabaseGetter: (() => any) | null = null;
  private authStateGetter: (() => any) | null = null;
  private disposed = false;

  private constructor() {
    this.resetDailyCounter();
    this.flushTimer = setInterval(() => this.flushQueue(), FLUSH_INTERVAL_MS);
  }

  static getInstance(): ErrorTelemetryService {
    if (!ErrorTelemetryService.instance) {
      ErrorTelemetryService.instance = new ErrorTelemetryService();
    }
    return ErrorTelemetryService.instance;
  }

  /**
   * Initialize with Supabase and auth getters.
   * Must be called once during app startup (after IPC context is ready).
   */
  initialize(
    supabaseGetter: () => any,
    authStateGetter: () => any
  ): void {
    this.supabaseGetter = supabaseGetter;
    this.authStateGetter = authStateGetter;
    console.log('[ErrorTelemetry] Service initialized');
  }

  /**
   * Set enabled/disabled (opt-out support)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[ErrorTelemetry] Telemetry ${enabled ? 'enabled' : 'disabled'}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Main API: Report a critical error.
   * Completely synchronous from the caller's perspective — queues internally.
   * NEVER throws.
   */
  reportCriticalError(report: CriticalErrorReport): void {
    try {
      if (this.disposed || !this.enabled) return;

      // Rate limit: daily
      this.checkDailyReset();
      if (this.sentToday + this.queue.length >= MAX_REPORTS_PER_DAY) {
        return;
      }

      // Rate limit: per execution
      if (report.executionId) {
        const execCount = this.executionCounters.get(report.executionId) || 0;
        if (execCount >= MAX_REPORTS_PER_EXECUTION) {
          return;
        }
        this.executionCounters.set(report.executionId, execCount + 1);
      }

      // Build report
      const errorObj = report.error instanceof Error ? report.error : new Error(String(report.error));
      const errorMessage = sanitize(errorObj.message || String(report.error));
      const errorStack = sanitize(errorObj.stack || '');

      const fingerprint = this.generateFingerprint(
        report.errorType,
        errorMessage,
        report.batchPhase || '',
        os.platform()
      );

      // Deduplicate: same fingerprint within 5 minutes = skip
      const lastSeen = this.recentFingerprints.get(fingerprint);
      if (lastSeen && Date.now() - lastSeen < 5 * 60 * 1000) {
        return;
      }
      this.recentFingerprints.set(fingerprint, Date.now());

      // Collect system info
      let systemInfo: SystemInfo;
      try {
        systemInfo = getSystemInfo();
      } catch {
        systemInfo = {
          client_version: app?.getVersion?.() || 'unknown',
          client_build_number: '',
          operating_system: os.platform(),
          os_version: os.release(),
          system_arch: os.arch(),
          client_session_id: '',
          client_machine_id: ''
        };
      }

      // Smart log snapshot
      const logSnapshot = this.getSmartLogSnapshot(errorMessage);

      // Build execution context
      const executionContext: Record<string, unknown> = {};
      if (report.categoryName) executionContext.category = report.categoryName;
      if (report.presetName) executionContext.preset = report.presetName;

      const queuedReport: QueuedReport = {
        fingerprint,
        errorType: report.errorType,
        severity: report.severity,
        errorMessage: errorMessage.substring(0, 500),
        errorStack: errorStack.substring(0, 1000),
        executionId: report.executionId,
        batchPhase: report.batchPhase,
        imageIndex: report.imageIndex,
        totalImages: report.totalImages,
        appVersion: systemInfo.client_version,
        osName: systemInfo.operating_system,
        osVersion: systemInfo.os_version,
        arch: systemInfo.system_arch,
        cpuModel: os.cpus()?.[0]?.model || 'unknown',
        ramAvailableGb: Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10,
        logSnapshot,
        executionContext,
        queuedAt: Date.now()
      };

      this.queue.push(queuedReport);

      // Also track in error-tracker for local visibility
      errorTracker.trackError(
        errorObj,
        report.severity,
        undefined,
        {
          phase: report.batchPhase,
          imageId: report.executionId
        }
      );

      // Flush if queue is full
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        this.flushQueue();
      }
    } catch (err) {
      // NEVER throw from telemetry
      console.warn('[ErrorTelemetry] Failed to queue report (safe):', err);
    }
  }

  /**
   * Get current telemetry status
   */
  getStatus(): TelemetryStatus {
    this.checkDailyReset();
    return {
      queued: this.queue.length,
      sentToday: this.sentToday,
      enabled: this.enabled
    };
  }

  /**
   * Reset execution counter (call at start of new batch)
   */
  resetExecutionCounter(executionId: string): void {
    this.executionCounters.delete(executionId);
  }

  /**
   * Force flush the queue (for testing/admin)
   */
  forceFlush(): void {
    this.flushQueue();
  }

  /**
   * Cleanup on app shutdown
   */
  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Best-effort final flush
    this.flushQueue();
  }

  // ============================================================
  // Private: Fingerprint Generation
  // ============================================================

  private generateFingerprint(
    errorType: string,
    normalizedMessage: string,
    batchPhase: string,
    platform: string
  ): string {
    // Normalize the message: remove numbers, specific file names, timestamps
    const normalized = normalizedMessage
      .replace(/\d+/g, 'N')          // Replace all numbers
      .replace(/\.[a-zA-Z]{2,4}/g, '.EXT')  // Replace file extensions
      .substring(0, 100);             // First 100 chars

    const input = `${errorType}::${normalized}::${batchPhase}::${platform}`;
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 32);
  }

  // ============================================================
  // Private: Smart Log Snapshot
  // ============================================================

  private getSmartLogSnapshot(errorMessage: string): string {
    try {
      const rawLogs = diagnosticLogger.getRecentLogs(LOG_SNAPSHOT_LINES);
      if (!rawLogs) return '[No logs available]';

      const lines = rawLogs.split('\n');
      if (lines.length === 0) return '[Empty logs]';

      // Strategy: take the last LOG_CONTEXT_WINDOW_S seconds of logs,
      // prioritize ERROR/WARN lines, and lines containing error keywords
      const errorKeywords = this.extractKeywords(errorMessage);
      const now = Date.now();

      const scored: Array<{ line: string; score: number; index: number }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        let score = 0;

        // Higher score for recent lines (closer to end = more recent)
        score += (i / lines.length) * 2;

        // Higher score for error/warn lines
        if (/\[ERROR\]|ERROR|error:|FATAL/i.test(line)) score += 5;
        if (/\[WARN\]|WARN|warning:/i.test(line)) score += 3;

        // Higher score for lines containing error keywords
        for (const keyword of errorKeywords) {
          if (line.toLowerCase().includes(keyword.toLowerCase())) {
            score += 4;
            break;
          }
        }

        // Higher score for processing-related lines
        if (/\[UnifiedProcessor\]|\[EdgeFunction\]|\[ModelManager\]|\[GenericSegmenter\]|\[PreAuth\]|\[Finalize\]/i.test(line)) {
          score += 2;
        }

        scored.push({ line, score, index: i });
      }

      // Sort by score descending, take top lines
      scored.sort((a, b) => b.score - a.score);
      const topLines = scored.slice(0, LOG_SNAPSHOT_MAX_OUTPUT);

      // Re-sort by original index for chronological order
      topLines.sort((a, b) => a.index - b.index);

      const snapshot = topLines.map(l => l.line).join('\n');
      return sanitize(snapshot);
    } catch (err) {
      return `[Log snapshot error: ${err}]`;
    }
  }

  private extractKeywords(errorMessage: string): string[] {
    // Extract meaningful words from error message for log filtering
    const words = errorMessage
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5);
    return words;
  }

  // ============================================================
  // Private: Queue Flushing
  // ============================================================

  private flushQueue(): void {
    if (this.queue.length === 0 || this.disposed) return;
    if (!this.supabaseGetter || !this.authStateGetter) {
      console.warn('[ErrorTelemetry] Not initialized, skipping flush');
      return;
    }

    // Take all queued reports
    const batch = this.queue.splice(0);

    // Process async without blocking
    this.sendBatch(batch).catch(err => {
      console.warn('[ErrorTelemetry] Batch send failed (safe):', err);
    });
  }

  private async sendBatch(batch: QueuedReport[]): Promise<void> {
    let supabase: any;
    let authState: any;

    try {
      supabase = this.supabaseGetter!();
      authState = this.authStateGetter!();
    } catch {
      console.warn('[ErrorTelemetry] Failed to get Supabase/auth, dropping batch');
      return;
    }

    if (!supabase || !authState?.isAuthenticated || !authState?.session?.access_token) {
      return; // Can't send without auth
    }

    for (const report of batch) {
      try {
        await this.sendSingleReport(supabase, authState, report);
        this.sentToday++;
      } catch (err) {
        console.warn(`[ErrorTelemetry] Failed to send report ${report.fingerprint}:`, err);
      }
    }
  }

  private async sendSingleReport(
    supabase: any,
    authState: any,
    report: QueuedReport
  ): Promise<void> {
    // Call Edge Function which handles:
    // 1. upsert_error_report RPC
    // 2. GitHub issue creation/comment
    const { data, error } = await supabase.functions.invoke('report-automatic-error', {
      body: {
        fingerprint: report.fingerprint,
        errorType: report.errorType,
        severity: report.severity,
        errorMessage: report.errorMessage,
        errorStack: report.errorStack,
        executionId: report.executionId,
        batchPhase: report.batchPhase,
        imageIndex: report.imageIndex,
        totalImages: report.totalImages,
        appVersion: report.appVersion,
        os: report.osName,
        osVersion: report.osVersion,
        arch: report.arch,
        cpuModel: report.cpuModel,
        ramAvailableGb: report.ramAvailableGb,
        logSnapshot: report.logSnapshot,
        executionContext: report.executionContext
      },
      headers: {
        Authorization: `Bearer ${authState.session.access_token}`
      }
    });

    if (error) {
      console.warn(`[ErrorTelemetry] Edge Function error:`, error.message || error);
    } else if (data?.success) {
      const isNew = data.isNewFingerprint ? ' (NEW)' : '';
      console.log(`[ErrorTelemetry] Report sent: ${report.errorType}${isNew} → Issue #${data.issueNumber || 'pending'}`);
    }
  }

  // ============================================================
  // Private: Daily Counter
  // ============================================================

  private resetDailyCounter(): void {
    const now = Date.now();
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    this.sentTodayResetAt = tomorrow.getTime();
    this.sentToday = 0;
  }

  private checkDailyReset(): void {
    if (Date.now() >= this.sentTodayResetAt) {
      this.resetDailyCounter();
    }
  }
}

// Export singleton
export const errorTelemetryService = ErrorTelemetryService.getInstance();
