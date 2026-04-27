/**
 * Tests for structured RaceTagger metadata (RACETAGGER_V1 in XMP:Instructions).
 * Verifies round-trip: build → write to XMP sidecar → read back.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildStructuredData, RaceTaggerStructuredData } from '../src/utils/metadata-writer';

// We test the XMP sidecar read/write directly without ExifTool (pure file I/O)
const RACETAGGER_DATA_PREFIX = 'RACETAGGER_V1:';

// Helper: create a minimal XMP sidecar with RaceTagger structured data
function createTestXmpSidecar(filePath: string, data: RaceTaggerStructuredData): void {
  const jsonStr = JSON.stringify(data);
  const payload = `${RACETAGGER_DATA_PREFIX}${jsonStr}`;
  const escapedPayload = payload
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const xmpContent = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Racetagger XMP Generator 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <dc:subject>
        <rdf:Bag>
          <rdf:li>5</rdf:li>
          <rdf:li>leclerc</rdf:li>
          <rdf:li>ferrari</rdf:li>
          <rdf:li>racetagger</rdf:li>
        </rdf:Bag>
      </dc:subject>
      <xmp:Instructions>${escapedPayload}</xmp:Instructions>
      <xmp:MetadataDate>${new Date().toISOString()}</xmp:MetadataDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

  fs.writeFileSync(filePath, xmpContent, 'utf8');
}

// Helper: read structured data from XMP sidecar (mirrors readStructuredDataFromXmpSidecar)
function readTestXmpSidecar(xmpFilePath: string): RaceTaggerStructuredData | null {
  if (!fs.existsSync(xmpFilePath)) return null;

  const content = fs.readFileSync(xmpFilePath, 'utf8');
  const match = content.match(/<xmp:Instructions>([^<]*)<\/xmp:Instructions>/);
  if (!match) return null;

  // Unescape XML entities
  const raw = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  if (!raw.startsWith(RACETAGGER_DATA_PREFIX)) return null;

  const jsonStr = raw.substring(RACETAGGER_DATA_PREFIX.length);
  return JSON.parse(jsonStr) as RaceTaggerStructuredData;
}

describe('Structured RaceTagger Metadata', () => {
  const tmpDir = path.join(__dirname, '__tmp_structured_metadata__');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temp files (ignore errors on mounted filesystems)
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors (e.g., EPERM on mounted volumes)
    }
  });

  describe('buildStructuredData', () => {
    const mockGetDriverNames = (participant: any): string[] => {
      if (participant.preset_participant_drivers?.length > 0) {
        return participant.preset_participant_drivers
          .sort((a: any, b: any) => a.driver_order - b.driver_order)
          .map((d: any) => d.driver_name);
      }
      return participant.nome ? [participant.nome] : [];
    };

    it('should build data from analysis with preset match', () => {
      const analysis = [
        { raceNumber: '5', drivers: ['AI Driver'], teamName: 'AI Team' }
      ];
      const csvMatches = [
        {
          entry: {
            numero: '5',
            squadra: 'Ferrari',
            metatag: 'GT3 Pro',
            preset_participant_drivers: [
              { driver_name: 'Charles Leclerc', driver_order: 0 },
              { driver_name: 'Carlos Sainz', driver_order: 1 }
            ],
            folder_1: 'GT3',
            folder_2: 'Ferrari'
          }
        }
      ];

      const result = buildStructuredData(analysis, csvMatches, 'motorsport', mockGetDriverNames);

      expect(result.v).toBe(1);
      expect(result.numbers).toEqual(['5']);
      expect(result.drivers).toEqual([['Charles Leclerc', 'Carlos Sainz']]);
      expect(result.teams).toEqual(['Ferrari']);
      expect(result.category).toBe('motorsport');
      expect(result.metatag).toBe('GT3 Pro');
      expect(result.folders).toEqual({
        folder_1: 'GT3',
        folder_2: 'Ferrari',
        folder_3: undefined,
        folder_1_path: undefined,
        folder_2_path: undefined,
        folder_3_path: undefined,
      });
      expect(result.ts).toBeDefined();
    });

    it('should build data from AI-only analysis (no preset)', () => {
      const analysis = [
        { raceNumber: '42', drivers: ['Max Verstappen'], teamName: 'Red Bull' },
        { raceNumber: '1', drivers: ['Lewis Hamilton'], teamName: 'Mercedes' }
      ];

      const result = buildStructuredData(analysis, null, 'motorsport', mockGetDriverNames);

      expect(result.numbers).toEqual(['42', '1']);
      expect(result.drivers).toEqual([['Max Verstappen'], ['Lewis Hamilton']]);
      expect(result.teams).toEqual(['Red Bull', 'Mercedes']);
      expect(result.metatag).toBeUndefined();
      expect(result.folders).toBeUndefined();
    });

    it('should handle empty analysis', () => {
      const result = buildStructuredData([], null, 'running', mockGetDriverNames);

      expect(result.numbers).toEqual([]);
      expect(result.drivers).toEqual([]);
      expect(result.teams).toEqual([]);
      expect(result.category).toBe('running');
    });

    it('should prefer preset data over AI data', () => {
      const analysis = [
        { raceNumber: '55', drivers: ['Wrong Name'], teamName: 'Wrong Team' }
      ];
      const csvMatches = [
        {
          entry: {
            numero: '5',
            squadra: 'Ferrari',
            preset_participant_drivers: [
              { driver_name: 'Carlos Sainz', driver_order: 0 }
            ]
          }
        }
      ];

      const result = buildStructuredData(analysis, csvMatches, 'motorsport', mockGetDriverNames);

      expect(result.numbers).toEqual(['5']); // From preset, not '55' from AI
      expect(result.drivers).toEqual([['Carlos Sainz']]); // From preset
      expect(result.teams).toEqual(['Ferrari']); // From preset
    });
  });

  describe('XMP Sidecar Round-Trip', () => {
    it('should write and read back structured data correctly', () => {
      const xmpPath = path.join(tmpDir, 'test_image.xmp');
      const data: RaceTaggerStructuredData = {
        v: 1,
        numbers: ['5', '12'],
        drivers: [['Charles Leclerc', 'Carlos Sainz'], ['Fernando Alonso']],
        teams: ['Ferrari', 'Aston Martin'],
        category: 'motorsport',
        metatag: 'GT3 Pro Class',
        ts: '2026-02-18T12:00:00.000Z',
      };

      createTestXmpSidecar(xmpPath, data);
      const readBack = readTestXmpSidecar(xmpPath);

      expect(readBack).not.toBeNull();
      expect(readBack!.v).toBe(1);
      expect(readBack!.numbers).toEqual(['5', '12']);
      expect(readBack!.drivers).toEqual([['Charles Leclerc', 'Carlos Sainz'], ['Fernando Alonso']]);
      expect(readBack!.teams).toEqual(['Ferrari', 'Aston Martin']);
      expect(readBack!.category).toBe('motorsport');
      expect(readBack!.metatag).toBe('GT3 Pro Class');
      expect(readBack!.ts).toBe('2026-02-18T12:00:00.000Z');
    });

    it('should handle special characters in metatag', () => {
      const xmpPath = path.join(tmpDir, 'test_special.xmp');
      const data: RaceTaggerStructuredData = {
        v: 1,
        numbers: ['7'],
        drivers: [['Kimi Räikkönen']],
        teams: ['Alfa Romeo & Sauber'],
        category: 'motorsport',
        metatag: 'F1 <Legacy> "Champions"',
        ts: '2026-02-18T12:00:00.000Z',
      };

      createTestXmpSidecar(xmpPath, data);
      const readBack = readTestXmpSidecar(xmpPath);

      expect(readBack).not.toBeNull();
      expect(readBack!.drivers).toEqual([['Kimi Räikkönen']]);
      expect(readBack!.teams).toEqual(['Alfa Romeo & Sauber']);
      expect(readBack!.metatag).toBe('F1 <Legacy> "Champions"');
    });

    it('should handle folders with paths', () => {
      const xmpPath = path.join(tmpDir, 'test_folders.xmp');
      const data: RaceTaggerStructuredData = {
        v: 1,
        numbers: ['99'],
        drivers: [['Test Driver']],
        teams: ['Test Team'],
        category: 'running',
        folders: {
          folder_1: 'Elite',
          folder_2: 'Finishers',
          folder_1_path: '/Volumes/Photos/Elite',
          folder_2_path: '/Volumes/Photos/Finishers',
        },
        ts: '2026-02-18T12:00:00.000Z',
      };

      createTestXmpSidecar(xmpPath, data);
      const readBack = readTestXmpSidecar(xmpPath);

      expect(readBack).not.toBeNull();
      expect(readBack!.folders).toEqual({
        folder_1: 'Elite',
        folder_2: 'Finishers',
        folder_1_path: '/Volumes/Photos/Elite',
        folder_2_path: '/Volumes/Photos/Finishers',
      });
    });

    it('should return null for XMP without structured data', () => {
      const xmpPath = path.join(tmpDir, 'test_no_data.xmp');
      const xmpContent = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:subject><rdf:Bag><rdf:li>photo</rdf:li></rdf:Bag></dc:subject>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
      fs.writeFileSync(xmpPath, xmpContent, 'utf8');

      const readBack = readTestXmpSidecar(xmpPath);
      expect(readBack).toBeNull();
    });

    it('should return null for non-existent file', () => {
      const readBack = readTestXmpSidecar(path.join(tmpDir, 'nonexistent.xmp'));
      expect(readBack).toBeNull();
    });
  });

  describe('Data Integrity for Folder Organization', () => {
    it('should provide all data needed for number-based folder organization', () => {
      const xmpPath = path.join(tmpDir, 'test_folder_org.xmp');
      const data: RaceTaggerStructuredData = {
        v: 1,
        numbers: ['5'],
        drivers: [['Charles Leclerc']],
        teams: ['Ferrari'],
        category: 'motorsport',
        ts: '2026-02-18T12:00:00.000Z',
      };

      createTestXmpSidecar(xmpPath, data);
      const readBack = readTestXmpSidecar(xmpPath);

      // Simulate what folder organizer would need:
      // 1. Race numbers for folder names
      expect(readBack!.numbers.length).toBeGreaterThan(0);
      expect(readBack!.numbers[0]).toBe('5');

      // 2. Driver names for number_name pattern
      expect(readBack!.drivers[0][0]).toBe('Charles Leclerc');

      // 3. Team for custom patterns
      expect(readBack!.teams[0]).toBe('Ferrari');
    });

    it('should preserve multi-vehicle data for multi-folder organization', () => {
      const xmpPath = path.join(tmpDir, 'test_multi.xmp');
      const data: RaceTaggerStructuredData = {
        v: 1,
        numbers: ['5', '12'],
        drivers: [['Driver A'], ['Driver B']],
        teams: ['Team A', 'Team B'],
        category: 'motorsport',
        folders: {
          folder_1: 'Class_GT3',
          folder_2: 'All_Cars',
        },
        ts: '2026-02-18T12:00:00.000Z',
      };

      createTestXmpSidecar(xmpPath, data);
      const readBack = readTestXmpSidecar(xmpPath);

      // Folder organizer should be able to create folders for both numbers
      expect(readBack!.numbers).toHaveLength(2);
      // And use custom folder assignments
      expect(readBack!.folders?.folder_1).toBe('Class_GT3');
      expect(readBack!.folders?.folder_2).toBe('All_Cars');
    });
  });
});
