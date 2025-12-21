/**
 * Version Checker Service
 * Handles app version checking against server requirements
 */

import { app } from 'electron';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from '../../config';
import { authService } from '../../auth-service';

export interface VersionCheckResult {
  requires_update: boolean;
  force_update_enabled: boolean;
  update_message?: string;
  download_url?: string;
  urgency?: string;
  current_version?: string;
  minimum_version?: string;
  error?: string;
}

// Global state for force update requirement
let forceUpdateRequired = false;

/**
 * Check if force update is required
 */
export function isForceUpdateRequired(): boolean {
  return forceUpdateRequired;
}

/**
 * Set force update required state
 */
export function setForceUpdateRequired(value: boolean): void {
  forceUpdateRequired = value;
}

/**
 * Get current platform identifier for version check
 */
function getPlatformIdentifier(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

/**
 * Check app version against server requirements
 */
export async function checkAppVersion(): Promise<VersionCheckResult | null> {
  try {
    const currentVersion = app.getVersion();
    const platform = getPlatformIdentifier();

    console.log(`Checking version: ${currentVersion} on ${platform}`);

    // Get user ID from auth service if available
    const authState = authService.getAuthState();
    const userId = authState.user?.id;

    const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

    const { data, error } = await supabase.functions.invoke('check-app-version', {
      body: {
        app_version: currentVersion,
        platform: platform,
        user_id: userId
      }
    });

    if (error) {
      console.error('Version check error:', error);
      return {
        requires_update: false,
        force_update_enabled: false,
        error: error.message
      };
    }

    const result: VersionCheckResult = data;
    console.log('Version check result:', result);

    // Store force update status globally
    forceUpdateRequired = result.force_update_enabled && result.requires_update;

    return result;
  } catch (error) {
    console.error('Version check exception:', error);
    return {
      requires_update: false,
      force_update_enabled: false,
      error: String(error)
    };
  }
}
