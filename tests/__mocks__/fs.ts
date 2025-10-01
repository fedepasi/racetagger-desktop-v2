// Mock fs module for testing
import { jest } from '@jest/globals';

const mockStats = {
  isFile: jest.fn().mockReturnValue(true),
  isDirectory: jest.fn().mockReturnValue(false),
  size: 1024000,
  mtime: new Date('2023-01-01'),
  ctime: new Date('2023-01-01')
};

const mockFsPromises = {
  readdir: jest.fn().mockResolvedValue(['test1.jpg', 'test2.png', 'test3.nef']),
  stat: jest.fn().mockResolvedValue(mockStats),
  readFile: jest.fn().mockResolvedValue(Buffer.from('test file content')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined)
};

const mockFs = {
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('test file content')),
  writeFileSync: jest.fn(),
  statSync: jest.fn().mockReturnValue(mockStats),
  promises: mockFsPromises
};

export default mockFs;
export { mockFsPromises as promises };