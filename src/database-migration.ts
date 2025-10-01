import { db } from './database-service';

/**
 * Rappresenta una versione dello schema del database
 */
interface DatabaseVersion {
  version: number;
  description: string;
  appliedAt?: string;
}

/**
 * Tabella che tiene traccia delle versioni dello schema applicate
 */
function initVersionTable(): void {
  try {
    if (!db) {
      console.error("Database not initialized. Cannot initialize version table.");
      return;
    }

    const createVersionsTable = `
      CREATE TABLE IF NOT EXISTS SchemaVersions (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `;

    db.exec(createVersionsTable);
    console.log('Schema versions table initialized.');
  } catch (error) {
    console.error('Error initializing version table:', error);
  }
}

/**
 * Verifica se una versione specifica è già stata applicata
 */
function isVersionApplied(version: number): boolean {
  try {
    if (!db) return false;
    
    const stmt = db.prepare('SELECT version FROM SchemaVersions WHERE version = ?');
    const result = stmt.get(version);
    return !!result;
  } catch (error) {
    console.error('Error checking version:', error);
    return false;
  }
}

/**
 * Registra una versione come applicata
 */
function markVersionApplied(version: DatabaseVersion): void {
  try {
    if (!db) return;
    
    const now = new Date().toISOString();
    const stmt = db.prepare(
      'INSERT INTO SchemaVersions (version, description, applied_at) VALUES (?, ?, ?)'
    );
    stmt.run(version.version, version.description, now);
    console.log(`Schema version ${version.version} marked as applied.`);
  } catch (error) {
    console.error(`Error marking version ${version.version} as applied:`, error);
  }
}

/**
 * Ottiene la versione più recente applicata
 */
function getCurrentVersion(): number {
  try {
    if (!db) return 0;
    
    const stmt = db.prepare('SELECT MAX(version) as current_version FROM SchemaVersions');
    const result = stmt.get() as any;
    return result?.current_version || 0;
  } catch (error) {
    console.error('Error getting current version:', error);
    return 0;
  }
}

/**
 * Applica una singola migrazione se non è già stata applicata
 */
function applyMigration(migration: { version: DatabaseVersion, migrate: () => void }): boolean {
  if (isVersionApplied(migration.version.version)) {
    return false; // Già applicata
  }
  
  try {
    // Esegui migrazione
    migration.migrate();
    
    // Marca come applicata
    markVersionApplied(migration.version);
    return true;
  } catch (error) {
    console.error(`Error applying migration ${migration.version.version}:`, error);
    return false;
  }
}

/**
 * Migrazione 1: Aggiunge la colonna raw_analysis alla tabella TestResults
 */
const migration1 = {
  version: {
    version: 1,
    description: 'Add raw_analysis column to TestResults table'
  },
  migrate: () => {
    console.log('Applying migration 1: Adding raw_analysis column to TestResults');
    try {
      // Prima verifica se la colonna esiste già
      const tableInfo = db.prepare("PRAGMA table_info(TestResults)").all() as any[];
      const hasRawAnalysis = tableInfo.some((col: any) => col.name === 'raw_analysis');
      
      if (!hasRawAnalysis) {
        const alterTableSql = `
          ALTER TABLE TestResults ADD COLUMN raw_analysis TEXT;
        `;
        db.exec(alterTableSql);
        console.log('Migration 1 applied successfully');
      } else {
        console.log('Migration 1: raw_analysis column already exists, skipping');
      }
    } catch (error: any) {
      // Se la tabella non esiste ancora, è ok, verrà creata dopo
      if (error.code === 'SQLITE_ERROR' && error.message.includes('no such table')) {
        console.log('Migration 1: TestResults table does not exist yet, skipping');
      } else {
        console.error('Error applying migration 1:', error);
        throw error;
      }
    }
  }
};

/**
 * Definizione di tutte le migrazioni disponibili in ordine.
 * Aggiungi qui nuove migrazioni quando necessario.
 */
const migrations = [
  migration1,
  // Aggiungi qui future migrazioni:
  // migration2,
  // migration3,
  // ...
];

/**
 * Applica tutte le migrazioni del database in ordine
 */
export function applyDatabaseMigrations(): void {
  try {
    console.log('Starting database migrations...');
    
    // Inizializza tabella versioni
    initVersionTable();
    
    // Ottieni versione corrente
    const currentVersion = getCurrentVersion();
    console.log(`Current database schema version: ${currentVersion}`);
    
    // Applica migrazioni in ordine
    let migrationsApplied = 0;
    
    migrations.forEach(migration => {
      if (migration.version.version > currentVersion) {
        console.log(`Applying migration ${migration.version.version}: ${migration.version.description}`);
        if (applyMigration(migration)) {
          migrationsApplied++;
        }
      }
    });
    
    console.log(`Database migrations complete. Applied ${migrationsApplied} migrations.`);
  } catch (error) {
    console.error('Error applying database migrations:', error);
  }
}
