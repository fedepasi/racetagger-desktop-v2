/**
 * Scene Classifier Service
 *
 * Local ML-based scene classification using TensorFlow.js
 * Classifies F1/racing images into 5 categories:
 * - crowd_scene: Crowd/spectator shots
 * - garage_pitlane: Garage and pitlane scenes
 * - podium_celebration: Podium and celebration shots
 * - portrait_paddock: Portrait and paddock shots
 * - racing_action: On-track racing action
 *
 * Model: ResNet18 (quantized, 11MB)
 * Accuracy: 87.68% validation
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import sharp from 'sharp';

// TensorFlow.js import (pure JS version for compatibility)
let tf: any = null;

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
 * Scene Classifier Service
 * Singleton pattern for efficient model loading
 */
export class SceneClassifier {
  private static instance: SceneClassifier | null = null;
  private model: any = null;
  private modelInfo: ModelInfo | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;

  // Model configuration
  private readonly INPUT_SIZE = 224;
  private readonly MODEL_DIR = 'src/assets/models/scene-classifier';

  private constructor() {
    // Sharp is imported directly as module
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SceneClassifier {
    if (!SceneClassifier.instance) {
      SceneClassifier.instance = new SceneClassifier();
    }
    return SceneClassifier.instance;
  }

  /**
   * Initialize TensorFlow.js
   * Lazy loading to avoid startup delays
   */
  private async initTensorFlow(): Promise<boolean> {
    if (tf) return true;

    try {
      // Use pure JS version for maximum compatibility
      tf = require('@tensorflow/tfjs');
      console.log('[SceneClassifier] TensorFlow.js initialized');
      return true;
    } catch (error) {
      console.error('[SceneClassifier] Failed to load TensorFlow.js:', error);
      return false;
    }
  }

  /**
   * Get model directory path
   * Handles both development and production (packaged) paths
   */
  private getModelPath(): string {
    // In development
    const devPath = path.join(process.cwd(), this.MODEL_DIR);
    if (fs.existsSync(path.join(devPath, 'model.json'))) {
      return devPath;
    }

    // In production (packaged app)
    const prodPath = path.join(app.getAppPath(), this.MODEL_DIR);
    if (fs.existsSync(path.join(prodPath, 'model.json'))) {
      return prodPath;
    }

    // Fallback to resources directory
    const resourcesPath = path.join(process.resourcesPath || '', 'app', this.MODEL_DIR);
    if (fs.existsSync(path.join(resourcesPath, 'model.json'))) {
      return resourcesPath;
    }

    throw new Error(`Model not found in any expected location: ${devPath}, ${prodPath}, ${resourcesPath}`);
  }

  /**
   * Create a custom IO handler for loading models from local filesystem
   * This is needed because fetch() doesn't work with file:// URLs in Electron
   */
  private createFileHandler(modelPath: string): any {
    const modelJsonPath = path.join(modelPath, 'model.json');

    return {
      load: async () => {
        // Read model.json
        const modelJSON = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

        // Read weight files
        const weightsManifest = modelJSON.weightsManifest;
        const weightSpecs: any[] = [];
        const weightDataArrays: ArrayBuffer[] = [];

        for (const group of weightsManifest) {
          for (const weightPath of group.paths) {
            const fullPath = path.join(modelPath, weightPath);
            const weightBuffer = fs.readFileSync(fullPath);
            weightDataArrays.push(weightBuffer.buffer.slice(
              weightBuffer.byteOffset,
              weightBuffer.byteOffset + weightBuffer.byteLength
            ));
          }
          weightSpecs.push(...group.weights);
        }

        // Concatenate all weight buffers
        const totalSize = weightDataArrays.reduce((acc, arr) => acc + arr.byteLength, 0);
        const concatenatedWeights = new ArrayBuffer(totalSize);
        const uint8View = new Uint8Array(concatenatedWeights);
        let offset = 0;
        for (const arr of weightDataArrays) {
          uint8View.set(new Uint8Array(arr), offset);
          offset += arr.byteLength;
        }

        return {
          modelTopology: modelJSON.modelTopology,
          format: modelJSON.format,
          generatedBy: modelJSON.generatedBy,
          convertedBy: modelJSON.convertedBy,
          weightSpecs,
          weightData: concatenatedWeights
        };
      }
    };
  }

  /**
   * Load the scene classification model
   */
  public async loadModel(): Promise<boolean> {
    // Already loaded
    if (this.model) return true;

    // Already loading
    if (this.isLoading) {
      // Wait for loading to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.model !== null;
    }

    // Previous load error
    if (this.loadError) {
      throw this.loadError;
    }

    this.isLoading = true;

    try {
      // Initialize TensorFlow
      const tfReady = await this.initTensorFlow();
      if (!tfReady) {
        throw new Error('TensorFlow.js initialization failed');
      }

      // Get model path
      const modelPath = this.getModelPath();
      console.log(`[SceneClassifier] Loading model from: ${modelPath}`);

      // Load model info
      const modelInfoPath = path.join(modelPath, 'model_info.json');
      if (fs.existsSync(modelInfoPath)) {
        const modelInfoJson = fs.readFileSync(modelInfoPath, 'utf-8');
        this.modelInfo = JSON.parse(modelInfoJson);
        console.log(`[SceneClassifier] Model info loaded: ${this.modelInfo?.model_type}, accuracy: ${(this.modelInfo?.final_val_accuracy || 0) * 100}%`);
      }

      // Load TF.js model using custom file handler for Electron compatibility
      const modelJsonFullPath = path.join(modelPath, 'model.json');
      const startTime = Date.now();

      // Create custom IO handler for local file loading (fetch doesn't work with file:// in Electron)
      const fileHandler = this.createFileHandler(modelPath);

      // Modello convertito in formato "graph-model" per compatibilità TF.js
      this.model = await tf.loadGraphModel(fileHandler);

      const loadTime = Date.now() - startTime;
      console.log(`[SceneClassifier] Model loaded in ${loadTime}ms`);

      // Warm up the model with a dummy prediction
      await this.warmUp();

      return true;
    } catch (error) {
      this.loadError = error as Error;
      console.error('[SceneClassifier] Failed to load model:', error);
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Warm up the model with a dummy prediction
   */
  private async warmUp(): Promise<void> {
    if (!this.model || !tf) return;

    try {
      const dummyInput = tf.zeros([1, this.INPUT_SIZE, this.INPUT_SIZE, 3]);
      const warmupResult = this.model.predict(dummyInput);
      warmupResult.dispose();
      dummyInput.dispose();
      console.log('[SceneClassifier] Model warmed up');
    } catch (error) {
      console.warn('[SceneClassifier] Warmup failed:', error);
    }
  }

  /**
   * Preprocess image buffer for model input
   * Resizes to 224x224 and normalizes to [0, 1]
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<any> {
    if (!tf) {
      throw new Error('TensorFlow.js not initialized');
    }

    // Resize image to 224x224 using Sharp and extract raw RGB pixels
    // Use ensureAlpha(0) then removeAlpha() pattern for consistent RGB output
    const { data: resizedBuffer, info } = await sharp(imageBuffer)
      .resize(this.INPUT_SIZE, this.INPUT_SIZE, {
        fit: 'cover',
        position: 'center'
      })
      .removeAlpha()  // Ensure RGB only (no alpha channel)
      .raw()          // Output raw pixel data
      .toBuffer({ resolveWithObject: true });

    // Convert to tensor and normalize to [0, 1]
    // ResNet18 preprocessing: simple rescale by 1/255
    const tensor = tf.tensor3d(
      new Uint8Array(resizedBuffer),
      [this.INPUT_SIZE, this.INPUT_SIZE, 3],
      'float32'
    );

    // Normalize to [0, 1]
    const normalized = tensor.div(255.0);
    tensor.dispose();

    // Add batch dimension [1, 224, 224, 3]
    const batched = normalized.expandDims(0);
    normalized.dispose();

    return batched;
  }

  /**
   * Classify an image
   * @param imageBuffer Image buffer (JPEG, PNG, etc.)
   * @returns Classification result with category and confidence
   */
  public async classify(imageBuffer: Buffer): Promise<SceneClassificationResult> {
    // Ensure model is loaded
    if (!this.model) {
      const loaded = await this.loadModel();
      if (!loaded) {
        throw new Error('Failed to load scene classification model');
      }
    }

    const startTime = Date.now();

    try {
      // Preprocess image
      const inputTensor = await this.preprocessImage(imageBuffer);

      // Run prediction
      const predictions = this.model.predict(inputTensor) as any;
      const probabilities = await predictions.data();

      // Clean up tensors
      inputTensor.dispose();
      predictions.dispose();

      // Get categories
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

      console.log(`[SceneClassifier] Classified as ${topPrediction.category} (${(topPrediction.confidence * 100).toFixed(1)}%) in ${inferenceTimeMs}ms`);

      return {
        category: topPrediction.category,
        confidence: topPrediction.confidence,
        allPredictions,
        inferenceTimeMs
      };
    } catch (error) {
      console.error('[SceneClassifier] Classification failed:', error);
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
    return this.model !== null;
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
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.modelInfo = null;
    this.loadError = null;
    SceneClassifier.instance = null;
    console.log('[SceneClassifier] Model disposed');
  }
}

/**
 * Helper function to get the scene classifier instance
 */
export function getSceneClassifier(): SceneClassifier {
  return SceneClassifier.getInstance();
}

/**
 * Helper function to classify an image
 */
export async function classifyScene(imageBuffer: Buffer): Promise<SceneClassificationResult> {
  const classifier = getSceneClassifier();
  return classifier.classify(imageBuffer);
}

/**
 * Check if scene classification is available
 */
export async function isSceneClassificationAvailable(): Promise<boolean> {
  try {
    const classifier = getSceneClassifier();
    return await classifier.loadModel();
  } catch {
    return false;
  }
}
