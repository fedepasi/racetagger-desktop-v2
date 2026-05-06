/**
 * Supabase IPC Handlers
 *
 * Handles Supabase-related operations: sport categories, presets, caching, and feature flags.
 */

import { ipcMain } from 'electron';
import { authService } from '../auth-service';
import { errorTelemetryService } from '../utils/error-telemetry-service';
import {
  // Sport Categories
  getSportCategories,
  getSportCategoryByCode,
  getCachedSportCategories,
  refreshCategoriesCache,
  cacheSupabaseData,
  // Participant Presets (Supabase)
  ParticipantPresetSupabase,
  PresetParticipantSupabase,
  createParticipantPresetSupabase,
  getUserParticipantPresetsSupabase,
  getParticipantPresetByIdSupabase,
  savePresetParticipantsSupabase,
  bulkAssignFoldersSupabase,
  updatePresetLastUsedSupabase,
  updateParticipantPresetSupabase,
  deleteParticipantPresetSupabase,
  importParticipantsFromCSVSupabase,
  getCachedParticipantPresets,
  duplicateOfficialPresetSupabase,
  // Feature Flags
  isFeatureEnabled,
  // Supabase client
  getSupabaseClient
} from '../database-service';

export function registerSupabaseHandlers(): void {

  // ==================== SPORT CATEGORIES ====================

  ipcMain.handle('supabase-get-sport-categories', async () => {
    try {
      const categories = await getSportCategories();
      return { success: true, data: categories };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-sport-category-by-code', async (_, code: string) => {
    try {
      const category = await getSportCategoryByCode(code);
      return { success: true, data: category };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-cached-sport-categories', async () => {
    try {
      const categories = getCachedSportCategories();
      return { success: true, data: categories };
    } catch (e: any) {
      console.error('[Supabase] Error getting cached categories:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-refresh-categories-cache', async () => {
    try {
      await refreshCategoriesCache();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== PARTICIPANT PRESETS ====================

  ipcMain.handle('supabase-create-participant-preset', async (_, presetData: Omit<ParticipantPresetSupabase, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const preset = await createParticipantPresetSupabase(presetData);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-participant-presets', async () => {
    console.log('[Presets] Loading participant presets...');
    try {
      const presets = await getUserParticipantPresetsSupabase();
      console.log(`[Presets] Loaded ${presets?.length || 0} presets`);
      // Log participant counts for debugging
      const zeroParticipants = presets?.filter(p => !p.participants || p.participants.length === 0) || [];
      if (zeroParticipants.length > 0) {
        console.log(`[Presets] WARNING: ${zeroParticipants.length} presets have 0 participants:`, zeroParticipants.map(p => p.name).join(', '));
      }
      return { success: true, data: presets };
    } catch (e: any) {
      console.error('[Presets] Error loading presets:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-participant-preset-by-id', async (_, presetId: string) => {
    try {
      const preset = await getParticipantPresetByIdSupabase(presetId);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-save-preset-participants', async (_, { presetId, participants }: { presetId: string, participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[] }) => {
    try {
      const savedParticipants = await savePresetParticipantsSupabase(presetId, participants);
      return { success: true, participants: savedParticipants };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  /**
   * Bulk-assign one or more folder names to many preset participants in a
   * single round-trip. Backbone of the split-view bulk UI (PR3) and the
   * auto-assign rules engine (PR4). Dormant until the renderer wires it up.
   *
   * Folder names must already exist in the preset's custom_folders pool;
   * names not in the pool are skipped and reported in `unknownFolderNames`
   * so the UI can show a "create folder first" hint.
   */
  ipcMain.handle('supabase-bulk-assign-folders', async (_, payload: {
    presetId: string;
    participantIds: string[];
    folderNames: string[];
    mode: 'append' | 'replace';
  }) => {
    try {
      const result = await bulkAssignFoldersSupabase(
        payload.presetId,
        payload.participantIds,
        payload.folderNames,
        payload.mode
      );
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-update-preset-last-used', async (_, presetId: string) => {
    try {
      await updatePresetLastUsedSupabase(presetId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-update-participant-preset', async (_, { presetId, updateData }: { presetId: string, updateData: Partial<{ name: string, description: string, category_id: string, custom_folders: (string | { name: string; path?: string })[], person_shown_template: string | null, allow_external_person_recognition: boolean }> }) => {
    try {
      await updateParticipantPresetSupabase(presetId, updateData);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-delete-participant-preset', async (_, presetId: string) => {
    try {
      await deleteParticipantPresetSupabase(presetId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-import-participants-from-csv', async (_, { csvData, presetName, categoryId }: { csvData: any[], presetName: string, categoryId?: string }) => {
    try {
      const preset = await importParticipantsFromCSVSupabase(csvData, presetName, categoryId);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-cached-participant-presets', async () => {
    try {
      const presets = getCachedParticipantPresets();
      return { success: true, data: presets };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== ADMIN HANDLERS ====================

  ipcMain.handle('supabase-get-all-participant-presets-admin', async () => {
    console.log('[Presets-Admin] Loading ALL participant presets (admin mode)...');
    try {
      const isAdmin = authService.isAdmin();
      console.log('[Presets-Admin] isAdmin check:', isAdmin);

      if (!isAdmin) {
        console.log('[Presets-Admin] Access denied - not admin');
        return { success: false, error: 'Unauthorized: Admin access required' };
      }

      const presets = await getUserParticipantPresetsSupabase(true);
      console.log(`[Presets-Admin] Loaded ${presets?.length || 0} presets (admin mode)`);
      return { success: true, data: presets };
    } catch (e: any) {
      console.error('[Supabase] Error getting all presets:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-duplicate-official-preset', async (_, presetId: string) => {
    try {
      const newPreset = await duplicateOfficialPresetSupabase(presetId);
      return { success: true, data: newPreset };
    } catch (e: any) {
      console.error('[Supabase] Error duplicating preset:', e);
      return { success: false, error: e.message };
    }
  });

  // ==================== CACHE MANAGEMENT ====================

  ipcMain.handle('supabase-cache-data', async () => {
    try {
      await cacheSupabaseData();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== FEATURE FLAGS ====================

  ipcMain.handle('supabase-is-feature-enabled', async (_, featureName: string) => {
    try {
      const isEnabled = await isFeatureEnabled(featureName);
      return { success: true, data: isEnabled };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== HOME STATISTICS ====================

  ipcMain.handle('get-home-statistics', async () => {
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) {
        return {
          success: true,
          data: {
            monthlyPhotos: 0,
            completedEvents: 0
          }
        };
      }

      // Get last 30 days date range
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      let monthlyPhotos = 0;
      let completedEvents = 0;

      try {
        const supabase = getSupabaseClient();

        // Query executions with JOIN to execution_settings for photo counts
        // Use explicit relationship name to avoid ambiguity (there are 2 FK constraints)
        const { data, error } = await supabase
          .from('executions')
          .select(`
            id,
            status,
            created_at,
            execution_settings!execution_settings_execution_id_fkey (
              total_images_processed
            )
          `)
          .eq('user_id', userId)
          .gte('created_at', thirtyDaysAgo.toISOString());

        if (error) {
          console.error('[Home Stats] Query error:', error);
        } else if (data) {
          for (const exec of data) {
            if (exec.status === 'completed') {
              completedEvents++;
            }
            const settings = exec.execution_settings as any;
            if (settings && settings.total_images_processed) {
              monthlyPhotos += settings.total_images_processed;
            }
          }
        }
      } catch (queryError) {
        console.error('[Home Stats] Error querying stats:', queryError);
      }

      return {
        success: true,
        data: {
          monthlyPhotos,
          completedEvents
        }
      };
    } catch (error) {
      console.error('[Home Stats] Error:', error);
      return {
        success: false,
        data: { monthlyPhotos: 0, completedEvents: 0 }
      };
    }
  });

  // ==================== ANNOUNCEMENTS ====================

  ipcMain.handle('get-announcements', async () => {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('desktop_announcements')
        .select('title, description, image_url, link_url')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .limit(5);

      if (error) {
        console.error('[Announcements] Supabase error:', error);
        return { success: false, data: [] };
      }

      return { success: true, data: data || [] };
    } catch (error) {
      console.error('[Announcements] Error fetching announcements:', error);
      return { success: false, data: [] };
    }
  });

  // ==================== RECENT EXECUTIONS ====================

  ipcMain.handle('get-recent-executions', async () => {
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) {
        return { success: false, data: [] };
      }

      const supabase = getSupabaseClient();

      // Get last 10 executions with details
      const { data, error } = await supabase
        .from('executions')
        .select(`
          id,
          status,
          created_at,
          completed_at,
          sport_category_id,
          sport_categories!executions_sport_category_id_fkey (
            name,
            code
          ),
          execution_settings!execution_settings_execution_id_fkey (
            total_images_processed
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[Recent Executions] Query error:', error);
        return { success: false, data: [] };
      }

      // Get analysis results counts for each execution
      const executionIds = (data || []).map((e: any) => e.id);
      let resultsCountMap: Record<string, number> = {};

      if (executionIds.length > 0) {
        // Query to count analysis results with recognized numbers per execution
        const { data: countData } = await supabase
          .from('analysis_results')
          .select('image_id, recognized_number, images!inner(execution_id)')
          .in('images.execution_id', executionIds)
          .not('recognized_number', 'is', null);

        // Count by execution_id
        if (countData) {
          for (const result of countData) {
            const execId = (result as any).images?.execution_id;
            if (execId) {
              resultsCountMap[execId] = (resultsCountMap[execId] || 0) + 1;
            }
          }
        }
      }

      // Format the data for display
      const formattedData = (data || []).map((exec: any) => ({
        id: exec.id,
        status: exec.status,
        createdAt: exec.created_at,
        completedAt: exec.completed_at,
        sportCategory: exec.sport_categories?.name || 'Unknown',
        sportCategoryCode: exec.sport_categories?.code || '',
        totalImages: exec.execution_settings?.total_images_processed || 0,
        imagesWithNumbers: resultsCountMap[exec.id] || 0,
        presetId: null
      }));

      return { success: true, data: formattedData };
    } catch (error) {
      console.error('[Recent Executions] Error:', error);
      return { success: false, data: [] };
    }
  });

  // ==================== PDF ENTRY LIST PARSING ====================

  ipcMain.handle('supabase-parse-pdf-entry-list', async (_, { pdfBase64 }: { pdfBase64: string }) => {
    try {
      const supabase = getSupabaseClient();
      const userId = authService.getAuthState().user?.id;

      // Try to extract PDF text locally first (fast path).
      //
      // The edge function supports two ingestion paths:
      //   1) `pdfText` (preferred) — we extract text here with pdf-parse and
      //      send the plain-text dump. The edge function chunks on entry-header
      //      boundaries and runs Gemini Flash-Lite in parallel; full 161-entry
      //      lists complete in ~12s instead of 130-150s.
      //   2) `pdfBase64` (legacy fallback) — we send the raw PDF; the edge
      //      function uses Gemini Pro Vision. Slow on long lists but works
      //      for any PDF, including image-only/scanned PDFs that pdf-parse
      //      can't decode.
      //
      // We try (1) first; if pdf-parse fails (corrupted PDF, image-only PDF,
      // edge case parse error), we silently fall back to (2). If text extraction
      // succeeds but yields too little content (e.g. a scan with OCR'd text but
      // missing structure), the edge function will detect the empty participant
      // list and return its standard 400 error — no different from a vision-mode
      // failure on the same document.
      let pdfText: string | null = null;
      try {
        // Lazy require: avoid loading pdf-parse on app start. The dynamic
        // form (vs. ES import) also keeps TypeScript out of the typecheck
        // of pdf-parse's untyped JS.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse: (data: Buffer) => Promise<{ text: string }> = require('pdf-parse');
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const result = await pdfParse(pdfBuffer);
        if (result?.text && result.text.trim().length >= 100) {
          // Sanity threshold: a real entry list extracted as text always has
          // hundreds of chars at minimum. Anything below 100 chars is almost
          // certainly an image-only PDF where pdf-parse returned essentially
          // nothing — fall back to vision so Gemini OCRs it.
          pdfText = result.text;
          console.log(`[PDF Parser] Text extracted locally: ${pdfText.length} chars (${result.text.split('\n').length} lines)`);
        } else {
          console.log(`[PDF Parser] Local extraction yielded too little text (${result?.text?.length ?? 0} chars), falling back to vision path`);
        }
      } catch (extractErr: any) {
        // pdf-parse can fail on encrypted PDFs, malformed PDFs, or when the
        // bundled pdfjs hits an unsupported feature. Don't surface this to
        // the user — just fall back to vision mode.
        console.warn(`[PDF Parser] Local text extraction failed (${extractErr?.message ?? extractErr}), falling back to vision path`);
      }

      const pathUsed = pdfText ? 'text' : 'vision';
      console.log(`[PDF Parser] Calling edge function (path: ${pathUsed})...`);

      // Friendly user-facing message that hides edge-function/Gemini stack traces.
      // The detailed error is captured separately and reported via telemetry,
      // which dedupes & opens a GitHub issue for us. The user sees the same
      // message regardless of whether it was a network blip, a Gemini timeout,
      // or a malformed response — they all need the same action: try again.
      const FRIENDLY_USER_ERROR =
        "We couldn't read your entry list right now. We've automatically reported the issue and are looking into it — please try again in a few minutes, or upload a different PDF.";

      // Helper: report failure to telemetry so it lands as a GitHub issue,
      // then return the generic message to the renderer.
      const reportAndFailGracefully = (rawError: unknown, phase: string, extra?: Record<string, unknown>) => {
        try {
          const errObj = rawError instanceof Error
            ? rawError
            : new Error(typeof rawError === 'string' ? rawError : JSON.stringify(rawError));
          // Tag the message with the phase so the GitHub issue title differentiates
          // 'edge_call_failed' vs 'http_error_response' vs 'unexpected_exception'.
          const taggedMsg = `[parsePdfEntryList:${phase}] ${errObj.message}`;
          errorTelemetryService.reportCriticalError({
            errorType: 'pdf_parser',
            severity: 'recoverable',
            error: Object.assign(new Error(taggedMsg), { stack: errObj.stack }),
            batchPhase: `pdf_parser/${pathUsed}/${phase}`,
            ...(extra ? {} : {})
          });
          console.error(`[PDF Parser] Reported to telemetry (${phase}):`, taggedMsg, extra ?? '');
        } catch (telemetryErr) {
          // Never let telemetry break the user's flow — even logging is best-effort.
          console.warn('[PDF Parser] Telemetry reporting failed (safe):', telemetryErr);
        }
        return { success: false, error: FRIENDLY_USER_ERROR };
      };

      const { data, error } = await supabase.functions.invoke('parsePdfEntryList', {
        body: pdfText
          ? { pdfText, userId }
          : { pdfBase64, userId }
      });

      if (error) {
        // FunctionsHttpError hides the response body. We still try to read it for
        // the GitHub issue (so we know what Gemini actually said), but the user
        // never sees the raw text.
        let bodyDetail: any = null;
        try {
          const resp: Response | undefined = (error as any)?.context;
          if (resp && typeof resp.text === 'function') {
            const raw = await resp.text();
            try { bodyDetail = JSON.parse(raw); } catch { bodyDetail = raw; }
          }
        } catch (_) { /* ignore */ }

        const detailMsg =
          (bodyDetail && typeof bodyDetail === 'object' && (bodyDetail.error || bodyDetail.message)) ||
          (typeof bodyDetail === 'string' ? bodyDetail : null) ||
          error.message ||
          'Unknown edge function error';

        // Special case: 400 with "Document is not a valid entry list or start list"
        // is a USER input issue (uploaded e.g. an invoice or random PDF), not a bug.
        // Don't open a GitHub issue for those — but still hide the technical detail
        // and show a clearer message.
        const isInvalidDocument =
          (typeof bodyDetail === 'object' && bodyDetail?.validation?.document_type === 'other') ||
          (typeof detailMsg === 'string' && detailMsg.toLowerCase().includes('not a valid entry list'));

        if (isInvalidDocument) {
          console.log('[PDF Parser] Document rejected as not-an-entry-list (user-side issue, not reporting)');
          return {
            success: false,
            error: "This document doesn't look like a race entry list or start list. Please upload an entry list, start list, or race results PDF.",
          };
        }

        return reportAndFailGracefully(detailMsg, 'edge_invocation_error', {
          httpStatus: (error as any)?.context?.status,
          bodyDetail
        });
      }

      // The edge function returns its own { success, error/data } envelope.
      // If the edge function itself reports success=false (e.g. internal Gemini
      // crash bubbled up as 500), funnel that through the same telemetry path.
      if (data && typeof data === 'object' && data.success === false) {
        const isInvalidDocument = data?.validation?.document_type === 'other';
        if (isInvalidDocument) {
          return {
            success: false,
            error: "This document doesn't look like a race entry list or start list. Please upload an entry list, start list, or race results PDF.",
          };
        }
        return reportAndFailGracefully(data.error || 'edge function returned success=false', 'edge_returned_failure', {
          edgeResponse: data
        });
      }

      return data;

    } catch (e: any) {
      // Catch-all for anything we missed (network errors, JSON parse errors, etc).
      console.error('[PDF Parser] Unexpected error:', e);
      try {
        errorTelemetryService.reportCriticalError({
          errorType: 'pdf_parser',
          severity: 'recoverable',
          error: e instanceof Error ? e : new Error(String(e?.message ?? e)),
          batchPhase: 'pdf_parser/handler/unexpected_exception',
        });
      } catch { /* never let telemetry break things */ }
      return {
        success: false,
        error: "We couldn't read your entry list right now. We've automatically reported the issue and are looking into it — please try again in a few minutes, or upload a different PDF.",
      };
    }
  });
}
