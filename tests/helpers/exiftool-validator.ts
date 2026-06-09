import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { FileHasher } from './file-hasher';

const execFileAsync = promisify(execFile);

/**
 * Resolve the ExifTool the app actually SHIPS (under vendor/), mirroring
 * native-tool-manager's resolution. Without this the validator probed a system
 * `exiftool` on PATH — which the dev/CI box usually lacks — so every metadata
 * test gated on isExifToolAvailable() and SILENTLY SKIPPED (green = untested).
 * On Windows the bundled exiftool.exe is Strawberry Perl and must run
 * exiftool.pl. Falls back to a PATH `exiftool` when no bundled binary exists.
 */
let _exiftool: { cmd: string; prefixArgs: string[] } | null = null;
function resolveExiftool(): { cmd: string; prefixArgs: string[] } {
  if (_exiftool) return _exiftool;
  const vendor = path.resolve(__dirname, '../../vendor'); // tests/helpers -> project root
  if (process.platform === 'win32') {
    const candidates = [
      path.join(vendor, 'win32', 'exiftool.exe'),
      path.join(vendor, 'win32', process.arch, 'exiftool.exe'),
      path.join(vendor, 'win32', 'x64', 'exiftool.exe'),
    ];
    const exe = candidates.find(existsSync);
    if (exe) {
      const pl = path.join(path.dirname(exe), 'exiftool.pl');
      _exiftool = { cmd: exe, prefixArgs: existsSync(pl) ? [pl] : [] };
      return _exiftool;
    }
  } else {
    const bin = path.join(vendor, process.platform === 'darwin' ? 'darwin' : 'linux', 'exiftool');
    if (existsSync(bin)) {
      _exiftool = { cmd: bin, prefixArgs: [] };
      return _exiftool;
    }
  }
  _exiftool = { cmd: 'exiftool', prefixArgs: [] };
  return _exiftool;
}

/**
 * Helper class for validating EXIF/XMP metadata using ExifTool
 */
export class ExifToolValidator {
  /**
   * Read all metadata from a file using ExifTool
   */
  async readMetadata(filePath: string): Promise<Record<string, any>> {
    try {
      const { cmd, prefixArgs } = resolveExiftool();
      const { stdout } = await execFileAsync(cmd, [...prefixArgs, '-json', filePath], {
        maxBuffer: 50 * 1024 * 1024,
      });
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
      const { cmd, prefixArgs } = resolveExiftool();
      await execFileAsync(cmd, [...prefixArgs, '-ver']);
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
