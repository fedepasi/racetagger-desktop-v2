import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as https from 'https';
import { authService } from './auth-service';
import { SUPABASE_CONFIG, DEBUG_MODE } from './config';

/**
 * Image upload item representing a single file to be uploaded to R2
 */
interface ImageUploadItem {
  imageId: string;
  executionId: string;
  localPath: string;
  filename: string;
  fileSize: number;
}

/**
 * Presigned URL response from Edge Function
 */
interface PresignedUrlResponse {
  image_id: string;
  upload_url: string;
  r2_key: string;
  content_type: string;
}

/**
 * Upload URL request for Edge Function
 */
interface UploadUrlRequest {
  image_id: string;
  execution_id: string;
  filename: string;
  content_type: string;
  file_size: number;
}

/**
 * Upload confirmation request for Edge Function
 */
interface UploadConfirmation {
  image_id: string;
  r2_key: string;
  file_size: number;
  width: number;
  height: number;
}

/**
 * Progress object returned by getProgress()
 */
interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  percentage: number;
}

/**
 * Queued item with retry tracking
 */
interface QueuedImage extends ImageUploadItem {
  retries: number;
  maxRetries: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
}

/**
 * R2 Upload Service
 *
 * Manages uploading high-resolution images to Cloudflare R2 via presigned PUT URLs.
 * Uses an EventEmitter-based queue system with configurable concurrency.
 *
 * Features:
 * - Batch processing (up to 50 files per batch)
 * - Exponential backoff retry logic (2 retries per file: 1s, 3s)
 * - Progress tracking and event emission
 * - Atomic Edge Function interactions for URL generation and confirmation
 * - Automatic content-type detection
 */
class R2UploadService extends EventEmitter {
  private queue: QueuedImage[] = [];
  private inProgress: Set<string> = new Set(); // imageIds currently uploading
  private processed: Map<string, 'completed' | 'failed'> = new Map();
  private concurrency: number = 3;
  private isRunning: boolean = false;
  private isCancelled: boolean = false;

  private stats = {
    total: 0,
    completed: 0,
    failed: 0,
  };

  /** Track the current execution being uploaded */
  private currentExecutionId: string | null = null;

  /** Session-level upload history (not persisted across app restarts) */
  private uploadHistory: Array<{
    completed: number;
    failed: number;
    total: number;
    timestamp: string;
    executionId: string | null;
  }> = [];

  private readonly BATCH_SIZE = 50;
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAYS = [1000, 3000]; // exponential backoff: 1s, 3s
  private readonly EDGE_FUNCTION_TIMEOUT = 30000; // 30 seconds

  constructor(concurrency: number = 3) {
    super();
    this.concurrency = concurrency;
    this.setMaxListeners(10); // Allow multiple listeners for upload events
  }

  /**
   * Queue images from an execution for upload
   * @param executionId The execution ID
   * @param imagePaths Array of images to upload
   */
  queueExecution(executionId: string, imagePaths: ImageUploadItem[]): void {
    if (DEBUG_MODE) {
      console.log(`[R2Upload] Queueing ${imagePaths.length} images for execution ${executionId}`);
    }

    this.currentExecutionId = executionId;

    const newItems: QueuedImage[] = imagePaths.map((item) => ({
      ...item,
      retries: 0,
      maxRetries: this.MAX_RETRIES,
      status: 'pending' as const,
    }));

    this.queue.push(...newItems);
    this.stats.total += newItems.length;

    if (DEBUG_MODE) {
      console.log(`[R2Upload] Queue now has ${this.queue.length} items, total tracked: ${this.stats.total}`);
    }
  }

  /**
   * Start processing the upload queue
   */
  start(): void {
    if (this.isRunning) {
      if (DEBUG_MODE) {
        console.log('[R2Upload] Already running, ignoring start() call');
      }
      return;
    }

    this.isRunning = true;
    this.isCancelled = false;

    if (DEBUG_MODE) {
      console.log('[R2Upload] Service started');
    }

    this.processQueue();
  }

  /**
   * Cancel all remaining uploads
   */
  cancel(): void {
    this.isCancelled = true;
    this.isRunning = false;

    // Mark pending items as failed
    for (const item of this.queue) {
      if (item.status === 'pending') {
        item.status = 'failed';
        item.error = 'Upload cancelled by user';
        this.stats.failed++;
        this.processed.set(item.imageId, 'failed');
      }
    }

    this.queue = [];

    if (DEBUG_MODE) {
      console.log('[R2Upload] Upload cancelled');
    }
  }

  /**
   * Get current upload progress
   */
  getProgress(): UploadProgress & { executionId: string | null } {
    return {
      total: this.stats.total,
      completed: this.stats.completed,
      failed: this.stats.failed,
      inProgress: this.inProgress.size,
      percentage:
        this.stats.total > 0
          ? Math.round(((this.stats.completed + this.stats.failed) / this.stats.total) * 100)
          : 0,
      executionId: this.currentExecutionId,
    };
  }

  /**
   * Get session-level upload history (most recent first)
   */
  getUploadHistory(): typeof this.uploadHistory {
    return this.uploadHistory;
  }

  /**
   * Process the upload queue with concurrency control
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.isRunning && !this.isCancelled) {
      // Take next batch (up to BATCH_SIZE items or up to concurrency limit)
      const batchSize = Math.min(this.BATCH_SIZE, this.concurrency);
      const batch = this.queue.splice(0, batchSize);

      if (DEBUG_MODE) {
        console.log(`[R2Upload] Processing batch of ${batch.length} items`);
      }

      // Process batch: get URLs, upload files, confirm uploads
      await this.processBatch(batch);

      // Allow other events to process
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (this.isRunning && !this.isCancelled) {
      this.isRunning = false;

      // Record in session history
      this.uploadHistory.unshift({
        completed: this.stats.completed,
        failed: this.stats.failed,
        total: this.stats.total,
        timestamp: new Date().toISOString(),
        executionId: this.currentExecutionId,
      });

      this.emit('all-uploads-complete', {
        total: this.stats.total,
        completed: this.stats.completed,
        failed: this.stats.failed,
        executionId: this.currentExecutionId,
      });

      if (DEBUG_MODE) {
        console.log(
          `[R2Upload] All uploads complete. Completed: ${this.stats.completed}, Failed: ${this.stats.failed}`
        );
      }
    }
  }

  /**
   * Process a single batch of uploads
   */
  private async processBatch(batch: QueuedImage[]): Promise<void> {
    try {
      // Step 1: Get presigned URLs from Edge Function
      const uploadUrls = await this.getPresignedUrls(batch);

      if (!uploadUrls || uploadUrls.length === 0) {
        if (DEBUG_MODE) {
          console.error('[R2Upload] Failed to get presigned URLs');
        }
        // Mark all items in batch as failed
        for (const item of batch) {
          item.status = 'failed';
          item.error = 'Failed to get presigned URL';
          this.stats.failed++;
          this.processed.set(item.imageId, 'failed');
          this.emitUploadProgress(item, 'failed');
        }
        return;
      }

      // Create map of upload URLs by imageId for quick lookup
      const urlMap = new Map(uploadUrls.map((u) => [u.image_id, u]));

      // Step 2: Upload files concurrently
      const uploadPromises = batch.map((item) => {
        const urlInfo = urlMap.get(item.imageId);
        if (!urlInfo) {
          item.status = 'failed';
          item.error = 'No presigned URL returned';
          this.stats.failed++;
          this.processed.set(item.imageId, 'failed');
          this.emitUploadProgress(item, 'failed');
          return Promise.resolve();
        }

        return this.uploadFileWithRetry(item, urlInfo).catch((err) => {
          if (DEBUG_MODE) {
            console.error(`[R2Upload] Upload failed for ${item.imageId}:`, err);
          }
          item.status = 'failed';
          item.error = err?.message || 'Upload failed';
          this.stats.failed++;
          this.processed.set(item.imageId, 'failed');
          this.emitUploadProgress(item, 'failed');
        });
      });

      await Promise.all(uploadPromises);

      // Step 3: Confirm successful uploads with Edge Function
      const successfulItems = batch.filter((item) => item.status === 'completed');
      if (successfulItems.length > 0) {
        await this.confirmUploads(successfulItems, urlMap);
      }

      // Emit batch complete event
      const executionId = batch[0].executionId;
      const batchStats = {
        completed: batch.filter((i) => i.status === 'completed').length,
        failed: batch.filter((i) => i.status === 'failed').length,
      };

      this.emit('upload-batch-complete', {
        executionId,
        total: batch.length,
        completed: batchStats.completed,
        failed: batchStats.failed,
      });

      if (DEBUG_MODE) {
        console.log(
          `[R2Upload] Batch complete: ${batchStats.completed} completed, ${batchStats.failed} failed`
        );
      }
    } catch (err) {
      if (DEBUG_MODE) {
        console.error('[R2Upload] Batch processing error:', err);
      }
      // Mark remaining items as failed
      for (const item of batch) {
        if (item.status !== 'completed') {
          item.status = 'failed';
          item.error = err instanceof Error ? err.message : 'Batch processing failed';
          this.stats.failed++;
          this.processed.set(item.imageId, 'failed');
          this.emitUploadProgress(item, 'failed');
        }
      }
    }
  }

  /**
   * Get presigned URLs from Edge Function
   */
  private async getPresignedUrls(batch: QueuedImage[]): Promise<PresignedUrlResponse[]> {
    const session = authService.getSession();
    if (!session) {
      throw new Error('No active session for R2 upload');
    }

    const requests: UploadUrlRequest[] = batch.map((item) => ({
      image_id: item.imageId,
      execution_id: item.executionId,
      filename: item.filename,
      content_type: this.detectContentType(item.filename),
      file_size: item.fileSize,
    }));

    const url = `${SUPABASE_CONFIG.url}/functions/v1/r2-signed-url`;

    if (DEBUG_MODE) {
      console.log(`[R2Upload] Requesting presigned URLs for ${requests.length} files`);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'get_upload_urls',
          files: requests,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Edge Function error (${response.status}): ${error}`);
      }

      const data = (await response.json()) as { upload_urls: PresignedUrlResponse[] };
      return data.upload_urls || [];
    } catch (err) {
      if (DEBUG_MODE) {
        console.error('[R2Upload] Error getting presigned URLs:', err);
      }
      throw err;
    }
  }

  /**
   * Upload a single file with retry logic
   */
  private async uploadFileWithRetry(
    item: QueuedImage,
    urlInfo: PresignedUrlResponse
  ): Promise<void> {
    item.status = 'uploading';
    this.inProgress.add(item.imageId);
    this.emitUploadProgress(item, 'uploading');

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= item.maxRetries; attempt++) {
      try {
        await this.uploadFileToR2(item.localPath, urlInfo.upload_url, urlInfo.content_type);

        item.status = 'completed';
        this.stats.completed++;
        this.processed.set(item.imageId, 'completed');
        this.inProgress.delete(item.imageId);
        this.emitUploadProgress(item, 'completed');

        if (DEBUG_MODE) {
          console.log(`[R2Upload] Successfully uploaded ${item.imageId}`);
        }

        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < item.maxRetries) {
          const delayMs = this.RETRY_DELAYS[attempt];
          if (DEBUG_MODE) {
            console.warn(
              `[R2Upload] Upload attempt ${attempt + 1} failed for ${item.imageId}, retrying in ${delayMs}ms`
            );
          }

          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    this.inProgress.delete(item.imageId);
    throw lastError || new Error('Upload failed after all retries');
  }

  /**
   * Upload a file to R2 via presigned URL
   */
  private uploadFileToR2(localPath: string, uploadUrl: string, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const fileBuffer = fs.readFileSync(localPath);

        // Parse URL to use https module
        const urlObj = new URL(uploadUrl);
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Content-Length': fileBuffer.length,
          },
          timeout: this.EDGE_FUNCTION_TIMEOUT,
        };

        const req = https.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            const error = new Error(`HTTP ${res.statusCode} from R2`);
            reject(error);
          }
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Upload request timeout'));
        });

        req.write(fileBuffer);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Confirm uploads with Edge Function to update DB records
   */
  private async confirmUploads(
    successfulItems: QueuedImage[],
    urlMap: Map<string, PresignedUrlResponse>
  ): Promise<void> {
    const session = authService.getSession();
    if (!session) {
      if (DEBUG_MODE) {
        console.error('[R2Upload] No active session for upload confirmation');
      }
      return;
    }

    const confirmations: UploadConfirmation[] = successfulItems.map((item) => {
      const urlInfo = urlMap.get(item.imageId)!;
      return {
        image_id: item.imageId,
        r2_key: urlInfo.r2_key,
        file_size: item.fileSize,
        width: 0, // Placeholder; could be extracted from image metadata if needed
        height: 0, // Placeholder; could be extracted from image metadata if needed
      };
    });

    const url = `${SUPABASE_CONFIG.url}/functions/v1/r2-signed-url`;

    if (DEBUG_MODE) {
      console.log(`[R2Upload] Confirming ${confirmations.length} uploads`);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'confirm_uploads',
          uploads: confirmations,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        if (DEBUG_MODE) {
          console.error(`[R2Upload] Confirmation failed (${response.status}): ${error}`);
        }
      }

      const data = (await response.json()) as { confirmed: string[]; failed: string[] };
      if (DEBUG_MODE && data.failed && data.failed.length > 0) {
        console.warn(`[R2Upload] Confirmation failed for ${data.failed.length} images:`, data.failed);
      }
    } catch (err) {
      if (DEBUG_MODE) {
        console.error('[R2Upload] Error confirming uploads:', err);
      }
      // Log but don't throw; files are already on R2, just DB confirmation failed
    }
  }

  /**
   * Detect content type from file extension
   */
  private detectContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    const contentTypeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      webp: 'image/webp',
      // Raw camera formats
      cr2: 'application/octet-stream',
      nef: 'application/octet-stream',
      arw: 'application/octet-stream',
      dng: 'application/octet-stream',
      raw: 'application/octet-stream',
    };

    return contentTypeMap[ext] || 'application/octet-stream';
  }

  /**
   * Emit upload progress event
   */
  private emitUploadProgress(
    item: QueuedImage,
    status: 'uploading' | 'completed' | 'failed'
  ): void {
    const progress = this.getProgress();

    this.emit('upload-progress', {
      imageId: item.imageId,
      executionId: item.executionId,
      status,
      progress,
    });

    if (status === 'failed' && item.error) {
      this.emit('upload-error', {
        imageId: item.imageId,
        error: item.error,
      });
    }
  }
}

/**
 * Export singleton instance
 */
export const r2UploadService = new R2UploadService();

/**
 * Export types for use in other modules
 */
export type { ImageUploadItem, UploadProgress };
