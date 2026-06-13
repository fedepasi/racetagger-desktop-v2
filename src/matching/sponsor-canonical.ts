/**
 * ACC-04: Canonical sponsor normalisation + clustering helpers.
 *
 * All functions are PURE (no side-effects, no Supabase, no Electron IPC).
 * SmartMatcher delegates here instead of carrying the logic inline so that
 * both main-process code and tests can import this module independently.
 *
 * Umlaut transliteration is bidirectional so a stored "DOERR" matches
 * a detected "DÖRR" and vice versa, regardless of which direction the
 * user entered or the AI detected.
 */

// ── Umlaut transliteration tables ──────────────────────────────────────────
const UMLAUT_TO_ASCII: [RegExp, string][] = [
  [/ä/g, 'ae'], [/ö/g, 'oe'], [/ü/g, 'ue'],
  [/Ä/g, 'ae'], [/Ö/g, 'oe'], [/Ü/g, 'ue'], [/ß/g, 'ss'],
];

const ASCII_TO_UMLAUT: [RegExp, string][] = [
  [/ae/g, 'ä'], [/oe/g, 'ö'], [/ue/g, 'ü'], [/ss/g, 'ß'],
];

/**
 * Suffixes that should be stripped before comparing (so "DÖRR Motorsport"
 * and "DÖRR" share the same base key and cluster together).
 */
const GENERIC_SUFFIXES = [
  'motorsport', 'motor sport', 'racing', 'team', 'competition', 'competizione',
  'sport', 'grand prix', 'gp', 'autosport', 'motorsport ag', 'racing team',
];

// ── Core normalisation ──────────────────────────────────────────────────────

/**
 * Full normalisation pipeline (NFD diacritic strip → umlaut ASCII expansion
 * → lowercase → whitespace collapse → trim).
 *
 * Equivalent to SmartMatcher.normalizeSponsorValue but exported and testable.
 * SmartMatcher delegates to this function.
 */
export function normalizeSponsor(value: string): string {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')   // strip combining marks (ä → a, ö → o …)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical key: expand umlauts to ASCII FIRST (before NFD strips them),
 * then normalize, then strip generic suffixes.
 *
 * "DÖRR" → "doerr", "DOERR" → "doerr" → same key.
 * "DÖRR Motorsport" → "doerr" (suffix stripped).
 *
 * Used as the dedup/cluster key; NOT intended for display.
 * ORDER MATTERS: umlaut expansion must precede NFD normalization, because
 * NFD strips the combining diacritic marks that make ö recognizable as ö.
 */
export function canonicalKey(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  // Step 1: expand umlauts → ASCII BEFORE NFD strips the combining marks
  let s = String(raw);
  for (const [re, replacement] of UMLAUT_TO_ASCII) {
    s = s.replace(re, replacement);
  }

  // Step 2: NFD diacritic strip + lowercase + whitespace collapse
  s = normalizeSponsor(s);

  // Step 3: strip generic suffixes from the end
  for (const suffix of GENERIC_SUFFIXES) {
    if (s.endsWith(' ' + suffix)) {
      s = s.slice(0, s.length - suffix.length - 1).trimEnd();
    }
  }

  return s.trim();
}

// ── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Fuzzy match (exported for SmartMatcher delegation) ────────────────────────

/**
 * Fuzzy sponsor match used at MATCH TIME (i.e. comparing a detected sponsor
 * value against a known sponsor or an ignore-list entry).
 *
 * Accepts already-normalized inputs (lower-case, ASCII-expanded).
 * Rules (in order):
 *   1. Exact key equality
 *   2. Bidirectional substring with ≥3-char shorter-string guard
 *   3. Per-word Levenshtein ≤2 on words ≥4 chars
 *   4. Umlaut flip: if ascii→umlaut transliteration makes them equal
 */
export function isFuzzySponsorMatch(a: string, b: string): boolean {
  if (!a || !b) return false;

  // Work on canonical keys so umlauts don't defeat equality
  const ka = canonicalKey(a);
  const kb = canonicalKey(b);

  if (ka === kb) return true;

  // Bidirectional substring (≥3 char guard on the shorter)
  const shorter = Math.min(ka.length, kb.length);
  if (shorter >= 3 && (ka.includes(kb) || kb.includes(ka))) return true;

  // Per-word Levenshtein ≤ 2 on words ≥ 4 chars
  const wordsA = ka.split(/\s+/).filter(w => w.length >= 4);
  const wordsB = kb.split(/\s+/).filter(w => w.length >= 4);
  for (const wa of wordsA) {
    for (const wb of wordsB) {
      if (levenshtein(wa, wb) <= 2) return true;
    }
  }

  return false;
}

// ── Clustering ────────────────────────────────────────────────────────────────

export interface SponsorCluster {
  key: string;          // canonical key shared by all members
  members: string[];    // original display strings that belong to this cluster
  count: number;        // total occurrence count across all members
}

/**
 * Cluster a frequency map of sponsor display strings into dedup groups.
 *
 * Input: Map<displayString, occurrenceCount>
 * Output: one SponsorCluster per distinct canonical key.
 *
 * Clusters are built greedily: each display string is compared against
 * existing cluster keys (via `isFuzzySponsorMatch`); if it matches, it joins
 * that cluster; otherwise it starts a new one.
 */
export function clusterSponsors(freq: Map<string, number>): SponsorCluster[] {
  const clusters: SponsorCluster[] = [];

  for (const [display, count] of freq) {
    const key = canonicalKey(display);
    if (!key) continue;

    const existing = clusters.find(c => isFuzzySponsorMatch(c.key, key));
    if (existing) {
      existing.members.push(display);
      existing.count += count;
    } else {
      clusters.push({ key, members: [display], count });
    }
  }

  return clusters;
}

/**
 * Pick the best display string from a cluster's members.
 *
 * Priority:
 *   1. The member with the most occurrences (if the frequency map is passed)
 *   2. The shortest member (less likely to be a variant with extra words)
 *   3. Fall back to the first member
 */
export function pickDisplay(cluster: SponsorCluster, freq?: Map<string, number>): string {
  if (cluster.members.length === 1) return cluster.members[0];

  if (freq) {
    const byFreq = [...cluster.members].sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
    return byFreq[0];
  }

  return cluster.members.reduce((best, m) => m.length < best.length ? m : best, cluster.members[0]);
}

// ── Series-sponsor detection (dry-run, no writes) ─────────────────────────────

export interface SeriesSponsorCandidate {
  display: string;           // best display string for this cluster
  key: string;               // canonical key
  coverageFraction: number;  // 0–1: fraction of participants that carry this sponsor
  totalCount: number;        // total occurrences across the batch
}

/**
 * From the final per-image sponsor frequency map (accumulated across ALL
 * detected vehicles in a batch), identify candidates that look like
 * series-wide / generic sponsors.
 *
 * Returns candidates sorted by coverage descending. The caller decides
 * what to show as "pre-checked" (high band) vs "suggested" (lower band).
 *
 * @param freq      Map<displayString, totalOccurrenceCount> across all images
 * @param totalCars The total number of distinct matched cars in the batch
 * @param opts      Detection thresholds (with conservative defaults)
 */
export function detectSeriesSponsors(
  freq: Map<string, number>,
  totalCars: number,
  opts: {
    minCoverage?: number;   // default 0.40 — below this, never a candidate
    preCheckMin?: number;   // default 0.70 — above this, pre-checked in UI
    minCars?: number;       // default 4   — skip detection for tiny batches
  } = {}
): SeriesSponsorCandidate[] {
  const { minCoverage = 0.40, preCheckMin: _preCheckMin = 0.70, minCars = 4 } = opts;

  if (totalCars < minCars || freq.size === 0) return [];

  const clusters = clusterSponsors(freq);
  const candidates: SeriesSponsorCandidate[] = [];

  for (const cluster of clusters) {
    const coverage = cluster.count / totalCars;
    if (coverage < minCoverage) continue;

    candidates.push({
      display: pickDisplay(cluster, freq),
      key: cluster.key,
      coverageFraction: coverage,
      totalCount: cluster.count,
    });
  }

  return candidates.sort((a, b) => b.coverageFraction - a.coverageFraction);
}
