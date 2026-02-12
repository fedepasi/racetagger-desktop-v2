/**
 * Ambient type declarations for raw-preview-extractor
 * Used when the optional native module is not installed (e.g., CI environments)
 */
declare module 'raw-preview-extractor' {
  export interface RawPreviewOptions {
    targetSize?: { min: number; max: number };
    preferQuality?: 'thumbnail' | 'preview' | 'full';
    cache?: boolean;
    timeout?: number;
    maxMemory?: number;
    includeMetadata?: boolean;
    strictValidation?: boolean;
  }

  export interface QuickExtractOptions {
    timeout?: number;
    strictValidation?: boolean;
  }

  export interface RawPreviewMetadata {
    camera?: string;
    timestamp?: Date;
    orientation?: number;
    iso?: number;
    exposureTime?: string;
    fNumber?: number;
    focalLength?: number;
  }

  export interface RawPreview {
    format: 'CR2' | 'CR3' | 'NEF' | 'ARW' | 'DNG' | 'RAF' | 'ORF' | 'PEF' | 'RW2' | 'UNKNOWN';
    width: number;
    height: number;
    size: number;
    data: Buffer;
    quality: 'thumbnail' | 'preview' | 'full';
    type?: string;
    priority?: number;
    orientation?: number;
    metadata?: RawPreviewMetadata;
  }

  export enum ErrorCode {
    SUCCESS = 0,
    FILE_NOT_FOUND = 1,
    FILE_ACCESS_DENIED = 2,
    INVALID_FORMAT = 3,
    CORRUPTED_FILE = 4,
    TIMEOUT_EXCEEDED = 5,
    MEMORY_LIMIT_EXCEEDED = 6,
    NO_PREVIEWS_FOUND = 7,
    VALIDATION_FAILED = 8,
    UNKNOWN_ERROR = 9,
  }

  export interface ErrorInfo {
    code: ErrorCode;
    message: string;
    context?: string;
  }

  export interface ExtractorResult {
    success: boolean;
    preview?: RawPreview;
    error?: string;
    errorInfo?: ErrorInfo;
  }

  export interface AllPreviewsResult {
    success: boolean;
    format: RawFormat;
    previews: RawPreview[];
    error?: string;
    errorInfo?: ErrorInfo;
  }

  export enum RawFormat {
    CR2 = 'CR2',
    CR3 = 'CR3',
    NEF = 'NEF',
    ARW = 'ARW',
    DNG = 'DNG',
    RAF = 'RAF',
    ORF = 'ORF',
    PEF = 'PEF',
    RW2 = 'RW2',
    UNKNOWN = 'UNKNOWN',
  }

  export function extractPreview(filePath: string, options?: RawPreviewOptions): Promise<ExtractorResult>;
  export function extractPreviewFromBuffer(buffer: Buffer, options?: RawPreviewOptions): Promise<ExtractorResult>;
  export function detectFormat(input: string | Buffer): Promise<RawFormat>;
  export function extractMediumPreview(filePath: string, options?: QuickExtractOptions): Promise<ExtractorResult>;
  export function extractFullPreview(filePath: string, options?: QuickExtractOptions): Promise<ExtractorResult>;
  export function extractPreviewSync(filePath: string, options?: RawPreviewOptions): ExtractorResult;
  export function extractPreviewFromBufferSync(buffer: Buffer, options?: RawPreviewOptions): ExtractorResult;
  export function extractMediumPreviewSync(filePath: string, options?: QuickExtractOptions): ExtractorResult;
  export function extractFullPreviewSync(filePath: string, options?: QuickExtractOptions): ExtractorResult;
  export function extractAllPreviews(filePath: string): Promise<AllPreviewsResult>;
  export function extractAllPreviewsSync(filePath: string): AllPreviewsResult;
  export function detectFormatSync(input: string | Buffer): RawFormat;
  export function isSupportedFormat(format: string): boolean;
  export function getSupportedFormats(): RawFormat[];
  export function createDefaultOptions(overrides?: Partial<RawPreviewOptions>): RawPreviewOptions;
  export function getErrorMessage(errorCode: ErrorCode): string;
  export function isRetryableError(errorCode: ErrorCode): boolean;
}
