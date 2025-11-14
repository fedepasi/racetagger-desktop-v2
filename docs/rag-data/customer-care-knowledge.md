# RaceTagger - Guida Utente e Customer Care

## Cos'è RaceTagger?

RaceTagger è un'applicazione desktop avanzata che utilizza l'intelligenza artificiale per analizzare automaticamente le foto di gare sportive, riconoscere i numeri di gara dei partecipanti e organizzare le immagini in modo intelligente.

### Cosa fa RaceTagger?
- Analizza automaticamente migliaia di foto di gare (motorsport, corsa, ciclismo, etc.)
- Riconosce i numeri di gara dei partecipanti usando AI avanzata
- Abbina i numeri ai dati dei partecipanti (nome, categoria, squadra)
- Scrive i metadati direttamente nelle foto (EXIF o file XMP)
- Organizza automaticamente le foto in cartelle per numero di gara
- Supporta sia formati standard (JPG, PNG) che RAW (NEF, CR2, ARW, etc.)

### A chi si rivolge?
- Fotografi professionisti di eventi sportivi
- Agenzie fotografiche
- Organizzatori di eventi
- Team sportivi
- Fotografi hobby che coprono eventi locali

## Come Funziona (Workflow Base)

### 1. Avvio e Login
- Scarica e installa RaceTagger sul tuo computer (macOS o Windows)
- Crea un account o effettua il login
- Acquista un pacchetto di token iniziale per iniziare

### 2. Crea un Progetto
- Clicca su "Nuovo Progetto"
- Dai un nome al progetto (es. "Trail Running 2025")
- Carica un file CSV con i dati dei partecipanti (opzionale ma consigliato)

### 3. Carica le Foto
- Seleziona la cartella con le tue foto di gara
- RaceTagger supporta JPG, PNG, WebP e tutti i principali formati RAW
- Le foto RAW vengono automaticamente convertite per l'analisi

### 4. Configura l'Analisi
- **Preset di Ridimensionamento**: Scegli tra VELOCE (più economico), BILANCIATO o QUALITA (più preciso)
- **Ottimizzazione Performance**: Il sistema regola automaticamente la velocità di elaborazione
- **Categoria Sport**: Indica se si tratta di motorsport, running o altro
- **Dati Partecipanti**: Se hai caricato il CSV, il sistema abbinerà automaticamente i numeri ai nomi

### 5. Avvia l'Analisi
- Clicca su "Avvia Analisi"
- Monitora il progresso in tempo reale
- Vedi quante foto sono state elaborate e quanti token hai consumato
- L'elaborazione continua anche se chiudi l'app (recupera automaticamente la sessione)

### 6. Visualizza e Organizza i Risultati
- Esamina i risultati dell'analisi con anteprima delle foto
- Correggi manualmente eventuali errori di riconoscimento
- Organizza le foto in cartelle per numero di gara
- Esporta i metadati in formato CSV

### 7. Scrivi i Metadati
- Scegli tra scrittura EXIF diretta o file XMP sidecar
- I metadati includono: numero gara, nome, categoria, squadra, tag personalizzati
- Le foto sono pronte per la consegna ai clienti o per il tuo workflow

## Sistema Token: Come Funziona

### Cos'è un Token?
Un token rappresenta un'analisi AI di un'immagine. Il consumo di token dipende dalla qualità scelta.

### Consumo Token per Preset

**VELOCE (1080p)**
- Consuma circa 1 token per foto
- Più economico
- Adatto per preview o eventi con budget limitato
- Precisione buona per numeri ben visibili

**BILANCIATO (1440p)** - CONSIGLIATO
- Consuma circa 1.5-2 token per foto
- Miglior rapporto qualità/prezzo
- Adatto per la maggior parte degli eventi
- Ottima precisione generale

**QUALITA (1920p)**
- Consuma circa 2-3 token per foto
- Massima precisione
- Ideale per foto con numeri piccoli o lontani
- Consigliato per eventi importanti

### Pacchetti Token Disponibili (Beta)

**STARTER PACK - €29**
- 3,000 token
- Circa 1,500-3,000 foto (dipende dal preset)
- Perfetto per testare l'app
- I token non scadono mai

**PROFESSIONAL PACK - €49** ⭐ CONSIGLIATO
- 10,000 token
- Circa 5,000-10,000 foto
- Copre 1-2 eventi completi
- I token non scadono mai
- Miglior rapporto qualità/prezzo

**STUDIO PACK - €99**
- 25,000 token
- Circa 12,000-25,000 foto
- Ideale per eventi importanti o più eventi
- I token non scadono mai
- Massimo risparmio per token

### Come Acquistare Token
1. Vai su "Gestione Token" nell'app
2. Scegli il pacchetto che preferisci
3. Completa il pagamento
4. I token vengono aggiunti automaticamente al tuo account
5. Inizia subito a usarli

### Richiesta Token Aggiuntivi
Se finisci i token durante un'analisi:
- L'app ti avvisa automaticamente
- Puoi richiedere token aggiuntivi direttamente dall'interfaccia
- L'amministratore riceve la richiesta
- Una volta approvata, puoi riprendere l'analisi

## Formati File Supportati

### Formati Standard
- **JPG/JPEG**: Formato più comune
- **PNG**: Supporto completo
- **WebP**: Formato moderno supportato

### Formati RAW
RaceTagger supporta nativamente tutti i principali formati RAW:
- **NEF**: Nikon RAW
- **CR2/CR3**: Canon RAW
- **ARW**: Sony RAW
- **ORF**: Olympus RAW
- **RW2**: Panasonic RAW
- **DNG**: Adobe Digital Negative
- **RAW**: Altri formati RAW generici

### Conversione RAW
- I file RAW vengono automaticamente convertiti usando dcraw
- La conversione avviene in background senza perdita di qualità
- Non è necessario pre-convertire i file
- Il sistema gestisce automaticamente la cache dei file convertiti

## File CSV Partecipanti

### Formato CSV Richiesto
Il file CSV deve contenere queste colonne (intestazioni obbligatorie):

```csv
numero,nome,categoria,squadra,metatag
1,Mario Rossi,M40,Team Racing ASD,VIP
23,Laura Bianchi,F30,Running Club,Sponsor
45,Giuseppe Verdi,M50,Indipendente,
```

### Colonne Spiegate
- **numero**: Numero di gara (obbligatorio) - può essere numerico o alfanumerico
- **nome**: Nome e cognome del partecipante (opzionale)
- **categoria**: Categoria di gara (es. M40, Elite, Junior) (opzionale)
- **squadra**: Nome della squadra o club (opzionale)
- **metatag**: Tag personalizzati separati da virgola (opzionale)

### Suggerimenti per il CSV
- Usa Excel, Google Sheets o qualsiasi editor di testo
- Salva come CSV UTF-8 per caratteri accentati
- Assicurati che i numeri corrispondano a quelli delle foto
- Puoi aggiornare il CSV e ricaricarlo in qualsiasi momento

## Velocità di Elaborazione

RaceTagger elabora le immagini a una velocità media di **100 foto al minuto** (circa 0.6 secondi per immagine), ma la velocità effettiva dipende da diversi fattori:

### Velocità per Preset

**VELOCE (1080p)**
- Circa 120 foto al minuto
- 1000 foto = circa 8-9 minuti
- Ideale per batch molto grandi e tempi stretti

**BILANCIATO (1440p)** - CONSIGLIATO
- Circa 100 foto al minuto
- 1000 foto = circa 10 minuti
- Miglior compromesso velocità/qualità

**QUALITA (1920p)**
- Circa 60-80 foto al minuto
- 1000 foto = circa 12-17 minuti
- Massima precisione, tempi leggermente più lunghi

### Fattori che Influenzano la Velocità
- **Connessione Internet**: Più veloce = analisi più rapida
- **Tipo di File**: RAW richiedono conversione iniziale
- **Risorse Sistema**: CPU e RAM disponibili
- **Carico Server AI**: Variabile in base all'orario
- **Dimensione Batch**: Batch più grandi possono attivare ottimizzazioni

### Stime Pratiche
- **Evento piccolo** (200-300 foto): 2-3 minuti
- **Evento medio** (500-1000 foto): 5-10 minuti
- **Evento grande** (2000-3000 foto): 20-30 minuti
- **Serie completa** (5000+ foto): 50-90 minuti

**Nota**: Tutti i tempi sono indicativi e possono variare. Il sistema ottimizza automaticamente il processamento in base alle risorse disponibili.

## Funzionalità Avanzate

### Organizzazione Automatica Cartelle
- RaceTagger può organizzare automaticamente le foto in cartelle per numero di gara
- Crea una struttura: `001_Mario_Rossi/`, `023_Laura_Bianchi/`, etc.
- Le foto vengono copiate (non spostate) per sicurezza
- Puoi personalizzare il formato dei nomi delle cartelle

### Metadati EXIF vs XMP Sidecar

**EXIF (Scrittura Diretta)**
- I metadati sono scritti direttamente nel file foto
- Più pratico per la maggior parte dei workflow
- Supportato da tutti i software di gestione foto
- ATTENZIONE: Modifica il file originale (backup consigliato)

**XMP Sidecar**
- Crea un file separato `.xmp` accanto alla foto originale
- Non modifica il file originale
- Ideale per chi vuole preservare i file RAW intatti
- Supportato da Lightroom, Bridge, e altri software Adobe

### Correzione Manuale Risultati
- Puoi correggere manualmente qualsiasi numero riconosciuto in modo errato
- Clicca sulla foto nei risultati e modifica il numero
- Le correzioni vengono salvate e applicate ai metadati
- Utile per i pochi casi in cui l'AI non è sicura al 100%

### Modalità Offline
- RaceTagger può funzionare offline dopo il login iniziale
- I progetti e i dati sono salvati localmente
- L'analisi richiede connessione internet (API AI)
- I dati sincronizzano automaticamente quando torni online

### Esportazione Risultati
- Esporta i risultati in formato CSV
- Include: nome file, numero gara, nome partecipante, categoria, timestamp
- Utile per statistiche e report
- Può essere importato in Excel o Google Sheets

## Troubleshooting e FAQ

### L'analisi è lenta o si blocca
**Causa**: Troppe foto, memoria insufficiente o connessione internet lenta
**Soluzione**:
- Verifica la velocità della tua connessione internet
- Dividi il batch in gruppi più piccoli (es. 100-200 foto per volta)
- Chiudi altre applicazioni per liberare memoria
- Usa il preset VELOCE per analisi più rapide
- Il sistema attiva automaticamente la modalità streaming per batch molto grandi

### Il riconoscimento dei numeri non è accurato
**Causa**: Qualità foto, numeri piccoli o poco visibili
**Soluzione**:
- Usa il preset QUALITA per foto difficili
- Assicurati che le foto siano a fuoco e ben illuminate
- Per numeri molto piccoli, considera il crop manuale pre-analisi
- Correggi manualmente i pochi errori usando l'interfaccia di correzione

### I file RAW non vengono elaborati
**Causa**: Formato RAW non riconosciuto o dcraw non installato
**Soluzione**:
- Verifica che il formato RAW sia supportato (vedi lista sopra)
- RaceTagger dovrebbe installare dcraw automaticamente
- Prova a riavviare l'app
- Contatta il supporto se il problema persiste

### Il CSV non viene caricato correttamente
**Causa**: Formato CSV non valido o encoding errato
**Soluzione**:
- Verifica che le intestazioni siano: numero,nome,categoria,squadra,metatag
- Salva il CSV come UTF-8 (non ANSI)
- Controlla che non ci siano righe vuote o caratteri speciali
- Usa virgola come separatore (non punto e virgola)

### Ho finito i token durante un'analisi
**Soluzione**:
- L'app ti avviserà automaticamente
- Puoi acquistare un nuovo pacchetto immediatamente
- Oppure richiedi token aggiuntivi tramite l'interfaccia
- L'analisi riprenderà automaticamente dopo l'approvazione

### Non riesco a scrivere i metadati
**Causa**: File protetti da scrittura o permessi insufficienti
**Soluzione**:
- Verifica che i file non siano in sola lettura
- Esegui RaceTagger come amministratore (Windows) o con permessi adeguati
- Se usi RAW, considera l'opzione XMP sidecar invece di EXIF
- Assicurati di avere spazio su disco sufficiente

### L'app non si avvia o crasha
**Soluzione**:
- Riavvia il computer
- Verifica che la tua versione di macOS/Windows sia supportata
- Controlla che non ci siano antivirus che bloccano l'app
- Reinstalla l'applicazione
- Contatta il supporto tecnico con i dettagli del problema

### Come faccio il backup dei miei progetti?
**Soluzione**:
- I progetti sono salvati localmente nel tuo computer
- I dati sono anche sincronizzati con il cloud (Supabase)
- Per backup manuale, esporta i risultati in CSV
- Mantieni sempre una copia delle foto originali

### Posso usare RaceTagger su più computer?
**Risposta**:
- Sì, puoi installare RaceTagger su più computer
- Usa lo stesso account per sincronizzare i progetti
- I token sono condivisi tra tutti i dispositivi
- I progetti sono accessibili da qualsiasi computer dopo il login

### I token scadono?
**Risposta**:
- No, i token acquistati non scadono mai
- Puoi usarli quando vuoi
- Non ci sono limiti di tempo
- I token sono legati al tuo account

### Quanto tempo ci vuole per analizzare 1000 foto?
**Risposta**:
- Con preset VELOCE: circa 8-9 minuti
- Con preset BILANCIATO: circa 10 minuti
- Con preset QUALITA: circa 12-17 minuti
- I tempi possono variare in base alla connessione internet e al carico del server

### Posso analizzare foto di più eventi contemporaneamente?
**Risposta**:
- Sì, puoi creare progetti separati per ogni evento
- Puoi analizzare un solo progetto alla volta per computer
- Ma puoi avviare analisi su computer diversi contemporaneamente
- Consigliato per gestire meglio i risultati

### Perché l'analisi è più lenta del previsto?
**Causa Comune**: Connessione internet lenta o instabile
**Soluzione**:
- Testa la velocità della tua connessione (minimo consigliato: 10 Mbps)
- Chiudi altri programmi che usano internet (streaming, download)
- Prova in un orario diverso se il problema è il carico del server
- Considera il preset VELOCE per ridurre i tempi

## Contatti e Supporto

### Come ottenere supporto?
- **Email**: info@federicopasinetti.it
- **GitHub Issues**: Per segnalazioni di bug tecnici
- **Documentazione**: Consulta questa guida e la documentazione in-app

### Feedback e Suggerimenti
Il tuo feedback è prezioso per migliorare RaceTagger! Contattaci per:
- Suggerimenti di nuove funzionalità
- Segnalazione bug
- Richieste di supporto per nuovi formati
- Feedback generale sull'esperienza utente

### Roadmap Future
RaceTagger è in continua evoluzione. Prossime funzionalità:
- Sistema a abbonamento mensile (oltre ai pacchetti token)
- Riconoscimento automatico categoria sport
- Modalità test A/B per nuovi modelli AI
- Integrazione con servizi di stampa online
- App mobile per gestione progetti

## Privacy e Sicurezza

### Dove sono salvate le mie foto?
- Le foto rimangono sempre sul tuo computer
- Non vengono mai caricate completamente sul cloud
- Solo piccole versioni ridimensionate vengono inviate all'AI per l'analisi
- I metadati sono salvati localmente e sul cloud (opzionale)

### Chi può vedere i miei progetti?
- Solo tu puoi accedere ai tuoi progetti
- I dati sono crittografati in transito e a riposo
- L'amministratore non ha accesso alle tue foto
- Sistema di autenticazione sicuro con Supabase

### Posso eliminare i miei dati?
- Sì, puoi eliminare progetti e account in qualsiasi momento
- I dati vengono rimossi permanentemente
- Contatta il supporto per assistenza nella cancellazione completa

## Glossario Termini

- **Token**: Credito per un'analisi AI di un'immagine
- **Preset**: Configurazione predefinita per qualità e costo dell'analisi
- **RAW**: Formato immagine non elaborato dalla fotocamera
- **EXIF**: Metadati incorporati nel file immagine
- **XMP**: File sidecar con metadati separato dall'immagine originale
- **CSV**: File testo con dati tabellari (es. lista partecipanti)
- **Execution**: Singola sessione di analisi di un batch di foto
- **Batch**: Gruppo di foto analizzate insieme
- **Streaming**: Modalità di elaborazione per batch molto grandi
- **dcraw**: Software per conversione file RAW
- **Supabase**: Piattaforma cloud per storage dati
- **Foto/minuto**: Velocità di elaborazione (circa 100 foto/minuto)

---

**Ultima modifica**: 2025-11-04
**Versione App**: 1.0.10+
**Stato**: Beta - Pricing e funzionalità possono cambiare
