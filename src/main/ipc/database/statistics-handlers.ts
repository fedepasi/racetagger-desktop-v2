/**
 * Statistics IPC Handlers
 * Handles home page statistics, recent executions, and analysis logs
 */

import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import { authService } from '../../../auth-service';
import { getSupabaseClient } from '../../../database-service';

/**
 * Read executions from JSONL logs
 */
async function getExecutionsFromLogs(): Promise<any[]> {
  try {
    const userDataPath = app.getPath('userData');
    const analysisLogsPath = path.join(userDataPath, '.analysis-logs');

    if (!fs.existsSync(analysisLogsPath)) {
      return [];
    }

    const files = await fsPromises.readdir(analysisLogsPath);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && f.startsWith('exec_'));

    const executions = await Promise.all(
      jsonlFiles.map(async (file) => {
        try {
          const filePath = path.join(analysisLogsPath, file);
          const content = await fsPromises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(l => l.trim());

          if (lines.length === 0) return null;

          // Parse first and last lines for execution info
          const firstLine = JSON.parse(lines[0]);
          const lastLine = JSON.parse(lines[lines.length - 1]);

          const executionId = file.replace('exec_', '').replace('.jsonl', '');

          return {
            id: executionId,
            status: lastLine.event === 'EXECUTION_COMPLETE' ? 'completed' : 'in_progress',
            created_at: firstLine.timestamp,
            total_images: firstLine.data?.totalImages || lines.filter(l => {
              try {
                return JSON.parse(l).event === 'IMAGE_ANALYSIS';
              } catch {
                return false;
              }
            }).length
          };
        } catch (e) {
          console.warn(`[Statistics] Error parsing log file ${file}:`, e);
          return null;
        }
      })
    );

    return executions
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
  } catch (error) {
    console.error('[Statistics] Error reading execution logs:', error);
    return [];
  }
}

/**
 * Get statistics from local cache
 */
async function getHomeStatisticsFromCache(userId: string, monthStart: Date, monthEnd: Date): Promise<{
  success: boolean;
  data?: { monthlyPhotos: number; completedEvents: number } | null;
  error?: string;
}> {
  try {
    // Placeholder - returns null to indicate local cache is not available
    return { success: true, data: null };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Local cache error' };
  }
}

/**
 * Setup statistics IPC handlers
 */
export function setupStatisticsHandlers(): void {
  console.log('[Main Process] Setting up statistics IPC handlers...');

  // Analysis Log Handler
  ipcMain.handle('get-analysis-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        const mockLogData = [
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
        console.log(`[Main Process] Returning mock log data for execution ${executionId}`);
        return mockLogData;
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      if (!fs.existsSync(logFilePath)) {
        console.warn(`[Main Process] Analysis log file not found: ${logFilePath}`);
        return [];
      }

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());
      const logEvents = logLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.warn('[Main Process] Invalid JSON line in analysis log:', line);
          return null;
        }
      }).filter(Boolean);

      console.log(`[Main Process] Loaded ${logEvents.length} analysis log events for execution ${executionId}`);
      return logEvents;

    } catch (error) {
      console.error('[Main Process] Error reading analysis log:', error);
      return [];
    }
  });

  // Home page statistics handler
  ipcMain.handle('get-home-statistics', async () => {
    console.log('[Home Stats] Starting home statistics calculation...');
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) {
        console.log('[Home Stats] No user ID available, returning default stats');
        return {
          success: true,
          data: { monthlyPhotos: 0, completedEvents: 0 }
        };
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      console.log(`[Home Stats] Querying executions for user ${userId}`);

      let monthlyPhotos = 0;
      let completedEvents = 0;

      try {
        const supabase = getSupabaseClient();

        const { data, error } = await supabase
          .from('executions')
          .select(`
            id,
            status,
            created_at,
            execution_settings!execution_settings_execution_id_fkey (
              total_images_processed
            )
          `)
          .eq('user_id', userId)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .lte('created_at', now.toISOString());

        if (error) {
          console.error('[Home Stats] Supabase query error:', error);
          throw error;
        }

        if (data && Array.isArray(data)) {
          completedEvents = data.filter(exec => exec.status === 'completed').length;
          monthlyPhotos = data.reduce((sum, exec) => {
            const settings: any = Array.isArray(exec.execution_settings) && exec.execution_settings.length > 0
              ? exec.execution_settings[0]
              : exec.execution_settings;
            return sum + (settings?.total_images_processed || 0);
          }, 0);

          // Fallback to images table
          if (monthlyPhotos === 0) {
            const { data: imagesData } = await supabase
              .from('images')
              .select('id', { count: 'exact' })
              .eq('user_id', userId)
              .gte('uploaded_at', thirtyDaysAgo.toISOString())
              .lte('uploaded_at', now.toISOString());

            monthlyPhotos = imagesData?.length || 0;
          }

          console.log(`[Home Stats] Retrieved: ${completedEvents} events, ${monthlyPhotos} photos`);
        }
      } catch (supabaseError) {
        console.warn('[Home Stats] Supabase query failed, trying local cache');
        const { data: localStats } = await getHomeStatisticsFromCache(userId, thirtyDaysAgo, now);
        if (localStats) {
          monthlyPhotos = localStats.monthlyPhotos || 0;
          completedEvents = localStats.completedEvents || 0;
        }
      }

      return {
        success: true,
        data: { monthlyPhotos, completedEvents }
      };
    } catch (error: any) {
      console.error('[Home Stats] Critical error:', error);
      return {
        success: false,
        error: error.message,
        data: { monthlyPhotos: 0, completedEvents: 0 }
      };
    }
  });

  // Get recent executions handler
  ipcMain.handle('get-recent-executions', async () => {
    console.log('[Recent Executions] Starting query...');
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) {
        console.log('[Recent Executions] No user ID, returning empty array');
        return { success: true, data: [] };
      }

      const executions = await getExecutionsFromLogs();
      return { success: true, data: executions };

    } catch (error: any) {
      console.error('[Recent Executions] Error:', error);
      return { success: false, error: error.message, data: [] };
    }
  });

  // Get user info handler
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
      console.error('[User Info] Error getting user info:', error);
      return { success: false, name: 'Photographer' };
    }
  });
}
