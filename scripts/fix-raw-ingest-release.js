const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Post-build script per RAW-ingest (raw-preview-extractor) nell'app rilasciata
 * Cross-platform: gestisce macOS (.app), Windows (unpacked), e Linux (AppImage)
 * Verifica che il modulo nativo sia correttamente incluso e funzionante
 */

console.log('🔧 [RAW-ingest Fix] Starting RAW-ingest post-build fix...');

function findAppBundle(buildDir) {
  const items = fs.readdirSync(buildDir);
  for (const item of items) {
    const fullPath = path.join(buildDir, item);
    if (item.endsWith('.app') && fs.statSync(fullPath).isDirectory()) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Determine the unpacked resources path based on platform and context
 */
function getUnpackedPath(context) {
  let appPath;
  const platform = context?.electronPlatformName || process.platform;

  if (context && context.appOutDir) {
    // Called from electron-builder hook
    if (platform === 'darwin') {
      const appName = context.packager.appInfo.productFilename + '.app';
      appPath = path.join(context.appOutDir, appName);
      return path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
    } else {
      // Windows/Linux: resources are in the root output dir
      return path.join(context.appOutDir, 'resources', 'app.asar.unpacked');
    }
  } else {
    // Called manually, search release directory
    const releaseDir = path.join(process.cwd(), 'release');
    if (!fs.existsSync(releaseDir)) {
      throw new Error('Release directory not found');
    }

    const platformDirs = fs.readdirSync(releaseDir).filter(d =>
      fs.statSync(path.join(releaseDir, d)).isDirectory()
    );

    for (const platformDir of platformDirs) {
      const fullPlatformPath = path.join(releaseDir, platformDir);

      // macOS: look for .app bundle
      const appBundle = findAppBundle(fullPlatformPath);
      if (appBundle) {
        return path.join(appBundle, 'Contents', 'Resources', 'app.asar.unpacked');
      }

      // Windows/Linux: look for resources/app.asar.unpacked
      const winUnpacked = path.join(fullPlatformPath, 'resources', 'app.asar.unpacked');
      if (fs.existsSync(winUnpacked)) {
        return winUnpacked;
      }
    }

    throw new Error('Cannot find app bundle in release directory');
  }
}

function fixRawIngestDependencies(context) {
  try {
    const platform = context?.electronPlatformName || process.platform;
    const arch = context?.arch || process.arch;

    const unpackedPath = getUnpackedPath(context);
    console.log(`📁 [RAW-ingest Fix] Unpacked path: ${unpackedPath}`);
    console.log(`📁 [RAW-ingest Fix] Platform: ${platform}, Arch: ${arch}`);

    if (!fs.existsSync(unpackedPath)) {
      throw new Error(`Unpacked path does not exist: ${unpackedPath}`);
    }

    // Check for raw-preview-extractor in both locations
    const rawIngestPaths = [
      path.join(unpackedPath, 'node_modules', 'raw-preview-extractor'),
      path.join(unpackedPath, 'vendor', 'raw-preview-extractor'),
    ];

    let rawIngestPath = null;
    for (const p of rawIngestPaths) {
      if (fs.existsSync(p)) {
        rawIngestPath = p;
        break;
      }
    }

    if (!rawIngestPath) {
      // Also check in the vendor directory at the root level of unpacked
      const vendorPath = path.join(unpackedPath, 'vendor', 'raw-preview-extractor');
      if (fs.existsSync(vendorPath)) {
        rawIngestPath = vendorPath;
      }
    }

    if (!rawIngestPath) {
      throw new Error('raw-preview-extractor not found in unpacked directory');
    }

    console.log(`📦 [RAW-ingest Fix] Found at: ${rawIngestPath}`);

    // Look for native binary in prebuilds and build directories
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
        if (fs.existsSync(binaryPath)) {
          console.log(`📦 [RAW-ingest Fix] Found binary: ${path.relative(rawIngestPath, binaryPath)}`);

          // Verify architecture (non-Windows only)
          if (platform !== 'win32') {
            try {
              const fileOutput = execSync(`file "${binaryPath}"`, { encoding: 'utf8' });
              console.log(`   Architecture: ${fileOutput.trim().split(':').pop().trim()}`);

              if (fileOutput.includes(arch) || fileOutput.includes('universal')) {
                foundValidBinary = true;
              } else if (arch === 'x64' && fileOutput.includes('x86_64')) {
                foundValidBinary = true;
              } else {
                console.warn(`   ⚠️ Architecture mismatch: binary is not for ${arch}`);
              }
            } catch {
              console.warn(`   ⚠️ Could not verify architecture`);
              foundValidBinary = true; // Assume valid if we can't check
            }
          } else {
            // Windows: can't easily check architecture, assume valid
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
    }

    if (!foundValidBinary) {
      console.warn('⚠️ [RAW-ingest Fix] No valid binary found for current platform/arch');
      console.warn(`   Looking for ${platform}-${arch} prebuilds...`);
      console.warn('   App will fall back to ExifTool for RAW preview extraction');
      return; // Don't throw - app can still work with fallback
    }

    console.log('✅ [RAW-ingest Fix] Valid native binary found');

    // Verify package.json
    const packageJsonPath = path.join(rawIngestPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      console.log(`✅ [RAW-ingest Fix] Package: ${packageJson.name}@${packageJson.version}`);
    }

    // Create runtime config
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

    // Module load test
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

  } catch (error) {
    console.error(`❌ [RAW-ingest Fix] Failed: ${error.message}`);
    console.warn('⚠️ [RAW-ingest Fix] Build will continue, app will use ExifTool fallback');
  }
}

// Export per electron-builder hook
exports.default = fixRawIngestDependencies;

// Esecuzione diretta
if (require.main === module) {
  fixRawIngestDependencies();
}
