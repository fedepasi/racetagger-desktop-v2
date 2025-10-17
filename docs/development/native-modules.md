# Gestione dei Moduli Nativi in Electron

Questo documento descrive le best practices per gestire i moduli nativi in Electron, in particolare per evitare crash del main process durante l'avvio dell'applicazione.

## Problema

I moduli nativi come `better-sqlite3` e `sharp` richiedono compilazione per l'architettura specifica del sistema e la versione di Node.js utilizzata da Electron. Se un modulo nativo non è compilato correttamente, può causare un crash del main process prima che possa stampare qualsiasi log, rendendo difficile il debug.

## Soluzione

Abbiamo implementato due soluzioni per gestire questo problema:

1. **Importazione sicura dei moduli nativi**
   - Utilizziamo un wrapper che tenta di importare il modulo nativo e, in caso di errore, fornisce un'implementazione mock
   - Questo permette all'applicazione di avviarsi anche se un modulo nativo non può essere caricato

2. **Ricompilazione automatica dei moduli nativi**
   - Utilizziamo `electron-rebuild` per ricompilare i moduli nativi per la versione di Electron utilizzata
   - Abbiamo aggiunto uno script `postinstall` nel `package.json` per ricompilare automaticamente i moduli nativi dopo l'installazione

## Implementazione

### 1. Importazione sicura dei moduli nativi

Abbiamo creato un modulo di utilità `src/utils/native-modules.ts` che fornisce funzioni per importare in modo sicuro i moduli nativi:

```typescript
export function safeRequire<T>(moduleName: string, mockImplementation: T): T {
  try {
    // Tentativo di importare il modulo
    const module = require(moduleName);
    console.log(`Module '${moduleName}' imported successfully`);
    return module;
  } catch (error) {
    console.error(`Failed to import module '${moduleName}':`, error);
    console.warn(`Using mock implementation for '${moduleName}'`);
    return mockImplementation;
  }
}
```

### 2. Implementazione mock per `better-sqlite3`

In `database-service.ts`, abbiamo implementato un'importazione sicura di `better-sqlite3`:

```typescript
// Importazione sicura di better-sqlite3
let BetterSqlite3Database: any;
try {
  // Tentativo di importare better-sqlite3
  BetterSqlite3Database = require('better-sqlite3');
  console.log('better-sqlite3 imported successfully');
} catch (error) {
  console.error('Failed to import better-sqlite3:', error);
  // Creiamo un mock di better-sqlite3 per evitare errori
  BetterSqlite3Database = class MockDatabase {
    constructor() {
      console.warn('Using MockDatabase instead of better-sqlite3');
    }
    prepare() { return { run: () => {}, get: () => null, all: () => [] }; }
    exec() {}
    close() {}
  };
}
```

### 3. Implementazione mock per `sharp`

In `src/utils/native-modules.ts`, abbiamo implementato un'importazione sicura di `sharp`:

```typescript
export const mockSharp = {
  // Funzioni di base di sharp
  resize: () => mockSharp,
  jpeg: () => mockSharp,
  png: () => mockSharp,
  webp: () => mockSharp,
  toBuffer: async () => Buffer.from([]),
  toFile: async () => ({ width: 0, height: 0, format: 'mock' }),
  metadata: async () => ({ width: 0, height: 0, format: 'mock' }),
};

export function getSharp() {
  return safeRequire('sharp', mockSharp);
}
```

### 4. Ricompilazione automatica dei moduli nativi

Abbiamo aggiunto uno script `postinstall` nel `package.json` per ricompilare automaticamente i moduli nativi dopo l'installazione:

```json
"scripts": {
  "postinstall": "electron-rebuild"
}
```

## Best Practices

1. **Usa sempre importazioni sicure per i moduli nativi**
   - Implementa un meccanismo di fallback per tutti i moduli nativi critici
   - Fornisci un'implementazione mock che permetta all'applicazione di funzionare anche senza il modulo nativo

2. **Ricompila i moduli nativi per la versione di Electron utilizzata**
   - Usa `electron-rebuild` per ricompilare i moduli nativi
   - Aggiungi uno script `postinstall` nel `package.json` per ricompilare automaticamente i moduli nativi dopo l'installazione

3. **Gestisci gli errori e il logging**
   - Implementa un sistema di logging dettagliato per tracciare l'inizializzazione dei moduli nativi
   - Gestisci gli errori in modo da fornire messaggi utili per il debug

4. **Testa l'applicazione su diverse piattaforme**
   - I moduli nativi possono comportarsi diversamente su diverse piattaforme
   - Testa l'applicazione su Windows, macOS e Linux per assicurarti che funzioni correttamente

## Risoluzione dei Problemi

Se l'applicazione non si avvia o si verifica un errore con un modulo nativo:

1. Prova a ricompilare manualmente il modulo nativo:
   ```
   npx electron-rebuild -f -w nome-modulo
   ```

2. Verifica che il modulo nativo sia compatibile con la versione di Electron utilizzata:
   ```
   npm list nome-modulo
   npm list electron
   ```

3. Controlla i log dell'applicazione per errori specifici relativi ai moduli nativi.

4. Se il problema persiste, prova a disinstallare e reinstallare il modulo nativo:
   ```
   npm uninstall nome-modulo
   npm install nome-modulo
   npx electron-rebuild -f -w nome-modulo
