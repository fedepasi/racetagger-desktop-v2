/**
 * Generic Segmenter Service
 *
 * Local inference using ONNX Runtime for generic object segmentation.
 * Supports both YOLOv8-seg (COCO) and custom YOLOv11 models.
 *
 * This is a SEPARATE model from RF-DETR - it runs BEFORE recognition
 * to isolate subjects and create clean crops without overlaps.
 *
 * Features:
 * - Multiple YOLO model support via model registry
 * - Instance segmentation with mask output
 * - Per-category class filtering via sport_categories.segmentation_config
 * - Memory-efficient buffer handling
 */

import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { getModelManager } from './model-manager';
import { errorTelemetryService } from './utils/error-telemetry-service';
import {
  getModelConfig,
  getClassName,
  classNamesToIds,
  getDefaultModelId,
  YoloModelConfig,
  SegmentationConfig,
  YOLO_MODEL_REGISTRY,
} from './yolo-model-registry';

// ONNX Runtime import (lazy loaded)
let ort: typeof import('onnxruntime-node') | null = null;

/**
 * Bounding box in normalized coordinates (0-1)
 */
export interface BoundingBox {
  x: number;      // Top-left X (normalized 0-1)
  y: number;      // Top-left Y (normalized 0-1)
  width: number;  // Width (normalized 0-1)
  height: number; // Height (normalized 0-1)
}

/**
 * Segmentation result from YOLO-seg model
 */
export interface SegmentationResult {
  classId: number;           // COCO class ID
  className: string;         // 'car', 'motorcycle', 'person', etc.
  confidence: number;        // Detection confidence (0-1)
  bbox: BoundingBox;         // Normalized bounding box
  mask: Uint8Array;          // Binary mask (full image resolution)
  maskDims: [number, number]; // [height, width] of mask
  detectionId: string;       // Unique ID for this detection
}

/**
 * Output from segmentation inference
 */
export interface GenericSegmenterOutput {
  detections: SegmentationResult[];
  imageSize: { width: number; height: number };
  inferenceTimeMs: number;
}

/**
 * Configuration for the segmenter
 */
export interface GenericSegmenterConfig {
  modelId: string;                        // Model ID from registry (e.g., 'yolov11-detector-v1')
  confidenceThreshold: number;
  iouThreshold: number;
  maskThreshold: number;
  relevantClassIds: number[];             // Class IDs to filter (computed from relevantClassNames)
  relevantClassNames: string[];           // Class names to filter (e.g., ['vehicle', 'rider'])
  maxDetections: number;                  // Max detections per image
}

/**
 * Default configuration
 */
export const DEFAULT_SEGMENTER_CONFIG: GenericSegmenterConfig = {
  modelId: getDefaultModelId(),           // 'yolov11-detector-v1'
  confidenceThreshold: 0.25,
  iouThreshold: 0.45,
  maskThreshold: 0.5,
  relevantClassIds: [],                   // Computed from relevantClassNames
  relevantClassNames: ['vehicle', 'rider', 'runner'],  // Default relevant classes
  maxDetections: 5,
};

/**
 * Generic Segmenter Service
 * Singleton pattern for efficient model management
 */
export class GenericSegmenter {
  private static instance: GenericSegmenter | null = null;
  private session: import('onnxruntime-node').InferenceSession | null = null;
  private config: GenericSegmenterConfig;
  private currentModelPath: string | null = null;
  private currentModelConfig: YoloModelConfig | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;
  private loadingPromise: Promise<boolean> | null = null;
  private lastImageDimensions: { width: number; height: number } | null = null;

  // Model-dependent constants (set during loadModel)
  private readonly INPUT_SIZE = 640;
  private PROTO_SIZE = 160;       // Mask prototype size
  private NUM_CLASSES = 80;       // Number of classes (dynamic based on model)
  private NUM_MASK_COEFFS = 32;   // Mask coefficients per detection

  private constructor(config?: Partial<GenericSegmenterConfig>) {
    this.config = { ...DEFAULT_SEGMENTER_CONFIG, ...config };
    // Compute class IDs from names
    this.updateRelevantClassIds();
  }

  /**
   * Update relevant class IDs based on class names and current model
   */
  private updateRelevantClassIds(): void {
    if (this.currentModelConfig) {
      this.config.relevantClassIds = classNamesToIds(
        this.config.modelId,
        this.config.relevantClassNames
      );
    } else {
      // Fallback: use class names as-is for lookup later
      this.config.relevantClassIds = [];
    }
  }

  /**
   * Update configuration (e.g., from sport_categories.segmentation_config)
   */
  public updateConfig(segConfig: SegmentationConfig): void {
    this.config.modelId = segConfig.model_id;
    this.config.relevantClassNames = segConfig.relevant_classes;
    this.config.confidenceThreshold = segConfig.confidence_threshold;
    this.config.iouThreshold = segConfig.iou_threshold;
    this.config.maxDetections = segConfig.max_detections;

    // Recompute class IDs
    this.updateRelevantClassIds();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<GenericSegmenterConfig>): GenericSegmenter {
    if (!GenericSegmenter.instance) {
      GenericSegmenter.instance = new GenericSegmenter(config);
    }
    return GenericSegmenter.instance;
  }

  /**
   * Initialize ONNX Runtime (lazy loading)
   */
  private async initOnnxRuntime(): Promise<boolean> {
    if (ort) return true;

    try {
      ort = require('onnxruntime-node');
      return true;
    } catch (error) {
      console.error('[GenericSegmenter] Failed to load ONNX Runtime:', error);
      this.loadError = error instanceof Error ? error : new Error(String(error));
      return false;
    }
  }

  /**
   * Load the YOLO-seg model
   */
  public async loadModel(modelPath?: string): Promise<boolean> {
    // If model is already loaded, return immediately
    if (this.session && this.currentModelPath) {
      return true;
    }

    // If loading is in progress, wait for it
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.doLoadModel(modelPath);

    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Internal model loading
   */
  private async doLoadModel(modelPath?: string): Promise<boolean> {
    this.isLoading = true;
    this.loadError = null;

    try {
      // Initialize ONNX Runtime
      if (!await this.initOnnxRuntime()) {
        throw new Error('ONNX Runtime not available');
      }

      // Get model config from registry
      this.currentModelConfig = getModelConfig(this.config.modelId) || null;
      if (!this.currentModelConfig) {
        throw new Error(`Model '${this.config.modelId}' not found in registry. Available: ${Object.keys(YOLO_MODEL_REGISTRY).join(', ')}`);
      }

      // Set model-dependent constants from registry
      this.NUM_CLASSES = this.currentModelConfig.numClasses;
      this.NUM_MASK_COEFFS = this.currentModelConfig.numMaskCoeffs;
      this.PROTO_SIZE = this.currentModelConfig.protoSize;

      // Get model path - either provided or download from Supabase
      let finalModelPath = modelPath;

      if (!finalModelPath) {
        const modelManager = getModelManager();
        finalModelPath = await modelManager.ensureGenericModelAvailable(this.config.modelId);
      }

      if (!finalModelPath || !fs.existsSync(finalModelPath)) {
        throw new Error(`Model file not found: ${finalModelPath}`);
      }

      // Skip if same model already loaded
      if (this.session && this.currentModelPath === finalModelPath) {
        this.isLoading = false;
        return true;
      }

      // Create inference session
      const sessionOptions: import('onnxruntime-node').InferenceSession.SessionOptions = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      };

      this.session = await ort!.InferenceSession.create(finalModelPath, sessionOptions);
      this.currentModelPath = finalModelPath;

      // Update relevant class IDs now that model config is loaded
      this.updateRelevantClassIds();

      return true;
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : (error?.message || String(error));
      const errStack = error instanceof Error ? error.stack : '';
      console.error(`[GenericSegmenter] Model loading failed: ${errMsg}`);
      if (errStack) console.error(`[GenericSegmenter] Stack: ${errStack}`);
      this.loadError = error instanceof Error ? error : new Error(errMsg);
      this.session = null;
      // Report segmentation model loading failure
      errorTelemetryService.reportCriticalError({
        errorType: 'segmentation',
        severity: 'fatal',
        error: this.loadError,
        batchPhase: 'segmentation_model_load'
      });
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Check if model is loaded and ready
   */
  public isReady(): boolean {
    return this.session !== null;
  }

  /**
   * Get loading error if any
   */
  public getLoadError(): Error | null {
    return this.loadError;
  }

  /**
   * Preprocess image for YOLOv8-seg
   * YOLOv8 uses simple 0-1 normalization (not ImageNet)
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<{
    inputData: Float32Array;
    originalWidth: number;
    originalHeight: number;
    scale: number;
    padX: number;
    padY: number;
  }> {
    // Get original dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width!;
    const originalHeight = metadata.height!;

    this.lastImageDimensions = { width: originalWidth, height: originalHeight };

    // Calculate letterbox scaling (preserve aspect ratio)
    const scale = Math.min(
      this.INPUT_SIZE / originalWidth,
      this.INPUT_SIZE / originalHeight
    );

    const scaledWidth = Math.round(originalWidth * scale);
    const scaledHeight = Math.round(originalHeight * scale);

    const padX = Math.round((this.INPUT_SIZE - scaledWidth) / 2);
    const padY = Math.round((this.INPUT_SIZE - scaledHeight) / 2);

    // Resize with letterbox (gray padding)
    const { data } = await sharp(imageBuffer)
      .resize(scaledWidth, scaledHeight, {
        fit: 'fill',
        kernel: 'lanczos3',
      })
      .extend({
        top: padY,
        bottom: this.INPUT_SIZE - scaledHeight - padY,
        left: padX,
        right: this.INPUT_SIZE - scaledWidth - padX,
        background: { r: 114, g: 114, b: 114 }, // YOLO gray padding
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert to Float32 with 0-1 normalization (YOLO format)
    // CHW format (channels, height, width)
    const floatData = new Float32Array(3 * this.INPUT_SIZE * this.INPUT_SIZE);

    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < this.INPUT_SIZE; h++) {
        for (let w = 0; w < this.INPUT_SIZE; w++) {
          const srcIdx = (h * this.INPUT_SIZE + w) * 3 + c;
          const dstIdx = c * this.INPUT_SIZE * this.INPUT_SIZE + h * this.INPUT_SIZE + w;
          floatData[dstIdx] = data[srcIdx] / 255.0;
        }
      }
    }

    return {
      inputData: floatData,
      originalWidth,
      originalHeight,
      scale,
      padX,
      padY,
    };
  }

  /**
   * Run segmentation on image
   */
  public async detect(imageBuffer: Buffer): Promise<GenericSegmenterOutput> {
    if (!this.session || !ort) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const startTime = Date.now();

    try {
      // Preprocess image
      const {
        inputData,
        originalWidth,
        originalHeight,
        scale,
        padX,
        padY,
      } = await this.preprocessImage(imageBuffer);

      // Create input tensor
      const inputTensor = new ort.Tensor(
        'float32',
        inputData,
        [1, 3, this.INPUT_SIZE, this.INPUT_SIZE]
      );

      // Run inference
      const feeds: Record<string, import('onnxruntime-node').Tensor> = {};
      feeds[this.session.inputNames[0]] = inputTensor;

      const results = await this.session.run(feeds);

      // Parse detections with masks
      const detections = await this.parseDetectionsWithMasks(
        results,
        originalWidth,
        originalHeight,
        scale,
        padX,
        padY
      );

      // Apply NMS
      const filteredDetections = this.applyNMS(detections, this.config.iouThreshold);

      // Filter by confidence and relevant classes, then limit by maxDetections
      const finalDetections = filteredDetections
        .filter(d => d.confidence >= this.config.confidenceThreshold)
        .filter(d => this.config.relevantClassIds.length === 0 || this.config.relevantClassIds.includes(d.classId))
        .slice(0, this.config.maxDetections)
        .map((d, idx) => ({
          ...d,
          detectionId: `seg_${idx}_${Date.now()}`,
        }));

      const inferenceTimeMs = Date.now() - startTime;

      return {
        detections: finalDetections,
        imageSize: { width: originalWidth, height: originalHeight },
        inferenceTimeMs,
      };
    } catch (error) {
      console.error('[GenericSegmenter] Detection failed:', error);
      throw error;
    }
  }

  /**
   * Parse YOLO-seg output (supports both YOLOv8 and YOLOv11)
   * Output format:
   * - output0: [1, N, 8400] - detections where N = 4 (bbox) + NUM_CLASSES + 32 (mask coeffs)
   *   - YOLOv8 COCO: N = 4 + 80 + 32 = 116
   *   - YOLOv11 Custom: N = 4 + 6 + 32 = 42
   * - output1: [1, 32, 160, 160] - mask prototypes
   */
  private async parseDetectionsWithMasks(
    results: import('onnxruntime-node').InferenceSession.OnnxValueMapType,
    originalWidth: number,
    originalHeight: number,
    scale: number,
    padX: number,
    padY: number
  ): Promise<SegmentationResult[]> {
    const detections: SegmentationResult[] = [];

    // Expected channels = 4 (bbox) + NUM_CLASSES + 32 (mask coeffs)
    const expectedChannels = 4 + this.NUM_CLASSES + this.NUM_MASK_COEFFS;

    // Get output tensors
    const outputNames = Object.keys(results);

    // Find detection and prototype outputs
    let detectionsOutput: Float32Array | null = null;
    let prototypesOutput: Float32Array | null = null;
    let detectionsShape: readonly number[] = [];
    let prototypesShape: readonly number[] = [];

    for (const name of outputNames) {
      const tensor = results[name];
      const dims = tensor.dims;

      // Detection output: [1, N, 8400] where N matches expected channels
      if (dims.length === 3 && dims[1] === expectedChannels) {
        detectionsOutput = tensor.data as Float32Array;
        detectionsShape = dims;
      }
      // Prototype output: [1, 32, 160, 160]
      else if (dims.length === 4 && dims[1] === this.NUM_MASK_COEFFS) {
        prototypesOutput = tensor.data as Float32Array;
        prototypesShape = dims;
      }
    }

    if (!detectionsOutput) {
      return detections;
    }

    // Parse detections
    // YOLO-seg output format: [batch, channels, anchors]
    // channels = 4 (bbox) + NUM_CLASSES + NUM_MASK_COEFFS
    const numAnchors = Number(detectionsShape[2]); // 8400
    const numChannels = Number(detectionsShape[1]);

    for (let a = 0; a < numAnchors; a++) {
      // Get class scores and find best class
      let maxClassScore = 0;
      let bestClassId = 0;

      for (let c = 0; c < this.NUM_CLASSES; c++) {
        const scoreIdx = (4 + c) * numAnchors + a;
        const score = detectionsOutput[scoreIdx];
        if (score > maxClassScore) {
          maxClassScore = score;
          bestClassId = c;
        }
      }

      // Skip low confidence detections (early filter)
      if (maxClassScore < 0.1) continue;

      // Skip irrelevant classes if filter is set
      if (this.config.relevantClassIds.length > 0 && !this.config.relevantClassIds.includes(bestClassId)) continue;

      // Get bbox (cx, cy, w, h in input coordinates)
      const cx = detectionsOutput[0 * numAnchors + a];
      const cy = detectionsOutput[1 * numAnchors + a];
      const bw = detectionsOutput[2 * numAnchors + a];
      const bh = detectionsOutput[3 * numAnchors + a];

      // Remove letterbox padding and scale back to original image
      const x1 = (cx - bw / 2 - padX) / scale;
      const y1 = (cy - bh / 2 - padY) / scale;
      const x2 = (cx + bw / 2 - padX) / scale;
      const y2 = (cy + bh / 2 - padY) / scale;

      // Normalize to 0-1 relative to original image
      const bbox: BoundingBox = {
        x: Math.max(0, x1 / originalWidth),
        y: Math.max(0, y1 / originalHeight),
        width: Math.min(1, (x2 - x1) / originalWidth),
        height: Math.min(1, (y2 - y1) / originalHeight),
      };

      // Get mask coefficients
      const maskCoeffs = new Float32Array(this.NUM_MASK_COEFFS);
      for (let m = 0; m < this.NUM_MASK_COEFFS; m++) {
        const coeffIdx = (4 + this.NUM_CLASSES + m) * numAnchors + a;
        maskCoeffs[m] = detectionsOutput[coeffIdx];
      }

      // Generate mask from coefficients and prototypes
      let mask: Uint8Array;
      let maskDims: [number, number];

      if (prototypesOutput) {
        mask = this.decodeMask(
          maskCoeffs,
          prototypesOutput,
          bbox,
          originalWidth,
          originalHeight,
          scale,
          padX,
          padY
        );
        maskDims = [originalHeight, originalWidth];
      } else {
        // Fallback: create rectangular mask from bbox
        mask = this.createRectangularMask(bbox, originalWidth, originalHeight);
        maskDims = [originalHeight, originalWidth];
      }

      detections.push({
        classId: bestClassId,
        className: getClassName(this.config.modelId, bestClassId),
        confidence: maxClassScore,
        bbox,
        mask,
        maskDims,
        detectionId: '',
      });
    }

    return detections;
  }

  /**
   * Decode mask from coefficients and prototypes
   */
  private decodeMask(
    coeffs: Float32Array,
    prototypes: Float32Array,
    bbox: BoundingBox,
    originalWidth: number,
    originalHeight: number,
    scale: number,
    padX: number,
    padY: number
  ): Uint8Array {
    const protoH = this.PROTO_SIZE;
    const protoW = this.PROTO_SIZE;

    // Matrix multiply: coeffs[32] @ prototypes[32, 160, 160] = mask[160, 160]
    const protoMask = new Float32Array(protoH * protoW);

    for (let y = 0; y < protoH; y++) {
      for (let x = 0; x < protoW; x++) {
        let sum = 0;
        for (let c = 0; c < this.NUM_MASK_COEFFS; c++) {
          const protoIdx = c * protoH * protoW + y * protoW + x;
          sum += coeffs[c] * prototypes[protoIdx];
        }
        protoMask[y * protoW + x] = sum;
      }
    }

    // Apply sigmoid
    for (let i = 0; i < protoMask.length; i++) {
      protoMask[i] = 1 / (1 + Math.exp(-protoMask[i]));
    }

    // Crop mask to bbox region (in prototype coordinates)
    // Convert bbox back to letterboxed input coordinates
    const inputX1 = bbox.x * originalWidth * scale + padX;
    const inputY1 = bbox.y * originalHeight * scale + padY;
    const inputX2 = (bbox.x + bbox.width) * originalWidth * scale + padX;
    const inputY2 = (bbox.y + bbox.height) * originalHeight * scale + padY;

    // Scale to prototype coordinates
    const protoScale = this.PROTO_SIZE / this.INPUT_SIZE;
    const px1 = Math.max(0, Math.floor(inputX1 * protoScale));
    const py1 = Math.max(0, Math.floor(inputY1 * protoScale));
    const px2 = Math.min(protoW, Math.ceil(inputX2 * protoScale));
    const py2 = Math.min(protoH, Math.ceil(inputY2 * protoScale));

    // Create full-resolution mask
    const fullMask = new Uint8Array(originalWidth * originalHeight);

    // Map prototype mask to original image coordinates
    for (let oy = 0; oy < originalHeight; oy++) {
      for (let ox = 0; ox < originalWidth; ox++) {
        // Convert original coords to prototype coords
        const inputX = ox * scale + padX;
        const inputY = oy * scale + padY;
        const px = Math.floor(inputX * protoScale);
        const py = Math.floor(inputY * protoScale);

        // Check if within bbox and valid prototype range
        if (px >= px1 && px < px2 && py >= py1 && py < py2 &&
            px >= 0 && px < protoW && py >= 0 && py < protoH) {
          const protoVal = protoMask[py * protoW + px];
          fullMask[oy * originalWidth + ox] = protoVal > this.config.maskThreshold ? 255 : 0;
        }
      }
    }

    return fullMask;
  }

  /**
   * Create rectangular mask from bbox (fallback when no prototypes)
   */
  private createRectangularMask(
    bbox: BoundingBox,
    width: number,
    height: number
  ): Uint8Array {
    const mask = new Uint8Array(width * height);

    const x1 = Math.floor(bbox.x * width);
    const y1 = Math.floor(bbox.y * height);
    const x2 = Math.ceil((bbox.x + bbox.width) * width);
    const y2 = Math.ceil((bbox.y + bbox.height) * height);

    for (let y = y1; y < y2 && y < height; y++) {
      for (let x = x1; x < x2 && x < width; x++) {
        if (y >= 0 && x >= 0) {
          mask[y * width + x] = 255;
        }
      }
    }

    return mask;
  }

  /**
   * Apply Non-Maximum Suppression
   */
  private applyNMS(
    detections: SegmentationResult[],
    iouThreshold: number
  ): SegmentationResult[] {
    if (detections.length === 0) return [];

    // Sort by confidence (descending)
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);

    const keep: SegmentationResult[] = [];

    for (const detection of sorted) {
      let shouldKeep = true;

      for (const kept of keep) {
        // Only compare same class
        if (detection.classId !== kept.classId) continue;

        const iou = this.calculateIoU(detection.bbox, kept.bbox);
        if (iou > iouThreshold) {
          shouldKeep = false;
          break;
        }
      }

      if (shouldKeep) {
        keep.push(detection);
      }
    }

    return keep;
  }

  /**
   * Calculate Intersection over Union
   */
  private calculateIoU(a: BoundingBox, b: BoundingBox): number {
    const aX1 = a.x;
    const aY1 = a.y;
    const aX2 = a.x + a.width;
    const aY2 = a.y + a.height;

    const bX1 = b.x;
    const bY1 = b.y;
    const bX2 = b.x + b.width;
    const bY2 = b.y + b.height;

    const interX1 = Math.max(aX1, bX1);
    const interY1 = Math.max(aY1, bY1);
    const interX2 = Math.min(aX2, bX2);
    const interY2 = Math.min(aY2, bY2);

    const interWidth = Math.max(0, interX2 - interX1);
    const interHeight = Math.max(0, interY2 - interY1);
    const interArea = interWidth * interHeight;

    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    const unionArea = aArea + bArea - interArea;

    return unionArea > 0 ? interArea / unionArea : 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.session = null;
    this.currentModelPath = null;
    this.currentModelConfig = null;
  }

  /**
   * Get current model ID
   */
  public getModelId(): string {
    return this.config.modelId;
  }

  /**
   * Check if a different model is needed
   */
  public needsModelReload(newModelId: string): boolean {
    return this.currentModelConfig?.modelId !== newModelId;
  }
}

// Export singleton getter
export const getGenericSegmenter = (config?: Partial<GenericSegmenterConfig>): GenericSegmenter => {
  return GenericSegmenter.getInstance(config);
};
