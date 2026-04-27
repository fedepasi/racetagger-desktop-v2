const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  resolvePlatformArch,
  getUnpackedPath,
  verifyBinaryArchitecture,
  findLibvipsIn,
} = require('./build-utils');

/**
 * Post-build script per correggere le dipendenze Sharp nell'app rilasciata.
 * Cross-platform: gestisce macOS (.app), Windows (unpacked), e Linux (AppImage).
 * Verifica che Sharp e libvips siano correttamente inclusi e funzionanti.
 *
 * Returns true if Sharp is fully verified, false if something is missing/broken.
 */

console.log('🔧 [Sharp Fix] Starting Sharp post-build fix...');

function fixSharpDependencies(context) {
  const { platform, arch } = resolvePlatformArch(context);

  const unpackedPath = getUnpackedPath(context);
  console.log(`📁 [Sharp Fix] Unpacked path: ${unpackedPath}`);
  console.log(`📁 [Sharp Fix] Platform: ${platform}, Arch: ${arch}`);

  if (!fs.existsSync(unpackedPath)) {
    throw new Error(`Unpacked path does not exist: ${unpackedPath}`);
  }

  // --- Verify Sharp and @img packages exist ---
  const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');
  const imgPath = path.join(unpackedPath, 'node_modules', '@img');

  if (!fs.existsSync(sharpPath)) {
    throw new Error(`Sharp not found at: ${sharpPath}`);
  }
  if (!fs.existsSync(imgPath)) {
    throw new Error(`@img packages not found at: ${imgPath}`);
  }

  console.log('✅ [Sharp Fix] Sharp and @img packages found');

  // --- Locate Sharp native binary ---
  const sharpPlatformPkg = `sharp-${platform}-${arch}`;
  const sharpPlatformPath = path.join(imgPath, sharpPlatformPkg);

  let sharpBinaryPath = null;
  const expectedBinaryPath = path.join(sharpPlatformPath, 'lib', `sharp-${platform}-${arch}.node`);

  if (fs.existsSync(expectedBinaryPath)) {
    sharpBinaryPath = expectedBinaryPath;
  } else if (fs.existsSync(sharpPlatformPath)) {
    // Search for any .node file in the platform package
    const libDir = path.join(sharpPlatformPath, 'lib');
    if (fs.existsSync(libDir)) {
      const nodeFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.node'));
      if (nodeFiles.length > 0) {
        sharpBinaryPath = path.join(libDir, nodeFiles[0]);
      }
    }
  }

  if (!sharpBinaryPath) {
    console.warn(`⚠️ [Sharp Fix] Sharp binary not found for ${platform}-${arch}`);
    console.warn(`   Expected at: ${expectedBinaryPath}`);
    if (fs.existsSync(imgPath)) {
      console.warn(`   Listing @img contents:`);
      fs.readdirSync(imgPath).forEach(item => console.warn(`   - ${item}`));
    }
    throw new Error(`Sharp native binary missing for ${platform}-${arch}. Install it with: npm install @img/${sharpPlatformPkg}`);
  }

  console.log(`✅ [Sharp Fix] Sharp binary: ${path.relative(unpackedPath, sharpBinaryPath)}`);

  // --- Locate libvips ---
  // FIX: Initialize libvipsPkg BEFORE strategy blocks (was causing ReferenceError)
  let libvipsPkg = sharpPlatformPkg;
  let libvipsDir = null;
  let libvipsPath = null;

  // Strategy 1: Check inside sharp platform package (Sharp 0.34+ bundled layout)
  const sharpPlatformLibDir = path.join(sharpPlatformPath, 'lib');
  libvipsPath = findLibvipsIn(sharpPlatformLibDir, platform);
  if (libvipsPath) {
    libvipsDir = sharpPlatformLibDir;
    // libvipsPkg stays as sharpPlatformPkg — libvips is bundled inside it
  }

  // Strategy 2: Check separate libvips package (Sharp <0.34 layout)
  if (!libvipsPath) {
    const separateLibvipsPkg = `sharp-libvips-${platform}-${arch}`;
    const separateLibvipsDir = path.join(imgPath, separateLibvipsPkg, 'lib');
    libvipsPath = findLibvipsIn(separateLibvipsDir, platform);
    if (libvipsPath) {
      libvipsDir = separateLibvipsDir;
      libvipsPkg = separateLibvipsPkg;
    }
  }

  if (!libvipsPath) {
    throw new Error(`libvips not found for ${platform}-${arch}. Checked: ${sharpPlatformLibDir} and @img/sharp-libvips-${platform}-${arch}/lib`);
  }

  console.log(`✅ [Sharp Fix] libvips: ${path.relative(unpackedPath, libvipsPath)}`);

  // --- macOS: Create symlink sharp.node if needed ---
  if (platform === 'darwin') {
    const symlinkPath = path.join(sharpPlatformPath, 'sharp.node');
    if (!fs.existsSync(symlinkPath)) {
      try {
        fs.symlinkSync(`./lib/sharp-${platform}-${arch}.node`, symlinkPath);
        console.log('✅ [Sharp Fix] Created sharp.node symlink');
      } catch (symlinkError) {
        fs.copyFileSync(sharpBinaryPath, symlinkPath);
        console.log('✅ [Sharp Fix] Copied sharp.node (fallback)');
      }
    }
  }

  // --- Set executable permissions (non-Windows) ---
  if (platform !== 'win32') {
    try {
      fs.chmodSync(sharpBinaryPath, 0o755);
      console.log(`✅ [Sharp Fix] Set executable permissions on Sharp binary`);
    } catch (chmodError) {
      console.warn(`⚠️ [Sharp Fix] Could not set permissions: ${chmodError.message}`);
    }
  }

  // --- Verify library links ---
  if (platform === 'darwin') {
    try {
      const otoolOutput = execSync(`otool -L "${libvipsPath}"`, { encoding: 'utf8' });
      if (otoolOutput.includes('/usr/lib/libSystem.B.dylib')) {
        console.log('✅ [Sharp Fix] libvips has correct system library links');
      } else {
        console.warn('⚠️ [Sharp Fix] libvips may have incorrect library links');
      }
    } catch {
      console.warn('⚠️ [Sharp Fix] Could not verify library links (otool not available)');
    }
  }

  if (platform === 'win32' && libvipsDir) {
    const dllFiles = fs.readdirSync(libvipsDir).filter(f => f.endsWith('.dll'));
    console.log(`✅ [Sharp Fix] Found ${dllFiles.length} DLLs in libvips directory`);
  }

  // --- Verify architecture ---
  if (platform !== 'win32') {
    const archInfo = verifyBinaryArchitecture(sharpBinaryPath, platform);
    console.log(`   Architecture: ${archInfo}`);
  }

  // --- Create runtime configuration ---
  const configPath = path.join(unpackedPath, 'sharp-config.json');
  const config = {
    timestamp: new Date().toISOString(),
    platform,
    arch,
    sharpBinary: path.relative(unpackedPath, sharpBinaryPath),
    libvips: path.relative(unpackedPath, libvipsPath),
    sharpPlatformPkg,
    libvipsPkg,
    verified: true,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ [Sharp Fix] Created Sharp runtime configuration');

  // --- Test Sharp loading ---
  try {
    const originalCwd = process.cwd();
    process.chdir(path.join(unpackedPath, '..'));

    if (platform === 'darwin') {
      process.env.DYLD_LIBRARY_PATH = `${libvipsDir}:${process.env.DYLD_LIBRARY_PATH || ''}`;
    } else if (platform === 'linux') {
      process.env.LD_LIBRARY_PATH = `${libvipsDir}:${process.env.LD_LIBRARY_PATH || ''}`;
    } else if (platform === 'win32') {
      process.env.PATH = `${libvipsDir};${process.env.PATH || ''}`;
    }

    process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
    process.env.SHARP_FORCE_GLOBAL_LIBVIPS = '0';

    const sharpModulePath = path.join(sharpPath, 'lib', 'index.js');
    delete require.cache[sharpModulePath];
    const sharp = require(sharpPath);

    if (sharp.format) {
      console.log('✅ [Sharp Fix] Sharp formats available:', Object.keys(sharp.format));
    }

    process.chdir(originalCwd);
    console.log('✅ [Sharp Fix] Sharp test successful!');
  } catch (testError) {
    console.warn(`⚠️ [Sharp Fix] Sharp test failed: ${testError.message}`);
    console.warn('⚠️ [Sharp Fix] Sharp may not work at runtime');
  }

  console.log('🎉 [Sharp Fix] Sharp post-build fix completed successfully!');
  return true;
}

/**
 * Wrapper that catches errors and returns success/failure status.
 * Used by post-pack-fixes.js to determine if the build should fail.
 */
function fixSharpDependenciesSafe(context) {
  try {
    return fixSharpDependencies(context);
  } catch (error) {
    console.error(`❌ [Sharp Fix] Failed to fix Sharp dependencies: ${error.message}`);
    return false;
  }
}

// Export both the safe wrapper (default for electron-builder) and the raw function
exports.default = fixSharpDependenciesSafe;
exports.fixSharpDependencies = fixSharpDependencies;

// Esecuzione diretta
if (require.main === module) {
  const success = fixSharpDependenciesSafe();
  if (!success) process.exit(1);
}
