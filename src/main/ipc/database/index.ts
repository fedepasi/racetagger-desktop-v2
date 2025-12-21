/**
 * Database IPC Handlers
 * Central module for all database-related IPC operations
 */

import { BrowserWindow } from 'electron';
import { setupProjectHandlers } from './project-handlers';
import { setupExecutionHandlers } from './execution-handlers';
import { setupPresetHandlers } from './preset-handlers';
import { setupSportCategoryHandlers } from './sport-category-handlers';
import { setupExportDestinationHandlers, ExportDestinationHandlersDependencies } from './export-destination-handlers';
import { setupStatisticsHandlers } from './statistics-handlers';
import { setupThumbnailHandlers } from './thumbnail-handlers';

// Re-export individual handler modules
export * from './project-handlers';
export * from './execution-handlers';
export * from './preset-handlers';
export * from './sport-category-handlers';
export * from './export-destination-handlers';
export * from './statistics-handlers';
export * from './thumbnail-handlers';

// Dependencies interface for the main setup
export interface DatabaseHandlersDependencies {
  getMainWindow: () => BrowserWindow | null;
}

/**
 * Setup all database IPC handlers
 * Call this once during app initialization
 */
export function setupDatabaseIpcHandlers(dependencies: DatabaseHandlersDependencies): void {
  console.log('[Main Process] Setting up all database IPC handlers...');

  // Setup handlers that don't need dependencies
  setupProjectHandlers();
  setupExecutionHandlers();
  setupPresetHandlers();
  setupSportCategoryHandlers();
  setupStatisticsHandlers();
  setupThumbnailHandlers();

  // Setup handlers that need dependencies
  const exportDeps: ExportDestinationHandlersDependencies = {
    getMainWindow: dependencies.getMainWindow
  };
  setupExportDestinationHandlers(exportDeps);

  console.log('[Main Process] All database IPC handlers setup complete');
}
