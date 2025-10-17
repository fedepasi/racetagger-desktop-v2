# Persistenza della Sessione in Racetagger Desktop

Questo documento descrive l'implementazione della persistenza della sessione nella Racetagger Desktop App, che consente agli utenti di rimanere autenticati anche dopo aver chiuso e riaperto l'applicazione.

## Funzionamento

La persistenza della sessione è stata implementata utilizzando i seguenti meccanismi:

1. **Salvataggio del Token di Sessione**: Quando un utente effettua il login con successo, il token di sessione di Supabase viene salvato in un file JSON nella cartella dati dell'applicazione.

2. **Ripristino Automatico della Sessione**: All'avvio dell'applicazione, il sistema verifica se esiste un token di sessione salvato e, in caso affermativo, lo utilizza per autenticare automaticamente l'utente.

3. **Gestione della Scadenza del Token**: Il sistema verifica se il token salvato è ancora valido o è scaduto. Se il token è scaduto, viene rimosso e l'utente dovrà effettuare nuovamente il login.

4. **Rinnovo Proattivo del Token**: Il sistema verifica se il token è vicino alla scadenza (meno di 60 minuti rimanenti) e, in tal caso, lo rinnova automaticamente per garantire una sessione continua.

5. **Supporto Modalità Offline**: In caso di problemi di rete durante il ripristino della sessione, il sistema tenta di utilizzare il token salvato localmente per consentire un accesso limitato anche in assenza di connessione.

6. **Rimozione del Token al Logout**: Quando l'utente effettua il logout, il token di sessione salvato viene rimosso.

## Dettagli Tecnici

### Salvataggio della Sessione

Quando un utente effettua il login con successo, il token di sessione viene salvato in un file JSON nella cartella dati dell'applicazione:

```typescript
private saveSessionToFile(session: Session): void {
  try {
    // Crea un oggetto con solo i dati essenziali della sessione
    const sessionData = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at
    };
    
    // Salva i dati in un file JSON
    fs.writeFileSync(
      this.SESSION_FILE_PATH,
      JSON.stringify(sessionData),
      { encoding: 'utf8' }
    );
    
    console.log('Session saved to file');
  } catch (error) {
    console.error('Error saving session to file:', error);
  }
}
```

### Ripristino della Sessione

All'avvio dell'applicazione, il sistema tenta di ripristinare la sessione seguendo questi passaggi:

1. Prima prova a recuperare la sessione da Supabase
2. Se non c'è una sessione attiva in Supabase, prova a caricare la sessione dal file locale
3. Se trova una sessione salvata, la imposta in Supabase utilizzando `setSession`

```typescript
private async restoreSession(): Promise<void> {
  try {
    // Prima prova a recuperare la sessione da Supabase
    const { data: { session }, error } = await this.supabase.auth.getSession();
    
    if (session) {
      this.authState = {
        isAuthenticated: true,
        user: session.user,
        session: session
      };
      console.log('Session restored from Supabase for user:', session.user.email);
      return;
    }
    
    // Se non c'è una sessione attiva in Supabase, prova a caricarla dal file locale
    const savedSession = this.loadSessionFromFile();
    
    if (savedSession) {
      try {
        // Imposta la sessione salvata in Supabase
        const { data, error } = await this.supabase.auth.setSession({
          access_token: savedSession.access_token,
          refresh_token: savedSession.refresh_token
        });
        
        if (error) {
          console.error('Error setting saved session:', error);
          // Rimuovi il file di sessione se non è più valido
          this.clearSavedSession();
          return;
        }
        
        if (data.session) {
          this.authState = {
            isAuthenticated: true,
            user: data.session.user,
            session: data.session
          };
          console.log('Session restored from file for user:', data.session.user.email);
        }
      } catch (setSessionError) {
        console.error('Error setting saved session:', setSessionError);
        this.clearSavedSession();
      }
    }
  } catch (error) {
    console.error('Failed to restore session:', error);
  }
}
```

### Gestione della Scadenza del Token

Il sistema verifica se il token salvato è ancora valido controllando la data di scadenza:

```typescript
// Verifica se la sessione è scaduta
if (sessionData.expires_at && new Date(sessionData.expires_at) < new Date()) {
  console.log('Saved session has expired');
  this.clearSavedSession();
  return null;
}
```

### Rinnovo Proattivo del Token

Il sistema verifica se il token è vicino alla scadenza e lo rinnova automaticamente:

```typescript
private async checkAndRefreshToken(session: Session): Promise<void> {
  try {
    if (!session.expires_at) return;
    
    const expiresAt = new Date(session.expires_at);
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
        this.saveSessionToFile(data.session);
        
        console.log('Token refreshed successfully. New expiration:', 
          new Date(data.session.expires_at || 0).toLocaleString());
      }
    }
  } catch (error) {
    console.error('Error checking/refreshing token:', error);
  }
}
```

### Supporto Modalità Offline

In caso di problemi di rete, il sistema tenta di utilizzare il token salvato localmente:

```typescript
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
    // Estrai le informazioni utente dal token JWT (in modo semplificato)
    const tokenParts = savedSession.access_token.split('.');
    if (tokenParts.length === 3) {
      const payload = JSON.parse(atob(tokenParts[1]));
      
      if (payload && payload.sub && payload.exp && new Date(payload.exp * 1000) > new Date()) {
        this.authState = {
          isAuthenticated: true,
          user: { id: payload.sub, email: payload.email || 'Utente offline' },
          session: { 
            access_token: savedSession.access_token,
            refresh_token: savedSession.refresh_token,
            expires_at: payload.exp * 1000
          }
        };
        console.log('Using saved session in offline mode');
        return;
      }
    }
  } catch (jwtError) {
    console.error('Error parsing JWT token:', jwtError);
  }
}
```

### Rimozione del Token al Logout

Quando l'utente effettua il logout, il token di sessione salvato viene rimosso:

```typescript
// Rimuovi il file di sessione salvato
this.clearSavedSession();
```

## Vantaggi

- **Migliore Esperienza Utente**: Gli utenti non devono effettuare il login ogni volta che aprono l'applicazione
- **Sicurezza Mantenuta**: I token scaduti vengono automaticamente rimossi
- **Gestione Trasparente**: Il processo di ripristino della sessione è completamente trasparente per l'utente
- **Continuità della Sessione**: Il rinnovo proattivo dei token previene disconnessioni indesiderate durante l'utilizzo dell'app
- **Resilienza alla Rete**: Il supporto per la modalità offline consente un utilizzo limitato dell'app anche in assenza di connessione

## Note per gli Sviluppatori

- La persistenza della sessione è implementata nel file `auth-service.ts`
- Il token di sessione viene salvato nella cartella dati dell'applicazione (`app.getPath('userData')`)
- Il file di sessione contiene solo i token necessari per il ripristino della sessione, non le informazioni sensibili dell'utente
