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

