# Token System Refactor Plan — v1.1.0

> **Last updated:** 2026-02-14
> **Status:** In progress — investigation complete, ready for implementation
> **Tracking:** All bugs and tasks consolidated here

---

## Table of Contents

1. [Context & Problem](#context--problem)
2. [CRITICAL BUG: Tokens Not Being Consumed](#critical-bug-tokens-not-being-consumed)
3. [CRITICAL BUG: Double-Counting in Web Dashboard](#critical-bug-double-counting-in-web-dashboard)
4. [Target Architecture](#target-architecture)
5. [Complete Token Write Points Map](#complete-token-write-points-map)
6. [Complete Token Read Points Map](#complete-token-read-points-map)
7. [Stored Procedures Audit](#stored-procedures-audit)
8. [token_transactions Audit Log Gaps](#token_transactions-audit-log-gaps)
9. [Migration SQL Plan](#migration-sql-plan)
10. [Code Changes Required](#code-changes-required)
11. [Deployment Order](#deployment-order)
12. [Verification Queries](#verification-queries)
13. [Potential Pitfalls](#potential-pitfalls)

---

## Context & Problem

The token balance is calculated differently in different places, causing multiple critical bugs where users have tokens but can't process images, or can process but tokens aren't deducted.

**Current state (broken):**
- `user_tokens` table: 1 row per user, `tokens_purchased` and `tokens_used` fields
- `subscribers` table: `base_tokens` (1000), `bonus_tokens` (500), `earned_tokens` (referrals), `admin_bonus_tokens` (admin grants)
- `token_requests` table: approved requests add to balance
- `image_feedback` table: approved feedback with `tokens_earned` field
- `token_transactions` table: audit log of movements (but NOT used as source of truth)

**The original bug:** `pre_authorize_tokens()` RPC checked only `user_tokens.tokens_purchased - tokens_used`, ignoring `subscribers.earned_tokens`, `subscribers.admin_bonus_tokens`, and approved `token_requests`. User Luca had 1441 tokens visible in dashboard but -3559 from the RPC's perspective.

**Temporary fix deployed:** Updated `pre_authorize_tokens()` with JOINs to read all sources. Works but is a band-aid.

**Gumroad status:** Removed from codebase. Only Stripe is active.

---

## CRITICAL BUG: Tokens Not Being Consumed

**Reported by:** Luca (lucamartiniphoto@gmail.com) — 2026-02-14
**Status:** ✅ FIXED — `trackImageProcessed()` + `trackImageError()` aggiunti nel loop principale + path cancellazione
**Severity:** P0 — users process images for free

### Symptoms
Analysis runs successfully on all 31 images, but finalization reports:
```
[Finalize] Batch completed: 0 consumed, 31 refunded, new balance: -3559
```

### Root Cause
`trackImageProcessed()` and `trackImageError()` methods are **defined but never called** in the main processing loop.

**File:** `src/unified-image-processor.ts`

**The tracking methods exist (lines ~5898-5911):**
```typescript
trackImageProcessed(): void {
  if (this.usePreAuthSystem) {
    this.batchUsage.processed++;
  }
}

trackImageError(): void {
  if (this.usePreAuthSystem) {
    this.batchUsage.errors++;
  }
}
```

**But the main loop (lines ~6313-6318) only increments the UI counter:**
```typescript
const { workerId, result, fileName } = await Promise.race(racers);
activeWorkers.delete(workerId);
results.push(result);
this.processedImages++;  // ← UI counter only
// ❌ MISSING: this.trackImageProcessed();
```

**Result:** `batchUsage.processed` stays 0 → `finalize_token_reservation` RPC gets `processed: 0` → calculates `0 - 0 = 0` consumed → refunds all 31 tokens.

### Fix Required
In `src/unified-image-processor.ts`, in the `processBatchInternal()` method:

1. After `this.processedImages++` (~line 6318), add:
```typescript
this.trackImageProcessed();
```

2. In the error catch block for failed workers, add:
```typescript
this.trackImageError();
```

3. Also handle scene-skipped, no-vehicle, and empty-result cases by incrementing the appropriate `batchUsage` counters based on the `result` object.

### Verification
After fix, the finalize log should show:
```
[Finalize] Batch completed: 31 consumed, 0 refunded, new balance: <correct>
```

---

## CRITICAL BUG: Double-Counting in Web Dashboard

**Status:** Diagnosed, not yet fixed
**Severity:** P1 — users see inflated balance on web (deflated on desktop)

### Root Cause
The `approve_token_request` stored procedure **already writes** to `user_tokens.tokens_purchased` when a token request is approved. But the `get-user-token-balance` edge function ALSO sums `token_requests` with status `approved/completed` as a separate source:

```typescript
// get-user-token-balance/index.ts line 164
const total_available = purchased + earned + admin_bonus + feedback_approved + approved_requests;
//                       ↑ already includes approved requests          ↑ counts them AGAIN
```

**Impact:** Every approved token request is counted twice in the web dashboard balance. Desktop pre-auth uses a different calculation, so the balances diverge.

### Fix Required
After the full migration consolidates all sources into `user_tokens.tokens_purchased`:
- Remove `approved_requests` from the calculation entirely
- OR (immediate fix) remove the `token_requests` query from `get-user-token-balance` since they're already in `tokens_purchased`

---

## Target Architecture

**`user_tokens`** = single source of truth for balance:
- `tokens_purchased`: ALL credits (purchases + admin grants + referrals + feedback + signup bonus + access codes)
- `tokens_used`: ALL debits (batch consumption + per-image legacy consumption)
- **Balance** = `tokens_purchased - tokens_used`

**`token_transactions`** = audit log. Every token movement is a row:
- `+3000` purchase (Stripe)
- `+500` admin_bonus
- `+100` referral_earned
- `+10` feedback_approved
- `-487` batch usage (1 row per batch, NOT per image)
- `+13` batch refund (errors)

**Deprecated after migration (zeroed out):**
- `subscribers.base_tokens` (constant 1000)
- `subscribers.bonus_tokens` (constant 500)
- `subscribers.earned_tokens` (referrals)
- `subscribers.admin_bonus_tokens` (admin grants)
- `image_feedback.tokens_earned` (feedback rewards — consolidated)
- `token_requests` approved amounts (already in `tokens_purchased`)

---

## Complete Token Write Points Map

### A. Stored Procedures (RPCs)

| # | RPC Name | Writes `tokens_purchased` | Writes `tokens_used` | Writes `token_transactions` | Called By |
|---|----------|:---:|:---:|:---:|---|
| A1 | `record_stripe_purchase` | ✅ | — | ✅ (`stripe_purchase`) | Stripe webhook (`checkout.session.completed`) |
| A2 | `grant_subscription_tokens` | ✅ | — | ✅ (`subscription_grant`) | Stripe webhook (`invoice.paid`) |
| A3 | `approve_token_request` | ✅ | — | ❌ **GAP** | Admin API `/api/admin/token-requests` |
| A4 | `increment_user_tokens` (web) | ✅ | — | ❌ **GAP** | Edge function `handle-token-request` |
| A5 | `add_tokens_to_profile` | ✅ | — | ❌ **GAP** | Edge function `verify-and-activate-code` |
| A6 | `consume_user_tokens` | — | ✅ | ❌ **GAP** | Desktop `auth-service.ts` (legacy per-image path) |
| A7 | `pre_authorize_tokens` | — | ✅ (+N reserve) | — (writes `batch_token_reservations`) | Desktop unified processor |
| A8 | `finalize_token_reservation` | — | ✅ (-refund) | ✅ (`usage`) | Desktop unified processor |

### B. Edge Functions (Write to `subscribers` — TO MIGRATE)

| # | Edge Function | Currently Writes | Writes `token_transactions` | Needs To |
|---|---|---|:---:|---|
| B1 | `grant-bonus-tokens/index.ts` | `subscribers.admin_bonus_tokens` | ❌ **GAP** | Write `user_tokens.tokens_purchased` + INSERT `token_transactions` |
| B2 | `process-referral-signup/index.ts` | `subscribers.earned_tokens` | ❌ **GAP** | Write `user_tokens.tokens_purchased` + INSERT `token_transactions` |
| B3 | `register-user-unified/index.ts` | `user_tokens` (INSERT) | ✅ | **OK — no change needed** |
| B4 | `verify-and-activate-code/index.ts` | `user_tokens` via `add_tokens_to_profile` | ❌ **GAP** | Also INSERT `token_transactions` |
| B5 | `handle-token-request/index.ts` | `user_tokens` via `increment_user_tokens` | ❌ **GAP** | Also INSERT `token_transactions` |
| B6 | `submit-feedback-with-rewards/index.ts` | `image_feedback.tokens_earned = 10` | ❌ | Token stays in `image_feedback` until approved |
| B7 | `admin-approve-feedback/index.ts` | `image_feedback.admin_approved = true` | ❌ **GAP** | Should also add to `user_tokens.tokens_purchased` + INSERT `token_transactions` |

### C. Web App Direct Writes

| # | Location | Writes | Writes `token_transactions` |
|---|---|---|:---:|
| C1 | Stripe webhook → `handleChargeRefunded()` | `user_tokens.tokens_purchased -= N` | ✅ (`refund`) |
| C2 | Admin user-cleanup API | `user_tokens` reset to 0 | Deletes all `token_transactions` |

### D. Desktop App (Legacy Paths — Will Be Retired with V6 Force Update)

| # | Path | Writes | Writes `token_transactions` |
|---|---|---|:---:|
| D1 | V2-V5 Edge Functions | `user_tokens.tokens_used += 1` per image | ❌ |
| D2 | `auth-service.ts → useTokens()` | `consume_user_tokens` RPC | ✅ (Desktop inserts after RPC call) |

---

## Complete Token Read Points Map

### 3 Different Balance Calculations (ALL INCONSISTENT)

#### Calculation 1: `get-user-token-balance` Edge Function (Web Dashboard)
**File:** `racetagger-app/supabase/functions/get-user-token-balance/index.ts`
```
balance = purchased + earned + admin_bonus + feedback_approved + approved_requests - used
```
**Sources:** `user_tokens` + `subscribers` + `image_feedback` + `token_requests`
**Bug:** Double-counts `approved_requests` (already in `tokens_purchased`)

#### Calculation 2: `admin-user-service.ts → calculateTokenBalance()` (Admin Portal)
**File:** `racetagger-app/src/lib/user-profile/admin-user-service.ts` (lines 154-181)
```
balance = base_tokens + bonus_tokens + earned_tokens + admin_bonus_tokens - tokens_used
```
**Sources:** `subscribers` (4 fields) + `user_tokens.tokens_used`
**Bug:** Does NOT read `user_tokens.tokens_purchased` at all! Ignores Stripe purchases, access codes, signup bonuses.

#### Calculation 3: `auth-service.ts → getTokenBalance()` (Desktop)
**File:** `racetagger-clean/src/auth-service.ts` (lines 1052-1124)
```
balance = tokens_purchased + earned_tokens + admin_bonus_tokens + approved_requests - tokens_used
```
**Sources:** `user_tokens` + `subscribers` + `token_requests`
**Bug:** Same double-counting risk as Calculation 1

### All Read Points

#### Desktop App (`racetagger-clean`)
| # | File | What It Reads | Used For |
|---|---|---|---|
| R1 | `auth-service.ts → getTokenBalance()` | `user_tokens` + `subscribers` + `token_requests` | Balance display + pre-processing check |
| R2 | `pre_authorize_tokens()` RPC | `user_tokens` + `subscribers` + `token_requests` (JOINs in band-aid fix) | Batch reservation |

#### Web App (`racetagger-app`)
| # | File | What It Reads | Used For |
|---|---|---|---|
| R3 | `src/lib/supabase/tokens.ts → getUserTokenBalance()` | Calls `get-user-token-balance` EF | Main balance for user |
| R4 | `src/lib/supabase/tokens.ts → getUserTokenBalanceFallback()` | `user_tokens.tokens_purchased - tokens_used` | Fallback only |
| R5 | `src/lib/user-profile/admin-user-service.ts → calculateTokenBalance()` | `subscribers.*` + `user_tokens.tokens_used` | Admin user profile |
| R6 | `src/lib/user-profile/admin-user-service.ts → getEnrichedUserList()` | Same as R5 (batch) | Admin user list |
| R7 | `src/app/api/admin/user-profile/[userId]/route.ts` | Same as R5 | Admin API |
| R8 | `src/components/ReferralDashboard.tsx` | `subscribers.base_tokens + bonus_tokens + earned_tokens + admin_bonus_tokens` | Referral dashboard |
| R9 | `src/components/user-profile/tabs/TokenBalanceTab.tsx` | Via `getTokenBalance()` | User token tab |
| R10 | `src/app/account/page.tsx` | Via `getUserTokenBalance()` | Account dashboard |
| R11 | `src/app/account/purchases/page.tsx` | Via `getUserTokenBalance()` + `purchases` table | Purchase history |

#### Edge Functions (Reads)
| # | Edge Function | What It Reads | Used For |
|---|---|---|---|
| R12 | `get-registrants/index.ts` | `subscribers.earned_tokens, admin_bonus_tokens` | Admin registrants list |
| R13 | `check-user-registration-status/index.ts` | `subscribers` token fields | Registration status check |
| R14 | `register-subscriber/index.ts` | `subscribers` token fields | Registration response |
| R15 | `quick-register-from-feedback/index.ts` | `subscribers` token fields | Quick registration response |
| R16 | `send-token-balance-email/index.ts` | Via balance calculation | Email content |
| R17 | `grant-bonus-tokens/index.ts` | `subscribers.admin_bonus_tokens` (current value) | Before updating |

---

## Stored Procedures Audit

| RPC | Migration File | tokens_purchased | token_transactions | Notes |
|-----|----------------|:---:|:---:|---|
| `record_stripe_purchase` | `20250125000000_add_stripe_tax_support.sql` | ✅ UPSERT | ✅ `stripe_purchase` | Complete — no change needed |
| `grant_subscription_tokens` | `20250114000001_add_subscription_support.sql` | ✅ UPSERT | ✅ `subscription_grant` | Complete — no change needed |
| `approve_token_request` | `20250831000001_token_request_approval_system.sql` | ✅ UPSERT | ❌ Missing | Add INSERT `token_transactions` |
| `increment_user_tokens` (web) | `20250831000002_add_missing_token_request_columns.sql` | ✅ UPSERT | ❌ Missing | Add INSERT `token_transactions` |
| `add_tokens_to_profile` | `racetagger-clean/.../20251230150000_fix_token_consumption_logic.sql` | ✅ UPDATE/INSERT | ❌ Missing | Add INSERT `token_transactions` |
| `consume_user_tokens` | `racetagger-clean/.../20251230150000_fix_token_consumption_logic.sql` | — (tokens_used) | ❌ Missing | Desktop adds in app code, but RPC should too |
| `finalize_token_reservation` | `racetagger-clean/.../20251230160000_batch_token_reservations.sql` | — (tokens_used) | ✅ `usage` | Complete — no change needed |
| `pre_authorize_tokens` | Band-aid version with JOINs | — (tokens_used) | — | Simplify after migration |

---

## token_transactions Audit Log Gaps

Operations that do NOT write to `token_transactions` (audit gaps):

| Operation | Transaction Type Needed | Priority |
|---|---|---|
| `approve_token_request` RPC | `token_request_grant` | HIGH — active path |
| `increment_user_tokens` RPC | `free_tier_grant` | HIGH — active path |
| `add_tokens_to_profile` RPC | `access_code_grant` | MEDIUM — occasional |
| `grant-bonus-tokens` EF → subscribers | `admin_bonus` | HIGH — admin actively uses |
| `process-referral-signup` EF → subscribers | `referral_bonus` | MEDIUM — occasional |
| `admin-approve-feedback` EF | `feedback_reward` | LOW — rare |
| V2-V5 Edge Functions (per-image) | `usage` | LOW — being retired |

---

## Migration SQL Plan

### STEP 0: Fix trackImageProcessed bug (CODE CHANGE — DEPLOY FIRST)
See [Critical Bug section above](#critical-bug-tokens-not-being-consumed).

### STEP 1: Consolidate `subscribers.base_tokens` + `bonus_tokens` into `user_tokens.tokens_purchased`
```sql
-- NOTE: base_tokens defaults to 1000, bonus_tokens defaults to 500
-- These are the "signup grant" that register-user-unified already writes to user_tokens
-- VERIFY FIRST: Are they already counted? Run the verification query below before executing.

-- If NOT already counted (check shows mismatch):
UPDATE user_tokens ut
SET tokens_purchased = ut.tokens_purchased + COALESCE(s.base_tokens, 1000) + COALESCE(s.bonus_tokens, 500)
FROM subscribers s
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE au.id = ut.user_id
  AND (COALESCE(s.base_tokens, 0) > 0 OR COALESCE(s.bonus_tokens, 0) > 0);

-- Log migration
INSERT INTO token_transactions (user_id, amount, transaction_type, description)
SELECT au.id, COALESCE(s.base_tokens, 1000) + COALESCE(s.bonus_tokens, 500), 'migration',
       format('Consolidated base_tokens (%s) + bonus_tokens (%s) from subscribers',
              COALESCE(s.base_tokens, 1000), COALESCE(s.bonus_tokens, 500))
FROM subscribers s
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE COALESCE(s.base_tokens, 0) > 0 OR COALESCE(s.bonus_tokens, 0) > 0;

-- Zero out
UPDATE subscribers SET base_tokens = 0, bonus_tokens = 0
WHERE base_tokens > 0 OR bonus_tokens > 0;
```

### STEP 2: Consolidate `subscribers.admin_bonus_tokens` into `user_tokens.tokens_purchased`
```sql
UPDATE user_tokens ut
SET tokens_purchased = ut.tokens_purchased + COALESCE(s.admin_bonus_tokens, 0)
FROM subscribers s
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE au.id = ut.user_id
  AND COALESCE(s.admin_bonus_tokens, 0) > 0;

INSERT INTO token_transactions (user_id, amount, transaction_type, description)
SELECT au.id, s.admin_bonus_tokens, 'migration',
       format('Consolidated admin_bonus_tokens (%s) from subscribers into user_tokens', s.admin_bonus_tokens)
FROM subscribers s
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE COALESCE(s.admin_bonus_tokens, 0) > 0;

UPDATE subscribers SET admin_bonus_tokens = 0 WHERE admin_bonus_tokens > 0;
```

### STEP 3: Consolidate `subscribers.earned_tokens` into `user_tokens.tokens_purchased`
```sql
UPDATE user_tokens ut
SET tokens_purchased = ut.tokens_purchased + COALESCE(s.earned_tokens, 0)
FROM subscribers s
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE au.id = ut.user_id
  AND COALESCE(s.earned_tokens, 0) > 0;

INSERT INTO token_transactions (user_id, amount, transaction_type, description)
SELECT au.id, s.earned_tokens, 'migration',
       format('Consolidated earned_tokens (%s) from subscribers into user_tokens', s.earned_tokens)
FROM subscribers s
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE COALESCE(s.earned_tokens, 0) > 0;

UPDATE subscribers SET earned_tokens = 0 WHERE earned_tokens > 0;
```

### STEP 4: Consolidate approved `image_feedback.tokens_earned` into `user_tokens.tokens_purchased`
```sql
-- Sum approved feedback tokens per user and add to user_tokens
UPDATE user_tokens ut
SET tokens_purchased = ut.tokens_purchased + fb.total_earned
FROM (
  SELECT au.id as user_id, SUM(COALESCE(f.tokens_earned, 0)) as total_earned
  FROM image_feedback f
  JOIN subscribers s ON LOWER(s.email) = LOWER(f.user_email)
  JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
  WHERE f.admin_approved = true AND COALESCE(f.tokens_earned, 0) > 0
  GROUP BY au.id
) fb
WHERE ut.user_id = fb.user_id;

-- Log migration
INSERT INTO token_transactions (user_id, amount, transaction_type, description)
SELECT au.id, SUM(COALESCE(f.tokens_earned, 0)), 'migration',
       format('Consolidated %s approved feedback tokens from image_feedback', COUNT(*))
FROM image_feedback f
JOIN subscribers s ON LOWER(s.email) = LOWER(f.user_email)
JOIN auth.users au ON LOWER(au.email) = LOWER(s.email)
WHERE f.admin_approved = true AND COALESCE(f.tokens_earned, 0) > 0
GROUP BY au.id;

-- Mark as migrated (don't delete — keep for history)
-- We'll stop reading from image_feedback for balance calculation
```

### STEP 5: Handle `token_requests` (ALREADY in `tokens_purchased`)
```sql
-- VERIFICATION QUERY — Run this to confirm approved requests are already in tokens_purchased:
SELECT tr.user_id,
       SUM(tr.tokens_requested) as approved_total,
       ut.tokens_purchased,
       au.email
FROM token_requests tr
JOIN user_tokens ut ON ut.user_id = tr.user_id
JOIN auth.users au ON au.id = tr.user_id
WHERE tr.status IN ('approved', 'completed')
GROUP BY tr.user_id, ut.tokens_purchased, au.email;

-- If confirmed already counted → NO migration needed for token_requests
-- The fix is to REMOVE token_requests from balance calculation (see Code Changes)
```

### STEP 6: Compact old -1 transactions (86K+ rows → ~180 rows)
```sql
-- VERIFICATION: Check counts per user before compacting
SELECT user_id, COUNT(*) as row_count, SUM(amount) as total_deducted
FROM token_transactions
WHERE amount = -1 AND transaction_type = 'usage'
GROUP BY user_id
ORDER BY row_count DESC;

-- Create consolidated rows
INSERT INTO token_transactions (user_id, amount, transaction_type, description)
SELECT user_id, SUM(amount), 'usage',
       format('Consolidated %s legacy per-image usage transactions (pre-v1.1.0)', COUNT(*))
FROM token_transactions
WHERE amount = -1 AND transaction_type = 'usage'
GROUP BY user_id;

-- Delete the old -1 rows
DELETE FROM token_transactions WHERE amount = -1 AND transaction_type = 'usage'
  AND description IS NULL; -- safety: only delete un-described legacy rows
```

### STEP 7: Revert `pre_authorize_tokens` to simple version (no JOINs needed)
```sql
CREATE OR REPLACE FUNCTION pre_authorize_tokens(
  p_user_id UUID,
  p_tokens_needed INTEGER,
  p_batch_id TEXT,
  p_image_count INTEGER,
  p_visual_tagging BOOLEAN DEFAULT FALSE
) RETURNS JSONB AS $$
DECLARE
  v_available NUMERIC;
  v_reservation_id UUID;
  v_ttl_minutes INTEGER;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_ttl_minutes := GREATEST(30, LEAST(720, CEIL(p_image_count * 3.0 / 60)));
  v_expires_at := NOW() + (v_ttl_minutes || ' minutes')::INTERVAL;

  SELECT (tokens_purchased - tokens_used) INTO v_available
  FROM user_tokens
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_available IS NULL THEN
    RETURN jsonb_build_object(
      'authorized', false, 'error', 'USER_NOT_FOUND',
      'available', 0, 'needed', p_tokens_needed
    );
  END IF;

  IF v_available < p_tokens_needed THEN
    RETURN jsonb_build_object(
      'authorized', false, 'error', 'INSUFFICIENT_TOKENS',
      'available', v_available::INTEGER, 'needed', p_tokens_needed
    );
  END IF;

  INSERT INTO batch_token_reservations (
    user_id, batch_id, tokens_reserved, expires_at, metadata
  ) VALUES (
    p_user_id, p_batch_id, p_tokens_needed, v_expires_at,
    jsonb_build_object('imageCount', p_image_count, 'visualTagging', p_visual_tagging, 'ttlMinutes', v_ttl_minutes)
  ) RETURNING id INTO v_reservation_id;

  UPDATE user_tokens
  SET tokens_used = tokens_used + p_tokens_needed, last_updated = NOW()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'authorized', true, 'reservationId', v_reservation_id,
    'tokensReserved', p_tokens_needed, 'expiresAt', v_expires_at, 'ttlMinutes', v_ttl_minutes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Code Changes Required

### Phase 0: Hotfixes (Deploy Immediately)

#### 0a. Fix `trackImageProcessed` — CRITICAL
**File:** `racetagger-clean/src/unified-image-processor.ts`
**Location:** `processBatchInternal()` method, main worker race loop (~line 6318)
**Change:** After `this.processedImages++`, add:
```typescript
// Track for token consumption
if (result.success || result.vehicles?.length > 0) {
  this.trackImageProcessed();
} else if (result.error) {
  this.trackImageError();
}
```

#### 0b. Fix double-counting in `get-user-token-balance` — HIGH
**File:** `racetagger-app/supabase/functions/get-user-token-balance/index.ts`
**Change:** Remove the `token_requests` query entirely (lines 148-161) and remove `approved_requests` from `total_available` calculation (line 164). These are already in `tokens_purchased` via `approve_token_request` stored procedure.

### Phase 1: Redirect Write Points to `user_tokens`

#### 1a. `grant-bonus-tokens/index.ts`
**Currently:** `subscribers.update({ admin_bonus_tokens: newAdminBonus })`
**Change to:**
```typescript
// 1. Add to user_tokens.tokens_purchased
await supabase.rpc('add_tokens_to_profile', {
  profile_id: userId,
  token_amount: bonusTokens
});
// 2. Log transaction
await supabase.from('token_transactions').insert({
  user_id: userId,
  amount: bonusTokens,
  transaction_type: 'admin_bonus',
  description: `Admin bonus: ${bonusTokens} tokens (reason: ${reason})`
});
```

#### 1b. `process-referral-signup/index.ts`
**Currently:** `subscribers.update({ earned_tokens: pendingTokens })`
**Change to:**
```typescript
await supabase.rpc('add_tokens_to_profile', {
  profile_id: referrerId,
  token_amount: earnedTokens
});
await supabase.from('token_transactions').insert({
  user_id: referrerId,
  amount: earnedTokens,
  transaction_type: 'referral_bonus',
  description: `Referral bonus: ${earnedTokens} tokens for referring ${referredEmail}`
});
```

#### 1c. `admin-approve-feedback/index.ts`
**Currently:** Only sets `admin_approved = true` on `image_feedback`
**Add:**
```typescript
// After approval, add tokens to user_tokens
await supabase.rpc('add_tokens_to_profile', {
  profile_id: userId,
  token_amount: tokensEarned
});
await supabase.from('token_transactions').insert({
  user_id: userId,
  amount: tokensEarned,
  transaction_type: 'feedback_reward',
  description: `Feedback reward: ${tokensEarned} tokens`
});
```

#### 1d. Add `token_transactions` to RPCs that skip it
Update these stored procedures to INSERT into `token_transactions`:
- `approve_token_request` → add type `token_request_grant`
- `increment_user_tokens` → add type `free_tier_grant`
- `add_tokens_to_profile` → add type `token_grant` (generic)

### Phase 2: Simplify Read Points

#### 2a. Desktop `getTokenBalance()` — `auth-service.ts`
Remove queries to `subscribers` and `token_requests`. Simplify to:
```typescript
const { data } = await this.supabase
  .from('user_tokens')
  .select('tokens_purchased, tokens_used')
  .eq('user_id', userId)
  .single();
return {
  remaining: data.tokens_purchased - data.tokens_used,
  purchased: data.tokens_purchased,
  used: data.tokens_used
};
```

#### 2b. Web `get-user-token-balance` Edge Function
After migration, simplify to read ONLY from `user_tokens`:
```typescript
const total_available = purchased; // Everything is now in tokens_purchased
const remaining = total_available - used;
```
Keep `earned`, `admin_bonus`, `feedback_approved`, `approved_requests` in response for backward compatibility but always return 0.

#### 2c. Admin `calculateTokenBalance()` — `admin-user-service.ts`
**File:** `racetagger-app/src/lib/user-profile/admin-user-service.ts` (lines 154-181)
**Change:** Read from `user_tokens` instead of `subscribers`:
```typescript
const { data } = await supabase
  .from('user_tokens')
  .select('tokens_purchased, tokens_used')
  .eq('user_id', userId)
  .single();
const balance = (data?.tokens_purchased ?? 0) - (data?.tokens_used ?? 0);
```

#### 2d. Admin `getEnrichedUserList()` — `admin-user-service.ts` (lines 214-307)
Update token calculation (lines 283-289) to use `user_tokens` instead of `subscribers` fields.

#### 2e. Admin user-profile API — `admin/user-profile/[userId]/route.ts` (lines 81-100)
Update token balance calculation to read from `user_tokens`.

#### 2f. `ReferralDashboard.tsx` (line 85)
Update `bonusTokens` calculation to read from `user_tokens`.

#### 2g. Edge Functions (Reads)
- `get-registrants/index.ts` → Update token total to read from `user_tokens`
- `check-user-registration-status/index.ts` → Same
- `register-subscriber/index.ts` → Same
- `quick-register-from-feedback/index.ts` → Same
- `send-token-balance-email/index.ts` → Same

---

## STRATEGIA: Release unica v1.1.0

> Siamo solo io e Luca sulla v1.1.0, quindi facciamo TUTTO insieme
> in un'unica release. Nessun force update doppio.
>
> Ordine: prepariamo tutto in locale → deploy server → migrazione SQL → release desktop

---

## STEP 1: Preparare codice in locale (PRIMA di qualsiasi deploy)

### 1A. DESKTOP APP (`racetagger-clean`) — Modifiche codice

| # | Task | File | Stato |
|---|------|------|-------|
| D1 | Fix `trackImageProcessed()` non chiamato nel loop | `src/unified-image-processor.ts` ~line 6318 | ✅ FATTO |
| D2 | Fix tracking anche nel path di cancellazione | `src/unified-image-processor.ts` ~line 6293 | ✅ FATTO |
| D3 | Semplificare `getTokenBalance()` → solo `user_tokens` | `src/auth-service.ts` lines 1052-1124 | ✅ FATTO |
| D4 | Rimuovere query a `subscribers` e `token_requests` dal balance | `src/auth-service.ts` | ✅ FATTO (incluso in D3) |

### 1B. WEB APP (`racetagger-app`) — Edge Functions

| # | Task | File(s) | Stato |
|---|------|---------|-------|
| W1 | Fix double-counting: rimuovere query `token_requests` da balance | `supabase/functions/get-user-token-balance/index.ts` | ✅ FATTO |
| W2 | `grant-bonus-tokens` → scrivere su `user_tokens` + `token_transactions` | `supabase/functions/grant-bonus-tokens/index.ts` | ✅ FATTO |
| W3 | `process-referral-signup` → scrivere su `user_tokens` + `token_transactions` | `supabase/functions/process-referral-signup/index.ts` | ✅ FATTO |
| W4 | `admin-approve-feedback` → aggiungere credit su `user_tokens` + `token_transactions` | `supabase/functions/admin-approve-feedback/index.ts` | ✅ FATTO |

### 1C. WEB APP (`racetagger-app`) — Stored Procedures (Migration SQL)

| # | Task | File | Stato |
|---|------|------|-------|
| W5 | `approve_token_request` → aggiungere INSERT `token_transactions` | `20260214_v110_token_system_refactor.sql` | ✅ FATTO |
| W6 | `increment_user_tokens` → aggiungere INSERT `token_transactions` | `20260214_v110_token_system_refactor.sql` | ✅ FATTO |
| W7 | `add_tokens_to_profile` → aggiungere INSERT `token_transactions` | `20260214_v110_token_system_refactor.sql` | ✅ FATTO |

### 1D. WEB APP — Semplificazione read points

| # | Task | File(s) | Stato |
|---|------|---------|-------|
| R1 | Semplificare `get-user-token-balance` EF → solo `user_tokens` | `supabase/functions/get-user-token-balance/index.ts` | ✅ FATTO |
| R2 | Fix `calculateTokenBalance()` → leggere `user_tokens` non `subscribers` | `src/lib/user-profile/admin-user-service.ts` lines 154-181 | ✅ FATTO |
| R3 | Fix `getEnrichedUserList()` → stessa logica | `src/lib/user-profile/admin-user-service.ts` lines 214-307 | ✅ FATTO |
| R4 | Fix admin user-profile API | `src/app/api/admin/user-profile/[userId]/route.ts` lines 81-100 | ✅ FATTO |
| R5 | Fix `ReferralDashboard.tsx` | `src/components/ReferralDashboard.tsx` line 85 | ✅ FATTO |
| R6 | EF `get-registrants` → `user_tokens` (fallback semplificato) | `supabase/functions/get-registrants/index.ts` | ✅ FATTO |
| R7 | EF `check-user-registration-status` → `user_tokens` | `supabase/functions/check-user-registration-status/index.ts` | ✅ FATTO |
| R8 | EF `register-subscriber` → `user_tokens` | `supabase/functions/register-subscriber/index.ts` | ✅ FATTO |
| R9 | EF `quick-register-from-feedback` → `user_tokens` | `supabase/functions/quick-register-from-feedback/index.ts` | ✅ FATTO |
| R10 | EF `send-token-balance-email` → `user_tokens` | `supabase/functions/send-token-balance-email/index.ts` | ✅ OK (già delega a get-user-token-balance) |

### 1E. SQL — `pre_authorize_tokens` semplificato (senza JOINs)

| # | Task | Stato |
|---|------|-------|
| S1 | Preparare migration SQL con `pre_authorize_tokens` semplificato | ✅ FATTO (`20260214_v110_token_system_refactor.sql`) |

---

## STEP 2: Testare in locale

```
1. Desktop: build & run, lanciare batch di 5-10 immagini
   ├── Verificare log: "[Finalize] Batch completed: N consumed, 0 refunded"
   ├── Verificare che batchUsage.processed == numero immagini
   └── Testare anche cancellazione mid-batch (token tracking ok?)

2. Edge Functions: test locale con supabase functions serve
   ├── get-user-token-balance → balance = tokens_purchased - tokens_used (e basta)
   ├── grant-bonus-tokens → scrive user_tokens + token_transactions
   ├── process-referral-signup → scrive user_tokens + token_transactions
   └── admin-approve-feedback → scrive user_tokens + token_transactions

3. Stored Procedures: test su local Supabase
   ├── approve_token_request → inserisce token_transactions
   ├── increment_user_tokens → inserisce token_transactions
   └── add_tokens_to_profile → inserisce token_transactions

4. Web App: npm run build (no errori TypeScript)

5. Desktop: npm run build (no errori TypeScript)
```

---

## STEP 3: Deploy su Supabase (ORDINE CRITICO)

> ⚠️ L'ordine conta. Prima redirect i write, poi migra i dati, poi semplifica i read.

```
FASE A: Redirect Write Points + Safe Fixes
═══════════════════════════════════════════════════════════════════════════
Deploy Edge Functions + Stored Procedures che scrivono su user_tokens
invece di subscribers. Questo DEVE avvenire prima della migrazione dati.
Include anche fix safe che non cambiano calcolo balance.

  A1. Deploy W2: grant-bonus-tokens → user_tokens + token_transactions
  A2. Deploy W3: process-referral-signup → user_tokens + token_transactions
  A3. Deploy W4: admin-approve-feedback → user_tokens + token_transactions
  A4. Deploy handle-token-request → aggiunto logging token_transactions (monthly_allowance)
  A5. Deploy register-subscriber → signup bonus da system_config (no più hardcoded 1500)
  A6. Deploy quick-register-from-feedback → signup bonus da system_config (no più hardcoded 1500)
  A7. SQL Phase A: phase_a_redirect_writes.sql (da SQL Editor Supabase)
      (approve_token_request + logging, increment_user_tokens pura math, add_tokens_to_profile)
      │
      ▼
  A8. VERIFICA: Testare che bonus/referral/feedback scrivano su user_tokens
      + verificare che token_transactions abbia UNA sola riga per operazione (no double-logging)

═══════════════════════════════════════════════════════════════════════════

FASE B: Migrazione Dati SQL
═══════════════════════════════════════════════════════════════════════════

  B1. SNAPSHOT: Query "Pre-migration" (sezione Verification Queries)
      → SALVARE risultato come CSV. Serve per confronto.

  B2. VERIFICA base_tokens/bonus_tokens: register-user-unified li ha
      GIÀ scritti in tokens_purchased?
      ┌─ Se SÌ: NON eseguire Step 1 (evita double-counting)
      └─ Se NO (utenti vecchi): eseguire Step 1

  B3. SQL Step 2: Consolidare subscribers.admin_bonus_tokens
  B4. SQL Step 3: Consolidare subscribers.earned_tokens
  B5. SQL Step 4: Consolidare image_feedback.tokens_earned (approvati)
  B6. SQL Step 5: Verificare token_requests già in tokens_purchased

  B7. POST-MIGRATION VERIFICA:
      ├── Query "Post-migration" → confrontare con snapshot B1
      └── Se discrepanza: STOP e investigare

═══════════════════════════════════════════════════════════════════════════

FASE C: Deploy Read Semplificati + Desktop
═══════════════════════════════════════════════════════════════════════════
Ora che i dati sono consolidati, possiamo semplificare tutti i read.

  C1. Deploy EFs read semplificati: get-user-token-balance (W1+R1),
      check-user-registration-status (R7), get-registrants (R6)
  C2. Deploy web app (R2, R3, R4, R5)
  C3. SQL Phase C: phase_c_simplify_reads.sql (pre_authorize_tokens semplificato)
  C4. Build e rilascio Desktop v1.1.0 (D1-D4 inclusi)
  C5. Verificare con Luca: batch di test → token scalati + balance OK

  NOTA: register-subscriber e quick-register-from-feedback già deployati in Fase A.

═══════════════════════════════════════════════════════════════════════════
```

---

## STEP 4: Cleanup finale (dopo che v1.1.0 è live e verificata)

```
  E1. Verifica: SUM(token_transactions.amount) == (tokens_purchased - tokens_used)
      per ogni utente

  E2. Compattazione: SQL Step 6 (compact -1 transactions)
      Solo DOPO che E1 è verificato

  E3. Aggiornare tutte le sport_categories a V6 Edge Function

  E4. Force update: obbligare tutti i client desktop a v1.1.0+

  E5. Abilitare cron job per cleanup reservation scadute

  E6. Monitorare per 1 settimana:
      ├── Bilanci coerenti tra desktop e web?
      ├── token_transactions completo (nessun gap)?
      └── Nessun bilancio negativo anomalo?
```

---

## Riepilogo visivo: sequenza di deploy

```
  STEP 1: Codice locale        STEP 3A: Deploy writes    STEP 3B: Migrazione SQL
  ┌──────────────────┐         ┌──────────────────┐      ┌──────────────────┐
  │ Desktop: D1-D4   │         │ EFs: W2,W3,W4    │      │ Snapshot         │
  │ EFs: W1-W4       │────────►│ + handle-token   │─────►│ Consolidamento   │
  │ RPCs: W5-W7      │         │ + register-sub   │      │ Verifica         │
  │ Reads: R1-R10    │         │ + quick-register │      └────────┬─────────┘
  │ SQL: S1          │         │ SQL: phase_a     │               │
  └──────────────────┘         └──────────────────┘               ▼
         │                                              ┌──────────────────┐
         │              STEP 2: Test locale             │ STEP 3C: Deploy  │
         └──────────►  ┌──────────────────┐             │ reads + desktop  │
                       │ Build desktop    │             │ v1.1.0           │
                       │ Build web        │             └────────┬─────────┘
                       │ Test EFs         │                      │
                       └──────────────────┘                      ▼
                                                        ┌──────────────────┐
                                                        │ STEP 4: Cleanup  │
                                                        │ Compattazione    │
                                                        │ Force update     │
                                                        └──────────────────┘
```

**Vantaggi di questa strategia:**
- Un solo rilascio desktop (v1.1.0 con TUTTO incluso)
- Nessun force update doppio
- Gli utenti (solo Luca e Federico) aggiornano una volta sola
- Read semplificati fin dal primo giorno

---

## Verification Queries

### Pre-migration: Snapshot current balances (SAVE THIS OUTPUT)
```sql
SELECT
  au.email,
  ut.tokens_purchased,
  ut.tokens_used,
  COALESCE(s.base_tokens, 0) as base,
  COALESCE(s.bonus_tokens, 0) as bonus,
  COALESCE(s.earned_tokens, 0) as earned,
  COALESCE(s.admin_bonus_tokens, 0) as admin_bonus,
  COALESCE(approved.total, 0) as approved_requests,
  COALESCE(feedback.total, 0) as feedback_approved,
  (ut.tokens_purchased
   + COALESCE(s.base_tokens, 0) + COALESCE(s.bonus_tokens, 0)
   + COALESCE(s.earned_tokens, 0) + COALESCE(s.admin_bonus_tokens, 0)
   + COALESCE(approved.total, 0) + COALESCE(feedback.total, 0)
   - ut.tokens_used) as expected_balance
FROM user_tokens ut
JOIN auth.users au ON au.id = ut.user_id
LEFT JOIN subscribers s ON LOWER(s.email) = LOWER(au.email)
LEFT JOIN (
  SELECT user_id, SUM(tokens_requested) as total
  FROM token_requests WHERE status IN ('approved', 'completed')
  GROUP BY user_id
) approved ON approved.user_id = ut.user_id
LEFT JOIN (
  SELECT au2.id as user_id, SUM(COALESCE(f.tokens_earned, 0)) as total
  FROM image_feedback f
  JOIN subscribers s2 ON LOWER(s2.email) = LOWER(f.user_email)
  JOIN auth.users au2 ON LOWER(au2.email) = LOWER(s2.email)
  WHERE f.admin_approved = true
  GROUP BY au2.id
) feedback ON feedback.user_id = ut.user_id
ORDER BY expected_balance DESC;
```

### Post-migration: Verify balances unchanged
```sql
SELECT
  au.email,
  ut.tokens_purchased,
  ut.tokens_used,
  (ut.tokens_purchased - ut.tokens_used) as new_balance
FROM user_tokens ut
JOIN auth.users au ON au.id = ut.user_id
ORDER BY new_balance DESC;
```

### Verify token_transactions SUM matches (after compaction)
```sql
SELECT
  ut.user_id,
  au.email,
  (ut.tokens_purchased - ut.tokens_used) as balance_from_table,
  COALESCE(SUM(tt.amount), 0) as balance_from_transactions
FROM user_tokens ut
JOIN auth.users au ON au.id = ut.user_id
LEFT JOIN token_transactions tt ON tt.user_id = ut.user_id
GROUP BY ut.user_id, au.email, ut.tokens_purchased, ut.tokens_used
HAVING (ut.tokens_purchased - ut.tokens_used) != COALESCE(SUM(tt.amount), 0)
ORDER BY au.email;
```

### Check for Luca specifically
```sql
SELECT
  ut.tokens_purchased, ut.tokens_used,
  (ut.tokens_purchased - ut.tokens_used) as balance,
  COALESCE(s.base_tokens, 0) as base,
  COALESCE(s.bonus_tokens, 0) as bonus,
  COALESCE(s.earned_tokens, 0) as earned,
  COALESCE(s.admin_bonus_tokens, 0) as admin_bonus
FROM user_tokens ut
JOIN auth.users au ON au.id = ut.user_id
LEFT JOIN subscribers s ON LOWER(s.email) = LOWER(au.email)
WHERE au.email = 'lucamartiniphoto@gmail.com';
```

---

## Potential Pitfalls

### 1. `base_tokens` + `bonus_tokens` already in `tokens_purchased`
The `register-user-unified` Edge Function writes signup tokens to BOTH `subscribers` (base_tokens, bonus_tokens) AND `user_tokens` (tokens_purchased). If we blindly consolidate, we'll double-count.
**Mitigation:** Run verification query comparing `tokens_purchased` vs `base_tokens + bonus_tokens` for each user BEFORE Step 1.

### 2. `token_requests` already in `tokens_purchased`
`approve_token_request` stored procedure writes to `user_tokens.tokens_purchased`. So approved requests are already counted.
**Mitigation:** Do NOT migrate `token_requests`. Just remove from balance calculation.

### 3. Race condition during migration
If an admin grants bonus tokens WHILE migration runs, it could write to `subscribers.admin_bonus_tokens` (old path) after we zeroed it.
**Mitigation:** Deploy Phase 1 code changes FIRST (redirect writes to `user_tokens`), THEN run data migration.

### 4. Web app shared Edge Functions
The Edge Functions in `supabase/functions/` serve BOTH desktop and web. Changes affect both apps simultaneously.
**Mitigation:** Deploy code changes + test on staging first.

### 5. `image_feedback` lazy calculation
Currently `get-user-token-balance` queries `image_feedback` every time. After migration, approved feedback tokens are in `user_tokens`, but NEW feedback approvals need to be caught by the updated `admin-approve-feedback` EF (Phase 1c).
**Mitigation:** Deploy Phase 1c before running migration Step 4.

### 6. Compacting -1 transactions
Must be done AFTER verifying `SUM(amount)` matches expected balances for each user.
**Mitigation:** Run verification query first. Only compact if numbers match.

### 7. Monthly allowance system
`user_monthly_allowance` table operates independently from the main token system. It tracks free monthly tokens separately. No impact on this refactor, but be aware it exists.

### 8. Admin user-cleanup deletes token_transactions
The admin cleanup API (`user-cleanup/[userId]/route.ts`) can DELETE all token_transactions for a user. This would break the ledger if we ever move to transactions-as-source-of-truth.
**Future consideration:** Change cleanup to insert a "reset" transaction instead of deleting.

### 9. Double-logging in token_transactions (FIXED)
**Problem found:** `increment_user_tokens` RPC was logging to `token_transactions`, but edge functions (`grant-bonus-tokens`, `admin-approve-feedback`, `process-referral-signup`) ALSO insert their own `token_transactions` after calling the RPC → each operation would get TWO rows.
**Fix applied:** Removed transaction logging from `increment_user_tokens` RPC — it's now pure math. Edge functions are responsible for logging with richer context (feedback IDs, reasons, batch info). `approve_token_request` RPC keeps its own logging since no edge function wraps it.
**Also fixed:** `handle-token-request` was calling `increment_user_tokens` without its own logging → added `token_transactions` insert with type `monthly_allowance`.
