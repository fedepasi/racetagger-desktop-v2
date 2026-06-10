/**
 * BUG-02 — "Save & Next actually saves": immediate per-row persist.
 *
 * Two layers:
 *   1. `upsertSinglePresetParticipantSupabase` (src/database-service.ts) against
 *      a mocked Supabase client — the narrow single-row write that backs the
 *      editor's per-row persist. Covers auth + ownership (memoized), the
 *      insert-vs-upsert split, FIX #78 id/created_at stripping, and the
 *      folders[] dual-write.
 *   2. `buildParticipantSavePayload` (renderer/js/participants-manager.js) — the
 *      SINGLE payload mapping now shared by savePreset (bulk) and the per-row
 *      path. We load the REAL function out of the renderer source (no module
 *      system there) and pin its contract, so the bulk/per-row mappings can
 *      never silently drift apart.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Mocks for the auth + supabase singletons, mirroring bulk-assign-folders.test.
// ============================================================================

let mockUserId: string | null = 'user-123';
let mockFrom: (table: string) => any;

jest.mock('../src/auth-service', () => ({
  authService: {
    getAuthState: () => ({
      isAuthenticated: mockUserId !== null,
      user: mockUserId ? { id: mockUserId } : null
    }),
    getSupabaseClient: () => ({ from: (table: string) => mockFrom(table) }),
    isAdmin: () => false
  }
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}) })
}));

// Load the module under test AFTER the mocks are wired.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const databaseService = require('../src/database-service');
const { upsertSinglePresetParticipantSupabase } = databaseService;

// ============================================================================
// Mocked Supabase harness for the single-row upsert/insert chains.
// ============================================================================

interface Harness {
  presetRow: any;
  presetError: any;
  rowError: any;
  ownershipSelectCount: number;
  upsertCalls: { payload: any; opts: any }[];
  insertCalls: { payload: any }[];
}

function makeHarness(overrides: Partial<Harness> = {}): Harness {
  return {
    presetRow: { id: 'preset-x', user_id: 'user-123' },
    presetError: null,
    rowError: null,
    ownershipSelectCount: 0,
    upsertCalls: [],
    insertCalls: [],
    ...overrides
  };
}

function installFrom(h: Harness): void {
  mockFrom = (table: string) => {
    if (table === 'participant_presets') {
      // .select('id, user_id').eq('id', presetId).single()
      const builder: any = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        single: jest.fn(() => {
          h.ownershipSelectCount++;
          return Promise.resolve({ data: h.presetRow, error: h.presetError });
        })
      };
      return builder;
    }

    if (table === 'preset_participants') {
      return {
        // .upsert([record], { onConflict: 'id' }).select().single()
        upsert: jest.fn((payload: any, opts: any) => {
          h.upsertCalls.push({ payload, opts });
          const row = Array.isArray(payload) ? { ...payload[0] } : { ...payload };
          return {
            select: () => ({
              single: () => Promise.resolve({ data: h.rowError ? null : row, error: h.rowError })
            })
          };
        }),
        // .insert(record).select().single()
        insert: jest.fn((payload: any) => {
          h.insertCalls.push({ payload });
          const row = { ...payload, id: 'generated-uuid-0001' };
          return {
            select: () => ({
              single: () => Promise.resolve({ data: h.rowError ? null : row, error: h.rowError })
            })
          };
        })
      };
    }

    throw new Error(`Unexpected table in test harness: ${table}`);
  };
}

describe('upsertSinglePresetParticipantSupabase', () => {
  let h: Harness;

  beforeEach(() => {
    mockUserId = 'user-123';
    h = makeHarness();
    installFrom(h);
  });

  it('throws when the user is not authenticated', async () => {
    mockUserId = null;
    await expect(
      upsertSinglePresetParticipantSupabase('preset-auth', { numero: '1' })
    ).rejects.toThrow(/not authenticated/i);
  });

  it('throws when the preset belongs to another user', async () => {
    h.presetRow = { id: 'preset-mismatch', user_id: 'someone-else' };
    await expect(
      upsertSinglePresetParticipantSupabase('preset-mismatch', { numero: '1' })
    ).rejects.toThrow(/Access denied/i);
  });

  it('throws when the preset does not exist', async () => {
    h.presetRow = null;
    await expect(
      upsertSinglePresetParticipantSupabase('preset-missing', { numero: '1' })
    ).rejects.toThrow(/not found/i);
  });

  it('INSERTs when no id is present and strips id/created_at (FIX #78)', async () => {
    const saved = await upsertSinglePresetParticipantSupabase('preset-insert', {
      // id deliberately absent — but created_at present to prove it's stripped
      created_at: '2020-01-01T00:00:00Z',
      numero: '42',
      nome: 'Alpha'
    } as any);

    expect(h.insertCalls).toHaveLength(1);
    expect(h.upsertCalls).toHaveLength(0);
    const payload = h.insertCalls[0].payload;
    expect('id' in payload).toBe(false);
    expect('created_at' in payload).toBe(false);
    expect(payload.preset_id).toBe('preset-insert');
    expect(payload.numero).toBe('42');
    // Returns the freshly-created row WITH its DB-assigned id.
    expect(saved.id).toBe('generated-uuid-0001');
  });

  it('UPSERTs by primary key when an id is present (onConflict: id)', async () => {
    const saved = await upsertSinglePresetParticipantSupabase('preset-upsert', {
      id: 'existing-row-1',
      numero: '7',
      nome: 'Bravo'
    });

    expect(h.upsertCalls).toHaveLength(1);
    expect(h.insertCalls).toHaveLength(0);
    const { payload, opts } = h.upsertCalls[0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0].id).toBe('existing-row-1');
    expect(payload[0].preset_id).toBe('preset-upsert');
    expect(opts).toEqual({ onConflict: 'id' });
    expect(saved.id).toBe('existing-row-1');
  });

  it('applies the folders[] dual-write to the persisted record', async () => {
    await upsertSinglePresetParticipantSupabase('preset-folders', {
      id: 'row-folders',
      numero: '5',
      folders: [
        { name: 'AMG', path: '/abs/AMG' },
        { name: 'Day1' }
      ]
    });

    const record = h.upsertCalls[0].payload[0];
    expect(record.folder_1).toBe('AMG');
    expect(record.folder_1_path).toBe('/abs/AMG');
    expect(record.folder_2).toBe('Day1');
    // No third folder → legacy slot explicitly cleared, not left stale.
    expect(record.folder_3).toBeNull();
  });

  it('does NOT touch participant_presets.updated_at (Save Preset owns it)', async () => {
    // The harness only knows two participant_presets call sites: the ownership
    // SELECT (single) and — if it ever happened — an .update(). We never give
    // the builder an .update mock, so a stray updated_at bump would throw.
    await expect(
      upsertSinglePresetParticipantSupabase('preset-no-bump', { id: 'r1', numero: '9' })
    ).resolves.toBeDefined();
  });

  it('memoizes the ownership check — fires once per preset per session', async () => {
    const presetId = 'preset-memo';
    await upsertSinglePresetParticipantSupabase(presetId, { id: 'r1', numero: '1' });
    await upsertSinglePresetParticipantSupabase(presetId, { id: 'r1', numero: '1b' });
    await upsertSinglePresetParticipantSupabase(presetId, { numero: '2' });
    // Three saves, but the ownership SELECT ran only on the first.
    expect(h.ownershipSelectCount).toBe(1);
  });
});

// ============================================================================
// buildParticipantSavePayload — load the REAL renderer function from source.
// ============================================================================

/** Robust brace-matched extraction of a top-level `function NAME(...) {...}`. */
function extractFunctionSource(src: string, name: string): string {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found in source`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

function loadBuildPayload(): (p: any) => any {
  const file = path.join(__dirname, '..', 'renderer', 'js', 'participants-manager.js');
  const src = fs.readFileSync(file, 'utf8');
  const fnSrc = extractFunctionSource(src, 'buildParticipantSavePayload');

  // The production function references two free helpers; inject test stubs that
  // mirror their real contracts (driver-name precedence + per-device folder path).
  const getDriverNamesFromParticipant = (p: any): string[] => {
    if (p?.preset_participant_drivers?.length > 0) {
      return [...p.preset_participant_drivers]
        .sort((a: any, b: any) => a.driver_order - b.driver_order)
        .map((d: any) => d.driver_name)
        .filter(Boolean);
    }
    if (p?.nome) return String(p.nome).split(',').map((s: string) => s.trim()).filter(Boolean);
    return [];
  };
  const getFolderPath = (_name: any): string => ''; // no per-device path override in tests

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'getDriverNamesFromParticipant',
    'getFolderPath',
    `${fnSrc}; return buildParticipantSavePayload;`
  );
  return factory(getDriverNamesFromParticipant, getFolderPath);
}

describe('buildParticipantSavePayload (renderer — shared bulk/per-row mapping)', () => {
  const buildParticipantSavePayload = loadBuildPayload();

  it('maps a canonical-folders participant field-for-field', () => {
    const participant = {
      id: 'p-1',
      numero: '42',
      // driver names come from preset_participant_drivers, sorted by order
      preset_participant_drivers: [
        { driver_name: 'Bravo', driver_order: 1 },
        { driver_name: 'Alpha', driver_order: 0 }
      ],
      categoria: 'GT3',
      squadra: 'AMG Team',
      plate_number: 'AB123',
      sponsor: 'Acme',
      metatag: 'vip',
      folders: [{ name: 'AMG', path: '/abs/AMG' }, { name: 'Day1' }],
      include_default_folder: false,
      delivery_to_client_id: 'client-7',
      is_active: false,
      // not a persisted field — must be dropped from the payload
      car_model: 'GT3 EVO'
    };

    const payload = buildParticipantSavePayload(participant);

    expect(payload).toEqual({
      id: 'p-1',
      numero: '42',
      nome: 'Alpha, Bravo',
      categoria: 'GT3',
      squadra: 'AMG Team',
      plate_number: 'AB123',
      sponsor: 'Acme',
      metatag: 'vip',
      folders: [{ name: 'AMG', path: '/abs/AMG' }, { name: 'Day1' }],
      include_default_folder: false,
      folder_1: undefined,
      folder_2: undefined,
      folder_3: undefined,
      folder_1_path: undefined,
      folder_2_path: undefined,
      folder_3_path: undefined,
      delivery_to_client_id: 'client-7',
      is_active: false
    });
    // car_model is intentionally NOT persisted by either save path.
    expect('car_model' in payload).toBe(false);
  });

  it('forwards legacy folder slots when folders[] is absent', () => {
    const legacy = {
      numero: '7',
      nome: 'Solo Driver',
      folder_1: 'Pit',
      folder_1_path: '/pit'
    };

    const payload = buildParticipantSavePayload(legacy);

    expect(payload.id).toBeUndefined();          // no id → insert path
    expect(payload.nome).toBe('Solo Driver');
    expect(payload.folders).toBeUndefined();      // no canonical array
    expect(payload.folder_1).toBe('Pit');
    expect(payload.folder_1_path).toBe('/pit');
    expect(payload.folder_2).toBe('');
    expect(payload.include_default_folder).toBe(true); // default when missing
    expect(payload.is_active).toBe(true);              // default when missing
  });
});
