-- ============================================================
-- QUICK EMAIL CASE CHECK - Copia e incolla su Supabase
-- ============================================================

-- 🔍 QUERY 1: Trova email con MAIUSCOLE (il bug)
-- Se restituisce 0 righe = tutto ok, deploy subito!
-- Se restituisce N righe = cleanup necessario
-- ============================================================
SELECT
  email,
  name,
  signup_date,
  LOWER(email) as normalized_email
FROM subscribers
WHERE email != LOWER(email)
ORDER BY signup_date DESC;

-- ============================================================
-- 🔍 QUERY 2: Trova DUPLICATI (stesso email, case diverso)
-- CRITICO: Se trova risultati, serve merge manuale!
-- ============================================================
SELECT
  LOWER(email) as normalized_email,
  COUNT(*) as count,
  STRING_AGG(email, ', ' ORDER BY signup_date) as variations
FROM subscribers
GROUP BY LOWER(email)
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- ============================================================
-- 🔍 QUERY 3: Statistiche generali
-- ============================================================
SELECT
  CASE
    WHEN email = LOWER(email) THEN 'lowercase ✅'
    ELSE 'mixed_case ⚠️'
  END as case_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM subscribers
GROUP BY
  CASE
    WHEN email = LOWER(email) THEN 'lowercase ✅'
    ELSE 'mixed_case ⚠️'
  END;

-- ============================================================
-- 🧹 CLEANUP SCRIPT (esegui SOLO se Query 1 ha trovato email)
-- ⚠️ PRIMA: Verifica che Query 2 = 0 risultati (no duplicati)
-- ============================================================
/*
-- STEP 1: Backup
CREATE TABLE subscribers_backup_email_fix AS
SELECT * FROM subscribers
WHERE email != LOWER(email);

-- STEP 2: Normalizza
UPDATE subscribers
SET email = LOWER(TRIM(email))
WHERE email != LOWER(TRIM(email));

-- STEP 3: Verifica (dovrebbe restituire 0)
SELECT COUNT(*) FROM subscribers WHERE email != LOWER(email);
*/
