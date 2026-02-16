/**
 * User Preferences Service
 *
 * Centralized service for managing user settings and preferences.
 * Aggregates data from AuthService, ConsentService, and local preferences.
 *
 * This service provides a single entry point for the Settings screen
 * and is designed to be easily extensible for future preferences.
 */

import { authService } from './auth-service';
import { consentService } from './consent-service';

/**
 * User account information
 */
export interface UserAccountInfo {
  email: string;
  userId: string;
  userRole: 'admin' | 'user';
}

/**
 * Token balance information
 */
export interface TokenInfo {
  total: number;
  used: number;
  remaining: number;
  pending: number;
}

/**
 * Subscription status
 */
export interface SubscriptionInfo {
  plan: string | null;
  isActive: boolean;
  expiresAt: string | null;
}

/**
 * Privacy settings
 */
export interface PrivacySettings {
  trainingConsent: boolean;
  consentUpdatedAt: string | null;
  errorTelemetryEnabled: boolean;
}

/**
 * Complete user settings object
 */
export interface UserSettings {
  account: UserAccountInfo;
  tokens: TokenInfo;
  subscription: SubscriptionInfo;
  privacy: PrivacySettings;
}

/**
 * User Preferences Service
 *
 * Singleton service that aggregates user data from multiple sources
 * for the Settings screen.
 */
class UserPreferencesService {
  private static instance: UserPreferencesService | null = null;

  private constructor() {
    console.log('[UserPreferencesService] Service initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): UserPreferencesService {
    if (!UserPreferencesService.instance) {
      UserPreferencesService.instance = new UserPreferencesService();
    }
    return UserPreferencesService.instance;
  }

  /**
   * Get complete user settings for the Settings screen
   * Aggregates data from AuthService, ConsentService, and local preferences
   */
  public async getFullSettings(): Promise<UserSettings> {
    try {
      // Fetch all data in parallel for performance
      const [authState, tokenInfo, subscription, consentStatus] = await Promise.all([
        Promise.resolve(authService.getAuthState()),
        this.safeGetTokenInfo(),
        this.safeGetSubscriptionInfo(),
        this.safeGetConsentStatus()
      ]);

      // Determine if user has active access (either via subscription or tokens)
      const hasTokens = (tokenInfo.balance?.remaining || 0) > 0;
      const hasActiveSubscription = subscription.isActive || false;
      const isEffectivelyActive = hasActiveSubscription || hasTokens;

      // Determine plan name
      let planName: string | null = null;
      if (hasActiveSubscription && subscription.plan?.name) {
        planName = subscription.plan.name;
      } else if (hasTokens) {
        planName = 'Token Pack'; // User has tokens but no subscription
      }

      return {
        account: {
          email: authState.user?.email || '',
          userId: authState.user?.id || '',
          userRole: (authState.userRole as 'admin' | 'user') || 'user'
        },
        tokens: {
          total: tokenInfo.balance?.total || 0,
          used: tokenInfo.balance?.used || 0,
          remaining: tokenInfo.balance?.remaining || 0,
          pending: tokenInfo.pending || 0
        },
        subscription: {
          plan: planName,
          isActive: isEffectivelyActive,
          expiresAt: subscription.expiresAt || null
        },
        privacy: {
          trainingConsent: consentStatus.trainingConsent ?? true,
          consentUpdatedAt: consentStatus.consentUpdatedAt || null,
          errorTelemetryEnabled: true  // Default enabled, user can opt-out in settings
        }
      };
    } catch (error) {
      console.error('[UserPreferencesService] Error fetching settings:', error);
      // Return safe defaults on error
      return this.getDefaultSettings();
    }
  }

  /**
   * Get token info with error handling
   */
  private async safeGetTokenInfo(): Promise<{ balance: { total: number; used: number; remaining: number }; pending: number }> {
    try {
      return await authService.getTokenInfo();
    } catch (error) {
      console.warn('[UserPreferencesService] Error fetching token info:', error);
      return { balance: { total: 0, used: 0, remaining: 0 }, pending: 0 };
    }
  }

  /**
   * Get subscription info with error handling
   */
  private async safeGetSubscriptionInfo(): Promise<{ plan: { name: string } | null; isActive: boolean; expiresAt: string | null }> {
    try {
      return await authService.getSubscriptionInfo();
    } catch (error) {
      console.warn('[UserPreferencesService] Error fetching subscription info:', error);
      return { plan: null, isActive: false, expiresAt: null };
    }
  }

  /**
   * Get consent status with error handling
   */
  private async safeGetConsentStatus(): Promise<{ trainingConsent: boolean; consentUpdatedAt: string | null }> {
    try {
      return await consentService.getConsentStatus();
    } catch (error) {
      console.warn('[UserPreferencesService] Error fetching consent status:', error);
      return { trainingConsent: true, consentUpdatedAt: null }; // Default to opt-in
    }
  }

  /**
   * Get default settings (used as fallback on error)
   */
  private getDefaultSettings(): UserSettings {
    return {
      account: {
        email: '',
        userId: '',
        userRole: 'user'
      },
      tokens: {
        total: 0,
        used: 0,
        remaining: 0,
        pending: 0
      },
      subscription: {
        plan: null,
        isActive: false,
        expiresAt: null
      },
      privacy: {
        trainingConsent: true, // Default to opt-in
        consentUpdatedAt: null,
        errorTelemetryEnabled: true  // Default enabled
      }
    };
  }
}

// Export singleton instance
export const userPreferencesService = UserPreferencesService.getInstance();

// Export getter function for consistency with other services
export const getUserPreferencesService = (): UserPreferencesService => UserPreferencesService.getInstance();
