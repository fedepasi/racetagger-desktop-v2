# RaceTagger Desktop

Professional Electron desktop application for AI-powered race number detection in motorsport/running/cycling photography. TypeScript + Electron + Supabase.

**Status:** Beta Live Production.

> Cross-repo orchestration, token logic, migration template, and shared conventions live in the root **[../CLAUDE.md](../CLAUDE.md)** (auto-loaded). This file covers desktop-specific architecture only — it does not repeat root content.

## Offline Capability Policy

**Decision (2026-06-09, Federico) — applies to the whole desktop app.** The app is **online-required by default**. It works **offline for ONLY two things**:

1. **Reviewing already-analyzed results** (the review gallery, on data already present on this device).
2. **Export** of already-processed results.

**Everything else requires an active connection** — running an analysis (including the local **ONNX** flows, for now), participant/preset loading, token operations, and cross-device sync. Design every new feature against this constraint: assume the network is available for anything except *review* + *export*, and **fail clearly (not silently)** when it isn't. This is the guiding rule for the planned **JSONL → DB primary-source** migration: the **DB is the source of truth**, and the local cache exists only to keep *review* + *export* working offline.

## Essential Context

- **[DATABASE.md](./DATABASE.md)** — complete schema (85+ tables), Edge Functions, storage buckets
- **[RACETAGGER_CONTEXT.md](../RACETAGGER_CONTEXT.md)** — business context, pricing, market, buyer personas
- **[CHANGELOG.md](./CHANGELOG.md)** — version history
- **[../racetagger-app/CLAUDE.md](../racetagger-app/CLAUDE.md)** — web platform guide

## Shared Database with Web App

Supabase PostgreSQL (**project: `taompbzifylmdzgbbrpv`**) is shared with the Next.js web app at `../racetagger-app/`. Implications:

- **Schema changes** require migration files in `../racetagger-app/supabase/migrations/`
- **Edge Functions** in `supabase/functions/` (symlink → `../racetagger-app/supabase/functions/`) serve both platforms — desktop uses `analyzeImageDesktopV2`–`V6`, web uses `analyzeImageWeb`
- **Token system** (`user_tokens`, `token_transactions`, `batch_token_reservations`) is consumed by both apps — logic must stay in sync (see root CLAUDE.md "Token logic is sacred")
- **RLS policies** must account for both web auth (cookies) and desktop auth (JWT bearer tokens)

## Tech Stack

- **Framework:** Electron 36, TypeScript 5.9, Node.js 18+
- **Image Processing:** Sharp 0.34, raw-preview-extractor (custom C++ N-API in `/vendor/`) + ExifTool fallback
- **Database:** Supabase 2.30 (cloud, source of truth) + in-memory caches (categories 60s, presets 30s)
- **AI/ML:** Google Gemini (Flash/Pro/Lite via Edge Functions), onnxruntime-node 1.23 (local inference)
- **Face Recognition:** local ONNX — **YuNet** detection + **AuraFace v1** embedding (512-dim, cosine) — **IN TESTING** (live for a few test accounts; gated per-account by the DB plan flag `face_recognition_enabled`). face-api.js (legacy 128-dim) + canvas removed in v1.1.10.
- **Build:** electron-builder 24, cross-platform (macOS, Windows, Linux)
- **Testing:** Jest 29 + ts-jest

## Code Map

Source is ~45k lines of TypeScript main process + ~23k lines of plain-JS renderer. The orientation map below names the files that matter; use `wc -l` / `glob` for current sizes (don't trust embedded counts — they go stale).

```
src/
├── main.ts                      # Electron main process ★ large — avoid direct edits; preserve EPIPE guard
├── preload.ts                   # contextBridge IPC API (whitelisted channels)
├── config.ts                    # Multi-env config; MAX_SUPPORTED_EDGE_FUNCTION_VERSION lives here
├── config.production.ts         # Hardcoded production values (used when app.isPackaged)
│
├── unified-image-processor.ts   # Central processing pipeline ★ LARGEST file in the repo
├── smart-routing-processor.ts   # Routes images by sport_categories config
├── generic-segmenter.ts         # YOLOv8-seg subject segmentation
├── scene-classifier{,-onnx}.ts  # Scene type classification
├── onnx-detector.ts             # Local ONNX inference engine
├── model-manager.ts             # ONNX model download/versioning/caching (model_registry table)
│
├── auth-service.ts              # Supabase auth + token pre-authorization
├── database-service.ts          # Supabase CRUD + in-memory caches (categories, presets, CSV, export)
├── {user-preferences,consent,email}-service.ts
│
├── face-*.ts                    # Face recognition pipeline [IN TESTING] — ONNX, gated per-account
│
├── ipc/                         # Modular IPC handlers, one domain per file, registered in index.ts
│   ├── context.ts               # Shared state (mainWindow, caches, supabase singleton)
│   ├── types.ts                 # IPC interfaces (HandlerResult<T>, BatchProcessConfig, …)
│   ├── handler-factory.ts
│   └── {auth,database,supabase,export,app,file,image,csv,analysis,window,
│        version,feedback,error-telemetry,face-recognition,preset-face}-handlers.ts
│
├── matching/                    # Participant matching
│   ├── smart-matcher.ts         # Multi-evidence correlation ★ + driver-name helpers
│   ├── temporal-clustering.ts   # Burst mode detection
│   ├── evidence-collector.ts · cache-manager.ts · sport-config.ts · ocr-corrector.ts · ml-interfaces.ts
│
├── utils/                       # crop-context-extractor, analysis-logger (JSONL), metadata-writer
│   │                            # (EXIF/XMP/sidecar), folder-organizer, filename-renamer,
│   │                            # session-manager, memory-pool, raw-preview-native, native-tool-manager,
│   │                            # error-telemetry-service, performance-monitor, … (feature-per-file)
│
└── types/                       # piexifjs.d.ts, execution-settings.ts

renderer/                        # Plain HTML/CSS/JS, no framework, no build step
├── index.html                   # Layout shell (sidebar + content)
├── pages/                       # home · analysis · participants · settings · projects · destinations
├── js/                          # Navigo router + per-page modules. Biggest: participants-manager.js,
│   │                            # log-visualizer.js, renderer.js. The face-*.js are [IN TESTING] (gated per-account).
│   └── vendor/navigo.min.js
└── css/                         # One stylesheet per page/feature

tests/                           # Jest + performance/ benchmarks
supabase/                        # SYMLINK → ../racetagger-app/supabase (canonical)
vendor/                          # ExifTool binaries, raw-preview-extractor native addon
ml-training/                     # Python ONNX training pipeline
```

**Edge Functions** (`supabase/functions/`, Deno runtime): the desktop analysis path is `analyzeImageDesktopV2`–`V6` (V6 current). Everything else (registration, tokens, email, feedback, telemetry, training export, …) follows the verb-noun naming convention — `ls supabase/functions/` for the live list rather than maintaining one here.

## Key Commands

Full command list is in the root CLAUDE.md. Desktop-specific essentials:

```bash
npm run dev              # TypeScript watch + Electron (concurrently)
npm run dev:debug        # DEBUG_MODE=true
npm run compile          # tsc → /dist  (run this to verify TS after changes)
npm test                 # Jest
npm run test:performance:quick   # Quick regression after changes
npm run rebuild          # electron-rebuild (after npm install — native modules)
npm run rebuild:sharp    # Rebuild Sharp for Electron specifically
npm run build:mac:arm64 / build:win:x64 / …   # platform builds
```

## Architecture Deep Dive

### Core Processing Pipeline

Orchestrated by `unified-image-processor.ts`:

```
1. Image Discovery  → scan folder, detect RAW vs standard
2. RAW Preview      → raw-preview-extractor (native) or ExifTool fallback
3. Scene Classif.   → local ONNX classifies scene (track/paddock/podium/portrait)
4. Segmentation     → YOLOv8-seg isolates subjects (generic-segmenter.ts)
5. Crop Extraction  → crops per subject + "negative"/context image
6. AI Analysis      → Edge Function V6 (Gemini Vision) or local-onnx
7. Smart Matching   → match numbers to CSV participants (smart-matcher.ts)
8. Face Recognition → [IN TESTING] ONNX face match (fast-path; gated per-account)
9. Metadata Writing → EXIF/XMP/sidecar with matched data
10. Folder Org.     → organize by number/team/category
11. Export          → copy to configured export destinations
```

### Smart Routing (`smart-routing-processor.ts`)

Routes images through different pipelines based on `sport_categories` DB config:
- **recognition_method**: `gemini` | `local-onnx` (rf-detr cloud path removed 2026-04-22)
- **edge_function_version**: 2–6 (which Edge Function to call)
- **scene_classifier_enabled**: skip non-relevant scenes
- **crop_config**: enable crop+context multi-image analysis (V6)

### Edge Function Version History

```
V2: Basic analysis            V5: Vehicle + face recognition
V3: Temporal clustering       V6: Crop + Context multi-image ★ CURRENT
V4: RF-DETR + Gemini dual
```

`MAX_SUPPORTED_EDGE_FUNCTION_VERSION = 6` in `config.ts`. Categories with higher versions are hidden. Breaking changes require a new version — never edit a deployed one in place.

### IPC Architecture

Modular handlers in `src/ipc/`, one domain per file, registered centrally in `ipc/index.ts`.

- **`ipc/context.ts`** — shared state: `mainWindow` (safe send with destroyed-check), `globalCsvData`, `batchConfig`, `versionCheckResult`, `supabase` singleton, signed-URL cache
- **`preload.ts`** — exposes 3 methods via `contextBridge`: `window.api.send` (fire-and-forget), `.receive` (event listener, returns cleanup fn), `.invoke` (request/response). **All channels whitelisted** — adding a channel means editing the preload whitelist.
- Every handler returns `HandlerResult<T>`: `{ success: true, data: T } | { success: false, error: string }`

### Frontend

Navigo.js hash router (`renderer/js/router.js`). Routes: `#/home`, `#/analysis`, `#/participants`, `#/settings`, `#/projects`, `#/destinations`. Each page has a JS module that initializes on the `page-loaded` event. Pages cached after first fetch. Renderer talks to main **only** via `window.api`.

### Database

Supabase-only since v1.2.0 (SQLite/better-sqlite3 removed). Source of truth is cloud PostgreSQL; module-level in-memory caches with TTL (`categoriesCache` 60s, `presetsCache` 30s). Key files: `database-service.ts` (CRUD, caches, CSV, export destinations), `auth-service.ts` (session persistence, token balance, pre-authorization).

## Token System

Token tables, pre-authorization flow, and the "logic is sacred" rule are documented in the root CLAUDE.md. Desktop specifics:

- `pre_authorize_tokens()` RPC reserves with dynamic TTL (30min–12h by batch size) → returns `reservationId`
- Edge Function V6 tracks actual images analyzed
- `finalize_token_reservation()` RPC consumes actual, refunds unused, logs the transaction
- Timeout → `cleanup_expired_reservations()` auto-finalizes

Pre-auth lives in `auth-service.ts`. **Never change token logic without updating the web app too.**

## Performance Optimization

### Optimization Levels (`config.ts`, env `RACETAGGER_OPTIMIZATION_LEVEL`)

| Level | Uploads | Analysis | Rate | Memory | Streaming |
|-------|---------|----------|------|--------|-----------|
| DISABLED | 4 | 100 | 100/s | 512MB | No |
| CONSERVATIVE | 8 | 110 | 110/s | 1GB | No |
| **BALANCED** (default) | 12 | 120 | 120/s | 1.5GB | Yes |
| AGGRESSIVE | 20 | 125 | 125/s | 2GB | Yes |

### Streaming Pipeline (`PIPELINE_CONFIG`)

Activates for batches >50 images: RAW-converter workers 3, DNG→JPEG 2, upload 4, recognition 2; min free disk 5GB; 30s op timeout; 3-attempt backoff retry.

### Resize Presets

VELOCE (1080px/75%) · BILANCIATO (1440px/85%) · **QUALITA (1920px/90%, default)**

## AI/ML Systems

- **Gemini Vision (primary):** default `gemini-3.1-flash-lite`, called via Edge Functions V2–V6, configurable per sport category via `ai_prompt`, 30s timeout.
- **Local ONNX:** scene classification (`scene-classifier-onnx.ts`), object detection (`onnx-detector.ts`), YOLOv8-seg segmentation (`generic-segmenter.ts`), model lifecycle via `model-manager.ts` against the `model_registry` table.
- **Crop + Context (V6):** when `sport_categories.crop_config.enabled`, YOLOv8-seg segments subjects → extracts padded crops + a "negative" (subject-masked) context image → sends both to V6. Config in `config.ts` → `CropContextConfig`.
- **RF-DETR (removed 2026-04-22):** cloud Roboflow path deleted. `onnx-detector.ts`/`model-manager.ts` still accept `output_format: 'rf-detr'` as a *local* ONNX parsing hint for RT-DETR-style models — independent of the removed cloud path.

## RAW Processing

- **Primary:** `raw-preview-extractor` (`vendor/`) — custom C++ N-API addon extracting embedded JPEG previews. Formats: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG.
- **Fallback:** ExifTool (`vendor/{darwin,win32}/`), managed by `native-tool-manager.ts`.
- dcraw and ImageMagick were removed in v1.2.0.

## Participant Driver Data

**Canonical source:** `preset_participant_drivers` table (rows, not columns), separate from `preset_participants`. Columns: `driver_name`, `driver_metatag` (nullable), `driver_order` (0 = primary, 1 = co-driver, …).

In code, `Participant` (`smart-matcher.ts`) and `PresetParticipant` (`database-service.ts`) carry:
- `preset_participant_drivers?: ParticipantDriver[]` — loaded via Supabase nested select
- `nome?: string` — legacy CSV fallback (comma-separated names)

Helpers exported from `smart-matcher.ts`: `getParticipantDriverNames()` (sorted by `driver_order`, falls back to `nome`), `getPrimaryDriverName()`.

**Deprecated:** `nome_pilota`/`nome_navigatore`/`nome_terzo`/`nome_quarto` columns still exist on `preset_participants` but are **no longer used** — all driver logic uses `preset_participant_drivers`.

## SmartMatcher (`matching/smart-matcher.ts`)

Multi-evidence participant matching: OCR correction (6/8, 1/7 confusions), temporal clustering (same number in consecutive photos = same participant), fuzzy matching (configurable thresholds), sport-specific rules via `matching_config`, result caching (`cache-manager.ts`).

## Face Recognition (IN TESTING)

**In limited testing** as of 2026-06-30 (no longer "disabled") — live for a few test accounts, **gated per-account** by the DB plan flag `face_recognition_enabled`. The renderer reads it in `renderer/js/driver-face-manager.js` → global `FACE_RECOGNITION_ENABLED` (default `false`), which also gates the participants-page face slots; accounts without the flag never see the UI and never hit the path. The live recognition path is **local ONNX** in the main process: **YuNet** face detection (`face_detection_yunet_2023mar.onnx`, `face-detector-service.ts`) → **AuraFace v1** embedding (`auraface_v1.onnx`, 512-dim, `face-embedding-service.ts`) → cosine-similarity matching (`face-recognition-onnx-processor.ts` / `face-recognition-processor.ts`). The old **face-api.js** path is legacy — its library + canvas were removed in v1.1.10, but its 128-dim descriptors are still dual-read for migration (`descriptor_model` `'face-api-js'` vs `'auraface-v1'`; re-upload face photos to regenerate 512-dim). When a face matches, the backend fast-path in `unified-image-processor.ts` records the result (provider `face_recognition`) and short-circuits before Gemini.

## Analysis Logging

JSONL per execution (`exec_{execution_id}.jsonl`). Entry types: `EXECUTION_START`, `IMAGE_ANALYSIS`, `CORRECTION`, `TEMPORAL_CLUSTER`, `PARTICIPANT_MATCH`, `EXECUTION_COMPLETE`. Stored local (`.analysis-logs/` in user data) + Supabase Storage bucket `analysis-logs`.

## Automatic Error Telemetry

Proactive: desktop (fire-and-forget) → Edge Function `report-automatic-error` → Supabase + GitHub Issues. Catches both handled errors **and hard crashes** (the app closing unexpectedly).

- **Files:** `src/utils/error-telemetry-service.ts` (fingerprinting, rate limiting, sanitization, durable write-ahead queue), `src/utils/crash-recovery.ts` (next-launch crash detection), `src/ipc/error-telemetry-handlers.ts` (3 handlers), `supabase/functions/report-automatic-error/`. Crash detection reuses `diagnosticLogger.getPreviousSessionDiagnosis()` + the diagnostic log's `[SESSION START]`/`[SESSION END]` markers.
- **Tables:** `error_reports` (deduped by SHA-256 fingerprint, one row per unique error globally), `error_occurrences` (per user per event), `error_issue_mappings` (fingerprint → GitHub issue #).
- **Monitored (handled, live):** RAW preview failure, Edge Function errors, zero recognitions on batch >20, ONNX download/checksum failure, token reservation failure, segmentation load failure, uncaught exceptions + unhandled rejections, renderer crashes (`render-process-gone`), GPU/child-process crashes (`child-process-gone`).
- **Monitored (hard crashes, surfaced on next launch):** native crashes via Electron `crashReporter` (Crashpad minidump, **local-only** — never uploaded; reported as `native_crash`); abnormal exits with no minidump — OOM / kill / power-loss — detected via a missing `[SESSION END]` marker (`abnormal_exit`, warning), with a "last activity" phase hint + a capped tail of the crashed session's log.
- **Durability:** queued reports are persisted to disk (`telemetry-pending.json`) so a crash in the ~30s before the network flush re-sends them next launch; the flush waits for auth instead of dropping reports queued before login.
- **Dedup:** global cross-user. One GitHub issue per fingerprint; repeat users add a comment + count. `widespread` label when ≥5 users. Crash issues are labeled `crash` + a specific tag (`native-crash` / `abnormal-exit` / `renderer-crash` / `gpu-crash`).
- **Limits:** 5/execution, 20/day/user. 100% non-blocking. All logs sanitized (paths/emails/names via regex); opt-out in Settings → Privacy. Uses `GITHUB_PAT`.

## Environment Variables

```bash
# Required (.env)
SUPABASE_URL=https://taompbzifylmdzgbbrpv.supabase.co
SUPABASE_KEY=your-anon-key            # anon key ONLY — never service role in client

# Optional
DEBUG_MODE=true
RACETAGGER_OPTIMIZATION_LEVEL=balanced   # disabled|conservative|balanced|aggressive
ENABLE_STREAMING_PIPELINE=true
```

Production values are hardcoded in `config.production.ts` (used when `app.isPackaged`).

## Build & Signing

Targets: macOS (DMG/ZIP — arm64, x64, universal), Windows (NSIS/portable/ZIP — x64), Linux (AppImage/deb).

- **Code signing (macOS):** identity `FEDERICO PASINETTI (MNP388VJLQ)`, hardened runtime + notarization.
- **ASAR unpack** (need filesystem access): `sharp`, `@img/*`, `raw-preview-extractor`, `vendor/**`.
- **TS:** ES2020, CommonJS, strict, output `/dist/`.

## Critical DO NOTs

- **Security:** never expose service role key in client (anon only); never commit `.env` / `config.production.ts` secrets; never bypass RLS.
- **Database:** never modify production schema without a migration; never edit an existing migration (create a new one); never `SELECT *`.
- **Files:** never modify `/vendor/` or `/dist/` (edit `/src/`); never commit build artifacts (`/release/`, DMG, EXE).
- **Performance:** never load all images into memory (use streaming); never skip temp-file cleanup; never process >100 images without the streaming pipeline.
- **Code:** never `any` without a justification comment; never remove EPIPE protection / error handling from `main.ts`; never add an npm dependency without checking Electron native-module compatibility.
- **Build:** never skip native rebuild after `npm install`; never change `package.json` build config without cross-platform testing.
- **Cross-platform sync:** never change token logic, Edge Function signatures, or schema-driven types without updating the web app too.

## Common Tasks

**New IPC handler:** add fn in the right `src/ipc/*-handlers.ts` → export it → add channel to the `preload.ts` whitelist → add types in `ipc/types.ts` → call via `window.api.invoke('channel', …)`.

**New page:** HTML in `renderer/pages/` → route in `router.js` → sidebar link + `<script>` in `index.html` → JS module `renderer/js/<page>.js` → CSS if needed.

**New Edge Function version:** create `supabase/functions/analyzeImageDesktopVN/` → bump `MAX_SUPPORTED_EDGE_FUNCTION_VERSION` in `config.ts` → set `sport_categories.edge_function_version` → handle new response shape in `unified-image-processor.ts` → `npx supabase functions deploy analyzeImageDesktopVN`.

**Schema change:** migration in `../racetagger-app/supabase/migrations/` (with the GRANT template — see root CLAUDE.md) → update types → update `database-service.ts` → deploy, test both apps.

## Buyer Personas

Development decisions are guided by three target profiles (full market context in `RACETAGGER_CONTEXT.md`):

1. **Multi-Client Photographer** — covers races for many clients. Core need: **delivery speed**. Wants fast folder org by number/team, file renaming (`{number}_{name}_{team}-{seq:02}`), multi-client subfolders, batch export per client. IPTC: low priority.
2. **Editorial Photographer** — works with agencies (Getty, DPPI, Motorsport Images). Core need: **Getty-ready IPTC** on every image. Wants full metadata (caption with `{name}`, Person Shown, copyright, credit, keywords), per-agency IPTC profiles, XMP sidecars for RAW, caption templates, multi-match. IPTC: **mission-critical**.
3. **Event Organizer** — marketing team of circuits/organizers (not photographers). Core need: **searchable tags** for a downstream DAM. Wants AI tagging (numbers, scene, keywords into IPTC), visual tagging (logos, livery), bulk keywords, renaming. IPTC: medium (keywords matter, full editorial chain doesn't).

### Priority & Status

| Feature | Multi-Client | Editorial | Organizer | Priority | Status |
|---|:--:|:--:|:--:|:--:|---|
| AI number recognition | ★★★ | ★★★ | ★★★ | P0 | ✅ Live (V6 + local-onnx) |
| Participant matching (CSV) | ★★★ | ★★★ | ★★ | P0 | ✅ Live (SmartMatcher) |
| Folder organization | ★★★ | ★ | ★ | P1 | ✅ Live (admin) |
| File renaming on export | ★★★ | ★★ | ☆ | P1 | ✅ Built (not wired to results UI) |
| IPTC Pro metadata | ★ | ★★★ | ★ | P1 | ✅ Built |
| XMP sidecar for RAW | ★ | ★★★ | ☆ | P1 | ✅ Built |
| AI keywords | ★ | ★★ | ★★★ | P1 | ✅ Live |
| Multi-destination export | ★★★ | ★★★ | ☆ | P2 | ⚠️ Partial (no results-page trigger) |
| Web gallery/sharing | ☆ | ☆ | ★★★ | P3 | ❌ Future |

## General Instructions

The four Karpathy guidelines (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution) and the repo verification rails are in the root CLAUDE.md. Desktop reminders:

- Check **DATABASE.md** before touching DB code.
- Run `npm run compile` to verify TypeScript after changes; run performance tests when touching `main.ts` or `unified-image-processor.ts`.
- Preserve EPIPE protection and error handling in `main.ts`.
- When touching shared resources (DB, Edge Functions, types, token logic), consider the web-app impact.
