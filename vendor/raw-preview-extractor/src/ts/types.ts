export interface RawPreviewOptions {
  targetSize?: {
    min: number;
    max: number;
  };
  preferQuality?: 'thumbnail' | 'preview' | 'full';
  cache?: boolean;
  timeout?: number;
  maxMemory?: number; // Maximum memory usage in MB
  includeMetadata?: boolean; // Extract EXIF metadata
  strictValidation?: boolean; // Perform thorough validation
}

export interface QuickExtractOptions {
  timeout?: number; // Timeout in milliseconds (default: 5000)
  strictValidation?: boolean; // Perform thorough validation (default: true)
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
  type?: string; // e.g., 'THMB', 'PRVW', 'MDAT', 'IFD0', etc.
  priority?: number; // Internal priority for sorting
  orientation?: number; // EXIF orientation: 1=normal, 3=180°, 6=90°CW, 8=90°CCW
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
  UNKNOWN_ERROR = 9
}

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  context?: string;
}

export interface ExtractorResult {
  success: boolean;
  preview?: RawPreview;
  error?: string; // Legacy field for backward compatibility
  errorInfo?: ErrorInfo; // New structured error information
}

export interface AllPreviewsResult {
  success: boolean;
  format: RawFormat;
  previews: RawPreview[];
  error?: string; // Legacy field for backward compatibility
  errorInfo?: ErrorInfo; // New structured error information
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
  UNKNOWN = 'UNKNOWN'
}

export interface TiffTag {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

export interface TiffIFD {
  tags: Map<number, TiffTag>;
  nextIfdOffset: number;
}

export interface JpegMarker {
  type: 'SOI' | 'EOI' | 'DQT' | 'DHT' | 'SOS' | 'APP0' | 'APP1' | 'COM';
  offset: number;
  length?: number;
}