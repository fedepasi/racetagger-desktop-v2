/**
 * Delivery IPC Handlers
 *
 * Handles delivery operations: projects, galleries, delivery rules, auto-routing.
 */

import { createHandler } from './handler-factory';
import {
  createProject,
  getUserProjects,
  getProjectById,
  updateProject,
  deleteProject,
  createGallery,
  getUserGalleries,
  updateGallery,
  deleteGallery,
  createDeliveryRule,
  updateDeliveryRule,
  getDeliveryRulesForProject,
  deleteDeliveryRule,
  addImagesToGallery,
  autoRouteImagesToGalleries,
  getUserPlanLimits,
  sendExecutionToGallery,
  getUserRecentExecutions,
  getImagesForR2Upload,
  markImagesUploadQueued,
  submitFeatureInterestSurvey,
  checkFeatureInterestSurvey,
  getGalleryExecutions,
  syncDeliveryRulesFromPreset,
  createClientUser,
  getClientUsersForProject,
  updateClientUser,
  deleteClientUser,
  setClientSlug,
  sendClientInviteEmail,
  resendClientInvite,
  getUnlinkedGalleries,
  linkGalleryToProject,
  getR2UploadStatus,
  resetR2UploadStatus,
  updateExecutionSourceFolder,
} from '../database-service';
import { r2UploadService } from '../r2-upload-service';
import { DEBUG_MODE } from '../config';
import { getBatchConfig } from './context';
import { dialog, BrowserWindow } from 'electron';

export function registerDeliveryHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering delivery handlers...');

  // ==================== PROJECT HANDLERS ====================
  createHandler('delivery-create-project', (data: any) => createProject(data));
  createHandler('delivery-get-projects', () => getUserProjects());
  createHandler('delivery-get-project', (id: string) => getProjectById(id));
  createHandler('delivery-update-project', ({ id, data }: { id: string; data: any }) => updateProject(id, data));
  createHandler('delivery-delete-project', (id: string) => deleteProject(id));

  // ==================== GALLERY HANDLERS ====================
  createHandler('delivery-create-gallery', (data: any) => createGallery(data));
  createHandler('delivery-get-galleries', () => getUserGalleries());
  createHandler('delivery-update-gallery', ({ id, data }: { id: string; data: any }) => updateGallery(id, data));
  createHandler('delivery-delete-gallery', (id: string) => deleteGallery(id));
  createHandler('delivery-get-unlinked-galleries', () => getUnlinkedGalleries());
  createHandler('delivery-link-gallery', ({ galleryId, projectId }: { galleryId: string; projectId: string }) => linkGalleryToProject(galleryId, projectId));

  // ==================== DELIVERY RULE HANDLERS ====================
  createHandler('delivery-create-rule', (data: any) => createDeliveryRule(data));
  createHandler('delivery-get-rules', (projectId: string) => getDeliveryRulesForProject(projectId));
  createHandler('delivery-update-rule', ({ id, data }: { id: string; data: any }) => updateDeliveryRule(id, data));
  createHandler('delivery-delete-rule', (id: string) => deleteDeliveryRule(id));

  // ==================== GALLERY IMAGES HANDLERS ====================
  createHandler('delivery-add-images', ({ galleryId, images }: { galleryId: string; images: any[] }) => addImagesToGallery(galleryId, images));
  createHandler('delivery-auto-route', ({ projectId, executionId }: { projectId: string; executionId: string }) => autoRouteImagesToGalleries(projectId, executionId));
  createHandler('delivery-send-execution-to-gallery', ({ galleryId, executionId }: { galleryId: string; executionId: string }) => sendExecutionToGallery(galleryId, executionId));
  createHandler('delivery-get-gallery-executions', (galleryId: string) => getGalleryExecutions(galleryId));

  // ==================== PLAN LIMITS & EXECUTIONS ====================
  createHandler('delivery-get-plan-limits', () => getUserPlanLimits());
  createHandler('delivery-get-recent-executions', () => getUserRecentExecutions());

  // ==================== R2 UPLOAD ====================
  createHandler('delivery-r2-upload-start', async (executionId: string) => {
    const images = await getImagesForR2Upload(executionId);
    if (images.length === 0) return { queued: 0 };

    // Get execution source_folder to resolve original file paths
    const { getExecutionByIdOnline, updateExecutionOnline } = await import('../database-service');
    const execution = await getExecutionByIdOnline(executionId);
    let sourceFolder = execution?.source_folder || '';

    // Fallback: if source_folder is missing, try using the current batch folder
    if (!sourceFolder) {
      const currentBatch = getBatchConfig();
      if (currentBatch && currentBatch.folderPath) {
        console.log(`[R2 Upload] source_folder missing for ${executionId}, using current batch folder: ${currentBatch.folderPath}`);
        sourceFolder = currentBatch.folderPath;
        // Auto-repair: save it to the database for future use
        try {
          await updateExecutionOnline(executionId, { source_folder: sourceFolder });
          console.log(`[R2 Upload] Auto-repaired source_folder for execution ${executionId}`);
        } catch (e) {
          console.warn('[R2 Upload] Could not auto-repair source_folder:', e);
        }
      }
    }

    if (!sourceFolder) {
      console.warn(`[R2 Upload] Execution ${executionId} has no source_folder and no active batch folder.`);
      return { queued: 0, error: 'Cannot locate original files. Please re-open the source folder and try again.' };
    }

    const path = require('path');
    const fs = require('fs');

    // Verify source folder still exists
    if (!fs.existsSync(sourceFolder)) {
      console.warn(`[R2 Upload] Source folder not found: ${sourceFolder}`);
      return { queued: 0, error: `Source folder not found: ${sourceFolder}. Was it moved or deleted?` };
    }

    const items = images.map((img: any) => {
      // Resolve the original file path from source_folder + original_filename
      let localPath = '';
      if (img.original_filename) {
        const candidate = path.join(sourceFolder, img.original_filename);
        if (fs.existsSync(candidate)) {
          localPath = candidate;
        } else {
          console.warn(`[R2 Upload] File not found: ${candidate}`);
        }
      }
      return {
        imageId: img.id,
        executionId,
        localPath,
        filename: img.original_filename || `${img.id}.jpg`,
        fileSize: img.original_file_size || 0,
      };
    }).filter((item: any) => item.localPath); // Skip files that can't be found

    if (items.length === 0) {
      return { queued: 0, error: `Could not locate original files in: ${sourceFolder}` };
    }

    // Only mark images as queued after we've confirmed we can find the files
    const imageIds = items.map((item: any) => item.imageId);
    await markImagesUploadQueued(imageIds);

    // Allow retry for this execution (clears dedup guard from previous attempts)
    r2UploadService.allowRetry(executionId);
    r2UploadService.queueExecution(executionId, items);
    r2UploadService.start();
    return { queued: items.length };
  });
  createHandler('delivery-r2-upload-progress', () => r2UploadService.getProgress());
  createHandler('delivery-r2-upload-cancel', () => { r2UploadService.cancel(); return { cancelled: true }; });
  createHandler('delivery-get-upload-history', () => r2UploadService.getUploadHistory());
  createHandler('delivery-r2-upload-status', (executionId: string) => getR2UploadStatus(executionId));
  createHandler('delivery-r2-reset-status', ({ executionId, statuses }: { executionId: string; statuses?: string[] }) => resetR2UploadStatus(executionId, statuses));
  createHandler('delivery-update-source-folder', ({ executionId, sourceFolder }: { executionId: string; sourceFolder: string }) => updateExecutionSourceFolder(executionId, sourceFolder));

  // Browse for new source folder (opens native folder picker dialog)
  createHandler('delivery-browse-source-folder', async (executionId: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { cancelled: true };

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select the folder containing the original images',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }

    const newFolder = result.filePaths[0];

    // Update source_folder in DB
    await updateExecutionSourceFolder(executionId, newFolder);

    return { cancelled: false, sourceFolder: newFolder };
  });

  // ==================== SYNC DELIVERY RULES FROM PRESET ====================
  createHandler('delivery-sync-rules-from-preset', (presetId: string) => syncDeliveryRulesFromPreset(presetId));

  // ==================== CLIENT USERS (AUTH) ====================
  createHandler('delivery-create-client-user', (data: any) => createClientUser(data));
  createHandler('delivery-get-client-users', (projectId: string) => getClientUsersForProject(projectId));
  createHandler('delivery-update-client-user', ({ id, data }: { id: string; data: any }) => updateClientUser(id, data));
  createHandler('delivery-delete-client-user', (id: string) => deleteClientUser(id));

  // ==================== SHAREABLE LINKS ====================
  createHandler('delivery-set-client-slug', ({ projectId, clientName }: { projectId: string; clientName: string }) => setClientSlug(projectId, clientName));

  // ==================== CLIENT INVITE EMAILS ====================
  createHandler('delivery-send-client-invite', (data: { clientUserId: string; email: string; displayName: string; inviteToken: string; projectId: string }) => sendClientInviteEmail(data));
  createHandler('delivery-resend-client-invite', (clientUserId: string) => resendClientInvite(clientUserId));

  // ==================== FEATURE INTEREST SURVEY ====================
  createHandler('delivery-submit-survey', (data: { responses: any; comment: string | null }) => submitFeatureInterestSurvey(data));
  createHandler('delivery-check-survey', () => checkFeatureInterestSurvey());

  if (DEBUG_MODE) console.log('[IPC] Delivery handlers registered (35 handlers)');
}
