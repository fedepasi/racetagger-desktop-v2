/**
 * ONNX Detector Service
 *
 * Local inference using ONNX Runtime for race number detection.
 * Replaces Roboflow API calls with cost-free local inference.
 *
 * Features:
 * - RF-DETR compatible model loading
 * - Image preprocessing (resize, normalize)
 * - Non-Maximum Suppression (NMS)
 * - Race number extraction from class labels
 * - Memory-efficient buffer handling
 */

import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { ModelManager, getModelManager } from './model-manager';

// ONNX Runtime import (lazy loaded)
let ort: typeof import('onnxruntime-node') | null = null;

/**
 * Detection result from ONNX model
 */
export interface OnnxDetection {
  x: number;           // Top-left X (normalized 0-1, corner-based)
  y: number;           // Top-left Y (normalized 0-1, corner-based)
  width: number;       // Width (normalized 0-1)
  height: number;      // Height (normalized 0-1)
  confidence: number;  // Detection confidence
  classIndex: number;  // Class index
  className: string;   // Class name (e.g., "SF-25_16")
  raceNumber: string | null;  // Extracted race number (e.g., "16")
}

/**
 * Analysis result compatible with existing pipeline
 */
export interface OnnxAnalysisResult {
  raceNumber: string;
  confidence: number;
  className: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Model configuration
 */
interface ModelConfig {
  inputSize: [number, number];
  confidenceThreshold: number;
  iouThreshold: number;
  classes: string[];
}

/**
 * ONNX Detector Service
 * Singleton pattern for efficient model management
 */
export class OnnxDetector {
  private static instance: OnnxDetector | null = null;
  private session: import('onnxruntime-node').InferenceSession | null = null;
  private modelConfig: ModelConfig | null = null;
  private currentModelPath: string | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;
  private modelManager: ModelManager;
  private loadingPromise: Promise<boolean> | null = null;  // Track ongoing load operation
  private lastImageDimensions: { width: number; height: number } | null = null;  // Original image dimensions for bbox mapping

  private constructor() {
    this.modelManager = getModelManager();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): OnnxDetector {
    if (!OnnxDetector.instance) {
      OnnxDetector.instance = new OnnxDetector();
    }
    return OnnxDetector.instance;
  }

  /**
   * Initialize ONNX Runtime (lazy loading)
   */
  private async initOnnxRuntime(): Promise<boolean> {
    if (ort) return true;

    try {
      ort = require('onnxruntime-node');
      console.log('[OnnxDetector] ONNX Runtime initialized');
      return true;
    } catch (error) {
      console.error('[OnnxDetector] Failed to load ONNX Runtime:', error);
      this.loadError = error instanceof Error ? error : new Error(String(error));
      return false;
    }
  }

  /**
   * Load model for a specific category
   * Handles concurrent calls by having subsequent callers wait for the first load to complete
   */
  public async loadModel(categoryCode: string): Promise<boolean> {
    // If model is already loaded for this category, return immediately
    if (this.session && this.modelConfig) {
      const currentModelCategoryPath = this.modelManager.getLocalModelPath(categoryCode);
      if (currentModelCategoryPath && this.currentModelPath === currentModelCategoryPath) {
        console.log('[OnnxDetector] Model already loaded for this category');
        return true;
      }
    }

    // If loading is in progress, wait for it to complete instead of returning false
    if (this.loadingPromise) {
      console.log('[OnnxDetector] Model loading in progress, waiting for completion...');
      return this.loadingPromise;
    }

    // Start a new load operation
    this.loadingPromise = this.doLoadModel(categoryCode);

    try {
      const result = await this.loadingPromise;
      return result;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Internal method that performs the actual model loading
   */
  private async doLoadModel(categoryCode: string): Promise<boolean> {
    this.isLoading = true;
    this.loadError = null;

    try {
      // Initialize ONNX Runtime
      if (!await this.initOnnxRuntime()) {
        throw new Error('ONNX Runtime not available');
      }

      // Ensure model is downloaded
      const modelPath = await this.modelManager.ensureModelAvailable(categoryCode);

      // Skip if same model already loaded
      if (this.session && this.currentModelPath === modelPath) {
        console.log('[OnnxDetector] Model already loaded');
        this.isLoading = false;
        return true;
      }

      // Dispose previous session
      if (this.session) {
        console.log('[OnnxDetector] Disposing previous session');
        // Note: ort session doesn't have dispose in all versions
      }

      // Load model configuration
      const config = this.modelManager.getLocalModelConfig(categoryCode);
      if (!config) {
        throw new Error(`Model config not found for ${categoryCode}`);
      }

      this.modelConfig = {
        inputSize: config.inputSize as [number, number],
        confidenceThreshold: config.confidenceThreshold,
        iouThreshold: config.iouThreshold,
        classes: config.classes,
      };

      console.log(`[OnnxDetector] Loading model: ${modelPath}`);
      console.log(`[OnnxDetector] Classes: ${this.modelConfig.classes.length}`);
      console.log(`[OnnxDetector] Input size: ${this.modelConfig.inputSize}`);

      // Create inference session
      const sessionOptions: import('onnxruntime-node').InferenceSession.SessionOptions = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      };

      this.session = await ort!.InferenceSession.create(modelPath, sessionOptions);
      this.currentModelPath = modelPath;

      console.log('[OnnxDetector] Model loaded successfully');
      console.log(`[OnnxDetector] Input names: ${this.session.inputNames}`);
      console.log(`[OnnxDetector] Output names: ${this.session.outputNames}`);

      return true;
    } catch (error) {
      console.error('[OnnxDetector] Model loading failed:', error);
      this.loadError = error instanceof Error ? error : new Error(String(error));
      this.session = null;
      this.modelConfig = null;
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Check if model is loaded and ready
   */
  public isReady(): boolean {
    return this.session !== null && this.modelConfig !== null;
  }

  /**
   * Get loading error if any
   */
  public getLoadError(): Error | null {
    return this.loadError;
  }

  /**
   * Preprocess image for inference
   * RF-DETR/Roboflow uses ImageNet normalization
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
    if (!this.modelConfig) {
      throw new Error('Model not loaded');
    }

    const [targetWidth, targetHeight] = this.modelConfig.inputSize;

    // Save original image dimensions for bbox mapping
    const metadata = await sharp(imageBuffer).metadata();
    this.lastImageDimensions = {
      width: metadata.width!,
      height: metadata.height!
    };

    // Resize and convert to RGB
    const { data, info } = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, {
        fit: 'fill',
        kernel: 'lanczos3',
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // ImageNet normalization values (used by RF-DETR/Roboflow)
    const mean = [0.485, 0.456, 0.406];  // RGB
    const std = [0.229, 0.224, 0.225];   // RGB

    // Convert to Float32 with ImageNet normalization
    // RF-DETR expects CHW format (channels, height, width)
    const floatData = new Float32Array(3 * targetHeight * targetWidth);

    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < targetHeight; h++) {
        for (let w = 0; w < targetWidth; w++) {
          const srcIdx = (h * targetWidth + w) * 3 + c;
          const dstIdx = c * targetHeight * targetWidth + h * targetWidth + w;
          // ImageNet normalization: (pixel / 255.0 - mean) / std
          floatData[dstIdx] = (data[srcIdx] / 255.0 - mean[c]) / std[c];
        }
      }
    }

    return floatData;
  }

  /**
   * Run detection on image
   * @returns Detection results with original image dimensions for bbox mapping
   */
  public async detect(imageBuffer: Buffer): Promise<{
    results: OnnxAnalysisResult[];
    imageSize: { width: number; height: number };
  }> {
    if (!this.session || !this.modelConfig || !ort) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const startTime = Date.now();

    try {
      // Preprocess image
      const inputData = await this.preprocessImage(imageBuffer);

      // Create input tensor
      const [width, height] = this.modelConfig.inputSize;
      const inputTensor = new ort.Tensor('float32', inputData, [1, 3, height, width]);

      // Run inference
      const feeds: Record<string, import('onnxruntime-node').Tensor> = {};
      feeds[this.session.inputNames[0]] = inputTensor;

      const results = await this.session.run(feeds);

      // Parse detections based on output format
      const detections = this.parseDetections(results);

      // Apply NMS
      const filteredDetections = this.applyNMS(detections, this.modelConfig.iouThreshold);

      // Convert to analysis results
      const analysisResults = filteredDetections
        .filter(d => d.confidence >= this.modelConfig!.confidenceThreshold)
        .map(d => ({
          raceNumber: d.raceNumber || 'unknown',
          confidence: d.confidence,
          className: d.className,
          boundingBox: {
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
          },
        }))
        .filter(r => r.raceNumber !== 'unknown');

      const inferenceTime = Date.now() - startTime;
      console.log(`[OnnxDetector] Inference completed in ${inferenceTime}ms, ${analysisResults.length} detections`);

      return {
        results: analysisResults,
        imageSize: this.lastImageDimensions!
      };
    } catch (error) {
      console.error('[OnnxDetector] Detection failed:', error);
      throw error;
    }
  }

  /**
   * Parse model outputs to detections
   * RF-DETR output format varies - this handles common formats
   */
  private parseDetections(results: import('onnxruntime-node').InferenceSession.OnnxValueMapType): OnnxDetection[] {
    const detections: OnnxDetection[] = [];

    if (!this.modelConfig) return detections;

    // Get output tensors
    const outputNames = Object.keys(results);
    console.log(`[OnnxDetector] Output names: ${outputNames.join(', ')}`);

    // DEBUG: Log all output tensor details to understand model format
    for (const name of outputNames) {
      const tensor = results[name];
      console.log(`[OnnxDetector] Output "${name}": dims=[${tensor.dims}], type=${tensor.type}, size=${tensor.data.length}`);
    }

    // Try different output formats

    // Format 1: Separate boxes and scores (common for DETR)
    if (results['boxes'] && results['scores']) {
      const boxes = results['boxes'].data as Float32Array;
      const scores = results['scores'].data as Float32Array;

      // Search for labels tensor with alternative names
      const labelsNames = ['labels', 'pred_classes', 'classes', 'class_ids', 'label', 'pred_labels'];
      let labels: BigInt64Array | Int32Array | Float32Array | undefined;
      let labelsFoundName: string | null = null;

      for (const name of labelsNames) {
        if (results[name]) {
          labels = results[name].data as BigInt64Array | Int32Array | Float32Array;
          labelsFoundName = name;
          console.log(`[OnnxDetector] Found labels tensor: "${name}" with ${labels.length} values`);
          break;
        }
      }

      if (!labels) {
        console.warn(`[OnnxDetector] WARNING: No labels tensor found! Tried: ${labelsNames.join(', ')}`);
        console.warn(`[OnnxDetector] Available outputs: ${outputNames.join(', ')}`);
      }

      // Get dimensions from scores tensor to detect multi-class format
      const scoresDims = results['scores'].dims;
      const numClasses = this.modelConfig.classes.length;

      // Check if scores is multi-class format [batch, detections, classes]
      const isMultiClassFormat = scoresDims.length === 3 && scoresDims[2] > 1;
      const numDetections = isMultiClassFormat ? Number(scoresDims[1]) : scores.length;
      const scoresPerDetection = isMultiClassFormat ? Number(scoresDims[2]) : 1;

      // RF-DETR models typically include background class at index 0
      // So actual class indices are offset by 1 from our manifest
      // scoresPerDetection = numClasses + 1 (background) or numClasses + 2 (background + padding)
      const hasBackgroundClass = scoresPerDetection > numClasses;
      console.log(`[OnnxDetector] Scores format: dims=[${scoresDims}], isMultiClass=${isMultiClassFormat}, numDetections=${numDetections}, scoresPerDetection=${scoresPerDetection}, modelClasses=${numClasses}, hasBackground=${hasBackgroundClass}`);

      for (let i = 0; i < numDetections; i++) {
        let confidence: number;
        let classIndex: number;

        if (isMultiClassFormat) {
          // Multi-class format: find argmax across class scores for this detection
          // Skip index 0 if model has background class (score indices start from 1)
          let maxScore = -Infinity;
          let bestClassIndex = 0;
          const startIdx = hasBackgroundClass ? 1 : 0;  // Skip background if present
          const endIdx = hasBackgroundClass ? numClasses + 1 : numClasses;  // Only check real classes

          for (let c = startIdx; c < endIdx && c < scoresPerDetection; c++) {
            const scoreIdx = i * scoresPerDetection + c;
            const classScore = this.sigmoid(scores[scoreIdx]);
            if (classScore > maxScore) {
              maxScore = classScore;
              bestClassIndex = c;
            }
          }

          confidence = maxScore;
          // Adjust for background offset: model index 1 = our index 0
          classIndex = hasBackgroundClass ? bestClassIndex - 1 : bestClassIndex;
        } else {
          // Single score format: use labels tensor for class
          confidence = this.sigmoid(scores[i]);
          classIndex = labels ? Number(labels[i]) : 0;
        }

        if (confidence < 0.1) continue; // Skip very low confidence

        const className = this.modelConfig.classes[classIndex] || `class_${classIndex}`;

        // Boxes format: [x1, y1, x2, y2] or [cx, cy, w, h]
        const boxIdx = i * 4;
        let x = boxes[boxIdx];
        let y = boxes[boxIdx + 1];
        let width = boxes[boxIdx + 2];
        let height = boxes[boxIdx + 3];

        const [inputW, inputH] = this.modelConfig.inputSize;

        // Log raw box values for first few detections (debugging)
        if (i < 3) {
          console.log(`[OnnxDetector] Detection ${i}: classIndex=${classIndex}, className=${className}, confidence=${confidence.toFixed(3)}, rawBox=[${x.toFixed(2)}, ${y.toFixed(2)}, ${width.toFixed(2)}, ${height.toFixed(2)}]`);
        }

        // Determine if coordinates are in pixel space (>1) or already normalized (0-1)
        const maxCoord = Math.max(x, y, width, height);
        const isPixelSpace = maxCoord > 1;

        let centerX: number, centerY: number, boxWidth: number, boxHeight: number;

        if (isPixelSpace) {
          // Coordinates are in pixel space relative to input size (e.g., 0-640)
          // Check if [x1, y1, x2, y2] format (width/height positions are actually x2/y2)
          if (width > x && height > y) {
            // [x1, y1, x2, y2] format - convert to center-based
            const x1 = x, y1 = y, x2 = width, y2 = height;
            boxWidth = x2 - x1;
            boxHeight = y2 - y1;
            centerX = x1 + boxWidth / 2;
            centerY = y1 + boxHeight / 2;
          } else {
            // Already [cx, cy, w, h] format in pixel space
            centerX = x;
            centerY = y;
            boxWidth = width;
            boxHeight = height;
          }
          // Normalize to 0-1 range
          centerX = centerX / inputW;
          centerY = centerY / inputH;
          boxWidth = boxWidth / inputW;
          boxHeight = boxHeight / inputH;
        } else {
          // Coordinates are already normalized (0-1)
          // Assume [cx, cy, w, h] format (common for normalized outputs)
          centerX = x;
          centerY = y;
          boxWidth = width;
          boxHeight = height;
        }

        // Convert from center-based to corner-based (top-left) for frontend display
        const cornerX = centerX - boxWidth / 2;
        const cornerY = centerY - boxHeight / 2;

        // Log converted values for debugging
        if (i < 3) {
          console.log(`[OnnxDetector] Detection ${i}: isPixelSpace=${isPixelSpace}, corner=[${cornerX.toFixed(4)}, ${cornerY.toFixed(4)}], size=[${boxWidth.toFixed(4)}, ${boxHeight.toFixed(4)}]`);
        }

        detections.push({
          x: cornerX,      // Top-left X (normalized 0-1)
          y: cornerY,      // Top-left Y (normalized 0-1)
          width: boxWidth,
          height: boxHeight,
          confidence,
          classIndex,
          className,
          raceNumber: this.extractRaceNumber(className),
        });
      }
    }

    // Format 2: Combined output tensor
    else if (results['output'] || results['detections']) {
      const output = (results['output'] || results['detections']).data as Float32Array;
      const dims = (results['output'] || results['detections']).dims;

      // Try to parse based on dimensions
      if (dims.length === 3) {
        // [batch, num_detections, values]
        const numDetections = Number(dims[1]);
        const valuesPerDetection = Number(dims[2]);

        for (let i = 0; i < numDetections; i++) {
          const offset = i * valuesPerDetection;

          // Common format: [x, y, w, h, confidence, class_scores...]
          const x = output[offset];
          const y = output[offset + 1];
          const width = output[offset + 2];
          const height = output[offset + 3];
          const objectness = this.sigmoid(output[offset + 4]);

          // Find best class (apply sigmoid to class scores)
          let maxClassScore = 0;
          let bestClassIndex = 0;

          for (let c = 0; c < this.modelConfig.classes.length; c++) {
            const classScore = this.sigmoid(output[offset + 5 + c] || 0);
            if (classScore > maxClassScore) {
              maxClassScore = classScore;
              bestClassIndex = c;
            }
          }

          const confidence = objectness * maxClassScore;
          if (confidence < 0.1) continue;

          const className = this.modelConfig.classes[bestClassIndex] || `class_${bestClassIndex}`;

          detections.push({
            x,
            y,
            width,
            height,
            confidence,
            classIndex: bestClassIndex,
            className,
            raceNumber: this.extractRaceNumber(className),
          });
        }
      }
    }

    console.log(`[OnnxDetector] Parsed ${detections.length} raw detections`);
    return detections;
  }

  /**
   * Extract race number from class name
   * Format: "MODEL_NUMBER" (e.g., "SF-25_16" -> "16")
   */
  private extractRaceNumber(className: string): string | null {
    // Try underscore separator (SF-25_16)
    const underscoreParts = className.split('_');
    if (underscoreParts.length >= 2) {
      const potentialNumber = underscoreParts[underscoreParts.length - 1];
      if (/^\d+$/.test(potentialNumber)) {
        return potentialNumber;
      }
    }

    // Try dash separator (SF-25-16)
    const dashParts = className.split('-');
    if (dashParts.length >= 2) {
      const potentialNumber = dashParts[dashParts.length - 1];
      if (/^\d+$/.test(potentialNumber)) {
        return potentialNumber;
      }
    }

    // Try to extract any number at the end
    const match = className.match(/(\d+)$/);
    if (match) {
      return match[1];
    }

    return null;
  }

  /**
   * Sigmoid function to convert logits to probabilities
   * @param x Raw logit value
   * @returns Probability between 0 and 1
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Apply Non-Maximum Suppression
   */
  private applyNMS(detections: OnnxDetection[], iouThreshold: number): OnnxDetection[] {
    if (detections.length === 0) return [];

    // Sort by confidence (descending)
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);

    const keep: OnnxDetection[] = [];

    for (const detection of sorted) {
      let shouldKeep = true;

      for (const kept of keep) {
        const iou = this.calculateIoU(detection, kept);
        if (iou > iouThreshold) {
          shouldKeep = false;
          break;
        }
      }

      if (shouldKeep) {
        keep.push(detection);
      }
    }

    console.log(`[OnnxDetector] NMS: ${detections.length} -> ${keep.length} detections`);
    return keep;
  }

  /**
   * Calculate Intersection over Union
   */
  private calculateIoU(a: OnnxDetection, b: OnnxDetection): number {
    // Convert center format to corner format
    const aX1 = a.x - a.width / 2;
    const aY1 = a.y - a.height / 2;
    const aX2 = a.x + a.width / 2;
    const aY2 = a.y + a.height / 2;

    const bX1 = b.x - b.width / 2;
    const bY1 = b.y - b.height / 2;
    const bX2 = b.x + b.width / 2;
    const bY2 = b.y + b.height / 2;

    // Calculate intersection
    const interX1 = Math.max(aX1, bX1);
    const interY1 = Math.max(aY1, bY1);
    const interX2 = Math.min(aX2, bX2);
    const interY2 = Math.min(aY2, bY2);

    const interWidth = Math.max(0, interX2 - interX1);
    const interHeight = Math.max(0, interY2 - interY1);
    const interArea = interWidth * interHeight;

    // Calculate union
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
    this.modelConfig = null;
    this.currentModelPath = null;
    console.log('[OnnxDetector] Resources disposed');
  }
}

// Export singleton getter
export const getOnnxDetector = (): OnnxDetector => OnnxDetector.getInstance();
