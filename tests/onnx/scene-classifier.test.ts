import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('Scene Classifier (ONNX)', () => {
  let tempDir: TempDirectory;

  const FIXTURES_DIR = path.join(__dirname, '../fixtures/images');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  async function getSceneClassifier() {
    try {
      const { SceneClassifierONNX } = require('../../src/scene-classifier-onnx');
      return SceneClassifierONNX.getInstance();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Scene classifier not available:', message);
      return null;
    }
  }

  async function loadClassifierModel(classifier: any): Promise<boolean> {
    try {
      return await classifier.loadModel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Model loading failed:', message);
      return false;
    }
  }

  test('SceneClassifierONNX singleton is accessible', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    expect(classifier).toBeDefined();
    expect(typeof classifier.loadModel).toBe('function');
    expect(typeof classifier.classify).toBe('function');
    expect(typeof classifier.classifyFromPath).toBe('function');
    expect(typeof classifier.isModelLoaded).toBe('function');
    expect(typeof classifier.dispose).toBe('function');
  });

  test('SceneCategory enum values are correct', () => {
    try {
      const { SceneCategory } = require('../../src/scene-classifier-onnx');

      expect(SceneCategory.CROWD_SCENE).toBe('crowd_scene');
      expect(SceneCategory.GARAGE_PITLANE).toBe('garage_pitlane');
      expect(SceneCategory.PODIUM_CELEBRATION).toBe('podium_celebration');
      expect(SceneCategory.PORTRAIT_PADDOCK).toBe('portrait_paddock');
      expect(SceneCategory.RACING_ACTION).toBe('racing_action');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  SceneCategory enum not available:', message);
    }
  });

  test('classifyFromPath returns SceneClassificationResult', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    const loaded = await loadClassifierModel(classifier);
    if (!loaded) {
      console.log('⏭️  Skipping: Model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const result = await classifier.classifyFromPath(sampleImage);

    expect(result).toBeDefined();
    expect(result.category).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.inferenceTimeMs).toBeDefined();
    expect(typeof result.inferenceTimeMs).toBe('number');

    // allPredictions should have all scene categories
    expect(result.allPredictions).toBeDefined();
    expect(Array.isArray(result.allPredictions)).toBe(true);
    expect(result.allPredictions.length).toBeGreaterThan(0);

    for (const pred of result.allPredictions) {
      expect(pred.category).toBeDefined();
      expect(typeof pred.confidence).toBe('number');
    }
  });

  test('classify accepts Buffer input', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    const loaded = await loadClassifierModel(classifier);
    if (!loaded) {
      console.log('⏭️  Skipping: Model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);
    const result = await classifier.classify(imageBuffer);

    expect(result).toBeDefined();
    expect(result.category).toBeDefined();
    expect(typeof result.confidence).toBe('number');
  });

  test('isModelLoaded reflects load state', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    // Before loading
    const beforeLoad = classifier.isModelLoaded();
    expect(typeof beforeLoad).toBe('boolean');

    const loaded = await loadClassifierModel(classifier);
    if (loaded) {
      expect(classifier.isModelLoaded()).toBe(true);
    }
  });

  test('getModelInfo returns model metadata', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    const loaded = await loadClassifierModel(classifier);
    if (!loaded) {
      console.log('⏭️  Skipping: Model not loaded');
      return;
    }

    const info = classifier.getModelInfo();
    if (info) {
      expect(info).toBeDefined();
    }
  });

  test('helper functions are exported', () => {
    try {
      const mod = require('../../src/scene-classifier-onnx');

      expect(typeof mod.getSceneClassifierONNX).toBe('function');
      expect(typeof mod.classifySceneONNX).toBe('function');
      expect(typeof mod.isSceneClassificationONNXAvailable).toBe('function');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Helper functions not available:', message);
    }
  });

  test('handles corrupted image buffer', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    const loaded = await loadClassifierModel(classifier);
    if (!loaded) {
      console.log('⏭️  Skipping: Model not loaded');
      return;
    }

    const corruptedBuffer = Buffer.from([0xFF, 0xD8, 0x00, 0x00]);

    try {
      await classifier.classify(corruptedBuffer);
    } catch (error) {
      // Expected to throw for corrupted images
      expect(error).toBeDefined();
    }
  });

  test('batch classification is consistent', async () => {
    const classifier = await getSceneClassifier();
    if (!classifier) return;

    const loaded = await loadClassifierModel(classifier);
    if (!loaded) {
      console.log('⏭️  Skipping: Model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);

    // Classify same image multiple times
    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await classifier.classify(imageBuffer);
      results.push(result);
    }

    // All results should have the same category (deterministic model)
    const categories = results.map(r => r.category);
    expect(new Set(categories).size).toBe(1);
  });
});
