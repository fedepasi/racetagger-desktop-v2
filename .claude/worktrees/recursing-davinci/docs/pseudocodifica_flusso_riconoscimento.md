// ============================================================
// PSEUDOCODIFICA FLUSSO RICONOSCIMENTO RACETAGGER
// ============================================================
// Questo flusso descrive l'elaborazione di UN BATCH di immagini
// La parallelizzazione avviene a livello di singola immagine
// ============================================================

INIZIO ESECUZIONE (batch_immagini[])

  // ============================================================
  // FASE 0: SETUP (una volta per esecuzione)
  // ============================================================

  LEGGI sport_category_config = sport_categories[categoria_selezionata]
  LEGGI participant_preset (se caricato)

  // Estrai configurazioni rilevanti
  crop_enabled = sport_category_config.crop_config.enabled
  recognition_method = sport_category_config.recognition_method  // "gemini" | "onnx"
  scene_classification_attivo = sport_category_config.scene_classification_enabled
  temporal_clustering_attivo = sport_category_config.temporal_config.enabled

  // Classi detector da cercare (configurabile per sport)
  detector_classes = sport_category_config.detector_classes
  // Possibili valori:
  //   - "vehicle"     → auto, moto da corsa (motorsport)
  //   - "bike_rider"  → ciclisti (ciclismo, MTB)
  //   - "runner"      → corridori (atletica, maratone)
  //   - "player"      → giocatori (calcio, basket, volley, etc.)
  //   - Array multiplo possibile: ["vehicle", "bike_rider"] per motocross

  // ============================================================
  // FASE 1: TEMPORAL CLUSTERING (opzionale, pre-processing batch)
  // ============================================================

  SE (temporal_clustering_attivo) ALLORA
      clusters[] = ESEGUI TEMPORAL_CLUSTERING(batch_immagini)
      // Raggruppa immagini scattate in sequenza rapida (burst)
      // Permette di propagare risultati tra foto simili
  ALTRIMENTI
      clusters[] = [ogni immagine come cluster singolo]
  FINE SE

  // ============================================================
  // FASE 2: LOOP SU OGNI IMMAGINE (parallelizzabile)
  // ============================================================

  PER OGNI immagine IN batch_immagini ESEGUI IN PARALLELO:

      // ----------------------------------------------------------
      // 2.1: PREPARAZIONE IMMAGINE (operazioni parallele)
      // ----------------------------------------------------------

      IN PARALLELO:
          // Thread A: Upload per storage/backup
          immagine_resized = RESIZE(immagine_originale, max_dimension=2048)
          storage_url = UPLOAD_TO_STORAGE(immagine_resized)

          // Thread B: Preparazione locale per analisi
          immagine_locale = LOAD_LOCAL(immagine_originale)  // Alta risoluzione
      FINE PARALLELO

      // ----------------------------------------------------------
      // 2.2: SCENE CLASSIFICATION (gate decisionale, opzionale)
      // ----------------------------------------------------------

      SE (scene_classification_attivo) ALLORA
          result_classification = ESEGUI SCENE_CLASSIFIER(immagine_locale)
          // Ritorna: category, confidence, allPredictions
          scene_type = result_classification.category
          // Possibili valori: "racing_action", "garage_pitlane",
          //                   "podium_celebration", "portrait_paddock", "crowd_scene"
      ALTRIMENTI
          scene_type = NULL
      FINE SE

      // ----------------------------------------------------------
      // 2.3: RICONOSCIMENTO NUMERI
      // ----------------------------------------------------------
      // LOGICA:
      //   - Se scene_classification attiva → routing per scene_type
      //   - Se crop_enabled → detector + crop + recognition
      //   - Se !crop_enabled → analisi immagine intera
      //   - recognition_method decide se usare Gemini (cloud) o ONNX (locale)
      // ----------------------------------------------------------

      risultato_numeri = NULL

      SE (scene_type == "crowd_scene") ALLORA
          // Folla - skip riconoscimento numeri
          risultato_numeri = NULL

      ALTRIMENTI
          // Procedi con riconoscimento numeri

          SE (crop_enabled) ALLORA
              // ---- MODALITA' CROP: Detector → Estrazione Crop → Recognition ----

              // Detector cerca solo le classi configurate per questo sport
              bounding_boxes = ESEGUI DETECTOR(immagine_locale, detector_classes)
              // Ritorna: [{class, confidence, x, y, width, height}, ...]

              SE (bounding_boxes.length > 0) ALLORA
                  // Estrai crop ad alta risoluzione dall'immagine originale
                  crops[], negative = ESEGUI CROP_CONTEXT_EXTRACTOR(immagine_originale, bounding_boxes)

                  SCELTA (recognition_method)
                      CASO "gemini":
                          // Comprimi e codifica crop in base64 per invio cloud
                          crops_compressed[] = PER OGNI crop IN crops:
                              RESIZE(crop, max_dimension=1024)
                              COMPRESS(crop, quality=90)
                              ENCODE_BASE64(crop)
                          FINE PER
                          negative_compressed = COMPRESS(negative, quality=80)
                          negative_base64 = ENCODE_BASE64(negative_compressed)

                          // Chiamata V6 edge function con crops inline
                          risultato_numeri = ESEGUI V6_GEMINI(crops_compressed, negative_base64, storage_url)

                      CASO "onnx":
                          // Riconoscimento locale con modello ONNX
                          risultato_numeri = ESEGUI ONNX_RECOGNITION(crops)
                  FINE SCELTA
              FINE SE

          ALTRIMENTI
              // ---- MODALITA' IMMAGINE INTERA: No crop, analisi diretta ----

              SCELTA (recognition_method)
                  CASO "gemini":
                      // Usa V3 o versione per immagine singola
                      immagine_compressed = COMPRESS(immagine_resized, quality=85)
                      immagine_base64 = ENCODE_BASE64(immagine_compressed)
                      risultato_numeri = ESEGUI V3_GEMINI(immagine_base64, storage_url)

                  CASO "onnx":
                      // Riconoscimento locale con modello ONNX su immagine intera
                      risultato_numeri = ESEGUI ONNX_RECOGNITION(immagine_locale)
              FINE SCELTA
          FINE SE
      FINE SE

      // ----------------------------------------------------------
      // 2.4: FACE RECOGNITION (basato su scene_type)
      // ----------------------------------------------------------
      // Face API attivo per: garage_pitlane, podium_celebration, portrait_paddock
      // NON attivo per: racing_action, crowd_scene
      // ----------------------------------------------------------

      risultato_volti = NULL

      SE (scene_type IN ["garage_pitlane", "podium_celebration", "portrait_paddock"]) ALLORA
          risultato_volti = ESEGUI FACE_API(immagine_locale)
      ALTRIMENTI SE (scene_type == NULL E sport_category_config.face_recognition_enabled) ALLORA
          // Scene classification disabilitata ma face recognition abilitato globalmente
          risultato_volti = ESEGUI FACE_API(immagine_locale)
      FINE SE

      // ----------------------------------------------------------
      // 2.5: TAGGING OPZIONALE (costo extra, su richiesta utente)
      // ----------------------------------------------------------

      tags[] = NULL

      SE (sport_category_config.tagging_enabled E utente_ha_richiesto_tagging) ALLORA
          tags[] = ESEGUI CHIAMATA_TAGGING(immagine_locale)
          // Ritorna max 10 keywords in inglese
      FINE SE

      // ----------------------------------------------------------
      // 2.6: POST-PROCESSING IMMAGINE
      // ----------------------------------------------------------

      // Combina tutti i risultati
      risultati_combinati = {
          numeri: risultato_numeri,
          volti: risultato_volti,
          tags: tags,
          scene_type: scene_type,
          storage_url: storage_url
      }

      // SmartMatcher - matching con partecipanti preset
      SE (participant_preset != NULL E risultato_numeri != NULL) ALLORA
          risultati_matchati = ESEGUI SMART_MATCHER(risultati_combinati, participant_preset)
      ALTRIMENTI
          risultati_matchati = risultati_combinati
      FINE SE

      // Scrittura metadata su file originale
      ESEGUI SCRITTURA_XMP_O_EXIF(immagine_originale, risultati_matchati)

      // ----------------------------------------------------------
      // TOKEN DEDUCTION (centralizzato, dinamico)
      // ----------------------------------------------------------
      // Logica: ogni riconoscimento costa 1 token (ripaga training + sviluppo)
      // GRATIS solo se: nessun soggetto detected O scene senza azioni richieste
      // ----------------------------------------------------------

      tokens_da_scalare = 0

      // Riconoscimento numeri (Gemini O ONNX) = 1 token se eseguito con successo
      SE (risultato_numeri != NULL) ALLORA
          tokens_da_scalare = tokens_da_scalare + 1
      FINE SE

      // Face Recognition = 1 token se eseguito
      SE (risultato_volti != NULL) ALLORA
          tokens_da_scalare = tokens_da_scalare + 1
      FINE SE

      // Tagging opzionale = 1 token se eseguito
      SE (tags != NULL) ALLORA
          tokens_da_scalare = tokens_da_scalare + 1
      FINE SE

      // Casi GRATIS (0 token):
      // - crowd_scene senza tagging → nessuna operazione di riconoscimento
      // - Qualsiasi scene dove detector non trova soggetti e no tagging
      // - Scene classification da sola è sempre gratuita (gate decisionale)

      SE (tokens_da_scalare > 0) ALLORA
          ESEGUI TOKEN_DEDUCTION(tokens_da_scalare)
      FINE SE

      // RIEPILOGO COSTI:
      // | Operazione           | Token |
      // |----------------------|-------|
      // | Scene Classification | 0     | (gate decisionale gratuito)
      // | Detector (no results)| 0     | (nessun soggetto trovato)
      // | Gemini (V3/V6)       | 1     | (cloud API)
      // | ONNX Recognition     | 1     | (ripaga training modello)
      // | Face-API             | 1     | (ripaga training modello)
      // | Tagging              | 1     | (cloud API)

      // Salva risultato per aggregazione batch
      risultati_batch.push({
          immagine: immagine,
          risultati: risultati_matchati,
          cluster_id: GET_CLUSTER_ID(immagine, clusters)
      })

  FINE PER OGNI  // Fine loop immagini

  // ============================================================
  // FASE 3: POST-PROCESSING BATCH (dopo tutte le immagini)
  // ============================================================

  // Propagazione risultati tra cluster temporali (se attivo)
  SE (temporal_clustering_attivo) ALLORA
      risultati_batch = ESEGUI PROPAGAZIONE_CLUSTER(risultati_batch, clusters)
      // Propaga numeri riconosciuti a foto vicine nel cluster
      // Es: se foto 1,2,3 sono burst e solo foto 2 ha numero chiaro,
      //     propaga a foto 1 e 3
  FINE SE

  // Genera report finale esecuzione
  report = GENERA REPORT_ESECUZIONE(risultati_batch)

  RETURN report

FINE ESECUZIONE


// ============================================================
// MATRICE DECISIONALE SCENE CLASSIFICATION
// ============================================================
//
// | Scene Type          | Detector | Gemini/ONNX | Face API | Tagging |
// |---------------------|----------|-------------|----------|---------|
// | racing_action       | se crop  | SI          | NO       | opz.    |
// | garage_pitlane      | se crop  | SI          | SI       | opz.    |
// | podium_celebration  | se crop  | SI          | SI       | opz.    |
// | portrait_paddock    | se crop  | SI          | SI       | opz.    |
// | crowd_scene         | NO       | NO          | NO       | opz.    |
// | NULL (sc disabled)  | se crop  | SI          | config   | opz.    |
//
// ============================================================


// ============================================================
// MATRICE COMPLETA COSTI TOKEN
// ============================================================
// Ogni operazione di riconoscimento = 1 token
// Scene Classification e Detector senza risultati = GRATIS
// ============================================================
//
// RACING_ACTION:
// | Detection | Method | Face-API | Tagging | TOTALE | Note                    |
// |-----------|--------|----------|---------|--------|-------------------------|
// | NO        | -      | NO       | NO      | 0      | Nessun soggetto trovato |
// | NO        | -      | NO       | SI      | 1      | Solo tagging            |
// | SI        | gemini | NO       | NO      | 1      | Solo numeri (cloud)     |
// | SI        | gemini | NO       | SI      | 2      | Numeri + tagging        |
// | SI        | onnx   | NO       | NO      | 1      | Solo numeri (locale)    |
// | SI        | onnx   | NO       | SI      | 2      | Numeri + tagging        |
//
// GARAGE_PITLANE:
// | Detection | Method | Face-API | Tagging | TOTALE | Note                    |
// |-----------|--------|----------|---------|--------|-------------------------|
// | NO        | -      | SI       | NO      | 1      | Solo volti              |
// | NO        | -      | SI       | SI      | 2      | Volti + tagging         |
// | SI        | gemini | SI       | NO      | 2      | Numeri + volti          |
// | SI        | gemini | SI       | SI      | 3      | Numeri + volti + tag    |
// | SI        | onnx   | SI       | NO      | 2      | Numeri + volti          |
// | SI        | onnx   | SI       | SI      | 3      | Numeri + volti + tag    |
//
// PODIUM_CELEBRATION:
// | Detection | Method | Face-API | Tagging | TOTALE | Note                    |
// |-----------|--------|----------|---------|--------|-------------------------|
// | NO        | -      | SI       | NO      | 1      | Solo volti              |
// | NO        | -      | SI       | SI      | 2      | Volti + tagging         |
// | SI        | gemini | SI       | NO      | 2      | Numeri + volti          |
// | SI        | gemini | SI       | SI      | 3      | Numeri + volti + tag    |
// | SI        | onnx   | SI       | NO      | 2      | Numeri + volti          |
// | SI        | onnx   | SI       | SI      | 3      | Numeri + volti + tag    |
//
// PORTRAIT_PADDOCK:
// | Detection | Method | Face-API | Tagging | TOTALE | Note                    |
// |-----------|--------|----------|---------|--------|-------------------------|
// | NO        | -      | SI       | NO      | 1      | Solo volti              |
// | NO        | -      | SI       | SI      | 2      | Volti + tagging         |
// | SI        | gemini | SI       | NO      | 2      | Numeri + volti          |
// | SI        | gemini | SI       | SI      | 3      | Numeri + volti + tag    |
// | SI        | onnx   | SI       | NO      | 2      | Numeri + volti          |
// | SI        | onnx   | SI       | SI      | 3      | Numeri + volti + tag    |
//
// CROWD_SCENE:
// | Detection | Method | Face-API | Tagging | TOTALE | Note                    |
// |-----------|--------|----------|---------|--------|-------------------------|
// | -         | -      | NO       | NO      | 0      | Nessuna operazione      |
// | -         | -      | NO       | SI      | 1      | Solo tagging            |
//
// SCENE CLASSIFICATION DISABILITATA (NULL):
// | Detection | Method | Face-API | Tagging | TOTALE | Note                    |
// |-----------|--------|----------|---------|--------|-------------------------|
// | NO        | -      | config   | NO      | 0-1    | Dipende da config       |
// | NO        | -      | config   | SI      | 1-2    | Dipende da config       |
// | SI        | gemini | config   | NO      | 1-2    | Dipende da config       |
// | SI        | gemini | config   | SI      | 2-3    | Dipende da config       |
// | SI        | onnx   | config   | NO      | 1-2    | Dipende da config       |
// | SI        | onnx   | config   | SI      | 2-3    | Dipende da config       |
//
// ============================================================
// RIEPILOGO COSTI PER OPERAZIONE:
// ============================================================
// | Operazione               | Costo Token | Note                      |
// |--------------------------|-------------|---------------------------|
// | Scene Classification     | 0           | Gate decisionale gratuito |
// | Detector (eseguito)      | 0           | Locale, sempre gratuito   |
// | Detector (no results)    | 0           | Nessun soggetto = gratis  |
// | Gemini V3/V6             | 1           | Cloud API                 |
// | ONNX Recognition         | 1           | Ripaga training modello   |
// | Face-API                 | 1           | Ripaga training modello   |
// | Tagging                  | 1           | Cloud API                 |
// ============================================================


// ============================================================
// FUNZIONE: SCRITTURA_XMP_O_EXIF
// ============================================================
// Gestisce la scrittura dei metadata su file immagine
// Decide autonomamente formato (XMP sidecar vs EXIF embedded)
// e contenuto in base a tipo file e configurazioni
// ============================================================

FUNZIONE SCRITTURA_XMP_O_EXIF(immagine_path, risultati)

    // ----------------------------------------------------------
    // 1. DETERMINA FORMATO OUTPUT
    // ----------------------------------------------------------

    estensione = GET_EXTENSION(immagine_path)

    SE (estensione IN [".nef", ".arw", ".cr2", ".cr3", ".orf", ".raw", ".rw2", ".dng"]) ALLORA
        // File RAW → sempre XMP sidecar (non toccare l'originale)
        formato_output = "XMP_SIDECAR"
        xmp_path = REPLACE_EXTENSION(immagine_path, ".xmp")
    ALTRIMENTI SE (estensione IN [".jpg", ".jpeg"]) ALLORA
        // JPEG → preferenza utente (default: XMP sidecar per sicurezza)
        SE (user_config.embed_metadata_in_jpeg) ALLORA
            formato_output = "EXIF_EMBEDDED"
        ALTRIMENTI
            formato_output = "XMP_SIDECAR"
            xmp_path = REPLACE_EXTENSION(immagine_path, ".xmp")
        FINE SE
    ALTRIMENTI
        // PNG, WebP, altri → XMP sidecar
        formato_output = "XMP_SIDECAR"
        xmp_path = REPLACE_EXTENSION(immagine_path, ".xmp")
    FINE SE

    // ----------------------------------------------------------
    // 2. PREPARA DATI DA SCRIVERE
    // ----------------------------------------------------------

    metadata = {
        keywords: [],
        description: NULL,
        caption: NULL,
        title: NULL,
        creator: NULL,
        copyright: NULL
    }

    // 2.1: Keywords da numeri riconosciuti
    SE (risultati.numeri != NULL) ALLORA
        PER OGNI numero IN risultati.numeri:
            metadata.keywords.push(numero.race_number)
            SE (numero.driver_name != NULL) ALLORA
                metadata.keywords.push(numero.driver_name)
            FINE SE
            SE (numero.team_name != NULL) ALLORA
                metadata.keywords.push(numero.team_name)
            FINE SE
        FINE PER
    FINE SE

    // 2.2: Keywords da Face Recognition
    SE (risultati.volti != NULL) ALLORA
        PER OGNI volto IN risultati.volti:
            SE (volto.identified_name != NULL) ALLORA
                metadata.keywords.push(volto.identified_name)
            FINE SE
        FINE PER
    FINE SE

    // 2.3: Tags opzionali
    SE (risultati.tags != NULL) ALLORA
        metadata.keywords = metadata.keywords.concat(risultati.tags)
    FINE SE

    // 2.4: Scene type come keyword
    SE (risultati.scene_type != NULL) ALLORA
        metadata.keywords.push(risultati.scene_type)
    FINE SE

    // 2.5: Metatag da participant preset (se matchato)
    SE (risultati.matched_participant != NULL) ALLORA
        participant = risultati.matched_participant

        // Metatag custom dal preset
        SE (participant.metatag != NULL E participant.metatag != "") ALLORA
            metadata.keywords.push(participant.metatag)
        FINE SE

        // Sponsor come keyword
        SE (participant.sponsor != NULL) ALLORA
            metadata.keywords.push(participant.sponsor)
        FINE SE

        // Categoria come keyword
        SE (participant.categoria != NULL) ALLORA
            metadata.keywords.push(participant.categoria)
        FINE SE

        // Squadra come keyword
        SE (participant.squadra != NULL) ALLORA
            metadata.keywords.push(participant.squadra)
        FINE SE
    FINE SE

    // 2.6: Description/Caption
    SE (risultati.numeri != NULL E risultati.numeri.length > 0) ALLORA
        // Genera descrizione automatica
        numeri_lista = risultati.numeri.map(n => n.race_number).join(", ")
        metadata.description = "Race numbers: " + numeri_lista

        // Caption più dettagliato se abbiamo match
        SE (risultati.matched_participant != NULL) ALLORA
            p = risultati.matched_participant
            metadata.caption = "#" + p.numero + " " + p.nome
            SE (p.squadra != NULL) ALLORA
                metadata.caption = metadata.caption + " - " + p.squadra
            FINE SE
        FINE SE
    FINE SE

    // ----------------------------------------------------------
    // 3. RIMUOVI DUPLICATI E NORMALIZZA
    // ----------------------------------------------------------

    metadata.keywords = UNIQUE(metadata.keywords)
    metadata.keywords = FILTER_EMPTY(metadata.keywords)
    metadata.keywords = TRIM_ALL(metadata.keywords)

    // ----------------------------------------------------------
    // 4. SCRIVI METADATA
    // ----------------------------------------------------------

    SE (formato_output == "XMP_SIDECAR") ALLORA

        // Controlla se esiste già un file XMP
        SE (FILE_EXISTS(xmp_path)) ALLORA
            // Leggi XMP esistente e preserva altri metadata
            xmp_esistente = LEGGI_XMP(xmp_path)
            xmp_merged = MERGE_XMP(xmp_esistente, metadata)
            SCRIVI_XMP(xmp_path, xmp_merged)
        ALTRIMENTI
            // Crea nuovo file XMP
            SCRIVI_XMP(xmp_path, metadata)
        FINE SE

        LOG("[Metadata] XMP sidecar creato/aggiornato: " + xmp_path)

    ALTRIMENTI SE (formato_output == "EXIF_EMBEDDED") ALLORA

        // Scrivi direttamente nel file JPEG usando ExifTool
        SCRIVI_EXIF(immagine_path, metadata)

        LOG("[Metadata] EXIF embedded in: " + immagine_path)

    FINE SE

    // ----------------------------------------------------------
    // 5. VERIFICA SCRITTURA (opzionale)
    // ----------------------------------------------------------

    SE (user_config.verify_metadata_write) ALLORA
        SE (formato_output == "XMP_SIDECAR") ALLORA
            verificato = VERIFICA_XMP(xmp_path, metadata.keywords)
        ALTRIMENTI
            verificato = VERIFICA_EXIF(immagine_path, metadata.keywords)
        FINE SE

        SE (!verificato) ALLORA
            LOG_WARNING("[Metadata] Verifica fallita per: " + immagine_path)
        FINE SE
    FINE SE

    RETURN {
        success: true,
        formato: formato_output,
        keywords_count: metadata.keywords.length,
        path: (formato_output == "XMP_SIDECAR") ? xmp_path : immagine_path
    }

FINE FUNZIONE


// ============================================================
// FUNZIONE: MERGE_XMP (preserva metadata esistenti)
// ============================================================

FUNZIONE MERGE_XMP(xmp_esistente, nuovi_metadata)

    merged = CLONE(xmp_esistente)

    // Aggiungi nuove keywords senza duplicare
    SE (nuovi_metadata.keywords.length > 0) ALLORA
        keywords_esistenti = merged.keywords OR []
        merged.keywords = UNIQUE(keywords_esistenti.concat(nuovi_metadata.keywords))
    FINE SE

    // Aggiorna description solo se non presente o vuota
    SE (nuovi_metadata.description != NULL) ALLORA
        SE (merged.description == NULL OR merged.description == "") ALLORA
            merged.description = nuovi_metadata.description
        FINE SE
    FINE SE

    // Aggiorna caption solo se non presente o vuota
    SE (nuovi_metadata.caption != NULL) ALLORA
        SE (merged.caption == NULL OR merged.caption == "") ALLORA
            merged.caption = nuovi_metadata.caption
        FINE SE
    FINE SE

    // Preserva sempre: creator, copyright, rating, altri metadata
    // Non sovrascrivere mai questi campi

    // Aggiorna timestamp modifica
    merged.metadata_date = NOW()

    RETURN merged

FINE FUNZIONE


// ============================================================
// NOTE TECNICHE
// ============================================================
//
// IMMAGINI UTILIZZATE:
//   - immagine_originale: File RAW/JPEG originale ad alta risoluzione
//   - immagine_locale: Caricata in memoria per analisi locale (scene, detector, face)
//   - immagine_resized: Compressa per upload storage (max 2048px)
//   - crops[]: Ritagli ad alta risoluzione estratti da immagine_originale
//   - negative: Immagine con soggetti mascherati per contesto
//
// RECOGNITION_METHOD:
//   - "gemini": Usa edge function V6 (con crop) o V3 (senza crop) - CLOUD
//   - "onnx": Usa modello ONNX locale - OFFLINE
//
// DETECTOR_CLASSES (configurabili per sport_category):
//   - "vehicle"     → Auto/moto da corsa (F1, MotoGP, Rally, GT)
//   - "bike_rider"  → Ciclisti (strada, MTB, BMX, pista)
//   - "runner"      → Corridori (maratona, trail, atletica)
//   - "player"      → Giocatori sport di squadra (calcio, basket, volley, rugby)
//   - Supporto array per sport ibridi: ["vehicle", "bike_rider"] per motocross
//   - Il modello ONNX deve essere trainato su tutte le classi possibili
//   - La selezione avviene filtrando i risultati per classe
//
// PARALLELIZZAZIONE:
//   - Livello batch: ogni immagine può essere elaborata in parallelo
//   - Livello immagine: upload e preparazione locale in parallelo
//   - Rate limiting: rispettare limiti API per chiamate cloud
//
// ============================================================


// ============================================================
// STATO IMPLEMENTAZIONE (Dicembre 2024)
// ============================================================
// Confronto tra pseudocodifica e codice attuale
// ============================================================

// ┌─────────────────────────────────────────────────────────────┐
// │                    GIÀ IMPLEMENTATO ✅                      │
// └─────────────────────────────────────────────────────────────┘
//
// FASE 0 - SETUP
// ✅ Caricamento sport_category_config da Supabase
// ✅ Caricamento participant_preset
// ✅ Configurazione crop_enabled, recognition_method
// ✅ Configurazione scene_classification, temporal_clustering
//    File: src/unified-image-processor.ts
//
// FASE 1 - TEMPORAL CLUSTERING
// ✅ Estrazione timestamp EXIF con ExifTool
// ✅ Raggruppamento immagini in cluster (clusterWindow configurabile)
// ✅ Rilevamento burst mode (burstThreshold 500ms)
// ✅ Cache risultati clustering
//    File: src/temporal-clustering.ts
//
// FASE 2.1 - PREPARAZIONE IMMAGINE
// ✅ Conversione RAW → JPEG (dcraw + Sharp fallback)
// ✅ Resize per upload storage
// ✅ Caricamento immagine locale alta risoluzione
//    File: src/unified-image-processor.ts, main.ts IPC handlers
//
// FASE 2.2 - SCENE CLASSIFICATION
// ✅ Modello TensorFlow.js ResNet18 (11MB, 87.68% accuracy)
// ✅ 5 categorie: racing_action, garage_pitlane, podium_celebration,
//                 portrait_paddock, crowd_scene
// ✅ Output: category, confidence, allPredictions
// ✅ Gate decisionale per routing flusso
//    File: src/scene-classifier.ts, src/scene-classifier-onnx.ts
//
// FASE 2.3 - RICONOSCIMENTO NUMERI
// ✅ Skip automatico per crowd_scene (confidence > 75%)
// ✅ Detector ONNX per bounding boxes
// ✅ Crop Context Extractor (crops + negative)
// ✅ Gemini V6 per analisi crops (cloud)
// ✅ Gemini V3 per immagine intera (cloud)
// ✅ ONNX Recognition locale
// ✅ Routing basato su recognition_method
//    File: src/unified-image-processor.ts, src/onnx-detector.ts,
//          src/utils/crop-context-extractor.ts,
//          supabase/functions/analyzeImageDesktopV6/index.ts
//
// FASE 2.4 - FACE RECOGNITION
// ✅ Attivo per: garage_pitlane, podium_celebration, portrait_paddock
// ✅ Disattivo per: racing_action, crowd_scene
// ✅ Integrazione risultati con numeri gara
//    File: src/unified-image-processor.ts, src/face-recognition-processor.ts
//
// FASE 2.6 - POST-PROCESSING IMMAGINE
// ✅ Combinazione risultati (numeri, volti, scene_type)
// ✅ SmartMatcher con preset partecipanti
// ✅ Matching fuzzy + evidenza multipla (sponsor, team, categoria)
// ✅ Scrittura XMP sidecar (RAW files)
// ✅ Merge metadata preservando esistenti
//    File: src/smart-matcher.ts, src/utils/xmp-manager.ts
//
// FASE 3 - POST-PROCESSING BATCH
// ✅ Temporal bonus in matching (non vera propagazione)
// ✅ Aggregazione risultati per batch
// ✅ Report esecuzione
//    File: src/temporal-clustering.ts, src/smart-matcher.ts
//
// FUNZIONE SCRITTURA_XMP_O_EXIF
// ✅ Determinazione formato (RAW→XMP, JPEG→config)
// ✅ Preparazione metadata da risultati
// ✅ Merge XMP preservando metadata esistenti
//    File: src/utils/xmp-manager.ts


// ┌─────────────────────────────────────────────────────────────┐
// │                   DA IMPLEMENTARE 🔧                        │
// └─────────────────────────────────────────────────────────────┘
//
// FASE 0 - SETUP
// 🔧 detector_classes configurabili per sport_category
//    Attuale: hardcoded nei modelli ONNX
//    Target: campo in sport_categories, filtro dinamico
//
// FASE 2.1 - PREPARAZIONE IMMAGINE
// 🔧 Parallelizzazione upload + preparazione locale
//    Attuale: sequenziale
//    Target: IN PARALLELO come da pseudocodifica
// 🔧 Max dimension 2048px (attuale: 1920px)
//
// FASE 2.5 - TAGGING OPZIONALE
// 🔧 Flag tagging_enabled in sport_categories
// 🔧 UI per richiesta tagging da utente
// 🔧 Chiamata API tagging (max 10 keywords inglese)
// 🔧 Integrazione keywords in risultati
//    Priorità: BASSA (feature opzionale futura)
//
// FASE 3 - POST-PROCESSING BATCH
// 🔧 Vera propagazione risultati tra cluster
//    Attuale: bonus matching temporale
//    Target: "se foto 2 ha numero, propaga a foto 1 e 3 del cluster"
//
// TOKEN DEDUCTION
// 🔧 Sistema centralizzato di scalatura token
// 🔧 Logica dinamica basata su operazioni eseguite
// 🔧 TokenService in src/services/token-service.ts
//    Costi: Scene=0, Detector=0, Gemini=1, ONNX=1, Face=1, Tag=1
//
// FUNZIONE SCRITTURA_XMP_O_EXIF
// 🔧 Verifica scrittura (user_config.verify_metadata_write)


// ┌─────────────────────────────────────────────────────────────┐
// │                 DIFFERENZE ARCHITETTURALI                   │
// └─────────────────────────────────────────────────────────────┘
//
// | Aspetto              | Pseudocodifica      | Codice Attuale       |
// |----------------------|---------------------|----------------------|
// | Detection            | Bounding Box only   | + Segmentation masks |
// | Propagazione cluster | Vera propagazione   | Bonus matching       |
// | Parallelizzazione    | Upload || Local     | Sequenziale          |
// | Max dimension        | 2048px              | 1920px               |
// | Token system         | Centralizzato       | Non implementato     |
//
// ============================================================
// CONFORMITÀ COMPLESSIVA: ~85% (flusso core completo)
// ============================================================
