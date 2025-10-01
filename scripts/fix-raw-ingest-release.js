const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Post-build script per RAW-ingest nell'app rilasciata
 * Verifica che il modulo nativo sia correttamente incluso e funzionante
 */

console.log('🔧 [RAW-ingest Fix] Starting RAW-ingest post-build fix...');

function findAppBundle(buildDir) {
  const items = fs.readdirSync(buildDir);
  for (const item of items) {
    if (item.endsWith('.app') && fs.statSync(path.join(buildDir, item)).isDirectory()) {
      return path.join(buildDir, item);
    }
  }
  return null;
}

function fixRawIngestDependencies(context) {
  try {
    // Determina il percorso dell'app bundle
    let appPath;
    if (context && context.appOutDir) {
      // Chiamato da electron-builder
      const appName = context.packager.appInfo.productFilename + '.app';
      appPath = path.join(context.appOutDir, appName);
    } else {
      // Chiamato manualmente, cerca l'app nella directory release
      const releaseDir = path.join(process.cwd(), 'release');
      const platformDirs = fs.readdirSync(releaseDir).filter(d => 
        fs.statSync(path.join(releaseDir, d)).isDirectory()
      );
      
      for (const platformDir of platformDirs) {
        const fullPlatformPath = path.join(releaseDir, platformDir);
        const appBundle = findAppBundle(fullPlatformPath);
        if (appBundle) {
          appPath = appBundle;
          break;
        }
      }
    }

    if (!appPath || !fs.existsSync(appPath)) {
      throw new Error(`Cannot find app bundle. Searched in: ${appPath}`);
    }

    console.log(`📁 [RAW-ingest Fix] Found app at: ${appPath}`);

    // Percorsi critici
    const resourcesPath = path.join(appPath, 'Contents', 'Resources');
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
    const rawIngestPath = path.join(unpackedPath, 'node_modules', 'raw-preview-extractor');

    // Verifica che i percorsi esistano
    const criticalPaths = [resourcesPath, unpackedPath, rawIngestPath];
    for (const criticalPath of criticalPaths) {
      if (!fs.existsSync(criticalPath)) {
        throw new Error(`Critical path missing: ${criticalPath}`);
      }
    }

    console.log('✅ [RAW-ingest Fix] All critical paths exist');

    // Verifica i binary nativi
    const mainBinaryPath = path.join(rawIngestPath, 'raw-preview-extractor.node');
    const prebuildsPath = path.join(rawIngestPath, 'prebuilds');
    const arm64BinaryPath = path.join(prebuildsPath, 'darwin-arm64', 'raw-preview-extractor.node');
    const universalBinaryPath = path.join(prebuildsPath, 'darwin-universal', 'raw-preview-extractor.node');
    
    const binaryPaths = [mainBinaryPath];
    if (fs.existsSync(arm64BinaryPath)) binaryPaths.push(arm64BinaryPath);
    if (fs.existsSync(universalBinaryPath)) binaryPaths.push(universalBinaryPath);

    let foundValidBinary = false;
    for (const binaryPath of binaryPaths) {
      if (fs.existsSync(binaryPath)) {
        console.log(`📦 [RAW-ingest Fix] Found binary: ${path.relative(rawIngestPath, binaryPath)}`);
        
        // Verifica architettura
        try {
          const fileOutput = execSync(`file "${binaryPath}"`, { encoding: 'utf8' });
          console.log(`   Architecture info: ${fileOutput.trim()}`);
          
          // Verifica se è universal o ha l'architettura corretta
          if (fileOutput.includes('arm64') || fileOutput.includes('x86_64')) {
            foundValidBinary = true;
            
            // Imposta permessi eseguibili
            fs.chmodSync(binaryPath, 0o755);
            console.log(`✅ [RAW-ingest Fix] Set executable permissions on ${path.basename(binaryPath)}`);
          }
        } catch (fileError) {
          console.warn(`⚠️ [RAW-ingest Fix] Could not check architecture of ${binaryPath}: ${fileError.message}`);
        }
      }
    }
    
    if (!foundValidBinary) {
      throw new Error('No valid RAW-ingest binary found in bundle');
    }

    // Verifica package.json
    const packageJsonPath = path.join(rawIngestPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`RAW-ingest package.json missing: ${packageJsonPath}`);
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    console.log(`✅ [RAW-ingest Fix] Package info: ${packageJson.name}@${packageJson.version}`);

    // Crea file di configurazione runtime
    const configPath = path.join(unpackedPath, 'raw-ingest-config.json');
    const config = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      version: packageJson.version,
      binariesFound: binaryPaths.filter(p => fs.existsSync(p)).map(p => path.relative(rawIngestPath, p)),
      verified: true
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ [RAW-ingest Fix] Created RAW-ingest runtime configuration');

    // Test di caricamento (minimo)
    try {
      // Salva il CWD originale
      const originalCwd = process.cwd();
      
      // Cambia temporaneamente directory per il test
      process.chdir(unpackedPath);
      
      // Prova a fare require del modulo
      const rawIngestModulePath = path.join(rawIngestPath, 'dist', 'index.js');
      if (fs.existsSync(rawIngestModulePath)) {
        delete require.cache[rawIngestModulePath];
        const rawIngest = require(rawIngestModulePath);
        
        if (rawIngest && (rawIngest.extractMediumPreview || rawIngest.extractFullPreview)) {
          console.log('✅ [RAW-ingest Fix] Module structure verified');
        } else {
          console.warn('⚠️ [RAW-ingest Fix] Module loaded but missing expected functions');
        }
      } else {
        // Prova il percorso principale
        delete require.cache[rawIngestPath];
        const rawIngest = require(rawIngestPath);
        console.log('✅ [RAW-ingest Fix] Module loaded successfully');
      }
      
      // Ripristina CWD
      process.chdir(originalCwd);
      
    } catch (testError) {
      console.warn(`⚠️ [RAW-ingest Fix] Module load test failed: ${testError.message}`);
      console.warn('⚠️ [RAW-ingest Fix] App may fall back to dcraw at runtime');
    }

    console.log('🎉 [RAW-ingest Fix] RAW-ingest post-build fix completed successfully!');
    
  } catch (error) {
    console.error(`❌ [RAW-ingest Fix] Failed to fix RAW-ingest dependencies: ${error.message}`);
    console.error('❌ [RAW-ingest Fix] Stack trace:', error.stack);
    
    // Non usciamo con errore per non bloccare il build
    console.warn('⚠️ [RAW-ingest Fix] Build will continue, but app may use dcraw fallback');
  }
}

// Export per electron-builder hook
exports.default = fixRawIngestDependencies;

// Esecuzione diretta
if (require.main === module) {
  fixRawIngestDependencies();
}