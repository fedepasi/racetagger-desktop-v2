-- ============================================================
-- Email Case Analysis Script
-- ============================================================
-- Run this on Supabase SQL Editor to check email casing issues
-- Project: taompbzifylmdzgbbrpv
-- ============================================================

-- 1️⃣ Find all emails with uppercase characters
SELECT
  id,
  email,
  name,
  signup_date,
  LOWER(email) as normalized_email,
  CASE
    WHEN email = LOWER(email) THEN '✅ OK'
    ELSE '⚠️ NEEDS_CLEANUP'
  END as status
FROM subscribers
WHERE email != LOWER(email)
ORDER BY signup_date DESC;

-- Expected: Should show emails like "Test@Example.com"
-- If returns 0 rows: ✅ All emails already lowercase, safe to deploy
-- If returns N rows: ⚠️ Need cleanup before adding constraint

-- ============================================================

-- 2️⃣ Find potential duplicates (same email, different case)
SELECT
  LOWER(email) as normalized_email,
  COUNT(*) as count,
  STRING_AGG(email, ', ' ORDER BY signup_date) as variations,
  STRING_AGG(name, ', ' ORDER BY signup_date) as names
FROM subscribers
GROUP BY LOWER(email)
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- Expected: Should be empty if no case-sensitive duplicates
-- If returns rows: 🚨 CRITICAL - Manual merge needed before deploy

-- ============================================================

-- 3️⃣ Count emails by case status
SELECT
  CASE
    WHEN email = LOWER(email) THEN 'lowercase'
    ELSE 'mixed_case'
  END as case_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM subscribers
GROUP BY
  CASE
    WHEN email = LOWER(email) THEN 'lowercase'
    ELSE 'mixed_case'
  END;

-- Expected output example:
-- lowercase    | 50 | 87.72%
-- mixed_case   | 7  | 12.28%

-- ============================================================

-- 4️⃣ Sample of mixed case emails (for manual review)
SELECT
  email,
  name,
  has_access,
  approval_status,
  signup_date
FROM subscribers
WHERE email != LOWER(email)
LIMIT 10;

-- Review these manually to understand patterns

-- ============================================================

-- 5️⃣ Check auth.users table for comparison
SELECT
  email,
  LOWER(email) as normalized,
  CASE
    WHEN email = LOWER(email) THEN '✅'
    ELSE '⚠️'
  END as status
FROM auth.users
WHERE email != LOWER(email)
LIMIT 10;

-- Supabase Auth might already normalize emails internally
-- This helps us understand if mismatch exists

-- ============================================================
-- CLEANUP SCRIPT (Run ONLY if analysis shows issues)
-- ============================================================
/*
-- ⚠️ STOP! Before running this, ensure:
--   1. You have backup of subscribers table
--   2. No duplicate emails will be created (check query #2)
--   3. You're running on production with caution

-- STEP 1: Create backup
CREATE TABLE subscribers_backup_pre_normalization AS
SELECT * FROM subscribers
WHERE email != LOWER(email);

-- STEP 2: Verify backup
SELECT COUNT(*) as backed_up_rows
FROM subscribers_backup_pre_normalization;

-- STEP 3: Normalize emails
UPDATE subscribers
SET email = LOWER(TRIM(email))
WHERE email != LOWER(TRIM(email));

-- STEP 4: Verify update
SELECT COUNT(*) as updated_rows
FROM subscribers
WHERE email != LOWER(email);
-- Should return 0

-- STEP 5: Add constraint (prevents future issues)
ALTER TABLE subscribers
ADD CONSTRAINT email_lowercase_check
CHECK (email = LOWER(email));

-- STEP 6: Test constraint
INSERT INTO subscribers (email, name) VALUES ('Test@Example.com', 'Test');
-- Should FAIL with constraint violation

-- STEP 7: Drop backup (after verification)
-- DROP TABLE subscribers_backup_pre_normalization;
*/

-- ============================================================
-- EXPECTED RESULTS GUIDE
-- ============================================================
/*
✅ IDEAL SCENARIO (Safe to deploy immediately):
  - Query #1: 0 rows (all emails already lowercase)
  - Query #2: 0 rows (no duplicates)
  - Action: Deploy Edge Function + Desktop App

⚠️ MINOR CLEANUP NEEDED:
  - Query #1: 1-10 rows with mixed case
  - Query #2: 0 rows (no duplicates)
  - Action: Run cleanup script, then deploy

🚨 MANUAL INTERVENTION REQUIRED:
  - Query #2: Shows duplicates
  - Action: Manually merge duplicate accounts:
    1. Identify primary account (earliest signup_date)
    2. Migrate token_transactions to primary
    3. Migrate user_tokens to primary
    4. Delete duplicate account
    5. Then run cleanup + deploy

📊 BACKWARD COMPATIBILITY ANALYSIS:
  - Old app (1.0.x - 1.1.0 without fix) + New Edge Function = ✅ SAFE
    - Old app sends: "Test@Example.com"
    - Edge Function normalizes: "test@example.com"
    - DB saves: "test@example.com"
    - Result: Even old apps benefit from server-side normalization

  - Old app + Old Edge Function + Existing mixed-case data = ⚠️ CURRENT BUG
    - DB has: "Test@Example.com"
    - Login sends: "Test@Example.com"
    - Supabase Auth normalizes: "test@example.com"
    - Query subscribers: "test@example.com"
    - DB mismatch: NOT FOUND
    - Result: Login succeeds but subscriber data not loaded

  - New app + New Edge Function = ✅ FULLY FIXED
    - App normalizes: "test@example.com"
    - Edge Function normalizes: "test@example.com"
    - DB has: "test@example.com"
    - All queries match: WORKS PERFECTLY
*/
