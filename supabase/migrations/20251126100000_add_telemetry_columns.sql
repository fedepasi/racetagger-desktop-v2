-- Migration: Add Telemetry Columns to Executions Table
-- Date: 2025-11-26
-- Description: Adds columns for TIER 1 telemetry data collection

-- =====================================================
-- Add telemetry columns to executions table
-- =====================================================

-- Performance breakdown: timing data for each phase
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS performance_breakdown JSONB;

-- Memory stats: heap usage during execution
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS memory_stats JSONB;

-- Network stats: upload speed, latency, etc.
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS network_stats JSONB;

-- Error summary: aggregated error information
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS error_summary JSONB;

-- Comments
COMMENT ON COLUMN executions.performance_breakdown IS 'Timing breakdown by processing phase (ms)';
COMMENT ON COLUMN executions.memory_stats IS 'Memory usage statistics (peak_mb, average_mb, baseline_mb)';
COMMENT ON COLUMN executions.network_stats IS 'Network performance metrics (upload_speed_mbps, latency_ms)';
COMMENT ON COLUMN executions.error_summary IS 'Aggregated error counts and types';
