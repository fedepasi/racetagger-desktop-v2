/**
 * Unit tests for the JSONL upload reconciler.
 *
 * The reconciler is a recovery system that re-uploads JSONL analysis logs
 * which failed the original 15s upload window inside AnalysisLogger.finalize().
 * These tests use full dependency injection so we never touch a real
 * Supabase client or network — everything is in-memory + a tmp dir for the
 * filesystem side.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  reconcilePendingUploads,
  scheduleBackgroundReconciliation,
  readExecutionStart,
  __resetReconcilerForTests,
  ReconcilerDeps,
  ReconcileResult,
} from '../src/utils/jsonl-upload-reconciler';
import { UPLOAD_MARKER_SUFFIX } from '../src/utils/analysis-logger';

// ===========================================================================
// Helpers
// ===========================================================================

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const EXEC_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EXEC_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EXEC_3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-test-'));
}

function writeJsonl(
  dir: string,
  executionId: string,
  events: any[]
): string {
  const file = path.join(dir, `exec_${executionId}.jsonl`);
  const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(file, content);
  return file;
}

function writeMarker(jsonlPath: string): void {
  fs.writeFileSync(jsonlPath + UPLOAD_MARKER_SUFFIX, '');
}

function execStartEvent(opts: {
  executionId: string;
  userId: string;
  totalImages?: number;
  category?: string;
  timestamp?: string;
}) {
  return {
    type: 'EXECUTION_START',
    timestamp: opts.timestamp ?? '2026-04-25T20:10:00.000Z',
    executionId: opts.executionId,
    userId: opts.userId,
    totalImages: opts.totalImages ?? 100,
    category: opts.category ?? 'motorsport_v2',
  };
}

interface FakeSupabaseState {
  /** execution_ids that already have a metadata row server-side. */
  metadata: Set<string>;
  /** Storage paths uploaded during this run. */
  uploaded: Map<string, Buffer>;
  /** Inserts attempted during this run. */
  inserts: Array<{ executionId: string; storagePath: string }>;
  /** If set, supabase calls fail with this message. */
  failMode?: 'select' | 'upload' | 'insert' | 'all';
}

/**
 * Hand-rolled minimal Supabase client mock — covers only the shape the
 * reconciler actually uses. Keeps tests fast and explicit.
 */
function makeFakeSupabase(state: FakeSupabaseState): any {
  return {
    from: (table: string) => {
      if (table !== 'analysis_log_metadata') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return makeMetadataQueryBuilder(state);
    },
    storage: {
      from: (_bucket: string) => ({
        upload: async (storagePath: string, content: Buffer) => {
          if (state.failMode === 'upload' || state.failMode === 'all') {
            return { error: { message: 'fake upload failed' } };
          }
          state.uploaded.set(storagePath, content);
          return { error: null };
        },
      }),
    },
  };
}

function makeMetadataQueryBuilder(state: FakeSupabaseState): any {
  // The builder is chainable; we capture the predicate and resolve at the
  // end. This mirrors the methods the reconciler actually calls.
  let pendingExecutionIds: string[] | null = null;
  let pendingExactCountFor: string | null = null;
  let pendingInsertRows: any[] | null = null;

  const builder: any = {
    select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
      // For the count-head variant we record we expect a single eq() next.
      if (opts?.count === 'exact' && opts?.head === true) {
        pendingExactCountFor = '__pending__';
      }
      return builder;
    },
    in: async (_col: string, ids: string[]) => {
      if (state.failMode === 'select' || state.failMode === 'all') {
        return { data: null, error: { message: 'fake select failed' } };
      }
      pendingExecutionIds = ids;
      const data = ids
        .filter((id) => state.metadata.has(id))
        .map((id) => ({ execution_id: id }));
      return { data, error: null };
    },
    eq: async (_col: string, val: string) => {
      if (state.failMode === 'select' || state.failMode === 'all') {
        return { count: null, error: { message: 'fake select failed' } };
      }
      const count = state.metadata.has(val) ? 1 : 0;
      return { count, error: null };
    },
    insert: async (rows: any) => {
      if (state.failMode === 'insert' || state.failMode === 'all') {
        return { error: { message: 'fake insert failed' } };
      }
      const arr = Array.isArray(rows) ? rows : [rows];
      for (const row of arr) {
        state.inserts.push({
          executionId: row.execution_id,
          storagePath: row.storage_path,
        });
        state.metadata.add(row.execution_id);
      }
      return { error: null };
    },
  };
  return builder;
}

function buildDeps(
  overrides: Partial<ReconcilerDeps> & {
    logsDir: string;
    userId?: string | null;
    state: FakeSupabaseState;
  }
): ReconcilerDeps {
  const supabase = makeFakeSupabase(overrides.state);
  // Note: explicit `in` check rather than `??` so callers can pass `null` to
  // simulate the no-user case without it getting silently coerced back to USER_A.
  const resolvedUserId = 'userId' in overrides ? overrides.userId : USER_A;
  return {
    getLogsDir: () => overrides.logsDir,
    getSupabase: () => supabase,
    getCurrentUserId: () => resolvedUserId ?? null,
    config: {
      retryBaseMs: 1, // keep tests fast
      maxUploadRetries: 2,
      ...(overrides.config ?? {}),
    },
    log: () => {}, // silent
    now: overrides.now,
    uploadFile: overrides.uploadFile,
    insertMetadata: overrides.insertMetadata,
  } as ReconcilerDeps;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('jsonl-upload-reconciler', () => {
  let tmpDir: string;
  let state: FakeSupabaseState;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    state = {
      metadata: new Set(),
      uploaded: new Map(),
      inserts: [],
    };
    __resetReconcilerForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('preflight bail-outs', () => {
    test('no user → noop with reason no-user, no network', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      const deps = buildDeps({ logsDir: tmpDir, userId: null, state });

      const r = await reconcilePendingUploads(deps);

      expect(r.noop).toBe(true);
      expect(r.noopReason).toBe('no-user');
      expect(r.scanned).toBe(0);
      expect(state.uploaded.size).toBe(0);
      expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(false);
    });

    test('logs dir missing → noop logs-dir-missing', async () => {
      const ghostDir = path.join(tmpDir, 'does-not-exist');
      const deps = buildDeps({ logsDir: ghostDir, userId: USER_A, state });

      const r = await reconcilePendingUploads(deps);

      expect(r.noop).toBe(true);
      expect(r.noopReason).toBe('logs-dir-missing');
    });

    test('empty logs dir → scanned=0', async () => {
      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);
      expect(r.scanned).toBe(0);
      expect(r.noop).toBe(false);
    });
  });

  describe('marker fast path', () => {
    test('file with marker → alreadyUploaded, no network', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      writeMarker(file);

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.scanned).toBe(1);
      expect(r.alreadyUploaded).toBe(1);
      expect(r.uploaded).toBe(0);
      expect(state.uploaded.size).toBe(0);
      expect(state.inserts.length).toBe(0);
    });
  });

  describe('confirm-from-server path', () => {
    test('no marker, server already has metadata row → marker written, no upload', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      state.metadata.add(EXEC_1);

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.confirmedRemote).toBe(1);
      expect(r.uploaded).toBe(0);
      expect(state.uploaded.size).toBe(0);
      expect(state.inserts.length).toBe(0);
      expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(true);
    });
  });

  describe('upload happy path', () => {
    test('no marker, no remote → upload + insert + marker', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({
          executionId: EXEC_1,
          userId: USER_A,
          totalImages: 2490,
          timestamp: '2026-04-25T20:10:00.000Z',
        }),
        { type: 'IMAGE_ANALYSIS', fileName: 'a.jpg' },
      ]);

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.uploaded).toBe(1);
      expect(r.failed).toBe(0);
      expect(state.uploaded.size).toBe(1);
      const expectedPath = `${USER_A}/2026-04-25/exec_${EXEC_1}.jsonl`;
      expect(state.uploaded.has(expectedPath)).toBe(true);
      expect(state.inserts).toEqual([
        { executionId: EXEC_1, storagePath: expectedPath },
      ]);
      expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(true);
    });

    test('uploads file content byte-for-byte', async () => {
      const events = [
        execStartEvent({ executionId: EXEC_1, userId: USER_A, totalImages: 5 }),
        { type: 'IMAGE_ANALYSIS', fileName: 'a.jpg' },
        { type: 'EXECUTION_COMPLETE' },
      ];
      writeJsonl(tmpDir, EXEC_1, events);
      const deps = buildDeps({ logsDir: tmpDir, state });

      await reconcilePendingUploads(deps);

      const path1 = `${USER_A}/2026-04-25/exec_${EXEC_1}.jsonl`;
      const uploaded = state.uploaded.get(path1)!;
      const expected = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      expect(uploaded.toString('utf-8')).toBe(expected);
    });
  });

  describe('upload failure path', () => {
    test('storage upload fails after retries → counted as failed, no marker', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      state.failMode = 'upload';

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.uploaded).toBe(0);
      expect(r.failed).toBe(1);
      expect(r.errors[0]?.reason).toContain('upload failed');
      expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(false);
    });

    test('metadata insert fails → counted as failed, no marker (storage upload retried next pass via upsert)', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      state.failMode = 'insert';

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.uploaded).toBe(0);
      expect(r.failed).toBe(1);
      // Storage upload did happen (idempotent, safe to retry):
      expect(state.uploaded.size).toBe(1);
      // But no marker — next pass will see no metadata row, retry from scratch.
      expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(false);
    });
  });

  describe('invalid file handling', () => {
    test('empty file → skipped invalid', async () => {
      const file = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
      fs.writeFileSync(file, '');

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.skippedInvalid).toBeGreaterThanOrEqual(1);
      expect(r.uploaded).toBe(0);
    });

    test('malformed JSONL (no EXECUTION_START) → skipped invalid', async () => {
      const file = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
      fs.writeFileSync(file, '{"type":"NOT_A_START"}\n{"type":"IMAGE_ANALYSIS"}\n');

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.skippedInvalid).toBe(1);
      expect(r.uploaded).toBe(0);
      expect(r.errors[0]?.reason).toContain('EXECUTION_START not found');
    });

    test('file too large → skipped invalid', async () => {
      const file = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
      const start = JSON.stringify(execStartEvent({ executionId: EXEC_1, userId: USER_A }));
      fs.writeFileSync(file, start + '\n' + 'x'.repeat(2000));

      const deps = buildDeps({
        logsDir: tmpDir,
        state,
        config: { maxFileSizeBytes: 100, retryBaseMs: 1, maxUploadRetries: 1 },
      } as any);

      const r = await reconcilePendingUploads(deps);
      expect(r.skippedInvalid).toBe(1);
      expect(r.uploaded).toBe(0);
    });

    test('non-matching filename → ignored entirely (not even scanned)', async () => {
      fs.writeFileSync(path.join(tmpDir, 'random.jsonl'), 'x');
      fs.writeFileSync(path.join(tmpDir, 'exec_short.jsonl'), 'x');
      fs.writeFileSync(path.join(tmpDir, 'EXEC_NOT_HEX.jsonl'), 'x');

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.scanned).toBe(0);
      expect(r.uploaded).toBe(0);
    });
  });

  describe('multi-user safety', () => {
    test('JSONL belonging to another user → skippedOtherUser, never uploaded', async () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_B }),
      ]);

      const deps = buildDeps({ logsDir: tmpDir, userId: USER_A, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.skippedOtherUser).toBe(1);
      expect(r.uploaded).toBe(0);
      expect(state.uploaded.size).toBe(0);
      expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(false);
    });

    test('JSONL with no userId in EXECUTION_START → still uploaded for current user', async () => {
      writeJsonl(tmpDir, EXEC_1, [
        {
          type: 'EXECUTION_START',
          timestamp: '2026-04-25T20:10:00.000Z',
          executionId: EXEC_1,
          totalImages: 100,
          category: 'motorsport_v2',
          // no userId field
        },
      ]);

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.uploaded).toBe(1);
    });
  });

  describe('mixed batch', () => {
    test('three files, one already-uploaded, one server-confirmed, one new → all paths exercised', async () => {
      // File 1: locally marked
      const f1 = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      writeMarker(f1);

      // File 2: no marker, but server has the row
      writeJsonl(tmpDir, EXEC_2, [
        execStartEvent({ executionId: EXEC_2, userId: USER_A }),
      ]);
      state.metadata.add(EXEC_2);

      // File 3: cold — needs upload
      writeJsonl(tmpDir, EXEC_3, [
        execStartEvent({ executionId: EXEC_3, userId: USER_A }),
      ]);

      const deps = buildDeps({ logsDir: tmpDir, state });
      const r = await reconcilePendingUploads(deps);

      expect(r.scanned).toBe(3);
      expect(r.alreadyUploaded).toBe(1);
      expect(r.confirmedRemote).toBe(1);
      expect(r.uploaded).toBe(1);
      expect(r.failed).toBe(0);
      expect(state.uploaded.size).toBe(1);
      expect(state.inserts.length).toBe(1);
    });
  });

  describe('concurrency guard', () => {
    test('concurrent calls coalesce to a single pass', async () => {
      writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);

      let uploadCalls = 0;
      const slowUpload: any = async () => {
        uploadCalls++;
        await new Promise((r) => setTimeout(r, 25));
        return { success: true };
      };

      const deps = buildDeps({
        logsDir: tmpDir,
        state,
        uploadFile: slowUpload,
      });

      const [a, b, c] = await Promise.all([
        reconcilePendingUploads(deps),
        reconcilePendingUploads(deps),
        reconcilePendingUploads(deps),
      ]);

      // All three resolved with the same instance:
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(uploadCalls).toBe(1);
    });
  });

  describe('idempotency', () => {
    test('two sequential passes — second is a no-op (marker fast path)', async () => {
      writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({ executionId: EXEC_1, userId: USER_A }),
      ]);
      const deps = buildDeps({ logsDir: tmpDir, state });

      const first = await reconcilePendingUploads(deps);
      __resetReconcilerForTests();
      const second = await reconcilePendingUploads(deps);

      expect(first.uploaded).toBe(1);
      expect(second.uploaded).toBe(0);
      expect(second.alreadyUploaded).toBe(1);
      expect(state.uploaded.size).toBe(1); // still just the original upload
    });
  });

  describe('readExecutionStart', () => {
    test('parses a valid EXECUTION_START line', () => {
      const file = writeJsonl(tmpDir, EXEC_1, [
        execStartEvent({
          executionId: EXEC_1,
          userId: USER_A,
          totalImages: 42,
          category: 'motorsport_v2',
        }),
      ]);
      const r = readExecutionStart(file);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.userId).toBe(USER_A);
        expect(r.totalImages).toBe(42);
        expect(r.category).toBe('motorsport_v2');
      }
    });

    test('skips garbage lines and finds EXECUTION_START further down', () => {
      const file = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
      const content =
        'not-json\n' +
        '{"type":"OTHER"}\n' +
        JSON.stringify(execStartEvent({ executionId: EXEC_1, userId: USER_A })) +
        '\n';
      fs.writeFileSync(file, content);

      const r = readExecutionStart(file);
      expect(r.ok).toBe(true);
    });

    test('returns parse error when EXECUTION_START is absent', () => {
      const file = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
      fs.writeFileSync(file, '{"type":"IMAGE_ANALYSIS"}\n');
      const r = readExecutionStart(file);
      expect(r.ok).toBe(false);
    });
  });
});

// ===========================================================================
// scheduleBackgroundReconciliation tests
// ===========================================================================

describe('scheduleBackgroundReconciliation', () => {
  let tmpDir: string;
  let state: FakeSupabaseState;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    state = { metadata: new Set(), uploaded: new Map(), inserts: [] };
    __resetReconcilerForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('debounces repeated calls within 30s window', (done) => {
    writeJsonl(tmpDir, EXEC_1, [
      execStartEvent({ executionId: EXEC_1, userId: USER_A }),
    ]);

    let nowValue = 1000;
    const deps = buildDeps({ logsDir: tmpDir, state, now: () => nowValue });

    scheduleBackgroundReconciliation(deps, { reason: 'first' });
    nowValue += 5_000; // advance 5s — still within 30s debounce
    scheduleBackgroundReconciliation(deps, { reason: 'second' });
    nowValue += 10_000; // 15s total — still within 30s
    scheduleBackgroundReconciliation(deps, { reason: 'third' });

    // Allow the setImmediate microtask + a real upload tick to flush
    setTimeout(() => {
      // Only the first one was fired — and its in-flight guard makes it
      // run exactly once even if the inner promise is still resolving.
      expect(state.uploaded.size).toBeLessThanOrEqual(1);
      done();
    }, 50);
  });

  test('force=true bypasses debounce', (done) => {
    writeJsonl(tmpDir, EXEC_1, [
      execStartEvent({ executionId: EXEC_1, userId: USER_A }),
    ]);

    let nowValue = 1000;
    const deps = buildDeps({ logsDir: tmpDir, state, now: () => nowValue });

    scheduleBackgroundReconciliation(deps, { reason: 'first' });
    setTimeout(() => {
      __resetReconcilerForTests();
      nowValue += 1000; // 1s later — would normally be debounced
      scheduleBackgroundReconciliation(deps, { reason: 'forced', force: true });
      setTimeout(() => {
        // The forced call ran a second pass — same exec already has marker
        // from the first pass, so we expect alreadyUploaded path on rerun.
        // The point of the test is just that we DID run twice (no exception).
        expect(state.uploaded.size).toBe(1);
        done();
      }, 50);
    }, 30);
  });

  test('caller-side exception in deps does not crash the trigger', (done) => {
    const deps: ReconcilerDeps = {
      getLogsDir: () => {
        throw new Error('boom');
      },
      getSupabase: () => ({} as any),
      getCurrentUserId: () => USER_A,
      log: () => {},
    };

    expect(() => scheduleBackgroundReconciliation(deps, { reason: 'test' })).not.toThrow();
    setTimeout(() => done(), 30);
  });
});
