# Piano di Implementazione: Sistema di Error Telemetry Automatico

## Obiettivo

Creare un sistema che rileva automaticamente i failure critici nel desktop app, li reporta a Supabase con deduplicazione globale (cross-utente), e crea/aggiorna GitHub issues automaticamente — permettendo di anticipare le segnalazioni degli utenti e capire se un problema è isolato o diffuso.

---

## Architettura

```
DESKTOP APP (Pipeline di processing)
    ↓ [Rileva critical failure]
    ↓
ERROR TELEMETRY SERVICE (nuovo, src/utils/)
├─ Genera fingerprint deterministico
├─ Rate limit (max 5/esecuzione, 20/giorno)
├─ Smart log snapshot (50-100 righe contestuali)
├─ Sanitizza dati privacy (path, email, nomi)
├─ Rispetta opt-out utente
└─ Accoda e invia async (batch ogni 30s)
    ↓
SUPABASE (buffer + deduplicazione globale)
├─ error_reports        → 1 riga per fingerprint globale (cross-utente)
├─ error_occurrences    → 1 riga per ogni occorrenza singola
└─ error_issue_mappings → fingerprint → GitHub issue #
    ↓
EDGE FUNCTION: report-automatic-error
├─ Upsert error_report (incrementa contatore se esiste)
├─ Inserisce occurrence con contesto specifico
├─ Se fingerprint NUOVO → Crea GitHub issue
├─ Se fingerprint ESISTENTE → Aggiunge commento con conteggio utenti
├─ Se affected_users > 5 → Aggiunge label "widespread"
└─ Upload log completo su Storage + link nell'issue
    ↓
GITHUB ISSUES (repo fedepasi/racetagger-desktop-v2)
└─ [AUTO] Titolo con tipo errore + conteggio utenti affetti
```

---

## Fase 1: Migration Database

**File:** `../racetagger-app/supabase/migrations/20260216120000_create_error_telemetry.sql`

### Tabella `error_reports` (deduplicata globale)

Una riga per fingerprint unico. Aggrega tutti gli utenti che hanno lo stesso problema.

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| id | UUID PK | |
| fingerprint | TEXT UNIQUE | Hash di: error_type + messaggio normalizzato + batch_phase |
| error_type | TEXT NOT NULL | `raw_conversion`, `edge_function`, `onnx_model`, `token_reservation`, `segmentation`, `zero_results`, `memory`, `uncaught` |
| severity | TEXT | `fatal`, `recoverable`, `warning` |
| error_message | TEXT | Primo messaggio (sanitizzato), max 500 chars |
| error_stack | TEXT | Stack trace (sanitizzato), max 1000 chars |
| first_app_version | TEXT | Versione app del primo report |
| latest_app_version | TEXT | Versione app dell'ultimo report |
| total_occurrences | INTEGER DEFAULT 1 | Quante volte è successo in totale |
| affected_user_count | INTEGER DEFAULT 1 | Quanti utenti diversi |
| affected_user_ids | UUID[] | Array di user_id unici |
| github_issue_number | INTEGER | Numero issue dopo creazione |
| github_issue_url | TEXT | URL completa dell'issue |
| is_widespread | BOOLEAN DEFAULT FALSE | true se affected_user_count >= 5 |
| first_seen_at | TIMESTAMPTZ | Prima occorrenza |
| last_seen_at | TIMESTAMPTZ | Ultima occorrenza |
| created_at | TIMESTAMPTZ | |

### Tabella `error_occurrences` (ogni singola occorrenza)

Una riga per ogni volta che un utente incontra l'errore. Permette di vedere il dettaglio di ogni caso.

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| id | UUID PK | |
| error_report_id | UUID FK → error_reports | |
| user_id | UUID FK → auth.users | |
| execution_id | UUID nullable | FK a executions se durante un'esecuzione |
| app_version | TEXT | Versione app di questa occorrenza |
| batch_phase | TEXT | Fase del pipeline dove è successo |
| image_index | INTEGER | Quale immagine nel batch |
| total_images | INTEGER | Totale immagini nel batch |
| os | TEXT | macOS/Windows/Linux |
| os_version | TEXT | |
| arch | TEXT | arm64/x64 |
| cpu_model | TEXT | |
| ram_available_gb | NUMERIC | |
| log_snapshot | TEXT | 50-100 righe contestuali (sanitizzate) |
| log_storage_path | TEXT | Path su Supabase Storage al log completo |
| execution_context | JSONB | Contesto aggiuntivo (categoria, preset, config) |
| created_at | TIMESTAMPTZ | |

### Tabella `error_issue_mappings` (fingerprint → GitHub)

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| fingerprint | TEXT PK | |
| github_issue_number | INTEGER UNIQUE | |
| github_issue_url | TEXT | |
| issue_state | TEXT DEFAULT 'open' | |
| last_commented_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### RPC Function `upsert_error_report`

Logica atomica server-side:
1. Cerca `error_reports` per fingerprint
2. Se esiste: incrementa `total_occurrences`, aggiorna `last_seen_at`, aggiunge user_id a `affected_user_ids` se nuovo, aggiorna `affected_user_count`
3. Se non esiste: crea nuova riga
4. In entrambi i casi: inserisce `error_occurrences` con il dettaglio
5. Ritorna: `report_id`, `is_new_fingerprint`, `total_occurrences`, `affected_user_count`, `github_issue_number`

### RLS Policies

- `error_reports`: SELECT per admin (via user_role), INSERT per authenticated
- `error_occurrences`: SELECT dove user_id = auth.uid() oppure admin, INSERT per authenticated
- `error_issue_mappings`: SELECT/INSERT solo per service_role (Edge Function)

### Indici

- `error_reports(fingerprint)` — UNIQUE, lookup principale
- `error_reports(error_type)` — filtro per tipo
- `error_reports(last_seen_at DESC)` — ordinamento temporale
- `error_occurrences(error_report_id)` — join con report
- `error_occurrences(user_id)` — query per utente
- `error_occurrences(created_at DESC)` — ordinamento temporale

---

## Fase 2: Error Telemetry Service (Desktop)

**File nuovo:** `src/utils/error-telemetry-service.ts` (~500 righe)

### Responsabilità

1. **Fingerprint**: SHA-256 di `errorType::normalizedMessage::batchPhase::os` — deterministico e stabile
2. **Rate limiting**: Max 5 report per esecuzione, 20 per giorno (sliding window in-memory)
3. **Smart log snapshot**: Prende le ultime 2000 righe dal diagnostic-logger, filtra per le righe dei 30s prima dell'errore + righe ERROR/WARN + righe con lo stesso imageId/operazione, taglia a ~100 righe
4. **Privacy sanitization**: Regex per rimuovere path assoluti (`/Users/xxx/` → `<PATH>`), email, nomi da CSV, numeri partecipanti specifici
5. **Opt-out**: Controlla `user-preferences-service` per il flag `telemetry_enabled` (default: true)
6. **Batch queue**: Accumula report in-memory, flush ogni 30s o quando la coda raggiunge 5 items
7. **Non-blocking**: Tutto è fire-and-forget, errori interni loggati ma mai propagati

### Interfaccia pubblica

```typescript
interface CriticalErrorReport {
  errorType: 'raw_conversion' | 'edge_function' | 'onnx_model' |
             'token_reservation' | 'segmentation' | 'zero_results' |
             'memory' | 'uncaught';
  severity: 'fatal' | 'recoverable' | 'warning';
  error: Error | string;
  executionId?: string;
  batchPhase?: string;
  imageIndex?: number;
  totalImages?: number;
  categoryName?: string;
  presetName?: string;
}

class ErrorTelemetryService {
  static getInstance(): ErrorTelemetryService;

  // API principale — chiamata dai punti critici
  reportCriticalError(report: CriticalErrorReport): void;  // fire-and-forget, sincrono

  // Stato
  getStatus(): { queued: number; sentToday: number; enabled: boolean };

  // Cleanup
  dispose(): void;  // flush coda + clear timer
}
```

### Pattern di utilizzo nei punti critici

```typescript
// NON await — completamente non-blocking
ErrorTelemetryService.getInstance().reportCriticalError({
  errorType: 'raw_conversion',
  severity: 'fatal',
  error: err,
  executionId: this.currentExecutionId,
  batchPhase: 'raw_preview',
  imageIndex: i,
  totalImages: total
});
// Il processing continua normalmente
```

---

## Fase 3: Edge Function

**File nuovo:** `supabase/functions/report-automatic-error/index.ts` (~350 righe)

### Flow

1. **Auth**: Valida Bearer token, estrae user_id
2. **Chiama RPC** `upsert_error_report` con il payload dal desktop
3. **Upload log**: Se il desktop ha incluso il log snapshot esteso, lo carica su Storage bucket `analysis-logs` con path `auto-errors/{fingerprint}/{occurrence_id}.txt`, genera signed URL (7 giorni)
4. **GitHub logic**:
   - Se `is_new_fingerprint = true`: crea nuova issue con labels `[auto-report, {error_type}]`, assegnata a `fedepasi`
   - Se `is_new_fingerprint = false` E `affected_user_count` è cambiato: aggiunge commento "🔄 Utente #N affetto — v{version}, {os} {arch}" con link al log
   - Se `affected_user_count >= 5` e non ancora `widespread`: aggiunge label `widespread` all'issue
5. **Aggiorna** `error_issue_mappings` e `error_reports.github_issue_number`
6. **Return**: `{ success, issueNumber, issueUrl, isNew, affectedUsers }`

### Formato Issue GitHub

**Titolo:** `[AUTO] {error_type}: {messaggio breve} (v{app_version})`

**Body:**
```markdown
## Errore Automatico

**Tipo:** {error_type}
**Severità:** {severity}
**Fase pipeline:** {batch_phase}
**Prima segnalazione:** {first_seen_at}
**Utenti affetti:** {affected_user_count}

## Messaggio di Errore

{error_message}

## Stack Trace

{error_stack}

## Contesto Esecuzione

- App: v{app_version}
- OS: {os} {os_version} ({arch})
- CPU: {cpu_model} ({cpu_cores} cores)
- RAM disponibile: {ram_gb} GB
- Categoria: {category_name}
- Batch: immagine {image_index}/{total_images}

## Log Contestuale (ultimi 30s)

```
{log_snapshot - 50-100 righe}
```

## Log Completo

[Scarica log completo]({signed_url}) (disponibile per 7 giorni)

---
*Report automatico generato da RaceTagger Error Telemetry v1.0*
*Fingerprint: `{fingerprint}`*
```

### Formato Commento (occorrenze successive)

```markdown
🔄 **Nuova occorrenza** — Utente #{affected_user_count}

- App: v{version}, {os} {arch}
- Fase: {batch_phase}, immagine {index}/{total}
- [Log completo]({signed_url})

*Totale occorrenze: {total_occurrences} | Utenti affetti: {affected_user_count}*
```

---

## Fase 4: IPC Handlers

**File nuovo:** `src/ipc/error-telemetry-handlers.ts` (~150 righe)

### Handlers (3)

1. **`get-telemetry-status`** — Ritorna stato del servizio (coda, report oggi, enabled/disabled)
2. **`set-telemetry-enabled`** — Toggle opt-out (salva in user preferences)
3. **`flush-telemetry-queue`** — Forza invio coda (utile per debug/admin)

### Registrazione

- Aggiungere in `src/ipc/index.ts`: import + registrazione
- Aggiungere in `src/preload.ts`: 3 canali nella whitelist `validInvokeChannels`

---

## Fase 5: Integrazione nei Punti Critici

### 1. RAW Conversion (`src/utils/raw-preview-native.ts`)

**Dove:** Nel blocco catch dopo che ENTRAMBI native + ExifTool fallback hanno fallito
**Quando:** `success: false` e nessun fallback disponibile

### 2. Edge Function Errors (`src/unified-image-processor.ts`)

**Dove:** Nei catch block delle chiamate a `analyzeImageDesktopV6`
**Quando:** Status 5xx, timeout, o 3+ errori consecutivi nello stesso batch
**Nota:** NON reportare singoli 429 (rate limit) — solo errori persistenti

### 3. ONNX Model Failure (`src/model-manager.ts`)

**Dove:** Nel catch di `loadModel()` e `downloadModel()`
**Quando:** Download fallito dopo 3 retry, o modello corrotto

### 4. Token Reservation (`src/auth-service.ts`)

**Dove:** Nel catch di `preAuthorizeTokens()` e `finalizeTokenReservation()`
**Quando:** Reservation fallita, o mismatch nel finalize (tokens usati > riservati)

### 5. Zero Results Anomaly (`src/unified-image-processor.ts`)

**Dove:** Alla fine del batch processing, prima del summary
**Quando:** Batch con >20 immagini e 0 numeri riconosciuti in TUTTE le immagini
**Severity:** `warning` (non fatal, potrebbe essere legittimo)

### 6. Segmentation Failure (`src/generic-segmenter.ts`)

**Dove:** Nel catch del processo di segmentazione YOLOv8
**Quando:** ONNX inference failure o output malformato

### 7. Uncaught Exceptions (`src/main.ts`)

**Dove:** Nei handler `process.on('uncaughtException')` e `process.on('unhandledRejection')`
**Quando:** Qualsiasi eccezione non gestita (severity: fatal)

---

## Fase 6: Opt-Out nelle Settings

**File da modificare:** `src/user-preferences-service.ts`

- Aggiungere campo `error_telemetry_enabled: boolean` (default: `true`)
- `ErrorTelemetryService` controlla questo flag prima di ogni report

**File da modificare:** `renderer/pages/settings.html` + `renderer/js/settings.js`

- Aggiungere toggle nella sezione Privacy/Avanzate:
  "Invia automaticamente report di errore anonimi per migliorare RaceTagger"
- Toggle chiama `window.api.invoke('set-telemetry-enabled', value)`

---

## Fase 7: Testing

### Unit Test (`tests/error-telemetry.test.ts`)

- Fingerprint deterministico (stesso input = stesso hash)
- Privacy sanitization (path, email, nomi rimossi)
- Rate limiting (5° report bloccato per stessa esecuzione)
- Smart log snapshot (filtra correttamente per contesto)
- Opt-out rispettato (nessun report quando disabled)

### Test Manuale

- Forzare un RAW conversion failure → verificare issue creata su GitHub
- Forzare stesso errore da secondo utente → verificare commento aggiunto
- Verificare che log sanitizzato non contenga dati personali
- Verificare rate limit: 6° errore nella stessa esecuzione non invia
- Verificare opt-out: toggle off → nessun report inviato
- Verificare che il processing NON rallenta (telemetry non-blocking)

---

## File da Creare/Modificare — Riepilogo

### File NUOVI (4):
1. `../racetagger-app/supabase/migrations/20260216120000_create_error_telemetry.sql` — Schema + RPC + RLS
2. `src/utils/error-telemetry-service.ts` — Servizio core (~500 righe)
3. `supabase/functions/report-automatic-error/index.ts` — Edge Function (~350 righe)
4. `src/ipc/error-telemetry-handlers.ts` — IPC handlers (~150 righe)

### File da MODIFICARE (9):
5. `src/ipc/index.ts` — Registrare nuovi handlers
6. `src/preload.ts` — Aggiungere 3 canali alla whitelist
7. `src/user-preferences-service.ts` — Aggiungere `error_telemetry_enabled`
8. `src/utils/raw-preview-native.ts` — Aggiungere report al fallback finale
9. `src/unified-image-processor.ts` — Aggiungere report a Edge Function errors + zero results
10. `src/model-manager.ts` — Aggiungere report a model load/download failure
11. `src/auth-service.ts` — Aggiungere report a token reservation failure
12. `src/generic-segmenter.ts` — Aggiungere report a segmentation failure
13. `src/main.ts` — Aggiungere report a uncaught exception/rejection

### File OPZIONALI (3, UI):
14. `renderer/pages/settings.html` — Toggle opt-out
15. `renderer/js/settings.js` — Logica toggle
16. `tests/error-telemetry.test.ts` — Unit test

### File da NON toccare:
- `src/utils/error-tracker.ts` — Resta com'è, ErrorTelemetryService lo usa internamente
- `src/utils/diagnostic-logger.ts` — Resta com'è, ErrorTelemetryService chiama `getRecentLogs()`
- `src/utils/analysis-logger.ts` — Resta com'è
- `src/ipc/feedback-handlers.ts` — Il feedback manuale utente resta separato

---

## Ordine di Implementazione Consigliato

1. **Migration** — Crea tabelle + RPC (necessario prima di tutto)
2. **ErrorTelemetryService** — Servizio core con fingerprint, sanitization, rate limit, smart snapshot
3. **Edge Function** — GitHub issue creation + deduplicazione + commenti
4. **IPC Handlers** — Registrazione + preload whitelist
5. **Integrazione punti critici** — Uno alla volta, partendo da RAW conversion (più frequente)
6. **Opt-out UI** — Toggle nelle settings
7. **Test** — Unit + manuale
8. **Deploy** — Migration → Edge Function → App build
