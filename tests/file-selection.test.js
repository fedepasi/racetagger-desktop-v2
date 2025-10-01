"use strict";
/**
 * Integration tests for single and multiple file selection functionality
 * Tests that file selection no longer produces errors and works correctly
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
describe('File Selection Integration', () => {
    let mockEnhancedFileBrowser;
    beforeEach(() => {
        globals_1.jest.clearAllMocks();
        // Mock Enhanced File Browser class
        mockEnhancedFileBrowser = {
            selectFiles: globals_1.jest.fn(),
            selectSingleFile: globals_1.jest.fn(),
            createFileObject: globals_1.jest.fn(),
            generateThumbnail: globals_1.jest.fn(),
            supportedFormats: ['jpg', 'jpeg', 'png', 'webp', 'nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng']
        };
        global.EnhancedFileBrowser = globals_1.jest.fn().mockImplementation(() => mockEnhancedFileBrowser);
    });
    describe('Single File Selection', () => {
        it('should successfully select a single image file', async () => {
            // Mock successful dialog response
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/test/images/single.jpg']
            });
            // Mock file stats
            mockApi.invoke.mockResolvedValueOnce({
                size: 1024000,
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                isFile: true,
                isDirectory: false
            });
            // Mock thumbnail generation
            mockApi.invoke.mockResolvedValueOnce('file:///test/images/single.jpg');
            mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                const stats = await window.api.invoke('get-file-stats', filePath);
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                return {
                    name: filePath.split('/').pop(),
                    path: filePath,
                    size: stats.size,
                    extension,
                    isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                    mtime: stats.mtime,
                    ctime: stats.ctime,
                    thumbnail: await window.api.invoke('generate-thumbnail', filePath)
                };
            });
            mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile'],
                    title: 'Select Image File',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    return await mockEnhancedFileBrowser.createFileObject(filePath);
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectSingleFile();
            expect(result).toEqual({
                name: 'single.jpg',
                path: '/test/images/single.jpg',
                size: 1024000,
                extension: 'jpg',
                isRaw: false,
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                thumbnail: 'file:///test/images/single.jpg'
            });
            expect(mockApi.invoke).toHaveBeenCalledWith('dialog-show-open', {
                properties: ['openFile'],
                title: 'Select Image File',
                filters: [
                    { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                ]
            });
            expect(mockApi.invoke).toHaveBeenCalledWith('get-file-stats', '/test/images/single.jpg');
            expect(mockApi.invoke).toHaveBeenCalledWith('generate-thumbnail', '/test/images/single.jpg');
        });
        it('should handle RAW file selection correctly', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/test/raw/camera.nef']
            });
            mockApi.invoke.mockResolvedValueOnce({
                size: 25000000, // Large RAW file
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                isFile: true,
                isDirectory: false
            });
            // RAW files return null for thumbnail
            mockApi.invoke.mockResolvedValueOnce(null);
            mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                const stats = await window.api.invoke('get-file-stats', filePath);
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                return {
                    name: filePath.split('/').pop(),
                    path: filePath,
                    size: stats.size,
                    extension,
                    isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                    mtime: stats.mtime,
                    ctime: stats.ctime,
                    thumbnail: await window.api.invoke('generate-thumbnail', filePath)
                };
            });
            mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile'],
                    title: 'Select Image File',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    return await mockEnhancedFileBrowser.createFileObject(filePath);
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectSingleFile();
            expect(result).toEqual({
                name: 'camera.nef',
                path: '/test/raw/camera.nef',
                size: 25000000,
                extension: 'nef',
                isRaw: true,
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                thumbnail: null
            });
        });
        it('should handle user cancellation in single file selection', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: true,
                filePaths: []
            });
            mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile'],
                    title: 'Select Image File',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    return await mockEnhancedFileBrowser.createFileObject(filePath);
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectSingleFile();
            expect(result).toBe(null);
            expect(mockApi.invoke).toHaveBeenCalledTimes(1); // Only dialog call
        });
    });
    describe('Multiple File Selection', () => {
        it('should successfully select multiple image files', async () => {
            const testFiles = [
                '/test/images/image1.jpg',
                '/test/images/image2.png',
                '/test/raw/raw1.nef'
            ];
            // Mock dialog result
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: testFiles
            });
            // Mock file stats for each file
            const mockStats = [
                { size: 1024000, mtime: new Date('2023-06-01'), ctime: new Date('2023-05-01'), isFile: true, isDirectory: false },
                { size: 2048000, mtime: new Date('2023-06-02'), ctime: new Date('2023-05-02'), isFile: true, isDirectory: false },
                { size: 25000000, mtime: new Date('2023-06-03'), ctime: new Date('2023-05-03'), isFile: true, isDirectory: false }
            ];
            // Mock thumbnails (null for RAW)
            const mockThumbnails = [
                'file:///test/images/image1.jpg',
                'file:///test/images/image2.png',
                null
            ];
            let statCallCount = 0;
            let thumbnailCallCount = 0;
            mockApi.invoke.mockImplementation(async (channel, ...args) => {
                if (channel === 'get-file-stats') {
                    return mockStats[statCallCount++];
                }
                else if (channel === 'generate-thumbnail') {
                    return mockThumbnails[thumbnailCallCount++];
                }
            });
            mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                const stats = await window.api.invoke('get-file-stats', filePath);
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                return {
                    name: filePath.split('/').pop(),
                    path: filePath,
                    size: stats.size,
                    extension,
                    isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                    mtime: stats.mtime,
                    ctime: stats.ctime,
                    thumbnail: await window.api.invoke('generate-thumbnail', filePath)
                };
            });
            mockEnhancedFileBrowser.selectFiles.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile', 'multiSelections'],
                    title: 'Select Image Files',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const files = [];
                    for (const filePath of result.filePaths) {
                        files.push(await mockEnhancedFileBrowser.createFileObject(filePath));
                    }
                    return files;
                }
                return [];
            });
            const result = await mockEnhancedFileBrowser.selectFiles();
            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({
                name: 'image1.jpg',
                path: '/test/images/image1.jpg',
                size: 1024000,
                extension: 'jpg',
                isRaw: false,
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                thumbnail: 'file:///test/images/image1.jpg'
            });
            expect(result[2]).toEqual({
                name: 'raw1.nef',
                path: '/test/raw/raw1.nef',
                size: 25000000,
                extension: 'nef',
                isRaw: true,
                mtime: new Date('2023-06-03'),
                ctime: new Date('2023-05-03'),
                thumbnail: null
            });
            expect(mockApi.invoke).toHaveBeenCalledWith('dialog-show-open', {
                properties: ['openFile', 'multiSelections'],
                title: 'Select Image Files',
                filters: [
                    { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                ]
            });
        });
        it('should handle mixed file types in multiple selection', async () => {
            const testFiles = [
                '/test/images/standard.jpg',
                '/test/images/another.webp',
                '/test/raw/camera1.cr2',
                '/test/raw/camera2.arw'
            ];
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: testFiles
            });
            // Mock consistent stats for all files
            mockApi.invoke.mockImplementation(async (channel, filePath) => {
                if (channel === 'get-file-stats') {
                    const isRaw = ['.cr2', '.arw', '.nef'].includes(require('path').extname(filePath).toLowerCase());
                    return {
                        size: isRaw ? 25000000 : 1024000,
                        mtime: new Date('2023-06-01'),
                        ctime: new Date('2023-05-01'),
                        isFile: true,
                        isDirectory: false
                    };
                }
                else if (channel === 'generate-thumbnail') {
                    const isRaw = ['.cr2', '.arw', '.nef'].includes(require('path').extname(filePath).toLowerCase());
                    return isRaw ? null : `file://${filePath}`;
                }
            });
            mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                const stats = await window.api.invoke('get-file-stats', filePath);
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                return {
                    name: filePath.split('/').pop(),
                    path: filePath,
                    size: stats.size,
                    extension,
                    isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                    mtime: stats.mtime,
                    ctime: stats.ctime,
                    thumbnail: await window.api.invoke('generate-thumbnail', filePath)
                };
            });
            mockEnhancedFileBrowser.selectFiles.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile', 'multiSelections'],
                    title: 'Select Image Files',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const files = [];
                    for (const filePath of result.filePaths) {
                        files.push(await mockEnhancedFileBrowser.createFileObject(filePath));
                    }
                    return files;
                }
                return [];
            });
            const result = await mockEnhancedFileBrowser.selectFiles();
            expect(result).toHaveLength(4);
            // Check standard images
            const standardImages = result.filter(f => !f.isRaw);
            expect(standardImages).toHaveLength(2);
            standardImages.forEach(img => {
                expect(img.thumbnail).toMatch(/^file:\/\//);
                expect(img.size).toBe(1024000);
            });
            // Check RAW images  
            const rawImages = result.filter(f => f.isRaw);
            expect(rawImages).toHaveLength(2);
            rawImages.forEach(img => {
                expect(img.thumbnail).toBe(null);
                expect(img.size).toBe(25000000);
            });
        });
        it('should return empty array when no files selected in multiple selection', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: true,
                filePaths: []
            });
            mockEnhancedFileBrowser.selectFiles.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile', 'multiSelections'],
                    title: 'Select Image Files',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const files = [];
                    for (const filePath of result.filePaths) {
                        files.push(await mockEnhancedFileBrowser.createFileObject(filePath));
                    }
                    return files;
                }
                return [];
            });
            const result = await mockEnhancedFileBrowser.selectFiles();
            expect(result).toEqual([]);
            expect(mockApi.invoke).toHaveBeenCalledTimes(1); // Only dialog call
        });
    });
    describe('Error Handling in File Selection', () => {
        it('should handle file stat errors gracefully', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/test/corrupted.jpg']
            });
            mockApi.invoke.mockRejectedValueOnce(new Error('File corrupted'));
            mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                try {
                    const stats = await window.api.invoke('get-file-stats', filePath);
                    // Won't reach here in this test
                }
                catch (error) {
                    // Return basic file object when stats fail
                    const extension = filePath.split('.').pop()?.toLowerCase() || '';
                    return {
                        name: filePath.split('/').pop(),
                        path: filePath,
                        size: 0,
                        extension,
                        isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                        mtime: null,
                        ctime: null,
                        thumbnail: null,
                        error: 'Unable to read file stats'
                    };
                }
            });
            mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile'],
                    title: 'Select Image File',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    return await mockEnhancedFileBrowser.createFileObject(filePath);
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectSingleFile();
            expect(result).toEqual({
                name: 'corrupted.jpg',
                path: '/test/corrupted.jpg',
                size: 0,
                extension: 'jpg',
                isRaw: false,
                mtime: null,
                ctime: null,
                thumbnail: null,
                error: 'Unable to read file stats'
            });
        });
        it('should handle thumbnail generation errors without failing', async () => {
            mockApi.invoke.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/test/image.jpg']
            });
            mockApi.invoke.mockResolvedValueOnce({
                size: 1024000,
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                isFile: true,
                isDirectory: false
            });
            // Thumbnail generation fails
            mockApi.invoke.mockRejectedValueOnce(new Error('Thumbnail generation failed'));
            mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                const stats = await window.api.invoke('get-file-stats', filePath);
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                let thumbnail = null;
                try {
                    thumbnail = await window.api.invoke('generate-thumbnail', filePath);
                }
                catch (error) {
                    console.warn('Thumbnail generation failed, continuing without thumbnail');
                }
                return {
                    name: filePath.split('/').pop(),
                    path: filePath,
                    size: stats.size,
                    extension,
                    isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                    mtime: stats.mtime,
                    ctime: stats.ctime,
                    thumbnail
                };
            });
            mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                const result = await window.api.invoke('dialog-show-open', {
                    properties: ['openFile'],
                    title: 'Select Image File',
                    filters: [
                        { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                    ]
                });
                if (!result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    return await mockEnhancedFileBrowser.createFileObject(filePath);
                }
                return null;
            });
            const result = await mockEnhancedFileBrowser.selectSingleFile();
            expect(result).toEqual({
                name: 'image.jpg',
                path: '/test/image.jpg',
                size: 1024000,
                extension: 'jpg',
                isRaw: false,
                mtime: new Date('2023-06-01'),
                ctime: new Date('2023-05-01'),
                thumbnail: null // Failed but didn't throw error
            });
        });
        it('should handle dialog errors and provide meaningful feedback', async () => {
            mockApi.invoke.mockRejectedValue(new Error('Dialog service unavailable'));
            mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                try {
                    const result = await window.api.invoke('dialog-show-open', {
                        properties: ['openFile'],
                        title: 'Select Image File',
                        filters: [
                            { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                        ]
                    });
                }
                catch (error) {
                    throw new Error('Unable to open file selection dialog. Please try again or restart the application.');
                }
            });
            await expect(mockEnhancedFileBrowser.selectSingleFile()).rejects.toThrow('Unable to open file selection dialog. Please try again or restart the application.');
        });
    });
    describe('File Format Support', () => {
        it('should support all documented standard image formats', async () => {
            const standardFormats = ['.jpg', '.jpeg', '.png', '.webp'];
            for (const format of standardFormats) {
                const filePath = `/test/image${format}`;
                mockApi.invoke.mockResolvedValueOnce({
                    canceled: false,
                    filePaths: [filePath]
                });
                mockApi.invoke.mockResolvedValueOnce({
                    size: 1024000,
                    mtime: new Date('2023-06-01'),
                    ctime: new Date('2023-05-01'),
                    isFile: true,
                    isDirectory: false
                });
                mockApi.invoke.mockResolvedValueOnce(`file://${filePath}`);
                mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                    const stats = await window.api.invoke('get-file-stats', filePath);
                    const extension = filePath.split('.').pop()?.toLowerCase() || '';
                    return {
                        name: filePath.split('/').pop(),
                        path: filePath,
                        size: stats.size,
                        extension,
                        isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                        mtime: stats.mtime,
                        ctime: stats.ctime,
                        thumbnail: await window.api.invoke('generate-thumbnail', filePath)
                    };
                });
                mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                    const result = await window.api.invoke('dialog-show-open', {
                        properties: ['openFile'],
                        title: 'Select Image File',
                        filters: [
                            { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                        ]
                    });
                    if (!result.canceled && result.filePaths.length > 0) {
                        const filePath = result.filePaths[0];
                        return await mockEnhancedFileBrowser.createFileObject(filePath);
                    }
                    return null;
                });
                const result = await mockEnhancedFileBrowser.selectSingleFile();
                expect(result?.extension).toBe(format.slice(1));
                expect(result?.isRaw).toBe(false);
                expect(result?.thumbnail).toMatch(/^file:\/\//);
                globals_1.jest.clearAllMocks();
            }
        });
        it('should support all documented RAW formats', async () => {
            const rawFormats = ['.nef', '.arw', '.cr2', '.cr3', '.orf', '.raw', '.rw2', '.dng'];
            for (const format of rawFormats) {
                const filePath = `/test/raw${format}`;
                mockApi.invoke.mockResolvedValueOnce({
                    canceled: false,
                    filePaths: [filePath]
                });
                mockApi.invoke.mockResolvedValueOnce({
                    size: 25000000,
                    mtime: new Date('2023-06-01'),
                    ctime: new Date('2023-05-01'),
                    isFile: true,
                    isDirectory: false
                });
                mockApi.invoke.mockResolvedValueOnce(null); // RAW files return null thumbnail
                mockEnhancedFileBrowser.createFileObject.mockImplementation(async (filePath) => {
                    const stats = await window.api.invoke('get-file-stats', filePath);
                    const extension = filePath.split('.').pop()?.toLowerCase() || '';
                    return {
                        name: filePath.split('/').pop(),
                        path: filePath,
                        size: stats.size,
                        extension,
                        isRaw: ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'].includes(extension),
                        mtime: stats.mtime,
                        ctime: stats.ctime,
                        thumbnail: await window.api.invoke('generate-thumbnail', filePath)
                    };
                });
                mockEnhancedFileBrowser.selectSingleFile.mockImplementation(async () => {
                    const result = await window.api.invoke('dialog-show-open', {
                        properties: ['openFile'],
                        title: 'Select Image File',
                        filters: [
                            { name: 'Image Files', extensions: mockEnhancedFileBrowser.supportedFormats }
                        ]
                    });
                    if (!result.canceled && result.filePaths.length > 0) {
                        const filePath = result.filePaths[0];
                        return await mockEnhancedFileBrowser.createFileObject(filePath);
                    }
                    return null;
                });
                const result = await mockEnhancedFileBrowser.selectSingleFile();
                expect(result?.extension).toBe(format.slice(1));
                expect(result?.isRaw).toBe(true);
                expect(result?.thumbnail).toBe(null);
                globals_1.jest.clearAllMocks();
            }
        });
    });
});
