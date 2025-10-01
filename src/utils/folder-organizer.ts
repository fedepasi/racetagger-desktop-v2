/**
 * ADMIN FEATURE: Folder Organization Module
 * 
 * This module handles organizing race photos into folders based on race numbers.
 * ISOLATION: All folder organization logic is contained in this single file.
 * TO REMOVE: Simply delete this file and remove imports from other files.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

// Configuration interface for folder organization
export interface FolderOrganizerConfig {
  enabled: boolean;
  mode: 'copy' | 'move';
  pattern: 'number' | 'number_name' | 'custom';
  customPattern?: string; // e.g., "{number}_{name}" or "Racer_{number}"
  createUnknownFolder: boolean;
  unknownFolderName: string;
  includeXmpFiles?: boolean; // Include XMP sidecar files for RAW images
  destinationPath?: string; // If not provided, uses source directory
}

// Operation result for tracking
export interface FolderOrganizationResult {
  success: boolean;
  originalPath: string;
  organizedPath?: string;
  folderName: string;
  operation: 'copy' | 'move' | 'skip';
  error?: string;
  timeMs: number;
}

// Organization summary statistics
export interface OrganizationSummary {
  totalFiles: number;
  organizedFiles: number;
  skippedFiles: number;
  foldersCreated: number;
  multiNumberImages: number;
  unknownFiles: number;
  errors: string[];
  totalTimeMs: number;
}

// CSV data structure for enhanced organization
export interface CsvParticipantData {
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  metatag?: string;
}

/**
 * Main class for organizing race photos into folders
 */
export class FolderOrganizer {
  private config: FolderOrganizerConfig;
  private createdFolders: Set<string> = new Set();
  private operationLog: FolderOrganizationResult[] = [];

  constructor(config: FolderOrganizerConfig) {
    this.config = {
      // Defaults
      customPattern: '{number}',
      ...config
    };
    
    // Set default unknown folder name if not provided
    if (!this.config.unknownFolderName) {
      this.config.unknownFolderName = 'Non_Riconosciuti';
    }
  }

  /**
   * Check if a file is a RAW format that typically uses XMP sidecar files
   */
  private isRawFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const rawExtensions = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
    return rawExtensions.includes(ext);
  }

  /**
   * Get the XMP sidecar file path for a given image file
   * Checks for both lowercase and uppercase XMP extensions
   */
  private getXmpSidecarPath(imagePath: string): string {
    const dir = path.dirname(imagePath);
    const nameWithoutExt = path.parse(imagePath).name;

    // Check for lowercase .xmp first
    const lowercasePath = path.join(dir, `${nameWithoutExt}.xmp`);
    if (fs.existsSync(lowercasePath)) {
      return lowercasePath;
    }

    // Check for uppercase .XMP
    const uppercasePath = path.join(dir, `${nameWithoutExt}.XMP`);
    if (fs.existsSync(uppercasePath)) {
      return uppercasePath;
    }

    // Return lowercase path as default (for creating new XMP files)
    return lowercasePath;
  }

  /**
   * Copy or move XMP sidecar file if it exists
   */
  private async handleXmpSidecar(
    originalImagePath: string,
    targetImagePath: string,
    operation: 'copy' | 'move' | 'skip'
  ): Promise<boolean> {
    if (operation === 'skip' || !this.isRawFile(originalImagePath) || !this.config.includeXmpFiles) {
      console.log(`[XMP] Skipping XMP handling for ${path.basename(originalImagePath)} (operation: ${operation}, isRAW: ${this.isRawFile(originalImagePath)}, includeXMP: ${this.config.includeXmpFiles})`);
      return false; // No XMP handling needed
    }

    const originalXmpPath = this.getXmpSidecarPath(originalImagePath);

    if (!fs.existsSync(originalXmpPath)) {
      console.log(`[XMP] No XMP sidecar found for ${path.basename(originalImagePath)} at ${path.basename(originalXmpPath)}`);
      return false; // No XMP file to handle
    }

    // Preserve the original extension case (e.g., .XMP or .xmp)
    const originalExt = path.extname(originalXmpPath);
    const targetDir = path.dirname(targetImagePath);
    const targetNameWithoutExt = path.parse(targetImagePath).name;
    const targetXmpPath = path.join(targetDir, `${targetNameWithoutExt}${originalExt}`);

    try {
      if (this.config.mode === 'copy') {
        await fsPromises.copyFile(originalXmpPath, targetXmpPath);
        console.log(`[XMP] ✓ Copied XMP sidecar: ${path.basename(originalXmpPath)} → ${path.basename(targetXmpPath)}`);
      } else {
        await fsPromises.rename(originalXmpPath, targetXmpPath);
        console.log(`[XMP] ✓ Moved XMP sidecar: ${path.basename(originalXmpPath)} → ${path.basename(targetXmpPath)}`);
      }
      return true;
    } catch (error) {
      console.error(`[XMP] ✗ Error handling XMP sidecar file ${originalXmpPath}:`, error);
      return false;
    }
  }

  /**
   * Organize a single image into the appropriate folder
   */
  async organizeImage(
    imagePath: string,
    raceNumbers: string | string[],
    csvData?: CsvParticipantData,
    sourceDir?: string
  ): Promise<FolderOrganizationResult> {
    const startTime = Date.now();
    const fileName = path.basename(imagePath);

    try {
      // Handle multiple race numbers
      const numbers = Array.isArray(raceNumbers) ? raceNumbers : [raceNumbers];
      const primaryNumber = numbers[0]; // Use first number for primary folder

      // Determine folder name based on pattern
      const folderName = this.generateFolderName(primaryNumber, csvData);
      
      // Determine destination directory
      const baseDir = this.config.destinationPath || sourceDir || path.dirname(imagePath);
      
      // Ensure the parent "Organized_Photos" folder exists if using destinationPath
      if (this.config.destinationPath) {
        await this.ensureFolderExists(this.config.destinationPath);
      }
      
      const targetFolder = path.join(baseDir, folderName);

      // Create folder if it doesn't exist
      await this.ensureFolderExists(targetFolder);

      // Generate target file path
      const targetPath = path.join(targetFolder, fileName);

      // Handle file name conflicts
      const finalTargetPath = await this.resolveFileNameConflict(targetPath);

      // Perform the operation
      let operation: 'copy' | 'move' | 'skip' = this.config.mode;
      let xmpHandled = false;
      
      if (fs.existsSync(finalTargetPath)) {
        console.log(`File already exists in organized folder: ${finalTargetPath}`);
        operation = 'skip';
      } else {
        if (this.config.mode === 'copy') {
          await fsPromises.copyFile(imagePath, finalTargetPath);
          console.log(`Copied: ${fileName} → ${folderName}/`);
        } else {
          await fsPromises.rename(imagePath, finalTargetPath);
          console.log(`Moved: ${fileName} → ${folderName}/`);
        }
        
        // Handle XMP sidecar file if present
        xmpHandled = await this.handleXmpSidecar(imagePath, finalTargetPath, operation);
      }

      // Handle multiple race numbers (copy to additional folders)
      if (numbers.length > 1) {
        await this.handleMultipleNumbers(imagePath, numbers.slice(1), csvData, baseDir, fileName);
      }

      const result: FolderOrganizationResult = {
        success: true,
        originalPath: imagePath,
        organizedPath: finalTargetPath,
        folderName,
        operation,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error organizing ${fileName}:`, errorMsg);

      const result: FolderOrganizationResult = {
        success: false,
        originalPath: imagePath,
        folderName: 'ERROR',
        operation: 'skip',
        error: errorMsg,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);
      return result;
    }
  }

  /**
   * Organize image with no detected race number
   */
  async organizeUnknownImage(
    imagePath: string,
    sourceDir?: string
  ): Promise<FolderOrganizationResult> {
    if (!this.config.createUnknownFolder) {
      return {
        success: true,
        originalPath: imagePath,
        folderName: 'SKIPPED',
        operation: 'skip',
        timeMs: 0
      };
    }

    return this.organizeImage(imagePath, 'unknown', undefined, sourceDir);
  }

  /**
   * Organize image with numbers not found in participant preset to Unknown_Numbers folder
   */
  async organizeToUnknownNumbers(
    imagePath: string,
    sourceDir?: string
  ): Promise<FolderOrganizationResult> {
    const startTime = Date.now();

    try {
      const fileName = path.basename(imagePath);
      const baseDir = sourceDir || this.config.destinationPath || path.dirname(imagePath);

      // Use specific folder name for numbers not in preset
      const folderName = 'Unknown_Numbers';
      const targetDir = path.join(baseDir, folderName);

      await this.ensureFolderExists(targetDir);

      let targetPath = path.join(targetDir, fileName);
      targetPath = await this.resolveFileNameConflict(targetPath);

      // Copy or move the file
      if (this.config.mode === 'copy') {
        await fsPromises.copyFile(imagePath, targetPath);
      } else {
        await fsPromises.rename(imagePath, targetPath);
      }

      // Handle XMP sidecar file if it exists and should be included
      if (this.config.includeXmpFiles) {
        const xmpPath = this.getXmpSidecarPath(imagePath);
        if (xmpPath) {
          const xmpFileName = path.basename(xmpPath);
          const targetXmpPath = path.join(targetDir, xmpFileName);

          if (this.config.mode === 'copy') {
            await fsPromises.copyFile(xmpPath, targetXmpPath);
          } else {
            await fsPromises.rename(xmpPath, targetXmpPath);
          }
          console.log(`${this.config.mode === 'copy' ? 'Copied' : 'Moved'} XMP sidecar: ${xmpFileName} to ${folderName}`);
        }
      }

      const result: FolderOrganizationResult = {
        success: true,
        originalPath: imagePath,
        organizedPath: targetPath,
        folderName,
        operation: this.config.mode,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);
      console.log(`${this.config.mode === 'copy' ? 'Copied' : 'Moved'} ${fileName} to ${folderName} (number not in preset)`);

      return result;

    } catch (error: any) {
      const result: FolderOrganizationResult = {
        success: false,
        originalPath: imagePath,
        folderName: 'Unknown_Numbers',
        operation: this.config.mode,
        error: error.message,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);
      console.error(`Failed to organize ${path.basename(imagePath)} to Unknown_Numbers:`, error);

      return result;
    }
  }

  /**
   * Generate folder name based on pattern and CSV data
   */
  private generateFolderName(raceNumber: string, csvData?: CsvParticipantData): string {
    if (raceNumber === 'unknown') {
      return this.config.unknownFolderName;
    }

    switch (this.config.pattern) {
      case 'number':
        return raceNumber;

      case 'number_name':
        if (csvData?.nome) {
          return `${raceNumber}_${this.sanitizeFileName(csvData.nome)}`;
        }
        return raceNumber; // Fallback to number only

      case 'custom':
        if (this.config.customPattern) {
          let pattern = this.config.customPattern;
          pattern = pattern.replace('{number}', raceNumber);
          pattern = pattern.replace('{name}', csvData?.nome || '');
          pattern = pattern.replace('{categoria}', csvData?.categoria || '');
          pattern = pattern.replace('{squadra}', csvData?.squadra || '');
          return this.sanitizeFileName(pattern);
        }
        return raceNumber; // Fallback

      default:
        return raceNumber;
    }
  }

  /**
   * Sanitize filename to remove invalid characters
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_+/g, '_') // Collapse multiple underscores
      .trim()
      .substring(0, 100); // Limit length
  }

  /**
   * Ensure folder exists, create if necessary
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (!fs.existsSync(folderPath)) {
      await fsPromises.mkdir(folderPath, { recursive: true });
      this.createdFolders.add(folderPath);
      console.log(`Created folder: ${path.basename(folderPath)}`);
    }
  }

  /**
   * Resolve file name conflicts by appending numbers
   */
  private async resolveFileNameConflict(targetPath: string): Promise<string> {
    if (!fs.existsSync(targetPath)) {
      return targetPath;
    }

    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const baseName = path.basename(targetPath, ext);

    let counter = 2;
    let newPath = path.join(dir, `${baseName}_${counter}${ext}`);

    while (fs.existsSync(newPath)) {
      counter++;
      newPath = path.join(dir, `${baseName}_${counter}${ext}`);
    }

    return newPath;
  }

  /**
   * Handle images with multiple race numbers detected
   */
  private async handleMultipleNumbers(
    imagePath: string,
    additionalNumbers: string[],
    csvData: CsvParticipantData | undefined,
    baseDir: string,
    fileName: string
  ): Promise<void> {
    if (this.config.mode !== 'copy') {
      console.log(`Multiple numbers detected but mode is '${this.config.mode}' - skipping additional copies`);
      return;
    }

    for (const number of additionalNumbers) {
      try {
        const folderName = this.generateFolderName(number, csvData);
        const targetFolder = path.join(baseDir, folderName);
        
        await this.ensureFolderExists(targetFolder);
        
        const targetPath = path.join(targetFolder, fileName);
        const finalTargetPath = await this.resolveFileNameConflict(targetPath);
        
        await fsPromises.copyFile(imagePath, finalTargetPath);
        console.log(`Additional copy: ${fileName} → ${folderName}/`);
        
        // Handle XMP sidecar file for additional copies
        await this.handleXmpSidecar(imagePath, finalTargetPath, 'copy');
        
      } catch (error) {
        console.error(`Error copying to additional folder ${number}:`, error);
      }
    }
  }

  /**
   * Get organization summary statistics
   */
  getOrganizationSummary(): OrganizationSummary {
    const results = this.operationLog;
    const errors = results.filter(r => !r.success).map(r => r.error || 'Unknown error');

    return {
      totalFiles: results.length,
      organizedFiles: results.filter(r => r.success && r.operation !== 'skip').length,
      skippedFiles: results.filter(r => r.operation === 'skip').length,
      foldersCreated: this.createdFolders.size,
      multiNumberImages: 0, // TODO: Track this separately
      unknownFiles: results.filter(r => r.folderName === this.config.unknownFolderName).length,
      errors,
      totalTimeMs: results.reduce((sum, r) => sum + r.timeMs, 0)
    };
  }

  /**
   * Generate rollback information for undo operations
   */
  generateRollbackLog(): any {
    return {
      timestamp: new Date().toISOString(),
      config: this.config,
      operations: this.operationLog.filter(op => op.success && op.operation !== 'skip'),
      createdFolders: Array.from(this.createdFolders)
    };
  }

  /**
   * Clean up - reset internal state
   */
  reset(): void {
    this.createdFolders.clear();
    this.operationLog = [];
  }
}

/**
 * Utility function to check if folder organization is available
 * Used by IPC handlers to verify feature availability
 */
export function isFolderOrganizationEnabled(): boolean {
  // Import config dynamically to avoid circular dependencies
  try {
    const { APP_CONFIG } = require('../config');
    return APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION;
  } catch (error) {
    console.error('Error checking folder organization feature flag:', error);
    return false;
  }
}

/**
 * Create default configuration for folder organization
 */
export function createDefaultConfig(): FolderOrganizerConfig {
  return {
    enabled: true,
    mode: 'copy', // Safe default
    pattern: 'number',
    createUnknownFolder: true,
    unknownFolderName: 'Unknown_Numbers',
    includeXmpFiles: true // Default to including XMP files
  };
}