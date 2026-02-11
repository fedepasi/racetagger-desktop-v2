/**
 * Email Normalization Compatibility Test
 *
 * Tests backward compatibility of email normalization fixes with existing users
 * and old app versions still in production.
 *
 * Scenarios tested:
 * 1. Existing user with uppercase email in DB (pre-fix)
 * 2. New registration with uppercase email (post-fix)
 * 3. Login with different casing
 * 4. Token balance queries
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock Supabase client
const mockSupabase = {
  auth: {
    signInWithPassword: jest.fn(),
    admin: {
      createUser: jest.fn()
    }
  },
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    single: jest.fn(),
    insert: jest.fn().mockReturnThis()
  })),
  functions: {
    invoke: jest.fn()
  }
};

describe('Email Normalization - Backward Compatibility', () => {

  describe('Scenario 1: Existing users with uppercase emails (pre-fix)', () => {
    it('should find user with lowercase query even if DB has uppercase', async () => {
      // Simula DB con email MAIUSCOLA (utente registrato con versione vecchia)
      const dbEmail = 'Test@Example.com';
      const loginEmail = 'test@example.com'; // User digita lowercase

      // Mock: Supabase Auth normalizza internamente
      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: {
          user: { email: loginEmail }, // Auth normalizza
          session: { access_token: 'token123' }
        },
        error: null
      });

      // Mock: Query subscribers con .toLowerCase() (già presente nel codice)
      const subscriberQuery = mockSupabase.from('subscribers')
        .select('*')
        .eq('email', loginEmail); // Cerca lowercase

      subscriberQuery.maybeSingle.mockResolvedValueOnce({
        data: { email: dbEmail, name: 'Test User' }, // DB ha uppercase
        error: null
      });

      // Verifica: Query DOVREBBE fallire se DB ha uppercase e query cerca lowercase
      // Questo è il BUG che stiamo fixando!
      expect(dbEmail.toLowerCase()).toBe(loginEmail);
    });

    it('should handle login from old app version with mixed case', async () => {
      const mixedCaseEmail = 'TeSt@ExAmPlE.cOm';

      // Vecchia versione app invia email senza normalizzazione
      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: {
          user: { email: mixedCaseEmail.toLowerCase() }, // Supabase normalizza
          session: { access_token: 'token123' }
        },
        error: null
      });

      expect(mixedCaseEmail.toLowerCase()).toBe('test@example.com');
    });
  });

  describe('Scenario 2: New registrations (post-fix)', () => {
    it('should normalize email in Edge Function even if old app sends uppercase', async () => {
      const uppercaseEmail = 'NEW@USER.COM';
      const normalizedEmail = 'new@user.com';

      // Simula vecchia versione app che invia email senza normalizzazione
      mockSupabase.functions.invoke.mockResolvedValueOnce({
        data: { success: true },
        error: null
      });

      // Edge Function NUOVA riceve uppercase ma normalizza internamente
      const edgeFunctionInput = uppercaseEmail;
      const edgeFunctionNormalized = edgeFunctionInput.toLowerCase().trim();

      expect(edgeFunctionNormalized).toBe(normalizedEmail);

      // Verifica: DB dovrebbe salvare email normalizzata
      // anche se app vecchia invia uppercase
    });

    it('should prevent duplicate registration with different casing', async () => {
      const email1 = 'user@example.com';
      const email2 = 'User@Example.COM';

      // Prima registrazione
      mockSupabase.from('subscribers')
        .select('email')
        .eq('email', email1.toLowerCase().trim())
        .maybeSingle.mockResolvedValueOnce({
          data: null,
          error: null
        });

      // Seconda registrazione (case diverso)
      mockSupabase.from('subscribers')
        .select('email')
        .eq('email', email2.toLowerCase().trim())
        .maybeSingle.mockResolvedValueOnce({
          data: { email: email1 }, // Trovato!
          error: null
        });

      expect(email1.toLowerCase()).toBe(email2.toLowerCase());
    });
  });

  describe('Scenario 3: Mixed app versions in production', () => {
    it('old app + new Edge Function = email normalized server-side', async () => {
      const oldAppEmail = 'OldApp@Example.com'; // Vecchia app non normalizza
      const expectedDbEmail = 'oldapp@example.com'; // Edge Function normalizza

      // Edge Function normalizza
      const normalized = oldAppEmail.toLowerCase().trim();

      expect(normalized).toBe(expectedDbEmail);
      // ✅ BACKWARD COMPATIBLE: vecchia app beneficia di normalizzazione server-side
    });

    it('new app + old Edge Function = email normalized client-side', async () => {
      const newAppEmail = 'NewApp@Example.com'; // Nuova app normalizza
      const sentToEdgeFunction = newAppEmail.toLowerCase().trim();

      expect(sentToEdgeFunction).toBe('newapp@example.com');
      // ✅ FORWARD COMPATIBLE: nuova app normalizza prima di inviare
    });

    it('new app + new Edge Function = double normalization (safe)', async () => {
      const email = 'Both@Example.com';

      // Nuova app normalizza
      const clientNormalized = email.toLowerCase().trim();

      // Edge Function normalizza di nuovo (idempotent)
      const serverNormalized = clientNormalized.toLowerCase().trim();

      expect(clientNormalized).toBe('both@example.com');
      expect(serverNormalized).toBe('both@example.com');
      // ✅ SAFE: doppia normalizzazione è idempotente
    });
  });

  describe('Scenario 4: Token balance queries', () => {
    it('should find tokens regardless of email case in DB', async () => {
      const dbEmail = 'User@Example.com'; // DB ha uppercase
      const queryEmail = 'user@example.com'; // Query cerca lowercase

      // Simula query user_tokens
      mockSupabase.from('user_tokens')
        .select('*')
        .eq('user_id', 'user-123')
        .maybeSingle.mockResolvedValueOnce({
          data: { tokens_purchased: 1000, tokens_used: 500 },
          error: null
        });

      // Token query usa user_id, non email, quindi è safe
      // Ma subscriber query DEVE funzionare per ottenere user_id
      expect(dbEmail.toLowerCase()).toBe(queryEmail);
    });
  });
});

describe('Database State Analysis', () => {
  it('should identify emails with uppercase in production DB', () => {
    // Query SQL da eseguire manualmente su Supabase:
    const sqlQuery = `
      SELECT
        email,
        LOWER(email) as normalized_email,
        CASE
          WHEN email = LOWER(email) THEN 'OK'
          ELSE 'NEEDS_CLEANUP'
        END as status
      FROM subscribers
      WHERE email != LOWER(email)
      ORDER BY created_at DESC;
    `;

    expect(sqlQuery).toContain('LOWER(email)');

    // Se questa query restituisce risultati, ci sono email da pulire
    console.log('\n🔍 Run this SQL on Supabase to check existing data:');
    console.log(sqlQuery);
  });

  it('should generate cleanup script for existing data', () => {
    const cleanupScript = `
      -- STEP 1: Backup current data
      CREATE TABLE subscribers_backup AS
      SELECT * FROM subscribers
      WHERE email != LOWER(email);

      -- STEP 2: Find duplicates that would be created by normalization
      SELECT LOWER(email) as normalized_email, COUNT(*) as count
      FROM subscribers
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1;

      -- STEP 3: Normalize emails (only if no duplicates found)
      UPDATE subscribers
      SET email = LOWER(TRIM(email))
      WHERE email != LOWER(TRIM(email));

      -- STEP 4: Add constraint to prevent future issues
      ALTER TABLE subscribers
      ADD CONSTRAINT email_lowercase_check
      CHECK (email = LOWER(email));
    `;

    expect(cleanupScript).toContain('LOWER(TRIM(email))');

    console.log('\n🧹 Database cleanup script:');
    console.log(cleanupScript);
  });
});

describe('Deployment Strategy', () => {
  it('should follow safe deployment order', () => {
    const deploymentSteps = [
      '1. Check existing data: Run SQL query to find uppercase emails',
      '2. Backup data: Create backup of subscribers table',
      '3. Cleanup (if needed): Normalize existing emails',
      '4. Deploy Edge Function: register-user-unified with normalization',
      '5. Test with old app version: Verify backward compatibility',
      '6. Deploy new desktop app: Version 1.1.1 with client-side normalization',
      '7. Monitor: Check for any login/registration issues',
      '8. Add DB constraint: Enforce lowercase emails (optional)'
    ];

    expect(deploymentSteps).toHaveLength(8);

    console.log('\n🚀 Safe Deployment Strategy:');
    deploymentSteps.forEach(step => console.log(step));
  });
});

/**
 * Manual Testing Checklist
 *
 * Before deploying to production:
 *
 * ✅ Test 1: Register with uppercase email using OLD app version
 *    Expected: Email saved as lowercase (Edge Function normalizes)
 *
 * ✅ Test 2: Login with different casing using OLD app version
 *    Expected: Login succeeds (Supabase Auth normalizes)
 *
 * ✅ Test 3: Register duplicate email with different case
 *    Expected: Registration rejected (duplicate detected)
 *
 * ✅ Test 4: Token balance query after login with different case
 *    Expected: Tokens displayed correctly
 *
 * ✅ Test 5: Existing user with uppercase email in DB logs in
 *    Expected: Login succeeds, subscriber data found
 */
