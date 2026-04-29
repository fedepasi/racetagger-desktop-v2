# Proposta — Issue #125: I totali non tornano

**Link:** https://github.com/fedepasi/racetagger-desktop-v2/issues/125
**Autore:** fedepasi (`fede.pasi+2@gmail.com`) · **Aperta:** 2026-04-28T07:27:14Z · **Aggiornata:** 2026-04-28T07:27:14Z
**Label:** bug, user-feedback
**App version:** 1.1.4 · **OS:** Windows 10 · **Electron:** 36.9.5

---

## Problema segnalato

Nella pagina dei risultati, la striscia delle statistiche mostra: 19 immagini totali, 15 matched, 4 no-match. Applicando il filtro "No Match", la lista mostra però solo 2 immagini invece di 4. C'è quindi una discrepanza fra il contatore (in alto) e il filtro (lista renderizzata sotto).

L'utente non ha allegato i casi specifici delle 2 immagini "fantasma" (le 2 che il contatore considera no-match ma che il filtro non mostra), ma l'analisi del codice rende il bug riproducibile in modo deterministico.

## Impatto

- **Severità:** medio (non blocca il workflow, ma erode la fiducia: "se i numeri non tornano, cosa altro è sbagliato?").
- **Utenti colpiti:** tutti gli utenti finali che usano la pagina risultati con almeno un'immagine in cui Gemini ha rilevato un veicolo ma non è riuscito a leggerne il numero. Su un evento medio (motociclismo, ciclismo) è una frazione non trascurabile (5-15% degli scatti).
- **Effetto su metriche:** il bug genera ticket di "supporto percepito" come questo, e potrebbe spingere utenti a non fidarsi del totale (riconto manuale → tempo perso). Nessun impatto diretto su token o conversion.

## Soluzione proposta

Causa radice identificata. Le definizioni di "no-match" usate dal contatore e dal filtro non coincidono.

**File:** `racetagger-clean/renderer/js/log-visualizer.js`

**Filtro (line 1263–1265):**
```js
case 'no-match':
  if (hasCorrection) return false;
  return !result.analysis || result.analysis.length === 0;
```
→ Considera no-match SOLO se `result.analysis` è assente o vuoto (cioè se Gemini non ha rilevato alcun veicolo).

**Contatore (line 1375–1386):**
```js
const matched = allResults.filter(r => {
  if (isCorrected(r)) return true;
  if (!r.analysis || r.analysis.length === 0) return false;
  const hasRaceNumber = r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A');
  if (!hasRaceNumber) return false;
  ...
}).length;
const noMatch = total - matched - needsReview;
```
→ Il contatore "no match" è calcolato per sottrazione e include anche le immagini con `analysis.length > 0` ma senza `raceNumber` valido (cioè veicolo rilevato ma pettorale non leggibile / non riconosciuto).

**Caso concreto utente:** 19 totali = 15 matched + (probabilmente) 2 con `analysis = []` + 2 con `analysis` non vuoto ma `raceNumber` mancante o `'N/A'`. Il contatore conta tutti e 4, il filtro mostra solo i 2 con array vuoto.

**Fix:** allineare la logica del filtro a quella del contatore. Il filtro `no-match` deve restituire `true` per qualunque risultato che il contatore considera no-match. Estrarre le predicate in helper condivisi (`isMatchedResult`, `isNoMatchResult`, `isNeedsReviewResult`) e usarli sia nel filtro che in `updateStatistics()`.

## Stima sforzo

- **Dimensione:** XS (<1h). Refactor mirato in un singolo file, predicate da estrarre.
- **Rischio regressione:** basso. Il cambiamento è contenuto nel renderer (`log-visualizer.js`); la logica del contatore è già quella corretta — stiamo solo allineando il filtro.
- **Test richiesti:**
  - manual on real data: caricare l'esecuzione che ha generato l'issue (link diagnostic disponibile nell'issue body) e verificare che `15 + 4 + 0 = 19` e che il filtro "No Match" mostri esattamente 4 elementi.
  - unit test mirato in `renderer/__tests__/` (se esiste struttura) sui predicate `isNoMatchResult` con 4 fixture: array vuoto, analysis con raceNumber valido, analysis con raceNumber 'N/A', analysis con needs_review. (Se non esiste setup di test per i moduli renderer, va bene anche solo la verifica manuale visto che è un fix XS.)

## Priorità consigliata

**P1 — questa settimana.** Bug visibile e ripetuto su ogni esecuzione che contiene immagini con veicoli rilevati ma pettorali non leggibili (cioè quasi tutte). Bassa complessità + alta visibilità → fix da rilasciare nella prossima patch v1.1.5.

---

## Proposed patch sketch

```js
// racetagger-clean/renderer/js/log-visualizer.js

// ============================================================
// Result-classification predicates (single source of truth used
// by both the filter switch and updateStatistics).
// ============================================================

_hasCorrection(r) {
  return r.hasCorrection === true || this.manualCorrections.has(r.fileName);
}

_isNeedsReview(r) {
  return r.analysis && r.analysis.length > 0 &&
         r.analysis.some(v => v.matchStatus === 'needs_review') &&
         !r._reviewResolved;
}

_isMatched(r) {
  if (this._hasCorrection(r)) return true;                 // manual correction wins
  if (!r.analysis || r.analysis.length === 0) return false;
  const hasRaceNumber = r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A');
  if (!hasRaceNumber) return false;
  if (this._isNeedsReview(r)) return false;                // needs_review is its own bucket
  return true;
}

_isNoMatch(r) {
  if (this._hasCorrection(r)) return false;                // user touched it → not no-match
  if (this._isMatched(r)) return false;
  if (this._isNeedsReview(r)) return false;
  return true;                                             // everything else = no match
}

// In filterResults() — replace the case bodies with predicate calls:
switch (filterType) {
  case 'matched':      return this._isMatched(result);
  case 'no-match':     return this._isNoMatch(result);
  case 'needs-review': return this._isNeedsReview(result);
  case 'corrected':    return this._hasCorrection(result);
  ...
}

// In updateStatistics() — same predicates (stop computing noMatch by subtraction):
const matched      = allResults.filter(r => this._isMatched(r)).length;
const needsReview  = allResults.filter(r => this._isNeedsReview(r)).length;
const noMatch      = allResults.filter(r => this._isNoMatch(r)).length;
const corrections  = allResults.filter(r => this._hasCorrection(r)).length;

// Sanity-check invariant (dev only): matched + noMatch + needsReview === total
if (DEBUG_MODE && (matched + noMatch + needsReview !== total)) {
  console.warn('[LogVisualizer] Stats invariant violated', { total, matched, noMatch, needsReview });
}
```

**Alternativa più conservativa** (se non si vuole estrarre helper ora): cambiare solo il `case 'no-match'` in modo che restituisca `true` anche per i risultati con `analysis` non vuoto ma senza `raceNumber` valido — replicando inline la condizione di `_isMatched`. È più rapido ma lascia la duplicazione di logica già esistente.

## Files likely to touch

- `racetagger-clean/renderer/js/log-visualizer.js` — filterResults() (~line 1233), updateStatistics() (~line 1351). Estrarre i 4 predicate, rimpiazzare i corpi degli `switch` e dei filter, rimuovere il calcolo di `noMatch` per sottrazione.
- (Opzionale) `racetagger-clean/renderer/js/results-page.js` — se ha logica simile per il proprio summary, verificare allineamento (line 417-434 secondo l'analisi automatica).
- (Opzionale, raccomandato) test unit per i predicate, se esiste setup di test per il renderer.

---

## Resolution

**Status:** Risolto · **Data:** 2026-04-28 · **Versione target:** v1.1.5

**Modifiche applicate** in `racetagger-clean/renderer/js/log-visualizer.js`:

1. **Aggiunti 4 helper predicati** (single source of truth) sulla classe `LogVisualizer`:
   - `_hasCorrection(r)` — utente ha corretto manualmente
   - `_isNeedsReview(r)` — match ambiguo non ancora risolto
   - `_isMatched(r)` — ha raceNumber valido (o correzione manuale), non in review
   - `_isNoMatch(r)` — fallthrough: né matched né review né corretto. Include sia `analysis = []` (Gemini non ha visto nulla) sia `analysis` non vuoto ma senza raceNumber valido (Gemini ha visto un veicolo ma non ha letto il numero) — questa era la classe di immagini "fantasma" del bug.

2. **`filterResults()`** ora chiama i predicati invece di duplicare la logica inline. I case `matched`, `no-match`, `needs-review`, `corrected` dello switch sono diventati one-liner.

3. **`updateStatistics()`** non calcola più `noMatch` per sottrazione. Tutti e quattro i contatori usano gli stessi predicati del filtro. Aggiunto un invariant check (`matched + noMatch + needsReview === total`) attivo solo in `DEBUG_MODE` per intercettare regressioni future.

**Verifica:**
- `node --check log-visualizer.js` → OK (nessun errore di sintassi).
- Verifica manuale richiesta: ricaricare l'esecuzione che ha generato l'issue, confermare che la striscia statistiche e il filtro "No Match" mostrano lo stesso conteggio (4 nel caso utente).

**Out of scope (non toccato):** `results-page.js` `getSuccessfulCount()` (linea 417) misura una metrica diversa ("immagini con almeno un'analisi") usata altrove e non contribuisce alla discrepanza riportata.
