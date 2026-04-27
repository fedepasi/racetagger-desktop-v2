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
} from '../database-service';
import { r2UploadService } from '../r2-upload-service';
import { DEBUG_MODE } from '../config';

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

  // ==================== DELIVERY RULE HANDLERS ====================
  createHandler('delivery-create-rule', (data: any) => createDeliveryRule(data));
  createHandler('delivery-get-rules', (projectId: string) => getDeliveryRulesForProject(projectId));
  createHandler('delivery-delete-rule', (id: string) => deleteDeliveryRule(id));

  // ==================== GALLERY IMAGES HANDLERS ====================
  createHandler('delivery-add-images', ({ galleryId, images }: { galleryId: string; images: any[] }) => addImagesToGallery(galleryId, images));
  createHandler('delivery-auto-route', ({ projectId, executionId }: { projectId: string; executionId: string }) => autoRouteImagesToGalleries(projectId, executionId));
  createHandler('delivery-send-execution-to-gallery', ({ galleryId, executionId }: { galleryId: string; executionId: string }) => sendExecutionToGallery(galleryId, executionId));

  // ==================== PLAN LIMITS & EXECUTIONS ====================
  createHandler('delivery-get-plan-limits', () => getUserPlanLimits());
  createHandler('delivery-get-recent-executions', () => getUserRecentExecutions());

  // ==================== R2 UPLOAD ====================
  createHandler('delivery-r2-upload-start', async (executionId: string) => {
    const images = await getImagesForR2Upload(executionId);
    if (images.length === 0) return { queued: 0 };
    const imageIds = images.map((img: any) => img.id);
    await markImagesUploadQueued(imageIds);
    const items = images.map((img: any) => ({
      imageId: img.id,
      executionId,
      localPath: img.storage_path, // Will be resolved by the upload service
      filename: img.original_filename || `${img.id}.jpg`,
      fileSize: img.file_size || 0,
    }));
    r2UploadService.queueExecution(executionId, items);
    r2UploadService.start();
    return { queued: images.length };
  });
  createHandler('delivery-r2-upload-progress', () => r2UploadService.getProgress());
  createHandler('delivery-r2-upload-cancel', () => { r2UploadService.cancel(); return { cancelled: true }; });

  // ==================== FEATURE INTEREST SURVEY ====================
  createHandler('delivery-submit-survey', (data: { responses: any; comment: string | null }) => submitFeatureInterestSurvey(data));
  createHandler('delivery-check-survey', () => checkFeatureInterestSurvey());

  if (DEBUG_MODE) console.log('[IPC] Delivery handlers registered (24 handlers)');
}
