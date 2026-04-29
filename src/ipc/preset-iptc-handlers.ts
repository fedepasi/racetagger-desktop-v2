/**
 * IPC Handlers for IPTC Metadata Management
 *
 * Handles:
 * - preset-iptc-get: Load IPTC profile for a preset
 * - preset-iptc-save: Save/update IPTC profile for a preset
 * - preset-iptc-import-xmp: Import IPTC profile from XMP file (PhotoMechanic)
 * - iptc-finalize-batch: Trigger batch IPTC writing after review
 *
 * Total: 4 handlers
 */

import { ipcMain, dialog } from 'electron';
import { HandlerResult } from './types';
import { getMainWindow, safeSend } from './context';
import { PresetIptcMetadata, IptcFinalizationSummary, FinalizedResult } from '../utils/iptc-types';
import { parseXmpToIptcProfile } from '../utils/xmp-iptc-parser';
import { finalizeIptcMetadata } from '../utils/iptc-finalizer';
import {
  getPresetIptcMetadata,
  savePresetIptcMetadata,
} from '../database-service';

/**
 * Register all IPTC-related IPC handlers
 */
export function registerPresetIptcHandlers(): void {
  console.log('[IPC] Registering IPTC metadata handlers (4)...');

  // Get IPTC profile for a preset
  ipcMain.handle('preset-iptc-get', async (_event, presetId: string): Promise<HandlerResult<PresetIptcMetadata | null>> => {
    try {
      if (!presetId) {
        return { success: false, error: 'Preset ID is required' };
      }

      const iptcMetadata = await getPresetIptcMetadata(presetId);
      return { success: true, data: iptcMetadata };
    } catch (error) {
      console.error('[IPC] Error getting IPTC metadata:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get IPTC metadata' };
    }
  });

  // Save/update IPTC profile for a preset
  ipcMain.handle('preset-iptc-save', async (_event, presetId: string, iptcMetadata: PresetIptcMetadata): Promise<HandlerResult<void>> => {
    try {
      if (!presetId) {
        return { success: false, error: 'Preset ID is required' };
      }

      await savePresetIptcMetadata(presetId, iptcMetadata);
      return { success: true, data: undefined };
    } catch (error) {
      console.error('[IPC] Error saving IPTC metadata:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save IPTC metadata' };
    }
  });

  // Import IPTC profile from XMP file
  ipcMain.handle('preset-iptc-import-xmp', async (_event): Promise<HandlerResult<PresetIptcMetadata>> => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import IPTC Profile from XMP File',
        filters: [
          { name: 'XMP Files', extensions: ['xmp', 'XMP'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Import cancelled' };
      }

      const xmpFilePath = result.filePaths[0];
      console.log(`[IPC] Importing IPTC profile from: ${xmpFilePath}`);

      const profile = await parseXmpToIptcProfile(xmpFilePath);

      console.log(`[IPC] Imported IPTC profile with ${Object.keys(profile).length} fields`);
      if (profile.baseKeywords) {
        console.log(`[IPC]   Keywords: ${profile.baseKeywords.length}`);
      }

      return { success: true, data: profile };
    } catch (error) {
      console.error('[IPC] Error importing XMP:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to import XMP file' };
    }
  });

  // Batch finalize IPTC metadata after review.
  //
  // Signature is positional + a trailing options bag. Older callers that
  // didn't pass the options object continue to work because the default
  // `metadataStrategy` is 'merge' (the legacy behavior). New callers (the
  // unified IPTC modal) pass `{ metadataStrategy: 'merge' | 'replace' }` to
  // surface the Write Behavior toggle for in-place writes.
  ipcMain.handle('iptc-finalize-batch', async (
    _event,
    iptcMetadata: PresetIptcMetadata,
    results: FinalizedResult[],
    keywordsMode: 'append' | 'overwrite',
    options?: { metadataStrategy?: 'merge' | 'replace' }
  ): Promise<HandlerResult<IptcFinalizationSummary>> => {
    try {
      if (!iptcMetadata) {
        return { success: false, error: 'IPTC metadata profile is required' };
      }
      if (!results || results.length === 0) {
        return { success: false, error: 'No results to finalize' };
      }

      const metadataStrategy = options?.metadataStrategy || 'merge';
      console.log(`[IPC] Starting IPTC finalization for ${results.length} files (metadataStrategy=${metadataStrategy})`);

      const summary = await finalizeIptcMetadata({
        iptcMetadata,
        results,
        keywordsMode,
        metadataStrategy,
        onProgress: (current, total, fileName) => {
          safeSend('iptc-finalize-progress', { current, total, fileName });
        },
        onError: (fileName, error) => {
          safeSend('iptc-finalize-error', { fileName, error });
        }
      });

      console.log(`[IPC] IPTC finalization complete: ${summary.successCount}/${summary.totalFiles} success`);

      return { success: true, data: summary };
    } catch (error) {
      console.error('[IPC] Error in IPTC finalization:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to finalize IPTC metadata' };
    }
  });

  console.log('[IPC] ✅ IPTC metadata handlers registered (4)');
}
