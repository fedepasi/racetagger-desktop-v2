import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';

/**
 * Helper class for computing file hashes and comparing files
 */
export class FileHasher {
  /**
   * Compute SHA256 hash of a file
   */
  async computeSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (error) => reject(error));
    });
  }

  /**
   * Compute MD5 hash of a file
   */
  async computeMD5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (error) => reject(error));
    });
  }

  /**
   * Compare two files by their SHA256 hash
   */
  async compareFiles(file1: string, file2: string): Promise<boolean> {
    const hash1 = await this.computeSHA256(file1);
    const hash2 = await this.computeSHA256(file2);
    return hash1 === hash2;
  }

  /**
   * Verify a file matches an expected hash
   */
  async verifyHash(filePath: string, expectedHash: string, algorithm: 'sha256' | 'md5' = 'sha256'): Promise<boolean> {
    const actualHash = algorithm === 'sha256'
      ? await this.computeSHA256(filePath)
      : await this.computeMD5(filePath);

    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  }

  /**
   * Compute hash of a buffer or string
   */
  computeBufferHash(data: Buffer | string, algorithm: 'sha256' | 'md5' = 'sha256'): string {
    const hash = crypto.createHash(algorithm);
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Compare file content byte-by-byte (slower but more thorough than hash)
   */
  async compareFilesByteByByte(file1: string, file2: string): Promise<boolean> {
    const buffer1 = await fs.readFile(file1);
    const buffer2 = await fs.readFile(file2);

    if (buffer1.length !== buffer2.length) {
      return false;
    }

    return buffer1.equals(buffer2);
  }

  /**
   * Get file size in bytes
   */
  async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  /**
   * Compute hashes for multiple files
   */
  async computeMultipleHashes(filePaths: string[]): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();

    for (const filePath of filePaths) {
      const hash = await this.computeSHA256(filePath);
      hashes.set(filePath, hash);
    }

    return hashes;
  }
}
