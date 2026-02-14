/**
 * Script per generare un report completo sullo stato di Racetagger v1.0.9
 * Include statistiche dal database Supabase e analisi del codice
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Configurazione Supabase (usa le stesse credenziali dell'app)
const SUPABASE_URL = 'https://taompbzifylmdzgbbrpv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhb21wYnppZnlsbWR6Z2JicnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4NDQ3ODYsImV4cCI6MjA2MTQyMDc4Nn0.y1s6em-Fzy012g-RA-Mxcl5LKuxBeRYS9epb35b1yR8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Stats {
  // Utenti
  totalUsers: number;
  adminUsers: number;
  regularUsers: number;
  usersWithTokens: number;

  // Token
  totalTokensPurchased: number;
  totalTokensUsed: number;
  totalTokensRemaining: number;
  totalBonusTokens: number;
  totalEarnedTokens: number;
  totalAdminBonusTokens: number;

  // Token Requests
  pendingTokenRequests: number;
  approvedTokenRequests: number;
  totalTokensRequested: number;
  totalTokensApproved: number;

  // Progetti ed Esecuzioni
  totalProjects: number;
  totalExecutions: number;

  // Transazioni
  totalTransactions: number;
  welcomeBonusTransactions: number;
  usageTransactions: number;
  purchaseTransactions: number;

  // Subscribers
  totalSubscribers: number;
  subscribersWithAccess: number;

  // Timestamp
  generatedAt: string;
}

async function collectStats(): Promise<Stats> {
  console.log('📊 Raccogliendo statistiche dal database Supabase...\n');

  const stats: Stats = {
    totalUsers: 0,
    adminUsers: 0,
    regularUsers: 0,
    usersWithTokens: 0,
    totalTokensPurchased: 0,
    totalTokensUsed: 0,
    totalTokensRemaining: 0,
    totalBonusTokens: 0,
    totalEarnedTokens: 0,
    totalAdminBonusTokens: 0,
    pendingTokenRequests: 0,
    approvedTokenRequests: 0,
    totalTokensRequested: 0,
    totalTokensApproved: 0,
    totalProjects: 0,
    totalExecutions: 0,
    totalTransactions: 0,
    welcomeBonusTransactions: 0,
    usageTransactions: 0,
    purchaseTransactions: 0,
    totalSubscribers: 0,
    subscribersWithAccess: 0,
    generatedAt: new Date().toISOString()
  };

  // 1. Statistiche Utenti (dalla tabella user_tokens)
  console.log('👥 Raccogliendo dati utenti...');
  const { data: userTokens, error: userTokensError } = await supabase
    .from('user_tokens')
    .select('*');

  if (userTokensError) {
    console.error('❌ Errore nel recupero user_tokens:', userTokensError);
  } else if (userTokens) {
    stats.totalUsers = userTokens.length;
    stats.usersWithTokens = userTokens.filter(u => (u.tokens_purchased || 0) > 0).length;
    stats.totalTokensPurchased = userTokens.reduce((sum, u) => sum + (u.tokens_purchased || 0), 0);
    stats.totalTokensUsed = userTokens.reduce((sum, u) => sum + (u.tokens_used || 0), 0);
    console.log(`   ✓ ${stats.totalUsers} utenti totali`);
  }

  // 2. Statistiche Subscribers
  console.log('📧 Raccogliendo dati subscribers...');
  const { data: subscribers, error: subscribersError } = await supabase
    .from('subscribers')
    .select('*');

  if (subscribersError) {
    console.error('❌ Errore nel recupero subscribers:', subscribersError);
  } else if (subscribers) {
    stats.totalSubscribers = subscribers.length;
    stats.subscribersWithAccess = subscribers.filter(s => s.has_access).length;
    stats.totalBonusTokens = subscribers.reduce((sum, s) => sum + (s.bonus_tokens || 0), 0);
    stats.totalEarnedTokens = subscribers.reduce((sum, s) => sum + (s.earned_tokens || 0), 0);
    stats.totalAdminBonusTokens = subscribers.reduce((sum, s) => sum + (s.admin_bonus_tokens || 0), 0);
    console.log(`   ✓ ${stats.totalSubscribers} subscribers totali`);
    console.log(`   ✓ ${stats.subscribersWithAccess} con accesso attivo`);
  }

  // 3. Statistiche Token Requests
  console.log('🎫 Raccogliendo dati token requests...');
  const { data: tokenRequests, error: tokenRequestsError } = await supabase
    .from('token_requests')
    .select('*');

  if (tokenRequestsError) {
    console.error('❌ Errore nel recupero token_requests:', tokenRequestsError);
  } else if (tokenRequests) {
    stats.pendingTokenRequests = tokenRequests.filter(r => r.status === 'pending').length;
    stats.approvedTokenRequests = tokenRequests.filter(r => r.status === 'approved' || r.status === 'completed').length;
    stats.totalTokensRequested = tokenRequests.reduce((sum, r) => sum + (r.tokens_requested || 0), 0);
    stats.totalTokensApproved = tokenRequests
      .filter(r => r.status === 'approved' || r.status === 'completed')
      .reduce((sum, r) => sum + (r.tokens_requested || 0), 0);
    console.log(`   ✓ ${tokenRequests.length} richieste totali`);
    console.log(`   ✓ ${stats.approvedTokenRequests} richieste approvate`);
  }

  // 4. Statistiche Progetti
  console.log('📁 Raccogliendo dati progetti...');
  const { count: projectsCount, error: projectsError } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  if (projectsError) {
    console.error('❌ Errore nel conteggio progetti:', projectsError);
  } else {
    stats.totalProjects = projectsCount || 0;
    console.log(`   ✓ ${stats.totalProjects} progetti totali`);
  }

  // 5. Statistiche Esecuzioni
  console.log('⚡ Raccogliendo dati esecuzioni...');
  const { count: executionsCount, error: executionsError } = await supabase
    .from('executions')
    .select('*', { count: 'exact', head: true });

  if (executionsError) {
    console.error('❌ Errore nel conteggio esecuzioni:', executionsError);
  } else {
    stats.totalExecutions = executionsCount || 0;
    console.log(`   ✓ ${stats.totalExecutions} esecuzioni totali`);
  }

  // 6. Statistiche Transazioni
  console.log('💰 Raccogliendo dati transazioni...');
  const { data: transactions, error: transactionsError } = await supabase
    .from('token_transactions')
    .select('*');

  if (transactionsError) {
    console.error('❌ Errore nel recupero transazioni:', transactionsError);
  } else if (transactions) {
    stats.totalTransactions = transactions.length;
    stats.welcomeBonusTransactions = transactions.filter(t => t.transaction_type === 'welcome_bonus').length;
    stats.usageTransactions = transactions.filter(t => t.transaction_type === 'usage').length;
    stats.purchaseTransactions = transactions.filter(t => t.transaction_type === 'purchase').length;
    console.log(`   ✓ ${stats.totalTransactions} transazioni totali`);
  }

  // Calcola token rimanenti
  stats.totalTokensRemaining = stats.totalTokensPurchased + stats.totalBonusTokens +
                               stats.totalEarnedTokens + stats.totalAdminBonusTokens +
                               stats.totalTokensApproved - stats.totalTokensUsed;

  console.log('\n✅ Raccolta statistiche completata!\n');
  return stats;
}

function generateMarkdownReport(stats: Stats): string {
  const now = new Date(stats.generatedAt);
  const formattedDate = now.toLocaleDateString('it-IT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `# 📊 Racetagger v1.0.9 - Report Completo

> Generato il: **${formattedDate}**

---

## 🎯 Versione & Informazioni Generali

| Attributo | Valore |
|-----------|--------|
| **Versione Desktop** | 1.0.9 |
| **Piattaforme** | macOS (arm64/x64), Windows (x64/arm64), Linux |
| **Modello AI** | gemini-2.5-flash-lite |
| **Database** | Supabase + SQLite (cache locale) |
| **Ultimo Commit** | Release v1.0.9 with UX improvements and category fix |

---

## 👥 Statistiche Utenti

### Panoramica Utenti
| Metrica | Valore |
|---------|--------|
| **Utenti Totali Registrati** | ${stats.totalUsers.toLocaleString('it-IT')} |
| **Utenti con Token Acquistati** | ${stats.usersWithTokens.toLocaleString('it-IT')} |
| **Subscribers Totali** | ${stats.totalSubscribers.toLocaleString('it-IT')} |
| **Subscribers con Accesso** | ${stats.subscribersWithAccess.toLocaleString('it-IT')} |

### Sistema Demo
- **Analisi Gratuite**: 3 per utente non registrato
- **Bonus Registrazione**: 10 token gratuiti
- **Scopo**: Test del software prima dell'acquisto

### Ruoli
- **Admin**: info@federicopasinetti.it, info@racetagger.cloud
- **User**: Tutti gli altri utenti

---

## 💰 Statistiche Token

### Token Overview
| Metrica | Valore |
|---------|--------|
| **Token Totali Acquistati** | ${stats.totalTokensPurchased.toLocaleString('it-IT')} |
| **Token Bonus Assegnati** | ${stats.totalBonusTokens.toLocaleString('it-IT')} |
| **Token Earned (Referral)** | ${stats.totalEarnedTokens.toLocaleString('it-IT')} |
| **Token Admin Bonus** | ${stats.totalAdminBonusTokens.toLocaleString('it-IT')} |
| **Token Approvati (Richieste)** | ${stats.totalTokensApproved.toLocaleString('it-IT')} |
| **Token Totali Disponibili** | ${(stats.totalTokensPurchased + stats.totalBonusTokens + stats.totalEarnedTokens + stats.totalAdminBonusTokens + stats.totalTokensApproved).toLocaleString('it-IT')} |
| **Token Consumati** | ${stats.totalTokensUsed.toLocaleString('it-IT')} |
| **Token Rimanenti** | ${stats.totalTokensRemaining.toLocaleString('it-IT')} |

### Token Requests
| Metrica | Valore |
|---------|--------|
| **Richieste Pending** | ${stats.pendingTokenRequests.toLocaleString('it-IT')} |
| **Richieste Approvate** | ${stats.approvedTokenRequests.toLocaleString('it-IT')} |
| **Token Totali Richiesti** | ${stats.totalTokensRequested.toLocaleString('it-IT')} |

### Transazioni Token
| Tipo Transazione | Numero |
|------------------|--------|
| **Welcome Bonus** | ${stats.welcomeBonusTransactions.toLocaleString('it-IT')} |
| **Utilizzo (Usage)** | ${stats.usageTransactions.toLocaleString('it-IT')} |
| **Acquisti (Purchase)** | ${stats.purchaseTransactions.toLocaleString('it-IT')} |
| **Totale Transazioni** | ${stats.totalTransactions.toLocaleString('it-IT')} |

---

## 📈 Metriche di Utilizzo

### Progetti & Esecuzioni
| Metrica | Valore |
|---------|--------|
| **Progetti Totali Creati** | ${stats.totalProjects.toLocaleString('it-IT')} |
| **Esecuzioni Totali** | ${stats.totalExecutions.toLocaleString('it-IT')} |
| **Riconoscimenti Totali** | ~${stats.totalTokensUsed.toLocaleString('it-IT')} |

> **Nota**: Il numero di riconoscimenti è stimato basandosi sui token consumati (1 token ≈ 1 riconoscimento)

### Media Utilizzo
${stats.totalUsers > 0 ? `
- **Token per Utente**: ${(stats.totalTokensPurchased / stats.totalUsers).toFixed(1)}
- **Progetti per Utente**: ${(stats.totalProjects / stats.totalUsers).toFixed(1)}
- **Esecuzioni per Progetto**: ${stats.totalProjects > 0 ? (stats.totalExecutions / stats.totalProjects).toFixed(1) : '0'}
` : '- Dati insufficienti'}

---

## 💳 Pricing & Business Model

### Pricing Beta (Pacchetti una tantum)
| Piano | Prezzo | Token | Note |
|-------|--------|-------|------|
| **STARTER** | €29 | 3,000 | Test del servizio |
| **PROFESSIONAL** | €49 | 10,000 | ⭐ Consigliato (1-2 eventi) |
| **STUDIO** | €99 | 25,000 | Best value per token |

### Pricing Futuro (Abbonamenti)
| Piano | Prezzo/mese | Foto/mese | Target |
|-------|-------------|-----------|--------|
| **FREE** | Gratis | 100 | Trial |
| **HOBBY** | €39 | 2,000 | Weekend hobbyist |
| **ENTHUSIAST** | €79 | 5,000 | Semi-pro (2-4 eventi) |
| **PROFESSIONAL** | €129 | 10,000 | Fotografo professionale |
| **STUDIO** | €199 | 25,000 | Team 2 fotografi |
| **AGENCY** | €399 | 50,000 | Team 3-5 fotografi |

---

## 🏗️ Architettura Tecnica

### Stack Tecnologico
- **Frontend**: Electron + HTML/CSS/JavaScript
- **Backend**: Node.js + TypeScript
- **Database**: Supabase (PostgreSQL) + SQLite (cache)
- **AI/ML**: Google Gemini 2.5 Flash Lite
- **Storage**: Supabase Storage + Local filesystem
- **Auth**: Supabase Auth con JWT

### Processing Pipeline

#### Unified Image Processor
- Gestione unificata RAW + formati standard
- Queue management e prioritizzazione
- Memory optimization automatica
- Result aggregation e error handling

#### Streaming Pipeline
- **Attivazione**: Automatica per batch > 50 immagini
- **Workers**: RAW(3) + JPEG(2) + Upload(4) + Recognition(2)
- **Disk Management**: Min 5GB free, Alert 8GB
- **Performance**: Batch size 10, Timeout 30s, Retry 3x

#### RAW Processing
- **Converter**: raw-preview-extractor (native) + ExifTool fallback
- **Formati**: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG
- **Batch Size**: 12 files (in modalità BALANCED)
- **Cache**: Enabled per file convertiti

### Ottimizzazioni Performance

#### Livello Corrente: **BALANCED** (Default)
| Feature | Status | Config |
|---------|--------|--------|
| **Parallelization** | ✅ Enabled | 12 upload, 120 analisi concurrent |
| **RAW Batch Processing** | ✅ Enabled | Batch size 12 |
| **Memory Optimization** | ✅ Enabled | Limite 1536MB, buffer pooling |
| **Streaming Processing** | ✅ Enabled | Auto per batch grandi |
| **Database Pooling** | ✅ Enabled | 6 connections |
| **Auto-tuning** | ✅ Enabled | Performance dinamica |

#### Altri Livelli Disponibili
- **DISABLED**: Nessuna ottimizzazione (legacy)
- **CONSERVATIVE**: Safe optimizations only
- **AGGRESSIVE**: Max performance (20 upload, 125 analisi, 2GB RAM)

### Formati Supportati
- **Standard**: JPG, JPEG, PNG, WebP
- **RAW**: NEF, ARW, CR2, CR3, ORF, RAW, RW2, DNG

### Resize Presets
| Preset | Risoluzione | Quality | Uso Consigliato |
|--------|-------------|---------|------------------|
| **VELOCE** | 1080p | 75% | Upload rapidi |
| **BILANCIATO** | 1440p | 85% | Uso generale |
| **QUALITA** | 1920p | 90% | ⭐ Default - Max qualità |

---

## 🔍 Features Attive

### Core Features
✅ AI-powered race number recognition
✅ CSV participant matching con fuzzy logic
✅ XMP sidecar metadata writing
✅ Direct EXIF metadata embedding
✅ Folder organization by race number
✅ Multi-format support (JPG, PNG, WebP, RAW)

### Advanced Features
✅ Temporal clustering (burst mode detection)
✅ Smart matching (OCR + temporal + fuzzy + participant)
✅ Analysis logging (JSONL → Supabase Storage)
✅ Session resume & crash recovery
✅ Performance monitoring dashboard
✅ Offline mode con SQLite cache

### Admin Features
✅ Token request approval workflow
✅ User management
✅ Analytics & metrics
✅ Test Lab (experimental features)

### Test Lab (Experimental)
- Auto-category detection (motorsport/running/altro)
- Motocross 3-digit mode
- Context-aware prompts (race/podium/portrait)
- Participant preset matching
- A/B testing framework

---

## 📊 KPI & Metriche Chiave

### Conversion Funnel
1. **Download App** → ${stats.totalUsers} utenti
2. **Prova Demo** → ~${stats.totalUsers} utenti (stima)
3. **Registrazione** → ${stats.totalUsers} utenti
4. **Acquisto Token** → ${stats.usersWithTokens} utenti
5. **Utilizzo Attivo** → ${stats.totalExecutions} esecuzioni

### Engagement
- **Token Utilization Rate**: ${stats.totalTokensPurchased > 0 ? ((stats.totalTokensUsed / (stats.totalTokensPurchased + stats.totalBonusTokens + stats.totalEarnedTokens + stats.totalAdminBonusTokens + stats.totalTokensApproved)) * 100).toFixed(1) : '0'}%
- **Progetti per Utente**: ${stats.totalUsers > 0 ? (stats.totalProjects / stats.totalUsers).toFixed(2) : '0'}
- **Esecuzioni per Utente**: ${stats.totalUsers > 0 ? (stats.totalExecutions / stats.totalUsers).toFixed(2) : '0'}

### Revenue Metrics (Stima)
${stats.totalTokensPurchased > 0 ? `
- **Token Venduti Totali**: ${stats.totalTokensPurchased.toLocaleString('it-IT')}
- **Revenue Stimato** (a €49/10k): €${((stats.totalTokensPurchased / 10000) * 49).toFixed(2)}
` : '- Dati insufficienti per stime revenue'}

---

## 🎯 Prossimi Obiettivi

### Roadmap Sviluppo
1. ✅ **v1.0.9** - UX improvements e category fix (COMPLETATA)
2. 🔄 **v1.1.0** - Dashboard admin per KPI real-time
3. 📋 **v1.2.0** - Sistema abbonamenti ricorrenti
4. 🚀 **v2.0.0** - Web app complementare

### Metriche da Monitorare
- [ ] Conversion rate demo → registrazione
- [ ] Conversion rate registrazione → acquisto
- [ ] Token utilization rate (target > 70%)
- [ ] Retention rate utenti attivi
- [ ] Average Revenue Per User (ARPU)
- [ ] Customer Lifetime Value (CLV)

### Ottimizzazioni Consigliate
1. Implementare dashboard admin nel management portal
2. Setup telemetry aggregata per metriche automatiche
3. Configurare Supabase Analytics per tracking eventi
4. Implementare A/B testing su pricing
5. Creare sistema di notifiche push per token request

---

## 📝 Note Tecniche

### Database Schema
- **auth.users**: Gestione autenticazione Supabase
- **user_tokens**: Tracking token acquistati/consumati
- **subscribers**: Email list + bonus tokens
- **token_requests**: Workflow richiesta/approvazione token
- **token_transactions**: Log tutte le transazioni token
- **projects**: Progetti utente con CSV associato
- **executions**: Esecuzioni analisi per progetto
- **analysis_log_metadata**: Metadata log analisi

### Security & Privacy
- RLS (Row Level Security) attivo su tutte le tabelle
- JWT tokens con refresh automatico ogni 15 minuti
- Session persistence locale con encryption
- Offline mode supportato con sync automatica
- Analysis logs con user isolation

### Performance Benchmarks
- **Conversione RAW**: ~0.5-1s per file (raw-preview-extractor)
- **AI Recognition**: ~1-2s per immagine (Gemini)
- **Upload**: ~1s per immagine (parallel)
- **Throughput**: ~120 analisi/minuto (BALANCED mode)

---

## 📞 Supporto & Contatti

- **Email**: info@racetagger.cloud
- **Website**: https://racetagger.cloud
- **Admin**: info@federicopasinetti.it

---

*Report generato automaticamente da Racetagger Stats Generator v1.0*
`;
}

async function main() {
  try {
    console.log('🚀 Racetagger Stats Report Generator\n');
    console.log('=====================================\n');

    // Raccogli statistiche
    const stats = await collectStats();

    // Genera report markdown
    console.log('📝 Generando report markdown...');
    const markdown = generateMarkdownReport(stats);

    // Salva file
    const outputPath = path.join(process.cwd(), 'RACETAGGER_STATS_REPORT.md');
    fs.writeFileSync(outputPath, markdown, 'utf8');

    console.log(`\n✅ Report generato con successo!`);
    console.log(`📄 File salvato in: ${outputPath}`);
    console.log(`\n📊 Riepilogo Rapido:`);
    console.log(`   👥 Utenti: ${stats.totalUsers}`);
    console.log(`   🎫 Token Acquistati: ${stats.totalTokensPurchased.toLocaleString('it-IT')}`);
    console.log(`   ⚡ Token Consumati: ${stats.totalTokensUsed.toLocaleString('it-IT')}`);
    console.log(`   💰 Token Rimanenti: ${stats.totalTokensRemaining.toLocaleString('it-IT')}`);
    console.log(`   📁 Progetti: ${stats.totalProjects}`);
    console.log(`   🔄 Esecuzioni: ${stats.totalExecutions}`);

  } catch (error) {
    console.error('\n❌ Errore durante la generazione del report:', error);
    process.exit(1);
  }
}

main();
