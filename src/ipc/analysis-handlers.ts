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
import { setBatchProcessingCancelled } from './context';
import { DEBUG_MODE } from '../config';
import { unifiedImageProcessor } from '../unified-image-processor';
import { AnalysisLogger } from '../utils/analysis-logger';
import { getSupabaseClient, getUserPlanLimits } from '../database-service';
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

  // Get execution log (returns wrapped response with success flag)
  ipcMain.handle('get-execution-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        if (DEBUG_MODE) console.log(`[Analysis] Returning mock log data for execution ${executionId}`);
        return { success: true, data: getMockLogData() };
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      if (!fs.existsSync(logFilePath)) {
        if (DEBUG_MODE) console.warn(`[Analysis] Log file not found: ${logFilePath}`);
        return { success: true, data: [] };
      }

      const logEvents = readLogFile(logFilePath);
      if (DEBUG_MODE) console.log(`[Analysis] Loaded ${logEvents.length} log events for execution ${executionId}`);
      return { success: true, data: logEvents };

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

  if (DEBUG_MODE) console.log('[IPC] Analysis handlers registered (7 handlers)');
}
