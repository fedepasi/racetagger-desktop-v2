# RaceTagger - Funzionalità Cliente

## Panoramica
RaceTagger è un'applicazione desktop professionale per fotografi sportivi che automatizza il riconoscimento dei numeri di gara nelle foto e l'organizzazione dei metadati. Utilizza intelligenza artificiale avanzata per analizzare le immagini e associare automaticamente i numeri identificativi ai partecipanti.

---

## 🎯 Funzionalità Principali

### 1. Analisi Automatica delle Immagini

#### Riconoscimento AI dei Numeri di Gara
- **Dual Recognition System**: Due metodi di riconoscimento configurabili per categoria:
  - **Gemini AI Vision**: Riconoscimento generico con alta precisione
  - **RF-DETR (Roboflow)**: Object detection specializzato per modelli specifici
- **Riconoscimento multi-numero**: Identifica automaticamente tutti i numeri visibili in un'immagine (piloti, moto, pettorine, auto)
- **Intelligenza contestuale**: Distingue tra diversi tipi di numeri (numero di gara, sponsor, pubblicità)
- **Target/Plate Recognition**: Supporto per targhe e plate number
- **Gestione di casi complessi**:
  - Numeri parzialmente oscurati
  - Angolazioni difficili
  - Numeri in movimento (motion blur)
  - Scarsa illuminazione

#### RF-DETR Recognition (v1.0.10+)
- **Roboflow Integration**: Workflow serverless per object detection
- **Label Format**: `"MODEL_NUMBER"` (es. `"SF-25_16"` → numero 16)
- **Configurazione per categoria**: Ogni sport category può usare RF-DETR o Gemini
- **Fallback automatico**: Se RF-DETR fallisce, usa Gemini V3
- **Cost tracking separato**: ~$0.0045/image per RF-DETR
- **Bounding boxes**: Dati completi salvati per training futuro

#### Categorie Sportive Supportate
- **Motorsport**: Auto, moto, karting, rally
- **Running**: Maratone, trail running, gare su strada
- **Altri sport**: Sistema estensibile per altre discipline

#### Elaborazione Batch
- Analisi simultanea di centinaia/migliaia di foto
- Modalità streaming per grandi volumi (>50 foto)
- Ottimizzazione automatica delle risorse di sistema
- Progress tracking in tempo reale

### 2. Gestione Formati RAW

#### Supporto Formati RAW Professionale
**Formati supportati**:
- **Nikon**: NEF
- **Sony**: ARW
- **Canon**: CR2, CR3
- **Olympus**: ORF
- **Panasonic**: RW2
- **Adobe**: DNG
- **Fujifilm, Pentax**: RAW

#### Conversione Intelligente
- **dcraw integration**: Conversione nativa ad alte prestazioni
- **Anteprima embedded**: Estrazione rapida delle thumbnail incorporate
- **Preservazione metadati**: Tutti i dati EXIF/IPTC originali vengono mantenuti
- **Orientamento automatico**: Rotazione corretta basata su EXIF

#### Pipeline di Elaborazione RAW
1. Estrazione anteprima embedded per analisi rapida
2. Conversione batch ottimizzata
3. Analisi AI sul JPEG convertito
4. Scrittura metadati sul file originale RAW

### 3. Sistema di Partecipanti Intelligente

#### Preset Partecipanti Riutilizzabili
- **Creazione preset**: Salva liste di partecipanti per eventi ricorrenti
- **Import CSV**: Caricamento rapido da file esterni
- **Campi supportati**:
  - Numero di gara
  - Nome/i del/i partecipante/i
  - Categoria (PRO, PRO-AM, AM, ecc.)
  - Squadra/Team
  - Sponsor (per keyword aggiuntive)
  - Metatag personalizzati

#### Matching Intelligente
- **Fuzzy matching**: Riconosce varianti e correzioni automatiche
- **Correzione OCR**: Corregge errori comuni (6→8, 1→7, O→0)
- **Matching contestuale**: Usa informazioni temporali e posizionali
- **Confidence scoring**: Indica il livello di certezza del match

#### Temporal Clustering
- **Burst mode detection**: Identifica sequenze di scatti ravvicinati
- **Propagazione intelligente**: Se una foto in un burst ha numero "51", applica a tutte
- **Threshold configurabile**: 250ms-2000ms tra scatti consecutivi
- **Cross-validation**: Conferma match basandosi su foto precedenti/successive

### 4. Gestione Metadati Avanzata

#### Scrittura Metadati IPTC/EXIF
**Campi supportati**:
- **Caption/Description**: Testo descrittivo completo con risultati analisi
- **Keywords**: Tag multipli per catalogazione
- **Credit/Copyright**: Informazioni autore
- **Preservazione metadati originali**: Camera info, GPS, data/ora

#### Modalità di Scrittura
**Opzioni configurabili**:
1. **Overwrite**: Sovrascrive metadati esistenti
2. **Preserve**: Mantiene metadati esistenti, aggiunge solo nuovi
3. **Append**: Aggiunge ai metadati esistenti (per Keywords)

#### Formato Metadati
**Keywords structure**:
```
numero_42
team_imperiale_racing
categoria_proam
pilota_balthasar
pilota_ponzo
racetagger
```

**Description structure**:
```
RaceTagger Analysis Results:

Race Number: 42
Team: IMPERIALE RACING
Drivers: S. BALTHASAR, R. PONZO
Category: PRO-AM

Vehicle 1:
  Race Number: 42
  Category: PRO-AM
  Confidence: 95%

Analyzed: 2025-01-16
```

#### XMP Sidecar Support
- **Creazione automatica**: File .xmp accanto al RAW originale
- **Preservazione integrità**: File originale non modificato
- **Compatibilità**: Lightroom, Bridge, altri software

### 5. Sistema Token e Sottoscrizioni

#### Modello a Token
- **1 token = 1 foto analizzata**
- **Token non scadono**: Acquisto one-time, usa quando vuoi
- **Demo gratuita**: 100 foto per testare il servizio

#### Pacchetti Disponibili (Beta)
- **STARTER PACK**: €29 - 3,000 token
- **PROFESSIONAL PACK**: €49 - 10,000 token ⭐ CONSIGLIATO
- **STUDIO PACK**: €99 - 25,000 token (miglior valore)

#### Sistema di Richiesta Token
- **Request tokens**: Richiesta diretta dall'app
- **Approval workflow**: Admin approva e assegna
- **Real-time balance**: Visualizzazione token disponibili
- **Usage tracking**: Storico utilizzo e statistiche

### 6. Gestione Progetti ed Esecuzioni

#### Sistema Progetti
- **Organizzazione per evento**: Crea progetti per ogni gara/evento
- **CSV preset**: Associa file partecipanti al progetto
- **Storico completo**: Tutte le esecuzioni del progetto visibili

#### Execution Tracking
- **Parametri tracciati**:
  - Categoria sport
  - Resize preset utilizzato
  - Performance optimization level
  - Participant preset (se usato)
  - Streaming vs batch mode
  - Numero foto processate
  - Token consumati
  - Timestamp inizio/fine

#### Dashboard Home
- **Last 30 Days Photos**: Statistiche foto processate
- **Completed Events**: Eventi completati nel periodo
- **Recent Work**: Grid con ultime 6 esecuzioni
- **Quick access**: Accesso rapido a progetti recenti

### 7. Configurazione Avanzata

#### Resize Presets
**VELOCE (1080p)**:
- Max dimension: 1920px
- Quality: 80%
- Best per: Preview veloci, social media

**BILANCIATO (1440p)** ⭐ CONSIGLIATO:
- Max dimension: 2560px
- Quality: 85%
- Best per: Uso generale, buon compromesso velocità/qualità

**QUALITÀ (1920p)**:
- Max dimension: 3840px
- Quality: 90%
- Best per: Massima qualità analisi, stampe

#### Performance Optimization Levels
**DISABLED**: Nessuna ottimizzazione, massima qualità
**CONSERVATIVE**: Ottimizzazioni minime
**BALANCED**: Compromesso velocità/qualità ⭐ CONSIGLIATO
**AGGRESSIVE**: Massima velocità

#### Modalità Processing
**Batch Mode** (default per <50 foto):
- Caricamento tutto in memoria
- Massima velocità
- Ideale per piccoli set

**Streaming Mode** (automatico per >50 foto):
- Processing incrementale
- Gestione memoria ottimizzata
- Cleanup automatico file temporanei
- Disk space monitoring
- Ideale per grandi volumi

### 8. Logging e Tracciabilità

#### Analysis Logs (JSONL)
**Ogni esecuzione genera log dettagliati**:
- Decisioni AI e correzioni applicate
- Temporal clustering decisions
- Fuzzy matching evidence
- Participant matching details
- Performance metrics

**Storage**:
- Locale: `.analysis-logs/` in user data folder
- Cloud: Upload automatico a Supabase Storage
- Naming: `exec_{execution_id}.jsonl`

**Contenuto log**:
```jsonl
{"type":"EXECUTION_START","timestamp":"...","total_images":150}
{"type":"IMAGE_ANALYSIS","image":"DSC_001.NEF","ai_response":{...},"corrections":[...]}
{"type":"CORRECTION","reason":"Corretto 61→51 (foto precedente/successiva)"}
{"type":"TEMPORAL_CLUSTER","cluster_size":5,"avg_interval_ms":180}
{"type":"PARTICIPANT_MATCH","number":"51","matched":"IMPERIALE RACING"}
{"type":"EXECUTION_COMPLETE","stats":{...}}
```

### 9. Autenticazione e Sessioni

#### Sistema Auth
- **Supabase authentication**: Login sicuro cloud-based
- **Session persistence**: Rimani loggato tra riavvii app
- **Offline mode**: Cache locale SQLite per lavoro offline
- **Multi-account**: Cambio rapido tra account utente

#### User Data Sync
- **Auto-sync**: Sincronizzazione automatica con cloud
- **Conflict resolution**: Gestione intelligente modifiche concorrenti
- **Data isolation**: Ogni utente vede solo i propri dati

---

## 🚀 Workflow Tipico

### Scenario 1: Analisi Evento Motorsport Singolo

1. **Preparazione**:
   - Login nell'app
   - Crea nuovo progetto "Gran Premio Monza 2025"
   - Importa CSV partecipanti (o seleziona preset esistente)

2. **Analisi**:
   - Seleziona cartella con foto RAW/JPEG
   - Configura:
     - Categoria: Motorsport
     - Resize: BILANCIATO
     - Preset partecipanti: "GT World Challenge 2025"
   - Start Analysis

3. **Risultati**:
   - Visualizza risultati in tempo reale
   - Controlla match e correzioni applicate
   - Esporta lista foto per numero/team

4. **Post-processing**:
   - Metadati già scritti nei file originali
   - Importa in Lightroom/Bridge per editing finale
   - Keywords e descriptions già presenti

### Scenario 2: Maratona con Grandi Volumi

1. **Setup**:
   - Progetto "Maratona di Roma 2025"
   - Import CSV 5000+ partecipanti
   - Categoria: Running

2. **Processing**:
   - Cartella con 2000 foto
   - Streaming mode si attiva automaticamente
   - Processing in batch di 20 foto
   - Disk monitoring attivo

3. **Features utili**:
   - Temporal clustering raggruppa i burst
   - Fuzzy matching gestisce numeri parzialmente visibili
   - Auto-cleanup file temporanei

---

## 💡 Best Practices per Fotografi

### Preparazione Evento
1. **Crea preset partecipanti** prima dell'evento
2. **Testa con foto di prova** per verificare qualità riconoscimento
3. **Verifica spazio disco** disponibile

### Durante lo Scatto
1. **Inquadra chiaramente i numeri** quando possibile
2. **Usa burst mode** per soggetti in movimento (il clustering aiuterà)
3. **Varia gli angoli** per massimizzare copertura

### Post-Evento
1. **Analizza subito** mentre i dati sono freschi
2. **Controlla i log** per identificare pattern di errore
3. **Esporta statistiche** per report cliente

### Ottimizzazione Performance
1. **Usa BALANCED preset** per la maggior parte dei casi
2. **Abilita streaming** manualmente se hai >100 foto
3. **Chiudi altre app** durante processing intensivo

---

## 🔧 Caratteristiche Tecniche

### Sicurezza e Privacy
- **GDPR compliant**: Dati processati in EU
- **Encryption**: Comunicazioni HTTPS/TLS
- **Data isolation**: Separazione completa tra utenti
- **No third-party sharing**: Dati mai condivisi

### Performance
- **Multi-threading**: Parallelizzazione intelligente
- **Memory pooling**: Riuso buffer per efficienza
- **Disk monitoring**: Prevenzione out-of-space
- **Adaptive batching**: Dimensione batch dinamica

### Compatibilità
- **macOS**: 10.12+ (Intel x64 e Apple Silicon)
- **Windows**: 10/11 (x64 e ARM64)
- **Formati input**: RAW (12+ formati), JPEG, PNG, WebP
- **Software integrazione**: Lightroom, Bridge, Capture One

---

## 📊 Metriche e Analytics

### Tracciamento Utilizzo
- Token consumati per evento
- Tempo medio processing per foto
- Accuracy rate riconoscimento
- Numero correzioni applicate

### Insights Disponibili
- Trend utilizzo mensile
- Performance per categoria sport
- Efficacia preset partecipanti
- Statistiche clustering temporale

---

## 🆘 Supporto e Risorse

### In-App Help
- Tooltips contestuali
- Messaggi di caricamento informativi
- Error messages con suggerimenti

### Documentazione
- Guide rapide per scenario comune
- FAQ integrate
- Video tutorial (roadmap)

### Assistenza
- Email: info@racetagger.cloud
- Sistema ticket integrato (roadmap)
- Community forum (roadmap)

---

*Ultimo aggiornamento: v1.0.11 - Novembre 2025*
