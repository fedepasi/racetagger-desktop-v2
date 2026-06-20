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
import type { SupabaseClient } from '@supabase/supabase-js';

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

// ===========================================================================
// DB reconstruction (#184 Phase 1 — cross-device read). OFF by default; gated
// by ENABLE_DB_EXECUTION_FALLBACK at the call site (src/ipc/analysis-handlers.ts).
// ===========================================================================
// When the local JSONL is absent (another device ran the analysis, a reinstall,
// or a lost local file), synthesize the event stream from the DB so the review
// gallery still renders. The synthesized events mirror the shape the renderer's
// `extractResultsFromLogs` / `enrichResultsWithLogData` consume: IMAGE_ANALYSIS
// with `aiResponse.vehicles[]`, each vehicle carrying a `finalResult`.
//
// Dependency-injected (supabase client + userId) so the loader stays a leaf
// module (no import of database-service). NEVER throws — returns null on any
// failure, so the caller degrades to today's behavior (empty gallery).
//
// KNOWN LIMITATION (v1, flag stays off until validated): cross-device thumbnails
// require signed URLs from `images.storage_path`; for now `supabaseUrl` is null
// so previews may be blank while the recognized data (numbers/teams/corrections)
// reconstructs correctly. `raw_response.vehicles[]` shape differs across the
// onnx/gemini persistence paths, hence the permissive field mapping below.

interface DbReconstructDeps {
  supabase: SupabaseClient;
  userId: string;
}

const DB_RECONSTRUCT_TTL_MS = 5 * 60 * 1000; // 5 min read-through cache
const dbReconstructCache = new Map<string, { result: ExecutionLogResult; at: number }>();

/** Drop a cached reconstruction (call after a correction save, or for a forced refresh). */
export function invalidateDbReconstructCache(executionId?: string): void {
  if (executionId) dbReconstructCache.delete(executionId);
  else dbReconstructCache.clear();
}

export async function loadFromDatabaseIfExists(
  executionId: string,
  deps: DbReconstructDeps,
  options: { bypassCache?: boolean } = {}
): Promise<ExecutionLogResult | null> {
  try {
    if (!executionId || !deps?.supabase || !deps?.userId) return null;
    const { supabase, userId } = deps;

    if (!options.bypassCache) {
      const cached = dbReconstructCache.get(executionId);
      if (cached && (Date.now() - cached.at) < DB_RECONSTRUCT_TTL_MS) {
        return cached.result;
      }
    }

    // 1) execution row (user-scoped; RLS also enforces user ownership)
    const { data: exec, error: execErr } = await supabase
      .from('executions')
      .select('id, name, execution_at, created_at, status, total_images, processed_images, category, source_folder, execution_settings')
      .eq('id', executionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (execErr || !exec) return null;

    // 2) images for this execution → image_id + filename
    const { data: images, error: imgErr } = await supabase
      .from('images')
      .select('id, original_filename')
      .eq('execution_id', executionId);
    if (imgErr) return null;
    const imageIds: string[] = (images || []).map((i: any) => i.id);
    const fileNameById = new Map<string, string>();
    for (const img of (images || [])) fileNameById.set(img.id, img.original_filename);

    // 3) analysis_results — joined via image_id (analysis_results has NO execution_id)
    const resultsRows: any[] = [];
    const CHUNK = 200;
    for (let i = 0; i < imageIds.length; i += CHUNK) {
      const chunk = imageIds.slice(i, i + CHUNK);
      const { data: rows, error: arErr } = await supabase
        .from('analysis_results')
        .select('image_id, recognized_number, confidence_score, confidence_level, raw_response, analyzed_at')
        .in('image_id', chunk);
      if (arErr) return null;
      if (rows) resultsRows.push(...rows);
    }

    // 4) metadata (totals/category for EXECUTION_START) — best-effort
    const { data: meta } = await supabase
      .from('analysis_log_metadata')
      .select('total_images, total_corrections, category')
      .eq('execution_id', executionId)
      .maybeSingle();

    const events: any[] = [];
    const settings = (exec.execution_settings && typeof exec.execution_settings === 'object') ? exec.execution_settings : {};
    const presetSnapshot = settings.preset_snapshot || null;
    const startTs = exec.execution_at || exec.created_at || new Date().toISOString();

    events.push({
      type: 'EXECUTION_START',
      timestamp: startTs,
      executionId,
      totalImages: (meta?.total_images ?? exec.total_images ?? imageIds.length) || 0,
      category: exec.category || meta?.category || 'motorsport',
      presetName: presetSnapshot?.name || settings?.participantPresetName || null,
      participantPresetId: presetSnapshot?.id || settings?.participantPresetId || null,
      userId,
      source: 'db',
    });

    for (const row of resultsRows) {
      const fileName = fileNameById.get(row.image_id);
      if (!fileName) continue;
      const rr = (row.raw_response && typeof row.raw_response === 'object') ? row.raw_response : {};
      const rawVehicles: any[] = Array.isArray(rr.vehicles) ? rr.vehicles : [];

      // Permissive mapping: prefer finalResult fields, fall back to top-level
      // vehicle fields and (for the primary vehicle) the row's recognized_number.
      const vehicles = (rawVehicles.length > 0 ? rawVehicles : [{}]).map((v: any, idx: number) => {
        const fr = (v.finalResult && typeof v.finalResult === 'object') ? v.finalResult : {};
        const raceNumber = fr.raceNumber ?? v.raceNumber ?? (idx === 0 ? row.recognized_number : null) ?? null;
        const team = fr.team ?? v.team ?? v.teamName ?? null;
        const drivers = fr.drivers ?? v.drivers ?? [];
        const confidence = (typeof v.confidence === 'number' ? v.confidence : (idx === 0 ? row.confidence_score : 0)) || 0;
        const isManual = row.confidence_level === 'manual';
        return {
          ...v,
          confidence,
          participantMatch: v.participantMatch || null,
          otherPeople: Array.isArray(v.otherPeople) ? v.otherPeople : [],
          finalResult: {
            ...fr,
            raceNumber,
            team,
            drivers,
            matchedBy: fr.matchedBy ?? v.matchedBy ?? (isManual ? 'user_manual' : (raceNumber ? 'ai' : 'none')),
            matchStatus: fr.matchStatus ?? v.matchStatus ?? (raceNumber && raceNumber !== 'N/A' ? 'matched' : 'no_match'),
            alternativeCandidates: fr.alternativeCandidates ?? v.alternativeCandidates ?? null,
          },
        };
      });

      events.push({
        type: 'IMAGE_ANALYSIS',
        timestamp: row.analyzed_at || startTs,
        fileName,
        originalFileName: fileName,
        dbImageId: row.image_id,
        imageId: row.image_id,
        metadataWritten: true,
        supabaseUrl: null, // cross-device thumbnails (signed URLs) = follow-up
        aiResponse: { vehicles, totalVehicles: vehicles.length },
      });

      if (row.confidence_level === 'manual') {
        events.push({
          type: 'MANUAL_CORRECTION',
          timestamp: row.analyzed_at || startTs,
          fileName,
          imageId: row.image_id,
          correctionType: 'USER_MANUAL',
          changes: { raceNumber: row.recognized_number ?? null },
          source: 'db-reconstructed',
        });
      }
    }

    if (settings?.organized_at && settings?.organize_mode === 'move') {
      events.push({ type: 'ORGANIZATION_MOVE_COMPLETED', timestamp: settings.organized_at, executionId });
    }

    const result: ExecutionLogResult = { events, source: 'db', logFilePath: '' };
    dbReconstructCache.set(executionId, { result, at: Date.now() });
    return result;
  } catch {
    // Never throw into the gallery — degrade to "no events" (today's behavior).
    return null;
  }
}
