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
  /**
   * When set, this run RESUMES an interrupted execution instead of creating a new one:
   * the same execution id is reused, already-analyzed images (read from the existing local
   * JSONL) are skipped, and ONLY the remaining images are processed and charged. The local
   * JSONL is appended to (not overwritten) and finalized so the result covers the full set.
   */
  resumeExecutionId?: string;
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

// ==================== Preset Participants (single-row persist, BUG-02) ====================

/**
 * Payload for the `supabase-upsert-preset-participant` channel — one participant
 * row persisted immediately from the participant editor ("Save & Next" / "Save
 * Changes"). Field set mirrors the per-row mapping built in
 * participants-manager.js → buildParticipantSavePayload(), which in turn mirrors
 * savePreset's bulk mapping field-for-field (the two MUST stay in lockstep).
 *
 * `id` present → upsert (UPDATE the existing row by primary key).
 * `id` absent  → insert (Postgres assigns a fresh uuid; FIX #78 applies).
 */
export interface SinglePresetParticipantPayload {
  id?: string;
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  plate_number?: string;
  sponsor?: string;
  metatag?: string;
  // 1.2.0 canonical folder array — drives the dual-write at the DB layer.
  folders?: { name: string; path?: string }[];
  include_default_folder?: boolean;
  // Legacy folder slots — only forwarded when folders[] is absent.
  folder_1?: string;
  folder_2?: string;
  folder_3?: string;
  folder_1_path?: string;
  folder_2_path?: string;
  folder_3_path?: string;
  delivery_to_client_id?: string | null;
  is_active?: boolean;
}

export interface UpsertPresetParticipantParams {
  presetId: string;
  participant: SinglePresetParticipantPayload;
}

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
