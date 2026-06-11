/**
 * JSONL Upload Reconciler
 * ============================================================================
 * Recovers from JSONL uploads that did not reach Supabase storage at the end
 * of an analysis. The original upload happens inside `AnalysisLogger.finalize()`
 * and is bounded by a 15-second race in `unified-image-processor.ts`. Large
 * batches (2k+ images) on slow uplinks routinely lose that race, leaving a
 * complete local file that never appears on the cloud.
 *
 * SOURCE OF TRUTH
 * ---------------
 *  - A row in `analysis_log_metadata` with the matching `execution_id` ⟺ the
 *    JSONL was uploaded successfully (the row is written ONLY after a successful
 *    storage upload, see AnalysisLogger.createLogMetadata).
 *  - A local sentinel file `<jsonl>.uploaded` is a fast-path cache for the same
 *    information, populated by `writeUploadedMarker()` after every successful
 *    upload (whether the original finalize() or this reconciler).
 *
 * GUARANTEES
 * ----------
 *  - **Idempotent**: re-running the reconciler on the same state is a no-op.
 *  - **Concurrency-safe**: an in-process promise guard ensures one pass at a time.
 *    Caller-side debouncing (e.g. on home open) is still recommended to avoid
 *    cluttering logs.
 *  - **Defensive**: every external IO is wrapped in try/catch; the function
 *    NEVER throws. The result object reports failures in `errors[]`.
 *  - **Bounded**: refuses to upload files larger than `MAX_FILE_SIZE_BYTES`
 *    (cap against runaway corruption).
 *  - **Auth-aware**: bails out early if there is no authenticated user. Does
 *    NOT touch the network in that case.
 *
 * NON-GOALS
 * ---------
 *  - Does NOT validate JSONL contents beyond extracting EXECUTION_START. A
 *    corrupted file is uploaded as-is so an admin can inspect it.
 *  - Does NOT delete or rename source files. Local data is sacred.
 *  - Does NOT make `get-local-executions` fall back to the database. That's
 *    a separate fix — see /docs/jsonl-recovery.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { app } from 'electron';
import {
  UPLOAD_MARKER_SUFFIX,
  writeUploadedMarker,
  hasUploadedMarker,
} from './analysis-logger';

// ===========================================================================
// Public API
// ===========================================================================

export interface ReconcileResult {
  /** Total exec_*.jsonl files inspected. */
  scanned: number;
  /** Files with an existing local marker — fast-path skip, no network. */
  alreadyUploaded: number;
  /** No marker, but a metadata row was found server-side → marker written. */
  confirmedRemote: number;
  /** Files we successfully (re-)uploaded during this pass. */
  uploaded: number;
  /** Upload was attempted and failed (will retry on next trigger). */
  failed: number;
  /** Files belonging to other users in shared workstation scenarios. */
  skippedOtherUser: number;
  /** Files we couldn't parse (no EXECUTION_START, file too large, etc.). */
  skippedInvalid: number;
  /** Wall-clock duration. */
  durationMs: number;
  /** Per-file error reasons, capped to 20 entries to keep logs readable. */
  errors: Array<{ file: string; reason: string }>;
  /** True iff we bailed before scanning (no auth, missing dir, etc.). */
  noop: boolean;
  noopReason?: string;
}

export interface ReconcilerDeps {
  /** Logs directory. Defaults to userData/.analysis-logs. */
  getLogsDir?: () => string;
  /** Authenticated Supabase client. */
  getSupabase: () => SupabaseClient;
  /** Current user id. Reconciler is a no-op when this returns null/undefined. */
  getCurrentUserId: () => string | null | undefined;
  /** Override for tests. Default: real storage upload. */
  uploadFile?: UploadFn;
  /** Override for tests. Default: real metadata insert. */
  insertMetadata?: InsertMetadataFn;
  /** Override for tests. Default: console.* with [JsonlReconciler] prefix. */
  log?: LogFn;
  /** Override for tests. Default: Date.now. */
  now?: () => number;
  /** Override for tests. Defaults to module-level constants below. */
  config?: Partial<ReconcilerConfig>;
}

export interface ReconcilerConfig {
  /** Hard cap to refuse uploading suspiciously large files. */
  maxFileSizeBytes: number;
  /** Per-file upload retry count (independent of the in-AnalysisLogger retry). */
  maxUploadRetries: number;
  /** Initial backoff between retries (ms). Doubled each attempt. */
  retryBaseMs: number;
  /** Per-execution-id query batch size when checking metadata. */
  queryBatchSize: number;
  /** Max files to process per pass. Older files run on next pass. */
  maxFilesPerPass: number;
  /** Storage bucket name. */
  bucket: string;
}

const DEFAULT_CONFIG: ReconcilerConfig = {
  maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  maxUploadRetries: 3,
  retryBaseMs: 1000,
  queryBatchSize: 50,
  maxFilesPerPass: 25,
  bucket: 'analysis-logs',
};

type LogFn = (level: 'info' | 'warn' | 'error', msg: string, ctx?: any) => void;

type UploadFn = (params: {
  supabase: SupabaseClient;
  bucket: string;
  storagePath: string;
  fileContent: Buffer;
}) => Promise<{ success: boolean; error?: string }>;

type InsertMetadataFn = (params: {
  supabase: SupabaseClient;
  executionId: string;
  userId: string;
  storagePath: string;
  totalImages: number;
  category: string | null;
  appVersion: string | null;
}) => Promise<{ success: boolean; error?: string }>;

// ===========================================================================
// In-process concurrency guard
// ===========================================================================

let inFlight: Promise<ReconcileResult> | null = null;

/**
 * Run a reconciliation pass. Multiple concurrent calls share the same
 * underlying pass — the first call schedules it, subsequent calls await
 * the same promise.
 */
export function reconcilePendingUploads(
  deps: ReconcilerDeps
): Promise<ReconcileResult> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = doReconcile(deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Test helper: clears the in-flight guard so unit tests can run multiple
 * sequential passes within the same module instance.
 */
export function __resetReconcilerForTests(): void {
  inFlight = null;
  lastTriggerAt = 0;
}

/**
 * Per-process debounce window. Triggers fired closer than this to a previous
 * one are ignored. Boot, login, and home-open all funnel through here, so
 * this protects against the obvious "all three fire within 2s of cold boot"
 * scenario.
 */
const TRIGGER_DEBOUNCE_MS = 30_000;

let lastTriggerAt = 0;

/**
 * Fire-and-forget reconciliation trigger with a 30s per-process debounce.
 * Safe to call from anywhere; never throws. Errors are logged.
 *
 * Pass `force: true` to bypass debounce (e.g. from a "Retry uploads" button).
 */
export function scheduleBackgroundReconciliation(
  deps: ReconcilerDeps,
  opts: { force?: boolean; reason?: string } = {}
): void {
  const now = (deps.now ?? Date.now)();
  if (!opts.force && now - lastTriggerAt < TRIGGER_DEBOUNCE_MS) {
    return;
  }
  lastTriggerAt = now;

  const log = deps.log ?? defaultLog;
  log('info', `Reconciler trigger: ${opts.reason ?? 'unspecified'}`);

  // Detach from current promise chain so an exception here can't poison
  // whatever flow scheduled us. unref() so the scheduled work doesn't block
  // process exit (matters for tests; in production the timer fires within
  // the same tick anyway).
  const handle = setImmediate(() => {
    reconcilePendingUploads(deps)
      .then((result) => {
        if (result.noop) {
          log('info', `Reconciler noop: ${result.noopReason}`);
        } else if (result.uploaded > 0 || result.failed > 0) {
          log(
            'info',
            `Reconciler pass complete: uploaded=${result.uploaded} failed=${result.failed} confirmed=${result.confirmedRemote}`
          );
        }
      })
      .catch((err) => {
        log('error', 'Reconciler unexpected throw', { err: String(err?.message ?? err) });
      });
  });
  if (typeof (handle as any).unref === 'function') {
    (handle as any).unref();
  }
}

// ===========================================================================
// Core implementation
// ===========================================================================

const FILE_RE = /^exec_([0-9a-fA-F-]{36})\.jsonl$/;

async function doReconcile(deps: ReconcilerDeps): Promise<ReconcileResult> {
  const cfg: ReconcilerConfig = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };
  const log: LogFn = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const result: ReconcileResult = {
    scanned: 0,
    alreadyUploaded: 0,
    confirmedRemote: 0,
    uploaded: 0,
    failed: 0,
    skippedOtherUser: 0,
    skippedInvalid: 0,
    durationMs: 0,
    errors: [],
    noop: false,
  };

  // ---- Pre-flight: auth + directory ----
  const userId = safeCall(() => deps.getCurrentUserId(), null);
  if (!userId) {
    result.noop = true;
    result.noopReason = 'no-user';
    result.durationMs = now() - startedAt;
    return result;
  }

  let logsDir: string;
  try {
    logsDir = deps.getLogsDir
      ? deps.getLogsDir()
      : path.join(app.getPath('userData'), '.analysis-logs');
  } catch (e) {
    result.noop = true;
    result.noopReason = 'no-logs-dir-resolved';
    result.durationMs = now() - startedAt;
    return result;
  }

  if (!fs.existsSync(logsDir)) {
    result.noop = true;
    result.noopReason = 'logs-dir-missing';
    result.durationMs = now() - startedAt;
    return result;
  }

  // ---- Scan: find candidates without an .uploaded marker ----
  let allFiles: string[];
  try {
    allFiles = fs.readdirSync(logsDir);
  } catch (e: any) {
    log('error', 'Failed to readdir logs dir', { err: String(e?.message ?? e) });
    result.noop = true;
    result.noopReason = 'readdir-failed';
    result.durationMs = now() - startedAt;
    return result;
  }

  const candidates: Array<{ file: string; executionId: string; fullPath: string }> = [];

  for (const file of allFiles) {
    const match = FILE_RE.exec(file);
    if (!match) continue;
    const executionId = match[1].toLowerCase();
    const fullPath = path.join(logsDir, file);

    result.scanned++;

    if (hasUploadedMarker(fullPath)) {
      result.alreadyUploaded++;
      continue;
    }

    candidates.push({ file, executionId, fullPath });
  }

  if (candidates.length === 0) {
    result.durationMs = now() - startedAt;
    return result;
  }

  // Cap per-pass workload. Sort by mtime DESC so the most recent (most likely
  // to belong to the current session) get retried first.
  candidates.sort((a, b) => safeMtimeMs(b.fullPath) - safeMtimeMs(a.fullPath));
  const work = candidates.slice(0, cfg.maxFilesPerPass);

  log('info', `Reconciler: ${candidates.length} candidates, processing ${work.length}`, {
    userId,
  });

  // ---- Cross-check with analysis_log_metadata (batched) ----
  const supabase = safeCall(() => deps.getSupabase(), null);
  if (!supabase) {
    log('warn', 'Reconciler: no supabase client available, skipping');
    result.noop = true;
    result.noopReason = 'no-supabase-client';
    result.durationMs = now() - startedAt;
    return result;
  }

  const remoteIds = new Set<string>();
  const idsToCheck = work.map((c) => c.executionId);
  for (let i = 0; i < idsToCheck.length; i += cfg.queryBatchSize) {
    const chunk = idsToCheck.slice(i, i + cfg.queryBatchSize);
    try {
      const { data, error } = await supabase
        .from('analysis_log_metadata')
        .select('execution_id')
        .in('execution_id', chunk);
      if (error) {
        log('warn', 'Reconciler: metadata query failed (will retry uploads anyway)', {
          err: error.message,
        });
        // Don't abort: better to upload some and let upsert handle dupes than skip.
        continue;
      }
      for (const row of data ?? []) {
        if (row?.execution_id) remoteIds.add(String(row.execution_id).toLowerCase());
      }
    } catch (e: any) {
      log('warn', 'Reconciler: metadata query threw', { err: String(e?.message ?? e) });
    }
  }

  // ---- Per-file: confirm or upload ----
  const upload = deps.uploadFile ?? defaultUpload;
  const insertMeta = deps.insertMetadata ?? defaultInsertMetadata;
  const appVersion = safeCall(() => app.getVersion(), null);

  for (const { file, executionId, fullPath } of work) {
    if (remoteIds.has(executionId)) {
      writeUploadedMarker(fullPath);
      result.confirmedRemote++;
      continue;
    }

    const parsed = readExecutionStart(fullPath);
    if (!parsed.ok) {
      result.skippedInvalid++;
      pushError(result, file, parsed.reason);
      continue;
    }

    if (parsed.userId && parsed.userId !== userId) {
      // Multi-user shared machine: don't touch other people's files.
      result.skippedOtherUser++;
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch (e: any) {
      result.skippedInvalid++;
      pushError(result, file, `stat failed: ${e?.message ?? e}`);
      continue;
    }
    if (stat.size === 0) {
      result.skippedInvalid++;
      pushError(result, file, 'empty file');
      continue;
    }
    if (stat.size > cfg.maxFileSizeBytes) {
      result.skippedInvalid++;
      pushError(result, file, `file too large: ${stat.size} bytes`);
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(fullPath);
    } catch (e: any) {
      result.skippedInvalid++;
      pushError(result, file, `read failed: ${e?.message ?? e}`);
      continue;
    }

    const date = isoDate(parsed.timestamp);
    const storagePath = `${userId}/${date}/${file}`;

    const uploaded = await retry(
      () => upload({ supabase, bucket: cfg.bucket, storagePath, fileContent: bytes }),
      cfg.maxUploadRetries,
      cfg.retryBaseMs
    );

    if (!uploaded.success) {
      result.failed++;
      pushError(result, file, `upload failed: ${uploaded.error ?? 'unknown'}`);
      continue;
    }

    // Best-effort metadata. If it fails we keep the storage upload but won't
    // write the marker — next pass will see remoteIds still empty and retry.
    // Storage upserts are idempotent so the retry is safe.
    const meta = await retry(
      () =>
        insertMeta({
          supabase,
          executionId,
          userId,
          storagePath,
          totalImages: parsed.totalImages,
          category: parsed.category,
          appVersion,
        }),
      cfg.maxUploadRetries,
      cfg.retryBaseMs
    );

    if (!meta.success) {
      result.failed++;
      pushError(result, file, `metadata insert failed: ${meta.error ?? 'unknown'}`);
      continue;
    }

    writeUploadedMarker(fullPath);
    result.uploaded++;
  }

  result.durationMs = now() - startedAt;
  log('info', `Reconciler done: uploaded=${result.uploaded} confirmed=${result.confirmedRemote} failed=${result.failed} invalid=${result.skippedInvalid} otherUser=${result.skippedOtherUser} duration=${result.durationMs}ms`);
  return result;
}

// ===========================================================================
// Helpers
// ===========================================================================

interface ParsedExecStart {
  ok: true;
  userId: string | null;
  totalImages: number;
  category: string | null;
  timestamp: string; // ISO
}
interface ParseError { ok: false; reason: string; }
type ParseResult = ParsedExecStart | ParseError;

/**
 * Read just enough of the JSONL to find the EXECUTION_START event.
 * Defensive: scans the first ~64KB rather than relying on line 1, so a stray
 * heartbeat or preamble doesn't blind us. Returns the minimum metadata we
 * need to construct the storage path and metadata row.
 */
export function readExecutionStart(jsonlPath: string): ParseResult {
  let head: Buffer;
  try {
    const fd = fs.openSync(jsonlPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const toRead = Math.min(stat.size, 64 * 1024);
      head = Buffer.alloc(toRead);
      fs.readSync(fd, head, 0, toRead, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e: any) {
    return { ok: false, reason: `head read failed: ${e?.message ?? e}` };
  }

  const lines = head.toString('utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (evt?.type !== 'EXECUTION_START') continue;
    const totalImages = Number.isFinite(evt.totalImages) ? Number(evt.totalImages) : 0;
    const ts = typeof evt.timestamp === 'string' && !isNaN(Date.parse(evt.timestamp))
      ? evt.timestamp
      : new Date().toISOString();
    return {
      ok: true,
      userId: typeof evt.userId === 'string' ? evt.userId : null,
      totalImages: Math.max(0, totalImages),
      category: typeof evt.category === 'string' ? evt.category : null,
      timestamp: ts,
    };
  }

  return { ok: false, reason: 'EXECUTION_START not found in first 64KB' };
}

function isoDate(timestamp: string): string {
  // YYYY-MM-DD in UTC. Mirrors AnalysisLogger constructor logic.
  try {
    return new Date(timestamp).toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function safeMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function pushError(result: ReconcileResult, file: string, reason: string): void {
  if (result.errors.length < 20) {
    result.errors.push({ file, reason });
  }
}

async function retry<T extends { success: boolean; error?: string }>(
  fn: () => Promise<T>,
  attempts: number,
  baseMs: number
): Promise<T> {
  let last: T = { success: false, error: 'no attempts' } as T;
  for (let i = 1; i <= attempts; i++) {
    try {
      last = await fn();
      if (last.success) return last;
    } catch (e: any) {
      last = { success: false, error: String(e?.message ?? e) } as T;
    }
    if (i < attempts) {
      const wait = baseMs * Math.pow(2, i - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return last;
}

const defaultLog: LogFn = (level, msg, ctx) => {
  const line = `[JsonlReconciler] ${msg}` + (ctx ? ` ${JSON.stringify(ctx)}` : '');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

const defaultUpload: UploadFn = async ({ supabase, bucket, storagePath, fileContent }) => {
  try {
    const { error } = await supabase.storage.from(bucket).upload(storagePath, fileContent, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'application/x-ndjson',
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
};

const defaultInsertMetadata: InsertMetadataFn = async ({
  supabase,
  executionId,
  userId,
  storagePath,
  totalImages,
  category,
  appVersion,
}) => {
  try {
    // The table currently has NO unique constraint on execution_id (existing
    // data contains historical duplicates from the original AnalysisLogger
    // codepath). So we cannot use upsert. Instead, we re-check existence
    // immediately before inserting — combined with the upstream remoteIds
    // SELECT, this gives idempotency for the single-device case the
    // reconciler is built for. Multi-device concurrent runs may create one
    // duplicate row, which matches the table's current tolerance for them.
    const existing = await supabase
      .from('analysis_log_metadata')
      .select('id', { count: 'exact', head: true })
      .eq('execution_id', executionId);

    if (existing.error) {
      return { success: false, error: existing.error.message };
    }
    if ((existing.count ?? 0) > 0) {
      // Already there — nothing to do, treat as success.
      return { success: true };
    }

    const { error } = await supabase.from('analysis_log_metadata').insert({
      execution_id: executionId,
      user_id: userId,
      storage_path: storagePath,
      total_images: totalImages,
      total_corrections: 0,
      correction_types: {},
      category,
      app_version: appVersion,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
};
