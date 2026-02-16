const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Shared build utilities for RaceTagger post-pack and validation scripts.
 * Single source of truth for platform detection, path resolution, and
 * architecture mapping used across all build scripts.
 */

// electron-builder passes arch as a numeric enum — map to string
const ARCH_MAP = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
};

/**
 * Resolve electron-builder's numeric arch enum (or string) to a string.
 */
function resolveArch(rawArch) {
  if (typeof rawArch === 'number') {
    return ARCH_MAP[rawArch] || `unknown-${rawArch}`;
  }
  return rawArch || process.arch;
}

/**
 * Resolve platform and arch from an electron-builder afterPack context
 * (or fall back to process.platform / process.arch).
 */
function resolvePlatformArch(context) {
  const platform = context?.electronPlatformName || process.platform;
  const arch = resolveArch(context?.arch ?? process.arch);
  return { platform, arch };
}

/**
 * Find the first .app bundle inside a directory.
 */
function findAppBundle(buildDir) {
  if (!fs.existsSync(buildDir)) return null;
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
 * Determine the app.asar.unpacked path from either an electron-builder
 * afterPack context or by scanning the release/ directory.
 */
function getUnpackedPath(context) {
  const { platform } = resolvePlatformArch(context);

  if (context && context.appOutDir) {
    // Called from electron-builder hook
    if (platform === 'darwin') {
      const appName = context.packager.appInfo.productFilename + '.app';
      const appPath = path.join(context.appOutDir, appName);
      return path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
    }
    // Windows / Linux
    return path.join(context.appOutDir, 'resources', 'app.asar.unpacked');
  }

  // Manual invocation — scan release/
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

    // Windows / Linux
    const winUnpacked = path.join(fullPlatformPath, 'resources', 'app.asar.unpacked');
    if (fs.existsSync(winUnpacked)) {
      return winUnpacked;
    }
  }

  throw new Error('Cannot find app bundle in release directory');
}

/**
 * Verify binary architecture using `file` (non-Windows).
 * Returns the architecture description string.
 */
function verifyBinaryArchitecture(binaryPath, platform) {
  if (platform === 'win32') return 'windows-binary (not checked)';
  try {
    const fileOutput = execSync(`file "${binaryPath}"`, { encoding: 'utf8' });
    return fileOutput.trim().split(':').pop().trim();
  } catch {
    return 'unknown (file command failed)';
  }
}

/**
 * Find a libvips library file in a directory.
 * Returns the full path or null.
 */
function findLibvipsIn(dir, platform) {
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
}

module.exports = {
  ARCH_MAP,
  resolveArch,
  resolvePlatformArch,
  findAppBundle,
  getUnpackedPath,
  verifyBinaryArchitecture,
  findLibvipsIn,
};
