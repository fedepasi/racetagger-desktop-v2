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
import { triggerR2UploadForExecution } from '../r2-upload-trigger';
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
  // Explicit user-initiated HD upload for an execution. Falls back to the
  // currently-active batch folder if `executions.source_folder` is missing.
  // The actual logic lives in `r2-upload-trigger.ts` so it can be shared with
  // the post-execution auto-routing block in main.ts (project_id flow).
  createHandler('delivery-r2-upload-start', async (executionId: string) => {
    const currentBatch = getBatchConfig();
    return triggerR2UploadForExecution(executionId, {
      fallbackSourceFolder: currentBatch?.folderPath,
    });
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
