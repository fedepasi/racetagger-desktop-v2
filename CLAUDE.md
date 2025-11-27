# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Development Workflow
- `npm run dev` - Start development server with TypeScript watch mode and Electron
- `npm run compile` - Compile TypeScript to JavaScript 
- `npm start` - Start the compiled Electron app
- `npm run build` - Build production app with electron-builder

### Testing & Quality Assurance
- `npm test` - Run Jest test suite
- `npm run test:watch` - Run Jest tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

### Performance Testing & Benchmarking
- `npm run test:performance` - Run standard performance test suite
- `npm run test:performance:quick` - Run quick performance tests (regression testing)
- `npm run test:performance:full` - Run comprehensive performance benchmark
- `npm run test:performance:verbose` - Run full performance tests with detailed logging
- `npm run benchmark` - Alias for full performance testing
- `npm run regression-test` - Alias for quick performance testing

### Build & Dependencies
- `npm install` - Install dependencies (includes electron-builder app deps)
- `npm run rebuild` - Rebuild native modules with electron-rebuild
- `npm run rebuild:sharp` - Rebuild Sharp.js specifically for Electron
- `npm run rebuild:debug` - Rebuild Sharp.js with debug logging
- `npm run postinstall` - Automatically runs electron-builder install-app-deps

## Architecture Overview

This is an advanced Electron desktop application for race photography analysis built with TypeScript. The app uses AI-powered analysis to detect race numbers in racing images and matches them with participant data. The architecture has evolved significantly with performance optimizations, streaming processing, and advanced memory management.

### Core Processing Systems

**Unified Image Processor (src/unified-image-processor.ts)**
- Central image processing system that handles both RAW and standard image formats
- Manages processing queues, memory optimization, and result aggregation
- Coordinates between different processing pipelines based on system resources

**Streaming Pipeline (src/streaming-pipeline.ts)**
- Advanced memory-efficient processing pipeline for large image batches
- Manages temporary file creation, disk space monitoring, and cleanup
- Implements staged processing: RAW conversion → JPEG generation → Analysis → Upload
- Automatic switching between batch and streaming modes based on memory/disk constraints

**Batch Optimizer (src/batch-optimizer.ts)**
- Intelligent batch processing with dynamic optimization
- Manages parallelization levels, memory usage, and processing queues
- Supports legacy batch processing and modern streaming pipeline
- Advanced configuration for different performance levels

**Parallel Analyzer (src/parallel-analyzer.ts)**
- Multi-threaded image analysis engine with worker pool management
- Handles concurrent AI model requests with rate limiting
- Optimizes resource usage across CPU cores and memory constraints

### Main Process (src/main.ts)
- Enhanced Electron main process with extensive IPC handlers
- EPIPE error protection and graceful degradation
- Manages RAW file conversion using dcraw
- Supports both online (Supabase) and offline (SQLite cache) data management
- Coordinates between unified processors and streaming pipelines

### Authentication & Token Management (src/auth-service.ts)
- Supabase authentication with automatic session persistence
- Advanced token-based usage system with request/approval workflow
- Subscription management and demo mode with limited free analyses
- Automatic token refresh and offline session handling

### Database Layer (src/database-service.ts)
- Dual-mode architecture: Supabase for online storage + SQLite for local caching
- Enhanced Projects and Executions management with execution settings tracking
- CSV file uploads to Supabase Storage with metadata preservation
- Local database schema mirrors Supabase for seamless offline capability
- Migration system for database schema evolution

### Performance Optimization System

**Memory Management (src/utils/memory-pool.ts)**
- Advanced buffer pooling system for efficient memory reuse
- Categorized memory pools based on image size requirements
- Automatic garbage collection and memory pressure monitoring

**Disk Space Management (src/utils/disk-monitor.ts)**
- Real-time disk space monitoring with configurable thresholds
- Automatic cleanup of temporary files when space is low
- Alert system for critical disk space situations

**Cleanup Manager (src/utils/cleanup-manager.ts)**
- Comprehensive temporary file lifecycle management
- Automatic cleanup on process exit and error conditions
- Tracked file system for reliable resource deallocation

**Performance Monitor (src/utils/performance-monitor.ts)**
- Real-time performance metrics collection and analysis
- Memory usage, processing times, and throughput monitoring
- Automatic performance tuning recommendations

**Session Manager (src/utils/session-manager.ts)**
- Persistent session state management across app restarts
- Recovery of interrupted processing sessions
- User preference and workflow state preservation

### RAW Processing System (src/utils/raw-converter.ts)
- **dcraw-based conversion** instead of Adobe DNG Converter
- Supports NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG formats
- Automatic dcraw installation and dependency management (src/utils/dcraw-installer.ts)
- Fallback to Sharp.js for basic format support when dcraw unavailable
- Batch processing optimization for large RAW collections

### Metadata Management

**XMP Sidecar System (src/utils/xmp-manager.ts)**
- Advanced XMP sidecar file creation and management
- Preserves original file integrity while adding metadata
- Supports complex metadata schemas and custom fields

**Metadata Writer (src/utils/metadata-writer.ts)**
- Direct EXIF metadata writing to image files
- Supports both embedded metadata and sidecar files
- Race participant information integration

### Configuration System (src/config.ts & src/config.production.ts)
- **Multi-environment configuration** with development/production separation
- **Resize Presets**: VELOCE (1080p), BILANCIATO (1440p), QUALITA (1920p)
- **Performance Optimization Levels**: DISABLED, CONSERVATIVE, BALANCED, AGGRESSIVE
- **Streaming Pipeline Configuration** with worker management and disk thresholds
- **Roboflow RF-DETR Configuration**: API keys, overlap thresholds, confidence levels, cost tracking
- Comprehensive validation and error handling

### RF-DETR Recognition System (Edge Function V4)
- **Dual Recognition Support**: Gemini AI Vision + RF-DETR object detection
- **Database-driven configuration**: Recognition method configured per sport category in `sport_categories` table
- **Edge Function V4** (`supabase/functions/analyzeImageDesktopV4/`):
  - Routes to RF-DETR or Gemini based on `sport_categories.recognition_method`
  - RF-DETR integration with Roboflow serverless workflows
  - Label format: `"MODEL_NUMBER"` (e.g., `"SF-25_16"` → race number 16)
  - IoU-based overlap filtering for multiple detections
  - Automatic fallback to Gemini V3 on RF-DETR failure
- **Metrics Tracking**: Detections count, cost tracking ($0.0045/image), recognition method logging
- **Bounding Boxes**: Full detection data saved to `analysis_results.raw_response` for training
- **SmartMatcher Integration**: Post-processing with same participant matching logic
- **Management Dashboard**: UI in racetagger-app for configuring RF-DETR per category

**Setup:**
1. Get Roboflow API key from https://app.roboflow.com/
2. Add to `.env`: `ROBOFLOW_DEFAULT_API_KEY=your_key_here`
3. Configure sport category in management dashboard:
   - Set `recognition_method` to "rf-detr"
   - Set `rf_detr_workflow_url` to Roboflow workflow endpoint
   - Set `edge_function_version` to 4
   - Optional: Set custom API key environment variable name

**Label Format Requirements:**
- RF-DETR models must return labels in format: `"MODEL_NUMBER"` or `"TEAM_NUMBER"`
- Examples: `"SF-25_16"`, `"MCL39_4"`, `"Ducati_93"`
- Race number is extracted from the portion after the underscore

**Cost Tracking:**
- RF-DETR usage: ~$0.0045 per image
- Tracked separately from Gemini token usage
- Metrics stored in `execution_settings`: `rf_detr_detections_count`, `rf_detr_total_cost`

### File Extensions Support
- **Standard formats**: JPG, JPEG, PNG, WebP
- **RAW formats**: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG

### Enhanced Frontend Components

**Delight System (renderer/js/delight-system.js)**
- Advanced UX enhancement system with configurable delight levels
- Race-themed loading messages and micro-interactions
- Accessibility support with reduced motion preferences
- Confetti celebrations and sound effects

**Enhanced Processing UI (renderer/js/enhanced-processing.js)**
- Advanced progress tracking with detailed statistics
- Token request modal and management interface
- Real-time processing metrics and error reporting

**Folder Organization (renderer/js/admin-features.js)**
- Intelligent folder organization system for race photos
- Automated sorting based on race numbers and metadata
- Batch organization operations with progress tracking

**Modern Results Display (renderer/js/modern-results.js)**
- Enhanced results visualization with sorting and filtering
- Export capabilities for race results and statistics
- Integration with CSV participant data

**Enhanced File Browser (renderer/js/enhanced-file-browser.js)**
- Advanced file selection with preview capabilities
- RAW format detection and thumbnail generation
- Batch selection and filtering tools

**Test Dashboards**
- dcraw Testing Interface (renderer/js/test-dcraw.js)
- Performance Monitoring Dashboard (renderer/js/test-dashboard.js)
- Real-time system diagnostics and testing tools

### Testing Infrastructure

**Performance Testing Suite (tests/performance/)**
- Comprehensive benchmark testing for all major components
- Memory leak detection and performance regression testing
- Automated performance reporting with historical comparisons
- Quick regression tests for CI/CD integration

**Unit Testing**
- Jest-based testing framework with TypeScript support
- Mock implementations for Electron APIs and file systems
- Coverage reporting and watch mode for development

### Token System & Telemetry

**Token Management**
- Credit-based usage system with Supabase backend
- Token request and approval workflow
- Usage analytics and consumption tracking
- Automatic token allocation and renewal

**Telemetry System**
- Performance metrics collection and analysis
- User workflow tracking for UX improvements
- Error reporting and crash analytics
- Privacy-compliant data collection

### Data Flow
1. User selects folder of racing images through enhanced file browser
2. Optional CSV file with participant data (numero, nome, categoria, squadra, metatag)
3. Images processed through unified processor or streaming pipeline
4. RAW files converted using dcraw with automatic format detection
5. AI analysis performed using parallel analyzer with rate limiting
6. Race numbers matched against CSV data with fuzzy matching
7. Metadata written using XMP sidecars or direct EXIF embedding
8. Results stored in both Supabase (online) and SQLite (local cache)
9. Enhanced results displayed with modern UI components

### Build Configuration
- TypeScript compilation from `src/` to `dist/`
- Electron-builder configuration for cross-platform builds (macOS, Windows, Linux)
- Native module rebuilding required for better-sqlite3, Sharp.js, and dcraw
- Asset packaging with proper native module handling

## Important Development Notes

- **Native modules** (better-sqlite3, Sharp.js) require rebuilding after npm install
- **dcraw dependency** automatically installed and managed during setup
- **Database schema** initialization happens after app.ready() event
- **Session restoration** handles both online/offline scenarios gracefully
- **Memory management** is critical due to large image processing workloads
- **Performance testing** should be run regularly, especially after architectural changes
- **RAW processing** uses dcraw as primary converter with Sharp.js fallback
- **Streaming pipeline** automatically activates for large batch processing to prevent memory issues

### Performance Optimization Guidelines

1. **Use streaming pipeline** for batches > 50 images or when memory usage > 70%
2. **Monitor disk space** during processing and enable cleanup when < 5GB free
3. **Optimize parallelization** based on CPU cores and memory availability
4. **Cache converted RAW files** when processing similar batches
5. **Profile memory usage** regularly and adjust buffer pool sizes as needed

### Debugging and Development

- Use performance dashboard for real-time monitoring
- Enable debug logging for specific components via environment variables
- Use test-dcraw interface to verify RAW processing functionality
- Monitor token usage and API rate limiting in enhanced processing UI
- Check session manager for workflow recovery after crashes

#### Analysis Logging System

The desktop app features a comprehensive analysis logging system that tracks all corrections and decision-making processes during image analysis:

**System Components:**
- **AnalysisLogger (src/utils/analysis-logger.ts)**: JSONL-based logging with automatic Supabase upload
- **SmartMatcher Integration**: Tracks OCR, temporal, fuzzy, and participant matching corrections
- **Temporal Clustering**: Logs clustering decisions and burst mode detection

**Log Storage:**
- **Local Files**: `.analysis-logs/` directory in user data folder
- **Remote Access**: Automatic upload to Supabase Storage bucket `analysis-logs`
- **Naming Convention**: `exec_{execution_id}.jsonl` for easy correlation with desktop executions

**Log Contents (JSONL format):**
- `EXECUTION_START`: Total images, category, participant preset info
- `IMAGE_ANALYSIS`: AI response, corrections applied, final results
- `CORRECTION`: Individual correction with human-readable explanations
- `TEMPORAL_CLUSTER`: Clustering decisions and burst mode detection
- `PARTICIPANT_MATCH`: Fuzzy matching results and evidence
- `EXECUTION_COMPLETE`: Final statistics and performance metrics

**Accessing Logs:**
1. **During Development**: Logs upload every 30 seconds to Supabase Storage
2. **Remote Debugging**: Access via Supabase dashboard → Storage → analysis-logs
3. **Log Correlation**: Use execution_id from desktop app to find corresponding log file
4. **Human-Readable Messages**: Each correction includes explanation like "Corretto numero da 61 a 51 perché foto precedente (250ms fa) e successiva (180ms dopo) mostrano entrambe 51"

**Setup Requirements:**
- Supabase Storage bucket: `analysis-logs` (public read access)
- Database table: `analysis_log_metadata` for searchable log discovery
- Row Level Security: Users can only access their own logs

# Pricing Information & Business Model

## Current Beta Pricing (One-time Token Packages)

**STARTER PACK**: €29
- 3,000 tokens
- Perfect for testing the app
- Never expire

**PROFESSIONAL PACK**: €49 ⭐ RECOMMENDED
- 10,000 tokens
- Covers 1-2 full racing events
- Never expire

**STUDIO PACK**: €99
- 25,000 tokens
- Ideal for major events
- Best value per token
- Never expire

## Future Subscription Pricing

**FREE/TRIAL**: 100 foto - Test software

**HOBBY**: €39/mese - 2,000 foto/mese
- 1 evento piccolo
- Fotografo occasionale
- Weekend hobbyist

**ENTHUSIAST**: €79/mese - 5,000 foto/mese ← NUOVO SWEET SPOT
- 2 eventi completi o 3-4 eventi singola giornata
- Fotografo semi-pro

**PROFESSIONAL**: €129/mese - 10,000 foto/mese ← NUOVO SWEET SPOT
- Eventi multipli, fotografo professionale

**STUDIO**: €199/mese - 25,000 foto/mese
- 3-4 eventi completi o team con 2 fotografi
- Agenzia piccola

**AGENCY**: €399/mese - 50,000 foto/mese
- Team 3-5 fotografi
- Copertura serie completa

## Test Lab Features

**Test Lab Location**: `/racetagger-app/src/app/management-portal/test-lab`

The Test Lab is an experimental environment for testing new recognition features safely:

### Key Features:
- **Auto-category detection**: Automatic sport recognition (motorsport/running/altro)
- **Motocross 3-digit mode**: Specialized handling for motocross number recognition
- **Context-aware prompts**: Different prompts for race vs podium vs portrait contexts
- **Participant preset matching**: Advanced fuzzy matching with sponsor recognition
- **A/B testing**: Compare current vs experimental models
- **Session management**: Named test sessions with configuration tracking

### Database Tables:
- `test_sessions`: Test session management
- `test_results`: Comparison results between current and experimental
- `test_presets`: Participant data presets
- `test_images`: Test image uploads
- `test_metrics`: Performance and accuracy metrics

### Edge Function:
- `analyzeImageExperimental`: Separate edge function for testing new features without affecting production

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.