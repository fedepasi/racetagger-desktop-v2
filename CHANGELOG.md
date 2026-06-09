# Changelog - RaceTagger Desktop

## [Unreleased]

### 🐛 Fixes

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
- **Results review**: bulk multi-select **"Mark as No Match"** that keeps the
  original AI detection in history for future training (WF-01); 100% keyboard
  correction in the gallery (Enter confirms + advances, Space edits, type a
  number to correct, with an on-screen shortcuts hint — WF-02); deleting a
  detection no longer asks for confirmation (UX-01).
- **Startup reliability**: ONNX model download now retries with backoff, writes
  atomically (no more "sticky" truncated model files), validates size, and
  offers an in-app **Retry** button instead of "restart the app" (BUG-04).

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
