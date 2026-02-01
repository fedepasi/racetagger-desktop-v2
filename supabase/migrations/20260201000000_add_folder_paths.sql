-- Add absolute filesystem path columns for custom folders on preset participants
-- These allow photos to be saved directly to a specific path instead of a subfolder

ALTER TABLE preset_participants ADD COLUMN IF NOT EXISTS folder_1_path TEXT;
ALTER TABLE preset_participants ADD COLUMN IF NOT EXISTS folder_2_path TEXT;
ALTER TABLE preset_participants ADD COLUMN IF NOT EXISTS folder_3_path TEXT;
