import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

export interface TempFile {
  id: string;
  path: string;
  type: 'dng' | 'jpeg' | 'other';
  createdAt: number;
  sizeBytes?: number;
  associatedFiles?: string[]; // Altri file collegati da pulire insieme
}

export interface CleanupStats {
  filesTracked: number;
  filesDeleted: number;
  bytesFreed: number;
  errorsCount: number;
  lastCleanupAt: number;
}

/**
 * Gestisce la pulizia automatica dei file temporanei della pipeline
 */
export class CleanupManager extends EventEmitter {
  private tempFiles: Map<string, TempFile> = new Map();
  private stats: CleanupStats = {
    filesTracked: 0,
    filesDeleted: 0,
    bytesFreed: 0,
    errorsCount: 0,
    lastCleanupAt: 0
  };
  private tempDirectory: string;
  private isShuttingDown: boolean = false;

  constructor() {
    super();

    // Usa la directory unificata ~/.racetagger-temp/ per tutti i file temporanei
    this.tempDirectory = path.join(os.homedir(), '.racetagger-temp');
    this.ensureTempDirectory();

    // Cleanup automatico su exit del processo
    process.on('exit', () => this.emergencyCleanup());
    process.on('SIGINT', () => this.emergencyCleanup());
    process.on('SIGTERM', () => this.emergencyCleanup());
  }

  /**
   * Assicura che la directory temporanea esista
   */
  private async ensureTempDirectory(): Promise<void> {
    try {
      await fsPromises.mkdir(this.tempDirectory, { recursive: true });
    } catch (error: any) {
      console.error('[CleanupManager] Error creating temp directory:', error);
      throw new Error(`Failed to create temp directory: ${error.message}`);
    }
  }

  /**
   * Genera un nome file unico per la directory temporanea
   * @param originalPath Percorso del file originale
   * @param suffix Suffisso da aggiungere al nome file
   * @param extension Estensione file (opzionale)
   * @param subdir Sottodirectory per organizzare i file (jpeg-processing, compressed, etc.)
   */
  generateTempPath(originalPath: string, suffix: string = '', extension?: string, subdir?: string): string {
    const originalName = path.basename(originalPath, path.extname(originalPath));
    const ext = extension || path.extname(originalPath);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    const tempFileName = `${originalName}_${suffix}_${timestamp}_${random}${ext}`;

    // Se specificata una sottodirectory, la crea
    if (subdir) {
      const subdirPath = path.join(this.tempDirectory, subdir);
      try {
        if (!fs.existsSync(subdirPath)) {
          fs.mkdirSync(subdirPath, { recursive: true });
        }
      } catch (error) {
        return path.join(this.tempDirectory, tempFileName);
      }
      return path.join(subdirPath, tempFileName);
    }

    return path.join(this.tempDirectory, tempFileName);
  }

  /**
   * Registra un file temporaneo per il tracking
   */
  async trackTempFile(
    filePath: string,
    type: TempFile['type'] = 'other',
    associatedFiles: string[] = []
  ): Promise<string> {
    const fileId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    let sizeBytes: number | undefined;
    try {
      const stat = await fsPromises.stat(filePath);
      sizeBytes = stat.size;
    } catch (error) {
      // File potrebbe non esistere ancora, non è un errore critico
    }

    const tempFile: TempFile = {
      id: fileId,
      path: filePath,
      type,
      createdAt: Date.now(),
      sizeBytes,
      associatedFiles
    };

    this.tempFiles.set(fileId, tempFile);
    this.stats.filesTracked++;

    this.emit('file-tracked', tempFile);
    return fileId;
  }

  /**
   * Pulisce immediatamente un file specifico e i suoi file associati
   */
  async cleanupFile(fileId: string): Promise<void> {
    const tempFile = this.tempFiles.get(fileId);
    if (!tempFile) {
      return;
    }

    let totalBytesFreed = 0;
    let filesDeleted = 0;
    const errors: string[] = [];

    // Lista di tutti i file da eliminare
    const filesToDelete = [tempFile.path, ...(tempFile.associatedFiles || [])];

    for (const filePath of filesToDelete) {
      try {
        // Verifica che il file esista prima di tentare l'eliminazione
        const exists = await this.fileExists(filePath);
        if (!exists) {
          continue;
        }

        // Ottieni dimensione prima della cancellazione
        const stat = await fsPromises.stat(filePath);
        const fileSize = stat.size;

        // Elimina il file
        await fsPromises.unlink(filePath);

        totalBytesFreed += fileSize;
        filesDeleted++;

      } catch (error: any) {
        const errorMsg = `Failed to delete ${path.basename(filePath)}: ${error.message}`;
        errors.push(errorMsg);
        console.error(`[CleanupManager] ${errorMsg}`);
        this.stats.errorsCount++;
      }
    }

    // Aggiorna statistiche
    this.stats.filesDeleted += filesDeleted;
    this.stats.bytesFreed += totalBytesFreed;
    this.stats.lastCleanupAt = Date.now();

    // Rimuovi dal tracking
    this.tempFiles.delete(fileId);

    // Emetti evento con risultati
    this.emit('file-cleaned', {
      fileId,
      tempFile,
      filesDeleted,
      bytesFreed: totalBytesFreed,
      errors
    });

    if (errors.length > 0) {
      this.emit('cleanup-errors', { fileId, errors });
    }
  }

  /**
   * Pulisce tutti i file temporanei tracciati
   */
  async cleanupAll(): Promise<void> {
    const fileIds = Array.from(this.tempFiles.keys());
    let totalCleaned = 0;

    for (const fileId of fileIds) {
      if (this.isShuttingDown) {
        break;
      }

      try {
        await this.cleanupFile(fileId);
        totalCleaned++;
      } catch (error: any) {
        console.error(`[CleanupManager] Error during cleanup of ${fileId}:`, error);
      }
    }

    this.emit('bulk-cleanup-complete', { totalCleaned, totalFiles: fileIds.length });
  }

  /**
   * Pulisce file temporanei orfani nella directory e sottodirectory (non tracciati)
   * @param olderThanMinutes Pulisce file più vecchi di X minuti (default: 60)
   */
  async cleanupOrphans(olderThanMinutes: number = 60): Promise<void> {
    try {
      const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);

      let orphansFound = 0;
      let orphansDeleted = 0;
      let bytesFreed = 0;

      // Funzione ricorsiva per pulire directory e sottodirectory
      const cleanDirectory = async (dirPath: string): Promise<void> => {
        let entries: string[];
        try {
          entries = await fsPromises.readdir(dirPath);
        } catch (error) {
          return; // Directory non accessibile, skip
        }

        for (const entryName of entries) {
          const entryPath = path.join(dirPath, entryName);

          try {
            const stat = await fsPromises.stat(entryPath);

            // Se è una directory, puliscila ricorsivamente
            if (stat.isDirectory()) {
              await cleanDirectory(entryPath);

              // Dopo la pulizia, rimuovi la directory se vuota
              try {
                const remainingFiles = await fsPromises.readdir(entryPath);
                if (remainingFiles.length === 0) {
                  await fsPromises.rmdir(entryPath);
                }
              } catch {
                // Directory non vuota o errore, ignora
              }
              continue;
            }

            // Skip se il file è più recente del cutoff
            if (stat.mtime.getTime() > cutoffTime) {
              continue;
            }

            // Skip se il file è attualmente tracciato
            const isTracked = Array.from(this.tempFiles.values()).some(tf =>
              tf.path === entryPath || (tf.associatedFiles && tf.associatedFiles.includes(entryPath))
            );

            if (isTracked) {
              continue;
            }

            orphansFound++;

            // Elimina file orfano
            await fsPromises.unlink(entryPath);
            orphansDeleted++;
            bytesFreed += stat.size;

          } catch (error: any) {
            // Ignora errori su singoli file
          }
        }
      };

      // Pulisci ricorsivamente dalla directory principale
      await cleanDirectory(this.tempDirectory);

      this.emit('orphan-cleanup-complete', {
        orphansFound,
        orphansDeleted,
        bytesFreed
      });

    } catch (error: any) {
      console.error('[CleanupManager] Error during orphan cleanup:', error);
      this.emit('cleanup-error', error);
    }
  }

  /**
   * Verifica se un file esiste
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ottiene le statistiche correnti
   */
  getStats(): CleanupStats {
    return { ...this.stats };
  }

  /**
   * Ottiene la lista dei file attualmente tracciati
   */
  getTrackedFiles(): TempFile[] {
    return Array.from(this.tempFiles.values());
  }

  /**
   * Ottiene informazioni su un file specifico
   */
  getFileInfo(fileId: string): TempFile | undefined {
    return this.tempFiles.get(fileId);
  }

  /**
   * Cleanup di emergenza (chiamato su exit del processo)
   */
  private emergencyCleanup(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Cleanup sincrono per velocità
    const trackedFiles = Array.from(this.tempFiles.values());
    let emergencyDeleted = 0;

    for (const tempFile of trackedFiles) {
      const allFiles = [tempFile.path, ...(tempFile.associatedFiles || [])];

      for (const filePath of allFiles) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            emergencyDeleted++;
          }
        } catch (error) {
          console.error(`[CleanupManager] Emergency cleanup failed for ${path.basename(filePath)}`);
        }
      }
    }
  }

  /**
   * Shutdown pulito del cleanup manager
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Pulisci tutti i file tracciati
    await this.cleanupAll();

    // Pulisci file orfani
    await this.cleanupOrphans(0); // Pulisci tutto

    // Rimuovi tutti gli event listeners
    this.removeAllListeners();
  }

  /**
   * Ottiene la directory temporanea utilizzata
   */
  getTempDirectory(): string {
    return this.tempDirectory;
  }

  /**
   * Startup cleanup - remove temp files older than 7 days
   */
  async startupCleanup(): Promise<void> {
    try {
      // Clean up all tracked files (should be empty at startup)
      await this.cleanupAll();

      // Clean up orphan files older than 7 days (7 * 24 * 60 = 10080 minutes)
      const SEVEN_DAYS_IN_MINUTES = 7 * 24 * 60;
      await this.cleanupOrphans(SEVEN_DAYS_IN_MINUTES);
    } catch (error) {
      console.error('[CleanupManager] Error during startup cleanup:', error);
    }
  }

  private periodicCleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Avvia la pulizia periodica dei file temporanei (ogni 24 ore)
   * Pulisce file più vecchi di 7 giorni
   */
  startPeriodicCleanup(): void {
    // Evita timer duplicati
    if (this.periodicCleanupTimer) {
      return;
    }

    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const SEVEN_DAYS_IN_MINUTES = 7 * 24 * 60;

    this.periodicCleanupTimer = setInterval(async () => {
      try {
        await this.cleanupOrphans(SEVEN_DAYS_IN_MINUTES);
      } catch (error) {
        console.error('[CleanupManager] Periodic cleanup error:', error);
      }
    }, TWENTY_FOUR_HOURS_MS);

    // Non bloccare la chiusura dell'app
    this.periodicCleanupTimer.unref();
  }

  /**
   * Ferma la pulizia periodica
   */
  stopPeriodicCleanup(): void {
    if (this.periodicCleanupTimer) {
      clearInterval(this.periodicCleanupTimer);
      this.periodicCleanupTimer = null;
    }
  }
}
