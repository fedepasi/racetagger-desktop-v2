# Deployment Edge Function - Tracciamento Execution Settings

## Overview

Dopo aver applicato la migrazione database, devi deployare la Edge Function `track-execution-settings` su Supabase per completare il sistema di tracciamento.

## Opzione 1: Supabase CLI (Raccomandato)

### Prerequisiti
```bash
# Installa Supabase CLI se non già installato
npm install -g supabase
# oppure
brew install supabase/tap/supabase

# Login a Supabase
supabase login

# Link al tuo progetto (sostituisci con il tuo project-ref)
supabase link --project-ref [your-project-ref]
```

### Deploy della Function
```bash
# Dalla directory del progetto
cd /path/to/racetagger-desktop

# Crea la directory per le edge functions se non esiste
mkdir -p supabase/functions/track-execution-settings

# Copia il contenuto della funzione
cp supabase-edge-function-track-execution.ts supabase/functions/track-execution-settings/index.ts

# Deploy la funzione
supabase functions deploy track-execution-settings
```

### Verifica del Deploy
```bash
# Lista le funzioni deployate
supabase functions list

# Output atteso:
# ┌─────────────────────────┬────────┬─────────┬──────────────────────┐
# │          NAME           │ STATUS │ VERSION │     CREATED_AT       │
# ├─────────────────────────┼────────┼─────────┼──────────────────────┤
# │ track-execution-settings│ ACTIVE │    1    │ 2025-01-XX XX:XX:XX  │
# └─────────────────────────┴────────┴─────────┴──────────────────────┘
```

## Opzione 2: Dashboard Supabase

### Passo 1: Accesso al Dashboard
1. Vai su [supabase.com](https://supabase.com)
2. Accedi al tuo progetto
3. Vai su **Edge Functions** nel menu laterale

### Passo 2: Crea la Funzione
1. Clicca su **"New Function"**
2. Nome: `track-execution-settings`
3. Copia **tutto il contenuto** da `supabase-edge-function-track-execution.ts`
4. Incolla nel code editor
5. Clicca **"Deploy"**

### Passo 3: Verifica
- La funzione dovrebbe apparire come **"ACTIVE"** nella lista
- URL sarà: `https://[your-project-ref].functions.supabase.co/track-execution-settings`

## Test della Edge Function

### Test Manuale via cURL

```bash
# Sostituisci con il tuo project URL e anon key
export SUPABASE_URL="https://your-project-ref.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"

# Test con dati mock
curl -X POST "${SUPABASE_URL}/functions/v1/track-execution-settings" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "execution_id": "test-execution-id",
    "config": {
      "model": "gemini-2.5-flash-lite-preview-06-17",
      "category": "motorsport",
      "resize": {"enabled": true, "preset": "bilanciato"}
    },
    "stats": {
      "totalImages": 10,
      "executionDurationMs": 30000
    },
    "app_version": "1.0.0"
  }'
```

**Risposta attesa:**
```json
{
  "success": true,
  "data": {"id": "uuid-generated"}
}
```

### Test dall'App

Dopo il deployment, l'app dovrebbe automaticamente iniziare a tracciare le execution settings quando:

1. L'utente è autenticato
2. Viene eseguita un'analisi con `projectId` e `executionName`
3. L'execution viene completata

**Verifica nei logs:**
```
[Tracking] Created execution uuid-123 for tracking
[Tracking] Execution settings tracked successfully
```

## Configurazione Avanzata

### Variabili Environment (Opzionale)

Se vuoi personalizzare il comportamento della Edge Function:

```bash
# Nel dashboard Supabase > Settings > Functions
TRACKING_ENABLED=true
DEBUG_MODE=false
ANALYTICS_RETENTION_DAYS=365
```

### Headers CORS Personalizzati

La funzione è già configurata per accettare tutte le origini (`*`). Per produzione, potresti restringere:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

## Troubleshooting

### ❌ Funzione Non Trovata
```
Error: Function 'track-execution-settings' not found
```

**Soluzioni:**
- Verifica che il nome sia corretto (senza spazi o caratteri speciali)
- Controlla che la funzione sia stata deployata correttamente
- Aspetta 1-2 minuti dopo il deploy per la propagazione

### ❌ Errori di Autenticazione
```
Error: JWT claims missing sub claim
```

**Soluzioni:**
- L'utente deve essere autenticato nell'app
- Verifica che il token JWT sia valido
- Controlla le policy RLS sulla tabella `execution_settings`

### ❌ Errori di Database
```
Error: relation "execution_settings" does not exist
```

**Soluzioni:**
- Verifica che la migrazione database sia stata applicata
- Controlla che la tabella `execution_settings` esista
- Verifica le policy RLS

### ❌ Timeout della Funzione
```
Error: Function timeout
```

**Soluzioni:**
- La funzione ha un timeout di 10 secondi di default
- Riduci la complessità della logica di tracciamento
- Considera di fare il salvataggio in background

## Monitoraggio

### Logs della Funzione
```bash
# Via CLI
supabase functions logs track-execution-settings

# Live logs
supabase functions logs track-execution-settings --follow
```

### Dashboard Monitoring
1. Vai su **Edge Functions** > **track-execution-settings**
2. Tab **"Logs"** per vedere le invocazioni
3. Tab **"Metrics"** per statistiche di utilizzo

### Query per Verificare i Dati
```sql
-- Verifica che i dati vengano salvati
SELECT 
  id,
  execution_id,
  ai_model,
  sport_category,
  total_images_processed,
  created_at
FROM execution_settings
ORDER BY created_at DESC
LIMIT 10;

-- Statistiche di utilizzo
SELECT 
  ai_model,
  COUNT(*) as usage_count,
  AVG(execution_duration_ms) as avg_duration
FROM execution_settings
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY ai_model
ORDER BY usage_count DESC;
```

## Next Steps

Dopo il deployment:

1. ✅ **Test con app reale**: Esegui alcune analisi e verifica che i dati vengano salvati
2. ✅ **Monitor logs**: Controlla che non ci siano errori
3. ✅ **Verifica analytics**: Usa le query SQL per vedere i primi insights
4. 🔮 **Dashboard frontend**: Sviluppa UI per visualizzare gli analytics
5. 🔮 **Alerting**: Imposta notifiche per errori o anomalie

---

**Supporto**: Se hai problemi con il deployment, controlla prima i logs della funzione e del database per identificare la causa specifica dell'errore.