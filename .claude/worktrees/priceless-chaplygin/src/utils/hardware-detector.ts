/**
 * Hardware Detection Utility
 * Detects CPU, RAM, GPU, and disk information for telemetry and debugging
 *
 * BACKWARD COMPATIBLE: All methods have fallbacks and won't throw errors
 */

import * as os from 'os';
import * as fs from 'fs';
import { app } from 'electron';

export interface HardwareInfo {
  cpu_model: string;
  cpu_cores: number;
  cpu_threads: number;
  ram_total_gb: number;
  ram_available_gb: number;
  arch_detail: string;
  gpu_model?: string;
  disk_type: 'SSD' | 'HDD' | 'Unknown';
  disk_available_gb: number;
  disk_total_gb: number;
}

/**
 * Hardware Detector Class
 * All methods are safe and have fallback values
 */
export class HardwareDetector {
  private cachedInfo: HardwareInfo | null = null;

  /**
   * Get complete hardware information (cached after first call)
   */
  async getHardwareInfo(): Promise<HardwareInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    try {
      const cpuModel = this.detectCPUModel();
      const cpuCores = this.detectCPUCores();
      const ramInfo = this.detectRAM();
      const archDetail = this.detectArchDetail();
      const gpuModel = await this.detectGPU();
      const diskType = await this.detectDiskType();
      const diskInfo = await this.detectDiskSpace();

      this.cachedInfo = {
        cpu_model: cpuModel,
        cpu_cores: cpuCores.physical,
        cpu_threads: cpuCores.logical,
        ram_total_gb: ramInfo.total,
        ram_available_gb: ramInfo.available,
        arch_detail: archDetail,
        gpu_model: gpuModel,
        disk_type: diskType,
        disk_available_gb: diskInfo.available,
        disk_total_gb: diskInfo.total
      };

      console.log('[HardwareDetector] Hardware info collected:', {
        cpu: cpuModel,
        cores: cpuCores.physical,
        ram: `${ramInfo.total}GB`,
        disk: `${diskType} (${diskInfo.available}GB free)`,
        arch: archDetail
      });

      return this.cachedInfo;
    } catch (error) {
      console.warn('[HardwareDetector] Failed to collect hardware info, using fallback:', error);
      return this.getFallbackInfo();
    }
  }

  /**
   * Detect CPU model with detailed info for Mac M-series detection
   */
  private detectCPUModel(): string {
    try {
      const cpus = os.cpus();
      if (cpus.length === 0) {
        return 'Unknown CPU';
      }

      let model = cpus[0].model;

      // Enhanced detection for Apple Silicon
      if (os.platform() === 'darwin' && os.arch() === 'arm64') {
        // Try to detect M1/M2/M3 series
        if (model.includes('Apple')) {
          // Model string might be "Apple M1" or similar
          return model;
        } else {
          // Fallback: detect based on core count
          const coreCount = cpus.length;
          if (coreCount === 8) {
            return 'Apple M1 (8-core)';
          } else if (coreCount === 10) {
            return 'Apple M2 Pro (10-core)';
          } else if (coreCount === 12) {
            return 'Apple M2 Max (12-core)';
          } else {
            return `Apple Silicon (${coreCount}-core)`;
          }
        }
      }

      // Clean up Intel/AMD model names
      model = model.replace(/\s+/g, ' ').trim();

      return model;
    } catch (error) {
      console.warn('[HardwareDetector] Failed to detect CPU model:', error);
      return 'Unknown CPU';
    }
  }

  /**
   * Detect physical and logical CPU cores
   */
  private detectCPUCores(): { physical: number; logical: number } {
    try {
      const cpus = os.cpus();
      const logical = cpus.length;

      // Physical cores are harder to detect, use logical as fallback
      // For most modern CPUs: physical = logical / 2 (hyperthreading)
      // For Apple Silicon: physical = logical (no hyperthreading)
      let physical = logical;

      if (os.platform() === 'darwin' && os.arch() === 'arm64') {
        // Apple Silicon doesn't use hyperthreading
        physical = logical;
      } else if (os.platform() === 'win32') {
        // On Windows, assume hyperthreading (2 threads per core)
        physical = Math.ceil(logical / 2);
      } else {
        // Linux/other: try to read from /proc/cpuinfo or assume HT
        physical = Math.ceil(logical / 2);
      }

      return { physical, logical };
    } catch (error) {
      console.warn('[HardwareDetector] Failed to detect CPU cores:', error);
      return { physical: 1, logical: 1 };
    }
  }

  /**
   * Detect RAM total and available
   */
  private detectRAM(): { total: number; available: number } {
    try {
      const totalBytes = os.totalmem();
      const freeBytes = os.freemem();

      return {
        total: Math.round(totalBytes / (1024 ** 3)), // Convert to GB
        available: Math.round(freeBytes / (1024 ** 3))
      };
    } catch (error) {
      console.warn('[HardwareDetector] Failed to detect RAM:', error);
      return { total: 0, available: 0 };
    }
  }

  /**
   * Detect detailed architecture info (useful for Mac M1/M2/M3 distinction)
   */
  private detectArchDetail(): string {
    try {
      const platform = os.platform();
      const arch = os.arch();
      const release = os.release();

      if (platform === 'darwin') {
        if (arch === 'arm64') {
          return `macOS ARM64 (Apple Silicon) - ${release}`;
        } else {
          return `macOS x64 (Intel) - ${release}`;
        }
      } else if (platform === 'win32') {
        return `Windows ${arch} - ${release}`;
      } else if (platform === 'linux') {
        return `Linux ${arch} - ${release}`;
      } else {
        return `${platform} ${arch}`;
      }
    } catch (error) {
      console.warn('[HardwareDetector] Failed to detect arch detail:', error);
      return 'Unknown';
    }
  }

  /**
   * Detect GPU model (Electron API)
   */
  private async detectGPU(): Promise<string | undefined> {
    try {
      // Electron's app.getGPUInfo() is only available on some platforms
      if (typeof app.getGPUInfo === 'function') {
        const gpuInfo: any = await app.getGPUInfo('basic');

        // Extract GPU model from gpuDevice array
        if (gpuInfo && gpuInfo.gpuDevice && Array.isArray(gpuInfo.gpuDevice) && gpuInfo.gpuDevice.length > 0) {
          const gpu = gpuInfo.gpuDevice[0];
          return `${gpu.vendorString || 'Unknown'} ${gpu.deviceString || ''}`.trim();
        }
      }

      return undefined;
    } catch (error) {
      // GPU detection is optional, fail silently
      return undefined;
    }
  }

  /**
   * Detect disk type (SSD vs HDD) based on access time
   * This is a heuristic: SSDs have much faster access times
   */
  private async detectDiskType(): Promise<'SSD' | 'HDD' | 'Unknown'> {
    try {
      const userDataPath = app.getPath('userData');

      // Create a small test file and measure access time
      const testFilePath = `${userDataPath}/.disk-speed-test-${Date.now()}.tmp`;

      const start = process.hrtime.bigint();

      // Write test file
      await fs.promises.writeFile(testFilePath, 'test', 'utf8');

      // Read test file
      await fs.promises.readFile(testFilePath, 'utf8');

      const end = process.hrtime.bigint();
      const durationNs = Number(end - start);
      const durationMs = durationNs / 1_000_000;

      // Clean up
      try {
        await fs.promises.unlink(testFilePath);
      } catch (e) {
        // Ignore cleanup errors
      }

      // Heuristic: SSD access < 5ms, HDD access > 10ms
      if (durationMs < 5) {
        return 'SSD';
      } else if (durationMs > 10) {
        return 'HDD';
      } else {
        return 'Unknown';
      }
    } catch (error) {
      // Fail silently, disk type is optional
      return 'Unknown';
    }
  }

  /**
   * Detect disk space (available and total)
   */
  private async detectDiskSpace(): Promise<{ available: number; total: number }> {
    try {
      const userDataPath = app.getPath('userData');

      // Use fs.statfs to get disk space info (Node 18+)
      // Fallback for older Node versions: use platform-specific commands
      if (typeof fs.statfs === 'function') {
        const stats = await fs.promises.statfs(userDataPath);

        // Calculate GB from blocks
        const blockSize = stats.bsize || 4096;
        const totalBlocks = stats.blocks;
        const availableBlocks = stats.bavail;

        const totalBytes = totalBlocks * blockSize;
        const availableBytes = availableBlocks * blockSize;

        return {
          total: Math.round(totalBytes / (1024 ** 3)),
          available: Math.round(availableBytes / (1024 ** 3))
        };
      } else {
        // Fallback: return unknown
        return { total: 0, available: 0 };
      }
    } catch (error) {
      console.warn('[HardwareDetector] Failed to detect disk space:', error);
      return { total: 0, available: 0 };
    }
  }

  /**
   * Get fallback hardware info when detection fails
   */
  private getFallbackInfo(): HardwareInfo {
    return {
      cpu_model: 'Unknown CPU',
      cpu_cores: 1,
      cpu_threads: 1,
      ram_total_gb: 0,
      ram_available_gb: 0,
      arch_detail: `${os.platform()} ${os.arch()}`,
      gpu_model: undefined,
      disk_type: 'Unknown',
      disk_available_gb: 0,
      disk_total_gb: 0
    };
  }

  /**
   * Reset cached info (useful for testing)
   */
  reset(): void {
    this.cachedInfo = null;
  }
}

/**
 * Singleton instance for easy access
 */
export const hardwareDetector = new HardwareDetector();
