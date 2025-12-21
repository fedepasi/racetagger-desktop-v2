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
├── main.ts                (~4000 righe invece di 5870)
├── main/
│   ├── index.ts           (re-export)
│   ├── ipc/
│   │   ├── index.ts
│   │   ├── auth-handlers.ts
│   │   └── window-handlers.ts
│   ├── services/
│   │   ├── index.ts
│   │   └── version-checker.ts
│   └── utils/
│       ├── index.ts
│       └── safe-ipc.ts
```

## Prossimi Passi

Una volta che questo funziona, puoi estrarre altri moduli:

1. `database-handlers.ts` - Linee 912-1902 (~990 righe)
2. `processing-handlers.ts` - Linee 2088-3315 (~1200 righe)
3. `folder-handlers.ts` - Linee 3316-3857 (~540 righe)
