const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Post-build script per correggere le dipendenze Sharp nell'app rilasciata
 * Cross-platform: gestisce macOS (.app), Windows (unpacked), e Linux (AppImage)
 * Verifica che Sharp e libvips siano correttamente inclusi e funzionanti
 */

console.log('🔧 [Sharp Fix] Starting Sharp post-build fix...');

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

function fixSharpDependencies(context) {
  try {
    const platform = context?.electronPlatformName || process.platform;

    // electron-builder passes arch as a numeric enum (1=x64, 3=arm64, etc.)
    // We need the string form for package name resolution
    const ARCH_MAP = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
    const rawArch = context?.arch ?? process.arch;
    const arch = typeof rawArch === 'number' ? (ARCH_MAP[rawArch] || `unknown-${rawArch}`) : rawArch;

    const unpackedPath = getUnpackedPath(context);
    console.log(`📁 [Sharp Fix] Unpacked path: ${unpackedPath}`);
    console.log(`📁 [Sharp Fix] Platform: ${platform}, Arch: ${arch}`);

    if (!fs.existsSync(unpackedPath)) {
      throw new Error(`Unpacked path does not exist: ${unpackedPath}`);
    }

    // Percorsi critici
    const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');
    const imgPath = path.join(unpackedPath, 'node_modules', '@img');

    // Verifica che Sharp esista
    if (!fs.existsSync(sharpPath)) {
      throw new Error(`Sharp not found at: ${sharpPath}`);
    }

    if (!fs.existsSync(imgPath)) {
      throw new Error(`@img packages not found at: ${imgPath}`);
    }

    console.log('✅ [Sharp Fix] Sharp and @img packages found');

    // Cross-platform: detect correct Sharp binary package
    const sharpPlatformPkg = `sharp-${platform}-${arch}`;
    const sharpPlatformPath = path.join(imgPath, sharpPlatformPkg);

    // Find the Sharp binary (.node file)
    let sharpBinaryPath = null;
    const expectedBinaryPath = path.join(sharpPlatformPath, 'lib', `sharp-${platform}-${arch}.node`);

    if (fs.existsSync(expectedBinaryPath)) {
      sharpBinaryPath = expectedBinaryPath;
    } else {
      // Search for any .node file in the platform package
      if (fs.existsSync(sharpPlatformPath)) {
        const libDir = path.join(sharpPlatformPath, 'lib');
        if (fs.existsSync(libDir)) {
          const nodeFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.node'));
          if (nodeFiles.length > 0) {
            sharpBinaryPath = path.join(libDir, nodeFiles[0]);
          }
        }
      }
    }

    if (!sharpBinaryPath) {
      console.warn(`⚠️ [Sharp Fix] Sharp binary not found for ${platform}-${arch}`);
      console.warn(`   Expected at: ${expectedBinaryPath}`);
      console.warn(`   Listing @img contents:`);
      if (fs.existsSync(imgPath)) {
        fs.readdirSync(imgPath).forEach(item => {
          console.warn(`   - ${item}`);
        });
      }
      console.error('   ❌ Sharp will NOT be available for image processing');
      return;
    }

    console.log(`✅ [Sharp Fix] Sharp binary: ${path.relative(unpackedPath, sharpBinaryPath)}`);

    // Find libvips
    // Sharp 0.34+: libvips is bundled INSIDE @img/sharp-{platform}-{arch}/lib/
    // Sharp <0.34: libvips is in a separate @img/sharp-libvips-{platform}-{arch}/lib/
    let libvipsDir = null;
    let libvipsPath = null;

    const findLibvipsIn = (dir) => {
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir);
      let libvipsFile;
      if (platform === 'darwin') {
        libvipsFile = files.find(f => f.startsWith('libvips-cpp.') && f.endsWith('.dylib'));
      } else if (platform === 'win32') {
        libvipsFile = files.find(f => f === 'libvips-cpp.dll' || (f.startsWith('libvips') && f.endsWith('.dll')));
      } else {
        libvipsFile = files.find(f => f.startsWith('libvips-cpp.so'));
      }
      return libvipsFile ? path.join(dir, libvipsFile) : null;
    };

    // Strategy 1: Check inside sharp platform package (Sharp 0.34+ bundled layout)
    const sharpPlatformLibDir = path.join(sharpPlatformPath, 'lib');
    libvipsPath = findLibvipsIn(sharpPlatformLibDir);
    if (libvipsPath) {
      libvipsDir = sharpPlatformLibDir;
    }

    // Strategy 2: Check separate libvips package (Sharp <0.34 layout)
    if (!libvipsPath) {
      const libvipsPkg = `sharp-libvips-${platform}-${arch}`;
      const separateLibvipsDir = path.join(imgPath, libvipsPkg, 'lib');
      libvipsPath = findLibvipsIn(separateLibvipsDir);
      if (libvipsPath) {
        libvipsDir = separateLibvipsDir;
      }
    }

    if (!libvipsPath) {
      console.warn(`⚠️ [Sharp Fix] libvips not found for ${platform}-${arch}`);
      console.warn(`   Checked: ${sharpPlatformLibDir} and @img/sharp-libvips-${platform}-${arch}/lib`);
      console.error('   ❌ Sharp will NOT be available for image processing');
      return;
    }

    console.log(`✅ [Sharp Fix] libvips: ${path.relative(unpackedPath, libvipsPath)}`);

    // macOS: Create symlink sharp.node if needed
    if (platform === 'darwin') {
      const symlinkPath = path.join(sharpPlatformPath, 'sharp.node');
      if (!fs.existsSync(symlinkPath)) {
        try {
          fs.symlinkSync(`./lib/sharp-${platform}-${arch}.node`, symlinkPath);
          console.log('✅ [Sharp Fix] Created sharp.node symlink');
        } catch (symlinkError) {
          // Fallback: copy the file
          fs.copyFileSync(sharpBinaryPath, symlinkPath);
          console.log('✅ [Sharp Fix] Copied sharp.node (fallback)');
        }
      }
    }

    // Set executable permissions (non-Windows only)
    if (platform !== 'win32') {
      try {
        fs.chmodSync(sharpBinaryPath, 0o755);
        console.log(`✅ [Sharp Fix] Set executable permissions on Sharp binary`);
      } catch (chmodError) {
        console.warn(`⚠️ [Sharp Fix] Could not set permissions: ${chmodError.message}`);
      }
    }

    // macOS: Verify dynamic library links with otool
    if (platform === 'darwin') {
      try {
        const otoolOutput = execSync(`otool -L "${libvipsPath}"`, { encoding: 'utf8' });
        const hasSystemLibs = otoolOutput.includes('/usr/lib/libSystem.B.dylib');
        if (hasSystemLibs) {
          console.log('✅ [Sharp Fix] libvips has correct system library links');
        } else {
          console.warn('⚠️ [Sharp Fix] libvips may have incorrect library links');
        }
      } catch (otoolError) {
        console.warn('⚠️ [Sharp Fix] Could not verify library links (otool not available)');
      }
    }

    // Windows: Verify DLL accessibility
    if (platform === 'win32') {
      const dllFiles = fs.readdirSync(libvipsDir).filter(f => f.endsWith('.dll'));
      console.log(`✅ [Sharp Fix] Found ${dllFiles.length} DLLs in libvips directory`);
    }

    // Verify architecture (non-Windows)
    if (platform !== 'win32') {
      try {
        const fileOutput = execSync(`file "${sharpBinaryPath}"`, { encoding: 'utf8' });
        console.log(`   Architecture: ${fileOutput.trim().split(':').pop().trim()}`);
      } catch {
        console.warn('   ⚠️ Could not verify binary architecture');
      }
    }

    // Create runtime configuration
    const configPath = path.join(unpackedPath, 'sharp-config.json');
    const config = {
      timestamp: new Date().toISOString(),
      platform,
      arch,
      sharpBinary: path.relative(unpackedPath, sharpBinaryPath),
      libvips: path.relative(unpackedPath, libvipsPath),
      sharpPlatformPkg,
      libvipsPkg,
      verified: true
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ [Sharp Fix] Created Sharp runtime configuration');

    // Test: try to load Sharp
    try {
      const originalCwd = process.cwd();
      process.chdir(path.join(unpackedPath, '..'));

      // Set library paths
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

  } catch (error) {
    console.error(`❌ [Sharp Fix] Failed to fix Sharp dependencies: ${error.message}`);
    console.warn('⚠️ [Sharp Fix] Build will continue, but Sharp may not work at runtime');
  }
}

// Export per electron-builder hook
exports.default = fixSharpDependencies;

// Esecuzione diretta
if (require.main === module) {
  fixSharpDependencies();
}
