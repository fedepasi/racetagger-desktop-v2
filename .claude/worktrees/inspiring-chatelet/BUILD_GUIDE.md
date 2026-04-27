# Guida alla Creazione dei File di Installazione


  Per le prossime volte, questi sono gli step da seguire:

  # 1. Pulisci
  rm -rf dist release

  # 2. Ricompila moduli nativi  
  npm run rebuild

  # 3. Compila TypeScript
  npm run compile

  # 4. Build finale
  npm run build

  Oppure più semplicemente:
  # Build completa in un comando (include già la compilazione TS)
  npm run build

  La tua app è pronta in:
  - release/mac-arm64/Racetagger Desktop.app
  - release/Racetagger Desktop-1.0.0-arm64.dmg

__________________________________________________________
## Prerequisiti
- Node.js installato
- npm installato  
- Progetto TypeScript compilato

## Passaggi per creare i file di installazione:

### 1. Compilazione TypeScript
```bash
npm run compile
```

### 2. Icone dell'applicazione (opzionale ma raccomandato)
Per avere icone personalizzate, aggiungi:
- `resources/icon.png` (512x512px) - per tutte le piattaforme
- `resources/icon.ico` (per Windows)
- `resources/icon.icns` (per macOS)

### 3. Build per tutte le piattaforme
```bash
npm run build
```

### 4. Build specifici per piattaforma

#### Solo per macOS:
```bash
npx electron-builder --mac
```

#### Solo per Windows:
```bash
npx electron-builder --win
```

#### Solo per Linux:
```bash
npx electron-builder --linux
```

## Configurazione attuale in package.json

La configurazione è già impostata per:
- **macOS**: App bundle (.app)
- **Windows**: Installer NSIS (.exe)
- **Linux**: AppImage e pacchetto Debian (.deb)

## Output
I file di installazione saranno creati nella cartella `release/`

## Note importanti
1. Per buildare per macOS da altri sistemi operativi potrebbero essere necessari strumenti aggiuntivi
2. Per Windows, potresti aver bisogno di certificati di code signing per evitare avvisi di sicurezza
3. La prima build potrebbe richiedere del tempo per scaricare le dipendenze
