# Comandi Notarizzazione Apple

## Setup Iniziale
Prima di eseguire i comandi, assicurati di avere le credenziali nel file `.env`:
```bash
APPLE_ID=info@federicopasinetti.it
APPLE_ID_PASS=<your-app-specific-password>
APPLE_TEAM_ID=MNP388VJLQ
```

## Comandi Completi

### 1. Visualizzare Cronologia Notarizzazioni
```bash
source .env && xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS"
```

### 2. Controllare Dettagli di una Specifica Notarizzazione
```bash
source .env && xcrun notarytool info <SUBMISSION_ID> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS"
```

Esempio con l'ultima notarizzazione:
```bash
source .env && xcrun notarytool info f6452fa3-02bf-4bd0-8eaa-e62cdce6763c \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS"
```

### 3. Scaricare Log di una Notarizzazione
```bash
source .env && xcrun notarytool log <SUBMISSION_ID> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS" \
  --output-file notarization-log.json
```

Esempio:
```bash
source .env && xcrun notarytool log f6452fa3-02bf-4bd0-8eaa-e62cdce6763c \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS" \
  --output-file notarization-log.json
```

### 4. Notarizzare un Nuovo File DMG
```bash
source .env && xcrun notarytool submit <PATH_TO_DMG> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS" \
  --wait
```

Esempio per la versione 1.0.4:
```bash
source .env && xcrun notarytool submit release/RaceTagger-1.0.4-arm64.dmg \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS" \
  --wait
```

### 5. Staple del Ticket di Notarizzazione
Dopo che la notarizzazione è stata accettata:
```bash
xcrun stapler staple <PATH_TO_DMG>
```

Esempio:
```bash
xcrun stapler staple release/RaceTagger-1.0.4-arm64.dmg
```

### 6. Verificare lo Stapling
```bash
xcrun stapler validate <PATH_TO_DMG>
```

Esempio:
```bash
xcrun stapler validate release/RaceTagger-1.0.4-arm64.dmg
```

## Workflow Completo per una Nuova Build

1. **Compila e costruisci l'app:**
```bash
npm run compile
npm run build
```

2. **Notarizza il DMG:**
```bash
source .env && xcrun notarytool submit release/RaceTagger-<VERSION>-arm64.dmg \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_ID_PASS" \
  --wait
```

3. **Staple il ticket:**
```bash
xcrun stapler staple release/RaceTagger-<VERSION>-arm64.dmg
```

4. **Verifica:**
```bash
xcrun stapler validate release/RaceTagger-<VERSION>-arm64.dmg
```

## ID Notarizzazioni Recenti
- **1.0.4**: f6452fa3-02bf-4bd0-8eaa-e62cdce6763c (11 Set 2025) - Accepted ✅
- **Precedente**: ebc5f9ac-d06c-42d0-95f8-73ab3c648659 (10 Set 2025) - Accepted ✅
- **Precedente**: ef4407d3-5ea0-498e-a260-d34276ee6236 (10 Set 2025) - Accepted ✅