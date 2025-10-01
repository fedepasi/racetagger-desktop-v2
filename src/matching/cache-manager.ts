/**
 * CacheManager - Multi-level caching for matching operations
 *
 * This module implements a sophisticated caching system with three levels:
 * L1: In-memory cache for active session data
 * L2: SQLite cache for recent matches and patterns
 * L3: Supabase for persistent storage and sharing
 *
 * TODO_ML_INTEGRATION: This module can be enhanced with:
 * - ML model caching and versioning
 * - Feature vector caching
 * - Prediction result caching with invalidation
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from '../config';
import { MatchResult, MatchCandidate } from './smart-matcher';

export interface CacheEntry {
  key: string;
  value: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  accessCount: number;
  lastAccess: number;
  size?: number; // Estimated size in bytes
}

export interface MatchCacheEntry {
  analysisHash: string;
  participantHash: string;
  sport: string;
  result: MatchResult;
  timestamp: number;
  confidence: number;
}

export interface CacheStats {
  l1: {
    size: number;
    hitRate: number;
    entries: number;
    totalSize: number;
  };
  l2: {
    size: number;
    hitRate: number;
    entries: number;
  };
  l3: {
    entries: number;
    syncStatus: 'connected' | 'disconnected' | 'syncing';
  };
}

/**
 * CacheManager Class
 *
 * Manages three-level caching for intelligent matching operations.
 * Optimizes performance while maintaining data consistency.
 */
export class CacheManager {
  // L1 Cache: In-memory storage
  private l1Cache: Map<string, CacheEntry>;
  private l1Stats: { hits: number; misses: number };
  private maxL1Size: number;
  private maxL1Entries: number;

  // L2 Cache: SQLite database
  private l2Database: any; // SQLite database instance
  private l2Stats: { hits: number; misses: number };

  // L3 Cache: Supabase storage
  private supabase: any;
  private l3Enabled: boolean;

  // Configuration
  private config: {
    l1MaxSize: number;        // Max memory usage in bytes
    l1MaxEntries: number;     // Max number of entries
    l1DefaultTTL: number;     // Default TTL in milliseconds
    l2MaxEntries: number;     // Max SQLite entries
    l2DefaultTTL: number;     // Default TTL for L2
    l3SyncInterval: number;   // Sync interval for L3
    cleanupInterval: number;  // Cleanup interval
  };

  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.config = {
      l1MaxSize: 50 * 1024 * 1024,    // 50MB
      l1MaxEntries: 1000,              // 1000 entries
      l1DefaultTTL: 5 * 60 * 1000,     // 5 minutes
      l2MaxEntries: 10000,             // 10k entries
      l2DefaultTTL: 24 * 60 * 60 * 1000, // 24 hours
      l3SyncInterval: 30 * 60 * 1000,  // 30 minutes
      cleanupInterval: 10 * 60 * 1000  // 10 minutes
    };

    this.l1Cache = new Map();
    this.l1Stats = { hits: 0, misses: 0 };
    this.l2Stats = { hits: 0, misses: 0 };
    this.maxL1Size = this.config.l1MaxSize;
    this.maxL1Entries = this.config.l1MaxEntries;
    this.l3Enabled = false;

    this.initializeL2Cache();
    this.initializeL3Cache();
    this.startCleanupTimer();
  }

  /**
   * Get a cached match result
   */
  async getMatch(
    analysisHash: string,
    participantHash: string,
    sport: string
  ): Promise<MatchResult | null> {
    const key = this.buildMatchKey(analysisHash, participantHash, sport);

    // Try L1 cache first
    const l1Result = this.getFromL1(key);
    if (l1Result) {
      this.l1Stats.hits++;
      return l1Result;
    }
    this.l1Stats.misses++;

    // Try L2 cache
    const l2Result = await this.getFromL2(key);
    if (l2Result) {
      this.l2Stats.hits++;
      // Promote to L1
      this.setToL1(key, l2Result, this.config.l1DefaultTTL);
      return l2Result;
    }
    this.l2Stats.misses++;

    // Try L3 cache if enabled
    if (this.l3Enabled) {
      const l3Result = await this.getFromL3(key);
      if (l3Result) {
        // Promote to L2 and L1
        await this.setToL2(key, l3Result, this.config.l2DefaultTTL);
        this.setToL1(key, l3Result, this.config.l1DefaultTTL);
        return l3Result;
      }
    }

    return null;
  }

  /**
   * Cache a match result
   */
  async setMatch(
    analysisHash: string,
    participantHash: string,
    sport: string,
    result: MatchResult,
    ttl?: number
  ): Promise<void> {
    const key = this.buildMatchKey(analysisHash, participantHash, sport);
    const effectiveTTL = ttl || this.config.l1DefaultTTL;

    // Store in L1
    this.setToL1(key, result, effectiveTTL);

    // Store in L2 with longer TTL
    await this.setToL2(key, result, this.config.l2DefaultTTL);

    // Store in L3 if enabled and result is high-confidence
    if (this.l3Enabled && result.bestMatch && result.bestMatch.confidence > 0.8) {
      await this.setToL3(key, result);
    }
  }

  /**
   * Cache participant data for faster lookups
   */
  async cacheParticipants(
    participantHash: string,
    participants: any[],
    sport: string
  ): Promise<void> {
    const key = `participants:${participantHash}:${sport}`;
    const ttl = 60 * 60 * 1000; // 1 hour

    this.setToL1(key, participants, ttl);
    await this.setToL2(key, participants, this.config.l2DefaultTTL);
  }

  /**
   * Get cached participant data
   */
  async getCachedParticipants(
    participantHash: string,
    sport: string
  ): Promise<any[] | null> {
    const key = `participants:${participantHash}:${sport}`;

    // Try L1 cache first
    const l1Result = this.getFromL1(key);
    if (l1Result) {
      this.l1Stats.hits++;
      return l1Result;
    }
    this.l1Stats.misses++;

    // Try L2 cache
    const l2Result = await this.getFromL2(key);
    if (l2Result) {
      this.l2Stats.hits++;
      // Promote to L1
      this.setToL1(key, l2Result, this.config.l1DefaultTTL);
      return l2Result;
    }
    this.l2Stats.misses++;

    return null;
  }

  /**
   * Cache OCR correction patterns for learning
   *
   * TODO_ML_INTEGRATION: This can store:
   * - Learned OCR patterns
   * - Correction success rates
   * - Context-specific patterns
   */
  async cacheOCRPattern(
    original: string,
    corrected: string,
    sport: string,
    successRate: number
  ): Promise<void> {
    const key = `ocr:${original}:${sport}`;
    const pattern = {
      original,
      corrected,
      sport,
      successRate,
      timestamp: Date.now()
    };

    this.setToL1(key, pattern, this.config.l1DefaultTTL);
    await this.setToL2(key, pattern, this.config.l2DefaultTTL * 7); // Keep longer
  }

  /**
   * Get cached OCR correction pattern
   */
  async getOCRPattern(original: string, sport: string): Promise<any | null> {
    const key = `ocr:${original}:${sport}`;

    const l1Result = this.getFromL1(key);
    if (l1Result) return l1Result;

    const l2Result = await this.getFromL2(key);
    if (l2Result) {
      this.setToL1(key, l2Result, this.config.l1DefaultTTL);
    }
    return l2Result;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const l1Size = Array.from(this.l1Cache.values())
      .reduce((total, entry) => total + (entry.size || 0), 0);

    return {
      l1: {
        size: l1Size,
        hitRate: this.l1Stats.hits / (this.l1Stats.hits + this.l1Stats.misses) || 0,
        entries: this.l1Cache.size,
        totalSize: l1Size
      },
      l2: {
        size: 0, // TODO: Get from SQLite
        hitRate: this.l2Stats.hits / (this.l2Stats.hits + this.l2Stats.misses) || 0,
        entries: 0 // TODO: Get from SQLite
      },
      l3: {
        entries: 0, // TODO: Get from Supabase
        syncStatus: this.l3Enabled ? 'connected' : 'disconnected'
      }
    };
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    this.l1Cache.clear();
    this.l1Stats = { hits: 0, misses: 0 };
    this.l2Stats = { hits: 0, misses: 0 };

    if (this.l2Database) {
      try {
        await this.l2Database.exec('DELETE FROM cache_entries');
      } catch (error) {
        console.error('Error clearing L2 cache:', error);
      }
    }
  }

  /**
   * L1 Cache Methods
   */
  private getFromL1(key: string): any | null {
    const entry = this.l1Cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.l1Cache.delete(key);
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccess = Date.now();

    return entry.value;
  }

  private setToL1(key: string, value: any, ttl: number): void {
    const size = this.estimateSize(value);

    // Check size limits
    if (this.l1Cache.size >= this.maxL1Entries) {
      this.evictL1Entries(1);
    }

    const entry: CacheEntry = {
      key,
      value,
      timestamp: Date.now(),
      ttl,
      accessCount: 1,
      lastAccess: Date.now(),
      size
    };

    this.l1Cache.set(key, entry);
  }

  private evictL1Entries(count: number): void {
    // LRU eviction
    const entries = Array.from(this.l1Cache.entries())
      .sort(([, a], [, b]) => a.lastAccess - b.lastAccess);

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.l1Cache.delete(entries[i][0]);
    }
  }

  /**
   * L2 Cache Methods (SQLite)
   */
  private async initializeL2Cache(): Promise<void> {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(app.getPath('userData'), 'cache.db');

      this.l2Database = new Database(dbPath);

      // Create tables
      this.l2Database.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          ttl INTEGER NOT NULL,
          access_count INTEGER DEFAULT 1,
          last_access INTEGER NOT NULL,
          sport TEXT,
          category TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_timestamp ON cache_entries(timestamp);
        CREATE INDEX IF NOT EXISTS idx_sport ON cache_entries(sport);
        CREATE INDEX IF NOT EXISTS idx_category ON cache_entries(category);
      `);

      console.log('L2 cache (SQLite) initialized');
    } catch (error) {
      console.error('Failed to initialize L2 cache:', error);
    }
  }

  private async getFromL2(key: string): Promise<any | null> {
    if (!this.l2Database) return null;

    try {
      const row = this.l2Database.prepare(`
        SELECT value, timestamp, ttl FROM cache_entries
        WHERE key = ? AND timestamp + ttl > ?
      `).get(key, Date.now());

      if (!row) return null;

      // Update access stats
      this.l2Database.prepare(`
        UPDATE cache_entries
        SET access_count = access_count + 1, last_access = ?
        WHERE key = ?
      `).run(Date.now(), key);

      return JSON.parse(row.value);
    } catch (error) {
      console.error('Error reading from L2 cache:', error);
      return null;
    }
  }

  private async setToL2(key: string, value: any, ttl: number): Promise<void> {
    if (!this.l2Database) return;

    try {
      const serialized = JSON.stringify(value);
      const timestamp = Date.now();

      this.l2Database.prepare(`
        INSERT OR REPLACE INTO cache_entries
        (key, value, timestamp, ttl, last_access, sport, category)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        key,
        serialized,
        timestamp,
        ttl,
        timestamp,
        this.extractSportFromKey(key),
        this.extractCategoryFromKey(key)
      );

      // Cleanup old entries periodically
      if (Math.random() < 0.01) { // 1% chance
        this.cleanupL2Cache();
      }
    } catch (error) {
      console.error('Error writing to L2 cache:', error);
    }
  }

  private cleanupL2Cache(): void {
    if (!this.l2Database) return;

    try {
      // Remove expired entries
      this.l2Database.prepare(`
        DELETE FROM cache_entries
        WHERE timestamp + ttl < ?
      `).run(Date.now());

      // Remove old entries if over limit
      const count = this.l2Database.prepare('SELECT COUNT(*) as count FROM cache_entries').get().count;
      if (count > this.config.l2MaxEntries) {
        const excess = count - this.config.l2MaxEntries;
        this.l2Database.prepare(`
          DELETE FROM cache_entries
          WHERE key IN (
            SELECT key FROM cache_entries
            ORDER BY last_access ASC
            LIMIT ?
          )
        `).run(excess);
      }
    } catch (error) {
      console.error('Error cleaning up L2 cache:', error);
    }
  }

  /**
   * L3 Cache Methods (Supabase)
   */
  private async initializeL3Cache(): Promise<void> {
    try {
      if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
        this.supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
        this.l3Enabled = true;
        console.log('L3 cache (Supabase) initialized');
      }
    } catch (error) {
      console.error('Failed to initialize L3 cache:', error);
      this.l3Enabled = false;
    }
  }

  private async getFromL3(key: string): Promise<any | null> {
    if (!this.l3Enabled || !this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('cache_entries')
        .select('value, created_at')
        .eq('key', key)
        .gte('created_at', new Date(Date.now() - this.config.l2DefaultTTL).toISOString())
        .single();

      if (error || !data) return null;

      return JSON.parse(data.value);
    } catch (error) {
      console.error('Error reading from L3 cache:', error);
      return null;
    }
  }

  private async setToL3(key: string, value: any): Promise<void> {
    if (!this.l3Enabled || !this.supabase) return;

    try {
      const { error } = await this.supabase
        .from('cache_entries')
        .upsert({
          key,
          value: JSON.stringify(value),
          sport: this.extractSportFromKey(key),
          category: this.extractCategoryFromKey(key),
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error writing to L3 cache:', error);
      }
    } catch (error) {
      console.error('Error writing to L3 cache:', error);
    }
  }

  /**
   * Utility Methods
   */
  private buildMatchKey(analysisHash: string, participantHash: string, sport: string): string {
    return `match:${sport}:${analysisHash}:${participantHash}`;
  }

  private extractSportFromKey(key: string): string | null {
    const parts = key.split(':');
    return parts.length > 1 ? parts[1] : null;
  }

  private extractCategoryFromKey(key: string): string | null {
    const parts = key.split(':');
    return parts.length > 0 ? parts[0] : null;
  }

  private estimateSize(obj: any): number {
    try {
      return JSON.stringify(obj).length * 2; // Rough estimate (2 bytes per char)
    } catch {
      return 1000; // Default estimate
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.config.cleanupInterval);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.l1Cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.l1Cache.delete(key);
      }
    }

    this.cleanupL2Cache();
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    if (this.l2Database) {
      try {
        this.l2Database.close();
      } catch (error) {
        console.error('Error closing L2 database:', error);
      }
    }
  }
}