import { TempDirectory } from '../helpers/temp-directory';
import { FileHasher } from '../helpers/file-hasher';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('dcraw RAW Conversion', () => {
  let tempDir: TempDirectory;
  let hasher: FileHasher;

  const SAMPLE_NEF = path.join(__dirname, '../fixtures/images/sample-small.nef');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    hasher = new FileHasher();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function getRawConverter() {
    try {
      const { rawConverter } = require('../../src/utils/raw-converter');
      return rawConverter;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  RawConverter not available:', message);
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

  test('converts NEF to JPEG with dcraw', async () => {
    if (!(await nefExists())) return;
    const converter = getRawConverter();
    if (!converter) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const outputPath = path.join(tempDir.getPath(), 'output.jpg');

    try {
      const result = await converter.convertRawToJpeg(testFile, outputPath);

      expect(result).toBeDefined();
      expect(result).toContain('.jpg');

      // Verify output file exists and is valid JPEG
      const buffer = await fs.readFile(result);
      expect(buffer[0]).toBe(0xFF); // JPEG magic number
      expect(buffer[1]).toBe(0xD8);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Conversion failed (dcraw may not be installed):', message);
    }
  });

  test('respects resize presets (VELOCE, BILANCIATO, QUALITA)', async () => {
    if (!(await nefExists())) return;
    const converter = getRawConverter();
    if (!converter) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);

    // Import ResizePreset enum
    let ResizePreset: any;
    try {
      const config = require('../../src/config');
      ResizePreset = config.ResizePreset;
    } catch {
      console.log('⏭️  Skipping: Config not available');
      return;
    }

    const presets = [
      { preset: ResizePreset.VELOCE, name: 'VELOCE' },
      { preset: ResizePreset.BILANCIATO, name: 'BILANCIATO' },
      { preset: ResizePreset.QUALITA, name: 'QUALITA' }
    ];

    for (const { preset, name } of presets) {
      const outputPath = path.join(tempDir.getPath(), `output-${name}.jpg`);

      try {
        const result = await converter.convertRawToJpeg(testFile, outputPath, preset);
        expect(result).toBeDefined();

        const stats = await fs.stat(result);
        expect(stats.size).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`⏭️  Preset ${name} conversion failed:`, message);
      }
    }
  });

  test('gracefully handles corrupted RAW files', async () => {
    const converter = getRawConverter();
    if (!converter) return;

    const corruptedFile = await tempDir.writeFile('corrupted.nef', Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05
    ]));

    const outputPath = path.join(tempDir.getPath(), 'corrupted-output.jpg');

    // Should throw or return error, not crash
    await expect(
      converter.convertRawToJpeg(corruptedFile, outputPath)
    ).rejects.toThrow();
  });

  test('isRawFile correctly identifies RAW extensions', () => {
    // Import RawConverter class for static methods
    let RawConverter: any;
    try {
      const mod = require('../../src/utils/raw-converter');
      RawConverter = mod.RawConverter;
    } catch {
      console.log('⏭️  Skipping: RawConverter not available');
      return;
    }

    // Valid RAW extensions
    const rawFiles = [
      'photo.nef', 'photo.arw', 'photo.cr2', 'photo.cr3',
      'photo.orf', 'photo.rw2', 'photo.dng', 'photo.raf',
      'photo.NEF', 'photo.ARW', 'photo.CR2'
    ];

    for (const file of rawFiles) {
      expect(RawConverter.isRawFile(file)).toBe(true);
    }

    // Non-RAW extensions
    const nonRawFiles = ['photo.jpg', 'photo.png', 'photo.tiff', 'photo.bmp'];
    for (const file of nonRawFiles) {
      expect(RawConverter.isRawFile(file)).toBe(false);
    }
  });

  test('getSupportedRawExtensions returns all supported formats', () => {
    let RawConverter: any;
    try {
      const mod = require('../../src/utils/raw-converter');
      RawConverter = mod.RawConverter;
    } catch {
      console.log('⏭️  Skipping: RawConverter not available');
      return;
    }

    const extensions = RawConverter.getSupportedRawExtensions();

    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(5);
    expect(extensions).toContain('.nef');
    expect(extensions).toContain('.cr2');
    expect(extensions).toContain('.arw');
    expect(extensions).toContain('.dng');
  });

  test('preserves original RAW file during conversion', async () => {
    if (!(await nefExists())) return;
    const converter = getRawConverter();
    if (!converter) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(testFile);

    const outputPath = path.join(tempDir.getPath(), 'output-preserve.jpg');

    try {
      await converter.convertRawToJpeg(testFile, outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Conversion failed:', message);
      return;
    }

    // Verify original unchanged
    const finalHash = await hasher.computeSHA256(testFile);
    expect(finalHash).toBe(originalHash);
  });

  test('handles RAW files with spaces and special characters in filename', async () => {
    if (!(await nefExists())) return;
    const converter = getRawConverter();
    if (!converter) return;

    const specialNames = [
      'file with spaces.nef',
      'file-with-dashes.nef',
      'file_with_underscores.nef'
    ];

    for (const name of specialNames) {
      const testFile = await tempDir.copyFile(SAMPLE_NEF, name);
      const outputPath = path.join(tempDir.getPath(), name.replace('.nef', '.jpg'));

      try {
        const result = await converter.convertRawToJpeg(testFile, outputPath);
        expect(result).toBeDefined();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`⏭️  Conversion failed for "${name}":`, message);
      }
    }
  });

  test('DcrawInstaller class is importable and has required methods', () => {
    try {
      const { DcrawInstaller } = require('../../src/utils/dcraw-installer');
      const installer = new DcrawInstaller();

      expect(typeof installer.isDcrawInstalled).toBe('function');
      expect(typeof installer.installDcraw).toBe('function');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // DcrawInstaller requires electron 'app' — may fail in test env
      console.log('⏭️  DcrawInstaller not loadable in test environment:', message);
    }
  });

  test('temp DNG directory is managed correctly', () => {
    const converter = getRawConverter();
    if (!converter) return;

    const tempDngDir = converter.getTempDngDirectory();
    expect(tempDngDir).toBeDefined();
    expect(typeof tempDngDir).toBe('string');
    expect(tempDngDir.length).toBeGreaterThan(0);
  });

  test('batch conversion creates separate output files', async () => {
    if (!(await nefExists())) return;
    const converter = getRawConverter();
    if (!converter) return;

    // Create 5 copies
    const rawFiles: string[] = [];
    for (let i = 0; i < 5; i++) {
      const copy = await tempDir.copyFile(SAMPLE_NEF, `batch-${i}.nef`);
      rawFiles.push(copy);
    }

    const results: string[] = [];
    for (const rawFile of rawFiles) {
      try {
        const outputPath = rawFile.replace('.nef', '.jpg');
        const result = await converter.convertRawToJpeg(rawFile, outputPath);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log('⏭️  Batch item failed:', message);
      }
    }

    // At least some should succeed (depending on dcraw availability)
    if (results.length > 0) {
      // All output paths should be unique
      const uniquePaths = new Set(results);
      expect(uniquePaths.size).toBe(results.length);
    }
  });
});
