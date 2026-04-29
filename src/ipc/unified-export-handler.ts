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
  // Visual tags collected by the AI per category (location/weather/sceneType/
  // subjects/visualStyle/emotion). Forwarded so we can append them to keywords
  // when the IPTC Pro preset has `includeVisualTags` enabled — same behavior as
  // the Write-to-Originals path goes through in iptc-finalizer.ts.
  visualTags?: Record<string, string[]>;
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
  // Write Behavior toggles surfaced by the modal. Both default to the legacy
  // pre-toggle behavior so older callers (e.g. queued IPC requests still in
  // flight after a hot-reload) keep working unchanged.
  //
  // - 'rename'    auto-suffix `_2`, `_3`, … (current behavior, safe default)
  // - 'overwrite' replace existing files in destination
  // - 'skip'      leave existing files untouched (no copy, no IPTC write)
  fileConflictStrategy?: 'rename' | 'overwrite' | 'skip';
  // - 'merge'   write only the fields specified by the preset; preserve
  //             everything else already on the image. This is what every
  //             other tool in the IPTC ecosystem (Bridge, Photo Mechanic,
  //             Lightroom) does by default and what we've always done.
  // - 'replace' clear the IPTC IIM and the XMP namespaces this preset
  //             writes (XMP-iptcCore, XMP-iptcExt, XMP-photoshop, XMP-dc,
  //             XMP-plus, XMP-xmpRights), then write only what the preset
  //             contains. Useful for re-licensing back catalogs under a
  //             clean profile. Does NOT touch EXIF camera data.
  metadataStrategy?: 'merge' | 'replace';
}

export function registerUnifiedExportHandler(): void {

  ipcMain.handle('unified-export', async (_, data: UnifiedExportRequest) => {
    try {
      const mainWindow = getMainWindow();
      const startTime = Date.now();

      // Dynamically import modules
      const { buildFilename, buildSubfolderPath, SequenceManager, SequenceMode } =
        await import('../utils/filename-renamer');

      const {
        images, destinationFolder, renamePattern, subfolderPattern,
        writeIptc, iptcMetadata, keywordsMode, eventName,
        fileConflictStrategy = 'rename',
        metadataStrategy = 'merge'
      } = data;
      console.log(`[UnifiedExport] Starting: ${images.length} files, fileConflictStrategy=${fileConflictStrategy}, metadataStrategy=${metadataStrategy}`);

      // (Diagnostic block that dumped iptcMetadata.contact* fields was removed
      //  in 1.1.4 once CreatorContactInfo writing was confirmed end-to-end.)

      // Ensure destination exists
      await fsPromises.mkdir(destinationFolder, { recursive: true });

      const sequenceManager = new SequenceManager();
      let copiedFiles = 0;
      let renamedFiles = 0;
      // skippedFiles is reported back to the renderer so the success toast
      // can distinguish "5 copied, 3 skipped" from "5 copied" — important
      // when the user picked Skip and wants to know why their delta is small.
      let skippedFiles = 0;
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

          // Resolve conflicts according to the user's chosen strategy.
          // The desired (pre-conflict) target path:
          let targetPath = path.join(targetFolder, targetFilename);
          const targetExists = fs.existsSync(targetPath);

          if (targetExists) {
            if (fileConflictStrategy === 'skip') {
              skippedFiles++;
              console.log(`[UnifiedExport] Skipped (file exists): ${path.basename(targetPath)}`);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('unified-export-progress', {
                  current: i + 1, total: images.length,
                  phase: 'copy', fileName: `(skipped) ${path.basename(targetPath)}`
                });
              }
              continue; // do not copy, do not push to copiedPaths, no IPTC pass
            } else if (fileConflictStrategy === 'overwrite') {
              // fsPromises.copyFile overwrites by default unless COPYFILE_EXCL
              // is passed. Nothing to do — the copy below will replace the
              // existing file. We log so the user can audit what happened.
              console.log(`[UnifiedExport] Overwriting: ${path.basename(targetPath)}`);
            } else {
              // 'rename' (default, legacy behavior): suffix _2/_3/...
              targetPath = await resolveConflict(targetPath);
            }
          }

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
          const { writeFullMetadata, buildMetadataFromPresetIptc, buildExtendedName, resolvePersonShown } =
            await import('../utils/metadata-writer');
          // BUGFIX (visual tags): the IPTC Pro preset flag `includeVisualTags`
          // was honored only by the iptc-finalizer (Write-to-Originals path).
          // Export-to-Folder went straight from buildMetadataFromPresetIptc to
          // writeFullMetadata, so AI visual tags were silently dropped from the
          // exported keywords. We now reuse the same helper used by the
          // finalizer so both paths behave identically.
          const { appendVisualTagsToKeywords } = await import('../utils/iptc-finalizer');

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

              // Append AI visual tags (location/weather/scene/subjects/...) to
              // keywords when the preset has the flag enabled. Mirrors the
              // behavior of finalizeIptcMetadata so Write-to-Originals and
              // Export-to-Folder produce identical metadata.
              appendVisualTagsToKeywords(
                metadata,
                image.visualTags,
                iptcMetadata.includeVisualTags
              );

              // Handle multi-match person shown — format-aware
              if (allParticipants.length > 1) {
                const pNames = allParticipants.map(p => p.name).filter(Boolean) as string[];
                if (pNames.length > 1) {
                  const format = iptcMetadata.personShownFormat;
                  const template = iptcMetadata.personShownTemplate;

                  if (format === 'extended') {
                    metadata.personShown = allParticipants
                      .filter(p => p.name)
                      .map(p => buildExtendedName(p));
                  } else if (format === 'custom' && template) {
                    metadata.personShown = allParticipants
                      .filter(p => p.name)
                      .map(p => resolvePersonShown('custom', template, p));
                  } else {
                    // 'simple' or default — just names
                    metadata.personShown = pNames;
                  }
                }
              }

              await writeFullMetadata(exportedPath, metadata, {
                replaceAll: metadataStrategy === 'replace'
              });
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

      console.log(`[UnifiedExport] Complete: ${copiedFiles} copied, ${renamedFiles} renamed, ${skippedFiles} skipped, ${iptcWritten} IPTC, ${errors} errors (${(durationMs/1000).toFixed(1)}s)`);

      return {
        success: true,
        data: {
          copiedFiles,
          renamedFiles,
          skippedFiles,
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
