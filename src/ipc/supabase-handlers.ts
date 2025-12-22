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

  ipcMain.handle('supabase-update-participant-preset', async (_, { presetId, updateData }: { presetId: string, updateData: Partial<{ name: string, description: string, category_id: string }> }) => {
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
}
