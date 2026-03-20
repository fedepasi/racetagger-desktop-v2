/**
 * EvidenceCollector - Multi-source evidence extraction and fusion
 *
 * This module handles the extraction of evidence from AI analysis results
 * and prepares it for intelligent matching. It normalizes data from different
 * sources and applies quality scoring.
 *
 * TODO_ML_INTEGRATION: This module is designed for easy enhancement with:
 * - Confidence learning from historical success rates
 * - Automated evidence quality assessment
 * - Context-aware evidence weighting
 */

export enum EvidenceType {
  RACE_NUMBER = 'race_number',
  PERSON_NAME = 'person_name',
  /** @deprecated Use PERSON_NAME instead */
  DRIVER_NAME = 'person_name',
  SPONSOR = 'sponsor',
  TEAM = 'team',
  CATEGORY = 'category',
  PLATE_NUMBER = 'plate_number',
  // Visual DNA evidence (V6 Vehicle DNA / Gemini visual analysis)
  VEHICLE_MAKE = 'vehicle_make',     // Manufacturer: Ferrari, Honda, Pinarello, etc.
  VEHICLE_MODEL = 'vehicle_model',   // Model: 296 GT3, CBR1000RR, Dogma F, etc.
  LIVERY_COLOR = 'livery_color'      // Primary livery/jersey/gear color
}

export interface Evidence {
  type: EvidenceType;
  value: string;
  confidence: number;
  source: string;
  score?: number; // Assigned during matching process
  quality?: number; // Quality assessment (0-1)
}

export interface MatchingConfig {
  weights: {
    raceNumber: number;
    personName: number;
    /** @deprecated Use personName instead */
    driverName?: number;
    sponsor: number;
    team: number;
    // Visual DNA weights (optional for backward compatibility)
    vehicleMake?: number;     // Weight for manufacturer match
    vehicleModel?: number;    // Weight for model match
    liveryColor?: number;     // Weight for primary livery/jersey color match
  };
  thresholds: {
    minimumScore: number;
    clearWinner: number;
    nameSimilarity: number;
    lowOcrConfidence: number;
    strongNonNumberEvidence: number;
  };
  multiEvidenceBonus: number;
}

/**
 * EvidenceCollector Class
 *
 * Responsible for extracting structured evidence from unstructured
 * AI analysis results and preparing it for matching algorithms.
 */
export class EvidenceCollector {
  private config: MatchingConfig;

  constructor(config: MatchingConfig) {
    this.config = config;
  }

  /**
   * Extract all evidence from an analysis result
   *
   * @param analysisResult - AI analysis result from image processing
   * @returns Array of structured evidence items
   */
  extractEvidence(analysisResult: any): Evidence[] {
    const evidence: Evidence[] = [];

    // Extract race number evidence (with sanitization of garbage AI responses)
    if (analysisResult.raceNumber) {
      const rawNumber = String(analysisResult.raceNumber).trim();
      // Filter out garbage values that AI models sometimes return when they can't detect a number
      const GARBAGE_RACE_NUMBERS = ['null', 'undefined', 'none', 'n/a', 'na', 'unknown', '0', '-', '--', '?', ''];
      const isGarbageNumber = GARBAGE_RACE_NUMBERS.includes(rawNumber.toLowerCase());

      if (isGarbageNumber) {
        console.warn(`[EvidenceCollector] Filtered garbage raceNumber="${rawNumber}" from AI response`);
      } else {
        evidence.push({
          type: EvidenceType.RACE_NUMBER,
          value: rawNumber,
          confidence: analysisResult.confidence || 1.0,
          source: 'ocr_analysis',
          quality: this.assessRaceNumberQuality(analysisResult.raceNumber, analysisResult.confidence)
        });
      }
    }

    // Extract person name evidence (from drivers/persons array)
    const persons = analysisResult.persons || analysisResult.drivers;
    if (persons && Array.isArray(persons)) {
      for (const person of persons) {
        if (person && typeof person === 'string' && person.trim().length > 0) {
          evidence.push({
            type: EvidenceType.PERSON_NAME,
            value: person.trim(),
            confidence: 0.8, // Person names typically have good recognition
            source: 'ocr_analysis',
            quality: this.assessNameQuality(person)
          });
        }
      }
    }

    // Extract sponsor evidence from otherText
    if (analysisResult.otherText && Array.isArray(analysisResult.otherText)) {
      for (const text of analysisResult.otherText) {
        if (text && typeof text === 'string' && text.trim().length > 0) {
          const cleanText = text.trim();
          if (this.looksLikeSponsor(cleanText)) {
            evidence.push({
              type: EvidenceType.SPONSOR,
              value: cleanText,
              confidence: 0.7, // Sponsors can be ambiguous
              source: 'ocr_analysis',
              quality: this.assessSponsorQuality(cleanText)
            });
          }
        }
      }
    }

    // Extract team evidence
    if (analysisResult.teamName) {
      evidence.push({
        type: EvidenceType.TEAM,
        value: String(analysisResult.teamName),
        confidence: 0.8,
        source: 'ocr_analysis',
        quality: this.assessTeamQuality(analysisResult.teamName)
      });
    }

    // Extract category evidence (AI classification)
    if (analysisResult.category && typeof analysisResult.category === 'string') {
      evidence.push({
        type: EvidenceType.CATEGORY,
        value: String(analysisResult.category).trim(),
        confidence: 0.9, // Category usually has high confidence
        source: 'ai_classification',
        quality: 1.0 // Category classification is typically reliable
      });
    }

    // Extract plate number evidence (if detectPlateNumber is enabled in sport category)
    if (analysisResult.plateNumber && typeof analysisResult.plateNumber === 'string') {
      evidence.push({
        type: EvidenceType.PLATE_NUMBER,
        value: String(analysisResult.plateNumber).trim(),
        confidence: analysisResult.plateConfidence || 0.85,
        source: 'ocr_plate_recognition',
        quality: this.assessPlateNumberQuality(analysisResult.plateNumber)
      });
    }

    // Extract Vehicle DNA evidence (V6 visual analysis from Gemini)
    // These provide make, model, and livery color for visual matching
    if (analysisResult.make && typeof analysisResult.make === 'string') {
      const make = String(analysisResult.make).trim();
      if (make.length >= 2) {
        evidence.push({
          type: EvidenceType.VEHICLE_MAKE,
          value: make,
          confidence: 0.85, // Gemini vehicle make detection is generally reliable
          source: 'ai_visual_analysis',
          quality: this.assessMakeModelQuality(make)
        });
      }
    }

    if (analysisResult.model && typeof analysisResult.model === 'string') {
      const model = String(analysisResult.model).trim();
      if (model.length >= 2) {
        evidence.push({
          type: EvidenceType.VEHICLE_MODEL,
          value: model,
          confidence: 0.8, // Model detection slightly less reliable than make
          source: 'ai_visual_analysis',
          quality: this.assessMakeModelQuality(model)
        });
      }
    }

    if (analysisResult.livery) {
      // Livery can be an object { primary: string, secondary: string[] } or a string
      const primaryColor = typeof analysisResult.livery === 'string'
        ? analysisResult.livery.trim()
        : analysisResult.livery?.primary?.trim();

      if (primaryColor && primaryColor.length >= 2) {
        evidence.push({
          type: EvidenceType.LIVERY_COLOR,
          value: primaryColor,
          confidence: 0.75, // Color detection has some subjectivity
          source: 'ai_visual_analysis',
          quality: this.assessColorQuality(primaryColor)
        });
      }
    }

    // Sort evidence by quality and confidence
    evidence.sort((a, b) => {
      const qualityA = (a.quality || 0) * a.confidence;
      const qualityB = (b.quality || 0) * b.confidence;
      return qualityB - qualityA;
    });

    return evidence;
  }

  /**
   * Assess the quality of race number evidence
   *
   * TODO_ML_INTEGRATION: This can be enhanced with:
   * - Historical OCR accuracy models
   * - Context-aware confidence adjustment
   * - Learned patterns from successful matches
   */
  private assessRaceNumberQuality(raceNumber: string, confidence?: number): number {
    let quality = 1.0;

    // Penalize very short or very long numbers
    const numStr = String(raceNumber);
    if (numStr.length < 1 || numStr.length > 4) {
      quality *= 0.5;
    }

    // Penalize numbers with non-numeric characters (unless part of common patterns)
    if (!/^[0-9]+$/.test(numStr)) {
      // Allow common patterns like "42A", "P1", etc.
      if (!/^[0-9]+[A-Z]?$|^[A-Z][0-9]+$/.test(numStr)) {
        quality *= 0.3;
      }
    }

    // Factor in OCR confidence
    if (confidence !== undefined) {
      quality *= confidence;
    }

    // Common problematic OCR patterns
    const problematicPatterns = ['0O', 'Il1', '6G', '8B'];
    for (const pattern of problematicPatterns) {
      if (numStr.includes(pattern)) {
        quality *= 0.7;
        break;
      }
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Assess the quality of person name evidence
   */
  private assessNameQuality(name: string): number {
    let quality = 1.0;

    const cleanName = name.trim();

    // Penalize very short names (likely not full names)
    if (cleanName.length < 3) {
      quality *= 0.3;
    }

    // Penalize names with numbers or special characters
    if (/[0-9]/.test(cleanName)) {
      quality *= 0.5;
    }

    if (/[^a-zA-Z\s\-'.]/.test(cleanName)) {
      quality *= 0.6;
    }

    // Bonus for names with typical structure (First Last, First M. Last, etc.)
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(cleanName) ||
        /^[A-Z]\.\s*[A-Z][a-z]+$/.test(cleanName)) {
      quality *= 1.2;
    }

    // Penalize all uppercase (likely OCR artifacts)
    if (cleanName === cleanName.toUpperCase() && cleanName.length > 4) {
      quality *= 0.8;
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Assess if text looks like a sponsor name
   */
  private looksLikeSponsor(text: string): boolean {
    const cleanText = text.trim().toLowerCase();

    // Too short to be meaningful sponsor
    if (cleanText.length < 3) {
      return false;
    }

    // Known sponsor patterns
    const sponsorIndicators = [
      'racing', 'motorsport', 'team', 'sport', 'group', 'performance',
      'technology', 'automotive', 'energy', 'oil', 'tire', 'tyre',
      'finance', 'bank', 'insurance', 'watch', 'luxury', 'fashion'
    ];

    // Check if it contains sponsor-like terms
    for (const indicator of sponsorIndicators) {
      if (cleanText.includes(indicator)) {
        return true;
      }
    }

    // Check if it looks like a brand name (capitalized words)
    const words = text.trim().split(/\s+/);
    const capitalizedWords = words.filter(word => /^[A-Z]/.test(word));

    // If most words are capitalized, it's likely a brand/sponsor
    return capitalizedWords.length >= Math.ceil(words.length * 0.7);
  }

  /**
   * Assess the quality of sponsor evidence
   */
  private assessSponsorQuality(sponsor: string): number {
    let quality = 1.0;

    const cleanSponsor = sponsor.trim();

    // Penalize very short sponsors
    if (cleanSponsor.length < 3) {
      quality *= 0.3;
    }

    // Bonus for known sponsor patterns
    if (this.looksLikeSponsor(cleanSponsor)) {
      quality *= 1.1;
    }

    // Penalize text with lots of numbers (likely not a sponsor)
    const numberRatio = (cleanSponsor.match(/[0-9]/g) || []).length / cleanSponsor.length;
    if (numberRatio > 0.3) {
      quality *= 0.5;
    }

    // Bonus for proper capitalization
    if (/^[A-Z]/.test(cleanSponsor)) {
      quality *= 1.1;
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Assess the quality of team evidence
   */
  private assessTeamQuality(team: string): number {
    let quality = 1.0;

    const cleanTeam = team.trim();

    // Penalize very short team names
    if (cleanTeam.length < 3) {
      quality *= 0.4;
    }

    // Bonus for team-like words
    const teamIndicators = ['team', 'racing', 'motorsport', 'squad', 'crew'];
    for (const indicator of teamIndicators) {
      if (cleanTeam.toLowerCase().includes(indicator)) {
        quality *= 1.2;
        break;
      }
    }

    // Penalize team names with lots of numbers
    const numberRatio = (cleanTeam.match(/[0-9]/g) || []).length / cleanTeam.length;
    if (numberRatio > 0.2) {
      quality *= 0.7;
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Assess the quality of plate number evidence
   *
   * Typical license plates have 5-8 characters with mix of letters and numbers
   */
  private assessPlateNumberQuality(plateNumber: string): number {
    let quality = 1.0;

    const clean = plateNumber.replace(/[\s-]/g, '');

    // Penalize very short or very long plates
    if (clean.length < 4 || clean.length > 10) {
      quality *= 0.5;
    }

    // High quality if mix of letters and numbers (typical plate pattern)
    const hasLetters = /[A-Z]/i.test(clean);
    const hasNumbers = /[0-9]/.test(clean);

    if (hasLetters && hasNumbers) {
      quality *= 1.0; // Ideal pattern
    } else if (hasLetters || hasNumbers) {
      quality *= 0.7; // Only letters or only numbers (less typical)
    } else {
      quality *= 0.3; // No alphanumeric (very suspicious)
    }

    // Penalize plates with too many special characters (OCR errors)
    const specialChars = clean.replace(/[A-Z0-9]/gi, '').length;
    if (specialChars > 0) {
      quality *= 0.6;
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Assess the quality of make/model evidence (Vehicle DNA)
   */
  private assessMakeModelQuality(value: string): number {
    let quality = 1.0;

    const clean = value.trim();

    // Penalize very short values (likely incomplete)
    if (clean.length < 3) {
      quality *= 0.5;
    }

    // Penalize values that look like garbage
    const GARBAGE_VALUES = ['unknown', 'n/a', 'na', 'none', '-', '?', 'other'];
    if (GARBAGE_VALUES.includes(clean.toLowerCase())) {
      return 0.1;
    }

    // Bonus for well-known manufacturers/models (high confidence from Gemini)
    const wellKnownMakes = [
      'ferrari', 'porsche', 'lamborghini', 'mclaren', 'mercedes', 'bmw', 'audi',
      'honda', 'yamaha', 'kawasaki', 'suzuki', 'ducati', 'ktm', 'husqvarna',
      'pinarello', 'trek', 'specialized', 'colnago', 'bianchi', 'cannondale',
      'cervelo', 'giant', 'bmc', 'canyon', 'scott', 'wilier', 'de rosa', 'factor',
      'toyota', 'ford', 'chevrolet', 'hyundai', 'citroen', 'skoda' // Rally
    ];
    if (wellKnownMakes.some(m => clean.toLowerCase().includes(m))) {
      quality *= 1.2;
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Assess the quality of color evidence (livery/jersey/gear)
   */
  private assessColorQuality(color: string): number {
    let quality = 1.0;

    const clean = color.trim().toLowerCase();

    // Penalize very short or vague colors
    if (clean.length < 3) {
      quality *= 0.4;
    }

    // Penalize garbage values
    const GARBAGE_COLORS = ['unknown', 'n/a', 'none', '-', '?', 'mixed', 'various', 'multi'];
    if (GARBAGE_COLORS.includes(clean)) {
      return 0.1;
    }

    // Well-defined colors get a bonus
    const wellDefinedColors = [
      'rosso', 'red', 'blu', 'blue', 'verde', 'green', 'giallo', 'yellow',
      'nero', 'black', 'bianco', 'white', 'arancione', 'orange', 'rosa', 'pink',
      'viola', 'purple', 'grigio', 'grey', 'gray', 'argento', 'silver',
      'oro', 'gold', 'azzurro', 'celeste', 'marrone', 'brown', 'cyan', 'teal'
    ];
    if (wellDefinedColors.includes(clean)) {
      quality *= 1.2;
    }

    return Math.max(0.1, Math.min(1.0, quality));
  }

  /**
   * Filter evidence based on quality thresholds
   *
   * TODO_ML_INTEGRATION: This can be enhanced with:
   * - Adaptive quality thresholds based on context
   * - Learned quality patterns from successful matches
   * - Dynamic filtering based on available evidence quantity
   */
  filterByQuality(evidence: Evidence[], minQuality: number = 0.3): Evidence[] {
    return evidence.filter(e => (e.quality || 0) >= minQuality);
  }

  /**
   * Group evidence by type for analysis
   */
  groupByType(evidence: Evidence[]): { [key in EvidenceType]?: Evidence[] } {
    const grouped: { [key in EvidenceType]?: Evidence[] } = {};

    for (const item of evidence) {
      if (!grouped[item.type]) {
        grouped[item.type] = [];
      }
      grouped[item.type]!.push(item);
    }

    return grouped;
  }

  /**
   * Get evidence summary for debugging
   */
  getSummary(evidence: Evidence[]): string {
    const grouped = this.groupByType(evidence);
    const summary: string[] = [];

    for (const [type, items] of Object.entries(grouped)) {
      if (items && items.length > 0) {
        const values = items.map(item =>
          `"${item.value}" (q:${(item.quality || 0).toFixed(2)}, c:${item.confidence.toFixed(2)})`
        );
        summary.push(`${type}: [${values.join(', ')}]`);
      }
    }

    return summary.join(' | ');
  }
}