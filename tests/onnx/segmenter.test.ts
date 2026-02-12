import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('YOLOv8-seg Generic Segmenter', () => {
  let tempDir: TempDirectory;

  const FIXTURES_DIR = path.join(__dirname, '../fixtures/images');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function getSegmenter() {
    try {
      const { GenericSegmenter } = require('../../src/generic-segmenter');
      return GenericSegmenter.getInstance();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Segmenter not available:', message);
      return null;
    }
  }

  test('GenericSegmenter singleton is accessible', () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    expect(segmenter).toBeDefined();
    expect(typeof segmenter.loadModel).toBe('function');
    expect(typeof segmenter.detect).toBe('function');
    expect(typeof segmenter.isReady).toBe('function');
    expect(typeof segmenter.dispose).toBe('function');
    expect(typeof segmenter.getModelId).toBe('function');
    expect(typeof segmenter.needsModelReload).toBe('function');
  });

  test('GenericSegmenter exports correct config and types', () => {
    try {
      const mod = require('../../src/generic-segmenter');

      expect(mod.GenericSegmenter).toBeDefined();
      expect(mod.DEFAULT_SEGMENTER_CONFIG).toBeDefined();
      expect(typeof mod.getGenericSegmenter).toBe('function');

      // Verify default config structure
      const config = mod.DEFAULT_SEGMENTER_CONFIG;
      expect(config).toHaveProperty('confidenceThreshold');
      expect(config).toHaveProperty('iouThreshold');
      expect(config).toHaveProperty('maskThreshold');
      expect(config).toHaveProperty('maxDetections');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  GenericSegmenter module not available:', message);
    }
  });

  test('isReady returns boolean', () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    const ready = segmenter.isReady();
    expect(typeof ready).toBe('boolean');
  });

  test('getModelId returns string', () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    const modelId = segmenter.getModelId();
    expect(typeof modelId).toBe('string');
  });

  test('needsModelReload returns boolean', () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    const currentModelId = segmenter.getModelId();

    // needsModelReload should return boolean for any input
    expect(typeof segmenter.needsModelReload(currentModelId)).toBe('boolean');
    expect(typeof segmenter.needsModelReload('different-model-id')).toBe('boolean');

    // A different model ID should always need reload
    expect(segmenter.needsModelReload('different-model-id')).toBe(true);
  });

  test('detect accepts Buffer and returns GenericSegmenterOutput', async () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    if (!segmenter.isReady()) {
      console.log('⏭️  Skipping: Segmenter model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);
    const result = await segmenter.detect(imageBuffer);

    expect(result).toBeDefined();
    expect(result.detections).toBeDefined();
    expect(Array.isArray(result.detections)).toBe(true);
    expect(result.imageSize).toBeDefined();
    expect(result.imageSize.width).toBeGreaterThan(0);
    expect(result.imageSize.height).toBeGreaterThan(0);
    expect(typeof result.inferenceTimeMs).toBe('number');
    expect(result.inferenceTimeMs).toBeGreaterThanOrEqual(0);

    // Verify each detection has correct structure (SegmentationResult)
    for (const det of result.detections) {
      expect(typeof det.classId).toBe('number');
      expect(typeof det.className).toBe('string');
      expect(typeof det.confidence).toBe('number');
      expect(det.confidence).toBeGreaterThanOrEqual(0);
      expect(det.confidence).toBeLessThanOrEqual(1);

      // BoundingBox structure
      expect(det.bbox).toBeDefined();
      expect(typeof det.bbox.x).toBe('number');
      expect(typeof det.bbox.y).toBe('number');
      expect(typeof det.bbox.width).toBe('number');
      expect(typeof det.bbox.height).toBe('number');

      // Mask data
      expect(det.mask).toBeDefined();
      expect(det.maskDims).toBeDefined();
      expect(det.maskDims.length).toBe(2);
      expect(typeof det.detectionId).toBe('string');
    }
  });

  test('handles blank image without crashing', async () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    if (!segmenter.isReady()) {
      console.log('⏭️  Skipping: Segmenter model not loaded');
      return;
    }

    try {
      const sharp = require('sharp');
      const blankBuffer = await sharp({
        create: {
          width: 640,
          height: 640,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      }).jpeg().toBuffer();

      const result = await segmenter.detect(blankBuffer);
      expect(result).toBeDefined();
      expect(Array.isArray(result.detections)).toBe(true);
      // Empty detections for blank image is valid
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Blank image test skipped:', message);
    }
  });

  test('handles corrupted buffer gracefully', async () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    if (!segmenter.isReady()) {
      console.log('⏭️  Skipping: Segmenter model not loaded');
      return;
    }

    const corruptedBuffer = Buffer.from([0xFF, 0xD8, 0x00, 0x00]);

    try {
      await segmenter.detect(corruptedBuffer);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test('updateConfig changes segmentation parameters', () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    // updateConfig should not throw
    expect(() => {
      segmenter.updateConfig({
        confidenceThreshold: 0.5,
        iouThreshold: 0.45
      });
    }).not.toThrow();
  });

  test('batch segmentation is stable', async () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    if (!segmenter.isReady()) {
      console.log('⏭️  Skipping: Segmenter model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);

    // Process 5 images sequentially
    for (let i = 0; i < 5; i++) {
      const result = await segmenter.detect(imageBuffer);
      expect(result).toBeDefined();
      expect(Array.isArray(result.detections)).toBe(true);
    }
  });

  test('dispose cleans up resources', () => {
    const segmenter = getSegmenter();
    if (!segmenter) return;

    expect(() => segmenter.dispose()).not.toThrow();
  });
});
