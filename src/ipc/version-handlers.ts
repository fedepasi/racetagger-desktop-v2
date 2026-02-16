/**
 * Version IPC Handlers
 *
 * Handles app version checking, force update functionality,
 * and in-app installer download + launch.
 */

import { ipcMain, app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  getSupabase,
  getMainWindow,
  getVersionCheckResult,
  setVersionCheckResult,
  isForceUpdateRequired,
  setForceUpdateRequired
} from './context';
import { authService } from '../auth-service';
import { VersionCheckResult } from './types';

// ==================== Version Check Function ====================

/**
 * Check app version against server requirements
 */
async function checkAppVersion(): Promise<VersionCheckResult | null> {
  try {
    const currentVersion = app.getVersion();
    // Send process.platform directly (darwin/win32/linux) to match app_version_config table
    const platform = process.platform;

    console.log(`[Version] Checking version: ${currentVersion} on ${platform}`);

    // Get user ID from auth service if available
    const authState = authService.getAuthState();
    const userId = authState.user?.id;

    const supabase = getSupabase();

    const { data, error } = await supabase.functions.invoke('check-app-version', {
      body: {
        app_version: currentVersion,
        platform: platform,
        user_id: userId
      }
    });

    if (error) {
      console.error('[Version] Check error:', error);
      return {
        requires_update: false,
        force_update_enabled: false,
        error: error.message
      };
    }

    const result: VersionCheckResult = data;
    console.log('[Version] Check result:', result);

    // Store force update status globally
    const forceRequired = result.force_update_enabled && result.requires_update;
    setForceUpdateRequired(forceRequired);
    setVersionCheckResult(result);

    return result;
  } catch (error) {
    console.error('[Version] Check exception:', error);
    return {
      requires_update: false,
      force_update_enabled: false,
      error: String(error)
    };
  }
}

// ==================== Download Update Function ====================

/**
 * Download installer from URL to temp directory with progress tracking.
 * Sends 'update-download-progress' events to the renderer.
 * Returns the local file path of the downloaded installer.
 */
async function downloadUpdate(downloadUrl: string): Promise<string> {
  const mainWindow = getMainWindow();

  console.log(`[Version] Starting download from: ${downloadUrl}`);

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  // Get total size from Content-Length header
  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  const totalMB = totalBytes / (1024 * 1024);

  // Determine filename from URL
  const urlPath = new URL(downloadUrl).pathname;
  const fileName = path.basename(urlPath);
  const tempDir = app.getPath('temp');
  const filePath = path.join(tempDir, fileName);

  console.log(`[Version] Downloading to: ${filePath} (${totalMB.toFixed(1)} MB)`);

  // Stream download with progress
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  let lastProgressTime = Date.now();
  let lastDownloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    downloadedBytes += value.length;

    // Send progress every 200ms to avoid flooding the renderer
    const now = Date.now();
    if (now - lastProgressTime >= 200 || downloadedBytes === totalBytes) {
      const elapsedSec = (now - lastProgressTime) / 1000;
      const bytesInInterval = downloadedBytes - lastDownloadedBytes;
      const speedMBs = elapsedSec > 0 ? (bytesInInterval / (1024 * 1024)) / elapsedSec : 0;

      const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
      const downloadedMB = downloadedBytes / (1024 * 1024);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', {
          percent,
          downloadedMB: Math.round(downloadedMB * 10) / 10,
          totalMB: Math.round(totalMB * 10) / 10,
          speedMBs: Math.round(speedMBs * 10) / 10
        });
      }

      lastProgressTime = now;
      lastDownloadedBytes = downloadedBytes;
    }
  }

  // Write file to disk
  const fileBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  fs.writeFileSync(filePath, fileBuffer);

  console.log(`[Version] Download complete: ${filePath} (${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB)`);

  return filePath;
}

// ==================== Register Handlers ====================

export function registerVersionHandlers(): void {
  console.log('[IPC] Registering version handlers...');

  // Check app version
  ipcMain.handle('check-app-version', async () => {
    try {
      return await checkAppVersion();
    } catch (error) {
      console.error('[Version] Error in check-app-version handler:', error);
      return {
        requires_update: false,
        force_update_enabled: false,
        error: String(error)
      };
    }
  });

  // Get cached version check result
  ipcMain.handle('get-version-check-result', () => {
    return getVersionCheckResult();
  });

  // Check if force update is required
  ipcMain.handle('is-force-update-required', () => {
    return isForceUpdateRequired();
  });

  // Quit app for update
  ipcMain.handle('quit-app-for-update', () => {
    // Allow app to quit even when force update is required
    setForceUpdateRequired(false);
    app.quit();
  });

  // Download update installer to temp directory
  ipcMain.handle('download-update', async (_, downloadUrl: string) => {
    try {
      if (!downloadUrl) {
        throw new Error('No download URL provided');
      }
      const filePath = await downloadUpdate(downloadUrl);
      return { success: true, filePath };
    } catch (error) {
      console.error('[Version] Download error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Launch downloaded installer and quit app
  ipcMain.handle('launch-installer', async (_, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('Installer file not found');
      }

      console.log(`[Version] Launching installer: ${filePath}`);

      // Open the installer with the system default handler
      const errorMessage = await shell.openPath(filePath);
      if (errorMessage) {
        throw new Error(`Failed to open installer: ${errorMessage}`);
      }

      // Give the OS a moment to start the installer, then quit
      setTimeout(() => {
        setForceUpdateRequired(false);
        app.quit();
      }, 1500);

      return { success: true };
    } catch (error) {
      console.error('[Version] Launch installer error:', error);
      return { success: false, error: String(error) };
    }
  });

  console.log('[IPC] Version handlers registered (6 handlers)');
}

// Export for use during app startup
export { checkAppVersion };
