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
import { buildFilename, RenameContext } from './filename-renamer';

// Helper to extract the primary driver name from participant data.
// Handles both modern preset_participant_drivers array and legacy nome field.
function getDriverNameFromParticipant(csvData: CsvParticipantData): string {
  // Modern system: preset_participant_drivers array (loaded from Supabase presets)
  const drivers = (csvData as any)?.preset_participant_drivers;
  if (Array.isArray(drivers) && drivers.length > 0) {
    // Sort by driver_order and join all driver names
    const sortedDrivers = [...drivers].sort((a: any, b: any) => (a.driver_order || 0) - (b.driver_order || 0));
    const names = sortedDrivers
      .map((d: any) => d.driver_name?.trim())
      .filter(Boolean);
    if (names.length > 0) {
      return names.join(' ');
    }
  }
  // Legacy CSV fallback: nome field
  return csvData?.nome?.trim() || '';
}

// Extract surname from a full name (last word)
function extractSurnameFromName(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

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
  renamePattern?: string; // Optional filename pattern (e.g. "{number}_{name}_{team}-{seq:2}")

  // (1.2.0 note: the per-preset "include default folder with custom"
  // flag has been moved to a per-participant flag on CsvParticipantData
  // — see `include_default_folder` below. The decision is now made
  // per-participant, not per-preset.)

  // --- Issue #105 hardening (defense-in-depth) ---
  // When a participant preset is active, caller SHOULD pass the list of legitimate
  // race numbers so that organizeImage can detect (and reject) any phantom number
  // that leaked through upstream matching. See buildAllowedNumbersSet in unified-image-processor.
  allowedNumbers?: string[];
  // Default behaviour when `allowedNumbers` is set:
  //   - true (default)  → numbers not in the set are logged as a
  //                       `[FolderOrg] phantom number detected` warning and FILTERED OUT
  //                       (routed to Unknown_Numbers if no legitimate number remains).
  //   - false           → telemetry-only: log the warning but still create the folder.
  // Leave undefined to get the safer default (true).
  restrictToAllowedNumbers?: boolean;
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
  // 1.2.0 canonical folder array. Populated by normalizeParticipantPresetFolders
  // upstream, so by the time we read it here it's already reconciled with the
  // legacy slots. Read this instead of folder_1/2/3.
  folders?: { name: string; path?: string }[];
  // 1.2.0 per-participant flag. true = additive (custom folders + default
  // pattern-based folder), false = legacy "all-or-nothing" (custom replaces
  // default). When undefined, treated as true (default-on behavior).
  include_default_folder?: boolean;
  // ⚠️ Legacy fields — kept ONLY as a defensive fallback for any code path
  // that hands us a CsvParticipantData without going through the preset
  // normalizer (e.g. raw CSV imports). Do not read these in business logic
  // when `folders[]` is set.
  folder_1?: string;
  folder_2?: string;
  folder_3?: string;
  folder_1_path?: string;
  folder_2_path?: string;
  folder_3_path?: string;
}

// Resolved folder target with optional absolute path
interface FolderTarget {
  name: string;
  absolutePath?: string;
}

/**
 * Main class for organizing race photos into folders
 */
export class FolderOrganizer {
  private config: FolderOrganizerConfig;
  private createdFolders: Set<string> = new Set();
  private operationLog: FolderOrganizationResult[] = [];

  // Pre-computed allowed-numbers Set for O(1) lookup during organizeImage.
  // null = no restriction configured (legacy behaviour / no preset active).
  private allowedNumbersSet: Set<string> | null = null;
  // Counter of phantom events detected (exposed via getPhantomNumberCount for telemetry).
  private phantomNumberEvents: Array<{ fileName: string; number: string }> = [];

  constructor(config: FolderOrganizerConfig) {
    this.config = config;

    // Set default unknown folder name if not provided
    if (!this.config.unknownFolderName) {
      this.config.unknownFolderName = 'Non_Riconosciuti';
    }

    // Pre-compute allowed-numbers lookup set (issue #105 hardening)
    if (Array.isArray(config.allowedNumbers) && config.allowedNumbers.length > 0) {
      this.allowedNumbersSet = new Set(
        config.allowedNumbers
          .map(n => (typeof n === 'string' ? n.trim() : String(n)))
          .filter(n => n.length > 0)
      );
    }
  }

  /**
   * Issue #105 hardening: validate a list of race numbers against the preset's allowed set.
   * - Returns the filtered list of numbers that are legitimate (or the original list unchanged
   *   when no preset restriction is configured).
   * - Logs `[FolderOrg] phantom number detected` warnings for any rejected number.
   * - Records each phantom event in `phantomNumberEvents` for later telemetry retrieval.
   *
   * This is a defense-in-depth safety net: in the normal flow the upstream matcher
   * (`extractNumbersWithMatches` in unified-image-processor) should already have
   * filtered to preset-only numbers. If a non-preset number ever reaches here, either
   * (a) a future regression re-introduced the bug described in issue #105, or
   * (b) the caller forgot to filter — in both cases we want loud logs + safe behaviour.
   */
  private validateAgainstAllowedNumbers(numbers: string[], fileName: string): string[] {
    if (!this.allowedNumbersSet) {
      return numbers; // No restriction → no-op
    }

    const restrict = this.config.restrictToAllowedNumbers !== false; // default true
    const kept: string[] = [];

    for (const num of numbers) {
      // "unknown" is a valid sentinel used by organizeUnknownImage → always pass through
      if (num === 'unknown') {
        kept.push(num);
        continue;
      }
      if (this.allowedNumbersSet.has(num)) {
        kept.push(num);
      } else {
        this.phantomNumberEvents.push({ fileName, number: num });
        console.warn(
          `[FolderOrg] phantom number detected: "${num}" not in preset (file: ${fileName}). ` +
          `${restrict ? 'Number will be filtered out.' : 'Telemetry-only mode: folder will still be created.'}`
        );
        if (!restrict) {
          // Telemetry-only: keep the number in the output despite the warning
          kept.push(num);
        }
      }
    }

    return kept;
  }

  /**
   * Issue #105 telemetry accessor — returns the list of phantom-number events detected
   * during this organizer's lifetime. Callers (e.g. unified-image-processor) can forward
   * these to their analysis logger for observability.
   */
  public getPhantomNumberEvents(): Array<{ fileName: string; number: string }> {
    return [...this.phantomNumberEvents];
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
      return false; // No XMP handling needed
    }

    const originalXmpPath = this.getXmpSidecarPath(originalImagePath);

    if (!fs.existsSync(originalXmpPath)) {
      return false; // No XMP file to handle
    }

    // Preserve the original extension case (e.g., .XMP or .xmp)
    const originalExt = path.extname(originalXmpPath);
    const targetDir = path.dirname(targetImagePath);
    const targetNameWithoutExt = path.parse(targetImagePath).name;
    const targetXmpPath = path.join(targetDir, `${targetNameWithoutExt}${originalExt}`);

    try {
      if (operation === 'copy') {
        await fsPromises.copyFile(originalXmpPath, targetXmpPath);
      } else {
        await fsPromises.rename(originalXmpPath, targetXmpPath);
      }
      return true;
    } catch (error) {
      console.error(`[FolderOrganizer] Error handling XMP sidecar file ${originalXmpPath}:`, error);
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

    try {
      // Deduplicate race numbers to avoid copying the same file multiple times
      // to the same folder (e.g., when crop+context detects 2 subjects both with number "5")
      const originalNumbers = [...new Set(Array.isArray(raceNumbers) ? raceNumbers : [raceNumbers])];

      // Issue #105 hardening: sanity check against preset allow-list (if configured).
      // When all numbers are phantom AND restriction is active → route to Unknown_Numbers
      // instead of creating a phantom folder. This is defense-in-depth: the upstream
      // matcher should already have filtered, but a regression here would otherwise
      // surface as "folders with numbers not in the preset" (see issue #105).
      const numbers = this.validateAgainstAllowedNumbers(originalNumbers, fileName);
      const allPhantom =
        this.allowedNumbersSet !== null &&
        this.config.restrictToAllowedNumbers !== false &&
        originalNumbers.length > 0 &&
        numbers.length === 0;

      if (allPhantom) {
        console.warn(
          `[FolderOrg] all detected numbers for ${fileName} are phantom (${originalNumbers.join(', ')}) — routing to Unknown_Numbers`
        );
        // Short-circuit to the Unknown_Numbers fallback.
        // Use originalPath if caller passed one via imagePath (it already is imagePath).
        const unknownResult = await this.organizeToUnknownNumbers(
          imagePath,
          sourceDir
        );
        // Mirror the shape expected by the caller, keeping the phantom note in folderName for visibility.
        return {
          ...unknownResult,
          folderName: unknownResult.folderName + ' (phantom-filtered)',
          timeMs: Date.now() - startTime,
        };
      }

      // 1.2.0 — collect custom folders from each participant's canonical
      // `folders[]` array. Falls back to the legacy folder_1/2/3 slots only
      // when `folders` is not present (defensive: this path should be
      // unreachable in production once the preset normalizer has run, but
      // protects raw-CSV imports and any code path that hasn't been
      // migrated yet).
      const customFolderTargets: FolderTarget[] = [];

      if (csvDataArray.length > 0) {
        csvDataArray.forEach(csvData => {
          if (Array.isArray(csvData?.folders) && csvData.folders.length > 0) {
            for (const f of csvData.folders) {
              if (!f || typeof f.name !== 'string' || !f.name.trim()) continue;
              const parsed = this.parseFolderName(f.name.trim(), csvData);
              customFolderTargets.push({
                name: parsed,
                absolutePath: f.path?.trim() || undefined,
              });
            }
          } else {
            // Legacy fallback for un-normalized inputs.
            if (csvData?.folder_1?.trim()) {
              customFolderTargets.push({
                name: this.parseFolderName(csvData.folder_1.trim(), csvData),
                absolutePath: csvData.folder_1_path?.trim() || undefined,
              });
            }
            if (csvData?.folder_2?.trim()) {
              customFolderTargets.push({
                name: this.parseFolderName(csvData.folder_2.trim(), csvData),
                absolutePath: csvData.folder_2_path?.trim() || undefined,
              });
            }
            if (csvData?.folder_3?.trim()) {
              customFolderTargets.push({
                name: this.parseFolderName(csvData.folder_3.trim(), csvData),
                absolutePath: csvData.folder_3_path?.trim() || undefined,
              });
            }
          }
        });
      }

      // Remove duplicates by name+path combination
      const seenKeys = new Set<string>();
      const uniqueFolderTargets = customFolderTargets.filter(ft => {
        const key = ft.absolutePath ? `path:${ft.absolutePath}` : `name:${ft.name}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      // Build the default pattern-based targets (one per detected race number).
      // We use them in two scenarios:
      //   - no custom folders at all → these are the only destinations (legacy)
      //   - at least one matching participant has include_default_folder !== false → additive
      const defaultTargets: FolderTarget[] = numbers.map(num => {
        const matchingCsv = csvDataArray.find(csv => csv.numero === num);
        return { name: this.generateFolderName(num, matchingCsv) };
      });

      // 1.2.0 — per-participant decision. The flag lives on each
      // CsvParticipantData (`include_default_folder`); default true when
      // the field is undefined (i.e. participants from un-normalized
      // sources or pre-flag rows). For multi-match images (e.g. a photo
      // with two cars), if AT LEAST ONE matched participant wants the
      // default folder, we include it — being inclusive is the safer
      // choice and matches the user's mental model ("if any of these
      // drivers wants the {number} folder, copy the photo there too").
      const wantsDefault = csvDataArray.length === 0
        ? true
        : csvDataArray.some(c => c?.include_default_folder !== false);

      // 1.2.0 DECISION TREE:
      //   - no custom folders                    → default targets only (legacy)
      //   - custom folders + wantsDefault=true   → custom + default (additive)
      //   - custom folders + wantsDefault=false  → custom only (legacy behavior)
      let foldersToCreate: FolderTarget[];
      if (uniqueFolderTargets.length === 0) {
        foldersToCreate = defaultTargets;
      } else if (wantsDefault) {
        // Union: custom folders first (so the user-configured destinations
        // are processed before the auto-generated default), default
        // appended at the end. Deduplicate again because a custom folder
        // could happen to share a name with the default (e.g. a chip
        // called "{number}").
        const merged = [...uniqueFolderTargets, ...defaultTargets];
        const mergedSeen = new Set<string>();
        foldersToCreate = merged.filter(ft => {
          const key = ft.absolutePath ? `path:${ft.absolutePath}` : `name:${ft.name}`;
          if (mergedSeen.has(key)) return false;
          mergedSeen.add(key);
          return true;
        });
      } else {
        foldersToCreate = uniqueFolderTargets;
      }

      const baseDir = this.config.destinationPath || sourceDir || path.dirname(imagePath);

      // Ensure parent directory exists if using destinationPath
      if (this.config.destinationPath) {
        await this.ensureFolderExists(this.config.destinationPath);
      }

      const copiedPaths: string[] = [];
      const conflictStrategy = this.config.conflictStrategy || 'rename';
      // Preserve the original source path — we never mutate it during PHASE 1 so
      // every copy reads from the same on-disk file and the original is still
      // available for rollback / inspection if any step fails.
      const originalPath = imagePath;

      // ============================================================
      // PHASE 1 — COPY into every assigned folder
      //
      // We always copy (never rename) during the loop, even when mode='move'.
      // This guarantees the file lands in EVERY folder of EVERY participant
      // before the original is touched. Rationale:
      //   • Multi-participant photos (the bug this fixes): each concorrente
      //     gets the file independently — there is no "first wins, others
      //     copy from the first" coupling that could break if iter 0 skips
      //     for a conflict or fails part-way.
      //   • Robustness: if any copy fails the original is still on disk, so
      //     the user can retry without data loss.
      //   • Determinism: every copy uses the same source, so the output is
      //     identical regardless of iteration order.
      // The actual "move" semantic (delete the original) is deferred to
      // PHASE 2 below and only runs if at least one copy succeeded.
      // ============================================================
      for (let i = 0; i < foldersToCreate.length; i++) {
        const folderTarget = foldersToCreate[i];
        // Use absolute path if set and exists, otherwise fall back to baseDir/name
        let targetFolder: string;
        if (folderTarget.absolutePath && fs.existsSync(folderTarget.absolutePath)) {
          targetFolder = folderTarget.absolutePath;
        } else {
          if (folderTarget.absolutePath) {
            console.warn(`[FolderOrganizer] Absolute path not found: ${folderTarget.absolutePath} — falling back to relative: ${folderTarget.name}`);
          }
          targetFolder = path.join(baseDir, folderTarget.name);
        }

        await this.ensureFolderExists(targetFolder);

        // Compute target filename (apply rename pattern if configured)
        let targetFileName = fileName;
        if (this.config.renamePattern) {
          const csvData = csvDataArray[i] || csvDataArray[0];
          const driverName = csvData ? getDriverNameFromParticipant(csvData) : '';
          const renameContext: RenameContext = {
            original: path.parse(fileName).name,
            extension: path.parse(fileName).ext,
            participant: {
              number: csvData?.numero || '',
              name: driverName,
              surname: extractSurnameFromName(driverName),
              team: (csvData as any)?.squadra || (csvData as any)?.team || '',
              car_model: (csvData as any)?.car_model || '',
              nationality: (csvData as any)?.nationality || '',
            },
            sequenceNumber: i + 1,
            outputFolder: targetFolder,
          };
          const renamedBase = buildFilename(this.config.renamePattern, renameContext);
          targetFileName = renamedBase + path.parse(fileName).ext;
        }

        const targetPath = path.join(targetFolder, targetFileName);
        let finalTargetPath = targetPath;
        let skipThisFolder = false;

        // Handle file name conflicts (per-folder, independent of move/copy mode)
        if (fs.existsSync(targetPath)) {
          if (conflictStrategy === 'skip') {
            skipThisFolder = true;
          } else if (conflictStrategy === 'rename') {
            finalTargetPath = await this.resolveFileNameConflict(targetPath);
          } else if (conflictStrategy === 'overwrite') {
            finalTargetPath = targetPath;
          }
        }

        if (skipThisFolder) {
          continue;
        }

        // Always COPY in PHASE 1 — even when the user requested 'move'.
        await fsPromises.copyFile(originalPath, finalTargetPath);

        // Mirror the XMP sidecar (RAW workflows). Always 'copy' here too;
        // the original sidecar will be removed in PHASE 2 if mode='move'.
        await this.handleXmpSidecar(originalPath, finalTargetPath, 'copy');

        copiedPaths.push(finalTargetPath);
      }

      // ============================================================
      // PHASE 2 — In move mode, delete the original (and its XMP sidecar)
      // only after every copy in PHASE 1 has completed successfully.
      // If no copy succeeded (everything was skipped / conflicted), the
      // original is preserved so the user does not lose data.
      // ============================================================
      let firstOperation: 'copy' | 'move' | 'skip';
      if (copiedPaths.length === 0) {
        firstOperation = 'skip';
      } else if (this.config.mode === 'move') {
        try {
          await fsPromises.unlink(originalPath);

          // Also remove the original XMP sidecar — we already mirrored it
          // to every target folder during PHASE 1.
          if (this.isRawFile(originalPath) && this.config.includeXmpFiles) {
            const originalXmpPath = this.getXmpSidecarPath(originalPath);
            if (fs.existsSync(originalXmpPath)) {
              try {
                await fsPromises.unlink(originalXmpPath);
              } catch (xmpErr) {
                console.warn(`[FolderOrganizer] Failed to delete original XMP sidecar ${originalXmpPath}:`, xmpErr);
              }
            }
          }
          firstOperation = 'move';
        } catch (deleteErr) {
          // Couldn't delete the original — copies are in place but the source
          // survives. Report as 'copy' so the caller's accounting reflects
          // reality (the file was duplicated, not moved).
          console.error(`[FolderOrganizer] Failed to delete original after copying ${originalPath}:`, deleteErr);
          firstOperation = 'copy';
        }
      } else {
        firstOperation = 'copy';
      }

      const result: FolderOrganizationResult = {
        success: true,
        originalPath: originalPath,
        organizedPath: copiedPaths[0],
        folderName: foldersToCreate.map(ft => ft.absolutePath || ft.name).join(', '),
        operation: firstOperation,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[FolderOrganizer] Error organizing ${fileName}:`, errorMsg);

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
          operation = 'skip';
        } else if (conflictStrategy === 'rename') {
          finalTargetPath = await this.resolveFileNameConflict(targetPath);
        } else if (conflictStrategy === 'overwrite') {
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
      console.error(`[FolderOrganizer] Failed to organize ${path.basename(imagePath)} to Unknown_Numbers:`, error);

      return result;
    }
  }

  /**
   * Organize generic/skipped scene image to "Others" folder
   * Used for images that were classified by scene detector but skipped from AI analysis
   * (e.g., crowd_scene, portrait_paddock, podium_celebration)
   */
  async organizeGenericScene(
    imagePath: string,
    sceneCategory?: string,
    sourceDir?: string
  ): Promise<FolderOrganizationResult> {
    const startTime = Date.now();

    try {
      const fileName = path.basename(imagePath);
      const baseDir = sourceDir || this.config.destinationPath || path.dirname(imagePath);

      // Use "Others" as folder name for generic scenes
      const folderName = 'Others';
      const targetDir = path.join(baseDir, folderName);

      await this.ensureFolderExists(targetDir);

      const targetPath = path.join(targetDir, fileName);
      const conflictStrategy = this.config.conflictStrategy || 'rename';
      let finalTargetPath = targetPath;
      let operation: 'copy' | 'move' | 'skip' = this.config.mode;

      // Handle conflicts based on strategy
      if (fs.existsSync(targetPath)) {
        if (conflictStrategy === 'skip') {
          operation = 'skip';
        } else if (conflictStrategy === 'rename') {
          finalTargetPath = await this.resolveFileNameConflict(targetPath);
        } else if (conflictStrategy === 'overwrite') {
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

      return result;

    } catch (error: any) {
      const result: FolderOrganizationResult = {
        success: false,
        originalPath: imagePath,
        folderName: 'Others',
        operation: this.config.mode,
        error: error.message,
        timeMs: Date.now() - startTime
      };

      this.operationLog.push(result);
      console.error(`[FolderOrganizer] Failed to organize ${path.basename(imagePath)} to Others:`, error);

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
    parsedName = parsedName.replace(/\{name\}/g, getDriverNameFromParticipant(csvData));

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
   * Generate folder name based on the configured pattern.
   * For 'number_name', uses participant data to append driver name.
   * For 'custom', uses parseFolderName with customPattern.
   */
  private generateFolderName(raceNumber: string, csvData?: CsvParticipantData): string {
    if (raceNumber === 'unknown') {
      return this.config.unknownFolderName;
    }

    switch (this.config.pattern) {
      case 'number_name': {
        const name = csvData ? getDriverNameFromParticipant(csvData) : '';
        if (name) {
          return this.sanitizeFileName(`${raceNumber} ${name}`);
        }
        return raceNumber; // Fallback if no name available
      }
      case 'custom': {
        if (this.config.customPattern && csvData) {
          return this.parseFolderName(this.config.customPattern, csvData);
        }
        return raceNumber;
      }
      case 'number':
      default:
        return raceNumber;
    }
  }

  /**
   * Sanitize filename to remove invalid characters
   * Note: Spaces are preserved for better readability (works on macOS/Windows)
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, ' ') // Collapse multiple spaces to single space
      .trim()
      .substring(0, 100); // Limit length
  }

  /**
   * Ensure folder exists, create if necessary
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (!fs.existsSync(folderPath)) {
      try {
        await fsPromises.mkdir(folderPath, { recursive: true });
        this.createdFolders.add(folderPath);
      } catch (error: any) {
        // Provide clear error messages for common issues with absolute paths
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          throw new Error(`Permission denied creating folder "${folderPath}". Check that you have write access to this location.`);
        }
        if (error.code === 'ENOENT') {
          // Parent path component doesn't exist - likely unmounted volume
          throw new Error(`Cannot create folder "${folderPath}". The volume or parent directory may not be mounted or accessible.`);
        }
        throw error;
      }
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
    console.error('[FolderOrganizer] Error checking folder organization feature flag:', error);
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
