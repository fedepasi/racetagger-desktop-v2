import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

/**
 * Helper class for managing temporary directories in tests
 */
export class TempDirectory {
  private tempPath: string | null = null;

  /**
   * Create a temporary directory with a unique name
   */
  async create(): Promise<string> {
    const tmpBase = os.tmpdir();
    const uniqueId = randomBytes(8).toString('hex');
    this.tempPath = path.join(tmpBase, `racetagger-test-${uniqueId}`);

    await fs.mkdir(this.tempPath, { recursive: true });
    return this.tempPath;
  }

  /**
   * Get the current temporary directory path
   */
  getPath(): string {
    if (!this.tempPath) {
      throw new Error('Temporary directory not created. Call create() first.');
    }
    return this.tempPath;
  }

  /**
   * Copy a file to the temporary directory
   */
  async copyFile(src: string, destName?: string): Promise<string> {
    if (!this.tempPath) {
      throw new Error('Temporary directory not created. Call create() first.');
    }

    const fileName = destName || path.basename(src);
    const dest = path.join(this.tempPath, fileName);

    await fs.copyFile(src, dest);
    return dest;
  }

  /**
   * Copy multiple files to the temporary directory
   */
  async copyFiles(srcFiles: string[]): Promise<string[]> {
    const destFiles: string[] = [];

    for (const src of srcFiles) {
      const dest = await this.copyFile(src);
      destFiles.push(dest);
    }

    return destFiles;
  }

  /**
   * Create a subdirectory within the temp directory
   */
  async createSubdir(name: string): Promise<string> {
    if (!this.tempPath) {
      throw new Error('Temporary directory not created. Call create() first.');
    }

    const subdirPath = path.join(this.tempPath, name);
    await fs.mkdir(subdirPath, { recursive: true });
    return subdirPath;
  }

  /**
   * Write content to a file in the temp directory
   */
  async writeFile(fileName: string, content: string | Buffer): Promise<string> {
    if (!this.tempPath) {
      throw new Error('Temporary directory not created. Call create() first.');
    }

    const filePath = path.join(this.tempPath, fileName);
    await fs.writeFile(filePath, content);
    return filePath;
  }

  /**
   * Read a file from the temp directory
   */
  async readFile(fileName: string): Promise<Buffer> {
    if (!this.tempPath) {
      throw new Error('Temporary directory not created. Call create() first.');
    }

    const filePath = path.join(this.tempPath, fileName);
    return await fs.readFile(filePath);
  }

  /**
   * Check if a file exists in the temp directory
   */
  async fileExists(fileName: string): Promise<boolean> {
    if (!this.tempPath) {
      return false;
    }

    const filePath = path.join(this.tempPath, fileName);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all files in the temp directory
   */
  async listFiles(): Promise<string[]> {
    if (!this.tempPath) {
      return [];
    }

    return await fs.readdir(this.tempPath);
  }

  /**
   * Clean up and remove the temporary directory
   */
  async cleanup(): Promise<void> {
    if (!this.tempPath) {
      return;
    }

    try {
      await fs.rm(this.tempPath, { recursive: true, force: true });
      this.tempPath = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to cleanup temp directory: ${message}`);
    }
  }

  /**
   * Get the size of the temp directory in bytes
   */
  async getSize(): Promise<number> {
    if (!this.tempPath) {
      return 0;
    }

    let totalSize = 0;
    const files = await fs.readdir(this.tempPath, { withFileTypes: true });

    for (const file of files) {
      const filePath = path.join(this.tempPath, file.name);
      if (file.isDirectory()) {
        // Recursively get size of subdirectories
        const subTemp = new TempDirectory();
        subTemp['tempPath'] = filePath;
        totalSize += await subTemp.getSize();
      } else {
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
    }

    return totalSize;
  }
}
