/**
 * ML Integration Interfaces
 *
 * This module defines interfaces and abstractions for future ML integration.
 * These interfaces provide clean separation between rule-based and ML approaches,
 * enabling gradual migration to ML-enhanced matching while maintaining
 * backward compatibility.
 *
 * ARCHITECTURE DESIGN:
 * - Pluggable ML models via interface
 * - Feature extraction abstraction
 * - Ensemble methods for combining multiple models
 * - A/B testing infrastructure for model evaluation
 */

import { Evidence, EvidenceType } from './evidence-collector';
import { Participant, AnalysisResult, MatchCandidate } from './smart-matcher';

/**
 * ML Model Interface
 *
 * Standardized interface for all ML models used in matching.
 * This allows for easy swapping and A/B testing of different models.
 */
export interface MLModel {
  readonly name: string;
  readonly version: string;
  readonly type: MLModelType;
  readonly isReady: boolean;

  /**
   * Initialize the model (load weights, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Predict similarity/matching scores
   */
  predict(features: MLFeatureVector): Promise<MLPrediction>;

  /**
   * Batch prediction for efficiency
   */
  batchPredict(featuresBatch: MLFeatureVector[]): Promise<MLPrediction[]>;

  /**
   * Get model metadata and capabilities
   */
  getMetadata(): MLModelMetadata;

  /**
   * Cleanup resources
   */
  dispose(): Promise<void>;
}

export enum MLModelType {
  NAME_SIMILARITY = 'name_similarity',      // For driver name matching
  SPONSOR_RECOGNITION = 'sponsor_recognition', // For sponsor text matching
  OCR_CORRECTION = 'ocr_correction',         // For race number correction
  ENSEMBLE_SCORER = 'ensemble_scorer',       // For combining multiple evidence
  FEATURE_EXTRACTOR = 'feature_extractor'   // For extracting features from raw data
}

export interface MLModelMetadata {
  name: string;
  version: string;
  type: MLModelType;
  trainedOn: string; // Dataset description
  accuracy: number;  // Reported accuracy
  latency: number;   // Average prediction time in ms
  memoryUsage: number; // Memory usage in MB
  supportsBatch: boolean;
  maxBatchSize?: number;
}

/**
 * Feature Vector Interface
 *
 * Standardized feature representation for ML models.
 * All data must be converted to this format before ML processing.
 */
export interface MLFeatureVector {
  id: string;
  features: {
    // Text features
    raceNumber?: string;
    normalizedRaceNumber?: string;
    driverNames?: string[];
    normalizedDriverNames?: string[];
    sponsors?: string[];
    normalizedSponsors?: string[];
    teamName?: string;
    normalizedTeamName?: string;

    // Numerical features
    ocrConfidence?: number;
    textLength?: number;
    wordCount?: number;
    numberDigits?: number;

    // Categorical features
    sport?: string;
    category?: string;
    context?: string; // 'race', 'podium', 'portrait', etc.

    // Embedding features (for deep learning models)
    textEmbedding?: number[];
    nameEmbedding?: number[];
    sponsorEmbedding?: number[];

    // Meta features
    evidenceTypes?: EvidenceType[];
    evidenceCount?: number;
    multiEvidenceBonus?: number;
  };
  metadata?: {
    imageId?: string;
    timestamp?: number;
    source?: string;
  };
}

/**
 * ML Prediction Result
 */
export interface MLPrediction {
  score: number;          // Similarity/matching score (0-1)
  confidence: number;     // Model confidence in prediction (0-1)
  features?: string[];    // Which features contributed most
  reasoning?: string[];   // Human-readable explanation
  metadata?: {
    modelName: string;
    version: string;
    processingTime: number;
    alternatives?: Array<{
      score: number;
      explanation: string;
    }>;
  };
}

/**
 * Feature Extractor Interface
 *
 * Converts raw matching data into ML-ready feature vectors.
 */
export interface MLFeatureExtractor {
  /**
   * Extract features from analysis result and participant
   */
  extractFeatures(
    analysis: AnalysisResult,
    participant: Participant,
    evidence: Evidence[]
  ): Promise<MLFeatureVector>;

  /**
   * Extract features for batch processing
   */
  extractBatchFeatures(
    analysis: AnalysisResult,
    participants: Participant[],
    evidence: Evidence[]
  ): Promise<MLFeatureVector[]>;

  /**
   * Get supported feature types
   */
  getSupportedFeatures(): string[];
}

/**
 * Ensemble Model Interface
 *
 * Combines predictions from multiple models to improve accuracy.
 */
export interface MLEnsembleModel extends MLModel {
  /**
   * Add a model to the ensemble
   */
  addModel(model: MLModel, weight: number): void;

  /**
   * Remove a model from the ensemble
   */
  removeModel(modelName: string): void;

  /**
   * Update model weights
   */
  updateWeights(weights: { [modelName: string]: number }): void;

  /**
   * Get ensemble composition
   */
  getComposition(): Array<{
    model: string;
    weight: number;
    accuracy: number;
  }>;
}

/**
 * ML Training Interface
 *
 * Interface for models that support online learning or fine-tuning.
 */
export interface MLTrainableModel extends MLModel {
  /**
   * Train/update model with new examples
   */
  train(
    features: MLFeatureVector[],
    labels: number[],
    options?: MLTrainingOptions
  ): Promise<MLTrainingResult>;

  /**
   * Evaluate model performance
   */
  evaluate(
    testFeatures: MLFeatureVector[],
    testLabels: number[]
  ): Promise<MLEvaluationResult>;

  /**
   * Save model state
   */
  save(path: string): Promise<void>;

  /**
   * Load model state
   */
  load(path: string): Promise<void>;
}

export interface MLTrainingOptions {
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  validationSplit?: number;
  earlyStoppingPatience?: number;
  saveCheckpoints?: boolean;
}

export interface MLTrainingResult {
  finalAccuracy: number;
  finalLoss: number;
  trainingTime: number;
  epochs: number;
  convergence: boolean;
  metrics: {
    precision: number;
    recall: number;
    f1Score: number;
  };
}

export interface MLEvaluationResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  confusionMatrix: number[][];
  classificationReport: string;
}

/**
 * ML Model Manager Interface
 *
 * Manages loading, caching, and lifecycle of ML models.
 */
export interface MLModelManager {
  /**
   * Register a model
   */
  registerModel(model: MLModel): Promise<void>;

  /**
   * Get a model by name and type
   */
  getModel(name: string, type: MLModelType): Promise<MLModel | null>;

  /**
   * Get all models of a specific type
   */
  getModelsByType(type: MLModelType): Promise<MLModel[]>;

  /**
   * Load model from storage
   */
  loadModel(modelPath: string, type: MLModelType): Promise<MLModel>;

  /**
   * Unload model to free memory
   */
  unloadModel(name: string): Promise<void>;

  /**
   * Get model performance metrics
   */
  getModelMetrics(name: string): Promise<MLEvaluationResult | null>;

  /**
   * Update model performance metrics
   */
  updateModelMetrics(name: string, metrics: MLEvaluationResult): Promise<void>;
}

/**
 * A/B Testing Interface
 *
 * Enables testing different models or configurations against each other.
 */
export interface MLABTester {
  /**
   * Create a new A/B test
   */
  createTest(
    testName: string,
    modelA: MLModel,
    modelB: MLModel,
    trafficSplit: number // 0.0 to 1.0
  ): Promise<string>; // Returns test ID

  /**
   * Get prediction using A/B test (automatically assigns traffic)
   */
  predict(
    testId: string,
    features: MLFeatureVector
  ): Promise<{
    prediction: MLPrediction;
    modelUsed: string;
    variant: 'A' | 'B';
  }>;

  /**
   * Record test result
   */
  recordResult(
    testId: string,
    predictionId: string,
    actualResult: boolean, // Was the prediction correct?
    feedback?: any
  ): Promise<void>;

  /**
   * Get test results
   */
  getTestResults(testId: string): Promise<MLABTestResult>;

  /**
   * End test and get final results
   */
  endTest(testId: string): Promise<MLABTestResult>;
}

export interface MLABTestResult {
  testId: string;
  testName: string;
  status: 'running' | 'completed' | 'stopped';
  startTime: number;
  endTime?: number;
  totalPredictions: number;
  results: {
    modelA: {
      name: string;
      predictions: number;
      accuracy: number;
      avgLatency: number;
    };
    modelB: {
      name: string;
      predictions: number;
      accuracy: number;
      avgLatency: number;
    };
  };
  winner?: 'A' | 'B' | 'tie';
  confidence: number; // Statistical confidence in result
  significanceLevel: number;
}

/**
 * ML Configuration Interface
 *
 * Centralizes ML-related configuration and hyperparameters.
 */
export interface MLConfiguration {
  models: {
    [modelType: string]: {
      enabled: boolean;
      defaultModel: string;
      fallbackToRuleBased: boolean;
      hyperparameters?: { [key: string]: any };
    };
  };
  ensemble: {
    enabled: boolean;
    weights: { [modelName: string]: number };
    votingStrategy: 'majority' | 'weighted' | 'confidence';
  };
  training: {
    autoTrain: boolean;
    minSamplesForTraining: number;
    retrainInterval: number; // in hours
    maxTrainingTime: number; // in minutes
  };
  performance: {
    maxLatency: number; // Maximum acceptable prediction time
    minAccuracy: number; // Minimum accuracy before fallback
    cacheSize: number; // Number of predictions to cache
  };
  abTesting: {
    enabled: boolean;
    defaultTrafficSplit: number;
    minSampleSize: number;
    significanceLevel: number;
  };
}

/**
 * TODO_ML_INTEGRATION: Implementation Classes
 *
 * The following classes should be implemented to provide concrete
 * implementations of the above interfaces:
 *
 * 1. TransformerNameMatcher - BERT-based name similarity
 * 2. CNNSponsorRecognizer - CNN for sponsor logo/text recognition
 * 3. LSTMOCRCorrector - LSTM for sequence-based OCR correction
 * 4. RandomForestEnsemble - Tree-based ensemble for general matching
 * 5. NeuralEnsemble - Neural network ensemble combiner
 * 6. BayesianABTester - Bayesian A/B testing implementation
 * 7. RedisModelCache - Redis-based model caching
 * 8. PostgresMLMetrics - PostgreSQL storage for ML metrics
 *
 * Implementation roadmap:
 * Phase 1: Feature extractors and simple models
 * Phase 2: Advanced models (transformers, CNNs)
 * Phase 3: Ensemble methods and A/B testing
 * Phase 4: Online learning and continuous improvement
 */

/**
 * Factory pattern for creating ML components
 */
export class MLFactory {
  /**
   * Create a feature extractor
   */
  static createFeatureExtractor(type: string): MLFeatureExtractor {
    // TODO_ML_INTEGRATION: Implement factory methods
    throw new Error('MLFactory not yet implemented - placeholder for future ML integration');
  }

  /**
   * Create a model
   */
  static createModel(type: MLModelType, config: any): MLModel {
    // TODO_ML_INTEGRATION: Implement model factory
    throw new Error('MLFactory not yet implemented - placeholder for future ML integration');
  }

  /**
   * Create an ensemble model
   */
  static createEnsemble(models: MLModel[], weights: number[]): MLEnsembleModel {
    // TODO_ML_INTEGRATION: Implement ensemble factory
    throw new Error('MLFactory not yet implemented - placeholder for future ML integration');
  }
}

/**
 * Utility functions for ML integration
 */
export class MLUtils {
  /**
   * Normalize text for ML processing
   */
  static normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  /**
   * Extract numerical features from text
   */
  static extractTextFeatures(text: string): {
    length: number;
    wordCount: number;
    digitCount: number;
    upperCaseRatio: number;
  } {
    return {
      length: text.length,
      wordCount: text.split(/\s+/).length,
      digitCount: (text.match(/\d/g) || []).length,
      upperCaseRatio: (text.match(/[A-Z]/g) || []).length / text.length
    };
  }

  /**
   * Calculate feature similarity
   */
  static calculateFeatureSimilarity(
    features1: MLFeatureVector,
    features2: MLFeatureVector
  ): number {
    // TODO_ML_INTEGRATION: Implement feature similarity calculation
    return 0.0;
  }

  /**
   * Convert evidence to feature vector
   */
  static evidenceToFeatures(evidence: Evidence[]): Partial<MLFeatureVector['features']> {
    const features: any = {
      evidenceTypes: evidence.map(e => e.type),
      evidenceCount: evidence.length
    };

    for (const item of evidence) {
      switch (item.type) {
        case EvidenceType.RACE_NUMBER:
          features.raceNumber = item.value;
          features.normalizedRaceNumber = this.normalizeText(item.value);
          break;
        case EvidenceType.DRIVER_NAME:
          if (!features.driverNames) features.driverNames = [];
          features.driverNames.push(item.value);
          break;
        case EvidenceType.SPONSOR:
          if (!features.sponsors) features.sponsors = [];
          features.sponsors.push(item.value);
          break;
        case EvidenceType.TEAM:
          features.teamName = item.value;
          features.normalizedTeamName = this.normalizeText(item.value);
          break;
      }
    }

    return features;
  }
}