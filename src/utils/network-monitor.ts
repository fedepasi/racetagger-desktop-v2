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
  private uploadAttempts: Array<{ success: boolean; durationMs: number }> = [];
  private uploadRetries = 0;
  private uploadFailures = 0;
  private uploadSuccesses = 0;

  /**
   * Measure initial network metrics (latency and upload speed)
   * This runs once at the start of execution
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

      // Measure upload speed with timeout
      const speedPromise = this.estimateUploadSpeed();
      const speed = await Promise.race([
        speedPromise,
        this.timeoutPromise(timeout, undefined)
      ]);

      if (speed !== undefined) {
        metrics.upload_speed_mbps = speed;
      }

      console.log('[NetworkMonitor] Initial metrics collected:', metrics);
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
   * Estimate upload speed with small test file
   * Uploads a 100KB test file and calculates MB/s
   */
  private async estimateUploadSpeed(): Promise<number | undefined> {
    try {
      const supabase = getSupabaseClient();

      // Create a 100KB test buffer
      const testSize = 100 * 1024; // 100KB
      const testData = Buffer.alloc(testSize, 'x');

      // Generate unique test file name
      const testFileName = `_network-test-${Date.now()}.tmp`;
      const testPath = `network-tests/${testFileName}`;

      const startTime = Date.now();

      // Upload test file
      const { error } = await supabase.storage
        .from('analysis-logs')
        .upload(testPath, testData, {
          cacheControl: '60',
          upsert: true
        });

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      // Clean up test file (don't wait for completion)
      supabase.storage
        .from('analysis-logs')
        .remove([testPath])
        .catch(() => {
          // Ignore cleanup errors
        });

      if (error) {
        console.warn('[NetworkMonitor] Upload speed test failed:', error.message);
        return undefined;
      }

      // Calculate speed in MB/s, then convert to Mbps
      const speedMBps = (testSize / 1024 / 1024) / (durationMs / 1000);
      const speedMbps = speedMBps * 8; // Convert MB/s to Mbps

      return Math.round(speedMbps * 10) / 10; // Round to 1 decimal
    } catch (error) {
      console.warn('[NetworkMonitor] Failed to estimate upload speed:', error);
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
   */
  recordUploadAttempt(success: boolean, durationMs: number): void {
    this.uploadAttempts.push({ success, durationMs });

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

    return {
      network_type: this.detectNetworkType(),
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
