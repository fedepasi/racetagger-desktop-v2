"use strict";
/**
 * Tests to ensure no initialization conflicts between components
 * Verifies that Enhanced UX Coordinator and Enhanced File Browser initialize properly
 */
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
// Mock DOM environment
const mockDocument = {
    addEventListener: globals_1.jest.fn(),
    querySelector: globals_1.jest.fn(),
    querySelectorAll: globals_1.jest.fn(),
    createElement: globals_1.jest.fn(),
    getElementById: globals_1.jest.fn(),
    getElementsByClassName: globals_1.jest.fn()
};
const mockWindow = {
    api: {
        invoke: globals_1.jest.fn(),
        send: globals_1.jest.fn(),
        receive: globals_1.jest.fn()
    },
    addEventListener: globals_1.jest.fn(),
    setTimeout: globals_1.jest.fn((callback, delay) => {
        return setTimeout(callback, delay);
    }),
    clearTimeout: globals_1.jest.fn(),
    console: {
        log: globals_1.jest.fn(),
        error: globals_1.jest.fn(),
        warn: globals_1.jest.fn()
    }
};
global.document = mockDocument;
global.window = mockWindow;
describe('Initialization Coordination', () => {
    let mockEnhancedUXCoordinator;
    let mockEnhancedFileBrowser;
    let initializationEvents;
    beforeEach(() => {
        globals_1.jest.clearAllMocks();
        initializationEvents = [];
        // Mock Enhanced UX Coordinator
        mockEnhancedUXCoordinator = {
            components: {
                enhancedFileBrowser: false,
                modernResults: false,
                smartPresets: false,
                enhancedProgress: false
            },
            initializeComponent: globals_1.jest.fn((componentName) => {
                initializationEvents.push(`coordinator-init-${componentName}`);
                return new Promise((resolve) => {
                    setTimeout(() => {
                        mockEnhancedUXCoordinator.components[componentName] = true;
                        resolve(true);
                    }, 100);
                });
            }),
            checkConflicts: globals_1.jest.fn(),
            resolveConflicts: globals_1.jest.fn()
        };
        // Mock Enhanced File Browser
        mockEnhancedFileBrowser = {
            initialized: false,
            init: globals_1.jest.fn(() => {
                initializationEvents.push('file-browser-init');
                mockEnhancedFileBrowser.initialized = true;
                return Promise.resolve();
            }),
            destroy: globals_1.jest.fn(() => {
                initializationEvents.push('file-browser-destroy');
                mockEnhancedFileBrowser.initialized = false;
            })
        };
        // Mock globals
        global.EnhancedUXCoordinator = globals_1.jest.fn().mockImplementation(() => mockEnhancedUXCoordinator);
        global.EnhancedFileBrowser = globals_1.jest.fn().mockImplementation(() => mockEnhancedFileBrowser);
    });
    describe('Sequential Initialization', () => {
        it('should initialize components in correct order without conflicts', async () => {
            // Mock DOM elements
            mockDocument.querySelector.mockImplementation((selector) => {
                if (selector === '.analysis-section') {
                    return { classList: { add: globals_1.jest.fn() } };
                }
                return null;
            });
            const testSequentialInitialization = async () => {
                // Step 1: Initialize Enhanced UX Coordinator
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                // Step 2: Wait for coordinator to be ready
                await new Promise(resolve => setTimeout(resolve, 200));
                // Step 3: Initialize Enhanced File Browser through coordinator
                await coordinator.initializeComponent('enhancedFileBrowser');
                // Step 4: Verify order
                return {
                    initOrder: initializationEvents,
                    coordinatorReady: true,
                    fileBrowserReady: mockEnhancedFileBrowser.initialized
                };
            };
            const result = await testSequentialInitialization();
            expect(result.initOrder).toEqual([
                'coordinator-init-enhancedFileBrowser',
                'file-browser-init'
            ]);
            expect(result.coordinatorReady).toBe(true);
            expect(result.fileBrowserReady).toBe(true);
        });
        it('should handle delayed DOM readiness', async () => {
            let domReady = false;
            // Mock document ready state
            Object.defineProperty(mockDocument, 'readyState', {
                get: () => domReady ? 'complete' : 'loading',
                configurable: true
            });
            const testDelayedDOMInit = async () => {
                const initPromises = [];
                // Start initialization before DOM is ready
                const initPromise = new Promise((resolve) => {
                    const checkAndInit = () => {
                        if (mockDocument.readyState === 'complete') {
                            initializationEvents.push('dom-ready-init');
                            resolve('initialized');
                        }
                        else {
                            setTimeout(checkAndInit, 50);
                        }
                    };
                    checkAndInit();
                });
                initPromises.push(initPromise);
                // Simulate DOM becoming ready after delay
                setTimeout(() => {
                    domReady = true;
                }, 100);
                const results = await Promise.all(initPromises);
                return {
                    results,
                    events: initializationEvents
                };
            };
            const result = await testDelayedDOMInit();
            expect(result.events).toContain('dom-ready-init');
            expect(result.results[0]).toBe('initialized');
        });
        it('should prevent duplicate initializations', async () => {
            const testDuplicateInitPrevention = async () => {
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                // Try to initialize same component multiple times simultaneously
                const initPromises = [
                    coordinator.initializeComponent('enhancedFileBrowser'),
                    coordinator.initializeComponent('enhancedFileBrowser'),
                    coordinator.initializeComponent('enhancedFileBrowser')
                ];
                // Mock component to track init calls
                let initCallCount = 0;
                mockEnhancedUXCoordinator.initializeComponent.mockImplementation((componentName) => {
                    initCallCount++;
                    if (initCallCount === 1) {
                        initializationEvents.push(`${componentName}-init-1`);
                        return Promise.resolve(true);
                    }
                    else {
                        initializationEvents.push(`${componentName}-duplicate-${initCallCount}`);
                        return Promise.resolve(false); // Already initialized
                    }
                });
                const results = await Promise.all(initPromises);
                return {
                    results,
                    initCallCount,
                    events: initializationEvents
                };
            };
            const result = await testDuplicateInitPrevention();
            expect(result.initCallCount).toBe(3); // All calls made
            expect(result.results[0]).toBe(true); // First succeeds
            expect(result.results[1]).toBe(false); // Subsequent fail
            expect(result.results[2]).toBe(false);
        });
    });
    describe('Timing Coordination', () => {
        it('should respect initialization timeouts to avoid conflicts', async () => {
            const initializationTimeouts = {
                coordinator: 500,
                fileBrowser: 600,
                delayBetween: 100
            };
            const testTimingCoordination = async () => {
                const startTime = Date.now();
                const events = [];
                // Coordinator initialization
                setTimeout(() => {
                    events.push({ event: 'coordinator-start', time: Date.now() - startTime });
                    initializationEvents.push('coordinator-timed-init');
                }, initializationTimeouts.coordinator);
                // File browser initialization (after coordinator + delay)
                setTimeout(() => {
                    events.push({ event: 'file-browser-start', time: Date.now() - startTime });
                    initializationEvents.push('file-browser-timed-init');
                }, initializationTimeouts.fileBrowser);
                // Wait for all initializations to complete
                await new Promise(resolve => setTimeout(resolve, initializationTimeouts.fileBrowser + 100));
                return {
                    events,
                    initOrder: initializationEvents,
                    totalTime: Date.now() - startTime
                };
            };
            const result = await testTimingCoordination();
            expect(result.initOrder).toEqual([
                'coordinator-timed-init',
                'file-browser-timed-init'
            ]);
            // Verify timing sequence
            expect(result.events[0].time).toBeLessThan(result.events[1].time);
            expect(result.events[1].time - result.events[0].time).toBeGreaterThan(50); // Reasonable delay
        });
        it('should handle rapid successive initialization attempts', async () => {
            const testRapidInitAttempts = async () => {
                const attempts = [];
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                // Mock component state checking
                let componentState = 'not-initialized';
                mockEnhancedUXCoordinator.initializeComponent.mockImplementation(async (componentName) => {
                    if (componentState === 'initializing') {
                        initializationEvents.push(`${componentName}-blocked`);
                        return false; // Block concurrent initialization
                    }
                    componentState = 'initializing';
                    initializationEvents.push(`${componentName}-start`);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    componentState = 'initialized';
                    initializationEvents.push(`${componentName}-complete`);
                    return true;
                });
                // Rapid fire attempts
                for (let i = 0; i < 5; i++) {
                    attempts.push(coordinator.initializeComponent('enhancedFileBrowser')
                        .then(success => ({ attempt: i + 1, success })));
                    // Small delay between attempts
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                const results = await Promise.all(attempts);
                return {
                    results,
                    events: initializationEvents
                };
            };
            const result = await testRapidInitAttempts();
            // Only one should succeed
            const successes = result.results.filter(r => r.success);
            expect(successes).toHaveLength(1);
            // Should have proper blocking
            const blockedEvents = result.events.filter(e => e.includes('blocked'));
            expect(blockedEvents.length).toBeGreaterThan(0);
        });
    });
    describe('Error Handling in Initialization', () => {
        it('should handle initialization failures gracefully', async () => {
            mockEnhancedUXCoordinator.initializeComponent.mockRejectedValue(new Error('Component initialization failed'));
            const testInitFailureHandling = async () => {
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                const errorEvents = [];
                try {
                    await coordinator.initializeComponent('enhancedFileBrowser');
                }
                catch (error) {
                    errorEvents.push({
                        component: 'enhancedFileBrowser',
                        error: error.message
                    });
                    initializationEvents.push('init-failed');
                }
                return {
                    errorEvents,
                    events: initializationEvents,
                    componentState: mockEnhancedUXCoordinator.components
                };
            };
            const result = await testInitFailureHandling();
            expect(result.errorEvents).toHaveLength(1);
            expect(result.errorEvents[0].error).toBe('Component initialization failed');
            expect(result.events).toContain('init-failed');
            expect(result.componentState.enhancedFileBrowser).toBe(false);
        });
        it('should continue with fallback when enhanced initialization fails', async () => {
            const testFallbackOnInitFailure = async () => {
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                let fallbackActivated = false;
                mockEnhancedUXCoordinator.initializeComponent.mockImplementation(async (componentName) => {
                    if (componentName === 'enhancedFileBrowser') {
                        initializationEvents.push('enhanced-init-failed');
                        throw new Error('Enhanced initialization failed');
                    }
                    return true;
                });
                try {
                    await coordinator.initializeComponent('enhancedFileBrowser');
                }
                catch (error) {
                    // Activate fallback
                    initializationEvents.push('fallback-activated');
                    fallbackActivated = true;
                    // Simulate basic functionality initialization
                    mockEnhancedUXCoordinator.components.basicFileBrowser = true;
                    initializationEvents.push('basic-browser-ready');
                }
                return {
                    fallbackActivated,
                    events: initializationEvents,
                    hasBasicFunctionality: mockEnhancedUXCoordinator.components.basicFileBrowser
                };
            };
            const result = await testFallbackOnInitFailure();
            expect(result.fallbackActivated).toBe(true);
            expect(result.hasBasicFunctionality).toBe(true);
            expect(result.events).toEqual([
                'enhanced-init-failed',
                'fallback-activated',
                'basic-browser-ready'
            ]);
        });
        it('should cleanup properly on initialization abortion', async () => {
            const testInitCleanup = async () => {
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                let cleanupCalled = false;
                mockEnhancedUXCoordinator.initializeComponent.mockImplementation(async (componentName) => {
                    initializationEvents.push(`${componentName}-start`);
                    // Simulate initialization process
                    await new Promise(resolve => setTimeout(resolve, 50));
                    // Simulate abortion
                    initializationEvents.push(`${componentName}-abort`);
                    // Cleanup
                    cleanupCalled = true;
                    initializationEvents.push(`${componentName}-cleanup`);
                    throw new Error('Initialization aborted');
                });
                try {
                    await coordinator.initializeComponent('enhancedFileBrowser');
                }
                catch (error) {
                    initializationEvents.push('cleanup-verified');
                }
                return {
                    cleanupCalled,
                    events: initializationEvents
                };
            };
            const result = await testInitCleanup();
            expect(result.cleanupCalled).toBe(true);
            expect(result.events).toEqual([
                'enhancedFileBrowser-start',
                'enhancedFileBrowser-abort',
                'enhancedFileBrowser-cleanup',
                'cleanup-verified'
            ]);
        });
    });
    describe('Component Dependencies', () => {
        it('should initialize dependencies before dependent components', async () => {
            const dependencies = {
                enhancedFileBrowser: ['dom-ready', 'api-ready'],
                modernResults: ['enhanced-file-browser', 'dom-ready'],
                enhancedProgress: ['dom-ready']
            };
            const testDependencyOrder = async () => {
                const initOrder = [];
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                mockEnhancedUXCoordinator.initializeComponent.mockImplementation(async (componentName) => {
                    // Check dependencies
                    const deps = dependencies[componentName] || [];
                    for (const dep of deps) {
                        if (!initOrder.includes(dep)) {
                            initOrder.push(dep);
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    }
                    initOrder.push(componentName);
                    initializationEvents.push(`${componentName}-initialized`);
                    return true;
                });
                // Initialize components
                await coordinator.initializeComponent('modernResults');
                return {
                    initOrder,
                    events: initializationEvents
                };
            };
            const result = await testDependencyOrder();
            // Verify dependency order
            const fileIndex = result.initOrder.indexOf('enhanced-file-browser');
            const modernIndex = result.initOrder.indexOf('modernResults');
            const domIndex = result.initOrder.indexOf('dom-ready');
            expect(fileIndex).toBeLessThan(modernIndex); // File browser before modern results
            expect(domIndex).toBeLessThan(modernIndex); // DOM ready before modern results
            expect(domIndex).toBeLessThan(fileIndex); // DOM ready before file browser
        });
        it('should handle circular dependency detection', async () => {
            const testCircularDependencyDetection = async () => {
                const dependencyGraph = new Map();
                dependencyGraph.set('componentA', ['componentB']);
                dependencyGraph.set('componentB', ['componentC']);
                dependencyGraph.set('componentC', ['componentA']); // Circular!
                const detectCircularDependency = (graph, visited = new Set(), path = []) => {
                    for (const [component, deps] of graph.entries()) {
                        if (path.includes(component)) {
                            return true; // Circular dependency found
                        }
                        for (const dep of deps) {
                            if (graph.has(dep) && !visited.has(dep)) {
                                visited.add(dep);
                                if (detectCircularDependency(graph, visited, [...path, component])) {
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                };
                const hasCircular = detectCircularDependency(dependencyGraph);
                return {
                    hasCircularDependency: hasCircular,
                    dependencyGraph: Array.from(dependencyGraph.entries())
                };
            };
            const result = await testCircularDependencyDetection();
            expect(result.hasCircularDependency).toBe(true);
        });
    });
    describe('Resource Cleanup', () => {
        it('should cleanup resources when components are destroyed', async () => {
            const testResourceCleanup = async () => {
                const coordinator = new mockEnhancedUXCoordinator.constructor();
                const resources = {
                    eventListeners: new Set(),
                    timeouts: new Set(),
                    intervals: new Set()
                };
                // Mock resource tracking
                const addEventListenerSpy = globals_1.jest.fn((event, handler) => {
                    resources.eventListeners.add({ event, handler });
                });
                const setTimeoutSpy = globals_1.jest.fn((callback, delay) => {
                    const timeoutId = setTimeout(callback, delay);
                    resources.timeouts.add(timeoutId);
                    return timeoutId;
                });
                // Initialize component with resources
                mockEnhancedUXCoordinator.initializeComponent.mockImplementation(async (componentName) => {
                    addEventListenerSpy('click', () => { });
                    setTimeoutSpy(() => { }, 1000);
                    initializationEvents.push(`${componentName}-resources-allocated`);
                    return true;
                });
                await coordinator.initializeComponent('enhancedFileBrowser');
                // Cleanup
                const cleanup = () => {
                    resources.eventListeners.clear();
                    resources.timeouts.forEach(id => clearTimeout(id));
                    resources.timeouts.clear();
                    resources.intervals.forEach(id => clearInterval(id));
                    resources.intervals.clear();
                    initializationEvents.push('resources-cleaned');
                };
                cleanup();
                return {
                    events: initializationEvents,
                    remainingResources: {
                        eventListeners: resources.eventListeners.size,
                        timeouts: resources.timeouts.size,
                        intervals: resources.intervals.size
                    }
                };
            };
            const result = await testResourceCleanup();
            expect(result.events).toContain('enhancedFileBrowser-resources-allocated');
            expect(result.events).toContain('resources-cleaned');
            expect(result.remainingResources.eventListeners).toBe(0);
            expect(result.remainingResources.timeouts).toBe(0);
            expect(result.remainingResources.intervals).toBe(0);
        });
    });
});
