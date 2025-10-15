import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, PERFORMANCE_CONFIG } from './config'; // Assumendo che SUPABASE_CONFIG sia esportato da config.ts
import { authService } from './auth-service'; // Per ottenere user_id
import { EventEmitter } from 'events';

// Lazy import of electron app to avoid circular dependencies
let electronApp: any = null;
function getElectronApp() {
  if (!electronApp) {
    electronApp = require('electron').app;
  }
  return electronApp;
}

// --- Supabase Client Initialization ---
// Utilizziamo il client Supabase da authService per assicurarci che utilizzi lo stesso token di autenticazione
let supabase: SupabaseClient;

// Funzione per ottenere un client Supabase aggiornato
export function getSupabaseClient(): SupabaseClient {
  // Aggiorniamo il riferimento al client Supabase da authService se non ancora inizializzato
  if (!supabase) {
    supabase = authService.getSupabaseClient();
  }
  return supabase;
}

// Importazione sicura di better-sqlite3
let BetterSqlite3Database: any;
let BetterSqlite3DatabaseInstance: any;
try {
  // Tentativo di importare better-sqlite3
  BetterSqlite3Database = require('better-sqlite3');
  BetterSqlite3DatabaseInstance = require('better-sqlite3').Database;
  console.log('better-sqlite3 imported successfully');
} catch (error) {
  console.error('Failed to import better-sqlite3:', error);
  // Creiamo un mock di better-sqlite3 per evitare errori
  BetterSqlite3Database = class MockDatabase {
    constructor() {
      console.warn('Using MockDatabase instead of better-sqlite3');
    }
    prepare() { return { run: () => {}, get: () => null, all: () => [] }; }
    exec() {}
    close() {}
  };
  BetterSqlite3DatabaseInstance = BetterSqlite3Database;
}

/**
 * Enhanced Database Connection Pool for SQLite operations
 * Provides connection pooling, prepared statement caching, and batch operations
 */
class DatabaseConnectionPool extends EventEmitter {
  private connections: any[] = [];
  private availableConnections: any[] = [];
  private maxConnections: number;
  private minConnections: number;
  private statementCache: Map<string, any> = new Map();
  private connectionTimeouts: Map<any, NodeJS.Timeout> = new Map();
  private batchQueue: Array<{ operations: Array<() => any>; resolve: (results: any[]) => void; reject: (error: Error) => void }> = [];
  private isBatchProcessing: boolean = false;
  private dbPath: string;
  private poolStats: {
    activeConnections: number;
    totalConnections: number;
    cacheHits: number;
    cacheMisses: number;
    batchOperations: number;
    avgConnectionTime: number;
  };
  private lastMaintenance: number = 0;

  constructor(dbPath: string, options: {
    maxConnections?: number;
    minConnections?: number;
    connectionTimeout?: number;
    enableBatching?: boolean;
  } = {}) {
    super();
    
    this.dbPath = dbPath;
    this.maxConnections = PERFORMANCE_CONFIG.enableParallelOptimizations ? 
      (options.maxConnections || 8) : 
      (options.maxConnections || 3);
    this.minConnections = Math.min(options.minConnections || 2, this.maxConnections);
    
    this.poolStats = {
      activeConnections: 0,
      totalConnections: 0,
      cacheHits: 0,
      cacheMisses: 0,
      batchOperations: 0,
      avgConnectionTime: 0
    };
    
    // Initialize minimum connections
    this.initializePool();
    
    // Start maintenance routine
    this.startMaintenance();
    
    console.log(`[ConnectionPool] Initialized with ${this.maxConnections} max connections, ${this.minConnections} min connections`);
  }

  private async initializePool(): Promise<void> {
    for (let i = 0; i < this.minConnections; i++) {
      await this.createConnection();
    }
    console.log(`[ConnectionPool] Initialized ${this.minConnections} connections`);
  }

  private async createConnection(): Promise<any> {
    try {
      const connection = new BetterSqlite3Database(this.dbPath, {
        readonly: false,
        fileMustExist: false,
        timeout: 10000
      });
      
      // Configure connection for performance
      connection.pragma('journal_mode = WAL');
      connection.pragma('synchronous = NORMAL');
      connection.pragma('cache_size = 10000');
      connection.pragma('temp_store = MEMORY');
      connection.pragma('mmap_size = 268435456'); // 256MB
      
      this.connections.push(connection);
      this.availableConnections.push(connection);
      this.poolStats.totalConnections++;
      
      this.emit('connectionCreated', {
        totalConnections: this.connections.length,
        availableConnections: this.availableConnections.length
      });
      
      return connection;
    } catch (error) {
      console.error('[ConnectionPool] Failed to create connection:', error);
      throw error;
    }
  }

  private async acquireConnection(): Promise<any> {
    const startTime = Date.now();
    
    // Try to get an available connection
    if (this.availableConnections.length > 0) {
      const connection = this.availableConnections.pop();
      this.poolStats.activeConnections++;
      
      // Set connection timeout
      const timeout = setTimeout(() => {
        this.releaseConnection(connection);
        console.warn('[ConnectionPool] Connection auto-released due to timeout');
      }, 30000); // 30 second timeout
      
      this.connectionTimeouts.set(connection, timeout);
      
      const acquireTime = Date.now() - startTime;
      this.updateAvgConnectionTime(acquireTime);
      
      this.emit('connectionAcquired', {
        activeConnections: this.poolStats.activeConnections,
        availableConnections: this.availableConnections.length,
        acquireTime
      });
      
      return connection;
    }
    
    // Create new connection if under max limit
    if (this.connections.length < this.maxConnections) {
      const connection = await this.createConnection();
      this.availableConnections.pop(); // Remove from available since we're using it
      this.poolStats.activeConnections++;
      
      const timeout = setTimeout(() => {
        this.releaseConnection(connection);
      }, 30000);
      
      this.connectionTimeouts.set(connection, timeout);
      
      const acquireTime = Date.now() - startTime;
      this.updateAvgConnectionTime(acquireTime);
      
      return connection;
    }
    
    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const checkTimeout = setTimeout(() => {
        reject(new Error('Connection acquisition timeout'));
      }, 10000); // 10 second timeout
      
      const checkInterval = setInterval(() => {
        if (this.availableConnections.length > 0) {
          clearInterval(checkInterval);
          clearTimeout(checkTimeout);
          this.acquireConnection().then(resolve).catch(reject);
        }
      }, 100);
    });
  }

  private releaseConnection(connection: any): void {
    if (!connection) return;
    
    // Clear timeout
    const timeout = this.connectionTimeouts.get(connection);
    if (timeout) {
      clearTimeout(timeout);
      this.connectionTimeouts.delete(connection);
    }
    
    // Return to available pool if still valid
    if (this.connections.includes(connection)) {
      this.availableConnections.push(connection);
      this.poolStats.activeConnections = Math.max(0, this.poolStats.activeConnections - 1);
      
      this.emit('connectionReleased', {
        activeConnections: this.poolStats.activeConnections,
        availableConnections: this.availableConnections.length
      });
    }
  }

  private getCachedStatement(connection: any, sql: string): any {
    const cacheKey = `${connection}:${sql}`;
    
    if (this.statementCache.has(cacheKey)) {
      this.poolStats.cacheHits++;
      return this.statementCache.get(cacheKey);
    }
    
    this.poolStats.cacheMisses++;
    const statement = connection.prepare(sql);
    
    // Cache with size limit
    if (this.statementCache.size >= 100) {
      const firstKey = this.statementCache.keys().next().value;
      if (firstKey) {
        this.statementCache.delete(firstKey);
      }
    }
    
    this.statementCache.set(cacheKey, statement);
    return statement;
  }

  async executeQuery<T = any>(sql: string, params: any[] = []): Promise<T> {
    const connection = await this.acquireConnection();
    
    try {
      const statement = this.getCachedStatement(connection, sql);
      const result = statement.get(...params);
      return result as T;
    } finally {
      this.releaseConnection(connection);
    }
  }

  async executeAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const connection = await this.acquireConnection();
    
    try {
      const statement = this.getCachedStatement(connection, sql);
      const results = statement.all(...params);
      return results as T[];
    } finally {
      this.releaseConnection(connection);
    }
  }

  async executeRun(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const connection = await this.acquireConnection();
    
    try {
      const statement = this.getCachedStatement(connection, sql);
      const result = statement.run(...params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    } finally {
      this.releaseConnection(connection);
    }
  }

  async executeBatch(operations: Array<{ sql: string; params?: any[] }>): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({
        operations: operations.map(op => () => this.executeRun(op.sql, op.params || [])),
        resolve,
        reject
      });
      
      this.processBatchQueue();
    });
  }

  private async processBatchQueue(): Promise<void> {
    if (this.isBatchProcessing || this.batchQueue.length === 0) {
      return;
    }
    
    this.isBatchProcessing = true;
    
    try {
      // Process batches in groups to avoid overwhelming connections
      while (this.batchQueue.length > 0) {
        const batch = this.batchQueue.shift();
        if (!batch) continue;
        
        const connection = await this.acquireConnection();
        
        try {
          // Execute as transaction for consistency
          const transaction = connection.transaction(() => {
            const results = [];
            for (const operation of batch.operations) {
              results.push(operation());
            }
            return results;
          });
          
          const results = transaction();
          this.poolStats.batchOperations++;
          batch.resolve(results);
          
        } catch (error) {
          batch.reject(error as Error);
        } finally {
          this.releaseConnection(connection);
        }
      }
    } finally {
      this.isBatchProcessing = false;
    }
  }

  private updateAvgConnectionTime(newTime: number): void {
    const alpha = 0.1; // Smoothing factor
    this.poolStats.avgConnectionTime = 
      this.poolStats.avgConnectionTime === 0 ? 
        newTime : 
        (1 - alpha) * this.poolStats.avgConnectionTime + alpha * newTime;
  }

  private startMaintenance(): void {
    setInterval(() => {
      const now = Date.now();
      
      // Run maintenance every 5 minutes
      if (now - this.lastMaintenance < 300000) return;
      
      this.lastMaintenance = now;
      
      // Clean up excess connections if we're above minimum
      if (this.availableConnections.length > this.minConnections) {
        const excessConnections = this.availableConnections.length - this.minConnections;
        for (let i = 0; i < Math.min(excessConnections, 2); i++) {
          const connection = this.availableConnections.pop();
          if (connection) {
            try {
              connection.close();
              const index = this.connections.indexOf(connection);
              if (index > -1) {
                this.connections.splice(index, 1);
                this.poolStats.totalConnections--;
              }
            } catch (error) {
              console.error('[ConnectionPool] Error closing excess connection:', error);
            }
          }
        }
      }
      
      // Clear statement cache periodically
      if (this.statementCache.size > 50) {
        const keysToDelete = Array.from(this.statementCache.keys()).slice(0, 25);
        keysToDelete.forEach(key => this.statementCache.delete(key));
      }
      
      // Emit stats
      this.emit('maintenanceComplete', this.getStats());
      
    }, 60000); // Run every minute
  }

  getStats() {
    return {
      ...this.poolStats,
      availableConnections: this.availableConnections.length,
      queuedBatches: this.batchQueue.length,
      cacheSize: this.statementCache.size,
      cacheHitRate: this.poolStats.cacheHits / (this.poolStats.cacheHits + this.poolStats.cacheMisses) * 100 || 0
    };
  }

  async shutdown(): Promise<void> {
    console.log('[ConnectionPool] Shutting down...');
    
    // Wait for batch queue to complete
    let timeout = 10000; // 10 seconds max
    const start = Date.now();
    
    while (this.batchQueue.length > 0 && (Date.now() - start) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Close all connections
    for (const connection of this.connections) {
      try {
        if (connection && connection.open) {
          connection.close();
        }
      } catch (error) {
        console.error('[ConnectionPool] Error closing connection:', error);
      }
    }
    
    this.connections.length = 0;
    this.availableConnections.length = 0;
    this.statementCache.clear();
    
    console.log('[ConnectionPool] Shutdown complete');
  }
}

// --- SQLite Cache Setup ---
let localDB: any; // Will be initialized in initializeLocalCacheSchema
let connectionPool: DatabaseConnectionPool | null = null;
let isDbInitialized = false;

// Funzione per inizializzare lo schema del database locale (cache)
// Lo schema dovrebbe rispecchiare quello di Supabase per facilità di mapping.
// Usiamo TEXT per gli UUID di Supabase e DATETIME per TIMESTAMPTZ.
function initializeLocalCacheSchema(): void {
  // This function is called from main.ts after app is ready.
  try {
    const app = getElectronApp();
    if (app && !app.isReady()) {
      console.error("CRITICAL ERROR: initializeLocalCacheSchema called before app is ready. This should not happen.");
      // Attempt to defer, though main.ts should handle this.
      app.once('ready', initializeLocalCacheSchema);
      return;
    }
  } catch (error) {
    console.warn('[DatabaseService] App not ready check failed, proceeding anyway');
  }

  if (isDbInitialized) {
    console.log("Local cache database already initialized.");
    return;
  }

  try {
    const app = getElectronApp();
    const userDataPath = app.getPath('userData') || path.join(process.cwd(), 'userData');
    const dbFolderPath = path.join(userDataPath, 'RacetaggerData');
    const dbCachePath = path.join(dbFolderPath, 'racetagger_cache.db');

    if (!fs.existsSync(dbFolderPath)) {
      fs.mkdirSync(dbFolderPath, { recursive: true });
    }

    try {
      // Initialize connection pool instead of single connection
      connectionPool = new DatabaseConnectionPool(dbCachePath, {
        maxConnections: PERFORMANCE_CONFIG.enableParallelOptimizations ? 8 : 3,
        minConnections: 2,
        connectionTimeout: 30000,
        enableBatching: true
      });
      
      // Keep legacy localDB for backward compatibility
      localDB = new BetterSqlite3Database(dbCachePath);
      
      console.log(`Database connection pool initialized at: ${dbCachePath}`);
      
      // Setup connection pool monitoring
      connectionPool.on('connectionAcquired', (stats) => {
        if (false) { // Disable detailed connection logging
          console.log(`[DB] Connection acquired: ${stats.activeConnections} active, ${stats.availableConnections} available`);
        }
      });
      
      connectionPool.on('maintenanceComplete', (stats) => {
        console.log(`[DB] Pool maintenance: ${stats.totalConnections} total, ${stats.cacheHitRate.toFixed(1)}% cache hit rate`);
      });
      
    } catch (dbError) {
      console.error('Failed to create SQLite database instance:', dbError);
      // Creiamo un'istanza mock per evitare errori
      localDB = new (class MockDatabase {
        open = true;
        prepare() { return { run: () => {}, get: () => null, all: () => [] }; }
        exec() {}
        close() { this.open = false; }
      })();
      console.warn('Using mock database instance instead of better-sqlite3');
    }

    console.log('Initializing local cache database schema...');

    const createProjectsCacheTable = `
      CREATE TABLE IF NOT EXISTS Projects (
        id TEXT PRIMARY KEY, -- UUID da Supabase
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_csv_storage_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `;
    // Vincolo di unicità per (user_id, name) non necessario nella cache se gestito da Supabase
    // ma potrebbe essere utile per consistenza locale. Per ora lo omettiamo.
    // CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_name_cache ON Projects(user_id, name);


    const createExecutionsCacheTable = `
      CREATE TABLE IF NOT EXISTS Executions (
        id TEXT PRIMARY KEY, -- UUID da Supabase
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        specific_csv_storage_path TEXT,
        execution_at TEXT NOT NULL,
        status TEXT,
        results_reference TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES Projects (id) ON DELETE CASCADE
      );
    `;
    
    // Non abbiamo più una tabella RecentProjects separata, la deriveremo da Projects.updated_at o da una logica di accesso.
    // Per semplicità iniziale, la dashboard mostrerà i progetti ordinati per updated_at.

    // Tabelle per sistema preset partecipanti
    const createParticipantPresetsTable = `
      CREATE TABLE IF NOT EXISTS ParticipantPresets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'motorsport',
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        UNIQUE(user_id, name)
      );
    `;

    const createPresetParticipantsTable = `
      CREATE TABLE IF NOT EXISTS PresetParticipants (
        id TEXT PRIMARY KEY,
        preset_id TEXT NOT NULL,
        numero TEXT NOT NULL,
        nome_pilota TEXT,
        nome_navigatore TEXT,
        nome_terzo TEXT,
        nome_quarto TEXT,
        squadra TEXT,
        sponsors TEXT, -- JSON array di sponsor
        metatag TEXT,
        categoria TEXT,
        plate_number TEXT,
        folder_1 TEXT,
        folder_2 TEXT,
        folder_3 TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (preset_id) REFERENCES ParticipantPresets(id) ON DELETE CASCADE,
        UNIQUE(preset_id, numero)
      );
    `;

    // Initialize schema on primary connection
    localDB.exec(createProjectsCacheTable);
    localDB.exec(createExecutionsCacheTable);
    localDB.exec(createParticipantPresetsTable);
    localDB.exec(createPresetParticipantsTable);

    // Migration: Add new columns if they don't exist (for existing databases)
    try {
      localDB.exec('ALTER TABLE PresetParticipants ADD COLUMN categoria TEXT');
    } catch (e) { /* Column already exists */ }
    try {
      localDB.exec('ALTER TABLE PresetParticipants ADD COLUMN plate_number TEXT');
    } catch (e) { /* Column already exists */ }
    try {
      localDB.exec('ALTER TABLE PresetParticipants ADD COLUMN folder_1 TEXT');
    } catch (e) { /* Column already exists */ }
    try {
      localDB.exec('ALTER TABLE PresetParticipants ADD COLUMN folder_2 TEXT');
    } catch (e) { /* Column already exists */ }
    try {
      localDB.exec('ALTER TABLE PresetParticipants ADD COLUMN folder_3 TEXT');
    } catch (e) { /* Column already exists */ }

    // Configure primary connection for optimal performance
    localDB.pragma('journal_mode = WAL');
    localDB.pragma('synchronous = NORMAL');
    localDB.pragma('cache_size = 10000');
    localDB.pragma('temp_store = MEMORY');
    localDB.pragma('mmap_size = 268435456'); // 256MB
    
    console.log('Local cache schema initialized.');
    isDbInitialized = true;

    // Setup DB close handler only after successful initialization
    getElectronApp().on('quit', async () => {
      if (connectionPool) {
        await connectionPool.shutdown();
        connectionPool = null;
      }
      
      if (localDB && localDB.open) {
        localDB.close();
        console.log('Local cache database connection closed.');
      }
    });

  } catch (error) {
    console.error('CRITICAL ERROR initializing local cache (DB instantiation or schema):', error);
    // Consider notifying the user or logging this more prominently if offline cache is critical
    // For now, logging should be sufficient to diagnose if this was the cause.
    // Do not set isDbInitialized = true if it fails here.
  }
}

// --- Types (corrispondenti allo schema Supabase) ---
export interface Project {
  id?: string; // UUID
  user_id: string; // UUID
  name: string;
  base_csv_storage_path?: string | null;
  created_at?: string; // ISO 8601 String
  updated_at?: string; // ISO 8601 String
}

export interface Execution {
  id?: string; // UUID
  project_id?: string | null; // UUID - Opzionale per executions standalone
  user_id: string; // UUID
  name: string;
  specific_csv_storage_path?: string | null;
  execution_at?: string; // ISO 8601 String
  status?: string;
  results_reference?: string | null;
  created_at?: string; // ISO 8601 String
  updated_at?: string; // ISO 8601 String
  // Tracking fields for execution progress
  processed_images?: number; // Number of images successfully processed
  total_images?: number; // Total number of images to process
  category?: string; // Sport category (motorsport, running, altro)
  execution_settings?: Record<string, any>; // Execution configuration (JSONB)
}

// Interfacce per sistema preset partecipanti
export interface ParticipantPreset {
  id?: string;
  user_id: string;
  name: string;
  category?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
  participants?: PresetParticipant[];
}

export interface PresetParticipant {
  id?: string;
  preset_id: string;
  numero: string;
  nome_pilota?: string;
  nome_navigatore?: string;
  nome_terzo?: string;
  nome_quarto?: string;
  squadra?: string;
  sponsors?: string[]; // Array di sponsor
  metatag?: string;
  categoria?: string;        // Category (GT3, F1, MotoGP, etc.)
  plate_number?: string;     // License plate for future car recognition
  folder_1?: string;         // Custom folder 1
  folder_2?: string;         // Custom folder 2
  folder_3?: string;         // Custom folder 3
  created_at?: string;
}

// --- Helper per ottenere l'ID utente corrente ---
function getCurrentUserId(): string | null {
  const authState = authService.getAuthState();
  if (!authState.isAuthenticated || !authState.user?.id) {
    console.warn('User not authenticated or user ID not available');
    return null;
  }
  return authState.user.id;
}

// --- Database retry utility ---
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DB] Attempting ${operationName} (attempt ${attempt}/${maxRetries})`);
      const result = await operation();
      
      if (attempt > 1) {
        console.log(`[DB] ${operationName} succeeded after ${attempt} attempts`);
      }
      
      return result;
    } catch (error: any) {
      lastError = error;
      console.error(`[DB] ${operationName} failed on attempt ${attempt}:`, error.message);
      
      // Don't retry on authentication or permission errors
      if (error.message?.includes('authentication') || 
          error.message?.includes('permission') || 
          error.message?.includes('unauthorized') ||
          error.code === 401 || 
          error.code === 403) {
        console.log(`[DB] Not retrying ${operationName} due to auth/permission error`);
        throw error;
      }
      
      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        console.error(`[DB] ${operationName} failed after ${maxRetries} attempts`);
        break;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.log(`[DB] Retrying ${operationName} in ${Math.round(delay)}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
}

// --- Helper per verificare se l'utente è autenticato e ha un token valido ---
async function ensureAuthenticated(): Promise<boolean> {
  const authState = authService.getAuthState();
  if (!authState.isAuthenticated || !authState.session) {
    console.warn('User not authenticated or session not available');
    return false;
  }
  
  // Verifica se il token è scaduto
  if (authState.session.expires_at) {
    const expiresAt = new Date(authState.session.expires_at);
    const now = new Date();
    if (expiresAt <= now) {
      console.warn('Session token has expired');
      return false;
    }
  }
  
  return true;
}


// --- Projects Data Service (Supabase + Cache) ---

export async function createProjectOnline(projectData: Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<Project> {
  // Ottieni un client Supabase aggiornato
  const client = getSupabaseClient();
  
  const isAuthenticated = await ensureAuthenticated();
  if (!isAuthenticated) throw new Error('User not authenticated or session expired.');
  
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  try {
    // Verifica che l'utente sia autenticato in Supabase
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) {
      console.error('Error getting current user:', userError);
      throw new Error('Failed to verify user authentication: ' + userError.message);
    }
    
    if (!userData || !userData.user || !userData.user.id) {
      console.error('User data is invalid:', userData);
      throw new Error('User authentication is invalid or expired.');
    }
    
    // Usa l'ID utente ottenuto direttamente da Supabase
    const supabaseUserId = userData.user.id;
    console.log('Using Supabase user ID for project creation:', supabaseUserId);
    
    // Verifica che auth.uid() non sia null
    try {
      const { data: authData, error: authError } = await client.rpc('get_auth_uid');
      console.log('auth.uid() result:', authData);
      
      if (authError) {
        console.error('Error getting auth.uid():', authError);
        // Non lanciare un errore qui, prova comunque a creare il progetto
      } else if (!authData) {
        console.warn('auth.uid() is null. This might cause issues with RLS policies.');
      } else if (authData !== supabaseUserId) {
        console.warn(`auth.uid() (${authData}) does not match user ID (${supabaseUserId}). This might cause issues with RLS policies.`);
      }
    } catch (authCheckError) {
      console.error('Exception checking auth.uid():', authCheckError);
      // Non lanciare un errore qui, prova comunque a creare il progetto
    }
    
    // Prova a rinnovare la sessione per assicurarsi che il token sia valido
    try {
      console.log('Refreshing session before creating project...');
      const { data: refreshData, error: refreshError } = await client.auth.refreshSession();
      
      if (refreshError) {
        console.error('Error refreshing session:', refreshError);
        // Non lanciare un errore qui, prova comunque a creare il progetto
      } else if (refreshData && refreshData.session) {
        console.log('Session refreshed successfully. New expiration:', new Date(refreshData.session.expires_at || 0).toLocaleString());
        
        // Aggiorna il client Supabase con la nuova sessione
        await client.auth.setSession({
          access_token: refreshData.session.access_token,
          refresh_token: refreshData.session.refresh_token
        });
        
        // Aggiorna anche il client in authService
        authService.updateSession(refreshData.session);
      }
    } catch (refreshError) {
      console.error('Exception refreshing session:', refreshError);
      // Non lanciare un errore qui, prova comunque a creare il progetto
    }
    
    // Ora prova a inserire il progetto
    console.log('Attempting to create project with user_id:', supabaseUserId);
    
    // Verifica che auth.uid() sia impostato correttamente prima di inserire il progetto
    try {
      console.log('Checking auth.uid() before insert...');
      console.log('Current user ID from authState:', supabaseUserId);
      
      // Verifica lo stato della sessione
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) {
        console.error('Error getting session:', sessionError);
      } else {
        console.log('Current session:', sessionData.session ? 'Valid' : 'Invalid');
        if (sessionData.session) {
          console.log('Session expires at:', new Date(sessionData.session.expires_at || 0).toLocaleString());
          console.log('Session user ID:', sessionData.session.user.id);
        }
      }
      
      // Verifica auth.uid()
      const { data: authUidData, error: authUidError } = await client.rpc('get_auth_uid');
      console.log('Final auth.uid() check before insert:', authUidData);
      
      if (authUidError) {
        console.error('Error in final auth.uid() check:', authUidError);
        console.error('Error details:', JSON.stringify(authUidError));
      } else if (!authUidData) {
        console.warn('Final auth.uid() check returned null. This will likely cause RLS policy violations.');
        
        // Prova a verificare se la funzione esiste
        try {
          const { data: funcData, error: funcError } = await client.rpc('get_auth_uid');
          console.log('Function check result:', funcData, funcError);
        } catch (funcCheckError) {
          console.error('Exception checking function existence:', funcCheckError);
        }
      } else if (authUidData !== supabaseUserId) {
        console.warn(`auth.uid() (${authUidData}) does not match user ID (${supabaseUserId}). This might cause issues with RLS policies.`);
      }
    } catch (finalAuthCheckError) {
      console.error('Exception in final auth.uid() check:', finalAuthCheckError);
    }
    
    const { data, error } = await withRetry(
      async () => {
        const result = await client
          .from('projects')
          .insert([{ ...projectData, user_id: supabaseUserId }])
          .select()
          .single();
        return result;
      },
      'createProject'
    );

    if (error) {
      console.error('Error creating project:', error);
      
      // Se l'errore è relativo a RLS, fornisci un messaggio più chiaro e dettagliato
      if (error.message && error.message.includes('row-level security')) {
        console.error('RLS policy violation detected. User ID:', supabaseUserId);
        console.error('Project data:', projectData);
        
        // Tenta di ottenere informazioni di debug aggiuntive
        try {
          const { data: debugData } = await client.rpc('get_auth_uid');
          console.error('Debug - auth.uid():', debugData);
        } catch (debugError) {
          console.error('Error getting debug info:', debugError);
        }
        
        throw new Error(
          'Permission denied: You do not have permission to create projects. ' +
          'This is due to a Row Level Security (RLS) policy violation. ' +
          'Please try logging out and logging back in. ' +
          'If the problem persists, contact support with error code: RLS-PROJ-CREATE.'
        );
      }
      
      throw error;
    }
    
    if (!data) throw new Error('Failed to create project: no data returned.');
    
    console.log('Project created successfully:', data);
    
    // Aggiorna la cache locale
    await cacheProjectLocal(data as Project);
    return data as Project;
  } catch (error) {
    console.error('Exception creating project:', error);
    throw error;
  }
}

export async function getProjectsOnline(): Promise<Project[]> {
  const userId = getCurrentUserId();
  if (!userId) return []; // O lancia un errore se preferisci

  const { data, error } = await withRetry(
    async () => {
      const result = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      return result;
    },
    'getProjectsOnline'
  );

  if (error) throw error;
  
  // Aggiorna la cache locale
  if (data) {
    await clearProjectsCacheForUser(userId); // Pulisci la cache prima di ripopolarla per questo utente
    
    // Batch cache operations for better performance
    if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations && data.length > 5) {
      const batchOperations = data.map((p: any) => ({
        sql: 'INSERT OR REPLACE INTO Projects (id, user_id, name, base_csv_storage_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        params: [p.id, p.user_id, p.name, p.base_csv_storage_path, p.created_at, p.updated_at]
      }));
      
      try {
        await connectionPool.executeBatch(batchOperations);
      } catch (error) {
        console.error('[DB] Error batch caching projects:', error);
        // Fallback to individual caching
        for (const p of data) {
          await cacheProjectLocal(p as Project);
        }
      }
    } else {
      // Individual caching for smaller datasets
      for (const p of data) {
        await cacheProjectLocal(p as Project);
      }
    }
  }
  return (data as Project[]) || [];
}

export async function getProjectByIdOnline(id: string): Promise<Project | null> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId) // Assicura che l'utente possa accedere solo ai propri progetti
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // "PGRST116: The result contains 0 rows"
    throw error;
  }
  if (data) await cacheProjectLocal(data as Project);
  return data as Project | null;
}

export async function updateProjectOnline(id: string, projectUpdateData: Partial<Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<Project> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { data, error } = await supabase
    .from('projects')
    .update(projectUpdateData)
    .eq('id', id)
    .eq('user_id', userId) // Assicura che l'utente possa aggiornare solo i propri progetti
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to update project or project not found.');

  await cacheProjectLocal(data as Project);
  return data as Project;
}

export async function deleteProjectOnline(id: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId); // Assicura che l'utente possa cancellare solo i propri progetti

  if (error) throw error;
  
  // Rimuovi dalla cache locale
  await deleteProjectFromCache(id);
}

// --- Projects Local Cache Functions ---
function ensureDbInitialized(operationName: string): boolean {
  if (!isDbInitialized || !localDB) {
    console.error(`Database not initialized. Cannot perform operation: ${operationName}`);
    // Optionally, attempt to initialize if not already:
    // if (!isDbInitialized) {
    //   console.warn("Attempting late DB initialization for operation:", operationName);
    //   initializeLocalCacheSchema(); // This might be problematic if app is not ready
    // }
    // if (!isDbInitialized || !localDB) return false; // Re-check
    return false;
  }
  return true;
}

async function cacheProjectLocal(project: Project): Promise<void> {
  if (!ensureDbInitialized('cacheProjectLocal')) return;
  if (!project.id) return; // Necessario ID per la cache
  
  if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
    try {
      await connectionPool.executeRun(
        'INSERT OR REPLACE INTO Projects (id, user_id, name, base_csv_storage_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [project.id, project.user_id, project.name, project.base_csv_storage_path, project.created_at, project.updated_at]
      );
    } catch (error) {
      console.error('[DB] Error caching project (pool):', error);
      // Fallback to direct connection
      const stmt = localDB.prepare(
        'INSERT OR REPLACE INTO Projects (id, user_id, name, base_csv_storage_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      stmt.run(project.id, project.user_id, project.name, project.base_csv_storage_path, project.created_at, project.updated_at);
    }
  } else {
    const stmt = localDB.prepare(
      'INSERT OR REPLACE INTO Projects (id, user_id, name, base_csv_storage_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(project.id, project.user_id, project.name, project.base_csv_storage_path, project.created_at, project.updated_at);
  }
}

async function getProjectByIdFromCache(id: string): Promise<Project | undefined> {
  if (!ensureDbInitialized('getProjectByIdFromCache')) return undefined;
  
  if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
    try {
      return await connectionPool.executeQuery<Project>('SELECT * FROM Projects WHERE id = ?', [id]);
    } catch (error) {
      console.error('[DB] Error getting project from cache (pool):', error);
      // Fallback to direct connection
      const stmt = localDB.prepare('SELECT * FROM Projects WHERE id = ?');
      return stmt.get(id) as Project | undefined;
    }
  } else {
    const stmt = localDB.prepare('SELECT * FROM Projects WHERE id = ?');
    return stmt.get(id) as Project | undefined;
  }
}

async function getAllProjectsFromCache(userId: string): Promise<Project[]> {
  if (!ensureDbInitialized('getAllProjectsFromCache')) return [];
  
  if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
    try {
      return await connectionPool.executeAll<Project>('SELECT * FROM Projects WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
    } catch (error) {
      console.error('[DB] Error getting all projects from cache (pool):', error);
      // Fallback to direct connection
      const stmt = localDB.prepare('SELECT * FROM Projects WHERE user_id = ? ORDER BY updated_at DESC');
      return stmt.all(userId) as Project[];
    }
  } else {
    const stmt = localDB.prepare('SELECT * FROM Projects WHERE user_id = ? ORDER BY updated_at DESC');
    return stmt.all(userId) as Project[];
  }
}

async function deleteProjectFromCache(id: string): Promise<void> {
  if (!ensureDbInitialized('deleteProjectFromCache')) return;
  
  if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
    try {
      await connectionPool.executeRun('DELETE FROM Projects WHERE id = ?', [id]);
    } catch (error) {
      console.error('[DB] Error deleting project from cache (pool):', error);
      // Fallback to direct connection
      const stmt = localDB.prepare('DELETE FROM Projects WHERE id = ?');
      stmt.run(id);
    }
  } else {
    const stmt = localDB.prepare('DELETE FROM Projects WHERE id = ?');
    stmt.run(id);
  }
}

async function clearProjectsCacheForUser(userId: string): Promise<void> {
  if (!ensureDbInitialized('clearProjectsCacheForUser')) return;
  
  if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
    try {
      await connectionPool.executeRun('DELETE FROM Projects WHERE user_id = ?', [userId]);
    } catch (error) {
      console.error('[DB] Error clearing projects cache (pool):', error);
      // Fallback to direct connection
      const stmt = localDB.prepare('DELETE FROM Projects WHERE user_id = ?');
      stmt.run(userId);
    }
  } else {
    const stmt = localDB.prepare('DELETE FROM Projects WHERE user_id = ?');
    stmt.run(userId);
  }
}

// --- Executions Data Service (Supabase + Cache) ---
// TODO: Implementare funzioni simili per Executions (createExecutionOnline, getExecutionsByProjectIdOnline, etc.)
// e le relative funzioni di caching (cacheExecutionLocal, getExecutionsFromCache, etc.)

export async function getExecutionsByProjectIdOnline(projectId: string): Promise<Execution[]> {
  const userId = getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('executions')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId) // Assicura che l'utente possa accedere solo alle esecuzioni dei propri progetti
    .order('execution_at', { ascending: false });
  
  if (error) throw error;

  // TODO: Cache executions locally
  if (data) {
    // clearExecutionsCacheForProject(projectId); // Pulisci prima di ripopolare
    // data.forEach(e => cacheExecutionLocal(e as Execution));
  }
  return (data as Execution[]) || [];
}

export async function createExecutionOnline(executionData: Omit<Execution, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<Execution> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { data, error } = await supabase
    .from('executions')
    .insert([{ ...executionData, user_id: userId }])
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to create execution: no data returned.');
  
  // cacheExecutionLocal(data as Execution); // TODO: Implementare caching
  return data as Execution;
}

export async function getExecutionByIdOnline(id: string): Promise<Execution | null> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { data, error } = await supabase
    .from('executions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  // if (data) cacheExecutionLocal(data as Execution); // TODO: Implementare caching
  return data as Execution | null;
}

export async function updateExecutionOnline(id: string, executionUpdateData: Partial<Omit<Execution, 'id' | 'user_id' | 'project_id' | 'created_at' | 'updated_at'>>): Promise<Execution> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { data, error } = await supabase
    .from('executions')
    .update(executionUpdateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  
  if (error) throw error;
  if (!data) throw new Error('Failed to update execution or execution not found.');

  // cacheExecutionLocal(data as Execution); // TODO: Implementare caching
  return data as Execution;
}

export async function deleteExecutionOnline(id: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const { error } = await supabase
    .from('executions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
  
  // deleteExecutionFromCache(id); // TODO: Implementare caching
}


// --- Executions Local Cache Functions (da implementare) ---
/*
function cacheExecutionLocal(execution: Execution): void {
  // ...
}

function getExecutionByIdFromCache(id: string): Execution | undefined {
  // ...
}

function getAllExecutionsForProjectFromCache(projectId: string): Execution[] {
  // ...
}

function deleteExecutionFromCache(id: string): void {
  // ...
}

function clearExecutionsCacheForProject(projectId: string): void {
  // ...
}
*/

// --- Recent Projects Logic (derivata dalla cache) ---
export async function getRecentProjectsFromCache(userId: string, limit: number = 5): Promise<Project[]> {
  if (!ensureDbInitialized('getRecentProjectsFromCache')) return [];
  
  if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
    try {
      return await connectionPool.executeAll<Project>('SELECT * FROM Projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?', [userId, limit]);
    } catch (error) {
      console.error('[DB] Error getting recent projects from cache (pool):', error);
      // Fallback to direct connection
      const stmt = localDB.prepare('SELECT * FROM Projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?');
      return stmt.all(userId, limit) as Project[];
    }
  } else {
    const stmt = localDB.prepare('SELECT * FROM Projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?');
    return stmt.all(userId, limit) as Project[];
  }
}

// --- File Storage (Supabase Storage) ---
const CSV_BUCKET_NAME = 'project-files'; // Come definito dall'utente

export async function uploadCsvToStorage(projectId: string, file: Buffer, fileName: string): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated for file upload.');

  // Crea un percorso univoco per il file, es. user_id/project_id/timestamp_filename.csv
  const filePath = `${userId}/${projectId}/${Date.now()}_${fileName}`;

  const { data, error } = await supabase.storage
    .from(CSV_BUCKET_NAME)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false, // Non sovrascrivere se esiste, gestisci la logica di aggiornamento se necessario
      contentType: 'text/csv'
    });

  if (error) throw error;
  return data.path; // Ritorna il percorso del file nello storage
}

export async function downloadCsvFromStorage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(CSV_BUCKET_NAME)
    .download(storagePath);

  if (error) throw error;
  if (!data) throw new Error('Failed to download CSV: no data returned.');
  
  // data è un Blob, convertilo in Buffer
  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer;
}


/**
 * Get database connection pool stats
 */
export function getDatabaseStats() {
  if (!connectionPool) {
    return {
      poolEnabled: false,
      optimizationsEnabled: PERFORMANCE_CONFIG.enableParallelOptimizations
    };
  }
  
  return {
    poolEnabled: true,
    optimizationsEnabled: PERFORMANCE_CONFIG.enableParallelOptimizations,
    ...connectionPool.getStats()
  };
}

/**
 * Update database configuration based on performance settings
 */
export async function updateDatabaseConfiguration(): Promise<void> {
  if (!connectionPool) {
    console.log('[DB] Connection pool not available for configuration update');
    return;
  }
  
  console.log(`[DB] Performance optimizations: ${PERFORMANCE_CONFIG.enableParallelOptimizations ? 'ENABLED' : 'DISABLED'}`);
  
  // Connection pool adjusts automatically based on PERFORMANCE_CONFIG settings
  // No manual adjustment needed since constructor reads from PERFORMANCE_CONFIG
}

/**
 * Execute multiple database operations in a batch for better performance
 */
export async function executeBatchOperations(operations: Array<{ sql: string; params?: any[] }>): Promise<any[]> {
  if (!connectionPool || !PERFORMANCE_CONFIG.enableParallelOptimizations) {
    // Fallback to sequential execution
    const results = [];
    for (const op of operations) {
      const stmt = localDB.prepare(op.sql);
      results.push(stmt.run(...(op.params || [])));
    }
    return results;
  }
  
  return await connectionPool.executeBatch(operations);
}

/**
 * Flush all pending batch operations
 */
export async function flushPendingOperations(): Promise<void> {
  if (connectionPool) {
    // Wait for all queued operations to complete
    let maxWait = 5000; // 5 seconds max
    const start = Date.now();
    
    while (connectionPool.getStats().queuedBatches > 0 && (Date.now() - start) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// --- LOGOUT SYNC AND CLEANUP FUNCTIONS ---

/**
 * Sincronizza tutti i dati locali dell'utente su Supabase prima del logout
 */
export async function syncAllUserDataToSupabase(userId: string): Promise<void> {
  if (!ensureDbInitialized('syncAllUserDataToSupabase')) return;
  
  console.log(`[DB] Starting sync of all user data to Supabase for user: ${userId}`);
  
  try {
    // 1. Sincronizza Projects non ancora sincronizzati
    await syncUserProjectsToSupabase(userId);
    
    // 2. Sincronizza Executions non ancora sincronizzate
    await syncUserExecutionsToSupabase(userId);
    
    console.log(`[DB] Successfully synced all user data to Supabase`);
  } catch (error) {
    console.error('[DB] Error syncing user data to Supabase:', error);
    throw error;
  }
}

/**
 * Sincronizza i Projects dell'utente su Supabase
 */
async function syncUserProjectsToSupabase(userId: string): Promise<void> {
  try {
    // Ottieni tutti i projects dell'utente dal cache locale
    const localProjects = connectionPool 
      ? await connectionPool.executeQuery<Project[]>('SELECT * FROM Projects WHERE user_id = ?', [userId])
      : localDB.prepare('SELECT * FROM Projects WHERE user_id = ?').all(userId) as Project[];
    
    if (!localProjects || localProjects.length === 0) {
      console.log('[DB] No local projects to sync');
      return;
    }
    
    console.log(`[DB] Syncing ${localProjects.length} projects to Supabase`);
    
    // Per ogni project, assicurati che sia sincronizzato
    for (const project of localProjects) {
      try {
        // Verifica se il project esiste già su Supabase
        const existingProject = await getProjectByIdOnline(project.id!);
        
        if (!existingProject) {
          // Crea nuovo project su Supabase
          await createProjectOnline({
            name: project.name,
            base_csv_storage_path: project.base_csv_storage_path
          });
          console.log(`[DB] Created project on Supabase: ${project.name}`);
        } else {
          // Aggiorna project esistente se necessario
          if (project.updated_at && existingProject.updated_at && 
              new Date(project.updated_at) > new Date(existingProject.updated_at)) {
            await updateProjectOnline(project.id!, {
              name: project.name,
              base_csv_storage_path: project.base_csv_storage_path
            });
            console.log(`[DB] Updated project on Supabase: ${project.name}`);
          }
        }
      } catch (projectError) {
        console.error(`[DB] Error syncing project ${project.name}:`, projectError);
        // Continua con gli altri progetti
      }
    }
  } catch (error) {
    console.error('[DB] Error in syncUserProjectsToSupabase:', error);
    throw error;
  }
}

/**
 * Sincronizza le Executions dell'utente su Supabase
 */
async function syncUserExecutionsToSupabase(userId: string): Promise<void> {
  try {
    // Ottieni tutte le executions dell'utente dal cache locale
    const localExecutions = connectionPool 
      ? await connectionPool.executeQuery<Execution[]>('SELECT * FROM Executions WHERE user_id = ?', [userId])
      : localDB.prepare('SELECT * FROM Executions WHERE user_id = ?').all(userId) as Execution[];
    
    if (!localExecutions || localExecutions.length === 0) {
      console.log('[DB] No local executions to sync');
      return;
    }
    
    console.log(`[DB] Syncing ${localExecutions.length} executions to Supabase`);
    
    // Per ogni execution, assicurati che sia sincronizzata
    for (const execution of localExecutions) {
      try {
        // Verifica se l'execution esiste già su Supabase
        const existingExecution = await getExecutionByIdOnline(execution.id!);
        
        if (!existingExecution) {
          // Crea nuova execution su Supabase
          await createExecutionOnline({
            project_id: execution.project_id,
            name: execution.name,
            specific_csv_storage_path: execution.specific_csv_storage_path,
            status: execution.status,
            results_reference: execution.results_reference
          });
          console.log(`[DB] Created execution on Supabase: ${execution.name}`);
        } else {
          // Aggiorna execution esistente se necessario
          if (execution.updated_at && existingExecution.updated_at && 
              new Date(execution.updated_at) > new Date(existingExecution.updated_at)) {
            await updateExecutionOnline(execution.id!, {
              name: execution.name,
              specific_csv_storage_path: execution.specific_csv_storage_path,
              status: execution.status,
              results_reference: execution.results_reference
            });
            console.log(`[DB] Updated execution on Supabase: ${execution.name}`);
          }
        }
      } catch (executionError) {
        console.error(`[DB] Error syncing execution ${execution.name}:`, executionError);
        // Continua con le altre executions
      }
    }
  } catch (error) {
    console.error('[DB] Error in syncUserExecutionsToSupabase:', error);
    throw error;
  }
}

/**
 * Pulisce TUTTI i dati dell'utente dal database locale
 */
export async function clearAllUserData(userId: string): Promise<void> {
  if (!ensureDbInitialized('clearAllUserData')) return;
  
  console.log(`[DB] Clearing all local data for user: ${userId}`);
  
  try {
    if (connectionPool && PERFORMANCE_CONFIG.enableParallelOptimizations) {
      // Usa connection pool per operazioni batch
      const operations = [
        { sql: 'DELETE FROM Projects WHERE user_id = ?', params: [userId] },
        { sql: 'DELETE FROM Executions WHERE user_id = ?', params: [userId] }
      ];
      
      await connectionPool.executeBatch(operations);
    } else {
      // Fallback a operazioni singole
      const deleteProjectsStmt = localDB.prepare('DELETE FROM Projects WHERE user_id = ?');
      const deleteExecutionsStmt = localDB.prepare('DELETE FROM Executions WHERE user_id = ?');
      
      deleteProjectsStmt.run(userId);
      deleteExecutionsStmt.run(userId);
    }
    
    console.log(`[DB] Successfully cleared all local data for user`);
  } catch (error) {
    console.error('[DB] Error clearing user data:', error);
    throw error;
  }
}

/**
 * Ottieni statistiche sui dati dell'utente prima della sincronizzazione
 */
export async function getUserDataStats(userId: string): Promise<{projectsCount: number, executionsCount: number}> {
  if (!ensureDbInitialized('getUserDataStats')) return { projectsCount: 0, executionsCount: 0 };
  
  try {
    const projectsCount = connectionPool 
      ? await connectionPool.executeQuery<number>('SELECT COUNT(*) as count FROM Projects WHERE user_id = ?', [userId])
      : localDB.prepare('SELECT COUNT(*) as count FROM Projects WHERE user_id = ?').get(userId) as any;
    
    const executionsCount = connectionPool 
      ? await connectionPool.executeQuery<number>('SELECT COUNT(*) as count FROM Executions WHERE user_id = ?', [userId])
      : localDB.prepare('SELECT COUNT(*) as count FROM Executions WHERE user_id = ?').get(userId) as any;
    
    return {
      projectsCount: projectsCount?.count || 0,
      executionsCount: executionsCount?.count || 0
    };
  } catch (error) {
    console.error('[DB] Error getting user data stats:', error);
    return { projectsCount: 0, executionsCount: 0 };
  }
}

// --- CSV STORAGE AND SYNC FUNCTIONS ---

export interface UserCsvMetadata {
  id?: string;
  user_id: string;
  csv_name: string;
  storage_path: string;
  last_used: string;
  created_at: string;
}

/**
 * Salva i dati CSV correnti su Supabase Storage e crea metadati
 */
export async function saveCsvToSupabase(csvData: any[], csvName: string): Promise<UserCsvMetadata> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated for CSV upload.');
  
  try {
    // 1. Converti i dati CSV in Buffer
    const csvContent = convertArrayToCsv(csvData);
    const csvBuffer = Buffer.from(csvContent, 'utf8');
    
    // 2. Upload del CSV su Supabase Storage
    const timestamp = Date.now();
    const storagePath = `${userId}/csv/${timestamp}_${csvName}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(CSV_BUCKET_NAME)
      .upload(storagePath, csvBuffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'text/csv'
      });
      
    if (uploadError) throw uploadError;
    
    // 3. Salva i metadati nella tabella user_csv_metadata
    const csvMetadata: Omit<UserCsvMetadata, 'id' | 'created_at'> = {
      user_id: userId,
      csv_name: csvName,
      storage_path: storagePath,
      last_used: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('user_csv_metadata')
      .insert(csvMetadata)
      .select()
      .single();
      
    if (error) throw error;
    
    console.log(`[DB] Successfully saved CSV to Supabase: ${csvName}`);
    return data as UserCsvMetadata;
    
  } catch (error) {
    console.error('[DB] Error saving CSV to Supabase:', error);
    throw error;
  }
}

/**
 * Carica l'ultimo CSV usato dall'utente da Supabase
 */
export async function loadLastUsedCsvFromSupabase(): Promise<any[] | null> {
  const userId = getCurrentUserId();
  if (!userId) return null;
  
  try {
    // 1. Ottieni l'ultimo CSV usato dall'utente
    const { data: metadata, error: metaError } = await supabase
      .from('user_csv_metadata')
      .select('*')
      .eq('user_id', userId)
      .order('last_used', { ascending: false })
      .limit(1)
      .single();
      
    if (metaError || !metadata) {
      console.log('[DB] No CSV metadata found for user');
      return null;
    }
    
    // 2. Scarica il CSV da Storage
    const { data: csvData, error: downloadError } = await supabase.storage
      .from(CSV_BUCKET_NAME)
      .download(metadata.storage_path);
      
    if (downloadError) throw downloadError;
    if (!csvData) throw new Error('No CSV data downloaded');
    
    // 3. Converti il Blob in testo e parsifica
    const csvText = await csvData.text();
    const parsedData = parseCsvContent(csvText);
    
    console.log(`[DB] Successfully loaded CSV from Supabase: ${metadata.csv_name} (${parsedData.length} entries)`);
    return parsedData;
    
  } catch (error) {
    console.error('[DB] Error loading CSV from Supabase:', error);
    return null;
  }
}

/**
 * Aggiorna il timestamp last_used per un CSV
 */
export async function updateCsvLastUsed(csvName: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) return;
  
  try {
    const { error } = await supabase
      .from('user_csv_metadata')
      .update({ last_used: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('csv_name', csvName);
      
    if (error) throw error;
    
  } catch (error) {
    console.error('[DB] Error updating CSV last used:', error);
  }
}

/**
 * Ottieni tutti i CSV dell'utente da Supabase
 */
export async function getUserCsvList(): Promise<UserCsvMetadata[]> {
  const userId = getCurrentUserId();
  if (!userId) return [];
  
  try {
    const { data, error } = await supabase
      .from('user_csv_metadata')
      .select('*')
      .eq('user_id', userId)
      .order('last_used', { ascending: false });
      
    if (error) throw error;
    
    return data || [];
    
  } catch (error) {
    console.error('[DB] Error getting user CSV list:', error);
    return [];
  }
}

/**
 * Converte array di oggetti in formato CSV
 */
function convertArrayToCsv(data: any[]): string {
  if (!data || data.length === 0) return '';
  
  // Ottieni tutte le chiavi possibili
  const allKeys = new Set<string>();
  data.forEach(row => Object.keys(row).forEach(key => allKeys.add(key)));
  const headers = Array.from(allKeys);
  
  // Crea header CSV
  const csvHeaders = headers.join(',');
  
  // Crea righe CSV
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header] || '';
      // Escape delle virgolette e wrapping se contiene virgole
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
}

/**
 * Parsifica contenuto CSV in array di oggetti
 */
function parseCsvContent(csvContent: string): any[] {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const results: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const entry: any = {};
    
    headers.forEach((header, index) => {
      entry[header] = values[index] || '';
    });
    
    results.push(entry);
  }
  
  return results;
}

// --- EXECUTION SETTINGS TRACKING SYSTEM ---

/**
 * Interface per tracciare le impostazioni di ogni execution
 * Permette di analizzare l'uso dell'app e le preferenze degli utenti
 */
export interface ExecutionSettings {
  id?: string;
  execution_id: string;
  user_id?: string;
  created_at?: string;
  
  // Impostazioni Modello AI
  ai_model?: string;
  sport_category?: string;
  
  // Gestione Metadati
  metadata_strategy?: string;
  manual_metadata_value?: string;
  update_exif?: boolean;
  save_preview_images?: boolean;
  preview_folder?: string;
  
  // Configurazioni Resize
  resize_enabled?: boolean;
  resize_preset?: string;
  
  // Elaborazione Parallela
  parallel_processing_enabled?: boolean;
  streaming_pipeline_enabled?: boolean;
  max_concurrent_uploads?: number;
  max_concurrent_analysis?: number;
  rate_limit_per_second?: number;
  batch_size?: number;
  
  // Organizzazione Cartelle
  folder_organization_enabled?: boolean;
  folder_organization_mode?: string;
  folder_organization_pattern?: string;
  folder_organization_custom_pattern?: string;
  create_unknown_folder?: boolean;
  unknown_folder_name?: string;
  include_xmp_files?: boolean;
  
  // Ottimizzazioni Performance
  optimization_level?: string;
  performance_monitoring_enabled?: boolean;
  session_resume_enabled?: boolean;
  connection_pooling_enabled?: boolean;
  raw_optimizations_enabled?: boolean;
  raw_batch_size?: number;
  raw_cache_enabled?: boolean;
  async_file_ops_enabled?: boolean;
  database_optimizations_enabled?: boolean;
  batch_operations_enabled?: boolean;
  storage_optimizations_enabled?: boolean;
  memory_optimizations_enabled?: boolean;
  max_memory_usage_mb?: number;
  memory_pooling_enabled?: boolean;
  cpu_optimizations_enabled?: boolean;
  streaming_processing_enabled?: boolean;
  auto_tuning_enabled?: boolean;
  predictive_loading_enabled?: boolean;
  
  // Statistiche Esecuzione
  total_images_processed?: number;
  total_raw_files?: number;
  total_standard_files?: number;
  csv_data_used?: boolean;
  csv_entries_count?: number;
  
  // Timing e Performance
  execution_duration_ms?: number;
  average_image_processing_time_ms?: number;
}

/**
 * Salva le impostazioni di un'execution su Supabase per l'analisi
 */
export async function saveExecutionSettings(settings: Omit<ExecutionSettings, 'id' | 'user_id' | 'created_at'>): Promise<ExecutionSettings> {
  const userId = getCurrentUserId();
  if (!userId) {
    console.warn('User not authenticated, skipping execution settings tracking');
    throw new Error('User not authenticated');
  }

  try {
    const { data, error } = await withRetry(
      async () => {
        const result = await supabase
          .from('execution_settings')
          .insert([{ ...settings, user_id: userId }])
          .select()
          .single();
        return result;
      },
      'saveExecutionSettings'
    );

    if (error) {
      console.error('Error saving execution settings:', error);
      throw error;
    }
    
    if (!data) {
      throw new Error('Failed to save execution settings: no data returned.');
    }
    
    console.log('[DB] Execution settings saved successfully:', data.id);
    return data as ExecutionSettings;
    
  } catch (error) {
    console.error('[DB] Error saving execution settings:', error);
    // Non lanciamo l'errore per non bloccare l'execution principale
    // Il tracciamento è facoltativo
    throw error;
  }
}

/**
 * Recupera le impostazioni di un'execution specifica
 */
export async function getExecutionSettings(executionId: string): Promise<ExecutionSettings | null> {
  const userId = getCurrentUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('execution_settings')
      .select('*')
      .eq('execution_id', executionId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows found
      console.error('Error getting execution settings:', error);
      return null;
    }

    return data as ExecutionSettings | null;
    
  } catch (error) {
    console.error('[DB] Error getting execution settings:', error);
    return null;
  }
}

/**
 * Recupera le statistiche aggregate delle impostazioni dell'utente
 */
export async function getUserSettingsAnalytics(userId?: string): Promise<any> {
  const currentUserId = userId || getCurrentUserId();
  if (!currentUserId) return null;

  try {
    const { data, error } = await supabase
      .from('execution_settings')
      .select(`
        ai_model,
        sport_category,
        metadata_strategy,
        resize_preset,
        resize_enabled,
        parallel_processing_enabled,
        streaming_pipeline_enabled,
        folder_organization_enabled,
        optimization_level,
        csv_data_used,
        total_images_processed,
        execution_duration_ms,
        created_at
      `)
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting user settings analytics:', error);
      return null;
    }

    // Calcola statistiche aggregate
    const analytics = {
      total_executions: data.length,
      
      // Modelli AI più usati
      most_used_models: getMostUsedValues(data, 'ai_model'),
      
      // Categorie sport più usate
      most_used_categories: getMostUsedValues(data, 'sport_category'),
      
      // Strategie metadati preferite
      preferred_metadata_strategies: getMostUsedValues(data, 'metadata_strategy'),
      
      // Preset resize preferiti
      preferred_resize_presets: getMostUsedValues(data, 'resize_preset'),
      
      // Livelli ottimizzazione preferiti
      preferred_optimization_levels: getMostUsedValues(data, 'optimization_level'),
      
      // Percentuali utilizzo funzionalità
      feature_usage_rates: {
        resize_enabled: calculateUsageRate(data, 'resize_enabled'),
        parallel_processing: calculateUsageRate(data, 'parallel_processing_enabled'),
        streaming_pipeline: calculateUsageRate(data, 'streaming_pipeline_enabled'),
        folder_organization: calculateUsageRate(data, 'folder_organization_enabled'),
        csv_data_used: calculateUsageRate(data, 'csv_data_used')
      },
      
      // Performance medie
      performance_stats: {
        avg_images_per_execution: calculateAverage(data, 'total_images_processed'),
        avg_execution_duration_ms: calculateAverage(data, 'execution_duration_ms'),
        total_images_processed: data.reduce((sum, item) => sum + (item.total_images_processed || 0), 0)
      },
      
      // Trend temporali (ultimi 6 mesi)
      monthly_usage: getMonthlyUsage(data)
    };

    return analytics;
    
  } catch (error) {
    console.error('[DB] Error getting user settings analytics:', error);
    return null;
  }
}

/**
 * Helper per calcolare i valori più usati
 */
function getMostUsedValues(data: any[], field: string, limit: number = 5): { value: string; count: number; percentage: number }[] {
  const counts: { [key: string]: number } = {};
  const total = data.length;
  
  data.forEach(item => {
    const value = item[field];
    if (value) {
      counts[value] = (counts[value] || 0) + 1;
    }
  });
  
  return Object.entries(counts)
    .map(([value, count]) => ({
      value,
      count,
      percentage: (count / total) * 100
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Helper per calcolare il tasso di utilizzo di una funzionalità
 */
function calculateUsageRate(data: any[], field: string): number {
  if (data.length === 0) return 0;
  const used = data.filter(item => item[field] === true).length;
  return (used / data.length) * 100;
}

/**
 * Helper per calcolare la media di un campo numerico
 */
function calculateAverage(data: any[], field: string): number {
  const values = data.filter(item => item[field] !== null && item[field] !== undefined);
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, item) => acc + (item[field] || 0), 0);
  return sum / values.length;
}

/**
 * Helper per calcolare l'utilizzo mensile
 */
function getMonthlyUsage(data: any[]): { month: string; executions: number; avg_images: number }[] {
  const monthly: { [key: string]: { count: number; totalImages: number } } = {};
  
  data.forEach(item => {
    const date = new Date(item.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthly[monthKey]) {
      monthly[monthKey] = { count: 0, totalImages: 0 };
    }
    
    monthly[monthKey].count += 1;
    monthly[monthKey].totalImages += item.total_images_processed || 0;
  });
  
  return Object.entries(monthly)
    .map(([month, stats]) => ({
      month,
      executions: stats.count,
      avg_images: stats.count > 0 ? Math.round(stats.totalImages / stats.count) : 0
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6); // Ultimi 6 mesi
}

/**
 * Funzione helper per estrarre le impostazioni da BatchProcessConfig
 * Converte le configurazioni dell'app nelle impostazioni da tracciare
 */
export function extractSettingsFromConfig(
  config: any, // BatchProcessConfig dal main.ts
  executionId: string,
  executionStats?: {
    totalImages?: number;
    totalRawFiles?: number;
    totalStandardFiles?: number;
    executionDurationMs?: number;
    averageImageProcessingTimeMs?: number;
  }
): Omit<ExecutionSettings, 'id' | 'user_id' | 'created_at'> {
  return {
    execution_id: executionId,
    
    // Impostazioni AI
    ai_model: config.model,
    sport_category: config.category,
    
    // Gestione Metadati
    metadata_strategy: config.metadataStrategy,
    manual_metadata_value: config.manualMetadataValue,
    update_exif: config.updateExif,
    save_preview_images: config.savePreviewImages,
    preview_folder: config.previewFolder,
    
    // Configurazioni Resize
    resize_enabled: config.resize?.enabled || false,
    resize_preset: config.resize?.preset,
    
    // Elaborazione Parallela
    parallel_processing_enabled: config.useParallelProcessing || false,
    streaming_pipeline_enabled: config.useStreamingPipeline || false,
    max_concurrent_uploads: config.parallelization?.maxConcurrentUploads,
    max_concurrent_analysis: config.parallelization?.maxConcurrentAnalysis,
    rate_limit_per_second: config.parallelization?.rateLimitPerSecond,
    batch_size: config.parallelization?.batchSize,
    
    // Organizzazione Cartelle
    folder_organization_enabled: config.folderOrganization?.enabled || false,
    folder_organization_mode: config.folderOrganization?.mode,
    folder_organization_pattern: config.folderOrganization?.pattern,
    folder_organization_custom_pattern: config.folderOrganization?.customPattern,
    create_unknown_folder: config.folderOrganization?.createUnknownFolder,
    unknown_folder_name: config.folderOrganization?.unknownFolderName,
    include_xmp_files: config.folderOrganization?.includeXmpFiles,
    
    // Ottimizzazioni Performance (da PERFORMANCE_CONFIG)
    optimization_level: (global as any).PERFORMANCE_CONFIG?.level || 'balanced',
    performance_monitoring_enabled: (global as any).PERFORMANCE_CONFIG?.enablePerformanceMonitoring || false,
    session_resume_enabled: (global as any).PERFORMANCE_CONFIG?.enableSessionResume || false,
    connection_pooling_enabled: (global as any).PERFORMANCE_CONFIG?.enableConnectionPooling || false,
    raw_optimizations_enabled: (global as any).PERFORMANCE_CONFIG?.enableRawOptimizations || false,
    raw_batch_size: (global as any).PERFORMANCE_CONFIG?.rawBatchSize,
    raw_cache_enabled: (global as any).PERFORMANCE_CONFIG?.enableRawCache || false,
    async_file_ops_enabled: (global as any).PERFORMANCE_CONFIG?.enableAsyncFileOps || false,
    database_optimizations_enabled: (global as any).PERFORMANCE_CONFIG?.enableDatabaseOptimizations || false,
    batch_operations_enabled: (global as any).PERFORMANCE_CONFIG?.enableBatchOperations || false,
    storage_optimizations_enabled: (global as any).PERFORMANCE_CONFIG?.enableStorageOptimizations || false,
    memory_optimizations_enabled: (global as any).PERFORMANCE_CONFIG?.enableMemoryOptimizations || false,
    max_memory_usage_mb: (global as any).PERFORMANCE_CONFIG?.maxMemoryUsageMB,
    memory_pooling_enabled: (global as any).PERFORMANCE_CONFIG?.enableMemoryPooling || false,
    cpu_optimizations_enabled: (global as any).PERFORMANCE_CONFIG?.enableCpuOptimizations || false,
    streaming_processing_enabled: (global as any).PERFORMANCE_CONFIG?.enableStreamingProcessing || false,
    auto_tuning_enabled: (global as any).PERFORMANCE_CONFIG?.enableAutoTuning || false,
    predictive_loading_enabled: (global as any).PERFORMANCE_CONFIG?.enablePredictiveLoading || false,
    
    // Statistiche Esecuzione
    total_images_processed: executionStats?.totalImages || 0,
    total_raw_files: executionStats?.totalRawFiles || 0,
    total_standard_files: executionStats?.totalStandardFiles || 0,
    csv_data_used: !!(config.csvData && config.csvData.length > 0),
    csv_entries_count: config.csvData?.length || 0,
    
    // Timing e Performance
    execution_duration_ms: executionStats?.executionDurationMs,
    average_image_processing_time_ms: executionStats?.averageImageProcessingTimeMs
  };
}

// ==================== PRESET PARTECIPANTI CRUD OPERATIONS ====================

/**
 * Crea un nuovo preset partecipanti
 */
export async function createParticipantPreset(presetData: Omit<ParticipantPreset, 'id' | 'created_at' | 'updated_at'>): Promise<ParticipantPreset> {
  if (!ensureDbInitialized('createParticipantPreset')) {
    throw new Error('Database not initialized');
  }

  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const preset: ParticipantPreset = {
    ...presetData,
    id,
    user_id: userId,
    created_at: now,
    updated_at: now
  };

  try {
    const stmt = localDB.prepare(`
      INSERT INTO ParticipantPresets (id, user_id, name, category, description, created_at, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      preset.id, preset.user_id, preset.name, preset.category || 'motorsport',
      preset.description, preset.created_at, preset.updated_at, preset.last_used_at
    );

    console.log(`[DB] Created participant preset: ${preset.name}`);
    return preset;
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`A preset named "${presetData.name}" already exists`);
    }
    throw error;
  }
}

/**
 * Ottieni tutti i preset dell'utente corrente
 */
export async function getUserParticipantPresets(): Promise<ParticipantPreset[]> {
  if (!ensureDbInitialized('getUserParticipantPresets')) {
    return [];
  }

  const userId = getCurrentUserId();
  if (!userId) return [];

  try {
    const stmt = localDB.prepare(`
      SELECT * FROM ParticipantPresets
      WHERE user_id = ?
      ORDER BY last_used_at DESC, updated_at DESC
    `);

    return stmt.all(userId) as ParticipantPreset[];
  } catch (error) {
    console.error('[DB] Error getting user participant presets:', error);
    return [];
  }
}

/**
 * Ottieni un preset specifico con i suoi partecipanti
 */
export async function getParticipantPresetById(presetId: string): Promise<ParticipantPreset | null> {
  if (!ensureDbInitialized('getParticipantPresetById')) {
    return null;
  }

  const userId = getCurrentUserId();
  if (!userId) return null;

  try {
    const presetStmt = localDB.prepare(`
      SELECT * FROM ParticipantPresets
      WHERE id = ? AND user_id = ?
    `);

    const preset = presetStmt.get(presetId, userId) as ParticipantPreset | undefined;
    if (!preset) return null;

    // Carica i partecipanti
    const participantsStmt = localDB.prepare(`
      SELECT * FROM PresetParticipants
      WHERE preset_id = ?
      ORDER BY numero ASC
    `);

    const participants = participantsStmt.all(presetId) as PresetParticipant[];

    // Parse sponsors JSON
    participants.forEach(p => {
      if (p.sponsors && typeof p.sponsors === 'string') {
        try {
          p.sponsors = JSON.parse(p.sponsors);
        } catch {
          p.sponsors = [];
        }
      }
    });

    preset.participants = participants;
    return preset;
  } catch (error) {
    console.error('[DB] Error getting participant preset by id:', error);
    return null;
  }
}

/**
 * Aggiunge o aggiorna partecipanti in un preset
 */
export async function savePresetParticipants(presetId: string, participants: Omit<PresetParticipant, 'id' | 'created_at'>[]): Promise<void> {
  if (!ensureDbInitialized('savePresetParticipants')) {
    throw new Error('Database not initialized');
  }

  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    // Verifica che il preset appartenga all'utente
    const presetStmt = localDB.prepare('SELECT id FROM ParticipantPresets WHERE id = ? AND user_id = ?');
    const preset = presetStmt.get(presetId, userId);
    if (!preset) throw new Error('Preset not found or access denied');

    // Cancella i partecipanti esistenti
    const deleteStmt = localDB.prepare('DELETE FROM PresetParticipants WHERE preset_id = ?');
    deleteStmt.run(presetId);

    // Inserisci i nuovi partecipanti
    const insertStmt = localDB.prepare(`
      INSERT INTO PresetParticipants
      (id, preset_id, numero, nome_pilota, nome_navigatore, nome_terzo, nome_quarto, squadra, sponsors, metatag, categoria, plate_number, folder_1, folder_2, folder_3, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    for (const participant of participants) {
      const id = crypto.randomUUID();
      const sponsorsJson = participant.sponsors ? JSON.stringify(participant.sponsors) : null;

      insertStmt.run(
        id, presetId, participant.numero, participant.nome_pilota,
        participant.nome_navigatore, participant.nome_terzo, participant.nome_quarto,
        participant.squadra, sponsorsJson, participant.metatag,
        participant.categoria || null, participant.plate_number || null,
        participant.folder_1 || null, participant.folder_2 || null, participant.folder_3 || null,
        now
      );
    }

    // Aggiorna timestamp del preset
    const updatePresetStmt = localDB.prepare('UPDATE ParticipantPresets SET updated_at = ? WHERE id = ?');
    updatePresetStmt.run(now, presetId);

    console.log(`[DB] Saved ${participants.length} participants to preset ${presetId}`);
  } catch (error) {
    console.error('[DB] Error saving preset participants:', error);
    throw error;
  }
}

/**
 * Aggiorna timestamp di ultimo utilizzo del preset
 */
export async function updatePresetLastUsed(presetId: string): Promise<void> {
  if (!ensureDbInitialized('updatePresetLastUsed')) {
    return;
  }

  const userId = getCurrentUserId();
  if (!userId) return;

  try {
    const stmt = localDB.prepare(`
      UPDATE ParticipantPresets
      SET last_used_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(new Date().toISOString(), presetId, userId);
  } catch (error) {
    console.error('[DB] Error updating preset last used:', error);
  }
}

/**
 * Elimina un preset e tutti i suoi partecipanti
 */
export async function deleteParticipantPreset(presetId: string): Promise<void> {
  if (!ensureDbInitialized('deleteParticipantPreset')) {
    throw new Error('Database not initialized');
  }

  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    const stmt = localDB.prepare('DELETE FROM ParticipantPresets WHERE id = ? AND user_id = ?');
    const result = stmt.run(presetId, userId);

    if (result.changes === 0) {
      throw new Error('Preset not found or access denied');
    }

    console.log(`[DB] Deleted participant preset ${presetId}`);
  } catch (error) {
    console.error('[DB] Error deleting participant preset:', error);
    throw error;
  }
}

/**
 * Importa partecipanti da dati CSV esistenti
 */
export async function importParticipantsFromCSV(csvData: any[], presetName: string, category = 'motorsport'): Promise<ParticipantPreset> {
  const preset = await createParticipantPreset({
    user_id: getCurrentUserId() || '',
    name: presetName,
    category,
    description: `Imported from CSV with ${csvData.length} participants`
  });

  const participants: Omit<PresetParticipant, 'id' | 'created_at'>[] = csvData.map(row => ({
    preset_id: preset.id!,
    numero: row.numero || row.Number || '',
    nome_pilota: row.nome || row.Driver || '',
    nome_navigatore: '', // Removed from UI, kept for database compatibility
    nome_terzo: row.nome_terzo || '',
    nome_quarto: row.nome_quarto || '',
    squadra: row.squadra || row.team || row.Team || '',
    sponsors: row.sponsors || row.Sponsors ? (Array.isArray(row.sponsors || row.Sponsors) ? (row.sponsors || row.Sponsors) : [row.sponsors || row.Sponsors]) : [],
    metatag: row.metatag || row.Metatag || '',
    categoria: row.categoria || row.Category || '',
    plate_number: row.plate_number || row.Plate_Number || '',
    folder_1: row.folder_1 || row.Folder_1 || '',
    folder_2: row.folder_2 || row.Folder_2 || '',
    folder_3: row.folder_3 || row.Folder_3 || ''
  }));

  await savePresetParticipants(preset.id!, participants);

  return preset;
}

// ==================== SUPABASE SPORT CATEGORIES OPERATIONS ====================

// Interfacce per Supabase
export interface SportCategory {
  id?: string;
  code: string;
  name: string;
  description?: string;
  ai_prompt: string;
  fallback_prompt?: string;
  expected_fields?: any;
  icon?: string;
  is_active?: boolean;
  display_order?: number;
  edge_function_version?: number;
  created_at?: string;
  updated_at?: string;
  temporal_config?: {
    clusterWindow: number;      // milliseconds - max time between photos to be in same temporal cluster
    burstThreshold: number;     // milliseconds - max time between photos to be considered burst mode
    proximityBonus: number;     // score bonus points for temporal proximity matches
  };
  matching_config?: {
    weights: {
      raceNumber: number;       // weight for race number matches
      driverName: number;       // weight for driver/athlete name matches
      sponsor: number;          // weight for sponsor text matches
      team: number;             // weight for team name matches
    };
    thresholds: {
      minimumScore: number;               // minimum score to accept a participant match
      clearWinner: number;                // score difference required for clear winner
      nameSimilarity: number;             // minimum fuzzy name similarity (0-1)
      lowOcrConfidence: number;           // OCR confidence threshold (0-1)
      strongNonNumberEvidence: number;    // threshold for strong non-number evidence
    };
    multiEvidenceBonus: number;           // bonus multiplier for multiple evidence types (0-1)
  };
}

export interface ParticipantPresetSupabase {
  id?: string;
  user_id: string;
  name: string;
  category_id?: string;
  description?: string;
  is_template?: boolean;
  is_public?: boolean;
  custom_folders?: string[]; // Array di nomi folder personalizzate create dall'utente
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
  usage_count?: number;
  participants?: PresetParticipantSupabase[];
  sport_categories?: SportCategory;
}

export interface PresetParticipantSupabase {
  id?: string;
  preset_id: string;
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  navigatore?: string;
  sponsor?: string;
  metatag?: string;
  plate_number?: string;     // License plate for car recognition
  folder_1?: string;
  folder_2?: string;
  folder_3?: string;
  custom_fields?: any;
  sort_order?: number;
  created_at?: string;
}

// Cache locale per categorie
let categoriesCache: SportCategory[] = [];
let presetsCache: ParticipantPresetSupabase[] = [];
let cacheLastUpdated: number = 0;

/**
 * Cache all Supabase data at app startup
 */
export async function cacheSupabaseData(): Promise<void> {
  try {
    const userId = getCurrentUserId();

    console.log('[Cache] Loading Supabase data...');
    console.log(`[Cache] User authenticated: ${!!userId}`);

    // Cache sport categories (public data - no user ID required)
    // This ensures categories are always available, even before login
    const { data: categories, error: categoriesError } = await supabase
      .from('sport_categories')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (categoriesError) {
      console.error('[Cache] Error loading categories:', categoriesError);
    } else {
      categoriesCache = categories || [];
      console.log(`[Cache] Cached ${categoriesCache.length} sport categories`);
    }

    // Cache user presets (requires authentication)
    if (userId) {
      const { data: presets, error: presetsError } = await supabase
        .from('participant_presets')
        .select(`
          *,
          sport_categories(code, name, ai_prompt),
          preset_participants(*)
        `)
        .or(`user_id.eq.${userId},is_public.eq.true`)
        .order('updated_at', { ascending: false });

      if (presetsError) {
        console.error('[Cache] Error loading presets:', presetsError);
      } else {
        presetsCache = presets || [];
        console.log(`[Cache] Cached ${presetsCache.length} participant presets`);
      }
    } else {
      console.log('[Cache] No user ID, skipping participant presets cache');
      presetsCache = [];
    }

    cacheLastUpdated = Date.now();
    console.log('[Cache] Supabase data cached successfully');

  } catch (error) {
    console.error('[Cache] Failed to cache Supabase data:', error);
  }
}

/**
 * Get cached sport categories
 */
export function getCachedSportCategories(): SportCategory[] {
  return categoriesCache;
}

/**
 * Get cached participant presets
 */
export function getCachedParticipantPresets(): ParticipantPresetSupabase[] {
  return presetsCache;
}

/**
 * Refresh categories cache
 */
export async function refreshCategoriesCache(): Promise<void> {
  try {
    const { data: categories, error } = await supabase
      .from('sport_categories')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (error) {
      console.error('[Cache] Error refreshing categories:', error);
    } else {
      categoriesCache = categories || [];
      console.log(`[Cache] Refreshed ${categoriesCache.length} sport categories`);
    }
  } catch (error) {
    console.error('[Cache] Failed to refresh categories cache:', error);
  }
}

/**
 * Get all sport categories from Supabase
 */
export async function getSportCategories(): Promise<SportCategory[]> {
  try {
    // Return cached data if available and recent
    if (categoriesCache.length > 0 && (Date.now() - cacheLastUpdated < 60000)) {
      return categoriesCache;
    }

    const { data, error } = await supabase
      .from('sport_categories')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (error) {
      console.error('[DB] Error getting sport categories:', error);
      return categoriesCache; // Return cached data as fallback
    }

    // Update cache
    categoriesCache = data || [];
    cacheLastUpdated = Date.now();

    return data || [];
  } catch (error) {
    console.error('[DB] Error getting sport categories:', error);
    return categoriesCache; // Return cached data as fallback
  }
}

/**
 * Get sport category by code
 */
export async function getSportCategoryByCode(code: string): Promise<SportCategory | null> {
  try {
    // Check cache first
    const cached = categoriesCache.find(cat => cat.code === code);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('sport_categories')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .single();

    if (error) {
      console.error(`[DB] Error getting sport category ${code}:`, error);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[DB] Error getting sport category ${code}:`, error);
    return null;
  }
}

// ==================== SUPABASE PARTICIPANT PRESETS OPERATIONS ====================

/**
 * Create participant preset in Supabase
 */
export async function createParticipantPresetSupabase(presetData: Omit<ParticipantPresetSupabase, 'id' | 'created_at' | 'updated_at'>): Promise<ParticipantPresetSupabase> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('participant_presets')
      .insert([{
        ...presetData,
        user_id: userId
      }])
      .select(`
        *,
        sport_categories(code, name, ai_prompt)
      `)
      .single();

    if (error) {
      if (error.code === '23505') { // unique constraint violation
        throw new Error(`A preset named "${presetData.name}" already exists`);
      }
      throw error;
    }

    // Invalidate cache to force fresh data on next load
    presetsCache = [];
    cacheLastUpdated = 0;

    console.log(`[DB] Created participant preset in Supabase: ${presetData.name}`);
    return data;

  } catch (error) {
    console.error('[DB] Error creating participant preset in Supabase:', error);
    throw error;
  }
}

/**
 * Get user participant presets from Supabase
 */
export async function getUserParticipantPresetsSupabase(): Promise<ParticipantPresetSupabase[]> {
  try {
    const userId = getCurrentUserId();
    if (!userId) return [];

    // TEMPORARILY DISABLE CACHE to force fresh query and debug
    // Return cached data if available and recent
    // if (presetsCache.length > 0 && (Date.now() - cacheLastUpdated < 30000)) {
    //   console.log('[DB] Returning cached presets:', presetsCache.length);
    //   return presetsCache.filter(p => p.user_id === userId || p.is_public);
    // }
    console.log('[DB] Cache disabled - forcing fresh query to Supabase');

    const { data, error } = await supabase
      .from('participant_presets')
      .select(`
        *,
        sport_categories(code, name, ai_prompt),
        preset_participants(*)
      `)
      .or(`user_id.eq.${userId},is_public.eq.true`)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[DB] Error getting user participant presets from Supabase:', error);
      return presetsCache.filter(p => p.user_id === userId || p.is_public);
    }

    console.log('[DB] Raw data from Supabase preset query:', JSON.stringify(data, null, 2));

    // Map preset_participants to participants for UI compatibility
    const mappedData = (data || []).map(preset => {
      console.log('[DB] Processing preset "${preset.name}"');

      return {
        ...preset,
        participants: preset.preset_participants || []
      };
    });

    // Update cache for this user
    presetsCache = mappedData;
    cacheLastUpdated = Date.now();

    return mappedData;

  } catch (error) {
    console.error('[DB] Error getting user participant presets from Supabase:', error);
    return [];
  }
}

/**
 * Get participant preset by ID from Supabase
 */
export async function getParticipantPresetByIdSupabase(presetId: string): Promise<ParticipantPresetSupabase | null> {
  try {
    const userId = getCurrentUserId();
    if (!userId) return null;

    // Check cache first
    const cached = presetsCache.find(p => p.id === presetId);
    if (cached && cached.participants) return cached;

    const { data, error } = await supabase
      .from('participant_presets')
      .select(`
        *,
        sport_categories(code, name, ai_prompt),
        preset_participants(*)
      `)
      .eq('id', presetId)
      .or(`user_id.eq.${userId},is_public.eq.true`)
      .single();

    if (error) {
      console.error(`[DB] Error getting participant preset ${presetId} from Supabase:`, error);
      return null;
    }

    // Map preset_participants to participants for UI compatibility
    if (data) {
      data.participants = data.preset_participants || [];
    }

    return data;

  } catch (error) {
    console.error(`[DB] Error getting participant preset ${presetId} from Supabase:`, error);
    return null;
  }
}

/**
 * Save preset participants to Supabase
 */
export async function savePresetParticipantsSupabase(presetId: string, participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[]): Promise<void> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    console.log(`[DB] Saving ${participants.length} participants to preset ${presetId}`);
    console.log('[DB] Participants sample:', participants.slice(0, 2));

    // Verify preset ownership
    const { data: preset, error: presetError } = await supabase
      .from('participant_presets')
      .select('id')
      .eq('id', presetId)
      .eq('user_id', userId)
      .single();

    if (presetError || !preset) {
      throw new Error('Preset not found or access denied');
    }

    // Delete existing participants
    const { error: deleteError } = await supabase
      .from('preset_participants')
      .delete()
      .eq('preset_id', presetId);

    if (deleteError) {
      console.error('[DB] Error deleting existing participants:', deleteError);
    }

    // Insert new participants
    if (participants.length > 0) {
      console.log('[DB] Inserting participants into Supabase...');
      const { data: insertedData, error: insertError } = await supabase
        .from('preset_participants')
        .insert(participants.map(p => ({ ...p, preset_id: presetId })));

      if (insertError) {
        console.error('[DB] Error inserting participants:', insertError);
        throw insertError;
      }

      console.log(`[DB] Successfully inserted ${participants.length} participants`);
      console.log('[DB] Insert response data:', insertedData);
    }

    // Update preset timestamp
    const { error: updateError } = await supabase
      .from('participant_presets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', presetId);

    if (updateError) {
      console.error('[DB] Error updating preset timestamp:', updateError);
    }

    // Invalidate cache to force fresh data on next load
    presetsCache = [];
    cacheLastUpdated = 0;

    console.log(`[DB] Saved ${participants.length} participants to preset ${presetId} in Supabase`);

  } catch (error) {
    console.error('[DB] Error saving preset participants to Supabase:', error);
    throw error;
  }
}

/**
 * Update preset last used timestamp in Supabase
 */
export async function updatePresetLastUsedSupabase(presetId: string): Promise<void> {
  try {
    const userId = getCurrentUserId();
    if (!userId) return;

    const { error } = await supabase
      .from('participant_presets')
      .update({
        last_used_at: new Date().toISOString(),
        usage_count: supabase.rpc('increment_usage_count', { preset_id: presetId })
      })
      .eq('id', presetId)
      .eq('user_id', userId);

    if (error) {
      console.error('[DB] Error updating preset last used in Supabase:', error);
    }

  } catch (error) {
    console.error('[DB] Error updating preset last used in Supabase:', error);
  }
}

/**
 * Update participant preset details in Supabase
 */
export async function updateParticipantPresetSupabase(presetId: string, updateData: Partial<Pick<ParticipantPresetSupabase, 'name' | 'description' | 'category_id'>>): Promise<void> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('participant_presets')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', presetId)
      .eq('user_id', userId);

    if (error) {
      console.error('[DB] Error updating participant preset in Supabase:', error);
      throw error;
    }

    // Update cache if available
    const cacheIndex = presetsCache.findIndex(p => p.id === presetId);
    if (cacheIndex !== -1) {
      presetsCache[cacheIndex] = { ...presetsCache[cacheIndex], ...updateData, updated_at: new Date().toISOString() };
    }

    console.log(`[DB] Updated participant preset ${presetId} in Supabase`);

  } catch (error) {
    console.error('[DB] Error updating participant preset in Supabase:', error);
    throw error;
  }
}

/**
 * Delete participant preset from Supabase
 */
export async function deleteParticipantPresetSupabase(presetId: string): Promise<void> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('participant_presets')
      .delete()
      .eq('id', presetId)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    // Update cache
    const cacheIndex = presetsCache.findIndex(p => p.id === presetId);
    if (cacheIndex >= 0) {
      presetsCache.splice(cacheIndex, 1);
    }

    console.log(`[DB] Deleted participant preset ${presetId} from Supabase`);

  } catch (error) {
    console.error('[DB] Error deleting participant preset from Supabase:', error);
    throw error;
  }
}

/**
 * Import participants from CSV to Supabase
 */
export async function importParticipantsFromCSVSupabase(csvData: any[], presetName: string, categoryId?: string): Promise<ParticipantPresetSupabase> {
  const preset = await createParticipantPresetSupabase({
    user_id: getCurrentUserId() || '',
    name: presetName,
    category_id: categoryId,
    description: `Imported from CSV with ${csvData.length} participants`
  });

  console.log('[DB] CSV Import - Raw CSV data sample:', csvData.slice(0, 2));
  console.log('[DB] CSV Import - Available columns:', Object.keys(csvData[0] || {}));

  const participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[] = csvData.map((row, index) => {
    const participant = {
      preset_id: preset.id!,
      numero: row.numero || row.Number || '',
      nome: row.nome || row.Driver || '',
      categoria: row.categoria || row.Category || '',
      squadra: row.squadra || row.team || row.Team || '',
      sponsor: row.sponsor || row.Sponsors || '',
      metatag: row.metatag || row.Metatag || '',
      plate_number: row.plate_number || row.Plate_Number || '',
      folder_1: row.folder_1 || row.Folder_1 || '',
      folder_2: row.folder_2 || row.Folder_2 || '',
      folder_3: row.folder_3 || row.Folder_3 || '',
      sort_order: index,
      custom_fields: {
        // Store any additional CSV fields
        ...Object.keys(row).reduce((acc, key) => {
          const knownFields = ['numero', 'Number', 'nome', 'Driver', 'categoria', 'Category', 'squadra', 'team', 'Team', 'sponsor', 'Sponsors', 'metatag', 'Metatag', 'plate_number', 'Plate_Number', 'folder_1', 'Folder_1', 'folder_2', 'Folder_2', 'folder_3', 'Folder_3'];
          if (!knownFields.includes(key)) {
            acc[key] = row[key];
          }
          return acc;
        }, {} as any)
      }
    };

    console.log(`[DB] CSV Import - Mapped participant ${index + 1}:`, {
      numero: participant.numero,
      nome: participant.nome,
      categoria: participant.categoria,
      squadra: participant.squadra,
      sponsor: participant.sponsor
    });

    return participant;
  });

  await savePresetParticipantsSupabase(preset.id!, participants);

  return preset;
}

// ==================== FEATURE FLAGS OPERATIONS ====================

export interface FeatureFlag {
  id?: string;
  user_id?: string;
  feature_name: string;
  is_enabled: boolean;
  rollout_percentage?: number;
  created_at?: string;
}

/**
 * Check if a feature is enabled for the current user
 */
export async function isFeatureEnabled(featureName: string): Promise<boolean> {
  try {
    const userId = getCurrentUserId();
    if (!userId) return false;

    const { data, error } = await supabase
      .from('feature_flags')
      .select('is_enabled, rollout_percentage')
      .eq('feature_name', featureName)
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order('user_id', { ascending: false }) // User-specific flags take precedence
      .limit(1)
      .single();

    if (error || !data) {
      return false; // Default to disabled if no flag exists
    }

    if (data.rollout_percentage && data.rollout_percentage < 100) {
      // Simple percentage-based rollout using user ID hash
      const hash = Array.from(userId).reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      const percentage = Math.abs(hash) % 100;
      return percentage < data.rollout_percentage;
    }

    return data.is_enabled;

  } catch (error) {
    console.error(`[DB] Error checking feature flag ${featureName}:`, error);
    return false;
  }
}

// Esporta la funzione di inizializzazione della cache e il db locale se necessario altrove (improbabile)
export { localDB as db, initializeLocalCacheSchema as initializeDatabaseSchema, connectionPool as dbPool };
