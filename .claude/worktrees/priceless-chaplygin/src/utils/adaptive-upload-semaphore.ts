/**
 * Adaptive Upload Semaphore
 *
 * Controls concurrent upload slots using AIMD (Additive Increase, Multiplicative Decrease)
 * congestion control — the same principle behind TCP.
 *
 * Behavior:
 * - Starts at a moderate concurrency (4 slots)
 * - Measures per-upload throughput and latency
 * - When uploads are fast and stable → slowly increases concurrency (+1)
 * - When uploads slow down or fail → aggressively reduces concurrency (÷2)
 * - Ensures maximum bandwidth utilization on fast connections (fiber)
 * - Protects against congestion on slow connections (Dakar, rural, mobile)
 *
 * This ensures RaceTagger uses ALL available bandwidth without ever saturating it.
 */

import { EventEmitter } from 'events';

// ============================================================
// Types
// ============================================================

interface UploadMetric {
  durationMs: number;
  sizeBytes: number;
  throughputMBps: number;
  success: boolean;
  timestamp: number;
}

interface SemaphoreState {
  currentConcurrency: number;
  activeUploads: number;
  queueLength: number;
  avgThroughputMBps: number;
  avgLatencyMs: number;
  recentFailureRate: number;
  totalUploads: number;
  totalBytesUploaded: number;
}

export interface AdaptiveUploadConfig {
  /** Initial concurrent upload slots (default: 4) */
  initialConcurrency: number;
  /** Minimum concurrent slots — never go below this (default: 1) */
  minConcurrency: number;
  /** Maximum concurrent slots — ceiling based on optimization level (default: 12) */
  maxConcurrency: number;
  /** How many completed uploads before evaluating throughput (default: 5) */
  evaluationWindow: number;
  /** Throughput improvement threshold to increase concurrency (default: 0.05 = 5%) */
  increaseThreshold: number;
  /** Throughput degradation threshold to decrease concurrency (default: -0.15 = -15%) */
  decreaseThreshold: number;
  /** Failure rate threshold to trigger decrease (default: 0.10 = 10%) */
  failureRateThreshold: number;
  /** Max latency (ms) before triggering decrease (default: 15000) */
  maxAcceptableLatencyMs: number;
  /** Sliding window size for metrics (default: 20) */
  metricsWindowSize: number;
}

const DEFAULT_CONFIG: AdaptiveUploadConfig = {
  initialConcurrency: 4,
  minConcurrency: 1,
  maxConcurrency: 12,
  evaluationWindow: 5,
  increaseThreshold: 0.05,
  decreaseThreshold: -0.15,
  failureRateThreshold: 0.10,
  maxAcceptableLatencyMs: 15000,
  metricsWindowSize: 20,
};

// ============================================================
// Adaptive Upload Semaphore
// ============================================================

export class AdaptiveUploadSemaphore extends EventEmitter {
  private config: AdaptiveUploadConfig;
  private currentConcurrency: number;
  private activeCount: number = 0;
  private waitQueue: Array<() => void> = [];
  private metrics: UploadMetric[] = [];
  private uploadsSinceLastEval: number = 0;
  private previousAvgThroughput: number = 0;
  private totalUploads: number = 0;
  private totalBytesUploaded: number = 0;
  private consecutiveIncreases: number = 0;
  private disposed: boolean = false;

  constructor(config: Partial<AdaptiveUploadConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentConcurrency = this.config.initialConcurrency;
  }

  /**
   * Acquire an upload slot. Resolves when a slot is available.
   * If all slots are in use, the caller waits in a FIFO queue.
   */
  async acquire(): Promise<void> {
    if (this.activeCount < this.currentConcurrency) {
      this.activeCount++;
      return;
    }

    // Wait for a slot to become available
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeCount++;
        resolve();
      });
    });
  }

  /**
   * Release an upload slot and record the upload metrics.
   * Triggers AIMD evaluation after every `evaluationWindow` uploads.
   */
  release(durationMs: number, sizeBytes: number, success: boolean): void {
    this.activeCount = Math.max(0, this.activeCount - 1);

    // Record metrics
    const throughputMBps = success && durationMs > 0
      ? (sizeBytes / (1024 * 1024)) / (durationMs / 1000)
      : 0;

    const metric: UploadMetric = {
      durationMs,
      sizeBytes,
      throughputMBps,
      success,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);
    if (this.metrics.length > this.config.metricsWindowSize) {
      this.metrics.shift();
    }

    this.totalUploads++;
    if (success) {
      this.totalBytesUploaded += sizeBytes;
    }

    this.uploadsSinceLastEval++;

    // Evaluate congestion control after every N uploads
    if (this.uploadsSinceLastEval >= this.config.evaluationWindow) {
      this.evaluate();
      this.uploadsSinceLastEval = 0;
    }

    // Wake up next waiter if slots available
    this.drainQueue();
  }

  /**
   * Release a slot without recording metrics (e.g., on error before upload started).
   */
  releaseWithoutMetrics(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.drainQueue();
  }

  /**
   * AIMD Congestion Control Evaluation
   *
   * Additive Increase: if throughput is improving and stable → concurrency + 1
   * Multiplicative Decrease: if throughput drops or failures spike → concurrency ÷ 2
   */
  private evaluate(): void {
    if (this.disposed || this.metrics.length < this.config.evaluationWindow) return;

    const recentMetrics = this.metrics.slice(-this.config.evaluationWindow);
    const successMetrics = recentMetrics.filter(m => m.success);
    const failureRate = 1 - (successMetrics.length / recentMetrics.length);

    // Calculate current average throughput (aggregate MB/s across all concurrent uploads)
    const avgThroughput = successMetrics.length > 0
      ? successMetrics.reduce((sum, m) => sum + m.throughputMBps, 0) / successMetrics.length
      : 0;

    const avgLatency = successMetrics.length > 0
      ? successMetrics.reduce((sum, m) => sum + m.durationMs, 0) / successMetrics.length
      : Infinity;

    const previousConcurrency = this.currentConcurrency;

    // === MULTIPLICATIVE DECREASE ===
    // Triggered by: high failure rate, extreme latency, or significant throughput drop
    if (failureRate > this.config.failureRateThreshold) {
      // Failures indicate network congestion or server overload
      this.currentConcurrency = Math.max(
        this.config.minConcurrency,
        Math.floor(this.currentConcurrency / 2)
      );
      this.consecutiveIncreases = 0;
      console.log(`[UploadSemaphore] ⚠️ DECREASE (failures ${(failureRate * 100).toFixed(0)}%): ${previousConcurrency} → ${this.currentConcurrency} slots`);
    } else if (avgLatency > this.config.maxAcceptableLatencyMs) {
      // High latency indicates saturated connection
      this.currentConcurrency = Math.max(
        this.config.minConcurrency,
        Math.floor(this.currentConcurrency * 0.7)  // Less aggressive decrease for latency
      );
      this.consecutiveIncreases = 0;
      console.log(`[UploadSemaphore] ⚠️ DECREASE (latency ${avgLatency.toFixed(0)}ms): ${previousConcurrency} → ${this.currentConcurrency} slots`);
    } else if (this.previousAvgThroughput > 0) {
      const throughputChange = (avgThroughput - this.previousAvgThroughput) / this.previousAvgThroughput;

      if (throughputChange < this.config.decreaseThreshold) {
        // Throughput dropped significantly — bandwidth is saturated
        this.currentConcurrency = Math.max(
          this.config.minConcurrency,
          Math.floor(this.currentConcurrency / 2)
        );
        this.consecutiveIncreases = 0;
        console.log(`[UploadSemaphore] ⚠️ DECREASE (throughput ${(throughputChange * 100).toFixed(0)}%): ${previousConcurrency} → ${this.currentConcurrency} slots`);
      } else if (throughputChange > this.config.increaseThreshold) {
        // === ADDITIVE INCREASE ===
        // Throughput is improving — room for more concurrency
        this.consecutiveIncreases++;

        // Be more aggressive after consecutive improvements (slow start → rapid ramp)
        const increment = this.consecutiveIncreases >= 3 ? 2 : 1;
        this.currentConcurrency = Math.min(
          this.config.maxConcurrency,
          this.currentConcurrency + increment
        );

        if (this.currentConcurrency !== previousConcurrency) {
          console.log(`[UploadSemaphore] ✅ INCREASE (throughput +${(throughputChange * 100).toFixed(0)}%): ${previousConcurrency} → ${this.currentConcurrency} slots`);
        }
      }
      // else: throughput stable — maintain current concurrency (no action)
    }

    this.previousAvgThroughput = avgThroughput;

    // Emit state change for monitoring
    this.emit('evaluation', {
      concurrency: this.currentConcurrency,
      avgThroughputMBps: avgThroughput,
      avgLatencyMs: avgLatency,
      failureRate,
      totalUploads: this.totalUploads,
    });
  }

  /**
   * Wake up waiters if slots are available.
   */
  private drainQueue(): void {
    while (this.waitQueue.length > 0 && this.activeCount < this.currentConcurrency) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }

  /**
   * Get current semaphore state for monitoring/logging.
   */
  getState(): SemaphoreState {
    const successMetrics = this.metrics.filter(m => m.success);
    const recentFailureRate = this.metrics.length > 0
      ? 1 - (successMetrics.length / this.metrics.length)
      : 0;

    return {
      currentConcurrency: this.currentConcurrency,
      activeUploads: this.activeCount,
      queueLength: this.waitQueue.length,
      avgThroughputMBps: successMetrics.length > 0
        ? successMetrics.reduce((sum, m) => sum + m.throughputMBps, 0) / successMetrics.length
        : 0,
      avgLatencyMs: successMetrics.length > 0
        ? successMetrics.reduce((sum, m) => sum + m.durationMs, 0) / successMetrics.length
        : 0,
      recentFailureRate,
      totalUploads: this.totalUploads,
      totalBytesUploaded: this.totalBytesUploaded,
    };
  }

  /**
   * Get current concurrency level.
   */
  getConcurrency(): number {
    return this.currentConcurrency;
  }

  /**
   * Reset semaphore to initial state (e.g., between batch executions).
   */
  reset(): void {
    this.currentConcurrency = this.config.initialConcurrency;
    this.activeCount = 0;
    this.metrics = [];
    this.uploadsSinceLastEval = 0;
    this.previousAvgThroughput = 0;
    this.consecutiveIncreases = 0;
    this.totalUploads = 0;
    this.totalBytesUploaded = 0;

    // Reject all waiters
    while (this.waitQueue.length > 0) {
      this.waitQueue.shift();
    }
  }

  /**
   * Dispose the semaphore and release all waiters.
   */
  dispose(): void {
    this.disposed = true;
    this.reset();
    this.removeAllListeners();
  }
}
