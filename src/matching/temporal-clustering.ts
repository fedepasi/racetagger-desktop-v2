/**
 * Temporal Clustering System for RaceTagger
 *
 * Handles image timestamp extraction and temporal proximity clustering
 * for improved participant matching accuracy through burst mode detection
 * and sequential photo analysis.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const execAsync = promisify(exec);

/**
 * Simple semaphore implementation to limit concurrent processes
 */
class SimpleSemaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.waitQueue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const nextResolve = this.waitQueue.shift();
      if (nextResolve) {
        nextResolve();
      }
    } else {
      this.permits++;
    }
  }
}

export interface ImageTimestamp {
  filePath: string;
  fileName: string;
  timestamp: Date | null; // null if no valid DateTimeOriginal
  timestampSource: 'exif' | 'excluded'; // 'excluded' if no DateTimeOriginal
  exifData?: {
    dateTimeOriginal?: string;
    createDate?: string;
    modifyDate?: string;
    subsecTimeOriginal?: string;
  };
  excludedReason?: string; // Why this image was excluded from clustering
}

export interface TemporalCluster {
  id: string;
  images: ImageTimestamp[];
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
  isBurstMode: boolean; // photos within 500ms = burst (configurable per sport)
  sport: string;
}

export interface TemporalConfig {
  motorsport: {
    clusterWindow: number; // milliseconds - default 3000ms (3 seconds)
    burstThreshold: number; // milliseconds - default 100ms
    proximityBonus: number; // score bonus for temporal neighbors
  };
  running: {
    clusterWindow: number;
    burstThreshold: number;
    proximityBonus: number;
  };
  cycling: {
    clusterWindow: number;
    burstThreshold: number;
    proximityBonus: number;
  };
  motocross: {
    clusterWindow: number;
    burstThreshold: number;
    proximityBonus: number;
  };
  generic: {
    clusterWindow: number;
    burstThreshold: number;
    proximityBonus: number;
  };
}

export class TemporalClusterManager {
  private config: TemporalConfig;
  private exiftoolPath: string;
  private clusters: Map<string, TemporalCluster[]> = new Map();
  private analysisLogger?: any; // Optional logger for detailed tracking
  private exiftoolSemaphore: SimpleSemaphore; // Limita i processi ExifTool concorrenti
  private batchProgressCallback?: (processed: number, total: number, currentBatch: number, totalBatches: number) => void;

  constructor(exiftoolPath?: string) {
    this.exiftoolPath = exiftoolPath || this.getExiftoolPath();
    this.config = this.getDefaultConfig();
    this.exiftoolSemaphore = new SimpleSemaphore(15); // Max 15 processi ExifTool concorrenti

    console.log('[TemporalClustering] Initialized with default config:', this.config);
    console.log('[TemporalClustering] Using exiftool path:', this.exiftoolPath);
    console.log('[TemporalClustering] ExifTool concurrency limit: 15 processes');
  }

  /**
   * Get the correct path for exiftool based on development/production environment and OS
   */
  private getExiftoolPath(): string {
    const path = require('path');

    // Detect operating system
    const platform = process.platform; // 'win32', 'darwin', 'linux'

    try {
      // Safely determine if we're in development mode
      let isDev = true;
      try {
        const { app } = require('electron');
        isDev = !app || !app.isPackaged;
      } catch {
        isDev = true;
      }

      let vendorDir: string;
      if (isDev) {
        // In development: from dist/matching/ to project root, then to vendor/
        vendorDir = path.join(__dirname, '../../../vendor', platform);
      } else {
        // In production: vendor files are unpacked from asar
        vendorDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', platform);
      }

      // Windows uses perl.exe + exiftool.pl, other platforms use exiftool directly
      if (platform === 'win32') {
        const perlExe = path.join(vendorDir, 'perl.exe');
        const exiftoolPl = path.join(vendorDir, 'exiftool.pl');
        return `"${perlExe}" "${exiftoolPl}"`;
      } else {
        return path.join(vendorDir, 'exiftool');
      }
    } catch {
      // Fallback for standalone testing
      const vendorDir = path.join(__dirname, '../../vendor', platform);
      if (platform === 'win32') {
        const perlExe = path.join(vendorDir, 'perl.exe');
        const exiftoolPl = path.join(vendorDir, 'exiftool.pl');
        return `"${perlExe}" "${exiftoolPl}"`;
      } else {
        return path.join(vendorDir, 'exiftool');
      }
    }
  }

  /**
   * Get default hardcoded configuration (fallback when Supabase data unavailable)
   */
  private getDefaultConfig(): TemporalConfig {
    return {
      motorsport: {
        clusterWindow: 3000, // 3 seconds - realistic for car passing + margin
        burstThreshold: 500, // 500ms - same subject in burst mode (increased for better detection)
        proximityBonus: 30 // +30 points for temporal neighbors
      },
      running: {
        clusterWindow: 2000, // 2 seconds
        burstThreshold: 500, // 500ms - increased for better burst detection
        proximityBonus: 25
      },
      cycling: {
        clusterWindow: 4000, // 4 seconds - group passing
        burstThreshold: 500, // 500ms - increased for better burst detection
        proximityBonus: 25
      },
      motocross: {
        clusterWindow: 3000, // 3 seconds - similar to motorsport
        burstThreshold: 500, // 500ms - increased for better burst detection
        proximityBonus: 30
      },
      generic: {
        clusterWindow: 2000, // 2 seconds default
        burstThreshold: 500, // 500ms - increased for better burst detection
        proximityBonus: 20
      }
    };
  }

  /**
   * Initialize configuration from SportCategory data from Supabase
   */
  initializeFromSportCategories(sportCategories: any[]): void {
    console.log('[TemporalClustering] Initializing from Supabase sport categories...');

    for (const category of sportCategories) {
      if (category.temporal_config && category.code) {
        const temporalConfig = {
          clusterWindow: category.temporal_config.clusterWindow || this.config[category.code as keyof TemporalConfig]?.clusterWindow || 2000,
          burstThreshold: category.temporal_config.burstThreshold || this.config[category.code as keyof TemporalConfig]?.burstThreshold || 100,
          proximityBonus: category.temporal_config.proximityBonus || this.config[category.code as keyof TemporalConfig]?.proximityBonus || 20
        };

        this.config[category.code as keyof TemporalConfig] = temporalConfig;
        console.log(`[TemporalClustering] Updated config for ${category.code}:`, temporalConfig);
      }
    }

    console.log('[TemporalClustering] Configuration updated from Supabase:', this.config);
  }

  /**
   * Update configuration for a specific sport (can be called from Supabase updates)
   */
  updateSportConfig(sportCode: string, temporalConfig: {
    clusterWindow?: number;
    burstThreshold?: number;
    proximityBonus?: number;
  }): void {
    if (!this.config[sportCode as keyof TemporalConfig]) {
      // Initialize with default if sport doesn't exist
      this.config[sportCode as keyof TemporalConfig] = this.config.generic;
    }

    const existingConfig = this.config[sportCode as keyof TemporalConfig];
    this.config[sportCode as keyof TemporalConfig] = {
      clusterWindow: temporalConfig.clusterWindow ?? existingConfig.clusterWindow,
      burstThreshold: temporalConfig.burstThreshold ?? existingConfig.burstThreshold,
      proximityBonus: temporalConfig.proximityBonus ?? existingConfig.proximityBonus
    };

    console.log(`[TemporalClustering] Updated ${sportCode} config:`, this.config[sportCode as keyof TemporalConfig]);
  }

  /**
   * Set analysis logger for detailed tracking
   */
  setAnalysisLogger(logger: any): void {
    this.analysisLogger = logger;
  }

  /**
   * Set progress callback for batch processing updates
   */
  setBatchProgressCallback(callback: (processed: number, total: number, currentBatch: number, totalBatches: number) => void): void {
    this.batchProgressCallback = callback;
  }

  /**
   * Calculate optimal batch size based on system resources and constraints
   */
  private calculateOptimalBatchSize(totalImages: number): number {
    const os = require('os');
    const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);

    // Base batch size based on available RAM - ridotto per evitare OOM
    let batchSize = 25; // Default molto conservativo

    if (totalMemoryGB >= 16) {
      batchSize = 50; // PC potenti - ridotto da 100 a 50
    } else if (totalMemoryGB >= 8) {
      batchSize = 25;  // PC medi - ridotto da 50 a 25
    } else {
      batchSize = 15;  // PC datati - ridotto da 25 a 15
    }

    // Adatta per OS - Windows ha limitazioni command line più severe
    if (process.platform === 'win32') {
      batchSize = Math.min(batchSize, 50);
    }

    // Per batch piccoli, processa tutto insieme
    if (totalImages <= 20) {
      batchSize = totalImages;
    }

    console.log(`[TemporalClustering] Calculated optimal batch size: ${batchSize} (RAM: ${totalMemoryGB.toFixed(1)}GB, OS: ${process.platform})`);
    return batchSize;
  }

  /**
   * Extract timestamps from multiple images using batch processing
   * ONLY uses DateTimeOriginal for accuracy - Images without DateTimeOriginal are excluded
   */
  async extractTimestampsBatch(filePaths: string[]): Promise<ImageTimestamp[]> {
    console.log(`[TemporalClustering] Starting batch timestamp extraction for ${filePaths.length} images`);

    const batchSize = this.calculateOptimalBatchSize(filePaths.length);
    const totalBatches = Math.ceil(filePaths.length / batchSize);
    const results: ImageTimestamp[] = [];

    console.log(`[TemporalClustering] Processing ${filePaths.length} images in ${totalBatches} batches of ${batchSize}`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * batchSize;
      const endIndex = Math.min(startIndex + batchSize, filePaths.length);
      const batchPaths = filePaths.slice(startIndex, endIndex);

      console.log(`[TemporalClustering] Processing batch ${batchIndex + 1}/${totalBatches} (${batchPaths.length} files)`);

      try {
        const batchResults = await this.extractExifTimestampsBatch(batchPaths);

        // Convert batch results to ImageTimestamp objects
        for (const filePath of batchPaths) {
          const fileName = require('path').basename(filePath);
          const exifResult = batchResults.get(filePath);

          if (exifResult) {
            results.push({
              filePath,
              fileName,
              timestamp: exifResult.timestamp,
              timestampSource: 'exif',
              exifData: exifResult.exifData
            });
          } else {
            // No valid DateTimeOriginal found - exclude from temporal clustering
            results.push({
              filePath,
              fileName,
              timestamp: null,
              timestampSource: 'excluded',
              excludedReason: 'No DateTimeOriginal EXIF data available'
            });
          }
        }

        // Report progress if callback is set
        if (this.batchProgressCallback) {
          const processedCount = (batchIndex + 1) * batchSize;
          const actualProcessed = Math.min(processedCount, filePaths.length);
          this.batchProgressCallback(actualProcessed, filePaths.length, batchIndex + 1, totalBatches);
        }

        // Explicit memory cleanup after each batch
        if (global.gc) {
          global.gc();
          const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
          console.log(`[TemporalClustering] Memory after batch ${batchIndex + 1}: ${memoryMB.toFixed(0)}MB`);
        }

      } catch (error) {
        console.error(`[TemporalClustering] Batch ${batchIndex + 1} failed, falling back to individual processing:`, error);

        // Fallback: process batch files individually
        for (const filePath of batchPaths) {
          try {
            const individualResult = await this.extractTimestamp(filePath);
            results.push(individualResult);
          } catch (individualError) {
            console.error(`[TemporalClustering] Individual processing also failed for ${filePath}:`, individualError);
            results.push({
              filePath,
              fileName: require('path').basename(filePath),
              timestamp: null,
              timestampSource: 'excluded',
              excludedReason: 'EXIF extraction failed'
            });
          }
        }
      }
    }

    const successCount = results.filter(r => r.timestamp !== null).length;
    const excludedCount = results.length - successCount;

    console.log(`[TemporalClustering] Batch extraction completed: ${successCount}/${results.length} successful, ${excludedCount} excluded`);

    return results;
  }

  /**
   * Extract timestamp from image - ONLY uses DateTimeOriginal for accuracy
   * Images without DateTimeOriginal are excluded from temporal clustering
   * (Single file method - kept for compatibility and fallback)
   */
  async extractTimestamp(filePath: string): Promise<ImageTimestamp> {
    const fileName = path.basename(filePath);

    try {
      // Only use ExifTool DateTimeOriginal for temporal clustering
      const exifTimestamp = await this.extractExifTimestamp(filePath);
      if (exifTimestamp) {
        return {
          filePath,
          fileName,
          timestamp: exifTimestamp.timestamp,
          timestampSource: 'exif',
          exifData: exifTimestamp.exifData
        };
      }
    } catch (error) {
      console.warn(`[TemporalClustering] EXIF extraction failed for ${fileName}:`, error);
    }

    // No valid DateTimeOriginal found - exclude from temporal clustering
    console.warn(`[TemporalClustering] No DateTimeOriginal found for ${fileName}, excluding from temporal clustering`);
    return {
      filePath,
      fileName,
      timestamp: null,
      timestampSource: 'excluded',
      excludedReason: 'No DateTimeOriginal EXIF data available'
    };
  }

  /**
   * Extract timestamps from multiple files in a single ExifTool batch call
   */
  private async extractExifTimestampsBatch(filePaths: string[]): Promise<Map<string, {
    timestamp: Date;
    exifData: any;
  } | null>> {
    const results = new Map<string, { timestamp: Date; exifData: any; } | null>();

    // Acquisisci il semaforo per limitare processi concorrenti
    await this.exiftoolSemaphore.acquire();

    // Crea file temporaneo per evitare command line length limits su Windows
    const tmpFile = path.join(os.tmpdir(), `exiftool-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`);

    try {
      // Scrivi i percorsi dei file nel file temporaneo (uno per riga)
      await fs.writeFile(tmpFile, filePaths.join('\n'), 'utf-8');

      // Usa il flag -@ di ExifTool per leggere i percorsi dal file
      // Non quotare exiftoolPath perché potrebbe già contenere spazi gestiti internamente
      const command = `${this.exiftoolPath} -DateTimeOriginal -CreateDate -ModifyDate -SubSecTimeOriginal -json -@ "${tmpFile}"`;

      console.log(`[TemporalClustering] Executing batch command for ${filePaths.length} files using temp file`);

      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer per batch grandi
        timeout: 10000 // 10 secondi timeout
      });

      if (stderr) {
        console.warn(`[TemporalClustering] ExifTool batch stderr:`, stderr);
      }

      const jsonData = JSON.parse(stdout);
      if (!jsonData || !Array.isArray(jsonData)) {
        console.warn(`[TemporalClustering] No valid EXIF data returned for batch`);
        filePaths.forEach(path => results.set(path, null));
        return results;
      }

      // Process results - ExifTool returns array in same order as input
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = require('path').basename(filePath);
        const exifData = jsonData[i];

        if (!exifData) {
          console.warn(`[TemporalClustering] No EXIF data for ${fileName}`);
          results.set(filePath, null);
          continue;
        }

        // Only use DateTimeOriginal for accurate temporal clustering
        const dateStr = exifData.DateTimeOriginal;
        if (dateStr) {
          try {
            // Parse EXIF date format: "2025:09:21 08:42:57" -> "2025-09-21 08:42:57"
            const normalizedDate = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
            let timestamp = new Date(normalizedDate);

            // Add subsecond precision if available
            if (exifData.SubSecTimeOriginal) {
              const subsec = parseInt(exifData.SubSecTimeOriginal, 10);
              if (!isNaN(subsec)) {
                // SubSecTimeOriginal can be 1, 2, or 3 digits
                // If 3 digits: already in milliseconds (e.g., 171 = 171ms)
                // If 2 digits: centiseconds, multiply by 10 (e.g., 17 = 170ms)
                // If 1 digit: deciseconds, multiply by 100 (e.g., 1 = 100ms)
                const subsecStr = String(subsec);
                let milliseconds = subsec;

                if (subsecStr.length === 1) {
                  milliseconds = subsec * 100;
                } else if (subsecStr.length === 2) {
                  milliseconds = subsec * 10;
                }
                // 3 digits = already milliseconds

                timestamp = new Date(timestamp.getTime() + milliseconds);
                console.log(`[TemporalClustering] Added subsec precision: ${subsec} (${subsecStr.length} digits) = ${milliseconds}ms`);
              }
            }

            if (!isNaN(timestamp.getTime())) {
              results.set(filePath, {
                timestamp,
                exifData: {
                  dateTimeOriginal: exifData.DateTimeOriginal,
                  createDate: exifData.CreateDate,
                  modifyDate: exifData.ModifyDate,
                  subsecTimeOriginal: exifData.SubSecTimeOriginal
                }
              });
              console.log(`[TemporalClustering] ✅ Batch extracted timestamp for ${fileName}: ${dateStr} -> ${timestamp.toISOString()}`);
            } else {
              console.warn(`[TemporalClustering] Invalid date parsed for ${fileName}: ${dateStr}`);
              results.set(filePath, null);
            }
          } catch (parseError) {
            console.warn(`[TemporalClustering] Failed to parse DateTimeOriginal for ${fileName}: ${dateStr}`, parseError);
            results.set(filePath, null);
          }
        } else {
          console.warn(`[TemporalClustering] No DateTimeOriginal found for ${fileName}`);
          results.set(filePath, null);
        }
      }

      return results;
    } catch (error) {
      console.error(`[TemporalClustering] ExifTool batch execution failed:`, error);
      // Return null for all files in failed batch
      filePaths.forEach(path => results.set(path, null));
      return results;
    } finally {
      // Cleanup file temporaneo
      try {
        await fs.unlink(tmpFile);
      } catch (unlinkError) {
        console.warn(`[TemporalClustering] Failed to cleanup temp file ${tmpFile}:`, unlinkError);
      }

      // Rilascia sempre il semaforo, anche in caso di errore
      this.exiftoolSemaphore.release();
    }
  }

  /**
   * Extract precise timestamp from EXIF using ExifTool (single file method - kept for compatibility)
   */
  private async extractExifTimestamp(filePath: string): Promise<{
    timestamp: Date;
    exifData: any;
  } | null> {
    const fileName = require('path').basename(filePath);

    // Acquisisci il semaforo per limitare processi concorrenti
    await this.exiftoolSemaphore.acquire();

    try {
      const command = `${this.exiftoolPath} -DateTimeOriginal -CreateDate -ModifyDate -SubSecTimeOriginal -json "${filePath}"`;
      console.log(`[TemporalClustering] Executing: ${command}`);

      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        console.warn(`[TemporalClustering] ExifTool stderr for ${fileName}:`, stderr);
      }

      console.log(`[TemporalClustering] Raw exiftool stdout for ${fileName}:`, stdout);

      const jsonData = JSON.parse(stdout);
      if (!jsonData || jsonData.length === 0) {
        console.warn(`[TemporalClustering] No EXIF data returned for ${fileName}`);
        return null;
      }

      const exifData = jsonData[0];
      console.log(`[TemporalClustering] Parsed EXIF data for ${fileName}:`, {
        dateTimeOriginal: exifData.DateTimeOriginal,
        createDate: exifData.CreateDate,
        modifyDate: exifData.ModifyDate,
        fullObject: exifData
      });

      // Only use DateTimeOriginal for accurate temporal clustering
      // CreateDate and ModifyDate can be misleading for copied/edited files
      const dateStr = exifData.DateTimeOriginal;
      if (dateStr) {
        try {
          // Parse EXIF date format: "2025:09:21 08:42:57" -> "2025-09-21 08:42:57"
          const normalizedDate = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
          let timestamp = new Date(normalizedDate);

          // Add subsecond precision if available
          if (exifData.SubSecTimeOriginal) {
            const subsec = parseInt(exifData.SubSecTimeOriginal, 10);
            if (!isNaN(subsec)) {
              // SubSecTimeOriginal can be 1, 2, or 3 digits
              // If 3 digits: already in milliseconds (e.g., 171 = 171ms)
              // If 2 digits: centiseconds, multiply by 10 (e.g., 17 = 170ms)
              // If 1 digit: deciseconds, multiply by 100 (e.g., 1 = 100ms)
              const subsecStr = String(subsec);
              let milliseconds = subsec;

              if (subsecStr.length === 1) {
                milliseconds = subsec * 100;
              } else if (subsecStr.length === 2) {
                milliseconds = subsec * 10;
              }
              // 3 digits = already milliseconds

              timestamp = new Date(timestamp.getTime() + milliseconds);
              console.log(`[TemporalClustering] Added subsec precision: ${subsec} (${subsecStr.length} digits) = ${milliseconds}ms`);
            }
          }

          if (!isNaN(timestamp.getTime())) {
            console.log(`[TemporalClustering] ✅ Successfully extracted timestamp for ${fileName}: ${dateStr} -> ${timestamp.toISOString()}`);
            return {
              timestamp,
              exifData: {
                dateTimeOriginal: exifData.DateTimeOriginal,
                createDate: exifData.CreateDate,
                modifyDate: exifData.ModifyDate,
                subsecTimeOriginal: exifData.SubSecTimeOriginal
              }
            };
          }
        } catch (parseError) {
          console.warn(`[TemporalClustering] Failed to parse DateTimeOriginal: ${dateStr}`, parseError);
        }
      } else {
        console.warn(`[TemporalClustering] No DateTimeOriginal found for ${fileName}`);
      }

      return null;
    } catch (error) {
      console.error(`[TemporalClustering] ExifTool execution failed for ${fileName}:`, error);
      return null;
    } finally {
      // Rilascia sempre il semaforo, anche in caso di errore
      this.exiftoolSemaphore.release();
    }
  }

  /**
   * Parse timestamp from common filename patterns
   */
  private parseFilenameTimestamp(fileName: string): Date | null {
    // Common patterns:
    // IMG_20241215_143045.jpg
    // DSC_20241215_143045_001.jpg
    // 20241215_143045.jpg
    // GOPR0123_20241215_143045.jpg

    const patterns = [
      /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/,  // YYYYMMDD_HHMMSS
      /(\d{4})[:-](\d{2})[:-](\d{2})[_\s](\d{2})[:-](\d{2})[:-](\d{2})/, // YYYY-MM-DD HH:MM:SS
    ];

    for (const pattern of patterns) {
      const match = fileName.match(pattern);
      if (match) {
        try {
          const [, year, month, day, hour, minute, second] = match;
          const timestamp = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1, // Month is 0-indexed
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(minute, 10),
            parseInt(second, 10)
          );

          if (!isNaN(timestamp.getTime())) {
            return timestamp;
          }
        } catch (error) {
          console.warn(`[TemporalClustering] Failed to parse filename timestamp: ${fileName}`, error);
        }
      }
    }

    return null;
  }

  /**
   * Create temporal clusters from array of image timestamps
   * Only processes images with valid DateTimeOriginal
   */
  createClusters(images: ImageTimestamp[], sport: string = 'generic'): TemporalCluster[] {
    if (images.length === 0) return [];

    const config = this.config[sport as keyof TemporalConfig] || this.config.generic;

    // Filter out images without valid DateTimeOriginal timestamp
    const validImages = images.filter(img => {
      if (img.timestamp === null || img.timestampSource === 'excluded') {
        console.log(`[TemporalClustering] Excluding ${img.fileName} from clustering: ${img.excludedReason || 'No valid timestamp'}`);
        return false;
      }
      return true;
    });

    const excludedCount = images.length - validImages.length;
    if (excludedCount > 0) {
      console.warn(`[TemporalClustering] Excluded ${excludedCount}/${images.length} images from temporal clustering (no DateTimeOriginal)`);
    }

    if (validImages.length === 0) {
      console.warn(`[TemporalClustering] No images with valid DateTimeOriginal - cannot create temporal clusters`);
      return [];
    }

    // Sort valid images by timestamp
    const sortedImages = [...validImages].sort((a, b) => a.timestamp!.getTime() - b.timestamp!.getTime());

    const clusters: TemporalCluster[] = [];
    let currentCluster: ImageTimestamp[] = [sortedImages[0]];

    console.log(`[TemporalClustering] Creating clusters for ${validImages.length} valid images (${excludedCount} excluded) with ${config.clusterWindow}ms window`);

    for (let i = 1; i < sortedImages.length; i++) {
      const currentImage = sortedImages[i];
      const lastImageInCluster = currentCluster[currentCluster.length - 1];

      const timeDiff = currentImage.timestamp!.getTime() - lastImageInCluster.timestamp!.getTime();

      if (timeDiff <= config.clusterWindow) {
        // Add to current cluster
        currentCluster.push(currentImage);
      } else {
        // Create new cluster
        if (currentCluster.length > 0) {
          clusters.push(this.createClusterFromImages(currentCluster, sport, config));
        }
        currentCluster = [currentImage];
      }
    }

    // Add final cluster
    if (currentCluster.length > 0) {
      clusters.push(this.createClusterFromImages(currentCluster, sport, config));
    }

    console.log(`[TemporalClustering] Created ${clusters.length} temporal clusters from ${validImages.length} valid images`);
    this.logClusterSummary(clusters, excludedCount);

    // Log temporal cluster creation if logger is available
    if (this.analysisLogger) {
      // Log excluded images
      if (excludedCount > 0) {
        this.analysisLogger.logTemporalCluster({
          excludedImages: images.filter(img => img.timestampSource === 'excluded').map(img => img.fileName),
          excludedCount,
          reason: 'No DateTimeOriginal EXIF data'
        });
      }

      for (const cluster of clusters) {
        this.analysisLogger.logTemporalCluster({
          clusterImages: cluster.images.map(img => img.fileName),
          duration: cluster.duration,
          burstMode: cluster.isBurstMode,
          commonNumber: this.extractCommonNumber(cluster),
          sport: cluster.sport
        });
      }
    }

    return clusters;
  }

  /**
   * Create a cluster object from images array
   */
  private createClusterFromImages(images: ImageTimestamp[], sport: string, config: any): TemporalCluster {
    const startTime = images[0].timestamp!;
    const endTime = images[images.length - 1].timestamp!;
    const duration = endTime.getTime() - startTime.getTime();

    // Detect burst mode: multiple photos within burst threshold
    let isBurstMode = false;
    if (images.length > 1) {
      for (let i = 1; i < images.length; i++) {
        const timeDiff = images[i].timestamp!.getTime() - images[i - 1].timestamp!.getTime();
        if (timeDiff <= config.burstThreshold) {
          isBurstMode = true;
          break;
        }
      }
    }

    return {
      id: `cluster_${startTime.getTime()}_${images.length}`,
      images,
      startTime,
      endTime,
      duration,
      isBurstMode,
      sport
    };
  }

  /**
   * Get temporal neighbors for a specific image
   * Only considers images with valid DateTimeOriginal
   */
  getTemporalNeighbors(
    targetImage: ImageTimestamp,
    allImages: ImageTimestamp[],
    sport: string = 'generic'
  ): ImageTimestamp[] {
    // Skip if target image doesn't have valid timestamp
    if (targetImage.timestamp === null || targetImage.timestampSource === 'excluded') {
      return [];
    }

    const config = this.config[sport as keyof TemporalConfig] || this.config.generic;
    const targetTime = targetImage.timestamp.getTime();

    return allImages.filter(img => {
      if (img.filePath === targetImage.filePath) return false; // Exclude self
      if (img.timestamp === null || img.timestampSource === 'excluded') return false; // Exclude invalid timestamps

      const timeDiff = Math.abs(img.timestamp.getTime() - targetTime);
      return timeDiff <= config.clusterWindow;
    });
  }

  /**
   * Check if two images are in burst mode (very close timing)
   * Only works with images that have valid DateTimeOriginal
   */
  isInBurstMode(image1: ImageTimestamp, image2: ImageTimestamp, sport: string = 'generic'): boolean {
    // Skip if either image doesn't have valid timestamp
    if (image1.timestamp === null || image1.timestampSource === 'excluded' ||
        image2.timestamp === null || image2.timestampSource === 'excluded') {
      return false;
    }

    const config = this.config[sport as keyof TemporalConfig] || this.config.generic;
    const timeDiff = Math.abs(image1.timestamp.getTime() - image2.timestamp.getTime());
    return timeDiff <= config.burstThreshold;
  }

  /**
   * Get proximity bonus score for temporal neighbors
   */
  getProximityBonus(sport: string = 'generic'): number {
    const config = this.config[sport as keyof TemporalConfig] || this.config.generic;
    return config.proximityBonus;
  }

  /**
   * Update sport-specific configuration
   */
  updateConfig(sport: string, updates: Partial<TemporalConfig[keyof TemporalConfig]>): void {
    if (this.config[sport as keyof TemporalConfig]) {
      this.config[sport as keyof TemporalConfig] = {
        ...this.config[sport as keyof TemporalConfig],
        ...updates
      };
      console.log(`[TemporalClustering] Updated config for ${sport}:`, this.config[sport as keyof TemporalConfig]);
    }
  }

  /**
   * Extract common race number from cluster images (if any)
   */
  private extractCommonNumber(cluster: TemporalCluster): string | undefined {
    // This would need integration with analysis results
    // For now, return undefined as this requires cross-module data
    return undefined;
  }

  /**
   * Log cluster analysis summary
   */
  private logClusterSummary(clusters: TemporalCluster[], excludedCount: number = 0): void {
    const totalImages = clusters.reduce((sum, cluster) => sum + cluster.images.length, 0);
    const burstClusters = clusters.filter(c => c.isBurstMode).length;
    const avgClusterSize = clusters.length > 0 ? totalImages / clusters.length : 0;

    console.log(`[TemporalClustering] Cluster Summary:`, {
      totalClusters: clusters.length,
      totalValidImages: totalImages,
      excludedImages: excludedCount,
      burstModeDetected: burstClusters,
      averageClusterSize: avgClusterSize.toFixed(1),
      sampleClusterDurations: clusters.slice(0, 3).map(c => `${c.duration}ms`),
      exclusionReason: excludedCount > 0 ? 'No DateTimeOriginal EXIF data' : 'None'
    });
  }
}

// Default export for easy integration
export const temporalClusterManager = new TemporalClusterManager();