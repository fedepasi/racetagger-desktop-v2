/**
 * Image Processing Module (v1.2.0)
 *
 * Uses Sharp exclusively for all image processing.
 * No fallback — if Sharp fails, the error is propagated clearly.
 */

import * as fs from 'fs';

// Unified interface for image processing
export interface ImageProcessor {
  resize(width: number, height: number, options?: any): ImageProcessor;
  rotate(angle?: number): ImageProcessor;
  jpeg(options?: any): ImageProcessor;
  png(options?: any): ImageProcessor;
  webp(options?: any): ImageProcessor;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
}

// ============================================================================
// GLOBAL CACHE to avoid repeated tests
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
 * Initialize and test Sharp ONCE at application startup.
 * Must be called from main.ts during startup.
 */
export async function initializeImageProcessor(): Promise<void> {
  if (sharpCache.tested) {
    return;
  }

  try {
    const { app } = require('electron');
    const isPackaged = app?.isPackaged || false;

    let sharp: any;

    if (isPackaged) {
      const path = require('path');
      const fs = require('fs');
      const platform = process.platform;
      const arch = process.arch;

      const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
      const sharpPath = path.join(unpackedPath, 'sharp');

      if (!fs.existsSync(sharpPath)) {
        throw new Error(`Sharp not found at ${sharpPath}`);
      }

      // Cross-platform: detect correct @img package
      const sharpPlatformPkg = `sharp-${platform}-${arch}`;
      const sharpPlatformPath = path.join(unpackedPath, '@img', sharpPlatformPkg);
      const sharpPlatformLibDir = path.join(sharpPlatformPath, 'lib');
      const binaryPath = path.join(sharpPlatformLibDir, `sharp-${platform}-${arch}.node`);

      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Sharp native binary not found at ${binaryPath} (platform: ${platform}, arch: ${arch})`);
      }

      // Find libvips DLL/dylib/so
      // Sharp 0.34+: libvips is bundled INSIDE @img/sharp-{platform}-{arch}/lib/
      // Sharp <0.34: libvips is in a separate @img/sharp-libvips-{platform}-{arch}/lib/
      let libvipsDir: string | null = null;
      let libvipsPath: string | null = null;
      let libvipsPkg = sharpPlatformPkg; // default: same package

      const findLibvipsIn = (dir: string): string | null => {
        if (!fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir);
        let libvipsFile: string | undefined;
        if (platform === 'darwin') {
          libvipsFile = files.find((f: string) => f.startsWith('libvips-cpp.') && f.endsWith('.dylib'));
        } else if (platform === 'win32') {
          libvipsFile = files.find((f: string) => f === 'libvips-cpp.dll' || (f.startsWith('libvips') && f.endsWith('.dll')));
        } else {
          libvipsFile = files.find((f: string) => f.startsWith('libvips-cpp.so'));
        }
        return libvipsFile ? path.join(dir, libvipsFile) : null;
      };

      // Strategy 1: Check inside sharp platform package (Sharp 0.34+ bundled layout)
      libvipsPath = findLibvipsIn(sharpPlatformLibDir);
      if (libvipsPath) {
        libvipsDir = sharpPlatformLibDir;
        libvipsPkg = sharpPlatformPkg;
      }

      // Strategy 2: Check separate libvips package (Sharp <0.34 layout)
      if (!libvipsPath) {
        const separateLibvipsPkg = `sharp-libvips-${platform}-${arch}`;
        const separateLibvipsDir = path.join(unpackedPath, '@img', separateLibvipsPkg, 'lib');
        libvipsPath = findLibvipsIn(separateLibvipsDir);
        if (libvipsPath) {
          libvipsDir = separateLibvipsDir;
          libvipsPkg = separateLibvipsPkg;
        }
      }

      if (!libvipsDir || !libvipsPath) {
        throw new Error(`Sharp libvips not found in ${sharpPlatformLibDir} or @img/sharp-libvips-${platform}-${arch}/lib (platform: ${platform}, arch: ${arch})`);
      }

      // Platform-specific library path setup
      if (platform === 'darwin') {
        process.env.DYLD_LIBRARY_PATH = `${libvipsDir}:${process.env.DYLD_LIBRARY_PATH || ''}`;
      } else if (platform === 'linux') {
        process.env.LD_LIBRARY_PATH = `${libvipsDir}:${process.env.LD_LIBRARY_PATH || ''}`;
      } else if (platform === 'win32') {
        process.env.PATH = `${libvipsDir};${process.env.PATH || ''}`;
      }

      console.log(`[ImageProcessor] Sharp binary: ${sharpPlatformPkg}, libvips: ${libvipsPkg} (dir: ${libvipsDir})`);

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

    if (!isWorking) {
      throw new Error('Sharp loaded but functional test failed');
    }

    sharpCache.instance = sharp;
    sharpCache.isWorking = true;
    sharpCache.tested = true;

    console.log('[ImageProcessor] ✅ Sharp initialized and tested successfully');

  } catch (error) {
    sharpCache.tested = true;
    sharpCache.isWorking = false;
    sharpCache.instance = null;

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ImageProcessor] ❌ Sharp initialization FAILED: ${message}`);
    console.error('[ImageProcessor] Image processing will not be available. Please reinstall the application.');
  }
}

/**
 * Sharp wrapper implementing the ImageProcessor interface
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
 * Test that Sharp is actually working
 */
async function testSharp(sharp: any): Promise<boolean> {
  try {
    const testBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    }).png().toBuffer();

    await sharp(testBuffer).metadata();
    await sharp(testBuffer).resize(5, 5).jpeg({ quality: 80 }).toBuffer();

    return true;
  } catch (error) {
    console.log('[ImageProcessor] Sharp test failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Debug function for diagnosing Sharp issues
 */
export function debugSharp(): void {
  try {
    const { app } = require('electron');
    const path = require('path');

    const unpackedPath = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
    const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');

    try {
      require(sharpPath);
      console.log('[ImageProcessor] Sharp loaded successfully from:', sharpPath);
    } catch (error) {
      console.error('[ImageProcessor] Sharp loading failed:', (error as Error).message);
    }
  } catch (error) {
    console.error('[ImageProcessor] Debug function failed:', (error as Error).message);
  }
}

/**
 * Factory to create an image processor (Sharp only).
 * Throws a clear error if Sharp is not available.
 */
export async function createImageProcessor(input: string | Buffer): Promise<ImageProcessor> {
  // Initialize if not done yet
  if (!sharpCache.tested) {
    await initializeImageProcessor();
  }

  if (sharpCache.isWorking && sharpCache.instance) {
    return new SharpProcessor(sharpCache.instance, input);
  }

  throw new Error(
    'Sharp is not available for image processing. ' +
    'This is required for RaceTagger to function. ' +
    'Please reinstall the application or contact support.'
  );
}

/**
 * Legacy compatibility wrapper.
 * @deprecated Use createImageProcessor instead
 */
export function getSharp() {
  return function(input: string | Buffer) {
    return {
      resize: (width: number, height: number, options?: any) => {
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
 * @deprecated Use the hybrid system instead
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
