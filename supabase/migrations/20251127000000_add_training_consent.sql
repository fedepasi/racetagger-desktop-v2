-- Migration: Add training consent tracking for Local ONNX feature parity
-- Date: 2025-11-27
-- Purpose: Enable token deduction and tracking for local ONNX inference with user consent

-- ============================================
-- 1. Add training consent to subscribers table
-- ============================================
ALTER TABLE subscribers
ADD COLUMN IF NOT EXISTS training_consent BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS training_consent_updated_at TIMESTAMPTZ;

-- Comment for documentation
COMMENT ON COLUMN subscribers.training_consent IS 'User consent for using their images to improve AI model (opt-out, default true)';
COMMENT ON COLUMN subscribers.training_consent_updated_at IS 'Timestamp when consent was last updated';

-- ============================================
-- 2. Add training eligibility to analysis_results
-- ============================================
ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS training_eligible BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS user_consent_at_analysis BOOLEAN;

-- Comment for documentation
COMMENT ON COLUMN analysis_results.training_eligible IS 'Whether this analysis result can be used for model training';
COMMENT ON COLUMN analysis_results.user_consent_at_analysis IS 'Snapshot of user consent status at time of analysis';

-- ============================================
-- 3. Create index for efficient training data queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_analysis_results_training_eligible
ON analysis_results(training_eligible)
WHERE training_eligible = true;

-- ============================================
-- 4. Update existing users to have consent=true (opt-out default)
-- ============================================
UPDATE subscribers
SET training_consent = true
WHERE training_consent IS NULL;

-- ============================================
-- 5. Update existing analysis_results to be training eligible
-- ============================================
UPDATE analysis_results
SET training_eligible = true,
    user_consent_at_analysis = true
WHERE training_eligible IS NULL;
