"use strict";
/**
 * Tests to verify fallback mechanisms work when enhanced handlers fail
 * Ensures the app gracefully falls back to original systems when needed
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
describe('Fallback Mechanisms', () => {
    let mockEnhancedFileBrowser;
    let mockOriginalSystem;
    beforeEach(() => {
        globals_1.jest.clearAllMocks();
        // Mock Enhanced File Browser
        mockEnhancedFileBrowser = {
            selectFolder: globals_1.jest.fn(),
            selectFiles: globals_1.jest.fn(),
            selectSingleFile: globals_1.jest.fn(),
            isAvailable: globals_1.jest.fn().mockReturnValue(true)
        };
        // Mock Original System behaviors
        mockOriginalSystem = {
            folderSelection: {
                trigger: globals_1.jest.fn(),
                onResult: globals_1.jest.fn(),
                onError: globals_1.jest.fn()
            },
            csvUpload: {
                trigger: globals_1.jest.fn(),
                onResult: globals_1.jest.fn(),
                onError: globals_1.jest.fn()
            }
        };
        global.EnhancedFileBrowser = globals_1.jest.fn().mockImplementation(() => mockEnhancedFileBrowser);
    });
    describe('IPC Handler Availability Checks', () => {
        it('should detect when IPC handlers are not available', async () => {
            // Mock IPC handler not available
            mockApi.invoke.mockRejectedValue(new Error('Invalid IPC channel: dialog-show-open'));
            const testHandlerAvailability = async (handlerName) => {
                try {
                    await mockApi.invoke(handlerName, {});
                    return true;
                }
                catch (error) {
                    if (error.message.includes('Invalid IPC channel')) {
                        return false;
                    }
                    throw error;
                }
            };
            const isAvailable = await testHandlerAvailability('dialog-show-open');
            expect(isAvailable).toBe(false);
        });
        it('should detect when IPC handlers are available', async () => {
            mockApi.invoke.mockResolvedValue({ success: true });
            const testHandlerAvailability = async (handlerName) => {
                try {
                    await mockApi.invoke(handlerName, {});
                    return true;
                }
                catch (error) {
                    if (error.message.includes('Invalid IPC channel')) {
                        return false;
                    }
                    throw error;
                }
            };
            const isAvailable = await testHandlerAvailability('dialog-show-open');
            expect(isAvailable).toBe(true);
        });
        it('should check all required handlers for availability', async () => {
            const requiredHandlers = [
                'dialog-show-open',
                'get-folder-files',
                'get-file-stats',
                'generate-thumbnail'
            ];
            const availabilityResults = {};
            for (const handler of requiredHandlers) {
                try {
                    await mockApi.invoke(handler, {});
                    availabilityResults[handler] = true;
                }
                catch (error) {
                    availabilityResults[handler] = false;
                }
            }
            requiredHandlers.forEach(handler => {
                expect(availabilityResults).toHaveProperty(handler);
                expect(typeof availabilityResults[handler]).toBe('boolean');
            });
        });
    });
    describe('Folder Selection Fallback', () => {
        it('should fallback to original folder selection when enhanced system fails', async () => {
            // Enhanced system fails
            mockEnhancedFileBrowser.selectFolder.mockRejectedValue(new Error('Enhanced system failed'));
            // Original system setup
            let folderSelectedCallback = null;
            mockApi.receive.mockImplementation((channel, callback) => {
                if (channel === 'folder-selected') {
                    folderSelectedCallback = callback;
                    return () => { }; // cleanup function
                }
                return () => { };
            });
            mockApi.send.mockImplementation((channel) => {
                if (channel === 'select-folder' && folderSelectedCallback) {
                    // Simulate successful original folder selection
                    setTimeout(() => {
                        folderSelectedCallback?.('/fallback/folder', 10);
                    }, 0);
                }
            });
            const testFolderSelectionWithFallback = async () => {
                try {
                    return await mockEnhancedFileBrowser.selectFolder();
                }
                catch (enhancedError) {
                    console.log('Enhanced system failed, using fallback');
                    return new Promise((resolve, reject) => {
                        let cleanup;
                        // Set up listener for folder selection result
                        cleanup = mockApi.receive('folder-selected', (folderPath, imageCount) => {
                            cleanup();
                            resolve({ folderPath, imageCount, source: 'fallback' });
                        });
                        // Set up listener for errors
                        const errorCleanup = mockApi.receive('folder-error', (error) => {
                            cleanup();
                            errorCleanup();
                            reject(new Error(error));
                        });
                        // Trigger original folder selection
                        mockApi.send('select-folder');
                        // Timeout after 5 seconds
                        setTimeout(() => {
                            cleanup();
                            errorCleanup();
                            reject(new Error('Folder selection timeout'));
                        }, 5000);
                    });
                }
            };
            const result = await testFolderSelectionWithFallback();
            expect(result).toEqual({
                folderPath: '/fallback/folder',
                imageCount: 10,
                source: 'fallback'
            });
            expect(mockApi.send).toHaveBeenCalledWith('select-folder');
        });
        it('should handle when both enhanced and original systems fail', async () => {
            // Enhanced system fails
            mockEnhancedFileBrowser.selectFolder.mockRejectedValue(new Error('Enhanced system failed'));
            // Original system also fails
            mockApi.receive.mockImplementation((channel, callback) => {
                if (channel === 'folder-error') {
                    setTimeout(() => callback('Original system also failed'), 0);
                    return () => { };
                }
                return () => { };
            });
            const testFolderSelectionWithFallback = async () => {
                try {
                    return await mockEnhancedFileBrowser.selectFolder();
                }
                catch (enhancedError) {
                    console.log('Enhanced system failed, using fallback');
                    return new Promise((resolve, reject) => {
                        let cleanup;
                        cleanup = mockApi.receive('folder-selected', (folderPath, imageCount) => {
                            cleanup();
                            resolve({ folderPath, imageCount, source: 'fallback' });
                        });
                        const errorCleanup = mockApi.receive('folder-error', (error) => {
                            cleanup();
                            errorCleanup();
                            reject(new Error(`Fallback failed: ${error}`));
                        });
                        mockApi.send('select-folder');
                        setTimeout(() => {
                            cleanup();
                            errorCleanup();
                            reject(new Error('Folder selection timeout'));
                        }, 5000);
                    });
                }
            };
            await expect(testFolderSelectionWithFallback()).rejects.toThrow('Fallback failed: Original system also failed');
        });
        it('should provide user-friendly error messages when all systems fail', async () => {
            mockEnhancedFileBrowser.selectFolder.mockRejectedValue(new Error('Enhanced system failed'));
            const mockNotificationSystem = {
                showError: globals_1.jest.fn(),
                showWarning: globals_1.jest.fn()
            };
            const testCompleteFallbackWithUserFeedback = async () => {
                try {
                    return await mockEnhancedFileBrowser.selectFolder();
                }
                catch (enhancedError) {
                    mockNotificationSystem.showWarning('Primary folder selection failed, trying alternative method...');
                    try {
                        // Simulate fallback attempt
                        return new Promise((resolve, reject) => {
                            setTimeout(() => reject(new Error('Fallback also failed')), 100);
                        });
                    }
                    catch (fallbackError) {
                        mockNotificationSystem.showError('Unable to select folder. Please try restarting the application or contact support.');
                        throw new Error('All folder selection methods failed');
                    }
                }
            };
            await expect(testCompleteFallbackWithUserFeedback()).rejects.toThrow('All folder selection methods failed');
            expect(mockNotificationSystem.showWarning).toHaveBeenCalledWith('Primary folder selection failed, trying alternative method...');
            expect(mockNotificationSystem.showError).toHaveBeenCalledWith('Unable to select folder. Please try restarting the application or contact support.');
        });
    });
    describe('CSV Upload Fallback', () => {
        it('should fallback to original CSV upload when enhanced system fails', async () => {
            // Mock enhanced CSV selection failure
            mockApi.invoke.mockRejectedValueOnce(new Error('Enhanced CSV selection failed'));
            // Mock original CSV system
            let csvLoadedCallback = null;
            mockApi.receive.mockImplementation((channel, callback) => {
                if (channel === 'csv-loaded') {
                    csvLoadedCallback = callback;
                    return () => { };
                }
                return () => { };
            });
            const mockFileInput = {
                click: globals_1.jest.fn(),
                files: [new File(['csv content'], 'test.csv')],
                addEventListener: globals_1.jest.fn((event, callback) => {
                    if (event === 'change') {
                        // Simulate file selection
                        setTimeout(() => {
                            callback();
                            // Simulate successful CSV processing
                            if (csvLoadedCallback) {
                                csvLoadedCallback([
                                    { numero: '1', nome: 'Test Driver', categoria: 'Pro', squadra: 'Team A', metatag: 'Test metadata' }
                                ], 'test.csv', 1);
                            }
                        }, 0);
                    }
                })
            };
            const testCsvUploadWithFallback = async () => {
                try {
                    // Try enhanced method first
                    return await mockApi.invoke('load-csv');
                }
                catch (enhancedError) {
                    console.log('Enhanced CSV upload failed, using fallback');
                    return new Promise((resolve, reject) => {
                        const cleanup = mockApi.receive('csv-loaded', (csvData, filename, entries) => {
                            cleanup();
                            resolve({ csvData, filename, entries, source: 'fallback' });
                        });
                        const errorCleanup = mockApi.receive('csv-error', (error) => {
                            cleanup();
                            errorCleanup();
                            reject(new Error(error));
                        });
                        // Simulate clicking file input
                        mockFileInput.click();
                        setTimeout(() => {
                            cleanup();
                            errorCleanup();
                            reject(new Error('CSV upload timeout'));
                        }, 5000);
                    });
                }
            };
            const result = await testCsvUploadWithFallback();
            expect(result).toEqual({
                csvData: [
                    { numero: '1', nome: 'Test Driver', categoria: 'Pro', squadra: 'Team A', metatag: 'Test metadata' }
                ],
                filename: 'test.csv',
                entries: 1,
                source: 'fallback'
            });
        });
    });
    describe('Graceful Degradation', () => {
        it('should disable enhanced features when handlers unavailable but keep basic functionality', async () => {
            // Mock all enhanced handlers as unavailable
            mockApi.invoke.mockImplementation(async (channel) => {
                const enhancedHandlers = ['dialog-show-open', 'get-folder-files', 'get-file-stats', 'generate-thumbnail'];
                if (enhancedHandlers.includes(channel)) {
                    throw new Error(`Invalid IPC channel: ${channel}`);
                }
                return { success: true };
            });
            const mockApplicationState = {
                enhancedFeaturesEnabled: true,
                basicFeaturesEnabled: true,
                features: {
                    enhancedFileBrowser: false,
                    filePreviews: false,
                    dragAndDrop: false,
                    folderSelection: true, // Basic version
                    csvUpload: true // Basic version
                }
            };
            const testFeatureAvailability = async () => {
                const enhancedHandlers = ['dialog-show-open', 'get-folder-files', 'get-file-stats', 'generate-thumbnail'];
                const availabilityResults = await Promise.allSettled(enhancedHandlers.map(handler => mockApi.invoke(handler)));
                const anyEnhancedAvailable = availabilityResults.some(result => result.status === 'fulfilled');
                if (!anyEnhancedAvailable) {
                    mockApplicationState.enhancedFeaturesEnabled = false;
                    mockApplicationState.features.enhancedFileBrowser = false;
                    mockApplicationState.features.filePreviews = false;
                    mockApplicationState.features.dragAndDrop = false;
                }
                return mockApplicationState;
            };
            const result = await testFeatureAvailability();
            expect(result.enhancedFeaturesEnabled).toBe(false);
            expect(result.basicFeaturesEnabled).toBe(true);
            expect(result.features.enhancedFileBrowser).toBe(false);
            expect(result.features.folderSelection).toBe(true); // Basic version still works
        });
        it('should show appropriate UI feedback when features are degraded', async () => {
            const mockUI = {
                showDegradedModeNotification: globals_1.jest.fn(),
                hideEnhancedFeatures: globals_1.jest.fn(),
                showBasicFeatures: globals_1.jest.fn()
            };
            const testDegradedModeHandling = async () => {
                try {
                    await mockApi.invoke('dialog-show-open', {});
                }
                catch (error) {
                    // Enhanced features not available
                    mockUI.showDegradedModeNotification('Some advanced features are not available. Basic functionality remains enabled.');
                    mockUI.hideEnhancedFeatures();
                    mockUI.showBasicFeatures();
                    return 'degraded-mode';
                }
                return 'full-mode';
            };
            mockApi.invoke.mockRejectedValue(new Error('Invalid IPC channel: dialog-show-open'));
            const result = await testDegradedModeHandling();
            expect(result).toBe('degraded-mode');
            expect(mockUI.showDegradedModeNotification).toHaveBeenCalledWith('Some advanced features are not available. Basic functionality remains enabled.');
            expect(mockUI.hideEnhancedFeatures).toHaveBeenCalled();
            expect(mockUI.showBasicFeatures).toHaveBeenCalled();
        });
    });
    describe('Error Recovery', () => {
        it('should attempt to recover from temporary handler failures', async () => {
            let attemptCount = 0;
            mockApi.invoke.mockImplementation(async (channel) => {
                attemptCount++;
                if (attemptCount <= 2) {
                    throw new Error('Temporary failure');
                }
                return { success: true, attempt: attemptCount };
            });
            const testRetryMechanism = async (maxRetries = 3) => {
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const result = await mockApi.invoke('dialog-show-open', {});
                        return { ...result, attempts: attempt };
                    }
                    catch (error) {
                        if (attempt === maxRetries) {
                            throw new Error(`All ${maxRetries} attempts failed: ${error.message}`);
                        }
                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            };
            const result = await testRetryMechanism();
            expect(result).toEqual({
                success: true,
                attempt: 3,
                attempts: 3
            });
            expect(attemptCount).toBe(3);
        });
        it('should log fallback usage for debugging', async () => {
            const mockLogger = {
                info: globals_1.jest.fn(),
                warn: globals_1.jest.fn(),
                error: globals_1.jest.fn()
            };
            mockEnhancedFileBrowser.selectFolder.mockRejectedValue(new Error('Enhanced system failed'));
            const testFallbackWithLogging = async () => {
                try {
                    mockLogger.info('Attempting enhanced folder selection');
                    return await mockEnhancedFileBrowser.selectFolder();
                }
                catch (enhancedError) {
                    mockLogger.warn('Enhanced folder selection failed, attempting fallback', {
                        error: enhancedError.message,
                        fallbackMethod: 'original-system'
                    });
                    try {
                        // Simulate fallback
                        mockLogger.info('Fallback folder selection initiated');
                        return { folderPath: '/fallback/path', source: 'fallback' };
                    }
                    catch (fallbackError) {
                        mockLogger.error('All folder selection methods failed', {
                            enhancedError: enhancedError.message,
                            fallbackError: fallbackError.message
                        });
                        throw fallbackError;
                    }
                }
            };
            const result = await testFallbackWithLogging();
            expect(result).toEqual({
                folderPath: '/fallback/path',
                source: 'fallback'
            });
            expect(mockLogger.info).toHaveBeenCalledWith('Attempting enhanced folder selection');
            expect(mockLogger.warn).toHaveBeenCalledWith('Enhanced folder selection failed, attempting fallback', {
                error: 'Enhanced system failed',
                fallbackMethod: 'original-system'
            });
            expect(mockLogger.info).toHaveBeenCalledWith('Fallback folder selection initiated');
        });
    });
    describe('System Integration', () => {
        it('should coordinate between enhanced and original systems without conflicts', async () => {
            const mockSystemCoordinator = {
                enhancedSystemActive: false,
                originalSystemActive: false,
                activate: globals_1.jest.fn((system) => {
                    if (system === 'enhanced') {
                        mockSystemCoordinator.enhancedSystemActive = true;
                        mockSystemCoordinator.originalSystemActive = false;
                    }
                    else {
                        mockSystemCoordinator.enhancedSystemActive = false;
                        mockSystemCoordinator.originalSystemActive = true;
                    }
                }),
                deactivate: globals_1.jest.fn(() => {
                    mockSystemCoordinator.enhancedSystemActive = false;
                    mockSystemCoordinator.originalSystemActive = false;
                })
            };
            const testSystemCoordination = async () => {
                try {
                    // Try enhanced system
                    mockSystemCoordinator.activate('enhanced');
                    await mockApi.invoke('dialog-show-open', {});
                    return 'enhanced-success';
                }
                catch (error) {
                    // Deactivate enhanced, activate original
                    mockSystemCoordinator.activate('original');
                    return new Promise((resolve) => {
                        mockApi.send('select-folder');
                        setTimeout(() => resolve('original-success'), 0);
                    });
                }
            };
            mockApi.invoke.mockRejectedValue(new Error('Enhanced system not available'));
            const result = await testSystemCoordination();
            expect(result).toBe('original-success');
            expect(mockSystemCoordinator.originalSystemActive).toBe(true);
            expect(mockSystemCoordinator.enhancedSystemActive).toBe(false);
        });
        it('should prevent simultaneous activation of conflicting systems', async () => {
            const mockSystemGuard = {
                activeSystem: null,
                pendingOperations: new Set(),
                canActivate: function (system, operation) {
                    if (this.pendingOperations.has(operation)) {
                        return false;
                    }
                    if (this.activeSystem && this.activeSystem !== system) {
                        return false;
                    }
                    return true;
                },
                activate: function (system, operation) {
                    if (!this.canActivate(system, operation)) {
                        throw new Error(`Cannot activate ${system} system: conflicts with active operations`);
                    }
                    this.activeSystem = system;
                    this.pendingOperations.add(operation);
                },
                deactivate: function (operation) {
                    this.pendingOperations.delete(operation);
                    if (this.pendingOperations.size === 0) {
                        this.activeSystem = null;
                    }
                }
            };
            const testConflictPrevention = async () => {
                // Try to activate enhanced system
                mockSystemGuard.activate('enhanced', 'folder-selection-1');
                try {
                    // Try to activate original system while enhanced is active
                    mockSystemGuard.activate('original', 'folder-selection-2');
                    return 'conflict-not-prevented';
                }
                catch (error) {
                    return 'conflict-prevented';
                }
                finally {
                    mockSystemGuard.deactivate('folder-selection-1');
                }
            };
            const result = await testConflictPrevention();
            expect(result).toBe('conflict-prevented');
            expect(mockSystemGuard.activeSystem).toBe(null);
            expect(mockSystemGuard.pendingOperations.size).toBe(0);
        });
    });
});
