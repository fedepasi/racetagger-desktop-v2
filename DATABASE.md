# DATABASE.md - Schema Supabase RaceTagger

Documentazione completa dello schema del database Supabase e delle Edge Functions.

**Progetto Supabase:** `taompbzifylmdzgbbrpv`
**Ultimo aggiornamento:** 2025-12-30

---

## Indice

1. [Tabelle Core](#1-tabelle-core)
2. [Sistema Token e Pagamenti](#2-sistema-token-e-pagamenti)
3. [Sistema Analisi e Risultati](#3-sistema-analisi-e-risultati)
4. [Participant Presets](#4-participant-presets)
5. [Sport Categories e Configurazione](#5-sport-categories-e-configurazione)
6. [Face Recognition](#6-face-recognition)
7. [Test Lab](#7-test-lab)
8. [Private API](#8-private-api)
9. [Sistema Feedback e Rewards](#9-sistema-feedback-e-rewards)
10. [Export e Destinations](#10-export-e-destinations)
11. [Sistema Referral](#11-sistema-referral)
12. [App Version e Configurazione](#12-app-version-e-configurazione)
13. [Tabelle R&D (ZRND_*)](#13-tabelle-rd-zrnd_)
14. [Altre Tabelle](#14-altre-tabelle)
15. [Edge Functions](#15-edge-functions)

---

## 1. Tabelle Core

### `subscribers`
Tabella principale degli utenti/iscritti alla piattaforma.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| email | text | NO | Email univoca |
| name | text | YES | Nome utente |
| position | integer | NO | Posizione in waitlist |
| signup_date | timestamptz | YES | Data iscrizione |
| has_access | boolean | YES | Ha accesso alla piattaforma |
| access_code | text | YES | Codice di accesso utilizzato |
| referral_source | text | YES | Fonte del referral |
| user_id | uuid | YES | FK a auth.users |
| referral_code | uuid | YES | Codice referral personale |
| referred_by | uuid | YES | ID di chi ha referenziato |
| bonus_tokens | integer | YES | Token bonus guadagnati |
| total_referrals | integer | YES | Totale referral effettuati |
| approval_status | text | YES | Stato approvazione |
| approved_by | uuid | YES | Admin che ha approvato |
| approved_at | timestamptz | YES | Data approvazione |
| rejection_reason | text | YES | Motivo rifiuto |
| company | text | YES | Azienda |
| referral_tier | integer | YES | Livello referral |
| milestone_bonuses_earned | integer | YES | Bonus milestone |
| social_shares_count | integer | YES | Condivisioni social |
| feedback_quality_score | numeric | YES | Score qualità feedback |
| trusted_feedback_multiplier | numeric | YES | Moltiplicatore feedback |
| total_social_shares | integer | YES | Totale share social |
| verified_social_shares | integer | YES | Share verificati |
| social_tokens_earned | integer | YES | Token da social |
| registration_status | text | YES | Stato registrazione |
| code_verification_started_at | timestamptz | YES | Inizio verifica codice |
| password_setup_started_at | timestamptz | YES | Inizio setup password |
| registration_completed_at | timestamptz | YES | Completamento registrazione |
| last_activity_at | timestamptz | YES | Ultima attività |
| gift_tokens | integer | YES | Token regalo |
| earned_tokens | integer | YES | Token guadagnati |
| admin_bonus_tokens | integer | YES | Bonus admin |
| base_tokens | integer | YES | Token base |
| stripe_customer_id | text | YES | ID cliente Stripe (prod) |
| stripe_customer_id_test | text | YES | ID cliente Stripe (test) |
| training_consent | boolean | YES | Consenso training AI |
| training_consent_updated_at | timestamptz | YES | Data aggiornamento consenso |
| is_agent | boolean | YES | È un agente |
| commission_rate | numeric | YES | Tasso commissione |
| agent_application_status | text | YES | Stato applicazione agente |

### `projects`
Progetti utente per organizzare le esecuzioni.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| name | text | NO | Nome progetto |
| base_csv_storage_path | text | YES | Path CSV base |
| created_at | timestamptz | NO | Data creazione |
| updated_at | timestamptz | NO | Data aggiornamento |

### `executions`
Singole esecuzioni di analisi immagini.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| project_id | uuid | YES | FK a projects |
| user_id | uuid | NO | FK a auth.users |
| name | text | NO | Nome esecuzione |
| specific_csv_storage_path | text | YES | Path CSV specifico |
| execution_at | timestamptz | NO | Data esecuzione |
| status | text | YES | Stato (pending/running/completed/failed) |
| results_reference | text | YES | Riferimento risultati |
| created_at | timestamptz | NO | Data creazione |
| updated_at | timestamptz | NO | Data aggiornamento |
| processed_images | integer | YES | Immagini processate |
| total_images | integer | YES | Totale immagini |
| category | text | YES | Categoria sport |
| execution_settings | jsonb | YES | Impostazioni JSON |
| system_environment | jsonb | YES | Info sistema |
| performance_breakdown | jsonb | YES | Breakdown performance |
| error_summary | jsonb | YES | Riepilogo errori |
| sport_category_id | uuid | YES | FK a sport_categories |
| memory_stats | jsonb | YES | Statistiche memoria |
| network_stats | jsonb | YES | Statistiche rete |
| completed_at | timestamptz | YES | Data completamento |

### `images`
Immagini caricate per analisi.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | YES | FK a auth.users |
| storage_path | text | NO | Path in Supabase Storage |
| original_filename | text | NO | Nome file originale |
| mime_type | text | YES | Tipo MIME |
| size_bytes | integer | YES | Dimensione in bytes |
| status | text | NO | Stato (pending/analyzed/error) |
| uploaded_at | timestamptz | NO | Data upload |
| updated_at | timestamptz | NO | Data aggiornamento |
| requester_ip | text | YES | IP richiedente |
| requester_geo | jsonb | YES | Geolocalizzazione |
| execution_id | uuid | YES | FK a executions |

### `admin_users`
Utenti amministratori.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | YES | FK a auth.users |
| created_at | timestamptz | YES | Data creazione |

---

## 2. Sistema Token e Pagamenti

### `user_tokens`
Saldo token per utente.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| tokens_purchased | numeric | YES | Token acquistati |
| tokens_used | numeric | YES | Token utilizzati |
| last_updated | timestamptz | YES | Ultimo aggiornamento |

### `token_transactions`
Storico transazioni token.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| amount | integer | NO | Quantità (+ o -) |
| transaction_type | text | NO | Tipo (purchase/usage/bonus/refund) |
| image_id | uuid | YES | FK a images |
| description | text | YES | Descrizione |
| created_at | timestamptz | YES | Data transazione |
| purchase_id | uuid | YES | FK a purchases |

### `token_requests`
Richieste token da parte degli utenti.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | YES | FK a auth.users |
| user_email | text | NO | Email utente |
| tokens_requested | integer | NO | Token richiesti |
| message | text | YES | Messaggio utente |
| request_date | timestamptz | NO | Data richiesta |
| status | text | NO | Stato (pending/approved/rejected) |
| completed_date | timestamptz | YES | Data completamento |
| notes | text | YES | Note admin |
| processed_date | timestamp | YES | Data elaborazione |
| processed_by | uuid | YES | Admin che ha processato |
| payment_received | boolean | YES | Pagamento ricevuto |
| payment_amount | numeric | YES | Importo pagamento |
| payment_date | timestamp | YES | Data pagamento |
| payment_reference | text | YES | Riferimento pagamento |

### `batch_token_reservations`
Pre-autorizzazione token per batch processing (v1.1.0+). Sostituisce il consumo token-by-token con un sistema batch.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| batch_id | text | NO | execution_id del batch (per conteggio da DB) |
| tokens_reserved | integer | NO | Token prenotati all'inizio |
| tokens_consumed | integer | YES | Token effettivamente consumati (default 0) |
| tokens_refunded | integer | YES | Token rimborsati (default 0) |
| status | text | NO | pending/finalized/auto_finalized/expired |
| created_at | timestamptz | NO | Data creazione |
| expires_at | timestamptz | NO | Scadenza TTL (dinamico: 30min-12h) |
| finalized_at | timestamptz | YES | Data finalizzazione |
| metadata | jsonb | YES | Dettagli: imageCount, errors, cancelled, etc. |

**RPC Associate:**
- `pre_authorize_tokens(user_id, tokens_needed, batch_id, image_count, visual_tagging)` - Blocca token con TTL dinamico
- `finalize_token_reservation(reservation_id, actual_usage)` - Consuma token effettivi, rimborsa resto
- `cleanup_expired_reservations()` - Job automatico che conta immagini da DB per reservation scadute

**Indici:**
- `idx_reservations_expires` (partial) - Per cleanup automatico
- `idx_reservations_user_batch` - Lookup veloce
- `idx_reservations_user_status` - Query utente

### `token_packs`
Pacchetti token acquistabili.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| tier_name | text | NO | Nome tier (starter/professional/studio) |
| display_name | text | NO | Nome visualizzato |
| tokens_included | integer | NO | Token inclusi |
| full_price_eur | numeric | NO | Prezzo pieno EUR |
| early_bird_price_eur | numeric | NO | Prezzo early bird |
| early_bird_discount_percent | integer | NO | % sconto early bird |
| is_active | boolean | YES | Attivo |
| is_popular | boolean | YES | Badge "Popolare" |
| features | jsonb | YES | Feature incluse |
| description | text | YES | Descrizione |
| sort_order | integer | YES | Ordine visualizzazione |
| badge_text | text | YES | Testo badge |
| badge_color | text | YES | Colore badge |
| stripe_price_id_early_bird | text | YES | Stripe Price ID early bird |
| stripe_price_id_standard | text | YES | Stripe Price ID standard |
| metadata | jsonb | YES | Metadati |
| base_price | numeric | YES | Prezzo base |
| early_bird_enabled | boolean | NO | Early bird attivo |

### `purchases`
Acquisti effettuati.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| token_pack_id | uuid | NO | FK a token_packs |
| stripe_payment_intent_id | text | YES | Stripe Payment Intent |
| stripe_session_id | text | YES | Stripe Session ID |
| amount_paid_eur | numeric | NO | Importo pagato EUR |
| tokens_granted | integer | NO | Token assegnati |
| is_early_bird | boolean | YES | Era early bird |
| purchase_date | timestamptz | YES | Data acquisto |
| status | text | YES | Stato (pending/completed/refunded) |
| metadata | jsonb | YES | Metadati |
| stripe_price_id | text | YES | Stripe Price ID |
| stripe_customer_id | text | YES | Stripe Customer ID |
| provider | text | YES | Provider (stripe/gumroad) |
| subscription_id | uuid | YES | FK a subscriptions |
| is_subscription | boolean | YES | È abbonamento |
| amount_tax | numeric | YES | Importo tasse |
| tax_exempt | boolean | YES | Esente tasse |
| customer_tax_id | text | YES | Partita IVA cliente |
| billing_country | text | YES | Paese fatturazione |
| billing_details | jsonb | YES | Dettagli fatturazione |

### `subscriptions`
Abbonamenti attivi.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| stripe_subscription_id | text | NO | ID abbonamento Stripe |
| stripe_customer_id | text | NO | ID cliente Stripe |
| stripe_price_id | text | NO | ID prezzo Stripe |
| plan_name | text | NO | Nome piano |
| status | text | NO | Stato (active/canceled/past_due) |
| tokens_per_month | integer | NO | Token mensili |
| price_per_month | numeric | NO | Prezzo mensile |
| current_period_start | timestamptz | NO | Inizio periodo |
| current_period_end | timestamptz | NO | Fine periodo |
| cancel_at_period_end | boolean | YES | Cancella a fine periodo |
| canceled_at | timestamptz | YES | Data cancellazione |
| tax_exempt | boolean | YES | Esente tasse |
| customer_tax_id | text | YES | Partita IVA |
| billing_country | text | YES | Paese fatturazione |

### `subscription_plans`
Piani di abbonamento disponibili.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| plan_key | text | NO | Chiave piano (hobby/enthusiast/professional/studio/agency) |
| display_name | text | NO | Nome visualizzato |
| description | text | YES | Descrizione |
| price_monthly_eur | numeric | NO | Prezzo mensile EUR |
| price_yearly_eur | numeric | YES | Prezzo annuale EUR |
| tokens_per_month | integer | NO | Token mensili |
| stripe_price_id_monthly | text | YES | Stripe Price ID mensile |
| stripe_price_id_yearly | text | YES | Stripe Price ID annuale |
| is_active | boolean | YES | Piano attivo |
| is_popular | boolean | YES | Badge "Popolare" |
| is_featured | boolean | YES | In evidenza |
| sort_order | integer | YES | Ordine visualizzazione |
| features | jsonb | YES | Feature incluse |
| limits | jsonb | YES | Limiti |
| metadata | jsonb | YES | Metadati |
| badge_text | text | YES | Testo badge |
| badge_color | text | YES | Colore badge |

### `subscription_token_grants`
Assegnazioni token da abbonamento.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| subscription_id | uuid | NO | FK a subscriptions |
| user_id | uuid | NO | FK a auth.users |
| tokens_granted | integer | NO | Token assegnati |
| billing_period_start | timestamptz | NO | Inizio periodo |
| billing_period_end | timestamptz | NO | Fine periodo |
| stripe_invoice_id | text | YES | ID fattura Stripe |
| granted_at | timestamptz | YES | Data assegnazione |

### `payment_transactions`
Transazioni di pagamento da webhook.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| provider | text | NO | Provider (stripe/gumroad) |
| provider_transaction_id | text | NO | ID transazione provider |
| provider_customer_email | text | YES | Email cliente provider |
| subscription_id | uuid | YES | FK a subscriptions |
| transaction_type | text | NO | Tipo transazione |
| product_name | text | YES | Nome prodotto |
| amount | numeric | NO | Importo |
| currency | text | YES | Valuta |
| tokens_granted | integer | YES | Token assegnati |
| status | text | YES | Stato |
| processed_at | timestamptz | YES | Data elaborazione |
| webhook_received_at | timestamptz | YES | Data ricezione webhook |
| provider_payload | jsonb | YES | Payload originale |

### `gumroad_email_associations`
Associazioni email Gumroad a utenti.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| gumroad_email | text | NO | Email Gumroad |
| user_id | uuid | NO | FK a auth.users |
| associated_at | timestamptz | YES | Data associazione |
| associated_by | text | YES | Chi ha associato |
| is_active | boolean | YES | Attiva |
| notes | text | YES | Note |

---

## 3. Sistema Analisi e Risultati

### `analysis_results`
Risultati analisi AI per immagine.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| image_id | uuid | NO | FK a images |
| analysis_provider | text | NO | Provider (gemini/rf-detr) |
| recognized_number | text | YES | Numero riconosciuto |
| additional_text | jsonb | YES | Testo aggiuntivo |
| confidence_score | real | YES | Score confidenza |
| raw_response | jsonb | YES | Risposta grezza AI |
| analyzed_at | timestamptz | NO | Data analisi |
| input_tokens | integer | YES | Token input |
| output_tokens | integer | YES | Token output |
| estimated_cost_usd | numeric | YES | Costo stimato USD |
| confidence_level | text | YES | Livello confidenza |
| execution_time_ms | integer | YES | Tempo esecuzione ms |
| face_detections | jsonb | YES | Rilevamenti volti |
| face_match_source | text | YES | Fonte match volto |
| face_confidence | numeric | YES | Confidenza volto |
| training_eligible | boolean | YES | Eleggibile per training |
| user_consent_at_analysis | boolean | YES | Consenso utente |
| crop_analysis | jsonb | YES | Analisi crop |
| context_analysis | jsonb | YES | Analisi contesto |
| edge_function_version | integer | YES | Versione edge function |
| analysis_log | jsonb | YES | Log analisi |
| user_id | uuid | YES | FK a auth.users |

### `execution_settings`
Impostazioni dettagliate per esecuzione.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| execution_id | uuid | NO | FK a executions |
| user_id | uuid | NO | FK a auth.users |
| created_at | timestamptz | NO | Data creazione |
| ai_model | text | YES | Modello AI usato |
| sport_category | text | YES | Categoria sport |
| metadata_strategy | text | YES | Strategia metadata |
| manual_metadata_value | text | YES | Valore metadata manuale |
| update_exif | boolean | YES | Aggiorna EXIF |
| save_preview_images | boolean | YES | Salva preview |
| preview_folder | text | YES | Cartella preview |
| resize_enabled | boolean | YES | Resize attivo |
| resize_preset | text | YES | Preset resize |
| parallel_processing_enabled | boolean | YES | Processing parallelo |
| streaming_pipeline_enabled | boolean | YES | Pipeline streaming |
| max_concurrent_uploads | integer | YES | Max upload concorrenti |
| max_concurrent_analysis | integer | YES | Max analisi concorrenti |
| rate_limit_per_second | integer | YES | Rate limit |
| batch_size | integer | YES | Dimensione batch |
| folder_organization_enabled | boolean | YES | Organizzazione cartelle |
| folder_organization_mode | text | YES | Modalità organizzazione |
| folder_organization_pattern | text | YES | Pattern organizzazione |
| folder_organization_custom_pattern | text | YES | Pattern custom |
| create_unknown_folder | boolean | YES | Crea cartella unknown |
| unknown_folder_name | text | YES | Nome cartella unknown |
| include_xmp_files | boolean | YES | Includi XMP |
| optimization_level | text | YES | Livello ottimizzazione |
| recognition_method | text | YES | Metodo riconoscimento (gemini/rf-detr) |
| recognition_method_version | text | YES | Versione metodo |
| rf_detr_workflow_url | text | YES | URL workflow RF-DETR |
| rf_detr_detections_count | integer | YES | Conteggio detection RF-DETR |
| rf_detr_total_cost | numeric | YES | Costo totale RF-DETR |
| local_onnx_model_version | text | YES | Versione modello ONNX locale |
| local_onnx_inference_count | integer | YES | Conteggio inferenze ONNX |
| local_onnx_avg_inference_ms | numeric | YES | Media tempo inferenza |
| total_images_processed | integer | YES | Totale immagini processate |
| total_raw_files | integer | YES | Totale file RAW |
| total_standard_files | integer | YES | Totale file standard |
| csv_data_used | boolean | YES | Usati dati CSV |
| csv_entries_count | integer | YES | Numero entries CSV |
| execution_duration_ms | numeric | YES | Durata esecuzione |
| average_image_processing_time_ms | numeric | YES | Tempo medio per immagine |
| client_version | text | YES | Versione client |
| client_build_number | text | YES | Build number |
| operating_system | text | YES | Sistema operativo |
| os_version | text | YES | Versione OS |
| system_arch | text | YES | Architettura |
| client_session_id | text | YES | ID sessione client |
| client_machine_id | text | YES | ID macchina |

### `analysis_log_metadata`
Metadata log analisi per debugging.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| execution_id | uuid | NO | FK a executions |
| user_id | uuid | NO | FK a auth.users |
| storage_path | text | NO | Path file log |
| total_images | integer | NO | Totale immagini |
| total_corrections | integer | NO | Totale correzioni |
| correction_types | jsonb | YES | Tipi correzioni |
| category | text | YES | Categoria |
| app_version | text | YES | Versione app |

### `image_corrections`
Correzioni applicate alle immagini.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| execution_id | text | NO | ID esecuzione |
| user_id | uuid | NO | FK a auth.users |
| image_id | text | NO | ID immagine |
| correction_type | text | NO | Tipo correzione |
| field | text | NO | Campo corretto |
| original_value | jsonb | YES | Valore originale |
| corrected_value | jsonb | YES | Valore corretto |
| confidence | real | YES | Confidenza |
| reason | text | YES | Motivo correzione |
| message | text | YES | Messaggio human-readable |
| vehicle_index | integer | YES | Indice veicolo |
| details | jsonb | YES | Dettagli aggiuntivi |

### `temporal_clusters`
Cluster temporali di immagini (burst mode).

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| execution_id | text | NO | ID esecuzione |
| user_id | uuid | NO | FK a auth.users |
| cluster_images | text[] | NO | Array ID immagini |
| cluster_size | integer | NO | Dimensione cluster |
| duration_ms | integer | YES | Durata in ms |
| is_burst_mode | boolean | YES | È burst mode |
| common_number | text | YES | Numero comune |
| sport | text | YES | Sport |

### `unknown_numbers`
Numeri non trovati nei partecipanti.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| execution_id | text | NO | ID esecuzione |
| user_id | uuid | NO | FK a auth.users |
| image_id | text | NO | ID immagine |
| file_name | text | NO | Nome file |
| detected_numbers | text[] | NO | Numeri rilevati |
| participant_preset_name | text | YES | Nome preset |
| participant_count | integer | YES | Conteggio partecipanti |
| applied_fuzzy_correction | boolean | YES | Applicata correzione fuzzy |
| fuzzy_attempts | jsonb | YES | Tentativi fuzzy |
| organization_folder | text | YES | Cartella organizzazione |

### `visual_tags`
Tag visuali estratti dalle immagini.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| image_id | uuid | NO | FK a images |
| execution_id | uuid | YES | FK a executions |
| user_id | uuid | NO | FK a auth.users |
| location_tags | text[] | YES | Tag location |
| weather_tags | text[] | YES | Tag meteo |
| scene_type_tags | text[] | YES | Tag tipo scena |
| subject_tags | text[] | YES | Tag soggetto |
| visual_style_tags | text[] | YES | Tag stile visivo |
| emotion_tags | text[] | YES | Tag emozioni |
| all_tags | text[] | YES | Tutti i tag |
| participant_name | text | YES | Nome partecipante |
| participant_team | text | YES | Team partecipante |
| participant_number | text | YES | Numero partecipante |
| confidence_score | numeric | YES | Score confidenza |
| model_used | text | YES | Modello usato |
| processing_time_ms | integer | YES | Tempo processing |
| input_tokens | integer | YES | Token input |
| output_tokens | integer | YES | Token output |
| estimated_cost_usd | numeric | YES | Costo stimato |

---

## 4. Participant Presets

### `participant_presets`
Preset di partecipanti (liste gara).

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| name | text | NO | Nome preset |
| category_id | uuid | YES | FK a sport_categories |
| description | text | YES | Descrizione |
| is_template | boolean | YES | È template |
| is_public | boolean | YES | È pubblico |
| created_at | timestamptz | NO | Data creazione |
| updated_at | timestamptz | NO | Data aggiornamento |
| last_used_at | timestamptz | YES | Ultimo utilizzo |
| usage_count | integer | YES | Conteggio utilizzi |
| custom_folders | jsonb | YES | Cartelle custom |
| person_shown_template | varchar | YES | Template PersonShown |
| is_official | boolean | YES | È ufficiale |
| approved_by | uuid | YES | Approvato da |
| approved_at | timestamptz | YES | Data approvazione |

### `preset_participants`
Singoli partecipanti in un preset.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| preset_id | uuid | NO | FK a participant_presets |
| numero | text | NO | Numero gara |
| nome | text | YES | Nome partecipante |
| categoria | text | YES | Categoria |
| squadra | text | YES | Squadra/Team |
| navigatore | text | YES | Navigatore (rally) |
| sponsor | text | YES | Sponsor |
| metatag | text | YES | Metatag per metadata |
| custom_fields | jsonb | YES | Campi custom |
| sort_order | integer | YES | Ordine |
| folder_1 | text | YES | Cartella 1 |
| folder_2 | text | YES | Cartella 2 |
| folder_3 | text | YES | Cartella 3 |
| plate_number | text | YES | Numero targa |
| face_descriptor | float8[] | YES | Descriptor volto |
| reference_photo_url | text | YES | URL foto riferimento |
| face_photo_count | integer | YES | Conteggio foto volto |

### `preset_participant_face_photos`
Foto volto per partecipanti preset.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| participant_id | uuid | NO | FK a preset_participants |
| photo_url | text | NO | URL foto |
| storage_path | text | NO | Path storage |
| face_descriptor | float8[] | YES | Descriptor volto |
| photo_type | text | YES | Tipo foto |
| detection_confidence | numeric | YES | Confidenza detection |
| is_primary | boolean | YES | È primaria |
| user_id | uuid | YES | FK a auth.users |

---

## 5. Sport Categories e Configurazione

### `sport_categories`
Categorie sportive con configurazione AI.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| code | text | NO | Codice (f1/motogp/rally/running/etc) |
| name | text | NO | Nome visualizzato |
| description | text | YES | Descrizione |
| ai_prompt | text | NO | Prompt AI principale |
| fallback_prompt | text | YES | Prompt fallback |
| expected_fields | jsonb | YES | Campi attesi nella risposta |
| icon | text | YES | Icona |
| is_active | boolean | YES | Categoria attiva |
| display_order | integer | YES | Ordine visualizzazione |
| edge_function_version | integer | YES | Versione edge function (3/4/5/6) |
| temporal_config | jsonb | YES | Config clustering temporale |
| matching_config | jsonb | YES | Config matching partecipanti |
| individual_competition | boolean | YES | Competizione individuale |
| recognition_config | jsonb | YES | Config riconoscimento |
| recognition_method | text | YES | Metodo (gemini/rf-detr/local-onnx) |
| rf_detr_workflow_url | text | YES | URL workflow Roboflow |
| rf_detr_api_key_env | text | YES | Nome env var API key |
| allowed_labels | jsonb | YES | Label permessi |
| face_recognition_enabled | boolean | YES | Face recognition attivo |
| face_recognition_config | jsonb | YES | Config face recognition |
| active_model_id | uuid | YES | FK a model_registry |
| use_local_onnx | boolean | YES | Usa modello ONNX locale |
| scene_classifier_enabled | boolean | YES | Classificatore scena |
| crop_config | jsonb | YES | Config crop |
| segmentation_config | jsonb | YES | Config segmentazione |

### `model_registry`
Registry modelli ONNX.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| sport_category_id | uuid | YES | FK a sport_categories |
| version | text | NO | Versione modello |
| onnx_storage_path | text | NO | Path file ONNX |
| size_bytes | bigint | NO | Dimensione file |
| checksum_sha256 | text | NO | Checksum SHA256 |
| input_size | int[] | YES | Dimensioni input |
| confidence_threshold | numeric | YES | Soglia confidenza |
| iou_threshold | numeric | YES | Soglia IoU |
| classes | text[] | YES | Classi supportate |
| min_app_version | text | YES | Versione app minima |
| is_active | boolean | YES | Modello attivo |
| release_notes | text | YES | Note release |
| created_by | uuid | YES | Creato da |

### `system_config`
Configurazioni sistema.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| key | text | NO | Chiave configurazione |
| value | jsonb | NO | Valore JSON |
| description | text | YES | Descrizione |
| updated_at | timestamptz | YES | Data aggiornamento |

### `feature_flags`
Feature flags per rollout graduale.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | YES | FK a auth.users (null = globale) |
| feature_name | text | NO | Nome feature |
| is_enabled | boolean | YES | Feature attiva |
| rollout_percentage | integer | YES | % rollout |

---

## 6. Face Recognition

### `sport_category_faces`
Volti noti per categoria sportiva (piloti F1, etc).

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| sport_category_id | uuid | NO | FK a sport_categories |
| person_name | text | NO | Nome persona |
| person_role | user_defined | YES | Ruolo (driver/team_principal/etc) |
| team | text | YES | Team |
| car_number | text | YES | Numero auto |
| face_descriptor | float8[] | YES | Descriptor volto |
| reference_photo_url | text | YES | URL foto riferimento |
| season | text | YES | Stagione |
| nationality | text | YES | Nazionalità |
| is_active | boolean | YES | Attivo |
| photo_count | integer | YES | Numero foto |

### `sport_category_face_photos`
Foto multiple per volti sport category.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| face_id | uuid | NO | FK a sport_category_faces |
| photo_url | text | NO | URL foto |
| face_descriptor | float8[] | YES | Descriptor |
| photo_type | text | YES | Tipo foto |
| detection_confidence | numeric | YES | Confidenza |
| is_primary | boolean | YES | È primaria |

### `visual_reference_profiles`
Profili riferimento visivo per veicoli.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| execution_id | uuid | NO | FK a executions |
| participant_number | text | NO | Numero partecipante |
| participant_name | text | YES | Nome |
| category | text | NO | Categoria |
| vehicle_features | jsonb | NO | Feature veicolo |
| rider_features | jsonb | YES | Feature pilota |
| event_id | text | YES | ID evento |
| confidence_score | numeric | YES | Score confidenza |
| participant_preset_id | uuid | YES | FK a participant_presets |
| is_shared | boolean | YES | È condiviso |

---

## 7. Test Lab

### `test_sessions`
Sessioni di test nel Test Lab.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| name | text | NO | Nome sessione |
| description | text | YES | Descrizione |
| user_id | uuid | YES | FK a auth.users |
| config | jsonb | NO | Configurazione test |
| status | text | NO | Stato (pending/running/completed) |
| total_images | integer | YES | Totale immagini |
| processed_images | integer | YES | Immagini processate |
| completed_at | timestamptz | YES | Data completamento |

### `test_images`
Immagini caricate per test.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| session_id | uuid | YES | FK a test_sessions |
| original_name | text | NO | Nome originale |
| storage_path | text | NO | Path storage |
| storage_bucket | text | NO | Bucket storage |
| file_size | integer | YES | Dimensione |
| mime_type | text | YES | MIME type |
| width | integer | YES | Larghezza |
| height | integer | YES | Altezza |
| tags | text[] | YES | Tag |
| notes | text | YES | Note |
| expected_category | text | YES | Categoria attesa |
| expected_numbers | text[] | YES | Numeri attesi |
| expected_participants | jsonb | YES | Partecipanti attesi |
| is_processed_current | boolean | YES | Processato con current |
| is_processed_experimental | boolean | YES | Processato con experimental |
| uploaded_by | uuid | YES | Caricato da |

### `test_results`
Risultati test comparativi.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| session_id | uuid | YES | FK a test_sessions |
| image_url | text | NO | URL immagine |
| image_name | text | NO | Nome immagine |
| ground_truth | jsonb | YES | Verità ground |
| current_result | jsonb | NO | Risultato current |
| current_processing_time | integer | YES | Tempo current |
| current_success | boolean | YES | Successo current |
| current_error_message | text | YES | Errore current |
| experimental_result | jsonb | NO | Risultato experimental |
| experimental_processing_time | integer | YES | Tempo experimental |
| experimental_success | boolean | YES | Successo experimental |
| experimental_error_message | text | YES | Errore experimental |
| accuracy_score | real | YES | Score accuratezza |
| category_match | boolean | YES | Match categoria |
| numbers_match_score | real | YES | Score match numeri |
| participant_match_score | real | YES | Score match partecipanti |
| user_feedback | text | YES | Feedback utente |
| user_correction | jsonb | YES | Correzione utente |
| is_validated | boolean | YES | È validato |

### `test_metrics`
Metriche aggregate per sessione test.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| session_id | uuid | YES | FK a test_sessions |
| total_images | integer | NO | Totale immagini |
| successful_current | integer | YES | Successi current |
| successful_experimental | integer | YES | Successi experimental |
| avg_accuracy_score | real | YES | Media accuratezza |
| category_detection_accuracy | real | YES | Accuratezza categoria |
| number_recognition_accuracy | real | YES | Accuratezza numeri |
| participant_matching_accuracy | real | YES | Accuratezza matching |
| avg_processing_time_current | real | YES | Tempo medio current |
| avg_processing_time_experimental | real | YES | Tempo medio experimental |
| accuracy_improvement | real | YES | Miglioramento accuratezza |
| speed_improvement | real | YES | Miglioramento velocità |
| calculated_at | timestamptz | YES | Data calcolo |

### `test_presets`
Preset partecipanti per test.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| name | text | NO | Nome |
| category | text | NO | Categoria |
| description | text | YES | Descrizione |
| created_by | uuid | YES | Creato da |
| participants | jsonb | NO | Lista partecipanti JSON |
| usage_count | integer | YES | Utilizzi |
| last_used_at | timestamptz | YES | Ultimo uso |
| is_public | boolean | YES | Pubblico |
| is_template | boolean | YES | Template |

### `multimodal_test_results`
Risultati test multimodali.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| image_url | text | NO | URL immagine |
| image_filename | text | YES | Nome file |
| test_timestamp | timestamptz | YES | Timestamp test |
| standard_result | jsonb | YES | Risultato standard |
| standard_confidence | numeric | YES | Confidenza standard |
| multimodal_result | jsonb | YES | Risultato multimodal |
| multimodal_confidence | numeric | YES | Confidenza multimodal |
| actual_number | text | YES | Numero reale |
| actual_plate | text | YES | Targa reale |
| actual_colors | jsonb | YES | Colori reali |
| actual_make_model | text | YES | Marca/modello |
| actual_rider_gear | jsonb | YES | Equipaggiamento |
| verified | boolean | YES | Verificato |
| sport_category | text | YES | Categoria sport |
| weather_conditions | text | YES | Condizioni meteo |
| image_quality | text | YES | Qualità immagine |
| standard_correct | boolean | YES | Standard corretto |
| multimodal_correct | boolean | YES | Multimodal corretto |
| improvement_delta | numeric | YES | Delta miglioramento |
| standard_time_ms | integer | YES | Tempo standard |
| multimodal_time_ms | integer | YES | Tempo multimodal |
| gemini_tokens_used | integer | YES | Token Gemini usati |
| cost_estimate | numeric | YES | Stima costo |

---

## 8. Private API

### `private_api_tokens`
Token API per accesso programmatico.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| token_hash | text | NO | Hash token |
| token_prefix | text | NO | Prefisso token (per identificazione) |
| name | text | YES | Nome token |
| description | text | YES | Descrizione |
| last_used_at | timestamptz | YES | Ultimo utilizzo |
| expires_at | timestamptz | YES | Scadenza |
| is_active | boolean | YES | Token attivo |
| total_requests | integer | YES | Totale richieste |
| successful_requests | integer | YES | Richieste successo |
| failed_requests | integer | YES | Richieste fallite |

### `private_api_executions`
Esecuzioni via Private API.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| token_id | uuid | NO | FK a private_api_tokens |
| created_at | timestamptz | YES | Data creazione |
| completed_at | timestamptz | YES | Data completamento |
| image_url | text | YES | URL immagine |
| image_source | text | YES | Fonte immagine |
| image_hash | text | YES | Hash immagine |
| category | text | YES | Categoria |
| participant_preset | jsonb | YES | Preset partecipanti |
| options | jsonb | YES | Opzioni |
| detection_method | text | YES | Metodo detection |
| ocr_result | jsonb | YES | Risultato OCR |
| visual_features | jsonb | YES | Feature visuali |
| visual_match | jsonb | YES | Match visuale |
| final_result | jsonb | YES | Risultato finale |
| storage_path_input | text | YES | Path input |
| storage_path_output | text | YES | Path output |
| storage_path_annotated | text | YES | Path annotato |
| execution_time_ms | integer | YES | Tempo esecuzione |
| breakdown_times | jsonb | YES | Breakdown tempi |
| ai_provider | text | YES | Provider AI |
| ai_model | text | YES | Modello AI |
| tokens_used_input | integer | YES | Token input |
| tokens_used_output | integer | YES | Token output |
| cost_estimate_usd | numeric | YES | Costo stimato |
| status | text | YES | Stato |
| success | boolean | YES | Successo |
| error_message | text | YES | Messaggio errore |
| error_code | text | YES | Codice errore |
| vehicles_detected | integer | YES | Veicoli rilevati |
| race_numbers_detected | text[] | YES | Numeri rilevati |
| drivers_detected | text[] | YES | Piloti rilevati |
| user_agent | text | YES | User agent |
| request_ip | text | YES | IP richiesta |
| request_metadata | jsonb | YES | Metadata richiesta |

### `private_api_feature_cache`
Cache feature per Private API.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| image_hash | text | NO | Hash immagine |
| last_accessed_at | timestamptz | YES | Ultimo accesso |
| access_count | integer | YES | Conteggio accessi |
| visual_features | jsonb | NO | Feature visuali |
| ocr_result | jsonb | YES | Risultato OCR |
| ai_provider | text | YES | Provider AI |
| ai_model | text | YES | Modello AI |
| extraction_time_ms | integer | YES | Tempo estrazione |
| image_dimensions | jsonb | YES | Dimensioni |
| expires_at | timestamptz | YES | Scadenza |
| cache_hit_count | integer | YES | Hit cache |

---

## 9. Sistema Feedback e Rewards

### `image_feedback`
Feedback su immagini analizzate.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| image_id | uuid | NO | FK a images |
| feedback_type | text | NO | Tipo feedback |
| feedback_notes | text | YES | Note |
| submitted_at | timestamptz | YES | Data invio |
| user_email | text | YES | Email utente |
| user_id | uuid | YES | FK a auth.users |
| tokens_earned | integer | YES | Token guadagnati |
| admin_approved | boolean | YES | Approvato admin |
| approved_by | uuid | YES | Approvato da |
| approved_at | timestamptz | YES | Data approvazione |
| quality_score | integer | YES | Score qualità |
| admin_notes | text | YES | Note admin |
| session_id | text | YES | ID sessione |
| ip_address | inet | YES | IP address |

### `feedback_rewards`
Rewards per feedback.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| feedback_id | uuid | NO | FK a image_feedback |
| user_email | text | NO | Email utente |
| user_id | uuid | YES | FK a auth.users |
| tokens_awarded | integer | YES | Token assegnati |
| reward_reason | text | YES | Motivo reward |
| awarded_by | uuid | YES | Assegnato da |
| quality_score | integer | YES | Score qualità |
| feedback_category | text | YES | Categoria feedback |
| multiplier_applied | numeric | YES | Moltiplicatore |

### `image_labels`
Label per immagini (training).

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| image_id | uuid | NO | FK a images |
| user_id | uuid | NO | FK a auth.users |
| labels | jsonb | NO | Label JSON |
| is_verified | boolean | YES | Verificato |

### `labeling_users`
Utenti abilitati al labeling.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| user_id | uuid | NO | FK a auth.users |
| created_at | timestamptz | YES | Data abilitazione |
| added_by | uuid | YES | Abilitato da |

---

## 10. Export e Destinations

### `export_destinations`
Destinazioni export con configurazione IPTC/EXIF.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| name | varchar | NO | Nome destinazione |
| base_folder | text | YES | Cartella base |
| subfolder_pattern | varchar | YES | Pattern sottocartelle |
| filename_pattern | varchar | YES | Pattern nomi file |
| filename_sequence_start | integer | YES | Inizio sequenza |
| filename_sequence_padding | integer | YES | Padding sequenza |
| filename_sequence_mode | varchar | YES | Modalità sequenza |
| preserve_original_name | boolean | YES | Preserva nome originale |
| credit | varchar | YES | IPTC Credit |
| source | varchar | YES | IPTC Source |
| copyright | varchar | YES | IPTC Copyright |
| copyright_owner | varchar | YES | Copyright owner |
| creator | varchar | YES | IPTC Creator |
| authors_position | varchar | YES | IPTC Author Position |
| caption_writer | varchar | YES | IPTC Caption Writer |
| contact_address | text | YES | Indirizzo contatto |
| contact_city | varchar | YES | Città |
| contact_region | varchar | YES | Regione |
| contact_postal_code | varchar | YES | CAP |
| contact_country | varchar | YES | Paese |
| contact_phone | varchar | YES | Telefono |
| contact_email | varchar | YES | Email |
| contact_website | varchar | YES | Website |
| headline_template | varchar | YES | Template headline |
| title_template | varchar | YES | Template title |
| event_template | varchar | YES | Template evento |
| description_template | text | YES | Template descrizione |
| category | varchar | YES | Categoria |
| city | varchar | YES | Città evento |
| country | varchar | YES | Paese evento |
| country_code | varchar | YES | Codice paese |
| location | varchar | YES | Location |
| world_region | varchar | YES | Regione mondo |
| base_keywords | text[] | YES | Keywords base |
| append_keywords | boolean | YES | Aggiungi keywords |
| person_shown_template | varchar | YES | Template PersonShown |
| auto_apply | boolean | YES | Applica automaticamente |
| apply_condition | varchar | YES | Condizione applicazione |
| is_default | boolean | YES | È default |
| is_active | boolean | YES | Attiva |
| display_order | integer | YES | Ordine |
| upload_method | varchar | YES | Metodo upload (local/ftp) |
| ftp_host | varchar | YES | Host FTP |
| ftp_port | integer | YES | Porta FTP |
| ftp_username | varchar | YES | Username FTP |
| ftp_password_encrypted | text | YES | Password FTP criptata |
| ftp_remote_path | varchar | YES | Path remoto FTP |
| ftp_passive_mode | boolean | YES | Modalità passiva |
| ftp_secure | boolean | YES | FTPS |
| ftp_concurrent_uploads | integer | YES | Upload concorrenti |
| ftp_retry_attempts | integer | YES | Tentativi retry |
| ftp_timeout_seconds | integer | YES | Timeout |
| keep_local_copy | boolean | YES | Mantieni copia locale |

### `export_jobs`
Job di export per labeling/training.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| execution_id | text | YES | ID esecuzione |
| format | text | NO | Formato export |
| include_images | boolean | NO | Includi immagini |
| status | text | NO | Stato |
| download_url | text | YES | URL download |
| storage_path | text | YES | Path storage |
| error_message | text | YES | Errore |
| total_images | integer | YES | Totale immagini |
| total_annotations | integer | YES | Totale annotazioni |
| file_size_bytes | bigint | YES | Dimensione file |
| expires_at | timestamptz | YES | Scadenza |

---

## 11. Sistema Referral

### `referrals`
Referral tra utenti.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| referrer_id | uuid | NO | FK chi ha referenziato |
| referred_id | uuid | NO | FK chi è stato referenziato |
| referral_code | uuid | NO | Codice utilizzato |
| tokens_earned | integer | YES | Token guadagnati |
| status | text | YES | Stato |
| referral_tier | integer | YES | Tier referral |
| bonus_multiplier | numeric | YES | Moltiplicatore |

### `milestone_bonuses`
Bonus per milestone raggiunti.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| subscriber_id | uuid | NO | FK a subscribers |
| milestone_type | text | NO | Tipo milestone |
| milestone_value | integer | NO | Valore milestone |
| tokens_awarded | integer | NO | Token assegnati |
| achieved_at | timestamptz | YES | Data raggiungimento |
| status | text | YES | Stato |

### `company_referrals`
Referral aziendali.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| referrer_id | uuid | NO | FK chi ha referenziato |
| company_name | text | NO | Nome azienda |
| company_email | text | NO | Email azienda |
| contact_person | text | YES | Persona contatto |
| employees_count | integer | YES | Numero dipendenti |
| subscribers_converted | integer | YES | Iscritti convertiti |
| tokens_awarded | integer | YES | Token assegnati |
| status | text | YES | Stato |
| converted_at | timestamptz | YES | Data conversione |

### `social_shares`
Condivisioni social.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | NO | FK a auth.users |
| user_email | text | NO | Email |
| platform | text | NO | Piattaforma |
| post_url | text | NO | URL post |
| description | text | YES | Descrizione |
| share_type | text | NO | Tipo share |
| estimated_tokens | integer | NO | Token stimati |
| verification_status | text | YES | Stato verifica |
| tokens_awarded | integer | YES | Token assegnati |
| verified_by | uuid | YES | Verificato da |
| verified_at | timestamptz | YES | Data verifica |
| rejection_reason | text | YES | Motivo rifiuto |

### `social_sharing_rewards`
Rewards per social sharing.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| subscriber_id | uuid | NO | FK a subscribers |
| platform | text | NO | Piattaforma |
| share_type | text | NO | Tipo share |
| share_url | text | YES | URL share |
| engagement_count | integer | YES | Engagement |
| tokens_awarded | integer | NO | Token assegnati |
| verification_status | text | YES | Stato verifica |
| verified_by | uuid | YES | Verificato da |
| verified_at | timestamptz | YES | Data verifica |

### `agent_commissions`
Commissioni agenti.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| agent_id | uuid | NO | FK agente |
| referred_user_id | uuid | NO | FK utente referenziato |
| purchase_id | uuid | NO | FK a purchases |
| amount | numeric | NO | Importo commissione |
| status | text | NO | Stato |
| processed_at | timestamptz | YES | Data elaborazione |
| metadata | jsonb | YES | Metadati |

---

## 12. App Version e Configurazione

### `app_version_config`
Configurazione versioni app.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| platform | varchar | NO | Piattaforma (darwin/win32/linux) |
| current_version | varchar | NO | Versione corrente |
| minimum_version | varchar | NO | Versione minima |
| force_update_enabled | boolean | YES | Force update attivo |
| update_message | text | YES | Messaggio update |
| update_urgency | varchar | YES | Urgenza (low/medium/high/critical) |
| download_url | text | YES | URL download |
| release_notes | text | YES | Note release |
| updated_by | uuid | YES | Aggiornato da |

### `app_version_checks`
Log controlli versione.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | YES | FK a auth.users |
| platform | varchar | YES | Piattaforma |
| app_version | varchar | YES | Versione app |
| check_result | varchar | YES | Risultato (ok/update_available/force_update) |
| ip_address | inet | YES | IP address |
| user_agent | text | YES | User agent |

### `app_launches`
Log avvii app.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| user_id | uuid | YES | FK a auth.users |
| machine_id | text | NO | ID macchina |
| hostname | text | YES | Hostname |
| platform | text | YES | Piattaforma |
| username | text | YES | Username OS |
| app_version | text | NO | Versione app |
| electron_version | text | YES | Versione Electron |
| node_version | text | YES | Versione Node |
| cpu | text | YES | CPU |
| cores | integer | YES | Cores |
| ram_gb | integer | YES | RAM GB |
| architecture | text | YES | Architettura |
| is_first_launch | boolean | YES | Primo avvio assoluto |
| is_first_launch_this_version | boolean | YES | Primo avvio versione |
| launch_count | integer | YES | Conteggio avvii |
| launched_at | timestamptz | YES | Data avvio |
| session_id | uuid | YES | ID sessione |

### `installer_versions`
Versioni installer caricate.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| platform | varchar | NO | Piattaforma |
| version | varchar | NO | Versione |
| file_name | varchar | NO | Nome file |
| file_path | varchar | NO | Path storage |
| file_size | bigint | NO | Dimensione |
| is_current | boolean | YES | È versione corrente |
| uploaded_by | uuid | YES | Caricato da |

### `desktop_announcements`
Annunci mostrati nell'app desktop.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| title | text | NO | Titolo |
| description | text | YES | Descrizione |
| image_url | text | YES | URL immagine |
| link_url | text | YES | URL link |
| is_active | boolean | YES | Attivo |
| display_order | integer | YES | Ordine |

---

## 13. Tabelle R&D (ZRND_*)

Tabelle per ricerca e sviluppo, non in produzione.

### `ZRND_admins`
Admin R&D.

### `ZRND_batch_jobs`
Job batch R&D per processing.

### `ZRND_images`
Immagini R&D.

### `ZRND_detections`
Detection R&D con bbox.

### `ZRND_corrections`
Correzioni manuali R&D.

### `ZRND_training_runs`
Run di training R&D.

### `ZRND_model_versions`
Versioni modelli R&D.

---

## 14. Altre Tabelle

### `access_codes`
Codici accesso per onboarding.

| Colonna | Tipo | Nullable | Descrizione |
|---------|------|----------|-------------|
| id | uuid | NO | Primary key |
| subscriber_email | text | NO | Email subscriber |
| code_value | text | NO | Valore codice |
| tokens_to_grant | integer | NO | Token da assegnare |
| status | text | NO | Stato |
| is_used | boolean | YES | Utilizzato |
| used_at | timestamptz | YES | Data utilizzo |
| user_id_activated | uuid | YES | Utente che ha attivato |
| expires_at | timestamptz | YES | Scadenza |
| granted_by_admin_id | uuid | YES | Admin che ha generato |

### `waiting_list`
Lista d'attesa legacy.

### `email_queue`
Coda email da inviare.

### `user_csv_metadata`
Metadata CSV utente.

### `user_settings`
Impostazioni utente.

### `admin_actions_log`
Log azioni admin.

### `migration_log`
Log migrazioni database.

### `enterprise_inquiries`
Richieste enterprise.

### `documents`
Documenti con embedding per RAG.

### `n8n_chat_histories`
Storico chat n8n.

### `vehicle_clusters`
Cluster veicoli per visual matching.

### `vehicle_embeddings`
Embedding veicoli.

---

## 15. Edge Functions

### Analisi Immagini

| Funzione | Descrizione | Versione |
|----------|-------------|----------|
| `analyzeImage` | Analisi base immagini | Legacy |
| `analyzeImageV2` | Analisi v2 | Legacy |
| `analyzeImageWeb` | Analisi per web app | Current |
| `analyzeImageDesktop` | Analisi per desktop app | V1 |
| `analyzeImageDesktopV2` | Desktop con SmartMatcher | V2 |
| `analyzeImageDesktopV3` | Desktop con temporal clustering | V3 |
| `analyzeImageDesktopV4` | Desktop con RF-DETR routing | V4 |
| `analyzeImageDesktopV5` | Desktop con local ONNX | V5 |
| `analyzeImageDesktopV6` | Desktop con visual tagging | V6 - Current |
| `analyzeImageAdmin` | Analisi admin | Legacy |
| `analyzeImageAdminV2` | Analisi admin v2 | Current |
| `analyzeImageExperimental` | Test Lab | Test |
| `analyzeImageMultiShot` | Analisi multi-immagine | Experimental |
| `analyze-multimodal` | Analisi multimodale | Experimental |

### Private API

| Funzione | Descrizione |
|----------|-------------|
| `api-private-analyze` | API privata v1 |
| `api-private-analyze-v2` | API privata v2 con visual matching |
| `generate-api-token` | Genera token API |

### Autenticazione e Registrazione

| Funzione | Descrizione |
|----------|-------------|
| `create-auth-user` | Crea utente auth |
| `register-subscriber` | Registra subscriber v1 |
| `register-subscriber-v2` | Registra subscriber v2 |
| `register-user-unified` | Registrazione unificata |
| `verify-and-activate-code` | Verifica codice accesso |
| `check-user-registration-status` | Stato registrazione |
| `quick-register-from-feedback` | Registra da feedback |
| `delete-user-accounts` | Elimina account |
| `test-auth-user-check` | Test auth |

### Token e Pagamenti

| Funzione | Descrizione |
|----------|-------------|
| `get-user-token-balance` | Saldo token utente |
| `grant-bonus-tokens` | Assegna token bonus |
| `handle-token-request` | Gestisce richiesta token |
| `debug-token` | Debug token |
| `update-feedback-tokens` | Aggiorna token feedback |
| `process-access-grants` | Processa accessi |
| `generate-access-codes` | Genera codici accesso |

### Email

| Funzione | Descrizione |
|----------|-------------|
| `send-confirmation-email` | Email conferma |
| `send-contact-email` | Email contatto |
| `send-enterprise-inquiry-email` | Email enterprise |
| `send-export-ready-email` | Email export pronto |
| `send-newsletter` | Newsletter |
| `send-referral-success-email` | Email referral |
| `send-reminder-email` | Email reminder |
| `send-token-approval-email` | Email approvazione token |
| `send-token-balance-email` | Email saldo token |
| `send-token-request-email` | Email richiesta token |
| `send-welcome-email-v2` | Email benvenuto v2 |

### Feedback e Social

| Funzione | Descrizione |
|----------|-------------|
| `submit-feedback-with-rewards` | Invia feedback con reward |
| `admin-approve-feedback` | Approva feedback (admin) |
| `submit-social-share` | Invia condivisione social |
| `process-referral-signup` | Processa referral |

### Utility

| Funzione | Descrizione |
|----------|-------------|
| `check-app-version` | Controlla versione app |
| `uploadImage` | Upload immagine |
| `extract-raw-preview` | Estrae preview RAW |
| `parsePdfEntryList` | Parsing PDF entry list |
| `export-training-labels` | Esporta label training |
| `track-execution-settings` | Traccia impostazioni |
| `visualTagging` | Visual tagging immagini |
| `identifyPersonWithGrounding` | Identifica persona |
| `sync-to-brevo` | Sincronizza con Brevo |
| `verify-recaptcha` | Verifica reCAPTCHA |
| `get-registrants` | Lista registranti |
| `shared` | Modulo condiviso |

---

## Note Importanti

### Convenzioni

- **UUID**: Tutte le primary key sono UUID v4
- **Timestamp**: Usare `timestamptz` per tutti i timestamp
- **JSONB**: Preferito a JSON per query
- **Array**: PostgreSQL arrays nativi per liste semplici

### RLS (Row Level Security)

La maggior parte delle tabelle ha RLS abilitato con policy per:
- Utenti autenticati possono vedere/modificare solo i propri dati
- Admin possono vedere tutti i dati
- Alcune tabelle (sport_categories, token_packs) sono pubbliche in lettura

### Indici Importanti

- `subscribers(email)` - UNIQUE
- `subscribers(user_id)` - FK index
- `executions(user_id, created_at)` - Query comuni
- `images(execution_id)` - FK index
- `analysis_results(image_id)` - FK index
- `token_transactions(user_id, created_at)` - Query bilancio

### Storage Buckets

- `images` - Immagini caricate per analisi
- `analysis-logs` - Log analisi JSONL
- `test-images` - Immagini Test Lab
- `csv-files` - File CSV partecipanti
- `exports` - Export training data
- `face-photos` - Foto volti
- `installers` - Installer app

---

*Documento generato automaticamente - Ultimo aggiornamento: 2025-12-30*
