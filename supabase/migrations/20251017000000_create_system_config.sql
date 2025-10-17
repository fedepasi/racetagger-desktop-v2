-- Migration: Create system_config table for centralized configuration
-- Purpose: Store configurable system values like signup bonus tokens
-- Date: 2025-10-17

-- Create system_config table
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS policies
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Allow admins to read/write
CREATE POLICY "Admins can manage system_config"
  ON system_config
  FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (
      'info@federicopasinetti.it',
      'info@racetagger.cloud'
    )
  );

-- Allow all authenticated users to read config
CREATE POLICY "Authenticated users can read system_config"
  ON system_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Insert default configuration values
INSERT INTO system_config (key, value, description) VALUES
  (
    'signup_bonus_tokens',
    '1500'::jsonb,
    'Number of free tokens granted upon user registration'
  ),
  (
    'token_value_usd',
    '0.02'::jsonb,
    'Monetary value in USD per token'
  )
ON CONFLICT (key) DO NOTHING;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_system_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW
  EXECUTE FUNCTION update_system_config_updated_at();

-- Add comment
COMMENT ON TABLE system_config IS 'Centralized system configuration for runtime values like signup bonuses, feature flags, etc.';
