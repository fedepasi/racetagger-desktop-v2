/**
 * Performance Timer Utility
 * Tracks processing time for different phases of image processing
 *
 * BACKWARD COMPATIBLE: Safe to use even if phases are not properly closed
 */

export type ProcessingPhase =
  | 'raw_conversion'
  | 'resize'
  | 'ai_analysis'
  | 'metadata_write'
  | 'upload'
  | 'folder_organization'
  | 'other';

export interface PhaseTimings {
  raw_conversion_avg_ms: number;
  raw_conversion_total_ms: number;
  raw_conversion_count: number;

  resize_avg_ms: number;
  resize_total_ms: number;
  resize_count: number;

  ai_analysis_avg_ms: number;
  ai_analysis_total_ms: number;
  ai_analysis_count: number;

  metadata_write_avg_ms: number;
  metadata_write_total_ms: number;
  metadata_write_count: number;

  upload_avg_ms: number;
  upload_total_ms: number;
  upload_count: number;

  folder_organization_avg_ms: number;
  folder_organization_total_ms: number;
  folder_organization_count: number;

  other_avg_ms: number;
  other_total_ms: number;
  other_count: number;

  total_execution_ms: number;
}

interface PhaseData {
  total_ms: number;
  count: number;
}

/**
 * Performance Timer Class
 * Tracks start/end times for different processing phases
 */
export class PerformanceTimer {
  private phaseData: Map<ProcessingPhase, PhaseData> = new Map();
  private activePhases: Map<ProcessingPhase, number> = new Map();
  private executionStartTime: number;

  constructor() {
    this.executionStartTime = Date.now();
    this.initializePhases();
  }

  /**
   * Initialize all phases with zero values
   */
  private initializePhases(): void {
    const phases: ProcessingPhase[] = [
      'raw_conversion',
      'resize',
      'ai_analysis',
      'metadata_write',
      'upload',
      'folder_organization',
      'other'
    ];

    phases.forEach(phase => {
      this.phaseData.set(phase, { total_ms: 0, count: 0 });
    });
  }

  /**
   * Start timing a processing phase
   * Safe to call multiple times (will restart timer)
   */
  startPhase(phase: ProcessingPhase): void {
    try {
      const startTime = Date.now();
      this.activePhases.set(phase, startTime);
    } catch (error) {
      console.warn(`[PerformanceTimer] Failed to start phase ${phase}:`, error);
    }
  }

  /**
   * End timing a processing phase
   * Returns the duration in milliseconds
   * Safe to call even if phase was not started (returns 0)
   */
  endPhase(phase: ProcessingPhase): number {
    try {
      const endTime = Date.now();
      const startTime = this.activePhases.get(phase);

      if (startTime === undefined) {
        console.warn(`[PerformanceTimer] Phase ${phase} was ended but never started`);
        return 0;
      }

      const duration = endTime - startTime;

      // Update phase data
      const phaseStats = this.phaseData.get(phase);
      if (phaseStats) {
        phaseStats.total_ms += duration;
        phaseStats.count += 1;
      }

      // Clear active phase
      this.activePhases.delete(phase);

      return duration;
    } catch (error) {
      console.warn(`[PerformanceTimer] Failed to end phase ${phase}:`, error);
      return 0;
    }
  }

  /**
   * Record a phase timing manually (without start/end)
   * Useful when timing is already calculated elsewhere
   */
  recordPhase(phase: ProcessingPhase, durationMs: number): void {
    try {
      const phaseStats = this.phaseData.get(phase);
      if (phaseStats) {
        phaseStats.total_ms += durationMs;
        phaseStats.count += 1;
      }
    } catch (error) {
      console.warn(`[PerformanceTimer] Failed to record phase ${phase}:`, error);
    }
  }

  /**
   * Get complete timing breakdown for all phases
   */
  getTimings(): PhaseTimings {
    try {
      const totalExecutionMs = Date.now() - this.executionStartTime;

      const getPhaseTimings = (phase: ProcessingPhase) => {
        const data = this.phaseData.get(phase) || { total_ms: 0, count: 0 };
        const avg = data.count > 0 ? Math.round(data.total_ms / data.count) : 0;

        return {
          avg_ms: avg,
          total_ms: Math.round(data.total_ms),
          count: data.count
        };
      };

      const rawConversion = getPhaseTimings('raw_conversion');
      const resize = getPhaseTimings('resize');
      const aiAnalysis = getPhaseTimings('ai_analysis');
      const metadataWrite = getPhaseTimings('metadata_write');
      const upload = getPhaseTimings('upload');
      const folderOrg = getPhaseTimings('folder_organization');
      const other = getPhaseTimings('other');

      return {
        raw_conversion_avg_ms: rawConversion.avg_ms,
        raw_conversion_total_ms: rawConversion.total_ms,
        raw_conversion_count: rawConversion.count,

        resize_avg_ms: resize.avg_ms,
        resize_total_ms: resize.total_ms,
        resize_count: resize.count,

        ai_analysis_avg_ms: aiAnalysis.avg_ms,
        ai_analysis_total_ms: aiAnalysis.total_ms,
        ai_analysis_count: aiAnalysis.count,

        metadata_write_avg_ms: metadataWrite.avg_ms,
        metadata_write_total_ms: metadataWrite.total_ms,
        metadata_write_count: metadataWrite.count,

        upload_avg_ms: upload.avg_ms,
        upload_total_ms: upload.total_ms,
        upload_count: upload.count,

        folder_organization_avg_ms: folderOrg.avg_ms,
        folder_organization_total_ms: folderOrg.total_ms,
        folder_organization_count: folderOrg.count,

        other_avg_ms: other.avg_ms,
        other_total_ms: other.total_ms,
        other_count: other.count,

        total_execution_ms: Math.round(totalExecutionMs)
      };
    } catch (error) {
      console.warn('[PerformanceTimer] Failed to get timings, returning empty data:', error);
      return this.getEmptyTimings();
    }
  }

  /**
   * Get empty timings structure (fallback)
   */
  private getEmptyTimings(): PhaseTimings {
    return {
      raw_conversion_avg_ms: 0,
      raw_conversion_total_ms: 0,
      raw_conversion_count: 0,
      resize_avg_ms: 0,
      resize_total_ms: 0,
      resize_count: 0,
      ai_analysis_avg_ms: 0,
      ai_analysis_total_ms: 0,
      ai_analysis_count: 0,
      metadata_write_avg_ms: 0,
      metadata_write_total_ms: 0,
      metadata_write_count: 0,
      upload_avg_ms: 0,
      upload_total_ms: 0,
      upload_count: 0,
      folder_organization_avg_ms: 0,
      folder_organization_total_ms: 0,
      folder_organization_count: 0,
      other_avg_ms: 0,
      other_total_ms: 0,
      other_count: 0,
      total_execution_ms: 0
    };
  }

  /**
   * Get timing for a specific phase
   */
  getPhaseTime(phase: ProcessingPhase): { avg_ms: number; total_ms: number; count: number } {
    try {
      const data = this.phaseData.get(phase) || { total_ms: 0, count: 0 };
      const avg = data.count > 0 ? Math.round(data.total_ms / data.count) : 0;

      return {
        avg_ms: avg,
        total_ms: Math.round(data.total_ms),
        count: data.count
      };
    } catch (error) {
      return { avg_ms: 0, total_ms: 0, count: 0 };
    }
  }

  /**
   * Reset all timings (useful for new execution)
   */
  reset(): void {
    this.phaseData.clear();
    this.activePhases.clear();
    this.executionStartTime = Date.now();
    this.initializePhases();
  }

  /**
   * Get summary string for logging
   */
  getSummary(): string {
    const timings = this.getTimings();
    const parts: string[] = [];

    if (timings.raw_conversion_count > 0) {
      parts.push(`RAW: ${timings.raw_conversion_avg_ms}ms avg`);
    }
    if (timings.resize_count > 0) {
      parts.push(`Resize: ${timings.resize_avg_ms}ms avg`);
    }
    if (timings.ai_analysis_count > 0) {
      parts.push(`AI: ${timings.ai_analysis_avg_ms}ms avg`);
    }
    if (timings.upload_count > 0) {
      parts.push(`Upload: ${timings.upload_avg_ms}ms avg`);
    }

    parts.push(`Total: ${(timings.total_execution_ms / 1000).toFixed(1)}s`);

    return parts.join(', ');
  }
}

/**
 * Singleton instance for easy access
 */
export const performanceTimer = new PerformanceTimer();
