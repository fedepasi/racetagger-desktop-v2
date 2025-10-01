// Global test setup
process.env.NODE_ENV = 'test';

// Mock console methods for cleaner test output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Store original methods for restoration
(global as any).originalConsole = {
  log: originalConsoleLog,
  error: originalConsoleError,
  warn: originalConsoleWarn,
};

// Mock console methods to reduce noise in tests
console.log = jest.fn();
console.error = jest.fn();
console.warn = jest.fn();

// Global test timeout
jest.setTimeout(30000);

// Mock Electron environment
Object.defineProperty(process, 'platform', {
  value: 'darwin'
});

// Mock process.versions for Electron environment
Object.defineProperty(process, 'versions', {
  value: {
    ...process.versions,
    electron: '36.0.0',
    node: '20.11.1',
  },
  writable: true
});

// Utility function to restore console for specific tests
(global as any).restoreConsole = () => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
};

// Utility function to mock console again
(global as any).mockConsole = () => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
};