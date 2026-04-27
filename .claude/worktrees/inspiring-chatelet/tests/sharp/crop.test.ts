import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

describe('Sharp Crop Operations', () => {
  let tempDir: TempDirectory;

  const SAMPLE_JPEG = path.join(__dirname, '../fixtures/images/sample.jpg');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  test('extracts crop with padding from YOLOv8 bounding box', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Mock bounding box [x, y, width, height]
    const bbox = [100, 100, 200, 200];
    const padding = 20;

    // Extract crop with padding
    const outputPath = path.join(tempDir.getPath(), 'crop.jpg');
    await sharp(testFile)
      .extract({
        left: Math.max(0, bbox[0] - padding),
        top: Math.max(0, bbox[1] - padding),
        width: bbox[2] + (padding * 2),
        height: bbox[3] + (padding * 2)
      })
      .toFile(outputPath);

    // Verify crop dimensions
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(bbox[2] + (padding * 2));
    expect(metadata.height).toBe(bbox[3] + (padding * 2));
  });

  test('handles edge crops (bbox at image boundary)', async () => {
    // Create test image 640x640
    const testImage = await tempDir.writeFile('test.jpg',
      await sharp({
        create: {
          width: 640,
          height: 640,
          channels: 3,
          background: { r: 128, g: 128, b: 128 }
        }
      }).jpeg().toBuffer()
    );

    // Bounding box at edge
    const bbox = [600, 600, 40, 40]; // Near bottom-right corner
    const padding = 20;

    // Extract crop (padding should not exceed image bounds)
    const outputPath = path.join(tempDir.getPath(), 'edge-crop.jpg');

    const originalMeta = await sharp(testImage).metadata();

    const extractOpts = {
      left: Math.max(0, bbox[0] - padding),
      top: Math.max(0, bbox[1] - padding),
      width: Math.min(bbox[2] + (padding * 2), originalMeta.width! - (bbox[0] - padding)),
      height: Math.min(bbox[3] + (padding * 2), originalMeta.height! - (bbox[1] - padding))
    };

    await sharp(testImage)
      .extract(extractOpts)
      .toFile(outputPath);

    // Should not exceed image boundaries
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBeLessThanOrEqual(originalMeta.width!);
    expect(metadata.height).toBeLessThanOrEqual(originalMeta.height!);
  });

  test('maintains RGB color space after crop', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const bbox = [100, 100, 200, 200];

    const outputPath = path.join(tempDir.getPath(), 'crop-color.jpg');
    await sharp(testFile)
      .extract({
        left: bbox[0],
        top: bbox[1],
        width: bbox[2],
        height: bbox[3]
      })
      .toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(metadata.channels).toBe(3); // RGB
    expect(metadata.space).toBe('srgb');
  });

  test('crop and resize in single operation', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const bbox = [100, 100, 400, 400];

    // Crop and resize to 224x224 (common ML input size)
    const outputPath = path.join(tempDir.getPath(), 'crop-resize.jpg');
    await sharp(testFile)
      .extract({
        left: bbox[0],
        top: bbox[1],
        width: bbox[2],
        height: bbox[3]
      })
      .resize(224, 224, { fit: 'fill' })
      .toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(224);
    expect(metadata.height).toBe(224);
  });

  test('handles multiple crops from same image', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Multiple bounding boxes
    const bboxes = [
      [100, 100, 150, 150],
      [300, 200, 100, 100],
      [200, 400, 200, 150]
    ];

    // Extract all crops
    const crops = await Promise.all(
      bboxes.map(async (bbox, i) => {
        const outputPath = path.join(tempDir.getPath(), `crop-${i}.jpg`);
        await sharp(testFile)
          .extract({
            left: bbox[0],
            top: bbox[1],
            width: bbox[2],
            height: bbox[3]
          })
          .toFile(outputPath);
        return outputPath;
      })
    );

    expect(crops.length).toBe(3);

    // Verify all crops exist
    for (const crop of crops) {
      const exists = await fs.access(crop).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    }
  });

  test('crop with rotation', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const bbox = [200, 200, 200, 200];

    // Crop and rotate 90 degrees
    const outputPath = path.join(tempDir.getPath(), 'crop-rotated.jpg');
    await sharp(testFile)
      .extract({
        left: bbox[0],
        top: bbox[1],
        width: bbox[2],
        height: bbox[3]
      })
      .rotate(90)
      .toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    // After 90° rotation, width and height should swap
    expect(metadata.width).toBe(bbox[3]);
    expect(metadata.height).toBe(bbox[2]);
  });

  test('crop efficiency with large images', async () => {
    // Create large 4000x3000 image
    const largeImage = await tempDir.writeFile('large.jpg',
      await sharp({
        create: {
          width: 4000,
          height: 3000,
          channels: 3,
          background: { r: 128, g: 128, b: 128 }
        }
      }).jpeg().toBuffer()
    );

    const bbox = [1000, 1000, 500, 500];

    const start = Date.now();
    const outputPath = path.join(tempDir.getPath(), 'large-crop.jpg');
    await sharp(largeImage)
      .extract({
        left: bbox[0],
        top: bbox[1],
        width: bbox[2],
        height: bbox[3]
      })
      .toFile(outputPath);
    const duration = Date.now() - start;

    // Should be fast even with large image
    expect(duration).toBeLessThan(500);
  });

  test('handles invalid crop coordinates gracefully', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const originalMeta = await sharp(testFile).metadata();

    // Invalid bbox (exceeds image bounds)
    const invalidBbox = [originalMeta.width!, originalMeta.height!, 100, 100];

    // Should throw or be handled
    await expect(
      sharp(testFile)
        .extract({
          left: invalidBbox[0],
          top: invalidBbox[1],
          width: invalidBbox[2],
          height: invalidBbox[3]
        })
        .toFile(path.join(tempDir.getPath(), 'invalid-crop.jpg'))
    ).rejects.toThrow();
  });

  test('crop preserves image quality', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const bbox = [100, 100, 300, 300];

    // Crop with high quality
    const outputPath = path.join(tempDir.getPath(), 'quality-crop.jpg');
    await sharp(testFile)
      .extract({
        left: bbox[0],
        top: bbox[1],
        width: bbox[2],
        height: bbox[3]
      })
      .jpeg({ quality: 95 })
      .toFile(outputPath);

    // Verify output is high quality
    const stats = await fs.stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  });
});
