/**
 * Sistema ibrido per il processing delle immagini: Sharp + Jimp
 * Usa Sharp quando disponibile (più veloce), Jimp come fallback affidabile (puro JavaScript)
 */

import * as fs from 'fs';

// Configura il limite di memoria globale per jpeg-js all'avvio del modulo
try {
  const jpegJs = require('jpeg-js');
  if (jpegJs && jpegJs.decode) {
    const originalDecode = jpegJs.decode;
    jpegJs.decode = function(jpegData: any, options: any = {}) {
      // Imposta sempre un limite di memoria molto alto
      options.maxMemoryUsageInMB = 1024;
      return originalDecode(jpegData, options);
    };
  }
} catch (error) {
  // Silently ignore - jpeg-js configuration is optional
}

// Interfaccia unificata per entrambi i sistemi
export interface ImageProcessor {
  resize(width: number, height: number, options?: any): ImageProcessor;
  rotate(angle?: number): ImageProcessor; // Auto-rotate basato su EXIF se nessun angolo specificato
  jpeg(options?: any): ImageProcessor;
  png(options?: any): ImageProcessor;
  webp(options?: any): ImageProcessor;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
}

// ============================================================================
// GLOBAL CACHE per evitare test ripetuti
// ============================================================================
interface SharpCache {
  instance: any | null;
  isWorking: boolean;
  tested: boolean;
}

const sharpCache: SharpCache = {
  instance: null,
  isWorking: false,
  tested: false
};

/**
 * Inizializza e testa Sharp UNA VOLTA all'avvio dell'applicazione
 * Deve essere chiamato da main.ts durante l'avvio
 */
export async function initializeImageProcessor(): Promise<void> {
  if (sharpCache.tested) {
    return; // Già inizializzato
  }

  const forceJimp = process.env.FORCE_JIMP_FALLBACK === 'true';

  if (forceJimp) {
    console.log('[ImageProcessor] FORCE_JIMP_FALLBACK enabled, skipping Sharp test');
    sharpCache.tested = true;
    sharpCache.isWorking = false;
    return;
  }

  try {
    const { app } = require('electron');
    const isPackaged = app?.isPackaged || false;

    let sharp: any;

    if (isPackaged) {
      const path = require('path');
      const fs = require('fs');
      const platform = process.platform;  // 'darwin' | 'win32' | 'linux'
      const arch = process.arch;          // 'arm64' | 'x64'

      const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
      const sharpPath = path.join(unpackedPath, 'sharp');

      // Verifica che Sharp esista
      if (!fs.existsSync(sharpPath)) {
        throw new Error(`Sharp not found at ${sharpPath}`);
      }

      // Cross-platform: detect correct @img package for current platform/arch
      // Packages follow pattern: @img/sharp-{platform}-{arch}
      const sharpPlatformPkg = `sharp-${platform}-${arch}`;
      const sharpPlatformPath = path.join(unpackedPath, '@img', sharpPlatformPkg);
      const binaryPath = path.join(sharpPlatformPath, 'lib', `sharp-${platform}-${arch}.node`);

      // Libvips package follows pattern: @img/sharp-libvips-{platform}-{arch}
      const libvipsPkg = `sharp-libvips-${platform}-${arch}`;
      const libvipsDir = path.join(unpackedPath, '@img', libvipsPkg, 'lib');
      let libvipsPath: string | null = null;

      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Sharp native binary not found at ${binaryPath} (platform: ${platform}, arch: ${arch})`);
      }

      if (fs.existsSync(libvipsDir)) {
        const files = fs.readdirSync(libvipsDir);
        // Find the main libvips shared library based on platform
        let libvipsFile: string | undefined;
        if (platform === 'darwin') {
          libvipsFile = files.find((f: string) => f.startsWith('libvips-cpp.') && f.endsWith('.dylib'));
        } else if (platform === 'win32') {
          libvipsFile = files.find((f: string) => f === 'libvips-cpp.dll' || (f.startsWith('libvips') && f.endsWith('.dll')));
        } else {
          // Linux
          libvipsFile = files.find((f: string) => f.startsWith('libvips-cpp.so'));
        }
        if (libvipsFile) {
          libvipsPath = path.join(libvipsDir, libvipsFile);
        }
      }

      if (!libvipsPath || !fs.existsSync(libvipsPath)) {
        throw new Error(`Sharp libvips not found in: ${libvipsDir} (platform: ${platform}, arch: ${arch})`);
      }

      // Platform-specific library path setup
      if (platform === 'darwin') {
        process.env.DYLD_LIBRARY_PATH = `${libvipsDir}:${process.env.DYLD_LIBRARY_PATH || ''}`;
      } else if (platform === 'linux') {
        process.env.LD_LIBRARY_PATH = `${libvipsDir}:${process.env.LD_LIBRARY_PATH || ''}`;
      } else if (platform === 'win32') {
        // Windows: Add DLL directory to PATH so Sharp can find libvips
        process.env.PATH = `${libvipsDir};${process.env.PATH || ''}`;
      }

      console.log(`[ImageProcessor] Sharp binary: ${sharpPlatformPkg}, libvips: ${libvipsPkg}`);

      // Cambia directory temporaneamente
      const originalCwd = process.cwd();
      try {
        process.chdir(path.join(process.resourcesPath, 'app.asar.unpacked'));
        const sharpCacheKey = require.resolve(sharpPath);
        if (require.cache[sharpCacheKey]) {
          delete require.cache[sharpCacheKey];
        }
        sharp = require(sharpPath);
      } finally {
        process.chdir(originalCwd);
      }
    } else {
      // Development mode
      sharp = require('sharp');
    }

    // Test Sharp
    const isWorking = await testSharp(sharp);

    sharpCache.instance = sharp;
    sharpCache.isWorking = isWorking;
    sharpCache.tested = true;

    if (isWorking) {
      console.log('[ImageProcessor] ✅ Sharp initialized and tested successfully (FAST mode enabled)');
    } else {
      console.log('[ImageProcessor] ⚠️ Sharp test failed, will use Jimp fallback (SLOW mode)');
    }

  } catch (error) {
    console.log('[ImageProcessor] ⚠️ Sharp initialization failed:', error instanceof Error ? error.message : String(error));
    sharpCache.tested = true;
    sharpCache.isWorking = false;
    sharpCache.instance = null;
  }
}

/**
 * Implementazione Jimp per il resize delle immagini
 */
class JimpProcessor implements ImageProcessor {
  private jimp: any;
  private jimpInstance: any;
  private input: string | Buffer;
  private resizeOptions?: { width: number; height: number; options?: any };
  private jpegOptions?: any;
  private rotationAngle?: number;

  constructor(input: string | Buffer) {
    try {
      // Jimp 1.x può essere importato come default export o named export
      this.jimp = require('jimp');
      // Se è un default export, accedi alla proprietà default
      if (this.jimp.default) {
        this.jimp = this.jimp.default;
      }
      // Se non ha read come metodo statico, potrebbe essere un'istanza
      if (!this.jimp.read && this.jimp.Jimp) {
        this.jimp = this.jimp.Jimp;
      }

      // Configura il limite di memoria per jpeg-js (libreria sottostante usata da Jimp)
      this.configureJpegJsMemoryLimit();

      // Aumenta il limite di memoria globalmente per tutte le operazioni Jimp
      if (this.jimp.limit) {
        this.jimp.limit.maxMemoryUsageInMB = 1024;
      }
    } catch (error) {
      console.error('[JimpProcessor] Jimp import failed:', error);
      throw new Error('Jimp not available');
    }
    this.jimpInstance = null;
    this.input = input;
  }

  /**
   * Configura il limite di memoria per jpeg-js (libreria usata da Jimp per decodificare JPEG)
   */
  private configureJpegJsMemoryLimit(): void {
    try {
      // Accedi al decoder jpeg-js usato da Jimp
      const jpegJs = require('jpeg-js');
      if (jpegJs && jpegJs.decode) {
        // Sovrascrivi la funzione decode originale con una versione che imposta il limite
        const originalDecode = jpegJs.decode;
        jpegJs.decode = function(jpegData: any, options: any = {}) {
          // Imposta un limite di memoria molto alto per immagini ad alta risoluzione
          options.maxMemoryUsageInMB = options.maxMemoryUsageInMB || 1024;
          return originalDecode(jpegData, options);
        };
      }
    } catch (error) {
      // Silently ignore - jpeg-js configuration is optional
    }
  }

  private async initializeJimp(input: string | Buffer) {
    try {
      // Nuova API di Jimp: usare Jimp.read() per file/buffer
      if (typeof input === 'string') {
        // Check if it's a file path or buffer
        if (input.startsWith('/') || input.startsWith('C:\\') || input.includes(':\\')) {
          this.jimpInstance = await this.jimp.read(input);
        } else {
          // Might be base64 or other format
          this.jimpInstance = await this.jimp.read(Buffer.from(input));
        }
      } else if (Buffer.isBuffer(input)) {
        // Try both methods for compatibility
        if (this.jimp.fromBuffer) {
          this.jimpInstance = await this.jimp.fromBuffer(input);
        } else {
          this.jimpInstance = await this.jimp.read(input);
        }
      } else {
        throw new Error('Invalid input type for Jimp');
      }

    } catch (error) {
      console.error('[JimpProcessor] Failed to initialize:', error);

      // Se fallisce con errore di memoria, prova con una strategia alternativa
      if (error instanceof Error && error.message && error.message.includes('maxMemoryUsageInMB limit exceeded')) {
        // Try to increase the limit even more
        try {
          const jpegJs = require('jpeg-js');
          if (jpegJs && jpegJs.decode) {
            const originalDecode = jpegJs.decode;
            jpegJs.decode = function(jpegData: any, options: any = {}) {
              options.maxMemoryUsageInMB = 2048; // Double the limit
              return originalDecode(jpegData, options);
            };
          }
          // Retry with increased limit
          if (typeof input === 'string') {
            this.jimpInstance = await this.jimp.read(input);
          } else if (Buffer.isBuffer(input)) {
            this.jimpInstance = await this.jimp.read(input);
          }
          return;
        } catch (retryError) {
          console.error('[JimpProcessor] Retry also failed:', retryError);
          throw new Error('Image too large for processing - consider using a smaller image or different format');
        }
      }

      throw error;
    }
  }

  resize(width: number, height: number, options?: any): ImageProcessor {
    // Il resize viene applicato quando toBuffer() viene chiamato
    this.resizeOptions = { width, height, options };
    return this;
  }

  rotate(angle?: number): ImageProcessor {
    this.rotationAngle = angle;
    return this;
  }

  jpeg(options?: any): ImageProcessor {
    this.jpegOptions = options;
    return this;
  }

  png(options?: any): ImageProcessor {
    // Jimp gestisce PNG automaticamente
    return this;
  }

  webp(options?: any): ImageProcessor {
    // Jimp non supporta WebP nativamente, manteniamo il formato originale
    return this;
  }

  async toBuffer(): Promise<Buffer> {
    if (!this.jimpInstance) {
      await this.initializeJimp(this.input);
    }

    // Applica rotazione se specificata o automatica basata su EXIF
    if (this.rotationAngle !== undefined) {
      if (this.rotationAngle !== undefined && this.rotationAngle !== 0) {
        // Rotazione manuale
        this.jimpInstance.rotate(this.rotationAngle);
      }
    }

    // Applica resize se specificato
    if (this.resizeOptions) {
      const { width, height, options } = this.resizeOptions;
      if (options?.fit === 'inside' || options?.withoutEnlargement) {
        // Nuova API: usa scaleToFit con oggetto parametri
        this.jimpInstance.scaleToFit({ w: width, h: height });
      } else {
        // Nuova API: resize con oggetto parametri
        this.jimpInstance.resize({ w: width, h: height });
      }
    }

    // Nuova API di Jimp: getBuffer con mime type e opzioni per qualità
    try {
      const options = this.jpegOptions?.quality ? { quality: this.jpegOptions.quality } : {};
      const buffer = await this.jimpInstance.getBuffer("image/jpeg", options);
      return buffer;
    } catch (error) {
      console.error('[JimpProcessor] Failed to get buffer:', error);
      throw error;
    }
  }

  async metadata(): Promise<{ width?: number; height?: number; format?: string }> {
    if (!this.jimpInstance) {
      await this.initializeJimp(this.input);
    }

    // Nuova API di Jimp: usa proprietà width e height direttamente
    return {
      width: this.jimpInstance.width || 0,
      height: this.jimpInstance.height || 0,
      format: 'jpeg'
    };
  }
}

/**
 * Wrapper per Sharp che implementa la stessa interfaccia
 */
class SharpProcessor implements ImageProcessor {
  private sharpInstance: any;

  constructor(private sharp: any, input: string | Buffer) {
    this.sharpInstance = sharp(input);
  }

  resize(width: number, height: number, options?: any): ImageProcessor {
    this.sharpInstance = this.sharpInstance.resize(width, height, options);
    return this;
  }

  rotate(angle?: number): ImageProcessor {
    // Sharp auto-rotate basato su EXIF se nessun angolo specificato
    this.sharpInstance = this.sharpInstance.rotate(angle);
    return this;
  }

  jpeg(options?: any): ImageProcessor {
    this.sharpInstance = this.sharpInstance.jpeg(options);
    return this;
  }

  png(options?: any): ImageProcessor {
    this.sharpInstance = this.sharpInstance.png(options);
    return this;
  }

  webp(options?: any): ImageProcessor {
    this.sharpInstance = this.sharpInstance.webp(options);
    return this;
  }

  async toBuffer(): Promise<Buffer> {
    return this.sharpInstance.toBuffer();
  }

  async metadata(): Promise<{ width?: number; height?: number; format?: string }> {
    return this.sharpInstance.metadata();
  }
}

/**
 * Testa se Sharp è realmente funzionante
 */
async function testSharp(sharp: any): Promise<boolean> {
  try {
    // Test con immagine generata (più affidabile del buffer JPEG statico)
    const testBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    }).png().toBuffer();

    // Test metadata e resize con nuove istanze
    await sharp(testBuffer).metadata();
    await sharp(testBuffer).resize(5, 5).jpeg({ quality: 80 }).toBuffer();

    return true;
  } catch (error) {
    console.log('[ImageProcessor] Sharp test failed with error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Debug function per diagnosticare problemi con Sharp
 */
export function debugSharp(): void {
  try {
    const { app } = require('electron');
    const path = require('path');
    const fs = require('fs');

    const unpackedPath = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
    const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');

    // Test caricamento
    try {
      const sharp = require(sharpPath);
    } catch (error) {
      console.error('[ImageProcessor] Sharp loading failed:', (error as Error).message);
    }
  } catch (error) {
    console.error('[ImageProcessor] Debug function failed:', (error as Error).message);
  }
}

/**
 * Factory per creare un image processor (Sharp o Jimp)
 * Usa la cache globale per evitare test ripetuti
 */
export async function createImageProcessor(input: string | Buffer): Promise<ImageProcessor> {
  // Inizializza se non ancora fatto (fallback per chiamate prima dell'init)
  if (!sharpCache.tested) {
    await initializeImageProcessor();
  }

  // Usa Sharp dalla cache se disponibile e funzionante
  if (sharpCache.isWorking && sharpCache.instance) {
    try {
      return new SharpProcessor(sharpCache.instance, input);
    } catch (error) {
      console.log('[ImageProcessor] ⚠️ Sharp processor creation failed, falling back to Jimp');
      // Fall through to Jimp
    }
  }

  // Fallback a Jimp
  try {
    const processor = new JimpProcessor(input);
    return processor;
  } catch (error) {
    // Try one more time with a fresh require
    try {
      delete require.cache[require.resolve('jimp')];
      const processor = new JimpProcessor(input);
      return processor;
    } catch (retryError) {
      console.error('[ImageProcessor] Neither Sharp nor Jimp are available');
      throw new Error('Neither Sharp nor Jimp are available for image processing');
    }
  }
}

/**
 * Funzione di compatibilità con il codice esistente
 * @deprecated Usa createImageProcessor invece
 */
export function getSharp() {
  // Restituisce una funzione che crea un processor
  return function(input: string | Buffer) {
    // Restituisce un oggetto che assomiglia all'API di Sharp
    return {
      resize: (width: number, height: number, options?: any) => {
        // Placeholder che verrà sostituito dal vero processor
        return {
          jpeg: (opts?: any) => ({
            toBuffer: async () => {
              const processor = await createImageProcessor(input);
              return processor.resize(width, height, options).jpeg(opts).toBuffer();
            }
          })
        };
      },
      metadata: async () => {
        const processor = await createImageProcessor(input);
        return processor.metadata();
      }
    };
  };
}

/**
 * Importa in modo sicuro un modulo nativo, fornendo un'implementazione mock
 * se l'importazione fallisce.
 *
 * @deprecated Usa il sistema ibrido invece
 */
export function safeRequire<T>(moduleName: string, mockImplementation: T): T {
  try {
    const module = require(moduleName);
    return module;
  } catch (error) {
    console.error(`[NativeModules] Failed to import module '${moduleName}':`, error);
    return mockImplementation;
  }
}
