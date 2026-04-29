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

### Coupling with item #1
The Export & IPTC fix from item 1 should be implemented AFTER this
redesign so it consumes the new `folders: jsonb` array directly,
not the legacy `folder_1/2/3` columns. Otherwise we'd write that
code, then immediately rewrite it post-migration.

### Suggested release plan
- **1.1.5 patch** — pure bug fixes if any (none open right now).
- **1.2.0** — schema migration + UX redesign of custom folders +
  Export & IPTC honoring `folders[]`. Single coherent release.

---

## How to add to this file
When a new issue surfaces post-1.1.4 that's worth queuing instead of
fixing immediately, append it as a new section with the same
`Symptom / Root cause / What fixed looks like / Affected files`
shape. Keep entries terse — pointers, not essays.
