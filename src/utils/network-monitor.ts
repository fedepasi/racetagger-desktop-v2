/**
 * Network Performance Monitor
 * Measures upload speed, latency, and tracks upload success rates
 *
 * BACKWARD COMPATIBLE: All methods have timeouts and fallbacks
 */

import { getSupabaseClient } from '../database-service';
import * as os from 'os';

export interface NetworkMetrics {
  network_type?: 'WiFi' | 'Ethernet' | 'Cellular' | 'Unknown';
  upload_speed_mbps?: number;
  supabase_latency_ms?: number;
  upload_retries: number;
  upload_failures: number;
  upload_success_count: number;
  upload_success_rate: number;
  average_upload_time_ms: number;
}

/**
 * Network Monitor Class
 * Tracks network performance and upload statistics
 */
export class NetworkMonitor {
  private uploadAttempts: Array<{ success: boolean; durationMs: number; fileSizeBytes?: number }> = [];
  private uploadRetries = 0;
  private uploadFailures = 0;
  private uploadSuccesses = 0;

  /**
   * Measure initial network metrics (latency only)
   * Upload speed will be calculated from real image uploads
   *
   * @param timeout Maximum time to wait for measurements (ms)
   */
  async measureInitialMetrics(timeout: number = 5000): Promise<Partial<NetworkMetrics>> {
    const metrics: Partial<NetworkMetrics> = {
      network_type: this.detectNetworkType(),
      upload_retries: 0,
      upload_failures: 0,
      upload_success_count: 0,
      upload_success_rate: 0,
      average_upload_time_ms: 0
    };

    try {
      // Measure latency with timeout
      const latencyPromise = this.measureLatency();
      const latency = await Promise.race([
        latencyPromise,
        this.timeoutPromise(timeout, undefined)
      ]);

      if (latency !== undefined) {
        metrics.supabase_latency_ms = latency;
      }

      console.log('[NetworkMonitor] Initial metrics collected (upload speed will be calculated from real uploads):', metrics);
    } catch (error) {
      console.warn('[NetworkMonitor] Failed to measure initial metrics, using partial data:', error);
    }

    return metrics;
  }

  /**
   * Measure latency to Supabase with HEAD request
   */
  private async measureLatency(): Promise<number | undefined> {
    try {
      const supabase = getSupabaseClient();
      const startTime = Date.now();

      // Use a lightweight HEAD request to Supabase Storage
      // This measures network round-trip time
      const { error } = await supabase.storage
        .from('analysis-logs')
        .list('', { limit: 1 }); // Minimal request

      const endTime = Date.now();
      const latency = endTime - startTime;

      if (error) {
        console.warn('[NetworkMonitor] Latency test failed:', error.message);
        return undefined;
      }

      return latency;
    } catch (error) {
      console.warn('[NetworkMonitor] Failed to measure latency:', error);
      return undefined;
    }
  }


  /**
   * Detect network type (WiFi, Ethernet, etc.)
   */
  private detectNetworkType(): 'WiFi' | 'Ethernet' | 'Cellular' | 'Unknown' {
    try {
      const interfaces = os.networkInterfaces();
      const interfaceNames = Object.keys(interfaces);

      // Check for Ethernet first (higher priority)
      const hasEthernet = interfaceNames.some(name =>
        name.toLowerCase().includes('eth') ||
        name.toLowerCase().includes('en0') && !name.toLowerCase().includes('wi')
      );

      if (hasEthernet) {
        return 'Ethernet';
      }

      // Check for WiFi
      const hasWiFi = interfaceNames.some(name =>
        name.toLowerCase().includes('wi') ||
        name.toLowerCase().includes('wlan') ||
        name.toLowerCase().includes('en1')
      );

      if (hasWiFi) {
        return 'WiFi';
      }

      // Check for cellular/mobile
      const hasCellular = interfaceNames.some(name =>
        name.toLowerCase().includes('wwan') ||
        name.toLowerCase().includes('pdp') ||
        name.toLowerCase().includes('cellular')
      );

      if (hasCellular) {
        return 'Cellular';
      }

      return 'Unknown';
    } catch (error) {
      console.warn('[NetworkMonitor] Failed to detect network type:', error);
      return 'Unknown';
    }
  }

  /**
   * Record an upload attempt (success or failure)
   * @param success Whether the upload succeeded
   * @param durationMs Duration of upload in milliseconds
   * @param fileSizeBytes Size of file in bytes (optional, used to calculate speed)
   */
  recordUploadAttempt(success: boolean, durationMs: number, fileSizeBytes?: number): void {
    this.uploadAttempts.push({ success, durationMs, fileSizeBytes });

    if (success) {
      this.uploadSuccesses++;
    } else {
      this.uploadFailures++;
    }
  }

  /**
   * Record a retry attempt (when an upload is retried)
   */
  recordRetry(): void {
    this.uploadRetries++;
  }

  /**
   * Get current network metrics
   */
  getMetrics(): NetworkMetrics {
    const totalAttempts = this.uploadAttempts.length;
    const successfulUploads = this.uploadAttempts.filter(a => a.success);

    const averageUploadTime = successfulUploads.length > 0
      ? successfulUploads.reduce((sum, a) => sum + a.durationMs, 0) / successfulUploads.length
      : 0;

    const successRate = totalAttempts > 0
      ? (this.uploadSuccesses / totalAttempts) * 100
      : 0;

    // Calculate upload speed from real uploads with file size data
    let uploadSpeedMbps: number | undefined = undefined;
    const uploadsWithSize = successfulUploads.filter(a => a.fileSizeBytes && a.fileSizeBytes > 0 && a.durationMs > 0);

    if (uploadsWithSize.length > 0) {
      // Calculate speed in Mbps for each upload
      const speeds = uploadsWithSize.map(upload => {
        // Convert bytes to megabits: (bytes * 8) / 1,000,000
        // Convert ms to seconds: ms / 1000
        return (upload.fileSizeBytes! * 8 / 1_000_000) / (upload.durationMs / 1000);
      });

      // Take median (more robust than average)
      speeds.sort((a, b) => a - b);
      const median = speeds.length % 2 === 0
        ? (speeds[speeds.length / 2 - 1] + speeds[speeds.length / 2]) / 2
        : speeds[Math.floor(speeds.length / 2)];

      uploadSpeedMbps = Math.round(median * 10) / 10; // Round to 1 decimal

      console.log(`[NetworkMonitor] Upload speed calculated from ${uploadsWithSize.length} real uploads: ${uploadSpeedMbps} Mbps (median)`);
    }

    return {
      network_type: this.detectNetworkType(),
      upload_speed_mbps: uploadSpeedMbps,
      upload_retries: this.uploadRetries,
      upload_failures: this.uploadFailures,
      upload_success_count: this.uploadSuccesses,
      upload_success_rate: Math.round(successRate * 10) / 10,
      average_upload_time_ms: Math.round(averageUploadTime)
    };
  }

  /**
   * Reset metrics (useful for new execution)
   */
  reset(): void {
    this.uploadAttempts = [];
    this.uploadRetries = 0;
    this.uploadFailures = 0;
    this.uploadSuccesses = 0;
  }

  /**
   * Helper: Create a timeout promise
   */
  private timeoutPromise<T>(ms: number, value: T): Promise<T> {
    return new Promise(resolve => setTimeout(() => resolve(value), ms));
  }
}

/**
 * Singleton instance for easy access
 */
export const networkMonitor = new NetworkMonitor();
