/**
 * Shared types for IPC handlers
 * Extracted from main.ts during refactoring
 */

import { BrowserWindow } from 'electron';

// ==================== CSV & Batch Processing ====================

export type CsvEntry = {
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  metatag: string;
  [key: string]: string | undefined;
};

export enum MetadataStrategy {
  XmpFullAnalysis = 'xmp_full_analysis',
  XmpCustomText = 'xmp_custom_text',
  XmpCsvData = 'xmp_csv_data',
  XmpRaceNumberOnly = 'xmp_race_number_only'
}

export type BatchProcessConfig = {
  folderPath: string;
  csvData?: CsvEntry[];
  updateExif: boolean;
  projectId?: string;
  executionName?: string;
  model?: string;
  category?: string;
  metadataStrategy?: MetadataStrategy;
  manualMetadataValue?: string;
  keywordsMode?: 'append' | 'overwrite';
  descriptionMode?: 'append' | 'overwrite';
  savePreviewImages?: boolean;
  previewFolder?: string;
  resize?: {
    enabled: boolean;
    preset: string;
  };
  useParallelProcessing?: boolean;
  useStreamingPipeline?: boolean;
  parallelization?: {
    maxConcurrentUploads?: number;
    maxConcurrentAnalysis?: number;
    rateLimitPerSecond?: number;
    batchSize?: number;
  };
  presetId?: string;
  presetName?: string;
  useSmartMatcher?: boolean;
  folderOrganization?: {
    enabled: boolean;
    destinationPath: string;
    strategy: 'by-number' | 'by-team' | 'by-category';
    createSubfolders: boolean;
  };
  exportDestinations?: string[];
};

// ==================== Version Check ====================

export interface VersionCheckResult {
  requires_update: boolean;
  force_update_enabled: boolean;
  update_message?: string;
  download_url?: string;
  urgency?: string;
  current_version?: string;
  minimum_version?: string;
  error?: string;
}

// ==================== Analysis Types ====================

export type VehicleAnalysis = {
  raceNumber: string | null;
  drivers: string[];
  category: string | null;
  teamName: string | null;
  otherText: string[];
  confidence: number;
};

// ==================== Handler Result Types ====================

export type HandlerSuccess<T> = {
  success: true;
  data: T;
};

export type HandlerError = {
  success: false;
  error: string;
};

export type HandlerResult<T> = HandlerSuccess<T> | HandlerError;

// ==================== File Extensions ====================

export const RAW_EXTENSIONS = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
export const STANDARD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const ALL_SUPPORTED_EXTENSIONS = [...STANDARD_EXTENSIONS, ...RAW_EXTENSIONS];

// ==================== Support Feedback System ====================

export interface SystemDiagnostics {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cpuCores: number;
  cpuThreads: number;
  ramTotal: number;
  ramAvailable: number;
  gpu?: string;
  diskType: string;
  diskAvailable: number;
  diskTotal: number;
}

export interface DependencyStatus {
  name: string;
  path?: string;
  exists: boolean;
  working: boolean;
  native?: boolean;
  error?: string;
}

export interface FeedbackSubmission {
  type: 'bug' | 'feature' | 'general';
  title: string;
  description: string;
  includeDiagnostics: boolean;
  diagnostics?: {
    system: SystemDiagnostics;
    dependencies: DependencyStatus[];
    recentErrors: Array<{ message: string; category: string; severity: string; timestamp: string }>;
  };
}

export interface FeedbackResult {
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}
