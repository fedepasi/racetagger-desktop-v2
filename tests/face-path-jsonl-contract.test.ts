import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard for the face-recognition JSONL-logging contract.
 *
 * Bug (execution d2780c43, app 1.1.10, tester Luca Martini): the face-only path in
 * `UnifiedImageWorker.processImage` writes its `analysis_results` row directly via
 * `this.supabase` but logged the JSONL IMAGE_ANALYSIS event only inside
 * `if (this.analysisLogger)` and returned NO `pendingLogEntry`. Pool workers are
 * created before the per-execution logger exists, so on the pool path
 * `this.analysisLogger` is undefined → the JSONL write silently no-ops while the DB
 * insert still lands. Result: 272/507 face-matched images persisted to the DB but
 * vanished from the JSONL / desktop review gallery.
 *
 * The fix mirrors the scene-skip path: build the log payload as a named const, keep
 * the legacy/non-pool direct write under `if (this.analysisLogger)`, and ALWAYS
 * return it as `pendingLogEntry` so the main process writes it for pool workers (see
 * the `if (usePool && result.pendingLogEntry && this.analysisLogger)` consumer).
 *
 * Why a source-level guard instead of a behavioural test: `processImage` is a deep
 * method with heavy supabase/auth/onnx/sharp dependencies that is impractical to
 * exercise in isolation. The original fix (PR #205) was silently reverted by PR #213
 * (commit b5368725, a stale-base squash) with no test to catch it — this guard
 * exists precisely to make that regression class fail loudly in CI.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'unified-image-processor.ts'),
  'utf8'
);

/** Extract the object literal of the success `return { ... }` that contains `marker`. */
function enclosingReturnBlock(src: string, marker: string): string {
  const markerIdx = src.indexOf(marker);
  expect(markerIdx).toBeGreaterThan(-1); // the path itself must still exist
  const returnIdx = src.lastIndexOf('return {', markerIdx);
  expect(returnIdx).toBeGreaterThan(-1);
  const endIdx = src.indexOf('};', markerIdx);
  expect(endIdx).toBeGreaterThan(-1);
  return src.slice(returnIdx, endIdx + 2);
}

describe('face-only path JSONL contract (regression guard for the PR #205 → PR #213 revert)', () => {
  it('the face-only success return carries a pendingLogEntry', () => {
    const block = enclosingReturnBlock(SRC, 'faceRecognitionUsed: true');
    // sanity: we located the right return
    expect(block).toContain('faceRecognitionUsed: true');
    // the contract: without this, pool-worker face images never reach the JSONL
    expect(block).toContain('pendingLogEntry');
  });

  it('the scene-skip success return carries a pendingLogEntry (the pattern the face path mirrors)', () => {
    // Reference invariant — documents the contract the face path must follow.
    expect(SRC).toContain('pendingLogEntry: skipPendingLogEntry');
  });
});
