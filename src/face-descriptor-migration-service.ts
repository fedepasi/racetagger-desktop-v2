/**
 * Face Descriptor Migration Service
 *
 * Ricalcola descriptor 512-dim dalle foto esistenti che hanno solo
 * il vecchio descriptor 128-dim (face-api.js).
 *
 * Flusso:
 * 1. Query foto con face_descriptor_512 IS NULL
 * 2. Download immagine da Supabase Storage
 * 3. detectAndEmbed() → nuovo 512-dim descriptor
 * 4. UPDATE face_descriptor_512
 *
 * Trigger: IPC handler admin-only (manuale)
 * Fallback: foto senza volto → skip con warning
 *
 * @see docs/ROADMAP-SOTA.md section 3.11 Phase 2
 */

import { FaceRecognitionOnnxProcessor } from './face-recognition-onnx-processor';

// ============================================
// Type Definitions
// ============================================

export interface MigrationProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentItem?: string;
  isRunning: boolean;
  startedAt?: string;
  completedAt?: string;
  errors: Array<{ photoId: string; error: string }>;
}

export type MigrationProgressCallback = (progress: MigrationProgress) => void;

// ============================================
// Face Descriptor Migration Service
// ============================================

export class FaceDescriptorMigrationService {
  private isRunning: boolean = false;
  private shouldCancel: boolean = false;

  /**
   * Migrate preset_participant_face_photos to 512-dim.
   * Only processes photos that have face_descriptor but not face_descriptor_512.
   */
  async migratePresetPhotos(
    onProgress?: MigrationProgressCallback
  ): Promise<MigrationProgress> {
    if (this.isRunning) {
      throw new Error('Migration already in progress');
    }

    this.isRunning = true;
    this.shouldCancel = false;

    const progress: MigrationProgress = {
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      isRunning: true,
      startedAt: new Date().toISOString(),
      errors: []
    };

    try {
      // Import dynamically to avoid circular deps
      const { authService } = await import('./auth-service');
      const supabase = authService.getSupabaseClient();

      // Get photos needing migration (have 128-dim but no 512-dim)
      const { data: photos, error } = await supabase
        .from('preset_participant_face_photos')
        .select('id, photo_url, storage_path, face_descriptor')
        .not('face_descriptor', 'is', null)
        .is('face_descriptor_512', null);

      if (error) throw error;
      if (!photos || photos.length === 0) {
        console.log('[MigrationService] No photos need migration');
        progress.isRunning = false;
        progress.completedAt = new Date().toISOString();
        this.isRunning = false;
        return progress;
      }

      progress.total = photos.length;
      onProgress?.(progress);

      console.log(`[MigrationService] Starting migration of ${photos.length} photos`);

      // Ensure ONNX processor is ready
      const processor = FaceRecognitionOnnxProcessor.getInstance();
      const initialized = await processor.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize ONNX processor for migration');
      }

      // Ensure embedder is ready
      const status = processor.getStatus();
      if (!status.embedderLoaded) {
        throw new Error(
          'AuraFace model not loaded. Please download it first via model manager.'
        );
      }

      // Process each photo
      for (const photo of photos) {
        if (this.shouldCancel) {
          console.log('[MigrationService] Migration cancelled by user');
          break;
        }

        progress.currentItem = photo.id;
        progress.processed++;
        onProgress?.(progress);

        try {
          // Download image from Supabase Storage
          const { data: imageData, error: downloadError } = await supabase.storage
            .from('preset-participant-photos')
            .download(photo.storage_path);

          if (downloadError || !imageData) {
            progress.failed++;
            progress.errors.push({
              photoId: photo.id,
              error: `Download failed: ${downloadError?.message || 'no data'}`
            });
            continue;
          }

          // Convert Blob to Buffer
          const arrayBuffer = await imageData.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);

          // Detect + embed
          const result = await processor.detectAndEmbedFromBuffer(imageBuffer);

          if (!result.success || result.faces.length === 0) {
            progress.skipped++;
            console.log(`[MigrationService] No face found in photo ${photo.id}, skipping`);
            continue;
          }

          // Take the first face's embedding (reference photos should have 1 face)
          const face = result.faces[0];
          if (!face.embedding || face.embedding.length !== 512) {
            progress.skipped++;
            console.log(`[MigrationService] No valid embedding for photo ${photo.id}, skipping`);
            continue;
          }

          // Update database with 512-dim descriptor
          const { error: updateError } = await supabase
            .from('preset_participant_face_photos')
            .update({
              face_descriptor_512: face.embedding,
              descriptor_model: 'auraface-v1'
            })
            .eq('id', photo.id);

          if (updateError) {
            progress.failed++;
            progress.errors.push({
              photoId: photo.id,
              error: `Update failed: ${updateError.message}`
            });
          } else {
            progress.succeeded++;
          }

        } catch (photoError) {
          progress.failed++;
          progress.errors.push({
            photoId: photo.id,
            error: photoError instanceof Error ? photoError.message : 'Unknown error'
          });
        }

        onProgress?.(progress);
      }

    } catch (error) {
      console.error('[MigrationService] Migration failed:', error);
      progress.errors.push({
        photoId: 'global',
        error: error instanceof Error ? error.message : 'Unknown global error'
      });
    } finally {
      progress.isRunning = false;
      progress.completedAt = new Date().toISOString();
      this.isRunning = false;
      onProgress?.(progress);
    }

    console.log(
      `[MigrationService] Migration complete: ` +
      `${progress.succeeded} succeeded, ${progress.failed} failed, ${progress.skipped} skipped ` +
      `out of ${progress.total} total`
    );

    return progress;
  }

  /**
   * Cancel a running migration
   */
  cancel(): void {
    this.shouldCancel = true;
  }

  /**
   * Check if migration is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// Export singleton
export const faceDescriptorMigrationService = new FaceDescriptorMigrationService();
