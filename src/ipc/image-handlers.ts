/**
 * Image Processing IPC Handlers
 *
 * Handles thumbnail generation, image loading, and RAW preview extraction.
 */

import { ipcMain } from 'electron';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SUPABASE_CONFIG } from '../config';
import { authService } from '../auth-service';
import { getSupabase, getSupabaseImageUrlCache } from './context';

const execPromise = promisify(exec);

// Supported extensions
const RAW_EXTENSIONS = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
const STANDARD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export function registerImageHandlers(): void {

  // ==================== THUMBNAIL GENERATION ====================

  ipcMain.handle('generate-thumbnail', async (_, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const ext = path.extname(filePath).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);

      if (isRaw) {
        try {
          const baseFileName = path.basename(filePath, path.extname(filePath));
          const thumbnailDir = path.join(os.tmpdir(), 'racetagger-thumbnails');

          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }

          const thumbnailPath = path.join(thumbnailDir, `${baseFileName}_thumb.jpg`);

          // Check cache
          if (fs.existsSync(thumbnailPath)) {
            return `file://${thumbnailPath}`;
          }

          // Generate thumbnail using native raw-preview-extractor (no dcraw needed)
          const { rawPreviewExtractor } = await import('../utils/raw-preview-native');
          const result = await rawPreviewExtractor.extractPreview(filePath, {
            targetMinSize: 50 * 1024,   // 50KB min for thumbnails
            targetMaxSize: 500 * 1024,  // 500KB max for thumbnails
            timeout: 5000,
            preferQuality: 'thumbnail'
          });

          let generatedThumbPath = thumbnailPath;
          if (result.success && result.data) {
            const fsPromises = await import('fs/promises');
            await fsPromises.writeFile(thumbnailPath, result.data);
          } else {
            // Fallback: try rawConverter if native extraction fails
            const { rawConverter } = await import('../utils/raw-converter');
            generatedThumbPath = await rawConverter.extractThumbnailFromRaw(filePath, thumbnailPath);
          }

          if (fs.existsSync(generatedThumbPath)) {
            return `file://${generatedThumbPath}`;
          }

          return null;
        } catch (rawError) {
          console.error(`[IPC] Error generating RAW thumbnail for ${filePath}:`, rawError);
          return null;
        }
      } else if (STANDARD_EXTENSIONS.includes(ext)) {
        return `file://${filePath}`;
      }

      return null;
    } catch (error) {
      console.error('[IPC] Error generating thumbnail:', error);
      return null;
    }
  });

  // ==================== HALFSIZE IMAGE (MODAL PREVIEW) ====================

  ipcMain.handle('get-halfsize-image', async (_, imagePath: string) => {
    try {
      if (!imagePath) {
        return null;
      }

      const ext = path.extname(imagePath).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);

      // For JPEG/PNG: Return original file directly
      if (fs.existsSync(imagePath) && STANDARD_EXTENSIONS.includes(ext)) {
        try {
          const imageBuffer = await fsPromises.readFile(imagePath);

          let mimeType = 'image/jpeg';
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.webp') mimeType = 'image/webp';

          const base64Data = imageBuffer.toString('base64');
          return `data:${mimeType};base64,${base64Data}`;
        } catch (readError) {
          console.error(`[IPC] Error reading image ${imagePath}:`, readError);
          return null;
        }
      }

      // For RAW files: Generate halfsize thumbnail using dcraw -h
      if (isRaw && fs.existsSync(imagePath)) {
        try {
          const dcrawCommand = `dcraw -h -w -c "${imagePath}"`;
          const result = await execPromise(dcrawCommand, { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' });

          if (result.stdout && result.stdout.length > 0) {
            const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'binary');
            const base64Data = buffer.toString('base64');
            return `data:image/jpeg;base64,${base64Data}`;
          }
          return null;
        } catch (dcrawError) {
          console.error(`[IPC] dcraw halfsize generation failed for ${path.basename(imagePath)}:`, dcrawError);
          return null;
        }
      }

      return null;
    } catch (error) {
      console.error(`[IPC] Error in get-halfsize-image:`, error);
      return null;
    }
  });

  // ==================== SUPABASE IMAGE URL ====================

  ipcMain.handle('get-supabase-image-url', async (_, fileName: string) => {
    try {
      const supabaseImageUrlCache = getSupabaseImageUrlCache();

      // Check cache first
      const cachedUrl = supabaseImageUrlCache.get(fileName);
      if (cachedUrl) {
        return cachedUrl;
      }

      // Query database for existing processed image
      const authState = authService.getAuthState();
      if (!authState.isAuthenticated) {
        return null;
      }

      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('images')
          .select('storage_path')
          .eq('original_filename', fileName)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          console.error(`[IPC] Error querying images table:`, error);
          return null;
        }

        if (data && data.length > 0 && data[0].storage_path) {
          const storagePath = data[0].storage_path;
          const publicUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storagePath}`;

          // Cache the URL
          supabaseImageUrlCache.set(fileName, publicUrl);
          return publicUrl;
        }

        return null;
      } catch (dbError) {
        console.error(`[IPC] Database query error for ${fileName}:`, dbError);
        return null;
      }
    } catch (error) {
      console.error(`[IPC] Error in get-supabase-image-url:`, error);
      return null;
    }
  });

  // ==================== LOCAL IMAGE LOADING ====================

  ipcMain.handle('get-local-image', async (_, imagePath: string) => {
    try {
      if (!imagePath) {
        return null;
      }

      const ext = path.extname(imagePath).toLowerCase();
      const isRaw = RAW_EXTENSIONS.includes(ext);

      // Try local file first for supported formats
      if (fs.existsSync(imagePath) && STANDARD_EXTENSIONS.includes(ext)) {
        try {
          const imageBuffer = await fsPromises.readFile(imagePath);

          let mimeType = 'image/jpeg';
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.webp') mimeType = 'image/webp';

          const base64Data = imageBuffer.toString('base64');
          return `data:${mimeType};base64,${base64Data}`;
        } catch (readError) {
          console.error(`[IPC] Error reading local image ${imagePath}:`, readError);
          return null;
        }
      }

      // For RAW files, generate a preview
      if (isRaw && fs.existsSync(imagePath)) {
        try {
          const dcrawCommand = `dcraw -h -w -c "${imagePath}"`;
          const result = await execPromise(dcrawCommand, { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' });

          if (result.stdout && result.stdout.length > 0) {
            const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'binary');
            const base64Data = buffer.toString('base64');
            return `data:image/jpeg;base64,${base64Data}`;
          }
          return null;
        } catch (dcrawError) {
          console.error(`[IPC] dcraw conversion failed for ${imagePath}:`, dcrawError);
          return null;
        }
      }

      // Fallback to Supabase if local file not found
      const fileName = path.basename(imagePath);

      const authState = authService.getAuthState();
      if (!authState.isAuthenticated) {
        return null;
      }

      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('images')
          .select('storage_path')
          .eq('original_filename', fileName)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error || !data || data.length === 0 || !data[0].storage_path) {
          return null;
        }

        const storagePath = data[0].storage_path;
        return `${SUPABASE_CONFIG.url}/storage/v1/object/public/uploaded-images/${storagePath}`;
      } catch (dbError) {
        console.error(`[IPC] Database query error for ${fileName}:`, dbError);
        return null;
      }
    } catch (error) {
      console.error(`[IPC] Error in get-local-image:`, error);
      return null;
    }
  });

  // ==================== THUMBNAIL FINDER ====================

  ipcMain.handle('find-local-thumbnails', async (_, params: string | { fileName: string; originalFileName?: string; originalPath?: string }) => {
    try {
      let fileName: string;
      let originalPath: string | undefined;

      if (typeof params === 'string') {
        fileName = params;
      } else {
        fileName = params.fileName;
        originalPath = params.originalPath;
      }

      const thumbnailDir = path.join(os.tmpdir(), 'racetagger-thumbnails');
      const baseName = path.basename(fileName, path.extname(fileName));

      // Check various thumbnail locations
      const possiblePaths = [
        path.join(thumbnailDir, `${baseName}_thumb.jpg`),
        path.join(thumbnailDir, `${baseName}.jpg`),
      ];

      if (originalPath) {
        const originalDir = path.dirname(originalPath);
        possiblePaths.push(
          path.join(originalDir, `${baseName}_thumb.jpg`),
          path.join(originalDir, '.thumbnails', `${baseName}.jpg`)
        );
      }

      for (const thumbPath of possiblePaths) {
        if (fs.existsSync(thumbPath)) {
          return `file://${thumbPath}`;
        }
      }

      return null;
    } catch (error) {
      console.error('[IPC] Error finding local thumbnails:', error);
      return null;
    }
  });
}
