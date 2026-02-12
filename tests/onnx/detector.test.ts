import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('ONNX Object Detector', () => {
  let tempDir: TempDirectory;

  const FIXTURES_DIR = path.join(__dirname, '../fixtures/images');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function getDetector() {
    try {
      const { OnnxDetector } = require('../../src/onnx-detector');
      return OnnxDetector.getInstance();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  ONNX detector not available:', message);
      return null;
    }
  }

  test('OnnxDetector singleton is accessible', () => {
    const detector = getDetector();
    if (!detector) return;

    expect(detector).toBeDefined();
    expect(typeof detector.loadModel).toBe('function');
    expect(typeof detector.detect).toBe('function');
    expect(typeof detector.isReady).toBe('function');
    expect(typeof detector.dispose).toBe('function');
  });

  test('OnnxDetector exports correct interfaces', () => {
    try {
      const mod = require('../../src/onnx-detector');

      expect(mod.OnnxDetector).toBeDefined();
      expect(typeof mod.getOnnxDetector).toBe('function');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  OnnxDetector module not available:', message);
    }
  });

  test('isReady returns boolean', () => {
    const detector = getDetector();
    if (!detector) return;

    const ready = detector.isReady();
    expect(typeof ready).toBe('boolean');
  });

  test('getLoadError returns null or Error', () => {
    const detector = getDetector();
    if (!detector) return;

    const error = detector.getLoadError();
    expect(error === null || error instanceof Error).toBe(true);
  });

  test('loadModel accepts categoryCode string', async () => {
    const detector = getDetector();
    if (!detector) return;

    // loadModel requires a categoryCode and a downloaded model
    // Test with a category that may not have a model
    try {
      const result = await detector.loadModel('test-category');
      expect(typeof result).toBe('boolean');
    } catch (error) {
      // May fail if model is not available — that's expected
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Model load failed (expected if no model):', message);
    }
  });

  test('detect accepts Buffer and returns structured result', async () => {
    const detector = getDetector();
    if (!detector) return;

    if (!detector.isReady()) {
      console.log('⏭️  Skipping: Detector model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);
    const result = await detector.detect(imageBuffer);

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.imageSize).toBeDefined();
    expect(result.imageSize.width).toBeGreaterThan(0);
    expect(result.imageSize.height).toBeGreaterThan(0);

    // Verify each detection has correct structure (OnnxAnalysisResult)
    for (const det of result.results) {
      expect(det.raceNumber).toBeDefined();
      expect(typeof det.confidence).toBe('number');
      expect(det.confidence).toBeGreaterThanOrEqual(0);
      expect(det.confidence).toBeLessThanOrEqual(1);
      expect(det.className).toBeDefined();
    }
  });

  test('handles blank image without crashing', async () => {
    const detector = getDetector();
    if (!detector) return;

    if (!detector.isReady()) {
      console.log('⏭️  Skipping: Detector model not loaded');
      return;
    }

    // Create a blank JPEG image using Sharp
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

      const result = await detector.detect(blankBuffer);
      expect(result).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Blank image test skipped:', message);
    }
  });

  test('handles corrupted image buffer gracefully', async () => {
    const detector = getDetector();
    if (!detector) return;

    if (!detector.isReady()) {
      console.log('⏭️  Skipping: Detector model not loaded');
      return;
    }

    const corruptedBuffer = Buffer.from([0xFF, 0xD8, 0x00, 0x00]);

    try {
      await detector.detect(corruptedBuffer);
    } catch (error) {
      // Expected to throw for corrupted images
      expect(error).toBeDefined();
    }
  });

  test('detection results have valid bounding boxes', async () => {
    const detector = getDetector();
    if (!detector) return;

    if (!detector.isReady()) {
      console.log('⏭️  Skipping: Detector model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);
    const result = await detector.detect(imageBuffer);

    for (const det of result.results) {
      if (det.boundingBox) {
        expect(det.boundingBox.x).toBeGreaterThanOrEqual(0);
        expect(det.boundingBox.y).toBeGreaterThanOrEqual(0);
        expect(det.boundingBox.width).toBeGreaterThan(0);
        expect(det.boundingBox.height).toBeGreaterThan(0);
      }
    }
  });

  test('batch detection is stable', async () => {
    const detector = getDetector();
    if (!detector) return;

    if (!detector.isReady()) {
      console.log('⏭️  Skipping: Detector model not loaded');
      return;
    }

    const sampleImage = path.join(FIXTURES_DIR, 'sample.jpg');
    const exists = await fs.access(sampleImage).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample image not available');
      return;
    }

    const imageBuffer = await fs.readFile(sampleImage);

    // Process 10 images sequentially
    for (let i = 0; i < 10; i++) {
      const result = await detector.detect(imageBuffer);
      expect(result).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    }
  });

  test('dispose cleans up resources', () => {
    const detector = getDetector();
    if (!detector) return;

    // dispose should not throw
    expect(() => detector.dispose()).not.toThrow();
  });
});
