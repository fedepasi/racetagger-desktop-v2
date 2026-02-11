import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { BrowserWindow, shell, app } from 'electron';
import { SUPABASE_CONFIG } from './config';
import * as fs from 'fs';
import * as path from 'path';

// Tipi per lo stato dell'autenticazione e gestione token
export interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  session: any | null;
  userRole: 'admin' | 'user' | null;
  forceUpdateRequired?: boolean;
  versionCheckResult?: any;
}

export interface TokenBalance {
  total: number;
  used: number;
  remaining: number;
}

// Tipi per sistema pre-autorizzazione batch (v1.1.0+)
export interface PreAuthResult {
  authorized: boolean;
  reservationId?: string;
  expiresAt?: string;
  ttlMinutes?: number;
  error?: string;
  available?: number;
  needed?: number;
}

export interface BatchTokenUsage {
  processed: number;
  errors: number;
  cancelled: number;
  // FASE 2 - tracciati ma non usati per rimborso
  sceneSkipped?: number;
  noVehicleDetected?: number;
  emptyResults?: number;
  // Statistiche
  visualTaggingUsed?: boolean;
  totalDurationMs?: number;
}

export interface FinalizeResult {
  success: boolean;
  consumed: number;
  refunded: number;
  newBalance: number;
  error?: string;
}

export interface SubscriptionInfo {
  plan: {
    id: string;
    name: string;
    monthly_price: number;
    annual_price: number;
    tokens_included: number;
  } | null;
  isActive: boolean;
  expiresAt: string | null;
}

// Classe per gestire l'autenticazione e token
export class AuthService {
  private supabase: SupabaseClient;
  private authState: AuthState = {
    isAuthenticated: false,
    user: null,
    session: null,
    userRole: null
  };
  private demoMode: boolean = false;
  private demoUsageCount: number = 0;
  private readonly MAX_DEMO_USAGE: number = 3;
  private tokenRefreshInterval?: NodeJS.Timeout;
  private isWritingSession = false;
  private window?: BrowserWindow; // Add window property

  private SESSION_FILE_PATH: string; // Removed readonly

  // Metodo per ottenere il client Supabase
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  // Metodo per impostare la finestra principale
  setMainWindow(window: BrowserWindow): void {
    this.window = window;
  }

  // Metodo per ottenere la sessione corrente
  getSession(): any | null {
    return this.authState.session;
  }

  constructor() {
    this.supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

    // SESSION_FILE_PATH and session restoration depend on app.getPath('userData'),
    // which must only be called after app is ready.
    // Initialize to a placeholder or handle its absence until app is ready.
    this.SESSION_FILE_PATH = ''; // Placeholder

    const initializePathAndSession = () => {
      try {
        this.SESSION_FILE_PATH = path.join(app.getPath('userData'), 'session.json');
        this.restoreSession().catch(err => {
          console.error("Error during deferred restoreSession call:", err);
        });

        // Imposta un timer per verificare periodicamente la validità del token
        this.setupTokenRefreshTimer();
      } catch (e) {
        console.error("CRITICAL ERROR: AuthService failed to initialize SESSION_FILE_PATH after app ready.", e);
      }
    };

    // Safely check if app is available and ready
    try {
      if (app && app.isReady()) {
        initializePathAndSession();
      } else if (app) {
        app.once('ready', initializePathAndSession);
      }
    } catch (error) {
      // If app is not available yet, schedule initialization for later
    }
  }

  // Imposta un timer per verificare periodicamente la validità del token
  private setupTokenRefreshTimer(): void {
    // Clear any existing interval to prevent memory leaks
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
    }

    // Verifica ogni 15 minuti
    const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minuti in millisecondi

    this.tokenRefreshInterval = setInterval(() => {
      if (this.authState.isAuthenticated && this.authState.session) {
        this.checkAndRefreshToken(this.authState.session);
      }
    }, REFRESH_INTERVAL);
  }

  // Ripristina la sessione se presente in storage locale
  private async restoreSession(): Promise<void> {
    if (!this.SESSION_FILE_PATH) {
      return;
    }

    try {
      // Prima verifica se esiste un file di sessione locale
      const savedSession = this.loadSessionFromFile();

      if (savedSession) {
        try {
          // Prima prova a rinnovare la sessione con il refresh token
          const { data: refreshData, error: refreshError } = await this.supabase.auth.refreshSession({
            refresh_token: savedSession.refresh_token
          });

          if (refreshError) {
            // Se non è possibile rinnovare la sessione, prova a impostarla direttamente
            const { data, error } = await this.supabase.auth.setSession({
              access_token: savedSession.access_token,
              refresh_token: savedSession.refresh_token
            });

            if (error) {
              // Verifica se l'errore è dovuto a problemi di rete
              if (error.message && (
                  error.message.includes('network') ||
                  error.message.includes('connection') ||
                  error.message.includes('offline')
                )) {
                // In caso di problemi di rete, tenta di utilizzare la sessione salvata
                // anche se non possiamo verificarla con Supabase
                try {
                  // Estrai le informazioni utente dal token JWT
                  const tokenParts = savedSession.access_token.split('.');
                  if (tokenParts.length === 3) {
                    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf-8'));

                    if (payload && payload.sub) {
                      this.authState = {
                        isAuthenticated: true,
                        user: {
                          id: payload.sub,
                          email: payload.email || 'Utente offline',
                          // Aggiungi altri campi utente dal payload se disponibili
                          ...payload.user_metadata
                        },
                        session: {
                          access_token: savedSession.access_token,
                          refresh_token: savedSession.refresh_token,
                          expires_at: payload.exp ? payload.exp * 1000 : undefined
                        },
                        userRole: null
                      };
                      return;
                    }
                  }
                } catch (jwtError) {
                  console.error('Error parsing JWT token:', jwtError);
                }
              }

              // Se non è possibile utilizzare la sessione salvata, rimuovila
              this.clearSavedSession();
              return;
            }

            if (data && data.session) {
              this.authState = {
                isAuthenticated: true,
                user: data.user,
                session: data.session,
                userRole: null
              };

              // Determina e aggiorna il ruolo utente
              this.updateUserRole();

              // Salva la sessione aggiornata
              await this.saveSessionToFile(data.session);
              return;
            } else {
              this.clearSavedSession();
              return;
            }
          }

          // Se il refresh è riuscito, utilizza la nuova sessione
          if (refreshData && refreshData.session) {
            this.authState = {
              isAuthenticated: true,
              user: refreshData.user,
              session: refreshData.session,
              userRole: null
            };

            // Salva la sessione aggiornata
            await this.saveSessionToFile(refreshData.session);

            // Emit event to signal auth completed (for data reloading)
            if (this.window) {
              this.window.webContents.send('auth-refresh-completed');
            }

            // Determine and update user role after refresh
            this.updateUserRole();
            return;
          } else {
            this.clearSavedSession();
            return;
          }
        } catch (sessionError) {
          console.error('Exception during session restoration:', sessionError);

          // Tenta di utilizzare la sessione salvata in modalità offline
          try {
            const tokenParts = savedSession.access_token.split('.');
            if (tokenParts.length === 3) {
              const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf-8'));

              if (payload && payload.sub) {
                this.authState = {
                  isAuthenticated: true,
                  user: {
                    id: payload.sub,
                    email: payload.email || 'Utente offline',
                    ...payload.user_metadata
                  },
                  session: {
                    access_token: savedSession.access_token,
                    refresh_token: savedSession.refresh_token,
                    expires_at: payload.exp ? payload.exp * 1000 : undefined
                  },
                  userRole: null
                };
                return;
              }
            }
          } catch (jwtError) {
            console.error('Error parsing JWT token in error handler:', jwtError);
          }

          this.clearSavedSession();
        }
      }

      // Se non è stato possibile ripristinare la sessione dal file locale,
      // prova a recuperare la sessione da Supabase
      try {
        const { data: { session }, error } = await this.supabase.auth.getSession();

        if (error) {
          console.error('Error getting session from Supabase:', error);
          return;
        }

        if (session) {
          this.authState = {
            isAuthenticated: true,
            user: session.user,
            session: session,
            userRole: null
          };

          // Salva la sessione nel file locale
          await this.saveSessionToFile(session);
          return;
        }
      } catch (networkError) {
        // Network error - session restoration will be retried later
      }
    } catch (error) {
      console.error('Failed to restore session:', error);
    }
  }

  // Verifica se il token è vicino alla scadenza e lo rinnova se necessario
  private async checkAndRefreshToken(session: Session): Promise<void> {
    try {
      if (!session.expires_at) return;

      // Convert expires_at to milliseconds if it's in seconds (typical for JWT tokens)
      const expiresAtMs = typeof session.expires_at === 'number' && session.expires_at < 20000000000
        ? session.expires_at * 1000  // Convert seconds to milliseconds
        : session.expires_at;        // Already in ms

      const expiresAt = new Date(expiresAtMs);
      const now = new Date();

      // Calcola il tempo rimanente in minuti
      const minutesRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / (60 * 1000));

      // Se mancano meno di 60 minuti alla scadenza, rinnova il token
      if (minutesRemaining < 60) {
        const { data, error } = await this.supabase.auth.refreshSession();

        if (error) {
          console.error('Error refreshing token:', error);
          return;
        }

        if (data.session) {
          this.authState.session = data.session;

          // Salva la nuova sessione nel file locale
          await this.saveSessionToFile(data.session);
        }
      }
    } catch (error) {
      console.error('Error checking/refreshing token:', error);
    }
  }

  // Salva la sessione in un file locale
  private async saveSessionToFile(session: Session): Promise<void> {
    // Prevent concurrent writes to avoid file corruption
    if (this.isWritingSession) {
      return;
    }

    this.isWritingSession = true;

    try {
      // Crea un oggetto con i dati della sessione e informazioni utente
      const sessionData = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        // Salva anche l'ID utente e l'email per debug
        user_id: this.authState.user?.id,
        user_email: this.authState.user?.email,
        // Timestamp di quando è stata salvata la sessione
        saved_at: new Date().toISOString()
      };

      // Assicurati che la directory esista
      const sessionDir = path.dirname(this.SESSION_FILE_PATH);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      // Use atomic write to prevent corruption
      const tempPath = this.SESSION_FILE_PATH + '.tmp';

      // Write to temporary file first
      fs.writeFileSync(
        tempPath,
        JSON.stringify(sessionData, null, 2), // Formatta il JSON per leggibilità
        { encoding: 'utf8' }
      );

      // Atomically move temp file to final location
      fs.renameSync(tempPath, this.SESSION_FILE_PATH);
    } catch (error) {
      console.error('Error saving session to file:', error);
      // Clean up temporary file if it exists
      const tempPath = this.SESSION_FILE_PATH + '.tmp';
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupError) {
          console.error('Error cleaning up temp session file:', cleanupError);
        }
      }
    } finally {
      this.isWritingSession = false;
    }
  }

  // Carica la sessione dal file locale
  private loadSessionFromFile(): { access_token: string; refresh_token: string } | null {
    try {
      // Verifica se il file esiste
      if (!fs.existsSync(this.SESSION_FILE_PATH)) {
        return null;
      }

      // Leggi e analizza il file JSON
      const fileContent = fs.readFileSync(this.SESSION_FILE_PATH, { encoding: 'utf8' });
      if (!fileContent || fileContent.trim() === '') {
        return null; // Non rimuoviamo il file, potrebbe essere un problema temporaneo
      }

      let sessionData;
      try {
        sessionData = JSON.parse(fileContent);
      } catch (parseError) {
        console.error('Error parsing session file JSON:', parseError);
        return null; // Non rimuoviamo il file, potrebbe essere un problema temporaneo
      }

      // Verifica che il file contenga i token necessari
      if (!sessionData.access_token || !sessionData.refresh_token) {
        return null; // Non rimuoviamo il file, potrebbe essere un problema temporaneo
      }

      return {
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token
      };
    } catch (error) {
      console.error('Error loading session from file:', error);
      return null;
    }
  }

  // Elimina il file di sessione salvato
  private clearSavedSession(): void {
    try {
      if (fs.existsSync(this.SESSION_FILE_PATH)) {
        fs.unlinkSync(this.SESSION_FILE_PATH);
      }
    } catch (error) {
      console.error('Error removing session file:', error);
    }
  }

  // Ottieni lo stato attuale dell'autenticazione
  getAuthState(): AuthState {
    // Assicurati che il ruolo sia sempre determinato se l'utente è autenticato
    if (this.authState.isAuthenticated && this.authState.user && !this.authState.userRole) {
      this.updateUserRole();
    }
    return this.authState;
  }

  // Aggiorna la sessione con una nuova sessione
  async updateSession(session: Session): Promise<void> {
    if (!session) {
      return;
    }

    this.authState.session = session;

    // Salva la sessione aggiornata nel file locale
    await this.saveSessionToFile(session);
  }

  // Check app version before any authenticated operation
  async checkVersionBeforeAuth(): Promise<boolean> {
    try {
      const currentVersion = require('electron').app?.getVersion() || '1.0.0';
      const platform = process.platform === 'darwin' ? 'macos' :
                      process.platform === 'win32' ? 'windows' : 'linux';

      const { data, error } = await this.supabase.functions.invoke('check-app-version', {
        body: {
          app_version: currentVersion,
          platform: platform,
          user_id: this.authState.user?.id
        }
      });

      if (error) {
        return true; // Allow auth to continue if version check fails
      }

      const result = data;
      this.authState.versionCheckResult = result;
      this.authState.forceUpdateRequired = result?.force_update_enabled && result?.requires_update;

      // Return false if force update is required (block auth)
      return !(result?.force_update_enabled && result?.requires_update);
    } catch (error) {
      console.error('Version check exception during auth:', error);
      return true; // Allow auth to continue on error
    }
  }

  // Gestisci il login
  async login(email: string, password: string): Promise<{ success: boolean; user?: any; session?: any; error?: string; forceUpdate?: boolean }> {
    try {
      // Check version before allowing login
      const versionOk = await this.checkVersionBeforeAuth();
      if (!versionOk) {
        return {
          success: false,
          forceUpdate: true,
          error: 'Aggiornamento richiesto. Aggiorna l\'app per continuare.'
        };
      }

      // Normalize email to ensure consistent authentication (lowercase + trim)
      const normalizedEmail = email.toLowerCase().trim();

      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });

      if (error) {
        console.error('Login error:', error);
        return { success: false, error: error.message };
      }

      if (data.session) {
        this.authState = {
          isAuthenticated: true,
          user: data.user,
          session: data.session,
          userRole: null
        };

        // Determina e aggiorna il ruolo utente
        this.updateUserRole();

        // Salva la sessione in un file locale per il ripristino automatico
        await this.saveSessionToFile(data.session);

        // Reimposta la modalità demo quando un utente effettua login
        this.demoMode = false;
        this.demoUsageCount = 0;

        // Ripristina i dati dell'utente da Supabase
        await this.restoreUserDataOnLogin();

        return {
          success: true,
          user: data.user,
          session: data.session
        };
      }

      return { success: false, error: 'No session returned' };
    } catch (error: any) {
      console.error('Login exception:', error);
      return { success: false, error: error.message || 'An unexpected error occurred' };
    }
  }

  // Gestisci la registrazione usando edge function unificata
  async register(email: string, password: string, name?: string): Promise<{ success: boolean; error?: string; tokensGranted?: number }> {
    try {
      // Validate password strength
      if (password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters long' };
      }
      if (!/[A-Z]/.test(password)) {
        return { success: false, error: 'Password must contain at least one uppercase letter' };
      }
      if (!/[a-z]/.test(password)) {
        return { success: false, error: 'Password must contain at least one lowercase letter' };
      }
      if (!/[0-9]/.test(password)) {
        return { success: false, error: 'Password must contain at least one number' };
      }

      // Normalize email to ensure consistent registration (lowercase + trim)
      const normalizedEmail = email.toLowerCase().trim();

      // Use unified registration edge function
      const { data, error } = await this.supabase.functions.invoke('register-user-unified', {
        body: {
          email: normalizedEmail,
          password,
          name: name || normalizedEmail.split('@')[0], // Extract name from email if not provided
          source: 'desktop'
        }
      });

      if (error) {
        console.error('Registration error:', error);
        // When edge function returns non-2xx status, the error message is generic
        // but the actual error details are in the response body (error.context)
        if (data && data.error) {
          return { success: false, error: data.error };
        }
        // Try to extract error from the response context
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errorBody = await error.context.json();
            if (errorBody && errorBody.error) {
              return { success: false, error: errorBody.error };
            }
          } catch (parseError) {
            // Failed to parse error response
          }
        }
        return { success: false, error: error.message };
      }

      if (!data.success) {
        return { success: false, error: data.error || 'Registration failed' };
      }

      return {
        success: true,
        tokensGranted: data.tokensGranted
      };
    } catch (error: any) {
      console.error('Registration exception:', error);
      return { success: false, error: error.message || 'An unexpected error occurred' };
    }
  }

  // Cleanup method to prevent memory leaks
  cleanup(): void {
    // Clear token refresh interval
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = undefined;
    }

    // Reset authentication state
    this.authState = {
      isAuthenticated: false,
      user: null,
      session: null,
      userRole: null
    };

    // Reset demo mode
    this.demoMode = false;
    this.demoUsageCount = 0;
  }

  // Gestisci il logout
  async logout(): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase.auth.signOut();

      if (error) {
        console.error('Logout error:', error);
        return { success: false, error: error.message };
      }

      // Clear all resources and state
      this.cleanup();

      // Rimuovi il file di sessione salvato
      this.clearSavedSession();

      return { success: true };
    } catch (error: any) {
      console.error('Logout exception:', error);
      return { success: false, error: error.message || 'An unexpected error occurred' };
    }
  }

  // Abilita modalità demo
  enableDemoMode(): void {
    this.demoMode = true;
    this.demoUsageCount = 0;
  }

  // Registra utilizzo in modalità demo
  trackDemoUsage(): boolean {
    if (!this.demoMode) return true;

    this.demoUsageCount++;

    return this.demoUsageCount <= this.MAX_DEMO_USAGE;
  }

  // Controlla se l'utente può utilizzare un token
  async canUseToken(count: number = 1): Promise<boolean> {
    if (!this.authState.isAuthenticated) {
      // In modalità demo, controlla il limite di utilizzo
      return this.trackDemoUsage();
    }

    // Se autenticato, verifica il bilancio token
    const balance = await this.getTokenBalance();
    return balance.remaining >= count;
  }

  // Registra l'utilizzo di un token
  async useTokens(count: number = 1, imageId?: string, onTokenUsed?: (balance: TokenBalance) => void): Promise<boolean> {
    if (!this.authState.isAuthenticated) {
      // In modalità demo, solo tracciamento
      return this.trackDemoUsage();
    }

    try {
      const userId = this.authState.user.id;

      // Prima verifica il saldo corrente
      const currentBalance = await this.getTokenBalance();
      if (currentBalance.remaining < count) {
        return false;
      }

      // Aggiorna user_tokens.tokens_used
      const newTokensUsed = currentBalance.used + count;

      // Prima verifichiamo se il record esiste
      const { data: existingRecord, error: selectError } = await this.supabase
        .from('user_tokens')
        .select('*')
        .eq('user_id', userId)
        .single();

      let updateData, updateError;

      if (selectError && selectError.code === 'PGRST116') {
        // Record non esiste, dobbiamo inserirlo
        const insertResult = await this.supabase
          .from('user_tokens')
          .insert({
            user_id: userId,
            tokens_purchased: 0,
            tokens_used: newTokensUsed,
            last_updated: new Date().toISOString()
          })
          .select();
        updateData = insertResult.data;
        updateError = insertResult.error;
      } else if (existingRecord) {
        // Record esiste, lo aggiorniamo - usa RPC consume_user_tokens
        // FIX: increment_user_tokens was updating tokens_purchased instead of tokens_used!
        const rpcResult = await this.supabase.rpc('consume_user_tokens', {
          p_user_id: userId,
          p_amount: count
        });

        if (rpcResult.error) {
          // Fallback to direct UPDATE if RPC fails
          console.warn('consume_user_tokens RPC failed, falling back to direct UPDATE:', rpcResult.error);
          const updateResult = await this.supabase
            .from('user_tokens')
            .update({
              tokens_used: newTokensUsed,
              last_updated: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select();
          updateData = updateResult.data;
          updateError = updateResult.error;
        } else {
          // RPC succeeded - use the returned data
          const rpcData = rpcResult.data;
          updateData = [{
            user_id: userId,
            tokens_used: rpcData?.tokens_used || newTokensUsed,
            last_updated: new Date().toISOString()
          }];
          updateError = null;
        }
      } else {
        return false;
      }

      if (updateError) {
        console.error('Error upserting user_tokens:', updateError);
        return false;
      }

      // Verifica che l'operazione sia andata a buon fine
      if (!updateData || updateData.length === 0) {
        return false;
      }

      const updatedRecord = updateData[0];

      // Verifica che tokens_used sia stato effettivamente aggiornato
      if (updatedRecord.tokens_used !== newTokensUsed) {
        return false;
      }

      // Notifica il chiamante del nuovo saldo PRIMA di inserire la transazione
      if (onTokenUsed) {
        const updatedBalance = await this.getTokenBalance();
        onTokenUsed(updatedBalance);
      }

      // Inserisci in token_transactions (non bloccare se fallisce)
      const { error: transactionError } = await this.supabase
        .from('token_transactions')
        .insert({
          user_id: userId,
          amount: -count, // Negativo perché è un consumo
          transaction_type: 'usage',
          image_id: imageId,
          description: `Used ${count} token(s) for image analysis`,
          created_at: new Date().toISOString()
        });

      if (transactionError) {
        // Non bloccare l'operazione se fallisce solo il log della transazione
      }

      return true;
    } catch (error) {
      console.error('Error using tokens:', error);
      return false;
    }
  }

  // Ottieni il bilancio token dell'utente con debug logging
  // NOTA: Version check rimosso - ora solo in main.ts (avvio) e login
  async getTokenBalance(): Promise<TokenBalance> {
    // Default balance per utenti non autenticati o errori
    const defaultBalance: TokenBalance = {
      total: this.demoMode ? this.MAX_DEMO_USAGE : 0,
      used: this.demoMode ? this.demoUsageCount : 0,
      remaining: this.demoMode ? (this.MAX_DEMO_USAGE - this.demoUsageCount) : 0
    };

    if (!this.authState.isAuthenticated) {
      return defaultBalance;
    }

    try {
      const { data: userTokensData, error: userTokensError } = await this.supabase
        .from('user_tokens')
        .select('tokens_purchased, tokens_used')
        .eq('user_id', this.authState.user.id)
        .single();

      // Query subscribers table for bonus tokens
      const { data: subscriberData, error: subscriberError } = await this.supabase
        .from('subscribers')
        .select('base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens')
        .eq('email', this.authState.user.email?.toLowerCase())
        .single();

      // Query token_requests for approved tokens
      const { data: tokenRequestsData, error: tokenRequestsError } = await this.supabase
        .from('token_requests')
        .select('tokens_requested, status')
        .eq('user_id', this.authState.user.id)
        .in('status', ['approved', 'completed']);

      // Calculate total tokens from all sources
      // SINGLE SOURCE OF TRUTH: user_tokens.tokens_purchased contains ALL purchased/granted tokens
      // (includes base, bonus, Stripe purchases, access code grants)
      const userTokensPurchased = userTokensData?.tokens_purchased || 0;
      const userTokensUsed = userTokensData?.tokens_used || 0;

      // NOTE: subscribers.base_tokens and subscribers.bonus_tokens are DEPRECATED
      // All purchased/granted tokens are now in user_tokens.tokens_purchased

      // Additional separate sources:
      const earnedTokens = subscriberData?.earned_tokens || 0;        // Referral rewards
      const adminBonusTokens = subscriberData?.admin_bonus_tokens || 0; // Extra admin grants

      // Sum up approved tokens from token_requests
      const approvedTokensFromRequests = tokenRequestsData?.reduce((sum, request) =>
        sum + (request.tokens_requested || 0), 0) || 0;

      // FIXED: Use userTokensPurchased as base, not baseTokens + bonusTokens
      const totalTokens = userTokensPurchased + earnedTokens + adminBonusTokens + approvedTokensFromRequests;

      const tokenBalance = {
        total: totalTokens,
        used: userTokensUsed,
        remaining: totalTokens - userTokensUsed
      };

      return tokenBalance;
    } catch (error) {
      console.error('Exception fetching token balance:', error);
      return defaultBalance;
    }
  }

  // Forza il refresh del bilancio token (per debug e sync manuale)
  async forceTokenRefresh(): Promise<TokenBalance> {
    // Get fresh token balance
    const balance = await this.getTokenBalance();

    return balance;
  }

  // Ottieni l'ID dell'utente corrente
  getCurrentUserId(): string | null {
    return this.authState.user?.id || null;
  }

  // Controlla se l'utente è online
  isOnline(): boolean {
    return navigator.onLine;
  }

  // Controlla se l'utente è autenticato
  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  // Ripristina i dati dell'utente dopo il login
  private async restoreUserDataOnLogin(): Promise<void> {
    try {
      // Import dei servizi database (dynamic import per evitare circular dependencies)
      const {
        getProjectsOnline,
        loadLastUsedCsvFromSupabase,
        getSportCategories
      } = await import('./database-service');

      // 1. Scarica e ripopola la cache dei Projects
      await getProjectsOnline();

      // 2. Carica le sport categories
      await getSportCategories();

      // 3. Ripristina l'ultimo CSV usato dall'utente
      const csvData = await loadLastUsedCsvFromSupabase();

      if (csvData && csvData.length > 0) {
        // Invia il CSV ripristinato al processo principale per aggiornare le variabili globali
        // Utilizziamo la stessa logica del caricamento CSV
        const { ipcRenderer } = require('electron');
        if (ipcRenderer) {
          ipcRenderer.send('restore-csv-data', {
            csvData,
            filename: 'restored_from_supabase.csv'
          });
        }
      }
    } catch (error) {
      console.error('Error during user data restoration:', error);
      // Non bloccare il login se il ripristino fallisce
    }
  }

  // Forza il refresh completo delle informazioni token (balance + pending)
  async forceTokenInfoRefresh(): Promise<{ balance: TokenBalance; pending: number }> {
    const tokenInfo = await this.getTokenInfo();

    return tokenInfo;
  }

  // Ottieni i token pending (richiesti ma non ancora approvati)
  async getPendingTokens(): Promise<number> {
    if (!this.authState.isAuthenticated) {
      return 0;
    }

    try {
      const { data, error } = await this.supabase
        .from('token_requests')
        .select('tokens_requested')
        .eq('user_id', this.authState.user.id)
        .eq('status', 'pending');

      if (error || !data) {
        console.error('Error fetching pending tokens:', error);
        return 0;
      }

      const totalPending = data.reduce((sum, request) => sum + (request.tokens_requested || 0), 0);

      return totalPending;
    } catch (error) {
      console.error('Exception fetching pending tokens:', error);
      return 0;
    }
  }

  // Ottieni informazioni complete sui token (available + pending)
  async getTokenInfo(): Promise<{ balance: TokenBalance; pending: number }> {
    const [balance, pending] = await Promise.all([
      this.getTokenBalance(),
      this.getPendingTokens()
    ]);

    return { balance, pending };
  }

  // Ottieni le informazioni sull'abbonamento
  async getSubscriptionInfo(): Promise<SubscriptionInfo> {
    // Default info per utenti non autenticati o errori
    const defaultInfo: SubscriptionInfo = {
      plan: null,
      isActive: false,
      expiresAt: null
    };

    if (!this.authState.isAuthenticated) {
      return defaultInfo;
    }

    try {
      // Ottieni l'abbonamento attivo dell'utente
      const { data: subscription, error: subError } = await this.supabase
        .from('user_subscriptions')
        .select(`
          id,
          is_active,
          end_date,
          plan_id,
          subscription_plans (
            id,
            name,
            monthly_price,
            annual_price,
            tokens_included
          )
        `)
        .eq('user_id', this.authState.user.id)
        .eq('is_active', true)
        .order('end_date', { ascending: false })
        .limit(1)
        .single();

      if (subError || !subscription) {
        // Nessun abbonamento attivo trovato
        return defaultInfo;
      }

      return {
        plan: subscription.subscription_plans as unknown as {
          id: string;
          name: string;
          monthly_price: number;
          annual_price: number;
          tokens_included: number;
        },
        isActive: subscription.is_active,
        expiresAt: subscription.end_date
      };
    } catch (error) {
      console.error('Exception fetching subscription info:', error);
      return defaultInfo;
    }
  }

  // Apri la pagina di acquisto abbonamento
  openSubscriptionPage(): void {
    // URL della pagina web per acquistare abbonamenti
    const subscriptionUrl = `${SUPABASE_CONFIG.url.replace('.supabase.co', '.app')}/subscription`;

    // Apri nel browser predefinito
    shell.openExternal(subscriptionUrl);
  }

  // Determina il ruolo dell'utente basandosi sull'email (metodo semplice per ora)
  private determineUserRole(user: any): 'admin' | 'user' {
    // Lista degli admin (per ora hardcoded, in futuro potrebbe venire dal database)
    const adminEmails = [
      'info@federicopasinetti.it',
      'info@racetagger.cloud',
      'test@admin.com'
    ];

    if (user && user.email && adminEmails.includes(user.email.toLowerCase())) {
      return 'admin';
    }

    return 'user';
  }

  // Aggiorna il ruolo utente nello stato di autenticazione
  private updateUserRole(): void {
    if (this.authState.isAuthenticated && this.authState.user) {
      this.authState.userRole = this.determineUserRole(this.authState.user);
    }
  }

  // Verifica se l'utente corrente è admin
  isAdmin(): boolean {
    return this.authState.userRole === 'admin';
  }

  // Check if user has access to folder organization feature (now public)
  hasFolderOrganizationAccess(): boolean {
    return this.authState.isAuthenticated || this.demoMode;
  }

  // Verifica se l'utente corrente è un utente normale
  isUser(): boolean {
    return this.authState.userRole === 'user';
  }

  // ============================================================================
  // SISTEMA PRE-AUTORIZZAZIONE BATCH TOKEN (v1.1.0+)
  // ============================================================================

  /**
   * Pre-autorizza token per un batch di immagini.
   * Blocca i token necessari creando una reservation con TTL dinamico.
   *
   * @param tokenCount - Numero di token da pre-autorizzare
   * @param batchId - ID del batch (= execution_id per collegamento DB)
   * @param imageCount - Numero di immagini per calcolo TTL dinamico
   * @param visualTagging - Se true, include costo visual tagging (1.5x)
   * @returns PreAuthResult con reservationId se autorizzato
   */
  async preAuthorizeTokens(
    tokenCount: number,
    batchId: string,
    imageCount: number,
    visualTagging: boolean = false
  ): Promise<PreAuthResult> {
    if (!this.authState.isAuthenticated || !this.authState.user?.id) {
      return {
        authorized: false,
        error: 'NOT_AUTHENTICATED'
      };
    }

    try {
      const { data, error } = await this.supabase.rpc('pre_authorize_tokens', {
        p_user_id: this.authState.user.id,
        p_tokens_needed: tokenCount,
        p_batch_id: batchId,
        p_image_count: imageCount,
        p_visual_tagging: visualTagging
      });

      if (error) {
        console.error('[PreAuth] RPC error:', error);
        return {
          authorized: false,
          error: error.message
        };
      }

      if (!data || !data.authorized) {
        console.warn('[PreAuth] Not authorized:', data?.error);
        return {
          authorized: false,
          error: data?.error || 'UNKNOWN_ERROR',
          available: data?.available,
          needed: data?.needed
        };
      }

      console.log(`[PreAuth] Authorized ${tokenCount} tokens for batch ${batchId}, TTL: ${data.ttlMinutes}min, expires: ${data.expiresAt}`);

      return {
        authorized: true,
        reservationId: data.reservationId,
        expiresAt: data.expiresAt,
        ttlMinutes: data.ttlMinutes
      };
    } catch (error: any) {
      console.error('[PreAuth] Exception:', error);
      return {
        authorized: false,
        error: error.message || 'EXCEPTION'
      };
    }
  }

  /**
   * Finalizza una reservation batch, calcolando token effettivi e rimborso.
   * Chiamare alla fine del batch o su cancellazione.
   *
   * @param reservationId - ID della reservation da finalizzare
   * @param usage - Conteggi effettivi di utilizzo
   * @returns FinalizeResult con token consumati/rimborsati
   */
  async finalizeTokenReservation(
    reservationId: string,
    usage: BatchTokenUsage
  ): Promise<FinalizeResult> {
    if (!this.authState.isAuthenticated) {
      return {
        success: false,
        consumed: 0,
        refunded: 0,
        newBalance: 0,
        error: 'NOT_AUTHENTICATED'
      };
    }

    try {
      const { data, error } = await this.supabase.rpc('finalize_token_reservation', {
        p_reservation_id: reservationId,
        p_actual_usage: usage
      });

      if (error) {
        console.error('[Finalize] RPC error:', error);
        return {
          success: false,
          consumed: 0,
          refunded: 0,
          newBalance: 0,
          error: error.message
        };
      }

      if (data?.error) {
        console.error('[Finalize] Server error:', data.error);
        return {
          success: false,
          consumed: 0,
          refunded: 0,
          newBalance: 0,
          error: data.error
        };
      }

      console.log(`[Finalize] Batch completed: ${data.consumed} consumed, ${data.refunded} refunded, new balance: ${data.newBalance}`);

      return {
        success: true,
        consumed: data.consumed || 0,
        refunded: data.refunded || 0,
        newBalance: data.newBalance || 0
      };
    } catch (error: any) {
      console.error('[Finalize] Exception:', error);
      return {
        success: false,
        consumed: 0,
        refunded: 0,
        newBalance: 0,
        error: error.message || 'EXCEPTION'
      };
    }
  }

  /**
   * Calcola il numero di token necessari per un batch.
   *
   * @param imageCount - Numero di immagini
   * @param visualTaggingEnabled - Se true, applica moltiplicatore 1.5x
   * @returns Numero totale di token necessari
   */
  calculateTokensNeeded(imageCount: number, visualTaggingEnabled: boolean): number {
    const baseTokens = imageCount;
    const visualTaggingTokens = visualTaggingEnabled ? imageCount * 0.5 : 0;
    return Math.ceil(baseTokens + visualTaggingTokens);
  }
}

// Esporta una singola istanza del servizio
export const authService = new AuthService();
