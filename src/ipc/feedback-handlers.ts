/**
 * Support Feedback IPC Handlers
 *
 * Handles system diagnostics collection and feedback submission
 * to GitHub Issues via Supabase Edge Function.
 */

import { app, ipcMain, shell } from 'electron';
import * as os from 'os';
import { DEBUG_MODE } from '../config';
import { getSupabase } from './context';
import { authService } from '../auth-service';
import { SystemDiagnostics, DependencyStatus, FeedbackSubmission, FeedbackResult } from './types';

export function registerFeedbackHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering feedback handlers...');

  // ==================== SYSTEM DIAGNOSTICS ====================

  ipcMain.handle('get-system-diagnostics', async (): Promise<SystemDiagnostics> => {
    try {
      const { hardwareDetector } = await import('../utils/hardware-detector');
      const hwInfo = await hardwareDetector.getHardwareInfo();

      return {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron || 'unknown',
        nodeVersion: process.versions.node || 'unknown',
        os: process.platform,
        osVersion: os.release(),
        arch: process.arch,
        cpu: hwInfo.cpu_model,
        cpuCores: hwInfo.cpu_cores,
        cpuThreads: hwInfo.cpu_threads,
        ramTotal: hwInfo.ram_total_gb,
        ramAvailable: hwInfo.ram_available_gb,
        gpu: hwInfo.gpu_model,
        diskType: hwInfo.disk_type,
        diskAvailable: hwInfo.disk_available_gb,
        diskTotal: hwInfo.disk_total_gb,
      };
    } catch (error: any) {
      console.error('[IPC] Error getting system diagnostics:', error);
      return {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron || 'unknown',
        nodeVersion: process.versions.node || 'unknown',
        os: process.platform,
        osVersion: os.release(),
        arch: process.arch,
        cpu: 'unknown',
        cpuCores: os.cpus().length,
        cpuThreads: os.cpus().length,
        ramTotal: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
        ramAvailable: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
        diskType: 'Unknown',
        diskAvailable: 0,
        diskTotal: 0,
      };
    }
  });

  // ==================== DEPENDENCY STATUS ====================

  ipcMain.handle('get-dependency-status', async (): Promise<DependencyStatus[]> => {
    try {
      const { nativeToolManager } = await import('../utils/native-tool-manager');
      const diagnostics = await nativeToolManager.getSystemDiagnostics();
      const deps: DependencyStatus[] = [];

      for (const [name, info] of Object.entries(diagnostics.tools)) {
        if (info && typeof info === 'object' && 'exists' in info) {
          deps.push({
            name,
            path: 'path' in info ? (info as any).path : undefined,
            exists: (info as any).exists,
            working: (info as any).working,
            native: 'native' in info ? (info as any).native : undefined,
          });
        } else if (info && typeof info === 'object' && 'error' in info) {
          deps.push({
            name,
            exists: false,
            working: false,
            error: (info as any).error,
          });
        }
      }

      // Check Sharp availability
      try {
        const sharp = await import('sharp');
        deps.push({
          name: 'sharp',
          path: require.resolve('sharp'),
          exists: true,
          working: typeof sharp.default === 'function',
          native: true,
        });
      } catch (sharpError: any) {
        deps.push({
          name: 'sharp',
          exists: false,
          working: false,
          native: true,
          error: sharpError.message,
        });
      }

      // Check raw-preview-extractor availability
      try {
        const rpe = await import('raw-preview-extractor');
        deps.push({
          name: 'raw-preview-extractor',
          path: require.resolve('raw-preview-extractor'),
          exists: true,
          working: !!rpe,
          native: true,
        });
      } catch (rpeError: any) {
        deps.push({
          name: 'raw-preview-extractor',
          exists: false,
          working: false,
          native: true,
          error: rpeError.message,
        });
      }

      return deps;
    } catch (error: any) {
      console.error('[IPC] Error getting dependency status:', error);
      return [{ name: 'diagnostics', exists: false, working: false, error: error.message }];
    }
  });

  // ==================== RECENT ERRORS ====================

  ipcMain.handle('get-recent-errors', async (): Promise<Array<{ message: string; category: string; severity: string; timestamp: string }>> => {
    try {
      const { errorTracker } = await import('../utils/error-tracker');
      const summary = errorTracker.getErrorSummary();
      return summary.recent_errors.map(e => ({
        message: e.message,
        category: e.category,
        severity: e.severity,
        timestamp: e.timestamp,
      }));
    } catch (error: any) {
      console.error('[IPC] Error getting recent errors:', error);
      return [];
    }
  });

  // ==================== SUBMIT FEEDBACK ====================

  ipcMain.handle('submit-support-feedback', async (_, submission: FeedbackSubmission): Promise<FeedbackResult> => {
    try {
      // Validate input
      if (!submission.type || !['bug', 'feature', 'general'].includes(submission.type)) {
        return { success: false, error: 'Invalid feedback type' };
      }
      if (!submission.title || submission.title.trim().length === 0) {
        return { success: false, error: 'Title is required' };
      }
      if (submission.title.length > 200) {
        return { success: false, error: 'Title must be 200 characters or less' };
      }
      if (!submission.description || submission.description.trim().length === 0) {
        return { success: false, error: 'Description is required' };
      }
      if (submission.description.length > 5000) {
        return { success: false, error: 'Description must be 5000 characters or less' };
      }

      // Check auth
      const authState = authService.getAuthState();
      if (!authState.isAuthenticated || !authState.session?.access_token) {
        return { success: false, error: 'You must be logged in to submit feedback' };
      }

      const supabase = getSupabase();
      const { data, error } = await supabase.functions.invoke('submitFeedback', {
        body: submission,
        headers: {
          Authorization: `Bearer ${authState.session.access_token}`,
        },
      });

      if (error) {
        console.error('[IPC] Edge function error:', error);
        // When edge function returns non-2xx, the body is in data or error.context
        if (data && data.error) {
          return { success: false, error: data.error };
        }
        // Try to extract from response context (Supabase client pattern)
        if ((error as any).context && typeof (error as any).context.json === 'function') {
          try {
            const errorBody = await (error as any).context.json();
            if (errorBody && errorBody.error) {
              return { success: false, error: errorBody.error };
            }
          } catch (_parseError) {
            // Failed to parse error response
          }
        }
        return { success: false, error: error.message || 'Failed to submit feedback' };
      }

      if (data && data.success) {
        return {
          success: true,
          issueNumber: data.issueNumber,
          issueUrl: data.issueUrl,
        };
      }

      return { success: false, error: data?.error || 'Unknown error from server' };
    } catch (error: any) {
      console.error('[IPC] Error submitting feedback:', error);
      return { success: false, error: error.message || 'Failed to submit feedback' };
    }
  });

  // ==================== OPEN GITHUB ISSUES ====================

  ipcMain.handle('open-github-issues', async () => {
    await shell.openExternal('https://github.com/federicopasinetti/racetagger-clean/issues');
    return true;
  });

  if (DEBUG_MODE) console.log('[IPC] Feedback handlers registered (5 handlers)');
}
