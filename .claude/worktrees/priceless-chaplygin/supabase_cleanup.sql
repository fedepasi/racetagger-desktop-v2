-- =================================================================
-- SUPABASE CLEANUP: MANUTENZIONE E PULIZIA DATI
-- =================================================================
-- Questo file contiene query opzionali per la manutenzione del database
-- e la pulizia di dati vecchi o orfani.
--
-- IMPORTANTE: Queste query sono OPZIONALI e vanno eseguite solo se necessario
-- =================================================================

-- =================================================================
-- 1. PULIZIA CSV ORFANI
-- =================================================================
-- Trova e rimuove i metadati CSV per utenti che non esistono più
WITH orphaned_csv AS (
    SELECT ucm.id, ucm.csv_name, ucm.storage_path
    FROM public.user_csv_metadata ucm
    LEFT JOIN auth.users u ON ucm.user_id = u.id
    WHERE u.id IS NULL
)
SELECT 
    COUNT(*) as orphaned_records,
    array_agg(csv_name) as orphaned_files
FROM orphaned_csv;

-- Per rimuovere effettivamente i record orfani (ATTENZIONE: azione irreversibile):
/*
DELETE FROM public.user_csv_metadata 
WHERE user_id NOT IN (SELECT id FROM auth.users);
*/

-- =================================================================
-- 2. PULIZIA CSV VECCHI
-- =================================================================
-- Trova CSV non utilizzati da più di 90 giorni
SELECT 
    ucm.csv_name,
    ucm.last_used,
    u.email,
    EXTRACT(days FROM (now() - ucm.last_used)) as days_since_last_use
FROM public.user_csv_metadata ucm
JOIN auth.users u ON ucm.user_id = u.id
WHERE ucm.last_used < now() - interval '90 days'
ORDER BY ucm.last_used ASC;

-- Per rimuovere CSV non utilizzati da più di 90 giorni (OPZIONALE):
/*
DELETE FROM public.user_csv_metadata 
WHERE last_used < now() - interval '90 days';
*/

-- =================================================================
-- 3. STATISTICHE UTILIZZO
-- =================================================================
-- Statistiche sui CSV per utente
SELECT 
    u.email,
    COUNT(ucm.id) as csv_count,
    MAX(ucm.last_used) as most_recent_use,
    MIN(ucm.created_at) as first_csv_uploaded
FROM auth.users u
LEFT JOIN public.user_csv_metadata ucm ON u.id = ucm.user_id
GROUP BY u.id, u.email
ORDER BY csv_count DESC;

-- Statistiche generali
SELECT 
    COUNT(*) as total_csv_records,
    COUNT(DISTINCT user_id) as users_with_csv,
    AVG(EXTRACT(days FROM (now() - last_used))) as avg_days_since_last_use,
    MIN(created_at) as oldest_csv,
    MAX(created_at) as newest_csv
FROM public.user_csv_metadata;

-- =================================================================
-- 4. VERIFICA INTEGRITÀ STORAGE
-- =================================================================
-- Verifica che i percorsi storage siano validi e seguano il pattern corretto
SELECT 
    csv_name,
    storage_path,
    CASE 
        WHEN storage_path ~ '^[a-fA-F0-9\-]{36}/csv/[0-9]+_.+\.csv$' 
        THEN 'Valid'
        ELSE 'Invalid'
    END as path_validity,
    user_id
FROM public.user_csv_metadata
ORDER BY path_validity, csv_name;

-- =================================================================
-- 5. BACKUP DATI CSV
-- =================================================================
-- Esporta tutti i metadati CSV per backup (utile prima di operazioni di pulizia)
SELECT 
    ucm.id,
    ucm.user_id,
    u.email,
    ucm.csv_name,
    ucm.storage_path,
    ucm.last_used,
    ucm.created_at
FROM public.user_csv_metadata ucm
JOIN auth.users u ON ucm.user_id = u.id
ORDER BY u.email, ucm.created_at;

-- =================================================================
-- 6. RESET COMPLETO (SOLO PER TEST/SVILUPPO)
-- =================================================================
-- ATTENZIONE: Queste query cancellano TUTTI i dati CSV
-- Usare solo in ambiente di sviluppo/test!

/*
-- Cancella tutti i metadati CSV (IRREVERSIBILE!)
TRUNCATE TABLE public.user_csv_metadata CASCADE;

-- Reset della sequenza degli ID se necessario
ALTER SEQUENCE IF EXISTS public.user_csv_metadata_id_seq RESTART WITH 1;
*/

-- =================================================================
-- 7. OTTIMIZZAZIONE PERFORMANCE
-- =================================================================
-- Ricostruisce gli indici per ottimizzare le performance
REINDEX TABLE public.user_csv_metadata;

-- Aggiorna le statistiche per l'ottimizzatore di query
ANALYZE public.user_csv_metadata;

-- Verifica dimensione tabella
SELECT 
    pg_size_pretty(pg_total_relation_size('public.user_csv_metadata')) as table_size,
    pg_size_pretty(pg_relation_size('public.user_csv_metadata')) as table_data_size,
    pg_size_pretty(pg_total_relation_size('public.user_csv_metadata') - pg_relation_size('public.user_csv_metadata')) as indexes_size;

-- =================================================================
-- 8. MONITORAGGIO ATTIVITÀ
-- =================================================================
-- Query per monitorare l'attività CSV recente
SELECT 
    DATE(ucm.last_used) as date,
    COUNT(*) as csv_uses,
    COUNT(DISTINCT ucm.user_id) as active_users
FROM public.user_csv_metadata ucm
WHERE ucm.last_used >= now() - interval '30 days'
GROUP BY DATE(ucm.last_used)
ORDER BY date DESC;

-- CSV più utilizzati
SELECT 
    ucm.csv_name,
    COUNT(*) as usage_count,
    COUNT(DISTINCT ucm.user_id) as used_by_users,
    MAX(ucm.last_used) as last_use
FROM public.user_csv_metadata ucm
GROUP BY ucm.csv_name
HAVING COUNT(*) > 1
ORDER BY usage_count DESC;

-- =================================================================
-- NOTE IMPORTANTI
-- =================================================================
-- 1. Esegui sempre un backup prima di operazioni di pulizia
-- 2. Testa le query di pulizia su un piccolo set di dati prima
-- 3. Le query commentate (/* */) sono potenzialmente distruttive
-- 4. Monitora regolarmente l'utilizzo per ottimizzare la retention
-- =================================================================