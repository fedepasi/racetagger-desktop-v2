-- Migration: Create Export Destinations table
-- Unified system that replaces Folder 1/2/3 and Agencies
-- Each destination has its own path, metadata, and filename pattern

CREATE TABLE IF NOT EXISTS export_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,

  -- === PATH ===
  base_folder TEXT,                              -- Local folder path
  subfolder_pattern VARCHAR(255) DEFAULT '{team}/{number}',  -- Subfolder structure

  -- === FILENAME RENAMING ===
  filename_pattern VARCHAR(255),                 -- e.g. "{surname}_{seq}"
  filename_sequence_start INTEGER DEFAULT 1,
  filename_sequence_padding INTEGER DEFAULT 3,   -- e.g. 001, 0001
  filename_sequence_mode VARCHAR(20) DEFAULT 'per_subject',  -- global, per_subject, per_folder
  preserve_original_name BOOLEAN DEFAULT TRUE,   -- Fallback if no match

  -- === CREDITS (vary per agency) ===
  credit VARCHAR(255),                           -- photoshop:Credit
  source VARCHAR(255),                           -- photoshop:Source
  copyright VARCHAR(255),                        -- dc:rights
  copyright_owner VARCHAR(255),                  -- plus:CopyrightOwnerName

  -- === CREATOR INFO ===
  creator VARCHAR(255),                          -- dc:creator
  authors_position VARCHAR(100),                 -- photoshop:AuthorsPosition
  caption_writer VARCHAR(255),                   -- photoshop:CaptionWriter

  -- === CONTACT INFO ===
  contact_address TEXT,
  contact_city VARCHAR(100),
  contact_region VARCHAR(100),
  contact_postal_code VARCHAR(20),
  contact_country VARCHAR(100),
  contact_phone VARCHAR(50),
  contact_email VARCHAR(255),
  contact_website VARCHAR(255),

  -- === EVENT INFO TEMPLATES ===
  headline_template VARCHAR(500),                -- photoshop:Headline with placeholders
  title_template VARCHAR(500),                   -- dc:title with placeholders
  event_template VARCHAR(500),                   -- Iptc4xmpExt:Event with placeholders
  description_template TEXT,                     -- dc:description with placeholders
  category VARCHAR(10) DEFAULT 'SPO',            -- photoshop:Category (SPO = Sports)

  -- === LOCATION ===
  city VARCHAR(100),
  country VARCHAR(100),
  country_code VARCHAR(3),
  location VARCHAR(255),                         -- Sub-location/venue
  world_region VARCHAR(100),

  -- === KEYWORDS ===
  base_keywords TEXT[],                          -- Fixed keywords for this destination
  append_keywords BOOLEAN DEFAULT TRUE,          -- Append to existing image keywords

  -- === PERSON SHOWN ===
  person_shown_template VARCHAR(255),            -- "{name} ({nationality}) {team}"

  -- === BEHAVIOR ===
  auto_apply BOOLEAN DEFAULT FALSE,              -- Apply automatically to all images
  apply_condition VARCHAR(255),                  -- Conditional: "team:Ferrari" or "number:16"
  is_default BOOLEAN DEFAULT FALSE,              -- Default destination
  is_active BOOLEAN DEFAULT TRUE,                -- Enable/disable without deleting
  display_order INTEGER DEFAULT 0,               -- Sort order in UI

  -- === FTP/SFTP (Pro tier only) ===
  upload_method VARCHAR(10) DEFAULT 'local',     -- local, ftp, sftp
  ftp_host VARCHAR(255),
  ftp_port INTEGER DEFAULT 21,
  ftp_username VARCHAR(255),
  ftp_password_encrypted TEXT,                   -- Encrypted with Electron safeStorage
  ftp_remote_path VARCHAR(500),
  ftp_passive_mode BOOLEAN DEFAULT TRUE,
  ftp_secure BOOLEAN DEFAULT TRUE,               -- FTPS/TLS
  ftp_concurrent_uploads INTEGER DEFAULT 3,
  ftp_retry_attempts INTEGER DEFAULT 3,
  ftp_timeout_seconds INTEGER DEFAULT 30,
  keep_local_copy BOOLEAN DEFAULT TRUE,          -- Keep local after FTP upload

  -- === TIMESTAMPS ===
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- === CONSTRAINTS ===
  UNIQUE(user_id, name)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_export_destinations_user
  ON export_destinations(user_id);

CREATE INDEX IF NOT EXISTS idx_export_destinations_active
  ON export_destinations(user_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_export_destinations_default
  ON export_destinations(user_id, is_default)
  WHERE is_default = TRUE;

-- Enable Row Level Security
ALTER TABLE export_destinations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only manage their own destinations
CREATE POLICY "Users manage own export destinations"
  ON export_destinations
  FOR ALL
  USING (auth.uid() = user_id);

-- Add comments for documentation
COMMENT ON TABLE export_destinations IS 'User-defined export destinations with metadata templates, filename patterns, and optional FTP upload';
COMMENT ON COLUMN export_destinations.subfolder_pattern IS 'Pattern for organizing into subfolders. Placeholders: {team}, {number}, {name}, {event}, {date}';
COMMENT ON COLUMN export_destinations.filename_pattern IS 'Pattern for renaming files. Placeholders: {original}, {surname}, {number}, {seq}, {date}, {event}';
COMMENT ON COLUMN export_destinations.filename_sequence_mode IS 'How sequences reset: global (never), per_subject (per participant), per_folder (per output folder)';
COMMENT ON COLUMN export_destinations.apply_condition IS 'Conditional auto-apply rule, e.g. "team:Ferrari" or "number:16"';
COMMENT ON COLUMN export_destinations.upload_method IS 'Upload method: local (copy to folder), ftp, sftp. FTP/SFTP requires Professional tier or above';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_export_destinations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_export_destinations_updated_at ON export_destinations;
CREATE TRIGGER trigger_export_destinations_updated_at
  BEFORE UPDATE ON export_destinations
  FOR EACH ROW
  EXECUTE FUNCTION update_export_destinations_updated_at();

-- Create user_settings table for migration flag and other settings
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, setting_key)
);

-- RLS for user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings"
  ON user_settings
  FOR ALL
  USING (auth.uid() = user_id);

-- Index for user settings
CREATE INDEX IF NOT EXISTS idx_user_settings_user_key
  ON user_settings(user_id, setting_key);
