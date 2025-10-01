import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import { CleanupManager } from './cleanup-manager';

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
    this.cleanupManager = new CleanupManager();
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
      console.log('[RawPreviewExtractor] ✅ Native library available and enabled');
    } catch (error: any) {
      this.nativeLibraryAvailable = false;
      console.log('[RawPreviewExtractor] ⚠️ Native library not available, using dcraw fallback only');
      console.log(`[RawPreviewExtractor] Native library error: ${error.message}`);
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

    console.log(`[RawPreviewExtractor] Extracting preview: ${path.basename(filePath)}`);
    console.log(`[RawPreviewExtractor] Native available: ${this.nativeLibraryAvailable}, Enabled: ${opts.useNativeLibrary}`);

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
          console.log(`[RawPreviewExtractor] Native library failed: ${nativeError.message}`);
          console.log('[RawPreviewExtractor] Falling back to dcraw...');
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
   * Estrazione con libreria nativa usando strategia Medium → Full
   */
  private async extractWithNativeLibrary(filePath: string, options: Required<NativePreviewOptions>): Promise<NativePreviewResult> {
    try {
      console.log('[RawPreviewExtractor] Attempting native library extraction...');
      
      const nativeLib = await import('raw-preview-extractor');
      
      // Opzioni per le funzioni specifiche (più semplici)
      const quickOptions = {
        timeout: options.timeout,
        strictValidation: false // Disabilitiamo la validazione stretta
      };

      let result: any = null;
      let extractionMethod = '';

      // STRATEGIA 1: extractMediumPreview (default)
      try {
        console.log('[RawPreviewExtractor] Trying extractMediumPreview...');
        result = await nativeLib.extractMediumPreview(filePath, quickOptions);
        extractionMethod = 'Medium';
        
        if (result.success && result.preview) {
          console.log(`[RawPreviewExtractor] ✅ Medium preview successful: ${result.preview.data.length} bytes, type: ${result.preview.type || 'unknown'}`);
        } else {
          console.log('[RawPreviewExtractor] Medium preview failed or empty, trying full preview...');
          result = null; // Reset per tentativo successivo
        }
      } catch (mediumError: any) {
        console.log(`[RawPreviewExtractor] Medium preview error: ${mediumError.message}`);
        result = null;
      }

      // STRATEGIA 2: extractFullPreview (se medium fallisce)
      if (!result || !result.success || !result.preview) {
        try {
          console.log('[RawPreviewExtractor] Trying extractFullPreview...');
          result = await nativeLib.extractFullPreview(filePath, quickOptions);
          extractionMethod = 'Full';
          
          if (result.success && result.preview) {
            console.log(`[RawPreviewExtractor] ✅ Full preview successful: ${result.preview.data.length} bytes, type: ${result.preview.type || 'unknown'}`);
          } else {
            console.log('[RawPreviewExtractor] Full preview also failed');
          }
        } catch (fullError: any) {
          console.log(`[RawPreviewExtractor] Full preview error: ${fullError.message}`);
          result = null;
        }
      }

      // Verifica risultato finale
      if (result && result.success && result.preview) {
        console.log(`[RawPreviewExtractor] ✅ Native extraction successful via ${extractionMethod}: ${result.preview.data.length} bytes`);
        
        return {
          success: true,
          data: result.preview.data,
          width: result.preview.width,
          height: result.preview.height,
          format: result.preview.format,
          metadata: result.preview.metadata ? {
            orientation: result.preview.metadata.orientation,
            camera: result.preview.metadata.camera,
            iso: result.preview.metadata.iso,
            aperture: result.preview.metadata.fNumber,
            shutterSpeed: result.preview.metadata.exposureTime
          } : undefined
        };
      }

      console.log(`[RawPreviewExtractor] ❌ Both native extraction methods failed`);
      return {
        success: false,
        error: result?.error || 'Both medium and full preview extraction failed'
      };

    } catch (error: any) {
      return {
        success: false,
        error: `Native library error: ${error.message}`
      };
    }
  }

  /**
   * Estrazione con dcraw fallback (implementazione attuale)
   * Usa il sistema esistente raw-converter ma con interfaccia ottimizzata
   */
  private async extractWithDcrawFallback(filePath: string, options: Required<NativePreviewOptions>): Promise<NativePreviewResult> {
    try {
      console.log('[RawPreviewExtractor] Using dcraw fallback for:', path.basename(filePath));
      
      // Verifica che il file esista
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`
        };
      }

      // Usa il RawConverter esistente del sistema RaceTagger
      const { RawConverter } = await import('./raw-converter');
      const rawConverter = new RawConverter();
      
      try {
        // Usa il metodo esistente per estrarre thumbnail con timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('dcraw timeout after 30 seconds')), 30000);
        });

        const outputPath = await Promise.race([
          rawConverter.extractThumbnailFromRaw(filePath),
          timeoutPromise
        ]);

        if (!outputPath || !fs.existsSync(outputPath)) {
          return {
            success: false,
            error: 'dcraw extraction failed - no output file'
          };
        }
        
        // Leggi il file generato
        const thumbnailData = await fsPromises.readFile(outputPath);
        
        // Cleanup temporary file
        try {
          await fsPromises.unlink(outputPath);
        } catch (cleanupError) {
          console.log('[RawPreviewExtractor] Warning: Could not cleanup temp file:', outputPath);
        }
        
        console.log(`[RawPreviewExtractor] ✅ dcraw extraction successful: ${thumbnailData.length} bytes`);
        
        return {
          success: true,
          data: thumbnailData,
          width: 0, // dcraw doesn't provide dimensions easily
          height: 0,
          format: 'JPEG',
          metadata: {
            orientation: 1
          }
        };
        
      } catch (converterError: any) {
        return {
          success: false,
          error: `dcraw conversion failed: ${converterError.message}`
        };
      }

    } catch (error: any) {
      return {
        success: false,
        error: `Dcraw fallback error: ${error.message}`
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

    console.log(`[RawPreviewExtractor] Running benchmark with ${testFiles.length} files, ${iterations} iterations each`);

    for (const file of testFiles) {
      if (!fs.existsSync(file)) {
        console.log(`[RawPreviewExtractor] Skipping missing file: ${file}`);
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

    console.log(`[RawPreviewExtractor] Benchmark results:`);
    console.log(`  Native average: ${nativeAverage.toFixed(1)}ms`);
    console.log(`  Dcraw average: ${dcrawAverage.toFixed(1)}ms`);
    console.log(`  Speedup: ${speedup.toFixed(1)}x`);

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