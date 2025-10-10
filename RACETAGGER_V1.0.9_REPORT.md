# 📊 Racetagger v1.0.9 - Report Completo Stato Sviluppo

> **Data Report**: 6 Ottobre 2025
> **Versione Desktop**: 1.0.9
> **Ultimo Commit**: Release v1.0.9 with UX improvements and category fix

---

## 🎯 Executive Summary

Racetagger è un'applicazione desktop professionale per l'analisi di fotografie sportive con riconoscimento automatico dei numeri di gara tramite AI. L'app supporta formati RAW e standard, con pipeline di processing ottimizzata e sistema di gestione token avanzato.

### Highlights v1.0.9
- ✅ Architettura production-ready multi-piattaforma
- ✅ AI-powered recognition con Gemini 2.5 Flash Lite
- ✅ Sistema token con workflow richiesta/approvazione
- ✅ Ottimizzazioni performance BALANCED attive
- ✅ Supporto completo formati RAW 
- ✅ Streaming pipeline per batch grandi (>50 immagini)

---

## 👥 Sistema Utenti & Autenticazione

### Modalità Accesso

**Demo Mode (Non registrati)**
- 3 analisi gratuite per utente
- Scopo: test del software prima dell'acquisto
- Nessun dato salvato su cloud

**Utenti Registrati**
- Bonus benvenuto: **10 token gratuiti** all'iscrizione
- Autenticazione: Supabase Auth con JWT
- Session persistence: locale + refresh automatico ogni 15 minuti
- Supporto offline: sessione salvata con parsing JWT locale

### Ruoli Utente

| Ruolo | Email | Permessi |
|-------|-------|----------|
| **Admin** | info@federicopasinetti.it<br>info@racetagger.cloud | - Gestione token requests<br>- Admin features<br>- Analytics completo |
| **User** | Tutti gli altri | - Analisi immagini<br>- Gestione progetti<br>- Folder organization |

### Statistiche Utenti

> **📝 Nota**: Per ottenere questi dati, accedi al dashboard Supabase e esegui:
> ```sql
> -- Utenti totali
> SELECT COUNT(*) FROM auth.users;
>
> -- Utenti con token acquistati
> SELECT COUNT(*) FROM user_tokens WHERE tokens_purchased > 0;
>
> -- Subscribers totali
> SELECT COUNT(*) FROM subscribers;
>
> -- Subscribers con accesso attivo
> SELECT COUNT(*) FROM subscribers WHERE has_access = true;
> ```

| Metrica | Valore | Fonte |
|---------|--------|-------|
| **Utenti Totali Registrati** | _[DA COMPILARE]_ | `auth.users` |
| **Utenti con Token Acquistati** | _[DA COMPILARE]_ | `user_tokens` |
| **Subscribers Email List** | _[DA COMPILARE]_ | `subscribers` |
| **Subscribers con Accesso** | _[DA COMPILARE]_ | `subscribers.has_access = true` |

---

## 💰 Sistema Token & Pricing

### Architettura Token

Il sistema token utilizza 4 tabelle per il tracking completo:

1. **user_tokens**: Token acquistati e consumati per utente
2. **subscribers**: Bonus tokens (welcome, earned, admin bonus)
3. **token_requests**: Workflow richiesta/approvazione token
4. **token_transactions**: Log completo transazioni

### Formula Calcolo Balance

```javascript
totalTokens =
  subscribers.base_tokens +           // Token base acquistati
  subscribers.bonus_tokens +          // Token bonus (referral, promo)
  subscribers.earned_tokens +         // Token guadagnati (referral)
  subscribers.admin_bonus_tokens +    // Token bonus da admin
  SUM(token_requests[approved])       // Token approvati da richieste

remainingTokens = totalTokens - user_tokens.tokens_used
```

### Statistiche Token

> **📝 Query Supabase**:
> ```sql
> -- Token totali acquistati
> SELECT SUM(tokens_purchased) FROM user_tokens;
>
> -- Token totali consumati
> SELECT SUM(tokens_used) FROM user_tokens;
>
> -- Token bonus assegnati
> SELECT SUM(bonus_tokens + earned_tokens + admin_bonus_tokens)
> FROM subscribers;
>
> -- Token requests pending/approved
> SELECT status, COUNT(*), SUM(tokens_requested)
> FROM token_requests
> GROUP BY status;
> ```

| Metrica | Valore | Query |
|---------|--------|-------|
| **Token Totali Acquistati** | _[DA COMPILARE]_ | `SUM(user_tokens.tokens_purchased)` |
| **Token Bonus Assegnati** | _[DA COMPILARE]_ | `SUM(subscribers.bonus_tokens)` |
| **Token Earned (Referral)** | _[DA COMPILARE]_ | `SUM(subscribers.earned_tokens)` |
| **Token Admin Bonus** | _[DA COMPILARE]_ | `SUM(subscribers.admin_bonus_tokens)` |
| **Token Consumati** | _[DA COMPILARE]_ | `SUM(user_tokens.tokens_used)` |
| **Token Rimanenti Totali** | _[DA COMPILARE]_ | _Calcolo formula sopra_ |

### Token Requests

| Metrica | Valore | Query |
|---------|--------|-------|
| **Richieste Pending** | _[DA COMPILARE]_ | `COUNT(*) WHERE status='pending'` |
| **Richieste Approvate** | _[DA COMPILARE]_ | `COUNT(*) WHERE status='approved'` |
| **Token Richiesti Totali** | _[DA COMPILARE]_ | `SUM(tokens_requested)` |
| **Token Approvati** | _[DA COMPILARE]_ | `SUM(tokens_requested) WHERE status='approved'` |

### Transazioni Token

| Tipo | Descrizione | Query |
|------|-------------|-------|
| **welcome_bonus** | Bonus 10 token nuovi utenti | `COUNT(*) WHERE transaction_type='welcome_bonus'` |
| **usage** | Consumo token per analisi | `COUNT(*) WHERE transaction_type='usage'` |
| **purchase** | Acquisto pacchetti token | `COUNT(*) WHERE transaction_type='purchase'` |
| **Totale Transazioni** | Tutte le transazioni | `COUNT(*) FROM token_transactions` |

**Valori**: _[DA COMPILARE accedendo a Supabase]_

---

## 💳 Pricing & Business Model

### Pricing Beta Attuale (Pacchetti Una Tantum)

| Piano | Prezzo | Token | €/Token | Target | Status |
|-------|--------|-------|---------|--------|--------|
| **STARTER** | €29 | 3,000 | €0.0097 | Test servizio | 🟢 Attivo |
| **PROFESSIONAL** ⭐ | €49 | 10,000 | €0.0049 | 1-2 eventi completi | 🟢 Attivo |
| **STUDIO** | €99 | 25,000 | €0.0040 | Eventi grandi/multipli | 🟢 Attivo |

**Caratteristiche Beta**:
- ✅ Token non scadono mai
- ✅ Uso immediato senza vincoli
- ✅ Ideale per fotografi stagionali

### Pricing Futuro (Abbonamenti Mensili)

| Piano | Prezzo/mese | Foto/mese | €/Foto | Target Cliente |
|-------|-------------|-----------|--------|----------------|
| **FREE** | Gratis | 100 | - | Trial / Test |
| **HOBBY** | €39 | 2,000 | €0.0195 | Weekend hobbyist, 1 evento piccolo |
| **ENTHUSIAST** | €79 | 5,000 | €0.0158 | Semi-pro, 2-4 eventi singola giornata |
| **PROFESSIONAL** | €129 | 10,000 | €0.0129 | Fotografo professionale, eventi multipli |
| **STUDIO** | €199 | 25,000 | €0.0080 | Team 2 fotografi, 3-4 eventi completi |
| **AGENCY** | €399 | 50,000 | €0.0080 | Team 3-5 fotografi, serie completa |

**Timing Lancio**: _[DA DEFINIRE - Suggerito Q1 2026]_

---

## 📈 Metriche di Utilizzo & Performance

### Progetti & Esecuzioni

> **📝 Query Supabase**:
> ```sql
> -- Progetti totali
> SELECT COUNT(*) FROM projects;
>
> -- Esecuzioni totali
> SELECT COUNT(*) FROM executions;
>
> -- Media esecuzioni per progetto
> SELECT AVG(exec_count) FROM (
>   SELECT project_id, COUNT(*) as exec_count
>   FROM executions
>   GROUP BY project_id
> );
> ```

| Metrica | Valore | Note |
|---------|--------|------|
| **Progetti Totali Creati** | _[DA COMPILARE]_ | Tutti i progetti utenti |
| **Esecuzioni Totali** | _[DA COMPILARE]_ | Batch di analisi completati |
| **Riconoscimenti Totali** | _[DA COMPILARE]_ | ≈ Token consumati (1:1) |
| **Media Esecuzioni/Progetto** | _[DA COMPILARE]_ | Indica re-engagement |

### KPI & Conversion Funnel

| Stage | Metrica | Formula |
|-------|---------|---------|
| 1. **Acquisizione** | Download/Installazioni | _[Tracking esterno richiesto]_ |
| 2. **Attivazione** | Demo completate | `COUNT(DISTINCT user) WHERE demoUsageCount > 0` |
| 3. **Registrazione** | Sign-ups | `COUNT(*) FROM auth.users` |
| 4. **Monetizzazione** | Acquisti token | `COUNT(*) FROM user_tokens WHERE tokens_purchased > 0` |
| 5. **Retention** | Utenti attivi 30gg | `COUNT(*) WHERE last_execution > NOW() - 30 days` |

**Conversion Rates** _(da calcolare con dati)_:
- Demo → Registrazione: __%
- Registrazione → Acquisto: __%
- Token Utilization Rate: __%

### Engagement Metrics

```sql
-- Token utilization rate
SELECT
  (SUM(tokens_used) * 100.0 / NULLIF(SUM(tokens_purchased), 0)) as utilization_rate
FROM user_tokens;

-- Progetti per utente (engagement)
SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM auth.users), 0)
FROM projects;

-- Esecuzioni per utente (attività)
SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM auth.users), 0)
FROM executions;
```

| Metrica | Valore | Target | Status |
|---------|--------|--------|--------|
| **Token Utilization Rate** | _[DA COMPILARE]_ | >70% | - |
| **Progetti per Utente** | _[DA COMPILARE]_ | >2 | - |
| **Esecuzioni per Utente** | _[DA COMPILARE]_ | >5 | - |
| **Avg. Immagini per Esecuzione** | _[DA COMPILARE]_ | - | - |

---

## 🏗️ Architettura Tecnica

### Stack Tecnologico

| Layer | Tecnologia | Versione | Note |
|-------|------------|----------|------|
| **Desktop Framework** | Electron | 36.0.0 | Multi-piattaforma |
| **Language** | TypeScript | 5.9.2 | Type-safe |
| **Database (Online)** | Supabase (PostgreSQL) | - | Cloud storage |
| **Database (Cache)** | SQLite | better-sqlite3 11.10.0 | Offline mode |
| **AI/ML** | Google Gemini | 2.5 Flash Lite | Image recognition |
| **Storage** | Supabase Storage | - | File upload |
| **Auth** | Supabase Auth | - | JWT-based |
| **Image Processing** | Sharp.js | 0.34.3 | Resize/convert |
| **RAW Processing** | dcraw | auto-install | RAW → JPEG |

### Architettura Processing Pipeline

```
┌─────────────────────────────────────────────────────┐
│           UNIFIED IMAGE PROCESSOR                   │
│  (Central orchestrator - src/unified-image-processor.ts) │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Batch Size Decision  │
              │  < 50: Batch Mode     │
              │  ≥ 50: Streaming Mode │
              └───────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
    ┌──────────────┐           ┌──────────────────┐
    │  BATCH MODE  │           │  STREAMING MODE  │
    │  (Legacy)    │           │  (Pipeline)      │
    └──────────────┘           └──────────────────┘
            │                           │
            ▼                           ▼
    ┌──────────────┐           ┌──────────────────┐
    │ Parallel     │           │ Stage 1: RAW     │
    │ Analyzer     │           │ Conversion       │
    │ (Workers)    │           │ (3 workers)      │
    └──────────────┘           └──────────────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │ Stage 2: JPEG    │
                               │ Extraction       │
                               │ (2 workers)      │
                               └──────────────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │ Stage 3: Upload  │
                               │ (4 workers)      │
                               └──────────────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │ Stage 4: AI      │
                               │ Recognition      │
                               │ (2 workers)      │
                               └──────────────────┘
```

### Ottimizzazioni Performance Attive

**Livello Corrente: BALANCED** (Default production)

| Categoria | Feature | Config | Status |
|-----------|---------|--------|--------|
| **Parallelization** | Max Concurrent Uploads | 12 | ✅ |
| | Max Concurrent Analysis | 120/sec | ✅ |
| | Rate Limit | 120 req/sec | ✅ |
| | Connection Pooling | 6 connections | ✅ |
| **RAW Processing** | Batch Processing | Enabled | ✅ |
| | Batch Size | 12 files | ✅ |
| | RAW Cache | Enabled | ✅ |
| | Async File Ops | Enabled | ✅ |
| **Memory** | Max Usage | 1536 MB | ✅ |
| | Buffer Pooling | 8 buffers/category | ✅ |
| | Garbage Collection | Auto | ✅ |
| **Database** | Connection Pool | 6 connections | ✅ |
| | Batch Operations | Enabled | ✅ |
| **Advanced** | Streaming Pipeline | Auto (>50 img) | ✅ |
| | Auto-tuning | Enabled | ✅ |
| | CPU Optimization | Enabled | ✅ |

**Altri livelli disponibili**:
- `DISABLED`: Nessuna ottimizzazione (debug)
- `CONSERVATIVE`: Safe only (8 upload, 110 analysis)
- `AGGRESSIVE`: Max performance (20 upload, 125 analysis, 2GB RAM)

### Formati Supportati

**Immagini Standard**
- JPG, JPEG
- PNG
- WebP

**Formati RAW** (via dcraw)
- NEF (Nikon)
- ARW (Sony)
- CR2, CR3 (Canon)
- ORF (Olympus)
- RAW, RW2 (Panasonic)
- DNG (Adobe/Universal)

**Resize Presets**

| Preset | Max Resolution | JPEG Quality | Caso d'Uso |
|--------|---------------|--------------|------------|
| **VELOCE** | 1080p | 75% | Upload rapidi, preview |
| **BILANCIATO** | 1440p | 85% | Uso generale |
| **QUALITA** ⭐ | 1920p | 90% | Default - Max qualità |

### Performance Benchmarks

| Operazione | Tempo Medio | Note |
|------------|-------------|------|
| **RAW → JPEG** | 2-3 sec/file | dcraw conversion |
| **AI Recognition** | 1-2 sec/img | Gemini API |
| **Upload Storage** | ~1 sec/img | Parallel upload |
| **Metadata Write** | <0.1 sec | XMP sidecar |
| **Throughput Totale** | ~120 img/min | BALANCED mode |

---

## 🔍 Features Implementate

### Core Features ✅

- [x] **AI-Powered Recognition**: Gemini 2.5 Flash Lite per riconoscimento numeri gara
- [x] **CSV Participant Matching**: Import dati partecipanti con fuzzy matching
- [x] **Multi-Format Support**: JPG, PNG, WebP + RAW (NEF, ARW, CR2, CR3, ORF, DNG)
- [x] **Metadata Management**: XMP sidecar + direct EXIF writing
- [x] **Folder Organization**: Organizzazione automatica per numero gara
- [x] **Offline Mode**: SQLite cache per lavoro offline con sync

### Advanced Features ✅

- [x] **Temporal Clustering**: Rilevamento burst mode e sequenze
- [x] **Smart Matching**: Algoritmo combinato (OCR + temporal + fuzzy + participant)
- [x] **Analysis Logging**: JSONL logs → Supabase Storage per debugging
- [x] **Session Resume**: Recovery automatico crash/interruzioni
- [x] **Performance Monitor**: Dashboard real-time metriche sistema
- [x] **Streaming Pipeline**: Auto-attivazione batch grandi (>50 img)

### Admin Features ✅

- [x] **Token Request Workflow**: Richiesta/approvazione token utenti
- [x] **User Management**: Gestione utenti e permessi
- [x] **Analytics Dashboard**: Metriche utilizzo (da implementare in portal)
- [x] **Test Lab**: Environment testing features sperimentali

### Test Lab (Experimental) 🧪

Location: `/racetagger-app/src/app/management-portal/test-lab`

- [ ] **Auto-category Detection**: Riconoscimento automatico sport (motorsport/running/altro)
- [ ] **Motocross 3-digit Mode**: Gestione speciale numeri motocross
- [ ] **Context-aware Prompts**: Prompt diversi per contesto (race/podium/portrait)
- [ ] **Participant Preset Matching**: Fuzzy matching avanzato con sponsor
- [ ] **A/B Testing Framework**: Confronto modelli/configurazioni

---

## 📊 Database Schema

### Tabelle Principali

| Tabella | Scopo | Campi Chiave |
|---------|-------|--------------|
| **auth.users** | Autenticazione Supabase | id, email, created_at |
| **user_tokens** | Token acquistati/usati | user_id, tokens_purchased, tokens_used |
| **subscribers** | Email list + bonus | email, base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens |
| **token_requests** | Workflow richieste | user_id, tokens_requested, status, justification |
| **token_transactions** | Log transazioni | user_id, amount, transaction_type, image_id |
| **projects** | Progetti utente | id, user_id, name, base_csv_storage_path |
| **executions** | Batch analisi | id, project_id, settings_snapshot, created_at |
| **analysis_log_metadata** | Metadata logs analisi | execution_id, log_file_path |

### Row Level Security (RLS)

Tutte le tabelle hanno RLS abilitato:
- Users possono accedere solo ai propri dati
- Admin hanno accesso completo
- Session JWT per autorizzazione

---

## 🔒 Security & Privacy

### Implementazioni Security

- [x] **Row Level Security (RLS)**: Attivo su tutte le tabelle Supabase
- [x] **JWT Authentication**: Token refresh automatico ogni 15 minuti
- [x] **Session Encryption**: Sessioni locali con encryption
- [x] **Offline Mode**: Sync sicura con conflict resolution
- [x] **API Key Rotation**: Supporto per rotazione chiavi
- [x] **Analysis Logs Isolation**: User-specific log access

### Privacy & GDPR

- [x] User data separation
- [x] Session data local encryption
- [ ] GDPR compliance documentation (da completare)
- [ ] Data export functionality (da implementare)
- [ ] Right to be forgotten (da implementare)

---

## 🚀 Roadmap & Prossimi Obiettivi

### v1.0.x - Bug Fixes & Stabilità (In corso)
- [x] v1.0.9: UX improvements e category fix
- [ ] v1.0.10: Fix issues test lab
- [ ] v1.0.11: Performance optimizations Windows

### v1.1.0 - Admin Dashboard (Q4 2025)
- [ ] Dashboard KPI real-time nel management portal
- [ ] Analytics automatizzato utilizzo token
- [ ] User activity monitoring
- [ ] Revenue tracking & reporting

### v1.2.0 - Subscription System (Q1 2026)
- [ ] Implementazione abbonamenti ricorrenti
- [ ] Stripe/PayPal integration
- [ ] Auto-renewal token mensili
- [ ] Upgrade/downgrade piano

### v2.0.0 - Web App (Q2 2026)
- [ ] Web app complementare
- [ ] Mobile-responsive
- [ ] Real-time sync desktop-web
- [ ] Collaborative features

---

## 📝 Action Items & Raccomandazioni

### Priorità Immediate

1. **📊 Implementare Analytics Dashboard**
   - Creare dashboard admin in management portal
   - Visualizzazione KPI real-time
   - Export report automatici
   - Alert sistema (token bassi, errori)

2. **🔍 Setup Telemetry Aggregata**
   - Tracking eventi utente automatico
   - Performance metrics collection
   - Error reporting centralizzato
   - A/B testing infrastructure

3. **💰 Ottimizzare Conversion Funnel**
   - Analizzare drop-off demo → registrazione
   - Migliorare onboarding primo acquisto
   - Email marketing automation
   - Retargeting utenti inattivi

### Metriche da Monitorare

**KPI Critici**:
- [ ] Conversion rate demo → registrazione (Target: >40%)
- [ ] Conversion rate registrazione → acquisto (Target: >25%)
- [ ] Token utilization rate (Target: >70%)
- [ ] User retention 30 giorni (Target: >50%)
- [ ] Average Revenue Per User (ARPU)
- [ ] Customer Lifetime Value (CLV)

**Setup Necessario**:
```sql
-- Vista per KPI dashboard
CREATE VIEW kpi_dashboard AS
SELECT
  (SELECT COUNT(*) FROM auth.users) as total_users,
  (SELECT COUNT(*) FROM user_tokens WHERE tokens_purchased > 0) as paying_users,
  (SELECT SUM(tokens_purchased) FROM user_tokens) as total_tokens_sold,
  (SELECT SUM(tokens_used) FROM user_tokens) as total_tokens_used,
  (SELECT COUNT(*) FROM executions) as total_executions,
  (SELECT COUNT(*) FROM token_requests WHERE status = 'pending') as pending_requests;
```

### Ottimizzazioni Tecniche

1. **Performance**
   - [ ] Testare AGGRESSIVE mode su hardware high-end
   - [ ] Implementare caching intelligente risultati AI
   - [ ] Ottimizzare query database più frequenti
   - [ ] Setup CDN per Supabase Storage

2. **User Experience**
   - [ ] Ridurre onboarding friction
   - [ ] Tutorial interattivo primo utilizzo
   - [ ] In-app tooltips features avanzate
   - [ ] Dark mode (richiesta utenti)

3. **Business Intelligence**
   - [ ] Integrazione Google Analytics / Mixpanel
   - [ ] Cohort analysis utenti
   - [ ] Churn prediction model
   - [ ] Revenue forecasting

---

## 📞 Contatti & Supporto

**Team Racetagger**
- 📧 Email: info@racetagger.cloud
- 🌐 Website: https://racetagger.cloud
- 👨‍💻 Developer: info@federicopasinetti.it

**Supabase Project**
- 🔗 URL: https://taompbzifylmdzgbbrpv.supabase.co
- 📊 Dashboard: [Supabase Dashboard](https://supabase.com/dashboard/project/taompbzifylmdzgbbrpv)

---

## 📋 Appendice: Query Utili

### Query per Popolare Statistiche

```sql
-- UTENTI
SELECT COUNT(*) as total_users FROM auth.users;
SELECT COUNT(*) as paying_users FROM user_tokens WHERE tokens_purchased > 0;
SELECT COUNT(*) as total_subscribers FROM subscribers;
SELECT COUNT(*) as active_subscribers FROM subscribers WHERE has_access = true;

-- TOKEN
SELECT
  SUM(tokens_purchased) as purchased,
  SUM(tokens_used) as used,
  SUM(tokens_purchased) - SUM(tokens_used) as remaining
FROM user_tokens;

SELECT
  SUM(bonus_tokens) as bonus,
  SUM(earned_tokens) as earned,
  SUM(admin_bonus_tokens) as admin_bonus
FROM subscribers;

-- TOKEN REQUESTS
SELECT status, COUNT(*) as count, SUM(tokens_requested) as total_tokens
FROM token_requests
GROUP BY status;

-- PROGETTI & ESECUZIONI
SELECT COUNT(*) as total_projects FROM projects;
SELECT COUNT(*) as total_executions FROM executions;

-- TRANSAZIONI
SELECT transaction_type, COUNT(*) as count
FROM token_transactions
GROUP BY transaction_type;

-- ENGAGEMENT
SELECT
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) as total_executions,
  AVG(images_count) as avg_images_per_execution
FROM executions
WHERE created_at > NOW() - INTERVAL '30 days';
```

---

**📌 Note**: Questo documento è un template. Le sezioni marcate con _[DA COMPILARE]_ richiedono accesso al database Supabase per essere popolate con i dati reali.

**🔄 Ultimo Aggiornamento**: 6 Ottobre 2025 - v1.0.9
**Total Users**: 81
**Active Users**: 29
**Web Rewuests**: 21510
