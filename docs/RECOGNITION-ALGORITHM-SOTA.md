# RaceTagger - Piano SOTA per Algoritmo di Riconoscimento

> Documento tecnico per l'evoluzione dell'algoritmo di riconoscimento numeri gara verso lo stato dell'arte.

---

## Indice

1. [Architettura Attuale](#1-architettura-attuale)
2. [Analisi Punti Deboli](#2-analisi-punti-deboli)
3. [Pipeline SOTA Proposta](#3-pipeline-sota-proposta)
4. [Componenti Dettagliati](#4-componenti-dettagliati)
5. [Active Learning System](#5-active-learning-system)
6. [Piano di Implementazione](#6-piano-di-implementazione)
7. [Metriche e Validazione](#7-metriche-e-validazione)

---

## 1. Architettura Attuale

### 1.1 Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PIPELINE ATTUALE                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Image → [YOLO/DETR Crop] → [Edge Function V6] → [SmartMatcher]     │
│              │                    │                    │             │
│              │                    │                    ▼             │
│              │                    │            ┌──────────────┐     │
│              │                    │            │ OCRCorrector │     │
│              │                    │            │ (rule-based) │     │
│              │                    │            └──────────────┘     │
│              │                    ▼                    │             │
│              │           ┌──────────────────┐         │             │
│              │           │   Gemini Flash   │         │             │
│              │           │   (cloud only)   │         │             │
│              │           └──────────────────┘         │             │
│              │                    │                    │             │
│              │                    ▼                    ▼             │
│              │           ┌──────────────────────────────────┐       │
│              └──────────▶│      Evidence Aggregation        │       │
│                          │  - Race Number (weight: 100)     │       │
│                          │  - Driver Name (weight: 80)      │       │
│                          │  - Sponsor (weight: 60)          │       │
│                          │  - Team (weight: 40)             │       │
│                          │  - Temporal Bonus (+15-30)       │       │
│                          └──────────────────────────────────┘       │
│                                         │                            │
│                                         ▼                            │
│                               ┌──────────────────┐                  │
│                               │   Final Match    │                  │
│                               │   + Confidence   │                  │
│                               └──────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Componenti Chiave

| File | Righe | Responsabilità |
|------|-------|----------------|
| `src/matching/smart-matcher.ts` | 2,224 | Multi-evidence matching |
| `src/matching/ocr-corrector.ts` | 375 | OCR error correction |
| `src/matching/evidence-collector.ts` | ~400 | Evidence extraction |
| `src/matching/temporal-clustering.ts` | 899 | Temporal context |
| `src/matching/sport-config.ts` | ~700 | Sport-specific config |
| `supabase/functions/analyzeImageDesktopV6/` | ~500 | Gemini AI analysis |

### 1.3 Flow Dettagliato

1. **Image Input** → Desktop riceve immagine
2. **Object Detection** → YOLO/DETR localizza veicoli/soggetti
3. **Crop Extraction** → Ritaglia aree con numeri potenziali
4. **Edge Function V6** → Invia crops a Gemini Flash per analisi
5. **Evidence Collection** → Estrae: numero, driver, team, sponsor
6. **OCR Correction** → Applica confusion matrix per errori comuni
7. **Smart Matching** → Confronta con participant database
8. **Temporal Bonus** → Aggiunge bonus per coerenza temporale
9. **Final Match** → Restituisce match con confidence

---

## 2. Analisi Punti Deboli

### 2.1 Problemi Identificati

| Area | Problema | Impatto | Severità |
|------|----------|---------|----------|
| **AI Model** | Solo Gemini cloud | Dipendenza internet, costi, latenza | 🔴 Alta |
| **OCR Correction** | Matrix statica hardcoded | Non si adatta a nuovi errori | 🔴 Alta |
| **Training Loop** | Nessun feedback loop | Errori ripetuti, no improvement | 🔴 Alta |
| **Object Detection** | YOLO/DETR generico | Non ottimizzato per racing numbers | 🟡 Media |
| **Confidence** | Non calibrata | 90% confidence ≠ 90% accuracy | 🟡 Media |
| **Multi-vehicle** | Gestione basica | Confusione con veicoli multipli | 🟡 Media |
| **Font Diversity** | Un solo approccio | Fallisce su stili diversi | 🟡 Media |
| **Scene Context** | Ignorato | Stesso approccio partenza/podio | 🟢 Bassa |

### 2.2 Confusion Matrix Attuale (Statica)

```typescript
// Da ocr-corrector.ts - LIMITAZIONI:
// 1. Hardcoded, non si aggiorna
// 2. Non considera contesto (font, condizioni)
// 3. Non impara da correzioni utente

const confusionMatrix = [
  { from: '6', to: ['G', '8', '5'], confidence: 0.9 },
  { from: '8', to: ['B', '6', '3'], confidence: 0.9 },
  { from: '46', to: ['48', '16', '86'], confidence: 0.95 },
  // ... altri pattern statici
];
```

### 2.3 Evidence Weights Attuali

```typescript
// Da sport-config.ts - Pesi statici per sport
motorsport: {
  weights: {
    raceNumber: 100,    // Peso massimo
    driverName: 80,     // Alto ma non determinante
    sponsor: 60,        // Medio
    team: 40,           // Basso
    category: 20        // Minimo
  },
  thresholds: {
    minimumScore: 50,
    clearWinner: 30,
    nameSimilarity: 0.7
  }
}
```

---

## 3. Pipeline SOTA Proposta

### 3.1 Architettura Target

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PIPELINE SOTA PROPOSTA                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Image → [Scene Classifier] → Branch by context                     │
│                │                                                     │
│      ┌─────────┼─────────┬────────────┐                             │
│      ▼         ▼         ▼            ▼                             │
│  [Racing]  [Podium]  [Portrait]   [Grid]                            │
│      │         │         │            │                             │
│      └─────────┴─────────┴────────────┘                             │
│                │                                                     │
│                ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              ENSEMBLE RECOGNIZERS                         │       │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │       │
│  │  │ RF-DETR    │  │ PaddleOCR  │  │ Gemini Flash       │ │       │
│  │  │ (local)    │  │ (local)    │  │ (cloud fallback)   │ │       │
│  │  │ Fine-tuned │  │ Fine-tuned │  │                    │ │       │
│  │  └────────────┘  └────────────┘  └────────────────────┘ │       │
│  └──────────────────────────────────────────────────────────┘       │
│                │                                                     │
│                ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │            CONSENSUS & CONFIDENCE CALIBRATION             │       │
│  │  - Weighted voting tra recognizer                         │       │
│  │  - Calibrated confidence (Platt scaling)                  │       │
│  │  - Multi-hypothesis tracking                              │       │
│  └──────────────────────────────────────────────────────────┘       │
│                │                                                     │
│                ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              SMART MATCHER V2 (ML-enhanced)               │       │
│  │  - Neural evidence fusion                                 │       │
│  │  - Learned confusion patterns                             │       │
│  │  - Active learning from corrections                       │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Principi Architetturali

1. **Ensemble over Single Model**: Combinare più recognizer per robustezza
2. **Local-First**: Preferire inferenza locale, cloud come fallback
3. **Adaptive**: Sistema che impara da correzioni utente
4. **Calibrated**: Confidence che riflette accuracy reale
5. **Context-Aware**: Diversi approcci per diversi scenari

---

## 4. Componenti Dettagliati

### 4.1 Fine-tuned Number Detection Model

**Obiettivo**: Sostituire YOLO/DETR generico con modello specializzato

```typescript
// src/recognition/racing-detr.ts

interface RacingDETRConfig {
  // Base model
  backbone: 'RT-DETR-L' | 'RT-DETR-X';  // Real-time DETR variants
  inputSize: [640, 640];

  // Racing-specific detection heads
  heads: {
    // Primary: Localizza e legge numeri end-to-end
    numberDetectionRecognition: {
      enabled: true;
      classes: ['race_number'];
      recognition: true;  // OCR integrato
    };

    // Secondary: Identifica veicoli per context
    vehicleDetection: {
      enabled: true;
      classes: ['car', 'motorcycle', 'kart', 'bike'];
    };

    // Auxiliary: Helmet per disambiguazione piloti
    helmetDetection: {
      enabled: true;
      classes: ['helmet'];
      colorExtraction: true;  // Estrae colore dominante
    };
  };

  // Inference config
  inference: {
    confidenceThreshold: 0.3;
    nmsThreshold: 0.5;
    maxDetections: 10;
  };
}

// Training configuration
interface RacingDETRTraining {
  // Dataset
  dataset: {
    name: 'racing-numbers-dataset';
    trainImages: 50000;
    valImages: 5000;
    testImages: 5000;

    // Annotations format
    format: 'COCO';

    // Class distribution
    classes: {
      race_number: 60000;  // Primary class
      car: 40000;
      motorcycle: 15000;
      kart: 5000;
    };
  };

  // Augmentation pipeline
  augmentation: {
    // Geometric
    horizontalFlip: { probability: 0.5 };
    rotation: { probability: 0.3, range: [-15, 15] };
    perspective: { probability: 0.4, scale: 0.1 };

    // Photometric
    brightness: { probability: 0.5, range: [0.7, 1.3] };
    contrast: { probability: 0.5, range: [0.8, 1.2] };
    saturation: { probability: 0.3, range: [0.8, 1.2] };

    // Racing-specific
    motionBlur: { probability: 0.4, kernelSize: [5, 15] };
    rainOverlay: { probability: 0.1 };
    dustOverlay: { probability: 0.1 };
    sunFlare: { probability: 0.1 };

    // Occlusion simulation
    randomErase: { probability: 0.3, coverage: [0.1, 0.3] };
    gridMask: { probability: 0.2 };
  };

  // Training hyperparameters
  hyperparameters: {
    epochs: 100;
    batchSize: 16;
    learningRate: 1e-4;
    weightDecay: 1e-4;
    scheduler: 'cosine';
    warmupEpochs: 5;

    // Loss weights
    lossWeights: {
      classification: 1.0;
      bbox: 5.0;
      recognition: 2.0;  // OCR loss
    };
  };
}
```

**Files da creare**:
- `src/recognition/racing-detr.ts` - Wrapper per inferenza
- `src/recognition/racing-detr-training.py` - Script training
- `models/racing-detr-v1.onnx` - Modello esportato

---

### 4.2 Specialized OCR Engine

**Obiettivo**: OCR ottimizzato per font numeri gara

```typescript
// src/recognition/racing-ocr.ts

interface RacingOCRConfig {
  // Primary engine
  primaryEngine: {
    type: 'PaddleOCR';
    model: 'racing-ocr-v1';  // Fine-tuned

    // Recognition config
    recognition: {
      characterSet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      maxLength: 4;  // Max 4 caratteri per numero

      // Beam search for ambiguous cases
      beamWidth: 5;
      returnTopK: 3;  // Ritorna top 3 interpretazioni
    };
  };

  // Fallback engines
  fallbackEngines: [
    {
      type: 'TrOCR';
      model: 'microsoft/trocr-base-printed';
      triggerCondition: 'confidence < 0.7';
    },
    {
      type: 'EasyOCR';
      languages: ['en'];
      triggerCondition: 'confidence < 0.5';
    }
  ];

  // Post-processing
  postProcessing: {
    // Normalize output
    normalizeCase: 'upper';
    removeSpaces: true;

    // Validate against known patterns
    validatePattern: /^[A-Z]?\d{1,3}[A-Z]?$/;

    // Apply learned confusion corrections
    applyConfusionCorrection: true;
  };
}

// OCR Result with alternatives
interface OCRResult {
  primary: {
    text: string;
    confidence: number;
    boundingBox: BBox;
  };

  alternatives: Array<{
    text: string;
    confidence: number;
    source: 'beam_search' | 'fallback_engine';
  }>;

  // Character-level confidence
  characterConfidences: number[];

  // Detected issues
  issues: Array<{
    type: 'low_contrast' | 'motion_blur' | 'occlusion' | 'unusual_font';
    severity: 'low' | 'medium' | 'high';
    position?: [number, number];  // Character position if applicable
  }>;
}
```

**Training Pipeline**:

```python
# ml-training/train-racing-ocr.py

class RacingOCRTrainer:
    def __init__(self):
        self.base_model = "PaddleOCR/PP-OCRv4"

    def prepare_dataset(self):
        """
        Dataset composition:
        - 30% real racing images (manually labeled)
        - 40% synthetic numbers on vehicle templates
        - 20% augmented real images
        - 10% hard negatives (similar but wrong numbers)
        """
        pass

    def augment_for_racing(self, image, label):
        """Racing-specific augmentations"""
        augmentations = [
            # Simulate motion blur from moving vehicles
            MotionBlur(kernel_size=(5, 15), angle=(-45, 45)),

            # Weather conditions
            RandomRain(brightness_coefficient=0.7),
            RandomSunFlare(flare_roi=(0, 0, 1, 0.5)),

            # Number plate wear and damage
            RandomGridShuffle(grid=(3, 3)),
            CoarseDropout(max_holes=8, max_height=10, max_width=10),

            # Perspective from different camera angles
            Perspective(scale=(0.05, 0.15)),

            # Lighting variations
            RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3),
        ]
        return apply_augmentations(image, label, augmentations)

    def train(self, epochs=50):
        """Fine-tune with racing data"""
        pass
```

---

### 4.3 Adaptive Confusion Matrix

**Obiettivo**: Confusion matrix che impara da correzioni

```typescript
// src/recognition/adaptive-confusion.ts

interface AdaptiveConfusionMatrix {
  // Static patterns (base knowledge)
  staticPatterns: ConfusionPattern[];

  // Learned patterns (from user corrections)
  learnedPatterns: Map<string, LearnedPattern>;

  // Learning configuration
  learningConfig: {
    // Minimum observations before adding pattern
    minObservations: 3;

    // Confidence decay over time
    decayRate: 0.95;  // Per week

    // Maximum patterns to store
    maxPatterns: 1000;

    // Persistence
    storageKey: 'adaptive_confusion_matrix';
  };
}

interface LearnedPattern {
  from: string;
  to: string;

  // Statistics
  observations: number;
  lastSeen: Date;

  // Context
  contexts: Array<{
    sport: string;
    imageCondition?: 'clear' | 'motion_blur' | 'rain' | 'dust';
    confidence: number;
  }>;

  // Computed confidence
  computedConfidence: number;
}

class AdaptiveConfusionManager {
  private matrix: AdaptiveConfusionMatrix;
  private db: Database;

  constructor() {
    this.matrix = this.loadMatrix();
  }

  /**
   * Record a correction made by user or system
   */
  recordCorrection(
    original: string,
    corrected: string,
    context: CorrectionContext
  ): void {
    const key = `${original}→${corrected}`;

    if (this.matrix.learnedPatterns.has(key)) {
      // Update existing pattern
      const pattern = this.matrix.learnedPatterns.get(key)!;
      pattern.observations++;
      pattern.lastSeen = new Date();
      pattern.contexts.push({
        sport: context.sport,
        imageCondition: context.condition,
        confidence: context.confidence
      });

      // Recompute confidence
      pattern.computedConfidence = this.computeConfidence(pattern);
    } else {
      // Create new pattern
      this.matrix.learnedPatterns.set(key, {
        from: original,
        to: corrected,
        observations: 1,
        lastSeen: new Date(),
        contexts: [{
          sport: context.sport,
          imageCondition: context.condition,
          confidence: context.confidence
        }],
        computedConfidence: 0.5  // Initial confidence
      });
    }

    // Persist changes
    this.saveMatrix();

    // Check if pattern should be promoted to high-confidence
    this.evaluatePatternPromotion(key);
  }

  /**
   * Get correction suggestions for a recognized number
   */
  getSuggestions(
    recognized: string,
    knownNumbers: string[],
    context: CorrectionContext
  ): CorrectionSuggestion[] {
    const suggestions: CorrectionSuggestion[] = [];

    // Check static patterns
    for (const pattern of this.matrix.staticPatterns) {
      if (this.matchesPattern(recognized, pattern)) {
        for (const candidate of pattern.to) {
          if (knownNumbers.includes(candidate)) {
            suggestions.push({
              original: recognized,
              suggested: candidate,
              confidence: pattern.confidence,
              source: 'static'
            });
          }
        }
      }
    }

    // Check learned patterns (with context boost)
    for (const [key, pattern] of this.matrix.learnedPatterns) {
      if (pattern.from === recognized) {
        if (knownNumbers.includes(pattern.to)) {
          // Apply context boost if same sport/condition
          let contextBoost = 1.0;
          const sameContextCount = pattern.contexts.filter(
            c => c.sport === context.sport
          ).length;
          if (sameContextCount > 0) {
            contextBoost = 1.0 + (sameContextCount / pattern.observations) * 0.2;
          }

          suggestions.push({
            original: recognized,
            suggested: pattern.to,
            confidence: Math.min(0.99, pattern.computedConfidence * contextBoost),
            source: 'learned',
            observations: pattern.observations
          });
        }
      }
    }

    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Compute confidence for a learned pattern
   */
  private computeConfidence(pattern: LearnedPattern): number {
    // Base confidence from observations
    const obsConfidence = Math.min(0.9, 0.5 + (pattern.observations * 0.1));

    // Apply time decay
    const daysSinceLastSeen = (Date.now() - pattern.lastSeen.getTime()) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.pow(this.matrix.learningConfig.decayRate, daysSinceLastSeen / 7);

    return obsConfidence * decayFactor;
  }

  /**
   * Export learned patterns for cloud training
   */
  exportForTraining(): LearnedPatternExport[] {
    const exports: LearnedPatternExport[] = [];

    for (const [key, pattern] of this.matrix.learnedPatterns) {
      if (pattern.observations >= 5) {  // Only export patterns with enough data
        exports.push({
          from: pattern.from,
          to: pattern.to,
          observations: pattern.observations,
          contexts: pattern.contexts,
          confidence: pattern.computedConfidence
        });
      }
    }

    return exports;
  }
}
```

---

### 4.4 Confidence Calibration

**Obiettivo**: Rendere confidence score affidabile

```typescript
// src/recognition/confidence-calibrator.ts

interface ConfidenceCalibrator {
  // Calibration method
  method: 'platt' | 'isotonic' | 'temperature';

  // Learned parameters
  parameters: {
    // Platt scaling: P(y=1|f) = 1/(1 + exp(A*f + B))
    plattA: number;
    plattB: number;

    // Temperature scaling: softmax(logits / T)
    temperature: number;

    // Isotonic regression: piecewise linear mapping
    isotonicBins: Array<{ input: number; output: number }>;
  };

  // Per-condition calibration
  conditionAdjustments: {
    motionBlur: number;      // e.g., 0.85 - reduce confidence
    lowLight: number;        // e.g., 0.80
    rain: number;            // e.g., 0.75
    partialOcclusion: number; // e.g., 0.70
    clear: number;           // e.g., 1.0
  };

  // Per-number-length calibration
  lengthAdjustments: {
    1: number;  // Single digit: high accuracy
    2: number;  // Double digit: medium
    3: number;  // Triple digit: lower
    4: number;  // Quad digit: lowest
  };
}

class ConfidenceCalibrationService {
  private calibrator: ConfidenceCalibrator;
  private validationBuffer: ValidationExample[];

  /**
   * Calibrate raw confidence to true probability
   */
  calibrate(
    rawConfidence: number,
    recognizedNumber: string,
    imageCondition: ImageCondition
  ): CalibratedConfidence {
    // 1. Apply Platt scaling
    const plattCalibrated = this.applyPlattScaling(rawConfidence);

    // 2. Apply condition adjustment
    const conditionFactor = this.getConditionFactor(imageCondition);
    const conditionAdjusted = plattCalibrated * conditionFactor;

    // 3. Apply length adjustment
    const lengthFactor = this.getLengthFactor(recognizedNumber.length);
    const lengthAdjusted = conditionAdjusted * lengthFactor;

    // 4. Clamp to valid range
    const finalConfidence = Math.max(0.01, Math.min(0.99, lengthAdjusted));

    return {
      raw: rawConfidence,
      calibrated: finalConfidence,
      factors: {
        platt: plattCalibrated / rawConfidence,
        condition: conditionFactor,
        length: lengthFactor
      }
    };
  }

  /**
   * Record validation example for recalibration
   */
  recordValidation(
    predictedNumber: string,
    actualNumber: string,
    confidence: number,
    correct: boolean
  ): void {
    this.validationBuffer.push({
      predicted: predictedNumber,
      actual: actualNumber,
      confidence,
      correct,
      timestamp: new Date()
    });

    // Trigger recalibration if enough examples
    if (this.validationBuffer.length >= 100) {
      this.recalibrate();
    }
  }

  /**
   * Recalibrate using accumulated validation data
   */
  private recalibrate(): void {
    // Group by confidence bins
    const bins = this.createConfidenceBins(this.validationBuffer);

    // Calculate actual accuracy per bin
    const calibrationData = bins.map(bin => ({
      predictedConfidence: bin.avgConfidence,
      actualAccuracy: bin.correctCount / bin.totalCount
    }));

    // Fit Platt scaling parameters
    const { A, B } = this.fitPlattScaling(calibrationData);
    this.calibrator.parameters.plattA = A;
    this.calibrator.parameters.plattB = B;

    // Clear buffer
    this.validationBuffer = [];

    // Persist new parameters
    this.saveCalibrator();
  }

  /**
   * Get reliability diagram data for visualization
   */
  getReliabilityDiagram(): ReliabilityDiagramData {
    const bins = 10;
    const data: ReliabilityDiagramData = {
      bins: [],
      expectedCalibrationError: 0,
      maxCalibrationError: 0
    };

    // Compute per-bin accuracy vs confidence
    // Used for debugging and visualization

    return data;
  }
}
```

---

### 4.5 Multi-Hypothesis Tracker

**Obiettivo**: Mantenere alternative fino a risoluzione

```typescript
// src/recognition/multi-hypothesis-tracker.ts

interface HypothesisTracker {
  // Configuration
  config: {
    maxHypotheses: 5;           // Keep top 5 per image
    pruneThreshold: 0.1;        // Remove if confidence < 10%
    resolutionWindow: 10;       // Look at 10 images for resolution
  };

  // Active hypotheses per image
  hypotheses: Map<string, ImageHypotheses>;
}

interface ImageHypotheses {
  imageId: string;
  timestamp: Date;

  hypotheses: Array<{
    participantNumber: string;
    confidence: number;
    evidence: Evidence[];
    source: 'detr' | 'ocr' | 'gemini' | 'ensemble';
  }>;

  // Resolution status
  resolved: boolean;
  resolvedNumber?: string;
  resolutionMethod?: 'consensus' | 'unique_evidence' | 'user_input' | 'temporal';
}

class MultiHypothesisTracker {
  private tracker: HypothesisTracker;
  private temporalWindow: ImageHypotheses[];

  /**
   * Add hypotheses for a new image
   */
  addHypotheses(
    imageId: string,
    timestamp: Date,
    recognitionResults: RecognitionResult[]
  ): void {
    const hypotheses: ImageHypotheses = {
      imageId,
      timestamp,
      hypotheses: recognitionResults.map(r => ({
        participantNumber: r.number,
        confidence: r.confidence,
        evidence: r.evidence,
        source: r.source
      })),
      resolved: false
    };

    // Try immediate resolution
    const resolution = this.tryResolve(hypotheses);
    if (resolution) {
      hypotheses.resolved = true;
      hypotheses.resolvedNumber = resolution.number;
      hypotheses.resolutionMethod = resolution.method;
    }

    this.tracker.hypotheses.set(imageId, hypotheses);
    this.temporalWindow.push(hypotheses);

    // Maintain window size
    if (this.temporalWindow.length > this.tracker.config.resolutionWindow) {
      this.temporalWindow.shift();
    }

    // Try to resolve pending hypotheses with new temporal context
    this.resolveWithTemporalContext();
  }

  /**
   * Try to resolve hypotheses immediately
   */
  private tryResolve(hypotheses: ImageHypotheses): Resolution | null {
    const hyps = hypotheses.hypotheses;

    // Strategy 1: Clear winner (confidence gap > 30%)
    if (hyps.length >= 1) {
      const sorted = [...hyps].sort((a, b) => b.confidence - a.confidence);
      if (sorted.length === 1 || sorted[0].confidence - sorted[1].confidence > 0.3) {
        if (sorted[0].confidence > 0.7) {
          return {
            number: sorted[0].participantNumber,
            method: 'consensus',
            confidence: sorted[0].confidence
          };
        }
      }
    }

    // Strategy 2: Unique evidence match
    for (const hyp of hyps) {
      const hasUniqueEvidence = hyp.evidence.some(e =>
        e.type === 'unique_sponsor' || e.type === 'unique_driver'
      );
      if (hasUniqueEvidence && hyp.confidence > 0.5) {
        return {
          number: hyp.participantNumber,
          method: 'unique_evidence',
          confidence: hyp.confidence * 1.2  // Boost for unique evidence
        };
      }
    }

    return null;
  }

  /**
   * Resolve pending hypotheses using temporal context
   */
  private resolveWithTemporalContext(): void {
    for (const hypotheses of this.temporalWindow) {
      if (hypotheses.resolved) continue;

      // Count votes from resolved neighbors
      const neighborVotes = new Map<string, number>();

      for (const neighbor of this.temporalWindow) {
        if (neighbor.imageId === hypotheses.imageId) continue;
        if (!neighbor.resolved) continue;

        // Weight by temporal proximity
        const timeDiff = Math.abs(
          neighbor.timestamp.getTime() - hypotheses.timestamp.getTime()
        );
        const weight = Math.exp(-timeDiff / (5 * 60 * 1000));  // 5 min decay

        const current = neighborVotes.get(neighbor.resolvedNumber!) || 0;
        neighborVotes.set(neighbor.resolvedNumber!, current + weight);
      }

      // Check if any hypothesis matches temporal consensus
      for (const hyp of hypotheses.hypotheses) {
        const votes = neighborVotes.get(hyp.participantNumber) || 0;
        if (votes > 1.5) {  // At least 1.5 weighted votes
          hypotheses.resolved = true;
          hypotheses.resolvedNumber = hyp.participantNumber;
          hypotheses.resolutionMethod = 'temporal';
          break;
        }
      }
    }
  }

  /**
   * Get unresolved hypotheses for user disambiguation
   */
  getUnresolvedForUser(): UnresolvedHypothesis[] {
    const unresolved: UnresolvedHypothesis[] = [];

    for (const [imageId, hypotheses] of this.tracker.hypotheses) {
      if (!hypotheses.resolved && hypotheses.hypotheses.length > 1) {
        // Check if ambiguity is high enough to warrant user input
        const sorted = [...hypotheses.hypotheses].sort(
          (a, b) => b.confidence - a.confidence
        );
        const gap = sorted[0].confidence - sorted[1].confidence;

        if (gap < 0.2) {  // Less than 20% gap
          unresolved.push({
            imageId,
            options: sorted.slice(0, 3).map(h => ({
              number: h.participantNumber,
              confidence: h.confidence,
              evidence: h.evidence
            }))
          });
        }
      }
    }

    return unresolved;
  }
}
```

---

### 4.6 Scene-Aware Recognition

**Obiettivo**: Ottimizzare recognition per contesto

```typescript
// src/recognition/scene-classifier.ts

interface SceneClassifier {
  // Scene types
  scenes: ['racing', 'grid', 'podium', 'portrait', 'paddock', 'aerial'];

  // Model config
  model: {
    architecture: 'MobileNetV3' | 'EfficientNet-B0';
    inputSize: [224, 224];
    outputClasses: 6;
  };
}

interface SceneRecognitionConfig {
  racing: {
    description: 'Vehicle in motion on track';

    // Detection adjustments
    detection: {
      motionBlurCompensation: true;
      multiVehicleTracking: true;
      expectedNumberVisibility: 'partial';
    };

    // OCR adjustments
    ocr: {
      confidenceMultiplier: 0.9;  // Lower due to blur
      fallbackEnabled: true;
      beamWidth: 5;  // More alternatives
    };

    // Matching adjustments
    matching: {
      temporalBonusMultiplier: 1.5;  // Higher temporal weight
      numberWeightMultiplier: 0.9;
      sponsorWeightMultiplier: 0.7;
    };
  };

  grid: {
    description: 'Vehicles stationary on starting grid';

    detection: {
      motionBlurCompensation: false;
      multiVehicleTracking: true;
      expectedNumberVisibility: 'full';
    };

    ocr: {
      confidenceMultiplier: 1.1;  // Higher due to clarity
      fallbackEnabled: false;
      beamWidth: 3;
    };

    matching: {
      temporalBonusMultiplier: 0.5;  // Lower temporal relevance
      numberWeightMultiplier: 1.2;
      sponsorWeightMultiplier: 1.0;
    };
  };

  podium: {
    description: 'Celebration/award ceremony';

    detection: {
      faceRecognitionPrimary: true;
      numberDetectionSecondary: true;
      expectedNumberVisibility: 'minimal';
    };

    ocr: {
      confidenceMultiplier: 0.7;
      fallbackEnabled: true;
      beamWidth: 5;
    };

    matching: {
      temporalBonusMultiplier: 0.3;
      numberWeightMultiplier: 0.6;
      driverNameWeightMultiplier: 1.5;  // Focus on names
      sponsorWeightMultiplier: 1.2;
    };
  };

  portrait: {
    description: 'Close-up of driver/rider';

    detection: {
      faceRecognitionPrimary: true;
      helmetColorMatching: true;
      suitSponsorDetection: true;
    };

    ocr: {
      confidenceMultiplier: 0.8;
      fallbackEnabled: true;
      beamWidth: 3;
    };

    matching: {
      temporalBonusMultiplier: 0.2;
      numberWeightMultiplier: 0.5;
      driverNameWeightMultiplier: 2.0;  // Primary evidence
      sponsorWeightMultiplier: 1.5;
    };
  };

  paddock: {
    description: 'Pit lane, garage area';

    detection: {
      multiVehicleTracking: true;
      teamBannerDetection: true;
      expectedNumberVisibility: 'variable';
    };

    ocr: {
      confidenceMultiplier: 1.0;
      fallbackEnabled: true;
      beamWidth: 3;
    };

    matching: {
      temporalBonusMultiplier: 0.4;
      numberWeightMultiplier: 1.0;
      teamWeightMultiplier: 1.5;  // Team context important
    };
  };

  aerial: {
    description: 'Drone/helicopter shot';

    detection: {
      roofNumberDetection: true;  // Often different from side
      vehicleColorMatching: true;
      expectedNumberVisibility: 'roof_only';
    };

    ocr: {
      confidenceMultiplier: 0.85;
      fallbackEnabled: true;
      beamWidth: 5;
    };

    matching: {
      temporalBonusMultiplier: 1.0;
      numberWeightMultiplier: 0.8;  // Roof numbers less reliable
      vehicleColorWeightMultiplier: 1.3;  // Color helps
    };
  };
}

class SceneAwareRecognizer {
  private sceneClassifier: SceneClassifier;
  private configs: SceneRecognitionConfig;

  /**
   * Classify scene and get optimized config
   */
  async classifyAndConfigure(image: Buffer): Promise<{
    scene: SceneType;
    confidence: number;
    config: SceneConfig;
  }> {
    // Run scene classification
    const classification = await this.sceneClassifier.classify(image);

    // Get corresponding config
    const config = this.configs[classification.scene];

    return {
      scene: classification.scene,
      confidence: classification.confidence,
      config
    };
  }

  /**
   * Run recognition with scene-optimized pipeline
   */
  async recognize(
    image: Buffer,
    participants: Participant[]
  ): Promise<RecognitionResult> {
    // 1. Classify scene
    const { scene, config } = await this.classifyAndConfigure(image);

    // 2. Run detection with scene-specific settings
    const detections = await this.runDetection(image, config.detection);

    // 3. Run OCR with adjusted confidence
    const ocrResults = await this.runOCR(detections, config.ocr);

    // 4. Run matching with adjusted weights
    const matches = await this.runMatching(ocrResults, participants, config.matching);

    return {
      scene,
      detections,
      ocrResults,
      matches
    };
  }
}
```

---

## 5. Active Learning System

### 5.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ACTIVE LEARNING LOOP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   [Image] → [Recognition] → [Prediction] → [User Feedback]      │
│                                                    │             │
│                                                    ▼             │
│                                          ┌─────────────────┐    │
│                                          │ Training Buffer │    │
│                                          │ (Local SQLite)  │    │
│                                          └────────┬────────┘    │
│                                                   │              │
│              ┌────────────────────────────────────┼────────┐    │
│              │                                    │        │    │
│              ▼                                    ▼        ▼    │
│     ┌────────────────┐              ┌──────────────┐ ┌────────┐│
│     │ Update Local   │              │ Batch Upload │ │Confus. ││
│     │ Confusion Mat  │              │ to Cloud     │ │Analysis││
│     └────────────────┘              └──────────────┘ └────────┘│
│              │                               │                  │
│              │                               ▼                  │
│              │                     ┌──────────────────┐        │
│              │                     │  Cloud Training  │        │
│              │                     │  (weekly batch)  │        │
│              │                     └────────┬─────────┘        │
│              │                              │                   │
│              ▼                              ▼                   │
│     ┌──────────────────────────────────────────────────┐       │
│     │              Model Update Distribution            │       │
│     │  - OTA model updates to desktop clients          │       │
│     │  - Version tracking per sport category           │       │
│     └──────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Training Data Collection

```typescript
// src/recognition/training-collector.ts

interface TrainingExample {
  id: string;
  timestamp: Date;

  // Image data
  image: {
    path: string;
    crop?: Buffer;  // Cropped region if available
    fullImage?: Buffer;  // Full image for context
  };

  // Recognition data
  recognition: {
    predictedNumber: string;
    predictedConfidence: number;
    alternatives: string[];
  };

  // Ground truth
  groundTruth: {
    actualNumber: string;
    source: 'user_correction' | 'high_confidence_match' | 'manual_label';
    verifiedAt: Date;
  };

  // Context
  context: {
    sport: string;
    scene: SceneType;
    imageCondition: ImageCondition;
    participant?: Participant;
  };

  // Training metadata
  training: {
    usedForLocalTraining: boolean;
    uploadedToCloud: boolean;
    uploadedAt?: Date;
  };
}

class TrainingDataCollector {
  private db: Database;
  private uploadQueue: TrainingExample[];

  /**
   * Record a correction for future training
   */
  async recordCorrection(
    imageId: string,
    predicted: string,
    actual: string,
    context: RecognitionContext
  ): Promise<void> {
    // Skip if prediction was correct
    if (predicted === actual) {
      // Still useful for positive examples
      await this.recordPositiveExample(imageId, actual, context);
      return;
    }

    // Create training example
    const example: TrainingExample = {
      id: generateId(),
      timestamp: new Date(),
      image: {
        path: context.imagePath,
        crop: await this.extractCrop(context.imagePath, context.bbox)
      },
      recognition: {
        predictedNumber: predicted,
        predictedConfidence: context.confidence,
        alternatives: context.alternatives || []
      },
      groundTruth: {
        actualNumber: actual,
        source: 'user_correction',
        verifiedAt: new Date()
      },
      context: {
        sport: context.sport,
        scene: context.scene,
        imageCondition: context.condition
      },
      training: {
        usedForLocalTraining: false,
        uploadedToCloud: false
      }
    };

    // Save to local database
    await this.db.insert('training_examples', example);

    // Update local confusion matrix immediately
    await this.updateLocalConfusionMatrix(predicted, actual, context);

    // Add to upload queue
    this.uploadQueue.push(example);

    // Check if we should trigger cloud upload
    if (this.uploadQueue.length >= 50) {
      await this.uploadToCloud();
    }
  }

  /**
   * Upload training data to cloud for batch training
   */
  private async uploadToCloud(): Promise<void> {
    try {
      const examples = [...this.uploadQueue];
      this.uploadQueue = [];

      // Prepare upload payload
      const payload = examples.map(ex => ({
        image: ex.image.crop?.toString('base64'),
        predicted: ex.recognition.predictedNumber,
        actual: ex.groundTruth.actualNumber,
        context: ex.context
      }));

      // Upload to Supabase storage/function
      await supabase.functions.invoke('upload-training-data', {
        body: { examples: payload }
      });

      // Mark as uploaded
      for (const ex of examples) {
        ex.training.uploadedToCloud = true;
        ex.training.uploadedAt = new Date();
        await this.db.update('training_examples', ex.id, ex.training);
      }
    } catch (error) {
      // Re-queue on failure
      this.uploadQueue.push(...examples);
      console.error('Failed to upload training data:', error);
    }
  }

  /**
   * Get statistics on collected training data
   */
  async getStatistics(): Promise<TrainingStatistics> {
    const total = await this.db.count('training_examples');
    const corrections = await this.db.count('training_examples', {
      'groundTruth.source': 'user_correction'
    });
    const uploaded = await this.db.count('training_examples', {
      'training.uploadedToCloud': true
    });

    // Get most common corrections
    const confusionStats = await this.db.aggregate('training_examples', {
      groupBy: ['recognition.predictedNumber', 'groundTruth.actualNumber'],
      count: true
    });

    return {
      totalExamples: total,
      corrections,
      positiveExamples: total - corrections,
      uploaded,
      pending: total - uploaded,
      topConfusions: confusionStats.slice(0, 10)
    };
  }
}
```

### 5.3 Model Update Distribution

```typescript
// src/recognition/model-updater.ts

interface ModelVersion {
  version: string;
  releaseDate: Date;

  // Models included
  models: {
    detr?: { version: string; checksum: string };
    ocr?: { version: string; checksum: string };
    scene?: { version: string; checksum: string };
    confusion?: { version: string; checksum: string };
  };

  // Changelog
  changes: string[];

  // Performance metrics
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    testSetSize: number;
  };

  // Compatibility
  minAppVersion: string;
}

class ModelUpdateService {
  private currentVersion: ModelVersion;
  private modelsPath: string;

  /**
   * Check for model updates
   */
  async checkForUpdates(): Promise<UpdateAvailable | null> {
    try {
      const response = await fetch(
        'https://api.racetagger.com/models/latest-version'
      );
      const latest: ModelVersion = await response.json();

      if (this.isNewerVersion(latest.version, this.currentVersion.version)) {
        return {
          currentVersion: this.currentVersion.version,
          newVersion: latest.version,
          changes: latest.changes,
          metricsImprovement: {
            accuracy: latest.metrics.accuracy - this.currentVersion.metrics.accuracy,
            precision: latest.metrics.precision - this.currentVersion.metrics.precision
          },
          downloadSize: await this.calculateDownloadSize(latest)
        };
      }

      return null;
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return null;
    }
  }

  /**
   * Download and apply model update
   */
  async applyUpdate(version: ModelVersion): Promise<void> {
    // 1. Download models
    const downloads = [];

    if (version.models.detr) {
      downloads.push(this.downloadModel('detr', version.models.detr));
    }
    if (version.models.ocr) {
      downloads.push(this.downloadModel('ocr', version.models.ocr));
    }
    if (version.models.scene) {
      downloads.push(this.downloadModel('scene', version.models.scene));
    }
    if (version.models.confusion) {
      downloads.push(this.downloadModel('confusion', version.models.confusion));
    }

    await Promise.all(downloads);

    // 2. Verify checksums
    await this.verifyChecksums(version);

    // 3. Swap models atomically
    await this.swapModels(version);

    // 4. Update current version
    this.currentVersion = version;
    await this.saveVersionInfo(version);

    // 5. Notify app to reload models
    this.emit('models-updated', version);
  }

  /**
   * Rollback to previous version if issues detected
   */
  async rollback(): Promise<void> {
    const previousVersion = await this.getPreviousVersion();
    if (previousVersion) {
      await this.swapModels(previousVersion);
      this.currentVersion = previousVersion;
    }
  }
}
```

---

## 6. Piano di Implementazione

### 6.1 Fase 1: Foundation (Settimane 1-4)

| Settimana | Task | Output |
|-----------|------|--------|
| 1 | Setup ML training pipeline | `ml-training/` infrastruttura |
| 1 | Raccolta dataset iniziale | 5,000 immagini labeled |
| 2 | Fine-tune RT-DETR su racing | `models/racing-detr-v1.onnx` |
| 2 | Integrate ONNX runtime | `src/recognition/onnx-runtime.ts` |
| 3 | Fine-tune PaddleOCR | `models/racing-ocr-v1.onnx` |
| 3 | Implement ensemble voting | `src/recognition/ensemble.ts` |
| 4 | Integrate con pipeline esistente | Refactor `smart-matcher.ts` |
| 4 | Testing e benchmark | Report accuracy |

**Milestone**: Accuracy da 94% → 96% con modelli fine-tuned

### 6.2 Fase 2: Active Learning (Settimane 5-7)

| Settimana | Task | Output |
|-----------|------|--------|
| 5 | Adaptive confusion matrix | `src/recognition/adaptive-confusion.ts` |
| 5 | Training data collector | `src/recognition/training-collector.ts` |
| 6 | Cloud training pipeline | Supabase functions |
| 6 | Model update distribution | `src/recognition/model-updater.ts` |
| 7 | UI per correction feedback | Renderer integration |
| 7 | Testing active learning loop | End-to-end validation |

**Milestone**: Sistema che impara da correzioni utente

### 6.3 Fase 3: Advanced Features (Settimane 8-10)

| Settimana | Task | Output |
|-----------|------|--------|
| 8 | Confidence calibration | `src/recognition/confidence-calibrator.ts` |
| 8 | Multi-hypothesis tracker | `src/recognition/multi-hypothesis-tracker.ts` |
| 9 | Scene classifier | `src/recognition/scene-classifier.ts` |
| 9 | Scene-aware configs | Integration |
| 10 | Synthetic data generator | `ml-training/synthetic-generator.py` |
| 10 | Final testing e tuning | Performance report |

**Milestone**: Accuracy 98%+ con confidence calibrata

### 6.4 Fase 4: Polish (Settimane 11-12)

| Settimana | Task | Output |
|-----------|------|--------|
| 11 | Performance optimization | Latency < 200ms |
| 11 | Memory optimization | < 2GB RAM |
| 12 | Documentation | Aggiornare CLAUDE.md |
| 12 | User testing | Beta con fotografi |

**Milestone**: Pronto per produzione

---

## 7. Metriche e Validazione

### 7.1 Dataset di Test

```yaml
test_dataset:
  total_images: 10,000

  composition:
    motorsport: 4,000
    running: 2,500
    cycling: 1,500
    motocross: 1,000
    other: 1,000

  conditions:
    clear: 60%
    motion_blur: 20%
    partial_occlusion: 10%
    low_light: 5%
    rain: 5%

  number_lengths:
    1_digit: 15%
    2_digit: 60%
    3_digit: 20%
    4_digit: 5%
```

### 7.2 Metriche Target

| Metrica | Attuale | Target | Measurement |
|---------|---------|--------|-------------|
| **Overall Accuracy** | 94% | 98% | Correct / Total |
| **Precision** | 92% | 97% | TP / (TP + FP) |
| **Recall** | 91% | 96% | TP / (TP + FN) |
| **F1 Score** | 91.5% | 96.5% | Harmonic mean |
| **ECE (Calibration)** | N/A | < 0.05 | Expected Calibration Error |
| **Latency (P95)** | 2.5s | 0.3s | 95th percentile |
| **Memory Usage** | 3GB | 2GB | Peak RAM |

### 7.3 Per-Condition Targets

| Condition | Accuracy Target |
|-----------|-----------------|
| Clear | 99% |
| Motion Blur | 95% |
| Partial Occlusion | 92% |
| Low Light | 93% |
| Rain | 90% |

### 7.4 Validation Protocol

```typescript
interface ValidationProtocol {
  // Test set requirements
  testSet: {
    size: 10000;
    labelQuality: 'double_verified';  // Two annotators agree
    refreshFrequency: 'monthly';       // Add new images monthly
  };

  // Cross-validation
  crossValidation: {
    folds: 5;
    stratifyBy: ['sport', 'condition', 'number_length'];
  };

  // Regression testing
  regression: {
    threshold: 0.5;  // Alert if accuracy drops > 0.5%
    frequency: 'per_commit';
    testSubset: 1000;  // Quick regression test
  };

  // A/B testing for model updates
  abTesting: {
    enabled: true;
    trafficSplit: [90, 10];  // 90% old, 10% new
    minSampleSize: 1000;
    significanceLevel: 0.05;
  };
}
```

---

## Appendice A: File da Creare/Modificare

### Nuovi File

| Path | Descrizione |
|------|-------------|
| `src/recognition/racing-detr.ts` | RT-DETR wrapper per racing |
| `src/recognition/racing-ocr.ts` | PaddleOCR wrapper |
| `src/recognition/ensemble.ts` | Ensemble voting logic |
| `src/recognition/adaptive-confusion.ts` | Confusion matrix adattiva |
| `src/recognition/confidence-calibrator.ts` | Calibrazione confidence |
| `src/recognition/multi-hypothesis-tracker.ts` | Multi-hypothesis |
| `src/recognition/scene-classifier.ts` | Scene classification |
| `src/recognition/training-collector.ts` | Training data collection |
| `src/recognition/model-updater.ts` | OTA model updates |
| `ml-training/train-racing-detr.py` | Training script DETR |
| `ml-training/train-racing-ocr.py` | Training script OCR |
| `ml-training/synthetic-generator.py` | Synthetic data gen |

### File da Modificare

| Path | Modifiche |
|------|-----------|
| `src/matching/smart-matcher.ts` | Integrare ensemble, calibration |
| `src/matching/ocr-corrector.ts` | Usare adaptive confusion |
| `src/unified-image-processor.ts` | Integrare scene classifier |
| `src/config.ts` | Aggiungere config per recognition SOTA |
| `renderer/js/renderer.js` | UI per correction feedback |

---

## Appendice B: Risorse Necessarie

### Hardware per Training

| Resource | Specs | Purpose |
|----------|-------|---------|
| GPU | NVIDIA A100 40GB | Model training |
| Storage | 500GB SSD | Dataset storage |
| RAM | 64GB | Large batch training |

### Cloud Services

| Service | Usage | Cost Estimate |
|---------|-------|---------------|
| AWS SageMaker | Training jobs | ~$200/training run |
| Supabase Storage | Training data | ~$25/month |
| Model Registry | Version tracking | ~$50/month |

### Dataset Annotation

| Task | Volume | Cost |
|------|--------|------|
| Initial labeling | 50,000 images | ~$2,500 (outsourced) |
| Ongoing labeling | 5,000/month | ~$250/month |
| Quality review | 10% sample | Internal |

---

*Documento creato: Dicembre 2025*
*Autore: Claude Code Analysis*
*Versione: 1.0*
