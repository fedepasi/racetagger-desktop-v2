/**
 * Real-time Results Integration
 * Coordinates between the real-time results viewer and existing system
 */

class RealtimeIntegration {
  constructor() {
    this.isInitialized = false;
    this.processingStarted = false;
    this.init();
  }
  
  init() {
    // Wait for all components to be ready
    this.waitForComponents().then(() => {
      this.setupIntegration();
      this.isInitialized = true;
    });
  }
  
  async waitForComponents() {
    // Wait for real-time results viewer
    while (!window.realtimeResults) {
      await this.sleep(100);
    }
    
    // Wait for enhanced processor
    while (!window.enhancedProcessor) {
      await this.sleep(100);
    }
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  setupIntegration() {
    // Override the original batch progress handler
    this.setupBatchProgressIntegration();
    
    // Setup IPC event handlers
    this.setupIPCIntegration();
    
    // Setup UI coordination
    this.setupUICoordination();
    
    // Setup error handling
    this.setupErrorHandling();
  }
  
  setupBatchProgressIntegration() {
    // Store original handlers
    const originalUpdateBatchProgress = window.updateBatchProgress;
    const originalHandleBatchResults = window.handleBatchResults;
    
    // Override batch progress to feed real-time viewer
    window.updateBatchProgress = (progress) => {
      const { total, current, currentFile, previewDataUrl } = progress;
      
      // Call original handler for backward compatibility
      if (originalUpdateBatchProgress) {
        originalUpdateBatchProgress(progress);
      }
      
      // Update real-time viewer if processing has started
      if (this.processingStarted && window.realtimeResults) {
        // If we have file info, add it to the queue
        if (currentFile && currentFile.name) {
          const imageId = currentFile.path || currentFile.name;
          window.realtimeResults.addImageToQueue(
            imageId,
            currentFile.name,
            currentFile.path
          );
          
          // Mark as processing
          window.realtimeResults.updateImageProcessing(imageId, currentFile.name);
        }
      }
    };
    
    // Override batch complete handler
    window.handleBatchResults = (results) => {
      // Call original handler
      if (originalHandleBatchResults) {
        originalHandleBatchResults(results);
      }
      
      // Process any remaining results
      if (window.realtimeResults) {
        results.forEach(result => {
          const imageId = result.imageId || result.imagePath || result.fileName;
          
          // Ensure the image is in the viewer
          if (!window.realtimeResults.images.has(imageId)) {
            window.realtimeResults.addImageToQueue(imageId, result.fileName, result.imagePath);
          }
          
          // Complete the processing
          window.realtimeResults.completeImageProcessing({
            imageId: imageId,
            fileName: result.fileName,
            analysis: result.analysis,
            previewDataUrl: result.previewDataUrl,
            csvMatch: result.csvMatch,
            confidence: result.confidence || (result.analysis && result.analysis[0]?.confidence) || 0,
            error: result.error
          });
        });
      }
    };
  }
  
  setupIPCIntegration() {
    if (!window.api) return;
    
    // Listen for processing start
    window.api.receive('batch-processing-start', (data) => {
      this.processingStarted = true;

      if (window.realtimeResults) {
        window.realtimeResults.startProcessing(data.totalImages || data.imageCount || 0);
      }
    });
    
    // Listen for individual image processing events
    window.api.receive('image-processing-start', (data) => {
      if (window.realtimeResults) {
        const imageId = data.imageId || data.imagePath || data.filename;
        window.realtimeResults.addImageToQueue(imageId, data.filename, data.imagePath);
        window.realtimeResults.updateImageProcessing(imageId, data.filename);
      }
    });
    
    // Listen for processing cancellation
    window.api.receive('batch-processing-cancelled', () => {
      this.processingStarted = false;

      if (window.realtimeResults) {
        window.realtimeResults.isActive = false;
      }
    });
    
    // Listen for pipeline stats updates (includes hasRawFiles info)
    window.api.receive('pipeline-stats-update', (data) => {
      // Update telemetry visibility based on hasRawFiles
      if (typeof data.hasRawFiles !== 'undefined') {
        const rawConversionTelemetry = document.getElementById('raw-conversion-telemetry');
        if (rawConversionTelemetry) {
          if (data.hasRawFiles) {
            rawConversionTelemetry.style.display = 'block';
          } else {
            rawConversionTelemetry.style.display = 'none';
          }
        }
      }
      
      // Update pipeline stats if available
      if (data.filesByStage) {
        updatePipelineStats({
          totalFiles: data.totalFiles || 0,
          completedFiles: data.completedFiles || 0,
          failedFiles: data.failedFiles || 0,
          filesByStage: data.filesByStage,
          hasRawFiles: data.hasRawFiles
        });
      }
    });
    
    // Listen for processing errors
    window.api.receive('image-processing-error', (data) => {
      if (window.realtimeResults) {
        const imageId = data.imageId || data.imagePath || data.filename;
        window.realtimeResults.completeImageProcessing({
          imageId: imageId,
          fileName: data.filename,
          error: data.error,
          analysis: [],
          confidence: 0
        });
      }
    });
  }
  
  setupUICoordination() {
    // Monitor for folder selection to prepare real-time viewer
    const originalHandleFolderSelected = window.handleFolderSelected;
    
    window.handleFolderSelected = (data) => {
      // Call original handler
      if (originalHandleFolderSelected) {
        originalHandleFolderSelected(data);
      }
      
      // Reset real-time viewer state
      if (window.realtimeResults && data.success) {
        window.realtimeResults.reset();
      }
    };
    
    // Coordinate view switching
    this.setupViewCoordination();
  }
  
  setupViewCoordination() {
    // Add coordination between real-time results and original results
    const realtimeResultsContainer = document.getElementById('realtime-results-container');
    
    if (realtimeResultsContainer) {
      // Create view toggle in the main interface
      this.createViewToggle();
    }
  }
  
  createViewToggle() {
    // Find a good place to add the view toggle
    const analysisSection = document.getElementById('section-analysis');
    if (!analysisSection) return;
    
    const toggleHTML = `
      <div class="results-view-toggle" id="results-view-toggle" style="display: none;">
        <div class="toggle-container">
          <label class="toggle-label">Results View:</label>
          <div class="toggle-buttons">
            <button class="toggle-btn active" data-view="realtime">
              <span>🚀</span>
              <span>Real-time</span>
            </button>
            <button class="toggle-btn" data-view="final">
              <span>📊</span>
              <span>Final Results</span>
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Insert before results containers
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
      resultsContainer.insertAdjacentHTML('beforebegin', toggleHTML);
      
      // Add event listeners
      const toggleButtons = document.querySelectorAll('.toggle-btn');
      toggleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const view = btn.dataset.view;
          this.switchResultsView(view);
          
          // Update active state
          toggleButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }
  }
  
  switchResultsView(view) {
    const realtimeContainer = document.getElementById('realtime-results-container');
    const originalContainer = document.getElementById('results-container');
    
    if (view === 'realtime') {
      if (realtimeContainer) realtimeContainer.style.display = 'block';
      if (originalContainer) originalContainer.style.display = 'none';
    } else {
      if (realtimeContainer) realtimeContainer.style.display = 'none';
      if (originalContainer) originalContainer.style.display = 'block';
    }
  }
  
  setupErrorHandling() {
    // Global error handler for real-time processing
    window.addEventListener('error', (event) => {
      if (event.error && event.error.message.includes('realtime')) {
        console.error('[RealtimeIntegration] Real-time processing error:', event.error);
        
        // Show user-friendly error message
        this.showErrorNotification('An error occurred in real-time processing. Please refresh the page.');
      }
    });
    
    // Handle API connection issues
    if (window.api) {
      window.api.receive('connection-error', (error) => {
        console.error('[RealtimeIntegration] API connection error:', error);
        
        if (window.realtimeResults) {
          window.realtimeResults.isActive = false;
        }
        
        this.showErrorNotification('Connection lost. Real-time updates may be delayed.');
      });
    }
  }
  
  showErrorNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'error-notification realtime-error';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">⚠️</span>
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;
    
    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fee2e2;
      border: 1px solid #fecaca;
      color: #dc2626;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      z-index: 2000;
      max-width: 400px;
      animation: slideInRight 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 8000);
  }
  
  showViewToggle() {
    const toggle = document.getElementById('results-view-toggle');
    if (toggle) {
      toggle.style.display = 'block';
    }
  }
  
  hideViewToggle() {
    const toggle = document.getElementById('results-view-toggle');
    if (toggle) {
      toggle.style.display = 'none';
    }
  }
  
  // Public methods for external coordination
  startProcessing(totalImages) {
    this.processingStarted = true;
    this.showViewToggle();
    
    if (window.realtimeResults) {
      window.realtimeResults.startProcessing(totalImages);
      this.switchResultsView('realtime'); // Default to real-time view
    }
  }
  
  completeProcessing() {
    this.processingStarted = false;
    
    // Show final results view by default when complete
    setTimeout(() => {
      this.switchResultsView('final');
    }, 2000);
  }
  
  reset() {
    this.processingStarted = false;
    this.hideViewToggle();
    
    if (window.realtimeResults) {
      window.realtimeResults.hide();
    }
  }
}

// Add some basic styles for the view toggle
const toggleStyles = `
<style>
.results-view-toggle {
  margin: 16px 0;
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border: 1px solid #e2e8f0;
}

.toggle-container {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toggle-label {
  font-weight: 600;
  color: #374151;
}

.toggle-buttons {
  display: flex;
  background: #f8fafc;
  border-radius: 6px;
  padding: 2px;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  transition: all 0.15s ease;
}

.toggle-btn:hover {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.toggle-btn.active {
  background: white;
  color: #3b82f6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
`;

// Inject styles
document.head.insertAdjacentHTML('beforeend', toggleStyles);

// Initialize the integration when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize after a delay to ensure all other components are ready
  setTimeout(() => {
    if (!window.realtimeIntegration) {
      window.realtimeIntegration = new RealtimeIntegration();
    }
  }, 1000);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RealtimeIntegration;
}