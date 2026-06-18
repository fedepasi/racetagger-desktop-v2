/**
 * Consent Service
 *
 * Manages user consent for training data usage.
 * Users can opt-out of having their images used to improve the AI model.
 * Default is opt-out (consent = true), meaning users need to actively disable.
 */

import { authService } from './auth-service';

export interface ConsentStatus {
  trainingConsent: boolean;
  consentUpdatedAt: string | null;
}

export interface PrivacyConsentStatus {
  acceptedPrivacyPolicyAt: string | null;
  privacyPolicyVersion: string | null;
  acceptedTermsOfServiceAt: string | null;
  termsOfServiceVersion: string | null;
}

class ConsentService {
  /**
   * Get the current training consent status for the authenticated user
   * Returns true (consent given) by default if not explicitly set.
   *
   * Uses user_id (UUID) instead of email to be robust against case differences,
   * "+alias" addresses, and email changes — and to align with the RLS policy
   * "Users can update own training consent" which is keyed on auth.uid() = user_id.
   */
  async getTrainingConsent(): Promise<boolean> {
    const userId = authService.getCurrentUserId();
    if (!userId) {
      return true; // Default to true for unauthenticated users
    }

    try {
      const supabase = authService.getSupabaseClient();

      const { data, error } = await supabase
        .from('subscribers')
        .select('training_consent')
        .eq('user_id', userId)
        .single();

      if (error) {
        return true; // Default to true on error
      }

      // If training_consent is null, default to true (opt-out model)
      const consent = data?.training_consent ?? true;
      return consent;
    } catch (error) {
      console.error('[ConsentService] Exception getting training consent:', error);
      return true; // Default to true on exception
    }
  }

  /**
   * Set the training consent status for the authenticated user.
   *
   * Important: Supabase returns `error: null` even when an UPDATE affects zero
   * rows (e.g. RLS blocks it, row missing, predicate doesn't match). Without
   * the row-count check below this method would silently return `true` while
   * the value in DB never changes — which is exactly the bug that made the
   * toggle "reactivate" itself in v1.1.6.
   *
   * We chain `.select('user_id')` so the returned `data` array contains the
   * affected rows, and we treat 0 affected rows as a failure so the UI can
   * surface the error and revert the toggle.
   */
  async setTrainingConsent(consent: boolean): Promise<boolean> {
    const userId = authService.getCurrentUserId();
    if (!userId) {
      return false;
    }

    try {
      const supabase = authService.getSupabaseClient();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('subscribers')
        .update({
          training_consent: consent,
          training_consent_updated_at: now
        })
        .eq('user_id', userId)
        .select('user_id');

      if (error) {
        console.error('[ConsentService] Error updating consent:', error);
        return false;
      }

      if (!data || data.length === 0) {
        // 0 rows updated → likely RLS block or missing row.
        // Do NOT report success — the caller will revert the toggle and notify the user.
        console.error('[ConsentService] Update affected 0 rows for user:', userId);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[ConsentService] Exception setting training consent:', error);
      return false;
    }
  }

  /**
   * Get full consent status including timestamp
   */
  async getConsentStatus(): Promise<ConsentStatus> {
    const userId = authService.getCurrentUserId();
    if (!userId) {
      return {
        trainingConsent: true,
        consentUpdatedAt: null
      };
    }

    try {
      const supabase = authService.getSupabaseClient();

      const { data, error } = await supabase
        .from('subscribers')
        .select('training_consent, training_consent_updated_at')
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return {
          trainingConsent: true,
          consentUpdatedAt: null
        };
      }

      return {
        trainingConsent: data.training_consent ?? true,
        consentUpdatedAt: data.training_consent_updated_at || null
      };
    } catch (error) {
      console.error('[ConsentService] Exception getting consent status:', error);
      return {
        trainingConsent: true,
        consentUpdatedAt: null
      };
    }
  }

  /**
   * Get the GDPR consent status (Privacy Policy + Terms of Service) for the
   * authenticated user. Used to decide whether to show the first-launch
   * privacy/terms notice. The DB is the source of truth, so the notice is not
   * re-shown after a logout (which clears localStorage) and stays consistent
   * across devices. Returns all-null when unauthenticated or on error → the
   * caller treats that as "not yet accepted" and falls back to a local flag.
   */
  async getPrivacyConsentStatus(): Promise<PrivacyConsentStatus> {
    const empty: PrivacyConsentStatus = {
      acceptedPrivacyPolicyAt: null,
      privacyPolicyVersion: null,
      acceptedTermsOfServiceAt: null,
      termsOfServiceVersion: null
    };

    const userId = authService.getCurrentUserId();
    if (!userId) {
      return empty;
    }

    try {
      const supabase = authService.getSupabaseClient();

      const { data, error } = await supabase
        .from('subscribers')
        .select('accepted_privacy_policy_at, privacy_policy_version, accepted_terms_of_service_at, terms_of_service_version')
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return empty;
      }

      return {
        acceptedPrivacyPolicyAt: data.accepted_privacy_policy_at ?? null,
        privacyPolicyVersion: data.privacy_policy_version ?? null,
        acceptedTermsOfServiceAt: data.accepted_terms_of_service_at ?? null,
        termsOfServiceVersion: data.terms_of_service_version ?? null
      };
    } catch (error) {
      console.error('[ConsentService] Exception getting privacy consent status:', error);
      return empty;
    }
  }

  /**
   * Record GDPR consent (Privacy Policy + Terms of Service) for the
   * authenticated user — called when the user accepts the first-launch notice.
   * Persists acceptance timestamps + versions to the DB (GDPR Art. 7 proof).
   *
   * Same 0-rows-as-failure guard as setTrainingConsent(): Supabase returns
   * `error: null` even when an UPDATE affects no rows (RLS block / missing row),
   * so we chain `.select('user_id')` and treat 0 affected rows as a failure.
   * The `authenticated` role needs column-level UPDATE on these columns (added
   * by migration 20260616120000) on top of the existing row-level RLS policy
   * "Users can update own training consent" (auth.uid() = user_id).
   */
  async setPrivacyConsent(privacyPolicyVersion: string, termsOfServiceVersion: string): Promise<boolean> {
    const userId = authService.getCurrentUserId();
    if (!userId) {
      return false;
    }

    try {
      const supabase = authService.getSupabaseClient();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('subscribers')
        .update({
          accepted_privacy_policy_at: now,
          privacy_policy_version: privacyPolicyVersion,
          accepted_terms_of_service_at: now,
          terms_of_service_version: termsOfServiceVersion
        })
        .eq('user_id', userId)
        .select('user_id');

      if (error) {
        console.error('[ConsentService] Error recording privacy consent:', error);
        return false;
      }

      if (!data || data.length === 0) {
        // 0 rows updated → likely RLS block, missing column GRANT, or missing row.
        console.error('[ConsentService] Privacy consent update affected 0 rows for user:', userId);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[ConsentService] Exception recording privacy consent:', error);
      return false;
    }
  }
}

// Export singleton instance
export const consentService = new ConsentService();
