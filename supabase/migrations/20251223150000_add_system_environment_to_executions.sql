-- Migration: Add telemetry columns to executions table
-- Date: 2025-12-23
-- Description: Stores hardware, network, software telemetry and performance stats from desktop app
-- These columns store the same data as JSONL EXECUTION_START and EXECUTION_COMPLETE events

-- =====================================================
-- EXECUTION_START telemetry (system environment)
-- =====================================================

-- System environment: hardware (CPU, RAM, disk), network (type, latency), software (node, electron)
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS system_environment JSONB DEFAULT NULL;

COMMENT ON COLUMN executions.system_environment IS 'System telemetry: hardware, network, software info from EXECUTION_START';

-- =====================================================
-- EXECUTION_COMPLETE telemetry (performance stats)
-- =====================================================

-- Performance breakdown by phase (rawConversion, upload, analysis, etc.)
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS performance_breakdown JSONB DEFAULT NULL;

COMMENT ON COLUMN executions.performance_breakdown IS 'Performance timing breakdown by processing phase';

-- Memory usage stats (peak, average, baseline)
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS memory_stats JSONB DEFAULT NULL;

COMMENT ON COLUMN executions.memory_stats IS 'Memory usage statistics during execution';

-- Network performance stats (upload speed, success rate, avg upload time)
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS network_stats JSONB DEFAULT NULL;

COMMENT ON COLUMN executions.network_stats IS 'Network performance metrics during execution';

-- Error summary (counts by type)
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS error_summary JSONB DEFAULT NULL;

COMMENT ON COLUMN executions.error_summary IS 'Summary of errors by type during execution';

-- =====================================================
-- Indexes for analytics queries
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_executions_system_environment
ON executions USING gin (system_environment);

CREATE INDEX IF NOT EXISTS idx_executions_performance_breakdown
ON executions USING gin (performance_breakdown);
