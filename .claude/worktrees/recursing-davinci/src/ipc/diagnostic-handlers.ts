/**
 * Diagnostic Log IPC Handlers (v1.2.0)
 *
 * Provides access to main process logs for debugging.
 * The full diagnostic collection + upload is now handled by feedback-handlers.ts
 * as part of the unified support system.
 *
 * Handlers:
 * 1. get-main-process-logs - Returns recent main process logs
 * 2. get-diagnostic-log-path - Returns the local log file path
 * 3. open-diagnostic-log-folder - Opens the log folder in Finder/Explorer
 */

import { ipcMain, shell } from 'electron';
import { DEBUG_MODE } from '../config';
import { diagnosticLogger } from '../utils/diagnostic-logger';

// Re-export DiagnosticReport type for backward compatibility
export interface DiagnosticReport {
  reportId: string;
  timestamp: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  ramTotalGb: number;
  ramFreeGb: number;
  userId?: string;
  userEmail?: string;
  machineId?: string;
  dependencies: Array<{
    name: string;
    status: 'OK' | 'WARN' | 'FAIL';
    detail: string;
  }>;
  recentErrors: Array<{
    message: string;
    category: string;
    severity: string;
    timestamp: string;
  }>;
  mainProcessLogs: string;
  lastExecutionSummary?: string;
}

export function registerDiagnosticHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering diagnostic handlers...');

  // ==================== GET MAIN PROCESS LOGS ====================

  ipcMain.handle('get-main-process-logs', async (_, maxLines?: number): Promise<string> => {
    try {
      return diagnosticLogger.getRecentLogs(maxLines || 500);
    } catch (error: any) {
      return `[Error: ${error.message}]`;
    }
  });

  // ==================== GET DIAGNOSTIC LOG PATH ====================

  ipcMain.handle('get-diagnostic-log-path', async (): Promise<{ dir: string; file: string; stats: { currentSize: number; totalSize: number; fileCount: number } }> => {
    try {
      return {
        dir: diagnosticLogger.getLogDirectory(),
        file: diagnosticLogger.getLogFilePath(),
        stats: diagnosticLogger.getLogStats(),
      };
    } catch (error: any) {
      return { dir: '', file: '', stats: { currentSize: 0, totalSize: 0, fileCount: 0 } };
    }
  });

  // ==================== OPEN LOG FOLDER ====================

  ipcMain.handle('open-diagnostic-log-folder', async (): Promise<boolean> => {
    try {
      const logDir = diagnosticLogger.getLogDirectory();
      await shell.openPath(logDir);
      return true;
    } catch {
      return false;
    }
  });

  if (DEBUG_MODE) console.log('[IPC] Diagnostic handlers registered (3 handlers)');
}
