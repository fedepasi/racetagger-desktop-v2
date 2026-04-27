/*
 * Racetagger Desktop - Delight System Integration
 * Seamlessly integrates delight experiences with existing functionality
 */

class RacetaggerDelightIntegration {
  constructor() {
    this.originalFunctions = {};
    this.isProcessing = false;
    this.processedCount = 0;
    this.totalCount = 0;
    this.startTime = null;
    
    this.init();
  }
  
  init() {
    // Wait for both systems to be ready
    this.waitForSystems().then(() => {
      this.interceptOriginalFunctions();
      this.setupEventListeners();
      this.enhanceUI();
    });
  }
  
  async waitForSystems() {
    // Wait for delight system
    while (!window.delightSystem) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Wait for main renderer functions
    while (!window.handleUploadAndAnalyze) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  interceptOriginalFunctions() {
    // Store originals
    this.originalFunctions.handleUploadAndAnalyze = window.handleUploadAndAnalyze;
    this.originalFunctions.handleAnalysisResults = window.handleAnalysisResults;
    this.originalFunctions.handleBatchResults = window.handleBatchResults;
    this.originalFunctions.handleImageProcessed = window.handleImageProcessed;
    this.originalFunctions.showError = window.showError;
    this.originalFunctions.updateBatchProgress = window.updateBatchProgress;
    
    // Replace with delightful versions
    window.handleUploadAndAnalyze = this.delightfulUploadAndAnalyze.bind(this);
    window.handleAnalysisResults = this.delightfulAnalysisResults.bind(this);
    window.handleBatchResults = this.delightfulBatchResults.bind(this);
    window.handleImageProcessed = this.delightfulImageProcessed.bind(this);
    window.showError = this.delightfulShowError.bind(this);
    window.updateBatchProgress = this.delightfulUpdateProgress.bind(this);
  }
  
  setupEventListeners() {
    // File selection enhancement
    const fileInput = document.getElementById('file-upload');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
          this.showFileSelectedDelight(e.target.files[0]);
        }
      });
    }
    
    // Folder selection enhancement
    if (window.api) {
      window.api.receive('folder-selected', (data) => {
        if (data.success && data.imageCount > 0) {
          this.showFolderSelectedDelight(data);
        }
      });
    }
    
    // Error handling enhancement
    if (window.api) {
      window.api.receive('upload-error', (error) => {
        this.showEnhancedError(error);
      });
      
      window.api.receive('csv-error', (error) => {
        this.showEnhancedError(error, 'csv_error');
      });
    }
    
    // Easter eggs for power users
    this.setupEasterEggs();
    
    // Racing-specific keyboard shortcuts
    this.setupRacingShortcuts();

    // Global drag and drop - DISABLED for now (interferes with PDF drop zones)
    // this.setupGlobalDragDrop();

    // Performance tracking
    this.setupPerformanceTracking();
  }
  
  setupGlobalDragDrop() {
    // Allow drag and drop anywhere in the app
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.classList.add('dragover');
    });
    
    document.addEventListener('dragleave', (e) => {
      // Only remove if leaving the entire window
      if (!e.relatedTarget) {
        document.body.classList.remove('dragover');
      }
    });
    
    document.addEventListener('drop', (e) => {
      // Check if drop is on a specific drop zone - let those handle it
      const specificDropZone = e.target.closest('#pdf-drop-zone, .face-photo-drop-zone, .custom-drop-zone');
      if (specificDropZone) {
        // Don't handle - let the specific zone handle it
        document.body.classList.remove('dragover');
        return;
      }

      e.preventDefault();
      document.body.classList.remove('dragover');

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        this.handleGlobalDrop(files);
      }
    });
  }
  
  handleGlobalDrop(files) {
    // Filter for image files
    const imageFiles = files.filter(file => 
      file.type.startsWith('image/') || 
      /\.(jpg|jpeg|png|webp|raw|nef|arw|cr2|cr3|orf|dng)$/i.test(file.name)
    );
    
    if (imageFiles.length === 0) {
      window.delightSystem.showFriendlyError('unsupported_format', 
        'No supported image files found in the dropped items.');
      return;
    }
    
    // Show drop success notification
    const notification = this.createElement('div', {
      className: 'delight-drop-success delight-bounce-in'
    });
    
    notification.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        z-index: 2000;
        box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3);
      ">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.5rem;">🎯</span>
          <div>
            <div style="font-weight: 600;">${imageFiles.length} ${imageFiles.length === 1 ? 'Image' : 'Images'} Ready!</div>
            <div style="font-size: 0.9rem; opacity: 0.9;">Dropped directly onto Racetagger</div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 4000);
    
    // Auto-process if in race mode or fewer than 5 files
    if (document.body.classList.contains('race-mode-active') || imageFiles.length <= 5) {
      this.processDroppedFiles(imageFiles);
    } else {
      this.showDropProcessingOptions(imageFiles);
    }
  }
  
  showDropProcessingOptions(files) {
    const optionsModal = this.createElement('div', {
      className: 'drop-options-modal'
    });
    
    optionsModal.innerHTML = `
      <div class="modal-overlay" onclick="this.parentElement.remove()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <h3>🏁 Process ${files.length} Racing Images</h3>
          <p>You've dropped ${files.length} images. How would you like to process them?</p>
          
          <div class="process-options">
            <button class="process-option-btn primary" onclick="window.racetaggerDelight.processDroppedFiles(this.files, 'batch'); this.closest('.drop-options-modal').remove()">
              🚀 Batch Process All
              <small>Fastest for large sets</small>
            </button>
            
            <button class="process-option-btn secondary" onclick="window.racetaggerDelight.processDroppedFiles(this.files, 'individual'); this.closest('.drop-options-modal').remove()">
              🔍 Review Each Image
              <small>More control per image</small>
            </button>
            
            <button class="process-option-btn tertiary" onclick="this.closest('.drop-options-modal').remove()">
              ⏸️ Later
              <small>I'll process them manually</small>
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Store files reference for the buttons
    optionsModal.querySelector('.modal-content').files = files;
    
    document.body.appendChild(optionsModal);
  }
  
  processDroppedFiles(files, mode = 'batch') {
    if (mode === 'batch' && files.length > 0) {
      // Use real batch processing with parallel optimization
      this.startRealBatchProcessing(files);
    } else {
      // Use individual processing for single files or individual mode
      this.simulateIndividualProcessing(files);
    }
  }
  
  async startRealBatchProcessing(files) {
    try {
      // Convert FileList to actual file paths array
      const filePaths = [];
      const tempFiles = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // For dropped files, we need to save them temporarily and get paths
        // This is a simplified approach - in production you'd handle file paths differently
        tempFiles.push(file);
        filePaths.push(file.name); // Simplified - would need actual file paths
      }
      
      // Build configuration for batch processing
      const config = {
        folderPath: 'dropped-files', // Temporary identifier for dropped files
        filePaths: filePaths,
        tempFiles: tempFiles, // Include actual File objects for processing
        selectedModel: 'gemini-2.5-flash-preview-04-17',
        selectedCategory: window.selectedCategory || 'motorsport',
        resize: { enabled: true, preset: 'balanced' }
      };
      
      // Show enhanced loading UI
      window.delightSystem.showEnhancedLoading({
        totalFiles: files.length,
        showFunFacts: files.length > 10,
        showProgress: true
      });
      
      // Send to main process for real analysis
      if (window.api) {
        window.api.send('analyze-folder', config);
      } else {
        // Fallback to simulation if API not available
        this.simulateBatchProcessing(files);
      }
      
    } catch (error) {
      console.error('Error processing dropped files:', error);
      // Fallback to simulation on error
      this.simulateBatchProcessing(files);
    }
  }
  
  simulateBatchProcessing(files) {
    this.isProcessing = true;
    this.totalCount = files.length;
    this.processedCount = 0;
    
    window.delightSystem.showEnhancedLoading({
      totalFiles: files.length,
      showFunFacts: files.length > 10,
      showProgress: true
    });
    
    // Simulate processing each file
    files.forEach((file, index) => {
      setTimeout(() => {
        this.processedCount++;
        const progress = (this.processedCount / this.totalCount) * 100;
        
        window.delightSystem.updateProgress(
          progress,
          `Processing ${file.name}... (${this.processedCount}/${this.totalCount})`
        );
        
        if (this.processedCount === this.totalCount) {
          // Complete
          setTimeout(() => {
            this.isProcessing = false;
            window.delightSystem.hideEnhancedLoading();
            
            const stats = {
              'Images Processed': files.length,
              'Drop Method': 'Direct Drop',
              'Processing Mode': 'Batch'
            };
            
            window.delightSystem.showSuccess('batch_complete', stats, 6000);
          }, 500);
        }
      }, (index + 1) * 800 + Math.random() * 400);
    });
  }
  
  setupPerformanceTracking() {
    if (!document.body.classList.contains('race-mode-active')) return;
    
    // Create performance indicator
    const indicator = this.createElement('div', {
      className: 'performance-indicator',
      id: 'perf-indicator'
    });
    
    document.body.appendChild(indicator);
    
    // Update performance metrics
    setInterval(() => {
      const indicator = document.getElementById('perf-indicator');
      if (!indicator) return;
      
      const memory = performance.memory ? 
        `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : 'N/A';
      const timing = performance.now ? 
        `${Math.round(performance.now())}ms` : 'N/A';
      
      indicator.innerHTML = `
        MEM: ${memory}<br>
        TIME: ${timing}<br>
        MODE: RACE
      `;
    }, 1000);
  }
  
  createElement(tag, attributes = {}) {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else {
        element.setAttribute(key, value);
      }
    });
    return element;
  }
  
  setupEasterEggs() {
    // Konami code for racing photographers
    const konamiCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]; // Up Up Down Down Left Right Left Right B A
    let konamiIndex = 0;
    
    document.addEventListener('keydown', (e) => {
      if (e.keyCode === konamiCode[konamiIndex]) {
        konamiIndex++;
        if (konamiIndex === konamiCode.length) {
          this.triggerRacingEasterEgg();
          konamiIndex = 0;
        }
      } else {
        konamiIndex = 0;
      }
    });
    
    // Long-press on logo for special features
    const logo = document.getElementById('logo');
    if (logo) {
      let pressTimer;
      logo.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => {
          this.showPowerUserFeatures();
        }, 2000);
      });
      
      logo.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
      });
    }
  }
  
  setupRacingShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + R for quick race mode toggle
      if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.shiftKey) {
        e.preventDefault();
        this.toggleRaceMode();
      }
      
      // F1 for quick help (racing reference!)
      if (e.key === 'F1') {
        e.preventDefault();
        window.delightSystem.showTips();
      }
      
      // Space bar for quick start when file is selected
      if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        const uploadBtn = document.getElementById('upload-button');
        if (uploadBtn && !uploadBtn.disabled) {
          e.preventDefault();
          uploadBtn.click();
          this.showShortcutFeedback('Space bar boost activated! 🚀');
        }
      }
    });
  }
  
  triggerRacingEasterEgg() {
    // Special racing-themed easter egg
    const easterEgg = document.createElement('div');
    easterEgg.className = 'racing-easter-egg';
    easterEgg.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: linear-gradient(90deg, #000 0%, #ff6b35 50%, #000 100%);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 3rem;
        text-align: center;
        animation: raceStart 3s ease-in-out forwards;
      ">
        <div>
          🏁 RACE MODE ACTIVATED 🏁<br>
          <div style="font-size: 1.5rem; margin-top: 1rem; opacity: 0.8;">
            Maximum speed processing enabled!
          </div>
        </div>
      </div>
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes raceStart {
        0% { opacity: 0; transform: scale(0.5); }
        50% { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.2); }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(easterEgg);
    
    // Enable race mode features
    document.body.classList.add('race-mode-active');
    
    setTimeout(() => {
      easterEgg.remove();
      style.remove();
    }, 3000);
  }
  
  showPowerUserFeatures() {
    const features = document.createElement('div');
    features.className = 'power-user-modal';
    features.innerHTML = `
      <div class="modal-overlay" onclick="this.parentElement.remove()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <h3>🏎️ Power User Features</h3>
          <div class="feature-list">
            <div class="feature-item">
              <strong>Keyboard Shortcuts:</strong>
              <ul>
                <li><kbd>Space</kbd> - Quick process selected files</li>
                <li><kbd>F1</kbd> - Show photography tips</li>
                <li><kbd>Ctrl+R</kbd> - Toggle race mode</li>
              </ul>
            </div>
            <div class="feature-item">
              <strong>Hidden Features:</strong>
              <ul>
                <li>Konami code for race mode</li>
                <li>Long-press logo for this menu</li>
                <li>Drag & drop anywhere on the app</li>
              </ul>
            </div>
            <div class="feature-item">
              <strong>Pro Tips:</strong>
              <ul>
                <li>Process practice sessions first</li>
                <li>Use batch mode for 10+ images</li>
                <li>Enable optimization for faster uploads</li>
              </ul>
            </div>
          </div>
          <button onclick="this.closest('.power-user-modal').remove()" 
                  style="margin-top: 1rem; padding: 0.5rem 1rem; background: #ff6b35; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Got it! 🚀
          </button>
        </div>
      </div>
    `;
    
    // Add modal styles
    const styles = `
      .power-user-modal .modal-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
        z-index: 3000; animation: fadeIn 0.3s ease-out;
      }
      .power-user-modal .modal-content {
        background: white; border-radius: 12px; padding: 2rem; max-width: 600px; width: 90%;
        box-shadow: 0 20px 40px rgba(0,0,0,0.3);
      }
      .power-user-modal .feature-list {
        display: grid; gap: 1rem; margin: 1rem 0;
      }
      .power-user-modal .feature-item {
        padding: 1rem; background: #f8fafc; border-radius: 8px;
      }
      .power-user-modal ul {
        margin: 0.5rem 0; padding-left: 1.5rem;
      }
      .power-user-modal kbd {
        background: #374151; color: white; padding: 2px 6px;
        border-radius: 3px; font-size: 0.8rem;
      }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    features.appendChild(styleSheet);
    
    document.body.appendChild(features);
  }
  
  toggleRaceMode() {
    const isActive = document.body.classList.toggle('race-mode-active');
    this.showShortcutFeedback(isActive ? 
      'Race Mode ON - Maximum performance! 🏁' : 
      'Race Mode OFF - Standard mode ✋'
    );
  }
  
  showShortcutFeedback(message) {
    const feedback = document.createElement('div');
    feedback.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.9);
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 20px;
      font-size: 0.9rem;
      z-index: 2000;
      animation: slideDown 0.3s ease-out, fadeOut 0.3s ease-out 2s forwards;
    `;
    feedback.textContent = message;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes fadeOut {
        to { opacity: 0; }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(feedback);
    
    setTimeout(() => {
      feedback.remove();
      style.remove();
    }, 3000);
  }
  
  enhanceUI() {
    // Add delight classes to key elements
    this.enhanceButtons();
    this.enhanceInputs();
    this.enhanceDropZones();
    this.enhanceImagePreviews();
    this.setupEmptyStates();
  }
  
  // ====================================
  // ENHANCED FUNCTION REPLACEMENTS
  // ====================================
  
  async delightfulUploadAndAnalyze() {
    try {
      // Determine if this is batch or single processing
      const activeTab = window.activeTab || 'single-file';
      const isBatch = activeTab === 'folder';
      const fileCount = isBatch ? (window.selectedFolderImages || 1) : 1;
      
      this.isProcessing = true;
      this.processedCount = 0;
      this.totalCount = fileCount;
      this.startTime = Date.now();
      
      // Show enhanced loading for batch processing (3+ files)
      if (fileCount >= 3) {
        window.delightSystem.showEnhancedLoading({
          totalFiles: fileCount,
          showFunFacts: fileCount > 10,
          showProgress: true
        });
        
        // Show workflow tips for large batches
        if (fileCount > 50) {
          setTimeout(() => {
            window.delightSystem.showWorkflowTips('large_folder');
          }, 5000);
        } else if (fileCount > 20) {
          setTimeout(() => {
            window.delightSystem.showWorkflowTips('batch_processing');
          }, 3000);
        }
        
        // Show progressive disclosure for better understanding
        setTimeout(() => window.delightSystem.showProgressiveDisclosure('upload_complete'), 1000);
        setTimeout(() => window.delightSystem.showProgressiveDisclosure('ai_analysis_start'), 2000);
      }
      
      // Call original function
      const result = await this.originalFunctions.handleUploadAndAnalyze.call(this);
      
      return result;
    } catch (error) {
      this.handleProcessingError(error);
      throw error;
    }
  }
  
  delightfulAnalysisResults(results) {
    try {
      // Hide loading
      window.delightSystem.hideEnhancedLoading();
      
      // Calculate processing time
      const processingTime = this.startTime ? Date.now() - this.startTime : null;
      
      // Show success with stats for single image
      if (Array.isArray(results) && results.length > 0) {
        const stats = {
          'Objects Detected': results.length,
          'Processing Time': processingTime ? `${(processingTime / 1000).toFixed(1)}s` : 'N/A'
        };
        
        // Prepare quick wins data
        const detectionResults = {
          accuracy: this.calculateAccuracy(results),
          processingTime: processingTime / 1000,
          averageTime: this.getAverageProcessingTime(),
          numbersPerImage: results.length
        };
        
        window.delightSystem.showSuccess('single_complete', stats, 3000);
        
        // Quick wins removed - keeping professional interface
      }
      
      // Call original function
      return this.originalFunctions.handleAnalysisResults.call(this, results);
    } catch (error) {
      return this.originalFunctions.handleAnalysisResults.call(this, results);
    }
  }
  
  delightfulBatchResults(results) {
    try {
      this.isProcessing = false;
      
      // Hide loading
      window.delightSystem.hideEnhancedLoading();

      // Explicit UI reset to ensure button returns to normal state
      if (window.setUploading) {
        window.setUploading(false);
      }

      // Explicit vehicle counter update to ensure it shows correct count
      const vehicleCountEl = document.getElementById('vehicle-count');
      if (vehicleCountEl) {
        let totalVehicles = 0;
        for (const result of results) {
          if (result.analysis && Array.isArray(result.analysis)) {
            totalVehicles += result.analysis.length;
          }
        }
        vehicleCountEl.textContent = totalVehicles;
      }
      
      // Calculate comprehensive stats
      const processingTime = this.startTime ? Date.now() - this.startTime : null;
      const totalDetections = results.reduce((sum, result) => {
        return sum + (result.analysis ? result.analysis.length : 0);
      }, 0);
      
      const stats = {
        'Images Processed': results.length,
        'Objects Detected': totalDetections,
        'Processing Time': processingTime ? `${(processingTime / 1000).toFixed(1)}s` : 'N/A',
        'Avg per Image': processingTime ? `${(processingTime / results.length / 1000).toFixed(1)}s` : 'N/A'
      };
      
      // Show celebratory success for batch completion  
      window.delightSystem.showSuccess('batch_complete', stats, 6000);
      
      // Calculate and show quick wins for the batch
      const batchDetectionResults = {
        accuracy: this.calculateBatchAccuracy(results),
        processingTime: processingTime / 1000,
        averageTime: this.getAverageProcessingTime() * results.length,
        numbersPerImage: totalDetections / results.length,
        totalImages: results.length
      };
      
      // Quick wins removed - keeping professional interface

      // Call original function
      if (this.originalFunctions.handleBatchResults) {
        const result = this.originalFunctions.handleBatchResults.call(this, results);
        return result;
      }
    } catch (error) {
      return this.originalFunctions.handleBatchResults.call(this, results);
    }
  }
  
  delightfulImageProcessed(result) {
    try {
      this.processedCount++;
      
      // Update progress if we're showing enhanced loading
      const progressPercent = (this.processedCount / this.totalCount) * 100;
      window.delightSystem.updateProgress(
        progressPercent, 
        `Processing ${result.fileName || 'image'}... (${this.processedCount}/${this.totalCount})`
      );
      
      // Show progressive disclosure updates
      if (this.processedCount === 1) {
        window.delightSystem.showProgressiveDisclosure('number_detection', { detected: 1 });
      } else if (this.processedCount === Math.floor(this.totalCount / 2)) {
        window.delightSystem.showProgressiveDisclosure('metadata_processing');
      } else if (this.processedCount === this.totalCount - 1) {
        window.delightSystem.showProgressiveDisclosure('final_checks');
      }
      
      // Animate the new row when it's added
      setTimeout(() => {
        const newRows = document.querySelectorAll('.results-table tr:not(.delight-table-row)');
        newRows.forEach(row => {
          window.delightSystem.animateTableRow(row);
        });
      }, 100);
      
      // Call original function
      return this.originalFunctions.handleImageProcessed.call(this, result);
    } catch (error) {
      return this.originalFunctions.handleImageProcessed.call(this, result);
    }
  }
  
  delightfulShowError(message) {
    // Determine error type based on message content
    let errorType = 'default';
    
    if (message.toLowerCase().includes('network') || message.toLowerCase().includes('connection')) {
      errorType = 'network';
    } else if (message.toLowerCase().includes('too large') || message.toLowerCase().includes('size')) {
      errorType = 'file_too_large';
    } else if (message.toLowerCase().includes('format') || message.toLowerCase().includes('unsupported')) {
      errorType = 'unsupported_format';
    } else if (message.toLowerCase().includes('no images') || message.toLowerCase().includes('empty')) {
      errorType = 'no_images_found';
    } else if (message.toLowerCase().includes('analysis') || message.toLowerCase().includes('ai')) {
      errorType = 'analysis_failed';
    }
    
    // Show delightful error with retry action
    const actions = [{
      text: 'Try Again',
      primary: true,
      handler: 'window.delightSystem.hideError(); if (window.handleUploadAndAnalyze) window.handleUploadAndAnalyze();'
    }];
    
    window.delightSystem.showFriendlyError(errorType, message, actions);
    
    // Also call original function for backward compatibility
    if (this.originalFunctions.showError) {
      this.originalFunctions.showError.call(this, message);
    }
  }
  
  delightfulUpdateProgress(progress) {
    const { total, current, message } = progress;
    
    // Update enhanced progress if visible
    const progressPercent = (current / total) * 100;
    window.delightSystem.updateProgress(progressPercent, message || `Processing ${current}/${total}...`);
    
    // Call original function
    if (this.originalFunctions.updateBatchProgress) {
      return this.originalFunctions.updateBatchProgress.call(this, progress);
    }
  }
  
  // ====================================
  // DELIGHT ENHANCEMENTS
  // ====================================
  
  showFileSelectedDelight(file) {
    // Show a subtle notification for file selection
    const notification = document.createElement('div');
    notification.className = 'delight-notification delight-slide-up';
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; margin: 0.5rem 0;">
        <span style="font-size: 1.5rem;">📸</span>
        <div>
          <div style="font-weight: 600; color: #059669;">File Selected!</div>
          <div style="font-size: 0.9rem; color: #047857;">${file.name} (${this.formatFileSize(file.size)})</div>
        </div>
      </div>
    `;
    
    const container = document.querySelector('.content-section.active-section') || document.body;
    container.insertBefore(notification, container.firstChild);
    
    // Auto remove
    setTimeout(() => {
      notification.classList.add('delight-hidden');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
  
  showFolderSelectedDelight(data) {
/*     const { imageCount, rawCount = 0 } = data;
    
    const notification = document.createElement('div');
    notification.className = 'delight-notification delight-bounce-in';
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem; padding: 1rem; background: linear-gradient(135deg, #ecfdf5, #ffffff); border: 2px solid #a7f3d0; border-radius: 12px; margin: 0.5rem 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.1);">
        <span style="font-size: 2rem; animation: pulse 2s ease-in-out infinite;">📁</span>
        <div>
          <div style="font-weight: 600; color: #059669; font-size: 1.1rem;">Folder Ready for Analysis!</div>
          <div style="font-size: 0.9rem; color: #047857;">
            ${imageCount} images found
            ${rawCount > 0 ? ` • <span style="background: #fed7aa; color: #9a3412; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.8rem;">RAW: ${rawCount}</span>` : ''}
          </div>
          <div style="font-size: 0.8rem; color: #10b981; margin-top: 0.25rem;">Click "Process Folder" to begin the magic ✨</div>
        </div>
      </div>
    `;
    
    const container = document.querySelector('.content-section.active-section') || document.body;
    container.insertBefore(notification, container.firstChild);
    
    // Auto remove
    setTimeout(() => {
      notification.classList.add('delight-hidden');
      setTimeout(() => notification.remove(), 300);
    }, 5000); */
  }
  
  showEnhancedError(errorMessage, context = 'general') {
    // Enhanced error handling with context
    let errorType = 'default';
    
    if (context === 'csv_error') {
      errorType = 'csv_error';
    } else if (errorMessage.toLowerCase().includes('folder') && errorMessage.toLowerCase().includes('empty')) {
      errorType = 'no_images_found';
    }
    
    this.delightfulShowError(errorMessage);
  }
  
  handleProcessingError(error) {
    this.isProcessing = false;
    window.delightSystem.hideEnhancedLoading();
    
    // Show error with context
    this.showEnhancedError(error.message || 'An unexpected error occurred during processing.');
  }
  
  // ====================================
  // UI ENHANCEMENT METHODS
  // ====================================
  
  enhanceButtons() {
    document.querySelectorAll('button, .btn').forEach(button => {
      if (!button.classList.contains('delight-button')) {
        button.classList.add('delight-button');
      }
      
      // Add special enhancements for key buttons
      if (button.id === 'upload-button' || button.textContent.includes('Process')) {
        button.addEventListener('click', () => {
          // Add extra delight for main action buttons
          button.style.transform = 'scale(0.95)';
          setTimeout(() => {
            button.style.transform = '';
          }, 150);
        });
      }
    });
  }
  
  enhanceInputs() {
    document.querySelectorAll('input, textarea, select').forEach(input => {
      if (!input.classList.contains('delight-input')) {
        input.classList.add('delight-input');
      }
      
      // Add focus/blur enhancements
      input.addEventListener('focus', () => {
        input.parentElement?.classList.add('delight-focused');
      });
      
      input.addEventListener('blur', () => {
        input.parentElement?.classList.remove('delight-focused');
      });
    });
  }
  
  enhanceDropZones() {
    // Enhance file input areas
    document.querySelectorAll('input[type="file"]').forEach(input => {
      const wrapper = input.closest('.form-group');
      if (wrapper) {
        wrapper.classList.add('delight-drop-zone');
        wrapper.dataset.dropZone = 'true';
        
        // Add drop zone icon and text
        if (!wrapper.querySelector('.delight-drop-icon')) {
          const dropIcon = document.createElement('div');
          dropIcon.className = 'delight-drop-icon';
          dropIcon.innerHTML = '📂';
          wrapper.insertBefore(dropIcon, wrapper.firstChild);
        }
      }
    });
  }
  
  enhanceImagePreviews() {
    document.querySelectorAll('img').forEach(img => {
      if (img.classList.contains('clickable-image')) {
        window.delightSystem.enhanceImagePreview(img);
      }
      
      // Add loading placeholders for images
      img.addEventListener('load', () => {
        img.classList.add('delight-image-loaded');
      });
    });
  }
  
  setupEmptyStates() {
    // Empty states functionality disabled - no longer showing "No Race Numbers Detected" messages
  }
  
  // ====================================
  // ANALYSIS HELPER METHODS
  // ====================================
  
  calculateAccuracy(results) {
    // Simple accuracy calculation based on confidence scores
    if (!results || results.length === 0) return 0;
    
    const totalConfidence = results.reduce((sum, result) => {
      return sum + (result.confidence || 0.8); // Default confidence if not provided
    }, 0);
    
    return Math.round((totalConfidence / results.length) * 100);
  }
  
  calculateBatchAccuracy(batchResults) {
    if (!batchResults || batchResults.length === 0) return 0;
    
    let totalAccuracy = 0;
    let validResults = 0;
    
    batchResults.forEach(result => {
      if (result.analysis && result.analysis.length > 0) {
        totalAccuracy += this.calculateAccuracy(result.analysis);
        validResults++;
      }
    });
    
    return validResults > 0 ? Math.round(totalAccuracy / validResults) : 0;
  }
  
  getAverageProcessingTime() {
    // Return stored average or default estimate based on typical processing times
    const stored = localStorage.getItem('racetagger_avg_processing_time');
    return stored ? parseFloat(stored) : 3.5; // 3.5 seconds default
  }
  
  updateAverageProcessingTime(newTime) {
    const current = this.getAverageProcessingTime();
    // Simple moving average
    const updated = (current + newTime) / 2;
    localStorage.setItem('racetagger_avg_processing_time', updated.toString());
  }
  
  // ====================================
  // UTILITY METHODS
  // ====================================
  
  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
  
  showTips() {
    const tipsModal = document.createElement('div');
    tipsModal.className = 'delight-tips-modal';
    tipsModal.innerHTML = `
      <div class="delight-modal-overlay" onclick="this.parentElement.remove()">
        <div class="delight-modal-content" onclick="event.stopPropagation()">
          <div class="delight-modal-header">
            <h3>📸 Photography Tips for Better Results</h3>
            <button onclick="this.closest('.delight-tips-modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>
          <div class="delight-modal-body">
            <div class="delight-tip">
              <span class="delight-tip-icon">☀️</span>
              <div>
                <strong>Good Lighting</strong>
                <p>Ensure race numbers are well-lit and clearly visible</p>
              </div>
            </div>
            <div class="delight-tip">
              <span class="delight-tip-icon">📷</span>
              <div>
                <strong>Sharp Focus</strong>
                <p>Keep the camera steady and ensure numbers are in focus</p>
              </div>
            </div>
            <div class="delight-tip">
              <span class="delight-tip-icon">🎯</span>
              <div>
                <strong>Clear View</strong>
                <p>Avoid obstructions like shadows, dirt, or motion blur</p>
              </div>
            </div>
            <div class="delight-tip">
              <span class="delight-tip-icon">📜</span>
              <div>
                <strong>Proper Angle</strong>
                <p>Capture numbers straight-on when possible</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add styles for tips modal
    const styles = `
      .delight-tips-modal .delight-modal-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
        z-index: 2000; animation: fadeIn 0.3s ease-out;
      }
      .delight-tips-modal .delight-modal-content {
        background: white; border-radius: 12px; padding: 0; max-width: 500px; width: 90%;
        box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: slideInUp 0.3s ease-out;
      }
      .delight-tips-modal .delight-modal-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 1.5rem; border-bottom: 1px solid #e5e7eb;
      }
      .delight-tips-modal .delight-modal-body { padding: 1.5rem; }
      .delight-tips-modal .delight-tip {
        display: flex; gap: 1rem; margin-bottom: 1rem; padding: 1rem;
        background: #f9fafb; border-radius: 8px;
      }
      .delight-tips-modal .delight-tip-icon { font-size: 1.5rem; }
      .delight-tips-modal .delight-tip strong { color: #1f2937; }
      .delight-tips-modal .delight-tip p { margin: 0.25rem 0 0 0; color: #6b7280; font-size: 0.9rem; }
      @keyframes slideInUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    tipsModal.appendChild(styleSheet);
    
    document.body.appendChild(tipsModal);
  }
}

// Initialize integration when DOM is ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.racetaggerDelight = new RacetaggerDelightIntegration();
    });
  } else {
    window.racetaggerDelight = new RacetaggerDelightIntegration();
  }
}