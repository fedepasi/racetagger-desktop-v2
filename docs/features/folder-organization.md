# Folder Organization Feature - Update Summary

## 🎯 Obiettivo
Permettere agli utenti di personalizzare l'organizzazione delle cartelle per ogni partecipante nel Participant Preset, con la possibilità di creare gerarchie di cartelle personalizzate (es. Ferrari/51, Ferrari/52, ma anche 51 e 52 come cartelle separate).

## ✅ Modifiche Implementate

### 1. **Database Migration** (REQUIRED BEFORE USING)
**File:** `supabase-add-folder-organization.sql`

Eseguire questo script in Supabase SQL Editor prima di utilizzare la nuova funzionalità:

```sql
-- Aggiunge 3 nuove colonne alla tabella preset_participants
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS folder_1 TEXT,
ADD COLUMN IF NOT EXISTS folder_2 TEXT,
ADD COLUMN IF NOT EXISTS folder_3 TEXT;

-- Aggiunge colonna custom_folders alla tabella participant_presets
ALTER TABLE participant_presets
ADD COLUMN IF NOT EXISTS custom_folders JSONB DEFAULT '[]'::jsonb;
```

**Importante:** Questa migration è **obbligatoria** prima di utilizzare la feature.

### 2. **Backend TypeScript**
**File:** `src/database-service.ts`

- Estesa interfaccia `PresetParticipantSupabase` con campi:
  - `folder_1?: string`
  - `folder_2?: string`
  - `folder_3?: string`

- Estesa interfaccia `ParticipantPresetSupabase` con:
  - `custom_folders?: string[]` - Array di nomi folder personalizzate

### 3. **Frontend HTML**
**File:** `renderer/index.html`

- **Nuova sezione "Personalize your Folder Organization"** nel modal di edit preset
  - Permette di creare folder personalizzate
  - UI con folder chips removibili
  - Info box con istruzioni

- **Tabella partecipanti aggiornata:**
  - ❌ Rimossa colonna "Navigator"
  - ✅ Aggiunte 3 colonne: "Folder 1", "Folder 2", "Folder 3"
  - Ogni colonna ha un `<select>` popolato dinamicamente con le folder create

### 4. **Frontend JavaScript**
**File:** `renderer/js/participants-manager.js`

**Nuove funzioni:**
- `addCustomFolder()` - Aggiunge una nuova folder personalizzata
- `removeCustomFolder(folderName)` - Rimuove una folder
- `renderCustomFolders()` - Renderizza i folder chips nella UI
- `clearCustomFolders()` - Pulisce tutte le custom folders
- `updateFolderSelects()` - Aggiorna i select nelle righe dei partecipanti

**Funzioni modificate:**
- `createNewPreset()` - Inizializza array `customFolders`
- `editPreset()` - Carica `custom_folders` dal preset salvato
- `addParticipantRow()` - Include 3 select per folder invece del campo navigator
- `collectParticipantsFromTable()` - Raccoglie i valori di `folder_1`, `folder_2`, `folder_3`
- `savePreset()` - Salva `custom_folders` nel preset

**Nuove variabili globali:**
- `var customFolders = []` - Array che mantiene le folder create

### 5. **Frontend CSS**
**File:** `renderer/css/participants.css`

Nuovi stili aggiunti:
- `.folder-organization-section` - Container principale della sezione
- `.custom-folders-manager` - Manager delle folder
- `.folders-list` - Lista con layout flex-wrap
- `.folder-chip` - Chip stilizzato per ogni folder (con hover effect)
- `.folder-chip-remove` - Pulsante × per rimuovere folder
- `.folder-info-box` - Info box con istruzioni
- Dark mode support completo

## 🔄 User Flow

### Creazione/Edit di un Preset:

1. **Aprire modal "Edit Participant Preset"**
2. **Sezione "Personalize your Folder Organization":**
   - Click su "Add Folder" → Inserire nome folder (es. "Ferrari")
   - Ripetere per creare altre folder (es. "McLaren", "Aston Martin")
   - I folder chips appaiono con icona 📁 e pulsante × per rimuovere

3. **Tabella Participants:**
   - Ogni riga ha 3 select: Folder 1, Folder 2, Folder 3
   - I select sono popolati con le folder create
   - Default: "-- None --"

4. **Esempi di configurazione:**

   **Esempio 1: Ferrari con sotto-cartelle 51 e 52**
   ```
   Number: 51
   Folder 1: Ferrari
   Folder 2: -- None --
   Folder 3: -- None --
   → Crea: Ferrari/51

   Number: 52
   Folder 1: Ferrari
   Folder 2: -- None --
   Folder 3: -- None --
   → Crea: Ferrari/52
   ```

   **Esempio 2: Cartelle separate + gerarchia**
   ```
   Number: 51
   Folder 1: Ferrari
   Folder 2: -- None --
   Folder 3: -- None --
   → Crea: Ferrari/51

   (In alternativa, se vuoi anche la 51 come folder separata,
   puoi gestire questo tramite la funzionalità di folder organization dell'analisi)
   ```

   **Esempio 3: Gerarchia complessa**
   ```
   Number: 51
   Folder 1: Team
   Folder 2: Ferrari
   Folder 3: Piloti
   → Crea: Team/Ferrari/Piloti/51
   ```

## 🎨 Default Behavior

- Se **tutte le colonne Folder sono vuote** (o "-- None --"), la foto viene organizzata nella cartella col numero: `51/`, `52/`, etc.
- Se **Folder 1** è specificata, crea gerarchia: `Ferrari/51/`
- Se **Folder 1 + Folder 2** sono specificate: `Team/Ferrari/51/`
- E così via...

## 📋 Checklist Deploy

- [ ] **STEP 1:** Eseguire migration SQL in Supabase
- [ ] **STEP 2:** Build TypeScript (`npm run compile`)
- [ ] **STEP 3:** Testare creazione nuovo preset con custom folders
- [ ] **STEP 4:** Testare edit preset esistente
- [ ] **STEP 5:** Verificare salvataggio folder_1, folder_2, folder_3 nel database
- [ ] **STEP 6:** Testare organizzazione effettiva delle cartelle durante l'analisi

## 🔧 Backend Support Needed

**NOTA:** Questa implementazione copre la **UI e il salvataggio dei dati** nel database.

Per utilizzare effettivamente queste informazioni durante l'organizzazione delle foto, sarà necessario aggiornare la logica di folder organization nel backend (`src/admin-features.js` o simile) per:

1. Leggere `folder_1`, `folder_2`, `folder_3` dai participant data
2. Creare la gerarchia di cartelle in base ai valori
3. Gestire il fallback al numero quando tutti i folder sono vuoti

## 📝 Note Tecniche

- **Compatibilità backward:** Preset esistenti senza custom_folders continuano a funzionare (default: array vuoto)
- **Validazione:** I nomi folder non possono essere duplicati
- **Sicurezza:** Nomi folder vengono escapati con `escapeHtml()` per prevenire XSS
- **Accessibilità:** Touch-friendly buttons (min 44px), keyboard navigation support
- **Dark Mode:** Full support con stili dedicati

## 🐛 Known Limitations

- Massimo 3 livelli di folder per partecipante
- Nomi folder non possono contenere caratteri speciali del filesystem (/, \, :, *, ?, ", <, >, |)
- La rimozione di una folder usata in participant rows azzera automaticamente i select

## 🎯 Future Enhancements

1. Drag & drop per riordinare folder
2. Importazione folder da CSV
3. Preview dell'alberatura cartelle risultante
4. Bulk edit per assegnare folder a più partecipanti
5. Template folder preconfigurati (es. "Team-based", "Category-based")

---

**Data implementazione:** 2025-10-14
**Versione:** 1.0.0
**Status:** ✅ Ready for Testing
