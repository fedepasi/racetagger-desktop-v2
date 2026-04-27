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
  source_folder?: string | null; // Local filesystem path of source folder (for R2 HD upload)
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
  driver_nationality?: string | null;
  driver_order: number;
  created_at?: string;
  // v1.1.4 — Preset Participant Toggle: soft-disable flag. When false, this
  // driver is excluded from AI matching (face recognition, name matching)
  // but kept in the preset so the user can re-enable it without re-entry.
  is_active?: boolean;
}

export interface PresetParticipant {
  id?: string;
  preset_id: string;
  numero?: string;  // Optional: Team Principal, VIP, mechanics may not have a race number
  preset_participant_drivers?: PresetParticipantDriver[];
  nome?: string; // Legacy CSV fallback (single name from CSV import)
  squadra?: string;
  car_model?: string;        // Vehicle model (RB20, Ferrari 296 GT3, etc.) — {car_model} in IPTC templates
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
  delivery_to_client_id?: string | null; // FK to projects (client) for auto-delivery routing
  created_at?: string;
  // v1.1.4 — Preset Participant Toggle: soft-disable flag. When false, the
  // entire participant (car/crew) is excluded from AI matching (numero, livrea,
  // faces) but kept in the preset for reversibility. Defaults TRUE on the DB.
  is_active?: boolean;
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

  // FIX: Always use the authenticated client for execution creation.
  // The module-level `supabase` variable starts as anon key client and only gets updated
  // when getSupabaseClient() is called. Without this, INSERT may fail with RLS violation
  // (code 42501) since executions table has RLS enabled with user-based policies.
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('executions')
    .insert([{ ...executionData, user_id: userId }])
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to create execution: no data returned.');

  return data as Execution;
}

export async function getExecutionByIdOnline(id: string): Promise<Execution | null> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const client = getSupabaseClient(); // FIX: Use authenticated client

  const { data, error } = await client
    .from('executions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as Execution | null;
}

export async function updateExecutionOnline(id: string, executionUpdateData: Partial<Omit<Execution, 'id' | 'user_id' | 'project_id' | 'created_at' | 'updated_at'>>): Promise<Execution> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const client = getSupabaseClient(); // FIX: Use authenticated client

  const { data, error } = await client
    .from('executions')
    .update(executionUpdateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to update execution or execution not found.');

  return data as Execution;
}

export async function deleteExecutionOnline(id: string): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated.');

  const client = getSupabaseClient(); // FIX: Use authenticated client

  const { error } = await client
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
  min_app_version?: number;        // Minimum app version number to display this category (0 = all)
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
  use_local_onnx?: boolean;              // Use local ONNX model for detection (PRO recognition)
  active_model_id?: string;              // UUID FK to model_registry - active ONNX model for this category
  recognition_method?: string;           // Detection method type (e.g., 'onnx', 'cloud')
  recognition_config?: {
    maxResults: number;
    minConfidence: number;
    confidenceDecayFactor: number;
    relativeConfidenceGap: number;
    focusMode: string;
    ignoreBackground: boolean;
    prioritizeForeground: boolean;
  };
  sharpness_filter_config?: {
    enabled: boolean;
    dominanceRatio: number;
    debug: boolean;
  };
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
  is_official?: boolean;
  iptc_metadata?: any;  // PresetIptcMetadata stored as JSONB

  // Issue #104: When true, Gemini is allowed to identify persons outside the
  // preset participant list (team principals, VIPs, celebrities). Results go
  // into a separate `otherPeople[]` field in the V6 response, never into
  // `drivers[]`. Default false = strict preset-only mode.
  allow_external_person_recognition?: boolean;
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
  delivery_to_client_id?: string | null; // FK to projects (client) for auto-delivery routing
  custom_fields?: any;
  sort_order?: number;
  created_at?: string;
  face_photo_count?: number; // Cached count of face photos
  // v1.1.4 — Preset Participant Toggle: soft-disable flag mirrored from the
  // Supabase row. Consumers MUST filter on is_active !== false before feeding
  // the participant into smart-matcher / prompt-builder.
  is_active?: boolean;
  updated_at?: string; // Added in migration 20260417130000 alongside is_active
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
 * Invalidate the presets cache so next fetch returns fresh data from Supabase.
 * Used after learned data is saved to preset_participants.
 */
export function invalidatePresetsCache(): void {
  presetsCache = [];
  cacheLastUpdated = 0;
  console.log('[Cache] Presets cache invalidated');
}

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
            driver_nationality,
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
            driver_nationality,
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
      const insertPayload = newParticipants.map(p => {
        const { id, created_at, ...cleanData } = p as any;
        // FIX #78: Explicitly remove id and created_at to ensure Postgres uses DEFAULT gen_random_uuid()
        // Edge case: if id was null/undefined, destructuring removes it from cleanData,
        // but an extra safety delete ensures no serialization quirk sends null to Postgres
        const record: any = { ...cleanData, preset_id: presetId };
        delete record.id;
        delete record.created_at;
        return record;
      });

      // Log first record shape for debugging (omit actual data values)
      if (insertPayload.length > 0) {
        console.log('[DB Save] 📋 Insert record keys:', Object.keys(insertPayload[0]).join(', '),
          '| has id?', 'id' in insertPayload[0]);
      }

      const { data: insertedData, error: insertError } = await supabase
        .from('preset_participants')
        .insert(insertPayload)
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
export async function updateParticipantPresetSupabase(presetId: string, updateData: Partial<Pick<ParticipantPresetSupabase, 'name' | 'description' | 'category_id' | 'custom_folders' | 'iptc_metadata' | 'allow_external_person_recognition'>>): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  await withRetry(async () => {
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
  }, 'updateParticipantPreset', 3, 1000);
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

// ============================================================================
// PRESET PARTICIPANT TOGGLE (v1.1.4) — soft-disable API
// ----------------------------------------------------------------------------
// Four entry points the renderer / IPC layer uses to flip is_active on
// preset_participants and preset_participant_drivers without deleting data.
//
// Authorisation is enforced by Supabase RLS (policy restricts UPDATE to
// `participant_presets.user_id = auth.uid() AND is_official = false`). The
// client-side checks below are UX-only: a public/official preset cannot be
// toggled, so we short-circuit before the network call to give a clear error.
//
// Every successful mutation invalidates:
//   - `presetsCache` entry for the affected preset (so subsequent reads
//     reflect the new state)
//   - `cacheLastUpdated` (force re-fetch on next list call)
// The edge-function `preset-loader` cache is warm-instance only and will
// expire on its own; callers that need immediate server-side effect should
// also invalidate via the dedicated admin RPC (future work, not v1.1.4).
// ============================================================================

/**
 * Invalidate the local preset cache entry for a given preset so the next read
 * goes back to Supabase. Small wrapper used by the toggle mutators below.
 */
function invalidatePresetCacheEntry(presetId: string): void {
  const idx = presetsCache.findIndex(p => p.id === presetId);
  if (idx !== -1) {
    presetsCache.splice(idx, 1);
  }
  cacheLastUpdated = 0;
}

/**
 * Toggle the `is_active` flag on a single preset participant.
 *
 * @param participantId UUID of the preset_participants row.
 * @param isActive New value. `false` = excluded from AI matching; `true` = default/re-enable.
 * @throws when the user is unauthenticated or RLS rejects the update
 *         (which happens for public/official presets — callers should treat
 *         that as a UX "read-only" signal and prompt the user to duplicate).
 */
export async function togglePresetParticipantActive(
  participantId: string,
  isActive: boolean
): Promise<PresetParticipantSupabase> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  const authenticatedClient = authService.getSupabaseClient();

  // Use .select('*, participant_presets!inner(user_id, is_official)') so RLS
  // gives us a deterministic error instead of a silent 0-row update when the
  // preset is public/official.
  const { data, error } = await authenticatedClient
    .from('preset_participants')
    .update({ is_active: isActive })
    .eq('id', participantId)
    .select('*, participant_presets!inner(id, user_id, is_official)')
    .single();

  if (error) {
    console.error('[DB] togglePresetParticipantActive failed:', error);
    throw error;
  }

  const presetId = (data as any)?.preset_id;
  if (presetId) invalidatePresetCacheEntry(presetId);

  console.log(`[DB] Participant ${participantId} is_active → ${isActive}`);
  return data as PresetParticipantSupabase;
}

/**
 * Toggle the `is_active` flag on a single driver inside a multi-driver
 * participant (e.g. WEC endurance crews).
 *
 * Note: disabling the last active driver in a crew does NOT automatically
 * disable the parent participant — that's a UI-layer concern and the caller
 * should surface a warning ("all drivers disabled, car will still be
 * matched by numero/livrea"). Keeping the two flags independent lets the
 * user disable just face recognition for one pilot without affecting the
 * whole car's number/livery matching.
 */
export async function togglePresetDriverActive(
  driverId: string,
  isActive: boolean
): Promise<PresetParticipantDriver> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  const authenticatedClient = authService.getSupabaseClient();

  const { data, error } = await authenticatedClient
    .from('preset_participant_drivers')
    .update({ is_active: isActive })
    .eq('id', driverId)
    .select('*, preset_participants!inner(preset_id, participant_presets!inner(id, user_id, is_official))')
    .single();

  if (error) {
    console.error('[DB] togglePresetDriverActive failed:', error);
    throw error;
  }

  // Navigate the joined structure to find the preset id for cache invalidation
  const presetId = (data as any)?.preset_participants?.preset_id;
  if (presetId) invalidatePresetCacheEntry(presetId);

  console.log(`[DB] Driver ${driverId} is_active → ${isActive}`);
  return data as PresetParticipantDriver;
}

/**
 * Bulk-toggle is_active for many participants of the same preset in one round
 * trip. Used by the "Disable all from team X" / "Re-enable all" UI action.
 *
 * @param presetId UUID of the participant_presets row the IDs must belong to.
 *   Passed separately so we can narrow the UPDATE — RLS still verifies
 *   ownership via the preset — and so the server can reject cross-preset IDs
 *   injected by a rogue payload.
 * @param participantIds UUIDs of preset_participants rows to update. Must all
 *   belong to `presetId`.
 * @param isActive New value to apply to every row.
 * @returns the number of rows actually updated.
 */
export async function bulkSetPresetParticipantsActive(
  presetId: string,
  participantIds: string[],
  isActive: boolean
): Promise<number> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');
  if (!Array.isArray(participantIds) || participantIds.length === 0) return 0;

  const authenticatedClient = authService.getSupabaseClient();

  const { data, error } = await authenticatedClient
    .from('preset_participants')
    .update({ is_active: isActive })
    .eq('preset_id', presetId)
    .in('id', participantIds)
    .select('id');

  if (error) {
    console.error('[DB] bulkSetPresetParticipantsActive failed:', error);
    throw error;
  }

  invalidatePresetCacheEntry(presetId);
  const updated = Array.isArray(data) ? data.length : 0;
  console.log(`[DB] Bulk set is_active=${isActive} on ${updated}/${participantIds.length} participants of preset ${presetId}`);
  return updated;
}

/**
 * Reset every participant and every driver of a preset back to is_active = true.
 *
 * This is the "Ripristina tutti" action in the editor header: it's one
 * confirmation away from undoing every soft-disable. We deliberately do NOT
 * require the caller to list IDs — the operation is scoped to `presetId` and
 * RLS keeps it constrained to presets owned by the current user.
 */
export async function resetPresetActiveStates(presetId: string): Promise<{
  participantsReset: number;
  driversReset: number;
}> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  const authenticatedClient = authService.getSupabaseClient();

  // 1. Reset participants
  const { data: partData, error: partErr } = await authenticatedClient
    .from('preset_participants')
    .update({ is_active: true })
    .eq('preset_id', presetId)
    .eq('is_active', false) // no-op rows skipped — cheaper + updated_at stays clean
    .select('id');

  if (partErr) {
    console.error('[DB] resetPresetActiveStates (participants) failed:', partErr);
    throw partErr;
  }

  // 2. Reset drivers. Need to scope by participant_id IN (SELECT id FROM
  //    preset_participants WHERE preset_id = $1). Supabase-js does not support
  //    subselects here, so fetch the participant id list first.
  const { data: allPartIds, error: idsErr } = await authenticatedClient
    .from('preset_participants')
    .select('id')
    .eq('preset_id', presetId);
  if (idsErr) {
    console.error('[DB] resetPresetActiveStates (fetch participant ids) failed:', idsErr);
    throw idsErr;
  }
  const partIds = (allPartIds || []).map((r: any) => r.id).filter(Boolean);

  let driversReset = 0;
  if (partIds.length > 0) {
    const { data: drvData, error: drvErr } = await authenticatedClient
      .from('preset_participant_drivers')
      .update({ is_active: true })
      .in('participant_id', partIds)
      .eq('is_active', false)
      .select('id');
    if (drvErr) {
      console.error('[DB] resetPresetActiveStates (drivers) failed:', drvErr);
      throw drvErr;
    }
    driversReset = Array.isArray(drvData) ? drvData.length : 0;
  }

  invalidatePresetCacheEntry(presetId);
  const participantsReset = Array.isArray(partData) ? partData.length : 0;
  console.log(`[DB] Reset preset ${presetId}: ${participantsReset} participants + ${driversReset} drivers re-enabled`);
  return { participantsReset, driversReset };
}

// ============================================================================
// IPTC METADATA PROFILE MANAGEMENT
// ============================================================================

/**
 * Get the IPTC metadata profile for a preset
 */
export async function getPresetIptcMetadata(presetId: string): Promise<any | null> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    const authenticatedClient = authService.getSupabaseClient();

    const { data, error } = await authenticatedClient
      .from('participant_presets')
      .select('iptc_metadata')
      .eq('id', presetId)
      .or(`user_id.eq.${userId},is_public.eq.true,is_official.eq.true`)
      .single();

    if (error) {
      console.error('[DB] Error getting IPTC metadata:', error);
      return null;
    }

    return data?.iptc_metadata || null;
  } catch (error) {
    console.error('[DB] Error getting IPTC metadata:', error);
    throw error;
  }
}

/**
 * Save/update the IPTC metadata profile for a preset
 */
export async function savePresetIptcMetadata(presetId: string, iptcMetadata: any): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('User not authenticated');

  await withRetry(async () => {
    const { error } = await supabase
      .from('participant_presets')
      .update({
        iptc_metadata: iptcMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', presetId)
      .eq('user_id', userId);

    if (error) {
      console.error('[DB] Error saving IPTC metadata:', error);
      throw error;
    }

    // Update cache if available
    const cacheIndex = presetsCache.findIndex(p => p.id === presetId);
    if (cacheIndex !== -1) {
      presetsCache[cacheIndex] = {
        ...presetsCache[cacheIndex],
        iptc_metadata: iptcMetadata,
        updated_at: new Date().toISOString()
      };
    }
  }, 'savePresetIptcMetadata', 3, 1000);
}

/**
 * Duplicate any preset for the current user
 * Creates a personal copy of a preset (official or user-owned) that the user can customize
 */
export async function duplicateOfficialPresetSupabase(sourcePresetId: string): Promise<ParticipantPresetSupabase> {
  try {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    // Get the source preset (official or user-owned)
    const { data: sourcePreset, error: sourceError } = await supabase
      .from('participant_presets')
      .select(`
        *,
        preset_participants(*)
      `)
      .eq('id', sourcePresetId)
      .single();

    if (sourceError || !sourcePreset) {
      throw new Error('Source preset not found');
    }

    // Create the new preset (personal copy)
    const newPreset = await createParticipantPresetSupabase({
      user_id: userId,
      name: `${sourcePreset.name} (My Copy)`,
      description: sourcePreset.description || `Duplicated from: ${sourcePreset.name}`,
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
      car_model: row.car_model || row.Car_Model || '',
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
          const knownFields = ['numero', 'Number', 'nome', 'Driver', 'categoria', 'Category', 'squadra', 'team', 'Team', 'sponsor', 'Sponsors', 'metatag', 'Metatag', 'plate_number', 'Plate_Number', 'folder_1', 'Folder_1', 'folder_2', 'Folder_2', 'folder_3', 'Folder_3', 'folder_1_path', 'Folder_1_Path', 'folder_2_path', 'Folder_2_Path', 'folder_3_path', 'Folder_3_Path', '_Driver_IDs', '_driver_ids', '_Driver_Metatags', '_driver_metatags', '_Driver_Nationalities', '_driver_nationalities', 'car_model', 'Car_Model', 'nationality', 'Nationality'];
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
    const driverNationalitiesRaw = row._Driver_Nationalities || row._driver_nationalities || '';
    const driverNamesRaw = row.nome || row.Driver || '';

    // Parse driver names (comma-separated)
    const driverNames = driverNamesRaw ? driverNamesRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

    if (driverIdsRaw && driverNames.length > 0) {
      // PRESERVE MODE: CSV has driver IDs - reuse them
      const ids = driverIdsRaw.split('|').map((s: string) => s.trim()).filter(Boolean);
      const metatags = driverMetatagsRaw ? driverMetatagsRaw.split('|').map((s: string) => s.trim()) : [];
      const nationalities = driverNationalitiesRaw ? driverNationalitiesRaw.split('|').map((s: string) => s.trim()) : [];

      const driversToCreate = driverNames.map((name: string, idx: number) => ({
        id: ids[idx] || crypto.randomUUID(), // Reuse ID or generate new
        participant_id: savedParticipant.id,
        driver_name: name,
        driver_metatag: metatags[idx] || null,
        driver_nationality: nationalities[idx] || null,
        driver_order: idx,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Upsert drivers (preserves IDs)
      await supabase.from('preset_participant_drivers').upsert(driversToCreate);

      console.log(`[DB] CSV Import: Preserved ${driversToCreate.length} driver IDs for participant ${savedParticipant.numero}`);

    } else if (driverNames.length > 1) {
      // LEGACY MODE: No IDs in CSV - create new drivers
      // Check for nationality column (Nationality or _Driver_Nationalities)
      const nationalityRaw = row.Nationality || row.nationality || '';
      const legacyNationalities = driverNationalitiesRaw ? driverNationalitiesRaw.split('|').map((s: string) => s.trim()) : [];

      const driversToCreate = driverNames.map((name: string, idx: number) => ({
        id: crypto.randomUUID(),
        participant_id: savedParticipant.id,
        driver_name: name,
        driver_metatag: null,
        driver_nationality: legacyNationalities[idx] || (idx === 0 ? nationalityRaw : null) || null,
        driver_order: idx,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      await supabase.from('preset_participant_drivers').insert(driversToCreate);

      console.log(`[DB] CSV Import: Created ${driversToCreate.length} new drivers for participant ${savedParticipant.numero}`);
    } else if (driverNames.length === 1) {
      // SINGLE DRIVER: Still check for nationality to preserve
      const nationalityRaw = row.Nationality || row.nationality || '';
      const singleNationality = driverNationalitiesRaw ? driverNationalitiesRaw.split('|')[0]?.trim() : nationalityRaw;

      if (singleNationality) {
        const driverToCreate = {
          id: crypto.randomUUID(),
          participant_id: savedParticipant.id,
          driver_name: driverNames[0],
          driver_metatag: null,
          driver_nationality: singleNationality || null,
          driver_order: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        await supabase.from('preset_participant_drivers').insert([driverToCreate]);
        console.log(`[DB] CSV Import: Created single driver with nationality for participant ${savedParticipant.numero}`);
      }
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

    const { data, error } = await authenticatedClient
      .from('preset_participant_face_photos')
      .insert({
        participant_id: params.participant_id,
        driver_id: params.driver_id,
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
    // v1.1.4 — Preset Participant Toggle: exclude soft-disabled participants so
    // their face descriptors are NOT loaded into the recognizer's memory
    // vector. This is the critical cut for "disable an entire car/crew".
    const { data: participants, error: participantsError } = await authenticatedClient
      .from('preset_participants')
      .select(`
        id,
        numero,
        nome,
        squadra,
        is_active,
        preset_participant_face_photos!participant_id (
          id,
          photo_url,
          face_descriptor,
          photo_type,
          is_primary,
          detection_confidence
        )
      `)
      .eq('preset_id', presetId)
      .eq('is_active', true);

    if (participantsError) {
      console.error('[DB] Error loading preset face descriptors (participants):', participantsError);
      throw participantsError;
    }

    // Add participant-level descriptors
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
      // v1.1.4 — also exclude soft-disabled drivers so their face descriptors
      // aren't added to the recognizer. Belt-and-braces: participant_id is
      // already filtered to active participants above, but a driver can be
      // disabled individually while the parent crew stays active (endurance).
      const { data: drivers, error: driversError } = await authenticatedClient
        .from('preset_participant_drivers')
        .select(`
          id,
          driver_name,
          driver_metatag,
          driver_nationality,
          participant_id,
          is_active
        `)
        .in('participant_id', participantIds)
        .eq('is_active', true);

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
            photo_type,
            is_primary,
            detection_confidence
          `)
          .in('driver_id', driverIds)
          .not('face_descriptor', 'is', null);

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
              // Skip photos without valid descriptors
              if (!photo.face_descriptor || !Array.isArray(photo.face_descriptor) || photo.face_descriptor.length !== 128) {
                continue;
              }

              descriptors.push({
                personId: driver.id,
                personName: driver.driver_name,
                personMetatag: driver.driver_metatag || undefined,
                team: participant?.squadra || '',
                carNumber: participant?.numero || '',
                descriptor: Array.from(photo.face_descriptor),
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

// ==================== PROJECTS ====================

export async function createProject(data: any) {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');

  // Auto-generate client_slug from name if not provided
  const clientName = data.client_name || data.name || 'client';
  if (!data.client_slug) {
    data.client_slug = generateSlug(clientName) + '-' + Math.random().toString(36).substring(2, 6);
  }

  const { data: result, error } = await client.from('projects').insert({ ...data, user_id: userId }).select().single();
  if (error) throw new Error(error.message);
  return result;
}

export async function getUserProjects() {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('projects')
    .select('*, galleries!galleries_project_id_fkey(id, title, slug, status)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getProjectById(id: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('projects')
    .select('*, galleries!galleries_project_id_fkey(id, title, slug, status, total_views, total_downloads, event_date, season), delivery_rules(*, galleries(title, slug))')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateProject(id: string, updateData: any) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('projects')
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteProject(id: string) {
  const client = getSupabaseClient();
  const { error } = await client.from('projects').update({ status: 'deleted' }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ==================== GALLERIES (from desktop) ====================

export async function createGallery(data: any) {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const slug = data.slug || (data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).substring(2, 10));
  const { data: result, error } = await client
    .from('galleries')
    .insert({ ...data, slug, user_id: userId, status: 'draft' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function getUserGalleries() {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('galleries')
    .select('id, title, slug, status, gallery_type, access_type, project_id, total_views, total_downloads, created_at')
    .eq('user_id', userId)
    .neq('status', 'suspended')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// ==================== DELIVERY RULES ====================

export async function createDeliveryRule(data: any) {
  const client = getSupabaseClient();
  const { data: result, error } = await client.from('delivery_rules').insert(data).select().single();
  if (error) throw new Error(error.message);
  return result;
}

export async function getDeliveryRulesForProject(projectId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('delivery_rules')
    .select('*, galleries(title, slug)')
    .eq('project_id', projectId)
    .order('priority', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateDeliveryRule(id: string, updateData: any) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('delivery_rules')
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteDeliveryRule(id: string) {
  const client = getSupabaseClient();
  const { error } = await client.from('delivery_rules').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ==================== SYNC DELIVERY RULES FROM PRESET ====================

/**
 * Sync delivery rules from preset participant "delivery_to_client_id" associations.
 *
 * For each participant that has a delivery_to_client_id set:
 * - Finds the client (project) and its default gallery
 * - Creates/updates an auto-generated delivery rule with source_type='preset_auto'
 * - Removes stale auto-generated rules for participants that no longer have a delivery_to_client_id
 *
 * This is called after saving a preset's participants.
 */
export async function syncDeliveryRulesFromPreset(presetId: string): Promise<{ created: number; updated: number; deleted: number }> {
  const client = getSupabaseClient();

  // 1. Get all participants for this preset with delivery_to_client_id set
  // v1.1.4 — Exclude soft-disabled participants: a disabled participant
  // should not have delivery rules generated, and existing auto-rules for
  // disabled participants become "stale" and get cleaned up by step 5.
  const { data: participants, error: pErr } = await client
    .from('preset_participants')
    .select('id, numero, nome, squadra, categoria, delivery_to_client_id, is_active')
    .eq('preset_id', presetId)
    .eq('is_active', true);

  if (pErr) throw new Error(`Failed to load preset participants: ${pErr.message}`);

  // 2. Get existing auto-generated rules for this preset
  const { data: existingRules, error: rErr } = await client
    .from('delivery_rules')
    .select('id, source_participant_id, project_id, gallery_id, match_criteria')
    .eq('source_preset_id', presetId)
    .eq('source_type', 'preset_auto');

  if (rErr) throw new Error(`Failed to load existing auto-rules: ${rErr.message}`);

  const existingByParticipant = new Map<string, any>();
  (existingRules || []).forEach((r: any) => {
    if (r.source_participant_id) existingByParticipant.set(r.source_participant_id, r);
  });

  // 3. Get all clients (projects) that have galleries, grouped by project
  const participantsWithDelivery = (participants || []).filter((p: any) => p.delivery_to_client_id);
  const clientIds = [...new Set(participantsWithDelivery.map((p: any) => p.delivery_to_client_id))];

  // Get default galleries for each client
  const clientGalleryMap = new Map<string, string>();
  if (clientIds.length > 0) {
    for (const clientId of clientIds) {
      // First try default_gallery_id, then fall back to first gallery
      const { data: project } = await client
        .from('projects')
        .select('id, default_gallery_id')
        .eq('id', clientId)
        .single();

      if (project?.default_gallery_id) {
        clientGalleryMap.set(clientId as string, project.default_gallery_id);
      } else {
        // Get first active gallery for this client
        const { data: galleries } = await client
          .from('galleries')
          .select('id')
          .eq('project_id', clientId)
          .neq('status', 'suspended')
          .order('created_at', { ascending: true })
          .limit(1);

        if (galleries && galleries.length > 0) {
          clientGalleryMap.set(clientId as string, galleries[0].id);
        }
      }
    }
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;

  // 4. Create/update rules for participants with delivery_to_client_id
  for (const p of participantsWithDelivery) {
    const galleryId = clientGalleryMap.get(p.delivery_to_client_id);
    if (!galleryId) continue; // No gallery available for this client yet

    // Build match criteria from participant data
    const matchCriteria: any = {};
    if (p.numero) matchCriteria.numbers = [p.numero];
    if (p.squadra) matchCriteria.teams = [p.squadra];
    if (p.nome) matchCriteria.participants = [p.nome];

    const existingRule = existingByParticipant.get(p.id);

    if (existingRule) {
      // Update existing rule
      const { error: uErr } = await client
        .from('delivery_rules')
        .update({
          gallery_id: galleryId,
          project_id: p.delivery_to_client_id,
          match_criteria: matchCriteria,
          rule_name: `Auto: #${p.numero || ''} ${p.nome || p.squadra || ''}`.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRule.id);
      if (!uErr) updated++;
      existingByParticipant.delete(p.id); // Mark as processed
    } else {
      // Create new rule
      const { error: cErr } = await client
        .from('delivery_rules')
        .insert({
          project_id: p.delivery_to_client_id,
          gallery_id: galleryId,
          rule_name: `Auto: #${p.numero || ''} ${p.nome || p.squadra || ''}`.trim(),
          match_criteria: matchCriteria,
          priority: 0,
          is_active: true,
          source_type: 'preset_auto',
          source_participant_id: p.id,
          source_preset_id: presetId,
        });
      if (!cErr) created++;
    }
  }

  // 5. Delete stale auto-generated rules (participant no longer has delivery_to)
  const staleRuleIds = [...existingByParticipant.values()].map((r: any) => r.id);
  if (staleRuleIds.length > 0) {
    const { error: dErr } = await client
      .from('delivery_rules')
      .delete()
      .in('id', staleRuleIds);
    if (!dErr) deleted = staleRuleIds.length;
  }

  console.log(`[Delivery] Synced rules from preset ${presetId}: created=${created}, updated=${updated}, deleted=${deleted}`);
  return { created, updated, deleted };
}

// ==================== GALLERY IMAGES ====================

export async function addImagesToGallery(galleryId: string, images: any[]) {
  const client = getSupabaseClient();
  const rows = images.map((img: any) => ({ gallery_id: galleryId, ...img }));
  const { error } = await client.from('gallery_images').upsert(rows, { onConflict: 'gallery_id,image_id' });
  if (error) throw new Error(error.message);
}

// ==================== AUTO-ROUTING ====================

export async function autoRouteImagesToGalleries(projectId: string, executionId: string) {
  const client = getSupabaseClient();

  // Get delivery rules for project
  const { data: rules } = await client
    .from('delivery_rules')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (!rules || rules.length === 0) return { routed: 0, unmatched: 0 };

  // Get images + analysis for this execution
  const { data: images } = await client
    .from('images')
    .select('id, analysis_results(recognized_number), visual_tags(participant_name, participant_team)')
    .eq('execution_id', executionId);

  if (!images) return { routed: 0, unmatched: 0 };

  let routed = 0;
  let unmatched = 0;
  const inserts: any[] = [];

  for (const img of images) {
    const ar = Array.isArray((img as any).analysis_results) ? (img as any).analysis_results[0] : (img as any).analysis_results;
    const vt = Array.isArray((img as any).visual_tags) ? (img as any).visual_tags[0] : (img as any).visual_tags;
    const number = ar?.recognized_number || '';
    const team = vt?.participant_team || '';
    const name = vt?.participant_name || '';
    let matched = false;

    for (const rule of rules) {
      const mc = rule.match_criteria || {};
      const matchesNumber = (mc as any).numbers?.includes(number);
      const matchesTeam = (mc as any).teams?.some((t: string) => team.toLowerCase().includes(t.toLowerCase()));
      const matchesParticipant = (mc as any).participants?.some((p: string) => name.toLowerCase().includes(p.toLowerCase()));

      if (matchesNumber || matchesTeam || matchesParticipant) {
        inserts.push({
          gallery_id: rule.gallery_id,
          image_id: img.id,
          execution_id: executionId,
          delivery_rule_id: rule.id,
          match_type: 'auto',
          recognized_numbers: number ? [number] : [],
          participant_name: name,
          participant_team: team,
        });
        matched = true;
        routed++;
      }
    }
    if (!matched) unmatched++;
  }

  if (inserts.length > 0) {
    for (let i = 0; i < inserts.length; i += 100) {
      await client.from('gallery_images').upsert(inserts.slice(i, i + 100), { onConflict: 'gallery_id,image_id' });
    }
  }

  // Count distinct galleries that received photos
  const galleriesHit = new Set(inserts.map(i => i.gallery_id));

  return { routed, unmatched, galleriesCount: galleriesHit.size };
}

// ==================== USER PLAN LIMITS ====================

export async function getUserPlanLimits() {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');

  // Check feature_flags first (per-user overrides)
  const { data: flags } = await client
    .from('feature_flags')
    .select('feature_name, is_enabled')
    .eq('user_id', userId);

  const flagMap: Record<string, boolean> = {};
  (flags || []).forEach((f: any) => { flagMap[f.feature_name] = f.is_enabled; });

  // Check subscription plan limits
  const { data: sub } = await client
    .from('subscriptions')
    .select('subscription_plans(limits)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  const planLimits = (sub as any)?.subscription_plans?.limits || {};

  return {
    gallery_enabled: flagMap['gallery_enabled'] ?? planLimits.gallery_enabled ?? false,
    delivery_enabled: flagMap['delivery_enabled'] ?? planLimits.delivery_enabled ?? false,
    projects_enabled: flagMap['projects_enabled'] ?? planLimits.projects_enabled ?? false,
    r2_storage_enabled: flagMap['r2_storage_enabled'] ?? planLimits.r2_storage_enabled ?? false,
    face_recognition_enabled: flagMap['face_recognition_enabled'] ?? planLimits.face_recognition_enabled ?? false,
    r2_storage_max_gb: planLimits.r2_storage_max_gb ?? 0,
    gallery_max_galleries: planLimits.gallery_max_galleries ?? 3,
  };
}

// ==================== GALLERY UPDATES ====================

export async function updateGallery(id: string, updateData: any) {
  const client = getSupabaseClient();
  console.log('[DB] updateGallery called:', id, JSON.stringify(updateData));
  const { data, error } = await client
    .from('galleries')
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('[DB] updateGallery error:', error.message, error.details, error.hint);
    throw new Error(error.message);
  }
  console.log('[DB] updateGallery result:', data?.id, 'status:', data?.status);
  return data;
}

export async function deleteGallery(id: string) {
  const client = getSupabaseClient();
  const { error } = await client.from('galleries').update({ status: 'suspended' }).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Get all galleries not yet assigned to any client (project_id is null).
 */
export async function getUnlinkedGalleries() {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('galleries')
    .select('id, title, slug, status, gallery_type, access_type, created_at')
    .eq('user_id', userId)
    .is('project_id', null)
    .neq('status', 'suspended')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Link an existing gallery to a client (project) by setting its project_id.
 */
export async function linkGalleryToProject(galleryId: string, projectId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('galleries')
    .update({ project_id: projectId, updated_at: new Date().toISOString() })
    .eq('id', galleryId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ==================== SEND EXECUTION TO GALLERY ====================

export async function sendExecutionToGallery(galleryId: string, executionId: string) {
  const client = getSupabaseClient();

  // Step 1: Get image IDs for this execution (fast, indexed query)
  const { data: images, error: imgError } = await client
    .from('images')
    .select('id')
    .eq('execution_id', executionId);

  if (imgError) throw new Error(imgError.message);
  if (!images || images.length === 0) return { added: 0 };

  const imageIds = images.map((img: any) => img.id);

  // Step 2: Get analysis_results and visual_tags separately (uses indexes)
  const [arResult, vtResult] = await Promise.all([
    client.from('analysis_results').select('image_id, recognized_number').in('image_id', imageIds),
    client.from('visual_tags').select('image_id, participant_name, participant_team').in('image_id', imageIds),
  ]);

  // Build lookup maps
  const arMap: Record<string, string> = {};
  if (arResult.data) {
    arResult.data.forEach((ar: any) => { if (ar.recognized_number) arMap[ar.image_id] = ar.recognized_number; });
  }
  const vtMap: Record<string, { name: string; team: string }> = {};
  if (vtResult.data) {
    vtResult.data.forEach((vt: any) => { vtMap[vt.image_id] = { name: vt.participant_name || '', team: vt.participant_team || '' }; });
  }

  const rows = imageIds.map((imgId: string) => {
    const number = arMap[imgId] || '';
    const vt = vtMap[imgId];
    return {
      gallery_id: galleryId,
      image_id: imgId,
      execution_id: executionId,
      match_type: 'manual',
      recognized_numbers: number ? [number] : [],
      participant_name: vt?.name || '',
      participant_team: vt?.team || '',
    };
  });

  // Upsert in chunks of 100
  let added = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await client.from('gallery_images').upsert(chunk, { onConflict: 'gallery_id,image_id' });
    if (!error) added += chunk.length;
  }

  return { added };
}

// ==================== GET USER EXECUTIONS (for gallery send dropdown) ====================

export async function getUserRecentExecutions() {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('executions')
    .select('id, name, execution_at, status, processed_images, project_id, source_folder')
    .eq('user_id', userId)
    .in('status', ['completed', 'completed_with_errors'])
    .order('execution_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}

// ==================== GET EXECUTIONS LINKED TO A GALLERY ====================

export async function getGalleryExecutions(galleryId: string) {
  const client = getSupabaseClient();

  // Get distinct execution_ids from gallery_images for this gallery
  const { data, error } = await client
    .from('gallery_images')
    .select('execution_id')
    .eq('gallery_id', galleryId)
    .not('execution_id', 'is', null);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  // Get unique execution IDs
  const executionIds = [...new Set(data.map((row: any) => row.execution_id))];

  // Fetch execution details
  const { data: executions, error: execError } = await client
    .from('executions')
    .select('id, name, execution_at, processed_images, project_id')
    .in('id', executionIds)
    .order('execution_at', { ascending: false });

  if (execError) throw new Error(execError.message);

  // Count images per execution in this gallery
  const countMap: Record<string, number> = {};
  data.forEach((row: any) => {
    countMap[row.execution_id] = (countMap[row.execution_id] || 0) + 1;
  });

  return (executions || []).map((exec: any) => ({
    ...exec,
    gallery_image_count: countMap[exec.id] || 0,
  }));
}

// ==================== R2 UPLOAD: Get images needing upload for an execution ====================

export async function getImagesForR2Upload(executionId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('images')
    .select('id, original_filename, storage_path, original_file_size')
    .eq('execution_id', executionId)
    .or('original_upload_status.is.null,original_upload_status.eq.pending,original_upload_status.eq.failed');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function markImagesUploadQueued(imageIds: string[]) {
  const client = getSupabaseClient();
  for (let i = 0; i < imageIds.length; i += 100) {
    const chunk = imageIds.slice(i, i + 100);
    await client.from('images').update({ original_upload_status: 'queued' }).in('id', chunk);
  }
}

// ==================== R2 UPLOAD: Detailed status for an execution ====================

export async function getR2UploadStatus(executionId: string) {
  const client = getSupabaseClient();

  // Get counts per status
  const { data: images, error } = await client
    .from('images')
    .select('id, original_filename, original_upload_status, original_storage_provider, original_storage_path, original_file_size')
    .eq('execution_id', executionId);

  if (error) throw new Error(error.message);
  if (!images) return { total: 0, completed: 0, failed: 0, queued: 0, pending: 0, images: [] };

  const stats = {
    total: images.length,
    completed: 0,
    failed: 0,
    queued: 0,
    pending: 0,
    images: images.map((img: any) => ({
      id: img.id,
      filename: img.original_filename,
      status: img.original_upload_status || 'pending',
      provider: img.original_storage_provider,
      r2_path: img.original_storage_path,
      file_size: img.original_file_size,
    })),
  };

  for (const img of images) {
    const status = img.original_upload_status || 'pending';
    if (status === 'completed') stats.completed++;
    else if (status === 'failed') stats.failed++;
    else if (status === 'queued') stats.queued++;
    else stats.pending++;
  }

  return stats;
}

// Reset stuck queued/failed images back to pending so they can be retried
export async function resetR2UploadStatus(executionId: string, resetStatuses: string[] = ['queued', 'failed']) {
  const client = getSupabaseClient();
  const conditions = resetStatuses.map(s => `original_upload_status.eq.${s}`).join(',');
  const { data, error } = await client
    .from('images')
    .update({ original_upload_status: 'pending', original_storage_provider: null, original_storage_path: null })
    .eq('execution_id', executionId)
    .or(conditions)
    .select('id');
  if (error) throw new Error(error.message);
  return { reset: data?.length || 0 };
}

// Update source_folder for an execution (manual repair)
export async function updateExecutionSourceFolder(executionId: string, sourceFolder: string) {
  const client = getSupabaseClient();
  const { error } = await client
    .from('executions')
    .update({ source_folder: sourceFolder })
    .eq('id', executionId);
  if (error) throw new Error(error.message);
}

// ==================== FEATURE INTEREST SURVEYS ====================

export async function submitFeatureInterestSurvey(data: { responses: any; comment: string | null; feature_area?: string }) {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const featureArea = data.feature_area || 'delivery_gallery';
  const { error } = await client.from('feature_interest_surveys').upsert(
    {
      user_id: userId,
      feature_area: featureArea,
      responses: data.responses,
      comment: data.comment,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,feature_area' }
  );
  if (error) throw new Error(error.message);
}

export async function checkFeatureInterestSurvey(featureArea?: string): Promise<{ submitted: boolean }> {
  const client = getSupabaseClient();
  const userId = authService.getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  const { data } = await client
    .from('feature_interest_surveys')
    .select('id')
    .eq('user_id', userId)
    .eq('feature_area', featureArea || 'delivery_gallery')
    .maybeSingle();
  return { submitted: !!data };
}

// ==================== CLIENT USERS (AUTHENTICATION) ====================

/**
 * Create a client user for gallery/portal access.
 * Password is hashed client-side before sending to the database.
 */
export async function createClientUser(data: {
  project_id: string;
  username?: string;
  password_hash?: string;
  display_name?: string;
  email?: string;
  status?: string;
  invite_token?: string;
  invite_token_expires_at?: string;
  is_active?: boolean;
}) {
  const client = getSupabaseClient();
  // Auto-generate username from email if not provided
  if (!data.username && data.email) {
    data.username = data.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
  }
  const { data: result, error } = await client
    .from('client_users')
    .insert(data)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function getClientUsersForProject(projectId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('client_users')
    .select('id, project_id, username, display_name, email, is_active, status, last_login_at, invite_token_expires_at, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateClientUser(id: string, updateData: any) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('client_users')
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteClientUser(id: string) {
  const client = getSupabaseClient();
  const { error } = await client.from('client_users').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ==================== CLIENT SLUG / SHAREABLE LINKS ====================

/**
 * Generate a URL-friendly slug from a client name.
 * Ensures uniqueness by appending a random suffix if needed.
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')          // Trim leading/trailing hyphens
    .substring(0, 50);
}

/**
 * Set or regenerate the client_slug for a project.
 * Used for client portal shareable links: /c/{client_slug}
 */
export async function setClientSlug(projectId: string, clientName: string): Promise<string> {
  const client = getSupabaseClient();
  let slug = generateSlug(clientName);

  // Check uniqueness, append random suffix if needed
  const { data: existing } = await client
    .from('projects')
    .select('id')
    .eq('client_slug', slug)
    .neq('id', projectId)
    .maybeSingle();

  if (existing) {
    slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
  }

  const { data, error } = await client
    .from('projects')
    .update({ client_slug: slug, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .select('client_slug')
    .single();

  if (error) throw new Error(error.message);
  return data.client_slug;
}

// ==================== CLIENT INVITE EMAIL ====================

/**
 * Send invite email to a client user.
 * Fetches project info for the email template, then delegates to email-service.
 */
export async function sendClientInviteEmail(params: {
  clientUserId: string;
  email: string;
  displayName: string;
  inviteToken: string;
  projectId: string;
}) {
  // Import here to avoid circular deps
  const { sendClientInviteEmailViaBrevo } = await import('./email-service');

  // Get project info for the email (client name, photographer name)
  const project = await getProjectById(params.projectId);
  const projectName = project?.client_name || project?.name || 'Client Portal';

  return sendClientInviteEmailViaBrevo({
    recipientEmail: params.email,
    recipientName: params.displayName,
    inviteToken: params.inviteToken,
    clientName: projectName,
    portalSlug: project?.client_slug || '',
  });
}

/**
 * Resend invitation: generate new token + send email.
 */
export async function resendClientInvite(clientUserId: string) {
  const client = getSupabaseClient();

  // Get the client user
  const { data: user, error: fetchError } = await client
    .from('client_users')
    .select('id, project_id, email, display_name, status')
    .eq('id', clientUserId)
    .single();
  if (fetchError || !user) throw new Error('Client user not found');
  if (user.status !== 'invited') throw new Error('User is already registered');

  // Generate new token
  const crypto = require('crypto');
  const newToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Update token in DB
  const { error: updateError } = await client
    .from('client_users')
    .update({
      invite_token: newToken,
      invite_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientUserId);
  if (updateError) throw new Error(updateError.message);

  // Send email
  return sendClientInviteEmail({
    clientUserId,
    email: user.email!,
    displayName: user.display_name || 'User',
    inviteToken: newToken,
    projectId: user.project_id,
  });
}
