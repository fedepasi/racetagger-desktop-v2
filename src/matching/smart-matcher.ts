/**
 * SmartMatcher - Intelligent multi-evidence participant matching system
 *
 * This system implements advanced matching algorithms that combine multiple
 * evidence sources (race numbers, driver names, sponsors, teams) to accurately
 * identify participants even when OCR data is partially incorrect.
 *
 * Architecture is designed for future ML integration while providing
 * immediate improvements through rule-based intelligent matching.
 */

import { EvidenceCollector, Evidence, EvidenceType } from './evidence-collector';
import { OCRCorrector } from './ocr-corrector';
import { SportConfig, MatchingConfig } from './sport-config';
import { TemporalClusterManager, ImageTimestamp } from './temporal-clustering';
import { CorrectionData } from '../utils/analysis-logger';

export interface AnalysisResult {
  raceNumber?: string;
  drivers?: string[];
  category?: string;
  teamName?: string;
  otherText?: string[];
  confidence?: number;
  plateNumber?: string;        // License plate number detected by AI
  plateConfidence?: number;    // Confidence score for plate number (0.0-1.0)
  // Temporal context for proximity matching
  imageTimestamp?: ImageTimestamp;
  temporalNeighbors?: ImageTimestamp[];
}

export interface Participant {
  numero?: string | number;
  number?: string | number;
  nome_pilota?: string;
  nome_navigatore?: string;
  nome_terzo?: string;
  nome_quarto?: string;
  nome?: string; // Legacy CSV support
  squadra?: string;
  team?: string;
  sponsor?: string | string[];
  sponsors?: string[];
  categoria?: string;
  category?: string;
  plate_number?: string; // License plate for car recognition
  metatag?: string;
}

export interface MatchCandidate {
  participant: Participant;
  score: number;
  evidence: Evidence[];
  confidence: number;
  reasoning: string[];
  // Temporal matching context
  temporalBonus?: number;
  temporalClusterSize?: number;
  isBurstModeCandidate?: boolean;
  // Uniqueness tracking - indicates if any unique evidence was matched
  hasUniqueEvidence?: boolean;
  // Ghost vehicle detection - indicates possible LED display or wrong vehicle detection
  ghostVehicleWarning?: boolean;
}

export interface MatchResult {
  bestMatch: MatchCandidate | null;
  allCandidates: MatchCandidate[];
  multipleHighScores: boolean;
  resolvedByOverride: boolean;
  debugInfo: {
    totalEvidence: number;
    evidenceTypes: EvidenceType[];
    ocrCorrections: string[];
    processingTimeMs: number;
  };
}

/**
 * SmartMatcher Class
 *
 * Core intelligent matching engine that processes analysis results
 * against participant databases using multiple evidence sources.
 *
 * TODO_ML_INTEGRATION: This class is designed with interfaces that can
 * be easily enhanced with ML models for:
 * - Feature extraction from evidence
 * - Similarity scoring with neural networks
 * - Ensemble methods combining rule-based and ML approaches
 */
export class SmartMatcher {
  private evidenceCollector: EvidenceCollector;
  private ocrCorrector: OCRCorrector;
  private config: MatchingConfig;
  private sportConfig: SportConfig;
  private temporalManager: TemporalClusterManager;
  private sport: string;

  // Correction tracking for analysis logging
  private corrections: CorrectionData[] = [];
  private currentImageId?: string;

  // Current evidence context for advanced matching
  private currentAllEvidence: Evidence[] = [];

  // Temporal analysis cache - stores results for neighbor analysis
  private static temporalAnalysisCache: Map<string, {
    participantNumber: string;
    confidence: number;
    timestamp: Date;
    fileName: string;
  }> = new Map();

  // Flag to track if we are in active processing session
  private static isActiveSession: boolean = false;

  // UNIQUENESS ANALYSIS CACHE - stores uniqueness data for performance
  // This is computed once per preset and reused across all images
  private uniquenessCache: {
    participantsHash: string;
    uniqueNumbers: Set<string>;
    uniqueDrivers: Set<string>;
    uniqueSponsors: Set<string>;
    uniqueTeams: Set<string>;
    sponsorOccurrences: Map<string, number>;
    driverOccurrences: Map<string, number>;
    teamOccurrences: Map<string, number>;
  } | null = null;

  constructor(sport: string = 'motorsport') {
    this.sport = sport;
    this.sportConfig = new SportConfig();
    this.config = this.sportConfig.getConfig(sport);
    this.evidenceCollector = new EvidenceCollector(this.config);
    this.ocrCorrector = new OCRCorrector();
    this.temporalManager = new TemporalClusterManager();
  }

  /**
   * Initialize configurations from Supabase sport categories data
   */
  initializeFromSportCategories(sportCategories: any[]): void {
    // Initialize SportConfig from Supabase data
    if (this.sportConfig) {
      this.sportConfig.initializeFromSportCategories(sportCategories);
      // Update local config reference
      this.config = this.sportConfig.getConfig(this.sport);
      // Update evidence collector with new config
      this.evidenceCollector = new EvidenceCollector(this.config);
      console.log(`[SmartMatcher] Configurations updated from Supabase for sport: ${this.sport}`);
    }

    // Initialize TemporalClusterManager from Supabase data
    if (this.temporalManager) {
      this.temporalManager.initializeFromSportCategories(sportCategories);
      console.log(`[SmartMatcher] TemporalClusterManager configurations updated from Supabase`);
    }
  }

  /**
   * Initialize correction tracking for a new image analysis
   */
  startImageAnalysis(imageId: string): void {
    this.currentImageId = imageId;
    this.corrections = []; // Reset corrections for new image
  }

  /**
   * Get all corrections applied during the current image analysis
   */
  getCorrections(): CorrectionData[] {
    return [...this.corrections]; // Return copy to prevent external modification
  }

  /**
   * Get the active thresholds for the current sport
   */
  getActiveThresholds() {
    return {
      minimumScore: this.config.thresholds.minimumScore,
      clearWinner: this.config.thresholds.clearWinner,
      nameSimilarity: this.config.thresholds.nameSimilarity,
      lowOcrConfidence: this.config.thresholds.lowOcrConfidence,
      strongNonNumberEvidence: this.config.thresholds.strongNonNumberEvidence
    };
  }

  /**
   * Get the active weights for evidence types in the current sport
   */
  getActiveWeights() {
    const personNameWeight = this.config.weights.personName || this.config.weights.driverName || 80;
    return {
      raceNumber: this.config.weights.raceNumber,
      personName: personNameWeight,
      driverName: personNameWeight, // backward compatibility
      sponsor: this.config.weights.sponsor,
      team: this.config.weights.team,
      category: this.config.weights.category,
      plateNumber: this.config.weights.plateNumber
    };
  }

  /**
   * Get the current sport category being used
   */
  getCurrentSport(): string {
    return this.sport;
  }

  /**
   * Store temporal analysis for successful matches
   * Extracts data from imageTimestamp and match result for caching
   */
  private storeTemporalAnalysis(
    imageTimestamp: { filePath: string; timestamp: Date | null },
    match: MatchCandidate
  ): void {
    // Convert numero to string if it's a number, otherwise use as-is
    const participantNumber = match.participant?.numero
      ? String(match.participant.numero)
      : null;
    const confidence = match.score / 100; // Convert score to confidence (0-1)

    console.log(`[SmartMatcher] Storing temporal analysis for ${imageTimestamp.filePath} - Number: ${participantNumber}, Score: ${match.score}, Confidence: ${confidence.toFixed(2)}`);

    this.storeTemporalAnalysisResult(
      imageTimestamp.filePath,
      participantNumber,
      confidence,
      imageTimestamp.timestamp
    );
  }

  /**
   * Store analysis result in temporal cache for neighbor analysis
   * This allows temporal bonus calculation across multiple images
   */
  storeTemporalAnalysisResult(
    imagePath: string,
    participantNumber: string | null,
    confidence: number,
    timestamp: Date | null
  ): void {
    if (!imagePath || !participantNumber || !timestamp) {
      console.log(`[SmartMatcher] Skipping temporal cache storage - missing data: path=${!!imagePath}, number=${!!participantNumber}, timestamp=${!!timestamp}`);
      return; // Skip if missing required data
    }

    const cacheKey = imagePath.toLowerCase(); // Use lowercase for consistency
    const fileName = require('path').basename(imagePath);

    SmartMatcher.temporalAnalysisCache.set(cacheKey, {
      participantNumber: participantNumber,
      confidence: confidence,
      timestamp: timestamp,
      fileName: fileName
    });

    console.log(`[SmartMatcher] Stored in temporal cache: ${fileName} -> Number: ${participantNumber}, Confidence: ${confidence.toFixed(2)}, Cache size: ${SmartMatcher.temporalAnalysisCache.size}`);

    // Limit cache size to prevent memory issues (keep last 1000 entries)
    if (SmartMatcher.temporalAnalysisCache.size > 1000) {
      const firstKey = SmartMatcher.temporalAnalysisCache.keys().next().value;
      if (firstKey !== undefined) {
        SmartMatcher.temporalAnalysisCache.delete(firstKey);
      }
    }

    console.log(`[SmartMatcher] Stored temporal analysis for ${cacheKey}: #${participantNumber} (${(confidence * 100).toFixed(1)}%)`);
  }

  /**
   * Start a new active processing session
   */
  static startSession(): void {
    console.log('[SmartMatcher] startSession() called');
    SmartMatcher.isActiveSession = true;
    SmartMatcher.temporalAnalysisCache.clear();
    console.log('[SmartMatcher] New processing session started, temporal cache cleared, isActiveSession=', SmartMatcher.isActiveSession);
  }

  /**
   * End the current processing session
   */
  static endSession(): void {
    SmartMatcher.isActiveSession = false;
    console.log('[SmartMatcher] Processing session ended');
  }

  /**
   * Clear temporal analysis cache (useful for new sessions)
   */
  static clearTemporalCache(): void {
    // Only clear cache if not in active session (prevents clearing during processing)
    console.log('[SmartMatcher] clearTemporalCache() called, isActiveSession=', SmartMatcher.isActiveSession);
    if (!SmartMatcher.isActiveSession) {
      SmartMatcher.temporalAnalysisCache.clear();
      console.log('[SmartMatcher] Temporal analysis cache cleared');
    } else {
      console.log('[SmartMatcher] Cache clear skipped - active session in progress');
    }
  }

  /**
   * Analyze participant preset for uniqueness of values
   * This is cached and computed only once per preset for performance
   *
   * PERFORMANCE: O(n*m) where n=participants, m=avg sponsors per participant
   * Cached result is reused across all images in the session
   */
  private analyzePresetUniqueness(participants: Participant[]): void {
    // Generate hash of participants to detect preset changes
    const participantsHash = participants
      .map(p => `${p.numero || p.number}_${p.nome_pilota}`)
      .join('|');

    // Check if we already have cached analysis for this exact preset
    if (this.uniquenessCache && this.uniquenessCache.participantsHash === participantsHash) {
      console.log('[SmartMatcher] Using cached uniqueness analysis');
      return; // Cache hit - reuse existing analysis
    }

    console.log('[SmartMatcher] Computing uniqueness analysis for preset...');
    const startTime = Date.now();

    // Initialize occurrence counters
    const numberOccurrences = new Map<string, number>();
    const driverOccurrences = new Map<string, number>();
    const sponsorOccurrences = new Map<string, number>();
    const teamOccurrences = new Map<string, number>();

    // Count occurrences of each value
    for (const participant of participants) {
      // Count race numbers
      const number = String(participant.numero || participant.number || '').trim();
      if (number) {
        numberOccurrences.set(number, (numberOccurrences.get(number) || 0) + 1);
      }

      // Count driver names (all variants)
      const drivers = [
        participant.nome_pilota,
        participant.nome_navigatore,
        participant.nome_terzo,
        participant.nome_quarto,
        participant.nome
      ].filter(Boolean).map(name => String(name).toLowerCase().trim());

      for (const driver of drivers) {
        if (driver) {
          driverOccurrences.set(driver, (driverOccurrences.get(driver) || 0) + 1);
        }
      }

      // Count sponsors (with proper splitting)
      const sponsors = this.extractSponsorsFromParticipant(participant);
      for (const sponsor of sponsors) {
        if (sponsor) {
          sponsorOccurrences.set(sponsor, (sponsorOccurrences.get(sponsor) || 0) + 1);
        }
      }

      // Count teams
      const team = String(participant.squadra || participant.team || '').toLowerCase().trim();
      if (team) {
        teamOccurrences.set(team, (teamOccurrences.get(team) || 0) + 1);
      }
    }

    // Identify unique values (appear exactly once)
    const uniqueNumbers = new Set<string>();
    const uniqueDrivers = new Set<string>();
    const uniqueSponsors = new Set<string>();
    const uniqueTeams = new Set<string>();

    numberOccurrences.forEach((count, value) => {
      if (count === 1) uniqueNumbers.add(value);
    });

    driverOccurrences.forEach((count, value) => {
      if (count === 1) uniqueDrivers.add(value);
    });

    sponsorOccurrences.forEach((count, value) => {
      if (count === 1) uniqueSponsors.add(value);
    });

    teamOccurrences.forEach((count, value) => {
      if (count === 1) uniqueTeams.add(value);
    });

    // Cache the analysis
    this.uniquenessCache = {
      participantsHash,
      uniqueNumbers,
      uniqueDrivers,
      uniqueSponsors,
      uniqueTeams,
      sponsorOccurrences,
      driverOccurrences,
      teamOccurrences
    };

    const duration = Date.now() - startTime;
    console.log(`[SmartMatcher] Uniqueness analysis completed in ${duration}ms:`);
    console.log(`  - Unique numbers: ${uniqueNumbers.size}/${numberOccurrences.size}`);
    console.log(`  - Unique drivers: ${uniqueDrivers.size}/${driverOccurrences.size}`);
    console.log(`  - Unique sponsors: ${uniqueSponsors.size}/${sponsorOccurrences.size}`);
    console.log(`  - Unique teams: ${uniqueTeams.size}/${teamOccurrences.size}`);
  }

  /**
   * Extract and split sponsors from participant data
   * Handles both string and array formats, with proper splitting
   */
  private extractSponsorsFromParticipant(participant: Participant): string[] {
    const sponsors: string[] = [];

    // Handle sponsor field (string or array)
    if (participant.sponsor) {
      if (Array.isArray(participant.sponsor)) {
        sponsors.push(...participant.sponsor);
      } else {
        // Split by comma and clean up
        const splitSponsors = String(participant.sponsor)
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(s => s.length > 0);
        sponsors.push(...splitSponsors);
      }
    }

    // Handle sponsors field (array)
    if (participant.sponsors && Array.isArray(participant.sponsors)) {
      const cleanSponsors = participant.sponsors
        .map(s => String(s).trim().toLowerCase())
        .filter(s => s.length > 0);
      sponsors.push(...cleanSponsors);
    }

    return sponsors;
  }

  /**
   * Check if an evidence value is unique in the preset
   */
  private isUniqueInPreset(evidenceType: EvidenceType, evidenceValue: string): boolean {
    if (!this.uniquenessCache) return false;

    const cleanValue = evidenceValue.toLowerCase().trim();

    switch (evidenceType) {
      case EvidenceType.RACE_NUMBER:
        return this.uniquenessCache.uniqueNumbers.has(evidenceValue.trim());
      case EvidenceType.DRIVER_NAME:
        return this.uniquenessCache.uniqueDrivers.has(cleanValue);
      case EvidenceType.SPONSOR:
        return this.uniquenessCache.uniqueSponsors.has(cleanValue);
      case EvidenceType.TEAM:
        return this.uniquenessCache.uniqueTeams.has(cleanValue);
      default:
        return false;
    }
  }

  /**
   * Get occurrence count for a value in the preset
   */
  private getOccurrenceCount(evidenceType: EvidenceType, evidenceValue: string): number {
    if (!this.uniquenessCache) return 0;

    const cleanValue = evidenceValue.toLowerCase().trim();

    switch (evidenceType) {
      case EvidenceType.DRIVER_NAME:
        return this.uniquenessCache.driverOccurrences.get(cleanValue) || 0;
      case EvidenceType.SPONSOR:
        return this.uniquenessCache.sponsorOccurrences.get(cleanValue) || 0;
      case EvidenceType.TEAM:
        return this.uniquenessCache.teamOccurrences.get(cleanValue) || 0;
      default:
        return 0;
    }
  }

  /**
   * Check if a participant has a specific sponsor in their sponsor list
   * Used for coherence validation when applying uniqueness boost
   */
  private participantHasSponsor(participant: Participant, sponsorValue: string): boolean {
    const participantSponsors = this.extractSponsorsFromParticipant(participant);
    const cleanSponsorValue = sponsorValue.toLowerCase().trim();

    return participantSponsors.some(ps => ps === cleanSponsorValue);
  }

  /**
   * Check if a participant has a specific driver name in their driver list
   * Used for coherence validation when applying uniqueness boost
   */
  private participantHasDriver(participant: Participant, driverValue: string): boolean {
    const participantDrivers = [
      participant.nome_pilota,
      participant.nome_navigatore,
      participant.nome_terzo,
      participant.nome_quarto,
      participant.nome
    ].filter(Boolean).map(name => String(name).toLowerCase().trim());

    const cleanDriverValue = driverValue.toLowerCase().trim();

    // Check exact match or partial match (driver name could be partial)
    return participantDrivers.some(pd =>
      pd === cleanDriverValue ||
      pd.includes(cleanDriverValue) ||
      cleanDriverValue.includes(pd)
    );
  }

  /**
   * Check if a participant has a specific team in their team field
   * Used for coherence validation when applying uniqueness boost
   */
  private participantHasTeam(participant: Participant, teamValue: string): boolean {
    const participantTeam = String(participant.squadra || participant.team || '').toLowerCase().trim();
    const cleanTeamValue = teamValue.toLowerCase().trim();

    if (!participantTeam) return false;

    // Check exact match or partial match
    return participantTeam === cleanTeamValue ||
           participantTeam.includes(cleanTeamValue) ||
           cleanTeamValue.includes(participantTeam);
  }

  /**
   * Create detailed score breakdown for a match candidate
   */
  getScoreBreakdown(candidate: MatchCandidate) {
    const breakdown: any[] = [];
    const weights = this.getActiveWeights();

    // Process each piece of evidence
    for (const evidence of candidate.evidence) {
      let weightUsed = 0;
      let evidenceType = '';

      switch (evidence.type) {
        case EvidenceType.RACE_NUMBER:
          weightUsed = weights.raceNumber;
          evidenceType = 'Race Number';
          break;
        case EvidenceType.PERSON_NAME:
          weightUsed = weights.personName || weights.driverName || 80;
          evidenceType = 'Person Name';
          break;
        case EvidenceType.SPONSOR:
          weightUsed = weights.sponsor;
          evidenceType = 'Sponsor';
          break;
        case EvidenceType.TEAM:
          weightUsed = weights.team;
          evidenceType = 'Team';
          break;
        case EvidenceType.CATEGORY:
          weightUsed = weights.category;
          evidenceType = 'Category';
          break;
        case EvidenceType.PLATE_NUMBER:
          weightUsed = weights.plateNumber;
          evidenceType = 'Plate Number';
          break;
      }

      breakdown.push({
        type: evidenceType,
        value: evidence.value,
        baseWeight: weightUsed,
        actualScore: evidence.score || 0,
        confidence: evidence.confidence || 1
      });
    }

    // Add bonuses if applicable
    const bonuses: any[] = [];

    // Multi-evidence bonus
    if (candidate.evidence.length >= 2) {
      const baseScore = breakdown.reduce((sum, item) => sum + item.actualScore, 0);
      const bonus = baseScore * this.config.multiEvidenceBonus;
      bonuses.push({
        type: 'Multi-Evidence Bonus',
        description: `${this.config.multiEvidenceBonus * 100}% bonus for ${candidate.evidence.length} types of evidence`,
        points: bonus
      });
    }

    // Temporal bonus
    if (candidate.temporalBonus && candidate.temporalBonus > 0) {
      bonuses.push({
        type: 'Temporal Proximity Bonus',
        description: `Bonus for ${candidate.temporalClusterSize} neighboring images${candidate.isBurstModeCandidate ? ' (burst mode detected)' : ''}`,
        points: candidate.temporalBonus
      });
    }

    return {
      evidenceBreakdown: breakdown,
      bonuses: bonuses,
      totalScore: candidate.score,
      weights: weights
    };
  }

  /**
   * Add a correction to the tracking list
   */
  private addCorrection(correction: CorrectionData): void {
    this.corrections.push(correction);
  }

  /**
   * Main matching method that processes analysis results against participants
   *
   * @param analysisResult - AI analysis result from image
   * @param participants - Available participants to match against
   * @param restrictToPreset - If true, only return matches that exist in the preset
   * @param vehicleIndex - Optional index of the vehicle being processed (for multi-vehicle images)
   * @returns Detailed match result with all candidates and evidence
   */
  async findMatches(
    analysisResult: AnalysisResult,
    participants: Participant[],
    restrictToPreset: boolean = false,
    vehicleIndex?: number
  ): Promise<MatchResult> {
    const startTime = Date.now();

    // Step -1: Analyze preset for uniqueness (cached for performance)
    this.analyzePresetUniqueness(participants);

    // Step 0: Try fast-track matching based on high-confidence driver name matches
    const fastTrackMatch = this.tryFastTrackNameMatch(analysisResult, participants);
    if (fastTrackMatch) {
      console.log(`[SmartMatcher] Fast-track match found, skipping OCR corrections and fuzzy matching`);

      // Store the successful match in temporal cache for future temporal bonuses
      if (analysisResult.imageTimestamp) {
        this.storeTemporalAnalysis(analysisResult.imageTimestamp, fastTrackMatch);
      }

      const processingTime = Date.now() - startTime;

      return {
        bestMatch: fastTrackMatch,
        allCandidates: [fastTrackMatch],
        multipleHighScores: false,
        resolvedByOverride: true, // This was resolved by fast-track name matching
        debugInfo: {
          totalEvidence: analysisResult.drivers?.length || 0,
          evidenceTypes: [EvidenceType.DRIVER_NAME],
          ocrCorrections: [], // No OCR corrections needed
          processingTimeMs: processingTime
        }
      };
    }

    console.log(`[SmartMatcher] No fast-track match found, proceeding with standard matching`);

    // Step 1: Collect all evidence from analysis result
    const evidence = this.evidenceCollector.extractEvidence(analysisResult);

    // Step 1.5: Check if the recognized race number exists in the participant database
    const raceNumberEvidence = evidence.find(e => e.type === EvidenceType.RACE_NUMBER);
    const recognizedNumberExists = raceNumberEvidence &&
      participants.some(p => {
        const participantNumber = String(p.numero || p.number || '');
        const recognizedNumber = String(raceNumberEvidence.value);
        return participantNumber === recognizedNumber;
      });

    console.log(`[SmartMatcher] Recognized number "${raceNumberEvidence?.value}" exists in database: ${recognizedNumberExists ? 'YES' : 'NO'}`);

    // Step 2: Apply OCR corrections to race numbers ONLY if the number doesn't exist
    let correctedEvidence: Evidence[];
    if (recognizedNumberExists) {
      console.log(`[SmartMatcher] Skipping OCR corrections - recognized number exists`);
      correctedEvidence = evidence; // Use original evidence without OCR corrections
    } else {
      console.log(`[SmartMatcher] Applying OCR corrections - recognized number doesn't exist`);
      correctedEvidence = await this.ocrCorrector.correctEvidence(evidence, participants);
    }

    // Track OCR corrections (simplified - OCRCorrector returns array of correction descriptions)
    const ocrCorrections = this.ocrCorrector.getLastCorrections();
    ocrCorrections.forEach(correctionDescription => {
      // Parse the correction description or use simplified tracking
      this.addCorrection({
        type: 'OCR',
        field: 'raceNumber',
        originalValue: 'unknown', // OCRCorrector doesn't expose detailed info yet
        correctedValue: 'unknown',
        reason: correctionDescription,
        confidence: 0.8,
        details: {
          method: 'confusion_matrix',
          description: correctionDescription
        }
      });
    });

    // Step 3: Generate match candidates for each participant
    const candidates: MatchCandidate[] = [];

    for (const participant of participants) {
      const candidate = this.evaluateParticipant(participant, correctedEvidence, !recognizedNumberExists);
      if (candidate.score > 0) {
        candidates.push(candidate);
      }
    }

    // Step 4: Apply temporal proximity bonus if temporal context is available
    if (analysisResult.imageTimestamp && analysisResult.temporalNeighbors) {
      await this.applyTemporalBonuses(candidates, analysisResult, vehicleIndex);
    }

    // Step 5: Sort candidates by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    // Step 6: Apply intelligent resolution rules
    const resolvedResult = this.resolveMatches(candidates, correctedEvidence);

    // Step 7: If restrictToPreset is true and we have no valid match, return empty result
    if (restrictToPreset && (!resolvedResult.bestMatch || resolvedResult.bestMatch.score < this.config.thresholds.minimumScore)) {
      console.log(`[SmartMatcher] Preset restriction active - no valid match found, returning empty result`);

      const processingTime = Date.now() - startTime;

      return {
        bestMatch: null,
        allCandidates: candidates,
        multipleHighScores: resolvedResult.multipleHighScores,
        resolvedByOverride: false,
        debugInfo: {
          totalEvidence: evidence.length,
          evidenceTypes: evidence.map(e => e.type),
          ocrCorrections: this.ocrCorrector.getLastCorrections(),
          processingTimeMs: processingTime
        }
      };
    }

    // Store the successful match in temporal cache for future temporal bonuses
    if (resolvedResult.bestMatch && analysisResult.imageTimestamp) {
      this.storeTemporalAnalysis(analysisResult.imageTimestamp, resolvedResult.bestMatch);
    }

    const processingTime = Date.now() - startTime;

    return {
      bestMatch: resolvedResult.bestMatch,
      allCandidates: candidates,
      multipleHighScores: resolvedResult.multipleHighScores,
      resolvedByOverride: resolvedResult.resolvedByOverride,
      debugInfo: {
        totalEvidence: evidence.length,
        evidenceTypes: evidence.map(e => e.type),
        ocrCorrections: this.ocrCorrector.getLastCorrections(),
        processingTimeMs: processingTime
      }
    };
  }

  /**
   * Evaluates a single participant against collected evidence
   *
   * NEW: Tracks unique evidence matches for improved candidate selection
   * NEW: Intelligent sponsor processing - prioritizes unique sponsors and detects contradictions
   *
   * TODO_ML_INTEGRATION: This method can be enhanced with:
   * - Neural similarity scoring
   * - Embedding-based name matching
   * - Context-aware sponsor recognition
   */
  private evaluateParticipant(
    participant: Participant,
    evidence: Evidence[],
    allowFuzzyMatching: boolean = true
  ): MatchCandidate {
    let totalScore = 0;
    const matchedEvidence: Evidence[] = [];
    const reasoning: string[] = [];
    let hasUniqueEvidence = false; // Track if any unique evidence was matched
    let ghostVehicleWarning = false; // Track if ghost vehicle detected

    // Set current evidence context for advanced matching
    this.currentAllEvidence = evidence;

    // Separate sponsor evidence from other evidence for intelligent processing
    const sponsorEvidence = evidence.filter(e => e.type === EvidenceType.SPONSOR);
    const nonSponsorEvidence = evidence.filter(e => e.type !== EvidenceType.SPONSOR);

    // Process non-sponsor evidence normally (race number, drivers, team)
    for (const evidenceItem of nonSponsorEvidence) {
      const match = this.evaluateEvidence(participant, evidenceItem, allowFuzzyMatching);
      if (match.score > 0) {
        totalScore += match.score;
        matchedEvidence.push({
          ...evidenceItem,
          score: match.score
        });
        reasoning.push(match.reason);

        // Check if this evidence is unique in the preset
        if (this.isUniqueInPreset(evidenceItem.type, evidenceItem.value)) {
          hasUniqueEvidence = true;
        }
      }
    }

    // Process ALL sponsor evidence intelligently (prioritized by uniqueness)
    if (sponsorEvidence.length > 0) {
      const sponsorResults = this.evaluateAllSponsors(participant, sponsorEvidence);
      totalScore += sponsorResults.totalScore;
      matchedEvidence.push(...sponsorResults.matchedEvidence);
      reasoning.push(...sponsorResults.reasoning);
      if (sponsorResults.hasUniqueEvidence) {
        hasUniqueEvidence = true;
      }
      if (sponsorResults.ghostVehicleWarning) {
        ghostVehicleWarning = true;
      }
    }

    // Apply multi-evidence bonus
    if (matchedEvidence.length >= 2) {
      const bonus = totalScore * this.config.multiEvidenceBonus;
      totalScore += bonus;
      reasoning.push(`Multi-evidence bonus: +${bonus.toFixed(1)} points`);
    }

    // Calculate confidence based on evidence quality and quantity
    const confidence = this.calculateConfidence(matchedEvidence, totalScore);

    return {
      participant,
      score: totalScore,
      evidence: matchedEvidence,
      confidence,
      reasoning,
      // Add flag to indicate unique evidence presence (used for candidate selection)
      hasUniqueEvidence,
      // Add flag to indicate possible ghost vehicle detection
      ghostVehicleWarning
    } as MatchCandidate;
  }

  /**
   * Evaluates a single piece of evidence against a participant
   */
  private evaluateEvidence(
    participant: Participant,
    evidence: Evidence,
    allowFuzzyMatching: boolean = true
  ): { score: number; reason: string } {
    switch (evidence.type) {
      case EvidenceType.RACE_NUMBER:
        return this.evaluateRaceNumber(participant, evidence, allowFuzzyMatching);

      case EvidenceType.DRIVER_NAME:
        return this.evaluateDriverName(participant, evidence);

      case EvidenceType.SPONSOR:
        return this.evaluateSponsor(participant, evidence);

      case EvidenceType.TEAM:
        return this.evaluateTeam(participant, evidence);

      case EvidenceType.CATEGORY:
        return this.evaluateCategory(participant, evidence);

      case EvidenceType.PLATE_NUMBER:
        return this.evaluatePlateNumber(participant, evidence);

      default:
        return { score: 0, reason: 'Unknown evidence type' };
    }
  }

  /**
   * Race number matching with OCR confidence consideration and fuzzy correction
   */
  private evaluateRaceNumber(
    participant: Participant,
    evidence: Evidence,
    allowFuzzyMatching: boolean = true
  ): { score: number; reason: string } {
    const participantNumber = String(participant.numero || participant.number || '');
    const evidenceNumber = String(evidence.value);

    if (!participantNumber || !evidenceNumber) {
      return { score: 0, reason: 'Missing number data' };
    }

    // Exact match - highest score
    if (participantNumber === evidenceNumber) {
      const baseScore = this.config.weights.raceNumber;
      const confidenceAdjustment = (evidence.confidence || 1) * baseScore;
      return {
        score: confidenceAdjustment,
        reason: `Exact number match: ${evidenceNumber} (confidence: ${(evidence.confidence || 1) * 100}%)`
      };
    }

    // Skip fuzzy matching if the recognized number already exists in the database
    // This prevents incorrect matches like "11" → "1" when "11" is a valid participant number
    if (!allowFuzzyMatching) {
      return {
        score: 0,
        reason: `Number mismatch: ${evidenceNumber} ≠ ${participantNumber} (fuzzy matching disabled - recognized number "${evidenceNumber}" exists in database)`
      };
    }

    // Fuzzy number matching for OCR corrections (only when the recognized number doesn't exist)
    const fuzzyMatch = this.evaluateFuzzyNumberMatch(
      participantNumber,
      evidenceNumber,
      evidence.confidence || 1,
      participant,
      this.currentAllEvidence
    );
    if (fuzzyMatch.score > 0) {
      // Track fuzzy number correction for analysis logging
      this.addCorrection({
        type: 'FUZZY',
        field: 'raceNumber',
        originalValue: evidenceNumber,
        correctedValue: participantNumber,
        reason: fuzzyMatch.reason,
        confidence: fuzzyMatch.confidence,
        details: {
          method: 'fuzzy_number_matching',
          originalNumber: evidenceNumber,
          correctedNumber: participantNumber,
          fuzzyScore: fuzzyMatch.score
        }
      });

      return fuzzyMatch;
    }

    return { score: 0, reason: `Number mismatch: ${evidenceNumber} ≠ ${participantNumber}` };
  }

  /**
   * Driver name matching with fuzzy algorithms and uniqueness detection
   *
   * NEW: Applies uniqueness bonus for drivers that appear only once in preset
   *
   * TODO_ML_INTEGRATION: Enhanced with:
   * - Transformer-based name embeddings
   * - Cultural name variation models
   * - Nickname and abbreviation learning
   */
  private evaluateDriverName(
    participant: Participant,
    evidence: Evidence
  ): { score: number; reason: string } {
    const evidenceName = String(evidence.value).toLowerCase().trim();
    const participantNames = [
      participant.nome_pilota,
      participant.nome_navigatore,
      participant.nome_terzo,
      participant.nome_quarto,
      participant.nome // Legacy support
    ].filter(Boolean).map(name => String(name).toLowerCase().trim());

    let bestScore = 0;
    let bestReason = 'No name match found';
    let bestMatchType: 'exact' | 'partial' | 'fuzzy' | null = null;

    for (const participantName of participantNames) {
      const nameWeight = this.config.weights.personName || this.config.weights.driverName || 80;

      // Exact match - apply multiplier for high confidence
      if (participantName === evidenceName) {
        const exactMatchMultiplier = this.getNameMatchMultiplier();
        bestScore = nameWeight * exactMatchMultiplier;
        bestReason = `Exact name match (${exactMatchMultiplier}x): "${evidenceName}"`;
        bestMatchType = 'exact';
        break; // Exact match found, no need to continue
      }

      // Partial match (either direction)
      if (participantName.includes(evidenceName) || evidenceName.includes(participantName)) {
        const score = nameWeight * 0.8;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Partial name match: "${evidenceName}" ↔ "${participantName}"`;
          bestMatchType = 'partial';
        }
        continue;
      }

      // Fuzzy matching
      const similarity = this.calculateJaroWinklerSimilarity(evidenceName, participantName);
      if (similarity >= this.config.thresholds.nameSimilarity) {
        const score = nameWeight * similarity;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Fuzzy name match: "${evidenceName}" ↔ "${participantName}" (similarity: ${(similarity * 100).toFixed(1)}%)`;
          bestMatchType = 'fuzzy';

          // Track fuzzy correction for analysis logging
          this.addCorrection({
            type: 'FUZZY',
            field: 'driverName',
            originalValue: evidenceName,
            correctedValue: participantName,
            reason: `Fuzzy name matching: "${evidenceName}" matched to "${participantName}" with ${(similarity * 100).toFixed(1)}% similarity`,
            confidence: similarity,
            details: {
              participantName,
              similarity,
              method: 'jaro_winkler',
              threshold: this.config.thresholds.nameSimilarity
            }
          });
        }
      }
    }

    // Apply uniqueness bonus if driver name is unique in preset
    if (bestScore > 0 && this.isUniqueInPreset(EvidenceType.DRIVER_NAME, evidenceName)) {
      const occurrenceCount = this.getOccurrenceCount(EvidenceType.DRIVER_NAME, evidenceName);

      // COHERENCE VALIDATION: Verify driver name belongs to this participant
      if (!this.participantHasDriver(participant, evidenceName)) {
        const participantDrivers = [
          participant.nome_pilota,
          participant.nome_navigatore,
          participant.nome_terzo,
          participant.nome_quarto,
          participant.nome
        ].filter(Boolean).map(name => String(name));

        console.warn(`⚠️  [COHERENCE] REJECTED unique driver boost:`);
        console.warn(`    Evidence driver: "${evidenceName}" (unique in preset - appears ${occurrenceCount}x)`);
        console.warn(`    Participant #${participant.numero || participant.number} has: [${participantDrivers.join(', ')}]`);
        console.warn(`    → Driver name doesn't belong to this participant!`);
        console.warn(`    → This is likely a ghost vehicle or cross-contamination issue`);

        // INVALIDATE the match completely
        return {
          score: 0,
          reason: `⚠️ COHERENCE CHECK FAILED: Unique driver "${evidenceName}" doesn't belong to participant #${participant.numero || participant.number} (has: ${participantDrivers.join(', ')})`
        };
      }

      // Driver belongs to participant - proceed with boost
      const originalScore = bestScore;
      bestScore = this.config.weights.raceNumber * 0.95 * (bestMatchType === 'exact' ? 1.0 : 0.85);

      bestReason = `🎯 UNIQUE driver match: "${evidenceName}" (appears only ${occurrenceCount}x in preset) - ${bestMatchType} match - COHERENCE VERIFIED - BOOSTED from ${originalScore.toFixed(1)} to ${bestScore.toFixed(1)} points`;

      console.log(`[SmartMatcher] ${bestReason}`);
    }

    return { score: bestScore, reason: bestReason };
  }

  /**
   * Sponsor matching with enhanced fuzzy logic and uniqueness detection
   *
   * NEW: Properly splits comma-separated sponsors and applies uniqueness bonus
   */
  private evaluateSponsor(
    participant: Participant,
    evidence: Evidence
  ): { score: number; reason: string } {
    const evidenceSponsor = String(evidence.value).toLowerCase().trim();

    // Get participant sponsors using the new extraction method (handles splitting)
    const participantSponsors = this.extractSponsorsFromParticipant(participant);

    if (participantSponsors.length === 0) {
      return { score: 0, reason: 'No sponsor data available' };
    }

    let bestScore = 0;
    let bestReason = 'No sponsor match found';
    let bestMatchType: 'exact' | 'partial' | 'fuzzy' | null = null;

    for (const participantSponsor of participantSponsors) {
      // Exact match
      if (participantSponsor === evidenceSponsor) {
        bestScore = this.config.weights.sponsor;
        bestReason = `Exact sponsor match: "${evidenceSponsor}"`;
        bestMatchType = 'exact';
        break; // Exact match found, no need to continue
      }

      // Partial match (either direction)
      if (participantSponsor.includes(evidenceSponsor) || evidenceSponsor.includes(participantSponsor)) {
        const score = this.config.weights.sponsor * 0.8;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Partial sponsor match: "${evidenceSponsor}" ↔ "${participantSponsor}"`;
          bestMatchType = 'partial';
        }
        continue;
      }

      // Fuzzy matching with abbreviation support
      if (this.isFuzzySponsorMatch(evidenceSponsor, participantSponsor)) {
        const score = this.config.weights.sponsor * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Fuzzy sponsor match: "${evidenceSponsor}" ↔ "${participantSponsor}"`;
          bestMatchType = 'fuzzy';
        }
      }
    }

    // Apply uniqueness bonus if sponsor is unique in preset
    if (bestScore > 0 && this.isUniqueInPreset(EvidenceType.SPONSOR, evidenceSponsor)) {
      const occurrenceCount = this.getOccurrenceCount(EvidenceType.SPONSOR, evidenceSponsor);

      // COHERENCE VALIDATION: Verify sponsor belongs to this participant
      if (!this.participantHasSponsor(participant, evidenceSponsor)) {
        const participantSponsors = this.extractSponsorsFromParticipant(participant);

        console.warn(`⚠️  [COHERENCE] REJECTED unique sponsor boost:`);
        console.warn(`    Evidence sponsor: "${evidenceSponsor}" (unique in preset - appears ${occurrenceCount}x)`);
        console.warn(`    Participant #${participant.numero || participant.number} has: [${participantSponsors.join(', ')}]`);
        console.warn(`    → Sponsor doesn't belong to this participant!`);
        console.warn(`    → This is likely a ghost vehicle or cross-contamination issue`);

        // INVALIDATE the match completely
        return {
          score: 0,
          reason: `⚠️ COHERENCE CHECK FAILED: Unique sponsor "${evidenceSponsor}" doesn't belong to participant #${participant.numero || participant.number} (has: ${participantSponsors.join(', ')})`
        };
      }

      // Sponsor belongs to participant - proceed with boost
      const originalScore = bestScore;
      bestScore = this.config.weights.raceNumber * 0.9 * (bestMatchType === 'exact' ? 1.0 : 0.8);

      bestReason = `🎯 UNIQUE sponsor match: "${evidenceSponsor}" (appears only ${occurrenceCount}x in preset) - ${bestMatchType} match - COHERENCE VERIFIED - BOOSTED from ${originalScore.toFixed(1)} to ${bestScore.toFixed(1)} points`;

      console.log(`[SmartMatcher] ${bestReason}`);
    }

    return { score: bestScore, reason: bestReason };
  }

  /**
   * Intelligent sponsor evaluation - processes ALL sponsors with prioritization
   *
   * This method:
   * 1. Analyzes ALL sponsor evidence from AI (not just first matches)
   * 2. Prioritizes unique sponsors (process them first for higher weight)
   * 3. Detects contradictory sponsors (AI sees sponsor that participant doesn't have)
   * 4. Applies penalty for contradictions
   *
   * @param participant - Participant to evaluate against
   * @param sponsorEvidence - Array of ALL sponsor evidence from AI
   * @returns Aggregated sponsor evaluation results
   */
  private evaluateAllSponsors(
    participant: Participant,
    sponsorEvidence: Evidence[]
  ): {
    totalScore: number;
    matchedEvidence: Evidence[];
    reasoning: string[];
    hasUniqueEvidence: boolean;
    ghostVehicleWarning: boolean;
  } {
    const participantSponsors = this.extractSponsorsFromParticipant(participant);

    if (participantSponsors.length === 0) {
      return {
        totalScore: 0,
        matchedEvidence: [],
        reasoning: ['No sponsor data available for participant'],
        hasUniqueEvidence: false,
        ghostVehicleWarning: false
      };
    }

    // Step 1: Categorize sponsors by uniqueness
    const uniqueSponsors: Evidence[] = [];
    const commonSponsors: Evidence[] = [];

    for (const evidence of sponsorEvidence) {
      if (this.isUniqueInPreset(EvidenceType.SPONSOR, evidence.value)) {
        uniqueSponsors.push(evidence);
      } else {
        commonSponsors.push(evidence);
      }
    }

    console.log(`\n[SmartMatcher] 🔍 ========================================`);
    console.log(`[SmartMatcher] 🔍 Analyzing ${sponsorEvidence.length} sponsors for participant #${participant.numero || participant.number} (${participant.nome || 'Unknown'}):`);
    console.log(`[SmartMatcher]   → AI detected: [${sponsorEvidence.map(s => s.value).join(', ')}]`);
    console.log(`[SmartMatcher]   → Participant has: [${participantSponsors.join(', ')}]`);
    console.log(`[SmartMatcher]   → ${uniqueSponsors.length} UNIQUE sponsors in AI: [${uniqueSponsors.map(s => s.value).join(', ')}]`);
    console.log(`[SmartMatcher]   → ${commonSponsors.length} common sponsors in AI: [${commonSponsors.map(s => s.value).join(', ')}]`);

    // Step 2: Process sponsors in priority order (unique first)
    const prioritizedSponsors = [...uniqueSponsors, ...commonSponsors];

    let totalScore = 0;
    const matchedEvidence: Evidence[] = [];
    const reasoning: string[] = [];
    let hasUniqueEvidence = false;
    const processedSponsorValues = new Set<string>(); // Track processed to avoid duplicates

    for (const evidence of prioritizedSponsors) {
      const sponsorValue = String(evidence.value).toLowerCase().trim();

      // Skip if already processed (avoid double-counting similar sponsors)
      if (processedSponsorValues.has(sponsorValue)) {
        continue;
      }
      processedSponsorValues.add(sponsorValue);

      const match = this.evaluateSponsor(participant, evidence);

      if (match.score > 0) {
        totalScore += match.score;
        matchedEvidence.push({
          ...evidence,
          score: match.score
        });
        reasoning.push(match.reason);

        if (this.isUniqueInPreset(EvidenceType.SPONSOR, evidence.value)) {
          hasUniqueEvidence = true;
        }
      }
    }

    // Step 3: Detect contradictory sponsors (AI sees sponsor that participant DOESN'T have)
    // This helps identify mismatches (e.g., ghost vehicles with wrong sponsors)
    // NEW: Apply penalties for ALL contradictory sponsors, not just unique ones
    const uniqueContradictions: string[] = [];
    const commonContradictions: string[] = [];
    let totalPenalty = 0;

    for (const evidence of sponsorEvidence) {
      const aiSponsor = String(evidence.value).toLowerCase().trim();

      // Check if this sponsor belongs to the participant
      const belongsToParticipant = participantSponsors.some(ps => {
        // Exact match
        if (ps === aiSponsor) return true;
        // Partial match (either direction)
        if (ps.includes(aiSponsor) || aiSponsor.includes(ps)) return true;
        // Fuzzy match
        if (this.isFuzzySponsorMatch(aiSponsor, ps)) return true;
        return false;
      });

      // If sponsor doesn't belong to participant, it's a contradiction
      if (!belongsToParticipant) {
        const isUnique = this.isUniqueInPreset(EvidenceType.SPONSOR, aiSponsor);

        if (isUnique) {
          uniqueContradictions.push(aiSponsor);
          totalPenalty += 30; // 30 points penalty for unique sponsor contradiction
        } else {
          commonContradictions.push(aiSponsor);
          totalPenalty += 15; // 15 points penalty for common sponsor contradiction
        }
      }
    }

    // Apply penalty for contradictions
    if (uniqueContradictions.length > 0 || commonContradictions.length > 0) {
      totalScore -= totalPenalty;

      // Build detailed contradiction message
      const contradictionParts: string[] = [];

      if (uniqueContradictions.length > 0) {
        contradictionParts.push(`${uniqueContradictions.length} UNIQUE sponsor(s): [${uniqueContradictions.join(', ')}] (-${uniqueContradictions.length * 30}pts)`);
      }

      if (commonContradictions.length > 0) {
        contradictionParts.push(`${commonContradictions.length} common sponsor(s): [${commonContradictions.join(', ')}] (-${commonContradictions.length * 15}pts)`);
      }

      const contradictionWarning = `⚠️ CONTRADICTION: AI detected sponsor(s) NOT belonging to this participant: ${contradictionParts.join(', ')} - TOTAL PENALTY: -${totalPenalty} points`;
      reasoning.push(contradictionWarning);

      console.warn(`[SmartMatcher] ${contradictionWarning}`);
      console.warn(`  → This suggests the AI may have detected the wrong vehicle or there's sponsor cross-contamination`);
    }

    // Final summary logging
    const totalContradictions = uniqueContradictions.length + commonContradictions.length;
    const finalScore = Math.max(0, totalScore);

    // Ghost vehicle detection warning
    const contradictionRatio = sponsorEvidence.length > 0
      ? totalContradictions / sponsorEvidence.length
      : 0;

    let ghostVehicleWarning = '';
    if (totalContradictions >= 2 && contradictionRatio >= 0.5) {
      ghostVehicleWarning = `🚨 GHOST VEHICLE ALERT: High contradiction rate (${(contradictionRatio * 100).toFixed(0)}% of sponsors don't belong). This may indicate AI detected wrong vehicle or LED display as separate vehicle.`;
      console.warn(`\n[SmartMatcher] ${ghostVehicleWarning}`);
      console.warn(`[SmartMatcher]    💡 Suggestion: Check if image contains LED position display, multiple vehicles, or overlapping race numbers`);
      reasoning.push(ghostVehicleWarning);
    }

    console.log(`[SmartMatcher] 📊 ----------------------------------------`);
    console.log(`[SmartMatcher] 📊 Sponsor evaluation summary for #${participant.numero || participant.number}:`);
    console.log(`[SmartMatcher]   ✅ Matched: ${matchedEvidence.length} sponsors`);
    console.log(`[SmartMatcher]   ⚠️  Contradictions: ${totalContradictions} total (${uniqueContradictions.length} unique, ${commonContradictions.length} common)`);
    console.log(`[SmartMatcher]   📈 Contradiction ratio: ${(contradictionRatio * 100).toFixed(0)}%`);
    console.log(`[SmartMatcher]   💯 Score breakdown:`);
    console.log(`[SmartMatcher]      - Positive matches: ${totalScore + totalPenalty} points`);
    console.log(`[SmartMatcher]      - Penalty applied: -${totalPenalty} points`);
    console.log(`[SmartMatcher]      - FINAL SCORE: ${finalScore.toFixed(1)} points`);
    console.log(`[SmartMatcher]   🎯 Has unique evidence: ${hasUniqueEvidence}`);
    if (ghostVehicleWarning) {
      console.log(`[SmartMatcher]   ${ghostVehicleWarning}`);
    }
    console.log(`[SmartMatcher] ========================================\n`);

    return {
      totalScore: finalScore,
      matchedEvidence,
      reasoning,
      hasUniqueEvidence,
      ghostVehicleWarning: totalContradictions >= 2 && contradictionRatio >= 0.5
    };
  }

  /**
   * Team name matching with uniqueness detection
   *
   * NEW: Applies uniqueness bonus for teams that appear only once in preset
   */
  private evaluateTeam(
    participant: Participant,
    evidence: Evidence
  ): { score: number; reason: string } {
    const evidenceTeam = String(evidence.value).toLowerCase().trim();
    const participantTeam = String(participant.squadra || participant.team || '').toLowerCase().trim();

    if (!participantTeam) {
      return { score: 0, reason: 'No team data available' };
    }

    let bestScore = 0;
    let bestReason = 'No team match found';
    let bestMatchType: 'exact' | 'partial' | null = null;

    // Exact match
    if (participantTeam === evidenceTeam) {
      bestScore = this.config.weights.team;
      bestReason = `Exact team match: "${evidenceTeam}"`;
      bestMatchType = 'exact';
    }
    // Partial match
    else if (participantTeam.includes(evidenceTeam) || evidenceTeam.includes(participantTeam)) {
      bestScore = this.config.weights.team * 0.8;
      bestReason = `Partial team match: "${evidenceTeam}" ↔ "${participantTeam}"`;
      bestMatchType = 'partial';
    }

    // Apply uniqueness bonus if team is unique in preset
    if (bestScore > 0 && this.isUniqueInPreset(EvidenceType.TEAM, evidenceTeam)) {
      const occurrenceCount = this.getOccurrenceCount(EvidenceType.TEAM, evidenceTeam);

      // COHERENCE VALIDATION: Verify team belongs to this participant
      if (!this.participantHasTeam(participant, evidenceTeam)) {
        console.warn(`⚠️  [COHERENCE] REJECTED unique team boost:`);
        console.warn(`    Evidence team: "${evidenceTeam}" (unique in preset - appears ${occurrenceCount}x)`);
        console.warn(`    Participant #${participant.numero || participant.number} has: "${participantTeam}"`);
        console.warn(`    → Team doesn't belong to this participant!`);
        console.warn(`    → This is likely a ghost vehicle or cross-contamination issue`);

        // INVALIDATE the match completely
        return {
          score: 0,
          reason: `⚠️ COHERENCE CHECK FAILED: Unique team "${evidenceTeam}" doesn't belong to participant #${participant.numero || participant.number} (has: ${participantTeam})`
        };
      }

      // Team belongs to participant - proceed with boost
      const originalScore = bestScore;
      bestScore = this.config.weights.raceNumber * 0.75 * (bestMatchType === 'exact' ? 1.0 : 0.8);

      bestReason = `🎯 UNIQUE team match: "${evidenceTeam}" (appears only ${occurrenceCount}x in preset) - ${bestMatchType} match - COHERENCE VERIFIED - BOOSTED from ${originalScore.toFixed(1)} to ${bestScore.toFixed(1)} points`;

      console.log(`[SmartMatcher] ${bestReason}`);
    }

    if (bestScore === 0) {
      return { score: 0, reason: `No team match: "${evidenceTeam}" ≠ "${participantTeam}"` };
    }

    return { score: bestScore, reason: bestReason };
  }

  /**
   * Get weight for a specific evidence type from current config
   */
  private getWeightForEvidenceType(type: EvidenceType): number {
    const weights = this.config.weights as any;
    switch (type) {
      case EvidenceType.RACE_NUMBER: return weights.raceNumber || 0;
      case EvidenceType.DRIVER_NAME: return weights.personName || weights.driverName || 0;
      case EvidenceType.SPONSOR: return weights.sponsor || 0;
      case EvidenceType.TEAM: return weights.team || 0;
      case EvidenceType.CATEGORY: return weights.category || 0;
      case EvidenceType.PLATE_NUMBER: return weights.plateNumber || 0;
      default: return 0;
    }
  }

  /**
   * Helper to evaluate evidence fields with proper empty value handling
   *
   * Rules:
   * - weight = 0 → evidence disabled, return 0 points
   * - both empty → skip (no information available)
   * - only preset empty → skip (preset incomplete, no penalty)
   * - only AI empty → skip (AI didn't detect, no penalty)
   * - both present → evaluate using callback function
   */
  private evaluateFieldWithEmptyHandling(
    participantValue: string | undefined,
    evidenceValue: string | undefined,
    evidenceType: EvidenceType,
    evaluationFn: (p: string, e: string) => { score: number; reason: string }
  ): { score: number; reason: string } {

    const weight = this.getWeightForEvidenceType(evidenceType);

    // Evidence disabled for this sport
    if (weight === 0) {
      return {
        score: 0,
        reason: `${evidenceType} disabled for ${this.sport} (weight=0)`
      };
    }

    const cleanParticipant = (participantValue || '').trim();
    const cleanEvidence = (evidenceValue || '').trim();

    // Both empty → skip
    if (!cleanParticipant && !cleanEvidence) {
      return {
        score: 0,
        reason: `${evidenceType} not available (both preset & AI empty)`
      };
    }

    // Only preset empty → skip (preset incomplete, not an error)
    if (!cleanParticipant && cleanEvidence) {
      return {
        score: 0,
        reason: `${evidenceType} not in preset (AI detected: ${cleanEvidence}, but preset empty - skipped)`
      };
    }

    // Only AI empty → skip (AI didn't detect field)
    if (cleanParticipant && !cleanEvidence) {
      return {
        score: 0,
        reason: `${evidenceType} not detected by AI (preset has: ${cleanParticipant}, but AI empty - skipped)`
      };
    }

    // Both present → evaluate match/mismatch
    return evaluationFn(cleanParticipant, cleanEvidence);
  }

  /**
   * Evaluate category evidence (GT3, F1, MotoGP, etc.)
   * Uses empty-aware evaluation to handle missing data gracefully
   */
  private evaluateCategory(
    participant: Participant,
    evidence: Evidence
  ): { score: number; reason: string } {
    return this.evaluateFieldWithEmptyHandling(
      participant.categoria || participant.category,
      String(evidence.value),
      EvidenceType.CATEGORY,
      (participantCategory, evidenceCategory) => {
        const pCat = participantCategory.toLowerCase();
        const eCat = evidenceCategory.toLowerCase();

        // Exact match
        if (pCat === eCat) {
          const score = this.config.weights.category || 0;
          return {
            score,
            reason: `Category EXACT match: ${evidenceCategory} (+${score} pts)`
          };
        }

        // Partial match (GT3 vs GT3-PRO, MOTO2 vs MOTO, etc.)
        if (pCat.includes(eCat) || eCat.includes(pCat)) {
          const score = (this.config.weights.category || 0) * 0.7;
          return {
            score,
            reason: `Category PARTIAL: ${evidenceCategory} ≈ ${participantCategory} (+${score.toFixed(1)} pts)`
          };
        }

        // Mismatch → penalty (category contradiction)
        return {
          score: -10,
          reason: `Category MISMATCH: ${evidenceCategory} ≠ ${participantCategory} (-10 pts)`
        };
      }
    );
  }

  /**
   * Evaluate plate number evidence (license plate recognition)
   * Uses empty-aware evaluation and fuzzy matching for OCR errors
   */
  private evaluatePlateNumber(
    participant: Participant,
    evidence: Evidence
  ): { score: number; reason: string } {
    return this.evaluateFieldWithEmptyHandling(
      participant.plate_number,
      String(evidence.value),
      EvidenceType.PLATE_NUMBER,
      (participantPlate, evidencePlate) => {
        // Normalize: uppercase, remove spaces and dashes
        const pPlate = participantPlate.toUpperCase().replace(/[\s-]/g, '');
        const ePlate = evidencePlate.toUpperCase().replace(/[\s-]/g, '');

        // Exact match → very strong evidence (plate more reliable than race number!)
        if (pPlate === ePlate) {
          const score = this.config.weights.plateNumber || 0;
          return {
            score,
            reason: `Plate EXACT: ${ePlate} (+${score} pts)`
          };
        }

        // Fuzzy match for OCR errors (O→0, I→1, B→8, S→5, etc.)
        const similarity = this.calculateOCRSimilarity(pPlate, ePlate);
        if (similarity > 0.85) {
          const score = (this.config.weights.plateNumber || 0) * similarity;
          return {
            score,
            reason: `Plate FUZZY: ${ePlate} ≈ ${pPlate} (${(similarity * 100).toFixed(0)}% similarity, +${score.toFixed(1)} pts)`
          };
        }

        // Mismatch → STRONG penalty (wrong plate = wrong vehicle!)
        return {
          score: -30,
          reason: `Plate WRONG: ${ePlate} ≠ ${pPlate} (-30 pts - possible wrong vehicle!)`
        };
      }
    );
  }

  /**
   * Resolve multiple matches using intelligent rules
   *
   * This method implements the core logic for handling multiple high-scoring
   * candidates and determining when to override OCR-based number matches
   * with stronger evidence from names/sponsors.
   */
  private resolveMatches(
    candidates: MatchCandidate[],
    evidence: Evidence[]
  ): { bestMatch: MatchCandidate | null; multipleHighScores: boolean; resolvedByOverride: boolean } {
    if (candidates.length === 0) {
      return { bestMatch: null, multipleHighScores: false, resolvedByOverride: false };
    }

    const [topCandidate, secondCandidate] = candidates;

    // If there's a clear winner (score difference > threshold), return it
    if (!secondCandidate || topCandidate.score - secondCandidate.score > this.config.thresholds.clearWinner) {
      return {
        bestMatch: topCandidate.score >= this.config.thresholds.minimumScore ? topCandidate : null,
        multipleHighScores: false,
        resolvedByOverride: false
      };
    }

    // Multiple high scores detected - apply intelligent resolution
    const multipleHighScores = true;

    // Check if we have strong non-number evidence that could override OCR
    const hasStrongNonNumberEvidence = this.hasStrongNonNumberEvidence(topCandidate.evidence);
    const raceNumberEvidence = evidence.find(e => e.type === EvidenceType.RACE_NUMBER);

    // If top candidate has strong non-number evidence and low OCR confidence,
    // it might be overriding an incorrect number match
    const resolvedByOverride = hasStrongNonNumberEvidence &&
                              !!raceNumberEvidence &&
                              (raceNumberEvidence.confidence || 1) < this.config.thresholds.lowOcrConfidence;

    return {
      bestMatch: topCandidate.score >= this.config.thresholds.minimumScore ? topCandidate : null,
      multipleHighScores,
      resolvedByOverride
    };
  }

  /**
   * Checks if a candidate has strong evidence from non-number sources
   */
  private hasStrongNonNumberEvidence(evidence: Evidence[]): boolean {
    const nonNumberEvidence = evidence.filter(e => e.type !== EvidenceType.RACE_NUMBER);
    const totalNonNumberScore = nonNumberEvidence.reduce((sum, e) => sum + (e.score || 0), 0);

    return totalNonNumberScore >= this.config.thresholds.strongNonNumberEvidence &&
           nonNumberEvidence.length >= 2; // At least 2 types of evidence
  }

  /**
   * Calculate confidence score based on evidence quality and quantity
   */
  private calculateConfidence(evidence: Evidence[], totalScore: number): number {
    if (evidence.length === 0) return 0;

    // Base confidence from evidence types
    let confidence = Math.min(evidence.length / 4, 1); // Max confidence from having 4+ evidence types

    // Adjust for evidence strength
    const avgEvidenceScore = evidence.reduce((sum, e) => sum + (e.score || 0), 0) / evidence.length;
    const scoreNormalized = Math.min(avgEvidenceScore / 50, 1); // Normalize assuming max score ~50

    confidence = (confidence + scoreNormalized) / 2;

    // Bonus for exact matches
    const hasExactMatch = evidence.some(e => e.value && e.score && e.score >= this.config.weights.raceNumber * 0.9);
    if (hasExactMatch) {
      confidence = Math.min(confidence + 0.2, 1);
    }

    return Math.round(confidence * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Enhanced fuzzy sponsor matching with abbreviation support
   * (Moved from UnifiedImageProcessor and enhanced)
   */
  private isFuzzySponsorMatch(detected: string, sponsor: string): boolean {
    // Common abbreviations and variations
    const commonAbbreviations: { [key: string]: string[] } = {
      'ferrari': ['fer', 'scuderia', 'sf'],
      'lamborghini': ['lambo', 'lamb'],
      'mercedes': ['merc', 'benz', 'amg'],
      'bmw': ['bayerische', 'motoren'],
      'audi': ['quattro', 'sport'],
      'porsche': ['por', 'porshe'],
      'nissan': ['niss'],
      'volkswagen': ['vw', 'volks'],
      'toyota': ['toy'],
      'honda': ['hon'],
      'ford': ['for'],
      'chevrolet': ['chevy', 'chev'],
      'racing': ['race', 'rac'],
      'team': ['tm', 'squad'],
      'motorsport': ['motor', 'sport', 'ms'],
      'technology': ['tech', 'tek'],
      'performance': ['perf', 'perform'],
      'engineering': ['eng', 'engineer']
    };

    // Check for abbreviation matches
    for (const [fullTerm, abbreviations] of Object.entries(commonAbbreviations)) {
      if ((detected.includes(fullTerm) && abbreviations.some(abbr => sponsor.includes(abbr))) ||
          (sponsor.includes(fullTerm) && abbreviations.some(abbr => detected.includes(abbr)))) {
        return true;
      }
    }

    // Levenshtein distance for similar words
    const detectedWords = detected.split(/\s+/);
    const sponsorWords = sponsor.split(/\s+/);

    for (const detectedWord of detectedWords) {
      for (const sponsorWord of sponsorWords) {
        if (detectedWord.length >= 4 && sponsorWord.length >= 4) {
          const similarity = this.calculateLevenshteinDistance(detectedWord, sponsorWord);
          if (similarity <= 2) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Jaro-Winkler similarity for name matching
   */
  private calculateJaroWinklerSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;

    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0 || len2 === 0) return 0.0;

    const matchWindow = Math.max(len1, len2) / 2 - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, len2);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    // Count transpositions
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

    // Winkler modification
    let prefix = 0;
    for (let i = 0; i < Math.min(len1, len2, 4); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    return jaro + (0.1 * prefix * (1 - jaro));
  }

  /**
   * Levenshtein distance calculation
   */
  private calculateLevenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Apply temporal proximity bonuses to matching candidates
   *
   * This method implements temporal clustering logic where photos taken
   * in quick succession (burst mode) or within the sport-specific time window
   * receive bonus points if they match the same participant.
   */
  private async applyTemporalBonuses(
    candidates: MatchCandidate[],
    analysisResult: AnalysisResult,
    vehicleIndex?: number
  ): Promise<void> {
    if (!analysisResult.imageTimestamp || !analysisResult.temporalNeighbors) {
      return;
    }

    const proximityBonus = this.temporalManager.getProximityBonus(this.sport);
    console.log(`[SmartMatcher] Applying temporal bonuses for ${this.sport} (bonus: ${proximityBonus} points)`);

    // Look for high-confidence matches in temporal neighbors
    const neighborMatches = await this.analyzeTemporalNeighbors(
      analysisResult.temporalNeighbors,
      candidates
    );

    if (neighborMatches.length === 0) {
      console.log(`[SmartMatcher] No temporal neighbor matches found`);
      return;
    }

    console.log(`[SmartMatcher] Found ${neighborMatches.length} temporal neighbor matches`);

    // Apply bonuses to candidates based on temporal evidence
    for (const candidate of candidates) {
      const participantNumber = String(candidate.participant.numero || candidate.participant.number || '');

      // Find matching participants in temporal neighbors
      const temporalMatches = neighborMatches.filter(nm => {
        const neighborNumber = String(nm.participantNumber);
        return neighborNumber === participantNumber && nm.confidence >= 0.8; // High confidence threshold
      });

      if (temporalMatches.length > 0) {
        // Calculate temporal bonus based on:
        // 1. Number of temporal matches
        // 2. Average confidence of temporal matches
        // 3. Burst mode detection
        const avgConfidence = temporalMatches.reduce((sum, match) => sum + match.confidence, 0) / temporalMatches.length;
        const burstModeBonus = this.detectBurstMode(analysisResult.imageTimestamp, temporalMatches) ? 1.5 : 1.0;

        const temporalBonus = Math.floor(proximityBonus * temporalMatches.length * avgConfidence * burstModeBonus);

        // Apply the bonus
        candidate.score += temporalBonus;
        candidate.temporalBonus = temporalBonus;
        candidate.temporalClusterSize = temporalMatches.length;
        candidate.isBurstModeCandidate = burstModeBonus > 1.0;

        // Add reasoning for the temporal bonus
        candidate.reasoning.push(
          `Temporal proximity bonus: +${temporalBonus} points (${temporalMatches.length} neighbors, ${(avgConfidence * 100).toFixed(1)}% avg confidence${burstModeBonus > 1.0 ? ', burst mode detected' : ''})`
        );

        console.log(`[SmartMatcher] ✨ TEMPORAL BONUS APPLIED ✨`);
        console.log(`[SmartMatcher] → Vehicle ${vehicleIndex !== undefined ? vehicleIndex : 'unknown'}: Participant ${participantNumber}: +${temporalBonus} points`);
        console.log(`[SmartMatcher] → Found in ${temporalMatches.length} neighboring images`);
        console.log(`[SmartMatcher] → Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
        console.log(`[SmartMatcher] → ${burstModeBonus > 1.0 ? '🔥 BURST MODE DETECTED (1.5x bonus)' : '📷 Standard temporal bonus'}`);
        console.log(`[SmartMatcher] → Neighbors: ${temporalMatches.map(m => m.fileName).join(', ')}`);

        // Track temporal correction for analysis logging
        this.addCorrection({
          type: 'TEMPORAL',
          field: 'raceNumber',
          originalValue: participantNumber, // This might be corrected by temporal logic
          correctedValue: participantNumber,
          reason: `Temporal proximity confirmation: ${temporalMatches.length} neighboring images confirm participant ${participantNumber}${burstModeBonus > 1.0 ? ' (burst mode detected)' : ''}`,
          confidence: avgConfidence,
          vehicleIndex: vehicleIndex, // Add vehicle index for proper log filtering
          details: {
            neighborCount: temporalMatches.length,
            burstMode: burstModeBonus > 1.0,
            timeDifferences: temporalMatches.map(m => ({
              fileName: m.fileName,
              timeDiff: Math.abs(m.timestamp.getTime() - analysisResult.imageTimestamp!.timestamp!.getTime())
            })),
            maxTimeDiff: Math.max(...temporalMatches.map(m =>
              Math.abs(m.timestamp.getTime() - analysisResult.imageTimestamp!.timestamp!.getTime())
            )),
            bonusPoints: temporalBonus
          }
        });
      }
    }
  }

  /**
   * Analyze temporal neighbors to find high-confidence matches
   */
  private async analyzeTemporalNeighbors(
    neighbors: ImageTimestamp[],
    currentCandidates: MatchCandidate[]
  ): Promise<Array<{ participantNumber: string; confidence: number; timestamp: Date; fileName: string }>> {
    console.log(`[SmartMatcher] Starting temporal neighbor analysis for ${neighbors.length} neighbors`);

    const neighborMatches: Array<{ participantNumber: string; confidence: number; timestamp: Date; fileName: string }> = [];

    // Check each temporal neighbor for cached results
    for (const neighbor of neighbors) {
      if (!neighbor.timestamp) {
        console.log(`[SmartMatcher] Skipping neighbor ${neighbor.fileName} - no valid timestamp`);
        continue;
      }

      const cacheKey = neighbor.filePath.toLowerCase();
      const cachedResult = SmartMatcher.temporalAnalysisCache.get(cacheKey);

      if (cachedResult) {
        // Use cached result for this neighbor
        console.log(`[SmartMatcher] Found cached result for ${neighbor.fileName}: #${cachedResult.participantNumber} (${(cachedResult.confidence * 100).toFixed(1)}%)`);

        // Only include high-confidence matches for temporal bonus
        if (cachedResult.confidence >= 0.7) {
          neighborMatches.push({
            participantNumber: cachedResult.participantNumber,
            confidence: cachedResult.confidence,
            timestamp: neighbor.timestamp,
            fileName: neighbor.fileName
          });
        } else {
          console.log(`[SmartMatcher] Skipping low-confidence result for ${neighbor.fileName} (${(cachedResult.confidence * 100).toFixed(1)}%)`);
        }
      } else {
        console.log(`[SmartMatcher] No cached result for ${neighbor.fileName} - neighbor not yet analyzed`);
      }
    }

    console.log(`[SmartMatcher] Found ${neighborMatches.length} high-confidence neighbor matches from ${neighbors.length} neighbors`);

    return neighborMatches;
  }

  /**
   * Detect if images are in burst mode (very close timing)
   */
  private detectBurstMode(
    currentImage: ImageTimestamp,
    temporalMatches: Array<{ timestamp: Date }>
  ): boolean {
    // Skip if current image doesn't have valid timestamp
    if (currentImage.timestamp === null) {
      return false;
    }

    const currentTime = currentImage.timestamp.getTime();

    // Check if any temporal match is within burst threshold
    return temporalMatches.some(match => {
      const timeDiff = Math.abs(match.timestamp.getTime() - currentTime);
      return this.temporalManager.isInBurstMode(
        currentImage,
        { ...currentImage, timestamp: match.timestamp },
        this.sport
      );
    });
  }

  /**
   * Public method to set temporal context for an analysis
   * This should be called before findMatches() when temporal data is available
   */
  async setTemporalContext(
    imagePath: string,
    allImagePaths: string[]
  ): Promise<{ imageTimestamp: ImageTimestamp; temporalNeighbors: ImageTimestamp[] }> {
    console.log(`[SmartMatcher] Setting temporal context for ${imagePath}`);

    // Extract timestamps for all images
    const imageTimestamps: ImageTimestamp[] = [];

    for (const path of allImagePaths) {
      try {
        const timestamp = await this.temporalManager.extractTimestamp(path);
        imageTimestamps.push(timestamp);
      } catch (error) {
        console.warn(`[SmartMatcher] Failed to extract timestamp for ${path}:`, error);
      }
    }

    // Find the current image
    const currentImageTimestamp = imageTimestamps.find(img => img.filePath === imagePath);
    if (!currentImageTimestamp) {
      throw new Error(`Current image timestamp not found for ${imagePath}`);
    }

    // Get temporal neighbors
    const temporalNeighbors = this.temporalManager.getTemporalNeighbors(
      currentImageTimestamp,
      imageTimestamps,
      this.sport
    );

    console.log(`[SmartMatcher] Found ${temporalNeighbors.length} temporal neighbors for ${imagePath}`);

    return {
      imageTimestamp: currentImageTimestamp,
      temporalNeighbors
    };
  }

  /**
   * Evaluate fuzzy matching for race numbers to handle OCR errors
   * Common OCR errors: 0↔O, 1↔l, 6↔G, 8↔B, 5↔S, digit transposition (45↔54)
   * Enhanced with driver name validation to prevent false corrections
   */
  private evaluateFuzzyNumberMatch(
    participantNumber: string,
    evidenceNumber: string,
    confidence: number,
    participant?: Participant,
    allEvidence?: Evidence[]
  ): { score: number; reason: string; confidence: number } {
    // Check for driver name contradictions before applying fuzzy number matching
    if (participant && allEvidence) {
      const driverEvidence = allEvidence.filter(e => e.type === EvidenceType.DRIVER_NAME);
      if (driverEvidence.length > 0) {
        const hasValidDriverMatch = this.validateDriverNameCoherence(participant, driverEvidence);
        if (!hasValidDriverMatch) {
          return {
            score: 0,
            reason: `Fuzzy number match rejected: driver names don't match (${driverEvidence.map(e => e.value).join(', ')} vs ${this.getParticipantDriverNames(participant).join(', ')})`,
            confidence: 0
          };
        }
      }
    }

    // Apply sport-specific OCR similarity thresholds
    const sportThreshold = this.getSportSpecificOCRThreshold();

    // Only apply fuzzy matching for similar length numbers
    if (Math.abs(participantNumber.length - evidenceNumber.length) > 1) {
      return { score: 0, reason: 'Length difference too large', confidence: 0 };
    }

    // Calculate edit distance
    const editDistance = this.calculateLevenshteinDistance(participantNumber, evidenceNumber);

    // Only allow 1-2 character differences for race numbers
    if (editDistance > 2) {
      return { score: 0, reason: 'Too many character differences', confidence: 0 };
    }

    // Check for common OCR character confusions
    const ocrSimilarity = this.calculateOCRSimilarity(participantNumber, evidenceNumber);

    if (ocrSimilarity > sportThreshold) {
      // Apply reduced score for fuzzy match
      let fuzzyWeight = 0.7; // 70% of exact match score

      // Further reduce weight when driver names are detected but don't match
      if (participant && allEvidence) {
        const driverEvidence = allEvidence.filter(e => e.type === EvidenceType.DRIVER_NAME);
        if (driverEvidence.length > 0) {
          const hasValidDriverMatch = this.validateDriverNameCoherence(participant, driverEvidence);
          if (hasValidDriverMatch) {
            // Names match - apply normal fuzzy weight
            fuzzyWeight = 0.7;
          } else {
            // Names don't match but we passed the initial check - apply heavy penalty
            fuzzyWeight = 0.3; // 30% weight due to name contradiction
          }
        }
      }

      const baseScore = this.config.weights.raceNumber * fuzzyWeight;
      const confidenceAdjustment = confidence * baseScore;
      const finalScore = confidenceAdjustment * ocrSimilarity;

      return {
        score: finalScore,
        reason: `Fuzzy number match: ${evidenceNumber} → ${participantNumber} (OCR similarity: ${(ocrSimilarity * 100).toFixed(1)}%, edit distance: ${editDistance})`,
        confidence: ocrSimilarity * confidence
      };
    }

    // Check for digit transposition (45 ↔ 54)
    if (this.isDigitTransposition(participantNumber, evidenceNumber)) {
      const baseScore = this.config.weights.raceNumber * 0.6; // 60% of exact match score
      const confidenceAdjustment = confidence * baseScore;

      return {
        score: confidenceAdjustment,
        reason: `Digit transposition detected: ${evidenceNumber} → ${participantNumber}`,
        confidence: 0.8 * confidence
      };
    }

    return { score: 0, reason: 'No fuzzy match found', confidence: 0 };
  }

  /**
   * Calculate OCR-specific character similarity
   * Accounts for common OCR confusion pairs
   */
  private calculateOCRSimilarity(str1: string, str2: string): number {
    if (str1.length !== str2.length) {
      return 0;
    }

    // Common OCR confusions (character pairs that are often mistaken)
    const ocrConfusions: { [key: string]: string[] } = {
      '0': ['O', 'o', 'Q'],
      'O': ['0', 'o', 'Q'],
      '1': ['l', 'I', '|'],
      'l': ['1', 'I', '|'],
      'I': ['1', 'l', '|'],
      '6': ['G', 'g'],
      'G': ['6', 'g'],
      '8': ['B', '3'],
      'B': ['8', '3'],
      '5': ['S', 's'],
      'S': ['5', 's'],
      '2': ['Z', 'z'],
      'Z': ['2', 'z']
    };

    let matches = 0;
    for (let i = 0; i < str1.length; i++) {
      const char1 = str1[i].toUpperCase();
      const char2 = str2[i].toUpperCase();

      if (char1 === char2) {
        matches++; // Exact match
      } else if (ocrConfusions[char1] && ocrConfusions[char1].includes(char2)) {
        matches += 0.8; // OCR confusion match (weighted)
      }
    }

    return matches / str1.length;
  }

  /**
   * Check if two numbers are digit transpositions (45 ↔ 54)
   */
  private isDigitTransposition(str1: string, str2: string): boolean {
    if (str1.length !== str2.length || str1.length < 2) {
      return false;
    }

    // Sort characters in both strings and compare
    const sorted1 = str1.split('').sort().join('');
    const sorted2 = str2.split('').sort().join('');

    // Must contain exactly the same digits
    if (sorted1 !== sorted2) {
      return false;
    }

    // Count differences in position
    let differences = 0;
    for (let i = 0; i < str1.length; i++) {
      if (str1[i] !== str2[i]) {
        differences++;
      }
    }

    // Transposition should have exactly 2 differences (the swapped positions)
    return differences === 2;
  }

  /**
   * Validate that driver names from evidence are coherent with participant data
   * Returns true if names match or there's reasonable similarity
   */
  private validateDriverNameCoherence(participant: Participant, driverEvidence: Evidence[]): boolean {
    const participantNames = this.getParticipantDriverNames(participant);

    if (participantNames.length === 0) {
      // No participant names to compare against, allow fuzzy match
      return true;
    }

    // Check if any evidence name has reasonable similarity to any participant name
    for (const evidence of driverEvidence) {
      const evidenceName = String(evidence.value).toLowerCase().trim();

      for (const participantName of participantNames) {
        // Exact or partial match
        if (participantName.includes(evidenceName) || evidenceName.includes(participantName)) {
          return true;
        }

        // Fuzzy match with reasonable threshold
        const similarity = this.calculateJaroWinklerSimilarity(evidenceName, participantName);
        if (similarity >= 0.7) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract all driver names from participant data
   */
  private getParticipantDriverNames(participant: Participant): string[] {
    const names = [
      participant.nome_pilota,
      participant.nome_navigatore,
      participant.nome_terzo,
      participant.nome_quarto,
      participant.nome // Legacy support
    ].filter(Boolean).map(name => String(name).toLowerCase().trim());

    return names;
  }

  /**
   * Get sport-specific OCR similarity threshold
   * Rally requires higher confidence due to importance of precise number matching
   */
  private getSportSpecificOCRThreshold(): number {
    switch (this.sport.toLowerCase()) {
      case 'rally':
        return 0.85; // Higher threshold for rally - more conservative
      case 'motorsport':
        return 0.75; // Standard threshold
      case 'running':
        return 0.7;  // Lower threshold - numbers often partially obscured
      default:
        return 0.7;  // Default threshold
    }
  }

  /**
   * Get sport-specific multiplier for exact name matches
   * Higher multipliers give more weight to driver name accuracy
   */
  private getNameMatchMultiplier(): number {
    switch (this.sport.toLowerCase()) {
      case 'rally':
        return 2.5; // Highest multiplier - driver+navigator names are signature
      case 'motorsport':
        return 2.0; // High multiplier - driver names are very reliable
      case 'running':
        return 1.8; // Good multiplier - names important but numbers vary more
      default:
        return 1.8; // Default multiplier for exact name matches
    }
  }

  /**
   * Try fast-track matching based on high-confidence driver name matches
   * This method is called BEFORE OCR corrections and fuzzy matching
   * Returns immediately if a high-confidence name match is found
   */
  private tryFastTrackNameMatch(
    analysisResult: AnalysisResult,
    participants: Participant[]
  ): MatchCandidate | null {
    // Skip fast-track if no driver names were recognized
    if (!analysisResult.drivers || analysisResult.drivers.length === 0) {
      return null;
    }

    const fastTrackThreshold = 150; // Minimum score for fast-track acceptance
    let bestCandidate: MatchCandidate | null = null;
    let highestScore = 0;

    console.log(`[FastTrack] Attempting fast-track matching with ${analysisResult.drivers.length} recognized names: ${analysisResult.drivers.join(', ')}`);

    // Check each participant for strong name matches
    for (const participant of participants) {
      const participantNames = this.getParticipantDriverNames(participant);
      if (participantNames.length === 0) continue;

      let nameMatchScore = 0;
      const nameMatches: string[] = [];

      // Check each recognized name against participant names
      const nameWeight = this.config.weights.personName || this.config.weights.driverName || 80;
      for (const recognizedName of analysisResult.drivers) {
        const cleanRecognizedName = recognizedName.toLowerCase().trim();

        for (const participantName of participantNames) {
          // Exact match gets full multiplier
          if (participantName === cleanRecognizedName) {
            const exactScore = nameWeight * this.getNameMatchMultiplier();
            nameMatchScore += exactScore;
            nameMatches.push(`${recognizedName} (exact: +${exactScore})`);
            break; // Found exact match, no need to check fuzzy for this name
          }

          // Partial match (less priority but still significant)
          else if (participantName.includes(cleanRecognizedName) || cleanRecognizedName.includes(participantName)) {
            const partialScore = nameWeight * 0.8;
            if (partialScore > 0) { // Only add if it's the best match for this recognized name
              nameMatchScore += partialScore;
              nameMatches.push(`${recognizedName} (partial: +${partialScore})`);
              break;
            }
          }
        }
      }

      // If we found significant name matches, create a candidate
      if (nameMatchScore > 0) {
        // Add small bonus for number match if present
        let numberScore = 0;
        const participantNumber = String(participant.numero || participant.number || '');
        if (analysisResult.raceNumber && participantNumber === String(analysisResult.raceNumber)) {
          numberScore = this.config.weights.raceNumber;
        }

        const totalScore = nameMatchScore + numberScore;

        if (totalScore > highestScore) {
          const reasoning = [
            ...nameMatches,
            ...(numberScore > 0 ? [`Number match: +${numberScore}`] : [])
          ];

          bestCandidate = {
            participant,
            score: totalScore,
            evidence: [], // Will be populated if this becomes the final match
            confidence: Math.min(0.95, 0.7 + (totalScore / 300)), // High confidence for strong name matches
            reasoning,
            temporalBonus: 0,
            temporalClusterSize: 0,
            isBurstModeCandidate: false
          };

          highestScore = totalScore;
        }
      }
    }

    // Return candidate only if it exceeds our high-confidence threshold
    if (bestCandidate && bestCandidate.score >= fastTrackThreshold) {
      console.log(`[FastTrack] Found high-confidence match: participant ${bestCandidate.participant.numero || bestCandidate.participant.number} with score ${bestCandidate.score.toFixed(1)}`);
      console.log(`[FastTrack] Reasoning: ${bestCandidate.reasoning.join(', ')}`);

      // Track this as a fast-track correction
      this.addCorrection({
        type: 'FAST_TRACK',
        field: 'driverName',
        originalValue: analysisResult.drivers?.join(', ') || '',
        correctedValue: this.getParticipantDriverNames(bestCandidate.participant).join(', '),
        reason: `Fast-track name matching bypassed OCR corrections due to high-confidence name match (score: ${bestCandidate.score.toFixed(1)})`,
        confidence: bestCandidate.confidence,
        details: {
          recognizedNames: analysisResult.drivers,
          participantNames: this.getParticipantDriverNames(bestCandidate.participant),
          threshold: fastTrackThreshold,
          scoreBreakdown: bestCandidate.reasoning
        }
      });

      return bestCandidate;
    }

    console.log(`[FastTrack] No high-confidence name match found (best score: ${highestScore.toFixed(1)}, threshold: ${fastTrackThreshold})`);
    return null;
  }
}