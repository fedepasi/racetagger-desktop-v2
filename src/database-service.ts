import * as crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, DEBUG_MODE } from './config';
import { authService } from './auth-service'; // Per ottenere user_id

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



// --- Types (corrispondenti allo schema Supabase) ---

export interface Execution {
  id?: string; // UUID
  project_id?: string | null; // UUID - DEPRECATED: Always NULL now. Projects table deleted.
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

export interface PresetParticipantDriver {
  id?: string;
  participant_id?: string;
  driver_name: string;
  driver_metatag?: string | null;
  driver_order: number;
  created_at?: string;
}

export interface PresetParticipant {
  id?: string;
  preset_id: string;
  numero?: string;  // Optional: Team Principal, VIP, mechanics may not have a race number
  preset_participant_drivers?: PresetParticipantDriver[];
  nome?: string; // Legacy CSV fallback (single name from CSV import)
  squadra?: string;
  sponsors?: string[]; // Array di sponsor
  metatag?: string;
  categoria?: string;        // Category (GT3, F1, MotoGP, etc.)
  plate_number?: string;     // License plate for future car recognition
  folder_1?: string;         // Custom folder 1
  folder_2?: string;         // Custom folder 2
  folder_3?: string;         // Custom folder 3
  folder_1_path?: string;    // Absolute filesystem path for folder 1
  folder_2_path?: string;    // Absolute filesystem path for folder 2
  folder_3_path?: string;    // Absolute filesystem path for folder 3
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


// --- Executions Data Service (Supabase + Cache) ---
// NOTE: Projects table deleted. Executions are now standalone (project_id always NULL).

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

// --- CSV STORAGE AND SYNC FUNCTIONS ---

const CSV_BUCKET_NAME = 'user-csv-files'; // General user CSV storage bucket (not project-specific)

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

// A custom folder can be a simple name string or an object with name + optional absolute path
export interface CustomFolder {
  name: string;
  path?: string; // Optional absolute filesystem path
}

export interface ParticipantPresetSupabase {
  id?: string;
  user_id: string;
  name: string;
  category_id?: string;
  description?: string;
  is_template?: boolean;
  is_public?: boolean;
  custom_folders?: (string | CustomFolder)[]; // Array of folder names or {name, path?} objects
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
  folder_1_path?: string;    // Absolute filesystem path for folder 1
  folder_2_path?: string;    // Absolute filesystem path for folder 2
  folder_3_path?: string;    // Absolute filesystem path for folder 3
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
  participant_id: string | null;
  driver_id: string | null;
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
  participant_id: string | null;
  driver_id: string | null;
  user_id: string; // Required for RLS policy
  photo_url: string;
  storage_path: string;
  face_descriptor?: number[];        // Legacy 128-dim (face-api.js)
  face_descriptor_512?: number[];    // AuraFace v1 512-dim
  descriptor_model?: string;         // 'face-api-js' | 'auraface-v1'
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
        preset_participants(
          *,
          preset_participant_drivers(
            id,
            driver_name,
            driver_metatag,
            driver_order,
            created_at
          )
        )
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
      //console.log(`[DB] Preset "${preset.name}" has ${participantCount} participants`);
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
    console.log('[DB Reload] 🔵 getParticipantPresetByIdSupabase called for preset', presetId);
    const cached = presetsCache.find(p => p.id === presetId);
    if (cached) {
      const cachedParticipants = cached.participants || (cached as any).preset_participants;
      if (cachedParticipants && cachedParticipants.length > 0) {
        console.log(`[DB Reload] 📦 CACHE HIT - Returning cached preset with ${cachedParticipants.length} participants`);
        // Ensure participants property is set for UI compatibility
        if (!cached.participants) {
          cached.participants = cachedParticipants;
        }
        return cached;
      }
    }

    console.log('[DB Reload] 🌐 CACHE MISS - Fetching fresh data from Supabase with drivers included');

    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const { data, error } = await authenticatedClient
      .from('participant_presets')
      .select(`
        *,
        sport_categories(code, name, ai_prompt),
        preset_participants(
          *,
          preset_participant_drivers(
            id,
            driver_name,
            driver_metatag,
            driver_order,
            created_at
          )
        )
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
      const participantsWithDrivers = data.participants.filter((p: any) => p.preset_participant_drivers?.length > 0);
      console.log(`[DB Reload] ✅ Loaded preset with ${data.participants.length} participants from Supabase`);
      console.log(`[DB Reload] 🚗 ${participantsWithDrivers.length} participants have driver records`);
      if (participantsWithDrivers.length > 0) {
        console.log('[DB Reload] Driver details:', participantsWithDrivers.map((p: any) =>
          `#${p.numero}: ${p.preset_participant_drivers?.length} drivers`
        ).join(', '));
      }
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
export async function savePresetParticipantsSupabase(presetId: string, participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[]): Promise<PresetParticipantSupabase[]> {
  try {
    console.log('[DB Save] 🔵 START savePresetParticipantsSupabase:', {
      presetId,
      participantCount: participants.length,
      participantNumbers: participants.map(p => p.numero).join(', ')
    });

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

    // ⚠️ CRITICAL FIX: Replace "nuclear delete" with intelligent UPSERT
    // This preserves existing participant IDs and their associated drivers/photos
    console.log('[DB Save] 🔄 UPSERT mode: preserving existing participant IDs');

    // Get current participants from database
    const { data: currentInDb, error: fetchError } = await supabase
      .from('preset_participants')
      .select('id, numero')
      .eq('preset_id', presetId);

    if (fetchError) {
      console.error('[DB Save] ❌ Error fetching current participants:', fetchError);
      throw fetchError;
    }

    const currentIds = new Set((currentInDb || []).map(p => p.id));
    console.log('[DB Save] 📋 Current participants in DB:', currentInDb?.length || 0, 'records');

    // Separate participants into existing (have IDs) vs new (no IDs)
    const existingParticipants = participants.filter(p => (p as any).id);
    const newParticipants = participants.filter(p => !(p as any).id);
    const keepIds = new Set(existingParticipants.map(p => (p as any).id));

    // Find participants to delete (in DB but not in current list)
    const toDelete = [...currentIds].filter(id => !keepIds.has(id));

    console.log('[DB Save] 📊 Operation breakdown:', {
      update: existingParticipants.length,
      insert: newParticipants.length,
      delete: toDelete.length
    });

    let savedParticipants: PresetParticipantSupabase[] = [];

    // 1. UPDATE existing participants (preserves IDs and associated data)
    if (existingParticipants.length > 0) {
      console.log('[DB Save] 🔄 Updating', existingParticipants.length, 'existing participants');
      for (const participant of existingParticipants) {
        const { id, ...participantData } = participant as any;
        console.log(`[DB Save]   ↻ Updating participant #${participantData.numero} (ID: ${id?.substring(0, 8)}...)`);

        const { data: updated, error: updateError } = await supabase
          .from('preset_participants')
          .update({ ...participantData, preset_id: presetId })
          .eq('id', id)
          .select()
          .single();

        if (updateError) {
          console.error(`[DB Save] ❌ Error updating participant ${id}:`, updateError);
          throw updateError;
        }

        if (updated) {
          savedParticipants.push(updated);
        }
      }
      console.log('[DB Save] ✅ Updated', existingParticipants.length, 'participants');
    }

    // 2. INSERT new participants
    if (newParticipants.length > 0) {
      console.log('[DB Save] 💾 Inserting', newParticipants.length, 'new participants');
      const { data: insertedData, error: insertError } = await supabase
        .from('preset_participants')
        .insert(newParticipants.map(p => ({ ...p, preset_id: presetId })))
        .select();

      if (insertError) {
        console.error('[DB Save] ❌ Error inserting participants:', insertError);
        throw insertError;
      }

      if (insertedData) {
        savedParticipants.push(...insertedData);
        console.log('[DB Save] ✅ Inserted', insertedData.length, 'participants with new IDs:',
          insertedData.map(p => `#${p.numero} (${p.id?.substring(0, 8) || 'no-id'}...)`).join(', ')
        );
      }
    }

    // 3. DELETE removed participants (surgical delete, not nuclear)
    if (toDelete.length > 0) {
      console.log('[DB Save] 🗑️  Deleting', toDelete.length, 'removed participants');
      const { error: deleteError } = await supabase
        .from('preset_participants')
        .delete()
        .in('id', toDelete);

      if (deleteError) {
        console.error('[DB Save] ❌ Error deleting participants:', deleteError);
        // Don't throw - deletes are less critical than updates/inserts
      } else {
        console.log('[DB Save] ✅ Deleted', toDelete.length, 'participants');
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

    // ⚠️ CRITICAL FIX: Invalidate cache to force reload with complete driver data
    console.log('[DB Save] 🧹 Invalidating cache for preset', presetId);
    const cacheIndex = presetsCache.findIndex(p => p.id === presetId);
    if (cacheIndex !== -1) {
      presetsCache.splice(cacheIndex, 1);
      console.log('[DB Save] ✅ Removed preset from cache');
    }
    cacheLastUpdated = 0;

    // ⚠️ NEW: Reload preset with complete driver data
    // savedParticipants from UPSERT doesn't include preset_participant_drivers
    // Do fresh query with drivers included to return complete data
    console.log('[DB Save] 🔄 Reloading preset with complete driver data');
    const { data: reloadedPreset, error: reloadError } = await supabase
      .from('participant_presets')
      .select(`
        *,
        participants:preset_participants(
          *,
          drivers:preset_participant_drivers(*)
        )
      `)
      .eq('id', presetId)
      .single();

    if (reloadError) {
      console.error('[DB Save] ⚠️  Error reloading preset (returning basic data):', reloadError);
      // Fall back to returning what we have
      console.log('[DB Save] 🟢 COMPLETE savePresetParticipantsSupabase - returning', savedParticipants.length, 'participants (basic data)');
      return savedParticipants;
    }

    if (reloadedPreset?.participants) {
      console.log('[DB Save] ✅ Reloaded', reloadedPreset.participants.length, 'participants with complete driver data');
      console.log('[DB Save] 🟢 COMPLETE savePresetParticipantsSupabase - returning complete data with drivers');
      return reloadedPreset.participants;
    }

    console.log('[DB Save] 🟢 COMPLETE savePresetParticipantsSupabase - returning', savedParticipants.length, 'participants');
    return savedParticipants;

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
        folder_1_path: p.folder_1_path || '',
        folder_2_path: p.folder_2_path || '',
        folder_3_path: p.folder_3_path || '',
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
 * Import participants from CSV to Supabase (with driver ID preservation)
 */
export async function importParticipantsFromCSVSupabase(csvData: any[], presetName: string, categoryId?: string): Promise<ParticipantPresetSupabase> {
  const supabase = authService.getSupabaseClient();

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
      folder_1_path: row.folder_1_path || row.Folder_1_Path || '',
      folder_2_path: row.folder_2_path || row.Folder_2_Path || '',
      folder_3_path: row.folder_3_path || row.Folder_3_Path || '',
      sort_order: index,
      custom_fields: {
        // Store any additional CSV fields
        ...Object.keys(row).reduce((acc, key) => {
          const knownFields = ['numero', 'Number', 'nome', 'Driver', 'categoria', 'Category', 'squadra', 'team', 'Team', 'sponsor', 'Sponsors', 'metatag', 'Metatag', 'plate_number', 'Plate_Number', 'folder_1', 'Folder_1', 'folder_2', 'Folder_2', 'folder_3', 'Folder_3', 'folder_1_path', 'Folder_1_Path', 'folder_2_path', 'Folder_2_Path', 'folder_3_path', 'Folder_3_Path', '_Driver_IDs', '_driver_ids', '_Driver_Metatags', '_driver_metatags'];
          if (!knownFields.includes(key)) {
            acc[key] = row[key];
          }
          return acc;
        }, {} as any)
      }
    };

    return participant;
  });

  const savedParticipants = await savePresetParticipantsSupabase(preset.id!, participants);

  // NEW: Process driver metadata from CSV hidden columns
  for (let i = 0; i < csvData.length; i++) {
    const row = csvData[i];
    const savedParticipant = savedParticipants[i];

    // Check for driver ID preservation columns (case-insensitive)
    const driverIdsRaw = row._Driver_IDs || row._driver_ids || '';
    const driverMetatagsRaw = row._Driver_Metatags || row._driver_metatags || '';
    const driverNamesRaw = row.nome || row.Driver || '';

    // Parse driver names (comma-separated)
    const driverNames = driverNamesRaw ? driverNamesRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

    if (driverIdsRaw && driverNames.length > 0) {
      // PRESERVE MODE: CSV has driver IDs - reuse them
      const ids = driverIdsRaw.split('|').map((s: string) => s.trim()).filter(Boolean);
      const metatags = driverMetatagsRaw ? driverMetatagsRaw.split('|').map((s: string) => s.trim()) : [];

      const driversToCreate = driverNames.map((name: string, idx: number) => ({
        id: ids[idx] || crypto.randomUUID(), // Reuse ID or generate new
        participant_id: savedParticipant.id,
        driver_name: name,
        driver_metatag: metatags[idx] || null,
        driver_order: idx,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Upsert drivers (preserves IDs)
      await supabase.from('preset_participant_drivers').upsert(driversToCreate);

      console.log(`[DB] CSV Import: Preserved ${driversToCreate.length} driver IDs for participant ${savedParticipant.numero}`);

    } else if (driverNames.length > 1) {
      // LEGACY MODE: No IDs in CSV - create new drivers
      const driversToCreate = driverNames.map((name: string, idx: number) => ({
        id: crypto.randomUUID(),
        participant_id: savedParticipant.id,
        driver_name: name,
        driver_metatag: null,
        driver_order: idx,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      await supabase.from('preset_participant_drivers').insert(driversToCreate);

      console.log(`[DB] CSV Import: Created ${driversToCreate.length} new drivers for participant ${savedParticipant.numero}`);
    }
  }

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
 * Get all face photos for a participant or driver
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function getPresetParticipantFacePhotos(participantId?: string, driverId?: string): Promise<PresetParticipantFacePhoto[]> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    let query = authenticatedClient
      .from('preset_participant_face_photos')
      .select('*');

    if (participantId) {
      query = query.eq('participant_id', participantId);
    } else if (driverId) {
      query = query.eq('driver_id', driverId);
    } else {
      throw new Error('Either participantId or driverId must be provided');
    }

    const { data, error } = await query
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
 * Add a new face photo for a participant or driver
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function addPresetParticipantFacePhoto(params: CreatePresetFacePhotoParams): Promise<PresetParticipantFacePhoto> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    // Build insert object with optional 512-dim fields
    const insertData: Record<string, any> = {
      participant_id: params.participant_id,
      driver_id: params.driver_id,
      user_id: params.user_id,
      photo_url: params.photo_url,
      storage_path: params.storage_path,
      face_descriptor: params.face_descriptor || null,
      photo_type: params.photo_type || 'reference',
      detection_confidence: params.detection_confidence || null,
      is_primary: params.is_primary || false
    };

    // Include 512-dim descriptor if provided (AuraFace v1)
    if (params.face_descriptor_512) {
      insertData.face_descriptor_512 = params.face_descriptor_512;
    }
    if (params.descriptor_model) {
      insertData.descriptor_model = params.descriptor_model;
    }

    const { data, error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .insert(insertData)
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
 * Includes both participant-level and driver-level face photos
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function loadPresetFaceDescriptors(presetId: string): Promise<Array<{
  personId: string;
  personName: string;
  personMetatag?: string; // Driver-specific metatag (for drivers only)
  team: string;
  carNumber: string;
  descriptor: number[];
  referencePhotoUrl: string;
  source: 'preset';
  photoType: string;
  isPrimary: boolean;
  isDriver?: boolean; // True if this is a driver-specific descriptor
}>> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    const descriptors: Array<{
      personId: string;
      personName: string;
      personMetatag?: string;
      team: string;
      carNumber: string;
      descriptor: number[];
      referencePhotoUrl: string;
      source: 'preset';
      photoType: string;
      isPrimary: boolean;
      isDriver?: boolean;
    }> = [];

    // 1. Get all participants with their direct face photos (backward compatibility)
    const { data: participants, error: participantsError } = await authenticatedClient
      .from('preset_participants')
      .select(`
        id,
        numero,
        nome,
        squadra,
        preset_participant_face_photos!participant_id (
          id,
          photo_url,
          face_descriptor,
          face_descriptor_512,
          descriptor_model,
          photo_type,
          is_primary,
          detection_confidence
        )
      `)
      .eq('preset_id', presetId);

    if (participantsError) {
      console.error('[DB] Error loading preset face descriptors (participants):', participantsError);
      throw participantsError;
    }

    // Add participant-level descriptors
    for (const participant of participants || []) {
      const facePhotos = (participant as any).preset_participant_face_photos || [];

      for (const photo of facePhotos) {
        // Dual-read: prefer face_descriptor_512 (AuraFace 512-dim), fallback to face_descriptor (128-dim)
        const descriptor512 = photo.face_descriptor_512;
        const descriptor128 = photo.face_descriptor;

        let descriptor: number[] | null = null;
        if (descriptor512 && Array.isArray(descriptor512) && descriptor512.length === 512) {
          descriptor = Array.from(descriptor512);
        } else if (descriptor128 && Array.isArray(descriptor128) && descriptor128.length === 128) {
          descriptor = Array.from(descriptor128);
        }

        if (!descriptor) continue;

        descriptors.push({
          personId: participant.id,
          personName: participant.nome || `#${participant.numero}`,
          team: participant.squadra || '',
          carNumber: participant.numero,
          descriptor,
          referencePhotoUrl: photo.photo_url,
          source: 'preset',
          photoType: photo.photo_type || 'reference',
          isPrimary: photo.is_primary || false,
          isDriver: false
        });
      }
    }

    // 2. Get all drivers with their specific face photos
    // OPTIMIZATION: Split into 2 queries to avoid complex joins and statement timeout

    // 2a. First get all participant IDs for this preset (simple, fast query)
    const participantIds = (participants || []).map(p => p.id);

    if (participantIds.length > 0) {
      // 2b. Get drivers for these participants (no join on preset_participants needed)
      const { data: drivers, error: driversError } = await authenticatedClient
        .from('preset_participant_drivers')
        .select(`
          id,
          driver_name,
          driver_metatag,
          participant_id
        `)
        .in('participant_id', participantIds);

      if (driversError) {
        console.error('[DB] Error loading preset drivers:', driversError);
        // Don't throw - this is optional (for new feature)
      } else if (drivers && drivers.length > 0) {
        // 2c. Get face photos for all drivers (separate query, avoids nested joins)
        const driverIds = drivers.map(d => d.id);

        const { data: driverPhotos, error: photosError } = await authenticatedClient
          .from('preset_participant_face_photos')
          .select(`
            id,
            driver_id,
            photo_url,
            face_descriptor,
            face_descriptor_512,
            descriptor_model,
            photo_type,
            is_primary,
            detection_confidence
          `)
          .in('driver_id', driverIds);

        if (photosError) {
          console.error('[DB] Error loading driver face photos:', photosError);
        } else {
          // Match photos to drivers
          for (const driver of drivers) {
            // Find participant data for this driver
            const participant = participants?.find(p => p.id === driver.participant_id);

            // Find all photos for this driver
            const facePhotos = (driverPhotos || []).filter(p => p.driver_id === driver.id);

            for (const photo of facePhotos) {
              // Dual-read: prefer face_descriptor_512 (AuraFace 512-dim), fallback to face_descriptor (128-dim)
              const descriptor512 = photo.face_descriptor_512;
              const descriptor128 = photo.face_descriptor;

              let descriptor: number[] | null = null;
              if (descriptor512 && Array.isArray(descriptor512) && descriptor512.length === 512) {
                descriptor = Array.from(descriptor512);
              } else if (descriptor128 && Array.isArray(descriptor128) && descriptor128.length === 128) {
                descriptor = Array.from(descriptor128);
              }

              if (!descriptor) continue;

              descriptors.push({
                personId: driver.id,
                personName: driver.driver_name,
                personMetatag: driver.driver_metatag || undefined,
                team: participant?.squadra || '',
                carNumber: participant?.numero || '',
                descriptor,
                referencePhotoUrl: photo.photo_url,
                source: 'preset',
                photoType: photo.photo_type || 'reference',
                isPrimary: photo.is_primary || false,
                isDriver: true
              });
            }
          }
        }
      }
    }

    if (DEBUG_MODE) {
      console.log(`[DB] Loaded ${descriptors.length} face descriptors from preset ${presetId} (${descriptors.filter(d => d.isDriver).length} from drivers)`);
    }

    return descriptors;
  } catch (error) {
    console.error('[DB] Failed to load preset face descriptors:', error);
    throw error;
  }
}

/**
 * Get face photo count for a participant or driver
 * Uses authenticated Supabase client for RLS policy compliance
 */
export async function getPresetParticipantFacePhotoCount(targetId: string, isDriver: boolean = false): Promise<number> {
  try {
    // Use authenticated client from authService for RLS policy compliance
    const authenticatedClient = authService.getSupabaseClient();

    let query = authenticatedClient
      .from('preset_participant_face_photos')
      .select('*', { count: 'exact', head: true });

    if (isDriver) {
      query = query.eq('driver_id', targetId);
    } else {
      query = query.eq('participant_id', targetId);
    }

    const { count, error } = await query;

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

