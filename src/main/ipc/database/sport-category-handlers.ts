/**
 * Sport Category IPC Handlers
 * Handles all sport category-related database operations
 */

import { ipcMain } from 'electron';
import {
  getSportCategories,
  getSportCategoryByCode,
  getCachedSportCategories,
  refreshCategoriesCache,
  cacheSupabaseData,
  isFeatureEnabled
} from '../../../database-service';

/**
 * Setup sport category IPC handlers
 */
export function setupSportCategoryHandlers(): void {
  console.log('[Main Process] Setting up sport category IPC handlers...');

  ipcMain.handle('supabase-get-sport-categories', async () => {
    try {
      const categories = await getSportCategories();
      return { success: true, data: categories };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-sport-category-by-code', async (_, code: string) => {
    try {
      const category = await getSportCategoryByCode(code);
      return { success: true, data: category };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-get-cached-sport-categories', async () => {
    try {
      const categories = getCachedSportCategories();
      console.log('[MAIN] getCachedSportCategories called, returning:', categories.length, 'categories');
      console.log('[MAIN] First few categories:', categories.slice(0, 3).map(c => ({ code: c.code, name: c.name })));
      return { success: true, data: categories };
    } catch (e: any) {
      console.error('[MAIN] Error in get-cached-sport-categories:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-refresh-categories-cache', async () => {
    try {
      await refreshCategoriesCache();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Cache Management Handler
  ipcMain.handle('supabase-cache-data', async () => {
    try {
      await cacheSupabaseData();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Feature Flags Handler
  ipcMain.handle('supabase-is-feature-enabled', async (_, featureName: string) => {
    try {
      const isEnabled = await isFeatureEnabled(featureName);
      return { success: true, data: isEnabled };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
