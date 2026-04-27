const fs = require('fs');
const path = require('path');
const {
  resolvePlatformArch,
  getUnpackedPath,
  verifyBinaryArchitecture,
} = require('./build-utils');

/**
 * Post-build script per RAW-ingest (raw-preview-extractor) nell'app rilasciata.
 * Cross-platform: gestisce macOS (.app), Windows (unpacked), e Linux (AppImage).
 * Verifica che il modulo nativo sia correttamente incluso e funzionante.
 *
 * Returns true if the module is verified, false if something is missing/broken.
 * NOTE: raw-preview-extractor has an ExifTool fallback, so a failure here is
 * non-fatal for the overall application — but we still want to know about it.
 */

console.log('🔧 [RAW-ingest Fix] Starting RAW-ingest post-build fix...');

function fixRawIngestDependencies(context) {
  const { platform, arch } = resolvePlatformArch(context);

  const unpackedPath = getUnpackedPath(context);
  console.log(`📁 [RAW-ingest Fix] Unpacked path: ${unpackedPath}`);
  console.log(`📁 [RAW-ingest Fix] Platform: ${platform}, Arch: ${arch}`);

  if (!fs.existsSync(unpackedPath)) {
    throw new Error(`Unpacked path does not exist: ${unpackedPath}`);
  }

  // --- Locate raw-preview-extractor ---
  const searchPaths = [
    path.join(unpackedPath, 'node_modules', 'raw-preview-extractor'),
    path.join(unpackedPath, 'vendor', 'raw-preview-extractor'),
  ];

  let rawIngestPath = null;
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      rawIngestPath = p;
      break;
    }
  }

  if (!rawIngestPath) {
    throw new Error('raw-preview-extractor not found in unpacked directory');
  }

  console.log(`📦 [RAW-ingest Fix] Found at: ${rawIngestPath}`);

  // --- Find native binary ---
  const searchDirs = [
    path.join(rawIngestPath, 'prebuilds', `${platform}-${arch}`),
    path.join(rawIngestPath, 'prebuilds', `${platform}-universal`),
    path.join(rawIngestPath, 'prebuilds', `${platform}-x64+arm64`),
    path.join(rawIngestPath, 'build', 'Release'),
  ];

  const binaryNames = ['raw-preview-extractor.node', 'raw_extractor.node'];

  let foundValidBinary = false;
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const binaryName of binaryNames) {
      const binaryPath = path.join(dir, binaryName);
      if (!fs.existsSync(binaryPath)) continue;

      console.log(`📦 [RAW-ingest Fix] Found binary: ${path.relative(rawIngestPath, binaryPath)}`);

      // Verify architecture
      if (platform !== 'win32') {
        const archInfo = verifyBinaryArchitecture(binaryPath, platform);
        console.log(`   Architecture: ${archInfo}`);

        if (archInfo.includes(arch) || archInfo.includes('universal')) {
          foundValidBinary = true;
        } else if (arch === 'x64' && archInfo.includes('x86_64')) {
          foundValidBinary = true;
        } else {
          console.warn(`   ⚠️ Architecture mismatch: binary is not for ${arch}`);
        }
      } else {
        foundValidBinary = true;
      }

      // Set executable permissions (non-Windows)
      if (platform !== 'win32') {
        try {
          fs.chmodSync(binaryPath, 0o755);
        } catch {}
      }
    }
  }

  if (!foundValidBinary) {
    console.warn('⚠️ [RAW-ingest Fix] No valid binary found for current platform/arch');
    console.warn(`   Looking for ${platform}-${arch} prebuilds...`);
    console.warn('   App will fall back to ExifTool for RAW preview extraction');
    return false; // Non-fatal — ExifTool fallback exists
  }

  console.log('✅ [RAW-ingest Fix] Valid native binary found');

  // --- Verify package.json ---
  const packageJsonPath = path.join(rawIngestPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    console.log(`✅ [RAW-ingest Fix] Package: ${packageJson.name}@${packageJson.version}`);
  }

  // --- Create runtime config ---
  const configPath = path.join(unpackedPath, 'raw-ingest-config.json');
  const config = {
    timestamp: new Date().toISOString(),
    platform,
    arch,
    rawIngestPath: path.relative(unpackedPath, rawIngestPath),
    verified: foundValidBinary,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ [RAW-ingest Fix] Created runtime configuration');

  // --- Module load test ---
  try {
    const rawIngestModulePath = path.join(rawIngestPath, 'dist', 'index.js');
    if (fs.existsSync(rawIngestModulePath)) {
      delete require.cache[rawIngestModulePath];
      const rawIngest = require(rawIngestModulePath);

      if (rawIngest && (rawIngest.extractMediumPreview || rawIngest.extractFullPreview)) {
        console.log('✅ [RAW-ingest Fix] Module structure verified');
      } else {
        console.warn('⚠️ [RAW-ingest Fix] Module loaded but missing expected functions');
      }
    }
  } catch (testError) {
    console.warn(`⚠️ [RAW-ingest Fix] Module load test failed: ${testError.message}`);
    console.warn('⚠️ [RAW-ingest Fix] App will fall back to ExifTool at runtime');
  }

  console.log('🎉 [RAW-ingest Fix] Post-build fix completed!');
  return true;
}

/**
 * Safe wrapper — catches errors and returns success/failure.
 */
function fixRawIngestDependenciesSafe(context) {
  try {
    return fixRawIngestDependencies(context);
  } catch (error) {
    console.error(`❌ [RAW-ingest Fix] Failed: ${error.message}`);
    console.warn('⚠️ [RAW-ingest Fix] Build will continue, app will use ExifTool fallback');
    return false;
  }
}

exports.default = fixRawIngestDependenciesSafe;
exports.fixRawIngestDependencies = fixRawIngestDependencies;

if (require.main === module) {
  fixRawIngestDependenciesSafe();
}
