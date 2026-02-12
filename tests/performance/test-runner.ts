/**
 * Performance Test Runner
 * Command line interface for running performance benchmarks
 */

import { PerformanceBenchmarkSuite, runQuickBenchmark, runFullBenchmark } from './benchmark-suite';
import { OptimizationLevel } from '../../src/config';

export interface TestRunnerOptions {
  quick?: boolean;
  full?: boolean;
  dataset?: string;
  optimizationLevel?: OptimizationLevel;
  iterations?: number;
  verbose?: boolean;
  outputFile?: string;
}

export class PerformanceTestRunner {
  
  static async run(options: TestRunnerOptions = {}): Promise<void> {
    console.log('🔧 Racetagger Performance Test Runner');
    console.log('=====================================');
    
    try {
      if (options.quick) {
        await this.runQuickTest(options);
      } else if (options.full) {
        await this.runFullTest(options);
      } else {
        await this.runDefaultTest(options);
      }
    } catch (error) {
      console.error('❌ Test run failed:', error);
      process.exit(1);
    }
  }

  private static async runQuickTest(options: TestRunnerOptions): Promise<void> {
    console.log('⚡ Running quick regression test...\n');
    
    const regressions = await runQuickBenchmark();
    
    if (regressions.length === 0) {
      console.log('✅ No performance regressions detected');
    } else {
      console.log(`⚠️ Found ${regressions.length} performance regressions:`);
      regressions.forEach(regression => {
        console.log(`   ${regression.improvementPercentage.toFixed(1)}% slower than baseline`);
      });
    }
  }

  private static async runFullTest(options: TestRunnerOptions): Promise<void> {
    console.log('🚀 Running full benchmark suite...\n');
    
    const results = await runFullBenchmark();
    
    console.log('\n📊 Benchmark Summary:');
    console.log(`   Total tests: ${results.summary.totalTests}`);
    console.log(`   Successful: ${results.summary.successfulTests}`);
    console.log(`   Failed: ${results.summary.failedTests}`);
    console.log(`   Best performing level: ${results.summary.bestPerformingLevel}`);
    
    if (results.regressions.length > 0) {
      console.log(`\n⚠️ Performance regressions detected: ${results.regressions.length}`);
    } else {
      console.log('\n✅ No performance regressions detected');
    }
    
    // Display optimization level comparison
    console.log('\n📈 Performance by optimization level:');
    results.summary.averageProcessingTimes.forEach(({ level, avgTime }) => {
      const improvement = level === OptimizationLevel.DISABLED ? 0 :
        ((4000 - avgTime) / 4000 * 100); // Assuming 4000ms baseline
      console.log(`   ${level.padEnd(15)}: ${avgTime.toFixed(0)}ms/image (${improvement.toFixed(1)}% improvement)`);
    });
  }

  private static async runDefaultTest(options: TestRunnerOptions): Promise<void> {
    console.log('🧪 Running default performance test...\n');
    
    // Run quick test by default
    await this.runQuickTest(options);
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: TestRunnerOptions = {};
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--quick':
        options.quick = true;
        break;
      case '--full':
        options.full = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--dataset':
        options.dataset = args[++i];
        break;
      case '--level':
        options.optimizationLevel = args[++i] as OptimizationLevel;
        break;
      case '--iterations':
        options.iterations = parseInt(args[++i]);
        break;
      case '--output':
        options.outputFile = args[++i];
        break;
      case '--help':
        console.log(`
Performance Test Runner Usage:

Options:
  --quick              Run quick regression test (default)
  --full               Run full benchmark suite
  --dataset <name>     Test specific dataset only
  --level <level>      Test specific optimization level
  --iterations <n>     Number of test iterations
  --verbose            Enable detailed logging
  --output <file>      Save results to specific file
  --help               Show this help message

Examples:
  npm run test:performance
  npm run test:performance -- --quick
  npm run test:performance -- --full --verbose
  npm run test:performance -- --dataset small-batch --level balanced
        `);
        process.exit(0);
        break;
    }
  }
  
  PerformanceTestRunner.run(options).then(() => {
    process.exit(0);
  });
}