/**
 * IPC Handlers Registration
 *
 * Central module that registers all IPC handlers for the application.
 * This replaces the inline handlers from main.ts with a modular architecture.
 *
 * Handler Modules:
 * - window-handlers.ts: Window control (3 handlers)
 * - auth-handlers.ts: Authentication & tokens (18 handlers)
 * - database-handlers.ts: Projects, executions, presets (22 handlers)
 * - supabase-handlers.ts: Sport categories, caching, feature flags (19 handlers)
 * - export-handlers.ts: Export destinations & processing (13 handlers)
 * - app-handlers.ts: App info, consent, settings (11 handlers)
 * - file-handlers.ts: File dialogs, folder operations (8 handlers)
 * - image-handlers.ts: Thumbnail generation, image loading (5 handlers)
 * - csv-handlers.ts: CSV loading and parsing (4 handlers)
 * - analysis-handlers.ts: Analysis logs and pipeline (4 handlers)
 * - face-recognition-handlers.ts: Face detection and matching (6 handlers)
 * - preset-face-handlers.ts: Preset participant face photos (6 handlers)
 * - version-handlers.ts: App version checking (4 handlers)
 *
 * Total: 123 handlers extracted into modular files
 * Note: Some complex handlers (analyze-folder) remain in main.ts due to dependencies
 */

import { BrowserWindow } from 'electron';
import { setMainWindow } from './context';
import { registerWindowHandlers } from './window-handlers';
import { registerAuthHandlers } from './auth-handlers';
import { registerDatabaseHandlers } from './database-handlers';
import { registerSupabaseHandlers } from './supabase-handlers';
import { registerExportHandlers } from './export-handlers';
import { registerAppHandlers } from './app-handlers';
import { registerFileHandlers } from './file-handlers';
import { registerImageHandlers } from './image-handlers';
import { registerCsvHandlers } from './csv-handlers';
import { registerAnalysisHandlers } from './analysis-handlers';
import { registerFaceRecognitionHandlers } from './face-recognition-handlers';
import { registerPresetFaceHandlers } from './preset-face-handlers';
import { registerVersionHandlers } from './version-handlers';

/**
 * Initialize IPC context with mainWindow reference
 */
export function initializeIpcContext(mainWindow: BrowserWindow): void {
  setMainWindow(mainWindow);
  console.log('[IPC] Context initialized with mainWindow');
}

/**
 * Register all IPC handlers
 * Call this after app.ready() and before creating the main window
 */
export function registerAllHandlers(): void {
  console.log('[IPC] ========================================');
  console.log('[IPC] Registering all IPC handlers...');
  console.log('[IPC] ========================================');

  // Window control handlers (3)
  registerWindowHandlers();

  // Authentication handlers (17)
  registerAuthHandlers();

  // Database handlers (22)
  registerDatabaseHandlers();

  // Supabase handlers (17)
  registerSupabaseHandlers();

  // Export handlers (13)
  registerExportHandlers();

  // App info handlers (14)
  registerAppHandlers();

  // File system handlers (8)
  registerFileHandlers();

  // Image processing handlers (5)
  registerImageHandlers();

  // CSV handlers (4)
  registerCsvHandlers();

  // Analysis handlers (4)
  registerAnalysisHandlers();

  // Face recognition handlers (6)
  registerFaceRecognitionHandlers();

  // Preset face handlers (6)
  registerPresetFaceHandlers();

  // Version handlers (4)
  registerVersionHandlers();

  console.log('[IPC] ========================================');
  console.log('[IPC] All handlers registered (123 modular handlers)');
  console.log('[IPC] ========================================');
}

// Re-export utilities for use in main.ts and other modules
export { getMainWindow, setMainWindow, safeSend, safeSendToSender } from './context';
export { getGlobalCsvData, setGlobalCsvData } from './context';
export { getBatchConfig, setBatchConfig } from './context';
export { isBatchProcessingCancelled, setBatchProcessingCancelled } from './context';
export { getSupabase, getSupabaseImageUrlCache } from './context';
export { isForceUpdateRequired, setVersionCheckResult, getVersionCheckResult } from './context';

// Re-export version check function for use during app startup
export { checkAppVersion } from './version-handlers';

// Re-export types
export * from './types';
