/**
 * Tests for the alphabetical sort + locale-aware comparison used by the
 * PR3 side panel. The actual sort lives inside getFolderPoolSorted in
 * participants-manager.js (renderer-only, no module exports), so we
 * reproduce the comparison contract here against a focused helper that
 * mirrors the production logic 1:1.
 *
 * Why bother testing this? Because "alphabetical with umlauts" is a
 * well-known foot-gun in JS — naive `.sort()` puts "Müller" after "Z"
 * (the default code-point comparator), and we have actual umlauts in
 * Lisa's preset (Schnitzelalm Heyer, Würth, Härtling, Röss, etc.).
 */

import { describe, it, expect } from '@jest/globals';

/**
 * Mirror of the production sort. If you change the comparator in
 * participants-manager.js's getFolderPoolSorted, change it here too.
 */
function sortFolderPool(pool: { name: string; path?: string }[]) {
  const cleaned = pool
    .map((f) => {
      if (!f) return null;
      if (typeof (f as any) === 'string') {
        const name = (f as any).trim();
        return name ? { name } : null;
      }
      if (typeof f === 'object' && typeof f.name === 'string') {
        const name = f.name.trim();
        if (!name) return null;
        return f.path ? { name, path: f.path } : { name };
      }
      return null;
    })
    .filter(Boolean) as { name: string; path?: string }[];
  cleaned.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return cleaned;
}

describe('folder pool sorting (PR3)', () => {
  it('sorts a simple ASCII list alphabetically', () => {
    const result = sortFolderPool([
      { name: 'Charlie' },
      { name: 'Alpha' },
      { name: 'Bravo' }
    ]);
    expect(result.map((f) => f.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('is case-insensitive (sensitivity: base)', () => {
    const result = sortFolderPool([
      { name: 'amg' },
      { name: 'ADAC' },
      { name: 'BMW' }
    ]);
    expect(result.map((f) => f.name)).toEqual(['ADAC', 'amg', 'BMW']);
  });

  it('places umlaut letters at their natural German collation position', () => {
    // "Müller" should sort between "M" and "Mz" — naïve code-point sort
    // would place it after "Z". Locale-aware comparison handles it.
    const result = sortFolderPool([
      { name: 'Mercedes' },
      { name: 'Mz' },
      { name: 'Müller' },
      { name: 'Mae' }
    ]);
    expect(result[0].name).toBe('Mae');
    expect(result[1].name).toBe('Mercedes');
    // "Mü" lands between "Me..." and "Mz" — exact slot is OS-locale-dependent
    // but it must NOT be at the bottom past "Mz".
    const muIdx = result.findIndex((f) => f.name === 'Müller');
    const mzIdx = result.findIndex((f) => f.name === 'Mz');
    expect(muIdx).toBeLessThan(mzIdx);
  });

  it('handles a Lisa-style 17-folder Nürburgring pool', () => {
    const result = sortFolderPool([
      { name: 'Schnitzelalm Heyer', path: '/abs/sh' },
      { name: 'AMG', path: '/abs/amg' },
      { name: 'ADAC', path: '/abs/adac' },
      { name: 'Winward Verstappen', path: '/abs/wv' },
      { name: 'Winward Ravenol', path: '/abs/wr' },
      { name: 'KW' },
      { name: 'WS Racing Giti' },
      { name: 'Scherer' },
      { name: 'VW' },
      { name: 'Falken' },
      { name: 'Dunlop' },
      { name: 'Lionspeed' },
      { name: 'Black Falcon' },
      { name: 'Nordschleife' },
      { name: 'Ravenol' },
      { name: 'Alexander Müller' },
      { name: 'ARC Bratislava' }
    ]);
    const names = result.map((f) => f.name);
    expect(names[0]).toBe('ADAC');
    expect(names[1]).toBe('Alexander Müller');
    expect(names[2]).toBe('AMG');
    expect(names[3]).toBe('ARC Bratislava');
    expect(names[names.length - 1]).toBe('WS Racing Giti');
    // Spot-check that "Winward Ravenol" precedes "Winward Verstappen".
    const wrIdx = names.indexOf('Winward Ravenol');
    const wvIdx = names.indexOf('Winward Verstappen');
    expect(wrIdx).toBeLessThan(wvIdx);
  });

  it('drops null / undefined / blank-name entries', () => {
    const dirty: any = [
      { name: 'Real' },
      null,
      undefined,
      { name: '   ' },
      { path: '/no-name-key' },
      { name: 'Also Real' }
    ];
    const result = sortFolderPool(dirty);
    expect(result.map((f) => f.name)).toEqual(['Also Real', 'Real']);
  });

  it('preserves the path when provided, omits the key when not', () => {
    const result = sortFolderPool([
      { name: 'WithPath', path: '/somewhere' },
      { name: 'NoPath' }
    ]);
    expect(result.find((f) => f.name === 'WithPath')!.path).toBe('/somewhere');
    expect(Object.keys(result.find((f) => f.name === 'NoPath')!).sort()).toEqual(['name']);
  });

  it('trims surrounding whitespace from names before sorting', () => {
    const result = sortFolderPool([
      { name: '  Bravo' },
      { name: 'Alpha  ' }
    ]);
    expect(result.map((f) => f.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('returns an empty array for an empty pool', () => {
    expect(sortFolderPool([])).toEqual([]);
  });
});
