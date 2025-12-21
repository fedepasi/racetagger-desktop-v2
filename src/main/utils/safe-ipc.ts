/**
 * Safe IPC Utilities
 * Provides safe message sending utilities with error handling
 */

import { BrowserWindow } from 'electron';

// Reference to main window - set by main.ts
let mainWindowRef: BrowserWindow | null = null;

/**
 * Set the main window reference
 */
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindowRef = window;
}

/**
 * Get the main window reference
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef;
}

/**
 * Safe IPC message sending utility
 * Checks if window exists and is not destroyed before sending
 */
export function safeSend(channel: string, ...args: any[]): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    console.log(`[Main Process] Sending IPC event: ${channel} with data:`, args);
    mainWindowRef.webContents.send(channel, ...args);
  } else {
    console.warn(`[Main Process] Cannot send IPC event ${channel} - mainWindow unavailable`);
  }
}

/**
 * Safe IPC message sending utility with event sender fallback
 * Tries to send to the event sender first, falls back to main window
 */
export function safeSendToSender(eventSender: any, channel: string, ...args: any[]): void {
  try {
    if (eventSender && !eventSender.isDestroyed()) {
      eventSender.send(channel, ...args);
    }
  } catch (error) {
    // Fallback to main window if event sender fails
    safeSend(channel, ...args);
  }
}

/**
 * Safe console error handler to prevent EPIPE errors from crashing the app
 */
export function safeConsoleError(...args: any[]): void {
  try {
    console.error(...args);
  } catch (error) {
    // If console.error fails (EPIPE), try process.stderr directly
    try {
      process.stderr.write(`[ERROR] ${args.join(' ')}\n`);
    } catch {
      // If all else fails, silently ignore to prevent crashes
    }
  }
}

/**
 * Setup EPIPE error handlers for process stdout/stderr
 */
export function setupEpipeHandlers(): void {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      return;
    }
    throw error;
  });

  process.stderr.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      return;
    }
    throw error;
  });
}
