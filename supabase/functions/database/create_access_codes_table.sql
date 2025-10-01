CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_value TEXT UNIQUE NOT NULL,
  subscriber_email TEXT,
  tokens_to_grant INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', -- Possible values: 'active', 'used', 'expired', 'activation_error'
  is_used BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP WITH TIME ZONE,
  user_id_activated UUID REFERENCES auth.users(id), -- The user who activated this code
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE
);

-- Add comments to clarify column purposes
COMMENT ON COLUMN access_codes.code_value IS 'The unique access code string.';
COMMENT ON COLUMN access_codes.subscriber_email IS 'The email of the subscriber this code is intended for (can be null if generic).';
COMMENT ON COLUMN access_codes.tokens_to_grant IS 'Number of tokens to grant to the user upon activation.';
COMMENT ON COLUMN access_codes.status IS 'Current status of the access code (e.g., active, used, expired).';
COMMENT ON COLUMN access_codes.is_used IS 'Boolean flag indicating if the code has been successfully used.';
COMMENT ON COLUMN access_codes.expires_at IS 'Timestamp when the code expires (can be null if no expiration).';
COMMENT ON COLUMN access_codes.user_id_activated IS 'The auth.users.id of the user who successfully activated this code.';
COMMENT ON COLUMN access_codes.used_at IS 'Timestamp when the code was successfully used.';

-- Row Level Security
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

-- Policies:
-- Admins should have full access.
-- For now, no policies for non-admin users as codes are typically verified by backend functions.
-- If direct client-side checks are ever needed, specific policies would be required.

-- Example policy for admins (assuming an admin_users table or a custom claim)
-- CREATE POLICY "Admins can manage access codes" ON access_codes
--   FOR ALL
--   USING (is_admin(auth.uid())) -- Replace is_admin with your actual admin check function/logic
--   WITH CHECK (is_admin(auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_access_codes_code_value ON access_codes(code_value);
CREATE INDEX IF NOT EXISTS idx_access_codes_subscriber_email ON access_codes(subscriber_email);
CREATE INDEX IF NOT EXISTS idx_access_codes_status ON access_codes(status);
CREATE INDEX IF NOT EXISTS idx_access_codes_user_id_activated ON access_codes(user_id_activated);
