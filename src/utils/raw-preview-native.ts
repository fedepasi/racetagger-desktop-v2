import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import { CleanupManager, getCleanupManager } from './cleanup-manager';

/**
 * Opzioni per l'estrazione preview nativa
 */
export interface NativePreviewOptions {
  targetMinSize?: number;    // 200KB default
  targetMaxSize?: number;    // 3MB default
  timeout?: number;          // 5000ms default
  preferQuality?: 'thumbnail' | 'preview' | 'full';
  includeMetadata?: boolean;
  useNativeLibrary?: boolean; // Flag per abilitare/disabilitare libreria nativa
}

/**
 * Risultato estrazione preview nativa
 */
export interface NativePreviewResult {
  success: boolean;
  data?: Buffer;
  width?: number;
  height?: number;
  format?: string;
  extractionTimeMs?: number;
  method?: 'native' | 'dcraw-fallback';
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
 * Statistiche di performance per confronto
 */
export interface PreviewExtractionStats {
  totalExtractions: number;
  nativeSuccesses: number;
  dcrawFallbacks: number;
  failures: number;
  averageTimeMs: number;
  nativeAverageTimeMs: number;
  dcrawAverageTimeMs: number;
}

/**
 * Wrapper per l'estrazione veloce di preview da file RAW
 * Supporta sia la libreria nativa che fallback a dcraw
 */
export class RawPreviewExtractor {
  private cleanupManager: CleanupManager;
  private stats: PreviewExtractionStats;
  private nativeLibraryAvailable: boolean = false;

  constructor() {
    this.cleanupManager = getCleanupManager(); // PERFORMANCE: Use singleton to avoid memory leak
    this.stats = {
      totalExtractions: 0,
      nativeSuccesses: 0,
      dcrawFallbacks: 0,
      failures: 0,
      averageTimeMs: 0,
      nativeAverageTimeMs: 0,
      dcrawAverageTimeMs: 0
    };
    
    this.checkNativeLibraryAvailability();
  }

  /**
   * Verifica se la libreria nativa è disponibile
   */
  private async checkNativeLibraryAvailability(): Promise<void> {
    try {
      // Tenta di importare la libreria nativa
      const nativeLib = await import('raw-preview-extractor');
      this.nativeLibraryAvailable = true;
      // Native library available
    } catch (error: any) {
      this.nativeLibraryAvailable = false;
      // Native library not available, using dcraw fallback only
    }
  }

  /**
   * Estrae preview da file RAW con strategia a cascata:
   * 1. Libreria nativa (se disponibile e abilitata)
   * 2. Fallback a dcraw
   */
  async extractPreview(filePath: string, options: NativePreviewOptions = {}): Promise<NativePreviewResult> {
    const startTime = Date.now();
    this.stats.totalExtractions++;

    // Opzioni con default
    const opts: Required<NativePreviewOptions> = {
      targetMinSize: options.targetMinSize || 200 * 1024,        // 200KB
      targetMaxSize: options.targetMaxSize || 3 * 1024 * 1024,   // 3MB
      timeout: options.timeout || 5000,                          // 5s
      preferQuality: options.preferQuality || 'preview',
      includeMetadata: options.includeMetadata || false,
      useNativeLibrary: options.useNativeLibrary !== false       // default true
    };


    try {
      // Strategia 1: Libreria nativa (se disponibile e abilitata)
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
          // Native library failed, falling back to dcraw
        }
      }

      // Strategia 2: Fallback a dcraw (sempre disponibile)
      const dcrawResult = await this.extractWithDcrawFallback(filePath, opts);
      const extractionTime = Date.now() - startTime;
      
      if (dcrawResult.success) {
        this.updateStats('dcraw', extractionTime);
      } else {
        this.stats.failures++;
      }

      return {
        ...dcrawResult,
        extractionTimeMs: extractionTime,
        method: 'dcraw-fallback'
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
   * Estrazione con libreria nativa
   */
  private async extractWithNativeLibrary(filePath: string, options: Required<NativePreviewOptions>): Promise<NativePreviewResult> {
    try {

      const nativeLib = await import('raw-preview-extractor');

      // Opzioni per extractPreview - RawPreviewOptions ha targetSize come oggetto {min, max}
      const extractOptions = {
        targetSize: {
          min: options.targetMinSize,
          max: options.targetMaxSize
        },
        preferQuality: options.preferQuality,
        timeout: options.timeout,
        includeMetadata: options.includeMetadata
      };

      // Usa extractPreview che ritorna ExtractorResult con preview?: RawPreview
      const result = await nativeLib.extractPreview(filePath, extractOptions);

      if (result.success && result.preview) {
        return {
          success: true,
          data: result.preview.data,
          width: result.preview.width,
          height: result.preview.height,
          format: 'JPEG', // Il preview estratto è sempre JPEG
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
   * Estrazione con ExifTool fallback
   * Usa ExifTool per estrarre le preview JPEG embedded dai file RAW
   */
  private async extractWithDcrawFallback(filePath: string, options: Required<NativePreviewOptions>): Promise<NativePreviewResult> {
    try {

      // Verifica che il file esista
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`
        };
      }

      // Determina il percorso di ExifTool in base alla piattaforma e ambiente
      const platform = process.platform;
      let exiftoolPath: string;

      // Determina se siamo in development o production
      let isDev = true;
      try {
        const { app } = require('electron');
        isDev = !app || !app.isPackaged;
      } catch {
        isDev = true;
      }

      let vendorDir: string;
      if (isDev) {
        // In development: da dist/utils/ alla root del progetto, poi a vendor/
        vendorDir = path.join(__dirname, '../../../vendor', platform);
      } else {
        // In production: vendor files sono unpacked dall'asar
        vendorDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', platform);
      }

      if (platform === 'win32') {
        // Windows: usa perl.exe + exiftool.pl
        const perlExe = path.join(vendorDir, 'perl.exe');
        const exiftoolPl = path.join(vendorDir, 'exiftool.pl');
        exiftoolPath = `"${perlExe}" "${exiftoolPl}"`;
      } else if (platform === 'darwin') {
        // macOS
        exiftoolPath = path.join(vendorDir, 'exiftool');
      } else {
        // Linux
        exiftoolPath = path.join(vendorDir, 'exiftool');
      }

      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        // Genera percorso output temporaneo
        const tempDir = os.tmpdir();
        const randomId = Math.random().toString(36).substring(2, 15);
        const tempOutputPath = path.join(tempDir, `exiftool_preview_${randomId}.jpg`);

        // Usa ExifTool per estrarre la preview JPEG embedded
        const command = `${exiftoolPath} -b -PreviewImage "${filePath}" > "${tempOutputPath}"`;

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('ExifTool timeout after 30 seconds')), 30000);
        });

        await Promise.race([
          execAsync(command, { maxBuffer: 50 * 1024 * 1024 }), // 50MB buffer
          timeoutPromise
        ]);

        // Verifica che il file sia stato creato e non sia vuoto
        if (!fs.existsSync(tempOutputPath)) {
          return {
            success: false,
            error: 'ExifTool extraction failed - no output file'
          };
        }

        const stats = await fsPromises.stat(tempOutputPath);
        if (stats.size === 0) {
          await fsPromises.unlink(tempOutputPath);
          return {
            success: false,
            error: 'ExifTool extraction failed - empty preview'
          };
        }

        // Leggi il file generato
        const thumbnailData = await fsPromises.readFile(tempOutputPath);

        // Cleanup temporary file
        try {
          await fsPromises.unlink(tempOutputPath);
        } catch (cleanupError) {
          // Could not cleanup temp file - non-critical
        }

        return {
          success: true,
          data: thumbnailData,
          width: 0, // ExifTool doesn't provide dimensions in this mode
          height: 0,
          format: 'JPEG',
          metadata: {
            orientation: 1
          }
        };

      } catch (converterError: any) {
        return {
          success: false,
          error: `ExifTool extraction failed: ${converterError.message}`
        };
      }

    } catch (error: any) {
      return {
        success: false,
        error: `ExifTool fallback error: ${error.message}`
      };
    }
  }

  /**
   * Aggiorna statistiche di performance
   */
  private updateStats(method: 'native' | 'dcraw', extractionTimeMs: number): void {
    if (method === 'native') {
      this.stats.nativeSuccesses++;
      this.stats.nativeAverageTimeMs = 
        (this.stats.nativeAverageTimeMs * (this.stats.nativeSuccesses - 1) + extractionTimeMs) / this.stats.nativeSuccesses;
    } else {
      this.stats.dcrawFallbacks++;
      this.stats.dcrawAverageTimeMs = 
        (this.stats.dcrawAverageTimeMs * (this.stats.dcrawFallbacks - 1) + extractionTimeMs) / this.stats.dcrawFallbacks;
    }

    const totalSuccesses = this.stats.nativeSuccesses + this.stats.dcrawFallbacks;
    this.stats.averageTimeMs = 
      (this.stats.averageTimeMs * (totalSuccesses - 1) + extractionTimeMs) / totalSuccesses;
  }

  /**
   * Ottiene statistiche di performance
   */
  getStats(): PreviewExtractionStats {
    return { ...this.stats };
  }

  /**
   * Resetta le statistiche
   */
  resetStats(): void {
    this.stats = {
      totalExtractions: 0,
      nativeSuccesses: 0,
      dcrawFallbacks: 0,
      failures: 0,
      averageTimeMs: 0,
      nativeAverageTimeMs: 0,
      dcrawAverageTimeMs: 0
    };
  }

  /**
   * Verifica se un formato è supportato dalla libreria nativa
   */
  isSupportedFormat(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const supportedFormats = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2'];
    return supportedFormats.includes(ext);
  }

  /**
   * Ottiene informazioni sulla disponibilità dei metodi di estrazione
   */
  getCapabilities(): {
    nativeAvailable: boolean;
    dcrawAvailable: boolean;
    supportedFormats: string[];
  } {
    return {
      nativeAvailable: this.nativeLibraryAvailable,
      dcrawAvailable: true, // dcraw è sempre disponibile come fallback
      supportedFormats: ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2']
    };
  }

  /**
   * Test di benchmark per confrontare performance
   */
  async runBenchmark(testFiles: string[], iterations: number = 3): Promise<{
    nativeResults: number[];
    dcrawResults: number[];
    nativeAverage: number;
    dcrawAverage: number;
    speedup: number;
  }> {
    const nativeResults: number[] = [];
    const dcrawResults: number[] = [];


    for (const file of testFiles) {
      if (!fs.existsSync(file)) {
        continue;
      }

      // Test con native library (se disponibile)
      if (this.nativeLibraryAvailable) {
        for (let i = 0; i < iterations; i++) {
          const start = Date.now();
          await this.extractPreview(file, { useNativeLibrary: true });
          nativeResults.push(Date.now() - start);
        }
      }

      // Test con dcraw fallback
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await this.extractPreview(file, { useNativeLibrary: false });
        dcrawResults.push(Date.now() - start);
      }
    }

    const nativeAverage = nativeResults.length > 0 ? 
      nativeResults.reduce((a, b) => a + b, 0) / nativeResults.length : 0;
    
    const dcrawAverage = dcrawResults.length > 0 ? 
      dcrawResults.reduce((a, b) => a + b, 0) / dcrawResults.length : 0;

    const speedup = nativeAverage > 0 ? dcrawAverage / nativeAverage : 0;

    return {
      nativeResults,
      dcrawResults,
      nativeAverage,
      dcrawAverage,
      speedup
    };
  }
}

// Istanza singleton per uso globale
export const rawPreviewExtractor = new RawPreviewExtractor();