#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Pre-build validation for native dependencies.
 *
 * Checks that Sharp and raw-preview-extractor binaries exist for the
 * target platform/arch BEFORE electron-builder starts packaging.
 * If missing, attempts to install them automatically.
 *
 * Usage:
 *   node scripts/validate-native-deps.js --platform=darwin --arch=arm64
 *   node scripts/validate-native-deps.js --platform=win32 --arch=x64
 *   node scripts/validate-native-deps.js --platform=darwin --arch=x64 --no-install
 *
 * Exit codes:
 *   0 = all deps present
 *   1 = deps missing and could not be resolved
 */

const ROOT_DIR = path.resolve(__dirname, '..');

// ==================== Argument Parsing ====================

const args = process.argv.slice(2);

function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

const targetPlatform = getArg('platform') || process.platform;
const targetArch = getArg('arch') || process.arch;
const noInstall = args.includes('--no-install');

// ==================== Helpers ====================

function log(msg, color) {
  const colors = {
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
  };
  console.log(`${colors[color] || ''}${msg}\x1b[0m`);
}

function execSafe(cmd) {
  try {
    return { success: true, output: execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { success: false, error: error.stderr || error.message };
  }
}

// ==================== Sharp Validation ====================

function validateSharp() {
  log(`\n📦 Validating Sharp for ${targetPlatform}-${targetArch}...`, 'cyan');

  const nodeModulesImg = path.join(ROOT_DIR, 'node_modules', '@img');
  const sharpPkg = `sharp-${targetPlatform}-${targetArch}`;
  const sharpPkgPath = path.join(nodeModulesImg, sharpPkg);

  // Check 1: Does the platform package exist?
  if (!fs.existsSync(sharpPkgPath)) {
    log(`   ❌ Missing: @img/${sharpPkg}`, 'red');
    return { ok: false, missing: [sharpPkg] };
  }

  // Check 2: Does it contain the .node binary?
  const libDir = path.join(sharpPkgPath, 'lib');
  const binaryPath = path.join(libDir, `sharp-${targetPlatform}-${targetArch}.node`);
  let hasBinary = fs.existsSync(binaryPath);

  if (!hasBinary && fs.existsSync(libDir)) {
    // Fallback: any .node file
    const nodeFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.node'));
    hasBinary = nodeFiles.length > 0;
  }

  if (!hasBinary) {
    log(`   ❌ @img/${sharpPkg} exists but has no .node binary`, 'red');
    return { ok: false, missing: [sharpPkg] };
  }

  log(`   ✅ @img/${sharpPkg} — binary found`, 'green');

  // Check 3: Does it contain libvips (Sharp 0.34+ bundles it inside)?
  let hasLibvips = false;
  if (fs.existsSync(libDir)) {
    const files = fs.readdirSync(libDir);
    if (targetPlatform === 'darwin') {
      hasLibvips = files.some(f => f.startsWith('libvips-cpp.') && f.endsWith('.dylib'));
    } else if (targetPlatform === 'win32') {
      hasLibvips = files.some(f => f === 'libvips-cpp.dll' || (f.startsWith('libvips') && f.endsWith('.dll')));
    } else {
      hasLibvips = files.some(f => f.startsWith('libvips-cpp.so'));
    }
  }

  if (hasLibvips) {
    log(`   ✅ libvips bundled inside @img/${sharpPkg}`, 'green');
    return { ok: true, missing: [] };
  }

  // Check 4: Separate libvips package (Sharp <0.34)
  const libvipsPkg = `sharp-libvips-${targetPlatform}-${targetArch}`;
  const libvipsPkgPath = path.join(nodeModulesImg, libvipsPkg);

  if (fs.existsSync(libvipsPkgPath)) {
    const libvipsLibDir = path.join(libvipsPkgPath, 'lib');
    if (fs.existsSync(libvipsLibDir)) {
      log(`   ✅ @img/${libvipsPkg} — found`, 'green');
      return { ok: true, missing: [] };
    }
  }

  log(`   ❌ libvips not found (neither bundled nor as separate @img/${libvipsPkg})`, 'red');
  return { ok: false, missing: [libvipsPkg] };
}

// ==================== RAW-preview-extractor Validation ====================

function validateRawPreviewExtractor() {
  log(`\n📦 Validating raw-preview-extractor for ${targetPlatform}-${targetArch}...`, 'cyan');

  const rawExtractorDir = path.join(ROOT_DIR, 'vendor', 'raw-preview-extractor');
  if (!fs.existsSync(rawExtractorDir)) {
    // Also check node_modules
    const nmPath = path.join(ROOT_DIR, 'node_modules', 'raw-preview-extractor');
    if (!fs.existsSync(nmPath)) {
      log('   ⚠️ raw-preview-extractor not found (ExifTool fallback will be used)', 'yellow');
      return { ok: false, fatal: false };
    }
  }

  // Look for a binary matching the target
  const searchDirs = [
    path.join(rawExtractorDir, 'prebuilds', `${targetPlatform}-${targetArch}`),
    path.join(rawExtractorDir, 'prebuilds', `${targetPlatform}-universal`),
    path.join(rawExtractorDir, 'prebuilds', `${targetPlatform}-x64+arm64`),
  ];

  const binaryNames = ['raw-preview-extractor.node', 'raw_extractor.node'];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of binaryNames) {
      if (fs.existsSync(path.join(dir, name))) {
        log(`   ✅ Binary found: ${path.relative(ROOT_DIR, path.join(dir, name))}`, 'green');
        return { ok: true, fatal: false };
      }
    }
  }

  log('   ⚠️ No prebuild found for target — ExifTool fallback will be used', 'yellow');
  log(`   Run: npm run rebuild:native -- --arch=${targetArch} to build from source`, 'gray');
  return { ok: false, fatal: false };
}

// ==================== Auto-Install ====================

function installMissingSharpPackages(missing) {
  if (noInstall) {
    log('\n   --no-install flag set, skipping auto-install', 'yellow');
    return false;
  }

  // Read Sharp version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const sharpVersion = (pkg.dependencies.sharp || '^0.34.3').replace(/[\^~]/, '');

  log(`\n🔧 Attempting to install missing Sharp packages (v${sharpVersion})...`, 'cyan');

  const packages = missing.map(m => `@img/${m}@^${sharpVersion}`);
  const cmd = `npm install --no-save ${packages.join(' ')}`;

  log(`   Running: ${cmd}`, 'gray');
  const result = execSafe(cmd);

  if (result.success) {
    log('   ✅ Installation successful', 'green');
    return true;
  }

  log(`   ❌ Installation failed: ${result.error}`, 'red');
  return false;
}

// ==================== Main ====================

function main() {
  log('═══════════════════════════════════════════════════════', 'cyan');
  log('  RaceTagger Pre-Build Dependency Validation', 'cyan');
  log('═══════════════════════════════════════════════════════', 'cyan');
  log(`  Target:  ${targetPlatform}-${targetArch}`, 'blue');
  log(`  Host:    ${process.platform}-${process.arch}`, 'blue');

  const crossCompile = targetPlatform !== process.platform || targetArch !== process.arch;
  if (crossCompile) {
    log(`  ⚡ Cross-compile detected`, 'yellow');
  }

  let exitCode = 0;

  // --- Sharp (critical) ---
  let sharpResult = validateSharp();

  if (!sharpResult.ok && sharpResult.missing.length > 0) {
    // Try auto-install
    const installed = installMissingSharpPackages(sharpResult.missing);
    if (installed) {
      // Re-validate
      sharpResult = validateSharp();
    }
  }

  if (!sharpResult.ok) {
    log('\n❌ Sharp validation FAILED', 'red');
    log('   The build will not produce a working application.', 'red');
    log(`   Fix: npm install @img/sharp-${targetPlatform}-${targetArch}@^0.34.3`, 'yellow');
    exitCode = 1;
  }

  // --- RAW-preview-extractor (non-critical) ---
  const rawResult = validateRawPreviewExtractor();
  // Not fatal even if missing — ExifTool fallback exists

  // --- Summary ---
  log('\n' + '─'.repeat(50), 'cyan');
  log(`  Sharp:              ${sharpResult.ok ? '✅ Ready' : '❌ MISSING'}`, sharpResult.ok ? 'green' : 'red');
  log(`  raw-preview-ext:    ${rawResult.ok ? '✅ Ready' : '⚠️ Will use ExifTool'}`, rawResult.ok ? 'green' : 'yellow');
  log('─'.repeat(50), 'cyan');

  if (exitCode === 0) {
    log(`\n✅ All critical dependencies ready for ${targetPlatform}-${targetArch}`, 'green');
    log('   Proceeding with build...\n', 'gray');
  } else {
    log(`\n❌ Build aborted: missing critical dependencies for ${targetPlatform}-${targetArch}`, 'red');
    log('   See above for install instructions.\n', 'gray');
  }

  process.exit(exitCode);
}

main();
