#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Pre-build validation for ALL native dependencies.
 *
 * Validates that every native module required by RaceTagger has the
 * correct binary for the target platform/arch BEFORE electron-builder
 * starts packaging. If Sharp packages are missing, attempts auto-install.
 *
 * Modules checked:
 *   - Sharp            (critical — image processing)
 *   - onnxruntime-node (critical — local ML inference)
 *   - raw-preview-ext  (non-critical — ExifTool fallback)
 *   - canvas           (REMOVED — face-api.js replaced by ONNX pipeline)
 *   - ExifTool         (non-critical — vendor binary, arch-independent)
 *
 * Usage:
 *   node scripts/validate-native-deps.js --platform=darwin --arch=arm64
 *   node scripts/validate-native-deps.js --platform=win32 --arch=x64
 *   node scripts/validate-native-deps.js --platform=darwin --arch=x64 --no-install
 *
 * Exit codes:
 *   0 = all critical deps present
 *   1 = critical deps missing and could not be resolved
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

// ==================== ONNX Runtime Validation ====================

function validateOnnxRuntime() {
  log(`\n📦 Validating onnxruntime-node for ${targetPlatform}-${targetArch}...`, 'cyan');

  const onnxDir = path.join(ROOT_DIR, 'node_modules', 'onnxruntime-node');

  if (!fs.existsSync(onnxDir)) {
    log('   ❌ onnxruntime-node not installed', 'red');
    return { ok: false, fatal: true };
  }

  // onnxruntime-node uses: bin/napi-v{N}/{platform}/{arch}/onnxruntime_binding.node
  const binDir = path.join(onnxDir, 'bin');
  if (!fs.existsSync(binDir)) {
    log('   ❌ onnxruntime-node/bin/ directory missing', 'red');
    return { ok: false, fatal: true };
  }

  // Find the napi version directory (usually napi-v6)
  const napiDirs = fs.readdirSync(binDir).filter(d =>
    d.startsWith('napi-v') && fs.statSync(path.join(binDir, d)).isDirectory()
  );

  if (napiDirs.length === 0) {
    log('   ❌ No napi-v* directories found in onnxruntime-node/bin/', 'red');
    return { ok: false, fatal: true };
  }

  // Check for the target platform/arch binding
  let bindingFound = false;
  let supportLibFound = false;

  for (const napiDir of napiDirs) {
    const bindingPath = path.join(binDir, napiDir, targetPlatform, targetArch, 'onnxruntime_binding.node');

    if (fs.existsSync(bindingPath)) {
      bindingFound = true;
      log(`   ✅ Binding: ${napiDir}/${targetPlatform}/${targetArch}/onnxruntime_binding.node`, 'green');

      // Check for the support library (libonnxruntime.dylib / onnxruntime.dll / libonnxruntime.so)
      const platformDir = path.join(binDir, napiDir, targetPlatform, targetArch);
      const files = fs.readdirSync(platformDir);

      if (targetPlatform === 'darwin') {
        supportLibFound = files.some(f => f.startsWith('libonnxruntime') && f.endsWith('.dylib'));
        if (supportLibFound) {
          const lib = files.find(f => f.startsWith('libonnxruntime') && f.endsWith('.dylib'));
          log(`   ✅ Runtime library: ${lib}`, 'green');
        }
      } else if (targetPlatform === 'win32') {
        supportLibFound = files.some(f => f === 'onnxruntime.dll');
        if (supportLibFound) {
          log(`   ✅ Runtime library: onnxruntime.dll`, 'green');
          // Also check DirectML support DLLs (optional but important on Windows)
          const hasDirectML = files.some(f => f === 'DirectML.dll');
          if (hasDirectML) {
            log(`   ✅ DirectML acceleration: available`, 'green');
          }
        }
      } else {
        supportLibFound = files.some(f => f.startsWith('libonnxruntime.so'));
        if (supportLibFound) {
          const lib = files.find(f => f.startsWith('libonnxruntime.so'));
          log(`   ✅ Runtime library: ${lib}`, 'green');
        }
      }

      break;
    }
  }

  if (!bindingFound) {
    log(`   ❌ No binding found for ${targetPlatform}/${targetArch}`, 'red');
    log(`   Available platforms:`, 'gray');
    for (const napiDir of napiDirs) {
      const napiBase = path.join(binDir, napiDir);
      if (fs.existsSync(napiBase)) {
        const platforms = fs.readdirSync(napiBase).filter(d =>
          fs.statSync(path.join(napiBase, d)).isDirectory()
        );
        for (const plat of platforms) {
          const archs = fs.readdirSync(path.join(napiBase, plat)).filter(d =>
            fs.statSync(path.join(napiBase, plat, d)).isDirectory()
          );
          log(`     ${napiDir}/${plat}: ${archs.join(', ')}`, 'gray');
        }
      }
    }
    return { ok: false, fatal: true };
  }

  if (!supportLibFound) {
    log(`   ⚠️ Binding found but runtime library missing — ONNX may fail at runtime`, 'yellow');
    return { ok: false, fatal: true };
  }

  return { ok: true, fatal: false };
}

// ==================== ExifTool Validation ====================

function validateExifTool() {
  log(`\n📦 Validating ExifTool for ${targetPlatform}...`, 'cyan');

  // ExifTool is arch-independent (Perl-based), we just need the right platform vendor dir
  const platformMap = {
    darwin: 'darwin',
    win32: 'win32',
    linux: 'linux',
  };

  const vendorPlatform = platformMap[targetPlatform];
  if (!vendorPlatform) {
    log(`   ⚠️ Unknown platform: ${targetPlatform}`, 'yellow');
    return { ok: false, fatal: false };
  }

  const vendorDir = path.join(ROOT_DIR, 'vendor', vendorPlatform);

  if (!fs.existsSync(vendorDir)) {
    log(`   ❌ vendor/${vendorPlatform}/ directory missing`, 'red');
    log(`   ExifTool is the fallback for RAW preview extraction — app may have reduced functionality`, 'yellow');
    return { ok: false, fatal: false };
  }

  // Check for the exiftool executable
  if (targetPlatform === 'win32') {
    const exiftoolPl = path.join(vendorDir, 'exiftool.pl');
    const perlDll = path.join(vendorDir, 'perl532.dll');

    if (!fs.existsSync(exiftoolPl)) {
      log(`   ❌ exiftool.pl not found in vendor/win32/`, 'red');
      return { ok: false, fatal: false };
    }

    if (!fs.existsSync(perlDll)) {
      log(`   ⚠️ perl532.dll not found — ExifTool may not run on Windows`, 'yellow');
      return { ok: false, fatal: false };
    }

    log(`   ✅ exiftool.pl + Perl runtime found`, 'green');
  } else {
    const exiftool = path.join(vendorDir, 'exiftool');
    if (!fs.existsSync(exiftool)) {
      log(`   ❌ exiftool binary not found in vendor/${vendorPlatform}/`, 'red');
      return { ok: false, fatal: false };
    }
    log(`   ✅ exiftool binary found`, 'green');
  }

  // Check for Perl library (needed for ExifTool to function)
  const libDir = path.join(vendorDir, 'lib');
  if (!fs.existsSync(libDir)) {
    log(`   ⚠️ vendor/${vendorPlatform}/lib/ missing — ExifTool may not function`, 'yellow');
    return { ok: false, fatal: false };
  }

  log(`   ✅ Perl library directory present`, 'green');
  return { ok: true, fatal: false };
}

// ==================== Canvas Validation ====================

function validateCanvas() {
  log(`\n📦 Validating canvas for ${targetPlatform}-${targetArch}...`, 'cyan');

  const canvasDir = path.join(ROOT_DIR, 'node_modules', 'canvas');

  if (!fs.existsSync(canvasDir)) {
    log('   ⚠️ canvas not installed (face recognition is disabled — not required)', 'yellow');
    return { ok: false, fatal: false };
  }

  // canvas uses prebuild-install: build/Release/canvas.node
  const binaryPath = path.join(canvasDir, 'build', 'Release', 'canvas.node');

  if (!fs.existsSync(binaryPath)) {
    // Check for prebuilds directory too
    const prebuildsDir = path.join(canvasDir, 'prebuilds', `${targetPlatform}-${targetArch}`);
    const hasPrebuilt = fs.existsSync(prebuildsDir) &&
      fs.readdirSync(prebuildsDir).some(f => f.endsWith('.node'));

    if (!hasPrebuilt) {
      log('   ⚠️ No canvas binary for target (face recognition is disabled — not blocking)', 'yellow');
      return { ok: false, fatal: false };
    }

    log(`   ✅ Canvas prebuild found for ${targetPlatform}-${targetArch}`, 'green');
    return { ok: true, fatal: false };
  }

  log(`   ✅ canvas.node binary found`, 'green');

  // Note: canvas.node may be built for host arch only (not target arch in cross-compile)
  const crossCompile = targetPlatform !== process.platform || targetArch !== process.arch;
  if (crossCompile) {
    log(`   ⚠️ canvas.node may be built for host arch (${process.arch}), not target (${targetArch})`, 'yellow');
    log(`   Face recognition is disabled — not blocking the build`, 'gray');
  }

  return { ok: true, fatal: false };
}

// ==================== RAW-preview-extractor Validation ====================

function validateRawPreviewExtractor() {
  log(`\n📦 Validating raw-preview-extractor for ${targetPlatform}-${targetArch}...`, 'cyan');

  const rawExtractorDir = path.join(ROOT_DIR, 'vendor', 'raw-preview-extractor');
  const nmPath = path.join(ROOT_DIR, 'node_modules', 'raw-preview-extractor');
  const searchBase = fs.existsSync(rawExtractorDir) ? rawExtractorDir :
                     fs.existsSync(nmPath) ? nmPath : null;

  if (!searchBase) {
    log('   ⚠️ raw-preview-extractor not found (ExifTool fallback will be used)', 'yellow');
    return { ok: false, fatal: false };
  }

  const searchDirs = [
    path.join(searchBase, 'prebuilds', `${targetPlatform}-${targetArch}`),
    path.join(searchBase, 'prebuilds', `${targetPlatform}-universal`),
    path.join(searchBase, 'prebuilds', `${targetPlatform}-x64+arm64`),
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

  // ── Critical modules (build fails if missing) ──────────────

  // Sharp
  let sharpResult = validateSharp();
  if (!sharpResult.ok && sharpResult.missing && sharpResult.missing.length > 0) {
    const installed = installMissingSharpPackages(sharpResult.missing);
    if (installed) {
      sharpResult = validateSharp();
    }
  }
  if (!sharpResult.ok) {
    log(`\n   ❌ Fix: npm install @img/sharp-${targetPlatform}-${targetArch}@^0.34.3`, 'yellow');
    exitCode = 1;
  }

  // ONNX Runtime
  const onnxResult = validateOnnxRuntime();
  if (!onnxResult.ok) {
    log(`\n   ❌ Fix: npm install onnxruntime-node`, 'yellow');
    exitCode = 1;
  }

  // ── Non-critical modules (warnings only) ───────────────────

  const rawResult = validateRawPreviewExtractor();
  const exiftoolResult = validateExifTool();
  const canvasResult = validateCanvas();

  // ── Summary ────────────────────────────────────────────────

  log('\n' + '═'.repeat(50), 'cyan');
  log('  Validation Summary', 'cyan');
  log('═'.repeat(50), 'cyan');

  // Critical
  log(`  Sharp              ${sharpResult.ok ? '✅ Ready' : '❌ MISSING'}`, sharpResult.ok ? 'green' : 'red');
  log(`  onnxruntime-node   ${onnxResult.ok ? '✅ Ready' : '❌ MISSING'}`, onnxResult.ok ? 'green' : 'red');

  // Non-critical
  log(`  raw-preview-ext    ${rawResult.ok ? '✅ Ready' : '⚠️  ExifTool fallback'}`, rawResult.ok ? 'green' : 'yellow');
  log(`  ExifTool           ${exiftoolResult.ok ? '✅ Ready' : '⚠️  Missing'}`, exiftoolResult.ok ? 'green' : 'yellow');
  log(`  canvas             ${canvasResult.ok ? '✅ Ready' : '⚠️  Disabled (face rec.)'}`, canvasResult.ok ? 'green' : 'yellow');

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
