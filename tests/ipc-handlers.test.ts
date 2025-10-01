/**
 * Test suite for IPC handlers that fix file selection bugs
 * Tests the 4 new handlers: dialog-show-open, get-folder-files, get-file-stats, generate-thumbnail
 */

import { jest } from '@jest/globals';
import * as path from 'path';

// Mock modules before importing main
jest.mock('electron');
jest.mock('fs');
jest.mock('fs/promises');
jest.mock('../src/database-service');
jest.mock('../src/auth-service');
jest.mock('../src/config');

// Import mocks
import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

describe('IPC Handlers - File Selection Bug Fixes', () => {
  let mockMainWindow: any;
  let mockHandlers: Map<string, Function>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock main window
    mockMainWindow = new BrowserWindow();
    
    // Track registered handlers
    mockHandlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: Function) => {
      mockHandlers.set(channel, handler);
    });

    // Mock fs functions with proper test data
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fsPromises.readdir as jest.Mock).mockResolvedValue(['test1.jpg', 'test2.png', 'test3.nef', 'document.txt']);
    (fsPromises.stat as jest.Mock).mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 1024000,
      mtime: new Date('2023-01-01'),
      ctime: new Date('2023-01-01')
    });
  });

  describe('dialog-show-open handler', () => {
    it('should be registered as IPC handler', () => {
      // Import main to register handlers
      require('../src/main');
      
      expect(ipcMain.handle).toHaveBeenCalledWith('dialog-show-open', expect.any(Function));
    });

    it('should call dialog.showOpenDialog with correct options', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('dialog-show-open');
      expect(handler).toBeDefined();

      const testOptions = {
        properties: ['openDirectory'],
        title: 'Select Image Folder'
      };

      // Mock dialog response
      (dialog.showOpenDialog as jest.Mock).mockResolvedValue({
        canceled: false,
        filePaths: ['/test/folder']
      });

      const result = await handler({}, testOptions);

      expect(dialog.showOpenDialog).toHaveBeenCalledWith(mockMainWindow, testOptions);
      expect(result).toEqual({
        canceled: false,
        filePaths: ['/test/folder']
      });
    });

    it('should throw error when main window is not available', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('dialog-show-open');
      
      // Mock no main window
      const originalMainWindow = (global as any).mainWindow;
      (global as any).mainWindow = null;

      await expect(handler({}, {})).rejects.toThrow('Main window not available');
      
      // Restore
      (global as any).mainWindow = originalMainWindow;
    });

    it('should handle dialog errors properly', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('dialog-show-open');
      const testError = new Error('Dialog failed');
      
      (dialog.showOpenDialog as jest.Mock).mockRejectedValue(testError);

      await expect(handler({}, {})).rejects.toThrow('Dialog failed');
    });
  });

  describe('get-folder-files handler', () => {
    it('should be registered as IPC handler', () => {
      require('../src/main');
      
      expect(ipcMain.handle).toHaveBeenCalledWith('get-folder-files', expect.any(Function));
    });

    it('should return image files from folder with correct format', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-folder-files');
      expect(handler).toBeDefined();

      const mockFiles = ['image1.jpg', 'image2.png', 'raw1.nef', 'document.txt'];
      (fsPromises.readdir as jest.Mock).mockResolvedValue(mockFiles);

      const result = await handler({}, {
        folderPath: '/test/folder',
        extensions: ['jpg', 'png', 'nef']
      });

      expect(fsPromises.readdir).toHaveBeenCalledWith('/test/folder');
      expect(result).toHaveLength(3); // Only image files, no document.txt
      
      // Check first result structure
      expect(result[0]).toEqual({
        name: 'image1.jpg',
        path: path.join('/test/folder', 'image1.jpg'),
        size: 1024000,
        extension: 'jpg',
        isRaw: false
      });

      // Check RAW file detection
      const rawFile = result.find(f => f.extension === 'nef');
      expect(rawFile?.isRaw).toBe(true);
    });

    it('should return all files when no extensions specified', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-folder-files');
      
      const result = await handler({}, {
        folderPath: '/test/folder',
        extensions: []
      });

      expect(result).toHaveLength(4); // All files including document.txt
    });

    it('should throw error when folder does not exist', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-folder-files');
      
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(handler({}, { folderPath: '/nonexistent' })).rejects.toThrow('Folder does not exist');
    });

    it('should handle readdir errors', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-folder-files');
      
      (fsPromises.readdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(handler({}, { folderPath: '/test/folder' })).rejects.toThrow('Permission denied');
    });
  });

  describe('get-file-stats handler', () => {
    it('should be registered as IPC handler', () => {
      require('../src/main');
      
      expect(ipcMain.handle).toHaveBeenCalledWith('get-file-stats', expect.any(Function));
    });

    it('should return file statistics with correct format', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-file-stats');
      expect(handler).toBeDefined();

      const mockStats = {
        size: 2048000,
        mtime: new Date('2023-06-01'),
        ctime: new Date('2023-05-01'),
        isFile: () => true,
        isDirectory: () => false
      };
      
      (fsPromises.stat as jest.Mock).mockResolvedValue(mockStats);

      const result = await handler({}, '/test/file.jpg');

      expect(fsPromises.stat).toHaveBeenCalledWith('/test/file.jpg');
      expect(result).toEqual({
        size: 2048000,
        mtime: mockStats.mtime,
        ctime: mockStats.ctime,
        isFile: true,
        isDirectory: false
      });
    });

    it('should throw error when file does not exist', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-file-stats');
      
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(handler({}, '/nonexistent/file.jpg')).rejects.toThrow('File does not exist');
    });

    it('should handle stat errors', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('get-file-stats');
      
      (fsPromises.stat as jest.Mock).mockRejectedValue(new Error('Access denied'));

      await expect(handler({}, '/test/file.jpg')).rejects.toThrow('Access denied');
    });
  });

  describe('generate-thumbnail handler', () => {
    it('should be registered as IPC handler', () => {
      require('../src/main');
      
      expect(ipcMain.handle).toHaveBeenCalledWith('generate-thumbnail', expect.any(Function));
    });

    it('should return file URL for standard image files', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');
      expect(handler).toBeDefined();

      const result = await handler({}, '/test/image.jpg');

      expect(result).toBe('file:///test/image.jpg');
    });

    it('should return null for RAW files', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');

      const result = await handler({}, '/test/raw.nef');

      expect(result).toBe(null);
    });

    it('should return null for unsupported file types', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');

      const result = await handler({}, '/test/document.txt');

      expect(result).toBe(null);
    });

    it('should return null when file does not exist', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');
      
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await handler({}, '/nonexistent/file.jpg');

      expect(result).toBe(null);
    });

    it('should handle errors gracefully and return null', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');
      
      // Mock existsSync to throw error
      (fs.existsSync as jest.Mock).mockImplementation(() => {
        throw new Error('File system error');
      });

      const result = await handler({}, '/test/image.jpg');

      expect(result).toBe(null);
    });

    it('should support all standard image extensions', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');
      
      const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      
      for (const ext of supportedExtensions) {
        const result = await handler({}, `/test/image${ext}`);
        expect(result).toBe(`file:///test/image${ext}`);
      }
    });

    it('should detect all RAW extensions correctly', async () => {
      require('../src/main');
      
      const handler = mockHandlers.get('generate-thumbnail');
      
      const rawExtensions = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
      
      for (const ext of rawExtensions) {
        const result = await handler({}, `/test/raw${ext}`);
        expect(result).toBe(null);
      }
    });
  });

  describe('Handler Integration', () => {
    it('should register all 4 handlers without conflicts', () => {
      require('../src/main');
      
      const expectedHandlers = [
        'dialog-show-open',
        'get-folder-files', 
        'get-file-stats',
        'generate-thumbnail'
      ];

      expectedHandlers.forEach(handler => {
        expect(ipcMain.handle).toHaveBeenCalledWith(handler, expect.any(Function));
      });
    });

    it('should have all handlers available in the handlers map', () => {
      require('../src/main');
      
      const expectedHandlers = [
        'dialog-show-open',
        'get-folder-files',
        'get-file-stats', 
        'generate-thumbnail'
      ];

      expectedHandlers.forEach(handlerName => {
        expect(mockHandlers.has(handlerName)).toBe(true);
        expect(mockHandlers.get(handlerName)).toBeInstanceOf(Function);
      });
    });
  });
});