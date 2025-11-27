# Export Destinations - Contesto di Sviluppo

Ultimo aggiornamento: 27 Novembre 2025

## Origine del Progetto

Queste funzionalita sono state richieste da un collaboratore fotografo F1 professionista che aveva bisogno di:

1. **Workflow professionale per agenzie** - Esportare le stesse foto a multiple agenzie (Getty, Reuters, ecc.) con metadati diversi per ciascuna
2. **Conformita IPTC standard** - Photo Mechanic compatibility con tutti i campi XMP standard
3. **Rinomina file automatica** - Pattern-based renaming tipo `Verstappen_0001.jpg`
4. **Person Shown field** - Campo IPTC:PersonInImage richiesto dalle agenzie fotografiche

## Architettura Implementata

### Sistema Unificato "Export Destinations"

Prima avevamo un sistema frammentato:
- `folder_1`, `folder_2`, `folder_3` nei presets partecipanti
- Metadati di base hardcoded
- Nessun supporto per filename renaming

**Nuovo approccio:**
- Ogni "Export Destination" e un'entita autonoma con:
  - Path di destinazione + subfolder pattern
  - Filename pattern con placeholder
  - Tutti i metadati IPTC/XMP configurabili
  - Crediti/copyright per agenzia
  - Keywords base
  - Person Shown template

### Flusso di Lavoro

```
Analisi Immagini → Matching Partecipanti → Export Multi-Destinazione
                                              ↓
                            ┌─────────────────┼─────────────────┐
                            ↓                 ↓                 ↓
                      Getty Images       Reuters          Archivio
                      /Getty/{event}/    /Reuters/        /Archive/
                      {surname}_{seq}    {number}_{seq}   {original}
                      Credit: F.P/Getty  Credit: F.P/R    -
```

## File Modificati/Creati

### Backend (TypeScript)

| File | Descrizione |
|------|-------------|
| `src/export-destinations-service.ts` | **NUOVO** - CRUD operations per destinations |
| `src/utils/filename-renamer.ts` | **NUOVO** - Pattern replacement e sequence management |
| `src/utils/metadata-writer.ts` | **MODIFICATO** - Aggiunta `writeFullMetadata()` con tutti i campi IPTC |
| `src/unified-image-processor.ts` | **MODIFICATO** - Integrazione export destinations |
| `src/main.ts` | **MODIFICATO** - IPC handlers per destinations |
| `src/preload.ts` | **MODIFICATO** - Canali IPC aggiunti |

### Frontend (JavaScript)

| File | Descrizione |
|------|-------------|
| `renderer/js/export-destinations.js` | **NUOVO** - Manager completo UI |
| `renderer/index.html` | **MODIFICATO** - Sezione destinations + modal editor |
| `renderer/css/styles.css` | **MODIFICATO** - Stili modal e destinations |

### Database (Supabase)

| File | Descrizione |
|------|-------------|
| `supabase/migrations/20251126000000_create_export_destinations.sql` | Schema tabella |

## Schema Database

```sql
CREATE TABLE export_destinations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,

  -- Path
  base_folder TEXT,
  subfolder_pattern VARCHAR(255), -- "{team}/{number}"

  -- Filename
  filename_pattern VARCHAR(255),  -- "{surname}_{seq}"
  filename_sequence_mode VARCHAR(20), -- global, per_subject, per_folder

  -- Credits (variano per agenzia)
  credit VARCHAR(255),            -- Getty, Reuters, ecc.
  source VARCHAR(255),
  copyright VARCHAR(255),

  -- Creator Info
  creator VARCHAR(255),
  authors_position VARCHAR(100),

  -- Contact Info
  contact_email, contact_website, contact_phone, ...

  -- Templates
  headline_template VARCHAR(500),
  description_template TEXT,
  person_shown_template VARCHAR(255),

  -- Keywords
  base_keywords TEXT[],
  append_keywords BOOLEAN,

  -- Location
  city, country, location, ...

  -- Behavior
  is_active BOOLEAN,
  is_default BOOLEAN,
  display_order INTEGER
);
```

## Placeholder Supportati

### Filename Pattern
| Placeholder | Esempio | Descrizione |
|-------------|---------|-------------|
| `{original}` | IMG_1234 | Nome file originale |
| `{name}` | Max Verstappen | Nome completo |
| `{surname}` | Verstappen | Solo cognome |
| `{number}` | 1 | Numero di gara |
| `{team}` | Red Bull | Team |
| `{event}` | Monaco2025 | Nome evento |
| `{date}` | 2025-05-25 | Data cattura |
| `{seq}` | 001 | Sequenza con padding |
| `{seq:N}` | 0001 | Sequenza con N cifre |

### Sequence Modes
- **global**: 1, 2, 3, 4... per tutto il batch
- **per_subject**: Verstappen_1, Leclerc_1, Verstappen_2...
- **per_folder**: Reset a 1 per ogni subfolder

## Person Shown (IPTC:PersonInImage)

Campo richiesto dalle agenzie per identificare i soggetti nelle foto.

**Template esempio:**
```
{name} ({nationality}) {team} {car_model}
```

**Output:**
```
Max Verstappen (Dutch) Red Bull RB21
```

Scritto in: `XMP-iptcExt:PersonInImage`

## Campi XMP/IPTC Supportati

| Campo UI | Tag ExifTool | Standard |
|----------|--------------|----------|
| Credit | -IPTC:Credit | IPTC Core |
| Source | -IPTC:Source | IPTC Core |
| Copyright | -IPTC:CopyrightNotice | IPTC Core |
| Creator | -IPTC:By-line | IPTC Core |
| Headline | -IPTC:Headline | IPTC Core |
| Description | -IPTC:Caption-Abstract | IPTC Core |
| Keywords | -IPTC:Keywords | IPTC Core |
| City | -IPTC:City | IPTC Core |
| Country | -IPTC:Country-PrimaryLocationName | IPTC Core |
| Location | -IPTC:Sub-location | IPTC Core |
| Person Shown | -XMP-iptcExt:PersonInImage | IPTC Extension |
| Event | -XMP-iptcExt:Event | IPTC Extension |
| Contact Email | -XMP-iptcCore:CiEmailWork | IPTC Core |
| Contact Website | -XMP-iptcCore:CiUrlWork | IPTC Core |

## Status Implementazione

### Completato
- [x] Schema database export_destinations
- [x] Backend service CRUD
- [x] IPC handlers in main.ts
- [x] UI lista destinations
- [x] Modal editor con tabs
- [x] Filename renaming system
- [x] Sequence manager
- [x] Person Shown template
- [x] Full metadata writer
- [x] Multi-destination export

### Da Verificare/Testare
- [ ] Integrazione completa con processing pipeline
- [ ] Preview filename in tempo reale
- [ ] Sequence reset tra batch
- [ ] Performance con molte destinazioni
- [ ] UI mobile responsiveness

### Future (Phase 5)
- [ ] FTP/SFTP Upload (Pro tier)
- [ ] Password encryption con safeStorage
- [ ] Test connection UI
- [ ] Upload progress tracking

## Bug Noti Risolti

### Modal Non Visibile (27/11/2025)
**Problema:** Modal non appariva anche se il JS funzionava
**Causa:** Modal era dentro `section-participants` che viene nascosto
**Fix:** Spostato modal fuori da tutte le sezioni, prima di `</body>`

### Layout Modal Rotto (27/11/2025)
**Problema:** Layout caotico con elementi sovrapposti
**Causa:** CSS duplicato e `display: grid` incompatibile con flex-1/flex-2
**Fix:** Rimosso CSS duplicato, cambiato `.form-row` da grid a flex

## Note per Domani

1. **Testare il modal** - Verificare che ora si apra correttamente e il layout sia usabile
2. **Verificare salvataggio** - Creare una destination e verificare che si salvi su Supabase
3. **Test export** - Provare l'export reale con metadati e filename renaming
4. **Controllare sequence** - Verificare che i numeri sequenziali funzionino correttamente
5. **Review CSS** - Potrebbero esserci ancora stili da rifinire

## Comandi Utili

```bash
# Avviare app in dev
npm run dev

# Compilare TypeScript
npm run compile

# Vedere log Supabase
npx supabase functions logs
```
