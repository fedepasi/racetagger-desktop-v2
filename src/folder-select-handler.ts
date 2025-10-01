import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// Definisci le estensioni supportate
const RAW_EXTENSIONS = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
const STANDARD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALL_SUPPORTED_EXTENSIONS = [...STANDARD_EXTENSIONS, ...RAW_EXTENSIONS];

export function setupFolderSelectHandlers(mainWindow: BrowserWindow | null) {
  // Handler che supporta invoke per select-folder
  ipcMain.handle('select-folder', async () => {
    console.log('[Main Process] select-folder handler invoked');
    
    if (!mainWindow) {
      console.error('select-folder handler: mainWindow is null');
      return { success: false, message: 'Window not available' };
    }
    
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Seleziona una cartella di immagini'
      });
      
      if (result.canceled) {
        console.log('Folder selection canceled by user');
        return { success: false, message: 'Selezione annullata' };
      }
      
      const folderPath = result.filePaths[0];
      console.log('Selected folder:', folderPath);
      
      // Verifica se la cartella esiste
      if (!fs.existsSync(folderPath)) {
        console.error('Selected folder does not exist:', folderPath);
        return { success: false, message: 'La cartella selezionata non esiste' };
      }
      
      // Ottieni la lista delle immagini nella cartella
      const files = fs.readdirSync(folderPath);
      
      const imageFiles = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ALL_SUPPORTED_EXTENSIONS.includes(ext);
        })
        .map(file => {
          const ext = path.extname(file).toLowerCase();
          const isRaw = RAW_EXTENSIONS.includes(ext);
          return { path: path.join(folderPath, file), isRaw };
        });
      
      const imageCount = imageFiles.length;
      const rawCount = imageFiles.filter(img => img.isRaw).length;
      console.log(`Found ${imageCount} images in folder (${rawCount} RAW files)`);
      
      return { 
        success: true, 
        path: folderPath,
        imageCount: imageCount,
        rawCount: rawCount
      };
    } catch (error) {
      console.error('Error during folder selection:', error);
      return { success: false, message: 'Errore durante la selezione della cartella' };
    }
  });
}
