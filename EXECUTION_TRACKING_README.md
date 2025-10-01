# Sistema di Tracciamento Execution Settings

## Panoramica

Il sistema di tracciamento delle execution settings è stato progettato per raccogliere dati sull'utilizzo dell'app RaceTagger, permettendo di analizzare le preferenze degli utenti e ottimizzare l'esperienza utente.

## Caratteristiche Principali

### 🔒 Privacy e Sicurezza
- **Row Level Security (RLS)**: Ogni utente può accedere solo ai propri dati
- **Tracciamento anonimo**: Non vengono raccolti dati personali sensibili
- **Non bloccante**: Il tracciamento non rallenta o blocca mai l'execution principale
- **Retrocompatibile**: Le versioni esistenti dell'app continuano a funzionare

### 📊 Dati Tracciati
- **Impostazioni AI**: Modello utilizzato, categoria sport
- **Configurazioni metadati**: Strategia scelta, testo personalizzato
- **Preset resize**: Qualità e dimensioni selezionate
- **Elaborazione parallela**: Uso di parallel processing e streaming pipeline
- **Organizzazione cartelle**: Pattern di organizzazione (feature admin)
- **Ottimizzazioni performance**: Livello di ottimizzazione attivo
- **Statistiche esecuzione**: Numero immagini, durata, performance

### 🏗️ Architettura

```
┌─────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│   RaceTagger    │───▶│  Supabase Edge     │───▶│   execution_     │
│   Desktop App   │    │  Function          │    │   settings       │
└─────────────────┘    └─────────────────────┘    └──────────────────┘
                              │
                              ▼
                       ┌─────────────────────┐
                       │  Analytics &        │
                       │  Insights           │
                       └─────────────────────┘
```

## Setup e Installazione

### 1. Migrazione Database

Eseguire manualmente la migrazione SQL su Supabase:

```sql
-- Esegui il contenuto di execution-settings-schema.sql
-- Crea la tabella execution_settings e tutti gli indici necessari
```

### 2. Edge Function

Creare la Edge Function su Supabase:

```bash
# Nella directory del progetto Supabase
supabase functions new track-execution-settings

# Copiare il contenuto di supabase-edge-function-track-execution.ts
# nella funzione creata e deployare:
supabase functions deploy track-execution-settings
```

### 3. Configurazione App

Il tracciamento è già integrato nell'app e si attiva automaticamente quando:
- L'utente è autenticato
- Viene creata un'execution con `projectId` e `executionName`
- La migrazione database è stata applicata

## Utilizzo

### Tracciamento Automatico

Il tracciamento avviene automaticamente durante l'esecuzione di:
- `handleUnifiedImageProcessing()` ✅ (Implementato)
- `handleFolderAnalysis()` ⚠️ (Da implementare)
- `handleParallelFolderAnalysis()` ⚠️ (Da implementare)

### API Disponibili

#### Salvataggio Impostazioni
```javascript
// Via IPC (da renderer)
const result = await ipcRenderer.invoke('db-save-execution-settings', {
  execution_id: 'uuid-execution',
  ai_model: 'gemini-2.5-flash-lite-preview-06-17',
  sport_category: 'motorsport',
  resize_enabled: true,
  resize_preset: 'bilanciato',
  // ... altre impostazioni
});
```

#### Recupero Impostazioni
```javascript
// Via IPC (da renderer)
const result = await ipcRenderer.invoke('db-get-execution-settings', executionId);
if (result.success) {
  console.log('Settings:', result.data);
}
```

#### Analytics Utente
```javascript
// Via IPC (da renderer)
const result = await ipcRenderer.invoke('db-get-user-settings-analytics');
if (result.success) {
  console.log('Analytics:', result.data);
  // {
  //   total_executions: 15,
  //   most_used_models: [{ value: 'gemini-2.5-flash-lite', count: 10, percentage: 66.7 }],
  //   feature_usage_rates: { resize_enabled: 80, parallel_processing: 40 },
  //   performance_stats: { avg_images_per_execution: 125 }
  // }
}
```

## Testing

### Test Automatico
```bash
# Dalla directory dell'app
node test-execution-tracking.js
```

Questo script testa:
- ✅ Connessione database
- ✅ Creazione executions
- ✅ Tracciamento impostazioni
- ✅ Recupero dati
- ✅ Analytics utente
- ✅ Cleanup automatico

### Test Manuale

1. **Avvia l'app in development mode**
2. **Esegui un'analisi di immagini** con diverse configurazioni
3. **Verifica su Supabase** che i dati vengano salvati in `execution_settings`
4. **Testa le analytics** tramite la dashboard dell'app (se implementata)

## Monitoraggio e Analytics

### Query Utili

```sql
-- Modelli AI più utilizzati
SELECT ai_model, COUNT(*) as usage_count
FROM execution_settings
GROUP BY ai_model
ORDER BY usage_count DESC;

-- Tasso di utilizzo delle funzionalità
SELECT 
  AVG(CASE WHEN resize_enabled THEN 1 ELSE 0 END) * 100 as resize_usage_rate,
  AVG(CASE WHEN parallel_processing_enabled THEN 1 ELSE 0 END) * 100 as parallel_usage_rate,
  AVG(CASE WHEN folder_organization_enabled THEN 1 ELSE 0 END) * 100 as folder_org_usage_rate
FROM execution_settings;

-- Performance media per categoria
SELECT 
  sport_category,
  AVG(execution_duration_ms) as avg_duration,
  AVG(total_images_processed) as avg_images
FROM execution_settings
GROUP BY sport_category;
```

### Dashboard Analytics

La view `execution_settings_analytics` fornisce dati aggregati per:
- Trend mensili
- Preferenze per categoria
- Utilizzo funzionalità avanzate
- Metriche di performance

## Troubleshooting

### ⚠️ Tracciamento Non Funziona

**Possibili cause:**
1. **Migrazione non applicata**: Verifica che la tabella `execution_settings` esista
2. **Edge Function non deployata**: Verifica che `track-execution-settings` sia attiva
3. **Utente non autenticato**: Il tracciamento richiede autenticazione
4. **RLS policy**: Verifica che le policy siano configurate correttamente

**Debug:**
```javascript
// Abilita logging dettagliato nel main process
console.log('[Tracking] User authenticated:', authService.getAuthState().isAuthenticated);
console.log('[Tracking] Execution ID:', executionId);
```

### ⚠️ Edge Function Errors

**Controlla i logs:**
```bash
# Logs Edge Function
supabase functions logs track-execution-settings

# Verifica deployment
supabase functions list
```

### ⚠️ Performance Impact

Il tracciamento è progettato per essere:
- **Asincrono**: Non blocca l'execution principale
- **Fault-tolerant**: Gli errori non fermano l'app
- **Lightweight**: Overhead minimo

## Roadmap

### ✅ Fase 1 - Foundation (Completata)
- [x] Schema database
- [x] Edge Function
- [x] Integrazione unified processor
- [x] Test suite

### 🚧 Fase 2 - Completamento (In corso)
- [ ] Integrazione handleFolderAnalysis
- [ ] Integrazione handleParallelFolderAnalysis
- [ ] Dashboard analytics nel frontend
- [ ] Export analytics

### 🔮 Fase 3 - Advanced Analytics (Futuro)
- [ ] Real-time analytics
- [ ] Predictive insights
- [ ] A/B testing support
- [ ] Performance recommendations

## Support

Per problemi o domande:
1. Controlla i logs dell'app per errori di tracciamento
2. Verifica che Supabase sia raggiungibile
3. Esegui il test script per diagnosticare il problema
4. Controlla la configurazione RLS su Supabase

---

**Nota**: Il tracciamento è completamente opzionale e non influisce sulle funzionalità core dell'app. Può essere disabilitato modificando la condizione in `trackExecutionSettings()`.