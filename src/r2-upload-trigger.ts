/**
 * R2 Upload Trigger
 *
 * Single shared entry point to start an R2 HD upload for an execution.
 * Used by:
 *   - The "Deliver" button in the results modal (via the
 *     `delivery-r2-upload-start` IPC handler).
 *   - The post-execution auto-routing block in `main.ts`, which fires only
 *     when the execution is linked to a project (preset → client mapping).
 *
 * Behavior contract:
 *   - The function NEVER fires automatically: callers must have decided that
 *     the upload is wanted (explicit user click, or project_id-driven
 *     auto-delivery).
 *   - Resolves original file paths from `executions.source_folder` +
 *     `images.original_filename`. Falls back to the active batch folder if
 *     `source_folder` is missing, and auto-repairs the DB.
 *   - Marks images as `queued` only after files are confirmed present on
 *     disk, then enqueues them on the singleton `r2UploadService`.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  getImagesForR2Upload,
  markImagesUploadQueued,
  getExecutionByIdOnline,
  updateExecutionOnline,
} from './database-service';
import { r2UploadService } from './r2-upload-service';

export type R2TriggerResult = {
  queued: number;
  error?: string;
};

export type R2TriggerOptions = {
  /**
   * Optional fallback folder used when `executions.source_folder` is missing.
   * The IPC handler passes the current batch folder; the post-execution
   * auto-router can pass the just-finished batch folder.
   */
  fallbackSourceFolder?: string;
};

/**
 * Trigger an R2 HD upload for an execution.
 *
 * Returns a `R2TriggerResult` describing how many images were queued. Never
 * throws: errors are surfaced via `result.error` so callers can render them
 * inline without try/catch noise.
 */
export async function triggerR2UploadForExecution(
  executionId: string,
  options: R2TriggerOptions = {}
): Promise<R2TriggerResult> {
  const images = await getImagesForR2Upload(executionId);
  if (images.length === 0) return { queued: 0 };

  // Resolve source_folder. Prefer the value persisted on the execution row;
  // fall back to whatever the caller passed (current batch folder).
  const execution = await getExecutionByIdOnline(executionId);
  let sourceFolder = execution?.source_folder || '';

  if (!sourceFolder && options.fallbackSourceFolder) {
    sourceFolder = options.fallbackSourceFolder;
    console.log(
      `[R2 Trigger] source_folder missing for ${executionId}, using fallback: ${sourceFolder}`
    );
    // Auto-repair: persist for next time.
    try {
      await updateExecutionOnline(executionId, { source_folder: sourceFolder });
      console.log(`[R2 Trigger] Auto-repaired source_folder for execution ${executionId}`);
    } catch (e) {
      console.warn('[R2 Trigger] Could not auto-repair source_folder:', e);
    }
  }

  if (!sourceFolder) {
    console.warn(
      `[R2 Trigger] Execution ${executionId} has no source_folder and no fallback.`
    );
    return {
      queued: 0,
      error: 'Cannot locate original files. Please re-open the source folder and try again.',
    };
  }

  if (!fs.existsSync(sourceFolder)) {
    console.warn(`[R2 Trigger] Source folder not found: ${sourceFolder}`);
    return {
      queued: 0,
      error: `Source folder not found: ${sourceFolder}. Was it moved or deleted?`,
    };
  }

  const items = images
    .map((img: any) => {
      let localPath = '';
      if (img.original_filename) {
        const candidate = path.join(sourceFolder, img.original_filename);
        if (fs.existsSync(candidate)) {
          localPath = candidate;
        } else {
          console.warn(`[R2 Trigger] File not found: ${candidate}`);
        }
      }
      return {
        imageId: img.id,
        executionId,
        localPath,
        filename: img.original_filename || `${img.id}.jpg`,
        fileSize: img.original_file_size || 0,
      };
    })
    .filter((item: any) => item.localPath);

  if (items.length === 0) {
    return {
      queued: 0,
      error: `Could not locate original files in: ${sourceFolder}`,
    };
  }

  // Only mark images as queued after we've confirmed we can find the files.
  const imageIds = items.map((item: any) => item.imageId);
  await markImagesUploadQueued(imageIds);

  // Allow retry for this execution (clears dedup guard from previous attempts)
  // and enqueue.
  r2UploadService.allowRetry(executionId);
  r2UploadService.queueExecution(executionId, items);
  r2UploadService.start();

  return { queued: items.length };
}
