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
    return {
      raceNumber: this.config.weights.raceNumber,
      driverName: this.config.weights.driverName,
      sponsor: this.config.weights.sponsor,
      team: this.config.weights.team
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
        case EvidenceType.DRIVER_NAME:
          weightUsed = weights.driverName;
          evidenceType = 'Driver Name';
          break;
        case EvidenceType.SPONSOR:
          weightUsed = weights.sponsor;
          evidenceType = 'Sponsor';
          break;
        case EvidenceType.TEAM:
          weightUsed = weights.team;
          evidenceType = 'Team';
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

    // Set current evidence context for advanced matching
    this.currentAllEvidence = evidence;

    for (const evidenceItem of evidence) {
      const match = this.evaluateEvidence(participant, evidenceItem, allowFuzzyMatching);
      if (match.score > 0) {
        totalScore += match.score;
        matchedEvidence.push({
          ...evidenceItem,
          score: match.score
        });
        reasoning.push(match.reason);
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
      reasoning
    };
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
   * Driver name matching with fuzzy algorithms
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

    for (const participantName of participantNames) {
      // Exact match - apply multiplier for high confidence
      if (participantName === evidenceName) {
        const exactMatchMultiplier = this.getNameMatchMultiplier();
        const enhancedScore = this.config.weights.driverName * exactMatchMultiplier;
        return {
          score: enhancedScore,
          reason: `Exact name match (${exactMatchMultiplier}x): "${evidenceName}"`
        };
      }

      // Partial match (either direction)
      if (participantName.includes(evidenceName) || evidenceName.includes(participantName)) {
        const score = this.config.weights.driverName * 0.8;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Partial name match: "${evidenceName}" ↔ "${participantName}"`;
        }
        continue;
      }

      // Fuzzy matching
      const similarity = this.calculateJaroWinklerSimilarity(evidenceName, participantName);
      if (similarity >= this.config.thresholds.nameSimilarity) {
        const score = this.config.weights.driverName * similarity;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Fuzzy name match: "${evidenceName}" ↔ "${participantName}" (similarity: ${(similarity * 100).toFixed(1)}%)`;

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

    return { score: bestScore, reason: bestReason };
  }

  /**
   * Sponsor matching with enhanced fuzzy logic
   */
  private evaluateSponsor(
    participant: Participant,
    evidence: Evidence
  ): { score: number; reason: string } {
    const evidenceSponsor = String(evidence.value).toLowerCase().trim();

    // Get participant sponsors
    let participantSponsors: string[] = [];
    if (participant.sponsor) {
      participantSponsors = Array.isArray(participant.sponsor)
        ? participant.sponsor
        : [participant.sponsor];
    }
    if (participant.sponsors && Array.isArray(participant.sponsors)) {
      participantSponsors = [...participantSponsors, ...participant.sponsors];
    }

    participantSponsors = participantSponsors
      .filter(Boolean)
      .map(s => String(s).toLowerCase().trim());

    if (participantSponsors.length === 0) {
      return { score: 0, reason: 'No sponsor data available' };
    }

    let bestScore = 0;
    let bestReason = 'No sponsor match found';

    for (const participantSponsor of participantSponsors) {
      // Exact match
      if (participantSponsor === evidenceSponsor) {
        return {
          score: this.config.weights.sponsor,
          reason: `Exact sponsor match: "${evidenceSponsor}"`
        };
      }

      // Partial match (either direction)
      if (participantSponsor.includes(evidenceSponsor) || evidenceSponsor.includes(participantSponsor)) {
        const score = this.config.weights.sponsor * 0.8;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Partial sponsor match: "${evidenceSponsor}" ↔ "${participantSponsor}"`;
        }
        continue;
      }

      // Fuzzy matching with abbreviation support
      if (this.isFuzzySponsorMatch(evidenceSponsor, participantSponsor)) {
        const score = this.config.weights.sponsor * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Fuzzy sponsor match: "${evidenceSponsor}" ↔ "${participantSponsor}"`;
        }
      }
    }

    return { score: bestScore, reason: bestReason };
  }

  /**
   * Team name matching
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

    // Exact match
    if (participantTeam === evidenceTeam) {
      return {
        score: this.config.weights.team,
        reason: `Exact team match: "${evidenceTeam}"`
      };
    }

    // Partial match
    if (participantTeam.includes(evidenceTeam) || evidenceTeam.includes(participantTeam)) {
      return {
        score: this.config.weights.team * 0.8,
        reason: `Partial team match: "${evidenceTeam}" ↔ "${participantTeam}"`
      };
    }

    return { score: 0, reason: `No team match: "${evidenceTeam}" ≠ "${participantTeam}"` };
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
      for (const recognizedName of analysisResult.drivers) {
        const cleanRecognizedName = recognizedName.toLowerCase().trim();

        for (const participantName of participantNames) {
          // Exact match gets full multiplier
          if (participantName === cleanRecognizedName) {
            const exactScore = this.config.weights.driverName * this.getNameMatchMultiplier();
            nameMatchScore += exactScore;
            nameMatches.push(`${recognizedName} (exact: +${exactScore})`);
            break; // Found exact match, no need to check fuzzy for this name
          }

          // Partial match (less priority but still significant)
          else if (participantName.includes(cleanRecognizedName) || cleanRecognizedName.includes(participantName)) {
            const partialScore = this.config.weights.driverName * 0.8;
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