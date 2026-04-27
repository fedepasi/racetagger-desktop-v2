const sharpFix = require('./fix-sharp-release.js');
const rawIngestFix = require('./fix-raw-ingest-release.js');

/**
 * Combina tutti i post-pack fixes necessari.
 *
 * Sharp failure = FATAL (app cannot process images without it)
 * RAW-ingest failure = WARNING (app falls back to ExifTool)
 *
 * Set RACETAGGER_BUILD_STRICT=false to allow builds with missing Sharp.
 */

function runAllFixes(context) {
  console.log('🚀 [Post-Pack] Running all post-packaging fixes...');

  const strict = process.env.RACETAGGER_BUILD_STRICT !== 'false';

  // --- Sharp (critical) ---
  console.log('\n📦 [Post-Pack] Running Sharp fixes...');
  const sharpOk = sharpFix.default(context);

  if (!sharpOk && strict) {
    console.error('\n❌ [Post-Pack] Sharp fix FAILED — build cannot continue.');
    console.error('   Sharp is required for image processing. The app will not work without it.');
    console.error('   To override: RACETAGGER_BUILD_STRICT=false npm run build:mac:arm64');
    throw new Error('Sharp post-pack fix failed (strict mode). See errors above.');
  }

  // --- RAW-ingest (non-critical, has ExifTool fallback) ---
  console.log('\n📦 [Post-Pack] Running RAW-ingest fixes...');
  const rawIngestOk = rawIngestFix.default(context);

  if (!rawIngestOk) {
    console.warn('\n⚠️ [Post-Pack] RAW-ingest fix had issues — ExifTool fallback will be used.');
  }

  // --- Summary ---
  console.log('\n' + '─'.repeat(50));
  console.log(`  Sharp:       ${sharpOk ? '✅ OK' : '⚠️ FAILED (build continued in non-strict mode)'}`);
  console.log(`  RAW-ingest:  ${rawIngestOk ? '✅ OK' : '⚠️ Will use ExifTool fallback'}`);
  console.log('─'.repeat(50));
  console.log('✅ [Post-Pack] Post-packaging fixes completed!\n');
}

// Export per electron-builder hook
exports.default = runAllFixes;

// Esecuzione diretta
if (require.main === module) {
  try {
    runAllFixes();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
