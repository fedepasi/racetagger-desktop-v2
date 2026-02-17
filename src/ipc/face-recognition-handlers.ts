/**
 * Face Recognition IPC Handlers (ONNX Pipeline)
 *
 * Handles face recognition initialization, descriptor loading, matching,
 * and ONNX-based detection + embedding.
 *
 * Architecture (AuraFace v1):
 *   Main process: YuNet detection → AuraFace embedding → cosine matching
 *   No renderer/canvas dependencies — face-api.js bridge eliminated.
 *
 * @see docs/ROADMAP-SOTA.md section 3.11
 */

import { ipcMain } from 'electron';
import { getSupabase } from './context';
import {
  faceRecognitionProcessor,
  StoredFaceDescriptor,
  DetectedFace,
  FaceContext
} from '../face-recognition-processor';
import {
  FaceRecognitionOnnxProcessor
} from '../face-recognition-onnx-processor';
import {
  faceDescriptorMigrationService,
  MigrationProgress
} from '../face-descriptor-migration-service';

// ==================== Register Handlers ====================

export function registerFaceRecognitionHandlers(): void {

  // Initialize face recognition processor (matcher + ONNX pipeline)
  ipcMain.handle('face-recognition-initialize', async () => {
    try {
      // Initialize the matching processor
      const matcherResult = await faceRecognitionProcessor.initialize();

      // Initialize ONNX pipeline (YuNet + AuraFace)
      const onnxProcessor = FaceRecognitionOnnxProcessor.getInstance();
      const onnxReady = await onnxProcessor.initialize();

      const status = onnxProcessor.getStatus();

      return {
        success: true,
        matcherInitialized: !!matcherResult,
        onnxReady,
        detectorLoaded: status.detectorLoaded,
        embedderLoaded: status.embedderLoaded,
        embedderAvailable: status.embedderAvailable,
        embeddingDim: status.embeddingDim
      };
    } catch (error) {
      console.error('[FaceRecognition IPC] Initialization error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Load face descriptors for matching
  ipcMain.handle('face-recognition-load-descriptors', async (_, descriptors: StoredFaceDescriptor[]) => {
    try {
      faceRecognitionProcessor.loadFaceDescriptors(descriptors);
      const count = faceRecognitionProcessor.getDescriptorCount();
      return { success: true, count };
    } catch (error) {
      console.error('[FaceRecognition IPC] Error loading descriptors:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Match detected faces against loaded descriptors
  ipcMain.handle('face-recognition-match', async (_, faces: DetectedFace[], context: FaceContext = 'auto') => {
    try {
      const result = faceRecognitionProcessor.matchFaces(faces, context);
      return result;
    } catch (error) {
      console.error('[FaceRecognition IPC] Match error:', error);
      return { success: false, error: (error as Error).message, faces: [], matchedDrivers: [], inferenceTimeMs: 0 };
    }
  });

  // Get face recognition status (includes ONNX pipeline status)
  ipcMain.handle('face-recognition-status', async () => {
    try {
      const modelInfo = faceRecognitionProcessor.getModelInfo();
      const onnxProcessor = FaceRecognitionOnnxProcessor.getInstance();
      const onnxStatus = onnxProcessor.getStatus();

      return {
        success: true,
        ...modelInfo,
        onnx: onnxStatus,
        migrationRunning: faceDescriptorMigrationService.getIsRunning()
      };
    } catch (error) {
      console.error('[FaceRecognition IPC] Status error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Clear loaded face descriptors
  ipcMain.handle('face-recognition-clear', async () => {
    try {
      faceRecognitionProcessor.clearDescriptors();
      return { success: true };
    } catch (error) {
      console.error('[FaceRecognition IPC] Clear error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Load face descriptors from Supabase sport_category_faces table
  // Now supports dual-read: prefers 512-dim (AuraFace), falls back to 128-dim (face-api.js)
  ipcMain.handle('face-recognition-load-from-database', async (_, categoryCode?: string) => {
    try {
      const supabase = getSupabase();

      // Query sport_category_faces table — include both descriptor columns
      let query = supabase
        .from('sport_category_faces')
        .select('*, face_descriptor_512, descriptor_model');

      if (categoryCode) {
        query = query.eq('sport_category_code', categoryCode);
      }

      const { data: faces, error } = await query;

      if (error) {
        console.error('[FaceRecognition IPC] Database query error:', error);
        return { success: false, error: error.message };
      }

      if (!faces || faces.length === 0) {
        return { success: true, count: 0, message: 'No faces found' };
      }

      // Convert database format to StoredFaceDescriptor format
      // Dual-read: prefer 512-dim, fall back to 128-dim
      const descriptors: StoredFaceDescriptor[] = faces
        .filter((face: any) => {
          // Accept if has valid 512-dim OR valid 128-dim
          const has512 = face.face_descriptor_512 && face.face_descriptor_512.length === 512;
          const has128 = face.face_descriptor && face.face_descriptor.length === 128;
          return has512 || has128;
        })
        .map((face: any) => {
          const has512 = face.face_descriptor_512 && face.face_descriptor_512.length === 512;
          return {
            id: face.id,
            personId: face.id,
            personName: face.person_name,
            personRole: face.person_role,
            team: face.team || '',
            carNumber: face.car_number || '',
            descriptor: has512 ? face.face_descriptor_512 : face.face_descriptor,
            descriptorDim: has512 ? 512 : 128,
            referencePhotoUrl: face.reference_photo_url,
            source: 'global' as const,
            photoType: 'reference',
            isPrimary: true
          };
        });

      // Load into processor
      faceRecognitionProcessor.loadFaceDescriptors(descriptors);
      const count = faceRecognitionProcessor.getDescriptorCount();

      return {
        success: true,
        count,
        totalInDb: faces.length,
        validDescriptors: descriptors.length,
        dim512Count: descriptors.filter(d => d.descriptorDim === 512).length,
        dim128Count: descriptors.filter(d => d.descriptorDim === 128).length
      };

    } catch (error) {
      console.error('[FaceRecognition IPC] Error loading from database:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Detect faces + generate embeddings via ONNX (for ad-hoc use from renderer)
  ipcMain.handle('face-recognition-detect-and-embed', async (_, imagePath: string) => {
    try {
      const onnxProcessor = FaceRecognitionOnnxProcessor.getInstance();
      const result = await onnxProcessor.detectAndEmbed(imagePath);
      return result;
    } catch (error) {
      console.error('[FaceRecognition IPC] Detect+embed error:', error);
      return { success: false, error: (error as Error).message, faces: [], detectionTimeMs: 0, embeddingTimeMs: 0, totalTimeMs: 0, imageWidth: 0, imageHeight: 0 };
    }
  });

  // Migrate existing 128-dim descriptors to 512-dim (admin only)
  ipcMain.handle('face-recognition-migrate-descriptors', async (_, _event) => {
    try {
      if (faceDescriptorMigrationService.getIsRunning()) {
        return { success: false, error: 'Migration already in progress' };
      }

      // Run migration asynchronously, return initial status
      const progressPromise = faceDescriptorMigrationService.migratePresetPhotos((progress: MigrationProgress) => {
        // Progress updates could be sent via IPC send if needed
        console.log(`[Migration] ${progress.processed}/${progress.total} - succeeded: ${progress.succeeded}, failed: ${progress.failed}`);
      });

      // Don't await — let it run in background
      progressPromise.then((result) => {
        console.log('[Migration] Complete:', result);
      }).catch((err) => {
        console.error('[Migration] Error:', err);
      });

      return { success: true, message: 'Migration started' };
    } catch (error) {
      console.error('[FaceRecognition IPC] Migration error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Cancel running migration
  ipcMain.handle('face-recognition-cancel-migration', async () => {
    try {
      faceDescriptorMigrationService.cancel();
      return { success: true };
    } catch (error) {
      console.error('[FaceRecognition IPC] Cancel migration error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  console.log('[FaceRecognition IPC] Registered 9 face recognition handlers (ONNX pipeline)');
}
