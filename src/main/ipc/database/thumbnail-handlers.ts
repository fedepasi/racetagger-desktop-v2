/**
 * Thumbnail IPC Handlers
 * Handles local thumbnail search and file lookup operations
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as os from 'os';

/**
 * Search for files in a directory based on filename
 */
async function searchFilesInDirectory(dirPath: string, baseFileName: string): Promise<string | null> {
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

    // Try with common variations
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

  // Cache stats to avoid O(N²) statSync calls
  const filesWithStats = await Promise.all(
    matchedFiles.map(async (file) => {
      try {
        const filePath = path.join(dirPath, file);
        const stats = await fsPromises.stat(filePath);
        return { file, mtime: stats.mtime.getTime() };
      } catch (error) {
        console.warn(`[searchFilesInDirectory] Failed to stat ${file}:`, error);
        return { file, mtime: 0 };
      }
    })
  );

  // Sort by most recent
  filesWithStats.sort((a, b) => b.mtime - a.mtime);

  console.log(`[searchFilesInDirectory] Found ${filesWithStats.length} matching files in ${dirPath}`);
  return filesWithStats.length > 0 ? path.join(dirPath, filesWithStats[0].file) : null;
}

/**
 * Find thumbnails for a specific filename
 */
async function findThumbnailsForFileName(tempDir: string, fileName: string): Promise<{
  thumbnailPath: string | null;
  microThumbPath: string | null;
  compressedPath: string | null;
}> {
  const baseFileName = path.parse(fileName).name;

  // Run all searches in parallel for better performance
  const [thumbnailPath, microThumbPath, compressedPath] = await Promise.all([
    searchFilesInDirectory(path.join(tempDir, 'thumbnails'), baseFileName),
    searchFilesInDirectory(path.join(tempDir, 'micro-thumbs'), baseFileName),
    searchFilesInDirectory(path.join(tempDir, 'compressed'), baseFileName)
  ]);

  return { thumbnailPath, microThumbPath, compressedPath };
}

/**
 * Setup thumbnail IPC handlers
 */
export function setupThumbnailHandlers(): void {
  console.log('[Main Process] Setting up thumbnail IPC handlers...');

  // Find local thumbnail paths for a filename
  ipcMain.handle('find-local-thumbnails', async (_, params: string | { fileName: string; originalFileName?: string; originalPath?: string }) => {
    try {
      const tempDir = path.join(os.homedir(), '.racetagger-temp');
      let thumbnailPaths: any = {};

      // Handle both string parameter and object parameter
      const fileName = typeof params === 'string' ? params : params.fileName;
      const originalFileName = typeof params === 'object' ? params.originalFileName : undefined;
      const originalPath = typeof params === 'object' ? params.originalPath : undefined;

      // Try originalFileName first if provided
      if (originalFileName) {
        console.log(`[Main Process] Searching thumbnails first with originalFileName: ${originalFileName}`);
        thumbnailPaths = await findThumbnailsForFileName(tempDir, originalFileName);

        const hasResults = thumbnailPaths.thumbnailPath || thumbnailPaths.microThumbPath || thumbnailPaths.compressedPath;
        if (hasResults) {
          console.log(`[Main Process] Found local thumbnails using originalFileName ${originalFileName}:`, thumbnailPaths);
          return { success: true, data: thumbnailPaths };
        }
      }

      // Fallback to fileName search
      console.log(`[Main Process] Searching thumbnails with fileName: ${fileName}`);
      thumbnailPaths = await findThumbnailsForFileName(tempDir, fileName);

      const hasResults = thumbnailPaths.thumbnailPath || thumbnailPaths.microThumbPath || thumbnailPaths.compressedPath;

      // If no thumbnails found, check if we can use original JPEG file
      if (!hasResults && originalPath) {
        const fileExt = path.extname(originalPath).toLowerCase();
        const isJpegFile = ['.jpg', '.jpeg'].includes(fileExt);

        console.log(`[Main Process] No thumbnails found, checking JPEG fallback for: ${originalPath}`);

        if (isJpegFile) {
          try {
            await fsPromises.access(originalPath, fs.constants.F_OK);
            console.log(`[Main Process] Using original JPEG file as thumbnail: ${originalPath}`);
            thumbnailPaths.thumbnailPath = originalPath;
            thumbnailPaths.isOriginalFile = true;
          } catch (accessError) {
            console.log(`[Main Process] Original JPEG file not accessible: ${originalPath}`);
          }
        }
      }

      console.log(`[Main Process] Found local thumbnails:`, thumbnailPaths);
      return { success: true, data: thumbnailPaths };
    } catch (error) {
      console.error('[Main Process] Error finding local thumbnails:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
