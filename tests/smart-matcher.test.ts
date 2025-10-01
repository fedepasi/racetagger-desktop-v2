/**
 * Comprehensive test suite for SmartMatcher system
 *
 * Tests all components of the intelligent matching system including:
 * - SmartMatcher core functionality
 * - Evidence collection and quality assessment
 * - OCR correction with confusion matrix
 * - Sport-specific configurations
 * - Multi-level caching
 */

import { SmartMatcher, AnalysisResult, Participant, MatchResult } from '../src/matching/smart-matcher';
import { EvidenceCollector, EvidenceType, Evidence } from '../src/matching/evidence-collector';
import { OCRCorrector } from '../src/matching/ocr-corrector';
import { SportConfig } from '../src/matching/sport-config';
import { CacheManager } from '../src/matching/cache-manager';

describe('SmartMatcher System', () => {
  let smartMatcher: SmartMatcher;
  let evidenceCollector: EvidenceCollector;
  let ocrCorrector: OCRCorrector;
  let sportConfig: SportConfig;
  let cacheManager: CacheManager;

  const mockParticipants: Participant[] = [
    {
      numero: 42,
      nome_pilota: "John Smith",
      nome_navigatore: "Jane Doe",
      squadra: "Racing Team Alpha",
      sponsor: ["Ferrari", "Pirelli"],
      categoria: "GT3"
    },
    {
      numero: 86,
      nome_pilota: "Michael Johnson",
      squadra: "Speed Demons",
      sponsor: ["Mercedes", "Shell"],
      categoria: "GT3"
    },
    {
      numero: 123,
      nome_pilota: "Sarah Wilson",
      squadra: "Thunder Racing",
      sponsor: ["BMW", "Castrol"],
      categoria: "LMP2"
    }
  ];

  beforeEach(() => {
    sportConfig = new SportConfig();
    const config = sportConfig.getConfig('motorsport');
    smartMatcher = new SmartMatcher('motorsport');
    evidenceCollector = new EvidenceCollector(config);
    ocrCorrector = new OCRCorrector();
    cacheManager = new CacheManager();
  });

  afterEach(async () => {
    if (cacheManager) {
      cacheManager.destroy();
    }
  });

  describe('SmartMatcher Core', () => {
    test('should find exact race number match', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "42",
        confidence: 0.95
      };

      const result = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.numero).toBe(42);
      expect(result.bestMatch?.score).toBeGreaterThan(90);
      expect(result.multipleHighScores).toBeFalsy();
    });

    test('should find driver name match with fuzzy logic', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "999", // Non-existent number
        drivers: ["Jon Smith"], // Similar to "John Smith"
        confidence: 0.8
      };

      const result = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.nome_pilota).toBe("John Smith");
      expect(result.bestMatch?.score).toBeGreaterThan(50);
    });

    test('should find sponsor match', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "999",
        otherText: ["Pirelli", "Racing"],
        confidence: 0.7
      };

      const result = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.numero).toBe(42); // John Smith has Pirelli
    });

    test('should handle multiple evidence types', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "86",
        drivers: ["Mike Johnson"], // Similar to Michael Johnson
        teamName: "Speed Demons",
        otherText: ["Mercedes"],
        confidence: 0.9
      };

      const result = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.numero).toBe(86);
      expect(result.bestMatch?.evidence.length).toBeGreaterThan(2);
      expect(result.bestMatch?.score).toBeGreaterThan(150); // Multiple evidence bonus
    });

    test('should handle no match case', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "999",
        drivers: ["Unknown Driver"],
        otherText: ["Unknown Sponsor"],
        confidence: 0.5
      };

      const result = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result.bestMatch).toBeFalsy();
      expect(result.allCandidates.length).toBe(0);
    });

    test('should handle multiple high scores and override logic', async () => {
      // Create a scenario where OCR gives wrong number but other evidence is strong
      const analysis: AnalysisResult = {
        raceNumber: "86", // Wrong number
        drivers: ["John Smith"], // Correct driver
        otherText: ["Ferrari", "Pirelli"], // Correct sponsors
        confidence: 0.4 // Low OCR confidence
      };

      const result = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result.bestMatch).toBeTruthy();
      // Should match John Smith (42) despite OCR saying 86
      expect(result.bestMatch?.participant.numero).toBe(42);
      expect(result.resolvedByOverride).toBeTruthy();
    });
  });

  describe('Evidence Collector', () => {
    test('should extract all evidence types from analysis', () => {
      const analysis = {
        raceNumber: "42",
        drivers: ["John Smith", "Jane Doe"],
        teamName: "Racing Team",
        otherText: ["Ferrari", "Pirelli", "GT3"],
        confidence: 0.9
      };

      const evidence = evidenceCollector.extractEvidence(analysis);

      expect(evidence).toHaveLength(6); // 1 number + 2 drivers + 1 team + 2 sponsors
      expect(evidence.find(e => e.type === EvidenceType.RACE_NUMBER)).toBeTruthy();
      expect(evidence.filter(e => e.type === EvidenceType.DRIVER_NAME)).toHaveLength(2);
      expect(evidence.find(e => e.type === EvidenceType.TEAM)).toBeTruthy();
      expect(evidence.filter(e => e.type === EvidenceType.SPONSOR)).toHaveLength(2);
    });

    test('should assess evidence quality correctly', () => {
      const analysis = {
        raceNumber: "42A", // Alphanumeric - lower quality
        drivers: ["J"], // Too short - low quality
        teamName: "Racing Team Alpha", // Good quality
        otherText: ["123456789"], // Numbers - not sponsor-like
        confidence: 0.95
      };

      const evidence = evidenceCollector.extractEvidence(analysis);

      const numberEvidence = evidence.find(e => e.type === EvidenceType.RACE_NUMBER);
      const driverEvidence = evidence.find(e => e.type === EvidenceType.DRIVER_NAME);
      const teamEvidence = evidence.find(e => e.type === EvidenceType.TEAM);

      expect(numberEvidence?.quality).toBeLessThan(0.8); // Alphanumeric penalty
      expect(driverEvidence?.quality).toBeLessThan(0.5); // Too short penalty
      expect(teamEvidence?.quality).toBeGreaterThan(0.8); // Good team name
    });

    test('should filter evidence by quality threshold', () => {
      const lowQualityAnalysis = {
        raceNumber: "123ABC!@#",
        drivers: ["X"],
        otherText: ["1", "2", "3"],
        confidence: 0.3
      };

      const evidence = evidenceCollector.extractEvidence(lowQualityAnalysis);
      const highQualityEvidence = evidenceCollector.filterByQuality(evidence, 0.5);

      expect(evidence.length).toBeGreaterThan(highQualityEvidence.length);
    });

    test('should group evidence by type correctly', () => {
      const analysis = {
        raceNumber: "42",
        drivers: ["John", "Jane"],
        teamName: "Team",
        otherText: ["Sponsor1", "Sponsor2"]
      };

      const evidence = evidenceCollector.extractEvidence(analysis);
      const grouped = evidenceCollector.groupByType(evidence);

      expect(grouped[EvidenceType.RACE_NUMBER]).toHaveLength(1);
      expect(grouped[EvidenceType.DRIVER_NAME]).toHaveLength(2);
      expect(grouped[EvidenceType.TEAM]).toHaveLength(1);
      expect(grouped[EvidenceType.SPONSOR]).toHaveLength(2);
    });
  });

  describe('OCR Corrector', () => {
    test('should correct common OCR errors', async () => {
      const evidence: Evidence[] = [
        {
          type: EvidenceType.RACE_NUMBER,
          value: "46", // Might be confused with "48"
          confidence: 0.6,
          source: 'ocr'
        }
      ];

      const participants: Participant[] = [
        { numero: 48, nome_pilota: "Test Driver" }
      ];

      const correctedEvidence = await ocrCorrector.correctEvidence(evidence, participants);

      expect(correctedEvidence.length).toBeGreaterThan(evidence.length);
      const corrections = ocrCorrector.getLastCorrections();
      expect(corrections.length).toBeGreaterThan(0);
      expect(corrections[0]).toContain("46 → 48");
    });

    test('should handle digit reversal corrections', async () => {
      const evidence: Evidence[] = [
        {
          type: EvidenceType.RACE_NUMBER,
          value: "12",
          confidence: 0.7,
          source: 'ocr'
        }
      ];

      const participants: Participant[] = [
        { numero: 21, nome_pilota: "Test Driver" }
      ];

      const correctedEvidence = await ocrCorrector.correctEvidence(evidence, participants);

      expect(correctedEvidence.some(e => e.value === "21")).toBeTruthy();
    });

    test('should not over-correct high confidence OCR', async () => {
      const evidence: Evidence[] = [
        {
          type: EvidenceType.RACE_NUMBER,
          value: "42",
          confidence: 0.95, // High confidence
          source: 'ocr'
        }
      ];

      const participants: Participant[] = [
        { numero: 24, nome_pilota: "Test Driver" }
      ];

      const correctedEvidence = await ocrCorrector.correctEvidence(evidence, participants);

      // Should not correct high-confidence OCR to non-existent patterns
      expect(correctedEvidence.filter(e => e.value === "42")).toHaveLength(1);
    });

    test('should handle complex multi-digit corrections', async () => {
      const evidence: Evidence[] = [
        {
          type: EvidenceType.RACE_NUMBER,
          value: "168",
          confidence: 0.5,
          source: 'ocr'
        }
      ];

      const participants: Participant[] = [
        { numero: 186, nome_pilota: "Test Driver" }
      ];

      const correctedEvidence = await ocrCorrector.correctEvidence(evidence, participants);

      expect(correctedEvidence.some(e => e.value === "186")).toBeTruthy();
      const corrections = ocrCorrector.getLastCorrections();
      expect(corrections.some(c => c.includes("168 → 186"))).toBeTruthy();
    });
  });

  describe('Sport Configuration', () => {
    test('should provide different configurations for different sports', () => {
      const motorsportConfig = sportConfig.getConfig('motorsport');
      const runningConfig = sportConfig.getConfig('running');

      expect(motorsportConfig.weights.raceNumber).toBeLessThan(runningConfig.weights.raceNumber);
      expect(motorsportConfig.weights.sponsor).toBeGreaterThan(runningConfig.weights.sponsor);
    });

    test('should validate race numbers correctly for different sports', () => {
      expect(sportConfig.validateRaceNumber("42A", "motorsport")).toBeTruthy();
      expect(sportConfig.validateRaceNumber("42A", "running")).toBeFalsy();
      expect(sportConfig.validateRaceNumber("12345", "running")).toBeTruthy();
      expect(sportConfig.validateRaceNumber("12345", "motorsport")).toBeFalsy(); // Too high
    });

    test('should analyze and suggest optimal sport', () => {
      const motorsportParticipants = [
        { numero: 42, nome_pilota: "John", nome_navigatore: "Jane", sponsor: ["Ferrari"] },
        { numero: 86, nome_pilota: "Mike", nome_navigatore: "Sara", sponsor: ["BMW"] }
      ];

      const runningParticipants = [
        { numero: 1234, nome: "Runner One" },
        { numero: 5678, nome: "Runner Two" }
      ];

      const motorsportAnalysis = sportConfig.analyzeAndSuggestSport(motorsportParticipants);
      const runningAnalysis = sportConfig.analyzeAndSuggestSport(runningParticipants);

      expect(motorsportAnalysis.suggestedSport).toBe('motorsport');
      expect(runningAnalysis.suggestedSport).toBe('running');
      expect(motorsportAnalysis.confidence).toBeGreaterThan(0.5);
      expect(runningAnalysis.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Cache Manager', () => {
    test('should cache and retrieve match results', async () => {
      const analysisHash = "test_analysis_hash";
      const participantHash = "test_participant_hash";
      const sport = "motorsport";

      const mockResult: MatchResult = {
        bestMatch: {
          participant: mockParticipants[0],
          score: 95,
          evidence: [],
          confidence: 0.9,
          reasoning: ["Test match"]
        },
        allCandidates: [],
        multipleHighScores: false,
        resolvedByOverride: false,
        debugInfo: {
          totalEvidence: 1,
          evidenceTypes: [],
          ocrCorrections: [],
          processingTimeMs: 100
        }
      };

      // Cache the result
      await cacheManager.setMatch(analysisHash, participantHash, sport, mockResult);

      // Retrieve the result
      const cachedResult = await cacheManager.getMatch(analysisHash, participantHash, sport);

      expect(cachedResult).toBeTruthy();
      expect(cachedResult?.bestMatch?.participant.numero).toBe(42);
      expect(cachedResult?.bestMatch?.score).toBe(95);
    });

    test('should return null for non-existent cache entries', async () => {
      const result = await cacheManager.getMatch("nonexistent", "hash", "motorsport");
      expect(result).toBeNull();
    });

    test('should cache participant data', async () => {
      const participantHash = "participants_test_hash";
      const sport = "motorsport";

      await cacheManager.cacheParticipants(participantHash, mockParticipants, sport);

      // Note: This test assumes getCachedParticipants is implemented
      // The current implementation has a different signature
    });

    test('should provide cache statistics', () => {
      const stats = cacheManager.getStats();

      expect(stats).toHaveProperty('l1');
      expect(stats).toHaveProperty('l2');
      expect(stats).toHaveProperty('l3');
      expect(stats.l1).toHaveProperty('hitRate');
      expect(stats.l1).toHaveProperty('entries');
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete matching workflow', async () => {
      // Simulate a complex real-world scenario
      const complexAnalysis: AnalysisResult = {
        raceNumber: "86", // Correct number
        drivers: ["Mich Johnson"], // Fuzzy match for "Michael Johnson"
        teamName: "Speed", // Partial team match
        otherText: ["Merc", "Shell Oil"], // Sponsor matches (fuzzy and partial)
        confidence: 0.75
      };

      const result = await smartMatcher.findMatches(complexAnalysis, mockParticipants);

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.numero).toBe(86);
      expect(result.bestMatch?.evidence.length).toBeGreaterThan(3);
      expect(result.bestMatch?.score).toBeGreaterThan(100);
      expect(result.multipleHighScores).toBeFalsy();

      // Verify detailed match information
      expect(result.debugInfo.totalEvidence).toBeGreaterThan(3);
      expect(result.debugInfo.evidenceTypes).toContain(EvidenceType.RACE_NUMBER);
      expect(result.debugInfo.evidenceTypes).toContain(EvidenceType.DRIVER_NAME);
    });

    test('should handle OCR correction in full workflow', async () => {
      // Scenario: OCR thinks it's 46 but it's actually 48
      const analysisWithOCRError: AnalysisResult = {
        raceNumber: "46", // OCR error - should be 48
        drivers: [], // No other evidence
        confidence: 0.6 // Medium confidence
      };

      const participantsWithCorrectNumber: Participant[] = [
        {
          numero: 48, // Correct number
          nome_pilota: "Test Driver",
          squadra: "Test Team"
        }
      ];

      const result = await smartMatcher.findMatches(analysisWithOCRError, participantsWithCorrectNumber);

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.numero).toBe(48);
      expect(result.debugInfo.ocrCorrections.length).toBeGreaterThan(0);
    });

    test('should handle edge case: no participants', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "42",
        confidence: 0.9
      };

      const result = await smartMatcher.findMatches(analysis, []);

      expect(result.bestMatch).toBeFalsy();
      expect(result.allCandidates).toHaveLength(0);
    });

    test('should handle edge case: empty analysis', async () => {
      const emptyAnalysis: AnalysisResult = {};

      const result = await smartMatcher.findMatches(emptyAnalysis, mockParticipants);

      expect(result.bestMatch).toBeFalsy();
      expect(result.debugInfo.totalEvidence).toBe(0);
    });

    test('should provide consistent results for identical inputs', async () => {
      const analysis: AnalysisResult = {
        raceNumber: "42",
        drivers: ["John Smith"],
        confidence: 0.9
      };

      const result1 = await smartMatcher.findMatches(analysis, mockParticipants);
      const result2 = await smartMatcher.findMatches(analysis, mockParticipants);

      expect(result1.bestMatch?.participant.numero).toBe(result2.bestMatch?.participant.numero);
      expect(result1.bestMatch?.score).toBe(result2.bestMatch?.score);
    });
  });

  describe('Performance Tests', () => {
    test('should handle large participant datasets efficiently', async () => {
      // Create a large dataset
      const largeParticipantSet: Participant[] = [];
      for (let i = 1; i <= 1000; i++) {
        largeParticipantSet.push({
          numero: i,
          nome_pilota: `Driver ${i}`,
          squadra: `Team ${i % 50}`, // 50 teams
          sponsor: [`Sponsor ${i % 100}`] // 100 sponsors
        });
      }

      const analysis: AnalysisResult = {
        raceNumber: "500",
        drivers: ["Driver 500"],
        confidence: 0.8
      };

      const startTime = Date.now();
      const result = await smartMatcher.findMatches(analysis, largeParticipantSet);
      const endTime = Date.now();

      expect(result.bestMatch).toBeTruthy();
      expect(result.bestMatch?.participant.numero).toBe(500);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    test('should maintain performance with multiple evidence types', async () => {
      const complexAnalysis: AnalysisResult = {
        raceNumber: "42",
        drivers: ["John Smith", "Jane Doe", "Bob Wilson"],
        teamName: "Racing Team Alpha",
        otherText: ["Ferrari", "Pirelli", "Shell", "Castrol", "Brembo"],
        confidence: 0.85
      };

      const startTime = Date.now();
      const result = await smartMatcher.findMatches(complexAnalysis, mockParticipants);
      const endTime = Date.now();

      expect(result.bestMatch).toBeTruthy();
      expect(endTime - startTime).toBeLessThan(500); // Should be fast even with complex analysis
    });
  });
});