import * as path from 'path';
import { nativeToolManager } from './native-tool-manager';
import { createXmpSidecar, createFullXmpSidecar } from './xmp-manager';
import { PresetIptcMetadata } from './iptc-types';

/**
 * Known RAW file extensions. For these formats, metadata must be written
 * to an XMP sidecar file instead of directly to the image to avoid
 * overwriting pre-existing metadata (color labels, copyright, etc.).
 */
const RAW_EXTENSIONS = new Set(['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng']);

/**
 * Checks whether a file is a RAW image based on its extension.
 */
function isRawFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return RAW_EXTENSIONS.has(ext);
}

/**
 * Reads existing IPTC keywords from an image file using ExifTool.
 * @param imagePath The absolute path to the image file.
 * @returns Array of existing keywords, or empty array if none found.
 */
async function readExistingKeywords(imagePath: string): Promise<string[]> {
  try {
    const args = ['-s', '-s', '-s', '-IPTC:Keywords', imagePath];
    const result = await nativeToolManager.executeTool('exiftool', args);

    if (result.stdout.trim()) {
      // ExifTool returns keywords separated by semicolons or commas
      // Handle both formats and clean up extra spaces
      const keywords = result.stdout.trim()
        .split(/[;,]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);

      return keywords;
    }

    return [];
  } catch (error) {
    return []; // Return empty array on error, don't fail the entire operation
  }
}

/**
 * Reads existing IPTC SpecialInstructions from an image file using ExifTool.
 * @param imagePath The absolute path to the image file.
 * @returns Existing special instructions string, or empty string if none found.
 */
async function readExistingSpecialInstructions(imagePath: string): Promise<string> {
  try {
    const args = ['-s', '-s', '-s', '-IPTC:SpecialInstructions', imagePath];
    const result = await nativeToolManager.executeTool('exiftool', args);

    if (result.stdout.trim()) {
      return result.stdout.trim();
    }

    return '';
  } catch (error) {
    return ''; // Return empty string on error, don't fail the entire operation
  }
}

/**
 * Reads existing Extended Description from an image file using ExifTool.
 * Uses XMP:Description field for extended description functionality.
 * @param imagePath The absolute path to the image file.
 * @returns Existing extended description string, or empty string if none found.
 */
async function readExistingExtendedDescription(imagePath: string): Promise<string> {
  try {
    const args = ['-s', '-s', '-s', '-XMP:Description', imagePath];
    const result = await nativeToolManager.executeTool('exiftool', args);

    if (result.stdout.trim()) {
      return result.stdout.trim();
    }

    return '';
  } catch (error) {
    return ''; // Return empty string on error, don't fail the entire operation
  }
}

/**
 * Simplifies keywords to IPTC standard format - single words only.
 * Removes ALL prefixes and extracts only the meaningful terms.
 * @param keywords Array of complex keywords with prefixes
 * @returns Array of clean single-word keywords
 */
function simplifyKeywords(keywords: string[]): string[] {
  const simplified: string[] = [];

  for (const keyword of keywords) {
    // Extract content after colons (Number: 9 -> 9)
    if (keyword.includes(':')) {
      const parts = keyword.split(':');
      if (parts.length >= 2) {
        let content = parts[1].trim();

        // Handle multiple values separated by commas or pipes (Drivers: A, B -> A B)
        if (content.includes(',') || content.includes('|')) {
          const subValues = content.split(/[,|]/).map(v => v.trim());
          for (const subValue of subValues) {
            if (subValue) {
              // Split compound names into individual words (John Smith -> John, Smith)
              const words = subValue.split(/\s+/).map(word => sanitizeKeyword(word));
              simplified.push(...words.filter(w => w.length > 1)); // Only keep words longer than 1 char
            }
          }
        } else {
          // Single value - split into individual words
          const words = content.split(/\s+/).map(word => sanitizeKeyword(word));
          simplified.push(...words.filter(w => w.length > 1));
        }
      }
    } else {
      // No colon prefix - treat as regular keyword but split words
      const words = keyword.split(/\s+/).map(word => sanitizeKeyword(word));
      simplified.push(...words.filter(w => w.length > 1));
    }
  }

  // Add 'racetagger' identifier and remove duplicates
  simplified.push('racetagger');
  return [...new Set(simplified.filter(w => w && w.length > 0))]; // Remove duplicates and empty strings
}

/**
 * Sanitizes a keyword to make it compatible with photo management software.
 * @param keyword The keyword to sanitize
 * @returns Sanitized keyword
 */
function sanitizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters except spaces
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .trim()
    .substring(0, 64); // Limit length for compatibility
}

/**
 * Writes keywords to an image file's IPTC:Keywords metadata field using ExifTool.
 * CRITICAL: Preserves ALL existing EXIF/IPTC metadata.
 * The original file quality and all metadata are maintained exactly as they were.
 * @param imagePath The absolute path to the image file.
 * @param keywords Array of keywords to write, or a single keyword string.
 * @param useSimplified Whether to simplify complex keywords for better compatibility (default: true)
 * @param mode Whether to 'append' to existing keywords or 'overwrite' them (default: 'append')
 * @returns A promise that resolves when the operation is complete.
 */
export async function writeKeywordsToImage(imagePath: string, keywords: string[] | string, useSimplified: boolean = true, mode: 'append' | 'overwrite' = 'append'): Promise<void> {
  try {
    // Convert keywords to array if it's a single string
    const newKeywords = Array.isArray(keywords) ? keywords : [keywords];

    // Filter empty keywords
    let filteredNewKeywords = newKeywords.filter(k => k && k.trim().length > 0);
    if (filteredNewKeywords.length === 0) {
      return;
    }

    // Simplify keywords if requested
    if (useSimplified) {
      filteredNewKeywords = simplifyKeywords(filteredNewKeywords);
    }

    // RAW files: write to XMP sidecar instead of directly to the file
    if (isRawFile(imagePath)) {
      await createXmpSidecar(imagePath, filteredNewKeywords);
      return;
    }

    // Build ExifTool arguments based on mode
    // CRITICAL: Preserve all existing metadata while writing keywords
    // -overwrite_original: Modifies the file in place, without creating a backup
    // -P: Preserve file modification date/time
    // -codedcharacterset=utf8: Handle special characters correctly
    const args = [
      '-overwrite_original',
      '-P', // Preserve file timestamp
      '-codedcharacterset=utf8', // Handle UTF-8 characters
    ];

    if (mode === 'overwrite') {
      // Overwrite mode: replace all existing keywords
      // First clear existing keywords, then add new ones
      args.push('-IPTC:Keywords=');
      for (const keyword of filteredNewKeywords) {
        args.push(`-IPTC:Keywords+=${keyword}`);
      }
    } else {
      // Append mode: add to existing keywords (default behavior)
      const existingKeywords = await readExistingKeywords(imagePath);

      // Filter out duplicates (case-insensitive)
      const uniqueNewKeywords: string[] = [];
      for (const newKeyword of filteredNewKeywords) {
        const normalizedNew = newKeyword.toLowerCase().trim();
        const exists = existingKeywords.some(existing => existing.toLowerCase().trim() === normalizedNew);
        if (!exists) {
          uniqueNewKeywords.push(newKeyword.trim());
        }
      }

      // Add each new unique keyword individually to avoid IPTC:Keywords 64-character limit
      for (const keyword of uniqueNewKeywords) {
        args.push(`-IPTC:Keywords+=${keyword}`);
      }
    }

    args.push(imagePath);

    await nativeToolManager.executeTool('exiftool', args);
  } catch (error) {
    console.error(`[MetadataWriter] Failed to write metadata:`, error);
    throw new Error(`Failed to write metadata with ExifTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Writes data to IPTC:SpecialInstructions field with RaceTagger prefix.
 * CRITICAL: Preserves existing instructions and APPENDS or UPDATES RaceTagger data.
 * @param imagePath The absolute path to the image file.
 * @param raceData The race data to write (will be prefixed with "RaceTagger: ").
 * @returns A promise that resolves when the operation is complete.
 */
export async function writeSpecialInstructions(imagePath: string, raceData: string): Promise<void> {
  try {
    if (!raceData || raceData.trim().length === 0) {
      return;
    }

    // RAW files: write to XMP sidecar instead of directly to the file
    if (isRawFile(imagePath)) {
      const formattedData = `RaceTagger: ${raceData.trim()}`;
      await createXmpSidecar(imagePath, ['racetagger'], formattedData);
      return;
    }

    // Read existing special instructions
    const existingInstructions = await readExistingSpecialInstructions(imagePath);

    // Format new RaceTagger data with prefix
    const raceTaggerData = `RaceTagger: ${raceData.trim()}`;

    let finalInstructions: string;

    if (existingInstructions) {
      // Check if there's already RaceTagger data to update
      const raceTaggerPattern = /RaceTagger:\s*[^\|]*(?:\|[^\|]*)*(?=\s*\||$)/;
      const existingRaceTaggerMatch = existingInstructions.match(raceTaggerPattern);

      if (existingRaceTaggerMatch) {
        // Update existing RaceTagger data
        finalInstructions = existingInstructions.replace(raceTaggerPattern, raceTaggerData);
      } else {
        // Append to existing instructions
        finalInstructions = `${existingInstructions} | ${raceTaggerData}`;
      }
    } else {
      // No existing instructions, use only RaceTagger data
      finalInstructions = raceTaggerData;
    }

    // Ensure we don't exceed 256 character limit for IPTC:SpecialInstructions
    if (finalInstructions.length > 256) {
      finalInstructions = finalInstructions.substring(0, 253) + '...';
    }

    // Write to image using ExifTool
    const args = [
      '-overwrite_original',
      '-P', // Preserve file timestamp
      '-codedcharacterset=utf8', // Handle UTF-8 characters
      `-IPTC:SpecialInstructions=${finalInstructions}`,
      imagePath
    ];

    await nativeToolManager.executeTool('exiftool', args);
  } catch (error) {
    console.error(`[MetadataWriter] Failed to write special instructions:`, error);
    throw new Error(`Failed to write special instructions with ExifTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Writes data to XMP:Description field as Extended Description.
 * CRITICAL: Preserves existing descriptions based on mode.
 * @param imagePath The absolute path to the image file.
 * @param raceData The race data to write.
 * @param mode Whether to 'append' to existing description or 'overwrite' it (default: 'append')
 * @returns A promise that resolves when the operation is complete.
 */
export async function writeExtendedDescription(imagePath: string, raceData: string, mode: 'append' | 'overwrite' = 'append'): Promise<void> {
  try {
    if (!raceData || raceData.trim().length === 0) {
      return;
    }

    // RAW files: write to XMP sidecar instead of directly to the file
    if (isRawFile(imagePath)) {
      await createXmpSidecar(imagePath, ['racetagger'], raceData.trim());
      return;
    }

    let finalDescription: string;

    if (mode === 'overwrite') {
      // Overwrite mode: use only the new data
      finalDescription = raceData.trim();
    } else {
      // Append mode: add to existing description
      const existingDescription = await readExistingExtendedDescription(imagePath);

      if (existingDescription) {
        // Append to existing description with separator
        finalDescription = `${existingDescription}\n\n${raceData.trim()}`;
      } else {
        // No existing description, use new data
        finalDescription = raceData.trim();
      }
    }

    // Write to image using ExifTool
    const args = [
      '-overwrite_original',
      '-P', // Preserve file timestamp
      '-codedcharacterset=utf8', // Handle UTF-8 characters
      `-XMP:Description=${finalDescription}`,
      imagePath
    ];

    await nativeToolManager.executeTool('exiftool', args);
  } catch (error) {
    console.error(`[MetadataWriter] Failed to write extended description:`, error);
    throw new Error(`Failed to write extended description with ExifTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Legacy function - writes a single description as a keyword.
 * @deprecated Use writeKeywordsToImage instead for better control over keywords.
 */
export async function writeDescriptionToImage(imagePath: string, description: string): Promise<void> {
  return writeKeywordsToImage(imagePath, [description]);
}

/**
 * Writes Person In Image (IPTC Extension) metadata field using ExifTool.
 * This field identifies the person(s) shown in the image, commonly used by agencies.
 * Format example: "Charles Leclerc (MON) Ferrari SF-25"
 * @param imagePath The absolute path to the image file.
 * @param personNames Single person name or array of person names to write.
 * @returns A promise that resolves when the operation is complete.
 */
export async function writePersonInImage(
  imagePath: string,
  personNames: string | string[]
): Promise<void> {
  try {
    const names = Array.isArray(personNames) ? personNames : [personNames];

    // Filter empty names
    const filteredNames = names.filter(n => n && n.trim().length > 0);
    if (filteredNames.length === 0) {
      return;
    }

    // RAW files: write to XMP sidecar instead of directly to the file
    if (isRawFile(imagePath)) {
      await createXmpSidecar(imagePath, filteredNames);
      return;
    }

    // Build ExifTool arguments
    // XMP-iptcExt:PersonInImage is the standard IPTC Extension field for identifying persons
    const args = [
      '-overwrite_original',
      '-P', // Preserve file timestamp
      '-codedcharacterset=utf8', // Handle UTF-8 characters
    ];

    // Add each person as a separate PersonInImage entry
    for (const name of filteredNames) {
      args.push(`-XMP-iptcExt:PersonInImage=${name.trim()}`);
    }

    args.push(imagePath);

    await nativeToolManager.executeTool('exiftool', args);
  } catch (error) {
    console.error(`[MetadataWriter] Failed to write PersonInImage:`, error);
    throw new Error(`Failed to write PersonInImage with ExifTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Builds a Person Shown string from a template and participant data.
 * Template placeholders: {name}, {surname}, {number}, {team}, {car_model}, {nationality}
 * @param template The template string, e.g., "{name} ({nationality}) {team} {car_model}"
 * @param participant The participant data object
 * @returns The formatted Person Shown string
 */
export function buildPersonShownString(
  template: string,
  participant: {
    name?: string;
    surname?: string;
    number?: string | number;
    team?: string;
    car_model?: string;
    nationality?: string;
  }
): string {
  if (!template) {
    // Default template if none provided
    template = '{name}';
  }

  let result = template;

  // Extract surname from full name if not provided separately
  const surname = participant.surname ||
    (participant.name ? participant.name.split(' ').pop() : '');

  // Replace placeholders with actual values
  const replacements: Record<string, string> = {
    '{name}': participant.name || '',
    '{surname}': surname || '',
    '{number}': String(participant.number || ''),
    '{team}': participant.team || '',
    '{car_model}': participant.car_model || '',
    '{nationality}': participant.nationality || '',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  // Clean up multiple spaces and trim
  result = result.replace(/\s+/g, ' ').trim();

  // Remove empty parentheses like "() " or " ()"
  result = result.replace(/\(\s*\)/g, '').trim();

  // Remove trailing/leading separators
  result = result.replace(/^\s*[-|,]\s*|\s*[-|,]\s*$/g, '').trim();

  return result;
}

/**
 * Build the extended name string for a participant.
 * Format: "({number}) {name} ({nationality}) - {team} - {car_model}"
 * Example: "(1) Lando Norris (GBR) - McLaren Mastercard F1 Team - McLaren MCL40 - Mercedes"
 *
 * Omits parts gracefully if data is missing:
 *  - No number  → "Lando Norris (GBR) - McLaren..."
 *  - No nationality → "(1) Lando Norris - McLaren..."
 *  - Only name → "Lando Norris"
 */
export function buildExtendedName(participant: {
  name?: string;
  number?: string | number;
  team?: string;
  car_model?: string;
  nationality?: string;
}): string {
  if (!participant.name) return '';

  const parts: string[] = [];

  // ({number}) {name} ({nationality})
  let nameBlock = '';
  if (participant.number) {
    nameBlock += `(${participant.number}) `;
  }
  nameBlock += participant.name;
  if (participant.nationality) {
    nameBlock += ` (${participant.nationality})`;
  }
  parts.push(nameBlock);

  // Team
  if (participant.team) {
    parts.push(participant.team);
  }

  // Car model (e.g. "McLaren MCL40 - Mercedes")
  if (participant.car_model) {
    parts.push(participant.car_model);
  }

  return parts.join(' - ');
}

/**
 * Build simple name string for keywords. Just the participant name.
 * For multi-match, returns individual names array (not joined).
 */
export function buildSimpleName(participant: {
  name?: string;
}): string {
  return participant.name || '';
}

/**
 * Resolve the personShown value based on personShownFormat setting.
 *
 * @param format 'simple' | 'extended' | 'custom' (defaults to 'simple' for backward compat)
 * @param template Custom template string (used only when format='custom')
 * @param participant Participant data
 * @returns The resolved person shown string
 */
export function resolvePersonShown(
  format: 'simple' | 'extended' | 'custom' | undefined,
  template: string | undefined,
  participant: {
    name?: string;
    surname?: string;
    number?: string | number;
    team?: string;
    car_model?: string;
    nationality?: string;
  }
): string {
  if (!participant.name) return '';

  switch (format) {
    case 'extended':
      return buildExtendedName(participant);

    case 'custom':
      return buildPersonShownString(template || '{name}', participant);

    case 'simple':
    default:
      // Backward compatible — if there's a template, use it; otherwise just name
      if (template && template !== '{name}') {
        return buildPersonShownString(template, participant);
      }
      return participant.name;
  }
}

/**
 * Interface for full metadata from Export Destination
 * Covers all IPTC/XMP fields supported by Photo Mechanic and news agencies
 */
export interface ExportDestinationMetadata {
  // Credits
  credit?: string;              // IPTC:Credit / photoshop:Credit
  source?: string;              // IPTC:Source / photoshop:Source
  copyright?: string;           // IPTC:CopyrightNotice / dc:rights
  copyrightOwner?: string;      // XMP-plus:CopyrightOwnerName

  // Creator
  creator?: string;             // IPTC:By-line / dc:creator
  authorsPosition?: string;     // IPTC:By-lineTitle / photoshop:AuthorsPosition
  captionWriter?: string;       // IPTC:Writer-Editor / photoshop:CaptionWriter

  // Event Info
  headline?: string;            // IPTC:Headline / photoshop:Headline
  title?: string;               // XMP-dc:Title
  description?: string;         // IPTC:Caption-Abstract / dc:description
  event?: string;               // XMP-iptcExt:Event
  category?: string;            // IPTC:Category / photoshop:Category (e.g. "SPO")

  // Location
  city?: string;                // IPTC:City / photoshop:City
  country?: string;             // IPTC:Country-PrimaryLocationName / photoshop:Country
  countryCode?: string;         // IPTC:Country-PrimaryLocationCode / Iptc4xmpCore:CountryCode
  location?: string;            // IPTC:Sub-location / Iptc4xmpCore:Location
  worldRegion?: string;         // XMP-iptcExt:LocationCreatedWorldRegion

  // Contact Info — written via ExifTool flat aliases on XMP-iptcCore that
  // expand into the canonical Iptc4xmpCore:CreatorContactInfo struct.
  contactAddress?: string;      // XMP-iptcCore:CreatorAddress         → CiAdrExtadr
  contactCity?: string;         // XMP-iptcCore:CreatorCity            → CiAdrCity
  contactRegion?: string;       // XMP-iptcCore:CreatorRegion          → CiAdrRegion
  contactPostalCode?: string;   // XMP-iptcCore:CreatorPostalCode      → CiAdrPcode
  contactCountry?: string;      // XMP-iptcCore:CreatorCountry         → CiAdrCtry
  contactPhone?: string;        // XMP-iptcCore:CreatorWorkTelephone   → CiTelWork
  contactEmail?: string;        // XMP-iptcCore:CreatorWorkEmail       → CiEmailWork
  contactWebsite?: string;      // XMP-iptcCore:CreatorWorkURL         → CiUrlWork

  // Keywords
  keywords?: string[];          // IPTC:Keywords
  appendKeywords?: boolean;     // If true, append to existing keywords

  // Person Shown
  personShown?: string | string[];  // XMP-iptcExt:PersonInImage

  // === EXTENDED IPTC FIELDS (IPTC Pro) ===
  copyrightMarked?: boolean;        // XMP-xmpRights:Marked (True/False)
  copyrightUrl?: string;            // XMP-xmpRights:WebStatement
  intellectualGenre?: string;       // XMP-iptcCore:IntellectualGenre
  digitalSourceType?: string;       // XMP-iptcExt:DigitalSourceType (full URI)
  modelReleaseStatus?: string;      // XMP-plus:ModelReleaseStatus (full URI)
  scene?: string[];                 // XMP-iptcCore:Scene (e.g. ["SPO"])
  urgency?: string;                 // IPTC:Urgency + XMP-photoshop:Urgency ("1"-"8")
  dateCreated?: string;             // IPTC:DateCreated + XMP-photoshop:DateCreated
  provinceState?: string;           // IPTC:Province-State + XMP-iptcCore:ProvinceState
}

/**
 * Writes comprehensive IPTC/XMP metadata to an image file.
 * Used by Export Destinations to apply agency-specific metadata.
 *
 * @param imagePath The absolute path to the image file
 * @param metadata The metadata object containing all fields to write
 * @returns A promise that resolves when the operation is complete
 */
export async function writeFullMetadata(
  imagePath: string,
  metadata: ExportDestinationMetadata,
  options: { replaceAll?: boolean } = {}
): Promise<void> {
  const { replaceAll = false } = options;
  try {
    // RAW files: write to XMP sidecar instead of directly to the file.
    // For RAW the sidecar IS a fresh document on each write, so the
    // "merge vs replace" distinction does not apply — the sidecar always
    // contains exactly what we generate.
    if (isRawFile(imagePath)) {
      // Check if we have full IPTC metadata (IPTC Pro mode) — use createFullXmpSidecar
      const hasFullMetadata = metadata.credit || metadata.copyright || metadata.creator
        || metadata.contactEmail || metadata.copyrightMarked !== undefined
        || metadata.digitalSourceType || metadata.modelReleaseStatus;

      if (hasFullMetadata) {
        // Full IPTC Pro mode: write all metadata to XMP sidecar
        await createFullXmpSidecar(imagePath, metadata);
        return;
      }

      // Basic mode: collect keywords and description for simple XMP sidecar
      const sidecarKeywords: string[] = [];
      if (metadata.keywords && metadata.keywords.length > 0) {
        sidecarKeywords.push(...metadata.keywords.filter(k => k && k.trim()));
      }
      if (metadata.personShown) {
        const persons = Array.isArray(metadata.personShown) ? metadata.personShown : [metadata.personShown];
        sidecarKeywords.push(...persons.filter(p => p && p.trim()));
      }
      // Add credit/creator info as keywords for searchability
      if (metadata.credit) sidecarKeywords.push(metadata.credit);
      if (metadata.creator) sidecarKeywords.push(metadata.creator);
      sidecarKeywords.push('racetagger');

      const description = metadata.description || metadata.headline || undefined;
      await createXmpSidecar(imagePath, sidecarKeywords.length > 0 ? sidecarKeywords : ['racetagger'], description);
      return;
    }

    const args: string[] = [
      '-overwrite_original',
      '-P', // Preserve file timestamp
      '-codedcharacterset=utf8', // Handle UTF-8 characters
    ];

    // === REPLACE MODE ===
    // When the user picked "Replace" in the Write Behavior modal, clear all
    // IPTC IIM tags and the XMP namespaces this writer touches BEFORE writing
    // the new values. Order matters: the deletes must be the first arguments
    // so they apply to the original file state, then the per-tag writes
    // re-populate only what the preset specifies.
    //
    // Scope: IPTC:All + the seven XMP namespaces this writer ever uses.
    //   - XMP-iptcCore  / XMP-iptcExt  → IPTC PhotoMetadata 2024 fields
    //   - XMP-photoshop                → legacy Photoshop equivalents
    //   - XMP-dc                       → Dublin Core (Title, Creator, Rights)
    //   - XMP-plus                     → PLUS (Model Release, License)
    //   - XMP-xmpRights                → Marked, WebStatement
    // EXIF (camera data, GPS, exposure) is intentionally NOT cleared — that's
    // hardware-recorded info, not editorial metadata.
    if (replaceAll) {
      args.push('-IPTC:All=');
      args.push('-XMP-iptcCore:All=');
      args.push('-XMP-iptcExt:All=');
      args.push('-XMP-photoshop:All=');
      args.push('-XMP-dc:All=');
      args.push('-XMP-plus:All=');
      args.push('-XMP-xmpRights:All=');
    }

    // === CREDITS ===
    if (metadata.credit) {
      args.push(`-IPTC:Credit=${metadata.credit}`);
      args.push(`-XMP-photoshop:Credit=${metadata.credit}`);
    }
    if (metadata.source) {
      args.push(`-IPTC:Source=${metadata.source}`);
      args.push(`-XMP-photoshop:Source=${metadata.source}`);
    }
    if (metadata.copyright) {
      args.push(`-IPTC:CopyrightNotice=${metadata.copyright}`);
      args.push(`-XMP-dc:Rights=${metadata.copyright}`);
    }
    if (metadata.copyrightOwner) {
      args.push(`-XMP-plus:CopyrightOwnerName=${metadata.copyrightOwner}`);
    }

    // === CREATOR INFO ===
    if (metadata.creator) {
      args.push(`-IPTC:By-line=${metadata.creator}`);
      args.push(`-XMP-dc:Creator=${metadata.creator}`);
    }
    if (metadata.authorsPosition) {
      args.push(`-IPTC:By-lineTitle=${metadata.authorsPosition}`);
      args.push(`-XMP-photoshop:AuthorsPosition=${metadata.authorsPosition}`);
    }
    if (metadata.captionWriter) {
      args.push(`-IPTC:Writer-Editor=${metadata.captionWriter}`);
      args.push(`-XMP-photoshop:CaptionWriter=${metadata.captionWriter}`);
    }

    // === EVENT INFO ===
    if (metadata.headline) {
      args.push(`-IPTC:Headline=${metadata.headline}`);
      args.push(`-XMP-photoshop:Headline=${metadata.headline}`);
    }
    if (metadata.title) {
      args.push(`-XMP-dc:Title=${metadata.title}`);
    }
    if (metadata.description) {
      args.push(`-IPTC:Caption-Abstract=${metadata.description}`);
      args.push(`-XMP-dc:Description=${metadata.description}`);
    }
    if (metadata.event) {
      args.push(`-XMP-iptcExt:Event=${metadata.event}`);
    }
    if (metadata.category) {
      args.push(`-IPTC:Category=${metadata.category}`);
      args.push(`-XMP-photoshop:Category=${metadata.category}`);
    }

    // === LOCATION ===
    if (metadata.city) {
      args.push(`-IPTC:City=${metadata.city}`);
      args.push(`-XMP-photoshop:City=${metadata.city}`);
    }
    if (metadata.country) {
      args.push(`-IPTC:Country-PrimaryLocationName=${metadata.country}`);
      args.push(`-XMP-photoshop:Country=${metadata.country}`);
    }
    if (metadata.countryCode) {
      args.push(`-IPTC:Country-PrimaryLocationCode=${metadata.countryCode}`);
      args.push(`-XMP-iptcCore:CountryCode=${metadata.countryCode}`);
    }
    if (metadata.location) {
      args.push(`-IPTC:Sub-location=${metadata.location}`);
      args.push(`-XMP-iptcCore:Location=${metadata.location}`);
    }
    if (metadata.worldRegion) {
      args.push(`-XMP-iptcExt:LocationCreatedWorldRegion=${metadata.worldRegion}`);
    }

    // === CONTACT INFO ===
    // CreatorContactInfo is an XMP struct in the Iptc4xmpCore namespace. The
    // bundled ExifTool binary (vendor/darwin/exiftool, see XMP.pm lines
    // 1270-1316) exposes the eight nested fields via convenience FLAT
    // ALIASES on the XMP-iptcCore namespace — `CreatorAddress`,
    // `CreatorCity`, `CreatorRegion`, `CreatorPostalCode`, `CreatorCountry`,
    // `CreatorWorkTelephone`, `CreatorWorkEmail`, `CreatorWorkURL`. Writing
    // any of these auto-creates the parent `CreatorContactInfo` resource
    // with the correct `Iptc4xmpCore:Ci*` element, which is exactly what
    // Photo Mechanic / Adobe Bridge persist on disk (canonical IPTC
    // PhotoMetadata 2024 layout).
    //
    // Earlier syntaxes that did NOT work with this binary:
    //   -XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiAdrCity=value (slash)
    //   -XMP-iptcCore:CreatorContactInfoCiAdrCity=value (concatenated flat)
    // Both produced "Tag '...' is not defined" warnings (silent on stderr,
    // exit code 0) so the contact block was dropped from every export.
    if (metadata.contactAddress) {
      args.push(`-XMP-iptcCore:CreatorAddress=${metadata.contactAddress}`);
    }
    if (metadata.contactCity) {
      args.push(`-XMP-iptcCore:CreatorCity=${metadata.contactCity}`);
    }
    if (metadata.contactRegion) {
      args.push(`-XMP-iptcCore:CreatorRegion=${metadata.contactRegion}`);
    }
    if (metadata.contactPostalCode) {
      args.push(`-XMP-iptcCore:CreatorPostalCode=${metadata.contactPostalCode}`);
    }
    if (metadata.contactCountry) {
      args.push(`-XMP-iptcCore:CreatorCountry=${metadata.contactCountry}`);
    }
    if (metadata.contactPhone) {
      args.push(`-XMP-iptcCore:CreatorWorkTelephone=${metadata.contactPhone}`);
    }
    if (metadata.contactEmail) {
      args.push(`-XMP-iptcCore:CreatorWorkEmail=${metadata.contactEmail}`);
    }
    if (metadata.contactWebsite) {
      args.push(`-XMP-iptcCore:CreatorWorkURL=${metadata.contactWebsite}`);
    }

    // === KEYWORDS ===
    if (metadata.keywords && metadata.keywords.length > 0) {
      if (metadata.appendKeywords !== false) {
        // Append mode: add keywords one by one
        for (const keyword of metadata.keywords) {
          if (keyword && keyword.trim()) {
            args.push(`-IPTC:Keywords+=${keyword.trim()}`);
          }
        }
      } else {
        // Overwrite mode: clear then add
        args.push('-IPTC:Keywords=');
        for (const keyword of metadata.keywords) {
          if (keyword && keyword.trim()) {
            args.push(`-IPTC:Keywords+=${keyword.trim()}`);
          }
        }
      }
    }

    // === PERSON SHOWN ===
    if (metadata.personShown) {
      const persons = Array.isArray(metadata.personShown)
        ? metadata.personShown
        : [metadata.personShown];
      for (const person of persons) {
        if (person && person.trim()) {
          args.push(`-XMP-iptcExt:PersonInImage=${person.trim()}`);
        }
      }
    }

    // === EXTENDED IPTC PRO FIELDS ===
    if (metadata.copyrightMarked !== undefined) {
      args.push(`-XMP-xmpRights:Marked=${metadata.copyrightMarked ? 'True' : 'False'}`);
    }
    if (metadata.copyrightUrl) {
      args.push(`-XMP-xmpRights:WebStatement=${metadata.copyrightUrl}`);
    }
    if (metadata.intellectualGenre) {
      args.push(`-XMP-iptcCore:IntellectualGenre=${metadata.intellectualGenre}`);
    }
    if (metadata.digitalSourceType) {
      args.push(`-XMP-iptcExt:DigitalSourceType=${metadata.digitalSourceType}`);
    }
    if (metadata.modelReleaseStatus) {
      // PLUS persists ModelReleaseStatus as a controlled-vocab URI
      // (`http://ns.useplus.org/ldf/vocab/<CODE>` per PLUS LDF 2.0.1) — that's
      // what Photo Mechanic and Adobe Bridge write to disk.
      //
      // Two pitfalls handled here:
      //  1. The IPTC Pro dropdown stores SHORT CODES (MR-NON, MR-NAP, MR-LMR,
      //     MR-UMR, MR-UPR, MR-LPR), so we expand them to the full PLUS URI.
      //  2. ExifTool's PrintConv in PLUS.pm rejects BOTH the short codes
      //     ("not in PrintConv") AND custom URIs unless they exactly match
      //     one of the labels Phil hardcoded. The robust fix is to suffix
      //     the tag name with `#`, which tells ExifTool "no print conversion,
      //     write the raw value as-is" (https://exiftool.org/exiftool_pod.html
      //     — see the `#` operator on -TAG=VALUE). This is the same trick
      //     Photo Mechanic uses internally (it bypasses its own enum
      //     validation when writing PLUS controlled vocab fields).
      const code = String(metadata.modelReleaseStatus).trim();
      const value = /^https?:\/\//i.test(code)
        ? code
        : `http://ns.useplus.org/ldf/vocab/${code}`;
      args.push(`-XMP-plus:ModelReleaseStatus#=${value}`);
    }
    if (metadata.scene && metadata.scene.length > 0) {
      for (const sceneCode of metadata.scene) {
        if (sceneCode && sceneCode.trim()) {
          args.push(`-XMP-iptcCore:Scene=${sceneCode.trim()}`);
        }
      }
    }
    if (metadata.urgency) {
      args.push(`-IPTC:Urgency=${metadata.urgency}`);
      args.push(`-XMP-photoshop:Urgency=${metadata.urgency}`);
    }
    if (metadata.dateCreated) {
      args.push(`-IPTC:DateCreated=${metadata.dateCreated}`);
      args.push(`-XMP-photoshop:DateCreated=${metadata.dateCreated}`);
    }
    if (metadata.provinceState) {
      // Photo location State/Province lives in `IPTC:Province-State` (IIM)
      // and `XMP-photoshop:State` (XMP) — that's the MWG-recommended pair
      // and what Photo Mechanic / Adobe Bridge write. The previous attempt
      // to mirror it to `XMP-iptcCore:ProvinceState` was wrong: that tag
      // does not exist in the IPTC Core schema (the iptcCore "region" is a
      // sub-field of CreatorContactInfo, not a top-level photo-location
      // property), so ExifTool emitted a "Tag not defined" warning and
      // dropped the value from XMP. Confirmed by reading XMP.pm in the
      // bundled binary (no top-level ProvinceState in iptcCore).
      args.push(`-IPTC:Province-State=${metadata.provinceState}`);
      args.push(`-XMP-photoshop:State=${metadata.provinceState}`);
    }

    // Only proceed if we have metadata to write. The setup-args baseline is
    // 3 (overwrite_original / -P / charset) plus 7 more when replaceAll
    // pre-clears the namespaces — so the "no-op" threshold is dynamic.
    const setupArgsCount = 3 + (replaceAll ? 7 : 0);
    if (args.length <= setupArgsCount) {
      return;
    }

    args.push(imagePath);

    // We surface ExifTool stderr (warnings) explicitly because executeTool()
    // only rejects on a non-zero exit code while ExifTool emits "Tag not
    // defined" / "Can't convert" as warnings with exit 0. Without this log
    // the previous CreatorContactInfo / ProvinceState / ModelReleaseStatus
    // syntax bugs would have stayed silent for another release cycle.
    const exifResult = await nativeToolManager.executeTool('exiftool', args);
    if (exifResult.stderr && exifResult.stderr.trim()) {
      console.warn(`[MetadataWriter] ExifTool stderr for ${path.basename(imagePath)}:\n${exifResult.stderr.trim()}`);
    }
  } catch (error) {
    console.error(`[MetadataWriter] Failed to write full metadata:`, error);
    throw new Error(`Failed to write full metadata with ExifTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Builds metadata object from Export Destination and participant data
 * Resolves template placeholders in fields like headline, title, description, event
 */
export function buildMetadataFromDestination(
  destination: {
    credit?: string;
    source?: string;
    copyright?: string;
    copyright_owner?: string;
    creator?: string;
    authors_position?: string;
    caption_writer?: string;
    headline_template?: string;
    title_template?: string;
    description_template?: string;
    event_template?: string;
    category?: string;
    city?: string;
    country?: string;
    country_code?: string;
    location?: string;
    world_region?: string;
    contact_address?: string;
    contact_city?: string;
    contact_region?: string;
    contact_postal_code?: string;
    contact_country?: string;
    contact_phone?: string;
    contact_email?: string;
    contact_website?: string;
    base_keywords?: string[];
    append_keywords?: boolean;
    person_shown_template?: string;
  },
  participant?: {
    name?: string;
    surname?: string;
    number?: string | number;
    team?: string;
    car_model?: string;
    nationality?: string;
  },
  eventInfo?: {
    eventName?: string;
    date?: Date;
  }
): ExportDestinationMetadata {
  // Helper to resolve template placeholders
  const resolveTemplate = (template?: string): string | undefined => {
    if (!template) return undefined;

    let result = template;

    // Participant placeholders
    if (participant) {
      const surname = participant.surname ||
        (participant.name ? participant.name.split(' ').pop() : '');

      result = result
        .replace(/\{name\}/g, participant.name || '')
        .replace(/\{surname\}/g, surname || '')
        .replace(/\{number\}/g, String(participant.number || ''))
        .replace(/\{team\}/g, participant.team || '')
        .replace(/\{car_model\}/g, participant.car_model || '')
        .replace(/\{nationality\}/g, participant.nationality || '');
    }

    // Event placeholders
    if (eventInfo) {
      result = result
        .replace(/\{event\}/g, eventInfo.eventName || '');

      if (eventInfo.date) {
        const d = eventInfo.date;
        const dateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        result = result.replace(/\{date\}/g, dateStr);
      }
    }

    // Clean up
    result = result
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return result || undefined;
  };

  // Build person shown string
  let personShown: string | undefined;
  if (destination.person_shown_template && participant?.name) {
    personShown = buildPersonShownString(destination.person_shown_template, participant);
  }

  return {
    // Credits
    credit: destination.credit,
    source: destination.source,
    copyright: destination.copyright,
    copyrightOwner: destination.copyright_owner,

    // Creator
    creator: destination.creator,
    authorsPosition: destination.authors_position,
    captionWriter: destination.caption_writer,

    // Event Info (resolved from templates)
    headline: resolveTemplate(destination.headline_template),
    title: resolveTemplate(destination.title_template),
    description: resolveTemplate(destination.description_template),
    event: resolveTemplate(destination.event_template),
    category: destination.category,

    // Location
    city: destination.city,
    country: destination.country,
    countryCode: destination.country_code,
    location: destination.location,
    worldRegion: destination.world_region,

    // Contact
    contactAddress: destination.contact_address,
    contactCity: destination.contact_city,
    contactRegion: destination.contact_region,
    contactPostalCode: destination.contact_postal_code,
    contactCountry: destination.contact_country,
    contactPhone: destination.contact_phone,
    contactEmail: destination.contact_email,
    contactWebsite: destination.contact_website,

    // Keywords
    keywords: destination.base_keywords,
    appendKeywords: destination.append_keywords !== false,

    // Person Shown
    personShown: personShown
  };
}

// ============================================================================
// IPTC PRO — Per-participant repeat block expander
// ============================================================================

/**
 * Minimal participant shape consumed by per-participant template substitution.
 * Mirrors the optional fields used by all template placeholders.
 */
export type TemplateParticipant = {
  name?: string;
  surname?: string;
  number?: string | number;
  team?: string;
  car_model?: string;
  nationality?: string;
  sponsors?: string[];
  metatag?: string;
};

/**
 * Render the variables inside ONE per-participant block iteration for ONE
 * participant.
 *
 * Handles all participant-level placeholders, including {persons} which here
 * resolves to THIS participant's extended name (NOT the joined list — that
 * semantics is reserved for {persons} appearing OUTSIDE [[ ]] blocks, where
 * it represents the aggregated cast of the whole image).
 *
 * Unknown placeholders are left as-is so the outer cleanup pass can scrub them.
 *
 * Internal helper for {@link expandPerParticipantBlocks}.
 */
function renderBlockForParticipant(
  blockContent: string,
  participant: TemplateParticipant
): string {
  const surname = participant.surname ||
    (participant.name ? participant.name.split(' ').pop() : '');
  const persons = participant.name ? buildExtendedName(participant) : '';

  return blockContent
    .replace(/\{name\}/g, participant.name || '')
    .replace(/\{surname\}/g, surname || '')
    .replace(/\{number\}/g, String(participant.number || ''))
    .replace(/\{team\}/g, participant.team || '')
    .replace(/\{car_model\}/g, participant.car_model || '')
    .replace(/\{nationality\}/g, participant.nationality || '')
    .replace(/\{persons\}/g, persons);
}

/**
 * Expand per-participant repeat blocks `[[ ... ]]` in a template.
 *
 * Each `[[ ... ]]` block is rendered once per participant in the list (with
 * that participant's variables substituted), and the renderings are joined
 * with `separator` (default `", "`).
 *
 * Variables OUTSIDE `[[ ]]` are left untouched — they're resolved by the
 * caller using its standard logic (typically the aggregated participant in
 * multi-match, or the single participant otherwise).
 *
 * Templates that don't contain `[[` are returned unchanged (zero-cost passthrough),
 * which preserves full backward compatibility for any caller / preset that
 * does not use the new syntax.
 *
 * Behavior matrix:
 * - 0 participants  → block becomes empty string
 * - 1 participant   → block renders once (no separator needed)
 * - N participants  → block renders N times, joined by `separator`
 *
 * Limitations (v1):
 * - Nested blocks `[[ [[ ]] ]]` are NOT supported (outer match is non-greedy
 *   and would close on the first `]]`).
 * - Separator is fixed at construction time; per-block separators are not
 *   yet supported.
 *
 * @example
 *   expandPerParticipantBlocks(
 *     "DTM 2026 [[#{number}; {team}: {name}]] - photo by GC",
 *     [{number: "90", team: "Manthey", name: "Feller"}, {number: "7", team: "Comtoyou", name: "Thiim"}]
 *   )
 *   // → "DTM 2026 #90; Manthey: Feller, #7; Comtoyou: Thiim - photo by GC"
 */
export function expandPerParticipantBlocks(
  template: string,
  participants: TemplateParticipant[],
  separator: string = ', '
): string {
  if (!template || !template.includes('[[')) return template;

  return template.replace(/\[\[([\s\S]*?)\]\]/g, (_match, blockContent: string) => {
    if (participants.length === 0) return '';
    return participants
      .map(p => renderBlockForParticipant(blockContent, p))
      .join(separator);
  });
}

// ============================================================================
// IPTC PRO — Build metadata from preset IPTC profile + participant data
// ============================================================================

/**
 * Builds ExportDestinationMetadata from a PresetIptcMetadata profile and participant data.
 * Resolves template placeholders ({name}, {number}, {team}, etc.) in description, headline, etc.
 * Used by the IPTC finalizer to produce per-image metadata ready for writeFullMetadata().
 *
 * Multi-match handling:
 * - When `allParticipants` is provided with N>1 entries, `[[ ... ]]` blocks in
 *   templates are expanded once per participant (see {@link expandPerParticipantBlocks}).
 * - The `{persons}` placeholder OUTSIDE blocks resolves to the joined list of
 *   individual extended names (one per participant). This fixes prior behavior
 *   where multi-match produced a single nonsensical extended name from the
 *   aggregated participant.
 * - Other placeholders ({name}, {number}, ...) OUTSIDE blocks continue to use
 *   the aggregated participant's joined values, preserving backward-compat for
 *   callers that already pass an aggregated `participant` for multi-match.
 *
 * Backward compatibility:
 * - When `allParticipants` is omitted (or empty), behavior is identical to the
 *   pre-multi-match-fix version, with one improvement: any `[[ ... ]]` block in
 *   a template still gets expanded, using `participant` as a single-element list
 *   if available. This makes the new syntax safe to use in single-match presets too.
 *
 * @param iptcProfile      The IPTC profile from the preset (PresetIptcMetadata)
 * @param participant      Optional matched participant data (single or aggregated)
 * @param aiKeywords       Optional AI-generated keywords from processing phase
 * @param keywordsMode     'append' to merge AI + base keywords, 'overwrite' for base only
 * @param allParticipants  Optional list of all matched participants (used for
 *                         per-participant block expansion and multi-match
 *                         {persons} resolution)
 */
export function buildMetadataFromPresetIptc(
  iptcProfile: PresetIptcMetadata,
  participant?: {
    name?: string;
    surname?: string;
    number?: string | number;
    team?: string;
    car_model?: string;
    nationality?: string;
    sponsors?: string[];
    metatag?: string;
  },
  aiKeywords?: string[],
  keywordsMode: 'append' | 'overwrite' = 'append',
  allParticipants?: TemplateParticipant[]
): ExportDestinationMetadata {
  // Normalize the participant list used for [[ ]] block expansion.
  // - If callers provided an explicit list (multi-match path), use it.
  // - Otherwise, fall back to wrapping the single `participant` if present, so
  //   that `[[ ]]` blocks still work in single-participant templates.
  const blockExpansionList: TemplateParticipant[] = (allParticipants && allParticipants.length > 0)
    ? allParticipants
    : (participant ? [participant] : []);

  // Resolve the value substituted for {persons} OUTSIDE [[ ]] blocks.
  // - Multi-match (N>1): joined list of individual extended names. Fixes prior
  //   broken behavior where the aggregated participant produced nonsensical
  //   output like "(90, 7) Feller and Thiim - Manthey, Comtoyou".
  // - Single match (or no list): the legacy single extended name (UNCHANGED
  //   for users who already rely on {persons} in single-match templates).
  // - Inside [[ ]] blocks, {persons} is rendered per-participant by the block
  //   expander itself; this value is irrelevant there.
  const personsResolved = (allParticipants && allParticipants.length > 1)
    ? allParticipants
        .filter(p => p.name)
        .map(p => buildExtendedName(p))
        .join(', ')
    : (participant?.name ? buildExtendedName(participant) : '');

  // Helper to resolve template placeholders
  const resolveTemplate = (template?: string): string | undefined => {
    if (!template) return undefined;

    // Step 1: Expand per-participant repeat blocks `[[ ... ]]`.
    //   - Backward compat: passthrough when the template contains no `[[`.
    //   - Each block iteration uses the individual participant's variables;
    //     {persons} inside a block is THIS participant's extended name.
    let result = expandPerParticipantBlocks(template, blockExpansionList);

    // Step 2: Substitute participant variables OUTSIDE blocks.
    //   - In multi-match, `participant` is the aggregated participant (joined
    //     values), so {name}/{number}/etc. produce comma-joined lists — this is
    //     the legacy behavior, intentionally preserved for backward compat.
    //   - Users who want per-pilot output should wrap that section in [[ ]].
    if (participant) {
      const surname = participant.surname ||
        (participant.name ? participant.name.split(' ').pop() : '');

      result = result
        .replace(/\{name\}/g, participant.name || '')
        .replace(/\{surname\}/g, surname || '')
        .replace(/\{number\}/g, String(participant.number || ''))
        .replace(/\{team\}/g, participant.team || '')
        .replace(/\{car_model\}/g, participant.car_model || '')
        .replace(/\{nationality\}/g, participant.nationality || '');
    }

    // Step 3: {persons} OUTSIDE blocks — multi-match-aware (see personsResolved).
    result = result.replace(/\{persons\}/g, personsResolved);

    // Step 4: Clean up empty placeholders, double spaces, empty parens.
    result = result
      .replace(/\{[^}]+\}/g, '')  // Remove any unresolved placeholders
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return result || undefined;
  };

  // Build person shown string using the format setting
  let personShown: string | undefined;
  if (participant?.name) {
    personShown = resolvePersonShown(
      iptcProfile.personShownFormat,
      iptcProfile.personShownTemplate,
      participant
    );
  }

  // Build keywords: merge base + AI keywords based on mode
  // Resolve template placeholders in base keywords (e.g. {name} → "Lando Norris")
  let keywords: string[] = [];
  if (iptcProfile.baseKeywords && iptcProfile.baseKeywords.length > 0) {
    for (const kw of iptcProfile.baseKeywords) {
      const resolved = resolveTemplate(kw);
      if (resolved) keywords.push(resolved);
    }
  }
  if (keywordsMode === 'append' && aiKeywords && aiKeywords.length > 0) {
    // Merge AI keywords, avoiding duplicates (case-insensitive)
    const existingLower = new Set(keywords.map(k => k.toLowerCase()));
    for (const kw of aiKeywords) {
      if (kw && kw.trim() && !existingLower.has(kw.trim().toLowerCase())) {
        keywords.push(kw.trim());
        existingLower.add(kw.trim().toLowerCase());
      }
    }
  }

  // Add participant-specific keywords (name, team) if available
  if (participant?.name && !keywords.some(k => k.toLowerCase() === participant.name!.toLowerCase())) {
    keywords.push(participant.name);
  }
  if (participant?.team && !keywords.some(k => k.toLowerCase() === participant.team!.toLowerCase())) {
    keywords.push(participant.team);
  }

  return {
    // Credits
    credit: iptcProfile.credit,
    source: iptcProfile.source,
    copyright: iptcProfile.copyright,
    copyrightOwner: iptcProfile.copyrightOwner,

    // Creator
    creator: iptcProfile.creator,
    authorsPosition: iptcProfile.authorsPosition,
    captionWriter: iptcProfile.captionWriter,

    // Event Info (resolved from templates)
    headline: resolveTemplate(iptcProfile.headlineTemplate),
    title: resolveTemplate(iptcProfile.titleTemplate),
    description: resolveTemplate(iptcProfile.descriptionTemplate),
    event: resolveTemplate(iptcProfile.eventTemplate),
    category: iptcProfile.category,

    // Location
    city: iptcProfile.city,
    country: iptcProfile.country,
    countryCode: iptcProfile.countryCode,
    location: iptcProfile.location,
    worldRegion: iptcProfile.worldRegion,
    provinceState: iptcProfile.provinceState,

    // Contact
    contactAddress: iptcProfile.contactAddress,
    contactCity: iptcProfile.contactCity,
    contactRegion: iptcProfile.contactRegion,
    contactPostalCode: iptcProfile.contactPostalCode,
    contactCountry: iptcProfile.contactCountry,
    contactPhone: iptcProfile.contactPhone,
    contactEmail: iptcProfile.contactEmail,
    contactWebsite: iptcProfile.contactWebsite,

    // Keywords
    keywords: keywords.length > 0 ? keywords : undefined,
    appendKeywords: false, // IPTC Pro always does overwrite (clean write of final keywords)

    // Person Shown
    personShown: personShown,

    // Extended IPTC Pro fields
    copyrightMarked: iptcProfile.copyrightMarked,
    copyrightUrl: iptcProfile.copyrightUrl,
    intellectualGenre: iptcProfile.intellectualGenre,
    digitalSourceType: iptcProfile.digitalSourceType,
    modelReleaseStatus: iptcProfile.modelReleaseStatus,
    scene: iptcProfile.scene,
    urgency: iptcProfile.urgency,
    dateCreated: iptcProfile.dateCreated,
  };
}

// ============================================================================
// STRUCTURED RACETAGGER DATA (machine-readable metadata for re-organization)
// ============================================================================
//
// @deprecated as of v1.2.x — DO NOT USE for new code paths.
//
// Historical context: this module wrote a JSON payload (`RACETAGGER_V1:{...}`)
// into XMP:Instructions on every analyzed photo, including absolute folder
// paths from the user's filesystem. It was originally intended as a
// "self-describing photo" mechanism so that re-organization could work without
// the JSONL log. In practice the read path is invoked only inside flows that
// already require the JSONL to exist, and the absolute paths leaked the
// photographer's home directory and client folder names into delivered files
// (privacy issue reported by beta testers in April 2026).
//
// Current state:
//  - All call sites have been removed (writers in unified-image-processor.ts
//    and main.ts; readers in main.ts).
//  - The folder-organization flow now relies exclusively on JSONL + DB
//    (the existing fallback path at main.ts:3573+).
//  - Existing files on disk that already have the payload are NOT cleaned up;
//    the data simply becomes inert (nothing reads it anymore).
//
// These functions are kept exported for one release cycle to avoid breaking
// any out-of-tree imports we might have missed. They will be deleted in a
// subsequent cleanup PR once we've confirmed nothing else references them.
//
// DO NOT add new call sites. If you need cross-machine re-organization, use
// the DB-backed reconstruction path (see src/utils/execution-log-loader.ts).

const RACETAGGER_DATA_PREFIX = 'RACETAGGER_V1:';

/**
 * @deprecated Structured data written to XMP:Instructions for machine-readable re-organization.
 * No longer in use. See module-level deprecation note above.
 */
export interface RaceTaggerStructuredData {
  /** Version identifier for forward compatibility */
  v: 1;
  /** Detected/corrected race numbers */
  numbers: string[];
  /** Driver names per vehicle: drivers[vehicleIndex] = ["Driver1", "Driver2"] */
  drivers: string[][];
  /** Team names per vehicle */
  teams: string[];
  /** Sport category slug */
  category: string;
  /** Participant preset ID used for matching (if any) */
  presetId?: string;
  /** Participant preset name for display (if any) */
  presetName?: string;
  /** Custom metatag from participant preset (if any) */
  metatag?: string;
  /** Custom folder assignments from participant preset */
  folders?: {
    folder_1?: string;
    folder_2?: string;
    folder_3?: string;
    folder_1_path?: string;
    folder_2_path?: string;
    folder_3_path?: string;
  };
  /** Timestamp of analysis */
  ts: string;
}

/**
 * @deprecated No longer in use. See module-level deprecation note above.
 *
 * Builds structured RaceTagger data from analysis results and CSV matches.
 * This data was written to XMP:Instructions for later re-organization.
 */
export function buildStructuredData(
  analysis: any[],
  csvMatches: any[] | null,
  category: string,
  getDriverNames: (participant: any) => string[],
  presetInfo?: { id?: string; name?: string }
): RaceTaggerStructuredData {
  const numbers: string[] = [];
  const drivers: string[][] = [];
  const teams: string[] = [];
  let metatag: string | undefined;
  let folders: RaceTaggerStructuredData['folders'] | undefined;

  const matches = Array.isArray(csvMatches) ? csvMatches : (csvMatches ? [csvMatches] : []);

  for (let i = 0; i < analysis.length; i++) {
    const vehicle = analysis[i];
    const match = matches[i];

    // Race number: prefer corrected from preset, fallback to AI
    const number = match?.entry?.numero || vehicle?.raceNumber?.toString();
    if (number) numbers.push(number);

    // Drivers: prefer preset, fallback to AI
    if (match?.entry) {
      const driverNames = getDriverNames(match.entry);
      drivers.push(driverNames.length > 0 ? driverNames : (vehicle?.drivers || []));
    } else {
      drivers.push(vehicle?.drivers || []);
    }

    // Team: prefer preset, fallback to AI
    const team = match?.entry?.squadra || vehicle?.teamName;
    if (team) teams.push(team);

    // Metatag and folders from first matched participant (all vehicles share same preset typically)
    if (match?.entry && !metatag) {
      if (match.entry.metatag) metatag = match.entry.metatag;
      if (match.entry.folder_1 || match.entry.folder_2 || match.entry.folder_3) {
        folders = {
          folder_1: match.entry.folder_1 || undefined,
          folder_2: match.entry.folder_2 || undefined,
          folder_3: match.entry.folder_3 || undefined,
          folder_1_path: match.entry.folder_1_path || undefined,
          folder_2_path: match.entry.folder_2_path || undefined,
          folder_3_path: match.entry.folder_3_path || undefined,
        };
      }
    }
  }

  return {
    v: 1,
    numbers,
    drivers,
    teams,
    category,
    presetId: presetInfo?.id || undefined,
    presetName: presetInfo?.name || undefined,
    metatag,
    folders,
    ts: new Date().toISOString(),
  };
}

/**
 * @deprecated No longer in use. See module-level deprecation note above.
 *
 * Writes structured RaceTagger data to XMP:Instructions field.
 * Works for both JPEG (embedded XMP) and RAW (via ExifTool on sidecar).
 * Format: "RACETAGGER_V1:{json}"
 *
 * For RAW files, the data is written to the XMP sidecar's xmp:Instructions element.
 * For JPEG files, ExifTool writes it as embedded XMP.
 */
export async function writeStructuredData(
  imagePath: string,
  data: RaceTaggerStructuredData
): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data);
    const payload = `${RACETAGGER_DATA_PREFIX}${jsonStr}`;

    if (isRawFile(imagePath)) {
      // For RAW files, update the XMP sidecar to include xmp:Instructions
      await writeStructuredDataToXmpSidecar(imagePath, payload);
    } else {
      // For JPEG, write via ExifTool
      const args = [
        '-overwrite_original',
        '-P',
        '-codedcharacterset=utf8',
        `-XMP:Instructions=${payload}`,
        imagePath,
      ];
      await nativeToolManager.executeTool('exiftool', args);
    }
  } catch (error) {
    // Non-critical: don't fail the entire processing pipeline
    console.error(`[MetadataWriter] Failed to write structured data to ${path.basename(imagePath)}:`, error);
  }
}

/**
 * @deprecated No longer in use. See module-level deprecation note above.
 *
 * Reads structured RaceTagger data from a file's XMP:Instructions field.
 * Returns null if no structured data found or if parsing fails.
 *
 * For RAW files, reads from the XMP sidecar file directly (no ExifTool needed).
 * For JPEG files, reads via ExifTool.
 */
export async function readStructuredData(
  imagePath: string
): Promise<RaceTaggerStructuredData | null> {
  try {
    let instructions: string | null = null;

    if (isRawFile(imagePath)) {
      // Read directly from XMP sidecar (faster than ExifTool)
      instructions = readStructuredDataFromXmpSidecar(imagePath);
    } else {
      // Read via ExifTool for JPEG
      const args = ['-s', '-s', '-s', '-XMP:Instructions', imagePath];
      const result = await nativeToolManager.executeTool('exiftool', args);
      instructions = result.stdout.trim() || null;
    }

    if (!instructions || !instructions.startsWith(RACETAGGER_DATA_PREFIX)) {
      return null;
    }

    const jsonStr = instructions.substring(RACETAGGER_DATA_PREFIX.length);
    const data = JSON.parse(jsonStr) as RaceTaggerStructuredData;

    // Basic validation
    if (data.v !== 1 || !Array.isArray(data.numbers)) {
      return null;
    }

    return data;
  } catch (error) {
    // Silently return null on read errors — caller will fall back to other methods
    return null;
  }
}

/**
 * Writes structured data payload to an existing or new XMP sidecar for RAW files.
 * Adds/updates the xmp:Instructions element while preserving all other content.
 */
async function writeStructuredDataToXmpSidecar(
  rawFilePath: string,
  payload: string
): Promise<void> {
  const fs = await import('fs');
  const fsPromises = await import('fs/promises');
  const fileDir = path.dirname(rawFilePath);
  const fileNameWithoutExt = path.parse(rawFilePath).name;
  const xmpFilePath = path.join(fileDir, `${fileNameWithoutExt}.xmp`);

  // Escape XML special characters in the payload
  const escapedPayload = payload
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const instructionsElement = `      <xmp:Instructions>${escapedPayload}</xmp:Instructions>`;

  if (fs.existsSync(xmpFilePath)) {
    let content = await fsPromises.readFile(xmpFilePath, 'utf8');

    // Replace existing xmp:Instructions or add new one
    const instructionsRegex = /<xmp:Instructions>[^<]*<\/xmp:Instructions>/;
    if (instructionsRegex.test(content)) {
      content = content.replace(instructionsRegex, instructionsElement);
    } else {
      // Add before </rdf:Description>
      const rdfCloseRegex = /(\s*)<\/rdf:Description>/;
      if (rdfCloseRegex.test(content)) {
        // Ensure xmp namespace is declared
        if (!content.includes('xmlns:xmp="http://ns.adobe.com/xap/1.0/"')) {
          content = content.replace(
            /<rdf:Description([^>]*)>/,
            `<rdf:Description$1\n      xmlns:xmp="http://ns.adobe.com/xap/1.0/"`
          );
        }
        content = content.replace(rdfCloseRegex, `\n${instructionsElement}\n$1</rdf:Description>`);
      }
    }

    await fsPromises.writeFile(xmpFilePath, content, 'utf8');
  } else {
    // No sidecar exists — will be created by createXmpSidecar first in the pipeline.
    // This function is called AFTER createXmpSidecar, so the file should exist.
    // If somehow it doesn't, use ExifTool as fallback.
    const args = [
      '-overwrite_original',
      '-P',
      `-XMP:Instructions=${payload}`,
      rawFilePath,
    ];
    await nativeToolManager.executeTool('exiftool', args);
  }
}

/**
 * Reads structured data from an XMP sidecar file directly (no ExifTool needed).
 * Returns the raw xmp:Instructions content or null.
 */
function readStructuredDataFromXmpSidecar(rawFilePath: string): string | null {
  const fs = require('fs');
  const fileDir = path.dirname(rawFilePath);
  const fileNameWithoutExt = path.parse(rawFilePath).name;

  // Check both lowercase and uppercase extensions
  const xmpPathLower = path.join(fileDir, `${fileNameWithoutExt}.xmp`);
  const xmpPathUpper = path.join(fileDir, `${fileNameWithoutExt}.XMP`);
  const xmpFilePath = fs.existsSync(xmpPathLower) ? xmpPathLower :
                      fs.existsSync(xmpPathUpper) ? xmpPathUpper : null;

  if (!xmpFilePath) return null;

  try {
    const content = fs.readFileSync(xmpFilePath, 'utf8');
    const match = content.match(/<xmp:Instructions>([^<]*)<\/xmp:Instructions>/);
    if (!match) return null;

    // Unescape XML entities
    return match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  } catch {
    return null;
  }
}
