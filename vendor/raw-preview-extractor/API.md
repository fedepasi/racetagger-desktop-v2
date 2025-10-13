# RAW Preview Extractor - API Documentation

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Types](#types)
- [Error Handling](#error-handling)
- [Performance Guidelines](#performance-guidelines)
- [Examples](#examples)

## Installation

```bash
npm install raw-preview-extractor
```

For Electron applications, rebuild the native module:

```bash
npx electron-rebuild
```

## Quick Start

```typescript
import { extractPreview, createDefaultOptions } from 'raw-preview-extractor';

// Basic usage
const result = await extractPreview('photo.cr2');
if (result.success) {
  console.log('Preview extracted:', result.preview?.width, 'x', result.preview?.height);
  // result.preview.data contains the JPEG buffer
}

// With custom options
const result2 = await extractPreview('photo.nef', {
  timeout: 10000,     // 10 seconds timeout
  maxMemory: 200,     // 200MB memory limit
  preferQuality: 'preview',
  targetSize: {
    min: 300 * 1024,  // 300KB minimum
    max: 2 * 1024 * 1024 // 2MB maximum
  }
});
```

## API Reference

### Main Functions

#### `extractPreview(filePath: string, options?: RawPreviewOptions): Promise<ExtractorResult>`

Extracts JPEG preview from a RAW image file.

- **filePath**: Path to the RAW image file
- **options**: Optional extraction options
- **Returns**: Promise resolving to extraction result

#### `extractPreviewFromBuffer(buffer: Buffer, options?: RawPreviewOptions): Promise<ExtractorResult>`

Extracts JPEG preview from a RAW image buffer.

- **buffer**: Buffer containing RAW image data  
- **options**: Optional extraction options
- **Returns**: Promise resolving to extraction result

#### `extractAllPreviews(filePath: string): Promise<AllPreviewsResult>`

Extracts all available JPEG previews from a RAW image file.

- **filePath**: Path to the RAW image file
- **Returns**: Promise resolving to all previews result

#### `detectFormat(input: string | Buffer): Promise<RawFormat>`

Detects RAW format from file or buffer.

- **input**: File path or buffer
- **Returns**: Promise resolving to detected RAW format

### Synchronous Functions

#### `extractPreviewSync(filePath: string, options?: RawPreviewOptions): ExtractorResult`

Synchronous version of `extractPreview`.

#### `extractPreviewFromBufferSync(buffer: Buffer, options?: RawPreviewOptions): ExtractorResult`

Synchronous version of `extractPreviewFromBuffer`.

#### `extractAllPreviewsSync(filePath: string): AllPreviewsResult`

Synchronous version of `extractAllPreviews`.

#### `detectFormatSync(input: string | Buffer): RawFormat`

Synchronous version of `detectFormat`.

### Utility Functions

#### `createDefaultOptions(overrides?: Partial<RawPreviewOptions>): RawPreviewOptions`

Creates default options with sensible defaults for 200KB-3MB range.

#### `getSupportedFormats(): RawFormat[]`

Returns array of all supported RAW formats.

#### `isSupportedFormat(format: string): boolean`

Checks if a format string is supported.

#### `getErrorMessage(errorCode: ErrorCode): string`

Gets human-readable error message from error code.

#### `isRetryableError(errorCode: ErrorCode): boolean`

Checks if an error code represents a retryable error.

## Types

### RawPreviewOptions

```typescript
interface RawPreviewOptions {
  targetSize?: {
    min: number;        // Minimum size in bytes (default: 200KB)
    max: number;        // Maximum size in bytes (default: 3MB)
  };
  preferQuality?: 'thumbnail' | 'preview' | 'full'; // Default: 'preview'
  cache?: boolean;      // Enable caching (default: true)
  timeout?: number;     // Timeout in milliseconds (default: 5000)
  maxMemory?: number;   // Memory limit in MB (default: 100)
  includeMetadata?: boolean;    // Extract EXIF metadata (default: false)
  strictValidation?: boolean;   // Strict JPEG validation (default: true)
}
```

### ExtractorResult

```typescript
interface ExtractorResult {
  success: boolean;
  preview?: RawPreview;
  error?: string;              // Legacy field
  errorInfo?: ErrorInfo;       // Structured error information
}
```

### RawPreview

```typescript
interface RawPreview {
  format: RawFormat;
  width: number;
  height: number;
  size: number;                // Size in bytes
  data: Buffer;               // JPEG data
  quality: 'thumbnail' | 'preview' | 'full';
  type?: string;              // Internal preview type (e.g., 'THMB', 'PRVW')
  priority?: number;          // Internal priority for sorting
  orientation?: number;       // EXIF orientation (1=normal, 3=180°, 6=90°CW, 8=90°CCW)
  metadata?: RawPreviewMetadata;
}
```

### ErrorCode

```typescript
enum ErrorCode {
  SUCCESS = 0,
  FILE_NOT_FOUND = 1,
  FILE_ACCESS_DENIED = 2,
  INVALID_FORMAT = 3,
  CORRUPTED_FILE = 4,
  TIMEOUT_EXCEEDED = 5,
  MEMORY_LIMIT_EXCEEDED = 6,
  NO_PREVIEWS_FOUND = 7,
  VALIDATION_FAILED = 8,
  UNKNOWN_ERROR = 9
}
```

### RawFormat

```typescript
enum RawFormat {
  CR2 = 'CR2',    // Canon Raw Version 2
  CR3 = 'CR3',    // Canon Raw Version 3
  NEF = 'NEF',    // Nikon Electronic Format
  ARW = 'ARW',    // Sony Alpha Raw
  DNG = 'DNG',    // Digital Negative
  RAF = 'RAF',    // Fujifilm Raw Format
  ORF = 'ORF',    // Olympus Raw Format
  PEF = 'PEF',    // Pentax Electronic Format
  RW2 = 'RW2',    // Panasonic Raw
  UNKNOWN = 'UNKNOWN'
}
```

## Error Handling

The library provides comprehensive error handling with structured error information:

```typescript
const result = await extractPreview('photo.cr2');
if (!result.success) {
  console.log('Legacy error:', result.error);
  
  if (result.errorInfo) {
    console.log('Error code:', result.errorInfo.code);
    console.log('Error message:', result.errorInfo.message);
    console.log('Context:', result.errorInfo.context);
    
    // Check if error is retryable
    if (isRetryableError(result.errorInfo.code)) {
      console.log('This error might be retryable');
    }
    
    // Get human-readable description
    console.log('Description:', getErrorMessage(result.errorInfo.code));
  }
}
```

### Error Types

- **FILE_NOT_FOUND**: File doesn't exist or can't be accessed
- **FILE_ACCESS_DENIED**: Permission denied when reading file
- **INVALID_FORMAT**: File is not a supported RAW format
- **CORRUPTED_FILE**: File appears corrupted or incomplete
- **TIMEOUT_EXCEEDED**: Operation exceeded the specified timeout
- **MEMORY_LIMIT_EXCEEDED**: Memory usage exceeded the specified limit
- **NO_PREVIEWS_FOUND**: No suitable preview images found
- **VALIDATION_FAILED**: Preview failed validation checks
- **UNKNOWN_ERROR**: Unexpected error occurred

## Performance Guidelines

### Memory Management

- Set appropriate `maxMemory` limits based on your system
- Default 100MB limit is suitable for most applications
- Large files (>100MB) may require higher limits

### Timeout Settings

- Default 5-second timeout is optimized for typical usage
- Increase timeout for very large files (>50MB)
- Decrease timeout for better responsiveness in UI applications

### Concurrency

- The library supports concurrent extractions
- Limit concurrent operations based on available memory
- Use worker threads for CPU-intensive operations

### File Size Optimization

- Target size range 200KB-3MB provides optimal balance
- Smaller sizes for thumbnails (50KB-200KB)
- Larger sizes for high-quality previews (1MB-5MB)

## Examples

### Basic Extraction

```typescript
import { extractPreview } from 'raw-preview-extractor';
import fs from 'fs';

async function extractAndSave(rawFile: string, outputFile: string) {
  const result = await extractPreview(rawFile);
  
  if (result.success && result.preview) {
    fs.writeFileSync(outputFile, result.preview.data);
    console.log(`Preview saved: ${result.preview.width}x${result.preview.height}`);
  } else {
    console.error('Extraction failed:', result.error);
  }
}
```

### Batch Processing

```typescript
import { extractPreview, createDefaultOptions } from 'raw-preview-extractor';

async function batchExtract(files: string[]) {
  const options = createDefaultOptions({
    timeout: 30000,  // 30 seconds for large files
    maxMemory: 200,  // 200MB limit
    preferQuality: 'preview'
  });

  const promises = files.map(async (file) => {
    try {
      const result = await extractPreview(file, options);
      return { file, result };
    } catch (error) {
      return { file, error };
    }
  });

  const results = await Promise.all(promises);
  
  results.forEach(({ file, result, error }) => {
    if (error) {
      console.error(`Failed ${file}:`, error);
    } else if (result?.success) {
      console.log(`Success ${file}: ${result.preview?.width}x${result.preview?.height}`);
    } else {
      console.error(`Failed ${file}:`, result?.error);
    }
  });
}
```

### Error Handling with Retries

```typescript
import { extractPreview, isRetryableError, ErrorCode } from 'raw-preview-extractor';

async function extractWithRetry(filePath: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await extractPreview(filePath, {
      timeout: attempt * 5000,  // Increase timeout with each retry
      maxMemory: 100 + (attempt * 50)  // Increase memory limit
    });

    if (result.success) {
      return result;
    }

    if (result.errorInfo && isRetryableError(result.errorInfo.code)) {
      console.log(`Attempt ${attempt} failed (retryable):`, result.errorInfo.message);
      continue;
    }

    // Non-retryable error, give up
    console.error('Non-retryable error:', result.errorInfo?.message || result.error);
    return result;
  }

  throw new Error('Max retries exceeded');
}
```

### Electron Integration

```typescript
import { extractPreview } from 'raw-preview-extractor';
import { app, ipcMain } from 'electron';

// Main process
ipcMain.handle('extract-preview', async (event, filePath) => {
  try {
    const result = await extractPreview(filePath, {
      timeout: 10000,
      maxMemory: 150,
      includeMetadata: true
    });

    if (result.success) {
      return {
        success: true,
        width: result.preview?.width,
        height: result.preview?.height,
        orientation: result.preview?.orientation,
        // Convert Buffer to base64 for IPC
        data: result.preview?.data.toString('base64')
      };
    } else {
      return {
        success: false,
        error: result.error,
        errorCode: result.errorInfo?.code
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Renderer process
const result = await window.electronAPI.invoke('extract-preview', filePath);
if (result.success) {
  const imageUrl = `data:image/jpeg;base64,${result.data}`;
  document.getElementById('preview').src = imageUrl;
}
```