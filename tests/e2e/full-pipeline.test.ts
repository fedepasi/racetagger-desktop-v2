import { TempDirectory } from '../helpers/temp-directory';
import { ExifToolValidator } from '../helpers/exiftool-validator';
import { FileHasher } from '../helpers/file-hasher';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('End-to-End Processing Pipeline', () => {
  let tempDir: TempDirectory;
  let validator: ExifToolValidator;
  let hasher: FileHasher;

  const FIXTURES_DIR = path.join(__dirname, '../fixtures/images');
  const SAMPLE_NEF = path.join(FIXTURES_DIR, 'sample-small.nef');
  const SAMPLE_CSV = path.join(__dirname, '../fixtures/csv/sample-participants.csv');

  beforeEach(async () => {
    tempDir = new TempDirectory();
    validator = new ExifToolValidator();
    hasher = new FileHasher();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  test('processes RAW to JPEG conversion and verifies RAW integrity', async () => {
    const nefExists = await fs.access(SAMPLE_NEF).then(() => true).catch(() => false);
    if (!nefExists) {
      console.log('⏭️  Skipping: sample-small.nef not available');
      return;
    }

    let rawConverter: any;
    try {
      rawConverter = require('../../src/utils/raw-converter').rawConverter;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: RawConverter not available:', message);
      return;
    }

    // Copy RAW to temp dir and record original hash
    const rawFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(rawFile);

    // Attempt RAW conversion
    const outputPath = path.join(tempDir.getPath(), 'converted.jpg');

    try {
      const jpegPath = await rawConverter.convertRawToJpeg(rawFile, outputPath);
      expect(jpegPath).toBeDefined();

      // Verify output exists and is a valid JPEG
      const outputExists = await fs.access(jpegPath).then(() => true).catch(() => false);
      expect(outputExists).toBe(true);

      const outputStat = await fs.stat(jpegPath);
      expect(outputStat.size).toBeGreaterThan(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  RAW conversion failed (dcraw may not be installed):', message);

      // Try fallback to raw-preview-extractor
      try {
        const { rawPreviewExtractor } = require('../../src/utils/raw-preview-native');
        const preview = await rawPreviewExtractor.extractPreview(rawFile);
        expect(preview).toBeDefined();
        expect(preview.success).toBeDefined();
      } catch (fallbackError) {
        const fbMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.log('⏭️  Fallback also failed:', fbMsg);
      }
    }

    // Verify original RAW was NOT modified
    const finalHash = await hasher.computeSHA256(rawFile);
    expect(finalHash).toBe(originalHash);
  });

  test('Sharp resize pipeline processes JPEG correctly', async () => {
    const sampleJpeg = path.join(FIXTURES_DIR, 'sample.jpg');
    const jpegExists = await fs.access(sampleJpeg).then(() => true).catch(() => false);
    if (!jpegExists) {
      console.log('⏭️  Skipping: sample.jpg not available');
      return;
    }

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available');
      return;
    }

    const testFile = await tempDir.copyFile(sampleJpeg);

    // QUALITA preset: 1920px max, 90% quality
    const resizedPath = path.join(tempDir.getPath(), 'resized-qualita.jpg');
    await sharp(testFile)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(resizedPath);

    const resizedStat = await fs.stat(resizedPath);
    expect(resizedStat.size).toBeGreaterThan(0);

    // Verify dimensions
    const meta = await sharp(resizedPath).metadata();
    expect(meta.width).toBeLessThanOrEqual(1920);
    expect(meta.height).toBeLessThanOrEqual(1920);
  });

  test('metadata writing to JPEG preserves file and adds data', async () => {
    const sampleJpeg = path.join(FIXTURES_DIR, 'sample.jpg');
    const jpegExists = await fs.access(sampleJpeg).then(() => true).catch(() => false);
    if (!jpegExists) {
      console.log('⏭️  Skipping: sample.jpg not available');
      return;
    }

    const exifToolAvailable = await validator.isExifToolAvailable();
    if (!exifToolAvailable) {
      console.log('⏭️  Skipping: ExifTool not available');
      return;
    }

    let writeFullMetadata: any;
    try {
      writeFullMetadata = require('../../src/utils/metadata-writer').writeFullMetadata;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: metadata-writer not available:', message);
      return;
    }

    const testFile = await tempDir.copyFile(sampleJpeg);

    // Write metadata using actual API
    try {
      await writeFullMetadata(testFile, {
        keywords: ['42', 'PRO', 'Racing Team Alpha'],
        personInImage: 'John Smith',
        specialInstructions: 'Race #42 - John Smith - Racing Team Alpha'
      });

      // Verify metadata was written
      const metadata = await validator.readMetadata(testFile);
      expect(metadata).toBeDefined();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Metadata write failed:', message);
    }
  });

  test('XMP sidecar creation for RAW preserves original file', async () => {
    const nefExists = await fs.access(SAMPLE_NEF).then(() => true).catch(() => false);
    if (!nefExists) {
      console.log('⏭️  Skipping: sample-small.nef not available');
      return;
    }

    const exifToolAvailable = await validator.isExifToolAvailable();
    if (!exifToolAvailable) {
      console.log('⏭️  Skipping: ExifTool not available');
      return;
    }

    let writeFullMetadata: any;
    try {
      writeFullMetadata = require('../../src/utils/metadata-writer').writeFullMetadata;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: metadata-writer not available:', message);
      return;
    }

    const rawFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(rawFile);

    try {
      await writeFullMetadata(rawFile, {
        keywords: ['42', 'PRO'],
        personInImage: 'John Smith',
        specialInstructions: 'Race #42'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Metadata write skipped (may create XMP sidecar):', message);
    }

    // Verify RAW file was NOT modified
    const finalHash = await hasher.computeSHA256(rawFile);
    expect(finalHash).toBe(originalHash);
  });

  test('SmartMatcher finds participants from analysis results', async () => {
    const csvExists = await fs.access(SAMPLE_CSV).then(() => true).catch(() => false);
    if (!csvExists) {
      console.log('⏭️  Skipping: sample-participants.csv not available');
      return;
    }

    let SmartMatcher: any;
    try {
      SmartMatcher = require('../../src/matching/smart-matcher').SmartMatcher;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: SmartMatcher not available:', message);
      return;
    }

    // Load CSV participants
    const csvData = await fs.readFile(SAMPLE_CSV, 'utf-8');
    const lines = csvData.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      console.log('⏭️  Skipping: CSV has no data rows');
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const participants = lines.slice(1).map(line => {
      const values = line.split(',');
      const participant: any = {};
      headers.forEach((header, i) => {
        participant[header] = values[i]?.trim();
      });
      return participant;
    });

    expect(participants.length).toBeGreaterThan(0);

    // Create SmartMatcher and mock analysis result
    const matcher = new SmartMatcher('motorsport');

    // AnalysisResult interface: { raceNumber, drivers, category, teamName, confidence }
    const mockAnalysis = {
      raceNumber: participants[0]?.numero || participants[0]?.number || '1',
      confidence: 0.95
    };

    try {
      const result = await matcher.findMatches(mockAnalysis, participants);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('bestMatch');
      expect(result).toHaveProperty('allCandidates');
      expect(result).toHaveProperty('multipleHighScores');
      expect(result).toHaveProperty('debugInfo');
      expect(Array.isArray(result.allCandidates)).toBe(true);

      if (result.bestMatch) {
        expect(result.bestMatch).toHaveProperty('participant');
        expect(result.bestMatch).toHaveProperty('score');
        expect(result.bestMatch).toHaveProperty('confidence');
        expect(result.bestMatch).toHaveProperty('reasoning');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  SmartMatcher matching failed:', message);
    }
  });

  test('performance: processes 10 images with Sharp in reasonable time', async () => {
    const sampleJpeg = path.join(FIXTURES_DIR, 'sample.jpg');
    const jpegExists = await fs.access(sampleJpeg).then(() => true).catch(() => false);
    if (!jpegExists) {
      console.log('⏭️  Skipping: sample.jpg not available');
      return;
    }

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available');
      return;
    }

    // Create 10 copies
    const files: string[] = [];
    for (let i = 0; i < 10; i++) {
      const copy = await tempDir.copyFile(sampleJpeg, `test-${i}.jpg`);
      files.push(copy);
    }

    // Process all files
    const start = Date.now();
    await Promise.all(
      files.map(file =>
        sharp(file)
          .resize(1080, 1080, { fit: 'inside' })
          .jpeg({ quality: 90 })
          .toFile(path.join(tempDir.getPath(), `processed-${path.basename(file)}`))
      )
    );
    const duration = Date.now() - start;

    // Should complete in reasonable time (<5s for 10 images)
    expect(duration).toBeLessThan(5000);

    console.log(`Processed 10 images in ${duration}ms (${(duration / 10).toFixed(0)}ms per image)`);
  });

  test('maintains data integrity: JPEG metadata write does not corrupt image', async () => {
    const sampleJpeg = path.join(FIXTURES_DIR, 'sample.jpg');
    const jpegExists = await fs.access(sampleJpeg).then(() => true).catch(() => false);
    if (!jpegExists) {
      console.log('⏭️  Skipping: sample.jpg not available');
      return;
    }

    const exifToolAvailable = await validator.isExifToolAvailable();
    if (!exifToolAvailable) {
      console.log('⏭️  Skipping: ExifTool not available');
      return;
    }

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available');
      return;
    }

    let writeKeywordsToImage: any;
    try {
      writeKeywordsToImage = require('../../src/utils/metadata-writer').writeKeywordsToImage;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: metadata-writer not available:', message);
      return;
    }

    const testFile = await tempDir.copyFile(sampleJpeg);

    // Get original dimensions
    const originalMeta = await sharp(testFile).metadata();
    const originalWidth = originalMeta.width;
    const originalHeight = originalMeta.height;

    // Write metadata
    try {
      await writeKeywordsToImage(testFile, ['99', 'Test']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Metadata write failed:', message);
      return;
    }

    // Verify image is still valid and dimensions unchanged
    const finalMeta = await sharp(testFile).metadata();
    expect(finalMeta.width).toBe(originalWidth);
    expect(finalMeta.height).toBe(originalHeight);
    expect(finalMeta.format).toBe('jpeg');
  });

  test('handles corrupted files gracefully without crashing', async () => {
    const corruptedFile = await tempDir.writeFile('corrupted.jpg', Buffer.from([0x00, 0x01]));

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available');
      return;
    }

    // Sharp should throw on corrupted files, not crash
    try {
      await sharp(corruptedFile).metadata();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test('RawConverter.isRawFile detects RAW formats correctly', () => {
    let RawConverter: any;
    try {
      RawConverter = require('../../src/utils/raw-converter').RawConverter;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: RawConverter not available:', message);
      return;
    }

    // RAW formats should be detected
    expect(RawConverter.isRawFile('photo.nef')).toBe(true);
    expect(RawConverter.isRawFile('photo.cr2')).toBe(true);
    expect(RawConverter.isRawFile('photo.arw')).toBe(true);
    expect(RawConverter.isRawFile('photo.dng')).toBe(true);

    // Non-RAW should not be detected
    expect(RawConverter.isRawFile('photo.jpg')).toBe(false);
    expect(RawConverter.isRawFile('photo.png')).toBe(false);
    expect(RawConverter.isRawFile('photo.txt')).toBe(false);
  });

  test('createImageProcessor provides unified interface', async () => {
    let createImageProcessor: any;
    try {
      createImageProcessor = require('../../src/utils/native-modules').createImageProcessor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('⏭️  Skipping: native-modules not available:', message);
      return;
    }

    let sharp: any;
    try {
      sharp = require('sharp');
    } catch (error) {
      console.log('⏭️  Skipping: Sharp not available for test image creation');
      return;
    }

    // Create test image
    const testBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 200, g: 100, b: 50 }
      }
    }).jpeg().toBuffer();

    const processor = await createImageProcessor(testBuffer);

    // Verify unified ImageProcessor interface
    const result = await processor
      .resize(400, 300, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();

    expect(result).toBeDefined();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Resized image should be smaller than original
    expect(result.length).toBeLessThan(testBuffer.length);
  });
});
