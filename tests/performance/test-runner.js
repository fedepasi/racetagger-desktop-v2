"use strict";
/**
 * Performance Test Runner
 * Command line interface for running performance benchmarks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceTestRunner = void 0;
const benchmark_suite_1 = require("./benchmark-suite");
const config_1 = require("../../src/config");
class PerformanceTestRunner {
    static async run(options = {}) {
        console.log('🔧 Racetagger Performance Test Runner');
        console.log('=====================================');
        try {
            if (options.quick) {
                await this.runQuickTest(options);
            }
            else if (options.full) {
                await this.runFullTest(options);
            }
            else {
                await this.runDefaultTest(options);
            }
        }
        catch (error) {
            console.error('❌ Test run failed:', error);
            process.exit(1);
        }
    }
    static async runQuickTest(options) {
        console.log('⚡ Running quick regression test...\n');
        const regressions = await (0, benchmark_suite_1.runQuickBenchmark)();
        if (regressions.length === 0) {
            console.log('✅ No performance regressions detected');
        }
        else {
            console.log(`⚠️ Found ${regressions.length} performance regressions:`);
            regressions.forEach(regression => {
                console.log(`   ${regression.improvementPercentage.toFixed(1)}% slower than baseline`);
            });
        }
    }
    static async runFullTest(options) {
        console.log('🚀 Running full benchmark suite...\n');
        const results = await (0, benchmark_suite_1.runFullBenchmark)();
        console.log('\n📊 Benchmark Summary:');
        console.log(`   Total tests: ${results.summary.totalTests}`);
        console.log(`   Successful: ${results.summary.successfulTests}`);
        console.log(`   Failed: ${results.summary.failedTests}`);
        console.log(`   Best performing level: ${results.summary.bestPerformingLevel}`);
        if (results.regressions.length > 0) {
            console.log(`\n⚠️ Performance regressions detected: ${results.regressions.length}`);
        }
        else {
            console.log('\n✅ No performance regressions detected');
        }
        // Display optimization level comparison
        console.log('\n📈 Performance by optimization level:');
        results.summary.averageProcessingTimes.forEach(({ level, avgTime }) => {
            const improvement = level === config_1.OptimizationLevel.DISABLED ? 0 :
                ((4000 - avgTime) / 4000 * 100); // Assuming 4000ms baseline
            console.log(`   ${level.padEnd(15)}: ${avgTime.toFixed(0)}ms/image (${improvement.toFixed(1)}% improvement)`);
        });
    }
    static async runDefaultTest(options) {
        console.log('🧪 Running default performance test...\n');
        // Run quick test by default
        await this.runQuickTest(options);
    }
}
exports.PerformanceTestRunner = PerformanceTestRunner;
// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {};
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
                options.optimizationLevel = args[++i];
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
    PerformanceTestRunner.run(options);
}
