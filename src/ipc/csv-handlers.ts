/**
 * CSV IPC Handlers
 *
 * Handles CSV file loading, parsing, and template generation.
 */

import { ipcMain, dialog, app, IpcMainEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getMainWindow, getGlobalCsvData, setGlobalCsvData, safeSend } from './context';
import { CsvEntry } from './types';
import { authService } from '../auth-service';
import { saveCsvToSupabase } from '../database-service';

// ==================== Utilities ====================

/**
 * Parse a CSV line handling quoted fields with commas
 */
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

// ==================== Standalone CSV Loading ====================

/**
 * Handle standalone CSV loading (without project association)
 */
async function handleStandaloneCSVLoading(event: IpcMainEvent, fileData: any): Promise<void> {
  const mainWindow = getMainWindow();
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
      }
    }

    // Store the CSV data globally
    setGlobalCsvData(results);

    // Save CSV to Supabase if user is authenticated
    if (authService.isAuthenticated() && results.length > 0) {
      try {
        await saveCsvToSupabase(results, fileName);
      } catch (csvSaveError) {
        console.error('[CSV] Error saving to Supabase:', csvSaveError);
        // Don't block loading if Supabase save fails
      }
    }

    // Send information back to the renderer
    mainWindow.webContents.send('csv-loaded', {
      filename: fileName,
      entries: results.length
    });

  } catch (error: any) {
    console.error('[CSV] Error during loading:', error);
    if (mainWindow) {
      mainWindow.webContents.send('csv-error', error.message || 'An error occurred while loading CSV file');
    }
  }
}

// ==================== CSV Loading with Project Support ====================

/**
 * Handle CSV loading for one-shot analysis
 */
async function handleCsvLoading(event: IpcMainEvent, fileData: { buffer: Uint8Array, name: string, projectId?: string, standalone?: boolean }): Promise<void> {
  const mainWindow = getMainWindow();

  // If standalone loading is requested, use the dedicated function
  if (fileData.standalone) {
    return handleStandaloneCSVLoading(event, fileData);
  }

  try {
    if (!mainWindow) return;
    const { buffer: rawBuffer, name: fileName } = fileData;
    const actualBuffer = Buffer.from(rawBuffer);

    // Support CSV loading for one-shot analysis
    // Read CSV content
    const csvContent = actualBuffer.toString('utf-8');
    const lines = csvContent.split(/\r?\n/);

    // Skip header and count data rows
    const entries = lines.length > 1 ? lines.length - 1 : 0;

    // Process CSV for global temporary use
    if (entries > 0) {
      try {
        // Extract header
        const headers = parseCSVLine(lines[0]);

        // Process data rows
        const csvEntries: CsvEntry[] = [];
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === '') continue;

          const values = parseCSVLine(lines[i]);
          const entry: CsvEntry = { numero: '', metatag: '' };

          // Map values to columns
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
              // Additional fields
              entry[header] = value;
            }
          }

          // If no metatag but has other fields, create automatic metatag
          if (!entry.metatag && (entry.nome || entry.categoria || entry.squadra)) {
            const parts = [];
            if (entry.nome) parts.push(entry.nome);
            if (entry.categoria) parts.push(entry.categoria);
            if (entry.squadra) parts.push(entry.squadra);
            entry.metatag = parts.join(' - ');
          }

          // Add only if has at least a race number
          if (entry.numero) {
            csvEntries.push(entry);
          }
        }

        // Save CSV data for global use
        setGlobalCsvData(csvEntries);

        mainWindow.webContents.send('csv-loaded', {
          filename: fileName,
          entries: csvEntries.length,
          message: `CSV caricato con ${csvEntries.length} voci valide`
        });
      } catch (parseError) {
        console.error('[CSV] Parsing error:', parseError);
        mainWindow.webContents.send('csv-error', 'Errore nel parsing del CSV. Verifica il formato.');
      }
    } else {
      mainWindow.webContents.send('csv-loaded', {
        filename: fileName,
        entries: 0,
        message: 'CSV caricato, ma non contiene dati validi'
      });
    }
  } catch (error: any) {
    console.error('[CSV] Error during loading:', error);
    if (mainWindow) mainWindow.webContents.send('csv-error', error.message || 'CSV loading error');
  }
}

// ==================== CSV Template Download ====================

/**
 * Handle CSV template download
 */
function handleCsvTemplateDownload(event: IpcMainEvent): void {
  const mainWindow = getMainWindow();
  try {
    if (!mainWindow) {
      console.error('[CSV] No main window available');
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
        return;
      }

      // Write the template to the selected path
      fs.writeFile(result.filePath, csvTemplate, 'utf8', (err) => {
        if (err) {
          console.error('[CSV] Error writing template:', err);
          dialog.showErrorBox('CSV Template Error', err.message || 'An error occurred while saving the CSV template');
          return;
        }

        // Notify the renderer
        mainWindow?.webContents.send('csv-template-saved', result.filePath);
      });
    }).catch(err => {
      console.error('[CSV] Save dialog error:', err);
      dialog.showErrorBox('CSV Template Error', err.message || 'An error occurred while opening save dialog');
    });

  } catch (error: any) {
    console.error('[CSV] Error during template download:', error);
    if (mainWindow) {
      dialog.showErrorBox('CSV Template Error', error.message || 'An error occurred while saving the CSV template');
    }
  }
}

// ==================== Register Handlers ====================

export function registerCsvHandlers(): void {

  // CSV loading (with project support)
  ipcMain.on('load-csv', handleCsvLoading);

  // CSV template download
  ipcMain.on('download-csv-template', handleCsvTemplateDownload);

  // Get current CSV data
  ipcMain.handle('get-csv-data', async () => {
    try {
      const csvData = getGlobalCsvData();
      return { success: true, data: csvData };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Clear CSV data
  ipcMain.handle('clear-csv-data', async () => {
    try {
      setGlobalCsvData([]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
