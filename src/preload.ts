import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Whitelist of channels to expose to the renderer process
// We separate send/receive and invoke channels for clarity, though some might overlap
const validSendReceiveChannels: string[] = [
  'auth-status', 
  'login-result', 
  'register-result', 
  'logout-result',
  'token-balance',
  'pending-tokens',
  'subscription-info',
  'auth-error',
  'upload-progress', 'analysis-result', 'upload-error', 'token-used',
  'folder-selected', 'folder-error',
  'csv-loaded', 'csv-error',
  'csv-template-saved',
  'batch-progress', 'image-processed', 'batch-complete', 'parallel-stats',
  'feedback-saved', 'feedback-error',
  'access-code-status',
  'access-code-verified',
  // Canali per gestione anteprime RAW
  'raw-preview-status', 'raw-preview-extracted', 'raw-preview-error',
  // Pipeline telemetry channels
  'pipeline-stats-update', 'pipeline-started', 'pipeline-completed',
  // Enhanced processing channels
  'enhanced-processing-start', 'enhanced-processing-update-image', 
  'enhanced-processing-complete-image', 'enhanced-processing-fail-image', 
  'enhanced-processing-complete',
  // General processing channels
  'processing-started', 'processing-progress', 'processing-file-started',
  'processing-phase-changed', 'processing-completed', 'processing-error',
  'processing-paused', 'processing-resumed',
  // Cancellation channels
  'cancel-batch-processing', 'batch-cancelled',
  // Window control events are typically send-only from renderer or receive-only
  // but for simplicity, we can list them here if they are used in `receive`
  // Category and auth refresh channels
  'categories-updated',
  'auth-refresh-completed',
  // Face Detection IPC channels (main -> renderer -> main)
  'face-detection-request', 'face-detection-response',
  'face-detection-single-request', 'face-detection-single-response',
  'face-descriptor-request', 'face-descriptor-response',
  // Export Destinations progress channels
  'export-started',
  'export-progress',
];

const validInvokeChannels: string[] = [
  // Auth
  'check-auth-status', // Technically send/receive but can be invoke
  'login',
  'register',
  'logout',
  'continue-demo',
  'get-token-balance',
  'get-pending-tokens',
  'get-token-info',
  'force-token-refresh',
  'get-subscription-info',
  'get-is-packaged',
  'open-subscription-page',
  'open-external-url',
  'submit-token-request',
  // Version Control
  'check-app-version',
  'get-version-check-result',
  'is-force-update-required',
  'get-app-version',
  'open-download-url',
  'quit-app-for-update',
  // Image/File Operations
  'analyze-image',
  'select-folder',
  'load-csv',
  'download-csv-template',
  'analyze-folder',
  'extract-raw-preview',
  // Enhanced File Browser Operations
  'dialog-show-open',
  'show-save-dialog',  // Export preset - file save dialog
  'write-file',        // Export preset - write JSON file
  'get-folder-files',
  'get-file-stats',
  'generate-thumbnail',
  'get-local-image',
  'get-supabase-image-url',
  // Feedback
  'submit-feedback',
  // Access Code
  'check-access-code',
  'verify-access-code',
  'open-early-access',
  // Adobe DNG Converter
  'check-adobe-dng-converter',
  // Window Controls (if any are invoked, usually they are `send`)
  'window-close', 
  'window-minimize', 
  'window-maximize',
  // Database Operations
  'db-create-project',
  'db-get-project-by-id',
  'db-get-all-projects',
  'db-update-project',
  'db-delete-project',
  'db-create-execution',
  'db-get-executions-by-project-id',
  'db-get-execution-by-id',
  'db-update-execution',
  'db-delete-execution',
  'db-get-recent-projects',
  'list-files-in-folder',
  'count-folder-images',
  // Home Page Statistics
  'get-home-statistics',
  'get-recent-executions',
  'get-user-info',
  // Folder Organization (Admin Feature)
  'check-folder-organization-enabled',
  'get-folder-organization-config',
  'select-organization-destination',
  'organize-results-post-analysis',

  // Supabase Operations
  'supabase-get-sport-categories',
  'supabase-get-sport-category-by-code',
  'supabase-get-cached-sport-categories',
  'supabase-refresh-categories-cache',
  'supabase-create-participant-preset',
  'supabase-get-participant-presets',
  'supabase-get-participant-preset-by-id',
  'supabase-save-preset-participants',
  'supabase-update-participant-preset',
  'supabase-update-preset-last-used',
  'supabase-delete-participant-preset',
  'supabase-import-participants-from-csv',
  'supabase-get-cached-participant-presets',
  'supabase-get-all-participant-presets-admin',
  'supabase-cache-data',
  'supabase-is-feature-enabled',
  'auth-is-admin',

  // Database Operations - Participant Presets
  'db-create-participant-preset',
  'db-get-participant-presets',
  'db-get-participant-preset-by-id',
  'db-save-preset-participants',
  'db-update-preset-last-used',
  'db-delete-participant-preset',
  'db-import-participants-from-csv',

  // Log Visualizer Operations
  'get-execution-log',
  'get-analysis-log',
  'update-analysis-log',

  // Local Thumbnail Operations
  'find-local-thumbnails',

  // Face Recognition Operations
  'face-recognition-initialize',
  'face-recognition-load-descriptors',
  'face-recognition-match',
  'face-recognition-status',
  'face-recognition-clear',
  'face-recognition-load-from-database',
  'get-app-path',

  // User Settings & Consent
  'get-full-settings',
  'get-training-consent',
  'set-training-consent',
  'get-consent-status',

  // Export Destinations Operations
  'export-destinations-create',
  'export-destinations-get-all',
  'export-destinations-get-active',
  'export-destinations-get-by-id',
  'export-destinations-get-default',
  'export-destinations-update',
  'export-destinations-delete',
  'export-destinations-set-default',
  'export-destinations-duplicate',
  'export-destinations-update-order',
  'export-destinations-toggle-active',
  'export-destinations-get-matching',
  'export-to-destinations',  // Export images to configured destinations
];


contextBridge.exposeInMainWorld('api', {
  send: (channel: string, data?: any) => {
    // For `send`, we typically use channels that expect a response via `receive` or fire-and-forget
    // For operations expecting a direct Promise response, `invoke` is better.
    // We'll check against invokeChannels as they are more comprehensive for actions.
    if (validInvokeChannels.includes(channel) || validSendReceiveChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`Attempted to send to an invalid channel: ${channel}`);
    }
  },
  receive: (channel: string, func: (...args: any[]) => void) => {
    if (validSendReceiveChannels.includes(channel)) {
      const listener = (event: IpcRendererEvent, ...args: any[]) => func(...args);
      ipcRenderer.on(channel, listener);
      
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    } else {
      console.warn(`Attempted to listen on an invalid channel: ${channel}`);
      return () => {};
    }
  },
  invoke: (channel: string, ...args: any[]): Promise<any> => {
    if (validInvokeChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    } else {
      console.warn(`Attempted to invoke an invalid channel: ${channel}`);
      return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
    }
  },
  removeListener: (channel: string, func: (...args: any[]) => void) => {
    if (validSendReceiveChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, func as (event: IpcRendererEvent, ...args: any[]) => void);
    } else {
      console.warn(`Attempted to remove listener from an invalid channel: ${channel}`);
    }
  },
  removeAllListeners: (channel: string) => {
    if (validSendReceiveChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    } else {
      console.warn(`Attempted to remove all listeners from an invalid channel: ${channel}`);
    }
  }
});

// --- CONSOLE LOGGING DISABLE FOR PRODUCTION ---
(async () => {
  try {
    const isProd = await ipcRenderer.invoke('get-is-packaged');

    if (isProd) {
      // Create an empty console object
      const emptyConsole: any = {};
      const allConsoleMethods = ['log', 'warn', 'error', 'info', 'debug', 'trace'];

      allConsoleMethods.forEach(method => {
        emptyConsole[method] = () => {};
      });

      // Expose the empty console object to the renderer
      // This will override window.console in the renderer process
      contextBridge.exposeInMainWorld('console', emptyConsole);
    }
  } catch (error) {
    // In case of error, log to original console (before override)
    console.error('Error during console logging disable in preload:', error);
  }
})();

console.log('Preload script loaded and API exposed.');
