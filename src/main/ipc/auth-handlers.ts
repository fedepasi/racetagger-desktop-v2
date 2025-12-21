/**
 * Authentication IPC Handlers
 * Handles all authentication-related IPC events
 */

import { app, ipcMain, IpcMainEvent, shell, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import { authService } from '../../auth-service';
import {
  getProjectsOnline,
  cacheSupabaseData,
  getUserDataStats,
  saveCsvToSupabase,
  syncAllUserDataToSupabase,
  clearAllUserData,
  getSportCategories
} from '../../database-service';

// Type for CSV entry
export type CsvEntry = {
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  metatag: string;
  [key: string]: string | undefined;
};

// Dependencies interface for injection
export interface AuthHandlersDependencies {
  getMainWindow: () => BrowserWindow | null;
  getCsvData: () => CsvEntry[];
  setCsvData: (data: CsvEntry[]) => void;
  getGlobalCsvData: () => CsvEntry[];
  setGlobalCsvData: (data: CsvEntry[]) => void;
}

let deps: AuthHandlersDependencies;

/**
 * Initialize auth handlers with dependencies
 */
export function setupAuthHandlers(dependencies: AuthHandlersDependencies): void {
  deps = dependencies;

  console.log('[Main Process] main.ts: setupAuthHandlers() called.');

  const syncUserProjects = async () => {
    const authState = authService.getAuthState();
    if (authState.isAuthenticated && authState.user?.id) {
      try {
        console.log('User authenticated, fetching/caching projects from Supabase...');
        await getProjectsOnline();
        console.log('Projects fetched and cached.');

        console.log('Reloading categories and analytics data after authentication...');
        await cacheSupabaseData();
        console.log('Categories and analytics data reloaded.');
      } catch (error) {
        console.error('Error fetching projects on auth state change:', error);
      }
    }
  };

  // Handler for getting production state (app.isPackaged)
  ipcMain.handle('get-is-packaged', () => {
    return app.isPackaged;
  });

  // Handler to check if current user is admin
  ipcMain.handle('auth-is-admin', () => {
    const isAdmin = authService.isAdmin();
    console.log('[IPC] auth-is-admin check:', isAdmin);
    return isAdmin;
  });

  ipcMain.on('check-auth-status', async (event: IpcMainEvent) => {
    const authState = authService.getAuthState();
    console.log(`[Main Process] Sending auth-status to renderer:`, {
      isAuthenticated: authState.isAuthenticated,
      userEmail: authState.user?.email,
      userRole: authState.userRole
    });
    event.sender.send('auth-status', authState);
    await syncUserProjects();
  });

  ipcMain.on('login', async (event: IpcMainEvent, credentials: { email: string; password: string }) => {
    try {
      const result = await authService.login(credentials.email, credentials.password);

      if (result.success) {
        console.log('[Login] Syncing user projects before completing login...');
        await syncUserProjects();
        console.log('[Login] User projects synced successfully');
      }

      event.sender.send('login-result', result);
    } catch (error: any) {
      event.sender.send('login-result', { success: false, error: error.message || 'Login error' });
    }
  });

  ipcMain.on('register', async (event: IpcMainEvent, data: { email: string; password: string }) => {
    try {
      const result = await authService.register(data.email, data.password);
      event.sender.send('register-result', result);
    } catch (error: any) {
      event.sender.send('register-result', { success: false, error: error.message || 'Registration error' });
    }
  });

  ipcMain.on('logout', async (event: IpcMainEvent) => {
    let userId: string | null = null;
    const mainWindow = deps.getMainWindow();

    try {
      userId = authService.getCurrentUserId();
      if (!userId) {
        console.log('[Main Process] No user ID found, proceeding with basic logout');
        const result = await authService.logout();
        event.sender.send('logout-result', result);
        return;
      }

      console.log(`[Main Process] Starting logout process for user: ${userId}`);

      const stats = await getUserDataStats(userId);
      console.log(`[Main Process] User data to sync: ${stats.projectsCount} projects, ${stats.executionsCount} executions`);

      // Save current CSV data to Supabase if present
      const csvData = deps.getCsvData();
      if (csvData && csvData.length > 0) {
        try {
          console.log(`[Main Process] Saving current CSV data (${csvData.length} entries) to Supabase...`);
          await saveCsvToSupabase(csvData, `logout_backup_${Date.now()}.csv`);
          console.log('[Main Process] CSV data saved successfully');
        } catch (csvError) {
          console.error('[Main Process] Error saving CSV to Supabase:', csvError);
        }
      }

      // Sync all user data to Supabase
      if (authService.isAuthenticated() && authService.isOnline()) {
        try {
          console.log('[Main Process] Syncing user data to Supabase...');
          await syncAllUserDataToSupabase(userId);
          console.log('[Main Process] User data synced successfully');
        } catch (syncError) {
          console.error('[Main Process] Error syncing data to Supabase:', syncError);

          if (mainWindow) {
            const response = await new Promise<boolean>((resolve) => {
              const confirmDialog = dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Errore Sincronizzazione',
                message: 'Impossibile sincronizzare i dati su Supabase',
                detail: 'I dati locali potrebbero andare persi. Vuoi procedere comunque con il logout?',
                buttons: ['Annulla Logout', 'Procedi Comunque'],
                defaultId: 0,
                cancelId: 0
              });

              confirmDialog.then((result: any) => resolve(result.response === 1));
            });

            if (!response) {
              console.log('[Main Process] User cancelled logout due to sync error');
              event.sender.send('logout-result', { success: false, error: 'Logout cancelled by user' });
              return;
            }
          }
        }
      } else {
        console.log('[Main Process] User is offline or not authenticated, skipping sync');
      }

      const result = await authService.logout();

      if (userId) {
        console.log('[Main Process] Clearing local user data...');
        await clearAllUserData(userId);
        console.log('[Main Process] Local user data cleared');
      }

      // Clear global variables
      deps.setCsvData([]);
      deps.setGlobalCsvData([]);
      console.log('[Main Process] Global variables cleared');

      // Clean temporary files
      try {
        const thumbnailDir = path.join(os.tmpdir(), 'racetagger-thumbnails');
        try {
          await fsPromises.access(thumbnailDir, fs.constants.F_OK);
          const files = await fsPromises.readdir(thumbnailDir);
          await Promise.all(
            files.map(async (file) => {
              try {
                await fsPromises.unlink(path.join(thumbnailDir, file));
              } catch (fileError) {
                console.error(`[Main Process] Error deleting temp file ${file}:`, fileError);
              }
            })
          );
          console.log('[Main Process] Temporary files cleaned');
        } catch {
          // Directory doesn't exist, nothing to clean
        }
      } catch (tempError) {
        console.error('[Main Process] Error cleaning temporary files:', tempError);
      }

      console.log('[Main Process] Logout completed successfully');
      event.sender.send('logout-result', result);

    } catch (error: any) {
      console.error('[Main Process] Error during logout:', error);
      event.sender.send('logout-result', { success: false, error: error.message || 'Logout error' });
    }
  });

  ipcMain.on('continue-demo', (event: IpcMainEvent) => {
    authService.enableDemoMode();
    event.sender.send('auth-status', { isAuthenticated: false, user: null, session: null });
  });

  // Handler for restoring CSV data after login
  ipcMain.on('restore-csv-data', (event: IpcMainEvent, data: any) => {
    try {
      console.log(`[Main Process] Restoring CSV data: ${data.csvData.length} entries`);

      deps.setCsvData(data.csvData);
      deps.setGlobalCsvData(data.csvData);

      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('csv-loaded', {
          filename: data.filename || 'restored_from_supabase.csv',
          entries: data.csvData.length,
          message: `CSV ripristinato dal backup (${data.csvData.length} entries)`
        });
      }

      console.log('[Main Process] CSV data restored successfully');
    } catch (error) {
      console.error('[Main Process] Error restoring CSV data:', error);
    }
  });

  ipcMain.on('get-token-balance', async (event: IpcMainEvent) => {
    try {
      const balance = await authService.getTokenBalance();
      event.sender.send('token-balance', balance);
    } catch (error: any) {
      event.sender.send('auth-error', { message: 'Failed to fetch token balance' });
    }
  });

  // Force refresh token balance (for manual sync)
  ipcMain.on('force-token-refresh', async (event: IpcMainEvent) => {
    try {
      console.log('[Main] Force token refresh requested');

      const tokenInfo = await authService.forceTokenInfoRefresh();

      event.sender.send('token-balance', tokenInfo.balance);
      event.sender.send('pending-tokens', tokenInfo.pending);

      console.log('[Main] Refreshing sport categories...');
      await getSportCategories();
      console.log('[Main] Sport categories refreshed successfully');

      event.sender.send('categories-updated');
      console.log('[Main] Sent categories-updated event to frontend');

      console.log('[Main] Force token refresh completed, sent balance and pending to frontend');
    } catch (error: any) {
      console.error('[Main] Force token refresh failed:', error);
      event.sender.send('auth-error', { message: 'Failed to force refresh token balance' });
    }
  });

  ipcMain.on('get-subscription-info', async (event: IpcMainEvent) => {
    try {
      const subscriptionInfo = await authService.getSubscriptionInfo();
      event.sender.send('subscription-info', subscriptionInfo);
    } catch (error: any) {
      event.sender.send('auth-error', { message: 'Failed to fetch subscription info' });
    }
  });

  ipcMain.on('open-subscription-page', () => authService.openSubscriptionPage());

  // Handle opening external URLs (for pricing page, etc.)
  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      console.error('[Main Process] Error opening external URL:', error);
      return { success: false, error: error.message };
    }
  });

  // Listen for auth refresh completion to reload data
  ipcMain.on('auth-refresh-completed-from-renderer', async () => {
    console.log('[Main Process] Auth refresh completed - reloading data...');
    await syncUserProjects();
  });
}
