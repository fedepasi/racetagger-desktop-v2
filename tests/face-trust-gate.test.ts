import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard for the face TRUST-threshold gate on the face-only path.
 *
 * The face-only path (skip Gemini) must require the per-category TRUST threshold
 * (matching_config.thresholds.faceTrustThreshold, default 0.60) — stricter than the
 * MATCH threshold (0.50). Matches in the [match, trust) band must fall through to
 * Gemini and stay as FACE_MATCH evidence, NOT take the face-only path with a
 * low-confidence "matched" (the wrong-number class).
 *
 * Originally a61f0c0; silently reverted by the #213 stale-base squash (which left
 * faceTrustThreshold a dead knob). This guard fails loudly if the gate is removed
 * again (e.g. the face-only path reverts to `.filter(m => m.matched)` without trust).
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'unified-image-processor.ts'),
  'utf8'
);

describe('face TRUST-threshold gate present (regression guard for the #213 revert)', () => {
  it('getFaceTrustThreshold() exists and reads matching_config.thresholds.faceTrustThreshold', () => {
    expect(SRC).toContain('private getFaceTrustThreshold()');
    expect(SRC).toContain('thresholds?.faceTrustThreshold');
  });

  it('the face-only path filters matches by the trust threshold (not just m.matched)', () => {
    expect(SRC).toContain('const faceTrustThreshold = this.getFaceTrustThreshold()');
    expect(SRC).toContain('m.similarity >= faceTrustThreshold');
    // and is no longer the un-gated form that took every match into the face-only path
    expect(SRC).not.toContain('const matchedDrivers = faceRecognitionResult.matches\n          .filter(m => m.matched)\n');
  });
});
