import { RawPreviewOptions, RawPreview, ExtractorResult, AllPreviewsResult, RawFormat, ErrorCode, ErrorInfo, QuickExtractOptions } from './types';
import * as path from 'path';

// Import the native module
let nativeModule: any;

try {
  // Try different possible locations for the native module
  const possiblePaths = [
    path.join(__dirname, '../../build/Release/raw_extractor.node'),
    path.join(__dirname, '../build/Release/raw_extractor.node'),
    path.join(process.cwd(), 'build/Release/raw_extractor.node'),
    '../../build/Release/raw_extractor.node',
    '../../build/Debug/raw_extractor.node',
    path.join(__dirname, '../prebuilds/darwin-x64+arm64/raw-preview-extractor.node'),
    path.join(process.cwd(), 'prebuilds/darwin-x64+arm64/raw-preview-extractor.node')
  ];
  
  let moduleLoaded = false;
  for (const modulePath of possiblePaths) {
    try {
      nativeModule = require(modulePath);
      moduleLoaded = true;
      break;
    } catch (pathErr) {
      // Continue to next path
    }
  }
  
  if (!moduleLoaded) {
    throw new Error('Could not find native module in any expected location');
  }
} catch (err) {
  throw new Error(`Failed to load native RAW extractor module. Make sure to run 'npm run build' first.\nError: ${err}`);
}

/**
 * Extract JPEG preview from a RAW image file
 * @param filePath Path to the RAW image file
 * @param options Extraction options
 * @returns Promise resolving to extraction result
 */
export async function extractPreview(
  filePath: string,
  options?: RawPreviewOptions
): Promise<ExtractorResult> {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeModule.extractPreview(filePath, options);
      resolve(processNativeResult(result));
    } catch (error) {
      reject(new Error(`Failed to extract preview: ${error}`));
    }
  });
}

/**
 * Extract JPEG preview from a RAW image buffer
 * @param buffer Buffer containing RAW image data
 * @param options Extraction options
 * @returns Promise resolving to extraction result
 */
export async function extractPreviewFromBuffer(
  buffer: Buffer,
  options?: RawPreviewOptions
): Promise<ExtractorResult> {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeModule.extractPreviewFromBuffer(buffer, options);
      resolve(processNativeResult(result));
    } catch (error) {
      reject(new Error(`Failed to extract preview from buffer: ${error}`));
    }
  });
}

/**
 * Detect RAW format from file or buffer
 * @param input File path or buffer
 * @returns Detected RAW format
 */
export async function detectFormat(input: string | Buffer): Promise<RawFormat> {
  return new Promise((resolve, reject) => {
    try {
      const format = nativeModule.detectFormat(input);
      resolve(format as RawFormat);
    } catch (error) {
      reject(new Error(`Failed to detect format: ${error}`));
    }
  });
}

/**
 * Extract medium quality preview from a RAW image file
 * Targets preview with 'preview' quality (typically 1-2MP, ~500KB-2MB)
 * @param filePath Path to the RAW image file
 * @param options Optional extraction options (timeout, strictValidation)
 * @returns Promise resolving to extraction result
 */
export async function extractMediumPreview(
  filePath: string,
  options?: QuickExtractOptions
): Promise<ExtractorResult> {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeModule.extractMediumPreview(filePath, options);
      resolve(processNativeResult(result));
    } catch (error) {
      reject(new Error(`Failed to extract medium preview: ${error}`));
    }
  });
}

/**
 * Extract full/high quality preview from a RAW image file  
 * Targets preview with 'full' quality (typically 2-6MP, ~2MB-8MB)
 * @param filePath Path to the RAW image file
 * @param options Optional extraction options (timeout, strictValidation)
 * @returns Promise resolving to extraction result
 */
export async function extractFullPreview(
  filePath: string,
  options?: QuickExtractOptions
): Promise<ExtractorResult> {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeModule.extractFullPreview(filePath, options);
      resolve(processNativeResult(result));
    } catch (error) {
      reject(new Error(`Failed to extract full preview: ${error}`));
    }
  });
}

/**
 * Synchronous version of extractPreview
 * @param filePath Path to the RAW image file
 * @param options Extraction options
 * @returns Extraction result
 */
export function extractPreviewSync(
  filePath: string,
  options?: RawPreviewOptions
): ExtractorResult {
  const result = nativeModule.extractPreview(filePath, options);
  return processNativeResult(result);
}

/**
 * Synchronous version of extractPreviewFromBuffer
 * @param buffer Buffer containing RAW image data
 * @param options Extraction options
 * @returns Extraction result
 */
export function extractPreviewFromBufferSync(
  buffer: Buffer,
  options?: RawPreviewOptions
): ExtractorResult {
  const result = nativeModule.extractPreviewFromBuffer(buffer, options);
  return processNativeResult(result);
}

/**
 * Synchronous version of extractMediumPreview
 * @param filePath Path to the RAW image file
 * @param options Optional extraction options
 * @returns Extraction result
 */
export function extractMediumPreviewSync(
  filePath: string,
  options?: QuickExtractOptions
): ExtractorResult {
  const result = nativeModule.extractMediumPreview(filePath, options);
  return processNativeResult(result);
}

/**
 * Synchronous version of extractFullPreview
 * @param filePath Path to the RAW image file
 * @param options Optional extraction options
 * @returns Extraction result
 */
export function extractFullPreviewSync(
  filePath: string,
  options?: QuickExtractOptions
): ExtractorResult {
  const result = nativeModule.extractFullPreview(filePath, options);
  return processNativeResult(result);
}

/**
 * Synchronous version of detectFormat
 * @param input File path or buffer
 * @returns Detected RAW format
 */
export function detectFormatSync(input: string | Buffer): RawFormat {
  return nativeModule.detectFormat(input) as RawFormat;
}

/**
 * Extract all available JPEG previews from a RAW image file
 * @param filePath Path to the RAW image file
 * @returns Promise resolving to all previews result
 */
export async function extractAllPreviews(filePath: string): Promise<AllPreviewsResult> {
  return new Promise((resolve, reject) => {
    try {
      const result = nativeModule.extractAllPreviews(filePath);
      resolve(processNativeAllPreviewsResult(result));
    } catch (error) {
      reject(new Error(`Failed to extract all previews: ${error}`));
    }
  });
}

/**
 * Synchronous version of extractAllPreviews
 * @param filePath Path to the RAW image file
 * @returns All previews result
 */
export function extractAllPreviewsSync(filePath: string): AllPreviewsResult {
  const result = nativeModule.extractAllPreviews(filePath);
  return processNativeAllPreviewsResult(result);
}

/**
 * Process the native module result and ensure proper typing
 */
function processNativeResult(nativeResult: any): ExtractorResult {
  if (!nativeResult.success) {
    const result: ExtractorResult = {
      success: false,
      error: nativeResult.error || 'Unknown error occurred'
    };
    
    // Add structured error information if available
    if (nativeResult.errorInfo) {
      result.errorInfo = {
        code: nativeResult.errorInfo.code as ErrorCode,
        message: nativeResult.errorInfo.message,
        context: nativeResult.errorInfo.context
      };
    }
    
    return result;
  }

  const preview: RawPreview = {
    format: nativeResult.preview.format as RawFormat,
    width: nativeResult.preview.width,
    height: nativeResult.preview.height,
    size: nativeResult.preview.size,
    data: nativeResult.preview.data as Buffer,
    quality: nativeResult.preview.quality as 'thumbnail' | 'preview' | 'full'
  };

  // Add optional properties if present
  if (nativeResult.preview.type !== undefined) {
    preview.type = nativeResult.preview.type;
  }
  if (nativeResult.preview.priority !== undefined) {
    preview.priority = nativeResult.preview.priority;
  }
  if (nativeResult.preview.orientation !== undefined) {
    preview.orientation = nativeResult.preview.orientation;
  }

  return {
    success: true,
    preview
  };
}

/**
 * Process the native module result for all previews and ensure proper typing
 */
function processNativeAllPreviewsResult(nativeResult: any): AllPreviewsResult {
  if (!nativeResult.success) {
    return {
      success: false,
      format: RawFormat.UNKNOWN,
      previews: [],
      error: nativeResult.error || 'Unknown error occurred'
    };
  }

  const previews: RawPreview[] = nativeResult.previews.map((nativePreview: any) => ({
    format: nativePreview.format as RawFormat,
    width: nativePreview.width,
    height: nativePreview.height,
    size: nativePreview.size,
    data: nativePreview.data as Buffer,
    quality: nativePreview.quality as 'thumbnail' | 'preview' | 'full',
    type: nativePreview.type,
    priority: nativePreview.priority
  }));

  return {
    success: true,
    format: nativeResult.format as RawFormat,
    previews
  };
}

/**
 * Utility function to check if a format is supported
 * @param format Format string to check
 * @returns True if format is supported
 */
export function isSupportedFormat(format: string): boolean {
  const supportedFormats: RawFormat[] = [
    RawFormat.CR2,
    RawFormat.CR3,
    RawFormat.NEF,
    RawFormat.ARW,
    RawFormat.DNG,
    RawFormat.RAF,
    RawFormat.ORF,
    RawFormat.PEF,
    RawFormat.RW2
  ];
  
  return supportedFormats.includes(format as RawFormat);
}

/**
 * Get list of all supported formats
 * @returns Array of supported RAW formats
 */
export function getSupportedFormats(): RawFormat[] {
  return [
    RawFormat.CR2,
    RawFormat.CR3,
    RawFormat.NEF,
    RawFormat.ARW,
    RawFormat.DNG,
    RawFormat.RAF,
    RawFormat.ORF,
    RawFormat.PEF,
    RawFormat.RW2
  ];
}

/**
 * Create default options with sensible defaults for 200KB-3MB range
 * @param overrides Optional overrides for default options
 * @returns RawPreviewOptions with defaults applied
 */
export function createDefaultOptions(overrides?: Partial<RawPreviewOptions>): RawPreviewOptions {
  return {
    targetSize: {
      min: 200 * 1024,  // 200KB
      max: 3 * 1024 * 1024  // 3MB
    },
    preferQuality: 'preview',
    cache: true,
    timeout: 5000,  // 5 seconds default timeout
    maxMemory: 100, // 100MB memory limit
    includeMetadata: false,
    strictValidation: true,
    ...overrides
  };
}

/**
 * Get human-readable error message from error code
 * @param errorCode The error code
 * @returns Human-readable error description
 */
export function getErrorMessage(errorCode: ErrorCode): string {
  switch (errorCode) {
    case ErrorCode.SUCCESS:
      return 'Operation completed successfully';
    case ErrorCode.FILE_NOT_FOUND:
      return 'File not found or cannot be accessed';
    case ErrorCode.FILE_ACCESS_DENIED:
      return 'Access denied when trying to read file';
    case ErrorCode.INVALID_FORMAT:
      return 'Invalid or unsupported file format';
    case ErrorCode.CORRUPTED_FILE:
      return 'File appears to be corrupted or incomplete';
    case ErrorCode.TIMEOUT_EXCEEDED:
      return 'Operation timed out';
    case ErrorCode.MEMORY_LIMIT_EXCEEDED:
      return 'Memory limit exceeded during processing';
    case ErrorCode.NO_PREVIEWS_FOUND:
      return 'No suitable preview images found in file';
    case ErrorCode.VALIDATION_FAILED:
      return 'Preview validation failed';
    case ErrorCode.UNKNOWN_ERROR:
    default:
      return 'An unknown error occurred';
  }
}

/**
 * Check if an error code represents a retryable error
 * @param errorCode The error code to check
 * @returns True if the error might be retryable
 */
export function isRetryableError(errorCode: ErrorCode): boolean {
  return errorCode === ErrorCode.TIMEOUT_EXCEEDED || 
         errorCode === ErrorCode.MEMORY_LIMIT_EXCEEDED;
}

// Re-export types
export * from './types';

// Default export
export default {
  extractPreview,
  extractPreviewFromBuffer,
  extractMediumPreview,
  extractFullPreview,
  extractPreviewSync,
  extractPreviewFromBufferSync,
  extractMediumPreviewSync,
  extractFullPreviewSync,
  extractAllPreviews,
  extractAllPreviewsSync,
  detectFormat,
  detectFormatSync,
  isSupportedFormat,
  getSupportedFormats,
  createDefaultOptions,
  getErrorMessage,
  isRetryableError
};