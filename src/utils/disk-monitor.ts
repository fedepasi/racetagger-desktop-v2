import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface DiskSpaceInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  freeGB: number;
  totalGB: number;
  usedPercent: number;
}

export interface DiskMonitorConfig {
  minFreeSpaceGB: number;
  checkIntervalMs?: number;
  alertThresholdGB?: number;
}

/**
 * Monitora lo spazio disco disponibile e notifica quando scende sotto soglie critiche
 */
export class DiskSpaceMonitor extends EventEmitter {
  private config: Required<DiskMonitorConfig>;
  private isMonitoring: boolean = false;
  private monitorInterval?: NodeJS.Timeout;
  private lastCheck?: DiskSpaceInfo;
  private tempDirectory: string;

  constructor(config: DiskMonitorConfig) {
    super();
    this.config = {
      minFreeSpaceGB: config.minFreeSpaceGB,
      checkIntervalMs: config.checkIntervalMs || 5000, // Default 5 secondi
      alertThresholdGB: config.alertThresholdGB || config.minFreeSpaceGB * 1.5
    };

    // Usa la directory temporanea del sistema per monitorare lo spazio
    this.tempDirectory = os.tmpdir();
    console.log(`[DiskMonitor] Monitoring disk space for: ${this.tempDirectory}`);
    console.log(`[DiskMonitor] Min free space threshold: ${this.config.minFreeSpaceGB}GB`);
    console.log(`[DiskMonitor] Alert threshold: ${this.config.alertThresholdGB}GB`);
  }

  /**
   * Ottiene informazioni sullo spazio disco corrente
   */
  async getDiskSpace(): Promise<DiskSpaceInfo> {
    try {
      const stats = await fsPromises.statfs(this.tempDirectory);
      
      const totalBytes = stats.bavail * stats.bsize; // Spazio totale disponibile per utenti non-root
      const freeBytes = stats.bavail * stats.bsize;  // Spazio libero disponibile
      const usedBytes = (stats.blocks - stats.bavail) * stats.bsize;
      
      const freeGB = freeBytes / (1024 ** 3);
      const totalGB = totalBytes / (1024 ** 3);
      const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

      const diskInfo: DiskSpaceInfo = {
        totalBytes,
        freeBytes,
        usedBytes,
        freeGB: Math.round(freeGB * 100) / 100,
        totalGB: Math.round(totalGB * 100) / 100,
        usedPercent: Math.round(usedPercent * 100) / 100
      };

      this.lastCheck = diskInfo;
      return diskInfo;
    } catch (error: any) {
      console.error('[DiskMonitor] Error getting disk space:', error);
      throw new Error(`Failed to get disk space information: ${error.message}`);
    }
  }

  /**
   * Verifica se c'è spazio sufficiente per continuare il processing
   */
  async hasSufficientSpace(): Promise<boolean> {
    try {
      const diskSpace = await this.getDiskSpace();
      return diskSpace.freeGB >= this.config.minFreeSpaceGB;
    } catch (error) {
      // In caso di errore, assumiamo che non ci sia spazio sufficiente per sicurezza
      console.error('[DiskMonitor] Error checking space, assuming insufficient space');
      return false;
    }
  }

  /**
   * Stima lo spazio necessario per N conversioni RAW
   */
  estimateSpaceNeeded(numRawFiles: number, avgRawSizeMB: number = 25): number {
    // Stima conservativa:
    // - Ogni RAW genera un DNG di dimensione simile (25-50MB)
    // - Ogni DNG genera un JPEG temporaneo (2-5MB)
    // - Margine di sicurezza del 20%
    
    const dngSpaceMB = numRawFiles * avgRawSizeMB;
    const jpegSpaceMB = numRawFiles * 3; // JPEG temporanei circa 3MB
    const totalMB = (dngSpaceMB + jpegSpaceMB) * 1.2; // +20% sicurezza
    
    return totalMB / 1024; // Ritorna in GB
  }

  /**
   * Avvia il monitoring continuo dello spazio disco
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      console.warn('[DiskMonitor] Monitoring already started');
      return;
    }

    this.isMonitoring = true;
    console.log(`[DiskMonitor] Starting disk space monitoring (interval: ${this.config.checkIntervalMs}ms)`);

    // Check iniziale
    this.performCheck();

    // Avvia check periodici
    this.monitorInterval = setInterval(() => {
      this.performCheck();
    }, this.config.checkIntervalMs);
  }

  /**
   * Ferma il monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    console.log('[DiskMonitor] Disk space monitoring stopped');
  }

  /**
   * Esegue un check del disco e emette eventi appropriati
   */
  private async performCheck(): Promise<void> {
    try {
      const diskSpace = await this.getDiskSpace();

      // Emetti sempre l'evento di aggiornamento
      this.emit('space-updated', diskSpace);

      // Check soglia critica (pausa processing)
      if (diskSpace.freeGB < this.config.minFreeSpaceGB) {
        this.emit('space-critical', {
          current: diskSpace.freeGB,
          required: this.config.minFreeSpaceGB,
          diskSpace
        });
      } else if (diskSpace.freeGB >= this.config.minFreeSpaceGB) {
        // Spazio tornato disponibile
        this.emit('space-available', diskSpace);
      }

      // Check soglia di alert (warning ma continua)
      if (diskSpace.freeGB < this.config.alertThresholdGB && diskSpace.freeGB >= this.config.minFreeSpaceGB) {
        this.emit('space-warning', {
          current: diskSpace.freeGB,
          threshold: this.config.alertThresholdGB,
          diskSpace
        });
      }

    } catch (error: any) {
      this.emit('monitor-error', error);
    }
  }

  /**
   * Ottiene l'ultima informazione del disco (senza fare un nuovo check)
   */
  getLastKnownSpace(): DiskSpaceInfo | null {
    return this.lastCheck || null;
  }

  /**
   * Cambia la configurazione del monitor
   */
  updateConfig(newConfig: Partial<DiskMonitorConfig>): void {
    if (newConfig.minFreeSpaceGB !== undefined) {
      this.config.minFreeSpaceGB = newConfig.minFreeSpaceGB;
    }
    if (newConfig.checkIntervalMs !== undefined) {
      this.config.checkIntervalMs = newConfig.checkIntervalMs;
    }
    if (newConfig.alertThresholdGB !== undefined) {
      this.config.alertThresholdGB = newConfig.alertThresholdGB;
    }

    console.log('[DiskMonitor] Configuration updated:', this.config);

    // Riavvia il monitoring se era attivo
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }

  /**
   * Pulisce le risorse
   */
  async shutdown(): Promise<void> {
    this.stopMonitoring();
    this.removeAllListeners();
    console.log('[DiskMonitor] Shutdown completed');
  }
}

/**
 * Utility per ottenere rapidamente lo spazio disco senza istanziare il monitor
 */
export async function getQuickDiskSpace(): Promise<DiskSpaceInfo> {
  const tempMonitor = new DiskSpaceMonitor({ minFreeSpaceGB: 1 });
  try {
    return await tempMonitor.getDiskSpace();
  } finally {
    await tempMonitor.shutdown();
  }
}