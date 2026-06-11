# RaceTagger AI Infrastructure Analysis

**Data:** 20 Febbraio 2026
**Autore:** Claude (Senior Developer / Infrastructure Engineer)
**Contesto:** Issues #55, #57, #58 + evoluzione architetturale V6

---

## 1. Retry vs Multi-Location Failover Strategy

### Il Problema Attuale

La V6 attuale ha una configurazione statica:
- **Location:** `global` (hardcoded in `constants.ts`)
- **Model:** `gemini-3-flash-preview` (hardcoded)
- **Retry:** Nessuno interno alla Edge Function (solo fallback prompt)
- **Retry desktop:** 2 tentativi, ma solo per errori di rete (`fetch failed`, `ECONNREFUSED`, `ETIMEDOUT`, `Failed to send`)
- **429 Resource Exhausted:** NON viene ritentato

La V3 aveva un'architettura più resiliente: Vertex AI (`europe-west1`) → AI Studio fallback, con `retryWithBackoff` interno (3 tentativi, backoff esponenziale 1s-4s, detect di errori 503/429/quota).

### Analisi: Retry Semplice vs Multi-Location Failover

**Opzione A: Retry sullo stesso endpoint (semplice)**
- Pro: Facile da implementare, sufficiente per errori transitori (503, timeout)
- Contro: Se il problema è quota regionale o congestione su `global`, ritentare lo stesso endpoint è inutile. Il 429 "Resource Exhausted" indica che il problema è a livello di capacity sharing, non transitorio.

**Opzione B: Multi-location failover (raccomandato)**
- Pro: Se `global` è congestionato, un endpoint EU regionale potrebbe funzionare. Se il modello Preview non è disponibile, si può fallback su un GA model. Copre sia problemi di quota che problemi di disponibilità.
- Contro: Richiede una lista di fallback prioritizzati e client multipli.

### Strategia Raccomandata: Provider Chain

Una catena di provider ordinata per priorità, dove ogni "provider" è una combinazione `(model, location, sdk)`:

```
Catena di Fallback:
1. gemini-3-flash-preview @ global   (Vertex AI)    ← Migliore qualità
2. gemini-2.5-flash @ europe-west4   (Vertex AI)    ← GDPR compliant, GA
3. gemini-2.5-flash-lite @ europe-west4 (Vertex AI)  ← Economico, GA, EU
4. gemini-2.5-flash-lite @ us-central1 (AI Studio)   ← Ultimo resort
```

**Logica:**
- Tentativo 1: Modello preferito dalla `sport_categories` (es. `gemini-3-flash-preview @ global`)
- Se fallisce con 429/503/timeout → Tentativo 2: Primo fallback dalla catena
- Se fallisce anche il 2 → Tentativo 3: Secondo fallback
- Ogni tentativo ha il proprio timeout (60s)
- Backoff tra tentativi: 500ms (non serve aspettare molto se cambiamo endpoint)

### Vincolo GDPR

Il DB Supabase è a Francoforte (`europe-west3`). Le foto contengono dati personali (volti, numeri di gara associabili a persone). Per GDPR:

- **Default obbligatorio:** location EU (`europe-west3` o `europe-west4`)
- **`global` come eccezione:** Solo se il modello EU non è disponibile (es. Gemini 3 Flash Preview oggi è solo global)
- **Documentare:** Nella privacy policy, specificare che per modelli Preview non ancora disponibili in EU, i dati possono transitare su endpoint globali
- **Obiettivo:** Quando Gemini 3 Flash diventa GA in EU → switch immediato a EU

**Stato attuale modelli EU (Febbraio 2026):**
| Modello | EU Regions | Global | Status |
|---------|-----------|--------|--------|
| gemini-2.5-flash-lite | ✅ europe-west1/3/4 | ✅ | GA |
| gemini-2.5-flash | ✅ europe-west1/3/4 | ✅ | GA |
| gemini-3-flash-preview | ❌ | ✅ solo global | Preview |
| gemini-3.1-pro | ❌ | ✅ solo global | Preview |

### Implementazione nella Edge Function V6

Il cambiamento chiave è nel `gemini-analyzer.ts`. Oggi crea un singolo client statico. La nuova architettura crea client on-demand per ogni provider nella catena:

```typescript
// Pseudocodice concettuale
interface AIProvider {
  model: string;
  location: string;
  type: 'vertex' | 'aistudio';
  priority: number;
}

async function analyzeWithFailover(
  providers: AIProvider[],
  crops: CropData[],
  negative: NegativeData | undefined,
  prompt: string
): Promise<GeminiAnalysisResult> {
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const client = getOrCreateClient(provider);
      const result = await callGemini(client, provider.model, crops, negative, prompt);

      // Log quale provider ha funzionato (per telemetria)
      result.providerUsed = `${provider.type}:${provider.model}@${provider.location}`;
      return result;
    } catch (error) {
      errors.push(`${provider.model}@${provider.location}: ${error.message}`);

      if (!isRetryableError(error)) {
        throw error; // Errori non recuperabili (es. prompt invalido)
      }

      // Breve pausa prima del prossimo provider
      await delay(500);
    }
  }

  throw new Error(`All providers failed: ${errors.join(' | ')}`);
}
```

La funzione `isRetryableError` deve includere:
- 429 Resource Exhausted
- 503 Service Unavailable
- Timeout
- Network errors (ECONNREFUSED, ETIMEDOUT, fetch failed)
- "overloaded", "quota", "rate limit"

**NON ritentabile:**
- 400 Bad Request (prompt invalido)
- 401/403 Authentication error
- Errori di parsing della risposta

### Retry anche lato Desktop

In `unified-image-processor.ts`, la funzione `analyzeImage()` deve estendere la lista degli errori ritentabili:

```typescript
// ATTUALE: Solo errori di rete
const isNetworkError = lastEdgeFnError.includes('fetch failed') || ...;

// PROPOSTO: Anche errori di capacity
const isRetryableError = isNetworkError ||
  lastEdgeFnError.includes('429') ||
  lastEdgeFnError.includes('Resource exhausted') ||
  lastEdgeFnError.includes('503') ||
  lastEdgeFnError.includes('overloaded') ||
  lastEdgeFnError.includes('RESOURCE_EXHAUSTED');
```

---

## 2. V6 come Edge Function Definitiva

### Situazione Attuale

Oggi convivono 6+ Edge Functions:
- `analyzeImageDesktop` (V1) — Legacy, inutilizzata
- `analyzeImageDesktopV2` — SmartMatcher, obsoleta
- `analyzeImageDesktopV3` — Temporal clustering, ancora usata come default per imagePath
- `analyzeImageDesktopV4` — RF-DETR, specifica per categorie Roboflow
- `analyzeImageDesktopV5` — Vehicle recognition, quasi mai usata
- `analyzeImageDesktopV6` — Crop+Context, la più avanzata

Questa frammentazione causa:
1. **Manutenzione tripla**: Bug fix da replicare su più funzioni
2. **Logica caotica nel desktop**: `smart-routing-processor.ts` e `unified-image-processor.ts` hanno percorsi diversi per ogni versione
3. **Inconsistenza**: V3 ha retry+fallback, V6 no. V3 salva tokens, V6 no.
4. **Deploy complessi**: Ogni modifica richiede deploy multipli

### Piano: V6 come Funzione Unica

La V6 deve assorbire tutte le capacità delle versioni precedenti:

**Già presenti in V6:**
- ✅ Multi-crop analysis (V6 nativo)
- ✅ Full image fallback (V6 Baseline 2026)
- ✅ imagePath V3-compatible mode (V6 2026)
- ✅ Context from Storage (V6 2026)
- ✅ Sport category config loading
- ✅ Recognition config filtering
- ✅ Database writing con UUID server-side

**Da aggiungere a V6 (dalla V3):**
- ❌ Multi-provider failover (Vertex → AI Studio)
- ❌ Internal retry con backoff (429/503)
- ❌ `isRetryableError()` detection
- ❌ Provider logging nel response (`providerUsed`)

**Da aggiungere a V6 (dalla V4):**
- ❌ RF-DETR support (per categorie che usano Roboflow)
  - Nota: Questo può restare come path separato nel desktop (`recognition_method: 'rf-detr'`) perché RF-DETR non usa Gemini. V6 gestisce solo il path Gemini.

**Da aggiungere a V6 (nuovo):**
- ❌ Provider chain configurabile (da database o env vars)
- ❌ Telemetria: quale provider ha servito, tempo di risposta, retry count
- ❌ Visual Tagging integrato (opzionale, vedi sezione 3)

### Cambiamenti Specifici

**1. `gemini-analyzer.ts` — Multi-provider**

Sostituire il client singleton con una factory che supporta più provider. I provider vengono definiti da una configurazione (database o costanti) e provati in ordine.

**2. `index.ts` — Response arricchita**

Aggiungere al response:
```typescript
interface SuccessResponse {
  // ... campi esistenti ...
  providerUsed: string;      // es. "vertex:gemini-3-flash-preview@global"
  retryCount: number;         // 0 = primo tentativo ok
  inferenceTimeMs: number;    // già presente
}
```

**3. `constants.ts` — Configurazione dinamica**

I modelli e le location NON devono essere hardcoded. Opzioni:
- **Opzione A:** Env vars con parsing JSON (`VERTEX_PROVIDER_CHAIN=...`)
- **Opzione B:** Colonne in `sport_categories` (più flessibile)
- **Opzione C (raccomandata):** Nuova tabella `ai_provider_configs` (vedi sezione 4)

**4. Desktop `unified-image-processor.ts` — Semplificazione routing**

Una volta che V6 gestisce tutti i casi, il desktop può:
- Rimuovere il branching su `edge_function_version` (2/3/4/5/6)
- Mandare tutto a V6
- V6 decide internamente come analizzare basandosi su `sport_categories`

Il campo `sport_categories.edge_function_version` diventa deprecato (sempre 6).

### Piano di Migrazione

1. **Fase 1:** Aggiungere multi-provider failover a V6 (senza rompere nulla)
2. **Fase 2:** Deploy V6 aggiornata, testare con una categoria pilota
3. **Fase 3:** Aggiornare tutte le `sport_categories.edge_function_version = 6`
4. **Fase 4:** Semplificare desktop routing (rimuovere branching versioni)
5. **Fase 5:** Deprecare e rimuovere V1-V5 (dopo periodo di stabilità)

---

## 3. Visual Tagging: Ottimizzazione e Scelta Modello

### Situazione Attuale

Il `visualTagging` Edge Function:
- Riceve un `imageUrl` (URL firmato di Supabase Storage)
- Scarica l'immagine come base64 (`fetchImageAsBase64`)
- La invia a Gemini per l'estrazione tag
- Salva in tabella `visual_tags`

**Problema: Doppio download dell'immagine**

Nel flusso desktop attuale:
1. Desktop carica immagine su Supabase Storage
2. V6 la scarica per analisi (o riceve base64 dei crop)
3. Desktop chiama `visualTagging` con un URL firmato
4. `visualTagging` scarica di nuovo la stessa immagine da Storage

L'immagine viene scaricata 2 volte dall'Edge Function layer (una da V6, una da visualTagging), oppure nel caso dei crop, V6 riceve i crop dal desktop e visualTagging scarica la full image separatamente.

### Ottimizzazione Proposta

**Approccio A: Visual Tagging integrato in V6 (raccomandato)**

V6 ha già l'immagine in memoria (sia come crop che come full image via `loadImageFromStorage`). Può fare il tagging nella stessa chiamata:

```typescript
// In V6 index.ts, dopo l'analisi principale:
if (body.includeVisualTagging) {
  // L'immagine è già in memoria (loadedFullImage o primo crop)
  const tagResult = await extractTagsFromBase64(imageBase64, tagPrompt);
  response.visualTags = tagResult;
}
```

Vantaggi:
- Zero download aggiuntivi
- Una sola chiamata Edge Function dal desktop
- Costo token: solo il prompt aggiuntivo (pochi output tokens per i tag)
- Tempo: ~200ms aggiuntivi nella stessa sessione Gemini? No — serve una chiamata separata perché il prompt e la responseSchema sono diversi. Ma almeno l'immagine è già in memoria.

In realtà, Gemini non supporta due "task" nella stessa chiamata con schema diversi. Quindi il tagging richiede una seconda chiamata a Gemini, ma può essere fatta dalla V6 stessa senza re-scaricare l'immagine. L'implementazione potrebbe essere:

```typescript
// Dopo analisi principale:
if (body.includeVisualTagging && imageBase64) {
  const tagResult = await callGeminiForTags(client, imageBase64, tagPrompt, tagSchema);
  // Salva in visual_tags...
}
```

Questo elimina: il download dell'immagine da parte di `visualTagging`, la chiamata HTTP aggiuntiva dal desktop, e il costo di una seconda Edge Function invocation.

**Approccio B: Visual Tagging riceve base64 dal desktop (alternativa)**

Il desktop potrebbe mandare il base64 dell'immagine a `visualTagging` direttamente, evitando il re-download. Ma questo richiede comunque una seconda chiamata HTTP e non ottimizza il bandwidth.

**Raccomandazione: Approccio A** — integrare il tagging in V6 come step opzionale.

### Scelta Modello per Visual Tagging

Il tagging è un task "facile" per Gemini: estrai tag descrittivi da un'immagine. Non richiede ragionamento complesso né capacità multi-image.

**Confronto modelli per Visual Tagging:**

| Modello | Costo Input/1M | Costo Output/1M | Qualità Tag | Velocità | EU Disponibile |
|---------|----------------|------------------|-------------|----------|----------------|
| gemini-2.5-flash-lite | $0.10 | $0.40 | Buona | Molto veloce | ✅ |
| gemini-2.5-flash | $0.15 | $0.60 | Molto buona | Veloce | ✅ |
| gemini-3-flash-preview | $0.50 | $3.00 | Eccellente | Media | ❌ (solo global) |

**Raccomandazione: `gemini-2.5-flash-lite` per Visual Tagging**

Motivazioni:
1. **Costo 5x inferiore** rispetto a Gemini 3 Flash (l'analisi principale ha bisogno della qualità superiore, ma i tag no)
2. **Disponibile in EU** — nessun problema GDPR
3. **Più veloce** — meno latenza aggiuntiva nel pipeline
4. **GA (General Availability)** — stabile, non Preview, niente rischi di deprecazione improvvisa
5. **Qualità sufficiente** — estrarre tag come "motion blur", "pit lane", "rainy" non richiede ragionamento avanzato

Se integrato in V6, il tagging userebbe un client/modello diverso dall'analisi principale:
- Analisi principale: `gemini-3-flash-preview @ global` (o fallback chain)
- Visual Tagging: `gemini-2.5-flash-lite @ europe-west4` (fisso, economico, EU)

### Implementazione del Tagging in V6

```typescript
// In V6 gemini-analyzer.ts, nuova funzione:
export async function extractVisualTags(
  imageBase64: string,
  tagPrompt: string,
  tagSchema: object
): Promise<VisualTagResult> {
  // Usa un client EU dedicato per il tagging (2.5-flash-lite)
  const tagClient = getOrCreateClient({
    model: 'gemini-2.5-flash-lite',
    location: 'europe-west4',
    type: 'vertex'
  });

  // Chiamata semplice, singola immagine, schema strutturato
  const result = await tagClient.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    config: {
      responseMimeType: 'application/json',
      responseSchema: tagSchema,
      temperature: 0.1,
      maxOutputTokens: 1024
    },
    contents: [{ role: 'user', parts: [
      { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
      { text: tagPrompt }
    ]}]
  });

  return parseTagResponse(result);
}
```

---

## 4. Database: AI Model/Location Registry + Telemetria

### Problema

Oggi la configurazione AI è sparsa:
- `sport_categories.recognition_method` → `gemini` / `rf-detr` / `local-onnx`
- `sport_categories.edge_function_version` → 3/4/5/6
- `model_registry` → Solo modelli ONNX locali
- `config/constants.ts` nelle Edge Functions → Modello e location hardcoded
- `execution_settings.ai_model` → Telemetria (solo log, non configurazione)

Non esiste un luogo strutturato dove:
- Registrare quali modelli Gemini sono disponibili e dove
- Configurare la catena di fallback per sport category
- Tracciare le performance reali (tempo risposta, success rate) per modello/location
- Fare switch di modello dalla UI admin senza deploy di codice

### Schema Proposto

#### Tabella: `ai_models`

Registry centrale di tutti i modelli AI utilizzabili (Gemini, RF-DETR, ONNX locali).

```sql
CREATE TABLE ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificazione
  code text NOT NULL UNIQUE,          -- 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', etc.
  display_name text NOT NULL,          -- 'Gemini 3 Flash (Preview)'
  provider text NOT NULL,              -- 'vertex-ai', 'ai-studio', 'roboflow', 'local-onnx'
  model_family text NOT NULL,          -- 'gemini-3', 'gemini-2.5', 'rf-detr', 'yolo'

  -- Disponibilità
  status text NOT NULL DEFAULT 'preview',  -- 'ga', 'preview', 'deprecated', 'disabled'
  available_locations text[] NOT NULL,      -- ['global', 'europe-west4', 'us-central1']
  eu_available boolean GENERATED ALWAYS AS (
    'europe-west1' = ANY(available_locations) OR
    'europe-west3' = ANY(available_locations) OR
    'europe-west4' = ANY(available_locations)
  ) STORED,

  -- Costi (per 1M tokens)
  input_cost_per_million numeric(10,4),   -- 0.5000
  output_cost_per_million numeric(10,4),  -- 3.0000

  -- Capacità
  supports_multi_image boolean DEFAULT false,
  supports_structured_output boolean DEFAULT false,
  supports_thinking boolean DEFAULT false,
  max_images_per_request integer DEFAULT 1,
  max_output_tokens integer DEFAULT 4096,

  -- Parametri consigliati
  recommended_config jsonb DEFAULT '{}',
  -- { "thinkingLevel": "MINIMAL", "mediaResolution": "MEDIA_RESOLUTION_HIGH", "temperature": 0.2 }

  -- Metadata
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Tabella: `ai_provider_configs`

Definisce la catena di fallback per ogni sport category. Ogni riga è un "provider" nella catena.

```sql
CREATE TABLE ai_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_category_id uuid REFERENCES sport_categories(id),

  -- Provider
  ai_model_id uuid NOT NULL REFERENCES ai_models(id),
  location text NOT NULL,              -- 'global', 'europe-west4', etc.
  sdk_type text NOT NULL DEFAULT 'vertex',  -- 'vertex', 'aistudio'

  -- Priorità nella catena
  priority integer NOT NULL DEFAULT 0,  -- 0 = primario, 1 = primo fallback, etc.

  -- Uso
  purpose text NOT NULL DEFAULT 'analysis',  -- 'analysis', 'visual-tagging', 'both'

  -- Attivazione
  is_active boolean DEFAULT true,

  -- Constraints
  UNIQUE(sport_category_id, purpose, priority)
);
```

Esempio di configurazione per "motorsport":
```
priority 0: gemini-3-flash-preview @ global (vertex) — purpose: analysis
priority 1: gemini-2.5-flash @ europe-west4 (vertex) — purpose: analysis
priority 2: gemini-2.5-flash-lite @ europe-west4 (vertex) — purpose: analysis
priority 0: gemini-2.5-flash-lite @ europe-west4 (vertex) — purpose: visual-tagging
```

Per una sport category senza configurazione specifica, si usa un default globale:
```sql
-- sport_category_id IS NULL = configurazione default
INSERT INTO ai_provider_configs (sport_category_id, ai_model_id, location, priority, purpose)
VALUES (NULL, (SELECT id FROM ai_models WHERE code = 'gemini-2.5-flash-lite'), 'europe-west4', 0, 'analysis');
```

#### Tabella: `ai_inference_telemetry`

Traccia le performance reali per ogni chiamata AI. Partizionabile per data.

```sql
CREATE TABLE ai_inference_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contesto
  execution_id uuid,
  image_id uuid,
  user_id uuid,
  sport_category_code text,

  -- Provider usato
  ai_model_code text NOT NULL,         -- 'gemini-3-flash-preview'
  location text NOT NULL,               -- 'global', 'europe-west4'
  sdk_type text NOT NULL,               -- 'vertex', 'aistudio'
  purpose text DEFAULT 'analysis',      -- 'analysis', 'visual-tagging'

  -- Performance
  inference_time_ms integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(10,6),

  -- Risultato
  success boolean NOT NULL,
  error_message text,
  retry_count integer DEFAULT 0,        -- Quanti tentativi prima del successo
  was_fallback boolean DEFAULT false,   -- Questo provider era un fallback?

  -- Qualità risposta (opzionale, per analisi future)
  results_count integer,                -- Quanti risultati restituiti
  avg_confidence numeric(5,3),          -- Confidenza media dei risultati

  -- Timestamp
  created_at timestamptz DEFAULT now()
);

-- Indice per query di performance
CREATE INDEX idx_telemetry_model_date ON ai_inference_telemetry (ai_model_code, created_at);
CREATE INDEX idx_telemetry_category_date ON ai_inference_telemetry (sport_category_code, created_at);
```

### Come la V6 usa queste tabelle

Al boot della Edge Function (in `sport-category-loader.ts`):

```typescript
// 1. Carica sport_category come oggi
const categoryConfig = await loadSportCategory(supabase, category);

// 2. NUOVO: Carica la provider chain per questa categoria
const providers = await loadProviderChain(supabase, categoryConfig.id, 'analysis');
// Fallback: se nessuna config specifica, usa la chain di default (category_id IS NULL)

// 3. Chiama Gemini con failover
const result = await analyzeWithFailover(providers, crops, negative, prompt);

// 4. NUOVO: Salva telemetria
await saveInferenceTelemetry(supabase, {
  executionId, imageId, userId,
  sportCategoryCode: categoryConfig.code,
  aiModelCode: result.providerUsed.model,
  location: result.providerUsed.location,
  sdkType: result.providerUsed.sdk,
  inferenceTimeMs: result.inferenceTimeMs,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  success: true,
  retryCount: result.retryCount,
  wasFallback: result.retryCount > 0,
  resultsCount: cropAnalysis.length,
  avgConfidence: /* media delle confidence */
});
```

### Query Utili sulla Telemetria

```sql
-- Performance media per modello negli ultimi 7 giorni
SELECT
  ai_model_code,
  location,
  COUNT(*) as total_calls,
  AVG(inference_time_ms) as avg_time_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY inference_time_ms) as p95_time_ms,
  AVG(estimated_cost_usd) as avg_cost,
  SUM(CASE WHEN success THEN 1 ELSE 0 END)::float / COUNT(*) as success_rate,
  AVG(retry_count) as avg_retries
FROM ai_inference_telemetry
WHERE created_at > now() - interval '7 days'
GROUP BY ai_model_code, location
ORDER BY total_calls DESC;

-- Fallback rate per categoria
SELECT
  sport_category_code,
  SUM(CASE WHEN was_fallback THEN 1 ELSE 0 END)::float / COUNT(*) as fallback_rate,
  COUNT(*) as total
FROM ai_inference_telemetry
WHERE created_at > now() - interval '7 days' AND success = true
GROUP BY sport_category_code;

-- Costo totale per utente nell'ultimo mese
SELECT
  user_id,
  SUM(estimated_cost_usd) as total_cost,
  COUNT(*) as total_analyses,
  AVG(inference_time_ms) as avg_time
FROM ai_inference_telemetry
WHERE created_at > now() - interval '30 days'
GROUP BY user_id
ORDER BY total_cost DESC;
```

### Modifiche a `sport_categories`

La tabella esistente non richiede nuove colonne per l'AI, perché la configurazione è ora delegata a `ai_provider_configs`. Tuttavia, serve deprecare:

```sql
-- Deprecare (mantenere per retrocompatibilità, ma non più usati dalla V6):
-- sport_categories.edge_function_version → sempre 6
-- sport_categories.recognition_method → spostato in ai_provider_configs.purpose
```

Il campo `ai_prompt` e `fallback_prompt` restano in `sport_categories` perché sono specifici del dominio sportivo, non del modello AI.

---

## Riepilogo Decisioni

| Tema | Decisione | Motivazione |
|------|-----------|-------------|
| Retry strategy | Provider chain con failover multi-location | 429 su global non si risolve ritentando lo stesso endpoint |
| Location default | `europe-west4` (EU) con fallback a `global` | GDPR, DB a Francoforte |
| V6 | Funzione unica, assorbe V3+V5+V6 | Eliminare frammentazione e manutenzione multipla |
| V4 (RF-DETR) | Resta separata (diverso provider) | RF-DETR non usa Gemini, flusso completamente diverso |
| Visual Tagging | Integrato in V6 come step opzionale | Evita doppio download immagine |
| Modello tagging | `gemini-2.5-flash-lite` | 5x più economico, sufficiente per tag, disponibile in EU |
| Modello analisi | `gemini-3-flash-preview` (primario) | Migliore qualità per race number detection |
| Configurazione AI | Nuove tabelle `ai_models` + `ai_provider_configs` | Switch modello senza deploy, configurabile per categoria |
| Telemetria | Nuova tabella `ai_inference_telemetry` | Dati reali per ottimizzare scelte modello/location |
| Retry desktop | Estendere a 429/503/Resource Exhausted | Fix immediato per issues #55, #57 |

---

## Priorità di Implementazione

1. **Immediato (fix issues):** Estendere retry desktop per 429/503 in `unified-image-processor.ts`
2. **Breve termine:** Multi-provider failover in V6 `gemini-analyzer.ts`
3. **Medio termine:** Tabelle `ai_models`, `ai_provider_configs`, `ai_inference_telemetry`
4. **Medio termine:** Visual Tagging integrato in V6
5. **Lungo termine:** Migrazione tutte le categorie a V6, deprecare V1-V5
6. **Lungo termine:** Dashboard admin per performance AI e switch modelli
