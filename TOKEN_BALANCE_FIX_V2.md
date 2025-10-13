# 🔧 Token Balance Fix V2 - Soluzione Corretta

## ⚠️ Problema Identificato

### Issue: Duplicazione Token Bonus

**Scenario reale:**
```javascript
// Acquisto con bonus:
user_tokens.tokens_purchased = 2500 + 1500 = 4000 (include bonus)
subscribers.bonus_tokens = 1500 (bonus separato)

// Se sincronizziamo base_tokens = 4000 e poi sommiamo bonus_tokens:
totalTokens = 4000 (base) + 1500 (bonus) = 5500 ❌ RADDOPPIATO!
```

**Causa:** `user_tokens.tokens_purchased` **include già il bonus**, mentre `subscribers.bonus_tokens` lo conta separatamente.

## ✅ Soluzione: Usa Solo `user_tokens` come Source of Truth

### Strategia

**user_tokens** diventa la fonte principale:
- `tokens_purchased` = token base + bonus (tutto insieme)
- `tokens_used` = consumo

**subscribers** tiene solo bonus "extra":
- `bonus_tokens` = bonus da altre fonti (es. feedback, admin)
- `earned_tokens` = token guadagnati (referral, etc)
- `admin_bonus_tokens` = assegnazioni manuali admin

## 📝 Implementazione

### File da Modificare

#### 1. `src/auth-service.ts` - Calcolo Token Balance

**PRIMA (riga 1003-1013):**
```typescript
const baseTokens = subscriberData?.base_tokens || 0;
const bonusTokens = subscriberData?.bonus_tokens || 0;
const earnedTokens = subscriberData?.earned_tokens || 0;
const adminBonusTokens = subscriberData?.admin_bonus_tokens || 0;

const approvedTokensFromRequests = tokenRequestsData?.reduce(...);

const totalTokens = baseTokens + bonusTokens + earnedTokens + adminBonusTokens + approvedTokensFromRequests;
```

**DOPO:**
```typescript
// user_tokens.tokens_purchased è la fonte primaria (include già bonus acquisto)
const purchasedTokens = userTokensData?.tokens_purchased || 0;

// subscribers ha solo bonus EXTRA (non da acquisti)
const earnedTokens = subscriberData?.earned_tokens || 0;
const adminBonusTokens = subscriberData?.admin_bonus_tokens || 0;

// token_requests approvati
const approvedTokensFromRequests = tokenRequestsData?.reduce(...);

// Total = acquisti + extra bonus + token requests approvati
const totalTokens = purchasedTokens + earnedTokens + adminBonusTokens + approvedTokensFromRequests;
```

**Logging aggiornato:**
```typescript
console.log('[AuthService] Calculated token balance:', {
  // Source of truth
  purchasedTokens,          // Da user_tokens.tokens_purchased (include bonus acquisto)

  // Extra bonus (NON da acquisti)
  earnedTokens,             // Referral rewards
  adminBonusTokens,         // Admin grants
  approvedTokensFromRequests, // Token requests approvati

  // Totale
  totalTokens,              // purchasedTokens + earnedTokens + adminBonusTokens + approvedTokensFromRequests
  used: userTokensUsed,
  remaining: totalTokens - userTokensUsed,

  // Debug info (deprecated fields)
  DEPRECATED_baseTokens: subscriberData?.base_tokens,
  DEPRECATED_bonusTokens: subscriberData?.bonus_tokens
});
```

### 📊 Esempi di Calcolo

#### Esempio 1: Acquisto con Early Bird Bonus
```javascript
// Acquisto: Professional Pack (2500 token) + 1500 bonus = 4000 token
user_tokens.tokens_purchased = 4000 ✅
subscribers.earned_tokens = 0
subscribers.admin_bonus_tokens = 0
token_requests (approved) = 500

// Calcolo:
totalTokens = 4000 + 0 + 0 + 500 = 4500 ✅ CORRETTO!
```

#### Esempio 2: Acquisto + Referral Reward
```javascript
// Acquisto: 4000 token (include bonus)
user_tokens.tokens_purchased = 4000
// Referral reward: 200 token
subscribers.earned_tokens = 200
subscribers.admin_bonus_tokens = 0
token_requests (approved) = 500

// Calcolo:
totalTokens = 4000 + 200 + 0 + 500 = 4700 ✅ CORRETTO!
```

#### Esempio 3: Acquisto + Admin Bonus
```javascript
// Acquisto: 4000 token
user_tokens.tokens_purchased = 4000
subscribers.earned_tokens = 0
// Admin ti ha dato 1000 token extra
subscribers.admin_bonus_tokens = 1000
token_requests (approved) = 500

// Calcolo:
totalTokens = 4000 + 0 + 1000 + 500 = 5500 ✅ CORRETTO!
```

## 🗑️ Pulizia Campi Deprecated

### `subscribers.base_tokens` e `subscribers.bonus_tokens`

**Questi campi diventano DEPRECATED** perché:
- ❌ `base_tokens` duplica `user_tokens.tokens_purchased`
- ❌ `bonus_tokens` crea confusione (bonus acquisto vs bonus extra)

**Opzioni:**

#### Opzione A: Mantieni per Backward Compatibility (Raccomandato)
```sql
-- Non cancellarli, ma smetti di usarli
COMMENT ON COLUMN subscribers.base_tokens IS 'DEPRECATED: Use user_tokens.tokens_purchased instead';
COMMENT ON COLUMN subscribers.bonus_tokens IS 'DEPRECATED: Bonus is included in tokens_purchased';
```

#### Opzione B: Rimuovi Completamente (Più Pulito)
```sql
-- Solo se sei sicuro che nessun altro sistema li usa
ALTER TABLE subscribers DROP COLUMN base_tokens;
ALTER TABLE subscribers DROP COLUMN bonus_tokens;
```

## 🔄 NON Serve Migration SQL

La vecchia migration `20250113000001_sync_tokens_to_subscribers.sql` **NON VA APPLICATA**.

Invece:

1. ✅ Modifica solo `auth-service.ts` (codice client)
2. ✅ Nessuna modifica al database
3. ✅ Nessun trigger da creare

## 🎯 Referral System - Separato e Corretto

Per i referral, usiamo `subscribers.earned_tokens`:

```sql
-- Quando un referral si completa:
UPDATE subscribers
SET earned_tokens = earned_tokens + 200
WHERE email = (SELECT email FROM auth.users WHERE id = referrer_id);
```

Questo è **separato** da `tokens_purchased`, quindi nessun problema di duplicazione.

## 📋 Checklist Implementazione

### Step 1: Backup Codice Attuale
```bash
cp src/auth-service.ts src/auth-service.ts.backup
```

### Step 2: Modifica `auth-service.ts`
Cambia il calcolo del balance come mostrato sopra (righe 1003-1031 circa)

### Step 3: Test Locale
```bash
npm run dev
```

Controlla i log:
```javascript
[AuthService] Calculated token balance: {
  purchasedTokens: 4000,        // ✅ Include bonus
  earnedTokens: 0,
  adminBonusTokens: 0,
  approvedTokensFromRequests: 500,
  totalTokens: 4500,            // ✅ Corretto!
  used: 478,
  remaining: 4022
}
```

### Step 4: Deploy
```bash
npm run compile
npm run build
```

## 🔍 Testing Scenarios

### Test 1: Acquisto con Early Bird Bonus
1. Fai un acquisto in staging
2. Verifica che `user_tokens.tokens_purchased` = base + bonus
3. Verifica che `totalTokens` sia corretto (senza duplicazione)

### Test 2: Referral Completion
1. Simula un referral completato
2. Verifica che `subscribers.earned_tokens` aumenti di 200
3. Verifica che il totale sia: purchased + earned + requests

### Test 3: Admin Bonus
1. Admin assegna bonus manuale
2. Verifica che vada in `subscribers.admin_bonus_tokens`
3. Verifica che il totale includa l'admin bonus

## 🐛 Troubleshooting

### Problema: Token ancora raddoppiati

**Check:**
```javascript
// Nel log dovresti vedere:
purchasedTokens: 4000 (NON 2500)
DEPRECATED_bonusTokens: 1500 (ignorato nel calcolo)
totalTokens: 4500 (4000 + 0 + 0 + 500)
```

Se vedi ancora duplicazione, verifica che la modifica a `auth-service.ts` sia corretta.

### Problema: Token mancanti

**Possibile causa:** `user_tokens.tokens_purchased` non include il bonus

**Check:**
```sql
SELECT
  u.email,
  ut.tokens_purchased,
  s.base_tokens,
  s.bonus_tokens
FROM user_tokens ut
INNER JOIN auth.users u ON u.id = ut.user_id
LEFT JOIN subscribers s ON s.email = u.email
WHERE u.email = 'tuo@email.com';
```

Se `tokens_purchased` non include il bonus, c'è un problema nel webhook Stripe.

## 📞 Webhook Stripe - Verifica

Il webhook **deve** già includere il bonus in `tokens_granted`:

```typescript
// racetagger-app/src/app/api/stripe/webhooks/route.ts
const tokens_granted = parseInt(session.metadata.tokens_granted); // Include bonus!

await supabaseAdmin.rpc('record_stripe_purchase', {
  p_tokens_granted: tokens_granted, // Questo va in user_tokens.tokens_purchased
  ...
});
```

Se il webhook passa `tokens_granted` correttamente, tutto funzionerà.

---

**Versione:** V2 - Soluzione Corretta
**Data:** 13 Gennaio 2025
**Status:** Ready for implementation ✅
