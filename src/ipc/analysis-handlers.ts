/**
 * Analysis IPC Handlers
 *
 * Handles analysis log visualization, pipeline configuration, and batch processing control.
 * Note: The main analyze-folder and update-analysis-log handlers remain in main.ts
 * due to complex dependencies (exiftool, Supabase upload, etc.).
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { setBatchProcessingCancelled } from './context';
import { DEBUG_MODE } from '../config';

// ==================== Log Reading Utilities ====================

/**
 * Read and parse a JSONL log file
 */
function readLogFile(logFilePath: string): any[] {
  if (!fs.existsSync(logFilePath)) {
    return [];
  }

  const logContent = fs.readFileSync(logFilePath, 'utf-8');
  const logLines = logContent.trim().split('\n').filter(line => line.trim());

  return logLines.map(line => {
    try {
      return JSON.parse(line);
    } catch (error) {
      console.warn('[Analysis] Invalid JSON line in log:', line.substring(0, 100));
      return null;
    }
  }).filter(Boolean);
}

/**
 * Get mock log data for testing
 */
function getMockLogData(): any[] {
  return [
    {
      event: 'IMAGE_ANALYSIS',
      fileName: 'IMG_0001.jpg',
      timestamp: new Date().toISOString(),
      data: {
        fileName: 'IMG_0001.jpg',
        analysis: [{ number: '42', confidence: 0.95 }],
        csvMatch: { numero: '42', nome: 'Test Driver', squadra: 'Test Team' },
        imagePath: '/mock/path/IMG_0001.jpg'
      }
    },
    {
      event: 'IMAGE_ANALYSIS',
      fileName: 'IMG_0002.jpg',
      timestamp: new Date().toISOString(),
      data: {
        fileName: 'IMG_0002.jpg',
        analysis: [{ number: '17', confidence: 0.88 }],
        csvMatch: { numero: '17', nome: 'Another Driver', squadra: 'Racing Team' },
        imagePath: '/mock/path/IMG_0002.jpg'
      }
    }
  ];
}

// ==================== Register Handlers ====================

export function registerAnalysisHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering analysis handlers...');

  // Get analysis log (for Log Visualizer - returns array directly)
  ipcMain.handle('get-analysis-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        if (DEBUG_MODE) console.log(`[Analysis] Returning mock log data for execution ${executionId}`);
        return getMockLogData();
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      const logEvents = readLogFile(logFilePath);
      if (DEBUG_MODE) console.log(`[Analysis] Loaded ${logEvents.length} analysis log events for execution ${executionId}`);
      return logEvents;

    } catch (error) {
      console.error('[Analysis] Error reading analysis log:', error);
      return [];
    }
  });

  // Get execution log (returns wrapped response with success flag)
  ipcMain.handle('get-execution-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        if (DEBUG_MODE) console.log(`[Analysis] Returning mock log data for execution ${executionId}`);
        return { success: true, data: getMockLogData() };
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      if (!fs.existsSync(logFilePath)) {
        if (DEBUG_MODE) console.warn(`[Analysis] Log file not found: ${logFilePath}`);
        return { success: true, data: [] };
      }

      const logEvents = readLogFile(logFilePath);
      if (DEBUG_MODE) console.log(`[Analysis] Loaded ${logEvents.length} log events for execution ${executionId}`);
      return { success: true, data: logEvents };

    } catch (error) {
      console.error('[Analysis] Error reading execution log:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // NOTE: update-analysis-log remains in main.ts due to complex dependencies
  // (exiftool metadata updates, Supabase upload, comprehensive validation)

  // Get pipeline configuration
  ipcMain.handle('get-pipeline-config', async () => {
    try {
      const { PIPELINE_CONFIG } = await import('../config');

      return {
        success: true,
        config: {
          enabled: PIPELINE_CONFIG.enabled,
          workers: PIPELINE_CONFIG.workers,
          diskManagement: PIPELINE_CONFIG.diskManagement,
          performance: PIPELINE_CONFIG.performance
        }
      };
    } catch (error) {
      console.error('[Analysis] Error getting pipeline config:', error);
      return {
        success: false,
        error: (error as Error).message || 'Error getting pipeline configuration'
      };
    }
  });

  // Cancel batch processing
  ipcMain.on('cancel-batch-processing', () => {
    console.log('[Analysis] Batch processing cancellation requested');
    setBatchProcessingCancelled(true);
  });

  if (DEBUG_MODE) console.log('[IPC] Analysis handlers registered (4 handlers)');
}
