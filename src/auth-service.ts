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
        console.log(`AuthService: SESSION_FILE_PATH set to ${this.SESSION_FILE_PATH}`);
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
      console.warn('[AuthService] App not ready during constructor, will initialize later');
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
        console.log('Periodic token check...');
        this.checkAndRefreshToken(this.authState.session);
      }
    }, REFRESH_INTERVAL);
    
    console.log('Token refresh timer set up. Will check token validity every 15 minutes.');
  }

  // Ripristina la sessione se presente in storage locale
  private async restoreSession(): Promise<void> {
    if (!this.SESSION_FILE_PATH) {
      console.warn("AuthService: restoreSession called but SESSION_FILE_PATH is not set. Aborting session restore.");
      return;
    }
    
    console.log("AuthService: Attempting to restore session...");
    
    try {
      // Prima verifica se esiste un file di sessione locale
      const savedSession = this.loadSessionFromFile();
      
      if (savedSession) {
        console.log("AuthService: Found saved session file, attempting to restore...");
        
        try {
          // Prima prova a rinnovare la sessione con il refresh token
          console.log("Attempting to refresh session with saved refresh token...");
          const { data: refreshData, error: refreshError } = await this.supabase.auth.refreshSession({
            refresh_token: savedSession.refresh_token
          });
          
          if (refreshError) {
            console.warn('Error refreshing session with saved refresh token:', refreshError);
            console.log('Falling back to setting the saved session directly...');
            
            // Se non è possibile rinnovare la sessione, prova a impostarla direttamente
            const { data, error } = await this.supabase.auth.setSession({
              access_token: savedSession.access_token,
              refresh_token: savedSession.refresh_token
            });
            
            if (error) {
              console.error('Error setting saved session:', error);
              
              // Verifica se l'errore è dovuto a problemi di rete
              if (error.message && (
                  error.message.includes('network') || 
                  error.message.includes('connection') ||
                  error.message.includes('offline')
                )) {
                console.warn('Network issues detected while setting session. Using saved session in offline mode.');
                
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
                      console.log('Using saved session in offline mode for user:', this.authState.user.email);
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
              console.log('Session restored successfully for user:', data.user?.email);
              
              // Determina e aggiorna il ruolo utente
              this.updateUserRole();
              
              // Salva la sessione aggiornata
              await this.saveSessionToFile(data.session);
              return;
            } else {
              console.warn('No session data returned when setting session');
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
            console.log('Session refreshed successfully for user:', refreshData.user?.email);

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
            console.warn('No session data returned when refreshing session');
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
                console.log('Using saved session in offline mode after error for user:', this.authState.user.email);
                return;
              }
            }
          } catch (jwtError) {
            console.error('Error parsing JWT token in error handler:', jwtError);
          }
          
          this.clearSavedSession();
        }
      } else {
        console.log("AuthService: No saved session file found");
      }
      
      // Se non è stato possibile ripristinare la sessione dal file locale,
      // prova a recuperare la sessione da Supabase
      try {
        console.log("AuthService: Attempting to get session from Supabase...");
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
          console.log('Session retrieved from Supabase for user:', session.user.email);
          
          // Salva la sessione nel file locale
          await this.saveSessionToFile(session);
          return;
        } else {
          console.log('No active session found in Supabase');
        }
      } catch (networkError) {
        console.warn('Network error while getting session from Supabase:', networkError);
      }
    } catch (error) {
      console.error('Failed to restore session:', error);
    }
    
    console.log("AuthService: Session restoration complete. Authentication state:", this.authState.isAuthenticated);
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
        console.log(`Token expires in ${minutesRemaining} minutes. Refreshing...`);
        
        const { data, error } = await this.supabase.auth.refreshSession();
        
        if (error) {
          console.error('Error refreshing token:', error);
          return;
        }
        
        if (data.session) {
          this.authState.session = data.session;
          
          // Salva la nuova sessione nel file locale
          await this.saveSessionToFile(data.session);
          
          // Convert expires_at to milliseconds if it's in seconds (typical for JWT tokens)
          const expiresAtMs = typeof data.session.expires_at === 'number' && data.session.expires_at < 20000000000 
            ? data.session.expires_at * 1000  // Convert seconds to milliseconds
            : data.session.expires_at || 0;   // Already in ms or fallback to 0
          
          console.log('Token refreshed successfully. New expiration:', new Date(expiresAtMs).toLocaleString());
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
      console.warn('Session write already in progress, skipping to prevent corruption');
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
      
      console.log('Session saved to file for user:', sessionData.user_email);
      
      // Verifica che il file sia stato scritto correttamente
      if (fs.existsSync(this.SESSION_FILE_PATH)) {
        const stats = fs.statSync(this.SESSION_FILE_PATH);
        console.log(`Session file size: ${stats.size} bytes`);
      } else {
        console.warn('Session file was not created successfully');
      }
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
        console.log('Session file does not exist at:', this.SESSION_FILE_PATH);
        return null;
      }
      
      // Leggi e analizza il file JSON
      const fileContent = fs.readFileSync(this.SESSION_FILE_PATH, { encoding: 'utf8' });
      if (!fileContent || fileContent.trim() === '') {
        console.warn('Session file is empty');
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
        console.warn('Session file is missing required tokens');
        return null; // Non rimuoviamo il file, potrebbe essere un problema temporaneo
      }
      
      // Log per debug
      console.log(`Loaded session for user: ${sessionData.user_email || 'Unknown'}`);
      if (sessionData.saved_at) {
        console.log(`Session was saved at: ${new Date(sessionData.saved_at).toLocaleString()}`);
      }
      
      // Non verifichiamo più la scadenza del token, utilizziamo sempre il refresh token
      // per ottenere un nuovo access token se necessario
      console.log('Using saved session regardless of expiration status');
      
      // Stampa informazioni sulla scadenza per debug
      if (sessionData.expires_at) {
        try {
          const expiresAt = new Date(sessionData.expires_at);
          const now = new Date();
          
          const minutesRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / (60 * 1000));
          if (minutesRemaining < 0) {
            console.log(`Session token expired ${Math.abs(minutesRemaining)} minutes ago, but we will try to refresh it automatically`);
          } else {
            console.log(`Session token expires in ${minutesRemaining} minutes`);
          }
        } catch (dateError) {
          console.error('Error calculating token expiration:', dateError);
        }
      } else {
        console.log('Session does not have expiration information');
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
        console.log('Saved session file removed');
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
      console.log(`[AuthService] UserRole was null, determined: ${this.authState.userRole} for ${this.authState.user.email}`);
    }
    return this.authState;
  }
  
  // Aggiorna la sessione con una nuova sessione
  async updateSession(session: Session): Promise<void> {
    if (!session) {
      console.warn('Attempted to update session with null or undefined session');
      return;
    }
    
    this.authState.session = session;
    console.log('Session updated in AuthService');
    
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
        console.warn('Version check failed during auth:', error);
        return true; // Allow auth to continue if version check fails
      }
      
      const result = data;
      this.authState.versionCheckResult = result;
      this.authState.forceUpdateRequired = result?.force_update_enabled && result?.requires_update;
      
      console.log('Version check during auth:', {
        requires_update: result?.requires_update,
        force_update_enabled: result?.force_update_enabled,
        current_version: currentVersion,
        result_data: result,
        will_block_tokens: result?.force_update_enabled && result?.requires_update
      });
      
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
      
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
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

      // Use unified registration edge function
      const { data, error } = await this.supabase.functions.invoke('register-user-unified', {
        body: {
          email,
          password,
          name: name || email.split('@')[0], // Extract name from email if not provided
          source: 'desktop'
        }
      });

      if (error) {
        console.error('Registration error:', error);
        return { success: false, error: error.message };
      }

      if (!data.success) {
        return { success: false, error: data.error || 'Registration failed' };
      }

      console.log(`Registration successful. User granted ${data.tokensGranted} tokens.`);

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
    console.log('AuthService: Cleaning up resources...');
    
    // Clear token refresh interval
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = undefined;
      console.log('AuthService: Token refresh interval cleared');
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
    
    console.log('AuthService: Cleanup completed');
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
    console.log('Demo mode enabled');
  }

  // Registra utilizzo in modalità demo
  trackDemoUsage(): boolean {
    if (!this.demoMode) return true;
    
    this.demoUsageCount++;
    console.log(`Demo usage: ${this.demoUsageCount}/${this.MAX_DEMO_USAGE}`);
    
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
    console.log(`🔥 [DEBUG] useTokens called with MODIFIED VERSION - count: ${count}, imageId: ${imageId}`);
    if (!this.authState.isAuthenticated) {
      // In modalità demo, solo tracciamento
      return this.trackDemoUsage();
    }
    
    // Check version before allowing token usage - TEMPORARILY DISABLED FOR DEBUGGING
    // const versionOk = await this.checkVersionBeforeAuth();
    // if (!versionOk) {
    //   console.warn('Token usage blocked due to required update');
    //   return false;
    // }
    
    try {
      const userId = this.authState.user.id;
      console.log(`🔥 [AuthService] useTokens: Attempting to consume ${count} tokens for user ${userId}`);
      
      // Implementazione diretta senza stored procedure (fallback)
      console.log(`🔥 [AuthService] useTokens: Using direct table update approach (stored procedure failed)`);
      
      // Prima verifica il saldo corrente
      const currentBalance = await this.getTokenBalance();
      if (currentBalance.remaining < count) {
        console.error(`🔥 [AuthService] useTokens: Insufficient tokens. Available: ${currentBalance.remaining}, Required: ${count}`);
        return false;
      }
      
      // Aggiorna user_tokens.tokens_used
      const newTokensUsed = currentBalance.used + count;
      console.log(`🔥 [AuthService] useTokens: Updating user_tokens, new tokens_used will be: ${newTokensUsed}`);
      
      // Prima verifichiamo se il record esiste
      const { data: existingRecord, error: selectError } = await this.supabase
        .from('user_tokens')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      console.log(`🔥 [AuthService] useTokens: Existing record check:`, { data: existingRecord, error: selectError });
      console.log(`🔥 [AuthService] useTokens: selectError exists?`, !!selectError);
      console.log(`🔥 [AuthService] useTokens: selectError code:`, selectError?.code);
      console.log(`🔥 [AuthService] useTokens: existingRecord exists?`, !!existingRecord);
      
      let updateData, updateError;
      
      if (selectError && selectError.code === 'PGRST116') {
        // Record non esiste, dobbiamo inserirlo 
        console.log(`🔥 [AuthService] useTokens: Record non esiste (PGRST116), inserisco nuovo record`);
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
        // Record esiste, lo aggiorniamo - prima provo RPC increment
        console.log(`🔥 [AuthService] useTokens: Record esiste, aggiorno tokens_used da ${existingRecord.tokens_used} a ${newTokensUsed}`);
        console.log(`🔥 [AuthService] useTokens: Tentativo RPC increment_user_tokens`);
        
        const rpcResult = await this.supabase.rpc('increment_user_tokens', {
          p_user_id: userId,
          p_increment_amount: count
        });
        
        console.log(`🔥 [AuthService] useTokens: RPC increment result:`, rpcResult);
        
        if (rpcResult.error) {
          console.log(`🔥 [AuthService] useTokens: RPC failed, fallback to direct UPDATE`);
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
          console.log(`🔥 [AuthService] useTokens: RPC increment successful`);
          // Simulo i dati per mantenere compatibilità
          updateData = [{ 
            user_id: userId,
            tokens_used: newTokensUsed,
            last_updated: new Date().toISOString()
          }];
          updateError = null;
        }
      } else {
        console.error(`🔥 [AuthService] useTokens: PROBLEMA - selectError non è PGRST116 E existingRecord non esiste`);
        console.error(`🔥 [AuthService] useTokens: selectError:`, selectError);
        console.error(`🔥 [AuthService] useTokens: existingRecord:`, existingRecord);
        return false;
      }
      
      console.log(`🔥 [AuthService] useTokens: Operation response:`, { data: updateData, error: updateError });
      
      if (updateError) {
        console.error('🔥 [AuthService] useTokens: Error upserting user_tokens:');
        console.error('🔥 [AuthService] useTokens: Error message:', updateError.message);
        console.error('🔥 [AuthService] useTokens: Error code:', updateError.code); 
        console.error('🔥 [AuthService] useTokens: Error details:', updateError.details);
        console.error('🔥 [AuthService] useTokens: Error hint:', updateError.hint);
        console.error('🔥 [AuthService] useTokens: Full error object:', JSON.stringify(updateError, null, 2));
        return false;
      }
      
      // Verifica che l'operazione sia andata a buon fine
      if (!updateData || updateData.length === 0) {
        console.error(`🔥 [AuthService] useTokens: Operation succeeded but no data returned. This is unexpected.`);
        return false;
      }
      
      const updatedRecord = updateData[0];
      console.log(`🔥 [AuthService] useTokens: Successfully updated user_tokens:`, updatedRecord);
      
      // Verifica che tokens_used sia stato effettivamente aggiornato
      if (updatedRecord.tokens_used !== newTokensUsed) {
        console.error(`🔥 [AuthService] useTokens: CRITICAL - Expected tokens_used: ${newTokensUsed}, but got: ${updatedRecord.tokens_used}`);
        return false;
      }
      
      console.log(`🔥 [AuthService] useTokens: ✅ VERIFIED - tokens_used correctly updated to ${updatedRecord.tokens_used}`);
      
      // Notifica il chiamante del nuovo saldo PRIMA di inserire la transazione
      if (onTokenUsed) {
        console.log(`🔥 [AuthService] useTokens: Getting updated balance to notify callback`);
        const updatedBalance = await this.getTokenBalance();
        console.log(`🔥 [AuthService] useTokens: Updated balance:`, updatedBalance);
        console.log(`🔥 [AuthService] useTokens: Calling onTokenUsed callback`);
        onTokenUsed(updatedBalance);
      } else {
        console.log(`🔥 [AuthService] useTokens: No onTokenUsed callback provided`);
      }
      
      // Inserisci in token_transactions (non bloccare se fallisce)
      console.log(`🔥 [AuthService] useTokens: Inserting transaction record for ${count} tokens`);
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
        console.error('🔥 [AuthService] useTokens: Warning - transaction logging failed:', transactionError);
        // Non bloccare l'operazione se fallisce solo il log della transazione
      } else {
        console.log(`🔥 [AuthService] useTokens: Transaction logged successfully`);
      }
      
      return true;
    } catch (error) {
      console.error('🔥 [AuthService] useTokens: Exception:', error);
      return false;
    }
  }

  // Ottieni il bilancio token dell'utente con debug logging
  async getTokenBalance(): Promise<TokenBalance> {
    console.log('[AuthService] getTokenBalance called');
    
    // Check version before allowing balance check
    if (this.authState.isAuthenticated) {
      const versionOk = await this.checkVersionBeforeAuth();
      if (!versionOk) {
        console.warn('Token balance check blocked due to required update');
        return {
          total: 0,
          used: 0,
          remaining: 0
        };
      }
    }
    console.log('[AuthService] Auth state:', {
      isAuthenticated: this.authState.isAuthenticated,
      userId: this.authState.user?.id,
      demoMode: this.demoMode
    });
    
    // Default balance per utenti non autenticati o errori
    const defaultBalance: TokenBalance = {
      total: this.demoMode ? this.MAX_DEMO_USAGE : 0,
      used: this.demoMode ? this.demoUsageCount : 0,
      remaining: this.demoMode ? (this.MAX_DEMO_USAGE - this.demoUsageCount) : 0
    };
    
    if (!this.authState.isAuthenticated) {
      console.log('[AuthService] User not authenticated, returning default balance');
      return defaultBalance;
    }
    
    try {
      console.log('[AuthService] Querying user_tokens table for user_id:', this.authState.user.id);
      const { data: userTokensData, error: userTokensError } = await this.supabase
        .from('user_tokens')
        .select('tokens_purchased, tokens_used')
        .eq('user_id', this.authState.user.id)
        .single();
      
      console.log('[AuthService] user_tokens query result:', { data: userTokensData, error: userTokensError });
      
      // Query subscribers table for bonus tokens
      console.log('[AuthService] Querying subscribers table for user email:', this.authState.user.email);
      const { data: subscriberData, error: subscriberError } = await this.supabase
        .from('subscribers')
        .select('base_tokens, bonus_tokens, earned_tokens, admin_bonus_tokens')
        .eq('email', this.authState.user.email?.toLowerCase())
        .single();
      
      console.log('[AuthService] subscribers query result:', { data: subscriberData, error: subscriberError });
      
      // Query token_requests for approved tokens
      console.log('[AuthService] Querying token_requests table for approved tokens, user_id:', this.authState.user.id);
      const { data: tokenRequestsData, error: tokenRequestsError } = await this.supabase
        .from('token_requests')
        .select('tokens_requested, status')
        .eq('user_id', this.authState.user.id)
        .in('status', ['approved', 'completed']);
      
      console.log('[AuthService] token_requests query result:', { data: tokenRequestsData, error: tokenRequestsError });
      
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
      
      console.log('[AuthService] Calculated token balance (UNIFIED CALCULATION):', {
        userTokensPurchased, // SINGLE SOURCE OF TRUTH (includes base + bonus + purchases + grants)
        earnedTokens, // Referral rewards
        adminBonusTokens, // Extra admin grants
        approvedTokensFromRequests, // Approved token requests
        totalTokens, // = userTokensPurchased + earnedTokens + adminBonusTokens + approvedTokensFromRequests
        used: userTokensUsed,
        remaining: tokenBalance.remaining
      });
      
      return tokenBalance;
    } catch (error) {
      console.error('[AuthService] Exception fetching token balance:', error);
      return defaultBalance;
    }
  }

  // Forza il refresh del bilancio token (per debug e sync manuale)
  async forceTokenRefresh(): Promise<TokenBalance> {
    console.log('[AuthService] Force token refresh requested');
    
    // Clear any potential cache (even though we don't have one)
    // This could be extended in the future if caching is added
    
    // Get fresh token balance
    const balance = await this.getTokenBalance();
    console.log('[AuthService] Force refresh result:', balance);
    
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
    console.log('[AuthService] Starting user data restoration...');
    
    try {
      // Import dei servizi database (dynamic import per evitare circular dependencies)
      const {
        getProjectsOnline,
        loadLastUsedCsvFromSupabase,
        getSportCategories
      } = await import('./database-service');
      
      // 1. Scarica e ripopola la cache dei Projects
      console.log('[AuthService] Downloading projects from Supabase...');
      await getProjectsOnline();
      console.log('[AuthService] Projects loaded successfully');

      // 2. Carica le sport categories
      console.log('[AuthService] Loading sport categories...');
      await getSportCategories();
      console.log('[AuthService] Sport categories loaded successfully');

      // 3. Ripristina l'ultimo CSV usato dall'utente
      console.log('[AuthService] Loading last used CSV from Supabase...');
      const csvData = await loadLastUsedCsvFromSupabase();
      
      if (csvData && csvData.length > 0) {
        console.log(`[AuthService] Loaded ${csvData.length} CSV entries from Supabase`);
        
        // Invia il CSV ripristinato al processo principale per aggiornare le variabili globali
        // Utilizziamo la stessa logica del caricamento CSV
        const { ipcRenderer } = require('electron');
        if (ipcRenderer) {
          ipcRenderer.send('restore-csv-data', {
            csvData,
            filename: 'restored_from_supabase.csv'
          });
        }
      } else {
        console.log('[AuthService] No CSV data found for user');
      }
      
      console.log('[AuthService] User data restoration completed');
    } catch (error) {
      console.error('[AuthService] Error during user data restoration:', error);
      // Non bloccare il login se il ripristino fallisce
    }
  }
  
  // Forza il refresh completo delle informazioni token (balance + pending)
  async forceTokenInfoRefresh(): Promise<{ balance: TokenBalance; pending: number }> {
    console.log('[AuthService] Force token info refresh requested');
    
    const tokenInfo = await this.getTokenInfo();
    console.log('[AuthService] Force token info refresh result:', tokenInfo);
    
    return tokenInfo;
  }

  // Ottieni i token pending (richiesti ma non ancora approvati)
  async getPendingTokens(): Promise<number> {
    console.log('[AuthService] getPendingTokens called');
    
    if (!this.authState.isAuthenticated) {
      console.log('[AuthService] User not authenticated, returning 0 pending tokens');
      return 0;
    }
    
    try {
      console.log('[AuthService] Querying token_requests table for pending requests for user_id:', this.authState.user.id);
      const { data, error } = await this.supabase
        .from('token_requests')
        .select('tokens_requested')
        .eq('user_id', this.authState.user.id)
        .eq('status', 'pending');
      
      console.log('[AuthService] Pending token requests query result:', { data, error });
      
      if (error || !data) {
        console.error('[AuthService] Error fetching pending tokens:', error);
        return 0;
      }
      
      const totalPending = data.reduce((sum, request) => sum + (request.tokens_requested || 0), 0);
      
      console.log('[AuthService] Calculated pending tokens:', totalPending);
      return totalPending;
    } catch (error) {
      console.error('[AuthService] Exception fetching pending tokens:', error);
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
      console.log(`User role determined: ${this.authState.userRole} for ${this.authState.user.email}`);
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
}

// Esporta una singola istanza del servizio
export const authService = new AuthService();
