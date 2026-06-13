# Changelog - RaceTagger Desktop

## [Unreleased]

### ✨ Delivery

- **HD upload — real status + context-aware action (Phase 1)**: the gallery-detail
  "Executions in gallery" list now shows each execution's real HD (R2) upload status
  (`completed/total`, plus failed/uploading counts) instead of an unconditional
  "Retry HD upload" button. The action is context-aware — "Upload HD (N)" when none are
  uploaded, "Upload missing (N)" when partial, "Retry (N)" when some failed, and a green
  "HD ready" with no button when complete. Status is read live per execution via
  `delivery-r2-upload-status` — HD state lives on the image rows (`original_upload_status`),
  so this is the true state, not an assumption. Adding an execution whose originals are
  already on R2 now surfaces a dedup notice ("already on R2 — linked, no new upload") rather
  than implying a re-upload. Renderer-only — reuses existing IPC; no token, schema, or
  upload-logic change.

### 🎨 Brand

- **Delivery page redesign — foundation (Phase A)**: introduces a canonical app-wide toast
  (`renderer/js/toast.js`, `window.showToast`) — flat and brand-aligned (`#1a9ee0` + the
  four-colour functional palette), stacks top-right, dismiss-on-click, auto-dismiss. Replaces
  the gradient toast that was trapped inside `results-delivery.js`'s IIFE, so callers that
  check `typeof showToast === 'function'` (`settings.js`, `preset-face-manager.js`) now resolve
  it. Adds `renderer/css/delivery.css` with the redesign's component foundation (livery-stripe
  cards, mono+tnum numbers, status pills, chips, primary create-band, empty/first-run state,
  transfer-activity strip, timing-tower stats, segmented control). Both wired into `index.html`.
  CSS/JS only — no logic changes.

- **Delivery page redesign — galleries + clients (Phase B)**: re-skins the Delivery landing on
  the new "gallery is the unit of delivery" hierarchy. `delivery.html` gets a plain header
  ("Delivery" / "Share race photos with your clients."), a single primary `dl-create-band`,
  a galleries grid (`#galleries-grid`) with a 3-step empty state, and a compact, demoted Clients
  panel. `delivery-manager.js` rewrites `renderGalleries()`/`renderProjects()` to the new
  card markup — livery-stripe per status, JetBrains Mono stats (photos · views · downloads),
  the public-URL slug, and honest chips (access type, HD ready/pending, client tag) all guarded
  on real fields. Adds inline-SVG icons (`DL_ICONS`/`dlIcon`, since the renderer has no icon
  font) and routes `alert()` → the canonical toast (`dlNotify`) on gallery/client create.
  Markup + render-layer only — no IPC, token, or data-model changes.

- **Delivery page redesign — modals + gallery detail (Phase C)**: brings the six Delivery
  modals onto the redesign system. Action buttons across create-gallery, create-client,
  invite-user, link-gallery, create-rule and gallery-detail now use the `dl-btn`
  primary/ghost/danger classes (flat, `#1a9ee0`); decorative emoji are removed from modal
  headers and the access-type `<select>` options; and the gallery-detail Statistics block
  becomes a "timing-tower" stat strip (`dl-stat-tower`, JetBrains Mono views/downloads in
  blue/green). Modal titles/buttons move to sentence case — including the JS-driven
  create/edit Rule strings (`delivery-manager.js`). All element IDs preserved; markup +
  display-string only — no IPC, token, or data-model changes.

- **Delivery page redesign — client detail, survey & banner (Phase D, part 1)**: brings the
  remaining static Delivery surfaces onto the system. The interest survey swaps its 🙏/📦 hero
  emoji for brand icon-wells (blue image / green check) and its fake-gradient submit for a flat
  `dl-btn--primary` ("Submit feedback"). The client-detail view drops the 🖼️/🔗/🔐/🔀 header
  emoji for plain section heads and moves its action buttons to `dl-btn--ghost` (with a `+`
  glyph). The post-execution routing banner loses its 🔀 for a green check, fixes a malformed
  `margin: 0 0: 12px`, and flattens its CTA. Two deprecated cyan `#06b6d4` accents (the
  FROM-PRESET tag, the gallery-link hover) collapse to `#1a9ee0`. Markup + display-string only.

- **Delivery page redesign — HD uploads (Phase D, part 2)**: cleans up the HD-uploads block.
  The ☁️/⟳/📦 emoji are dropped from the section header, the in-flight pill, and the empty
  state; the active-upload card's leftover deprecated blue (`rgba(59,130,246,…)` = `#3b82f6`)
  is corrected to `#1a9ee0` and its fake-gradient progress bar flattened to a solid fill. In
  `upload-monitor.js`, the JS-rendered active stats and history cards drop their 📁/⚠/✓ emoji
  (status now reads "Complete" / "N failed" in the existing green/red). Markup + display-string
  only — upload logic untouched. (Full demotion to a collapsible transfer-activity fold is
  deferred — it would require reworking the section's show/hide logic.)

- **Delivery page redesign — native alerts → canonical toast (Phase D, part 3)**: routes all
  40 native `alert()` notifications on the Delivery page through the brand toast (`dlNotify` →
  `window.showToast`), typed by intent — 33 errors (red) and 7 validation prompts (amber).
  No more blocking OS dialogs for delivery errors/validation; the canonical fallback to
  `alert()` inside `dlNotify` is preserved for environments without the toast. Native
  `confirm()` prompts (destructive yes/no) are intentionally left as-is. Display/UX only —
  no IPC, token, or data-model changes.

- **Delivery page redesign — de-emoji + colour-normalize rendered content (Phase D, part 4)**:
  finishes the brand pass on the JS-rendered Delivery surfaces. Every remaining emoji in
  `delivery-manager.js` is replaced — status/label prefixes (☁️/⏳/✓/✗/⚠/○/📷/📁/📂) are dropped,
  and the icon-only action buttons (resend ✉️, enable/disable ⏸/▶, delete 🗑, edit ✏️, copy 📋/✅)
  now render inline SVGs via the `dlIcon` helper (new `mail`/`pause`/`play`/`folder`/`edit`
  glyphs added). The R2 execution-status panel and rule criteria-tags are colour-normalized off
  their pre-brand hues (`#3b82f6`/`#60a5fa`/`#22c55e`/`#4ade80` and the `rgba(6,182,212)` cyan)
  onto the four-colour system (`#1a9ee0`/`#10b981`/`#f59e0b`/`#ef4444`); the routing-banner text,
  deliver-button states and the static copy/edit/refresh icons in `delivery.html` are cleaned to
  match. Net result: the Delivery layer is emoji-free (bar the `✕` close glyph) with no deprecated
  colours. Display/markup only — no IPC, token, or data-model changes.

- **Delivery page redesign — harden button colours (fix)**: pin the `dl-btn`
  primary/ghost/danger background + text colours with explicit values and `!important`.
  The desktop loads two conflicting `:root` themes (`styles.css` light vs `desktop-theme.css`
  dark) and the previous buttons inherited colour through theme vars, so in some cascade
  contexts the fill/contrast could drop out (black-on-dark, missing fill). Buttons now render
  a solid `#1a9ee0` primary (white text), a readable dark ghost, and a red danger regardless
  of which theme var wins. CSS only.

### 🔧 Matching

- **ACC-04 Phase 4 — series-sponsor UX (detect → user confirms → write)**:
  After a successful learned-data save, `save-learned-participant-data` now returns
  `seriesCandidates` (from `detectSeriesSponsors`) alongside the update count.
  If new candidates exist (not already in `preset.series_sponsor_ignore`),
  `learned-data-modal.js` transitions the modal to a second-step checklist instead of
  closing immediately. Sponsors with ≥70% event coverage are pre-checked; 40–70% are
  unchecked but visible. "Add to Ignore List" calls `supabase-update-participant-preset`
  with the merged `series_sponsor_ignore` array; "Skip" closes without writing.
  The log-visualizer passes `this.participantPresetData?.series_sponsor_ignore` to
  `learnedDataModal.show()` so already-ignored keys are excluded from the checklist.

- **ACC-04 Phase 2 — canonical sponsor dedup at write + series-sponsor dry-run**:
  `save-learned-participant-data` now uses `canonicalKey` / `clusterSponsors` / `pickDisplay`
  from `sponsor-canonical.ts` to deduplicate sponsors at write time: the CSV `sponsor` field
  filters new additions by canonical key (replacing case-insensitive exact match), and the
  `custom_fields.learned.sponsors` array merges via clustering (replacing a raw `Set` that
  let "DÖRR" and "DOERR" coexist). A dry-run series-sponsor detector accumulates sponsor
  frequency across all participants in a save batch, calls `detectSeriesSponsors`, and logs
  candidates with coverage % — no writes, surfaced in Phase 4.
  `learned-data-modal.js` aggregation key upgraded from `String(s).trim()` to a plain-JS
  canonical key (`_canonicalKey`) with umlaut expansion + NFD diacritic strip, eliminating
  case/umlaut duplicates in the proposal list before they ever reach the write path.

- **ACC-04 Phase 5 — export coherence (`unified-export-iptc-modal.js`)**:
  Two bugs fixed in the export path that caused the "number+driver right, team wrong"
  symptom to leak into exported IPTC/XMP metadata even after correcting the preset:
  (1) `p.numero === vehicle.raceNumber` strict-equality failed when `p.numero` is a DB
  integer and `raceNumber` is a string — changed to `String(p.numero) === String(...)`.
  (2) participant `name` and `team` were initialized from AI-detected vehicle data and
  preset only filled in the gap (`if (!participant.name) ...`). Changed to entry-first:
  `presetMatch.nome` and `presetMatch.squadra` always overwrite, so the canonical preset
  data takes authority over stale AI values in the JSONL log.

- **ACC-04 Phase 3 — coherence cascade for MANUAL review path**:
  When the user picks a candidate in the review panel (`resolveReview`), the renderer
  now attaches the full preset entry (`chosenParticipant`) to the correction payload.
  `update-analysis-log` in main.ts calls `cascadeEntryToVehicle` on the vehicle in
  JSONL, overwriting ALL fields (team, drivers, category, make/model, sponsors, metatag)
  from the entry — not just the slim `participantName + team` the candidate card carries.
  The B1 overrides (`matchStatus`, `matchedBy`, `confidence`) are re-applied after the
  cascade. `primaryVehicle` mirror is synced for vehicleIndex 0. No extra DB query —
  the renderer uses its already-loaded `this.presetParticipants`.

- **ACC-04 Phase 1 — preset-entry coherence cascade (AUTO + TEMPORAL paths)**:
  `applyCorrectionsToAnalysis` now calls `cascadeEntryToVehicle` so ALL fields
  (team, drivers, category, make/model, sponsors, plate, metatag) derive from the
  matched preset entry — not partial AI values. Empty entry fields clear the vehicle
  field to null (`clearMissing: true`), killing the "number+driver right, team wrong"
  class of bug. The temporal-rescore flip now uses the same cascade (replacing a
  broken `nome.split` that lost co-drivers and skipped category/make/model/sponsors)
  and syncs `finalResult` via the cascade.

- **ACC-04 Phase 0 — sponsor & coherence foundation (no behaviour change)**: adds
  `src/matching/sponsor-canonical.ts` (pure canonical key + bidirectional umlaut
  normalisation + clustering + series-sponsor detection helpers) and
  `src/matching/entry-cascade.ts` (`cascadeEntryToVehicle` — single authoritative
  function to overwrite all vehicle fields from a resolved preset entry).
  `SmartMatcher.normalizeSponsorValue` now delegates to `sponsor-canonical.normalizeSponsor`
  (identical behaviour). 52 new unit tests. Foundation for Phase 1 (coherence cascade)
  and Phase 2 (sponsor dedup + series-sponsor detection UX).

## [1.1.10] - 2026-06-11

### 🎨 Brand

- **Desktop brand tokens — accent colour + monospace font**: replaces the deprecated blue
  `#3b82f6` and indigo `#6366f1` accent colours with the canonical RaceTagger blue `#1a9ee0`
  across all renderer CSS files (`desktop-theme.css`, `auth.css`, `admin-features.css`,
  `delight-system.css`, `enhanced-file-browser.css`, `feedback-modal.css`, `home-user.css`,
  `participants.css`, `results-integrated.css`) and inline styles in `delivery.html`/`results.html`.
  Adds JetBrains Mono (Google Fonts, weight 400 + 700) to `index.html` and introduces the
  `--font-mono-rt` CSS variable with `font-feature-settings: "tnum"` applied to `.mono`, `code`,
  `.token-value`, `#app-version`, `.results-stat-value`, and `.rt-num`. CSS/markup only —
  no TypeScript or logic changes.

### ✨ Features

- **Face recognition — AuraFace v1 ONNX engine (backend, flag-off)**: rewrites the
  face-recognition engine to run entirely in the main process — YuNet (detection) +
  AuraFace v1 512-dim embeddings (cosine matching) via onnxruntime-node, replacing the
  renderer-side face-api.js/canvas path. Ships **disabled**: gated by two DB flags
  (`sport_categories.face_recognition_enabled` per category + per-user
  `face_recognition_enabled`), both default-off. Hardened for production: AuraFace
  downloads via the app's authenticated Supabase client (was a broken process.env path
  that hit the wrong project in packaged builds), streamed to disk with atomic
  promotion + size check (no ~500MB RAM peak, no "sticky" corrupt file), and disables
  cleanly with a log when the model/embedder can't load instead of returning silent
  zero-matches. Includes 18 unit tests (YuNet decoding, cosine matching, model-missing
  behavior). UI remains "Coming Soon"; the in-app face panel is a follow-up.

- **Visual tagging — calendar-anchor grounding**: the desktop now forwards
  `preset_name`, `sport_category`, and the photo's EXIF `photo_taken_at` + GPS
  coordinates to the `visualTagging` edge function at every invoke site (standard,
  crop+context, ONNX, face-recognition, scene-skip and sequential fallback). The
  edge function (already live) uses these to look up `event_calendar` and ground
  `location_tags` against the real event, reducing location hallucinations (e.g.
  NBR 24h photos tagged as Le Mans — issue #159). All fields are optional; when
  absent the edge function falls back to vanilla Gemini, so there's no regression.
  No schema/migration changes. (PR #198)

- **Bulk folder assignment — backend (IPC + DB layer)**: adds `bulkAssignFoldersSupabase`
  with append/replace modes, per-row UPDATE chains (avoids NOT NULL upsert constraint),
  dual-write to legacy `folder_1/2/3` columns, unknown-folder reporting, cache
  invalidation, and 26 unit tests. Backend only — no UI calls it yet; functionally
  dormant until the split-view UI (PR3) wires it up. (PR #197)

- **Default IPTC template (account-level)**: configure your IPTC Pro profile
  once and have it follow you. A new **default IPTC template** is stored on your
  account (new `user_iptc_templates` table, owner-only RLS) so it syncs across
  machines and survives logout. It **prefills every new preset** and is used as
  the **fallback in the Export & IPTC modal** when a preset has no profile of its
  own — precedence is always **preset profile > default > empty**, and existing
  presets are never auto-modified (snapshot semantics: the default is *copied*
  at preset creation or via the explicit **Apply default** button). The preset
  IPTC editor gains **Apply default** / **Save as default** buttons, and
  **Settings → IPTC Pro Defaults** gains a full template editor (**Edit
  template…**), **Import from XMP…**, a status row, and **Clear**. The Export &
  IPTC modal reads the default directly over IPC and falls back to a local mirror
  for offline export. No token logic / Edge Functions touched. (UX-04)

- **Cross-device review (#184 Phase 1, dark launch)**: opening an execution whose
  local JSONL is missing (another device ran it, a reinstall, or a lost local file)
  can now reconstruct its event stream from the Supabase DB so the **review gallery
  still renders** — plus a manual **Refresh** button to re-pull the cloud copy
  (e.g. to pick up corrections made on another device). **Per-user gated via the
  `feature_flags` table** (`db_execution_fallback`, default off) — the same
  DB-delivered, per-user mechanism as `face_recognition_enabled`, so it can be
  turned on for individual users from the DB without a rebuild (read cached 60s);
  the `RACETAGGER_DB_EXECUTION_FALLBACK` env still forces it on for local dev. With
  the flag off, behavior is identical to today. Additive and defensive — any DB/network
  failure degrades to the previous behavior (empty gallery), never throws. The
  local-first path is unchanged. No token logic / Edge Functions / schema touched.
  Online-only by policy (CLAUDE.md → Offline Capability Policy). *Known v1
  limitation:* cross-device thumbnails (signed URLs) are a follow-up; recognized
  data reconstructs. (PR #187)

### 🐛 Fixes

- **R2 HD delivery now actually confirms uploads (no more silent failure)**: when
  delivering with the HD toggle on, photos were PUT to R2 but the follow-up confirm
  call to the `r2-signed-url` Edge Function always failed silently, so
  `original_upload_status` stayed `NULL` while the photographer saw "success". Two
  bugs in `r2-upload-service.ts`: (1) the confirm POST sent `uploads:` but the Edge
  Function reads `body.confirmations`, so confirm 400'd every time; (2) the response
  was only logged under `DEBUG_MODE` and never thrown, and the item was marked
  `completed` *before* confirm ran. Now the request uses the correct
  `confirmations` key, a non-2xx confirm response is always logged (`console.error`)
  and throws, items are finalized as `completed` only **after** a successful confirm,
  and a failed confirm marks them `failed` and emits an `upload-progress`/`upload-error`
  IPC event so the UI reflects the error. `src/r2-upload-service.ts` only; no token
  logic / schema touched. (The Edge Function is being updated in parallel to accept
  both keys.)

- **Backlog-autopilot workflows now use the real `error_reports` column names**: the
  sweep and implement workflows queried PostgREST with columns that don't exist
  (`occurrence_count`, `last_seen`, `user_count`…) instead of the real ones
  (`total_occurrences`, `last_seen_at`, `affected_user_count`…), producing
  recurring Postgres errors on every triage run. No schema change; no app impact.
  (PR #195)

- **Duplicating a preset no longer loses its IPTC profile & recognition flags**:
  `duplicateOfficialPresetSupabase` copied only `name`/`description`/`category_id`/
  `custom_folders`, silently dropping the preset-level columns
  `iptc_metadata` (the curated IPTC Pro profile), `person_shown_template`
  (the IPTC PersonInImage template) and `allow_external_person_recognition`. An
  editorial photographer who duplicated an official preset got a copy stripped of
  its Getty-ready metadata profile with no warning, and had to rebuild it. The
  duplication payload now carries all four preset-level fields —
  `iptc_metadata`, `person_shown_template`, `allow_external_person_recognition`
  and the ACC-01 `series_sponsor_ignore` list (see the Gruppe C field-feedback
  section) — and `ParticipantPresetSupabase` gains the `person_shown_template`
  field. `database-service.ts` only; no token logic / Edge Functions touched.

- **Add a missing detection on a group photo from the review gallery**: the
  "+ Add detection" button was rendered **only** in the empty-state branch of
  the gallery's detection editor (`updateVehicleEditor`), so a photo that
  already had 1+ detections offered no way to add a plate the AI missed (e.g.
  3 of 5 plates found). The button now also renders after the existing
  detection cards, reusing the same `lv-add-vehicle-btn` / `data-action="add"`
  delegated handler — the new card saves a normal `MANUAL_CORRECTION` that
  flows into folder org / IPTC like any other correction. Renderer-only
  (`renderer/js/log-visualizer.js` + `renderer/css/processing-status.css`);
  no token logic / Edge Functions / schema touched. (#167)

- **Removed a no-op "Write metadata automatically during analysis" toggle**
  (Settings → IPTC Pro Defaults): the toggle persisted to
  `localStorage['iptc-pro-defaults'].autoWrite` but was wired to **nothing** —
  it never reached the main process, `UnifiedProcessorConfig.iptcMetadata` was
  never populated from it, and the analysis pipeline ignored it entirely.
  Turning it on (expecting metadata written *during* analysis) or off
  (expecting writes suppressed) produced identical behavior, so the control
  silently misrepresented what the app does — a trust bug. The toggle and its
  no-op change handler are removed from `settings.html` / `settings.js`. Actual
  behavior is unchanged and matches the toggle's former *disabled* copy: the
  IPTC Pro profile is written when you use **Export & IPTC**. The per-preset
  "Writing timing" override and the `UnifiedProcessorConfig.iptcMetadata`
  safety-net hook are left intact as the architecturally-correct home for this
  behavior if it is ever wired (note: that per-preset override is itself not
  yet consumed during analysis). Renderer-only; no token logic / Edge Functions
  / schema touched.

- **ExifTool now runs from mount paths with spaces (macOS DMG)**: temporal
  clustering built the ExifTool command as a single shell string with an
  **unquoted** executable path. When the app ran from the default DMG mount
  `/Volumes/RaceTagger <version>-arm64/…`, the shell split the path at the
  space, ExifTool never ran, and no `DateTimeOriginal` timestamps were
  extracted — degrading matching to **0 recognized numbers** on the whole
  batch. Both invocations now use `execFile` (no shell) with a real argv
  array, and the path resolver returns `{ cmd, prefixArgs }` (preserving the
  Windows `perl.exe` + `exiftool.pl` wrapper). Local exec-safety fix only —
  no token logic / Edge Functions / schema touched. Adds
  `tests/temporal-clustering-exec.test.ts`. (#147, refs #146 — PR #182)

- **IPTC keyword integrity on group photos & corrections**: a manual correction
  now rebuilds keywords from **every** current detection, so correcting/adding
  one plate no longer wipes the sibling detections' number/team/driver; the
  write is collapsed to one pass per file. Overwrite mode now truly **replaces**
  (the previous `-IPTC:Keywords=` + `+=` idiom silently *accumulated* stale
  keywords). Single-digit race numbers (#1–#9) are no longer dropped, and
  embedded visual tags (location/weather/scene) survive a correction (only those
  already on the file are re-added, respecting the user's embed choice). (#167)
- **ExifTool packaging hardened**: the git-ignored Windows launcher is now
  fetched **launcher-only** (never bumping the deliberately pinned 13.38
  `exiftool.pl`/`lib`); the build **fails loudly** if ExifTool is missing
  (`validate-native-deps.js`), so a release can't ship without metadata writing;
  and the metadata test suites now exercise the **bundled** ExifTool instead of
  silently skipping. (#147)

### ✨ Gruppe C field-feedback fixes (Nürburgring 24h)

- **Preset editor**: edited driver names now persist (per-driver rows synced
  on Save — BUG-01); blocking `alert()` replaced by non-blocking toasts and the
  premature "last participant" popup fixed (filter-aware Save & Next, default
  sort by race number — BUG-02); the in-editor **CSV/PDF import now merges**
  into the open preset (add/update by race number) with round-to-round handling
  (deactivate / remove / keep the cars missing from the new list) and full-field
  import including per-driver nationality (BUG-03); a back arrow in Edit
  Participant (UX-02); `is_active` persisted on Save.
- **Save & Next now actually saves (BUG-02, final piece)**: "Save & Next" /
  "Save Changes" / "Save & Previous" persist each edited participant to the
  cloud **immediately** — a background, non-blocking single-row write — instead
  of holding every edit in memory until the preset-level Save. A crash or a
  stray Escape mid-session no longer wipes a 60-car editing pass. A failed write
  keeps the row in the session and surfaces a toast; **Save Preset is the retry
  path**. Closing the preset editor (X / Cancel / Escape / backdrop click) now
  **warns before discarding** any change not yet on the preset (a pending/failed
  per-row write, an unreviewed CSV/PDF merge, a removal, or a brand-new unsaved
  preset). Note (Option B, ratified): an analysis launched mid-editing now runs
  against the partially-updated roster — the desired behavior for round-to-round
  entry-list maintenance. No schema / token / Edge Function changes; merge
  "remove"/"deactivate" results still commit only via Save Preset's review-gated
  delete-diff.
- **Results review**: bulk multi-select **"Mark as No Match"** that keeps the
  original AI detection in history for future training (WF-01); 100% keyboard
  correction in the gallery (Enter confirms + advances, Space edits, type a
  number to correct, with an on-screen shortcuts hint — WF-02); deleting a
  detection no longer asks for confirmation (UX-01).
- **Startup reliability**: ONNX model download now retries with backoff, writes
  atomically (no more "sticky" truncated model files), validates size, and
  offers an in-app **Retry** button instead of "restart the app" (BUG-04).
- **Matching — per-preset "Series sponsors to ignore" list (ACC-01)**: at events
  like Le Mans the series sponsors (Michelin, Rolex, TotalEnergies …) appear on
  every car and on trackside banners, so their text used to pollute match
  scoring. Each preset now has a **Series sponsors to ignore** list (a chip input
  in the preset editor): the SmartMatcher drops those brands from sponsor
  evidence **before** scoring, so an ignored sponsor neither adds a match bonus
  nor fires the −30/−15 contradiction penalties against any participant, and can
  no longer trip a false ghost-vehicle alert. Stored in the new additive
  `participant_presets.series_sponsor_ignore` JSONB column (migration in
  `racetagger-app`); an empty list — the default for every existing preset —
  means matching is unchanged. Matching is entirely local; no token logic /
  Edge Functions touched.

## [1.1.9] - 2026-05-12

### 🐛 Manual corrections — durability and consistency

- **Folder organization honors manual corrections**: when a user
  manually fixes a recognized number / participant in the results page,
  the new participant entry is applied to the folder-organizer pipeline
  with a pre-flush of pending writes and a merge against Supabase, so
  the corrected photo lands in the right folder on the next export.
- **Durable correction outbox**: corrections are queued in a local
  outbox (`src/utils/correction-outbox.ts`) with retry-on-failure to
  Supabase. Survives renderer reloads and transient network issues —
  no more silently-lost corrections.
- **"NO METADATA" badge clears** correctly after a manual correction
  writes new IPTC keywords (was previously stale until full reload).
- **Delete-then-readd preview bug** in the log visualizer fixed: the
  thumbnail now refreshes when the user removes and re-adds a match
  on the same image; narrate-style logging added to make this path
  easier to debug in the future.

### 🛠 Internal

- Remove dead **dcraw fallback** from RAW preview pipeline. The native
  raw-preview-extractor + ExifTool fallback have been the canonical
  path since 1.2.0; the residual dcraw code only added size to the
  bundle.

### 📁 Folder pool & default-folder toggle

- **Shared folder pool across modals**: folders created from inside the
  per-participant Edit modal are now promoted to the preset-level
  `custom_folders` pool, so they show up immediately in the multi-assign
  side panel (no more "Genesis" attached to one participant but invisible
  when assigning others). A one-shot `backfillParticipantFoldersIntoPool`
  runs on preset open to heal legacy presets created before this fix.
- **Bulk "include default folder" toggle** in the bulk-action bar:
  tri-state checkbox (on / off / mixed) lets you flip the
  `include_default_folder` flag on N selected participants in a single
  IPC trip (`preset:bulkSetIncludeDefaultFolder`).
- **`include_default_folder=false` honoured consistently** in both the
  analysis-time FolderOrganizer (Flusso A) and the Export & IPTC modal
  (Flusso B) — fixes the case where unchecking the toggle still produced
  a `{number}` default folder in one of the two flows.

---

## [1.1.8] - 2026-05-12

### ✨ Participant editor — Save & Next

- New **"Save & Next"** button in the Participant Edit modal (visible only
  when editing an existing row, not when adding a new one). Saves the
  current participant and immediately opens the next row in the table's
  current visible order — sort / filter state is respected via DOM
  `nextElementSibling`, so you walk participants in the order you're
  actually looking at, not the underlying array order.
- When the saved row is the last visible one, the modal closes with a
  notification confirming the save.

---

## [1.1.7] - 2026-05-12

### 🎯 Major Features

#### **Custom Folders Redesign — chips, autocomplete, no more 3-slot limit**
- Per-participant custom folders are now an unbounded array, edited inline
  with chips and a `+ Add folder` button.
- Autocomplete suggests folder names already in use elsewhere in the
  preset (case- and punctuation-insensitive) so duplicates like
  "Sponsor BMW" / "BMW-sponsor" don't drift apart.
- Each chip can pin an absolute filesystem path via the 🔗 icon — useful
  for direct delivery to external drives or sponsor folders.
- Replaces the legacy `folder_1` / `folder_2` / `folder_3` dropdowns.
  Schema is dual-written for full 1.1.4 backward compatibility (the first
  three folders of every participant are still mirrored to the legacy
  columns so 1.1.4 clients keep working on the same Supabase data).

#### **Additive default folder, per-participant**
- New per-**participant** toggle inside the participant edit modal:
  *"Also export to the default folder (e.g. `{number}`)"*. Default
  checked.
- When checked, photos of THAT participant go to BOTH the custom
  folders AND the default pattern-based folder. When unchecked, they
  go ONLY to the custom folders (legacy 1.1.4 "all-or-nothing"
  behaviour).
- Per-participant rather than per-preset because real-world delivery
  setups differ per driver (sponsor + numerical archive for some, only
  sponsor folder for others). Each chip area shows the toggle right
  below it, so the decision is autoexplicative when looking at a
  single participant.
- Default `true` on the DB column applies to legacy migrated
  participants too — i.e. participants who in 1.1.4 had custom folders
  + "all-or-nothing" will now ALSO get the `{number}` folder. Anyone
  who needs the strict 1.1.4 behaviour on a specific participant can
  uncheck the toggle in the edit modal.
- Honored by both the analysis-time FolderOrganizer (Flusso A) and the
  Export & IPTC modal (Flusso B), so the two flows stay coherent.

#### **Export & IPTC honors preset folder assignments**
- New toggle in the Export & IPTC modal: *"Follow preset folder
  assignments"*. Default ON when the preset has folders configured;
  disabled with an explanatory hint when it doesn't.
- Sub-toggle *"Also include default subfolder"* mirrors the per-preset
  flag but is override-able for one-off exports (e.g. send only to
  sponsor folders this time).
- Multi-destination copy + IPTC write per photo, with the existing
  `fileConflictStrategy` (rename/overwrite/skip) and
  `metadataStrategy` (merge/replace) toggles applied independently to
  each destination.

#### **Multi-pilot caption support — per-car repeat blocks `[[ ]]`**

- New `[[ ]]` syntax available in every IPTC template field (Caption,
  Headline, Title, Event, and Base Keywords): the wrapped section is
  repeated once per matched pilot when a photo contains multiple
  participants, joined by `, `.
- Example: a Caption template like
  `DTM 2026 [[#{number}; {team}: {name}]] - photo by GC` produces
  `DTM 2026 #90; Manthey: Feller, #7; Comtoyou: Thiim - photo by GC`
  for a photo with two pilots in frame, instead of the previous
  `DTM 2026 #90, 7; Manthey, Comtoyou: Feller and Thiim` mess.
- Solves the multi-pilot caption problem common to WEC, IMSA,
  endurance racing, podiums, team cycling and any sport where
  multiple subjects appear in the same shot.
- New **"Insert per-car block"** button in the Caption Template editor
  (turquoise tint to signal it's a structural action, distinct from
  the existing placeholder buttons): wraps the current selection in
  `[[ ]]`, or inserts an empty wrapper at the cursor if no selection.
- **Live preview enhanced** — when a template uses `[[ ]]`, the editor
  shows BOTH a single-pilot example AND a 2-pilot example side-by-side,
  so users immediately see how the block expands. Falls back to a hint
  prompting to add a second participant when only one is in the preset.
- Backward compatible: any preset without `[[ ]]` keeps the previous
  rendering unchanged. Single-match images render the block once
  without a separator.

### 🛠 Infrastructure

- SQL migration `20260429120000_consolidate_participant_folders.sql`
  adds `folders jsonb` to `preset_participants`. Migration is purely
  additive — legacy `folder_1/2/3` columns are kept for 1.1.4 backward
  compatibility.
- Follow-up SQL migration `20260430080000_move_include_default_to_participant.sql`
  moves the additive-default-folder flag to a per-participant column
  (`preset_participants.include_default_folder boolean DEFAULT true`)
  and removes the short-lived per-preset column added by the previous
  migration. Per-participant gives the granularity real delivery
  workflows need.
- New normalization layer in `database-service.ts` reconciles legacy
  folder slots vs the canonical `folders[]` array on every preset
  fetch. Handles three cases: lazy migration (first 1.2.0 fetch of an
  unmigrated row), drift (1.1.4 modified the legacy columns after
  1.2.0's last write), and steady-state. Auto-heals all three with a
  single fire-and-forget DB consolidation per fetch.

### 🐛 Bug fixes carried from the in-flight 1.1.x debugging

The fixes previously shipped to a small audience under 1.1.4 are
included here for the broader 1.2.0 rollout:

- **IPTC CreatorContactInfo**: address, city, state/province, postal
  code, country, phone, email and website now actually land in the file.
  Previous syntax produced silent ExifTool warnings and the entire
  contact block was dropped.
- **`XMP-iptcCore:ProvinceState`** (legacy mistake) replaced with the
  correct `XMP-photoshop:State` + `IPTC:Province-State` pair.
- **`XMP-plus:ModelReleaseStatus`** writes the canonical PLUS URI with
  the `#` no-print-conv suffix, no more "Can't convert" warnings.
- **Original-path resolution after re-open**: the results page no
  longer drops `originalPath` from the result objects; Export to Folder
  copies the full-resolution original instead of the local thumbnail.
- **Async match save**: clicking a candidate match advances to the
  next photo immediately; persistence runs in background. Coalesces
  rapid clicks into a single trailing save.
- **Write Behavior toggles** in Export & IPTC: file conflict strategy
  (rename / overwrite / skip) and metadata strategy (merge / replace).
- **`{persons}` placeholder in multi-match**: previously produced
  nonsensical output like `(90, 7) Feller and Thiim - Manthey,
  Comtoyou - Porsche, Aston Martin` — built from the aggregated
  participant's joined fields. Now correctly resolves to the joined
  list of individual extended names per pilot:
  `(90) Feller (SUI) - Manthey - Porsche, (7) Thiim (DEN) - Comtoyou
  - Aston Martin`. Single-match behavior is unchanged.

### ✨ Preset editor — bulk folder assignment UX

- New V1 design for managing folder assignments in the preset editor:
  slide-in side panel with a folder pool, inline `+ New folder` form,
  per-row `+ assign` pill, multi-select bulk-action bar, and an
  Auto-assign by rule editor (Team / Category / Car contains / equals /
  starts with → target folder).
- Mutually-exclusive side panels: opening "+ Add Folder" while
  "Auto-assign by rule" is open now correctly hides the latter
  (single-setter invariant ensures at most one panel `.is-open` at any
  time).
- Fixed a z-index regression where the sticky participants-table
  column header stamped through the side panel body.

---

## [1.1.0] - 2026-02-11

### 🎯 Major Features

#### **Drag & Drop Folder Selection**
- Drag and drop di cartelle per selezione rapida
- UI hints per guidare l'utente
- Esperienza utente migliorata per batch processing

#### **RAW Preview Calibration & Extraction**
- Nuove strategie di estrazione preview RAW ottimizzate
- Calibrazione automatica per diversi formati RAW (NEF, CR2, CR3, ARW, etc.)
- Performance migliorate per processing di file RAW di grandi dimensioni

#### **Enhanced Results Page**
- Stats bar con metriche chiave (analyzed, matched, unmatched)
- Category tags per filtering e visualizzazione
- UI moderna e informativa per risultati analisi

#### **Batch Token Reservation System** 🔐
- Pre-authorization token per batch processing
- Dynamic TTL basato su dimensione batch (30min-12h)
- Automatic cleanup expired reservations
- Refund automatico di token non utilizzati
- Previene consumo token in caso di errori

#### **Post-Analysis Folder Organization**
- Organizzazione automatica cartelle dopo analisi
- Support per custom folder paths nei preset partecipanti
- Block repeated move organization per completed executions

#### **User Feedback System**
- Modal feedback integrato nell'app
- Supporto diagnostici automatici
- Token rewards per feedback validati

### 🔧 Technical Improvements

#### **Performance & Optimization**
- Batch database update mechanism (ottimizza performance, previene timeout)
- Singleton pattern per CleanupManager (previene memory leaks)
- Cached presets con filtering dinamico per performance

#### **Data Integrity**
- Driver ID Preservation across CSV, JSON, PDF import/export
- Autocomplete for result editing basato su participant preset
- Persist last analysis settings between sessions

#### **Processing Enhancements**
- Enhanced batch processing cancellation handling
- Improved model management e processing flow
- Export Tags fix per esportazione training labels

### 🎨 UI/UX Improvements
- **Sport Category Filtering**: Preset filtrati per sport category con mapping automatico
- **Renamed "Event Type" to "Sport Category"**: Label più chiara
- **Folder Organization Box**: Tema colore aggiornato (blu)
- **Fully Dynamic Flexbox Scrolling**: Participants modal ottimizzato
- **Metadata vs AI Matching Distinction**: Redesign participant edit modal
- **PDF Drag-and-Drop**: Upload participant presets da PDF

### 🔒 Security & Reliability

#### **Email Normalization Fix** 🆕
- **Fixed**: Duplicate registration bug con email case-sensitive
- Server-side email normalization (backward compatible)
- Client-side normalization (defense in depth)
- Database cleanup: 187 user emails normalized
- Duplicate accounts detection e merge
- **Impact**: Previene completamente duplicati email

### 🐛 Bug Fixes
- Fix organize skipped scene images to 'Others' folder
- Fix Person Shown field removal da participant preset
- Fix confidence indicator removal da PDF import
- Fix UUID generation (crypto.randomUUID() nativo)
- Face Detection temporarily disabled (Coming Soon feature)

### 📱 Platform Updates
- Windows x64 build ottimizzata
- macOS Apple Silicon (ARM64) ottimizzata
- Enhanced error handling e logging

---

## [1.0.11] - 2025-11-27

### 🤖 AI/ML Enhancements
- **ONNX Detector**: Nuovo sistema di rilevamento locale usando modelli ONNX
  - Supporto per scene classification (track, paddock, podium, portrait)
  - Integrazione con UnifiedImageProcessor per routing intelligente
  - Caricamento e processing modelli ottimizzato

- **Face Recognition (Beta)**: Infrastruttura per riconoscimento volti
  - Pipeline ML training per classificazione scene
  - Script di data collection e preparazione dataset
  - Conversione modelli a ONNX per deployment

### 🔧 Technical Improvements
- Enhanced model loading and processing in OnnxDetector
- Improved error handling e logging per debug

---

## [1.0.10] - 2025-10-20

### 🚀 New Features
- **RF-DETR Recognition**: Integrazione completa sistema RF-DETR via Roboflow
  - Routing automatico basato su `sport_categories.recognition_method`
  - Supporto per workflow serverless Roboflow
  - Label parsing format: `"MODEL_NUMBER"` (es. `"SF-25_16"`)
  - Fallback automatico a Gemini V3 in caso di errori
  - Tracking costi separato ($0.0045/image)

- **Target/Plate Recognition**: Aggiunto riconoscimento targhe e plate number

### 📱 Platform Updates
- **Apple Notarization**: Notarizzazione automatica per build macOS
  - Stapling ticket incluso nei DMG
  - Entitlements per hardened runtime

- **Windows x64**: Build ottimizzata e pubblicata

### 🐛 Bug Fixes
- Fix caricamento sport categories al login e refresh token
- Fix gestione dinamica 1500 tokens
- Fix ordinamento partecipanti nei preset
- Super admin può visualizzare tutti i contenuti

### 💰 Pricing Updates
- Pricing modal refactored: redirect a web invece di prezzi hardcoded
- Early Bird deadline check automatico (scade 31 Dec 2025)
- Migliorato layout modal e info box preset partecipanti

---

## [1.0.9] - 2025-10-06

### 🚀 New Features
- **Unified Token Architecture**: Semplificata architettura token
  - `user_tokens.tokens_purchased` come single source of truth
  - Eliminata duplicazione e confusione nel calcolo balance
  - Documentazione unificata per calcolo token

- **Export Training Labels**: Nuova funzione per esportare label training
  - Supporto formati: COCO, YOLO, CSV
  - Opzione per includere immagini nell'export

### 🎨 UX Improvements
- Guida Participant Presets accessibile dall'interfaccia
- Migliorato layout pricing modal
- Aggiunta info box per onboarding preset partecipanti

### 🐛 Bug Fixes
- Fix completo handling execution records
- Fix errori upload JSONL
- Ottimizzato workflow processing JPEG
- Migliorata struttura codice per leggibilità

### 📱 Platform Updates
- Windows x64 build pubblicata

---

## [1.0.8] - 2025-10-01

### 🔧 Critical Windows Fixes
**Risolve completamente il problema "App non risponde" su Windows x64**

#### Performance Improvements
- **Fix #1**: Converted all synchronous file operations to async in main process
  - `fs.readdirSync()` → `fsPromises.readdir()`
  - `fs.statSync()` → `fsPromises.stat()` with parallel execution
  - Eliminates 500-2000ms UI freezes during folder scanning
  - Pre-caches file stats before sorting to avoid O(N²) blocking calls

- **Fix #2**: Added 30-second timeout to all execFile calls in RAW converter
  - Prevents infinite hangs when dcraw.exe blocks on corrupted files
  - Automatic process termination with SIGKILL on timeout
  - Graceful error messages instead of silent freezes
  - Affects: dcraw, dcraw_emu, ImageMagick convert operations

- **Fix #3**: Implemented tool path caching in NativeToolManager
  - Eliminates repeated `fs.existsSync()` calls (600+ per batch)
  - Tool paths cached on first lookup, instant return on subsequent calls
  - Reduces Windows filesystem overhead by 95%

- **Fix #4**: Made IPC handlers non-blocking
  - `handleUnifiedImageProcessing` no longer awaits batch processing
  - Processing runs in background while UI remains responsive
  - Events-based progress updates instead of blocking main thread
  - Windows no longer shows "Not Responding" during analysis

- **Fix #5**: Cached architecture detection results
  - `wmic cpu get Architecture` executed only once on startup
  - Eliminates 100-500ms execSync calls for every worker initialization
  - Reduces total startup overhead by 400-4000ms on Windows ARM64 systems

#### Technical Details
**Files Modified:**
- `src/main.ts`: Async file operations + non-blocking IPC handlers (lines 560-2880)
- `src/utils/raw-converter.ts`: Timeout configuration for all execFile calls
- `src/utils/native-tool-manager.ts`: Path caching + architecture detection cache

**Performance Impact:**
- **Before**: 60-150 seconds of UI freeze on 200 image batch
- **After**: <5 seconds total freeze, 95% reduction
- **Throughput**: 20% faster processing due to parallel file stats
- **Windows Compatibility**: Eliminates "App non risponde" issue completely

### 📱 macOS Improvements
- Notarization completed for v1.0.7 builds (ARM64 + Universal)
- Gatekeeper warnings eliminated for fresh installs

### 🐛 Bug Fixes
- **Login Data Loading**: Fixed home page statistics and categories not loading after first login
  - Login result now sent AFTER data sync completes
  - Eliminates need to close/reopen app to see data
  - Categories and statistics load correctly on first login
- Fixed path handling for Windows long paths (>260 characters)
- Improved error recovery for corrupted RAW files
- Better cleanup of temporary files on logout

### 🔒 Security
- All process spawns now have timeout protection
- Prevents zombie processes on Windows

---

## [1.0.7] - 2025-09-29

### Features
- Enhanced RAW file processing
- Improved participant matching
- Better logging system

### Bug Fixes
- Various stability improvements

---

## [1.0.6] - 2025-09-15

### Features
- Initial participant preset support
- Enhanced metadata writing

---

## [1.0.5] - 2025-09-12

### Features
- Core functionality release
- RAW support with dcraw
- Basic AI analysis
