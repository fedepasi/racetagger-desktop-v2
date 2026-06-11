import * as fsPromises from 'fs/promises';
import { PresetIptcMetadata } from './iptc-types';

/**
 * Parse a PhotoMechanic or standard XMP file and extract IPTC metadata fields
 * into a PresetIptcMetadata object suitable for storing in a preset profile.
 *
 * Supports both self-closing rdf:Description (PhotoMechanic) and expanded formats.
 *
 * @param xmpFilePath Absolute path to the .XMP file
 * @returns PresetIptcMetadata object with all extracted fields
 */
export async function parseXmpToIptcProfile(xmpFilePath: string): Promise<PresetIptcMetadata> {
  const content = await fsPromises.readFile(xmpFilePath, 'utf8');
  return parseXmpContentToIptcProfile(content);
}

/**
 * Parse XMP content string into PresetIptcMetadata
 */
export function parseXmpContentToIptcProfile(content: string): PresetIptcMetadata {
  const profile: PresetIptcMetadata = {};

  // === CREDITS ===
  profile.credit = extractAttribute(content, 'photoshop:Credit');
  profile.source = extractAttribute(content, 'photoshop:Source')?.trim() || undefined;
  profile.copyrightMarked = extractAttribute(content, 'xmpRights:Marked')?.toLowerCase() === 'true';
  profile.copyrightUrl = extractAttribute(content, 'xmpRights:WebStatement');

  // Copyright from dc:rights (may be in rdf:Alt/rdf:li or attribute)
  profile.copyright = extractAltValue(content, 'dc:rights') || extractAttribute(content, 'dc:rights');

  // Copyright owner from plus:CopyrightOwner structure
  profile.copyrightOwner = extractAttribute(content, 'plus:CopyrightOwnerName');

  // === CREATOR ===
  // dc:creator in rdf:Seq format
  profile.creator = extractSeqValue(content, 'dc:creator');
  profile.authorsPosition = extractAttribute(content, 'photoshop:AuthorsPosition');
  profile.captionWriter = extractAttribute(content, 'photoshop:CaptionWriter');

  // === CREATOR CONTACT INFO ===
  profile.contactAddress = extractAttribute(content, 'Iptc4xmpCore:CiAdrExtadr');
  profile.contactCity = extractAttribute(content, 'Iptc4xmpCore:CiAdrCity');
  profile.contactRegion = extractAttribute(content, 'Iptc4xmpCore:CiAdrRegion');
  profile.contactPostalCode = extractAttribute(content, 'Iptc4xmpCore:CiAdrPcode');
  profile.contactCountry = extractAttribute(content, 'Iptc4xmpCore:CiAdrCtry');
  profile.contactPhone = extractAttribute(content, 'Iptc4xmpCore:CiTelWork');
  profile.contactEmail = extractAttribute(content, 'Iptc4xmpCore:CiEmailWork');
  profile.contactWebsite = extractAttribute(content, 'Iptc4xmpCore:CiUrlWork');

  // === EVENT INFO ===
  profile.headlineTemplate = extractAttribute(content, 'photoshop:Headline');
  profile.category = extractAttribute(content, 'photoshop:Category');
  profile.intellectualGenre = extractAttribute(content, 'Iptc4xmpCore:IntellectualGenre');
  profile.urgency = extractAttribute(content, 'photoshop:Urgency');
  profile.dateCreated = extractAttribute(content, 'photoshop:DateCreated')
    || extractAttribute(content, 'xmp:CreateDate');

  // dc:title — from rdf:Alt/rdf:li
  profile.titleTemplate = extractAltValue(content, 'dc:title');

  // dc:description — caption template. In PhotoMechanic, typically starts with spaces
  // where the subject name goes. Convert leading space to {name} placeholder.
  const rawDescription = extractAltValue(content, 'dc:description');
  if (rawDescription) {
    profile.descriptionTemplate = convertDescriptionToTemplate(rawDescription);
  }

  // Iptc4xmpExt:Event — from rdf:Alt/rdf:li
  profile.eventTemplate = extractAltValue(content, 'Iptc4xmpExt:Event');

  // === LOCATION ===
  profile.city = extractAttribute(content, 'photoshop:City');
  profile.country = extractAttribute(content, 'photoshop:Country');
  profile.countryCode = extractAttribute(content, 'Iptc4xmpCore:CountryCode');
  profile.location = extractAttribute(content, 'Iptc4xmpCore:Location');

  // Province/State from LocationCreated structure
  profile.provinceState = extractLocationCreatedField(content, 'ProvinceState');

  // World Region from LocationCreated structure
  profile.worldRegion = extractLocationCreatedField(content, 'WorldRegion');

  // === RIGHTS & SOURCE ===
  profile.digitalSourceType = extractAttribute(content, 'Iptc4xmpExt:DigitalSourceType');
  profile.modelReleaseStatus = extractAttribute(content, 'plus:ModelReleaseStatus');

  // Scene codes (from Iptc4xmpCore:Scene rdf:Bag)
  profile.scene = extractBagValues(content, 'Iptc4xmpCore:Scene');

  // === KEYWORDS ===
  // dc:subject rdf:Bag — base keywords
  profile.baseKeywords = extractBagValues(content, 'dc:subject');
  profile.appendKeywords = true; // Default: merge with AI keywords

  // === PERSON SHOWN ===
  // Default template — the description template implies where the name goes
  profile.personShownTemplate = '{name}';

  // Clean up empty/undefined fields
  return cleanProfile(profile);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract a simple XML attribute value: `namespace:field="value"`
 */
function extractAttribute(content: string, field: string): string | undefined {
  // Escape special regex chars in the field name
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}="([^"]*)"`, 'i');
  const match = content.match(regex);
  return match?.[1] || undefined;
}

/**
 * Extract value from rdf:Alt/rdf:li structure (used by dc:description, dc:title, dc:rights, Event)
 * Handles: <dc:description><rdf:Alt><rdf:li xml:lang="x-default">VALUE</rdf:li></rdf:Alt></dc:description>
 */
function extractAltValue(content: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the field > rdf:Alt > rdf:li pattern
  const regex = new RegExp(
    `<${escaped}>\\s*<rdf:Alt>\\s*<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>\\s*</rdf:Alt>\\s*</${escaped}>`,
    'i'
  );
  const match = content.match(regex);
  return match?.[1]?.trim() || undefined;
}

/**
 * Extract value from rdf:Seq/rdf:li structure (used by dc:creator)
 */
function extractSeqValue(content: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<${escaped}>\\s*<rdf:Seq>\\s*<rdf:li>([^<]*)</rdf:li>`,
    'i'
  );
  const match = content.match(regex);
  return match?.[1]?.trim() || undefined;
}

/**
 * Extract all values from rdf:Bag/rdf:li structure (used by dc:subject, Iptc4xmpCore:Scene)
 */
function extractBagValues(content: string, field: string): string[] | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bagRegex = new RegExp(
    `<${escaped}>\\s*<rdf:Bag>([\\s\\S]*?)</rdf:Bag>\\s*</${escaped}>`,
    'i'
  );
  const bagMatch = content.match(bagRegex);
  if (!bagMatch) return undefined;

  const liRegex = /<rdf:li>([^<]*)<\/rdf:li>/gi;
  const values: string[] = [];
  let match;
  while ((match = liRegex.exec(bagMatch[1])) !== null) {
    const val = match[1].trim();
    if (val) values.push(val);
  }

  return values.length > 0 ? values : undefined;
}

/**
 * Extract a field from the first Iptc4xmpExt:LocationCreated entry
 * Handles: <Iptc4xmpExt:LocationCreated><rdf:Bag><rdf:li Iptc4xmpExt:WorldRegion="America" .../>
 */
function extractLocationCreatedField(content: string, fieldName: string): string | undefined {
  const locCreatedRegex = /<Iptc4xmpExt:LocationCreated>\s*<rdf:Bag>\s*<rdf:li([\s\S]*?)\/>/i;
  const match = content.match(locCreatedRegex);
  if (!match) return undefined;

  const attrRegex = new RegExp(`Iptc4xmpExt:${fieldName}="([^"]*)"`, 'i');
  const attrMatch = match[1].match(attrRegex);
  const value = attrMatch?.[1]?.trim();

  // Skip placeholder values like "-"
  return value && value !== '-' ? value : undefined;
}

/**
 * Convert a PhotoMechanic description to a template with {name} placeholder.
 *
 * PhotoMechanic descriptions often start with spaces where the photographer
 * types the subject name. We detect this pattern and convert to {name}.
 *
 * Examples:
 *   "  during the Formula 1..." → "{name} during the Formula 1..."
 *   "Max Verstappen during..." → "Max Verstappen during..." (no change, user can edit)
 */
function convertDescriptionToTemplate(description: string): string {
  // Pattern 1: Starts with whitespace (PhotoMechanic placeholder for name)
  if (/^\s{2,}/.test(description)) {
    return '{name}' + description.replace(/^\s+/, ' ');
  }

  // Pattern 2: Starts with a lowercase word like "during", "in", "at"
  // This suggests there's a missing name before it
  if (/^(during|in|at|on|for|with)\s/i.test(description.trim())) {
    return '{name} ' + description.trim();
  }

  // Otherwise return as-is — user can manually add {name} if needed
  return description;
}

/**
 * Remove undefined/null/empty fields from profile
 */
function cleanProfile(profile: PresetIptcMetadata): PresetIptcMetadata {
  const cleaned: PresetIptcMetadata = {};

  for (const [key, value] of Object.entries(profile)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (cleaned as any)[key] = value;
  }

  return cleaned;
}
