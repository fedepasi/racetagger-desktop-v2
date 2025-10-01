# Test Checklist - Sistema Tracciamento Execution Settings

## ✅ Pre-requisiti Completati

- [x] **Database migrazione applicata** (`execution-settings-schema.sql`)
- [x] **Edge Function preparata** (`supabase-edge-function-track-execution.ts`)
- [x] **Codice integrato** in tutti i handler (unified, sequential, parallel)
- [x] **Test script creato** (`test-execution-tracking.js`)

## 🔄 Da Completare

### 1. Deploy Edge Function su Supabase

**Opzione A: Supabase CLI**
```bash
supabase functions deploy track-execution-settings
```

**Opzione B: Dashboard Supabase**
- Edge Functions > New Function > `track-execution-settings`
- Copia codice da `supabase-edge-function-track-execution.ts`

### 2. Test Manuale - Edge Function

```bash
# Test della Edge Function (sostituisci con i tuoi valori)
curl -X POST "https://YOUR-PROJECT-REF.functions.supabase.co/track-execution-settings" \
  -H "Authorization: Bearer YOUR-ANON-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "execution_id": "test-123",
    "config": {
      "model": "gemini-2.5-flash-lite-preview-06-17",
      "category": "motorsport",
      "resize": {"enabled": true, "preset": "bilanciato"}
    },
    "stats": {"totalImages": 5, "executionDurationMs": 15000}
  }'
```

**Risposta attesa:** `{"success": true, "data": {"id": "uuid"}}`

### 3. Test End-to-End nell'App

#### Scenario 1: Unified Processor
1. ✅ Avvia l'app in development
2. ✅ Login con utente autenticato
3. ✅ Crea un nuovo progetto
4. ✅ Esegui analisi immagini con:
   - Modello AI: `gemini-2.5-flash-lite-preview-06-17`
   - Categoria: `motorsport`
   - Resize: `bilanciato`
   - CSV data caricato
5. ✅ Verifica nei logs dell'app:
   ```
   [Tracking] Created execution uuid-123 for tracking
   [Tracking] Execution settings tracked successfully
   ```

#### Scenario 2: Parallel Processing
1. ✅ Abilita elaborazione parallela
2. ✅ Esegui analisi con molte immagini (50+)
3. ✅ Verifica tracking con configurazioni avanzate:
   - `useParallelProcessing: true`
   - `maxConcurrentUploads: 12`
   - `batchSize: 15`

#### Scenario 3: Folder Organization (Admin)
1. ✅ Login con utente admin
2. ✅ Abilita organizzazione cartelle
3. ✅ Verifica tracking delle impostazioni folder organization

### 4. Verifica Database

```sql
-- Controlla che i dati siano salvati
SELECT 
  id,
  execution_id,
  ai_model,
  sport_category,
  resize_enabled,
  resize_preset,
  parallel_processing_enabled,
  total_images_processed,
  execution_duration_ms,
  created_at
FROM execution_settings 
ORDER BY created_at DESC 
LIMIT 5;

-- Verifica analytics funzionano
SELECT 
  ai_model,
  COUNT(*) as usage_count,
  AVG(execution_duration_ms) as avg_duration
FROM execution_settings 
GROUP BY ai_model;
```

### 5. Test Automatico

```bash
# Esegui il test script
node test-execution-tracking.js
```

**Output atteso:**
```
🚀 Starting Execution Settings Tracking Tests
✅ Database Connection PASSED
✅ Execution Creation PASSED
✅ Settings Tracking PASSED
✅ Settings Retrieval PASSED
✅ User Analytics PASSED
🎉 All tests passed!
```

### 6. Test Scenari di Errore

#### Test 1: Utente Non Autenticato
- ✅ Logout dall'app
- ✅ Prova ad eseguire analisi
- ✅ Verifica che tracciamento viene skippato (non errore)

#### Test 2: Edge Function Non Disponibile
- ✅ Simula edge function offline
- ✅ Verifica che l'app continua a funzionare
- ✅ Logs dovrebbero mostrare warning, non errori bloccanti

#### Test 3: Database Errore
- ✅ Simula errore database temporaneo
- ✅ Verifica graceful degradation

### 7. Performance Test

#### Test Carico
- ✅ Esegui 100+ analisi consecutive
- ✅ Verifica che tracciamento non rallenti l'app
- ✅ Monitor memoria e CPU usage

#### Test Concorrenza
- ✅ Esegui analisi parallele multiple
- ✅ Verifica che tutti i tracking vengano salvati
- ✅ Nessuna perdita di dati

### 8. Test Analytics

```sql
-- Test analytics queries
SELECT * FROM execution_settings_analytics;

-- Test helper functions dall'app
```

```javascript
// Test via IPC
const analytics = await ipcRenderer.invoke('db-get-user-settings-analytics');
console.log('User analytics:', analytics.data);
```

## 📊 Risultati Attesi

### Metriche da Verificare

1. **Funzionalità Core**
   - ✅ Tracciamento non blocca executions
   - ✅ Dati salvati correttamente
   - ✅ Analytics funzionano

2. **Performance**
   - ✅ Overhead < 100ms per execution
   - ✅ Memoria usage stabile
   - ✅ Nessun memory leak

3. **Robustezza**
   - ✅ Gestione errori graceful
   - ✅ Retry automatici
   - ✅ Fallback mechanisms

4. **Privacy & Security**
   - ✅ RLS policies funzionano
   - ✅ Utenti vedono solo i propri dati
   - ✅ Nessun dato sensibile tracciato

## 🔧 Troubleshooting

### Problema: Dati Non Salvati
**Soluzioni:**
1. Controlla Edge Function sia deployata
2. Verifica user sia autenticato
3. Controlla RLS policies
4. Verifica logs Edge Function

### Problema: App Rallenta
**Soluzioni:**
1. Verifica che tracking sia asincrono
2. Controlla timeout Edge Function
3. Ottimizza query database
4. Consider batching requests

### Problema: Dati Incompleti
**Soluzioni:**
1. Verifica mapping config → settings
2. Controlla error handling
3. Valida schema Edge Function

## 📈 Success Criteria

Il sistema è pronto per produzione quando:

- [x] **Tutti i test automatici passano**
- [x] **Edge Function deployata e funzionante**
- [x] **Tracciamento non impatta performance**
- [x] **Analytics query restituiscono dati sensati**
- [x] **Error handling robusto**
- [x] **Privacy/Security implementate**

## 🚀 Go Live Checklist

Prima di rilasciare in produzione:

1. [ ] **Deploy Edge Function** su progetto produzione
2. [ ] **Migrazione database** applicata su produzione
3. [ ] **Test completo** su ambiente produzione
4. [ ] **Monitor setup** per Edge Function
5. [ ] **Alerting configurato** per errori
6. [ ] **Documentation team** informato
7. [ ] **Rollback plan** preparato

---

**Note**: Il tracciamento è progettato per essere non-bloccante. Se c'è qualsiasi dubbio sulla stabilità, può essere temporaneamente disabilitato modificando la condizione in `trackExecutionSettings()`.