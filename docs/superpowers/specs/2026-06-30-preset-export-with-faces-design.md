# Preset Export/Import with Face Photos — Design

**Date:** 2026-06-30
**Author:** Federico (with Claude)
**Scope:** RaceTagger Desktop (`racetagger-desktop-v2`) only
**Status:** Approved design — ready for implementation plan

## Problem

When a user exports a participants preset to JSON to hand it to another user, the
exported file contains only textual participant/driver/folder metadata. The
face-recognition reference photos the user uploaded (often the most time-consuming
part of preparing a preset) are **not** included and are lost on re-import.

Confirmed by code inspection:
- Export (`exportPresetJSON`, `renderer/js/participants-manager.js`, ~lines 4156–4280,
  format version `"2.2"`) serializes only `participants[]`, `drivers[]`,
  `custom_folders`. No face data.
- Import (`importJsonPreset`, same file, ~lines 5909–6060) recreates
  `participant_presets`, `preset_participants`, `preset_participant_drivers`.
  It never touches face photos.
- Face photos live in a separate table `preset_participant_face_photos` and the
  storage bucket `preset-participant-photos`, both scoped to the owning `user_id`
  via RLS. Another user cannot reuse the original rows or storage objects.

## Goal

Let a user export a preset **including the uploaded face reference photos**, so a
second user can import it and continue working — face recognition active, with the
reference faces visible.

Decision (user, 2026-06-30): export the **real image files** (not embeddings-only).
Rationale: the recipient continues the same work on the same drivers, needs the
reference thumbnails to work and to trust the match, and is protected against a
future face-model change (real images can be re-embedded; bare vectors cannot).

## Key technical facts that shaped the design

1. **Matching uses only the embedding vector, not the image.** At analysis time the
   matcher reads `face_descriptor_512` (AuraFace) / `face_descriptor` (legacy 128-dim)
   and compares via cosine / euclidean similarity
   (`face-recognition-onnx-processor.ts`, `unified-image-processor.ts`). The reference
   `photo_url` is UI metadata only, never re-downloaded at match time.
2. **The descriptor is computed client-side on upload.** The existing IPC handler
   `preset-face-upload-photo` (`src/ipc/preset-face-handlers.ts`, ~lines 53–256) runs
   the local AuraFace ONNX pipeline on the uploaded image buffer and recomputes the
   512-dim embedding **every time**. It accepts base64 image data. It is **fail-loud**:
   if the model can't run / no face is detected, it deletes the just-uploaded storage
   object and returns an error — it never persists a descriptor-less photo.
3. **Storage paths are not portable.** Path is
   `${userId}/${presetId}/${participantOrDriverId}/${uuid}.${ext}`. All three leading
   segments differ across accounts; RLS forces the importer to write under their own
   `auth.uid()`. So the importer must **re-upload the image bytes** and get fresh rows.
4. **Schema:** `preset_participant_face_photos.photo_url` and `storage_path` are
   `TEXT NOT NULL`. Real photos populate them normally — **no schema change needed**.
5. **Face recognition is IN TESTING**, gated per-account by the DB flag
   `face_recognition_enabled` (UI gate only). Imported face rows are plain data and can
   be stored regardless; they become usable once the flag is on for that account.

## Design

### Format — single self-contained JSON, version `"3.0"`

Extend the current export format (bump `version` `"2.2"` → `"3.0"`) with a new
top-level array `face_photos[]` carrying the image bytes as base64. The export stays a
single `.json` file. No zip, no new dependency.

> **Rejected — zip bundle (`.rtpreset`):** reference photos are small crops; even ~100
> photos stay in the order of a few–tens of MB inside one JSON, which Electron handles.
> A zip adds a packaging library + pack/unpack code for no real benefit at this scale.
> **Rejected — embeddings-only export:** would avoid sharing images and keep the file
> small, but the recipient would get no reference thumbnail and the vectors would be
> locked to AuraFace v1 (un-recomputable without the image). User chose real photos.

### `face_photos[]` entry shape

Each entry contains:
- `image_base64` — the raw image bytes, base64-encoded
- `mime` / `ext` — to reconstruct the file
- **Linkage (exactly one of):**
  - `participant_numero` — when the photo belongs to a participant, OR
  - `participant_numero` + `driver_order` (+ `driver_name` as a sanity check) — when the
    photo belongs to a specific driver of that participant
  - (mirrors the DB CHECK: a face row references a participant XOR a driver)
- `photo_type` — `reference` | `action` | `podium` | `helmet_off`
- `is_primary` — boolean
- `detection_confidence` — number (carried for fidelity; not required by import)

The embedding vector is **not** exported — the import handler recomputes it from the
image, so carrying it would be dead weight.

### Export flow

1. New main-process IPC handler `preset-get-face-photos-for-export`: given a `presetId`,
   query `preset_participant_face_photos` joined to the preset's participants and
   drivers, **download each image** from its public `photo_url`, base64-encode it, and
   return the entries with their linkage + metadata.
2. `exportPresetJSON` calls this handler and appends the result as `face_photos[]`,
   sets `version: "3.0"`, and writes the file as today.
3. Before writing, show a one-line confirmation: *"L'export includerà le foto dei volti
   caricate per questo preset."* (privacy awareness — lightweight).

> Requires network (image download). Consistent with presets being online-required;
> this is not one of the two offline-allowed flows (results review / results export).

### Import flow

1. `importJsonPreset` proceeds as today: create `participant_presets`,
   `preset_participants`, `preset_participant_drivers`. This yields the **new** DB ids.
2. If `face_photos[]` is present, for each entry:
   - Resolve the target id on the freshly-created preset:
     - participant: look up the new participant by `participant_numero`
     - driver: find that participant, then its driver by `driver_order` (validate
       against `driver_name`)
   - Feed the base64 image to the existing `preset-face-upload-photo` IPC handler with
     the resolved `participantId` / `driverId`, the importer's `userId`, the new
     `presetId`, and the carried `photo_type` / `is_primary`.
   - That handler uploads under the importer's own storage path and **recomputes the
     AuraFace embedding** on the importer's machine — reusing the existing robust path.

### Error handling (fail-clear, never silent)

- A face photo can fail for two expected reasons on the importer's side: the AuraFace
  model isn't available, or no face is detected in the image. In both cases the existing
  handler already fails that single photo and cleans up its storage object.
- The import **collects per-photo failures and continues** — participants, drivers, and
  all valid photos are imported. At the end it surfaces a summary, e.g.
  *"Importate 18/20 foto-volto; 2 saltate (volto non rilevato / riconoscimento non
  disponibile)."*
- The preset import **never aborts** because of face-photo failures.

> **Rejected — carry the vector as a fallback for machines without the model:** would
> require a second, direct-insert code path (bypassing the fail-loud handler) and special
> handling. Realistic recipients who care about face work already have the model
> (face recognition is the feature they're using). Keep one path; report skips clearly.

## What this does NOT touch (scope boundaries)

- **Desktop only.** No changes to the web app, Edge Functions, token logic, or DB schema.
- No format toggle, no embeddings-only path, no zip (all considered and rejected above).
- `face_recognition_enabled` gates only the UI; imported face rows are stored as data and
  become usable when the flag is enabled for the importing account.

## Components / units

| Unit | Responsibility | Depends on |
|---|---|---|
| `preset-get-face-photos-for-export` (new IPC, main) | Fetch + base64-encode a preset's face photos with linkage | Supabase client, `preset_participant_face_photos`, public `photo_url` |
| `exportPresetJSON` (renderer, modified) | Append `face_photos[]`, bump to v3.0, privacy confirm | new IPC above |
| `importJsonPreset` (renderer, modified) | Map each face photo to new participant/driver id, replay through upload handler, aggregate skips | `preset-face-upload-photo` (existing) |

## Verification

- `npm run compile` — TypeScript clean on the touched files.
- **Round-trip manual test:** on account A, export a preset that has face photos →
  import the JSON on account B → verify (a) the reference photos appear under the
  participants/drivers, and (b) a test analysis face-matches against them.
- Backward compatibility: importing an old v2.2 JSON (no `face_photos[]`) still works
  (the array is simply absent → no face step).

## Open questions

None blocking. Format, scope, and error behavior are settled.
