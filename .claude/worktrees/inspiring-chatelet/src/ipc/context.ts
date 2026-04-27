/**
 * IPC Handler Context
 *
 * Provides shared state and utilities for all IPC handlers.
 * This centralizes access to mainWindow, global data, and common utilities.
 */

import { BrowserWindow } from 'electron';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, DEBUG_MODE } from '../config';
import { CsvEntry, BatchProcessConfig, VersionCheckResult } from './types';

// ==================== State ====================

let _mainWindow: BrowserWindow | null = null;
let _globalCsvData: CsvEntry[] = [];
let _batchConfig: BatchProcessConfig | null = null;
let _versionCheckResult: VersionCheckResult | null = null;
let _forceUpdateRequired = false;
let _batchProcessingCancelled = false;
let _supabase: SupabaseClient | null = null;

// Cache for Supabase image URLs
const _supabaseImageUrlCache = new Map<string, string>();

// ==================== Getters/Setters ====================

export function getMainWindow(): BrowserWindow | null {
  return _mainWindow;
}

export function setMainWindow(window: BrowserWindow | null): void {
  _mainWindow = window;
}

export function getGlobalCsvData(): CsvEntry[] {
  return _globalCsvData;
}

export function setGlobalCsvData(data: CsvEntry[]): void {
  _globalCsvData = data;
}

export function getBatchConfig(): BatchProcessConfig | null {
  return _batchConfig;
}

export function setBatchConfig(config: BatchProcessConfig | null): void {
  _batchConfig = config;
}

export function getVersionCheckResult(): VersionCheckResult | null {
  return _versionCheckResult;
}

export function setVersionCheckResult(result: VersionCheckResult | null): void {
  _versionCheckResult = result;
}

export function isForceUpdateRequired(): boolean {
  return _forceUpdateRequired;
}

export function setForceUpdateRequired(required: boolean): void {
  _forceUpdateRequired = required;
}

export function isBatchProcessingCancelled(): boolean {
  return _batchProcessingCancelled;
}

export function setBatchProcessingCancelled(cancelled: boolean): void {
  _batchProcessingCancelled = cancelled;
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
  }
  return _supabase;
}

export function getSupabaseImageUrlCache(): Map<string, string> {
  return _supabaseImageUrlCache;
}

// ==================== Utilities ====================

/**
 * Safe IPC message sending - checks if window exists and is not destroyed
 */
export function safeSend(channel: string, ...args: any[]): void {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(channel, ...args);
  } else if (DEBUG_MODE) {
    console.warn(`[IPC] Cannot send ${channel} - mainWindow unavailable`);
  }
}

/**
 * Safe IPC message sending with event sender fallback
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
 * Check if main window is available and not destroyed
 */
export function isMainWindowAvailable(): boolean {
  return _mainWindow !== null && !_mainWindow.isDestroyed();
}
