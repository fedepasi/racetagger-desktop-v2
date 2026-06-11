# Audit branch `feature/face-recognition-auraface` — 2026-06-11

> Worktree di audit: `rt-auraface-audit` (branch locale `audit/auraface-merge-test`).
> Nulla è stato pushato, mergiato su main, o applicato a prod.

## ⚠️ URGENTE — il branch esiste SOLO su questa macchina

Il branch remoto è stato **cancellato da GitHub stamattina (2026-06-11, 06:07 UTC)** durante una pulizia di massa (~20 branch eliminati tra le 05:21 e le 06:07, incluso `feature/face-recognition-ml`). I 14 commit sopravvivono solo nel database oggetti locale di questo PC, ora protetti dal branch locale `feature/face-recognition-auraface` (tip `ba95e5b`, 2026-02-17). **Primo passo consigliato: ri-pushare il branch su origin** (serve OK esplicito di Federico — non fatto in questo audit).

## VERDETTO: MERGE-ABLE DOPO FIX (nessuna riscrittura necessaria)

Il merge tecnico è **già dimostrato fattibile**: in questo worktree main è stato fuso nel branch, i 14 hunk di conflitto risolti, il risultato **compila con zero errori TypeScript nuovi** e i 17 test unitari scritti per l'occasione **passano tutti**. Restano 5 fix bloccanti (B1–B5, ~2–3 giorni) prima di un merge flag-off su main.

## 1. Merge di prova — conflitti reali

112 commit su main vs 14 sul branch dalla base comune (16 feb 2026 — non ottobre 2025: il branch aveva già rimergiato main). Conflitti:

| File | Hunk | Natura | Risoluzione applicata |
|---|---|---|---|
| `src/unified-image-processor.ts` | 7 | import bridge vs ONNX; pre-check descrittori; cache FACE_MATCH di main; backfill temporale vs face-only fallback; pipeline persist Edge Function | Mix: ONNX del branch + `SyntheticPresetBuilder`, pre-check 512 del branch, ENTRAMBI i blocchi face-cache e else-if, persist di main |
| `renderer/js/driver-face-manager.js` | 2 | flag hardcoded `true` (branch) vs flag DB per-utente (main) | main (architettura flag corretta) |
| `renderer/js/face-detector.js` | 1 | short-circuit "gira nel main process" vs init renderer | branch |
| `renderer/pages/participants.html` | 2 | main ha riusato la sezione per **Per-Person Metadata** (feature live!) | main — la UI face va riprogettata (B5) |
| `scripts/validate-native-deps.js` | 1 | check ONNX (branch) vs ExifTool critico (main) | combinati |
| `src/matching/cache-manager.ts` | 1 | logging L3 equivalente | main |
| `supabase` | 1 | symlink (main) vs directory reale con la migration (branch) | symlink ripristinato; migration da spostare in racetagger-app (B4) |

**Conflitti semantici (non testuali) risolti/da fixare:**
- Main da febbraio ha integrato il face matching dentro SmartMatcher (`faceRecognitionCache` → evidenza FACE_MATCH, commit `0926741`) e fixato il logging JSONL face (`624ae13`, 9 giugno). Il codice di main si aspetta `driverInfo.source` (`'global'|'preset'`) che il nuovo formato del branch non propaga → **fix da 1 riga** in `performFaceRecognition` (il `PersonMatch` ha già il campo `source`).
- L'unico errore tsc rimasto (`'filesystem'` non in `ErrorType`) **esiste identico su origin/main** — bug pre-esistente, non del merge.

## 2. Review dei servizi ONNX — bug concreti

### Bloccanti
- **B1 — Modello YuNet non distribuibile.** `src/assets/models/` è in `.gitignore` (riga 93): il file `face_detection_yunet_2023mar.onnx` (~90KB) non è nel repo né scaricabile a runtime (l'auto-download esiste solo per AuraFace). Su qualunque installazione fresca/CI la detection fallisce sempre. Fix: forzare il commit del file (`git add -f`, 90KB, licenza Apache 2.0) o aggiungerlo al flusso `ModelManager`.
- **B2 — Download AuraFace rotto nei build di produzione.** `face-embedding-service.ts:32` crea un client Supabase proprio da `process.env.SUPABASE_URL` con fallback hardcoded a un **progetto sbagliato** (`fwoqfgeviftmkxivtpkg` invece di `taompbzifylmdzgbbrpv`). Nei build packaged `process.env` non è valorizzato → il download punta al progetto sbagliato e fallisce sempre. Il `ModelManager` esistente risolve lo stesso problema con `setSupabaseClient()` (client autenticato iniettato dal main) — il servizio dichiara nel docstring di usare ModelManager ma non lo fa. Fix: instradare il download via ModelManager o iniettare il client autenticato. (Nota: `model-manager.ts` ha lo stesso fallback sbagliato ma non lo usa mai in pratica.)
- **B3 — Download non atomico + errore "sticky" = utente bloccato.** Il download bufferizza tutti i 260MB in RAM (picco ~500MB su un box da 8GB) e scrive direttamente sul path finale senza checksum. Se la scrittura si corrompe, al run successivo `getModelPath()` trova il file, `InferenceSession.create` fallisce, `loadError` resta valorizzato e **ogni chiamata successiva a `loadModel()` lancia un'eccezione** invece di ritornare false (contratto d'errore incoerente: prima chiamata → `{success:false}`, successive → throw). Nessun recovery senza cancellare il file a mano. Fix: stream su file temporaneo + rename atomico + verifica dimensione/checksum + reset di `loadError` ritentabile. Stesso pattern sticky-error in `face-detector-service.ts`.

### Importanti (non bloccanti per un merge flag-off, sì per il rollout)
- **Degrado silenzioso offline / senza modello.** In `initializeFaceRecognition` il ritorno di `ensureEmbedderReady()` **non viene controllato**: se AuraFace non si carica (offline, download fallito), il face recognition resta "enabled", la detection gira, gli embedding restano vuoti e si ottengono **zero match senza alcun errore visibile**. Viola la policy del repo ("fail clearly, not silently" — l'analisi è online-required). Fix: se `embedderLoaded=false` → disabilitare con log/telemetria chiari (e in futuro un toast all'utente).
- **Decoder YuNet fail-silent sui nomi output.** Se i nomi dei tensori di output non combaciano (`cls_8`…), il decoder logga un warn e ritorna `success:true` con 0 facce. Se il modello nel bucket venisse aggiornato con head diversi, il sintomo sarebbe "non trova mai facce", non un errore. Fix: errore esplicito se TUTTI gli stride mancano. (Il decoding in sé è **corretto**: verificato contro le formule OpenCV `score=sqrt(cls·obj)`, `w=exp(b2)·stride`, landmark `(kps+col)·stride` — e pinnato dai nuovi test.)
- **Cache descrittori (fix `ba95e5b`) con due difetti latenti:** (1) se worker A sta caricando il preset X e arriva una richiesta per il preset Y, Y riceve la promise di X (la promise non è legata al presetId) — innocuo oggi (un preset per batch), bug domani; (2) nessuna invalidazione: foto volti aggiunte a metà sessione non vengono viste fino al riavvio.
- **Memoria/concorrenza su box 8GB:** AuraFace (ResNet100) gira nel main process, sessione singleton condivisa — scelta giusta (no N×260MB nei worker). Tensor CPU senza dispose esplicito: ok per onnxruntime-node (GC), ma `dispose()` non chiama `session.release()` (leak nativo minore). `detectFromPath` usa `readFileSync` (blocca il main su RAW grossi — usare la versione async).

### Cose fatte bene (da preservare)
Pipeline interamente nel main process (niente canvas/face-api nel renderer), dual-read 128/512 con preferenza 512, pre-check descrittori che evita init inutile, gate per scena/segmentazione (salta i volti se YOLO vede solo veicoli), thresholds per contesto (portrait 0.60 / action 0.55), L2-normalize + cosine corretti.

## 3. Migration SQL

- **La migration `20260217180000_auraface_descriptor_512.sql` risulta GIÀ APPLICATA in produzione** (verificato via PostgREST: le colonne `face_descriptor_512` + `descriptor_model` esistono su tutte e 3 le tabelle, e ci sono **3 descrittori 512 reali** in `preset_participant_face_photos` — test di febbraio). Il modello è nel bucket `onnx-models` (260MB, caricato 17 feb).
- **B4 — Il file però vive solo nel branch**, dentro una directory `supabase/` reale che ha sovrascritto il symlink del desktop repo. Va copiato in `racetagger-app/supabase/migrations/` (sede canonica) con lo stesso nome, per sanare la deriva schema↔storia migrazioni. È idempotente (`IF NOT EXISTS` ovunque) quindi ri-applicarla è innocuo. Niente GRANT necessari (solo ALTER su tabelle esistenti).
- **Difetto tecnico:** gli indici `GIN` su `float8[]` sono inutili per questo caso d'uso (il matching avviene client-side; nessuna query cerca elementi dentro l'array) e costosi in scrittura. Consiglio una migration successiva che li droppi (o pgvector se un giorno si vorrà il matching server-side).
- **Interazione con la RLS pendente `20260610150000`** (restrizione scritture face-DB globale agli admin): **compatibile**. Il desktop *legge* soltanto `sport_category_faces` (da utente autenticato, non anon) e il migration service scrive solo su `preset_participant_face_photos` (di proprietà utente, non toccata). Si può applicare la RLS senza impatti sul branch.
- Il "gap migration service non wired" è superato: l'handler IPC c'è (`face-recognition-migrate-descriptors` + cancel, whitelisted nel preload). Manca solo un bottone UI admin (2 righe; in alternativa si invoca da devtools). Con **3 sole foto** da migrare, si può perfino fare a mano.

## 4. Flag e rollout

Stack flag post-merge (già coerente, serve solo pulizia):

1. **`sport_categories.face_recognition_enabled`** (per categoria) — gate del pipeline nel main process, arrivato su main dopo febbraio. È il **kill-switch operativo principale**.
2. **Flag per-utente `face_recognition_enabled`** via `delivery-get-plan-limits` (admin: `PUT /api/admin/feature-flags/[userId]`) — gate della UI renderer. Permette il rollout utente-per-utente.
3. **`AURAFACE_ENABLED` in `config.ts` è un flag morto: definito, mai letto da nessuno.** Decisione: o eliminarlo (consigliato — meno confusione) o wirarlo come kill-switch di build davanti a `initializeFaceRecognition`.

**Risposta alla domanda:** sì, il flag DB resta l'interruttore; sono **due** flag DB complementari (categoria + utente), entrambi default-off ⇒ il merge su main è sicuro per tutti gli utenti. `AURAFACE_ENABLED` va rimosso.

## 5. Test minimi — SCRITTI e VERDI

`tests/face-recognition-auraface.test.ts` (committato nel worktree di audit): **17 test, tutti passano**, zero rete/modelli reali.
- Decoding YuNet multi-head con fixture sintetiche: posizione/dimensione attese, `score=sqrt(cls·obj)`, soglia, NMS, comportamento con tensori mancanti (documenta il fail-silent).
- `cosineSimilarity`: identici=1, ortogonali=0, opposti=−1, mismatch dimensioni=0, vettore zero=0.
- Matching: match sopra soglia, reject sotto soglia, borderline 0.60, mix 128/512 (vince 512), fallback euclideo puro-128, set vuoto.
- Modello assente: `detectAndEmbed` su file inesistente fallisce esplicito; `getStatus().ready=false` senza download.

## 6. Stima effort e piano a fasi

| Fix | Effort |
|---|---|
| B1 modello YuNet nel repo/download | 0.5–1h |
| B2 download via ModelManager/client autenticato | 2–3h |
| B3 download atomico + checksum + recovery sticky-error | 3–4h |
| B4 migration nel repo canonico + drop indici GIN | 1h |
| B5 ricostruzione sezione UI face in participants.html (convive con Per-Person Metadata) | 0.5–1g |
| Fail-clear offline (`ensureEmbedderReady` gated) | 1–2h |
| `source` in driverInfo + rimozione `AURAFACE_ENABLED` + delete `face-detection-bridge.ts` | 1h |
| CHANGELOG `## [Unreleased]` | 10min |
| **Totale a merge-ready (flag-off)** | **~2–3 giorni** |

**Fasi:**
- **Fase 0 (oggi):** push del branch recuperato su origin (con OK di Federico) — finché resta solo su questo PC è a rischio.
- **Fase 1:** merge main→branch riusando le risoluzioni di questo worktree (commit `73c29f9` = merge risolto + compilante; cherry-pickabile) + fix B1–B5 + test → PR flag-off verso main.
- **Fase 2:** test interno: build Win+Mac, categoria di test con `face_recognition_enabled=true` solo per l'account FP, batch reale con preset volti (i 3 descrittori 512 di febbraio sono già a DB).
- **Fase 3:** applicare la RLS pendente (indipendente, compatibile), migrare i descrittori legacy 128 (pochi), bottone admin per la migrazione.
- **Fase 4:** rollout per-utente via admin flag (prima i power-user motorsport), monitorando memoria (box utenti ≥8GB), tempi per foto e percentuale match; poi flag per categoria.
