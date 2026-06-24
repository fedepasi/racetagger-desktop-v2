/**
 * Satisfaction Survey + Referral IPC Handlers
 *
 * Thin bridge to the `satisfaction-survey` Edge Function (service role). All the
 * eligibility/gating/threshold logic lives server-side — the renderer only asks
 * "should I show a prompt?" and submits answers. This module touches NO token
 * logic: the positive branch merely advertises the existing referral reward.
 *
 * Handlers:
 * - survey:get-eligibility -> { prompt, scale_max, positive_cutoff, reward_display, referral_code, referral_slug, tokens_used }
 * - survey:submit          -> records a satisfaction answer (rating/comment)
 * - survey:ack-prompt      -> marks a one-time prompt as shown/dismissed/acked
 * - referral:get           -> referral code + stats for the sidebar page
 *
 * Online-required: if there is no network/auth, these fail clearly and the
 * renderer simply shows nothing (review + export are the only offline paths).
 */

import { app, ipcMain } from 'electron';
import { DEBUG_MODE } from '../config';
import { getSupabase } from './context';
import { authService } from '../auth-service';

interface SurveyResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Invoke the satisfaction-survey Edge Function with the user's JWT.
 * Mirrors the auth pattern used by feedback-handlers (submitFeedback).
 */
async function invokeSurvey(body: Record<string, unknown>): Promise<SurveyResult> {
  try {
    const authState = authService.getAuthState();
    if (!authState.isAuthenticated || !authState.session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('satisfaction-survey', {
      body,
      headers: { Authorization: `Bearer ${authState.session.access_token}` },
    });

    if (error) {
      let msg = error.message || 'Edge function error';
      try {
        if ((error as any).context && typeof (error as any).context.json === 'function') {
          const eb = await (error as any).context.json();
          if (eb && eb.error) msg = eb.error;
        }
      } catch (_parseErr) {
        // ignore — keep the generic message
      }
      return { success: false, error: msg };
    }

    if (!data || data.success === false) {
      return { success: false, error: data?.error || 'Unknown error from server' };
    }

    return { success: true, data };
  } catch (error: any) {
    console.error('[Survey] invoke error:', error);
    return { success: false, error: error?.message || 'Survey request failed' };
  }
}

export function registerSurveyHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering survey handlers...');

  // Ask the server which one-time prompt (if any) to show this user.
  ipcMain.handle('survey:get-eligibility', async (): Promise<SurveyResult> => {
    return invokeSurvey({ action: 'eligibility' });
  });

  // Record a satisfaction answer.
  ipcMain.handle(
    'survey:submit',
    async (_evt, payload: { rating: number; comment?: string; linked_feedback_id?: string }): Promise<SurveyResult> => {
      return invokeSurvey({
        action: 'submit',
        rating: payload?.rating,
        comment: payload?.comment ?? null,
        linked_feedback_id: payload?.linked_feedback_id ?? null,
        app_version: app.getVersion(),
      });
    }
  );

  // Mark a one-time prompt as shown/dismissed/acked so it isn't shown again.
  ipcMain.handle(
    'survey:ack-prompt',
    async (_evt, payload: { prompt_key: string; outcome?: string }): Promise<SurveyResult> => {
      return invokeSurvey({
        action: 'ack',
        prompt_key: payload?.prompt_key,
        outcome: payload?.outcome ?? 'acked',
      });
    }
  );

  // Referral code + stats for the "Earn free credits" rewards hub.
  ipcMain.handle('referral:get', async (): Promise<SurveyResult> => {
    return invokeSurvey({ action: 'referral' });
  });

  // Let the user edit their own referral code (handle). The server validates
  // format / reserved / uniqueness and keeps old links working.
  ipcMain.handle(
    'referral:set-handle',
    async (_evt, payload: { handle: string }): Promise<SurveyResult> => {
      return invokeSurvey({ action: 'set-handle', handle: payload?.handle ?? '' });
    }
  );

  if (DEBUG_MODE) console.log('[IPC] Survey handlers registered (5 handlers)');
}
