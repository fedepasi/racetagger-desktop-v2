# Token System Architecture

Complete documentation for RaceTagger's token management system across Desktop App, Web App, and Admin Portal.

## Table of Contents
1. [System Overview](#system-overview)
2. [Single Source of Truth](#single-source-of-truth)
3. [Token Calculation](#token-calculation)
4. [Database Schema](#database-schema)
5. [Token Flow](#token-flow)
6. [Implementation](#implementation)
7. [Status Management](#status-management)
8. [Troubleshooting](#troubleshooting)

---

## System Overview

The token system uses **three database tables** to manage different aspects of token allocation:

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `user_tokens` | **PRIMARY SOURCE** - Purchased/granted tokens and usage | `tokens_purchased`, `tokens_used` |
| `subscribers` | Earned bonuses and extra grants | `earned_tokens`, `admin_bonus_tokens` |
| `token_requests` | User requests for additional tokens | `tokens_requested`, `status` |

### Deprecated Fields (DO NOT USE)
- ❌ `subscribers.base_tokens` - Now included in `user_tokens.tokens_purchased`
- ❌ `subscribers.bonus_tokens` - Now included in `user_tokens.tokens_purchased`

---

## Single Source of Truth

**`user_tokens.tokens_purchased`** is the **single source of truth** for all purchased and granted tokens.

### What's included in `tokens_purchased`:
- ✅ Base tokens (default 1000)
- ✅ Bonus tokens (default 1500)
- ✅ Stripe purchases
- ✅ Access code grants
- ✅ Admin manual grants

### Why this approach?
- **Stripe webhook** updates `user_tokens.tokens_purchased`
- **Access code activation** updates `user_tokens.tokens_purchased`
- **Admin grants** update `user_tokens.tokens_purchased`
- **Single value** = no duplication, no confusion

---

## Token Calculation

### Unified Formula

```typescript
const available = tokens_purchased + earned_tokens + admin_bonus_tokens + approved_token_requests - tokens_used
```

### Components

| Field | Source | Description |
|-------|--------|-------------|
| `tokens_purchased` | `user_tokens.tokens_purchased` | **SINGLE SOURCE OF TRUTH** - All purchased/granted tokens |
| `earned_tokens` | `subscribers.earned_tokens` | Referral rewards (200 tokens per successful referral) |
| `admin_bonus_tokens` | `subscribers.admin_bonus_tokens` | Extra admin-granted bonuses |
| `approved_token_requests` | `token_requests` (status='approved' or 'completed') | Approved token requests |
| `tokens_used` | `user_tokens.tokens_used` | Tokens consumed by image analysis |

---

## Database Schema

### user_tokens
```sql
CREATE TABLE user_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  tokens_purchased INTEGER DEFAULT 0,  -- SINGLE SOURCE OF TRUTH
  tokens_used INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);
```

### subscribers
```sql
CREATE TABLE subscribers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  earned_tokens INTEGER DEFAULT 0,        -- Referral rewards
  admin_bonus_tokens INTEGER DEFAULT 0,   -- Extra admin grants
  base_tokens INTEGER DEFAULT 1000,       -- DEPRECATED
  bonus_tokens INTEGER DEFAULT 1500       -- DEPRECATED
);
```

### token_requests
```sql
CREATE TABLE token_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  tokens_requested INTEGER NOT NULL,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Token Flow

### 1. User Registration
```
User registers → subscribers created (base_tokens=1000, bonus_tokens=1500)
                → access_code generated (tokens_to_grant=0)
```

### 2. Access Code Activation
```
User activates code → user_tokens.tokens_purchased = 2500 (1000 + 1500)
                    → subscribers fields remain unchanged
```

### 3. Stripe Purchase
```
User buys 2000 tokens → Stripe webhook → user_tokens.tokens_purchased += 2000
                                       → Now total = 4500
```

### 4. Referral Reward
```
Referred user makes purchase → subscribers.earned_tokens += 200
                              → Separate from tokens_purchased
```

### 5. Admin Bonus Grant
```
Admin grants 500 tokens → subscribers.admin_bonus_tokens += 500
                        → Separate from tokens_purchased
```

### 6. Token Request (Desktop App)
```
User requests tokens → token_requests created (status='pending')
                    → Admin approves → status='approved'
                    → Desktop calculates available tokens including approved requests
```

---

## Implementation

### Desktop App (`src/auth-service.ts`)

```typescript
async getTokenBalance(): Promise<TokenBalance> {
  // SINGLE SOURCE OF TRUTH: user_tokens.tokens_purchased
  const userTokensPurchased = userTokensData?.tokens_purchased || 0;
  const userTokensUsed = userTokensData?.tokens_used || 0;

  // Additional separate sources:
  const earnedTokens = subscriberData?.earned_tokens || 0;        // Referral rewards
  const adminBonusTokens = subscriberData?.admin_bonus_tokens || 0; // Extra admin grants
  const approvedTokensFromRequests = tokenRequestsData?.reduce((sum, request) =>
    sum + (request.tokens_requested || 0), 0) || 0;

  // UNIFIED CALCULATION
  const totalTokens = userTokensPurchased + earnedTokens + adminBonusTokens + approvedTokensFromRequests;

  return {
    total: totalTokens,
    used: userTokensUsed,
    remaining: totalTokens - userTokensUsed
  };
}
```

### Web App Dashboard (`src/lib/gumroad/tokens.ts`)

```typescript
export async function getUserTokenBalance(supabase: any, userId: string) {
  const { data } = await supabase
    .from('user_tokens')
    .select('tokens_purchased, tokens_used, last_updated')
    .eq('user_id', userId)
    .single();

  return {
    purchased: data.tokens_purchased || 0,
    used: data.tokens_used || 0,
    available: (data.tokens_purchased || 0) - (data.tokens_used || 0),
    lastUpdated: data.last_updated
  };
}
```

### Admin Portal (`supabase/functions/get-registrants/index.ts`)

```typescript
// SINGLE SOURCE OF TRUTH: user_tokens.tokens_purchased
const tokens_purchased = userInfo?.tokens_purchased ?? 0;
const earned_tokens = sub.earned_tokens || 0;
const admin_bonus_tokens = sub.admin_bonus_tokens || 0;
const approvedTokenRequests = tokenRequestsMap.get(sub.user_id) || 0;

// UNIFIED CALCULATION
const total_available = tokens_purchased + earned_tokens + admin_bonus_tokens + approvedTokenRequests;
const tokens_used = userInfo?.tokens_used ?? 0;
const tokens_remaining = Math.max(total_available - tokens_used, 0);
```

---

## Status Management

### Token Request Status Values

The system uses unified status values across Desktop App and Management Portal:

| Status | Description | Used By |
|--------|-------------|---------|
| `pending` | Request awaiting admin approval | Both |
| `approved` | Request approved by admin | Both |
| `rejected` | Request rejected by admin | Both |
| `completed` | Legacy status (treated as approved) | Legacy |

### Status Unification (Legacy Migration)

**Old Desktop Status → New Unified Status**
- `'pending_payment'` → `'pending'`
- `'approved_free'` → `'approved'`
- `'completed'` → `'approved'` (deprecated)

### Desktop Token Request Flow

1. User requests tokens in desktop app
2. Edge function creates request with status:
   - `'pending'` if payment required (>500 tokens)
   - `'approved'` if auto-approved Early Access (≤500 tokens)
3. Request appears in management portal dashboard
4. Admin can approve/reject as needed
5. User receives tokens and notifications

---

## Troubleshooting

### User shows different token counts across systems?
1. ✅ Check if all systems use `user_tokens.tokens_purchased` as base
2. ✅ Verify no system is still using `subscribers.base_tokens + bonus_tokens`
3. ✅ Check database directly with verification queries

### Token count doesn't match after Stripe purchase?
1. ✅ Check Stripe webhook executed successfully
2. ✅ Verify `user_tokens.tokens_purchased` was updated
3. ✅ Check if system is using deprecated `subscribers.base_tokens`

### Desktop token requests not appearing in management portal?
1. ✅ Verify request status is 'pending' or 'approved'
2. ✅ Check edge function is using unified status values
3. ✅ Confirm management portal queries include all status variants

### Verification Queries

```sql
-- Check user_tokens
SELECT tokens_purchased, tokens_used
FROM user_tokens
WHERE user_id = '<user_id>';

-- Check subscribers
SELECT earned_tokens, admin_bonus_tokens
FROM subscribers
WHERE user_id = '<user_id>';

-- Check approved token requests
SELECT SUM(tokens_requested)
FROM token_requests
WHERE user_id = '<user_id>'
AND status IN ('approved', 'completed');

-- Expected available tokens:
-- = tokens_purchased + earned_tokens + admin_bonus_tokens + approved_requests - tokens_used
```

---

## Common Mistakes to Avoid

❌ **WRONG**: Using `subscribers.base_tokens + subscribers.bonus_tokens`
```typescript
const total = baseTokens + bonusTokens + ...  // ❌ DUPLICATES TOKENS!
```

✅ **CORRECT**: Using `user_tokens.tokens_purchased`
```typescript
const total = userTokensPurchased + earnedTokens + adminBonusTokens + ...  // ✅
```

---

## Related Files

- Desktop App: [src/auth-service.ts](../../src/auth-service.ts)
- Desktop Edge Function: [supabase/functions/handle-token-request/](../../supabase/functions/handle-token-request/)
- Web App: `racetagger-app/src/lib/gumroad/tokens.ts`
- Admin Portal: `racetagger-app/supabase/functions/get-registrants/index.ts`
- Stripe Webhook: `racetagger-app/supabase/migrations/20251012000002_add_stripe_integration.sql`

---

**Last Updated**: 2025-01-17
**Status**: ✅ Unified across all systems
