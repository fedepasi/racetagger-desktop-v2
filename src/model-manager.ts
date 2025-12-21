/**
 * Model Manager Service
 *
 * Manages ONNX model download, caching, and versioning for local inference.
 * Downloads models from Supabase Storage on-demand and caches them locally.
 *
 * Features:
 * - On-demand model download with progress tracking
 * - SHA256 checksum validation
 * - Local manifest tracking
 * - Automatic cache cleanup
 * - Version management
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwoqfgeviftmkxivtpkg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

/**
 * Model registry entry from database
 */
export interface ModelRegistryEntry {
  id: string;
  sport_category_id: string;
  version: string;
  onnx_storage_path: string;
  size_bytes: number;
  checksum_sha256: string;
  input_size: number[];
  confidence_threshold: number;
  iou_threshold: number;
  classes: string[];
  min_app_version: string | null;
  is_active: boolean;
  release_notes: string | null;
  created_at: string;
}

/**
 * Local manifest entry for tracking downloaded models
 */
interface LocalModelEntry {
  version: string;
  localPath: string;
  checksum: string;
  downloadedAt: string;
  sizeBytes: number;
  classes: string[];
  confidenceThreshold: number;
  iouThreshold: number;
  inputSize: number[];
}

/**
 * Local manifest for tracking all downloaded models
 */
interface LocalManifest {
  schemaVersion: number;
  models: {
    [categoryCode: string]: LocalModelEntry;
  };
  lastUpdated: string;
}

/**
 * Model status check result
 */
export interface ModelStatus {
  needsDownload: boolean;
  needsUpdate: boolean;
  localVersion: string | null;
  remoteVersion: string;
  sizeMB: number;
  localPath: string | null;
  classes: string[];
}

/**
 * Download progress callback
 */
export type DownloadProgressCallback = (
  percent: number,
  downloadedMB: number,
  totalMB: number
) => void;

/**
 * Model Manager Service
 * Singleton pattern for efficient resource management
 */
export class ModelManager {
  private static instance: ModelManager | null = null;
  private cacheDir: string;
  private manifest: LocalManifest;
  private supabase: SupabaseClient | null = null;

  private constructor() {
    // Cache in user data directory: ~/.racetagger/models/
    this.cacheDir = path.join(app.getPath('userData'), 'models');
    this.ensureCacheDir();
    this.manifest = this.loadManifest();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager();
    }
    return ModelManager.instance;
  }

  /**
   * Initialize Supabase client if needed
   */
  private getSupabase(): SupabaseClient {
    if (!this.supabase) {
      this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return this.supabase;
  }

  /**
   * Set authenticated Supabase client (called from main process with user session)
   */
  public setSupabaseClient(client: SupabaseClient): void {
    this.supabase = client;
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      console.log(`[ModelManager] Created cache directory: ${this.cacheDir}`);
    }
  }

  /**
   * Load local manifest from disk
   */
  private loadManifest(): LocalManifest {
    const manifestPath = path.join(this.cacheDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(content) as LocalManifest;
        console.log(`[ModelManager] Loaded manifest with ${Object.keys(manifest.models).length} models`);
        return manifest;
      } catch (error) {
        console.warn('[ModelManager] Failed to load manifest, creating new one:', error);
      }
    }

    return {
      schemaVersion: 1,
      models: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Save manifest to disk
   */
  private saveManifest(): void {
    const manifestPath = path.join(this.cacheDir, 'manifest.json');
    this.manifest.lastUpdated = new Date().toISOString();

    try {
      fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2));
      console.log('[ModelManager] Manifest saved');
    } catch (error) {
      console.error('[ModelManager] Failed to save manifest:', error);
    }
  }

  /**
   * Get model info from registry by category code
   */
  public async getModelFromRegistry(categoryCode: string): Promise<ModelRegistryEntry | null> {
    try {
      const supabase = this.getSupabase();
      console.log(`[ModelManager] Looking up category: ${categoryCode}`);

      // First get the category ID and use_local_onnx flag
      const { data: categoryData, error: categoryError } = await supabase
        .from('sport_categories')
        .select('id, active_model_id, use_local_onnx, recognition_method')
        .eq('code', categoryCode)
        .single();

      if (categoryError || !categoryData) {
        console.error(`[ModelManager] Category not found: ${categoryCode}`, categoryError);
        return null;
      }

      console.log(`[ModelManager] Category found:`, {
        id: categoryData.id,
        active_model_id: categoryData.active_model_id,
        use_local_onnx: categoryData.use_local_onnx,
        recognition_method: categoryData.recognition_method
      });

      // If category has an active_model_id set, use that directly
      if (categoryData.active_model_id) {
        console.log(`[ModelManager] Using active_model_id: ${categoryData.active_model_id}`);
        const { data, error } = await supabase
          .from('model_registry')
          .select('*')
          .eq('id', categoryData.active_model_id)
          .single();

        if (error) {
          console.error(`[ModelManager] Error fetching active model:`, error);
          return null;
        }

        console.log(`[ModelManager] Found active model:`, {
          version: data.version,
          onnx_storage_path: data.onnx_storage_path,
          is_active: data.is_active
        });
        return data as ModelRegistryEntry;
      }

      console.log(`[ModelManager] No active_model_id set, searching for any active model...`);

      // Otherwise, get any active model for this category
      const { data, error } = await supabase
        .from('model_registry')
        .select('*')
        .eq('sport_category_id', categoryData.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.error(`[ModelManager] Error fetching model for ${categoryCode}:`, error);
        console.log(`[ModelManager] Query was for sport_category_id: ${categoryData.id}`);
        return null;
      }

      console.log(`[ModelManager] Found fallback model:`, {
        version: data.version,
        onnx_storage_path: data.onnx_storage_path,
        is_active: data.is_active
      });
      return data as ModelRegistryEntry;
    } catch (error) {
      console.error('[ModelManager] Registry lookup failed:', error);
      return null;
    }
  }

  /**
   * Check if model needs download or update
   */
  public async checkModelStatus(categoryCode: string): Promise<ModelStatus> {
    const localModel = this.manifest.models[categoryCode];
    const remoteModel = await this.getModelFromRegistry(categoryCode);

    if (!remoteModel) {
      return {
        needsDownload: false,
        needsUpdate: false,
        localVersion: localModel?.version || null,
        remoteVersion: 'N/A',
        sizeMB: 0,
        localPath: localModel?.localPath || null,
        classes: localModel?.classes || [],
      };
    }

    const needsDownload = !localModel;
    // Check version AND classes - if classes changed online, we need to update manifest
    const versionChanged = localModel && localModel.version !== remoteModel.version;
    const classesChanged = localModel && JSON.stringify(localModel.classes) !== JSON.stringify(remoteModel.classes);
    const needsUpdate = versionChanged || classesChanged;

    if (classesChanged && !versionChanged) {
      console.log(`[ModelManager] Classes changed online for ${categoryCode}, will update manifest`);
    }
    const sizeMB = remoteModel.size_bytes / (1024 * 1024);

    return {
      needsDownload,
      needsUpdate,
      localVersion: localModel?.version || null,
      remoteVersion: remoteModel.version,
      sizeMB,
      localPath: localModel?.localPath || null,
      classes: remoteModel.classes || [],
    };
  }

  /**
   * Download model with progress tracking
   */
  public async downloadModel(
    categoryCode: string,
    onProgress?: DownloadProgressCallback
  ): Promise<string> {
    console.log(`[ModelManager] Downloading model for: ${categoryCode}`);

    // Get model info from registry
    const modelInfo = await this.getModelFromRegistry(categoryCode);
    if (!modelInfo) {
      throw new Error(`No active model found for category: ${categoryCode}`);
    }

    const totalBytes = modelInfo.size_bytes;
    const totalMB = totalBytes / (1024 * 1024);

    // Get signed URL from Supabase Storage
    const supabase = this.getSupabase();
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('onnx-models')
      .createSignedUrl(modelInfo.onnx_storage_path, 3600); // 1 hour expiry

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(`Failed to get download URL: ${signedUrlError?.message}`);
    }

    // Prepare local path
    const localPath = path.join(
      this.cacheDir,
      `${categoryCode}-v${modelInfo.version}.onnx`
    );

    // Download with progress
    console.log(`[ModelManager] Downloading from: ${signedUrlData.signedUrl.substring(0, 50)}...`);

    const response = await fetch(signedUrlData.signedUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloadedBytes += value.length;

      if (onProgress) {
        const percent = Math.round((downloadedBytes / totalBytes) * 100);
        const downloadedMB = downloadedBytes / (1024 * 1024);
        onProgress(percent, downloadedMB, totalMB);
      }
    }

    // Combine chunks and write to file
    const fileBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    fs.writeFileSync(localPath, fileBuffer);

    console.log(`[ModelManager] Downloaded ${fileBuffer.length} bytes to ${localPath}`);

    // Validate checksum
    const isValid = await this.validateChecksum(localPath, modelInfo.checksum_sha256);
    if (!isValid) {
      fs.unlinkSync(localPath);
      throw new Error('Model checksum validation failed - file may be corrupted');
    }

    console.log('[ModelManager] Checksum validated successfully');

    // Update manifest
    this.manifest.models[categoryCode] = {
      version: modelInfo.version,
      localPath,
      checksum: modelInfo.checksum_sha256,
      downloadedAt: new Date().toISOString(),
      sizeBytes: modelInfo.size_bytes,
      classes: modelInfo.classes || [],
      confidenceThreshold: modelInfo.confidence_threshold,
      iouThreshold: modelInfo.iou_threshold,
      inputSize: modelInfo.input_size,
    };
    this.saveManifest();

    return localPath;
  }

  /**
   * Validate file checksum
   */
  private async validateChecksum(filePath: string, expected: string): Promise<boolean> {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        const calculated = hash.digest('hex');
        const isValid = calculated === expected;
        if (!isValid) {
          console.error(`[ModelManager] Checksum mismatch: expected ${expected}, got ${calculated}`);
        }
        resolve(isValid);
      });
      stream.on('error', () => resolve(false));
    });
  }

  /**
   * Get local model path (null if not cached)
   */
  public getLocalModelPath(categoryCode: string): string | null {
    const localModel = this.manifest.models[categoryCode];
    if (!localModel) return null;

    // Verify file still exists
    if (!fs.existsSync(localModel.localPath)) {
      console.warn(`[ModelManager] Cached model file missing: ${localModel.localPath}`);
      delete this.manifest.models[categoryCode];
      this.saveManifest();
      return null;
    }

    return localModel.localPath;
  }

  /**
   * Get local model configuration
   */
  public getLocalModelConfig(categoryCode: string): LocalModelEntry | null {
    return this.manifest.models[categoryCode] || null;
  }

  /**
   * Get all cached models info
   */
  public getCacheInfo(): {
    totalMB: number;
    models: { name: string; version: string; sizeMB: number }[];
  } {
    const models = Object.entries(this.manifest.models).map(([name, entry]) => ({
      name,
      version: entry.version,
      sizeMB: entry.sizeBytes / (1024 * 1024),
    }));

    const totalMB = models.reduce((sum, m) => sum + m.sizeMB, 0);

    return { totalMB, models };
  }

  /**
   * Clear all cached models
   */
  public async clearCache(): Promise<void> {
    console.log('[ModelManager] Clearing model cache...');

    for (const [categoryCode, entry] of Object.entries(this.manifest.models)) {
      try {
        if (fs.existsSync(entry.localPath)) {
          fs.unlinkSync(entry.localPath);
          console.log(`[ModelManager] Deleted: ${entry.localPath}`);
        }
      } catch (error) {
        console.warn(`[ModelManager] Failed to delete ${categoryCode}:`, error);
      }
    }

    this.manifest.models = {};
    this.saveManifest();

    console.log('[ModelManager] Cache cleared');
  }

  /**
   * Delete specific model from cache
   */
  public deleteModel(categoryCode: string): boolean {
    const entry = this.manifest.models[categoryCode];
    if (!entry) return false;

    try {
      if (fs.existsSync(entry.localPath)) {
        fs.unlinkSync(entry.localPath);
      }
      delete this.manifest.models[categoryCode];
      this.saveManifest();
      console.log(`[ModelManager] Deleted model: ${categoryCode}`);
      return true;
    } catch (error) {
      console.error(`[ModelManager] Failed to delete ${categoryCode}:`, error);
      return false;
    }
  }

  /**
   * Update local manifest with new classes from remote without re-downloading model
   * Used when only classes changed but model version is same
   */
  public async updateClassesFromRemote(categoryCode: string): Promise<boolean> {
    const localModel = this.manifest.models[categoryCode];
    if (!localModel) return false;

    const remoteModel = await this.getModelFromRegistry(categoryCode);
    if (!remoteModel) return false;

    // Only update if version matches but classes differ
    if (localModel.version === remoteModel.version) {
      const localClasses = JSON.stringify(localModel.classes);
      const remoteClasses = JSON.stringify(remoteModel.classes);

      if (localClasses !== remoteClasses) {
        console.log(`[ModelManager] Updating classes for ${categoryCode} without re-downloading model`);
        console.log(`[ModelManager] Old classes: ${localModel.classes.length}, New classes: ${remoteModel.classes.length}`);

        localModel.classes = remoteModel.classes;
        localModel.confidenceThreshold = remoteModel.confidence_threshold;
        localModel.iouThreshold = remoteModel.iou_threshold;
        this.saveManifest();
        return true;
      }
    }
    return false;
  }

  /**
   * Ensure model is available locally (download if needed)
   */
  public async ensureModelAvailable(
    categoryCode: string,
    onProgress?: DownloadProgressCallback
  ): Promise<string> {
    const localModel = this.manifest.models[categoryCode];
    const remoteModel = await this.getModelFromRegistry(categoryCode);

    if (!remoteModel) {
      if (localModel?.localPath && fs.existsSync(localModel.localPath)) {
        console.log(`[ModelManager] Using cached model (remote unavailable): ${localModel.localPath}`);
        return localModel.localPath;
      }
      throw new Error(`Model for ${categoryCode} not available and not in registry`);
    }

    // Case 1: No local model - need full download
    if (!localModel) {
      console.log(`[ModelManager] Model not found locally, downloading...`);
      return this.downloadModel(categoryCode, onProgress);
    }

    // Case 2: Version changed - need full download
    if (localModel.version !== remoteModel.version) {
      console.log(`[ModelManager] Model version changed (${localModel.version} → ${remoteModel.version}), downloading...`);
      return this.downloadModel(categoryCode, onProgress);
    }

    // Case 3: Only classes changed - update manifest only (no download!)
    const classesChanged = JSON.stringify(localModel.classes) !== JSON.stringify(remoteModel.classes);
    if (classesChanged) {
      console.log(`[ModelManager] Classes changed online, updating manifest without re-download`);
      await this.updateClassesFromRemote(categoryCode);
    }

    // Verify local file exists
    if (!fs.existsSync(localModel.localPath)) {
      console.log(`[ModelManager] Cached model file missing, re-downloading...`);
      return this.downloadModel(categoryCode, onProgress);
    }

    console.log(`[ModelManager] Using cached model: ${localModel.localPath}`);
    return localModel.localPath;
  }

  /**
   * Get all sport categories with local ONNX enabled
   * Used to pre-download models at app startup
   */
  public async getActiveOnnxCategories(): Promise<string[]> {
    try {
      const supabase = this.getSupabase();
      const { data, error } = await supabase
        .from('sport_categories')
        .select('code')
        .eq('use_local_onnx', true);

      if (error || !data) {
        console.warn('[ModelManager] Failed to fetch active ONNX categories:', error);
        return [];
      }

      console.log(`[ModelManager] Found ${data.length} categories with local ONNX enabled`);
      return data.map(c => c.code);
    } catch (error) {
      console.error('[ModelManager] Error fetching active ONNX categories:', error);
      return [];
    }
  }

  /**
   * Check which models need to be downloaded and calculate total size
   * Used to show download progress at app startup
   */
  public async getModelsToDownload(): Promise<{
    models: { code: string; sizeMB: number }[];
    totalSizeMB: number;
  }> {
    const categories = await this.getActiveOnnxCategories();
    const modelsToDownload: { code: string; sizeMB: number }[] = [];

    for (const code of categories) {
      const status = await this.checkModelStatus(code);
      if (status.needsDownload || status.needsUpdate) {
        modelsToDownload.push({ code, sizeMB: status.sizeMB });
      }
    }

    const totalSizeMB = modelsToDownload.reduce((sum, m) => sum + m.sizeMB, 0);

    console.log(`[ModelManager] ${modelsToDownload.length} models need download, total size: ${totalSizeMB.toFixed(1)} MB`);
    return { models: modelsToDownload, totalSizeMB };
  }
}

// ==================== GENERIC MODELS SUPPORT ====================

import {
  YOLO_MODEL_REGISTRY,
  getModelConfig,
  YoloModelConfig,
} from './yolo-model-registry';

/**
 * Get model path from storage path in registry
 * Handles different directory structures for different model types
 */
function getModelPaths(modelConfig: YoloModelConfig): string[] {
  const storagePath = modelConfig.storagePath;
  const modelFileName = path.basename(storagePath);
  const modelDir = path.dirname(storagePath);

  // Build list of possible locations
  return [
    // Development: models/detector/weights-detector-v1.onnx or models/generic/yolov8n-seg.onnx
    path.join(process.cwd(), 'models', storagePath),
    // Alternative: directly in models folder
    path.join(process.cwd(), 'models', modelFileName),
    // Packaged app (asar.unpacked)
    path.join(__dirname, '..', 'models', storagePath),
    path.join(__dirname, '..', '..', 'models', storagePath),
    path.join(__dirname, '..', 'models', modelFileName),
    path.join(__dirname, '..', '..', 'models', modelFileName),
  ];
}

// Add these methods to ModelManager class
ModelManager.prototype.ensureGenericModelAvailable = async function(
  this: ModelManager,
  modelId: string,
  onProgress?: DownloadProgressCallback
): Promise<string> {
  const modelConfig = getModelConfig(modelId);
  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelId}. Available models: ${Object.keys(YOLO_MODEL_REGISTRY).join(', ')}`);
  }

  console.log(`[ModelManager] Looking for model: ${modelId} (${modelConfig.storagePath})`);

  // Check 1: Look for bundled model in project directory (development or packaged app)
  const bundledPaths = getModelPaths(modelConfig);

  for (const bundledPath of bundledPaths) {
    if (fs.existsSync(bundledPath)) {
      console.log(`[ModelManager] Using bundled model: ${bundledPath}`);
      return bundledPath;
    }
  }

  // Check 2: Look for cached model in user directory
  const modelDir = path.dirname(modelConfig.storagePath);
  const modelCacheDir = path.join((this as any).cacheDir, modelDir);

  // Ensure models directory exists
  if (!fs.existsSync(modelCacheDir)) {
    fs.mkdirSync(modelCacheDir, { recursive: true });
  }

  const localPath = path.join(modelCacheDir, `${modelId}-v${modelConfig.version}.onnx`);

  // Check if already cached
  if (fs.existsSync(localPath)) {
    console.log(`[ModelManager] Model already cached: ${localPath}`);
    return localPath;
  }

  console.log(`[ModelManager] Downloading model: ${modelId}`);

  // Get signed URL from Supabase Storage
  const supabase = (this as any).getSupabase();
  const storagePath = modelConfig.supabasePath || modelConfig.storagePath;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('onnx-models')
    .createSignedUrl(storagePath, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error(`Failed to get download URL for ${modelId}: ${signedUrlError?.message}`);
  }

  // Download with progress
  const totalBytes = modelConfig.sizeBytes;
  const totalMB = totalBytes / (1024 * 1024);

  console.log(`[ModelManager] Downloading from: ${signedUrlData.signedUrl.substring(0, 50)}...`);

  const response = await fetch(signedUrlData.signedUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    downloadedBytes += value.length;

    if (onProgress) {
      const percent = Math.round((downloadedBytes / totalBytes) * 100);
      const downloadedMB = downloadedBytes / (1024 * 1024);
      onProgress(percent, downloadedMB, totalMB);
    }
  }

  // Combine chunks and write to file
  const fileBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  fs.writeFileSync(localPath, fileBuffer);

  console.log(`[ModelManager] Downloaded model: ${fileBuffer.length} bytes to ${localPath}`);

  return localPath;
};

ModelManager.prototype.getGenericModelPath = function(
  this: ModelManager,
  modelId: string
): string | null {
  const modelConfig = getModelConfig(modelId);
  if (!modelConfig) return null;

  // Check 1: Look for bundled model in project directory
  const bundledPaths = getModelPaths(modelConfig);

  for (const bundledPath of bundledPaths) {
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  // Check 2: Look for cached model
  const modelDir = path.dirname(modelConfig.storagePath);
  const modelCacheDir = path.join((this as any).cacheDir, modelDir);
  const localPath = path.join(modelCacheDir, `${modelId}-v${modelConfig.version}.onnx`);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return null;
};

// Extend type declarations
declare module './model-manager' {
  interface ModelManager {
    ensureGenericModelAvailable(
      modelId: string,
      onProgress?: DownloadProgressCallback
    ): Promise<string>;
    getGenericModelPath(modelId: string): string | null;
  }
}

// Export singleton getter for convenience
export const getModelManager = (): ModelManager => ModelManager.getInstance();
