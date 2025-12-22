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
    // Token info modal handlers
    const buyTokensBtn = document.getElementById('buy-tokens-btn');
    const tokenInfoModal = document.getElementById('token-info-modal');
    const closeTokenInfoModal = document.getElementById('close-token-info-modal');
    const cancelTokenInfo = document.getElementById('cancel-token-info');
    const openPricingPageBtn = document.getElementById('open-pricing-page');

    if (buyTokensBtn) {
      buyTokensBtn.addEventListener('click', () => this.openTokenInfoModal());
    }

    if (closeTokenInfoModal) {
      closeTokenInfoModal.addEventListener('click', () => this.closeTokenInfoModal());
    }

    if (cancelTokenInfo) {
      cancelTokenInfo.addEventListener('click', () => this.closeTokenInfoModal());
    }

    if (openPricingPageBtn) {
      openPricingPageBtn.addEventListener('click', () => this.openPricingPage());
    }

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
        const modal = document.getElementById('token-info-modal');
        if (modal && modal.style.display === 'flex') {
          this.closeTokenInfoModal();
        }
      }
    });

    // Handle batch cancellation event from main process
    if (window.api && window.api.receive) {
      window.api.receive('batch-cancelled', (data) => {
        this.handleBatchCancelled();
      });
    }
  }

  openTokenInfoModal() {
    const modal = document.getElementById('token-info-modal');
    const tokenWidget = document.getElementById('token-balance-widget');

    // Add fuel gauge animation to token widget
    if (tokenWidget) {
      tokenWidget.classList.add('fuel-gauge-animation');
      setTimeout(() => tokenWidget.classList.remove('fuel-gauge-animation'), 800);
    }

    // Check if Early Bird period has ended (December 31, 2025)
    this.checkEarlyBirdStatus();

    // Add modal-open class to body to prevent background scrolling
    document.body.classList.add('modal-open');

    if (modal) {
      modal.style.display = 'flex';
    }
  }

  checkEarlyBirdStatus() {
    const earlyBirdDeadline = new Date('2025-12-31T23:59:59Z');
    const now = new Date();
    const urgencyBanner = document.querySelector('#token-info-modal .urgency-banner');
    const heroTitle = document.querySelector('#token-info-modal .pricing-hero h3');
    const heroSubtitle = document.querySelector('#token-info-modal .hero-subtitle');

    if (now > earlyBirdDeadline) {
      // Early Bird period has ended - hide urgency banner and update messaging
      if (urgencyBanner) {
        urgencyBanner.style.display = 'none';
      }

      // Update hero title and subtitle to remove Early Bird messaging
      if (heroTitle) {
        heroTitle.textContent = 'Get More Analyses';
      }

      if (heroSubtitle) {
        heroSubtitle.innerHTML = '<strong>Flexible Token Packs</strong> - Choose what fits your needs';
      }
    } else {
      // Early Bird is still active - ensure banner is visible
      if (urgencyBanner) {
        urgencyBanner.style.display = 'flex';
      }
    }
  }

  closeTokenInfoModal() {
    const modal = document.getElementById('token-info-modal');

    // Remove modal-open class to restore background scrolling
    document.body.classList.remove('modal-open');

    if (modal) {
      modal.style.display = 'none';
    }
  }

  openPricingPage() {
    // Open pricing page in default browser
    if (window.api && window.api.invoke) {
      window.api.invoke('open-external-url', 'https://www.racetagger.cloud/pricing')
        .then(result => {
          if (!result.success) {
            console.error('[Enhanced Processor] Failed to open pricing page:', result.error);
          }
        })
        .catch(error => {
          console.error('[Enhanced Processor] Error opening pricing page:', error);
        });
    } else {
      // Fallback for development
      window.open('https://www.racetagger.cloud/pricing', '_blank');
    }

    // Close modal after opening pricing page
    this.closeTokenInfoModal();
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

    // Check if processing is complete
    if (this.processingStats.completedImages + this.processingStats.failedImages >= this.processingStats.totalImages) {
      this.completeProcessing();
    }
  }

  completeProcessing() {
    // Hide progress container
    if (this.progressElements.container) {
      this.progressElements.container.classList.remove('active');
    }

  }


  cancelProcessing() {
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
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedProcessor;
}