# RaceTagger Desktop

Professional Electron desktop application for AI-powered race number detection in motorsport photography. Built with TypeScript, Electron, and Supabase.

## Essential Context

**Related Documentation:**
- **[DATABASE.md](./DATABASE.md)** - Complete schema (85+ tables), Edge Functions, storage buckets
- **[RACETAGGER_CONTEXT.md](../RACETAGGER_CONTEXT.md)** - Business context, pricing, features
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history and release notes

## Tech Stack

- **Framework:** Electron 36.0.0, TypeScript 5.9.2, Node.js 18+
- **Image Processing:** Sharp 0.34.3, jimp 1.6.0, raw-preview-extractor (custom)
- **RAW Conversion:** dcraw (external), raw-preview-extractor (embedded previews)
- **Database:** better-sqlite3 11.10.0 (local), Supabase 2.30.0 (cloud sync)
- **AI Provider:** Google Gemini (Flash/Pro/Lite via Edge Functions)
- **Face Recognition:** face-api.js 0.22.2, canvas 3.2.0
- **Build:** electron-builder 24.13.0, cross-platform (macOS, Windows, Linux)

## Project Structure

```
/src/                          # TypeScript source code
├── main.ts                    # Electron main process (~3,800 lines)
├── preload.ts                 # Preload script for IPC
├── ipc/                       # Modular IPC handlers (117 handlers)
│   ├── index.ts              # Central registration
│   ├── context.ts            # Shared context (window, caches, state)
│   ├── types.ts              # IPC TypeScript interfaces
│   ├── window-handlers.ts    # Window control (3 handlers)
│   ├── auth-handlers.ts      # Auth, tokens, admin (18 handlers)
│   ├── database-handlers.ts  # Projects, executions, presets (22)
│   ├── supabase-handlers.ts  # Sport categories, caching (19)
│   ├── export-handlers.ts    # Export destinations (13)
│   ├── app-handlers.ts       # App info, settings (11)
│   ├── file-handlers.ts      # File dialogs, folders (8)
│   ├── image-handlers.ts     # Thumbnails, loading (5)
│   ├── csv-handlers.ts       # CSV parsing (4)
│   ├── analysis-handlers.ts  # Analysis logs, pipeline (4)
│   ├── face-recognition-handlers.ts  # Face detection (6)
│   └── version-handlers.ts   # Version checking (4)
├── unified-image-processor.ts  # Central processing system
├── streaming-pipeline.ts      # Memory-efficient pipeline for large batches
├── batch-optimizer.ts         # Intelligent batch processing
├── parallel-analyzer.ts       # Multi-threaded analysis engine
├── auth-service.ts            # Supabase auth + token management
├── database-service.ts        # SQLite + Supabase dual-mode
├── config.ts / config.production.ts  # Multi-environment config
├── matching/                  # Participant matching algorithms
├── utils/                     # Utilities
│   ├── memory-pool.ts        # Buffer pooling for performance
│   ├── disk-monitor.ts       # Disk space management
│   ├── cleanup-manager.ts    # Temp file lifecycle
│   ├── performance-monitor.ts # Real-time metrics
│   ├── session-manager.ts    # Session persistence
│   ├── raw-converter.ts      # dcraw-based RAW processing
│   ├── dcraw-installer.ts    # Auto dcraw installation
│   ├── xmp-manager.ts        # XMP sidecar creation
│   ├── metadata-writer.ts    # EXIF metadata writing
│   └── analysis-logger.ts    # JSONL logging system
└── assets/                    # App icons, resources

/renderer/                     # Frontend (HTML/CSS/JS)
├── index.html                # Main layout shell
├── pages/                    # Page content (dynamically loaded)
│   ├── home.html            # Dashboard
│   ├── settings.html        # Settings
│   ├── projects.html        # Project management
│   ├── analysis.html        # Image analysis
│   ├── participants.html    # Participant presets
│   └── destinations.html    # Export destinations
├── js/                       # JavaScript modules
│   ├── router.js            # Navigo.js hash router
│   ├── vendor/navigo.min.js # Navigo 8.11.1
│   └── [23 other modules]   # Feature-specific JS
└── css/                      # 15 CSS files

/tests/                       # Jest tests + performance benchmarks
/supabase/                    # Edge Functions (shared with web)
/scripts/                     # Build scripts, utilities
/vendor/                      # Native dependencies (dcraw, etc.)
/dist/                        # Compiled TypeScript output
/release/                     # Built installers (DMG, EXE, etc.)
```

## Key Commands

**Development:**
- `npm run dev` - TypeScript watch + Electron dev mode
- `npm run compile` - Compile TypeScript to /dist
- `npm start` - Start compiled app
- `npm run dev:debug` - Development with debug logging

**Testing:**
- `npm test` - Jest test suite
- `npm run test:watch` - Jest watch mode
- `npm run test:coverage` - Coverage report
- `npm run test:performance` - Standard performance tests
- `npm run test:performance:quick` - Quick regression tests
- `npm run test:performance:full` - Comprehensive benchmark
- `npm run benchmark` - Alias for full performance test
- `npm run regression-test` - Alias for quick performance test

**Build:**
- `npm run build` - Production build (current platform)
- `npm run build:mac:arm64` - macOS Apple Silicon
- `npm run build:mac:x64` - macOS Intel
- `npm run build:mac:universal` - macOS Universal Binary
- `npm run build:win:x64` - Windows 64-bit
- `npm install` - Install deps + rebuild native modules

**Native Modules:**
- `npm run rebuild` - Rebuild all native modules
- `npm run rebuild:sharp` - Rebuild Sharp.js for Electron
- `npm run postinstall` - Auto-runs electron-builder install-app-deps

## Architecture Overview

**Core Processing Systems:**

1. **Unified Image Processor** (`unified-image-processor.ts`)
   - Central processing for RAW and standard formats
   - Queue management, memory optimization, result aggregation
   - Coordinates different pipelines based on resources

2. **Streaming Pipeline** (`streaming-pipeline.ts`)
   - Memory-efficient processing for large batches (>50 images)
   - Staged: RAW conversion → JPEG → Analysis → Upload
   - Automatic mode switching based on memory/disk constraints
   - Disk space monitoring and cleanup

3. **Batch Optimizer** (`batch-optimizer.ts`)
   - Dynamic optimization and parallelization
   - Performance levels: DISABLED, CONSERVATIVE, BALANCED, AGGRESSIVE
   - Worker pool management (4-20 workers based on CPU)

4. **Parallel Analyzer** (`parallel-analyzer.ts`)
   - Multi-threaded AI analysis with worker pools
   - Rate limiting for API requests
   - CPU core and memory optimization

**IPC Handler Architecture:**
- 117 handlers across 12 modular files
- Centralized registration in `ipc/index.ts`
- Shared context via `ipc/context.ts`
- Type-safe interfaces in `ipc/types.ts`

**Frontend Router:**
- Navigo.js hash-based routing (#/home, #/analysis, etc.)
- Dynamic page loading from `/renderer/pages/`
- Page caching to avoid re-fetching
- Events: `page-loaded`, `section-changed`
- Backward compatible with legacy navigation

## Code Conventions

**TypeScript:**
- Use strict mode (no `any` unless justified)
- Define interfaces in `/src/ipc/types.ts` for IPC
- Prefer `interface` for object shapes, `type` for unions
- Use explicit return types for public functions

**File Organization:**
- IPC handlers: One handler per file in `/src/ipc/`
- Utilities: Feature-specific files in `/src/utils/`
- Keep files under 500 lines (split if larger)
- Use descriptive names: `raw-converter.ts`, not `utils.ts`

**Electron Patterns:**
- Main process: `src/main.ts` (avoid modifications when possible)
- IPC: Use modular handlers in `/src/ipc/`
- Preload: Expose APIs via `contextBridge` in `src/preload.ts`
- Renderer: Communicate via IPC, never import Node.js modules

**Error Handling:**
- EPIPE protection in main.ts (graceful degradation)
- Always log errors with context
- Return structured error objects to renderer
- Clean up resources in catch blocks (files, memory)

**Performance:**
- Use memory pools for buffer reuse (`utils/memory-pool.ts`)
- Monitor disk space before large operations
- Enable streaming pipeline for batches >50 images
- Profile with performance tests after major changes

## Data Flow

1. User selects folder via enhanced file browser
2. Optional CSV with participant data (numero, nome, categoria, squadra, metatag)
3. Images processed through unified processor or streaming pipeline
4. RAW files converted via dcraw (or raw-preview-extractor fallback)
5. AI analysis via parallel analyzer (Gemini API)
6. Race numbers matched against CSV (fuzzy matching)
7. Metadata written (XMP sidecars or direct EXIF)
8. Results stored in Supabase + SQLite cache
9. Enhanced results displayed in modern UI

## RAW Processing System

**Primary Method: dcraw**
- Supports: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG
- Auto-installation via `dcraw-installer.ts`
- Batch processing optimization
- Fallback to Sharp.js if dcraw unavailable

**Fallback: raw-preview-extractor**
- Custom module for embedded preview extraction
- Fast but lower resolution (200KB-2MB previews)
- Used when dcraw not available or fails

**Supported Formats:**
- RAW: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG
- Standard: JPG, JPEG, PNG, WebP

## RF-DETR Recognition System

**Dual Recognition:**
- Gemini AI Vision (default)
- RF-DETR object detection (Roboflow serverless workflows)

**Configuration:**
- Database-driven: `sport_categories.recognition_method`
- Edge Function V4: Routes to RF-DETR or Gemini
- Management dashboard in racetagger-app

**Setup:**
1. Get Roboflow API key: https://app.roboflow.com/
2. Add to `.env`: `ROBOFLOW_DEFAULT_API_KEY=your_key`
3. Configure sport category in dashboard:
   - Set `recognition_method` to "rf-detr"
   - Set `rf_detr_workflow_url` to endpoint
   - Set `edge_function_version` to 4

**Label Format:**
- Required: `"MODEL_NUMBER"` or `"TEAM_NUMBER"`
- Examples: `"SF-25_16"`, `"MCL39_4"`, `"Ducati_93"`
- Number extracted after underscore

**Cost Tracking:**
- RF-DETR: ~$0.0045/image
- Tracked in `execution_settings` table
- Separate from Gemini token usage

## Face Recognition (DISABLED - Coming Soon)

**Status:** UI shows styled "Coming Soon" state with blurred preview. All JS logic disabled. Models not loaded.

**What was done to disable it (3 layers):**

1. **HTML** (`renderer/pages/participants.html`)
   - Class `driver-face-section--disabled` on `#driver-face-section`
   - Header uses `.column-header.face-column` + `.column-badge.badge-face` (same pattern as the 3 columns above)
   - Added `.coming-soon-wrapper` with absolute overlay (lock icon SVG + message)
   - Added `.coming-soon-preview` with fake blurred driver panels underneath
   - Real `#driver-panels-container` and `#driver-panels-empty-state` hidden (`display: none`)
   - Removed the `driver-face-info` help box

2. **CSS** (`renderer/css/participants.css`)
   - `.column-header.face-column` - grey gradient header, matching other column headers
   - `.badge-face` - grey badge (matching `.badge-written`, `.badge-matching`, `.badge-folder` pattern)
   - `.coming-soon-overlay-abs` - absolute positioned, `backdrop-filter: blur(3px)`, blocks all clicks
   - `.coming-soon-preview` - fake panels at `opacity: 0.5` + `grayscale(60%)`
   - Preview panels mimic real driver panel structure (header + 5 photo slots)
   - Dark mode variants for all new styles

3. **JavaScript** (2 files with `FACE_RECOGNITION_ENABLED = false` flag)
   - `renderer/js/face-detector.js` - Skips face-api.js model loading (~50-100MB RAM saved)
   - `renderer/js/driver-face-manager.js` - `load()`, `syncDrivers()`, `render()` are all no-ops
   - Classes/functions still exported on `window` to prevent errors in other modules

**How to re-enable (checklist):**

1. `renderer/js/face-detector.js` - Set `FACE_RECOGNITION_ENABLED = true`
2. `renderer/js/driver-face-manager.js` - Set `FACE_RECOGNITION_ENABLED = true`
3. `renderer/pages/participants.html`:
   - Remove class `driver-face-section--disabled` from `#driver-face-section`
   - Replace `.column-header.face-column` block with original `.section-title` + `.section-description`
   - Change `.badge-face` / `COMING SOON` back to `.badge-beta` / `BETA`
   - Remove the entire `.coming-soon-wrapper` div (overlay + preview)
   - Restore `#driver-panels-empty-state` to `style="display: block;"`
   - Restore `#driver-panels-container` to `style="display: none;"`
   - Restore the `driver-face-info` help box (was removed)
4. CSS can be left in place (no effect without disabled class/wrapper)

**Related files (full feature, untouched):**
- `renderer/js/face-recognition-ui.js` - Match badges and recognition service
- `renderer/js/preset-face-manager.js` - Photo upload/management (up to 5 per driver)
- `src/ipc/face-recognition-handlers.ts` - IPC handlers (6 handlers)
- `src/preload.ts` - Exposed APIs (face-recognition-*, preset-face-*, preset-driver-*)

## Analysis Logging System

**Purpose:** Track corrections and decisions during analysis

**Components:**
- AnalysisLogger (`utils/analysis-logger.ts`) - JSONL logging
- SmartMatcher integration - OCR, temporal, fuzzy matching
- Temporal clustering - Burst mode detection

**Storage:**
- Local: `.analysis-logs/` in user data folder
- Remote: Supabase Storage bucket `analysis-logs`
- Naming: `exec_{execution_id}.jsonl`

**Log Entries (JSONL format):**
- `EXECUTION_START` - Total images, category, preset info
- `IMAGE_ANALYSIS` - AI response, corrections, final results
- `CORRECTION` - Individual correction with explanation
- `TEMPORAL_CLUSTER` - Clustering decisions
- `PARTICIPANT_MATCH` - Fuzzy matching results
- `EXECUTION_COMPLETE` - Final statistics

**Access:**
- Development: Auto-upload every 30s to Supabase
- Remote debugging: Supabase dashboard → Storage → analysis-logs
- Correlation: Use execution_id from desktop app

## Token System & Pricing

**Current Beta (One-time packages):**
- STARTER: €29 - 3,000 tokens
- PROFESSIONAL: €49 - 10,000 tokens ⭐ RECOMMENDED
- STUDIO: €99 - 25,000 tokens (best value)

**Future Subscriptions:**
- HOBBY: €39/mo - 2,000 images
- ENTHUSIAST: €79/mo - 5,000 images
- PROFESSIONAL: €129/mo - 10,000 images
- STUDIO: €199/mo - 25,000 images
- AGENCY: €399/mo - 50,000 images

**Token Management:**
- 1 token = 1 image analysis
- Tracked in `user_tokens` and `token_transactions`
- Request/approval workflow
- Automatic allocation and renewal

## Environment Variables

**Required in `.env`:**
```bash
SUPABASE_URL=https://taompbzifylmdzgbbrpv.supabase.co
SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional
ROBOFLOW_DEFAULT_API_KEY=your-roboflow-key
DEBUG_MODE=false
```

## Critical DO NOTs

**Security:**
- NEVER expose service role key in client code
- NEVER commit `.env` files
- NEVER bypass RLS policies
- NEVER hardcode API keys

**Database:**
- NEVER modify production schema without migration
- NEVER delete from production tables without backup
- NEVER use `SELECT *` (specify columns)
- NEVER disable RLS in production

**File Operations:**
- NEVER modify files in `/vendor/` directory
- NEVER delete `/dist/` manually (use `npm run compile`)
- NEVER modify `/release/` (generated by electron-builder)
- NEVER modify compiled files in `/dist/` (edit source in `/src/`)

**Performance:**
- NEVER load all images into memory at once
- NEVER skip cleanup of temporary files
- NEVER exceed 2GB memory usage per worker
- NEVER process >100 images without streaming pipeline

**Code Quality:**
- NEVER use `any` type without justification
- NEVER create monolithic files >1000 lines
- NEVER add dependencies without checking native module compatibility
- NEVER remove error handling from async operations

**Build:**
- NEVER modify `package.json` build config without testing
- NEVER skip native module rebuild after npm install
- NEVER commit build artifacts (DMG, EXE, etc.)
- NEVER modify electron-builder config without platform testing

## Performance Guidelines

**Memory Management:**
1. Use streaming pipeline for batches >50 images
2. Monitor memory usage with performance-monitor.ts
3. Enable buffer pooling (memory-pool.ts)
4. Trigger GC when usage >70%
5. Adjust worker count based on available RAM

**Disk Space:**
1. Monitor disk space before processing (disk-monitor.ts)
2. Clean temporary files when <5GB free
3. Set cleanup thresholds in config.ts
4. Auto-cleanup on process exit

**Parallelization:**
1. CONSERVATIVE: 8 workers, 1GB limit
2. BALANCED: 12 workers, 1.5GB limit (default)
3. AGGRESSIVE: 20 workers, 2GB limit
4. Adjust based on CPU cores (formula: cores * 1.5)

**Performance Testing:**
- Run `npm run regression-test` after changes
- Run `npm run benchmark` for comprehensive tests
- Profile memory leaks with coverage tools
- Monitor metrics in performance dashboard

## Build Configuration

**Cross-Platform Targets:**
- macOS: DMG, ZIP (arm64, x64, universal)
- Windows: NSIS installer, portable, ZIP (x64)
- Linux: AppImage, deb

**Native Modules:**
- better-sqlite3: Requires rebuild for Electron
- Sharp.js: Auto-rebuilds with postinstall
- canvas: Native dependencies for face-api.js

**Code Signing:**
- macOS: Notarized with Apple Developer ID
- Windows: No signing (future enhancement)
- Identity: FEDERICO PASINETTI (MNP388VJLQ)

**Asset Packaging:**
- ASAR: Main code in app.asar
- ASAR Unpack: Native modules, vendor tools
- Icons: racetagger-logo.icns (macOS), icon.ico (Windows)

## Common Tasks

**Adding a new IPC handler:**
1. Create in appropriate file in `/src/ipc/`
2. Add to exports in that file
3. Import in `/src/ipc/index.ts`
4. Register in `registerAllHandlers()`
5. Add TypeScript interface in `/src/ipc/types.ts`
6. Test with renderer code

**Adding a new page:**
1. Create HTML in `/renderer/pages/pagename.html`
2. Add route in `/renderer/js/router.js`
3. Add navigation link in `/renderer/index.html` sidebar
4. Add page initialization in `initializePage()`
5. Test navigation and event handlers

**Debugging RAW processing:**
1. Enable debug mode: `DEBUG_MODE=true npm run dev:debug`
2. Check dcraw installation: Test in /renderer/js/test-dcraw.js
3. Monitor logs in console
4. Use test-dashboard for real-time diagnostics

**Performance tuning:**
1. Run benchmark: `npm run benchmark`
2. Analyze bottlenecks in performance monitor
3. Adjust optimization level in config.ts
4. Test with real-world image sets
5. Re-run regression test: `npm run regression-test`

## Test Lab Features

**Location:** Web app (`/racetagger-app/src/app/management-portal/test-lab`)

**Features:**
- Auto-category detection (motorsport/running/altro)
- Motocross 3-digit mode
- Context-aware prompts (race/podium/portrait)
- Participant preset matching
- A/B testing (current vs experimental)
- Session management

**Database:**
- `test_sessions` - Test session config
- `test_results` - Comparison results
- `test_presets` - Participant presets
- `test_images` - Test uploads
- `test_metrics` - Performance metrics

**Edge Function:**
- `analyzeImageExperimental` - Isolated testing environment

## General Instructions

- **Do what has been asked; nothing more, nothing less**
- **ALWAYS prefer editing existing files to creating new ones**
- **NEVER proactively create documentation files (*.md) unless explicitly requested**
- **When modifying core systems (main.ts, processors), run performance tests**
- **Check DATABASE.md before modifying database-related code**
- **Test builds on target platform before suggesting deployment**
- **Preserve EPIPE protection and error handling in main.ts**
