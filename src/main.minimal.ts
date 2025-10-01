console.log('[Main Process] main.ts.minimal: Script start');
import { app, BrowserWindow } from 'electron';
console.log('[Main Process] main.ts.minimal: Imported electron');
import * as path from 'path';
console.log('[Main Process] main.ts.minimal: Imported path');

console.log('[Main Process] main.ts.minimal: Setting up app.whenReady()...');
app.whenReady().then(() => {
  console.log('[Main Process] main.ts.minimal: app.whenReady() has resolved.');
  
  // Create a minimal window
  const mainWindow = new BrowserWindow({
    width: 800, height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  // Load a simple HTML file or the main renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // Open DevTools
  mainWindow.webContents.openDevTools();
  
  console.log('[Main Process] main.ts.minimal: Window created and loaded.');
});

app.on('window-all-closed', () => {
  console.log('[Main Process] main.ts.minimal: All windows closed.');
  app.quit();
});

console.log('[Main Process] main.ts.minimal: Script end.');
