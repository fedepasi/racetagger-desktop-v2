/**
 * Execution IPC Handlers
 * Handles all execution-related database operations
 */

import { ipcMain } from 'electron';
import {
  createExecutionOnline,
  getExecutionsByProjectIdOnline,
  getExecutionByIdOnline,
  updateExecutionOnline,
  deleteExecutionOnline,
  ExecutionSettings,
  saveExecutionSettings,
  getExecutionSettings,
  getUserSettingsAnalytics,
  Execution
} from '../../../database-service';

/**
 * Setup execution-related IPC handlers
 */
export function setupExecutionHandlers(): void {
  console.log('[Main Process] Setting up execution IPC handlers...');

  ipcMain.handle('db-create-execution', async (_, executionData: Omit<Execution, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      const newExecution = await createExecutionOnline(executionData);
      return { success: true, data: newExecution };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Execution Settings Tracking Handlers
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
}
