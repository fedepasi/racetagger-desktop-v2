/**
 * Session Manager for Racetagger Desktop
 * Handles state persistence and session resume after interruptions
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { PERFORMANCE_CONFIG } from '../config';

export interface SessionState {
  sessionId: string;
  startTime: number;
  lastCheckpoint: number;
  currentPhase: string;
  completedTasks: string[];
  currentTask?: string;
  batchInfo?: {
    totalImages: number;
    processedImages: number;
    failedImages: number;
    currentImageIndex: number;
    folderPath: string;
    executionId?: string;
  };
  performanceBaseline?: {
    averageProcessingTime: number;
    timestamp: number;
  };
  optimizationProgress: {
    enabledOptimizations: string[];
    currentOptimizationLevel: string;
    rollbackPoints: RollbackPoint[];
  };
  resumeData: any;
  errors: SessionError[];
}

export interface RollbackPoint {
  id: string;
  timestamp: number;
  phase: string;
  task: string;
  filesModified: string[];
  configSnapshot: any;
  performanceSnapshot: any;
  description: string;
}

export interface SessionError {
  timestamp: number;
  phase: string;
  task?: string;
  error: string;
  stack?: string;
  resolved: boolean;
}

/**
 * Session Manager class for handling state persistence and recovery
 */
export class SessionManager extends EventEmitter {
  private sessionState: SessionState | null = null;
  private stateFilePath: string;
  private backupFilePath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private rollbackPoints: RollbackPoint[] = [];

  private isEnabled: boolean = false;

  constructor() {
    super();

    // Initialize file paths
    const userDataPath = app?.getPath('userData') || './';
    this.stateFilePath = path.join(userDataPath, '.optimization-progress.json');
    this.backupFilePath = path.join(userDataPath, '.optimization-progress.backup.json');

    // Enable session management if configured
    this.isEnabled = PERFORMANCE_CONFIG.enableSessionResume || false;

    if (this.isEnabled) {
      this.loadSessionState();
      this.startAutoSave();
    }
  }

  /**
   * Initialize a new optimization session
   */
  initializeSession(sessionId: string, totalImages: number, folderPath: string): void {
    if (!this.isEnabled) return;

    this.sessionState = {
      sessionId,
      startTime: Date.now(),
      lastCheckpoint: Date.now(),
      currentPhase: 'PHASE_1_FOUNDATION',
      completedTasks: [],
      batchInfo: {
        totalImages,
        processedImages: 0,
        failedImages: 0,
        currentImageIndex: 0,
        folderPath
      },
      optimizationProgress: {
        enabledOptimizations: [],
        currentOptimizationLevel: PERFORMANCE_CONFIG.level,
        rollbackPoints: []
      },
      resumeData: {},
      errors: []
    };

    this.saveSessionState();
    this.emit('sessionInitialized', this.sessionState);
  }

  /**
   * Check if there's a resumable session
   */
  hasResumableSession(): boolean {
    if (!this.isEnabled) return false;

    return this.sessionState !== null && !!this.sessionState.batchInfo &&
           this.sessionState.batchInfo.processedImages < this.sessionState.batchInfo.totalImages;
  }

  /**
   * Get resumable session information
   */
  getResumableSession(): SessionState | null {
    if (!this.hasResumableSession()) return null;
    return { ...this.sessionState! };
  }

  /**
   * Resume session from saved state
   */
  resumeSession(): SessionState | null {
    if (!this.hasResumableSession()) return null;

    const session = this.sessionState!;
    session.lastCheckpoint = Date.now();

    this.saveSessionState();
    this.emit('sessionResumed', session);

    return session;
  }

  /**
   * Update current phase
   */
  updatePhase(phase: string): void {
    if (!this.isEnabled || !this.sessionState) return;

    this.sessionState.currentPhase = phase;
    this.sessionState.lastCheckpoint = Date.now();
    this.saveSessionState();

    this.emit('phaseUpdated', { phase, sessionId: this.sessionState.sessionId });
  }

  /**
   * Mark task as completed
   */
  completeTask(taskId: string): void {
    if (!this.isEnabled || !this.sessionState) return;

    if (!this.sessionState.completedTasks.includes(taskId)) {
      this.sessionState.completedTasks.push(taskId);
      this.sessionState.lastCheckpoint = Date.now();
      this.saveSessionState();

      this.emit('taskCompleted', { taskId, sessionId: this.sessionState.sessionId });
    }
  }

  /**
   * Update current task
   */
  updateCurrentTask(taskId: string): void {
    if (!this.isEnabled || !this.sessionState) return;

    this.sessionState.currentTask = taskId;
    this.sessionState.lastCheckpoint = Date.now();
    this.saveSessionState();

    this.emit('taskStarted', { taskId, sessionId: this.sessionState.sessionId });
  }

  /**
   * Update batch progress
   */
  updateBatchProgress(processedImages: number, failedImages: number = 0): void {
    if (!this.isEnabled || !this.sessionState || !this.sessionState.batchInfo) return;

    this.sessionState.batchInfo.processedImages = processedImages;
    this.sessionState.batchInfo.failedImages = failedImages;
    this.sessionState.batchInfo.currentImageIndex = processedImages + failedImages;
    this.sessionState.lastCheckpoint = Date.now();

    // Auto-save every 10 images processed
    if (processedImages % 10 === 0) {
      this.saveSessionState();
    }

    this.emit('batchProgressUpdated', {
      processed: processedImages,
      failed: failedImages,
      total: this.sessionState.batchInfo.totalImages,
      sessionId: this.sessionState.sessionId
    });
  }

  /**
   * Create a rollback point
   */
  createRollbackPoint(
    id: string,
    phase: string,
    task: string,
    filesModified: string[],
    description: string
  ): void {
    if (!this.isEnabled || !this.sessionState) return;

    const rollbackPoint: RollbackPoint = {
      id,
      timestamp: Date.now(),
      phase,
      task,
      filesModified: [...filesModified],
      configSnapshot: { ...PERFORMANCE_CONFIG },
      performanceSnapshot: this.capturePerformanceSnapshot(),
      description
    };

    this.rollbackPoints.push(rollbackPoint);
    this.sessionState.optimizationProgress.rollbackPoints.push(rollbackPoint);

    // Keep only last 10 rollback points
    if (this.rollbackPoints.length > 10) {
      this.rollbackPoints = this.rollbackPoints.slice(-10);
      this.sessionState.optimizationProgress.rollbackPoints = this.rollbackPoints;
    }

    this.saveSessionState();
    this.emit('rollbackPointCreated', rollbackPoint);
  }

  /**
   * Get available rollback points
   */
  getRollbackPoints(): RollbackPoint[] {
    return [...this.rollbackPoints];
  }

  /**
   * Execute rollback to specific point
   */
  rollbackToPoint(rollbackId: string): boolean {
    const rollbackPoint = this.rollbackPoints.find(rp => rp.id === rollbackId);

    if (!rollbackPoint) {
      console.error(`[SessionManager] Rollback point not found: ${rollbackId}`);
      return false;
    }

    try {
      // This would typically involve:
      // 1. Restoring configuration state
      // 2. Reverting file changes (if tracked via git)
      // 3. Updating current session state

      if (this.sessionState) {
        this.sessionState.currentPhase = rollbackPoint.phase;
        this.sessionState.currentTask = rollbackPoint.task;
        this.sessionState.lastCheckpoint = Date.now();

        // Remove completed tasks after rollback point
        // This would require more sophisticated task timestamp tracking

        this.saveSessionState();
      }

      this.emit('rollbackExecuted', rollbackPoint);
      return true;

    } catch (error) {
      console.error('[SessionManager] Rollback failed:', error);
      this.recordError('ROLLBACK', undefined, `Rollback to ${rollbackId} failed: ${error}`);
      return false;
    }
  }

  /**
   * Record an error in the session
   */
  recordError(phase: string, task: string | undefined, error: string, stack?: string): void {
    if (!this.isEnabled || !this.sessionState) return;

    const sessionError: SessionError = {
      timestamp: Date.now(),
      phase,
      task,
      error,
      stack,
      resolved: false
    };

    this.sessionState.errors.push(sessionError);
    this.saveSessionState();

    this.emit('errorRecorded', sessionError);

    console.error(`[SessionManager] Session error recorded: ${phase}${task ? ` / ${task}` : ''} - ${error}`);
  }

  /**
   * Mark error as resolved
   */
  resolveError(timestamp: number): void {
    if (!this.isEnabled || !this.sessionState) return;

    const error = this.sessionState.errors.find(e => e.timestamp === timestamp);
    if (error) {
      error.resolved = true;
      this.saveSessionState();
      this.emit('errorResolved', error);
    }
  }

  /**
   * Set performance baseline
   */
  setPerformanceBaseline(averageProcessingTime: number): void {
    if (!this.isEnabled || !this.sessionState) return;

    this.sessionState.performanceBaseline = {
      averageProcessingTime,
      timestamp: Date.now()
    };

    this.saveSessionState();
  }

  /**
   * Store custom resume data
   */
  setResumeData(key: string, data: any): void {
    if (!this.isEnabled || !this.sessionState) return;

    this.sessionState.resumeData[key] = data;
    this.saveSessionState();
  }

  /**
   * Get custom resume data
   */
  getResumeData(key: string): any {
    return this.sessionState?.resumeData[key];
  }

  /**
   * Complete current session
   */
  completeSession(): void {
    if (!this.isEnabled || !this.sessionState) return;

    // Archive completed session
    this.archiveSession();

    // Clear current session state
    this.sessionState = null;
    this.clearStateFile();

    this.emit('sessionCompleted', {});
  }

  /**
   * Clear current session (useful for starting fresh)
   */
  clearSession(): void {
    if (!this.isEnabled) return;

    this.sessionState = null;
    this.rollbackPoints = [];
    this.clearStateFile();

    this.emit('sessionCleared');
  }

  /**
   * Get session statistics
   */
  getSessionStats(): any {
    if (!this.sessionState) return null;

    const duration = Date.now() - this.sessionState.startTime;
    const batchInfo = this.sessionState.batchInfo;

    return {
      sessionId: this.sessionState.sessionId,
      duration,
      currentPhase: this.sessionState.currentPhase,
      completedTasks: this.sessionState.completedTasks.length,
      totalErrors: this.sessionState.errors.length,
      unresolvedErrors: this.sessionState.errors.filter(e => !e.resolved).length,
      batchProgress: batchInfo ? {
        processed: batchInfo.processedImages,
        failed: batchInfo.failedImages,
        total: batchInfo.totalImages,
        percentage: (batchInfo.processedImages / batchInfo.totalImages) * 100
      } : null,
      rollbackPointsAvailable: this.rollbackPoints.length
    };
  }

  /**
   * Save session state to disk
   */
  private saveSessionState(): void {
    if (!this.sessionState) return;

    try {
      // Create backup of current state
      if (fs.existsSync(this.stateFilePath)) {
        fs.copyFileSync(this.stateFilePath, this.backupFilePath);
      }

      // Save current state
      const stateData = {
        ...this.sessionState,
        lastSaved: Date.now(),
        version: '1.0'
      };

      fs.writeFileSync(this.stateFilePath, JSON.stringify(stateData, null, 2));

    } catch (error) {
      console.error('[SessionManager] Error saving session state:', error);
    }
  }

  /**
   * Load session state from disk
   */
  private loadSessionState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const stateData = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));

        // Validate state data
        if (stateData.sessionId && stateData.startTime) {
          this.sessionState = stateData;
          this.rollbackPoints = stateData.optimizationProgress?.rollbackPoints || [];

          // Check if session is recent enough to resume (within last 24 hours)
          const sessionAge = Date.now() - stateData.startTime;
          const maxAge = 24 * 60 * 60 * 1000; // 24 hours

          if (sessionAge > maxAge) {
            this.clearSession();
            return;
          }
        }
      }
    } catch (error) {
      console.error('[SessionManager] Error loading session state:', error);
      this.loadBackupState();
    }
  }

  /**
   * Load backup state if main state is corrupted
   */
  private loadBackupState(): void {
    try {
      if (fs.existsSync(this.backupFilePath)) {
        const backupData = JSON.parse(fs.readFileSync(this.backupFilePath, 'utf8'));
        this.sessionState = backupData;
      }
    } catch (error) {
      console.error('[SessionManager] Error loading backup session state:', error);
    }
  }

  /**
   * Clear state files
   */
  private clearStateFile(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
      }
      if (fs.existsSync(this.backupFilePath)) {
        fs.unlinkSync(this.backupFilePath);
      }
    } catch (error) {
      console.error('[SessionManager] Error clearing state files:', error);
    }
  }

  /**
   * Archive completed session
   */
  private archiveSession(): void {
    if (!this.sessionState) return;

    try {
      const archiveDir = path.join(path.dirname(this.stateFilePath), 'session-archive');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      const archiveFile = path.join(archiveDir, `session-${this.sessionState.sessionId}-${Date.now()}.json`);
      fs.writeFileSync(archiveFile, JSON.stringify(this.sessionState, null, 2));

      // Cleanup old archives (keep last 5)
      const archiveFiles = fs.readdirSync(archiveDir)
        .filter(f => f.startsWith('session-') && f.endsWith('.json'))
        .sort()
        .reverse();

      archiveFiles.slice(5).forEach(file => {
        try {
          fs.unlinkSync(path.join(archiveDir, file));
        } catch (error) {
          console.error('[SessionManager] Error deleting old archive:', error);
        }
      });

    } catch (error) {
      console.error('[SessionManager] Error archiving session:', error);
    }
  }

  /**
   * Start auto-save mechanism
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    // Auto-save every 30 seconds
    this.autoSaveInterval = setInterval(() => {
      if (this.sessionState) {
        this.saveSessionState();
      }
    }, 30000);
  }

  /**
   * Capture performance snapshot
   */
  private capturePerformanceSnapshot(): any {
    // This would capture current performance metrics
    // Implementation depends on PerformanceMonitor integration
    return {
      timestamp: Date.now(),
      memoryUsage: process.memoryUsage(),
      // Additional metrics would be added here
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    if (this.sessionState) {
      this.saveSessionState();
    }
  }
}

// Singleton instance
export const sessionManager = new SessionManager();

// Convenience functions
export function initializeSession(sessionId: string, totalImages: number, folderPath: string): void {
  sessionManager.initializeSession(sessionId, totalImages, folderPath);
}

export function hasResumableSession(): boolean {
  return sessionManager.hasResumableSession();
}

export function resumeSession(): SessionState | null {
  return sessionManager.resumeSession();
}

export function completeTask(taskId: string): void {
  sessionManager.completeTask(taskId);
}

export function updateCurrentTask(taskId: string): void {
  sessionManager.updateCurrentTask(taskId);
}

export function createRollbackPoint(
  id: string,
  phase: string,
  task: string,
  filesModified: string[],
  description: string
): void {
  sessionManager.createRollbackPoint(id, phase, task, filesModified, description);
}

export function completeSession(): void {
  sessionManager.completeSession();
}
