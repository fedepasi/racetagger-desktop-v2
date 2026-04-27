/**
 * Window Control IPC Handlers
 *
 * Handles window minimize, maximize, and close operations.
 */

import { ipcMain } from 'electron';
import { getMainWindow } from './context';

export function registerWindowHandlers(): void {
  console.log('[IPC] Registering window handlers...');

  ipcMain.on('window-close', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.close();
    }
  });

  ipcMain.on('window-minimize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  ipcMain.on('window-maximize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.restore();
      } else {
        mainWindow.maximize();
      }
    }
  });

  console.log('[IPC] Window handlers registered (3 handlers)');
}
