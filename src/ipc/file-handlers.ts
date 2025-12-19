/**
 * File System IPC Handlers
 *
 * Handles file dialogs, folder selection, file operations, and folder listing.
 */

import { ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { getMainWindow } from './context';

// Supported RAW extensions
const RAW_EXTENSIONS = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];

export function registerFileHandlers(): void {
  console.log('[IPC] Registering file handlers...');

  // ==================== DIALOGS ====================

  ipcMain.handle('dialog-show-open', async (_, options) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('Main window not available');
    }
    try {
      return await dialog.showOpenDialog(mainWindow, options);
    } catch (error) {
      console.error('[IPC] Error in dialog-show-open:', error);
      throw error;
    }
  });

  ipcMain.handle('show-save-dialog', async (_, options) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('Main window not available');
    }
    try {
      return await dialog.showSaveDialog(mainWindow, options);
    } catch (error) {
      console.error('[IPC] Error in show-save-dialog:', error);
      throw error;
    }
  });

  ipcMain.handle('select-organization-destination', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Folder for Organized Photos',
      buttonLabel: 'Select Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // ==================== FILE OPERATIONS ====================

  ipcMain.handle('write-file', async (_, { path: filePath, content }) => {
    try {
      await fsPromises.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (error) {
      console.error('[IPC] Error writing file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('get-file-stats', async (_, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('File does not exist');
      }
      const stats = await fsPromises.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
        ctime: stats.ctime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      };
    } catch (error) {
      console.error('[IPC] Error getting file stats:', error);
      throw error;
    }
  });

  // ==================== FOLDER OPERATIONS ====================

  ipcMain.handle('get-folder-files', async (_, { folderPath, extensions = [] }) => {
    try {
      if (!fs.existsSync(folderPath)) {
        throw new Error('Folder does not exist');
      }

      const files = await fsPromises.readdir(folderPath);
      const imageFiles = [];

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stats = await fsPromises.stat(filePath);

        if (stats.isFile()) {
          const ext = path.extname(file).toLowerCase().slice(1);
          if (extensions.length === 0 || extensions.includes(ext)) {
            imageFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              extension: ext,
              isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(ext)
            });
          }
        }
      }

      return imageFiles;
    } catch (error) {
      console.error('[IPC] Error getting folder files:', error);
      throw error;
    }
  });

  ipcMain.handle('list-files-in-folder', async (_, { path: folderPath }) => {
    try {
      if (!fs.existsSync(folderPath)) {
        throw new Error('Folder does not exist');
      }

      const files = await fsPromises.readdir(folderPath);
      return files.map(file => ({
        name: file,
        path: path.join(folderPath, file)
      }));
    } catch (error) {
      console.error('[IPC] Error listing files in folder:', error);
      throw error;
    }
  });

  ipcMain.handle('count-folder-images', async (_, { path: folderPath }) => {
    try {
      if (!fs.existsSync(folderPath)) {
        return { count: 0, error: 'Folder does not exist' };
      }

      const files = await fsPromises.readdir(folderPath);
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', ...RAW_EXTENSIONS];

      let count = 0;
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (imageExtensions.includes(ext)) {
          count++;
        }
      }

      return { count };
    } catch (error) {
      console.error('[IPC] Error counting folder images:', error);
      return { count: 0, error: String(error) };
    }
  });

  console.log('[IPC] File handlers registered (8 handlers)');
}
