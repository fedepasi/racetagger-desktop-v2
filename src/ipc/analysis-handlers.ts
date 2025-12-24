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

  // Get recent executions from local JSONL files
  ipcMain.handle('get-local-executions', async () => {
    try {
      const analysisLogsPath = path.join(app.getPath('userData'), '.analysis-logs');

      // Check if analysis logs directory exists
      if (!fs.existsSync(analysisLogsPath)) {
        return { success: true, data: [] };
      }

      const files = fs.readdirSync(analysisLogsPath);
      const executionFiles = files.filter(file => file.startsWith('exec_') && file.endsWith('.jsonl'));

      const executions: any[] = [];

      for (const file of executionFiles) {
        try {
          const filePath = path.join(analysisLogsPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(line => line.trim());

          if (lines.length === 0) continue;

          // Parse first line (EXECUTION_START)
          let startLine;
          try {
            startLine = JSON.parse(lines[0]);
          } catch (parseError) {
            continue;
          }

          if (startLine.type !== 'EXECUTION_START') continue;

          // Parse last line to get completion status
          let status = 'processing';
          let totalProcessed = 0;
          let imagesWithNumbers = 0;

          // Count IMAGE_ANALYSIS events with recognized numbers
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.type === 'IMAGE_ANALYSIS') {
                totalProcessed++;
                // Check if any vehicle was detected with a race number
                // V6 format: aiResponse.vehicles[]
                const vehicles = event.aiResponse?.vehicles || event.vehicles || [];
                if (vehicles.length > 0) {
                  const hasNumber = vehicles.some((v: any) => v.raceNumber);
                  if (hasNumber) imagesWithNumbers++;
                } else if (event.primaryVehicle?.raceNumber) {
                  // Fallback for backward compatibility
                  imagesWithNumbers++;
                }
              } else if (event.type === 'EXECUTION_COMPLETE') {
                status = 'completed';
              }
            } catch (e) {
              continue;
            }
          }

          const execution = {
            id: startLine.executionId,
            createdAt: startLine.timestamp,
            status: status,
            sportCategory: startLine.category || 'motorsport',
            totalImages: startLine.totalImages || totalProcessed,
            imagesWithNumbers: imagesWithNumbers,
            folderPath: startLine.folderPath || ''
          };

          executions.push(execution);

        } catch (error) {
          if (DEBUG_MODE) console.warn(`[Analysis] Failed to parse ${file}:`, error);
          continue;
        }
      }

      // Sort by timestamp descending (most recent first)
      executions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return { success: true, data: executions.slice(0, 10) }; // Return only 10 most recent

    } catch (error) {
      console.error('[Analysis] Error reading local executions:', error);
      return { success: false, data: [] };
    }
  });

  if (DEBUG_MODE) console.log('[IPC] Analysis handlers registered (5 handlers)');
}
