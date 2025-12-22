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
| 3 | **API Platform** | Enable ecosystem |
| 4 | **Real-Time Mode** | Premium feature |
| 5 | **Auto-Culling** | Time saver, quick win |
| 6 | **Multi-Sport** | Market expansion |
| 7 | **Mobile App** | Field workflow |
| 8 | **Multi-Photographer** | Team support |
| 9 | **Video Analysis** | Content expansion |
| 10 | **B2B Dashboard** | Enterprise sales |

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
