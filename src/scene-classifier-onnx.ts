/**
 * Scene Classifier Service - ONNX Runtime Version
 *
 * High-performance local ML-based scene classification using ONNX Runtime.
 * Classifies F1/racing images into 5 categories:
 * - crowd_scene: Crowd/spectator shots
 * - garage_pitlane: Garage and pitlane scenes
 * - podium_celebration: Podium and celebration shots
 * - portrait_paddock: Portrait and paddock shots
 * - racing_action: On-track racing action
 *
 * Model: ResNet18 (ONNX, 43MB)
 * Accuracy: 87.68% validation
 * Inference: ~20-50ms (vs 3-15 seconds with TensorFlow.js)
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import sharp from 'sharp';

// ONNX Runtime import
let ort: typeof import('onnxruntime-node') | null = null;

/**
 * Scene classification categories
 */
export enum SceneCategory {
  CROWD_SCENE = 'crowd_scene',
  GARAGE_PITLANE = 'garage_pitlane',
  PODIUM_CELEBRATION = 'podium_celebration',
  PORTRAIT_PADDOCK = 'portrait_paddock',
  RACING_ACTION = 'racing_action'
}

/**
 * Scene classification result
 */
export interface SceneClassificationResult {
  category: SceneCategory;
  confidence: number;
  allPredictions: {
    category: SceneCategory;
    confidence: number;
  }[];
  inferenceTimeMs: number;
}

/**
 * Model metadata from model_info.json
 */
interface ModelInfo {
  categories: string[];
  category_to_index: { [key: string]: number };
  index_to_category: { [key: string]: string };
  input_size: [number, number];
  num_classes: number;
  model_type: string;
  preprocessing: string;
  final_val_accuracy: number;
}

/**
 * ONNX Scene Classifier Service
 * Singleton pattern for efficient model loading
 */
export class SceneClassifierONNX {
  private static instance: SceneClassifierONNX | null = null;
  private session: any = null;
  private modelInfo: ModelInfo | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;
  private inputName: string = 'input';
  private outputName: string = 'predictions';

  // Model configuration
  private readonly INPUT_SIZE = 224;
  private readonly MODEL_DIR = 'src/assets/models/scene-classifier';
  private readonly ONNX_MODEL_NAME = 'scene_classifier.onnx';

  // Category mapping (in order of model output)
  private readonly CATEGORIES: SceneCategory[] = [
    SceneCategory.CROWD_SCENE,
    SceneCategory.GARAGE_PITLANE,
    SceneCategory.PODIUM_CELEBRATION,
    SceneCategory.PORTRAIT_PADDOCK,
    SceneCategory.RACING_ACTION
  ];

  private constructor() {
    // Empty constructor - initialization happens in loadModel()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SceneClassifierONNX {
    if (!SceneClassifierONNX.instance) {
      SceneClassifierONNX.instance = new SceneClassifierONNX();
    }
    return SceneClassifierONNX.instance;
  }

  /**
   * Initialize ONNX Runtime
   * Lazy loading to avoid startup delays
   */
  private async initONNXRuntime(): Promise<boolean> {
    if (ort) return true;

    try {
      ort = require('onnxruntime-node');
      return true;
    } catch (error) {
      console.error('[SceneClassifierONNX] Failed to load ONNX Runtime:', error);
      return false;
    }
  }

  /**
   * Get model directory path
   * Handles both development and production (packaged) paths
   */
  private getModelPath(): string {
    // In development
    const devPath = path.join(process.cwd(), this.MODEL_DIR, this.ONNX_MODEL_NAME);
    if (fs.existsSync(devPath)) {
      return devPath;
    }

    // In production (packaged app) - check asar.unpacked first (for asarUnpack entries)
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      const unpackedPath = path.join(appPath.replace('app.asar', 'app.asar.unpacked'), this.MODEL_DIR, this.ONNX_MODEL_NAME);
      if (fs.existsSync(unpackedPath)) {
        return unpackedPath;
      }
    }

    // In production (packaged app) - check inside asar
    const prodPath = path.join(appPath, this.MODEL_DIR, this.ONNX_MODEL_NAME);
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }

    // Fallback to resources directory
    const resourcesPath = path.join(process.resourcesPath || '', 'app', this.MODEL_DIR, this.ONNX_MODEL_NAME);
    if (fs.existsSync(resourcesPath)) {
      return resourcesPath;
    }

    throw new Error(`ONNX model not found in any expected location: ${devPath}, ${prodPath}, ${resourcesPath}`);
  }

  /**
   * Load the ONNX scene classification model
   */
  public async loadModel(): Promise<boolean> {
    // Already loaded
    if (this.session) return true;

    // Already loading
    if (this.isLoading) {
      // Wait for loading to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.session !== null;
    }

    // Previous load error
    if (this.loadError) {
      throw this.loadError;
    }

    this.isLoading = true;

    try {
      // Initialize ONNX Runtime
      const ortReady = await this.initONNXRuntime();
      if (!ortReady || !ort) {
        throw new Error('ONNX Runtime initialization failed');
      }

      // Get model path
      const modelPath = this.getModelPath();

      // Load model info
      const modelInfoPath = path.join(path.dirname(modelPath), 'model_info.json');
      if (fs.existsSync(modelInfoPath)) {
        const modelInfoJson = fs.readFileSync(modelInfoPath, 'utf-8');
        this.modelInfo = JSON.parse(modelInfoJson);
      }

      // Create ONNX inference session
      const startTime = Date.now();

      // Session options for optimization
      const sessionOptions: any = {
        executionProviders: ['cpu'],  // Use CPU provider for compatibility
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
      };

      this.session = await ort.InferenceSession.create(modelPath, sessionOptions);

      // Get input/output names
      this.inputName = this.session.inputNames[0];
      this.outputName = this.session.outputNames[0];

      // Warm up the model with a dummy prediction
      await this.warmUp();

      return true;
    } catch (error) {
      this.loadError = error as Error;
      console.error('[SceneClassifierONNX] Failed to load model:', error);
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Warm up the model with a dummy prediction
   */
  private async warmUp(): Promise<void> {
    if (!this.session || !ort) return;

    try {
      // Create dummy input tensor
      const dummyData = new Float32Array(1 * this.INPUT_SIZE * this.INPUT_SIZE * 3).fill(0);
      const dummyTensor = new ort.Tensor('float32', dummyData, [1, this.INPUT_SIZE, this.INPUT_SIZE, 3]);

      // Run inference
      const feeds: Record<string, any> = {};
      feeds[this.inputName] = dummyTensor;
      await this.session.run(feeds);
    } catch (error) {
      // Warmup failed - non-critical
    }
  }

  /**
   * Preprocess image buffer for model input
   * Resizes to 224x224 and keeps raw pixel values (0-255)
   *
   * IMPORTANT: The ONNX model has built-in preprocessing via bn_data layer
   * which applies ImageNet normalization internally. We should NOT
   * pre-normalize the pixels - just pass raw values.
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
    // Resize image to 224x224 using Sharp and extract raw RGB pixels
    const { data: resizedBuffer } = await sharp(imageBuffer)
      .resize(this.INPUT_SIZE, this.INPUT_SIZE, {
        fit: 'cover',
        position: 'center'
      })
      .removeAlpha()  // Ensure RGB only (no alpha channel)
      .raw()          // Output raw pixel data
      .toBuffer({ resolveWithObject: true });

    // Convert to Float32Array keeping raw pixel values (0-255)
    // The model's bn_data layer handles normalization internally
    const pixelCount = this.INPUT_SIZE * this.INPUT_SIZE * 3;
    const floatData = new Float32Array(pixelCount);

    // Keep raw pixel values - model has built-in preprocessing
    // ResizedBuffer is in RGB format, interleaved: [R,G,B,R,G,B,...]
    for (let i = 0; i < pixelCount; i++) {
      floatData[i] = resizedBuffer[i];  // Raw values 0-255
    }

    return floatData;
  }

  /**
   * Classify an image
   * @param imageBuffer Image buffer (JPEG, PNG, etc.)
   * @returns Classification result with category and confidence
   */
  public async classify(imageBuffer: Buffer): Promise<SceneClassificationResult> {
    // Ensure model is loaded
    if (!this.session) {
      const loaded = await this.loadModel();
      if (!loaded) {
        throw new Error('Failed to load scene classification model');
      }
    }

    if (!ort) {
      throw new Error('ONNX Runtime not initialized');
    }

    const startTime = Date.now();

    try {
      // Preprocess image
      const inputData = await this.preprocessImage(imageBuffer);

      // Create input tensor [1, 224, 224, 3]
      const inputTensor = new ort.Tensor('float32', inputData, [1, this.INPUT_SIZE, this.INPUT_SIZE, 3]);

      // Run inference
      const feeds: Record<string, any> = {};
      feeds[this.inputName] = inputTensor;

      const results = await this.session.run(feeds);
      const outputTensor = results[this.outputName];
      const probabilities = outputTensor.data as Float32Array;

      // Get categories from model info or use defaults
      const categories = this.modelInfo?.categories || [
        'crowd_scene',
        'garage_pitlane',
        'podium_celebration',
        'portrait_paddock',
        'racing_action'
      ];

      // Build results array
      const allPredictions = categories.map((cat, idx) => ({
        category: cat as SceneCategory,
        confidence: probabilities[idx]
      })).sort((a, b) => b.confidence - a.confidence);

      // Get top prediction
      const topPrediction = allPredictions[0];

      const inferenceTimeMs = Date.now() - startTime;

      return {
        category: topPrediction.category,
        confidence: topPrediction.confidence,
        allPredictions,
        inferenceTimeMs
      };
    } catch (error) {
      console.error('[SceneClassifierONNX] Classification failed:', error);
      throw error;
    }
  }

  /**
   * Classify an image from file path
   */
  public async classifyFromPath(imagePath: string): Promise<SceneClassificationResult> {
    const imageBuffer = fs.readFileSync(imagePath);
    return this.classify(imageBuffer);
  }

  /**
   * Check if model is loaded
   */
  public isModelLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Get model info
   */
  public getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  /**
   * Dispose model and free memory
   */
  public dispose(): void {
    if (this.session) {
      // ONNX Runtime sessions don't have a dispose method but setting to null allows GC
      this.session = null;
    }
    this.modelInfo = null;
    this.loadError = null;
    SceneClassifierONNX.instance = null;
  }
}

/**
 * Helper function to get the ONNX scene classifier instance
 */
export function getSceneClassifierONNX(): SceneClassifierONNX {
  return SceneClassifierONNX.getInstance();
}

/**
 * Helper function to classify an image using ONNX
 */
export async function classifySceneONNX(imageBuffer: Buffer): Promise<SceneClassificationResult> {
  const classifier = getSceneClassifierONNX();
  return classifier.classify(imageBuffer);
}

/**
 * Check if ONNX scene classification is available
 */
export async function isSceneClassificationONNXAvailable(): Promise<boolean> {
  try {
    const classifier = getSceneClassifierONNX();
    return await classifier.loadModel();
  } catch {
    return false;
  }
}
