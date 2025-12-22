/**
 * Version IPC Handlers
 *
 * Handles app version checking and force update functionality.
 */

import { ipcMain, app } from 'electron';
import {
  getSupabase,
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
    const platform = process.platform === 'darwin' ? 'macos' :
                    process.platform === 'win32' ? 'windows' : 'linux';

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

  console.log('[IPC] Version handlers registered (4 handlers)');
}

// Export for use during app startup
export { checkAppVersion };
