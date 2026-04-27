import { 
  extractPreview, 
  extractPreviewFromBuffer,
  extractMediumPreview,
  extractFullPreview,
  detectFormat, 
  getSupportedFormats, 
  createDefaultOptions, 
  getErrorMessage,
  isRetryableError,
  RawFormat,
  ErrorCode,
  QuickExtractOptions 
} from '../src/ts/index';
import * as fs from 'fs';
import * as path from 'path';

describe('RAW Preview Extractor', () => {
  const sampleDir = path.join(__dirname, 'samples');
  
  beforeAll(() => {
    // Ensure samples directory exists
    if (!fs.existsSync(sampleDir)) {
      fs.mkdirSync(sampleDir, { recursive: true });
    }
  });

  describe('Format Detection', () => {
    test('should return supported formats list', () => {
      const formats = getSupportedFormats();
      expect(formats).toContain(RawFormat.CR2);
      expect(formats).toContain(RawFormat.NEF);
      expect(formats).toContain(RawFormat.ARW);
      expect(formats).toContain(RawFormat.DNG);
      expect(formats.length).toBeGreaterThan(5);
    });

    test('should detect format from invalid data', async () => {
      const invalidBuffer = Buffer.alloc(100, 0);
      const format = await detectFormat(invalidBuffer);
      expect(format).toBe(RawFormat.UNKNOWN);
    });

    test('should detect format from file that does not exist', async () => {
      const format = await detectFormat('/nonexistent/file.cr2');
      expect(format).toBe(RawFormat.UNKNOWN);
    });
  });

  describe('Options Creation', () => {
    test('should create default options', () => {
      const options = createDefaultOptions();
      expect(options.targetSize?.min).toBe(200 * 1024);
      expect(options.targetSize?.max).toBe(3 * 1024 * 1024);
      expect(options.preferQuality).toBe('preview');
      expect(options.cache).toBe(true);
      expect(options.timeout).toBe(5000);
    });

    test('should override default options', () => {
      const options = createDefaultOptions({
        preferQuality: 'thumbnail',
        cache: false,
        maxMemory: 200,
        timeout: 10000
      });
      expect(options.preferQuality).toBe('thumbnail');
      expect(options.cache).toBe(false);
      expect(options.targetSize?.min).toBe(200 * 1024); // Should keep default
    });
  });

  describe('Preview Extraction', () => {
    test('should handle extraction from invalid file', async () => {
      const result = await extractPreview('/nonexistent/file.cr2');
      expect(result.success).toBe(false);
      expect(result.errorInfo?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    test('should handle extraction from invalid buffer', async () => {
      const invalidBuffer = Buffer.alloc(100, 0);
      const result = await extractPreviewFromBuffer(invalidBuffer);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle extraction with custom options', async () => {
      const invalidBuffer = Buffer.alloc(100, 0);
      const options = createDefaultOptions({
        targetSize: { min: 100 * 1024, max: 1024 * 1024 },
        preferQuality: 'thumbnail'
      });
      
      const result = await extractPreviewFromBuffer(invalidBuffer, options);
      expect(result.success).toBe(false); // Still should fail with invalid data
    });

    test('should handle medium preview extraction from invalid file', async () => {
      const result = await extractMediumPreview('/nonexistent/file.cr2');
      expect(result.success).toBe(false);
      expect(result.errorInfo?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    test('should handle full preview extraction from invalid file', async () => {
      const result = await extractFullPreview('/nonexistent/file.cr2');
      expect(result.success).toBe(false);
      expect(result.errorInfo?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    test('should handle medium preview extraction with options', async () => {
      const options: QuickExtractOptions = {
        timeout: 1000,
        strictValidation: false
      };
      const result = await extractMediumPreview('/nonexistent/file.cr2', options);
      expect(result.success).toBe(false);
      expect(result.errorInfo?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    test('should handle full preview extraction with options', async () => {
      const options: QuickExtractOptions = {
        timeout: 1000,
        strictValidation: false
      };
      const result = await extractFullPreview('/nonexistent/file.cr2', options);
      expect(result.success).toBe(false);
      expect(result.errorInfo?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    // Skip tests requiring actual RAW files if not available
    const hasTestFiles = fs.existsSync(path.join(sampleDir, 'test.cr2')) ||
                        fs.existsSync(path.join(sampleDir, 'test.nef')) ||
                        fs.existsSync(path.join(sampleDir, 'test.arw'));

    if (hasTestFiles) {
      test('should extract preview from CR2 file', async () => {
        const cr2File = path.join(sampleDir, 'test.cr2');
        if (fs.existsSync(cr2File)) {
          const result = await extractPreview(cr2File);
          expect(result.success).toBe(true);
          expect(result.preview?.format).toBe('CR2');
          expect(result.preview?.data).toBeInstanceOf(Buffer);
          expect(result.preview?.size).toBeGreaterThan(0);
        }
      });

      test('should extract preview from NEF file', async () => {
        const nefFile = path.join(sampleDir, 'test.nef');
        if (fs.existsSync(nefFile)) {
          const result = await extractPreview(nefFile);
          expect(result.success).toBe(true);
          expect(result.preview?.format).toBe('NEF');
          expect(result.preview?.data).toBeInstanceOf(Buffer);
        }
      });

      test('should extract preview from ARW file', async () => {
        const arwFile = path.join(sampleDir, 'test.arw');
        if (fs.existsSync(arwFile)) {
          const result = await extractPreview(arwFile);
          expect(result.success).toBe(true);
          expect(result.preview?.format).toBe('ARW');
          expect(result.preview?.data).toBeInstanceOf(Buffer);
        }
      });
    } else {
      test.skip('Real RAW file tests skipped - no test files available', () => {
        // This test is skipped when no real RAW files are available
      });
    }
  });

  describe('Performance and Memory', () => {
    test('should handle large buffer without memory issues', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024, 0); // 10MB of zeros
      const result = await extractPreviewFromBuffer(largeBuffer);
      expect(result.success).toBe(false); // Should fail gracefully
      expect(result.error).toBeDefined();
    });

    test('should respect timeout option', async () => {
      const invalidBuffer = Buffer.alloc(100, 0);
      const options = createDefaultOptions({ timeout: 1 }); // 1ms timeout
      
      const result = await extractPreviewFromBuffer(invalidBuffer, options);
      expect(result.success).toBe(false);
    });
  });
});

// Integration test helper
export function createMockRawFile(format: RawFormat, size: number = 1024): Buffer {
  const buffer = Buffer.alloc(size);
  
  switch (format) {
    case RawFormat.CR2:
      // Mock CR2 header
      buffer.writeUInt8(0x49, 0); // "II" little endian
      buffer.writeUInt8(0x49, 1);
      buffer.writeUInt16LE(0x002A, 2); // TIFF magic
      buffer.writeUInt16LE(0x5243, 8); // "CR" magic for CR2
      break;
      
    case RawFormat.NEF:
      // Mock NEF/TIFF header
      buffer.writeUInt8(0x49, 0);
      buffer.writeUInt8(0x49, 1);
      buffer.writeUInt16LE(0x002A, 2);
      buffer.write('NIKON', 100); // Mock Nikon signature
      break;
      
    case RawFormat.RAF:
      // Mock RAF header
      buffer.write('FUJIFILMCCD-RAW', 0);
      break;
      
    default:
      // Generic TIFF header
      buffer.writeUInt8(0x49, 0);
      buffer.writeUInt8(0x49, 1);
      buffer.writeUInt16LE(0x002A, 2);
      break;
  }
  
  return buffer;
}