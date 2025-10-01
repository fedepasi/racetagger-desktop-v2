import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface FileTimestamp {
  filePath: string;
  creationTime: Date | null;
  modificationTime: Date | null;
  error?: string;
}

export class FilesystemTimestampExtractor {
  private platform: string;

  constructor() {
    this.platform = process.platform;
  }

  /**
   * Extract creation time for multiple files using platform-specific methods
   */
  async extractCreationTimes(filePaths: string[]): Promise<FileTimestamp[]> {
    if (filePaths.length === 0) return [];

    console.log(`[FilesystemTimestamp] Extracting creation times for ${filePaths.length} files on ${this.platform}`);

    try {
      switch (this.platform) {
        case 'darwin':
          return await this.extractCreationTimesMacOS(filePaths);
        case 'win32':
          return await this.extractCreationTimesWindows(filePaths);
        case 'linux':
          return await this.extractCreationTimesLinux(filePaths);
        default:
          console.warn(`[FilesystemTimestamp] Unsupported platform: ${this.platform}, using fallback`);
          return await this.extractCreationTimesFallback(filePaths);
      }
    } catch (error) {
      console.error(`[FilesystemTimestamp] Error extracting creation times:`, error);
      return await this.extractCreationTimesFallback(filePaths);
    }
  }

  /**
   * macOS implementation using stat -f "%B %m %N"
   * %B = birth time (creation), %m = modification time, %N = filename
   */
  private async extractCreationTimesMacOS(filePaths: string[]): Promise<FileTimestamp[]> {
    const results: FileTimestamp[] = [];
    const batchSize = 100; // Process in smaller batches to avoid command line length limits

    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const quotedPaths = batch.map(p => `"${p}"`).join(' ');

      try {
        const { stdout } = await execAsync(`stat -f "%B %m %N" ${quotedPaths}`, {
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });

        const lines = stdout.trim().split('\n');
        for (let j = 0; j < lines.length && j < batch.length; j++) {
          const parts = lines[j].trim().split(' ');
          if (parts.length >= 3) {
            const birthTime = parseInt(parts[0]);
            const modTime = parseInt(parts[1]);
            const fileName = parts.slice(2).join(' ');

            results.push({
              filePath: batch[j],
              creationTime: birthTime > 0 ? new Date(birthTime * 1000) : null,
              modificationTime: modTime > 0 ? new Date(modTime * 1000) : null
            });
          } else {
            results.push({
              filePath: batch[j],
              creationTime: null,
              modificationTime: null,
              error: `Invalid stat output: ${lines[j]}`
            });
          }
        }
      } catch (error) {
        console.error(`[FilesystemTimestamp] Error processing batch ${i}-${i+batchSize}:`, error);
        // Add null entries for this batch
        batch.forEach(filePath => {
          results.push({
            filePath,
            creationTime: null,
            modificationTime: null,
            error: `Batch processing failed: ${error}`
          });
        });
      }
    }

    console.log(`[FilesystemTimestamp] macOS: Processed ${results.length} files, ${results.filter(r => r.creationTime).length} successful`);
    return results;
  }

  /**
   * Windows implementation using PowerShell Get-ItemProperty
   */
  private async extractCreationTimesWindows(filePaths: string[]): Promise<FileTimestamp[]> {
    const results: FileTimestamp[] = [];

    // Create PowerShell script to get creation times
    const psScript = filePaths.map(filePath =>
      `Get-ItemProperty -Path "${filePath}" | Select-Object FullName, CreationTime, LastWriteTime`
    ).join('; ');

    try {
      const { stdout } = await execAsync(`powershell -Command "${psScript}"`, {
        maxBuffer: 10 * 1024 * 1024
      });

      // Parse PowerShell output (simplified - would need more robust parsing)
      const lines = stdout.split('\n');
      let currentFile = '';
      let creationTime: Date | null = null;
      let modificationTime: Date | null = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes('FullName')) {
          if (currentFile && creationTime) {
            results.push({
              filePath: currentFile,
              creationTime,
              modificationTime
            });
          }
          currentFile = trimmed.split(':').slice(1).join(':').trim();
          creationTime = null;
          modificationTime = null;
        } else if (trimmed.includes('CreationTime')) {
          const dateStr = trimmed.split(':').slice(1).join(':').trim();
          creationTime = new Date(dateStr);
        } else if (trimmed.includes('LastWriteTime')) {
          const dateStr = trimmed.split(':').slice(1).join(':').trim();
          modificationTime = new Date(dateStr);
        }
      }

      // Add the last file
      if (currentFile && creationTime) {
        results.push({
          filePath: currentFile,
          creationTime,
          modificationTime
        });
      }

    } catch (error) {
      console.error(`[FilesystemTimestamp] Windows PowerShell error:`, error);
      return await this.extractCreationTimesFallback(filePaths);
    }

    console.log(`[FilesystemTimestamp] Windows: Processed ${results.length} files`);
    return results;
  }

  /**
   * Linux implementation using stat -c "%W %Y %n"
   * %W = birth time, %Y = modification time, %n = filename
   * Note: Birth time support varies on Linux filesystems
   */
  private async extractCreationTimesLinux(filePaths: string[]): Promise<FileTimestamp[]> {
    const results: FileTimestamp[] = [];
    const batchSize = 100;

    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const quotedPaths = batch.map(p => `"${p}"`).join(' ');

      try {
        const { stdout } = await execAsync(`stat -c "%W %Y %n" ${quotedPaths}`, {
          maxBuffer: 10 * 1024 * 1024
        });

        const lines = stdout.trim().split('\n');
        for (let j = 0; j < lines.length && j < batch.length; j++) {
          const parts = lines[j].trim().split(' ');
          if (parts.length >= 3) {
            const birthTime = parseInt(parts[0]);
            const modTime = parseInt(parts[1]);
            const fileName = parts.slice(2).join(' ');

            results.push({
              filePath: batch[j],
              // Linux birth time is often 0 (not supported), use modification time as fallback
              creationTime: birthTime > 0 ? new Date(birthTime * 1000) : new Date(modTime * 1000),
              modificationTime: modTime > 0 ? new Date(modTime * 1000) : null
            });
          } else {
            results.push({
              filePath: batch[j],
              creationTime: null,
              modificationTime: null,
              error: `Invalid stat output: ${lines[j]}`
            });
          }
        }
      } catch (error) {
        console.error(`[FilesystemTimestamp] Error processing Linux batch ${i}-${i+batchSize}:`, error);
        batch.forEach(filePath => {
          results.push({
            filePath,
            creationTime: null,
            modificationTime: null,
            error: `Batch processing failed: ${error}`
          });
        });
      }
    }

    console.log(`[FilesystemTimestamp] Linux: Processed ${results.length} files, ${results.filter(r => r.creationTime).length} successful`);
    return results;
  }

  /**
   * Fallback implementation using Node.js fs.stat
   * Less accurate but works on all platforms
   */
  private async extractCreationTimesFallback(filePaths: string[]): Promise<FileTimestamp[]> {
    console.log(`[FilesystemTimestamp] Using Node.js fs.stat fallback`);

    const results: FileTimestamp[] = [];

    for (const filePath of filePaths) {
      try {
        const stats = await fs.promises.stat(filePath);
        results.push({
          filePath,
          // Use birthtime if available (Windows/macOS), otherwise use mtime
          creationTime: stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime,
          modificationTime: stats.mtime
        });
      } catch (error) {
        results.push({
          filePath,
          creationTime: null,
          modificationTime: null,
          error: `fs.stat failed: ${error}`
        });
      }
    }

    console.log(`[FilesystemTimestamp] Fallback: Processed ${results.length} files, ${results.filter(r => r.creationTime).length} successful`);
    return results;
  }

  /**
   * Sort files by creation time
   */
  static sortByCreationTime(fileTimestamps: FileTimestamp[]): string[] {
    return fileTimestamps
      .sort((a, b) => {
        const timeA = a.creationTime?.getTime() || Infinity;
        const timeB = b.creationTime?.getTime() || Infinity;
        return timeA - timeB;
      })
      .map(ft => ft.filePath);
  }
}