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
import { SUPABASE_CONFIG } from '../config';
import { authService } from '../auth-service';
import { getSupabase, getSupabaseImageUrlCache } from './context';

// child_process.exec was only used to shell out to `dcraw` for RAW
// previews; that path was removed in favour of the native
// raw-preview-extractor → ExifTool cascade. No more imports needed.

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
            // Native extraction failed, no further fallback available
            return null;
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

      // For RAW files: extract the embedded preview via the native
      // raw-preview-extractor → ExifTool cascade (no dcraw — its fallback
      // was emitting hundreds of "dcraw: command not found" errors on
      // every Mac without dcraw on PATH; see support_1778335167281
      // 13:40–13:57 for an extreme example).
      if (isRaw && fs.existsSync(imagePath)) {
        try {
          const { rawPreviewExtractor } = await import('../utils/raw-preview-native');
          const result = await rawPreviewExtractor.extractPreview(imagePath, {
            // Halfsize preview sizing — bigger than the thumbnail path
            // (50–500 KB above) because we render at modal/half-screen
            // resolution.
            targetMinSize: 200 * 1024,        //   200 KB min
            targetMaxSize: 3 * 1024 * 1024,   // 3 MB max
            timeout: 8000,
            preferQuality: 'preview'
          });

          if (result.success && result.data && result.data.length > 0) {
            const base64Data = result.data.toString('base64');
            return `data:image/jpeg;base64,${base64Data}`;
          }
          return null;
        } catch (rawError) {
          console.error(`[IPC] Halfsize preview extraction failed for ${path.basename(imagePath)}:`, rawError);
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

      // For RAW files, extract a preview via raw-preview-extractor →
      // ExifTool. dcraw was removed in v1.2.0 — calls to it generated
      // hundreds of `command not found` errors on Macs without a system
      // dcraw install (see support reports from the field).
      if (isRaw && fs.existsSync(imagePath)) {
        try {
          const { rawPreviewExtractor } = await import('../utils/raw-preview-native');
          const result = await rawPreviewExtractor.extractPreview(imagePath, {
            targetMinSize: 200 * 1024,        //   200 KB min
            targetMaxSize: 3 * 1024 * 1024,   // 3 MB max
            timeout: 8000,
            preferQuality: 'preview'
          });

          if (result.success && result.data && result.data.length > 0) {
            const base64Data = result.data.toString('base64');
            return `data:image/jpeg;base64,${base64Data}`;
          }
          return null;
        } catch (rawError) {
          console.error(`[IPC] RAW preview extraction failed for ${imagePath}:`, rawError);
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
