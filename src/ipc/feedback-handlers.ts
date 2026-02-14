/**
 * Unified Support IPC Handlers (v1.2.0)
 *
 * Single support system that combines user feedback + full diagnostics.
 * Every submission:
 * 1. Collects full system diagnostics + main process logs
 * 2. Creates a GitHub Issue (with basic diagnostics in body)
 * 3. Uploads full diagnostic report to Supabase Storage
 * 4. Sends admin email notification with signed URL
 *
 * Handlers:
 * - get-system-diagnostics: System info for preview in modal
 * - get-dependency-status: Dependency health check
 * - get-recent-errors: Error tracker summary
 * - submit-support-feedback: Unified submit (GitHub Issue + Supabase diagnostics)
 * - open-github-issues: Open GitHub Issues page
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

  // ==================== UNIFIED SUBMIT FEEDBACK ====================

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

      // ---- STEP 1: Collect full diagnostics + upload to Supabase ----
      // Done FIRST so we can include the signed URL in the GitHub Issue
      let diagnosticReportUrl = '';
      try {
        diagnosticReportUrl = await collectAndUploadDiagnostics(
          supabase,
          authState,
          submission
        );
      } catch (diagError: any) {
        console.warn('[Support] Diagnostic upload failed (non-blocking):', diagError.message);
        // Continue even if upload fails — the GitHub Issue will just not have the link
      }

      // ---- STEP 2: Create GitHub Issue (with diagnostic link) ----
      const submissionWithLink = {
        ...submission,
        diagnosticReportUrl,  // Pass signed URL to Edge Function
      };

      const { data, error } = await supabase.functions.invoke('submitFeedback', {
        body: submissionWithLink,
        headers: {
          Authorization: `Bearer ${authState.session.access_token}`,
        },
      });

      if (error) {
        console.error('[Support] Edge function error:', error);
        if (data && data.error) {
          return { success: false, error: data.error };
        }
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

      if (!data || !data.success) {
        return { success: false, error: data?.error || 'Unknown error from server' };
      }

      // ---- STEP 3: Send admin email notification (background, fire-and-forget) ----
      sendAdminEmailInBackground(
        supabase,
        authState,
        submission,
        diagnosticReportUrl,
        data.issueNumber
      );

      return {
        success: true,
        issueNumber: data.issueNumber,
        issueUrl: data.issueUrl,
      };
    } catch (error: any) {
      console.error('[Support] Error submitting feedback:', error);
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

// ==================== Diagnostic Collection & Upload ====================

/**
 * Collects full diagnostics (system info, dependencies, errors, 1000 lines of main process logs)
 * and uploads to Supabase Storage BEFORE creating the GitHub Issue.
 * Returns the signed URL so it can be included in the Issue body.
 */
async function collectAndUploadDiagnostics(
  supabase: any,
  authState: any,
  submission: FeedbackSubmission
): Promise<string> {
  console.log('[Support] Collecting full diagnostics...');

  // Import diagnostic logger for main process logs
  const { diagnosticLogger } = await import('../utils/diagnostic-logger');

  // System info
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';

  // User info
  const userId = authState.user?.id || 'anonymous';
  const userEmail = authState.user?.email || 'unknown';

  // Machine ID
  let machineId: string | undefined;
  try {
    const { getMachineId } = await import('../utils/system-info');
    machineId = getMachineId();
  } catch { /* ok */ }

  // Dependencies
  const dependencies: Array<{ name: string; status: 'OK' | 'WARN' | 'FAIL'; detail: string }> = [];
  try {
    try {
      require('sharp');
      dependencies.push({ name: 'Sharp', status: 'OK', detail: 'loaded' });
    } catch (e: any) {
      dependencies.push({ name: 'Sharp', status: 'FAIL', detail: e.message });
    }

    try {
      require('onnxruntime-node');
      dependencies.push({ name: 'ONNX Runtime', status: 'OK', detail: 'loaded' });
    } catch {
      dependencies.push({ name: 'ONNX Runtime', status: 'WARN', detail: 'not available' });
    }

    try {
      require('raw-preview-extractor');
      dependencies.push({ name: 'raw-preview-ext', status: 'OK', detail: 'loaded' });
    } catch {
      dependencies.push({ name: 'raw-preview-ext', status: 'WARN', detail: 'not available' });
    }

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
  let recentErrors: Array<{ message: string; category: string; severity: string; timestamp: string }> = [];
  try {
    const { errorTracker } = await import('../utils/error-tracker');
    const summary = errorTracker.getErrorSummary();
    recentErrors = summary.recent_errors.map((e: any) => ({
      message: e.message,
      category: e.category,
      severity: e.severity,
      timestamp: e.timestamp,
    }));
  } catch { /* ok */ }

  // Main process logs (1000 lines)
  const mainProcessLogs = diagnosticLogger.getRecentLogs(1000);

  // Build report text
  const reportId = `support_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const timestamp = new Date().toISOString();

  const sep = '='.repeat(80);
  const thin = '-'.repeat(80);
  const lines: string[] = [];

  lines.push(sep);
  lines.push(`RACETAGGER SUPPORT REPORT`);
  lines.push(`Report ID: ${reportId}`);
  lines.push(`Generated: ${timestamp}`);
  lines.push(sep);
  lines.push('');

  // Feedback content
  lines.push('--- USER FEEDBACK ---');
  lines.push(`Type: ${submission.type}`);
  lines.push(`Title: ${submission.title}`);
  lines.push(`Description: ${submission.description}`);
  lines.push('');

  // System Info
  lines.push('--- SYSTEM INFO ---');
  lines.push(`App Version: ${app.getVersion()}`);
  lines.push(`Electron: ${process.versions.electron || 'unknown'} | Node: ${process.versions.node || 'unknown'}`);
  lines.push(`Platform: ${process.platform} ${process.arch}`);
  lines.push(`OS Release: ${os.release()}`);
  lines.push(`CPU: ${cpuModel} (${cpus.length} cores)`);
  lines.push(`RAM: ${Math.round(os.totalmem() / (1024 ** 3) * 10) / 10} GB total, ${Math.round(os.freemem() / (1024 ** 3) * 10) / 10} GB free`);
  if (machineId) lines.push(`Machine ID: ${machineId}`);
  lines.push(`User: ${userEmail}`);
  lines.push('');

  // Dependencies
  lines.push('--- DEPENDENCIES ---');
  for (const dep of dependencies) {
    const icon = dep.status === 'OK' ? '[OK]  ' : dep.status === 'WARN' ? '[WARN]' : '[FAIL]';
    lines.push(`${icon} ${dep.name.padEnd(25)} ${dep.detail}`);
  }
  lines.push('');

  // Errors
  if (recentErrors.length > 0) {
    lines.push('--- RECENT ERRORS ---');
    for (const err of recentErrors) {
      lines.push(`[${err.timestamp}] [${err.severity}] [${err.category}] ${err.message}`);
    }
    lines.push('');
  }

  // Main Process Logs
  lines.push(thin);
  lines.push('--- MAIN PROCESS LOGS (recent 1000 lines) ---');
  lines.push(thin);
  lines.push(mainProcessLogs || '(no logs captured)');
  lines.push('');
  lines.push(sep);
  lines.push('END OF SUPPORT REPORT');
  lines.push(sep);

  const reportText = lines.join('\n');
  const buffer = Buffer.from(reportText, 'utf-8');

  // Upload to Supabase Storage
  const accessToken = authState.session.access_token;
  const refreshToken = authState.session.refresh_token || '';
  await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const date = new Date().toISOString().split('T')[0];
  const storagePath = `${userId}/${date}/${reportId}.txt`;

  // Try diagnostic-reports bucket first, fallback to analysis-logs
  let uploadedPath = '';
  let uploadedBucket = '';

  const { error: uploadError } = await supabase.storage
    .from('diagnostic-reports')
    .upload(storagePath, buffer, { contentType: 'text/plain', upsert: true });

  if (uploadError) {
    console.warn('[Support] diagnostic-reports bucket failed:', uploadError.message, '- trying analysis-logs...');
    const fallbackPath = `support/${userId}/${date}/${reportId}.txt`;
    const { error: fallbackError } = await supabase.storage
      .from('analysis-logs')
      .upload(fallbackPath, buffer, { contentType: 'text/plain', upsert: true });

    if (fallbackError) {
      console.error('[Support] Upload to both buckets failed:', fallbackError.message);
      return ''; // Return empty URL, Issue will be created without link
    }
    uploadedPath = fallbackPath;
    uploadedBucket = 'analysis-logs';
  } else {
    uploadedPath = storagePath;
    uploadedBucket = 'diagnostic-reports';
  }

  console.log(`[Support] Full diagnostics uploaded to ${uploadedBucket}/${uploadedPath}`);

  // Generate signed URL (7 days)
  let signedUrl = '';
  try {
    const { data: signedData } = await supabase.storage
      .from(uploadedBucket)
      .createSignedUrl(uploadedPath, 7 * 24 * 60 * 60);
    if (signedData?.signedUrl) signedUrl = signedData.signedUrl;
  } catch { /* ok */ }

  return signedUrl;
}

// ==================== Admin Email (Background) ====================

/**
 * Sends admin email notification with the diagnostic report link.
 * Fire-and-forget: errors are logged but don't affect the result.
 */
async function sendAdminEmailInBackground(
  supabase: any,
  authState: any,
  submission: FeedbackSubmission,
  diagnosticReportUrl: string,
  issueNumber?: number
): Promise<void> {
  try {
    const userEmail = authState.user?.email || 'unknown';
    const accessToken = authState.session.access_token;

    const summaryParts: string[] = [];
    if (issueNumber) summaryParts.push(`GitHub Issue #${issueNumber}`);
    summaryParts.push(`Type: ${submission.type}`);
    summaryParts.push(`Title: ${submission.title}`);

    await supabase.functions.invoke('send-diagnostic-email', {
      body: {
        reportId: `support_issue_${issueNumber || 'unknown'}`,
        userEmail,
        platform: `${process.platform} ${process.arch}`,
        appVersion: app.getVersion(),
        storagePath: '',
        signedUrl: diagnosticReportUrl,
        summary: summaryParts.join('\n') || 'No issues detected',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    console.log('[Support] Admin email notification sent');
  } catch (emailError: any) {
    console.warn('[Support] Email notification failed (non-critical):', emailError.message);
  }
}
