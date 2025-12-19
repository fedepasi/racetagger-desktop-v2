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
  isFeatureEnabled
} from '../database-service';

export function registerSupabaseHandlers(): void {
  console.log('[IPC] Registering Supabase handlers...');

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
      console.log('[Supabase] Returning', categories.length, 'cached categories');
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
    try {
      const presets = await getUserParticipantPresetsSupabase();
      return { success: true, data: presets };
    } catch (e: any) {
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
    try {
      if (!authService.isAdmin()) {
        return { success: false, error: 'Unauthorized: Admin access required' };
      }

      console.log('[Supabase] Admin requesting all presets');
      const presets = await getUserParticipantPresetsSupabase(true);
      return { success: true, data: presets };
    } catch (e: any) {
      console.error('[Supabase] Error getting all presets:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-duplicate-official-preset', async (_, presetId: string) => {
    try {
      console.log('[Supabase] Duplicating preset:', presetId);
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

  console.log('[IPC] Supabase handlers registered (17 handlers)');
}
