import { app, BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as os from 'os';

// --- CONSOLE LOGGING DISABLE FOR PRODUCTION ---
// NOTE: This check is commented out to prevent initialization errors
// It should be executed after app.ready() event in production builds
// if (app.isPackaged) {
//   const allConsoleMethods = ['log', 'warn', 'error', 'info', 'debug', 'trace'];
//
//   allConsoleMethods.forEach(method => {
//     // Override each method with an empty function
//     (console as any)[method] = () => {};
//   });
// }

// Safe console error handler to prevent EPIPE errors from crashing the app
const safeConsoleError = (...args: any[]) => {
  try {
    console.error(...args);
  } catch (error) {
    // If console.error fails (EPIPE), try process.stderr directly
    try {
      process.stderr.write(`[ERROR] ${args.join(' ')}\n`);
    } catch {
      // If all else fails, silently ignore to prevent crashes
      // In production, you might want to log to a file instead
    }
  }
};

// Handle process stdout/stderr EPIPE errors to prevent crashes
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') {
    // Ignore EPIPE errors on stdout
    return;
  }
  // Re-throw other errors
  throw error;
});

process.stderr.on('error', (error) => {
  if (error.code === 'EPIPE') {
    // Ignore EPIPE errors on stderr
    return;
  }
  // Re-throw other errors
  throw error;
});
import {
  initializeDatabaseSchema, // Alias per initializeLocalCacheSchema
  createProjectOnline,
  getProjectsOnline,
  getProjectByIdOnline,
  updateProjectOnline,
  deleteProjectOnline,
  createExecutionOnline,
  getExecutionsByProjectIdOnline,
  getExecutionByIdOnline,
  updateExecutionOnline,
  deleteExecutionOnline,
  getRecentProjectsFromCache,
  uploadCsvToStorage,
  Project,
  Execution,
  syncAllUserDataToSupabase,
  clearAllUserData,
  getUserDataStats,
  saveCsvToSupabase,
  loadLastUsedCsvFromSupabase,
  // Nuove funzioni per il tracciamento delle impostazioni
  ExecutionSettings,
  saveExecutionSettings,
  getExecutionSettings,
  getUserSettingsAnalytics,
  extractSettingsFromConfig,
  getSupabaseClient,
  // Funzioni per preset partecipanti
  ParticipantPreset,
  PresetParticipant,
  createParticipantPreset,
  getUserParticipantPresets,
  getParticipantPresetById,
  savePresetParticipants,
  updatePresetLastUsed,
  deleteParticipantPreset,
  importParticipantsFromCSV,
  // Nuove funzioni Supabase
  SportCategory,
  ParticipantPresetSupabase,
  PresetParticipantSupabase,
  FeatureFlag,
  cacheSupabaseData,
  getCachedSportCategories,
  getCachedParticipantPresets,
  refreshCategoriesCache,
  getSportCategories,
  getSportCategoryByCode,
  createParticipantPresetSupabase,
  getUserParticipantPresetsSupabase,
  getParticipantPresetByIdSupabase,
  savePresetParticipantsSupabase,
  updatePresetLastUsedSupabase,
  updateParticipantPresetSupabase,
  deleteParticipantPresetSupabase,
  importParticipantsFromCSVSupabase,
  isFeatureEnabled
} from './database-service';
// Determine if we're in development mode - will be set after app is ready
let isDev = true; // Default to true for safety during initialization
// Don't import @electron/remote at top level - it will be required when needed
let remoteEnable: any = null; // Will be set after app is ready
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, APP_CONFIG, ResizePreset, RESIZE_PRESETS, PIPELINE_CONFIG } from './config';
import { authService } from './auth-service';
import * as piexif from 'piexifjs';
import { createImageProcessor } from './utils/native-modules';
import { createXmpSidecar, xmpSidecarExists } from './utils/xmp-manager';
import { writeKeywordsToImage } from './utils/metadata-writer';
import { rawConverter } from './utils/raw-converter'; // Import the singleton instance
import { unifiedImageProcessor, UnifiedImageFile, UnifiedProcessingResult, UnifiedProcessorConfig } from './unified-image-processor';
import { FolderOrganizerConfig } from './utils/folder-organizer';

// Definisci le estensioni supportate a livello globale per riutilizzo
const RAW_EXTENSIONS = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
const STANDARD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALL_SUPPORTED_EXTENSIONS = [...STANDARD_EXTENSIONS, ...RAW_EXTENSIONS];

// Don't initialize @electron/remote here - will be done in app.whenReady()
// Don't call app.setName() here - will be done in app.whenReady()

process.env.NODE_ENV = isDev ? 'development' : 'production';

// Safe IPC message sending utility
function safeSend(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log(`[Main Process] Sending IPC event: ${channel} with data:`, args);
    mainWindow.webContents.send(channel, ...args);
  } else {
    console.warn(`[Main Process] Cannot send IPC event ${channel} - mainWindow unavailable`);
  }
}

// Safe IPC message sending utility with event sender fallback
function safeSendToSender(eventSender: any, channel: string, ...args: any[]) {
  try {
    if (eventSender && !eventSender.isDestroyed()) {
      eventSender.send(channel, ...args);
    }
  } catch (error) {
    // Fallback to main window if event sender fails
    safeSend(channel, ...args);
  }
}

// Version checking functionality
interface VersionCheckResult {
  requires_update: boolean
  force_update_enabled: boolean
  update_message?: string
  download_url?: string
  urgency?: string
  current_version?: string
  minimum_version?: string
  error?: string
}

let forceUpdateRequired = false;

// Check app version against server requirements
async function checkAppVersion(): Promise<VersionCheckResult | null> {
  try {
    const currentVersion = app.getVersion();
    const platform = process.platform === 'darwin' ? 'macos' : 
                    process.platform === 'win32' ? 'windows' : 'linux';
    
    console.log(`Checking version: ${currentVersion} on ${platform}`);
    
    // Get user ID from auth service if available
    const authState = authService.getAuthState();
    const userId = authState.user?.id;
    
    const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
    
    const { data, error } = await supabase.functions.invoke('check-app-version', {
      body: {
        app_version: currentVersion,
        platform: platform,
        user_id: userId
      }
    });
    
    if (error) {
      console.error('Version check error:', error);
      return { 
        requires_update: false, 
        force_update_enabled: false, 
        error: error.message 
      };
    }
    
    const result: VersionCheckResult = data;
    console.log('Version check result:', result);
    
    // Store force update status globally
    forceUpdateRequired = result.force_update_enabled && result.requires_update;
    
    return result;
  } catch (error) {
    console.error('Version check exception:', error);
    return { 
      requires_update: false, 
      force_update_enabled: false, 
      error: String(error) 
    };
  }
}

type VehicleAnalysis = {
  raceNumber: string | null;
  drivers: string[];
  category: string | null;
  teamName: string | null;
  otherText: string[];
  confidence: number;
};

type CsvEntry = {
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  metatag: string;
  [key: string]: string | undefined;
};

// Definizione delle strategie per la gestione dei metadati (solo XMP non-distruttivo)
enum MetadataStrategy {
  XmpFullAnalysis = 'xmp_full_analysis',      // Analisi Completa: tutti i dati AI (numero, piloti, categoria, team, etc.)
  XmpCustomText = 'xmp_custom_text',          // Testo Personalizzato: testo libero definito dall'utente
  XmpCsvData = 'xmp_csv_data',                // Dati da CSV: usa colonna "metatag" abbinata per numero gara
  XmpRaceNumberOnly = 'xmp_race_number_only'  // Solo Numero Gara: inserisce solo il numero rilevato dall'AI
}

type BatchProcessConfig = {
  folderPath: string;
  csvData?: CsvEntry[];
  updateExif: boolean;
  projectId?: string;
  executionName?: string;
  model?: string;                      // Modello AI da utilizzare per l'analisi
  category?: string;                   // Categoria di sport per prompt dedicato
  
  // Nuove opzioni avanzate per la gestione dei metadati
  metadataStrategy?: MetadataStrategy; // Strategia da usare se non c'è match CSV
  manualMetadataValue?: string;        // Valore del metatag manuale (se strategia = manual)
  keywordsMode?: 'append' | 'overwrite'; // Modalità scrittura keywords (default: append)
  descriptionMode?: 'append' | 'overwrite'; // Modalità scrittura description (default: append)
  savePreviewImages?: boolean;         // Salvare le preview JPEG dei RAW?
  previewFolder?: string;              // Cartella per le preview (default: tmp)
  
  // Configurazioni resize immagini
  resize?: {
    enabled: boolean;
    preset: string; // 'veloce' | 'bilanciato' | 'qualita'
  };
  
  // Nuove opzioni per elaborazione parallela
  useParallelProcessing?: boolean;     // Usa il sistema di elaborazione parallela
  useStreamingPipeline?: boolean;      // Usa la streaming pipeline invece del batch tradizionale
  parallelization?: {                  // Configurazioni avanzate per parallelizzazione
    maxConcurrentUploads?: number;
    maxConcurrentAnalysis?: number;
    rateLimitPerSecond?: number;
    batchSize?: number;
  };
  
  // Additional properties for enhanced workflow support
  filePaths?: string[];               // Explicit file paths array
  selectedFiles?: any[];              // Selected files with metadata
  tempFiles?: File[];                 // Temporary File objects (drag & drop)
  
  // Folder organization configuration
  folderOrganization?: {
    enabled: boolean;
    mode: 'copy' | 'move';
    pattern?: 'number' | 'number_name' | 'custom';
    customPattern?: string;
    createUnknownFolder: boolean;
    unknownFolderName: string;
    includeXmpFiles?: boolean;
    destinationPath?: string;
    conflictStrategy?: 'rename' | 'skip' | 'overwrite';
  };

  // Participant preset configuration
  participantPreset?: {
    id: string;
    name: string;
    description?: string;
    participants: Array<{
      numero?: string;
      nome?: string;
      navigatore?: string;
      squadra?: string;
      sponsor?: string;
      metatag?: string;
    }>;
  };
};

/**
 * Formatta i dati dei metadati in base alla categoria di sport (aggiornato per supportare array)
 * @param analysisData Dati dell'analisi AI (singolo oggetto o array)
 * @param category Categoria di sport (motorsport, running, altro)
 * @param csvMetatag Metatag dal CSV se disponibile (ha priorità)
 * @returns Array di keywords formattate
 */
function formatMetadataByCategory(
  analysisData?: VehicleAnalysis | VehicleAnalysis[], 
  category: string = 'motorsport',
  csvMetatag?: string
): string[] {
  // Priorità 1: Se c'è un metatag dal CSV, usa quello
  if (csvMetatag) {
    return [csvMetatag];
  }
  
  // Priorità 2: Se non ci sono dati AI, usa un messaggio generico
  if (!analysisData) {
    return [`Processed by Racetagger - Category: ${category}`];
  }
  
  // Converti in array se è un singolo oggetto
  const analysisArray = Array.isArray(analysisData) ? analysisData : [analysisData];
  const allKeywords: string[] = [];
  
  // Processa ogni risultato di analisi
  for (let i = 0; i < analysisArray.length; i++) {
    const analysis = analysisArray[i];
    const vehicleKeywords: string[] = [];
    
    // Numero (universale per tutti gli sport)
    if (analysis.raceNumber) {
      const keyword = `Number: ${analysis.raceNumber}`;
      vehicleKeywords.push(keyword);
    }
    
    // Gestione piloti/atleti in base alla categoria
    if (analysis.drivers && analysis.drivers.length > 0) {
      const driversText = analysis.drivers.join(', ');
      
      let driverLabel: string;
      switch (category.toLowerCase()) {
        case 'motorsport':
          driverLabel = analysis.drivers.length === 1 ? 'Driver' : 'Drivers';
          break;
        case 'running':
          driverLabel = analysis.drivers.length === 1 ? 'Athlete' : 'Athletes';
          break;
        default:
          driverLabel = analysis.drivers.length === 1 ? 'Participant' : 'Participants';
          break;
      }
      
      const keyword = `${driverLabel}: ${driversText}`;
      vehicleKeywords.push(keyword);
    }
    
    // Categoria/Disciplina
    if (analysis.category) {
      const keyword = `Category: ${analysis.category}`;
      vehicleKeywords.push(keyword);
    }
    
    // Team/Squadra (più rilevante per motorsport)
    if (analysis.teamName && category.toLowerCase() === 'motorsport') {
      const keyword = `Team: ${analysis.teamName}`;
      vehicleKeywords.push(keyword);
    }
    
    // Altri testi rilevati (se presenti e non ridondanti) - uniti con "|"
    if (analysis.otherText && analysis.otherText.length > 0) {
      const relevantTexts = analysis.otherText
        .filter(text => text.length > 0 && text.length < 50) // Filtra testi troppo lunghi
        .slice(0, 3); // Massimo 3 testi aggiuntivi
      
      if (relevantTexts.length > 0) {
        const otherTextString = relevantTexts.join(' | ');
        vehicleKeywords.push(otherTextString);
      }
    }
    
    // Aggiungi le keywords del veicolo corrente
    allKeywords.push(...vehicleKeywords);
    
    // Aggiungi divider se ci sono più veicoli e non è l'ultimo
    if (analysisArray.length > 1 && i < analysisArray.length - 1) {
      allKeywords.push('•••');
    }
  }
  
  // Se non abbiamo dati utili, usa un fallback
  if (allKeywords.length === 0) {
    return [`Analyzed by Racetagger - Category: ${category}`];
  }
  
  return allKeywords;
}

let globalCsvData: CsvEntry[] = [];
let batchConfig: BatchProcessConfig | null = null;
let mainWindow: BrowserWindow | null = null;
let versionCheckResult: VersionCheckResult | null = null;

const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

// Cache per URL Supabase delle immagini processate (filePath -> URL)
const supabaseImageUrlCache = new Map<string, string>();

function setupAuthHandlers() {
console.log('[Main Process] main.ts: setupAuthHandlers() called.');
  const syncUserProjects = async () => {
    const authState = authService.getAuthState();
    if (authState.isAuthenticated && authState.user?.id) {
      try {
        console.log('User authenticated, fetching/caching projects from Supabase...');
        await getProjectsOnline(); // Popola/aggiorna la cache locale
        console.log('Projects fetched and cached.');

        // Also reload categories and analytics data
        console.log('Reloading categories and analytics data after authentication...');
        await cacheSupabaseData();
        console.log('Categories and analytics data reloaded.');
      } catch (error) {
        console.error('Error fetching projects on auth state change:', error);
      }
    }
  };

  // Handler for getting production state (app.isPackaged)
  ipcMain.handle('get-is-packaged', () => {
    return app.isPackaged;
  });

  // Handler to check if current user is admin
  ipcMain.handle('auth-is-admin', () => {
    const isAdmin = authService.isAdmin();
    console.log('[IPC] auth-is-admin check:', isAdmin);
    return isAdmin;
  });

  ipcMain.on('check-auth-status', async (event: IpcMainEvent) => {
    const authState = authService.getAuthState();
    console.log(`[Main Process] Sending auth-status to renderer:`, {
      isAuthenticated: authState.isAuthenticated,
      userEmail: authState.user?.email,
      userRole: authState.userRole
    });
    event.sender.send('auth-status', authState);
    await syncUserProjects();
  });

  ipcMain.on('login', async (event: IpcMainEvent, credentials: { email: string; password: string }) => {
    try {
      const result = await authService.login(credentials.email, credentials.password);

      // CRITICAL FIX: Wait for data sync BEFORE sending login-result
      // This prevents home page from loading before statistics/categories are ready
      if (result.success) {
        console.log('[Login] Syncing user projects before completing login...');
        await syncUserProjects();
        console.log('[Login] User projects synced successfully');
      }

      // Now send login-result AFTER sync is complete
      event.sender.send('login-result', result);
    } catch (error: any) {
      event.sender.send('login-result', { success: false, error: error.message || 'Login error' });
    }
  });

  ipcMain.on('register', async (event: IpcMainEvent, data: { email: string; password: string }) => {
    try {
      const result = await authService.register(data.email, data.password);
      event.sender.send('register-result', result);
    } catch (error: any) {
      event.sender.send('register-result', { success: false, error: error.message || 'Registration error' });
    }
  });

  ipcMain.on('logout', async (event: IpcMainEvent) => {
    let userId: string | null = null;
    
    try {
      // 1. Ottieni l'user ID prima del logout
      userId = authService.getCurrentUserId();
      if (!userId) {
        console.log('[Main Process] No user ID found, proceeding with basic logout');
        const result = await authService.logout();
        event.sender.send('logout-result', result);
        return;
      }
      
      console.log(`[Main Process] Starting logout process for user: ${userId}`);
      
      // 2. Ottieni statistiche sui dati da sincronizzare
      const stats = await getUserDataStats(userId);
      console.log(`[Main Process] User data to sync: ${stats.projectsCount} projects, ${stats.executionsCount} executions`);
      
      // 3. Salva il CSV corrente su Supabase se presente
      if (csvData && csvData.length > 0) {
        try {
          console.log(`[Main Process] Saving current CSV data (${csvData.length} entries) to Supabase...`);
          await saveCsvToSupabase(csvData, `logout_backup_${Date.now()}.csv`);
          console.log('[Main Process] CSV data saved successfully');
        } catch (csvError) {
          console.error('[Main Process] Error saving CSV to Supabase:', csvError);
          // Non bloccare il logout se il salvataggio CSV fallisce
        }
      }
      
      // 4. Sincronizza tutti i dati utente su Supabase
      if (authService.isAuthenticated() && authService.isOnline()) {
        try {
          console.log('[Main Process] Syncing user data to Supabase...');
          await syncAllUserDataToSupabase(userId);
          console.log('[Main Process] User data synced successfully');
        } catch (syncError) {
          console.error('[Main Process] Error syncing data to Supabase:', syncError);
          
          // Chiedi conferma all'utente se procedere senza sincronizzazione
          const response = await new Promise<boolean>((resolve) => {
            const confirmDialog = require('electron').dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Errore Sincronizzazione',
              message: 'Impossibile sincronizzare i dati su Supabase',
              detail: 'I dati locali potrebbero andare persi. Vuoi procedere comunque con il logout?',
              buttons: ['Annulla Logout', 'Procedi Comunque'],
              defaultId: 0,
              cancelId: 0
            });
            
            confirmDialog.then((result: any) => resolve(result.response === 1));
          });
          
          if (!response) {
            console.log('[Main Process] User cancelled logout due to sync error');
            event.sender.send('logout-result', { success: false, error: 'Logout cancelled by user' });
            return;
          }
        }
      } else {
        console.log('[Main Process] User is offline or not authenticated, skipping sync');
      }
      
      // 5. Esegui logout da Supabase Auth
      const result = await authService.logout();
      
      // 6. Pulisci TUTTI i dati locali per questo utente
      if (userId) {
        console.log('[Main Process] Clearing local user data...');
        await clearAllUserData(userId);
        console.log('[Main Process] Local user data cleared');
      }
      
      // 7. Pulisci variabili globali in memoria
      csvData = [];
      globalCsvData = [];
      console.log('[Main Process] Global variables cleared');
      
      // 8. Pulisci eventuali file temporanei
      try {
        // Pulisci thumbnails cache se esiste
        const thumbnailDir = path.join(os.tmpdir(), 'racetagger-thumbnails');
        try {
          await fsPromises.access(thumbnailDir, fs.constants.F_OK);
          // Directory exists, cleanup files
          const files = await fsPromises.readdir(thumbnailDir);
          await Promise.all(
            files.map(async (file) => {
              try {
                await fsPromises.unlink(path.join(thumbnailDir, file));
              } catch (fileError) {
                console.error(`[Main Process] Error deleting temp file ${file}:`, fileError);
              }
            })
          );
          console.log('[Main Process] Temporary files cleaned');
        } catch {
          // Directory doesn't exist, nothing to clean
        }
      } catch (tempError) {
        console.error('[Main Process] Error cleaning temporary files:', tempError);
      }
      
      console.log('[Main Process] Logout completed successfully');
      event.sender.send('logout-result', result);
      
    } catch (error: any) {
      console.error('[Main Process] Error during logout:', error);
      event.sender.send('logout-result', { success: false, error: error.message || 'Logout error' });
    }
  });

  ipcMain.on('continue-demo', (event: IpcMainEvent) => {
    authService.enableDemoMode();
    event.sender.send('auth-status', { isAuthenticated: false, user: null, session: null });
  });

  // Handler for restoring CSV data after login
  ipcMain.on('restore-csv-data', (event: IpcMainEvent, data: any) => {
    try {
      console.log(`[Main Process] Restoring CSV data: ${data.csvData.length} entries`);
      
      // Update global CSV variables
      csvData = data.csvData;
      globalCsvData = data.csvData;
      
      // Notify the renderer that CSV has been restored
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('csv-loaded', {
          filename: data.filename || 'restored_from_supabase.csv',
          entries: data.csvData.length,
          message: `CSV ripristinato dal backup (${data.csvData.length} entries)`
        });
      }
      
      console.log('[Main Process] CSV data restored successfully');
    } catch (error) {
      console.error('[Main Process] Error restoring CSV data:', error);
    }
  });

  ipcMain.on('get-token-balance', async (event: IpcMainEvent) => {
    try {
      const balance = await authService.getTokenBalance();
      event.sender.send('token-balance', balance);
    } catch (error: any) {
      event.sender.send('auth-error', { message: 'Failed to fetch token balance' });
    }
  });

  // Force refresh token balance (for manual sync)
  ipcMain.on('force-token-refresh', async (event: IpcMainEvent) => {
    try {
      console.log('[Main] Force token refresh requested');

      // Get both balance and pending tokens
      const tokenInfo = await authService.forceTokenInfoRefresh();

      // Send balance as usual for backward compatibility
      event.sender.send('token-balance', tokenInfo.balance);

      // Also send pending tokens info
      event.sender.send('pending-tokens', tokenInfo.pending);

      // Also refresh sport categories while we're at it
      console.log('[Main] Refreshing sport categories...');
      await getSportCategories();
      console.log('[Main] Sport categories refreshed successfully');

      console.log('[Main] Force token refresh completed, sent balance and pending to frontend');
    } catch (error: any) {
      console.error('[Main] Force token refresh failed:', error);
      event.sender.send('auth-error', { message: 'Failed to force refresh token balance' });
    }
  });

  ipcMain.on('get-subscription-info', async (event: IpcMainEvent) => {
    try {
      const subscriptionInfo = await authService.getSubscriptionInfo();
      event.sender.send('subscription-info', subscriptionInfo);
    } catch (error: any) {
      event.sender.send('auth-error', { message: 'Failed to fetch subscription info' });
    }
  });

  ipcMain.on('open-subscription-page', () => authService.openSubscriptionPage());

  // Handle opening external URLs (for pricing page, etc.)
  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      console.error('[Main Process] Error opening external URL:', error);
      return { success: false, error: error.message };
    }
  });

  // Listen for auth refresh completion to reload data
  ipcMain.on('auth-refresh-completed-from-renderer', async () => {
    console.log('[Main Process] Auth refresh completed - reloading data...');
    await syncUserProjects();
  });
}

// Helper function to read executions from JSONL logs
async function getExecutionsFromLogs(): Promise<any[]> {
  try {
    const userDataPath = app.getPath('userData');
    const analysisLogsPath = path.join(userDataPath, '.analysis-logs');

    // Check if analysis logs directory exists
    if (!fs.existsSync(analysisLogsPath)) {
      console.log('[Executions] Analysis logs directory not found');
      return [];
    }

    const files = fs.readdirSync(analysisLogsPath);
    const executionFiles = files.filter(file => file.startsWith('exec_') && file.endsWith('.jsonl'));

    const executions: any[] = [];

    for (const file of executionFiles) {
      let content = '';
      try {
        const filePath = path.join(analysisLogsPath, file);
        content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line.trim());

        if (lines.length === 0) {
          console.log(`[Executions] SKIPPING ${file}: Empty file`);
          continue;
        }

        // Parse first line (EXECUTION_START)
        let startLine;
        try {
          startLine = JSON.parse(lines[0]);
          console.log(`[Executions] File ${file} first line type: ${startLine.type || 'undefined'}`);
        } catch (parseError) {
          console.warn(`[Executions] SKIPPING ${file}: Failed to parse first line:`, lines[0].substring(0, 100));
          continue;
        }

        if (startLine.type !== 'EXECUTION_START') {
          console.warn(`[Executions] CRITICAL: File ${file} SKIPPED because first line is not EXECUTION_START (type: ${startLine.type})`);
          console.warn(`[Executions] First line content:`, lines[0].substring(0, 200));
          continue;
        }
        // Parse last line to get completion status
        let status = 'processing';
        let totalProcessed = 0;

        if (lines.length > 1) {
          const lastLine = JSON.parse(lines[lines.length - 1]);
          if (lastLine.type === 'EXECUTION_COMPLETE') {
            status = 'completed';
            totalProcessed = lastLine.successful || 0;
          }
        }

        // Format date for Italian display
        const date = new Date(startLine.timestamp);
        const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
                       'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        const formattedDate = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} - ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

        const execution = {
          id: startLine.executionId,
          created_at: startLine.timestamp,
          updated_at: startLine.timestamp,
          folder_name: formattedDate,
          status: status,
          total_images_found: startLine.totalImages || 0,
          total_images_processed: totalProcessed,
          category: startLine.category || 'motorsport'
        };

        executions.push(execution);
        console.log(`[Executions] ✓ Successfully added execution: ${startLine.executionId} (${formattedDate}) [${status}]`);

      } catch (error) {
        console.warn(`[Executions] Failed to parse ${file}:`, error);
        console.warn(`[Executions] File size: ${content.length} characters`);
        console.warn(`[Executions] First 200 chars:`, content.substring(0, 200));
        continue;
      }
    }

    // Sort by timestamp descending (most recent first)
    executions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.log(`[Executions] Successfully found ${executions.length} valid executions from ${executionFiles.length} log files`);
    if (executions.length > 0) {
      console.log(`[Executions] Most recent execution: ${executions[0].id} (${executions[0].folder_name})`);
    }
    return executions.slice(0, 6); // Return only 6 most recent

  } catch (error) {
    console.error('[Executions] Error reading execution logs:', error);
    return [];
  }
}

function setupWindowControlHandlers() {
  console.log('[Main Process] main.ts: setupWindowControlHandlers() called.');
  ipcMain.on('window-close', () => { if (mainWindow) mainWindow.close(); });
  ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.restore();
      else mainWindow.maximize();
    }
  });
}

function createWindow() {
  console.log('[Main Process] Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    icon: path.join(__dirname, '../racetagger-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, webSecurity: !isDev
    }
  });

  // Set main window reference for auth service
  authService.setMainWindow(mainWindow);

  // Enable @electron/remote for this window
  if (remoteEnable) {
    remoteEnable(mainWindow.webContents);
  } else {
    console.error('[Main Process] @electron/remote enable function not available');
  }
  
  // Add error handling for window loading
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[Main Process] Window failed to load:', errorDescription, 'URL:', validatedURL);
  });
  
  mainWindow.on('crashed' as any, (event: any, killed: boolean) => {
    console.error('[Main Process] Window crashed. Killed:', killed);
  });
  
  // Check if force update is required and load appropriate HTML
  if (forceUpdateRequired) {
    const forceUpdatePath = path.join(__dirname, '../../renderer/force-update.html');
    console.log('[Main Process] Force update required, loading HTML from:', forceUpdatePath);
    mainWindow.loadFile(forceUpdatePath);
  } else {
    const htmlPath = path.join(__dirname, '../../renderer/index.html');
    console.log('[Main Process] Loading normal application HTML from:', htmlPath);
    mainWindow.loadFile(htmlPath);
  }
  
  // Gestione della navigazione tra pagine
  mainWindow.webContents.on('will-navigate', (event, url) => {
    console.log(`[Main Process] Navigation requested to: ${url}`);
    // Lasciamo che la navigazione proceda normalmente
  });
  
  // Gestisci i link aperti tramite target="_blank" o window.open
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[Main Process] Opening external URL: ${url}`);
    if (url.startsWith('file://') || url.includes('localhost')) {
      // Per link interni (file:// o localhost), apri nella stessa finestra
      return { action: 'allow' };
    } else {
      // Per link esterni, apri nel browser predefinito
      shell.openExternal(url);
      return { action: 'deny' };
    }
  });
}

function setupDatabaseIpcHandlers() {
  console.log('[Main Process] main.ts: setupDatabaseIpcHandlers() called.');
  ipcMain.handle('db-create-project', async (_, projectData: Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      const newProject = await createProjectOnline(projectData);
      return { success: true, data: newProject };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-upload-project-csv', async (_, { projectId, csvFileBuffer, csvFileName }: { projectId: string, csvFileBuffer: Uint8Array, csvFileName: string }) => {
    try {
      const buffer = Buffer.from(csvFileBuffer); // Assicura sia un Buffer
      const storagePath = await uploadCsvToStorage(projectId, buffer, csvFileName);
      const updatedProject = await updateProjectOnline(projectId, { base_csv_storage_path: storagePath });
      return { success: true, data: updatedProject };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-project-by-id', async (_, id: string) => {
    try {
      const project = await getProjectByIdOnline(id);
      return { success: true, data: project };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-all-projects', async () => {
    console.log(`[IPC Handler] 'db-get-all-projects' invoked.`);
    try {
      const projects = await getProjectsOnline();
      console.log(`[IPC Handler 'db-get-all-projects'] getProjectsOnline returned:`, projects ? projects.length + " projects" : "null/undefined/empty");
      return { success: true, data: projects };
    } catch (e: any) {
      console.error(`[IPC Handler 'db-get-all-projects'] Error caught:`, JSON.stringify(e, Object.getOwnPropertyNames(e)));
      return { success: false, error: e.message || 'Unknown error fetching projects.' };
    }
  });

  ipcMain.handle('db-update-project', async (_, { id, projectData }: { id: string, projectData: Partial<Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>> }) => {
    try {
      const updatedProject = await updateProjectOnline(id, projectData);
      return { success: true, data: updatedProject };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-delete-project', async (_, id: string) => {
    try {
      await deleteProjectOnline(id);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-create-execution', async (_, executionData: Omit<Execution, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      const newExecution = await createExecutionOnline(executionData);
      return { success: true, data: newExecution };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Handlers per Execution Settings Tracking
  ipcMain.handle('db-save-execution-settings', async (_, settings: Omit<ExecutionSettings, 'id' | 'user_id' | 'created_at'>) => {
    try {
      const savedSettings = await saveExecutionSettings(settings);
      return { success: true, data: savedSettings };
    } catch (e: any) { 
      console.warn('[DB] Failed to save execution settings:', e.message);
      return { success: false, error: e.message }; 
    }
  });

  ipcMain.handle('db-get-execution-settings', async (_, executionId: string) => {
    try {
      const settings = await getExecutionSettings(executionId);
      return { success: true, data: settings };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-user-settings-analytics', async (_, userId?: string) => {
    try {
      const analytics = await getUserSettingsAnalytics(userId);
      return { success: true, data: analytics };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-executions-by-project-id', async (_, projectId: string) => {
    try {
      const executions = await getExecutionsByProjectIdOnline(projectId);
      return { success: true, data: executions };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-execution-by-id', async (_, id: string) => {
    try {
      // Handle mock execution IDs for testing
      if (id.startsWith('mock-exec-')) {
        const mockExecution = {
          id,
          project_name: 'Mock Execution Test',
          status: 'completed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          total_images_processed: 25,
          total_images_found: 30,
          folder_name: 'Mock Test Folder'
        };
        return { success: true, data: mockExecution };
      }

      const execution = await getExecutionByIdOnline(id);
      return { success: true, data: execution };
    } catch (e: any) { return { success: false, error: e.message }; }
  });
  
  ipcMain.handle('db-update-execution', async (_, { id, executionData }: { id: string, executionData: Partial<Omit<Execution, 'id' | 'user_id' | 'project_id' | 'created_at' | 'updated_at'>> }) => {
    try {
      const updatedExecution = await updateExecutionOnline(id, executionData);
      return { success: true, data: updatedExecution };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-delete-execution', async (_, id: string) => {
    try {
      await deleteExecutionOnline(id);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-recent-projects', async (_, limit?: number) => {
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) return { success: true, data: [] };
      const projects = getRecentProjectsFromCache(userId, limit);
      return { success: true, data: projects };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // ==================== PRESET PARTECIPANTI IPC HANDLERS ====================

  ipcMain.handle('db-create-participant-preset', async (_, presetData: Omit<ParticipantPreset, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const preset = await createParticipantPreset(presetData);
      return { success: true, data: preset };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-participant-presets', async () => {
    try {
      const presets = await getUserParticipantPresets();
      return { success: true, data: presets };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-get-participant-preset-by-id', async (_, presetId: string) => {
    try {
      const preset = await getParticipantPresetById(presetId);
      return { success: true, data: preset };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-save-preset-participants', async (_, { presetId, participants }: { presetId: string, participants: Omit<PresetParticipant, 'id' | 'created_at'>[] }) => {
    try {
      await savePresetParticipants(presetId, participants);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-update-preset-last-used', async (_, presetId: string) => {
    try {
      await updatePresetLastUsed(presetId);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-delete-participant-preset', async (_, presetId: string) => {
    try {
      await deleteParticipantPreset(presetId);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('db-import-participants-from-csv', async (_, { csvData, presetName, category }: { csvData: any[], presetName: string, category?: string }) => {
    try {
      const preset = await importParticipantsFromCSV(csvData, presetName, category);
      return { success: true, data: preset };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // ==================== SUPABASE IPC HANDLERS ====================

  // Sport Categories Handlers
  ipcMain.handle('supabase-get-sport-categories', async () => {
    try {
      const categories = await getSportCategories();
      return { success: true, data: categories };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-get-sport-category-by-code', async (_, code: string) => {
    try {
      const category = await getSportCategoryByCode(code);
      return { success: true, data: category };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-get-cached-sport-categories', async () => {
    try {
      const categories = getCachedSportCategories();
      console.log('[MAIN] getCachedSportCategories called, returning:', categories.length, 'categories');
      console.log('[MAIN] First few categories:', categories.slice(0, 3).map(c => ({code: c.code, name: c.name})));
      return { success: true, data: categories };
    } catch (e: any) {
      console.error('[MAIN] Error in get-cached-sport-categories:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('supabase-refresh-categories-cache', async () => {
    try {
      await refreshCategoriesCache();
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Participant Presets Supabase Handlers
  ipcMain.handle('supabase-create-participant-preset', async (_, presetData: Omit<ParticipantPresetSupabase, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const preset = await createParticipantPresetSupabase(presetData);
      return { success: true, data: preset };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-get-participant-presets', async () => {
    try {
      const presets = await getUserParticipantPresetsSupabase();
      return { success: true, data: presets };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-get-participant-preset-by-id', async (_, presetId: string) => {
    try {
      const preset = await getParticipantPresetByIdSupabase(presetId);
      return { success: true, data: preset };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-save-preset-participants', async (_, { presetId, participants }: { presetId: string, participants: Omit<PresetParticipantSupabase, 'id' | 'created_at'>[] }) => {
    try {
      await savePresetParticipantsSupabase(presetId, participants);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-update-preset-last-used', async (_, presetId: string) => {
    try {
      await updatePresetLastUsedSupabase(presetId);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-update-participant-preset', async (_, { presetId, updateData }: { presetId: string, updateData: Partial<{ name: string, description: string, category_id: string }> }) => {
    try {
      await updateParticipantPresetSupabase(presetId, updateData);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-delete-participant-preset', async (_, presetId: string) => {
    try {
      await deleteParticipantPresetSupabase(presetId);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-import-participants-from-csv', async (_, { csvData, presetName, categoryId }: { csvData: any[], presetName: string, categoryId?: string }) => {
    try {
      const preset = await importParticipantsFromCSVSupabase(csvData, presetName, categoryId);
      return { success: true, data: preset };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('supabase-get-cached-participant-presets', async () => {
    try {
      const presets = getCachedParticipantPresets();
      return { success: true, data: presets };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Admin-only: Get all participant presets (not just user's own)
  ipcMain.handle('supabase-get-all-participant-presets-admin', async () => {
    try {
      // Verify admin role
      if (!authService.isAdmin()) {
        return { success: false, error: 'Unauthorized: Admin access required' };
      }

      console.log('[IPC] Admin requesting all participant presets');
      const presets = await getUserParticipantPresetsSupabase(true);
      return { success: true, data: presets };
    } catch (e: any) {
      console.error('[IPC] Error getting all presets for admin:', e);
      return { success: false, error: e.message };
    }
  });

  // Cache Management Handlers
  ipcMain.handle('supabase-cache-data', async () => {
    try {
      await cacheSupabaseData();
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Feature Flags Handler
  ipcMain.handle('supabase-is-feature-enabled', async (_, featureName: string) => {
    try {
      const isEnabled = await isFeatureEnabled(featureName);
      return { success: true, data: isEnabled };
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // Analysis Log Handler (for Log Visualizer compatibility)
  ipcMain.handle('get-analysis-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        const mockLogData = [
          {
            event: 'IMAGE_ANALYSIS',
            fileName: 'IMG_0001.jpg',
            timestamp: new Date().toISOString(),
            data: {
              fileName: 'IMG_0001.jpg',
              analysis: [{ number: '42', confidence: 0.95 }],
              csvMatch: { numero: '42', nome: 'Test Driver', squadra: 'Test Team' },
              imagePath: '/mock/path/IMG_0001.jpg',
              compressedPath: '/mock/compressed/IMG_0001.jpg',
              thumbnailPath: '/mock/thumb/IMG_0001.jpg',
              microThumbPath: '/mock/micro/IMG_0001.jpg'
            }
          },
          {
            event: 'IMAGE_ANALYSIS',
            fileName: 'IMG_0002.jpg',
            timestamp: new Date().toISOString(),
            data: {
              fileName: 'IMG_0002.jpg',
              analysis: [{ number: '17', confidence: 0.88 }],
              csvMatch: { numero: '17', nome: 'Another Driver', squadra: 'Racing Team' },
              imagePath: '/mock/path/IMG_0002.jpg',
              compressedPath: '/mock/compressed/IMG_0002.jpg',
              thumbnailPath: '/mock/thumb/IMG_0002.jpg',
              microThumbPath: '/mock/micro/IMG_0002.jpg'
            }
          }
        ];
        console.log(`[Main Process] Returning mock log data for execution ${executionId}`);
        return mockLogData;
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      if (!fs.existsSync(logFilePath)) {
        console.warn(`[Main Process] Analysis log file not found: ${logFilePath}`);
        return []; // Return empty array if no log file (Log Visualizer expects array directly)
      }

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());
      const logEvents = logLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.warn('[Main Process] Invalid JSON line in analysis log:', line);
          return null;
        }
      }).filter(Boolean);

      console.log(`[Main Process] Loaded ${logEvents.length} analysis log events for execution ${executionId}`);
      return logEvents;

    } catch (error) {
      console.error('[Main Process] Error reading analysis log:', error);
      return [];
    }
  });

  // Helper function to get statistics from local cache
  async function getHomeStatisticsFromCache(userId: string, monthStart: Date, monthEnd: Date): Promise<{
    success: boolean;
    data?: { monthlyPhotos: number; completedEvents: number } | null;
    error?: string;
  }> {
    try {
      // This is a placeholder - in a full implementation, you would query the local SQLite database
      // For now, return null to indicate local cache is not available
      return { success: true, data: null };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Local cache error' };
    }
  }

  // Home page statistics handler
  ipcMain.handle('get-home-statistics', async () => {
    console.log('[Home Stats] Starting home statistics calculation...');
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) {
        console.log('[Home Stats] No user ID available, returning default stats');
        return {
          success: true,
          data: {
            monthlyPhotos: 0,
            completedEvents: 0
          }
        };
      }

      // Get last 30 days date range
      const now = new Date();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      console.log(`[Home Stats] Querying executions for user ${userId} from ${thirtyDaysAgo.toISOString()} to ${now.toISOString()}`);

      let monthlyPhotos = 0;
      let completedEvents = 0;

      // Try to get statistics from online database first
      try {
        const supabase = getSupabaseClient();

        // Query executions with correct JOIN to execution_settings for photo counts
        console.log('[Home Stats] Executing query with execution_settings JOIN...');
        const { data, error } = await supabase
          .from('executions')
          .select(`
            id,
            status,
            created_at,
            execution_settings!execution_settings_execution_id_fkey (
              total_images_processed
            )
          `)
          .eq('user_id', userId)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .lte('created_at', now.toISOString());

        if (error) {
          console.error('[Home Stats] Supabase query error:', error);
          throw error;
        }

        if (data && Array.isArray(data)) {
          completedEvents = data.filter(exec => exec.status === 'completed').length;
          // Sum actual photos processed from execution_settings
          monthlyPhotos = data.reduce((sum, exec) => {
            const settings: any = Array.isArray(exec.execution_settings) && exec.execution_settings.length > 0
              ? exec.execution_settings[0]
              : exec.execution_settings;
            const totalImages = settings?.total_images_processed || 0;
            return sum + totalImages;
          }, 0);

          // Also query images table directly for cross-verification
          const { data: imagesData, error: imagesError } = await supabase
            .from('images')
            .select('id', { count: 'exact' })
            .eq('user_id', userId)
            .gte('uploaded_at', thirtyDaysAgo.toISOString())
            .lte('uploaded_at', now.toISOString());

          const directImageCount = imagesData ? imagesData.length : 0;

          // Also check total images for this user (no date filter) for comparison
          const { data: totalImagesData, error: totalImagesError } = await supabase
            .from('images')
            .select('id', { count: 'exact' })
            .eq('user_id', userId);

          const totalUserImages = totalImagesData ? totalImagesData.length : 0;
          console.log(`[Home Stats] Total images ever for this user: ${totalUserImages}`);

          // If execution_settings has no photo data, fallback to direct image count
          if (monthlyPhotos === 0 && directImageCount > 0) {
            monthlyPhotos = directImageCount;
            console.log(`[Home Stats] Using fallback: execution_settings empty, using direct image count`);
          }

          console.log(`[Home Stats] Successfully retrieved statistics:`, {
            totalExecutions: data.length,
            completedEvents,
            monthlyPhotos: monthlyPhotos,
            directImageCount: directImageCount,
            totalUserImages: totalUserImages,
            usingFallback: monthlyPhotos === directImageCount && directImageCount > 0
          });
        } else {
          console.warn('[Home Stats] No execution data found');
        }
      } catch (supabaseError) {
        console.warn('[Home Stats] Supabase query failed, trying local cache:', supabaseError);
        // Try to get data from local SQLite database
        try {
          const { data: localStats } = await getHomeStatisticsFromCache(userId, thirtyDaysAgo, now);
          if (localStats) {
            monthlyPhotos = localStats.monthlyPhotos || 0;
            completedEvents = localStats.completedEvents || 0;
            console.log('[Home Stats] Using local cache statistics:', { completedEvents, monthlyPhotos });
          } else {
            console.warn('[Home Stats] No local cache data available');
          }
        } catch (localError: any) {
          console.warn('[Home Stats] Local cache also failed:', localError?.message || localError);
        }
      }

      console.log(`[Home Stats] Final statistics result:`, { monthlyPhotos, completedEvents });
      return {
        success: true,
        data: {
          monthlyPhotos,
          completedEvents
        }
      };
    } catch (error: any) {
      console.error('[Home Stats] Critical error getting home statistics:', error);
      return {
        success: false,
        error: error.message,
        data: {
          monthlyPhotos: 0,
          completedEvents: 0
        }
      };
    }
  });

  // Get recent executions handler
  ipcMain.handle('get-recent-executions', async () => {
    console.log('[Recent Executions] Starting recent executions query...');
    try {
      const userId = authService.getAuthState().user?.id;
      if (!userId) {
        console.log('[Recent Executions] No user ID available, returning empty array');
        return {
          success: true,
          data: []
        };
      }

      // Read executions from JSONL logs
      console.log('[Recent Executions] Reading executions from analysis logs');
      const executions = await getExecutionsFromLogs();

      return {
        success: true,
        data: executions
      };

    } catch (error: any) {
      console.error('[Recent Executions] Critical error getting recent executions:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }
  });

  // Helper function to search for files in a directory based on filename
  const searchFilesInDirectory = async (dirPath: string, baseFileName: string): Promise<string | null> => {
    try {
      await fsPromises.access(dirPath, fs.constants.F_OK);
    } catch {
      return null;
    }

    console.log(`[searchFilesInDirectory] Searching in ${dirPath} for baseFileName: ${baseFileName}`);

    const allFiles = await fsPromises.readdir(dirPath);

    const matchedFiles = allFiles.filter(file => {
      const fileName = file.toLowerCase();
      const searchName = baseFileName.toLowerCase();

      // Multiple search strategies for better matching
      const directMatch = fileName.startsWith(searchName) || fileName.includes(searchName);

      // Try without file extension on search term
      const baseNameWithoutExt = path.parse(searchName).name.toLowerCase();
      const extMatch = fileName.startsWith(baseNameWithoutExt) || fileName.includes(baseNameWithoutExt);

      // Try with common variations (underscores, dots)
      const variations = [
        searchName.replace(/\./g, '_'),
        searchName.replace(/_/g, '.'),
        searchName.replace(/\s+/g, '_'),
        searchName.replace(/_/g, '-')
      ];
      const variationMatch = variations.some(variant => fileName.includes(variant));

      const matches = directMatch || extMatch || variationMatch;
      if (matches) {
        console.log(`[searchFilesInDirectory] Found matching file: ${file} for search term: ${baseFileName}`);
      }

      return matches;
    });

    // CRITICAL FIX: Cache stats BEFORE sorting to avoid O(N²) statSync calls
    const filesWithStats = await Promise.all(
      matchedFiles.map(async (file) => {
        try {
          const filePath = path.join(dirPath, file);
          const stats = await fsPromises.stat(filePath);
          return {
            file,
            mtime: stats.mtime.getTime()
          };
        } catch (error) {
          console.warn(`[searchFilesInDirectory] Failed to stat ${file}:`, error);
          return {
            file,
            mtime: 0
          };
        }
      })
    );

    // Sort using cached stats - NO MORE BLOCKING STATYNC CALLS
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    console.log(`[searchFilesInDirectory] Found ${filesWithStats.length} matching files in ${dirPath}`);
    return filesWithStats.length > 0 ? path.join(dirPath, filesWithStats[0].file) : null;
  };

  // Helper function to search with a specific filename
  const findThumbnailsForFileName = async (tempDir: string, fileName: string): Promise<any> => {
    const baseFileName = path.parse(fileName).name;

    // Run all searches in parallel for better performance
    const [thumbnailPath, microThumbPath, compressedPath] = await Promise.all([
      searchFilesInDirectory(path.join(tempDir, 'thumbnails'), baseFileName),
      searchFilesInDirectory(path.join(tempDir, 'micro-thumbs'), baseFileName),
      searchFilesInDirectory(path.join(tempDir, 'compressed'), baseFileName)
    ]);

    return {
      thumbnailPath,
      microThumbPath,
      compressedPath
    };
  };

  // Find local thumbnail paths for a filename (supports both string and object parameters)
  ipcMain.handle('find-local-thumbnails', async (_, params: string | { fileName: string; originalFileName?: string; originalPath?: string }) => {
    try {
      const tempDir = path.join(os.homedir(), '.racetagger-temp');
      let thumbnailPaths: any = {};

      // Handle both string parameter (backward compatibility) and object parameter
      const fileName = typeof params === 'string' ? params : params.fileName;
      const originalFileName = typeof params === 'object' ? params.originalFileName : undefined;
      const originalPath = typeof params === 'object' ? params.originalPath : undefined;

      // Try originalFileName first if provided
      if (originalFileName) {
        console.log(`[Main Process] Searching thumbnails first with originalFileName: ${originalFileName}`);
        thumbnailPaths = await findThumbnailsForFileName(tempDir, originalFileName);

        // Check if we found any thumbnails with originalFileName
        const hasResults = thumbnailPaths.thumbnailPath || thumbnailPaths.microThumbPath || thumbnailPaths.compressedPath;
        if (hasResults) {
          console.log(`[Main Process] Found local thumbnails using originalFileName ${originalFileName}:`, thumbnailPaths);
          return { success: true, data: thumbnailPaths };
        }
      }

      // Fallback to fileName search
      console.log(`[Main Process] Searching thumbnails with fileName: ${fileName}`);
      thumbnailPaths = await findThumbnailsForFileName(tempDir, fileName);

      // Check if we found any thumbnails with fileName
      const hasResults = thumbnailPaths.thumbnailPath || thumbnailPaths.microThumbPath || thumbnailPaths.compressedPath;

      // If no thumbnails found, check if we can use original JPEG file as fallback
      if (!hasResults && originalPath) {
        const fileExt = path.extname(originalPath).toLowerCase();
        const isJpegFile = ['.jpg', '.jpeg'].includes(fileExt);

        console.log(`[Main Process] No thumbnails found, checking JPEG fallback for: ${originalPath} (ext: ${fileExt})`);

        if (isJpegFile) {
          try {
            // Check if the original JPEG file still exists
            await fsPromises.access(originalPath, fs.constants.F_OK);
            console.log(`[Main Process] Using original JPEG file as thumbnail: ${originalPath}`);

            // Return the original JPEG path as thumbnailPath
            thumbnailPaths.thumbnailPath = originalPath;
            thumbnailPaths.isOriginalFile = true; // Flag to indicate this is not a generated thumbnail
          } catch (accessError) {
            console.log(`[Main Process] Original JPEG file not accessible: ${originalPath}`);
          }
        }
      }

      const searchTerm = originalFileName ? `originalFileName (${originalFileName}) then fileName (${fileName})` : `fileName (${fileName})`;
      console.log(`[Main Process] Found local thumbnails for ${searchTerm}:`, thumbnailPaths);
      return { success: true, data: thumbnailPaths };
    } catch (error) {
      console.error('[Main Process] Error finding local thumbnails:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get user info handler
  ipcMain.handle('get-user-info', async () => {
    try {
      const authState = authService.getAuthState();
      if (authState.user) {
        return {
          success: true,
          name: authState.user.user_metadata?.name || authState.user.email?.split('@')[0] || 'Photographer'
        };
      }
      return { success: false, name: 'Photographer' };
    } catch (error) {
      console.error('[User Info] Error getting user info:', error);
      return { success: false, name: 'Photographer' };
    }
  });
}

// Removed handleImageAnalysis since we only support folder processing now
async function handleFolderSelection(event: IpcMainEvent) {
  console.log('[Main Process] handleFolderSelection called.');
  
  if (!mainWindow) {
    console.error('handleFolderSelection: mainWindow is null');
    return;
  }
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleziona una cartella di immagini'
    });
    
    if (result.canceled) {
      console.log('Folder selection canceled by user');
      // Don't send any message - user simply closed the dialog
      return;
    }
    
    const folderPath = result.filePaths[0];
    console.log('Selected folder:', folderPath);
    
    // Verifica se la cartella esiste
    if (!fs.existsSync(folderPath)) {
      console.error('Selected folder does not exist:', folderPath);
      event.sender.send('folder-selected', { success: false, message: 'La cartella selezionata non esiste' });
      return;
    }
    
    // Ottieni la lista delle immagini nella cartella
    const imageFiles = await getImagesFromFolder(folderPath);
    const imageCount = imageFiles.length;
    const rawCount = imageFiles.filter(img => img.isRaw).length;
    console.log(`Found ${imageCount} images in folder (${rawCount} RAW files)`);
    
    // Invia il percorso della cartella e il conteggio delle immagini al renderer process
    event.sender.send('folder-selected', { 
      success: true, 
      path: folderPath,
      imageCount: imageCount,
      rawCount: rawCount
    });
    
    // Salva il percorso della cartella per un eventuale utilizzo futuro
    if (batchConfig) {
      batchConfig.folderPath = folderPath;
    } else {
      batchConfig = { folderPath, updateExif: false };
    }
  } catch (error) {
    console.error('Error during folder selection:', error);
    event.sender.send('folder-selected', { success: false, message: 'Errore durante la selezione della cartella' });
  }
}


// Handle token request submission via secure Edge Function
async function handleTokenRequest(event: IpcMainInvokeEvent, requestData: any) {
  console.log('[Main Process] handleTokenRequest called with:', requestData);
  
  try {
    // Get current user information
    const authState = authService.getAuthState();
    if (!authState.isAuthenticated || !authState.user) {
      throw new Error('User must be authenticated to request tokens');
    }

    const tokensRequested = parseInt(requestData.tokensRequested);
    console.log(`[Main Process] Processing token request: ${tokensRequested} tokens`);

    // Call secure Edge Function instead of direct DB access
    console.log('[Main Process] Calling handle-token-request Edge Function...');
    
    // Get current session token for Authorization header
    const session = authService.getSession();
    if (!session || !session.access_token) {
      throw new Error('No valid session token available');
    }

    const { data: response, error } = await supabase.functions.invoke('handle-token-request', {
      headers: {
        Authorization: `Bearer ${session.access_token}`
      },
      body: {
        tokensRequested: tokensRequested,
        message: requestData.message || null
      }
    });

    if (error) {
      console.error('[Main Process] Edge Function error:', error);
      throw new Error(`Failed to process token request: ${error.message}`);
    }

    if (!response) {
      throw new Error('Edge Function returned empty response');
    }

    // Se success è false, significa che è un errore business logic (es. limite raggiunto)
    // Restituiamo la risposta così come è per permettere al frontend di gestirla
    if (!response.success) {
      console.log('[Main Process] Edge Function returned business logic error:', response);
      
      // Email notification is now handled by Edge Functions only
      console.log('[Main Process] Email notification will be sent by Edge Function');
      
      return {
        success: false,
        message: response.error || response.message || 'Request could not be processed',
        requestSaved: response.requestSaved || false,
        paymentRequired: response.paymentRequired || false,
        monthlyUsage: response.monthlyUsage || null
      };
    }

    console.log('[Main Process] Token request processed successfully via Edge Function');

    // Email notification is now handled by Edge Functions only
    console.log('[Main Process] Email notification will be sent by Edge Function');

    return {
      success: true,
      message: response.message,
      requestId: response.requestId,
      isEarlyAccessFree: response.isEarlyAccessFree,
      tokensGranted: response.tokensGranted || 0,
      paymentRequired: response.paymentRequired || false
    };

  } catch (error: any) {
    console.error('[Main Process] Error handling token request:', error);
    return {
      success: false,
      message: error.message || 'An unexpected error occurred. Please try again.'
    };
  }
}

// Handle token balance request
async function handleGetTokenBalance(event: IpcMainInvokeEvent): Promise<number> {
  console.log('[Main Process] handleGetTokenBalance called');
  
  try {
    const tokenBalance = await authService.getTokenBalance();
    console.log(`[Main Process] Current token balance: ${tokenBalance}`);
    return typeof tokenBalance === 'number' ? tokenBalance : tokenBalance.remaining;
  } catch (error: any) {
    console.error('[Main Process] Error getting token balance:', error);
    // Return 0 as fallback to prevent operations
    return 0;
  }
}

// Handle pending tokens request
async function handleGetPendingTokens(event: IpcMainInvokeEvent): Promise<number> {
  console.log('[Main Process] handleGetPendingTokens called');
  
  try {
    const pendingTokens = await authService.getPendingTokens();
    console.log(`[Main Process] Pending tokens: ${pendingTokens}`);
    return pendingTokens;
  } catch (error: any) {
    console.error('[Main Process] Error getting pending tokens:', error);
    return 0;
  }
}

// Handle complete token info request (balance + pending)
async function handleGetTokenInfo(event: IpcMainInvokeEvent): Promise<{ balance: any; pending: number }> {
  console.log('[Main Process] handleGetTokenInfo called');
  
  try {
    const tokenInfo = await authService.getTokenInfo();
    console.log('[Main Process] Token info:', tokenInfo);
    return tokenInfo;
  } catch (error: any) {
    console.error('[Main Process] Error getting token info:', error);
    return {
      balance: { total: 0, used: 0, remaining: 0 },
      pending: 0
    };
  }
}

async function getImagesFromFolder(folderPath: string): Promise<{ path: string; isRaw: boolean }[]> {
  console.log('[Main Process] getImagesFromFolder called.');
  
  // Log della cartella selezionata
  console.log(`Scanning folder: ${folderPath}`);
  
  try {
    // Verifica i permessi della cartella
    await fsPromises.access(folderPath, fs.constants.R_OK);
    console.log(`Folder ${folderPath} is readable.`);
  } catch (err) {
    console.error(`Error accessing folder ${folderPath}:`, err);
    throw new Error(`Cannot access folder: ${folderPath}. Please check permissions.`);
  }
  
  let files: string[];
  try {
    // Leggi tutti i file nella cartella
    files = await fsPromises.readdir(folderPath);
    console.log(`Total files found in folder: ${files.length}`);
  } catch (err) {
    console.error(`Error reading directory ${folderPath}:`, err);
    throw new Error(`Cannot read directory: ${folderPath}.`);
  }
  
  // Log di tutti i file trovati e le loro estensioni
  console.log('All files in folder:');
  files.forEach(file => {
    const ext = path.extname(file); // Non convertire in minuscolo qui per il log
    const lowerExt = ext.toLowerCase();
    const isSupported = ALL_SUPPORTED_EXTENSIONS.includes(lowerExt);
    const isRaw = RAW_EXTENSIONS.includes(lowerExt);
    console.log(`- ${file} (original ext: ${ext}, lower ext: ${lowerExt}, supported: ${isSupported}, isRaw: ${isRaw})`);
  });
  
  // Log delle estensioni supportate
  console.log('Supported extensions:', ALL_SUPPORTED_EXTENSIONS);
  console.log('RAW extensions:', RAW_EXTENSIONS);
  
  const imageFiles = files
    .filter(file => {
      const ext = path.extname(file).toLowerCase(); // Converti in minuscolo per il confronto
      const isSupported = ALL_SUPPORTED_EXTENSIONS.includes(ext);
      if (!isSupported) {
        console.log(`Skipping unsupported file: ${file} (ext: ${ext})`);
      }
      return isSupported;
    })
    .map(file => {
      const filePath = path.join(folderPath, file);
      const ext = path.extname(file).toLowerCase(); // Converti in minuscolo per il confronto
      const isRaw = RAW_EXTENSIONS.includes(ext);
      
      console.log(`Adding file to process: ${file} (ext: ${ext}, isRaw: ${isRaw})`);
      
      return {
        path: filePath,
        isRaw
      };
    });
  
  // Log dei file RAW trovati
  const rawFiles = imageFiles.filter(img => img.isRaw);
  if (rawFiles.length > 0) {
    console.log(`Found ${rawFiles.length} RAW files in folder`);
    rawFiles.forEach(file => console.log(`RAW file: ${file.path}`));
  } else {
    console.log('No RAW files found in folder');
  }
  
  console.log(`Total supported images found: ${imageFiles.length}`);
  
  return imageFiles;
}

// Variabile globale per i dati CSV standalone
let csvData: CsvEntry[] = [];

// Variabile globale per il controllo della cancellazione
let batchProcessingCancelled = false;

// Funzione originale per il caricamento CSV standalone
async function handleStandaloneCSVLoading(event: IpcMainEvent, fileData: any) {
  try {
    if (!mainWindow) return;
    
    const { buffer, name: fileName } = fileData;
    const fileBuffer = Buffer.from(buffer);
    
    // Convert buffer to string
    const fileContent = fileBuffer.toString('utf8');
    console.log('CSV content (first 200 chars):', fileContent.substring(0, 200));
    
    // Parse CSV data manually for better control
    const results: CsvEntry[] = [];
    
    // Split content by lines
    const lines = fileContent.split(/\r?\n/);
    
    // Get headers (first line)
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }
    
    const headers = parseCSVLine(lines[0]);
    console.log('CSV headers:', headers);
    
    // Check required headers
    const numeroIndex = headers.indexOf('numero');
    const metatagIndex = headers.indexOf('metatag');
    const nomeIndex = headers.indexOf('nome');
    const categoriaIndex = headers.indexOf('categoria');
    const squadraIndex = headers.indexOf('squadra');
    
    if (numeroIndex === -1 || metatagIndex === -1) {
      throw new Error('CSV file must have "numero" and "metatag" columns');
    }
    
    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;  // Skip empty lines
      
      const values = parseCSVLine(line);
      console.log(`Row ${i} values:`, values);
      
      if (values.length >= Math.max(numeroIndex, metatagIndex) + 1) {
        const numero = values[numeroIndex].trim();
        const metatag = values[metatagIndex].trim();
        
        if (numero && metatag) {
          const entry: CsvEntry = {
            numero,
            metatag
          };
          
          // Add optional fields if they exist
          if (nomeIndex !== -1 && values[nomeIndex]) {
            entry.nome = values[nomeIndex].trim();
          }
          
          if (categoriaIndex !== -1 && values[categoriaIndex]) {
            entry.categoria = values[categoriaIndex].trim();
          }
          
          if (squadraIndex !== -1 && values[squadraIndex]) {
            entry.squadra = values[squadraIndex].trim();
          }
          
          results.push(entry);
          console.log('Added CSV entry:', entry);
        } else {
          console.warn('Skipping row due to missing required fields:', values);
        }
      } else {
        console.warn('Skipping row with insufficient values:', values);
      }
    }
    
    console.log('CSV parsing complete, found', results.length, 'valid entries');
    
    // Store the CSV data globally
    csvData = results;
    
    // Save CSV to Supabase if user is authenticated
    if (authService.isAuthenticated() && results.length > 0) {
      try {
        console.log(`[Main Process] Saving CSV "${fileName}" to Supabase...`);
        await saveCsvToSupabase(results, fileName);
        console.log('[Main Process] CSV saved to Supabase successfully');
      } catch (csvSaveError) {
        console.error('[Main Process] Error saving CSV to Supabase:', csvSaveError);
        // Non bloccare il caricamento se il salvataggio su Supabase fallisce
      }
    }
    
    // Send information back to the renderer
    mainWindow.webContents.send('csv-loaded', {
      filename: fileName,
      entries: results.length
    });
    
  } catch (error: any) {
    console.error('Error during CSV loading:', error);
    if (mainWindow) {
      mainWindow.webContents.send('csv-error', error.message || 'An error occurred while loading CSV file');
    }
  }
}

// Funzione per il caricamento CSV con supporto per progetti e analisi one-shot
async function handleCsvLoading(event: IpcMainEvent, fileData: { buffer: Uint8Array, name: string, projectId?: string, standalone?: boolean }) {
  console.log('[Main Process] handleCsvLoading called.');
  
  // Se è richiesto il caricamento standalone, usa la funzione dedicata
  if (fileData.standalone) {
    return handleStandaloneCSVLoading(event, fileData);
  }
  
  try {
    if (!mainWindow) return;
    const { buffer: rawBuffer, name: fileName, projectId } = fileData;
    const actualBuffer = Buffer.from(rawBuffer); // Assicura sia un Buffer

    if (projectId) {
      console.log(`Received CSV for project ${projectId}. Uploading to storage...`);
      const storagePath = await uploadCsvToStorage(projectId, actualBuffer, fileName);
      const updatedProject = await updateProjectOnline(projectId, { base_csv_storage_path: storagePath });
      mainWindow.webContents.send('csv-loaded', {
        filename: fileName, message: `CSV associato al progetto ${projectId}`, project: updatedProject
      });
    } else {
      // Supporta il caricamento CSV anche senza progetto per analisi one-shot
      console.log('Processing CSV for one-shot analysis without project association');
      
      // Leggi il contenuto del CSV
      const csvContent = actualBuffer.toString('utf-8');
      const lines = csvContent.split(/\r?\n/);
      
      // Salta l'intestazione e conta le righe di dati
      const entries = lines.length > 1 ? lines.length - 1 : 0;
      
      // Processa il CSV per uso globale temporaneo
      if (entries > 0) {
        try {
          // Estrai l'intestazione
          const headers = parseCSVLine(lines[0]);
          console.log('CSV headers:', headers);
          
          // Processa le righe di dati
          const csvEntries: CsvEntry[] = [];
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            
            const values = parseCSVLine(lines[i]);
            const entry: CsvEntry = { numero: '', metatag: '' };
            
            // Mappa i valori alle colonne
            for (let j = 0; j < headers.length && j < values.length; j++) {
              const header = headers[j].toLowerCase().trim();
              const value = values[j] ? values[j].trim() : '';
              
              if (header === 'numero') {
                entry.numero = value;
              } else if (header === 'nome') {
                entry.nome = value;
              } else if (header === 'categoria') {
                entry.categoria = value;
              } else if (header === 'squadra') {
                entry.squadra = value;
              } else if (header === 'metatag') {
                entry.metatag = value;
              } else {
                // Campi aggiuntivi
                entry[header] = value;
              }
            }
            
            // Se non c'è un metatag ma ci sono altri campi, crea un metatag automatico
            if (!entry.metatag && (entry.nome || entry.categoria || entry.squadra)) {
              const parts = [];
              if (entry.nome) parts.push(entry.nome);
              if (entry.categoria) parts.push(entry.categoria);
              if (entry.squadra) parts.push(entry.squadra);
              entry.metatag = parts.join(' - ');
            }
            
            // Aggiungi solo se ha almeno un numero di gara
            if (entry.numero) {
              csvEntries.push(entry);
            }
          }
          
          // Salva i dati CSV per uso globale
          globalCsvData = csvEntries;
          console.log(`Processed ${csvEntries.length} valid entries from CSV`);
          
          mainWindow.webContents.send('csv-loaded', {
            filename: fileName, 
            entries: csvEntries.length, 
            message: `CSV caricato con ${csvEntries.length} voci valide`
          });
        } catch (parseError) {
          console.error('Error parsing CSV:', parseError);
          mainWindow.webContents.send('csv-error', 'Errore nel parsing del CSV. Verifica il formato.');
        }
      } else {
        mainWindow.webContents.send('csv-loaded', {
          filename: fileName, 
          entries: 0, 
          message: 'CSV caricato, ma non contiene dati validi'
        });
      }
    }
  } catch (error: any) {
    console.error('Error during CSV loading:', error);
    if (mainWindow) mainWindow.webContents.send('csv-error', error.message || 'CSV loading error');
  }
}

function handleCsvTemplateDownload(event: IpcMainEvent) {
  try {
    console.log("CSV template download requested");
    if (!mainWindow) {
      console.error("No main window available");
      return;
    }
    
    // Create CSV template content with all supported columns
    const csvTemplate =
      "Number,Driver,Team,Category,Plate_Number,Sponsors,Metatag,Folder_1,Folder_2,Folder_3\n" +
      "1,John Doe,Racing Team A,GT3,AB123CD,Sponsor Corp,Pro Driver,Team-A,GT3-Drivers,\n" +
      "2,Mike Johnson,Speed Team,GT4,XY987ZW,Brand X,Semi-Pro,Speed-Team,GT4-Rookies,\n" +
      "3,\"Balthasar, Ponzo, Roe\",Imperiale Racing,GT3,FE456GH,\"elea costruzioni, topcon\",VIP,Imperiale,,\n" +
      "51,\"Alessandro Pier Guidi / James Calado\",Ferrari,GT3,FE488GT,\"Shell, Santander\",Pro,Ferrari-Team,GT3-Pro,";
    
    // Show save dialog
    dialog.showSaveDialog(mainWindow, {
      title: 'Save CSV Template',
      defaultPath: path.join(app.getPath('downloads'), 'starting-list-template.csv'),
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    }).then(result => {
      if (result.canceled || !result.filePath) {
        console.log("Save dialog canceled");
        return;
      }
      
      // Write the template to the selected path
      fs.writeFile(result.filePath, csvTemplate, 'utf8', (err) => {
        if (err) {
          console.error("Error writing CSV template:", err);
          dialog.showErrorBox('CSV Template Error', err.message || 'An error occurred while saving the CSV template');
          return;
        }
        
        console.log("CSV template saved to:", result.filePath);
        // Notify the renderer
        mainWindow?.webContents.send('csv-template-saved', result.filePath);
      });
    }).catch(err => {
      console.error("Save dialog error:", err);
      dialog.showErrorBox('CSV Template Error', err.message || 'An error occurred while opening save dialog');
    });
    
  } catch (error: any) {
    console.error('Error during CSV template download:', error);
    if (mainWindow) {
      dialog.showErrorBox('CSV Template Error', error.message || 'An error occurred while saving the CSV template');
    }
  }
}
/**
 * Salva la preview di un'immagine RAW per visualizzazione nella tabella dei risultati
 * @param imagePath Percorso del file RAW
 * @param previewBuffer Buffer della preview JPEG
 * @param config Configurazione del processo batch
 * @returns Path della preview salvata o null se non salvata
 */
async function saveImagePreview(
  imagePath: string,
  previewBuffer: Buffer,
  config?: BatchProcessConfig
): Promise<string | null> {
  // Se non richiesto il salvataggio della preview, ritorna null
  if (config && config.savePreviewImages === false) {
    return null;
  }
  
  try {
    // Crea la cartella per le preview se non esiste
    const previewFolderName = (config && config.previewFolder) || 'previews';
    const appPath = app.getPath('userData');
    const previewFolder = path.join(appPath, previewFolderName);
    
    if (!fs.existsSync(previewFolder)) {
      await fsPromises.mkdir(previewFolder, { recursive: true });
      console.log(`Created preview folder: ${previewFolder}`);
    }
    
    // Genera un nome file univoco per la preview
    const baseFileName = path.basename(imagePath);
    const previewFileName = `preview_${Date.now()}_${baseFileName}.jpg`;
    const previewPath = path.join(previewFolder, previewFileName);
    
    // Salva il buffer come file JPEG
    await fsPromises.writeFile(previewPath, previewBuffer);
    console.log(`Saved preview image to: ${previewPath}`);
    
    return previewPath;
  } catch (error: any) {
    console.error(`Error saving preview image: ${error.message}`);
    return null;
  }
}

/**
 * Pre-elabora un'immagine se necessario (estrae preview da RAW, ecc.)
 * @param imagePath Percorso del file immagine
 * @param config Configurazione del processo batch (per opzioni di preview)
 * @returns Oggetto con buffer, mimeType, isRawConverted, originalFormat, ecc.
 */
async function preprocessImageIfNeeded(
  imagePath: string,
  config?: BatchProcessConfig
): Promise<{
  buffer: Buffer;
  mimeType: string;
  isRawConverted: boolean;
  originalFormat: string | null;
  xmpPath: string | null;
  previewPath?: string | null;
  tempServiceFilePath?: string; // Aggiunto per tenere traccia del file di servizio
  tempDngPath?: string | null; // Aggiunto per tenere traccia del file DNG temporaneo
}> {
  const ext = path.extname(imagePath).toLowerCase();
  const isRaw = RAW_EXTENSIONS.includes(ext);

  if (isRaw) {
    console.log(`Preprocessing RAW file: ${imagePath}`);
    try {
      // Crea percorsi per file temporanei
      const tmp = require('os').tmpdir();
      const outputJpeg = path.join(tmp, `racetagger_raw_${Date.now()}_${Math.random().toString(36).substring(2,8)}.jpg`);
      
      // Primo passo: converti RAW in DNG
      const baseFilename = path.basename(imagePath, path.extname(imagePath));
      const dngFilePath = path.join(path.dirname(imagePath), `${baseFilename}.dng`);
      
      try {
        // Tenta di usare il metodo ottimizzato
        await rawConverter.convertRawToDng(imagePath, dngFilePath);
        
        // Secondo passo: usa il metodo ottimizzato per convertire DNG in JPEG
        const extractedPath = await rawConverter.convertDngToJpegOptimized(
          dngFilePath, 
          outputJpeg, 
          95,        // Alta qualità JPEG
          1440       // Limita il lato lungo a 1440px (preset dell'app)
        );
        console.log(`Successfully converted RAW to full-resolution JPEG using optimized method: ${extractedPath}`);
        
        const buffer = await fsPromises.readFile(extractedPath);
        
        let xmpPath = null;
        if (xmpSidecarExists(imagePath)) {
          xmpPath = imagePath + '.xmp';
          console.log(`Existing XMP sidecar found: ${xmpPath}`);
        }

        let previewPath = null;
        if (config && config.savePreviewImages !== false) {
          previewPath = await saveImagePreview(imagePath, buffer, config);
        }

        return {
          buffer,
          mimeType: 'image/jpeg',
          isRawConverted: true,
          originalFormat: ext.substring(1),
          xmpPath,
          previewPath,
          tempDngPath: dngFilePath // Traccia il file DNG temporaneo per la pulizia
        };
      } catch (optimizedError: any) {
        console.error(`Optimized conversion failed: ${optimizedError.message || 'Unknown error'}`);
        console.log(`Falling back to standard RAW to JPEG conversion...`);
        
        const fallbackPath = await rawConverter.convertRawToJpeg(imagePath, outputJpeg);
        console.log(`Successfully converted RAW to JPEG using fallback method: ${fallbackPath}`);
        
        const buffer = await fsPromises.readFile(fallbackPath);
        
        let xmpPath = null;
        if (xmpSidecarExists(imagePath)) {
          xmpPath = imagePath + '.xmp';
          console.log(`Existing XMP sidecar found: ${xmpPath}`);
        }

        let previewPath = null;
        if (config && config.savePreviewImages !== false) {
          previewPath = await saveImagePreview(imagePath, buffer, config);
        }

        return {
          buffer,
          mimeType: 'image/jpeg',
          isRawConverted: true,
          originalFormat: ext.substring(1),
          xmpPath,
          previewPath,
          tempDngPath: dngFilePath // Traccia il file DNG temporaneo per la pulizia (anche per fallback)
        };
      }
    } catch (error: any) {
      console.error(`Error preprocessing RAW file: ${error.message}`);
      throw new Error(`Failed to process RAW file: ${error.message}`);
    }
  } else {
    // File standard (JPEG, PNG, etc.)
    console.log(`[DEBUG] Preprocessing standard file: ${imagePath}`);
    const originalFileBuffer = await fsPromises.readFile(imagePath);
    console.log(`[DEBUG] Original file buffer size for ${path.basename(imagePath)}: ${originalFileBuffer.length} bytes`);

    try {
      // Controlla se il resize è abilitato nella configurazione utente
      const resizeConfig = config?.resize;
      const shouldResize = resizeConfig?.enabled && resizeConfig.preset;
      
      console.log(`[DEBUG] Resize config for ${path.basename(imagePath)}:`, resizeConfig);
      console.log(`[DEBUG] Should resize: ${shouldResize}`);
      
      let buffer: Buffer;
      let tempServiceFilePath: string | undefined;
      
      if (shouldResize) {
        // Applica resize in base alla configurazione utente
        console.log(`[DEBUG] Applying user resize with preset: ${resizeConfig.preset}`);
        
        const preset = resizeConfig.preset;
        const presetConfig = RESIZE_PRESETS[preset as ResizePreset];
        
        if (presetConfig) {
          const processor = await createImageProcessor(originalFileBuffer);
          const metadata = await processor.metadata();
          const { width = 0, height = 0 } = metadata;
          
          console.log(`[DEBUG] Original dimensions: ${width}x${height}, target: ${presetConfig.maxDimension}px`);
          
          // Verifica se è necessario ridimensionare
          const maxDimension = Math.max(width, height);
          const needsResize = maxDimension > presetConfig.maxDimension;
          
          if (needsResize) {
            // Calcola nuove dimensioni mantenendo aspect ratio
            let newWidth, newHeight;
            if (width > height) {
              newWidth = presetConfig.maxDimension;
              newHeight = Math.round((height * presetConfig.maxDimension) / width);
            } else {
              newHeight = presetConfig.maxDimension;
              newWidth = Math.round((width * presetConfig.maxDimension) / height);
            }
            
            console.log(`[DEBUG] Resizing from ${width}x${height} to ${newWidth}x${newHeight} (quality: ${presetConfig.jpegQuality}%)`);
            
            buffer = await processor
              .resize(newWidth, newHeight, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: presetConfig.jpegQuality, progressive: true })
              .toBuffer();
              
            console.log(`[DEBUG] Resized buffer size: ${buffer.length} bytes`);
          } else {
            console.log(`[DEBUG] Image already smaller than target, no resize needed`);
            buffer = originalFileBuffer;
          }
        } else {
          console.warn(`[WARN] Unknown resize preset: ${preset}, using original`);
          buffer = originalFileBuffer;
        }
      } else {
        console.log(`[DEBUG] Resize disabled, using original image`);
        buffer = originalFileBuffer;
      }
      
      // Crea sempre un file di servizio per l'analisi (ridimensionato per velocità)
      const tempDir = path.join(require('os').tmpdir(), 'racetagger-previews');
      await fsPromises.mkdir(tempDir, { recursive: true });
      tempServiceFilePath = path.join(tempDir, `service-${Date.now()}-${path.basename(imagePath)}.jpg`);

      const serviceProcessor = await createImageProcessor(originalFileBuffer);
      const serviceBuffer = await serviceProcessor
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();

      await fsPromises.writeFile(tempServiceFilePath, serviceBuffer);
      console.log(`[DEBUG] Service file created: ${tempServiceFilePath} (${serviceBuffer.length} bytes)`);

      return {
        buffer, // Buffer per upload (possibilmente ridimensionato)
        mimeType: 'image/jpeg',
        isRawConverted: false,
        originalFormat: null,
        xmpPath: null,
        tempServiceFilePath, // File di servizio per analisi
        tempDngPath: null // Non c'è DNG per i file standard
      };
    } catch (error) {
      console.error(`[ERROR] Failed to process image ${imagePath}:`, error);
      // Fallback: usa il file originale
      console.warn('[WARN] Image processing failed. Using original file.');
      return { buffer: originalFileBuffer, mimeType: 'image/jpeg', isRawConverted: false, originalFormat: null, xmpPath: null, tempDngPath: null };
    }
  }
}

// Handler per la cancellazione del batch processing
function handleCancelBatchProcessing() {
  console.log('[Main Process] Batch processing cancellation requested');
  batchProcessingCancelled = true;

  // Trigger cleanup of temporary files in UnifiedImageProcessor
  try {
    if (unifiedImageProcessor) {
      // The processor will check the cancellation flag and stop processing
      // Individual workers will clean up their own temporary files
      console.log('[Main Process] Unified processor will handle cancellation and cleanup');
    }
  } catch (error: any) {
    console.error('[Main Process] Error during cancellation cleanup:', error);
  }

  safeSend('batch-cancelled', {
    message: 'Processing has been cancelled by user request'
  });
}

// Handler per il nuovo unified image processor
/**
 * Traccia le impostazioni di un'execution usando l'Edge Function di Supabase
 * Questo metodo è asincrono e non blocca l'execution principale
 */
async function trackExecutionSettings(
  executionId: string,
  config: BatchProcessConfig,
  stats?: {
    totalImages?: number;
    totalRawFiles?: number;
    totalStandardFiles?: number;
    executionDurationMs?: number;
    averageImageProcessingTimeMs?: number;
  }
): Promise<void> {
  try {
    const authState = authService.getAuthState();
    if (!authState.isAuthenticated || !authState.session) {
      console.warn('[Tracking] User not authenticated, skipping execution settings tracking');
      return;
    }

    // Import system info utilities
    const { getSystemInfo } = await import('./utils/system-info');
    const { mapConfigToExecutionSettings, validateExecutionSettings } = await import('./types/execution-settings');
    const { PERFORMANCE_CONFIG } = await import('./config');

    // Collect comprehensive system information
    const systemInfo = getSystemInfo();
    const userId = authState.session.user.id;

    // Map all configuration and stats to execution settings format
    let executionSettings = mapConfigToExecutionSettings(
      executionId,
      userId,
      config,
      systemInfo,
      stats
    );

    // Add performance configuration from global config
    executionSettings = {
      ...executionSettings,
      optimization_level: PERFORMANCE_CONFIG?.level || 'normal',
      performance_monitoring_enabled: PERFORMANCE_CONFIG?.enablePerformanceMonitoring !== false,
      session_resume_enabled: PERFORMANCE_CONFIG?.enableSessionResume !== false,
      connection_pooling_enabled: PERFORMANCE_CONFIG?.enableConnectionPooling === true,
      raw_optimizations_enabled: PERFORMANCE_CONFIG?.enableRawOptimizations === true,
      raw_cache_enabled: PERFORMANCE_CONFIG?.enableRawCache === true,
      raw_batch_size: PERFORMANCE_CONFIG?.rawBatchSize,
      max_memory_usage_mb: PERFORMANCE_CONFIG?.maxMemoryUsageMB,
      memory_optimizations_enabled: PERFORMANCE_CONFIG?.enableMemoryOptimizations === true,
      memory_pooling_enabled: PERFORMANCE_CONFIG?.enableMemoryPooling === true,
      cpu_optimizations_enabled: PERFORMANCE_CONFIG?.enableCpuOptimizations === true,
      streaming_processing_enabled: PERFORMANCE_CONFIG?.enableStreamingProcessing === true,
      auto_tuning_enabled: PERFORMANCE_CONFIG?.enableAutoTuning === true,
      predictive_loading_enabled: PERFORMANCE_CONFIG?.enablePredictiveLoading === true,
      async_file_ops_enabled: PERFORMANCE_CONFIG?.enableAsyncFileOps === true,
      database_optimizations_enabled: PERFORMANCE_CONFIG?.enableDatabaseOptimizations === true,
      batch_operations_enabled: PERFORMANCE_CONFIG?.enableBatchOperations === true,
      storage_optimizations_enabled: PERFORMANCE_CONFIG?.enableStorageOptimizations === true,
      // Additional performance settings from config
      rate_limit_per_second: PERFORMANCE_CONFIG?.rateLimitPerSecond,
      max_concurrent_uploads: PERFORMANCE_CONFIG?.maxConcurrentUploads || executionSettings.max_concurrent_uploads,
      max_concurrent_analysis: PERFORMANCE_CONFIG?.maxConcurrentAnalysis || executionSettings.max_concurrent_analysis
    };

    // Validate the data before sending
    const validation = validateExecutionSettings(executionSettings);
    if (!validation.isValid) {
      console.warn('[Tracking] Invalid execution settings data:', validation.errors);
      // Continue with tracking but log validation issues
    }

    console.log('[Tracking] Sending comprehensive execution settings:', {
      execution_id: executionSettings.execution_id,
      client_version: executionSettings.client_version,
      operating_system: executionSettings.operating_system,
      ai_model: executionSettings.ai_model,
      sport_category: executionSettings.sport_category,
      total_images: executionSettings.total_images_processed,
      csv_used: executionSettings.csv_data_used,
      performance_enabled: executionSettings.parallel_processing_enabled
    });

    // Send to edge function
    const client = getSupabaseClient();
    const { data, error } = await client.functions.invoke('track-execution-settings', {
      body: {
        execution_settings: executionSettings,
        validation_info: validation
      },
      headers: {
        'Authorization': `Bearer ${authState.session.access_token}`
      }
    });

    if (error) {
      console.warn('[Tracking] Failed to track execution settings:', error.message);
      // Log specific field that might be causing issues
      if (error.message?.includes('validation')) {
        console.warn('[Tracking] Validation errors:', validation.errors);
      }
    } else {
      console.log('[Tracking] Comprehensive execution settings tracked successfully');
      if (data?.inserted_fields) {
        console.log('[Tracking] Fields successfully inserted:', data.inserted_fields);
      }
    }

  } catch (error) {
    console.warn('[Tracking] Error tracking execution settings:', error);
    // Non propaghiamo l'errore per non bloccare l'execution principale
  }
}

async function handleUnifiedImageProcessing(event: IpcMainEvent, config: BatchProcessConfig) {
  console.log('[Main Process] handleUnifiedImageProcessing called with config:', config);

  // Log participant preset usage
  if (config.participantPreset) {
    console.log(`[Main Process] Using participant preset "${config.participantPreset.name}" with ${config.participantPreset.participants?.length || 0} participants`);
  } else {
    console.log('[Main Process] No participant preset selected, using CSV data if available');
  }

  if (!mainWindow) {
    console.error('handleUnifiedImageProcessing: mainWindow is null');
    return;
  }
  
  // Statistiche per il tracciamento
  let executionStats = {
    totalImages: 0,
    totalRawFiles: 0,
    totalStandardFiles: 0,
    executionDurationMs: 0,
    averageImageProcessingTimeMs: 0
  };
  
  const executionStartTime = Date.now();
  let currentExecutionId: string | null = null;

  // Crea sempre un'execution per tracciare questa operazione se l'utente è autenticato
  if (authService.getAuthState().isAuthenticated) {
    try {
      // Determina il nome dell'execution
      const executionName = config.executionName || `Analysis_${new Date().toISOString().replace(/[:.]/g, '-')}`;
      
      const newExecution = await createExecutionOnline({
        project_id: config.projectId || null, // NULL per executions standalone
        name: executionName,
        execution_at: new Date().toISOString(),
        status: 'running'
      });
      currentExecutionId = newExecution.id!;
      console.log(`[Tracking] Created ${config.projectId ? 'project' : 'standalone'} execution ${currentExecutionId} for tracking`);
    } catch (error: any) {
      if (error?.code === '23502' && error?.message?.includes('project_id')) {
        console.warn('[Tracking] ⚠️  Database migration needed: project_id field must be made nullable for standalone executions');
        console.warn('[Tracking] 📝 Run: ALTER TABLE executions ALTER COLUMN project_id DROP NOT NULL;');
        console.warn('[Tracking] 🔄 Skipping execution tracking until database is updated...');
      } else {
        console.warn('[Tracking] Failed to create execution for tracking:', error);
      }
    }
  }
  
  try {
    const { folderPath, updateExif, csvData } = config;

    // Verifica se la cartella esiste (async check)
    try {
      await fsPromises.access(folderPath, fs.constants.F_OK);
    } catch {
      throw new Error(`Folder not found: ${folderPath}`);
    }

    // Leggi i file dalla cartella e ottieni i loro timestamp per ordinarli cronologicamente
    console.log('[Main Process] Reading files and extracting timestamps for temporal ordering...');
    const files = await fsPromises.readdir(folderPath);

    // Prima filtra i file supportati
    const supportedFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ALL_SUPPORTED_EXTENSIONS.includes(ext);
    });

    // CRITICAL FIX: Ottieni stats in parallelo invece di sequenzialmente
    const filesWithStatsUnsorted = await Promise.all(
      supportedFiles.map(async (file) => {
        const fullPath = path.join(folderPath, file);
        try {
          const stats = await fsPromises.stat(fullPath);
          // Usa birthtime (data creazione) se disponibile, altrimenti mtime (data modifica)
          const timestamp = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
          return {
            file,
            path: fullPath,
            timestamp,
            isRaw: RAW_EXTENSIONS.includes(path.extname(file).toLowerCase())
          };
        } catch (error) {
          console.warn(`[Main Process] Could not get stats for ${file}, using current time as fallback`);
          return {
            file,
            path: fullPath,
            timestamp: Date.now(),
            isRaw: RAW_EXTENSIONS.includes(path.extname(file).toLowerCase())
          };
        }
      })
    );

    // Sort AFTER all stats are collected
    const filesWithTimestamps = filesWithStatsUnsorted.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Main Process] Files sorted by timestamp. Sample order (first 5):`,
      filesWithTimestamps.slice(0, 5).map(f => `${f.file} (${new Date(f.timestamp).toISOString()})`));

    // Ora mappa i file ordinati alla struttura UnifiedImageFile
    const imageFiles: UnifiedImageFile[] = filesWithTimestamps.map((item, index) => ({
      id: `img_${index}_${Date.now()}`,
      originalPath: item.path,
      fileName: item.file,
      isRaw: item.isRaw,
      originalFormat: path.extname(item.file).toLowerCase()
    }));

    // Aggiorna le statistiche
    executionStats.totalImages = imageFiles.length;
    executionStats.totalRawFiles = imageFiles.filter(f => f.isRaw).length;
    executionStats.totalStandardFiles = imageFiles.filter(f => !f.isRaw).length;

    if (imageFiles.length === 0) {
      throw new Error('No supported image files found in the selected folder');
    }

    console.log(`[Main Process] Found ${imageFiles.length} images (${imageFiles.filter(f => f.isRaw).length} RAW, ${imageFiles.filter(f => !f.isRaw).length} JPEG/PNG)`);
    
    // Setup event listeners per progress tracking
    unifiedImageProcessor.removeAllListeners(); // Clear existing listeners

    // Temporal analysis progress events
    unifiedImageProcessor.on('temporal-analysis-started', (data: any) => {
      console.log(`[Main Process] Temporal analysis started: ${data.totalImages} images`);
      safeSend('temporal-analysis-started', data);
    });

    unifiedImageProcessor.on('temporal-batch-progress', (data: any) => {
      console.log(`[Main Process] Temporal batch progress: ${data.processed}/${data.total} (batch ${data.currentBatch}/${data.totalBatches})`);
      safeSend('temporal-batch-progress', data);
    });

    unifiedImageProcessor.on('temporal-analysis-complete', (data: any) => {
      console.log(`[Main Process] Temporal analysis complete: ${data.processedImages}/${data.totalImages} processed, ${data.excludedImages} excluded, ${data.totalClusters} clusters`);
      safeSend('temporal-analysis-complete', data);
    });

    unifiedImageProcessor.on('recognition-phase-started', (data: any) => {
      console.log(`[Main Process] Recognition phase started: ${data.totalImages} images`);
      safeSend('recognition-phase-started', data);
    });

    unifiedImageProcessor.on('imageProcessed', (result: UnifiedProcessingResult & { processed: number; total: number; phase?: string; step?: number; totalSteps?: number; progress?: number }) => {
      console.log(`[Main Process] Unified processor completed: ${result.fileName} (${result.processed}/${result.total})`);
      console.log(`[Main Process] Analysis data:`, result.analysis ? `${result.analysis.length} vehicles` : 'NO ANALYSIS');
      
      // DEBUG: Log result structure to identify analysis field issues
      console.log(`🔥 [Main Process] DEBUG result structure for ${result.fileName}:`, {
        hasResult: !!result,
        resultKeys: result ? Object.keys(result) : [],
        hasAnalysis: !!result.analysis,
        analysisType: typeof result.analysis,
        analysisIsArray: Array.isArray(result.analysis),
        analysisLength: Array.isArray(result.analysis) ? result.analysis.length : 'not array',
        analysisContent: result.analysis ? JSON.stringify(result.analysis) : 'undefined/null'
      });

      // Fix: Check both result.analysis and fallback to empty array for edge function v2 compatibility
      const analysis = result.analysis || [];

      console.log(`🔥 [Main Process] Final analysis being sent for ${result.fileName}:`, {
        analysisLength: Array.isArray(analysis) ? analysis.length : 'not array',
        analysisContent: analysis ? JSON.stringify(analysis) : 'undefined/null'
      });

      safeSend('image-processed', {
        fileName: result.fileName,
        imagePath: result.originalPath,
        analysis: analysis,
        csvMatch: result.csvMatch || null,
        error: result.error,
        processingTimeMs: result.processingTimeMs,
        metatagApplied: true,
        previewDataUrl: result.previewDataUrl,
        // Progress tracking for UI
        processed: result.processed,
        total: result.total,
        // Phase information for 2-step progress
        phase: result.phase,
        step: result.step,
        totalSteps: result.totalSteps,
        progress: result.progress
      });
    });
    
    unifiedImageProcessor.on('batchComplete', (summary: { successful: number; errors: number; total: number }) => {
      console.log(`[Main Process] Unified processor batch completed: ${summary.successful}/${summary.total} successful`);
      // REMOVED: Don't send summary as batch-complete, it confuses the renderer
      // The actual results array will be sent after processBatch() completes at line 1460
      /* safeSend('batch-complete', {
        successful: summary.successful,
        errors: summary.errors,
        total: summary.total
      }); */
    });
    
    // Listen for uploaded images to cache their Supabase URLs (for RAW thumbnails)
    unifiedImageProcessor.on('image-uploaded', (data: { originalFileName: string; publicUrl: string }) => {
      console.log(`🖼️ [Main Process] Caching Supabase URL for ${data.originalFileName}: ${data.publicUrl}`);
      
      // We need to find the original file path for this filename
      // Since we have the filename, we'll cache it by filename for now
      // and during get-local-image we'll try to match by filename
      supabaseImageUrlCache.set(data.originalFileName, data.publicUrl);
      
      console.log(`🖼️ [Main Process] Cache now has ${supabaseImageUrlCache.size} entries`);
    });
    
    // Get folder organization config from renderer
    let folderOrgConfig: FolderOrganizerConfig | undefined = undefined;
    
    if (authService.hasFolderOrganizationAccess() && config.folderOrganization) {
      try {
        // Use folder organization config from frontend
        // Use custom destination path if provided, otherwise default to source folder
        const destinationPath = config.folderOrganization.destinationPath
          ? config.folderOrganization.destinationPath
          : path.join(folderPath, 'Organized_Photos');

        folderOrgConfig = {
          enabled: APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION && config.folderOrganization.enabled,
          mode: config.folderOrganization.mode || 'copy',
          pattern: config.folderOrganization.pattern || 'number',
          customPattern: config.folderOrganization.customPattern,
          createUnknownFolder: config.folderOrganization.createUnknownFolder !== false,
          unknownFolderName: config.folderOrganization.unknownFolderName || 'Unknown_Numbers',
          includeXmpFiles: config.folderOrganization.includeXmpFiles !== false,
          destinationPath: destinationPath,
          conflictStrategy: config.folderOrganization.conflictStrategy || 'rename'
        };
        console.log('[Main Process] Using folder organization config from frontend:', folderOrgConfig);
      } catch (error) {
        console.log('[Main Process] Could not get folder organization config, feature disabled');
      }
    } else if (!authService.hasFolderOrganizationAccess()) {
      console.log('[Main Process] User does not have folder organization access');
    } else if (!config.folderOrganization) {
      console.log('[Main Process] No folder organization config provided by frontend');
    }

    // Apply resize configuration from config if provided
    let resizeConfig: { jpegQuality: number; maxDimension: number } | undefined;
    if (config.resize && config.resize.enabled && config.resize.preset) {
      const presetConfig = RESIZE_PRESETS[config.resize.preset as ResizePreset];
      if (presetConfig) {
        resizeConfig = {
          jpegQuality: presetConfig.jpegQuality,
          maxDimension: presetConfig.maxDimension
        };
        console.log(`[Main Process] Using resize preset '${config.resize.preset}': quality=${presetConfig.jpegQuality}%, maxDim=${presetConfig.maxDimension}px`);
      } else {
        console.warn(`[Main Process] Unknown resize preset '${config.resize.preset}', using default configuration`);
      }
    }

    // DEBUG: Log config details before passing to processor
    const processorConfig = {
      csvData: csvData || [],
      category: config.category || 'motorsport',
      executionId: currentExecutionId || undefined, // Pass execution_id to link images to this execution
      participantPresetData: config.participantPreset?.participants || [], // Pass participant data directly to workers
      folderOrganization: folderOrgConfig,
      keywordsMode: config.keywordsMode || 'append', // How to handle existing keywords
      descriptionMode: config.descriptionMode || 'append', // How to handle existing description
      // Apply resize configuration if provided
      ...(resizeConfig && resizeConfig),
      // Add cancellation support
      isCancelled: () => batchProcessingCancelled,
      onTokenUsed: (tokenBalance: any) => {
        console.log(`[Main Process] UnifiedProcessor token callback received:`, tokenBalance);
        if (mainWindow) {
          mainWindow.webContents.send('token-used', tokenBalance);
          console.log(`[Main Process] token-used event sent to frontend from UnifiedProcessor`);
        }
      }
    };

    console.log(`[Main Process] Configuring UnifiedProcessor with:`, {
      participantPresetDataLength: processorConfig.participantPresetData?.length || 0,
      executionId: processorConfig.executionId,
      category: processorConfig.category,
      csvDataLength: processorConfig.csvData?.length || 0,
      hasParticipantPreset: !!config.participantPreset,
      participantPresetName: config.participantPreset?.name,
      keywordsMode: processorConfig.keywordsMode,
      descriptionMode: processorConfig.descriptionMode
    });

    // Configura il processor con i parametri necessari
    unifiedImageProcessor.updateConfig(processorConfig);
    
    console.log(`[Main Process] Starting unified processing with 4 workers, csvData: ${csvData?.length || 0} rows`);

    // Start new temporal analysis session for unified processing
    const { SmartMatcher } = await import('./matching/smart-matcher');
    SmartMatcher.startSession();
    console.log('[Main Process] New unified processing session started');

    // Emit telemetry start event for UI (immediate + via event sender for redundancy)
    console.log('[Main Process] Sending unified-processing-started with total:', imageFiles.length);
    safeSend('unified-processing-started', {
      totalFiles: imageFiles.length
    });
    
    // Also send via event sender for redundancy
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('unified-processing-started', {
        totalFiles: imageFiles.length
      });
    }

    // CRITICAL FIX: Don't await - run processing in background to keep UI responsive
    // This prevents the main thread from blocking during long processing operations
    unifiedImageProcessor.processBatch(imageFiles)
      .then(async (results) => {
        console.log(`[Main Process] Unified processing completed: ${results.length} results`);

        // End temporal analysis session
        const { SmartMatcher: SmartMatcherEnd2 } = await import('./matching/smart-matcher');
        SmartMatcherEnd2.endSession();

        // Calcola le statistiche finali per il tracciamento
        executionStats.executionDurationMs = Date.now() - executionStartTime;
        executionStats.averageImageProcessingTimeMs = results.length > 0
          ? executionStats.executionDurationMs / results.length
          : 0;

        // Aggiorna status execution se creata
        if (currentExecutionId) {
          try {
            await updateExecutionOnline(currentExecutionId, {
              status: 'completed',
              results_reference: `${results.length} images processed`
            });
            console.log(`[Tracking] Updated execution ${currentExecutionId} status to completed`);
          } catch (error) {
            console.warn('[Tracking] Failed to update execution status:', error);
          }
        }

        // Traccia le impostazioni di questa execution (asincrono, non bloccante)
        if (currentExecutionId) {
          trackExecutionSettings(currentExecutionId, config, executionStats).catch(error => {
            console.warn('[Tracking] Failed to track execution settings:', error);
          });
        }

        // Send the actual results array to the renderer with execution ID for log visualizer
        safeSend('batch-complete', {
          results,
          executionId: currentExecutionId,
          isProcessingComplete: true
        });
      })
      .catch(async (error) => {
        console.error('[Main Process] Unified processing error:', error);

        // Aggiorna status execution in caso di errore
        if (currentExecutionId) {
          try {
            await updateExecutionOnline(currentExecutionId, {
              status: 'failed',
              results_reference: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
            console.log(`[Tracking] Updated execution ${currentExecutionId} status to failed`);
          } catch (updateError) {
            console.warn('[Tracking] Failed to update execution status on error:', updateError);
          }

          // Traccia comunque le impostazioni anche in caso di errore
          executionStats.executionDurationMs = Date.now() - executionStartTime;
          trackExecutionSettings(currentExecutionId, config, executionStats).catch(trackError => {
            console.warn('[Tracking] Failed to track execution settings on error:', trackError);
          });
        }

        safeSend('processing-error', {
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          details: error
        });
      });

    // IMPORTANT: Function returns immediately here, processing continues in background
  } catch (error) {
    // This catch only handles errors in setup, not in processing
    console.error('[Main Process] Unified processing setup error:', error);
    safeSend('processing-error', {
      error: error instanceof Error ? error.message : 'Failed to start processing',
      details: error
    });
  }
}

async function handleFolderAnalysis(event: IpcMainEvent, config: BatchProcessConfig) {
  console.log('[Main Process] handleFolderAnalysis called with config:', config);
  
  // Reset cancellation flag
  batchProcessingCancelled = false;
  
  // Statistiche per il tracciamento
  let executionStats = {
    totalImages: 0,
    totalRawFiles: 0,
    totalStandardFiles: 0,
    executionDurationMs: 0,
    averageImageProcessingTimeMs: 0
  };
  
  const executionStartTime = Date.now();
  let currentExecutionId: string | null = null;

  // Crea sempre un'execution per tracciare questa operazione se l'utente è autenticato
  if (authService.getAuthState().isAuthenticated) {
    try {
      // Determina il nome dell'execution
      const executionName = config.executionName || `Folder_Analysis_${new Date().toISOString().replace(/[:.]/g, '-')}`;
      
      const newExecution = await createExecutionOnline({
        project_id: config.projectId || null, // NULL per executions standalone
        name: executionName,
        execution_at: new Date().toISOString(),
        status: 'running'
      });
      currentExecutionId = newExecution.id!;
      console.log(`[Tracking] Created ${config.projectId ? 'project' : 'standalone'} execution ${currentExecutionId} for folder analysis tracking`);
    } catch (error: any) {
      if (error?.code === '23502' && error?.message?.includes('project_id')) {
        console.warn('[Tracking] ⚠️  Database migration needed: project_id field must be made nullable for standalone executions');
        console.warn('[Tracking] 📝 Run: ALTER TABLE executions ALTER COLUMN project_id DROP NOT NULL;');
        console.warn('[Tracking] 🔄 Skipping execution tracking until database is updated...');
      } else {
        console.warn('[Tracking] Failed to create execution for tracking:', error);
      }
    }
  }
  
  if (!mainWindow) {
    console.error('handleFolderAnalysis: mainWindow is null');
    return;
  }
  
  try {
    const { folderPath, updateExif } = config;
    
    // Verifica se la cartella esiste
    if (!fs.existsSync(folderPath)) {
      throw new Error(`La cartella ${folderPath} non esiste`);
    }
    
    // Ottieni la lista delle immagini nella cartella
    const imageFiles = await getImagesFromFolder(folderPath);
    if (imageFiles.length === 0) {
      throw new Error('Nessuna immagine trovata nella cartella selezionata');
    }

    // Aggiorna le statistiche
    executionStats.totalImages = imageFiles.length;
    executionStats.totalRawFiles = imageFiles.filter(img => img.isRaw).length;
    executionStats.totalStandardFiles = imageFiles.filter(img => !img.isRaw).length;
    
    // Verifica token balance
    const canProcessImages = await authService.canUseToken(imageFiles.length);
    if (!canProcessImages) {
      safeSend('upload-error', `Token insufficienti per elaborare ${imageFiles.length} immagini`);
      return;
    }
    
    // Inizializza il conteggio delle immagini processate
    let processedCount = 0;
    const totalImages = imageFiles.length;
    const startTime = Date.now();
    
    // Inizializza l'enhanced processor nel renderer
    // Inizializza l'enhanced processor nel renderer
    safeSend('enhanced-processing-start', {
      totalImages: totalImages
    });
    
    // Invia l'aggiornamento iniziale del progresso per compatibilità
    safeSend('batch-progress', {
      total: totalImages,
      current: processedCount,
      message: 'Starting batch analysis...'
    });
    
    // Usa i dati CSV se disponibili (sia da config che da globalCsvData o csvData standalone)
    // Prima controlla csvData (standalone), poi globalCsvData (integrato)
    const csvDataToUse = config.csvData || csvData.length > 0 ? csvData : globalCsvData;
    const hasCsvData = csvDataToUse && csvDataToUse.length > 0;
    
    console.log(`Batch processing ${totalImages} images${hasCsvData ? ' with CSV data' : ''}`);

    // Start new temporal analysis session for batch processing
    const { SmartMatcher } = await import('./matching/smart-matcher');
    SmartMatcher.startSession();
    console.log('[Main Process] New batch processing session started');

    // Risultati dell'analisi
    const batchResults = [];
    
    // Processa ogni immagine
    for (const imageInfo of imageFiles) {
      // Controlla se il processing è stato cancellato
      if (batchProcessingCancelled) {
        console.log('[Main Process] Batch processing cancelled, stopping at image:', path.basename(imageInfo.path));
        break;
      }
      
      try {
        const imagePath = imageInfo.path;
        const fileName = path.basename(imagePath);
        const isRaw = imageInfo.isRaw;
        
        // Notifica l'inizio del processing di questa immagine
        mainWindow.webContents.send('enhanced-processing-update-image', {
          imageName: fileName,
          status: '🔄'
        });
        
        // Pre-elabora l'immagine se necessario (estrai preview da RAW, ecc.)
        const imageStartTime = Date.now();
        const { buffer: fileBuffer, mimeType, isRawConverted, originalFormat, xmpPath, previewPath, tempServiceFilePath, tempDngPath } = 
          await preprocessImageIfNeeded(imagePath, config);
        
        const fileSize = fileBuffer.length;
        
        // Aggiorna il conteggio dopo aver iniziato il processing
        processedCount++;
        
        // Aggiorna il messaggio di progresso per indicare se è un file RAW
        const progressMessage = isRaw 
          ? `Processing RAW file: ${fileName} (${processedCount}/${totalImages})` 
          : `Processing ${fileName} (${processedCount}/${totalImages})`;
        
        // Send batch-progress with preview to sync progress button and preview simultaneously
        const batchPreviewDataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
        safeSend('batch-progress', {
          total: totalImages,
          current: processedCount,
          message: progressMessage,
          currentFile: {
            name: fileName,
            isRaw: isRaw
          },
          previewDataUrl: batchPreviewDataUrl
        });
        
        // Carica l'immagine su Supabase Storage
        // Per i file RAW, usiamo sempre .jpeg come estensione per lo storage
        let fileExtForStorage = isRawConverted ? 'jpeg' : path.extname(fileName).substring(1);
        if (fileExtForStorage === 'jpg') fileExtForStorage = 'jpeg';
        
        const storageFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExtForStorage}`;
        
        const { error: uploadError } = await supabase.storage
          .from('uploaded-images')
          .upload(storageFileName, fileBuffer, {
            cacheControl: '3600',
            upsert: false,
            contentType: mimeType
          });

        // Pulisci il file di servizio temporaneo se è stato creato
        if (tempServiceFilePath) {
          try {
            await fsPromises.unlink(tempServiceFilePath);
            console.log(`[DEBUG] Cleaned up service file: ${tempServiceFilePath}`);
          } catch (cleanupError) {
            console.error(`[ERROR] Failed to clean up service file ${tempServiceFilePath}:`, cleanupError);
          }
        }
        
        if (uploadError) {
          console.error(`Upload error for ${fileName}:`, uploadError);
          throw new Error(`Upload failed for ${fileName}: ${uploadError.message}`);
        }
        
        // Ottieni l'ID utente corrente se autenticato
        const authState = authService.getAuthState();
        const userId = authState.isAuthenticated ? authState.user?.id : null;
        
        // Prepara il corpo della richiesta
        const invokeBody: any = {
          imagePath: storageFileName,
          originalFilename: fileName,
          mimeType: mimeType,
          sizeBytes: fileSize,
          modelName: config.model || APP_CONFIG.defaultModel,
          category: config.category || 'motorsport'
        };
        
        console.log(`Using model for batch analysis: ${invokeBody.modelName}, category: ${invokeBody.category}`);
        
        // Aggiungi l'userId solo se è disponibile
        if (userId) {
          invokeBody.userId = userId;
        }
        
        // Invoca la Edge Function per l'analisi con retry logic
        let response: any = null;
        let lastError = null;
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Add delay between retries to avoid overwhelming the function
            if (attempt > 1) {
              console.log(`Retry attempt ${attempt} for ${fileName}...`);
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
            }
            
            console.log(`Invoking analyzeImageDesktopV2 for ${fileName} (attempt ${attempt}/${maxRetries})...`);
            
            // Add timeout to prevent hanging indefinitely
            const functionTimeout = 60000; // 60 seconds timeout
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error(`Function invocation timed out after ${functionTimeout/1000} seconds`)), functionTimeout);
            });
            
            const invokePromise = supabase.functions.invoke(
              'analyzeImageDesktopV2',
              { body: invokeBody }
            );
            
            // Race between the invocation and the timeout
            response = await Promise.race([invokePromise, timeoutPromise]) as any;
            
            // Check for errors
            if (response.error) {
              console.error(`Function error for ${fileName} (attempt ${attempt}/${maxRetries}):`, response.error);
              throw new Error(`Analysis failed: ${response.error.message || 'Unknown error'}`);
            }
            
            if (!response.data.success) {
              console.error(`Function returned unsuccessful response for ${fileName} (attempt ${attempt}/${maxRetries}):`, response.data.error);
              throw new Error(`Analysis failed: ${response.data.error || 'Unknown function error'}`);
            }
            
            // If we got here, the function call succeeded
            console.log(`Successfully analyzed ${fileName} on attempt ${attempt}`);
            break;
            
          } catch (err: any) {
            lastError = err;
            console.error(`Error on attempt ${attempt}/${maxRetries} for ${fileName}:`, err.message);
            
            // If this is our last attempt, propagate the error
            if (attempt === maxRetries) {
              throw new Error(`Analysis failed after ${maxRetries} attempts: ${err.message}`);
            }
            // Otherwise, continue to the next retry attempt
          }
        }
        
        if (!response || !response.data || !response.data.success) {
          throw new Error(`Analysis failed for ${fileName}: ${lastError?.message || 'Unknown error'}`);
        }
        
        // Registra l'utilizzo del token e invia l'aggiornamento in tempo reale
        await authService.useTokens(1, response.data.imageId, (tokenBalance) => {
          console.log(`[Main Process] Token callback received, sending token-used event:`, tokenBalance);
          if (mainWindow) {
            mainWindow.webContents.send('token-used', tokenBalance);
            console.log(`[Main Process] token-used event sent to frontend`);
          } else {
            console.log(`[Main Process] Cannot send token-used event: mainWindow is null`);
          }
        });
        
        // Calcola il tempo di processing per questa immagine
        const processingTime = Date.now() - imageStartTime;
        
        // Determina se c'è una detection
        const hasDetection = response.data.analysis && response.data.analysis.length > 0 && 
          response.data.analysis.some((item: any) => item.raceNumber || (item.drivers && item.drivers.length > 0));
        
        // Notifica il completamento dell'immagine
        mainWindow.webContents.send('enhanced-processing-complete-image', {
          imageName: fileName,
          hasDetection: hasDetection,
          processingTime: processingTime
        });
        
        // Cerca corrispondenze nel CSV se disponibile
        let csvMatch = null;
        if (hasCsvData && Array.isArray(response.data.analysis) && response.data.analysis.length > 0) {
          const firstVehicle = response.data.analysis[0];
          
          if (firstVehicle.raceNumber) {
            // Cerca per numero di gara
            const matchByNumber = csvData.find(entry => entry.numero === firstVehicle.raceNumber);
            if (matchByNumber) {
              csvMatch = {
                matchType: 'raceNumber',
                matchedValue: firstVehicle.raceNumber,
                entry: matchByNumber
              };
            }
          }
          
          // Se non trovato per numero, cerca per nome pilota
          if (!csvMatch && firstVehicle.drivers && firstVehicle.drivers.length > 0) {
            for (const driver of firstVehicle.drivers) {
              const matchByName = csvData.find(entry => 
                entry.nome && entry.nome.toLowerCase().includes(driver.toLowerCase())
              );
              
              if (matchByName) {
                csvMatch = {
                  matchType: 'driverName',
                  matchedValue: driver,
                  entry: matchByName
                };
                break;
              }
            }
          }
        }
        
        // Gestione dei metadati in base alle opzioni e alla corrispondenza CSV
        if (updateExif) {
          try {
            // Estrai i dati dell'analisi se disponibili
            const analysisData = response.data.analysis && response.data.analysis.length > 0 
              ? response.data.analysis[0] 
              : undefined;
            
            // Determina il metatag CSV se disponibile
            const csvMetatag = csvMatch?.entry?.metatag;
            
            // Passa sempre sia i dati CSV che i dati AI alla funzione di aggiornamento
            // La funzione formatMetadataByCategory gestirà le priorità internamente
            await updateImageExif(imagePath, csvMetatag, analysisData, config);
            
            if (csvMetatag) {
              console.log(`Updated metadata for ${fileName} with CSV match: ${csvMetatag}`);
            } else if (analysisData) {
              console.log(`Updated metadata for ${fileName} with AI analysis data`);
            } else {
              console.log(`Updated metadata for ${fileName} with fallback data`);
            }
            
          } catch (metadataError) {
            console.error(`Failed to update metadata for ${fileName}:`, metadataError);
            // Non interrompere il processo per errori nei metadati
          }
        }
        
        // Genera la preview data URL se disponibile
        let previewDataUrl = null;
        if (previewPath && fs.existsSync(previewPath)) {
          // Per file RAW convertiti, usa la preview salvata
          try {
            const previewBuffer = await fsPromises.readFile(previewPath);
            previewDataUrl = `data:image/jpeg;base64,${previewBuffer.toString('base64')}`;
            console.log(`Generated preview data URL from saved preview for ${fileName} (${previewBuffer.length} bytes)`);
          } catch (previewError) {
            console.error(`Error reading preview for ${fileName}:`, previewError);
          }
        } else {
          // Per file standard, usa il buffer dell'immagine processata
          try {
            const base64Data = fileBuffer.toString('base64');
            previewDataUrl = `data:${mimeType};base64,${base64Data}`;
            console.log(`Generated preview data URL from original buffer for ${fileName} (${fileBuffer.length} bytes)`);
          } catch (bufferError) {
            console.error(`Error generating preview from buffer for ${fileName}:`, bufferError);
          }
        }
        
        // Crea un oggetto risultato per questa immagine
        const imageResult = {
          fileName: fileName,
          imagePath: imagePath,
          analysis: response.data.analysis,
          imageId: response.data.imageId,
          csvMatch: csvMatch,
          metatagApplied: updateExif && csvMatch && csvMatch.entry.metatag ? true : false,
          previewDataUrl: previewDataUrl
        };
        
        // Aggiungi ai risultati batch
        batchResults.push(imageResult);
        
        // Invia aggiornamento in tempo reale al renderer
        mainWindow.webContents.send('image-processed', imageResult);
        
        // Pulisci il file DNG temporaneo se è stato creato per questa immagine
        if (tempDngPath && fs.existsSync(tempDngPath)) {
          try {
            await fsPromises.unlink(tempDngPath);
            console.log(`[DNG Cleanup] Removed temporary DNG after processing: ${tempDngPath}`);
          } catch (dngCleanupError) {
            console.error(`[DNG Cleanup] Failed to remove temporary DNG ${tempDngPath}:`, dngCleanupError);
          }
        }
        
      } catch (imageError: any) {
        console.error(`Error processing image ${imageInfo.path}:`, imageError);
        
        // Notifica il fallimento dell'immagine
        mainWindow.webContents.send('enhanced-processing-fail-image', {
          imageName: path.basename(imageInfo.path),
          error: imageError.message || 'Unknown error'
        });
        
        // Pulisci il file DNG temporaneo anche in caso di errore
        try {
          const { tempDngPath: errorTempDngPath } = await preprocessImageIfNeeded(imageInfo.path, config);
          if (errorTempDngPath && fs.existsSync(errorTempDngPath)) {
            await fsPromises.unlink(errorTempDngPath);
            console.log(`[DNG Cleanup] Removed temporary DNG after error: ${errorTempDngPath}`);
          }
        } catch (dngCleanupError) {
          console.error(`[DNG Cleanup] Failed to cleanup DNG after error for ${imageInfo.path}:`, dngCleanupError);
        }
        
        // Continua con la prossima immagine invece di interrompere tutto il batch
        batchResults.push({
          fileName: path.basename(imageInfo.path),
          imagePath: imageInfo.path,
          error: imageError.message || 'Unknown error',
          analysis: []
        });
      }
    }
    
    // Ottieni il saldo token aggiornato
    const tokenBalance = await authService.getTokenBalance();
    mainWindow.webContents.send('token-used', tokenBalance);
    
    // Calcola le statistiche finali
    const totalTime = Date.now() - startTime;
    const completedImages = batchResults.filter(result => !(result as any).error).length;
    const failedImages = batchResults.filter(result => !!(result as any).error).length;
    const detectedNumbers = batchResults.filter(result => 
      !(result as any).error && result.analysis && result.analysis.length > 0 && 
      result.analysis.some((item: any) => item.raceNumber || (item.drivers && item.drivers.length > 0))
    ).length;

    // Aggiorna le statistiche per il tracciamento
    executionStats.executionDurationMs = totalTime;
    executionStats.averageImageProcessingTimeMs = totalImages > 0 ? totalTime / totalImages : 0;

    // Aggiorna status execution se creata
    if (currentExecutionId) {
      try {
        await updateExecutionOnline(currentExecutionId, {
          status: 'completed',
          results_reference: `${completedImages}/${totalImages} images processed successfully`
        });
        console.log(`[Tracking] Updated execution ${currentExecutionId} status to completed`);
      } catch (error) {
        console.warn('[Tracking] Failed to update execution status:', error);
      }
    }

    // Traccia le impostazioni di questa execution (asincrono, non bloccante)
    if (currentExecutionId) {
      trackExecutionSettings(currentExecutionId, config, executionStats).catch(error => {
        console.warn('[Tracking] Failed to track execution settings:', error);
      });
    }
    
    // Notifica il completamento del batch processing
    mainWindow.webContents.send('enhanced-processing-complete', {
      totalImages,
      completedImages,
      failedImages,
      detectedNumbers,
      totalTime,
      tokensUsed: completedImages
    });
    
    // NOTE: DNG cleanup now happens after each individual image processing
    // No need for batch-level cleanup since files are removed immediately

    // End temporal analysis session
    const { SmartMatcher: SmartMatcherEnd } = await import('./matching/smart-matcher');
    SmartMatcherEnd.endSession();

    // Invia i risultati completi con execution ID per log visualizer
    mainWindow.webContents.send('batch-complete', {
      results: batchResults,
      executionId: currentExecutionId,
      isProcessingComplete: true // Flag per indicare che TUTTO il processing è completato
    });
    
  } catch (error: any) {
    console.error('Error during folder analysis:', error);

    // End temporal analysis session on error
    const { SmartMatcher: SmartMatcherError } = await import('./matching/smart-matcher');
    SmartMatcherError.endSession();

    // Aggiorna status execution in caso di errore
    if (currentExecutionId) {
      try {
        await updateExecutionOnline(currentExecutionId, {
          status: 'failed',
          results_reference: `Error: ${error.message || 'Unknown error'}`
        });
        console.log(`[Tracking] Updated execution ${currentExecutionId} status to failed`);
      } catch (updateError) {
        console.warn('[Tracking] Failed to update execution status on error:', updateError);
      }

      // Traccia comunque le impostazioni anche in caso di errore
      executionStats.executionDurationMs = Date.now() - executionStartTime;
      trackExecutionSettings(currentExecutionId, config, executionStats).catch(trackError => {
        console.warn('[Tracking] Failed to track execution settings on error:', trackError);
      });
    }
    
    // NOTE: DNG cleanup now happens after each individual image processing
    // Individual image errors already handle DNG cleanup in their catch blocks
    
    if (mainWindow) {
      mainWindow.webContents.send('upload-error', error.message || 'Si è verificato un errore durante l\'analisi della cartella');
    }
  }
}
/**
 * Esegue operazioni pesanti con yield per mantenere la UI responsiva
 * @param operation Funzione che esegue l'operazione pesante
 * @param description Descrizione per il logging
 */
async function executeWithYield<T>(operation: () => T, description: string): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        console.log(`[YIELD] Starting ${description}`);
        const result = operation();
        console.log(`[YIELD] Completed ${description}`);
        resolve(result);
      } catch (error) {
        console.error(`[YIELD] Error in ${description}:`, error);
        reject(error);
      }
    });
  });
}

/**
 * Esegue piexif.load in modo asincrono con yield
 */
async function loadExifAsync(dataURI: string): Promise<any> {
  return await executeWithYield(() => piexif.load(dataURI), 'EXIF parsing');
}

/**
 * Esegue piexif.insert in modo asincrono con yield
 */
async function insertExifAsync(exifBytes: any, dataURI: string): Promise<string> {
  return await executeWithYield(() => piexif.insert(exifBytes, dataURI), 'EXIF insertion');
}

/**
 * Converte base64 in modo asincrono con yield
 */
async function convertToBase64Async(imageData: string): Promise<string> {
  return await executeWithYield(() => {
    return "data:image/jpeg;base64," + Buffer.from(imageData, 'binary').toString('base64');
  }, 'base64 conversion');
}

/**
 * Converte buffer finale in modo asincrono con yield
 */
async function convertFinalBufferAsync(base64Data: string): Promise<Buffer> {
  return await executeWithYield(() => {
    return Buffer.from(base64Data, 'base64');
  }, 'final buffer conversion');
}

/**
 * Aggiunge una pausa asincrona per permettere al thread principale di elaborare altri eventi
 */
async function yieldToEventLoop(delayMs: number = 0): Promise<void> {
  return new Promise(resolve => {
    if (delayMs > 0) {
      setTimeout(resolve, delayMs);
    } else {
      setImmediate(resolve);
    }
  });
}

/**
 * Rimuove i file DNG temporanei creati durante l'elaborazione RAW
 * @param folderPath Percorso della cartella da pulire
 */
async function cleanupTemporaryDngFiles(folderPath: string): Promise<void> {
  try {
    console.log('[Main Process] Starting cleanup of temporary DNG files...');
    const files = await fsPromises.readdir(folderPath);
    let cleanedCount = 0;
    
    for (const file of files) {
      if (file.endsWith('.dng')) {
        const dngPath = path.join(folderPath, file);
        const baseNameWithoutExt = path.basename(file, '.dng');
        
        // Verifica se esiste un file RAW corrispondente
        const possibleRawFiles = RAW_EXTENSIONS
          .filter(ext => ext !== '.dng')
          .map(ext => path.join(folderPath, baseNameWithoutExt + ext));
        
        const hasCorrespondingRaw = possibleRawFiles.some(rawPath => fs.existsSync(rawPath));
        
        if (hasCorrespondingRaw) {
          try {
            await fsPromises.unlink(dngPath);
            cleanedCount++;
            console.log(`[Cleanup] Removed temporary DNG: ${dngPath}`);
          } catch (unlinkError) {
            console.warn(`[Cleanup] Failed to remove DNG file ${dngPath}:`, unlinkError);
          }
        }
      }
    }
    
    console.log(`[Main Process] DNG cleanup completed: ${cleanedCount} files removed`);
  } catch (error) {
    console.error('[Main Process] Error during DNG cleanup:', error);
  }
}

/**
 * Genera un metatag di default basato sulle informazioni dell'immagine
 * @param imagePath Percorso del file immagine
 * @returns Metatag di default
 */
function generateDefaultMetatag(imagePath: string): string {
  const fileName = path.basename(imagePath);
  const date = new Date().toLocaleDateString();
  return `${fileName} - ${date}`;
}

/**
 * Aggiorna i metadati di un'immagine (EXIF per JPEG, XMP per RAW)
 * @param imagePath Percorso del file immagine
 * @param metatag Metatag da inserire (opzionale se si usa una strategia che non lo richiede)
 * @param analysisData Dati dell'analisi dell'immagine (opzionale)
 * @param config Configurazione del processo batch
 */
async function updateImageExif(
  imagePath: string, 
  metatag?: string, 
  analysisData?: VehicleAnalysis, 
  config?: BatchProcessConfig
): Promise<void> {
  try {
    // Determina la strategia di metadati (default: Analisi Completa)
    const metadataStrategy = config?.metadataStrategy || MetadataStrategy.XmpFullAnalysis;
    
    // Get the file extension
    const imageExt = path.extname(imagePath).toLowerCase();
    const isRaw = RAW_EXTENSIONS.includes(imageExt);
    
    // Usa la nuova funzione formatMetadataByCategory per generare le keywords
    // Questa funzione gestisce automaticamente le priorità CSV vs AI e la formattazione per categoria
    const category = config?.category || 'motorsport';
    const keywords = formatMetadataByCategory(analysisData, category, metatag);
    
    console.log(`Generated keywords for ${path.basename(imagePath)}: ${keywords.length} keywords - ${JSON.stringify(keywords.slice(0, 3))}${keywords.length > 3 ? '...' : ''}`);
    
    console.log(`Updating metadata for ${imagePath} with ${keywords.length} keywords`);
    
    // Per i file RAW, utilizziamo sempre i file XMP sidecar
    if (isRaw) {
      try {
        console.log(`Creating XMP sidecar for RAW file: ${imagePath}`);
        await createXmpSidecar(imagePath, keywords);
        console.log(`Successfully created XMP sidecar for ${imagePath}`);
        return;
      } catch (xmpError) {
        console.error('Error creating XMP sidecar:', xmpError);
        throw xmpError;
      }
    }
    
    // For non-RAW files, use ExifTool to embed metadata directly into the file
    // This supports JPEG, TIFF, PNG, WebP and many other formats
    const supportedFormats = ['.jpg', '.jpeg', '.tiff', '.tif', '.png', '.webp'];
    
    if (supportedFormats.includes(imageExt)) {
      try {
        console.log(`Using ExifTool for ${imageExt} file: ${path.basename(imagePath)}`);
        const startTime = Date.now();

        // Path to ExifTool (use system ExifTool if available, fallback to bundled)
        let exiftoolPath = 'exiftool'; // Try system ExifTool first

        // Check if we can use system ExifTool, otherwise use bundled version
        try {
          const { execSync } = require('child_process');
          const whichCommand = process.platform === 'win32' ? 'where exiftool' : 'which exiftool';
          execSync(whichCommand, { stdio: 'ignore' });
          console.log('Using system ExifTool');
        } catch {
          // Fallback to bundled ExifTool - multi-platform support
          const platform = process.platform; // 'win32', 'darwin', 'linux'
          const exiftoolName = platform === 'win32' ? 'exiftool.exe' : 'exiftool';
          exiftoolPath = path.join(__dirname, '..', 'vendor', platform, exiftoolName);
          console.log(`Using bundled ExifTool for ${platform}`);
        }

        // Use writeKeywordsToImage to handle keywords array properly
        await writeKeywordsToImage(imagePath, keywords);
        
        const totalTime = Date.now() - startTime;
        console.log(`[PERF] TOTAL KEYWORDS UPDATE TIME: ${totalTime}ms`);
        console.log(`Successfully updated keywords for ${path.basename(imagePath)}`);

      } catch (exiftoolError: any) {
        console.error(`Error updating ${imageExt} metadata with ExifTool:`, exiftoolError.message);
        console.error(`ExifTool error details:`, {
          message: exiftoolError.message,
          code: exiftoolError.code,
          stderr: exiftoolError.stderr,
          stdout: exiftoolError.stdout,
          status: exiftoolError.status,
          signal: exiftoolError.signal
        });
        
        // Fallback: create XMP sidecar if writeKeywordsToImage fails
        console.log(`Fallback: Creating XMP sidecar for ${path.basename(imagePath)}`);
        try {
          await createXmpSidecar(imagePath, keywords);
          console.log(`Successfully created XMP sidecar as fallback for ${path.basename(imagePath)}`);
        } catch (xmpError) {
          console.error(`Both writeKeywordsToImage and XMP sidecar failed for ${path.basename(imagePath)}:`, xmpError);
          throw new Error(`Failed to update metadata for ${path.basename(imagePath)}: ${exiftoolError.message}`);
        }
      }
    } else {
      // For unsupported formats, create XMP sidecar
      console.log(`Format ${imageExt} not supported, creating XMP sidecar for ${path.basename(imagePath)}`);
      await createXmpSidecar(imagePath, keywords);
      console.log(`Successfully created XMP sidecar for ${path.basename(imagePath)}`);
    }
  } catch (error) {
    console.error('Error in updateImageExif:', error);
    throw error;
  }
}

/**

/**
 * Gestisce la conversione di un file RAW in JPEG
 * Chiede all'utente di selezionare un file RAW, lo converte in JPEG e lo salva nella stessa cartella
 */
async function handleRawPreviewExtraction(event: IpcMainEvent) {
  console.log('[Main Process] handleRawPreviewExtraction called.');
  
  if (!mainWindow) {
    console.error('handleRawPreviewExtraction: mainWindow is null');
    return;
  }
  
  try {
    // Notifica l'inizio del processo al renderer
    mainWindow.webContents.send('raw-preview-status', { status: 'selecting' });
    
    // Chiedi all'utente di selezionare un file RAW
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Seleziona un file RAW',
      filters: [{ 
        name: 'File RAW', 
        extensions: RAW_EXTENSIONS.map(ext => ext.substring(1)) // Use global RAW_EXTENSIONS
      }]
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      console.log('RAW file selection canceled');
      mainWindow.webContents.send('raw-preview-status', { status: 'canceled' });
      return;
    }
    
    const rawFilePath = result.filePaths[0];
    
    // Verifica che sia effettivamente un file RAW
    const rawFileExtension = path.extname(rawFilePath).toLowerCase();
    if (!RAW_EXTENSIONS.includes(rawFileExtension)) { // Use global RAW_EXTENSIONS
      console.error(`Selected file is not a supported RAW format: ${rawFilePath}`);
      mainWindow.webContents.send('raw-preview-error', { 
        message: 'Il file selezionato non è un formato RAW supportato.'
      });
      return;
    }
    
    console.log(`Selected RAW file: ${rawFilePath}`);
    
    // Notifica l'inizio dell'estrazione
    mainWindow.webContents.send('raw-preview-status', { 
      status: 'extracting',
      file: path.basename(rawFilePath)
    });
    
    // Estrai l'anteprima nella stessa cartella del file RAW
    const baseFilename = path.basename(rawFilePath, path.extname(rawFilePath));
    const previewPath = path.join(path.dirname(rawFilePath), `${baseFilename}_preview.jpg`);
    
    // Convert RAW to DNG using the new converter.
    // The 'previewPath' variable (intended for a JPEG output) is not directly used by convertToDng for naming.
    // convertToDng will create a DNG file (e.g., originalName.dng) in the specified outputDir.
    // This changes the function's behavior: it now produces a DNG file.
    // Subsequent code expecting a JPEG preview from 'extractedPath' will need adjustment
    // as it will now handle a DNG file.
    console.log(`[Main Process] handleRawPreviewExtraction: Using rawConverter for ${rawFilePath}`);
    // Use the rawConverter singleton to convert the RAW to JPEG
    console.log(`[Main Process] handleRawPreviewExtraction: Using rawConverter with optimized method for ${rawFilePath}`);
    
    // Tenta di convertire con il metodo che utilizza dcraw+ImageMagick in alta risoluzione
    let extractedPath;
    try {
      // Primo passo: converti RAW in DNG
      const baseFilename = path.basename(rawFilePath, path.extname(rawFilePath));
      const dngFilePath = path.join(path.dirname(rawFilePath), `${baseFilename}.dng`);
      await rawConverter.convertRawToDng(rawFilePath, dngFilePath);
      
      // Secondo passo: usa il metodo ottimizzato per convertire DNG in JPEG
      // maxSize = 1440 per limitare il lato lungo a 1440px
      // jpegQuality = 95 per garantire alta qualità
      extractedPath = await rawConverter.convertDngToJpegOptimized(
        dngFilePath, 
        previewPath, 
        95,        // Alta qualità JPEG
        1440       // Limita il lato lungo a 1440px (preset dell'app)
      );
      console.log(`Successfully converted RAW to full-resolution JPEG: ${extractedPath}`);
    } catch (optimizedError: any) {
      console.error(`Optimized full-resolution conversion failed: ${optimizedError.message || 'Unknown error'}`);
      console.log(`Falling back to standard RAW to JPEG conversion...`);
      extractedPath = await rawConverter.convertRawToJpeg(rawFilePath, previewPath);
    }
    
    // Leggi l'anteprima estratta per includerla nella risposta
    const previewBuffer = await fsPromises.readFile(extractedPath);
    const previewBase64 = previewBuffer.toString('base64');
    
    // Invia il risultato al renderer
    mainWindow.webContents.send('raw-preview-extracted', {
      originalPath: rawFilePath,
      previewPath: extractedPath,
      originalFilename: path.basename(rawFilePath),
      previewFilename: path.basename(extractedPath),
      previewBase64: previewBase64
    });
    
    // Apri la directory contenente l'anteprima estratta
    shell.showItemInFolder(extractedPath);
    
  } catch (error: any) {
    console.error('Error during RAW preview extraction:', error);
    if (mainWindow) {
      mainWindow.webContents.send('raw-preview-error', {
        message: error.message || 'Si è verificato un errore durante l\'estrazione dell\'anteprima RAW'
      });
    }
  }
}

async function handleFeedbackSubmission(event: IpcMainEvent, feedbackData: any) {
  try {
    if (!mainWindow) return;
    
    const { imageId, feedbackType, confidenceScore, source } = feedbackData;
    
    console.log(`Ricevuto feedback per l'immagine ${imageId}: ${feedbackType} (confidence: ${confidenceScore})`);
    
    // Ottieni l'ID utente corrente se autenticato
    const authState = authService.getAuthState();
    const userId = authState.isAuthenticated ? authState.user?.id : null;
    
    // Salva il feedback nel database - rimuovendo i campi problematici
    const { error } = await supabase
      .from('image_feedback')
      .insert({
        image_id: imageId,
        feedback_type: feedbackType,
        feedback_notes: null, // Non utilizziamo più i commenti testuali
        // confidence_score: confidenceScore, // Rimuoviamo questo campo problematico
        // source: source || 'desktop', // Rimuoviamo anche questo campo problematico
        submitted_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Errore nel salvare il feedback:', error);
      mainWindow.webContents.send('feedback-error', 'Errore nel salvare il feedback');
      return;
    }
    
    // Conferma il salvataggio del feedback
    mainWindow.webContents.send('feedback-saved', {
      success: true,
      message: 'Feedback salvato con successo'
    });
    
  } catch (error: any) {
    console.error('Errore durante l\'invio del feedback:', error);
    if (mainWindow) {
      mainWindow.webContents.send('feedback-error', error.message || 'Si è verificato un errore durante l\'invio del feedback');
    }
  }
}


app.whenReady().then(async () => { // Added async here
  // Set app name for proper dock/taskbar display
  app.setName('RaceTagger');

  // Initialize @electron/remote now that app is ready
  try {
    const { initialize, enable } = require('@electron/remote/main');
    initialize();
    remoteEnable = enable; // Store enable function for use in createWindow
    console.log('[Main Process] @electron/remote initialized');
  } catch (error) {
    console.error('[Main Process] Failed to initialize @electron/remote:', error);
  }

  // Set isDev flag now that app is ready
  try {
    isDev = !app.isPackaged;
  } catch {
    isDev = true; // Default to dev mode if check fails
  }
  console.log('[Main Process] Running in', isDev ? 'DEVELOPMENT' : 'PRODUCTION', 'mode');

  // Check app version before creating window
  console.log('[Main Process] Checking app version...');
  versionCheckResult = await checkAppVersion();

  createWindow();
  
  // Cleanup all temp files at startup
  console.log('[Main Process] Cleaning up temporary files at startup...');
  try {
    await rawConverter.cleanupAllTempFiles();

    // Also cleanup files from the centralized temp directory
    const { CleanupManager } = require('./utils/cleanup-manager');
    const cleanupManager = new CleanupManager();
    await cleanupManager.startupCleanup();
  } catch (cleanupError) {
    console.error('[Main Process] Error during startup cleanup:', cleanupError);
  }
  setupAuthHandlers();
  setupWindowControlHandlers();
  initializeDatabaseSchema(); // Usa il nome esportato corretto
  
  
  console.log('[Main Process] After initializeDatabaseSchema. Setting up DB IPC handlers...');
  setupDatabaseIpcHandlers();
  console.log('[Main Process] After setupDatabaseIpcHandlers.');

  // Initialize Supabase cache after authentication is ready
  console.log('[Main Process] Caching Supabase data...');
  try {
    await cacheSupabaseData();
    console.log('[Main Process] Supabase data cached successfully');
  } catch (cacheError) {
    console.error('[Main Process] Error caching Supabase data:', cacheError);
    // Don't fail startup if cache fails, data will be loaded on-demand
  }

  // NOTE: The test code has been removed from startup to prevent conflicts with UI events.
  // If you need to run a test, uncomment the following lines:
  // console.log('[Main Process] Attempting to run testConversion...');
  // await testConversion();
  // console.log('[Main Process] testConversion finished or failed. Check console above.');

  console.log('[Main Process] main.ts: Setting up remaining IPC .on listeners...');
  ipcMain.on('select-folder', handleFolderSelection);
  
  // Version checking IPC handlers
  ipcMain.handle('check-app-version', async () => {
    try {
      return await checkAppVersion();
    } catch (error) {
      console.error('Error in check-app-version handler:', error);
      return { 
        requires_update: false, 
        force_update_enabled: false, 
        error: String(error) 
      };
    }
  });
  
  ipcMain.handle('get-version-check-result', () => {
    return versionCheckResult;
  });
  
  ipcMain.handle('is-force-update-required', () => {
    return forceUpdateRequired;
  });
  
  // Adobe DNG Converter check handler
  ipcMain.handle('check-adobe-dng-converter', async () => {
    try {
      // Only required if FORCE_ADOBE_DNG_FALLBACK is true
      if (process.env.FORCE_ADOBE_DNG_FALLBACK !== 'true') {
        console.log('[Main Process] FORCE_ADOBE_DNG_FALLBACK is false, Adobe DNG Converter not required');
        return { required: false, installed: true };
      }
      
      console.log('[Main Process] Checking Adobe DNG Converter installation...');
      const isInstalled = await rawConverter.isDngConverterInstalled();
      console.log(`[Main Process] Adobe DNG Converter installed: ${isInstalled}`);
      
      return { 
        required: true, 
        installed: isInstalled 
      };
    } catch (error) {
      console.error('[Main Process] Error checking Adobe DNG Converter:', error);
      return { 
        required: true, 
        installed: false, 
        error: String(error) 
      };
    }
  });
  
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
  
  ipcMain.handle('open-download-url', async (_, url: string) => {
    if (url) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });
  
  ipcMain.handle('quit-app-for-update', () => {
    // Allow app to quit even when force update is required
    forceUpdateRequired = false;
    app.quit();
  });
  ipcMain.handle('submit-token-request', handleTokenRequest);
  ipcMain.handle('get-token-balance', handleGetTokenBalance);
  ipcMain.handle('get-pending-tokens', handleGetPendingTokens);
  ipcMain.handle('get-token-info', handleGetTokenInfo);
  ipcMain.on('cancel-batch-processing', handleCancelBatchProcessing);

  // FOLDER ORGANIZATION: IPC handlers (available for all authenticated users)
  if (APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION) {
    console.log('[Main Process] Registering folder organization IPC handlers (public feature)...');
    
    // Check if folder organization feature is available for current user
    ipcMain.handle('check-folder-organization-enabled', async () => {
      const isFeatureEnabled = APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION;
      const hasAccess = authService.hasFolderOrganizationAccess();
      const authState = authService.getAuthState();
      
      console.log(`[Folder Org] Feature enabled: ${isFeatureEnabled}`);
      console.log(`[Folder Org] User has access: ${hasAccess}`);
      console.log(`[Folder Org] Auth state:`, {
        isAuthenticated: authState.isAuthenticated,
        userEmail: authState.user?.email,
        userRole: authState.userRole
      });
      
      return isFeatureEnabled && hasAccess;
    });

    // Get default folder organization configuration
    ipcMain.handle('get-folder-organization-config', async () => {
      if (!authService.hasFolderOrganizationAccess()) {
        throw new Error('Feature non disponibile');
      }

      // Import dinamico per mantenere modularità
      const { createDefaultConfig } = await import('./utils/folder-organizer');
      return createDefaultConfig();
    });

    // Select destination folder for organization
    ipcMain.handle('select-organization-destination', async () => {
      if (!authService.hasFolderOrganizationAccess()) {
        throw new Error('Feature non disponibile');
      }

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Destination Folder for Organized Photos',
        buttonLabel: 'Select Folder'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    });

    // Post-analysis folder organization
    ipcMain.handle('organize-results-post-analysis', async (_, data: {
      executionId: string;
      folderOrganizationConfig: any;
    }) => {
      try {
        const { executionId, folderOrganizationConfig } = data;

        console.log(`[Main Process] Post-analysis organization requested for execution ${executionId}`);

        // Verify feature access
        if (!authService.hasFolderOrganizationAccess()) {
          throw new Error('Folder organization feature not available');
        }

        // Read JSONL log file
        const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
        const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

        if (!fs.existsSync(logFilePath)) {
          throw new Error(`Log file not found for execution ${executionId}`);
        }

        // Parse JSONL file
        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        const logLines = logContent.trim().split('\n').filter(line => line.trim());
        const logEvents = logLines.map(line => {
          try {
            return JSON.parse(line);
          } catch (error) {
            console.warn('[Main Process] Invalid JSON line in log:', line);
            return null;
          }
        }).filter(Boolean);

        console.log(`[Main Process] Parsed ${logEvents.length} log events`);

        // Extract image analysis events
        const imageAnalysisEvents = logEvents.filter(event => event.type === 'IMAGE_ANALYSIS');

        // Build correction map from MANUAL_CORRECTION events
        const correctionMap = new Map();
        logEvents
          .filter(event => event.type === 'MANUAL_CORRECTION')
          .forEach(event => {
            const key = `${event.fileName}_${event.vehicleIndex}`;
            correctionMap.set(key, event.changes);
          });

        console.log(`[Main Process] Found ${imageAnalysisEvents.length} images to organize`);
        console.log(`[Main Process] Found ${correctionMap.size} manual corrections to apply`);

        // Import FolderOrganizer
        const { FolderOrganizer } = await import('./utils/folder-organizer');

        // Create organizer instance
        const organizer = new FolderOrganizer({
          enabled: true,
          mode: folderOrganizationConfig.mode || 'copy',
          pattern: folderOrganizationConfig.pattern || 'number',
          customPattern: folderOrganizationConfig.customPattern,
          createUnknownFolder: folderOrganizationConfig.createUnknownFolder !== false,
          unknownFolderName: folderOrganizationConfig.unknownFolderName || 'Unknown_Numbers',
          includeXmpFiles: folderOrganizationConfig.includeXmpFiles !== false,
          destinationPath: folderOrganizationConfig.destinationPath,
          conflictStrategy: folderOrganizationConfig.conflictStrategy || 'rename'
        });

        // Process each image
        const results = [];
        const errors = [];

        for (const event of imageAnalysisEvents) {
          try {
            const fileName = event.fileName;
            const originalPath = event.originalPath;

            if (!originalPath) {
              console.warn(`[Main Process] No original path for ${fileName}, skipping`);
              errors.push(`No original path found for ${fileName}`);
              continue;
            }

            // Check if file still exists
            if (!fs.existsSync(originalPath)) {
              console.warn(`[Main Process] File no longer exists: ${originalPath}`);
              errors.push(`File not found: ${fileName} (may have been moved)`);
              continue;
            }

            // Get final race numbers (apply corrections if any)
            let raceNumbers: string[] = [];
            if (event.aiResponse?.vehicles) {
              // Apply manual corrections if they exist
              event.aiResponse.vehicles.forEach((vehicle: any, index: number) => {
                const key = `${fileName}_${index}`;
                const correction = correctionMap.get(key);

                if (correction && correction.number) {
                  // Use manually corrected number
                  raceNumbers.push(correction.number);
                  console.log(`  - Vehicle ${index}: Using manual correction: ${correction.number}`);
                } else if (vehicle.finalResult?.raceNumber) {
                  // Use finalResult.raceNumber (after automatic corrections)
                  raceNumbers.push(vehicle.finalResult.raceNumber);
                  console.log(`  - Vehicle ${index}: Using final result: ${vehicle.finalResult.raceNumber}`);
                } else if (vehicle.raceNumber) {
                  // Fallback: use initial raceNumber
                  raceNumbers.push(vehicle.raceNumber);
                  console.log(`  - Vehicle ${index}: Using initial number: ${vehicle.raceNumber}`);
                }
              });
            }

            console.log(`[Main Process] ${fileName}: Found ${event.aiResponse?.vehicles?.length || 0} vehicles, extracted numbers: [${raceNumbers.join(', ')}]`);

            // If no race numbers found, use "unknown"
            if (raceNumbers.length === 0) {
              raceNumbers = ['unknown'];
              console.log(`[Main Process] ${fileName}: No race numbers found, using 'unknown'`);
            }

            // Get CSV match data if available
            let csvData = undefined;
            if (event.aiResponse?.vehicles && event.aiResponse.vehicles[0]?.participantMatch) {
              const match = event.aiResponse.vehicles[0].participantMatch;
              csvData = {
                numero: match.numero,
                nome: match.nome_pilota || match.nome,
                categoria: match.categoria,
                squadra: match.squadra,
                metatag: match.metatag
              };
              console.log(`  - CSV match found: ${match.nome_pilota || match.nome} (${match.numero})`);
            }

            // Organize the image
            const result = await organizer.organizeImage(
              originalPath,
              raceNumbers,
              csvData
            );

            results.push(result);
            console.log(`[Main Process] Organized ${fileName}: ${result.success ? '✓' : '✗'}`);

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Main Process] Error organizing image:`, errorMsg);
            errors.push(`${event.fileName}: ${errorMsg}`);
          }
        }

        // Get summary
        const summary = organizer.getSummary();

        console.log(`[Main Process] Organization complete:`, {
          totalFiles: summary.totalFiles,
          organizedFiles: summary.organizedFiles,
          skippedFiles: summary.skippedFiles,
          errors: errors.length
        });

        return {
          success: true,
          summary,
          errors: errors.length > 0 ? errors : undefined
        };

      } catch (error) {
        console.error('[Main Process] Error in post-analysis organization:', error);
        return {
          success: false,
          error: (error as Error).message
        };
      }
    });


    console.log('[Main Process] Folder organization handlers registered successfully');
  } else {
    console.log('[Main Process] Folder organization feature disabled - skipping IPC handlers');
  }

  // dcraw Test Dashboard IPC handlers
  console.log('[Main Process] Registering dcraw IPC handlers...');
  
  
  // Debug Sharp IPC handler
  ipcMain.handle('debug-sharp', async () => {
    console.log('[IPC] debug-sharp handler called');
    
    try {
      console.log('[IPC] Importing debugSharp function');
      const { debugSharp } = await import('./utils/native-modules');
      
      console.log('[IPC] Calling debugSharp()');
      debugSharp();
      
      console.log('[IPC] debugSharp completed');
      return { success: true, message: 'Debug information logged to console' };
    } catch (error: any) {
      console.error('[IPC] Error in debug-sharp handler:', error);
      return { success: false, error: error.message };
    }
  });

  // Enhanced File Browser IPC handlers
  ipcMain.handle('dialog-show-open', async (_, options) => {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    try {
      const result = await dialog.showOpenDialog(mainWindow, options);
      return result;
    } catch (error) {
      console.error('Error in dialog-show-open:', error);
      throw error;
    }
  });

  // Show save dialog
  ipcMain.handle('show-save-dialog', async (_, options) => {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    try {
      const result = await dialog.showSaveDialog(mainWindow, options);
      return result;
    } catch (error) {
      console.error('Error in show-save-dialog:', error);
      throw error;
    }
  });

  // Write file to filesystem
  ipcMain.handle('write-file', async (_, { path: filePath, content }) => {
    try {
      await fsPromises.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('get-folder-files', async (_, { folderPath, extensions = [] }) => {
    try {
      if (!fs.existsSync(folderPath)) {
        throw new Error('Folder does not exist');
      }

      const files = await fsPromises.readdir(folderPath);
      const imageFiles = [];

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stats = await fsPromises.stat(filePath);
        
        if (stats.isFile()) {
          const ext = path.extname(file).toLowerCase().slice(1);
          if (extensions.length === 0 || extensions.includes(ext)) {
            imageFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              extension: ext,
              isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(ext)
            });
          }
        }
      }

      return imageFiles;
    } catch (error) {
      console.error('Error getting folder files:', error);
      throw error;
    }
  });

  ipcMain.handle('get-file-stats', async (_, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('File does not exist');
      }

      const stats = await fsPromises.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
        ctime: stats.ctime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      };
    } catch (error) {
      console.error('Error getting file stats:', error);
      throw error;
    }
  });

  ipcMain.handle('generate-thumbnail', async (_, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const ext = path.extname(filePath).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);
      
      if (isRaw) {
        console.log(`[Main Process] Generating thumbnail for RAW file: ${path.basename(filePath)}`);
        
        try {
          // Crea percorso per thumbnail cache
          const baseFileName = path.basename(filePath, path.extname(filePath));
          const thumbnailDir = path.join(os.tmpdir(), 'racetagger-thumbnails');
          
          // Assicurati che la directory cache esista
          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }
          
          const thumbnailPath = path.join(thumbnailDir, `${baseFileName}_thumb.jpg`);
          
          // Controlla se abbiamo già una thumbnail in cache
          if (fs.existsSync(thumbnailPath)) {
            console.log(`[Main Process] Using cached thumbnail: ${thumbnailPath}`);
            return `file://${thumbnailPath}`;
          }
          
          // Genera thumbnail usando il rawConverter
          const generatedThumbPath = await rawConverter.extractThumbnailFromRaw(filePath, thumbnailPath);
          
          if (fs.existsSync(generatedThumbPath)) {
            console.log(`[Main Process] Generated RAW thumbnail: ${generatedThumbPath}`);
            return `file://${generatedThumbPath}`;
          }
          
          return null;
        } catch (rawError) {
          console.error(`[Main Process] Error generating RAW thumbnail for ${filePath}:`, rawError);
          return null;
        }
      } else if (STANDARD_EXTENSIONS.includes(ext)) {
        // For regular images, return the file path as data URL would be too large
        // The frontend can create its own thumbnail from the file path
        return `file://${filePath}`;
      }

      return null;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return null;
    }
  });

  // Import exec for dcraw thumbnail generation
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);
  
  // Handler to serve local images as base64 data URLs with Supabase fallback
  // New handler for high-quality modal previews
  ipcMain.handle('get-halfsize-image', async (_, imagePath: string) => {
    try {
      console.log(`🖼️ [Main Process] get-halfsize-image called with: ${imagePath}`);
      
      if (!imagePath) {
        console.warn(`🖼️ [Main Process] No imagePath provided`);
        return null;
      }
      
      const ext = path.extname(imagePath).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);
      const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      
      // For JPEG/PNG: Return original file directly (as requested)
      if (fs.existsSync(imagePath) && supportedExtensions.includes(ext)) {
        console.log(`🖼️ [Main Process] Loading original JPEG/PNG file: ${imagePath}`);

        try {
          // Read the image file
          const imageBuffer = await fsPromises.readFile(imagePath);
          
          // Determine MIME type
          let mimeType = 'image/jpeg';
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.webp') mimeType = 'image/webp';
          
          // Convert to base64 data URL
          const base64Data = imageBuffer.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64Data}`;
          
          console.log(`[Main Process] Successfully loaded original image: ${path.basename(imagePath)} (${imageBuffer.length} bytes)`);
          return dataUrl;
          
        } catch (readError) {
          console.error(`[Main Process] Error reading original image ${imagePath}:`, readError);
          return null;
        }
      }
      
      // For RAW files: Generate halfsize thumbnail using dcraw -h (no resize)
      if (isRaw && fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        console.log(`🖼️ [Main Process] Generating halfsize RAW preview for: ${fileName}`);
        
        try {
          // Use dcraw -h (halfsize) without further resize for natural halfsize preview
          const dcrawCommand = `dcraw -h -w -c "${imagePath}"`;
          const result = await execPromise(dcrawCommand, { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' });
          
          if (result.stdout && result.stdout.length > 0) {
            // Convert buffer to base64 data URL
            const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'binary');
            const base64Data = buffer.toString('base64');
            const dataUrl = `data:image/jpeg;base64,${base64Data}`;
            
            console.log(`[Main Process] Successfully generated halfsize RAW preview: ${fileName} (${buffer.length} bytes)`);
            return dataUrl;
          } else {
            console.warn(`[Main Process] dcraw halfsize failed for: ${fileName}`);
            return null;
          }
          
        } catch (dcrawError) {
          console.error(`[Main Process] dcraw halfsize generation failed for ${fileName}:`, dcrawError);
          return null;
        }
      }
      
      // Unsupported format
      console.warn(`[Main Process] Unsupported image format for halfsize preview: ${ext}`);
      return null;
      
    } catch (error) {
      console.error(`[Main Process] Error in get-halfsize-image ${imagePath}:`, error);
      return null;
    }
  });

  // Handler per recuperare URL Supabase per immagini già processate
  ipcMain.handle('get-supabase-image-url', async (_, fileName: string) => {
    try {
      console.log(`🖼️ [Main Process] Looking for Supabase URL for: ${fileName}`);
      
      // Check cache first
      let cachedUrl = supabaseImageUrlCache.get(fileName);
      if (cachedUrl) {
        console.log(`🖼️ [Main Process] Found cached Supabase URL for: ${fileName}`);
        return cachedUrl;
      }
      
      // Query database for existing processed image
      const authState = authService.getAuthState();
      if (!authState.isAuthenticated) {
        console.log(`🖼️ [Main Process] User not authenticated, cannot query Supabase`);
        return null;
      }
      
      try {
        const { data, error } = await supabase
          .from('images')
          .select('storage_path')
          .eq('original_filename', fileName)
          .order('created_at', { ascending: false })
          .limit(1);
          
        if (error) {
          console.error(`🖼️ [Main Process] Error querying images table:`, error);
          return null;
        }
        
        if (data && data.length > 0 && data[0].storage_path) {
          const storagePath = data[0].storage_path;
          const publicUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storagePath}`;
          
          // Cache the URL for future use
          supabaseImageUrlCache.set(fileName, publicUrl);
          console.log(`🖼️ [Main Process] Retrieved and cached Supabase URL for: ${fileName}`);
          
          return publicUrl;
        } else {
          console.log(`🖼️ [Main Process] No processed image found in Supabase for: ${fileName}`);
          return null;
        }
      } catch (dbError) {
        console.error(`🖼️ [Main Process] Database query error for ${fileName}:`, dbError);
        return null;
      }
    } catch (error) {
      console.error(`🖼️ [Main Process] Error in get-supabase-image-url:`, error);
      return null;
    }
  });

  ipcMain.handle('get-local-image', async (_, imagePath: string) => {
    try {
      console.log(`🖼️ [Main Process] get-local-image called with: ${imagePath}`);
      
      if (!imagePath) {
        console.warn(`🖼️ [Main Process] No imagePath provided`);
        return null;
      }
      
      const ext = path.extname(imagePath).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);
      const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      
      // Try local file first for supported formats
      if (fs.existsSync(imagePath) && supportedExtensions.includes(ext)) {
        console.log(`🖼️ [Main Process] Local image file exists: ${imagePath}`);

        try {
          // Read the image file
          const imageBuffer = await fsPromises.readFile(imagePath);
          
          // Determine MIME type
          let mimeType = 'image/jpeg';
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.webp') mimeType = 'image/webp';
          
          // Convert to base64 data URL
          const base64Data = imageBuffer.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64Data}`;
          
          console.log(`[Main Process] Successfully loaded local image: ${path.basename(imagePath)} (${imageBuffer.length} bytes)`);
          return dataUrl;
          
        } catch (readError) {
          console.error(`[Main Process] Error reading local image ${imagePath}:`, readError);
          // Fall through to Supabase fallback
        }
      }
      
      // For RAW files, check Supabase cache first, then generate thumbnail using dcraw
      if (isRaw && fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        
        // Check if we have a cached Supabase URL for this image (by full path or filename)
        let cachedUrl = supabaseImageUrlCache.get(imagePath);
        if (!cachedUrl) {
          // Also try by filename in case it was cached that way
          cachedUrl = supabaseImageUrlCache.get(fileName);
        }
        
        if (cachedUrl) {
          console.log(`🖼️ [Main Process] Using cached Supabase URL for RAW file: ${fileName}`);
          return cachedUrl;
        }
        
        console.log(`🖼️ [Main Process] No cached Supabase URL found, generating dcraw thumbnail for: ${fileName}`);
        
        try {
          let result;
          
          // For RAW files, try using the existing raw-converter first
          console.log(`🖼️ [Main Process] Attempting RAW thumbnail generation for: ${fileName}`);
          
          try {
            // Use the raw converter to create a temporary thumbnail
            const tempThumbnailPath = `/tmp/thumbnail_${Date.now()}_${path.basename(imagePath, ext)}.jpg`;
            
            if (ext === '.cr3') {
              console.log(`🖼️ [Main Process] Using raw-converter for CR3 file: ${fileName}`);
              await rawConverter.convertRawToJpeg(imagePath, tempThumbnailPath);
            } else {
              // For other RAW formats, use dcraw directly
              console.log(`🖼️ [Main Process] Using dcraw for ${ext.toUpperCase()} file: ${fileName}`);
              const dcrawCommand = `dcraw -h -w -c "${imagePath}" | convert - -resize 400x400 -quality 85 "${tempThumbnailPath}"`;
              await execPromise(dcrawCommand, { maxBuffer: 5 * 1024 * 1024 });
            }
            
            // Read the generated thumbnail
            if (fs.existsSync(tempThumbnailPath)) {
              const thumbnailBuffer = await fsPromises.readFile(tempThumbnailPath);
              // Clean up temp file
              await fsPromises.unlink(tempThumbnailPath);
              
              // Convert to base64
              const base64Data = thumbnailBuffer.toString('base64');
              const dataUrl = `data:image/jpeg;base64,${base64Data}`;
              console.log(`[Main Process] Successfully generated RAW thumbnail for: ${fileName} (${thumbnailBuffer.length} bytes)`);
              return dataUrl;
            }
          } catch (rawConverterError: any) {
            console.log(`🖼️ [Main Process] Raw converter failed for ${fileName}:`, rawConverterError.message);
          }
          
          // Fallback: try exiftool to extract embedded thumbnail
          console.log(`🖼️ [Main Process] Trying exiftool thumbnail fallback for: ${fileName}`);
          const exiftoolCommand = `exiftool -b -ThumbnailImage "${imagePath}"`;
          result = await execPromise(exiftoolCommand, { maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' });
          
          if (result.stdout && result.stdout.length > 0) {
            // Convert buffer to base64 data URL
            const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'binary');
            const base64Data = buffer.toString('base64');
            const dataUrl = `data:image/jpeg;base64,${base64Data}`;
            
            console.log(`[Main Process] Successfully extracted embedded thumbnail for: ${fileName} (${buffer.length} bytes)`);
            return dataUrl;
          } else {
            console.warn(`[Main Process] All thumbnail generation methods failed for: ${fileName}`);
            return null;
          }
          
        } catch (dcrawError) {
          console.error(`[Main Process] dcraw thumbnail generation failed for ${fileName}:`, dcrawError);
          return null;
        }
      }
      
      // If we get here, the file format is unsupported and no fallback is available
      console.warn(`[Main Process] Unsupported image format and no fallback available: ${ext}`);
      return null;
      
    } catch (error) {
      console.error(`[Main Process] Error in get-local-image ${imagePath}:`, error);
      return null;
    }
  });
  
  // Handler per listare i file in una cartella (per supportare il modal di progresso migliorato)
  ipcMain.handle('list-files-in-folder', async (_, { path: folderPath }) => {
    try {
      console.log(`[Main Process] Listing files in folder: ${folderPath}`);
      
      // Verifica se la cartella esiste
      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'La cartella specificata non esiste' };
      }
      
      // Leggi tutti i file nella cartella
      const files = await fsPromises.readdir(folderPath);
      
      // Ritorna la lista di file
      return { 
        success: true, 
        files: files.map(file => path.join(folderPath, file))
      };
    } catch (error) {
      console.error('Error listing files in folder:', error);
      return { success: false, error: (error as Error).message || 'Errore durante la lettura della cartella' };
    }
  });

  
  ipcMain.on('load-csv', handleCsvLoading);
  ipcMain.on('download-csv-template', handleCsvTemplateDownload);
  ipcMain.on('analyze-folder', (event: IpcMainEvent, config: BatchProcessConfig) => {
    console.log('[Main Process] analyze-folder IPC event received with config:', config);
    
    // Always use unified processor (simplified routing)
    console.log('[Main Process] Using UNIFIED PROCESSOR');
    handleUnifiedImageProcessing(event, config);
  });
  
  
  ipcMain.on('extract-raw-preview', handleRawPreviewExtraction);
  ipcMain.on('submit-feedback', handleFeedbackSubmission);
  
  // Handler per contare le immagini in una cartella
  ipcMain.handle('count-folder-images', async (_, { path: folderPath }) => {
    try {
      console.log(`[Main Process] Conteggio immagini nella cartella: ${folderPath}`);
      
      // Verifica se la cartella esiste
      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'La cartella specificata non esiste', count: 0 };
      }
      
      // Leggi tutti i file nella cartella
      const files = await fsPromises.readdir(folderPath);
      
      // Filtra solo le immagini (.jpg, .jpeg, .png, .webp)
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      });
      
      console.log(`[Main Process] Trovate ${imageFiles.length} immagini nella cartella`);
      
      // Ritorna il conteggio delle immagini
      return { 
        success: true, 
        count: imageFiles.length
      };
    } catch (error) {
      console.error('Error counting images in folder:', error);
      return { success: false, error: (error as Error).message || 'Errore durante il conteggio delle immagini', count: 0 };
    }
  });
  
  // Handler per ottenere la configurazione della streaming pipeline
  ipcMain.handle('get-pipeline-config', async () => {
    try {
      const { PIPELINE_CONFIG } = await import('./config');
      
      return {
        success: true,
        config: {
          enabled: PIPELINE_CONFIG.enabled,
          workers: PIPELINE_CONFIG.workers,
          diskManagement: PIPELINE_CONFIG.diskManagement,
          performance: PIPELINE_CONFIG.performance
        }
      };
    } catch (error) {
      console.error('[Main Process] Error getting pipeline config:', error);
      return {
        success: false,
        error: (error as Error).message || 'Error getting pipeline configuration'
      };
    }
  });

  // =====================================================
  // LOG VISUALIZER IPC HANDLERS
  // =====================================================

  // Get execution log data for log visualizer
  ipcMain.handle('get-execution-log', async (_, executionId: string) => {
    try {
      // Handle mock execution IDs for testing
      if (executionId.startsWith('mock-exec-')) {
        const mockLogData = [
          {
            event: 'IMAGE_ANALYSIS',
            fileName: 'IMG_0001.jpg',
            timestamp: new Date().toISOString(),
            data: {
              fileName: 'IMG_0001.jpg',
              analysis: [{ number: '42', confidence: 0.95 }],
              csvMatch: { numero: '42', nome: 'Test Driver', squadra: 'Test Team' },
              imagePath: '/mock/path/IMG_0001.jpg',
              compressedPath: '/mock/compressed/IMG_0001.jpg',
              thumbnailPath: '/mock/thumb/IMG_0001.jpg',
              microThumbPath: '/mock/micro/IMG_0001.jpg'
            }
          },
          {
            event: 'IMAGE_ANALYSIS',
            fileName: 'IMG_0002.jpg',
            timestamp: new Date().toISOString(),
            data: {
              fileName: 'IMG_0002.jpg',
              analysis: [{ number: '17', confidence: 0.88 }],
              csvMatch: { numero: '17', nome: 'Another Driver', squadra: 'Racing Team' },
              imagePath: '/mock/path/IMG_0002.jpg',
              compressedPath: '/mock/compressed/IMG_0002.jpg',
              thumbnailPath: '/mock/thumb/IMG_0002.jpg',
              microThumbPath: '/mock/micro/IMG_0002.jpg'
            }
          }
        ];
        console.log(`[Main Process] Returning mock log data for execution ${executionId}`);
        return { success: true, data: mockLogData };
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      if (!fs.existsSync(logFilePath)) {
        console.warn(`[Main Process] Log file not found: ${logFilePath}`);
        return { success: true, data: [] }; // Return empty array if no log file
      }

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());
      const logEvents = logLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.warn('[Main Process] Invalid JSON line in log:', line);
          return null;
        }
      }).filter(Boolean);

      console.log(`[Main Process] Loaded ${logEvents.length} log events for execution ${executionId}`);
      return { success: true, data: logEvents };

    } catch (error) {
      console.error('[Main Process] Error reading execution log:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Update analysis log with manual corrections
  ipcMain.handle('update-analysis-log', async (_, data: {
    executionId: string;
    corrections: Array<{
      fileName: string;
      vehicleIndex: number;
      changes: any;
      timestamp: string;
    }>;
    timestamp: string;
  }) => {
    try {
      const { executionId, corrections, timestamp } = data;
      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      console.log(`[Main Process] Updating analysis log for execution ${executionId} with ${corrections.length} corrections`);

      // Read existing log
      let logEvents: any[] = [];
      let executionStartEvent: any = null;
      let executionCompleteEvent: any = null;

      if (fs.existsSync(logFilePath)) {
        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        const logLines = logContent.trim().split('\n').filter(line => line.trim());

        console.log(`[Main Process] Reading ${logLines.length} lines from log file`);

        logEvents = logLines.map((line, index) => {
          try {
            const event = JSON.parse(line);
            // Preserve the EXECUTION_START event separately to ensure it's never lost
            if (event.type === 'EXECUTION_START' && index === 0) {
              executionStartEvent = event;
              console.log('[Main Process] Found and preserved EXECUTION_START event');
            }
            // Preserve the EXECUTION_COMPLETE event separately to ensure it's always last
            else if (event.type === 'EXECUTION_COMPLETE') {
              executionCompleteEvent = event;
              console.log('[Main Process] Found and preserved EXECUTION_COMPLETE event');
            }
            return event;
          } catch (error) {
            console.warn(`[Main Process] Invalid JSON line ${index} in log:`, line.substring(0, 100) + '...');
            return null;
          }
        }).filter(Boolean);

        // Critical validation: Ensure EXECUTION_START is preserved
        if (!executionStartEvent) {
          console.error('[Main Process] CRITICAL: EXECUTION_START event not found or corrupted!');
          if (logEvents.length > 0 && logEvents[0].type !== 'EXECUTION_START') {
            console.error('[Main Process] First event is not EXECUTION_START:', logEvents[0].type);
            // Try to find EXECUTION_START elsewhere in the log
            const foundStart = logEvents.find(event => event.type === 'EXECUTION_START');
            if (foundStart) {
              executionStartEvent = foundStart;
              console.log('[Main Process] Found EXECUTION_START event at wrong position, will reorder');
            }
          }
        }

        // If EXECUTION_START is still missing, create a minimal one to prevent execution disappearance
        if (!executionStartEvent) {
          console.warn('[Main Process] Creating fallback EXECUTION_START event to prevent execution disappearance');
          executionStartEvent = {
            type: 'EXECUTION_START',
            timestamp: new Date().toISOString(),
            executionId: executionId,
            totalImages: 0,
            category: 'unknown',
            presetName: 'recovered'
          };
        }
      }

      // Add manual correction events
      for (const correction of corrections) {
        const manualCorrectionEvent = {
          type: 'MANUAL_CORRECTION',
          timestamp: correction.timestamp,
          executionId,
          imageId: `${correction.fileName}_${correction.vehicleIndex}`,
          fileName: correction.fileName,
          vehicleIndex: correction.vehicleIndex,
          correctionType: 'USER_MANUAL',
          changes: correction.changes,
          userId: authService.getAuthState().user?.id || 'unknown',
          correctionReason: 'Manual user correction via log visualizer'
        };

        logEvents.push(manualCorrectionEvent);

        // Update the corresponding IMAGE_ANALYSIS event if it exists
        const imageAnalysisEvent = logEvents.find(event =>
          event.type === 'IMAGE_ANALYSIS' && event.fileName === correction.fileName
        );

        if (imageAnalysisEvent && imageAnalysisEvent.aiResponse?.vehicles?.[correction.vehicleIndex]) {
          const vehicle = imageAnalysisEvent.aiResponse.vehicles[correction.vehicleIndex];

          // Store only the specific fields we need to track, not the entire vehicle object
          // This prevents circular references when the vehicle object contains corrections array
          const originalValues: any = {};
          for (const [key, value] of Object.entries(correction.changes)) {
            if (vehicle[key] !== undefined) {
              originalValues[key] = vehicle[key];
            }
          }

          // Update with new values
          Object.assign(vehicle, correction.changes);

          // Update also the finalResult which is what's actually displayed
          if (vehicle.finalResult) {
            Object.assign(vehicle.finalResult, correction.changes);
          }

          // If this is the first vehicle, also update primaryVehicle
          if (correction.vehicleIndex === 0 && imageAnalysisEvent.primaryVehicle) {
            Object.assign(imageAnalysisEvent.primaryVehicle, correction.changes);
            if (imageAnalysisEvent.primaryVehicle.finalResult) {
              Object.assign(imageAnalysisEvent.primaryVehicle.finalResult, correction.changes);
            }
          }

          // Set confidence to 100% for manual corrections
          vehicle.confidence = 1.0;

          // Add correction metadata
          if (!vehicle.corrections) {
            vehicle.corrections = [];
          }

          vehicle.corrections.push({
            type: 'USER_MANUAL',
            timestamp: correction.timestamp,
            originalValues,
            newValues: correction.changes
          });

          console.log(`[Main Process] Updated IMAGE_ANALYSIS event for ${correction.fileName} vehicle ${correction.vehicleIndex}`);
        }

        // Update image metadata using exiftool
        try {
          await updateImageMetadataWithCorrection(correction);
        } catch (metadataError) {
          console.warn('[Main Process] Failed to update image metadata:', metadataError);
          // Continue with log update even if metadata update fails
        }
      }

      // Update EXECUTION_COMPLETE event with manual correction stats (if it exists)
      if (executionCompleteEvent) {
        if (!executionCompleteEvent.corrections.USER_MANUAL) {
          executionCompleteEvent.corrections.USER_MANUAL = 0;
        }
        executionCompleteEvent.corrections.USER_MANUAL += corrections.length;

        // Add manual correction details
        if (!executionCompleteEvent.manualCorrectionDetails) {
          executionCompleteEvent.manualCorrectionDetails = {
            totalManualCorrections: 0,
            correctedFields: {},
            correctionTimestamps: []
          };
        }

        executionCompleteEvent.manualCorrectionDetails.totalManualCorrections += corrections.length;
        corrections.forEach(correction => {
          Object.keys(correction.changes).forEach(field => {
            if (!executionCompleteEvent.manualCorrectionDetails.correctedFields[field]) {
              executionCompleteEvent.manualCorrectionDetails.correctedFields[field] = 0;
            }
            executionCompleteEvent.manualCorrectionDetails.correctedFields[field]++;
          });
          executionCompleteEvent.manualCorrectionDetails.correctionTimestamps.push(correction.timestamp);
        });

        console.log('[Main Process] ✓ Updated EXECUTION_COMPLETE event with manual correction stats');
      } else {
        console.log('[Main Process] No EXECUTION_COMPLETE event found - execution was not completed yet');
      }

      // Ensure proper event ordering: EXECUTION_START first, EXECUTION_COMPLETE last
      console.log('[Main Process] Preparing to write log file, ensuring proper event ordering');

      // Remove any existing EXECUTION_START and EXECUTION_COMPLETE from logEvents array to avoid duplicates
      const middleEvents = logEvents.filter(event =>
        event.type !== 'EXECUTION_START' &&
        event.type !== 'EXECUTION_COMPLETE'
      );

      // Validate and construct final events array with proper ordering
      const finalEvents = [executionStartEvent, ...middleEvents];

      // Add EXECUTION_COMPLETE as the last event (if it exists)
      if (executionCompleteEvent) {
        finalEvents.push(executionCompleteEvent);
        console.log('[Main Process] ✓ EXECUTION_COMPLETE positioned as last event to ensure "completed" status');
      } else {
        console.log('[Main Process] No EXECUTION_COMPLETE event to position - execution will show as "processing"');
      }

      // Additional validation for proper event ordering
      if (finalEvents[0].type !== 'EXECUTION_START') {
        console.error('[Main Process] CRITICAL: EXECUTION_START is not first event! This will cause execution disappearance.');
        console.log('[Main Process] First event type:', finalEvents[0].type);
      } else {
        console.log('[Main Process] ✓ EXECUTION_START correctly positioned as first event');
      }

      // Validate EXECUTION_COMPLETE positioning
      if (executionCompleteEvent && finalEvents.length > 1) {
        const lastEvent = finalEvents[finalEvents.length - 1];
        if (lastEvent.type !== 'EXECUTION_COMPLETE') {
          console.error('[Main Process] CRITICAL: EXECUTION_COMPLETE is not last event! This will show execution as "processing".');
          console.log('[Main Process] Last event type:', lastEvent.type);
        } else {
          console.log('[Main Process] ✓ EXECUTION_COMPLETE correctly positioned as last event');
        }
      }

      // Write updated log back to file
      const updatedLogContent = finalEvents.map(event => JSON.stringify(event)).join('\n') + '\n';
      fs.writeFileSync(logFilePath, updatedLogContent, 'utf-8');

      // CRITICAL VALIDATION: Verify file integrity after saving
      console.log('[Main Process] Verifying file integrity after save...');
      try {
        const verificationContent = fs.readFileSync(logFilePath, 'utf-8');
        const verificationLines = verificationContent.trim().split('\n').filter(line => line.trim());

        if (verificationLines.length === 0) {
          console.error('[Main Process] CRITICAL ERROR: File is empty after save!');
          throw new Error('Log file is empty after save');
        }

        const firstEvent = JSON.parse(verificationLines[0]);
        if (firstEvent.type !== 'EXECUTION_START') {
          console.error('[Main Process] CRITICAL ERROR: First event is not EXECUTION_START after save!');
          console.error('[Main Process] First event type:', firstEvent.type);
          console.error('[Main Process] First line content:', verificationLines[0].substring(0, 200));
          throw new Error(`First event is ${firstEvent.type}, not EXECUTION_START`);
        }

        if (firstEvent.executionId !== executionId) {
          console.error('[Main Process] CRITICAL ERROR: ExecutionId mismatch!');
          console.error('[Main Process] Expected:', executionId, 'Found:', firstEvent.executionId);
          throw new Error('ExecutionId mismatch in EXECUTION_START event');
        }

        // Verify EXECUTION_COMPLETE is last event (if it exists)
        if (executionCompleteEvent && verificationLines.length > 1) {
          const lastEvent = JSON.parse(verificationLines[verificationLines.length - 1]);
          if (lastEvent.type !== 'EXECUTION_COMPLETE') {
            console.error('[Main Process] CRITICAL ERROR: Last event is not EXECUTION_COMPLETE after save!');
            console.error('[Main Process] Last event type:', lastEvent.type);
            console.error('[Main Process] Execution will show as "processing" instead of "completed"');
            throw new Error(`Last event is ${lastEvent.type}, not EXECUTION_COMPLETE`);
          } else {
            console.log('[Main Process] ✓ File integrity verified: EXECUTION_COMPLETE is correctly positioned as last event');
          }
        }

        console.log('[Main Process] ✓ File integrity verified: EXECUTION_START is correctly positioned as first event');
        console.log('[Main Process] ✓ File contains', verificationLines.length, 'events');
        console.log('[Main Process] ✓ ExecutionId matches:', firstEvent.executionId);
      } catch (verificationError) {
        console.error('[Main Process] CRITICAL: File verification failed!', verificationError);
        // This is a critical error, but we continue to preserve existing functionality
        // In the future, we might want to restore from backup or abort the operation
      }

      // Upload updated log to Supabase if possible - direct upload without creating logger instance
      try {
        const { getSupabaseClient } = await import('./database-service');
        const supabase = getSupabaseClient();
        const userId = authService.getAuthState().user?.id || 'unknown';
        const date = new Date().toISOString().split('T')[0];
        const supabaseUploadPath = `${userId}/${date}/exec_${executionId}.jsonl`;

        console.log('[Main Process] Uploading updated log directly to Supabase...');

        // Read the file we just saved and upload it
        const fileContent = fs.readFileSync(logFilePath);

        const { error } = await supabase.storage
          .from('analysis-logs')
          .upload(supabaseUploadPath, fileContent, {
            cacheControl: '3600',
            upsert: true, // Allow overwriting
            contentType: 'application/x-ndjson'
          });

        if (error) {
          console.error('[Main Process] Direct upload failed:', error);
        } else {
          console.log('[Main Process] ✓ Updated log uploaded to Supabase:', supabaseUploadPath);

          // Also create/update metadata record
          await supabase
            .from('analysis_log_metadata')
            .upsert({
              execution_id: executionId,
              user_id: userId,
              storage_path: supabaseUploadPath,
              total_images: 0, // We don't have stats from direct upload
              total_corrections: corrections.length,
              correction_types: { USER_MANUAL: corrections.length },
              category: 'unknown',
              app_version: app.getVersion()
            });
        }
      } catch (uploadError) {
        console.warn('[Main Process] Failed to upload updated log to Supabase:', uploadError);
        // Continue anyway, local file is updated
      }

      console.log(`[Main Process] Successfully updated analysis log with ${corrections.length} manual corrections`);
      return { success: true };

    } catch (error) {
      console.error('[Main Process] Error updating analysis log:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Update image metadata with manual correction
  async function updateImageMetadataWithCorrection(correction: {
    fileName: string;
    vehicleIndex: number;
    changes: any;
  }) {
    try {
      // Find the image file - this is a simplified version
      // In reality, you'd need to track the full image paths from the processing results
      console.log(`[Main Process] Would update metadata for ${correction.fileName} with:`, correction.changes);

      // TODO: Implement actual metadata update using exiftool
      // This would require:
      // 1. Finding the actual image file path
      // 2. Reading current IPTC keywords/description
      // 3. Updating with new recognition data
      // 4. Writing back to file
      //
      // Example implementation:
      // const imagePath = await findImagePath(correction.fileName);
      // if (imagePath) {
      //   await updateImageMetadata(imagePath, {
      //     raceNumber: correction.changes.raceNumber,
      //     team: correction.changes.team,
      //     drivers: correction.changes.drivers
      //   });
      // }

      return { success: true };

    } catch (error) {
      console.error('[Main Process] Error updating image metadata:', error);
      throw error;
    }
  }

  console.log('[Main Process] main.ts: All IPC .on listeners set up.');

  app.on('activate', () => {
    console.log('[Main Process] main.ts: app event: activate');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  console.log('[Main Process] main.ts: app.activate listener set up.');
});

app.on('window-all-closed', () => {
  console.log('[Main Process] main.ts: app event: window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
console.log('[Main Process] main.ts: app.window-all-closed listener set up.');

function parseCSVLine(line: string): string[] {
  console.log('[Main Process] parseCSVLine called.');
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

process.on('uncaughtException', (error: Error) => {
  safeConsoleError('[Main Process] FATAL: Uncaught exception:', error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('Application Error', `A critical unexpected error occurred: ${error.message}\n\nPlease report this error.\n\n${error.stack || ''}`);
  } else {
    // Fallback if mainWindow is not available or already destroyed
    dialog.showErrorBox('Critical Application Error', `A critical unexpected error occurred before the UI could be fully initialized: ${error.message}\n\nPlease report this error.\n\n${error.stack || ''}`);
  }
  // Consider exiting the app more gracefully or logging to a persistent file
  // For now, the error box is the primary notification.
});

// --- Graceful Shutdown Handlers ---
console.log('[Main Process] main.ts: Setting up graceful shutdown handlers...');

// Handle app termination signals
process.on('SIGTERM', async () => {
  console.log('[Main Process] Received SIGTERM, shutting down gracefully...');
  await performCleanup();
  app.quit();
});

process.on('SIGINT', async () => {
  console.log('[Main Process] Received SIGINT, shutting down gracefully...');
  await performCleanup();
  app.quit();
});

// Handle app quit event
app.on('before-quit', async () => {
  console.log('[Main Process] App is about to quit, performing cleanup...');
  await performCleanup();
});

// Cleanup function
async function performCleanup(): Promise<void> {
  console.log('[Main Process] Starting cleanup process...');
  
  try {
    // Cancel any running batch processing
    batchProcessingCancelled = true;
    
    // Cleanup auth service resources
    console.log('[Main Process] Cleaning up auth service...');
    authService.cleanup();
    
    // Close database connections (if any are open)
    console.log('[Main Process] Closing database connections...');
    // The database cleanup is already handled in database-service.ts on app quit
    
    // Cleanup all temp files at shutdown
    console.log('[Main Process] Cleaning up temporary files at shutdown...');
    try {
      await rawConverter.cleanupAllTempFiles();
    } catch (cleanupError) {
      console.error('[Main Process] Error during shutdown cleanup:', cleanupError);
    }
    
    console.log('[Main Process] Cleanup completed successfully');
  } catch (error) {
    console.error('[Main Process] Error during cleanup:', error);
  }
}

console.log('[Main Process] main.ts: Graceful shutdown handlers set up successfully');
