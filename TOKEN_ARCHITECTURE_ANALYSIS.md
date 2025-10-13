# 🔍 Analisi Completa Architettura Token

## 📊 Stato Attuale del Sistema

### 3 Tabelle che Gestiscono i Token

#### 1. `subscribers` (Web App)
```sql
base_tokens: 1000 (default)
bonus_tokens: 1500 (default)
earned_tokens: 0
admin_bonus_tokens: 0
```

#### 2. `user_tokens` (Desktop App)
```sql
tokens_purchased: ??? (da definire)
tokens_used: X
```

#### 3. `access_codes`
```sql
tokens_to_grant: 0 o 1500 (dipende da chi genera il codice)
```

---

## 🔄 Flussi Attuali

### Flusso A: Iscrizione Web → Desktop (Access Code)

```
1. Utente si iscrive su racetagger-app
   ↓
   INSERT INTO subscribers (base_tokens = 1000, bonus_tokens = 1500)

2. Admin genera access code
   ↓
   INSERT INTO access_codes (tokens_to_grant = 0 o 1500)

3. Utente riceve email e scarica desktop app
   ↓

4. Utente inserisce access code in desktop app
   ↓
   verify-and-activate-code:
   - Legge access_codes.tokens_to_grant
   - INSERT INTO user_tokens (tokens_purchased = tokens_to_grant)

5. Desktop app calcola balance:
   ↓
   getTokenBalance() legge da:
   - subscribers.base_tokens (1000)
   - subscribers.bonus_tokens (1500)
   - user_tokens.tokens_purchased (0 o 1500)
```

### Flusso B: Acquisto Stripe

```
1. Utente acquista pack su racetagger-app
   ↓
   Stripe webhook → record_stripe_purchase()
   ↓
   UPDATE user_tokens SET tokens_purchased += tokens_granted

2. Desktop app calcola balance:
   ↓
   getTokenBalance() legge da:
   - subscribers.base_tokens (NON aggiornato!)
   - subscribers.bonus_tokens
   - user_tokens.tokens_purchased (aggiornato!)
```

---

## ⚠️ PROBLEMA PRINCIPALE: Duplicazione/Confusione

### Il Tuo Caso Specifico

**Situazione:**
```javascript
user_tokens.tokens_purchased = 2500
subscribers.base_tokens = 0
subscribers.bonus_tokens = 0
```

**Possibili spiegazioni:**

#### Opzione 1: Access Code con 2500 token
```
- Admin ha generato un access code con tokens_to_grant = 2500
- verify-and-activate-code ha messo 2500 in user_tokens.tokens_purchased
- subscribers.base_tokens/bonus_tokens sono rimasti a 0 (mai popolati)
```

#### Opzione 2: Due Acquisti/Grant Separati
```
- Prima allocazione: 1000 token → user_tokens.tokens_purchased = 1000
- Seconda allocazione: 1500 token → user_tokens.tokens_purchased = 2500
```

---

## 🎯 SOLUZIONE DEFINITIVA

### Architettura Proposta

**`user_tokens` diventa la FONTE UNICA per i token acquistati/assegnati**

```sql
user_tokens:
  tokens_purchased: Tutti i token base (acquisti + access code + manual grants)
  tokens_used: Consumo

subscribers:
  earned_tokens: Solo token guadagnati (referral rewards)
  admin_bonus_tokens: Solo bonus extra assegnati dall'admin DOPO l'acquisto

  ❌ DEPRECATI:
  base_tokens: Non più usato (duplica tokens_purchased)
  bonus_tokens: Non più usato (già incluso in tokens_purchased)
```

### Calcolo Token Balance (NUOVO)

```typescript
// auth-service.ts
async getTokenBalance(): Promise<TokenBalance> {
  // 1. Source of truth: user_tokens
  const purchasedTokens = user_tokens.tokens_purchased || 0;
  const usedTokens = user_tokens.tokens_used || 0;

  // 2. Extra bonus (separati dagli acquisti)
  const earnedTokens = subscribers.earned_tokens || 0;       // Referral rewards
  const adminBonusTokens = subscribers.admin_bonus_tokens || 0; // Admin grants EXTRA

  // 3. Token requests approvati
  const approvedRequests = token_requests.sum(tokens_requested) || 0;

  // 4. TOTALE
  const totalTokens = purchasedTokens + earnedTokens + adminBonusTokens + approvedRequests;

  return {
    total: totalTokens,
    used: usedTokens,
    remaining: totalTokens - usedTokens
  };
}
```

---

## 🔧 Come Si Risolve la Duplicazione

### Scenario: Utente con Access Code

**Prima (SBAGLIATO):**
```
subscribers.base_tokens = 1000
subscribers.bonus_tokens = 1500
user_tokens.tokens_purchased = 1500 (solo il "regalo")

Desktop calcola:
total = 1000 + 1500 + 1500 = 4000 ❌ RADDOPPIATO!
```

**Dopo (CORRETTO):**
```
user_tokens.tokens_purchased = 2500 (tutto insieme: base + bonus + regalo)
subscribers.earned_tokens = 0
subscribers.admin_bonus_tokens = 0

Desktop calcola:
total = 2500 + 0 + 0 = 2500 ✅ CORRETTO!
```

### Scenario: Utente con Acquisto Stripe + Early Bird

**Prima (SBAGLIATO):**
```
user_tokens.tokens_purchased = 4000 (2500 base + 1500 bonus)
subscribers.base_tokens = 0 (non sincronizzato)
subscribers.bonus_tokens = 1500 (duplicato!)

Desktop calcola:
total = 0 + 1500 + 4000 = 5500 ❌ RADDOPPIATO!
```

**Dopo (CORRETTO):**
```
user_tokens.tokens_purchased = 4000 (include tutto)
subscribers.earned_tokens = 0
subscribers.admin_bonus_tokens = 0

Desktop calcola:
total = 4000 + 0 + 0 = 4000 ✅ CORRETTO!
```

---

## 📝 Action Items

### 1. Modifica `auth-service.ts` ✅
```typescript
// Usa solo user_tokens.tokens_purchased
// Ignora subscribers.base_tokens e subscribers.bonus_tokens
```

### 2. Modifica Webhook Stripe (se necessario)
```typescript
// Verifica che tokens_granted includa già il bonus
// record_stripe_purchase deve mettere TUTTO in tokens_purchased
```

### 3. Modifica `verify-and-activate-code` (se necessario)
```typescript
// Quando l'utente attiva un access code:
// tokens_purchased = base_tokens + bonus_tokens + tokens_to_grant (dal codice)
```

### 4. Referral Rewards
```typescript
// Quando un referral si completa:
// UPDATE subscribers SET earned_tokens += 200
// ✅ Questo è separato e non crea duplicazione
```

### 5. Admin Bonus
```typescript
// Quando admin assegna bonus EXTRA:
// UPDATE subscribers SET admin_bonus_tokens += N
// ✅ Questo è per bonus aggiuntivi DOPO l'acquisto
```

---

## 🧪 Test per Verificare

### Test 1: Nuovo Utente con Access Code
```sql
-- Setup
INSERT INTO user_tokens (tokens_purchased = 2500, tokens_used = 0);
INSERT INTO subscribers (earned_tokens = 0, admin_bonus_tokens = 0);

-- Verifica
SELECT 2500 + 0 + 0 = 2500 ✅
```

### Test 2: Acquisto Stripe con Early Bird
```sql
-- Setup
UPDATE user_tokens SET tokens_purchased = 4000; -- include bonus
-- subscribers rimane 0

-- Verifica
SELECT 4000 + 0 + 0 = 4000 ✅
```

### Test 3: Acquisto + Referral Reward
```sql
-- Setup
UPDATE user_tokens SET tokens_purchased = 4000;
UPDATE subscribers SET earned_tokens = 200; -- referral reward

-- Verifica
SELECT 4000 + 200 + 0 = 4200 ✅
```

---

## ❓ Domanda da Chiarire

**Perché nel tuo caso `user_tokens.tokens_purchased = 2500`?**

Possibili risposte:
1. ✅ Access code generato con `tokens_to_grant = 2500` (base 1000 + bonus 1500)
2. ✅ Due allocazioni separate (1000 + 1500)
3. ❌ Sync sbagliato che ha sommato base + bonus

**Per verificare:**
```sql
SELECT * FROM token_transactions
WHERE user_id = 'TUO-USER-ID'
ORDER BY created_at DESC;

-- Questo mostrerà tutti i movimenti token
```

---

**Conclusione:**
- ✅ NON servono migration SQL
- ✅ NON servono trigger
- ✅ Basta modificare `auth-service.ts` per usare solo `user_tokens.tokens_purchased`
- ✅ `subscribers.base_tokens` e `bonus_tokens` diventano DEPRECATED

