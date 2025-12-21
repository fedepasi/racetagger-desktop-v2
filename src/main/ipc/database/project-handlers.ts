/**
 * Project IPC Handlers
 * Handles all project-related database operations
 */

import { ipcMain } from 'electron';
import {
  createProjectOnline,
  getProjectsOnline,
  getProjectByIdOnline,
  updateProjectOnline,
  deleteProjectOnline,
  uploadCsvToStorage,
  getRecentProjectsFromCache,
  Project
} from '../../../database-service';
import { authService } from '../../../auth-service';

/**
 * Setup project-related IPC handlers
 */
export function setupProjectHandlers(): void {
  console.log('[Main Process] Setting up project IPC handlers...');

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
    console.log(`[IPC Handler] 'db-get-all-projects' invoked.`);
    try {
      const projects = await getProjectsOnline();
      console.log(`[IPC Handler 'db-get-all-projects'] getProjectsOnline returned:`, projects ? projects.length + " projects" : "null/undefined/empty");
      return { success: true, data: projects };
    } catch (e: any) {
      console.error(`[IPC Handler 'db-get-all-projects'] Error caught:`, JSON.stringify(e, Object.getOwnPropertyNames(e)));
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
}
