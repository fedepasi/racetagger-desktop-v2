/**
 * Export Destination IPC Handlers
 * Handles all export destination-related database operations
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  ExportDestination,
  createExportDestination,
  getUserExportDestinations,
  getActiveExportDestinations,
  getExportDestinationById,
  getDefaultExportDestination,
  updateExportDestination,
  deleteExportDestination,
  setDefaultExportDestination,
  duplicateExportDestination,
  updateExportDestinationsOrder,
  toggleExportDestinationActive,
  getMatchingExportDestinations
} from '../../../database-service';

// Dependencies interface
export interface ExportDestinationHandlersDependencies {
  getMainWindow: () => BrowserWindow | null;
}

let deps: ExportDestinationHandlersDependencies;

/**
 * Setup export destination IPC handlers
 */
export function setupExportDestinationHandlers(dependencies: ExportDestinationHandlersDependencies): void {
  deps = dependencies;
  console.log('[Main Process] Setting up export destination IPC handlers...');

  ipcMain.handle('export-destinations-create', async (_, destinationData: Omit<ExportDestination, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    try {
      console.log('[IPC] Creating export destination:', destinationData.name);
      const destination = await createExportDestination(destinationData);
      return { success: true, data: destination };
    } catch (e: any) {
      console.error('[IPC] Error creating export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-get-all', async () => {
    try {
      const destinations = await getUserExportDestinations();
      return { success: true, data: destinations };
    } catch (e: any) {
      console.error('[IPC] Error getting export destinations:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-get-active', async () => {
    try {
      const destinations = await getActiveExportDestinations();
      return { success: true, data: destinations };
    } catch (e: any) {
      console.error('[IPC] Error getting active export destinations:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-get-by-id', async (_, destinationId: string) => {
    try {
      const destination = await getExportDestinationById(destinationId);
      return { success: true, data: destination };
    } catch (e: any) {
      console.error('[IPC] Error getting export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-get-default', async () => {
    try {
      const destination = await getDefaultExportDestination();
      return { success: true, data: destination };
    } catch (e: any) {
      console.error('[IPC] Error getting default export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-update', async (_, { destinationId, updateData }: { destinationId: string, updateData: Partial<ExportDestination> }) => {
    try {
      console.log('[IPC] Updating export destination:', destinationId);
      const destination = await updateExportDestination(destinationId, updateData);
      return { success: true, data: destination };
    } catch (e: any) {
      console.error('[IPC] Error updating export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-delete', async (_, destinationId: string) => {
    try {
      console.log('[IPC] Deleting export destination:', destinationId);
      await deleteExportDestination(destinationId);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] Error deleting export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-set-default', async (_, destinationId: string) => {
    try {
      console.log('[IPC] Setting default export destination:', destinationId);
      await setDefaultExportDestination(destinationId);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] Error setting default export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-duplicate', async (_, { destinationId, newName }: { destinationId: string, newName?: string }) => {
    try {
      console.log('[IPC] Duplicating export destination:', destinationId);
      const destination = await duplicateExportDestination(destinationId, newName);
      return { success: true, data: destination };
    } catch (e: any) {
      console.error('[IPC] Error duplicating export destination:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-update-order', async (_, destinationOrders: Array<{ id: string; display_order: number }>) => {
    try {
      console.log('[IPC] Updating export destinations order');
      await updateExportDestinationsOrder(destinationOrders);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] Error updating export destinations order:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-toggle-active', async (_, destinationId: string) => {
    try {
      console.log('[IPC] Toggling export destination active:', destinationId);
      const newStatus = await toggleExportDestinationActive(destinationId);
      return { success: true, data: newStatus };
    } catch (e: any) {
      console.error('[IPC] Error toggling export destination active:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-destinations-get-matching', async (_, participantData: { team?: string; number?: string | number; categoria?: string }) => {
    try {
      const destinations = await getMatchingExportDestinations(participantData);
      return { success: true, data: destinations };
    } catch (e: any) {
      console.error('[IPC] Error getting matching export destinations:', e);
      return { success: false, error: e.message };
    }
  });

  // Export images to destinations
  ipcMain.handle('export-to-destinations', async (_, data: {
    images: Array<{
      imagePath: string;
      participant?: {
        numero?: string | number;
        nome?: string;
        surname?: string;
        team?: string;
        squadra?: string;
        car_model?: string;
        nationality?: string;
        categoria?: string;
      };
    }>;
    destinationIds?: string[];
    event?: {
      name?: string;
      date?: string;
      city?: string;
      country?: string;
      location?: string;
    };
  }) => {
    try {
      const exportModule = await import('../../../utils/export-destination-processor');
      const { exportDestinationProcessor } = exportModule;

      console.log(`[IPC] Export to destinations requested: ${data.images.length} images`);

      // Get destinations to export to
      let destinations: ExportDestination[];
      if (data.destinationIds && data.destinationIds.length > 0) {
        const allDests = await Promise.all(
          data.destinationIds.map(id => getExportDestinationById(id))
        );
        destinations = allDests.filter((d): d is ExportDestination => d !== null);
      } else {
        destinations = await getActiveExportDestinations();
      }

      if (destinations.length === 0) {
        return {
          success: false,
          error: 'No active export destinations configured',
          exported: 0,
          failed: 0
        };
      }

      console.log(`[IPC] Exporting to ${destinations.length} destination(s)`);

      const eventInfo = data.event ? {
        name: data.event.name,
        date: data.event.date ? new Date(data.event.date) : undefined,
        city: data.event.city,
        country: data.event.country,
        location: data.event.location
      } : undefined;

      exportDestinationProcessor.resetStats();

      const results = [];
      const mainWindow = deps.getMainWindow();

      for (const imageData of data.images) {
        const participant = imageData.participant ? {
          numero: imageData.participant.numero,
          nome: imageData.participant.nome,
          name: imageData.participant.nome,
          surname: imageData.participant.surname,
          team: imageData.participant.team,
          squadra: imageData.participant.squadra || imageData.participant.team,
          car_model: imageData.participant.car_model,
          nationality: imageData.participant.nationality,
          categoria: imageData.participant.categoria
        } : undefined;

        const result = await exportDestinationProcessor.exportToDestinations(
          imageData.imagePath,
          destinations,
          participant,
          eventInfo
        );
        results.push(result);

        // Send progress update
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('export-progress', {
            current: results.length,
            total: data.images.length,
            lastImage: imageData.imagePath,
            lastResult: result
          });
        }
      }

      const stats = exportDestinationProcessor.getStats();
      console.log(`[IPC] Export complete: ${stats.totalExports} successful, ${stats.failedExports} failed`);

      return {
        success: true,
        exported: stats.totalExports,
        failed: stats.failedExports,
        processedImages: stats.processedImages,
        results
      };
    } catch (e: any) {
      console.error('[IPC] Error exporting to destinations:', e);
      return { success: false, error: e.message, exported: 0, failed: 0 };
    }
  });
}
