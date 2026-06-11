/**
 * #167 — Manual-correction keyword rebuild.
 *
 * On a multi-detection (group) photo, correcting or ADDING one detection used
 * to overwrite IPTC:Keywords (and the RAW XMP dc:subject) with ONLY that one
 * vehicle's keywords, wiping the sibling detections. `buildCorrectionKeywords`
 * rebuilds the keyword set from EVERY current detection so siblings survive.
 *
 * These are pure-function tests (no ExifTool / no filesystem); the native deps
 * are mocked only so importing metadata-writer doesn't load real binaries.
 */

jest.mock('../src/utils/native-tool-manager', () => ({
  nativeToolManager: { executeTool: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }) },
}));
jest.mock('../src/utils/xmp-manager', () => ({
  createXmpSidecar: jest.fn().mockResolvedValue('/test/image.xmp'),
  createFullXmpSidecar: jest.fn().mockResolvedValue('/test/image.xmp'),
}));

import { buildCorrectionKeywords } from '../src/utils/metadata-writer';

describe('buildCorrectionKeywords (#167)', () => {
  it('keeps sibling detections when one vehicle is corrected on a group photo', () => {
    // Post-correction state: vehicle[0] was edited from "5" to "6";
    // vehicle[1] (#8, team Ferrari) is untouched.
    const vehicles = [
      { raceNumber: '6', team: 'McLaren', drivers: ['Lando Norris'] },
      { raceNumber: '8', team: 'Ferrari', drivers: ['Charles Leclerc'] },
    ];

    const keywords = buildCorrectionKeywords(vehicles, { raceNumber: '6' });

    // The corrected vehicle AND the sibling must both be represented.
    expect(keywords).toContain('RaceNumber:6');
    expect(keywords).toContain('RaceNumber:8');
    expect(keywords).toContain('Team:McLaren');
    expect(keywords).toContain('Team:Ferrari');
    expect(keywords).toContain('Driver:Lando Norris');
    expect(keywords).toContain('Driver:Charles Leclerc');
    // The single corrected number must NOT be the only thing written.
    expect(keywords).not.toEqual(['RaceNumber:6']);
  });

  it('includes a newly ADDED detection alongside the existing one (+ Add detection button)', () => {
    // User added vehicle[1] (#12) to a photo that already had vehicle[0] (#7).
    const vehicles = [
      { raceNumber: '7', team: 'Red Bull' },
      { raceNumber: '12', team: 'Mercedes' },
    ];

    const keywords = buildCorrectionKeywords(vehicles, { raceNumber: '12', team: 'Mercedes' });

    expect(keywords).toContain('RaceNumber:7');
    expect(keywords).toContain('RaceNumber:12');
    expect(keywords).toContain('Team:Red Bull');
    expect(keywords).toContain('Team:Mercedes');
  });

  it('drops a deleted detection but keeps its siblings', () => {
    const vehicles = [
      { raceNumber: '5', team: 'McLaren' },
      { raceNumber: '8', team: 'Ferrari', deleted: true }, // user deleted this plate
    ];

    const keywords = buildCorrectionKeywords(vehicles, { deleted: true } as any);

    expect(keywords).toContain('RaceNumber:5');
    expect(keywords).toContain('Team:McLaren');
    expect(keywords).not.toContain('RaceNumber:8');
    expect(keywords).not.toContain('Team:Ferrari');
  });

  it('ignores null/placeholder vehicles padded for a higher vehicleIndex', () => {
    // The handler pads with { raceNumber: null, confidence: 0, finalResult: {} }
    // when a correction targets an index past the current end of the array.
    const vehicles = [
      { raceNumber: '5', team: 'McLaren' },
      { raceNumber: null, confidence: 0, finalResult: {} },
      { raceNumber: '9', team: 'Alpine' },
    ];

    const keywords = buildCorrectionKeywords(vehicles);

    expect(keywords).toContain('RaceNumber:5');
    expect(keywords).toContain('RaceNumber:9');
    // No empty "RaceNumber:" from the null placeholder.
    expect(keywords.every((k) => k !== 'RaceNumber:' && k.trim().length > 0)).toBe(true);
  });

  it('falls back to finalResult when the vehicle root fields are absent', () => {
    const vehicles = [
      { finalResult: { raceNumber: '21', team: 'Williams', drivers: ['Alex Albon'] } },
    ];

    const keywords = buildCorrectionKeywords(vehicles);

    expect(keywords).toContain('RaceNumber:21');
    expect(keywords).toContain('Team:Williams');
    expect(keywords).toContain('Driver:Alex Albon');
  });

  it('coerces a single driver string into one Driver keyword', () => {
    const keywords = buildCorrectionKeywords([{ raceNumber: '3', drivers: 'Max Verstappen' }]);
    expect(keywords).toContain('Driver:Max Verstappen');
  });

  it('falls back to the single correction changes when no detection list is given (legacy JSONL)', () => {
    expect(buildCorrectionKeywords(undefined, { raceNumber: '4', team: 'Haas' }))
      .toEqual(['RaceNumber:4', 'Team:Haas']);
    expect(buildCorrectionKeywords([], { raceNumber: '4' }))
      .toEqual(['RaceNumber:4']);
  });

  it('returns an empty set when there is nothing to write (no detections, no changes)', () => {
    expect(buildCorrectionKeywords(undefined)).toEqual([]);
    expect(buildCorrectionKeywords([{ deleted: true }])).toEqual([]);
  });
});
