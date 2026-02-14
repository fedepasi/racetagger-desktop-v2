/**
 * Authentication IPC Handlers
 *
 * Handles login, logout, registration, token management, and subscription.
 */

import { app, ipcMain, IpcMainEvent, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import { authService } from '../auth-service';
import {
  cacheSupabaseData,
  saveCsvToSupabase,
  getSportCategories
} from '../database-service';
import {
  getMainWindow,
  getGlobalCsvData,
  setGlobalCsvData,
  safeSend
} from './context';
import { CsvEntry } from './types';

// Local CSV data reference (updated on load/restore)
let csvData: CsvEntry[] = [];

// Sync user data after authentication
async function syncUserData(): Promise<void> {
  const authState = authService.getAuthState();
  if (authState.isAuthenticated && authState.user?.id) {
    try {
      await cacheSupabaseData();
    } catch (error) {
      console.error('[Auth] Error syncing user data:', error);
    }
  }
}

export function registerAuthHandlers(): void {

  // ==================== App State ====================

  ipcMain.handle('get-is-packaged', () => {
    return app.isPackaged;
  });

  ipcMain.handle('auth-is-admin', () => {
    return authService.isAdmin();
  });

  // Get current session (for face photos and other features that need user ID)
  ipcMain.handle('auth-get-session', () => {
    const authState = authService.getAuthState();
    if (authState.isAuthenticated && authState.user) {
      return { success: true, session: { user: authState.user } };
    }
    return { success: false, error: 'Not authenticated' };
  });

  // ==================== Auth Status ====================

  ipcMain.on('check-auth-status', async (event: IpcMainEvent) => {
    const authState = authService.getAuthState();
    event.sender.send('auth-status', authState);
    await syncUserData();
  });

  // ==================== Login ====================

  ipcMain.on('login', async (event: IpcMainEvent, credentials: { email: string; password: string }) => {
    try {
      const result = await authService.login(credentials.email, credentials.password);

      // Wait for data sync BEFORE sending login-result
      if (result.success) {
        await syncUserData();
      }

      event.sender.send('login-result', result);
    } catch (error: any) {
      event.sender.send('login-result', { success: false, error: error.message || 'Login error' });
    }
  });

  // ==================== Register ====================

  ipcMain.on('register', async (event: IpcMainEvent, data: { email: string; password: string; referralCode?: string | null }) => {
    try {
      const result = await authService.register(data.email, data.password, undefined, data.referralCode || undefined);
      event.sender.send('register-result', result);
    } catch (error: any) {
      event.sender.send('register-result', { success: false, error: error.message || 'Registration error' });
    }
  });

  // ==================== Logout ====================

  ipcMain.on('logout', async (event: IpcMainEvent) => {
    let userId: string | null = null;
    const mainWindow = getMainWindow();

    try {
      userId = authService.getCurrentUserId();
      if (!userId) {
        const result = await authService.logout();
        event.sender.send('logout-result', result);
        return;
      }

      // Save current CSV to Supabase
      const currentCsvData = getGlobalCsvData();
      if (currentCsvData && currentCsvData.length > 0) {
        try {
          await saveCsvToSupabase(currentCsvData, `logout_backup_${Date.now()}.csv`);
        } catch (csvError) {
          console.error('[Auth] Error saving CSV:', csvError);
        }
      }

      // Execute logout
      const result = await authService.logout();

      // Clear global variables
      csvData = [];
      setGlobalCsvData([]);

      // Cleanup temp files
      try {
        const thumbnailDir = path.join(os.tmpdir(), 'racetagger-thumbnails');
        try {
          await fsPromises.access(thumbnailDir, fs.constants.F_OK);
          const files = await fsPromises.readdir(thumbnailDir);
          await Promise.all(
            files.map(file => fsPromises.unlink(path.join(thumbnailDir, file)).catch(() => {}))
          );
        } catch {
          // Directory doesn't exist
        }
      } catch (tempError) {
        console.error('[Auth] Error cleaning temp files:', tempError);
      }

      event.sender.send('logout-result', result);

    } catch (error: any) {
      console.error('[Auth] Logout error:', error);
      event.sender.send('logout-result', { success: false, error: error.message || 'Logout error' });
    }
  });

  // ==================== Demo Mode ====================

  ipcMain.on('continue-demo', (event: IpcMainEvent) => {
    authService.enableDemoMode();
    event.sender.send('auth-status', { isAuthenticated: false, user: null, session: null });
  });

  // ==================== CSV Restore ====================

  ipcMain.on('restore-csv-data', (event: IpcMainEvent, data: any) => {
    try {
      csvData = data.csvData;
      setGlobalCsvData(data.csvData);

      safeSend('csv-loaded', {
        filename: data.filename || 'restored_from_supabase.csv',
        entries: data.csvData.length,
        message: `CSV ripristinato (${data.csvData.length} entries)`
      });
    } catch (error) {
      console.error('[Auth] Error restoring CSV:', error);
    }
  });

  // ==================== Token Management ====================
  // NOTE: 'get-token-balance' is registered as ipcMain.handle() in main.ts (for invoke pattern)
  // Do NOT add ipcMain.on() here as it would create a redundant dual registration

  ipcMain.on('force-token-refresh', async (event: IpcMainEvent) => {
    try {
      const tokenInfo = await authService.forceTokenInfoRefresh();

      event.sender.send('token-balance', tokenInfo.balance);
      event.sender.send('pending-tokens', tokenInfo.pending);

      await getSportCategories();
      event.sender.send('categories-updated');
    } catch (error: any) {
      console.error('[Auth] Token refresh failed:', error);
      event.sender.send('auth-error', { message: 'Failed to refresh tokens' });
    }
  });

  // ==================== Subscription ====================

  ipcMain.on('get-subscription-info', async (event: IpcMainEvent) => {
    try {
      const subscriptionInfo = await authService.getSubscriptionInfo();
      event.sender.send('subscription-info', subscriptionInfo);
    } catch (error: any) {
      event.sender.send('auth-error', { message: 'Failed to fetch subscription info' });
    }
  });

  ipcMain.on('open-subscription-page', () => {
    authService.openSubscriptionPage();
  });

  // ==================== External URLs ====================

  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Error opening URL:', error);
      return { success: false, error: error.message };
    }
  });

  // ==================== Auth Refresh ====================

  ipcMain.on('auth-refresh-completed-from-renderer', async () => {
    await syncUserData();
  });

  // ==================== User Info ====================

  ipcMain.handle('get-user-info', async () => {
    try {
      const authState = authService.getAuthState();
      if (authState.user) {
        return {
          success: true,
          name: authState.user.user_metadata?.name || authState.user.email?.split('@')[0] || 'Photographer'
        };
      }
      return { success: false, name: 'Photographer' };
    } catch (error) {
      console.error('[Auth] Error getting user info:', error);
      return { success: false, name: 'Photographer' };
    }
  });
}

// Export for use in other modules
export function getLocalCsvData(): CsvEntry[] {
  return csvData;
}

export function setLocalCsvData(data: CsvEntry[]): void {
  csvData = data;
  setGlobalCsvData(data);
}
