# Changelog - RaceTagger Desktop

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
