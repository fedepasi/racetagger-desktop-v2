# RaceTagger Desktop - Changelog v1.0.5 → v1.0.7

## 🚀 Nuove Funzionalità

### 🎯 Sistema di Filtri per Preset Partecipanti
- **Modalità Preset vs Modalità Libera**: Quando carichi un preset CSV, ora vengono mostrati SOLO i numeri che corrispondono ai partecipanti nel preset
- **Filtro Intelligente**: I numeri riconosciuti dall'AI ma non presenti nel preset vengono automaticamente filtrati dai risultati
- **Backward Compatibility**: Senza preset caricato, l'app continua a mostrare tutti i numeri riconosciuti

### 📊 Sistema di Logging Avanzato
- **Log JSONL Strutturati**: Ogni esecuzione genera log dettagliati in formato JSONL
- **Upload Automatico su Supabase**: I log vengono caricati automaticamente su Supabase Storage per debugging remoto
- **Tracciamento Correzioni**: Sistema completo di tracciamento delle correzioni applicate dall'AI
- **Correlazione Esecuzioni**: I log sono facilmente correlabili con le esecuzioni desktop tramite execution_id

### 🔄 Miglioramenti Temporal Clustering
- **Clustering Esclusivo su DateTimeOriginal**: Utilizzo esclusivo del timestamp DateTimeOriginal per il clustering temporale
- **Correzioni Temporali Intelligenti**: Il sistema ora applica correzioni basate sulle foto precedenti e successive nella sequenza
- **Gestione Burst Mode**: Rilevamento automatico di sequenze di foto ravvicinate
- **Sport-Specific Clustering**: Configurazioni di clustering ottimizzate per diversi sport

### 🏁 SmartMatcher Potenziato
- **Filtro per Categoria Sport**: Il matching ora considera la categoria dello sport per risultati più precisi
- **Fuzzy Matching Migliorato**: Algoritmi di matching più sofisticati per nomi e sponsor
- **Cache Intelligente**: Sistema di cache per accelerare il matching su grandi dataset
- **Multi-Vehicle Support**: Supporto completo per immagini con più veicoli

## 🛠️ Miglioramenti Tecnici

### 📝 Gestione Metadati Avanzata
- **Opzioni di Sovrascrittura**: Possibilità di sovrascrivere o appendere metadata esistenti
- **Keywords e Description Dual-Mode**: Sistema a doppio livello per keywords semplici e descrizioni estese
- **XMP Sidecar per RAW**: Creazione automatica di file XMP sidecar per preservare i file RAW originali
- **Encoding UTF-8**: Supporto completo per caratteri speciali e accenti

### 🔧 Edge Function ottimizzata
- **Prompt Ripuliti**: Rimossi i numeri dei preset dal prompt AI per evitare bias
- **Gestione Multi-Veicolo**: Supporto nativo per riconoscimento di più veicoli per immagine
- **Context-Aware Processing**: Il processing considera il contesto della foto (gara, podio, ritratto)

### 🎨 Interfaccia Risultati Rinnovata
- **Visualizzatore Log Integrato**: Visualizzazione dettagliata dei risultati con correzioni applicate
- **Filtri Avanzati**: Possibilità di filtrare per tipo di riconoscimento, match CSV, modifiche manuali
- **Statistiche in Tempo Reale**: Dashboard con metriche di performance dell'esecuzione
- **Virtual Scrolling**: Performance ottimizzate per grandi dataset di risultati

## 🐛 Bug Fix Critici

### ✅ Risolto: Numeri Non-Matchati nei Risultati
- **Problema**: Numeri non presenti nel preset apparivano comunque nei risultati
- **Soluzione**: Sistema di filtro completo che impedisce la visualizzazione di numeri non matchati quando si usa un preset
- **Impatto**: Risultati più puliti e accurati quando si lavora con preset specifici

### ✅ Risolto: Keywords Generate da Dati Non-Filtrati
- **Problema**: Le keywords IPTC includevano tutti i veicoli riconosciuti, anche quelli filtrati
- **Soluzione**: Generazione keywords basata esclusivamente sui dati filtrati
- **Impatto**: Metadata più accurati e coerenti con i risultati visualizzati

### ✅ Risolto: Persistenza Correzioni Manuali
- **Problema**: Le correzioni manuali non venivano sempre salvate correttamente
- **Soluzione**: Sistema di persistenza robusto con auto-save e recovery
- **Impatto**: Nessuna perdita di lavoro manuale di correzione

## 🔄 Miglioramenti Performance

### ⚡ Ottimizzazioni Streaming Pipeline
- **Memory Management**: Gestione memoria ottimizzata per batch grandi
- **Disk Space Monitoring**: Monitoraggio spazio disco con cleanup automatico
- **Worker Pool**: Gestione intelligente dei worker per massimizzare l'efficienza
- **Progress Reporting**: Reporting di progresso più granulare e accurato

### 🏃‍♂️ Elaborazione RAW Migliorata
- **dcraw Performance**: Ottimizzazioni per la conversione RAW con dcraw
- **Thumbnail Generation**: Generazione thumbnail più efficiente per RAW
- **Format Detection**: Rilevamento automatico formato RAW migliorato
- **Error Handling**: Gestione errori più robusta per file RAW corrotti

## 📱 User Experience

### 🎉 Sistema Delight Potenziato
- **Messaggi Contestuali**: Messaggi di caricamento tematici per le corse
- **Micro-Interazioni**: Animazioni e feedback visivi migliorati
- **Accessibility**: Supporto per reduced motion e screen reader
- **Celebrations**: Effetti celebrativi per completamento analisi

### 🔄 Gestione Sessioni Migliorata
- **Session Recovery**: Recupero automatico di sessioni interrotte
- **Persistent State**: Mantenimento stato UI tra riavvii app
- **Token Management**: Gestione automatica refresh token
- **Offline Fallback**: Fallback locale quando Supabase non è disponibile

## 📊 Analytics e Monitoring

### 📈 Metriche Performance
- **Real-time Monitoring**: Monitoraggio prestazioni in tempo reale
- **Memory Usage Tracking**: Tracciamento uso memoria con alerting
- **Processing Time Analytics**: Analisi tempi di elaborazione per ottimizzazioni
- **Error Rate Monitoring**: Monitoraggio tasso errori con alerting automatico

### 🔍 Debug e Diagnostics
- **Enhanced Logging**: Sistema di logging più dettagliato per debugging
- **Performance Dashboard**: Dashboard diagnostiche per sviluppatori
- **Test Infrastructure**: Suite di test performance e regression
- **Health Checks**: Controlli di salute sistema automatici

## 🚀 Preparazione Future
- **ML Integration Ready**: Architettura preparata per future integrazioni ML
- **Scalability Improvements**: Miglioramenti architetturali per scalabilità
- **Plugin System Foundation**: Fondamenta per futuro sistema plugin
- **Cross-Platform Ready**: Preparazione per deployment multi-piattaforma

---

## 💡 Note per Utenti

### 🎯 Raccomandazioni d'Uso
1. **Usa sempre i preset CSV** quando disponibili per risultati più puliti
2. **Controlla i log** nella pagina risultati per capire le correzioni applicate
3. **Monitora lo spazio disco** durante elaborazioni di grandi batch
4. **Salva regolarmente** le correzioni manuali (auto-save attivo ogni 30s)

### ⚠️ Breaking Changes
- I log delle versioni precedenti potrebbero non essere completamente compatibili
- La struttura dei metadati è stata estesa (backward compatible)
- Alcuni preset CSV potrebbero richiedere rigenerazione per sfruttare le nuove funzionalità

---

*Versione 1.0.7 rappresenta un importante step evolutivo di RaceTagger Desktop con focus su accuratezza, performance e user experience.*