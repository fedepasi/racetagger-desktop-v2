/**
 * #167 — End-to-end IPTC:Keywords integrity on multi-detection (group) photos.
 *
 * Reproduces the data-integrity bug and confirms the fix with a REAL exiftool
 * round-trip (bundled exiftool writes, system exiftool reads back):
 *
 *   1. Original analysis writes both detections' keywords.
 *   2. OLD per-correction path (single vehicle, mode='overwrite') WIPES the
 *      sibling detection — the bug.
 *   3. FIX path rebuilds from ALL detections (buildCorrectionKeywords) and
 *      keeps the sibling while the corrected number replaces the stale one.
 *
 * Keywords pass through simplifyKeywords (useSimplified=true), so "RaceNumber:8"
 * lands as "8", "Team:Ferrari" as "ferrari", "Driver:Charles Leclerc" as
 * "charles"/"leclerc", plus the global "racetagger" tag.
 */

import { ExifToolValidator } from '../helpers/exiftool-validator';
import { TempDirectory } from '../helpers/temp-directory';
import * as path from 'path';
import { writeKeywordsToImage, buildCorrectionKeywords, writeCorrectionKeywords } from '../../src/utils/metadata-writer';

describe('#167 group-photo correction keeps sibling IPTC keywords', () => {
  let validator: ExifToolValidator;
  let tempDir: TempDirectory;
  let exifToolAvailable = false;

  const SAMPLE_JPEG = path.join(__dirname, '../fixtures/images/sample.jpg');

  beforeAll(async () => {
    validator = new ExifToolValidator();
    exifToolAvailable = await validator.isExifToolAvailable();
    if (!exifToolAvailable) console.warn('⚠️  ExifTool not found. #167 integration test skipped.');
  });

  beforeEach(async () => {
    tempDir = new TempDirectory();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  async function sampleExists(): Promise<boolean> {
    try {
      await require('fs/promises').access(SAMPLE_JPEG);
      return true;
    } catch {
      console.log('⏭️  Skipping: Sample JPEG not available');
      return false;
    }
  }

  function keywordSet(meta: Record<string, any>): Set<string> {
    const kw = meta['Keywords'];
    const arr = Array.isArray(kw) ? kw : kw != null ? [kw] : [];
    return new Set(arr.map((k: any) => String(k).toLowerCase()));
  }

  it('reproduces the drop with the old path, then fixes it with the full rebuild', async () => {
    if (!exifToolAvailable || !(await sampleExists())) return;

    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Multi-digit race numbers on purpose: simplifyKeywords drops single-char
    // tokens (length <= 1), so "#5" would never survive — that single-digit gap
    // is tracked separately. Real grids are mostly multi-digit anyway.

    // --- 1. Original analysis: a 2-detection group photo (#15 + #28) ---
    const original = [
      { raceNumber: '15', team: 'McLaren', drivers: ['Lando Norris'] },
      { raceNumber: '28', team: 'Ferrari', drivers: ['Charles Leclerc'] },
    ];
    await writeKeywordsToImage(testFile, buildCorrectionKeywords(original), true, 'overwrite');

    let kw = keywordSet(await validator.readMetadata(testFile));
    expect(kw.has('15')).toBe(true);
    expect(kw.has('28')).toBe(true);
    expect(kw.has('ferrari')).toBe(true);
    expect(kw.has('leclerc')).toBe(true);

    // --- 2. OLD per-correction path: correct vehicle[0] (#15 -> #16) writing
    //        ONLY that vehicle, mode='overwrite'. This is the bug. ---
    const oldSinglePath = buildCorrectionKeywords(undefined, {
      raceNumber: '16',
      team: 'McLaren',
      drivers: ['Lando Norris'],
    });
    await writeKeywordsToImage(testFile, oldSinglePath, true, 'overwrite');

    kw = keywordSet(await validator.readMetadata(testFile));
    expect(kw.has('16')).toBe(true); // corrected number landed
    // BUG: sibling detection #28 / Ferrari / Leclerc was wiped.
    expect(kw.has('28')).toBe(false);
    expect(kw.has('ferrari')).toBe(false);
    expect(kw.has('leclerc')).toBe(false);

    // --- 3. FIX: rebuild from ALL detections (post-correction state). ---
    const corrected = [
      { raceNumber: '16', team: 'McLaren', drivers: ['Lando Norris'] }, // edited in place
      { raceNumber: '28', team: 'Ferrari', drivers: ['Charles Leclerc'] }, // sibling, untouched
    ];
    await writeKeywordsToImage(testFile, buildCorrectionKeywords(corrected), true, 'overwrite');

    kw = keywordSet(await validator.readMetadata(testFile));
    // Sibling restored AND corrected number kept; stale "15" gone — proves the
    // overwrite-clear fix (repeated -IPTC:Keywords=VALUE) actually replaces.
    expect(kw.has('16')).toBe(true);
    expect(kw.has('28')).toBe(true);
    expect(kw.has('ferrari')).toBe(true);
    expect(kw.has('leclerc')).toBe(true);
    expect(kw.has('15')).toBe(false);
  });

  it('keeps SINGLE-DIGIT race numbers (#5) through simplification', async () => {
    if (!exifToolAvailable || !(await sampleExists())) return;
    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // Single-digit cars (#1–#9) used to be dropped by simplifyKeywords (which
    // discarded tokens <= 1 char), losing the number keyword on correction.
    await writeKeywordsToImage(
      testFile,
      buildCorrectionKeywords([{ raceNumber: '5', team: 'McLaren', drivers: ['Lando Norris'] }]),
      true,
      'overwrite'
    );

    const kw = keywordSet(await validator.readMetadata(testFile));
    expect(kw.has('5')).toBe(true); // the single digit survives
    expect(kw.has('mclaren')).toBe(true);
  });

  it('preserves embedded visual tags through a correction, drops non-embedded ones', async () => {
    if (!exifToolAvailable || !(await sampleExists())) return;
    const testFile = await tempDir.copyFile(SAMPLE_JPEG);

    // --- Original analysis embedded detection keywords + visual tags ---
    await writeKeywordsToImage(
      testFile,
      [...buildCorrectionKeywords([{ raceNumber: '15', team: 'McLaren' }]), 'Monza', 'Sunny'],
      true,
      'overwrite'
    );
    let kw = keywordSet(await validator.readMetadata(testFile));
    expect(kw.has('monza')).toBe(true);
    expect(kw.has('sunny')).toBe(true);

    // --- Correct #15 -> #16 via the real correction writer. "Monza"/"Sunny"
    //     are on the file (so preserved); "Rain" is NOT on the file (so it
    //     must NOT be added — respects a user who chose not to embed it). ---
    await writeCorrectionKeywords(
      testFile,
      buildCorrectionKeywords([{ raceNumber: '16', team: 'McLaren' }]),
      { location: ['Monza'], weather: ['Sunny', 'Rain'] }
    );

    kw = keywordSet(await validator.readMetadata(testFile));
    expect(kw.has('16')).toBe(true);   // corrected number
    expect(kw.has('15')).toBe(false);  // stale number gone
    expect(kw.has('monza')).toBe(true); // embedded visual tag preserved
    expect(kw.has('sunny')).toBe(true); // embedded visual tag preserved
    expect(kw.has('rain')).toBe(false); // not previously embedded -> not added
  });
});
