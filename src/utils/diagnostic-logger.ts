/**
 * Diagnostic Logger
 *
 * Captures ALL main process console output to a rotating log file.
 * Enables remote diagnostic uploads for debugging issues on user machines.
 *
 * Features:
 * - Intercepts console.log/warn/error/info/debug in main process
 * - Writes to rotating log files (max 5MB, keeps last 2)
 * - Provides methods to read logs, get tail, and export full diagnostics
 * - Thread-safe write buffering with periodic flush
 *
 * Usage:
 *   import { diagnosticLogger } from './utils/diagnostic-logger';
 *   diagnosticLogger.initialize(); // Call ONCE at app startup, BEFORE any logging
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ==================== Constants ====================

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_LOG_FILES = 2; // Keep current + 1 rotated
const FLUSH_INTERVAL_MS = 2000; // Flush buffer every 2s
const MAX_BUFFER_SIZE = 100; // Flush when buffer reaches 100 entries
const MAX_LINE_LENGTH = 2000; // Truncate very long log lines

// ==================== Types ====================

interface LogEntry {
  ts: string;     // ISO timestamp
  level: string;  // LOG | WARN | ERROR | INFO | DEBUG
  msg: string;    // The log message
}

// ==================== DiagnosticLogger ====================

class DiagnosticLogger {
  private logDir: string = '';
  private logFile: string = '';
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private writeStream: fs.WriteStream | null = null;
  private currentSize = 0;

  // Store original console methods before overriding
  private originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  /**
   * Initialize the diagnostic logger.
   * MUST be called ONCE at app startup, BEFORE any significant logging.
   * After calling this, all console output is captured to file.
   */
  initialize(): void {
    if (this.initialized) return;

    try {
      // Create log directory in userData
      this.logDir = path.join(app.getPath('userData'), 'diagnostic-logs');
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }

      this.logFile = path.join(this.logDir, 'racetagger-main.log');

      // Check existing file size
      if (fs.existsSync(this.logFile)) {
        try {
          const stat = fs.statSync(this.logFile);
          this.currentSize = stat.size;
          // If existing file is already large, rotate before starting
          if (this.currentSize > MAX_LOG_SIZE) {
            this.rotateSync();
          }
        } catch {
          this.currentSize = 0;
        }
      }

      // Open write stream in append mode
      this.writeStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      this.writeStream.on('error', (err) => {
        // If write stream fails, don't crash the app
        this.originalConsole.error('[DiagnosticLogger] Write stream error:', err.message);
      });

      // Intercept console methods
      this.interceptConsole();

      // Start periodic flush
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

      // Write session start marker
      const sessionMarker = `\n${'='.repeat(80)}\n[SESSION START] ${new Date().toISOString()} | v${app.getVersion()} | ${process.platform} ${process.arch} | Electron ${process.versions.electron}\n${'='.repeat(80)}\n`;
      this.writeRaw(sessionMarker);

      this.initialized = true;
    } catch (error: any) {
      // DiagnosticLogger initialization failure should NEVER crash the app
      this.originalConsole.error('[DiagnosticLogger] Failed to initialize:', error.message);
    }
  }

  /**
   * Intercept all console methods to capture output to file.
   * Original console output is preserved (pass-through).
   */
  private interceptConsole(): void {
    const self = this;

    console.log = function (...args: any[]) {
      self.originalConsole.log(...args);
      self.capture('LOG', args);
    };

    console.warn = function (...args: any[]) {
      self.originalConsole.warn(...args);
      self.capture('WARN', args);
    };

    console.error = function (...args: any[]) {
      self.originalConsole.error(...args);
      self.capture('ERROR', args);
    };

    console.info = function (...args: any[]) {
      self.originalConsole.info(...args);
      self.capture('INFO', args);
    };

    console.debug = function (...args: any[]) {
      self.originalConsole.debug(...args);
      self.capture('DEBUG', args);
    };
  }

  /**
   * Capture a log entry to the buffer.
   */
  private capture(level: string, args: any[]): void {
    try {
      const timestamp = new Date().toISOString();
      let message = args.map(arg => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg, null, 0);
        } catch {
          return String(arg);
        }
      }).join(' ');

      // Truncate very long lines
      if (message.length > MAX_LINE_LENGTH) {
        message = message.substring(0, MAX_LINE_LENGTH) + '... [TRUNCATED]';
      }

      const line = `[${timestamp}] [${level.padEnd(5)}] ${message}\n`;
      this.buffer.push(line);

      // Flush if buffer is full
      if (this.buffer.length >= MAX_BUFFER_SIZE) {
        this.flush();
      }
    } catch {
      // Never crash the app due to logging
    }
  }

  /**
   * Write raw text directly to the log file.
   */
  private writeRaw(text: string): void {
    try {
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.write(text);
        this.currentSize += Buffer.byteLength(text, 'utf-8');
      }
    } catch {
      // Silently ignore write errors
    }
  }

  /**
   * Flush the buffer to the log file.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    try {
      const chunk = this.buffer.join('');
      this.buffer = [];

      // Check if rotation is needed
      const chunkSize = Buffer.byteLength(chunk, 'utf-8');
      if (this.currentSize + chunkSize > MAX_LOG_SIZE) {
        this.rotate();
      }

      this.writeRaw(chunk);
    } catch {
      // Never crash due to flush errors
      this.buffer = [];
    }
  }

  /**
   * Rotate log files synchronously (used during init).
   */
  private rotateSync(): void {
    try {
      const rotated = this.logFile + '.1';
      // Remove oldest rotated file
      const oldest = this.logFile + `.${MAX_LOG_FILES}`;
      if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest);
      }
      // Rename current rotated to .2
      if (fs.existsSync(rotated)) {
        const nextRotated = this.logFile + '.2';
        try { fs.unlinkSync(nextRotated); } catch { /* ok */ }
        fs.renameSync(rotated, nextRotated);
      }
      // Rename current to .1
      if (fs.existsSync(this.logFile)) {
        fs.renameSync(this.logFile, rotated);
      }
      this.currentSize = 0;
    } catch {
      // If rotation fails, just truncate
      try { fs.writeFileSync(this.logFile, ''); } catch { /* ok */ }
      this.currentSize = 0;
    }
  }

  /**
   * Rotate log files (close stream, rename, open new).
   */
  private rotate(): void {
    try {
      // Close current stream
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }

      this.rotateSync();

      // Reopen write stream
      this.writeStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      this.writeStream.on('error', () => { /* silent */ });
    } catch {
      // If rotation fails entirely, try to continue writing
      try {
        this.writeStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      } catch { /* ok */ }
    }
  }

  // ==================== Public API ====================

  /**
   * Read the last N lines from the log file.
   * Returns most recent log entries.
   */
  getRecentLogs(maxLines: number = 500): string {
    this.flush(); // Ensure buffer is written first

    try {
      if (!fs.existsSync(this.logFile)) return '';

      const content = fs.readFileSync(this.logFile, 'utf-8');
      const lines = content.split('\n');
      const tail = lines.slice(-maxLines).join('\n');
      return tail;
    } catch (error: any) {
      return `[Error reading logs: ${error.message}]`;
    }
  }

  /**
   * Read ALL log files (current + rotated) for full diagnostic export.
   */
  getFullLogs(): string {
    this.flush();

    try {
      const parts: string[] = [];

      // Read rotated files first (oldest to newest)
      for (let i = MAX_LOG_FILES; i >= 1; i--) {
        const rotatedFile = this.logFile + `.${i}`;
        if (fs.existsSync(rotatedFile)) {
          try {
            parts.push(`\n--- Rotated log file .${i} ---\n`);
            parts.push(fs.readFileSync(rotatedFile, 'utf-8'));
          } catch { /* skip unreadable files */ }
        }
      }

      // Read current file
      if (fs.existsSync(this.logFile)) {
        parts.push('\n--- Current log file ---\n');
        parts.push(fs.readFileSync(this.logFile, 'utf-8'));
      }

      return parts.join('');
    } catch (error: any) {
      return `[Error reading full logs: ${error.message}]`;
    }
  }

  /**
   * Get the log directory path.
   */
  getLogDirectory(): string {
    return this.logDir;
  }

  /**
   * Get the current log file path.
   */
  getLogFilePath(): string {
    return this.logFile;
  }

  /**
   * Get log file sizes for diagnostics.
   */
  getLogStats(): { currentSize: number; totalSize: number; fileCount: number } {
    try {
      let totalSize = 0;
      let fileCount = 0;

      if (fs.existsSync(this.logFile)) {
        totalSize += fs.statSync(this.logFile).size;
        fileCount++;
      }
      for (let i = 1; i <= MAX_LOG_FILES; i++) {
        const rotated = this.logFile + `.${i}`;
        if (fs.existsSync(rotated)) {
          totalSize += fs.statSync(rotated).size;
          fileCount++;
        }
      }

      return { currentSize: this.currentSize, totalSize, fileCount };
    } catch {
      return { currentSize: 0, totalSize: 0, fileCount: 0 };
    }
  }

  /**
   * Clean up resources on app quit.
   */
  shutdown(): void {
    try {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
      this.flush();
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }
    } catch {
      // Shutdown should never throw
    }
  }
}

// ==================== Singleton ====================

export const diagnosticLogger = new DiagnosticLogger();
