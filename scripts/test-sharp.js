const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Script di test per verificare che Sharp sia configurato correttamente
 * Può essere eseguito sia in sviluppo che su un'app rilasciata
 */

console.log('🧪 [Sharp Test] Starting Sharp verification...');

function testSharpInDevelopment() {
  console.log('📚 [Sharp Test] Testing Sharp in development environment...');
  
  try {
    // Test di base per Sharp
    const sharp = require('sharp');
    console.log('✅ [Sharp Test] Sharp module loaded successfully');
    
    if (sharp.versions) {
      console.log('📋 [Sharp Test] Sharp versions:', sharp.versions);
    }
    
    // Test di funzionalità base
    const testBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
      0x00, 0x10, 0x0B, 0x0C, 0x0E, 0x0C, 0x0A, 0x10, 0x0E, 0x0D, 0x0E, 0x12,
      0x11, 0x10, 0x13, 0x18, 0x28, 0x1A, 0x18, 0x16, 0x16, 0x18, 0x31, 0x23,
      0x25, 0x1D, 0x28, 0x3A, 0x33, 0x3D, 0x3C, 0x39, 0x33, 0x38, 0x37, 0x40,
      0x48, 0x5C, 0x4E, 0x40, 0x44, 0x57, 0x45, 0x37, 0x38, 0x50, 0x6D, 0x51,
      0x57, 0x5F, 0x62, 0x67, 0x68, 0x67, 0x3E, 0x4D, 0x71, 0x79, 0x70, 0x64,
      0x78, 0x5C, 0x65, 0x67, 0x63, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
      0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
      0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00,
      0xB5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05,
      0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11,
      0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71,
      0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52,
      0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18,
      0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
      0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53,
      0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67,
      0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83,
      0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96,
      0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9,
      0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
      0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6,
      0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8,
      0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
      0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00,
      0x3F, 0x00, 0xAA, 0xFF, 0xD9
    ]);
    
    const instance = sharp(testBuffer);
    const metadata = instance.metadata();
    console.log('✅ [Sharp Test] Metadata test passed');
    
    const resizeTest = instance.resize(10, 10).jpeg({ quality: 80 }).toBuffer();
    console.log('✅ [Sharp Test] Resize test passed');
    
    return true;
    
  } catch (error) {
    console.error('❌ [Sharp Test] Development test failed:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

function testSharpInProduction(appPath) {
  console.log('📦 [Sharp Test] Testing Sharp in production environment...');
  
  try {
    // Percorsi per l'app rilasciata
    const resourcesPath = path.join(appPath, 'Contents', 'Resources');
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
    const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');
    const imgPath = path.join(unpackedPath, 'node_modules', '@img');
    
    console.log(`📁 [Sharp Test] Testing app at: ${appPath}`);
    console.log(`📁 [Sharp Test] Resources path: ${resourcesPath}`);
    console.log(`📁 [Sharp Test] Unpacked path: ${unpackedPath}`);
    
    // Verifica percorsi base
    const criticalPaths = {
      'Resources': resourcesPath,
      'Unpacked': unpackedPath,
      'Sharp': sharpPath,
      '@img': imgPath
    };
    
    for (const [name, checkPath] of Object.entries(criticalPaths)) {
      if (fs.existsSync(checkPath)) {
        console.log(`✅ [Sharp Test] ${name} path exists: ${checkPath}`);
      } else {
        console.error(`❌ [Sharp Test] ${name} path missing: ${checkPath}`);
        return false;
      }
    }
    
    // Verifica binari nativi
    const binaryChecks = [
      {
        name: 'Sharp binary',
        path: path.join(imgPath, 'sharp-darwin-arm64', 'lib', 'sharp-darwin-arm64.node')
      },
      {
        name: 'Sharp symlink',
        path: path.join(imgPath, 'sharp-darwin-arm64', 'sharp.node')
      },
      {
        name: 'libvips',
        path: path.join(imgPath, 'sharp-libvips-darwin-arm64', 'lib', 'libvips-cpp.8.17.1.dylib')
      }
    ];
    
    for (const check of binaryChecks) {
      if (fs.existsSync(check.path)) {
        const stats = fs.statSync(check.path);
        console.log(`✅ [Sharp Test] ${check.name} found: ${check.path} (${stats.size} bytes)`);
        
        // Verifica permessi esecutivi per .node files
        if (check.path.endsWith('.node') && (stats.mode & 0o111) === 0) {
          console.warn(`⚠️ [Sharp Test] ${check.name} may not be executable (mode: ${stats.mode.toString(8)})`);
        }
      } else {
        console.error(`❌ [Sharp Test] ${check.name} missing: ${check.path}`);
        return false;
      }
    }
    
    // Verifica file di configurazione
    const configPath = path.join(unpackedPath, 'sharp-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('✅ [Sharp Test] Sharp config found:', config);
      } catch (configError) {
        console.warn('⚠️ [Sharp Test] Could not read Sharp config:', configError.message);
      }
    } else {
      console.warn('⚠️ [Sharp Test] Sharp config not found - may indicate post-build script did not run');
    }
    
    // Test di caricamento Sharp (runtime test)
    const originalCwd = process.cwd();
    try {
      process.chdir(unpackedPath);
      
      // Configura ambiente
      process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
      process.env.SHARP_FORCE_GLOBAL_LIBVIPS = '0';
      process.env.SHARP_VENDOR_LIBVIPS_PATH = path.join(imgPath, 'sharp-libvips-darwin-arm64', 'lib');
      process.env.SHARP_VENDOR_PATH = path.join(imgPath, 'sharp-darwin-arm64', 'lib');
      
      // Pulisce cache
      delete require.cache[require.resolve(sharpPath)];
      
      // Carica Sharp
      const sharp = require(sharpPath);
      console.log('✅ [Sharp Test] Sharp module loaded successfully in production');
      
      if (sharp.versions) {
        console.log('📋 [Sharp Test] Sharp versions:', sharp.versions);
      }
      
      // Test funzionale
      const testBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0xFF, 0xD9]);
      const instance = sharp(testBuffer);
      instance.metadata();
      console.log('✅ [Sharp Test] Production functionality test passed');
      
      return true;
      
    } catch (loadError) {
      console.error('❌ [Sharp Test] Sharp loading failed in production:', loadError.message);
      console.error('Stack trace:', loadError.stack);
      return false;
    } finally {
      process.chdir(originalCwd);
    }
    
  } catch (error) {
    console.error('❌ [Sharp Test] Production test failed:', error.message);
    return false;
  }
}

function findAppBundles() {
  const releaseDir = path.join(process.cwd(), 'release');
  const appBundles = [];
  
  if (!fs.existsSync(releaseDir)) {
    return appBundles;
  }
  
  const platformDirs = fs.readdirSync(releaseDir).filter(d => 
    fs.statSync(path.join(releaseDir, d)).isDirectory()
  );
  
  for (const platformDir of platformDirs) {
    const fullPlatformPath = path.join(releaseDir, platformDir);
    const items = fs.readdirSync(fullPlatformPath);
    
    for (const item of items) {
      if (item.endsWith('.app') && fs.statSync(path.join(fullPlatformPath, item)).isDirectory()) {
        appBundles.push({
          platform: platformDir,
          path: path.join(fullPlatformPath, item),
          name: item
        });
      }
    }
  }
  
  return appBundles;
}

function generateReport(results) {
  console.log('\n📊 [Sharp Test] === TEST REPORT ===');
  console.log(`📅 Generated: ${new Date().toISOString()}`);
  console.log(`🖥️ Platform: ${process.platform} ${process.arch}`);
  console.log(`📂 Working directory: ${process.cwd()}`);
  
  if (results.development !== null) {
    console.log(`📚 Development test: ${results.development ? '✅ PASSED' : '❌ FAILED'}`);
  }
  
  if (results.production.length > 0) {
    console.log(`📦 Production tests:`);
    for (const result of results.production) {
      console.log(`   ${result.success ? '✅' : '❌'} ${result.app.name} (${result.app.platform})`);
    }
  } else {
    console.log(`📦 Production tests: ⚠️ No app bundles found in release/`);
  }
  
  const allPassed = results.development && results.production.every(p => p.success);
  console.log(`\n🎯 [Sharp Test] Overall result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (!allPassed) {
    console.log('\n💡 [Sharp Test] Troubleshooting tips:');
    console.log('   - Run: npm run rebuild:sharp');
    console.log('   - Check: npm run build creates app.asar.unpacked correctly');
    console.log('   - Verify: afterPack hook is executing');
    console.log('   - Enable: FORCE_JIMP_FALLBACK=true as workaround');
  }
}

async function main() {
  const results = {
    development: null,
    production: []
  };
  
  // Test in sviluppo se non siamo in un bundle
  try {
    if (process.cwd().includes('.app/Contents')) {
      console.log('🔍 [Sharp Test] Running inside app bundle, skipping development test');
    } else {
      results.development = testSharpInDevelopment();
    }
  } catch (error) {
    console.warn('⚠️ [Sharp Test] Could not run development test:', error.message);
    results.development = false;
  }
  
  // Test sulle app rilasciate
  const appBundles = findAppBundles();
  console.log(`🔍 [Sharp Test] Found ${appBundles.length} app bundle(s)`);
  
  for (const appBundle of appBundles) {
    console.log(`\n🧪 [Sharp Test] Testing ${appBundle.name}...`);
    const success = testSharpInProduction(appBundle.path);
    results.production.push({
      app: appBundle,
      success: success
    });
  }
  
  generateReport(results);
}

// Esporta per uso programmatico
module.exports = {
  testSharpInDevelopment,
  testSharpInProduction,
  findAppBundles
};

// Esecuzione diretta
if (require.main === module) {
  main().catch(error => {
    console.error('💥 [Sharp Test] Fatal error:', error);
    process.exit(1);
  });
}