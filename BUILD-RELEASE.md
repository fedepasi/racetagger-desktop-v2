# Guida Release RaceTagger Desktop

Guida completa per creare release funzionanti di RaceTagger Desktop con moduli nativi.

## Moduli Nativi Critici

| Modulo | Funzione | Gestione in Build |
|--------|----------|-------------------|
| **sharp** | Ridimensionamento immagini | asarUnpack + loader in `native-modules.ts` |
| **onnxruntime-node** | Inferenza ML locale | asarUnpack + loader in `native-modules.ts` |
| **raw-preview-extractor** | Estrazione preview RAW | asarUnpack + loader in `native-modules.ts` |
| **better-sqlite3** | Database locale | asarUnpack (gestito da electron-builder) |
| **canvas** | Face detection (disabilitato) | asarUnpack (gestito da electron-builder) |

## Pre-Build Checklist

### 1. Verifica Dipendenze Native Presenti

```powershell
# Sharp per Windows
Test-Path "node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64.node"

# ONNX Runtime per Windows
Test-Path "node_modules\onnxruntime-node\bin\napi-v6\win32\x64\onnxruntime_binding.node"

# Raw Preview Extractor per Windows
Test-Path "vendor\raw-preview-extractor\prebuilds\win32-x64\raw-preview-extractor.node"

# ExifTool per Windows
Test-Path "vendor\win32\exiftool.exe"
```

### 2. Verifica asarUnpack in package.json

Assicurati che `package.json` contenga in `build.asarUnpack`:

```json
"asarUnpack": [
  "vendor/**/*",
  "node_modules/sharp/**/*",
  "node_modules/@img/**/*",
  "node_modules/better-sqlite3/**/*",
  "node_modules/raw-preview-extractor/**/*",
  "node_modules/onnxruntime-node/**/*",
  "node_modules/onnxruntime-common/**/*"
]
```

### 3. Chiudi Processi Bloccanti

Prima di ogni build, assicurati che non ci siano processi che bloccano i file:

```powershell
# Chiudi RaceTagger
taskkill /F /IM "RaceTagger.exe" 2>$null

# Chiudi processi Electron residui
taskkill /F /IM "electron.exe" 2>$null

# Attendi
Start-Sleep -Seconds 3
```

## Sequenza di Build

### Build Windows x64

```powershell
# 1. Rebuild moduli nativi per Electron
npm run rebuild:sharp
npm run rebuild

# 2. Compila TypeScript
npm run compile

# 3. Build Windows x64
npm run build:win:x64
```

### Build Completa (se ci sono problemi)

```powershell
# Pulizia completa
Remove-Item -Recurse -Force release\win-unpacked -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue

# Reinstalla dipendenze native
npm run postinstall

# Rebuild tutto
npm run rebuild:sharp
npm run rebuild

# Compila e builda
npm run compile
npm run build:win:x64
```

## Post-Build Checklist

### 1. Verifica File Estratti in app.asar.unpacked

```powershell
$unpacked = "release\win-unpacked\resources\app.asar.unpacked"

# Sharp
Test-Path "$unpacked\node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64.node"
Test-Path "$unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll"

# ONNX Runtime
Test-Path "$unpacked\node_modules\onnxruntime-node\bin\napi-v6\win32\x64\onnxruntime_binding.node"
Test-Path "$unpacked\node_modules\onnxruntime-node\bin\napi-v6\win32\x64\onnxruntime.dll"

# Raw Preview Extractor
Test-Path "$unpacked\node_modules\raw-preview-extractor\prebuilds\win32-x64\raw-preview-extractor.node"

# ExifTool
Test-Path "$unpacked\vendor\win32\exiftool.exe"
```

### 2. Output Attesi

La build genera in `release/`:
- `RaceTagger-{version}-x64-win.exe` - Installer NSIS
- `RaceTagger-{version}-x64-portable.exe` - Versione portable
- `RaceTagger-{version}-x64-win.zip` - Archivio ZIP

## Test Funzionali

### 1. Avvio App

```powershell
# Avvia dalla cartella unpacked per vedere i log
.\release\win-unpacked\RaceTagger.exe
```

### 2. Test Sharp (Immagini Standard)

1. Seleziona una cartella con immagini JPG/PNG
2. Avvia analisi
3. **Verifica nel log**: `sharp_version` deve mostrare una versione (es. `0.34.3`), NON `N/A`
4. Le immagini devono essere processate (non 0 successful)

### 3. Test ONNX Runtime (Classificazione Scene)

1. Abilita scene classification nelle impostazioni categoria
2. Processa immagini
3. **Verifica nei log**: Nessun errore `[OnnxDetector]` o `[SceneClassifierONNX]`

### 4. Test Raw Preview Extractor (File RAW)

1. Seleziona cartella con file RAW (NEF, CR2, ARW)
2. Avvia analisi
3. **Verifica**: Le anteprime RAW vengono mostrate
4. **Verifica nei log**: `method: 'native'` invece di `dcraw-fallback`

### 5. Test ExifTool (Scrittura Metadati)

1. Processa immagini con "Update EXIF" abilitato
2. **Verifica**: I metadati vengono scritti nei file
3. Controlla con un viewer EXIF che i dati siano presenti

## Troubleshooting

### Errore: "Sharp not found" o sharp_version: "N/A"

**Causa**: Sharp non caricato correttamente nella build packaged.

**Soluzione**:
1. Verifica che `@img/sharp-win32-x64` sia in `node_modules/`
2. Verifica che sia in `asarUnpack` nel package.json
3. Controlla `native-modules.ts` - deve avere il blocco Windows

### Errore: "ONNX Runtime failed to load"

**Causa**: onnxruntime-node non trova i binari nativi.

**Soluzione**:
1. Verifica che `onnxruntime-node` sia in `asarUnpack`
2. Controlla che `bin/napi-v6/win32/x64/` contenga `.node` e `.dll`
3. I file che usano ONNX devono usare `getOnnxRuntime()` da `native-modules.ts`

### Errore: "raw-preview-extractor not available"

**Causa**: Il modulo nativo non viene trovato.

**Soluzione**:
1. Verifica che `raw-preview-extractor` sia in `asarUnpack`
2. Controlla che `prebuilds/win32-x64/` contenga il file `.node`
3. I file devono usare `getRawPreviewExtractor()` da `native-modules.ts`

### Errore: Build fallisce con "file in use"

**Causa**: Processo che blocca i file nella cartella release.

**Soluzione**:
```powershell
# Chiudi tutti i processi
taskkill /F /IM "RaceTagger.exe"
taskkill /F /IM "electron.exe"
taskkill /F /IM "node.exe"

# Attendi e riprova
Start-Sleep -Seconds 5
npm run build:win:x64
```

### Errore: "prebuild-install EBUSY"

**Causa**: File `.node` bloccato da un processo.

**Soluzione**:
1. Chiudi VS Code se ha file aperti in `node_modules/`
2. Chiudi tutti i terminali con processi node attivi
3. Riavvia il terminale
4. Riprova la build

## Architettura Loader Moduli Nativi

Il file `src/utils/native-modules.ts` centralizza il caricamento dei moduli nativi:

```
native-modules.ts
├── initializeImageProcessor()  → Carica Sharp
├── getOnnxRuntime()           → Carica onnxruntime-node
└── getRawPreviewExtractor()   → Carica raw-preview-extractor
```

Ogni loader:
1. Rileva se l'app è packaged (`app.isPackaged`)
2. Costruisce il percorso corretto per la piattaforma (win32/darwin/linux)
3. Imposta variabili d'ambiente (PATH per DLL, DYLD_LIBRARY_PATH per dylib)
4. Carica il modulo dal percorso `app.asar.unpacked`
5. Testa che funzioni
6. Cache il risultato per chiamate successive

## Note per macOS

Su macOS, i fix post-pack in `scripts/post-pack-fixes.js` eseguono verifiche aggiuntive:
- Verifica binari arm64/x64
- Imposta DYLD_LIBRARY_PATH
- Verifica permessi eseguibili

Su Windows questi fix vengono saltati (gestiti da `asarUnpack`).

## Checklist Release Finale

- [ ] Tutti i test funzionali passano
- [ ] `sharp_version` mostra versione corretta (non N/A)
- [ ] Scene classification funziona (ONNX caricato)
- [ ] File RAW mostrano preview (native, non dcraw fallback)
- [ ] Metadati vengono scritti correttamente
- [ ] Nessun errore critico nei log
- [ ] Installer NSIS funziona
- [ ] Versione portable funziona
