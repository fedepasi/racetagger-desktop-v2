/**
 * Performance Benchmark Suite for Racetagger Desktop
 * Automated testing for performance regressions and optimization validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { performanceMonitor, PerformanceStats, BenchmarkResult } from '../../src/utils/performance-monitor';
import { sessionManager } from '../../src/utils/session-manager';
import { PERFORMANCE_CONFIG, ConfigManager, OptimizationLevel } from '../../src/config';

export interface TestDataset {
  name: string;
  path: string;
  imageCount: number;
  description: string;
  hasRawFiles: boolean;
  averageFileSize: number; // MB
  expectedProcessingTime?: number; // ms per image (if known)
}

export interface BenchmarkConfig {
  testDatasets: TestDataset[];
  optimizationLevels: OptimizationLevel[];
  iterations: number;
  warmupRuns: number;
  maxTestDuration: number; // ms
  memoryLimit: number; // MB
  enableDetailedLogging: boolean;
}

export interface TestResult {
  testName: string;
  dataset: TestDataset;
  optimizationLevel: OptimizationLevel;
  iteration: number;
  success: boolean;
  processingTimePerImage: number;
  totalProcessingTime: number;
  throughputPerSecond: number;
  memoryUsage: {
    peak: number;
    average: number;
    baseline: number;
  };
  errors: string[];
  timestamp: number;
}

export interface ComparisonResult {
  improvementPercentage: number;
  isRegression: boolean;
  baselineTime: number;
  currentTime: number;
  memoryImprovement: number;
  throughputImprovement: number;
}

/**
 * Benchmark Suite Class
 */
export class PerformanceBenchmarkSuite {
  private config: BenchmarkConfig;
  private testResults: TestResult[] = [];
  private resultsDir: string;
  private baselineResults: Map<string, TestResult> = new Map();

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = {
      testDatasets: [
        {
          name: 'small-batch',
          path: './test-data/small-batch',
          imageCount: 10,
          description: 'Small batch for quick regression testing',
          hasRawFiles: false,
          averageFileSize: 2.5,
          expectedProcessingTime: 4000
        },
        {
          name: 'medium-batch',
          path: './test-data/medium-batch', 
          imageCount: 50,
          description: 'Medium batch for integration testing',
          hasRawFiles: true,
          averageFileSize: 8.5,
          expectedProcessingTime: 4000
        },
        {
          name: 'large-batch',
          path: './test-data/large-batch',
          imageCount: 200,
          description: 'Large batch for stress testing',
          hasRawFiles: true,
          averageFileSize: 12.0,
          expectedProcessingTime: 4000
        }
      ],
      optimizationLevels: [
        OptimizationLevel.DISABLED,
        OptimizationLevel.CONSERVATIVE,
        OptimizationLevel.BALANCED,
        OptimizationLevel.AGGRESSIVE
      ],
      iterations: 3,
      warmupRuns: 1,
      maxTestDuration: 10 * 60 * 1000, // 10 minutes max per test
      memoryLimit: 4096, // 4GB
      enableDetailedLogging: false,
      ...config
    };

    this.resultsDir = path.join(process.cwd(), 'test-results', 'performance');
    this.ensureResultsDirectory();
    this.loadBaselineResults();
  }

  /**
   * Run complete benchmark suite
   */
  async runFullSuite(): Promise<{
    results: TestResult[];
    summary: BenchmarkSummary;
    regressions: ComparisonResult[];
  }> {
    console.log('🚀 Starting Performance Benchmark Suite');
    console.log(`   Datasets: ${this.config.testDatasets.length}`);
    console.log(`   Optimization levels: ${this.config.optimizationLevels.length}`);
    console.log(`   Total tests: ${this.config.testDatasets.length * this.config.optimizationLevels.length * this.config.iterations}`);

    const startTime = Date.now();
    this.testResults = [];

    // Run warmup if specified
    if (this.config.warmupRuns > 0) {
      console.log(`🔥 Running ${this.config.warmupRuns} warmup iterations...`);
      await this.runWarmup();
    }

    // Run benchmarks for each combination
    for (const dataset of this.config.testDatasets) {
      for (const optimizationLevel of this.config.optimizationLevels) {
        await this.runBenchmarkSet(dataset, optimizationLevel);
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ Benchmark suite completed in ${Math.round(totalTime / 1000)}s`);

    // Generate summary and analysis
    const summary = this.generateSummary();
    const regressions = this.detectRegressions();

    // Save results
    await this.saveResults();

    return {
      results: this.testResults,
      summary,
      regressions
    };
  }

  /**
   * Run quick regression test (small dataset only)
   */
  async runQuickRegression(): Promise<ComparisonResult[]> {
    console.log('⚡ Running quick regression test...');

    const smallDataset = this.config.testDatasets.find(d => d.name === 'small-batch');
    if (!smallDataset) {
      throw new Error('Small batch dataset not found for regression test');
    }

    // Test current optimization level vs baseline
    const currentLevel = PERFORMANCE_CONFIG.level;
    await this.runBenchmarkSet(smallDataset, currentLevel);

    return this.detectRegressions();
  }

  /**
   * Run benchmarks for specific dataset and optimization level
   */
  private async runBenchmarkSet(dataset: TestDataset, optimizationLevel: OptimizationLevel): Promise<void> {
    console.log(`📊 Testing ${dataset.name} with ${optimizationLevel} optimization`);

    // Set optimization level
    ConfigManager.setOptimizationLevel(optimizationLevel);
    await this.waitForConfigSync();

    // Run multiple iterations
    for (let iteration = 0; iteration < this.config.iterations; iteration++) {
      const result = await this.runSingleBenchmark(dataset, optimizationLevel, iteration);
      this.testResults.push(result);

      if (this.config.enableDetailedLogging) {
        console.log(`   Iteration ${iteration + 1}: ${result.processingTimePerImage.toFixed(0)}ms/image`);
      }

      // Check for memory leaks between iterations
      if (global.gc) global.gc();
      await this.sleep(1000); // Small delay between iterations
    }
  }

  /**
   * Run a single benchmark test
   */
  private async runSingleBenchmark(
    dataset: TestDataset,
    optimizationLevel: OptimizationLevel,
    iteration: number
  ): Promise<TestResult> {
    const testName = `${dataset.name}-${optimizationLevel}-${iteration}`;
    const sessionId = `benchmark-${testName}-${Date.now()}`;

    const errors: string[] = [];
    let success = false;
    let processingTimePerImage = 0;
    let totalProcessingTime = 0;
    let throughputPerSecond = 0;
    let memoryUsage = {
      peak: 0,
      average: 0,
      baseline: process.memoryUsage().heapUsed
    };

    try {
      // Check if dataset exists
      if (!this.validateDataset(dataset)) {
        throw new Error(`Dataset not found or invalid: ${dataset.path}`);
      }

      // Initialize session tracking
      sessionManager.initializeSession(sessionId, dataset.imageCount, dataset.path);
      performanceMonitor.startBatch(sessionId, dataset.imageCount);

      const startTime = Date.now();
      const startMemory = process.memoryUsage().heapUsed;

      // Simulate image processing (this would be replaced with actual processing)
      await this.simulateImageProcessing(dataset);

      const endTime = Date.now();
      totalProcessingTime = endTime - startTime;
      processingTimePerImage = totalProcessingTime / dataset.imageCount;
      throughputPerSecond = (dataset.imageCount / totalProcessingTime) * 1000;

      const endMemory = process.memoryUsage().heapUsed;
      memoryUsage.peak = endMemory;
      memoryUsage.average = (startMemory + endMemory) / 2;

      // Get performance stats
      const benchmarkResult = performanceMonitor.endBatch();
      if (benchmarkResult) {
        processingTimePerImage = benchmarkResult.averageTimePerImage;
        throughputPerSecond = benchmarkResult.throughputPerSecond;
        memoryUsage.peak = benchmarkResult.memoryPeak;
        memoryUsage.average = benchmarkResult.memoryAverage;
      }

      sessionManager.completeSession();
      success = true;

      // Check for performance anomalies
      if (processingTimePerImage > (dataset.expectedProcessingTime || 10000)) {
        errors.push(`Processing time exceeded expected threshold: ${processingTimePerImage}ms > ${dataset.expectedProcessingTime}ms`);
      }

      if (memoryUsage.peak > this.config.memoryLimit * 1024 * 1024) {
        errors.push(`Memory usage exceeded limit: ${Math.round(memoryUsage.peak / 1024 / 1024)}MB > ${this.config.memoryLimit}MB`);
      }

    } catch (error) {
      errors.push(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`❌ Benchmark failed: ${testName}`, error);
    }

    return {
      testName,
      dataset,
      optimizationLevel,
      iteration,
      success,
      processingTimePerImage,
      totalProcessingTime,
      throughputPerSecond,
      memoryUsage,
      errors,
      timestamp: Date.now()
    };
  }

  /**
   * Simulate image processing for benchmarking
   */
  private async simulateImageProcessing(dataset: TestDataset): Promise<void> {
    // This is a simulation - in real implementation this would call actual processing
    for (let i = 0; i < dataset.imageCount; i++) {
      const processingDelay = dataset.hasRawFiles ? 
        (Math.random() * 2000 + 1000) : // RAW files: 1-3 seconds
        (Math.random() * 800 + 200);    // Standard files: 0.2-1 second

      // Apply optimization speedup
      let optimizationSpeedup = 1;
      switch (PERFORMANCE_CONFIG.level) {
        case OptimizationLevel.CONSERVATIVE:
          optimizationSpeedup = 2;
          break;
        case OptimizationLevel.BALANCED:
          optimizationSpeedup = 5;
          break;
        case OptimizationLevel.AGGRESSIVE:
          optimizationSpeedup = 8;
          break;
      }

      const actualDelay = Math.max(100, processingDelay / optimizationSpeedup);
      
      await this.sleep(actualDelay);
      
      // Record individual operation
      performanceMonitor.recordOperation(actualDelay, true, 'SIMULATION', 'IMAGE_PROCESS');

      // Memory usage simulation
      if (i % 10 === 0 && global.gc) {
        global.gc(); // Simulate memory management
      }
    }
  }

  /**
   * Detect performance regressions
   */
  private detectRegressions(): ComparisonResult[] {
    const regressions: ComparisonResult[] = [];
    
    for (const result of this.testResults) {
      const baselineKey = `${result.dataset.name}-${result.optimizationLevel}`;
      const baseline = this.baselineResults.get(baselineKey);
      
      if (baseline && result.success) {
        const comparison: ComparisonResult = {
          improvementPercentage: ((baseline.processingTimePerImage - result.processingTimePerImage) / baseline.processingTimePerImage) * 100,
          isRegression: result.processingTimePerImage > baseline.processingTimePerImage * 1.1, // 10% slower is regression
          baselineTime: baseline.processingTimePerImage,
          currentTime: result.processingTimePerImage,
          memoryImprovement: ((baseline.memoryUsage.average - result.memoryUsage.average) / baseline.memoryUsage.average) * 100,
          throughputImprovement: ((result.throughputPerSecond - baseline.throughputPerSecond) / baseline.throughputPerSecond) * 100
        };

        if (comparison.isRegression) {
          regressions.push(comparison);
          console.warn(`⚠️ Regression detected: ${baselineKey} - ${comparison.improvementPercentage.toFixed(1)}% slower`);
        }
      }
    }

    return regressions;
  }

  /**
   * Generate benchmark summary
   */
  private generateSummary(): BenchmarkSummary {
    const successfulTests = this.testResults.filter(r => r.success);
    const failedTests = this.testResults.filter(r => !r.success);

    const avgProcessingTimes = this.config.optimizationLevels.map(level => {
      const levelResults = successfulTests.filter(r => r.optimizationLevel === level);
      const avgTime = levelResults.reduce((sum, r) => sum + r.processingTimePerImage, 0) / levelResults.length;
      return { level, avgTime };
    });

    return {
      totalTests: this.testResults.length,
      successfulTests: successfulTests.length,
      failedTests: failedTests.length,
      averageProcessingTimes: avgProcessingTimes,
      bestPerformingLevel: avgProcessingTimes.reduce((best, current) => 
        current.avgTime < best.avgTime ? current : best
      ).level,
      timestamp: Date.now()
    };
  }

  /**
   * Validate test dataset
   */
  private validateDataset(dataset: TestDataset): boolean {
    // In real implementation, this would check if test images exist
    return true; // Simplified for now
  }

  /**
   * Run warmup iterations
   */
  private async runWarmup(): Promise<void> {
    const smallDataset = this.config.testDatasets.find(d => d.name === 'small-batch') || this.config.testDatasets[0];
    
    for (let i = 0; i < this.config.warmupRuns; i++) {
      await this.simulateImageProcessing({ ...smallDataset, imageCount: 5 });
      if (global.gc) global.gc();
    }
  }

  /**
   * Save benchmark results
   */
  private async saveResults(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = path.join(this.resultsDir, `benchmark-results-${timestamp}.json`);

    const resultsData = {
      config: this.config,
      results: this.testResults,
      summary: this.generateSummary(),
      regressions: this.detectRegressions(),
      timestamp: Date.now(),
      systemInfo: {
        platform: process.platform,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        cpus: require('os').cpus().length
      }
    };

    fs.writeFileSync(resultsFile, JSON.stringify(resultsData, null, 2));
    console.log(`💾 Benchmark results saved: ${resultsFile}`);

    // Update baseline if this run was successful
    this.updateBaseline();
  }

  /**
   * Load baseline results for comparison
   */
  private loadBaselineResults(): void {
    const baselineFile = path.join(this.resultsDir, 'baseline.json');
    
    if (fs.existsSync(baselineFile)) {
      try {
        const baselineData = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
        baselineData.results?.forEach((result: TestResult) => {
          const key = `${result.dataset.name}-${result.optimizationLevel}`;
          this.baselineResults.set(key, result);
        });
        console.log(`📊 Loaded ${this.baselineResults.size} baseline results`);
      } catch (error) {
        console.warn('Warning: Could not load baseline results:', error);
      }
    }
  }

  /**
   * Update baseline results with current run
   */
  private updateBaseline(): void {
    if (this.testResults.some(r => r.success)) {
      const baselineFile = path.join(this.resultsDir, 'baseline.json');
      const baselineData = {
        results: this.testResults.filter(r => r.success),
        lastUpdated: Date.now(),
        version: '1.0'
      };

      fs.writeFileSync(baselineFile, JSON.stringify(baselineData, null, 2));
      console.log('📊 Baseline results updated');
    }
  }

  /**
   * Ensure results directory exists
   */
  private ensureResultsDirectory(): void {
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
  }

  /**
   * Wait for configuration synchronization
   */
  private async waitForConfigSync(): Promise<void> {
    await this.sleep(100); // Small delay to ensure config is applied
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface BenchmarkSummary {
  totalTests: number;
  successfulTests: number;
  failedTests: number;
  averageProcessingTimes: Array<{ level: OptimizationLevel; avgTime: number }>;
  bestPerformingLevel: OptimizationLevel;
  timestamp: number;
}

// Convenience functions
export async function runQuickBenchmark(): Promise<ComparisonResult[]> {
  const suite = new PerformanceBenchmarkSuite();
  return suite.runQuickRegression();
}

export async function runFullBenchmark(): Promise<{
  results: TestResult[];
  summary: BenchmarkSummary;
  regressions: ComparisonResult[];
}> {
  const suite = new PerformanceBenchmarkSuite();
  return suite.runFullSuite();
}