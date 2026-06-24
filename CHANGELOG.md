# Changelog - RaceTagger Desktop

## [Unreleased]

### ✨ Review gallery: a friendlier "shortcuts" helper (replaces the wall of hint text)

- **The cramped, always-on "Fast keys" line is gone — replaced by an inviting `⌨ Want to review faster?` button that opens a clean shortcuts panel.** The old hint was either too terse to understand or, when spelled out, a wall of text in the way. Now a single compact trigger sits in the review header; **hover it, click it, or press `?`** and a popover opens with the shortcuts grouped and legible (keys as JetBrains-Mono chips): move around (`←/→` photos, `↑/↓` detections), edit the number (type / `Space` / `Enter` / `Shift+Enter`), pick a suggestion (`1`–`9`, `0`), and close (`Esc`) — plus a reminder that the always-present empty entry at the bottom is how you add a detection. `Esc` or clicking away closes it. This finally documents the `↑/↓` and `Shift+Enter` shortcuts that the old hint never mentioned. Also makes **`Shift+Enter` go back a photo from any field** (previously only from the Race Number field). Renderer-only (`log-visualizer.js` + `processing-status.css`) — no participant data, schema, token logic or Edge Function changes.

### ✨ Review gallery: add detections from the keyboard, no mouse

- **Correcting a photo with more than one car (or adding a missed one) no longer needs the mouse.** The review gallery used to show a **+ Add detection** button — a click target — to add an entry. It's gone. Instead, every photo now always shows **one trailing empty entry** ready to fill: type a number and it becomes a real detection, and a fresh empty entry appears after it, so there's always exactly one blank slot at the end (for a photo with **zero** detections you just get the empty entry to fill; with one or many, the blank slot sits at the end). Move between entries with **↑/↓** (←/→ still flip between photos; Enter still confirms and advances to the next photo). The single-car flow is unchanged and just as fast: type → Enter. Edits are **auto-saved when you move off an entry** (↑/↓/Tab), so nothing is lost and you never need to click Save. Renderer-only (`log-visualizer.js` + `results-integrated.css`) — no participant data, schema, token logic or Edge Function changes.

### 🛡️ Anti-abuse: device → account limit (warn by default)

- **Repeated free-credit farming with many accounts on one computer is now detected.** After login the app checks how many accounts have been used on this machine; past a configurable limit (default 3, with the earliest accounts grandfathered) the extra account is flagged for review and the administrator is notified — **login still proceeds**, with a one-time, non-blaming notice (a global server switch can escalate to blocking the over-limit account's login instead). The check is **fail-open** (any connectivity/infra hiccup never blocks a legitimate login), uses a privacy-preserving hashed device id, and does **not** touch token/credit logic or the pre-authorization path. Founder/test devices and email bases are allowlisted server-side so internal testing is never affected. Desktop adds a canonical device id (`getCanonicalMachineId` in `system-info.ts`) and a post-login check in `auth-service.ts` that calls the server-side cap function; the detection/flagging + admin email live entirely on the backend.

### ✨ Participant list — pick your columns (+ a new "Car" column)

- **The preset participant table now lets you show or hide columns, and remembers your choice.** A new **Car** column (the vehicle / `car_model`, e.g. "Ferrari 296 GT3") ships **visible by default**, so you can sort the roster by car and assign participants faster — the original ask. Beyond that one column, a **Columns** dropdown in the filter row toggles Person, Category, Team, Car and Plate on/off; the selection is saved **per device** and applies across every preset, so a small screen can hide what it doesn't need instead of fighting an overflowing table (the table also scrolls horizontally as a fallback). **Num is always shown** — it's the participant's identity. Saved per-preset sort was made robust to this: it's now keyed by a **stable column id**, so hiding the currently-sorted column gracefully falls back to sorting by Num instead of breaking. Renderer-only (`participants.html` / `participants.css` / `participants-manager.js`) — no participant data, schema, token logic or Edge Function changes; `car_model` was already stored and imported/exported, it just wasn't displayed.

### 🐛 Fix: driver/team suggestions silently disappeared on one analysis (settings clobber)

- **In the review gallery, the driver/team autocomplete suggestions could vanish for a single analysis** — the user had to retype every number and driver by hand on that one set, while every other set worked. Root cause was a destructive read-modify-write at the end of analysis: to stamp the final `recognition_method` onto `execution_settings`, the finalize step first re-read the row's settings (guarded by a 10s timeout that resolves to `null`, and without checking the `.single()` error), then wrote `{ ...(settings || {}), recognition_method }`. When that pre-read timed out or errored, the spread became `{}` and the **entire `execution_settings` JSONB was overwritten with just `{ recognition_method }`** — wiping `participantPresetId`. The Results screen reads that id to load the roster for suggestions, so losing it left the autocomplete empty. (Rare — 1 in ~800 executions — but silent and only visible later, when the user goes to fix results.) Two-part fix:
  - **Never clobber on a failed read** (`unified-image-processor.ts`): the finalize update now merges `recognition_method` into `execution_settings` **only when the pre-read actually returned the existing blob**; on timeout/error it omits the field entirely (recognition_method is telemetry — the real settings are preserved) and logs a warning.
  - **Self-healing fallback** (`log-visualizer.js`): when `execution_settings` has no `participantPresetId`, the Results screen now recovers it from the JSONL `EXECUTION_START` event (which always records it), so already-affected analyses get their suggestions back with no database repair. No token logic, schema, or Edge Function changes.

### 🐛 Fix: PDF import preview split "Lastname, Firstname" drivers into two

- **The PDF-import preview table no longer splits a `Lastname, Firstname` driver name into two people.** The redesigned preview derived its driver chips from `getDriverNamesFromParticipant(p)`, which — for the freshly-extracted Edge Function participant (no `preset_participant_drivers` yet) — falls back to splitting the comma-joined `nome`, tearing `Kaya, Mustafa Mehmet` into `Kaya` + `Mustafa Mehmet`. It now reads the EF's **structured `drivers[]` array** directly (each element is one whole driver), falling back to the helper only when the array is absent. Display-only — the actual import already used the structured array and was correct; this aligns the preview with it. (The extraction itself is fine: the vision-first `parsePdfEntryList` returns these names correctly grouped — verified against this exact ADAC Eifel list.)

### 🛡️ Automatic crash reporting — the app now tells us when it closes unexpectedly

- **If the desktop app closes unexpectedly, the crash is now reported automatically** (anonymously) and turned into a GitHub issue — no more silent disappearances. This closes a real gap: the existing error telemetry only caught *handled* errors, but a hard crash (a native segfault in RAW/ONNX processing, an out-of-memory kill, a GPU or renderer crash, a force-quit or power loss) kills the process before any JavaScript runs, so nothing was ever reported. Now:
  - **Native crashes are captured by Electron's Crashpad** (`crashReporter`, local only — minidumps are written to disk, never uploaded anywhere). On the next launch a recovery scan finds the new minidump and reports it through the same pipeline as every other error (deduped by fingerprint → one issue; repeat users add a comment).
  - **Abnormal exits with no minidump** (OOM kill, force-quit, power loss) are detected via the diagnostic log's `[SESSION START]`/`[SESSION END]` markers — a missing end-marker means the previous session didn't shut down cleanly — and reported as a lower-severity `abnormal_exit`, with a "last activity" hint (raw preview, segmentation, edge function…) and a capped tail of that session's log.
  - **Renderer and GPU/child-process crashes** are now caught live via `render-process-gone` / `child-process-gone`, and **unhandled promise rejections** are reported too (previously only `uncaughtException` was).
  - **The report queue is now write-ahead durable**: a queued report is persisted to disk immediately, so a crash in the ~30s before the next network flush no longer loses it — it's re-sent on the next launch. Reports queued before login also wait for auth instead of being discarded.
  - Same privacy and rate-limit guarantees as the existing telemetry (paths/emails sanitized, opt-out in Settings → Privacy, capped per day). New `src/utils/crash-recovery.ts` + a `getPreviousSessionDiagnosis()` helper on the diagnostic logger; `main.ts` starts the crash reporter and wires the new handlers. No token logic, schema, or Edge Function signature changes — the new `errorType` values pass through the existing `report-automatic-error` function as-is.

### 🎨 PDF import modal — brand redesign

- **The "Import from PDF" modal is now on-brand and more legible.** Full visual pass aligned to `brand-manual.md` (the same system as the redesigned Delivery page): the deprecated **purple/indigo gradients are gone** — one blue `#1a9ee0` everywhere, flat surfaces; **all emoji replaced with inline SVG icons** (header, drop zones, processing loader, error/warning, buttons); **numbers render in JetBrains Mono + tabular** (participant count, the preview "#" column, the merge-impact counts, the button counts); the document card gained the **blue livery-stripe** top border with a mono "Entry list" eyebrow. The **merge-impact line** now uses color-coded mono numbers (updated = blue, added = green, deactivated/removed = amber/red) instead of emoji, and the confirm button reads a clean "Add N · update M". In the **preview table each driver is its own chip**, so a name that contains a comma (`Kaya, Mustafa Mehmet`) stays one person and the driver count is unambiguous at a glance. **Fixed a long-standing readability bug**: the "What to do with the ones not in this PDF" and "Preset name" labels were dark-on-dark (inherited the global `.form-group label` colour) and effectively invisible — now explicitly light, scoped to this modal. CSS/markup + two preview renderers only; no import logic touched, no other modal/page affected.

### 🐛 Fix: "Fast keys" hint was white-on-white in the review gallery

- **The keyboard-shortcut hint above the recognition results ("Fast keys: type a number… Enter… Space… ← →… Esc") was unreadable in the review gallery.** The "Fast keys:" label was hardcoded to a near-white colour (`#f1f4fa`) and the body to a dim grey, but the panel it sits in (`.lv-gallery-controls`) is theme-aware: it renders on a **light** background in `results.html` (which doesn't load `desktop-theme.css`), so the label disappeared into the panel and the rest was low-contrast. The hint now uses the theme text tokens (`--text-primary` / `--text-secondary`) so it stays legible on both the light results panel and the dark in-app panel, and each key renders as a small keycap chip so the keys read apart from their descriptions instead of one flat run of text. It also gained a second line spelling out what `Space` does — it jumps straight to the race-number field so you can edit the number fast without reaching for the mouse (typing a digit instead overwrites the value). CSS/markup only.

### 🐛 Fix: Enter didn't save/advance when correcting from the Drivers field (review)

- **In the review gallery, pressing Enter while editing the Drivers field did nothing** — it neither saved the correction nor advanced to the next photo, so the user had to reach for the mouse (e.g. tagging a single driver of a 3-driver car). Enter's save-and-advance was wired **only** to the Race Number field; the Drivers field (also a focused input) fell through both the field-level and the gallery-level handlers. Enter now triggers the same save-and-advance from **both** the Race Number and Drivers fields. The race-number autocomplete/number-matching step stays gated to the Race Number field (a driver name must never be matched as a number); the Drivers field already autocompletes on input. Renderer-only.

- **The "Update participants" button (inside the preset editor) opened the PDF-import modal with no way to supply a file** — no drag-and-drop zone and no "browse" button — so updating an existing preset from a PDF was impossible (creating a *new* preset worked, because that flow uses the drop-zone on the presets page). The modal only had the processing / error / preview states; its initial "drop or browse" state was missing. Added an in-modal drop-zone (same look + handlers as the page one, via a shared `wirePdfDropZone()` helper) that shows whenever the modal opens without a file. The create-new flow is unchanged (it jumps straight to the processing state). Renderer-only.

### 📄 PDF entry-list import now reads the PDF visually (faithful names + numbers)

- **Importing a PDF entry list now sends the document to the AI to read directly, instead of extracting the text locally first.** On column-heavy layouts (e.g. the ACO Le Mans entry list) the local text extractor (`pdf-parse`) **detaches the race-number column** from its row — the numbers came out as a separate block, so the model couldn't associate them and **invented** plausible-but-wrong numbers, while a layout-specific prompt **scrambled driver names** (one 3-driver crew became a mix of first/last names of different people). The vision path reads the real number column and the names exactly as written. Pairs with the `parsePdfEntryList` Edge Function change (one generic, sport-agnostic prompt that never invents a number, on the stable `gemini-3.1-flash-lite` model) — validated on both an ACO (62-car) and a German ADAC (107-car) list. Reads any PDF, including image-only/scanned ones the text path couldn't decode. Desktop change is a one-liner in the PDF-import handler; no schema / token changes.

- **Analysis Results grid is now sorted by filename** (natural, numeric-aware) instead of
  analysis-completion order. The JSONL is written as images finish analyzing, which — with the
  parallel/streaming pipeline — has no relation to filename and looked random to users. Photos
  now appear in the same order as the file explorer. This also fixes the gallery prev/next order
  and the export/delivery order (all read the same sorted list). Renderer-only.
- **Post-analysis "Organize into Folders" now processes photos in filename order too**, so the
  per-folder write order and any `{seq}` rename token follow the source folder rather than the
  random completion order.

### 📄 CSV preset: `_Driver_Names` column so comma names survive a round-trip

- **CSV export/import now carries a `_Driver_Names` column (pipe-delimited)** so driver names that themselves contain a comma (`Lastname, Firstname`, e.g. "Kaya, Mustafa Mehmet") survive an export→re-import round-trip instead of being split into two people. The export wrote driver names only into the comma-joined `Driver` column (lossy for comma-names); it now *also* writes the full names pipe-joined into `_Driver_Names`, mirroring the existing hidden `_Driver_IDs` / `_Driver_Metatags` / `_Driver_Nationalities` columns. On import, both the merge path (renderer) and the create-new path (`database-service.ts`) **prefer `_Driver_Names`** (split on `|`, comma-safe) over splitting the `Driver`/`nome` column. The **legacy convention is unchanged**: when `_Driver_Names` is absent, a plain `Driver` cell like `"Max Mustermann, John Doe"` still splits on the comma into two drivers — so existing CSVs behave exactly as before. The create-new path also now materialises the single-driver row when the name contains a comma, so it isn't re-split on a later reload. (For a hand-authored list, `Lastname, Firstname` names are unambiguous only via PDF import or this `_Driver_Names` column — a bare comma in the `Driver` column remains the multi-driver separator by design.)

### 🐛 Fix: PDF entry-list import split "Lastname, Firstname" drivers into two people

- **Importing a PDF entry list whose driver names are in `Lastname, Firstname` form (common in German lists, e.g. "Kaya, Mustafa Mehmet") no longer turns one person into two participants/drivers.** The `parsePdfEntryList` Edge Function already returns a structured per-driver `drivers[]` array, but the desktop import discarded it and rebuilt names by splitting the legacy comma-joined `nome` on `,` — which tears a `Lastname, Firstname` name in two. Both PDF paths (create-new preset **and** merge-into-open-preset) now consume the structured array via a shared `driverNamesFromImportRow()` helper, splitting `nome` only as a fallback. The **legacy CSV convention is unchanged**: a CSV cell like `"Max Mustermann, John Doe"` (no structured array) still means two drivers. PDF create-new now also **always materialises a `preset_participant_drivers` row** for single-driver entries — even without a nationality — so the canonical record shadows the ambiguous `nome` and the name is never re-split on a later reload/edit (previously a lone `Lastname, Firstname` with no nationality wrote no driver row and was re-split by `getDriverNamesFromParticipant` / `autoMigrateDriverRecords`). Renderer-only; no schema / Edge Function / token changes.

### 🔑 "Keep me signed in" — pre-fill login from the OS credential vault

- **New "Keep me signed in" checkbox on the desktop login** (on by default). When ticked, the email + password are saved **encrypted with the OS credential vault** (Electron `safeStorage` → Windows DPAPI / macOS Keychain / Linux libsecret) in `userData/remember.enc`, and the login screen is **pre-filled** after a logout or session expiry (across app restarts the session was already restored). Unticking forgets the saved credentials. New `src/credential-store.ts` + `auth-get-remembered-credentials` / `auth-clear-remembered-credentials` IPC; the `login` channel now carries `rememberMe`. Never written in plaintext — if `safeStorage` is unavailable nothing is persisted.
- **Hardening:** the persisted Supabase session (`userData/session.json`) is now **encrypted at rest** with the same OS vault instead of plaintext JSON. Backward-compatible: legacy plaintext session files are still read and re-encrypted on the next save; falls back to plaintext only where encryption is unavailable.

### 🔒 Fix: privacy/terms notice re-shown on every login

- **The first-launch Privacy Policy / Terms notice no longer reappears after every logout→login.** It was gated only on a `localStorage` flag that `handleLogout()` wipes via `localStorage.clear()`, so any re-login re-triggered it even when nothing had changed. It's now gated on the DB (`subscribers.accepted_privacy_policy_at` + version, GDPR Art. 7): if the user already accepted the current policy version it's never shown; otherwise it shows once and **records acceptance to the DB** on agree (new `consentService.getPrivacyConsentStatus()` / `setPrivacyConsent()` + `get/set-privacy-consent` IPC). A per-user + per-version local flag (now preserved across logout) is the offline fallback. Policy versions are centralised in `CURRENT_PRIVACY_POLICY_VERSION` / `CURRENT_TERMS_OF_SERVICE_VERSION`. Requires DB migration `20260616120000_grant_authenticated_update_gdpr_consent` (grants `authenticated` column-level UPDATE on the 4 consent columns).

### 🎯 TRAIN-01: capture ONNX-miss + Gemini-hit as a training signal

- **New `training_flags.onnx_miss_gemini_hit`** stamped inline during analysis: when a
  per-championship ONNX number model produces no/weak number on a subject but Gemini
  (already run on those LOW/MEDIUM crops) reads one, the row records the flag + the gemini
  numbers (`onnx_miss_count`, `onnx_miss_numbers`). Derived from `modelSource` on the final
  results (`v6-fallback-from-low-onnx*`, `onnx+v6-default-gemini*`, `onnx+v6-preset-gemini*`)
  — **zero extra inference, zero extra Gemini call** (those crops already hit Gemini today).
  Feeds the per-sport model inbox as a silver, human-gated training candidate. Forward-only.

### 🖼️ Gallery delivery: write IPTC tags so the web filter works

- **Deliveries now populate `gallery_images.tags`** (`sendExecutionToGallery` + `autoRouteImagesToGalleries`). Until now only number/name/team were written, so the public gallery's filter-by-make/model/category/livery/sponsor/plate was dead (`tags='{}'`). A shared `buildGalleryTags()` denormalises the 7 keys the gallery reads — vehicle DNA (make/model/category/liveryPrimary/plateNumber, sponsors unioned across vehicles) parsed from `analysis_results.raw_response.vehicles[]` (V6/V7/ONNX-shape-defensive, primary-vehicle = recognised number else highest confidence) + `cameraModel` from the flat column. No extra queries (the delivery selects were widened), no schema change. Already-published galleries need a separate backfill.

### 🔌 Edge Function V7 support (Vehicle DNA)

- **Desktop now supports `edge_function_version = 7`**: bumped
  `MAX_SUPPORTED_EDGE_FUNCTION_VERSION` 6 → 7 so categories pinned to V7 are visible, and
  wired the analysis pipeline to actually call `analyzeImageDesktopV7` for them. V7 is a
  strict superset of V6 (same crop+context request/response contract, adds vehicle-DNA
  fields), so the crop+context path resolves the Edge Function name via the new
  `cropContextFunctionName()` helper and the no-subjects full-image fallback gates on
  `isCropContextVersion()` (V6 **or** V7) instead of `=== 6`. The standard single-image
  switch gained a `version === 7` branch. V6 remains the default; nothing changes for
  existing V6 categories. Internal-test only until a V7 category is published.

- **Per-sport thresholds now configurable (Phase 2)**: the crop near-miss floor
  (`segmentation_config.near_miss_floor`, default 0.15) and the crowd-skip threshold
  (`segmentation_config.scene_skip_threshold`, default 0.75) are now read per sport category
  instead of hardcoded. Literal defaults reproduce current behaviour exactly when unset (no
  regression, offline-safe). No schema change (existing `segmentation_config` jsonb).

- **Scene-classifier uncertainty capture (Phase 1)**: the local scene classifier now
  derives an uncertainty signal (`top1`, `top2`, `margin`, `entropy`) from the softmax it
  already computes, and flags low-confidence / torn / near-skip-boundary images as future
  scene-model training candidates. Persisted with **zero extra inference and zero Gemini cost**:
  into `analysis_results.training_flags.scene_training_candidate` on the normal path
  (queryable + GIN-indexed) and into `raw_response` on the crowd-skip path. No schema change.

- **Crop detector near-miss capture (Phase 1)**: the YOLO segmenter now keeps the
  "near-miss band" — detections it found but discarded for sitting just below the
  confidence threshold (`[0.15, threshold)`, top-5, relevant-class) — instead of silently
  dropping them at the filter. Surfaced as `training_flags.crop_near_miss` (+ count + top
  confidence). These are the richest crop hard-examples, especially when **no** detection
  passed and the image fell back to full-image analysis. Computed from data already in
  hand — zero extra inference, no schema change.

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

- **HD upload — per-gallery auto-upload flag (Phase 2)**: galleries gain an opt-in
  `settings.auto_hd_upload` (stored in the existing `galleries.settings` jsonb — no migration).
  A checkbox in the create-gallery modal and a toggle in the gallery-detail set it (the toggle
  persists via the existing `delivery-update-gallery` IPC, merging client-side so other
  `settings` keys survive the full-column update). When on, adding an execution to the gallery
  auto-starts the HD upload of its missing originals; when off (the default) HD upload stays a
  manual action — HD upload is always the user's choice unless the gallery opts in. The
  galleries query now selects `settings`. Reuses existing IPC; no new channel, token, or schema
  change.

- **HD upload — real HD chip on gallery cards (Phase 3)**: gallery cards now show real HD
  readiness aggregated from the linked images via a new read-only IPC `delivery-gallery-hd-status`
  (reads `images.original_upload_status` for the gallery's `gallery_images` rows): green
  "HD ready" when all originals are on R2, amber "HD N/M" when partial, dim "Previews only" when
  none, and the chip is dropped when the gallery has no linked images. Previously the chip
  checked fields the gallery row never carries, so it was effectively never shown. Filled async
  per card so the list renders immediately. One read-only IPC (handler + preload whitelist);
  no token or schema change.

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
