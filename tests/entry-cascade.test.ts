/**
 * Unit tests for entry-cascade.ts (ACC-04 Phase 0)
 */

import { cascadeEntryToVehicle } from '../src/matching/entry-cascade';
import type { Participant } from '../src/matching/smart-matcher';

function makeEntry(overrides: Partial<Participant> = {}): Participant {
  return {
    numero: '42',
    squadra: 'Winward Racing',
    categoria: 'GT3',
    make: 'Mercedes',
    model: 'AMG GT3 Evo',
    preset_participant_drivers: [
      { driver_name: 'Jules Gounon', driver_order: 0 },
      { driver_name: 'Maximilian Bühler', driver_order: 1 },
    ],
    sponsors: ['RAVENOL', 'DEKRA'],
    metatag: 'Winward_42',
    ...overrides,
  };
}

function makeVehicle(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    raceNumber: '99',
    teamName: 'HRT Ford Racing',
    drivers: ['Arjun Maini'],
    category: 'GT3',
    make: 'Ford',
    model: 'Mustang GT3',
    sponsors: ['FORD'],
    plateNumber: null,
    metatag: 'HRT_99',
    ...overrides,
  };
}

describe('cascadeEntryToVehicle', () => {
  describe('basic field cascade', () => {
    it('overwrites raceNumber from entry', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry({ numero: '42' }));
      expect(v.raceNumber).toBe('42');
    });

    it('overwrites teamName from squadra', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry({ squadra: 'Winward Racing' }));
      expect(v.teamName).toBe('Winward Racing');
    });

    it('overwrites drivers from preset_participant_drivers', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry());
      expect(v.drivers).toEqual(['Jules Gounon', 'Maximilian Bühler']);
    });

    it('overwrites category', () => {
      const v = makeVehicle({ category: 'GT2' });
      cascadeEntryToVehicle(v, makeEntry({ categoria: 'GT3' }));
      expect(v.category).toBe('GT3');
    });

    it('overwrites make and model', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry({ make: 'Mercedes', model: 'AMG GT3 Evo' }));
      expect(v.make).toBe('Mercedes');
      expect(v.model).toBe('AMG GT3 Evo');
    });

    it('overwrites sponsors', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry({ sponsors: ['RAVENOL', 'DEKRA'] }));
      expect(v.sponsors).toEqual(['RAVENOL', 'DEKRA']);
    });

    it('overwrites metatag', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry({ metatag: 'Winward_42' }));
      expect(v.metatag).toBe('Winward_42');
    });
  });

  describe('clearMissing=true (default)', () => {
    it('clears teamName to null when entry has no squadra', () => {
      const v = makeVehicle({ teamName: 'HRT Ford Racing' });
      const entry = makeEntry({ squadra: undefined, team: undefined });
      cascadeEntryToVehicle(v, entry);
      expect(v.teamName).toBeNull();
    });

    it('clears drivers to [] when entry has no preset_participant_drivers and no nome', () => {
      const v = makeVehicle({ drivers: ['Arjun Maini'] });
      const entry = makeEntry({ preset_participant_drivers: [], nome: undefined });
      cascadeEntryToVehicle(v, entry);
      expect(v.drivers).toEqual([]);
    });

    it('clears category to null when entry has no categoria', () => {
      const v = makeVehicle({ category: 'GT2' });
      const entry = makeEntry({ categoria: undefined, category: undefined });
      cascadeEntryToVehicle(v, entry);
      expect(v.category).toBeNull();
    });

    it('clears make to null when entry has no make', () => {
      const v = makeVehicle({ make: 'Ford' });
      const entry = makeEntry({ make: null });
      cascadeEntryToVehicle(v, entry);
      expect(v.make).toBeNull();
    });

    it('clears metatag to null when entry has no metatag', () => {
      const v = makeVehicle({ metatag: 'OldTag' });
      const entry = makeEntry({ metatag: undefined });
      cascadeEntryToVehicle(v, entry);
      expect(v.metatag).toBeNull();
    });
  });

  describe('clearMissing=false', () => {
    it('preserves vehicle teamName when entry has no squadra', () => {
      const v = makeVehicle({ teamName: 'HRT Ford Racing' });
      const entry = makeEntry({ squadra: undefined, team: undefined });
      cascadeEntryToVehicle(v, entry, { clearMissing: false });
      expect(v.teamName).toBe('HRT Ford Racing');
    });

    it('preserves vehicle drivers when entry has no drivers', () => {
      const v = makeVehicle({ drivers: ['Arjun Maini'] });
      const entry = makeEntry({ preset_participant_drivers: [], nome: undefined });
      cascadeEntryToVehicle(v, entry, { clearMissing: false });
      expect(v.drivers).toEqual(['Arjun Maini']);
    });
  });

  describe('livery special case', () => {
    it('copies livery from entry when present', () => {
      const v = makeVehicle({ livery: { primary: 'black', secondary: [] } });
      const entry = makeEntry({ livery: { primary: 'white', secondary: ['blue'] } });
      cascadeEntryToVehicle(v, entry);
      expect(v.livery).toEqual({ primary: 'white', secondary: ['blue'] });
    });

    it('PRESERVES vehicle livery when entry has no livery (clearMissing=true)', () => {
      const v = makeVehicle({ livery: { primary: 'black', secondary: [] } });
      const entry = makeEntry({ livery: null });
      cascadeEntryToVehicle(v, entry);
      // Should NOT clear livery even with clearMissing=true — per design decision
      expect(v.livery).toEqual({ primary: 'black', secondary: [] });
    });
  });

  describe('finalResult sync', () => {
    it('syncs fields to vehicle.finalResult when present', () => {
      const v = {
        ...makeVehicle(),
        finalResult: { raceNumber: '99', team: 'HRT Ford Racing', drivers: ['Arjun Maini'] },
      };
      cascadeEntryToVehicle(v, makeEntry({ numero: '42', squadra: 'Winward Racing' }));
      expect(v.finalResult.raceNumber).toBe('42');
      expect(v.finalResult.team).toBe('Winward Racing');
      expect(v.finalResult.drivers).toEqual(['Jules Gounon', 'Maximilian Bühler']);
    });
  });

  describe('null / undefined entry guard', () => {
    it('is a no-op when entry is null', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, null);
      expect(v.teamName).toBe('HRT Ford Racing'); // unchanged
    });

    it('is a no-op when entry is undefined', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, undefined);
      expect(v.teamName).toBe('HRT Ford Racing'); // unchanged
    });
  });

  describe('sponsor CSV string format', () => {
    it('splits comma-separated sponsor string', () => {
      const v = makeVehicle();
      const entry = makeEntry({ sponsors: undefined, sponsor: 'RAVENOL,DEKRA,ADAC' });
      cascadeEntryToVehicle(v, entry);
      expect(v.sponsors).toEqual(['RAVENOL', 'DEKRA', 'ADAC']);
    });
  });

  describe('provenance stamp', () => {
    it('stamps _cascadedFrom when source is provided', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry(), { source: 'auto-match' });
      expect(v._cascadedFrom).toBe('auto-match');
    });

    it('does not stamp when source is omitted', () => {
      const v = makeVehicle();
      cascadeEntryToVehicle(v, makeEntry());
      expect(v._cascadedFrom).toBeUndefined();
    });
  });
});
