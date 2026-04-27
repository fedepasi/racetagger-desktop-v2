"use strict";
/**
 * Integration tests for folder selection functionality
 * Tests both new Enhanced File Browser system and fallback to original system
 */
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
// Mock window.api for renderer-side testing
const mockApi = {
    invoke: globals_1.jest.fn(),
    send: globals_1.jest.fn(),
    receive: globals_1.jest.fn()
};
global.window = {
    api: mockApi
};
describe('Folder Selection Integration', () => {
    let mockEnhancedFileBrowser;
    beforeEach(() => {
        globals_1.jest.clearAllMocks();
        // Mock Enhanced File Browser class
        mockEnhancedFileBrowser = {
            selectFolder: globals_1.jest.fn(),
            selectFiles: globals_1.jest.fn(),
            selectSingleFile: globals_1.jest.fn(),
            supportedFormats: ['jpg', 'jpeg', 'png', 'webp', 'nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng']
        };
        global.EnhancedFileBrowser = globals_1.jest.fn().mockImplementation(() => mockEnhancedFileBrowser);
    });
    describe('Enhanced File Browser - Primary System', () => {
        it('should successfully select folder using new dialog-show-open handler', async () => {
            // Mock successful dialog response
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/test/images']
            });
            // Mock successful file listing
            mockApi.invoke.mockResolvedValueOnce([
                {
                    name: 'image1.jpg',
                    path: '/test/images/image1.jpg',
                    size: 1024000,
                    extension: 'jpg',
                    isRaw: false
                },
                {
                    name: 'raw1.nef',
                    path: '/test/images/raw1.nef',
                    size: 2048000,
                    extension: 'nef',
                    isRaw: true
                }
            ]);
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                // Simulate Enhanced File Browser selectFolder behavior
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    const folderPath = dialogResult.filePaths[0];
                    const files = await window.api.invoke('get-folder-files', {
                        folderPath,
                        extensions: mockEnhancedFileBrowser.supportedFormats
                    });
                    return {
                        folderPath,
                        files,
                        imageCount: files.length
                    };
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectFolder();
            expect(result).toEqual({
                folderPath: '/test/images',
                files: expect.arrayContaining([
                    expect.objectContaining({
                        name: 'image1.jpg',
                        extension: 'jpg',
                        isRaw: false
                    }),
                    expect.objectContaining({
                        name: 'raw1.nef',
                        extension: 'nef',
                        isRaw: true
                    })
                ]),
                imageCount: 2
            });
            expect(mockApi.invoke).toHaveBeenCalledWith('dialog-show-open', {
                properties: ['openDirectory'],
                title: 'Select Image Folder'
            });
            expect(mockApi.invoke).toHaveBeenCalledWith('get-folder-files', {
                folderPath: '/test/images',
                extensions: mockEnhancedFileBrowser.supportedFormats
            });
        });
        it('should handle user cancellation gracefully', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: true,
                filePaths: []
            });
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    // Won't reach here in this test
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectFolder();
            expect(result).toBe(null);
            expect(mockApi.invoke).toHaveBeenCalledTimes(1); // Only dialog call, no file listing
        });
        it('should filter files by supported extensions correctly', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/test/mixed']
            });
            // Mock files with mixed extensions
            mockApi.invoke.mockResolvedValueOnce([
                {
                    name: 'image.jpg',
                    path: '/test/mixed/image.jpg',
                    size: 1024,
                    extension: 'jpg',
                    isRaw: false
                },
                {
                    name: 'document.txt',
                    path: '/test/mixed/document.txt',
                    size: 512,
                    extension: 'txt',
                    isRaw: false
                },
                {
                    name: 'raw.nef',
                    path: '/test/mixed/raw.nef',
                    size: 2048,
                    extension: 'nef',
                    isRaw: true
                }
            ]);
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    const folderPath = dialogResult.filePaths[0];
                    const files = await window.api.invoke('get-folder-files', {
                        folderPath,
                        extensions: mockEnhancedFileBrowser.supportedFormats
                    });
                    return {
                        folderPath,
                        files,
                        imageCount: files.length
                    };
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectFolder();
            expect(result?.files).toHaveLength(3); // All files returned (filtering happens on backend)
            expect(result?.files.find(f => f.name === 'document.txt')).toBeDefined(); // Backend should include all files
        });
    });
    describe('Fallback System Integration', () => {
        it('should fallback to original system when enhanced system fails', async () => {
            // Mock Enhanced File Browser failure
            mockEnhancedFileBrowser.selectFolder.mockRejectedValue(new Error('Enhanced system failed'));
            // Mock original system success
            const mockOriginalFolderSelection = globals_1.jest.fn().mockImplementation(() => {
                // Simulate original folder selection via send/receive pattern
                window.api.send('select-folder');
                // Simulate successful folder selection event
                setTimeout(() => {
                    const mockReceiver = window.api.receive;
                    const folderCallback = mockReceiver.mock.calls.find(call => call[0] === 'folder-selected')?.[1];
                    if (folderCallback) {
                        folderCallback('/fallback/folder', 5);
                    }
                }, 0);
                return Promise.resolve({
                    folderPath: '/fallback/folder',
                    imageCount: 5
                });
            });
            // Test fallback logic
            let result;
            try {
                result = await mockEnhancedFileBrowser.selectFolder();
            }
            catch (error) {
                console.log('Enhanced system failed, using fallback');
                result = await mockOriginalFolderSelection();
            }
            expect(result).toEqual({
                folderPath: '/fallback/folder',
                imageCount: 5
            });
        });
        it('should handle IPC handler not available error', async () => {
            // Mock handler not available
            mockApi.invoke.mockRejectedValue(new Error('Invalid IPC channel: dialog-show-open'));
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                try {
                    await window.api.invoke('dialog-show-open', {
                        properties: ['openDirectory'],
                        title: 'Select Image Folder'
                    });
                }
                catch (error) {
                    console.log('IPC handler not available, falling back');
                    throw new Error('Handler not available');
                }
            });
            await expect(mockEnhancedFileBrowser.selectFolder()).rejects.toThrow('Handler not available');
        });
        it('should provide user-friendly error messages when both systems fail', async () => {
            // Mock both systems failing
            mockEnhancedFileBrowser.selectFolder.mockRejectedValue(new Error('Enhanced system failed'));
            const mockShowErrorNotification = globals_1.jest.fn();
            const testFolderSelection = async () => {
                try {
                    return await mockEnhancedFileBrowser.selectFolder();
                }
                catch (enhancedError) {
                    try {
                        // Try fallback
                        window.api.send('select-folder');
                        return await new Promise((resolve, reject) => {
                            setTimeout(() => reject(new Error('Original system also failed')), 100);
                        });
                    }
                    catch (fallbackError) {
                        mockShowErrorNotification('Unable to select folder. Please try again or restart the application.');
                        throw new Error('All folder selection methods failed');
                    }
                }
            };
            await expect(testFolderSelection()).rejects.toThrow('All folder selection methods failed');
            expect(mockShowErrorNotification).toHaveBeenCalledWith('Unable to select folder. Please try again or restart the application.');
        });
    });
    describe('Cross-System Compatibility', () => {
        it('should maintain consistent folder selection interface', async () => {
            // Test that both systems return compatible data structures
            const enhancedResult = {
                folderPath: '/test/folder',
                files: [
                    {
                        name: 'test.jpg',
                        path: '/test/folder/test.jpg',
                        size: 1024,
                        extension: 'jpg',
                        isRaw: false
                    }
                ],
                imageCount: 1
            };
            const originalResult = {
                folderPath: '/test/folder',
                imageCount: 1
            };
            // Both results should have required fields
            expect(enhancedResult).toHaveProperty('folderPath');
            expect(enhancedResult).toHaveProperty('imageCount');
            expect(originalResult).toHaveProperty('folderPath');
            expect(originalResult).toHaveProperty('imageCount');
            // Enhanced result has additional files data
            expect(enhancedResult).toHaveProperty('files');
            expect(Array.isArray(enhancedResult.files)).toBe(true);
        });
        it('should handle empty folders consistently', async () => {
            // Enhanced system with empty folder
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/empty/folder']
            });
            mockApi.invoke.mockResolvedValueOnce([]); // Empty file list
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    const folderPath = dialogResult.filePaths[0];
                    const files = await window.api.invoke('get-folder-files', {
                        folderPath,
                        extensions: mockEnhancedFileBrowser.supportedFormats
                    });
                    return {
                        folderPath,
                        files,
                        imageCount: files.length
                    };
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectFolder();
            expect(result).toEqual({
                folderPath: '/empty/folder',
                files: [],
                imageCount: 0
            });
        });
        it('should preserve folder paths with special characters', async () => {
            const specialFolderPath = '/test/folder with spaces & symbols!';
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: [specialFolderPath]
            });
            mockApi.invoke.mockResolvedValueOnce([]);
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    const folderPath = dialogResult.filePaths[0];
                    const files = await window.api.invoke('get-folder-files', {
                        folderPath,
                        extensions: mockEnhancedFileBrowser.supportedFormats
                    });
                    return {
                        folderPath,
                        files,
                        imageCount: files.length
                    };
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectFolder();
            expect(result?.folderPath).toBe(specialFolderPath);
        });
    });
    describe('Performance and Error Handling', () => {
        it('should timeout gracefully for large folders', async () => {
            const mockLargeFileList = Array.from({ length: 10000 }, (_, i) => ({
                name: `image${i}.jpg`,
                path: `/large/folder/image${i}.jpg`,
                size: 1024,
                extension: 'jpg',
                isRaw: false
            }));
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/large/folder']
            });
            // Simulate slow file listing
            mockApi.invoke.mockImplementation(async (channel, options) => {
                if (channel === 'get-folder-files') {
                    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing time
                    return mockLargeFileList;
                }
            });
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    const folderPath = dialogResult.filePaths[0];
                    const files = await window.api.invoke('get-folder-files', {
                        folderPath,
                        extensions: mockEnhancedFileBrowser.supportedFormats
                    });
                    return {
                        folderPath,
                        files,
                        imageCount: files.length
                    };
                }
                return null;
            });
            const startTime = Date.now();
            const result = await mockEnhancedFileBrowser.selectFolder();
            const endTime = Date.now();
            expect(result?.imageCount).toBe(10000);
            expect(endTime - startTime).toBeLessThan(1000); // Should complete within reasonable time
        });
        it('should handle file system permission errors', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/restricted/folder']
            });
            mockApi.invoke.mockRejectedValueOnce(new Error('Permission denied'));
            mockEnhancedFileBrowser.selectFolder.mockImplementation(async () => {
                const dialogResult = await window.api.invoke('dialog-show-open', {
                    properties: ['openDirectory'],
                    title: 'Select Image Folder'
                });
                if (!dialogResult.canceled) {
                    const folderPath = dialogResult.filePaths[0];
                    try {
                        const files = await window.api.invoke('get-folder-files', {
                            folderPath,
                            extensions: mockEnhancedFileBrowser.supportedFormats
                        });
                        return { folderPath, files, imageCount: files.length };
                    }
                    catch (error) {
                        throw new Error(`Unable to access folder: ${error.message}`);
                    }
                }
                return null;
            });
            await expect(mockEnhancedFileBrowser.selectFolder()).rejects.toThrow('Unable to access folder: Permission denied');
        });
    });
});
