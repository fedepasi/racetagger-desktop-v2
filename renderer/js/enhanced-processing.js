// Enhanced Processing and Token Management
// This module handles the advanced progress tracking and token request functionality

class EnhancedProcessor {
  constructor() {
    this.processingStats = {
      startTime: null,
      currentImageIndex: 0,
      totalImages: 0,
      completedImages: 0,
      failedImages: 0,
      detectedNumbers: 0,
      tokensUsed: 0
    };
    
    this.progressElements = {};
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Token request modal handlers
    const requestTokensBtn = document.getElementById('request-tokens-btn');
    const tokenRequestModal = document.getElementById('token-request-modal');
    const closeTokenModal = document.getElementById('close-token-modal');
    const cancelTokenRequest = document.getElementById('cancel-token-request');
    const tokenRequestForm = document.getElementById('token-request-form');
    const tokenSuggestions = document.querySelectorAll('.token-suggestion-btn');

    if (requestTokensBtn) {
      requestTokensBtn.addEventListener('click', () => this.openTokenRequestModal());
    }

    if (closeTokenModal) {
      closeTokenModal.addEventListener('click', () => this.closeTokenRequestModal());
    }

    if (cancelTokenRequest) {
      cancelTokenRequest.addEventListener('click', () => this.closeTokenRequestModal());
    }

    if (tokenRequestForm) {
      tokenRequestForm.addEventListener('submit', (e) => this.handleTokenRequestSubmit(e));
    }

    // Token suggestion buttons
    tokenSuggestions.forEach(btn => {
      btn.addEventListener('click', (e) => this.handleTokenSuggestion(e));
    });

    // Progress elements
    this.progressElements = {
      container: document.getElementById('progress-container'),
      currentImageNumber: document.getElementById('current-image-number'),
      totalImages: document.getElementById('total-images'),
      progressPercent: document.getElementById('progress-percent'),
      progressEta: document.getElementById('progress-eta-time'),
      progressFill: document.getElementById('progress-fill'),
      currentImageStatus: document.getElementById('current-image-status'),
      currentImageName: document.getElementById('current-image-name'),
      queuedCount: document.getElementById('queued-count'),
      processingCount: document.getElementById('processing-active-count'),
      completedCount: document.getElementById('completed-count'),
      failedCount: document.getElementById('failed-count'),
      cancelBtn: document.getElementById('cancel-processing-btn')
    };

    // Cancel processing handler
    if (this.progressElements.cancelBtn) {
      this.progressElements.cancelBtn.addEventListener('click', () => this.cancelProcessing());
    }

    // ESC key handler for modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('token-request-modal');
        if (modal && modal.style.display === 'flex') {
          this.closeTokenRequestModal();
        }
      }
    });

    // Handle batch cancellation event from main process
    if (window.api && window.api.receive) {
      window.api.receive('batch-cancelled', (data) => {
        console.log('[Enhanced Processor] Batch processing cancelled:', data);
        this.handleBatchCancelled();
      });
    }
  }

  openTokenRequestModal() {
    const modal = document.getElementById('token-request-modal');
    const emailInput = document.getElementById('request-email');
    const tokenWidget = document.getElementById('token-balance-widget');
    const messagesDiv = document.getElementById('token-request-messages');
    
    // Pre-fill email if user is logged in
    if (window.authUtils && window.authUtils.getCurrentUser) {
      const user = window.authUtils.getCurrentUser();
      if (user && user.email && emailInput) {
        emailInput.value = user.email;
      }
    }
    
    // Clear any existing messages
    if (messagesDiv) {
      messagesDiv.style.display = 'none';
      messagesDiv.textContent = '';
      messagesDiv.className = 'token-messages';
    }
    
    // Add fuel gauge animation to token widget
    if (tokenWidget) {
      tokenWidget.classList.add('fuel-gauge-animation');
      setTimeout(() => tokenWidget.classList.remove('fuel-gauge-animation'), 800);
    }
    
    // Add modal-open class to body to prevent background scrolling
    document.body.classList.add('modal-open');
    
    if (modal) {
      modal.style.display = 'flex';
      console.log('[Enhanced Processor] Token request modal opened with racing animations');
    }
  }

  closeTokenRequestModal() {
    const modal = document.getElementById('token-request-modal');
    const form = document.getElementById('token-request-form');
    const messagesDiv = document.getElementById('token-request-messages');
    
    // Remove modal-open class to restore background scrolling
    document.body.classList.remove('modal-open');
    
    if (modal) {
      modal.style.display = 'none';
    }
    
    if (form) {
      form.reset();
    }
    
    // Clear messages when closing
    if (messagesDiv) {
      messagesDiv.style.display = 'none';
      messagesDiv.textContent = '';
      messagesDiv.className = 'token-messages';
    }
    
    // Remove active state from suggestion buttons
    document.querySelectorAll('.token-suggestion-btn').forEach(btn => {
      btn.classList.remove('active');
    });
  }

  handleTokenSuggestion(e) {
    e.preventDefault();
    const tokensValue = e.target.dataset.tokens;
    const tokensInput = document.getElementById('request-tokens');
    
    // Remove active state from all buttons
    document.querySelectorAll('.token-suggestion-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active state to clicked button
    e.target.classList.add('active');
    
    if (tokensValue === 'custom') {
      if (tokensInput) {
        tokensInput.value = '';
        tokensInput.focus();
      }
    } else {
      if (tokensInput) {
        tokensInput.value = tokensValue;
      }
    }
  }

  async handleTokenRequestSubmit(e) {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submit-token-request');
    const originalText = submitBtn.textContent;
    
    try {
      submitBtn.textContent = 'Sending...';
      submitBtn.disabled = true;
      
      const formData = new FormData(e.target);
      const requestData = {
        email: document.getElementById('request-email').value,
        tokensRequested: document.getElementById('request-tokens').value,
        message: document.getElementById('request-message').value
      };
      
      console.log('[Enhanced Processor] Submitting token request:', requestData);
      
      const response = await window.api.invoke('submit-token-request', requestData);
      
      if (response.success) {
        // Show enhanced success message for Early Access
        const enhancedMessage = response.isEarlyAccessFree 
          ? `${response.message}\n🚀 Tokens will be added to your account automatically!`
          : response.message;
        
        this.showTokenRequestSuccess(enhancedMessage, response.isEarlyAccessFree);
        
        // If tokens were granted, refresh token balance after a short delay
        if (response.isEarlyAccessFree && response.tokensGranted > 0) {
          setTimeout(() => {
            if (window.authUtils && window.authUtils.updateTokenBalance) {
              window.authUtils.updateTokenBalance(); // Direct refresh
            }
          }, 1000);
        }
        
        // Close modal after delay to allow user to read the message
        setTimeout(() => {
          this.closeTokenRequestModal();
        }, 4000);
      } else {
        // Check if this is a payment required case (request saved but payment needed)
        if (response.requestSaved && response.paymentRequired) {
          // Show as info/warning instead of error
          this.showTokenRequestInfo(response.message, response.suggestion);
          // Close modal after delay to allow user to read the message
          setTimeout(() => {
            this.closeTokenRequestModal();
          }, 5000);
        } else {
          // Show as error for real errors
          this.showTokenRequestError(response.message);
          // Don't close modal for errors, let user close manually
        }
      }
      
    } catch (error) {
      console.error('[Enhanced Processor] Error submitting token request:', error);
      this.showTokenRequestError('Network error. Please check your connection and try again.');
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  }

  showTokenRequestSuccess(message) {
    const messagesDiv = document.getElementById('token-request-messages');
    if (messagesDiv) {
      messagesDiv.className = 'token-messages success';
      messagesDiv.innerHTML = `<div class="message-icon">✅</div><div class="message-text">${message}</div>`;
      messagesDiv.style.display = 'block';
    }
    
    // Add racing sound effect (visual)
    const tokenWidget = document.getElementById('token-balance-widget');
    if (tokenWidget) {
      tokenWidget.classList.add('pit-stop-animation');
      setTimeout(() => tokenWidget.classList.remove('pit-stop-animation'), 400);
    }
  }

  showTokenRequestInfo(message, suggestion = null) {
    const messagesDiv = document.getElementById('token-request-messages');
    if (messagesDiv) {
      messagesDiv.className = 'token-messages info';
      messagesDiv.innerHTML = `
        <div class="message-icon">⚠️</div>
        <div class="message-text">${message}</div>
        ${suggestion ? `<div class="message-suggestion">${suggestion}</div>` : ''}
      `;
      messagesDiv.style.display = 'block';
    }
  }

  showTokenRequestError(message) {
    const messagesDiv = document.getElementById('token-request-messages');
    if (messagesDiv) {
      messagesDiv.className = 'token-messages error';
      messagesDiv.innerHTML = `<div class="message-icon">❌</div><div class="message-text">${message}</div>`;
      messagesDiv.style.display = 'block';
    }
  }

  startProcessing(totalImages) {
    this.processingStats = {
      startTime: Date.now(),
      currentImageIndex: 0,
      totalImages: totalImages,
      completedImages: 0,
      failedImages: 0,
      detectedNumbers: 0,
      tokensUsed: 0,
      imageTimes: []
    };

    // Show progress container
    if (this.progressElements.container) {
      this.progressElements.container.classList.add('active');
    }

    // Initialize progress display
    this.updateProgress();
    
    console.log(`[Enhanced Processor] Started processing ${totalImages} images`);
  }

  updateProgress() {
    const stats = this.processingStats;
    const elements = this.progressElements;

    if (!elements.container) return;

    // Update counters
    if (elements.currentImageNumber) {
      elements.currentImageNumber.textContent = stats.currentImageIndex;
    }
    if (elements.totalImages) {
      elements.totalImages.textContent = stats.totalImages;
    }

    // Update percentage
    const percentage = stats.totalImages > 0 ? Math.round((stats.completedImages / stats.totalImages) * 100) : 0;
    if (elements.progressPercent) {
      elements.progressPercent.textContent = percentage;
    }
    if (elements.progressFill) {
      elements.progressFill.style.width = percentage + '%';
    }

    // Update ETA
    if (elements.progressEta && stats.completedImages > 0) {
      const elapsedTime = Date.now() - stats.startTime;
      const avgTimePerImage = elapsedTime / stats.completedImages;
      const remainingImages = stats.totalImages - stats.completedImages;
      const etaSeconds = Math.round((remainingImages * avgTimePerImage) / 1000);
      elements.progressEta.textContent = this.formatTime(etaSeconds);
    }

    // Update detail counts
    if (elements.queuedCount) {
      // Queued = remaining images not yet started
      const queuedImages = Math.max(0, stats.totalImages - stats.currentImageIndex);
      elements.queuedCount.textContent = queuedImages;
    }
    if (elements.processingCount) {
      // Processing = images started but not yet completed or failed
      const processingImages = Math.max(0, stats.currentImageIndex - stats.completedImages - stats.failedImages);
      elements.processingCount.textContent = processingImages;
    }
    if (elements.completedCount) {
      elements.completedCount.textContent = stats.completedImages;
    }
    if (elements.failedCount) {
      elements.failedCount.textContent = stats.failedImages;
    }
  }

  updateCurrentImage(imageName, status = '🔄') {
    this.processingStats.currentImageIndex++;
    
    if (this.progressElements.currentImageName) {
      this.progressElements.currentImageName.textContent = imageName;
    }
    if (this.progressElements.currentImageStatus) {
      this.progressElements.currentImageStatus.textContent = status;
    }
    
    this.updateProgress();
  }

  completeImage(imageName, hasDetection = false, processingTime = 0) {
    this.processingStats.completedImages++;
    this.processingStats.tokensUsed++;
    
    if (hasDetection) {
      this.processingStats.detectedNumbers++;
    }
    
    if (processingTime > 0) {
      this.processingStats.imageTimes.push(processingTime);
    }
    
    if (this.progressElements.currentImageStatus) {
      this.progressElements.currentImageStatus.textContent = hasDetection ? '✅' : '⚪';
    }
    
    this.updateProgress();
    
    // Check if processing is complete
    if (this.processingStats.completedImages + this.processingStats.failedImages >= this.processingStats.totalImages) {
      this.completeProcessing();
    }
  }

  failImage(imageName, error) {
    this.processingStats.failedImages++;
    
    if (this.progressElements.currentImageStatus) {
      this.progressElements.currentImageStatus.textContent = '❌';
    }
    
    this.updateProgress();
    
    console.error(`[Enhanced Processor] Failed to process ${imageName}:`, error);
    
    // Check if processing is complete
    if (this.processingStats.completedImages + this.processingStats.failedImages >= this.processingStats.totalImages) {
      this.completeProcessing();
    }
  }

  completeProcessing() {
    const stats = this.processingStats;
    const totalTime = Date.now() - stats.startTime;
    // Use real total time divided by completed images for accurate average in parallel processing
    const avgTime = stats.completedImages > 0 ? totalTime / stats.completedImages : 0;
    
    console.log('[Enhanced Processor] Processing complete:', {
      totalImages: stats.totalImages,
      completed: stats.completedImages,
      failed: stats.failedImages,
      detections: stats.detectedNumbers,
      tokensUsed: stats.tokensUsed,
      totalTime: totalTime,
      avgTime: avgTime
    });

    // Hide progress container
    if (this.progressElements.container) {
      this.progressElements.container.classList.remove('active');
    }

  }


  cancelProcessing() {
    console.log('[Enhanced Processor] User requested to cancel processing');

    // Disable cancel button to prevent multiple clicks
    if (this.progressElements.cancelBtn) {
      this.progressElements.cancelBtn.disabled = true;
      this.progressElements.cancelBtn.textContent = 'Cancelling...';
    }

    // Show cancellation message
    if (this.progressElements.currentImageName) {
      this.progressElements.currentImageName.textContent = 'Cancelling processing...';
    }

    if (this.progressElements.currentImageStatus) {
      this.progressElements.currentImageStatus.textContent = '🛑';
    }

    // Send cancel signal to main process
    if (window.api && window.api.send) {
      window.api.send('cancel-batch-processing');
    }

    // Don't hide container immediately - let the cancel process complete
    // Will be hidden when batch-cancelled event is received
  }

  handleBatchCancelled() {
    console.log('[Enhanced Processor] Handling batch cancellation');

    // Reset progress container and hide it
    if (this.progressElements.container) {
      this.progressElements.container.classList.remove('active');
      this.progressElements.container.style.display = 'none';
    }

    // Reset cancel button
    if (this.progressElements.cancelBtn) {
      this.progressElements.cancelBtn.disabled = false;
      this.progressElements.cancelBtn.textContent = 'Cancel';
    }

    // Reset processing state
    this.processingStats = {
      startTime: null,
      currentImageIndex: 0,
      totalImages: 0,
      completedImages: 0,
      failedImages: 0,
      detectedNumbers: 0,
      tokensUsed: 0
    };

    // Show upload button again
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton) {
      uploadButton.disabled = false;
      uploadButton.textContent = 'Analyze Folder';
    }

    console.log('[Enhanced Processor] Processing cancelled and UI reset');
  }

  formatTime(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}:${minutes.toString().padStart(2, '0')}:00`;
    }
  }

  // Unified method for batch progress from renderer.js
  updateBatchProgress(progress) {
    const { total, current, message, previewDataUrl, currentFile } = progress;

    // Update our internal stats
    this.processingStats.totalImages = total;
    this.processingStats.currentImageIndex = current;
    // Don't overwrite completedImages for batch progress - it's managed separately

    // Update current image display without incrementing currentImageIndex
    if (currentFile && this.progressElements.currentImageName) {
      this.progressElements.currentImageName.textContent = currentFile;
    }
    if (this.progressElements.currentImageStatus) {
      this.progressElements.currentImageStatus.textContent = '🔄';
    }

    // Update progress display
    this.updateProgress();

    // Update current image display (legacy)
    if (currentFile) {
      if (window.updateCurrentImageDisplay) {
        window.updateCurrentImageDisplay(currentFile, '🔄', previewDataUrl);
      }
    }

    // Update upload button text (compatibility with renderer.js)
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton) {
      uploadButton.textContent = `Processing: ${current}/${total} - ${message}`;
    }
  }

  // Unified method for handling processed images from renderer.js
  handleImageProcessed(result) {
    const hasNumbers = result.analysis && result.analysis.length > 0;
    const status = hasNumbers ? '✅' : '❌';

    // Update current image display
    if (window.updateCurrentImageDisplay) {
      window.updateCurrentImageDisplay(result.fileName, status, result.previewDataUrl);
    }

    // Complete the image (increment completed count)
    this.completeImage(result.fileName, hasNumbers);
  }

  // Method to manually update detail counts (for external usage)
  updateDetailCounts(queued, processing, completed, failed) {
    const elements = this.progressElements;

    if (elements.queuedCount) {
      elements.queuedCount.textContent = queued;
    }
    if (elements.processingCount) {
      elements.processingCount.textContent = processing;
    }
    if (elements.completedCount) {
      elements.completedCount.textContent = completed;
    }
    if (elements.failedCount) {
      elements.failedCount.textContent = failed;
    }
  }
}

// Initialize the enhanced processor when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.enhancedProcessor = new EnhancedProcessor();
  console.log('[Enhanced Processor] Initialized');
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedProcessor;
}