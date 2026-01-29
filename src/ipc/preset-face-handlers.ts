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
   * Upload a face photo for a participant or driver
   * Expects: { participantId?, driverId?, presetId, userId, photoData (base64), fileName, faceDescriptor?, detectionConfidence?, photoType?, isPrimary? }
   * Note: Either participantId OR driverId must be provided (not both)
   */
  ipcMain.handle('preset-face-upload-photo', async (_, params: {
    participantId?: string;
    driverId?: string;
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
      // Validate: either participantId or driverId must be provided
      if (!params.participantId && !params.driverId) {
        return { success: false, error: 'Either participantId or driverId must be provided' };
      }
      if (params.participantId && params.driverId) {
        return { success: false, error: 'Cannot specify both participantId and driverId' };
      }

      // Use authenticated Supabase client from authService for RLS policy compliance
      const supabase = authService.getSupabaseClient();

      // Check if participant/driver already has 5 photos
      const targetId = params.participantId || params.driverId!;
      const currentCount = await getPresetParticipantFacePhotoCount(targetId, !!params.driverId);
      if (currentCount >= 5) {
        return { success: false, error: 'Maximum 5 face photos per driver allowed' };
      }

      // Generate unique file path
      const fileExt = path.extname(params.fileName) || '.jpg';
      const uniqueId = uuidv4();
      const targetFolder = params.participantId || params.driverId;
      const storagePath = `${params.userId}/${params.presetId}/${targetFolder}/${uniqueId}${fileExt}`;

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
      // Note: participant_id and driver_id are mutually exclusive (enforced by DB constraint)
      // - For participant photos: participant_id is set, driver_id is null
      // - For driver photos: driver_id is set, participant_id is null
      const createParams: CreatePresetFacePhotoParams = {
        participant_id: params.participantId || null,
        driver_id: params.driverId || null,
        user_id: params.userId, // Required for RLS policy
        photo_url: photoUrl,
        storage_path: storagePath,
        face_descriptor: params.faceDescriptor,
        photo_type: params.photoType || 'reference',
        detection_confidence: params.detectionConfidence,
        is_primary: params.isPrimary || (currentCount === 0) // First photo is primary by default
      };

      console.log('[PresetFace IPC] 💾 Saving photo with:', {
        participant_id: createParams.participant_id,
        driver_id: createParams.driver_id,
        photo_type: createParams.photo_type
      });

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
   * Get all face photos for a participant or driver
   * Expects: { participantId?, driverId? }
   * Note: Either participantId OR driverId must be provided
   */
  ipcMain.handle('preset-face-get-photos', async (_, params: { participantId?: string; driverId?: string }) => {
    try {
      if (!params.participantId && !params.driverId) {
        return { success: false, error: 'Either participantId or driverId must be provided', photos: [] };
      }

      const photos = await getPresetParticipantFacePhotos(params.participantId, params.driverId);
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

  // ==================== Driver Management Handlers ====================

  /**
   * Get all drivers for a participant
   * Expects: participantId
   */
  ipcMain.handle('preset-driver-get-all', async (_, participantId: string) => {
    try {
      const supabase = authService.getSupabaseClient();

      const { data: drivers, error } = await supabase
        .from('preset_participant_drivers')
        .select('*')
        .eq('participant_id', participantId)
        .order('driver_order', { ascending: true });

      if (error) {
        console.error('[PresetDriver IPC] Get all error:', error);
        return { success: false, error: error.message, drivers: [] };
      }

      return { success: true, drivers: drivers || [] };
    } catch (error) {
      console.error('[PresetDriver IPC] Get all error:', error);
      return { success: false, error: (error as Error).message, drivers: [] };
    }
  });

  /**
   * Create a new driver for a participant
   * Expects: { participantId, driverName, driverMetatag?, driverOrder }
   */
  ipcMain.handle('preset-driver-create', async (_, params: {
    participantId: string;
    driverName: string;
    driverMetatag?: string;
    driverOrder: number;
  }) => {
    try {
      const supabase = authService.getSupabaseClient();

      const newDriver = {
        id: uuidv4(),
        participant_id: params.participantId,
        driver_name: params.driverName,
        driver_metatag: params.driverMetatag || null,
        driver_order: params.driverOrder,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: driver, error } = await supabase
        .from('preset_participant_drivers')
        .insert(newDriver)
        .select()
        .single();

      if (error) {
        console.error('[PresetDriver IPC] Create error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, driver };
    } catch (error) {
      console.error('[PresetDriver IPC] Create error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Update a driver
   * Expects: { driverId, driverName?, driverMetatag?, driverOrder? }
   */
  ipcMain.handle('preset-driver-update', async (_, params: {
    driverId: string;
    driverName?: string;
    driverMetatag?: string;
    driverOrder?: number;
  }) => {
    try {
      const supabase = authService.getSupabaseClient();

      const updates: any = {
        updated_at: new Date().toISOString()
      };

      if (params.driverName !== undefined) updates.driver_name = params.driverName;
      if (params.driverMetatag !== undefined) updates.driver_metatag = params.driverMetatag;
      if (params.driverOrder !== undefined) updates.driver_order = params.driverOrder;

      const { data: driver, error } = await supabase
        .from('preset_participant_drivers')
        .update(updates)
        .eq('id', params.driverId)
        .select()
        .single();

      if (error) {
        console.error('[PresetDriver IPC] Update error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, driver };
    } catch (error) {
      console.error('[PresetDriver IPC] Update error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Delete a driver
   * Expects: driverId
   */
  ipcMain.handle('preset-driver-delete', async (_, driverId: string) => {
    try {
      const supabase = authService.getSupabaseClient();

      // Delete will cascade to face photos automatically (ON DELETE CASCADE)
      const { error } = await supabase
        .from('preset_participant_drivers')
        .delete()
        .eq('id', driverId);

      if (error) {
        console.error('[PresetDriver IPC] Delete error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('[PresetDriver IPC] Delete error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Sync drivers from participant's nome field (comma-separated driver names)
   * This creates/updates/deletes drivers to match the participant's nome field
   * Expects: { participantId, driverNames: string[] }
   */
  ipcMain.handle('preset-driver-sync', async (_, params: {
    participantId: string;
    driverNames: string[];
  }) => {
    try {
      const supabase = authService.getSupabaseClient();

      console.log('[PresetDriver IPC] Sync called:', {
        participantId: params.participantId,
        driverNames: params.driverNames,
        driverCount: params.driverNames.length
      });

      // Get existing drivers
      const { data: existingDrivers, error: fetchError } = await supabase
        .from('preset_participant_drivers')
        .select('*')
        .eq('participant_id', params.participantId)
        .order('driver_order', { ascending: true });

      if (fetchError) {
        console.error('[PresetDriver IPC] Sync fetch error:', fetchError);
        return { success: false, error: fetchError.message };
      }

      const existing = existingDrivers || [];
      const newNames = params.driverNames;

      console.log('[PresetDriver IPC] Existing drivers:', existing.map(d => ({
        id: d.id,
        name: d.driver_name,
        order: d.driver_order
      })));

      // Determine what needs to be created, updated, or deleted
      const toCreate: string[] = [];
      const toUpdate: { id: string; name: string; order: number }[] = [];
      const toDelete: string[] = [];

      // Normalize name for comparison (case-insensitive, whitespace-tolerant)
      const normalizeName = (name: string) => name.trim().toLowerCase();

      // Check which new names don't exist
      // Match by driver_name first (stable identifier), then fall back to order
      newNames.forEach((name, index) => {
        const normalizedName = normalizeName(name);

        // First try to find by normalized name (case-insensitive, whitespace-tolerant)
        let existingDriver = existing.find(d => normalizeName(d.driver_name) === normalizedName);

        // If not found by name, check if there's a driver at this position
        if (!existingDriver) {
          const driverAtPosition = existing.find(d => d.driver_order === index);
          // Only use position match if name doesn't exist anywhere
          if (driverAtPosition && !newNames.some(n => normalizeName(n) === normalizeName(driverAtPosition.driver_name))) {
            existingDriver = driverAtPosition;
          }
        }

        if (!existingDriver) {
          toCreate.push(name);
        } else if (existingDriver.driver_name !== name || existingDriver.driver_order !== index) {
          // Update if name or order changed
          toUpdate.push({ id: existingDriver.id, name, order: index });
        }
      });

      // Check which existing drivers are no longer needed (case-insensitive comparison)
      existing.forEach((driver) => {
        const normalizedDriverName = normalizeName(driver.driver_name);
        if (!newNames.some(n => normalizeName(n) === normalizedDriverName)) {
          toDelete.push(driver.id);
        }
      });

      // Execute operations sequentially (Supabase doesn't support true parallel operations)

      // Create new drivers
      for (const name of toCreate) {
        await supabase.from('preset_participant_drivers').insert({
          id: uuidv4(),
          participant_id: params.participantId,
          driver_name: name,
          driver_order: newNames.indexOf(name),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      // Update existing drivers
      for (const { id, name, order } of toUpdate) {
        await supabase.from('preset_participant_drivers')
          .update({ driver_name: name, driver_order: order, updated_at: new Date().toISOString() })
          .eq('id', id);
      }

      // Delete removed drivers
      if (toDelete.length > 0) {
        await supabase.from('preset_participant_drivers').delete().in('id', toDelete);
      }

      console.log('[PresetDriver IPC] Sync results:', {
        created: toCreate.length,
        createdNames: toCreate,
        updated: toUpdate.length,
        updatedDrivers: toUpdate.map(u => ({ name: u.name, order: u.order })),
        deleted: toDelete.length
      });

      // Fetch updated drivers
      const { data: updatedDrivers } = await supabase
        .from('preset_participant_drivers')
        .select('*')
        .eq('participant_id', params.participantId)
        .order('driver_order', { ascending: true });

      console.log('[PresetDriver IPC] Final driver IDs:', updatedDrivers?.map(d => ({ id: d.id, name: d.driver_name })));

      return {
        success: true,
        drivers: updatedDrivers || [],
        created: toCreate.length,
        updated: toUpdate.length,
        deleted: toDelete.length
      };

    } catch (error) {
      console.error('[PresetDriver IPC] Sync error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get all drivers for a participant (for export)
   * Expects: participantId
   */
  ipcMain.handle('preset-get-drivers-for-participant', async (_, participantId: string) => {
    try {
      const supabase = authService.getSupabaseClient();
      const { data, error } = await supabase
        .from('preset_participant_drivers')
        .select('*')
        .eq('participant_id', participantId)
        .order('driver_order', { ascending: true });

      if (error) {
        console.error('[PresetDriver IPC] Get drivers for participant error:', error);
        return { success: false, error: error.message, drivers: [] };
      }

      return { success: true, drivers: data || [] };
    } catch (error) {
      console.error('[PresetDriver IPC] Get drivers for participant error:', error);
      return { success: false, error: (error as Error).message, drivers: [] };
    }
  });

  /**
   * Batch create drivers with preserved IDs (for import)
   * Expects: { participantId, drivers: Array<{id, driver_name, driver_metatag?, driver_order}> }
   */
  ipcMain.handle('preset-create-drivers-batch', async (_, params: {
    participantId: string;
    drivers: Array<{
      id: string;
      driver_name: string;
      driver_metatag?: string;
      driver_order: number;
    }>;
  }) => {
    try {
      const supabase = authService.getSupabaseClient();

      // Upsert all drivers at once (preserves IDs)
      const driversToCreate = params.drivers.map(d => ({
        id: d.id,  // Preserve original ID from JSON/CSV
        participant_id: params.participantId,
        driver_name: d.driver_name,
        driver_metatag: d.driver_metatag || null,
        driver_order: d.driver_order,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('preset_participant_drivers')
        .upsert(driversToCreate)
        .select();

      if (error) {
        console.error('[PresetDriver IPC] Batch create error:', error);
        return { success: false, error: error.message };
      }

      console.log(`[PresetDriver IPC] Batch created ${data.length} drivers for participant ${params.participantId}`);

      return {
        success: true,
        drivers: data,
        count: data.length
      };
    } catch (error) {
      console.error('[PresetDriver IPC] Batch create error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Migrate orphaned photos (diagnostic tool with auto-recovery)
  ipcMain.handle('preset-driver-migrate-orphaned-photos', async (_, params: {
    participantId: string;
    autoRecover?: boolean;
  }) => {
    try {
      const supabase = authService.getSupabaseClient();

      // Get all current drivers for this participant
      const { data: currentDrivers } = await supabase
        .from('preset_participant_drivers')
        .select('*')
        .eq('participant_id', params.participantId);

      if (!currentDrivers || currentDrivers.length === 0) {
        return { success: true, recovered: 0, orphanedCount: 0 };
      }

      // Get all photos that might be orphaned (driver_id not in current drivers)
      const currentDriverIds = currentDrivers.map(d => d.id);
      const { data: allPhotos } = await supabase
        .from('preset_participant_face_photos')
        .select('*')
        .not('driver_id', 'is', null);

      // Find orphaned photos
      const orphanedPhotos = allPhotos?.filter(photo =>
        photo.driver_id && !currentDriverIds.includes(photo.driver_id)
      ) || [];

      console.log(`[PresetDriver IPC] Found ${orphanedPhotos.length} orphaned photos for participant ${params.participantId}`);

      // Auto-recovery: Try to match photos to current drivers by name in storage path
      if (params.autoRecover && orphanedPhotos.length > 0) {
        const recovered: Array<{ photoId: string; driverId: string }> = [];

        for (const photo of orphanedPhotos) {
          // Extract driver name hint from storage path (format: userId/presetId/driverId/filename)
          // We can't reliably recover without the original driver name, but we can try fuzzy matching
          // For now, we'll just report orphaned photos - true recovery requires name matching
          // which needs to be implemented in frontend with user confirmation
        }

        return {
          success: true,
          orphanedCount: orphanedPhotos.length,
          recoveredCount: recovered.length,
          orphanedPhotos: orphanedPhotos.map(p => ({
            id: p.id,
            driverId: p.driver_id,
            photoUrl: p.photo_url,
            storagePath: p.storage_path,
            createdAt: p.created_at
          }))
        };
      }

      // Just report orphaned photos
      return {
        success: true,
        orphanedCount: orphanedPhotos.length,
        orphanedPhotos: orphanedPhotos.map(p => ({
          id: p.id,
          driverId: p.driver_id,
          photoUrl: p.photo_url,
          storagePath: p.storage_path,
          createdAt: p.created_at
        }))
      };

    } catch (error) {
      console.error('[PresetDriver IPC] Migration error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  console.log('[PresetFace IPC] Registered 14 preset face & driver handlers');
}
