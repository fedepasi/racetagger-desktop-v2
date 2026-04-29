# Proposta — Issue #124: Verifica lentezza allo start

**Link:** https://github.com/fedepasi/racetagger-desktop-v2/issues/124
**Autore:** fedepasi (`fede.pasi+2@gmail.com`) · **Aperta:** 2026-04-28T06:59:16Z · **Aggiornata:** 2026-04-28T06:59:16Z
**Label:** bug, user-feedback
**App version:** 1.1.4 · **OS:** Windows 10 · **Electron:** 36.9.5

---

## Problema segnalato

L'utente riporta che, dopo aver cliccato **"Avvia analisi"**, l'analisi ha impiegato "parecchio tempo" a partire; una volta avviata, è proseguita correttamente. Si tratta dell'avvio dell'**analisi**, non dell'avvio dell'app: l'app si era aperta circa 14 minuti prima senza problemi (sessione log iniziata a 06:43:57). Diagnostic report scaricato (`support_1777359554628_t5hfg5.txt`, 54 KB) e timeline ricostruita.

## Impatto

> **Nota di scope:** il delay è tra il **click su "Avvia analisi" e l'inizio effettivo del processing della prima immagine**, NON tra l'apertura dell'app e il login. L'app si avvia regolarmente (06:43:57 nel log) e resta perfettamente reattiva per 14 minuti mentre l'utente fa login, sceglie il preset e seleziona la cartella. Solo quando clicca "Avvia analisi" parte il download del modello. Il problema è quindi **l'inizializzazione lazy della pipeline di analisi**, non l'avvio dell'applicazione.

- **Severità:** medio (alla **prima analisi** dopo un'installazione, un upgrade dell'app, oppure quando si lancia un'analisi su una sport category il cui modello non è ancora in cache — può sembrare un blocco totale).
- **Utenti colpiti:** **tutti** alla prima analisi post-installazione/upgrade. Dopo che il modello è cached le analisi successive partono velocemente, ma il primo "Avvia" — esattamente il momento di massima attenzione dell'utente — è quello che fa scattare i ~30s di download.
- **Effetto su metriche:** churn risk alla prima analisi. Tentazione di chiudere/riaprire l'app pensando che sia bloccata, con possibile perdita dei token pre-autorizzati (TTL 30min, vedi log riga 122).

## Causa radice (confermata dal log)

Timeline ricostruita dal diagnostic:

```
06:57:52.080  [Execution] Created execution ... category="motorsport_v3"
06:57:52.229  [PreAuth]   Authorized 19 tokens                                 ← +149ms (OK)
06:57:52.229  [WorkerPool] Initializing pool with 10 workers...
06:57:52.479  [ModelManager] Model not cached, downloading from Supabase...    ← inizio download
06:58:21.140  [WorkerPool] ✅ Pool initialized                                  ← +28.7s ⚠️
06:58:21.141  [RAW-Calibration] Calibrating 3 RAW format(s)...                 ← +281ms
06:58:21.417  [HardwareDetector] Hardware info collected
06:58:22.559  [NetworkMonitor]   supabase_latency_ms: 1133
06:58:25.519  [RAW-Extract] _DSC3675.ARW: native returned 160x120, fallback ExifTool... ← +5-7s ⚠️
06:58:32.739  [CropContextExtractor] Extracted 2 crops with masks in 232ms
06:58:41.557  [Timing]   PAS_9234.NEF total=16092ms                            ← prima immagine completata
```

**Click Start → prima immagine fatta = ~50 secondi.** Di cui:

| Fase | Tempo | Verdetto |
|---|---|---|
| Creazione execution + pre-auth tokens | 149ms | ✅ OK |
| Sport categories cached | <10ms | ✅ OK |
| **Download modello YOLO segmentation (42 MB) da Supabase** | **~28.7s** | 🔴 **Dominante** |
| Calibrazione RAW formats | 281ms | ✅ OK |
| Network monitor (latency check Supabase: 1133ms) | ~1.4s | ⚠️ accettabile ma migliorabile |
| **Fallback ExifTool su ARW Sony** (preview native ha restituito 160×120) | **~5-7s** | 🔴 **Secondario** |
| Estrazione crops + mask + sharpness check | ~6-8s | ✅ fisiologico |
| AI analysis prima immagine (Edge Function V6) | ~9-11s | ✅ fisiologico |

**File da modificare per la causa principale:** il modello `yolo26-detector-v1` (42 MB, definito in `src/yolo-model-registry.ts:127`) viene scaricato da `ModelManager.ensureGenericModelAvailable()` (`src/model-manager.ts:672`) all'interno di `GenericSegmenter.doLoadModel()` (`src/generic-segmenter.ts:228`), che a sua volta è chiamato da `initializeGenericSegmenter()` in `src/unified-image-processor.ts:573` durante `UnifiedImageWorker.create()`.

⚠️ **Correzione rispetto all'analisi precedente:** il modello **viene effettivamente usato** (è il YOLO-seg che estrae crops con mask per il flusso V6 di Gemini). Non si può "saltarlo". `crop_config.enabled` è `true` per `motorsport_v3` ed è giusto così. Il fix non è un guard mancante, ma cambiare *quando* e *come* il modello arriva sul disco dell'utente.

## Soluzione proposta

Il fix richiede **più di una mossa**, in ordine di priorità decrescente. Il primo da solo risolve l'issue al 100%; gli altri sono migliorie complementari.

### Fix #1 — Estendere `checkAndDownloadModels()` per scaricare i modelli di TUTTE le sport categories abilitate per l'utente ⭐ (priorità massima)

**Esiste già l'infrastruttura.** In `src/main.ts:2764` c'è una funzione `checkAndDownloadModels()` che viene chiamata all'avvio dell'app (`main.ts:3170: await checkAndDownloadModels()`) e che:

- usa `modelManager.getModelsToDownload()` per capire quali modelli mancano,
- mostra una progress modal nel renderer (`safeSend('model-download-start', { totalModels, totalSizeMB })`),
- scarica con `modelManager.downloadModel(model.code, onProgress)` un modello alla volta in serie,
- emette `model-download-progress` con `{ currentModel, totalModels, modelPercent, downloadedMB, totalMB }`,
- chiude con `model-download-complete`.

L'utente vede già una UI di download all'avvio per altri modelli (es. `scene-classifier`). Il problema è che `getModelsToDownload()` **non include** i modelli del registry YOLO (`yolo26-detector-v1`, ecc. — `src/yolo-model-registry.ts`) perché usa un sistema "code" diverso da `ensureGenericModelAvailable(modelId)` del segmenter.

**Soluzione:** estendere `getModelsToDownload()` (o creare una funzione gemella `getYoloModelsToDownload()` chiamata in sequenza) per recuperare anche:

1. La lista di **tutte le sport categories abilitate per l'utente in questione** (query DB su `sport_categories`, filtrata per i permessi/sottoscrizione dell'utente).
2. Per ognuna che ha `crop_config.enabled === true`, il `segmentation_config.model_id` (o il default `getDefaultModelId()` = `'yolo26-detector-v1'`).
3. Per ognuna che ha `use_local_onnx === true`, l'eventuale modello detector.
4. Aggregare in un'unica lista **deduplicata** (più categorie possono condividere lo stesso modello, es. tutte le motorsport_* probabilmente usano `yolo26-detector-v1`), e per ognuno verificare con `modelManager.getGenericModelPath(modelId)` (che già esiste, model-manager.ts:765) se è già su disco. Se no, va aggiunto alla lista da scaricare.

In `checkAndDownloadModels()` aggiungere un secondo loop dopo i modelli "code-based" che usa `ensureGenericModelAvailable(modelId, onProgress)`. La callback `onProgress(percent, downloadedMB, totalMB)` esiste già nella firma (model-manager.ts:751-755) ma non veniva mai passata: ora la cabliamo all'evento `model-download-progress` esistente.

**Risultato dal punto di vista utente:**
- Al primo avvio dopo install/upgrade: progress modal "Aggiornamento modelli AI: 1/3 — 12 / 100 MB". Trasparente, professionale, non sembra un bug. Il download viene **prima** del wizard di analisi, in un momento in cui l'utente si aspetta ragionevolmente un'attesa (ha appena lanciato un'app appena installata).
- Negli avvi successivi: cache hit, nessun download, nessuna attesa.
- Al click "Avvia analisi" (sempre): modello già su disco → `ensureGenericModelAvailable` ritorna in <10ms → la pipeline parte immediatamente.

- **Costo:** ~50-80 LOC distribuite tra `model-manager.ts` (estensione di `getModelsToDownload`), `main.ts` (loop aggiuntivo in `checkAndDownloadModels`), e `database-service.ts` (helper `getUserEnabledSportCategories()` se non esiste già). Zero LOC nel renderer — la UI di progress c'è già.
- **Beneficio:** **0 secondi** di attesa al click "Avvia analisi", su qualsiasi rete, **per sempre** dopo il primo avvio.
- **Rischio:** basso — riusiamo l'infrastruttura esistente e aggiungiamo solo nuovi modelli al loop. Test richiesto: avvio dell'app con cache vuota → verificare che la progress modal mostri tutti i modelli (vecchi + nuovi YOLO) e che al termine `getGenericModelPath(modelId)` ritorni un path valido.

### Fix #2 — Bundle del modello YOLO nell'installer (complementare al #1)

`ModelManager.ensureGenericModelAvailable` (model-manager.ts:684-692) cerca **già** il modello come "bundled" prima di scaricarlo. Basta inserire il file nei path corretti (vedi `getModelPaths()`) e l'installer li include automaticamente in `app.asar.unpacked`.

- **Costo:** +42 MB sull'installer (oggi RaceTagger è ~150 MB per il portable Windows; +28% di download al setup).
- **Beneficio:** zero attesa anche al **primo avvio** dopo install/upgrade (Fix #1 da solo richiede comunque un download al primo boot, anche se mostrato con UI elegante). Se il bundle è incluso, `checkAndDownloadModels()` salta il download grazie al check bundled-first.
- **Implementazione:** aggiungere il file binario in `racetagger-clean/models/detector/yolo26-detector-v1-v1.0.onnx`, aggiornare `electron-builder.yml` (sezione `asarUnpack` o `extraResources`), verificare che `getModelPaths()` includa `process.resourcesPath`. Considerare Git LFS per non gonfiare il repo.
- **Quando il modello cambia version:** l'utente fa il download una volta tramite Fix #1, poi il nuovo bundled prende il sopravvento al successivo upgrade dell'app. La logica c'è già.

**Decisione raccomandata:** fare **Fix #1 subito** (risolve l'issue), e **Fix #2 in un secondo momento** quando si fa una release con un installer aggiornato. Insieme sono optimal: bundle copre il primo boot dopo install, `checkAndDownloadModels` copre gli aggiornamenti del modello server-side.

### Fix #3 — Progress UI sul download lazy (rete di sicurezza, se #1 non venisse adottato)

Solo se per qualche motivo non si vuole estendere `checkAndDownloadModels()` e si lascia il download nel path lazy attuale (al click "Avvia"): cablare la callback `onProgress(percent, downloadedMB, totalMB)` di `ensureGenericModelAvailable` (model-manager.ts:751-755), che oggi **esiste ma non viene mai passata**. Da `GenericSegmenter.doLoadModel()` (generic-segmenter.ts:228) → passare la callback → emettere `model-download-progress` via `EventEmitter` → main → renderer.

Con il Fix #1 questo non serve perché il download non avverrà più al click "Avvia". È una rete di sicurezza per evitare regressioni se in futuro un nuovo modello del registry viene introdotto senza aggiornare `getModelsToDownload()`.

- **Costo:** ~50 LOC distribuiti su 3 file.
- **Beneficio:** anche se per errore un modello sfuggisse al pre-download al boot, l'utente vedrebbe almeno una progress bar invece di "bloccato".

### Fix #4 — Parallelizzare l'init dei sotto-sistemi (micro-opt)

In `UnifiedImageWorker.create()` (unified-image-processor.ts:450) gli init sono in serie:

```ts
await worker.initializeParticipantsData();        // (DB)
await worker.initializeSportConfigurations();     // (cache + DB se miss)
await worker.initializeSceneClassifier();         // (ONNX, salta se non abilitato)
await worker.initializeOnnxDetector();            // (ONNX, salta se use_local_onnx=false)
await worker.initializeGenericSegmenter();        // (ONNX, sempre attivo per crop_config.enabled) ← qui il download
await worker.initializeFaceRecognition();         // (face descriptors)
await worker.initializeTrainingConsent();         // (DB)
```

Sport configurations è una dipendenza dei sotto-sistemi (`currentSportCategory`), ma scene/onnx/segmenter/face/consent sono indipendenti tra loro. Si può:

```ts
await worker.initializeParticipantsData();
await worker.initializeSportConfigurations();
await Promise.all([
  worker.initializeSceneClassifier(),
  worker.initializeOnnxDetector(),
  worker.initializeGenericSegmenter(),
  worker.initializeFaceRecognition(),
  worker.initializeTrainingConsent(),
]);
```

- **Costo:** 5 LOC.
- **Beneficio:** se il download non è il colpevole (caso post-Fix-#1), gli altri init che richiedono I/O (scene classifier ONNX, face descriptors) possono andare in parallelo. Risparmio ~1-2s su laptop tipici.
- **Rischio:** verificare che non ci siano dipendenze nascoste sull'ordine (sembra di no leggendo il codice, ma serve un test E2E).

### Fix #5 — Investigare il fallback ExifTool sui RAW Sony (separato, beneficio collaterale)

Il log mostra:
```
06:58:25.519 [RAW-Extract] _DSC3675.ARW: Native extractFullPreview returned 160x120
              but calibration expected ~6144x4096. Trying ExifTool...
```

Il native addon `raw-preview-extractor` ha restituito la thumbnail mini (160×120) invece della preview full (6144×4096) per un ARW. ExifTool fa fallback corretto ma è ~5× più lento. Vale la pena aprire una issue separata e indagare se è un problema specifico di alcuni ARW Sony (es. metadata non standard, makernote particolare). Questo non è il colpevole principale di #124, ma rallenta sistematicamente il primo extract di ARW.

## Stima sforzo

Riepilogo per livello di intervento:

| Fix | Effort | Risk | Risolve #124? |
|---|---|---|---|
| **#1** Estendere `checkAndDownloadModels()` per i YOLO | **M** (3-5h: estendi `getModelsToDownload`, cabla `ensureGenericModelAvailable`, query DB sport categories utente, test) | basso | ✅ 100% (con UI di progress già esistente) |
| **#2** Bundle modello nell'installer | S (1-3h: aggiungi file 42 MB, `electron-builder.yml`, test packaged build cross-platform) | basso | ✅ copre primo boot post-install |
| **#3** Progress UI sul lazy download | S (2-3h) | basso | rete di sicurezza, non necessario se #1 |
| **#4** Parallelizzare init in `UnifiedImageWorker.create()` | XS (<1h) | medio (test regressione completo) | ⚠️ micro-opt secondaria |
| **#5** ARW native (issue separata) | M (4-8h, indagine sul native addon) | medio | ❌ issue separata |

**Per chiudere #124:** **Fix #1 da solo è sufficiente** (3-5h). Fix #2 è un upgrade complementare che eliminava anche il primo download dopo install — da fare se possibile per la stessa release v1.1.5, altrimenti per la successiva.

Test richiesti:
- **manual on real data:** ripetere l'esecuzione su `Mix-raw-jpeg` (cartella dell'utente) **dopo aver svuotato `%APPDATA%\racetagger-desktop\models\`**, misurare il delta click → primo `[Timing]`. Target post-#1: <8s. Target post-#1+#3: <8s con UI chiara.
- **regression:** verificare che il packaged build su macOS (sia arm64 che x64), Windows, Linux includa effettivamente il file. Comando di verifica: `7z l RaceTagger.exe | grep yolo26`.
- **upgrade scenario:** simulare un utente con modello v1.0 che riceve un app update con modello v1.1 bundled — la logica `getModelPaths` deve preferire il bundled v1.1 (la cache v1.0 in AppData rimane orfana finché il cleanup la rimuove, comportamento già esistente).
- **DB query:** `SELECT name, use_local_onnx, recognition_method, crop_config->'enabled' as crop_enabled FROM sport_categories;` per documentare quante categorie sfruttano il segmenter (probabilmente: tutte).

## Priorità consigliata

**P1 — questa settimana.** Fix banale per il #1 (~3 ore, comprese build packaged), impatto su tutti gli utenti nuovi al primo run. Il rilascio v1.1.5 deve includere il modello bundled.

---

## Proposed patch sketch

### Fix #1 (estendere `checkAndDownloadModels`)

```ts
// src/model-manager.ts — nuova funzione gemella di getModelsToDownload()
ModelManager.prototype.getYoloModelsToDownload = async function(
  this: ModelManager,
  userCategories: SportCategory[]  // dal DB
): Promise<{ models: { modelId: string; sizeMB: number }[]; totalSizeMB: number }> {
  const needed = new Set<string>();

  for (const cat of userCategories) {
    // Parse crop_config (potrebbe essere JSON string)
    const cropConfig = typeof cat.crop_config === 'string'
      ? JSON.parse(cat.crop_config)
      : cat.crop_config;
    if (cropConfig?.enabled) {
      const segConfig = parseSegmentationConfig(cat.segmentation_config);
      needed.add(segConfig?.model_id || getDefaultModelId());
    }
    if (cat.use_local_onnx) {
      // Se in futuro c'è un campo cat.detector_model_id, aggiungilo qui
    }
  }

  const toDownload: { modelId: string; sizeMB: number }[] = [];
  let totalSizeMB = 0;

  for (const modelId of needed) {
    if (this.getGenericModelPath(modelId)) continue;  // già su disco
    const config = getModelConfig(modelId);
    if (!config) continue;
    const sizeMB = config.sizeBytes / (1024 * 1024);
    toDownload.push({ modelId, sizeMB });
    totalSizeMB += sizeMB;
  }

  return { models: toDownload, totalSizeMB };
};

// src/main.ts — estendi checkAndDownloadModels() (line 2764)
async function checkAndDownloadModels(): Promise<void> {
  const modelManager = getModelManager();
  modelManager.setSupabaseClient(getSupabaseClient());

  // Step 1 — modelli "code-based" (esistente)
  const { models: codeModels, totalSizeMB: codeSize } = await modelManager.getModelsToDownload();

  // Step 2 — modelli YOLO del registry (NUOVO)
  const userCategories = await getUserEnabledSportCategories();  // helper da database-service
  const { models: yoloModels, totalSizeMB: yoloSize } =
    await modelManager.getYoloModelsToDownload(userCategories);

  const totalModels = codeModels.length + yoloModels.length;
  const totalSizeMB = codeSize + yoloSize;
  if (totalModels === 0) return;

  safeSend('model-download-start', { totalModels, totalSizeMB });

  let downloadedTotal = 0;
  let modelIndex = 0;

  // Loop esistente: code-based
  for (const model of codeModels) {
    modelIndex++;
    await modelManager.downloadModel(model.code, (percent, downloadedMB, totalMB) => {
      safeSend('model-download-progress', {
        currentModel: modelIndex, totalModels,
        modelPercent: percent,
        downloadedMB: downloadedTotal + downloadedMB,
        totalMB: totalSizeMB
      });
    });
    downloadedTotal += model.sizeMB;
  }

  // NUOVO loop: YOLO registry
  for (const yoloModel of yoloModels) {
    modelIndex++;
    await modelManager.ensureGenericModelAvailable(yoloModel.modelId, (percent, downloadedMB, totalMB) => {
      safeSend('model-download-progress', {
        currentModel: modelIndex, totalModels,
        modelPercent: percent,
        downloadedMB: downloadedTotal + downloadedMB,
        totalMB: totalSizeMB
      });
    });
    downloadedTotal += yoloModel.sizeMB;
  }

  safeSend('model-download-complete');
}
```

**Decisione di design (locked):** `getUserEnabledSportCategories()` ritorna **tutte** le sport categories abilitate per l'utente in questione (non solo quella default o quella più recente). Per ognuna deduplichiamo i model_id necessari e li scarichiamo. Vantaggi: l'utente non incontrerà mai il delay nemmeno cambiando categoria a metà sessione, e l'esperienza è uniforme tra tutti i workflow supportati dal suo account. Costo banda al primo avvio: con 2-3 modelli da ~40 MB ciascuno → 80-120 MB totali, scaricati in background con progress UI già esistente. Su rete normale (15-30 Mbit) sono 30-60 secondi che l'utente vede una sola volta.

Implementazione di `getUserEnabledSportCategories()`: query Supabase su `sport_categories` filtrata per quelle a cui l'utente ha accesso. Va deciso col DB schema:
- se esiste una tabella di mapping `user_sport_categories` (o `subscribers.enabled_categories`), usarla;
- altrimenti, se tutte le categorie sono globalmente disponibili e si distinguono solo per piano abbonamento, prendere tutte le categorie attive (`is_active=true`) della categoria di sottoscrizione utente.

Eseguire la query **una sola volta** all'avvio, prima del loop di download. Se la query fallisce per qualsiasi motivo, fare fallback a "tutti i modelli del registry" (lista hardcoded `Object.keys(YOLO_MODEL_REGISTRY)`) — in questo modo il bug critico non si ripresenta nemmeno in caso di errore DB.

### Fix #2 (bundle nell'installer, complementare)

```yaml
# electron-builder.yml o package.json#build
files:
  - "models/**/*"           # se non già presente
asarUnpack:
  - "models/**/*.onnx"      # i .onnx devono essere asar-unpacked per fs.existsSync()
extraResources:
  - from: "models/detector/yolo26-detector-v1-v1.0.onnx"
    to: "models/detector/yolo26-detector-v1-v1.0.onnx"
```

E aggiungere fisicamente il file in `racetagger-clean/models/detector/yolo26-detector-v1-v1.0.onnx` (scaricarlo una volta da Supabase con un piccolo script in `scripts/fetch-models.ts`, e committarlo tramite Git LFS se preferito per non gonfiare il repo).

Verificare che `getModelPaths(modelConfig)` (definito da qualche parte vicino a `model-manager.ts`) cerchi:
- `process.resourcesPath/models/...` (packaged)
- `process.cwd()/models/...` (dev)
- `__dirname/../models/...` (fallback)

Se manca uno di questi, aggiungerlo.

### Fix #3 (progress UI sul lazy path, solo se #1 non adottato)

```ts
// src/generic-segmenter.ts:228
finalModelPath = await modelManager.ensureGenericModelAvailable(
  this.config.modelId,
  (percent, downloadedMB, totalMB) => {
    this.emit('model-download-progress', { modelId: this.config.modelId, percent, downloadedMB, totalMB });
  }
);

// src/unified-image-processor.ts (in initializeGenericSegmenter, prima di loadModel)
this.genericSegmenter.on('model-download-progress', (data) => {
  this.emit('model-download-progress', data);  // re-emit verso main
});

// src/main.ts (dove ascoltiamo gli altri eventi del processor, ~line 1380)
unifiedImageProcessor.on('model-download-progress', (data) => {
  safeSend('model-download-progress', data);
});

// renderer/js/<analysis-page>.js — gestire l'evento
window.electronAPI.onModelDownloadProgress((data) => {
  showLoadingMessage(`Aggiornamento modello AI: ${data.downloadedMB.toFixed(1)} / ${data.totalMB} MB`);
});
```

E ovviamente esporre l'evento nel preload script (`contextBridge`).

### Fix #4 (parallelize init)

```ts
// src/unified-image-processor.ts:450
static async create(config, analysisLogger?, networkMonitor?) {
  const worker = new UnifiedImageWorker(config, analysisLogger, networkMonitor);

  // Sequential: dipendenze
  await worker.initializeParticipantsData();
  await worker.initializeSportConfigurations();   // setta currentSportCategory

  // Parallel: tutti dipendono solo da currentSportCategory
  await Promise.all([
    worker.initializeSceneClassifier(),
    worker.initializeOnnxDetector(),
    worker.initializeGenericSegmenter(),
    worker.initializeFaceRecognition(),
    worker.initializeTrainingConsent(),
  ]);

  return worker;
}
```

## Files likely to touch

Per chiudere l'issue (Fix #1):

- **`racetagger-clean/src/model-manager.ts`** — aggiungere il metodo `getYoloModelsToDownload(userCategories)` simile per spirito a `getModelsToDownload()`. Riusa `getModelConfig()` e `getGenericModelPath()` già esistenti per il check cache.
- **`racetagger-clean/src/main.ts`** — estendere `checkAndDownloadModels()` (line 2764) con un secondo loop sui modelli YOLO. La UI di progress (`model-download-start`/`progress`/`complete`) c'è già — basta includere i nuovi modelli nel conteggio.
- **`racetagger-clean/src/database-service.ts`** — aggiungere `getUserEnabledSportCategories()` se non esiste già un equivalente (usato per popolare la lista da passare a `getYoloModelsToDownload`).
- **`racetagger-clean/src/yolo-model-registry.ts`** — verificare che `sizeBytes` sia accurato per ogni modello (oggi `'yolo26-detector-v1'` ha `sizeBytes: 42_000_000` — corrisponde al download osservato di 42 MB ✅).

Per Fix #2 (bundle nell'installer):

- **`racetagger-clean/models/detector/yolo26-detector-v1-v1.0.onnx`** (NUOVO) — file binario ~42 MB. Considera Git LFS se il repo non lo gestisce già.
- **`racetagger-clean/electron-builder.yml`** (o sezione `build` in `package.json`) — aggiungi `models/**/*` a `files`/`asarUnpack`/`extraResources`.
- **`racetagger-clean/src/model-manager.ts`** — verifica che `getModelPaths()` cerchi anche `process.resourcesPath` (per i packaged builds).
- **`racetagger-clean/scripts/fetch-models.ts`** (NUOVO) — script una-tantum per scaricare il modello da Supabase a disco prima del build, utile in CI.
- **`racetagger-clean/.gitattributes`** (se Git LFS) — `*.onnx filter=lfs diff=lfs merge=lfs -text`.

Per Fix #3 (rete di sicurezza, da fare solo se #1 non viene adottato):

- **`racetagger-clean/src/generic-segmenter.ts`** (line 228) — passare la callback `onProgress` a `ensureGenericModelAvailable`.
- **`racetagger-clean/src/unified-image-processor.ts`** — re-emit dell'evento di progress.
- **`racetagger-clean/src/main.ts`** — listener su evento del processor → `safeSend('model-download-progress', ...)`.
- **`racetagger-clean/src/preload.ts`** (o equivalente) e renderer — esporre/handle dell'evento.

---

## Note collaterali emerse dal log (issue separate)

Da non perdere — vanno aperte come issue distinte, non bloccano #124:

### A) `participantsData.length=0` durante il matching ⚠️ CRITICO

Tutti i `[MatchDiag]` log delle prime immagini riportano:
```
[MatchDiag] participantsData.length=0, category="motorsport_v3", sportCategory=motorsport_v3
[MatchDiag] ⚠️ findIntelligentMatches: NO participant data! participantsData=0, csvData=0
```

Eppure alla riga 113 del log:
```
[DB Reload] 📦 CACHE HIT - Returning cached preset with 60 participants
```

**Significa:** il preset con 60 partecipanti è stato caricato correttamente, ma **non è stato propagato ai worker** durante l'esecuzione. Le immagini analizzate in questo run **non hanno fatto matching** contro i partecipanti reali. Bug funzionalmente più grave dell'#124 (silenzioso, l'utente non se ne accorge ma i risultati sono peggiori del dovuto).

Verificare se è un caso di Issue #104 ricorrente, o se è un nuovo bug nella propagazione `processorConfig.participantPresetData → workers`. Aprire issue separata.

### B) `raw-preview-extractor` restituisce thumbnail invece della preview full per ARW Sony

```
[RAW-Extract] _DSC3675.ARW: Native extractFullPreview returned 160x120
              but calibration expected ~6144x4096. Trying ExifTool...
```

Il native addon C++ ha restituito la thumbnail mini per un ARW. Fallback ExifTool funziona ma è ~5× più lento. Probabile metadata Sony non standard nel file specifico, o pattern di makernote che il parser non riconosce. Indagare con un campione di ARW Sony di varie versioni firmware. Issue separata.

### C) Network monitor: latenza Supabase 1133ms al boot

```
[NetworkMonitor] Initial metrics collected: ..., supabase_latency_ms: 1133
```

1.1s di RTT verso Supabase è alto per una connessione Ethernet. Se persistente, potrebbe essere una regione Supabase non-EU. Verificare con un health-check ricorrente. Issue separata, severità bassa.

---

## Resolution

**Status:** Fix #1 applicato · **Data:** 2026-04-28 · **Versione target:** v1.1.5

**Modifiche applicate:**

1. **`src/model-manager.ts`** — aggiunto metodo `ModelManager.prototype.getYoloModelsToDownload()`:
   - Importati `parseSegmentationConfig` e `getDefaultModelId` da `yolo-model-registry`.
   - Query Supabase su `sport_categories` filtrata per `is_active=true`, selezionando `code, use_local_onnx, crop_config, segmentation_config`.
   - Per ogni categoria con `crop_config.enabled` (parsed se è una JSON string), aggrega il `model_id` dal `segmentation_config` (con fallback a `getDefaultModelId()` = `'yolo26-detector-v1'`).
   - Per ogni categoria con `use_local_onnx=true`, aggiunge il modello detector di default come safety net (la pipeline esistente già scarica via `getModelsToDownload()`, ma duplicarlo qui è innocuo grazie al check `getGenericModelPath()`).
   - Aggregazione su un `Set<string>` per deduplicare automaticamente i modelli condivisi tra categorie.
   - Skip dei modelli già presenti su disco (bundled o cached) tramite `getGenericModelPath(modelId)`.
   - **Fallback robusto:** se la query DB fallisce per qualunque motivo (errore rete, RLS, timeout), il metodo cade su `Object.keys(YOLO_MODEL_REGISTRY)` — scarica tutti i modelli noti del registry — così il bug #124 non può ripresentarsi nemmeno in caso di errore.
   - Esteso il `declare module './model-manager'` block con la nuova firma del metodo per il type-check di TypeScript.

2. **`src/main.ts`** — esteso `checkAndDownloadModels()` (line 2764) con un secondo stage:
   - Stage 1 invariato: `modelManager.getModelsToDownload()` + loop con `downloadModel(code)` per i modelli code-based del `model_registry` Supabase.
   - **Stage 2 nuovo:** `modelManager.getYoloModelsToDownload()` + loop con `ensureGenericModelAvailable(modelId, onProgress)` per i modelli YOLO del registry. La callback `onProgress` (che esisteva in `ensureGenericModelAvailable` ma non veniva mai cablata) è ora collegata all'evento esistente `model-download-progress`.
   - Counter unificato (`modelIndex`, `downloadedTotal`, `totalModels`, `totalSizeMB`) tra i due stage: il renderer vede una progress bar continua "X / Y modelli" che copre entrambi i tipi di modelli, senza dover toccare l'UI esistente.
   - Aggiornato il commento di documentazione del metodo per spiegare i due stage e linkare a issue #124.

**Verifiche eseguite:**

- `npx tsc --noEmit -p tsconfig.json` → **exit 0** (nessun errore di tipo introdotto).
- `git diff --numstat`: 109 righe aggiunte in `model-manager.ts` (nuova logica), 62 righe modificate in `main.ts` (62 added, 16 removed nella refactor di `checkAndDownloadModels`).
- Compatibilità: la UI di progress (`model-download-start` / `model-download-progress` / `model-download-complete`) non richiede modifiche — il renderer riceve già gli stessi eventi, semplicemente con un `totalModels`/`totalSizeMB` più grandi quando ci sono modelli YOLO da scaricare.

**Comportamento atteso post-fix per il caso utente (#124):**

Al primo avvio dopo l'upgrade a v1.1.5, l'utente vedrà la progress modal "Aggiornamento modelli AI: 1/3 — 12 / 105 MB" che copre sia gli scene-classifier code-based esistenti sia il `yolo26-detector-v1` (~42 MB). Negli avvi successivi: cache hit, nessun download. **Al click "Avvia analisi": modello già su disco → la pipeline parte immediatamente**, eliminando il delay di ~28.7s osservato nel diagnostic report.

**Test manuale richiesto prima del rilascio:**

1. Svuotare `%APPDATA%\racetagger-desktop\models\` (Win) / `~/Library/Application Support/racetagger-desktop/models/` (macOS).
2. Avviare l'app, fare login → la progress modal deve mostrare almeno il modello `yolo26-detector-v1` da scaricare.
3. Selezionare cartella + categoria `motorsport_v3` + preset → cliccare "Avvia analisi".
4. Misurare il delta tra il click e il primo log `[Timing]` nel main process: target <8s (rispetto ai ~50s del diagnostic originale).
5. Riavviare l'app: la progress modal NON deve più apparire (cache hit).

**Issue collaterali aperte separatamente (non risolte da questo fix):**
- `participantsData.length=0` durante il matching (preset non propagato ai worker).
- `raw-preview-extractor` fallback a ExifTool per ARW Sony.
- Latenza Supabase 1133ms in NetworkMonitor (probabile health-check problem).
