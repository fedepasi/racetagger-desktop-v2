# RaceTagger - Roadmap verso SOTA e Leadership di Mercato

> Documento strategico per l'evoluzione di RaceTagger da tool fotografico a piattaforma leader nel settore race photography.

---

## Indice

1. [Vision](#1-vision)
2. [Gap Analysis](#2-gap-analysis)
3. [Feature Dettagliate](#3-feature-dettagliate)
4. [Prioritizzazione](#4-prioritizzazione)
5. [Roadmap Temporale](#5-roadmap-temporale)
6. [Metriche di Successo](#6-metriche-di-successo)

---

## 1. Vision

### Stato Attuale
RaceTagger è un **tool desktop per fotografi** che automatizza il riconoscimento numeri di gara e il tagging delle foto.

### Vision SOTA
RaceTagger diventa una **piattaforma end-to-end per la fotografia sportiva** che:
- Analizza foto in tempo reale durante gli eventi
- Funziona offline con AI on-device
- Abilita la vendita diretta ai partecipanti
- Supporta workflow multi-fotografo
- Si espande oltre il racing a tutti gli sport

### Differenziazione Competitiva
| Competitor | Focus | Limitazioni |
|------------|-------|-------------|
| PhotoShelter | Storage/vendita | No AI recognition |
| SmugMug | Portfolio/vendita | Manual tagging |
| Capturelife | Youth sports | No racing support |
| **RaceTagger** | AI + Workflow + Sales | Full stack solution |

---

## 2. Gap Analysis

### Cosa Abbiamo
- ✅ AI recognition (Gemini + RF-DETR)
- ✅ Batch processing efficiente
- ✅ Participant matching avanzato
- ✅ Temporal clustering
- ✅ Multi-format support (RAW, JPEG)
- ✅ Metadata writing (XMP, EXIF)

### Cosa Manca per SOTA

| Area | Gap | Impatto Business |
|------|-----|------------------|
| Edge AI | Solo cloud | Dipendenza internet, costi API |
| Real-time | Solo post-processing | Perdiamo eventi live |
| Collaboration | Single user | No team/agenzie |
| Monetization | Solo export | No revenue per fotografo |
| Mobile | Solo desktop | No field workflow |
| Multi-sport | Focus racing | Mercato limitato |
| Platform | App chiusa | No ecosystem |

---

## 3. Feature Dettagliate

### 3.1 On-Device AI (Edge Inference)

**Problema**: Ogni analisi richiede internet e costa ~$0.003/foto

**Soluzione**: Inferenza locale con modelli ottimizzati

```
Architettura Target:
┌─────────────────────────────────────────────┐
│              RaceTagger Desktop              │
├─────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐           │
│  │  ONNX RT    │  │  CoreML     │  ← Apple  │
│  │  (Windows)  │  │  (macOS)    │    Silicon│
│  └─────────────┘  └─────────────┘           │
│         │                │                   │
│         └────────┬───────┘                   │
│                  ▼                           │
│       ┌──────────────────┐                  │
│       │  Unified Model   │                  │
│       │    Interface     │                  │
│       └──────────────────┘                  │
│                  │                           │
│    ┌─────────────┼─────────────┐            │
│    ▼             ▼             ▼            │
│ ┌──────┐   ┌──────────┐   ┌────────┐       │
│ │Number│   │  Object  │   │  OCR   │       │
│ │Detect│   │Detection │   │ Model  │       │
│ └──────┘   └──────────┘   └────────┘       │
└─────────────────────────────────────────────┘
```

**Modelli da Convertire**:
- RF-DETR → ONNX (già iniziato in `ml-training/`)
- PaddleOCR → ONNX per fallback OCR
- Custom number detector fine-tuned su racing

**Benefici**:
- Zero costi API per analisi
- Funziona offline (eventi in zone remote)
- Latenza < 100ms vs 2-3s cloud
- Privacy: immagini mai lasciano il device

**Effort**: 3-4 settimane
**Files coinvolti**: `src/local-inference/`, nuovo modulo

---

### 3.2 Real-Time Live Event Mode

**Problema**: I fotografi processano dopo l'evento, perdendo opportunità di vendita immediata

**Soluzione**: Analisi durante lo shooting con tethering

```
Live Event Flow:
┌─────────┐    USB/WiFi    ┌─────────────┐
│  Camera │ ──────────────▶│  RaceTagger │
└─────────┘                │  Live Mode  │
                           └──────┬──────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        ┌──────────┐       ┌──────────┐       ┌──────────┐
        │ Instant  │       │  Live    │       │  Auto    │
        │ Preview  │       │ Tagging  │       │ Upload   │
        └──────────┘       └──────────┘       └──────────┘
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  ▼
                         ┌──────────────┐
                         │   D2P Sales  │
                         │   Platform   │
                         └──────────────┘
```

**Funzionalità**:
- Watch folder per nuove foto
- Analisi immediata (< 2s con Edge AI)
- Dashboard live per organizzatori
- Notifiche push ai partecipanti

**Tethering Support**:
- Canon EOS Utility SDK
- Nikon Camera Control Pro 2
- Sony Imaging Edge
- Generic PTP/MTP

**Effort**: 4-6 settimane
**Files coinvolti**: `src/live-mode/`, `renderer/pages/live.html`

---

### 3.3 Multi-Photographer Collaboration

**Problema**: Grandi eventi richiedono più fotografi, nessuna coordinazione

**Soluzione**: Workspace condiviso con sync real-time

```
Collaboration Architecture:
┌─────────────────────────────────────────────────────┐
│                   Supabase Realtime                  │
└─────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐
    │ Photo 1 │   │ Photo 2 │   │ Photo 3 │
    │ (Start) │   │ (Finish)│   │ (Podium)│
    └─────────┘   └─────────┘   └─────────┘
         │              │              │
         └──────────────┼──────────────┘
                        ▼
              ┌──────────────────┐
              │  Unified Event   │
              │    Database      │
              └──────────────────┘
```

**Features**:
- Workspace condivisi per evento
- Assegnazione zone automatica
- Merge intelligente sessioni
- Conflict resolution (stesso soggetto, foto diverse)
- Activity feed real-time
- Chat integrata

**Database Schema Additions**:
```sql
-- Workspaces
CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  event_date DATE,
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace members
CREATE TABLE workspace_members (
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),
  role TEXT CHECK (role IN ('owner', 'editor', 'viewer')),
  zone TEXT, -- Assigned zone
  PRIMARY KEY (workspace_id, user_id)
);

-- Real-time sync
CREATE TABLE workspace_activities (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),
  action TEXT, -- 'upload', 'tag', 'export'
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Effort**: 6-8 settimane
**Files coinvolti**: `src/collaboration/`, `supabase/migrations/`

---

### 3.4 Direct-to-Participant Sales (D2P) 🌟

**Problema**: I fotografi vendono manualmente, processo lento e inefficiente

**Soluzione**: Marketplace integrato con acquisto immediato

```
D2P Sales Flow:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Participant│     │  QR Code    │     │  Purchase   │
│  at Event   │ ──▶ │  on Number  │ ──▶ │  Page       │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │  Stripe     │
                                        │  Checkout   │
                                        └──────┬──────┘
                                               │
                         ┌─────────────────────┼─────────────────────┐
                         ▼                     ▼                     ▼
                  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
                  │  Instant    │       │  Download   │       │  Revenue    │
                  │  Delivery   │       │  Hi-Res     │       │  Split      │
                  └─────────────┘       └─────────────┘       └─────────────┘
```

**Componenti**:

1. **QR Code Generator**
   - QR stampato sul numero di gara
   - Link: `racetagger.com/event/{event_id}/participant/{number}`
   - Mostra tutte le foto di quel numero

2. **Storefront**
   - Gallery filtrata per partecipante
   - Preview watermarked
   - Pacchetti: singola, bundle, tutto l'evento
   - Pricing flessibile per fotografo

3. **Payment Processing**
   - Stripe Connect per split payments
   - Revenue: 80% fotografo, 20% piattaforma
   - Pagamenti istantanei o settimanali

4. **Delivery System**
   - Download immediato post-pagamento
   - Link temporanei sicuri
   - Opzione stampa (integrazione lab)

**Pricing Suggerito**:
| Prodotto | Prezzo | Revenue Fotografo |
|----------|--------|-------------------|
| Singola foto digitale | €5-15 | €4-12 |
| Bundle 5 foto | €25-50 | €20-40 |
| Tutte le foto evento | €50-150 | €40-120 |
| Stampa 20x30 | €25 | €15 |

**Business Impact**:
- Trasforma RaceTagger da **costo** a **generatore di revenue**
- Fotografo medio evento: 500 partecipanti × 10% conversion × €20 = **€1,000/evento**
- Platform revenue: €200/evento × 1000 eventi/anno = **€200,000/anno**

**Effort**: 8-10 settimane
**Files coinvolti**: `racetagger-storefront/` (nuovo progetto), `supabase/functions/`

---

### 3.5 Multi-Sport Expansion

**Problema**: Mercato racing è nicchia, limitato scalabilità

**Soluzione**: Adattare AI per altri sport

```
Sport Support Matrix:
┌─────────────────┬──────────────┬────────────────┬─────────────┐
│      Sport      │  Identifier  │   AI Model     │  Complexity │
├─────────────────┼──────────────┼────────────────┼─────────────┤
│ Motorsport      │ Race number  │ RF-DETR + OCR  │ ✅ Done     │
│ Running/Trail   │ Bib number   │ RF-DETR + OCR  │ ✅ Done     │
│ Cycling         │ Bib + bike # │ RF-DETR + OCR  │ 🟡 Medium   │
│ Swimming        │ Cap number   │ Custom model   │ 🟡 Medium   │
│ Team Sports     │ Jersey #     │ Pose + OCR     │ 🔴 High     │
│ Corporate       │ Badge/QR     │ QR detection   │ 🟢 Easy     │
│ Weddings        │ Face cluster │ Face embedding │ 🔴 High     │
└─────────────────┴──────────────┴────────────────┴─────────────┘
```

**Per ogni sport**:
1. Training data collection
2. Fine-tune RF-DETR
3. Sport-specific prompts per Gemini
4. UI adaptations
5. Participant data format

**Quick Wins (già quasi supportati)**:
- Ciclismo (stesso sistema numeri)
- Triathlon (multi-discipline)
- Sci/Snowboard (numeri gara)

**Effort**: 2-4 settimane per sport
**Files coinvolti**: `src/sport-adapters/`, `sport_categories` table

---

### 3.6 AI Quality Scoring & Auto-Culling

**Problema**: Fotografi spendono ore a selezionare le foto migliori

**Soluzione**: AI che valuta e pre-seleziona

```
Quality Scoring Pipeline:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Image     │ ──▶ │  Quality    │ ──▶ │   Score     │
│   Input     │     │  Analyzer   │     │   Output    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌───────────┐    ┌───────────┐    ┌───────────┐
   │ Technical │    │Composition│    │  Action   │
   │  Quality  │    │  Score    │    │  Score    │
   └───────────┘    └───────────┘    └───────────┘
   - Sharpness      - Rule of 3rds   - Peak action
   - Exposure       - Framing        - Expression
   - Noise          - Background     - Motion blur
   - Focus          - Leading lines  - Timing
```

**Scoring Dimensions**:
| Dimension | Weight | Detection Method |
|-----------|--------|------------------|
| Sharpness | 25% | Laplacian variance |
| Exposure | 20% | Histogram analysis |
| Composition | 20% | ML model |
| Action/Timing | 20% | Pose + motion |
| Face/Expression | 15% | Face detection |

**Auto-Culling Rules**:
```typescript
interface CullingRules {
  // Eliminazione automatica
  autoReject: {
    sharpnessBelow: 0.3,      // Troppo sfocata
    exposureOutside: [-2, 2], // EV stops
    duplicateThreshold: 0.95, // Similarity
    faceBlurred: true,        // Volto non nitido
  };

  // Selezione automatica
  autoSelect: {
    overallScoreAbove: 0.85,  // Top quality
    actionScoreAbove: 0.9,    // Peak moment
    uniqueInBurst: true,      // Best of burst
  };
}
```

**UI Integration**:
- Star rating automatico (1-5)
- "Best picks" automatici
- Filtro per qualità
- Prima/dopo comparison

**Effort**: 4-5 settimane
**Files coinvolti**: `src/quality-scoring/`, `renderer/js/quality-filter.js`

---

### 3.7 Public API & Developer Platform

**Problema**: RaceTagger è un'app chiusa, no integrazioni

**Soluzione**: API pubblica per ecosystem

```
API Architecture:
┌─────────────────────────────────────────────────────┐
│                  RaceTagger API                      │
│                  api.racetagger.com                  │
├─────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│  │  Auth   │  │ Analysis│  │  Events │  │ Export │ │
│  │  /auth  │  │/analyze │  │ /events │  │/export │ │
│  └─────────┘  └─────────┘  └─────────┘  └────────┘ │
└─────────────────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │ Lightroom │  │  Custom   │  │  Agency   │
   │  Plugin   │  │   Apps    │  │  Systems  │
   └───────────┘  └───────────┘  └───────────┘
```

**Endpoints Principali**:
```yaml
# Authentication
POST /auth/token          # Get API token
POST /auth/refresh        # Refresh token

# Analysis
POST /analyze/image       # Analyze single image
POST /analyze/batch       # Analyze batch (async)
GET  /analyze/job/{id}    # Get job status

# Events
POST /events              # Create event
GET  /events/{id}         # Get event details
POST /events/{id}/images  # Upload images

# Participants
POST /events/{id}/participants  # Import participants
GET  /events/{id}/participants  # List participants

# Results
GET  /events/{id}/results       # Get all results
GET  /images/{id}/metadata      # Get image metadata

# Export
POST /export/xmp          # Generate XMP sidecars
POST /export/csv          # Export to CSV
```

**SDK per Integrazioni**:
```typescript
// JavaScript/TypeScript SDK
import { RaceTagger } from '@racetagger/sdk';

const rt = new RaceTagger({ apiKey: 'rt_xxx' });

// Analyze images
const results = await rt.analyze.batch({
  images: ['photo1.jpg', 'photo2.jpg'],
  participants: csvData,
  options: { category: 'motorsport' }
});

// Get results
for (const result of results) {
  console.log(`${result.filename}: #${result.raceNumber}`);
}
```

**Lightroom Plugin**:
- Analyze selected photos
- Write keywords from results
- Batch rename with race numbers
- Export presets

**Pricing API**:
| Tier | Requests/month | Price |
|------|----------------|-------|
| Free | 100 | €0 |
| Starter | 5,000 | €49/mo |
| Pro | 25,000 | €149/mo |
| Enterprise | Unlimited | Custom |

**Effort**: 6-8 settimane
**Files coinvolti**: `racetagger-api/` (nuovo progetto), docs

---

### 3.8 Mobile Companion App

**Problema**: Fotografi in campo non possono usare desktop

**Soluzione**: App iOS/Android per field workflow

```
Mobile App Features:
┌─────────────────────────────────────────────┐
│            RaceTagger Mobile                 │
├─────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────────┐ │
│  │ Quick   │  │  Voice  │  │    GPS      │ │
│  │ Preview │  │ Tagging │  │ Correlation │ │
│  └─────────┘  └─────────┘  └─────────────┘ │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────────┐ │
│  │  Sync   │  │  Live   │  │   Offline   │ │
│  │ Desktop │  │  Feed   │  │    Mode     │ │
│  └─────────┘  └─────────┘  └─────────────┘ │
└─────────────────────────────────────────────┘
```

**Core Features**:
1. **Quick Preview**: Vedere anteprime foto dalla camera
2. **Voice Tagging**: "Foto 234, pilota Rossi, curva 3"
3. **GPS Correlation**: Auto-tag location sul tracciato
4. **Sync**: Push tags al desktop per merge
5. **Live Feed**: Vedere attività altri fotografi
6. **Offline**: Funziona senza internet

**Tech Stack**:
- React Native (cross-platform)
- SQLite locale per offline
- Supabase Realtime per sync
- Whisper per voice recognition

**Effort**: 8-10 settimane
**Repository**: `racetagger-mobile/` (nuovo progetto)

---

### 3.9 Video Frame Analysis

**Problema**: Action cam/video ignorati, solo foto

**Soluzione**: Estrazione intelligente frame da video

```
Video Processing Pipeline:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Video     │ ──▶ │   Frame     │ ──▶ │   Best      │
│   Input     │     │  Extraction │     │   Frames    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌───────────┐    ┌───────────┐    ┌───────────┐
   │  Scene    │    │  Subject  │    │  Quality  │
   │  Change   │    │  Tracking │    │  Filter   │
   └───────────┘    └───────────┘    └───────────┘
```

**Supported Formats**:
- MP4, MOV, AVI (4K/8K)
- GoPro raw
- DJI drone footage
- iPhone ProRes

**Extraction Logic**:
```typescript
interface VideoExtractionConfig {
  // Detection
  sceneChangeThreshold: 0.3;    // Detect new scenes
  subjectTrackingEnabled: true; // Track subjects

  // Quality
  minSharpness: 0.5;            // Skip blurry frames
  minResolution: [1920, 1080];  // Min frame size

  // Sampling
  maxFramesPerSecond: 5;        // Don't over-extract
  burstDuration: 0.5;           // Seconds around action

  // Output
  outputFormat: 'jpg';
  outputQuality: 95;
}
```

**Effort**: 5-6 settimane
**Files coinvolti**: `src/video-processor/`, ffmpeg integration

---

### 3.10 Analytics Dashboard per Organizzatori (B2B)

**Problema**: Organizzatori non hanno visibilità sulla copertura fotografica

**Soluzione**: Dashboard B2B con analytics

```
Organizer Dashboard:
┌─────────────────────────────────────────────────────┐
│              Event Analytics Dashboard               │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐   │
│  │            Coverage Heatmap                  │   │
│  │     [Track map with photo density]           │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ 847       │  │ 92%       │  │ €12,450       │  │
│  │ Photos    │  │ Coverage  │  │ Sales         │  │
│  └───────────┘  └───────────┘  └───────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │         Participant Coverage                 │   │
│  │  #1 ████████████████████ 45 photos          │   │
│  │  #7 ██████████████ 32 photos                │   │
│  │  #23 █████████ 21 photos                    │   │
│  │  #156 ███ 8 photos                          │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Metriche per Organizzatori**:
- Coverage rate per partecipante
- Heatmap posizioni fotografi
- Sponsor visibility analysis
- Sales performance
- Photographer efficiency

**B2B Pricing**:
| Tier | Events/year | Features | Price |
|------|-------------|----------|-------|
| Basic | 5 | Dashboard | €299/anno |
| Pro | 20 | + API | €799/anno |
| Enterprise | Unlimited | + White-label | Custom |

**Effort**: 4-5 settimane
**Files coinvolti**: `racetagger-app/src/app/organizer-portal/`

---

### 3.11 Face Recognition con AuraFace v1 (ONNX)

**Problema**: La feature face recognition è completamente implementata ma disabilitata ("Coming Soon"). Usa face-api.js (modelli 2019, 128-dim, 99.38% LFW) che è obsoleto, non più mantenuto, e inadeguato per condizioni reali (profili, scarsa luce, angolazioni). L'architettura attuale richiede un bridge IPC renderer↔main complesso con timeout 30s.

**Soluzione**: Sostituire face-api.js con **AuraFace v1** (ResNet100, Apache 2.0) + **YuNet** (face detector, Apache 2.0), entrambi ONNX. Tutto il processing migra nel main process, eliminando il bridge IPC e le dipendenze face-api.js + canvas dal renderer.

```
Architettura Target:
┌─────────────────────────────────────────────────────┐
│                    Main Process (ONNX)               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐     ┌──────────────────┐          │
│  │   YuNet      │ ──▶ │   AuraFace v1    │          │
│  │  Detection   │     │   Embedding      │          │
│  │  (~90KB)     │     │   (~250MB)       │          │
│  │  640×640     │     │   112×112→512-d  │          │
│  └──────────────┘     └──────────────────┘          │
│         │                      │                     │
│         │    ┌─────────────────┘                     │
│         ▼    ▼                                       │
│  ┌──────────────────┐                               │
│  │  Cosine Matcher  │                               │
│  │  (512-dim)       │                               │
│  └────────┬─────────┘                               │
│           │                                          │
│     ┌─────┼─────┐                                   │
│     ▼           ▼                                   │
│  ┌────────┐ ┌──────────────┐                        │
│  │ Preset │ │ Sport Cat.   │                        │
│  │ Faces  │ │ Global Faces │                        │
│  └────────┘ └──────────────┘                        │
└─────────────────────────────────────────────────────┘

Eliminati:
✗ face-api.js (renderer)
✗ face-detection-bridge.ts (IPC)
✗ canvas npm package
```

**Perché AuraFace v1**:

| Criterio | face-api.js (attuale) | AuraFace v1 | InsightFace buffalo_l |
|----------|----------------------|-------------|----------------------|
| Accuratezza LFW | 99.38% | 99.65% | 99.83% |
| Accuratezza CFP-FP (profilo) | ~90% | 95.19% | ~98% |
| Accuratezza AgeDB-30 | ~93% | 96.10% | ~98% |
| Embedding dim | 128 | **512** | 512 |
| Matching | Euclidea | **Cosine similarity** | Cosine similarity |
| Licenza | MIT | **Apache 2.0** | ⚠️ Commerciale a pagamento |
| Runtime | Browser (Canvas) | **ONNX (main process)** | ONNX |
| Mantenuto | ❌ No (2019) | ✅ Sì (2024+) | ✅ Sì |

InsightFace ha accuratezza superiore ma i modelli pre-addestrati richiedono licenza commerciale a pagamento. AuraFace è la scelta giusta: Apache 2.0 pulita, salto significativo su benchmark difficili (+5% su profili), e si integra direttamente con onnxruntime-node già nel progetto.

**Funzionalità**:
- Face detection locale con YuNet ONNX (Apache 2.0, ~90KB, <50ms)
- Face embedding con AuraFace v1 ONNX (Apache 2.0, ~250MB, <100ms)
- Cosine similarity matching (512-dim, più discriminativo del 128-dim euclideo)
- Tutto nel main process: nessun bridge IPC, nessuna dipendenza browser
- Context-aware matching: portrait (0.65), action (0.58), podium (0.60), auto (0.62)
- Compatibilità con pipeline esistente (scene classifier, generic segmenter, unified processor)
- Upload foto: detection server-side via Edge Function o locale nel main process
- Migrazione graduale descriptors da 128-dim a 512-dim

---

#### FASE 1: Fondamenta ONNX (3 giorni)

**Obiettivo**: Creare i servizi ONNX per detection e embedding

**Step 1.1: FaceDetectorService**
```
File: src/face-detector-service.ts (NUOVO, ~700 righe)
Pattern: Segui src/scene-classifier-onnx.ts (singleton, lazy loading)

Input: Buffer immagine (qualsiasi dimensione)
  → Resize a 640×640 con Sharp
  → Normalizzazione
Output: Array<DetectedFaceRegion>
  → { x, y, width, height, confidence, landmarks[5] }
  → NMS filtering (IoU 0.5)

Modello: YuNet (~90KB ONNX, Apache 2.0)
  → Bundled in src/assets/models/yunet/
  → Nessun download necessario
```

**Step 1.2: FaceEmbeddingService**
```
File: src/face-embedding-service.ts (NUOVO, ~600 righe)
Pattern: Segui src/scene-classifier-onnx.ts (singleton, lazy loading)

Input: Buffer immagine volto (croppato dal detector)
  → Resize a 112×112 RGB
  → Normalizzazione: (pixel - 127.5) / 128.0
Output: number[] (512 dimensioni)

Modello: AuraFace v1 (~250MB ONNX, Apache 2.0)
  → Download on-demand via ModelManager
  → Cache in ~/.racetagger/models/auraface-v1/
  → SHA256 validation
```

**Step 1.3: FaceRecognitionOnnxProcessor (orchestratore)**
```
File: src/face-recognition-onnx-processor.ts (NUOVO, ~800 righe)

Metodo principale:
async detectAndEmbed(imagePath: string): Promise<FaceEmbedding[]>
  1. Carica immagine con Sharp (gestisce EXIF rotation)
  2. FaceDetectorService.detect(buffer) → bounding boxes
  3. Per ogni face box: crop + FaceEmbeddingService.embed(crop) → 512-dim
  4. Ritorna array di { faceIndex, boundingBox, embedding[512], confidence }

Performance target:
  → Detection: <50ms
  → Embedding: <100ms per volto
  → Totale: <200ms per immagine con 1 volto
```

**Files coinvolti - Fase 1**:
- `src/face-detector-service.ts` — NUOVO
- `src/face-embedding-service.ts` — NUOVO
- `src/face-recognition-onnx-processor.ts` — NUOVO
- `src/assets/models/yunet/` — NUOVO (modello bundled)
- `src/model-manager.ts` — Aggiungere AuraFace al registry

---

#### FASE 2: Migrazione Database (2 giorni)

**Obiettivo**: Supportare descriptor 512-dim mantenendo backward compatibility

**Step 2.1: Schema Migration**
```sql
-- File: supabase/migrations/YYYYMMDD_auraface_descriptor_512.sql

-- Aggiungere colonna 512-dim (coesiste con 128-dim)
ALTER TABLE preset_participant_face_photos
  ADD COLUMN face_descriptor_512 float8[] DEFAULT NULL;

ALTER TABLE sport_category_faces
  ADD COLUMN face_descriptor_512 float8[] DEFAULT NULL;

-- Indice per performance matching
CREATE INDEX idx_face_photos_descriptor_512
  ON preset_participant_face_photos USING gin(face_descriptor_512)
  WHERE face_descriptor_512 IS NOT NULL;

-- Commento deprecazione
COMMENT ON COLUMN preset_participant_face_photos.face_descriptor
  IS 'DEPRECATED v1.2.0: Use face_descriptor_512 (AuraFace v1)';
```

**Step 2.2: Aggiornare FaceRecognitionProcessor**
```
File: src/face-recognition-processor.ts (MODIFICA)

Cambiamenti:
1. Descriptor validation: accettare sia 128 che 512 dimensioni
2. Matching: euclidean distance → cosine similarity
3. Soglie: invertite (cosine: più alto = più simile)
   - portrait: 0.65
   - action: 0.58
   - podium: 0.60
   - auto: 0.62
4. Dual-read mode: leggere face_descriptor_512 || face_descriptor

Nuova funzione:
cosineSimilarity(d1: number[], d2: number[]): number
  → dot(d1, d2) / (norm(d1) * norm(d2))
  → Range: -1.0 a 1.0 (in pratica 0.0 a 1.0 per volti)
```

**Step 2.3: Servizio Migrazione Batch**
```
File: src/face-descriptor-migration-service.ts (NUOVO, ~400 righe)

Scopo: Ricalcolare descriptor 512-dim dalle foto esistenti

Flusso:
1. Query foto con face_descriptor_512 IS NULL
2. Download immagine da Supabase Storage
3. detectAndEmbed() → nuovo 512-dim descriptor
4. UPDATE face_descriptor_512

Trigger: IPC handler admin-only (manuale)
Fallback: foto senza volto → skip con warning
Progress: callback per UI admin
```

**Strategia migrazione (reversibile)**:
```
Giorno 1:  Deploy migration → aggiunge colonne 512-dim
           App legge: face_descriptor_512 || face_descriptor (dual-read)
           App scrive: SOLO face_descriptor_512 (nuovi upload)

Giorno 2+: Admin lancia batch recompute per foto esistenti
           Progress: X/Y completate

Giorno 14: Feature flag → leggi SOLO face_descriptor_512
           Vecchi 128-dim ignorati

Giorno 30: Cleanup migration → DROP face_descriptor (opzionale)
```

**Files coinvolti - Fase 2**:
- `supabase/migrations/YYYYMMDD_auraface_descriptor_512.sql` — NUOVO
- `src/face-recognition-processor.ts` — MODIFICA (cosine + 512-dim)
- `src/face-descriptor-migration-service.ts` — NUOVO
- `src/database-service.ts` — MODIFICA (dual-read queries)
- `src/config.ts` — Aggiungere feature flag `AURAFACE_ENABLED`

---

#### FASE 3: Eliminare Bridge IPC (2 giorni)

**Obiettivo**: Rimuovere l'architettura renderer↔main, tutto nel main process

**Step 3.1: Aggiornare IPC Handlers**
```
File: src/ipc/face-recognition-handlers.ts (MODIFICA)

Semplificazione da 6 a 5 handler:
1. face-recognition-initialize → init ONNX models (non più face-api.js)
2. face-detect-and-embed → NUOVO: detection + embedding in main process
3. face-recognition-match → matchEmbeddings (cosine 512-dim)
4. face-recognition-status → status ONNX models
5. face-recognition-clear → clear descriptors

Rimosso: face-recognition-load-from-database
  → integrato in initialize
```

**Step 3.2: Aggiornare Preload**
```
File: src/preload.ts (MODIFICA)

Rimuovere canali send/receive (non servono più):
- face-detection-request / face-detection-response
- face-detection-single-request / face-detection-single-response
- face-descriptor-request / face-descriptor-response

Aggiungere canali invoke:
- face-detect-and-embed
```

**Step 3.3: File da eliminare**
```
ELIMINARE: src/face-detection-bridge.ts (357 righe)
  → Non serve più: detection nel main process via ONNX

ELIMINARE: renderer/js/face-detector.js (468 righe)
  → Non serve più: face-api.js rimosso

RIMUOVERE da package.json:
  - face-api.js@0.22.2
  - canvas@3.2.0 (se non usato altrove)
  → Riduce bundle size e problemi native rebuild
```

**Files coinvolti - Fase 3**:
- `src/face-detection-bridge.ts` — ELIMINARE
- `renderer/js/face-detector.js` — ELIMINARE
- `src/ipc/face-recognition-handlers.ts` — MODIFICA
- `src/preload.ts` — MODIFICA (rimuovi/aggiungi canali)
- `src/ipc/index.ts` — MODIFICA (rimuovi registrazione bridge)
- `package.json` — Rimuovere face-api.js, canvas

---

#### FASE 4: Upload Foto Semplificato (3 giorni)

**Obiettivo**: Photo upload con face detection nel main process

**Step 4.1: Aggiornare preset-face-handlers.ts**
```
File: src/ipc/preset-face-handlers.ts (MODIFICA)

Handler 'preset-face-upload-photo' aggiornato:
1. Riceve: { photoData (base64), participantId/driverId, ... }
2. Salva in Supabase Storage (invariato)
3. NUOVO: Detect + embed nel main process
   → FaceRecognitionOnnxProcessor.detectAndEmbed(buffer)
   → Prendi primo volto (upload reference = 1 volto atteso)
4. Salva descriptor 512-dim in face_descriptor_512
5. Ritorna: { success, photo, faceDetected, confidence }

Se nessun volto trovato:
  → Ritorna { faceDetected: false }
  → UI chiede conferma all'utente (invariato)
```

**Step 4.2: Semplificare Renderer**
```
File: renderer/js/preset-face-manager.js (MODIFICA)

Rimozioni:
- Rimuovere import/uso di faceDetector
- Rimuovere auto-init face-api.js
- Rimuovere chiamate detectSingleFace()
- Rimuovere gestione IPC face-detection

Semplificazione uploadPhoto():
  PRIMA: readFile → detectFace(renderer) → invoke upload
  DOPO:  readFile → invoke upload (detection nel main)

Il main process fa tutto:
  renderer manda solo l'immagine, riceve descriptor + confidence
```

**Step 4.3: Aggiornare Driver Face Manager**
```
File: renderer/js/driver-face-manager.js (MODIFICA)

Rimozioni:
- Rimuovere FACE_RECOGNITION_ENABLED flag
- Rimuovere check face-api.js init
- Rimuovere import face-detector

Rimane invariato:
- UI driver panels, metatag input
- Photo grid rendering
- Driver sync logic
```

**Files coinvolti - Fase 4**:
- `src/ipc/preset-face-handlers.ts` — MODIFICA
- `renderer/js/preset-face-manager.js` — SEMPLIFICA
- `renderer/js/driver-face-manager.js` — MODIFICA (rimuovi flag)

---

#### FASE 5: Integrazione Pipeline (2 giorni)

**Obiettivo**: Collegare ONNX face recognition nel processing pipeline

**Step 5.1: Aggiornare Unified Image Processor**
```
File: src/unified-image-processor.ts (MODIFICA)

Cambiamenti:
1. initializeFaceRecognition():
   PRIMA: getFaceDetectionBridge().loadDescriptorsForPreset()
   DOPO:  FaceRecognitionOnnxProcessor.initialize()
          + FaceRecognitionProcessor.loadFromPreset() (512-dim)

2. performFaceRecognition():
   PRIMA: getFaceDetectionBridge().detectAndMatch(imagePath, context)
   DOPO:  FaceRecognitionOnnxProcessor.detectAndEmbed(imagePath)
          + FaceRecognitionProcessor.matchEmbeddings(embeddings, context)

3. getRecognitionStrategy():
   Invariato (scene classifier + segmentation logic rimane)

4. Metadata writing:
   Invariato (keywords + metatag logic rimane)

Import changes:
  - RIMUOVERE: import getFaceDetectionBridge
  - AGGIUNGERE: import FaceRecognitionOnnxProcessor
```

**Step 5.2: Aggiornare Analysis Logger**
```
File: src/utils/analysis-logger.ts (MODIFICA)

Nuovo tipo log entry:
{
  type: 'FACE_RECOGNITION',
  detection_method: 'yunet',
  embedding_model: 'auraface-v1',
  descriptor_dimension: 512,
  faces_detected: number,
  faces_matched: number,
  detection_time_ms: number,
  embedding_time_ms: number,
  matching_time_ms: number,
  matches: [{ face_index, person_name, similarity_score }]
}
```

**Files coinvolti - Fase 5**:
- `src/unified-image-processor.ts` — MODIFICA (replace bridge calls)
- `src/utils/analysis-logger.ts` — MODIFICA (nuovo log type)
- `src/utils/metadata-writer.ts` — MINIMA modifica (confidence format)

---

#### FASE 6: UI — Rimuovere "Coming Soon" (2 giorni)

**Obiettivo**: Attivare l'UI face recognition e rimuovere overlay disabled

**Step 6.1: Attivare Participants Page**
```
File: renderer/pages/participants.html (MODIFICA)

Rimuovere:
- Classe .driver-face-section--disabled
- Div .coming-soon-overlay-abs (overlay + card)
- Div .coming-soon-preview (preview blurrata)

Mantenere:
- Driver panels funzionali
- Photo grid per driver
- Metatag input fields
- 5 photo slots per driver
```

**Step 6.2: Aggiornare CSS**
```
File: renderer/css/participants.css (MODIFICA)

Rimuovere:
- .coming-soon-overlay-abs styles
- .coming-soon-preview blur
- .badge-face "COMING SOON" badge
- .driver-face-section--disabled styles

Mantenere:
- .driver-face-panel styles
- .photo-grid styles
- .metatag-input styles
```

**Step 6.3: Aggiornare Face Recognition UI**
```
File: renderer/js/face-recognition-ui.js (MODIFICA)

Aggiornare:
- Confidence display: cosine similarity % (0-100%)
- Badge rendering per match results
- Inline indicator aggiornato

File: renderer/js/log-visualizer.js (MODIFICA)

Aggiungere:
- Rendering per log type FACE_RECOGNITION
- Mostrare detection_method + embedding_model
- Mostrare similarity score per match
```

**Step 6.4: Rimuovere flag disabled**
```
File: renderer/js/driver-face-manager.js (MODIFICA)
  - Rimuovere: const FACE_RECOGNITION_ENABLED = false;
  - Rimuovere: tutti i check su FACE_RECOGNITION_ENABLED
  - Il codice funziona come se fosse sempre enabled
```

**Files coinvolti - Fase 6**:
- `renderer/pages/participants.html` — MODIFICA
- `renderer/css/participants.css` — MODIFICA
- `renderer/js/face-recognition-ui.js` — MODIFICA
- `renderer/js/log-visualizer.js` — MODIFICA
- `renderer/js/driver-face-manager.js` — MODIFICA (rimuovi flag)
- `renderer/index.html` — Rimuovere script face-detector.js

---

#### FASE 7: Testing e Tuning (3 giorni)

**Obiettivo**: Validare accuratezza, performance e migration

**Step 7.1: Unit Tests**
```
Files NUOVI:
- tests/face-detector-service.test.ts
  → Validate bounding box format
  → NMS filtering corretto
  → Gestione immagini senza volti

- tests/face-embedding-service.test.ts
  → Output: esattamente 512 dimensioni
  → Normalizzazione corretta
  → Determinismo (stessa immagine → stesso embedding)

- tests/face-recognition-cosine.test.ts
  → Cosine similarity range [0, 1]
  → Stesso volto → similarity > 0.8
  → Volti diversi → similarity < 0.5
  → Threshold context-aware corretto
```

**Step 7.2: Performance Benchmark**
```
File NUOVO: tests/performance/face-recognition-benchmark.ts

Target:
| Operazione              | Target   | Accettabile |
|-------------------------|----------|-------------|
| YuNet detection (1 face)| <50ms    | <100ms      |
| AuraFace embedding      | <100ms   | <150ms      |
| Cosine matching (100 ref)| <3ms    | <5ms        |
| Totale per immagine     | <200ms   | <300ms      |
| Memory peak             | <300MB   | <400MB      |

Confronto: face-api.js (500-1200ms) → AuraFace (<200ms) = 3-6x faster
```

**Step 7.3: Test Migrazione**
```
Scenari:
1. DB con solo descriptor 128-dim → dual-read → nessun crash
2. Batch recompute 10 foto → tutti 512-dim → match corretto
3. Mix 128+512 descriptor → matching funziona per entrambi
4. Nuova foto upload → solo 512-dim → match corretto
5. Rollback: disabilita AuraFace → torna a 128-dim → funziona
```

**Step 7.4: Tuning Soglie Cosine Similarity**
```
Procedura:
1. Dataset test: 50+ volti, 5+ foto ciascuno, condizioni varie
2. Calcolare confusion matrix per threshold 0.50-0.75 (step 0.02)
3. Trovare punto ottimale FP vs FN per ogni contesto
4. Validare su holdout set
5. Documentare soglie finali in config.ts
```

**Files coinvolti - Fase 7**:
- `tests/face-detector-service.test.ts` — NUOVO
- `tests/face-embedding-service.test.ts` — NUOVO
- `tests/face-recognition-cosine.test.ts` — NUOVO
- `tests/performance/face-recognition-benchmark.ts` — NUOVO

---

#### Riepilogo Effort e Timeline

| Fase | Durata | Focus |
|------|--------|-------|
| 1 | 3 giorni | Servizi ONNX (detector + embedder + orchestratore) |
| 2 | 2 giorni | DB migration 128→512 + cosine similarity |
| 3 | 2 giorni | Eliminare bridge IPC + cleanup face-api.js |
| 4 | 3 giorni | Upload foto nel main process |
| 5 | 2 giorni | Integrazione unified-image-processor |
| 6 | 2 giorni | UI: rimuovere "Coming Soon", attivare feature |
| 7 | 3 giorni | Testing, benchmark, tuning soglie |
| **Totale** | **~17 giorni (~3.5 settimane)** | |

#### File Inventory Completo

**Nuovi (8 files)**:
- `src/face-detector-service.ts` (~700 righe)
- `src/face-embedding-service.ts` (~600 righe)
- `src/face-recognition-onnx-processor.ts` (~800 righe)
- `src/face-descriptor-migration-service.ts` (~400 righe)
- `supabase/migrations/YYYYMMDD_auraface_descriptor_512.sql`
- `tests/face-detector-service.test.ts`
- `tests/face-embedding-service.test.ts`
- `tests/face-recognition-cosine.test.ts`

**Modificati (12 files)**:
- `src/face-recognition-processor.ts` — cosine + 512-dim
- `src/unified-image-processor.ts` — replace bridge con ONNX
- `src/ipc/face-recognition-handlers.ts` — semplifica handler
- `src/ipc/preset-face-handlers.ts` — detection nel main
- `src/ipc/index.ts` — rimuovi registrazione bridge
- `src/preload.ts` — aggiorna canali IPC
- `src/config.ts` — feature flags + threshold
- `src/database-service.ts` — dual-read 128/512
- `src/model-manager.ts` — aggiungere AuraFace al registry
- `renderer/js/preset-face-manager.js` — semplifica upload
- `renderer/js/driver-face-manager.js` — rimuovi flag disabled
- `renderer/pages/participants.html` — rimuovi Coming Soon

**Eliminati (3 files)**:
- `src/face-detection-bridge.ts` (357 righe)
- `renderer/js/face-detector.js` (468 righe)
- `src/assets/models/face-api/` (directory modelli face-api.js)

**NPM packages**:
- Rimuovere: `face-api.js`, `canvas` (meno problemi native rebuild)
- Nessun nuovo package (usa onnxruntime-node già installato)

#### Business Impact

| Metrica | Valore |
|---------|--------|
| Accuratezza profili (CFP-FP) | +5% (90% → 95.19%) |
| Velocità processing | 3-6x faster (1200ms → 200ms) |
| Dipendenze native | -2 packages (face-api.js, canvas) |
| Costo per utente | €0 (tutto locale, Apache 2.0) |
| Use case abilitati | Paddock, podio, interviste, team photo |
| Differenziazione | Face recognition locale in app motorsport |

#### Rischi e Mitigazione

| Rischio | Impatto | Mitigazione |
|---------|---------|-------------|
| AuraFace meno preciso di InsightFace | Medio | Per il nostro use case (non sorveglianza) è più che sufficiente |
| Migrazione DB rompe dati esistenti | Alto | Migration reversibile, dual-read, batch recompute graduale |
| ONNX memory footprint (+300MB) | Basso | Lazy loading, modelli caricati solo se feature attiva |
| YuNet non trova volti con casco | Nessuno | Expected: face rec è per paddock/podio, non pista |
| Tuning soglie cosine errato | Medio | Dataset test + confusion matrix + threshold configurabile |

#### Rollback Strategy

```
Livello 1 (immediato): Feature flag AURAFACE_ENABLED = false
  → Torna a leggere face_descriptor (128-dim)
  → Face recognition disabilitato (come ora)

Livello 2 (parziale): Mantieni dual-read
  → 128-dim e 512-dim coesistono
  → Nessuna perdita dati

Livello 3 (completo): Revert migration
  → DROP colonne 512-dim
  → Restore face-api.js (branch git)
```

**Effort**: ~3.5 settimane
**Priorità**: Dopo stabilizzazione v1.1.0
**Files coinvolti**: 8 nuovi + 12 modificati + 3 eliminati

---

## 4. Prioritizzazione

### Matrice Impatto/Effort

```
                    HIGH IMPACT
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    │  D2P Sales 🌟      │   Real-Time Mode   │
    │  API Platform      │   Multi-Photo      │
    │                    │   Mobile App       │
    │                    │                    │
LOW ├────────────────────┼────────────────────┤ HIGH
EFF │                    │                    │ EFFORT
    │  Auto-Culling      │   Video Analysis   │
    │  On-Device AI      │   B2B Dashboard    │
    │  Multi-Sport       │                    │
    │                    │                    │
    └────────────────────┼────────────────────┘
                         │
                    LOW IMPACT
```

### Stack Rank (Priorità Business)

| # | Feature | Rationale |
|---|---------|-----------|
| 1 | **D2P Sales** | Revenue game-changer |
| 2 | **On-Device AI** | Differenziazione tecnica |
| 3 | **Face Recognition (AuraFace)** | Feature già implementata, sblocca valore immediato |
| 4 | **API Platform** | Enable ecosystem |
| 5 | **Real-Time Mode** | Premium feature |
| 6 | **Auto-Culling** | Time saver, quick win |
| 7 | **Multi-Sport** | Market expansion |
| 8 | **Mobile App** | Field workflow |
| 9 | **Multi-Photographer** | Team support |
| 10 | **Video Analysis** | Content expansion |
| 11 | **B2B Dashboard** | Enterprise sales |

---

## 5. Roadmap Temporale

### Q1 2025: Foundation

**Obiettivo**: Completare infrastruttura base per features avanzate

| Settimana | Focus | Deliverable |
|-----------|-------|-------------|
| 1-2 | On-Device AI | ONNX runtime integration |
| 3-4 | On-Device AI | Model conversion pipeline |
| 5-6 | Auto-Culling | Quality scoring MVP |
| 7-8 | Auto-Culling | UI integration |
| 9-10 | Multi-Sport | Cycling adapter |
| 11-12 | Testing | Performance benchmarks |

**Milestone Q1**: RaceTagger funziona 100% offline con auto-culling

### Q2 2025: Monetization

**Obiettivo**: Lanciare D2P e API per revenue

| Settimana | Focus | Deliverable |
|-----------|-------|-------------|
| 1-3 | D2P Sales | Storefront MVP |
| 4-5 | D2P Sales | Stripe integration |
| 6-7 | D2P Sales | QR code system |
| 8-9 | API | REST API v1 |
| 10-11 | API | Lightroom plugin |
| 12 | Launch | Beta with select photographers |

**Milestone Q2**: Primi €10,000 revenue da D2P

### Q3 2025: Scale

**Obiettivo**: Real-time e collaborazione per eventi grandi

| Settimana | Focus | Deliverable |
|-----------|-------|-------------|
| 1-3 | Real-Time | Tethering support |
| 4-6 | Real-Time | Live dashboard |
| 7-9 | Multi-Photo | Workspace system |
| 10-12 | Multi-Photo | Sync & merge |

**Milestone Q3**: 5+ fotografi usano RaceTagger su stesso evento

### Q4 2025: Mobile & Enterprise

**Obiettivo**: Mobile app e offerta B2B

| Settimana | Focus | Deliverable |
|-----------|-------|-------------|
| 1-4 | Mobile | iOS app MVP |
| 5-8 | Mobile | Android + sync |
| 9-10 | B2B | Organizer dashboard |
| 11-12 | B2B | Enterprise features |

**Milestone Q4**: 1000+ downloads mobile, 10 organizzatori B2B

---

## 6. Metriche di Successo

### KPIs Tecnici

| Metrica | Attuale | Target Q4 2025 |
|---------|---------|----------------|
| Accuracy recognition | 94% | 98% |
| Processing speed | 2s/img | 0.5s/img |
| Offline capability | 0% | 100% |
| Supported sports | 2 | 6 |

### KPIs Business

| Metrica | Attuale | Target Q4 2025 |
|---------|---------|----------------|
| Active users | ~100 | 2,000 |
| Events processed/month | ~50 | 500 |
| D2P GMV | €0 | €500,000 |
| API calls/month | 0 | 1M |
| MRR | ~€2,000 | €25,000 |

### KPIs User Satisfaction

| Metrica | Target |
|---------|--------|
| NPS | > 50 |
| Time saved per event | > 80% |
| Support tickets/user | < 0.5 |
| Churn rate | < 5%/month |

---

## Appendice: Risorse Necessarie

### Team

| Role | FTE | Focus |
|------|-----|-------|
| Full-stack dev | 1 | Core features |
| ML Engineer | 0.5 | On-device AI, models |
| Mobile dev | 0.5 | React Native app |
| Designer | 0.25 | UI/UX |

### Infrastruttura

| Service | Cost/month | Purpose |
|---------|------------|---------|
| Supabase Pro | €25 | Database, auth, storage |
| Vercel Pro | €20 | API hosting |
| Stripe | 2.9% + €0.25 | Payment processing |
| Apple Developer | €99/year | iOS app |
| Google Play | €25 one-time | Android app |

### Budget Stimato Q1-Q4 2025

| Category | Amount |
|----------|--------|
| Development | €40,000 |
| Infrastructure | €2,000 |
| Marketing | €5,000 |
| Legal/Compliance | €2,000 |
| **Total** | **€49,000** |

---

*Documento creato: Dicembre 2025*
*Prossima revisione: Marzo 2025*
