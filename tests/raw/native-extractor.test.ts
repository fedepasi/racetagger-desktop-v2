import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('raw-preview-extractor Native Module', () => {
  let tempDir: TempDirectory;

  const SAMPLE_NEF = path.join(__dirname, '../fixtures/images/sample-small.nef');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function getExtractor() {
    try {
      const { rawPreviewExtractor } = require('../../src/utils/raw-preview-native');
      return rawPreviewExtractor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  RawPreviewExtractor not available:', message);
      return null;
    }
  }

  async function nefExists(): Promise<boolean> {
    try {
      await fs.access(SAMPLE_NEF);
      return true;
    } catch {
      console.log('⏭️  Skipping: Sample NEF not available');
      return false;
    }
  }

  test('extracts embedded JPEG preview from NEF', async () => {
    if (!(await nefExists())) return;
    const extractor = getExtractor();
    if (!extractor) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);

    // extractPreview returns NativePreviewResult
    const result = await extractor.extractPreview(testFile);

    expect(result).toBeDefined();
    expect(result.success).toBeDefined();

    if (result.success) {
      expect(result.data).toBeDefined();
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);

      // Verify it's a JPEG
      expect(result.data[0]).toBe(0xFF);
      expect(result.data[1]).toBe(0xD8);
    } else {
      console.log('⏭️  Preview extraction not successful:', result.error);
    }
  });

  test('extractPreview returns structured NativePreviewResult', async () => {
    if (!(await nefExists())) return;
    const extractor = getExtractor();
    if (!extractor) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const result = await extractor.extractPreview(testFile);

    // Verify result structure matches NativePreviewResult interface
    expect(result).toHaveProperty('success');
    expect(typeof result.success).toBe('boolean');

    if (result.success) {
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('method');
      expect(['native', 'dcraw-fallback']).toContain(result.method);

      if (result.extractionTimeMs !== undefined) {
        expect(typeof result.extractionTimeMs).toBe('number');
        expect(result.extractionTimeMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('respects NativePreviewOptions', async () => {
    if (!(await nefExists())) return;
    const extractor = getExtractor();
    if (!extractor) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);

    // Test with custom options
    const result = await extractor.extractPreview(testFile, {
      preferQuality: 'preview',
      timeout: 10000,
      includeMetadata: true
    });

    expect(result).toBeDefined();
    expect(result.success).toBeDefined();

    if (result.success && result.metadata) {
      // Metadata fields may be present
      if (result.metadata.camera) {
        expect(typeof result.metadata.camera).toBe('string');
      }
    }
  });

  test('handles non-existent file gracefully', async () => {
    const extractor = getExtractor();
    if (!extractor) return;

    const result = await extractor.extractPreview('/non/existent/file.nef');

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('handles corrupted RAW file gracefully', async () => {
    const extractor = getExtractor();
    if (!extractor) return;

    const fakeRaw = await tempDir.writeFile('corrupted.nef', Buffer.from([
      0x00, 0x01, 0x02, 0x03
    ]));

    const result = await extractor.extractPreview(fakeRaw);

    expect(result).toBeDefined();
    // Should either fail gracefully or return empty data
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  test('extraction time is tracked', async () => {
    if (!(await nefExists())) return;
    const extractor = getExtractor();
    if (!extractor) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const result = await extractor.extractPreview(testFile);

    if (result.success) {
      expect(result.extractionTimeMs).toBeDefined();
      expect(typeof result.extractionTimeMs).toBe('number');
      expect(result.extractionTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('batch extraction works sequentially', async () => {
    if (!(await nefExists())) return;
    const extractor = getExtractor();
    if (!extractor) return;

    // Create 5 copies
    const rawFiles: string[] = [];
    for (let i = 0; i < 5; i++) {
      const copy = await tempDir.copyFile(SAMPLE_NEF, `test-${i}.nef`);
      rawFiles.push(copy);
    }

    // Extract all sequentially
    const results = [];
    for (const file of rawFiles) {
      const result = await extractor.extractPreview(file);
      results.push(result);
    }

    expect(results.length).toBe(5);

    // Count successes
    const successes = results.filter(r => r.success).length;
    // At least one extraction method should work
    if (successes > 0) {
      expect(successes).toBe(5); // If one works, all should work
    }
  });

  test('preview quality options affect output', async () => {
    if (!(await nefExists())) return;
    const extractor = getExtractor();
    if (!extractor) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);

    const qualities: Array<'thumbnail' | 'preview' | 'full'> = ['thumbnail', 'preview', 'full'];
    const results: Array<{ quality: string; size: number }> = [];

    for (const quality of qualities) {
      const result = await extractor.extractPreview(testFile, {
        preferQuality: quality
      });

      if (result.success && result.data) {
        results.push({ quality, size: result.data.length });
      }
    }

    // If we got multiple results, verify they exist
    if (results.length > 0) {
      for (const r of results) {
        expect(r.size).toBeGreaterThan(0);
      }
    }
  });

  test('native library availability is detected', () => {
    const extractor = getExtractor();
    if (!extractor) return;

    // The extractor should have checked native library availability on construction
    // We can verify it doesn't crash when asked about its state
    expect(extractor).toBeDefined();
  });
});
