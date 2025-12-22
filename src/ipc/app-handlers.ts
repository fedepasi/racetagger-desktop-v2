/**
 * Application IPC Handlers
 *
 * Handles app info, version checks, consent management, and settings.
 */

import { app, ipcMain, shell } from 'electron';
import { authService } from '../auth-service';
import { APP_CONFIG, DEBUG_MODE } from '../config';

export function registerAppHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering app handlers...');

  // ==================== APP INFO ====================

  ipcMain.handle('get-app-path', () => {
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      return appPath.replace('app.asar', 'app.asar.unpacked');
    }
    return appPath;
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-max-supported-edge-function-version', () => {
    const { MAX_SUPPORTED_EDGE_FUNCTION_VERSION } = require('../config');
    return MAX_SUPPORTED_EDGE_FUNCTION_VERSION;
  });

  // ==================== EXTERNAL URLS ====================

  ipcMain.handle('open-download-url', async (_, url: string) => {
    if (url) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // NOTE: check-app-version, get-version-check-result, is-force-update-required,
  // and quit-app-for-update handlers remain in main.ts due to global state dependencies

  // ==================== RAW CONVERTER CHECK ====================

  ipcMain.handle('check-adobe-dng-converter', async () => {
    try {
      if (process.env.FORCE_ADOBE_DNG_FALLBACK !== 'true') {
        if (DEBUG_MODE) console.log('[IPC] FORCE_ADOBE_DNG_FALLBACK is false, Adobe DNG Converter not required');
        return { required: false, installed: true };
      }

      const { rawConverter } = await import('../utils/raw-converter');
      if (DEBUG_MODE) console.log('[IPC] Checking Adobe DNG Converter installation...');
      const isInstalled = await rawConverter.isDngConverterInstalled();
      console.log(`[IPC] Adobe DNG Converter installed: ${isInstalled}`);

      return { required: true, installed: isInstalled };
    } catch (error) {
      console.error('[IPC] Error checking Adobe DNG Converter:', error);
      return { required: true, installed: false, error: String(error) };
    }
  });

  // ==================== TRAINING CONSENT ====================

  ipcMain.handle('get-training-consent', async () => {
    try {
      const { consentService } = await import('../consent-service');
      return await consentService.getTrainingConsent();
    } catch (error) {
      console.error('[IPC] Error getting training consent:', error);
      return true;
    }
  });

  ipcMain.handle('set-training-consent', async (_, consent: boolean) => {
    try {
      const { consentService } = await import('../consent-service');
      return await consentService.setTrainingConsent(consent);
    } catch (error) {
      console.error('[IPC] Error setting training consent:', error);
      return false;
    }
  });

  ipcMain.handle('get-consent-status', async () => {
    try {
      const { consentService } = await import('../consent-service');
      return await consentService.getConsentStatus();
    } catch (error) {
      console.error('[IPC] Error getting consent status:', error);
      return { trainingConsent: true, consentUpdatedAt: null };
    }
  });

  // ==================== USER SETTINGS ====================

  ipcMain.handle('get-full-settings', async () => {
    try {
      const { userPreferencesService } = await import('../user-preferences-service');
      return await userPreferencesService.getFullSettings();
    } catch (error) {
      console.error('[IPC] Error getting full settings:', error);
      return {
        account: { email: '', userId: '', userRole: 'user' },
        tokens: { total: 0, used: 0, remaining: 0, pending: 0 },
        subscription: { plan: null, isActive: false, expiresAt: null },
        privacy: { trainingConsent: true, consentUpdatedAt: null }
      };
    }
  });

  // ==================== FOLDER ORGANIZATION ====================

  if (APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION) {
    if (DEBUG_MODE) console.log('[IPC] Registering folder organization handlers...');

    ipcMain.handle('check-folder-organization-enabled', async () => {
      const isFeatureEnabled = APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION;
      const hasAccess = authService.hasFolderOrganizationAccess();
      return isFeatureEnabled && hasAccess;
    });

    ipcMain.handle('get-folder-organization-config', async () => {
      if (!authService.hasFolderOrganizationAccess()) {
        throw new Error('Feature non disponibile');
      }
      const { createDefaultConfig } = await import('../utils/folder-organizer');
      return createDefaultConfig();
    });
  }

  // ==================== DEBUG ====================

  ipcMain.handle('debug-sharp', async () => {
    if (DEBUG_MODE) console.log('[IPC] debug-sharp handler called');
    try {
      const { debugSharp } = await import('../utils/native-modules');
      debugSharp();
      return { success: true, message: 'Debug information logged to console' };
    } catch (error: any) {
      console.error('[IPC] Error in debug-sharp handler:', error);
      return { success: false, error: error.message };
    }
  });

  if (DEBUG_MODE) console.log('[IPC] App handlers registered (11 handlers)');
}
