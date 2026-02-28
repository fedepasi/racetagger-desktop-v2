import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

/**
 * Crea un file XMP sidecar per un file RAW, preservando i dati esistenti se presenti
 * @param rawFilePath Percorso del file RAW o JPEG
 * @param keywords Array di keywords da inserire nel campo dc:subject o singola keyword
 * @param description Descrizione da inserire nel campo dc:description (opzionale)
 * @returns Percorso del file XMP creato
 */
export async function createXmpSidecar(
  rawFilePath: string,
  keywords: string[] | string,
  description?: string
): Promise<string> {
  // Estrai directory, nome file (senza estensione) dal percorso RAW
  const fileDir = path.dirname(rawFilePath);
  const fileNameWithoutExt = path.parse(rawFilePath).name;
  
  // Converti keywords in array se necessario
  const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
  const filteredKeywords = keywordArray.filter(k => k && k.trim().length > 0);
  
  if (filteredKeywords.length === 0) {
    throw new Error('No valid keywords provided for XMP sidecar creation');
  }
  
  // Genera il percorso del file XMP (stesso nome senza estensione + .xmp)
  const xmpFilePath = path.join(fileDir, `${fileNameWithoutExt}.xmp`);
  const fileName = path.basename(rawFilePath);
  
  let xmpContent: string;
  
  // Check if XMP file already exists
  if (fs.existsSync(xmpFilePath)) {
    try {
      
      // Read existing content
      const existingContent = await fsPromises.readFile(xmpFilePath, 'utf8');

      // Update dc:subject and dc:description while preserving everything else
      xmpContent = await updateXmpContent(existingContent, filteredKeywords, description);
      
    } catch (error) {
      // Fallback to creating new content
      xmpContent = createNewXmpContent(filteredKeywords, description);
    }
  } else {
    // Create new XMP content
    xmpContent = createNewXmpContent(filteredKeywords, description);
  }

  // Write the XMP file
  await fsPromises.writeFile(xmpFilePath, xmpContent, 'utf8');

  return xmpFilePath;
}

/**
 * Create new XMP content from scratch with keywords in dc:subject and optional dc:description
 */
function createNewXmpContent(keywords: string[], description?: string): string {
  // Format keywords as RDF Bag for dc:subject
  const keywordElements = keywords.map(keyword => `        <rdf:li>${keyword}</rdf:li>`).join('\n');

  // Add description if provided
  const descriptionElement = description ? `      <dc:description>${description}</dc:description>\n` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Racetagger XMP Generator 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <dc:subject>
        <rdf:Bag>
${keywordElements}
        </rdf:Bag>
      </dc:subject>
${descriptionElement}      <xmp:CreatorTool>Racetagger</xmp:CreatorTool>
      <xmp:MetadataDate>${new Date().toISOString()}</xmp:MetadataDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
}

/**
 * Update existing XMP content by replacing or adding dc:subject (keywords) and dc:description
 */
async function updateXmpContent(existingContent: string, keywords: string[], description?: string): Promise<string> {
  // Simple regex-based approach to preserve existing structure
  // This preserves all existing namespaces, attributes, and other metadata
  
  // First, add xmp:MetadataDate update
  const currentDate = new Date().toISOString();
  
  // Format keywords as RDF Bag elements
  const keywordElements = keywords.map(keyword => `        <rdf:li>${keyword}</rdf:li>`).join('\n');
  const keywordsXml = `      <dc:subject>
        <rdf:Bag>
${keywordElements}
        </rdf:Bag>
      </dc:subject>`;
  
  // Check if dc:subject already exists (could be in various formats)
  const subjectBagRegex = /<dc:subject>\s*<rdf:Bag>[\s\S]*?<\/rdf:Bag>\s*<\/dc:subject>/;
  const subjectSimpleRegex = /<dc:subject>([^<]*)<\/dc:subject>/;
  const metadataDateRegex = /<xmp:MetadataDate>([^<]*)<\/xmp:MetadataDate>/;
  const descriptionRegex = /<dc:description>([^<]*)<\/dc:description>/;
  
  let updatedContent = existingContent;
  
  // Check if rdf:Description is self-closing (using /> format)
  const selfClosingPattern = /<rdf:Description([^>]*)\s*\/>/;
  const regularClosingPattern = /<\/rdf:Description>/;
  
  // Handle self-closing rdf:Description tags (like Photo Mechanic format)
  if (selfClosingPattern.test(updatedContent) && !regularClosingPattern.test(updatedContent)) {
    
    // Convert self-closing tag to expanded format
    updatedContent = updatedContent.replace(selfClosingPattern, (match, attributes) => {
      // Ensure dc and xmp namespaces are declared
      let expandedAttributes = attributes;
      if (!expandedAttributes.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"')) {
        expandedAttributes += '\n   xmlns:dc="http://purl.org/dc/elements/1.1/"';
      }
      if (!expandedAttributes.includes('xmlns:xmp="http://ns.adobe.com/xap/1.0/"')) {
        expandedAttributes += '\n   xmlns:xmp="http://ns.adobe.com/xap/1.0/"';
      }
      if (!expandedAttributes.includes('xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"')) {
        expandedAttributes += '\n   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"';
      }
      
      // Add description if provided
      const descriptionXml = description ? `      <dc:description>${description}</dc:description>\n` : '';

      return `<rdf:Description${expandedAttributes}>
${keywordsXml}
${descriptionXml}      <xmp:MetadataDate>${currentDate}</xmp:MetadataDate>
    </rdf:Description>`;
    });

    return updatedContent;
  }
  
  // Handle regular format with separate closing tags
  // Update or add dc:subject
  if (subjectBagRegex.test(updatedContent)) {
    // Replace existing dc:subject with Bag format
    updatedContent = updatedContent.replace(subjectBagRegex, keywordsXml);
  } else if (subjectSimpleRegex.test(updatedContent)) {
    // Replace simple dc:subject with Bag format
    updatedContent = updatedContent.replace(subjectSimpleRegex, keywordsXml);
  } else {
    // Add dc:subject to existing rdf:Description
    const rdfDescriptionPattern = /(\s*)<\/rdf:Description>/;
    if (rdfDescriptionPattern.test(updatedContent)) {
      // Ensure dc and rdf namespaces are declared
      if (!updatedContent.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"')) {
        updatedContent = updatedContent.replace(
          /<rdf:Description([^>]*)>/,
          `<rdf:Description$1\n      xmlns:dc="http://purl.org/dc/elements/1.1/"`
        );
      }
      if (!updatedContent.includes('xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"')) {
        updatedContent = updatedContent.replace(
          /<rdf:Description([^>]*)>/,
          `<rdf:Description$1\n      xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`
        );
      }
      
      updatedContent = updatedContent.replace(rdfDescriptionPattern, `$1${keywordsXml}\n$1</rdf:Description>`);
    }
  }

  // Handle dc:description if provided
  if (description) {
    const descriptionXml = `      <dc:description>${description}</dc:description>`;

    if (descriptionRegex.test(updatedContent)) {
      // Replace existing dc:description
      updatedContent = updatedContent.replace(descriptionRegex, descriptionXml);
    } else {
      // Add dc:description to existing rdf:Description
      const rdfDescriptionPattern = /(\s*)<\/rdf:Description>/;
      if (rdfDescriptionPattern.test(updatedContent)) {
        // Ensure dc namespace is declared
        if (!updatedContent.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"')) {
          updatedContent = updatedContent.replace(
            /<rdf:Description([^>]*)>/,
            `<rdf:Description$1\n      xmlns:dc="http://purl.org/dc/elements/1.1/"`
          );
        }

        updatedContent = updatedContent.replace(rdfDescriptionPattern, `$1${descriptionXml}\n$1</rdf:Description>`);
      }
    }
  }
  
  // Update or add xmp:MetadataDate
  if (metadataDateRegex.test(updatedContent)) {
    updatedContent = updatedContent.replace(metadataDateRegex, `<xmp:MetadataDate>${currentDate}</xmp:MetadataDate>`);
  } else {
    // Add xmp:MetadataDate
    const metadataDateToAdd = `      <xmp:MetadataDate>${currentDate}</xmp:MetadataDate>`;
    const rdfDescriptionPattern = /(\s*)<\/rdf:Description>/;
    if (rdfDescriptionPattern.test(updatedContent)) {
      // Ensure xmp namespace is declared
      if (!updatedContent.includes('xmlns:xmp="http://ns.adobe.com/xap/1.0/"')) {
        updatedContent = updatedContent.replace(
          /<rdf:Description([^>]*)>/,
          `<rdf:Description$1\n      xmlns:xmp="http://ns.adobe.com/xap/1.0/"`
        );
      }
      
      updatedContent = updatedContent.replace(rdfDescriptionPattern, `$1${metadataDateToAdd}\n$1</rdf:Description>`);
    }
  }
  
  return updatedContent;
}

/**
 * Creates a full IPTC/XMP sidecar file for a RAW image with all professional metadata.
 * Preserves existing XMP data (develop settings, ratings, color labels) while adding/updating
 * all IPTC namespaces: photoshop, dc, xmpRights, Iptc4xmpCore, Iptc4xmpExt, plus, xmp.
 *
 * Used by IPTC Pro for RAW files instead of the basic createXmpSidecar().
 *
 * @param rawFilePath Path to the RAW file
 * @param metadata Full metadata to write (ExportDestinationMetadata interface)
 * @returns Path to the created/updated XMP sidecar file
 */
export async function createFullXmpSidecar(
  rawFilePath: string,
  metadata: {
    credit?: string;
    source?: string;
    copyright?: string;
    copyrightOwner?: string;
    creator?: string;
    authorsPosition?: string;
    captionWriter?: string;
    headline?: string;
    title?: string;
    description?: string;
    event?: string;
    category?: string;
    city?: string;
    country?: string;
    countryCode?: string;
    location?: string;
    worldRegion?: string;
    provinceState?: string;
    contactAddress?: string;
    contactCity?: string;
    contactRegion?: string;
    contactPostalCode?: string;
    contactCountry?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactWebsite?: string;
    keywords?: string[];
    appendKeywords?: boolean;
    personShown?: string | string[];
    copyrightMarked?: boolean;
    copyrightUrl?: string;
    intellectualGenre?: string;
    digitalSourceType?: string;
    modelReleaseStatus?: string;
    scene?: string[];
    urgency?: string;
    dateCreated?: string;
  }
): Promise<string> {
  const fileDir = path.dirname(rawFilePath);
  const fileNameWithoutExt = path.parse(rawFilePath).name;
  const xmpFilePath = path.join(fileDir, `${fileNameWithoutExt}.xmp`);
  const currentDate = new Date().toISOString();

  // Build keyword elements
  const allKeywords: string[] = [];
  if (metadata.keywords && metadata.keywords.length > 0) {
    allKeywords.push(...metadata.keywords.filter(k => k && k.trim()));
  }
  // Add person shown as keyword for searchability
  if (metadata.personShown) {
    const persons = Array.isArray(metadata.personShown) ? metadata.personShown : [metadata.personShown];
    for (const p of persons) {
      if (p && p.trim() && !allKeywords.includes(p.trim())) {
        allKeywords.push(p.trim());
      }
    }
  }
  if (!allKeywords.includes('racetagger')) {
    allKeywords.push('racetagger');
  }

  const keywordElements = allKeywords.map(k => `     <rdf:li>${escapeXml(k)}</rdf:li>`).join('\n');

  // Build scene elements
  const sceneElements = metadata.scene && metadata.scene.length > 0
    ? metadata.scene.map(s => `     <rdf:li>${escapeXml(s)}</rdf:li>`).join('\n')
    : '';

  // Build person shown elements
  const personElements = (() => {
    if (!metadata.personShown) return '';
    const persons = Array.isArray(metadata.personShown) ? metadata.personShown : [metadata.personShown];
    return persons.filter(p => p && p.trim()).map(p => `     <rdf:li>${escapeXml(p)}</rdf:li>`).join('\n');
  })();

  // Check if XMP exists — if so, preserve existing content not related to IPTC
  let existingNonIptcContent = '';
  let existingAttributes = '';

  if (fs.existsSync(xmpFilePath)) {
    try {
      const existing = await fsPromises.readFile(xmpFilePath, 'utf8');
      // Extract photomechanic, crs (Camera Raw), and other non-IPTC data
      existingNonIptcContent = extractNonIptcElements(existing);
      // Preserve any existing rdf:Description attributes that aren't IPTC-related
      existingAttributes = extractNonIptcAttributes(existing);
    } catch (error) {
      // If read fails, we'll create from scratch
    }
  }

  // Build the complete XMP sidecar
  const xmpContent = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Racetagger IPTC Pro 1.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"${existingAttributes ? '\n    ' + existingAttributes : ''}
${buildAttributes(metadata)}>
${buildDcElements(metadata, keywordElements)}
${buildIptcCoreElements(metadata, sceneElements)}
${buildIptcExtElements(metadata, personElements)}
${buildPlusElements(metadata)}
${existingNonIptcContent}   <xmp:CreatorTool>Racetagger IPTC Pro</xmp:CreatorTool>
   <xmp:MetadataDate>${currentDate}</xmp:MetadataDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

  await fsPromises.writeFile(xmpFilePath, xmpContent, 'utf8');
  return xmpFilePath;
}

// === Full XMP Sidecar Helper Functions ===

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAttributes(m: any): string {
  const attrs: string[] = [];
  if (m.city) attrs.push(`   photoshop:City="${escapeXml(m.city)}"`);
  if (m.country) attrs.push(`   photoshop:Country="${escapeXml(m.country)}"`);
  if (m.category) attrs.push(`   photoshop:Category="${escapeXml(m.category)}"`);
  if (m.authorsPosition) attrs.push(`   photoshop:AuthorsPosition="${escapeXml(m.authorsPosition)}"`);
  if (m.credit) attrs.push(`   photoshop:Credit="${escapeXml(m.credit)}"`);
  if (m.source) attrs.push(`   photoshop:Source="${escapeXml(m.source)}"`);
  if (m.captionWriter) attrs.push(`   photoshop:CaptionWriter="${escapeXml(m.captionWriter)}"`);
  if (m.headline) attrs.push(`   photoshop:Headline="${escapeXml(m.headline)}"`);
  if (m.urgency) attrs.push(`   photoshop:Urgency="${escapeXml(m.urgency)}"`);
  if (m.dateCreated) attrs.push(`   photoshop:DateCreated="${escapeXml(m.dateCreated)}"`);
  if (m.copyrightMarked !== undefined) attrs.push(`   xmpRights:Marked="${m.copyrightMarked ? 'True' : 'False'}"`);
  if (m.copyrightUrl) attrs.push(`   xmpRights:WebStatement="${escapeXml(m.copyrightUrl)}"`);
  if (m.countryCode) attrs.push(`   Iptc4xmpCore:CountryCode="${escapeXml(m.countryCode)}"`);
  if (m.location) attrs.push(`   Iptc4xmpCore:Location="${escapeXml(m.location)}"`);
  if (m.intellectualGenre) attrs.push(`   Iptc4xmpCore:IntellectualGenre="${escapeXml(m.intellectualGenre)}"`);
  if (m.digitalSourceType) attrs.push(`   Iptc4xmpExt:DigitalSourceType="${escapeXml(m.digitalSourceType)}"`);
  if (m.modelReleaseStatus) attrs.push(`   plus:ModelReleaseStatus="${escapeXml(m.modelReleaseStatus)}"`);
  return attrs.length > 0 ? attrs.join('\n') : '';
}

function buildDcElements(m: any, keywordElements: string): string {
  const parts: string[] = [];

  // dc:subject (keywords)
  if (keywordElements) {
    parts.push(`   <dc:subject>\n    <rdf:Bag>\n${keywordElements}\n    </rdf:Bag>\n   </dc:subject>`);
  }

  // dc:description
  if (m.description) {
    parts.push(`   <dc:description>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${escapeXml(m.description)}</rdf:li>\n    </rdf:Alt>\n   </dc:description>`);
  }

  // dc:creator
  if (m.creator) {
    parts.push(`   <dc:creator>\n    <rdf:Seq>\n     <rdf:li>${escapeXml(m.creator)}</rdf:li>\n    </rdf:Seq>\n   </dc:creator>`);
  }

  // dc:title
  if (m.title) {
    parts.push(`   <dc:title>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${escapeXml(m.title)}</rdf:li>\n    </rdf:Alt>\n   </dc:title>`);
  }

  // dc:rights
  if (m.copyright) {
    parts.push(`   <dc:rights>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${escapeXml(m.copyright)}</rdf:li>\n    </rdf:Alt>\n   </dc:rights>`);
  }

  return parts.join('\n');
}

function buildIptcCoreElements(m: any, sceneElements: string): string {
  const parts: string[] = [];

  // Scene
  if (sceneElements) {
    parts.push(`   <Iptc4xmpCore:Scene>\n    <rdf:Bag>\n${sceneElements}\n    </rdf:Bag>\n   </Iptc4xmpCore:Scene>`);
  }

  // Creator Contact Info
  const contactAttrs: string[] = [];
  if (m.contactAddress) contactAttrs.push(`    Iptc4xmpCore:CiAdrExtadr="${escapeXml(m.contactAddress)}"`);
  if (m.contactCity) contactAttrs.push(`    Iptc4xmpCore:CiAdrCity="${escapeXml(m.contactCity)}"`);
  if (m.contactRegion) contactAttrs.push(`    Iptc4xmpCore:CiAdrRegion="${escapeXml(m.contactRegion)}"`);
  if (m.contactPostalCode) contactAttrs.push(`    Iptc4xmpCore:CiAdrPcode="${escapeXml(m.contactPostalCode)}"`);
  if (m.contactCountry) contactAttrs.push(`    Iptc4xmpCore:CiAdrCtry="${escapeXml(m.contactCountry)}"`);
  if (m.contactPhone) contactAttrs.push(`    Iptc4xmpCore:CiTelWork="${escapeXml(m.contactPhone)}"`);
  if (m.contactEmail) contactAttrs.push(`    Iptc4xmpCore:CiEmailWork="${escapeXml(m.contactEmail)}"`);
  if (m.contactWebsite) contactAttrs.push(`    Iptc4xmpCore:CiUrlWork="${escapeXml(m.contactWebsite)}"`);

  if (contactAttrs.length > 0) {
    parts.push(`   <Iptc4xmpCore:CreatorContactInfo\n${contactAttrs.join('\n')}/>`);
  }

  return parts.join('\n');
}

function buildIptcExtElements(m: any, personElements: string): string {
  const parts: string[] = [];

  // Location Created
  if (m.location || m.city || m.country || m.countryCode || m.worldRegion || m.provinceState) {
    const locAttrs: string[] = [];
    if (m.location) locAttrs.push(`      Iptc4xmpExt:Sublocation="${escapeXml(m.location)}"`);
    if (m.city) locAttrs.push(`      Iptc4xmpExt:City="${escapeXml(m.city)}"`);
    if (m.provinceState) locAttrs.push(`      Iptc4xmpExt:ProvinceState="${escapeXml(m.provinceState)}"`);
    if (m.country) locAttrs.push(`      Iptc4xmpExt:CountryName="${escapeXml(m.country)}"`);
    if (m.countryCode) locAttrs.push(`      Iptc4xmpExt:CountryCode="${escapeXml(m.countryCode)}"`);
    if (m.worldRegion) locAttrs.push(`      Iptc4xmpExt:WorldRegion="${escapeXml(m.worldRegion)}"`);
    parts.push(`   <Iptc4xmpExt:LocationCreated>\n    <rdf:Bag>\n     <rdf:li\n${locAttrs.join('\n')}/>\n    </rdf:Bag>\n   </Iptc4xmpExt:LocationCreated>`);
  }

  // Event
  if (m.event) {
    parts.push(`   <Iptc4xmpExt:Event>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${escapeXml(m.event)}</rdf:li>\n    </rdf:Alt>\n   </Iptc4xmpExt:Event>`);
  }

  // PersonInImage
  if (personElements) {
    parts.push(`   <Iptc4xmpExt:PersonInImage>\n    <rdf:Bag>\n${personElements}\n    </rdf:Bag>\n   </Iptc4xmpExt:PersonInImage>`);
  }

  return parts.join('\n');
}

function buildPlusElements(m: any): string {
  const parts: string[] = [];

  if (m.copyrightOwner) {
    parts.push(`   <plus:CopyrightOwner>\n    <rdf:Seq>\n     <rdf:li\n      plus:CopyrightOwnerName="${escapeXml(m.copyrightOwner)}"/>\n    </rdf:Seq>\n   </plus:CopyrightOwner>`);
  }

  return parts.join('\n');
}

/**
 * Extract non-IPTC elements from existing XMP to preserve them.
 * This includes: Camera Raw settings, Lightroom develop, photomechanic ratings, etc.
 */
function extractNonIptcElements(content: string): string {
  const preserved: string[] = [];

  // Preserve photomechanic elements (ratings, tags, color class)
  const pmRegex = /<photomechanic:[^>]*>[\s\S]*?<\/photomechanic:[^>]*>|<photomechanic:[^/>]*\/>/gi;
  let match;
  while ((match = pmRegex.exec(content)) !== null) {
    preserved.push('   ' + match[0].trim());
  }

  // Preserve Camera Raw Settings (crs: namespace)
  const crsRegex = /<crs:[^>]*>[\s\S]*?<\/crs:[^>]*>|<crs:[^/>]*\/>/gi;
  while ((match = crsRegex.exec(content)) !== null) {
    preserved.push('   ' + match[0].trim());
  }

  return preserved.length > 0 ? preserved.join('\n') + '\n' : '';
}

/**
 * Extract non-IPTC namespace attributes from existing rdf:Description
 * to preserve them (e.g., photomechanic, crs namespaces and their attributes)
 */
function extractNonIptcAttributes(content: string): string {
  const preserved: string[] = [];

  // Extract photomechanic attributes from rdf:Description
  const pmAttrRegex = /photomechanic:\w+="[^"]*"/g;
  let match;
  while ((match = pmAttrRegex.exec(content)) !== null) {
    preserved.push(match[0]);
  }

  // Extract photomechanic namespace declaration
  if (content.includes('xmlns:photomechanic=') && preserved.length > 0) {
    const nsMatch = content.match(/xmlns:photomechanic="[^"]*"/);
    if (nsMatch) {
      preserved.unshift(nsMatch[0]);
    }
  }

  return preserved.join('\n    ');
}

/**
 * Legacy function - creates XMP sidecar with description as keyword
 * @deprecated Use createXmpSidecar with keywords array instead
 */
export async function createXmpSidecarWithDescription(rawFilePath: string, description: string): Promise<string> {
  return createXmpSidecar(rawFilePath, [description]);
}

/**
 * Verifica se un file XMP sidecar esiste già per un file RAW
 * @param rawFilePath Percorso del file RAW
 * @returns true se esiste, false altrimenti
 */
export function xmpSidecarExists(rawFilePath: string): boolean {
  // Estrai directory e nome file senza estensione
  const fileDir = path.dirname(rawFilePath);
  const fileNameWithoutExt = path.parse(rawFilePath).name;
  
  // Genera il percorso del file XMP (stesso nome senza estensione + .xmp)
  const xmpFilePath = path.join(fileDir, `${fileNameWithoutExt}.xmp`);
  
  return fs.existsSync(xmpFilePath);
}

