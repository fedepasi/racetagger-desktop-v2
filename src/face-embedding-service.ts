/**
 * Face Embedding Service - AuraFace v1 ONNX
 *
 * Generates 512-dimensional face embeddings using AuraFace v1 (ResNet100).
 * Runs entirely in the main process via onnxruntime-node.
 *
 * Model: AuraFace v1 (~250MB ONNX, Apache 2.0)
 * Input: 112x112 RGB, normalized (pixel - 127.5) / 128.0
 * Output: 512-dimensional float32 embedding (L2-normalized)
 * Performance target: <100ms per face crop
 *
 * AuraFace is downloaded on-demand via ModelManager and cached
 * in ~/.racetagger/models/auraface-v1/
 *
 * @see docs/ROADMAP-SOTA.md section 3.11 Phase 1
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import sharp from 'sharp';

// ONNX Runtime - lazy loaded
let ort: typeof import('onnxruntime-node') | null = null;

// ============================================
// Type Definitions
// ============================================

/**
 * Face embedding result for a single face
 */
export interface FaceEmbedding {
  /** 512-dimensional embedding vector (L2-normalized) */
  embedding: number[];
  /** Embedding generation time in ms */
  inferenceTimeMs: number;
}

/**
 * Result from embedding service
 */
export interface FaceEmbeddingServiceResult {
  success: boolean;
  embedding?: number[];
  inferenceTimeMs: number;
  error?: string;
}

// ============================================
// Constants
// ============================================

/** AuraFace model identifier for ModelManager */
export const AURAFACE_MODEL_ID = 'auraface-v1';

/** AuraFace model filename */
export const AURAFACE_MODEL_FILENAME = 'auraface_v1.onnx';

/** Expected embedding dimensions */
export const AURAFACE_EMBEDDING_DIM = 512;

// ============================================
// Face Embedding Service (AuraFace v1 ONNX)
// ============================================

/**
 * AuraFace v1 face embedding service.
 * Singleton pattern following SceneClassifierONNX.
 *
 * The AuraFace model is NOT bundled with the app (too large ~250MB).
 * It's downloaded on-demand and cached locally.
 */
export class FaceEmbeddingService {
  private static instance: FaceEmbeddingService | null = null;
  private session: any = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;

  // Model configuration
  private readonly INPUT_SIZE = 112; // AuraFace input: 112x112
  private readonly EMBEDDING_DIM = AURAFACE_EMBEDDING_DIM;

  // Normalization constants (AuraFace standard)
  private readonly NORM_MEAN = 127.5;
  private readonly NORM_STD = 128.0;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): FaceEmbeddingService {
    if (!FaceEmbeddingService.instance) {
      FaceEmbeddingService.instance = new FaceEmbeddingService();
    }
    return FaceEmbeddingService.instance;
  }

  /**
   * Initialize ONNX Runtime (lazy)
   */
  private async initONNXRuntime(): Promise<boolean> {
    if (ort) return true;
    try {
      ort = require('onnxruntime-node');
      return true;
    } catch (error) {
      console.error('[FaceEmbeddingService] Failed to load ONNX Runtime:', error);
      return false;
    }
  }

  /**
   * Get the local path for the AuraFace model.
   * Checks ModelManager cache directory.
   */
  private getModelPath(): string | null {
    const cacheDir = path.join(app.getPath('userData'), 'models', 'auraface-v1');
    const modelPath = path.join(cacheDir, AURAFACE_MODEL_FILENAME);

    if (fs.existsSync(modelPath)) {
      return modelPath;
    }

    // Also check generic model cache pattern
    const altPaths = [
      path.join(app.getPath('userData'), 'models', AURAFACE_MODEL_FILENAME),
      path.join(process.cwd(), 'models', 'auraface-v1', AURAFACE_MODEL_FILENAME),
      path.join(process.cwd(), 'src', 'assets', 'models', 'auraface-v1', AURAFACE_MODEL_FILENAME),
    ];

    for (const altPath of altPaths) {
      if (fs.existsSync(altPath)) {
        return altPath;
      }
    }

    return null;
  }

  /**
   * Check if the AuraFace model is available locally
   */
  public isModelAvailable(): boolean {
    return this.getModelPath() !== null;
  }

  /**
   * Get the expected model cache directory
   */
  public getModelCacheDir(): string {
    return path.join(app.getPath('userData'), 'models', 'auraface-v1');
  }

  /**
   * Load the AuraFace ONNX model.
   * If modelPath is provided, uses that directly.
   * Otherwise searches in standard locations.
   */
  public async loadModel(modelPath?: string): Promise<boolean> {
    if (this.session) return true;

    if (this.isLoading) {
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.session !== null;
    }

    if (this.loadError) throw this.loadError;

    this.isLoading = true;

    try {
      const ortReady = await this.initONNXRuntime();
      if (!ortReady || !ort) {
        throw new Error('ONNX Runtime initialization failed');
      }

      const resolvedPath = modelPath || this.getModelPath();
      if (!resolvedPath) {
        throw new Error(
          'AuraFace model not found. Please download it first via ModelManager. ' +
          `Expected in: ${this.getModelCacheDir()}`
        );
      }

      console.log(`[FaceEmbeddingService] Loading AuraFace v1 from: ${resolvedPath}`);

      const sessionOptions: any = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
      };

      this.session = await ort.InferenceSession.create(resolvedPath, sessionOptions);

      console.log(
        `[FaceEmbeddingService] AuraFace v1 loaded. ` +
        `Inputs: [${this.session.inputNames}], Outputs: [${this.session.outputNames}]`
      );

      // Warm up
      await this.warmUp();

      return true;
    } catch (error) {
      this.loadError = error as Error;
      console.error('[FaceEmbeddingService] Failed to load AuraFace:', error);
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Warm up with dummy inference
   */
  private async warmUp(): Promise<void> {
    if (!this.session || !ort) return;
    try {
      const dummyData = new Float32Array(1 * 3 * this.INPUT_SIZE * this.INPUT_SIZE).fill(0);
      const dummyTensor = new ort.Tensor(
        'float32',
        dummyData,
        [1, 3, this.INPUT_SIZE, this.INPUT_SIZE]
      );
      const feeds: Record<string, any> = {};
      feeds[this.session.inputNames[0]] = dummyTensor;
      await this.session.run(feeds);
      console.log('[FaceEmbeddingService] Warm-up complete');
    } catch (error) {
      console.warn('[FaceEmbeddingService] Warm-up failed (non-critical):', error);
    }
  }

  /**
   * Preprocess a face crop for AuraFace input.
   * AuraFace expects: 112x112, RGB, NCHW, (pixel - 127.5) / 128.0
   */
  private async preprocessFaceCrop(imageBuffer: Buffer): Promise<Float32Array> {
    // Resize to 112x112
    const { data: rawBuffer } = await sharp(imageBuffer)
      .resize(this.INPUT_SIZE, this.INPUT_SIZE, {
        fit: 'fill'
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert from HWC RGB to NCHW RGB, normalized
    const pixelCount = this.INPUT_SIZE * this.INPUT_SIZE;
    const floatData = new Float32Array(3 * pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const r = rawBuffer[i * 3];
      const g = rawBuffer[i * 3 + 1];
      const b = rawBuffer[i * 3 + 2];

      // RGB order (AuraFace uses RGB, not BGR), channels-first (NCHW)
      // Normalize: (pixel - 127.5) / 128.0
      floatData[0 * pixelCount + i] = (r - this.NORM_MEAN) / this.NORM_STD;
      floatData[1 * pixelCount + i] = (g - this.NORM_MEAN) / this.NORM_STD;
      floatData[2 * pixelCount + i] = (b - this.NORM_MEAN) / this.NORM_STD;
    }

    return floatData;
  }

  /**
   * L2-normalize an embedding vector
   */
  private l2Normalize(embedding: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < embedding.length; i++) {
      sumSq += embedding[i] * embedding[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return embedding;

    return embedding.map(v => v / norm);
  }

  /**
   * Generate embedding for a face crop buffer.
   * The buffer should contain a cropped face image (any size, will be resized).
   */
  public async embed(faceCropBuffer: Buffer): Promise<FaceEmbeddingServiceResult> {
    if (!this.session) {
      const loaded = await this.loadModel();
      if (!loaded) {
        return {
          success: false,
          inferenceTimeMs: 0,
          error: 'Failed to load AuraFace model'
        };
      }
    }

    if (!ort) {
      return {
        success: false,
        inferenceTimeMs: 0,
        error: 'ONNX Runtime not initialized'
      };
    }

    const startTime = Date.now();

    try {
      // Preprocess
      const inputData = await this.preprocessFaceCrop(faceCropBuffer);

      // Create input tensor [1, 3, 112, 112]
      const inputTensor = new ort.Tensor(
        'float32',
        inputData,
        [1, 3, this.INPUT_SIZE, this.INPUT_SIZE]
      );

      // Run inference
      const feeds: Record<string, any> = {};
      feeds[this.session.inputNames[0]] = inputTensor;
      const results = await this.session.run(feeds);

      // Extract embedding
      const outputName = this.session.outputNames[0];
      const outputTensor = results[outputName];
      const rawEmbedding = Array.from(outputTensor.data as Float32Array);

      // Validate dimensions
      if (rawEmbedding.length !== this.EMBEDDING_DIM) {
        console.warn(
          `[FaceEmbeddingService] Unexpected embedding dim: ${rawEmbedding.length}, expected ${this.EMBEDDING_DIM}`
        );
      }

      // L2 normalize
      const embedding = this.l2Normalize(rawEmbedding);

      const inferenceTimeMs = Date.now() - startTime;

      return {
        success: true,
        embedding,
        inferenceTimeMs
      };
    } catch (error) {
      console.error('[FaceEmbeddingService] Embedding failed:', error);
      return {
        success: false,
        inferenceTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown embedding error'
      };
    }
  }

  /**
   * Check if model is loaded and ready
   */
  public isModelLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Get model info
   */
  public getModelInfo(): {
    isLoaded: boolean;
    embeddingDim: number;
    inputSize: number;
    modelId: string;
    isAvailable: boolean;
  } {
    return {
      isLoaded: this.session !== null,
      embeddingDim: this.EMBEDDING_DIM,
      inputSize: this.INPUT_SIZE,
      modelId: AURAFACE_MODEL_ID,
      isAvailable: this.isModelAvailable()
    };
  }

  /**
   * Dispose model and free memory
   */
  public dispose(): void {
    if (this.session) {
      this.session = null;
    }
    this.loadError = null;
    FaceEmbeddingService.instance = null;
    console.log('[FaceEmbeddingService] Disposed');
  }
}

// Helper exports
export function getFaceEmbeddingService(): FaceEmbeddingService {
  return FaceEmbeddingService.getInstance();
}
