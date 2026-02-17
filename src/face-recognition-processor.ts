/**
 * Face Recognition Processor (Matching Only)
 *
 * Handles face MATCHING using pre-computed descriptors.
 * Supports both legacy 128-dim (face-api.js euclidean) and
 * new 512-dim (AuraFace v1 cosine similarity) descriptors.
 *
 * Architecture (AuraFace v1):
 * - Main process: YuNet detection → AuraFace embedding → this file: matching
 * - No renderer/canvas dependencies
 *
 * Dual-read mode: reads face_descriptor_512 first, falls back to face_descriptor (128-dim)
 */

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
  descriptor: number[];  // 128-dim (legacy) or 512-dim (AuraFace)
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
  /** Similarity metric used: 'cosine' (512-dim) or 'euclidean' (128-dim legacy) */
  similarityMetric?: 'cosine' | 'euclidean';
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
  descriptor: number[];  // 128-dim or 512-dim
  referencePhotoUrl?: string;
  source: 'global' | 'preset';
  photoType?: string;    // 'reference', 'action', 'podium', 'helmet_off'
  isPrimary?: boolean;   // Whether this is the primary photo for display
  /** Descriptor dimension: 128 (face-api.js) or 512 (AuraFace v1) */
  descriptorDim?: number;
  /** @deprecated Use personId instead */
  driverId?: string;
  /** @deprecated Use personName instead */
  driverName?: string;
}

export type FaceContext = 'portrait' | 'action' | 'podium' | 'auto';

// ============================================
// Context-specific matching configurations
// ============================================

// Cosine similarity thresholds for 512-dim AuraFace
// Higher = stricter (cosine: 1.0 = identical, 0.0 = orthogonal)
const COSINE_CONTEXT_CONFIG: Record<FaceContext, {
  maxFaces: number;
  matchThreshold: number;  // Minimum cosine similarity for a match
}> = {
  portrait: {
    maxFaces: 1,
    matchThreshold: 0.65
  },
  action: {
    maxFaces: 3,
    matchThreshold: 0.58
  },
  podium: {
    maxFaces: 5,
    matchThreshold: 0.60
  },
  auto: {
    maxFaces: 5,
    matchThreshold: 0.62
  }
};

// Legacy euclidean distance thresholds for 128-dim face-api.js
// Lower = stricter (euclidean: 0.0 = identical)
const EUCLIDEAN_CONTEXT_CONFIG: Record<FaceContext, {
  maxFaces: number;
  matchThreshold: number;  // Maximum euclidean distance for a match
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
// Similarity Functions
// ============================================

/**
 * Cosine similarity between two vectors.
 * Returns value in range [-1, 1] (practically [0, 1] for L2-normalized face embeddings).
 * Higher = more similar.
 */
export function cosineSimilarity(d1: number[], d2: number[]): number {
  if (d1.length !== d2.length || d1.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < d1.length; i++) {
    dotProduct += d1[i] * d2[i];
    normA += d1[i] * d1[i];
    normB += d2[i] * d2[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Euclidean distance between two 128-dim vectors.
 * Returns value >= 0. Lower = more similar.
 */
function euclideanDistance128(d1: number[], d2: number[]): number {
  if (d1.length !== 128 || d2.length !== 128) return Infinity;

  let sum = 0;
  for (let i = 0; i < 128; i++) {
    const diff = d1[i] - d2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ============================================
// Face Recognition Processor Class
// ============================================

export class FaceRecognitionProcessor {
  private isReady: boolean = false;
  private storedFaces: Map<string, StoredFaceDescriptor> = new Map();
  private personDescriptors: Map<string, number[][]> = new Map(); // personId -> array of descriptors
  /** Detected dimension of loaded descriptors (128 or 512) */
  private descriptorDimension: number = 0;

  constructor() {}

  /**
   * Initialize the processor
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
   * Get the current descriptor dimension (128 or 512)
   */
  getDescriptorDimension(): number {
    return this.descriptorDimension;
  }

  /**
   * Detect whether we're using cosine (512-dim) or euclidean (128-dim)
   */
  private isCosineSimilarityMode(): boolean {
    return this.descriptorDimension === 512;
  }

  /**
   * Load face descriptors from database results.
   * Supports both 128-dim and 512-dim descriptors.
   * If mixed dimensions exist, 512-dim takes priority.
   */
  loadFaceDescriptors(faces: StoredFaceDescriptor[]): void {
    this.storedFaces.clear();
    this.personDescriptors.clear();
    this.descriptorDimension = 0;

    // Accept both 128-dim and 512-dim
    const validFaces = faces.filter(f => {
      if (!f.descriptor || !Array.isArray(f.descriptor)) return false;
      const dim = f.descriptor.length;
      return dim === 128 || dim === 512;
    });

    if (validFaces.length === 0) return;

    // Determine dominant dimension (prefer 512)
    const has512 = validFaces.some(f => f.descriptor.length === 512);
    const targetDim = has512 ? 512 : 128;
    this.descriptorDimension = targetDim;

    // Filter to only matching dimension
    const matchingFaces = validFaces.filter(f => f.descriptor.length === targetDim);

    if (matchingFaces.length < validFaces.length) {
      console.log(
        `[FaceRecognition] Using ${targetDim}-dim mode. ` +
        `${matchingFaces.length}/${validFaces.length} descriptors match.`
      );
    }

    // Group descriptors by person
    for (const face of matchingFaces) {
      const key = face.personId;

      const existing = this.storedFaces.get(key);
      if (!existing || face.isPrimary) {
        this.storedFaces.set(key, face);
      }

      if (!this.personDescriptors.has(key)) {
        this.personDescriptors.set(key, []);
      }
      this.personDescriptors.get(key)!.push(face.descriptor);
    }

    console.log(
      `[FaceRecognition] Loaded ${matchingFaces.length} descriptors (${targetDim}-dim) ` +
      `for ${this.storedFaces.size} persons. Mode: ${has512 ? 'cosine' : 'euclidean'}`
    );
  }

  /**
   * Find the best matching person for a given face descriptor.
   * Automatically uses cosine similarity (512-dim) or euclidean distance (128-dim).
   */
  findBestMatch(
    descriptor: number[],
    threshold: number,
    context: FaceContext = 'auto'
  ): { personId: string; score: number; metric: 'cosine' | 'euclidean' } | null {
    if (!descriptor || descriptor.length === 0) return null;
    if (this.personDescriptors.size === 0) return null;

    const useCosine = descriptor.length === 512 && this.descriptorDimension === 512;

    let bestPersonId = '';
    let bestScore = useCosine ? -Infinity : Infinity;

    for (const [personId, descriptors] of this.personDescriptors.entries()) {
      for (const refDescriptor of descriptors) {
        if (refDescriptor.length !== descriptor.length) continue;

        if (useCosine) {
          const similarity = cosineSimilarity(descriptor, refDescriptor);
          if (similarity > bestScore) {
            bestScore = similarity;
            bestPersonId = personId;
          }
        } else {
          const distance = euclideanDistance128(descriptor, refDescriptor);
          if (distance < bestScore) {
            bestScore = distance;
            bestPersonId = personId;
          }
        }
      }
    }

    // Check threshold
    if (useCosine) {
      // Cosine: higher = better, must exceed threshold
      if (bestScore >= threshold && bestPersonId) {
        return { personId: bestPersonId, score: bestScore, metric: 'cosine' };
      }
    } else {
      // Euclidean: lower = better, must be below threshold
      if (bestScore <= threshold && bestPersonId) {
        return { personId: bestPersonId, score: bestScore, metric: 'euclidean' };
      }
    }

    return null;
  }

  /**
   * Match detected faces against known faces.
   * Supports both 128-dim (euclidean) and 512-dim (cosine) modes.
   */
  matchFaces(
    detectedFaces: DetectedFace[],
    context: FaceContext = 'auto'
  ): FaceRecognitionResult {
    const startTime = Date.now();
    const useCosine = this.isCosineSimilarityMode();
    const config = useCosine ? COSINE_CONTEXT_CONFIG[context] : EUCLIDEAN_CONTEXT_CONFIG[context];

    const facesToProcess = detectedFaces.slice(0, config.maxFaces);
    const matchedPersons: PersonMatch[] = [];

    for (let i = 0; i < facesToProcess.length; i++) {
      const face = facesToProcess[i];
      const match = this.findBestMatch(face.descriptor, config.matchThreshold, context);

      if (match) {
        const storedFace = this.storedFaces.get(match.personId);
        if (storedFace) {
          // Convert score to confidence (0-1 range)
          const confidence = match.metric === 'cosine'
            ? match.score  // Cosine similarity is already 0-1
            : 1 - match.score;  // Euclidean: invert distance

          matchedPersons.push({
            faceIndex: i,
            personId: storedFace.personId,
            personName: storedFace.personName,
            personRole: storedFace.personRole,
            team: storedFace.team,
            carNumber: storedFace.carNumber,
            confidence,
            source: storedFace.source,
            referencePhotoUrl: storedFace.referencePhotoUrl,
            similarityMetric: match.metric
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
   * Match embeddings from ONNX processor against loaded descriptors.
   * This is the new primary method for the AuraFace pipeline.
   *
   * @param embeddings Array of {faceIndex, embedding} from FaceRecognitionOnnxProcessor
   * @param context Scene context for threshold selection
   */
  matchEmbeddings(
    embeddings: Array<{ faceIndex: number; embedding: number[] }>,
    context: FaceContext = 'auto'
  ): PersonMatch[] {
    if (this.personDescriptors.size === 0) return [];

    const useCosine = this.isCosineSimilarityMode();
    const config = useCosine
      ? COSINE_CONTEXT_CONFIG[context]
      : EUCLIDEAN_CONTEXT_CONFIG[context];

    const matches: PersonMatch[] = [];

    for (const { faceIndex, embedding } of embeddings) {
      // First, get best score WITHOUT threshold to log diagnostics
      const bestNoThreshold = this.findBestScoreNoThreshold(embedding);
      const match = this.findBestMatch(embedding, config.matchThreshold, context);

      if (match) {
        const storedFace = this.storedFaces.get(match.personId);
        if (storedFace) {
          const confidence = match.metric === 'cosine'
            ? match.score
            : 1 - match.score;

          console.log(
            `[FaceRecognition] ✅ Face ${faceIndex} MATCHED → ${storedFace.personName} ` +
            `(${match.metric}: ${match.score.toFixed(3)}, threshold: ${config.matchThreshold})`
          );

          matches.push({
            faceIndex,
            personId: storedFace.personId,
            personName: storedFace.personName,
            personRole: storedFace.personRole,
            team: storedFace.team,
            carNumber: storedFace.carNumber,
            confidence,
            source: storedFace.source,
            referencePhotoUrl: storedFace.referencePhotoUrl,
            similarityMetric: match.metric
          });
        }
      } else if (bestNoThreshold) {
        // Log the best score even when below threshold (diagnostic)
        const storedFace = this.storedFaces.get(bestNoThreshold.personId);
        const personName = storedFace?.personName || bestNoThreshold.personId;
        console.log(
          `[FaceRecognition] ❌ Face ${faceIndex} NO MATCH - best: ${personName} ` +
          `(${bestNoThreshold.metric}: ${bestNoThreshold.score.toFixed(3)}, threshold: ${config.matchThreshold})`
        );
      }
    }

    return matches;
  }

  /**
   * Find the best matching score without applying threshold (for diagnostics).
   */
  private findBestScoreNoThreshold(
    descriptor: number[]
  ): { personId: string; score: number; metric: 'cosine' | 'euclidean' } | null {
    if (!descriptor || descriptor.length === 0) return null;
    if (this.personDescriptors.size === 0) return null;

    const useCosine = descriptor.length === 512 && this.descriptorDimension === 512;
    let bestPersonId = '';
    let bestScore = useCosine ? -Infinity : Infinity;

    for (const [personId, descriptors] of this.personDescriptors.entries()) {
      for (const refDescriptor of descriptors) {
        if (refDescriptor.length !== descriptor.length) continue;
        if (useCosine) {
          const similarity = cosineSimilarity(descriptor, refDescriptor);
          if (similarity > bestScore) {
            bestScore = similarity;
            bestPersonId = personId;
          }
        } else {
          const distance = euclideanDistance128(descriptor, refDescriptor);
          if (distance < bestScore) {
            bestScore = distance;
            bestPersonId = personId;
          }
        }
      }
    }

    if (!bestPersonId) return null;
    return { personId: bestPersonId, score: bestScore, metric: useCosine ? 'cosine' : 'euclidean' };
  }

  /**
   * Legacy method - no longer needed with ONNX pipeline
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
      error: 'Use FaceRecognitionOnnxProcessor.detectAndEmbed() + matchFaces() instead.'
    };
  }

  /**
   * Legacy method - descriptor generation now done by ONNX
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
      error: 'Use FaceRecognitionOnnxProcessor.detectAndEmbed() for descriptor generation'
    };
  }

  /**
   * Get the best match from detection results
   */
  getBestMatch(result: FaceRecognitionResult): PersonMatch | null {
    if (!result.success || result.matchedPersons.length === 0) return null;
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
    this.descriptorDimension = 0;
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
    descriptorDimension: number;
    matchingMode: 'cosine' | 'euclidean' | 'none';
  } {
    let totalDescriptors = 0;
    for (const descriptors of this.personDescriptors.values()) {
      totalDescriptors += descriptors.length;
    }

    return {
      isLoaded: this.isReady,
      modelsPath: '(ONNX - main process)',
      personCount: this.storedFaces.size,
      driverCount: this.storedFaces.size,
      totalDescriptors,
      descriptorDimension: this.descriptorDimension,
      matchingMode: this.descriptorDimension === 512 ? 'cosine'
        : this.descriptorDimension === 128 ? 'euclidean'
        : 'none'
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
    descriptorDimension: number;
    matchingMode: string;
  } {
    const info = this.getModelInfo();
    return {
      isReady: this.isReady,
      personCount: info.personCount,
      driverCount: info.personCount,
      totalDescriptors: info.totalDescriptors,
      descriptorDimension: info.descriptorDimension,
      matchingMode: info.matchingMode
    };
  }

  /**
   * Load face descriptors from a participant preset.
   * Dual-read: prefers face_descriptor_512, falls back to face_descriptor.
   */
  async loadFromPreset(presetId: string): Promise<number> {
    try {
      const { loadPresetFaceDescriptors } = await import('./database-service');

      const descriptors = await loadPresetFaceDescriptors(presetId);

      if (!descriptors || descriptors.length === 0) {
        console.log(`[FaceRecognition] No face descriptors found in preset ${presetId}`);
        return 0;
      }

      // Convert to StoredFaceDescriptor format
      const storedDescriptors: StoredFaceDescriptor[] = descriptors.map(d => ({
        id: `preset-${d.personId}-${Math.random().toString(36).substr(2, 9)}`,
        personId: d.personId,
        personName: d.personName,
        team: d.team,
        carNumber: d.carNumber,
        descriptor: d.descriptor,
        referencePhotoUrl: d.referencePhotoUrl,
        source: 'preset' as const,
        photoType: d.photoType,
        isPrimary: d.isPrimary,
        descriptorDim: d.descriptor.length
      }));

      this.loadFaceDescriptors(storedDescriptors);

      console.log(`[FaceRecognition] Loaded ${storedDescriptors.length} face descriptors from preset ${presetId}`);
      return storedDescriptors.length;
    } catch (error) {
      console.error('[FaceRecognition] Failed to load from preset:', error);
      return 0;
    }
  }

  /**
   * Parse descriptor from various formats (array, string JSON, etc.)
   */
  private parseDescriptor(descriptor: any, personName: string): number[] | null {
    if (!descriptor) return null;
    if (Array.isArray(descriptor)) return descriptor;
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
