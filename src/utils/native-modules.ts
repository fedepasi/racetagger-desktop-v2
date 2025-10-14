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
    console.log('[ImageProcessor] Configured global jpeg-js memory limit to 1024MB');
  }
} catch (error) {
  console.warn('[ImageProcessor] Could not configure global jpeg-js memory limit:', error);
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
        console.log('[JimpProcessor] Set global Jimp memory limit to 1024MB');
      }
      
      console.log('[JimpProcessor] Jimp module loaded, methods available:', Object.getOwnPropertyNames(this.jimp));
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
        console.log('[JimpProcessor] Configured jpeg-js memory limit to 1024MB');
      }
    } catch (error) {
      console.warn('[JimpProcessor] Could not configure jpeg-js memory limit:', error);
    }
  }

  private async initializeJimp(input: string | Buffer) {
    try {
      console.log('[JimpProcessor] Initializing Jimp with new API...');
      
      // Nuova API di Jimp: usare Jimp.read() per file/buffer
      if (typeof input === 'string') {
        console.log(`[JimpProcessor] Reading image from file: ${input}`);
        // Check if it's a file path or buffer
        if (input.startsWith('/') || input.startsWith('C:\\') || input.includes(':\\')) {
          this.jimpInstance = await this.jimp.read(input);
        } else {
          // Might be base64 or other format
          this.jimpInstance = await this.jimp.read(Buffer.from(input));
        }
      } else if (Buffer.isBuffer(input)) {
        console.log('[JimpProcessor] Reading image from buffer');
        // Try both methods for compatibility
        if (this.jimp.fromBuffer) {
          this.jimpInstance = await this.jimp.fromBuffer(input);
        } else {
          this.jimpInstance = await this.jimp.read(input);
        }
      } else {
        throw new Error('Invalid input type for Jimp');
      }
      
      console.log(`[JimpProcessor] Successfully initialized Jimp instance (${this.jimpInstance.width}x${this.jimpInstance.height})`);
      
    } catch (error) {
      console.error('[JimpProcessor] Failed to initialize:', error);
      
      // Se fallisce con errore di memoria, prova con una strategia alternativa
      if (error instanceof Error && error.message && error.message.includes('maxMemoryUsageInMB limit exceeded')) {
        console.log('[JimpProcessor] Memory limit exceeded, increasing limit and retrying...');
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
          console.log('[JimpProcessor] Retry with increased memory limit successful');
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
      if (this.rotationAngle === undefined || this.rotationAngle === 0) {
        // Auto-rotazione basata su EXIF quando nessun angolo è specificato
        // Jimp non ha auto-rotate EXIF built-in, ma legge l'orientamento automaticamente
        console.log('[JimpProcessor] Auto-rotation based on EXIF (handled by Jimp automatically)');
      } else {
        // Rotazione manuale
        this.jimpInstance.rotate(this.rotationAngle);
        console.log(`[JimpProcessor] Applied manual rotation: ${this.rotationAngle} degrees`);
      }
    }
    
    // Applica resize se specificato
    if (this.resizeOptions) {
      const { width, height, options } = this.resizeOptions;
      if (options?.fit === 'inside' || options?.withoutEnlargement) {
        // Nuova API: usa scaleToFit con oggetto parametri
        this.jimpInstance.scaleToFit({ w: width, h: height });
        console.log(`[JimpProcessor] Applied scaleToFit to ${width}x${height}`);
      } else {
        // Nuova API: resize con oggetto parametri
        this.jimpInstance.resize({ w: width, h: height });
        console.log(`[JimpProcessor] Applied resize to ${width}x${height}`);
      }
    }
    
    // Nuova API di Jimp: getBuffer con mime type e opzioni per qualità
    try {
      console.log('[JimpProcessor] Converting to buffer...');
      
      const options = this.jpegOptions?.quality ? { quality: this.jpegOptions.quality } : {};
      const buffer = await this.jimpInstance.getBuffer("image/jpeg", options);
      
      console.log(`[JimpProcessor] Buffer created successfully: ${buffer.length} bytes`);
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
    safeLog('info', '[ImageProcessor] Testing Sharp functionality...');
    // Minimal valid JPEG buffer (1x1 pixel)
    const testBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
      0x00, 0x10, 0x0B, 0x0C, 0x0E, 0x0C, 0x0A, 0x10, 0x0E, 0x0D, 0x0E, 0x12,
      0x11, 0x10, 0x13, 0x18, 0x28, 0x1A, 0x18, 0x16, 0x16, 0x18, 0x31, 0x23,
      0x25, 0x1D, 0x28, 0x3A, 0x33, 0x3D, 0x3C, 0x39, 0x33, 0x38, 0x37, 0x40,
      0x48, 0x5C, 0x4E, 0x40, 0x44, 0x57, 0x45, 0x37, 0x38, 0x50, 0x6D, 0x51,
      0x57, 0x5F, 0x62, 0x67, 0x68, 0x67, 0x3E, 0x4D, 0x71, 0x79, 0x70, 0x64,
      0x78, 0x5C, 0x65, 0x67, 0x63, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
      0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
      0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00,
      0xB5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05,
      0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11,
      0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71,
      0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52,
      0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18,
      0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
      0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53,
      0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67,
      0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83,
      0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96,
      0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9,
      0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
      0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6,
      0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8,
      0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
      0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00,
      0x3F, 0x00, 0xAA, 0xFF, 0xD9
    ]);
    
    const instance = sharp(testBuffer);
    safeLog('info', '[ImageProcessor] Sharp instance created, testing metadata...');
    await instance.metadata();
    safeLog('info', '[ImageProcessor] Metadata test passed, testing resize...');
    await instance.resize(10, 10).jpeg({ quality: 80 }).toBuffer();
    
    safeLog('success', '[ImageProcessor] Sharp test passed - Sharp is working!');
    return true;
  } catch (error) {
    safeLog('error', `[ImageProcessor] Sharp test failed: ${(error as Error).message}`);
    safeLog('error', `[ImageProcessor] Sharp test error stack: ${(error as Error).stack}`);
    return false;
  }
}

/**
 * Safe logging function that works in both main and renderer processes
 */
function safeLog(level: string, message: string) {
  // Standard console logging
  console.log(message);
  
  // Try to send to renderer via IPC if available
  try {
    const global = (globalThis as any);
    if (global.sendSharpLogToRenderer && typeof global.sendSharpLogToRenderer === 'function') {
      global.sendSharpLogToRenderer(level, message);
    }
  } catch (error) {
    // Silently ignore IPC errors - we still have console logging
  }
}

/**
 * Debug function per diagnosticare problemi con Sharp
 */
export function debugSharp(): void {
  try {
    const { app } = require('electron');
    
    console.log('=== SHARP DEBUG INFO ===');
    console.log('App path:', app.getAppPath());
    console.log('Is packaged:', app.isPackaged);
    console.log('Platform:', process.platform);
    console.log('Architecture:', process.arch);
    console.log('__dirname:', __dirname);
    console.log('process.resourcesPath:', process.resourcesPath);
    
    // Verifica percorsi
    const path = require('path');
    const fs = require('fs');
    const unpackedPath = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
    const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');
    
    console.log('Unpacked path:', unpackedPath);
    console.log('Sharp path:', sharpPath);
    console.log('Sharp path exists:', fs.existsSync(sharpPath));
    
    if (fs.existsSync(sharpPath)) {
      const buildPath = path.join(sharpPath, 'build', 'Release');
      const vendorPath = path.join(sharpPath, 'vendor');
      
      console.log('Build path exists:', fs.existsSync(buildPath));
      if (fs.existsSync(buildPath)) {
        console.log('Build files:', fs.readdirSync(buildPath));
      }
      
      console.log('Vendor path exists:', fs.existsSync(vendorPath));
      if (fs.existsSync(vendorPath)) {
        console.log('Vendor files:', fs.readdirSync(vendorPath));
      }
      
      // Controlla i binari @img
      const imgPath = path.join(unpackedPath, 'node_modules', '@img');
      if (fs.existsSync(imgPath)) {
        console.log('IMG modules:', fs.readdirSync(imgPath));
        
        const darwinArm64Path = path.join(imgPath, 'sharp-darwin-arm64');
        if (fs.existsSync(darwinArm64Path)) {
          console.log('Darwin ARM64 contents:', fs.readdirSync(darwinArm64Path));
          
          const libPath = path.join(darwinArm64Path, 'lib');
          if (fs.existsSync(libPath)) {
            console.log('Lib contents:', fs.readdirSync(libPath));
          }
        }
      }
    }
    
    // Test caricamento
    try {
      const sharp = require(sharpPath);
      console.log('✅ Sharp loaded successfully');
      if (sharp.versions) {
        console.log('Sharp versions:', sharp.versions);
      }
    } catch (error) {
      console.error('❌ Sharp loading failed:', (error as Error).message);
      console.error('Stack:', (error as Error).stack);
    }
  } catch (error) {
    console.error('Debug function failed:', (error as Error).message);
  }
}

/**
 * Factory per creare un image processor (Sharp o Jimp)
 */
export async function createImageProcessor(input: string | Buffer): Promise<ImageProcessor> {
  // Check if we should force Jimp for stability
  const forceJimp = process.env.FORCE_JIMP_FALLBACK === 'true';
  
  if (forceJimp) {
    safeLog('info', '[ImageProcessor] FORCE_JIMP_FALLBACK enabled, skipping Sharp');
  } else {
    // Prova prima Sharp
    try {
      safeLog('info', '[ImageProcessor] Starting Sharp loading process...');
      
      // Determina se siamo in un'app pacchettizzata
      const { app } = require('electron');
      const isPackaged = app?.isPackaged || false;
      safeLog('info', `[ImageProcessor] App is packaged: ${isPackaged}`);
      
      let sharp: any;
      if (isPackaged) {
      // In produzione, Sharp è in app.asar.unpacked
      const path = require('path');
      const fs = require('fs');
      
      const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
      const sharpPath = path.join(unpackedPath, 'sharp');
      
      safeLog('info', `[ImageProcessor] Loading Sharp from packaged path: ${sharpPath}`);
      safeLog('info', `[ImageProcessor] Unpacked modules path: ${unpackedPath}`);
      
      // Verifica che Sharp esista
      if (!fs.existsSync(sharpPath)) {
        throw new Error(`Sharp not found at ${sharpPath}`);
      }
      
      // Verifica che i binari nativi esistano
      const darwinArm64Path = path.join(unpackedPath, '@img', 'sharp-darwin-arm64');
      const binaryPath = path.join(darwinArm64Path, 'lib', 'sharp-darwin-arm64.node');

      // Trova dinamicamente la versione di libvips
      const libvipsDir = path.join(unpackedPath, '@img', 'sharp-libvips-darwin-arm64', 'lib');
      let libvipsPath: string | null = null;

      if (fs.existsSync(libvipsDir)) {
        const files = fs.readdirSync(libvipsDir);
        const libvipsFile = files.find((f: string) => f.startsWith('libvips-cpp.') && f.endsWith('.dylib'));
        if (libvipsFile) {
          libvipsPath = path.join(libvipsDir, libvipsFile);
          safeLog('info', `[ImageProcessor] Found libvips: ${libvipsFile}`);
        }
      }

      safeLog('info', `[ImageProcessor] Checking for native binary at: ${binaryPath}`);
      safeLog('info', `[ImageProcessor] Checking for libvips at: ${libvipsPath || 'NOT FOUND'}`);

      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Sharp native binary not found at ${binaryPath}`);
      }

      if (!libvipsPath || !fs.existsSync(libvipsPath)) {
        throw new Error(`Sharp libvips not found in: ${libvipsDir}`);
      }
      
      // Crea il symlink mancante per sharp.node se non esiste
      const symlinkPath = path.join(darwinArm64Path, 'sharp.node');
      if (!fs.existsSync(symlinkPath)) {
        try {
          safeLog('info', `[ImageProcessor] Creating symlink from ${binaryPath} to ${symlinkPath}`);
          fs.symlinkSync('./lib/sharp-darwin-arm64.node', symlinkPath);
          safeLog('success', '[ImageProcessor] Symlink created successfully');
        } catch (symlinkError: any) {
          safeLog('warn', `[ImageProcessor] Could not create symlink: ${symlinkError.message}, trying copy instead`);
          try {
            fs.copyFileSync(binaryPath, symlinkPath);
            safeLog('success', '[ImageProcessor] Binary copied successfully');
          } catch (copyError: any) {
            safeLog('error', `[ImageProcessor] Could not copy binary: ${copyError.message}`);
          }
        }
      }
      
      // Verifica se esiste un file di configurazione creato dallo script post-build
      const configPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'sharp-config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          safeLog('info', `[ImageProcessor] Found Sharp config: verified=${config.verified}, timestamp=${config.timestamp}`);
          if (!config.verified) {
            safeLog('warn', '[ImageProcessor] Sharp config indicates potential issues');
          }
        } catch (configError) {
          safeLog('warn', `[ImageProcessor] Could not read Sharp config: ${configError}`);
        }
      }
      
      // Configura l'ambiente per Sharp con impostazioni ottimizzate per produzione
      safeLog('info', '[ImageProcessor] Setting Sharp environment variables for production');
      process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
      process.env.SHARP_FORCE_GLOBAL_LIBVIPS = '0';
      process.env.SHARP_VENDOR_LIBVIPS_PATH = path.join(unpackedPath, '@img', 'sharp-libvips-darwin-arm64', 'lib');
      process.env.SHARP_VENDOR_PATH = path.join(unpackedPath, '@img', 'sharp-darwin-arm64', 'lib');
      
      // Su macOS, configura i percorsi delle librerie dinamiche
      if (process.platform === 'darwin') {
        const vendorPath = path.join(sharpPath, 'vendor');
        const libPath = path.join(vendorPath, 'lib');
        const imgLibPath = path.join(darwinArm64Path, 'lib');
        
        // Configura DYLD_LIBRARY_PATH con tutti i percorsi necessari
        const libraryPaths = [libPath, imgLibPath, vendorPath].filter(p => fs.existsSync(p));
        if (libraryPaths.length > 0) {
          process.env.DYLD_LIBRARY_PATH = libraryPaths.join(':');
          safeLog('info', `[ImageProcessor] Set DYLD_LIBRARY_PATH to: ${process.env.DYLD_LIBRARY_PATH}`);
        }
        
        // Verifica che le librerie .dylib esistano
        if (fs.existsSync(libPath)) {
          const dylibFiles = fs.readdirSync(libPath).filter((f: string) => f.endsWith('.dylib'));
          safeLog('info', `[ImageProcessor] Found ${dylibFiles.length} .dylib files in vendor/lib: ${dylibFiles.join(', ')}`);
        }
        if (fs.existsSync(imgLibPath)) {
          const imgDylibFiles = fs.readdirSync(imgLibPath).filter((f: string) => f.endsWith('.dylib'));
          safeLog('info', `[ImageProcessor] Found ${imgDylibFiles.length} .dylib files in @img/sharp-darwin-arm64/lib: ${imgDylibFiles.join(', ')}`);
        }
      }
      
      // Cambia temporaneamente la directory di lavoro per aiutare la risoluzione dei moduli
      const originalCwd = process.cwd();
      try {
        process.chdir(path.join(process.resourcesPath, 'app.asar.unpacked'));
        safeLog('info', `[ImageProcessor] Changed working directory to: ${process.cwd()}`);
        
        // Pulisce la cache dei require per Sharp
        const sharpCacheKey = require.resolve(sharpPath);
        if (require.cache[sharpCacheKey]) {
          delete require.cache[sharpCacheKey];
          safeLog('info', '[ImageProcessor] Cleared Sharp from require cache');
        }
        
        // Carica Sharp
        sharp = require(sharpPath);
        safeLog('success', '[ImageProcessor] Sharp loaded successfully from packaged location');
        
      } finally {
        // Ripristina la directory di lavoro
        process.chdir(originalCwd);
        safeLog('info', `[ImageProcessor] Restored working directory to: ${process.cwd()}`);
      }
    } else {
      // In sviluppo, usa il percorso normale
      safeLog('info', '[ImageProcessor] Loading Sharp from development path');
      sharp = require('sharp');
    }
    
    safeLog('info', '[ImageProcessor] Sharp module loaded successfully, testing functionality...');
    
    const isSharpWorking = await testSharp(sharp);
    if (isSharpWorking) {
      safeLog('success', '[ImageProcessor] Sharp test passed, using Sharp (high performance)');
      return new SharpProcessor(sharp, input);
    } else {
      safeLog('warn', '[ImageProcessor] Sharp test failed but module loaded successfully');
      safeLog('info', '[ImageProcessor] Attempting to use Sharp anyway - may work with actual image data');
      try {
        // Try to create a Sharp processor with the actual input
        const processor = new SharpProcessor(sharp, input);
        safeLog('success', '[ImageProcessor] Using Sharp despite test failure (high performance)');
        return processor;
      } catch (processorError) {
        safeLog('error', `[ImageProcessor] Sharp processor creation failed: ${(processorError as Error).message}`);
      }
    }
  } catch (error) {
    safeLog('error', `[ImageProcessor] Sharp not available: ${(error as Error).message}`);
    safeLog('warn', '[ImageProcessor] Will attempt Jimp fallback for stability');
  }
  } // Close the else block for forceJimp check

  // Fallback a Jimp
  safeLog('info', '[ImageProcessor] Using Jimp fallback (pure JavaScript)');
  try {
    const processor = new JimpProcessor(input);
    // Don't test metadata here as it may fail for some inputs
    // The actual processing will handle errors appropriately
    safeLog('success', '[ImageProcessor] Jimp processor created successfully');
    return processor;
  } catch (error) {
    safeLog('error', `[ImageProcessor] Jimp initialization failed: ${error}`);
    // Try one more time with a fresh require
    try {
      delete require.cache[require.resolve('jimp')];
      safeLog('info', '[ImageProcessor] Retrying Jimp with fresh module load...');
      const processor = new JimpProcessor(input);
      return processor;
    } catch (retryError) {
      safeLog('error', `[ImageProcessor] Jimp retry also failed: ${retryError}`);
      throw new Error('Neither Sharp nor Jimp are available for image processing');
    }
  }
}

/**
 * Funzione di compatibilità con il codice esistente
 * @deprecated Usa createImageProcessor invece
 */
export function getSharp() {
  console.warn('[ImageProcessor] getSharp() is deprecated, use createImageProcessor() instead');
  
  // Restituisce una funzione che crea un processor
  return function(input: string | Buffer) {
    console.log('[ImageProcessor] Legacy Sharp call, redirecting to hybrid system');
    
    // Restituisce un oggetto che assomiglia all'API di Sharp
    return {
      resize: (width: number, height: number, options?: any) => {
        // Placeholder che verrà sostituito dal vero processor
        return {
          jpeg: (opts?: any) => ({
            toBuffer: async () => {
              console.log('[ImageProcessor] Creating processor for legacy call...');
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
    console.log(`[NativeModules] Module '${moduleName}' imported successfully`);
    return module;
  } catch (error) {
    console.error(`[NativeModules] Failed to import module '${moduleName}':`, error);
    console.warn(`[NativeModules] Using mock implementation for '${moduleName}'`);
    return mockImplementation;
  }
}