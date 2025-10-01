# 📋 Setup Supabase per Cache Cleanup System

Questo documento spiega come configurare manualmente Supabase per il sistema di cache cleanup con preservazione dati CSV.

## 🎯 Obiettivo

Il sistema implementato garantisce:
- ✅ **Nessuna perdita dati** - CSV, Projects ed Executions sempre salvati su Supabase
- ✅ **Privacy totale** - Cache locale completamente pulita al logout  
- ✅ **Ripristino automatico** - Dati ripristinati automaticamente al login
- ✅ **Isolamento utenti** - Ogni account vede solo i propri dati

## 🔧 Configurazione Richiesta

### 1. Tabella `user_csv_metadata`

**❌ MANCANTE** - Deve essere creata manualmente

Questa tabella è **essenziale** per:
- Salvare metadati dei CSV caricati dagli utenti
- Ripristinare automaticamente l'ultimo CSV al login
- Mantenere storico CSV per ogni utente

### 2. Edge Functions

**✅ NON NECESSARIE** - Il sistema funziona completamente con API REST standard

## 🚀 Istruzioni di Setup

### Passo 1: Esegui Migration SQL

1. Vai su [Supabase Dashboard](https://supabase.com/dashboard)
2. Seleziona il tuo progetto
3. Vai su **SQL Editor**
4. Apri il file `supabase_migrations.sql` 
5. Copia tutto il contenuto
6. Incolla nell'editor SQL
7. Clicca **Run**

### Passo 2: Verifica Setup

Dopo aver eseguito le migration, verifica che tutto sia configurato:

```sql
-- Verifica tabella creata
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'user_csv_metadata';

-- Verifica RLS abilitato
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'user_csv_metadata';
```

### Passo 3: (Opzionale) Manutenzione

Se necessario, usa le query in `supabase_cleanup.sql` per:
- Pulire dati orfani
- Monitorare statistiche di utilizzo
- Ottimizzare performance

## 📁 File Creati

- **`supabase_migrations.sql`** - Query per creare tabella e configurazioni
- **`supabase_cleanup.sql`** - Query opzionali per manutenzione
- **`README_SUPABASE_SETUP.md`** - Questa guida

## 🔄 Come Funziona il Sistema

### Al Caricamento CSV
```
Utente carica CSV → Salva in memoria → Salva automaticamente su Supabase Storage + Metadati
```

### Al Logout
```
Utente logout → Sincronizza Projects/Executions → Salva CSV corrente → Pulisce cache locale
```

### Al Login
```
Utente login → Scarica Projects da Supabase → Ripristina ultimo CSV → Tutto pronto!
```

## ⚠️ Note Importanti

1. **Non saltare il setup** - Senza la tabella `user_csv_metadata`, i CSV non verranno salvati/ripristinati
2. **RLS essenziale** - Le policies garantiscono che ogni utente veda solo i suoi dati
3. **Storage necessario** - Assicurati che il bucket `csv-files` sia configurato su Supabase Storage
4. **Test raccomandato** - Testa il flusso logout/login dopo il setup

## 🐛 Troubleshooting

### Errore: "table user_csv_metadata doesn't exist"
- **Causa**: Migration non eseguita
- **Soluzione**: Esegui `supabase_migrations.sql`

### Errore: "permission denied for table user_csv_metadata"
- **Causa**: RLS policies mancanti
- **Soluzione**: Verifica che tutte le policies siano state create

### CSV non ripristinato al login
- **Causa**: Tabella mancante o Storage non configurato  
- **Soluzione**: Verifica setup completo + configurazione Storage

## ✅ Checklist Finale

- [ ] Eseguita `supabase_migrations.sql`
- [ ] Verificata creazione tabella `user_csv_metadata`
- [ ] Verificate RLS policies attive
- [ ] Configurato Storage bucket per CSV
- [ ] Testato ciclo logout/login
- [ ] App funzionante senza errori

Una volta completata questa checklist, il sistema di cache cleanup sarà completamente operativo! 🎉