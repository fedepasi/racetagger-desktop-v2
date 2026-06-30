# Preset Export/Import with Face Photos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop preset JSON export/import carry the user-uploaded face reference photos, so a preset (with all its face work) can be handed to another user and re-imported intact.

**Architecture:** Extend the existing single-`.json` export (`exportPresetJSON`) to version `"3.0"` with a new `face_photos[]` array holding the real image bytes as base64, each tagged with a portable linkage (`participant_numero` + optional `driver_order`). On import, a new pure helper maps each face photo to the freshly-created participant/driver id, then replays it through the **existing** `preset-face-upload-photo` IPC handler — which re-uploads under the importer's own storage and recomputes the AuraFace embedding. Image bytes are gathered for export by a new main-process IPC handler that downloads each photo via the authenticated Supabase Storage client.

**Tech Stack:** Electron 36 main process (TypeScript), plain-JS renderer (`renderer/js/`), Supabase JS client, Jest 29 + ts-jest.

## Global Constraints

- **Desktop only.** No changes to `racetagger-app/` (web), Edge Functions, token logic, or DB schema. (root CLAUDE.md: token logic sacred; never modify schema without a migration)
- **No schema change.** `preset_participant_face_photos.photo_url` / `storage_path` stay `TEXT NOT NULL`; real photos populate them normally.
- **Reuse, don't duplicate, the face-upload path.** Import MUST go through the existing `preset-face-upload-photo` handler (re-upload + recompute embedding); do not write a second insert path.
- **IPC discipline:** every handler returns `HandlerResult`-shaped `{ success: true, ... } | { success: false, error }`; new invoke channels MUST be added to the `validInvokeChannels` whitelist in `src/preload.ts` (root CLAUDE.md / ipc-channel-auditor).
- **Fail-clear, never silent:** a face photo that can't be re-embedded on import (model missing / no face detected) is skipped and reported in a summary; the preset import never aborts because of it.
- **Backward compatible:** importing a pre-3.0 JSON with no `face_photos[]` must behave exactly as today.
- **Verify TypeScript with `npm run compile`** after main-process changes.

---

## Worktree dev setup (one-time, before Task 1)

This plan runs in the worktree `.claude/worktrees/preset-export-with-faces`, which has no `node_modules`. Symlink the main checkout's (same platform/Electron build) so Jest and `tsc` resolve:

- [ ] **Step 1: Symlink node_modules**

Run (from the worktree root):
```bash
ln -s ../../../node_modules node_modules
```

- [ ] **Step 2: Verify Jest + tsc resolve**

Run:
```bash
npx jest tests/driver-synthesis.test.ts --silent && npx tsc --noEmit -p tsconfig.json >/dev/null 2>&1; echo "tsc exit: $?"
```
Expected: the Jest sample passes. `tsc` exit code is non-zero (the repo has hundreds of pre-existing type errors — that's the known baseline; we only care that our NEW files don't *add* errors, checked per-task with `npm run compile` diffs).

---

## Task 1: Pure import-mapping helper + tests

The only logic with real branching (linkage resolution) lives in a pure, dual-export helper module — mirroring `renderer/js/driver-helpers.js` — so it is unit-testable without DOM/IPC.

**Files:**
- Create: `renderer/js/face-photo-export-helpers.js`
- Test: `tests/face-photo-import-mapping.test.ts`

**Interfaces:**
- Produces (browser global `window.facePhotoHelpers` + CommonJS `module.exports`):
  - `resolveFacePhotoTargets(facePhotos, savedParticipants, driversByNewId) => { resolved, skipped }`
    - `facePhotos`: `Array<{ participant_numero, driver_order: number|null, driver_name: string|null, image_base64, ext, mime, photo_type, is_primary, detection_confidence }>`
    - `savedParticipants`: `Array<{ id: string, numero: string|number }>`
    - `driversByNewId`: `{ [participantId: string]: Array<{ id: string, driver_order: number, driver_name: string }> }`
    - `resolved`: `Array<{ photo, participantId: string|null, driverId: string|null }>` (exactly one of participantId/driverId is non-null)
    - `skipped`: `Array<{ photo, reason: 'participant_not_found' | 'driver_not_found' }>`

- [ ] **Step 1: Write the failing test**

Create `tests/face-photo-import-mapping.test.ts`:
```typescript
/**
 * Tests for the pure import-mapping helper (face-photo-export-helpers.js).
 * Dual-export module — require() it directly, no DOM/IPC needed.
 */
import { describe, it, expect } from '@jest/globals';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveFacePhotoTargets } = require('../renderer/js/face-photo-export-helpers');

const participants = [
  { id: 'p-uuid-1', numero: '11' },
  { id: 'p-uuid-2', numero: '7' },
];
const driversByNewId: Record<string, Array<{ id: string; driver_order: number; driver_name: string }>> = {
  'p-uuid-1': [
    { id: 'd-uuid-a', driver_order: 0, driver_name: 'Rossi' },
    { id: 'd-uuid-b', driver_order: 1, driver_name: 'Bianchi' },
  ],
};

function photo(extra: Record<string, unknown>) {
  return {
    participant_numero: '11', driver_order: null, driver_name: null,
    image_base64: 'AAAA', ext: '.jpg', mime: 'image/jpg',
    photo_type: 'reference', is_primary: false, detection_confidence: 0.9,
    ...extra,
  };
}

describe('resolveFacePhotoTargets', () => {
  it('maps a participant-level photo to the participant id', () => {
    const { resolved, skipped } = resolveFacePhotoTargets([photo({})], participants, driversByNewId);
    expect(skipped).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].participantId).toBe('p-uuid-1');
    expect(resolved[0].driverId).toBeNull();
  });

  it('maps a driver-level photo by driver_order to the driver id', () => {
    const { resolved } = resolveFacePhotoTargets(
      [photo({ driver_order: 1, driver_name: 'Bianchi' })], participants, driversByNewId,
    );
    expect(resolved[0].driverId).toBe('d-uuid-b');
    expect(resolved[0].participantId).toBeNull();
  });

  it('matches numero regardless of string/number type', () => {
    const { resolved } = resolveFacePhotoTargets(
      [photo({ participant_numero: 7 })], participants, driversByNewId,
    );
    expect(resolved[0].participantId).toBe('p-uuid-2');
  });

  it('skips a photo whose participant_numero is absent', () => {
    const { resolved, skipped } = resolveFacePhotoTargets(
      [photo({ participant_numero: '999' })], participants, driversByNewId,
    );
    expect(resolved).toEqual([]);
    expect(skipped[0].reason).toBe('participant_not_found');
  });

  it('skips a driver photo whose driver_order has no match', () => {
    const { resolved, skipped } = resolveFacePhotoTargets(
      [photo({ driver_order: 5, driver_name: 'Ghost' })], participants, driversByNewId,
    );
    expect(resolved).toEqual([]);
    expect(skipped[0].reason).toBe('driver_not_found');
  });

  it('handles empty / missing input arrays', () => {
    expect(resolveFacePhotoTargets([], participants, driversByNewId)).toEqual({ resolved: [], skipped: [] });
    expect(resolveFacePhotoTargets(undefined, participants, driversByNewId)).toEqual({ resolved: [], skipped: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx jest tests/face-photo-import-mapping.test.ts
```
Expected: FAIL — `Cannot find module '../renderer/js/face-photo-export-helpers'`.

- [ ] **Step 3: Write the helper**

Create `renderer/js/face-photo-export-helpers.js`:
```javascript
/**
 * Pure helpers for preset face-photo export/import (JSON v3.0).
 *
 * Dual-export: CommonJS for Jest, browser global `window.facePhotoHelpers`
 * for the renderer (loaded via <script> in index.html). No DOM, no IPC, no
 * network — keep it pure so it stays unit-testable.
 */
(function () {
  /**
   * Map exported face_photos[] entries onto freshly-created participant /
   * driver IDs. Participant photos carry driver_order === null and map by
   * participant_numero; driver photos map by (participant_numero, driver_order).
   *
   * @returns {{ resolved: Array<{photo, participantId: (string|null), driverId: (string|null)}>,
   *             skipped: Array<{photo, reason: string}> }}
   */
  function resolveFacePhotoTargets(facePhotos, savedParticipants, driversByNewId) {
    const byNumero = {};
    (savedParticipants || []).forEach(function (p) {
      byNumero[String(p.numero)] = p;
    });

    const resolved = [];
    const skipped = [];

    (facePhotos || []).forEach(function (fp) {
      const participant = byNumero[String(fp.participant_numero)];
      if (!participant) {
        skipped.push({ photo: fp, reason: 'participant_not_found' });
        return;
      }
      if (fp.driver_order === null || fp.driver_order === undefined) {
        resolved.push({ photo: fp, participantId: participant.id, driverId: null });
        return;
      }
      const drivers = driversByNewId[participant.id] || [];
      const driver = drivers.find(function (d) { return d.driver_order === fp.driver_order; });
      if (!driver) {
        skipped.push({ photo: fp, reason: 'driver_not_found' });
        return;
      }
      resolved.push({ photo: fp, participantId: null, driverId: driver.id });
    });

    return { resolved: resolved, skipped: skipped };
  }

  const api = { resolveFacePhotoTargets: resolveFacePhotoTargets };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.facePhotoHelpers = api;
  }
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx jest tests/face-photo-import-mapping.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/js/face-photo-export-helpers.js tests/face-photo-import-mapping.test.ts
git commit -m "feat: pure import-mapping helper for preset face photos (v3.0)"
```

---

## Task 2: Main-process export query + IPC handler

Gather a preset's face photos (all of them, regardless of `is_active`), resolve each to a portable linkage, download the bytes, and return them base64-encoded.

**Files:**
- Modify: `src/database-service.ts` (add `getPresetFacePhotosForExport` near `loadPresetFaceDescriptors`, ~line 3929)
- Modify: `src/ipc/preset-face-handlers.ts` (add handler after `preset-face-load-for-preset`, ~line 374; import the new fn)
- Modify: `src/preload.ts` (add channel to `validInvokeChannels`, after line 244)

**Interfaces:**
- Produces (database-service):
  - `interface FacePhotoExportRow { participant_numero: string; driver_order: number | null; driver_name: string | null; photo_type: string; is_primary: boolean; detection_confidence: number | null; storage_path: string; }`
  - `getPresetFacePhotosForExport(presetId: string): Promise<FacePhotoExportRow[]>`
- Produces (IPC channel `preset-face-export-for-preset`, arg `presetId: string`):
  - `{ success: true, facePhotos: Array<{ participant_numero, driver_order, driver_name, photo_type, is_primary, detection_confidence, image_base64: string, ext: string, mime: string }>, count: number } | { success: false, error: string, facePhotos: [], count: 0 }`
- Consumes: `STORAGE_BUCKET` constant and `path` import already present in `preset-face-handlers.ts`; `authService.getSupabaseClient()`.

- [ ] **Step 1: Add the export query to database-service.ts**

Insert immediately **before** `export async function loadPresetFaceDescriptors(` (line ~3929) in `src/database-service.ts`:
```typescript
export interface FacePhotoExportRow {
  participant_numero: string;
  driver_order: number | null; // null = participant-level photo
  driver_name: string | null;  // sanity hint for import; null when participant-level
  photo_type: string;
  is_primary: boolean;
  detection_confidence: number | null;
  storage_path: string;
}

/**
 * Collect ALL face reference photos of a preset for a portable export.
 * Unlike loadPresetFaceDescriptors, this does NOT filter on is_active and does
 * NOT require a descriptor — it returns every stored photo with a portable
 * linkage (participant numero + optional driver_order) plus its storage_path
 * so the caller can download the bytes. The embedding is intentionally omitted:
 * it is recomputed on import from the image.
 */
export async function getPresetFacePhotosForExport(presetId: string): Promise<FacePhotoExportRow[]> {
  const supabase = authService.getSupabaseClient();
  const rows: FacePhotoExportRow[] = [];

  // 1. Participants + their direct (participant-level) face photos.
  const { data: participants, error: pErr } = await supabase
    .from('preset_participants')
    .select(`
      id,
      numero,
      preset_participant_face_photos!participant_id (
        storage_path,
        photo_type,
        is_primary,
        detection_confidence
      )
    `)
    .eq('preset_id', presetId);
  if (pErr) {
    console.error('[DB] getPresetFacePhotosForExport (participants) error:', pErr);
    throw pErr;
  }

  const numeroByParticipantId: Record<string, string> = {};
  for (const p of participants || []) {
    numeroByParticipantId[(p as any).id] = String((p as any).numero);
    const photos = (p as any).preset_participant_face_photos || [];
    for (const ph of photos) {
      if (!ph.storage_path) continue;
      rows.push({
        participant_numero: String((p as any).numero),
        driver_order: null,
        driver_name: null,
        photo_type: ph.photo_type || 'reference',
        is_primary: ph.is_primary || false,
        detection_confidence: ph.detection_confidence ?? null,
        storage_path: ph.storage_path,
      });
    }
  }

  // 2. Drivers of those participants + their driver-level face photos.
  const participantIds = Object.keys(numeroByParticipantId);
  if (participantIds.length > 0) {
    const { data: drivers, error: dErr } = await supabase
      .from('preset_participant_drivers')
      .select('id, driver_order, driver_name, participant_id')
      .in('participant_id', participantIds);
    if (dErr) {
      console.error('[DB] getPresetFacePhotosForExport (drivers) error:', dErr);
      throw dErr;
    }

    const driverMeta: Record<string, { order: number; name: string; numero: string }> = {};
    for (const d of drivers || []) {
      const numero = numeroByParticipantId[(d as any).participant_id];
      if (!numero) continue;
      driverMeta[(d as any).id] = {
        order: (d as any).driver_order,
        name: (d as any).driver_name,
        numero,
      };
    }

    const driverIds = Object.keys(driverMeta);
    if (driverIds.length > 0) {
      const { data: driverPhotos, error: dpErr } = await supabase
        .from('preset_participant_face_photos')
        .select('driver_id, storage_path, photo_type, is_primary, detection_confidence')
        .in('driver_id', driverIds);
      if (dpErr) {
        console.error('[DB] getPresetFacePhotosForExport (driver photos) error:', dpErr);
        throw dpErr;
      }
      for (const ph of driverPhotos || []) {
        const meta = driverMeta[(ph as any).driver_id];
        if (!meta || !ph.storage_path) continue;
        rows.push({
          participant_numero: meta.numero,
          driver_order: meta.order,
          driver_name: meta.name,
          photo_type: ph.photo_type || 'reference',
          is_primary: ph.is_primary || false,
          detection_confidence: ph.detection_confidence ?? null,
          storage_path: ph.storage_path,
        });
      }
    }
  }

  return rows;
}
```

- [ ] **Step 2: Add the IPC handler**

In `src/ipc/preset-face-handlers.ts`, add `getPresetFacePhotosForExport` to the existing `database-service` import (find the line importing `loadPresetFaceDescriptors` from `'../database-service'` and add the new name to that import list). Then insert this handler immediately after the closing `});` of the `preset-face-load-for-preset` handler (~line 374):
```typescript
  /**
   * Export all face reference photos of a preset as base64 image bytes with a
   * portable linkage. Downloads each image via the authenticated storage client
   * (works regardless of bucket visibility). Unreadable photos are skipped, not
   * fatal — the export proceeds with whatever it can read.
   */
  ipcMain.handle('preset-face-export-for-preset', async (_, presetId: string) => {
    try {
      const supabase = authService.getSupabaseClient();
      const exportRows = await getPresetFacePhotosForExport(presetId);
      const facePhotos: Array<Record<string, unknown>> = [];

      for (const row of exportRows) {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .download(row.storage_path);
        if (error || !data) {
          console.error('[PresetFace IPC] Export download failed for', row.storage_path, error);
          continue;
        }
        const buffer = Buffer.from(await data.arrayBuffer());
        const ext = path.extname(row.storage_path) || '.jpg';
        facePhotos.push({
          participant_numero: row.participant_numero,
          driver_order: row.driver_order,
          driver_name: row.driver_name,
          photo_type: row.photo_type,
          is_primary: row.is_primary,
          detection_confidence: row.detection_confidence,
          image_base64: buffer.toString('base64'),
          ext,
          mime: `image/${ext.replace('.', '')}`,
        });
      }

      return { success: true, facePhotos, count: facePhotos.length };
    } catch (error) {
      console.error('[PresetFace IPC] Export for preset error:', error);
      return { success: false, error: (error as Error).message, facePhotos: [], count: 0 };
    }
  });
```

- [ ] **Step 3: Whitelist the channel in preload.ts**

In `src/preload.ts`, in the `validInvokeChannels` array, add a line immediately after `'preset-face-load-for-preset',` (line ~244):
```typescript
  'preset-face-export-for-preset',
```

- [ ] **Step 4: Compile to verify no new type errors**

Run:
```bash
npm run compile 2>&1 | grep -E "database-service\.ts|preset-face-handlers\.ts|preload\.ts" || echo "no new errors in touched files"
```
Expected: `no new errors in touched files` (the repo has a pre-existing error baseline elsewhere; our three files must be clean).

- [ ] **Step 5: Commit**

```bash
git add src/database-service.ts src/ipc/preset-face-handlers.ts src/preload.ts
git commit -m "feat: main-process export of preset face photos as base64 (v3.0)"
```

---

## Task 3: Renderer export — append face_photos[] and bump to v3.0

**Files:**
- Modify: `renderer/js/participants-manager.js` (`exportPresetJSON`, ~lines 4217–4244)
- Modify: `renderer/index.html` (add `<script>` for the helper, line ~394)

**Interfaces:**
- Consumes: IPC `preset-face-export-for-preset` (Task 2); `window.api.invoke`, `showNotification`, browser `confirm`.

- [ ] **Step 1: Load the helper in index.html**

In `renderer/index.html`, immediately **before** line 394 (`<script src="js/driver-helpers.js"></script>`), add:
```html
  <script src="js/face-photo-export-helpers.js"></script>
```

- [ ] **Step 2: Bump version literal to 3.0**

In `renderer/js/participants-manager.js`, in the `exportData` object inside `exportPresetJSON`, change:
```javascript
    version: '2.2'  // Bump: car_model, nationality, driver_nationality support
```
to:
```javascript
    version: '3.0'  // Bump: face_photos[] (real image bytes) for portable face work
```

- [ ] **Step 3: Fetch + attach face photos with a privacy confirm**

In `renderer/js/participants-manager.js`, immediately **after** the `const exportData = { ... };` literal closes and **before** `const jsonString = JSON.stringify(exportData, null, 2);`, insert:
```javascript
    // v3.0: include the real face reference photos so the preset stays usable
    // after being handed to another user. Bytes come from the main process
    // (authenticated storage download). Privacy: faces travel — confirm first.
    let facePhotos = [];
    try {
      const faceResp = await window.api.invoke('preset-face-export-for-preset', presetId);
      if (faceResp.success) {
        facePhotos = faceResp.facePhotos || [];
      } else {
        console.error('[Participants] Face photo export failed:', faceResp.error);
      }
    } catch (e) {
      console.error('[Participants] Face photo export error:', e);
    }

    if (facePhotos.length > 0) {
      const proceed = confirm(
        `This preset includes ${facePhotos.length} uploaded face photo(s). ` +
        `The export will contain the actual face images so another user can reuse them. Continue?`
      );
      if (!proceed) {
        showNotification('Export cancelled', 'info');
        return;
      }
    }
    exportData.face_photos = facePhotos;
```

- [ ] **Step 4: Manual verification (no renderer unit harness)**

The renderer has no headless test harness for `exportPresetJSON` (DOM + IPC bound). Verify by running the app:
```bash
npm run dev
```
Then: open a preset that has face photos → Export JSON → confirm the dialog. Open the saved `.json` and check: `"version": "3.0"` and a non-empty `face_photos` array whose entries have `image_base64`, `participant_numero`, and `driver_order` (null for participant-level). Exporting a preset with **no** face photos must still produce a valid file with `"face_photos": []` and no confirm dialog.

- [ ] **Step 5: Commit**

```bash
git add renderer/js/participants-manager.js renderer/index.html
git commit -m "feat: export preset face photos in JSON v3.0 with privacy confirm"
```

---

## Task 4: Renderer import — restore face photos via the existing upload handler

**Files:**
- Modify: `renderer/js/participants-manager.js` (`importJsonPreset`, ~lines 5963–6045)

**Interfaces:**
- Consumes: `window.facePhotoHelpers.resolveFacePhotoTargets` (Task 1); IPC `preset-face-upload-photo` (existing) and `auth-get-session` (existing); variables in scope: `presetId` (created preset id), `savedParticipants`.

- [ ] **Step 1: Track drivers-by-new-id while creating drivers**

In `importJsonPreset`, the drivers branch loops over `participantsWithDrivers` calling `preset-create-drivers-batch`. Declare a map just **before** that `for` loop:
```javascript
      const driversByNewId = {};
```
and inside the loop, immediately **after** the `const driversForP = driversByParticipant[savedP.numero];` line, add:
```javascript
        driversByNewId[savedP.id] = driversForP.map(d => ({
          id: d.id, driver_order: d.driver_order, driver_name: d.driver_name
        }));
```
Then **hoist** `driversByNewId` so it is visible after the drivers `if/else` block: move its declaration to just before `if (presetData.drivers && ...)` and initialize it to `{}` there instead (remove the inner declaration, keep the inner assignment). Final shape: `const driversByNewId = {};` sits above the drivers branch; the assignment line stays inside the loop.

- [ ] **Step 2: Import face photos after participants + drivers exist**

In `importJsonPreset`, immediately **after** the entire `if (presetData.drivers ...) { ... } else { ... }` block closes and **before** `closeJsonImportModal();`, insert:
```javascript
    // v3.0: restore uploaded face reference photos. Replay each through the
    // existing preset-face-upload-photo handler, which re-uploads under THIS
    // user's storage and recomputes the AuraFace embedding on this machine.
    // Fail-clear: photos that can't be re-embedded are skipped + reported,
    // never aborting the import.
    if (presetData.face_photos && Array.isArray(presetData.face_photos) && presetData.face_photos.length > 0) {
      let userId = null;
      try {
        const sess = await window.api.invoke('auth-get-session');
        if (sess && sess.session && sess.session.user) userId = sess.session.user.id;
      } catch (e) {
        console.error('[Participants] Could not get session for face import:', e);
      }

      if (!userId) {
        showNotification('Face photos skipped: not signed in.', 'warning');
      } else {
        const { resolved, skipped } = window.facePhotoHelpers.resolveFacePhotoTargets(
          presetData.face_photos, savedParticipants, driversByNewId
        );

        if (resolved.length > 0) {
          setPresetSavePhase({
            title: 'Importing face photos…',
            message: `0 / ${resolved.length}`,
            percent: 0
          });
        }

        let imported = 0;
        let failed = skipped.length;
        for (let i = 0; i < resolved.length; i++) {
          const r = resolved[i];
          const up = await window.api.invoke('preset-face-upload-photo', {
            participantId: r.participantId || undefined,
            driverId: r.driverId || undefined,
            presetId: presetId,
            userId: userId,
            photoData: r.photo.image_base64,
            fileName: `import${r.photo.ext || '.jpg'}`,
            detectionConfidence: r.photo.detection_confidence || undefined,
            photoType: r.photo.photo_type || 'reference',
            isPrimary: r.photo.is_primary || false
          });
          if (up && up.success) {
            imported++;
          } else {
            failed++;
            console.error('[Participants] Face photo import failed:', up && up.error);
          }
          updatePresetSaveOverlay({
            percent: Math.round(((i + 1) / resolved.length) * 100),
            message: `${i + 1} / ${resolved.length}`
          });
        }

        const total = presetData.face_photos.length;
        const faceMsg = failed > 0
          ? `Face photos: ${imported}/${total} imported, ${failed} skipped (face not detected / recognition unavailable).`
          : `Face photos: ${imported}/${total} imported.`;
        showNotification(faceMsg, failed > 0 ? 'warning' : 'success');
      }
    }
```

- [ ] **Step 3: Compile renderer is N/A — sanity-check the helper is loaded**

The renderer is plain JS (no build). Confirm the helper global exists at runtime by checking the script tag from Task 3 Step 1 is present:
```bash
grep -n "face-photo-export-helpers.js" renderer/index.html
```
Expected: one match before the `driver-helpers.js` line.

- [ ] **Step 4: Manual round-trip verification**

Run the app and execute the spec's acceptance test:
```bash
npm run dev
```
- On account A: export a preset that has both participant-level and driver-level face photos (Task 3).
- Sign in as account B (or a second machine with the AuraFace model present): Import Preset → select the v3.0 JSON.
- Verify: (a) the participants/drivers show their reference photos, (b) the summary notification reports `imported/total`, and (c) a test analysis with a known face matches the imported reference.
- Backward-compat: import a pre-3.0 JSON (no `face_photos`) → imports cleanly, no face step, no errors.

- [ ] **Step 5: Commit**

```bash
git add renderer/js/participants-manager.js
git commit -m "feat: import preset face photos via existing upload handler (v3.0)"
```

---

## Self-Review

**Spec coverage:**
- Format v3.0 single JSON + `face_photos[]` base64 → Task 3.
- `face_photos[]` entry shape (image bytes + participant_numero/driver_order + photo_type/is_primary/detection_confidence; no embedding) → Task 2 (handler output) + Task 3 (attach).
- Export flow (new `preset-face-export-for-preset` handler, download + base64, privacy confirm) → Task 2 + Task 3.
- Import flow (map to new ids, replay through `preset-face-upload-photo`, recompute embedding) → Task 1 (mapping) + Task 4.
- Error handling (skip + summary, never abort) → Task 1 (`skipped`) + Task 4 (`failed`/summary).
- Backward compatibility (no `face_photos` → unchanged) → Task 4 guard + Task 3 (`[]`).
- Scope boundaries (desktop only, no schema change, reuse upload path) → Global Constraints; no migration/web/edge task exists by design.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type/name consistency:** `resolveFacePhotoTargets`, `getPresetFacePhotosForExport`, `FacePhotoExportRow`, channel `preset-face-export-for-preset`, and the `face_photos[]` entry keys (`participant_numero`, `driver_order`, `driver_name`, `image_base64`, `ext`, `mime`, `photo_type`, `is_primary`, `detection_confidence`) are used identically across Tasks 1–4. `preset-face-upload-photo` param names (`participantId`, `driverId`, `presetId`, `userId`, `photoData`, `fileName`, `detectionConfidence`, `photoType`, `isPrimary`) match the handler's documented signature.

**Known limitation (documented, not a gap):** import requires the AuraFace model on the importing machine; without it those photos are reported as skipped — this is the chosen fail-clear behavior, not an oversight.
