/**
 * Tests for renderer-side driver helpers (driver-helpers.js).
 *
 * The helper is a pure function module — no DOM, no network, no IPC — so we
 * can `require()` it directly in Jest without environment setup. It uses
 * a dual-export pattern (CommonJS for tests, browser global for renderer).
 *
 * Coverage focus is the export-time fallback `synthesizeDriversFromNome`,
 * which preserves multi-driver lineups when `preset_participant_drivers` is
 * empty for a participant. See PR1 in PLAN_BULK_FOLDER_ASSIGN.md.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { synthesizeDriversFromNome } = require('../renderer/js/driver-helpers');

interface SynthDriver {
  id: string;
  participant_numero: string;
  driver_name: string;
  driver_metatag: null;
  driver_nationality: string;
  driver_order: number;
}

describe('synthesizeDriversFromNome', () => {
  describe('empty / null inputs', () => {
    it('returns empty array for empty string', () => {
      expect(synthesizeDriversFromNome('', '1')).toEqual([]);
    });

    it('returns empty array for null', () => {
      expect(synthesizeDriversFromNome(null, '1')).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(synthesizeDriversFromNome(undefined, '1')).toEqual([]);
    });

    it('returns empty array for whitespace-only', () => {
      expect(synthesizeDriversFromNome('   \t  \n ', '1')).toEqual([]);
    });

    it('returns empty array for non-string inputs', () => {
      expect(synthesizeDriversFromNome(42, '1')).toEqual([]);
      expect(synthesizeDriversFromNome({}, '1')).toEqual([]);
      expect(synthesizeDriversFromNome([], '1')).toEqual([]);
    });
  });

  describe('single driver name', () => {
    it('returns one driver record', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('Augusto Farfus', '1');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        participant_numero: '1',
        driver_name: 'Augusto Farfus',
        driver_metatag: null,
        driver_nationality: '',
        driver_order: 0
      });
      expect(typeof result[0].id).toBe('string');
      expect(result[0].id.length).toBeGreaterThan(0);
    });

    it('trims whitespace around a single name', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('  Augusto Farfus  ', '1');
      expect(result[0].driver_name).toBe('Augusto Farfus');
    });
  });

  describe('multi-driver comma-separated', () => {
    it('emits one record per name with sequential driver_order from 0', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome(
        'Augusto Farfus, Raffaele Marciello, Jordan Pepper, Kelvin van der Linde',
        '1'
      );
      expect(result).toHaveLength(4);
      expect(result.map((d) => d.driver_name)).toEqual([
        'Augusto Farfus',
        'Raffaele Marciello',
        'Jordan Pepper',
        'Kelvin van der Linde'
      ]);
      expect(result.map((d) => d.driver_order)).toEqual([0, 1, 2, 3]);
    });

    it('every emitted driver inherits the participant_numero', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('A, B, C', '447');
      expect(result.every((d) => d.participant_numero === '447')).toBe(true);
    });

    it('trims whitespace around each split entry', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('  Hamilton  ,Verstappen  ,  Norris', '1');
      expect(result.map((d) => d.driver_name)).toEqual(['Hamilton', 'Verstappen', 'Norris']);
    });

    it('drops empty entries from "A,,B" patterns', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('A,,B,, ,C', '1');
      expect(result.map((d) => d.driver_name)).toEqual(['A', 'B', 'C']);
      expect(result.map((d) => d.driver_order)).toEqual([0, 1, 2]);
    });

    it('generates a unique id per emitted driver', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('A, B, C, D, E, F, G, H', '1');
      const ids = new Set(result.map((d) => d.id));
      expect(ids.size).toBe(8);
    });

    it('handles names containing periods, hyphens, umlauts, accents', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome(
        'J. Smith-Jones, Müller, Pérez, Jürgen Röss, Patricija Stalidzane',
        '7'
      );
      expect(result).toHaveLength(5);
      expect(result.map((d) => d.driver_name)).toEqual([
        'J. Smith-Jones',
        'Müller',
        'Pérez',
        'Jürgen Röss',
        'Patricija Stalidzane'
      ]);
    });
  });

  describe('non-canonical separators (slash) — preserved as-is', () => {
    let warnSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('does NOT split on "/" — preserves the entire token', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('A / B', '1');
      expect(result).toHaveLength(1);
      expect(result[0].driver_name).toBe('A / B');
    });

    it('does NOT split on ";"', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('A;B;C', '1');
      expect(result).toHaveLength(1);
      expect(result[0].driver_name).toBe('A;B;C');
    });

    it('logs a warning when "/" is present so data-quality issues surface', () => {
      synthesizeDriversFromNome('A / B', '99');
      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toContain('participant 99');
      expect(msg).toContain('"/"');
    });

    it('does NOT warn when only commas are present', () => {
      synthesizeDriversFromNome('A, B, C', '1');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('preserves comma-then-slash mixed input — splits on comma only', () => {
      // "Driver A, Driver B / co-driver TBD" → ["Driver A", "Driver B / co-driver TBD"]
      const result: SynthDriver[] = synthesizeDriversFromNome('Driver A, Driver B / co-driver TBD', '1');
      expect(result.map((d) => d.driver_name)).toEqual(['Driver A', 'Driver B / co-driver TBD']);
    });
  });

  describe('shape contract — matches what exportPresetJSON consumes', () => {
    it('every record has exactly the keys exportPresetJSON pushes into allDrivers', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('A, B', '99');
      const expectedKeys = [
        'id',
        'participant_numero',
        'driver_name',
        'driver_metatag',
        'driver_nationality',
        'driver_order'
      ].sort();
      for (const d of result) {
        expect(Object.keys(d).sort()).toEqual(expectedKeys);
      }
    });

    it('driver_metatag is null and driver_nationality is empty string (export shape)', () => {
      const result: SynthDriver[] = synthesizeDriversFromNome('Solo Driver', '12');
      expect(result[0].driver_metatag).toBeNull();
      expect(result[0].driver_nationality).toBe('');
    });
  });

  describe('regression: Lisa-style preset with 4 drivers', () => {
    it('reproduces the #1 ROWE participant lineup verbatim', () => {
      // From the 24h Nürburgring entry list — the exact case that triggered PR1.
      const nome = 'Augusto Farfus, Raffaele Marciello, Jordan Pepper, Kelvin van der Linde';
      const result: SynthDriver[] = synthesizeDriversFromNome(nome, '1');
      expect(result).toHaveLength(4);
      expect(result[0].driver_name).toBe('Augusto Farfus');
      expect(result[3].driver_name).toBe('Kelvin van der Linde');
      expect(result[3].driver_order).toBe(3);
      expect(result[3].participant_numero).toBe('1');
    });
  });
});
