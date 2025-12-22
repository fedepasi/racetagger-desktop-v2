/**
 * Memory Pool Manager for Racetagger Desktop
 * Provides efficient buffer pooling to reduce memory allocation overhead and GC pressure
 */

import { EventEmitter } from 'events';
import { PERFORMANCE_CONFIG } from '../config';

export enum BufferSizeCategory {
  SMALL = 'small',     // 0-5MB (JPEG standard)
  MEDIUM = 'medium',   // 5-25MB (JPEG large, TIFF)
  LARGE = 'large',     // 25-100MB (RAW files)
  XLARGE = 'xlarge'    // 100MB+ (RAW files very large)
}

export interface PooledBuffer {
  buffer: Buffer;
  size: number;
  category: BufferSizeCategory;
  inUse: boolean;
  allocatedAt: number;
  lastUsedAt: number;
  usageCount: number;
  id: string;
}

export interface MemoryPoolStats {
  totalBuffers: number;
  activeBuffers: number;
  availableBuffers: number;
  poolHitRate: number;
  memorySavedBytes: number;
  gcPressureReduction: number;
  categoryCounts: { [key in BufferSizeCategory]: number };
  memoryUsage: {
    allocated: number;
    available: number;
    total: number;
    systemMemory: number;
  };
}

export interface MemoryPoolConfig {
  enabled: boolean;
  maxMemoryMB: number;
  buffersPerCategory: number;
  cleanupIntervalMs: number;
  maxBufferAgeMs: number;
  enableLeakDetection: boolean;
  emergencyCleanupThreshold: number; // percentage
}

/**
 * Advanced Memory Pool Manager with intelligent buffer allocation and reuse
 */
export class MemoryPoolManager extends EventEmitter {
  private pools: Map<BufferSizeCategory, PooledBuffer[]> = new Map();
  private activeBuffers: Map<string, PooledBuffer> = new Map();
  private config: MemoryPoolConfig;
  private stats: {
    totalAllocations: number;
    poolHits: number;
    poolMisses: number;
    totalBytesAllocated: number;
    totalBytesSaved: number;
    gcEvents: number;
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private leakDetectionInterval: NodeJS.Timeout | null = null;
  private isShutdown: boolean = false;
  private nextBufferId: number = 1;

  // Size thresholds in bytes
  private readonly SIZE_THRESHOLDS = {
    [BufferSizeCategory.SMALL]: 5 * 1024 * 1024,      // 5MB
    [BufferSizeCategory.MEDIUM]: 25 * 1024 * 1024,    // 25MB
    [BufferSizeCategory.LARGE]: 100 * 1024 * 1024,    // 100MB
    [BufferSizeCategory.XLARGE]: Number.MAX_SAFE_INTEGER // Unlimited
  };

  constructor(config?: Partial<MemoryPoolConfig>) {
    super();
    
    const buffersPerCategory = PERFORMANCE_CONFIG.enableParallelOptimizations ? 
      (PERFORMANCE_CONFIG.level === 'aggressive' ? 12 : 8) : 4;
    
    this.config = {
      enabled: PERFORMANCE_CONFIG.enableMemoryOptimizations || false,
      maxMemoryMB: PERFORMANCE_CONFIG.maxMemoryUsageMB || 1536,
      buffersPerCategory,
      cleanupIntervalMs: 60000, // 1 minute
      maxBufferAgeMs: 300000,   // 5 minutes
      enableLeakDetection: true,
      emergencyCleanupThreshold: 85, // 85% memory usage triggers cleanup
      ...config
    };

    this.stats = {
      totalAllocations: 0,
      poolHits: 0,
      poolMisses: 0,
      totalBytesAllocated: 0,
      totalBytesSaved: 0,
      gcEvents: 0
    };

    if (this.config.enabled) {
      this.initializePools();
      this.startMaintenance();
    }
  }

  /**
   * Initialize buffer pools for each size category
   */
  private initializePools(): void {
    Object.values(BufferSizeCategory).forEach(category => {
      this.pools.set(category, []);
      
      // Pre-allocate some buffers for frequently used categories
      if (category === BufferSizeCategory.SMALL || category === BufferSizeCategory.MEDIUM) {
        const preAllocateCount = Math.floor(this.config.buffersPerCategory / 2);
        for (let i = 0; i < preAllocateCount; i++) {
          const buffer = this.createBuffer(this.getSuggestedSize(category), category);
          this.pools.get(category)!.push(buffer);
        }
      }
    });

    this.emit('poolsInitialized', {
      totalCategories: this.pools.size,
      preAllocatedBuffers: this.getTotalBufferCount()
    });
  }

  /**
   * Get suggested buffer size for category
   */
  private getSuggestedSize(category: BufferSizeCategory): number {
    switch (category) {
      case BufferSizeCategory.SMALL:
        return 2 * 1024 * 1024;   // 2MB
      case BufferSizeCategory.MEDIUM:
        return 15 * 1024 * 1024;  // 15MB
      case BufferSizeCategory.LARGE:
        return 60 * 1024 * 1024;  // 60MB
      case BufferSizeCategory.XLARGE:
        return 150 * 1024 * 1024; // 150MB
      default:
        return 2 * 1024 * 1024;
    }
  }

  /**
   * Determine buffer size category based on required size
   */
  private categorizeSize(size: number): BufferSizeCategory {
    if (size <= this.SIZE_THRESHOLDS[BufferSizeCategory.SMALL]) {
      return BufferSizeCategory.SMALL;
    } else if (size <= this.SIZE_THRESHOLDS[BufferSizeCategory.MEDIUM]) {
      return BufferSizeCategory.MEDIUM;
    } else if (size <= this.SIZE_THRESHOLDS[BufferSizeCategory.LARGE]) {
      return BufferSizeCategory.LARGE;
    } else {
      return BufferSizeCategory.XLARGE;
    }
  }

  /**
   * Acquire a buffer from the pool or allocate new one
   */
  async acquireBuffer(requestedSize: number): Promise<PooledBuffer> {
    if (!this.config.enabled) {
      // Direct allocation when pooling is disabled
      return this.createBuffer(requestedSize, this.categorizeSize(requestedSize), false);
    }

    this.stats.totalAllocations++;
    
    const category = this.categorizeSize(requestedSize);
    const pool = this.pools.get(category)!;
    
    // Find available buffer that's large enough
    const availableBuffer = pool.find(buf => 
      !buf.inUse && buf.size >= requestedSize
    );

    if (availableBuffer) {
      // Pool hit - reuse existing buffer
      this.stats.poolHits++;
      this.stats.totalBytesSaved += requestedSize;
      
      availableBuffer.inUse = true;
      availableBuffer.lastUsedAt = Date.now();
      availableBuffer.usageCount++;
      
      this.activeBuffers.set(availableBuffer.id, availableBuffer);
      
      this.emit('bufferAcquired', {
        bufferId: availableBuffer.id,
        size: requestedSize,
        actualSize: availableBuffer.size,
        category,
        fromPool: true
      });
      
      return availableBuffer;
    }

    // Pool miss - need to allocate new buffer
    this.stats.poolMisses++;
    
    // Check if we can allocate more buffers in this category
    if (pool.length < this.config.buffersPerCategory && !this.isNearMemoryLimit()) {
      // Allocate buffer slightly larger than requested for better reusability
      const allocSize = this.calculateOptimalSize(requestedSize, category);
      const newBuffer = this.createBuffer(allocSize, category);
      
      newBuffer.inUse = true;
      newBuffer.lastUsedAt = Date.now();
      newBuffer.usageCount = 1;
      
      pool.push(newBuffer);
      this.activeBuffers.set(newBuffer.id, newBuffer);
      
      this.emit('bufferAcquired', {
        bufferId: newBuffer.id,
        size: requestedSize,
        actualSize: allocSize,
        category,
        fromPool: false
      });
      
      return newBuffer;
    }

    // Pool is full or near memory limit - try emergency cleanup
    await this.performEmergencyCleanup();
    
    // Try pool again after cleanup
    const availableAfterCleanup = pool.find(buf => 
      !buf.inUse && buf.size >= requestedSize
    );
    
    if (availableAfterCleanup) {
      availableAfterCleanup.inUse = true;
      availableAfterCleanup.lastUsedAt = Date.now();
      availableAfterCleanup.usageCount++;
      this.activeBuffers.set(availableAfterCleanup.id, availableAfterCleanup);
      return availableAfterCleanup;
    }

    // Last resort - direct allocation (won't be pooled)
    return this.createBuffer(requestedSize, category, false);
  }

  /**
   * Release a buffer back to the pool
   */
  releaseBuffer(buffer: PooledBuffer): void {
    if (!buffer || !buffer.id) {
      return;
    }

    const activeBuffer = this.activeBuffers.get(buffer.id);
    if (!activeBuffer) {
      return;
    }

    activeBuffer.inUse = false;
    activeBuffer.lastUsedAt = Date.now();
    
    this.activeBuffers.delete(buffer.id);
    
    this.emit('bufferReleased', {
      bufferId: buffer.id,
      category: buffer.category,
      usageCount: buffer.usageCount
    });

    // Clear sensitive data if buffer contains image data
    if (buffer.buffer.length > 1024 * 1024) { // 1MB+
      buffer.buffer.fill(0, 0, Math.min(1024, buffer.buffer.length));
    }
  }

  /**
   * Create a new buffer
   */
  private createBuffer(
    size: number, 
    category: BufferSizeCategory, 
    pooled: boolean = true
  ): PooledBuffer {
    const buffer = Buffer.alloc(size);
    const bufferId = `buf_${this.nextBufferId++}`;
    
    this.stats.totalBytesAllocated += size;
    
    const pooledBuffer: PooledBuffer = {
      buffer,
      size,
      category,
      inUse: false,
      allocatedAt: Date.now(),
      lastUsedAt: Date.now(),
      usageCount: 0,
      id: bufferId
    };

    if (!pooled) {
      // Mark as temporary - will be garbage collected when released
      (pooledBuffer as any).temporary = true;
    }

    return pooledBuffer;
  }

  /**
   * Calculate optimal buffer size for better reusability
   */
  private calculateOptimalSize(requestedSize: number, category: BufferSizeCategory): number {
    // Round up to next power of 2 or add 20% padding, whichever is smaller
    const powerOfTwo = Math.pow(2, Math.ceil(Math.log2(requestedSize)));
    const paddedSize = Math.ceil(requestedSize * 1.2);
    
    const optimalSize = Math.min(powerOfTwo, paddedSize);
    
    // Don't exceed category threshold
    const categoryMax = this.SIZE_THRESHOLDS[category];
    return Math.min(optimalSize, categoryMax);
  }

  /**
   * Check if near memory limit
   */
  private isNearMemoryLimit(): boolean {
    const currentUsage = this.getCurrentMemoryUsage();
    const maxBytes = this.config.maxMemoryMB * 1024 * 1024;
    const usagePercentage = (currentUsage / maxBytes) * 100;
    
    return usagePercentage > this.config.emergencyCleanupThreshold;
  }

  /**
   * Get current memory usage by the pool
   */
  private getCurrentMemoryUsage(): number {
    let totalBytes = 0;
    
    this.pools.forEach(pool => {
      totalBytes += pool.reduce((sum, buf) => sum + buf.size, 0);
    });
    
    return totalBytes;
  }

  /**
   * Perform emergency cleanup when memory is running low
   */
  private async performEmergencyCleanup(): Promise<void> {
    
    let releasedBuffers = 0;
    let releasedBytes = 0;
    
    this.pools.forEach((pool, category) => {
      // Remove oldest unused buffers
      const unusedBuffers = pool.filter(buf => !buf.inUse)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      
      const toRemove = Math.ceil(unusedBuffers.length * 0.5); // Remove 50%
      
      for (let i = 0; i < toRemove && i < unusedBuffers.length; i++) {
        const bufferIndex = pool.indexOf(unusedBuffers[i]);
        if (bufferIndex > -1) {
          const removed = pool.splice(bufferIndex, 1)[0];
          releasedBuffers++;
          releasedBytes += removed.size;
        }
      }
    });
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      this.stats.gcEvents++;
    }
    
    this.emit('emergencyCleanup', {
      releasedBuffers,
      releasedBytes,
      remainingBuffers: this.getTotalBufferCount()
    });
  }

  /**
   * Start maintenance routines
   */
  private startMaintenance(): void {
    // Regular cleanup
    this.cleanupInterval = setInterval(() => {
      if (this.isShutdown) return;
      this.performRegularCleanup();
    }, this.config.cleanupIntervalMs);

    // Leak detection
    if (this.config.enableLeakDetection) {
      this.leakDetectionInterval = setInterval(() => {
        if (this.isShutdown) return;
        this.detectMemoryLeaks();
      }, this.config.cleanupIntervalMs * 2);
    }

    // Stats emission
    setInterval(() => {
      if (this.isShutdown) return;
      this.emit('statsUpdate', this.getStats());
    }, 30000); // Every 30 seconds
  }

  /**
   * Regular cleanup of old unused buffers
   */
  private performRegularCleanup(): void {
    const now = Date.now();
    let cleanedBuffers = 0;
    let cleanedBytes = 0;

    this.pools.forEach((pool, category) => {
      const toRemove: number[] = [];
      
      pool.forEach((buffer, index) => {
        if (!buffer.inUse && 
            (now - buffer.lastUsedAt) > this.config.maxBufferAgeMs &&
            buffer.usageCount < 2) { // Only clean buffers that haven't been reused much
          toRemove.push(index);
        }
      });

      // Remove in reverse order to maintain indices
      toRemove.reverse().forEach(index => {
        const removed = pool.splice(index, 1)[0];
        cleanedBuffers++;
        cleanedBytes += removed.size;
      });
    });

    if (cleanedBuffers > 0) {
      this.emit('regularCleanup', {
        cleanedBuffers,
        cleanedBytes,
        remainingBuffers: this.getTotalBufferCount()
      });
    }
  }

  /**
   * Detect potential memory leaks
   */
  private detectMemoryLeaks(): void {
    const now = Date.now();
    const suspiciousBuffers: PooledBuffer[] = [];

    this.activeBuffers.forEach(buffer => {
      // Buffer has been active for more than 10 minutes
      if ((now - buffer.lastUsedAt) > 600000) {
        suspiciousBuffers.push(buffer);
      }
    });

    if (suspiciousBuffers.length > 0) {
      this.emit('memoryLeakDetected', {
        suspiciousBuffers: suspiciousBuffers.length,
        bufferIds: suspiciousBuffers.map(b => b.id)
      });
    }
  }

  /**
   * Get total buffer count across all pools
   */
  private getTotalBufferCount(): number {
    let total = 0;
    this.pools.forEach(pool => {
      total += pool.length;
    });
    return total;
  }

  /**
   * Get memory pool statistics
   */
  getStats(): MemoryPoolStats {
    const totalBuffers = this.getTotalBufferCount();
    const activeBuffers = this.activeBuffers.size;
    const hitRate = this.stats.totalAllocations > 0 ? 
      (this.stats.poolHits / this.stats.totalAllocations) * 100 : 0;

    const categoryCounts: { [key in BufferSizeCategory]: number } = {
      [BufferSizeCategory.SMALL]: this.pools.get(BufferSizeCategory.SMALL)?.length || 0,
      [BufferSizeCategory.MEDIUM]: this.pools.get(BufferSizeCategory.MEDIUM)?.length || 0,
      [BufferSizeCategory.LARGE]: this.pools.get(BufferSizeCategory.LARGE)?.length || 0,
      [BufferSizeCategory.XLARGE]: this.pools.get(BufferSizeCategory.XLARGE)?.length || 0
    };

    const currentUsage = this.getCurrentMemoryUsage();
    const systemMemory = process.memoryUsage();

    return {
      totalBuffers,
      activeBuffers,
      availableBuffers: totalBuffers - activeBuffers,
      poolHitRate: hitRate,
      memorySavedBytes: this.stats.totalBytesSaved,
      gcPressureReduction: (this.stats.poolHits / Math.max(this.stats.totalAllocations, 1)) * 100,
      categoryCounts,
      memoryUsage: {
        allocated: currentUsage,
        available: (this.config.maxMemoryMB * 1024 * 1024) - currentUsage,
        total: this.config.maxMemoryMB * 1024 * 1024,
        systemMemory: systemMemory.heapUsed
      }
    };
  }

  /**
   * Update configuration dynamically
   */
  updateConfiguration(newConfig: Partial<MemoryPoolConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configurationUpdated', this.config);
  }

  /**
   * Shutdown the memory pool manager
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Clear intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.leakDetectionInterval) {
      clearInterval(this.leakDetectionInterval);
      this.leakDetectionInterval = null;
    }

    // Release all active buffers
    const activeIds = Array.from(this.activeBuffers.keys());
    activeIds.forEach(id => {
      const buffer = this.activeBuffers.get(id);
      if (buffer) {
        this.releaseBuffer(buffer);
      }
    });

    // Clear pools
    this.pools.clear();
    this.activeBuffers.clear();

    // Force GC
    if (global.gc) {
      global.gc();
    }

    this.emit('shutdown', this.stats);
  }
}

// Singleton instance
export const memoryPoolManager = new MemoryPoolManager();

// Helper functions for easy buffer management
export async function acquireImageBuffer(size: number): Promise<PooledBuffer> {
  return memoryPoolManager.acquireBuffer(size);
}

export function releaseImageBuffer(buffer: PooledBuffer): void {
  memoryPoolManager.releaseBuffer(buffer);
}

export function getMemoryStats(): MemoryPoolStats {
  return memoryPoolManager.getStats();
}