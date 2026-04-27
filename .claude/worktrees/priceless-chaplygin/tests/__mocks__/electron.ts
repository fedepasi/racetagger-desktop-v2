// Mock Electron modules for testing
import { EventEmitter } from 'events';

// Mock dialog results
const mockDialogResults = {
  showOpenDialog: {
    canceled: false,
    filePaths: ['/test/folder', '/test/file1.jpg', '/test/file2.png']
  }
};

// Mock BrowserWindow
class MockBrowserWindow extends EventEmitter {
  constructor(options?: any) {
    super();
    this.webContents = new MockWebContents();
  }

  loadFile(filePath: string) {
    return Promise.resolve();
  }

  show() {}
  hide() {}
  close() {}
  
  webContents: MockWebContents;
}

// Mock WebContents
class MockWebContents extends EventEmitter {
  openDevTools() {}
  send(channel: string, ...args: any[]) {
    this.emit('ipc-message', channel, ...args);
  }
}

// Mock app
const mockApp = {
  on: jest.fn(),
  whenReady: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn(),
  setName: jest.fn(),
  ready: true
};

// Mock ipcMain
const mockIpcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn(),
  removeAllListeners: jest.fn()
};

// Mock dialog
const mockDialog = {
  showOpenDialog: jest.fn().mockResolvedValue(mockDialogResults.showOpenDialog),
  showSaveDialog: jest.fn(),
  showMessageBox: jest.fn(),
  showErrorBox: jest.fn()
};

// Mock shell
const mockShell = {
  openExternal: jest.fn(),
  openPath: jest.fn(),
  showItemInFolder: jest.fn()
};

export {
  MockBrowserWindow as BrowserWindow,
  mockApp as app,
  mockIpcMain as ipcMain,
  mockDialog as dialog,
  mockShell as shell
};

export const IpcMainEvent = {};

export default {
  BrowserWindow: MockBrowserWindow,
  app: mockApp,
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  shell: mockShell,
  IpcMainEvent
};