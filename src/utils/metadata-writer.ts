import * as path from 'path';
import { nativeToolManager } from './native-tool-manager';

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

      console.log(`[MetadataWriter] Found ${keywords.length} existing keywords in ${path.basename(imagePath)}: ${keywords.join(', ')}`);
      return keywords;
    }

    console.log(`[MetadataWriter] No existing keywords found in ${path.basename(imagePath)}`);
    return [];
  } catch (error) {
    console.warn(`[MetadataWriter] Failed to read existing keywords from ${path.basename(imagePath)}:`, error);
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
      const instructions = result.stdout.trim();
      console.log(`[MetadataWriter] Found existing special instructions in ${path.basename(imagePath)}: ${instructions}`);
      return instructions;
    }

    console.log(`[MetadataWriter] No existing special instructions found in ${path.basename(imagePath)}`);
    return '';
  } catch (error) {
    console.warn(`[MetadataWriter] Failed to read existing special instructions from ${path.basename(imagePath)}:`, error);
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
      const description = result.stdout.trim();
      console.log(`[MetadataWriter] Found existing extended description in ${path.basename(imagePath)}: ${description}`);
      return description;
    }

    console.log(`[MetadataWriter] No existing extended description found in ${path.basename(imagePath)}`);
    return '';
  } catch (error) {
    console.warn(`[MetadataWriter] Failed to read existing extended description from ${path.basename(imagePath)}:`, error);
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
      console.warn(`[MetadataWriter] No valid keywords provided for ${path.basename(imagePath)}`);
      return;
    }

    // Simplify keywords if requested
    if (useSimplified) {
      filteredNewKeywords = simplifyKeywords(filteredNewKeywords);
      console.log(`[MetadataWriter] Simplified keywords for ${path.basename(imagePath)}: ${filteredNewKeywords.join(', ')}`);
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
      console.log(`[MetadataWriter] Overwriting existing keywords with ${filteredNewKeywords.length} new keywords in ${path.basename(imagePath)}`);

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

      console.log(`[MetadataWriter] Appending ${uniqueNewKeywords.length} new keywords to ${existingKeywords.length} existing keywords in ${path.basename(imagePath)}`);

      // Add each new unique keyword individually to avoid IPTC:Keywords 64-character limit
      for (const keyword of uniqueNewKeywords) {
        args.push(`-IPTC:Keywords+=${keyword}`);
      }
    }

    args.push(imagePath);

    console.log(`[MetadataWriter] Keywords being written (${mode} mode): ${filteredNewKeywords.join(', ')}`);

    const result = await nativeToolManager.executeTool('exiftool', args);

    console.log(`[MetadataWriter] ExifTool stdout: ${result.stdout}`);
    console.log(`[MetadataWriter] Successfully updated keywords in ${path.basename(imagePath)}`);
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
      console.warn(`[MetadataWriter] No race data provided for ${path.basename(imagePath)}`);
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
        console.log(`[MetadataWriter] Updated existing RaceTagger data in ${path.basename(imagePath)}`);
      } else {
        // Append to existing instructions
        finalInstructions = `${existingInstructions} | ${raceTaggerData}`;
        console.log(`[MetadataWriter] Appended RaceTagger data to existing instructions in ${path.basename(imagePath)}`);
      }
    } else {
      // No existing instructions, use only RaceTagger data
      finalInstructions = raceTaggerData;
      console.log(`[MetadataWriter] Added new RaceTagger data to ${path.basename(imagePath)}`);
    }

    // Ensure we don't exceed 256 character limit for IPTC:SpecialInstructions
    if (finalInstructions.length > 256) {
      console.warn(`[MetadataWriter] Instructions too long (${finalInstructions.length} chars), truncating to 256 chars`);
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

    console.log(`[MetadataWriter] Writing special instructions to ${path.basename(imagePath)}: ${finalInstructions}`);

    const result = await nativeToolManager.executeTool('exiftool', args);

    console.log(`[MetadataWriter] ExifTool stdout: ${result.stdout}`);
    console.log(`[MetadataWriter] Successfully wrote special instructions to ${path.basename(imagePath)}`);
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
      console.warn(`[MetadataWriter] No race data provided for extended description in ${path.basename(imagePath)}`);
      return;
    }

    let finalDescription: string;

    if (mode === 'overwrite') {
      // Overwrite mode: use only the new data
      finalDescription = raceData.trim();
      console.log(`[MetadataWriter] Overwriting extended description with new data in ${path.basename(imagePath)}`);
    } else {
      // Append mode: add to existing description
      const existingDescription = await readExistingExtendedDescription(imagePath);

      if (existingDescription) {
        // Append to existing description with separator
        finalDescription = `${existingDescription}\n\n${raceData.trim()}`;
        console.log(`[MetadataWriter] Appended to existing extended description in ${path.basename(imagePath)}`);
      } else {
        // No existing description, use new data
        finalDescription = raceData.trim();
        console.log(`[MetadataWriter] Added new extended description to ${path.basename(imagePath)}`);
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

    console.log(`[MetadataWriter] Writing extended description to ${path.basename(imagePath)}`);

    const result = await nativeToolManager.executeTool('exiftool', args);

    console.log(`[MetadataWriter] ExifTool stdout: ${result.stdout}`);
    console.log(`[MetadataWriter] Successfully wrote extended description to ${path.basename(imagePath)}`);
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
