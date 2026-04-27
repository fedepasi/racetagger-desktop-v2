/**
 * Centralized Logging System
 *
 * Provides structured logging with levels to reduce noise and improve visibility.
 *
 * Log Levels:
 * - ERROR (0): Critical errors that stop processing
 * - WARN  (1): Warnings that don't stop processing
 * - INFO  (2): Important milestones and macro flow (DEFAULT)
 * - DEBUG (3): Detailed debug information
 * - TRACE (4): Very verbose, step-by-step details
 *
 * Usage:
 *   import { logger } from './utils/logger';
 *   logger.info('Processing', 'Started batch of 58 images');
 *   logger.debug('Processing', 'Image details', { fileName, size });
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

// Parse log level from environment or default to INFO
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  switch (envLevel) {
    case 'ERROR': return LogLevel.ERROR;
    case 'WARN': return LogLevel.WARN;
    case 'INFO': return LogLevel.INFO;
    case 'DEBUG': return LogLevel.DEBUG;
    case 'TRACE': return LogLevel.TRACE;
    default: return LogLevel.INFO;
  }
}

// Emoji prefixes for visual clarity
const LEVEL_PREFIXES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: '\u274C',  // Red X
  [LogLevel.WARN]: '\u26A0\uFE0F',   // Warning
  [LogLevel.INFO]: '\u2139\uFE0F',   // Info
  [LogLevel.DEBUG]: '\uD83D\uDD0D',  // Magnifying glass
  [LogLevel.TRACE]: '\uD83D\uDCDD'   // Memo
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.TRACE]: 'TRACE'
};

class Logger {
  private level: LogLevel;
  private componentFilter: string | null = null;

  constructor() {
    this.level = getLogLevel();
  }

  /**
   * Set the current log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Filter logs to only show specific component
   */
  setComponentFilter(component: string | null): void {
    this.componentFilter = component;
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, component: string, message: string, data?: any): void {
    if (level > this.level) return;
    if (this.componentFilter && component !== this.componentFilter) return;

    const prefix = LEVEL_PREFIXES[level];
    const levelName = LEVEL_NAMES[level];
    const timestamp = new Date().toISOString().substr(11, 12); // HH:MM:SS.mmm

    const formatted = `${prefix} [${timestamp}] [${component}] ${message}`;

    if (data !== undefined) {
      if (level === LogLevel.ERROR) {
        console.error(formatted, data);
      } else if (level === LogLevel.WARN) {
        console.warn(formatted, data);
      }
      // Other log levels are silenced - use debug tools instead
    } else {
      if (level === LogLevel.ERROR) {
        console.error(formatted);
      } else if (level === LogLevel.WARN) {
        console.warn(formatted);
      }
      // Other log levels are silenced - use debug tools instead
    }
  }

  // Convenience methods
  error(component: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, component, message, data);
  }

  warn(component: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, component, message, data);
  }

  info(component: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, component, message, data);
  }

  debug(component: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, component, message, data);
  }

  trace(component: string, message: string, data?: any): void {
    this.log(LogLevel.TRACE, component, message, data);
  }

  /**
   * Log a milestone (always shown at INFO level) with clear visual separator
   */
  milestone(component: string, message: string): void {
    // Milestones are silenced - use debug tools for milestone tracking
  }

  /**
   * Log processing progress (compact format)
   */
  progress(component: string, current: number, total: number, item?: string): void {
    // Progress logs are silenced - use debug tools for progress tracking
  }

  /**
   * Log a summary table
   */
  summary(component: string, title: string, data: Record<string, any>): void {
    // Summary logs are silenced - use debug tools for summary tracking
  }
}

// Singleton instance
export const logger = new Logger();

// Also export for backward compatibility - wrap console methods
export function createComponentLogger(component: string) {
  return {
    error: (msg: string, data?: any) => logger.error(component, msg, data),
    warn: (msg: string, data?: any) => logger.warn(component, msg, data),
    info: (msg: string, data?: any) => logger.info(component, msg, data),
    debug: (msg: string, data?: any) => logger.debug(component, msg, data),
    trace: (msg: string, data?: any) => logger.trace(component, msg, data),
    milestone: (msg: string) => logger.milestone(component, msg),
    progress: (current: number, total: number, item?: string) =>
      logger.progress(component, current, total, item),
    summary: (title: string, data: Record<string, any>) =>
      logger.summary(component, title, data)
  };
}
