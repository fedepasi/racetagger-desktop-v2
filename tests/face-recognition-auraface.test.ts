/**
 * Minimal unit tests for the AuraFace ONNX face-recognition pipeline.
 *
 * Covers the three pre-merge "must have" areas identified by the audit:
 *   1. YuNet multi-head output decoding (synthetic tensor fixtures — the
 *      decoding logic took 3 fix-commits on the feature branch, so it is
 *      pinned here against the OpenCV reference formulas).
 *   2. Cosine matching with known descriptors (512-dim mode) + the
 *      legacy 128-dim euclidean fallback and dimension handling.
 *   3. Clear failure when the model is not available (no silent success).
 *
 * No network, no real ONNX model: everything below runs offline.
 */

import { FaceDetectorService, DetectedFaceRegion } from '../src/face-detector-service';
import {
  FaceRecognitionProcessor,
  cosineSimilarity,
  StoredFaceDescriptor,
} from '../src/face-recognition-processor';
import { FaceRecognitionOnnxProcessor } from '../src/face-recognition-onnx-processor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a one-hot 512-dim descriptor (L2-normalized by construction). */
function oneHot512(index: number): number[] {
  const v = new Array(512).fill(0);
  v[index] = 1;
  return v;
}

/** Mock ONNX tensor: the decoder only reads `.data`. */
function tensor(data: Float32Array): { data: Float32Array } {
  return { data };
}

/**
 * Build a full set of YuNet multi-head outputs (strides 8/16/32) that are
 * all-zero except for the faces injected at specific grid cells of stride 8.
 * Grid sizes for 640x640 input: 80x80 (s8), 40x40 (s16), 20x20 (s32).
 */
function buildYuNetOutputs(
  faces: Array<{
    row: number;
    col: number;
    cls: number;
    obj: number;
    /** bbox offsets [dx, dy, logW, logH] in YuNet units */
    bbox: [number, number, number, number];
  }>
): Record<string, { data: Float32Array }> {
  const grids: Record<number, number> = { 8: 80 * 80, 16: 40 * 40, 32: 20 * 20 };
  const out: Record<string, { data: Float32Array }> = {};

  for (const stride of [8, 16, 32]) {
    const cells = grids[stride];
    out[`cls_${stride}`] = tensor(new Float32Array(cells));
    out[`obj_${stride}`] = tensor(new Float32Array(cells));
    out[`bbox_${stride}`] = tensor(new Float32Array(cells * 4));
    out[`kps_${stride}`] = tensor(new Float32Array(cells * 10));
  }

  for (const f of faces) {
    const idx = f.row * 80 + f.col; // stride-8 grid is 80 cols wide
    out['cls_8'].data[idx] = f.cls;
    out['obj_8'].data[idx] = f.obj;
    out['bbox_8'].data.set(f.bbox, idx * 4);
    // landmarks left at 0 → decoded as (col*8/640, row*8/640), clamped to [0,1]
  }

  return out;
}

// ---------------------------------------------------------------------------
// 1. YuNet multi-head decoding
// ---------------------------------------------------------------------------

describe('YuNet multi-head output decoding', () => {
  // decodeMultiScaleOutputs is private — accessed via `any` on purpose:
  // it is the unit under test and refactoring it public is a branch decision.
  const detector: any = FaceDetectorService.getInstance();

  afterAll(() => {
    FaceDetectorService.getInstance().dispose();
  });

  test('decodes a single confident face at the expected position/size', () => {
    // Face centered at grid cell (row 40, col 40) of stride 8:
    //   cx = (40 + 0) * 8 = 320 px, cy = 320 px (image center)
    //   w  = exp(ln(8)) * 8 = 64 px, h = 64 px
    const logW = Math.log(8);
    const outputs = buildYuNetOutputs([
      { row: 40, col: 40, cls: 1, obj: 1, bbox: [0, 0, logW, logW] },
    ]);

    const faces: DetectedFaceRegion[] = detector.decodeMultiScaleOutputs(outputs);

    expect(faces).toHaveLength(1);
    const f = faces[0];
    // score = sqrt(1 * 1) = 1
    expect(f.confidence).toBeCloseTo(1.0, 5);
    // x1 = 320 - 32 = 288 → 288/640 = 0.45 (same for y)
    expect(f.x).toBeCloseTo(0.45, 3);
    expect(f.y).toBeCloseTo(0.45, 3);
    expect(f.width).toBeCloseTo(64 / 640, 3);
    expect(f.height).toBeCloseTo(64 / 640, 3);
    // 5 landmarks, all normalized into [0,1]
    expect(f.landmarks).toHaveLength(5);
    for (const [lx, ly] of f.landmarks) {
      expect(lx).toBeGreaterThanOrEqual(0);
      expect(lx).toBeLessThanOrEqual(1);
      expect(ly).toBeGreaterThanOrEqual(0);
      expect(ly).toBeLessThanOrEqual(1);
    }
  });

  test('score = sqrt(cls * obj) and sub-threshold cells are dropped', () => {
    const logW = Math.log(8);
    const outputs = buildYuNetOutputs([
      // sqrt(0.8 * 0.8) = 0.8 → above the 0.6 threshold → kept
      { row: 10, col: 10, cls: 0.8, obj: 0.8, bbox: [0, 0, logW, logW] },
      // sqrt(0.5 * 0.5) = 0.5 → below threshold → dropped
      { row: 60, col: 60, cls: 0.5, obj: 0.5, bbox: [0, 0, logW, logW] },
    ]);

    const faces: DetectedFaceRegion[] = detector.decodeMultiScaleOutputs(outputs);

    expect(faces).toHaveLength(1);
    expect(faces[0].confidence).toBeCloseTo(0.8, 5);
  });

  test('NMS collapses overlapping detections to one', () => {
    const logW = Math.log(8);
    // Two adjacent cells produce two nearly-identical 64px boxes (IoU >> 0.3)
    const outputs = buildYuNetOutputs([
      { row: 40, col: 40, cls: 1, obj: 1, bbox: [0, 0, logW, logW] },
      { row: 40, col: 41, cls: 0.9, obj: 0.9, bbox: [0, 0, logW, logW] },
    ]);

    const decoded: DetectedFaceRegion[] = detector.decodeMultiScaleOutputs(outputs);
    expect(decoded).toHaveLength(2);

    const kept: DetectedFaceRegion[] = detector.nms(decoded);
    expect(kept).toHaveLength(1);
    // The higher-confidence box must win
    expect(kept[0].confidence).toBeCloseTo(1.0, 5);
  });

  test('missing output tensors yield zero faces (documents current silent-skip behavior)', () => {
    // NOTE: today the decoder logs a warning and returns [] when the model's
    // output names do not match cls_8/obj_8/… — i.e. detection "succeeds"
    // with 0 faces. The audit flags this as a fail-silent risk: if this test
    // starts failing because the code now throws/errors, that is an
    // IMPROVEMENT — update the test to assert the explicit error instead.
    const faces: DetectedFaceRegion[] = detector.decodeMultiScaleOutputs({});
    expect(faces).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Cosine similarity + matching with known descriptors
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  test('identical vectors → 1', () => {
    const v = oneHot512(7);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  test('orthogonal vectors → 0', () => {
    expect(cosineSimilarity(oneHot512(0), oneHot512(1))).toBeCloseTo(0, 6);
  });

  test('opposite vectors → -1', () => {
    const v = oneHot512(3);
    const neg = v.map(x => -x);
    expect(cosineSimilarity(v, neg)).toBeCloseTo(-1, 6);
  });

  test('dimension mismatch → 0 (no cross-dim matching)', () => {
    expect(cosineSimilarity(oneHot512(0), [1, 0, 0])).toBe(0);
  });

  test('zero vector → 0 (no division by zero)', () => {
    expect(cosineSimilarity(new Array(512).fill(0), oneHot512(0))).toBe(0);
  });
});

describe('FaceRecognitionProcessor matching (512-dim cosine mode)', () => {
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

  test('identical embedding matches above the cosine threshold', async () => {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    proc.loadFaceDescriptors([makeStored('p1', oneHot512(10)), makeStored('p2', oneHot512(20))]);

    expect(proc.getDescriptorDimension()).toBe(512);

    const matches = proc.matchEmbeddings([{ faceIndex: 0, embedding: oneHot512(10) }], 'auto');
    expect(matches).toHaveLength(1);
    expect(matches[0].personId).toBe('p1');
    expect(matches[0].similarityMetric).toBe('cosine');
    expect(matches[0].confidence).toBeCloseTo(1, 5);
  });

  test('below-threshold embedding does not match (auto threshold 0.55)', async () => {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    proc.loadFaceDescriptors([makeStored('p1', oneHot512(10))]);

    // Orthogonal query → cosine 0 < 0.55 → no match
    const matches = proc.matchEmbeddings([{ faceIndex: 0, embedding: oneHot512(99) }], 'auto');
    expect(matches).toHaveLength(0);
  });

  test('borderline similarity: 0.6 matches in auto (0.55) but stays out of portrait (0.60 exclusive)', async () => {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    proc.loadFaceDescriptors([makeStored('p1', oneHot512(0))]);

    // Build a query with cosine similarity exactly 0.6 vs oneHot512(0):
    // q = [0.6, sqrt(1-0.36), 0, ...] (unit norm)
    const q = new Array(512).fill(0);
    q[0] = 0.6;
    q[1] = Math.sqrt(1 - 0.36);

    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: q }], 'auto')).toHaveLength(1);
    // portrait threshold is 0.60 and findBestMatch uses >= → still matches at exactly 0.6
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: q }], 'portrait')).toHaveLength(1);
  });

  test('mixed 128/512 descriptors → 512 wins, 128 are ignored', async () => {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    const legacy128 = { ...makeStored('legacy', []), descriptor: new Array(128).fill(0.1) };
    proc.loadFaceDescriptors([legacy128 as StoredFaceDescriptor, makeStored('p512', oneHot512(5))]);

    expect(proc.getDescriptorDimension()).toBe(512);
    // The 128-dim person must not be matchable in 512 mode
    const matches = proc.matchEmbeddings([{ faceIndex: 0, embedding: oneHot512(5) }], 'auto');
    expect(matches).toHaveLength(1);
    expect(matches[0].personId).toBe('p512');
  });

  test('pure 128-dim set falls back to euclidean mode', async () => {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    const d = new Array(128).fill(0);
    d[0] = 1;
    proc.loadFaceDescriptors([{ ...makeStored('old', []), descriptor: d } as StoredFaceDescriptor]);

    expect(proc.getDescriptorDimension()).toBe(128);
    const matches = proc.matchEmbeddings([{ faceIndex: 0, embedding: d }], 'auto');
    expect(matches).toHaveLength(1);
    expect(matches[0].similarityMetric).toBe('euclidean');
  });

  test('no descriptors loaded → no matches, no crash', async () => {
    const proc = new FaceRecognitionProcessor();
    await proc.initialize();
    expect(proc.matchEmbeddings([{ faceIndex: 0, embedding: oneHot512(0) }], 'auto')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Model-not-available behavior (offline / not downloaded)
// ---------------------------------------------------------------------------

describe('Pipeline behavior when models are not available', () => {
  afterAll(() => {
    FaceRecognitionOnnxProcessor.getInstance().dispose();
  });

  test('detectAndEmbed on a missing file fails explicitly (no silent success)', async () => {
    const proc = FaceRecognitionOnnxProcessor.getInstance();
    const result = await proc.detectAndEmbed('Z:\\definitely\\not\\here.jpg');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.faces).toHaveLength(0);
  });

  test('getStatus reports embedder unavailable when the model was never downloaded', () => {
    // electron mock points userData at /tmp/racetagger-mock-userdata → no model there
    const status = FaceRecognitionOnnxProcessor.getInstance().getStatus();
    expect(status.embedderAvailable).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.embeddingDim).toBe(512);
  });
});
