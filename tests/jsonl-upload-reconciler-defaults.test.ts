/**
 * Integration tests for the reconciler's default upload + metadata insert
 * implementations. These bypass the dependency-injection seam used elsewhere
 * and instead exercise the real `defaultUpload` / `defaultInsertMetadata`
 * codepaths against a hand-rolled Supabase client mock that mirrors
 * @supabase/supabase-js call shapes.
 *
 * Why a separate file?  The other test file injects custom upload/insert
 * functions to keep its tests focused. Here we want to lock in the wire
 * format: that we call `.storage.from('analysis-logs').upload(path, content, opts)`
 * and `.from('analysis_log_metadata').select(...).eq().insert()` exactly as
 * the production Supabase API expects.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  reconcilePendingUploads,
  __resetReconcilerForTests,
  ReconcilerDeps,
} from '../src/utils/jsonl-upload-reconciler';
import { UPLOAD_MARKER_SUFFIX } from '../src/utils/analysis-logger';

const USER_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const EXEC_1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

interface UploadCall {
  path: string;
  options: any;
  bytes: number;
}

interface SelectCall {
  table: string;
  cols: string;
  options: any;
  filter?: { col: string; vals?: string[]; val?: string };
}

interface InsertCall {
  table: string;
  row: any;
}

function makeRealisticSupabase(opts: {
  rowsPresent?: string[];
  uploadError?: string;
  selectError?: string;
  insertError?: string;
  uploadCalls: UploadCall[];
  selectCalls: SelectCall[];
  insertCalls: InsertCall[];
}): any {
  const rowsPresent = new Set(opts.rowsPresent ?? []);

  return {
    from: (table: string) => {
      const builder: any = {
        _table: table,
        _selectCols: undefined,
        _selectOpts: undefined,
        select: function (cols: string, options: any) {
          this._selectCols = cols;
          this._selectOpts = options;
          return this;
        },
        in: async function (col: string, vals: string[]) {
          opts.selectCalls.push({
            table,
            cols: this._selectCols,
            options: this._selectOpts,
            filter: { col, vals },
          });
          if (opts.selectError) {
            return { data: null, error: { message: opts.selectError } };
          }
          const data = vals
            .filter((v) => rowsPresent.has(v))
            .map((v) => ({ execution_id: v }));
          return { data, error: null };
        },
        eq: async function (col: string, val: string) {
          opts.selectCalls.push({
            table,
            cols: this._selectCols,
            options: this._selectOpts,
            filter: { col, val },
          });
          if (opts.selectError) {
            return { count: null, error: { message: opts.selectError } };
          }
          const count = rowsPresent.has(val) ? 1 : 0;
          return { count, error: null };
        },
        insert: async function (row: any) {
          opts.insertCalls.push({ table, row });
          if (opts.insertError) {
            return { error: { message: opts.insertError } };
          }
          return { error: null };
        },
      };
      return builder;
    },
    storage: {
      from: (_bucket: string) => ({
        upload: async (storagePath: string, content: Buffer, options: any) => {
          opts.uploadCalls.push({
            path: storagePath,
            options,
            bytes: content.length,
          });
          if (opts.uploadError) {
            return { error: { message: opts.uploadError } };
          }
          return { error: null };
        },
      }),
    },
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reconciler-defaults-'));
}

function writeJsonl(dir: string, executionId: string, events: any[]): string {
  const file = path.join(dir, `exec_${executionId}.jsonl`);
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

describe('reconciler default implementations (Supabase wire shape)', () => {
  let tmpDir: string;
  let uploadCalls: UploadCall[];
  let selectCalls: SelectCall[];
  let insertCalls: InsertCall[];

  beforeEach(() => {
    tmpDir = makeTmpDir();
    uploadCalls = [];
    selectCalls = [];
    insertCalls = [];
    __resetReconcilerForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('happy path: SELECT in, then upload(), then SELECT eq(), then insert(), exact wire shape', async () => {
    const file = writeJsonl(tmpDir, EXEC_1, [
      {
        type: 'EXECUTION_START',
        timestamp: '2026-04-25T20:10:00.000Z',
        executionId: EXEC_1,
        userId: USER_A,
        totalImages: 2490,
        category: 'motorsport_v2',
      },
    ]);

    const supabase = makeRealisticSupabase({
      rowsPresent: [], // none yet
      uploadCalls,
      selectCalls,
      insertCalls,
    });

    const deps: ReconcilerDeps = {
      getLogsDir: () => tmpDir,
      getSupabase: () => supabase,
      getCurrentUserId: () => USER_A,
      log: () => {},
      config: { retryBaseMs: 1, maxUploadRetries: 1 },
    };

    const r = await reconcilePendingUploads(deps);

    expect(r.uploaded).toBe(1);
    expect(r.failed).toBe(0);

    // 1) Initial in() query for batched metadata existence check
    expect(selectCalls[0]).toMatchObject({
      table: 'analysis_log_metadata',
      filter: { col: 'execution_id', vals: [EXEC_1] },
    });
    expect(selectCalls[0].cols).toBe('execution_id');

    // 2) Storage upload with the correct path + options
    expect(uploadCalls).toHaveLength(1);
    const expectedPath = `${USER_A}/2026-04-25/exec_${EXEC_1}.jsonl`;
    expect(uploadCalls[0]).toMatchObject({
      path: expectedPath,
      options: {
        cacheControl: '3600',
        upsert: true,
        contentType: 'application/x-ndjson',
      },
    });
    expect(uploadCalls[0].bytes).toBeGreaterThan(0);

    // 3) Pre-insert existence check using count: exact + head: true
    const eqSelect = selectCalls.find((c) => c.filter && 'val' in c.filter);
    expect(eqSelect).toBeDefined();
    expect(eqSelect!.options).toMatchObject({ count: 'exact', head: true });

    // 4) Insert with the required columns
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      table: 'analysis_log_metadata',
      row: {
        execution_id: EXEC_1,
        user_id: USER_A,
        storage_path: expectedPath,
        total_images: 2490,
        total_corrections: 0,
        category: 'motorsport_v2',
      },
    });

    // Marker file written
    expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(true);
  });

  test('storage upload error → reported in failed, no insert attempted', async () => {
    writeJsonl(tmpDir, EXEC_1, [
      {
        type: 'EXECUTION_START',
        timestamp: '2026-04-25T20:10:00.000Z',
        executionId: EXEC_1,
        userId: USER_A,
        totalImages: 5,
        category: 'motorsport_v2',
      },
    ]);

    const supabase = makeRealisticSupabase({
      rowsPresent: [],
      uploadError: 'Network error: Timeout',
      uploadCalls,
      selectCalls,
      insertCalls,
    });

    const deps: ReconcilerDeps = {
      getLogsDir: () => tmpDir,
      getSupabase: () => supabase,
      getCurrentUserId: () => USER_A,
      log: () => {},
      config: { retryBaseMs: 1, maxUploadRetries: 2 },
    };

    const r = await reconcilePendingUploads(deps);

    expect(r.failed).toBe(1);
    expect(r.errors[0]?.reason).toContain('Network error');
    expect(uploadCalls.length).toBe(2); // attempted retry
    expect(insertCalls.length).toBe(0); // never reached
  });

  test('insert reports duplicate-pre-check shortcut: if row exists, skips insert and returns success', async () => {
    const file = writeJsonl(tmpDir, EXEC_1, [
      {
        type: 'EXECUTION_START',
        timestamp: '2026-04-25T20:10:00.000Z',
        executionId: EXEC_1,
        userId: USER_A,
        totalImages: 5,
        category: 'motorsport_v2',
      },
    ]);

    // Storage upload succeeds, but right before insert the row already exists
    // (e.g. another device beat us to it). The pre-insert SELECT eq() should
    // detect this and short-circuit to success without calling insert().
    let didFirstSelect = false;
    const supabase: any = {
      from: (table: string) => {
        const builder: any = {
          select: function (_cols: string, opts: any) {
            this._opts = opts;
            return this;
          },
          in: async function (_col: string, vals: string[]) {
            // Simulates "no row server-side" so we proceed to upload+insert path
            return { data: [], error: null };
          },
          eq: async function (_col: string, _val: string) {
            // Simulates "row appeared between scan and insert" — count > 0
            didFirstSelect = true;
            return { count: 1, error: null };
          },
          insert: async () => {
            throw new Error('insert should NOT be called when row already exists');
          },
        };
        return builder;
      },
      storage: {
        from: () => ({ upload: async () => ({ error: null }) }),
      },
    };

    const deps: ReconcilerDeps = {
      getLogsDir: () => tmpDir,
      getSupabase: () => supabase,
      getCurrentUserId: () => USER_A,
      log: () => {},
      config: { retryBaseMs: 1, maxUploadRetries: 1 },
    };

    const r = await reconcilePendingUploads(deps);

    expect(didFirstSelect).toBe(true);
    expect(r.uploaded).toBe(1);
    expect(r.failed).toBe(0);
    expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(true);
  });

  test('confirmed-from-server short-circuits before any storage call', async () => {
    const file = writeJsonl(tmpDir, EXEC_1, [
      {
        type: 'EXECUTION_START',
        timestamp: '2026-04-25T20:10:00.000Z',
        executionId: EXEC_1,
        userId: USER_A,
        totalImages: 5,
        category: 'motorsport_v2',
      },
    ]);

    const supabase = makeRealisticSupabase({
      rowsPresent: [EXEC_1], // server already confirms the row
      uploadCalls,
      selectCalls,
      insertCalls,
    });

    const deps: ReconcilerDeps = {
      getLogsDir: () => tmpDir,
      getSupabase: () => supabase,
      getCurrentUserId: () => USER_A,
      log: () => {},
      config: { retryBaseMs: 1, maxUploadRetries: 1 },
    };

    const r = await reconcilePendingUploads(deps);

    expect(r.confirmedRemote).toBe(1);
    expect(r.uploaded).toBe(0);
    expect(uploadCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
    expect(fs.existsSync(file + UPLOAD_MARKER_SUFFIX)).toBe(true);
  });
});
