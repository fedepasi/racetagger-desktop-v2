/**
 * Token IPC Handlers
 * Handles token requests, balance, and pending tokens operations
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from '../../config';
import { authService } from '../../auth-service';

// Supabase client for Edge Function calls
const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

/**
 * Handle token request submission
 */
async function handleTokenRequest(event: IpcMainInvokeEvent, requestData: any) {
  console.log('[Main Process] handleTokenRequest called with:', requestData);

  try {
    // Get current user information
    const authState = authService.getAuthState();
    if (!authState.isAuthenticated || !authState.user) {
      throw new Error('User must be authenticated to request tokens');
    }

    const tokensRequested = parseInt(requestData.tokensRequested);
    console.log(`[Main Process] Processing token request: ${tokensRequested} tokens`);

    // Call secure Edge Function instead of direct DB access
    console.log('[Main Process] Calling handle-token-request Edge Function...');

    // Get current session token for Authorization header
    const session = authService.getSession();
    if (!session || !session.access_token) {
      throw new Error('No valid session token available');
    }

    const { data: response, error } = await supabase.functions.invoke('handle-token-request', {
      headers: {
        Authorization: `Bearer ${session.access_token}`
      },
      body: {
        tokensRequested: tokensRequested,
        message: requestData.message || null
      }
    });

    if (error) {
      console.error('[Main Process] Edge Function error:', error);
      throw new Error(`Failed to process token request: ${error.message}`);
    }

    if (!response) {
      throw new Error('Edge Function returned empty response');
    }

    // If success is false, it's a business logic error (e.g., limit reached)
    if (!response.success) {
      console.log('[Main Process] Edge Function returned business logic error:', response);
      console.log('[Main Process] Email notification will be sent by Edge Function');

      return {
        success: false,
        message: response.error || response.message || 'Request could not be processed',
        requestSaved: response.requestSaved || false,
        paymentRequired: response.paymentRequired || false,
        monthlyUsage: response.monthlyUsage || null
      };
    }

    console.log('[Main Process] Token request processed successfully via Edge Function');
    console.log('[Main Process] Email notification will be sent by Edge Function');

    return {
      success: true,
      message: response.message,
      requestId: response.requestId,
      isEarlyAccessFree: response.isEarlyAccessFree,
      tokensGranted: response.tokensGranted || 0,
      paymentRequired: response.paymentRequired || false
    };

  } catch (error: any) {
    console.error('[Main Process] Error handling token request:', error);
    return {
      success: false,
      message: error.message || 'An unexpected error occurred. Please try again.'
    };
  }
}

/**
 * Handle token balance request
 */
async function handleGetTokenBalance(event: IpcMainInvokeEvent): Promise<number> {
  console.log('[Main Process] handleGetTokenBalance called');

  try {
    const tokenBalance = await authService.getTokenBalance();
    console.log(`[Main Process] Current token balance: ${tokenBalance}`);
    return typeof tokenBalance === 'number' ? tokenBalance : tokenBalance.remaining;
  } catch (error: any) {
    console.error('[Main Process] Error getting token balance:', error);
    return 0;
  }
}

/**
 * Handle pending tokens request
 */
async function handleGetPendingTokens(event: IpcMainInvokeEvent): Promise<number> {
  console.log('[Main Process] handleGetPendingTokens called');

  try {
    const pendingTokens = await authService.getPendingTokens();
    console.log(`[Main Process] Pending tokens: ${pendingTokens}`);
    return pendingTokens;
  } catch (error: any) {
    console.error('[Main Process] Error getting pending tokens:', error);
    return 0;
  }
}

/**
 * Handle complete token info request (balance + pending)
 */
async function handleGetTokenInfo(event: IpcMainInvokeEvent): Promise<{ balance: any; pending: number }> {
  console.log('[Main Process] handleGetTokenInfo called');

  try {
    const tokenInfo = await authService.getTokenInfo();
    console.log('[Main Process] Token info:', tokenInfo);
    return tokenInfo;
  } catch (error: any) {
    console.error('[Main Process] Error getting token info:', error);
    return {
      balance: { total: 0, used: 0, remaining: 0 },
      pending: 0
    };
  }
}

/**
 * Setup token-related IPC handlers
 */
export function setupTokenHandlers(): void {
  console.log('[Main Process] Setting up token IPC handlers...');

  ipcMain.handle('submit-token-request', handleTokenRequest);
  ipcMain.handle('get-token-balance', handleGetTokenBalance);
  ipcMain.handle('get-pending-tokens', handleGetPendingTokens);
  ipcMain.handle('get-token-info', handleGetTokenInfo);
}
