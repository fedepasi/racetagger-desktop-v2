/**
 * Issue #281 — folder organization for NUMBERLESS participants.
 *
 * A preset participant can legitimately have no race number (Team Principal,
 * VIP, mechanic): they are identified by NAME (+ face) and routed to a custom
 * folder. Before the fix the "Organize into folders" pass was number-only, so
 * these photos fell through to Unknown_Numbers (and scene-skipped frames to
 * Others) even after the user manually assigned the right name.
 *
 * These tests pin the routing CONTRACT that the main.ts organize loop relies
 * on: `FolderOrganizer.organizeImage` must route a numberless participant that
 * carries `folders[]` to those custom folders when no race number is supplied.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FolderOrganizer, CsvParticipantData } from '../src/utils/folder-organizer';

let workDir: string;
let srcDir: string;
let destDir: string;

function makeImage(name: string): string {
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, 'fake-jpeg-bytes');
  return p;
}

function baseConfig(overrides: Partial<ConstructorParameters<typeof FolderOrganizer>[0]> = {}) {
  return {
    enabled: true,
    mode: 'copy' as const,
    pattern: 'number' as const,
    createUnknownFolder: true,
    unknownFolderName: 'Unknown_Numbers',
    includeXmpFiles: false,
    destinationPath: destDir,
    conflictStrategy: 'rename' as const,
    ...overrides,
  };
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-281-'));
  srcDir = path.join(workDir, 'src');
  destDir = path.join(workDir, 'out');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('Issue #281 — numberless participant routing', () => {
  it('routes a numberless participant (empty raceNumbers) to its custom folder, not Unknown_Numbers', async () => {
    const organizer = new FolderOrganizer(baseConfig());
    const img = makeImage('vip1.jpg');

    const vip: CsvParticipantData = {
      numero: '', // numberless: Team Principal / VIP
      nome: 'Mario Bianchi',
      folders: [{ name: 'VIP - Mario Bianchi' }],
      include_default_folder: false,
    };

    // The fix leaves raceNumbers EMPTY for a numberless custom-folder match.
    const result = await organizer.organizeImage(img, [], vip, srcDir);

    expect(result.success).toBe(true);
    expect(result.operation).not.toBe('skip');
    const vipFolder = path.join(destDir, 'VIP - Mario Bianchi');
    expect(fs.existsSync(path.join(vipFolder, 'vip1.jpg'))).toBe(true);
    // Must NOT have landed in Unknown_Numbers.
    expect(fs.existsSync(path.join(destDir, 'Unknown_Numbers'))).toBe(false);
  });

  it('honours an absolute custom folder path bound to the user PC', async () => {
    const organizer = new FolderOrganizer(baseConfig());
    const img = makeImage('vip2.jpg');
    const boundPath = path.join(workDir, 'on-my-pc', 'TeamPrincipals');
    fs.mkdirSync(boundPath, { recursive: true });

    const vip: CsvParticipantData = {
      numero: '',
      nome: 'Anna Verdi',
      folders: [{ name: 'TeamPrincipals', path: boundPath }],
      include_default_folder: false,
    };

    const result = await organizer.organizeImage(img, [], vip, srcDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(boundPath, 'vip2.jpg'))).toBe(true);
  });

  it('still routes a genuinely unmatched photo (no csvData) to Unknown_Numbers', async () => {
    const organizer = new FolderOrganizer(baseConfig());
    const img = makeImage('mystery.jpg');

    // organizeUnknownImage is what the loop calls when nothing resolved.
    const result = await organizer.organizeUnknownImage(img, srcDir);
    expect(result.success).toBe(true);
    // destinationPath wins as the base dir for the unknown folder.
    expect(fs.existsSync(path.join(destDir, 'Unknown_Numbers', 'mystery.jpg'))).toBe(true);
  });

  it('mixed photo: a numbered car AND a numberless VIP both get the photo, with the preset allow-list active', async () => {
    const organizer = new FolderOrganizer(
      baseConfig({
        pattern: 'number',
        allowedNumbers: ['46'], // only the real car number is allow-listed
        restrictToAllowedNumbers: true,
      })
    );
    const img = makeImage('grid.jpg');

    const car: CsvParticipantData = { numero: '46', nome: 'Driver X', include_default_folder: true };
    const vip: CsvParticipantData = {
      numero: '',
      nome: 'Mario Bianchi',
      folders: [{ name: 'VIP - Mario Bianchi' }],
      include_default_folder: true,
    };

    // The car number drives raceNumbers; the VIP rides along via csvData.folders.
    const result = await organizer.organizeImage(img, ['46'], [car, vip], srcDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(destDir, '46', 'grid.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'VIP - Mario Bianchi', 'grid.jpg'))).toBe(true);
    // The empty VIP number must not have produced a phantom folder.
    expect(fs.existsSync(path.join(destDir, 'Unknown_Numbers'))).toBe(false);
  });

  it('numberless participant with NO custom folder does not silently vanish (control)', async () => {
    const organizer = new FolderOrganizer(baseConfig());
    const img = makeImage('orphan.jpg');

    // No folders[] → the main.ts loop would keep raceNumbers=['unknown'];
    // simulate that fallback and assert it lands in Unknown_Numbers.
    const vip: CsvParticipantData = { numero: '', nome: 'No Folder VIP' };
    const result = await organizer.organizeImage(img, ['unknown'], vip, srcDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'Unknown_Numbers', 'orphan.jpg'))).toBe(true);
  });
});
