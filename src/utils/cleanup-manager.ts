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

    console.log(`[CleanupManager] Initialized with temp directory: ${this.tempDirectory}`);

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
        console.warn(`[CleanupManager] Cannot create subdir ${subdir}, using main temp directory`);
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
      console.warn(`[CleanupManager] Could not get size for ${filePath}`);
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

    console.log(`[CleanupManager] Tracking temp file: ${path.basename(filePath)} (${type}, ID: ${fileId})`);
    
    this.emit('file-tracked', tempFile);
    return fileId;
  }

  /**
   * Pulisce immediatamente un file specifico e i suoi file associati
   */
  async cleanupFile(fileId: string): Promise<void> {
    const tempFile = this.tempFiles.get(fileId);
    if (!tempFile) {
      console.warn(`[CleanupManager] File ID ${fileId} not found for cleanup`);
      return;
    }

    console.log(`[CleanupManager] Cleaning up file: ${path.basename(tempFile.path)} (${tempFile.type})`);

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
          console.log(`[CleanupManager] File already deleted: ${path.basename(filePath)}`);
          continue;
        }

        // Ottieni dimensione prima della cancellazione
        const stat = await fsPromises.stat(filePath);
        const fileSize = stat.size;

        // Elimina il file
        await fsPromises.unlink(filePath);
        
        totalBytesFreed += fileSize;
        filesDeleted++;
        
        console.log(`[CleanupManager] Deleted: ${path.basename(filePath)} (${Math.round(fileSize / 1024 / 1024 * 100) / 100}MB)`);
        
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

    console.log(`[CleanupManager] Cleanup completed for ${fileId}: ${filesDeleted} files, ${Math.round(totalBytesFreed / 1024 / 1024 * 100) / 100}MB freed`);
  }

  /**
   * Pulisce tutti i file temporanei tracciati
   */
  async cleanupAll(): Promise<void> {
    console.log(`[CleanupManager] Starting cleanup of ${this.tempFiles.size} tracked files`);

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

    console.log(`[CleanupManager] Bulk cleanup completed: ${totalCleaned}/${fileIds.length} files processed`);
    this.emit('bulk-cleanup-complete', { totalCleaned, totalFiles: fileIds.length });
  }

  /**
   * Pulisce file temporanei orfani nella directory (non tracciati)
   */
  async cleanupOrphans(olderThanMinutes: number = 60): Promise<void> {
    console.log(`[CleanupManager] Cleaning up orphan files older than ${olderThanMinutes} minutes`);

    try {
      const files = await fsPromises.readdir(this.tempDirectory);
      const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
      
      let orphansFound = 0;
      let orphansDeleted = 0;
      let bytesFreed = 0;

      for (const fileName of files) {
        const filePath = path.join(this.tempDirectory, fileName);
        
        try {
          const stat = await fsPromises.stat(filePath);
          
          // Skip se il file è più recente del cutoff
          if (stat.mtime.getTime() > cutoffTime) {
            continue;
          }

          // Skip se il file è attualmente tracciato
          const isTracked = Array.from(this.tempFiles.values()).some(tf => 
            tf.path === filePath || (tf.associatedFiles && tf.associatedFiles.includes(filePath))
          );
          
          if (isTracked) {
            continue;
          }

          orphansFound++;
          
          // Elimina file orfano
          await fsPromises.unlink(filePath);
          orphansDeleted++;
          bytesFreed += stat.size;
          
          console.log(`[CleanupManager] Deleted orphan: ${fileName} (${Math.round(stat.size / 1024 / 1024 * 100) / 100}MB)`);
          
        } catch (error: any) {
          console.error(`[CleanupManager] Error processing orphan ${fileName}:`, error);
        }
      }

      console.log(`[CleanupManager] Orphan cleanup completed: ${orphansDeleted}/${orphansFound} deleted, ${Math.round(bytesFreed / 1024 / 1024 * 100) / 100}MB freed`);
      
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
    console.log('[CleanupManager] Emergency cleanup starting...');

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
            console.log(`[CleanupManager] Emergency deleted: ${path.basename(filePath)}`);
          }
        } catch (error) {
          console.error(`[CleanupManager] Emergency cleanup failed for ${path.basename(filePath)}`);
        }
      }
    }

    console.log(`[CleanupManager] Emergency cleanup completed: ${emergencyDeleted} files deleted`);
  }

  /**
   * Shutdown pulito del cleanup manager
   */
  async shutdown(): Promise<void> {
    console.log('[CleanupManager] Starting shutdown...');
    
    this.isShuttingDown = true;
    
    // Pulisci tutti i file tracciati
    await this.cleanupAll();
    
    // Pulisci file orfani
    await this.cleanupOrphans(0); // Pulisci tutto
    
    // Rimuovi tutti gli event listeners
    this.removeAllListeners();
    
    console.log('[CleanupManager] Shutdown completed');
  }

  /**
   * Ottiene la directory temporanea utilizzata
   */
  getTempDirectory(): string {
    return this.tempDirectory;
  }

  /**
   * Startup cleanup - remove all temp files from previous sessions
   */
  async startupCleanup(): Promise<void> {
    console.log('[CleanupManager] Performing startup cleanup of temporary files...');

    try {
      // Clean up all tracked files (should be empty at startup)
      await this.cleanupAll();

      // Clean up all orphan files (don't wait for age)
      await this.cleanupOrphans(0);

      console.log('[CleanupManager] Startup cleanup completed');
    } catch (error) {
      console.error('[CleanupManager] Error during startup cleanup:', error);
    }
  }
}