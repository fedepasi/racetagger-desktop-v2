# Come Integrare i Nuovi Moduli in main.ts

## Passo 1: Aggiungere gli Import

All'inizio di `main.ts`, aggiungi questi import:

```typescript
// Nuovi moduli estratti
import {
  setupEpipeHandlers,
  safeConsoleError,
  safeSend,
  safeSendToSender,
  setMainWindow,
  getMainWindow
} from './main/utils';

import {
  checkAppVersion,
  isForceUpdateRequired,
  setForceUpdateRequired,
  VersionCheckResult
} from './main/services';

import {
  setupAuthHandlers,
  AuthHandlersDependencies
} from './main/ipc/auth-handlers';

import {
  setupWindowControlHandlers,
  createWindow as createMainWindow,
  WindowHandlersDependencies
} from './main/ipc/window-handlers';
```

## Passo 2: Rimuovere il Codice Duplicato

Rimuovi queste sezioni da `main.ts` (ora sono nei moduli):

1. **Linee 19-51**: `safeConsoleError` e handlers EPIPE
   - Sostituisci con: `setupEpipeHandlers();`

2. **Linee 155-174**: `safeSend` e `safeSendToSender`
   - Ora importate da `./main/utils`

3. **Linee 176-237**: `VersionCheckResult` e `checkAppVersion`
   - Ora importate da `./main/services`

4. **Linee 455-735**: `setupAuthHandlers`
   - Ora importata da `./main/ipc/auth-handlers`

5. **Linee 836-910**: `setupWindowControlHandlers` e `createWindow`
   - Ora importate da `./main/ipc/window-handlers`

## Passo 3: Configurare le Dipendenze

In `app.whenReady()`, configura le dipendenze:

```typescript
app.whenReady().then(async () => {
  // Setup EPIPE handlers (sostituisce linee 34-51)
  setupEpipeHandlers();

  // Configura le dipendenze per auth handlers
  const authDeps: AuthHandlersDependencies = {
    getMainWindow: () => mainWindow,
    getCsvData: () => csvData,
    setCsvData: (data) => { csvData = data; },
    getGlobalCsvData: () => globalCsvData,
    setGlobalCsvData: (data) => { globalCsvData = data; }
  };

  // Configura le dipendenze per window handlers
  const windowDeps: WindowHandlersDependencies = {
    getMainWindow: () => mainWindow,
    setMainWindow: (win) => { mainWindow = win; setMainWindow(win); },
    isDev: isDev,
    remoteEnable: remoteEnable
  };

  // Setup handlers
  setupAuthHandlers(authDeps);
  setupWindowControlHandlers(windowDeps);

  // Check version prima di creare la finestra
  await checkAppVersion();

  // Crea la finestra
  mainWindow = createMainWindow();

  // ... resto del codice
});
```

## Benefici di Questa Struttura

1. **Meno conflitti Git**: Ogni modulo è in un file separato
2. **Test più facili**: Puoi testare ogni modulo indipendentemente
3. **Dependency Injection**: Facile da mockare per i test
4. **Manutenzione**: Codice più organizzato e navigabile

## Struttura Risultante

```
src/
├── main.ts                (~3000 righe invece di 5870)
├── main/
│   ├── index.ts           (re-export centrale)
│   ├── ipc/
│   │   ├── index.ts
│   │   ├── auth-handlers.ts
│   │   ├── window-handlers.ts
│   │   └── database/
│   │       ├── index.ts
│   │       ├── project-handlers.ts
│   │       ├── execution-handlers.ts
│   │       ├── preset-handlers.ts
│   │       ├── sport-category-handlers.ts
│   │       ├── export-destination-handlers.ts
│   │       ├── statistics-handlers.ts
│   │       └── thumbnail-handlers.ts
│   ├── services/
│   │   ├── index.ts
│   │   └── version-checker.ts
│   └── utils/
│       ├── index.ts
│       └── safe-ipc.ts
```

## Database Handlers (Completato)

I database handlers sono stati estratti e suddivisi in moduli specializzati:

### Integrazione Database Handlers

Aggiungi in `app.whenReady()`:

```typescript
import { setupDatabaseIpcHandlers, DatabaseHandlersDependencies } from './main/ipc/database';

// In app.whenReady()
const dbDeps: DatabaseHandlersDependencies = {
  getMainWindow: () => mainWindow
};
setupDatabaseIpcHandlers(dbDeps);
```

### Rimuovere da main.ts

6. **Linee 912-1900**: `setupDatabaseIpcHandlers` completa
   - Ora importata da `./main/ipc/database`

## Prossimi Passi

Moduli rimanenti da estrarre:

1. `processing-handlers.ts` - Linee 2088-3315 (~1200 righe)
2. `folder-handlers.ts` - Linee 3316-3857 (~540 righe)
3. `token-handlers.ts` - Linee 1961-2087 (~125 righe)
