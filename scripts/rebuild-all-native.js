#!/usr/bin/env node

/**
 * Cross-Platform Native Module Rebuilder for RaceTagger Desktop
 *
 * Detects the current OS/architecture and rebuilds all native modules
 * for the correct Electron version. Handles:
 *
 * 1. raw-preview-extractor (custom C++ addon - vendor/raw-preview-extractor)
 * 2. better-sqlite3 (SQLite binding)
 * 3. sharp (image processing)
 *
 * Usage:
 *   node scripts/rebuild-all-native.js              # Rebuild all for current platform
 *   node scripts/rebuild-all-native.js --module=sharp  # Rebuild specific module
 *   node scripts/rebuild-all-native.js --arch=arm64    # Force architecture
 *   node scripts/rebuild-all-native.js --verbose       # Verbose output
 *   node scripts/rebuild-all-native.js --skip-test     # Skip module tests
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ==================== Configuration ====================

const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_EXTRACTOR_DIR = path.join(ROOT_DIR, 'vendor', 'raw-preview-extractor');

const CRITICAL_MODULES = ['sharp', 'better-sqlite3'];
const VENDOR_MODULES = ['raw-preview-extractor'];

// ==================== Argument Parsing ====================

const args = process.argv.slice(2);
const FLAGS = {
  verbose: args.includes('--verbose') || args.includes('-v'),
  skipTest: args.includes('--skip-test'),
  moduleFilter: (args.find(a => a.startsWith('--module=')) || '').replace('--module=', '') || null,
  archOverride: (args.find(a => a.startsWith('--arch=')) || '').replace('--arch=', '') || null,
};

// ==================== Platform Detection ====================

const PLATFORM = process.platform;
const ARCH = FLAGS.archOverride || process.arch;

const PLATFORM_NAMES = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
};

// ==================== Helpers ====================

function log(msg, color = 'reset') {
  const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
  };
  console.log(`${colors[color] || ''}${msg}\x1b[0m`);
}

function logVerbose(msg) {
  if (FLAGS.verbose) log(`  [verbose] ${msg}`, 'gray');
}

function execSafe(cmd, opts = {}) {
  const defaultOpts = {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: FLAGS.verbose ? 'inherit' : 'pipe',
    timeout: 300000, // 5 minutes
    ...opts,
  };

  logVerbose(`Executing: ${cmd}`);

  try {
    const result = execSync(cmd, defaultOpts);
    return { success: true, output: result || '' };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message,
    };
  }
}

function getElectronVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    const electronDep = pkg.devDependencies?.electron || pkg.dependencies?.electron || '';
    // Strip version range operators
    return electronDep.replace(/[\^~>=<]/g, '');
  } catch {
    return null;
  }
}

function getNodeAbiVersion() {
  try {
    const result = execSafe('npx electron -e "console.log(process.versions.modules)"', { stdio: 'pipe' });
    if (result.success) return result.output.trim();
  } catch {}
  return null;
}

// ==================== Module Tests ====================

function testModule(moduleName) {
  if (FLAGS.skipTest) return { success: true, skipped: true };

  log(`  Testing ${moduleName}...`, 'yellow');

  let testCmd;
  switch (moduleName) {
    case 'sharp':
      testCmd = `node -e "const s = require('sharp'); console.log('Sharp loaded, versions:', JSON.stringify(s.versions || {}));"`;
      break;
    case 'better-sqlite3':
      testCmd = `node -e "const db = require('better-sqlite3')(':memory:'); db.exec('SELECT 1'); console.log('better-sqlite3 OK');"`;
      break;
    case 'raw-preview-extractor':
      testCmd = `node -e "
        const p = require('path');
        const rpe = require(p.join('${RAW_EXTRACTOR_DIR.replace(/\\/g, '\\\\')}', 'dist', 'index.js'));
        const fmts = rpe.getSupportedFormats ? rpe.getSupportedFormats() : [];
        console.log('raw-preview-extractor loaded, formats:', fmts.length);
      "`;
      break;
    default:
      testCmd = `node -e "require('${moduleName}'); console.log('${moduleName} loaded');"`;
  }

  const result = execSafe(testCmd, { stdio: 'pipe' });
  if (result.success) {
    log(`  ✅ ${moduleName} test passed`, 'green');
  } else {
    log(`  ❌ ${moduleName} test failed: ${result.error || 'Unknown error'}`, 'red');
  }
  return result;
}

// ==================== Rebuild Functions ====================

/**
 * Rebuild raw-preview-extractor from source for the current platform
 */
function rebuildRawPreviewExtractor() {
  log('\n📦 Rebuilding raw-preview-extractor...', 'cyan');

  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    log('  ❌ Cannot determine Electron version', 'red');
    return false;
  }

  logVerbose(`Electron version: ${electronVersion}`);
  logVerbose(`Platform: ${PLATFORM}, Architecture: ${ARCH}`);

  // Step 1: Install dependencies in vendor/raw-preview-extractor
  log('  Installing dependencies...', 'yellow');
  const installResult = execSafe('npm install --ignore-scripts', { cwd: RAW_EXTRACTOR_DIR });
  if (!installResult.success) {
    log(`  ❌ npm install failed: ${installResult.error}`, 'red');
    return false;
  }

  // Step 2: Build native module with node-gyp targeting Electron
  log(`  Building native module for Electron ${electronVersion} (${PLATFORM}/${ARCH})...`, 'yellow');

  // Set environment for Electron build
  const buildEnv = {
    ...process.env,
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_arch: ARCH,
    npm_config_target_arch: ARCH,
    npm_config_build_from_source: 'true',
  };

  // Clean previous build
  const cleanResult = execSafe('node-gyp clean', { cwd: RAW_EXTRACTOR_DIR, env: buildEnv });
  logVerbose(`Clean: ${cleanResult.success ? 'OK' : 'skipped'}`);

  // Configure and build
  let buildCmd = `node-gyp configure build --release --arch=${ARCH}`;

  // On macOS, add deployment target
  if (PLATFORM === 'darwin') {
    buildEnv.MACOSX_DEPLOYMENT_TARGET = '11.0';
    // For universal builds on macOS, we may need special flags
    if (ARCH === 'arm64') {
      buildCmd += ' -- -arch arm64';
    }
  }

  const buildResult = execSafe(buildCmd, { cwd: RAW_EXTRACTOR_DIR, env: buildEnv });
  if (!buildResult.success) {
    log(`  ❌ node-gyp build failed: ${buildResult.error}`, 'red');
    log('  💡 Ensure you have build tools installed:', 'yellow');
    if (PLATFORM === 'darwin') log('     xcode-select --install', 'gray');
    if (PLATFORM === 'win32') log('     npm install -g windows-build-tools', 'gray');
    if (PLATFORM === 'linux') log('     sudo apt-get install build-essential', 'gray');
    return false;
  }

  // Step 3: Copy built binary to prebuilds directory
  const builtBinaryPath = path.join(RAW_EXTRACTOR_DIR, 'build', 'Release', 'raw_extractor.node');
  if (!fs.existsSync(builtBinaryPath)) {
    log(`  ❌ Built binary not found at ${builtBinaryPath}`, 'red');
    return false;
  }

  // Determine prebuild directory name
  const prebuildsDir = path.join(RAW_EXTRACTOR_DIR, 'prebuilds');
  const platformArchDir = path.join(prebuildsDir, `${PLATFORM}-${ARCH}`);

  // Create prebuild directory
  fs.mkdirSync(platformArchDir, { recursive: true });

  // Copy binary with correct name
  const targetBinaryPath = path.join(platformArchDir, 'raw-preview-extractor.node');
  fs.copyFileSync(builtBinaryPath, targetBinaryPath);
  fs.chmodSync(targetBinaryPath, 0o755);

  // Also copy to build/Release with the expected name
  const altTargetPath = path.join(RAW_EXTRACTOR_DIR, 'build', 'Release', 'raw-preview-extractor.node');
  try {
    fs.copyFileSync(builtBinaryPath, altTargetPath);
    fs.chmodSync(altTargetPath, 0o755);
  } catch {}

  // Verify architecture
  if (PLATFORM !== 'win32') {
    const fileResult = execSafe(`file "${targetBinaryPath}"`, { stdio: 'pipe' });
    if (fileResult.success) {
      log(`  📋 Binary info: ${fileResult.output.trim().split(':').pop().trim()}`, 'gray');
    }
  }

  const stats = fs.statSync(targetBinaryPath);
  log(`  ✅ Built and installed to prebuilds/${PLATFORM}-${ARCH}/ (${(stats.size / 1024).toFixed(0)}KB)`, 'green');

  // Step 4: Build TypeScript
  log('  Compiling TypeScript...', 'yellow');
  const tsResult = execSafe('npx tsc', { cwd: RAW_EXTRACTOR_DIR });
  if (!tsResult.success) {
    log('  ⚠️ TypeScript compilation warning (non-critical)', 'yellow');
  }

  return true;
}

/**
 * Rebuild a standard npm native module using @electron/rebuild
 */
function rebuildNpmModule(moduleName) {
  log(`\n📦 Rebuilding ${moduleName}...`, 'cyan');

  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    log('  ❌ Cannot determine Electron version', 'red');
    return false;
  }

  // Use @electron/rebuild for standard npm modules
  const cmd = `npx @electron/rebuild -f -w ${moduleName} -v ${electronVersion} --arch ${ARCH}`;
  logVerbose(`Command: ${cmd}`);

  const result = execSafe(cmd);
  if (result.success) {
    log(`  ✅ ${moduleName} rebuilt successfully`, 'green');
    return true;
  } else {
    log(`  ❌ ${moduleName} rebuild failed: ${result.error}`, 'red');
    return false;
  }
}

// ==================== Main ====================

function main() {
  log('═══════════════════════════════════════════════════════', 'cyan');
  log('  RaceTagger Native Module Rebuilder', 'cyan');
  log('═══════════════════════════════════════════════════════', 'cyan');
  log('');
  log(`  Platform:     ${PLATFORM_NAMES[PLATFORM] || PLATFORM}`, 'blue');
  log(`  Architecture: ${ARCH}`, 'blue');
  log(`  Node.js:      ${process.version}`, 'blue');

  const electronVersion = getElectronVersion();
  log(`  Electron:     ${electronVersion || 'unknown'}`, 'blue');

  if (FLAGS.moduleFilter) {
    log(`  Filter:       ${FLAGS.moduleFilter}`, 'blue');
  }
  log('');

  if (!electronVersion) {
    log('❌ Could not determine Electron version from package.json', 'red');
    process.exit(1);
  }

  // Check if node-gyp is available (needed for raw-preview-extractor)
  const gypCheck = execSafe('node-gyp --version', { stdio: 'pipe' });
  if (!gypCheck.success) {
    log('⚠️ node-gyp not found. Installing...', 'yellow');
    execSafe('npm install -g node-gyp');
  } else {
    logVerbose(`node-gyp version: ${gypCheck.output.trim()}`);
  }

  const results = {};
  let allSuccess = true;

  // ---- raw-preview-extractor (from vendor/) ----
  if (!FLAGS.moduleFilter || FLAGS.moduleFilter === 'raw-preview-extractor') {
    const rebuilt = rebuildRawPreviewExtractor();
    const tested = rebuilt ? testModule('raw-preview-extractor') : { success: false };
    results['raw-preview-extractor'] = { rebuilt, tested: tested.success };
    if (!rebuilt) allSuccess = false;
  }

  // ---- Standard npm modules ----
  for (const moduleName of CRITICAL_MODULES) {
    if (FLAGS.moduleFilter && FLAGS.moduleFilter !== moduleName) continue;

    const rebuilt = rebuildNpmModule(moduleName);
    const tested = rebuilt ? testModule(moduleName) : { success: false };
    results[moduleName] = { rebuilt, tested: tested.success };
    if (!rebuilt) allSuccess = false;
  }

  // ==================== Summary ====================

  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  Rebuild Summary', 'cyan');
  log('═══════════════════════════════════════════════════════', 'cyan');

  for (const [name, result] of Object.entries(results)) {
    const icon = result.rebuilt && result.tested ? '✅' : result.rebuilt ? '⚠️' : '❌';
    const status = result.rebuilt && result.tested ? 'OK'
      : result.rebuilt ? 'REBUILT (test failed)'
      : 'FAILED';
    const color = result.rebuilt && result.tested ? 'green' : result.rebuilt ? 'yellow' : 'red';
    log(`  ${icon} ${name.padEnd(25)} ${status}`, color);
  }

  log('');

  if (allSuccess) {
    log('✅ All native modules rebuilt successfully!', 'green');
    log('', 'reset');
    log('Next steps:', 'cyan');
    log('  npm run compile       # Compile TypeScript', 'gray');
    log('  npm run dev           # Start development', 'gray');
    log('  npm run build         # Create release build', 'gray');
  } else {
    log('❌ Some modules failed to rebuild. Check errors above.', 'red');
    log('', 'reset');
    log('Troubleshooting:', 'yellow');
    if (PLATFORM === 'darwin') {
      log('  1. Install Xcode tools: xcode-select --install', 'gray');
      log('  2. Ensure Python 3: python3 --version', 'gray');
    } else if (PLATFORM === 'win32') {
      log('  1. Install Visual Studio Build Tools 2022', 'gray');
      log('  2. Run: npm install -g windows-build-tools', 'gray');
    } else {
      log('  1. Install build tools: sudo apt-get install build-essential', 'gray');
      log('  2. Install Python 3: sudo apt-get install python3', 'gray');
    }
    process.exit(1);
  }
}

main();
