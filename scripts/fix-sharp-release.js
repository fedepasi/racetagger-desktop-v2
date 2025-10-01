const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Post-build script per correggere le dipendenze Sharp nell'app rilasciata
 * Questo script viene eseguito dopo il packaging di Electron per assicurare
 * che Sharp funzioni correttamente con tutte le sue dipendenze native.
 */

console.log('🔧 [Sharp Fix] Starting Sharp post-build fix...');

function findAppBundle(buildDir) {
  const items = fs.readdirSync(buildDir);
  for (const item of items) {
    if (item.endsWith('.app') && fs.statSync(path.join(buildDir, item)).isDirectory()) {
      return path.join(buildDir, item);
    }
  }
  return null;
}

function fixSharpDependencies(context) {
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

    console.log(`📁 [Sharp Fix] Found app at: ${appPath}`);

    // Percorsi critici
    const resourcesPath = path.join(appPath, 'Contents', 'Resources');
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
    const sharpPath = path.join(unpackedPath, 'node_modules', 'sharp');
    const imgPath = path.join(unpackedPath, 'node_modules', '@img');

    // Verifica che i percorsi esistano
    const criticalPaths = [resourcesPath, unpackedPath, sharpPath, imgPath];
    for (const criticalPath of criticalPaths) {
      if (!fs.existsSync(criticalPath)) {
        throw new Error(`Critical path missing: ${criticalPath}`);
      }
    }

    console.log('✅ [Sharp Fix] All critical paths exist');

    // Verifica Sharp binary
    const sharpBinaryPath = path.join(imgPath, 'sharp-darwin-arm64', 'lib', 'sharp-darwin-arm64.node');
    const libvipsPath = path.join(imgPath, 'sharp-libvips-darwin-arm64', 'lib', 'libvips-cpp.8.17.1.dylib');
    
    if (!fs.existsSync(sharpBinaryPath)) {
      throw new Error(`Sharp binary missing: ${sharpBinaryPath}`);
    }
    
    if (!fs.existsSync(libvipsPath)) {
      throw new Error(`libvips missing: ${libvipsPath}`);
    }

    console.log('✅ [Sharp Fix] Sharp binary and libvips found');

    // Crea il symlink sharp.node se non esiste (richiesto da alcune versioni)
    const symlinkPath = path.join(imgPath, 'sharp-darwin-arm64', 'sharp.node');
    if (!fs.existsSync(symlinkPath)) {
      try {
        fs.symlinkSync('./lib/sharp-darwin-arm64.node', symlinkPath);
        console.log('✅ [Sharp Fix] Created sharp.node symlink');
      } catch (symlinkError) {
        // Fallback: copia il file
        fs.copyFileSync(sharpBinaryPath, symlinkPath);
        console.log('✅ [Sharp Fix] Copied sharp.node (fallback)');
      }
    }

    // Verifica e correggi i permessi
    const executablePaths = [sharpBinaryPath, symlinkPath];
    for (const execPath of executablePaths) {
      if (fs.existsSync(execPath)) {
        try {
          fs.chmodSync(execPath, 0o755);
          console.log(`✅ [Sharp Fix] Set executable permissions on ${path.basename(execPath)}`);
        } catch (chmodError) {
          console.warn(`⚠️ [Sharp Fix] Could not set permissions on ${execPath}: ${chmodError.message}`);
        }
      }
    }

    // Verifica le dipendenze dinamiche con otool (se disponibile)
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

    // Crea un file di configurazione per il runtime
    const configPath = path.join(unpackedPath, 'sharp-config.json');
    const config = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      sharpBinary: path.relative(unpackedPath, sharpBinaryPath),
      libvips: path.relative(unpackedPath, libvipsPath),
      verified: true
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ [Sharp Fix] Created Sharp runtime configuration');

    // Test finale: prova a caricare Sharp
    try {
      // Salva il CWD originale
      const originalCwd = process.cwd();
      
      // Cambia temporaneamente directory per il test
      process.chdir(unpackedPath);
      
      // Pulisce la cache e prova a caricare Sharp
      const sharpModulePath = path.join(sharpPath, 'lib', 'index.js');
      delete require.cache[sharpModulePath];
      
      // Imposta le variabili d'ambiente
      process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
      process.env.SHARP_FORCE_GLOBAL_LIBVIPS = '0';
      
      const sharp = require(sharpPath);
      
      // Test minimo - solo check che Sharp si carichi
      if (sharp.format) {
        // Verifica che Sharp sia caricato correttamente
        console.log('✅ [Sharp Fix] Sharp formats available:', Object.keys(sharp.format));
      }
      
      // Ripristina CWD
      process.chdir(originalCwd);
      
      console.log('✅ [Sharp Fix] Sharp test successful!');
      
    } catch (testError) {
      console.warn(`⚠️ [Sharp Fix] Sharp test failed: ${testError.message}`);
      console.warn('⚠️ [Sharp Fix] App may fall back to Jimp at runtime');
    }

    console.log('🎉 [Sharp Fix] Sharp post-build fix completed successfully!');
    
  } catch (error) {
    console.error(`❌ [Sharp Fix] Failed to fix Sharp dependencies: ${error.message}`);
    console.error('❌ [Sharp Fix] Stack trace:', error.stack);
    
    // Non usciamo con errore per non bloccare il build
    // L'app userà il fallback a Jimp
    console.warn('⚠️ [Sharp Fix] Build will continue, but app may use Jimp fallback');
  }
}

// Export per electron-builder hook
exports.default = fixSharpDependencies;

// Esecuzione diretta
if (require.main === module) {
  fixSharpDependencies();
}