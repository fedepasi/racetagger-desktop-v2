import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import { CleanupManager, getCleanupManager } from './cleanup-manager';

/**
 * Options for native preview extraction
 */
export interface NativePreviewOptions {
  targetMinSize?: number;    // 200KB default
  targetMaxSize?: number;    // 3MB default
  timeout?: number;          // 5000ms default
  preferQuality?: 'thumbnail' | 'preview' | 'full';
  includeMetadata?: boolean;
  useNativeLibrary?: boolean;
}

/**
 * Result of preview extraction
 */
export interface NativePreviewResult {
  success: boolean;
  data?: Buffer;
  width?: number;
  height?: number;
  format?: string;
  extractionTimeMs?: number;
  method?: 'native' | 'exiftool';
  error?: string;
  metadata?: {
    orientation?: number;
    camera?: string;
    iso?: number;
    aperture?: number;
    shutterSpeed?: string;
  };
}

/**
 * Performance statistics
 */
export interface PreviewExtractionStats {
  totalExtractions: number;
  nativeSuccesses: number;
  exiftoolFallbacks: number;
  failures: number;
  averageTimeMs: number;
  nativeAverageTimeMs: number;
  exiftoolAverageTimeMs: number;
}

/**
 * RAW preview extractor using native library (raw-preview-extractor) with ExifTool fallback.
 * dcraw and ImageMagick removed in v1.2.0.
 */
export class RawPreviewExtractor {
  private cleanupManager: CleanupManager;
  private stats: PreviewExtractionStats;
  private nativeLibraryAvailable: boolean = false;

  constructor() {
    this.cleanupManager = getCleanupManager();
    this.stats = {
      totalExtractions: 0,
      nativeSuccesses: 0,
      exiftoolFallbacks: 0,
      failures: 0,
      averageTimeMs: 0,
      nativeAverageTimeMs: 0,
      exiftoolAverageTimeMs: 0
    };

    this.checkNativeLibraryAvailability();
  }

  private async checkNativeLibraryAvailability(): Promise<void> {
    try {
      const nativeLib = await import('raw-preview-extractor');
      this.nativeLibraryAvailable = true;
    } catch (error: any) {
      this.nativeLibraryAvailable = false;
    }
  }

  /**
   * Extract preview from RAW file with cascade strategy:
   * 1. Native library (raw-preview-extractor, if available)
   * 2. ExifTool fallback (always available)
   */
  async extractPreview(filePath: string, options: NativePreviewOptions = {}): Promise<NativePreviewResult> {
    const startTime = Date.now();
    this.stats.totalExtractions++;

    const opts: Required<NativePreviewOptions> = {
      targetMinSize: options.targetMinSize || 200 * 1024,
      targetMaxSize: options.targetMaxSize || 3 * 1024 * 1024,
      timeout: options.timeout || 5000,
      preferQuality: options.preferQuality || 'preview',
      includeMetadata: options.includeMetadata || false,
      useNativeLibrary: options.useNativeLibrary !== false
    };

    try {
      // Strategy 1: Native library
      if (this.nativeLibraryAvailable && opts.useNativeLibrary) {
        try {
          const nativeResult = await this.extractWithNativeLibrary(filePath, opts);
          if (nativeResult.success) {
            const extractionTime = Date.now() - startTime;
            this.updateStats('native', extractionTime);
            return {
              ...nativeResult,
              extractionTimeMs: extractionTime,
              method: 'native'
            };
          }
        } catch (nativeError: any) {
          // Native failed, fall through to ExifTool
        }
      }

      // Strategy 2: ExifTool fallback
      const exiftoolResult = await this.extractWithExifTool(filePath, opts);
      const extractionTime = Date.now() - startTime;

      if (exiftoolResult.success) {
        this.updateStats('exiftool', extractionTime);
      } else {
        this.stats.failures++;
      }

      return {
        ...exiftoolResult,
        extractionTimeMs: extractionTime,
        method: 'exiftool'
      };

    } catch (error: any) {
      this.stats.failures++;
      return {
        success: false,
        error: `Preview extraction failed: ${error.message}`,
        extractionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Extract with native raw-preview-extractor library
   */
  private async extractWithNativeLibrary(filePath: string, options: Required<NativePreviewOptions>): Promise<NativePreviewResult> {
    try {
      const nativeLib = await import('raw-preview-extractor');

      const extractOptions = {
        targetSize: {
          min: options.targetMinSize,
          max: options.targetMaxSize
        },
        preferQuality: options.preferQuality,
        timeout: options.timeout,
        includeMetadata: options.includeMetadata
      };

      const result = await nativeLib.extractPreview(filePath, extractOptions);

      if (result.success && result.preview) {
        return {
          success: true,
          data: result.preview.data,
          width: result.preview.width,
          height: result.preview.height,
          format: 'JPEG',
          metadata: result.preview.metadata ? {
            orientation: result.preview.metadata.orientation,
            camera: result.preview.metadata.camera,
            iso: result.preview.metadata.iso,
            aperture: result.preview.metadata.fNumber,
            shutterSpeed: result.preview.metadata.exposureTime
          } : undefined
        };
      }

      return {
        success: false,
        error: result.error || 'Native preview extraction failed'
      };

    } catch (error: any) {
      return {
        success: false,
        error: `Native library error: ${error.message}`
      };
    }
  }

  /**
   * Resolve ExifTool executable path and optional Perl script arguments.
   * Returns { exe, args } so callers can use execFile() instead of shell exec().
   * On Windows, exiftool.exe is actually perl.exe and requires exiftool.pl as first arg.
   */
  private resolveExifToolInfo(): { exe: string; prefixArgs: string[] } {
    const platform = process.platform;

    let isDev = true;
    try {
      const { app } = require('electron');
      isDev = !app || !app.isPackaged;
    } catch {
      isDev = true;
    }

    let vendorDir: string;
    if (isDev) {
      vendorDir = path.join(__dirname, '../../../vendor', platform);
    } else {
      vendorDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', platform);
    }

    if (platform === 'win32') {
      const exiftoolExe = path.join(vendorDir, 'exiftool.exe');
      const perlExe = path.join(vendorDir, 'perl.exe');
      const exiftoolPl = path.join(vendorDir, 'exiftool.pl');

      if (fs.existsSync(exiftoolExe) && fs.existsSync(exiftoolPl)) {
        // exiftool.exe is actually perl.exe; prepend exiftool.pl as first argument
        return { exe: exiftoolExe, prefixArgs: [exiftoolPl] };
      } else if (fs.existsSync(perlExe) && fs.existsSync(exiftoolPl)) {
        return { exe: perlExe, prefixArgs: [exiftoolPl] };
      } else {
        console.warn(`[RawPreviewExtractor] Windows ExifTool not found. Checked: ${exiftoolExe}, ${perlExe}`);
        return { exe: exiftoolExe, prefixArgs: [] };
      }
    }

    return { exe: path.join(vendorDir, 'exiftool'), prefixArgs: [] };
  }

  /**
   * Extract embedded JPEG preview from RAW file using ExifTool (-PreviewImage tag)
   * Uses execFile() to capture binary stdout — no shell redirection needed (cross-platform safe).
   */
  private async extractWithExifTool(filePath: string, options: Required<NativePreviewOptions>): Promise<NativePreviewResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      const { exe, prefixArgs } = this.resolveExifToolInfo();

      const { execFile } = await import('child_process');

      // Use execFile (no shell) with binary stdout — safe on Windows with spaces in paths
      const args = [...prefixArgs, '-b', '-PreviewImage', filePath];

      const thumbnailData = await new Promise<Buffer>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ExifTool timeout after 30 seconds')), 30000);

        const child = execFile(exe, args, {
          maxBuffer: 50 * 1024 * 1024,
          encoding: 'buffer' as any  // Capture binary output
        }, (error: any, stdout: any) => {
          clearTimeout(timeout);
          if (error) {
            reject(new Error(`ExifTool failed: ${error.message}`));
          } else {
            resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'binary'));
          }
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      if (!thumbnailData || thumbnailData.length === 0) {
        return { success: false, error: 'ExifTool extraction failed - empty preview' };
      }

      return {
        success: true,
        data: thumbnailData,
        width: 0,
        height: 0,
        format: 'JPEG',
        metadata: { orientation: 1 }
      };

    } catch (error: any) {
      return { success: false, error: `ExifTool fallback error: ${error.message}` };
    }
  }

  /**
   * Extract full/high-quality preview (JpgFromRaw) using ExifTool
   * Uses execFile() with binary stdout capture — no shell redirection (cross-platform safe).
   */
  private async extractJpgFromRawWithExifTool(filePath: string, timeout: number): Promise<NativePreviewResult> {
    const startTime = Date.now();

    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      const { exe, prefixArgs } = this.resolveExifToolInfo();

      const { execFile } = await import('child_process');

      // Use execFile (no shell) with binary stdout
      const args = [...prefixArgs, '-b', '-JpgFromRaw', filePath];

      const data = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ExifTool timeout')), timeout);

        const child = execFile(exe, args, {
          maxBuffer: 50 * 1024 * 1024,
          encoding: 'buffer' as any  // Capture binary output
        }, (error: any, stdout: any) => {
          clearTimeout(timer);
          if (error) {
            reject(new Error(`ExifTool failed: ${error.message}`));
          } else {
            resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'binary'));
          }
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      if (!data || data.length === 0) {
        // Fallback: try -PreviewImage tag instead
        return this.extractWithExifTool(filePath, {
          targetMinSize: 200 * 1024,
          targetMaxSize: 10 * 1024 * 1024,
          timeout: timeout,
          preferQuality: 'full',
          includeMetadata: false,
          useNativeLibrary: false
        });
      }

      return {
        success: true,
        data,
        width: 0,
        height: 0,
        format: 'JPEG',
        extractionTimeMs: Date.now() - startTime,
        method: 'exiftool'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `JpgFromRaw extraction failed: ${error.message}`,
        extractionTimeMs: Date.now() - startTime
      };
    }
  }

  private updateStats(method: 'native' | 'exiftool', extractionTimeMs: number): void {
    if (method === 'native') {
      this.stats.nativeSuccesses++;
      this.stats.nativeAverageTimeMs =
        (this.stats.nativeAverageTimeMs * (this.stats.nativeSuccesses - 1) + extractionTimeMs) / this.stats.nativeSuccesses;
    } else {
      this.stats.exiftoolFallbacks++;
      this.stats.exiftoolAverageTimeMs =
        (this.stats.exiftoolAverageTimeMs * (this.stats.exiftoolFallbacks - 1) + extractionTimeMs) / this.stats.exiftoolFallbacks;
    }

    const totalSuccesses = this.stats.nativeSuccesses + this.stats.exiftoolFallbacks;
    this.stats.averageTimeMs =
      (this.stats.averageTimeMs * (totalSuccesses - 1) + extractionTimeMs) / totalSuccesses;
  }

  getStats(): PreviewExtractionStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalExtractions: 0,
      nativeSuccesses: 0,
      exiftoolFallbacks: 0,
      failures: 0,
      averageTimeMs: 0,
      nativeAverageTimeMs: 0,
      exiftoolAverageTimeMs: 0
    };
  }

  isSupportedFormat(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const supportedFormats = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2'];
    return supportedFormats.includes(ext);
  }

  getCapabilities(): {
    nativeAvailable: boolean;
    exiftoolAvailable: boolean;
    supportedFormats: string[];
  } {
    return {
      nativeAvailable: this.nativeLibraryAvailable,
      exiftoolAvailable: true,
      supportedFormats: ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2']
    };
  }

  /**
   * Extract full/high quality preview from a RAW file.
   * Targets the largest embedded JPEG (JpgFromRaw), typically 2-8MB, full resolution.
   */
  async extractFullPreview(filePath: string, options?: { timeout?: number }): Promise<NativePreviewResult> {
    const startTime = Date.now();

    if (!this.nativeLibraryAvailable) {
      return this.extractJpgFromRawWithExifTool(filePath, options?.timeout || 30000);
    }

    try {
      const nativeLib = await import('raw-preview-extractor');
      const result = await nativeLib.extractFullPreview(filePath, {
        timeout: options?.timeout || 15000
      });

      if (result.success && result.preview) {
        return {
          success: true,
          data: result.preview.data,
          width: result.preview.width,
          height: result.preview.height,
          format: 'JPEG',
          extractionTimeMs: Date.now() - startTime,
          method: 'native',
          metadata: result.preview.metadata ? {
            orientation: result.preview.metadata.orientation,
            camera: result.preview.metadata.camera,
            iso: result.preview.metadata.iso,
            aperture: result.preview.metadata.fNumber,
            shutterSpeed: result.preview.metadata.exposureTime
          } : undefined
        };
      }

      // Native failed - try ExifTool -JpgFromRaw
      return this.extractJpgFromRawWithExifTool(filePath, options?.timeout || 30000);
    } catch (error: any) {
      return this.extractJpgFromRawWithExifTool(filePath, options?.timeout || 30000);
    }
  }

  /**
   * Extract all available JPEG previews from a RAW file.
   */
  async extractAllPreviews(filePath: string): Promise<{
    success: boolean;
    previews: Array<{
      quality: 'thumbnail' | 'preview' | 'full';
      width: number;
      height: number;
      data: Buffer;
      size: number;
    }>;
    error?: string;
  }> {
    if (!this.nativeLibraryAvailable) {
      return { success: false, previews: [], error: 'Native library not available' };
    }

    try {
      const nativeLib = await import('raw-preview-extractor');
      const result = await nativeLib.extractAllPreviews(filePath);

      if (result.success && result.previews) {
        return {
          success: true,
          previews: result.previews.map((p: any) => ({
            quality: p.quality || 'preview',
            width: p.width,
            height: p.height,
            data: p.data,
            size: p.data.length
          }))
        };
      }

      return { success: false, previews: [], error: result.error || 'No previews found' };
    } catch (error: any) {
      return { success: false, previews: [], error: error.message };
    }
  }

  /**
   * Run benchmark comparing native vs ExifTool performance
   */
  async runBenchmark(testFiles: string[], iterations: number = 3): Promise<{
    nativeResults: number[];
    exiftoolResults: number[];
    nativeAverage: number;
    exiftoolAverage: number;
    speedup: number;
  }> {
    const nativeResults: number[] = [];
    const exiftoolResults: number[] = [];

    for (const file of testFiles) {
      if (!fs.existsSync(file)) continue;

      if (this.nativeLibraryAvailable) {
        for (let i = 0; i < iterations; i++) {
          const start = Date.now();
          await this.extractPreview(file, { useNativeLibrary: true });
          nativeResults.push(Date.now() - start);
        }
      }

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await this.extractPreview(file, { useNativeLibrary: false });
        exiftoolResults.push(Date.now() - start);
      }
    }

    const nativeAverage = nativeResults.length > 0 ?
      nativeResults.reduce((a, b) => a + b, 0) / nativeResults.length : 0;

    const exiftoolAverage = exiftoolResults.length > 0 ?
      exiftoolResults.reduce((a, b) => a + b, 0) / exiftoolResults.length : 0;

    const speedup = nativeAverage > 0 ? exiftoolAverage / nativeAverage : 0;

    return { nativeResults, exiftoolResults, nativeAverage, exiftoolAverage, speedup };
  }
}

export const rawPreviewExtractor = new RawPreviewExtractor();
