/**
 * Face Recognition ONNX Processor (Orchestrator)
 *
 * Orchestrates the full face recognition pipeline:
 *   1. Load image with Sharp (handles EXIF rotation)
 *   2. YuNet face detection → bounding boxes
 *   3. Crop each face → AuraFace embedding → 512-dim vector
 *   4. Return array of embeddings for matching
 *
 * All processing happens in the main process. No renderer/canvas needed.
 *
 * @see docs/ROADMAP-SOTA.md section 3.11 Phase 1
 */

import * as fs from 'fs';
import sharp from 'sharp';
import { FaceDetectorService, DetectedFaceRegion } from './face-detector-service';
import { FaceEmbeddingService, AURAFACE_EMBEDDING_DIM } from './face-embedding-service';

// ============================================
// Type Definitions
// ============================================

/**
 * A detected face with its embedding
 */
export interface FaceWithEmbedding {
  /** Index of this face in the detection results */
  faceIndex: number;
  /** Bounding box (normalized 0-1) */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Detection confidence from YuNet */
  detectionConfidence: number;
  /** 5 facial landmarks from YuNet */
  landmarks: [number, number][];
  /** 512-dimensional embedding from AuraFace */
  embedding: number[];
  /** Embedding dimension (512) */
  embeddingDim: number;
}

/**
 * Full pipeline result
 */
export interface FaceRecognitionOnnxResult {
  success: boolean;
  faces: FaceWithEmbedding[];
  /** Time for YuNet detection */
  detectionTimeMs: number;
  /** Time for AuraFace embedding (all faces) */
  embeddingTimeMs: number;
  /** Total pipeline time */
  totalTimeMs: number;
  /** Original image dimensions */
  imageWidth: number;
  imageHeight: number;
  error?: string;
}

/**
 * Initialization status
 */
export interface FaceRecognitionOnnxStatus {
  detectorLoaded: boolean;
  embedderLoaded: boolean;
  embedderAvailable: boolean;
  embeddingDim: number;
  ready: boolean;
}

// ============================================
// Face Recognition ONNX Processor
// ============================================

/**
 * Orchestrates YuNet detection + AuraFace embedding.
 * Singleton pattern.
 */
export class FaceRecognitionOnnxProcessor {
  private static instance: FaceRecognitionOnnxProcessor | null = null;
  private detector: FaceDetectorService;
  private embedder: FaceEmbeddingService;
  private initPromise: Promise<boolean> | null = null;

  // Configuration
  private readonly MIN_FACE_SIZE = 0.02; // Minimum face size as fraction of image (2%)
  private readonly CROP_PADDING = 0.25; // Padding around face bbox for better embedding (25%)

  private constructor() {
    this.detector = FaceDetectorService.getInstance();
    this.embedder = FaceEmbeddingService.getInstance();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): FaceRecognitionOnnxProcessor {
    if (!FaceRecognitionOnnxProcessor.instance) {
      FaceRecognitionOnnxProcessor.instance = new FaceRecognitionOnnxProcessor();
    }
    return FaceRecognitionOnnxProcessor.instance;
  }

  /**
   * Initialize both models.
   * YuNet is always bundled. AuraFace may need download.
   * Returns true if at least detector is loaded (embedding can be loaded later).
   */
  public async initialize(): Promise<boolean> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<boolean> {
    try {
      // Load YuNet (bundled, fast)
      const detectorLoaded = await this.detector.loadModel();
      if (!detectorLoaded) {
        console.error('[FaceRecognitionOnnx] Failed to load YuNet detector');
        return false;
      }
      console.log('[FaceRecognitionOnnx] YuNet detector loaded');

      // Try to load AuraFace (may not be available yet)
      if (this.embedder.isModelAvailable()) {
        const embedderLoaded = await this.embedder.loadModel();
        if (embedderLoaded) {
          console.log('[FaceRecognitionOnnx] AuraFace embedder loaded');
        } else {
          console.warn('[FaceRecognitionOnnx] AuraFace available but failed to load');
        }
      } else {
        console.info(
          '[FaceRecognitionOnnx] AuraFace model not yet downloaded. ' +
          'Detection will work, embedding requires model download.'
        );
      }

      return true;
    } catch (error) {
      console.error('[FaceRecognitionOnnx] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Ensure the embedder is loaded (download if needed via ModelManager).
   * Call this when you need embedding, not just detection.
   */
  public async ensureEmbedderReady(modelPath?: string): Promise<boolean> {
    if (this.embedder.isModelLoaded()) return true;
    return this.embedder.loadModel(modelPath);
  }

  /**
   * Crop a face from the image with padding.
   * Returns a buffer of the cropped face ready for embedding.
   */
  private async cropFace(
    imageBuffer: Buffer,
    face: DetectedFaceRegion,
    imageWidth: number,
    imageHeight: number
  ): Promise<Buffer> {
    // Convert normalized coords to pixels
    const faceX = face.x * imageWidth;
    const faceY = face.y * imageHeight;
    const faceW = face.width * imageWidth;
    const faceH = face.height * imageHeight;

    // Add padding for better embedding quality
    const padX = faceW * this.CROP_PADDING;
    const padY = faceH * this.CROP_PADDING;

    // Compute crop region (clamped to image bounds)
    const left = Math.max(0, Math.round(faceX - padX));
    const top = Math.max(0, Math.round(faceY - padY));
    const right = Math.min(imageWidth, Math.round(faceX + faceW + padX));
    const bottom = Math.min(imageHeight, Math.round(faceY + faceH + padY));

    const cropWidth = right - left;
    const cropHeight = bottom - top;

    if (cropWidth < 10 || cropHeight < 10) {
      throw new Error(`Face crop too small: ${cropWidth}x${cropHeight}`);
    }

    // Extract crop using Sharp
    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left,
        top,
        width: cropWidth,
        height: cropHeight
      })
      .jpeg({ quality: 95 })
      .toBuffer();

    return croppedBuffer;
  }

  /**
   * Main pipeline: detect faces and generate embeddings.
   *
   * @param imagePath Path to image file
   * @returns Detection + embedding results for all faces
   */
  public async detectAndEmbed(imagePath: string): Promise<FaceRecognitionOnnxResult> {
    const startTime = Date.now();
    let detectionTimeMs = 0;
    let embeddingTimeMs = 0;

    try {
      // Validate file
      if (!fs.existsSync(imagePath)) {
        return {
          success: false,
          faces: [],
          detectionTimeMs: 0,
          embeddingTimeMs: 0,
          totalTimeMs: 0,
          imageWidth: 0,
          imageHeight: 0,
          error: `Image file not found: ${imagePath}`
        };
      }

      // Load image (Sharp handles EXIF rotation automatically)
      const imageBuffer = await sharp(imagePath)
        .rotate() // Auto-rotate based on EXIF
        .toBuffer();

      const metadata = await sharp(imageBuffer).metadata();
      const imageWidth = metadata.width || 0;
      const imageHeight = metadata.height || 0;

      // Step 1: Face detection with YuNet
      const detectionStart = Date.now();
      const detectionResult = await this.detector.detect(imageBuffer);
      detectionTimeMs = Date.now() - detectionStart;

      if (!detectionResult.success || detectionResult.faces.length === 0) {
        return {
          success: true,
          faces: [],
          detectionTimeMs,
          embeddingTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
          imageWidth,
          imageHeight
        };
      }

      // Filter out tiny faces
      const validFaces = detectionResult.faces.filter(f =>
        f.width >= this.MIN_FACE_SIZE && f.height >= this.MIN_FACE_SIZE
      );

      if (validFaces.length === 0) {
        return {
          success: true,
          faces: [],
          detectionTimeMs,
          embeddingTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
          imageWidth,
          imageHeight
        };
      }

      // Step 2: Generate embeddings (if embedder is available)
      const embeddingStart = Date.now();
      const facesWithEmbeddings: FaceWithEmbedding[] = [];

      const embedderReady = this.embedder.isModelLoaded();

      for (let i = 0; i < validFaces.length; i++) {
        const face = validFaces[i];

        const faceResult: FaceWithEmbedding = {
          faceIndex: i,
          boundingBox: {
            x: face.x,
            y: face.y,
            width: face.width,
            height: face.height
          },
          detectionConfidence: face.confidence,
          landmarks: face.landmarks,
          embedding: [],
          embeddingDim: 0
        };

        if (embedderReady) {
          try {
            // Crop face from original image
            const faceCrop = await this.cropFace(
              imageBuffer,
              face,
              imageWidth,
              imageHeight
            );

            // Generate embedding
            const embeddingResult = await this.embedder.embed(faceCrop);

            if (embeddingResult.success && embeddingResult.embedding) {
              faceResult.embedding = embeddingResult.embedding;
              faceResult.embeddingDim = embeddingResult.embedding.length;
            }
          } catch (cropError) {
            console.warn(
              `[FaceRecognitionOnnx] Failed to embed face ${i}:`,
              cropError instanceof Error ? cropError.message : cropError
            );
          }
        }

        facesWithEmbeddings.push(faceResult);
      }

      embeddingTimeMs = Date.now() - embeddingStart;

      return {
        success: true,
        faces: facesWithEmbeddings,
        detectionTimeMs,
        embeddingTimeMs,
        totalTimeMs: Date.now() - startTime,
        imageWidth,
        imageHeight
      };
    } catch (error) {
      console.error('[FaceRecognitionOnnx] Pipeline failed:', error);
      return {
        success: false,
        faces: [],
        detectionTimeMs,
        embeddingTimeMs,
        totalTimeMs: Date.now() - startTime,
        imageWidth: 0,
        imageHeight: 0,
        error: error instanceof Error ? error.message : 'Unknown pipeline error'
      };
    }
  }

  /**
   * Detect faces and generate embedding from a buffer (e.g., uploaded photo).
   * Useful for photo upload flow where we have a buffer, not a file path.
   */
  public async detectAndEmbedFromBuffer(imageBuffer: Buffer): Promise<FaceRecognitionOnnxResult> {
    const startTime = Date.now();
    let detectionTimeMs = 0;
    let embeddingTimeMs = 0;

    try {
      // Auto-rotate
      const rotatedBuffer = await sharp(imageBuffer)
        .rotate()
        .toBuffer();

      const metadata = await sharp(rotatedBuffer).metadata();
      const imageWidth = metadata.width || 0;
      const imageHeight = metadata.height || 0;

      // Step 1: Detection
      const detectionStart = Date.now();
      const detectionResult = await this.detector.detect(rotatedBuffer);
      detectionTimeMs = Date.now() - detectionStart;

      if (!detectionResult.success || detectionResult.faces.length === 0) {
        return {
          success: true,
          faces: [],
          detectionTimeMs,
          embeddingTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
          imageWidth,
          imageHeight
        };
      }

      const validFaces = detectionResult.faces.filter(f =>
        f.width >= this.MIN_FACE_SIZE && f.height >= this.MIN_FACE_SIZE
      );

      // Step 2: Embedding
      const embeddingStart = Date.now();
      const facesWithEmbeddings: FaceWithEmbedding[] = [];
      const embedderReady = this.embedder.isModelLoaded();

      for (let i = 0; i < validFaces.length; i++) {
        const face = validFaces[i];

        const faceResult: FaceWithEmbedding = {
          faceIndex: i,
          boundingBox: {
            x: face.x,
            y: face.y,
            width: face.width,
            height: face.height
          },
          detectionConfidence: face.confidence,
          landmarks: face.landmarks,
          embedding: [],
          embeddingDim: 0
        };

        if (embedderReady) {
          try {
            const faceCrop = await this.cropFace(rotatedBuffer, face, imageWidth, imageHeight);
            const embeddingResult = await this.embedder.embed(faceCrop);

            if (embeddingResult.success && embeddingResult.embedding) {
              faceResult.embedding = embeddingResult.embedding;
              faceResult.embeddingDim = embeddingResult.embedding.length;
            }
          } catch (cropError) {
            console.warn(
              `[FaceRecognitionOnnx] Failed to embed face ${i} from buffer:`,
              cropError instanceof Error ? cropError.message : cropError
            );
          }
        }

        facesWithEmbeddings.push(faceResult);
      }

      embeddingTimeMs = Date.now() - embeddingStart;

      return {
        success: true,
        faces: facesWithEmbeddings,
        detectionTimeMs,
        embeddingTimeMs,
        totalTimeMs: Date.now() - startTime,
        imageWidth,
        imageHeight
      };
    } catch (error) {
      console.error('[FaceRecognitionOnnx] Buffer pipeline failed:', error);
      return {
        success: false,
        faces: [],
        detectionTimeMs,
        embeddingTimeMs,
        totalTimeMs: Date.now() - startTime,
        imageWidth: 0,
        imageHeight: 0,
        error: error instanceof Error ? error.message : 'Unknown pipeline error'
      };
    }
  }

  /**
   * Get current status of both models
   */
  public getStatus(): FaceRecognitionOnnxStatus {
    const embedderInfo = this.embedder.getModelInfo();
    return {
      detectorLoaded: this.detector.isModelLoaded(),
      embedderLoaded: embedderInfo.isLoaded,
      embedderAvailable: embedderInfo.isAvailable,
      embeddingDim: AURAFACE_EMBEDDING_DIM,
      ready: this.detector.isModelLoaded() && embedderInfo.isLoaded
    };
  }

  /**
   * Dispose both models and free memory
   */
  public dispose(): void {
    this.detector.dispose();
    this.embedder.dispose();
    this.initPromise = null;
    FaceRecognitionOnnxProcessor.instance = null;
    console.log('[FaceRecognitionOnnx] Processor disposed');
  }
}

// Helper exports
export function getFaceRecognitionOnnxProcessor(): FaceRecognitionOnnxProcessor {
  return FaceRecognitionOnnxProcessor.getInstance();
}
