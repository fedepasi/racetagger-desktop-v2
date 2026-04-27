# RaceTagger Desktop - Piano di Refactoring e Ottimizzazioni SOTA

> Documento generato da analisi approfondita del codebase (Dicembre 2025)

---

## Indice

1. [Stato Attuale del Codebase](#1-stato-attuale-del-codebase)
2. [Refactoring main.ts](#2-refactoring-maints)
3. [Ottimizzazioni SOTA](#3-ottimizzazioni-sota)
4. [V6 Edge Function - Ottimizzazione Completa](#4-v6-edge-function---ottimizzazione-completa)
5. [Piano di Implementazione](#5-piano-di-implementazione)

---

## 1. Stato Attuale del Codebase

### Metriche Chiave

| Componente | Stato | Problema |
|------------|-------|----------|
| `main.ts` | 235 KB, 6,967 righe | Monolitico, 124 IPC handlers inline |
| `unified-image-processor.ts` | 4,822 righe | Classe gigante, responsabilità mixed |
| `smart-matcher.ts` | 2,353 righe | Troppo complesso, difficile da testare |
| `temporal-clustering.ts` | 899 righe | ExifTool spawn per ogni immagine |
| Frontend | 20,536 righe JS | 702 console.log, no module system |

### Dipendenze Principali

```
main.ts (HUB)
├── auth-service.ts (1,331 righe) - Autenticazione Supabase
├── database-service.ts (3,200 righe) - SQLite + Supabase sync
├── unified-image-processor.ts - Pipeline elaborazione
│   ├── SmartMatcher - Matching partecipanti
│   ├── TemporalClusterManager - Burst detection
│   ├── AnalysisLogger - JSONL logging
│   └── CropContextExtractor - V6 crops
└── config.ts (26 KB) - Configurazione app
```

---

## 2. Refactoring main.ts

### 2.1 Problema

`main.ts` contiene **124 IPC handlers** definiti inline, violando il Single Responsibility Principle.

```typescript
// ATTUALE: Tutto in main.ts (anti-pattern)
ipcMain.handle('db-create-project', async (_, data) => { ... });
ipcMain.handle('db-get-projects', async (_) => { ... });
// ... 122 altri handler
```

### 2.2 Soluzione: Architettura Modulare

```
src/
├── main.ts                    # Solo lifecycle (~500 righe)
├── ipc/
│   ├── index.ts               # Registra tutti i moduli
│   ├── handler-factory.ts     # Factory per ridurre boilerplate
│   ├── auth-handlers.ts       # 15 handler
│   ├── database-handlers.ts   # 45 handler
│   ├── supabase-handlers.ts   # 20 handler
│   ├── export-handlers.ts     # 15 handler
│   ├── image-handlers.ts      # 12 handler
│   ├── file-handlers.ts       # 10 handler
│   └── window-handlers.ts     # 7 handler
└── ...
```

### 2.3 Implementazione Handler Factory

```typescript
// src/ipc/handler-factory.ts
import { ipcMain, IpcMainInvokeEvent } from 'electron';

type HandlerResult<T> = { success: true; data: T } | { success: false; error: string };

export function createHandler<TInput, TOutput>(
  channel: string,
  handler: (data: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>
): void {
  ipcMain.handle(channel, async (event, data: TInput): Promise<HandlerResult<TOutput>> => {
    try {
      const result = await handler(data, event);
      return { success: true, data: result };
    } catch (error: any) {
      console.error(`[IPC ${channel}] Error:`, error.message);
      return { success: false, error: error.message };
    }
  });
}

// Esempio di utilizzo
// src/ipc/database-handlers.ts
import { createHandler } from './handler-factory';
import { databaseService } from '../database-service';

export function registerDatabaseHandlers(): void {
  createHandler('db-create-project', async (data: CreateProjectInput) => {
    return databaseService.createProject(data);
  });

  createHandler('db-get-projects', async () => {
    return databaseService.getProjects();
  });

  // ... altri 43 handler
}
```

### 2.4 Nuovo main.ts (Target: ~500 righe)

```typescript
// src/main.ts - DOPO REFACTORING
import { app, BrowserWindow } from 'electron';
import { registerAllHandlers } from './ipc';
import { initializeServices } from './services';
import { createMainWindow } from './window';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  // 1. Initialize services
  await initializeServices();

  // 2. Register all IPC handlers
  registerAllHandlers();

  // 3. Create window
  mainWindow = await createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

---

## 3. Ottimizzazioni SOTA

### 3.1 Batch ExifTool Processing

**Problema Attuale**: 100 immagini = 100 spawn ExifTool = ~10 secondi

```typescript
// temporal-clustering.ts - LENTO
for (const file of files) {
  const result = await execAsync(`exiftool -DateTimeOriginal "${file}"`);
  timestamps.push(parseTimestamp(result));
}
```

**Soluzione SOTA**: Batch processing con file list

```typescript
// temporal-clustering.ts - OTTIMIZZATO
import { promises as fs } from 'fs';
import { execAsync } from './exec-utils';
import { tmpdir } from 'os';
import { join } from 'path';

interface TimestampResult {
  SourceFile: string;
  DateTimeOriginal?: string;
  CreateDate?: string;
  FileModifyDate: string;
}

export async function batchExtractTimestamps(files: string[]): Promise<Map<string, Date>> {
  const timestamps = new Map<string, Date>();

  if (files.length === 0) return timestamps;

  // Crea file temporaneo con lista file
  const listFile = join(tmpdir(), `exiftool-list-${Date.now()}.txt`);
  await fs.writeFile(listFile, files.join('\n'));

  try {
    // Single ExifTool call per tutti i file
    const { stdout } = await execAsync(
      `exiftool -@ "${listFile}" -DateTimeOriginal -CreateDate -FileModifyDate -json`,
      { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer per grandi batch
    );

    const results: TimestampResult[] = JSON.parse(stdout);

    for (const result of results) {
      const dateStr = result.DateTimeOriginal || result.CreateDate || result.FileModifyDate;
      const date = parseExifDate(dateStr);
      if (date) {
        timestamps.set(result.SourceFile, date);
      }
    }
  } finally {
    // Cleanup
    await fs.unlink(listFile).catch(() => {});
  }

  return timestamps;
}

function parseExifDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Format: "2024:12:15 14:30:25"
  const normalized = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const date = new Date(normalized);
  return isNaN(date.getTime()) ? null : date;
}
```

**Impatto**: 10-50x più veloce (1 spawn invece di 100)

### 3.2 SmartMatcher Early Exit

**Problema**: Full ranking anche quando match è già al 100%

```typescript
// smart-matcher.ts - OTTIMIZZATO
export class SmartMatcher {
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.95;

  async matchParticipant(
    recognizedNumber: string,
    imageContext: ImageContext,
    candidates: Participant[]
  ): Promise<MatchResult> {

    // Sort candidates by likelihood (numero esatto prima)
    const sortedCandidates = this.sortByLikelihood(recognizedNumber, candidates);

    let bestMatch: MatchResult | null = null;

    for (const candidate of sortedCandidates) {
      const score = await this.calculateScore(recognizedNumber, candidate, imageContext);

      if (!bestMatch || score.confidence > bestMatch.confidence) {
        bestMatch = {
          participant: candidate,
          confidence: score.confidence,
          evidence: score.evidence
        };
      }

      // EARLY EXIT: Se confidence > 95%, non serve continuare
      if (bestMatch.confidence >= this.HIGH_CONFIDENCE_THRESHOLD) {
        console.log(`[SmartMatcher] Early exit: ${recognizedNumber} → ${candidate.numero} (${(bestMatch.confidence * 100).toFixed(1)}%)`);
        break;
      }
    }

    return bestMatch!;
  }

  private sortByLikelihood(number: string, candidates: Participant[]): Participant[] {
    return [...candidates].sort((a, b) => {
      // Exact match first
      if (a.numero === number) return -1;
      if (b.numero === number) return 1;
      // Then by Levenshtein distance
      return this.levenshtein(a.numero || '', number) -
             this.levenshtein(b.numero || '', number);
    });
  }
}
```

**Impatto**: 2-3x più veloce per match ovvi

### 3.3 Memory Pool con Tolerance Bands

**Problema**: Pool richiede exact size match, molti miss

```typescript
// memory-pool.ts - OTTIMIZZATO
export class MemoryPoolManager {
  private readonly TOLERANCE = 0.1; // ±10%

  private pools: Map<string, Buffer[]> = new Map();
  private readonly SIZE_BUCKETS = [
    1920 * 1080 * 3,   // HD
    2560 * 1440 * 3,   // QHD
    3840 * 2160 * 3,   // 4K
    7680 * 4320 * 3    // 8K
  ];

  acquireBuffer(minSize: number): Buffer {
    // Trova il bucket più piccolo che soddisfa minSize
    const bucketSize = this.findBucket(minSize);
    const pool = this.pools.get(String(bucketSize));

    if (pool && pool.length > 0) {
      this.stats.hits++;
      return pool.pop()!;
    }

    this.stats.misses++;
    return Buffer.allocUnsafe(bucketSize);
  }

  private findBucket(size: number): number {
    // Trova il bucket più piccolo >= size
    for (const bucket of this.SIZE_BUCKETS) {
      if (bucket >= size) return bucket;
    }
    // Se nessun bucket, usa il prossimo multiplo di 1MB
    return Math.ceil(size / (1024 * 1024)) * 1024 * 1024;
  }

  releaseBuffer(buffer: Buffer): void {
    const bucketSize = this.findBucket(buffer.length);

    // Rilascia solo se nel range del bucket (±tolerance)
    if (buffer.length >= bucketSize * (1 - this.TOLERANCE) &&
        buffer.length <= bucketSize * (1 + this.TOLERANCE)) {
      const pool = this.pools.get(String(bucketSize)) || [];
      if (pool.length < 10) { // Max 10 buffer per bucket
        pool.push(buffer);
        this.pools.set(String(bucketSize), pool);
      }
    }
  }
}
```

**Impatto**: Hit rate da ~60% a ~90%

---

## 4. V6 Edge Function - Ottimizzazione Completa

### 4.1 Stato Attuale V6

**File**: `supabase/functions/analyzeImageDesktopV6/index.ts`

**Caratteristiche**:
- Multi-image crop analysis
- Context negative per sponsor/team detection
- Gemini 3 Flash con thinkingLevel=MINIMAL
- Costo: ~$0.50/M input + $3.00/M output tokens

**Problemi Identificati**:
1. Prompt troppo verbose (riduce throughput)
2. Nessun caching per participant preset
3. No parallel processing per multiple crops
4. Cost tracking limitato

### 4.2 Prompt Engineering Ottimizzato

**ATTUALE** (~600 tokens):
```typescript
const prompt = `Sei un esperto di fotografia sportiva e motorsport.
Stai analizzando ${cropCount} immagine/i ritagliate di veicoli/atleti da gara...
[lungo prompt con istruzioni dettagliate]`;
```

**OTTIMIZZATO** (~300 tokens):
```typescript
function generateOptimizedPrompt(
  cropCount: number,
  hasNegative: boolean,
  participants?: ParticipantInfo[]
): string {
  // Prompt più conciso ma efficace
  const base = `Analizza ${cropCount} crop di gara. Per ogni crop identifica:
- raceNumber (string|null)
- confidence (0-1)
- drivers (array)
- teamName (string|null)`;

  const context = hasNegative
    ? `\n\nImg ${cropCount + 1} è contesto (soggetti mascherati). Identifica:
- sponsors, altriNumeri, categoria, coloriTeam`
    : '';

  const preset = participants?.length
    ? `\n\nPartecipanti: ${participants.map(p =>
        `#${p.numero}:${p.nome || ''}${p.squadra ? `(${p.squadra})` : ''}`
      ).join(', ')}`
    : '';

  return `${base}${context}${preset}

Output JSON: {"crops":[{imageIndex,raceNumber,confidence,drivers,teamName}]${hasNegative ? ',"context":{sponsors,altriNumeri,categoria,coloriTeam}' : ''}}`;
}
```

**Risparmio**: ~50% token input, stessa qualità output

### 4.3 Response Caching

```typescript
// Crea cache per participant preset parsing
const PRESET_CACHE = new Map<string, ParticipantInfo[]>();

function getCachedPreset(presetId: string, raw: any): ParticipantInfo[] {
  if (PRESET_CACHE.has(presetId)) {
    return PRESET_CACHE.get(presetId)!;
  }

  const parsed = parseParticipantPreset(raw);
  PRESET_CACHE.set(presetId, parsed);

  // Limit cache size
  if (PRESET_CACHE.size > 100) {
    const firstKey = PRESET_CACHE.keys().next().value;
    PRESET_CACHE.delete(firstKey);
  }

  return parsed;
}
```

### 4.4 Chunked Processing per Multiple Crops

```typescript
const MAX_CROPS_PER_REQUEST = 4; // Ottimale per latency

async function processLargeBatch(
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string
): Promise<CropAnalysisResult[]> {

  if (crops.length <= MAX_CROPS_PER_REQUEST) {
    // Singola richiesta
    return analyzeWithGemini(crops, negative, prompt);
  }

  // Chunk processing
  const results: CropAnalysisResult[] = [];
  const chunks = chunkArray(crops, MAX_CROPS_PER_REQUEST);

  // Process chunks in parallel (max 2 concurrent)
  const CONCURRENCY = 2;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((chunk, idx) =>
        analyzeWithGemini(
          chunk,
          idx === 0 ? negative : undefined, // Context solo per primo chunk
          generateOptimizedPrompt(chunk.length, idx === 0 && !!negative)
        )
      )
    );
    results.push(...batchResults.flat());
  }

  return results;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size)
  );
}
```

### 4.5 Enhanced Cost Tracking

```typescript
interface V6Metrics {
  // Existing
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;

  // New: Granular tracking
  cropsAnalyzed: number;
  hasContextImage: boolean;
  chunksProcessed: number;

  // Per-crop metrics
  avgTokensPerCrop: number;
  avgCostPerCrop: number;

  // Performance
  inferenceTimeMs: number;
  avgTimePerCrop: number;

  // Model config used
  modelVersion: string;
  thinkingLevel: string;
  mediaResolution: string;
}

function calculateEnhancedMetrics(
  crops: CropData[],
  hasNegative: boolean,
  inputTokens: number,
  outputTokens: number,
  inferenceTimeMs: number,
  chunksProcessed: number
): V6Metrics {
  const INPUT_COST = 0.50 / 1_000_000;
  const OUTPUT_COST = 3.00 / 1_000_000;

  const totalCost = (inputTokens * INPUT_COST) + (outputTokens * OUTPUT_COST);

  return {
    inputTokens,
    outputTokens,
    estimatedCostUSD: totalCost,
    cropsAnalyzed: crops.length,
    hasContextImage: hasNegative,
    chunksProcessed,
    avgTokensPerCrop: Math.round((inputTokens + outputTokens) / crops.length),
    avgCostPerCrop: totalCost / crops.length,
    inferenceTimeMs,
    avgTimePerCrop: Math.round(inferenceTimeMs / crops.length),
    modelVersion: DEFAULT_MODEL,
    thinkingLevel: THINKING_LEVEL,
    mediaResolution: MEDIA_RESOLUTION
  };
}
```

### 4.6 V6 Configuration Interface

```typescript
// Nuova configurazione flessibile
interface V6Config {
  // Processing
  maxCropsPerRequest: number;      // Default: 4
  maxConcurrentChunks: number;     // Default: 2
  contextImageEnabled: boolean;    // Default: true

  // Model
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  mediaResolution: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA_HIGH';

  // Timeouts
  requestTimeoutMs: number;        // Default: 60000

  // Caching
  enablePresetCache: boolean;      // Default: true
  maxCacheSize: number;            // Default: 100
}

const DEFAULT_V6_CONFIG: V6Config = {
  maxCropsPerRequest: 4,
  maxConcurrentChunks: 2,
  contextImageEnabled: true,
  thinkingLevel: 'MINIMAL',
  mediaResolution: 'ULTRA_HIGH',
  requestTimeoutMs: 60000,
  enablePresetCache: true,
  maxCacheSize: 100
};

// Può essere overridden da sport_categories.v6_config
function getV6Config(sportCategory?: SportCategory): V6Config {
  if (sportCategory?.v6_config) {
    return { ...DEFAULT_V6_CONFIG, ...sportCategory.v6_config };
  }
  return DEFAULT_V6_CONFIG;
}
```

### 4.7 Benchmark Target V6

| Metrica | Attuale | Target | Miglioramento |
|---------|---------|--------|---------------|
| Token per crop | ~800 | ~400 | -50% |
| Costo per crop | ~$0.003 | ~$0.0015 | -50% |
| Latency (4 crops) | ~3s | ~2s | -33% |
| Latency (10 crops) | ~8s | ~4s | -50% |
| Throughput | 10 img/min | 20 img/min | +100% |

---

## 5. Piano di Implementazione

### Fase 1: IPC Modularization (2-3 giorni)

1. Creare `src/ipc/handler-factory.ts`
2. Estrarre handler in moduli separati
3. Aggiornare `main.ts` per usare nuovo sistema
4. Test: Verificare tutti i 124 handler funzionanti

### Fase 2: SOTA Optimizations (2-3 giorni)

1. Implementare batch ExifTool in `temporal-clustering.ts`
2. Aggiungere early exit in `smart-matcher.ts`
3. Migliorare `memory-pool.ts` con tolerance bands
4. Benchmark: Misurare miglioramenti performance

### Fase 3: V6 Optimization (2-3 giorni)

1. Ottimizzare prompt generation
2. Implementare preset caching
3. Aggiungere chunked processing
4. Enhanced cost tracking
5. Deploy e test su Supabase

### Fase 4: Testing & Documentation (1-2 giorni)

1. Unit test per nuovi moduli IPC
2. Integration test per pipeline
3. Performance benchmark report
4. Aggiornare CLAUDE.md

---

## Appendice: File da Modificare

| File | Modifiche | Priorità |
|------|-----------|----------|
| `src/main.ts` | Estrarre handler, snellire | ALTA |
| `src/ipc/*.ts` | Creare nuovi moduli | ALTA |
| `src/utils/temporal-clustering.ts` | Batch ExifTool | ALTA |
| `src/matching/smart-matcher.ts` | Early exit | MEDIA |
| `src/utils/memory-pool.ts` | Tolerance bands | BASSA |
| `supabase/functions/analyzeImageDesktopV6/index.ts` | Tutte le ottimizzazioni V6 | ALTA |

---

*Documento creato: Dicembre 2025*
*Ultima analisi codebase: v1.0.10*
