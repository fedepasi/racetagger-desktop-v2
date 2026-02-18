import * as path from 'path';
import { nativeToolManager } from './native-tool-manager';
import { createXmpSidecar } from './xmp-manager';

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

  // Contact Info
  contactAddress?: string;      // XMP-iptcCore:CreatorContactInfo/CiAdrExtadr
  contactCity?: string;         // XMP-iptcCore:CreatorContactInfo/CiAdrCity
  contactRegion?: string;       // XMP-iptcCore:CreatorContactInfo/CiAdrRegion
  contactPostalCode?: string;   // XMP-iptcCore:CreatorContactInfo/CiAdrPcode
  contactCountry?: string;      // XMP-iptcCore:CreatorContactInfo/CiAdrCtry
  contactPhone?: string;        // XMP-iptcCore:CreatorContactInfo/CiTelWork
  contactEmail?: string;        // XMP-iptcCore:CreatorContactInfo/CiEmailWork
  contactWebsite?: string;      // XMP-iptcCore:CreatorContactInfo/CiUrlWork

  // Keywords
  keywords?: string[];          // IPTC:Keywords
  appendKeywords?: boolean;     // If true, append to existing keywords

  // Person Shown
  personShown?: string | string[];  // XMP-iptcExt:PersonInImage
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
  metadata: ExportDestinationMetadata
): Promise<void> {
  try {
    // RAW files: write to XMP sidecar instead of directly to the file
    if (isRawFile(imagePath)) {
      // Collect keywords and description for XMP sidecar
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
    // Contact info uses nested XMP structure
    if (metadata.contactAddress) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiAdrExtadr=${metadata.contactAddress}`);
    }
    if (metadata.contactCity) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiAdrCity=${metadata.contactCity}`);
    }
    if (metadata.contactRegion) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiAdrRegion=${metadata.contactRegion}`);
    }
    if (metadata.contactPostalCode) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiAdrPcode=${metadata.contactPostalCode}`);
    }
    if (metadata.contactCountry) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiAdrCtry=${metadata.contactCountry}`);
    }
    if (metadata.contactPhone) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiTelWork=${metadata.contactPhone}`);
    }
    if (metadata.contactEmail) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiEmailWork=${metadata.contactEmail}`);
    }
    if (metadata.contactWebsite) {
      args.push(`-XMP-iptcCore:CreatorContactInfo/Iptc4xmpCore:CiUrlWork=${metadata.contactWebsite}`);
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

    // Only proceed if we have metadata to write
    if (args.length <= 3) {
      return;
    }

    args.push(imagePath);

    await nativeToolManager.executeTool('exiftool', args);
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
// STRUCTURED RACETAGGER DATA (machine-readable metadata for re-organization)
// ============================================================================

const RACETAGGER_DATA_PREFIX = 'RACETAGGER_V1:';

/**
 * Structured data written to XMP:Instructions for machine-readable re-organization.
 * This enables folder organization from metadata without depending on JSONL files.
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
 * Builds structured RaceTagger data from analysis results and CSV matches.
 * This data is written to XMP:Instructions for later re-organization.
 */
export function buildStructuredData(
  analysis: any[],
  csvMatches: any[] | null,
  category: string,
  getDriverNames: (participant: any) => string[]
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
    metatag,
    folders,
    ts: new Date().toISOString(),
  };
}

/**
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
