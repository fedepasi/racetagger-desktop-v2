import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FileHasher } from './file-hasher';

const execAsync = promisify(exec);

/**
 * Helper class for validating EXIF/XMP metadata using ExifTool
 */
export class ExifToolValidator {
  /**
   * Read all metadata from a file using ExifTool
   */
  async readMetadata(filePath: string): Promise<Record<string, any>> {
    try {
      const { stdout } = await execAsync(`exiftool -json "${filePath}"`);
      const metadata = JSON.parse(stdout);
      return metadata[0] || {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read metadata from ${filePath}: ${message}`);
    }
  }

  /**
   * Verify that an XMP sidecar exists and contains expected data
   */
  async verifyXMPSidecar(
    rawPath: string,
    expectedData: Record<string, any>
  ): Promise<boolean> {
    const xmpPath = rawPath.replace(/\.[^.]+$/, '.xmp');

    // Check XMP file exists
    try {
      await fs.access(xmpPath);
    } catch {
      throw new Error(`XMP sidecar not found: ${xmpPath}`);
    }

    // Read XMP content
    const xmpContent = await fs.readFile(xmpPath, 'utf-8');

    // Verify expected data is present
    for (const [key, value] of Object.entries(expectedData)) {
      if (!xmpContent.includes(value)) {
        console.warn(`Expected value "${value}" for key "${key}" not found in XMP`);
        return false;
      }
    }

    return true;
  }

  /**
   * Ensure a RAW file has not been modified (hash comparison)
   */
  async ensureRawNotModified(
    originalPath: string,
    processedPath: string
  ): Promise<boolean> {
    const hasher = new FileHasher();
    const originalHash = await hasher.computeSHA256(originalPath);
    const processedHash = await hasher.computeSHA256(processedPath);

    if (originalHash !== processedHash) {
      throw new Error(
        `RAW file was modified! Original: ${originalHash}, Processed: ${processedHash}`
      );
    }

    return true;
  }

  /**
   * Verify specific EXIF fields are present and correct
   */
  async verifyExifFields(
    filePath: string,
    expectedFields: Record<string, string | number>
  ): Promise<boolean> {
    const metadata = await this.readMetadata(filePath);

    for (const [field, expectedValue] of Object.entries(expectedFields)) {
      const actualValue = metadata[field];

      if (actualValue !== expectedValue) {
        console.warn(
          `Field "${field}" mismatch. Expected: "${expectedValue}", Got: "${actualValue}"`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Check if ExifTool is installed and accessible
   */
  async isExifToolAvailable(): Promise<boolean> {
    try {
      await execAsync('exiftool -ver');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read XMP sidecar as XML and parse specific Dublin Core fields
   */
  async readDublinCoreFields(xmpPath: string): Promise<Record<string, any>> {
    const xmpContent = await fs.readFile(xmpPath, 'utf-8');

    const dcFields: Record<string, any> = {};

    // Extract dc:subject (race number)
    const subjectMatch = xmpContent.match(/<dc:subject>\s*<rdf:Bag>\s*<rdf:li>(.*?)<\/rdf:li>/);
    if (subjectMatch) {
      dcFields.subject = subjectMatch[1];
    }

    // Extract dc:creator (participant name)
    const creatorMatch = xmpContent.match(/<dc:creator>\s*<rdf:Seq>\s*<rdf:li>(.*?)<\/rdf:li>/);
    if (creatorMatch) {
      dcFields.creator = creatorMatch[1];
    }

    // Extract dc:description
    const descMatch = xmpContent.match(/<dc:description>\s*<rdf:Alt>\s*<rdf:li[^>]*>(.*?)<\/rdf:li>/);
    if (descMatch) {
      dcFields.description = descMatch[1];
    }

    return dcFields;
  }

  /**
   * Verify that existing EXIF data is preserved after metadata write
   */
  async verifyExistingDataPreserved(
    originalPath: string,
    modifiedPath: string,
    fieldsToCheck: string[]
  ): Promise<boolean> {
    const originalMeta = await this.readMetadata(originalPath);
    const modifiedMeta = await this.readMetadata(modifiedPath);

    for (const field of fieldsToCheck) {
      if (originalMeta[field] && originalMeta[field] !== modifiedMeta[field]) {
        console.warn(
          `Field "${field}" was not preserved. Original: "${originalMeta[field]}", Modified: "${modifiedMeta[field]}"`
        );
        return false;
      }
    }

    return true;
  }
}
