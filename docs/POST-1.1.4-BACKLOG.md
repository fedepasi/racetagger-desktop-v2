# Post-1.1.4 Backlog

> Created: 2026-04-29 — after the 1.1.4 ship-to-small-audience release.
>
> This file is the running list of issues we know about but deferred from
> 1.1.4. Two of them are tightly coupled around custom folders (preset
> Personalize your Folder Organization feature) and should be tackled
> together in the same release cycle.

---

## 1. BUG — Export & IPTC ignores preset custom folders

### Symptom
The "Export & IPTC" modal in `results.html` does NOT honor the custom
folder assignments configured in the preset's "📁 Personalize your Folder
Organization" UI. Photographers who carefully configured `folder_1`,
`folder_2`, `folder_3` per participant (e.g. for sponsor delivery,
agency delivery, team manager folders) are surprised when Export to
Folder writes only to the single subfolder pattern of the modal,
ignoring their preset setup entirely.

### Root cause
- `src/utils/folder-organizer.ts:328-339` reads `csvData.folder_1/2/3`
  (and `folder_*_path`) and copies the photo to ALL assigned custom
  folders. Flusso A (Organize Photos into Folders during analysis) is
  fine — it honors the assignments.
- `src/ipc/unified-export-handler.ts` and
  `renderer/js/unified-export-iptc-modal.js` have ZERO references to
  `folder_1/2/3` / `customFolders` / `custom_folders`. The modal
  exposes only one `subfolderPattern` field that generates a single
  destination per photo. Flusso B (Export & IPTC) is the gap.

### What "fixed" looks like
A new toggle in the Export & IPTC modal: "Follow preset folder
assignments" — **default ON** (Federico's call, 2026-04-29). The
rationale is that whoever bothered to configure custom folders in
the preset clearly wants them to be honored — they are the more
likely intent, not the exception. Users who explicitly do NOT want
multi-destination delivery on a given run can untick it.

When on:
1. For each photo, read the matched participant's custom folder list
   from the preset.
2. For each assigned folder, duplicate the export (copy + IPTC write)
   to that folder. Honor `_path` (absolute paths) when present, fall
   back to a subfolder under destinationFolder otherwise.
3. The existing `fileConflictStrategy` (rename/overwrite/skip) and
   `metadataStrategy` (merge/replace) toggles must apply to EACH
   destination independently.

### Edge cases of "default ON"
Two cases need handling so the default doesn't surprise the user:

- **Preset has no custom folders configured** → toggle should still
  be ON by default but render as a no-op (greyed-out hint
  "No custom folders in this preset"). Behavior reverts to the
  single-destination subfolder pattern, exactly like today.
- **Some participants have folders, others don't** → photos of
  participants WITHOUT folders still go to the single subfolder
  destination. Photos WITH folders go to single destination + each
  custom folder. Show a count in the modal preview:
  "12 photos → 1 destination, 8 photos → 1+2 destinations,
   4 photos → 1+3 destinations."

### Affected files
- `src/ipc/unified-export-handler.ts` — add the multi-destination loop
- `src/utils/export-destination-processor.ts` — already has the right
  shape for multi-destination, can probably be reused
- `renderer/js/unified-export-iptc-modal.js` — add the toggle + UI
  preview of effective destinations per photo

### Notes
This bug shipped in 1.1.4. Internal users who relied on
folder_1/2/3 for delivery will hit it.

---

## 2. UX REDESIGN — Custom folders: drop the 3-slot limit, add on-the-fly creation

### Current model (broken-ish)
- Preset stores `custom_folders: jsonb[]` (the global list).
- Each participant has rigid columns `folder_1`, `folder_2`, `folder_3`
  + `folder_1_path`, `folder_2_path`, `folder_3_path`.
- Workflow today: user MUST first declare folders in the global
  Personalize UI (with optional absolute path), THEN go participant
  by participant and pick from a dropdown of the 3 slots.
- Two friction points:
  a. The 3-slot cap. Real workflows (sponsor + agency + team manager
     + driver agent + ...) need more.
  b. The forced "declare-then-assign" two-step. Photographers don't
     plan folders upfront; they discover them as they fill in the
     participants ("oh, this driver also goes to the Press Pool").

### Federico's proposed redesign
Drop the global Personalize section entirely. Replace with:
- Per participant, a "+" button that:
  - Opens an autocomplete input pre-populated with all folder names
    already used elsewhere in this preset (so duplicates are easy to
    avoid via fuzzy match).
  - If the typed name matches an existing folder → assign.
  - If it's a new name → create on-the-fly (name + optional absolute
    path) and assign.
- Unlimited folders per participant.
- Loses: the global "summary" view AND the bulk-rename feature.

### My take (Claude)
Solid direction. The current 3-slot rigidity is a holdover from when
we modeled the schema as columns; with `custom_folders` already a
jsonb array on the preset, the participant side is the only thing
that needs to follow. Three additions worth keeping:

1. **Schema migration**: replace `folder_1/2/3` (+ `_path`) on each
   participant with a single `folders: jsonb` array of
   `{ name, path? }`. Forward-compat migration script: read the 3
   legacy columns, fold any non-empty into the new array, drop the
   old columns. Preserves all existing assignments.

2. **Autocomplete is non-negotiable**. Without it photographers will
   create "Sponsor BMW", "BMW Sponsor", "Sponsor-BMW", and "BMW
   sponsor" as four distinct folders within a week. The autocomplete
   should fuzzy-match (case-insensitive, ignoring punctuation/space)
   and prefer suggesting the existing canonical name.

3. **Opportunistic bulk-rename in lieu of the dropped global UI**:
   when the user renames a folder on one participant, detect that the
   old name is used by N other participants in the preset and prompt
   "Rename in 8 other participants too?". This recovers most of the
   bulk-rename utility without the dedicated screen.

4. **Path field stays optional and recessive**: each chip has a small
   "🔗" icon that opens a path picker if needed. Default = no path =
   "subfolder under wherever the user chose as export destination".
   Most users won't ever need the absolute path.

### Sub-issue: "all-or-nothing" custom folder behavior

A user surfaced this on 2026-04-29: today, if a participant has at
least one custom folder, the photo goes ONLY to that custom folder
and NOT to the default `{number}` folder. So a photographer who
wants both an organized-by-number archive AND delivery-targeted
folders has no clean way to do it (must add a custom folder named
literally "{number}", brittle).

The current "all or nothing" branch lives in
`src/utils/folder-organizer.ts:352-361`.

**Decision (2026-04-29):** add `include_default_folder_with_custom`
boolean column to `participant_presets` table.
- Default `false` for legacy migrated presets → preserves current
  "all or nothing" behavior, no surprise.
- Default `true` for newly-created presets in 1.2.0 → matches the
  natural expectation users describe.
- Editable via a checkbox at the top of the participants section in
  the preset editor: "Always include the default `{number}` folder
  for participants that have custom folders".
- One-time non-blocking banner the first time a 1.2.0 client opens
  a legacy preset whose flag is still `false`: "Tip: photos of
  participants with custom folders currently go ONLY to those
  folders. Want them also in the default `{number}` folder?
  [Enable] [Keep as-is]". Click sets the flag to `true`.

Both Flusso A (FolderOrganizer) and Flusso B (Export & IPTC) honor
the flag:
- Flusso A: when the flag is true AND `customFolderTargets.length > 0`,
  union the default pattern-based folder into `foldersToCreate`.
- Flusso B: same logic in `unified-export-handler.ts`. The modal
  exposes a per-export override (checkbox seeded from the preset
  flag, user can flip it for one-off "only-special-destinations"
  exports).

### Coupling with item #1
The Export & IPTC fix from item 1 should be implemented AFTER this
redesign so it consumes the new `folders: jsonb` array directly,
not the legacy `folder_1/2/3` columns. Otherwise we'd write that
code, then immediately rewrite it post-migration.

### Backward compatibility with 1.1.4 clients (decided 2026-04-29)

The DB is shared between all client versions, so anything we change
on the schema must coexist with 1.1.4 in the wild. Strategy chosen:
**dual-write + convergence-on-read with lazy migration** (no forced
update, no SQL backfill).

1. **Migration is additive AND empty.** Add `folders: jsonb` column
   with default `[]`. **Do NOT backfill from legacy in SQL** and
   **do NOT drop the legacy columns**. The migration is a single
   `ALTER TABLE ADD COLUMN` — atomic, fast, zero risk.
   The actual fold from `folder_1/2/3` into `folders[]` happens
   client-side, lazily, the first time a 1.2.0 client fetches each
   preset. Rationale: we have to write that client-side code anyway
   for the convergence path (1.1.4 modifies legacy after a 1.2.0
   write — see point 3 below), so we use it for the initial
   migration too. Same code, less SQL surface, self-healing.

2. **1.2.0 dual-writes.** Whenever we save a participant's folders,
   write to BOTH:
   - `folders[]` (full, unlimited) — the canonical store going forward
   - `folder_1/2/3` (+ `_path`) — populated from the FIRST THREE
     entries of `folders[]`, in order, so 1.1.4 keeps seeing a valid
     subset.
   Folders beyond position 3 are 1.2.0-exclusive but don't break
   1.1.4 because 1.1.4 can't render them anyway.

3. **1.2.0 convergence-on-read with first-fetch DB sync.**
   Convergence runs ONCE per fetch of the whole preset, NOT per
   consumer. Concretely: `getParticipantPresetByIdSupabase` (and its
   handful of cousins) loops over all participants of the loaded
   preset, classifies each one into one of the three states below,
   batches all needed DB updates into a single fire-and-forget
   UPDATE, and returns a fully normalized preset to the caller.
   Downstream consumers (Export & IPTC, FolderOrganizer, the preset
   editor UI of 1.2.0) only read `folders[]`. They have no awareness
   that `folder_1/2/3` exist. Single source of truth, single point
   of test.
   - **Lazy migration case** — `folders[]` empty + legacy populated
     (a row never touched by 1.2.0 yet, OR a row created by 1.1.4
     after the migration): rebuild `folders[]` from legacy AND fire
     a silent `UPDATE folders = ...` to the DB. Cost: one extra
     write per preset, exactly once in its lifetime. After that the
     DB has `folders[]` populated and lazy migration won't trigger
     again.
   - **Drift case** — first 3 entries of `folders[]` differ from
     legacy columns (signal: a 1.1.4 client wrote to legacy after
     last 1.2.0 write): treat legacy as source of truth for those 3,
     rebuild `folders[]` as `[legacy[0..2], ...folders[3..]]`, push
     back to DB on next save. Auto-heals any drift.
   - **Steady state** — `folders[]` populated and first 3 match
     legacy: nothing to do, return as-is. O(1) check.

4. **No DB triggers.** We rejected the bidirectional Postgres trigger
   approach (option D in the discussion) because it adds DB-level
   complexity that's hard to debug. The client-side normalize is
   simpler, observable in code, and rollback-safe.

5. **When can we drop the legacy columns?** Only after we are sure no
   1.1.4 client is in the wild — practically, after we bump
   `minimum_version` to 1.2.0 in the version_check feed. Keep that
   for a separate cleanup release (1.3.0 candidate).

### Suggested release plan
- **1.1.5 patch** — pure bug fixes if any (none open right now).
- **1.2.0** — schema migration (additive) + UX redesign + Export &
  IPTC honoring `folders[]` + dual-write + convergence-on-read.
  Coexists with 1.1.4 indefinitely.
- **1.3.0** (later, after 1.2.0 adoption) — drop legacy columns,
  bump minimum_version to 1.2.0.

---

## How to add to this file
When a new issue surfaces post-1.1.4 that's worth queuing instead of
fixing immediately, append it as a new section with the same
`Symptom / Root cause / What fixed looks like / Affected files`
shape. Keep entries terse — pointers, not essays.
