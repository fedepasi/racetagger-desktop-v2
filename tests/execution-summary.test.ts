/**
 * Tests for the execution-summary sidecar layer:
 *  - `writeExecutionSummary` / `readExecutionSummary` (analysis-logger.ts)
 *  - `scanLocalExecutions` self-healing parser (local-executions-scanner.ts)
 *
 * The sidecar (`<jsonl>.summary.json`) is the home page's recovery anchor:
 * if the JSONL is missing or its EXECUTION_START is corrupted, the home page
 * still surfaces the analysis from the sidecar so the user knows it exists.
 *
 * Tests target the pure scanner directly so we don't drag Electron + Sharp
 * into the test graph (Sharp's native binary isn't always present in CI).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  writeExecutionSummary,
  readExecutionSummary,
  SUMMARY_SIDECAR_SUFFIX,
  ExecutionSummary,
} from '../src/utils/analysis-logger';
import { scanLocalExecutions } from '../src/utils/local-executions-scanner';

// ===========================================================================
// Helpers
// ===========================================================================

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EXEC_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1111';
const EXEC_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa2222';
const EXEC_3 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa3333';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
}

function execStartLine(opts: {
  executionId: string;
  totalImages?: number;
  category?: string;
  timestamp?: string;
}): string {
  return JSON.stringify({
    type: 'EXECUTION_START',
    timestamp: opts.timestamp ?? '2026-04-25T20:10:00.000Z',
    executionId: opts.executionId,
    totalImages: opts.totalImages ?? 100,
    category: opts.category ?? 'motorsport_v2',
  });
}

function imageAnalysisLine(raceNumber: string | null = '42'): string {
  return JSON.stringify({
    type: 'IMAGE_ANALYSIS',
    fileName: 'a.jpg',
    aiResponse: {
      vehicles: raceNumber ? [{ raceNumber }] : [],
    },
  });
}

function makeSummary(over: Partial<ExecutionSummary> = {}): Omit<ExecutionSummary, 'schemaVersion'> {
  return {
    id: EXEC_1,
    createdAt: '2026-04-25T20:10:00.000Z',
    completedAt: '2026-04-25T20:48:00.000Z',
    status: 'completed',
    sportCategory: 'motorsport_v2',
    totalImages: 100,
    imagesWithNumbers: 87,
    folderPath: '/Users/test/Pictures/Race',
    executionName: null,
    participantPreset: null,
    userId: USER_A,
    appVersion: 'test-1.0.0',
    ...over,
  };
}

// ===========================================================================
// writeExecutionSummary / readExecutionSummary
// ===========================================================================

describe('writeExecutionSummary + readExecutionSummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes a complete sidecar with schemaVersion 1', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    writeExecutionSummary(jsonlPath, makeSummary());

    const summaryPath = jsonlPath + SUMMARY_SIDECAR_SUFFIX;
    expect(fs.existsSync(summaryPath)).toBe(true);

    const obj = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(obj.schemaVersion).toBe(1);
    expect(obj.id).toBe(EXEC_1);
    expect(obj.totalImages).toBe(100);
    expect(obj.imagesWithNumbers).toBe(87);
    expect(obj.userId).toBe(USER_A);
  });

  test('atomic: no .tmp file remains after a successful write', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    writeExecutionSummary(jsonlPath, makeSummary());

    const tmpFile = jsonlPath + SUMMARY_SIDECAR_SUFFIX + '.tmp';
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  test('idempotent: rewriting overwrites the previous content', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    writeExecutionSummary(jsonlPath, makeSummary({ totalImages: 100 }));
    writeExecutionSummary(jsonlPath, makeSummary({ totalImages: 250, imagesWithNumbers: 200 }));

    const obj = JSON.parse(fs.readFileSync(jsonlPath + SUMMARY_SIDECAR_SUFFIX, 'utf-8'));
    expect(obj.totalImages).toBe(250);
    expect(obj.imagesWithNumbers).toBe(200);
  });

  test('readExecutionSummary returns the parsed object on success', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    writeExecutionSummary(jsonlPath, makeSummary({ folderPath: '/foo/bar' }));

    const r = readExecutionSummary(jsonlPath);
    expect(r).not.toBeNull();
    expect(r!.folderPath).toBe('/foo/bar');
  });

  test('readExecutionSummary returns null for missing file', () => {
    const jsonlPath = path.join(tmpDir, 'nope.jsonl');
    expect(readExecutionSummary(jsonlPath)).toBeNull();
  });

  test('readExecutionSummary returns null for malformed JSON', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    fs.writeFileSync(jsonlPath + SUMMARY_SIDECAR_SUFFIX, '{ not valid json');
    expect(readExecutionSummary(jsonlPath)).toBeNull();
  });

  test('readExecutionSummary returns null for wrong schema version', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    fs.writeFileSync(
      jsonlPath + SUMMARY_SIDECAR_SUFFIX,
      JSON.stringify({ schemaVersion: 2, id: EXEC_1 })
    );
    expect(readExecutionSummary(jsonlPath)).toBeNull();
  });

  test('readExecutionSummary returns null when id is missing', () => {
    const jsonlPath = path.join(tmpDir, `exec_${EXEC_1}.jsonl`);
    fs.writeFileSync(
      jsonlPath + SUMMARY_SIDECAR_SUFFIX,
      JSON.stringify({ schemaVersion: 1 })
    );
    expect(readExecutionSummary(jsonlPath)).toBeNull();
  });
});

// ===========================================================================
// get-local-executions self-healing
// ===========================================================================

/**
 * Wrapper that mirrors the contract of the IPC handler: scans, returns the
 * shape `{ success: true, data }`. Uses the pure scanner directly so no
 * Electron / Sharp imports are pulled in.
 */
function callGetLocalExecutions(tmpDir: string): { success: boolean; data: any[] } {
  const analysisDir = path.join(tmpDir, '.analysis-logs');
  if (!fs.existsSync(analysisDir)) fs.mkdirSync(analysisDir, { recursive: true });
  const data = scanLocalExecutions(analysisDir);
  return { success: true, data };
}

function writeJsonl(dir: string, executionId: string, lines: string[]): string {
  const file = path.join(dir, '.analysis-logs', `exec_${executionId}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function writeSummary(
  dir: string,
  executionId: string,
  summary: Omit<ExecutionSummary, 'schemaVersion'>
): string {
  const jsonlPath = path.join(dir, '.analysis-logs', `exec_${executionId}.jsonl`);
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  writeExecutionSummary(jsonlPath, summary);
  return jsonlPath + SUMMARY_SIDECAR_SUFFIX;
}

describe('get-local-executions self-healing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('healthy JSONL — current behaviour preserved', async () => {
    writeJsonl(tmpDir, EXEC_1, [
      execStartLine({ executionId: EXEC_1 }),
      imageAnalysisLine('42'),
      imageAnalysisLine('43'),
      JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
    ]);

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe(EXEC_1);
    expect(r.data[0].status).toBe('completed');
    expect(r.data[0].imagesWithNumbers).toBe(2);
  });

  test('JSONL with EXECUTION_START on line 5 (line 1 corrupted) — found by self-healing scan', async () => {
    writeJsonl(tmpDir, EXEC_1, [
      'this-is-not-json',          // 1
      '{"type":"PREAMBLE"}',       // 2
      '',                          // 3
      '{"truncated...',            // 4
      execStartLine({ executionId: EXEC_1 }), // 5
      imageAnalysisLine('99'),
      JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
    ]);

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe(EXEC_1);
  });

  test('JSONL missing EXECUTION_START + sidecar present — sidecar wins, execution still visible', async () => {
    writeJsonl(tmpDir, EXEC_1, [
      // No EXECUTION_START at all — just a few corrupt-looking events
      '{"type":"OTHER"}',
      'not-even-json',
    ]);
    writeSummary(tmpDir, EXEC_1, makeSummary({
      id: EXEC_1,
      totalImages: 2490,
      imagesWithNumbers: 2165,
      sportCategory: 'motorsport_v2',
      folderPath: '/Users/patrick/Race-2026',
    }));

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe(EXEC_1);
    expect(r.data[0].status).toBe('completed');
    expect(r.data[0].totalImages).toBe(2490);
    expect(r.data[0].imagesWithNumbers).toBe(2165);
    expect(r.data[0].folderPath).toBe('/Users/patrick/Race-2026');
  });

  test('orphan sidecar (no JSONL at all) — execution surfaces from sidecar alone', async () => {
    writeSummary(tmpDir, EXEC_1, makeSummary({
      id: EXEC_1,
      totalImages: 500,
      imagesWithNumbers: 412,
    }));

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe(EXEC_1);
    expect(r.data[0].totalImages).toBe(500);
  });

  test('JSONL trumps sidecar when JSONL has IMAGE_ANALYSIS rows', async () => {
    writeJsonl(tmpDir, EXEC_1, [
      execStartLine({ executionId: EXEC_1, totalImages: 10 }),
      imageAnalysisLine('1'),
      imageAnalysisLine('2'),
      imageAnalysisLine('3'),
    ]);
    // Sidecar disagrees — claims totalImages=999. JSONL should win on counts
    // because it has actual evidence.
    writeSummary(tmpDir, EXEC_1, makeSummary({
      id: EXEC_1,
      totalImages: 999,
      imagesWithNumbers: 999,
    }));

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.data[0].imagesWithNumbers).toBe(3); // from JSONL, not sidecar
  });

  test('missing both → execution skipped silently', async () => {
    // Just an empty .analysis-logs dir
    fs.mkdirSync(path.join(tmpDir, '.analysis-logs'), { recursive: true });

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.success).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('mixed: 3 healthy JSONLs + 1 orphan sidecar + 1 broken JSONL with sidecar — all 5 visible', async () => {
    // 1. Healthy
    writeJsonl(tmpDir, EXEC_1, [
      execStartLine({ executionId: EXEC_1, timestamp: '2026-04-25T22:00:00.000Z' }),
      imageAnalysisLine('1'),
      JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
    ]);
    // 2. Healthy
    writeJsonl(tmpDir, EXEC_2, [
      execStartLine({ executionId: EXEC_2, timestamp: '2026-04-25T21:00:00.000Z' }),
      imageAnalysisLine('1'),
      JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
    ]);
    // 3. Broken JSONL + sidecar
    writeJsonl(tmpDir, EXEC_3, [
      'corrupt-line',
      'not-json',
    ]);
    writeSummary(tmpDir, EXEC_3, makeSummary({
      id: EXEC_3,
      createdAt: '2026-04-25T20:00:00.000Z',
      totalImages: 2490,
      imagesWithNumbers: 2165,
    }));
    // 4. Orphan sidecar
    const ORPHAN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaffff';
    writeSummary(tmpDir, ORPHAN_ID, makeSummary({
      id: ORPHAN_ID,
      createdAt: '2026-04-24T20:00:00.000Z',
      totalImages: 100,
    }));

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.data).toHaveLength(4);
    const ids = r.data.map((e: any) => e.id).sort();
    expect(ids).toEqual([EXEC_1, EXEC_2, EXEC_3, ORPHAN_ID].sort());

    // EXEC_3 should report the sidecar's totals because the JSONL had no IMAGE_ANALYSIS
    const exec3 = r.data.find((e: any) => e.id === EXEC_3);
    expect(exec3.totalImages).toBe(2490);
  });

  test('sort order: most recent createdAt first, regardless of source', async () => {
    writeSummary(tmpDir, EXEC_1, makeSummary({ id: EXEC_1, createdAt: '2026-04-25T10:00:00.000Z' }));
    writeJsonl(tmpDir, EXEC_2, [
      execStartLine({ executionId: EXEC_2, timestamp: '2026-04-25T20:00:00.000Z' }),
      JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
    ]);

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.data[0].id).toBe(EXEC_2); // 20:00 most recent
    expect(r.data[1].id).toBe(EXEC_1); // 10:00 second
  });

  // B13 — account-aware filter on the home page
  describe('ownerUserId filter (B13)', () => {
    const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    function execStartLineWithUser(executionId: string, userId: string, timestamp: string): string {
      return JSON.stringify({
        type: 'EXECUTION_START',
        timestamp,
        executionId,
        userId,
        totalImages: 50,
        category: 'motorsport_v2',
      });
    }

    test('filters out executions owned by other users (sidecar source)', async () => {
      writeSummary(tmpDir, EXEC_1, makeSummary({
        id: EXEC_1,
        userId: USER_A,
        createdAt: '2026-04-25T10:00:00.000Z',
      }));
      writeSummary(tmpDir, EXEC_2, makeSummary({
        id: EXEC_2,
        userId: USER_B,
        createdAt: '2026-04-25T11:00:00.000Z',
      }));

      const r = scanLocalExecutions(path.join(tmpDir, '.analysis-logs'), {
        ownerUserId: USER_A,
      });
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe(EXEC_1);
    });

    test('filters out executions owned by other users (JSONL source)', async () => {
      writeJsonl(tmpDir, EXEC_1, [
        execStartLineWithUser(EXEC_1, USER_A, '2026-04-25T10:00:00.000Z'),
        JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
      ]);
      writeJsonl(tmpDir, EXEC_2, [
        execStartLineWithUser(EXEC_2, USER_B, '2026-04-25T11:00:00.000Z'),
        JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
      ]);

      const r = scanLocalExecutions(path.join(tmpDir, '.analysis-logs'), {
        ownerUserId: USER_B,
      });
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe(EXEC_2);
    });

    test('legacy executions without userId remain visible (no regression on upgrade)', async () => {
      // EXECUTION_START without userId field — represents pre-fix JSONL logs
      writeJsonl(tmpDir, EXEC_1, [
        JSON.stringify({
          type: 'EXECUTION_START',
          timestamp: '2026-04-25T10:00:00.000Z',
          executionId: EXEC_1,
          totalImages: 50,
          category: 'motorsport_v2',
          // intentionally NO userId
        }),
        JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
      ]);

      const r = scanLocalExecutions(path.join(tmpDir, '.analysis-logs'), {
        ownerUserId: USER_A,
      });
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe(EXEC_1);
    });

    test('no ownerUserId means no filtering (current behaviour, regression guard)', async () => {
      writeSummary(tmpDir, EXEC_1, makeSummary({ id: EXEC_1, userId: USER_A, createdAt: '2026-04-25T10:00:00.000Z' }));
      writeSummary(tmpDir, EXEC_2, makeSummary({ id: EXEC_2, userId: USER_B, createdAt: '2026-04-25T11:00:00.000Z' }));

      const r = scanLocalExecutions(path.join(tmpDir, '.analysis-logs'));
      expect(r).toHaveLength(2);
    });
  });

  test('summary with corrupt schemaVersion is ignored — falls through to JSONL only', async () => {
    writeJsonl(tmpDir, EXEC_1, [
      execStartLine({ executionId: EXEC_1 }),
      JSON.stringify({ type: 'EXECUTION_COMPLETE' }),
    ]);
    // Manually write a bad sidecar
    fs.writeFileSync(
      path.join(tmpDir, '.analysis-logs', `exec_${EXEC_1}.jsonl${SUMMARY_SIDECAR_SUFFIX}`),
      JSON.stringify({ schemaVersion: 99, id: EXEC_1 })
    );

    const r = await callGetLocalExecutions(tmpDir);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe(EXEC_1);
    // status comes from the JSONL EXECUTION_COMPLETE, not the bogus sidecar
    expect(r.data[0].status).toBe('completed');
  });
});
