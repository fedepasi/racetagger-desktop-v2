# Preset Selection Audit — Analysis Page

**Scope:** logica di caricamento e selezione del *Participant Preset* nella pagina Analysis del desktop app (`racetagger-clean/renderer/pages/analysis.html`).
**Obiettivo:** capire perché la deselezione/cambio preset a volte non si propaga e perché c'è odore di concorrenza al caricamento, e proporre un refactor che renda la logica una sola fonte di verità.

---

## 1. Situazione attuale (as-is)

### 1.1 File coinvolti

| File | Ruolo |
|---|---|
| `renderer/pages/analysis.html` | Markup. Contiene la `<select id="preset-select">` (nascosta) + il custom dropdown `#custom-preset-dropdown / #custom-preset-trigger / #custom-preset-menu`. |
| `renderer/js/renderer.js` | Carica i preset (`loadPresetsForSelector`), filtra per categoria (`filterAndDisplayPresets`), sincronizza il custom dropdown con la `<select>` (`syncCustomPresetDropdown`), watcher per cambi programmatici (`watchHiddenPresetSelect`), gestisce il flusso "Analyze" (`handleFolderAnalysis` / `proceedWithFolderAnalysis`). |
| `renderer/js/enhanced-file-browser.js` | Possiede lo stato canonico `this.selectedPreset` e `this.presetLoadingPromise`. Carica i preset di nuovo (`loadAvailablePresets`), li scrive nella stessa `<select>` (`updatePresetSelector`), gestisce la selezione completa (`handlePresetSelection` → `_loadPresetData`). Singleton in `window.enhancedFileBrowser`. |
| `renderer/js/last-analysis-settings.js` | Ripristina (con polling) l'ultima preset selezionata da localStorage (`applyPresetSetting`). |
| `renderer/js/router.js` | All'ingresso in `/analysis` orchestra: `loadPresetsForSelector` + `watchHiddenPresetSelect` + `initMetadataOverwriteOptions` + `EnhancedFileBrowser.loadAvailablePresets` + `loadLastAnalysisSettings` (con setTimeout 100ms). Fa `pageContainer.innerHTML = html` ad ogni navigazione → distrugge il DOM della pagina. |
| `src/ipc/supabase-handlers.ts` | Backend handler. `supabase-get-participant-presets` ritorna `{ success, data: ParticipantPreset[] }` con `preset_participants` mappati su `participants`. |

### 1.2 Stato attuale (sources of truth disseminate)

```
DOM:
  <select id="preset-select">.value          ← lo legge handleFolderAnalysis
  #custom-preset-trigger .cpd-name (testo)   ← cosa l'utente vede
  #custom-preset-menu .cpd-option.selected   ← evidenziazione

Memoria (singleton singleton):
  window.enhancedFileBrowser.selectedPreset       ← oggetto preset completo (con participants)
  window.enhancedFileBrowser.presetLoadingPromise ← promise in flight
  window.enhancedFileBrowser.availablePresets     ← lista per la dropdown
  cachedAllPresets (renderer.js, module-level)    ← stessa lista, fonte diversa
  categoryCodeToIdMap (renderer.js)               ← map per filtro
  localStorage 'racetagger-last-analysis-settings'.presetId  ← ultimo selezionato
```

### 1.3 Diagramma del flusso al page-load

```
Router → /analysis
  │
  ├─(1)─ loadPresetsForSelector()  [renderer.js]
  │        └ IPC: supabase-get-participant-presets (o admin)
  │             └ filterAndDisplayPresets()
  │                  ├ <select>.options 1..end remove
  │                  ├ <select>.value = ''                  ← (A) reset
  │                  ├ append <option> filtrate per categoria
  │                  └ syncCustomPresetDropdown()
  │
  ├─(2)─ watchHiddenPresetSelect()                            [guard: solo 1ª volta]
  │
  ├─(3)─ initMetadataOverwriteOptions()                       [NESSUN guard, multi-fire]
  │
  ├─(4)─ EnhancedFileBrowser.loadAvailablePresets()           [se già esiste]
  │        └ IPC: supabase-get-participant-presets (o admin) ← stesso fetch di (1) ma diverso
  │             └ updatePresetSelector()
  │                  ├ <select>.innerHTML = '<option …>'    ← (B) wipe TOTALE
  │                  ├ append <option> NON filtrate
  │                  ├ <select>.value = selectedPreset.id   ← (C) restore
  │                  └ syncCustomPresetDropdown()
  │
  └─(5)─ setTimeout 100ms → loadLastAnalysisSettings() → applyPresetSetting()
            └ polling (max 3s, 30 tentativi @ 100ms) finché trova l'<option>
                 ├ <select>.value = saved.presetId
                 └ dispatchEvent('change')                    ← (D)
```

I passi (1) e (4) sono **fetch paralleli, indipendenti, con filtraggio diverso**. Quale dei due termina per ultimo decide cosa l'utente vede. Il passo (B) cancella il filtro per categoria che (1) aveva applicato. Il passo (D) può scattare prima o dopo che (4) ha fatto la sua wipe — risultato non deterministico.

### 1.4 Diagramma del flusso al click sul custom dropdown

```
User clicca .cpd-option in #custom-preset-menu
  └ click handler creato in syncCustomPresetDropdown():
       ├ <select>.value = opt.value
       ├ <select>.dispatchEvent(new Event('change'))    ← (E)
       ├ aggiorna trigger text + classe selected
       └ chiude dropdown

Listener su 'change' della <select>:
  ├ enhancedFileBrowser.setupPresetSelector → handlePresetSelection(value)
  │     └ _loadPresetData → IPC supabase-get-participant-preset-by-id
  │          ├ this.selectedPreset = {...}
  │          └ window.dispatchEvent('presetSelected', detail: selectedPreset)
  ├ watchHiddenPresetSelect → aggiorna UI (testo + highlight)
  └ initMetadataOverwriteOptions → aggiorna visibility checkbox
```

---

## 2. Bug confermati

### Bug A — Stale event listeners dopo navigazione tra pagine ★ CRITICO

`router.loadPage` fa `pageContainer.innerHTML = html`. Questo **distrugge il vecchio `<select id="preset-select">`** e ne crea uno nuovo. I listener attaccati con `addEventListener` al vecchio nodo vengono garbage-collected con il nodo.

I tre listener su `change`/`focus` della `<select>` sono installati così:

| Listener | File:linea | Re-installato al rientro? |
|---|---|---|
| `EnhancedFileBrowser.setupPresetSelector` (change → `handlePresetSelection`) | `enhanced-file-browser.js:1259` | **NO** — chiamato solo dal costruttore, che gira una sola volta perché `window.enhancedFileBrowser` è singleton. |
| `watchHiddenPresetSelect` (change → aggiorna trigger/highlight) | `renderer.js:2579` | **NO** — guard `presetSelectWatcherInitialized = true`. |
| `initMetadataOverwriteOptions` (change → mostra/nasconde overwrite description) | `renderer.js:2796` | **SÌ** ma senza guard → leak: ogni rientro aggiunge un listener in più sul nuovo nodo. |

**Conseguenza pratica:**
1. Primo accesso a `/analysis` — tutto funziona.
2. Utente va su `/home`, poi torna a `/analysis`. Il DOM è stato sostituito.
3. Utente clicca un preset nel custom dropdown → `<select>.value` cambia, `change` viene dispatched.
4. **Nessuno chiama `handlePresetSelection`** sul nuovo nodo → `selectedPreset` non viene aggiornato (resta la selezione precedente o `null`).
5. La UI del dropdown **mostra** il nuovo preset (perché `syncCustomPresetDropdown` aggiorna trigger/menu direttamente nel suo handler, senza passare per `change`), ma lo stato in memoria è stale.

### Bug B — Deselezione apparente che non pulisce lo stato

Stesso meccanismo del Bug A applicato al caso "torno al placeholder vuoto":
- Custom dropdown click su `value=""` → `<select>.value = ''`, dispatch `change`.
- `handlePresetSelection('')` non viene mai chiamato (listener morto).
- `selectedPreset` resta valorizzato con il preset precedente.
- L'utente vede il dropdown vuoto.
- Premendo Analyze: `handleFolderAnalysis` legge `selectedPreset.id` (vivo) per la logica "no-preset warning" → la warning **non** parte. Poi `proceedWithFolderAnalysis` legge `presetSelectEl.value` (vuoto) per costruire il config → l'analisi parte **senza** preset.
- Le due decisioni guardano fonti diverse → comportamento incoerente.

### Bug C — Doppio fetch e doppia popolazione del `<select>`

`loadPresetsForSelector` (renderer.js) e `EnhancedFileBrowser.loadAvailablePresets` chiamano **entrambi** lo stesso canale IPC `supabase-get-participant-presets` al page-load, e **entrambi** scrivono nello stesso `<select>` ma:

- (1) usa `presetSelect.options 1..end remove` poi `appendChild` con label `${name} (${count} participants)`, **filtrando per categoria** (rispetta `categoryCodeToIdMap[selectedCategory]`).
- (4) usa `presetSelect.innerHTML = '<option value="">…</option>'` poi `appendChild` con label uguale, **senza filtro categoria**.

Il vincitore è chi termina per ultimo — non deterministico. Quando vince (4), il filtro categoria sparisce.

### Bug D — `EnhancedFileBrowser.updatePresetSelector` ignora il filtro categoria

Indipendente dal race con (1): in qualsiasi momento (es. rientro pagina con browser già esistente), l'unica cosa che gira è (4), che scarica e mostra **tutti** i preset, anche quelli di altre categorie. È documentato che la categoria deve filtrare → comportamento incoerente con la pagina.

### Bug E — `setupPresetSelector` ascolta `focus` su un `<select>` con `display:none`

Riga `enhanced-file-browser.js:1255`: `presetSelect.addEventListener('focus', () => loadAvailablePresets())`. Ma in `analysis.html` la `<select>` ha `style="display:none;"` (riga 41 → 72) — l'utente interagisce solo col custom dropdown e la select nativa **non riceve mai focus**. Codice morto.

### Bug F — `presetLoadingPromise` non viene resettato in caso di errore

`_loadPresetData` non ha `finally { this.presetLoadingPromise = null }`. Se la chiamata IPC fallisce o resta appesa, le successive `await this.presetLoadingPromise` (riga 1077) aspettano una promise vecchia.

### Bug G — `selectedPreset` persiste ma il dropdown viene resettato

Quando si rientra in `/analysis`, (1) imposta `<select>.value = ''` (linea `renderer.js:2713`). Subito dopo (4) tenta di ripristinare `<select>.value = selectedPreset.id` (linea `enhanced-file-browser.js:1352-1354`). Ma il preset potrebbe essere stato filtrato fuori dalla nuova categoria → l'`<option>` non esiste, e il valore resta `''`. UI dice vuoto, memoria dice preset A → mismatch.

### Bug H — `initMetadataOverwriteOptions` ascolta sia `presetSelected` sia `change`

Doppio aggiornamento per ogni selezione. Idempotente (stessa logica), ma confonde e doppia ogni volta che si rientra in pagina (cumulativo).

### Bug I — Polling 30×100ms in `applyPresetSetting`

`last-analysis-settings.js` aspetta che l'`<option>` compaia con polling. Risolve il sintomo della corsa a (1)/(4) ma è fragile (oltre 3s rinuncia silenzioso) e nasconde il problema vero.

### Bug J — Patch difensivo a 3 livelli in `handleFolderAnalysis`

Linee `renderer.js:1577-1607` e `1770-1789`: ben tre tentativi successivi di "ricaricare il preset al volo" prima di lanciare l'analisi. È la spia che il flusso non si fida del proprio stato. Funziona come safety net ma significa che nel "happy path" lo stato non è coerente.

---

## 3. Cause principali

1. **Due moduli si contendono lo stesso `<select>`** senza un'autorità unica (renderer.js + EnhancedFileBrowser).
2. **Stato persistente in memoria + DOM ricreato a ogni rientro** = lo stato sopravvive alla UI che lo riflette.
3. **Listener attaccati al DOM una sola volta** in costruttori/guard: violano l'assunzione che la pagina è una SPA con DOM mutabile.
4. **L'utente non interagisce mai con l'elemento ascoltato** (`<select>` nascosta), ma tutta la logica passa per i suoi eventi `change` → ogni rottura dell'event flow si nota solo quando ormai l'utente ha già "selezionato" qualcosa.

---

## 4. Verifica empirica suggerita

Per confermare i bug A/B prima di sistemare:

1. Apri DevTools, vai su `/analysis`, seleziona un preset → controlla `window.enhancedFileBrowser.selectedPreset.id` ✅
2. Vai su `/home`, torna su `/analysis`. Controlla che `<select id="preset-select">.value` sia ora `''`. Controlla `window.enhancedFileBrowser.selectedPreset` — se è ancora il vecchio preset, **Bug G confermato**.
3. Senza ricaricare, seleziona un preset diverso dal custom dropdown. Subito dopo:
   - `document.getElementById('preset-select').value` → ID nuovo ✅
   - `window.enhancedFileBrowser.selectedPreset.id` → ID **vecchio** ❌ → **Bug A confermato**.
4. Click su Analyze: l'output del log `[Analysis] handleFolderAnalysis - hasPreset: <id-vecchio>` mostrerà che la safety net `forceReload` (riga 1599) interviene → il flusso si "auto-cura" e il preset corretto viene infine caricato. È perché di solito l'analisi parte giusta nonostante il bug.

---

## 5. Piano di pulizia (to-be)

Obiettivo: **una sola autorità per la preset selection**, **zero side effect duplicati**, **resilienza a re-render della pagina**.

### 5.1 Architettura proposta

```
┌─────────────────────────────────────────┐
│  PresetController  (singleton)          │
│  ───────────────────────────────────    │
│  state:                                 │
│    .all: ParticipantPreset[]            │  ← cache unica
│    .selected: ParticipantPreset|null    │  ← single source of truth
│    .loadingPromise: Promise|null        │
│  events (EventTarget):                  │
│    'presets-changed'  → all updated     │
│    'selection-changed' → selected updated │
│  api:                                   │
│    init()                               │  ← idempotente
│    refreshList(force=false)             │
│    select(presetId)                     │  ← unica via di selezione
│    deselect()                           │
│    bindToView(rootEl)                   │  ← attacca listener al DOM corrente
└─────────────────────────────────────────┘
            ▲             ▲
            │             │
   PresetView.attach   handleFolderAnalysis
   (renderer side)     (legge .selected)
```

### 5.2 Step by step

1. **Centralizzare lo stato** — nuova classe/modulo `PresetController` esposta su `window.presetController`. Sposta dentro:
   - `availablePresets` (oggi su EnhancedFileBrowser) e `cachedAllPresets` (renderer.js) → un solo array.
   - `selectedPreset` + `presetLoadingPromise` (oggi su EnhancedFileBrowser).
   - `categoryCodeToIdMap` può restare in renderer.js, ma il filtro lo applica `PresetController` su richiesta.

2. **Eliminare la doppia fetch** — solo `PresetController.refreshList()` fa la chiamata IPC. Sia il vecchio `loadPresetsForSelector` sia `EnhancedFileBrowser.loadAvailablePresets` diventano alias che chiamano `presetController.refreshList()` (o vengono rimossi).

3. **Re-binding al DOM corrente** — un metodo `presetController.bindToView()` da chiamare a ogni evento `page-loaded` quando page === 'analysis'. Questo metodo:
   - Trova il `<select>` e il custom dropdown nel DOM **corrente**.
   - Rimuove eventuali listener precedenti (tracking via `AbortController` per cleanup pulito).
   - Attacca `change` sulla `<select>` e click sulle `.cpd-option` (un solo posto in cui la UI cambia stato).
   - Sincronizza la UI con `state.selected` (così il dropdown riflette sempre la verità).
   Nessun guard "init solo una volta" — ogni page-load è un ciclo pulito.

4. **Eliminare `setTimeout 100ms` e il polling** — `loadLastAnalysisSettings` chiama `presetController.select(savedId)`. Se `state.all` non è ancora popolato, il controller mette in coda la selezione e la applica appena `refreshList` completa. Niente polling.

5. **Eliminare il safety net in `handleFolderAnalysis`** — diventa:
   ```js
   await presetController.ready();      // attende refreshList in corso
   const preset = presetController.selected;
   const hasPreset = !!preset?.id;
   ```
   Niente più 3 livelli di fallback: lo stato è sempre coerente.

6. **Rimuovere il listener focus su select nascosta** (Bug E).

7. **`initMetadataOverwriteOptions`** ascolta solo `presetController.on('selection-changed', ...)` e si registra una sola volta (con cleanup tramite AbortController su page-leave per evitare leak cumulativo).

8. **`watchHiddenPresetSelect`** sparisce — il `PresetController` aggiorna direttamente la UI quando lo stato cambia.

9. **Filtro categoria** — quando `selectedCategory` cambia, `PresetController.applyCategoryFilter(code)` ricalcola la lista visibile **senza** rifare la fetch (i dati sono già cached). Se il preset attualmente selezionato è fuori dal nuovo filtro, mantenere comunque la selezione (mostrarla come "fuori categoria") oppure deselezionare esplicitamente — decisione di prodotto.

10. **Test di regressione manuale (checklist)** una volta refattorizzato:
    - [ ] Selezione preset → `state.selected.id` aggiornato + label nel trigger.
    - [ ] Deselezione (click placeholder) → `state.selected = null` + label vuota + warning "no preset" parte se non disabilitata.
    - [ ] Cambio categoria → lista filtrata, selezione precedente mantenuta o resettata coerentemente.
    - [ ] Navigazione `/analysis` → `/home` → `/analysis` → la selezione persiste *e* il dropdown la mostra.
    - [ ] Restart con `loadLastAnalysisSettings` → preset salvato ripristinato senza polling.
    - [ ] Click rapidi consecutivi su preset diversi → vince l'ultimo, nessuno stato intermedio.
    - [ ] Avvio analisi: il config inviato contiene esattamente il preset visualizzato.

### 5.3 Stima impatto

| Voce | Note |
|---|---|
| File toccati | 3 nuovi (`preset-controller.js`) + edits a `renderer.js`, `enhanced-file-browser.js`, `last-analysis-settings.js`, `router.js`. ~300-400 righe modificate, ~200 righe rimosse. |
| Rischio regressioni | Medio. La logica safety-net oggi maschera bug → toglierla rivela altri sintomi se la nuova logica ha buchi. Suggerito: lasciare il safety-net come `console.warn` finché QA non valida. |
| Tempo stima | 1.5–2 giornate sviluppo + mezza giornata test. |
| Persone interessate | Solo desktop. Web non è impattato (web ha la sua selezione preset separata). |
| Test esistenti | `tests/ipc-handlers.test.ts` — non copre il flusso UI. Da considerare aggiunta di un test puppeteer/playwright sulla pagina (fuori scope di questo PR). |

### 5.4 Cosa NON cambierei

- Schema DB e canali IPC: il backend è pulito, il problema è tutto nel renderer.
- Custom dropdown vs `<select>` nativo: il pattern "select nascosta + custom UI" è OK per il tema cross-platform; il problema è solo nei listener.
- `pageContainer.innerHTML = html` del router: refactor a `replaceChildren` con preservazione di alcuni nodi sarebbe più invasivo; meglio adattarci e ri-bindare a ogni page-load.

---

## 6. Quick fix tampone (se serve qualcosa subito senza refactor)

In ordine di rischio crescente, da applicare uno o più:

1. **Rimuovere il guard `presetSelectWatcherInitialized`** e ri-bindare watcher + `initMetadataOverwriteOptions` ad ogni `page-loaded` con cleanup via `AbortController`. Risolve Bug A/B in <30 righe.
2. **Esporre `setupPresetSelector` come metodo pubblico di `EnhancedFileBrowser`** e chiamarlo dal router su page-loaded. Risolve la metà mancante del Bug A.
3. **Resettare `selectedPreset = null` su page-leave da `/analysis`** quando il valore del dropdown viene azzerato. Risolve Bug G.
4. **Far ritornare `loadPresetsForSelector` la promise di fetch** così che `EnhancedFileBrowser.loadAvailablePresets` possa skipparla se già in flight (debounce). Risolve Bug C parzialmente.

I quick fix riducono i sintomi ma non eliminano la dualità di sorgenti, quindi prima o poi i bug torneranno.

---

## 7. Riepilogo bug → fix mapping

| Bug | Severità | Fix nel piano | Quick fix |
|---|---|---|---|
| A. Stale listener post-rerender | ★★★ | §5.2 step 3 | §6.1 + 6.2 |
| B. Deselect non aggiorna stato | ★★★ | §5.2 step 3 | §6.1 + 6.2 |
| C. Doppia fetch + race | ★★ | §5.2 step 2 | §6.4 |
| D. `updatePresetSelector` ignora categoria | ★★ | §5.2 step 1 + 9 | rimuovere chiamata in (4) |
| E. Listener focus su select nascosta | ★ | §5.2 step 6 | rimuovere riga |
| F. `presetLoadingPromise` non resettato su error | ★ | §5.2 step 1 | aggiungere `finally` |
| G. `selectedPreset` persistente vs DOM resettato | ★★ | §5.2 step 1 | §6.3 |
| H. Doppio listener (presetSelected + change) | ★ | §5.2 step 7 | rimuovere uno dei due |
| I. Polling 30×100ms in applyPresetSetting | ★ | §5.2 step 4 | — |
| J. Patch difensivo 3 livelli in handleFolderAnalysis | ★★ | §5.2 step 5 | — |

---

**Conclusione:** la causa madre è una sola — il preset state vive in due moduli, ognuno crede di essere l'autorità, e nessuno gestisce il fatto che la pagina viene ricostruita a ogni navigazione. Concentrare lo stato in un `PresetController` con `bindToView` chiamato a ogni `page-loaded` rimuove tutti i 10 bug e i quick fix che li mascherano.

---

## 8. Implementazione (28 Apr 2026)

Il refactor proposto in §5 è stato eseguito. Riassunto delle modifiche:

**File creati:**
- `renderer/js/preset-controller.js` (~370 righe) — singleton `window.presetController`. Estende `EventTarget`. Stato privato (`_all`, `_selected`, `_listRefreshPromise`, `_pendingSelectId`, `_categoryFilter`, `_viewAbort`, `_selectionRequestId`). API: `refresh()`, `select(id)`, `deselect()`, `applyCategoryFilter(code)`, `setCategoryMap(map)`, `bindToView(rootEl)`, `ready()`. Eventi: `list-changed`, `selection-changed`, `loading-changed`. Race protection: in-flight refresh dedup, monotonic `_selectionRequestId` per scartare risposte stale, `_pendingSelectId` per accodare selezioni quando la lista non è ancora caricata.

**File modificati:**
- `renderer/index.html` — aggiunto `<script src="js/preset-controller.js">` prima di `last-analysis-settings.js` / `renderer.js` / `enhanced-file-browser.js`.
- `renderer/js/renderer.js` — rimosse `cachedAllPresets`, `syncCustomPresetDropdown`, `watchHiddenPresetSelect`. `loadPresetsForSelector` e `filterAndDisplayPresets` ridotte a thin wrapper sul controller (mantenute per compatibilità nominale). `handleCategorySelection` e `populateCategorySelect` chiamano `presetController.applyCategoryFilter`/`setCategoryMap`. `handleFolderAnalysis` ridotto a `await presetController.ready(); const preset = presetController.selected;` (rimossi i tre layer di safety net). `proceedWithFolderAnalysis` legge il preset dal controller. `initMetadataOverwriteOptions` ascolta `selection-changed` con guard anti-leak. `initCustomDropdownListeners` non gestisce più la dropdown preset.
- `renderer/js/enhanced-file-browser.js` — rimossi i campi `selectedPreset`, `availablePresets`, `presetLoadingPromise`. Rimossi i metodi `loadAvailablePresets` (originale), `setupPresetSelector`, `handlePresetSelection`, `_loadPresetData`, `updatePresetSelector`, `updatePresetDetails`, `showAccuracyConfirmation`, `showSimpleNotification`, `loadSelectedPreset`. Aggiunti getter di compatibilità (`get selectedPreset`, `get presetLoadingPromise`) che leggono dal controller per qualunque caller residuo. `setupPresetListeners` ora ascolta `selection-changed` del controller. `processSelectedFiles` legge il preset dal controller dopo `await presetController.ready()`. Shim `loadAvailablePresets()` → `presetController.refresh()`.
- `renderer/js/last-analysis-settings.js` — `applyPresetSetting(presetId)` ora chiama `presetController.select(presetId)` (che accoda internamente se la lista è in-flight). Eliminato il polling 30×100ms.
- `renderer/js/router.js` — case `'analysis'` ora chiama `presetController.bindToView(pageContainer)` (singolo punto di binding). Rimossi: chiamata a `loadPresetsForSelector`, chiamata a `watchHiddenPresetSelect`, ramo "EnhancedFileBrowser exists → reload presets", `setTimeout 100ms` attorno a `loadLastAnalysisSettings`.
- `preset-controller.js` (bridge) — listener globale su `presetSelected`/`presetCleared` (eventi dispatched da `participants-manager.js` quando l'utente seleziona un preset dalla pagina Participants) → forwarding a `controller.select()`/`controller.deselect()`.

**Verifica:**
- `npx tsc --noEmit` → 0 errori.
- `node --check` su tutti i 5 file JS modificati → OK.
- Audit grep di reference morte (`cachedAllPresets`, `syncCustomPresetDropdown`, `watchHiddenPresetSelect`, `enhancedFileBrowser.handlePresetSelection`, ecc.) → 0 occorrenze residue al di fuori dei thin wrapper documentati.

**Bug → fix mapping (effettivo):**

| Bug | Fix applicato |
|---|---|
| A. Stale listener post-rerender | `bindToView` con `AbortController` chiamato a ogni `page-loaded`. |
| B. Deselect non aggiorna stato | Click sul placeholder ora chiama `controller.deselect()` direttamente; `change` listener sul `<select>` è ri-bindato a ogni page-loaded. |
| C. Doppia fetch + race | Una sola fetch in `controller.refresh()`. Concurrent calls → in-flight promise dedup. |
| D. `updatePresetSelector` ignora categoria | `_renderList` usa `_computeVisible()` che applica sempre il filtro categoria corrente. |
| E. Listener focus su select nascosta | Rimosso completamente. |
| F. `presetLoadingPromise` non resettato su error | `refresh()` usa `.finally()` che pulisce; `select()` usa request-id che neutralizza risposte stale. |
| G. `selectedPreset` persistente vs DOM resettato | `_renderList` rispetta sempre `_selected` come verità; `bindToView` allinea il DOM allo stato a ogni page-load. |
| H. Doppio listener (presetSelected + change) | Un solo listener per evento, tutti tramite il controller. |
| I. Polling 30×100ms in applyPresetSetting | Sostituito da `controller.select()` con queue interna. |
| J. Patch difensivo 3 livelli | Rimosso. `handleFolderAnalysis` fa una sola `await ready()` + lettura. |

**Riduzione codice netta:**
- `renderer.js`: −210 righe (rimossi `syncCustomPresetDropdown`, `watchHiddenPresetSelect`, body di `loadPresetsForSelector`/`filterAndDisplayPresets`, safety net in `handleFolderAnalysis`/`proceedWithFolderAnalysis`).
- `enhanced-file-browser.js`: −280 righe (8 metodi preset-related rimossi).
- `last-analysis-settings.js`: −20 righe (polling rimosso).
- `router.js`: −10 righe (calls duplicate rimosse).
- `preset-controller.js`: +480 righe (con commenti), nuovo file.

Bilancio: ~520 righe rimosse, ~480 aggiunte (di cui ~120 di commenti/JSDoc), netto neutro ma con concentrazione + commenti che rendono il flow tracciabile.

**Cosa resta da fare manualmente:**
1. Test in `npm run dev` con la procedura di §4.
2. Avviare un'analisi reale per confermare che il config inviato contiene il preset corretto.
3. Validare il flusso "seleziona preset da Participants → torna su Analysis → preset preselezionato" (gestito dal bridge `presetSelected`/`presetCleared`).
