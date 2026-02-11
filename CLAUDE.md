# RaceTagger Desktop

Professional Electron desktop application for AI-powered race number detection in motorsport/running/cycling photography. Built with TypeScript, Electron, and Supabase.

**Version:** 1.1.0 | **Status:** Beta Live Production (57+ users, 2,578+ analyses)

## Essential Context

**Related Documentation:**
- **[DATABASE.md](./DATABASE.md)** - Complete schema (85+ tables), Edge Functions, storage buckets
- **[RACETAGGER_CONTEXT.md](../RACETAGGER_CONTEXT.md)** - Business context, pricing, market analysis
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history and release notes
- **[../CLAUDE.md](../CLAUDE.md)** - Cross-repository orchestration guide
- **[../racetagger-app/CLAUDE.md](../racetagger-app/CLAUDE.md)** - Web platform guide

## Shared Database with Web App

The Supabase PostgreSQL database (**project: `taompbzifylmdzgbbrpv`**) is shared between this desktop app and the Next.js web app at `../racetagger-app/`. Key implications:

- **Schema changes** require migration files in `../racetagger-app/supabase/migrations/` AND corresponding SQLite schema updates in `src/database-service.ts`
- **Edge Functions** in `supabase/functions/` serve both platforms (desktop uses `analyzeImageDesktopV2-V6`, web uses `analyzeImageWeb`)
- **Token system** (`user_tokens`, `token_transactions`, `batch_token_reservations`) is consumed by both apps - logic must stay in sync
- **RLS policies** must account for both web auth (cookies) and desktop auth (JWT bearer tokens)
- The `supabase/` directory contains Edge Functions shared with the web app

## Tech Stack

- **Framework:** Electron 36.9.5, TypeScript 5.9.2, Node.js 18+
- **Image Processing:** Sharp 0.34.3, jimp 1.6.0, raw-preview-extractor (custom in `/vendor/`)
- **RAW Conversion:** dcraw (external binary), raw-preview-extractor (embedded previews)
- **Database:** better-sqlite3 11.10.0 (local cache), Supabase 2.30.0 (cloud primary)
- **AI/ML:** Google Gemini (Flash/Pro/Lite via Edge Functions), onnxruntime-node 1.23.2 (local inference)
- **Face Recognition:** face-api.js 0.22.2, canvas 3.2.0 (DISABLED - Coming Soon)
- **Build:** electron-builder 24.13.0, cross-platform (macOS, Windows, Linux)
- **Testing:** Jest 29.7.0, ts-jest 29.4.1

## Project Structure

```
/src/                              # TypeScript source (~44,900 lines total)
├── main.ts                        # Electron main process (3,607 lines)
├── preload.ts                     # Preload script, contextBridge IPC API (306 lines)
├── config.ts                      # Multi-environment config (708 lines)
├── config.production.ts           # Hardcoded production values
│
├── unified-image-processor.ts     # Central processing pipeline (6,759 lines) ★ LARGEST
├── smart-routing-processor.ts     # Intelligent routing based on category config (455 lines)
├── generic-segmenter.ts           # YOLOv8-seg subject segmentation (749 lines)
├── scene-classifier.ts            # Scene type classification (433 lines)
├── scene-classifier-onnx.ts       # ONNX-based scene classifier
├── onnx-detector.ts               # Local ONNX inference engine (837 lines)
├── model-manager.ts               # ONNX model download/versioning/caching (739 lines)
├── yolo-model-registry.ts         # YOLO model variant registry
│
├── auth-service.ts                # Supabase auth + token pre-authorization (1,266 lines)
├── database-service.ts            # SQLite connection pool + Supabase sync (4,286 lines)
├── database-migration.ts          # SQLite schema migration framework (171 lines)
├── user-preferences-service.ts    # User settings persistence
├── consent-service.ts             # Training consent management
├── email-service.ts               # Brevo email integration
├── folder-select-handler.ts       # Enhanced folder selection with drag & drop
│
├── face-recognition-processor.ts  # Face detection pipeline (440 lines) [DISABLED]
├── face-detection-bridge.ts       # Bridge for renderer face detection [DISABLED]
│
├── ipc/                           # Modular IPC handlers (128 handlers across 14 files)
│   ├── index.ts                   # Central registration + re-exports
│   ├── context.ts                 # Shared state (mainWindow, caches, Supabase client)
│   ├── types.ts                   # IPC TypeScript interfaces (HandlerResult, BatchProcessConfig, etc.)
│   ├── handler-factory.ts         # Handler creation utilities
│   ├── window-handlers.ts         # Window control (3 handlers)
│   ├── auth-handlers.ts           # Auth, tokens, admin, subscriptions (18 handlers)
│   ├── database-handlers.ts       # Projects, executions, presets (22 handlers)
│   ├── supabase-handlers.ts       # Sport categories, caching, feature flags (19 handlers)
│   ├── export-handlers.ts         # Export destinations & processing (13 handlers)
│   ├── app-handlers.ts            # App info, consent, settings (11 handlers)
│   ├── file-handlers.ts           # File dialogs, folder operations (8 handlers)
│   ├── image-handlers.ts          # Thumbnail generation, image loading (5 handlers)
│   ├── csv-handlers.ts            # CSV loading and parsing (4 handlers)
│   ├── analysis-handlers.ts       # Analysis logs, pipeline, log viewer (4 handlers)
│   ├── face-recognition-handlers.ts  # Face detection and matching (6 handlers)
│   ├── preset-face-handlers.ts    # Preset participant face photos (6 handlers)
│   ├── version-handlers.ts        # App version checking, force update (4 handlers)
│   └── feedback-handlers.ts       # Support feedback & diagnostics (5 handlers)
│
├── matching/                      # Participant matching algorithms
│   ├── smart-matcher.ts           # Multi-evidence correlation (2,253 lines) ★
│   ├── temporal-clustering.ts     # Burst mode detection (811 lines)
│   ├── evidence-collector.ts      # Evidence aggregation
│   ├── cache-manager.ts           # Match result caching (595 lines)
│   ├── sport-config.ts            # Sport-specific matching rules (617 lines)
│   ├── ocr-corrector.ts           # OCR error correction
│   └── ml-interfaces.ts           # ML pipeline interfaces (549 lines)
│
├── utils/                         # Utilities
│   ├── raw-converter.ts           # dcraw-based RAW processing (1,805 lines) ★
│   ├── raw-preview-native.ts      # Native RAW preview extraction (634 lines)
│   ├── crop-context-extractor.ts  # Crop + context multi-image extraction (940 lines)
│   ├── analysis-logger.ts         # JSONL logging system (1,024 lines)
│   ├── metadata-writer.ts         # EXIF/XMP/sidecar writing (828 lines)
│   ├── folder-organizer.ts        # File organization by number/team (727 lines)
│   ├── session-manager.ts         # Session state persistence (622 lines)
│   ├── memory-pool.ts             # Buffer pooling for performance (586 lines)
│   ├── export-destination-processor.ts # Export to configured destinations (516 lines)
│   ├── native-modules.ts          # Native module management (512 lines)
│   ├── cleanup-manager.ts         # Temp file lifecycle (471 lines)
│   ├── filename-renamer.ts        # File renaming strategies (446 lines)
│   ├── xmp-manager.ts             # XMP sidecar creation
│   ├── disk-monitor.ts            # Disk space management
│   ├── performance-monitor.ts     # Real-time metrics
│   ├── performance-timer.ts       # High-res timing
│   ├── dcraw-installer.ts         # Auto dcraw installation
│   ├── native-tool-manager.ts     # ExifTool management
│   ├── logger.ts                  # Structured logging
│   ├── system-info.ts             # System diagnostics
│   ├── hardware-detector.ts       # Hardware capability detection
│   ├── network-monitor.ts         # Network status monitoring
│   ├── error-tracker.ts           # Error aggregation
│   ├── filesystem-timestamp.ts    # File timestamp utilities
│   └── mask-rle.ts                # Run-length encoding for masks
│
├── types/                         # Type definitions
│   ├── piexifjs.d.ts              # EXIF library types
│   └── execution-settings.ts      # Execution telemetry types
│
└── assets/                        # App icons, resources

/renderer/                         # Frontend (HTML/CSS/JS, ~23,400 lines JS)
├── index.html                     # Main layout shell (sidebar + content area)
├── pages/                         # Page content (dynamically loaded by router)
│   ├── home.html                  # Dashboard (stats, recent executions, announcements)
│   ├── analysis.html              # Image analysis (folder/CSV select, processing)
│   ├── participants.html          # Participant presets management
│   ├── settings.html              # User settings
│   ├── projects.html              # Project management
│   └── destinations.html          # Export destinations
├── js/                            # JavaScript modules (28 files)
│   ├── router.js                  # Navigo.js hash router (434 lines)
│   ├── renderer.js                # Core renderer logic (2,333 lines)
│   ├── participants-manager.js    # Preset management (3,734 lines) ★ LARGEST
│   ├── log-visualizer.js          # Execution log viewer (3,129 lines)
│   ├── enhanced-file-browser.js   # Folder selection with drag & drop (1,365 lines)
│   ├── delight-integration.js     # UI delight system (1,120 lines)
│   ├── auth.js                    # Authentication UI (1,039 lines)
│   ├── enhanced-progress.js       # Progress tracking UI (865 lines)
│   ├── delight-system.js          # Animation & feedback system (855 lines)
│   ├── export-destinations.js     # Export config UI (822 lines)
│   ├── desktop-ui.js              # Desktop-specific UI (746 lines)
│   ├── preset-face-manager.js     # Face photo management (749 lines) [DISABLED]
│   ├── results-page.js            # Analysis results display (668 lines)
│   ├── home.js                    # Dashboard logic (501 lines)
│   ├── driver-face-manager.js     # Driver face panels (488 lines) [DISABLED]
│   ├── face-detector.js           # face-api.js wrapper (467 lines) [DISABLED]
│   ├── enhanced-processing.js     # Processing pipeline UI (459 lines)
│   ├── face-recognition-ui.js     # Recognition badge UI (422 lines) [DISABLED]
│   ├── feedback-modal.js          # Support feedback (402 lines)
│   ├── settings.js                # Settings page logic
│   ├── smart-presets.js           # Smart preset features
│   ├── streaming-view.js          # Streaming pipeline progress
│   ├── visual-tagging-manager.js  # Visual tag display
│   ├── gallery-zoom.js            # Image gallery zoom
│   ├── enhanced-ui-coordinator.js # UI state coordination
│   ├── admin-features.js          # Admin-only features
│   ├── force-update.js            # Force update modal
│   ├── last-analysis-settings.js  # Persist last used settings
│   └── vendor/navigo.min.js       # Navigo 8.11.1
└── css/                           # Stylesheets (15 files)
    ├── styles.css                 # Base styles
    ├── desktop-theme.css          # Desktop app theme
    ├── sidebar.css                # Navigation sidebar
    ├── auth.css                   # Login/register
    ├── participants.css           # Participants page (inc. Coming Soon)
    ├── settings.css               # Settings page
    ├── results-integrated.css     # Results display
    ├── enhanced-progress.css      # Progress indicators
    ├── enhanced-file-browser.css  # File browser
    ├── processing-status.css      # Processing states
    ├── smart-presets.css          # Smart presets
    ├── delight-system.css         # Animations & delight
    ├── home-user.css              # Home page
    ├── admin-features.css         # Admin UI
    └── feedback-modal.css         # Feedback dialog

/tests/                            # Jest tests + performance benchmarks
├── setup.ts                       # Test environment setup
├── __mocks__/                     # Electron & fs mocks
│   ├── electron.ts
│   └── fs.ts
├── ipc-handlers.test.ts           # IPC handler tests
├── smart-matcher.test.ts          # SmartMatcher algorithm tests
├── driver-preservation.test.ts    # Driver data preservation tests
├── upsert-logic.test.ts           # Database upsert tests
├── metadata-writer-raw-guard.test.ts  # RAW file protection tests
├── fallback-mechanisms.test.ts    # Fallback behavior tests
├── file-selection.test.ts         # File selection tests
├── folder-selection.test.ts       # Folder selection tests
├── initialization-coordination.test.ts  # Init sequence tests
└── performance/                   # Performance benchmarks
    ├── benchmark-suite.ts         # Full benchmark suite
    └── test-runner.ts             # Benchmark runner

/supabase/functions/               # Edge Functions (41 functions, Deno runtime)
├── analyzeImageDesktop/           # V1 - Basic Gemini analysis
├── analyzeImageDesktopV2/         # V2 - SmartMatcher integration
├── analyzeImageDesktopV3/         # V3 - Temporal clustering
├── analyzeImageDesktopV4/         # V4 - RF-DETR + Gemini dual recognition
├── analyzeImageDesktopV5/         # V5 - Local ONNX + face recognition
├── analyzeImageDesktopV6/         # V6 - Crop+Context multi-image ★ CURRENT
├── analyzeImageWeb/               # Web demo (rate limited, 3 free)
├── analyzeImage/                  # Legacy V1
├── analyzeImageAdmin/             # Admin analysis
├── identifyPersonWithGrounding/   # Person identification with grounding
├── visualTagging/                 # Visual feature extraction
├── parsePdfEntryList/             # PDF entry list parsing
├── track-execution-settings/      # Telemetry tracking
├── export-training-labels/        # Training data export
├── uploadImage/                   # Image storage
├── submitFeedback/                # User feedback
├── handle-token-request/          # Token request workflow
├── get-registrants/               # Pending registrants
├── grant-bonus-tokens/            # Admin token grants
├── register-user-unified/         # User registration
├── register-subscriber/           # Legacy registration
├── verify-and-activate-code/      # Access code verification
├── check-user-registration-status/ # Registration state check
├── create-auth-user/              # Auth user creation
├── delete-user-accounts/          # User data deletion
├── generate-access-codes/         # Access code generation
├── process-access-grants/         # Access grant processing
├── process-referral-signup/       # Referral processing
├── send-confirmation-email/       # Confirmation emails (Brevo)
├── send-token-request-email/      # Token request notification
├── send-token-balance-email/      # Balance notification
├── send-contact-email/            # Contact form
├── verify-recaptcha/              # reCAPTCHA validation
├── sync-to-brevo/                 # Brevo/Sendinblue sync
├── admin-approve-feedback/        # Admin feedback approval
├── submit-feedback-with-rewards/  # Feedback with token rewards
├── submit-social-share/           # Social share tracking
├── update-feedback-tokens/        # Feedback token grants
├── quick-register-from-feedback/  # Quick registration
├── test-auth-user-check/          # Auth testing
└── shared/                        # Shared utilities

/scripts/                          # Build scripts, utilities
/vendor/                           # Native dependencies (dcraw, ExifTool, raw-preview-extractor)
/ml-training/                      # ML model training pipeline (Python, ONNX conversion)
/dist/                             # Compiled TypeScript output (generated)
/release/                          # Built installers (generated)
```

## Key Commands

**Development:**
```bash
npm run dev              # TypeScript watch + Electron dev mode (concurrently)
npm run dev:debug        # Development with DEBUG_MODE=true
npm run compile          # Compile TypeScript to /dist
npm start                # Start compiled app
```

**Testing:**
```bash
npm test                 # Jest test suite (10 test files)
npm run test:watch       # Jest watch mode
npm run test:coverage    # Coverage report
npm run test:performance # Standard performance tests
npm run test:performance:quick   # Quick regression tests
npm run test:performance:full    # Comprehensive benchmark
npm run benchmark        # Alias for test:performance:full
npm run regression-test  # Alias for test:performance:quick
```

**Build:**
```bash
npm run build            # tsc + electron-builder (current platform)
npm run build:mac:arm64  # macOS Apple Silicon DMG+ZIP
npm run build:mac:x64    # macOS Intel DMG+ZIP
npm run build:mac:universal  # macOS Universal Binary
npm run build:mac:all    # All macOS architectures
npm run build:win:x64    # Windows 64-bit (NSIS + portable + ZIP)
npm run build:win:arm64  # Windows ARM64
npm run build:win:all    # All Windows architectures
```

**Native Modules:**
```bash
npm run rebuild          # electron-rebuild (all native modules)
npm run rebuild:sharp    # Rebuild Sharp.js for Electron specifically
npm run postinstall      # Auto-runs electron-builder install-app-deps
```

## Architecture Deep Dive

### Core Processing Pipeline

The image processing flows through a multi-stage pipeline orchestrated by `unified-image-processor.ts` (6,759 lines):

```
1. Image Discovery    → Scan folder, detect formats (RAW vs standard)
2. RAW Conversion     → dcraw → JPEG (or raw-preview-extractor fallback)
3. Scene Classif.     → Local ONNX model classifies scene type (track/paddock/podium/portrait)
4. Segmentation       → YOLOv8-seg isolates subjects (generic-segmenter.ts)
5. Crop Extraction    → Extract crops per subject + negative/context image
6. AI Analysis        → Edge Function V6 (Gemini Vision or RF-DETR)
7. Smart Matching     → Match numbers to CSV participants (smart-matcher.ts)
8. Face Recognition   → [DISABLED] face-api.js matching
9. Metadata Writing   → EXIF/XMP/sidecar with matched data
10. Folder Org.       → Organize files by number/team/category
11. Export            → Copy to configured export destinations
```

### Smart Routing (`smart-routing-processor.ts`)

Routes images through different pipelines based on `sport_categories` database config:
- **recognition_method**: `gemini` | `rf-detr` | `local-onnx`
- **edge_function_version**: 2-6 (determines which Edge Function to call)
- **scene_classifier_enabled**: Skip non-relevant scenes
- **crop_config**: Enable crop+context multi-image analysis (V6)

### Edge Function Version History

```
V2: Basic analysis (app 1.0.0 - 1.0.7)
V3: Advanced annotations + temporal clustering (app 1.0.8+)
V4: RF-DETR + Gemini dual recognition (app 1.0.9+)
V5: Vehicle recognition + face recognition (app 1.0.11+)
V6: Crop + Context multi-image analysis (app 1.0.12+) ★ CURRENT
```

**`MAX_SUPPORTED_EDGE_FUNCTION_VERSION = 6`** in `config.ts`. Categories with higher versions are hidden.

### IPC Architecture

128 handlers across 14 modular files, registered centrally in `ipc/index.ts`.

**Context (`ipc/context.ts`):** Shared state module providing:
- `mainWindow` reference (safe send with destroyed-check)
- `globalCsvData` - Loaded CSV participant data
- `batchConfig` - Current batch processing configuration
- `versionCheckResult` - Force update state
- `supabase` - Singleton Supabase client
- `supabaseImageUrlCache` - URL caching for signed URLs

**Preload API (`preload.ts`):** Exposes 3 methods to renderer via `contextBridge`:
- `window.api.send(channel, data)` - Fire-and-forget
- `window.api.receive(channel, callback)` - Event listener (returns cleanup fn)
- `window.api.invoke(channel, ...args)` - Promise-based request/response

All channels are whitelisted (57 send/receive + 171 invoke channels).

### Frontend Architecture

**Router:** Navigo.js 8.11.1 hash-based routing (`renderer/js/router.js`)
- Routes: `#/home`, `#/analysis`, `#/participants`, `#/settings`, `#/projects`, `#/destinations`
- Dynamic page loading from `/renderer/pages/`
- Page caching to avoid re-fetching HTML
- Events: `page-loaded`, `section-changed`

**Page initialization:** Each page has a corresponding JS module that initializes on `page-loaded`.

### Database Architecture

**Dual-Mode Storage:**
```
Desktop App
├── SQLite (better-sqlite3) ← Local cache for offline + performance
│   ├── WAL mode, 40MB cache, 256MB mmap
│   ├── Connection pool (2-8 connections)
│   └── Statement caching (up to 100 prepared statements)
│
└── Supabase PostgreSQL ← Source of truth (cloud)
    ├── 85+ tables with RLS policies
    ├── 41+ Edge Functions (Deno runtime)
    └── 7 storage buckets
```

**Migration Framework (`database-migration.ts`):**
- `SchemaVersions` table tracks applied migrations
- Migrations run sequentially by version number
- Currently 1 migration applied (add `raw_analysis` column)
- New migrations: Add to `migrations` array with version + migrate function

**Key Database Operations:**
- `database-service.ts` (4,286 lines): SQLite initialization, CRUD ops, Supabase sync
- `auth-service.ts` (1,266 lines): Session persistence, token balance, pre-authorization

## Token System

### Architecture

```
1 token = 1 image analysis (consumed by Edge Function)
Source of truth: user_tokens table in Supabase PostgreSQL
```

**Key Tables:**
- `user_tokens` - Current balance (`tokens_purchased` - `tokens_used` = remaining)
- `token_transactions` - Complete audit log (purchase/usage/bonus/refund)
- `batch_token_reservations` - Pre-authorization for batch processing

### Pre-Authorization Flow (v1.1.0+)

```
1. Desktop calls pre_authorize_tokens() RPC
   → Reserves tokens with dynamic TTL (30min-12h based on batch size)
   → Returns reservationId

2. Edge Function V6 processes images
   → Tracks actual images analyzed

3. Desktop calls finalize_token_reservation() RPC
   → Consumes actual tokens used
   → Refunds reserved-but-unused tokens
   → Generates transaction log entry

4. Timeout: cleanup_expired_reservations() auto-finalizes
```

### Current Pricing (Beta)

| Tier | Tokens | Price |
|------|--------|-------|
| STARTER | 3,000 | 29 |
| PROFESSIONAL | 10,000 | 49 |
| STUDIO | 25,000 | 99 |

## Performance Optimization System

### Optimization Levels (`config.ts`)

| Level | Uploads | Analysis | Rate Limit | Memory | Streaming |
|-------|---------|----------|------------|--------|-----------|
| DISABLED | 4 | 100 | 100/s | 512MB | No |
| CONSERVATIVE | 8 | 110 | 110/s | 1GB | No |
| **BALANCED** | 12 | 120 | 120/s | 1.5GB | Yes |
| AGGRESSIVE | 20 | 125 | 125/s | 2GB | Yes |

Default: **BALANCED**. Configurable via `RACETAGGER_OPTIMIZATION_LEVEL` env var.

### Streaming Pipeline (`config.ts` → `PIPELINE_CONFIG`)

Activates for batches >50 images:
- RAW converter workers: 3
- DNG-to-JPEG workers: 2
- Upload workers: 4
- Recognition workers: 2
- Min free disk space: 5GB
- Operation timeout: 30s
- Auto-retry: 3 attempts with backoff

### Resize Presets

| Preset | Max Dim | JPEG Quality |
|--------|---------|--------------|
| VELOCE | 1080px | 75% |
| BILANCIATO | 1440px | 85% |
| **QUALITA** | 1920px | 90% |

Default: **QUALITA**

## AI/ML Systems

### Gemini Vision (Primary)

- Default model: `gemini-2.5-flash-lite`
- Called via Edge Functions (V2-V6)
- Configurable per sport category via `ai_prompt` field
- 30s timeout per request

### RF-DETR Object Detection

- Roboflow serverless workflows
- Cost: ~$0.0045/image
- Label format: `"MODEL_NUMBER"` (e.g., `"SF-25_16"`)
- Configured per category: `sport_categories.recognition_method = 'rf-detr'`

### Local ONNX Inference

- Scene classification: `scene-classifier-onnx.ts`
- Object detection: `onnx-detector.ts` (837 lines)
- Generic segmentation: `generic-segmenter.ts` (YOLOv8-seg, 749 lines)
- Model management: `model-manager.ts` (download, version, cache from `model_registry` table)

### Crop + Context System (V6)

When `sport_categories.crop_config.enabled = true`:
1. YOLOv8-seg segments subjects in image
2. Extracts individual crops per subject (with padding)
3. Generates "negative" image (subject masked out) for context
4. Sends crops + negative to Edge Function V6 for analysis
5. Configured in `config.ts` → `CropContextConfig`

## RAW Processing

**Primary: dcraw** (`utils/raw-converter.ts`, 1,805 lines)
- Formats: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG
- Auto-installation via `dcraw-installer.ts`
- Batch processing with configurable workers

**Fallback: raw-preview-extractor** (`vendor/raw-preview-extractor/`)
- Custom module extracting embedded JPEG previews
- Fast but lower resolution (200KB-2MB)
- Used when dcraw unavailable or fails

## SmartMatcher (`matching/smart-matcher.ts`, 2,253 lines)

Multi-evidence participant matching:
- **OCR correction**: Common digit confusions (6/8, 1/7, etc.)
- **Temporal clustering**: Same number in consecutive photos = same participant
- **Fuzzy matching**: Partial number matches with configurable thresholds
- **Sport-specific rules**: Configured per category via `matching_config`
- **Cache management**: Results cached for performance (`cache-manager.ts`)

## Face Recognition (DISABLED)

**Status:** UI shows "Coming Soon" with blurred preview. Feature disabled at 3 layers.

**To re-enable:**
1. `renderer/js/face-detector.js` - Set `FACE_RECOGNITION_ENABLED = true`
2. `renderer/js/driver-face-manager.js` - Set `FACE_RECOGNITION_ENABLED = true`
3. `renderer/pages/participants.html` - Remove disabled class, restore original UI

**Related files (code intact, just disabled):**
- `renderer/js/face-recognition-ui.js`, `preset-face-manager.js`
- `src/ipc/face-recognition-handlers.ts` (6 handlers)
- `src/ipc/preset-face-handlers.ts` (6 handlers)
- `src/face-recognition-processor.ts`, `face-detection-bridge.ts`

## Analysis Logging

**Format:** JSONL files per execution (`exec_{execution_id}.jsonl`)

**Entry types:**
- `EXECUTION_START` - Config, image count, category, preset
- `IMAGE_ANALYSIS` - AI response, corrections, final results
- `CORRECTION` - Individual correction with reasoning
- `TEMPORAL_CLUSTER` - Burst mode grouping decisions
- `PARTICIPANT_MATCH` - Fuzzy matching results with scores
- `EXECUTION_COMPLETE` - Final statistics

**Storage:**
- Local: `.analysis-logs/` in user data folder
- Remote: Supabase Storage bucket `analysis-logs` (auto-upload every 30s in dev)

## Environment Variables

**Required in `.env`:**
```bash
SUPABASE_URL=https://taompbzifylmdzgbbrpv.supabase.co
SUPABASE_KEY=your-anon-key
```

**Optional:**
```bash
ROBOFLOW_DEFAULT_API_KEY=your-roboflow-key   # For RF-DETR recognition
DEBUG_MODE=true                               # Verbose logging
RACETAGGER_OPTIMIZATION_LEVEL=balanced        # disabled|conservative|balanced|aggressive
ENABLE_STREAMING_PIPELINE=true                # Force streaming mode
```

**Production:** Values hardcoded in `config.production.ts` (used when `app.isPackaged`).

## Build Configuration

**Cross-Platform Targets:**

| Platform | Formats | Architectures |
|----------|---------|---------------|
| macOS | DMG, ZIP | arm64, x64, universal |
| Windows | NSIS, portable, ZIP | x64 |
| Linux | AppImage, deb | - |

**Code Signing (macOS):**
- Identity: `FEDERICO PASINETTI (MNP388VJLQ)`
- Hardened runtime + notarization enabled
- Sign ignore: vendor data files, Windows vendor

**ASAR Unpack:** Native modules that need filesystem access:
- `sharp`, `@img/*`, `better-sqlite3`, `jimp`, `raw-preview-extractor`
- `vendor/**/*` (dcraw, ExifTool)

**TypeScript Config:**
- Target: ES2020, Module: CommonJS
- Strict mode enabled
- Output: `/dist/`
- Includes: `src/**/*`, `tests/performance/**/*`

## Code Conventions

**TypeScript:**
- Strict mode, no `any` without justification
- Interfaces in `/src/ipc/types.ts` for IPC contracts
- `interface` for object shapes, `type` for unions/intersections
- Explicit return types on public functions
- `HandlerResult<T>` pattern for IPC responses: `{ success: true, data: T } | { success: false, error: string }`

**File Organization:**
- IPC handlers: One domain per file in `/src/ipc/`
- Utilities: Feature-specific files in `/src/utils/`
- Matching: Algorithm files in `/src/matching/`
- Target: files under 500 lines (split if larger)

**Electron Patterns:**
- Main process: `src/main.ts` - avoid direct modifications when possible
- IPC: Use modular handlers in `/src/ipc/`, register via `registerAllHandlers()`
- Preload: Whitelist channels explicitly in `preload.ts`
- Renderer: Plain JS (no framework), communicate only via `window.api`

**Error Handling:**
- EPIPE protection in `main.ts` (prevent crash on broken pipes)
- Structured error return via `HandlerResult<T>`
- Resource cleanup in catch blocks (files, buffers, DB connections)
- Console disabled in production renderer (via preload override)

## Critical DO NOTs

**Security:**
- NEVER expose service role key in client code (desktop uses anon key only)
- NEVER commit `.env` files or `config.production.ts` secrets
- NEVER bypass RLS policies
- NEVER hardcode API keys (use env vars or config.production.ts)

**Database:**
- NEVER modify production Supabase schema without migration file
- NEVER modify existing migration files (create new ones)
- NEVER modify SQLite schema without matching Supabase migration
- NEVER use `SELECT *` (specify columns for performance)
- NEVER disable RLS in production

**File Operations:**
- NEVER modify files in `/vendor/` directory
- NEVER modify compiled files in `/dist/` (edit source in `/src/`)
- NEVER commit build artifacts (`/release/`, DMG, EXE files)
- NEVER delete `/dist/` manually (use `npm run compile`)

**Performance:**
- NEVER load all images into memory at once (use streaming pipeline)
- NEVER skip cleanup of temporary files
- NEVER exceed 2GB memory usage per worker
- NEVER process >100 images without streaming pipeline

**Code Quality:**
- NEVER use `any` type without justification comment
- NEVER create monolithic files >1000 lines (split into modules)
- NEVER add npm dependencies without checking native module compatibility with Electron
- NEVER remove EPIPE protection or error handling from main.ts

**Build:**
- NEVER skip native module rebuild after `npm install`
- NEVER modify `package.json` build config without cross-platform testing
- NEVER modify electron-builder config without testing on target platform

**Cross-Platform Sync:**
- NEVER change token logic without updating both desktop + web
- NEVER change Edge Function signatures without versioning
- NEVER deploy schema changes without updating types in both apps

## Common Tasks

**Adding a new IPC handler:**
1. Add handler function in appropriate file in `/src/ipc/`
2. Export from that file
3. Add channel to whitelist in `/src/preload.ts` (`validInvokeChannels` or `validSendReceiveChannels`)
4. Add TypeScript interface in `/src/ipc/types.ts` if new types needed
5. Call from renderer via `window.api.invoke('channel-name', ...args)`

**Adding a new page:**
1. Create HTML in `/renderer/pages/pagename.html`
2. Add route in `/renderer/js/router.js`
3. Add sidebar navigation link in `/renderer/index.html`
4. Create JS module in `/renderer/js/pagename.js` with initialization logic
5. Load JS in `/renderer/index.html` via `<script>` tag
6. Add CSS in `/renderer/css/pagename.css` if needed

**Adding a new Edge Function version:**
1. Create `/supabase/functions/analyzeImageDesktopVN/index.ts`
2. Update `MAX_SUPPORTED_EDGE_FUNCTION_VERSION` in `config.ts`
3. Update `sport_categories.edge_function_version` in database
4. Update `unified-image-processor.ts` to handle new response format
5. Deploy: `npx supabase functions deploy analyzeImageDesktopVN`

**Database schema change:**
1. Create migration in `../racetagger-app/supabase/migrations/YYYYMMDDHHMMSS_description.sql`
2. Update SQLite schema in `src/database-service.ts` (mirror tables)
3. Add migration in `src/database-migration.ts` if existing data needs transformation
4. Update types in `src/ipc/types.ts` or `src/types/`
5. Deploy migration to Supabase, test both apps

**Debugging:**
```bash
# Debug mode with verbose logging
DEBUG_MODE=true npm run dev:debug

# Check dcraw availability
# Monitor in renderer console for [dcraw] logs

# Performance profiling
npm run benchmark

# Quick regression check after changes
npm run regression-test
```

## General Instructions

- **Do what has been asked; nothing more, nothing less**
- **ALWAYS prefer editing existing files to creating new ones**
- **NEVER proactively create documentation files (*.md) unless explicitly requested**
- **When modifying core systems (main.ts, unified-image-processor.ts), run performance tests**
- **Check DATABASE.md before modifying database-related code**
- **Test builds on target platform before suggesting deployment**
- **Preserve EPIPE protection and error handling in main.ts**
- **When modifying shared resources (DB, Edge Functions, types), consider impact on web app**
- **Run `npm run compile` to verify TypeScript after changes**
