# Guida per Modifica Prompt AI - Filtro Oggetti Sfocati

## Stato Implementazione ✅

Tutte le modifiche al codice sono state completate:
- ✅ Migration SQL aggiunto
- ✅ unified-image-processor.ts aggiornato
- ✅ Edge function modificata per utilizzare recognition_config
- ✅ Interfaccia admin aggiornata con nuovi controlli

## ⚠️ AZIONI RICHIESTE

### 1. Eseguire Migration SQL
```sql
-- Esegui questa query su Supabase:
ALTER TABLE sport_categories
ADD COLUMN IF NOT EXISTS recognition_config JSONB DEFAULT '{
  "maxResults": 5,
  "minConfidence": 0.6,
  "confidenceDecayFactor": 0.9,
  "relativeConfidenceGap": 0.3,
  "focusMode": "auto",
  "ignoreBackground": true,
  "prioritizeForeground": true
}'::jsonb;

-- Applica configurazioni ottimizzate:
UPDATE sport_categories SET recognition_config = '{"maxResults": 5, "minConfidence": 0.7, "confidenceDecayFactor": 0.85, "relativeConfidenceGap": 0.35, "focusMode": "foreground", "ignoreBackground": true, "prioritizeForeground": true}' WHERE code = 'motorsport';
UPDATE sport_categories SET recognition_config = '{"maxResults": 2, "minConfidence": 0.75, "confidenceDecayFactor": 0.9, "relativeConfidenceGap": 0.3, "focusMode": "primary", "ignoreBackground": true, "prioritizeForeground": true}' WHERE code = 'rally';
UPDATE sport_categories SET recognition_config = '{"maxResults": 1, "minConfidence": 0.8, "confidenceDecayFactor": 1.0, "relativeConfidenceGap": 0.5, "focusMode": "closest", "ignoreBackground": true, "prioritizeForeground": true}' WHERE code = 'running';
UPDATE sport_categories SET recognition_config = '{"maxResults": 1, "minConfidence": 0.75, "focusMode": "closest", "ignoreBackground": true, "prioritizeForeground": true}' WHERE code = 'cycling';
```

### 2. Modifica Prompt AI per Ogni Categoria

#### Template Base per Prompt
Aggiungi queste istruzioni **all'inizio** di ogni prompt della tabella `sport_categories.ai_prompt`:

```
🚨 REGOLE CRITICHE PER IL RICONOSCIMENTO:

1. ANALIZZA SOLO soggetti con numeri/testi PERFETTAMENTE LEGGIBILI
2. IGNORA COMPLETAMENTE:
   - Soggetti sfocati, lontani o sullo sfondo
   - Numeri non chiaramente distinguibili
   - Soggetti parzialmente visibili o tagliati
3. CONFIDENCE DEVE RIFLETTERE LA LEGGIBILITÀ:
   - 1.0 = numero cristallino e perfettamente leggibile
   - 0.8-0.9 = numero chiaro ma con qualche dubbio
   - <0.7 = numero incerto o difficilmente leggibile
   - <0.5 = numero illeggibile (DA NON INCLUDERE)

4. Se un numero NON è leggibile con certezza assoluta, NON includerlo nei risultati.
5. Priorità ASSOLUTA ai soggetti in primo piano con dettagli nitidi.

---

[PROMPT ORIGINALE CONTINUA QUI...]
```

#### Esempi Specifici per Categoria

**MOTORSPORT** - Aggiorna `ai_prompt` per motorsport:
```sql
UPDATE sport_categories
SET ai_prompt = '🚨 REGOLE CRITICHE: ANALIZZA SOLO veicoli con numeri PERFETTAMENTE LEGGIBILI. IGNORA veicoli sfocati/lontani. Confidence deve riflettere leggibilità (1.0=cristallino, <0.5=illeggibile).

Analyze the provided image for race vehicles IN THE FOREGROUND with CLEARLY READABLE numbers only. For each vehicle with CRYSTAL CLEAR details, extract:
- raceNumber: Only if PERFECTLY readable (null altrimenti)
- drivers: Names if clearly visible
- teamName: Team if clearly visible
- otherText: Clear sponsor text only
- confidence: 1.0=perfect clarity, <0.5=unreadable

COMPLETELY IGNORE: blurry, distant, background vehicles or partially visible subjects.
Respond with JSON array. Maximum 5 results per image.'
WHERE code = 'motorsport';
```

**RUNNING** - Aggiorna per running:
```sql
UPDATE sport_categories
SET ai_prompt = '🚨 REGOLE CRITICHE: ANALIZZA SOLO l''atleta principale con pettorale PERFETTAMENTE LEGGIBILE. IGNORA tutti gli altri sullo sfondo.

Identify THE MAIN RUNNER in the foreground with a CRYSTAL CLEAR bib number. Extract:
- raceNumber: Only if PERFECTLY readable
- drivers: Runner name if visible
- confidence: 1.0=perfect number clarity

IGNORE all background runners, blurry bibs, or distant athletes. Maximum 1 result only.'
WHERE code = 'running';
```

### 3. Test e Configurazione Fine

Dopo aver applicato le modifiche:

1. **Testa con foto problematiche**: Usa foto con auto sfocate sullo sfondo
2. **Verifica i log**: Controlla `[UnifiedWorker] Using recognition config` nei log
3. **Regola configurazione**: Usa l'interfaccia admin per ottimizzare:
   - `minConfidence`: Alza se troppi falsi positivi
   - `maxResults`: Riduci se trova troppi oggetti
   - `focusMode`: Cambia in base al comportamento desiderato

### 4. Query Utili per Debug

```sql
-- Verifica configurazioni correnti
SELECT code, name, recognition_config FROM sport_categories WHERE code IN ('motorsport', 'running', 'cycling');

-- Aggiorna configurazione specifica
UPDATE sport_categories
SET recognition_config = jsonb_set(recognition_config, '{minConfidence}', '0.8')
WHERE code = 'running';

-- Reset configurazione default
UPDATE sport_categories
SET recognition_config = '{"maxResults": 5, "minConfidence": 0.7, "focusMode": "auto", "ignoreBackground": true}'
WHERE code = 'motorsport';
```

## Come Funziona il Sistema

1. **Edge Function**: Carica `recognition_config` e aggiunge istruzioni al prompt
2. **AI Analysis**: Gemini riceve prompt enhanced con regole di filtro
3. **Post-Processing**: `unified-image-processor.ts` applica filtri aggiuntivi:
   - Confidence minima dinamica
   - Limite massimo risultati
   - Decay factor per risultati multipli
   - Gap relativo dal miglior risultato

## Risultati Attesi

- **Motorsport**: Max 5 auto, confidence ≥ 0.7, focus su primo piano
- **Rally**: Max 2 auto, confidence ≥ 0.75, soggetto primario
- **Running**: Solo 1 atleta, confidence ≥ 0.8, più vicino/migliore
- **Cycling**: Solo 1 ciclista, confidence ≥ 0.75, più vicino

## Troubleshooting

**Problema**: Ancora troppi falsi positivi
**Soluzione**: Alza `minConfidence` a 0.8-0.9

**Problema**: Non trova nulla
**Soluzione**: Abbassa `minConfidence` o cambia `focusMode`

**Problema**: Trova oggetti sullo sfondo
**Soluzione**: Verifica che `ignoreBackground: true` e migliora prompt con istruzioni più severe