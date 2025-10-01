-- Tabella per gli admin (deve essere creata per prima)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabella per gli iscritti all'accesso anticipato
CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  position INTEGER NOT NULL,
  signup_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  has_access BOOLEAN DEFAULT FALSE,
  access_code TEXT,
  referral_source TEXT
);

-- Tabella per la lista d'attesa (dopo i primi 50)
CREATE TABLE IF NOT EXISTS waiting_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  signup_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_early_access BOOLEAN DEFAULT FALSE
);

-- Policy RLS per proteggere i dati
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiting_list ENABLE ROW LEVEL SECURITY;

-- Solo gli admin possono vedere tutti i dati (ora admin_users esiste già)
CREATE POLICY "Admin can see all subscribers" ON subscribers
  FOR SELECT USING (auth.uid() IN (SELECT id FROM admin_users));
  
CREATE POLICY "Admin can see all waiting list" ON waiting_list
  FOR SELECT USING (auth.uid() IN (SELECT id FROM admin_users));
