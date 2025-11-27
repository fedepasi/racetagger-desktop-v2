/**
 * Export Destination Processor
 *
 * Handles exporting images to configured export destinations with:
 * - Filename renaming based on patterns
 * - Subfolder organization
 * - Full IPTC/XMP metadata writing
 * - Multi-destination support (copy to multiple locations)
 *
 * This module integrates with the existing folder organization system
 * and adds support for the new Export Destinations feature.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { ExportDestination } from '../database-service';
import {
  buildFilename,
  buildSubfolderPath,
  SequenceManager,
  SequenceMode,
  RenameContext,
  getSequenceKey
} from './filename-renamer';
import {
  writeFullMetadata,
  ExportDestinationMetadata,
  buildMetadataFromDestination
} from './metadata-writer';

/**
 * Participant data for template resolution
 */
export interface ParticipantMatch {
  numero?: string | number;
  nome?: string;
  name?: string;  // Alias for nome
  surname?: string;
  team?: string;
  squadra?: string;  // Alias for team
  car_model?: string;
  nationality?: string;
  categoria?: string;
}

/**
 * Event info for template resolution
 */
export interface EventInfo {
  name?: string;
  date?: Date;
  city?: string;
  country?: string;
  location?: string;
}

/**
 * Result of exporting a single image
 */
export interface ExportResult {
  success: boolean;
  destinationId: string;
  destinationName: string;
  originalPath: string;
  exportedPath?: string;
  exportedFilename?: string;
  error?: string;
  metadataWritten: boolean;
  timeMs: number;
}

/**
 * Summary of all export operations for an image
 */
export interface ImageExportSummary {
  originalPath: string;
  totalDestinations: number;
  successfulExports: number;
  failedExports: number;
  results: ExportResult[];
  totalTimeMs: number;
}

/**
 * Export Destination Processor
 *
 * Main class for processing image exports to configured destinations.
 */
export class ExportDestinationProcessor {
  private sequenceManagers: Map<string, SequenceManager> = new Map();
  private processedImages: number = 0;
  private totalExports: number = 0;
  private failedExports: number = 0;

  constructor() {
    // Initialize
  }

  /**
   * Get or create a sequence manager for a destination
   */
  private getSequenceManager(destinationId: string): SequenceManager {
    if (!this.sequenceManagers.has(destinationId)) {
      this.sequenceManagers.set(destinationId, new SequenceManager());
    }
    return this.sequenceManagers.get(destinationId)!;
  }

  /**
   * Export a single image to multiple destinations
   *
   * @param imagePath Path to the source image
   * @param destinations Array of export destinations
   * @param participant Matched participant data (for template resolution)
   * @param event Event info (for template resolution)
   * @returns Summary of all export operations
   */
  async exportToDestinations(
    imagePath: string,
    destinations: ExportDestination[],
    participant?: ParticipantMatch,
    event?: EventInfo
  ): Promise<ImageExportSummary> {
    const startTime = Date.now();
    const results: ExportResult[] = [];

    // Filter to active destinations only
    const activeDestinations = destinations.filter(d => d.is_active !== false);

    if (activeDestinations.length === 0) {
      return {
        originalPath: imagePath,
        totalDestinations: 0,
        successfulExports: 0,
        failedExports: 0,
        results: [],
        totalTimeMs: Date.now() - startTime
      };
    }

    console.log(`[ExportProcessor] Exporting ${path.basename(imagePath)} to ${activeDestinations.length} destination(s)`);

    // Process each destination
    for (const destination of activeDestinations) {
      const result = await this.exportToSingleDestination(
        imagePath,
        destination,
        participant,
        event
      );
      results.push(result);
    }

    this.processedImages++;
    this.totalExports += results.filter(r => r.success).length;
    this.failedExports += results.filter(r => !r.success).length;

    return {
      originalPath: imagePath,
      totalDestinations: activeDestinations.length,
      successfulExports: results.filter(r => r.success).length,
      failedExports: results.filter(r => !r.success).length,
      results,
      totalTimeMs: Date.now() - startTime
    };
  }

  /**
   * Export a single image to a single destination
   */
  async exportToSingleDestination(
    imagePath: string,
    destination: ExportDestination,
    participant?: ParticipantMatch,
    event?: EventInfo
  ): Promise<ExportResult> {
    const startTime = Date.now();
    const fileName = path.basename(imagePath);
    const extension = path.extname(imagePath);
    const originalName = path.parse(imagePath).name;

    try {
      // Validate destination has a base folder
      if (!destination.base_folder) {
        throw new Error('Destination has no base folder configured');
      }

      // Ensure base folder exists
      await this.ensureDirectory(destination.base_folder);

      // Build subfolder path
      let targetFolder = destination.base_folder;
      if (destination.subfolder_pattern) {
        const subfolderContext = this.buildRenameContext(
          originalName,
          extension,
          participant,
          event
        );
        const subfolder = buildSubfolderPath(destination.subfolder_pattern, subfolderContext);
        if (subfolder) {
          targetFolder = path.join(destination.base_folder, subfolder);
        }
      }

      // Ensure target folder exists
      await this.ensureDirectory(targetFolder);

      // Build filename
      let targetFilename = fileName;
      if (destination.filename_pattern) {
        const sequenceManager = this.getSequenceManager(destination.id!);
        const mode = this.parseSequenceMode(destination.filename_sequence_mode);
        const context = this.buildRenameContext(
          originalName,
          extension,
          participant,
          event,
          targetFolder
        );

        // Get sequence number
        const seqKey = getSequenceKey(mode, context);
        const seqNum = sequenceManager.getNext(
          mode,
          seqKey,
          destination.filename_sequence_start || 1
        );
        context.sequenceNumber = seqNum;

        const newName = buildFilename(
          destination.filename_pattern,
          context,
          destination.filename_sequence_padding || 3
        );
        targetFilename = newName + extension;
      } else if (destination.preserve_original_name === false) {
        // If no pattern but preserve is false, we still use original
        targetFilename = fileName;
      }

      // Full target path
      const targetPath = path.join(targetFolder, targetFilename);

      // Handle conflicts
      const finalPath = await this.resolveConflict(targetPath);

      // Copy the file
      await fsPromises.copyFile(imagePath, finalPath);
      console.log(`[ExportProcessor] ✓ Copied to ${destination.name}: ${path.basename(finalPath)}`);

      // Write metadata
      let metadataWritten = false;
      try {
        const metadata = this.buildMetadata(destination, participant, event);
        if (this.hasMetadataToWrite(metadata)) {
          await writeFullMetadata(finalPath, metadata);
          metadataWritten = true;
          console.log(`[ExportProcessor] ✓ Wrote metadata to ${path.basename(finalPath)}`);
        }
      } catch (metaError) {
        console.error(`[ExportProcessor] ⚠ Metadata write failed: ${metaError}`);
        // Don't fail the whole export if metadata fails
      }

      return {
        success: true,
        destinationId: destination.id!,
        destinationName: destination.name,
        originalPath: imagePath,
        exportedPath: finalPath,
        exportedFilename: path.basename(finalPath),
        metadataWritten,
        timeMs: Date.now() - startTime
      };

    } catch (error: any) {
      console.error(`[ExportProcessor] ✗ Export failed for ${destination.name}: ${error.message}`);
      return {
        success: false,
        destinationId: destination.id!,
        destinationName: destination.name,
        originalPath: imagePath,
        error: error.message,
        metadataWritten: false,
        timeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Build rename context from participant and event data
   */
  private buildRenameContext(
    originalName: string,
    extension: string,
    participant?: ParticipantMatch,
    event?: EventInfo,
    outputFolder?: string
  ): RenameContext {
    // Normalize participant data
    const normalizedParticipant = participant ? {
      name: participant.nome || participant.name,
      surname: participant.surname,
      number: participant.numero,
      team: participant.squadra || participant.team,
      car_model: participant.car_model,
      nationality: participant.nationality
    } : undefined;

    return {
      original: originalName,
      extension,
      participant: normalizedParticipant,
      event: event?.name,
      date: event?.date || new Date(),
      outputFolder
    };
  }

  /**
   * Build metadata object from destination config
   */
  private buildMetadata(
    destination: ExportDestination,
    participant?: ParticipantMatch,
    event?: EventInfo
  ): ExportDestinationMetadata {
    const metadata: ExportDestinationMetadata = {};

    // Credits
    if (destination.credit) metadata.credit = destination.credit;
    if (destination.source) metadata.source = destination.source;
    if (destination.copyright) metadata.copyright = destination.copyright;
    if (destination.copyright_owner) metadata.copyrightOwner = destination.copyright_owner;

    // Creator
    if (destination.creator) metadata.creator = destination.creator;
    if (destination.authors_position) metadata.authorsPosition = destination.authors_position;
    if (destination.caption_writer) metadata.captionWriter = destination.caption_writer;

    // Location
    if (destination.city || event?.city) metadata.city = destination.city || event?.city;
    if (destination.country || event?.country) metadata.country = destination.country || event?.country;
    if (destination.country_code) metadata.countryCode = destination.country_code;
    if (destination.location || event?.location) metadata.location = destination.location || event?.location;
    if (destination.world_region) metadata.worldRegion = destination.world_region;

    // Contact
    if (destination.contact_email) metadata.contactEmail = destination.contact_email;
    if (destination.contact_website) metadata.contactWebsite = destination.contact_website;
    if (destination.contact_phone) metadata.contactPhone = destination.contact_phone;
    if (destination.contact_address) metadata.contactAddress = destination.contact_address;
    if (destination.contact_city) metadata.contactCity = destination.contact_city;
    if (destination.contact_country) metadata.contactCountry = destination.contact_country;
    if (destination.contact_region) metadata.contactRegion = destination.contact_region;
    if (destination.contact_postal_code) metadata.contactPostalCode = destination.contact_postal_code;

    // Category
    if (destination.category) metadata.category = destination.category;

    // Keywords
    if (destination.base_keywords && destination.base_keywords.length > 0) {
      metadata.keywords = destination.base_keywords;
      metadata.appendKeywords = destination.append_keywords !== false;
    }

    // Templates with participant/event resolution
    if (destination.headline_template && participant) {
      metadata.headline = this.resolveTemplate(destination.headline_template, participant, event);
    }
    if (destination.event_template && event) {
      metadata.event = this.resolveTemplate(destination.event_template, participant, event);
    }
    if (destination.description_template && participant) {
      metadata.description = this.resolveTemplate(destination.description_template, participant, event);
    }
    if (destination.person_shown_template && participant) {
      metadata.personShown = this.resolveTemplate(destination.person_shown_template, participant, event);
    }

    return metadata;
  }

  /**
   * Resolve template placeholders
   */
  private resolveTemplate(
    template: string,
    participant?: ParticipantMatch,
    event?: EventInfo
  ): string {
    if (!template) return template;

    let result = template;

    // Participant placeholders
    if (participant) {
      const name = participant.nome || participant.name || '';
      const surname = participant.surname || (name ? name.split(' ').pop() : '') || '';

      result = result
        .replace(/{name}/g, name)
        .replace(/{surname}/g, surname)
        .replace(/{number}/g, String(participant.numero || ''))
        .replace(/{team}/g, participant.squadra || participant.team || '')
        .replace(/{car_model}/g, participant.car_model || '')
        .replace(/{nationality}/g, participant.nationality || '');
    }

    // Event placeholders
    if (event) {
      result = result
        .replace(/{event}/g, event.name || '')
        .replace(/{city}/g, event.city || '')
        .replace(/{country}/g, event.country || '');

      if (event.date) {
        const d = event.date;
        result = result
          .replace(/{date}/g, d.toISOString().split('T')[0])
          .replace(/{year}/g, d.getFullYear().toString());
      }
    }

    // Clean up any remaining placeholders
    result = result.replace(/{[^}]+}/g, '');

    return result.trim();
  }

  /**
   * Check if metadata object has any values to write
   */
  private hasMetadataToWrite(metadata: ExportDestinationMetadata): boolean {
    return Object.values(metadata).some(v => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== undefined && v !== null && v !== '';
    });
  }

  /**
   * Parse sequence mode string to enum
   */
  private parseSequenceMode(mode?: string): SequenceMode {
    switch (mode) {
      case 'global': return SequenceMode.GLOBAL;
      case 'per_folder': return SequenceMode.PER_FOLDER;
      case 'per_subject':
      default: return SequenceMode.PER_SUBJECT;
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      await fsPromises.mkdir(dirPath, { recursive: true });
      console.log(`[ExportProcessor] Created directory: ${dirPath}`);
    }
  }

  /**
   * Resolve filename conflicts by appending numbers
   */
  private async resolveConflict(targetPath: string): Promise<string> {
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
   * Reset all sequence managers (call before starting a new batch)
   */
  resetSequences(): void {
    this.sequenceManagers.forEach(manager => manager.reset());
    console.log('[ExportProcessor] Reset all sequence managers');
  }

  /**
   * Get processing statistics
   */
  getStats(): { processedImages: number; totalExports: number; failedExports: number } {
    return {
      processedImages: this.processedImages,
      totalExports: this.totalExports,
      failedExports: this.failedExports
    };
  }

  /**
   * Reset all statistics (call before starting a new batch)
   */
  resetStats(): void {
    this.processedImages = 0;
    this.totalExports = 0;
    this.failedExports = 0;
    this.resetSequences();
  }
}

// Export singleton instance
export const exportDestinationProcessor = new ExportDestinationProcessor();
