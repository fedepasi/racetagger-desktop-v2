# Racetagger Desktop App - Sistema di Login, Token e Feedback

Questo documento descrive le funzionalità di autenticazione, gestione token e feedback implementate nella Racetagger Desktop App.

## Flusso di Autenticazione

L'applicazione desktop ora implementa un flusso di autenticazione completo:

1. **Verifica del Codice di Accesso**: L'utente deve inserire un codice di accesso valido per poter utilizzare l'applicazione.
2. **Login con Email e Password**: Dopo la verifica del codice, l'utente deve effettuare il login con le proprie credenziali.
3. **Modalità Demo**: È possibile utilizzare l'applicazione in modalità demo senza effettuare il login, con un limite di 3 analisi.

### Processo di Login

1. All'avvio dell'applicazione, viene verificato se l'utente ha già un codice di accesso salvato.
2. Se il codice è valido, viene mostrata la schermata di login.
3. L'utente inserisce email e password per accedere.
4. Se le credenziali sono corrette, l'utente viene reindirizzato all'applicazione principale.

## Sistema di Token

L'applicazione utilizza un sistema di token per limitare il numero di analisi che un utente può effettuare:

1. **Bilancio Token**: Ogni utente ha un bilancio di token che può utilizzare per analizzare le immagini.
2. **Utilizzo Token**: Ogni analisi di immagine consuma un token.
3. **Visualizzazione Token**: Il bilancio dei token è visibile nella barra utente in alto.
4. **Notifiche**: L'utente riceve notifiche quando il bilancio dei token è basso.

### Gestione Token

- I token vengono scalati automaticamente dopo ogni esecuzione andata a buon fine.
- Gli utenti possono acquistare token aggiuntivi tramite il sistema di abbonamento.
- In modalità demo, l'utente ha un limite di 3 analisi.

## Sistema di Feedback

È stato implementato un sistema di feedback per permettere agli utenti di valutare i risultati delle analisi:

1. **Valutazione Risultati**: Per ogni immagine analizzata, l'utente può fornire una valutazione (Eccellente, Buono, Sufficiente, Scarso).
2. **Commenti**: È possibile aggiungere commenti opzionali per fornire feedback più dettagliati.
3. **Invio Feedback**: I feedback vengono salvati nel database e associati all'utente e all'immagine.

### Processo di Feedback

1. Dopo l'analisi di un'immagine, viene mostrato un modulo di feedback sotto i risultati.
2. L'utente seleziona una valutazione e opzionalmente aggiunge un commento.
3. Il feedback viene inviato al server e salvato nel database.
4. L'utente riceve una conferma dell'invio del feedback.

## Menu Utente

È stato implementato un menu utente che permette di:

1. **Visualizzare Informazioni Utente**: Email dell'utente loggato.
2. **Visualizzare Bilancio Token**: Numero di token totali, utilizzati e rimanenti.
3. **Visualizzare Informazioni Abbonamento**: Piano attivo, stato e data di scadenza.
4. **Effettuare Logout**: Disconnettere l'utente dall'applicazione.

## Tabelle Database

### Tabella `user_tokens`

Memorizza il bilancio dei token per ogni utente:

- `user_id`: ID dell'utente
- `tokens_purchased`: Numero di token acquistati
- `tokens_used`: Numero di token utilizzati

### Tabella `token_transactions`

Registra le transazioni di token:

- `user_id`: ID dell'utente
- `amount`: Quantità di token (positiva per acquisti, negativa per utilizzi)
- `transaction_type`: Tipo di transazione (purchase, usage, welcome_bonus, etc.)
- `image_id`: ID dell'immagine analizzata (per transazioni di tipo usage)
- `description`: Descrizione della transazione
- `created_at`: Data e ora della transazione

### Tabella `user_feedback`

Memorizza i feedback degli utenti:

- `image_id`: ID dell'immagine
- `user_id`: ID dell'utente
- `rating`: Valutazione (excellent, good, fair, poor)
- `comment`: Commento opzionale
- `created_at`: Data e ora del feedback

## Note per gli Sviluppatori

- Il sistema di autenticazione è implementato nel file `auth-service.ts`.
- La gestione dei token è implementata nei metodi `canUseToken` e `useTokens` di `auth-service.ts`.
- Il sistema di feedback è implementato nel file `main.ts` con il metodo `handleFeedbackSubmission`.
- L'interfaccia utente per il login e il feedback è implementata nei file `auth.js` e `renderer.js`.
