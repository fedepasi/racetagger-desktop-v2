import * as path from 'path';
import { IptcFinalizationConfig, IptcFinalizationSummary, FinalizedResult, MatchedParticipantData } from './iptc-types';
import { writeFullMetadata, buildMetadataFromPresetIptc, ExportDestinationMetadata, buildExtendedName, resolvePersonShown } from './metadata-writer';

/**
 * IPTC Pro Finalizer
 *
 * Batch writes professional IPTC metadata to all images after user review.
 * This is the authoritative write — it OVERWRITES any basic metadata written
 * during processing with the corrected, complete dataset.
 *
 * Supports multi-match images (multiple participants detected in one photo):
 * - Person Shown: comma-separated list of all participant names
 * - Caption/description: names joined with " and "
 * - Keywords: merged from all matched participants
 *
 * Flow:
 * 1. Takes PresetIptcMetadata (global event-level profile from preset)
 * 2. For each image, combines with matchedParticipant(s) data (corrected by user)
 * 3. Resolves template placeholders ({name}, {number}, {team}, etc.)
 * 4. Merges base keywords + AI keywords based on keywordsMode
 * 5. Calls writeFullMetadata() for JPEG or creates full XMP sidecar for RAW
 * 6. Reports progress via callbacks
 *
 * @param config Finalization configuration with IPTC profile, results, and callbacks
 * @returns Summary with success/error counts and timing
 */
export async function finalizeIptcMetadata(
  config: IptcFinalizationConfig
): Promise<IptcFinalizationSummary> {
  const startTime = Date.now();
  const { iptcMetadata, results, keywordsMode, onProgress, onError } = config;
  const metadataStrategy = config.metadataStrategy ?? 'merge';

  const summary: IptcFinalizationSummary = {
    totalFiles: results.length,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    errors: [],
    durationMs: 0,
  };

  console.log(`[IPTC Finalizer] Starting batch finalization for ${results.length} files`);
  console.log(`[IPTC Finalizer] Keywords mode: ${keywordsMode}, metadata strategy: ${metadataStrategy}`);
  console.log(`[IPTC Finalizer] Profile has: credit=${!!iptcMetadata.credit}, copyright=${!!iptcMetadata.copyright}, ` +
    `description=${!!iptcMetadata.descriptionTemplate}, baseKeywords=${iptcMetadata.baseKeywords?.length || 0}`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const fileName = path.basename(result.imagePath);

    try {
      // Report progress
      if (onProgress) {
        onProgress(i + 1, results.length, fileName);
      }

      // Build metadata — handle multi-match or single-match
      const metadata = buildMetadataForResult(result, iptcMetadata, keywordsMode);

      // Write metadata (handles both JPEG and RAW via writeFullMetadata).
      // Replace mode pre-clears the IPTC IIM and the XMP namespaces this
      // writer touches before applying the preset; merge mode preserves
      // any pre-existing tags from other tools.
      await writeFullMetadata(result.imagePath, metadata, {
        replaceAll: metadataStrategy === 'replace'
      });

      summary.successCount++;

      // Log first few and last file for debugging
      if (i < 3 || i === results.length - 1) {
        const matchInfo = getMatchInfoString(result);
        console.log(`[IPTC Finalizer] ✅ ${i + 1}/${results.length}: ${fileName}${matchInfo}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IPTC Finalizer] ❌ Error on ${fileName}: ${errorMessage}`);

      summary.errorCount++;
      summary.errors.push({ fileName, error: errorMessage });

      if (onError) {
        onError(fileName, errorMessage);
      }
    }
  }

  summary.durationMs = Date.now() - startTime;

  console.log(`[IPTC Finalizer] ✅ Finalization complete:`);
  console.log(`  Total: ${summary.totalFiles}`);
  console.log(`  Success: ${summary.successCount}`);
  console.log(`  Errors: ${summary.errorCount}`);
  console.log(`  Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);

  return summary;
}

/**
 * Build metadata for a single result, handling multi-match aggregation.
 *
 * For multi-match images (allMatchedParticipants.length > 1):
 * - Aggregates names for {name} placeholder: "Verstappen and Hamilton"
 * - Aggregates numbers: "1, 44"
 * - Aggregates teams (unique): "Red Bull Racing, Ferrari"
 * - Person Shown: comma-separated list per IPTC standard
 * - Keywords: merged from all participants
 *
 * For single-match or no-match, falls through to standard single-participant logic.
 */
function buildMetadataForResult(
  result: FinalizedResult,
  iptcMetadata: IptcFinalizationConfig['iptcMetadata'],
  keywordsMode: 'append' | 'overwrite'
): ExportDestinationMetadata {
  // Determine all matched participants
  const allParticipants = result.allMatchedParticipants && result.allMatchedParticipants.length > 0
    ? result.allMatchedParticipants
    : result.matchedParticipant
      ? [result.matchedParticipant]
      : [];

  if (allParticipants.length <= 1) {
    // Single match or no match — standard path
    const participant = allParticipants[0];
    const metadata = buildMetadataFromPresetIptc(
      iptcMetadata,
      participant ? {
        name: participant.name,
        number: participant.number,
        team: participant.team,
        car_model: participant.car_model,
        nationality: participant.nationality,
        metatag: participant.metatag,
      } : undefined,
      result.aiKeywords,
      keywordsMode
    );

    // Include visual tags in keywords if enabled in IPTC profile
    appendVisualTagsToKeywords(metadata, result.visualTags, iptcMetadata.includeVisualTags);

    return metadata;
  }

  // ===== MULTI-MATCH: Aggregate participants for templates =====
  const names = allParticipants
    .map(p => p.name)
    .filter((n): n is string => !!n);

  const numbers = allParticipants
    .map(p => p.number)
    .filter((n): n is string => !!n);

  const teams = [...new Set(
    allParticipants
      .map(p => p.team)
      .filter((t): t is string => !!t)
  )];

  const carModels = [...new Set(
    allParticipants
      .map(p => p.car_model)
      .filter((c): c is string => !!c)
  )];

  const nationalities = [...new Set(
    allParticipants
      .map(p => p.nationality)
      .filter((n): n is string => !!n)
  )];

  // Build aggregated participant for template resolution
  // {name} → "Verstappen and Hamilton" (for caption readability)
  // {number} → "1, 44"
  // {team} → "Red Bull Racing, Ferrari" (unique teams)
  const aggregatedParticipant = {
    name: joinNames(names),
    number: numbers.join(', '),
    team: teams.join(', '),
    car_model: carModels.join(', '),
    nationality: nationalities.join(', '),
  };

  // Build base metadata using aggregated participant
  const metadata = buildMetadataFromPresetIptc(
    iptcMetadata,
    aggregatedParticipant,
    result.aiKeywords,
    keywordsMode
  );

  // Override Person Shown with individual entries per participant (IPTC standard)
  // For multi-match we resolve each participant individually using the chosen format
  if (names.length > 1) {
    const format = iptcMetadata.personShownFormat;
    const template = iptcMetadata.personShownTemplate;

    if (format === 'extended') {
      // Each participant gets their own extended name entry
      const extendedNames = allParticipants
        .filter(p => p.name)
        .map(p => buildExtendedName(p));
      metadata.personShown = extendedNames;
    } else if (format === 'custom' && template) {
      // Each participant resolved individually with custom template
      const customNames = allParticipants
        .filter(p => p.name)
        .map(p => resolvePersonShown('custom', template, p));
      metadata.personShown = customNames;
    } else {
      // 'simple' or default — just names
      metadata.personShown = names;
    }
  }

  // Add ALL participants' names and teams as individual keywords
  if (metadata.keywords) {
    const existingLower = new Set(metadata.keywords.map(k => k.toLowerCase()));
    for (const p of allParticipants) {
      if (p.name && !existingLower.has(p.name.toLowerCase())) {
        metadata.keywords.push(p.name);
        existingLower.add(p.name.toLowerCase());
      }
      if (p.team && !existingLower.has(p.team.toLowerCase())) {
        metadata.keywords.push(p.team);
        existingLower.add(p.team.toLowerCase());
      }
      if (p.car_model && !existingLower.has(p.car_model.toLowerCase())) {
        metadata.keywords.push(p.car_model);
        existingLower.add(p.car_model.toLowerCase());
      }
    }
  }

  // Include visual tags in keywords if enabled in IPTC profile
  appendVisualTagsToKeywords(metadata, result.visualTags, iptcMetadata.includeVisualTags);

  return metadata;
}

/**
 * Append flattened visual tags to metadata keywords if the flag is enabled.
 * Avoids duplicates (case-insensitive).
 *
 * Exported so the Export-to-Folder path (`unified-export-handler.ts`) can apply
 * the same logic before calling `writeFullMetadata`. Without this, the
 * `includeVisualTags` flag of an IPTC Pro preset was honored only by
 * `Write to Originals` and silently dropped on `Export to Folder`.
 */
export function appendVisualTagsToKeywords(
  metadata: ExportDestinationMetadata,
  visualTags: Record<string, string[]> | undefined,
  includeVisualTags: boolean | undefined
): void {
  if (!includeVisualTags || !visualTags) return;

  const flatTags = [
    ...(visualTags.location || []),
    ...(visualTags.weather || []),
    ...(visualTags.sceneType || []),
    ...(visualTags.subjects || []),
    ...(visualTags.visualStyle || []),
    ...(visualTags.emotion || []),
  ];

  if (flatTags.length === 0) return;

  if (!metadata.keywords) {
    metadata.keywords = [];
  }

  const existingLower = new Set(metadata.keywords.map(k => k.toLowerCase()));
  for (const tag of flatTags) {
    if (tag && !existingLower.has(tag.toLowerCase())) {
      metadata.keywords.push(tag);
      existingLower.add(tag.toLowerCase());
    }
  }
}

/**
 * Join names in natural language format:
 * - 1 name: "Verstappen"
 * - 2 names: "Verstappen and Hamilton"
 * - 3+ names: "Verstappen, Hamilton and Leclerc"
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Get a log-friendly string describing the match info for a result.
 */
function getMatchInfoString(result: FinalizedResult): string {
  const allParticipants = result.allMatchedParticipants && result.allMatchedParticipants.length > 0
    ? result.allMatchedParticipants
    : result.matchedParticipant
      ? [result.matchedParticipant]
      : [];

  if (allParticipants.length === 0) return ' (no match)';
  if (allParticipants.length === 1) {
    return allParticipants[0].name ? ` → ${allParticipants[0].name}` : ' (matched, no name)';
  }
  const names = allParticipants.map(p => p.name || '?').join(', ');
  return ` → [${allParticipants.length} matches: ${names}]`;
}

/**
 * Build metadata for a single image without writing it.
 * Useful for preview/validation before batch finalization.
 */
export function buildIptcMetadataForPreview(
  config: IptcFinalizationConfig,
  resultIndex: number
): ExportDestinationMetadata | null {
  const result = config.results[resultIndex];
  if (!result) return null;

  return buildMetadataForResult(result, config.iptcMetadata, config.keywordsMode);
}
