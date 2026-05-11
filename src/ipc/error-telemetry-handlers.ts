/**
 * Error Telemetry IPC Handlers
 *
 * Provides IPC interface for the Error Telemetry system:
 * - get-telemetry-status: Query service state (queue, daily count, enabled)
 * - set-telemetry-enabled: Toggle opt-out
 * - flush-telemetry-queue: Force send queued reports (admin/debug)
 * - report-renderer-error: Renderer-initiated error report (fire-and-forget)
 *
 * Total: 4 handlers
 */

import { createHandler } from './handler-factory';
import {
  errorTelemetryService,
  ErrorType,
  ErrorSeverity
} from '../utils/error-telemetry-service';

interface RendererErrorPayload {
  errorType: ErrorType;
  severity?: ErrorSeverity;
  errorMessage: string;
  errorStack?: string;
  batchPhase?: string;
  presetName?: string;
  categoryName?: string;
}

/**
 * Register all error telemetry handlers
 */
export function registerErrorTelemetryHandlers(): void {
  console.log('[IPC] Registering error telemetry handlers...');

  // Get telemetry service status
  createHandler<void, { queued: number; sentToday: number; enabled: boolean }>(
    'get-telemetry-status',
    () => {
      return errorTelemetryService.getStatus();
    }
  );

  // Toggle telemetry enabled/disabled (opt-out)
  createHandler<boolean, { enabled: boolean }>(
    'set-telemetry-enabled',
    (enabled: boolean) => {
      errorTelemetryService.setEnabled(enabled);
      return { enabled };
    }
  );

  // Force flush the telemetry queue (for admin/debug)
  createHandler<void, { flushed: boolean }>(
    'flush-telemetry-queue',
    () => {
      errorTelemetryService.forceFlush();
      return { flushed: true };
    }
  );

  // Renderer-initiated error report — fire-and-forget from UI catch blocks
  createHandler<RendererErrorPayload, { queued: boolean }>(
    'report-renderer-error',
    (payload) => {
      if (!payload || !payload.errorType || !payload.errorMessage) {
        return { queued: false };
      }
      const err = new Error(payload.errorMessage);
      if (payload.errorStack) err.stack = payload.errorStack;
      errorTelemetryService.reportCriticalError({
        errorType: payload.errorType,
        severity: payload.severity || 'recoverable',
        error: err,
        batchPhase: payload.batchPhase,
        presetName: payload.presetName,
        categoryName: payload.categoryName
      });
      return { queued: true };
    }
  );

  console.log('[IPC] ✅ Error telemetry handlers registered (4 handlers)');
}
