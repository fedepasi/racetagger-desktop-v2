const sharpFix = require('./fix-sharp-release.js');
const rawIngestFix = require('./fix-raw-ingest-release.js');

/**
 * Combina tutti i post-pack fixes necessari
 */

function runAllFixes(context) {
  console.log('🚀 [Post-Pack] Running all post-packaging fixes...');
  
  // Fix Sharp
  console.log('\n📦 [Post-Pack] Running Sharp fixes...');
  sharpFix.default(context);
  
  // Fix RAW-ingest  
  console.log('\n📦 [Post-Pack] Running RAW-ingest fixes...');
  rawIngestFix.default(context);
  
  console.log('\n✅ [Post-Pack] All post-packaging fixes completed!');
}

// Export per electron-builder hook
exports.default = runAllFixes;

// Esecuzione diretta
if (require.main === module) {
  runAllFixes();
}