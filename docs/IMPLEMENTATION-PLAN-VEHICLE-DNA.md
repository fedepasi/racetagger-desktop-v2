# Piano di Implementazione: Vehicle DNA Fingerprinting + Optimize Results

## Obiettivo

Creare un sistema che:
1. **Estrae automaticamente un "DNA" completo** per ogni veicolo durante l'analisi
2. **Aggrega le evidenze cross-immagine** per costruire un profilo affidabile
3. **Permette ri-analisi offline** ("Optimize Results") senza costi API aggiuntivi
4. **Migliora l'accuratezza** anche SENZA preset partecipanti caricati

---

## Architettura Sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FASE 1: ANALISI INIZIALE                          │
│                                                                             │
│  Immagini ──► Edge Function (Gemini/RF-DETR) ──► VehicleAnalysisData[]     │
│                        │                                                    │
│                        ▼                                                    │
│              Enhanced Response (nuovo)                                      │
│              + colore_livrea                                                │
│              + costruttore                                                  │
│              + modello                                                      │
│              + elementi_distintivi                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FASE 2: AGGREGAZIONE DNA (nuovo)                        │
│                                                                             │
│  VehicleDNABuilder                                                          │
│  ├── Per ogni risultato:                                                    │
│  │   └── Aggrega per numero o per "signature visiva"                        │
│  ├── Calcola frequenze: sponsor, colori, team, piloti                       │
│  ├── Identifica "discriminanti" (feature uniche)                            │
│  └── Output: Map<numero, VehicleDNA>                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FASE 3: OPTIMIZE RESULTS (nuovo)                         │
│                                                                             │
│  Per ogni immagine con risultato incerto:                                   │
│  ├── VehicleDNAMatcher.matchByFeatures(detectedFeatures, allDNAs)           │
│  ├── Score multi-feature con pesi dinamici                                  │
│  ├── Se score > threshold: aggiorna risultato                               │
│  └── Log correzione come "DNA_OPTIMIZATION"                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## FASE 1: Estensione Estrazione Dati

### 1.1 Modifiche al Prompt Gemini

**File**: `supabase/functions/analyzeImageDesktopV6/modules/prompt-builder.ts`

```typescript
// NUOVO: Enhanced response format
function buildResponseFormat(hasNegative: boolean): string {
  const contextPart = hasNegative ? `,
  "context": {
    "sponsorVisibili": ["Shell", "Pirelli"],
    "altriNumeri": [],
    "categoria": "Formula 1",
    "coloriTeam": ["rosso", "giallo"]
  }` : '';

  return `

Rispondi SOLO con un oggetto JSON valido in questo formato esatto:
{
  "crops": [
    {
      "imageIndex": 1,
      "raceNumber": "16",
      "confidence": 0.95,
      "drivers": ["Charles Leclerc"],
      "teamName": "Ferrari",
      "otherText": ["Shell", "Santander"],

      // NUOVI CAMPI V7
      "liveryColor": {
        "primary": "rosso",
        "secondary": ["nero", "giallo"],
        "pattern": "strisce laterali"
      },
      "manufacturer": "Ferrari",
      "model": "296 GT3",
      "distinctiveElements": ["alettone GT3", "logo giallo laterale"]
    }
  ]${contextPart}
}`;
}
```

### 1.2 Nuove Interfacce TypeScript

**Nuovo file**: `src/types/vehicle-dna.ts`

```typescript
/**
 * Vehicle DNA - Complete visual fingerprint of a racing vehicle
 */

// Colori livrea
export interface LiveryColor {
  primary: string;           // "rosso", "blu", "nero"
  secondary: string[];       // Altri colori significativi
  pattern?: string;          // "strisce", "gradiente", "tinta unita"
}

// Singola evidenza con frequenza
export interface FeatureEvidence<T = string> {
  value: T;
  count: number;             // Quante volte vista
  avgConfidence: number;     // Confidence media
  firstSeen: string;         // Timestamp ISO
  lastSeen: string;
}

// DNA completo di un veicolo
export interface VehicleDNA {
  // === Identificatori Primari ===
  numero: string;
  targa?: string;                              // Per rally

  // === Identificatori Umani (alta affidabilità) ===
  piloti: FeatureEvidence<string>[];           // Con frequenza per varianti OCR

  // === Identificatori Visuali ===
  coloriLivrea: {
    primary: FeatureEvidence<string>;
    secondary: FeatureEvidence<string>[];
  };
  costruttore?: FeatureEvidence<string>;       // "Ferrari", "Porsche"
  modello?: FeatureEvidence<string>;           // "296 GT3"
  elementiDistintivi: FeatureEvidence<string>[];

  // === Identificatori Contestuali ===
  team: FeatureEvidence<string>[];             // Varianti nome team
  sponsors: FeatureEvidence<string>[];         // Lista sponsor con frequenza
  categoria?: string;

  // === Metadati Statistici ===
  totalSightings: number;                      // Totale avvistamenti
  imageIds: string[];                          // ID immagini dove è stato visto
  firstSeen: string;
  lastSeen: string;

  // === Confidence Aggregata ===
  overallConfidence: number;                   // 0-1
  featureCompleteness: number;                 // Quante feature abbiamo (0-1)

  // === Discriminanti ===
  uniqueFeatures: {
    feature: string;                           // "sponsor", "pilota", "colore"
    value: string;
    isGloballyUnique: boolean;                 // Unico in tutto il dataset
  }[];
}

// Risultato match multi-feature
export interface DNAMatchResult {
  numero: string;
  score: number;                               // 0-1
  confidence: number;                          // 0-1
  matchedFeatures: {
    feature: string;
    detected: string;
    stored: string;
    similarity: number;
    weight: number;
    isDiscriminant: boolean;
  }[];
  missingFeatures: string[];                   // Feature attese ma non viste
  unexpectedFeatures: string[];                // Feature viste ma non attese
  reasoning: string[];                         // Spiegazione human-readable
}

// Configurazione pesi per matching
export interface DNAMatchingWeights {
  numero: number;           // 100 (se visibile, match perfetto)
  targa: number;            // 95
  pilota: number;           // 90
  pilotaFuzzy: number;      // 70
  team: number;             // 70
  costruttore: number;      // 60
  colore: number;           // 50
  sponsorUnico: number;     // 80
  sponsorComune: number;    // 40
  modello: number;          // 55
  elementiDistintivi: number; // 45
}
```

### 1.3 Estensione VehicleAnalysisData

**File da modificare**: `src/utils/analysis-logger.ts`

```typescript
// Estendere VehicleAnalysisData esistente
export interface VehicleAnalysisData {
  // ... campi esistenti ...

  // NUOVI CAMPI V7
  liveryColor?: {
    primary: string;
    secondary: string[];
    pattern?: string;
  };
  manufacturer?: string;
  model?: string;
  distinctiveElements?: string[];
}
```

---

## FASE 2: VehicleDNABuilder

**Nuovo file**: `src/matching/vehicle-dna-builder.ts`

```typescript
/**
 * VehicleDNABuilder - Costruisce profili DNA aggregando evidenze cross-immagine
 */

import { VehicleDNA, FeatureEvidence, VehicleAnalysisData } from '../types/vehicle-dna';

export class VehicleDNABuilder {
  private dnaMap: Map<string, VehicleDNA> = new Map();
  private sponsorToNumbers: Map<string, Set<string>> = new Map();
  private pilotaToNumbers: Map<string, Set<string>> = new Map();

  /**
   * Aggiunge un risultato di analisi al builder
   */
  addAnalysisResult(result: VehicleAnalysisData, imageId: string): void {
    const numero = result.raceNumber;
    if (!numero) {
      // Risultato senza numero - salvare per matching successivo
      this.addUnidentifiedResult(result, imageId);
      return;
    }

    // Ottieni o crea DNA per questo numero
    let dna = this.dnaMap.get(numero);
    if (!dna) {
      dna = this.createEmptyDNA(numero);
      this.dnaMap.set(numero, dna);
    }

    // Aggiorna contatori e frequenze
    dna.totalSightings++;
    dna.imageIds.push(imageId);
    dna.lastSeen = new Date().toISOString();

    // Aggrega piloti
    if (result.drivers) {
      for (const driver of result.drivers) {
        this.addFeatureEvidence(dna.piloti, driver, result.confidence);
        this.updateReverseIndex(this.pilotaToNumbers, driver, numero);
      }
    }

    // Aggrega sponsor
    if (result.sponsors) {
      for (const sponsor of result.sponsors) {
        this.addFeatureEvidence(dna.sponsors, sponsor, result.confidence);
        this.updateReverseIndex(this.sponsorToNumbers, sponsor, numero);
      }
    }

    // Aggrega team
    if (result.team) {
      this.addFeatureEvidence(dna.team, result.team, result.confidence);
    }

    // Aggrega colori livrea (NUOVO)
    if (result.liveryColor) {
      this.updateLiveryColor(dna, result.liveryColor, result.confidence);
    }

    // Aggrega costruttore (NUOVO)
    if (result.manufacturer) {
      this.updateSingleFeature(dna, 'costruttore', result.manufacturer, result.confidence);
    }

    // Aggrega modello (NUOVO)
    if (result.model) {
      this.updateSingleFeature(dna, 'modello', result.model, result.confidence);
    }

    // Aggrega elementi distintivi (NUOVO)
    if (result.distinctiveElements) {
      for (const element of result.distinctiveElements) {
        this.addFeatureEvidence(dna.elementiDistintivi, element, result.confidence);
      }
    }

    // Ricalcola confidence e completeness
    this.recalculateMetrics(dna);
  }

  /**
   * Finalizza la costruzione e identifica discriminanti
   */
  finalize(): Map<string, VehicleDNA> {
    // Identifica feature uniche (discriminanti)
    for (const [numero, dna] of this.dnaMap) {
      dna.uniqueFeatures = [];

      // Sponsor unici
      for (const sponsor of dna.sponsors) {
        const numbersWithSponsor = this.sponsorToNumbers.get(sponsor.value.toLowerCase());
        if (numbersWithSponsor?.size === 1) {
          dna.uniqueFeatures.push({
            feature: 'sponsor',
            value: sponsor.value,
            isGloballyUnique: true
          });
        }
      }

      // Piloti unici
      for (const pilota of dna.piloti) {
        const numbersWithPilota = this.pilotaToNumbers.get(pilota.value.toLowerCase());
        if (numbersWithPilota?.size === 1) {
          dna.uniqueFeatures.push({
            feature: 'pilota',
            value: pilota.value,
            isGloballyUnique: true
          });
        }
      }
    }

    return this.dnaMap;
  }

  /**
   * Esporta come JSON per persistenza/debug
   */
  exportToJSON(): string {
    const obj: Record<string, VehicleDNA> = {};
    for (const [key, value] of this.dnaMap) {
      obj[key] = value;
    }
    return JSON.stringify(obj, null, 2);
  }

  /**
   * Importa da JSON (per resume sessione)
   */
  importFromJSON(json: string): void {
    const obj = JSON.parse(json);
    this.dnaMap = new Map(Object.entries(obj));
  }

  // === Metodi privati ===

  private createEmptyDNA(numero: string): VehicleDNA {
    const now = new Date().toISOString();
    return {
      numero,
      piloti: [],
      coloriLivrea: {
        primary: { value: '', count: 0, avgConfidence: 0, firstSeen: now, lastSeen: now },
        secondary: []
      },
      elementiDistintivi: [],
      team: [],
      sponsors: [],
      totalSightings: 0,
      imageIds: [],
      firstSeen: now,
      lastSeen: now,
      overallConfidence: 0,
      featureCompleteness: 0,
      uniqueFeatures: []
    };
  }

  private addFeatureEvidence(
    array: FeatureEvidence<string>[],
    value: string,
    confidence: number
  ): void {
    const normalized = value.toLowerCase().trim();
    const existing = array.find(e => e.value.toLowerCase() === normalized);

    if (existing) {
      existing.count++;
      existing.avgConfidence = (existing.avgConfidence * (existing.count - 1) + confidence) / existing.count;
      existing.lastSeen = new Date().toISOString();
    } else {
      const now = new Date().toISOString();
      array.push({
        value,
        count: 1,
        avgConfidence: confidence,
        firstSeen: now,
        lastSeen: now
      });
    }
  }

  private updateReverseIndex(
    index: Map<string, Set<string>>,
    feature: string,
    numero: string
  ): void {
    const key = feature.toLowerCase().trim();
    if (!index.has(key)) {
      index.set(key, new Set());
    }
    index.get(key)!.add(numero);
  }

  private recalculateMetrics(dna: VehicleDNA): void {
    // Confidence = media pesata delle confidence delle feature
    let totalWeight = 0;
    let weightedConfidence = 0;

    if (dna.piloti.length > 0) {
      const avgPilota = dna.piloti.reduce((sum, p) => sum + p.avgConfidence, 0) / dna.piloti.length;
      weightedConfidence += avgPilota * 90;
      totalWeight += 90;
    }

    if (dna.sponsors.length > 0) {
      const avgSponsor = dna.sponsors.reduce((sum, s) => sum + s.avgConfidence, 0) / dna.sponsors.length;
      weightedConfidence += avgSponsor * 50;
      totalWeight += 50;
    }

    if (dna.team.length > 0) {
      const avgTeam = dna.team.reduce((sum, t) => sum + t.avgConfidence, 0) / dna.team.length;
      weightedConfidence += avgTeam * 70;
      totalWeight += 70;
    }

    dna.overallConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

    // Feature completeness = quante feature abbiamo su quelle possibili
    let featuresPresent = 0;
    const totalPossible = 8; // numero, piloti, team, sponsor, colore, costruttore, modello, elementi

    if (dna.numero) featuresPresent++;
    if (dna.piloti.length > 0) featuresPresent++;
    if (dna.team.length > 0) featuresPresent++;
    if (dna.sponsors.length > 0) featuresPresent++;
    if (dna.coloriLivrea.primary.value) featuresPresent++;
    if (dna.costruttore?.value) featuresPresent++;
    if (dna.modello?.value) featuresPresent++;
    if (dna.elementiDistintivi.length > 0) featuresPresent++;

    dna.featureCompleteness = featuresPresent / totalPossible;
  }
}
```

---

## FASE 3: VehicleDNAMatcher

**Nuovo file**: `src/matching/vehicle-dna-matcher.ts`

```typescript
/**
 * VehicleDNAMatcher - Matching multi-feature con scoring pesato
 */

import { VehicleDNA, DNAMatchResult, DNAMatchingWeights } from '../types/vehicle-dna';

const DEFAULT_WEIGHTS: DNAMatchingWeights = {
  numero: 100,
  targa: 95,
  pilota: 90,
  pilotaFuzzy: 70,
  team: 70,
  costruttore: 60,
  colore: 50,
  sponsorUnico: 80,
  sponsorComune: 40,
  modello: 55,
  elementiDistintivi: 45
};

export class VehicleDNAMatcher {
  private allDNAs: Map<string, VehicleDNA>;
  private weights: DNAMatchingWeights;

  constructor(dnas: Map<string, VehicleDNA>, weights?: Partial<DNAMatchingWeights>) {
    this.allDNAs = dnas;
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Match features rilevate contro tutti i DNA noti
   * Usato quando il numero NON è leggibile
   */
  matchByFeatures(
    detectedFeatures: {
      drivers?: string[];
      sponsors?: string[];
      team?: string;
      liveryColor?: { primary: string; secondary?: string[] };
      manufacturer?: string;
      model?: string;
    }
  ): DNAMatchResult[] {
    const results: DNAMatchResult[] = [];

    for (const [numero, dna] of this.allDNAs) {
      const matchResult = this.calculateMatch(detectedFeatures, dna);
      if (matchResult.score > 0.2) { // Threshold minimo
        results.push(matchResult);
      }
    }

    // Ordina per score decrescente
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Verifica coerenza: numero rilevato vs feature rilevate
   * Usato quando il numero È leggibile ma con bassa confidence
   */
  verifyNumberWithFeatures(
    detectedNumber: string,
    detectedFeatures: {
      drivers?: string[];
      sponsors?: string[];
      team?: string;
      liveryColor?: { primary: string };
    }
  ): { isCoherent: boolean; confidence: number; issues: string[] } {
    const dna = this.allDNAs.get(detectedNumber);
    if (!dna) {
      return {
        isCoherent: true, // Non abbiamo evidenze contrarie
        confidence: 0.5,
        issues: ['Numero non presente nel DNA database']
      };
    }

    const issues: string[] = [];
    let coherenceScore = 0;
    let totalChecks = 0;

    // Verifica piloti
    if (detectedFeatures.drivers?.length) {
      totalChecks++;
      const pilotMatch = this.matchPilots(detectedFeatures.drivers, dna.piloti);
      if (pilotMatch > 0.7) {
        coherenceScore++;
      } else if (pilotMatch < 0.3) {
        issues.push(`Pilota non coerente: rilevato "${detectedFeatures.drivers.join(', ')}" ma DNA ha "${dna.piloti.map(p => p.value).join(', ')}"`);
      }
    }

    // Verifica sponsor
    if (detectedFeatures.sponsors?.length) {
      totalChecks++;
      const sponsorMatch = this.matchSponsors(detectedFeatures.sponsors, dna.sponsors);
      if (sponsorMatch.matchRatio > 0.5) {
        coherenceScore++;
      } else if (sponsorMatch.hasContradiction) {
        issues.push(`Sponsor contraddittorio: "${sponsorMatch.contradictions.join(', ')}" non appartiene a #${detectedNumber}`);
      }
    }

    // Verifica team
    if (detectedFeatures.team) {
      totalChecks++;
      const teamMatch = this.matchTeam(detectedFeatures.team, dna.team);
      if (teamMatch > 0.7) {
        coherenceScore++;
      } else if (teamMatch < 0.3) {
        issues.push(`Team non coerente: rilevato "${detectedFeatures.team}" ma DNA ha "${dna.team.map(t => t.value).join(', ')}"`);
      }
    }

    const coherenceRatio = totalChecks > 0 ? coherenceScore / totalChecks : 1;

    return {
      isCoherent: coherenceRatio > 0.5 && issues.length < 2,
      confidence: coherenceRatio,
      issues
    };
  }

  /**
   * Calcola match score tra feature rilevate e un DNA specifico
   */
  private calculateMatch(
    detected: any,
    dna: VehicleDNA
  ): DNAMatchResult {
    const matchedFeatures: DNAMatchResult['matchedFeatures'] = [];
    const missingFeatures: string[] = [];
    const unexpectedFeatures: string[] = [];
    const reasoning: string[] = [];

    let totalScore = 0;
    let maxPossibleScore = 0;

    // === MATCH PILOTI ===
    if (detected.drivers?.length > 0 && dna.piloti.length > 0) {
      maxPossibleScore += this.weights.pilota;
      const pilotScore = this.matchPilots(detected.drivers, dna.piloti);

      if (pilotScore > 0) {
        totalScore += pilotScore * this.weights.pilota;
        matchedFeatures.push({
          feature: 'pilota',
          detected: detected.drivers.join(', '),
          stored: dna.piloti.map(p => p.value).join(', '),
          similarity: pilotScore,
          weight: this.weights.pilota,
          isDiscriminant: dna.uniqueFeatures.some(u => u.feature === 'pilota')
        });
        reasoning.push(`Pilota match: ${(pilotScore * 100).toFixed(0)}%`);
      }
    } else if (dna.piloti.length > 0 && !detected.drivers?.length) {
      missingFeatures.push('pilota');
    }

    // === MATCH SPONSOR ===
    if (detected.sponsors?.length > 0 && dna.sponsors.length > 0) {
      const sponsorResult = this.matchSponsors(detected.sponsors, dna.sponsors);

      for (const match of sponsorResult.matches) {
        const isUnique = dna.uniqueFeatures.some(
          u => u.feature === 'sponsor' && u.value.toLowerCase() === match.sponsor.toLowerCase()
        );
        const weight = isUnique ? this.weights.sponsorUnico : this.weights.sponsorComune;

        maxPossibleScore += weight;
        totalScore += match.similarity * weight;

        matchedFeatures.push({
          feature: 'sponsor',
          detected: match.detected,
          stored: match.sponsor,
          similarity: match.similarity,
          weight,
          isDiscriminant: isUnique
        });

        if (isUnique) {
          reasoning.push(`SPONSOR UNICO "${match.sponsor}" +${weight} pts`);
        }
      }

      // Penalizza sponsor contraddittori
      for (const contradiction of sponsorResult.contradictions) {
        unexpectedFeatures.push(`sponsor:${contradiction}`);
        totalScore -= 20; // Penalità
        reasoning.push(`CONTRADDIZIONE: sponsor "${contradiction}" non appartiene a questo veicolo`);
      }
    }

    // === MATCH TEAM ===
    if (detected.team && dna.team.length > 0) {
      maxPossibleScore += this.weights.team;
      const teamScore = this.matchTeam(detected.team, dna.team);

      if (teamScore > 0) {
        totalScore += teamScore * this.weights.team;
        matchedFeatures.push({
          feature: 'team',
          detected: detected.team,
          stored: dna.team[0].value,
          similarity: teamScore,
          weight: this.weights.team,
          isDiscriminant: false
        });
      }
    }

    // === MATCH COLORE ===
    if (detected.liveryColor?.primary && dna.coloriLivrea.primary.value) {
      maxPossibleScore += this.weights.colore;
      const colorScore = this.matchColor(detected.liveryColor.primary, dna.coloriLivrea.primary.value);

      if (colorScore > 0.5) {
        totalScore += colorScore * this.weights.colore;
        matchedFeatures.push({
          feature: 'colore',
          detected: detected.liveryColor.primary,
          stored: dna.coloriLivrea.primary.value,
          similarity: colorScore,
          weight: this.weights.colore,
          isDiscriminant: false
        });
      }
    }

    // === MATCH COSTRUTTORE ===
    if (detected.manufacturer && dna.costruttore?.value) {
      maxPossibleScore += this.weights.costruttore;
      if (detected.manufacturer.toLowerCase() === dna.costruttore.value.toLowerCase()) {
        totalScore += this.weights.costruttore;
        matchedFeatures.push({
          feature: 'costruttore',
          detected: detected.manufacturer,
          stored: dna.costruttore.value,
          similarity: 1.0,
          weight: this.weights.costruttore,
          isDiscriminant: false
        });
      }
    }

    // Calcola score finale normalizzato
    const normalizedScore = maxPossibleScore > 0 ? Math.max(0, totalScore) / maxPossibleScore : 0;

    // Bonus per feature discriminanti
    const discriminantCount = matchedFeatures.filter(m => m.isDiscriminant).length;
    const discriminantBonus = discriminantCount * 0.1;

    // Bonus per consistenza storica (più avvistamenti = più affidabile)
    const historicalBonus = Math.min(0.1, Math.log10(dna.totalSightings + 1) * 0.05);

    const finalScore = Math.min(1.0, normalizedScore + discriminantBonus + historicalBonus);

    return {
      numero: dna.numero,
      score: finalScore,
      confidence: finalScore * dna.overallConfidence,
      matchedFeatures,
      missingFeatures,
      unexpectedFeatures,
      reasoning
    };
  }

  // === Metodi di matching specifici ===

  private matchPilots(detected: string[], stored: { value: string }[]): number {
    if (detected.length === 0 || stored.length === 0) return 0;

    let bestScore = 0;
    for (const det of detected) {
      for (const sto of stored) {
        const score = this.stringSimilarity(det.toLowerCase(), sto.value.toLowerCase());
        if (score > bestScore) bestScore = score;
      }
    }
    return bestScore;
  }

  private matchSponsors(
    detected: string[],
    stored: { value: string }[]
  ): {
    matches: { detected: string; sponsor: string; similarity: number }[];
    matchRatio: number;
    contradictions: string[];
    hasContradiction: boolean;
  } {
    const matches: { detected: string; sponsor: string; similarity: number }[] = [];
    const contradictions: string[] = [];

    for (const det of detected) {
      let matched = false;
      for (const sto of stored) {
        const sim = this.stringSimilarity(det.toLowerCase(), sto.value.toLowerCase());
        if (sim > 0.7) {
          matches.push({ detected: det, sponsor: sto.value, similarity: sim });
          matched = true;
          break;
        }
      }
      if (!matched) {
        contradictions.push(det);
      }
    }

    return {
      matches,
      matchRatio: detected.length > 0 ? matches.length / detected.length : 0,
      contradictions,
      hasContradiction: contradictions.length > 0
    };
  }

  private matchTeam(detected: string, stored: { value: string }[]): number {
    let bestScore = 0;
    for (const sto of stored) {
      const score = this.stringSimilarity(detected.toLowerCase(), sto.value.toLowerCase());
      if (score > bestScore) bestScore = score;
    }
    return bestScore;
  }

  private matchColor(detected: string, stored: string): number {
    // Match esatto
    if (detected.toLowerCase() === stored.toLowerCase()) return 1.0;

    // Match sinonimi colori
    const colorSynonyms: Record<string, string[]> = {
      'rosso': ['red', 'corsa', 'ferrari'],
      'blu': ['blue', 'azzurro'],
      'nero': ['black', 'dark'],
      'bianco': ['white', 'ivory'],
      'giallo': ['yellow', 'gold', 'oro'],
      'verde': ['green', 'racing green'],
      'arancione': ['orange', 'papaya']
    };

    for (const [color, synonyms] of Object.entries(colorSynonyms)) {
      const detLower = detected.toLowerCase();
      const stoLower = stored.toLowerCase();

      if ((detLower === color || synonyms.includes(detLower)) &&
          (stoLower === color || synonyms.includes(stoLower))) {
        return 0.9;
      }
    }

    return 0;
  }

  private stringSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;

    // Jaro-Winkler simplified
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;

    let matches = 0;
    const range = Math.floor(maxLen / 2) - 1;

    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - range);
      const end = Math.min(i + range + 1, s2.length);

      for (let j = start; j < end; j++) {
        if (s1[i] === s2[j]) {
          matches++;
          break;
        }
      }
    }

    return matches / maxLen;
  }
}
```

---

## FASE 4: Integrazione con Sistema Esistente

### 4.1 Nuovo IPC Handler

**File da modificare**: `src/ipc/analysis-handlers.ts`

```typescript
// Aggiungi questi handler

import { VehicleDNABuilder } from '../matching/vehicle-dna-builder';
import { VehicleDNAMatcher } from '../matching/vehicle-dna-matcher';

// Storage in-memory per DNA della sessione corrente
let currentSessionDNA: Map<string, VehicleDNA> | null = null;
let dnaBuilder: VehicleDNABuilder | null = null;

ipcMain.handle('dna:start-collection', async () => {
  dnaBuilder = new VehicleDNABuilder();
  currentSessionDNA = null;
  return { success: true };
});

ipcMain.handle('dna:add-result', async (event, result: VehicleAnalysisData, imageId: string) => {
  if (!dnaBuilder) {
    return { success: false, error: 'DNA collection not started' };
  }
  dnaBuilder.addAnalysisResult(result, imageId);
  return { success: true };
});

ipcMain.handle('dna:finalize', async () => {
  if (!dnaBuilder) {
    return { success: false, error: 'DNA collection not started' };
  }
  currentSessionDNA = dnaBuilder.finalize();
  return {
    success: true,
    vehicleCount: currentSessionDNA.size,
    summary: Array.from(currentSessionDNA.entries()).map(([num, dna]) => ({
      numero: num,
      sightings: dna.totalSightings,
      sponsors: dna.sponsors.length,
      piloti: dna.piloti.length,
      uniqueFeatures: dna.uniqueFeatures.length
    }))
  };
});

ipcMain.handle('dna:optimize-results', async (event, analysisResults: VehicleAnalysisData[]) => {
  if (!currentSessionDNA || currentSessionDNA.size === 0) {
    return { success: false, error: 'No DNA available. Run analysis first.' };
  }

  const matcher = new VehicleDNAMatcher(currentSessionDNA);
  const optimizations: any[] = [];

  for (const result of analysisResults) {
    // Skip se già ha alta confidence
    if (result.confidence > 0.9) continue;

    // Caso 1: Numero mancante o bassa confidence
    if (!result.raceNumber || result.confidence < 0.7) {
      const matches = matcher.matchByFeatures({
        drivers: result.drivers,
        sponsors: result.sponsors,
        team: result.team,
        liveryColor: result.liveryColor,
        manufacturer: result.manufacturer
      });

      if (matches.length > 0 && matches[0].score > 0.7) {
        optimizations.push({
          imageId: result.imageId,
          type: 'NUMBER_INFERRED',
          originalNumber: result.raceNumber,
          newNumber: matches[0].numero,
          confidence: matches[0].confidence,
          reasoning: matches[0].reasoning
        });
      }
    }

    // Caso 2: Numero presente ma verificare coerenza
    else {
      const verification = matcher.verifyNumberWithFeatures(
        result.raceNumber,
        {
          drivers: result.drivers,
          sponsors: result.sponsors,
          team: result.team,
          liveryColor: result.liveryColor
        }
      );

      if (!verification.isCoherent) {
        // Prova a trovare match migliore
        const altMatches = matcher.matchByFeatures({
          drivers: result.drivers,
          sponsors: result.sponsors,
          team: result.team
        });

        if (altMatches.length > 0 &&
            altMatches[0].numero !== result.raceNumber &&
            altMatches[0].score > 0.8) {
          optimizations.push({
            imageId: result.imageId,
            type: 'NUMBER_CORRECTED',
            originalNumber: result.raceNumber,
            newNumber: altMatches[0].numero,
            confidence: altMatches[0].confidence,
            reasoning: [`Incoerenza rilevata: ${verification.issues.join(', ')}`, ...altMatches[0].reasoning]
          });
        }
      }
    }
  }

  return {
    success: true,
    optimizationsCount: optimizations.length,
    optimizations
  };
});

ipcMain.handle('dna:export-as-preset', async () => {
  if (!currentSessionDNA || currentSessionDNA.size === 0) {
    return { success: false, error: 'No DNA available' };
  }

  // Converti DNA in formato preset partecipanti
  const participants = Array.from(currentSessionDNA.values()).map(dna => ({
    numero: dna.numero,
    // Driver names are stored via preset_participant_drivers table
    nome: dna.piloti.map(p => p.value).filter(Boolean).join(', '),
    preset_participant_drivers: dna.piloti.map((p, idx) => ({
      driver_name: p.value || '',
      driver_order: idx
    })).filter(d => d.driver_name),
    squadra: dna.team[0]?.value || '',
    sponsor: dna.sponsors.map(s => s.value).join(', '),
    categoria: dna.categoria || ''
  }));

  return {
    success: true,
    preset: {
      name: `Auto-Generated ${new Date().toISOString().split('T')[0]}`,
      participants,
      metadata: {
        generatedAt: new Date().toISOString(),
        vehicleCount: participants.length,
        source: 'vehicle-dna-auto'
      }
    }
  };
});
```

### 4.2 Preload Additions

**File da modificare**: `src/preload.ts`

```typescript
// Aggiungi all'oggetto electronAPI

dna: {
  startCollection: () => ipcRenderer.invoke('dna:start-collection'),
  addResult: (result: any, imageId: string) => ipcRenderer.invoke('dna:add-result', result, imageId),
  finalize: () => ipcRenderer.invoke('dna:finalize'),
  optimizeResults: (results: any[]) => ipcRenderer.invoke('dna:optimize-results', results),
  exportAsPreset: () => ipcRenderer.invoke('dna:export-as-preset')
}
```

---

## FASE 5: UI Frontend

### 5.1 Nuovo Bottone "Optimize Results"

**File**: `renderer/pages/analysis.html`

```html
<!-- Aggiungi dopo il bottone di analisi -->
<div id="optimize-section" class="hidden mt-4">
  <div class="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 rounded-lg p-4 border border-purple-500/20">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold text-purple-200">
          <span class="mr-2">🧬</span>Ottimizzazione DNA
        </h3>
        <p class="text-sm text-gray-400 mt-1">
          Migliora i risultati usando le evidenze aggregate (senza costi API)
        </p>
      </div>
      <button id="btn-optimize-results"
              class="px-6 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-colors">
        Optimize Results
      </button>
    </div>

    <!-- DNA Stats -->
    <div id="dna-stats" class="hidden mt-4 grid grid-cols-4 gap-4">
      <div class="bg-black/30 rounded-lg p-3 text-center">
        <div class="text-2xl font-bold text-purple-300" id="dna-vehicles">-</div>
        <div class="text-xs text-gray-500">Veicoli Rilevati</div>
      </div>
      <div class="bg-black/30 rounded-lg p-3 text-center">
        <div class="text-2xl font-bold text-blue-300" id="dna-sponsors">-</div>
        <div class="text-xs text-gray-500">Sponsor Unici</div>
      </div>
      <div class="bg-black/30 rounded-lg p-3 text-center">
        <div class="text-2xl font-bold text-green-300" id="dna-pilots">-</div>
        <div class="text-xs text-gray-500">Piloti Identificati</div>
      </div>
      <div class="bg-black/30 rounded-lg p-3 text-center">
        <div class="text-2xl font-bold text-yellow-300" id="dna-discriminants">-</div>
        <div class="text-xs text-gray-500">Feature Uniche</div>
      </div>
    </div>
  </div>
</div>
```

### 5.2 JavaScript Handler

**Nuovo file**: `renderer/js/dna-optimizer.js`

```javascript
/**
 * DNA Optimizer UI Handler
 */

class DNAOptimizer {
  constructor() {
    this.isOptimizing = false;
    this.dnaStats = null;
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('btn-optimize-results')?.addEventListener('click', () => {
      this.runOptimization();
    });
  }

  /**
   * Mostra sezione optimize dopo analisi completata
   */
  async showOptimizeSection(analysisResults) {
    const section = document.getElementById('optimize-section');
    if (!section) return;

    // Finalizza DNA e ottieni stats
    try {
      const result = await window.electronAPI.dna.finalize();
      if (result.success) {
        this.dnaStats = result.summary;
        this.updateStatsUI(result);
        section.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Failed to finalize DNA:', error);
    }
  }

  updateStatsUI(result) {
    document.getElementById('dna-vehicles').textContent = result.vehicleCount;

    const totalSponsors = result.summary.reduce((sum, v) => sum + v.sponsors, 0);
    document.getElementById('dna-sponsors').textContent = totalSponsors;

    const totalPilots = result.summary.reduce((sum, v) => sum + v.piloti, 0);
    document.getElementById('dna-pilots').textContent = totalPilots;

    const totalUnique = result.summary.reduce((sum, v) => sum + v.uniqueFeatures, 0);
    document.getElementById('dna-discriminants').textContent = totalUnique;

    document.getElementById('dna-stats').classList.remove('hidden');
  }

  async runOptimization() {
    if (this.isOptimizing) return;

    const btn = document.getElementById('btn-optimize-results');
    const originalText = btn.textContent;

    try {
      this.isOptimizing = true;
      btn.textContent = 'Optimizing...';
      btn.disabled = true;

      // Ottieni risultati correnti dalla pagina risultati
      const currentResults = window.resultsManager?.getAllResults() || [];

      const result = await window.electronAPI.dna.optimizeResults(currentResults);

      if (result.success && result.optimizationsCount > 0) {
        // Mostra modal con preview delle ottimizzazioni
        this.showOptimizationPreview(result.optimizations);
      } else {
        this.showNoOptimizationsMessage();
      }

    } catch (error) {
      console.error('Optimization failed:', error);
      this.showError(error.message);
    } finally {
      this.isOptimizing = false;
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  showOptimizationPreview(optimizations) {
    // Crea modal con lista ottimizzazioni proposte
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-gray-900 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
        <h2 class="text-xl font-bold mb-4">
          🧬 ${optimizations.length} Ottimizzazioni Proposte
        </h2>
        <div class="space-y-3" id="optimization-list">
          ${optimizations.map((opt, i) => `
            <div class="bg-gray-800 rounded-lg p-3 flex items-center gap-4">
              <input type="checkbox" id="opt-${i}" checked class="opt-checkbox">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-red-400 line-through">${opt.originalNumber || '???'}</span>
                  <span class="text-gray-500">→</span>
                  <span class="text-green-400 font-bold">${opt.newNumber}</span>
                  <span class="text-xs px-2 py-0.5 rounded bg-purple-900/50 text-purple-300">
                    ${(opt.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  ${opt.reasoning.slice(0, 2).join(' • ')}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="flex justify-end gap-3 mt-6">
          <button id="btn-cancel-opt" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg">
            Annulla
          </button>
          <button id="btn-apply-opt" class="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium">
            Applica Selezionate
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-cancel-opt').onclick = () => modal.remove();
    document.getElementById('btn-apply-opt').onclick = () => {
      const selected = Array.from(document.querySelectorAll('.opt-checkbox:checked'))
        .map((cb, i) => optimizations[i]);
      this.applyOptimizations(selected);
      modal.remove();
    };
  }

  applyOptimizations(optimizations) {
    // Aggiorna risultati nella UI
    for (const opt of optimizations) {
      window.resultsManager?.updateResult(opt.imageId, {
        raceNumber: opt.newNumber,
        optimizedBy: 'DNA',
        originalNumber: opt.originalNumber
      });
    }

    // Mostra conferma
    this.showSuccessMessage(`${optimizations.length} risultati ottimizzati!`);
  }

  showNoOptimizationsMessage() {
    // Toast o notifica che non ci sono ottimizzazioni disponibili
  }

  showError(message) {
    // Toast errore
  }

  showSuccessMessage(message) {
    // Toast successo
  }
}

// Export singleton
window.dnaOptimizer = new DNAOptimizer();
```

---

## FASE 6: Testing & Validation

### 6.1 Test Cases

```typescript
// tests/vehicle-dna.test.ts

describe('VehicleDNABuilder', () => {
  test('should aggregate sponsors correctly', () => {
    const builder = new VehicleDNABuilder();

    // Simula 10 foto della stessa auto
    for (let i = 0; i < 10; i++) {
      builder.addAnalysisResult({
        raceNumber: '16',
        sponsors: ['Shell', 'IBM', 'HP'],
        confidence: 0.9
      }, `img_${i}`);
    }

    // 1 foto con sponsor parziale
    builder.addAnalysisResult({
      raceNumber: '16',
      sponsors: ['Shell', 'HP'],  // IBM mancante
      confidence: 0.85
    }, 'img_10');

    const dnas = builder.finalize();
    const dna16 = dnas.get('16');

    expect(dna16.totalSightings).toBe(11);
    expect(dna16.sponsors.find(s => s.value === 'Shell').count).toBe(11);
    expect(dna16.sponsors.find(s => s.value === 'IBM').count).toBe(10);
    expect(dna16.sponsors.find(s => s.value === 'HP').count).toBe(11);
  });

  test('should identify unique sponsors as discriminants', () => {
    const builder = new VehicleDNABuilder();

    // Auto 16 con IBM (unico)
    builder.addAnalysisResult({
      raceNumber: '16',
      sponsors: ['Shell', 'IBM'],
      confidence: 0.9
    }, 'img_1');

    // Auto 23 senza IBM
    builder.addAnalysisResult({
      raceNumber: '23',
      sponsors: ['Shell', 'Pirelli'],
      confidence: 0.9
    }, 'img_2');

    const dnas = builder.finalize();
    const dna16 = dnas.get('16');

    expect(dna16.uniqueFeatures).toContainEqual({
      feature: 'sponsor',
      value: 'IBM',
      isGloballyUnique: true
    });
  });
});

describe('VehicleDNAMatcher', () => {
  test('should match by sponsors when number missing', () => {
    // Setup DNA database
    const dnas = new Map();
    dnas.set('16', {
      numero: '16',
      sponsors: [
        { value: 'Shell', count: 10, avgConfidence: 0.9 },
        { value: 'IBM', count: 10, avgConfidence: 0.9 }
      ],
      uniqueFeatures: [{ feature: 'sponsor', value: 'IBM', isGloballyUnique: true }],
      totalSightings: 10,
      piloti: [],
      team: [],
      // ... altri campi
    });

    const matcher = new VehicleDNAMatcher(dnas);

    // Foto senza numero ma con sponsor
    const results = matcher.matchByFeatures({
      sponsors: ['Shell', 'IBM']
    });

    expect(results[0].numero).toBe('16');
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  test('should detect contradictions', () => {
    const dnas = new Map();
    dnas.set('16', {
      numero: '16',
      sponsors: [{ value: 'Shell', count: 10, avgConfidence: 0.9 }],
      // ...
    });

    const matcher = new VehicleDNAMatcher(dnas);

    // Verifica con sponsor contraddittorio
    const verification = matcher.verifyNumberWithFeatures('16', {
      sponsors: ['Shell', 'Pirelli']  // Pirelli non appartiene a 16
    });

    expect(verification.isCoherent).toBe(false);
    expect(verification.issues).toContain(expect.stringContaining('Pirelli'));
  });
});
```

---

## Roadmap Implementazione

| Fase | Task | Priorità | Effort | Dipendenze |
|------|------|----------|--------|------------|
| 1.1 | Estendere prompt Gemini | Alta | 2h | - |
| 1.2 | Nuove interfacce TypeScript | Alta | 1h | - |
| 1.3 | Estendere VehicleAnalysisData | Alta | 1h | 1.2 |
| 2 | VehicleDNABuilder | Alta | 4h | 1.2, 1.3 |
| 3 | VehicleDNAMatcher | Alta | 4h | 2 |
| 4.1 | IPC Handlers | Media | 2h | 2, 3 |
| 4.2 | Preload extensions | Media | 30m | 4.1 |
| 5.1 | UI Optimize section | Media | 2h | - |
| 5.2 | dna-optimizer.js | Media | 3h | 5.1, 4.2 |
| 6 | Testing | Media | 3h | 2, 3 |

**Totale stimato**: ~22 ore (3 giorni lavorativi)

---

## Metriche di Successo

1. **Accuracy Improvement**: +10-15% su immagini con numero non leggibile
2. **Contradiction Detection**: >90% conflitti identificati
3. **Zero API Costs**: Optimize Results non chiama Gemini/RF-DETR
4. **UX**: <3s per ottimizzazione batch di 100 immagini

---

## Note Finali

- Il DNA è **session-scoped** (non persistito tra sessioni)
- L'export come preset permette di salvare il DNA per uso futuro
- Il sistema è **backward-compatible**: funziona anche senza le nuove feature del prompt
- I pesi sono **configurabili** per sport diversi
