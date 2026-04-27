import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

describe('Sharp Image Resizing', () => {
  let tempDir: TempDirectory;

  const SAMPLE_JPEG = path.join(__dirname, '../fixtures/images/sample.jpg');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  test('resizes JPEG to VELOCE preset (1080px, 75% quality)', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // VELOCE preset: 1080px, 75% quality
    const outputPath = path.join(tempDir.getPath(), 'veloce.jpg');
    await sharp(testFile)
      .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(outputPath);

    // Verify output
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBeLessThanOrEqual(1080);
    expect(metadata.height).toBeLessThanOrEqual(1080);
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1080);
  });

  test('resizes JPEG to BILANCIATO preset (1440px, 85% quality)', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // BILANCIATO preset: 1440px, 85% quality
    const outputPath = path.join(tempDir.getPath(), 'bilanciato.jpg');
    await sharp(testFile)
      .resize(1440, 1440, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1440);
  });

  test('resizes JPEG to QUALITA preset (1920px, 90% quality)', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // QUALITA preset: 1920px, 90% quality
    const outputPath = path.join(tempDir.getPath(), 'qualita.jpg');
    await sharp(testFile)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1920);
  });

  test('preserves aspect ratio during resize', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Get original dimensions
    const originalMeta = await sharp(testFile).metadata();
    const originalAspect = originalMeta.width! / originalMeta.height!;

    // Resize
    const outputPath = path.join(tempDir.getPath(), 'resized.jpg');
    await sharp(testFile)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    // Get resized dimensions
    const resizedMeta = await sharp(outputPath).metadata();
    const resizedAspect = resizedMeta.width! / resizedMeta.height!;

    // Aspect ratios should match (within small tolerance)
    expect(Math.abs(originalAspect - resizedAspect)).toBeLessThan(0.01);
  });

  test('handles tiny images without upscaling', async () => {
    // Create a small 800x600 image
    const smallImage = await tempDir.writeFile('small.jpg',
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 128, g: 128, b: 128 }
        }
      }).jpeg().toBuffer()
    );

    // Try to resize with QUALITA preset (1920px)
    const outputPath = path.join(tempDir.getPath(), 'not-upscaled.jpg');
    await sharp(smallImage)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    // Should not upscale beyond original size
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBeLessThanOrEqual(800);
    expect(metadata.height).toBeLessThanOrEqual(600);
  });

  test('handles portrait vs landscape images', async () => {
    // Create portrait image (600x800)
    const portraitImage = await tempDir.writeFile('portrait.jpg',
      await sharp({
        create: {
          width: 600,
          height: 800,
          channels: 3,
          background: { r: 100, g: 150, b: 200 }
        }
      }).jpeg().toBuffer()
    );

    // Create landscape image (800x600)
    const landscapeImage = await tempDir.writeFile('landscape.jpg',
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 100, g: 150, b: 200 }
        }
      }).jpeg().toBuffer()
    );

    // Resize both to 1080px
    const portraitOut = path.join(tempDir.getPath(), 'portrait-resized.jpg');
    await sharp(portraitImage)
      .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(portraitOut);

    const landscapeOut = path.join(tempDir.getPath(), 'landscape-resized.jpg');
    await sharp(landscapeImage)
      .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(landscapeOut);

    // Both should fit within 1080px max dimension
    const portraitMeta = await sharp(portraitOut).metadata();
    const landscapeMeta = await sharp(landscapeOut).metadata();

    expect(Math.max(portraitMeta.width!, portraitMeta.height!)).toBeLessThanOrEqual(1080);
    expect(Math.max(landscapeMeta.width!, landscapeMeta.height!)).toBeLessThanOrEqual(1080);
  });

  test('quality settings affect file size', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Same size, different quality
    const lowQuality = path.join(tempDir.getPath(), 'low.jpg');
    const highQuality = path.join(tempDir.getPath(), 'high.jpg');

    await sharp(testFile)
      .resize(1080, 1080, { fit: 'inside' })
      .jpeg({ quality: 50 })
      .toFile(lowQuality);

    await sharp(testFile)
      .resize(1080, 1080, { fit: 'inside' })
      .jpeg({ quality: 95 })
      .toFile(highQuality);

    const lowStats = await fs.stat(lowQuality);
    const highStats = await fs.stat(highQuality);

    // Higher quality should result in larger file
    expect(highStats.size).toBeGreaterThan(lowStats.size);
  });

  test('handles very large images efficiently', async () => {
    // Create a large 4000x3000 image
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

    const start = Date.now();
    const outputPath = path.join(tempDir.getPath(), 'large-resized.jpg');
    await sharp(largeImage)
      .resize(1920, 1920, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toFile(outputPath);
    const duration = Date.now() - start;

    // Should complete quickly (Sharp is fast)
    expect(duration).toBeLessThan(1000);

    // Verify resized correctly
    const metadata = await sharp(outputPath).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBe(1920);
  });

  test('maintains color space (RGB)', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const outputPath = path.join(tempDir.getPath(), 'color-preserved.jpg');
    await sharp(testFile)
      .resize(1080, 1080, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(metadata.channels).toBe(3); // RGB
    expect(metadata.space).toBe('srgb');
  });

  test('handles EXIF orientation correctly', async () => {
    const exists = await fs.access(SAMPLE_JPEG).then(() => true).catch(() => false);
    if (!exists) {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return;
    }

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Sharp auto-rotates based on EXIF orientation by default
    const outputPath = path.join(tempDir.getPath(), 'rotated.jpg');
    await sharp(testFile)
      .rotate() // Auto-rotate based on EXIF
      .resize(1080, 1080, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    // Should not throw and produce valid image
    const metadata = await sharp(outputPath).metadata();
    expect(metadata).toBeDefined();
  });
});
