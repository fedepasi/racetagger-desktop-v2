/**
 * Folder and CSV IPC Handlers
 * Handles folder selection, image scanning, and CSV loading operations
 */

import { app, dialog, ipcMain, IpcMainEvent, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { authService } from '../../auth-service';
import {
  saveCsvToSupabase,
  uploadCsvToStorage,
  updateProjectOnline
} from '../../database-service';

// File extension constants
const RAW_EXTENSIONS = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
const STANDARD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALL_SUPPORTED_EXTENSIONS = [...STANDARD_EXTENSIONS, ...RAW_EXTENSIONS];

// Type for CSV entry
export type CsvEntry = {
  numero: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  metatag: string;
  [key: string]: string | undefined;
};

// Type for batch config
export type BatchConfig = {
  folderPath: string;
  updateExif: boolean;
  [key: string]: any;
};

// Dependencies interface
export interface FolderCsvHandlersDependencies {
  getMainWindow: () => BrowserWindow | null;
  getCsvData: () => CsvEntry[];
  setCsvData: (data: CsvEntry[]) => void;
  getGlobalCsvData: () => CsvEntry[];
  setGlobalCsvData: (data: CsvEntry[]) => void;
  getBatchConfig: () => BatchConfig | null;
  setBatchConfig: (config: BatchConfig | null) => void;
}

let deps: FolderCsvHandlersDependencies;

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Get images from a folder
 */
export async function getImagesFromFolder(folderPath: string): Promise<{ path: string; isRaw: boolean }[]> {
  console.log('[Main Process] getImagesFromFolder called.');
  console.log(`Scanning folder: ${folderPath}`);

  try {
    await fsPromises.access(folderPath, fs.constants.R_OK);
    console.log(`Folder ${folderPath} is readable.`);
  } catch (err) {
    console.error(`Error accessing folder ${folderPath}:`, err);
    throw new Error(`Cannot access folder: ${folderPath}. Please check permissions.`);
  }

  let files: string[];
  try {
    files = await fsPromises.readdir(folderPath);
    console.log(`Total files found in folder: ${files.length}`);
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
      return { path: filePath, isRaw };
    });

  const rawFiles = imageFiles.filter(img => img.isRaw);
  console.log(`Found ${imageFiles.length} images (${rawFiles.length} RAW files)`);

  return imageFiles;
}

/**
 * Handle folder selection dialog
 */
async function handleFolderSelection(event: IpcMainEvent): Promise<void> {
  console.log('[Main Process] handleFolderSelection called.');
  const mainWindow = deps.getMainWindow();

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
      return;
    }

    const folderPath = result.filePaths[0];
    console.log('Selected folder:', folderPath);

    if (!fs.existsSync(folderPath)) {
      console.error('Selected folder does not exist:', folderPath);
      event.sender.send('folder-selected', { success: false, message: 'La cartella selezionata non esiste' });
      return;
    }

    const imageFiles = await getImagesFromFolder(folderPath);
    const imageCount = imageFiles.length;
    const rawCount = imageFiles.filter(img => img.isRaw).length;
    console.log(`Found ${imageCount} images in folder (${rawCount} RAW files)`);

    event.sender.send('folder-selected', {
      success: true,
      path: folderPath,
      imageCount: imageCount,
      rawCount: rawCount
    });

    // Save folder path for future use
    const currentConfig = deps.getBatchConfig();
    if (currentConfig) {
      currentConfig.folderPath = folderPath;
      deps.setBatchConfig(currentConfig);
    } else {
      deps.setBatchConfig({ folderPath, updateExif: false });
    }
  } catch (error) {
    console.error('Error during folder selection:', error);
    event.sender.send('folder-selected', { success: false, message: 'Errore durante la selezione della cartella' });
  }
}

/**
 * Handle standalone CSV loading
 */
async function handleStandaloneCSVLoading(event: IpcMainEvent, fileData: any): Promise<void> {
  const mainWindow = deps.getMainWindow();
  try {
    if (!mainWindow) return;

    const { buffer, name: fileName } = fileData;
    const fileBuffer = Buffer.from(buffer);
    const fileContent = fileBuffer.toString('utf8');

    const results: CsvEntry[] = [];
    const lines = fileContent.split(/\r?\n/);

    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }

    const headers = parseCSVLine(lines[0]);
    const numeroIndex = headers.indexOf('numero');
    const metatagIndex = headers.indexOf('metatag');
    const nomeIndex = headers.indexOf('nome');
    const categoriaIndex = headers.indexOf('categoria');
    const squadraIndex = headers.indexOf('squadra');

    if (numeroIndex === -1 || metatagIndex === -1) {
      throw new Error('CSV file must have "numero" and "metatag" columns');
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);

      if (values.length >= Math.max(numeroIndex, metatagIndex) + 1) {
        const numero = values[numeroIndex].trim();
        const metatag = values[metatagIndex].trim();

        if (numero && metatag) {
          const entry: CsvEntry = { numero, metatag };

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
      }
    }

    console.log('CSV parsing complete, found', results.length, 'valid entries');
    deps.setCsvData(results);

    if (authService.isAuthenticated() && results.length > 0) {
      try {
        console.log(`[Main Process] Saving CSV "${fileName}" to Supabase...`);
        await saveCsvToSupabase(results, fileName);
        console.log('[Main Process] CSV saved to Supabase successfully');
      } catch (csvSaveError) {
        console.error('[Main Process] Error saving CSV to Supabase:', csvSaveError);
      }
    }

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

/**
 * Handle CSV loading with project support
 */
async function handleCsvLoading(event: IpcMainEvent, fileData: { buffer: Uint8Array, name: string, projectId?: string, standalone?: boolean }): Promise<void> {
  console.log('[Main Process] handleCsvLoading called.');
  const mainWindow = deps.getMainWindow();

  if (fileData.standalone) {
    return handleStandaloneCSVLoading(event, fileData);
  }

  try {
    if (!mainWindow) return;
    const { buffer: rawBuffer, name: fileName, projectId } = fileData;
    const actualBuffer = Buffer.from(rawBuffer);

    if (projectId) {
      console.log(`Received CSV for project ${projectId}. Uploading to storage...`);
      const storagePath = await uploadCsvToStorage(projectId, actualBuffer, fileName);
      const updatedProject = await updateProjectOnline(projectId, { base_csv_storage_path: storagePath });
      mainWindow.webContents.send('csv-loaded', {
        filename: fileName,
        message: `CSV associato al progetto ${projectId}`,
        project: updatedProject
      });
    } else {
      console.log('Processing CSV for one-shot analysis without project association');
      const csvContent = actualBuffer.toString('utf-8');
      const lines = csvContent.split(/\r?\n/);
      const entries = lines.length > 1 ? lines.length - 1 : 0;

      if (entries > 0) {
        try {
          const headers = parseCSVLine(lines[0]);
          const csvEntries: CsvEntry[] = [];

          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;

            const values = parseCSVLine(lines[i]);
            const entry: CsvEntry = { numero: '', metatag: '' };

            for (let j = 0; j < headers.length && j < values.length; j++) {
              const header = headers[j].toLowerCase().trim();
              const value = values[j] ? values[j].trim() : '';

              if (header === 'numero') entry.numero = value;
              else if (header === 'nome') entry.nome = value;
              else if (header === 'categoria') entry.categoria = value;
              else if (header === 'squadra') entry.squadra = value;
              else if (header === 'metatag') entry.metatag = value;
              else entry[header] = value;
            }

            if (!entry.metatag && (entry.nome || entry.categoria || entry.squadra)) {
              const parts = [];
              if (entry.nome) parts.push(entry.nome);
              if (entry.categoria) parts.push(entry.categoria);
              if (entry.squadra) parts.push(entry.squadra);
              entry.metatag = parts.join(' - ');
            }

            if (entry.numero) {
              csvEntries.push(entry);
            }
          }

          deps.setGlobalCsvData(csvEntries);
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
    if (mainWindow) {
      mainWindow.webContents.send('csv-error', error.message || 'CSV loading error');
    }
  }
}

/**
 * Handle CSV template download
 */
function handleCsvTemplateDownload(event: IpcMainEvent): void {
  const mainWindow = deps.getMainWindow();
  try {
    console.log("CSV template download requested");
    if (!mainWindow) {
      console.error("No main window available");
      return;
    }

    const csvTemplate =
      "Number,Driver,Team,Category,Plate_Number,Sponsors,Metatag,Folder_1,Folder_2,Folder_3\n" +
      "1,John Doe,Racing Team A,GT3,AB123CD,Sponsor Corp,Pro Driver,Team-A,GT3-Drivers,\n" +
      "2,Mike Johnson,Speed Team,GT4,XY987ZW,Brand X,Semi-Pro,Speed-Team,GT4-Rookies,\n" +
      "3,\"Balthasar, Ponzo, Roe\",Imperiale Racing,GT3,FE456GH,\"elea costruzioni, topcon\",VIP,Imperiale,,\n" +
      "51,\"Alessandro Pier Guidi / James Calado\",Ferrari,GT3,FE488GT,\"Shell, Santander\",Pro,Ferrari-Team,GT3-Pro,";

    dialog.showSaveDialog(mainWindow, {
      title: 'Save CSV Template',
      defaultPath: path.join(app.getPath('downloads'), 'starting-list-template.csv'),
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    }).then(result => {
      if (result.canceled || !result.filePath) {
        console.log("Save dialog canceled");
        return;
      }

      fs.writeFile(result.filePath, csvTemplate, 'utf8', (err) => {
        if (err) {
          console.error("Error writing CSV template:", err);
          dialog.showErrorBox('CSV Template Error', err.message || 'An error occurred while saving the CSV template');
          return;
        }

        console.log("CSV template saved to:", result.filePath);
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
 * Setup folder and CSV IPC handlers
 */
export function setupFolderCsvHandlers(dependencies: FolderCsvHandlersDependencies): void {
  deps = dependencies;
  console.log('[Main Process] Setting up folder and CSV IPC handlers...');

  ipcMain.on('select-folder', handleFolderSelection);
  ipcMain.on('load-csv', handleCsvLoading);
  ipcMain.on('download-csv-template', handleCsvTemplateDownload);
}
