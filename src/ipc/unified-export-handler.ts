/**
 * Unified Export IPC Handler
 *
 * Orchestrates the complete export flow:
 * 1. Copy files to destination folder
 * 2. Rename files based on pattern
 * 3. Organize into subfolders
 * 4. Optionally write IPTC metadata
 */

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { getMainWindow } from './context';

interface ExportImage {
  imagePath: string;
  participant?: {
    name?: string;
    number?: string;
    team?: string;
    car_model?: string;
    nationality?: string;
    metatag?: string;
  };
  allMatchedParticipants?: Array<{
    name?: string;
    number?: string;
    team?: string;
    car_model?: string;
    nationality?: string;
    metatag?: string;
  }>;
  aiKeywords?: string[];
}

interface UnifiedExportRequest {
  images: ExportImage[];
  destinationFolder: string;
  renamePattern: string | null;
  subfolderPattern: string | null;
  writeIptc: boolean;
  iptcMetadata: any | null;
  keywordsMode: 'append' | 'overwrite' | null;
  eventName: string;
}

export function registerUnifiedExportHandler(): void {

  ipcMain.handle('unified-export', async (_, data: UnifiedExportRequest) => {
    try {
      const mainWindow = getMainWindow();
      const startTime = Date.now();

      // Dynamically import modules
      const { buildFilename, buildSubfolderPath, SequenceManager, SequenceMode } =
        await import('../utils/filename-renamer');

      const { images, destinationFolder, renamePattern, subfolderPattern, writeIptc, iptcMetadata, keywordsMode, eventName } = data;

      // Ensure destination exists
      await fsPromises.mkdir(destinationFolder, { recursive: true });

      const sequenceManager = new SequenceManager();
      let copiedFiles = 0;
      let renamedFiles = 0;
      let iptcWritten = 0;
      let errors = 0;
      const errorDetails: Array<{ file: string; error: string }> = [];

      // Phase 1: Copy + Rename
      const copiedPaths: Array<{ originalPath: string; exportedPath: string; image: ExportImage }> = [];

      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const originalPath = image.imagePath;
        const fileName = path.basename(originalPath);
        const extension = path.extname(originalPath);
        const originalName = path.parse(originalPath).name;

        try {
          // Build subfolder
          let targetFolder = destinationFolder;
          if (subfolderPattern && image.participant) {
            const subfolderContext = {
              original: originalName,
              extension,
              participant: {
                name: image.participant.name,
                surname: undefined as string | undefined,
                number: image.participant.number,
                team: image.participant.team,
                car_model: image.participant.car_model,
                nationality: image.participant.nationality
              },
              event: eventName,
              date: new Date()
            };
            const subfolder = buildSubfolderPath(subfolderPattern, subfolderContext);
            if (subfolder) {
              targetFolder = path.join(destinationFolder, subfolder);
            }
          }

          // Ensure target folder exists
          await fsPromises.mkdir(targetFolder, { recursive: true });

          // Build filename
          let targetFilename = fileName;
          if (renamePattern && image.participant) {
            const renameContext = {
              original: originalName,
              extension,
              participant: {
                name: image.participant.name,
                surname: undefined as string | undefined,
                number: image.participant.number,
                team: image.participant.team,
                car_model: image.participant.car_model,
                nationality: image.participant.nationality
              },
              event: eventName,
              date: new Date(),
              sequenceNumber: 1,
              outputFolder: targetFolder
            };

            // Get sequence
            const seqKey = image.participant.number || image.participant.name || 'unknown';
            const seqNum = sequenceManager.getNext(SequenceMode.PER_SUBJECT, seqKey, 1);
            renameContext.sequenceNumber = seqNum;

            const newName = buildFilename(renamePattern, renameContext, 2);
            targetFilename = newName + extension;
            renamedFiles++;
          } else if (renamePattern && !image.participant) {
            // No participant data — use original filename but still increment global seq
            // so unmatched photos get sequential names if pattern only uses {seq}/{original}
            const renameContext = {
              original: originalName,
              extension,
              event: eventName,
              date: new Date(),
              sequenceNumber: sequenceManager.getNext(SequenceMode.GLOBAL, 'global', 1),
              outputFolder: targetFolder
            };
            const newName = buildFilename(renamePattern, renameContext, 2);
            if (newName !== originalName) {
              targetFilename = newName + extension;
              renamedFiles++;
            }
          }

          // Resolve conflicts
          let targetPath = path.join(targetFolder, targetFilename);
          targetPath = await resolveConflict(targetPath);

          // Copy file
          await fsPromises.copyFile(originalPath, targetPath);
          copiedFiles++;

          copiedPaths.push({ originalPath, exportedPath: targetPath, image });

          // Send progress
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('unified-export-progress', {
              current: i + 1,
              total: images.length,
              phase: 'copy',
              fileName: path.basename(targetPath)
            });
          }

        } catch (err: any) {
          errors++;
          errorDetails.push({ file: fileName, error: err.message });
          console.error(`[UnifiedExport] Error copying ${fileName}:`, err.message);
        }
      }

      // Phase 2: Write IPTC metadata (on exported copies)
      if (writeIptc && iptcMetadata && copiedPaths.length > 0) {
        try {
          const { writeFullMetadata, buildMetadataFromPresetIptc } =
            await import('../utils/metadata-writer');

          for (let i = 0; i < copiedPaths.length; i++) {
            const { exportedPath, image } = copiedPaths[i];
            const exportedFileName = path.basename(exportedPath);

            try {
              // Build participant for IPTC
              const allParticipants = image.allMatchedParticipants ||
                (image.participant ? [image.participant] : []);

              let participant = undefined;
              if (allParticipants.length === 1) {
                participant = allParticipants[0];
              } else if (allParticipants.length > 1) {
                // Multi-match: aggregate
                const names = allParticipants.map(p => p.name).filter(Boolean);
                const numbers = allParticipants.map(p => p.number).filter(Boolean);
                const teams = [...new Set(allParticipants.map(p => p.team).filter(Boolean))];
                const carModels = [...new Set(allParticipants.map(p => p.car_model).filter(Boolean))];
                const nationalities = [...new Set(allParticipants.map(p => p.nationality).filter(Boolean))];

                participant = {
                  name: names.length <= 2 ? names.join(' and ') :
                    names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1],
                  number: numbers.join(', '),
                  team: teams.join(', '),
                  car_model: carModels.join(', '),
                  nationality: nationalities.join(', ')
                };
              }

              const metadata = buildMetadataFromPresetIptc(
                iptcMetadata,
                participant,
                image.aiKeywords,
                keywordsMode || 'append'
              );

              // Handle multi-match person shown
              if (allParticipants.length > 1 && iptcMetadata.personShownTemplate) {
                const pNames = allParticipants.map(p => p.name).filter(Boolean);
                if (pNames.length > 1) {
                  metadata.personShown = pNames.join(', ');
                }
              }

              await writeFullMetadata(exportedPath, metadata);
              iptcWritten++;

              // Send progress
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('unified-export-progress', {
                  current: copiedFiles + i + 1,
                  total: copiedFiles + copiedPaths.length,
                  phase: 'iptc',
                  fileName: exportedFileName
                });
              }

            } catch (metaErr: any) {
              console.error(`[UnifiedExport] IPTC error on ${exportedFileName}:`, metaErr.message);
              // Don't fail the whole export for metadata errors
            }
          }
        } catch (iptcErr: any) {
          console.error('[UnifiedExport] IPTC module error:', iptcErr.message);
        }
      }

      const durationMs = Date.now() - startTime;

      console.log(`[UnifiedExport] Complete: ${copiedFiles} copied, ${renamedFiles} renamed, ${iptcWritten} IPTC, ${errors} errors (${(durationMs/1000).toFixed(1)}s)`);

      return {
        success: true,
        data: {
          copiedFiles,
          renamedFiles,
          iptcWritten,
          errors,
          errorDetails,
          durationMs
        }
      };

    } catch (e: any) {
      console.error('[UnifiedExport] Fatal error:', e);
      return { success: false, error: e.message };
    }
  });
}

async function resolveConflict(targetPath: string): Promise<string> {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const baseName = path.basename(targetPath, ext);

  let counter = 2;
  let newPath = path.join(dir, `${baseName}_${counter}${ext}`);

  while (fs.existsSync(newPath)) {
    counter++;
    newPath = path.join(dir, `${baseName}_${counter}${ext}`);
  }

  return newPath;
}
