Racetagger: Advanced Recognition Engine Implementation Plan


1. Project Overview
Primary Goal: To evolve the Racetagger application from a basic OCR tool into an intelligent, context-aware photo tagging system. This will be achieved by integrating user-managed participant datasets ("Presets") and implementing a sophisticated, confidence-based scoring engine.
Core Problem to Solve: Automate the accurate identification of race participants in large volumes of photos, even when facing imperfect OCR data or missing primary identifiers (like a race number). The system must leverage a richer set of contextual clues (sponsors, names, team info) to maximize accuracy.
Key Outcome: A powerful workflow where high-confidence matches are tagged automatically, medium-confidence matches are flagged with specific keywords for efficient user review (compatible with Lightroom/Photo Mechanic), and unmatched photos are tagged for easy filtering.
2. System Architecture: Core Modules & Sub-Agents
The project is broken down into three core modules, which can be conceptualized as specialized "sub-agents" working in concert.
Module A: Data Management Sub-Agent (CRUD & Presets)
Objective: To handle all aspects of creating, reading, updating, deleting (CRUD), and managing participant data lists, known as "Presets". This module serves as the single source of truth for the recognition engine.
Key Responsibilities:
Provide a user-friendly, table-based UI for manual data entry and editing.
Implement robust local storage for all data using IndexedDB to ensure offline availability.
Manage the lifecycle of Presets (create, load, list, delete).
Provide a CSV import feature with column mapping for seamless data ingestion.
Detailed Task Breakdown:
UI/UX Design:
Design the data table layout (columns: RaceNumber, FirstName, LastName, CoDriver, Sponsors, CustomTags, etc.).
Design UI controls: "Add Row", "Delete Row", "Import CSV", "Save as Preset".
Design the Preset management interface (a list of saved presets with "Load" and "Delete" options).
Frontend Development (Interactive Table):
Implement the HTML/CSS/JS for the data grid.
Enable in-place cell editing functionality.
Code the logic to dynamically add/remove rows from the UI and the underlying data model.
Backend Logic (Local Storage):
Implement wrapper functions for IndexedDB to handle Presets: savePreset(name, data), loadPreset(name), listPresets(), deletePreset(name).
CSV Import Logic:
Develop a CSV parsing function.
Build the UI for mapping CSV columns to the application's data fields.
Implement data validation logic on import (e.g., check for duplicate race numbers).
Module B: Recognition & Scoring Sub-Agent (The "Brain")
Objective: To analyze the OCR-extracted text from a given photo and calculate a confidence score for every participant in the active Preset. This agent determines the most likely match.
Key Responsibilities:
Pre-process the loaded Preset data for efficient searching.
Implement the core scoring algorithm based on a weighted ruleset.
Integrate a fuzzy matching library to handle OCR inaccuracies.
Return a ranked list of potential matches with their calculated scores.
Detailed Task Breakdown:
Preset Data Pre-processing:
On Preset load, create optimized lookup tables/maps. Crucial for performance.
Pre-calculate and cache:
A set of unique sponsors (those belonging to only one participant).
A set of unique full names, initial/last name combos, and last names.
A map of sponsor combinations that are unique to a single participant.
Scoring Engine Development:
Create the core function: calculateScores(ocrTextArray, presetData).
Implement Scoring Rules (Weights can be tweaked):
+105 points: Exact match on a unique FirstName + LastName combination (e.g., "Federico Pasinetti"). This is now the highest confidence signal.
+100 points: Exact match on RaceNumber. Remains a very strong signal.
+85 points: Exact match on a unique Initial. LastName combination (e.g., "F. Pasinetti"). Very reliable.
+70 points: Exact match on a pre-calculated unique sponsor.
+60 points: Exact match on a unique LastName only. A good signal, but less reliable than the full name.
+15 to +40 points: Fuzzy match on a name or sponsor. The score should be proportional to the similarity score (e.g., a Levenshtein distance of 1 gets more points than a distance of 3).
+10 points: Match on a generic (non-unique) sponsor or custom tag. This acts as a tie-breaker.
Fuzzy Matching Integration:
Integrate a lightweight fuzzy search library (e.g., fuse.js).
Configure the library with appropriate thresholds to avoid false positives.
Pseudo-code for the Scoring Loop:
  function getBestMatch(ocrTexts, presetParticipants) {
      let scores = new Map(); // participantId -> score

      for (const participant of presetParticipants) {
          let currentScore = 0;

          // Rule 1 (NEW): Full Name Match
          const fullName = `${participant.firstName} ${participant.lastName}`;
          if (isUnique(fullName) && ocrTexts.includes(fullName)) {
              currentScore += 105;
          }

          // Rule 2: Race Number
          if (ocrTexts.includes(participant.raceNumber)) {
              currentScore += 100;
          }

          // Rule 3 (NEW): Initial. LastName Match
          const initialName = `${participant.firstName[0]}. ${participant.lastName}`;
           if (isUnique(initialName) && ocrTexts.includes(initialName)) {
              currentScore += 85;
          }

          // ... apply all other scoring rules ...

          // Rule 6: Fuzzy Matching
          for (const text of ocrTexts) {
              let fuzzyScore = calculateFuzzyMatchScore(text, participant.sponsors);
              currentScore += fuzzyScore;
          }
          scores.set(participant.id, currentScore);
      }

      // Find the participant with the highest score
      let bestMatch = findMaxScoringParticipant(scores);
      return bestMatch;
  }


Module C: Tagging & Workflow Sub-Agent
Objective: To take the scoring results from Module B and apply the appropriate metadata keywords to the photo, creating a seamless workflow for the end-user.
Key Responsibilities:
Implement the decision logic based on pre-defined score thresholds.
Construct the final keyword list for each photo.
Interface with the file system or photo library to write the metadata.
Detailed Task Breakdown:
Implement Confidence Threshold Logic:
Write the code that processes the final candidate from Module B.
High Confidence (Score > 95): The match is considered certain. Note: Threshold is slightly increased due to higher top scores.
Action: Generate a full list of keywords from the participant's data (e.g., "John Doe", "Team Racing", "SponsorX", "Race123").
Medium Confidence (50 <= Score <= 95): The match is likely but requires user verification.
Action: Generate keywords: "VERIFY-MATCH", "SUGGESTION: John Doe".
No Match (Score < 50): No confident match was found.
Action: Generate keywords: "NO-MATCH" plus all raw text fragments detected by OCR (e.g., "NO-MATCH", "P1RELLI", "FASTCAR").
Metadata Writing:
Implement the function that takes the generated keyword list and writes it to the photo's metadata (e.g., IPTC Keywords).
3. Implementation Roadmap & Milestones
Milestone 1: Build & Test Module A
Goal: A fully functional, standalone data management system. Users should be able to create, edit, import, and manage presets.
Milestone 2: Build & Test Module B
Goal: A robust scoring engine that can be tested in isolation. Create unit tests with mock OCR data and presets to validate the scoring logic.
Milestone 3: Full System Integration & Testing
Goal: A complete, end-to-end application.
Tasks:
Connect the UI (Module A) to the engine (Module B & C).
Perform extensive real-world testing with large photo sets and complex race data.
Conduct performance testing to ensure the pre-processing and scoring are fast enough.
Refine the UI/UX based on testing feedback, adding loading indicators, error messages, and tooltips.
4. Deployment & Rollout Strategy (NEW SECTION)
Objective: To deploy all new features without disrupting the existing production service. All development will follow a phased, safety-first approach.
Key Principles:
Additive Database Changes: New features will use new tables/collections (e.g., user_presets) to avoid any impact on the existing data structures relied upon by the current application.
Parallel Backend Endpoints: New logic will be deployed to new API endpoints (e.g., /api/v2/recognize). The existing production endpoints will not be modified.
Frontend Feature Flags: The new user interface and features will be enabled on a per-user basis using a "feature flag" (e.g., hasBetaAccess). This allows for a controlled, gradual rollout, starting with internal testing and expanding to a wider beta group before a full public release.
A more detailed deployment plan is available in the "Racetagger Deployment Strategy" document.


Piano di Sviluppo Completo: Racetagger Motore di Riconoscimento Avanzato
1. Panoramica del Progetto
Obiettivo Primario: Evolvere l'applicazione Racetagger da uno strumento OCR di base a un sistema di tagging fotografico intelligente e contestuale. Questo risultato sarà raggiunto integrando set di dati gestiti dall'utente ("Preset") e implementando un sofisticato motore di punteggio basato sulla confidenza del match.

Problema Centrale da Risolvere: Automatizzare l'identificazione accurata dei partecipanti in grandi volumi di foto, anche in presenza di dati OCR imperfetti o identificatori primari mancanti (come il numero di gara). Il sistema dovrà sfruttare un set più ricco di indizi contestuali (sponsor, nomi, informazioni sul team) per massimizzare l'accuratezza.

Risultato Chiave: Un flusso di lavoro potente in cui i match ad alta confidenza vengono taggati automaticamente, i match a media confidenza vengono segnalati con keyword specifiche per una revisione efficiente da parte dell'utente (compatibile con Lightroom/Photo Mechanic), e le foto senza corrispondenza vengono taggate per un facile filtraggio.

2. Architettura del Sistema: Moduli Principali & Sub-Agents
Il progetto è suddiviso in tre moduli principali, che possono essere visti come "sub-agents" specializzati che lavorano in sinergia.

Modulo A: Gestione Dati (CRUD & Presets)
Obiettivo: Gestire tutti gli aspetti di creazione, lettura, aggiornamento, eliminazione (CRUD) e gestione delle liste di dati dei partecipanti, denominate "Preset". Questo modulo funge da unica fonte di verità per il motore di riconoscimento.

Responsabilità Chiave:

Fornire un'interfaccia utente tabellare e intuitiva per l'inserimento e la modifica manuale dei dati.

Implementare uno storage locale robusto per tutti i dati utilizzando IndexedDB per garantire la disponibilità offline.

Gestire il ciclo di vita dei Preset (crea, carica, elenca, elimina).

Fornire una funzionalità di importazione CSV con mappatura delle colonne per un'acquisizione fluida dei dati.

Modulo B: Riconoscimento & Punteggio (Il "Cervello")
Obiettivo: Analizzare il testo estratto tramite OCR da una data foto e calcolare un punteggio di confidenza per ogni partecipante nel Preset attivo. Questo agente determina la corrispondenza più probabile.

Responsabilità Chiave:

Pre-elaborare i dati del Preset caricato per una ricerca efficiente.

Implementare l'algoritmo di punteggio principale basato su un set di regole pesate.

Integrare una libreria di "fuzzy matching" per gestire le imprecisioni dell'OCR.

Restituire una lista ordinata di potenziali corrispondenze con i loro punteggi calcolati.

Dettaglio dell'Implementazione (Regole di Punteggio):

+105 punti: Corrispondenza esatta su una combinazione unica di Nome + Cognome (es. "Federico Pasinetti"). Questo è ora il segnale di massima confidenza.

+100 punti: Corrispondenza esatta sul NumeroGara. Rimane un segnale molto forte.

+85 punti: Corrispondenza esatta su una combinazione unica di Iniziale. Cognome (es. "F. Pasinetti"). Molto affidabile.

+70 punti: Corrispondenza esatta su uno sponsor unico pre-calcolato.

+60 punti: Corrispondenza esatta su un Cognome unico. Un buon segnale, ma meno affidabile del nome completo.

+15 a +40 punti: Corrispondenza "fuzzy" (approssimativa) su un nome o sponsor. Il punteggio deve essere proporzionale al grado di somiglianza.

+10 punti: Corrispondenza su uno sponsor generico (non unico) o un tag personalizzato. Agisce come spareggio.

Modulo C: Tagging & Workflow
Obiettivo: Prendere i risultati del punteggio dal Modulo B e applicare le keyword di metadati appropriate alla foto, creando un flusso di lavoro ottimale per l'utente finale.

Responsabilità Chiave:

Implementare la logica decisionale basata su soglie di punteggio predefinite.

Costruire la lista finale di keyword per ogni foto.

Interfacciarsi con il sistema per scrivere i metadati.

Dettaglio della Logica di Tagging:

Alta Confidenza (Punteggio > 95): Il match è considerato certo.

Azione: Genera una lista completa di keyword dai dati del partecipante (es. "Federico Pasinetti", "Team Racing", "SponsorX", "Gara123").

Media Confidenza (50 <= Punteggio <= 95): Il match è probabile ma richiede una verifica da parte dell'utente.

Azione: Genera le keyword: "VERIFY-MATCH", "SUGGESTION: Federico Pasinetti".

Nessuna Corrispondenza (Punteggio < 50): Non è stato trovato alcun match affidabile.

Azione: Genera le keyword: "NO-MATCH" più tutti i frammenti di testo grezzi rilevati dall'OCR (es. "NO-MATCH", "P1RELLI", "FASTCAR").

3. Roadmap di Implementazione & Milestones
Milestone 1: Costruzione e Test del Modulo A

Obiettivo: Un sistema di gestione dati completamente funzionale e autonomo. Gli utenti devono poter creare, modificare, importare e gestire i preset.

Milestone 2: Costruzione e Test del Modulo B

Obiettivo: Un motore di punteggio robusto che possa essere testato in isolamento. Creare unit test con dati OCR fittizi e preset per validare la logica di scoring.

Milestone 3: Integrazione Completa del Sistema e Test

Obiettivo: Un'applicazione completa end-to-end.

Task:

Collegare l'interfaccia utente (Modulo A) con il motore (Modulo B & C).

Eseguire test approfonditi in scenari reali con grandi set di foto e dati di gara complessi.

Condurre test di performance per assicurare che la pre-elaborazione e lo scoring siano sufficientemente veloci.

4. Strategia di Deployment e Rollout
Principio Guida: Implementare tutte le nuove funzionalità in un ambiente controllato (beta), garantendo zero impatti sul servizio di produzione esistente. Il passaggio alla nuova versione avverrà solo dopo test approfonditi e validazione.

Fase 1: Backend e Database - Modifiche Additive
Database (Approccio Integrativo):

Non modificare tabelle/collezioni esistenti.

Creare Nuove Collezioni/Tabelle: Verrà creata una nuova collezione dedicata (es. user_presets) per i dati delle nuove funzionalità. La versione attuale dell'app la ignorerà.

API / Edge Functions (Endpoints Paralleli):

Mantenere gli Endpoints Esistenti: Le funzioni attuali (es. POST /api/recognize) non verranno toccate.

Creare Nuovi Endpoints per la Beta: Verrà creato un nuovo endpoint (es. POST /api/v2/recognize) che conterrà la nuova logica, isolando il nuovo codice.

Fase 2: Frontend - Integrazione tramite "Feature Flags"
Cos'è un Feature Flag?

Un "interruttore" nel profilo utente (es. hasBetaAccess: true/false) che abilita o disabilita una funzionalità.

Implementazione:

Al login, l'app controlla il flag.

Se true: L'utente vede la nuova interfaccia e l'app chiama i nuovi endpoint /v2/.

Se false: L'utente vede l'interfaccia classica e l'app continua a usare i vecchi endpoint.

Vantaggi: Controllo granulare, rollout progressivo e rollback istantaneo per i singoli utenti.

Fase 3: Rollout Finale e Deprecazione
Raccolta Feedback: Si raccolgono i dati dalla fase beta per risolvere bug e migliorare la funzionalità.

Migrazione Globale: Una volta che la nuova versione è stabile, il nuovo flusso di lavoro diventa lo standard per tutti.

Deprecazione: Dopo un periodo di transizione, le vecchie API e la vecchia logica possono essere dismesse.