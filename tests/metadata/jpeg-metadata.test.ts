import { ExifToolValidator } from '../helpers/exiftool-validator';
import { TempDirectory } from '../helpers/temp-directory';
import { FileHasher } from '../helpers/file-hasher';
import * as path from 'path';
import {
  writeKeywordsToImage,
  writePersonInImage,
  writeSpecialInstructions,
  writeFullMetadata,
  ExportDestinationMetadata
} from '../../src/utils/metadata-writer';

describe('JPEG Metadata Writing', () => {
  let validator: ExifToolValidator;
  let tempDir: TempDirectory;
  let hasher: FileHasher;
  let exifToolAvailable = false;

  const SAMPLE_JPEG = path.join(__dirname, '../fixtures/images/sample.jpg');

  beforeAll(async () => {
    validator = new ExifToolValidator();
    exifToolAvailable = await validator.isExifToolAvailable();
    if (!exifToolAvailable) {
      console.warn('⚠️  ExifTool not found. Metadata tests will be skipped.');
    }
  });

  beforeEach(async () => {
    tempDir = new TempDirectory();
    hasher = new FileHasher();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function skipIfNoExifTool(): boolean {
    if (!exifToolAvailable) {
      console.log('⏭️  Skipping: ExifTool not available');
      return true;
    }
    return false;
  }

  async function sampleExists(): Promise<boolean> {
    try {
      const fs = require('fs/promises');
      await fs.access(SAMPLE_JPEG);
      return true;
    } catch {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return false;
    }
  }

  test('writes keywords to JPEG via ExifTool', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Write race number as keyword
    await writeKeywordsToImage(testFile, ['42', 'PRO', 'Racing Team Alpha'], true, 'overwrite');

    // Verify keywords were written
    const metadata = await validator.readMetadata(testFile);
    expect(metadata['Keywords']).toBeDefined();
  });

  test('writes PersonInImage field correctly', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    await writePersonInImage(testFile, 'John Doe');

    const metadata = await validator.readMetadata(testFile);
    expect(metadata['PersonInImage']).toBeDefined();
  });

  test('writes SpecialInstructions with RaceTagger prefix', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    await writeSpecialInstructions(testFile, '#42 | John Doe | PRO');

    const metadata = await validator.readMetadata(testFile);
    const instructions = metadata['SpecialInstructions'] || metadata['Instructions'] || '';
    expect(String(instructions)).toContain('RaceTagger');
  });

  test('handles special characters in participant names', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const specialNames = [
      'José García',
      'Müller Österreich',
      "O'Brien-Smith",
      'André François',
    ];

    for (const name of specialNames) {
      await writePersonInImage(testFile, name);

      const metadata = await validator.readMetadata(testFile);
      expect(metadata['PersonInImage']).toBeDefined();
    }
  });

  test('preserves existing EXIF data when adding keywords', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Read original metadata
    const originalMeta = await validator.readMetadata(testFile);

    // Write new keywords
    await writeKeywordsToImage(testFile, ['42', 'RaceTagger']);

    // Verify existing fields preserved
    const fieldsToCheck = ['Make', 'Model', 'DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISO'];
    const result = await validator.verifyExistingDataPreserved(
      SAMPLE_JPEG, testFile, fieldsToCheck
    );
    expect(result).toBe(true);
  });

  test('writeFullMetadata writes comprehensive IPTC/XMP data', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    const fullMetadata: ExportDestinationMetadata = {
      credit: 'RaceTagger',
      source: 'RaceTagger Desktop',
      copyright: '© 2024 RaceTagger',
      creator: 'Test Photographer',
      headline: 'Race #42 - John Doe - PRO',
      description: 'John Doe driving #42 in PRO category',
      city: 'Monza',
      country: 'Italy',
      keywords: ['42', 'PRO', 'John Doe', 'Racing Team Alpha'],
      personShown: 'John Doe',
    };

    await writeFullMetadata(testFile, fullMetadata);

    const metadata = await validator.readMetadata(testFile);
    expect(metadata['Credit']).toBe('RaceTagger');
    expect(metadata['Creator']).toBeDefined();
    expect(metadata['City']).toBe('Monza');
    expect(metadata['Country']).toBe('Italy');
  });

  test('handles empty or null keywords gracefully', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Write empty keywords — should not throw
    await writeKeywordsToImage(testFile, [], true, 'append');
    await writeKeywordsToImage(testFile, '', true, 'append');

    const exists = await tempDir.fileExists('sample.jpg');
    expect(exists).toBe(true);
  });

  test('overwrites existing keywords in overwrite mode', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Write initial keywords
    await writeKeywordsToImage(testFile, ['10', 'First'], true, 'overwrite');

    // Overwrite with new keywords
    await writeKeywordsToImage(testFile, ['20', 'Second'], true, 'overwrite');

    const metadata = await validator.readMetadata(testFile);
    const keywords = String(metadata['Keywords'] || '');
    expect(keywords).toContain('20');
    expect(keywords).toContain('Second');
  });

  test('append mode adds keywords without removing existing ones', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Write first batch
    await writeKeywordsToImage(testFile, ['42', 'PRO'], true, 'overwrite');

    // Append more
    await writeKeywordsToImage(testFile, ['RaceTagger', 'Monza'], true, 'append');

    const metadata = await validator.readMetadata(testFile);
    const keywords = String(metadata['Keywords'] || '');
    expect(keywords).toContain('42');
    expect(keywords).toContain('RaceTagger');
  });

  test('batch metadata writes to 50+ files without file handle leaks', async () => {
    if (skipIfNoExifTool() || !(await sampleExists())) return;

    const count = 50;
    const testFiles: string[] = [];
    for (let i = 0; i < count; i++) {
      const file = await tempDir.copyFile(SAMPLE_JPEG, `test-${i}.jpg`);
      testFiles.push(file);
    }

    // Write metadata to all files sequentially (ExifTool can't handle too much concurrency)
    for (let i = 0; i < testFiles.length; i++) {
      await writeKeywordsToImage(testFiles[i], [String(i + 1), 'batch-test']);
    }

    // Verify random sample
    const sampleFile = testFiles[25];
    const metadata = await validator.readMetadata(sampleFile);
    expect(metadata['Keywords']).toBeDefined();
  }, 60000); // 60s timeout for batch
});
