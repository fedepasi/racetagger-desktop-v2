import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import { execFile } from 'child_process';
import * as piexif from 'piexifjs';
import { createImageProcessor } from './native-modules';
import { ResizePreset, RESIZE_PRESETS, ResizeConfig } from '../config';
import { CleanupManager } from './cleanup-manager';
import { nativeToolManager } from './native-tool-manager';
import { rawPreviewExtractor, NativePreviewOptions } from './raw-preview-native';

/**
 * Convertitore per l'estrazione di anteprime da file RAW
 * Utilizza un approccio a cascata:
 * 1. Prova con Sharp (più veloce, ma supporto limitato)
 * 2. Se fallisce, usa dcraw come fallback
 */
export class RawConverter {
  private tempDngDirectory: string;
  private cleanupManager: CleanupManager;

  constructor() {
    // Crea directory temporanea dedicata per i DNG nella home directory
    // Adobe DNG Converter ha problemi con /var/folders su macOS
    this.tempDngDirectory = path.join(os.homedir(), '.racetagger-temp', 'dng-processing');
    this.cleanupManager = new CleanupManager();
    this.ensureTempDirectory();
  }

  /**
   * Assicura che la directory temporanea per i DNG esista
   */
  private ensureTempDirectory(): void {
    try {
      if (!fs.existsSync(this.tempDngDirectory)) {
        fs.mkdirSync(this.tempDngDirectory, { recursive: true });
        console.log(`[RawConverter] Created temp DNG directory: ${this.tempDngDirectory}`);
      }
    } catch (error: any) {
      console.error('[RawConverter] Error creating temp directory:', error);
      // Fallback alla directory temporanea standard
      this.tempDngDirectory = os.tmpdir();
    }
  }

  /**
   * Ottiene la directory temporanea per i DNG
   */
  getTempDngDirectory(): string {
    return this.tempDngDirectory;
  }

  /**
   * Elimina un file DNG temporaneo
   */
  async cleanupTempDng(dngPath: string): Promise<void> {
    try {
      if (fs.existsSync(dngPath) && dngPath.startsWith(this.tempDngDirectory)) {
        await fsPromises.unlink(dngPath);
        console.log(`[RawConverter] Cleaned up temp DNG: ${path.basename(dngPath)}`);
      }
    } catch (error: any) {
      console.error(`[RawConverter] Error cleaning up temp DNG ${dngPath}:`, error.message);
    }
  }

  /**
   * Pulisce tutti i DNG temporanei più vecchi di N minuti
   */
  async cleanupOldTempDngs(olderThanMinutes: number = 60): Promise<void> {
    try {
      if (!fs.existsSync(this.tempDngDirectory)) return;

      const files = await fsPromises.readdir(this.tempDngDirectory);
      const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.dng')) continue;

        const filePath = path.join(this.tempDngDirectory, file);
        try {
          const stat = await fsPromises.stat(filePath);
          if (stat.mtime.getTime() < cutoffTime) {
            await fsPromises.unlink(filePath);
            cleaned++;
          }
        } catch (error) {
          // File potrebbe essere già stato eliminato
        }
      }

      if (cleaned > 0) {
        console.log(`[RawConverter] Cleaned up ${cleaned} old temp DNG files`);
      }
    } catch (error: any) {
      console.error('[RawConverter] Error during temp DNG cleanup:', error);
    }
  }

  /**
   * Rimuove TUTTI i file dalla directory temporanea dng-processing
   * Chiamato all'avvio e alla chiusura dell'applicazione
   */
  async cleanupAllTempFiles(): Promise<void> {
    try {
      if (!fs.existsSync(this.tempDngDirectory)) {
        console.log(`[RawConverter] Temp directory doesn't exist: ${this.tempDngDirectory}`);
        return;
      }

      const files = await fsPromises.readdir(this.tempDngDirectory);
      let cleaned = 0;

      console.log(`[RawConverter] Found ${files.length} files in temp directory: ${this.tempDngDirectory}`);

      for (const file of files) {
        const filePath = path.join(this.tempDngDirectory, file);
        try {
          const stat = await fsPromises.stat(filePath);
          
          // Rimuovi solo file, non directory
          if (stat.isFile()) {
            await fsPromises.unlink(filePath);
            cleaned++;
            console.log(`[RawConverter] Removed temp file: ${file}`);
          }
        } catch (error: any) {
          console.error(`[RawConverter] Error removing temp file ${file}:`, error.message);
        }
      }

      if (cleaned > 0) {
        console.log(`[RawConverter] ✅ Cleaned up ${cleaned} temp files from dng-processing directory`);
      } else {
        console.log(`[RawConverter] No temp files to clean up in dng-processing directory`);
      }
    } catch (error: any) {
      console.error('[RawConverter] Error during complete temp files cleanup:', error);
    }
  }

  /**
   * Sanitizes file paths to prevent path traversal attacks
   * @private
   */
  private sanitizePath(filePath: string): string {
    // Resolve to absolute path to prevent directory traversal
    const resolved = path.resolve(filePath);
    
    // Additional validation: ensure the path doesn't contain dangerous patterns
    if (resolved.includes('..') || resolved.includes('~')) {
      throw new Error(`Invalid file path detected: ${filePath}`);
    }
    
    return resolved;
  }

  /**
   * Validates that a file path exists and is accessible
   * @private
   */
  private async validateFilePath(filePath: string): Promise<void> {
    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(`File not accessible: ${filePath}`);
    }
  }
  /**
   * Verifica se Adobe DNG Converter è installato nel sistema
   * @public
   */
  public async isDngConverterInstalled(): Promise<boolean> {
    // Percorsi comuni dove trovare DNG Converter
    const possiblePaths = {
      darwin: [
        '/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter',
        '/Applications/Adobe/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter'
      ],
      win32: [
        'C:\\Program Files\\Adobe\\Adobe DNG Converter\\Adobe DNG Converter.exe',
        'C:\\Program Files (x86)\\Adobe\\Adobe DNG Converter\\Adobe DNG Converter.exe'
      ],
      linux: [
        '/usr/bin/adobe-dng-converter',
        '/usr/local/bin/adobe-dng-converter'
      ]
    };
    
    const paths = possiblePaths[process.platform as keyof typeof possiblePaths] || [];
    
    for (const path of paths) {
      try {
        await fsPromises.access(path, fs.constants.X_OK);
        return true;
      } catch {
        // Path non accessibile, continua con il prossimo
      }
    }
    
    return false;
  }

  /**
   * Percorso dell'eseguibile di Adobe DNG Converter
   * @private
   */
  private getDngConverterPath(): string {
    if (process.platform === 'darwin') {
      return '/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter';
    } else if (process.platform === 'win32') {
      return 'C:\\Program Files\\Adobe\\Adobe DNG Converter\\Adobe DNG Converter.exe';
    } else {
      return 'adobe-dng-converter'; // assumiamo sia nel PATH su Linux
    }
  }

  /**
   * Converte un file RAW in DNG con Adobe DNG Converter
   * @param rawFilePath Percorso al file RAW
   * @param outputDngPath Percorso dove salvare il DNG (se omesso, usa lo stesso nome del RAW ma con estensione .dng)
   * @returns Promise con il percorso al file DNG generato
   * @public
   */
  /**
   * Converte un file RAW in DNG con Adobe DNG Converter
   * @param rawFilePath Percorso al file RAW
   * @param outputDngPath Percorso dove salvare il DNG (se omesso, usa lo stesso nome del RAW ma con estensione .dng)
   * @param useLossyCompression Se true, abilita la compressione con perdita (default: false)
   * @param lossyQuality Livello di qualità per la compressione lossy (1-100, default: 50)
   * @returns Promise con il percorso al file DNG generato
   * @public
   */
  async convertRawToDng(rawFilePath: string, outputDngPath?: string, useLossyCompression: boolean = false, lossyQuality: number = 50): Promise<string> {
    const sanitizedRawPath = this.sanitizePath(rawFilePath);
    await this.validateFilePath(sanitizedRawPath);

    // Se non è specificato un percorso di output, crea uno nella directory temporanea
    if (!outputDngPath) {
      const baseFilename = path.basename(sanitizedRawPath, path.extname(sanitizedRawPath));
      outputDngPath = path.join(this.tempDngDirectory, `${baseFilename}.dng`);
    }

    const sanitizedOutputPath = this.sanitizePath(outputDngPath);

    console.log(`╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║              RAW TO DNG CONVERSION                       ║`);
    console.log(`║     Input: ${path.basename(sanitizedRawPath).padEnd(42)} ║`);
    console.log(`║     Output: ${path.basename(sanitizedOutputPath).padEnd(41)} ║`);
    console.log(`║     Lossy: ${(useLossyCompression ? 'YES' : 'NO').padEnd(42)} ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝`);

    // Prima verifica se Adobe DNG Converter è disponibile
    if (await this.isDngConverterInstalled()) {
      try {
        console.log(`[RawConverter] Using Adobe DNG Converter for: ${path.basename(sanitizedRawPath)}`);
        await this._convertRawToDngInternal(sanitizedRawPath, sanitizedOutputPath, useLossyCompression);
        
        // Verifica che il file DNG sia stato creato correttamente
        if (fs.existsSync(sanitizedOutputPath)) {
          console.log(`[RawConverter] Adobe DNG conversion successful: ${sanitizedOutputPath}`);
          return sanitizedOutputPath;
        }
      } catch (adobeError: any) {
        console.log(`[RawConverter] Adobe DNG Converter failed: ${adobeError.message}`);
        console.log(`[RawConverter] Falling back to direct RAW processing with dcraw`);
      }
    } else {
      console.log(`[RawConverter] Adobe DNG Converter not available, using direct RAW processing`);
    }

    // Fallback: return original RAW path per dcraw diretto
    console.log(`[RawConverter] RAW file ready for direct dcraw processing: ${sanitizedRawPath}`);
    return sanitizedRawPath;
  }

  /**
   * Converte un file DNG in JPEG utilizzando dcraw e ImageMagick
   * @param dngFilePath Percorso al file DNG
   * @param outputJpegPath Percorso dove salvare il JPEG (se omesso, usa lo stesso nome del DNG ma con estensione .jpg)
   * @param jpegQuality Qualità JPEG (1-100, default: 90)
   * @param maxSize Dimensione massima del lato lungo dell'immagine (default: 2000px)
   * @returns Promise con il percorso al file JPEG generato
   * @public
   */
  /**
   * Converte un file DNG in JPEG utilizzando dcraw e ImageMagick
   * Questo metodo elabora l'intero file RAW/DNG e NON estrae semplicemente l'anteprima incorporata
   * @param dngFilePath Percorso al file DNG
   * @param outputJpegPath Percorso dove salvare il JPEG (se omesso, usa lo stesso nome del DNG ma con estensione .jpg)
   * @param jpegQuality Qualità JPEG (1-100, default: 95)
   * @param maxSize Dimensione massima del lato lungo dell'immagine in pixel (default: 1440, 0 = nessun limite)
   * @returns Promise con il percorso al file JPEG generato
   * @public
   */
  async convertDngToJpegOptimized(dngFilePath: string, outputJpegPath?: string, jpegQuality: number = 95, maxSize: number = 1440): Promise<string> {
    // Se non è specificato un percorso di output, crea uno nella stessa directory del file DNG
    if (!outputJpegPath) {
      const baseFilename = path.basename(dngFilePath, path.extname(dngFilePath));
      outputJpegPath = path.join(path.dirname(dngFilePath), `${baseFilename}-prev.jpg`);
    }
    
    console.log(`[PRIMARY] Converting DNG to JPEG (optimized): ${dngFilePath} -> ${outputJpegPath}`);
    
    // Verifica che il file DNG esista
    if (!fs.existsSync(dngFilePath)) {
      throw new Error(`Input DNG file does not exist: ${dngFilePath}`);
    }
    
    try {
      // Crea una cartella temporanea per i file intermedi
      const tempDir = require('os').tmpdir();
      const tempId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
      const tempPpmPath = path.join(tempDir, `racetagger_${tempId}.ppm`);
      
      console.log(`Starting dcraw+ImageMagick conversion process...`);
      console.log(`Using temp PPM file: ${tempPpmPath}`);
      
      // Fase 1: Usa dcraw per estrarre i dati RAW in formato PPM
      await new Promise<void>((resolve, reject) => {
        console.log(`Executing dcraw to extract RAW data...`);
        
        // Determina il percorso di dcraw - prima cerca in vendor, poi nel sistema
        let dcrawPath: string;
        const { app } = require('electron');
        const isPackaged = app?.isPackaged || false;
        
        if (process.platform === 'darwin') {
          const vendorDcrawPath = isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'darwin', 'dcraw')
            : path.join(process.cwd(), 'vendor', 'darwin', 'dcraw');
          
          dcrawPath = fs.existsSync(vendorDcrawPath) ? vendorDcrawPath : '/opt/homebrew/bin/dcraw';
        } else if (process.platform === 'win32') {
          const vendorDcrawPath = isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'win32', 'dcraw.exe')
            : path.join(process.cwd(), 'vendor', 'win32', 'dcraw.exe');
          
          console.log(`[DCRAW-WIN32] isPackaged: ${isPackaged}`);
          console.log(`[DCRAW-WIN32] process.resourcesPath: ${process.resourcesPath}`);
          console.log(`[DCRAW-WIN32] process.cwd(): ${process.cwd()}`);
          console.log(`[DCRAW-WIN32] vendorDcrawPath: ${vendorDcrawPath}`);
          console.log(`[DCRAW-WIN32] vendorDcrawPath exists: ${fs.existsSync(vendorDcrawPath)}`);
          
          // Check if file is actually executable
          if (fs.existsSync(vendorDcrawPath)) {
            try {
              const stats = fs.statSync(vendorDcrawPath);
              console.log(`[DCRAW-WIN32] dcraw.exe file size: ${stats.size} bytes`);
              console.log(`[DCRAW-WIN32] dcraw.exe is file: ${stats.isFile()}`);
            } catch (e) {
              console.error(`[DCRAW-WIN32] Error checking dcraw.exe stats:`, e);
            }
          }
          
          dcrawPath = fs.existsSync(vendorDcrawPath) ? vendorDcrawPath : 'dcraw.exe';
          console.log(`[DCRAW-WIN32] Final dcrawPath: ${dcrawPath}`);
        } else {
          const vendorDcrawPath = isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'linux', 'dcraw')
            : path.join(process.cwd(), 'vendor', 'linux', 'dcraw');
          
          dcrawPath = fs.existsSync(vendorDcrawPath) ? vendorDcrawPath : '/usr/bin/dcraw';
        }

        console.log(`Using dcraw at path: ${dcrawPath}`);
        
        // Additional Windows debugging and testing
        if (process.platform === 'win32') {
          console.log(`[DCRAW-WIN32-EXEC] About to execute dcraw`);
          console.log(`[DCRAW-WIN32-EXEC] Command: ${dcrawPath}`);
          console.log(`[DCRAW-WIN32-EXEC] Arguments: ['-c', '-w', '-q', '3', '-f', '-o', '1', '${dngFilePath}']`);
          console.log(`[DCRAW-WIN32-EXEC] Input file exists: ${fs.existsSync(dngFilePath)}`);
          console.log(`[DCRAW-WIN32-EXEC] Input file size: ${fs.existsSync(dngFilePath) ? fs.statSync(dngFilePath).size : 'N/A'} bytes`);
          
          // Test dcraw version first to verify it's working
          console.log(`[DCRAW-WIN32-EXEC] Testing dcraw version first...`);
          try {
            execFile(dcrawPath, ['-v'], { timeout: 5000 }, (versionError, versionStdout, versionStderr) => {
              console.log(`[DCRAW-WIN32-EXEC] Version test - error:`, versionError);
              console.log(`[DCRAW-WIN32-EXEC] Version test - stdout:`, versionStdout);
              console.log(`[DCRAW-WIN32-EXEC] Version test - stderr:`, versionStderr);
            });
          } catch (testError) {
            console.error(`[DCRAW-WIN32-EXEC] Failed to test dcraw version:`, testError);
          }
        }
        
        execFile(dcrawPath, [
          '-c',                // Output su stdout
          '-w',                // Usa bilanciamento bianco della camera
          '-q', '3',           // Usa alta qualità di interpolazione (3 = alto, 0-3)
          '-f',                // Usa bilanciamento bianco veloce
          '-o', '1',           // Output in spazio colore sRGB
          // Note: dcraw applica automaticamente la rotazione EXIF (non usiamo -t 0)
          dngFilePath          // File di input
        ], {
          maxBuffer: 100 * 1024 * 1024, // Buffer aumentato per gestire immagini grandi
          encoding: 'binary',
          timeout: 30000,      // CRITICAL FIX: 30s timeout to prevent hanging on Windows
          killSignal: 'SIGKILL' // Force kill on timeout
        }, (error, stdout, stderr) => {
          if (error) {
            // Check if error was caused by timeout
            if (error.killed && error.signal === 'SIGKILL') {
              console.error(`[DCRAW] Process timeout after 30s - file may be corrupted or unsupported: ${dngFilePath}`);
              reject(new Error(`dcraw timeout - file might be corrupted or unsupported format`));
              return;
            }
            console.error(`dcraw error:`, error);
            console.error(`dcraw stderr:`, stderr);
            if (process.platform === 'win32') {
              console.error(`[DCRAW-WIN32-EXEC] Error code: ${error.code}`);
              console.error(`[DCRAW-WIN32-EXEC] Error signal: ${error.signal}`);
              console.error(`[DCRAW-WIN32-EXEC] Error killed: ${error.killed}`);
              console.error(`[DCRAW-WIN32-EXEC] Full error object:`, JSON.stringify(error, null, 2));
            }
            reject(new Error(`dcraw extraction failed: ${error.message}`));
            return;
          }
          
          // Scrivi l'output del dcraw nel file temporaneo PPM
          console.log(`Writing dcraw output to temp PPM file...`);
          fs.writeFile(tempPpmPath, stdout, 'binary', (err) => {
            if (err) {
              reject(new Error(`Error writing temp PPM file: ${err.message}`));
            } else {
              console.log(`dcraw output successfully written to ${tempPpmPath}`);
              resolve();
            }
          });
        });
      });
      
      // Fase 2: Converti il PPM in JPEG ottimizzato con ImageMagick
      await new Promise<void>((resolve, reject) => {
        console.log(`Converting PPM to optimized JPEG with ImageMagick...`);
        
        // Prepara le opzioni di conversione
        const convertArgs = [tempPpmPath]; // File di input PPM
        
        // Aggiungi ridimensionamento se è specificata una dimensione massima
        if (maxSize > 0) {
          convertArgs.push('-resize', `${maxSize}x${maxSize}>`); // > significa "solo se più grande"
          console.log(`Resizing to max dimension ${maxSize}px`);
        } else {
          console.log(`Preserving full resolution (no resizing)`);
        }
        
        // Aggiungi le altre opzioni standard
        convertArgs.push(
          '-quality', jpegQuality.toString(), // Imposta la qualità JPEG
          '-strip',                           // Rimuovi metadata non essenziali
          outputJpegPath                      // File di output JPEG
        );
        
        // Imposta il percorso completo per il comando 'convert' di ImageMagick
        const convertPath = process.platform === 'darwin' 
          ? '/opt/homebrew/bin/convert'   // macOS con Homebrew
          : process.platform === 'win32'
            ? 'magick convert'            // Windows (using "magick convert" su Windows più recenti)
            : '/usr/bin/convert';         // Linux/Unix

        console.log(`Using ImageMagick convert at path: ${convertPath}`);

        execFile(convertPath, convertArgs, {
          timeout: 30000,      // CRITICAL FIX: 30s timeout for ImageMagick
          killSignal: 'SIGKILL',
          maxBuffer: 50 * 1024 * 1024
        }, (error, stdout, stderr) => {
          // Rimuovi sempre il file temporaneo PPM
          try {
            if (fs.existsSync(tempPpmPath)) {
              fs.unlinkSync(tempPpmPath);
              console.log(`Temporary PPM file removed`);
            }
          } catch (cleanupError: any) {
            console.warn(`Failed to clean up temp file: ${cleanupError.message || 'Unknown error'}`);
          }

          if (error) {
            // Check for timeout
            if (error.killed && error.signal === 'SIGKILL') {
              console.error(`[ImageMagick] Process timeout after 30s`);
              reject(new Error('ImageMagick conversion timeout'));
              return;
            }
            console.error(`ImageMagick error:`, error);
            console.error(`ImageMagick stderr:`, stderr);
            reject(new Error(`ImageMagick conversion failed: ${error.message}`));
            return;
          }
          
          console.log(`ImageMagick successfully converted PPM to JPEG: ${outputJpegPath}`);
          resolve();
        });
      });
      
      // Verifica che il file JPEG sia stato creato
      if (!fs.existsSync(outputJpegPath)) {
        throw new Error(`JPEG output file was not created: ${outputJpegPath}`);
      }
      
      console.log(`DNG to JPEG optimized conversion completed: ${outputJpegPath}`);
      return outputJpegPath;
    } catch (error: any) {
      console.error(`Error in optimized DNG to JPEG conversion:`, error);
      throw new Error(`DNG to JPEG optimized conversion failed: ${error.message}`);
    }
  }

  /**
   * Converte un file DNG in JPEG usando Sharp
   * @param dngFilePath Percorso al file DNG
   * @param outputJpegPath Percorso dove salvare il JPEG (se omesso, usa lo stesso nome del DNG ma con estensione .jpg)
   * @param jpegQuality Qualità JPEG (1-100, default: 90)
   * @returns Promise con il percorso al file JPEG generato
   * @public
   */
  async convertDngToJpeg(dngFilePath: string, outputJpegPath?: string, jpegQuality: number = 90): Promise<string> {
    // Se non è specificato un percorso di output, crea uno nella stessa directory del file DNG
    if (!outputJpegPath) {
      const baseFilename = path.basename(dngFilePath, path.extname(dngFilePath));
      outputJpegPath = path.join(path.dirname(dngFilePath), `${baseFilename}-prev.jpg`);
    }
    
    console.log(`[PRIMARY] Converting DNG to JPEG: ${dngFilePath} -> ${outputJpegPath}`);
    
    
    // Verifica che il file DNG esista
    if (!fs.existsSync(dngFilePath)) {
      throw new Error(`Input DNG file does not exist: ${dngFilePath}`);
    }
    
    try {
      console.log(`Starting Sharp conversion from DNG to JPEG...`);
      
      // Verifico la dimensione del file DNG di input
      const inputStats = fs.statSync(dngFilePath);
      console.log(`Input DNG file size: ${inputStats.size} bytes (${(inputStats.size / (1024 * 1024)).toFixed(2)} MB)`);
      
      // Usa il sistema ibrido per convertire DNG a JPEG
      const processor = await createImageProcessor(dngFilePath);
      const buffer = await processor
        .jpeg({ 
          quality: jpegQuality,
          progressive: true
        })
        .toBuffer();
      
      // Scrivi il buffer nel file di output
      await fsPromises.writeFile(outputJpegPath, buffer);
      
      console.log(`Sharp JPEG conversion completed: ${outputJpegPath}`);
      return outputJpegPath;
    } catch (sharpError: any) {
      console.error(`Sharp conversion error details:`, sharpError);
      throw new Error(`DNG to JPEG conversion failed: ${sharpError.message}`);
    }
  }

  /**
   * Estrae thumbnail da file RAW usando LibRaw o dcraw
   * Utilizza simple_dcraw (-e) per estrazione diretta thumbnail, 
   * fallback a dcraw_emu/dcraw per conversione completa se necessario
   * @param rawFilePath Percorso al file RAW
   * @param outputPath Percorso dove salvare il thumbnail (se omesso, usa la stessa directory del RAW)
   * @returns Promise con il percorso al file thumbnail estratto
   * @public
   */
  /**
   * Estrae thumbnail da file RAW con strategia ottimizzata:
   * 1. Prova con libreria nativa veloce (se disponibile)
   * 2. Fallback al metodo tradizionale dcraw
   * 
   * @param rawFilePath Percorso al file RAW
   * @param outputPath Percorso dove salvare il thumbnail (opzionale)
   * @returns Promise con il percorso al file thumbnail estratto
   */
  async extractThumbnailFromRaw(rawFilePath: string, outputPath?: string): Promise<string> {
    const sanitizedRawPath = this.sanitizePath(rawFilePath);
    
    // Se non è specificato un percorso di output, crea uno nella stessa directory del file RAW
    if (!outputPath) {
      const baseFilename = path.basename(sanitizedRawPath, path.extname(sanitizedRawPath));
      outputPath = path.join(path.dirname(sanitizedRawPath), `${baseFilename}_thumb.jpg`);
    }

    const sanitizedOutputPath = this.sanitizePath(outputPath);
    
    console.log(`╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║                  THUMBNAIL EXTRACTION                    ║`);
    console.log(`║     Input: ${path.basename(sanitizedRawPath).padEnd(42)} ║`);
    console.log(`║     Output: ${path.basename(sanitizedOutputPath).padEnd(41)} ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝`);
    
    // FLAG di controllo per abilitare/disabilitare libreria nativa
    const useNativePreview = process.env.USE_NATIVE_PREVIEW !== 'false'; // Default: true
    
    try {
      // STRATEGIA 1: Libreria nativa veloce (priorità massima se disponibile)
      if (useNativePreview && rawPreviewExtractor.isSupportedFormat(sanitizedRawPath)) {
        try {
          console.log(`[RawConverter] 🚀 Attempting native preview extraction...`);
          const result = await this.extractThumbnailWithNativeLibrary(sanitizedRawPath, sanitizedOutputPath);
          if (result) {
            console.log(`[RawConverter] ✅ Native extraction successful: ${path.basename(result)}`);
            return result;
          }
        } catch (nativeError: any) {
          console.log(`[RawConverter] ⚠️ Native extraction failed: ${nativeError.message}`);
          console.log(`[RawConverter] 🔄 Falling back to traditional dcraw methods...`);
        }
      } else if (!useNativePreview) {
        console.log(`[RawConverter] 🚫 Native preview disabled via USE_NATIVE_PREVIEW=false`);
      }
      
      // STRATEGIA 2: Metodi tradizionali (dcraw, Adobe DNG)
      return await this.extractThumbnailWithTraditionalMethods(sanitizedRawPath, sanitizedOutputPath);
      
    } catch (error: any) {
      console.error(`[RawConverter] All thumbnail extraction methods failed: ${error.message}`);
      throw new Error(`Thumbnail extraction failed: ${error.message}`);
    }
  }

  /**
   * Estrae thumbnail usando la libreria nativa veloce
   * @private
   */
  private async extractThumbnailWithNativeLibrary(rawFilePath: string, outputPath: string): Promise<string | null> {
    try {
      const options: NativePreviewOptions = {
        targetMinSize: 50 * 1024,      // 50KB min per thumbnails
        targetMaxSize: 2 * 1024 * 1024, // 2MB max per thumbnails
        timeout: 5000,                  // 5 secondi timeout
        preferQuality: 'preview',       // Preferisci preview di qualità media
        useNativeLibrary: true
      };

      const result = await rawPreviewExtractor.extractPreview(rawFilePath, options);
      
      if (result.success && result.data) {
        // Scrivi i dati estratti nel file di output
        await fsPromises.writeFile(outputPath, result.data);
        
        console.log(`[RawConverter] 📊 Native extraction stats:`);
        console.log(`  - Method: ${result.method}`);
        console.log(`  - Time: ${result.extractionTimeMs}ms`);
        console.log(`  - Size: ${result.data.length} bytes`);
        if (result.width && result.height) {
          console.log(`  - Dimensions: ${result.width}×${result.height}`);
        }
        
        return outputPath;
      }
      
      console.log(`[RawConverter] Native extraction failed: ${result.error}`);
      return null;
      
    } catch (error: any) {
      console.log(`[RawConverter] Native library error: ${error.message}`);
      return null;
    }
  }

  /**
   * Estrae thumbnail usando i metodi tradizionali (dcraw, Adobe DNG)
   * @public - Usato anche da RawPreviewExtractor per prevenire loop ricorsivo
   */
  public async extractThumbnailWithTraditionalMethods(rawFilePath: string, outputPath: string): Promise<string> {
    // Check if we should force Adobe DNG fallback for testing
    if (process.env.FORCE_ADOBE_DNG_FALLBACK === 'true') {
      console.log(`[RawConverter] 🧪 FORCE_ADOBE_DNG_FALLBACK enabled - skipping dcraw methods`);
      if (await this.isDngConverterInstalled()) {
        console.log(`[RawConverter] 🧪 Forcing Adobe DNG Converter for testing: ${path.basename(rawFilePath)}`);
        return await this.extractThumbnailViaAdobeDngFallback(rawFilePath, outputPath);
      } else {
        throw new Error('Adobe DNG Converter not available (forced fallback mode)');
      }
    }
    
    // CRITICAL FIX: Detect CR3 files and use direct conversion instead of thumbnail extraction
    const fileExtension = path.extname(rawFilePath).toLowerCase();
    const isCR3 = fileExtension === '.cr3';
      
      if (isCR3) {
        console.log(`[RawConverter] CR3 file detected - using half-size conversion instead of thumbnail extraction`);
        // For CR3 files, use half-size direct conversion to avoid massive thumbnail sizes
        return await this.convertCR3ToThumbnail(rawFilePath, outputPath);
      }
      
      // Ottieni tutti i convertitori disponibili
      const converters = await this.getAllDcrawExecutables();
      
      // Strategia 1: Prova prima dcraw classico con -e per estrazione diretta thumbnail (NON-CR3)
      if (converters.dcraw) {
        try {
          console.log(`[RawConverter] Attempting direct thumbnail extraction with dcraw -e`);
          return await this.extractThumbnailWithDcraw(rawFilePath, outputPath, converters.dcraw);
        } catch (dcrawError: any) {
          console.log(`[RawConverter] dcraw -e failed: ${dcrawError.message}. Trying dcraw_emu...`);
        }
      }
      
      // Strategia 2: Usa dcraw_emu con half-size per camere moderne
      if (converters.dcrawEmu) {
        console.log(`[RawConverter] Using dcraw_emu for modern camera support`);
        return await this.extractThumbnailWithDcrawEmu(rawFilePath, outputPath, converters.dcrawEmu);
      }
      
      // Final fallback: Adobe DNG Converter if available
      if (await this.isDngConverterInstalled()) {
        console.log(`[RawConverter] All dcraw methods failed, attempting Adobe DNG Converter fallback`);
        return await this.extractThumbnailViaAdobeDngFallback(rawFilePath, outputPath);
      }
      
      throw new Error('No suitable RAW converter available for thumbnail extraction');
  }

  /**
   * Estrae thumbnail via Adobe DNG Converter come fallback finale
   * Pipeline: RAW → Adobe DNG → dcraw → JPEG
   * @private
   */
  private async extractThumbnailViaAdobeDngFallback(rawFilePath: string, outputPath: string): Promise<string> {
    console.log(`[RawConverter] ╔════════════════════════════════════════╗`);
    console.log(`[RawConverter] ║       ADOBE DNG FALLBACK PIPELINE     ║`);
    console.log(`[RawConverter] ║  File: ${path.basename(rawFilePath).padEnd(30)} ║`);
    console.log(`[RawConverter] ╚════════════════════════════════════════╝`);

    const tempFileId = `adobe_fallback_${Date.now()}`;
    let tempDngPath = '';

    try {
      // Step 1: Convert RAW to DNG using Adobe DNG Converter
      console.log(`[RawConverter] Step 1: Converting RAW to DNG with Adobe DNG Converter`);
      const baseFilename = path.basename(rawFilePath, path.extname(rawFilePath));
      tempDngPath = path.join(this.tempDngDirectory, `${baseFilename}_${tempFileId}.dng`);
      
      await this._convertRawToDngInternal(rawFilePath, tempDngPath, false);
      
      // Step 2: Extract thumbnail from DNG using dcraw
      console.log(`[RawConverter] Step 2: Extracting thumbnail from DNG using dcraw`);
      const dcrawPath = await this.getDcrawPath();
      if (!dcrawPath) {
        throw new Error('dcraw not found for DNG thumbnail extraction');
      }

      // Use dcraw to extract thumbnail from DNG file
      const result = await this.extractThumbnailWithDcraw(tempDngPath, outputPath, dcrawPath);
      
      console.log(`[RawConverter] ✅ Adobe DNG fallback successful: ${outputPath}`);
      return result;

    } catch (error: any) {
      console.error(`[RawConverter] Adobe DNG fallback failed: ${error.message}`);
      throw new Error(`Adobe DNG fallback failed: ${error.message}`);
      
    } finally {
      // Cleanup: always remove temporary DNG file
      if (tempDngPath && fs.existsSync(tempDngPath)) {
        try {
          await fsPromises.unlink(tempDngPath);
          console.log(`[RawConverter] Cleaned up temp DNG: ${path.basename(tempDngPath)}`);
        } catch (cleanupError) {
          console.log(`[RawConverter] Warning: Could not cleanup temp DNG: ${cleanupError}`);
        }
      }
    }
  }

  /**
   * Converte file CR3 a thumbnail con pipeline ottimizzata LibRaw + fallback dcraw
   * Priorità: LibRaw (dcraw_emu) → dcraw classico → errore
   * @private
   */
  private async convertCR3ToThumbnail(rawFilePath: string, outputPath: string): Promise<string> {
    console.log(`[RawConverter] ╔════════════════════════════════════════╗`);
    console.log(`[RawConverter] ║       CR3 CONVERSION PIPELINE         ║`);
    console.log(`[RawConverter] ║  File: ${path.basename(rawFilePath).padEnd(30)} ║`);
    console.log(`[RawConverter] ╚════════════════════════════════════════╝`);

    // Strategy 1: Try LibRaw (dcraw_emu) first - optimal for CR3
    try {
      console.log(`[RawConverter] 🔄 Strategy 1: LibRaw (dcraw_emu) pipeline`);
      const result = await this.convertCR3WithLibRaw(rawFilePath, outputPath, {
        quality: 85,
        halfSize: true
      });
      console.log(`[RawConverter] ✅ LibRaw conversion successful!`);
      return result;
      
    } catch (librawError: any) {
      console.log(`[RawConverter] ❌ LibRaw failed: ${librawError.message}`);
      console.log(`[RawConverter] 🔄 Strategy 2: Fallback to dcraw classical pipeline`);
      
      // Strategy 2: Fallback to dcraw (original method)
      try {
        const dcrawPath = await this.getDcrawPath();
        if (!dcrawPath) {
          throw new Error('dcraw not found for CR3 fallback conversion');
        }

        // Use CleanupManager for temp files even in fallback
        const tempPpmPath = this.cleanupManager.generateTempPath(rawFilePath, 'cr3_fallback', '.ppm');
        const tempFileId = await this.cleanupManager.trackTempFile(tempPpmPath, 'other');

        try {
          await new Promise<void>((resolve, reject) => {
            execFile(dcrawPath, [
              '-c',          // Output to stdout
              '-h',          // Half-size (much faster and smaller)
              '-q', '1',     // Quality 1 (faster than 3)
              '-w',          // Use camera white balance
              '-H', '2',     // Highlight mode
              rawFilePath
            ], {
              maxBuffer: 50 * 1024 * 1024,  // 50MB buffer for CR3 conversion
              timeout: 30000,      // CRITICAL FIX: 30s timeout
              killSignal: 'SIGKILL'
            }, async (error, stdout, stderr) => {
              if (error) {
                if (error.killed && error.signal === 'SIGKILL') {
                  console.error(`[RawConverter] CR3 dcraw timeout after 30s`);
                  reject(new Error('CR3 dcraw timeout'));
                  return;
                }
                console.error(`[RawConverter] CR3 dcraw fallback error:`, error);
                console.error(`[RawConverter] CR3 dcraw stderr:`, stderr);
                reject(new Error(`CR3 dcraw fallback failed: ${error.message}`));
                return;
              }

              try {
                // Write PPM data to temporary file in /tmp
                await fsPromises.writeFile(tempPpmPath, stdout);
                
                // Convert PPM to JPEG using Sharp
                const processor = await createImageProcessor(await fsPromises.readFile(tempPpmPath));
                const jpegBuffer = await processor
                  .jpeg({ quality: 85 })
                  .toBuffer();
                
                await fsPromises.writeFile(outputPath, jpegBuffer);
                
                console.log(`[RawConverter] ✅ dcraw fallback conversion completed: ${outputPath}`);
                resolve();

              } catch (conversionError: any) {
                reject(new Error(`CR3 PPM to JPEG conversion failed: ${conversionError.message}`));
              }
            });
          });

          return outputPath;

        } finally {
          // Always cleanup temp files
          await this.cleanupManager.cleanupFile(tempFileId);
        }

      } catch (dcrawError: any) {
        console.error(`[RawConverter] ❌ Both LibRaw and dcraw failed for CR3 conversion`);
        console.error(`[RawConverter] LibRaw error: ${librawError.message}`);
        console.error(`[RawConverter] dcraw error: ${dcrawError.message}`);
        
        throw new Error(
          `CR3 conversion completely failed. ` +
          `LibRaw: ${librawError.message}. ` +
          `dcraw fallback: ${dcrawError.message}`
        );
      }
    }
  }

  /**
   * Converte file CR3 usando LibRaw (dcraw_emu) con pipeline ottimizzata
   * CR3 → PPM (dcraw_emu) → JPEG (ImageMagick/Sharp) con gestione /tmp
   * @private
   */
  private async convertCR3WithLibRaw(
    rawFilePath: string, 
    outputPath: string, 
    options: { quality?: number; halfSize?: boolean } = {}
  ): Promise<string> {
    const { quality = 85, halfSize = true } = options;
    
    console.log(`[RawConverter] Converting CR3 with LibRaw pipeline: ${path.basename(rawFilePath)}`);
    
    // Get dcraw_emu path from existing method
    const converters = await this.getAllDcrawExecutables();
    const dcrawEmuPath = converters.dcrawEmu;
    
    if (!dcrawEmuPath) {
      throw new Error('dcraw_emu (LibRaw) not found for CR3 conversion');
    }
    
    // Generate temp paths using CleanupManager
    const tempPpmPath = this.cleanupManager.generateTempPath(rawFilePath, 'cr3_convert', '.ppm');
    const tempFileId = await this.cleanupManager.trackTempFile(tempPpmPath, 'other');
    
    try {
      console.log(`[RawConverter] Using dcraw_emu: ${dcrawEmuPath}`);
      console.log(`[RawConverter] Temp PPM: ${tempPpmPath}`);
      
      // Step 1: CR3 → PPM using dcraw_emu
      await new Promise<void>((resolve, reject) => {
        const dcrawEmuArgs = [
          '-w',           // Use camera white balance
          '-T',           // Output TIFF (but we'll get PPM with stdout redirect)
          // Note: dcraw_emu (LibRaw) applica automaticamente la rotazione EXIF
          rawFilePath
        ];
        
        // Add half-size option if requested
        if (halfSize) {
          dcrawEmuArgs.splice(-1, 0, '-h');  // Insert before filename
        }
        
        console.log(`[RawConverter] dcraw_emu command: ${dcrawEmuPath} ${dcrawEmuArgs.join(' ')}`);

        execFile(dcrawEmuPath, dcrawEmuArgs, {
          maxBuffer: 100 * 1024 * 1024, // 100MB buffer for CR3
          timeout: 30000,      // CRITICAL FIX: 30s timeout
          killSignal: 'SIGKILL'
        }, async (error, stdout, stderr) => {
          if (error) {
            if (error.killed && error.signal === 'SIGKILL') {
              console.error(`[RawConverter] dcraw_emu timeout after 30s`);
              reject(new Error('dcraw_emu timeout'));
              return;
            }
            console.error(`[RawConverter] dcraw_emu error:`, error);
            console.error(`[RawConverter] dcraw_emu stderr:`, stderr);
            reject(new Error(`dcraw_emu conversion failed: ${error.message}`));
            return;
          }
          
          // dcraw_emu creates a TIFF file with same name + .tiff extension
          const autoTiffPath = rawFilePath + '.tiff';
          
          try {
            // Wait for file to be created
            await new Promise(resolve => setTimeout(resolve, 500));
            
            if (!fs.existsSync(autoTiffPath)) {
              reject(new Error(`dcraw_emu did not create expected TIFF: ${autoTiffPath}`));
              return;
            }
            
            // Move to our tracked temp path and convert to PPM format for ImageMagick compatibility
            await fsPromises.copyFile(autoTiffPath, tempPpmPath.replace('.ppm', '.tiff'));
            await fsPromises.unlink(autoTiffPath); // Cleanup auto-generated file
            
            console.log(`[RawConverter] dcraw_emu TIFF created successfully`);
            resolve();
            
          } catch (fileError: any) {
            reject(new Error(`Error handling dcraw_emu output: ${fileError.message}`));
          }
        });
      });
      
      // Step 2: TIFF → JPEG using Sharp (faster than ImageMagick)
      console.log(`[RawConverter] Converting TIFF to JPEG with Sharp`);
      
      const tiffPath = tempPpmPath.replace('.ppm', '.tiff');
      const processor = await createImageProcessor(tiffPath);
      const jpegBuffer = await processor
        .jpeg({ quality: quality })
        .toBuffer();
      
      await fsPromises.writeFile(outputPath, jpegBuffer);
      
      // Cleanup TIFF temp file
      if (fs.existsSync(tiffPath)) {
        await fsPromises.unlink(tiffPath);
      }
      
      console.log(`[RawConverter] CR3 LibRaw conversion completed: ${outputPath}`);
      return outputPath;
      
    } catch (error: any) {
      console.error(`[RawConverter] CR3 LibRaw conversion failed: ${error.message}`);
      throw new Error(`CR3 LibRaw conversion failed: ${error.message}`);
      
    } finally {
      // Cleanup tracked temp files
      await this.cleanupManager.cleanupFile(tempFileId);
    }
  }

  /**
   * Estrae thumbnail usando dcraw classico con -e per estrazione diretta
   * @private  
   */
  private async extractThumbnailWithDcraw(rawFilePath: string, outputPath: string, dcrawPath: string): Promise<string> {
    console.log(`[RawConverter] Extracting embedded thumbnail with dcraw -e`);
    
    return new Promise((resolve, reject) => {
      // dcraw -e estrae il thumbnail incorporato direttamente come JPEG
      // Il thumbnail embedded dovrebbe già avere la rotazione corretta
      execFile(dcrawPath, [
        '-e',           // Estrai thumbnail embedded
        rawFilePath     // File RAW di input
      ], { 
        maxBuffer: 10 * 1024 * 1024  // 10MB buffer per thumbnail
      }, async (error, stdout, stderr) => {
        if (error) {
          console.error(`[RawConverter] dcraw -e error:`, error);
          console.error(`[RawConverter] dcraw -e stderr:`, stderr);
          reject(new Error(`dcraw thumbnail extraction failed: ${error.message}`));
          return;
        }

        // dcraw -e crea automaticamente un file .thumb.jpg nella stessa directory
        const autoThumbPath = rawFilePath.replace(/\.[^.]+$/, '.thumb.jpg');
        
        try {
          // Aspetta che il file thumbnail sia creato
          await new Promise(r => setTimeout(r, 500));
          
          if (!fs.existsSync(autoThumbPath)) {
            reject(new Error(`dcraw -e did not create expected thumbnail: ${autoThumbPath}`));
            return;
          }

          // Se il percorso desiderato è diverso, copia il file
          if (autoThumbPath !== outputPath) {
            await fsPromises.copyFile(autoThumbPath, outputPath);
            console.log(`[RawConverter] Thumbnail copied from ${autoThumbPath} to ${outputPath}`);
            
            // Cleanup del file thumbnail temporaneo
            try {
              await fsPromises.unlink(autoThumbPath);
            } catch (cleanupError) {
              console.log(`[RawConverter] Warning: Could not cleanup auto-generated thumbnail: ${cleanupError}`);
            }
          }

          console.log(`[RawConverter] Thumbnail extracted successfully via dcraw -e: ${outputPath}`);
          resolve(outputPath);
          
        } catch (fileError: any) {
          reject(new Error(`Error handling thumbnail file: ${fileError.message}`));
        }
      });
    });
  }

  /**
   * Estrae thumbnail usando dcraw_emu con half-size per camere moderne
   * @private  
   */
  private async extractThumbnailWithDcrawEmu(rawFilePath: string, outputPath: string, dcrawEmuPath: string): Promise<string> {
    console.log(`[RawConverter] Extracting thumbnail with dcraw_emu (half-size for speed)`);
    
    return new Promise((resolve, reject) => {
      // dcraw_emu con opzioni per thumbnail più piccolo e veloce
      // LibRaw applica automaticamente la rotazione EXIF
      execFile(dcrawEmuPath, [
        '-h',           // Half-size (più veloce, meno memoria)
        '-q', '0',      // Qualità bilinear (più veloce)
        rawFilePath     // File RAW di input
      ], { 
        maxBuffer: 50 * 1024 * 1024  // 50MB buffer per half-size
      }, async (error, stdout, stderr) => {
        if (error) {
          console.error(`[RawConverter] dcraw_emu error:`, error);
          console.error(`[RawConverter] dcraw_emu stderr:`, stderr);
          reject(new Error(`dcraw_emu thumbnail extraction failed: ${error.message}`));
          return;
        }

        // dcraw_emu con queste opzioni crea rawFilePath + '.ppm'
        const autoPpmPath = rawFilePath + '.ppm';
        
        try {
          // Aspetta che il file PPM sia creato
          await new Promise(r => setTimeout(r, 800));
          
          if (fs.existsSync(autoPpmPath)) {
            console.log(`[RawConverter] Found auto-generated half-size PPM, converting to JPEG: ${autoPpmPath}`);
            
            try {
              // Usa ImageMagick per convertire PPM -> JPEG con compressione
              await this.convertPpmToJpegDirect(autoPpmPath, outputPath, { 
                quality: 85,  // Buona qualità per thumbnail
                maxDimension: 1200  // Limita ulteriormente la dimensione
              });
              
              // Cleanup PPM temporaneo
              await fsPromises.unlink(autoPpmPath);
              
              console.log(`[RawConverter] Half-size PPM converted to JPEG successfully: ${outputPath}`);
              resolve(outputPath);
              
            } catch (imageMagickError) {
              // Se ImageMagick fallisce, rinomina il PPM
              const ppmOutputPath = outputPath.replace(/\.(jpg|jpeg)$/i, '.ppm');
              await fsPromises.rename(autoPpmPath, ppmOutputPath);
              console.log(`[RawConverter] ImageMagick unavailable, saved as PPM: ${ppmOutputPath}`);
              resolve(ppmOutputPath);
            }
            
          } else {
            reject(new Error(`dcraw_emu did not create expected PPM: ${autoPpmPath}`));
          }
          
        } catch (fileError: any) {
          reject(new Error(`Error handling thumbnail file: ${fileError.message}`));
        }
      });
    });
  }

  /**
   * Fallback: estrae thumbnail con dcraw_emu o dcraw (conversione completa a dimensioni ridotte)  
   * @private
   */
  private async extractThumbnailWithDcrawFallback(rawFilePath: string, outputPath: string, dcrawPath: string, type: 'libraw' | 'dcraw'): Promise<string> {
    console.log(`[RawConverter] Fallback thumbnail extraction with ${type}`);
    
    // File PPM temporaneo 
    const tempId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
    const tempPpmPath = path.join(os.tmpdir(), `racetagger_thumb_${tempId}.ppm`);

    try {
      // Fase 1: RAW -> PPM con dimensioni ridotte per velocità
      await new Promise<void>((resolve, reject) => {
        const dcrawArgs = [
          '-c',    // Output su stdout
          '-h',    // Half-size (più veloce per thumbnails)
          '-q', '1',  // Qualità media (1=bilinear, più veloce di AHD)
          '-w',    // Usa camera white balance
          '-o', '1',  // sRGB color space
          rawFilePath
        ];

        console.log(`[RawConverter] ${type} command: ${dcrawPath} ${dcrawArgs.join(' ')}`);

        execFile(dcrawPath, dcrawArgs, {
          maxBuffer: 50 * 1024 * 1024,
          encoding: 'binary',
          timeout: 30000,      // CRITICAL FIX: 30s timeout for thumbnails
          killSignal: 'SIGKILL'
        }, (error, stdout, stderr) => {
          if (error) {
            if (error.killed && error.signal === 'SIGKILL') {
              console.error(`[RawConverter] ${type} timeout after 30s`);
              reject(new Error(`${type} thumbnail timeout`));
              return;
            }
            console.error(`[RawConverter] ${type} error:`, error);
            console.error(`[RawConverter] ${type} stderr:`, stderr);
            reject(new Error(`${type} thumbnail conversion failed: ${error.message}`));
            return;
          }

          // Scrivi PPM temporaneo
          fs.writeFile(tempPpmPath, stdout, 'binary', (writeError) => {
            if (writeError) {
              reject(new Error(`Error writing temp PPM: ${writeError.message}`));
            } else {
              console.log(`[RawConverter] PPM thumbnail created: ${tempPpmPath}`);
              resolve();
            }
          });
        });
      });

      // Fase 2: PPM -> JPEG con ImageMagick o rinomina se non disponibile
      if (fs.existsSync(tempPpmPath)) {
        try {
          await this.convertPpmToJpegDirect(tempPpmPath, outputPath, { quality: 85 });
        } catch (imageMagickError) {
          // Se ImageMagick non è disponibile, rinomina il PPM come output
          const ppmOutputPath = outputPath.replace(/\.(jpg|jpeg)$/i, '.ppm');
          await fsPromises.rename(tempPpmPath, ppmOutputPath);
          console.log(`[RawConverter] ImageMagick unavailable, saved as PPM: ${ppmOutputPath}`);
          return ppmOutputPath;
        }
      }

      // Cleanup temporaneo
      if (fs.existsSync(tempPpmPath)) {
        await fsPromises.unlink(tempPpmPath);
      }

      if (!fs.existsSync(outputPath)) {
        throw new Error('Thumbnail file was not created');
      }

      console.log(`[RawConverter] Thumbnail extraction completed: ${outputPath}`);
      return outputPath;

    } catch (error: any) {
      // Cleanup in caso di errore
      if (fs.existsSync(tempPpmPath)) {
        try {
          await fsPromises.unlink(tempPpmPath);
        } catch (cleanupError) {
          console.log(`[RawConverter] Cleanup error: ${cleanupError}`);
        }
      }
      throw error;
    }
  }

  /**
   * Converte un file RAW in JPEG ottimizzato usando thumbnail extraction + Sharp
   * 1. Estrae thumbnail dal RAW con LibRaw/dcraw
   * 2. Ottimizza con Sharp utilizzando i preset di configurazione
   * 
   * Supporta entrambe le signature:
   * - Nuova: convertRawToJpeg(rawPath, outputPath?, preset?)
   * - Legacy: convertRawToJpeg(rawPath, outputPath?, jpegQuality?, maxSize?, keepDng?)
   * 
   * @param rawFilePath Percorso al file RAW
   * @param outputJpegPath Percorso dove salvare il JPEG (se omesso, usa la stessa directory del RAW)
   * @param presetOrQuality Preset di qualità (ResizePreset) oppure qualità JPEG numerica (legacy)
   * @param maxSize Dimensione massima (legacy signature)
   * @param keepDngFile Flag per mantenere DNG (legacy signature, ignorato)
   * @returns Promise con il percorso al file JPEG generato
   * @public
   */
  async convertRawToJpeg(
    rawFilePath: string, 
    outputJpegPath?: string, 
    presetOrQuality: ResizePreset | number = ResizePreset.BILANCIATO,
    maxSize?: number,
    keepDngFile?: boolean
  ): Promise<string> {
    const sanitizedRawPath = this.sanitizePath(rawFilePath);
    
    // Se non è specificato un percorso di output, crea uno nella stessa directory del file RAW
    if (!outputJpegPath) {
      const baseFilename = path.basename(sanitizedRawPath, path.extname(sanitizedRawPath));
      outputJpegPath = path.join(path.dirname(sanitizedRawPath), `${baseFilename}.jpg`);
    }

    const sanitizedOutputPath = this.sanitizePath(outputJpegPath);

    // Detect signature type and create config
    let config: ResizeConfig;
    let preset: string;

    if (typeof presetOrQuality === 'string') {
      // New signature: using ResizePreset
      preset = presetOrQuality;
      config = RESIZE_PRESETS[presetOrQuality];
    } else {
      // Legacy signature: convert numeric values to config
      const jpegQuality = presetOrQuality || 95;
      const maxDimension = maxSize || 1440;
      
      // Map legacy values to nearest preset
      if (maxDimension <= 1080 && jpegQuality <= 75) {
        preset = 'VELOCE (from legacy)';
        config = RESIZE_PRESETS[ResizePreset.VELOCE];
      } else if (maxDimension <= 1440 && jpegQuality <= 85) {
        preset = 'BILANCIATO (from legacy)';
        config = RESIZE_PRESETS[ResizePreset.BILANCIATO];
      } else {
        preset = 'QUALITA (from legacy)';
        config = RESIZE_PRESETS[ResizePreset.QUALITA];
      }
      
      // Override with exact legacy values
      config = {
        maxDimension: maxDimension,
        jpegQuality: jpegQuality,
        enabled: true
      };
    }

    console.log(`╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║              RAW TO JPEG OPTIMIZATION                    ║`);
    console.log(`║     Preset: ${preset.padEnd(40)} ║`);
    console.log(`║     Max Size: ${config.maxDimension}px, Quality: ${config.jpegQuality}%${''.padEnd(20)} ║`);
    console.log(`║     Input: ${path.basename(sanitizedRawPath).padEnd(42)} ║`);
    console.log(`║     Output: ${path.basename(sanitizedOutputPath).padEnd(41)} ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝`);

    try {
      // Check if we should force Adobe DNG fallback for testing
      if (process.env.FORCE_ADOBE_DNG_FALLBACK === 'true') {
        console.log(`[RawConverter] 🧪 FORCE_ADOBE_DNG_FALLBACK enabled - checking input file type`);
        
        // CRITICAL FIX: Only use Adobe DNG Converter for RAW files, NOT for DNG files
        const inputExtension = path.extname(sanitizedRawPath).toLowerCase();
        if (inputExtension === '.dng') {
          console.log(`[RawConverter] 🧪 Input is already DNG - using standard dcraw pipeline for DNG→JPEG conversion`);
          // Continue with normal dcraw pipeline below for DNG→JPEG conversion
        } else {
          // Input is a RAW file (NEF, ARW, CR2, etc.) - use Adobe DNG Converter
          console.log(`[RawConverter] 🧪 Input is RAW (${inputExtension}) - using Adobe pipeline: ${path.basename(sanitizedRawPath)}`);
          if (await this.isDngConverterInstalled()) {
            return await this.convertRawToJpegViaAdobeDngFallback(sanitizedRawPath, sanitizedOutputPath, config, preset);
          } else {
            throw new Error('Adobe DNG Converter not available (forced fallback mode)');
          }
        }
      }

      // Step 1: Estrai thumbnail dal file RAW
      console.log(`[RawConverter] Step 1: Extracting thumbnail from RAW`);
      const thumbnailPath = await this.extractThumbnailFromRaw(sanitizedRawPath);

      // Step 2: Ottimizza il thumbnail con il sistema ibrido usando la configurazione
      console.log(`[RawConverter] Step 2: Optimizing thumbnail with hybrid system (${preset})`);
      const optimizedPath = await this.optimizeThumbnailWithSharp(thumbnailPath, sanitizedOutputPath, config);

      // Step 3: Cleanup del thumbnail temporaneo se diverso dall'output finale
      if (thumbnailPath !== optimizedPath && fs.existsSync(thumbnailPath) && 
          thumbnailPath.includes('_thumb.')) {
        try {
          await fsPromises.unlink(thumbnailPath);
          console.log(`[RawConverter] Cleaned up temporary thumbnail: ${path.basename(thumbnailPath)}`);
        } catch (cleanupError) {
          console.log(`[RawConverter] Warning: Could not cleanup thumbnail: ${cleanupError}`);
        }
      }

      console.log(`[RawConverter] RAW to JPEG conversion completed successfully: ${optimizedPath}`);
      return optimizedPath;

    } catch (error: any) {
      console.error(`[RawConverter] Primary conversion pipeline failed: ${error.message}`);
      
      // Enhanced error reporting
      const inputExtension = path.extname(sanitizedRawPath).toLowerCase();
      const isDngFile = inputExtension === '.dng';
      const fileType = isDngFile ? 'DNG' : 'RAW';
      
      console.log(`[RawConverter] Error details:`);
      console.log(`  - File type: ${fileType}`);
      console.log(`  - Input: ${path.basename(sanitizedRawPath)}`);
      console.log(`  - Expected output: ${path.basename(sanitizedOutputPath)}`);
      console.log(`  - Error message: ${error.message}`);
      
      // Final fallback: Try Adobe DNG Converter if available and for RAW files only
      if (!isDngFile && await this.isDngConverterInstalled()) {
        try {
          console.log(`[RawConverter] Attempting Adobe DNG Converter fallback for RAW file`);
          return await this.convertRawToJpegViaAdobeDngFallback(sanitizedRawPath, sanitizedOutputPath, config, preset);
        } catch (adobeError: any) {
          console.error(`[RawConverter] Adobe DNG fallback also failed: ${adobeError.message}`);
          throw new Error(`RAW to JPEG conversion completely failed. Primary: ${error.message}. Adobe fallback: ${adobeError.message}`);
        }
      }
      
      // For DNG files or when Adobe DNG Converter is not available
      console.error(`[RawConverter] ${fileType} to JPEG conversion failed: ${error.message}`);
      throw new Error(`${fileType} to JPEG conversion completely failed. Primary: ${error.message}`);
    }
  }

  /**
   * Ottimizza un'immagine thumbnail con il sistema ibrido usando la configurazione specificata
   * @private
   */
  private async optimizeThumbnailWithSharp(inputPath: string, outputPath: string, config: ResizeConfig): Promise<string> {
    console.log(`[RawConverter] Image optimization: ${config.maxDimension}px max, ${config.jpegQuality}% quality`);

    try {
      // Usa il sistema ibrido (Sharp + Jimp fallback)
      const processor = await createImageProcessor(inputPath);
      const buffer = await processor
        .rotate()  // Auto-rotate based on EXIF orientation data
        .resize(config.maxDimension, config.maxDimension, {
          fit: 'inside',        // Mantieni aspect ratio
          withoutEnlargement: true  // Non ingrandire se più piccola
        })
        .jpeg({ 
          quality: config.jpegQuality,
          progressive: true
        })
        .toBuffer();

      // Scrivi il buffer ottimizzato nel file di output
      await fsPromises.writeFile(outputPath, buffer);

      console.log(`[RawConverter] Image optimization completed: ${outputPath}`);
      return outputPath;

    } catch (optimizationError: any) {
      console.error(`[RawConverter] Image optimization failed: ${optimizationError.message}`);
      console.log(`[RawConverter] Attempting direct copy as fallback...`);
      
      // Se l'ottimizzazione fallisce, prova a copiare il file direttamente
      try {
        await fsPromises.copyFile(inputPath, outputPath);
        console.log(`[RawConverter] Direct copy successful: ${outputPath}`);
        return outputPath;
      } catch (copyError: any) {
        console.error(`[RawConverter] Direct copy also failed: ${copyError.message}`);
        throw new Error(`Image optimization failed: ${optimizationError.message}. Copy fallback: ${copyError.message}`);
      }
    }
  }

  /**
   * Converte RAW to JPEG via Adobe DNG Converter fallback
   * Pipeline: RAW → Adobe DNG → dcraw/Sharp → Optimized JPEG
   * @private
   */
  private async convertRawToJpegViaAdobeDngFallback(
    rawFilePath: string, 
    outputJpegPath: string, 
    config: ResizeConfig, 
    preset: string
  ): Promise<string> {
    console.log(`[RawConverter] ╔════════════════════════════════════════╗`);
    console.log(`[RawConverter] ║    ADOBE DNG JPEG CONVERSION FALLBACK  ║`);
    console.log(`[RawConverter] ║  File: ${path.basename(rawFilePath).padEnd(30)} ║`);
    console.log(`[RawConverter] ║  Preset: ${preset.padEnd(28)} ║`);
    console.log(`[RawConverter] ╚════════════════════════════════════════╝`);

    const tempFileId = `adobe_jpeg_${Date.now()}`;
    let tempDngPath = '';

    try {
      // Step 1: Convert RAW to DNG using Adobe DNG Converter
      console.log(`[RawConverter] Step 1: Converting RAW to DNG with Adobe DNG Converter`);
      const baseFilename = path.basename(rawFilePath, path.extname(rawFilePath));
      tempDngPath = path.join(this.tempDngDirectory, `${baseFilename}_${tempFileId}.dng`);
      
      await this._convertRawToDngInternal(rawFilePath, tempDngPath, false);
      
      // Step 2: Convert DNG to optimized JPEG
      console.log(`[RawConverter] Step 2: Converting DNG to optimized JPEG`);
      const jpegPath = await this.convertDngToJpegOptimized(tempDngPath, outputJpegPath, config.jpegQuality, config.maxDimension);
      
      console.log(`[RawConverter] ✅ Adobe DNG JPEG fallback successful: ${jpegPath}`);
      return jpegPath;

    } catch (error: any) {
      console.error(`[RawConverter] Adobe DNG JPEG fallback failed: ${error.message}`);
      throw new Error(`Adobe DNG JPEG fallback failed: ${error.message}`);
      
    } finally {
      // Cleanup: always remove temporary DNG file
      if (tempDngPath && fs.existsSync(tempDngPath)) {
        try {
          await fsPromises.unlink(tempDngPath);
          console.log(`[RawConverter] Cleaned up temp DNG: ${path.basename(tempDngPath)}`);
        } catch (cleanupError) {
          console.log(`[RawConverter] Warning: Could not cleanup temp DNG: ${cleanupError}`);
        }
      }
    }
  }

  /**
   * Converte un file RAW direttamente in JPEG usando solo dcraw (senza Adobe DNG Converter)
   * Questo metodo bypassa completamente Adobe DNG Converter e usa dcraw per l'intera pipeline
   * @param rawFilePath Percorso al file RAW
   * @param outputJpegPath Percorso dove salvare il JPEG (opzionale)
   * @param options Opzioni per dcraw
   * @returns Promise con il percorso al file JPEG generato
   * @public
   */
  async convertRawToJpegDirectWithDcraw(
    rawFilePath: string,
    outputJpegPath?: string,
    options: {
      quality?: number;        // -q (0-3, default 3=AHD)
      brightness?: number;     // -b (default 1.0)
      halfSize?: boolean;      // -h (più veloce, metà risoluzione)
      autoWB?: boolean;        // -a (bilanciamento automatico)
      cameraWB?: boolean;      // -w (usa WB camera, default true)
      outputColorSpace?: number; // -o (0=raw, 1=sRGB, 2=Adobe, 3=Wide, 4=ProPhoto, 5=XYZ)
      jpegQuality?: number;    // Qualità JPEG finale (1-100)
      maxDimension?: number;   // Dimensione massima lato lungo
    } = {}
  ): Promise<string> {
    const sanitizedRawPath = this.sanitizePath(rawFilePath);
    
    // Se non specificato, crea il percorso di output
    if (!outputJpegPath) {
      const baseFilename = path.basename(sanitizedRawPath, path.extname(sanitizedRawPath));
      outputJpegPath = path.join(path.dirname(sanitizedRawPath), `${baseFilename}_dcraw.jpg`);
    }
    
    const sanitizedOutputPath = this.sanitizePath(outputJpegPath);
    
    console.log(`[DCRAW DIRECT] Converting RAW to JPEG: ${sanitizedRawPath} -> ${sanitizedOutputPath}`);
    
    // Verifica che dcraw sia disponibile
    if (!await this.isDcrawInstalled()) {
      throw new Error('dcraw non è installato o non è accessibile');
    }
    
    try {
      // Usa il metodo PPM per migliore qualità
      const result = await this.convertRawToJpegViaPpmDirect(
        sanitizedRawPath,
        sanitizedOutputPath,
        options
      );
      
      return result;
    } catch (error: any) {
      console.error(`[DCRAW DIRECT] Conversion failed: ${error.message}`);
      throw new Error(`dcraw direct conversion failed: ${error.message}`);
    }
  }

  /**
   * Verifica se dcraw è installato nel sistema
   * @private
   */
  private async isDcrawInstalled(): Promise<boolean> {
    const possiblePaths = [
      '/opt/homebrew/bin/dcraw',  // macOS Homebrew
      '/usr/local/bin/dcraw',     // macOS/Linux
      '/usr/bin/dcraw',           // Linux
      'dcraw.exe',                // Windows
      'dcraw'                     // PATH
    ];

    for (const dcrawPath of possiblePaths) {
      try {
        await fsPromises.access(dcrawPath, fs.constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * Ottiene il percorso di dcraw
   * @private
   */
  private async getDcrawPath(): Promise<string | null> {
    // Check vendor path first for Windows
    if (process.platform === 'win32') {
      const { app } = require('electron');
      const isPackaged = app?.isPackaged || false;
      const vendorDcrawPath = isPackaged 
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'win32', 'dcraw.exe')
        : path.join(process.cwd(), 'vendor', 'win32', 'dcraw.exe');
      
      console.log(`[getDcrawPath-WIN32] Checking vendor path: ${vendorDcrawPath}`);
      if (fs.existsSync(vendorDcrawPath)) {
        console.log(`[getDcrawPath-WIN32] Found dcraw at vendor path: ${vendorDcrawPath}`);
        return vendorDcrawPath;
      }
    }
    
    const possiblePaths = [
      '/opt/homebrew/bin/dcraw',
      '/usr/local/bin/dcraw',
      '/usr/bin/dcraw',
      'dcraw.exe',
      'dcraw'
    ];

    for (const dcrawPath of possiblePaths) {
      try {
        await fsPromises.access(dcrawPath, fs.constants.X_OK);
        return dcrawPath;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Ottiene i percorsi vendor embedded per la build di produzione
   * @private
   */
  private getVendorPaths(): { dcraw: string[], dcrawEmu: string[] } {
    let basePath = process.cwd();
    
    try {
      // Prova a usare Electron se disponibile
      const app = require('electron').app;
      const isDev = process.env.NODE_ENV === 'development';
      basePath = isDev ? process.cwd() : path.dirname(app.getAppPath());
    } catch {
      // Fallback per test standalone o quando Electron non è disponibile
      basePath = process.cwd();
    }
    
    // Use platform-specific vendor path
    const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const vendorPath = path.join(basePath, 'vendor', platformDir);
    const dcrawExe = process.platform === 'win32' ? 'dcraw.exe' : 'dcraw';
    const dcrawEmuExe = process.platform === 'win32' ? 'dcraw_emu.exe' : 'dcraw_emu';
    
    return {
      dcraw: [
        path.join(vendorPath, dcrawExe),  // vendor/platform/dcraw (embedded)
        path.join(process.cwd(), 'vendor', platformDir, dcrawExe)  // dev mode path
      ],
      dcrawEmu: [
        path.join(vendorPath, dcrawEmuExe),  // vendor/platform/dcraw_emu (embedded se presente)
        path.join(process.cwd(), 'vendor', platformDir, dcrawEmuExe)  // dev mode path se presente
      ]
    };
  }

  /**
   * Ottiene tutti gli eseguibili RAW disponibili sul sistema
   * @private
   */
  private async getAllDcrawExecutables(): Promise<{ dcraw?: string; dcrawEmu?: string }> {
    const result: { dcraw?: string; dcrawEmu?: string } = {};

    // Percorsi per dcraw embedded (build di produzione)
    const vendorPaths = this.getVendorPaths();
    
    // Trova dcraw classico (inclusi percorsi embedded)
    const dcrawPaths = [
      ...vendorPaths.dcraw,  // Percorsi embedded prima
      '/opt/homebrew/bin/dcraw',
      '/usr/local/bin/dcraw',
      '/usr/bin/dcraw',
      'dcraw.exe',
      'dcraw'
    ];

    console.log(`[getAllDcrawExecutables] Checking dcraw paths:`, dcrawPaths);

    for (const dcrawPath of dcrawPaths) {
      try {
        // On Windows, check if file exists rather than X_OK permission
        if (process.platform === 'win32') {
          if (fs.existsSync(dcrawPath)) {
            console.log(`[getAllDcrawExecutables-WIN32] Found dcraw at: ${dcrawPath}`);
            result.dcraw = dcrawPath;
            break;
          }
        } else {
          await fsPromises.access(dcrawPath, fs.constants.X_OK);
          result.dcraw = dcrawPath;
          break;
        }
      } catch {
        continue;
      }
    }

    // Trova dcraw_emu (inclusi percorsi embedded)
    const librawPaths = [
      ...vendorPaths.dcrawEmu,  // Percorsi embedded prima
      '/opt/homebrew/bin/dcraw_emu',
      '/usr/local/bin/dcraw_emu',
      '/usr/bin/dcraw_emu',
      'dcraw_emu.exe',
      'dcraw_emu'
    ];

    for (const dcrawEmuPath of librawPaths) {
      try {
        // On Windows, check if file exists rather than X_OK permission
        if (process.platform === 'win32') {
          if (fs.existsSync(dcrawEmuPath)) {
            console.log(`[getAllDcrawExecutables-WIN32] Found dcraw_emu at: ${dcrawEmuPath}`);
            result.dcrawEmu = dcrawEmuPath;
            break;
          }
        } else {
          await fsPromises.access(dcrawEmuPath, fs.constants.X_OK);
          result.dcrawEmu = dcrawEmuPath;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!result.dcraw && !result.dcrawEmu) {
      console.error(`[getAllDcrawExecutables] No RAW converter found. Checked paths:`, [...dcrawPaths, ...librawPaths]);
      throw new Error('No RAW converter found. Install libraw (dcraw_emu) or dcraw');
    }

    console.log(`[getAllDcrawExecutables] Found converters:`, result);
    return result;
  }

  /**
   * Converte RAW -> PPM -> JPEG usando dcraw + ImageMagick
   * Metodo ottimizzato per qualità e compatibilità
   * @private
   */
  private async convertRawToJpegViaPpmDirect(
    rawFilePath: string,
    outputJpegPath: string,
    options: any = {}
  ): Promise<string> {
    const dcrawPath = await this.getDcrawPath();
    if (!dcrawPath) {
      throw new Error('dcraw not found');
    }

    // File PPM temporaneo
    const tempId = Date.now().toString() + Math.random().toString(36).substring(2, 10);
    const tempPpmPath = path.join(os.tmpdir(), `racetagger_dcraw_${tempId}.ppm`);

    try {
      console.log(`[DCRAW DIRECT] Phase 1: RAW -> PPM using dcraw`);
      
      // Fase 1: RAW -> PPM con dcraw
      const dcrawArgs = [
        '-c',  // Output su stdout
        '-q', (options.quality || 3).toString(),  // Qualità interpolazione (3=AHD, migliore)
        '-b', (options.brightness || 1.0).toString(),  // Luminosità
        '-o', (options.outputColorSpace || 1).toString(),  // Spazio colore (1=sRGB)
        // Note: dcraw di default applica automaticamente la rotazione della camera EXIF
        // Non usiamo -t 0 per mantenere la rotazione automatica
        rawFilePath
      ];

      // Opzioni aggiuntive
      if (options.halfSize) dcrawArgs.splice(-1, 0, '-h');
      if (options.autoWB) {
        dcrawArgs.splice(-1, 0, '-a');
      } else if (options.cameraWB !== false) {
        dcrawArgs.splice(-1, 0, '-w');  // Default: usa camera WB
      }

      console.log(`[DCRAW DIRECT] dcraw command: ${dcrawPath} ${dcrawArgs.join(' ')}`);

      await new Promise<void>((resolve, reject) => {
        execFile(dcrawPath, dcrawArgs, { 
          maxBuffer: 200 * 1024 * 1024,  // 200MB buffer per immagini grandi
          encoding: 'binary'
        }, (error, stdout, stderr) => {
          if (error) {
            console.error(`[DCRAW DIRECT] dcraw error:`, error);
            console.error(`[DCRAW DIRECT] dcraw stderr:`, stderr);
            reject(new Error(`dcraw failed: ${error.message}`));
            return;
          }

          // Scrivi l'output binario nel file PPM
          fs.writeFile(tempPpmPath, stdout, 'binary', (writeError) => {
            if (writeError) {
              reject(new Error(`Error writing PPM: ${writeError.message}`));
            } else {
              console.log(`[DCRAW DIRECT] PPM file created: ${tempPpmPath}`);
              resolve();
            }
          });
        });
      });

      // Verifica che il file PPM sia stato creato
      if (!fs.existsSync(tempPpmPath)) {
        throw new Error('PPM file was not created');
      }

      console.log(`[DCRAW DIRECT] Phase 2: PPM -> JPEG using ImageMagick`);
      
      // Fase 2: PPM -> JPEG con ImageMagick (se disponibile)
      try {
        await this.convertPpmToJpegDirect(tempPpmPath, outputJpegPath, {
          quality: options.jpegQuality || 95,
          maxDimension: options.maxDimension
        });
      } catch (imageMagickError) {
        console.log(`[DCRAW DIRECT] ImageMagick not available, renaming PPM to output`);
        // Se ImageMagick non è disponibile, rinomina il PPM
        const ppmOutputPath = outputJpegPath.replace(/\.(jpg|jpeg)$/i, '.ppm');
        await fsPromises.rename(tempPpmPath, ppmOutputPath);
        return ppmOutputPath;
      }

      // Cleanup file temporaneo
      try {
        if (fs.existsSync(tempPpmPath)) {
          await fsPromises.unlink(tempPpmPath);
          console.log(`[DCRAW DIRECT] Cleaned up temp PPM: ${tempPpmPath}`);
        }
      } catch (cleanupError) {
        console.log(`[DCRAW DIRECT] Warning: Could not cleanup temp PPM: ${cleanupError}`);
      }

      // Verifica che il file finale esista
      if (!fs.existsSync(outputJpegPath)) {
        throw new Error('Final JPEG file was not created');
      }

      console.log(`[DCRAW DIRECT] Conversion completed successfully: ${outputJpegPath}`);
      return outputJpegPath;

    } catch (error: any) {
      // Cleanup in caso di errore
      try {
        if (fs.existsSync(tempPpmPath)) {
          await fsPromises.unlink(tempPpmPath);
        }
      } catch (cleanupError) {
        console.log(`[DCRAW DIRECT] Cleanup error: ${cleanupError}`);
      }
      
      throw new Error(`dcraw direct conversion failed: ${error.message}`);
    }
  }

  /**
   * Converte PPM in JPEG usando ImageMagick
   * @private
   */
  private async convertPpmToJpegDirect(
    ppmPath: string,
    jpegPath: string,
    options: { quality?: number; maxDimension?: number } = {}
  ): Promise<void> {
    const convertArgs = [ppmPath];

    // Ridimensionamento se specificato
    if (options.maxDimension) {
      convertArgs.push('-resize', `${options.maxDimension}x${options.maxDimension}>`);
    }

    // Qualità JPEG
    convertArgs.push('-quality', (options.quality || 95).toString());

    // Output path
    convertArgs.push(jpegPath);

    console.log(`[DCRAW DIRECT] ImageMagick convert: convert ${convertArgs.join(' ')}`);

    return new Promise((resolve, reject) => {
      execFile('convert', convertArgs, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30000,      // CRITICAL FIX: 30s timeout
        killSignal: 'SIGKILL'
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.killed && error.signal === 'SIGKILL') {
            console.error(`[DCRAW DIRECT] ImageMagick timeout after 30s`);
            reject(new Error('ImageMagick conversion timeout'));
            return;
          }
          console.error(`[DCRAW DIRECT] ImageMagick error:`, error);
          console.error(`[DCRAW DIRECT] ImageMagick stderr:`, stderr);
          reject(new Error(`ImageMagick convert failed: ${error.message}`));
        } else {
          console.log(`[DCRAW DIRECT] ImageMagick conversion successful`);
          resolve();
        }
      });
    });
  }

  /**
   * Attende che un file sia stabile (completamente scritto)
   * Controlla periodicamente le dimensioni del file fino a quando non smettono di cambiare
   * @private
   */
  private async waitForFileToBeStable(filePath: string, timeout: number = 5000): Promise<void> {
    console.log(`Waiting for file to be stable: ${filePath}`);
    
    const startTime = Date.now();
    let lastSize = -1;
    let consecutiveStableChecks = 0;
    
    while (Date.now() - startTime < timeout) {
      if (!fs.existsSync(filePath)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      const stats = fs.statSync(filePath);
      const currentSize = stats.size;
      
      console.log(`File size check: ${currentSize} bytes`);
      
      if (currentSize === lastSize) {
        consecutiveStableChecks++;
        
        // Se il file ha mantenuto le stesse dimensioni per 3 controlli consecutivi
        // consideriamolo stabile (completamente scritto)
        if (consecutiveStableChecks >= 3) {
          console.log(`File is stable after ${Date.now() - startTime}ms: ${filePath} (${currentSize} bytes)`);
          return;
        }
      } else {
        // Reset del contatore se le dimensioni cambiano
        consecutiveStableChecks = 0;
        lastSize = currentSize;
      }
      
      // Attesa tra un controllo e l'altro
      await new Promise(r => setTimeout(r, 300));
    }
    
    console.log(`Timeout reached, assuming file is stable: ${filePath}`);
  }
  
  /**
   * Implementazione interna della conversione RAW→DNG
   * @private
   */
  private async _convertRawToDngInternal(rawFilePath: string, outputDngPath: string, useLossyCompression: boolean = false): Promise<void> {
    // Sanitize input paths to prevent command injection
    const sanitizedRawPath = this.sanitizePath(rawFilePath);
    const sanitizedOutputPath = this.sanitizePath(outputDngPath);
    
    const outputDir = path.dirname(sanitizedOutputPath);
    const outputBasename = path.basename(sanitizedOutputPath, '.dng');
    
    console.log(`🔄 Starting DNG conversion with Adobe DNG Converter:`);
    console.log(`   📁 Input: ${sanitizedRawPath}`);
    console.log(`   📁 Output dir: ${outputDir}`);
    console.log(`   📄 Output name: ${outputBasename}.dng`);
    console.log(`   🎯 Expected path: ${sanitizedOutputPath}`);
    
    // Verifica che il file di input esista
    if (!fs.existsSync(sanitizedRawPath)) {
      throw new Error(`Input RAW file does not exist: ${sanitizedRawPath}`);
    }
    
    // Assicurati che la directory di output esista
    if (!fs.existsSync(outputDir)) {
      console.log(`   📂 Creating output directory: ${outputDir}`);
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Costruisci i parametri corretti per Adobe DNG Converter
    let dngConverterArgs: string[] = [];
    const cmdPath = this.getDngConverterPath();
    
    if (process.platform === 'darwin') {
      // Su macOS: parametri PRIMA del file di input per forzare la directory corretta
      dngConverterArgs = [
        '-d', outputDir,               // Directory di destinazione DEVE essere prima
        '-o', outputBasename + '.dng', // Nome file CON estensione .dng
        '-p2',                         // Formato DNG (2 = lossless linear)
        sanitizedRawPath               // File di input ALLA FINE
      ];
      
      if (useLossyCompression) {
        dngConverterArgs.splice(2, 1, '-p1'); // Sostituisci -p2 con -p1 per lossy
      }
    } else if (process.platform === 'win32') {
      // Su Windows
      dngConverterArgs = [
        '-c', sanitizedRawPath,        // File da convertire con flag -c
        '-d', outputDir,               // Directory di output
        '-o', outputBasename + '.dng', // Nome file output CON estensione .dng
        '-p', '2'                      // Formato DNG con spazio
      ];
      
      if (useLossyCompression) {
        dngConverterArgs[dngConverterArgs.length - 1] = '1'; // Cambia da '2' a '1'
      }
    } else {
      // Linux e altri
      dngConverterArgs = [
        '-d', outputDir,
        '-o', outputBasename + '.dng', // Nome file CON estensione .dng
        '-p', '2',
        sanitizedRawPath
      ];
      
      if (useLossyCompression) {
        dngConverterArgs[dngConverterArgs.indexOf('2')] = '1';
      }
    }
    
    console.log(`   🔧 Command: ${path.basename(cmdPath)} ${dngConverterArgs.join(' ')}`);
    console.log(`   📍 Working from: ${process.cwd()}`);
    
    // Esegui Adobe DNG Converter con async/await
    return new Promise<void>((resolve, reject) => {
      execFile(cmdPath, dngConverterArgs, { 
        timeout: 60000, // 60 secondi timeout
        maxBuffer: 1024 * 1024 // 1MB buffer
      }, async (error, stdout, stderr) => {
        
        console.log(`   📊 Adobe DNG Converter Output:`);
        console.log(`      ✅ STDOUT: ${stdout || '(empty)'}`);
        console.log(`      ⚠️  STDERR: ${stderr || '(empty)'}`);
        
        if (error) {
          console.log(`   ❌ Process error: ${error.message}`);
          console.log(`      Exit code: ${error.code}`);
          console.log(`      Signal: ${error.signal || 'none'}`);
          reject(new Error(`Adobe DNG Converter failed: ${error.message}`));
          return;
        }
        
        // Attendi un momento per essere sicuri che il file sia completamente scritto
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verifica dove è stato creato il file DNG
        const expectedDngPath = sanitizedOutputPath;
        const alternativePath1 = path.join(outputDir, `${outputBasename}.dng`);
        const alternativePath2 = path.join(path.dirname(sanitizedRawPath), `${outputBasename}.dng`);
        const alternativePath3 = path.join(path.dirname(sanitizedRawPath), `${path.basename(sanitizedRawPath, path.extname(sanitizedRawPath))}.dng`);
        
        console.log(`   🔍 Searching for created DNG file:`);
        console.log(`      1️⃣  Expected: ${expectedDngPath}`);
        console.log(`      2️⃣  Alternative 1: ${alternativePath1}`);
        console.log(`      3️⃣  Alternative 2: ${alternativePath2}`);
        console.log(`      4️⃣  Alternative 3: ${alternativePath3}`);
        
        let actualDngPath: string | null = null;
        
        // Cerca il file nelle varie posizioni possibili
        if (fs.existsSync(expectedDngPath)) {
          actualDngPath = expectedDngPath;
          console.log(`   ✅ Found at expected location!`);
        } else if (fs.existsSync(alternativePath1)) {
          actualDngPath = alternativePath1;
          console.log(`   ✅ Found at alternative location 1!`);
        } else if (fs.existsSync(alternativePath2)) {
          actualDngPath = alternativePath2;
          console.log(`   ✅ Found at alternative location 2 (original directory)!`);
        } else if (fs.existsSync(alternativePath3)) {
          actualDngPath = alternativePath3;
          console.log(`   ✅ Found at alternative location 3 (original name)!`);
        }
        
        if (!actualDngPath) {
          // Elenca tutti i file nelle directory per debug
          console.log(`   ❌ DNG file not found! Listing directories:`);
          try {
            console.log(`      📁 Output dir (${outputDir}):`, fs.readdirSync(outputDir));
          } catch (e) {
            console.log(`      ❌ Cannot read output dir: ${e}`);
          }
          
          try {
            const originalDir = path.dirname(sanitizedRawPath);
            console.log(`      📁 Original dir (${originalDir}):`, fs.readdirSync(originalDir));
          } catch (e) {
            console.log(`      ❌ Cannot read original dir: ${e}`);
          }
          
          reject(new Error(`DNG file not created. Expected: ${expectedDngPath}`));
          return;
        }
        
        // Se il file è stato creato in una posizione diversa da quella desiderata, spostalo
        if (actualDngPath !== expectedDngPath) {
          console.log(`   🚚 Moving DNG file from ${actualDngPath} to ${expectedDngPath}`);
          try {
            // Assicurati che la directory di destinazione esista
            fs.mkdirSync(path.dirname(expectedDngPath), { recursive: true });
            
            // Sposta il file
            fs.renameSync(actualDngPath, expectedDngPath);
            console.log(`   ✅ File moved successfully!`);
          } catch (moveError: any) {
            console.log(`   ❌ Failed to move file: ${moveError.message}`);
            reject(new Error(`Failed to move DNG file: ${moveError.message}`));
            return;
          }
        }
        
        // Verifica finale che il file esista nella posizione corretta
        if (fs.existsSync(expectedDngPath)) {
          const stats = fs.statSync(expectedDngPath);
          console.log(`   🎉 DNG conversion successful!`);
          console.log(`      📄 File: ${expectedDngPath}`);
          console.log(`      📏 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          resolve();
        } else {
          reject(new Error(`Final verification failed: ${expectedDngPath} not found after move`));
        }
      });
    });
  }

  /**
   * Ottiene statistiche di performance della libreria nativa
   * @returns Statistiche dettagliate sui metodi di estrazione
   */
  getNativePreviewStats() {
    return {
      ...rawPreviewExtractor.getStats(),
      capabilities: rawPreviewExtractor.getCapabilities()
    };
  }

  /**
   * Resetta le statistiche di performance
   */
  resetNativePreviewStats(): void {
    rawPreviewExtractor.resetStats();
  }

  /**
   * Esegue un benchmark di performance tra metodi nativi e dcraw
   * @param testFiles Array di file RAW per il test
   * @param iterations Numero di iterazioni per test (default: 3)
   */
  async benchmarkPreviewMethods(testFiles: string[], iterations: number = 3) {
    return await rawPreviewExtractor.runBenchmark(testFiles, iterations);
  }

  /**
   * Verifica se un file è in formato RAW
   * @param filePath Percorso al file da verificare
   * @returns true se il file ha un'estensione RAW supportata
   */
  static isRawFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const rawExtensions = [
      '.nef', '.arw', '.cr2', '.cr3', '.orf', '.rw2', 
      '.raf', '.dng', '.pef', '.srw', '.3fr', '.mef'
    ];
    
    return rawExtensions.includes(ext);
  }

  /**
   * Ottiene tutte le estensioni RAW supportate
   * @returns Array di estensioni RAW supportate (con punto iniziale)
   */
  static getSupportedRawExtensions(): string[] {
    return [
      '.nef', '.arw', '.cr2', '.cr3', '.orf', '.rw2', 
      '.raf', '.dng', '.pef', '.srw', '.3fr', '.mef'
    ];
  }
}

// Esporta un'istanza singleton per uso semplificato
export const rawConverter = new RawConverter();
