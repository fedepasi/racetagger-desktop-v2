/**
 * Database IPC Handlers
 *
 * Handles local SQLite database operations for projects, executions, and presets.
 */

import { ipcMain } from 'electron';
import { authService } from '../auth-service';
import {
  // Project operations
  createProjectOnline,
  getProjectsOnline,
  getProjectByIdOnline,
  updateProjectOnline,
  deleteProjectOnline,
  getRecentProjectsFromCache,
  uploadCsvToStorage,
  Project,
  // Execution operations
  createExecutionOnline,
  getExecutionsByProjectIdOnline,
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
  ParticipantPreset,
  PresetParticipant,
  createParticipantPreset,
  getUserParticipantPresets,
  getParticipantPresetById,
  savePresetParticipants,
  updatePresetLastUsed,
  deleteParticipantPreset,
  importParticipantsFromCSV
} from '../database-service';
import { createHandler } from './handler-factory';

export function registerDatabaseHandlers(): void {
  console.log('[IPC] Registering database handlers...');

  // ==================== PROJECT HANDLERS ====================

  ipcMain.handle('db-create-project', async (_, projectData: Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      const newProject = await createProjectOnline(projectData);
      return { success: true, data: newProject };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-upload-project-csv', async (_, { projectId, csvFileBuffer, csvFileName }: { projectId: string, csvFileBuffer: Uint8Array, csvFileName: string }) => {
    try {
      const buffer = Buffer.from(csvFileBuffer);
      const storagePath = await uploadCsvToStorage(projectId, buffer, csvFileName);
      const updatedProject = await updateProjectOnline(projectId, { base_csv_storage_path: storagePath });
      return { success: true, data: updatedProject };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-project-by-id', async (_, id: string) => {
    try {
      const project = await getProjectByIdOnline(id);
      return { success: true, data: project };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-all-projects', async () => {
    try {
      const projects = await getProjectsOnline();
      console.log(`[DB] Fetched ${projects?.length || 0} projects`);
      return { success: true, data: projects };
    } catch (e: any) {
      console.error('[DB] Error fetching projects:', e.message);
      return { success: false, error: e.message || 'Unknown error fetching projects.' };
    }
  });

  ipcMain.handle('db-update-project', async (_, { id, projectData }: { id: string, projectData: Partial<Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>> }) => {
    try {
      const updatedProject = await updateProjectOnline(id, projectData);
      return { success: true, data: updatedProject };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-delete-project', async (_, id: string) => {
    try {
      await deleteProjectOnline(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-recent-projects', async (_, limit?: number) => {
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) return { success: true, data: [] };
      const projects = getRecentProjectsFromCache(userId, limit);
      return { success: true, data: projects };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==================== EXECUTION HANDLERS ====================

  ipcMain.handle('db-create-execution', async (_, executionData: Omit<Execution, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      const newExecution = await createExecutionOnline(executionData);
      return { success: true, data: newExecution };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db-get-executions-by-project-id', async (_, projectId: string) => {
    try {
      const executions = await getExecutionsByProjectIdOnline(projectId);
      return { success: true, data: executions };
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

  console.log('[IPC] Database handlers registered (22 handlers)');
}
