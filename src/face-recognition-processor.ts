/**
 * Face Recognition Processor (Matching Only)
 *
 * Handles face MATCHING using pre-computed descriptors.
 * Face DETECTION is done in the renderer process (browser Canvas API).
 *
 * Architecture:
 * - Renderer: Loads face-api.js, detects faces, generates descriptors
 * - Main (this file): Matches descriptors against known faces database
 *
 * This avoids the need for native 'canvas' module compilation.
 */

// NOTE: face-api.js and canvas are NOT imported here anymore
// Face detection happens in renderer process (renderer/js/face-detector.js)

// ============================================
// Type Definitions
// ============================================

export interface DetectedFace {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  landmarks?: number[][];
  descriptor: number[];  // Changed from Float32Array for easier serialization
  confidence: number;
}

export interface DriverMatch {
  faceIndex: number;
  driverId: string;
  driverName: string;
  team: string;
  carNumber: string;
  confidence: number;
  source: 'global' | 'preset';
  referencePhotoUrl?: string;
}

export interface FaceRecognitionResult {
  success: boolean;
  faces: DetectedFace[];
  matchedDrivers: DriverMatch[];
  inferenceTimeMs: number;
  error?: string;
}

export interface StoredFaceDescriptor {
  id: string;
  driverId: string;
  driverName: string;
  team: string;
  carNumber: string;
  descriptor: number[];
  referencePhotoUrl?: string;
  source: 'global' | 'preset';
  photoType?: string;    // 'reference', 'action', 'podium', 'helmet_off'
  isPrimary?: boolean;   // Whether this is the primary photo for display
}

export type FaceContext = 'portrait' | 'action' | 'podium' | 'auto';

// Context-specific matching configurations
const CONTEXT_CONFIG: Record<FaceContext, {
  maxFaces: number;
  matchThreshold: number;  // Maximum euclidean distance for a match (lower = stricter)
}> = {
  portrait: {
    maxFaces: 1,
    matchThreshold: 0.6
  },
  action: {
    maxFaces: 3,
    matchThreshold: 0.5
  },
  podium: {
    maxFaces: 5,
    matchThreshold: 0.55
  },
  auto: {
    maxFaces: 5,
    matchThreshold: 0.6
  }
};

// ============================================
// Face Recognition Processor Class (Matching Only)
// ============================================

export class FaceRecognitionProcessor {
  private isReady: boolean = false;
  private storedFaces: Map<string, StoredFaceDescriptor> = new Map();
  private driverDescriptors: Map<string, number[][]> = new Map(); // driverId -> array of descriptors

  constructor() {
    console.log('[FaceRecognition] Initialized (matching-only mode, no canvas required)');
  }

  /**
   * Initialize the processor (no models to load - matching only)
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    this.isReady = true;
    console.log('[FaceRecognition] Ready for matching (face detection is done in renderer)');
    return { success: true };
  }

  /**
   * Check if processor is ready
   */
  isModelLoaded(): boolean {
    return this.isReady;
  }

  /**
   * Load face descriptors from database results
   * Supports multiple descriptors per driver for improved recognition accuracy
   */
  loadFaceDescriptors(faces: StoredFaceDescriptor[]): void {
    this.storedFaces.clear();
    this.driverDescriptors.clear();

    console.log(`[FaceRecognition] Loading ${faces.length} faces from database...`);

    // Debug: Check first face to see descriptor format
    if (faces.length > 0) {
      const first = faces[0];
      console.log(`[FaceRecognition] First face: driverId=${first.driverId}, driverName=${first.driverName}, descriptor type=${typeof first.descriptor}, isArray=${Array.isArray(first.descriptor)}, length=${first.descriptor?.length}`);
      if (first.descriptor && first.descriptor.length > 0) {
        console.log(`[FaceRecognition] Descriptor sample (first 5 values): [${first.descriptor.slice(0, 5).join(', ')}]`);
      }
    }

    const validFaces = faces.filter(f => {
      const isValid = f.descriptor && Array.isArray(f.descriptor) && f.descriptor.length === 128;
      if (!isValid) {
        console.log(`[FaceRecognition] Invalid descriptor for ${f.driverName}: isArray=${Array.isArray(f.descriptor)}, length=${f.descriptor?.length}`);
      }
      return isValid;
    });

    if (validFaces.length === 0) {
      console.log('[FaceRecognition] No valid face descriptors to load');
      return;
    }

    // Group descriptors by driver (supports multiple photos per driver)
    for (const face of validFaces) {
      const key = face.driverId;

      // Store the primary face (or first face) for reference info
      const existing = this.storedFaces.get(key);
      if (!existing || face.isPrimary) {
        this.storedFaces.set(key, face);
      }

      // Add descriptor to driver's array
      if (!this.driverDescriptors.has(key)) {
        this.driverDescriptors.set(key, []);
      }
      this.driverDescriptors.get(key)!.push(face.descriptor);
    }

    const totalDescriptors = validFaces.length;
    const uniqueDrivers = this.driverDescriptors.size;
    console.log(`[FaceRecognition] Loaded ${totalDescriptors} face descriptors for ${uniqueDrivers} drivers`);
  }

  /**
   * Calculate euclidean distance between two face descriptors
   */
  private euclideanDistance(d1: number[], d2: number[]): number {
    if (d1.length !== 128 || d2.length !== 128) {
      return Infinity;
    }
    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const diff = d1[i] - d2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Find the best matching driver for a given face descriptor
   */
  findBestMatch(
    descriptor: number[],
    threshold: number = 0.6
  ): { driverId: string; distance: number } | null {
    // Debug: Check descriptor validity
    console.log(`[FaceRecognition] findBestMatch: descriptor length=${descriptor?.length}, stored drivers=${this.driverDescriptors.size}, threshold=${threshold}`);

    if (!descriptor || descriptor.length !== 128) {
      console.log(`[FaceRecognition] Invalid descriptor length: ${descriptor?.length}`);
      return null;
    }

    if (this.driverDescriptors.size === 0) {
      console.log('[FaceRecognition] No stored descriptors to match against');
      return null;
    }

    let bestMatch: { driverId: string; distance: number } | null = null;
    let closestDistance = Infinity;
    let closestDriverId = '';

    for (const [driverId, descriptors] of this.driverDescriptors.entries()) {
      // Find minimum distance across all descriptors for this driver
      for (const refDescriptor of descriptors) {
        const distance = this.euclideanDistance(descriptor, refDescriptor);

        // Track closest match even if above threshold (for debugging)
        if (distance < closestDistance) {
          closestDistance = distance;
          closestDriverId = driverId;
        }

        if (distance < threshold && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = { driverId, distance };
        }
      }
    }

    // Debug: Log closest match info
    console.log(`[FaceRecognition] Closest match: driver=${closestDriverId}, distance=${closestDistance.toFixed(4)}, threshold=${threshold}, matched=${bestMatch !== null}`);

    return bestMatch;
  }

  /**
   * Match detected faces against known faces
   * Called by renderer after face detection
   */
  matchFaces(
    detectedFaces: DetectedFace[],
    context: FaceContext = 'auto'
  ): FaceRecognitionResult {
    const startTime = Date.now();
    const config = CONTEXT_CONFIG[context];

    // Limit faces based on context
    const facesToProcess = detectedFaces.slice(0, config.maxFaces);
    const matchedDrivers: DriverMatch[] = [];

    for (let i = 0; i < facesToProcess.length; i++) {
      const face = facesToProcess[i];
      const match = this.findBestMatch(face.descriptor, config.matchThreshold);

      if (match) {
        const storedFace = this.storedFaces.get(match.driverId);
        if (storedFace) {
          matchedDrivers.push({
            faceIndex: i,
            driverId: storedFace.driverId,
            driverName: storedFace.driverName,
            team: storedFace.team,
            carNumber: storedFace.carNumber,
            confidence: 1 - match.distance, // Convert distance to confidence
            source: storedFace.source,
            referencePhotoUrl: storedFace.referencePhotoUrl
          });
        }
      }
    }

    const inferenceTimeMs = Date.now() - startTime;
    console.log(`[FaceRecognition] Matched ${matchedDrivers.length} of ${facesToProcess.length} faces in ${inferenceTimeMs}ms`);

    return {
      success: true,
      faces: facesToProcess,
      matchedDrivers,
      inferenceTimeMs
    };
  }

  /**
   * Legacy method - now delegates to renderer for detection
   * Returns empty result, actual detection happens in renderer
   */
  async detectAndRecognize(
    _imagePath: string,
    _context: FaceContext = 'auto'
  ): Promise<FaceRecognitionResult> {
    console.warn('[FaceRecognition] detectAndRecognize called - face detection should be done in renderer');
    return {
      success: false,
      faces: [],
      matchedDrivers: [],
      inferenceTimeMs: 0,
      error: 'Face detection must be done in renderer process. Use IPC channel "face-detection-request".'
    };
  }

  /**
   * Legacy method - descriptor generation must be done in renderer or Management Portal
   */
  async generateDescriptor(_imagePath: string): Promise<{
    success: boolean;
    descriptor?: number[];
    confidence?: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
    error?: string;
  }> {
    console.warn('[FaceRecognition] generateDescriptor called - must be done in renderer or Management Portal');
    return {
      success: false,
      error: 'Descriptor generation must be done in renderer process (browser Canvas API) or Management Portal'
    };
  }

  /**
   * Get the best match from detection results
   */
  getBestMatch(result: FaceRecognitionResult): DriverMatch | null {
    if (!result.success || result.matchedDrivers.length === 0) {
      return null;
    }

    // Return the match with highest confidence
    return result.matchedDrivers.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }

  /**
   * Clear loaded face descriptors
   */
  clearDescriptors(): void {
    this.storedFaces.clear();
    this.driverDescriptors.clear();
    console.log('[FaceRecognition] Cleared all face descriptors');
  }

  /**
   * Get count of loaded drivers
   */
  getDescriptorCount(): number {
    return this.storedFaces.size;
  }

  /**
   * Get model info
   */
  getModelInfo(): {
    isLoaded: boolean;
    modelsPath: string;
    driverCount: number;
    totalDescriptors: number;
  } {
    // Count total descriptors across all drivers
    let totalDescriptors = 0;
    for (const descriptors of this.driverDescriptors.values()) {
      totalDescriptors += descriptors.length;
    }

    return {
      isLoaded: this.isReady,
      modelsPath: '(not used - matching only)',
      driverCount: this.storedFaces.size,
      totalDescriptors
    };
  }

  /**
   * Get processor status
   */
  getStatus(): {
    isReady: boolean;
    driverCount: number;
    totalDescriptors: number;
  } {
    const info = this.getModelInfo();
    return {
      isReady: this.isReady,
      driverCount: info.driverCount,
      totalDescriptors: info.totalDescriptors
    };
  }

  /**
   * Load face descriptors from database for a sport category
   * Queries sport_category_face_photos (multi-photo support) first,
   * falls back to sport_category_faces.face_descriptor if no photos found
   */
  async loadFromDatabase(categoryCode: string): Promise<number> {
    try {
      // Import supabase client dynamically to avoid circular dependencies
      const { createClient } = await import('@supabase/supabase-js');
      const { SUPABASE_CONFIG } = await import('./config');

      const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

      // First get the sport category ID
      const { data: category, error: catError } = await supabase
        .from('sport_categories')
        .select('id')
        .eq('code', categoryCode)
        .single();

      if (catError || !category) {
        console.warn(`[FaceRecognition] Sport category not found: ${categoryCode}`);
        return 0;
      }

      // Query drivers for this category
      const { data: drivers, error: driversError } = await supabase
        .from('sport_category_faces')
        .select('id, driver_name, team, car_number, face_descriptor, reference_photo_url, is_active')
        .eq('sport_category_id', category.id)
        .eq('is_active', true);

      if (driversError) {
        console.error('[FaceRecognition] Error loading drivers from database:', driversError);
        return 0;
      }

      if (!drivers || drivers.length === 0) {
        console.log(`[FaceRecognition] No drivers found for category: ${categoryCode}`);
        return 0;
      }

      console.log(`[FaceRecognition] Found ${drivers.length} drivers for category ${categoryCode}`);

      // Query multi-photo descriptors from sport_category_face_photos
      const driverIds = drivers.map(d => d.id);
      const { data: photos, error: photosError } = await supabase
        .from('sport_category_face_photos')
        .select('face_id, photo_url, face_descriptor, photo_type, is_primary, detection_confidence')
        .in('face_id', driverIds);

      if (photosError) {
        console.warn('[FaceRecognition] Error loading face photos, falling back to main table:', photosError);
      }

      // Debug: Log query results
      console.log(`[FaceRecognition] Found ${photos?.length || 0} photos in sport_category_face_photos`);
      if (drivers.length > 0) {
        const first = drivers[0];
        console.log(`[FaceRecognition] First driver: name=${first.driver_name}, face_descriptor type=${typeof first.face_descriptor}, isArray=${Array.isArray(first.face_descriptor)}, length=${first.face_descriptor?.length || 0}`);
      }
      if (photos && photos.length > 0) {
        const firstPhoto = photos[0];
        console.log(`[FaceRecognition] First photo: face_descriptor type=${typeof firstPhoto.face_descriptor}, isArray=${Array.isArray(firstPhoto.face_descriptor)}, length=${firstPhoto.face_descriptor?.length || 0}`);
      }

      // Build descriptors array - prefer multi-photo table, fallback to main table
      const descriptors: StoredFaceDescriptor[] = [];

      for (const driver of drivers) {
        // Find photos for this driver
        const driverPhotos = photos?.filter(p => p.face_id === driver.id) || [];

        if (driverPhotos.length > 0) {
          // Use photos from multi-photo table
          for (const photo of driverPhotos) {
            const desc = this.parseDescriptor(photo.face_descriptor, driver.driver_name);
            if (desc && desc.length === 128) {
              descriptors.push({
                id: `${driver.id}-${descriptors.length}`,
                driverId: driver.id,
                driverName: driver.driver_name || 'Unknown',
                team: driver.team || '',
                carNumber: driver.car_number?.toString() || '',
                descriptor: desc,
                referencePhotoUrl: photo.photo_url,
                source: 'preset' as const,
                photoType: photo.photo_type || 'reference',
                isPrimary: photo.is_primary || false
              });
            }
          }
        } else {
          // Fallback to face_descriptor in main table
          const desc = this.parseDescriptor(driver.face_descriptor, driver.driver_name);
          if (desc && desc.length === 128) {
            descriptors.push({
              id: driver.id,
              driverId: driver.id,
              driverName: driver.driver_name || 'Unknown',
              team: driver.team || '',
              carNumber: driver.car_number?.toString() || '',
              descriptor: desc,
              referencePhotoUrl: driver.reference_photo_url,
              source: 'preset' as const,
              photoType: 'reference',
              isPrimary: true
            });
          }
        }
      }

      // Load into processor
      this.loadFaceDescriptors(descriptors);

      const driversWithDescriptors = new Set(descriptors.map(d => d.driverId)).size;
      console.log(`[FaceRecognition] Loaded ${descriptors.length} face descriptors for ${driversWithDescriptors} drivers in ${categoryCode}`);
      return descriptors.length;

    } catch (error) {
      console.error('[FaceRecognition] Failed to load from database:', error);
      return 0;
    }
  }

  /**
   * Parse descriptor from various formats (array, string JSON, etc.)
   */
  private parseDescriptor(descriptor: any, driverName: string): number[] | null {
    if (!descriptor) {
      return null;
    }
    if (Array.isArray(descriptor)) {
      return descriptor;
    }
    if (typeof descriptor === 'string') {
      try {
        return JSON.parse(descriptor);
      } catch (e) {
        console.error(`[FaceRecognition] Failed to parse descriptor for ${driverName}:`, e);
        return null;
      }
    }
    console.warn(`[FaceRecognition] Unknown descriptor type for ${driverName}: ${typeof descriptor}`);
    return null;
  }
}

// Export singleton instance
export const faceRecognitionProcessor = new FaceRecognitionProcessor();
