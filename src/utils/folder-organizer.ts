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
  customPattern?: string;
  createUnknownFolder: boolean;
  unknownFolderName: string;
  includeXmpFiles?: boolean; // Include XMP sidecar files for RAW images
  destinationPath?: string; // If not provided, uses source directory
  conflictStrategy?: 'rename' | 'skip' | 'overwrite'; // How to handle file conflicts
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
  folder_1?: string; // Custom folder 1
  folder_2?: string; // Custom folder 2
  folder_3?: string; // Custom folder 3
}

/**
 * Main class for organizing race photos into folders
 */
export class FolderOrganizer {
  private config: FolderOrganizerConfig;
  private createdFolders: Set<string> = new Set();
  private operationLog: FolderOrganizationResult[] = [];

  constructor(config: FolderOrganizerConfig) {
    this.config = config;

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
   * Organize a single image into the appropriate folder(s)
   * NEW LOGIC: If folder_1, folder_2, or folder_3 are specified, photos are copied to ALL assigned folders
   * If NO folders assigned, uses default behavior (race number)
   * MULTI-VEHICLE SUPPORT: Accepts array of csvData for photos with multiple vehicles
   */
  async organizeImage(
    imagePath: string,
    raceNumbers: string | string[],
    csvDataList?: CsvParticipantData | CsvParticipantData[], // Can be single object or array
    sourceDir?: string
  ): Promise<FolderOrganizationResult> {
    const startTime = Date.now();
    const fileName = path.basename(imagePath);

    // Normalize csvDataList to always be an array
    const csvDataArray: CsvParticipantData[] = csvDataList
      ? (Array.isArray(csvDataList) ? csvDataList : [csvDataList])
      : [];

    // ====== DEBUG LOGGING: Trace folder data ======
    console.log('\n[FolderOrg] 🔍 DEBUG - organizeImage() called for:', fileName);
    console.log('[FolderOrg] 🔍 DEBUG - csvDataArray received:', csvDataArray.length > 0 ? JSON.stringify(csvDataArray, null, 2) : 'empty array');
    csvDataArray.forEach((csvData, index) => {
      console.log(`[FolderOrg] 🔍 DEBUG - Vehicle ${index + 1} (#${csvData.numero}):`, {
        folder_1: csvData.folder_1 || '(empty)',
        folder_2: csvData.folder_2 || '(empty)',
        folder_3: csvData.folder_3 || '(empty)'
      });
    });
    // =============================================

    try {
      const numbers = Array.isArray(raceNumbers) ? raceNumbers : [raceNumbers];

      // NEW LOGIC: Collect custom folders from ALL csvData entries
      const customFolders: string[] = [];

      if (csvDataArray.length > 0) {
        // Iterate through ALL participant matches
        csvDataArray.forEach(csvData => {
          if (csvData?.folder_1?.trim()) {
            // Parse folder name with placeholders (e.g., "{number}-{name}" → "51-Calado")
            const parsedFolder1 = this.parseFolderName(csvData.folder_1.trim(), csvData);
            customFolders.push(parsedFolder1);
          }
          if (csvData?.folder_2?.trim()) {
            const parsedFolder2 = this.parseFolderName(csvData.folder_2.trim(), csvData);
            customFolders.push(parsedFolder2);
          }
          if (csvData?.folder_3?.trim()) {
            const parsedFolder3 = this.parseFolderName(csvData.folder_3.trim(), csvData);
            customFolders.push(parsedFolder3);
          }
        });
      }

      // Remove duplicates (e.g., if 2 vehicles share the same folder)
      const uniqueCustomFolders = [...new Set(customFolders)];

      // ====== DEBUG LOGGING: Folder collection result ======
      console.log('[FolderOrg] 🔍 DEBUG - customFolders collected:', customFolders);
      console.log('[FolderOrg] 🔍 DEBUG - uniqueCustomFolders (duplicates removed):', uniqueCustomFolders);
      // =====================================================

      // DECISION TREE:
      // - If NO custom folders → use race numbers (default behavior for ALL numbers)
      // - If AT LEAST ONE custom folder → use ONLY custom folders (copy to all)
      const foldersToCreate = uniqueCustomFolders.length > 0
        ? uniqueCustomFolders
        : numbers.map(num => this.generateFolderName(num));

      // ====== DEBUG LOGGING: Final decision ======
      console.log('[FolderOrg] 🔍 DEBUG - foldersToCreate:', foldersToCreate);
      console.log('[FolderOrg] 🔍 DEBUG - Decision: Using', uniqueCustomFolders.length > 0 ? 'CUSTOM folders' : 'DEFAULT (race number)', '\n');
      // ==========================================

      const baseDir = this.config.destinationPath || sourceDir || path.dirname(imagePath);

      // Ensure parent directory exists if using destinationPath
      if (this.config.destinationPath) {
        await this.ensureFolderExists(this.config.destinationPath);
      }

      const copiedPaths: string[] = [];
      const conflictStrategy = this.config.conflictStrategy || 'rename';
      let firstOperation: 'copy' | 'move' | 'skip' = this.config.mode;

      // COPY FILE TO ALL FOLDERS
      for (let i = 0; i < foldersToCreate.length; i++) {
        const folderName = foldersToCreate[i];
        const targetFolder = path.join(baseDir, folderName);

        await this.ensureFolderExists(targetFolder);

        const targetPath = path.join(targetFolder, fileName);
        let finalTargetPath = targetPath;
        let operation: 'copy' | 'move' | 'skip' = this.config.mode;

        // For multiple folders: MOVE to first, COPY to rest (if mode = 'move')
        if (this.config.mode === 'move' && i > 0) {
          operation = 'copy'; // Force copy for additional folders
        }

        // Handle file name conflicts
        if (fs.existsSync(targetPath)) {
          if (conflictStrategy === 'skip') {
            console.log(`⏭️ Skipping ${fileName} in ${folderName}/ (already exists)`);
            operation = 'skip';
          } else if (conflictStrategy === 'rename') {
            finalTargetPath = await this.resolveFileNameConflict(targetPath);
            const renamedFileName = path.basename(finalTargetPath);
            console.log(`🔄 Renaming ${fileName} → ${renamedFileName} in ${folderName}/`);
          } else if (conflictStrategy === 'overwrite') {
            console.log(`⚠️ Overwriting ${fileName} in ${folderName}/`);
            finalTargetPath = targetPath;
          }
        }

        // Perform operation if not skipped
        if (operation !== 'skip') {
          if (operation === 'copy') {
            await fsPromises.copyFile(imagePath, finalTargetPath);
            console.log(`✓ Copied: ${fileName} → ${folderName}/`);
          } else {
            // Move (only for first folder when mode = 'move')
            await fsPromises.rename(imagePath, finalTargetPath);
            console.log(`✓ Moved: ${fileName} → ${folderName}/`);
            imagePath = finalTargetPath; // Update source path for subsequent copies
          }

          // Handle XMP sidecar file
          await this.handleXmpSidecar(
            i === 0 ? imagePath : copiedPaths[0], // Use original or first copy as source
            finalTargetPath,
            operation
          );

          copiedPaths.push(finalTargetPath);
        }

        if (i === 0) {
          firstOperation = operation;
        }
      }

      const result: FolderOrganizationResult = {
        success: true,
        originalPath: imagePath,
        organizedPath: copiedPaths[0],
        folderName: foldersToCreate.join(', '),
        operation: firstOperation,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);

      if (copiedPaths.length > 1) {
        console.log(`📁 Photo copied to ${copiedPaths.length} folders: ${foldersToCreate.join(', ')}`);
      }

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

      const targetPath = path.join(targetDir, fileName);
      const conflictStrategy = this.config.conflictStrategy || 'rename';
      let finalTargetPath = targetPath;
      let operation: 'copy' | 'move' | 'skip' = this.config.mode;

      // Handle conflicts based on strategy
      if (fs.existsSync(targetPath)) {
        if (conflictStrategy === 'skip') {
          console.log(`⏭️ Skipping ${fileName} - already exists in Unknown_Numbers/`);
          operation = 'skip';
        } else if (conflictStrategy === 'rename') {
          finalTargetPath = await this.resolveFileNameConflict(targetPath);
          console.log(`🔄 Renaming ${fileName} → ${path.basename(finalTargetPath)}`);
        } else if (conflictStrategy === 'overwrite') {
          console.log(`⚠️ Overwriting ${fileName} in Unknown_Numbers/`);
          finalTargetPath = targetPath;
        }
      }

      // Perform operation if not skipped
      if (operation !== 'skip') {
        if (this.config.mode === 'copy') {
          await fsPromises.copyFile(imagePath, finalTargetPath);
        } else {
          await fsPromises.rename(imagePath, finalTargetPath);
        }
      }

      // Handle XMP sidecar file if it exists and should be included
      if (operation !== 'skip' && this.config.includeXmpFiles) {
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
        organizedPath: operation !== 'skip' ? finalTargetPath : undefined,
        folderName,
        operation,
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
   * Parse folder name with dynamic placeholders
   * Supports both English (recommended) and Italian (legacy) keywords:
   * - {number} = Race number
   * - {name} = Driver/participant name
   * - {team} or {squadra} (legacy) = Team name
   * - {category} or {categoria} (legacy) = Category
   * - {tag} or {metatag} (legacy) = Custom tag/metatag
   */
  private parseFolderName(folderTemplate: string, csvData: CsvParticipantData): string {
    if (!folderTemplate || !csvData) return folderTemplate;

    let parsedName = folderTemplate;

    // Replace placeholders with actual values
    parsedName = parsedName.replace(/\{number\}/g, csvData.numero || '');
    parsedName = parsedName.replace(/\{name\}/g, csvData.nome || '');

    // Team: Support both new English and legacy Italian keywords
    parsedName = parsedName.replace(/\{team\}/g, csvData.squadra || '');
    parsedName = parsedName.replace(/\{squadra\}/g, csvData.squadra || ''); // Legacy support

    // Category: Support both new English and legacy Italian keywords
    parsedName = parsedName.replace(/\{category\}/g, csvData.categoria || '');
    parsedName = parsedName.replace(/\{categoria\}/g, csvData.categoria || ''); // Legacy support

    // Tag: Support both new English and legacy Italian keywords
    parsedName = parsedName.replace(/\{tag\}/g, csvData.metatag || '');
    parsedName = parsedName.replace(/\{metatag\}/g, csvData.metatag || ''); // Legacy support

    // Sanitize the resulting folder name
    return this.sanitizeFileName(parsedName);
  }

  /**
   * Generate default folder name (just race number)
   */
  private generateFolderName(raceNumber: string): string {
    if (raceNumber === 'unknown') {
      return this.config.unknownFolderName;
    }
    return raceNumber;
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
   * DEPRECATED: Handle images with multiple race numbers detected
   * This method is no longer used - multiple folder logic is now integrated into organizeImage()
   */
  private async handleMultipleNumbers(
    imagePath: string,
    additionalNumbers: string[],
    csvData: CsvParticipantData | undefined,
    baseDir: string,
    fileName: string
  ): Promise<void> {
    // DEPRECATED - Logic moved to organizeImage() with folder_1, folder_2, folder_3 support
    console.warn('[DEPRECATED] handleMultipleNumbers() called - this method is obsolete');
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
   * Get organization summary statistics
   */
  getSummary(): OrganizationSummary {
    const totalFiles = this.operationLog.length;
    const organizedFiles = this.operationLog.filter(r => r.success && r.operation !== 'skip').length;
    const skippedFiles = this.operationLog.filter(r => r.operation === 'skip').length;
    const foldersCreated = this.createdFolders.size;
    const multiNumberImages = this.operationLog.filter(r => r.success && r.folderName.includes(','))?.length || 0;
    const unknownFiles = this.operationLog.filter(r =>
      r.success && (r.folderName.includes('Unknown') || r.folderName.includes('Non_Riconosciuti'))
    ).length;
    const errors = this.operationLog.filter(r => !r.success).map(r => r.error || 'Unknown error');
    const totalTimeMs = this.operationLog.reduce((sum, r) => sum + r.timeMs, 0);

    return {
      totalFiles,
      organizedFiles,
      skippedFiles,
      foldersCreated,
      multiNumberImages,
      unknownFiles,
      errors,
      totalTimeMs
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