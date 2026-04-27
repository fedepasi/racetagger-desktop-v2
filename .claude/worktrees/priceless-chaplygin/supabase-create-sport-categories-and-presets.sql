-- ====================================
-- CREAZIONE TABELLE PER SISTEMA CATEGORIE SPORTIVE E PARTICIPANT PRESETS
-- Eseguire in Supabase SQL Editor
-- ====================================

-- 1. TABELLA CATEGORIE SPORTIVE
CREATE TABLE sport_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  ai_prompt TEXT NOT NULL,
  fallback_prompt TEXT,
  expected_fields JSONB,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  edge_function_version INTEGER DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TABELLA PARTICIPANT PRESETS
CREATE TABLE participant_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES sport_categories(id),
  description TEXT,
  is_template BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,
  UNIQUE(user_id, name)
);

-- 3. TABELLA PRESET PARTICIPANTS
CREATE TABLE preset_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES participant_presets(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  nome TEXT,
  categoria TEXT,
  squadra TEXT,
  navigatore TEXT,
  sponsor TEXT,
  metatag TEXT,
  custom_fields JSONB,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. TABELLA FEATURE FLAGS
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  feature_name TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  rollout_percentage INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, feature_name)
);

-- 5. Enable RLS su tutte le tabelle
ALTER TABLE sport_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies per sport_categories
-- Tutti possono leggere le categorie, solo admin possono modificarle
CREATE POLICY "public_read_categories" ON sport_categories
  FOR SELECT USING (true);

CREATE POLICY "admin_manage_categories" ON sport_categories
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid())
  );

-- 7. RLS Policies per participant_presets
-- Utenti vedono i propri preset e quelli pubblici
CREATE POLICY "users_view_presets" ON participant_presets
  FOR SELECT USING (auth.uid() = user_id OR is_public = true);

-- Utenti gestiscono solo i propri preset
CREATE POLICY "users_manage_own_presets" ON participant_presets
  FOR ALL USING (auth.uid() = user_id);

-- 8. RLS Policies per preset_participants
-- Utenti vedono partecipanti dei preset accessibili
CREATE POLICY "users_view_participants" ON preset_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM participant_presets
      WHERE id = preset_id AND (user_id = auth.uid() OR is_public = true)
    )
  );

-- Utenti gestiscono partecipanti solo dei propri preset
CREATE POLICY "users_manage_participants" ON preset_participants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM participant_presets
      WHERE id = preset_id AND user_id = auth.uid()
    )
  );

-- 9. RLS Policies per feature_flags
CREATE POLICY "users_read_own_flags" ON feature_flags
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "admin_manage_flags" ON feature_flags
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid())
  );

-- 10. Funzione per aggiornare updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 11. Trigger per updated_at
CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON sport_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_presets_updated_at
  BEFORE UPDATE ON participant_presets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 12. Insert categorie di default
INSERT INTO sport_categories (code, name, description, icon, ai_prompt, display_order, expected_fields) VALUES
('motorsport', 'Motorsport', 'Auto, moto, kart e rally', '🏎️',
 'Analyze the provided image for all identifiable race vehicles (cars, motorcycles, karts, etc.). For each vehicle detected, extract the following information if clearly visible:
- raceNumber: The primary race number (string, or null if not found/readable) don''t invent data.
- driverNames: Names of drivers visible on the vehicle or racing suits
- teamName: Team or sponsor names
- vehicleType: Type of vehicle (car/motorcycle/kart)
- additionalText: Any other relevant text (sponsors, series names, etc.)', 1,
 '{"fields": ["numero", "nome", "navigatore", "squadra", "sponsor", "categoria"]}'::jsonb),

('running', 'Running', 'Corsa podistica, maratone, trail', '🏃',
 'Analyze the provided image to identify runners or athletes. For each person detected, extract:
- bibNumber: The race bib number worn by the runner
- athleteName: Name if visible on bib or jersey
- teamName: Team or club name if visible
- eventText: Any event-related text
Focus on clearly visible bib numbers and avoid inventing data.', 2,
 '{"fields": ["numero", "nome", "squadra", "categoria", "tempo"]}'::jsonb),

('cycling', 'Ciclismo', 'Ciclismo su strada, MTB, ciclocross', '🚴',
 'Analyze the provided image for cyclists. For each cyclist detected, extract:
- raceNumber: The rider number on jersey or bike
- riderName: Name if visible on jersey
- teamName: Team name from jersey
- bikeNumber: Number on the bicycle frame if different
- sponsors: Visible sponsor text', 3,
 '{"fields": ["numero", "nome", "squadra", "sponsor", "categoria"]}'::jsonb),

('altro', 'Altro', 'Altri sport', '🏅',
 'Analyze the provided image for any competitors or participants. Extract:
- competitorNumber: Any visible number identifying the participant
- participantName: Name if visible
- teamOrClub: Team or organization name
- sportCategory: Try to identify the sport
- additionalInfo: Any other relevant text or numbers', 4,
 '{"fields": ["numero", "nome", "squadra", "categoria", "info"]}'::jsonb);

-- 13. Creazione indici per performance
CREATE INDEX idx_sport_categories_code ON sport_categories(code);
CREATE INDEX idx_sport_categories_active ON sport_categories(is_active, display_order);
CREATE INDEX idx_participant_presets_user_id ON participant_presets(user_id);
CREATE INDEX idx_participant_presets_category ON participant_presets(category_id);
CREATE INDEX idx_participant_presets_public ON participant_presets(is_public) WHERE is_public = true;
CREATE INDEX idx_preset_participants_preset_id ON preset_participants(preset_id);
CREATE INDEX idx_preset_participants_numero ON preset_participants(numero);
CREATE INDEX idx_feature_flags_user_feature ON feature_flags(user_id, feature_name);

-- 14. Commenti sulle tabelle per documentazione
COMMENT ON TABLE sport_categories IS 'Categorie sportive con prompt AI personalizzati';
COMMENT ON TABLE participant_presets IS 'Preset di partecipanti salvati dagli utenti';
COMMENT ON TABLE preset_participants IS 'Lista partecipanti per ogni preset';
COMMENT ON TABLE feature_flags IS 'Feature flags per rollout graduale funzionalità';

-- ====================================
-- FINE CREAZIONE TABELLE
-- Esegui tutto insieme in Supabase SQL Editor
-- ====================================