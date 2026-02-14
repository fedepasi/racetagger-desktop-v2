/**
 * Database IPC Handlers
 *
 * Handles database operations for executions and presets.
 */

import { ipcMain } from 'electron';
import { authService } from '../auth-service';
import {
  // Execution operations
  createExecutionOnline,
  getExecutionByIdOnline,
  updateExecutionOnline,
  deleteExecutionOnline,
  Execution,
  // Execution settings
  ExecutionSettings,
  saveExecutionSettings,
  getExecutionSettings,
  getUserSettingsAnalytics,
  // Preset operations
  ParticipantPresetSupabase,
  PresetParticipantSupabase,
  createParticipantPresetSupabase,
  getUserParticipantPresetsSupabase,
  getParticipantPresetByIdSupabase,
  savePresetParticipantsSupabase,
  updatePresetLastUsedSupabase,
  deleteParticipantPresetSupabase,
  importParticipantsFromCSVSupabase
} from '../database-service';
import { createHandler } from './handler-factory';
import { DEBUG_MODE } from '../config';

export function registerDatabaseHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering database handlers...');

  // ==================== EXECUTION HANDLERS ====================

  ipcMain.handle('db-create-execution', async (_, executionData: Omit<Execution, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      const newExecution = await createExecutionOnline(executionData);
      return { success: true, data: newExecution };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-execution-by-id', async (_, id: string) => {
    try {
      // Handle mock execution IDs for testing
      if (id.startsWith('mock-exec-')) {
        const mockExecution = {
          id,
          project_name: 'Mock Execution Test',
          status: 'completed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          total_images_processed: 25,
          total_images_found: 30,
          folder_name: 'Mock Test Folder'
        };
        return { success: true, data: mockExecution };
      }

      const execution = await getExecutionByIdOnline(id);
      return { success: true, data: execution };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-update-execution', async (_, { id, executionData }: { id: string, executionData: Partial<Omit<Execution, 'id' | 'user_id' | 'project_id' | 'created_at' | 'updated_at'>> }) => {
    try {
      const updatedExecution = await updateExecutionOnline(id, executionData);
      return { success: true, data: updatedExecution };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-delete-execution', async (_, id: string) => {
    try {
      await deleteExecutionOnline(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== EXECUTION SETTINGS HANDLERS ====================

  ipcMain.handle('db-save-execution-settings', async (_, settings: Omit<ExecutionSettings, 'id' | 'user_id' | 'created_at'>) => {
    try {
      const savedSettings = await saveExecutionSettings(settings);
      return { success: true, data: savedSettings };
    } catch (e: any) {
      console.warn('[DB] Failed to save execution settings:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-execution-settings', async (_, executionId: string) => {
    try {
      const settings = await getExecutionSettings(executionId);
      return { success: true, data: settings };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-user-settings-analytics', async (_, userId?: string) => {
    try {
      const analytics = await getUserSettingsAnalytics(userId);
      return { success: true, data: analytics };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== PRESET HANDLERS ====================

  ipcMain.handle('db-create-participant-preset', async (_, presetData: Omit<ParticipantPresetSupabase, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const preset = await createParticipantPresetSupabase(presetData);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-participant-presets', async () => {
    try {
      const presets = await getUserParticipantPresetsSupabase();
      return { success: true, data: presets };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-participant-preset-by-id', async (_, presetId: string) => {
    try {
      const preset = await getParticipantPresetByIdSupabase(presetId);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-save-preset-participants', async (_, { presetId, participants }: { presetId: string, participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[] }) => {
    try {
      await savePresetParticipantsSupabase(presetId, participants);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-update-preset-last-used', async (_, presetId: string) => {
    try {
      await updatePresetLastUsedSupabase(presetId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-delete-participant-preset', async (_, presetId: string) => {
    try {
      await deleteParticipantPresetSupabase(presetId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-import-participants-from-csv', async (_, { csvData, presetName }: { csvData: any[], presetName: string }) => {
    try {
      const preset = await importParticipantsFromCSVSupabase(csvData, presetName);
      return { success: true, data: preset };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  console.log('[IPC] Database handlers registered (15 handlers)');
}
