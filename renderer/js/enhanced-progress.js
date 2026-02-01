/**
 * Racetagger Desktop - Enhanced Progress System
 * Real-time processing feedback with detailed phase tracking
 */

class EnhancedProgressTracker {
  constructor() {
    this.isVisible = false;
    this.isMinimized = false;
    this.isPaused = false;
    this.currentPhase = 'preparing';
    this.totalFiles = 0;
    this.processedFiles = 0;
    this.currentFile = null;
    this.startTime = null;
    
    this.phases = {
      preparing: { label: 'Preparing', icon: '⚙️', order: 1 },
      analyzing: { label: 'AI Analysis', icon: '🤖', order: 2 },
      metadata: { label: 'Metadata', icon: '🏷️', order: 3 },
      converting: { label: 'Converting', icon: '🔄', order: 4 },
      finalizing: { label: 'Finalizing', icon: '✅', order: 5 }
    };
    
    this.phaseProgress = {
      preparing: 0,
      analyzing: 0,
      metadata: 0,
      converting: 0,
      finalizing: 0
    };
    
    this.completedPhases = new Set();
    
    this.init();
  }
  
  init() {
    this.createProgressHTML();
    this.bindEvents();
    this.setupIPCListeners();
  }
  
  createProgressHTML() {
    const progressHTML = `
      <!-- Enhanced Progress Overlay -->
      <div class="enhanced-progress-container" id="enhanced-progress-overlay">
        <div class="progress-main-card" id="progress-main-card">
          <!-- Status Messages Area -->
          <div id="status-messages-area"></div>
          
          <!-- Progress Header -->
          <div class="progress-header">
            <h2 class="progress-title">
              <span class="progress-icon" id="progress-main-icon">🚀</span>
              <span id="progress-main-title">Processing Images</span>
            </h2>
            <p class="progress-subtitle" id="progress-subtitle">Analyzing your race images with AI...</p>
          </div>
          
          <!-- Phase Tracker -->
          <div class="phase-tracker">
            <div class="phase-progress-line" id="phase-progress-line"></div>
            ${Object.entries(this.phases).map(([key, phase]) => `
              <div class="phase-step" data-phase="${key}">
                <div class="phase-circle">
                  <span>${phase.icon}</span>
                </div>
                <div class="phase-label">${phase.label}</div>
              </div>
            `).join('')}
          </div>
          
          <!-- Current File Section -->
          <div class="current-file-section">
            <div class="current-file-header">
              <span class="current-file-label">Current File</span>
              <span class="file-counter" id="file-counter">0 / 0</span>
            </div>
            <div class="current-file-display">
              <div class="current-file-preview" id="current-file-preview">
                <div class="loading">📸</div>
              </div>
              <div class="current-file-info">
                <div class="current-filename" id="current-filename">Preparing...</div>
                <div class="current-file-details">
                  <div class="file-detail">
                    <span>📐</span>
                    <span id="file-size">--</span>
                  </div>
                  <div class="file-detail">
                    <span>🎯</span>
                    <span id="file-format">--</span>
                  </div>
                  <div class="file-detail">
                    <span>⏱️</span>
                    <span id="file-elapsed">--</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Progress Bars -->
          <div class="progress-bars-section">
            <!-- Overall Progress -->
            <div class="progress-bar-group overall-progress">
              <div class="progress-bar-label">
                <span class="progress-bar-title">Overall Progress</span>
                <span class="progress-bar-value" id="overall-percentage">0%</span>
              </div>
              <div class="progress-bar-track">
                <div class="progress-bar-fill animated" id="overall-progress-fill"></div>
              </div>
            </div>
            
            <!-- Current Phase Progress -->
            <div class="progress-bar-group">
              <div class="progress-bar-label">
                <span class="progress-bar-title" id="current-phase-title">Current Phase</span>
                <span class="progress-bar-value" id="phase-percentage">0%</span>
              </div>
              <div class="progress-bar-track">
                <div class="progress-bar-fill animated" id="phase-progress-fill"></div>
              </div>
            </div>
          </div>
          
          <!-- Time Estimates -->
          <div class="time-estimates">
            <div class="time-estimate-card">
              <span class="time-estimate-value" id="elapsed-time">00:00</span>
              <span class="time-estimate-label">Elapsed</span>
            </div>
            <div class="time-estimate-card">
              <span class="time-estimate-value" id="remaining-time">--:--</span>
              <span class="time-estimate-label">Remaining</span>
            </div>
            <div class="time-estimate-card">
              <span class="time-estimate-value" id="avg-speed">-- sec</span>
              <span class="time-estimate-label">Avg/Image</span>
            </div>
            <div class="time-estimate-card">
              <span class="time-estimate-value" id="total-eta">--:--</span>
              <span class="time-estimate-label">Total ETA</span>
            </div>
          </div>
          
          <!-- Control Buttons -->
          <div class="progress-controls">
            <button class="progress-control-btn btn-pause" id="btn-pause-resume">
              <span>⏸️</span>
              <span>Pause</span>
            </button>
            <button class="progress-control-btn btn-stop" id="btn-stop">
              <span>⏹️</span>
              <span>Stop</span>
            </button>
            <button class="progress-control-btn btn-minimize" id="btn-minimize">
              <span>➖</span>
              <span>Minimize</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Minimized Progress -->
      <div class="progress-minimized" id="progress-minimized" style="display: none;">
        <div class="minimized-header">
          <span class="minimized-title">Processing...</span>
          <button class="minimized-close" id="minimized-close">×</button>
        </div>
        <div class="minimized-progress">
          <div class="progress-bar-track">
            <div class="progress-bar-fill" id="minimized-progress-fill"></div>
          </div>
        </div>
        <div class="minimized-info">
          <span id="minimized-file-counter">0 / 0</span>
          <span id="minimized-eta">--:--</span>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', progressHTML);
  }
  
  bindEvents() {
    // Control buttons
    document.getElementById('btn-pause-resume').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-stop').addEventListener('click', () => this.stopProcessing());
    document.getElementById('btn-minimize').addEventListener('click', () => this.minimize());
    
    // Minimized controls
    document.getElementById('progress-minimized').addEventListener('click', (e) => {
      if (e.target.id !== 'minimized-close') {
        this.restore();
      }
    });
    document.getElementById('minimized-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (this.isVisible && e.key === 'Escape') {
        this.minimize();
      }
    });
  }
  
  setupIPCListeners() {
    // Listen for processing events from main process
    if (window.api) {
      // Use receive instead of on for consistency with existing code
      window.api.receive('processing-started', (data) => {
        this.startProcessing(data);
      });

      window.api.receive('processing-progress', (data) => {
        this.updateProgress(data);
      });

      window.api.receive('processing-file-started', (data) => {
        this.setCurrentFile(data);
      });

      window.api.receive('processing-phase-changed', (data) => {
        this.setPhase(data.phase);
      });

      // New temporal analysis events
      window.api.receive('temporal-analysis-started', (data) => {
        this.handleTemporalAnalysisStarted(data);
      });

      window.api.receive('temporal-batch-progress', (data) => {
        this.handleTemporalBatchProgress(data);
      });

      window.api.receive('temporal-analysis-complete', (data) => {
        this.handleTemporalAnalysisComplete(data);
      });

      window.api.receive('recognition-phase-started', (data) => {
        this.handleRecognitionPhaseStarted(data);
      });
      
      window.api.receive('processing-completed', (data) => {
        this.completeProcessing(data);
      });

      window.api.receive('batch-cancelled', (data) => {
        this.handleCancelled(data);
      });

      window.api.receive('processing-error', (data) => {
        this.showError(data.error);
      });

      window.api.receive('processing-paused', () => {
        this.setPaused(true);
      });

      window.api.receive('processing-resumed', () => {
        this.setPaused(false);
      });
    }
  }
  
  show() {
    this.isVisible = true;
    document.getElementById('enhanced-progress-overlay').classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  
  hide() {
    this.isVisible = false;
    this.isMinimized = false;
    document.getElementById('enhanced-progress-overlay').classList.remove('visible');
    document.getElementById('progress-minimized').style.display = 'none';
    document.body.style.overflow = '';
  }
  
  minimize() {
    if (!this.isVisible) return;
    
    this.isMinimized = true;
    document.getElementById('enhanced-progress-overlay').classList.remove('visible');
    document.getElementById('progress-minimized').style.display = 'block';
    document.body.style.overflow = '';
    
    this.showStatusMessage('Processing minimized to bottom right', 'info');
  }
  
  restore() {
    if (!this.isMinimized) return;
    
    this.isMinimized = false;
    document.getElementById('progress-minimized').style.display = 'none';
    document.getElementById('enhanced-progress-overlay').classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  
  startProcessing(data) {
    this.totalFiles = data.totalFiles || 0;
    this.processedFiles = 0;
    this.startTime = Date.now();
    this.currentPhase = 'temporal';
    this.currentStep = 1;
    this.totalSteps = 2;

    // Reset all progress
    Object.keys(this.phaseProgress).forEach(phase => {
      this.phaseProgress[phase] = 0;
    });
    this.completedPhases.clear();
    
    // Update UI
    document.getElementById('file-counter').textContent = `0 / ${this.totalFiles}`;
    document.getElementById('minimized-file-counter').textContent = `0 / ${this.totalFiles}`;
    
    this.setPhase('preparing');
    this.show();
    
    this.showStatusMessage('Processing started successfully', 'success');
  }

  handleTemporalAnalysisStarted(data) {
    this.currentPhase = 'temporal';
    this.currentStep = 1;
    this.totalSteps = 2;

    // Update phase title
    const phaseTitle = document.getElementById('current-phase-title');
    if (phaseTitle) {
      phaseTitle.textContent = 'Step 1 of 2: Analyzing Timestamps';
    }

    // Update status
    this.updateCurrentStatus('Extracting EXIF timestamps...');
    this.showStatusMessage('Started temporal analysis', 'info');
  }

  handleTemporalBatchProgress(data) {
    // Update phase progress based on temporal progress
    const phaseProgress = Math.round((data.processed / data.total) * 100);
    const phaseProgressFill = document.getElementById('phase-progress-fill');
    const phasePercentage = document.getElementById('phase-percentage');

    if (phaseProgressFill) {
      phaseProgressFill.style.width = `${phaseProgress}%`;
    }
    if (phasePercentage) {
      phasePercentage.textContent = `${phaseProgress}%`;
    }

    // Update overall progress (temporal is 30% of total)
    const overallProgress = Math.round((phaseProgress * 0.3));
    const overallProgressFill = document.getElementById('overall-progress-fill');
    const overallPercentage = document.getElementById('overall-percentage');

    if (overallProgressFill) {
      overallProgressFill.style.width = `${overallProgress}%`;
    }
    if (overallPercentage) {
      overallPercentage.textContent = `${overallProgress}%`;
    }

    // Update status with batch info
    this.updateCurrentStatus(`Processing batch ${data.currentBatch}/${data.totalBatches} (${data.processed}/${data.total} images)`);

    // Update minimized progress
    const minimizedFill = document.getElementById('minimized-progress-fill');
    const minimizedCounter = document.getElementById('minimized-file-counter');
    if (minimizedFill) {
      minimizedFill.style.width = `${overallProgress}%`;
    }
    if (minimizedCounter) {
      minimizedCounter.textContent = `Step 1: ${data.processed} / ${data.total}`;
    }
  }

  handleTemporalAnalysisComplete(data) {
    // Complete phase progress
    const phaseProgressFill = document.getElementById('phase-progress-fill');
    const phasePercentage = document.getElementById('phase-percentage');

    if (phaseProgressFill) {
      phaseProgressFill.style.width = '100%';
    }
    if (phasePercentage) {
      phasePercentage.textContent = '100%';
    }

    // Update overall to 30%
    const overallProgressFill = document.getElementById('overall-progress-fill');
    const overallPercentage = document.getElementById('overall-percentage');

    if (overallProgressFill) {
      overallProgressFill.style.width = '30%';
    }
    if (overallPercentage) {
      overallPercentage.textContent = '30%';
    }

    this.showStatusMessage(
      `Temporal analysis complete: ${data.processedImages}/${data.totalImages} processed, ${data.totalClusters} clusters created`,
      'success'
    );
  }

  handleRecognitionPhaseStarted(data) {
    this.currentPhase = 'recognition';
    this.currentStep = 2;

    // Update phase title
    const phaseTitle = document.getElementById('current-phase-title');
    if (phaseTitle) {
      phaseTitle.textContent = 'Step 2 of 2: Recognizing Vehicles';
    }

    // Reset phase progress for new phase
    const phaseProgressFill = document.getElementById('phase-progress-fill');
    const phasePercentage = document.getElementById('phase-percentage');

    if (phaseProgressFill) {
      phaseProgressFill.style.width = '0%';
    }
    if (phasePercentage) {
      phasePercentage.textContent = '0%';
    }

    this.updateCurrentStatus('Starting vehicle recognition...');
    this.showStatusMessage('Started vehicle recognition phase', 'info');
  }

  updateCurrentStatus(message) {
    const statusElement = document.getElementById('current-status');
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  updateProgress(data) {
    this.processedFiles = data.processed || 0;

    // Handle different phases
    if (data.phase === 'recognition') {
      // Update phase progress for recognition
      const phaseProgress = Math.round((this.processedFiles / this.totalFiles) * 100);
      const phaseProgressFill = document.getElementById('phase-progress-fill');
      const phasePercentage = document.getElementById('phase-percentage');

      if (phaseProgressFill) {
        phaseProgressFill.style.width = `${phaseProgress}%`;
      }
      if (phasePercentage) {
        phasePercentage.textContent = `${phaseProgress}%`;
      }

      // Update overall progress (recognition is 70% of total, starting from 30%)
      const overallProgress = Math.round(30 + (phaseProgress * 0.7));
      const overallProgressFill = document.getElementById('overall-progress-fill');
      const overallPercentage = document.getElementById('overall-percentage');

      if (overallProgressFill) {
        overallProgressFill.style.width = `${overallProgress}%`;
      }
      if (overallPercentage) {
        overallPercentage.textContent = `${overallProgress}%`;
      }

      // Update minimized progress
      const minimizedFill = document.getElementById('minimized-progress-fill');
      const minimizedCounter = document.getElementById('minimized-file-counter');
      if (minimizedFill) {
        minimizedFill.style.width = `${overallProgress}%`;
      }
      if (minimizedCounter) {
        minimizedCounter.textContent = `Step 2: ${this.processedFiles} / ${this.totalFiles}`;
      }
    } else {
      // Legacy handling for non-phase specific progress
      const overallProgress = this.totalFiles > 0 ? (this.processedFiles / this.totalFiles) * 100 : 0;
      document.getElementById('overall-percentage').textContent = `${Math.round(overallProgress)}%`;
      document.getElementById('overall-progress-fill').style.width = `${overallProgress}%`;
      document.getElementById('minimized-progress-fill').style.width = `${overallProgress}%`;
    }
    
    // Update file counter
    document.getElementById('file-counter').textContent = `${this.processedFiles} / ${this.totalFiles}`;
    document.getElementById('minimized-file-counter').textContent = `${this.processedFiles} / ${this.totalFiles}`;
    
    // Update phase progress if provided
    if (data.phaseProgress !== undefined) {
      this.phaseProgress[this.currentPhase] = data.phaseProgress;
      document.getElementById('phase-percentage').textContent = `${Math.round(data.phaseProgress)}%`;
      document.getElementById('phase-progress-fill').style.width = `${data.phaseProgress}%`;
    }
    
    // Update time estimates
    this.updateTimeEstimates();
    
    // Update phase tracker visual progress
    this.updatePhaseTracker();
  }
  
  setCurrentFile(data) {
    this.currentFile = data;
    
    const filename = data.filename || 'Unknown file';
    const size = data.size ? this.formatFileSize(data.size) : '--';
    const format = data.format ? data.format.toUpperCase() : '--';
    
    document.getElementById('current-filename').textContent = filename;
    document.getElementById('file-size').textContent = size;
    document.getElementById('file-format').textContent = format;
    
    // Update preview if available
    const preview = document.getElementById('current-file-preview');
    if (data.thumbnail) {
      preview.innerHTML = `<img src="${data.thumbnail}" alt="${filename}">`;
    } else {
      preview.innerHTML = '<div class="loading">📸</div>';
    }
    
    // Reset file elapsed time
    this.fileStartTime = Date.now();
  }
  
  setPhase(phase) {
    if (!this.phases[phase]) return;
    
    // Mark previous phase as completed
    if (this.currentPhase && this.currentPhase !== phase) {
      this.completedPhases.add(this.currentPhase);
      this.phaseProgress[this.currentPhase] = 100;
    }
    
    this.currentPhase = phase;
    
    // Update phase tracker
    document.querySelectorAll('.phase-step').forEach(step => {
      const stepPhase = step.dataset.phase;
      step.classList.remove('active', 'completed');
      
      if (this.completedPhases.has(stepPhase)) {
        step.classList.add('completed');
      } else if (stepPhase === phase) {
        step.classList.add('active');
      }
    });
    
    // Update phase title
    document.getElementById('current-phase-title').textContent = this.phases[phase].label;
    document.getElementById('progress-main-icon').textContent = this.phases[phase].icon;
    
    // Update main title based on phase
    const titleMap = {
      preparing: 'Preparing Files',
      analyzing: 'AI Analysis in Progress',
      metadata: 'Adding Metadata',
      converting: 'Converting Files',
      finalizing: 'Finalizing Results'
    };
    document.getElementById('progress-main-title').textContent = titleMap[phase] || 'Processing Images';
    
    this.showStatusMessage(`Started ${this.phases[phase].label.toLowerCase()} phase`, 'info');
  }
  
  updateTimeEstimates() {
    if (!this.startTime) return;
    
    const elapsed = Date.now() - this.startTime;
    const elapsedSeconds = Math.floor(elapsed / 1000);
    
    // Update elapsed time
    document.getElementById('elapsed-time').textContent = this.formatTime(elapsedSeconds);
    
    if (this.processedFiles > 0) {
      // Calculate average time per image
      const avgTimePerImage = elapsed / this.processedFiles;
      document.getElementById('avg-speed').textContent = `${(avgTimePerImage / 1000).toFixed(1)}s`;
      
      // Calculate remaining time
      const remainingFiles = this.totalFiles - this.processedFiles;
      const remainingTime = Math.floor((avgTimePerImage * remainingFiles) / 1000);
      document.getElementById('remaining-time').textContent = this.formatTime(remainingTime);
      document.getElementById('minimized-eta').textContent = this.formatTime(remainingTime);
      
      // Calculate total ETA
      const totalTime = Math.floor((avgTimePerImage * this.totalFiles) / 1000);
      document.getElementById('total-eta').textContent = this.formatTime(totalTime);
    }
    
    // Update file elapsed time
    if (this.fileStartTime) {
      const fileElapsed = Math.floor((Date.now() - this.fileStartTime) / 1000);
      document.getElementById('file-elapsed').textContent = `${fileElapsed}s`;
    }
  }
  
  updatePhaseTracker() {
    const totalPhases = Object.keys(this.phases).length;
    const completedCount = this.completedPhases.size;
    const currentPhaseIndex = this.phases[this.currentPhase]?.order || 1;
    
    // Calculate overall phase progress (including current phase progress)
    const overallPhaseProgress = ((completedCount + (this.phaseProgress[this.currentPhase] / 100)) / totalPhases) * 100;
    
    // Update progress line
    document.getElementById('phase-progress-line').style.width = `${Math.min(overallPhaseProgress * 0.8, 80)}%`;
  }
  
  togglePause() {
    const button = document.getElementById('btn-pause-resume');
    
    if (this.isPaused) {
      // Resume
      button.innerHTML = '<span>⏸️</span><span>Pause</span>';
      button.className = 'progress-control-btn btn-pause';
      document.getElementById('progress-main-card').classList.remove('paused');
      
      if (window.api) {
        window.api.send('resume-processing');
      }
      
      this.showStatusMessage('Processing resumed', 'success');
    } else {
      // Pause
      button.innerHTML = '<span>▶️</span><span>Resume</span>';
      button.className = 'progress-control-btn btn-resume';
      document.getElementById('progress-main-card').classList.add('paused');
      
      if (window.api) {
        window.api.send('pause-processing');
      }
      
      this.showStatusMessage('Processing paused', 'warning');
    }
    
    this.isPaused = !this.isPaused;
  }
  
  setPaused(paused) {
    this.isPaused = paused;
    const button = document.getElementById('btn-pause-resume');
    
    if (paused) {
      button.innerHTML = '<span>▶️</span><span>Resume</span>';
      button.className = 'progress-control-btn btn-resume';
      document.getElementById('progress-main-card').classList.add('paused');
    } else {
      button.innerHTML = '<span>⏸️</span><span>Pause</span>';
      button.className = 'progress-control-btn btn-pause';
      document.getElementById('progress-main-card').classList.remove('paused');
    }
  }
  
  stopProcessing() {
    if (confirm('Are you sure you want to stop processing? This will cancel the current operation.')) {
      if (window.api) {
        window.api.send('stop-processing');
      }

      this.showStatusMessage('Stopping... waiting for in-flight images to complete', 'warning');

      // Disable stop button to prevent multiple clicks
      const stopBtn = document.getElementById('btn-stop');
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.innerHTML = '<span>🛑</span><span>Stopping...</span>';
      }

      // UI will be hidden when batch-cancelled or batch-complete event is received
    }
  }
  
  handleCancelled(data) {
    const processed = data?.processedImages || this.processedFiles;
    const total = data?.totalImages || this.totalFiles;

    // Update UI to show cancellation
    document.getElementById('progress-main-icon').textContent = '🛑';
    document.getElementById('progress-main-title').textContent = 'Processing Cancelled';
    document.getElementById('progress-subtitle').textContent = `Processed ${processed} of ${total} images before cancellation`;

    this.showStatusMessage(`Processing cancelled. ${processed} images were completed.`, 'warning');

    // Change controls to show Done button
    const controlsDiv = document.querySelector('.progress-controls');
    if (controlsDiv) {
      controlsDiv.innerHTML = `
        <button class="progress-control-btn btn-resume" onclick="window.enhancedProgress.viewResults()">
          <span>👁️</span>
          <span>View Results</span>
        </button>
        <button class="progress-control-btn btn-minimize" onclick="window.enhancedProgress.hide()">
          <span>✅</span>
          <span>Done</span>
        </button>
      `;
    }

    // Auto-hide after 3 seconds if minimized
    if (this.isMinimized) {
      setTimeout(() => {
        this.hide();
      }, 3000);
    }
  }

  completeProcessing(data) {
    // Mark all phases as completed
    Object.keys(this.phases).forEach(phase => {
      this.completedPhases.add(phase);
      this.phaseProgress[phase] = 100;
    });
    
    // Update UI to show completion
    document.getElementById('progress-main-icon').textContent = '🎉';
    document.getElementById('progress-main-title').textContent = 'Processing Complete!';
    document.getElementById('progress-subtitle').textContent = `Successfully processed ${this.processedFiles} images`;
    
    document.getElementById('overall-percentage').textContent = '100%';
    document.getElementById('overall-progress-fill').style.width = '100%';
    document.getElementById('phase-percentage').textContent = '100%';
    document.getElementById('phase-progress-fill').style.width = '100%';
    
    // Update phase tracker
    this.updatePhaseTracker();
    document.querySelectorAll('.phase-step').forEach(step => {
      step.classList.remove('active');
      step.classList.add('completed');
    });
    
    // Show completion message
    this.showStatusMessage(`🎉 All ${this.processedFiles} images processed successfully!`, 'success');
    
    // Change controls
    const controlsDiv = document.querySelector('.progress-controls');
    controlsDiv.innerHTML = `
      <button class="progress-control-btn btn-resume" onclick="window.enhancedProgress.viewResults()">
        <span>👁️</span>
        <span>View Results</span>
      </button>
      <button class="progress-control-btn btn-minimize" onclick="window.enhancedProgress.hide()">
        <span>✅</span>
        <span>Done</span>
      </button>
    `;
    
    // Auto-hide after 5 seconds if minimized
    if (this.isMinimized) {
      setTimeout(() => {
        this.hide();
      }, 5000);
    }
  }
  
  showError(error) {
    document.getElementById('progress-main-card').classList.add('error');
    this.showStatusMessage(`Error: ${error}`, 'error');
    
    // Change icon to error
    document.getElementById('progress-main-icon').textContent = '❌';
    document.getElementById('progress-main-title').textContent = 'Processing Error';
    
    setTimeout(() => {
      document.getElementById('progress-main-card').classList.remove('error');
    }, 3000);
  }
  
  showStatusMessage(message, type = 'info') {
    const container = document.getElementById('status-messages-area');
    
    const messageEl = document.createElement('div');
    messageEl.className = `status-message ${type}`;
    messageEl.textContent = message;
    
    container.appendChild(messageEl);
    
    // Remove after 4 seconds
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.parentNode.removeChild(messageEl);
      }
    }, 4000);
    
    // Keep only last 3 messages
    while (container.children.length > 3) {
      container.removeChild(container.firstChild);
    }
  }
  
  viewResults() {
    // Switch to results view
    this.hide();
    
    // Trigger results view (assuming results container exists)
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
      resultsContainer.scrollIntoView({ behavior: 'smooth' });
    }
  }
  
  formatTime(seconds) {
    if (seconds < 0) return '--:--';
    
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
  
  // Public API methods
  isProcessing() {
    return this.isVisible;
  }
  
  getCurrentProgress() {
    return {
      totalFiles: this.totalFiles,
      processedFiles: this.processedFiles,
      currentPhase: this.currentPhase,
      isPaused: this.isPaused
    };
  }
}

// Initialize enhanced progress tracker
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit to ensure main renderer is ready
  setTimeout(() => {
    window.enhancedProgress = new EnhancedProgressTracker();
    
    // Override original progress container behavior
    const originalProgressContainer = document.getElementById('progress-container');
    if (originalProgressContainer) {
      // Progress container now uses new CSS classes without conflicts
      // originalProgressContainer.classList.add('original-component'); // Removed to fix visibility issue
    }
  }, 300);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedProgressTracker;
}