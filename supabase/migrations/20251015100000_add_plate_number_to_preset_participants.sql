-- Add missing columns to preset_participants table
-- These columns were added to the local SQLite database and need to be synced to Supabase

-- Add categoria column (category field)
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS categoria TEXT;

-- Add plate_number column (license plate for car recognition)
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS plate_number TEXT;

-- Add folder organization columns
ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS folder_1 TEXT;

ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS folder_2 TEXT;

ALTER TABLE preset_participants
ADD COLUMN IF NOT EXISTS folder_3 TEXT;

-- Add comments to document the columns
COMMENT ON COLUMN preset_participants.categoria IS 'Category of the participant (e.g., GT3, F1, MotoGP)';
COMMENT ON COLUMN preset_participants.plate_number IS 'License plate number for future car recognition integration';
COMMENT ON COLUMN preset_participants.folder_1 IS 'First custom folder assignment';
COMMENT ON COLUMN preset_participants.folder_2 IS 'Second custom folder assignment';
COMMENT ON COLUMN preset_participants.folder_3 IS 'Third custom folder assignment';
