import { app, BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, dialog, shell, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
// import * as os from 'os'; // REMOVED - unused

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
  // getProjectsOnline, // REMOVED - used in auth-handlers.ts
  getProjectByIdOnline,
  updateProjectOnline,
  deleteProjectOnline,
  createExecutionOnline,
  getSportCategoryIdByName,
  getExecutionsByProjectIdOnline,
  getExecutionByIdOnline,
  updateExecutionOnline,
  deleteExecutionOnline,
  getRecentProjectsFromCache,
  uploadCsvToStorage,
  Project,
  Execution,
  // syncAllUserDataToSupabase, // REMOVED - used in database-handlers.ts
  // clearAllUserData, // REMOVED - used in database-handlers.ts
  // getUserDataStats, // REMOVED - used in database-handlers.ts
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
  // getSportCategories, // REMOVED - used in supabase-handlers.ts
  getSportCategoryByCode,
  createParticipantPresetSupabase,
  getUserParticipantPresetsSupabase,
  getParticipantPresetByIdSupabase,
  savePresetParticipantsSupabase,
  updatePresetLastUsedSupabase,
  updateParticipantPresetSupabase,
  deleteParticipantPresetSupabase,
  importParticipantsFromCSVSupabase,
  duplicateOfficialPresetSupabase,
  isFeatureEnabled,
  // Export Destinations - most moved to export-handlers.ts, kept only those used in main.ts
  ExportDestination,
  getActiveExportDestinations,
  getExportDestinationById
} from './database-service';
// Determine if we're in development mode - will be set after app is ready
let isDev = true; // Default to true for safety during initialization
// Don't import @electron/remote at top level - it will be required when needed
let remoteEnable: any = null; // Will be set after app is ready
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, APP_CONFIG, ResizePreset, RESIZE_PRESETS, PIPELINE_CONFIG, DEBUG_MODE } from './config';
import { authService } from './auth-service';
import * as piexif from 'piexifjs';
import { createImageProcessor, initializeImageProcessor } from './utils/native-modules';
import { createXmpSidecar, xmpSidecarExists } from './utils/xmp-manager';
import { writeKeywordsToImage } from './utils/metadata-writer';
import { rawConverter } from './utils/raw-converter'; // Import the singleton instance
import { unifiedImageProcessor, UnifiedImageFile, UnifiedProcessingResult, UnifiedProcessorConfig } from './unified-image-processor';
import { FolderOrganizerConfig } from './utils/folder-organizer';
import { getFaceDetectionBridge } from './face-detection-bridge';
import { getModelManager } from './model-manager';
// Modular IPC handlers
import { registerAllHandlers, initializeIpcContext, isForceUpdateRequired, checkAppVersion, isBatchProcessingCancelled, setBatchProcessingCancelled } from './ipc';

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
    mainWindow.webContents.send(channel, ...args);
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

// NOTE: Version checking functionality moved to ipc/version-handlers.ts
// VersionCheckResult interface is in ipc/types.ts
// checkAppVersion function is imported from ipc/version-handlers.ts
// forceUpdateRequired state is managed in ipc/context.ts

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
    person_shown_template?: string; // Template for IPTC PersonInImage field
    participants: Array<{
      numero?: string;
      nome?: string;
      navigatore?: string;
      squadra?: string;
      sponsor?: string;
      metatag?: string;
    }>;
  };

  // Export destinations configuration (automatic export after processing)
  exportDestinations?: {
    enabled: boolean;                   // Enable automatic export to destinations
    destinationIds?: string[];          // Specific destination IDs to export to (empty = all active)
    event?: {                           // Event info for metadata templates
      name?: string;
      date?: string;
      city?: string;
      country?: string;
      location?: string;
    };
  };

  // Visual Tagging configuration
  visualTagging?: {
    enabled: boolean;
    embedInMetadata: boolean;
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
// NOTE: versionCheckResult is now managed in ipc/context.ts

const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

// Cache per URL Supabase delle immagini processate (filePath -> URL)
const supabaseImageUrlCache = new Map<string, string>();


// Helper function to read executions from JSONL logs
async function getExecutionsFromLogs(): Promise<any[]> {
  try {
    const userDataPath = app.getPath('userData');
    const analysisLogsPath = path.join(userDataPath, '.analysis-logs');

    // Check if analysis logs directory exists
    if (!fs.existsSync(analysisLogsPath)) {
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
          continue;
        }

        // Parse first line (EXECUTION_START)
        let startLine;
        try {
          startLine = JSON.parse(lines[0]);
        } catch (parseError) {
          if (DEBUG_MODE) console.warn(`[Executions] SKIPPING ${file}: Failed to parse first line`);
          continue;
        }

        if (startLine.type !== 'EXECUTION_START') {
          if (DEBUG_MODE) console.warn(`[Executions] File ${file} SKIPPED - first line is not EXECUTION_START`);
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

      } catch (error) {
        if (DEBUG_MODE) console.warn(`[Executions] Failed to parse ${file}:`, error);
        continue;
      }
    }

    // Sort by timestamp descending (most recent first)
    executions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return executions.slice(0, 6); // Return only 6 most recent

  } catch (error) {
    console.error('[Executions] Error reading execution logs:', error);
    return [];
  }
}


function createWindow() {
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

  // Set main window reference for face detection bridge (for IPC communication)
  getFaceDetectionBridge().setMainWindow(mainWindow);

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
  if (isForceUpdateRequired()) {
    const forceUpdatePath = path.join(__dirname, '../../renderer/force-update.html');
    mainWindow.loadFile(forceUpdatePath);
  } else {
    const htmlPath = path.join(__dirname, '../../renderer/index.html');
    mainWindow.loadFile(htmlPath);
  }

  // Gestisci i link aperti tramite target="_blank" o window.open
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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

// NOTE: setupDatabaseIpcHandlers() REMOVED - all handlers migrated to:
// - src/ipc/database-handlers.ts
// - src/ipc/supabase-handlers.ts
// - src/ipc/export-handlers.ts
// Total: ~949 lines of dead code removed
//
// Removed handleImageAnalysis since we only support folder processing now
async function handleFolderSelection(event: IpcMainEvent) {
  console.log('[FolderSelection] handleFolderSelection called');
  if (!mainWindow) {
    console.error('handleFolderSelection: mainWindow is null');
    return;
  }

  try {
    console.log('[FolderSelection] Opening dialog...');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleziona una cartella di immagini'
    });

    console.log('[FolderSelection] Dialog result:', { canceled: result.canceled, filePaths: result.filePaths });

    if (result.canceled) {
      // Don't send any message - user simply closed the dialog
      console.log('[FolderSelection] User canceled');
      return;
    }

    const folderPath = result.filePaths[0];
    console.log('[FolderSelection] Selected folder:', folderPath);

    // Verifica se la cartella esiste
    if (!fs.existsSync(folderPath)) {
      console.error('Selected folder does not exist:', folderPath);
      event.sender.send('folder-selected', { success: false, message: 'La cartella selezionata non esiste' });
      return;
    }

    // Ottieni la lista delle immagini nella cartella
    console.log('[FolderSelection] Getting images from folder...');
    const imageFiles = await getImagesFromFolder(folderPath);
    const imageCount = imageFiles.length;
    const rawCount = imageFiles.filter(img => img.isRaw).length;

    console.log('[FolderSelection] Found images:', { imageCount, rawCount });

    // Invia il percorso della cartella e il conteggio delle immagini al renderer process
    const payload = {
      success: true,
      path: folderPath,
      imageCount: imageCount,
      rawCount: rawCount
    };
    console.log('[FolderSelection] Sending folder-selected event with payload:', payload);
    event.sender.send('folder-selected', payload);
    
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
  try {
    // Get current user information
    const authState = authService.getAuthState();
    if (!authState.isAuthenticated || !authState.user) {
      throw new Error('User must be authenticated to request tokens');
    }

    const tokensRequested = parseInt(requestData.tokensRequested);
    
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
      return {
        success: false,
        message: response.error || response.message || 'Request could not be processed',
        requestSaved: response.requestSaved || false,
        paymentRequired: response.paymentRequired || false,
        monthlyUsage: response.monthlyUsage || null
      };
    }

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
  try {
    const tokenBalance = await authService.getTokenBalance();
    return typeof tokenBalance === 'number' ? tokenBalance : tokenBalance.remaining;
  } catch (error: any) {
    console.error('[Main Process] Error getting token balance:', error);
    // Return 0 as fallback to prevent operations
    return 0;
  }
}

// Handle pending tokens request
async function handleGetPendingTokens(event: IpcMainInvokeEvent): Promise<number> {
  try {
    const pendingTokens = await authService.getPendingTokens();
    return pendingTokens;
  } catch (error: any) {
    console.error('[Main Process] Error getting pending tokens:', error);
    return 0;
  }
}

// Handle complete token info request (balance + pending)
async function handleGetTokenInfo(event: IpcMainInvokeEvent): Promise<{ balance: any; pending: number }> {
  try {
    const tokenInfo = await authService.getTokenInfo();
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
  try {
    // Verifica i permessi della cartella
    await fsPromises.access(folderPath, fs.constants.R_OK);
  } catch (err) {
    console.error(`Error accessing folder ${folderPath}:`, err);
    throw new Error(`Cannot access folder: ${folderPath}. Please check permissions.`);
  }
  
  let files: string[];
  try {
    // Leggi tutti i file nella cartella
    files = await fsPromises.readdir(folderPath);
  } catch (err) {
    console.error(`Error reading directory ${folderPath}:`, err);
    throw new Error(`Cannot read directory: ${folderPath}.`);
  }

  const imageFiles = files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ALL_SUPPORTED_EXTENSIONS.includes(ext);
    })
    .map(file => {
      const filePath = path.join(folderPath, file);
      const ext = path.extname(file).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);
      return {
        path: filePath,
        isRaw
      };
    });

  return imageFiles;
}

// Variabile globale per i dati CSV standalone
let csvData: CsvEntry[] = [];

// Funzione originale per il caricamento CSV standalone
async function handleStandaloneCSVLoading(event: IpcMainEvent, fileData: any) {
  try {
    if (!mainWindow) return;
    
    const { buffer, name: fileName } = fileData;
    const fileBuffer = Buffer.from(buffer);

    // Convert buffer to string
    const fileContent = fileBuffer.toString('utf8');
    
    // Parse CSV data manually for better control
    const results: CsvEntry[] = [];
    
    // Split content by lines
    const lines = fileContent.split(/\r?\n/);
    
    // Get headers (first line)
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }
    
    const headers = parseCSVLine(lines[0]);

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
        }
        // Skip rows with missing required fields silently
      }
      // Skip rows with insufficient values silently
    }

    // Store the CSV data globally
    csvData = results;

    // Save CSV to Supabase if user is authenticated
    if (authService.isAuthenticated() && results.length > 0) {
      try {
        await saveCsvToSupabase(results, fileName);
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
  // Se è richiesto il caricamento standalone, usa la funzione dedicata
  if (fileData.standalone) {
    return handleStandaloneCSVLoading(event, fileData);
  }
  
  try {
    if (!mainWindow) return;
    const { buffer: rawBuffer, name: fileName, projectId } = fileData;
    const actualBuffer = Buffer.from(rawBuffer); // Assicura sia un Buffer

    if (projectId) {
      const storagePath = await uploadCsvToStorage(projectId, actualBuffer, fileName);
      const updatedProject = await updateProjectOnline(projectId, { base_csv_storage_path: storagePath });
      mainWindow.webContents.send('csv-loaded', {
        filename: fileName, message: `CSV associato al progetto ${projectId}`, project: updatedProject
      });
    } else {
      // Supporta il caricamento CSV anche senza progetto per analisi one-shot
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
    }

    // Genera un nome file univoco per la preview
    const baseFileName = path.basename(imagePath);
    const previewFileName = `preview_${Date.now()}_${baseFileName}.jpg`;
    const previewPath = path.join(previewFolder, previewFileName);

    // Salva il buffer come file JPEG
    await fsPromises.writeFile(previewPath, previewBuffer);
    
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

        const buffer = await fsPromises.readFile(extractedPath);

        let xmpPath = null;
        if (xmpSidecarExists(imagePath)) {
          xmpPath = imagePath + '.xmp';
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

        const fallbackPath = await rawConverter.convertRawToJpeg(imagePath, outputJpeg);

        const buffer = await fsPromises.readFile(fallbackPath);

        let xmpPath = null;
        if (xmpSidecarExists(imagePath)) {
          xmpPath = imagePath + '.xmp';
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
    const originalFileBuffer = await fsPromises.readFile(imagePath);

    try {
      // Controlla se il resize è abilitato nella configurazione utente
      const resizeConfig = config?.resize;
      const shouldResize = resizeConfig?.enabled && resizeConfig.preset;

      let buffer: Buffer;
      let tempServiceFilePath: string | undefined;

      if (shouldResize) {
        // Applica resize in base alla configurazione utente
        const preset = resizeConfig.preset;
        const presetConfig = RESIZE_PRESETS[preset as ResizePreset];
        
        if (presetConfig) {
          const processor = await createImageProcessor(originalFileBuffer);
          const metadata = await processor.metadata();
          const { width = 0, height = 0 } = metadata;

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

            buffer = await processor
              .resize(newWidth, newHeight, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: presetConfig.jpegQuality, progressive: true })
              .toBuffer();
          } else {
            buffer = originalFileBuffer;
          }
        } else {
          buffer = originalFileBuffer;
        }
      } else {
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
      if (DEBUG_MODE) console.warn('[WARN] Image processing failed. Using original file.');
      return { buffer: originalFileBuffer, mimeType: 'image/jpeg', isRawConverted: false, originalFormat: null, xmpPath: null, tempDngPath: null };
    }
  }
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
      if (DEBUG_MODE) console.log('[Tracking] User not authenticated, skipping tracking');
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
      if (DEBUG_MODE) console.warn('[Tracking] Invalid execution settings data:', validation.errors);
      // Continue with tracking but log validation issues
    }

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
      if (DEBUG_MODE) console.warn('[Tracking] Failed to track execution settings:', error.message);
    }

  } catch (error) {
    if (DEBUG_MODE) console.warn('[Tracking] Error tracking execution settings:', error);
    // Non propaghiamo l'errore per non bloccare l'execution principale
  }
}

async function handleUnifiedImageProcessing(event: IpcMainEvent, config: BatchProcessConfig) {
  if (!mainWindow) {
    console.error('handleUnifiedImageProcessing: mainWindow is null');
    return;
  }

  // Reset cancellation flag from any previous run
  setBatchProcessingCancelled(false);

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

      // Get sport_category_id from category name (e.g., "motorsport" -> UUID)
      let sportCategoryId: string | null = null;
      if (config.category) {
        sportCategoryId = await getSportCategoryIdByName(config.category);
      }

      const newExecution = await createExecutionOnline({
        project_id: config.projectId || null, // NULL per executions standalone
        name: executionName,
        execution_at: new Date().toISOString(),
        status: 'running',
        sport_category_id: sportCategoryId
      });
      currentExecutionId = newExecution.id!;
    } catch (error: any) {
      if (DEBUG_MODE) console.warn('[Tracking] Failed to create execution for tracking:', error);
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
          if (DEBUG_MODE) console.warn(`[Main Process] Could not get stats for ${file}, using current time as fallback`);
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

    // Setup event listeners per progress tracking
    unifiedImageProcessor.removeAllListeners(); // Clear existing listeners

    // Temporal analysis progress events
    unifiedImageProcessor.on('temporal-analysis-started', (data: any) => {
      safeSend('temporal-analysis-started', data);
    });

    unifiedImageProcessor.on('temporal-batch-progress', (data: any) => {
      safeSend('temporal-batch-progress', data);
    });

    unifiedImageProcessor.on('temporal-analysis-complete', (data: any) => {
      safeSend('temporal-analysis-complete', data);
    });

    unifiedImageProcessor.on('recognition-phase-started', (data: any) => {
      safeSend('recognition-phase-started', data);
    });

    unifiedImageProcessor.on('imageProcessed', (result: UnifiedProcessingResult & { processed: number; total: number; phase?: string; step?: number; totalSteps?: number; progress?: number }) => {
      // Fix: Check both result.analysis and fallback to empty array for edge function v2 compatibility
      const analysis = result.analysis || [];

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
      // REMOVED: Don't send summary as batch-complete, it confuses the renderer
      // The actual results array will be sent after processBatch() completes at line 1460
    });

    // Listen for uploaded images to cache their Supabase URLs (for RAW thumbnails)
    unifiedImageProcessor.on('image-uploaded', (data: { originalFileName: string; publicUrl: string }) => {
      // We need to find the original file path for this filename
      // Since we have the filename, we'll cache it by filename for now
      // and during get-local-image we'll try to match by filename
      supabaseImageUrlCache.set(data.originalFileName, data.publicUrl);
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
      } catch (error) {
        // Could not get folder organization config, feature disabled
      }
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
      }
    }

    // DEBUG: Log config details before passing to processor
    const processorConfig = {
      csvData: csvData || [],
      category: config.category || 'motorsport',
      executionId: currentExecutionId || undefined, // Pass execution_id to link images to this execution
      presetId: config.participantPreset?.id || undefined, // Preset ID for loading face descriptors specific to this preset
      participantPresetData: config.participantPreset?.participants || [], // Pass participant data directly to workers
      personShownTemplate: config.participantPreset?.person_shown_template || undefined, // Template for IPTC PersonInImage field
      folderOrganization: folderOrgConfig,
      keywordsMode: config.keywordsMode || 'append', // How to handle existing keywords
      descriptionMode: config.descriptionMode || 'append', // How to handle existing description
      // Apply resize configuration if provided
      ...(resizeConfig && resizeConfig),
      // Add cancellation support
      isCancelled: () => isBatchProcessingCancelled(),
      onTokenUsed: (tokenBalance: any) => {
        if (mainWindow) {
          mainWindow.webContents.send('token-used', tokenBalance);
        }
      },
      // Visual Tagging configuration
      visualTagging: config.visualTagging
    };

    // Configura il processor con i parametri necessari
    unifiedImageProcessor.updateConfig(processorConfig);

    // Start new temporal analysis session for unified processing
    const { SmartMatcher } = await import('./matching/smart-matcher');
    SmartMatcher.startSession();

    // Emit telemetry start event for UI (immediate + via event sender for redundancy)
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
        // End temporal analysis session
        const { SmartMatcher: SmartMatcherEnd2 } = await import('./matching/smart-matcher');
        SmartMatcherEnd2.endSession();

        // Check if processing was cancelled
        const wasCancelled = isBatchProcessingCancelled();

        // Calcola le statistiche finali per il tracciamento
        executionStats.executionDurationMs = Date.now() - executionStartTime;
        executionStats.averageImageProcessingTimeMs = results.length > 0
          ? executionStats.executionDurationMs / results.length
          : 0;

        // Aggiorna status execution se creata
        if (currentExecutionId) {
          try {
            await updateExecutionOnline(currentExecutionId, {
              status: wasCancelled ? 'cancelled' : 'completed',
              results_reference: wasCancelled
                ? `Cancelled after ${results.length}/${executionStats.totalImages} images`
                : `${results.length} images processed`,
              completed_at: new Date().toISOString(),
              total_images: executionStats.totalImages,
              processed_images: results.length
            });
          } catch (error) {
            if (DEBUG_MODE) console.warn('[Tracking] Failed to update execution status:', error);
          }
        }

        // Traccia le impostazioni di questa execution (asincrono, non bloccante)
        if (currentExecutionId) {
          trackExecutionSettings(currentExecutionId, config, executionStats).catch(error => {
            if (DEBUG_MODE) console.warn('[Tracking] Failed to track execution settings:', error);
          });
        }

        // Automatic export to destinations (if configured)
        let exportResult = null;
        if (config.exportDestinations?.enabled) {
          try {
            safeSend('export-started', { totalImages: results.length });

            const exportModule = await import('./utils/export-destination-processor');
            const { exportDestinationProcessor } = exportModule;

            // Get destinations to export to
            let destinations: ExportDestination[];
            if (config.exportDestinations.destinationIds && config.exportDestinations.destinationIds.length > 0) {
              const allDests = await Promise.all(
                config.exportDestinations.destinationIds.map(id => getExportDestinationById(id))
              );
              destinations = allDests.filter((d): d is ExportDestination => d !== null);
            } else {
              destinations = await getActiveExportDestinations();
            }

            if (destinations.length > 0) {
              // Reset processor stats for this batch
              exportDestinationProcessor.resetStats();

              // Convert event date string to Date object
              const eventInfo = config.exportDestinations.event ? {
                name: config.exportDestinations.event.name,
                date: config.exportDestinations.event.date ? new Date(config.exportDestinations.event.date) : undefined,
                city: config.exportDestinations.event.city,
                country: config.exportDestinations.event.country,
                location: config.exportDestinations.event.location
              } : undefined;

              // Process each result
              for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const participant = result.csvMatch ? {
                  numero: result.csvMatch.numero,
                  nome: result.csvMatch.nome,
                  name: result.csvMatch.nome,
                  surname: result.csvMatch.surname,
                  team: result.csvMatch.squadra,
                  squadra: result.csvMatch.squadra,
                  car_model: result.csvMatch.car_model,
                  nationality: result.csvMatch.nationality,
                  categoria: result.csvMatch.categoria
                } : undefined;

                await exportDestinationProcessor.exportToDestinations(
                  result.originalPath,
                  destinations,
                  participant,
                  eventInfo
                );

                // Send progress update
                safeSend('export-progress', {
                  current: i + 1,
                  total: results.length,
                  lastImage: result.originalPath
                });
              }

              const stats = exportDestinationProcessor.getStats();
              exportResult = {
                success: true,
                exported: stats.totalExports,
                failed: stats.failedExports,
                processedImages: stats.processedImages
              };
            }
          } catch (exportError) {
            console.error('[Main Process] Automatic export error:', exportError);
            exportResult = {
              success: false,
              error: exportError instanceof Error ? exportError.message : 'Export failed'
            };
          }
        }

        // Notify renderer: send batch-cancelled if cancelled, batch-complete otherwise
        if (wasCancelled) {
          safeSend('batch-cancelled', {
            results,
            executionId: currentExecutionId,
            processedImages: results.length,
            totalImages: executionStats.totalImages
          });
        }

        // Always send batch-complete so any listener gets the partial/full results
        safeSend('batch-complete', {
          results,
          executionId: currentExecutionId,
          isProcessingComplete: !wasCancelled,
          wasCancelled,
          exportResult
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
          } catch (updateError) {
            if (DEBUG_MODE) console.warn('[Tracking] Failed to update execution status on error:', updateError);
          }

          // Traccia comunque le impostazioni anche in caso di errore
          executionStats.executionDurationMs = Date.now() - executionStartTime;
          trackExecutionSettings(currentExecutionId, config, executionStats).catch(trackError => {
            if (DEBUG_MODE) console.warn('[Tracking] Failed to track execution settings on error:', trackError);
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
  // Reset cancellation flag
  setBatchProcessingCancelled(false);
  
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

      // Get sport_category_id from category name (e.g., "motorsport" -> UUID)
      let sportCategoryId: string | null = null;
      if (config.category) {
        sportCategoryId = await getSportCategoryIdByName(config.category);
      }

      const newExecution = await createExecutionOnline({
        project_id: config.projectId || null, // NULL per executions standalone
        name: executionName,
        execution_at: new Date().toISOString(),
        status: 'running',
        sport_category_id: sportCategoryId
      });
      currentExecutionId = newExecution.id!;
    } catch (error: any) {
      if (DEBUG_MODE) console.warn('[Tracking] Failed to create execution for tracking:', error);
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
    
    // Start new temporal analysis session for batch processing
    const { SmartMatcher } = await import('./matching/smart-matcher');
    SmartMatcher.startSession();

    // Risultati dell'analisi
    const batchResults = [];
    
    // Processa ogni immagine
    for (const imageInfo of imageFiles) {
      // Controlla se il processing è stato cancellato
      if (isBatchProcessingCancelled()) {
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
          } catch (cleanupError) {
            // Cleanup failed, ignore
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
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
            }
            
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
              throw new Error(`Analysis failed: ${response.data.error || 'Unknown function error'}`);
            }

            // If we got here, the function call succeeded
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
          if (mainWindow) {
            mainWindow.webContents.send('token-used', tokenBalance);
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
                  matchType: 'personName',
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
          } catch (previewError) {
            console.error(`Error reading preview for ${fileName}:`, previewError);
          }
        } else {
          // Per file standard, usa il buffer dell'immagine processata
          try {
            const base64Data = fileBuffer.toString('base64');
            previewDataUrl = `data:${mimeType};base64,${base64Data}`;
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
          } catch (dngCleanupError) {
            // DNG cleanup failed, ignore
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
          }
        } catch (dngCleanupError) {
          // DNG cleanup failed, ignore
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
          results_reference: `${completedImages}/${totalImages} images processed successfully`,
          completed_at: new Date().toISOString(),
          total_images: totalImages,
          processed_images: completedImages
        });
      } catch (error) {
        if (DEBUG_MODE) console.warn('[Tracking] Failed to update execution status:', error);
      }
    }

    // Traccia le impostazioni di questa execution (asincrono, non bloccante)
    if (currentExecutionId) {
      trackExecutionSettings(currentExecutionId, config, executionStats).catch(error => {
        if (DEBUG_MODE) console.warn('[Tracking] Failed to track execution settings:', error);
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
      } catch (updateError) {
        if (DEBUG_MODE) console.warn('[Tracking] Failed to update execution status on error:', updateError);
      }

      // Traccia comunque le impostazioni anche in caso di errore
      executionStats.executionDurationMs = Date.now() - executionStartTime;
      trackExecutionSettings(currentExecutionId, config, executionStats).catch(trackError => {
        if (DEBUG_MODE) console.warn('[Tracking] Failed to track execution settings on error:', trackError);
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
        const result = operation();
        resolve(result);
      } catch (error) {
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
    const files = await fsPromises.readdir(folderPath);

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
          } catch (unlinkError) {
            // DNG cleanup failed, ignore
          }
        }
      }
    }
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

    // Per i file RAW, utilizziamo sempre i file XMP sidecar
    if (isRaw) {
      try {
        await createXmpSidecar(imagePath, keywords);
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
        // Use writeKeywordsToImage to handle keywords array properly
        await writeKeywordsToImage(imagePath, keywords);

      } catch (exiftoolError: any) {
        console.error(`Error updating ${imageExt} metadata with ExifTool:`, exiftoolError.message);

        // Fallback: create XMP sidecar if writeKeywordsToImage fails
        try {
          await createXmpSidecar(imagePath, keywords);
        } catch (xmpError) {
          throw new Error(`Failed to update metadata for ${path.basename(imagePath)}: ${exiftoolError.message}`);
        }
      }
    } else {
      // For unsupported formats, create XMP sidecar
      await createXmpSidecar(imagePath, keywords);
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
      mainWindow.webContents.send('raw-preview-status', { status: 'canceled' });
      return;
    }

    const rawFilePath = result.filePaths[0];

    // Verifica che sia effettivamente un file RAW
    const rawFileExtension = path.extname(rawFilePath).toLowerCase();
    if (!RAW_EXTENSIONS.includes(rawFileExtension)) { // Use global RAW_EXTENSIONS
      mainWindow.webContents.send('raw-preview-error', {
        message: 'Il file selezionato non è un formato RAW supportato.'
      });
      return;
    }
    
    // Notifica l'inizio dell'estrazione
    mainWindow.webContents.send('raw-preview-status', { 
      status: 'extracting',
      file: path.basename(rawFilePath)
    });
    
    // Estrai l'anteprima nella stessa cartella del file RAW
    const baseFilename = path.basename(rawFilePath, path.extname(rawFilePath));
    const previewPath = path.join(path.dirname(rawFilePath), `${baseFilename}_preview.jpg`);
    
    // Convert RAW to DNG using the new converter.
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
    } catch (optimizedError: any) {
      console.error(`Optimized full-resolution conversion failed: ${optimizedError.message || 'Unknown error'}`);
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

/**
 * Check and download ONNX models at app startup
 * Shows progress modal in renderer if downloads are needed
 */
async function checkAndDownloadModels(): Promise<void> {
  console.log('[Main Process] checkAndDownloadModels() called');
  try {
    const modelManager = getModelManager();
    console.log('[Main Process] ModelManager instance obtained');

    // Set the authenticated Supabase client
    console.log('[Main Process] Getting Supabase client...');
    const supabaseClient = getSupabaseClient();
    modelManager.setSupabaseClient(supabaseClient);
    console.log('[Main Process] Supabase client set');

    // Check which models need to be downloaded
    console.log('[Main Process] Checking models to download...');
    const { models, totalSizeMB } = await modelManager.getModelsToDownload();
    console.log('[Main Process] Models to download:', models.length, 'Total size:', totalSizeMB, 'MB');

    if (models.length === 0) {
      console.log('[Main Process] No models need download, all up to date');
      return;
    }

    // Notify renderer to show download modal
    safeSend('model-download-start', {
      totalModels: models.length,
      totalSizeMB
    });

    // Download each model with progress tracking
    let downloadedTotal = 0;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];

      await modelManager.downloadModel(model.code, (percent, downloadedMB, totalMB) => {
        safeSend('model-download-progress', {
          currentModel: i + 1,
          totalModels: models.length,
          modelPercent: percent,
          downloadedMB: downloadedTotal + downloadedMB,
          totalMB: totalSizeMB
        });
      });

      downloadedTotal += model.sizeMB;
    }

    // Notify renderer that download is complete
    safeSend('model-download-complete');
  } catch (error) {
    console.error('[Main Process] Error downloading models:', error);
    safeSend('model-download-error', {
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Track app launch for analytics
 * Sends device info to Supabase to track user engagement funnel
 */
async function trackAppLaunch(): Promise<void> {
  try {
    const os = require('os');
    const crypto = require('crypto');
    const { v4: uuidv4 } = require('uuid');

    // Generate machine ID (same as in unified-image-processor)
    const machineIdSource = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || '',
      os.totalmem().toString()
    ].join('|');
    const machineId = crypto.createHash('sha256').update(machineIdSource).digest('hex').substring(0, 16);

    // Generate session ID for this launch
    const sessionId = uuidv4();

    // Get hardware info
    const cpus = os.cpus();
    const totalRamGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));

    // Check if user is logged in
    const { authService } = await import('./auth-service');
    const authState = authService.getAuthState();
    const userId = authState.isAuthenticated ? authState.user?.id : null;

    // Get Supabase client
    const { getSupabaseClient } = await import('./database-service');
    const supabase = getSupabaseClient();

    // Check if this is the first launch for this machine
    const { data: existingLaunches, error: countError } = await supabase
      .from('app_launches')
      .select('id, app_version')
      .eq('machine_id', machineId)
      .limit(1);

    const isFirstLaunch = !existingLaunches || existingLaunches.length === 0;
    const isFirstLaunchThisVersion = isFirstLaunch ||
      !existingLaunches.some((l: any) => l.app_version === app.getVersion());

    // Get launch count for this machine
    const { count: launchCount } = await supabase
      .from('app_launches')
      .select('id', { count: 'exact', head: true })
      .eq('machine_id', machineId);

    // Insert launch record
    const launchData = {
      user_id: userId,
      machine_id: machineId,
      hostname: os.hostname(),
      platform: os.platform(),
      username: os.userInfo().username,
      app_version: app.getVersion(),
      electron_version: process.versions.electron || 'N/A',
      node_version: process.version,
      cpu: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      ram_gb: totalRamGB,
      architecture: `${os.platform()} ${os.arch()} - ${os.release()}`,
      is_first_launch: isFirstLaunch,
      is_first_launch_this_version: isFirstLaunchThisVersion,
      launch_count: (launchCount || 0) + 1,
      session_id: sessionId
    };

    const { error: insertError } = await supabase
      .from('app_launches')
      .insert(launchData);

    if (insertError) {
      // If RLS blocks (user not logged in), try with service role via edge function
      if (insertError.code === '42501' || insertError.message?.includes('policy')) {
        console.log('[AppLaunch] RLS blocked insert, user may not be logged in');
      } else {
        console.warn('[AppLaunch] Insert error:', insertError.message);
      }
    } else {
      console.log(`[AppLaunch] Tracked: ${isFirstLaunch ? 'FIRST LAUNCH' : `launch #${(launchCount || 0) + 1}`} for ${os.hostname()}`);
    }

    // Store session ID for correlation with executions
    (global as any).__racetagger_session_id = sessionId;

  } catch (error: any) {
    console.warn('[AppLaunch] Tracking failed (non-critical):', error.message);
  }
}

/**
 * Log a consolidated startup health report to the console.
 * Each check is individually wrapped in try/catch with a 3s timeout
 * so one failure never blocks others or delays startup.
 */
async function logStartupHealthReport(startupMs: number): Promise<void> {
  try {
    const results: Array<{ name: string; status: 'OK' | 'WARN' | 'FAIL'; detail: string }> = [];

    const withTimeout = <T>(promise: Promise<T>, fallback: T, ms = 3000): Promise<T> =>
      Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

    // 1. Sharp
    try {
      require('sharp');
      // If sharp can be required it's loaded; fast-mode was already confirmed at initializeImageProcessor
      results.push({ name: 'Sharp', status: 'OK', detail: 'working (fast mode)' });
    } catch {
      results.push({ name: 'Sharp', status: 'WARN', detail: 'fallback to Jimp (slow mode)' });
    }

    // 2. better-sqlite3
    try {
      const { db } = require('./database-service');
      if (db) {
        const walMode = db.pragma('journal_mode', { simple: true });
        results.push({ name: 'better-sqlite3', status: 'OK', detail: `working (${walMode} mode)` });
      } else {
        results.push({ name: 'better-sqlite3', status: 'FAIL', detail: 'not initialized' });
      }
    } catch (e: any) {
      results.push({ name: 'better-sqlite3', status: 'FAIL', detail: e.message || 'load error' });
    }

    // 3. Supabase cache
    try {
      const categories = getCachedSportCategories();
      const presets = getCachedParticipantPresets();
      const catCount = categories?.length ?? 0;
      const presetCount = presets?.length ?? 0;
      if (catCount > 0) {
        results.push({ name: 'Supabase', status: 'OK', detail: `connected (categories: ${catCount}, presets: ${presetCount})` });
      } else {
        results.push({ name: 'Supabase', status: 'WARN', detail: 'cache empty (offline or not authenticated)' });
      }
    } catch {
      results.push({ name: 'Supabase', status: 'WARN', detail: 'cache unavailable' });
    }

    // 4. Auth session
    try {
      const authState = authService.getAuthState();
      if (authState.isAuthenticated && authState.user) {
        const email = authState.user.email || 'unknown';
        results.push({ name: 'Auth Session', status: 'OK', detail: `authenticated (${email})` });
      } else {
        results.push({ name: 'Auth Session', status: 'WARN', detail: 'not authenticated' });
      }
    } catch {
      results.push({ name: 'Auth Session', status: 'WARN', detail: 'check failed' });
    }

    // 5. Native tools (dcraw, ExifTool, ImageMagick)
    try {
      const { nativeToolManager } = require('./utils/native-tool-manager');
      const diag: any = await withTimeout(nativeToolManager.getSystemDiagnostics(), null as any);
      if (diag && diag.tools) {
        for (const [toolName, info] of Object.entries(diag.tools) as [string, any][]) {
          const displayName = toolName === 'exiftool' ? 'ExifTool' : toolName === 'dcraw' ? 'dcraw' : 'ImageMagick';
          if (info.working) {
            const loc = info.path ? ` (${info.path})` : '';
            results.push({ name: displayName, status: 'OK', detail: `working${loc}` });
          } else if (info.exists) {
            results.push({ name: displayName, status: 'WARN', detail: 'found but not working' });
          } else {
            const isOptional = toolName === 'imagemagick';
            results.push({ name: displayName, status: isOptional ? 'WARN' : 'FAIL', detail: `not found${isOptional ? ' (optional)' : ''}` });
          }
        }
      }
    } catch {
      results.push({ name: 'Native Tools', status: 'WARN', detail: 'diagnostic check failed' });
    }

    // 6. ONNX Runtime
    try {
      require('onnxruntime-node');
      results.push({ name: 'ONNX Runtime', status: 'OK', detail: 'loaded' });
    } catch {
      results.push({ name: 'ONNX Runtime', status: 'WARN', detail: 'not available' });
    }

    // 7. raw-preview-extractor
    try {
      require('raw-preview-extractor');
      results.push({ name: 'raw-preview-ext', status: 'OK', detail: 'loaded' });
    } catch {
      results.push({ name: 'raw-preview-ext', status: 'WARN', detail: 'not available' });
    }

    // 8. Network
    try {
      const online = net.isOnline();
      if (online) {
        // Attempt a quick latency check via networkMonitor
        let latencyStr = '';
        try {
          const { networkMonitor } = require('./utils/network-monitor');
          const metrics: any = await withTimeout(networkMonitor.getInitialMetrics(2000), null as any, 3000);
          if (metrics?.supabase_latency_ms) {
            latencyStr = ` (latency: ${Math.round(metrics.supabase_latency_ms)}ms)`;
          }
        } catch { /* latency check optional */ }
        results.push({ name: 'Network', status: 'OK', detail: `online${latencyStr}` });
      } else {
        results.push({ name: 'Network', status: 'WARN', detail: 'offline' });
      }
    } catch {
      results.push({ name: 'Network', status: 'WARN', detail: 'status unknown' });
    }

    // 9. Disk Space + Hardware
    let cpuStr = '';
    let ramStr = '';
    try {
      const { hardwareDetector } = require('./utils/hardware-detector');
      const hw: any = await withTimeout(hardwareDetector.getHardwareInfo(), null as any);
      if (hw) {
        results.push({ name: 'Disk Space', status: hw.disk_available_gb > 5 ? 'OK' : 'WARN', detail: `${hw.disk_available_gb.toFixed(1)} GB free` });
        cpuStr = `${hw.cpu_model} (${hw.cpu_cores} cores)`;
        ramStr = `${hw.ram_total_gb.toFixed(1)} GB`;
      }
    } catch {
      results.push({ name: 'Disk Space', status: 'WARN', detail: 'check failed' });
    }

    // Format and log
    const sep = '\u2550'.repeat(50);
    const thin = '\u2500'.repeat(50);
    const lines: string[] = [];

    const logLine = (line: string) => {
      console.log(line);
      lines.push(line);
    };

    logLine(`[RaceTagger] ${sep}`);
    logLine(`[RaceTagger] Startup Health Report - v${app.getVersion()}`);
    logLine(`[RaceTagger] ${sep}`);
    for (const r of results) {
      const icon = r.status === 'OK' ? '\u2705' : r.status === 'WARN' ? '\u26A0\uFE0F' : '\u274C';
      const name = r.name.padEnd(18);
      logLine(`[RaceTagger]  ${icon} ${name}\u2502 ${r.detail}`);
    }
    logLine(`[RaceTagger] ${thin}`);
    logLine(`[RaceTagger]  Platform: ${process.platform} ${process.arch} \u2502 Electron ${process.versions.electron}`);
    if (ramStr || cpuStr) {
      logLine(`[RaceTagger]  RAM: ${ramStr || 'N/A'} \u2502 CPU: ${cpuStr || 'N/A'}`);
    }
    logLine(`[RaceTagger]  Startup: ${startupMs.toLocaleString()}ms`);
    logLine(`[RaceTagger] ${sep}`);

    // Also send to renderer DevTools console
    safeSend('startup-health-report', lines);
  } catch (error) {
    console.error('[RaceTagger] Failed to generate health report:', error);
  }
}

app.whenReady().then(async () => { // Added async here
  const startupStart = Date.now();

  // Set app name for proper dock/taskbar display
  app.setName('RaceTagger');

  if (DEBUG_MODE) console.log('[RaceTagger] App started');

  // Initialize @electron/remote now that app is ready
  try {
    const { initialize, enable } = require('@electron/remote/main');
    initialize();
    remoteEnable = enable; // Store enable function for use in createWindow
  } catch (error) {
    console.error('[Main Process] Failed to initialize @electron/remote:', error);
  }

  // Set isDev flag now that app is ready
  try {
    isDev = !app.isPackaged;
  } catch {
    isDev = true; // Default to dev mode if check fails
  }

  // Initialize image processor (Sharp/Jimp) ONCE at startup
  if (DEBUG_MODE) console.log('[RaceTagger] Initializing image processor...');
  await initializeImageProcessor();

  // Check app version before creating window
  await checkAppVersion();

  // NOTE: These handlers are now in app-handlers.ts
  // ipcMain.handle('get-app-path', ...)
  // ipcMain.handle('get-app-version', ...)
  // ipcMain.handle('get-max-supported-edge-function-version', ...)

  // CRITICAL: Register all IPC handlers BEFORE creating window to avoid race conditions
  // Token handlers - these remain in main.ts (will migrate to auth-handlers.ts later)
  ipcMain.handle('submit-token-request', handleTokenRequest);
  ipcMain.handle('get-token-balance', handleGetTokenBalance);
  ipcMain.handle('get-pending-tokens', handleGetPendingTokens);
  ipcMain.handle('get-token-info', handleGetTokenInfo);

  // Register modular IPC handlers BEFORE window creation
  registerAllHandlers();

  createWindow();

  // Initialize IPC context with mainWindow reference
  if (mainWindow) {
    initializeIpcContext(mainWindow);
  }

  // Track app launch for analytics (non-blocking)
  trackAppLaunch().catch(err => {
    console.warn('[AppLaunch] Failed to track launch (non-critical):', err.message);
  });

  // Cleanup temp files older than 7 days at startup and start periodic cleanup
  try {
    await rawConverter.cleanupAllTempFiles();

    // Cleanup files from the centralized temp directory (older than 7 days)
    // PERFORMANCE: Use singleton to avoid memory leak (MaxListenersExceededWarning)
    const { getCleanupManager } = require('./utils/cleanup-manager');
    const cleanupManager = getCleanupManager();
    await cleanupManager.startupCleanup();

    // Start periodic cleanup (every 24h, files older than 7 days)
    cleanupManager.startPeriodicCleanup();
  } catch (cleanupError) {
    console.error('[Main Process] Error during startup cleanup:', cleanupError);
  }

  initializeDatabaseSchema();

  // Initialize Supabase cache after authentication is ready
  try {
    await cacheSupabaseData();
  } catch (cacheError) {
    console.error('[Main Process] Error caching Supabase data:', cacheError);
    // Don't fail startup if cache fails, data will be loaded on-demand
  }

  // Check and download ONNX models at startup
  try {
    await checkAndDownloadModels();
  } catch (modelError) {
    console.error('[Main Process] Error checking/downloading models:', modelError);
    // Don't fail startup if model download fails
  }

  // Log startup health report (non-blocking, all checks have individual timeouts)
  await logStartupHealthReport(Date.now() - startupStart);

  ipcMain.on('select-folder', handleFolderSelection);

  // Handle folder selection by path (drag & drop)
  ipcMain.on('select-folder-by-path', async (event, folderPath: string) => {
    try {
      console.log('[FolderSelection] select-folder-by-path called with:', folderPath);

      if (!folderPath || !fs.existsSync(folderPath)) {
        event.sender.send('folder-selected', { success: false, message: 'La cartella selezionata non esiste' });
        return;
      }

      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        event.sender.send('folder-selected', { success: false, message: 'Il percorso selezionato non è una cartella' });
        return;
      }

      const imageFiles = await getImagesFromFolder(folderPath);
      const imageCount = imageFiles.length;
      const rawCount = imageFiles.filter(img => img.isRaw).length;

      const payload = {
        success: true,
        path: folderPath,
        imageCount,
        rawCount
      };
      console.log('[FolderSelection] Sending folder-selected event with payload:', payload);
      event.sender.send('folder-selected', payload);

      if (batchConfig) {
        batchConfig.folderPath = folderPath;
      } else {
        batchConfig = { folderPath, updateExif: false };
      }
    } catch (error) {
      console.error('Error during folder selection by path:', error);
      event.sender.send('folder-selected', { success: false, message: 'Errore durante la selezione della cartella' });
    }
  });
  
  // NOTE: Version checking IPC handlers moved to version-handlers.ts
  // (check-app-version, get-version-check-result, is-force-update-required, quit-app-for-update)

  // NOTE: These handlers are now in app-handlers.ts
  // - check-adobe-dng-converter
  // - open-download-url
  // NOTE: Token handlers (submit-token-request, get-token-balance, get-pending-tokens, get-token-info)
  // are now registered BEFORE createWindow() to avoid race conditions
  // NOTE: cancel-batch-processing is now in analysis-handlers.ts

  // NOTE: These handlers are now in app-handlers.ts:
  // - get-training-consent
  // - set-training-consent
  // - get-consent-status
  // - get-full-settings

  // FOLDER ORGANIZATION: IPC handlers (available for all authenticated users)
  if (APP_CONFIG.features.ENABLE_FOLDER_ORGANIZATION) {
    // Post-analysis folder organization
    ipcMain.handle('organize-results-post-analysis', async (_, data: {
      executionId: string;
      folderOrganizationConfig: any;
    }) => {
      try {
        const { executionId, folderOrganizationConfig } = data;

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
            return null;
          }
        }).filter(Boolean);

        // Block repeated "move" operations - files are no longer at original paths
        if (folderOrganizationConfig.mode === 'move') {
          const alreadyMoved = logEvents.some((event: any) => event.type === 'ORGANIZATION_MOVE_COMPLETED');
          if (alreadyMoved) {
            return {
              success: false,
              error: 'Files have already been moved for this execution. The original files are no longer at their original paths. Use "Copy" mode instead if you need to reorganize.'
            };
          }
        }

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
              errors.push(`No original path found for ${fileName}`);
              continue;
            }

            // Check if file still exists
            if (!fs.existsSync(originalPath)) {
              errors.push(`File not found: ${fileName} (may have been moved)`);
              continue;
            }

            // Handle scene-skipped images -> route to "Others" folder
            const isSceneSkipped = event.sceneSkipped ||
              (event.aiResponse?.totalVehicles === 0 &&
               event.aiResponse?.rawText?.startsWith('SKIPPED:'));

            if (isSceneSkipped) {
              // Extract scene category from structured field or parse from rawText
              let sceneCategory = event.sceneCategory;
              if (!sceneCategory && event.aiResponse?.rawText) {
                const match = event.aiResponse.rawText.match(/SKIPPED:\s*(\w+)\s+scene/);
                if (match) sceneCategory = match[1];
              }

              const sceneResult = await organizer.organizeGenericScene(
                originalPath,
                sceneCategory || 'unknown_scene',
                path.dirname(originalPath)
              );
              results.push(sceneResult);
              continue;
            }

            // Get final race numbers (apply corrections if any)
            let raceNumbers: string[] = [];
            if (event.aiResponse?.vehicles) {
              event.aiResponse.vehicles.forEach((vehicle: any, index: number) => {
                const key = `${fileName}_${index}`;
                const correction = correctionMap.get(key);

                if (correction && correction.number) {
                  raceNumbers.push(correction.number);
                } else if (vehicle.finalResult?.raceNumber) {
                  raceNumbers.push(vehicle.finalResult.raceNumber);
                } else if (vehicle.raceNumber) {
                  raceNumbers.push(vehicle.raceNumber);
                }
              });
            }

            if (raceNumbers.length === 0) {
              raceNumbers = ['unknown'];
            }

            // Collect CSV data for ALL vehicles (not just the first)
            const csvDataList: any[] = [];
            if (event.aiResponse?.vehicles) {
              event.aiResponse.vehicles.forEach((vehicle: any) => {
                if (vehicle.participantMatch) {
                  const match = vehicle.participantMatch;
                  csvDataList.push({
                    numero: match.numero,
                    nome: match.nome_pilota || match.nome,
                    categoria: match.categoria,
                    squadra: match.squadra,
                    metatag: match.metatag,
                    folder_1: match.folder_1,
                    folder_2: match.folder_2,
                    folder_3: match.folder_3,
                    folder_1_path: match.folder_1_path,
                    folder_2_path: match.folder_2_path,
                    folder_3_path: match.folder_3_path
                  });
                }
              });
            }

            // Organize the image
            const result = await organizer.organizeImage(
              originalPath,
              raceNumbers,
              csvDataList.length > 0 ? csvDataList : undefined
            );

            results.push(result);

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Main Process] Error organizing image:`, errorMsg);
            errors.push(`${event.fileName}: ${errorMsg}`);
          }
        }

        // Get summary
        const summary = organizer.getSummary();

        // Record move completion in the JSONL log to prevent repeated moves
        if (folderOrganizationConfig.mode === 'move' && summary.organizedFiles > 0) {
          try {
            const moveCompletedEvent = JSON.stringify({
              type: 'ORGANIZATION_MOVE_COMPLETED',
              timestamp: new Date().toISOString(),
              executionId,
              organizedFiles: summary.organizedFiles,
              foldersCreated: summary.foldersCreated
            }) + '\n';
            fs.appendFileSync(logFilePath, moveCompletedEvent);
            console.log(`[Main Process] Recorded ORGANIZATION_MOVE_COMPLETED for execution ${executionId}`);
          } catch (logError) {
            console.error('[Main Process] Failed to record move completion:', logError);
          }
        }

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

    // Check if a move organization was already completed for an execution
    ipcMain.handle('check-organization-move-completed', async (_, executionId: string) => {
      try {
        const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
        const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

        if (!fs.existsSync(logFilePath)) {
          return { completed: false };
        }

        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        const logLines = logContent.trim().split('\n').filter(line => line.trim());

        for (const line of logLines) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'ORGANIZATION_MOVE_COMPLETED') {
              return { completed: true, timestamp: event.timestamp };
            }
          } catch {
            // Skip malformed lines
          }
        }

        return { completed: false };
      } catch (error) {
        console.error('[Main Process] Error checking move completion:', error);
        return { completed: false };
      }
    });
  }


  // NOTE: debug-sharp handler is now in app-handlers.ts

  // NOTE: Enhanced File Browser IPC handlers are now in file-handlers.ts:
  // - dialog-show-open
  // - show-save-dialog
  // - write-file
  // - get-folder-files
  // - get-file-stats

  // NOTE: generate-thumbnail is now in image-handlers.ts
  // NOTE: get-halfsize-image is now in image-handlers.ts
  // NOTE: get-supabase-image-url is now in image-handlers.ts
  // NOTE: get-local-image is now in image-handlers.ts
  // NOTE: list-files-in-folder is now in file-handlers.ts
  // NOTE: load-csv is now in csv-handlers.ts
  // NOTE: download-csv-template is now in csv-handlers.ts

  ipcMain.on('analyze-folder', (event: IpcMainEvent, config: BatchProcessConfig) => {
    // Always use unified processor
    handleUnifiedImageProcessing(event, config);
  });
  
  
  ipcMain.on('extract-raw-preview', handleRawPreviewExtraction);
  ipcMain.on('submit-feedback', handleFeedbackSubmission);

  // NOTE: count-folder-images is now in file-handlers.ts
  // NOTE: get-pipeline-config is now in analysis-handlers.ts
  // NOTE: get-execution-log is now in analysis-handlers.ts
  // NOTE: update-analysis-log is now in analysis-handlers.ts

  // =====================================================
  // REMAINING LOG VISUALIZER IPC HANDLERS (to be removed)
  // =====================================================

  // DUPLICATE - TODO: Remove after testing - get-execution-log is now in analysis-handlers.ts
  ipcMain.handle('get-execution-log-DEPRECATED', async (_, executionId: string) => {
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
        return { success: true, data: mockLogData };
      }

      const logsDir = path.join(app.getPath('userData'), '.analysis-logs');
      const logFilePath = path.join(logsDir, `exec_${executionId}.jsonl`);

      if (!fs.existsSync(logFilePath)) {
        return { success: true, data: [] }; // Return empty array if no log file
      }

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());
      const logEvents = logLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      }).filter(Boolean);

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

      // Read existing log
      let logEvents: any[] = [];
      let executionStartEvent: any = null;
      let executionCompleteEvent: any = null;

      if (fs.existsSync(logFilePath)) {
        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        const logLines = logContent.trim().split('\n').filter(line => line.trim());

        logEvents = logLines.map((line, index) => {
          try {
            const event = JSON.parse(line);
            // Preserve the EXECUTION_START event separately to ensure it's never lost
            if (event.type === 'EXECUTION_START' && index === 0) {
              executionStartEvent = event;
            }
            // Preserve the EXECUTION_COMPLETE event separately to ensure it's always last
            else if (event.type === 'EXECUTION_COMPLETE') {
              executionCompleteEvent = event;
            }
            return event;
          } catch (error) {
            return null;
          }
        }).filter(Boolean);

        // Critical validation: Ensure EXECUTION_START is preserved
        if (!executionStartEvent) {
          if (logEvents.length > 0 && logEvents[0].type !== 'EXECUTION_START') {
            // Try to find EXECUTION_START elsewhere in the log
            const foundStart = logEvents.find(event => event.type === 'EXECUTION_START');
            if (foundStart) {
              executionStartEvent = foundStart;
            }
          }
        }

        // If EXECUTION_START is still missing, create a minimal one to prevent execution disappearance
        if (!executionStartEvent) {
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

        }

        // Update image metadata using exiftool
        try {
          await updateImageMetadataWithCorrection(
            correction,
            imageAnalysisEvent?.originalPath,
            imageAnalysisEvent?.organizedPath
          );
        } catch (metadataError) {
          if (DEBUG_MODE) console.warn('[Main Process] Failed to update image metadata:', metadataError);
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

        if (DEBUG_MODE) console.log('[Main Process] Updated EXECUTION_COMPLETE event with manual correction stats');
      } else {
        if (DEBUG_MODE) console.log('[Main Process] No EXECUTION_COMPLETE event found - execution was not completed yet');
      }

      // Ensure proper event ordering: EXECUTION_START first, EXECUTION_COMPLETE last

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
      }

      // Validation for proper event ordering (only log errors, not success)
      if (finalEvents[0].type !== 'EXECUTION_START') {
        console.error('[Main Process] CRITICAL: EXECUTION_START is not first event! This will cause execution disappearance.');
      }

      // Validate EXECUTION_COMPLETE positioning
      if (executionCompleteEvent && finalEvents.length > 1) {
        const lastEvent = finalEvents[finalEvents.length - 1];
        if (lastEvent.type !== 'EXECUTION_COMPLETE') {
          console.error('[Main Process] CRITICAL: EXECUTION_COMPLETE is not last event! This will show execution as "processing".');
        }
      }

      // Write updated log back to file
      const updatedLogContent = finalEvents.map(event => JSON.stringify(event)).join('\n') + '\n';
      fs.writeFileSync(logFilePath, updatedLogContent, 'utf-8');

      // CRITICAL VALIDATION: Verify file integrity after saving
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
          throw new Error(`First event is ${firstEvent.type}, not EXECUTION_START`);
        }

        if (firstEvent.executionId !== executionId) {
          console.error('[Main Process] CRITICAL ERROR: ExecutionId mismatch!');
          throw new Error('ExecutionId mismatch in EXECUTION_START event');
        }

        // Verify EXECUTION_COMPLETE is last event (if it exists)
        if (executionCompleteEvent && verificationLines.length > 1) {
          const lastEvent = JSON.parse(verificationLines[verificationLines.length - 1]);
          if (lastEvent.type !== 'EXECUTION_COMPLETE') {
            console.error('[Main Process] CRITICAL ERROR: Last event is not EXECUTION_COMPLETE after save!');
            throw new Error(`Last event is ${lastEvent.type}, not EXECUTION_COMPLETE`);
          }
        }
      } catch (verificationError) {
        console.error('[Main Process] CRITICAL: File verification failed!', verificationError);
      }

      // Upload updated log to Supabase if possible
      try {
        const { getSupabaseClient } = await import('./database-service');
        const supabase = getSupabaseClient();
        const userId = authService.getAuthState().user?.id || 'unknown';
        const date = new Date().toISOString().split('T')[0];
        const supabaseUploadPath = `${userId}/${date}/exec_${executionId}.jsonl`;

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
          if (DEBUG_MODE) console.warn('[Main Process] Direct upload failed:', error);
        } else {
          // Also create/update metadata record
          await supabase
            .from('analysis_log_metadata')
            .upsert({
              execution_id: executionId,
              user_id: userId,
              storage_path: supabaseUploadPath,
              total_images: 0,
              total_corrections: corrections.length,
              correction_types: { USER_MANUAL: corrections.length },
              category: 'unknown',
              app_version: app.getVersion()
            });
        }
      } catch (uploadError) {
        if (DEBUG_MODE) console.warn('[Main Process] Failed to upload updated log to Supabase:', uploadError);
      }

      if (DEBUG_MODE) console.log(`[Main Process] Updated analysis log with ${corrections.length} manual corrections`);
      return { success: true };

    } catch (error) {
      console.error('[Main Process] Error updating analysis log:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================
  // NOTE: Face Recognition IPC Handlers moved to face-recognition-handlers.ts
  // (face-recognition-initialize, face-recognition-load-descriptors,
  //  face-recognition-match, face-recognition-status, face-recognition-clear,
  //  face-recognition-load-from-database)
  // ============================================

  // Update image metadata with manual correction
  async function updateImageMetadataWithCorrection(
    correction: {
      fileName: string;
      vehicleIndex: number;
      changes: any;
    },
    originalPath?: string,
    organizedPath?: string
  ) {
    try {
      // Use organized path (after move/copy) if available, otherwise original
      const effectivePath = organizedPath || originalPath;

      if (!effectivePath) {
        if (DEBUG_MODE) console.warn(`[Main Process] No path available for ${correction.fileName}, skipping metadata update`);
        return { success: false, reason: 'no_path' };
      }

      if (!fs.existsSync(effectivePath)) {
        if (DEBUG_MODE) console.warn(`[Main Process] File not found at ${effectivePath}, skipping metadata update`);
        return { success: false, reason: 'file_not_found' };
      }

      // Build keywords from correction changes
      const keywords: string[] = [];
      if (correction.changes.raceNumber) {
        keywords.push(`RaceNumber:${correction.changes.raceNumber}`);
      }
      if (correction.changes.team) {
        keywords.push(`Team:${correction.changes.team}`);
      }
      if (correction.changes.drivers) {
        const drivers = Array.isArray(correction.changes.drivers)
          ? correction.changes.drivers
          : [correction.changes.drivers];
        drivers.forEach((driver: string) => {
          if (driver) keywords.push(`Driver:${driver}`);
        });
      }

      if (keywords.length > 0) {
        if (DEBUG_MODE) console.log(`[Main Process] Writing corrected metadata to ${effectivePath}:`, keywords);
        await writeKeywordsToImage(effectivePath, keywords, true, 'overwrite');
      }

      return { success: true };

    } catch (error) {
      console.error('[Main Process] Error updating image metadata:', error);
      throw error;
    }
  }

  if (DEBUG_MODE) console.log('[Main Process] All IPC .on listeners set up');

  app.on('activate', () => {
    if (DEBUG_MODE) console.log('[Main Process] app event: activate');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (DEBUG_MODE) console.log('[Main Process] app.activate listener set up');
});

app.on('window-all-closed', () => {
  if (DEBUG_MODE) console.log('[Main Process] app event: window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
if (DEBUG_MODE) console.log('[Main Process] window-all-closed listener set up');

function parseCSVLine(line: string): string[] {
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

// Handle app termination signals
process.on('SIGTERM', async () => {
  if (DEBUG_MODE) console.log('[Main Process] Received SIGTERM, shutting down gracefully...');
  await performCleanup();
  app.quit();
});

process.on('SIGINT', async () => {
  if (DEBUG_MODE) console.log('[Main Process] Received SIGINT, shutting down gracefully...');
  await performCleanup();
  app.quit();
});

// Handle app quit event
app.on('before-quit', async () => {
  if (DEBUG_MODE) console.log('[Main Process] App is about to quit, performing cleanup...');
  await performCleanup();
});

// Cleanup function
async function performCleanup(): Promise<void> {
  if (DEBUG_MODE) console.log('[Main Process] Starting cleanup process...');

  try {
    // Cancel any running batch processing
    setBatchProcessingCancelled(true);

    // Cleanup auth service resources
    authService.cleanup();

    // Cleanup all temp files at shutdown
    try {
      await rawConverter.cleanupAllTempFiles();
    } catch (cleanupError) {
      console.error('[Main Process] Error during shutdown cleanup:', cleanupError);
    }

    if (DEBUG_MODE) console.log('[Main Process] Cleanup completed successfully');
  } catch (error) {
    console.error('[Main Process] Error during cleanup:', error);
  }
}
