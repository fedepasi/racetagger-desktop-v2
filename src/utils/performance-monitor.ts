/**
 * Performance Monitoring System for Racetagger Desktop
 * Tracks processing times, memory usage, and throughput metrics
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface PerformanceMetrics {
  processingTime: number;
  memoryUsage: NodeJS.MemoryUsage;
  timestamp: number;
  imageCount: number;
  batchSize: number;
  phase?: string;
  taskType?: string;
  success: boolean;
  errorMessage?: string;
}

export interface BenchmarkResult {
  testName: string;
  imageCount: number;
  totalTime: number;
  averageTimePerImage: number;
  throughputPerSecond: number;
  memoryPeak: number;
  memoryAverage: number;
  successRate: number;
  timestamp: number;
  optimizationsEnabled: string[];
}

export interface PerformanceStats {
  averageProcessingTime: number;
  medianProcessingTime: number;
  throughputPerSecond: number;
  memoryUsageAverage: number;
  memoryUsagePeak: number;
  successRate: number;
  totalProcessed: number;
}

/**
 * Main performance monitoring class
 */
export class PerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetrics[] = [];
  private benchmarks: BenchmarkResult[] = [];
  private currentBatch: {
    startTime: number;
    imageCount: number;
    batchId: string;
    memoryBaseline: number;
  } | null = null;
  
  private dataFile: string;
  private maxMetricsInMemory = 1000;
  private isEnabled = true;

  constructor() {
    super();
    this.dataFile = path.join(app?.getPath('userData') || './data', 'performance-data.json');
    this.loadPersistedData();
  }

  /**
   * Start monitoring a batch processing session
   */
  startBatch(batchId: string, imageCount: number): void {
    if (!this.isEnabled) return;

    this.currentBatch = {
      startTime: Date.now(),
      imageCount,
      batchId,
      memoryBaseline: process.memoryUsage().heapUsed
    };

    this.emit('batchStarted', { batchId, imageCount, timestamp: this.currentBatch.startTime });
  }

  /**
   * End batch monitoring and calculate final metrics
   */
  endBatch(): BenchmarkResult | null {
    if (!this.isEnabled || !this.currentBatch) return null;

    const endTime = Date.now();
    const totalTime = endTime - this.currentBatch.startTime;
    const recentMetrics = this.metrics.filter(m => m.timestamp >= this.currentBatch!.startTime);
    
    const benchmarkResult: BenchmarkResult = {
      testName: `Batch_${this.currentBatch.batchId}`,
      imageCount: this.currentBatch.imageCount,
      totalTime,
      averageTimePerImage: totalTime / this.currentBatch.imageCount,
      throughputPerSecond: (this.currentBatch.imageCount / totalTime) * 1000,
      memoryPeak: Math.max(...recentMetrics.map(m => m.memoryUsage.heapUsed)),
      memoryAverage: recentMetrics.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) / recentMetrics.length,
      successRate: recentMetrics.filter(m => m.success).length / recentMetrics.length,
      timestamp: endTime,
      optimizationsEnabled: this.getEnabledOptimizations()
    };

    this.benchmarks.push(benchmarkResult);
    this.persistData();

    this.emit('batchCompleted', benchmarkResult);
    this.currentBatch = null;

    return benchmarkResult;
  }

  /**
   * Record a single processing operation
   */
  recordOperation(
    processingTime: number,
    success: boolean = true,
    phase?: string,
    taskType?: string,
    errorMessage?: string
  ): void {
    if (!this.isEnabled) return;

    const metric: PerformanceMetrics = {
      processingTime,
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now(),
      imageCount: 1,
      batchSize: this.currentBatch?.imageCount || 1,
      phase,
      taskType,
      success,
      errorMessage
    };

    this.metrics.push(metric);
    
    // Keep memory usage under control
    if (this.metrics.length > this.maxMetricsInMemory) {
      this.metrics = this.metrics.slice(-this.maxMetricsInMemory);
    }

    this.emit('operationRecorded', metric);

    // Persist data periodically
    if (this.metrics.length % 100 === 0) {
      this.persistData();
    }
  }

  /**
   * Get performance statistics for recent operations
   */
  getStats(since?: number): PerformanceStats {
    const cutoff = since || (Date.now() - 3600000); // Last hour by default
    const recentMetrics = this.metrics.filter(m => m.timestamp >= cutoff && m.success);

    if (recentMetrics.length === 0) {
      return {
        averageProcessingTime: 0,
        medianProcessingTime: 0,
        throughputPerSecond: 0,
        memoryUsageAverage: 0,
        memoryUsagePeak: 0,
        successRate: 0,
        totalProcessed: 0
      };
    }

    const processingTimes = recentMetrics.map(m => m.processingTime).sort((a, b) => a - b);
    const memoryUsages = recentMetrics.map(m => m.memoryUsage.heapUsed);
    const allMetrics = this.metrics.filter(m => m.timestamp >= cutoff);

    return {
      averageProcessingTime: processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length,
      medianProcessingTime: processingTimes[Math.floor(processingTimes.length / 2)],
      throughputPerSecond: recentMetrics.length / ((Date.now() - cutoff) / 1000),
      memoryUsageAverage: memoryUsages.reduce((sum, mem) => sum + mem, 0) / memoryUsages.length,
      memoryUsagePeak: Math.max(...memoryUsages),
      successRate: recentMetrics.length / allMetrics.length,
      totalProcessed: recentMetrics.length
    };
  }

  /**
   * Get benchmark history
   */
  getBenchmarks(limit: number = 10): BenchmarkResult[] {
    return this.benchmarks
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Compare current performance with baseline
   */
  compareWithBaseline(): {
    improvement: number;
    isRegression: boolean;
    currentAverage: number;
    baselineAverage: number;
  } {
    const recentStats = this.getStats();
    const baseline = this.getBaselinePerformance();

    if (!baseline) {
      return {
        improvement: 0,
        isRegression: false,
        currentAverage: recentStats.averageProcessingTime,
        baselineAverage: 0
      };
    }

    const improvement = ((baseline - recentStats.averageProcessingTime) / baseline) * 100;
    
    return {
      improvement,
      isRegression: improvement < -5, // More than 5% slower is regression
      currentAverage: recentStats.averageProcessingTime,
      baselineAverage: baseline
    };
  }

  /**
   * Set baseline performance (typically original performance before optimizations)
   */
  setBaseline(averageProcessingTime: number): void {
    const baselineData = { averageProcessingTime, timestamp: Date.now() };
    fs.writeFileSync(
      path.join(app?.getPath('userData') || './data', 'performance-baseline.json'),
      JSON.stringify(baselineData, null, 2)
    );
  }

  /**
   * Get baseline performance
   */
  private getBaselinePerformance(): number | null {
    try {
      const baselineFile = path.join(app?.getPath('userData') || './data', 'performance-baseline.json');
      if (fs.existsSync(baselineFile)) {
        const data = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
        return data.averageProcessingTime;
      }
    } catch (error) {
      console.error('Error reading baseline performance:', error);
    }
    return null;
  }

  /**
   * Get currently enabled optimization features
   */
  private getEnabledOptimizations(): string[] {
    try {
      const { PERFORMANCE_CONFIG } = require('../config');
      const optimizations: string[] = [];
      
      if (PERFORMANCE_CONFIG.enablePerformanceMonitoring) optimizations.push('Performance Monitoring');
      if (PERFORMANCE_CONFIG.enableParallelOptimizations) optimizations.push('Parallel Processing');
      if (PERFORMANCE_CONFIG.enableRawOptimizations) optimizations.push('RAW Processing');
      if (PERFORMANCE_CONFIG.enableDatabaseOptimizations) optimizations.push('Database Optimization');
      if (PERFORMANCE_CONFIG.enableMemoryOptimizations) optimizations.push('Memory Optimization');
      if (PERFORMANCE_CONFIG.enableStreamingProcessing) optimizations.push('Streaming Processing');
      
      return optimizations;
    } catch (error) {
      return [];
    }
  }

  /**
   * Persist metrics to disk
   */
  private persistData(): void {
    try {
      const data = {
        metrics: this.metrics.slice(-500), // Keep last 500 metrics
        benchmarks: this.benchmarks,
        lastUpdated: Date.now()
      };

      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error persisting performance data:', error);
    }
  }

  /**
   * Load persisted data from disk
   */
  private loadPersistedData(): void {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.metrics = data.metrics || [];
        this.benchmarks = data.benchmarks || [];
      }
    } catch (error) {
      console.error('Error loading performance data:', error);
      this.metrics = [];
      this.benchmarks = [];
    }
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearMetrics(): void {
    this.metrics = [];
    this.benchmarks = [];
    this.persistData();
  }

  /**
   * Create a performance measurement wrapper
   */
  measure<T>(
    operation: () => Promise<T>,
    phase?: string,
    taskType?: string
  ): Promise<T> {
    const startTime = Date.now();
    
    return operation()
      .then(result => {
        this.recordOperation(Date.now() - startTime, true, phase, taskType);
        return result;
      })
      .catch(error => {
        this.recordOperation(Date.now() - startTime, false, phase, taskType, error.message);
        throw error;
      });
  }
}

// Singleton instance for global use
export const performanceMonitor = new PerformanceMonitor();

// Convenience functions
export function startBatch(batchId: string, imageCount: number): void {
  performanceMonitor.startBatch(batchId, imageCount);
}

export function endBatch(): BenchmarkResult | null {
  return performanceMonitor.endBatch();
}

export function recordOperation(
  processingTime: number,
  success: boolean = true,
  phase?: string,
  taskType?: string,
  errorMessage?: string
): void {
  performanceMonitor.recordOperation(processingTime, success, phase, taskType, errorMessage);
}

export function getPerformanceStats(): PerformanceStats {
  return performanceMonitor.getStats();
}

export function measureAsync<T>(
  operation: () => Promise<T>,
  phase?: string,
  taskType?: string
): Promise<T> {
  return performanceMonitor.measure(operation, phase, taskType);
}