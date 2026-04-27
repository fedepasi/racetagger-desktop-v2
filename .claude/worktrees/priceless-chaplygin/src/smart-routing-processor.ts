/**
 * Smart Routing Processor
 *
 * Routes images to the appropriate analysis pipeline based on scene classification.
 * Uses the local ML-based scene classifier to determine the type of image and
 * selects the most efficient processing path.
 *
 * Pipeline routing:
 * - racing_action   -> car pipeline (RF-DETR / Gemini)
 * - portrait_paddock -> face pipeline (future: face recognition)
 * - podium_celebration -> face pipeline (multi-face)
 * - garage_pitlane  -> hybrid (car + face parallel)
 * - crowd_scene     -> skip or minimal processing
 */

import { SceneClassifier, SceneClassificationResult, SceneCategory } from './scene-classifier';

/**
 * Pipeline types that images can be routed to
 */
export enum PipelineType {
  CAR = 'car',           // Race number recognition (RF-DETR, Gemini)
  FACE = 'face',         // Face recognition (future)
  HYBRID = 'hybrid',     // Both car and face processing
  SKIP = 'skip',         // No AI analysis needed
  FALLBACK = 'fallback'  // Use default/legacy pipeline
}

/**
 * Routing decision with metadata
 */
export interface RoutingDecision {
  pipeline: PipelineType;
  sceneCategory: SceneCategory;
  sceneConfidence: number;
  reason: string;
  metadata: {
    inferenceTimeMs: number;
    shouldUpload: boolean;
    suggestedConcurrency: number;
  };
}

/**
 * Routing configuration thresholds
 */
export interface RoutingConfig {
  // Minimum confidence to trust scene classification
  minConfidenceThreshold: number;

  // Confidence threshold to skip AI analysis for crowd scenes
  crowdSceneSkipThreshold: number;

  // Whether to enable face pipeline (future feature)
  enableFacePipeline: boolean;

  // Whether to enable hybrid processing
  enableHybridProcessing: boolean;

  // Whether to always upload regardless of scene
  alwaysUpload: boolean;
}

/**
 * Default routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  minConfidenceThreshold: 0.5,
  crowdSceneSkipThreshold: 0.8,
  enableFacePipeline: false,  // Disabled until face recognition is implemented
  enableHybridProcessing: false,  // Disabled until face recognition is implemented
  alwaysUpload: true  // Always upload for now since we only have car pipeline
};

/**
 * Smart Routing Processor
 * Singleton pattern for efficient scene classifier reuse
 */
export class SmartRoutingProcessor {
  private static instance: SmartRoutingProcessor | null = null;
  private sceneClassifier: SceneClassifier;
  private config: RoutingConfig;
  private isInitialized: boolean = false;

  // Statistics
  private routingStats = {
    totalRouted: 0,
    byPipeline: {
      [PipelineType.CAR]: 0,
      [PipelineType.FACE]: 0,
      [PipelineType.HYBRID]: 0,
      [PipelineType.SKIP]: 0,
      [PipelineType.FALLBACK]: 0
    },
    byScene: {
      [SceneCategory.RACING_ACTION]: 0,
      [SceneCategory.PORTRAIT_PADDOCK]: 0,
      [SceneCategory.PODIUM_CELEBRATION]: 0,
      [SceneCategory.GARAGE_PITLANE]: 0,
      [SceneCategory.CROWD_SCENE]: 0
    },
    totalInferenceTimeMs: 0,
    avgInferenceTimeMs: 0
  };

  private constructor(config: Partial<RoutingConfig> = {}) {
    this.sceneClassifier = SceneClassifier.getInstance();
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...config };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<RoutingConfig>): SmartRoutingProcessor {
    if (!SmartRoutingProcessor.instance) {
      SmartRoutingProcessor.instance = new SmartRoutingProcessor(config);
    }
    return SmartRoutingProcessor.instance;
  }

  /**
   * Initialize the router (loads scene classifier model)
   */
  public async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      const loaded = await this.sceneClassifier.loadModel();
      this.isInitialized = loaded;

      if (loaded) {
        console.log('[SmartRouter] Initialized successfully');
      } else {
        console.warn('[SmartRouter] Scene classifier not available, using fallback routing');
      }

      return loaded;
    } catch (error) {
      console.error('[SmartRouter] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Route an image to the appropriate pipeline
   * @param imageBuffer Image buffer to classify
   * @returns Routing decision with pipeline and metadata
   */
  public async routeImage(imageBuffer: Buffer): Promise<RoutingDecision> {
    // If scene classifier not available, use fallback
    if (!this.isInitialized || !this.sceneClassifier.isModelLoaded()) {
      return this.createFallbackDecision();
    }

    try {
      // Classify the scene
      const classification = await this.sceneClassifier.classify(imageBuffer);

      // Make routing decision based on scene
      const decision = this.makeRoutingDecision(classification);

      // Update statistics
      this.updateStats(decision, classification.inferenceTimeMs);

      return decision;
    } catch (error) {
      console.error('[SmartRouter] Classification failed, using fallback:', error);
      return this.createFallbackDecision();
    }
  }

  /**
   * Route an image from file path
   */
  public async routeImageFromPath(imagePath: string): Promise<RoutingDecision> {
    if (!this.isInitialized || !this.sceneClassifier.isModelLoaded()) {
      return this.createFallbackDecision();
    }

    try {
      const classification = await this.sceneClassifier.classifyFromPath(imagePath);
      const decision = this.makeRoutingDecision(classification);
      this.updateStats(decision, classification.inferenceTimeMs);
      return decision;
    } catch (error) {
      console.error('[SmartRouter] Classification failed, using fallback:', error);
      return this.createFallbackDecision();
    }
  }

  /**
   * Make routing decision based on scene classification
   */
  private makeRoutingDecision(classification: SceneClassificationResult): RoutingDecision {
    const { category, confidence, inferenceTimeMs } = classification;

    // Low confidence - use fallback
    if (confidence < this.config.minConfidenceThreshold) {
      return {
        pipeline: PipelineType.FALLBACK,
        sceneCategory: category,
        sceneConfidence: confidence,
        reason: `Low confidence (${(confidence * 100).toFixed(1)}% < ${(this.config.minConfidenceThreshold * 100).toFixed(1)}%)`,
        metadata: {
          inferenceTimeMs,
          shouldUpload: this.config.alwaysUpload,
          suggestedConcurrency: 4
        }
      };
    }

    // Route based on scene category
    switch (category) {
      case SceneCategory.RACING_ACTION:
        return {
          pipeline: PipelineType.CAR,
          sceneCategory: category,
          sceneConfidence: confidence,
          reason: 'Racing action detected - using car number recognition',
          metadata: {
            inferenceTimeMs,
            shouldUpload: true,
            suggestedConcurrency: 4  // Higher concurrency for racing shots
          }
        };

      case SceneCategory.PORTRAIT_PADDOCK:
        // Currently route to car pipeline since face pipeline not implemented
        if (this.config.enableFacePipeline) {
          return {
            pipeline: PipelineType.FACE,
            sceneCategory: category,
            sceneConfidence: confidence,
            reason: 'Portrait detected - using face recognition',
            metadata: {
              inferenceTimeMs,
              shouldUpload: true,
              suggestedConcurrency: 2  // Lower concurrency for face recognition
            }
          };
        }
        // Fallback to car pipeline
        return {
          pipeline: PipelineType.CAR,
          sceneCategory: category,
          sceneConfidence: confidence,
          reason: 'Portrait detected - face pipeline not enabled, using car pipeline',
          metadata: {
            inferenceTimeMs,
            shouldUpload: true,
            suggestedConcurrency: 3
          }
        };

      case SceneCategory.PODIUM_CELEBRATION:
        // Multi-face recognition for podium shots
        if (this.config.enableFacePipeline) {
          return {
            pipeline: PipelineType.FACE,
            sceneCategory: category,
            sceneConfidence: confidence,
            reason: 'Podium celebration - using multi-face recognition',
            metadata: {
              inferenceTimeMs,
              shouldUpload: true,
              suggestedConcurrency: 2
            }
          };
        }
        // Fallback to car pipeline
        return {
          pipeline: PipelineType.CAR,
          sceneCategory: category,
          sceneConfidence: confidence,
          reason: 'Podium detected - face pipeline not enabled, using car pipeline',
          metadata: {
            inferenceTimeMs,
            shouldUpload: true,
            suggestedConcurrency: 3
          }
        };

      case SceneCategory.GARAGE_PITLANE:
        // Hybrid processing for garage/pitlane (car numbers + team personnel)
        if (this.config.enableHybridProcessing) {
          return {
            pipeline: PipelineType.HYBRID,
            sceneCategory: category,
            sceneConfidence: confidence,
            reason: 'Garage/pitlane detected - using hybrid car+face processing',
            metadata: {
              inferenceTimeMs,
              shouldUpload: true,
              suggestedConcurrency: 3
            }
          };
        }
        // Fallback to car pipeline
        return {
          pipeline: PipelineType.CAR,
          sceneCategory: category,
          sceneConfidence: confidence,
          reason: 'Garage/pitlane detected - using car number recognition',
          metadata: {
            inferenceTimeMs,
            shouldUpload: true,
            suggestedConcurrency: 3
          }
        };

      case SceneCategory.CROWD_SCENE:
        // Skip AI analysis for high-confidence crowd scenes
        if (confidence >= this.config.crowdSceneSkipThreshold) {
          return {
            pipeline: PipelineType.SKIP,
            sceneCategory: category,
            sceneConfidence: confidence,
            reason: `High-confidence crowd scene (${(confidence * 100).toFixed(1)}%) - skipping AI analysis`,
            metadata: {
              inferenceTimeMs,
              shouldUpload: false,
              suggestedConcurrency: 6
            }
          };
        }
        // Lower confidence - try car pipeline anyway
        return {
          pipeline: PipelineType.CAR,
          sceneCategory: category,
          sceneConfidence: confidence,
          reason: 'Crowd scene with moderate confidence - trying car number recognition',
          metadata: {
            inferenceTimeMs,
            shouldUpload: true,
            suggestedConcurrency: 4
          }
        };

      default:
        return this.createFallbackDecision();
    }
  }

  /**
   * Create a fallback routing decision
   */
  private createFallbackDecision(): RoutingDecision {
    return {
      pipeline: PipelineType.FALLBACK,
      sceneCategory: SceneCategory.RACING_ACTION,  // Default assumption
      sceneConfidence: 0,
      reason: 'Using fallback routing - scene classification unavailable',
      metadata: {
        inferenceTimeMs: 0,
        shouldUpload: true,
        suggestedConcurrency: 4
      }
    };
  }

  /**
   * Update routing statistics
   */
  private updateStats(decision: RoutingDecision, inferenceTimeMs: number): void {
    this.routingStats.totalRouted++;
    this.routingStats.byPipeline[decision.pipeline]++;
    this.routingStats.byScene[decision.sceneCategory]++;
    this.routingStats.totalInferenceTimeMs += inferenceTimeMs;
    this.routingStats.avgInferenceTimeMs =
      this.routingStats.totalInferenceTimeMs / this.routingStats.totalRouted;
  }

  /**
   * Get routing statistics
   */
  public getStats(): typeof this.routingStats {
    return { ...this.routingStats };
  }

  /**
   * Reset routing statistics
   */
  public resetStats(): void {
    this.routingStats = {
      totalRouted: 0,
      byPipeline: {
        [PipelineType.CAR]: 0,
        [PipelineType.FACE]: 0,
        [PipelineType.HYBRID]: 0,
        [PipelineType.SKIP]: 0,
        [PipelineType.FALLBACK]: 0
      },
      byScene: {
        [SceneCategory.RACING_ACTION]: 0,
        [SceneCategory.PORTRAIT_PADDOCK]: 0,
        [SceneCategory.PODIUM_CELEBRATION]: 0,
        [SceneCategory.GARAGE_PITLANE]: 0,
        [SceneCategory.CROWD_SCENE]: 0
      },
      totalInferenceTimeMs: 0,
      avgInferenceTimeMs: 0
    };
  }

  /**
   * Check if router is ready
   */
  public isReady(): boolean {
    return this.isInitialized && this.sceneClassifier.isModelLoaded();
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<RoutingConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[SmartRouter] Configuration updated:', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): RoutingConfig {
    return { ...this.config };
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.sceneClassifier.dispose();
    this.isInitialized = false;
    this.resetStats();
    SmartRoutingProcessor.instance = null;
    console.log('[SmartRouter] Disposed');
  }
}

/**
 * Get the smart router instance
 */
export function getSmartRouter(config?: Partial<RoutingConfig>): SmartRoutingProcessor {
  return SmartRoutingProcessor.getInstance(config);
}

/**
 * Route an image to the appropriate pipeline
 */
export async function routeImage(imageBuffer: Buffer): Promise<RoutingDecision> {
  const router = getSmartRouter();
  if (!router.isReady()) {
    await router.initialize();
  }
  return router.routeImage(imageBuffer);
}
