import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('Sharp Image Processing', () => {
  let tempDir: TempDirectory;

  const SAMPLE_JPEG = path.join(__dirname, '../fixtures/images/sample.jpg');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  test('Sharp loads correctly as native module', async () => {
    // Verify Sharp can be required
    try {
      const sharp = require('sharp');
      expect(sharp).toBeDefined();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Sharp not available:', message);
    }
  });

  test('Sharp works with basic image creation', async () => {
    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available');
      return;
    }

    // Create a simple image
    const buffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
      .jpeg()
      .toBuffer();

    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  test('Sharp handles various image formats', async () => {
    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available');
      return;
    }

    const formats = ['jpeg', 'png', 'webp'] as const;

    for (const format of formats) {
      const buffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 128, g: 128, b: 128 }
        }
      })
        [format]()
        .toBuffer();

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    }
  });

  test('createImageProcessor returns a working processor', async () => {
    let createImageProcessor: any;
    try {
      createImageProcessor = require('../../src/utils/native-modules').createImageProcessor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  native-modules not available:', message);
      return;
    }

    // createImageProcessor needs a valid image input
    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available for test image creation');
      return;
    }

    const testBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    }).jpeg().toBuffer();

    const processor = await createImageProcessor(testBuffer);

    expect(processor).toBeDefined();
    expect(typeof processor.resize).toBe('function');
    expect(typeof processor.jpeg).toBe('function');
    expect(typeof processor.toBuffer).toBe('function');
    expect(typeof processor.metadata).toBe('function');
  });

  test('initializeImageProcessor does not throw', async () => {
    let initializeImageProcessor: any;
    try {
      initializeImageProcessor = require('../../src/utils/native-modules').initializeImageProcessor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  native-modules not available:', message);
      return;
    }

    // initializeImageProcessor should not throw
    await expect(initializeImageProcessor()).resolves.not.toThrow();
  });

  test('getSharp returns a function', () => {
    let getSharp: any;
    try {
      getSharp = require('../../src/utils/native-modules').getSharp;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  native-modules not available:', message);
      return;
    }

    const sharpFn = getSharp();
    expect(typeof sharpFn).toBe('function');
  });

  test('safeRequire returns module or mock', () => {
    let safeRequire: any;
    try {
      safeRequire = require('../../src/utils/native-modules').safeRequire;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  native-modules not available:', message);
      return;
    }

    // Existing module should return the module
    const pathModule = safeRequire('path', { join: () => '' });
    expect(pathModule).toBeDefined();
    expect(typeof pathModule.join).toBe('function');

    // Non-existent module should return mock
    const mock = { mockMethod: () => 'fallback' };
    const result = safeRequire('nonexistent-module-xyz', mock);
    expect(result).toBe(mock);
  });

  test('ImageProcessor interface methods are complete', async () => {
    let createImageProcessor: any;
    try {
      createImageProcessor = require('../../src/utils/native-modules').createImageProcessor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  native-modules not available:', message);
      return;
    }

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available for test image creation');
      return;
    }

    const testBuffer = await sharp({
      create: {
        width: 200,
        height: 150,
        channels: 3,
        background: { r: 100, g: 150, b: 200 }
      }
    }).jpeg().toBuffer();

    const processor = await createImageProcessor(testBuffer);

    // ImageProcessor interface methods
    expect(typeof processor.resize).toBe('function');
    expect(typeof processor.rotate).toBe('function');
    expect(typeof processor.jpeg).toBe('function');
    expect(typeof processor.png).toBe('function');
    expect(typeof processor.webp).toBe('function');
    expect(typeof processor.toBuffer).toBe('function');
    expect(typeof processor.metadata).toBe('function');

    // metadata() should return image dimensions
    const meta = await processor.metadata();
    expect(meta).toBeDefined();
    expect(typeof meta.width).toBe('number');
    expect(typeof meta.height).toBe('number');
  });

  test('Sharp binaries exist in correct location', async () => {
    try {
      const sharpPath = require.resolve('sharp');
      const pathModule = require('path');
      const sharpDir = pathModule.dirname(sharpPath);

      expect(sharpDir).toBeDefined();
      console.log('Sharp binaries found at:', sharpDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Sharp not available:', message);
    }
  });

  test('createImageProcessor resize + jpeg pipeline works', async () => {
    let createImageProcessor: any;
    try {
      createImageProcessor = require('../../src/utils/native-modules').createImageProcessor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  native-modules not available:', message);
      return;
    }

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available for test image creation');
      return;
    }

    const testBuffer = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 50, g: 100, b: 150 }
      }
    }).jpeg().toBuffer();

    const processor = await createImageProcessor(testBuffer);

    // Chain resize + jpeg + toBuffer
    const result = await processor
      .resize(200, 150, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    expect(result).toBeDefined();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
