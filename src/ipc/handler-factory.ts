/**
 * IPC Handler Factory
 *
 * Provides utilities to reduce boilerplate when creating IPC handlers.
 * Automatically wraps handlers with try/catch and standardizes responses.
 */

import { ipcMain, IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import { HandlerResult } from './types';

/**
 * Creates an ipcMain.handle() handler with automatic error handling.
 * Returns { success: true, data } on success, { success: false, error } on failure.
 */
export function createHandler<TInput, TOutput>(
  channel: string,
  handler: (data: TInput, event: IpcMainInvokeEvent) => Promise<TOutput> | TOutput
): void {
  ipcMain.handle(channel, async (event, data: TInput): Promise<HandlerResult<TOutput>> => {
    try {
      const result = await handler(data, event);
      return { success: true, data: result };
    } catch (error: any) {
      console.error(`[IPC ${channel}] Error:`, error.message || error);
      return { success: false, error: error.message || String(error) };
    }
  });
}

/**
 * Creates an ipcMain.handle() handler that returns raw data (not wrapped).
 * Use for handlers that need to return data directly without the success/error wrapper.
 */
export function createRawHandler<TInput, TOutput>(
  channel: string,
  handler: (data: TInput, event: IpcMainInvokeEvent) => Promise<TOutput> | TOutput
): void {
  ipcMain.handle(channel, async (event, data: TInput): Promise<TOutput> => {
    try {
      return await handler(data, event);
    } catch (error: any) {
      console.error(`[IPC ${channel}] Error:`, error.message || error);
      throw error;
    }
  });
}

/**
 * Creates an ipcMain.on() handler (event-based, no response expected).
 * The handler receives the event and can use event.sender.send() to reply.
 */
export function createEventHandler<TInput>(
  channel: string,
  handler: (event: IpcMainEvent, data: TInput) => Promise<void> | void
): void {
  ipcMain.on(channel, async (event: IpcMainEvent, data: TInput) => {
    try {
      await handler(event, data);
    } catch (error: any) {
      console.error(`[IPC ${channel}] Error:`, error.message || error);
      // Try to send error back to renderer
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send(`${channel}-error`, { error: error.message || String(error) });
        }
      } catch {
        // Ignore send errors
      }
    }
  });
}

/**
 * Creates an ipcMain.on() handler that replies on a specific channel.
 * Useful for request/response patterns using ipcMain.on instead of handle.
 */
export function createReplyHandler<TInput, TOutput>(
  channel: string,
  replyChannel: string,
  handler: (data: TInput, event: IpcMainEvent) => Promise<TOutput> | TOutput
): void {
  ipcMain.on(channel, async (event: IpcMainEvent, data: TInput) => {
    try {
      const result = await handler(data, event);
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send(replyChannel, { success: true, data: result });
      }
    } catch (error: any) {
      console.error(`[IPC ${channel}] Error:`, error.message || error);
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send(replyChannel, { success: false, error: error.message || String(error) });
      }
    }
  });
}

/**
 * Batch register multiple simple handlers at once.
 * Each entry maps a channel to a handler function.
 */
export function registerHandlers(
  handlers: Record<string, (data: any, event: IpcMainInvokeEvent) => Promise<any> | any>
): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    createHandler(channel, handler);
  }
}

/**
 * Batch register multiple raw handlers at once.
 */
export function registerRawHandlers(
  handlers: Record<string, (data: any, event: IpcMainInvokeEvent) => Promise<any> | any>
): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    createRawHandler(channel, handler);
  }
}
