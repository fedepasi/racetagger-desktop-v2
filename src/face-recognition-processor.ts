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

export interface PersonMatch {
  faceIndex: number;
  personId: string;
  personName: string;
  personRole?: string;
  team: string;
  carNumber: string;
  confidence: number;
  source: 'global' | 'preset';
  referencePhotoUrl?: string;
}

// Alias for backward compatibility
export type DriverMatch = PersonMatch;

export interface FaceRecognitionResult {
  success: boolean;
  faces: DetectedFace[];
  matchedPersons: PersonMatch[];
  /** @deprecated Use matchedPersons instead */
  matchedDrivers: PersonMatch[];
  inferenceTimeMs: number;
  error?: string;
}

export interface StoredFaceDescriptor {
  id: string;
  personId: string;
  personName: string;
  personRole?: string;
  team: string;
  carNumber: string;
  descriptor: number[];
  referencePhotoUrl?: string;
  source: 'global' | 'preset';
  photoType?: string;    // 'reference', 'action', 'podium', 'helmet_off'
  isPrimary?: boolean;   // Whether this is the primary photo for display
  /** @deprecated Use personId instead */
  driverId?: string;
  /** @deprecated Use personName instead */
  driverName?: string;
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
  private personDescriptors: Map<string, number[][]> = new Map(); // personId -> array of descriptors

  constructor() {
    // Matching-only mode, no canvas required
  }

  /**
   * Initialize the processor (no models to load - matching only)
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    this.isReady = true;
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
    this.personDescriptors.clear();

    const validFaces = faces.filter(f => {
      const isValid = f.descriptor && Array.isArray(f.descriptor) && f.descriptor.length === 128;
      return isValid;
    });

    if (validFaces.length === 0) {
      return;
    }

    // Group descriptors by person (supports multiple photos per person)
    for (const face of validFaces) {
      const key = face.personId;

      // Store the primary face (or first face) for reference info
      const existing = this.storedFaces.get(key);
      if (!existing || face.isPrimary) {
        this.storedFaces.set(key, face);
      }

      // Add descriptor to person's array
      if (!this.personDescriptors.has(key)) {
        this.personDescriptors.set(key, []);
      }
      this.personDescriptors.get(key)!.push(face.descriptor);
    }
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
   * Find the best matching person for a given face descriptor
   */
  findBestMatch(
    descriptor: number[],
    threshold: number = 0.6
  ): { personId: string; distance: number } | null {
    if (!descriptor || descriptor.length !== 128) {
      return null;
    }

    if (this.personDescriptors.size === 0) {
      return null;
    }

    let bestMatch: { personId: string; distance: number } | null = null;
    let closestDistance = Infinity;
    let closestPersonId = '';

    for (const [personId, descriptors] of this.personDescriptors.entries()) {
      // Find minimum distance across all descriptors for this person
      for (const refDescriptor of descriptors) {
        const distance = this.euclideanDistance(descriptor, refDescriptor);

        // Track closest match even if above threshold (for debugging)
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPersonId = personId;
        }

        if (distance < threshold && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = { personId, distance };
        }
      }
    }

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
    const matchedPersons: PersonMatch[] = [];

    for (let i = 0; i < facesToProcess.length; i++) {
      const face = facesToProcess[i];
      const match = this.findBestMatch(face.descriptor, config.matchThreshold);

      if (match) {
        const storedFace = this.storedFaces.get(match.personId);
        if (storedFace) {
          matchedPersons.push({
            faceIndex: i,
            personId: storedFace.personId,
            personName: storedFace.personName,
            personRole: storedFace.personRole,
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

    return {
      success: true,
      faces: facesToProcess,
      matchedPersons,
      matchedDrivers: matchedPersons, // Backward compatibility
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
    return {
      success: false,
      faces: [],
      matchedPersons: [],
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
    return {
      success: false,
      error: 'Descriptor generation must be done in renderer process (browser Canvas API) or Management Portal'
    };
  }

  /**
   * Get the best match from detection results
   */
  getBestMatch(result: FaceRecognitionResult): PersonMatch | null {
    if (!result.success || result.matchedPersons.length === 0) {
      return null;
    }

    // Return the match with highest confidence
    return result.matchedPersons.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }

  /**
   * Clear loaded face descriptors
   */
  clearDescriptors(): void {
    this.storedFaces.clear();
    this.personDescriptors.clear();
  }

  /**
   * Get count of loaded persons
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
    personCount: number;
    /** @deprecated Use personCount instead */
    driverCount: number;
    totalDescriptors: number;
  } {
    // Count total descriptors across all persons
    let totalDescriptors = 0;
    for (const descriptors of this.personDescriptors.values()) {
      totalDescriptors += descriptors.length;
    }

    return {
      isLoaded: this.isReady,
      modelsPath: '(not used - matching only)',
      personCount: this.storedFaces.size,
      driverCount: this.storedFaces.size, // Backward compatibility
      totalDescriptors
    };
  }

  /**
   * Get processor status
   */
  getStatus(): {
    isReady: boolean;
    personCount: number;
    /** @deprecated Use personCount instead */
    driverCount: number;
    totalDescriptors: number;
  } {
    const info = this.getModelInfo();
    return {
      isReady: this.isReady,
      personCount: info.personCount,
      driverCount: info.personCount, // Backward compatibility
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
        return 0;
      }

      // Query persons for this category
      const { data: persons, error: personsError } = await supabase
        .from('sport_category_faces')
        .select('id, person_name, person_role, team, car_number, face_descriptor, reference_photo_url, is_active')
        .eq('sport_category_id', category.id)
        .eq('is_active', true);

      if (personsError) {
        console.error('[FaceRecognition] Error loading persons from database:', personsError);
        return 0;
      }

      if (!persons || persons.length === 0) {
        return 0;
      }

      // Query multi-photo descriptors from sport_category_face_photos
      const personIds = persons.map(p => p.id);
      const { data: photos, error: photosError } = await supabase
        .from('sport_category_face_photos')
        .select('face_id, photo_url, face_descriptor, photo_type, is_primary, detection_confidence')
        .in('face_id', personIds);

      if (photosError) {
        // Error loading face photos, falling back to main table
      }

      // Build descriptors array - prefer multi-photo table, fallback to main table
      const descriptors: StoredFaceDescriptor[] = [];

      for (const person of persons) {
        // Find photos for this person
        const personPhotos = photos?.filter(p => p.face_id === person.id) || [];

        if (personPhotos.length > 0) {
          // Use photos from multi-photo table
          for (const photo of personPhotos) {
            const desc = this.parseDescriptor(photo.face_descriptor, person.person_name);
            if (desc && desc.length === 128) {
              descriptors.push({
                id: `${person.id}-${descriptors.length}`,
                personId: person.id,
                personName: person.person_name || 'Unknown',
                personRole: person.person_role,
                team: person.team || '',
                carNumber: person.car_number?.toString() || '',
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
          const desc = this.parseDescriptor(person.face_descriptor, person.person_name);
          if (desc && desc.length === 128) {
            descriptors.push({
              id: person.id,
              personId: person.id,
              personName: person.person_name || 'Unknown',
              personRole: person.person_role,
              team: person.team || '',
              carNumber: person.car_number?.toString() || '',
              descriptor: desc,
              referencePhotoUrl: person.reference_photo_url,
              source: 'preset' as const,
              photoType: 'reference',
              isPrimary: true
            });
          }
        }
      }

      // Load into processor
      this.loadFaceDescriptors(descriptors);

      return descriptors.length;

    } catch (error) {
      console.error('[FaceRecognition] Failed to load from database:', error);
      return 0;
    }
  }

  /**
   * Parse descriptor from various formats (array, string JSON, etc.)
   */
  private parseDescriptor(descriptor: any, personName: string): number[] | null {
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
        console.error(`[FaceRecognition] Failed to parse descriptor for ${personName}:`, e);
        return null;
      }
    }
    return null;
  }
}

// Export singleton instance
export const faceRecognitionProcessor = new FaceRecognitionProcessor();
