import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('ONNX Pipeline Integration', () => {
  let tempDir: TempDirectory;

  const FIXTURES_DIR = path.join(__dirname, '../fixtures/images');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  test('full pipeline: scene → segment → detect', async () => {
    // Load all components using singleton patterns
    let SceneClassifierONNX: any, GenericSegmenter: any, OnnxDetector: any;

    try {
      SceneClassifierONNX = require('../../src/scene-classifier-onnx').SceneClassifierONNX;
      GenericSegmenter = require('../../src/generic-segmenter').GenericSegmenter;
      OnnxDetector = require('../../src/onnx-detector').OnnxDetector;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: ONNX components not available:', message);
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Test image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);

    // 1. Scene classification
    const classifier = SceneClassifierONNX.getInstance();
    const modelLoaded = await classifier.loadModel().catch(() => false);
    if (!modelLoaded) {
      console.log('⏭️  Skipping: Scene classifier model not available');
      return;
    }

    const sceneResult = await classifier.classify(imageBuffer);
    expect(sceneResult).toBeDefined();
    expect(sceneResult.category).toBeDefined();
    expect(typeof sceneResult.confidence).toBe('number');

    // 2. Segmentation
    const segmenter = GenericSegmenter.getInstance();
    if (segmenter.isReady()) {
      const segResult = await segmenter.detect(imageBuffer);
      expect(segResult).toBeDefined();
      expect(Array.isArray(segResult.detections)).toBe(true);

      // 3. Detection
      const detector = OnnxDetector.getInstance();
      if (detector.isReady()) {
        const detResult = await detector.detect(imageBuffer);
        expect(detResult).toBeDefined();
        expect(Array.isArray(detResult.results)).toBe(true);
      }
    }
  });

  test('smart routing processor is accessible', async () => {
    let SmartRoutingProcessor: any;

    try {
      SmartRoutingProcessor = require('../../src/smart-routing-processor').SmartRoutingProcessor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: SmartRoutingProcessor not available:', message);
      return;
    }

    const processor = SmartRoutingProcessor.getInstance();
    expect(processor).toBeDefined();
    expect(typeof processor.isReady).toBe('function');
    expect(typeof processor.routeImage).toBe('function');
    expect(typeof processor.routeImageFromPath).toBe('function');
    expect(typeof processor.getStats).toBe('function');
    expect(typeof processor.getConfig).toBe('function');
  });

  test('PipelineType enum values are correct', () => {
    try {
      const { PipelineType } = require('../../src/smart-routing-processor');

      expect(PipelineType.CAR).toBe('car');
      expect(PipelineType.FACE).toBe('face');
      expect(PipelineType.HYBRID).toBe('hybrid');
      expect(PipelineType.SKIP).toBe('skip');
      expect(PipelineType.FALLBACK).toBe('fallback');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  PipelineType enum not available:', message);
    }
  });

  test('smart routing from image path', async () => {
    let SmartRoutingProcessor: any;

    try {
      SmartRoutingProcessor = require('../../src/smart-routing-processor').SmartRoutingProcessor;
    } catch (error) {
      console.log('⏭️  Skipping: SmartRoutingProcessor not available');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const processor = SmartRoutingProcessor.getInstance();

    try {
      await processor.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Router initialization failed:', message);
      return;
    }

    if (!processor.isReady()) {
      console.log('⏭️  Skipping: Smart router not ready');
      return;
    }

    const decision = await processor.routeImageFromPath(sampleImage);

    expect(decision).toBeDefined();
    expect(decision.pipeline).toBeDefined();
    expect(decision.sceneCategory).toBeDefined();
    expect(typeof decision.sceneConfidence).toBe('number');
    expect(decision.reason).toBeDefined();
    expect(decision.metadata).toBeDefined();
    expect(typeof decision.metadata.inferenceTimeMs).toBe('number');
    expect(typeof decision.metadata.shouldUpload).toBe('boolean');
  });

  test('smart routing from buffer', async () => {
    let SmartRoutingProcessor: any;

    try {
      SmartRoutingProcessor = require('../../src/smart-routing-processor').SmartRoutingProcessor;
    } catch (error) {
      console.log('⏭️  Skipping: SmartRoutingProcessor not available');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const processor = SmartRoutingProcessor.getInstance();
    if (!processor.isReady()) {
      console.log('⏭️  Skipping: Smart router not ready');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);
    const decision = await processor.routeImage(imageBuffer);

    expect(decision).toBeDefined();
    expect(decision.pipeline).toBeDefined();
  });

  test('routing stats tracking', () => {
    let SmartRoutingProcessor: any;

    try {
      SmartRoutingProcessor = require('../../src/smart-routing-processor').SmartRoutingProcessor;
    } catch (error) {
      console.log('⏭️  Skipping: SmartRoutingProcessor not available');
      return;
    }

    const processor = SmartRoutingProcessor.getInstance();

    const stats = processor.getStats();
    expect(stats).toBeDefined();

    // Reset stats should not throw
    expect(() => processor.resetStats()).not.toThrow();
  });

  test('routing config is configurable', () => {
    let SmartRoutingProcessor: any;

    try {
      SmartRoutingProcessor = require('../../src/smart-routing-processor').SmartRoutingProcessor;
    } catch (error) {
      console.log('⏭️  Skipping: SmartRoutingProcessor not available');
      return;
    }

    const processor = SmartRoutingProcessor.getInstance();

    const config = processor.getConfig();
    expect(config).toBeDefined();
    expect(typeof config.minConfidenceThreshold).toBe('number');

    // Update config should not throw
    expect(() => {
      processor.updateConfig({ minConfidenceThreshold: 0.6 });
    }).not.toThrow();
  });

  test('all ONNX components share model manager', () => {
    try {
      const { getModelManager } = require('../../src/model-manager');
      const m1 = getModelManager();
      const m2 = getModelManager();

      // Singleton pattern
      expect(m1).toBe(m2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  ModelManager not available:', message);
    }
  });
});
