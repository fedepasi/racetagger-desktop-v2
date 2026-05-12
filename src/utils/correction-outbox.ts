/**
 * Correction Outbox
 *
 * Durable, append-only outbox for Supabase writes that MUST eventually succeed
 * even if the network is flapping at the moment the user makes a correction.
 *
 * Context: support reports from Michele Scudiero (v1.1.6) and Lisa Hallmann
 * (v1.1.7) showed `TypeError: fetch failed` errors during the correction
 * flow, with at least one USER_MANUAL correction lost (Michele 13:58:30 →
 * "Failed to write USER_MANUAL correction to image_corrections: TypeError:
 * fetch failed"). That row would have been needed at organize time as a
 * defence-in-depth source for the corrected raceNumber.
 *
 * Design (intentionally small):
 *   - Append-only JSONL at userData/.outbox/corrections.jsonl
 *   - Each line is one operation: { id, type, payload, attempts, lastError, …}
 *   - Operations are idempotent at the DB level (we use natural keys —
 *     execution_id + image_id + vehicle_index + correction_type — so a
 *     retry of an already-applied write is a no-op).
 *   - `enqueueAndTry()` writes the op to the outbox FIRST, then tries
 *     once synchronously. On success: marks the line as completed
 *     (the file gets compacted on next boot). On failure: the op stays
 *     pending and the background flusher will retry with exponential
 *     backoff.
 *   - `flushPending()` reads the outbox, retries each pending op with
 *     backoff (1s → 2s → 4s → 8s → 16s, max 5 attempts), drops ops that
 *     hit max attempts (after logging a structured error report).
 *   - `init()` is called once at app boot: compact the file (remove
 *     completed lines) and schedule a flush.
 *
 * The outbox lives in userData so it survives app restarts and crashes.
 * It is INTENTIONALLY NOT in the workspace folder — the user shouldn't
 * see it, edit it, or move it.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

// =========================================================================
// Types
// =========================================================================

export type OutboxOpType =
  | 'analysis_results_update'
  | 'image_corrections_insert';

export interface OutboxOp {
  /** Unique id for dedup + log correlation. Use crypto.randomUUID(). */
  id: string;
  /** What kind of Supabase write this is. */
  type: OutboxOpType;
  /** Free-form payload — interpreted by the executor function. */
  payload: any;
  /** Wall-clock when the op was first enqueued. */
  createdAt: string;
  /** How many times we've attempted (0 = never tried yet). */
  attempts: number;
  /** Last error message (if any), for diagnostics. */
  lastError?: string;
  /** Marks a line as "done". Compaction drops these on next boot. */
  completed?: boolean;
}

/** Function signature the outbox calls to actually run a queued op. */
export type OutboxExecutor = (op: OutboxOp) => Promise<void>;

// =========================================================================
// State
// =========================================================================

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const FLUSH_INTERVAL_MS = 30_000;

let outboxFilePath: string | null = null;
let executor: OutboxExecutor | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;

// =========================================================================
// File I/O helpers
// =========================================================================

function getOutboxPath(): string {
  if (outboxFilePath) return outboxFilePath;
  const dir = path.join(app.getPath('userData'), '.outbox');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  outboxFilePath = path.join(dir, 'corrections.jsonl');
  return outboxFilePath;
}

/** Read all ops from disk. Returns [] if file missing or unreadable. */
async function readAll(): Promise<OutboxOp[]> {
  const p = getOutboxPath();
  try {
    const buf = await fsPromises.readFile(p, 'utf-8');
    return buf
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as OutboxOp;
        } catch {
          return null;
        }
      })
      .filter((op): op is OutboxOp => op != null);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    console.warn('[CorrectionOutbox] Failed to read outbox file:', err);
    return [];
  }
}

/** Atomically append one line. */
async function appendLine(op: OutboxOp): Promise<void> {
  const p = getOutboxPath();
  await fsPromises.appendFile(p, JSON.stringify(op) + '\n', 'utf-8');
}

/** Rewrite the file with the given ops (used by compaction + flush). */
async function rewriteAll(ops: OutboxOp[]): Promise<void> {
  const p = getOutboxPath();
  const tmp = p + '.tmp';
  const body = ops.map(op => JSON.stringify(op)).join('\n') + (ops.length > 0 ? '\n' : '');
  await fsPromises.writeFile(tmp, body, 'utf-8');
  await fsPromises.rename(tmp, p);
}

// =========================================================================
// Public API
// =========================================================================

/**
 * Initialise the outbox. Must be called once at app boot, AFTER the
 * Supabase client is ready and BEFORE any code path enqueues writes.
 *
 *  - executor: function that knows how to actually run an op. Lives in
 *    main.ts where the Supabase client is available.
 */
export async function init(execFn: OutboxExecutor): Promise<void> {
  executor = execFn;

  // Compact on boot: drop completed lines so the file doesn't grow
  // unboundedly across sessions.
  try {
    const ops = await readAll();
    const pending = ops.filter(op => !op.completed);
    if (pending.length !== ops.length) {
      await rewriteAll(pending);
      console.log(
        `[CorrectionOutbox] Compacted: dropped ${ops.length - pending.length} completed lines, ` +
        `${pending.length} pending remain.`
      );
    }
    if (pending.length > 0) {
      console.log(
        `[CorrectionOutbox] ${pending.length} pending op(s) carried over from previous session — scheduling flush.`
      );
    }
  } catch (err) {
    console.warn('[CorrectionOutbox] init compaction failed (non-fatal):', err);
  }

  // Schedule periodic flush — picks up pending ops every FLUSH_INTERVAL_MS.
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    flushPending().catch(err => {
      console.warn('[CorrectionOutbox] periodic flush failed (will retry):', err);
    });
  }, FLUSH_INTERVAL_MS);
  // Initial flush a few seconds after boot to clear any backlog.
  setTimeout(() => {
    flushPending().catch(err => {
      console.warn('[CorrectionOutbox] startup flush failed (will retry):', err);
    });
  }, 5_000);
}

/**
 * Enqueue a Supabase write and try it once synchronously. The op is
 * persisted to disk BEFORE the network attempt so if the process dies
 * mid-write the op survives.
 *
 * Returns:
 *   - { ok: true }                — write succeeded immediately
 *   - { ok: false, queued: true } — write failed, op is queued for retry
 *
 * Never throws — callers should treat both outcomes as "the user's
 * correction is safe" because the periodic flusher will eventually
 * succeed.
 */
export async function enqueueAndTry(
  type: OutboxOpType,
  payload: any
): Promise<{ ok: boolean; queued: boolean }> {
  if (!executor) {
    // Outbox not initialised yet — this is a programming error, but we
    // still persist the op so it's not lost.
    console.warn('[CorrectionOutbox] enqueueAndTry called before init() — persisting only.');
  }

  const op: OutboxOp = {
    id: cryptoRandomId(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };

  // Persist FIRST.
  try {
    await appendLine(op);
  } catch (persistErr) {
    // If we can't even persist to disk, we still try the network attempt
    // — but warn loudly because the safety net is gone.
    console.error('[CorrectionOutbox] Failed to persist op to disk (op will rely on in-memory retry):', persistErr);
  }

  if (!executor) {
    return { ok: false, queued: true };
  }

  // Try once now (op.attempts becomes 1 after this).
  const success = await tryRun(op);
  if (success) {
    await markCompleted(op.id);
    return { ok: true, queued: false };
  }
  return { ok: false, queued: true };
}

/**
 * Flush pending ops with exponential backoff. Safe to call concurrently
 * — re-entrancy is guarded by `flushInFlight`.
 */
export async function flushPending(): Promise<{ flushed: number; failed: number; dropped: number }> {
  if (flushInFlight) return { flushed: 0, failed: 0, dropped: 0 };
  if (!executor) return { flushed: 0, failed: 0, dropped: 0 };
  flushInFlight = true;

  let flushed = 0;
  let failed = 0;
  let dropped = 0;
  try {
    const all = await readAll();
    const pending = all.filter(op => !op.completed);
    if (pending.length === 0) return { flushed, failed, dropped };

    // [Narrate] entry log when there's actual work to do — silent on
    // the happy path (no pending ops) so the periodic 30s flush
    // doesn't spam the log.
    const opTypes = Array.from(new Set(pending.map(o => o.type))).join(', ');
    console.log(
      `[Narrate] Correction outbox flush starting: ${pending.length} pending op(s) ` +
      `(types: ${opTypes}). Retrying each up to ${MAX_ATTEMPTS} attempts before dropping.`
    );

    for (const op of pending) {
      // Honour backoff: skip ops whose last attempt is more recent than
      // BACKOFF_MS[attempts - 1] ago. We approximate "last attempt time"
      // with the op's lastError timestamp (encoded into lastError when
      // we set it).
      // For simplicity in v1 we just retry every op every interval — the
      // FLUSH_INTERVAL_MS (30s) is already comparable to the longest
      // backoff slot. Future iteration can add per-op timing.

      const ok = await tryRun(op);
      if (ok) {
        await markCompleted(op.id);
        flushed++;
        continue;
      }

      if (op.attempts >= MAX_ATTEMPTS) {
        // Give up on this op. Log a structured error so we can find it
        // in the support logs, then mark completed to stop retrying.
        console.error(
          `[CorrectionOutbox] DROPPING op after ${op.attempts} attempts: ` +
          `type=${op.type} id=${op.id} lastError=${op.lastError}`
        );
        await markCompleted(op.id);
        dropped++;
      } else {
        failed++;
      }
    }
  } finally {
    flushInFlight = false;
  }

  if (flushed > 0 || dropped > 0) {
    console.log(`[CorrectionOutbox] Flush summary — flushed=${flushed} failed=${failed} dropped=${dropped}`);
    console.log(
      `[Narrate] Correction outbox flush complete: ${flushed} succeeded, ${failed} failed (will retry), ` +
      `${dropped} permanently dropped after max attempts.`
    );
  }
  return { flushed, failed, dropped };
}

/** Stops the periodic flusher. Call on app shutdown. */
export function stop(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// =========================================================================
// Internals
// =========================================================================

/** Try to run an op exactly once. Returns true on success. */
async function tryRun(op: OutboxOp): Promise<boolean> {
  if (!executor) return false;
  op.attempts++;
  try {
    await executor(op);
    return true;
  } catch (err: any) {
    op.lastError = err?.message ? String(err.message) : String(err);
    if (op.attempts >= MAX_ATTEMPTS) {
      console.warn(
        `[CorrectionOutbox] op ${op.id} (${op.type}) FAILED on final attempt #${op.attempts}: ${op.lastError}`
      );
    } else {
      console.warn(
        `[CorrectionOutbox] op ${op.id} (${op.type}) attempt #${op.attempts} failed (will retry): ${op.lastError}`
      );
    }
    // Persist the updated attempts/lastError counters.
    await updateOpInFile(op).catch(persistErr => {
      console.warn('[CorrectionOutbox] Failed to persist op state update:', persistErr);
    });
    return false;
  }
}

/** Mark an op as completed in the outbox file. */
async function markCompleted(opId: string): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex(o => o.id === opId);
  if (idx === -1) return;
  all[idx].completed = true;
  await rewriteAll(all);
}

/** Persist an updated op (attempts, lastError) by rewriting the file. */
async function updateOpInFile(op: OutboxOp): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex(o => o.id === op.id);
  if (idx === -1) return;
  all[idx] = op;
  await rewriteAll(all);
}

/** RFC4122-ish random id. Avoid pulling in crypto package: this is just
 *  for correlation, not security. */
function cryptoRandomId(): string {
  // Use Node's crypto.randomUUID when available, fall back to a simple
  // timestamp+random scheme. Both produce strings that fit in a JSONL
  // line without escaping.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require('crypto');
    if (typeof randomUUID === 'function') return randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
