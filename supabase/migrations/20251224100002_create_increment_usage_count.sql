-- Migration: Create increment_usage_count RPC function
-- Purpose: Atomically increment usage_count and update last_used_at for presets
-- Date: 2025-12-24
-- Fixes: "invalid input syntax for type integer" error in participant_presets update

CREATE OR REPLACE FUNCTION increment_usage_count(
  p_preset_id uuid
)
RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
  v_user_id uuid;
BEGIN
  -- Get the current user
  v_user_id := auth.uid();

  -- Atomically increment usage_count and update last_used_at
  UPDATE participant_presets
  SET
    usage_count = COALESCE(usage_count, 0) + 1,
    last_used_at = NOW()
  WHERE id = p_preset_id
    AND user_id = v_user_id
  RETURNING usage_count INTO new_count;

  -- If no row was updated, return error
  IF new_count IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Preset not found or not owned by user'
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'new_count', new_count
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_usage_count IS 'Atomically increment preset usage count and update last_used_at timestamp';
