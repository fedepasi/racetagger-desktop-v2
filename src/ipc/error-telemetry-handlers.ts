/**
 * Error Telemetry IPC Handlers
 *
 * Provides IPC interface for the Error Telemetry system:
 * - get-telemetry-status: Query service state (queue, daily count, enabled)
 * - set-telemetry-enabled: Toggle opt-out
 * - flush-telemetry-queue: Force send queued reports (admin/debug)
 *
 * Total: 3 handlers
 */

import { createHandler } from './handler-factory';
import { errorTelemetryService } from '../utils/error-telemetry-service';

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

  console.log('[IPC] ✅ Error telemetry handlers registered (3 handlers)');
}
