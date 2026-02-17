/**
 * Face Detector Service - YuNet ONNX
 *
 * Local face detection using YuNet ONNX model (~90KB, Apache 2.0).
 * Runs entirely in the main process via onnxruntime-node.
 * No browser/canvas dependencies required.
 *
 * Replaces face-api.js renderer-based detection.
 *
 * Model: YuNet (face_detection_yunet_2023mar.onnx)
 * Input: 640x640 RGB
 * Output: Face bounding boxes + 5 landmarks + confidence
 * Performance target: <50ms per image
 *
 * @see docs/ROADMAP-SOTA.md section 3.11 Phase 1
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import sharp from 'sharp';
import { createComponentLogger } from './utils/logger';

const log = createComponentLogger('FaceDetectorService');

// ONNX Runtime - lazy loaded
let ort: typeof import('onnxruntime-node') | null = null;

// ============================================
// Type Definitions
// ============================================

/**
 * A single detected face region
 */
export interface DetectedFaceRegion {
  /** Bounding box (normalized 0-1 coordinates relative to original image) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Detection confidence (0-1) */
  confidence: number;
  /** 5 facial landmarks: left_eye, right_eye, nose, left_mouth, right_mouth */
  landmarks: [number, number][];
}

/**
 * Face detection result
 */
export interface FaceDetectionServiceResult {
  success: boolean;
  faces: DetectedFaceRegion[];
  inferenceTimeMs: number;
  imageWidth: number;
  imageHeight: number;
  error?: string;
}

// ============================================
// Face Detector Service (YuNet ONNX)
// ============================================

/**
 * YuNet-based face detector running in main process via ONNX Runtime.
 * Singleton pattern following SceneClassifierONNX.
 */
export class FaceDetectorService {
  private static instance: FaceDetectorService | null = null;
  private session: any = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;

  // Model configuration
  private readonly INPUT_WIDTH = 640;
  private readonly INPUT_HEIGHT = 640;
  private readonly MODEL_DIR = 'src/assets/models/yunet';
  private readonly ONNX_MODEL_NAME = 'face_detection_yunet_2023mar.onnx';

  // Detection thresholds
  private readonly CONFIDENCE_THRESHOLD = 0.7;
  private readonly NMS_IOU_THRESHOLD = 0.5;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): FaceDetectorService {
    if (!FaceDetectorService.instance) {
      FaceDetectorService.instance = new FaceDetectorService();
    }
    return FaceDetectorService.instance;
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
      log.error('[FaceDetectorService] Failed to load ONNX Runtime:', error);
      return false;
    }
  }

  /**
   * Resolve model path (dev / packaged / resources)
   */
  private getModelPath(): string {
    // Development
    const devPath = path.join(process.cwd(), this.MODEL_DIR, this.ONNX_MODEL_NAME);
    if (fs.existsSync(devPath)) return devPath;

    // Packaged app (asar.unpacked)
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      const unpackedPath = path.join(
        appPath.replace('app.asar', 'app.asar.unpacked'),
        this.MODEL_DIR,
        this.ONNX_MODEL_NAME
      );
      if (fs.existsSync(unpackedPath)) return unpackedPath;
    }

    // Packaged app (inside asar)
    const prodPath = path.join(appPath, this.MODEL_DIR, this.ONNX_MODEL_NAME);
    if (fs.existsSync(prodPath)) return prodPath;

    // Resources directory
    const resourcesPath = path.join(
      process.resourcesPath || '',
      'app',
      this.MODEL_DIR,
      this.ONNX_MODEL_NAME
    );
    if (fs.existsSync(resourcesPath)) return resourcesPath;

    throw new Error(
      `YuNet model not found. Searched: ${devPath}, ${prodPath}, ${resourcesPath}`
    );
  }

  /**
   * Load the YuNet ONNX model
   */
  public async loadModel(): Promise<boolean> {
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

      const modelPath = this.getModelPath();
      console.log(`[FaceDetectorService] Loading YuNet from: ${modelPath}`);

      const sessionOptions: any = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
      };

      this.session = await ort.InferenceSession.create(modelPath, sessionOptions);

      console.log(`[FaceDetectorService] YuNet loaded. Inputs: [${this.session.inputNames}], Outputs: [${this.session.outputNames}]`);

      // Warm up
      await this.warmUp();

      return true;
    } catch (error) {
      this.loadError = error as Error;
      log.error('[FaceDetectorService] Failed to load YuNet:', error);
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
      const dummyData = new Float32Array(1 * 3 * this.INPUT_HEIGHT * this.INPUT_WIDTH).fill(0);
      const dummyTensor = new ort.Tensor('float32', dummyData, [1, 3, this.INPUT_HEIGHT, this.INPUT_WIDTH]);
      const feeds: Record<string, any> = {};
      feeds[this.session.inputNames[0]] = dummyTensor;
      await this.session.run(feeds);
      log.info('[FaceDetectorService] Warm-up complete');
    } catch (error) {
      // Non-critical
      log.warn('[FaceDetectorService] Warm-up failed (non-critical):', error);
    }
  }

  /**
   * Preprocess image buffer for YuNet input.
   * YuNet expects NCHW format, BGR order, float32, no normalization (0-255 range).
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<{
    tensor: Float32Array;
    originalWidth: number;
    originalHeight: number;
  }> {
    // Get original dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 640;
    const originalHeight = metadata.height || 640;

    // Resize to 640x640, keep raw RGB
    const { data: rawBuffer } = await sharp(imageBuffer)
      .resize(this.INPUT_WIDTH, this.INPUT_HEIGHT, {
        fit: 'fill' // Stretch to exact size (YuNet expects fixed input)
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert from HWC RGB to NCHW BGR (YuNet OpenCV convention)
    const pixelCount = this.INPUT_WIDTH * this.INPUT_HEIGHT;
    const floatData = new Float32Array(3 * pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const r = rawBuffer[i * 3];
      const g = rawBuffer[i * 3 + 1];
      const b = rawBuffer[i * 3 + 2];

      // BGR order, channels-first (NCHW)
      floatData[0 * pixelCount + i] = b;  // B channel
      floatData[1 * pixelCount + i] = g;  // G channel
      floatData[2 * pixelCount + i] = r;  // R channel
    }

    return { tensor: floatData, originalWidth, originalHeight };
  }

  /**
   * Non-Maximum Suppression
   */
  private nms(faces: DetectedFaceRegion[]): DetectedFaceRegion[] {
    if (faces.length <= 1) return faces;

    // Sort by confidence descending
    const sorted = [...faces].sort((a, b) => b.confidence - a.confidence);
    const kept: DetectedFaceRegion[] = [];

    const suppressed = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue;
      kept.push(sorted[i]);

      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed.has(j)) continue;
        const iou = this.calculateIoU(sorted[i], sorted[j]);
        if (iou > this.NMS_IOU_THRESHOLD) {
          suppressed.add(j);
        }
      }
    }

    return kept;
  }

  /**
   * Calculate Intersection over Union
   */
  private calculateIoU(a: DetectedFaceRegion, b: DetectedFaceRegion): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (intersection === 0) return 0;

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Parse YuNet raw output into face detections.
   * YuNet outputs [N, 15] where each row is:
   *   [x, y, w, h, x_re, y_re, x_le, y_le, x_n, y_n, x_rm, y_rm, x_lm, y_lm, score]
   * All coordinates are in input (640x640) pixel space.
   */
  private parseOutput(
    outputData: Float32Array,
    numDetections: number,
    originalWidth: number,
    originalHeight: number
  ): DetectedFaceRegion[] {
    const faces: DetectedFaceRegion[] = [];
    const stride = 15; // YuNet output stride

    for (let i = 0; i < numDetections; i++) {
      const offset = i * stride;
      const score = outputData[offset + 14];

      if (score < this.CONFIDENCE_THRESHOLD) continue;

      // Bounding box in 640x640 space
      const bx = outputData[offset + 0];
      const by = outputData[offset + 1];
      const bw = outputData[offset + 2];
      const bh = outputData[offset + 3];

      // Normalize to 0-1 range relative to original image
      const x = Math.max(0, bx / this.INPUT_WIDTH);
      const y = Math.max(0, by / this.INPUT_HEIGHT);
      const width = Math.min(1 - x, bw / this.INPUT_WIDTH);
      const height = Math.min(1 - y, bh / this.INPUT_HEIGHT);

      // 5 landmarks (right_eye, left_eye, nose, right_mouth, left_mouth)
      // Normalize to 0-1
      const landmarks: [number, number][] = [];
      for (let j = 0; j < 5; j++) {
        const lx = outputData[offset + 4 + j * 2] / this.INPUT_WIDTH;
        const ly = outputData[offset + 5 + j * 2] / this.INPUT_HEIGHT;
        landmarks.push([lx, ly]);
      }

      faces.push({
        x,
        y,
        width,
        height,
        confidence: score,
        landmarks
      });
    }

    return faces;
  }

  /**
   * Detect faces in an image buffer
   */
  public async detect(imageBuffer: Buffer): Promise<FaceDetectionServiceResult> {
    // Ensure model loaded
    if (!this.session) {
      const loaded = await this.loadModel();
      if (!loaded) {
        return {
          success: false,
          faces: [],
          inferenceTimeMs: 0,
          imageWidth: 0,
          imageHeight: 0,
          error: 'Failed to load YuNet model'
        };
      }
    }

    if (!ort) {
      return {
        success: false,
        faces: [],
        inferenceTimeMs: 0,
        imageWidth: 0,
        imageHeight: 0,
        error: 'ONNX Runtime not initialized'
      };
    }

    const startTime = Date.now();

    try {
      // Preprocess
      const { tensor, originalWidth, originalHeight } = await this.preprocessImage(imageBuffer);

      // Create input tensor [1, 3, 640, 640]
      const inputTensor = new ort.Tensor(
        'float32',
        tensor,
        [1, 3, this.INPUT_HEIGHT, this.INPUT_WIDTH]
      );

      // Run inference
      const feeds: Record<string, any> = {};
      feeds[this.session.inputNames[0]] = inputTensor;
      const results = await this.session.run(feeds);

      // Parse output
      const outputName = this.session.outputNames[0];
      const outputTensor = results[outputName];
      const outputData = outputTensor.data as Float32Array;
      const shape = outputTensor.dims; // [1, N, 15] or [N, 15]

      const numDetections = shape.length === 3 ? shape[1] : shape[0];

      // Parse raw detections
      let faces = this.parseOutput(outputData, numDetections, originalWidth, originalHeight);

      // Apply NMS
      faces = this.nms(faces);

      const inferenceTimeMs = Date.now() - startTime;

      return {
        success: true,
        faces,
        inferenceTimeMs,
        imageWidth: originalWidth,
        imageHeight: originalHeight
      };
    } catch (error) {
      log.error('[FaceDetectorService] Detection failed:', error);
      return {
        success: false,
        faces: [],
        inferenceTimeMs: Date.now() - startTime,
        imageWidth: 0,
        imageHeight: 0,
        error: error instanceof Error ? error.message : 'Unknown detection error'
      };
    }
  }

  /**
   * Detect faces from a file path
   */
  public async detectFromPath(imagePath: string): Promise<FaceDetectionServiceResult> {
    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        faces: [],
        inferenceTimeMs: 0,
        imageWidth: 0,
        imageHeight: 0,
        error: `Image file not found: ${imagePath}`
      };
    }
    const imageBuffer = fs.readFileSync(imagePath);
    return this.detect(imageBuffer);
  }

  /**
   * Check if model is loaded
   */
  public isModelLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Dispose model and free memory
   */
  public dispose(): void {
    if (this.session) {
      this.session = null;
    }
    this.loadError = null;
    FaceDetectorService.instance = null;
    log.info('[FaceDetectorService] Disposed');
  }
}

// Helper exports
export function getFaceDetectorService(): FaceDetectorService {
  return FaceDetectorService.getInstance();
}
