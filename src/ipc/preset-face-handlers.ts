/**
 * Preset Face Recognition IPC Handlers
 *
 * Handles face photo management for participant presets:
 * - Upload face photos with detection
 * - Delete face photos
 * - Get face photos for a participant
 * - Set primary photo
 * - Update face descriptor
 * - Load all descriptors for a preset
 */

import { ipcMain } from 'electron';
import { authService } from '../auth-service';
import {
  getPresetParticipantFacePhotos,
  addPresetParticipantFacePhoto,
  deletePresetParticipantFacePhoto,
  updatePresetParticipantFacePhoto,
  loadPresetFaceDescriptors,
  getPresetParticipantFacePhotoCount,
  PresetParticipantFacePhoto,
  CreatePresetFacePhotoParams
} from '../database-service';
import * as crypto from 'crypto';
import * as path from 'path';

// Use native crypto for UUID generation
const uuidv4 = (): string => crypto.randomUUID();

// Storage bucket name for preset face photos
const STORAGE_BUCKET = 'preset-participant-photos';

// ==================== Register Handlers ====================

export function registerPresetFaceHandlers(): void {

  /**
   * Upload a face photo for a participant
   * Expects: { participantId, presetId, userId, photoData (base64), fileName, faceDescriptor?, detectionConfidence?, photoType?, isPrimary? }
   */
  ipcMain.handle('preset-face-upload-photo', async (_, params: {
    participantId: string;
    presetId: string;
    userId: string;
    photoData: string; // base64 encoded
    fileName: string;
    faceDescriptor?: number[];
    detectionConfidence?: number;
    photoType?: 'reference' | 'action' | 'podium' | 'helmet_off';
    isPrimary?: boolean;
  }) => {
    try {
      // Use authenticated Supabase client from authService for RLS policy compliance
      const supabase = authService.getSupabaseClient();

      // Check if participant already has 5 photos
      const currentCount = await getPresetParticipantFacePhotoCount(params.participantId);
      if (currentCount >= 5) {
        return { success: false, error: 'Maximum 5 face photos per participant allowed' };
      }

      // Generate unique file path
      const fileExt = path.extname(params.fileName) || '.jpg';
      const uniqueId = uuidv4();
      const storagePath = `${params.userId}/${params.presetId}/${params.participantId}/${uniqueId}${fileExt}`;

      // Convert base64 to buffer
      const base64Data = params.photoData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: `image/${fileExt.replace('.', '')}`,
          cacheControl: '31536000', // 1 year cache
          upsert: false
        });

      if (uploadError) {
        console.error('[PresetFace IPC] Storage upload error:', uploadError);
        return { success: false, error: uploadError.message };
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      const photoUrl = urlData.publicUrl;

      // Save to database
      const createParams: CreatePresetFacePhotoParams = {
        participant_id: params.participantId,
        user_id: params.userId, // Required for RLS policy
        photo_url: photoUrl,
        storage_path: storagePath,
        face_descriptor: params.faceDescriptor,
        photo_type: params.photoType || 'reference',
        detection_confidence: params.detectionConfidence,
        is_primary: params.isPrimary || (currentCount === 0) // First photo is primary by default
      };

      const savedPhoto = await addPresetParticipantFacePhoto(createParams);

      return {
        success: true,
        photo: savedPhoto
      };

    } catch (error) {
      console.error('[PresetFace IPC] Upload error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Delete a face photo
   * Expects: { photoId, storagePath }
   */
  ipcMain.handle('preset-face-delete-photo', async (_, params: {
    photoId: string;
    storagePath: string;
  }) => {
    try {
      // Use authenticated Supabase client from authService for RLS policy compliance
      const supabase = authService.getSupabaseClient();

      // Delete from storage first
      const { error: storageError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([params.storagePath]);

      if (storageError) {
        console.error('[PresetFace IPC] Storage delete error:', storageError);
        // Continue to delete DB record even if storage fails
      }

      // Delete from database
      await deletePresetParticipantFacePhoto(params.photoId);

      return { success: true };

    } catch (error) {
      console.error('[PresetFace IPC] Delete error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get all face photos for a participant
   * Expects: participantId
   */
  ipcMain.handle('preset-face-get-photos', async (_, participantId: string) => {
    try {
      const photos = await getPresetParticipantFacePhotos(participantId);
      return { success: true, photos };
    } catch (error) {
      console.error('[PresetFace IPC] Get photos error:', error);
      return { success: false, error: (error as Error).message, photos: [] };
    }
  });

  /**
   * Set a photo as primary
   * Expects: photoId
   */
  ipcMain.handle('preset-face-set-primary', async (_, photoId: string) => {
    try {
      const updatedPhoto = await updatePresetParticipantFacePhoto(photoId, { is_primary: true });
      return { success: true, photo: updatedPhoto };
    } catch (error) {
      console.error('[PresetFace IPC] Set primary error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Update face descriptor for a photo
   * Expects: { photoId, faceDescriptor, detectionConfidence? }
   */
  ipcMain.handle('preset-face-update-descriptor', async (_, params: {
    photoId: string;
    faceDescriptor: number[];
    detectionConfidence?: number;
  }) => {
    try {
      const updates: any = {
        face_descriptor: params.faceDescriptor
      };
      if (params.detectionConfidence !== undefined) {
        updates.detection_confidence = params.detectionConfidence;
      }

      const updatedPhoto = await updatePresetParticipantFacePhoto(params.photoId, updates);
      return { success: true, photo: updatedPhoto };
    } catch (error) {
      console.error('[PresetFace IPC] Update descriptor error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Load all face descriptors for a preset (for use during analysis)
   * Expects: presetId
   * Returns: Array of StoredFaceDescriptor-compatible objects
   */
  ipcMain.handle('preset-face-load-for-preset', async (_, presetId: string) => {
    try {
      const descriptors = await loadPresetFaceDescriptors(presetId);
      return {
        success: true,
        descriptors,
        count: descriptors.length
      };
    } catch (error) {
      console.error('[PresetFace IPC] Load for preset error:', error);
      return { success: false, error: (error as Error).message, descriptors: [], count: 0 };
    }
  });

  console.log('[PresetFace IPC] Registered 6 preset face handlers');
}
