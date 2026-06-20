/**
 * DNA Consensus & Validation (P1 — DNA-reconciliation)
 *
 * Pure, side-effect-free functions that look at the vehicle DNA (make / category)
 * across a whole batch and decide — CONSERVATIVELY — whether a detection's match
 * should be DEMOTED to needs_review because the car it shows contradicts the
 * cluster consensus.
 *
 * CARDINAL RULES baked in here:
 *  - The race NUMBER is the primary key. Nothing in this module ever changes a
 *    number; it only returns detections to move to needs_review.
 *  - MAKE is the reliable axis (Phase -1: ~78% per-photo accuracy). MODEL is too
 *    noisy and NEVER triggers a demote.
 *  - Avoid crying wolf: a single photo never demotes — only a multi-photo cluster
 *    consensus can, and only when a real cross-family contradiction is corroborated.
 *  - Count-based voting (NOT confidence-weighted): V6 emits no per-make confidence,
 *    so every present make = one vote. Abstentions (null/unknown make) don't vote.
 *
 * The master gate (enableDNAContradictionDemote) and shadow mode are applied by the
 * CALLER, not here — this module always computes verdicts so shadow runs can log them.
 */

import { DNASettings, DEFAULT_DNA_SETTINGS } from './sport-config';

export interface DNADetectionInput {
  /** Unique key for mapping a verdict back to its detection (e.g. `${imageId}#${vehicleIndex}`). */
  key: string;
  raceNumber: string | null;
  make: string | null;
  categoryDna: string | null;
  /** ms timestamp (photo-taken or analyzed); 0 if unknown — used only for the burst guard. */
  ts: number;
  /** Was this detection's number match a clear winner (no ambiguity)? Drives corroboration 5b. */
  wasClearWinner: boolean;
}

export interface DNAClusterVerdict {
  raceNumber: string;
  consensusMake: string | null;
  consensusCategory: string | null;
  coherenceShare: number;        // votesForWinner / nonAbstainingVotes (0..1)
  votesForWinner: number;
  nonAbstainingVotes: number;
  clusterSize: number;
  status: 'consensus' | 'indecisive' | 'too-small' | 'burst-shadow';
  burstCorrelated: boolean;
}

export interface DNADemotion {
  key: string;
  raceNumber: string;
  consensusMake: string;
  consensusCategory: string | null;
  detectedMake: string;
  coherenceShare: number;
  votesForWinner: number;
  clusterSize: number;
  reason: string;
}

export interface DNAConsensusResult {
  /** true if at least one detection meets the demote rule (independent of the master gate). */
  changed: boolean;
  demotions: DNADemotion[];
  clusters: DNAClusterVerdict[];
}

/**
 * Canonical manufacturer family bucket. Lowercases, drops null/unknown, applies a
 * small alias map (Mercedes-AMG→mercedes, VW→volkswagen, …), else takes the first
 * token so "Porsche 911 GT3" and "Porsche" agree, and "Aston Martin Vantage" →
 * "aston". Returns null for an abstaining make.
 */
export function canonicalMake(make: string | null | undefined): string | null {
  if (!make || typeof make !== 'string') return null;
  const m = make.trim().toLowerCase();
  if (m === '' || m === 'null' || m === 'unknown' || m === 'n/a' || m === '-' || m === '?') return null;
  const aliases: Record<string, string> = {
    'mercedes': 'mercedes',
    'mercedes-amg': 'mercedes',
    'mercedes-benz': 'mercedes',
    'amg': 'mercedes',
    'vw': 'volkswagen',
    'volkswagen': 'volkswagen',
    'aston martin': 'aston',
    'alfa romeo': 'alfa',
  };
  if (aliases[m]) return aliases[m];
  // Default: first token (split on space or hyphen).
  return m.split(/[\s\-]+/)[0];
}

/** Canonical race category (GT3/LMP2/TCR/Motocross…). null for empty/unknown. */
export function canonicalCategory(cat: string | null | undefined): string | null {
  if (!cat || typeof cat !== 'string') return null;
  const c = cat.trim().toLowerCase();
  if (c === '' || c === 'null' || c === 'unknown' || c === 'n/a' || c === '-' || c === '?') return null;
  return c;
}

/**
 * Per-detection coherence delta vs its cluster consensus. Negative = contradiction.
 * Contract: returns 0 when there is no actionable consensus or the make agrees/abstains;
 * returns a negative penalty (default -15) only on a real make outlier. MODEL is never
 * consulted. Used as a tunable scoring hook; the demote decision itself lives in
 * dnaConsensusAndValidate.
 */
export function assessDNACoherence(
  detection: DNADetectionInput,
  cluster: DNAClusterVerdict,
  penalty = -15
): number {
  if (cluster.status !== 'consensus') return 0;
  const mine = canonicalMake(detection.make);
  if (!mine || !cluster.consensusMake) return 0;       // abstain or no consensus make → neutral
  return mine === cluster.consensusMake ? 0 : penalty; // outlier → negative
}

/**
 * Main entry: cluster detections by final race number, vote on make (count-based),
 * and return the detections that should be demoted to needs_review, plus per-cluster
 * telemetry. Never mutates inputs, never touches a race number.
 */
export function dnaConsensusAndValidate(
  detections: DNADetectionInput[],
  settings: DNASettings = DEFAULT_DNA_SETTINGS
): DNAConsensusResult {
  const s = settings || DEFAULT_DNA_SETTINGS;
  const clusters: DNAClusterVerdict[] = [];
  const demotions: DNADemotion[] = [];

  // Group by final race number (skip null/empty numbers — nothing to cluster on).
  const byNumber = new Map<string, DNADetectionInput[]>();
  for (const d of detections) {
    const n = (d.raceNumber ?? '').trim();
    if (!n) continue;
    const arr = byNumber.get(n) || [];
    arr.push(d);
    byNumber.set(n, arr);
  }

  for (const [raceNumber, members] of byNumber) {
    const clusterSize = members.length;

    // Tally canonical makes (count-based; abstentions excluded).
    const makeVotes = new Map<string, number>();
    let nonAbstaining = 0;
    for (const d of members) {
      const cm = canonicalMake(d.make);
      if (!cm) continue;
      nonAbstaining += 1;
      makeVotes.set(cm, (makeVotes.get(cm) || 0) + 1);
    }

    // Rank buckets.
    const ranked = [...makeVotes.entries()].sort((a, b) => b[1] - a[1]);
    const consensusMake = ranked.length > 0 ? ranked[0][0] : null;
    const votesForWinner = ranked.length > 0 ? ranked[0][1] : 0;
    const runnerUp = ranked.length > 1 ? ranked[1][1] : 0;
    const coherenceShare = nonAbstaining > 0 ? votesForWinner / nonAbstaining : 0;

    // Category consensus (independent, count-based) over category_dna.
    const catVotes = new Map<string, number>();
    for (const d of members) {
      const cc = canonicalCategory(d.categoryDna);
      if (!cc) continue;
      catVotes.set(cc, (catVotes.get(cc) || 0) + 1);
    }
    const consensusCategory = [...catVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Burst guard: if every voting detection falls inside one tight burst, the make
    // errors are correlated (lighting/angle) and can fabricate a false consensus →
    // shadow-only in P1.
    const tsList = members.map(m => m.ts).filter(t => typeof t === 'number' && t > 0);
    const spread = tsList.length >= 2 ? Math.max(...tsList) - Math.min(...tsList) : 0;
    const burstCorrelated = tsList.length >= 2 && spread <= s.burstThresholdMs;

    // Decide cluster status.
    const lead = votesForWinner - runnerUp; // margin of the winning make over the runner-up
    let status: DNAClusterVerdict['status'];
    if (clusterSize < s.minClusterVotes || nonAbstaining * 2 < clusterSize) {
      // too thin, or majority of the cluster abstained (null make) → don't trust it
      status = 'too-small';
    } else if (
      !consensusMake ||
      votesForWinner < s.minConsensusVotes ||
      coherenceShare < s.makeConsensusShare ||
      lead <= s.tieMargin            // winner doesn't lead the runner-up by more than tieMargin → too close
    ) {
      status = 'indecisive';
    } else if (burstCorrelated) {
      status = 'burst-shadow';       // consensus exists but all in one tight burst → shadow-only in P1
    } else {
      status = 'consensus';
    }

    clusters.push({
      raceNumber, consensusMake, consensusCategory, coherenceShare,
      votesForWinner, nonAbstainingVotes: nonAbstaining, clusterSize, status, burstCorrelated,
    });

    // Only a clean (non-burst) consensus can demote.
    if (status !== 'consensus' || !consensusMake) continue;

    for (const d of members) {
      const mine = canonicalMake(d.make);
      if (!mine || mine === consensusMake) continue; // agree or abstain → KEEP

      // Corroboration (5): category_dna disagrees, OR the number match wasn't a clear winner.
      const myCat = canonicalCategory(d.categoryDna);
      const categoryDisagrees = !!myCat && !!consensusCategory && myCat !== consensusCategory;
      const corroborated = s.dnaRequireCategoryCorroboration
        ? (categoryDisagrees || d.wasClearWinner === false)
        : true; // when corroboration not required, a confident cross-family make outlier is enough
      if (!corroborated) continue;

      demotions.push({
        key: d.key,
        raceNumber,
        consensusMake,
        consensusCategory,
        detectedMake: mine,
        coherenceShare: Number(coherenceShare.toFixed(3)),
        votesForWinner,
        clusterSize,
        reason: categoryDisagrees
          ? `make ${mine} vs cluster ${consensusMake} (${votesForWinner}/${nonAbstaining}); category also differs`
          : `make ${mine} vs cluster ${consensusMake} (${votesForWinner}/${nonAbstaining}); number match was not a clear winner`,
      });
    }
  }

  return { changed: demotions.length > 0, demotions, clusters };
}
