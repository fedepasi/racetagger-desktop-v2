# Token Calculation - Single Source of Truth

## 📊 Overview

This document describes the **unified token calculation** system used across all RaceTagger platforms (Web App, Desktop App, and Admin Portal).

## 🎯 Single Source of Truth

**`user_tokens.tokens_purchased`** is the **single source of truth** for all purchased and granted tokens.

### What's included in `user_tokens.tokens_purchased`:
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

## 🧮 Unified Calculation Formula

```typescript
const available = tokens_purchased + earned_tokens + admin_bonus_tokens + approved_token_requests - tokens_used
```

### Components:

| Field | Source | Description |
|-------|--------|-------------|
| `tokens_purchased` | `user_tokens.tokens_purchased` | **SINGLE SOURCE OF TRUTH** - All purchased/granted tokens |
| `earned_tokens` | `subscribers.earned_tokens` | Referral rewards (200 tokens per successful referral) |
| `admin_bonus_tokens` | `subscribers.admin_bonus_tokens` | Extra admin-granted bonuses |
| `approved_token_requests` | `token_requests` (status='approved' or 'completed') | Approved token requests |
| `tokens_used` | `user_tokens.tokens_used` | Tokens consumed by image analysis |

---

## ⚠️ Deprecated Fields

**DO NOT USE** these fields for token calculation:

| Field | Status | Why Deprecated |
|-------|--------|----------------|
| `subscribers.base_tokens` | ⚠️ DEPRECATED | Included in `user_tokens.tokens_purchased` |
| `subscribers.bonus_tokens` | ⚠️ DEPRECATED | Included in `user_tokens.tokens_purchased` |

---

## 💻 Implementation

### 1. Desktop App (`src/auth-service.ts`)

```typescript
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
```

### 2. Web App Dashboard (`src/lib/gumroad/tokens.ts`)

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

### 3. Admin Portal (`supabase/functions/get-registrants/index.ts`)

```typescript
// SINGLE SOURCE OF TRUTH: user_tokens.tokens_purchased
const tokens_purchased = userInfo?.tokens_purchased ?? 0;
const earned_tokens = sub.earned_tokens || 0;
const admin_bonus_tokens = sub.admin_bonus_tokens || 0;
const feedback_approved_tokens = feedbackTokens.approved;
const approvedTokenRequests = tokenRequestsMap.get(sub.user_id) || 0;

// UNIFIED CALCULATION
const total_available = tokens_purchased + earned_tokens + admin_bonus_tokens + feedback_approved_tokens + approvedTokenRequests;
const tokens_used = userInfo?.tokens_used ?? 0;
const tokens_remaining = Math.max(total_available - tokens_used, 0);
```

---

## 🔄 Token Flow

### 1. User Registration
```
User registers → subscribers created (base_tokens=1000, bonus_tokens=1500)
                → access_code generated (tokens_to_grant=0)
```

### 2. Access Code Activation
```
User activates code → user_tokens.tokens_purchased = 2500 (1000 + 1500)
                    → subscribers.base_tokens and bonus_tokens remain unchanged
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

---

## ✅ Verification

To verify correct token calculation for a user:

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

## 📝 Example: User fede.pasi+3@gmail.com

### Database State:
```
user_tokens.tokens_purchased = 3500  (1500 bonus + 2000 Stripe purchase)
user_tokens.tokens_used = 0
subscribers.earned_tokens = 0
subscribers.admin_bonus_tokens = 0
token_requests (approved) = 0
```

### Calculation:
```
available = 3500 + 0 + 0 + 0 - 0 = 3500 ✅
```

### Result Across All Systems:
- ✅ Web App Dashboard: 3500 tokens
- ✅ Admin Portal (Manage-Access): 3500 tokens
- ✅ Desktop App: 3500 tokens

---

## 🚨 Common Mistakes to Avoid

❌ **WRONG**: Using `subscribers.base_tokens + subscribers.bonus_tokens`
```typescript
const total = baseTokens + bonusTokens + ...  // ❌ DUPLICATES TOKENS!
```

✅ **CORRECT**: Using `user_tokens.tokens_purchased`
```typescript
const total = userTokensPurchased + earnedTokens + adminBonusTokens + ...  // ✅
```

---

## 🔧 Troubleshooting

### User shows different token counts across systems?
1. Check if all systems use `user_tokens.tokens_purchased` as base
2. Verify no system is still using `subscribers.base_tokens + bonus_tokens`
3. Check database directly with SQL queries above

### Token count doesn't match after Stripe purchase?
1. Check Stripe webhook executed successfully
2. Verify `user_tokens.tokens_purchased` was updated
3. Check if system is using deprecated `subscribers.base_tokens`

---

## 📚 Related Files

- Desktop App: `racetagger-clean/src/auth-service.ts`
- Web App: `racetagger-app/src/lib/gumroad/tokens.ts`
- Admin Portal: `racetagger-app/supabase/functions/get-registrants/index.ts`
- Stripe Webhook: `racetagger-app/supabase/migrations/20251012000002_add_stripe_integration.sql`

---

**Last Updated**: 2025-01-13
**Status**: ✅ Unified across all systems
