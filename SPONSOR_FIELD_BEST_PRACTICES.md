# Guida alle Best Practices per il Campo "Sponsor"

## Introduzione

Il campo **sponsor** nel Participant Preset è uno strumento **estremamente potente** per migliorare l'accuratezza del riconoscimento automatico, ma richiede attenzione nella compilazione. Sponsor ben configurati possono trasformare match impossibili in identificazioni perfette, mentre sponsor mal configurati possono causare errori sistematici difficili da correggere.

## Perché gli Sponsor sono Potenti

### Il Sistema di Matching Intelligente

Racetagger utilizza un sistema avanzato che:

1. **Analizza TUTTI gli sponsor** rilevati dall'AI nell'immagine
2. **Prioritizza sponsor unici** - sponsor che appaiono una sola volta nel preset
3. **Applica boost massivi** - sponsor unici ricevono punteggi simili ai numeri di gara (~90 punti vs ~40 punti normali)
4. **Rileva contraddizioni** - penalizza match quando l'AI vede sponsor che il partecipante NON ha

### Quando gli Sponsor Salvano la Situazione

Gli sponsor sono **fondamentali** quando:

- **Il numero di gara non è visibile** (foto di profilo, podio, box)
- **Il numero è ambiguo** (LED display, numeri multipli sulla stessa auto)
- **OCR fallisce** (angolazione difficile, numero sporco/danneggiato)
- **Più veicoli hanno numeri simili** (1 vs 11, 5 vs 8, ecc.)

**Esempio reale:**
```
Foto di un pilota sul podio - numero NON visibile
AI rileva: "Shell", "Puma", "M Motorsport" (sponsor sulla tuta)
Sistema identifica: Auto #15 (unico veicolo con "M Motorsport" come sponsor unico)
Risultato: Match perfetto con 90 punti di confidenza
```

## ⚠️ I Rischi degli Sponsor Mal Configurati

### Problema #1: Sponsor Generici

**SBAGLIATO:**
```csv
numero,nome,sponsor
15,Driver A,"BMW, Shell, Pirelli"
31,Driver B,"BMW, Shell, Pirelli"
46,Driver C,"BMW, Shell, Pirelli"
```

**Perché è pericoloso:**
- Tutti e tre hanno gli stessi sponsor
- Nessun valore discriminante
- Il sistema non riesce a distinguere tra i veicoli
- Match casuali basati su sponsor comuni

**CORRETTO:**
```csv
numero,nome,sponsor
15,Driver A,"iQOO, M Motorsport, DHL, Shell, Puma"
31,Driver B,"Snap-on, BMW M Motorsport, Shell, Pirelli"
46,Driver C,"Alpinestars, BMW Team, Michelin"
```

**Perché funziona:**
- Ogni veicolo ha almeno 1-2 sponsor unici
- "M Motorsport" appare solo su #15 → boost massivo
- "Snap-on" appare solo su #31 → boost massimo
- Il sistema può distinguere chiaramente tra i veicoli

### Problema #2: Sponsor Troppo Simili

**SBAGLIATO:**
```csv
numero,nome,sponsor
5,Team Red Bull,"Red Bull, Red Bull Racing, RB Racing"
77,Team Red Bull 2,"Red Bull, Red Bull Racing, RB Racing"
```

**Perché è pericoloso:**
- Sponsor quasi identici tra veicoli diversi
- Fuzzy matching crea ambiguità
- "Red Bull Racing" potrebbe matchare con "RB Racing"
- Impossibile distinguere tra #5 e #77

**CORRETTO:**
```csv
numero,nome,sponsor
5,Max VERSTAPPEN,"Oracle, Red Bull, Honda Racing"
77,Sergio PEREZ,"Telcel, Red Bull, Honda Racing"
```

**Perché funziona:**
- "Oracle" è unico per #5
- "Telcel" è unico per #77
- Sponsor comuni ("Red Bull", "Honda Racing") non creano confusione

### Problema #3: Sponsor Omessi o Incompleti

**SBAGLIATO:**
```csv
numero,nome,sponsor
1,Driver A,""
2,Driver B,"Shell"
3,Driver C,"Pirelli, Puma"
```

**Perché è pericoloso:**
- Auto #1 non ha sponsor → impossibile identificare senza numero
- Auto #2 ha un solo sponsor generico → ambiguità se altre auto hanno "Shell"
- Informazioni preziose perse

**CORRETTO:**
```csv
numero,nome,sponsor
1,Driver A,"Martini Racing, Gulf, Heuer"
2,Driver B,"Shell, Ferrari, Santander, Ray-Ban"
3,Driver C,"Pirelli, Puma, Monster Energy, Alpinestars"
```

## ✅ Best Practices

### 1. Ricerca Fotografica Pre-Evento

**PRIMA dell'evento, raccogli informazioni visive:**

```
Checklist per ogni auto/pilota:
□ Screenshot dal sito ufficiale
□ Foto della livrea da social media
□ Entry list ufficiale con sponsor
□ Video onboard/highlight precedenti
□ Foto di test/prove
```

**Fonti utili:**
- Sito ufficiale della serie/evento
- Instagram/Facebook team e piloti
- Motorsport.com / Autosport
- YouTube (video ufficiali, onboard)
- Entry list PDF ufficiali

### 2. Formattazione Corretta

**Formato raccomandato:**
```csv
numero,nome,sponsor
15,Driver Name,"Sponsor1, Sponsor2, Sponsor3, Sponsor4"
```

**Regole di formattazione:**

✅ **FARE:**
- Separare sponsor con virgola + spazio: `"Shell, Pirelli, Puma"`
- Usare nomi completi: `"M Motorsport"` non `"M"`
- Rispettare maiuscole/minuscole dei brand: `"BMW M Team"` non `"bmw m team"`
- Includere 4-8 sponsor per veicolo (bilanciamento)
- Ordinare dal più visibile al meno visibile

❌ **NON FARE:**
- Separare con punto e virgola: `"Shell; Pirelli; Puma"` ❌
- Abbreviazioni inventate: `"M Mot"` invece di `"M Motorsport"` ❌
- Tutto maiuscolo: `"SHELL, PIRELLI"` ❌
- Troppo pochi sponsor (1-2): bassa discriminazione ❌
- Troppi sponsor (>15): rumore, difficoltà di matching ❌

### 3. Identificazione Sponsor Unici

**Il segreto per match perfetti:**

```
Processo di identificazione:
1. Lista TUTTI gli sponsor visibili su ogni veicolo
2. Evidenzia sponsor che appaiono su UN SOLO veicolo
3. Verifica che questi sponsor siano VISIBILI nelle foto
4. Prioritizza sponsor GRANDI e LEGGIBILI
```

**Esempio pratico - WEC GT3:**

```csv
# Auto #15 - BMW M TEAM WRT
sponsor: "iQOO, M Motorsport, DHL, Shell, Puma"
         ^^^^  ^^^^^^^^^^^^
         UNICI - alta priorità per match

# Auto #31 - BMW M TEAM WRT 2
sponsor: "Snap-on, BMW M Motorsport, Shell, Pirelli"
         ^^^^^^^
         UNICO - alta priorità per match

# Auto #46 - TEAM WRT
sponsor: "Valentino Rossi, Alpinestars, BMW, Michelin"
         ^^^^^^^^^^^^^^^^  ^^^^^^^^^^^
         UNICI - alta priorità per match
```

**Risultato:**
- Ogni auto ha 1-2 sponsor UNICI visibili
- Sistema può identificare correttamente anche senza numero
- Match affidabili su foto di podio/box/profilo

### 4. Gestione Sponsor Comuni

**Quando più veicoli condividono sponsor (es. team sponsor):**

```csv
# Scenario: Team BMW con 3 auto

# ✅ CORRETTO - bilanciare comuni + unici
numero,nome,sponsor
15,Driver A,"iQOO, M Motorsport, BMW M Team, Shell"
         ^^^^  ^^^^^^^^^^^^  [comune]      [comune]
31,Driver B,"Snap-on, BMW M Motorsport, BMW M Team, Shell"
         ^^^^^^^  ^^^^^^^^^^^^^^^^^^  [comune]      [comune]
46,Driver C,"Alpinestars, Valentino Rossi, BMW M Team, Michelin"
         ^^^^^^^^^^^  ^^^^^^^^^^^^^^^^  [comune]      ^^^^^^^^

ANALISI:
- "BMW M Team", "Shell" → comuni (basso peso)
- "iQOO", "M Motorsport", "Snap-on", "Alpinestars", "Valentino Rossi", "Michelin" → UNICI
- Ogni auto identificabile tramite sponsor unici
```

### 5. Validazione del Preset

**Prima di usare il preset, verifica:**

```python
Checklist di validazione:
□ Ogni auto ha almeno 1 sponsor unico?
□ Gli sponsor unici sono VISIBILI nelle foto?
□ I nomi sponsor sono scritti correttamente?
□ Il formato è consistente (virgola + spazio)?
□ Non ci sono sponsor duplicati nello stesso campo?
□ Gli sponsor riflettono la livrea ATTUALE dell'evento?
```

**Tool di validazione mentale:**

Per ogni auto, chiediti:
> "Se vedessi SOLO gli sponsor (senza numero), potrei identificare questa auto?"

Se la risposta è **NO**, aggiungi sponsor unici.

### 6. Manutenzione del Preset

**Gli sponsor cambiano spesso!**

```
Aggiornamento preset:
□ Verificare livree prima di OGNI evento
□ Controllare cambi sponsor mid-season
□ Aggiornare sponsor per gare speciali (livree one-off)
□ Documentare variazioni tra qualifica e gara
□ Tenere backup di preset precedenti
```

**Esempio cambiamenti comuni:**
- Sponsor title diverso per gara (es. Monaco)
- Livrea speciale (anniversari, tribute)
- Cambio sponsor mid-season
- Numero variabile (reserve driver)

## 📊 Matrice di Qualità Sponsor

| Scenario | Sponsor Configurati | Qualità Match | Raccomandazione |
|----------|---------------------|---------------|-----------------|
| **Ideale** | 4-8 sponsor, 2+ unici, ben visibili | 95-99% | ✅ Ottimo - usa così |
| **Buono** | 3-6 sponsor, 1 unico, visibili | 85-95% | ✅ Funziona bene |
| **Accettabile** | 2-4 sponsor, comuni ma distintivi | 70-85% | ⚠️ Migliora con sponsor unici |
| **Problematico** | 1-2 sponsor, tutti comuni | 50-70% | ❌ Aggiungi sponsor unici |
| **Critico** | Sponsor assenti o identici tra auto | <50% | ❌ Richiede intervento urgente |

## 🎯 Esempi Real-World

### Esempio 1: WEC GT3 - Auto BMW

**Situazione:** 3 auto BMW dello stesso team, livree quasi identiche

**Preset PRIMA (problematico):**
```csv
numero,nome,sponsor
15,Driver A,"BMW"
31,Driver B,"BMW"
46,Driver C,"BMW"
```
**Risultato:** 40% accuratezza - impossibile distinguere senza numero

**Preset DOPO (ottimale):**
```csv
numero,nome,sponsor
15,Dries VANTHOOR,"iQOO, M Motorsport, DHL, Shell, Puma, BMW M Team WRT"
31,Augusto FARFUS,"Snap-on, BMW M Motorsport, Shell, Pirelli, BMW M Team WRT"
46,Valentino ROSSI,"Alpinestars, Valentino Rossi VR46, BMW, Michelin, Monster Energy"
```
**Risultato:** 98% accuratezza - identificazione perfetta anche senza numero

### Esempio 2: MotoGP - Team Ducati

**Situazione:** 8 moto Ducati, sponsor parzialmente sovrapposti

**Preset PRIMA (problematico):**
```csv
numero,nome,sponsor
1,Bagnaia,"Ducati, Pramac"
89,Martin,"Ducati, Pramac"
```
**Risultato:** Confusione sistematica tra #1 e #89

**Preset DOPO (ottimale):**
```csv
numero,nome,sponsor
1,Francesco BAGNAIA,"Ducati Lenovo Team, Lenovo, Pramac, Shell, SKY VR46"
89,Jorge MARTIN,"Prima Pramac Racing, Prima, Pramac, Estrella Galicia, Michelin"
```
**Risultato:** "Lenovo" unico per #1, "Prima" unico per #89 → 95% accuratezza

### Esempio 3: F1 - Red Bull vs Red Bull Junior

**Situazione:** Team principale e team junior con sponsor simili

**Preset PRIMA (problematico):**
```csv
numero,nome,sponsor
1,Verstappen,"Red Bull"
22,Tsunoda,"Red Bull"
```
**Risultato:** Match casuali

**Preset DOPO (ottimale):**
```csv
numero,nome,sponsor
1,Max VERSTAPPEN,"Oracle Red Bull Racing, Oracle, Honda, Mobil 1"
22,Yuki TSUNODA,"Visa Cash App RB, Visa, Cash App, Honda, Pirelli"
```
**Risultato:** "Oracle" vs "Visa Cash App" → distinzione chiara

## 🔧 Risoluzione Problemi

### Problema: "Match sempre sbagliato su foto senza numero"

**Diagnosi:**
```
1. Controlla log SmartMatcher:
   → Quali sponsor vengono rilevati dall'AI?
   → Quali sponsor vengono matchati?
   → Ci sono contraddizioni?

2. Verifica sponsor unici:
   → Ogni auto ha almeno 1 sponsor unico?
   → Gli sponsor unici sono VISIBILI nelle foto?
```

**Soluzione:**
```
1. Aggiungi sponsor VISIBILI unici per ogni auto
2. Rimuovi sponsor troppo piccoli/illeggibili
3. Verifica ortografia sponsor (deve matchare OCR AI)
4. Testa su foto di esempio
```

### Problema: "Contraddizioni continue nei log"

**Diagnosi:**
```
Log mostra:
⚠️ CONTRADICTION: AI detected unique sponsor "Snap-on" NOT belonging to participant #15

Causa: Auto #15 matchata ma "Snap-on" appartiene a #31
```

**Soluzione:**
```
1. Verifica che sponsor nel preset siano CORRETTI
2. Controlla che l'AI stia rilevando sponsor giusti
3. Considera se ci sono sponsor CONDIVISI tra auto diverse
4. Aggiorna preset se livree sono cambiate
```

### Problema: "AI rileva sponsor ma non li usa"

**Diagnosi:**
```
Log mostra:
🔍 Analyzing 4 sponsors for participant #15:
  → 0 UNIQUE sponsors
  → 4 common sponsors: [BMW, Shell, Pirelli, Puma]

Causa: Nessun sponsor unico nel preset
```

**Soluzione:**
```
1. Ricerca sponsor specifici per ogni auto
2. Aggiungi sponsor secondari visibili
3. Usa nomi completi sponsor: "M Motorsport" non "BMW"
4. Verifica entry list ufficiale
```

## 📚 Risorse Utili

### Tool di Validazione (manuale)

**Script mentale per ogni auto:**
```
1. "Quali sponsor vedo sulla livrea?"
   → Lista visiva completa

2. "Quali di questi sono UNICI per questa auto?"
   → Evidenzia discriminanti

3. "Questi sponsor sono LEGGIBILI nelle foto tipiche?"
   → Verifica visibilità

4. "Se l'AI rileva questi sponsor, può identificare l'auto?"
   → Test mentale di matching
```

### Pattern di Naming Comuni

**Motorsport:**
- Title sponsor: `"Oracle Red Bull Racing"` (completo)
- Main sponsor: `"Oracle"`, `"Red Bull"`
- Technical partner: `"Honda Racing"`, `"Pirelli"`
- Personal sponsor: `"Snapchat"`, `"Richard Mille"`

**Running/Cycling:**
- Team name: `"Nike Running Team"`
- Equipment sponsor: `"Nike"`, `"Garmin"`
- Nutrition sponsor: `"Maurten"`, `"SIS"`
- Personal sponsor: `"Rolex"`, `"Oakley"`

## 🎓 Conclusione

### Principi Chiave

1. **Sponsor unici = Match affidabili**
   - Ogni auto dovrebbe avere 1-2 sponsor che appaiono solo su di essa

2. **Visibilità > Quantità**
   - 3-4 sponsor VISIBILI meglio di 15 sponsor invisibili

3. **Ricerca preventiva salva tempo**
   - 30 minuti di ricerca pre-evento = 95% accuratezza automatica

4. **Manutenzione costante**
   - Sponsor cambiano → preset va aggiornato

### Il Segreto del Successo

> **"Un preset ben fatto trasforma Racetagger da buono a eccezionale"**

Con sponsor configurati correttamente:
- ✅ Match automatici anche senza numero visibile
- ✅ Riconoscimento su foto podio/box/profilo
- ✅ Riduzione correzioni manuali del 80-90%
- ✅ Processing più veloce e accurato

### Prossimi Passi

1. **Analizza il tuo preset attuale** usando questa guida
2. **Identifica auto con sponsor deboli** (comuni o assenti)
3. **Ricerca sponsor unici** per ogni auto problematica
4. **Testa su foto di esempio** prima del processing completo
5. **Monitora log SmartMatcher** per verificare efficacia

---

**Versione:** 1.0 - Ottobre 2025
**Compatibilità:** Racetagger Desktop v1.0.9+
**Sistema:** SmartMatcher con Uniqueness Detection & Contradiction Penalty
