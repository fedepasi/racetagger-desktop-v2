import { ExifToolValidator } from '../helpers/exiftool-validator';
import { TempDirectory } from '../helpers/temp-directory';
import { FileHasher } from '../helpers/file-hasher';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import {
  writeKeywordsToImage,
  writePersonInImage,
  writeSpecialInstructions,
  writeFullMetadata,
  ExportDestinationMetadata
} from '../../src/utils/metadata-writer';

describe('RAW Metadata with XMP Sidecars', () => {
  let validator: ExifToolValidator;
  let tempDir: TempDirectory;
  let hasher: FileHasher;
  let exifToolAvailable = false;

  const SAMPLE_NEF = path.join(__dirname, '../fixtures/images/sample-small.nef');

  beforeAll(async () => {
    validator = new ExifToolValidator();
    exifToolAvailable = await validator.isExifToolAvailable();
    if (!exifToolAvailable) {
      console.warn('⚠️  ExifTool not found. RAW metadata tests will be skipped.');
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

  async function nefExists(): Promise<boolean> {
    try {
      await fsPromises.access(SAMPLE_NEF);
      return true;
    } catch {
      console.log('⏭️  Skipping: Sample NEF not available');
      return false;
    }
  }

  test('writeKeywordsToImage creates XMP sidecar for NEF without touching RAW', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(testFile);

    // writeKeywordsToImage detects RAW and creates XMP sidecar
    await writeKeywordsToImage(testFile, ['42', 'PRO', 'Racing Team Alpha']);

    // Verify XMP sidecar was created
    const xmpName = path.basename(testFile).replace('.nef', '.xmp');
    const xmpExists = await tempDir.fileExists(xmpName);
    expect(xmpExists).toBe(true);

    // Verify RAW file unchanged (triple-layer protection)
    const finalHash = await hasher.computeSHA256(testFile);
    expect(finalHash).toBe(originalHash);
  });

  test('writePersonInImage creates XMP sidecar for RAW files', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(testFile);

    await writePersonInImage(testFile, 'John Smith');

    // Verify XMP sidecar created
    const xmpName = path.basename(testFile).replace('.nef', '.xmp');
    const xmpExists = await tempDir.fileExists(xmpName);
    expect(xmpExists).toBe(true);

    // Verify RAW hash unchanged
    const finalHash = await hasher.computeSHA256(testFile);
    expect(finalHash).toBe(originalHash);
  });

  test('writeSpecialInstructions creates XMP sidecar for RAW', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(testFile);

    await writeSpecialInstructions(testFile, '#42 | John Doe | PRO');

    // Verify XMP sidecar
    const xmpName = path.basename(testFile).replace('.nef', '.xmp');
    const xmpExists = await tempDir.fileExists(xmpName);
    expect(xmpExists).toBe(true);

    // Verify RAW unchanged
    const finalHash = await hasher.computeSHA256(testFile);
    expect(finalHash).toBe(originalHash);
  });

  test('writeFullMetadata creates XMP sidecar for RAW with all fields', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(testFile);

    const fullMetadata: ExportDestinationMetadata = {
      credit: 'RaceTagger',
      creator: 'Test Photographer',
      headline: 'Race #42 - John Doe',
      description: 'John Doe driving #42',
      keywords: ['42', 'PRO', 'John Doe'],
      personShown: 'John Doe',
    };

    await writeFullMetadata(testFile, fullMetadata);

    // Verify XMP sidecar
    const xmpName = path.basename(testFile).replace('.nef', '.xmp');
    const xmpExists = await tempDir.fileExists(xmpName);
    expect(xmpExists).toBe(true);

    // Verify RAW unchanged
    const finalHash = await hasher.computeSHA256(testFile);
    expect(finalHash).toBe(originalHash);
  });

  test('XMP sidecar contains written keywords', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);

    await writeKeywordsToImage(testFile, ['42', 'John Smith', 'PRO']);

    // Read XMP sidecar content
    const xmpName = path.basename(testFile).replace('.nef', '.xmp');
    const xmpContent = (await tempDir.readFile(xmpName)).toString('utf-8');

    // Verify keywords are present in XMP
    expect(xmpContent).toContain('42');
    expect(xmpContent).toContain('John Smith');
    expect(xmpContent).toContain('PRO');
  });

  test('XMP sidecar naming follows RAW file name', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const filenames = [
      'DSC_1234.nef',
      'IMG_5678.nef',
      'P1234567.nef',
    ];

    for (const filename of filenames) {
      const testFile = await tempDir.copyFile(SAMPLE_NEF, filename);

      await writeKeywordsToImage(testFile, ['test-keyword']);

      const expectedXMP = filename.replace('.nef', '.xmp');
      const xmpExists = await tempDir.fileExists(expectedXMP);
      expect(xmpExists).toBe(true);
    }
  });

  test('triple-layer RAW protection prevents accidental direct writes', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);
    const originalHash = await hasher.computeSHA256(testFile);

    // All metadata functions should create XMP sidecar, NOT modify RAW
    await writeKeywordsToImage(testFile, ['test']);
    await writePersonInImage(testFile, 'Test User');
    await writeSpecialInstructions(testFile, 'test data');

    // RAW file must be byte-identical to original
    const finalHash = await hasher.computeSHA256(testFile);
    expect(finalHash).toBe(originalHash);
  });

  test('handles empty keywords for RAW files gracefully', async () => {
    if (skipIfNoExifTool() || !(await nefExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_NEF);

    // Empty keywords — should not throw or create corrupt XMP
    await writeKeywordsToImage(testFile, []);
    await writeKeywordsToImage(testFile, '');
    await writePersonInImage(testFile, '');
    await writeSpecialInstructions(testFile, '');

    // File should still be valid
    const exists = await tempDir.fileExists(path.basename(testFile));
    expect(exists).toBe(true);
  });
});
