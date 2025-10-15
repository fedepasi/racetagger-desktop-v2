# Vertex AI Debug Guide

## Problema Corrente
Tutte le richieste stanno usando AI Studio invece di Vertex AI come primary provider.

## Possibili Cause

### 1. Secrets Non Configurati su Supabase
**Verifica:** Supabase Dashboard → Project Settings → Edge Functions → Secrets

Dovresti vedere 3 secrets:
- `VERTEX_PROJECT_ID` = `gen-lang-client-0306323675`
- `VERTEX_LOCATION` = `europe-west1`
- `VERTEX_SERVICE_ACCOUNT_KEY` = (contenuto completo del file JSON service account)

**Fix:** Se mancano, aggiungi i secrets usando il Supabase Dashboard.

### 2. Service Account JSON Malformato
**Sintomo:** Vertex AI fallisce con errore di parsing JSON

**Verifica il contenuto di VERTEX_SERVICE_ACCOUNT_KEY:**
```json
{
  "type": "service_account",
  "project_id": "gen-lang-client-0306323675",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "racetagger-vertex-ai@gen-lang-client-0306323675.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

**Fix:** Assicurati che il JSON sia su una singola riga (no newlines) quando lo inserisci come secret.

### 3. Permessi Service Account Insufficienti
**Sintomo:** Vertex AI fallisce con errore 403 Forbidden

**Permessi richiesti per il service account:**
- `Vertex AI User` role
- `AI Platform Developer` role (opzionale ma consigliato)

**Fix:**
1. Vai su Google Cloud Console
2. IAM & Admin → Service Accounts
3. Trova `racetagger-vertex-ai@gen-lang-client-0306323675.iam.gserviceaccount.com`
4. Aggiungi ruoli: `Vertex AI User`

### 4. API Vertex AI Non Abilitata
**Sintomo:** Vertex AI fallisce con errore "API not enabled"

**Fix:**
1. Vai su Google Cloud Console
2. APIs & Services → Library
3. Cerca "Vertex AI API"
4. Clicca "Enable" se non è già abilitata

### 5. Vertex AI SDK Incompatibile con Deno
**Sintomo:** Errori JavaScript runtime nel Vertex AI SDK

**Verifica nei log Supabase:**
- Cerca `[AI PROVIDER] ⚠️ Vertex AI failed:`
- L'errore dovrebbe mostrare il problema specifico

**Fix possibile:** Potremmo dover usare HTTP REST API invece dell'SDK npm.

## Come Verificare i Log

### Opzione 1: Supabase Dashboard
1. Vai su Dashboard → Edge Functions → analyzeImageDesktopV3
2. Clicca su "Logs"
3. Cerca messaggi:
   - `[VERTEX CONFIG] Vertex AI ENABLED` - conferma che i secrets ci sono
   - `[AI PROVIDER] ⚠️ Vertex AI failed: <errore>` - mostra perché Vertex fallisce
   - `[AI PROVIDER] ✅ Used Vertex AI` - conferma che funziona
   - `[AI PROVIDER] ✅ Used AI Studio (us-central1) (fallback)` - mostra quando usa fallback

### Opzione 2: Desktop App Logs
Quando analizzi le immagini dall'app desktop, dovresti vedere nei log dell'app:
- Response header con `analysis_provider`: dovrebbe essere `vertex-ai_europe-west1_gemini_2.5_flash_lite`

## Test Rapido

Esegui 2-3 analisi di immagini dall'app desktop e poi:

1. **Controlla il database:**
```sql
SELECT
  analysis_provider,
  COUNT(*) as count
FROM analysis_results
WHERE analyzed_at > NOW() - INTERVAL '1 hour'
GROUP BY analysis_provider;
```

Dovresti vedere entrambi:
- `vertex-ai_europe-west1_gemini_2.5_flash_lite`
- `ai-studio_us-central1_gemini_2.5_flash_lite` (solo se Vertex fallisce)

2. **Se vedi SOLO ai-studio**, controlla i log per l'errore specifico di Vertex AI.

## Soluzioni Alternative

### Opzione A: Usare Vertex AI REST API (più affidabile)
Se l'SDK npm continua a dare problemi, possiamo implementare chiamate HTTP dirette all'API Vertex AI.

### Opzione B: Disabilitare temporaneamente Vertex AI
Se vuoi tornare a AI Studio con retry logic:
- Rimuovi i secrets `VERTEX_*` da Supabase
- La funzione userà automaticamente solo AI Studio con exponential backoff

## Monitoring Continuo

Una volta risolto, usa la dashboard `/management-portal/desktop-analytics`:
- **Fallback Rate > 15%**: Vertex AI potrebbe avere problemi intermittenti
- **Fallback Rate > 30%**: Vertex AI ha problemi seri
- **Fallback Rate < 10%**: Sistema funziona perfettamente ✅
