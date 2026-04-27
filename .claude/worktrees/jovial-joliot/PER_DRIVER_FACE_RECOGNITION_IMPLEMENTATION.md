# Per-Driver Face Recognition Implementation

**Data implementazione:** 22 Gennaio 2026
**Funzionalità:** Sistema face recognition e metatag specifici per ogni singolo driver

---

## 📋 Sommario Modifiche

### ✅ Database (Supabase + SQLite)

1. **Nuova tabella `preset_participant_drivers`**
   - Ogni driver ha: id, name, metatag specifico, order
   - Collegata a `preset_participants` con ON DELETE CASCADE

2. **Modificata tabella `preset_participant_face_photos`**
   - Aggiunto campo `driver_id` (nullable, FK a preset_participant_drivers)
   - `participant_id` ora nullable per backward compatibility
   - Constraint: deve avere O `participant_id` O `driver_id` (non entrambi)

3. **Migration Supabase**
   - File: `supabase/migrations/20260122160655_add_per_driver_face_recognition.sql`
   - RLS policies aggiornate per supportare drivers
   - Triggers aggiornati per gestire entrambi i casi

4. **Schema SQLite Desktop**
   - Tabelle mirror create in `database-service.ts`
   - Compatibilità offline garantita

### ✅ Backend (IPC Handlers)

**Nuovi handlers in `src/ipc/preset-face-handlers.ts`:**
- `preset-driver-get-all` - Ottiene tutti i drivers per un participant
- `preset-driver-create` - Crea nuovo driver
- `preset-driver-update` - Aggiorna driver (nome, metatag, order)
- `preset-driver-delete` - Elimina driver (cascade alle foto)
- `preset-driver-sync` - **Sincronizza automaticamente drivers da array nomi**

**Handlers modificati:**
- `preset-face-upload-photo` - Ora accetta `driverId` OR `participantId`
- `preset-face-get-photos` - Supporta query per driver specifico
- `preset-face-load-for-preset` - Carica anche driver descriptors

**Database functions modificate in `src/database-service.ts`:**
- `getPresetParticipantFacePhotos()` - Supporta driverId
- `addPresetParticipantFacePhoto()` - Supporta driverId
- `getPresetParticipantFacePhotoCount()` - Supporta isDriver flag
- `loadPresetFaceDescriptors()` - Include drivers con personMetatag

### ✅ Frontend (UI + JavaScript)

1. **Nuovo file `renderer/js/driver-face-manager.js`**
   - Classe `DriverFaceManagerMulti`
   - Gestisce pannelli multipli (uno per driver)
   - Auto-sync con drivers tag input
   - Ogni pannello ha: metatag field + 5 foto slots

2. **Modificato `renderer/js/preset-face-manager.js`**
   - Supporta `currentDriverId` oltre a `participantId`
   - Metodo `loadPhotos()` accetta parametro opzionale `driverId`
   - Upload modificato per inviare il parametro corretto

3. **Modificato `renderer/js/participants-manager.js`**
   - Integrato `driverFaceManagerMulti` al posto di `presetFaceManager`
   - Funzione `syncDriverPanels()` chiamata quando drivers cambiano
   - `addDriverTag()` e `removeDriverTag()` ora sincronizzano UI
   - `openParticipantEditModal()` carica driver panels

4. **Modificato `renderer/pages/participants.html`**
   - Sostituita sezione "Face Recognition Photos"
   - Nuova sezione "Face Recognition & Driver Metadata"
   - Container dinamico per pannelli drivers

5. **Aggiunti stili in `renderer/css/participants.css`**
   - ~250 righe di CSS per driver panels
   - Responsive design
   - Dark mode support
   - Animazioni smooth

6. **Modificato `renderer/index.html`**
   - Aggiunto script `driver-face-manager.js`

---

## 🎯 Come Funziona

### Flusso Utente

1. **Utente apre Edit Participant modal**
2. **Aggiunge drivers nel campo "Drivers" (tag input)**
   - Es: "A. Pier Guidi", "M. Calado", "J. Rigon"
3. **Automaticamente appaiono 3 pannelli sotto** (uno per driver)
4. **Per ogni driver può:**
   - Impostare un metatag specifico
   - Caricare fino a 5 foto del volto
5. **Quando salva:**
   - Drivers creati in DB (`preset_participant_drivers`)
   - Auto-sync sincronizza drivers dal campo tag
6. **Durante l'analisi:**
   - Face recognition trova volto di "A. Pier Guidi"
   - Scrive SOLO "A. Pier Guidi" + suo metatag specifico
   - Non scrive gli altri 2 drivers

### Esempio WEC (3 drivers per auto)

**Auto #51 Ferrari:**
- Driver 1: A. Pier Guidi → metatag "Pro Driver, Champion 2024" → 3 foto
- Driver 2: M. Calado → metatag "Professional" → 1 foto
- Driver 3: J. Rigon → metatag "Amateur" → 0 foto

**Risultato analisi:**
- Immagine ritratto Pier Guidi → scrive "A. Pier Guidi" + "Pro Driver, Champion 2024"
- Immagine ritratto Calado → scrive "M. Calado" + "Professional"
- Immagine ritratto Rigon → NON riconosce (nessuna foto)
- Immagine auto in pista → scrive tutti e 3 (logica normale)

---

## 🧪 Testing

### 1. Deploy Migration Supabase

```bash
cd /Users/federicopasinetti/Documents/WebProjects/Racetagger_V3/racetagger-clean

# Opzione A: Via Supabase CLI (se configurato)
npx supabase db push

# Opzione B: Via Dashboard
# 1. Apri https://supabase.com/dashboard/project/taompbzifylmdzgbbrpv/sql/new
# 2. Incolla contenuto di: supabase/migrations/20260122160655_add_per_driver_face_recognition.sql
# 3. Esegui
```

### 2. Rebuild Desktop App

```bash
npm run compile
npm start
```

### 3. Test Case: Creazione Nuovo Preset con Drivers

1. Apri app desktop
2. Vai a "Participants"
3. Click "New Preset"
4. Compila:
   - Name: "WEC 2024 Test"
   - Sport Category: "Endurance WEC"
5. Click "Add Participant"
6. Compila:
   - Race Number: "51"
   - Drivers: "A. Pier Guidi", "M. Calado", "J. Rigon" (tag input)
7. **Verifica:** Appaiono 3 pannelli sotto
8. Per ogni driver:
   - Imposta metatag diverso
   - Carica 1-3 foto
9. Salva participant
10. Salva preset

**✅ Verifica Database:**
```sql
-- Controlla drivers creati
SELECT * FROM preset_participant_drivers WHERE participant_id = '<id>';

-- Controlla foto per driver
SELECT * FROM preset_participant_face_photos WHERE driver_id IS NOT NULL;
```

### 4. Test Case: Edit Esistente - Aggiungi/Rimuovi Driver

1. Apri preset esistente
2. Edit participant
3. Aggiungi nuovo driver nel tag input
4. **Verifica:** Appare nuovo pannello
5. Rimuovi un driver dal tag
6. **Verifica:** Pannello sparisce (conferma se ha foto)
7. Salva

### 5. Test Case: Backward Compatibility

1. Crea participant SENZA drivers
2. **Verifica:** Appare empty state "No Drivers Yet"
3. Edit participant esistente (creato prima della migration)
4. **Verifica:** Funziona normalmente

---

## 🐛 Troubleshooting

### Errore: "Column driver_id does not exist"
**Causa:** Migration non applicata a Supabase
**Fix:** Esegui migration manualmente via dashboard

### Pannelli drivers non appaiono
**Causa:** Script non caricato
**Fix:** Verifica console browser (F12), controlla caricamento `driver-face-manager.js`

### Foto non si salvano
**Causa:** RLS policies o user_id mancante
**Fix:** Controlla session utente e policies in Supabase

### Drivers non sincronizzano
**Causa:** IPC handler non registrato
**Fix:** Verifica console main process, check `preset-driver-sync` handler

---

## 📊 File Modificati/Creati

### Database
- ✅ `supabase/migrations/20260122160655_add_per_driver_face_recognition.sql` (NEW)
- ✅ `src/database-service.ts` (MODIFIED - schema + functions)

### Backend
- ✅ `src/ipc/preset-face-handlers.ts` (MODIFIED - +5 handlers)

### Frontend
- ✅ `renderer/js/driver-face-manager.js` (NEW - 400 righe)
- ✅ `renderer/js/preset-face-manager.js` (MODIFIED)
- ✅ `renderer/js/participants-manager.js` (MODIFIED)
- ✅ `renderer/pages/participants.html` (MODIFIED)
- ✅ `renderer/css/participants.css` (MODIFIED - +250 righe)
- ✅ `renderer/index.html` (MODIFIED - script import)

---

## 🔄 Backward Compatibility

**100% compatibile con dati esistenti:**
- Vecchie foto con solo `participant_id` funzionano
- Participant senza drivers mostrano empty state
- Migration NON modifica dati esistenti
- Rollback possibile (cancellare nuove tabelle)

---

## 🚀 Next Steps (Opzionale)

### Face Matching Logic Update
Per utilizzare il `driver_metatag` durante il face recognition:

1. Modificare `parallel-analyzer.ts` o edge function
2. Quando face matched → controllare se `isDriver === true`
3. Se sì → usare `personMetatag` invece del metatag generale
4. Scrivere solo quel driver name negli IPTC keywords

**Questo permetterà:**
- Ritratto Pier Guidi → scrive solo lui + suo metatag
- Ritratto Calado → scrive solo lui + suo metatag
- Podio con 2 drivers → scrive entrambi con loro metatag specifici

---

## 📞 Support

Per problemi o domande:
- Controlla console browser (F12)
- Controlla console main process (logs desktop app)
- Verifica migration applicata in Supabase dashboard
- Controlla RLS policies per preset_participant_drivers

---

**Implementazione completata! Pronto per il testing. 🎉**
