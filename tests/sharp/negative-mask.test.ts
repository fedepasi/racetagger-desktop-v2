/**
 * Regression tests for generateNegativeWithMask.
 *
 * Bug history:
 *   Sharp's .pipeline() internally reorders operations so that resize runs
 *   BEFORE composite. If the SVG mask was built at the ORIGINAL image
 *   dimensions and chained with `.composite(...).resize(maxDim, maxDim, ...)`,
 *   compositing failed with "Image to composite must have same dimensions or
 *   smaller" for any input larger than cfg.maxDimension (1440 by default).
 *
 * These tests exercise the >maxDimension path on both landscape and portrait
 * inputs, plus the zero-bbox and edge/full-frame bbox cases, to catch any
 * regression of the chain ordering or the SVG sizing.
 */
import sharp from 'sharp';
import { generateNegativeWithMask, DEFAULT_NEGATIVE_CONFIG } from '../../src/utils/crop-context-extractor';

// Helper: synthesize a JPEG of the given dimensions so tests don't depend on fixtures.
async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 180, b: 160 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('generateNegativeWithMask', () => {
  const MAX = DEFAULT_NEGATIVE_CONFIG.maxDimension; // 1440

  test('handles landscape image larger than maxDimension (regression: composite+resize ordering)', async () => {
    const input = await makeJpeg(1920, 1280);
    const bboxes = [{ x: 0.30, y: 0.30, width: 0.45, height: 0.40 }];

    const result = await generateNegativeWithMask(input, bboxes);

    // Final canvas must be capped to maxDimension on the long side
    expect(result.resolution.width).toBeLessThanOrEqual(MAX);
    expect(result.resolution.height).toBeLessThanOrEqual(MAX);
    expect(Math.max(result.resolution.width, result.resolution.height)).toBe(MAX);

    // Buffer must be a valid JPEG Sharp can re-read
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(result.resolution.width);
    expect(meta.height).toBe(result.resolution.height);

    // One bbox masked
    expect(result.maskedRegions).toHaveLength(1);
    expect(result.sizeBytes).toBe(result.buffer.length);
  });

  test('handles portrait image larger than maxDimension', async () => {
    const input = await makeJpeg(1280, 1920);
    const bboxes = [{ x: 0.10, y: 0.20, width: 0.60, height: 0.50 }];

    const result = await generateNegativeWithMask(input, bboxes);

    expect(Math.max(result.resolution.width, result.resolution.height)).toBe(MAX);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
  });

  test('handles multiple overlapping bboxes on a large image', async () => {
    const input = await makeJpeg(2400, 1600);
    const bboxes = [
      { x: 0.10, y: 0.30, width: 0.45, height: 0.40 },
      { x: 0.40, y: 0.30, width: 0.45, height: 0.40 },
      { x: 0.65, y: 0.30, width: 0.30, height: 0.40 },
    ];

    const result = await generateNegativeWithMask(input, bboxes);

    expect(result.maskedRegions).toHaveLength(3);
    expect(Math.max(result.resolution.width, result.resolution.height)).toBe(MAX);
  });

  test('handles full-frame bbox (0,0,1,1) on a large image', async () => {
    const input = await makeJpeg(2000, 1500);
    const bboxes = [{ x: 0, y: 0, width: 1, height: 1 }];

    const result = await generateNegativeWithMask(input, bboxes);

    expect(result.maskedRegions).toHaveLength(1);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
  });

  test('handles edge-touching bbox', async () => {
    const input = await makeJpeg(1920, 1280);
    const bboxes = [{ x: 0, y: 0.30, width: 0.50, height: 0.40 }];

    const result = await generateNegativeWithMask(input, bboxes);

    expect(result.maskedRegions).toHaveLength(1);
  });

  test('handles empty bbox list (returns resized original)', async () => {
    const input = await makeJpeg(1920, 1280);

    const result = await generateNegativeWithMask(input, []);

    expect(result.maskedRegions).toHaveLength(0);
    // In the empty-bboxes branch the resolution is reported from the PRE-resize
    // metadata; the buffer itself is the resized JPEG. Verify via the buffer.
    const meta = await sharp(result.buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX);
  });

  test('does not enlarge images already smaller than maxDimension', async () => {
    const input = await makeJpeg(800, 600);
    const bboxes = [{ x: 0.30, y: 0.30, width: 0.45, height: 0.40 }];

    const result = await generateNegativeWithMask(input, bboxes);

    expect(result.resolution.width).toBe(800);
    expect(result.resolution.height).toBe(600);
  });

  test('respects a custom maxDimension smaller than input', async () => {
    const input = await makeJpeg(1920, 1280);
    const bboxes = [{ x: 0.30, y: 0.30, width: 0.45, height: 0.40 }];

    const result = await generateNegativeWithMask(input, bboxes, { maxDimension: 800 });

    expect(Math.max(result.resolution.width, result.resolution.height)).toBe(800);
  });
});
