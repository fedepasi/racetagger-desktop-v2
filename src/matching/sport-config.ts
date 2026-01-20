/**
 * SportConfig - Sport-specific matching configurations
 *
 * This module provides adaptive configuration for different sports,
 * allowing the matching system to optimize for sport-specific patterns
 * and requirements.
 *
 * TODO_ML_INTEGRATION: This module is designed for enhancement with:
 * - Sport-specific ML model parameters
 * - Learned optimal weights from historical data
 * - Dynamic configuration based on performance metrics
 */

export interface MatchingConfig {
  weights: {
    raceNumber: number;
    personName: number;
    /** @deprecated Use personName instead */
    driverName?: number;
    sponsor: number;
    team: number;
    category: number;       // weight for category matches (GT3, F1, etc.)
    plateNumber: number;    // weight for license plate matches
  };
  thresholds: {
    minimumScore: number;        // Minimum score to accept a match
    clearWinner: number;         // Score difference for clear winner
    nameSimilarity: number;      // Minimum similarity for fuzzy name matching
    lowOcrConfidence: number;    // Threshold for low OCR confidence
    strongNonNumberEvidence: number; // Threshold for strong non-number evidence
  };
  multiEvidenceBonus: number;    // Bonus multiplier for multiple evidence types
  sport: string;
  version: string;
}

export interface SportProfile {
  name: string;
  description: string;
  characteristics: {
    typicalNumberRange: [number, number];
    allowsAlphanumeric: boolean;
    commonTeamSize: number;
    sponsorImportance: 'low' | 'medium' | 'high';
    nameVisibility: 'low' | 'medium' | 'high';
  };
  // TODO_ML_INTEGRATION: Add ML-specific parameters
  mlParams?: {
    modelType?: string;
    featureWeights?: number[];
    ensembleWeights?: number[];
  };
}

/**
 * SportConfig Class
 *
 * Manages sport-specific configurations for intelligent matching.
 * Provides optimized parameters for different racing disciplines.
 */
export class SportConfig {
  private configs: Map<string, MatchingConfig>;
  private profiles: Map<string, SportProfile>;

  constructor() {
    this.configs = new Map();
    this.profiles = new Map();
    this.initializeConfigurations();
  }

  /**
   * Initialize configuration from SportCategory data from Supabase
   * SportCategory includes: matching_config, temporal_config, individual_competition, etc.
   */
  initializeFromSportCategories(sportCategories: any[]): void {
    console.log('[SportConfig] Initializing from Supabase sport categories...');

    for (const category of sportCategories) {
      if (category.matching_config && category.code) {
        const personNameWeight = category.matching_config.weights?.personName || category.matching_config.weights?.driverName || 80;
        const matchingConfig: MatchingConfig = {
          weights: {
            raceNumber: category.matching_config.weights?.raceNumber || 100,
            personName: personNameWeight,
            driverName: personNameWeight, // backward compatibility alias
            sponsor: category.matching_config.weights?.sponsor || 40,
            team: category.matching_config.weights?.team || 60,
            category: category.matching_config.weights?.category || 0,
            plateNumber: category.matching_config.weights?.plateNumber || 0
          },
          thresholds: {
            minimumScore: category.matching_config.thresholds?.minimumScore || 50,
            clearWinner: category.matching_config.thresholds?.clearWinner || 30,
            nameSimilarity: category.matching_config.thresholds?.nameSimilarity || 0.75,
            lowOcrConfidence: category.matching_config.thresholds?.lowOcrConfidence || 0.6,
            strongNonNumberEvidence: category.matching_config.thresholds?.strongNonNumberEvidence || 80
          },
          multiEvidenceBonus: category.matching_config.multiEvidenceBonus || 0.2,
          sport: category.code,
          version: '1.1.0-supabase'
        };

        this.configs.set(category.code.toLowerCase(), matchingConfig);
        console.log(`[SportConfig] Updated matching config for ${category.code}:`, matchingConfig);
      }
    }

    console.log('[SportConfig] Configuration updated from Supabase');
  }

  /**
   * Update configuration for a specific sport from Supabase data
   */
  updateSportConfigFromSupabase(sportCode: string, matchingConfig: {
    weights?: {
      raceNumber?: number;
      personName?: number;
      driverName?: number;
      sponsor?: number;
      team?: number;
      category?: number;
      plateNumber?: number;
    };
    thresholds?: {
      minimumScore?: number;
      clearWinner?: number;
      nameSimilarity?: number;
      lowOcrConfidence?: number;
      strongNonNumberEvidence?: number;
    };
    multiEvidenceBonus?: number;
  }): void {
    const existingConfig = this.getConfig(sportCode);

    const personNameWeight = matchingConfig.weights?.personName ?? matchingConfig.weights?.driverName ?? existingConfig.weights.personName;
    const updatedConfig: MatchingConfig = {
      weights: {
        raceNumber: matchingConfig.weights?.raceNumber ?? existingConfig.weights.raceNumber,
        personName: personNameWeight,
        driverName: personNameWeight, // backward compatibility alias
        sponsor: matchingConfig.weights?.sponsor ?? existingConfig.weights.sponsor,
        team: matchingConfig.weights?.team ?? existingConfig.weights.team,
        category: matchingConfig.weights?.category ?? existingConfig.weights.category,
        plateNumber: matchingConfig.weights?.plateNumber ?? existingConfig.weights.plateNumber
      },
      thresholds: {
        minimumScore: matchingConfig.thresholds?.minimumScore ?? existingConfig.thresholds.minimumScore,
        clearWinner: matchingConfig.thresholds?.clearWinner ?? existingConfig.thresholds.clearWinner,
        nameSimilarity: matchingConfig.thresholds?.nameSimilarity ?? existingConfig.thresholds.nameSimilarity,
        lowOcrConfidence: matchingConfig.thresholds?.lowOcrConfidence ?? existingConfig.thresholds.lowOcrConfidence,
        strongNonNumberEvidence: matchingConfig.thresholds?.strongNonNumberEvidence ?? existingConfig.thresholds.strongNonNumberEvidence
      },
      multiEvidenceBonus: matchingConfig.multiEvidenceBonus ?? existingConfig.multiEvidenceBonus,
      sport: sportCode,
      version: '1.1.0-supabase-updated'
    };

    this.configs.set(sportCode.toLowerCase(), updatedConfig);
    console.log(`[SportConfig] Updated ${sportCode} config from Supabase:`, updatedConfig);
  }

  /**
   * Get configuration for a specific sport
   * @param sport - Sport code (e.g., 'IMSA_WeatherTech', 'motorsport')
   * @param silent - If true, suppress warning when sport not found (useful during initialization)
   */
  getConfig(sport: string, silent: boolean = false): MatchingConfig {
    const config = this.configs.get(sport.toLowerCase());
    if (!config) {
      if (!silent) {
        console.warn(`Unknown sport '${sport}', using motorsport default`);
      }
      return this.configs.get('motorsport')!;
    }
    return config;
  }

  /**
   * Get sport profile information
   */
  getProfile(sport: string): SportProfile | null {
    return this.profiles.get(sport.toLowerCase()) || null;
  }

  /**
   * Get all supported sports
   */
  getSupportedSports(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Update configuration for a sport (useful for A/B testing)
   *
   * TODO_ML_INTEGRATION: This can be used for:
   * - Dynamic parameter tuning based on ML feedback
   * - A/B testing different configurations
   * - Real-time optimization based on accuracy metrics
   */
  updateConfig(sport: string, updates: Partial<MatchingConfig>): void {
    const current = this.getConfig(sport);
    const updated = { ...current, ...updates };
    this.configs.set(sport.toLowerCase(), updated);
  }

  /**
   * Initialize all sport configurations
   */
  private initializeConfigurations(): void {
    // Motorsport Configuration (optimized for cars, motorcycles, karts)
    this.configs.set('motorsport', {
      weights: {
        raceNumber: 100,  // Very high importance - numbers are primary
        personName: 80,   // High importance - persons are well-known
        driverName: 80,   // backward compatibility alias
        sponsor: 40,      // Medium importance - many sponsors visible
        team: 60,         // Medium-high importance - team names visible
        category: 0,      // Disabled by default (configured in Supabase)
        plateNumber: 0    // Disabled by default (configured in Supabase)
      },
      thresholds: {
        minimumScore: 50,           // Require substantial evidence
        clearWinner: 30,            // Allow some ambiguity
        nameSimilarity: 0.75,       // Fairly strict name matching
        lowOcrConfidence: 0.6,      // OCR confidence threshold
        strongNonNumberEvidence: 80  // Strong evidence needed to override number
      },
      multiEvidenceBonus: 0.2,      // 20% bonus for multiple evidence
      sport: 'motorsport',
      version: '1.0.0'
    });

    // Running Configuration (optimized for running events)
    this.configs.set('running', {
      weights: {
        raceNumber: 120,  // Even higher importance - bib numbers critical
        personName: 60,   // Lower importance - names less visible
        driverName: 60,   // backward compatibility alias
        sponsor: 20,      // Low importance - fewer visible sponsors
        team: 30,         // Low importance - team less important
        category: 0,      // Disabled by default (configured in Supabase)
        plateNumber: 0    // Disabled (not applicable for running)
      },
      thresholds: {
        minimumScore: 60,           // Higher threshold - numbers more reliable
        clearWinner: 40,            // More strict clear winner
        nameSimilarity: 0.8,        // Very strict name matching
        lowOcrConfidence: 0.7,      // Higher OCR confidence needed
        strongNonNumberEvidence: 100 // Very strong evidence to override
      },
      multiEvidenceBonus: 0.15,     // Lower bonus - number dominates
      sport: 'running',
      version: '1.0.0'
    });

    // Cycling Configuration
    this.configs.set('cycling', {
      weights: {
        raceNumber: 110,  // High importance
        personName: 50,   // Medium importance
        driverName: 50,   // backward compatibility alias
        sponsor: 60,      // Higher importance - cycling has many sponsors
        team: 70,         // High importance - team jerseys prominent
        category: 0,      // Disabled by default (configured in Supabase)
        plateNumber: 0    // Disabled (not applicable for cycling)
      },
      thresholds: {
        minimumScore: 55,
        clearWinner: 35,
        nameSimilarity: 0.75,
        lowOcrConfidence: 0.65,
        strongNonNumberEvidence: 85
      },
      multiEvidenceBonus: 0.25,     // Higher bonus - more evidence types
      sport: 'cycling',
      version: '1.0.0'
    });

    // Motocross Configuration (specialized for off-road)
    this.configs.set('motocross', {
      weights: {
        raceNumber: 110,  // Very high - numbers often 3-digit
        personName: 70,   // Medium-high
        driverName: 70,   // backward compatibility alias
        sponsor: 50,      // Medium - gear sponsors visible
        team: 40,         // Lower - teams less prominent
        category: 0,      // Disabled by default (configured in Supabase)
        plateNumber: 0    // Disabled by default (configured in Supabase)
      },
      thresholds: {
        minimumScore: 50,
        clearWinner: 25,            // More lenient - dirty conditions
        nameSimilarity: 0.7,        // More lenient - names harder to read
        lowOcrConfidence: 0.5,      // Lower threshold - difficult conditions
        strongNonNumberEvidence: 70
      },
      multiEvidenceBonus: 0.3,      // Higher bonus - compensate for conditions
      sport: 'motocross',
      version: '1.0.0'
    });

    // Rally Configuration (optimized for rally racing with co-drivers)
    this.configs.set('rally', {
      weights: {
        raceNumber: 100,  // Very high importance - numbers are critical and stable
        personName: 90,   // Higher than motorsport - driver+navigator names are key
        driverName: 90,   // backward compatibility alias
        sponsor: 40,      // Medium importance - sponsors visible but secondary
        team: 70,         // Higher importance - team identification crucial
        category: 0,      // Disabled by default (configured in Supabase)
        plateNumber: 0    // Disabled by default (configured in Supabase)
      },
      thresholds: {
        minimumScore: 55,           // Higher threshold - more conservative matching
        clearWinner: 35,            // Higher threshold for clear winner
        nameSimilarity: 0.8,        // Stricter name matching for rally precision
        lowOcrConfidence: 0.7,      // Higher OCR confidence requirement
        strongNonNumberEvidence: 90  // Very strong evidence needed to override number
      },
      multiEvidenceBonus: 0.25,     // Good bonus for name+number coherence
      sport: 'rally',
      version: '1.1.0-enhanced'
    });

    // Generic Configuration (fallback)
    this.configs.set('generic', {
      weights: {
        raceNumber: 90,
        personName: 70,
        driverName: 70,   // backward compatibility alias
        sponsor: 35,
        team: 50,
        category: 0,      // Disabled by default (configured in Supabase)
        plateNumber: 0    // Disabled by default (configured in Supabase)
      },
      thresholds: {
        minimumScore: 45,
        clearWinner: 25,
        nameSimilarity: 0.7,
        lowOcrConfidence: 0.6,
        strongNonNumberEvidence: 75
      },
      multiEvidenceBonus: 0.2,
      sport: 'generic',
      version: '1.0.0'
    });

    this.initializeProfiles();
  }

  /**
   * Initialize sport profiles
   */
  private initializeProfiles(): void {
    this.profiles.set('motorsport', {
      name: 'Motorsport',
      description: 'Car racing, karting, and automotive sports',
      characteristics: {
        typicalNumberRange: [1, 999],
        allowsAlphanumeric: true,
        commonTeamSize: 2,
        sponsorImportance: 'high',
        nameVisibility: 'medium'
      }
    });

    this.profiles.set('running', {
      name: 'Running',
      description: 'Marathon, track and field, road racing',
      characteristics: {
        typicalNumberRange: [1, 99999],
        allowsAlphanumeric: false,
        commonTeamSize: 1,
        sponsorImportance: 'low',
        nameVisibility: 'low'
      }
    });

    this.profiles.set('cycling', {
      name: 'Cycling',
      description: 'Road cycling, mountain biking, track cycling',
      characteristics: {
        typicalNumberRange: [1, 999],
        allowsAlphanumeric: false,
        commonTeamSize: 1,
        sponsorImportance: 'high',
        nameVisibility: 'medium'
      }
    });

    this.profiles.set('motocross', {
      name: 'Motocross',
      description: 'Off-road motorcycle racing',
      characteristics: {
        typicalNumberRange: [1, 999],
        allowsAlphanumeric: true,
        commonTeamSize: 1,
        sponsorImportance: 'medium',
        nameVisibility: 'low'
      }
    });

    this.profiles.set('generic', {
      name: 'Generic',
      description: 'General sports configuration',
      characteristics: {
        typicalNumberRange: [1, 999],
        allowsAlphanumeric: true,
        commonTeamSize: 1,
        sponsorImportance: 'medium',
        nameVisibility: 'medium'
      }
    });
  }

  /**
   * Validate a race number for a specific sport
   */
  validateRaceNumber(raceNumber: string, sport: string): boolean {
    const profile = this.getProfile(sport);
    if (!profile) return true; // If no profile, accept any number

    const num = parseInt(raceNumber, 10);
    if (isNaN(num)) {
      // Check if alphanumeric is allowed
      return profile.characteristics.allowsAlphanumeric;
    }

    // Check if within typical range
    const [min, max] = profile.characteristics.typicalNumberRange;
    return num >= min && num <= max;
  }

  /**
   * Get recommended OCR confidence threshold for sport
   */
  getOCRConfidenceThreshold(sport: string): number {
    const config = this.getConfig(sport);
    return config.thresholds.lowOcrConfidence;
  }

  /**
   * Calculate sport-specific confidence adjustment
   *
   * TODO_ML_INTEGRATION: This can incorporate:
   * - Sport-specific confidence models
   * - Environmental factor adjustments
   * - Historical accuracy patterns
   */
  adjustConfidenceForSport(
    baseConfidence: number,
    sport: string,
    context?: {
      weather?: string;
      lighting?: string;
      imageQuality?: number;
    }
  ): number {
    let adjusted = baseConfidence;

    // Sport-specific adjustments
    switch (sport.toLowerCase()) {
      case 'motocross':
        // Motocross often has difficult conditions
        adjusted *= 0.9;
        break;
      case 'running':
        // Running bibs are usually clear
        adjusted *= 1.1;
        break;
      case 'cycling':
        // Cycling numbers can be small
        adjusted *= 0.95;
        break;
    }

    // Context adjustments (if provided)
    if (context) {
      if (context.weather === 'rain' || context.weather === 'muddy') {
        adjusted *= 0.8;
      }
      if (context.lighting === 'poor') {
        adjusted *= 0.85;
      }
      if (context.imageQuality && context.imageQuality < 0.7) {
        adjusted *= context.imageQuality;
      }
    }

    return Math.max(0.1, Math.min(1.0, adjusted));
  }

  /**
   * Export configuration for backup/analysis
   */
  exportConfig(sport: string): string {
    const config = this.getConfig(sport);
    const profile = this.getProfile(sport);
    return JSON.stringify({ config, profile }, null, 2);
  }

  /**
   * Import configuration from backup
   */
  importConfig(configJson: string): void {
    try {
      const data = JSON.parse(configJson);
      if (data.config && data.config.sport) {
        this.configs.set(data.config.sport.toLowerCase(), data.config);
      }
      if (data.profile && data.config && data.config.sport) {
        this.profiles.set(data.config.sport.toLowerCase(), data.profile);
      }
    } catch (error) {
      console.error('Failed to import configuration:', error);
    }
  }

  /**
   * Get optimal configuration based on analysis of participant data
   *
   * TODO_ML_INTEGRATION: This can use ML to:
   * - Analyze participant patterns to suggest optimal sport
   * - Recommend configuration adjustments
   * - Predict best weights based on data characteristics
   */
  analyzeAndSuggestSport(participants: any[]): {
    suggestedSport: string;
    confidence: number;
    reasoning: string[];
  } {
    const reasoning: string[] = [];
    let suggestedSport = 'motorsport'; // default
    let confidence = 0.5;

    if (!participants || participants.length === 0) {
      return { suggestedSport, confidence, reasoning: ['No participant data available'] };
    }

    // Analyze number patterns
    const numbers = participants
      .map(p => p.numero || p.number)
      .filter(Boolean)
      .map(n => parseInt(String(n), 10))
      .filter(n => !isNaN(n));

    if (numbers.length > 0) {
      const maxNumber = Math.max(...numbers);
      const avgNumber = numbers.reduce((a, b) => a + b, 0) / numbers.length;

      if (maxNumber > 10000) {
        suggestedSport = 'running';
        confidence = 0.9;
        reasoning.push(`Large numbers detected (max: ${maxNumber}), typical of running events`);
      } else if (maxNumber > 999) {
        suggestedSport = 'running';
        confidence = 0.7;
        reasoning.push(`Numbers > 999 detected, likely running event`);
      } else if (avgNumber > 500) {
        suggestedSport = 'running';
        confidence = 0.6;
        reasoning.push(`High average number (${avgNumber.toFixed(0)}), possibly running`);
      }
    }

    // Analyze team sizes
    const teamSizes = participants
      .map(p => {
        const drivers = [p.nome_pilota, p.nome_navigatore, p.nome_terzo, p.nome_quarto]
          .filter(Boolean);
        return drivers.length;
      })
      .filter(size => size > 0);

    if (teamSizes.length > 0) {
      const avgTeamSize = teamSizes.reduce((a, b) => a + b, 0) / teamSizes.length;

      if (avgTeamSize > 1.5) {
        if (suggestedSport === 'motorsport' || confidence < 0.6) {
          suggestedSport = 'motorsport';
          confidence = Math.max(confidence, 0.7);
          reasoning.push(`Multi-driver teams detected (avg: ${avgTeamSize.toFixed(1)}), typical of motorsport`);
        }
      } else {
        if (suggestedSport !== 'running') {
          reasoning.push(`Single-driver entries detected, could be cycling or individual sport`);
        }
      }
    }

    // Analyze sponsor patterns
    const sponsorCounts = participants
      .map(p => {
        let sponsors = 0;
        if (p.sponsor) sponsors += Array.isArray(p.sponsor) ? p.sponsor.length : 1;
        if (p.sponsors) sponsors += Array.isArray(p.sponsors) ? p.sponsors.length : 1;
        return sponsors;
      })
      .filter(count => count > 0);

    if (sponsorCounts.length > 0) {
      const avgSponsors = sponsorCounts.reduce((a, b) => a + b, 0) / sponsorCounts.length;

      if (avgSponsors > 2) {
        if (suggestedSport === 'motorsport') {
          confidence = Math.max(confidence, 0.8);
          reasoning.push(`High sponsor count detected (avg: ${avgSponsors.toFixed(1)}), confirms motorsport`);
        } else if (confidence < 0.7) {
          suggestedSport = 'cycling';
          confidence = 0.6;
          reasoning.push(`High sponsor count, possibly cycling`);
        }
      }
    }

    return { suggestedSport, confidence, reasoning };
  }
}