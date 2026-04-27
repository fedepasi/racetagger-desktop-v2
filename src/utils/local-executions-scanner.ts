/**
 * Local Executions Scanner
 * ============================================================================
 * Pure (no Electron, no Sharp, no Supabase) function that scans the local
 * analysis-logs directory and produces the array of executions the home
 * page renders. Extracted from `ipc/analysis-handlers.ts:get-local-executions`
 * so the parsing logic — including the self-healing fallbacks — can be unit
 * tested without pulling the entire Electron+native-modules graph.
 *
 * SOURCES OF DATA (in order of authority)
 * ---------------------------------------
 *   1. JSONL log file `exec_{id}.jsonl`
 *   2. Summary sidecar  `exec_{id}.jsonl.summary.json`
 *
 * SELF-HEALING BEHAVIOUR
 * ----------------------
 *   - EXECUTION_START is searched on EVERY line of the JSONL, not just line 1.
 *     Tolerates a corrupt preamble, a partial flush of the first line, or
 *     an EXECUTION_HEARTBEAT that snuck in front.
 *   - If the JSONL has no usable EXECUTION_START (corrupted, truncated, or
 *     entirely missing), the sidecar takes over. Without this, an analysis
 *     whose JSONL header gets truncated disappears from the home page even
 *     though the data is in the cloud DB and tokens were charged.
 *   - Orphan sidecars (sidecar present, JSONL absent) ARE shown — they
 *     represent executions whose local log was deleted but whose record we
 *     still want surfaced.
 *   - When both are present, JSONL counts win when it actually has
 *     IMAGE_ANALYSIS events, otherwise the sidecar's stored counts are used.
 *
 * GUARANTEES
 * ----------
 *   - Pure: takes a directory path, returns an array. No globals, no IO
 *     beyond the directory it's pointed at.
 *   - Defensive: never throws. Bad files are skipped with a debug log.
 *   - Stable shape: every returned object has the same keys the home page
 *     consumes (delivery is null — IPC layer enriches it).
 */

import * as fs from 'fs';
import * as path from 'path';

// ===========================================================================
// Public types
// ===========================================================================

export interface LocalExecutionRow {
  id: string;
  createdAt: string;
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
  /** Always null from this layer; the IPC layer enriches with R2/gallery info. */
  delivery: null;
}

export interface ScanOptions {
  /** When set, only files belonging to this user (per sidecar `userId`) are returned. */
  ownerUserId?: string;
  /** Optional debug logger. Defaults to no-op. */
  debug?: (msg: string, ctx?: any) => void;
}

const SUMMARY_SUFFIX = '.jsonl.summary.json';
const JSONL_SUFFIX = '.jsonl';
const FILE_PREFIX = 'exec_';

/**
 * Scan a logs directory for executions and return the home-page rows.
 *
 * Sorted by `createdAt` descending. Cap your result with `.slice(0, N)`
 * downstream — the scanner does not impose a limit.
 */
export function scanLocalExecutions(
  logsDir: string,
  options: ScanOptions = {}
): LocalExecutionRow[] {
  const debug = options.debug ?? (() => {});

  if (!safeExists(logsDir)) return [];

  // Pair JSONLs with their sidecars by execution id (the id is encoded in
  // the filename). We use this dual-index so we can also surface orphan
  // sidecars whose JSONL was lost.
  const candidates = new Map<string, { jsonl?: string; summary?: string }>();

  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch (e) {
    debug('readdir failed', { logsDir, err: String((e as any)?.message ?? e) });
    return [];
  }

  for (const f of entries) {
    if (!f.startsWith(FILE_PREFIX)) continue;
    if (f.endsWith(SUMMARY_SUFFIX)) {
      const id = f.slice(FILE_PREFIX.length, -SUMMARY_SUFFIX.length);
      if (!id) continue;
      if (!candidates.has(id)) candidates.set(id, {});
      candidates.get(id)!.summary = path.join(logsDir, f);
    } else if (f.endsWith(JSONL_SUFFIX)) {
      const id = f.slice(FILE_PREFIX.length, -JSONL_SUFFIX.length);
      if (!id) continue;
      if (!candidates.has(id)) candidates.set(id, {});
      candidates.get(id)!.jsonl = path.join(logsDir, f);
    }
  }

  const out: LocalExecutionRow[] = [];

  for (const [, paths] of candidates) {
    try {
      const row = buildRow(paths, debug);
      if (!row) continue;
      if (options.ownerUserId && row.__ownerUserId && row.__ownerUserId !== options.ownerUserId) {
        continue;
      }
      delete (row as any).__ownerUserId;
      out.push(row);
    } catch (e) {
      debug('candidate parse failed', { paths, err: String((e as any)?.message ?? e) });
    }
  }

  out.sort((a, b) => safeTime(b.createdAt) - safeTime(a.createdAt));
  return out;
}

// ===========================================================================
// Internal — per-candidate row builder
// ===========================================================================

/** Internal row type that may include a transient owner id used for filtering. */
type LocalExecutionRowInternal = LocalExecutionRow & { __ownerUserId?: string };

function buildRow(
  paths: { jsonl?: string; summary?: string },
  debug: (msg: string, ctx?: any) => void
): LocalExecutionRowInternal | null {
  // ---- Parse JSONL with full-file scan (self-heal corrupt first line) ----
  let startEvent: any = null;
  let status: LocalExecutionRow['status'] = 'processing';
  let totalProcessed = 0;
  let imagesWithNumbers = 0;
  let latestExecutionName: string | undefined;
  let jsonlReadable = false;

  if (paths.jsonl && safeExists(paths.jsonl)) {
    let content: string | null = null;
    try {
      content = fs.readFileSync(paths.jsonl, 'utf-8');
    } catch (e) {
      debug('JSONL read failed', { path: paths.jsonl, err: String((e as any)?.message ?? e) });
    }
    if (content) {
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: any;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }
        jsonlReadable = true;
        if (event.type === 'EXECUTION_START' && !startEvent) {
          startEvent = event;
        } else if (event.type === 'IMAGE_ANALYSIS') {
          totalProcessed++;
          const vehicles = event.aiResponse?.vehicles || event.vehicles || [];
          if (vehicles.length > 0) {
            if (vehicles.some((v: any) => v && v.raceNumber)) imagesWithNumbers++;
          } else if (event.primaryVehicle?.raceNumber) {
            imagesWithNumbers++;
          }
        } else if (event.type === 'EXECUTION_COMPLETE') {
          status = 'completed';
        } else if (event.type === 'EXECUTION_META_UPDATE') {
          if (typeof event.executionName === 'string') {
            latestExecutionName = event.executionName;
          }
        }
      }
    }
  }

  // ---- Sidecar fallback ----
  let summary: any = null;
  const needSummary = !startEvent || !jsonlReadable;
  if (paths.summary && needSummary) {
    try {
      const raw = fs.readFileSync(paths.summary, 'utf-8');
      const obj = JSON.parse(raw);
      if (
        obj &&
        typeof obj === 'object' &&
        obj.schemaVersion === 1 &&
        typeof obj.id === 'string' &&
        obj.id
      ) {
        summary = obj;
      } else {
        debug('summary schema rejected', { path: paths.summary, schemaVersion: obj?.schemaVersion });
      }
    } catch (e) {
      debug('summary read failed', { path: paths.summary, err: String((e as any)?.message ?? e) });
    }
  }

  // ---- Determine identifier + creation time ----
  const id = startEvent?.executionId ?? summary?.id ?? null;
  const createdAt = startEvent?.timestamp ?? summary?.createdAt ?? null;
  if (!id || !createdAt) {
    debug('candidate has no usable EXECUTION_START or summary', { paths });
    return null;
  }

  // ---- Status precedence ----
  // JSONL EXECUTION_COMPLETE event is most authoritative. If JSONL is silent
  // ('processing' default), fall back to the sidecar's status.
  let finalStatus: LocalExecutionRow['status'] = status;
  if (status === 'processing' && summary?.status) {
    finalStatus = summary.status;
  }

  // ---- Counts: JSONL evidence wins, sidecar fills the gap ----
  const finalTotal =
    totalProcessed > 0
      ? startEvent?.totalImages || totalProcessed
      : summary?.totalImages ?? startEvent?.totalImages ?? totalProcessed;
  const finalWithNumbers =
    totalProcessed > 0
      ? imagesWithNumbers
      : summary?.imagesWithNumbers ?? imagesWithNumbers;

  const presetSrc = startEvent?.participantPreset || summary?.participantPreset;
  const participantPreset = presetSrc
    ? {
        id: String(presetSrc.id ?? ''),
        name: String(presetSrc.name ?? 'Unknown'),
        participantCount: Number(presetSrc.participantCount ?? 0),
      }
    : null;

  const row: LocalExecutionRowInternal = {
    id,
    createdAt,
    status: finalStatus,
    sportCategory: startEvent?.category || summary?.sportCategory || 'motorsport',
    totalImages: Number.isFinite(finalTotal) ? finalTotal : 0,
    imagesWithNumbers: Number.isFinite(finalWithNumbers) ? finalWithNumbers : 0,
    folderPath: startEvent?.folderPath || summary?.folderPath || '',
    executionName: latestExecutionName || summary?.executionName || null,
    participantPreset,
    delivery: null,
  };

  if (typeof summary?.userId === 'string') {
    row.__ownerUserId = summary.userId;
  } else if (typeof startEvent?.userId === 'string') {
    row.__ownerUserId = startEvent.userId;
  }

  return row;
}

// ===========================================================================
// Helpers
// ===========================================================================

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function safeTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}
