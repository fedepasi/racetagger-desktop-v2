/**
 * Analysis IPC Handlers
 *
 * Handles analysis log visualization, pipeline configuration, and batch processing control.
 * Note: The main analyze-folder and update-analysis-log handlers remain in main.ts
 * due to complex dependencies (exiftool, Supabase upload, etc.).
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { setBatchProcessingCancelled, getActiveProcessingExecutionId } from './context';
import { DEBUG_MODE, ENABLE_DB_EXECUTION_FALLBACK } from '../config';
import { unifiedImageProcessor } from '../unified-image-processor';
import { AnalysisLogger, writeUploadedMarker } from '../utils/analysis-logger';
import { loadFromDatabaseIfExists } from '../utils/execution-log-loader';
import { getSupabaseClient, getUserPlanLimits, reconcileOrphanExecutions, isDbExecutionFallbackEnabled } from '../database-service';
import { authService } from '../auth-service';

// ==================== Log Reading Utilities ====================

/**
 * Read and parse a JSONL log file
 */
function readLogFile(logFilePath: string): any[] {
  if (!fs.existsSync(logFilePath)) {
    return [];
  }

  const logContent = fs.readFileSync(logFilePath, 'utf-8');
  const logLines = logContent.trim().split('\n').filter(line => line.trim());

  return logLines.map(line => {
    try {
      return JSON.parse(line);
    } catch (error) {
      console.warn('[Analysis] Invalid JSON line in log:', line.substring(0, 100));
      return null;
    }
  }).filter(Boolean);
}

/**
 * Get mock log data for testing
 */
function getMockLogData(): any[] {
  return [
    {
      event: 'IMAGE_ANALYSIS',
      fileName: 'IMG_0001.jpg',
      timestamp: new Date().toISOString(),
      data: {
        fileName: 'IMG_0001.jpg',
        analysis: [{ number: '42', confidence: 0.95 }],
        csvMatch: { numero: '42', nome: 'Test Driver', squadra: 'Test Team' },
        imagePath: '/mock/path/IMG_0001.jpg'
      }
    },
    {
      event: 'IMAGE_ANALYSIS',
      fileName: 'IMG_0002.jpg',
      timestamp: new Date().toISOString(),
      data: {
        fileName: 'IMG_0002.jpg',
        analysis: [{ number: '17', confidence: 0.88 }],
        csvMatch: { numero: '17', nome: 'Another Driver', squadra: 'Racing Team' },
        imagePath: '/mock/path/IMG_0002.jpg'
      }
    }
  ];
}

// ==================== Register Handlers ====================

export function registerAnalysisHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering analysis handlers...');

  // Get analysis log (for Log Visualizer - returns array directly)
  ipcMain.handle('get-analysis-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        if (DEBUG_MODE) console.log(`[Analysis] Returning mock log data for execution ${executionId}`);
        return getMockLogData();
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      const logEvents = readLogFile(logFilePath);
      if (DEBUG_MODE) console.log(`[Analysis] Loaded ${logEvents.length} analysis log events for execution ${executionId}`);
      return logEvents;

    } catch (error) {
      console.error('[Analysis] Error reading analysis log:', error);
      return [];
    }
  });

  // Get execution log (returns wrapped response with success flag).
  // `options.preferRemote` → skip the local JSONL and reconstruct from the DB
  // (used by the manual "Refresh" button). The DB path is behind
  // ENABLE_DB_EXECUTION_FALLBACK (#184 Phase 1, OFF by default): with the flag
  // off this behaves EXACTLY as before (missing local JSONL → empty data).
  ipcMain.handle('get-execution-log', async (_, executionId: string, options?: { preferRemote?: boolean }) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        if (DEBUG_MODE) console.log(`[Analysis] Returning mock log data for execution ${executionId}`);
        return { success: true, data: getMockLogData() };
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);
      const localExists = fs.existsSync(logFilePath);

      // Cross-device DB reconstruction. Never throws; returns null when the flag
      // is off, the user isn't authenticated, or anything fails → caller degrades.
      const tryDbReconstruct = async (bypassCache: boolean): Promise<any[] | null> => {
        const authState = authService.getAuthState();
        const userId = authState.isAuthenticated ? authState.user?.id : null;
        if (!userId) return null;
        // Flag resolution: the env var forces it on for local dev; in packaged
        // builds (no env) it's gated per-user via feature_flags.db_execution_fallback
        // (cached 60s). Either source off → behave exactly as today.
        const enabled = ENABLE_DB_EXECUTION_FALLBACK || await isDbExecutionFallbackEnabled();
        if (!enabled) return null;
        const res = await loadFromDatabaseIfExists(
          executionId,
          { supabase: getSupabaseClient(), userId },
          { bypassCache }
        );
        return res ? res.events : null;
      };

      // Manual Refresh: prefer the cloud copy even when a local file exists.
      if (options?.preferRemote) {
        const dbEvents = await tryDbReconstruct(true);
        if (dbEvents) {
          if (DEBUG_MODE) console.log(`[Analysis] Refresh: reconstructed ${dbEvents.length} events from DB for ${executionId}`);
          return { success: true, data: dbEvents, source: 'db' };
        }
        if (localExists) return { success: true, data: readLogFile(logFilePath), source: 'local' };
        return { success: true, data: [], source: 'none' };
      }

      // Normal open: local-first (unchanged behavior).
      if (localExists) {
        const logEvents = readLogFile(logFilePath);
        if (DEBUG_MODE) console.log(`[Analysis] Loaded ${logEvents.length} log events for execution ${executionId}`);
        return { success: true, data: logEvents, source: 'local' };
      }

      // Local missing → cross-device DB reconstruction (flag-gated).
      if (DEBUG_MODE) console.warn(`[Analysis] Log file not found: ${logFilePath}`);
      const dbEvents = await tryDbReconstruct(false);
      if (dbEvents) {
        if (DEBUG_MODE) console.log(`[Analysis] Reconstructed ${dbEvents.length} events from DB for cloud-only ${executionId}`);
        return { success: true, data: dbEvents, source: 'db' };
      }
      return { success: true, data: [], source: 'none' };

    } catch (error) {
      console.error('[Analysis] Error reading execution log:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // NOTE: update-analysis-log remains in main.ts due to complex dependencies
  // (exiftool metadata updates, Supabase upload, comprehensive validation)

  // Get pipeline configuration
  ipcMain.handle('get-pipeline-config', async () => {
    try {
      const { PIPELINE_CONFIG } = await import('../config');

      return {
        success: true,
        config: {
          enabled: PIPELINE_CONFIG.enabled,
          workers: PIPELINE_CONFIG.workers,
          diskManagement: PIPELINE_CONFIG.diskManagement,
          performance: PIPELINE_CONFIG.performance
        }
      };
    } catch (error) {
      console.error('[Analysis] Error getting pipeline config:', error);
      return {
        success: false,
        error: (error as Error).message || 'Error getting pipeline configuration'
      };
    }
  });

  // Cancel batch processing
  const handleCancelBatchProcessing = async () => {
    console.log('[Analysis] Batch processing cancellation requested');
    setBatchProcessingCancelled(true);

    // Finalizza i token pre-autorizzati (v1.1.0+)
    try {
      await unifiedImageProcessor.handleBatchCancellation();
    } catch (error) {
      console.error('[Analysis] Error handling batch cancellation for tokens:', error);
    }
  };

  ipcMain.on('cancel-batch-processing', handleCancelBatchProcessing);

  // stop-processing is sent by the enhanced-progress.js UI (alias for cancel)
  ipcMain.on('stop-processing', handleCancelBatchProcessing);

  // Get recent executions from local JSONL files
  //
  // Enriches each execution row with:
  //   - executionName  (last EXECUTION_META_UPDATE the user typed)
  //   - participantPreset { name, participantCount }  (from EXECUTION_START)
  //   - folderPath      (from EXECUTION_START, best-effort)
  //   - delivery        { galleries: [{id, title, count}], hd: 'none'|'pending'|'uploading'|'uploaded'|'failed'|'partial', hdCount, hdTotal }
  //
  // Delivery enrichment is batched (two Supabase queries total, not per-execution)
  // and gated on the user's feature flags — users without gallery/r2 access never
  // pay for these queries, and the UI never renders badges it can't act on.
  ipcMain.handle('get-local-executions', async () => {
    try {
      const analysisLogsPath = path.join(app.getPath('userData'), '.analysis-logs');

      // B13 — account-aware filter: only show executions owned by the current
      // user. Without this, after a logout+login the home page surfaces the
      // previous account's analyses (since they share the local logs folder).
      // The scanner already supports `ownerUserId`; legacy logs without a
      // recorded userId remain visible by design (we don't want to hide
      // pre-fix analyses on upgrade).
      const currentUserId = authService.getAuthState().user?.id ?? undefined;

      // Delegate the parsing + self-healing logic to a pure module so it can be
      // unit-tested without pulling Electron + native Sharp into the test graph.
      // See src/utils/local-executions-scanner.ts.
      const { scanLocalExecutions } = require('../utils/local-executions-scanner');
      const executions: any[] = scanLocalExecutions(analysisLogsPath, {
        ownerUserId: currentUserId,
        debug: DEBUG_MODE
          ? (msg: string, ctx: any) => console.warn(`[Analysis] ${msg}`, ctx)
          : undefined,
      });

      // Sort by timestamp descending (most recent first) and cap at 10 BEFORE hitting Supabase —
      // the delivery enrichment only needs to cover what we're actually going to show.
      executions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const top = executions.slice(0, 10);

      // --- Recover interrupted local runs (this device) ---
      // A local execution still 'processing' that was CREATED IN A PREVIOUS app session
      // was interrupted here (crash / force-quit before the run could finalize). The
      // local exec_<id>.jsonl is the proof it ran on THIS machine, so it's safe to treat
      // as interrupted regardless of the token reservation. We flag it (`interrupted`) so
      // the UI shows "Interrupted" immediately. Visibility does NOT depend on the DB write
      // below — re-add dedup vs the cloud fallback is handled by the `localIds` Set there,
      // and the reconcileOrphanExecutions call is fire-and-forget (it only keeps the DB /
      // cloud stats consistent and races, so we never rely on it for dedup or display).
      //
      // The boot-time guard is what makes this safe: a run started in THIS session is still
      // genuinely live and must NOT be flagged — only runs that predate this process, which
      // by definition aren't running anymore.
      //
      // Display vs DB-write are deliberately decoupled. The "Interrupted" FLAG uses the bare
      // boot-time test so even a run killed seconds before a quick relaunch shows correctly.
      // The DB reconcile (which flips status to 'failed') additionally requires the run to be
      // comfortably older than boot — a 5-minute margin — so that a backward clock jump (NTP /
      // DST / manual change) during a genuinely live run can at most cause a brief, self-
      // correcting "Interrupted" label, never an erroneous 'failed' write that kills a live run.
      try {
        const bootTimeMs = Date.now() - process.uptime() * 1000;
        const RECONCILE_MARGIN_MS = 5 * 60 * 1000;
        // A run/resume processing RIGHT NOW in this session must never be flagged or flipped.
        // This matters most for a RESUMED run, which reuses an OLD execution id (old createdAt)
        // and would otherwise look like an interrupted prior-session run while it is mid-flight.
        const activeId = getActiveProcessingExecutionId();
        const localInterruptedIds: string[] = [];
        for (const e of executions as any[]) {
          if (e && e.status === 'processing' && e.createdAt && e.id !== activeId) {
            const createdMs = new Date(e.createdAt).getTime();
            if (createdMs < bootTimeMs) {
              e.interrupted = true; // display flag — shared object ref, also reflected in `top`
              if (createdMs < bootTimeMs - RECONCILE_MARGIN_MS) {
                localInterruptedIds.push(e.id); // only comfortably-old runs are DB-flipped to failed
              }
            }
          }
        }
        if (localInterruptedIds.length > 0) {
          const authState = authService.getAuthState();
          const uid = authState.isAuthenticated ? authState.user?.id : null;
          if (uid) {
            // Fire-and-forget: visibility already comes from the `interrupted` flag above;
            // this only reconciles the DB (Tier-A local-signal, no reservation wait).
            Promise.resolve(reconcileOrphanExecutions(uid, localInterruptedIds)).catch(() => { /* non-fatal */ });
          }
        }
      } catch (recoverErr: any) {
        if (DEBUG_MODE) console.warn('[Analysis] Local interrupted-run recovery failed (non-fatal):', recoverErr?.message ?? recoverErr);
      }

      // --- DB fallback: add cloud executions with no local JSONL to the list ---
      // Recovers from reinstalls, multi-device usage, or corrupted/missing local files.
      // Without this, the home-page stats counter (which reads from the DB) can show more
      // executions than the Recent Analyses list (which reads local files), confusing users.
      try {
        const authState = authService.getAuthState();
        if (authState.isAuthenticated && authState.user?.id) {
          const supabase = getSupabaseClient();
          const { data: dbExecs, error: dbErr } = await supabase
            .from('executions')
            .select('id, name, execution_at, status, processed_images, total_images, source_folder')
            .eq('user_id', authState.user.id)
            // completed/with-errors → ran on another device or local files were lost.
            // failed / stale processing|running → interrupted partway through: surfaced so
            // the analysis the user was charged for is visible (and recoverable) instead of
            // silently vanishing. 'running' is included because a very-early interruption
            // (before the processor upserts the row to 'processing') leaves it at 'running'.
            .in('status', ['completed', 'completed_with_errors', 'failed', 'processing', 'running'])
            .is('deleted_at', null) // never resurface entries the user deleted
            .order('execution_at', { ascending: false })
            .limit(20);
          if (!dbErr && dbExecs) {
            // A 'processing'/'running' row is only treated as interrupted once it is clearly
            // stale. Otherwise it is a run currently in progress and must NOT be flagged broken.
            const STALE_PROCESSING_MS = 90 * 60 * 1000; // 90 min — well beyond a normal large batch
            const now = Date.now();
            // Dedup against EVERY locally-scanned execution (not just the visible top-10), so a
            // local interrupted run beyond the top-10 is never re-added here as a cloud row.
            const localIds = new Set((executions as any[]).map((e: any) => e.id));
            for (const dbExec of (dbExecs as any[])) {
              if (localIds.has(dbExec.id)) continue; // Already shown from local file
              const ts = dbExec.execution_at ? new Date(dbExec.execution_at).getTime() : now;
              const inFlightStatus = dbExec.status === 'processing' || dbExec.status === 'running';
              const isStaleProcessing = inFlightStatus && (now - ts) > STALE_PROCESSING_MS;
              if (inFlightStatus && !isStaleProcessing) continue; // live run — skip
              const interrupted = dbExec.status === 'failed' || isStaleProcessing;
              top.push({
                id: dbExec.id,
                createdAt: dbExec.execution_at || new Date().toISOString(),
                status: dbExec.status,
                sportCategory: 'motorsport',
                totalImages: dbExec.total_images || dbExec.processed_images || 0,
                processedImages: dbExec.processed_images || 0,
                imagesWithNumbers: 0,
                folderPath: dbExec.source_folder || '',
                executionName: dbExec.name || null,
                participantPreset: null,
                delivery: null,
                cloudOnly: true, // Signals renderer to show "no local data" indicator
                interrupted, // Stalled/failed run: recoverable, surfaced so spent credits aren't a mystery
              });
            }
            top.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          }
        }
      } catch (dbFallbackErr: any) {
        if (DEBUG_MODE) console.warn('[Analysis] DB fallback for cloud executions failed (non-fatal):', (dbFallbackErr as any)?.message ?? dbFallbackErr);
      }

      // ---- Delivery enrichment (feature-flagged, batched) ----
      try {
        const authState = authService.getAuthState();
        if (authState.isAuthenticated && top.length > 0) {
          // Pull feature flags once. If the call errors we just skip enrichment —
          // the home page falls back to a "no badges" render which is still correct.
          let planLimits: { gallery_enabled?: boolean; r2_storage_enabled?: boolean } = {};
          try {
            planLimits = await getUserPlanLimits();
          } catch {
            planLimits = {};
          }

          const needGallery = !!planLimits.gallery_enabled;
          const needR2 = !!planLimits.r2_storage_enabled;

          if (needGallery || needR2) {
            const supabase = getSupabaseClient();
            const executionIds = top.map(e => e.id);

            // Build empty per-execution delivery records up front.
            const deliveryByExec: Record<string, { galleries: any[]; hd: string; hdCount: number; hdTotal: number }> =
              Object.fromEntries(top.map(e => [e.id, { galleries: [], hd: 'none', hdCount: 0, hdTotal: 0 }]));

            const tasks: Promise<void>[] = [];

            // Gallery delivery: fetch gallery_images rows for these executions, then
            // resolve titles in a second batched query so we don't need a JOIN.
            if (needGallery) {
              tasks.push((async () => {
                const { data: links, error } = await supabase
                  .from('gallery_images')
                  .select('execution_id, gallery_id')
                  .in('execution_id', executionIds);
                if (error || !links || links.length === 0) return;

                // exec_id -> gallery_id -> count
                const buckets: Record<string, Record<string, number>> = {};
                const galleryIds = new Set<string>();
                for (const row of links as any[]) {
                  if (!row.execution_id || !row.gallery_id) continue;
                  galleryIds.add(row.gallery_id);
                  const b = buckets[row.execution_id] || (buckets[row.execution_id] = {});
                  b[row.gallery_id] = (b[row.gallery_id] || 0) + 1;
                }

                if (galleryIds.size === 0) return;

                const { data: galleryRows, error: gerr } = await supabase
                  .from('galleries')
                  .select('id, title')
                  .in('id', Array.from(galleryIds));
                if (gerr) return;

                const titleById: Record<string, string> = {};
                for (const g of (galleryRows || []) as any[]) {
                  titleById[g.id] = g.title || 'Untitled gallery';
                }

                for (const execId of Object.keys(buckets)) {
                  const b = buckets[execId];
                  const list = Object.keys(b).map(gid => ({
                    id: gid,
                    title: titleById[gid] || 'Untitled gallery',
                    count: b[gid]
                  }));
                  if (deliveryByExec[execId]) deliveryByExec[execId].galleries = list;
                }
              })().catch(() => { /* swallow — fall back to no gallery info */ }));
            }

            // R2 HD upload: aggregate `images.original_upload_status` per execution.
            if (needR2) {
              tasks.push((async () => {
                const { data: imgs, error } = await supabase
                  .from('images')
                  .select('execution_id, original_upload_status')
                  .in('execution_id', executionIds);
                if (error || !imgs) return;

                // Aggregate per execution
                const agg: Record<string, Record<string, number>> = {};
                for (const row of imgs as any[]) {
                  if (!row.execution_id) continue;
                  const status = (row.original_upload_status || 'none').toString();
                  const a = agg[row.execution_id] || (agg[row.execution_id] = {});
                  a[status] = (a[status] || 0) + 1;
                }

                for (const execId of Object.keys(agg)) {
                  const counts = agg[execId];
                  const total = Object.values(counts).reduce((a, b) => a + b, 0);
                  const uploaded = counts['uploaded'] || 0;
                  const failed = counts['failed'] || 0;
                  const uploading = counts['uploading'] || 0;
                  const queued = counts['queued'] || 0;
                  const pending = counts['pending'] || 0;

                  // Derive a single bucket for the UI pill.
                  let hd = 'none';
                  if (failed > 0 && uploaded + uploading + queued + pending === 0) hd = 'failed';
                  else if (failed > 0) hd = 'partial';
                  else if (uploading + queued > 0) hd = 'uploading';
                  else if (uploaded > 0 && uploaded === total) hd = 'uploaded';
                  else if (uploaded > 0) hd = 'partial';
                  else if (pending > 0) hd = 'pending';

                  if (deliveryByExec[execId]) {
                    deliveryByExec[execId].hd = hd;
                    deliveryByExec[execId].hdCount = uploaded;
                    deliveryByExec[execId].hdTotal = total;
                  }
                }
              })().catch(() => { /* swallow — fall back to no HD info */ }));
            }

            await Promise.allSettled(tasks);

            // Attach enriched delivery info + feature-flag hint so the renderer
            // knows whether badges should be rendered at all.
            for (const exec of top) {
              exec.delivery = {
                featureFlags: {
                  gallery_enabled: needGallery,
                  r2_storage_enabled: needR2
                },
                ...deliveryByExec[exec.id]
              };
            }
          }
        }
      } catch (enrichError) {
        if (DEBUG_MODE) console.warn('[Analysis] Delivery enrichment failed (non-fatal):', enrichError);
        // Non-fatal: executions still render without badges.
      }

      // Opportunistic: trigger a JSONL upload reconciliation pass while the
      // user looks at the home page. Debounced to 30s in the reconciler, so
      // rapid navigation doesn't hammer Supabase. Fire-and-forget.
      try {
        const { scheduleBackgroundReconciliation } = require('../utils/jsonl-upload-reconciler');
        scheduleBackgroundReconciliation(
          {
            getSupabase: getSupabaseClient,
            getCurrentUserId: () => authService.getAuthState().user?.id ?? null,
          },
          { reason: 'home-open' }
        );
      } catch (reconErr: any) {
        if (DEBUG_MODE) {
          console.warn('[Analysis] Failed to schedule JSONL reconciliation (non-critical):', reconErr?.message ?? reconErr);
        }
      }

      return { success: true, data: top };

    } catch (error) {
      console.error('[Analysis] Error reading local executions:', error);
      return { success: false, data: [] };
    }
  });

  // Soft-delete an execution from the user's local home view.
  //
  // Behaviour
  // ---------
  //   1. (Best-effort) Stamps `executions.deleted_at = now()` in Supabase.
  //      The DB row is preserved so the management portal can keep showing
  //      it (with a "user-deleted" badge). RLS already restricts updates to
  //      the row's owner.
  //   2. Removes the local `exec_{id}.jsonl` and `exec_{id}.jsonl.summary.json`
  //      files. After this, `scanLocalExecutions` no longer surfaces the
  //      execution on the home page.
  //
  // Design choices
  // --------------
  //   - Local file removal is the source of truth for the user's home page,
  //     so we do it even when the Supabase update fails (offline, RLS, etc.).
  //     The user-visible promise — "the row goes away" — is honoured.
  //   - Supabase failures are logged but not surfaced as errors. Worst case:
  //     the row stays active server-side and the next time the user signs in
  //     on a different machine the analysis reappears in the local cache —
  //     acceptable trade-off vs. blocking the UI on a network hop.
  ipcMain.handle('delete-local-execution', async (_, executionId: string) => {
    try {
      if (!executionId || typeof executionId !== 'string') {
        return { success: false, error: 'Invalid execution id' };
      }

      // 1. Best-effort soft-delete in Supabase. Filtered by user_id so a
      //    compromised renderer can't nuke other users' rows (defense in
      //    depth — RLS already enforces this).
      try {
        const authState = authService.getAuthState();
        if (authState.isAuthenticated && authState.user?.id) {
          const supabase = getSupabaseClient();
          const { error: dbError } = await supabase
            .from('executions')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', executionId)
            .eq('user_id', authState.user.id);
          if (dbError && DEBUG_MODE) {
            console.warn('[Analysis] Supabase soft-delete failed (non-fatal):', dbError);
          }
        }
      } catch (dbError) {
        if (DEBUG_MODE) console.warn('[Analysis] Supabase soft-delete threw (non-fatal):', dbError);
      }

      // 2. Remove local artifacts. We unlink both the JSONL and its sidecar;
      //    either one missing is fine (the scanner tolerates orphans). We
      //    consider success as "the row will not reappear on next refresh",
      //    which only requires both files to be absent.
      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const jsonlPath = path.join(logsDir, `exec_${executionId}.jsonl`);
      const summaryPath = path.join(logsDir, `exec_${executionId}.jsonl.summary.json`);

      const removeIfExists = (p: string) => {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {
          if (DEBUG_MODE) console.warn(`[Analysis] Could not remove ${p}:`, e);
        }
      };
      removeIfExists(jsonlPath);
      removeIfExists(summaryPath);

      // Verify both files are gone before returning success — otherwise the
      // home row would reappear on the next refresh and confuse the user.
      const stillThere = fs.existsSync(jsonlPath) || fs.existsSync(summaryPath);
      if (stillThere) {
        return { success: false, error: 'Could not remove local log files (permission?)' };
      }

      return { success: true, data: { executionId } };
    } catch (error) {
      console.error('[Analysis] Error deleting local execution:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Restore an analysis from the cloud. When a run shows as "☁ Cloud" (its local JSONL is
  // missing — reinstall, another device, or a deleted/corrupt file) but a byte-exact backup
  // exists in the 'analysis-logs' Storage bucket, download it back into .analysis-logs/ so the
  // run becomes a normal local run again — results view, organize and export all read from the
  // JSONL, so writing it back IS the whole fix. No re-analysis, no credits.
  //
  // Returns code:'no_cloud_copy' (not an error) when there is no cloud backup — the run never
  // finished uploading — so the UI can be honest instead of dangling a dead button. Original
  // photos are NOT restored: organize/export still need them on disk (surfaced in the modal copy).
  ipcMain.handle('restore-execution-from-cloud', async (_, executionId: string) => {
    try {
      if (!executionId || typeof executionId !== 'string') {
        return { success: false, error: 'Invalid execution id' };
      }
      // Defense in depth: executionId is interpolated into a local file path below. Require the
      // UUID shape outright instead of relying on the remote uuid-column cast to reject anything
      // odd — keeps the fs write safe even if this is ever reused against a non-uuid key.
      if (!/^[0-9a-fA-F-]{36}$/.test(executionId)) {
        return { success: false, error: 'Invalid execution id' };
      }

      const authState = authService.getAuthState();
      if (!authState.isAuthenticated || !authState.user?.id) {
        return { success: false, error: 'You need to be signed in to restore an analysis.' };
      }
      const userId = authState.user.id;
      const supabase = getSupabaseClient();

      // 1. Find the cloud backup's exact object path. Scoped by user_id (defense in depth; RLS
      //    already enforces it). analysis_log_metadata has no unique constraint and can hold
      //    duplicate rows per execution (e.g. an in-flight 0-image row + the final one), so pick
      //    the most complete row deterministically and ignore null/empty paths.
      const { data: metaRows, error: metaErr } = await supabase
        .from('analysis_log_metadata')
        .select('storage_path, total_images')
        .eq('execution_id', executionId)
        .eq('user_id', userId);

      if (metaErr) {
        if (DEBUG_MODE) console.warn('[Analysis] restore: metadata lookup failed:', metaErr);
        return { success: false, error: "Couldn't reach the cloud to look up this analysis. Check your connection and try again." };
      }

      const candidate = (metaRows || [])
        .filter((r: any) => r && typeof r.storage_path === 'string' && r.storage_path.length > 0)
        .sort((a: any, b: any) => (b.total_images || 0) - (a.total_images || 0))[0];

      if (!candidate) {
        // No cloud backup — the run never finished uploading. Honest signal, not an error.
        return { success: false, code: 'no_cloud_copy' };
      }

      // 2. Download the JSONL bytes from the 'analysis-logs' bucket.
      const { data: blob, error: dlErr } = await supabase.storage
        .from('analysis-logs')
        .download(candidate.storage_path);
      if (dlErr || !blob) {
        if (DEBUG_MODE) console.warn('[Analysis] restore: download failed:', dlErr);
        return { success: false, error: "Found the cloud backup but couldn't download it. Check your connection and try again." };
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.length === 0) {
        return { success: false, error: "The cloud backup came back empty. Try again in a moment." };
      }

      // 2b. Only restore a COMPLETED run. The reconciler also backs up the partial logs of
      //     interrupted runs (EXECUTION_START but no EXECUTION_COMPLETE) — writing one back would
      //     scan as 'processing' and get re-flagged "Interrupted" on the next Home open: a
      //     confusing restore-that-didn't-restore. If the backup isn't a finished run, don't write
      //     it; tell the user honestly (the modal treats 'incomplete_backup' like nothing-to-restore).
      if (!buffer.includes('"EXECUTION_COMPLETE"')) {
        return { success: false, code: 'incomplete_backup' };
      }

      // 3. Write it back atomically (tmp + rename) so a concurrent Home refresh / scanLocalExecutions
      //    never sees a half-written file (mirrors writeExecutionSummary's tmp+rename).
      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const jsonlPath = path.join(logsDir, `exec_${executionId}.jsonl`);
      const tmpPath = `${jsonlPath}.tmp`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, jsonlPath);

      // 4. Mark it already-uploaded so the reconciler fast-paths it (it's identical to the cloud
      //    copy — no need to push it straight back up).
      writeUploadedMarker(jsonlPath);

      return { success: true, data: { executionId } };
    } catch (error) {
      console.error('[Analysis] Error restoring execution from cloud:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Rename an execution: appends an EXECUTION_META_UPDATE event to the JSONL
  // (local source of truth) and best-effort syncs the name column on the
  // `executions` row in Supabase. Safe to call for finalized executions.
  ipcMain.handle('rename-execution', async (_, executionId: string, newName: string) => {
    try {
      if (!executionId || typeof executionId !== 'string') {
        return { success: false, error: 'Invalid execution id' };
      }
      const trimmed = (newName || '').trim().slice(0, 120); // reasonable cap
      if (!trimmed) {
        return { success: false, error: 'Name cannot be empty' };
      }

      // 1. Local: append to JSONL (primary source for Home page).
      const ok = await AnalysisLogger.appendExecutionMetaUpdate(executionId, trimmed);
      if (!ok) {
        return { success: false, error: 'Execution log not found' };
      }

      // 2. Supabase: best-effort sync of the `name` column. We swallow failures —
      //    the JSONL is authoritative and the Home page reads from it.
      try {
        const authState = authService.getAuthState();
        if (authState.isAuthenticated) {
          const supabase = getSupabaseClient();
          await supabase
            .from('executions')
            .update({ name: trimmed })
            .eq('id', executionId);
        }
      } catch (dbError) {
        if (DEBUG_MODE) console.warn('[Analysis] Supabase rename sync failed (non-fatal):', dbError);
      }

      return { success: true, data: { executionId, executionName: trimmed } };
    } catch (error) {
      console.error('[Analysis] Error renaming execution:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ==================== User Action Telemetry ====================
  //
  // Append a USER_ACTION line to the active execution's JSONL when the user
  // performs a tracked action on the results page (open/close modal, click
  // Write to Originals or Export, organize folders, send a delivery, exit).
  //
  // Bridge to the renderer-side wrapper `window.logUserAction(...)` defined
  // in renderer/js/user-action-logger.js. The wrapper is the canonical entry
  // point — never call this channel directly from a button handler, route
  // through the wrapper so debouncing and sanitization are applied.
  //
  // Fire-and-forget: failures (missing JSONL, malformed args, disk error)
  // are logged but do NOT surface to the user. Telemetry must never break a
  // workflow it's only there to observe.
  //
  // Validation is paranoid — payloads come from the renderer, which has been
  // talking to this main process for an unknown amount of time. Reject
  // anything that doesn't fit the contract rather than persist garbage.
  const ALLOWED_CATEGORIES = new Set([
    'VIEW', 'CONFIGURE', 'EXECUTE', 'CORRECT', 'EXPORT', 'DELIVERY', 'EXIT'
  ]);
  // Hard cap on serialized payload size. 8 KB is generous for our taxonomy
  // (typical payload < 500 bytes); anything bigger is almost certainly a
  // mistake (whole IPTC blob being passed in instead of just field names).
  const MAX_DATA_BYTES = 8 * 1024;

  ipcMain.handle('log-user-action', async (_, payload: {
    executionId?: string;
    action?: string;
    category?: string;
    data?: Record<string, unknown>;
    sessionId?: string;
  }) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'Invalid payload' };
      }
      const { executionId, action, category, data, sessionId } = payload;

      if (!executionId || typeof executionId !== 'string' || executionId.length > 64) {
        return { success: false, error: 'Invalid executionId' };
      }
      if (!action || typeof action !== 'string' || action.length > 64) {
        return { success: false, error: 'Invalid action' };
      }
      if (!category || typeof category !== 'string' || !ALLOWED_CATEGORIES.has(category)) {
        return { success: false, error: 'Invalid category' };
      }
      if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 64)) {
        return { success: false, error: 'Invalid sessionId' };
      }

      // Optional payload — when present must be a plain object that
      // serializes cleanly within the size cap. Malformed payloads are
      // dropped (event still logged with `data: undefined`) rather than
      // failing the whole call, since the action key alone is useful.
      let safeData: Record<string, unknown> | undefined;
      if (data !== undefined) {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          if (DEBUG_MODE) {
            console.warn(`[Analysis] log-user-action: data must be a plain object — dropping payload for ${action}`);
          }
        } else {
          try {
            const serialized = JSON.stringify(data);
            if (serialized.length > MAX_DATA_BYTES) {
              if (DEBUG_MODE) {
                console.warn(`[Analysis] log-user-action: data exceeds ${MAX_DATA_BYTES} bytes (${serialized.length}) — dropping payload for ${action}`);
              }
            } else {
              safeData = data;
            }
          } catch {
            // Circular refs etc. — drop payload, keep event.
            if (DEBUG_MODE) {
              console.warn(`[Analysis] log-user-action: data not JSON-serializable — dropping payload for ${action}`);
            }
          }
        }
      }

      // Capture client_timestamp at the moment the renderer requested the
      // log — closer to "when the action actually happened" than the
      // eventual JSONL append or DB insert, both of which can be delayed.
      const clientTimestamp = new Date().toISOString();

      // Step 1: durable append to JSONL (fast, local, offline-safe).
      const logged = await AnalysisLogger.appendUserAction(
        executionId,
        action,
        category as any, // category was validated against ALLOWED_CATEGORIES above
        safeData,
        sessionId
      );

      // Step 2: fire-and-forget direct INSERT into execution_user_actions.
      // The JSONL is the durable record; the DB row is the queryable view.
      // We do BOTH because:
      //   • The JSONL is auto-uploaded to Supabase Storage only at
      //     execution finalize, and USER_ACTION events happen AFTER that.
      //     Without the direct insert these rows would never reach the DB.
      //   • If the insert fails (offline, RLS, transient 5xx), the JSONL
      //     line on disk is the safety net for a later backfill pass.
      //
      // We don't await — RLS errors / network issues must not slow down
      // the renderer. The catch block on the IIFE swallows everything;
      // worst case the row is missing from the dashboard until backfill.
      const userId = authService.getAuthState().user?.id;
      if (userId && logged) {
        (async () => {
          try {
            const supabase = getSupabaseClient();
            // Lazy require to dodge the synchronous import cost on app boot
            // for users who never reach the results page.
            const { app: electronApp } = require('electron');
            const { error: insertError } = await supabase
              .from('execution_user_actions')
              .insert({
                execution_id: executionId,
                user_id: userId,
                session_id: sessionId ?? null,
                action,
                category,
                data: safeData ?? {},
                app_version: electronApp.getVersion(),
                client_timestamp: clientTimestamp
              });
            if (insertError && DEBUG_MODE) {
              // RLS denial on a stale executionId (cascade-deleted parent)
              // is the most common cause; not a real error worth spamming
              // about. Log only in debug.
              console.warn('[Analysis] log-user-action DB insert failed (non-fatal):', insertError.message);
            }
          } catch (dbErr) {
            if (DEBUG_MODE) {
              console.warn('[Analysis] log-user-action DB insert threw (non-fatal):', dbErr);
            }
          }
        })();
      }

      return { success: true, data: { logged } };
    } catch (error) {
      // Telemetry must never throw — log and report failure to caller.
      // Caller is fire-and-forget and should ignore the error anyway.
      console.error('[Analysis] log-user-action handler error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  if (DEBUG_MODE) console.log('[IPC] Analysis handlers registered (8 handlers)');
}
