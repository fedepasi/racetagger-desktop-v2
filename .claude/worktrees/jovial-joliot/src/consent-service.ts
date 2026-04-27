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

class ConsentService {
  /**
   * Get the current training consent status for the authenticated user
   * Returns true (consent given) by default if not explicitly set
   */
  async getTrainingConsent(): Promise<boolean> {
    const userId = authService.getCurrentUserId();
    if (!userId) {
      return true; // Default to true for unauthenticated users
    }

    try {
      const supabase = authService.getSupabaseClient();
      const authState = authService.getAuthState();
      const userEmail = authState.user?.email?.toLowerCase();

      if (!userEmail) {
        return true;
      }

      const { data, error } = await supabase
        .from('subscribers')
        .select('training_consent')
        .eq('email', userEmail)
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
   * Set the training consent status for the authenticated user
   */
  async setTrainingConsent(consent: boolean): Promise<boolean> {
    const userId = authService.getCurrentUserId();
    if (!userId) {
      return false;
    }

    try {
      const supabase = authService.getSupabaseClient();
      const authState = authService.getAuthState();
      const userEmail = authState.user?.email?.toLowerCase();

      if (!userEmail) {
        return false;
      }

      const now = new Date().toISOString();

      const { error } = await supabase
        .from('subscribers')
        .update({
          training_consent: consent,
          training_consent_updated_at: now
        })
        .eq('email', userEmail);

      if (error) {
        console.error('[ConsentService] Error updating consent:', error);
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
      const authState = authService.getAuthState();
      const userEmail = authState.user?.email?.toLowerCase();

      if (!userEmail) {
        return {
          trainingConsent: true,
          consentUpdatedAt: null
        };
      }

      const { data, error } = await supabase
        .from('subscribers')
        .select('training_consent, training_consent_updated_at')
        .eq('email', userEmail)
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
}

// Export singleton instance
export const consentService = new ConsentService();
