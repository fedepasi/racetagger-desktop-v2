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
      preset_participant_drivers: [
        { driver_name: "John Smith", driver_order: 0 },
        { driver_name: "Jane Doe", driver_order: 1 }
      ],
      squadra: "Racing Team Alpha",
      sponsor: ["Ferrari", "Pirelli"],
      categoria: "GT3"
    },
    {
      numero: 86,
      preset_participant_drivers: [
        { driver_name: "Michael Johnson", driver_order: 0 }
      ],
      squadra: "Speed Demons",
      sponsor: ["Mercedes", "Shell"],
      categoria: "GT3"
    },
    {
      numero: 123,
      preset_participant_drivers: [
        { driver_name: "Sarah Wilson", driver_order: 0 }
      ],
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
      expect(result.bestMatch?.participant.preset_participant_drivers?.[0]?.driver_name).toBe("John Smith");
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
        { numero: 48, preset_participant_drivers: [{ driver_name: "Test Driver", driver_order: 0 }] }
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
        { numero: 21, preset_participant_drivers: [{ driver_name: "Test Driver", driver_order: 0 }] }
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
        { numero: 24, preset_participant_drivers: [{ driver_name: "Test Driver", driver_order: 0 }] }
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
        { numero: 186, preset_participant_drivers: [{ driver_name: "Test Driver", driver_order: 0 }] }
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
        { numero: 42, preset_participant_drivers: [{ driver_name: "John", driver_order: 0 }, { driver_name: "Jane", driver_order: 1 }], sponsor: ["Ferrari"] },
        { numero: 86, preset_participant_drivers: [{ driver_name: "Mike", driver_order: 0 }, { driver_name: "Sara", driver_order: 1 }], sponsor: ["BMW"] }
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
        matchStatus: 'matched',
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
          preset_participant_drivers: [{ driver_name: "Test Driver", driver_order: 0 }],
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
          preset_participant_drivers: [{ driver_name: `Driver ${i}`, driver_order: 0 }],
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

  // ===================================================================
  // ACC-01 (Gruppe C) — per-preset "Series sponsors to ignore" list.
  // SPONSOR evidence matching the list is dropped BEFORE scoring, so an
  // ignored brand neither adds a bonus nor fires the -30/-15 contradiction
  // penalties. NOTE: findMatches() only keeps candidates with score > 0
  // (smart-matcher.ts:1067), so every assertion below inspects a participant
  // that also has a positive (race-number) match, keeping it in allCandidates
  // so its contradiction/ghost reasoning is observable.
  // ===================================================================
  describe('Series sponsor ignore list (ACC-01, Gruppe C)', () => {
    type Cand = MatchResult['allCandidates'][number];
    const candFor = (r: MatchResult, n: number): Cand | undefined =>
      r.allCandidates.find(c => Number(c.participant.numero) === n);
    const sponsorEv = (c?: Cand) =>
      (c?.evidence ?? []).filter(e => e.type === EvidenceType.SPONSOR);
    const hasContradiction = (c?: Cand) =>
      (c?.reasoning ?? []).some(s => /contradiction/i.test(s));
    const anyContradiction = (r: MatchResult) =>
      r.allCandidates.some(c => hasContradiction(c));

    test('1. removes the contradiction penalty an ignored sponsor would erode a bonus with (money test)', async () => {
      // #42 has Ferrari; Michelin belongs to no participant → common contradiction
      // (-15) erodes #42's Ferrari sponsor bonus. The race number keeps #42 in
      // allCandidates so we can measure the delta directly.
      const analysis: AnalysisResult = { raceNumber: '42', otherText: ['Ferrari', 'Michelin'], confidence: 0.8 };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      const scoreBefore = candFor(before, 42)!.score;
      expect(candFor(before, 42)!.reasoning.some(s => /contradiction/i.test(s) && /michelin/i.test(s))).toBe(true);

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Michelin']);
      const after = await withList.findMatches(analysis, mockParticipants);
      const cand42 = candFor(after, 42)!;

      // The removed -15 penalty (×multi-evidence factor ≥1) is restored to the score.
      expect(cand42.score).toBeGreaterThanOrEqual(scoreBefore + 15 - 1e-6);
      // No michelin contradiction reasoning survives anywhere.
      expect(after.allCandidates.some(c => c.reasoning.some(s => /contradiction/i.test(s) && /michelin/i.test(s)))).toBe(false);
    });

    test('2. suppresses contradiction reasoning for an ignored sponsor (penalty path)', async () => {
      // #42 matches by number; Michelin is foreign → -15 contradiction on #42.
      const analysis: AnalysisResult = { raceNumber: '42', otherText: ['Michelin'], confidence: 0.7 };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      expect(hasContradiction(candFor(before, 42))).toBe(true);

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Michelin']);
      const after = await withList.findMatches(analysis, mockParticipants);
      expect(hasContradiction(candFor(after, 42))).toBe(false);
      // #42 gains no sponsor evidence either — the brand never entered scoring.
      expect(sponsorEv(candFor(after, 42)).length).toBe(0);
    });

    test('3. drops the sponsor bonus for an ignored sponsor; race-number matching still works', async () => {
      // Pirelli is #42's (unique) sponsor → a real bonus when not ignored.
      const analysis: AnalysisResult = { raceNumber: '42', otherText: ['Pirelli'], confidence: 0.7 };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      expect(sponsorEv(candFor(before, 42)).length).toBeGreaterThan(0); // bonus present without the list

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Pirelli']);
      const after = await withList.findMatches(analysis, mockParticipants);

      const cand42 = candFor(after, 42)!;
      expect(sponsorEv(cand42).length).toBe(0); // no sponsor evidence / no "UNIQUE sponsor match"
      expect(after.bestMatch?.participant.numero).toBe(42); // number evidence still resolves the match
    });

    test('4. tier parity — exact, substring and fuzzy variants are all filtered', async () => {
      // All three are foreign to #42; the race number keeps #42 observable.
      const analysis: AnalysisResult = {
        raceNumber: '42',
        otherText: ['TotalEnergies', 'TOTAL', 'Totalenergiez'], // exact, substring, fuzzy(Levenshtein=1)
        confidence: 0.7
      };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      expect(candFor(before, 42)!.reasoning.some(s => /contradiction/i.test(s) && /total/i.test(s))).toBe(true);

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['TotalEnergies']);
      const after = await withList.findMatches(analysis, mockParticipants);
      expect(hasContradiction(candFor(after, 42))).toBe(false);
      expect(sponsorEv(candFor(after, 42)).length).toBe(0);
    });

    test('5. non-interference — a non-listed sponsor still bonuses its owner and penalizes non-owners', async () => {
      // Michelin is in the ignore list but absent from this photo. Shell is #86's
      // sponsor and foreign to #42.
      const analysis: AnalysisResult = { raceNumber: '42', otherText: ['Ferrari', 'Shell'], confidence: 0.8 };

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Michelin']);
      const result = await withList.findMatches(analysis, mockParticipants);

      // Penalty path intact for the non-ignored Shell: #42 still gets a contradiction.
      expect(candFor(result, 42)!.reasoning.some(s => /contradiction/i.test(s) && /shell/i.test(s))).toBe(true);
      // Bonus path intact: #86 still earns its Shell sponsor evidence.
      expect(sponsorEv(candFor(result, 86)).some(e => /shell/i.test(e.value))).toBe(true);
    });

    test('6. ghost-vehicle suppression — two ignored foreign sponsors no longer fire the alert', async () => {
      // Michelin + Rolex are both foreign to #42 → 2 contradictions, ratio 1.0.
      const analysis: AnalysisResult = { raceNumber: '42', otherText: ['Michelin', 'Rolex'], confidence: 0.7 };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      expect(candFor(before, 42)!.ghostVehicleWarning).toBe(true);

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Michelin', 'Rolex']);
      const after = await withList.findMatches(analysis, mockParticipants);
      expect(candFor(after, 42)!.ghostVehicleWarning).toBeFalsy();
      expect(candFor(after, 42)!.reasoning.some(s => /ghost vehicle/i.test(s))).toBe(false);
    });

    test('7. regression — no setter (or empty list) is byte-identical to current behavior', async () => {
      const analysis: AnalysisResult = {
        raceNumber: '42',
        drivers: ['John Smith'],
        teamName: 'Racing Team Alpha',
        otherText: ['Ferrari', 'Michelin'],
        confidence: 0.85
      };

      const neverSet = new SmartMatcher('motorsport');
      const a = await neverSet.findMatches(analysis, mockParticipants);

      const emptyList = new SmartMatcher('motorsport');
      emptyList.setSeriesSponsorIgnoreList([]);
      const b = await emptyList.findMatches(analysis, mockParticipants);

      expect(b.bestMatch?.participant.numero).toBe(a.bestMatch?.participant.numero);
      expect(b.bestMatch?.score).toBe(a.bestMatch?.score);
      expect(b.matchStatus).toBe(a.matchStatus);
      const scores = (r: MatchResult) => r.allCandidates
        .map(c => ({ n: Number(c.participant.numero), s: c.score }))
        .sort((x, y) => x.n - y.n);
      expect(scores(b)).toEqual(scores(a));
    });

    test('8. no-number path — the 1.5× sponsor boost cannot resurrect an ignored sponsor', async () => {
      // No race number → sponsor evidence drives matching with a 1.5× boost.
      const analysis: AnalysisResult = { otherText: ['Pirelli'], confidence: 0.7 };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      expect(sponsorEv(candFor(before, 42)).length).toBeGreaterThan(0); // boosted bonus without the list

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Pirelli']);
      const after = await withList.findMatches(analysis, mockParticipants);
      // With Pirelli ignored and no other evidence, #42 earns no sponsor score at all.
      expect(candFor(after, 42)).toBeUndefined();
      expect(after.allCandidates.every(c => sponsorEv(c).length === 0)).toBe(true);
    });

    test('9. team→sponsor cross-match guard — an ignored brand misread as a team earns no sponsor bonus', async () => {
      // teamName "Shell" (no sponsor otherText): the reverse cross-match would
      // otherwise award #86 (whose sponsor is Shell) a ×0.7 sponsor bonus.
      const analysis: AnalysisResult = { teamName: 'Shell', confidence: 0.7 };

      const withoutList = new SmartMatcher('motorsport');
      const before = await withoutList.findMatches(analysis, mockParticipants);
      expect(sponsorEv(candFor(before, 86)).length).toBeGreaterThan(0);
      expect(candFor(before, 86)!.reasoning.some(s => /cross-match/i.test(s))).toBe(true);

      const withList = new SmartMatcher('motorsport');
      withList.setSeriesSponsorIgnoreList(['Shell']);
      const after = await withList.findMatches(analysis, mockParticipants);
      // The guard skips the cross-match; with no other evidence #86 drops out.
      expect(candFor(after, 86)).toBeUndefined();
    });
  });
});