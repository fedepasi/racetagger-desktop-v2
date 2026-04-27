/**
 * Face Recognition IPC Handlers
 *
 * Handles face recognition initialization, descriptor loading, and matching.
 */

import { ipcMain } from 'electron';
import { getSupabase } from './context';
import {
  faceRecognitionProcessor,
  StoredFaceDescriptor,
  DetectedFace,
  FaceContext
} from '../face-recognition-processor';

// ==================== Register Handlers ====================

export function registerFaceRecognitionHandlers(): void {

  // Initialize face recognition processor
  ipcMain.handle('face-recognition-initialize', async () => {
    try {
      const result = await faceRecognitionProcessor.initialize();
      return result;
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

  // Get face recognition status
  ipcMain.handle('face-recognition-status', async () => {
    try {
      const modelInfo = faceRecognitionProcessor.getModelInfo();
      return {
        success: true,
        ...modelInfo
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
  ipcMain.handle('face-recognition-load-from-database', async (_, categoryCode?: string) => {
    try {
      const supabase = getSupabase();

      // Query sport_category_faces table
      let query = supabase
        .from('sport_category_faces')
        .select('*');

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
      const descriptors: StoredFaceDescriptor[] = faces
        .filter((face: any) => face.face_descriptor && face.face_descriptor.length === 128)
        .map((face: any) => ({
          id: face.id,
          personId: face.id,
          personName: face.person_name,
          personRole: face.person_role,
          team: face.team || '',
          carNumber: face.car_number || '',
          descriptor: face.face_descriptor,
          referencePhotoUrl: face.reference_photo_url,
          source: 'global' as const,
          photoType: 'reference',
          isPrimary: true
        }));

      // Load into processor
      faceRecognitionProcessor.loadFaceDescriptors(descriptors);
      const count = faceRecognitionProcessor.getDescriptorCount();

      return { success: true, count, totalInDb: faces.length, validDescriptors: descriptors.length };

    } catch (error) {
      console.error('[FaceRecognition IPC] Error loading from database:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
