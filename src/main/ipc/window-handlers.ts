/**
 * Window Control IPC Handlers
 * Handles window control operations (minimize, maximize, close)
 */

import { BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { authService } from '../../auth-service';
import { faceDetectionBridge } from '../../face-detection-bridge';
import { isForceUpdateRequired } from '../services/version-checker';

// Dependencies interface
export interface WindowHandlersDependencies {
  getMainWindow: () => BrowserWindow | null;
  setMainWindow: (window: BrowserWindow | null) => void;
  isDev: boolean;
  remoteEnable: ((webContents: Electron.WebContents) => void) | null;
}

let deps: WindowHandlersDependencies;

/**
 * Setup window control IPC handlers
 */
export function setupWindowControlHandlers(dependencies: WindowHandlersDependencies): void {
  deps = dependencies;

  console.log('[Main Process] main.ts: setupWindowControlHandlers() called.');

  ipcMain.on('window-close', () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on('window-minimize', () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.restore();
      } else {
        mainWindow.maximize();
      }
    }
  });
}

/**
 * Create the main application window
 */
export function createWindow(): BrowserWindow {
  console.log('[Main Process] Creating main window...');

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, '../../racetagger-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: !deps.isDev
    }
  });

  // Set main window reference
  deps.setMainWindow(mainWindow);

  // Set main window reference for auth service
  authService.setMainWindow(mainWindow);

  // Set main window reference for face detection bridge
  faceDetectionBridge.setMainWindow(mainWindow);

  // Enable @electron/remote for this window
  if (deps.remoteEnable) {
    deps.remoteEnable(mainWindow.webContents);
  } else {
    console.error('[Main Process] @electron/remote enable function not available');
  }

  // Add error handling for window loading
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[Main Process] Window failed to load:', errorDescription, 'URL:', validatedURL);
  });

  mainWindow.on('crashed' as any, (event: any, killed: boolean) => {
    console.error('[Main Process] Window crashed. Killed:', killed);
  });

  // Check if force update is required and load appropriate HTML
  if (isForceUpdateRequired()) {
    const forceUpdatePath = path.join(__dirname, '../../../renderer/force-update.html');
    console.log('[Main Process] Force update required, loading HTML from:', forceUpdatePath);
    mainWindow.loadFile(forceUpdatePath);
  } else {
    const htmlPath = path.join(__dirname, '../../../renderer/index.html');
    console.log('[Main Process] Loading normal application HTML from:', htmlPath);
    mainWindow.loadFile(htmlPath);
  }

  // Handle navigation between pages
  mainWindow.webContents.on('will-navigate', (event, url) => {
    console.log(`[Main Process] Navigation requested to: ${url}`);
  });

  // Handle links opened via target="_blank" or window.open
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[Main Process] Opening external URL: ${url}`);
    if (url.startsWith('file://') || url.includes('localhost')) {
      return { action: 'allow' };
    } else {
      shell.openExternal(url);
      return { action: 'deny' };
    }
  });

  return mainWindow;
}
