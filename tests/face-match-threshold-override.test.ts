/**
 * Regression test for wiring the per-sport-category `faceMatchThreshold`.
 *
 * Bug (found 2026-06-30): `matching_config.thresholds.faceMatchThreshold` is read
 * into the sport config (matching/sport-config.ts) but the live face path called
 * `faceRecognitionProcessor.matchEmbeddings(embeddings, context)` WITHOUT the
 * override, so the matcher always used the hardcoded per-context default (0.50
 * cosine) and the per-category threshold had no effect. The override existed only
 * as an unused 3rd param of `matchEmbeddingsDetailed`.
 *
 * Fix: `matchEmbeddings()` accepts and forwards `matchThresholdOverride`, and the
 * call site passes the sport category's `faceMatchThreshold`.
 *
 * These are real behavioural unit tests on FaceRecognitionProcessor (512-dim
 * cosine mode), mirroring tests/face-recognition-auraface.test.ts.
 */

import { FaceRecognitionProcessor, StoredFaceDescriptor } from '../src/face-recognition-processor';

/** One-hot 512-dim descriptor (L2-normalized by construction). */
function oneHot512(index: number): number[] {
  const v = new Array(512).fill(0);
  v[index] = 1;
  return v;
}

function makeStored(personId: string, descriptor: number[]): StoredFaceDescriptor {
  return {
    id: `test-${personId}`,
    personId,
    personName: `Driver ${personId}`,
    team: 'Test Team',
    carNumber: '38',
    descriptor,
    source: 'preset',
    descriptorDim: descriptor.length,
  } as StoredFaceDescriptor;
}

/** Query vector with cosine similarity exactly 0.6 vs oneHot512(0). */
function query06(): number[] {
  const q = new Array(512).fill(0);
  q[0] = 0.6;
  q[1] = Math.sqrt(1 - 0.36);
  return q;
}

describe('matchEmbeddings honours the per-category faceMatchThreshold override', () => {
  async function procWithOneFace(): Promise<FaceRecognitionProcessor> {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    proc.loadFaceDescriptors([makeStored('p1', oneHot512(0))]);
    return proc;
  }

  it('default auto threshold (0.55) matches a 0.6-similarity face', async () => {
    const proc = await procWithOneFace();
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: query06() }], 'auto')).toHaveLength(1);
  });

  it('a stricter per-category override (0.7) rejects the same 0.6 face', async () => {
    const proc = await procWithOneFace();
    // Before the fix this 3rd arg does not exist → matchEmbeddings ignores the
    // category threshold and the 0.6 face still matches (length 1). After the fix
    // the override is honoured and the face is rejected (length 0).
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: query06() }], 'auto', 0.7)).toHaveLength(0);
  });

  it('a looser per-category override (0.5) still matches the 0.6 face', async () => {
    const proc = await procWithOneFace();
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: query06() }], 'auto', 0.5)).toHaveLength(1);
  });

  it('an out-of-range override is ignored (falls back to the default)', async () => {
    const proc = await procWithOneFace();
    // 0 / >1 are invalid → default 0.55 applies → the 0.6 face matches
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: query06() }], 'auto', 0)).toHaveLength(1);
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: query06() }], 'auto', 1.5)).toHaveLength(1);
  });
});
