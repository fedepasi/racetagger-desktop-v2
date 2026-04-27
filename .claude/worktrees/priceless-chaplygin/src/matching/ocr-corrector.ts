/**
 * OCRCorrector - Intelligent OCR error correction for race numbers
 *
 * This module implements OCR error correction using confusion matrices
 * and context-aware correction based on known participant data.
 * It handles common OCR misreads like 6↔8, 46↔48, 1↔I, 0↔O, etc.
 *
 * TODO_ML_INTEGRATION: This module is designed for enhancement with:
 * - Learned OCR patterns from historical data
 * - Context-aware correction models
 * - Confidence scoring for corrections
 */

import { Evidence, EvidenceType } from './evidence-collector';
import { Participant } from './smart-matcher';

export interface OCRCorrection {
  original: string;
  corrected: string;
  confidence: number;
  reason: string;
}

export interface ConfusionPattern {
  from: string;
  to: string[];
  confidence: number;
  context?: string; // Optional context for when this pattern applies
}

/**
 * OCRCorrector Class
 *
 * Handles intelligent correction of OCR errors in race numbers
 * using confusion matrices and participant context.
 */
export class OCRCorrector {
  private confusionMatrix: ConfusionPattern[];
  private lastCorrections: string[];

  constructor() {
    this.lastCorrections = [];
    this.confusionMatrix = this.buildConfusionMatrix();
  }

  /**
   * Apply OCR corrections to evidence based on available participants
   *
   * @param evidence - Array of evidence items to correct
   * @param participants - Available participants for context
   * @returns Corrected evidence array
   */
  async correctEvidence(evidence: Evidence[], participants: Participant[]): Promise<Evidence[]> {
    this.lastCorrections = [];
    const correctedEvidence: Evidence[] = [];

    // Get all known race numbers for context
    const knownNumbers = this.extractKnownNumbers(participants);

    for (const item of evidence) {
      if (item.type === EvidenceType.RACE_NUMBER) {
        const corrected = this.correctRaceNumber(item.value, knownNumbers);
        if (corrected.length > 0) {
          // Add both original and corrected versions
          correctedEvidence.push(item);
          for (const correction of corrected) {
            correctedEvidence.push({
              ...item,
              value: correction.corrected,
              confidence: item.confidence * correction.confidence,
              source: `${item.source}_corrected`
            });
            this.lastCorrections.push(
              `${correction.original} → ${correction.corrected} (${correction.reason})`
            );
          }
        } else {
          correctedEvidence.push(item);
        }
      } else {
        correctedEvidence.push(item);
      }
    }

    return correctedEvidence;
  }

  /**
   * Get corrections applied in the last correction operation
   */
  getLastCorrections(): string[] {
    return [...this.lastCorrections];
  }

  /**
   * Correct a race number using confusion matrix and context
   *
   * TODO_ML_INTEGRATION: This can be enhanced with:
   * - Neural OCR correction models
   * - Contextual correction based on image analysis
   * - Learned patterns from successful corrections
   */
  private correctRaceNumber(raceNumber: string, knownNumbers: string[]): OCRCorrection[] {
    const corrections: OCRCorrection[] = [];
    const original = String(raceNumber);

    // Generate potential corrections using confusion matrix
    const candidates = this.generateCandidates(original);

    // Filter candidates that exist in known numbers
    for (const candidate of candidates) {
      if (knownNumbers.includes(candidate.corrected)) {
        corrections.push({
          ...candidate,
          confidence: candidate.confidence * 0.9, // Slight penalty for being a correction
          reason: `OCR correction: ${candidate.reason} (found in participants)`
        });
      }
    }

    // If no direct matches, try partial matches for multi-digit errors
    if (corrections.length === 0 && original.length > 1) {
      const partialCorrections = this.tryPartialCorrections(original, knownNumbers);
      corrections.push(...partialCorrections);
    }

    return corrections;
  }

  /**
   * Generate correction candidates using confusion matrix
   */
  private generateCandidates(original: string): OCRCorrection[] {
    const candidates: OCRCorrection[] = [];

    // Single character substitutions
    for (let i = 0; i < original.length; i++) {
      const char = original[i];
      const patterns = this.confusionMatrix.filter(p => p.from === char);

      for (const pattern of patterns) {
        for (const replacement of pattern.to) {
          const corrected = original.substring(0, i) + replacement + original.substring(i + 1);
          candidates.push({
            original,
            corrected,
            confidence: pattern.confidence,
            reason: `${char} → ${replacement}`
          });
        }
      }
    }

    // Multi-character patterns (like "46" → "48")
    const multiCharPatterns = this.confusionMatrix.filter(p => p.from.length > 1);
    for (const pattern of multiCharPatterns) {
      if (original.includes(pattern.from)) {
        for (const replacement of pattern.to) {
          const corrected = original.replace(pattern.from, replacement);
          candidates.push({
            original,
            corrected,
            confidence: pattern.confidence,
            reason: `${pattern.from} → ${replacement}`
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Try partial corrections for complex cases
   */
  private tryPartialCorrections(original: string, knownNumbers: string[]): OCRCorrection[] {
    const corrections: OCRCorrection[] = [];

    // Try removing/adding single characters
    for (const known of knownNumbers) {
      if (Math.abs(original.length - known.length) === 1) {
        const similarity = this.calculateEditDistance(original, known);
        if (similarity === 1) {
          corrections.push({
            original,
            corrected: known,
            confidence: 0.7,
            reason: `Single character edit distance match`
          });
        }
      }
    }

    return corrections;
  }

  /**
   * Extract known race numbers from participants
   */
  private extractKnownNumbers(participants: Participant[]): string[] {
    const numbers = new Set<string>();

    for (const participant of participants) {
      const num = participant.numero || participant.number;
      if (num) {
        numbers.add(String(num));
      }
    }

    return Array.from(numbers);
  }

  /**
   * Build the OCR confusion matrix based on common misreads
   *
   * This matrix is based on research and empirical data about
   * common OCR errors in racing environments.
   *
   * TODO_ML_INTEGRATION: This matrix can be learned from:
   * - Historical correction data
   * - Font-specific error patterns
   * - Environmental condition impacts
   */
  private buildConfusionMatrix(): ConfusionPattern[] {
    return [
      // Single digit confusions
      { from: '0', to: ['O', 'D', 'Q'], confidence: 0.8 },
      { from: 'O', to: ['0', 'D', 'Q'], confidence: 0.8 },
      { from: '1', to: ['I', 'l', '|'], confidence: 0.9 },
      { from: 'I', to: ['1', 'l', '|'], confidence: 0.9 },
      { from: '2', to: ['Z', 'S'], confidence: 0.7 },
      { from: 'Z', to: ['2', '7'], confidence: 0.7 },
      { from: '3', to: ['8', 'B'], confidence: 0.6 },
      { from: '4', to: ['A', 'H'], confidence: 0.6 },
      { from: '5', to: ['S', '6'], confidence: 0.8 },
      { from: 'S', to: ['5', '8'], confidence: 0.8 },
      { from: '6', to: ['G', '8', '5'], confidence: 0.9 },
      { from: 'G', to: ['6', 'C'], confidence: 0.8 },
      { from: '7', to: ['T', '1'], confidence: 0.7 },
      { from: 'T', to: ['7', '1'], confidence: 0.7 },
      { from: '8', to: ['B', '6', '3'], confidence: 0.9 },
      { from: 'B', to: ['8', '3'], confidence: 0.8 },
      { from: '9', to: ['g', 'q'], confidence: 0.7 },

      // Two-digit confusions (very common in racing)
      { from: '46', to: ['48', '16', '86'], confidence: 0.95 },
      { from: '48', to: ['46', '18', '88'], confidence: 0.95 },
      { from: '68', to: ['66', '88', '86'], confidence: 0.9 },
      { from: '86', to: ['88', '66', '86'], confidence: 0.9 },
      { from: '16', to: ['18', '10', '46'], confidence: 0.8 },
      { from: '18', to: ['16', '10', '48'], confidence: 0.8 },
      { from: '36', to: ['38', '86', '56'], confidence: 0.8 },
      { from: '38', to: ['36', '88', '58'], confidence: 0.8 },
      { from: '56', to: ['58', '36', '96'], confidence: 0.8 },
      { from: '58', to: ['56', '38', '98'], confidence: 0.8 },

      // Three-digit patterns
      { from: '168', to: ['186', '148', '108'], confidence: 0.85 },
      { from: '186', to: ['168', '188', '106'], confidence: 0.85 },

      // Letter-number confusions in alphanumeric codes
      { from: 'A1', to: ['Al', 'A|'], confidence: 0.7 },
      { from: 'P1', to: ['Pl', 'P|'], confidence: 0.7 },
      { from: 'H1', to: ['Hl', 'H|'], confidence: 0.7 },

      // Reversed digits
      { from: '12', to: ['21'], confidence: 0.6 },
      { from: '21', to: ['12'], confidence: 0.6 },
      { from: '13', to: ['31'], confidence: 0.6 },
      { from: '31', to: ['13'], confidence: 0.6 },
      { from: '14', to: ['41'], confidence: 0.6 },
      { from: '41', to: ['14'], confidence: 0.6 },
      { from: '15', to: ['51'], confidence: 0.6 },
      { from: '51', to: ['15'], confidence: 0.6 },
      { from: '16', to: ['61'], confidence: 0.6 },
      { from: '61', to: ['16'], confidence: 0.6 },
      { from: '17', to: ['71'], confidence: 0.6 },
      { from: '71', to: ['17'], confidence: 0.6 },
      { from: '19', to: ['91'], confidence: 0.6 },
      { from: '91', to: ['19'], confidence: 0.6 },
      { from: '23', to: ['32'], confidence: 0.6 },
      { from: '32', to: ['23'], confidence: 0.6 },
      { from: '24', to: ['42'], confidence: 0.6 },
      { from: '42', to: ['24'], confidence: 0.6 },
      { from: '25', to: ['52'], confidence: 0.6 },
      { from: '52', to: ['25'], confidence: 0.6 },
      { from: '26', to: ['62'], confidence: 0.6 },
      { from: '62', to: ['26'], confidence: 0.6 },
      { from: '27', to: ['72'], confidence: 0.6 },
      { from: '72', to: ['27'], confidence: 0.6 },
      { from: '28', to: ['82'], confidence: 0.6 },
      { from: '82', to: ['28'], confidence: 0.6 },
      { from: '29', to: ['92'], confidence: 0.6 },
      { from: '92', to: ['29'], confidence: 0.6 },
      { from: '34', to: ['43'], confidence: 0.6 },
      { from: '43', to: ['34'], confidence: 0.6 },
      { from: '35', to: ['53'], confidence: 0.6 },
      { from: '53', to: ['35'], confidence: 0.6 },
      { from: '37', to: ['73'], confidence: 0.6 },
      { from: '73', to: ['37'], confidence: 0.6 },
      { from: '39', to: ['93'], confidence: 0.6 },
      { from: '93', to: ['39'], confidence: 0.6 },
      { from: '45', to: ['54'], confidence: 0.6 },
      { from: '54', to: ['45'], confidence: 0.6 },
      { from: '47', to: ['74'], confidence: 0.6 },
      { from: '74', to: ['47'], confidence: 0.6 },
      { from: '49', to: ['94'], confidence: 0.6 },
      { from: '94', to: ['49'], confidence: 0.6 },
      { from: '57', to: ['75'], confidence: 0.6 },
      { from: '75', to: ['57'], confidence: 0.6 },
      { from: '59', to: ['95'], confidence: 0.6 },
      { from: '95', to: ['59'], confidence: 0.6 },
      { from: '67', to: ['76'], confidence: 0.6 },
      { from: '76', to: ['67'], confidence: 0.6 },
      { from: '69', to: ['96'], confidence: 0.6 },
      { from: '96', to: ['69'], confidence: 0.6 },
      { from: '78', to: ['87'], confidence: 0.6 },
      { from: '87', to: ['78'], confidence: 0.6 },
      { from: '79', to: ['97'], confidence: 0.6 },
      { from: '97', to: ['79'], confidence: 0.6 },
      { from: '89', to: ['98'], confidence: 0.6 },
      { from: '98', to: ['89'], confidence: 0.6 }
    ];
  }

  /**
   * Calculate edit distance between two strings
   */
  private calculateEditDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Add a new confusion pattern (for learning new patterns)
   *
   * TODO_ML_INTEGRATION: This can be used to:
   * - Learn new patterns from correction feedback
   * - Adapt to specific font or environment patterns
   * - Build sport-specific confusion matrices
   */
  addConfusionPattern(pattern: ConfusionPattern): void {
    this.confusionMatrix.push(pattern);
  }

  /**
   * Get confusion matrix for analysis
   */
  getConfusionMatrix(): ConfusionPattern[] {
    return [...this.confusionMatrix];
  }
}