/**
 * Supabase IPC Handlers
 *
 * Handles Supabase-related operations: sport categories, presets, caching, and feature flags.
 */

import { ipcMain } from 'electron';
import { authService } from '../auth-service';
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
      await savePresetParticipantsSupabase(presetId, participants);
      return { success: true };
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

  ipcMain.handle('supabase-update-participant-preset', async (_, { presetId, updateData }: { presetId: string, updateData: Partial<{ name: string, description: string, category_id: string, custom_folders: string[], person_shown_template: string | null }> }) => {
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

      console.log('[PDF Parser] Calling edge function...');

      const { data, error } = await supabase.functions.invoke('parsePdfEntryList', {
        body: {
          pdfBase64,
          userId
        }
      });

      if (error) {
        console.error('[PDF Parser] Edge function error:', error);
        return { success: false, error: error.message };
      }

      // The edge function returns its own success/error format
      return data;

    } catch (e: any) {
      console.error('[PDF Parser] Error:', e);
      return { success: false, error: e.message };
    }
  });
}
