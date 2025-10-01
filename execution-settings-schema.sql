-- Schema per tracciare le impostazioni utente di ogni execution
-- Questo permette di analizzare l'uso dell'app e le preferenze degli utenti

CREATE TABLE execution_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Timestamp della registrazione
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- === IMPOSTAZIONI MODELLO AI ===
  ai_model TEXT, -- es: 'gemini-2.5-flash-lite-preview-06-17'
  sport_category TEXT, -- 'motorsport', 'running', 'altro'
  
  -- === GESTIONE METADATI ===
  metadata_strategy TEXT, -- 'xmp_full_analysis', 'xmp_custom_text', 'xmp_csv_data', 'xmp_race_number_only'
  manual_metadata_value TEXT, -- valore metatag manuale se utilizzato
  update_exif BOOLEAN DEFAULT true,
  save_preview_images BOOLEAN DEFAULT false,
  preview_folder TEXT,
  
  -- === CONFIGURAZIONI RESIZE ===
  resize_enabled BOOLEAN DEFAULT false,
  resize_preset TEXT, -- 'veloce', 'bilanciato', 'qualita'
  
  -- === ELABORAZIONE PARALLELA ===
  parallel_processing_enabled BOOLEAN DEFAULT false,
  streaming_pipeline_enabled BOOLEAN DEFAULT false,
  max_concurrent_uploads INTEGER,
  max_concurrent_analysis INTEGER,
  rate_limit_per_second INTEGER,
  batch_size INTEGER,
  
  -- === ORGANIZZAZIONE CARTELLE (ADMIN FEATURE) ===
  folder_organization_enabled BOOLEAN DEFAULT false,
  folder_organization_mode TEXT, -- 'copy', 'move'
  folder_organization_pattern TEXT, -- 'number', 'number_name', 'custom'
  folder_organization_custom_pattern TEXT,
  create_unknown_folder BOOLEAN DEFAULT true,
  unknown_folder_name TEXT DEFAULT 'Unknown',
  include_xmp_files BOOLEAN DEFAULT true,
  
  -- === OTTIMIZZAZIONI PERFORMANCE ===
  optimization_level TEXT, -- 'disabled', 'conservative', 'balanced', 'aggressive'
  performance_monitoring_enabled BOOLEAN DEFAULT true,
  session_resume_enabled BOOLEAN DEFAULT true,
  connection_pooling_enabled BOOLEAN DEFAULT false,
  raw_optimizations_enabled BOOLEAN DEFAULT false,
  raw_batch_size INTEGER,
  raw_cache_enabled BOOLEAN DEFAULT false,
  async_file_ops_enabled BOOLEAN DEFAULT false,
  database_optimizations_enabled BOOLEAN DEFAULT false,
  batch_operations_enabled BOOLEAN DEFAULT false,
  storage_optimizations_enabled BOOLEAN DEFAULT false,
  memory_optimizations_enabled BOOLEAN DEFAULT false,
  max_memory_usage_mb INTEGER,
  memory_pooling_enabled BOOLEAN DEFAULT false,
  cpu_optimizations_enabled BOOLEAN DEFAULT false,
  streaming_processing_enabled BOOLEAN DEFAULT false,
  auto_tuning_enabled BOOLEAN DEFAULT false,
  predictive_loading_enabled BOOLEAN DEFAULT false,
  
  -- === STATISTICHE ESECUZIONE ===
  total_images_processed INTEGER DEFAULT 0,
  total_raw_files INTEGER DEFAULT 0,
  total_standard_files INTEGER DEFAULT 0,
  csv_data_used BOOLEAN DEFAULT false,
  csv_entries_count INTEGER DEFAULT 0,
  
  -- === TIMING E PERFORMANCE ===
  execution_duration_ms INTEGER, -- durata totale esecuzione in millisecondi
  average_image_processing_time_ms INTEGER, -- tempo medio per immagine
  
  -- Indici per ottimizzare le query di analisi
  CONSTRAINT fk_execution_settings_execution FOREIGN KEY (execution_id) REFERENCES executions(id),
  CONSTRAINT fk_execution_settings_user FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Indici per performance nelle query di analisi
CREATE INDEX idx_execution_settings_user_id ON execution_settings(user_id);
CREATE INDEX idx_execution_settings_execution_id ON execution_settings(execution_id);
CREATE INDEX idx_execution_settings_created_at ON execution_settings(created_at);
CREATE INDEX idx_execution_settings_ai_model ON execution_settings(ai_model);
CREATE INDEX idx_execution_settings_optimization_level ON execution_settings(optimization_level);
CREATE INDEX idx_execution_settings_resize_preset ON execution_settings(resize_preset);
CREATE INDEX idx_execution_settings_metadata_strategy ON execution_settings(metadata_strategy);

-- Row Level Security
ALTER TABLE execution_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own execution settings
CREATE POLICY "Users can view own execution settings" ON execution_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own execution settings" ON execution_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own execution settings" ON execution_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own execution settings" ON execution_settings
  FOR DELETE USING (auth.uid() = user_id);

-- View per analisi aggregate (utile per dashboard admin)
CREATE VIEW execution_settings_analytics AS
SELECT 
  -- Conteggi per modelli AI
  ai_model,
  COUNT(*) as usage_count,
  
  -- Preferenze resize
  resize_preset,
  AVG(CASE WHEN resize_enabled THEN 1 ELSE 0 END) as resize_usage_rate,
  
  -- Utilizzo elaborazione parallela
  AVG(CASE WHEN parallel_processing_enabled THEN 1 ELSE 0 END) as parallel_usage_rate,
  AVG(CASE WHEN streaming_pipeline_enabled THEN 1 ELSE 0 END) as streaming_usage_rate,
  
  -- Livelli ottimizzazione più utilizzati
  optimization_level,
  
  -- Strategie metadati più popolari
  metadata_strategy,
  
  -- Performance medie
  AVG(execution_duration_ms) as avg_execution_duration_ms,
  AVG(average_image_processing_time_ms) as avg_image_processing_time_ms,
  AVG(total_images_processed) as avg_images_per_execution,
  
  -- Utilizzo funzionalità avanzate
  AVG(CASE WHEN folder_organization_enabled THEN 1 ELSE 0 END) as folder_org_usage_rate,
  AVG(CASE WHEN csv_data_used THEN 1 ELSE 0 END) as csv_usage_rate,
  
  -- Periodo di analisi
  DATE_TRUNC('month', created_at) as month_year
  
FROM execution_settings 
GROUP BY ai_model, resize_preset, optimization_level, metadata_strategy, DATE_TRUNC('month', created_at);

COMMENT ON TABLE execution_settings IS 'Traccia tutte le impostazioni scelte dall''utente per ogni execution per analizzare l''uso dell''app e le preferenze';
COMMENT ON VIEW execution_settings_analytics IS 'Vista aggregata per analizzare trend e preferenze degli utenti nell''uso dell''app';