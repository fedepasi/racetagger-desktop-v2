import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard for the FACE DIVERGENCE GUARD in SmartMatcher.finalizeMatch.
 *
 * When a confident face match (cosine >= faceTrustThreshold) belongs to a driver
 * who is NOT on the number-matched winning participant, finalizeMatch must downgrade
 * matchStatus from 'matched' to 'needs_review' rather than silently returning a wrong
 * 'matched' — the real "matched but wrong" trust-breaker (Gruppe C, ~16.2%).
 *
 * Originally added by a61f0c0, then silently reverted by the #213 stale-base squash
 * (b5368725) — `faceTrustThreshold` was left plumbed in sport-config.ts but became a
 * dead knob with no consumer. This guard fails loudly if the divergence block (and
 * the `let matchStatus` it needs to reassign) is removed again.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'matching', 'smart-matcher.ts'),
  'utf8'
);

describe('FACE DIVERGENCE GUARD present in finalizeMatch (regression guard for the #213 revert)', () => {
  it('the divergence-guard block exists', () => {
    expect(SRC).toContain('FACE DIVERGENCE GUARD');
  });

  it('matchStatus is reassignable (let, not const) so the guard can downgrade to needs_review', () => {
    expect(SRC).toContain('let matchStatus: MatchStatus');
    expect(SRC).not.toContain('const matchStatus: MatchStatus = !resolvedResult.bestMatch');
  });

  it('the guard consumes faceTrustThreshold (no longer a dead knob)', () => {
    expect(SRC).toContain('faceTrustThreshold');
    expect(SRC).toContain("matchStatus = 'needs_review'");
  });
});
