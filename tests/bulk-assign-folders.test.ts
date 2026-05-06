/**
 * Tests for bulk folder assignment (PR2).
 *
 * Two layers:
 *   1. `computeFolderUpdate` — pure function, exhaustive cases. The merge
 *      semantics live here so the database round-trip stays thin.
 *   2. `bulkAssignFoldersSupabase` — end-to-end against a mocked Supabase
 *      client. Covers ownership, folder pool resolution, dual-write, cache
 *      invalidation, and the partial-failure result shape.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ============================================================================
// Module-level mock state for the auth + supabase singletons. Defined before
// the jest.mock() calls so the factories can close over them.
// ============================================================================

let mockUserId: string | null = 'user-123';
let mockSupabaseFromBuilder: any = null;

jest.mock('../src/auth-service', () => ({
  authService: {
    getAuthState: () => ({
      isAuthenticated: mockUserId !== null,
      user: mockUserId ? { id: mockUserId } : null
    }),
    getSupabaseClient: () => ({
      from: (table: string) => mockSupabaseFromBuilder(table)
    })
  }
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}) })
}));

// We need to load the module under test AFTER the mocks are set up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const databaseService = require('../src/database-service');
const { computeFolderUpdate, bulkAssignFoldersSupabase } = databaseService;

// ============================================================================
// Pure helper tests — these don't touch the auth/supabase mocks at all.
// ============================================================================

describe('computeFolderUpdate', () => {
  describe('replace mode', () => {
    it('returns exactly the requested folders, in order', () => {
      const result = computeFolderUpdate(
        [{ name: 'Old', path: '/old' }],
        [{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }],
        'replace'
      );
      expect(result).toEqual([
        { name: 'A', path: '/a' },
        { name: 'B', path: '/b' }
      ]);
    });

    it('drops blank/empty entries from the requested list', () => {
      const result = computeFolderUpdate(
        [],
        [{ name: 'A', path: '/a' }, { name: '   ', path: '/blank' }, { name: 'B' }],
        'replace'
      );
      expect(result).toHaveLength(2);
      expect(result.map((f: any) => f.name)).toEqual(['A', 'B']);
    });

    it('clears folders when requested array is empty', () => {
      const result = computeFolderUpdate(
        [{ name: 'X', path: '/x' }, { name: 'Y' }],
        [],
        'replace'
      );
      expect(result).toEqual([]);
    });

    it('omits the path key when not provided (does not store path: undefined)', () => {
      const result = computeFolderUpdate(undefined, [{ name: 'NoPath' }], 'replace');
      expect(result).toEqual([{ name: 'NoPath' }]);
      expect(Object.keys(result[0])).toEqual(['name']);
    });

    it('trims surrounding whitespace from names', () => {
      const result = computeFolderUpdate(undefined, [{ name: '  AMG  ' }], 'replace');
      expect(result[0].name).toBe('AMG');
    });
  });

  describe('append mode', () => {
    it('keeps existing folders and adds new ones', () => {
      const result = computeFolderUpdate(
        [{ name: 'Existing', path: '/exist' }],
        [{ name: 'Added', path: '/added' }],
        'append'
      );
      expect(result).toEqual([
        { name: 'Existing', path: '/exist' },
        { name: 'Added', path: '/added' }
      ]);
    });

    it('dedups case-insensitively against existing names', () => {
      const result = computeFolderUpdate(
        [{ name: 'AMG', path: '/amg' }],
        [{ name: 'amg', path: '/different-path' }, { name: 'ADAC', path: '/adac' }],
        'append'
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'AMG', path: '/amg' }); // existing path wins
      expect(result[1]).toEqual({ name: 'ADAC', path: '/adac' });
    });

    it('dedups within the requested list itself', () => {
      const result = computeFolderUpdate(
        [],
        [{ name: 'X', path: '/x1' }, { name: 'x', path: '/x2' }],
        'append'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'X', path: '/x1' });
    });

    it('handles undefined / null current folders as empty', () => {
      expect(computeFolderUpdate(undefined, [{ name: 'A', path: '/a' }], 'append'))
        .toEqual([{ name: 'A', path: '/a' }]);
      expect(computeFolderUpdate(null, [{ name: 'A', path: '/a' }], 'append'))
        .toEqual([{ name: 'A', path: '/a' }]);
    });

    it('drops malformed entries from the existing list (defensive)', () => {
      const dirty: any = [
        { name: 'Good', path: '/good' },
        null,
        { path: '/no-name' },
        { name: '   ' },
        { name: 'Trim Me  ', path: '/trim' }
      ];
      const result = computeFolderUpdate(dirty, [{ name: 'Added' }], 'append');
      expect(result.map((f: any) => f.name)).toEqual(['Good', 'Trim Me', 'Added']);
    });

    it('preserves order: existing first, new appended', () => {
      const result = computeFolderUpdate(
        [{ name: 'B' }, { name: 'A' }],
        [{ name: 'D' }, { name: 'C' }],
        'append'
      );
      expect(result.map((f: any) => f.name)).toEqual(['B', 'A', 'D', 'C']);
    });
  });
});

// ============================================================================
// Integration-ish tests against a mocked Supabase client. We model the chain
// of from(...).select(...).eq(...).single() and from(...).upsert(...) calls
// using Jest mocks so we can assert the shape of payloads we send to Supabase.
// ============================================================================

interface FromBuilder {
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  single: jest.Mock;
  update: jest.Mock;
  upsert: jest.Mock;
  __table: string;
  __resolveSelect?: () => Promise<{ data: any; error: any }>;
  __resolveSingle?: () => Promise<{ data: any; error: any }>;
  __resolveUpsert?: () => Promise<{ data: any; error: any }>;
  __resolveUpdate?: () => Promise<{ data: any; error: any }>;
}

interface SupabaseHarness {
  presetRow: any;
  presetError: any;
  participantRows: any[];
  participantsError: any;
  upsertError: any;
  upsertedPayload: any[] | null;
  /** Captured calls to from() in order, for assertion. */
  fromCalls: { table: string; builder: FromBuilder }[];
}

function makeSupabaseHarness(overrides: Partial<SupabaseHarness> = {}): SupabaseHarness {
  return {
    presetRow: {
      id: 'preset-1',
      user_id: 'user-123',
      custom_folders: [
        { name: 'AMG', path: '/abs/AMG' },
        { name: 'ADAC', path: '/abs/ADAC' },
        { name: 'Schnitzelalm Heyer', path: '/abs/Schnitzelalm' }
      ]
    },
    presetError: null,
    participantRows: [
      { id: 'p-1', folders: [] },
      { id: 'p-2', folders: [{ name: 'AMG', path: '/abs/AMG' }] }
    ],
    participantsError: null,
    upsertError: null,
    upsertedPayload: null,
    fromCalls: [],
    ...overrides
  };
}

function installFromBuilder(harness: SupabaseHarness): void {
  mockSupabaseFromBuilder = (table: string) => {
    const b: any = {
      __table: table,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      single: jest.fn(),
      update: jest.fn().mockReturnThis(),
      upsert: jest.fn()
    };

    if (table === 'participant_presets') {
      // Two distinct call sites:
      //   1. .select('id, user_id, custom_folders').eq('id', presetId).single()
      //   2. .update({ updated_at }).eq('id', presetId)
      b.single.mockImplementation(() =>
        Promise.resolve({ data: harness.presetRow, error: harness.presetError })
      );
      b.update.mockImplementation(() => {
        // Second .eq() resolves the chain — fake an awaitable
        const continuation: any = {
          eq: jest.fn().mockImplementation(() => Promise.resolve({ error: null }))
        };
        return continuation;
      });
    } else if (table === 'preset_participants') {
      // .select('id, folders').eq('preset_id', presetId).in('id', participantIds)
      // is awaited as a promise — make .in() resolve.
      b.in.mockImplementation(() =>
        Promise.resolve({
          data: harness.participantRows,
          error: harness.participantsError
        })
      );
      b.upsert.mockImplementation((payload: any) => {
        harness.upsertedPayload = payload;
        return Promise.resolve({ data: null, error: harness.upsertError });
      });
    }

    harness.fromCalls.push({ table, builder: b });
    return b;
  };
}

describe('bulkAssignFoldersSupabase', () => {
  let harness: SupabaseHarness;

  beforeEach(() => {
    mockUserId = 'user-123';
    harness = makeSupabaseHarness();
    installFromBuilder(harness);
  });

  it('throws when user is not authenticated', async () => {
    mockUserId = null;
    await expect(
      bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG'], 'append')
    ).rejects.toThrow(/not authenticated/i);
  });

  it('throws on invalid mode', async () => {
    await expect(
      bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG'], 'merge' as any)
    ).rejects.toThrow(/Invalid mode/i);
  });

  it('returns empty result when no participantIds given', async () => {
    const result = await bulkAssignFoldersSupabase('preset-1', [], ['AMG'], 'append');
    expect(result).toEqual({ ok: 0, failed: [], unknownFolderNames: [] });
    expect(harness.fromCalls.length).toBe(0); // never even hit Supabase
  });

  it('throws when preset belongs to a different user', async () => {
    harness.presetRow.user_id = 'someone-else';
    await expect(
      bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG'], 'append')
    ).rejects.toThrow(/Access denied/i);
  });

  it('reports unknown folder names without erroring out', async () => {
    const result = await bulkAssignFoldersSupabase(
      'preset-1',
      ['p-1', 'p-2'],
      ['AMG', 'NotInPool'],
      'append'
    );
    expect(result.unknownFolderNames).toEqual(['NotInPool']);
    expect(result.ok).toBe(2);
  });

  it('append mode merges with existing folders and dedups case-insensitively', async () => {
    await bulkAssignFoldersSupabase('preset-1', ['p-1', 'p-2'], ['AMG', 'ADAC'], 'append');
    expect(harness.upsertedPayload).toHaveLength(2);

    const p1 = harness.upsertedPayload!.find((r: any) => r.id === 'p-1');
    const p2 = harness.upsertedPayload!.find((r: any) => r.id === 'p-2');

    // p-1 had no folders → both new ones land
    expect(p1.folders.map((f: any) => f.name)).toEqual(['AMG', 'ADAC']);
    // p-2 already had AMG → only ADAC is appended; existing AMG path preserved
    expect(p2.folders).toHaveLength(2);
    expect(p2.folders[0]).toEqual({ name: 'AMG', path: '/abs/AMG' });
    expect(p2.folders[1]).toEqual({ name: 'ADAC', path: '/abs/ADAC' });
  });

  it('replace mode wipes existing folders and sets only the requested ones', async () => {
    await bulkAssignFoldersSupabase('preset-1', ['p-1', 'p-2'], ['ADAC'], 'replace');
    const p2 = harness.upsertedPayload!.find((r: any) => r.id === 'p-2');
    // p-2 used to have AMG; replace mode kicks it out
    expect(p2.folders).toEqual([{ name: 'ADAC', path: '/abs/ADAC' }]);
  });

  it('replace mode with empty folder list clears all folders for the participants', async () => {
    await bulkAssignFoldersSupabase('preset-1', ['p-1', 'p-2'], [], 'replace');
    expect(harness.upsertedPayload).toHaveLength(2);
    for (const row of harness.upsertedPayload!) {
      expect(row.folders).toEqual([]);
      expect(row.folder_1).toBeNull();
      expect(row.folder_2).toBeNull();
      expect(row.folder_3).toBeNull();
    }
  });

  it('append mode with no resolvable folders is a no-op (does not upsert)', async () => {
    const result = await bulkAssignFoldersSupabase(
      'preset-1',
      ['p-1', 'p-2'],
      ['NotAPoolName'],
      'append'
    );
    expect(harness.upsertedPayload).toBeNull(); // upsert never called
    expect(result.ok).toBe(0);
    expect(result.unknownFolderNames).toEqual(['NotAPoolName']);
  });

  it('writes legacy folder_1/2/3 columns alongside the canonical folders[]', async () => {
    await bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG', 'ADAC', 'Schnitzelalm Heyer'], 'append');
    const row = harness.upsertedPayload!.find((r: any) => r.id === 'p-1');
    expect(row.folder_1).toBe('AMG');
    expect(row.folder_1_path).toBe('/abs/AMG');
    expect(row.folder_2).toBe('ADAC');
    expect(row.folder_2_path).toBe('/abs/ADAC');
    expect(row.folder_3).toBe('Schnitzelalm Heyer');
    expect(row.folder_3_path).toBe('/abs/Schnitzelalm');
  });

  it('reports participantIds that do not belong to the preset as failures', async () => {
    // We requested 3 IDs but Supabase returns rows for only 2 (RLS or wrong preset).
    const result = await bulkAssignFoldersSupabase(
      'preset-1',
      ['p-1', 'p-2', 'p-foreign'],
      ['AMG'],
      'append'
    );
    expect(result.ok).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toEqual({ id: 'p-foreign', error: 'Participant not found in this preset' });
  });

  it('throws when Supabase returns an error on the upsert', async () => {
    harness.upsertError = { message: 'transient db blip' };
    await expect(
      bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG'], 'append')
    ).rejects.toThrow(/Bulk folder assignment failed.*transient db blip/);
  });

  it('throws when preset lookup fails', async () => {
    harness.presetError = { message: 'rls denied' };
    await expect(
      bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG'], 'append')
    ).rejects.toThrow(/Preset lookup failed.*rls denied/);
  });

  it('throws when preset does not exist', async () => {
    harness.presetRow = null;
    await expect(
      bulkAssignFoldersSupabase('preset-1', ['p-1'], ['AMG'], 'append')
    ).rejects.toThrow(/not found/i);
  });

  it('handles a preset with no custom_folders pool gracefully', async () => {
    harness.presetRow.custom_folders = null;
    const result = await bulkAssignFoldersSupabase(
      'preset-1',
      ['p-1'],
      ['AMG'],
      'append'
    );
    // Every requested name is unknown because the pool is empty.
    expect(result.unknownFolderNames).toEqual(['AMG']);
    expect(result.ok).toBe(0);
  });
});
