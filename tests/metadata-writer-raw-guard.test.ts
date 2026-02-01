/**
 * Tests for B1: RAW file metadata protection
 *
 * Verifies that metadata-writer.ts never writes directly to RAW files
 * with ExifTool, and instead delegates to XMP sidecar creation.
 * This prevents overwriting pre-existing metadata (color labels,
 * copyright, captions) in RAW files.
 */

// Mock native-tool-manager before importing metadata-writer
const mockExecuteTool = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
jest.mock('../src/utils/native-tool-manager', () => ({
  nativeToolManager: {
    executeTool: mockExecuteTool,
  },
}));

// Mock xmp-manager
const mockCreateXmpSidecar = jest.fn().mockResolvedValue('/test/image.xmp');
jest.mock('../src/utils/xmp-manager', () => ({
  createXmpSidecar: mockCreateXmpSidecar,
}));

import {
  writeKeywordsToImage,
  writeSpecialInstructions,
  writeExtendedDescription,
  writePersonInImage,
  writeFullMetadata,
} from '../src/utils/metadata-writer';

describe('B1: RAW file metadata protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- RAW extensions that must be protected ---
  const rawExtensions = ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'];
  const jpegPath = '/photos/race/IMG_0001.jpg';

  describe('isRawFile detection', () => {
    it.each(rawExtensions)('should detect .%s as RAW file', async (ext) => {
      const rawPath = `/photos/race/IMG_0001.${ext}`;
      await writeKeywordsToImage(rawPath, ['racetagger', 'number:42']);

      expect(mockCreateXmpSidecar).toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it.each(rawExtensions)('should detect uppercase .%s as RAW file', async (ext) => {
      const rawPath = `/photos/race/IMG_0001.${ext.toUpperCase()}`;
      await writeKeywordsToImage(rawPath, ['racetagger', 'number:42']);

      expect(mockCreateXmpSidecar).toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should NOT treat JPEG as RAW', async () => {
      await writeKeywordsToImage(jpegPath, ['racetagger']);

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).toHaveBeenCalled();
    });

    it('should NOT treat PNG as RAW', async () => {
      await writeKeywordsToImage('/photos/race/IMG.png', ['racetagger']);

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).toHaveBeenCalled();
    });

    it('should NOT treat WebP as RAW', async () => {
      await writeKeywordsToImage('/photos/race/IMG.webp', ['racetagger']);

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).toHaveBeenCalled();
    });
  });

  describe('writeKeywordsToImage', () => {
    it('should write to XMP sidecar for RAW files', async () => {
      await writeKeywordsToImage('/photos/DSC_1234.nef', ['42', 'ferrari', 'racetagger']);

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/DSC_1234.nef',
        expect.arrayContaining(['racetagger'])
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should write directly with ExifTool for JPEG files', async () => {
      await writeKeywordsToImage(jpegPath, ['42', 'ferrari']);

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'exiftool',
        expect.arrayContaining(['-overwrite_original', jpegPath])
      );
      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
    });

    it('should not call anything for empty keywords', async () => {
      await writeKeywordsToImage('/photos/DSC_1234.nef', []);

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  describe('writeSpecialInstructions', () => {
    it('should write to XMP sidecar for RAW files', async () => {
      await writeSpecialInstructions('/photos/IMG_5678.cr2', 'Number: 42, Driver: Leclerc');

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/IMG_5678.cr2',
        ['racetagger'],
        expect.stringContaining('RaceTagger:')
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should write directly with ExifTool for JPEG files', async () => {
      await writeSpecialInstructions(jpegPath, 'Number: 42');

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'exiftool',
        expect.arrayContaining(['-overwrite_original', jpegPath])
      );
      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
    });

    it('should not call anything for empty race data', async () => {
      await writeSpecialInstructions('/photos/DSC.nef', '');

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  describe('writeExtendedDescription', () => {
    it('should write to XMP sidecar for RAW files', async () => {
      await writeExtendedDescription('/photos/IMG.arw', 'Race analysis results');

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/IMG.arw',
        ['racetagger'],
        'Race analysis results'
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should write directly with ExifTool for JPEG files', async () => {
      await writeExtendedDescription(jpegPath, 'Race analysis results');

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'exiftool',
        expect.arrayContaining(['-overwrite_original', jpegPath])
      );
      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
    });

    it('should not call anything for empty description', async () => {
      await writeExtendedDescription('/photos/DSC.dng', '');

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  describe('writePersonInImage', () => {
    it('should write to XMP sidecar for RAW files', async () => {
      await writePersonInImage('/photos/DSC.nef', 'Charles Leclerc');

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/DSC.nef',
        ['Charles Leclerc']
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should handle multiple persons for RAW files', async () => {
      await writePersonInImage('/photos/DSC.cr3', ['Leclerc', 'Sainz']);

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/DSC.cr3',
        ['Leclerc', 'Sainz']
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should write directly with ExifTool for JPEG files', async () => {
      await writePersonInImage(jpegPath, 'Charles Leclerc');

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'exiftool',
        expect.arrayContaining(['-overwrite_original', jpegPath])
      );
      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
    });

    it('should not call anything for empty person names', async () => {
      await writePersonInImage('/photos/DSC.nef', []);

      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  describe('writeFullMetadata', () => {
    it('should write to XMP sidecar for RAW files with keywords', async () => {
      await writeFullMetadata('/photos/DSC.orf', {
        keywords: ['ferrari', 'gt3', 'monza'],
        creator: 'John Photographer',
        copyright: '2025 John Photo',
        description: 'Ferrari 296 GT3 at Monza',
      });

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/DSC.orf',
        expect.arrayContaining(['ferrari', 'gt3', 'monza', 'John Photographer', 'racetagger']),
        'Ferrari 296 GT3 at Monza'
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should write to XMP sidecar for RAW files with personShown', async () => {
      await writeFullMetadata('/photos/DSC.rw2', {
        personShown: ['Charles Leclerc', 'Carlos Sainz'],
        headline: 'Ferrari duo at Monza',
      });

      expect(mockCreateXmpSidecar).toHaveBeenCalledWith(
        '/photos/DSC.rw2',
        expect.arrayContaining(['Charles Leclerc', 'Carlos Sainz', 'racetagger']),
        'Ferrari duo at Monza'
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should write directly with ExifTool for JPEG files', async () => {
      await writeFullMetadata(jpegPath, {
        keywords: ['ferrari', 'gt3'],
        creator: 'John Photographer',
        copyright: '2025 John Photo',
      });

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'exiftool',
        expect.arrayContaining(['-overwrite_original', jpegPath])
      );
      expect(mockCreateXmpSidecar).not.toHaveBeenCalled();
    });

    it('should not call anything for empty metadata on RAW files', async () => {
      await writeFullMetadata('/photos/DSC.nef', {});

      // With empty metadata, writeFullMetadata exits early (args.length <= 3)
      // but for RAW files, the guard runs first and creates minimal sidecar
      expect(mockCreateXmpSidecar).toHaveBeenCalled();
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  describe('ExifTool never called for RAW files (integration check)', () => {
    it('should never pass a RAW file path to exiftool across all functions', async () => {
      const rawPath = '/photos/important_shoot/DSC_9999.nef';

      await writeKeywordsToImage(rawPath, ['number:42', 'ferrari']);
      await writeSpecialInstructions(rawPath, 'Number: 42');
      await writeExtendedDescription(rawPath, 'Analysis results');
      await writePersonInImage(rawPath, 'Charles Leclerc');
      await writeFullMetadata(rawPath, {
        keywords: ['gt3'],
        copyright: '2025 Agency',
        creator: 'Photographer',
      });

      // ExifTool should NEVER be called with a RAW file path
      for (const call of mockExecuteTool.mock.calls) {
        const args = call[1] as string[];
        const lastArg = args[args.length - 1];
        expect(lastArg).not.toMatch(/\.(nef|arw|cr2|cr3|orf|raw|rw2|dng)$/i);
      }

      // XMP sidecar should have been called 5 times (once per function)
      expect(mockCreateXmpSidecar).toHaveBeenCalledTimes(5);
    });
  });
});
