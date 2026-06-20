/**
 * Unit tests for the P1 DNA-reconciliation consensus logic (matching/dna-consensus.ts).
 *
 * These are PURE-function tests — no pipeline, no DB. They lock the cardinal rules:
 *  - the function NEVER changes a race number (only returns detections to demote);
 *  - a single photo never demotes — only a corroborated multi-photo cluster consensus;
 *  - MAKE drives it, MODEL never does;
 *  - abstentions (null make) don't vote and can't be outliers;
 *  - burst-correlated clusters are shadow-only (no demote) in P1.
 */

import { describe, it, expect } from '@jest/globals';
import {
  dnaConsensusAndValidate,
  canonicalMake,
  canonicalCategory,
  assessDNACoherence,
  DNADetectionInput,
} from '../src/matching/dna-consensus';
import { DEFAULT_DNA_SETTINGS } from '../src/matching/sport-config';

function det(
  key: string,
  raceNumber: string | null,
  make: string | null,
  opts: { categoryDna?: string | null; ts?: number; wasClearWinner?: boolean } = {}
): DNADetectionInput {
  return {
    key,
    raceNumber,
    make,
    categoryDna: opts.categoryDna ?? null,
    ts: opts.ts ?? 0,
    wasClearWinner: opts.wasClearWinner ?? true,
  };
}

// A spread of timestamps wide enough to NOT be a single burst (default burst = 4000ms).
const SPREAD = [0, 10_000, 20_000, 30_000, 40_000];

describe('canonicalMake', () => {
  it('aliases Mercedes variants to one bucket', () => {
    expect(canonicalMake('Mercedes-AMG')).toBe('mercedes');
    expect(canonicalMake('Mercedes')).toBe('mercedes');
    expect(canonicalMake('Mercedes-Benz')).toBe('mercedes');
  });
  it('aliases VW/Volkswagen', () => {
    expect(canonicalMake('VW')).toBe('volkswagen');
    expect(canonicalMake('Volkswagen')).toBe('volkswagen');
  });
  it('takes first token for multi-word makes/models', () => {
    expect(canonicalMake('Porsche 911 GT3 Cup')).toBe('porsche');
    expect(canonicalMake('Aston Martin Vantage')).toBe('aston');
    expect(canonicalMake('BMW M4 GT3')).toBe('bmw');
  });
  it('treats null/unknown/empty as abstain', () => {
    expect(canonicalMake(null)).toBeNull();
    expect(canonicalMake('Unknown')).toBeNull();
    expect(canonicalMake('  ')).toBeNull();
    expect(canonicalMake('N/A')).toBeNull();
  });
});

describe('canonicalCategory', () => {
  it('normalizes and drops unknowns', () => {
    expect(canonicalCategory('GT3')).toBe('gt3');
    expect(canonicalCategory(null)).toBeNull();
    expect(canonicalCategory('unknown')).toBeNull();
  });
});

describe('dnaConsensusAndValidate', () => {
  it('(b) DEMOTES a corroborated cross-family outlier in a coherent, spread cluster', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[3] }),
      // outlier: different family + category disagrees → corroborated
      det('e', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[4], wasClearWinner: true }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.changed).toBe(true);
    expect(r.demotions.map(d => d.key)).toEqual(['e']);
    expect(r.demotions[0].consensusMake).toBe('ferrari');
    expect(r.demotions[0].detectedMake).toBe('bmw');
  });

  it('(b2) corroboration via non-clear-winner number match (category agrees)', () => {
    const dets = [
      det('a', '7', 'Porsche', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '7', 'Porsche', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '7', 'Porsche', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '7', 'Porsche', { categoryDna: 'GT3', ts: SPREAD[3] }),
      det('e', '7', 'Audi', { categoryDna: 'GT3', ts: SPREAD[4], wasClearWinner: false }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions.map(d => d.key)).toEqual(['e']);
  });

  it('(a) KEEPS a lone make blip when category agrees AND number was a clear winner', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[3] }),
      det('e', '16', 'BMW', { categoryDna: 'GT3', ts: SPREAD[4], wasClearWinner: true }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.changed).toBe(false);
    expect(r.demotions).toEqual([]);
  });

  it('(c) KEEPS an indecisive / tied cluster', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[2] }),
      det('d', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[3] }),
      det('e', '16', 'Audi', { categoryDna: 'GT3', ts: SPREAD[4] }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions).toEqual([]);
    expect(r.clusters[0].status).toBe('indecisive');
  });

  it('(d) KEEPS a cluster below minClusterVotes', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[2], wasClearWinner: false }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions).toEqual([]);
    expect(r.clusters[0].status).toBe('too-small');
  });

  it('(f) a null-make dissent abstains — never an outlier', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[3] }),
      det('e', '16', null, { categoryDna: null, ts: SPREAD[4], wasClearWinner: false }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions).toEqual([]);
  });

  it('(g) a burst-correlated cluster is shadow-only (no demote)', () => {
    const burst = [0, 500, 1000, 1500, 2000]; // all within 4000ms
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: burst[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: burst[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: burst[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: burst[3] }),
      det('e', '16', 'BMW', { categoryDna: 'Touring', ts: burst[4], wasClearWinner: false }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions).toEqual([]);
    expect(r.clusters[0].status).toBe('burst-shadow');
  });

  it('(majority-abstain) KEEPS when most of the cluster has no make', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', null, { ts: SPREAD[2] }),
      det('d', '16', null, { ts: SPREAD[3] }),
      det('e', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[4], wasClearWinner: false }),
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions).toEqual([]); // nonAbstaining=3 of 5 → still thin/indecisive, KEEP
  });

  it('(corroboration off) DEMOTES on make alone when category corroboration disabled', () => {
    const settings = { ...DEFAULT_DNA_SETTINGS, dnaRequireCategoryCorroboration: false };
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[3] }),
      det('e', '16', 'BMW', { categoryDna: 'GT3', ts: SPREAD[4], wasClearWinner: true }), // agrees + clear winner
    ];
    expect(dnaConsensusAndValidate(dets, settings).demotions.map(d => d.key)).toEqual(['e']);
    // ...and KEEP under default (corroboration required)
    expect(dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS).demotions).toEqual([]);
  });

  it('separate numbers form separate clusters', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[3] }),
      det('e', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[4], wasClearWinner: false }),
      det('x', '99', 'Porsche', { categoryDna: 'GT3', ts: SPREAD[0] }), // different number, tiny cluster → KEEP
    ];
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(r.demotions.map(d => d.key)).toEqual(['e']);
    expect(r.clusters.find(c => c.raceNumber === '99')!.status).toBe('too-small');
  });

  it('(h) NEVER mutates inputs and never returns a number change', () => {
    const dets = [
      det('a', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[0] }),
      det('b', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[1] }),
      det('c', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[2] }),
      det('d', '16', 'Ferrari', { categoryDna: 'GT3', ts: SPREAD[3] }),
      det('e', '16', 'BMW', { categoryDna: 'Touring', ts: SPREAD[4], wasClearWinner: false }),
    ];
    const snapshot = JSON.parse(JSON.stringify(dets));
    const r = dnaConsensusAndValidate(dets, DEFAULT_DNA_SETTINGS);
    expect(dets).toEqual(snapshot); // inputs untouched
    // the result carries no field that could change a number — only the original raceNumber
    for (const d of r.demotions) {
      expect(d.raceNumber).toBe('16');
      expect(Object.keys(d)).not.toContain('newRaceNumber');
    }
  });

  it('handles empty input', () => {
    const r = dnaConsensusAndValidate([], DEFAULT_DNA_SETTINGS);
    expect(r).toEqual({ changed: false, demotions: [], clusters: [] });
  });
});

describe('assessDNACoherence', () => {
  const cluster = {
    raceNumber: '16', consensusMake: 'ferrari', consensusCategory: 'gt3',
    coherenceShare: 0.8, votesForWinner: 4, nonAbstainingVotes: 5, clusterSize: 5,
    status: 'consensus' as const, burstCorrelated: false,
  };
  it('returns negative for a make outlier in a consensus cluster', () => {
    expect(assessDNACoherence(det('e', '16', 'BMW'), cluster)).toBeLessThan(0);
  });
  it('returns 0 when the make agrees', () => {
    expect(assessDNACoherence(det('a', '16', 'Ferrari'), cluster)).toBe(0);
  });
  it('returns 0 for an abstaining (null) make', () => {
    expect(assessDNACoherence(det('a', '16', null), cluster)).toBe(0);
  });
  it('returns 0 when the cluster is not a consensus', () => {
    expect(assessDNACoherence(det('e', '16', 'BMW'), { ...cluster, status: 'indecisive' })).toBe(0);
  });
});
