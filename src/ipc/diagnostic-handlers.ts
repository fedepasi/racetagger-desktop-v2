/**
 * Remote Diagnostic IPC Handlers
 *
 * Enables one-click diagnostic collection and remote upload to Supabase.
 * Testers can send full diagnostic reports without needing technical knowledge.
 *
 * Handlers:
 * 1. collect-full-diagnostics - Gathers ALL diagnostic data into a single report
 * 2. upload-diagnostics-remote - Uploads diagnostic report to Supabase Storage
 * 3. get-main-process-logs - Returns recent main process logs (from diagnostic-logger)
 * 4. get-diagnostic-log-path - Returns the local log file path
 */

import { app, ipcMain, shell } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { DEBUG_MODE } from '../config';
import { getSupabase } from './context';
import { authService } from '../auth-service';
import { diagnosticLogger } from '../utils/diagnostic-logger';

// ==================== Types ====================

export interface DiagnosticReport {
  // Metadata
  reportId: string;
  timestamp: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;

  // System
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  ramTotalGb: number;
  ramFreeGb: number;

  // User (anonymized)
  userId?: string;
  userEmail?: string;
  machineId?: string;

  // Health Report
  dependencies: Array<{
    name: string;
    status: 'OK' | 'WARN' | 'FAIL';
    detail: string;
  }>;

  // Errors
  recentErrors: Array<{
    message: string;
    category: string;
    severity: string;
    timestamp: string;
  }>;

  // Main Process Logs (last 1000 lines)
  mainProcessLogs: string;

  // Optional: last execution log summary
  lastExecutionSummary?: string;
}

// ==================== Handler Registration ====================

export function registerDiagnosticHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering diagnostic handlers...');

  // ==================== COLLECT FULL DIAGNOSTICS ====================

  ipcMain.handle('collect-full-diagnostics', async (): Promise<DiagnosticReport> => {
    try {
      const reportId = `diag_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      // System info
      const cpus = os.cpus();
      const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';

      // Auth info (for user identification)
      let userId: string | undefined;
      let userEmail: string | undefined;
      try {
        const authState = authService.getAuthState();
        userId = authState.user?.id;
        userEmail = authState.user?.email;
      } catch { /* auth not available */ }

      // Machine ID
      let machineId: string | undefined;
      try {
        const { getMachineId } = await import('../utils/system-info');
        machineId = getMachineId();
      } catch { /* ok */ }

      // Dependencies / Health
      const dependencies: DiagnosticReport['dependencies'] = [];
      try {
        // Sharp
        try {
          require('sharp');
          dependencies.push({ name: 'Sharp', status: 'OK', detail: 'loaded' });
        } catch (e: any) {
          dependencies.push({ name: 'Sharp', status: 'FAIL', detail: e.message });
        }

        // better-sqlite3
        try {
          const { db } = require('../database-service');
          if (db) {
            dependencies.push({ name: 'better-sqlite3', status: 'OK', detail: 'working' });
          } else {
            dependencies.push({ name: 'better-sqlite3', status: 'FAIL', detail: 'not initialized' });
          }
        } catch (e: any) {
          dependencies.push({ name: 'better-sqlite3', status: 'FAIL', detail: e.message });
        }

        // ONNX Runtime
        try {
          require('onnxruntime-node');
          dependencies.push({ name: 'ONNX Runtime', status: 'OK', detail: 'loaded' });
        } catch {
          dependencies.push({ name: 'ONNX Runtime', status: 'WARN', detail: 'not available' });
        }

        // raw-preview-extractor
        try {
          require('raw-preview-extractor');
          dependencies.push({ name: 'raw-preview-ext', status: 'OK', detail: 'loaded' });
        } catch {
          dependencies.push({ name: 'raw-preview-ext', status: 'WARN', detail: 'not available' });
        }

        // Native tools (dcraw, exiftool)
        try {
          const { nativeToolManager } = require('../utils/native-tool-manager');
          const diag = await nativeToolManager.getSystemDiagnostics();
          if (diag?.tools) {
            for (const [toolName, info] of Object.entries(diag.tools) as [string, any][]) {
              if (info.working) {
                dependencies.push({ name: toolName, status: 'OK', detail: `working (${info.path || 'bundled'})` });
              } else if (info.exists) {
                dependencies.push({ name: toolName, status: 'WARN', detail: 'found but not working' });
              } else {
                dependencies.push({ name: toolName, status: 'FAIL', detail: 'not found' });
              }
            }
          }
        } catch { /* ok */ }
      } catch { /* dependency check failed */ }

      // Recent errors
      let recentErrors: DiagnosticReport['recentErrors'] = [];
      try {
        const { errorTracker } = await import('../utils/error-tracker');
        const summary = errorTracker.getErrorSummary();
        recentErrors = summary.recent_errors.map(e => ({
          message: e.message,
          category: e.category,
          severity: e.severity,
          timestamp: e.timestamp,
        }));
      } catch { /* ok */ }

      // Main process logs
      const mainProcessLogs = diagnosticLogger.getRecentLogs(1000);

      // Build report
      const report: DiagnosticReport = {
        reportId,
        timestamp: new Date().toISOString(),
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron || 'unknown',
        nodeVersion: process.versions.node || 'unknown',
        platform: `${process.platform} ${process.arch}`,
        arch: process.arch,
        osRelease: os.release(),
        cpuModel,
        cpuCores: cpus.length,
        ramTotalGb: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
        ramFreeGb: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
        userId,
        userEmail,
        machineId,
        dependencies,
        recentErrors,
        mainProcessLogs,
      };

      return report;
    } catch (error: any) {
      console.error('[Diagnostics] Failed to collect diagnostics:', error);
      // Return a minimal report even on failure
      return {
        reportId: `diag_error_${Date.now()}`,
        timestamp: new Date().toISOString(),
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron || 'unknown',
        nodeVersion: process.versions.node || 'unknown',
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        cpuModel: 'error',
        cpuCores: 0,
        ramTotalGb: 0,
        ramFreeGb: 0,
        dependencies: [],
        recentErrors: [{ message: error.message, category: 'unknown', severity: 'fatal', timestamp: new Date().toISOString() }],
        mainProcessLogs: diagnosticLogger.getRecentLogs(500),
      };
    }
  });

  // ==================== UPLOAD DIAGNOSTICS REMOTE ====================

  ipcMain.handle('upload-diagnostics-remote', async (_, report: DiagnosticReport): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const supabase = getSupabase();

      // Get auth token for upload
      const authState = authService.getAuthState();
      if (!authState.isAuthenticated || !authState.session?.access_token) {
        return { success: false, error: 'Not authenticated - please log in first' };
      }

      // Use access_token from authService to set the session on the Supabase client
      const accessToken = authState.session.access_token;
      const refreshToken = authState.session.refresh_token || '';
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      // Build file content
      const reportText = formatDiagnosticReport(report);
      const buffer = Buffer.from(reportText, 'utf-8');

      // Upload path: diagnostic-reports/{userId}/{date}/{reportId}.txt
      const userId = report.userId || 'anonymous';
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const storagePath = `${userId}/${date}/${report.reportId}.txt`;

      const { data, error } = await supabase.storage
        .from('diagnostic-reports')
        .upload(storagePath, buffer, {
          contentType: 'text/plain',
          upsert: true,
        });

      if (error) {
        // If bucket doesn't exist, try analysis-logs bucket as fallback
        console.warn('[Diagnostics] diagnostic-reports bucket upload failed:', error.message, '- trying analysis-logs...');
        const fallbackPath = `diagnostics/${userId}/${date}/${report.reportId}.txt`;
        const { data: fallbackData, error: fallbackError } = await supabase.storage
          .from('analysis-logs')
          .upload(fallbackPath, buffer, {
            contentType: 'text/plain',
            upsert: true,
          });

        if (fallbackError) {
          console.error('[Diagnostics] Upload failed:', fallbackError.message);
          return { success: false, error: `Upload failed: ${fallbackError.message}` };
        }

        console.log('[Diagnostics] Uploaded to analysis-logs bucket:', fallbackPath);

        // Generate signed URL (7 days expiry)
        const signedUrl = await generateSignedUrl(supabase, 'analysis-logs', fallbackPath);

        // Send email notification (non-blocking)
        sendDiagnosticEmailNotification(supabase, authState.session.access_token, report, fallbackPath, signedUrl);

        return { success: true, path: fallbackPath };
      }

      console.log('[Diagnostics] Uploaded to diagnostic-reports bucket:', storagePath);

      // Generate signed URL (7 days expiry)
      const signedUrl = await generateSignedUrl(supabase, 'diagnostic-reports', storagePath);

      // Send email notification (non-blocking, don't fail the upload if email fails)
      sendDiagnosticEmailNotification(supabase, authState.session.access_token, report, storagePath, signedUrl);

      return { success: true, path: storagePath };
    } catch (error: any) {
      console.error('[Diagnostics] Upload error:', error);
      return { success: false, error: error.message || 'Upload failed' };
    }
  });

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

  if (DEBUG_MODE) console.log('[IPC] Diagnostic handlers registered (5 handlers)');
}

// ==================== Signed URL ====================

/**
 * Generate a signed URL for a file in Supabase Storage (7-day expiry).
 */
async function generateSignedUrl(supabase: any, bucket: string, filePath: string): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 7 * 24 * 60 * 60); // 7 days in seconds

    if (error || !data?.signedUrl) {
      console.warn('[Diagnostics] Failed to generate signed URL:', error?.message);
      return '';
    }
    return data.signedUrl;
  } catch (e: any) {
    console.warn('[Diagnostics] Signed URL error:', e.message);
    return '';
  }
}

// ==================== Email Notification ====================

/**
 * Send email notification to admin when a diagnostic report is uploaded.
 * Non-blocking: errors are logged but don't affect the upload result.
 */
async function sendDiagnosticEmailNotification(
  supabase: any,
  accessToken: string,
  report: DiagnosticReport,
  storagePath: string,
  signedUrl?: string
): Promise<void> {
  try {
    // Build a short summary of key issues
    const summaryParts: string[] = [];
    for (const dep of report.dependencies) {
      if (dep.status !== 'OK') {
        summaryParts.push(`${dep.status} ${dep.name}: ${dep.detail}`);
      }
    }
    if (report.recentErrors.length > 0) {
      summaryParts.push(`${report.recentErrors.length} recent error(s)`);
      // Add last 3 error messages
      for (const err of report.recentErrors.slice(-3)) {
        summaryParts.push(`  [${err.severity}] ${err.message}`);
      }
    }

    const { error } = await supabase.functions.invoke('send-diagnostic-email', {
      body: {
        reportId: report.reportId,
        userEmail: report.userEmail || 'unknown',
        platform: report.platform,
        appVersion: report.appVersion,
        storagePath,
        signedUrl: signedUrl || '',
        summary: summaryParts.join('\n') || 'No issues detected',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (error) {
      console.warn('[Diagnostics] Email notification failed (non-critical):', error.message);
    } else {
      console.log('[Diagnostics] Email notification sent to admin');
    }
  } catch (emailError: any) {
    // Email failure should never block the diagnostic upload
    console.warn('[Diagnostics] Email notification error (non-critical):', emailError.message);
  }
}

// ==================== Report Formatting ====================

function formatDiagnosticReport(report: DiagnosticReport): string {
  const sep = '='.repeat(80);
  const thin = '-'.repeat(80);
  const lines: string[] = [];

  lines.push(sep);
  lines.push(`RACETAGGER DIAGNOSTIC REPORT`);
  lines.push(`Report ID: ${report.reportId}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(sep);
  lines.push('');

  // System Info
  lines.push('--- SYSTEM INFO ---');
  lines.push(`App Version: ${report.appVersion}`);
  lines.push(`Electron: ${report.electronVersion} | Node: ${report.nodeVersion}`);
  lines.push(`Platform: ${report.platform}`);
  lines.push(`OS Release: ${report.osRelease}`);
  lines.push(`CPU: ${report.cpuModel} (${report.cpuCores} cores)`);
  lines.push(`RAM: ${report.ramTotalGb} GB total, ${report.ramFreeGb} GB free`);
  if (report.machineId) lines.push(`Machine ID: ${report.machineId}`);
  if (report.userEmail) lines.push(`User: ${report.userEmail}`);
  lines.push('');

  // Dependencies
  lines.push('--- DEPENDENCIES ---');
  for (const dep of report.dependencies) {
    const icon = dep.status === 'OK' ? '[OK]  ' : dep.status === 'WARN' ? '[WARN]' : '[FAIL]';
    lines.push(`${icon} ${dep.name.padEnd(25)} ${dep.detail}`);
  }
  lines.push('');

  // Errors
  if (report.recentErrors.length > 0) {
    lines.push('--- RECENT ERRORS ---');
    for (const err of report.recentErrors) {
      lines.push(`[${err.timestamp}] [${err.severity}] [${err.category}] ${err.message}`);
    }
    lines.push('');
  }

  // Main Process Logs
  lines.push(thin);
  lines.push('--- MAIN PROCESS LOGS (recent) ---');
  lines.push(thin);
  lines.push(report.mainProcessLogs || '(no logs captured)');
  lines.push('');
  lines.push(sep);
  lines.push('END OF DIAGNOSTIC REPORT');
  lines.push(sep);

  return lines.join('\n');
}
