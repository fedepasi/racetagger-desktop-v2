# File di Installazione Creati ✅

## 📦 Files di Installazione Generati

### 🍎 macOS (ARM64)
- **Racetagger Desktop-1.0.0-arm64.dmg** - Installer DMG per macOS
- **Racetagger Desktop-1.0.0-arm64-mac.zip** - Archivio zip per distribuzione

### 🪟 Windows (ARM64)
- **Racetagger Desktop Setup 1.0.0.exe** - Installer NSIS per Windows

## 📁 Directory Output
Tutti i file si trovano nella cartella: `release/`

## 🎯 Come Distribuire

### Per macOS:
1. **DMG File**: `Racetagger Desktop-1.0.0-arm64.dmg`
   - Doppio click per aprire
   - Trascinare l'app nella cartella Applicazioni
   - Ideale per la distribuzione standard

2. **ZIP File**: `Racetagger Desktop-1.0.0-arm64-mac.zip`
   - Estrarre e eseguire direttamente
   - Più leggero per il download

### Per Windows:
1. **EXE Installer**: `Racetagger Desktop Setup 1.0.0.exe`
   - Installer automatico NSIS
   - Gestisce automaticamente l'installazione
   - Crea icone nel menu Start

## ⚠️ Note Importanti

1. **Code Signing**: 
   - macOS: Nessun certificato di sviluppatore trovato
   - Windows: Non firmato digitalmente
   - Gli utenti potrebbero vedere avvisi di sicurezza

2. **Architettura**: 
   - I file sono compilati per ARM64 (Apple Silicon/Windows ARM)
   - Per Intel x64, usa: `npx electron-builder --mac --x64` o `npx electron-builder --win --x64`

3. **Dimensioni**:
   - I file includeranno tutto il runtime Electron
   - File abbastanza grandi (~100-200MB) ma completamente autonomi

## 🚀 Comandi Rapidi per Altre Architetture

### Intel x64:
```bash
# macOS Intel
npx electron-builder --mac --x64

# Windows Intel  
npx electron-builder --win --x64
```

### Universale (tutti i target):
```bash
npm run build
