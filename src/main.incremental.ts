console.log('[Main Process] main.incremental: Script start');
import { app, BrowserWindow, ipcMain, IpcMainEvent, dialog, shell } from 'electron';
console.log('[Main Process] main.incremental: Imported electron');
import * as path from 'path';
console.log('[Main Process] main.incremental: Imported path');
import * as fs from 'fs';
console.log('[Main Process] main.incremental: Imported fs');
import * as fsPromises from 'fs/promises';
console.log('[Main Process] main.incremental: Imported fs/promises');
import * as isDev from 'electron-is-dev';
console.log('[Main Process] main.incremental: Imported electron-is-dev');
import { initialize, enable } from '@electron/remote/main';
console.log('[Main Process] main.incremental: Imported @electron/remote/main');
import { createClient } from '@supabase/supabase-js';
console.log('[Main Process] main.incremental: Imported @supabase/supabase-js');
import { SUPABASE_CONFIG, APP_CONFIG } from './config';
console.log('[Main Process] main.incremental: Imported ./config');
import { authService } from './auth-service';
console.log('[Main Process] main.incremental: Imported ./auth-service');
import { Readable } from 'stream';
console.log('[Main Process] main.incremental: Imported stream');
import * as ExifReader from 'exifreader';
console.log('[Main Process] main.incremental: Imported exifreader');
import * as piexif from 'piexifjs';
console.log('[Main Process] main.incremental: Imported piexifjs');
// Deliberatamente non importiamo sharp o database-service

console.log('[Main Process] main.incremental: All imports successful. Initializing @electron/remote...');
initialize();
console.log('[Main Process] main.incremental: @electron/remote initialized.');
process.env.NODE_ENV = isDev ? 'development' : 'production';
console.log(`[Main Process] main.incremental: NODE_ENV set to ${process.env.NODE_ENV}`);

let mainWindow: BrowserWindow | null = null;
console.log('[Main Process] main.incremental: mainWindow initialized');

console.log('[Main Process] main.incremental: Creating Supabase client...');
const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
console.log('[Main Process] main.incremental: Supabase client created.');

function setupAuthHandlers() {
  console.log('[Main Process] main.incremental: setupAuthHandlers() called.');
  
  ipcMain.on('check-auth-status', async (event: IpcMainEvent) => {
    const authState = authService.getAuthState();
    event.sender.send('auth-status', authState);
  });

  // Altre gestioni auth...
}

function setupWindowControlHandlers() {
  console.log('[Main Process] main.incremental: setupWindowControlHandlers() called.');
  ipcMain.on('window-close', () => { if (mainWindow) mainWindow.close(); });
  ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.restore();
      else mainWindow.maximize();
    }
  });
}

function createWindow() {
  console.log('[Main Process] main.incremental: createWindow() called.');
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, webSecurity: !isDev
    }
  });
  enable(mainWindow.webContents);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (isDev) mainWindow.webContents.openDevTools();
}

console.log('[Main Process] main.incremental: Setting up app.whenReady()...');
app.whenReady().then(() => {
  console.log('[Main Process] main.incremental: app.whenReady() has resolved.');
  createWindow();
  setupAuthHandlers();
  setupWindowControlHandlers();
  
  console.log('[Main Process] main.incremental: Setting up remaining IPC .on listeners...');
  
  app.on('activate', () => {
    console.log('[Main Process] main.incremental: app event: activate');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  console.log('[Main Process] main.incremental: app.activate listener set up.');
});
console.log('[Main Process] main.incremental: app.whenReady() setup complete.');

app.on('window-all-closed', () => {
  console.log('[Main Process] main.incremental: app event: window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
console.log('[Main Process] main.incremental: app.window-all-closed listener set up.');

process.on('uncaughtException', (error: Error) => {
  console.error('[Main Process] main.incremental: FATAL: Uncaught exception:', error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('Application Error', `A critical unexpected error occurred: ${error.message}\n\nPlease report this error.\n\n${error.stack || ''}`);
  } else {
    // Fallback if mainWindow is not available or already destroyed
    dialog.showErrorBox('Critical Application Error', `A critical unexpected error occurred before the UI could be fully initialized: ${error.message}\n\nPlease report this error.\n\n${error.stack || ''}`);
  }
});
console.log('[Main Process] main.incremental: Uncaught exception handler set up.');
console.log('[Main Process] main.incremental: Script end.');
