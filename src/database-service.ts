import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, PERFORMANCE_CONFIG, DEBUG_MODE } from './config';
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
// Inizializza il client Supabase direttamente invece di aspettare la chiamata lazy
let supabase: SupabaseClient = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

// Funzione per ottenere un client Supabase aggiornato
export function getSupabaseClient(): SupabaseClient {
  // Aggiorniamo il riferimento al client Supabase da authService se disponibile
  // Questo permette di usare il client autenticato quando disponibile
  const authSupabase = authService.getSupabaseClient();
  if (authSupabase) {
    supabase = authSupabase;
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
} catch (error) {
  console.error('Failed to import better-sqlite3:', error);
  // Creiamo un mock di better-sqlite3 per evitare errori
  BetterSqlite3Database = class MockDatabase {
    constructor() {
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
  }

  private async initializePool(): Promise<void> {
    for (let i = 0; i < this.minConnections; i++) {
      await this.createConnection();
    }
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
    // App not ready check failed, proceeding anyway
  }

  if (isDbInitialized) {
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

    } catch (dbError) {
      console.error('Failed to create SQLite database instance:', dbError);
      // Creiamo un'istanza mock per evitare errori
      localDB = new (class MockDatabase {
        open = true;
        prepare() { return { run: () => {}, get: () => null, all: () => [] }; }
        exec() {}
        close() { this.open = false; }
      })();
    }

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

    isDbInitialized = true;

    // Setup DB close handler only after successful initialization
    getElectronApp().on('quit', async () => {
      if (connectionPool) {
        await connectionPool.shutdown();
        connectionPool = null;
      }
      
      if (localDB && localDB.open) {
        localDB.close();
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
  completed_at?: string | null; // ISO 8601 String - When execution finished
  // Tracking fields for execution progress
  processed_images?: number; // Number of images successfully processed
  total_images?: number; // Total number of images to process
  category?: string; // Sport category (motorsport, running, altro)
  sport_category_id?: string | null; // UUID - FK to sport_categories table
  execution_settings?: Record<string, any>; // Execution configuration (JSONB)
}

// Interfacce per sistema preset partecipanti
export interface ParticipantPreset {
  id?: string;
  user_id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
  participants?: PresetParticipant[];
}

export interface PresetParticipant {
  id?: string;
  preset_id: string;
  numero?: string;  // Optional: Team Principal, VIP, mechanics may not have a race number
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
      const result = await operation();
      return result;
    } catch (error: any) {
      lastError = error;

      // Don't retry on authentication or permission errors
      if (error.message?.includes('authentication') ||
          error.message?.includes('permission') ||
          error.message?.includes('unauthorized') ||
          error.code === 401 ||
          error.code === 403) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
}

// --- Helper per verificare se l'utente è autenticato e ha un token valido ---
async function ensureAuthenticated(): Promise<boolean> {
  const authState = authService.getAuthState();
  if (!authState.isAuthenticated || !authState.session) {
    return false;
  }

  // Verifica se il token è scaduto
  if (authState.session.expires_at) {
    const expiresAt = new Date(authState.session.expires_at);
    const now = new Date();
    if (expiresAt <= now) {
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
      throw new Error('User authentication is invalid or expired.');
    }

    // Usa l'ID utente ottenuto direttamente da Supabase
    const supabaseUserId = userData.user.id;

    // Prova a rinnovare la sessione per assicurarsi che il token sia valido
    try {
      const { data: refreshData, error: refreshError } = await client.auth.refreshSession();

      if (!refreshError && refreshData && refreshData.session) {
        // Aggiorna il client Supabase con la nuova sessione
        await client.auth.setSession({
          access_token: refreshData.session.access_token,
          refresh_token: refreshData.session.refresh_token
        });

        // Aggiorna anche il client in authService
        authService.updateSession(refreshData.session);
      }
    } catch (refreshError) {
      // Non lanciare un errore qui, prova comunque a creare il progetto
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

    // Aggiorna la cache locale
    await cacheProjectLocal(data as Project);
    return data as Project;
  } catch (error) {
    console.error('Error creating project:', error);
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

/**
 * Get sport_category_id from category code or name (e.g., "motorsport" -> UUID)
 * Tries to match by code first (case-insensitive), then by name (case-insensitive)
 * Returns null if category not found
 */
export async function getSportCategoryIdByName(categoryCodeOrName: string): Promise<string | null> {
  if (!categoryCodeOrName) return null;

  try {
    // First try to match by code (case-insensitive)
    const { data: codeData, error: codeError } = await supabase
      .from('sport_categories')
      .select('id')
      .ilike('code', categoryCodeOrName)
      .single();

    if (!codeError && codeData) {
      return codeData.id;
    }

    // Fallback: try to match by name (case-insensitive)
    const { data: nameData, error: nameError } = await supabase
      .from('sport_categories')
      .select('id')
      .ilike('name', categoryCodeOrName)
      .single();

    if (!nameError && nameData) {
      return nameData.id;
    }

    return null;
  } catch (e) {
    return null;
  }
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
    return;
  }

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

  try {
    // 1. Sincronizza Projects non ancora sincronizzati
    await syncUserProjectsToSupabase(userId);

    // 2. Sincronizza Executions non ancora sincronizzate
    await syncUserExecutionsToSupabase(userId);
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
      return;
    }

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
        } else {
          // Aggiorna project esistente se necessario
          if (project.updated_at && existingProject.updated_at &&
              new Date(project.updated_at) > new Date(existingProject.updated_at)) {
            await updateProjectOnline(project.id!, {
              name: project.name,
              base_csv_storage_path: project.base_csv_storage_path
            });
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
      return;
    }

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
      preset.id, preset.user_id, preset.name, 'motorsport', // category column kept for DB compatibility
      preset.description, preset.created_at, preset.updated_at, preset.last_used_at
    );

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
  } catch (error) {
    console.error('[DB] Error deleting participant preset:', error);
    throw error;
  }
}

/**
 * Importa partecipanti da dati CSV esistenti
 */
export async function importParticipantsFromCSV(csvData: any[], presetName: string): Promise<ParticipantPreset> {
  const preset = await createParticipantPreset({
    user_id: getCurrentUserId() || '',
    name: presetName,
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
  scene_classifier_enabled?: boolean;     // Enable ONNX scene classifier to skip crowd/irrelevant scenes
  save_segmentation_masks?: boolean;      // Save full RLE mask data in JSONL logs for debugging/training
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
  face_photo_count?: number; // Cached count of face photos
}

/**
 * Interface for face photos associated with preset participants
 */
export interface PresetParticipantFacePhoto {
  id: string;
  participant_id: string;
  photo_url: string;
  storage_path: string;
  face_descriptor: number[] | null;
  photo_type: 'reference' | 'action' | 'podium' | 'helmet_off';
  detection_confidence: number | null;
  is_primary: boolean;
  created_at: string;
}

/**
 * Interface for creating a new face photo
 */
export interface CreatePresetFacePhotoParams {
  participant_id: string;
  user_id: string; // Required for RLS policy
  photo_url: string;
  storage_path: string;
  face_descriptor?: number[];
  photo_type?: 'reference' | 'action' | 'podium' | 'helmet_off';
  detection_confidence?: number;
  is_primary?: boolean;
}

// Cache locale per categorie
let categoriesCache: SportCategory[] = [];
let presetsCache: ParticipantPresetSupabase[] = [];
let cacheLastUpdated: number = 0;
let cacheIncludesInactive: boolean = false; // Track if cache includes inactive categories (admin mode)

/**
 * Cache all Supabase data at app startup
 */
export async function cacheSupabaseData(): Promise<void> {
  try {
    const userId = getCurrentUserId();
    const isAdmin = authService.isAdmin();

    // Cache sport categories (public data - no user ID required)
    // This ensures categories are always available, even before login
    let categoryQuery = supabase
      .from('sport_categories')
      .select('*');

    // Non-admin users only see active categories
    if (!isAdmin) {
      categoryQuery = categoryQuery.eq('is_active', true);
    }

    const { data: categories, error: categoriesError } = await categoryQuery.order('display_order');

    if (categoriesError) {
      console.error('[Cache] Error loading categories:', categoriesError);
    } else {
      categoriesCache = categories || [];
      cacheIncludesInactive = isAdmin;
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
        // Map preset_participants to participants for UI compatibility
        presetsCache = (presets || []).map(preset => ({
          ...preset,
          participants: preset.preset_participants || []
        }));
        console.log('[Cache] Cached', presetsCache.length, 'presets with participants');
      }
    } else {
      presetsCache = [];
    }

    cacheLastUpdated = Date.now();

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
    const isAdmin = authService.isAdmin();

    let query = supabase
      .from('sport_categories')
      .select('*');

    // Non-admin users only see active categories
    if (!isAdmin) {
      query = query.eq('is_active', true);
    }

    const { data: categories, error } = await query.order('display_order');

    if (error) {
      console.error('[Cache] Error refreshing categories:', error);
    } else {
      categoriesCache = categories || [];
      cacheIncludesInactive = isAdmin;
    }
  } catch (error) {
    console.error('[Cache] Failed to refresh categories cache:', error);
  }
}

/**
 * Get all sport categories from Supabase
 * Admin users see all categories (including inactive ones)
 */
export async function getSportCategories(): Promise<SportCategory[]> {
  try {
    const isAdmin = authService.isAdmin();

    // Check if cache is valid for current user role
    const cacheValid = categoriesCache.length > 0 &&
                       (Date.now() - cacheLastUpdated < 60000) &&
                       (cacheIncludesInactive === isAdmin); // Cache must match admin status

    if (cacheValid) {
      return categoriesCache;
    }

    // Build query
    let query = supabase
      .from('sport_categories')
      .select('*');

    // Non-admin users only see active categories
    if (!isAdmin) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('display_order');

    if (error) {
      console.error('[DB] Error getting sport categories:', error);
      return categoriesCache; // Return cached data as fallback
    }

    // Update cache and track whether it includes inactive categories
    categoriesCache = data || [];
    cacheLastUpdated = Date.now();
    cacheIncludesInactive = isAdmin;

    return data || [];
  } catch (error) {
    console.error('[DB] Error getting sport categories:', error);
    return categoriesCache; // Return cached data as fallback
  }
}

/**
 * Get sport category by code
 * Admin users can retrieve inactive categories as well
 */
export async function getSportCategoryByCode(code: string): Promise<SportCategory | null> {
  try {
    // Check cache first
    const cached = categoriesCache.find(cat => cat.code === code);
    if (cached) return cached;

    // Build query
    let query = supabase
      .from('sport_categories')
      .select('*')
      .eq('code', code);

    // Non-admin users only see active categories
    const isAdmin = authService.isAdmin();
    if (!isAdmin) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.single();

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

    // Add new preset to cache instead of invalidating
    // This ensures the UI shows the new preset immediately
    if (data) {
      const newPreset = { ...data, participants: [] };
      presetsCache = [newPreset, ...presetsCache];
      console.log('[DB] Added new preset to cache, total:', presetsCache.length);
    }
    // Mark cache for refresh on next detailed load
    cacheLastUpdated = 0;

    return data;

  } catch (error) {
    console.error('[DB] Error creating participant preset in Supabase:', error);
    throw error;
  }
}

/**
 * Get user participant presets from Supabase
 * @param includeAllForAdmin - If true and user is admin, returns all presets (not just user's own)
 */
export async function getUserParticipantPresetsSupabase(includeAllForAdmin: boolean = false): Promise<ParticipantPresetSupabase[]> {
  try {
    const userId = getCurrentUserId();
    console.log('[DB] getUserParticipantPresetsSupabase - userId:', userId, 'includeAllForAdmin:', includeAllForAdmin);
    if (!userId) {
      console.log('[DB] No userId, returning empty array');
      return [];
    }

    // Return cached data if available and recent
    if (presetsCache.length > 0 && (Date.now() - cacheLastUpdated < 30000)) {
      // Ensure all cached presets have participants properly mapped
      const ensureParticipants = (presets: ParticipantPresetSupabase[]) =>
        presets.map(p => ({
          ...p,
          participants: p.participants || (p as any).preset_participants || []
        }));

      // In admin mode, return all cached presets without filtering
      if (includeAllForAdmin) {
        const result = ensureParticipants(presetsCache);
        console.log('[DB] Returning cached presets (admin mode):', result.length);
        return result;
      }
      // For regular users, filter by ownership or public access
      const filtered = presetsCache.filter(p => p.user_id === userId || p.is_public);
      const result = ensureParticipants(filtered);
      console.log('[DB] Returning cached presets (filtered):', result.length, 'of', presetsCache.length);
      return result;
    }

    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    // Build query based on admin mode
    let query = authenticatedClient
      .from('participant_presets')
      .select(`
        *,
        sport_categories(code, name, ai_prompt),
        preset_participants(*)
      `);

    // If not admin mode, filter by user_id, public presets, or official presets
    if (!includeAllForAdmin) {
      query = query.or(`user_id.eq.${userId},is_public.eq.true,is_official.eq.true`);
    }
    // If admin mode, get all presets (no filter)

    query = query.order('updated_at', { ascending: false });

    let { data, error } = await query;
    console.log('[DB] Supabase query result - data:', data?.length, 'error:', error?.message);

    // Retry once if we got 0 results and cache is empty (likely startup timing issue)
    if (!error && data?.length === 0 && presetsCache.length === 0) {
      console.log('[DB] Got 0 results with empty cache, retrying after 500ms...');
      await new Promise(resolve => setTimeout(resolve, 500));
      const retry = await query;
      data = retry.data;
      error = retry.error;
      console.log('[DB] Retry result - data:', data?.length, 'error:', error?.message);
    }

    if (error) {
      console.error('[DB] Error getting user participant presets from Supabase:', error);
      return presetsCache.filter(p => p.user_id === userId || p.is_public);
    }

    // Map preset_participants to participants for UI compatibility
    const mappedData = (data || []).map(preset => {
      const participantCount = preset.preset_participants?.length || 0;
      console.log(`[DB] Preset "${preset.name}" has ${participantCount} participants`);
      return {
        ...preset,
        participants: preset.preset_participants || []
      };
    });

    // Update cache only if we got results OR if cache was empty
    // This prevents overwriting valid cache with empty results due to timing issues
    if (mappedData.length > 0 || presetsCache.length === 0) {
      presetsCache = mappedData;
      cacheLastUpdated = Date.now();
      console.log('[DB] Cache updated with', mappedData.length, 'presets');
      return mappedData;
    } else {
      // Got 0 results but cache has data - return cached data instead
      // Ensure participants are mapped for each cached preset
      const cachedWithParticipants = presetsCache.map(p => ({
        ...p,
        participants: p.participants || (p as any).preset_participants || []
      }));
      console.log('[DB] Returning cached data instead of empty results:', cachedWithParticipants.length, 'presets');
      if (includeAllForAdmin) {
        return cachedWithParticipants;
      }
      return cachedWithParticipants.filter(p => p.user_id === userId || p.is_public);
    }

  } catch (error) {
    console.error('[DB] Error getting user participant presets from Supabase:', error);
    return [];
  }
}

/**
 * Get participant preset by ID from Supabase
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function getParticipantPresetByIdSupabase(presetId: string): Promise<ParticipantPresetSupabase | null> {
  try {
    const userId = getCurrentUserId();
    if (!userId) {
      console.warn('[DB] getParticipantPresetByIdSupabase: No userId available');
      return null;
    }

    // Check cache first - look for either participants or preset_participants
    const cached = presetsCache.find(p => p.id === presetId);
    if (cached) {
      const cachedParticipants = cached.participants || (cached as any).preset_participants;
      if (cachedParticipants && cachedParticipants.length > 0) {
        console.log(`[DB] Returning cached preset ${presetId} with ${cachedParticipants.length} participants`);
        // Ensure participants property is set for UI compatibility
        if (!cached.participants) {
          cached.participants = cachedParticipants;
        }
        return cached;
      }
    }

    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { data, error } = await authenticatedClient
      .from('participant_presets')
      .select(`
        *,
        sport_categories(code, name, ai_prompt),
        preset_participants(*)
      `)
      .eq('id', presetId)
      .or(`user_id.eq.${userId},is_public.eq.true,is_official.eq.true`)
      .single();

    if (error) {
      console.error(`[DB] Error getting participant preset ${presetId} from Supabase:`, error);
      return null;
    }

    // Map preset_participants to participants for UI compatibility
    if (data) {
      data.participants = data.preset_participants || [];
      console.log(`[DB] Loaded preset ${presetId} with ${data.participants.length} participants from Supabase`);
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

    // Verify preset ownership
    const { data: preset, error: presetError } = await supabase
      .from('participant_presets')
      .select('id, user_id')
      .eq('id', presetId)
      .single();

    if (presetError) {
      console.error('[DB] Preset lookup error:', presetError);
      throw new Error(`Preset lookup failed: ${presetError.message}`);
    }

    if (!preset) {
      throw new Error(`Preset ${presetId} not found`);
    }

    if (preset.user_id !== userId) {
      console.error(`[DB] User mismatch: preset.user_id=${preset.user_id}, current userId=${userId}`);
      throw new Error('Access denied: preset belongs to another user');
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
      const { error: insertError } = await supabase
        .from('preset_participants')
        .insert(participants.map(p => ({ ...p, preset_id: presetId })));

      if (insertError) {
        console.error('[DB] Error inserting participants:', insertError);
        throw insertError;
      }
    }

    // Update preset timestamp
    const { error: updateError } = await supabase
      .from('participant_presets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', presetId);

    if (updateError) {
      console.error('[DB] Error updating preset timestamp:', updateError);
    }

    // Update cache with new participants instead of clearing
    const cacheIndex = presetsCache.findIndex(p => p.id === presetId);
    if (cacheIndex !== -1) {
      presetsCache[cacheIndex] = {
        ...presetsCache[cacheIndex],
        participants: participants as PresetParticipantSupabase[],
        updated_at: new Date().toISOString()
      };
      console.log('[DB] Cache updated with', participants.length, 'participants for preset', presetId);
    }
    // Force refresh on next detailed load to get IDs
    cacheLastUpdated = 0;

  } catch (error) {
    console.error('[DB] Error saving preset participants to Supabase:', error);
    throw error;
  }
}

/**
 * Update preset last used timestamp in Supabase
 * Uses RPC function for atomic increment of usage_count
 */
export async function updatePresetLastUsedSupabase(presetId: string): Promise<void> {
  try {
    const userId = getCurrentUserId();
    if (!userId) return;

    // Use RPC function that atomically increments usage_count and updates last_used_at
    const { error } = await supabase.rpc('increment_usage_count', {
      p_preset_id: presetId
    });

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
export async function updateParticipantPresetSupabase(presetId: string, updateData: Partial<Pick<ParticipantPresetSupabase, 'name' | 'description' | 'category_id' | 'custom_folders'>>): Promise<void> {
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

  } catch (error) {
    console.error('[DB] Error deleting participant preset from Supabase:', error);
    throw error;
  }
}

/**
 * Duplicate an official preset for the current user
 * Creates a personal copy of an official preset that the user can customize
 */
export async function duplicateOfficialPresetSupabase(sourcePresetId: string): Promise<ParticipantPresetSupabase> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    // Get the source preset (must be official)
    const { data: sourcePreset, error: sourceError } = await supabase
      .from('participant_presets')
      .select(`
        *,
        preset_participants(*)
      `)
      .eq('id', sourcePresetId)
      .eq('is_official', true)
      .single();

    if (sourceError || !sourcePreset) {
      throw new Error('Source preset not found or is not an official preset');
    }

    // Create the new preset (personal copy)
    const newPreset = await createParticipantPresetSupabase({
      user_id: userId,
      name: `${sourcePreset.name} (My Copy)`,
      description: sourcePreset.description || `Duplicated from Official RT Preset: ${sourcePreset.name}`,
      category_id: sourcePreset.category_id,
      custom_folders: sourcePreset.custom_folders || []
    });

    // Copy participants
    const sourceParticipants = sourcePreset.preset_participants || [];
    if (sourceParticipants.length > 0) {
      const participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[] = sourceParticipants.map((p: any, index: number) => ({
        preset_id: newPreset.id!,
        numero: p.numero || '',
        nome: p.nome || '',
        categoria: p.categoria || '',
        squadra: p.squadra || '',
        sponsor: p.sponsor || '',
        metatag: p.metatag || '',
        plate_number: p.plate_number || '',
        folder_1: p.folder_1 || '',
        folder_2: p.folder_2 || '',
        folder_3: p.folder_3 || '',
        sort_order: p.sort_order || index,
        custom_fields: p.custom_fields || {}
      }));

      await savePresetParticipantsSupabase(newPreset.id!, participants);
    }

    // Update preset in cache with participants (don't clear cache)
    const cacheIndex = presetsCache.findIndex(p => p.id === newPreset.id);
    if (cacheIndex !== -1) {
      presetsCache[cacheIndex] = {
        ...presetsCache[cacheIndex],
        participants: sourceParticipants.map((p: any) => ({
          ...p,
          preset_id: newPreset.id
        }))
      };
    }
    // Force refresh on next detailed load
    cacheLastUpdated = 0;

    // Return the new preset with participants
    return {
      ...newPreset,
      participants: sourceParticipants.map((p: any) => ({
        ...p,
        preset_id: newPreset.id
      }))
    };

  } catch (error) {
    console.error('[DB] Error duplicating official preset:', error);
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

    return participant;
  });

  await savePresetParticipantsSupabase(preset.id!, participants);

  return preset;
}

// ==================== EXPORT DESTINATIONS CRUD OPERATIONS ====================

/**
 * Export Destination - Unified export configuration
 * Replaces Folder 1/2/3 and Agencies with autonomous destinations
 */
export interface ExportDestination {
  id?: string;
  user_id?: string;
  name: string;

  // Path
  base_folder?: string;
  subfolder_pattern?: string;

  // Filename Renaming
  filename_pattern?: string;
  filename_sequence_start?: number;
  filename_sequence_padding?: number;
  filename_sequence_mode?: 'global' | 'per_subject' | 'per_folder';
  preserve_original_name?: boolean;

  // Credits
  credit?: string;
  source?: string;
  copyright?: string;
  copyright_owner?: string;

  // Creator Info
  creator?: string;
  authors_position?: string;
  caption_writer?: string;

  // Contact Info
  contact_address?: string;
  contact_city?: string;
  contact_region?: string;
  contact_postal_code?: string;
  contact_country?: string;
  contact_phone?: string;
  contact_email?: string;
  contact_website?: string;

  // Event Info Templates
  headline_template?: string;
  title_template?: string;
  event_template?: string;
  description_template?: string;
  category?: string;

  // Location
  city?: string;
  country?: string;
  country_code?: string;
  location?: string;
  world_region?: string;

  // Keywords
  base_keywords?: string[];
  append_keywords?: boolean;

  // Behavior
  auto_apply?: boolean;
  apply_condition?: string;
  is_default?: boolean;
  is_active?: boolean;
  display_order?: number;

  // FTP/SFTP (Pro tier only)
  upload_method?: 'local' | 'ftp' | 'sftp';
  ftp_host?: string;
  ftp_port?: number;
  ftp_username?: string;
  ftp_password_encrypted?: string;
  ftp_remote_path?: string;
  ftp_passive_mode?: boolean;
  ftp_secure?: boolean;
  ftp_concurrent_uploads?: number;
  ftp_retry_attempts?: number;
  ftp_timeout_seconds?: number;
  keep_local_copy?: boolean;

  // Timestamps
  created_at?: string;
  updated_at?: string;
}

/**
 * Create a new export destination
 */
export async function createExportDestination(
  destinationData: Omit<ExportDestination, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<ExportDestination> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    // Convert base_keywords array to PostgreSQL array format
    const dataToInsert = {
      ...destinationData,
      user_id: userId,
      base_keywords: destinationData.base_keywords || []
    };

    const { data, error } = await withRetry(
      async () => {
        return await supabase
          .from('export_destinations')
          .insert([dataToInsert])
          .select()
          .single();
      },
      'createExportDestination'
    );

    if (error) {
      console.error('[DB] Error creating export destination:', error);
      throw error;
    }

    if (!data) {
      throw new Error('Failed to create export destination: no data returned');
    }

    return data as ExportDestination;

  } catch (error) {
    console.error('[DB] Error in createExportDestination:', error);
    throw error;
  }
}

/**
 * Get all export destinations for the current user
 */
export async function getUserExportDestinations(): Promise<ExportDestination[]> {
  const userId = getCurrentUserId();
  if (!userId) return [];

  try {
    const { data, error } = await supabase
      .from('export_destinations')
      .select('*')
      .eq('user_id', userId)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[DB] Error getting export destinations:', error);
      return [];
    }

    return (data || []) as ExportDestination[];

  } catch (error) {
    console.error('[DB] Error in getUserExportDestinations:', error);
    return [];
  }
}

/**
 * Get active export destinations for the current user
 */
export async function getActiveExportDestinations(): Promise<ExportDestination[]> {
  const userId = getCurrentUserId();
  if (!userId) return [];

  try {
    const { data, error } = await supabase
      .from('export_destinations')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[DB] Error getting active export destinations:', error);
      return [];
    }

    return (data || []) as ExportDestination[];

  } catch (error) {
    console.error('[DB] Error in getActiveExportDestinations:', error);
    return [];
  }
}

/**
 * Get a specific export destination by ID
 */
export async function getExportDestinationById(destinationId: string): Promise<ExportDestination | null> {
  const userId = getCurrentUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('export_destinations')
      .select('*')
      .eq('id', destinationId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('[DB] Error getting export destination:', error);
      return null;
    }

    return data as ExportDestination;

  } catch (error) {
    console.error('[DB] Error in getExportDestinationById:', error);
    return null;
  }
}

/**
 * Get the default export destination
 */
export async function getDefaultExportDestination(): Promise<ExportDestination | null> {
  const userId = getCurrentUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('export_destinations')
      .select('*')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('[DB] Error getting default export destination:', error);
      return null;
    }

    return data as ExportDestination;

  } catch (error) {
    console.error('[DB] Error in getDefaultExportDestination:', error);
    return null;
  }
}

/**
 * Update an export destination
 */
export async function updateExportDestination(
  destinationId: string,
  updateData: Partial<Omit<ExportDestination, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<ExportDestination> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    const { data, error } = await withRetry(
      async () => {
        return await supabase
          .from('export_destinations')
          .update(updateData)
          .eq('id', destinationId)
          .eq('user_id', userId)
          .select()
          .single();
      },
      'updateExportDestination'
    );

    if (error) {
      console.error('[DB] Error updating export destination:', error);
      throw error;
    }

    if (!data) {
      throw new Error('Export destination not found or access denied');
    }

    return data as ExportDestination;

  } catch (error) {
    console.error('[DB] Error in updateExportDestination:', error);
    throw error;
  }
}

/**
 * Delete an export destination
 */
export async function deleteExportDestination(destinationId: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    const { error } = await supabase
      .from('export_destinations')
      .delete()
      .eq('id', destinationId)
      .eq('user_id', userId);

    if (error) {
      console.error('[DB] Error deleting export destination:', error);
      throw error;
    }

  } catch (error) {
    console.error('[DB] Error in deleteExportDestination:', error);
    throw error;
  }
}

/**
 * Set an export destination as the default (and unset others)
 */
export async function setDefaultExportDestination(destinationId: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    // First, unset all defaults for this user
    const { error: unsetError } = await supabase
      .from('export_destinations')
      .update({ is_default: false })
      .eq('user_id', userId);

    if (unsetError) {
      console.error('[DB] Error unsetting default destinations:', unsetError);
      throw unsetError;
    }

    // Then set the new default
    const { error: setError } = await supabase
      .from('export_destinations')
      .update({ is_default: true })
      .eq('id', destinationId)
      .eq('user_id', userId);

    if (setError) {
      console.error('[DB] Error setting default destination:', setError);
      throw setError;
    }

  } catch (error) {
    console.error('[DB] Error in setDefaultExportDestination:', error);
    throw error;
  }
}

/**
 * Duplicate an export destination
 */
export async function duplicateExportDestination(destinationId: string, newName?: string): Promise<ExportDestination> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    // Get the original destination
    const original = await getExportDestinationById(destinationId);
    if (!original) {
      throw new Error('Export destination not found');
    }

    // Create a copy without id, user_id, timestamps, and is_default
    const { id, user_id, created_at, updated_at, is_default, ...copyData } = original;

    const duplicateData = {
      ...copyData,
      name: newName || `${original.name} (Copy)`,
      is_default: false // Never copy as default
    };

    return await createExportDestination(duplicateData);

  } catch (error) {
    console.error('[DB] Error in duplicateExportDestination:', error);
    throw error;
  }
}

/**
 * Update display order for multiple destinations
 */
export async function updateExportDestinationsOrder(
  destinationOrders: Array<{ id: string; display_order: number }>
): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    // Update each destination's order
    for (const { id, display_order } of destinationOrders) {
      const { error } = await supabase
        .from('export_destinations')
        .update({ display_order })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        console.error(`[DB] Error updating order for destination ${id}:`, error);
        throw error;
      }
    }

  } catch (error) {
    console.error('[DB] Error in updateExportDestinationsOrder:', error);
    throw error;
  }
}

/**
 * Toggle active status of an export destination
 */
export async function toggleExportDestinationActive(destinationId: string): Promise<boolean> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  try {
    // Get current status
    const destination = await getExportDestinationById(destinationId);
    if (!destination) {
      throw new Error('Export destination not found');
    }

    const newStatus = !destination.is_active;

    const { error } = await supabase
      .from('export_destinations')
      .update({ is_active: newStatus })
      .eq('id', destinationId)
      .eq('user_id', userId);

    if (error) {
      console.error('[DB] Error toggling destination active status:', error);
      throw error;
    }

    return newStatus;

  } catch (error) {
    console.error('[DB] Error in toggleExportDestinationActive:', error);
    throw error;
  }
}

/**
 * Get export destinations matching a condition for auto-apply
 * @param condition The participant data to match against (e.g., team, number)
 */
export async function getMatchingExportDestinations(
  participantData: { team?: string; number?: string | number; categoria?: string }
): Promise<ExportDestination[]> {
  const userId = getCurrentUserId();
  if (!userId) return [];

  try {
    // Get all active destinations with auto_apply enabled
    const { data, error } = await supabase
      .from('export_destinations')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('auto_apply', true);

    if (error) {
      console.error('[DB] Error getting auto-apply destinations:', error);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Filter by apply_condition
    const matching = data.filter((dest: ExportDestination) => {
      if (!dest.apply_condition) return true; // No condition = applies to all

      const condition = dest.apply_condition.toLowerCase();

      // Parse condition format: "field:value" or "field:value,field2:value2"
      const conditions = condition.split(',').map(c => c.trim());

      return conditions.every(cond => {
        const [field, value] = cond.split(':').map(s => s.trim());

        switch (field) {
          case 'team':
            return participantData.team?.toLowerCase().includes(value);
          case 'number':
            return String(participantData.number) === value;
          case 'categoria':
          case 'category':
            return participantData.categoria?.toLowerCase() === value;
          default:
            return false;
        }
      });
    });

    return matching as ExportDestination[];

  } catch (error) {
    console.error('[DB] Error in getMatchingExportDestinations:', error);
    return [];
  }
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

// =====================================================
// Preset Participant Face Photos Functions
// =====================================================

/**
 * Get all face photos for a participant
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function getPresetParticipantFacePhotos(participantId: string): Promise<PresetParticipantFacePhoto[]> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { data, error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .select('*')
      .eq('participant_id', participantId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[DB] Error fetching face photos:', error);
      throw error;
    }

    return (data || []).map(photo => ({
      ...photo,
      face_descriptor: photo.face_descriptor ? Array.from(photo.face_descriptor) : null
    }));
  } catch (error) {
    console.error('[DB] Failed to get preset face photos:', error);
    throw error;
  }
}

/**
 * Add a new face photo for a participant
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function addPresetParticipantFacePhoto(params: CreatePresetFacePhotoParams): Promise<PresetParticipantFacePhoto> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { data, error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .insert({
        participant_id: params.participant_id,
        user_id: params.user_id,
        photo_url: params.photo_url,
        storage_path: params.storage_path,
        face_descriptor: params.face_descriptor || null,
        photo_type: params.photo_type || 'reference',
        detection_confidence: params.detection_confidence || null,
        is_primary: params.is_primary || false
      })
      .select()
      .single();

    if (error) {
      console.error('[DB] Error adding face photo:', error);
      throw error;
    }

    return {
      ...data,
      face_descriptor: data.face_descriptor ? Array.from(data.face_descriptor) : null
    };
  } catch (error) {
    console.error('[DB] Failed to add preset face photo:', error);
    throw error;
  }
}

/**
 * Delete a face photo
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function deletePresetParticipantFacePhoto(photoId: string): Promise<void> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .delete()
      .eq('id', photoId);

    if (error) {
      console.error('[DB] Error deleting face photo:', error);
      throw error;
    }
  } catch (error) {
    console.error('[DB] Failed to delete preset face photo:', error);
    throw error;
  }
}

/**
 * Update a face photo (e.g., set as primary or update descriptor)
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function updatePresetParticipantFacePhoto(
  photoId: string,
  updates: Partial<Pick<PresetParticipantFacePhoto, 'is_primary' | 'face_descriptor' | 'photo_type' | 'detection_confidence'>>
): Promise<PresetParticipantFacePhoto> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { data, error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .update(updates)
      .eq('id', photoId)
      .select()
      .single();

    if (error) {
      console.error('[DB] Error updating face photo:', error);
      throw error;
    }

    return {
      ...data,
      face_descriptor: data.face_descriptor ? Array.from(data.face_descriptor) : null
    };
  } catch (error) {
    console.error('[DB] Failed to update preset face photo:', error);
    throw error;
  }
}

/**
 * Load all face descriptors for a preset (for face recognition during analysis)
 * Returns descriptors in the format expected by FaceRecognitionProcessor
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function loadPresetFaceDescriptors(presetId: string): Promise<Array<{
  personId: string;
  personName: string;
  team: string;
  carNumber: string;
  descriptor: number[];
  referencePhotoUrl: string;
  source: 'preset';
  photoType: string;
  isPrimary: boolean;
}>> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    // Get all participants with their face photos
    const { data: participants, error: participantsError } = await authenticatedClient
      .from('preset_participants')
      .select(`
        id,
        numero,
        nome,
        squadra,
        preset_participant_face_photos (
          id,
          photo_url,
          face_descriptor,
          photo_type,
          is_primary,
          detection_confidence
        )
      `)
      .eq('preset_id', presetId);

    if (participantsError) {
      console.error('[DB] Error loading preset face descriptors:', participantsError);
      throw participantsError;
    }

    const descriptors: Array<{
      personId: string;
      personName: string;
      team: string;
      carNumber: string;
      descriptor: number[];
      referencePhotoUrl: string;
      source: 'preset';
      photoType: string;
      isPrimary: boolean;
    }> = [];

    for (const participant of participants || []) {
      const facePhotos = (participant as any).preset_participant_face_photos || [];

      for (const photo of facePhotos) {
        // Skip photos without descriptors
        if (!photo.face_descriptor || !Array.isArray(photo.face_descriptor) || photo.face_descriptor.length !== 128) {
          continue;
        }

        descriptors.push({
          personId: participant.id,
          personName: participant.nome || `#${participant.numero}`,
          team: participant.squadra || '',
          carNumber: participant.numero,
          descriptor: Array.from(photo.face_descriptor),
          referencePhotoUrl: photo.photo_url,
          source: 'preset',
          photoType: photo.photo_type || 'reference',
          isPrimary: photo.is_primary || false
        });
      }
    }

    if (DEBUG_MODE) {
      console.log(`[DB] Loaded ${descriptors.length} face descriptors from preset ${presetId}`);
    }

    return descriptors;
  } catch (error) {
    console.error('[DB] Failed to load preset face descriptors:', error);
    throw error;
  }
}

/**
 * Get face photo count for a participant
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function getPresetParticipantFacePhotoCount(participantId: string): Promise<number> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { count, error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .select('*', { count: 'exact', head: true })
      .eq('participant_id', participantId);

    if (error) {
      console.error('[DB] Error counting face photos:', error);
      throw error;
    }

    return count || 0;
  } catch (error) {
    console.error('[DB] Failed to count preset face photos:', error);
    return 0;
  }
}

// Esporta la funzione di inizializzazione della cache e il db locale se necessario altrove (improbabile)
export { localDB as db, initializeLocalCacheSchema as initializeDatabaseSchema, connectionPool as dbPool };
