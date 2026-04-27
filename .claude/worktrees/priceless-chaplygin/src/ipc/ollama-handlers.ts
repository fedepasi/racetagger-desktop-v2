/**
 * Ollama IPC Handlers
 * Provides local AI inference status and control from the renderer.
 */

import { createHandler } from './handler-factory';
import { ollamaService } from '../ollama-service';
import { getMainWindow } from './context';
import { DEBUG_MODE } from '../config';

export function registerOllamaHandlers(): void {
  if (DEBUG_MODE) console.log('[IPC] Registering Ollama handlers...');

  createHandler('ollama-get-status', () => ollamaService.getStatus());

  createHandler('ollama-pull-model', async () => {
    const mainWindow = getMainWindow();
    await ollamaService.pullModel((pct) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ollama-pull-progress', { percentage: pct });
      }
    });
    return { success: true };
  });

  createHandler('ollama-analyze-image', async ({ imageBase64, prompt }: { imageBase64: string; prompt?: string }) => {
    return ollamaService.analyzeImage(imageBase64, prompt);
  });

  if (DEBUG_MODE) console.log('[IPC] Ollama handlers registered (3 handlers)');
}
