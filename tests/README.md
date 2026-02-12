# RaceTagger Desktop - Automated Testing Suite

Comprehensive automated tests for metadata writing, RAW processing, ONNX runtime, Sharp integration, and end-to-end workflows.

## Quick Start

```bash
# Install dependencies
npm install

# Rebuild native modules (required for Sharp, ONNX Runtime)
npm run rebuild

# Run all tests
npm test

# Run specific test suites
npm run test:metadata    # Metadata writing tests (JPEG + RAW)
npm run test:raw         # RAW processing tests (dcraw + native extractor)
npm run test:onnx        # ONNX runtime and ML pipeline tests
npm run test:sharp       # Sharp image processing tests
npm run test:e2e         # End-to-end integration tests

# Performance benchmarks
npm run benchmark        # Full benchmark suite
npm run regression-test  # Quick regression tests
```

## Test Organization

```
tests/
├── helpers/               # Test utilities
│   ├── exiftool-validator.ts  # ExifTool validation
│   ├── temp-directory.ts      # Temp dir management
│   └── file-hasher.ts         # File integrity checks
│
├── fixtures/              # Test data
│   ├── images/            # Sample images (JPEG, RAW)
│   ├── csv/               # Sample participant CSV
│   ├── metadata/          # Expected metadata outputs
│   └── onnx-models/       # Test ONNX models
│
├── scripts/               # Test scripts
│   └── download-test-files.ts # On-demand large file downloader
│
├── metadata/              # Metadata writing tests
│   ├── jpeg-metadata.test.ts  # JPEG EXIF tests
│   └── raw-metadata.test.ts   # RAW XMP sidecar tests
│
├── raw/                   # RAW processing tests
│   ├── dcraw-converter.test.ts      # dcraw conversion tests
│   └── native-extractor.test.ts     # Native preview extractor
│
├── onnx/                  # ONNX runtime tests
│   ├── runtime.test.ts           # ONNX Runtime module
│   ├── scene-classifier.test.ts  # Scene classification
│   ├── detector.test.ts          # Object detection (YOLOv8)
│   ├── segmenter.test.ts         # Segmentation (YOLOv8-seg)
│   ├── model-manager.test.ts     # Model download/cache
│   └── integration.test.ts       # Full ONNX pipeline
│
├── sharp/                 # Sharp integration tests
│   ├── resize.test.ts    # Resize presets (VELOCE, BILANCIATO, QUALITA)
│   ├── crop.test.ts      # Crop extraction from bounding boxes
│   └── fallback.test.ts  # Sharp → Jimp fallback
│
└── e2e/                   # End-to-end tests
    └── full-pipeline.test.ts  # Complete RAW → JPEG → metadata flow
```

## Prerequisites

### Required System Tools

**macOS:**
```bash
brew install exiftool dcraw
```

**Ubuntu/Debian:**
```bash
sudo apt-get install libimage-exiftool-perl dcraw
```

**Windows:**
- Download ExifTool from https://exiftool.org/
- Download dcraw from https://www.cybercom.net/~dcoffin/dcraw/

### Required Node Modules

All native modules are automatically rebuilt after `npm install`:
- `sharp` - Image processing (requires electron-rebuild)
- `onnxruntime-node` - ONNX ML inference
- `better-sqlite3` - Local database
- `canvas` - Canvas rendering (for face-api.js)

## Test Fixtures

### Committed Files (Small, in git)

- `sample.jpg` (200KB) - Basic JPEG with EXIF
- `sample-small.nef` (5MB) - Minimal Nikon RAW
- `sample.cr2` (4MB) - Canon RAW
- `motorsport-track.jpg` - Track scene for classifier
- `paddock.jpg` - Paddock scene
- `podium.jpg` - Podium scene
- `portrait.jpg` - Portrait scene
- `race-numbers.jpg` - Race numbers for detection
- `multi-subjects.jpg` - Multiple subjects for segmentation

### On-Demand Downloads (Large files)

```bash
npm run download-test-files
```

Downloads high-resolution test images from external sources. See `tests/scripts/download-test-files.ts` for sources.

## Test Categories

### 1. Metadata Writing Tests

**JPEG Metadata (`tests/metadata/jpeg-metadata.test.ts`):**
- Direct EXIF writing via ExifTool
- Special character handling (accents, umlauts)
- Preserving existing EXIF data
- Batch metadata writes (100+ files)

**RAW Metadata (`tests/metadata/raw-metadata.test.ts`):**
- XMP sidecar creation for NEF/CR2/ARW/ORF/DNG
- Triple-layer RAW protection verification
- XMP Dublin Core fields (dc:subject, dc:creator)
- Updating existing XMP without data loss
- Lightroom/CaptureOne XMP compatibility

### 2. RAW Processing Tests

**dcraw Conversion (`tests/raw/dcraw-converter.test.ts`):**
- NEF → JPEG conversion
- Resize presets (VELOCE, BILANCIATO, QUALITA)
- Batch conversion (50+ files)
- Corrupted RAW handling
- Auto-installation of dcraw

**Native Extractor (`tests/raw/native-extractor.test.ts`):**
- Embedded JPEG preview extraction
- Fallback when dcraw unavailable
- ASAR unpacking verification (packaged app)
- Performance vs dcraw comparison

### 3. ONNX Runtime Tests

**Runtime (`tests/onnx/runtime.test.ts`):**
- onnxruntime-node module loading
- ASAR unpacking for native binaries
- InferenceSession creation
- GPU execution provider detection
- Tensor operations
- Memory management

**Scene Classifier (`tests/onnx/scene-classifier.test.ts`):**
- Track/paddock/podium/portrait classification
- Preprocessing pipeline (resize, normalize)
- Confidence score handling
- Performance (<1s per image)

**Object Detector (`tests/onnx/detector.test.ts`):**
- Race number detection (YOLOv8)
- NMS (Non-Maximum Suppression)
- Confidence threshold filtering
- Various image sizes
- Performance (<2s per image)

**Segmenter (`tests/onnx/segmenter.test.ts`):**
- Subject segmentation (YOLOv8-seg)
- Crop extraction from masks
- RLE (Run-Length Encoding) masks
- Letterbox preprocessing (640x640)
- Batch segmentation

**Model Manager (`tests/onnx/model-manager.test.ts`):**
- Model download from `model_registry` table
- Cached model usage
- SHA256 checksum validation
- Model versioning
- Old version cleanup
- Concurrent download handling

**Integration (`tests/onnx/integration.test.ts`):**
- Full pipeline: scene → segment → detect
- Smart routing (local-onnx vs gemini vs rf-detr)
- Fallback to Edge Functions on ONNX failure
- Performance comparison (ONNX vs Edge Function)
- Crop+Context multi-image analysis (V6)

### 4. Sharp Integration Tests

**Resize (`tests/sharp/resize.test.ts`):**
- VELOCE preset (1080px, 75% quality)
- BILANCIATO preset (1440px, 85% quality)
- QUALITA preset (1920px, 90% quality)
- Aspect ratio preservation
- Portrait vs landscape handling
- Quality vs file size correlation

**Crop (`tests/sharp/crop.test.ts`):**
- Bounding box crop with padding
- Edge crops (boundary handling)
- RGB color space preservation
- Crop + resize in single operation
- Multiple crops from same image

**Fallback (`tests/sharp/fallback.test.ts`):**
- Sharp → Jimp fallback mechanism
- Native module loading verification
- electron-rebuild verification
- ASAR unpacking for Sharp binaries

### 5. End-to-End Tests

**Full Pipeline (`tests/e2e/full-pipeline.test.ts`):**
- RAW → JPEG → metadata → organized folder
- Mixed folder (JPEG + NEF + CR2)
- CSV participant matching with SmartMatcher
- Error handling (corrupted files)
- Performance (10 images in <5s)
- Data integrity throughout pipeline

## Continuous Integration (GitHub Actions)

### Workflow: `test-and-build.yml`

**Matrix Testing:**
- macOS (x64, arm64)
- Windows (x64)
- Ubuntu (x64)
- Node.js 18.x

**Jobs:**

1. **Test Job:**
   - Install system dependencies (ExifTool, dcraw)
   - Rebuild native modules
   - Run all test suites
   - Upload test results on failure

2. **Build Job:**
   - Build Electron app for all platforms
   - Verify build artifacts (DMG, EXE, AppImage)
   - Upload build artifacts (7-day retention)

3. **Verify Job (macOS):**
   - Mount DMG and verify app structure
   - Check ASAR unpacking for native modules
   - Verify code signing

4. **Performance Job:**
   - Run performance benchmarks
   - Upload benchmark results (30-day retention)

## Writing New Tests

### Basic Template

```typescript
import { TempDirectory } from '../helpers/temp-directory';
import { ExifToolValidator } from '../helpers/exiftool-validator';
import * as path from 'path';

describe('Your Feature', () => {
  let tempDir: TempDirectory;
  let validator: ExifToolValidator;

  beforeEach(async () => {
    tempDir = new TempDirectory();
    validator = new ExifToolValidator();
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  test('your test case', async () => {
    // Arrange
    const testFile = await tempDir.copyFile('sample.jpg');

    // Act
    // ... your code here

    // Assert
    expect(result).toBeDefined();
  });
});
```

### Using Test Helpers

**TempDirectory:**
```typescript
const tempDir = new TempDirectory();
await tempDir.create();
const testFile = await tempDir.copyFile('/path/to/sample.jpg');
await tempDir.cleanup(); // Auto-cleanup
```

**ExifToolValidator:**
```typescript
const validator = new ExifToolValidator();
const metadata = await validator.readMetadata(filePath);
const isValid = await validator.verifyXMPSidecar(rawPath, expectedData);
```

**FileHasher:**
```typescript
const hasher = new FileHasher();
const hash = await hasher.computeSHA256(filePath);
const match = await hasher.compareFiles(file1, file2);
```

## Performance Benchmarks

### Quick Regression Test

```bash
npm run regression-test
```

Tests critical operations:
- RAW conversion speed
- Image resize performance
- Metadata write speed
- ONNX inference latency

### Full Benchmark Suite

```bash
npm run benchmark
```

Comprehensive performance analysis:
- 50+ image batch processing
- Memory usage tracking
- Concurrent operation testing
- Comparison vs baseline results

## Troubleshooting

### ExifTool Not Found

```bash
# macOS
brew install exiftool

# Ubuntu
sudo apt-get install libimage-exiftool-perl
```

### Sharp Build Errors

```bash
# Rebuild Sharp for Electron
npm run rebuild:sharp

# Debug rebuild
npm run rebuild:debug
```

### ONNX Runtime Issues

```bash
# Check ONNX Runtime installation
node -e "console.log(require('onnxruntime-node'))"

# Rebuild all native modules
npm run rebuild
```

### Test Fixtures Missing

```bash
# Download large test files
npm run download-test-files

# Or manually add your own RAW files to tests/fixtures/images/
```

### Skip Tests Without Dependencies

Tests automatically skip if required dependencies are unavailable:

```typescript
const exifToolAvailable = await validator.isExifToolAvailable();
if (!exifToolAvailable) {
  console.log('⏭️  Skipping: ExifTool not available');
  return;
}
```

## Test Coverage Goals

Current coverage targets:
- Metadata writer: 90%+
- RAW converter: 85%+
- ONNX pipeline: 80%+
- Sharp integration: 85%+
- End-to-end: 75%+

Run coverage report:
```bash
npm run test:coverage
```

## Contributing

When adding new features:

1. Write tests first (TDD approach)
2. Ensure tests pass locally
3. Add fixtures to `tests/fixtures/` if needed
4. Update this README if adding new test categories
5. CI will automatically run all tests on PR

## Resources

- **ExifTool Documentation:** https://exiftool.org/
- **dcraw Manual:** https://www.cybercom.net/~dcoffin/dcraw/dcraw.1.html
- **Sharp API:** https://sharp.pixelplumbing.com/
- **ONNX Runtime:** https://onnxruntime.ai/
- **Jest Documentation:** https://jestjs.io/

## Support

For issues or questions about tests:
- Check GitHub Actions logs for CI failures
- Review test output for specific failure details
- Ensure all system dependencies installed
- Verify native modules rebuilt correctly

---

**Last Updated:** 2026-02-11
**Test Suite Version:** 1.0.0
**Coverage:** ~75% (target: 85%)
