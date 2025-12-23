/**
 * Face Detection Bridge
 *
 * Coordinates face detection between main process and renderer.
 * Face detection runs in renderer (needs Canvas API via face-api.js),
 * while matching runs in main process (FaceRecognitionProcessor).
 */

import { BrowserWindow, ipcMain } from 'electron';
import {
  faceRecognitionProcessor,
  DetectedFace,
  FaceContext,
  FaceRecognitionResult as ProcessorResult,
  PersonMatch,
  DriverMatch
} from './face-recognition-processor';
import * as path from 'path';
import * as fs from 'fs';
import { createComponentLogger } from './utils/logger';

const log = createComponentLogger('FaceDetectionBridge');

// Pending detection requests
interface PendingRequest {
  resolve: (result: FaceDetectionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface FaceDetectionResult {
  success: boolean;
  faces: DetectedFace[];
  inferenceTimeMs: number;
  error?: string;
}

// Individual face match result
export interface FaceMatchResult {
  matched: boolean;
  driverInfo?: {
    driverId: string;
    driverName: string;
    teamName: string;
    raceNumber: string;
  };
  similarity: number;
  faceIndex: number;
}

// Re-export a unified result type for the bridge
export interface FaceRecognitionResult {
  success: boolean;
  matches: FaceMatchResult[];
  detectionTimeMs: number;
  matchingTimeMs: number;
  totalTimeMs: number;
  error?: string;
}

/**
 * Face Detection Bridge - Singleton
 */
class FaceDetectionBridge {
  private static instance: FaceDetectionBridge | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private isInitialized: boolean = false;
  private initPromise: Promise<boolean> | null = null;
  private requestCounter: number = 0;

  // Configuration
  private readonly REQUEST_TIMEOUT_MS = 30000;

  private constructor() {
    this.setupIpcListeners();
  }

  static getInstance(): FaceDetectionBridge {
    if (!FaceDetectionBridge.instance) {
      FaceDetectionBridge.instance = new FaceDetectionBridge();
    }
    return FaceDetectionBridge.instance;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    log.info('Main window set for face detection bridge');
  }

  private setupIpcListeners(): void {
    ipcMain.on('face-detection-response', (event, response: { requestId: string } & FaceDetectionResult) => {
      this.handleDetectionResponse(response);
    });

    ipcMain.on('face-detection-single-response', (event, response: { requestId: string; face?: DetectedFace; success: boolean; error?: string; inferenceTimeMs: number }) => {
      const result: FaceDetectionResult = {
        success: response.success,
        faces: response.face ? [response.face] : [],
        inferenceTimeMs: response.inferenceTimeMs,
        error: response.error
      };
      this.handleDetectionResponse({ requestId: response.requestId, ...result });
    });

    log.info('IPC listeners setup for face detection bridge');
  }

  private handleDetectionResponse(response: { requestId: string } & FaceDetectionResult): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) {
      log.warn(`Received response for unknown request: ${response.requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.requestId);

    pending.resolve({
      success: response.success,
      faces: response.faces || [],
      inferenceTimeMs: response.inferenceTimeMs,
      error: response.error
    });
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<boolean> {
    try {
      await faceRecognitionProcessor.initialize();
      this.isInitialized = true;
      log.info('Face detection bridge initialized');
      return true;
    } catch (error) {
      log.error('Failed to initialize face detection bridge:', error);
      return false;
    }
  }

  /**
   * Load face descriptors from a specific participant preset.
   * This allows each preset to have its own face recognition database,
   * supporting Team Principals, VIPs, and other non-numbered participants.
   */
  async loadDescriptorsForPreset(presetId: string): Promise<number> {
    try {
      const count = await faceRecognitionProcessor.loadFromPreset(presetId);
      log.info(`Loaded ${count} face descriptors for preset: ${presetId}`);
      return count;
    } catch (error) {
      log.error(`Failed to load descriptors for preset ${presetId}:`, error);
      return 0;
    }
  }

  private generateRequestId(): string {
    return `face-req-${Date.now()}-${++this.requestCounter}`;
  }

  async detectFaces(imagePath: string): Promise<FaceDetectionResult> {
    if (!this.mainWindow) {
      return {
        success: false,
        faces: [],
        inferenceTimeMs: 0,
        error: 'Main window not available for face detection'
      };
    }

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        faces: [],
        inferenceTimeMs: 0,
        error: `Image file not found: ${imagePath}`
      };
    }

    const requestId = this.generateRequestId();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({
          success: false,
          faces: [],
          inferenceTimeMs: this.REQUEST_TIMEOUT_MS,
          error: 'Face detection timed out'
        });
      }, this.REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject: () => {}, timeout });

      this.mainWindow!.webContents.send('face-detection-request', {
        requestId,
        imagePath,
        options: {}
      });
    });
  }

  async detectSingleFace(imagePath: string): Promise<FaceDetectionResult> {
    if (!this.mainWindow) {
      return {
        success: false,
        faces: [],
        inferenceTimeMs: 0,
        error: 'Main window not available for face detection'
      };
    }

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        faces: [],
        inferenceTimeMs: 0,
        error: `Image file not found: ${imagePath}`
      };
    }

    const requestId = this.generateRequestId();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({
          success: false,
          faces: [],
          inferenceTimeMs: this.REQUEST_TIMEOUT_MS,
          error: 'Face detection timed out'
        });
      }, this.REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject: () => {}, timeout });

      this.mainWindow!.webContents.send('face-detection-single-request', {
        requestId,
        imagePath,
        options: {}
      });
    });
  }

  async detectAndMatch(imagePath: string, context: FaceContext = 'auto'): Promise<FaceRecognitionResult> {
    const startTime = Date.now();
    let detectionTimeMs = 0;
    let matchingTimeMs = 0;

    try {
      // Step 1: Detect faces in renderer
      const detectionResult = await this.detectFaces(imagePath);
      detectionTimeMs = detectionResult.inferenceTimeMs;

      if (!detectionResult.success || detectionResult.faces.length === 0) {
        return {
          success: true,
          matches: [],
          detectionTimeMs,
          matchingTimeMs: 0,
          totalTimeMs: Date.now() - startTime
        };
      }

      // Step 2: Match detected faces against known drivers
      const matchStartTime = Date.now();
      const processorResult = faceRecognitionProcessor.matchFaces(detectionResult.faces, context);
      matchingTimeMs = Date.now() - matchStartTime;

      // Convert processor result to bridge result format
      // Support both matchedPersons (new) and matchedDrivers (legacy)
      const matchedList = processorResult.matchedPersons || processorResult.matchedDrivers || [];
      const matches: FaceMatchResult[] = matchedList.map((person: PersonMatch): FaceMatchResult => ({
        matched: true,
        driverInfo: {
          driverId: person.personId,
          driverName: person.personName,
          teamName: person.team,
          raceNumber: person.carNumber
        },
        similarity: person.confidence,
        faceIndex: person.faceIndex
      }));

      // Add unmatched faces
      for (let i = 0; i < detectionResult.faces.length; i++) {
        if (!matches.some(m => m.faceIndex === i)) {
          matches.push({
            matched: false,
            similarity: 0,
            faceIndex: i
          });
        }
      }

      log.info(`Face recognition: ${matches.filter(m => m.matched).length}/${detectionResult.faces.length} faces matched in ${Date.now() - startTime}ms`);

      return {
        success: true,
        matches,
        detectionTimeMs,
        matchingTimeMs,
        totalTimeMs: Date.now() - startTime
      };

    } catch (error) {
      log.error('Face detection and matching failed:', error);
      return {
        success: false,
        matches: [],
        detectionTimeMs,
        matchingTimeMs,
        totalTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getStatus(): { bridgeInitialized: boolean; processorStatus: any; pendingRequests: number } {
    return {
      bridgeInitialized: this.isInitialized,
      processorStatus: faceRecognitionProcessor.getStatus(),
      pendingRequests: this.pendingRequests.size
    };
  }

  clearDescriptors(): void {
    faceRecognitionProcessor.clearDescriptors();
    log.info('Face descriptors cleared');
  }

  dispose(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();
    this.mainWindow = null;
    this.isInitialized = false;
    FaceDetectionBridge.instance = null;
    log.info('Face detection bridge disposed');
  }
}

export function getFaceDetectionBridge(): FaceDetectionBridge {
  return FaceDetectionBridge.getInstance();
}

export const faceDetectionBridge = getFaceDetectionBridge();
