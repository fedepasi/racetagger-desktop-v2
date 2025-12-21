/**
 * Participant Preset IPC Handlers
 * Handles all participant preset-related database operations (both local and Supabase)
 */

import { ipcMain } from 'electron';
import { authService } from '../../../auth-service';
import {
  // Local preset functions
  ParticipantPreset,
  PresetParticipant,
  createParticipantPreset,
  getUserParticipantPresets,
  getParticipantPresetById,
  savePresetParticipants,
  updatePresetLastUsed,
  deleteParticipantPreset,
  importParticipantsFromCSV,
  // Supabase preset functions
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
  duplicateOfficialPresetSupabase,
  getCachedParticipantPresets
} from '../../../database-service';

/**
 * Setup local preset IPC handlers
 */
export function setupLocalPresetHandlers(): void {
  console.log('[Main Process] Setting up local preset IPC handlers...');

  ipcMain.handle('db-create-participant-preset', async (_, presetData: Omit<ParticipantPreset, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const preset = await createParticipantPreset(presetData);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-participant-presets', async () => {
    try {
      const presets = await getUserParticipantPresets();
      return { success: true, data: presets };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-participant-preset-by-id', async (_, presetId: string) => {
    try {
      const preset = await getParticipantPresetById(presetId);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-save-preset-participants', async (_, { presetId, participants }: { presetId: string, participants: Omit<PresetParticipant, 'id' | 'created_at'>[] }) => {
    try {
      await savePresetParticipants(presetId, participants);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-update-preset-last-used', async (_, presetId: string) => {
    try {
      await updatePresetLastUsed(presetId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-delete-participant-preset', async (_, presetId: string) => {
    try {
      await deleteParticipantPreset(presetId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-import-participants-from-csv', async (_, { csvData, presetName, category }: { csvData: any[], presetName: string, category?: string }) => {
    try {
      const preset = await importParticipantsFromCSV(csvData, presetName, category);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}

/**
 * Setup Supabase preset IPC handlers
 */
export function setupSupabasePresetHandlers(): void {
  console.log('[Main Process] Setting up Supabase preset IPC handlers...');

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

  // Admin-only: Get all participant presets
  ipcMain.handle('supabase-get-all-participant-presets-admin', async () => {
    try {
      if (!authService.isAdmin()) {
        return { success: false, error: 'Unauthorized: Admin access required' };
      }

      console.log('[IPC] Admin requesting all participant presets');
      const presets = await getUserParticipantPresetsSupabase(true);
      return { success: true, data: presets };
    } catch (e: any) {
      console.error('[IPC] Error getting all presets for admin:', e);
      return { success: false, error: e.message };
    }
  });

  // Duplicate official preset for user
  ipcMain.handle('supabase-duplicate-official-preset', async (_, presetId: string) => {
    try {
      console.log('[IPC] Duplicating official preset:', presetId);
      const newPreset = await duplicateOfficialPresetSupabase(presetId);
      return { success: true, data: newPreset };
    } catch (e: any) {
      console.error('[IPC] Error duplicating official preset:', e);
      return { success: false, error: e.message };
    }
  });
}

/**
 * Setup all preset handlers (local + Supabase)
 */
export function setupPresetHandlers(): void {
  setupLocalPresetHandlers();
  setupSupabasePresetHandlers();
}
