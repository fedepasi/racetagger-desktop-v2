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
import { safeSend } from './ipc/context';

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
  /** Diagnostic: second-best class info for ambiguity analysis */
  _ambiguityInfo?: {
    secondClassName: string;
    secondConfidence: number;
    secondRaceNumber: string | null;
    gap: number;          // confidence - secondConfidence
    ratio: number;        // secondConfidence / confidence
  };
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
  /** Diagnostic: ambiguity info propagated from detection */
  _ambiguityInfo?: OnnxDetection['_ambiguityInfo'];
}

/**
 * Model configuration
 */
interface ModelConfig {
  inputSize: [number, number];
  confidenceThreshold: number;
  iouThreshold: number;
  classes: string[];
  preprocessingMethod: 'stretch' | 'letterbox';
  outputFormat: 'yolo-nms' | 'yolo-end2end' | 'rf-detr';
}

/**
 * Letterbox padding info for coordinate transform
 * Stored after preprocessing to allow bbox "unletterboxing"
 */
interface LetterboxInfo {
  scale: number;   // Scale factor applied to the image
  padX: number;    // Horizontal padding in pixels (each side)
  padY: number;    // Vertical padding in pixels (each side)
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
  private lastLetterboxInfo: LetterboxInfo | null = null;  // Letterbox padding info for bbox unletterboxing

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
        return true;
      }
    }

    // If loading is in progress, wait for it to complete instead of returning false
    if (this.loadingPromise) {
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

      // Ensure model is downloaded with progress tracking
      let downloadStarted = false;
      const modelPath = await this.modelManager.ensureModelAvailable(
        categoryCode,
        (percent, downloadedMB, totalMB) => {
          // Emit download progress to renderer
          if (!downloadStarted) {
            downloadStarted = true;
            safeSend('model-download-start', {
              categoryCode,
              totalSizeMB: totalMB
            });
          }
          safeSend('model-download-progress', {
            percent,
            downloadedMB,
            totalMB
          });
        }
      );

      // Notify download complete if it was started
      if (downloadStarted) {
        safeSend('model-download-complete', { categoryCode });
      }

      // Load model configuration (always refresh config even if session is cached,
      // so that metadata changes like preprocessingMethod are picked up)
      const config = this.modelManager.getLocalModelConfig(categoryCode);
      if (!config) {
        throw new Error(`Model config not found for ${categoryCode}`);
      }

      this.modelConfig = {
        inputSize: config.inputSize as [number, number],
        confidenceThreshold: config.confidenceThreshold,
        iouThreshold: config.iouThreshold,
        classes: config.classes,
        preprocessingMethod: config.preprocessingMethod || 'stretch',
        outputFormat: config.outputFormat || 'yolo-nms',
      };
      console.log(`[OnnxDetector] Preprocessing method: ${this.modelConfig.preprocessingMethod}, Output format: ${this.modelConfig.outputFormat}`);

      // Skip ONNX session creation if same model file already loaded
      if (this.session && this.currentModelPath === modelPath) {
        this.isLoading = false;
        return true;
      }

      // Create inference session
      const sessionOptions: import('onnxruntime-node').InferenceSession.SessionOptions = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      };

      this.session = await ort!.InferenceSession.create(modelPath, sessionOptions);
      this.currentModelPath = modelPath;

      return true;
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : (error?.message || String(error));
      console.error(`[OnnxDetector] Model loading failed: ${errMsg}`);
      this.loadError = error instanceof Error ? error : new Error(errMsg);
      this.session = null;
      this.modelConfig = null;

      // Notify download error to renderer
      safeSend('model-download-error', {
        categoryCode,
        error: this.loadError.message
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
   * Supports two modes based on model training configuration:
   *
   * STRETCH (Roboflow default):
   * 1. Auto-orient based on EXIF
   * 2. Resize to 640x640 with fit:'fill' (distorts aspect ratio)
   * 3. Simple /255 normalization
   *
   * LETTERBOX (aspect ratio preserved):
   * 1. Auto-orient based on EXIF
   * 2. Resize to fit within 640x640 preserving aspect ratio (fit:'contain')
   * 3. Pad remaining space with gray (114,114,114) — YOLO standard
   * 4. Simple /255 normalization
   * 5. Store padding info for bbox coordinate compensation
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
    if (!this.modelConfig) {
      throw new Error('Model not loaded');
    }

    const [targetWidth, targetHeight] = this.modelConfig.inputSize;
    const useLetterbox = this.modelConfig.preprocessingMethod === 'letterbox';

    // Get original image dimensions (after EXIF rotation)
    const rotatedBuffer = await sharp(imageBuffer).rotate().toBuffer();
    const metadata = await sharp(rotatedBuffer).metadata();
    this.lastImageDimensions = {
      width: metadata.width!,
      height: metadata.height!
    };

    let data: Buffer;

    if (useLetterbox) {
      // LETTERBOX: preserve aspect ratio, pad with gray
      const origW = metadata.width!;
      const origH = metadata.height!;
      const scale = Math.min(targetWidth / origW, targetHeight / origH);
      const scaledW = Math.round(origW * scale);
      const scaledH = Math.round(origH * scale);
      const padX = Math.round((targetWidth - scaledW) / 2);
      const padY = Math.round((targetHeight - scaledH) / 2);

      // Store letterbox info for bbox unletterboxing
      this.lastLetterboxInfo = { scale, padX, padY };

      const resized = await sharp(rotatedBuffer)
        .resize(scaledW, scaledH, { fit: 'fill', kernel: 'lanczos3' })
        .removeAlpha()
        .raw()
        .toBuffer();

      // Create target buffer filled with gray (114,114,114) — YOLO standard padding color
      const targetPixels = targetWidth * targetHeight * 3;
      const padded = Buffer.alloc(targetPixels);
      for (let i = 0; i < targetPixels; i += 3) {
        padded[i] = 114;     // R
        padded[i + 1] = 114; // G
        padded[i + 2] = 114; // B
      }

      // Copy resized image into padded buffer at offset
      for (let row = 0; row < scaledH; row++) {
        const srcOffset = row * scaledW * 3;
        const dstOffset = ((row + padY) * targetWidth + padX) * 3;
        resized.copy(padded, dstOffset, srcOffset, srcOffset + scaledW * 3);
      }

      data = padded;
      console.log(`[ONNX-Preprocess] Letterbox: ${origW}x${origH} → ${scaledW}x${scaledH} + pad(${padX},${padY}) → ${targetWidth}x${targetHeight}`);
    } else {
      // STRETCH: distort to fill (Roboflow default)
      this.lastLetterboxInfo = null;

      const result = await sharp(rotatedBuffer)
        .resize(targetWidth, targetHeight, {
          fit: 'fill',
          kernel: 'lanczos3',
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      data = result.data;
      console.log(`[ONNX-Preprocess] Stretch: ${metadata.width}x${metadata.height} → ${targetWidth}x${targetHeight}`);
    }

    // NORMALIZATION: Simple /255 (Roboflow YOLO default, NOT ImageNet)
    const floatData = new Float32Array(3 * targetHeight * targetWidth);

    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < targetHeight; h++) {
        for (let w = 0; w < targetWidth; w++) {
          const srcIdx = (h * targetWidth + w) * 3 + c;
          const dstIdx = c * targetHeight * targetWidth + h * targetWidth + w;
          floatData[dstIdx] = data[srcIdx] / 255.0;
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
    preprocessingMethod: 'stretch' | 'letterbox';
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

      // DEBUG: Log output tensor info for YOLOv11 compatibility check
      console.log('[ONNX-Output] Output tensor names:', Object.keys(results));
      for (const name of Object.keys(results)) {
        const tensor = results[name];
        console.log(`[ONNX-Output] ${name}: dims=${tensor.dims}, type=${tensor.type}, size=${tensor.size}`);

        // Sample first few raw values to understand data format
        const data = tensor.data as Float32Array;
        const samples = Array.from(data.slice(0, 20)).map(v => v.toFixed(4));
        console.log(`[ONNX-Output] First 20 values:`, samples.join(', '));
      }

      // Parse detections based on output format
      const detections = this.parseDetections(results);

      // Apply NMS (skip for end2end and rf-detr models that handle suppression internally)
      const filteredDetections = this.modelConfig.outputFormat === 'yolo-end2end' || this.modelConfig.outputFormat === 'rf-detr'
        ? detections
        : this.applyNMS(detections, this.modelConfig.iouThreshold);

      // Convert to analysis results, applying letterbox compensation if needed
      const analysisResults = filteredDetections
        .filter(d => d.confidence >= this.modelConfig!.confidenceThreshold)
        .map(d => {
          let bx = d.x, by = d.y, bw = d.width, bh = d.height;

          // Unletterbox: convert bbox from padded input space to original image space (normalized 0-1)
          if (this.lastLetterboxInfo) {
            const [inputW, inputH] = this.modelConfig!.inputSize;
            const { padX, padY } = this.lastLetterboxInfo;
            const padXNorm = padX / inputW;
            const padYNorm = padY / inputH;
            const scaleXNorm = (inputW - 2 * padX) / inputW;
            const scaleYNorm = (inputH - 2 * padY) / inputH;

            // Remove padding offset and rescale to original image proportions
            bx = (bx - padXNorm) / scaleXNorm;
            by = (by - padYNorm) / scaleYNorm;
            bw = bw / scaleXNorm;
            bh = bh / scaleYNorm;

            // Clamp to [0, 1] range (detections near padding edge)
            bx = Math.max(0, Math.min(1, bx));
            by = Math.max(0, Math.min(1, by));
            bw = Math.min(bw, 1 - bx);
            bh = Math.min(bh, 1 - by);
          }

          return {
            raceNumber: d.raceNumber || 'unknown',
            confidence: d.confidence,
            className: d.className,
            boundingBox: { x: bx, y: by, width: bw, height: bh },
            ...(d._ambiguityInfo ? { _ambiguityInfo: d._ambiguityInfo } : {}),
          };
        })
        .filter(r => r.raceNumber !== 'unknown');

      // DEBUG: Detection summary with class distribution
      const classDistribution = new Map<string, number>();
      filteredDetections.forEach(d => {
        const count = classDistribution.get(d.className) || 0;
        classDistribution.set(d.className, count + 1);
      });

      console.log(`[ONNX-Parse] Detection summary:`);
      console.log(`  Total detections after NMS: ${filteredDetections.length}`);
      console.log(`  Detections above threshold (${this.modelConfig.confidenceThreshold}): ${analysisResults.length}`);
      if (classDistribution.size > 0) {
        console.log(`  Class distribution:`);
        Array.from(classDistribution.entries())
          .sort((a, b) => b[1] - a[1])  // Sort by count descending
          .forEach(([className, count]) => {
            console.log(`    ${className}: ${count} detection(s)`);
          });
      }

      return {
        results: analysisResults,
        imageSize: this.lastImageDimensions!,
        preprocessingMethod: this.modelConfig.preprocessingMethod,
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

    // Try different output formats

    // Format 1: Separate boxes and scores (common for DETR)
    if (results['boxes'] && results['scores']) {
      console.log('[ONNX-Parse] Using RF-DETR format (boxes + scores)');
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
          break;
        }
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

      for (let i = 0; i < numDetections; i++) {
        let confidence: number;
        let classIndex: number;
        let secondBestScore = -Infinity;
        let secondBestIdx = -1;

        if (isMultiClassFormat) {
          // Multi-class format: find argmax across class scores for this detection
          // Skip index 0 if model has background class (score indices start from 1)
          let maxScore = -Infinity;
          let secondMaxScore = -Infinity;
          let bestClassIndex = 0;
          let secondBestClassIndex = 0;
          const startIdx = hasBackgroundClass ? 1 : 0;  // Skip background if present
          const endIdx = hasBackgroundClass ? numClasses + 1 : numClasses;  // Only check real classes

          for (let c = startIdx; c < endIdx && c < scoresPerDetection; c++) {
            const scoreIdx = i * scoresPerDetection + c;
            const classScore = this.sigmoid(scores[scoreIdx]);
            if (classScore > maxScore) {
              secondMaxScore = maxScore;
              secondBestClassIndex = bestClassIndex;
              maxScore = classScore;
              bestClassIndex = c;
            } else if (classScore > secondMaxScore) {
              secondMaxScore = classScore;
              secondBestClassIndex = c;
            }
          }

          confidence = maxScore;
          // Adjust for background offset: model index 1 = our index 0
          classIndex = hasBackgroundClass ? bestClassIndex - 1 : bestClassIndex;
          secondBestScore = secondMaxScore;
          secondBestIdx = hasBackgroundClass ? secondBestClassIndex - 1 : secondBestClassIndex;
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

        // Build ambiguity info if multi-class format had a valid second candidate
        const secondClassName = (isMultiClassFormat && secondBestScore > -Infinity && secondBestIdx >= 0)
          ? (this.modelConfig.classes[secondBestIdx] || `class_${secondBestIdx}`)
          : undefined;

        detections.push({
          x: cornerX,      // Top-left X (normalized 0-1)
          y: cornerY,      // Top-left Y (normalized 0-1)
          width: boxWidth,
          height: boxHeight,
          confidence,
          classIndex,
          className,
          raceNumber: this.extractRaceNumber(className),
          ...(isMultiClassFormat && secondClassName && secondBestScore > 0.05 ? {
            _ambiguityInfo: {
              secondClassName,
              secondConfidence: secondBestScore,
              secondRaceNumber: this.extractRaceNumber(secondClassName),
              gap: confidence - secondBestScore,
              ratio: secondBestScore / confidence,
            }
          } : {}),
        });
      }
    }

    // Format 2: Combined output tensor (YOLOv11/YOLOv8/YOLO26 format)
    else if (results['output'] || results['detections'] || results['output0']) {
      console.log('[ONNX-Parse] Using YOLO combined format');
      const outputTensor = results['output'] || results['detections'] || results['output0'];
      const output = outputTensor.data as Float32Array;
      const dims = outputTensor.dims;

      // Try to parse based on dimensions
      if (dims.length === 3) {
        const batchSize = Number(dims[0]);
        const dim1 = Number(dims[1]);
        const dim2 = Number(dims[2]);

        console.log(`[ONNX-Parse] 3D tensor format: [${batchSize}, ${dim1}, ${dim2}]`);
        console.log(`[ONNX-Parse] Model has ${this.modelConfig.classes.length} classes`);

        // Format 3: YOLO end2end format [1, max_det, 6] with [x1, y1, x2, y2, conf, class_id]
        // Produced by YOLO26 (and others) exported with end2end=True. No NMS needed.
        if (this.modelConfig.outputFormat === 'yolo-end2end' && dim2 === 6) {
          console.log(`[ONNX-Parse] Detected YOLO end2end format [1, ${dim1}, 6] — no NMS needed`);
          const numDetections = dim1;
          const [inputW, inputH] = this.modelConfig.inputSize;

          for (let i = 0; i < numDetections; i++) {
            const offset = i * 6;
            const x1 = output[offset];
            const y1 = output[offset + 1];
            const x2 = output[offset + 2];
            const y2 = output[offset + 3];
            const confidence = output[offset + 4];
            const classId = Math.round(output[offset + 5]);

            // Skip padding/empty detections (confidence 0 or very low)
            if (confidence < 0.1) continue;

            // Convert [x1,y1,x2,y2] pixel coords to normalized center-based [cx,cy,w,h]
            const boxWidth = x2 - x1;
            const boxHeight = y2 - y1;

            // Normalize to 0-1 range (end2end coords are in pixel space relative to input size)
            const normWidth = boxWidth / inputW;
            const normHeight = boxHeight / inputH;
            const normCx = (x1 + boxWidth / 2) / inputW;
            const normCy = (y1 + boxHeight / 2) / inputH;

            // Convert from center-based to corner-based (top-left) for frontend display
            const cornerX = normCx - normWidth / 2;
            const cornerY = normCy - normHeight / 2;

            const classIndex = Math.max(0, Math.min(classId, this.modelConfig.classes.length - 1));
            const className = this.modelConfig.classes[classIndex] || `class_${classIndex}`;

            detections.push({
              x: cornerX,
              y: cornerY,
              width: normWidth,
              height: normHeight,
              confidence,
              classIndex,
              className,
              raceNumber: this.extractRaceNumber(className),
            });
          }

          console.log(`[ONNX-Parse] End2end detections found: ${detections.length}`);
        }

        // Format 2a: YOLOv11 transposed format [1, 4+num_classes, num_anchors]
        else {
        console.log(`[ONNX-Parse] Expected transposed dim1: ${4 + this.modelConfig.classes.length}`);

        // YOLOv11 transposed format: [1, 4+num_classes, num_anchors]
        // Example: [1, 84, 8400] for 80 classes (4 bbox + 80 classes = 84)
        // SPECIAL CASE: [1, 64, 8400] = 60 classes (manifest might have wrong count)
        const exactMatch = dim1 === (4 + this.modelConfig.classes.length);
        const knownTransposedFormat = (dim1 === 64 && dim2 === 8400); // IMSA 60-class model
        const isTransposedFormat = exactMatch || knownTransposedFormat;

        if (knownTransposedFormat && !exactMatch) {
          console.log(`[ONNX-Parse] ✅ Known transposed format detected: [1, 64, 8400] = 60 classes`);
          console.log(`[ONNX-Parse] Overriding manifest class count (${this.modelConfig.classes.length}) → using 60 classes from tensor`);
        } else if (!exactMatch && dim2 > dim1 * 10) {
          console.log(`[ONNX-Parse] ⚠️ Dimension mismatch: dim1=${dim1} != expected ${4 + this.modelConfig.classes.length}`);
          console.log(`[ONNX-Parse] Trying STANDARD format [batch, detections, features] instead`);
        }

        if (isTransposedFormat) {
          console.log('[ONNX-Parse] Detected YOLOv11 transposed format [1, features, anchors]');
          const numAnchors = dim2;
          // Use actual class count from tensor dimensions, not manifest
          const numClasses = dim1 - 4; // dim1 = 4 bbox + num_classes
          console.log(`[ONNX-Parse] Using ${numClasses} classes from tensor (manifest says ${this.modelConfig.classes.length})`);

          // DEBUG: Sample first few anchors to see raw values
          let sampledAnchors = 0;

          for (let i = 0; i < numAnchors; i++) {
            // In transposed format, data is organized as:
            // output[0*numAnchors + i] = x
            // output[1*numAnchors + i] = y
            // output[2*numAnchors + i] = w
            // output[3*numAnchors + i] = h
            // output[(4+c)*numAnchors + i] = class_score[c]

            const x = output[0 * numAnchors + i];
            const y = output[1 * numAnchors + i];
            const width = output[2 * numAnchors + i];
            const height = output[3 * numAnchors + i];

            // Find best class
            let maxClassScore = 0;
            let bestClassIndex = 0;

            // DEBUG: Sample class scores for first anchor - show top scoring classes
            if (i === 0 && sampledAnchors === 0) {
              console.log(`[ONNX-Parse] First anchor class scores analysis:`);

              // Collect all class scores for this anchor
              const classScores: Array<{classIdx: number, score: number}> = [];
              for (let c = 0; c < numClasses; c++) {
                const idx = (4 + c) * numAnchors + i;
                const score = output[idx];
                if (score > 0.01) {  // Only include non-trivial scores
                  classScores.push({ classIdx: c, score });
                }
              }

              // Sort by score descending
              classScores.sort((a, b) => b.score - a.score);

              // Log top 5 classes (or all if fewer)
              const topN = Math.min(5, classScores.length);
              console.log(`  Found ${classScores.length} classes with score > 0.01, showing top ${topN}:`);
              for (let i = 0; i < topN; i++) {
                const { classIdx, score } = classScores[i];
                const className = this.modelConfig.classes[classIdx] || `class_${classIdx}`;
                console.log(`  class ${classIdx} (${className}): score=${score.toFixed(6)}`);
              }

              if (classScores.length === 0) {
                console.log(`  ⚠️ No classes with score > 0.01 found (all near zero)`);
              }
            }

            let secondMaxClassScore = 0;
            let secondBestClassIndex = 0;

            for (let c = 0; c < numClasses; c++) {
              const classScore = output[(4 + c) * numAnchors + i];
              if (classScore > maxClassScore) {
                secondMaxClassScore = maxClassScore;
                secondBestClassIndex = bestClassIndex;
                maxClassScore = classScore;
                bestClassIndex = c;
              } else if (classScore > secondMaxClassScore) {
                secondMaxClassScore = classScore;
                secondBestClassIndex = c;
              }
            }

            const confidence = maxClassScore; // YOLOv11 already combines objectness*class_prob

            if (confidence < 0.1) continue;

            const className = this.modelConfig.classes[bestClassIndex] || `class_${bestClassIndex}`;
            const secondClassName = (secondMaxClassScore > 0.05)
              ? (this.modelConfig.classes[secondBestClassIndex] || `class_${secondBestClassIndex}`)
              : undefined;

            // YOLOv11 outputs center-based coords, normalized 0-1
            const [inputW, inputH] = this.modelConfig.inputSize;
            const centerX = x / inputW;
            const centerY = y / inputH;
            const boxWidth = width / inputW;
            const boxHeight = height / inputH;

            // Convert to corner-based (top-left)
            const cornerX = centerX - boxWidth / 2;
            const cornerY = centerY - boxHeight / 2;

            detections.push({
              x: cornerX,
              y: cornerY,
              width: boxWidth,
              height: boxHeight,
              confidence,
              classIndex: bestClassIndex,
              className,
              raceNumber: this.extractRaceNumber(className),
              ...(secondClassName ? {
                _ambiguityInfo: {
                  secondClassName,
                  secondConfidence: secondMaxClassScore,
                  secondRaceNumber: this.extractRaceNumber(secondClassName),
                  gap: confidence - secondMaxClassScore,
                  ratio: secondMaxClassScore / confidence,
                }
              } : {}),
            });
          }
        } else {
          // Standard format: [batch, num_detections, values]
          console.log('[ONNX-Parse] Detected standard format [batch, detections, features]');
          const numDetections = dim1;
          const valuesPerDetection = dim2;

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
            let secondMaxClassScore = 0;
            let bestClassIndex = 0;
            let secondBestClassIndex = 0;

            for (let c = 0; c < this.modelConfig.classes.length; c++) {
              const classScore = this.sigmoid(output[offset + 5 + c] || 0);
              if (classScore > maxClassScore) {
                secondMaxClassScore = maxClassScore;
                secondBestClassIndex = bestClassIndex;
                maxClassScore = classScore;
                bestClassIndex = c;
              } else if (classScore > secondMaxClassScore) {
                secondMaxClassScore = classScore;
                secondBestClassIndex = c;
              }
            }

            const confidence = objectness * maxClassScore;
            const secondConfidence = objectness * secondMaxClassScore;
            if (confidence < 0.1) continue;

            const className = this.modelConfig.classes[bestClassIndex] || `class_${bestClassIndex}`;
            const secondClassName = (secondConfidence > 0.05)
              ? (this.modelConfig.classes[secondBestClassIndex] || `class_${secondBestClassIndex}`)
              : undefined;

            detections.push({
              x,
              y,
              width,
              height,
              confidence,
              classIndex: bestClassIndex,
              className,
              raceNumber: this.extractRaceNumber(className),
              ...(secondClassName ? {
                _ambiguityInfo: {
                  secondClassName,
                  secondConfidence,
                  secondRaceNumber: this.extractRaceNumber(secondClassName),
                  gap: confidence - secondConfidence,
                  ratio: secondConfidence / confidence,
                }
              } : {}),
            });
          }
        }
      } // end else (Format 2a transposed/standard)
      }
    } else {
      console.warn('[ONNX-Parse] ⚠️ Unrecognized output format. Available tensors:', outputNames);
      console.warn('[ONNX-Parse] Expected: "boxes"+"scores" (RF-DETR) OR "output"/"output0"/"detections" (YOLO)');
    }

    console.log(`[ONNX-Parse] Parsed ${detections.length} detections before NMS`);

    // === DIAGNOSTIC: Ambiguity analysis ===
    const ambiguousDetections = detections.filter(d => d._ambiguityInfo);
    if (ambiguousDetections.length > 0) {
      console.log(`[ONNX-Ambiguity] 📊 ${ambiguousDetections.length}/${detections.length} detections have a second candidate (conf > 0.05)`);

      // Categorize by gap severity
      const critical = ambiguousDetections.filter(d => d._ambiguityInfo!.gap < 0.05);
      const warning = ambiguousDetections.filter(d => d._ambiguityInfo!.gap >= 0.05 && d._ambiguityInfo!.gap < 0.15);
      const safe = ambiguousDetections.filter(d => d._ambiguityInfo!.gap >= 0.15);

      console.log(`[ONNX-Ambiguity]   🔴 CRITICAL (gap < 0.05): ${critical.length} — needs_review candidates`);
      console.log(`[ONNX-Ambiguity]   🟡 WARNING  (gap 0.05-0.15): ${warning.length} — borderline`);
      console.log(`[ONNX-Ambiguity]   🟢 SAFE     (gap > 0.15): ${safe.length} — confident`);

      // Detail critical cases (the ones that would trigger needs_review)
      for (const d of critical) {
        const a = d._ambiguityInfo!;
        const sameRaceNumber = d.raceNumber === a.secondRaceNumber;
        console.log(`[ONNX-Ambiguity]   🔴 "${d.className}" (${(d.confidence * 100).toFixed(1)}%) vs "${a.secondClassName}" (${(a.secondConfidence * 100).toFixed(1)}%) — gap=${(a.gap * 100).toFixed(2)}% ratio=${(a.ratio * 100).toFixed(1)}%${sameRaceNumber ? ' [SAME RACE#]' : ` [#${d.raceNumber} vs #${a.secondRaceNumber}]`}`);
      }
      // Also detail warning cases for completeness
      for (const d of warning) {
        const a = d._ambiguityInfo!;
        console.log(`[ONNX-Ambiguity]   🟡 "${d.className}" (${(d.confidence * 100).toFixed(1)}%) vs "${a.secondClassName}" (${(a.secondConfidence * 100).toFixed(1)}%) — gap=${(a.gap * 100).toFixed(2)}%`);
      }
    } else {
      console.log(`[ONNX-Ambiguity] ✅ All ${detections.length} detections have clear winner (no second candidate > 0.05)`);
    }

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
  }
}

// Export singleton getter
export const getOnnxDetector = (): OnnxDetector => OnnxDetector.getInstance();
