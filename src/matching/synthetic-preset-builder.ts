/**
 * Synthetic Preset Builder - Post-Execution Self-Healing
 *
 * After an execution completes WITHOUT a participant preset, this module:
 * 1. Collects all evidence (raceNumber, drivers, team, otherText) from every analyzed image
 * 2. Clusters evidence by identity (using number↔name "Rosetta Stone" links)
 * 3. Builds a synthetic participant preset from the execution's own data
 * 4. Re-runs matching to propagate missing data across images
 *
 * Example: If photo 23 has raceNumber="42" but no name, and photo 67 has no number
 * but drivers=["NINA TRUMM"], and photo 89 has BOTH — the builder links them all
 * and propagates: photo 23 gets drivers=["NINA TRUMM"], photo 67 gets raceNumber="42".
 *
 * Works for ANY sport category (running, cycling, motorsport, etc.)
 * Zero additional AI cost — pure in-memory post-processing.
 */

import { createComponentLogger } from '../utils/logger';

const log = createComponentLogger('SyntheticPreset');

// ==================== TYPES ====================

export interface SyntheticParticipant {
  numero: string;                    // Race number (primary key)
  nome: string;                      // Best driver name found
  drivers: string[];                 // All known driver names
  squadra: string | null;            // Team name
  evidenceCount: number;             // How many images confirm this identity
  numberOnlyCount: number;           // Images with number but no name
  nameOnlyCount: number;             // Images with name but no number
  bothCount: number;                 // Images with both (Rosetta Stones)
  confidence: number;                // Confidence in the association (0-1)
  otherTextFingerprint: string[];    // Common visual descriptors (for temporal clustering)
}

export interface SyntheticPreset {
  participants: SyntheticParticipant[];
  stats: {
    totalImagesAnalyzed: number;
    imagesWithResults: number;
    imagesWithNumber: number;
    imagesWithName: number;
    imagesWithBoth: number;           // "Rosetta Stones"
    uniqueNumbers: number;
    uniqueNames: number;
    syntheticParticipants: number;
    healedImages: number;             // Images that gained new data
    buildTimeMs: number;
  };
}

export interface ImageEvidence {
  fileName: string;
  originalPath: string;
  raceNumber: string | null;
  drivers: string[];
  teamName: string | null;
  otherText: string[];
  confidence: number;
  timestamp?: string;                 // For temporal clustering
}

export interface HealingResult {
  fileName: string;
  originalPath: string;
  healed: boolean;
  healedFields: string[];            // Which fields were added
  originalAnalysis: any;
  healedAnalysis: any;
  syntheticMatch: SyntheticParticipant | null;
}

// Internal clustering structures
interface IdentityCluster {
  numbers: Map<string, number>;       // raceNumber → count
  names: Map<string, number>;         // driverName → count
  teams: Map<string, number>;         // teamName → count
  otherTexts: Map<string, number>;    // otherText item → count
  imageCount: number;
}

// ==================== MAIN CLASS ====================

export class SyntheticPresetBuilder {

  /**
   * Build a synthetic preset from execution results.
   *
   * @param results - Array of processed image results (UnifiedProcessingResult[])
   * @returns SyntheticPreset with participants and stats
   */
  static build(results: any[]): SyntheticPreset {
    const startTime = Date.now();

    // Step 1: Extract evidence from all images
    const allEvidence = this.extractEvidence(results);

    log.info(`[SyntheticPreset] Extracted evidence from ${allEvidence.length} images with results`);

    // Step 2: Build identity clusters using number↔name links
    const clusters = this.buildIdentityClusters(allEvidence);

    // Step 3: Convert clusters to synthetic participants
    const participants = this.clustersToParticipants(clusters);

    // Step 4: Compute stats
    const imagesWithNumber = allEvidence.filter(e => e.raceNumber).length;
    const imagesWithName = allEvidence.filter(e => e.drivers.length > 0).length;
    const imagesWithBoth = allEvidence.filter(e => e.raceNumber && e.drivers.length > 0).length;
    const uniqueNumbers = new Set(allEvidence.filter(e => e.raceNumber).map(e => e.raceNumber)).size;
    const uniqueNames = new Set(allEvidence.flatMap(e => e.drivers)).size;

    const preset: SyntheticPreset = {
      participants,
      stats: {
        totalImagesAnalyzed: results.length,
        imagesWithResults: allEvidence.length,
        imagesWithNumber,
        imagesWithName,
        imagesWithBoth,
        uniqueNumbers,
        uniqueNames,
        syntheticParticipants: participants.length,
        healedImages: 0, // Updated after healing
        buildTimeMs: Date.now() - startTime,
      }
    };

    log.info(`[SyntheticPreset] Built ${participants.length} synthetic participants from ${allEvidence.length} images in ${preset.stats.buildTimeMs}ms`);
    log.info(`[SyntheticPreset] Rosetta Stones (both number+name): ${imagesWithBoth} images`);

    if (participants.length > 0) {
      const topParticipants = participants.slice(0, 5).map(p =>
        `#${p.numero} ${p.nome || '?'} (${p.evidenceCount} imgs, conf=${p.confidence.toFixed(2)})`
      ).join(', ');
      log.info(`[SyntheticPreset] Top participants: ${topParticipants}`);
    }

    return preset;
  }

  /**
   * Apply self-healing: use the synthetic preset to fill missing data in results.
   * Mutates the results in-place and returns healing stats.
   */
  static applyHealing(results: any[], preset: SyntheticPreset): HealingResult[] {
    const healingResults: HealingResult[] = [];
    const participantMap = new Map<string, SyntheticParticipant>();
    const nameToParticipant = new Map<string, SyntheticParticipant>();

    // Build lookup maps
    for (const p of preset.participants) {
      participantMap.set(p.numero, p);
      for (const name of p.drivers) {
        nameToParticipant.set(name.toLowerCase(), p);
      }
    }

    // Only heal with high-confidence associations
    const MIN_HEALING_CONFIDENCE = 0.6;

    for (const result of results) {
      if (!result.success || !result.analysis || result.analysis.length === 0) continue;

      for (const vehicle of result.analysis) {
        const raceNumber = vehicle.raceNumber;
        const drivers: string[] = vehicle.drivers || [];
        const hasNumber = !!raceNumber;
        const hasName = drivers.length > 0 && drivers.some((d: string) => d && d.trim().length > 0);

        let healed = false;
        const healedFields: string[] = [];
        let syntheticMatch: SyntheticParticipant | null = null;

        // Case 1: Has number but no name → look up name from synthetic preset
        if (hasNumber && !hasName) {
          const participant = participantMap.get(raceNumber);
          if (participant && participant.confidence >= MIN_HEALING_CONFIDENCE && participant.drivers.length > 0) {
            vehicle.drivers = [...participant.drivers];
            vehicle._healedBy = 'synthetic-preset-number';
            healed = true;
            healedFields.push('drivers');
            syntheticMatch = participant;

            // Also heal team if missing
            if (!vehicle.teamName && participant.squadra) {
              vehicle.teamName = participant.squadra;
              healedFields.push('teamName');
            }
          }
        }

        // Case 2: Has name but no number → look up number from synthetic preset
        if (!hasNumber && hasName) {
          for (const driverName of drivers) {
            const participant = nameToParticipant.get(driverName.toLowerCase());
            if (participant && participant.confidence >= MIN_HEALING_CONFIDENCE) {
              vehicle.raceNumber = participant.numero;
              vehicle._healedBy = 'synthetic-preset-name';
              healed = true;
              healedFields.push('raceNumber');
              syntheticMatch = participant;

              // Also heal team if missing
              if (!vehicle.teamName && participant.squadra) {
                vehicle.teamName = participant.squadra;
                healedFields.push('teamName');
              }
              break; // First match wins
            }
          }
        }

        // Case 3: Has number, has name, but no team → fill team from preset
        if (hasNumber && hasName && !vehicle.teamName) {
          const participant = participantMap.get(raceNumber);
          if (participant && participant.squadra) {
            vehicle.teamName = participant.squadra;
            vehicle._healedBy = 'synthetic-preset-team';
            healed = true;
            healedFields.push('teamName');
            syntheticMatch = participant;
          }
        }

        if (healed) {
          healingResults.push({
            fileName: result.fileName,
            originalPath: result.originalPath,
            healed: true,
            healedFields,
            originalAnalysis: { raceNumber, drivers: [...(drivers || [])] },
            healedAnalysis: { raceNumber: vehicle.raceNumber, drivers: [...(vehicle.drivers || [])] },
            syntheticMatch,
          });
        }
      }
    }

    // Update preset stats
    preset.stats.healedImages = healingResults.length;

    log.info(`[SyntheticPreset] Healing complete: ${healingResults.length} vehicles healed across ${results.length} images`);

    if (healingResults.length > 0) {
      // Log some examples
      const examples = healingResults.slice(0, 5);
      for (const ex of examples) {
        log.info(`[SyntheticPreset] Healed ${ex.fileName}: ${ex.healedFields.join('+')} | ` +
          `${JSON.stringify(ex.originalAnalysis)} → ${JSON.stringify(ex.healedAnalysis)}`);
      }
      if (healingResults.length > 5) {
        log.info(`[SyntheticPreset] ... and ${healingResults.length - 5} more`);
      }
    }

    return healingResults;
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Step 1: Extract per-image evidence from results
   */
  private static extractEvidence(results: any[]): ImageEvidence[] {
    const evidence: ImageEvidence[] = [];

    for (const result of results) {
      if (!result.success || !result.analysis || result.analysis.length === 0) continue;

      for (const vehicle of result.analysis) {
        const raceNumber = vehicle.raceNumber ? String(vehicle.raceNumber).trim() : null;
        const drivers: string[] = (vehicle.drivers || [])
          .filter((d: any) => d && typeof d === 'string' && d.trim().length > 0)
          .map((d: string) => d.trim().toUpperCase());
        const teamName = vehicle.teamName ? String(vehicle.teamName).trim() : null;
        const otherText: string[] = (vehicle.otherText || vehicle.sponsors || [])
          .filter((t: any) => t && typeof t === 'string')
          .map((t: string) => t.trim().toLowerCase());
        const confidence = typeof vehicle.confidence === 'number' ? vehicle.confidence : 0;

        // Skip garbage entries (no useful data at all)
        if (!raceNumber && drivers.length === 0) continue;

        // Skip non-numeric race numbers (like "SUFFER" being misread as a number)
        if (raceNumber && !/^\d{1,5}$/.test(raceNumber)) continue;

        evidence.push({
          fileName: result.fileName,
          originalPath: result.originalPath,
          raceNumber,
          drivers,
          teamName,
          otherText,
          confidence,
        });
      }
    }

    return evidence;
  }

  /**
   * Step 2: Build identity clusters.
   *
   * Strategy:
   * - Start with "Rosetta Stones" (images with BOTH number AND name) to establish links
   * - Then cluster number-only and name-only evidence into existing clusters
   * - Handle conflicts conservatively (majority wins)
   */
  private static buildIdentityClusters(evidence: ImageEvidence[]): Map<string, IdentityCluster> {
    // Primary index: raceNumber → cluster
    const clusters = new Map<string, IdentityCluster>();
    // Reverse index: name → raceNumber (for linking name-only evidence)
    const nameToNumber = new Map<string, { number: string; count: number }>();

    // PASS 1: Process Rosetta Stones first (both number AND name)
    const rosettaStones = evidence.filter(e => e.raceNumber && e.drivers.length > 0);
    const numberOnly = evidence.filter(e => e.raceNumber && e.drivers.length === 0);
    const nameOnly = evidence.filter(e => !e.raceNumber && e.drivers.length > 0);

    for (const e of rosettaStones) {
      const num = e.raceNumber!;

      if (!clusters.has(num)) {
        clusters.set(num, {
          numbers: new Map(),
          names: new Map(),
          teams: new Map(),
          otherTexts: new Map(),
          imageCount: 0,
        });
      }

      const cluster = clusters.get(num)!;
      cluster.numbers.set(num, (cluster.numbers.get(num) || 0) + 1);
      cluster.imageCount++;

      for (const name of e.drivers) {
        cluster.names.set(name, (cluster.names.get(name) || 0) + 1);

        // Track name→number mapping with counts
        const existing = nameToNumber.get(name.toLowerCase());
        if (!existing || existing.count < (cluster.names.get(name) || 0)) {
          nameToNumber.set(name.toLowerCase(), { number: num, count: cluster.names.get(name) || 1 });
        }
      }

      if (e.teamName) {
        cluster.teams.set(e.teamName, (cluster.teams.get(e.teamName) || 0) + 1);
      }

      for (const text of e.otherText) {
        cluster.otherTexts.set(text, (cluster.otherTexts.get(text) || 0) + 1);
      }
    }

    // PASS 2: Add number-only evidence to existing clusters
    for (const e of numberOnly) {
      const num = e.raceNumber!;

      if (!clusters.has(num)) {
        clusters.set(num, {
          numbers: new Map(),
          names: new Map(),
          teams: new Map(),
          otherTexts: new Map(),
          imageCount: 0,
        });
      }

      const cluster = clusters.get(num)!;
      cluster.numbers.set(num, (cluster.numbers.get(num) || 0) + 1);
      cluster.imageCount++;

      if (e.teamName) {
        cluster.teams.set(e.teamName, (cluster.teams.get(e.teamName) || 0) + 1);
      }

      for (const text of e.otherText) {
        cluster.otherTexts.set(text, (cluster.otherTexts.get(text) || 0) + 1);
      }
    }

    // PASS 3: Link name-only evidence to clusters via nameToNumber index
    for (const e of nameOnly) {
      let linkedNumber: string | null = null;

      for (const name of e.drivers) {
        const link = nameToNumber.get(name.toLowerCase());
        if (link) {
          linkedNumber = link.number;
          break;
        }
      }

      if (linkedNumber && clusters.has(linkedNumber)) {
        const cluster = clusters.get(linkedNumber)!;
        cluster.imageCount++;

        for (const name of e.drivers) {
          cluster.names.set(name, (cluster.names.get(name) || 0) + 1);
        }

        if (e.teamName) {
          cluster.teams.set(e.teamName, (cluster.teams.get(e.teamName) || 0) + 1);
        }

        for (const text of e.otherText) {
          cluster.otherTexts.set(text, (cluster.otherTexts.get(text) || 0) + 1);
        }
      }
      // Name-only evidence without a Rosetta Stone link is dropped
      // (we can't assign a number without at least one linking image)
    }

    return clusters;
  }

  /**
   * Step 3: Convert clusters to synthetic participants
   */
  private static clustersToParticipants(clusters: Map<string, IdentityCluster>): SyntheticParticipant[] {
    const participants: SyntheticParticipant[] = [];

    for (const [number, cluster] of clusters) {
      // Best name = most frequent
      const sortedNames = [...cluster.names.entries()].sort((a, b) => b[1] - a[1]);
      const bestName = sortedNames.length > 0 ? sortedNames[0][0] : '';
      const allDrivers = sortedNames.map(([name]) => name);

      // Best team = most frequent
      const sortedTeams = [...cluster.teams.entries()].sort((a, b) => b[1] - a[1]);
      const bestTeam = sortedTeams.length > 0 ? sortedTeams[0][0] : null;

      // Common otherText (appearing in 30%+ of images for this cluster)
      const threshold = Math.max(1, Math.floor(cluster.imageCount * 0.3));
      const commonOtherText = [...cluster.otherTexts.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .map(([text]) => text);

      // Compute confidence:
      // - High if we have Rosetta Stone images (both number+name seen together)
      // - Medium if we have many number-only sightings
      // - Low if only 1-2 sightings
      const numberCount = cluster.numbers.get(number) || 0;
      const nameCount = sortedNames.reduce((sum, [, c]) => sum + c, 0);
      const hasRosettaStone = numberCount > 0 && nameCount > 0;

      let confidence: number;
      if (hasRosettaStone && cluster.imageCount >= 3) {
        confidence = 0.95;
      } else if (hasRosettaStone) {
        confidence = 0.85;
      } else if (cluster.imageCount >= 3) {
        confidence = 0.70;
      } else if (cluster.imageCount >= 2) {
        confidence = 0.50;
      } else {
        confidence = 0.30;
      }

      // Count evidence types
      const rosettaCount = Math.min(numberCount, nameCount); // Conservative estimate

      participants.push({
        numero: number,
        nome: bestName,
        drivers: allDrivers,
        squadra: bestTeam,
        evidenceCount: cluster.imageCount,
        numberOnlyCount: numberCount - rosettaCount,
        nameOnlyCount: Math.max(0, cluster.imageCount - numberCount),
        bothCount: rosettaCount,
        confidence,
        otherTextFingerprint: commonOtherText.slice(0, 5),
      });
    }

    // Sort by evidence count (most seen first)
    participants.sort((a, b) => b.evidenceCount - a.evidenceCount);

    return participants;
  }
}
