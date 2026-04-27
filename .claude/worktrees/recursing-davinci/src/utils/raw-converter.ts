/**
 * Temp file management for RaceTagger processing pipeline.
 *
 * NOTE: dcraw/ImageMagick/DNG conversion code removed in v1.2.0.
 * RAW processing now uses raw-preview-extractor (native) + ExifTool fallback.
 * This module only retains temp directory cleanup utilities.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';

export class RawConverter {
  private tempDngDirectory: string;

  constructor() {
    this.tempDngDirectory = path.join(os.homedir(), '.racetagger-temp', 'dng-processing');
    this.ensureTempDirectory();
  }

  private ensureTempDirectory(): void {
    try {
      if (!fs.existsSync(this.tempDngDirectory)) {
        fs.mkdirSync(this.tempDngDirectory, { recursive: true });
      }
    } catch (error: any) {
      console.error('[RawConverter] Error creating temp directory:', error);
      this.tempDngDirectory = os.tmpdir();
    }
  }

  getTempDngDirectory(): string {
    return this.tempDngDirectory;
  }

  async cleanupTempDng(dngPath: string): Promise<void> {
    try {
      if (fs.existsSync(dngPath) && dngPath.startsWith(this.tempDngDirectory)) {
        await fsPromises.unlink(dngPath);
      }
    } catch (error: any) {
      // Silently ignore cleanup errors
    }
  }

  async cleanupOldTempDngs(olderThanMinutes: number = 60): Promise<void> {
    try {
      if (!fs.existsSync(this.tempDngDirectory)) return;

      const files = await fsPromises.readdir(this.tempDngDirectory);
      const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(this.tempDngDirectory, file);
        try {
          const stat = await fsPromises.stat(filePath);
          if (stat.mtime.getTime() < cutoffTime) {
            await fsPromises.unlink(filePath);
          }
        } catch (error) {
          // File may have been deleted already
        }
      }
    } catch (error: any) {
      console.error('[RawConverter] Error during temp cleanup:', error);
    }
  }

  async cleanupAllTempFiles(): Promise<void> {
    try {
      if (!fs.existsSync(this.tempDngDirectory)) {
        return;
      }

      const files = await fsPromises.readdir(this.tempDngDirectory);

      for (const file of files) {
        const filePath = path.join(this.tempDngDirectory, file);
        try {
          const stat = await fsPromises.stat(filePath);
          if (stat.isFile()) {
            await fsPromises.unlink(filePath);
          }
        } catch (error: any) {
          // Silently ignore individual file cleanup errors
        }
      }
    } catch (error: any) {
      console.error('[RawConverter] Error during complete temp files cleanup:', error);
    }
  }
}

export const rawConverter = new RawConverter();
