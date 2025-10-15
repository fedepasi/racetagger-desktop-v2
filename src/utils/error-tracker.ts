/**
 * Error Tracker Utility
 * Centralized error tracking with categorization and recovery tracking
 *
 * BACKWARD COMPATIBLE: All methods are safe and won't throw errors
 */

export type ErrorSeverity = 'fatal' | 'recoverable' | 'warning';
export type ErrorCategory = 'network' | 'disk' | 'memory' | 'ai' | 'filesystem' | 'database' | 'unknown';

export interface ErrorEvent {
  timestamp: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  stack?: string;
  phase?: string;
  file_path?: string;
  image_id?: string;
  recovery_attempted: boolean;
  recovery_successful: boolean;
  context?: Record<string, any>;
}

export interface ErrorSummary {
  total_errors: number;
  by_category: Record<ErrorCategory, number>;
  by_severity: Record<ErrorSeverity, number>;
  fatal_errors: ErrorEvent[];
  recent_errors: ErrorEvent[];
}

/**
 * Error Tracker Class
 * Tracks and categorizes errors during execution
 */
export class ErrorTracker {
  private errors: ErrorEvent[] = [];
  private maxStoredErrors = 100; // Keep last 100 errors in memory

  /**
   * Track an error with automatic categorization
   */
  trackError(
    error: Error | string,
    severity: ErrorSeverity,
    category?: ErrorCategory,
    context?: {
      phase?: string;
      filePath?: string;
      imageId?: string;
      recoveryAttempted?: boolean;
      recoverySuccessful?: boolean;
      additionalInfo?: Record<string, any>;
    }
  ): void {
    try {
      const errorMessage = typeof error === 'string' ? error : error.message;
      const errorStack = typeof error === 'string' ? undefined : error.stack;

      // Auto-categorize if not provided
      const finalCategory = category || this.categorizeError(errorMessage, errorStack);

      const errorEvent: ErrorEvent = {
        timestamp: new Date().toISOString(),
        severity,
        category: finalCategory,
        message: errorMessage,
        stack: errorStack,
        phase: context?.phase,
        file_path: context?.filePath,
        image_id: context?.imageId,
        recovery_attempted: context?.recoveryAttempted || false,
        recovery_successful: context?.recoverySuccessful || false,
        context: context?.additionalInfo
      };

      this.errors.push(errorEvent);

      // Keep memory usage under control
      if (this.errors.length > this.maxStoredErrors) {
        this.errors = this.errors.slice(-this.maxStoredErrors);
      }

      // Log to console based on severity
      if (severity === 'fatal') {
        console.error(`[ErrorTracker] FATAL ERROR (${finalCategory}):`, errorMessage);
      } else if (severity === 'recoverable') {
        console.warn(`[ErrorTracker] RECOVERABLE ERROR (${finalCategory}):`, errorMessage);
      } else {
        console.log(`[ErrorTracker] Warning (${finalCategory}):`, errorMessage);
      }
    } catch (trackingError) {
      // Error tracking should never throw
      console.error('[ErrorTracker] Failed to track error:', trackingError);
    }
  }

  /**
   * Auto-categorize error based on message and stack trace
   */
  private categorizeError(message: string, stack?: string): ErrorCategory {
    const lowerMessage = message.toLowerCase();
    const lowerStack = stack?.toLowerCase() || '';

    // Network errors
    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('fetch') ||
      lowerMessage.includes('upload') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerStack.includes('supabase')
    ) {
      return 'network';
    }

    // Disk/filesystem errors
    if (
      lowerMessage.includes('enoent') ||
      lowerMessage.includes('eacces') ||
      lowerMessage.includes('eperm') ||
      lowerMessage.includes('enospc') ||
      lowerMessage.includes('disk') ||
      lowerMessage.includes('file system') ||
      lowerMessage.includes('read') && lowerMessage.includes('file') ||
      lowerMessage.includes('write') && lowerMessage.includes('file')
    ) {
      return 'filesystem';
    }

    // Memory errors
    if (
      lowerMessage.includes('memory') ||
      lowerMessage.includes('heap') ||
      lowerMessage.includes('out of memory') ||
      lowerMessage.includes('allocation failed')
    ) {
      return 'memory';
    }

    // AI/Analysis errors
    if (
      lowerMessage.includes('ai') ||
      lowerMessage.includes('gemini') ||
      lowerMessage.includes('openai') ||
      lowerMessage.includes('analysis') ||
      lowerMessage.includes('vision') ||
      lowerStack.includes('analyze')
    ) {
      return 'ai';
    }

    // Database errors
    if (
      lowerMessage.includes('database') ||
      lowerMessage.includes('sql') ||
      lowerMessage.includes('postgres') ||
      lowerMessage.includes('query') ||
      lowerStack.includes('database-service')
    ) {
      return 'database';
    }

    return 'unknown';
  }

  /**
   * Get error summary for reporting
   */
  getErrorSummary(): ErrorSummary {
    try {
      const byCategory: Record<ErrorCategory, number> = {
        network: 0,
        disk: 0,
        memory: 0,
        ai: 0,
        filesystem: 0,
        database: 0,
        unknown: 0
      };

      const bySeverity: Record<ErrorSeverity, number> = {
        fatal: 0,
        recoverable: 0,
        warning: 0
      };

      const fatalErrors: ErrorEvent[] = [];

      this.errors.forEach(error => {
        byCategory[error.category]++;
        bySeverity[error.severity]++;

        if (error.severity === 'fatal') {
          fatalErrors.push(error);
        }
      });

      // Get last 10 errors
      const recentErrors = this.errors.slice(-10);

      return {
        total_errors: this.errors.length,
        by_category: byCategory,
        by_severity: bySeverity,
        fatal_errors: fatalErrors,
        recent_errors: recentErrors
      };
    } catch (error) {
      console.error('[ErrorTracker] Failed to generate error summary:', error);
      return this.getEmptySummary();
    }
  }

  /**
   * Get empty summary (fallback)
   */
  private getEmptySummary(): ErrorSummary {
    return {
      total_errors: 0,
      by_category: {
        network: 0,
        disk: 0,
        memory: 0,
        ai: 0,
        filesystem: 0,
        database: 0,
        unknown: 0
      },
      by_severity: {
        fatal: 0,
        recoverable: 0,
        warning: 0
      },
      fatal_errors: [],
      recent_errors: []
    };
  }

  /**
   * Get all errors (for detailed analysis)
   */
  getAllErrors(): ErrorEvent[] {
    return [...this.errors];
  }

  /**
   * Get errors by category
   */
  getErrorsByCategory(category: ErrorCategory): ErrorEvent[] {
    return this.errors.filter(e => e.category === category);
  }

  /**
   * Get errors by severity
   */
  getErrorsBySeverity(severity: ErrorSeverity): ErrorEvent[] {
    return this.errors.filter(e => e.severity === severity);
  }

  /**
   * Check if there are any fatal errors
   */
  hasFatalErrors(): boolean {
    return this.errors.some(e => e.severity === 'fatal');
  }

  /**
   * Get count of errors
   */
  getErrorCount(): number {
    return this.errors.length;
  }

  /**
   * Reset error tracking (useful for new execution)
   */
  reset(): void {
    this.errors = [];
  }

  /**
   * Get human-readable summary string
   */
  getSummaryString(): string {
    const summary = this.getErrorSummary();

    if (summary.total_errors === 0) {
      return 'No errors';
    }

    const parts: string[] = [
      `${summary.total_errors} error${summary.total_errors > 1 ? 's' : ''}`
    ];

    if (summary.by_severity.fatal > 0) {
      parts.push(`${summary.by_severity.fatal} fatal`);
    }
    if (summary.by_severity.recoverable > 0) {
      parts.push(`${summary.by_severity.recoverable} recoverable`);
    }
    if (summary.by_severity.warning > 0) {
      parts.push(`${summary.by_severity.warning} warning${summary.by_severity.warning > 1 ? 's' : ''}`);
    }

    // Add top category
    const topCategory = Object.entries(summary.by_category)
      .filter(([_, count]) => count > 0)
      .sort(([_, a], [__, b]) => b - a)[0];

    if (topCategory) {
      parts.push(`(mostly ${topCategory[0]})`);
    }

    return parts.join(', ');
  }
}

/**
 * Singleton instance for easy access
 */
export const errorTracker = new ErrorTracker();
