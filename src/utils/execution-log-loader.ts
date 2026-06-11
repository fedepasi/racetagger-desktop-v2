/**
 * Execution Log Loader
 * ============================================================================
 * Single entry point for loading the event stream of a past execution. All
 * code that needs to read past `exec_<id>.jsonl` files MUST go through this
 * module — do NOT add new inline `fs.readFileSync` calls against the logs
 * directory.
 *
 * Why a unified loader?
 * ---------------------
 * Today an execution's event stream lives in three places:
 *
 *   1. Local JSONL file — `userData/.analysis-logs/exec_<id>.jsonl`
 *   2. Supabase Storage — `analysis-logs/{userId}/{date}/exec_<id>.jsonl`
 *   3. Database tables  — `executions`, `images`, `analysis_results`,
 *                         `analysis_log_metadata`
 *
 * Different deployment scenarios make different sources canonical:
 *
 *   - Same machine that ran the analysis  → local JSONL is the fastest read.
 *   - Different machine, same user account → local JSONL doesn't exist; we
 *     need to reconstruct from the DB (or download from Storage).
 *   - Local file corrupted / deleted       → DB is the recovery path.
 *
 * Centralizing the loading logic here means the call sites stay agnostic and
 * future cross-machine support becomes a one-file change.
 *
 * Phase plan
 * ----------
 * Phase 1 (NOW — this commit):
 *   - Step 1 implemented: read from local JSONL.
 *   - Steps 2 & 3 documented but NOT implemented; loader returns
 *     `{ source: 'local', ... }` or throws on missing file, exactly like the
 *     legacy inline reads it replaces. Behavior is unchanged.
 *
 * Phase 3 (FUTURE — separate work):
 *   - Step 2 (DB reconstruction): when the local file is missing, query
 *     `executions` + `images` + `analysis_results` + `analysis_log_metadata`
 *     and synthesize an event array equivalent to what the JSONL would have
 *     contained. The required data is already populated in those tables (see
 *     enrichment work in this same commit), so all that's needed is the
 *     reconstruction logic itself.
 *   - This unblocks "see analyses on other machines that share my account",
 *     which is the explicit roadmap goal.
 *
 * Phase 3 implementation contract
 * --------------------------------
 * When implementing the DB-reconstruction fallback, replace `loadFromLocal`
 * with a strategy chain:
 *
 *   1. Try local JSONL (current Step 1) — fastest, source of truth on the
 *      machine that ran the analysis.
 *   2. If missing, reconstruct from DB:
 *        a. SELECT * FROM executions WHERE id = ?
 *        b. SELECT * FROM analysis_log_metadata WHERE execution_id = ?
 *        c. SELECT id, original_filename FROM images WHERE execution_id = ?
 *        d. SELECT * FROM analysis_results WHERE execution_id = ?
 *      Then synthesize:
 *        - One EXECUTION_START event from `executions` + `analysis_log_metadata`.
 *          The preset snapshot needed for `presetWasActive` / allowed-numbers
 *          logic is in `executions.execution_settings.preset_snapshot`
 *          (populated at analysis time — see analysis-logger.ts).
 *        - One IMAGE_ANALYSIS event per analysis_results row, populating
 *          `event.aiResponse.vehicles[]` from `raw_response.vehicles`. The
 *          `participantMatch` field is included in `raw_response.vehicles[]`
 *          (see persistence sites in unified-image-processor.ts).
 *        - Synthetic MANUAL_CORRECTION events for any analysis_results row
 *          where `confidence_level = 'manual'` (the canonical signal for a
 *          user correction in the DB).
 *        - Optional ORGANIZATION_MOVE_COMPLETED event if
 *          `executions.execution_settings.organized_at` is set with
 *          `organize_mode === 'move'`.
 *      Return `{ source: 'db', ... }` so call sites can log the source.
 *
 * Importantly: do NOT change the call sites when implementing Phase 3. They
 * already pass through this loader; widening the source set is internal.
 *
 * Non-goals
 * ---------
 *  - This module does NOT mutate logs. Append/update flows (e.g. recording
 *    `ORGANIZATION_MOVE_COMPLETED` after a successful move) continue to
 *    write directly to the local JSONL.
 *  - This module does NOT re-upload to Storage. That is owned by
 *    `jsonl-upload-reconciler.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Source from which the event stream was loaded. Useful for diagnostics
 * and for telemetry that wants to know how often we fall back beyond the
 * local file.
 */
export type ExecutionLogSource = 'local' | 'db';

export interface ExecutionLogResult {
  /** Parsed events in original order (malformed lines are dropped). */
  events: any[];
  /** Where the events came from. */
  source: ExecutionLogSource;
  /**
   * The local JSONL path, if known. Always populated for `source === 'local'`.
   * Populated for `source === 'db'` only if a local placeholder was created
   * (not in Phase 1).
   */
  logFilePath: string;
}

export interface LoadOptions {
  /**
   * Override the logs directory. Defaults to `userData/.analysis-logs`.
   * Provided for testing and for tools that operate on a captured logs dir.
   */
  logsDir?: string;
}

/**
 * Load the event stream of an execution.
 *
 * Phase 1 behavior: reads the local JSONL. Throws an error mirroring the
 * legacy inline reads if the file does not exist. Callers that want a
 * "missing → empty" semantics should use `loadExecutionLogIfExists`.
 *
 * @throws Error if the local JSONL does not exist.
 */
export async function loadExecutionLog(
  executionId: string,
  options: LoadOptions = {}
): Promise<ExecutionLogResult> {
  const logsDir = options.logsDir ?? defaultLogsDir();
  const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

  if (!fs.existsSync(logFilePath)) {
    // Phase 3: this is where DB-reconstruction would kick in. For now we
    // mirror the legacy "throw on missing" behavior so call sites that
    // expected it stay correct.
    throw new Error(`Log file not found for execution ${executionId}`);
  }

  return readLocalJsonl(logFilePath);
}

/**
 * Like `loadExecutionLog` but returns `null` instead of throwing when the
 * local JSONL does not exist. Use this where the legacy inline read returned
 * an empty array on missing file.
 */
export async function loadExecutionLogIfExists(
  executionId: string,
  options: LoadOptions = {}
): Promise<ExecutionLogResult | null> {
  const logsDir = options.logsDir ?? defaultLogsDir();
  const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

  if (!fs.existsSync(logFilePath)) {
    return null;
  }

  return readLocalJsonl(logFilePath);
}

/**
 * Resolve the local JSONL path for an execution without reading it.
 * Useful for flows that need to append to the file (e.g. recording an
 * ORGANIZATION_MOVE_COMPLETED event after a successful move).
 */
export function resolveLocalLogPath(
  executionId: string,
  options: LoadOptions = {}
): string {
  const logsDir = options.logsDir ?? defaultLogsDir();
  return path.join(logsDir, `exec_${executionId}.jsonl`);
}

// ===========================================================================
// Internals
// ===========================================================================

function defaultLogsDir(): string {
  return path.join(app.getPath('userData'), '.analysis-logs');
}

function readLocalJsonl(logFilePath: string): ExecutionLogResult {
  const logContent = fs.readFileSync(logFilePath, 'utf-8');
  const logLines = logContent.trim().split('\n').filter(line => line.trim());
  const events = logLines
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    events,
    source: 'local',
    logFilePath,
  };
}
