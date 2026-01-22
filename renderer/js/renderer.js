// DOM Elements
const uploadButton = document.getElementById('upload-button');
const errorMessage = document.getElementById('error-message');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
// OLD RESULTS CONTAINER REMOVED - USING STREAMING VIEW ONLY
// const /* OLD RESULTS CONTAINER REMOVED */ = document.getElementById('results-container');
// const /* OLD VEHICLE COUNT REMOVED */ = document.getElementById('vehicle-count');
// const /* OLD RESULTS LIST REMOVED */ = document.getElementById('results-list');

// Auto-scroll management
let autoScrollEnabled = true;
let resultsTableContainer = null;

// Metadata strategy elements
const metadataStrategyRadios = document.querySelectorAll('input[name="metadata-strategy"]');
const manualMetatagContainer = document.getElementById('manual-metatag-container');
const manualMetatagInput = document.getElementById('manual-metatag');

// Removed tab elements since we only support folder processing now

// Folder selection elements
const folderSelectButton = document.getElementById('folder-select-button');
const selectedFolder = document.getElementById('selected-folder');
const imageCount = document.getElementById('image-count');

// Advanced options elements
const advancedToggle = document.getElementById('advanced-toggle');
const advancedPanel = document.getElementById('advanced-panel');
const csvUpload = document.getElementById('csv-upload');
const downloadCsvTemplateBtn = document.getElementById('download-csv-template');
const csvInfo = document.getElementById('csv-info');
const csvFilename = document.getElementById('csv-filename');
const csvEntries = document.getElementById('csv-entries');

// Model selection elements
const modelSelect = document.getElementById('model-select');
const currentModelDisplay = document.getElementById('current-model-display');
// const usedModelDisplay = document.getElementById('used-model-display'); // Removed
const executionTimeDisplay = document.getElementById('execution-time-display');
const executionTimeValue = document.getElementById('execution-time-value');

// Category selection elements
const categorySelect = document.getElementById('category-select');
const currentCategoryDisplay = document.getElementById('current-category-display');

// State
let selectedFolderPath = null;
let selectedFolderImages = 0;
let csvData = null;
let uploading = false;
let processedImagesCount = 0;
let totalImagesCount = 0;
let csvLoaded = false; // Flag per tenere traccia se un CSV è stato caricato
let selectedModel = 'gemini-2.5-flash-lite-preview-06-17'; // Modello predefinito
let selectedCategory = 'motorsport'; // Categoria predefinita
window.selectedCategory = selectedCategory; // Expose globally for other modules
let analysisStartTime = null;
let analysisEndTime = null;

// Preset filtering cache
let cachedAllPresets = []; // All loaded presets (unfiltered)
let categoryCodeToIdMap = {}; // Map category code to ID for filtering

// No preset warning modal callback
let noPresetWarningCallback = null;

// Unified processor telemetry
let unifiedProcessingStats = {
  total: 0,
  processed: 0,
  processingTimes: [],
  isProcessing: false,
  startTime: null
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {

  // Initialize auth system if available
  if (window.authUtils) {
    window.authUtils.initialize();
  }

  // Initialize metadata overwrite options visibility
  initMetadataOverwriteOptions();

  // Initialize enhanced UX components integration
  initializeEnhancedUXIntegration();

  // Load dynamic categories from database
  // NOTE: Categories will be loaded after authentication in handleLoginResult()
  // or handleAuthStatus() to avoid race conditions with backend cache
  // loadDynamicCategories(); // Moved to post-auth

  // Gestione diretta del link alla pagina di test
  const testDashboardLink = document.querySelector('.nav-item[href="test-dashboard.html"]');
  if (testDashboardLink) {
    testDashboardLink.addEventListener('click', (e) => {
      window.location.href = 'test-dashboard.html';
    });
  }

  // Gestore per il pulsante diretto nella home
  const openTestDashboardBtn = document.getElementById('open-test-dashboard-btn');
  if (openTestDashboardBtn) {
    openTestDashboardBtn.addEventListener('click', (e) => {
      window.location.href = 'test-dashboard.html';
    });
  }

  // Event Listeners for folder processing
  // NOTE: These elements may be null if analysis page is loaded dynamically by router
  // The router handles binding these events when the analysis page loads
  if (uploadButton) {
    uploadButton.addEventListener('click', handleUploadAndAnalyze);
  }

  // Folder selection
  if (folderSelectButton) {
    folderSelectButton.addEventListener('click', handleFolderSelection);
  }

  // Advanced options
  if (advancedToggle) {
    advancedToggle.addEventListener('click', toggleAdvancedOptions);
  }
  if (csvUpload) {
    csvUpload.addEventListener('change', handleCsvUpload);
  }
  if (downloadCsvTemplateBtn) {
    downloadCsvTemplateBtn.addEventListener('click', handleDownloadCsvTemplate);
  }

  // Metadata strategy radios
  metadataStrategyRadios.forEach(radio => {
    radio.addEventListener('change', handleMetadataStrategyChange);
  });

  // Initialize metadata section styling
  initializeMetadataSection();

  // Model selection
  if (modelSelect) {
    modelSelect.addEventListener('change', handleModelSelection);
  }

  // Category selection
  if (categorySelect) {
    categorySelect.addEventListener('change', handleCategorySelection);
  }

  // Listen for messages from main process
  if (window.api) {
    // Analysis results
    window.api.receive('analysis-result', (results) => {
      handleAnalysisResults(results);
      setUploading(false);

      // Refresh categories after successful execution (in case scoring configs changed)
      setTimeout(() => {
        loadDynamicCategories(true);
      }, 2000); // Small delay to allow backend to process any updates
    });

    // Progress updates
    window.api.receive('upload-progress', (progress) => {
      updateProgress(progress);
    });

    // Error handling
    window.api.receive('upload-error', (error) => {
      showError(error);
      setUploading(false);
    });

    // Listen for category updates (if sent from backend)
    window.api.receive('categories-updated', () => {
      loadDynamicCategories(true);
    });

    // Folder selection response - now registered by router when analysis page loads
    // (moved to router.js initializePage('analysis') to avoid timing issues)

    window.api.receive('folder-error', (error) => {
      showError(error);
    });

    // CSV handling
    window.api.receive('csv-loaded', (data) => {
      handleCsvLoaded(data);
    });

    window.api.receive('csv-error', (error) => {
      showError(error);
    });

    window.api.receive('csv-template-saved', (filePath) => {
      showMessage(`CSV template saved to: ${filePath}`);
    });

    // Batch processing
    window.api.receive('batch-progress', (progress) => {
      updateBatchProgress(progress);
    });

    // Unified processor telemetry - simplified events
    window.api.receive('unified-processing-started', (data) => {
      startUnifiedTelemetry(data.totalFiles);

      // Initialize enhanced processor counters
      if (window.enhancedProcessor) {
        window.enhancedProcessor.startProcessing(data.totalFiles);
      }
    });

    window.api.receive('batch-complete', async (data) => {
      // Handle both old format (array) and new format (object with results and executionId)
      const results = Array.isArray(data) ? data : data.results;
      const executionId = Array.isArray(data) ? null : data.executionId;
      const isProcessingComplete = Array.isArray(data) ? true : (data.isProcessingComplete || false);

      // SICUREZZA: Redirect solo quando TUTTO il processing è completato
      if (!isProcessingComplete) {
        return;
      }

      // REDIRECT AUTOMATICO alla pagina risultati dedicata
      if (executionId && results.length > 0) {

        // Salva executionId in sessionStorage per la pagina risultati
        sessionStorage.setItem('currentExecutionId', executionId);
        sessionStorage.setItem('totalResults', results.length.toString());

        // Redirect alla pagina risultati
        window.location.href = `results.html?executionId=${encodeURIComponent(executionId)}`;
        return;
      }

      // Fallback: se non c'è executionId, continua con il comportamento originale

      // Initialize log visualizer if we have executionId
      if (executionId && window.logVisualizer) {
        try {
          await window.logVisualizer.init(executionId, results);

        } catch (error) {
          console.error('Error initializing log visualizer:', error);
          // Fallback to original behavior
          handleBatchResults(results);
        }
      } else {
        // Fallback to original behavior if no executionId or visualizer
        handleBatchResults(results);
      }

      completeUnifiedTelemetry();
      setUploading(false);

      // Refresh token balance after batch processing
      try {
        const tokenInfo = await window.api.invoke('get-token-info');
        if (window.updateTokenBalance && tokenInfo.balance) {
          window.updateTokenBalance(tokenInfo.balance);
        }
        if (window.updatePendingTokens && tokenInfo.pending) {
          window.updatePendingTokens(tokenInfo.pending);
        }
      } catch (error) {
        console.error('Error refreshing token balance:', error);
      }
    });

    // Old parallel processing statistics removed - using unified telemetry now

    // Real-time image processing updates
    window.api.receive('image-processed', (result) => {
      handleImageProcessed(result);
      updateUnifiedTelemetry(result);
    });

    // Legacy enhanced processing events removed - using unified processor events now

    // Temporal clustering progress events
    window.api.receive('temporal-analysis-started', (data) => {

      // Show progress bar container immediately
      const progressContainer = document.getElementById('progress-container');
      if (progressContainer) {
        progressContainer.classList.add('active');
      }

      // Update progress title
      const progressTitle = document.querySelector('.processing-title');
      if (progressTitle) {
        progressTitle.textContent = 'Analyzing Timestamps...';
      }

      // Update all progress elements
      const currentImageNumber = document.getElementById('current-image-number');
      const totalImages = document.getElementById('total-images');
      const progressPercent = document.getElementById('progress-percent');
      const currentImageName = document.getElementById('current-image-name');
      const currentImageStatus = document.getElementById('current-image-status');

      if (currentImageNumber) currentImageNumber.textContent = '0';
      if (totalImages) totalImages.textContent = data.totalImages;
      if (progressPercent) progressPercent.textContent = '0';
      if (currentImageName) currentImageName.textContent = 'Extracting timestamps from images...';
      if (currentImageStatus) currentImageStatus.textContent = '⏳';

      // Initialize progress bar
      const progressFill = document.getElementById('progress-fill');
      if (progressFill) {
        progressFill.style.width = '0%';
      }

      // Update telemetry counter
      const processingCount = document.getElementById('processing-count');
      if (processingCount) {
        processingCount.textContent = `Analyzing timestamps: 0/${data.totalImages}`;
      }
    });

    window.api.receive('temporal-batch-progress', (data) => {

      // Update enhanced processor with temporal analysis progress
      if (window.enhancedProcessor) {
        // Update current image display with temporal analysis info
        if (window.enhancedProcessor.progressElements.currentImageName) {
          window.enhancedProcessor.progressElements.currentImageName.textContent = `Analyzing timestamps: ${data.processed}/${data.total}`;
        }
        if (window.enhancedProcessor.progressElements.currentImageStatus) {
          window.enhancedProcessor.progressElements.currentImageStatus.textContent = '🧠';
        }
      }

      // Update progress bar
      const progressFill = document.getElementById('progress-fill');
      if (progressFill) {
        progressFill.style.width = `${data.progress}%`;
      }

      // Update progress percentage
      const progressPercent = document.getElementById('progress-percent');
      if (progressPercent) {
        progressPercent.textContent = Math.round(data.progress);
      }

      // Update current/total
      const currentImageNumber = document.getElementById('current-image-number');
      if (currentImageNumber) {
        currentImageNumber.textContent = data.processed;
      }

      // Update counter
      const processingCount = document.getElementById('processing-count');
      if (processingCount) {
        processingCount.textContent = `Analyzing timestamps: ${data.processed}/${data.total}`;
      }

      // Update current image name with batch info
      updateCurrentImageDisplay(`Processing batch ${data.currentBatch}/${data.totalBatches}...`, '🔄');
    });

    window.api.receive('temporal-analysis-complete', (data) => {

      // Update enhanced processor with temporal clustering results
      if (window.enhancedProcessor) {
        // Update current image display with clustering results
        if (window.enhancedProcessor.progressElements.currentImageName) {
          window.enhancedProcessor.progressElements.currentImageName.textContent = `Found ${data.totalClusters} temporal clusters`;
        }
        if (window.enhancedProcessor.progressElements.currentImageStatus) {
          window.enhancedProcessor.progressElements.currentImageStatus.textContent = '✅';
        }
      }

      // Legacy update for status
      const processingCount = document.getElementById('processing-count');
      if (processingCount) {
        processingCount.textContent = `Temporal clustering complete - ${data.totalClusters} clusters found`;
      }

      // Update current image name
      updateCurrentImageDisplay(`Found ${data.totalClusters} temporal clusters`, '✅');

      // Update status icon
      const currentImageStatus = document.getElementById('current-image-status');
      if (currentImageStatus) {
        currentImageStatus.textContent = '✅';
      }
    });

    // Recognition phase events
    window.api.receive('recognition-phase-started', (data) => {

      // Update progress title
      const progressTitle = document.querySelector('.processing-title');
      if (progressTitle) {
        progressTitle.textContent = 'Processing Images...';
      }

      // Reset for recognition phase
      const currentImageNumber = document.getElementById('current-image-number');
      const currentImageName = document.getElementById('current-image-name');
      const currentImageStatus = document.getElementById('current-image-status');
      const processingCount = document.getElementById('processing-count');

      if (currentImageNumber) currentImageNumber.textContent = '0';
      updateCurrentImageDisplay('Starting recognition...', '🔄');
      if (currentImageStatus) currentImageStatus.textContent = '🔍';
      if (processingCount) {
        processingCount.textContent = `Processing: 0/${data.totalImages}`;
      }

      // Reset progress bar for new phase
      const progressFill = document.getElementById('progress-fill');
      if (progressFill) {
        progressFill.style.width = '0%';
      }
      const progressPercent = document.getElementById('progress-percent');
      if (progressPercent) {
        progressPercent.textContent = '0';
      }
    });
  } else {
    showError('API not available. The preload script may not be working correctly.');
  }

  // Initialize UI
  updateUploadButtonState();

  // Setup image modal functionality
  setupImageModal();
});

// Enhanced UX Components Integration
function initializeEnhancedUXIntegration() {

  // Enable enhanced UI mode
  document.body.classList.add('enhanced-ui-active');

  // Setup integration between old and new systems
  setupResultsIntegration();
  setupProgressIntegration();
  setupPresetsIntegration();
}

// Simplified results integration - removed interceptors that interfere with unified telemetry
function setupResultsIntegration() {

  // Keep original results handling without modern results
  const originalHandleAnalysisResults = window.handleAnalysisResults;

  if (originalHandleAnalysisResults) {
    window.handleAnalysisResults = function(results) {

      // Call original function for backward compatibility
      originalHandleAnalysisResults.call(this, results);
    };
  }
}

// Integration with enhanced progress tracker
function setupProgressIntegration() {
  // Override original progress updates
  const originalUpdateBatchProgress = window.updateBatchProgress;

  window.updateBatchProgress = function(progress) {

    // Pass to enhanced progress if available
    if (window.enhancedProgress) {
      window.enhancedProgress.updateProgress({
        total: progress.total,
        processed: progress.current,
        phaseProgress: (progress.current / progress.total) * 100
      });

      if (progress.currentFile && progress.previewDataUrl) {
        window.enhancedProgress.setCurrentFile({
          filename: progress.currentFile.name,
          size: progress.currentFile.size,
          format: progress.currentFile.extension,
          thumbnail: progress.previewDataUrl
        });
      }
    }

    // Also call original function
    if (originalUpdateBatchProgress) {
      originalUpdateBatchProgress.call(this, progress);
    }
  };

  // Hook into upload and analyze to show enhanced progress
  const originalHandleUploadAndAnalyze = handleUploadAndAnalyze;

  window.handleUploadAndAnalyze = async function() {
    // Show enhanced progress
    if (window.enhancedProgress && selectedFolderImages > 3) {
      window.enhancedProgress.startProcessing({
        totalFiles: selectedFolderImages
      });
    }

    // Call original function
    return await originalHandleUploadAndAnalyze.call(this);
  };
}

// Integration with smart presets
function setupPresetsIntegration() {
  // The smart presets component automatically replaces the advanced options
  // and applies settings to the original form controls, so no additional integration needed
}

// Image Modal functionality
function setupImageModal() {
  const modal = document.getElementById('image-modal');
  const modalImage = document.getElementById('modal-image');
  const modalTitle = document.getElementById('modal-image-title');
  const closeBtn = document.getElementById('modal-close-btn');

  // Function to open modal with high-quality preview loading
  async function openImageModal(imageSrc, imageTitle, imagePath = null) {
    modalTitle.textContent = imageTitle || 'View Image';
    modal.style.display = 'block';
    modal.classList.add('show');

    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';

    // Start with the thumbnail while loading high-quality version
    modalImage.src = imageSrc;

    // If we have an imagePath, load the high-quality version asynchronously
    if (imagePath && window.api) {
      try {
        modalTitle.textContent = `${imageTitle} - Loading high-quality...`;

        // Check if IPC channel is available
        if (typeof window.api.invoke === 'function') {
          try {
            const halfsizeDataUrl = await window.api.invoke('get-halfsize-image', imagePath);

            if (halfsizeDataUrl) {
              modalImage.src = halfsizeDataUrl;
              modalTitle.textContent = imageTitle || 'View Image';
            } else {
              modalTitle.textContent = imageTitle || 'View Image';
            }
          } catch (ipcError) {
            // If IPC channel doesn't exist, fall back to existing thumbnail
            modalTitle.textContent = imageTitle || 'View Image';
          }
        } else {
          modalTitle.textContent = imageTitle || 'View Image';
        }
      } catch (error) {
        console.error('Error in halfsize preview loading:', error);
        modalTitle.textContent = imageTitle || 'View Image';
      }
    }
  }

  // Function to close modal
  function closeImageModal() {
    modal.style.display = 'none';
    modal.classList.remove('show');
    modalImage.src = '';

    // Restore body scroll
    document.body.style.overflow = '';
  }

  // Close modal on X button click
  closeBtn.addEventListener('click', closeImageModal);

  // Close modal on background click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeImageModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.style.display === 'block') {
      closeImageModal();
    }
  });

  // Event delegation for clickable images
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('clickable-image')) {
      const imageSrc = e.target.getAttribute('data-full-src') || e.target.src;
      const imageTitle = e.target.getAttribute('data-filename') || 'Image';
      const imagePath = e.target.getAttribute('data-image-path');
      openImageModal(imageSrc, `Visualizza: ${imageTitle}`, imagePath);
    }
  });
}

// Window controls
const windowClose = document.querySelector('.window-control.window-close');
const windowMinimize = document.querySelector('.window-control.window-minimize');
const windowMaximize = document.querySelector('.window-control.window-maximize');

// Sidebar elements
const sidebarNavItems = document.querySelectorAll('.nav-item');
const sidebarUserName = document.getElementById('sidebar-user-name');

// Tab switching removed since we only support folder processing now

// Toggle advanced options panel
function toggleAdvancedOptions() {
  if (advancedPanel.style.display === 'none' || !advancedPanel.style.display) {
    advancedPanel.style.display = 'block';
    advancedToggle.textContent = 'Hide Advanced Options';
  } else {
    advancedPanel.style.display = 'none';
    advancedToggle.textContent = 'Advanced Options';
  }
}

// Handle folder selection
function handleFolderSelection() {
  console.log('[Renderer] handleFolderSelection called');
  if (window.api) {
    console.log('[Renderer] Sending select-folder');
    window.api.send('select-folder');
  } else {
    console.error('[Renderer] window.api not available!');
  }
}

// Handle folder selected response
async function handleFolderSelected(data) {
  console.log('[Renderer] handleFolderSelected called with:', data);

  if (!data.success) {
    showError(data.message || 'Error during folder selection');
    return;
  }

  selectedFolderPath = data.path;
  selectedFolderImages = data.imageCount;
  const rawCount = data.rawCount || 0;

  // Get elements dynamically (they may be created by router after page load)
  const selectedFolderEl = document.getElementById('selected-folder');
  const imageCountEl = document.getElementById('image-count');

  console.log('[Renderer] Found elements:', { selectedFolderEl, imageCountEl });

  if (selectedFolderEl) {
    selectedFolderEl.textContent = selectedFolderPath;
  }

  // Mostra il numero di immagini trovate con badge per RAW
  if (imageCountEl) {
    if (rawCount > 0) {
      imageCountEl.innerHTML = `${selectedFolderImages} images found
        <span class="file-type-badge raw">RAW: ${rawCount}</span>
        <span class="file-type-badge jpeg">JPEG: ${selectedFolderImages - rawCount}</span>`;
    } else {
      imageCountEl.textContent = `${selectedFolderImages} images found`;
    }
  }

  // Check Adobe DNG Converter if RAW files are present
  if (rawCount > 0) {
    try {
      const dngCheck = await window.api.invoke('check-adobe-dng-converter');

      if (dngCheck.required && !dngCheck.installed) {
        showAdobeDngModal();
        return; // Block further processing until user decides
      }
    } catch (error) {
      console.error('Error checking Adobe DNG Converter:', error);
      // Continue processing even if check failed
    }
  }


  updateUploadButtonState();
}

// Adobe DNG Converter modal management functions
function showAdobeDngModal() {
  const modal = document.getElementById('adobe-dng-modal');
  if (modal) {
    modal.style.display = 'flex';
    // Trigger animation
    setTimeout(() => {
      modal.classList.add('show');
    }, 10);
  }
}

function closeAdobeDngModal() {
  const modal = document.getElementById('adobe-dng-modal');
  if (modal) {
    modal.classList.remove('show');
    // Hide after animation completes
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }

  // Clear the folder selection since user cancelled
  const folderPath = document.getElementById('folder-path');
  const folderDisplay = document.getElementById('folder-display');
  const analyzeButton = document.getElementById('analyze-button');

  if (folderPath) folderPath.textContent = '';
  if (folderDisplay) folderDisplay.style.display = 'none';
  if (analyzeButton) analyzeButton.disabled = true;

  // Reset global state
  selectedFolderPath = null;
  selectedFiles = [];
}

function continueWithoutDng() {
  const modal = document.getElementById('adobe-dng-modal');
  if (modal) {
    modal.classList.remove('show');
    // Hide after animation completes
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }

  // Continue with the folder processing but skip RAW files
  // The folder selection should already be set, just need to enable the analyze button
  const analyzeButton = document.getElementById('analyze-button');
  if (analyzeButton) {
    analyzeButton.disabled = false;
  }

  // Show a brief notification that RAW files will be skipped
  showNotification('RAW files will be skipped during analysis', 'warning', 3000);
}

// Handle metadata strategy change
function handleMetadataStrategyChange(event) {
  const selectedStrategy = event.target.value;

  // Update radio option styling for visual feedback
  metadataStrategyRadios.forEach(radio => {
    const radioOption = radio.closest('.radio-option');
    if (radioOption) {
      if (radio.checked) {
        radioOption.classList.add('selected');
      } else {
        radioOption.classList.remove('selected');
      }
    }
  });

  // Mostra/nascondi l'input per il metatag manuale con animazione
  if (selectedStrategy === 'manual') {
    manualMetatagContainer.style.display = 'block';
    // Trigger reflow for animation
    manualMetatagContainer.offsetHeight;
    manualMetatagContainer.style.opacity = '1';
    manualMetatagContainer.style.transform = 'translateY(0)';
  } else {
    manualMetatagContainer.style.opacity = '0';
    manualMetatagContainer.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      manualMetatagContainer.style.display = 'none';
    }, 150);
  }
}

// Initialize metadata section styling on page load
function initializeMetadataSection() {
  // Set initial selected state for checked radio button
  metadataStrategyRadios.forEach(radio => {
    const radioOption = radio.closest('.radio-option');
    if (radioOption) {
      if (radio.checked) {
        radioOption.classList.add('selected');
        // If manual strategy is selected by default, show the input
        if (radio.value === 'manual') {
          manualMetatagContainer.style.display = 'block';
          manualMetatagContainer.style.opacity = '1';
          manualMetatagContainer.style.transform = 'translateY(0)';
        }
      } else {
        radioOption.classList.remove('selected');
      }
    }
  });
}

// Handle model selection change
function handleModelSelection(event) {
  selectedModel = event.target.value;

  // Update the current model display
  const modelNames = {
    'gemini-2.5-flash-lite-preview-06-17': 'FAST',
    'gemini-2.5-flash-preview-04-17': 'BALANCED',
    'gemini-2.5-pro-preview-05-06': 'ADVANCED'
  };

  currentModelDisplay.textContent = modelNames[selectedModel] || selectedModel;

  // Update mode documentation visibility
  const modeDetails = document.getElementById('mode-details');
  if (modeDetails) {
    const allModes = modeDetails.querySelectorAll('.mode-fast, .mode-balanced, .mode-precision');
    allModes.forEach(mode => mode.style.display = 'none');

    const currentMode = selectedModel.includes('lite') ? 'fast' :
                       selectedModel.includes('flash') ? 'balanced' : 'precision';
    const activeMode = modeDetails.querySelector(`.mode-${currentMode}`);
    if (activeMode) activeMode.style.display = 'block';
  }
}

// Handle category selection
function handleCategorySelection(event) {
  selectedCategory = event.target.value;
  window.selectedCategory = selectedCategory; // Expose globally for other modules

  // Update the current category display (get element dynamically for SPA compatibility)
  const categoryNames = {
    'motorsport': 'Motorsport',
    'running': 'Running & Cycling',
    'other': 'Other'
  };

  const display = document.getElementById('current-category-display');
  if (display) {
    display.textContent = categoryNames[selectedCategory] || selectedCategory;
  }

  console.log('[Renderer] Category changed to:', selectedCategory);

  // Re-filter presets based on the new category
  if (cachedAllPresets.length > 0) {
    filterAndDisplayPresets();
  }
}

// Expose for router binding
window.handleCategorySelection = handleCategorySelection;

// Handle CSV file upload
function handleCsvUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
    showError('Please select a valid CSV file.');
    csvUpload.value = '';
    return;
  }

  // Read the CSV file and send to main process
  const reader = new FileReader();
  reader.onload = function(event) {
    const fileData = {
      buffer: event.target.result,
      name: file.name,
      standalone: true // Use standalone function for CSV loading
    };

    window.api.send('load-csv', fileData);
  };

  reader.onerror = function(error) {
    showError('Error reading CSV file: ' + error);
  };

  reader.readAsArrayBuffer(file);
}

// Handle CSV loaded response
function handleCsvLoaded(data) {
  csvData = {
    filename: data.filename,
    entries: data.entries
  };

  csvFilename.textContent = `File: ${data.filename}`;
  csvEntries.textContent = `Entries: ${data.entries}`;
  csvInfo.style.display = 'block';

  // Imposta la variabile csvLoaded a true
  csvLoaded = true;
}

// Handle CSV template download
function handleDownloadCsvTemplate() {
  if (window.api) {
    window.api.send('download-csv-template');
  }
}

// Update batch progress
function updateBatchProgress(progress) {
  const { total, current, message, previewDataUrl, currentFile } = progress;
  totalImagesCount = total;
  processedImagesCount = current;

  const percentage = Math.round((current / total) * 100);

  // Use enhanced processor if available, fallback to original method
  if (window.enhancedProcessor) {
    window.enhancedProcessor.updateBatchProgress(progress);
  } else {
    // Fallback for compatibility
    updateProgress(percentage);
    uploadButton.textContent = `Processing: ${current}/${total} - ${message}`;
  }
}

// Handle real-time image processing updates (enhanced integration)
async function handleImageProcessed(result) {

  // Use enhanced processor if available, fallback to original method
  if (window.enhancedProcessor) {
    window.enhancedProcessor.handleImageProcessed(result);
  } else {
    // Fallback: Update current image display with preview
    const status = result.analysis && result.analysis.length > 0 ? '✅' : '❌';
    updateCurrentImageDisplay(result.fileName, status, result.previewDataUrl);
  }

  // Usa sempre la streaming view (nuova grafica unificata)
  if (window.streamingView && window.streamingView.isActive) {

    // Aggiorna immagine corrente
    window.streamingView.updateCurrentImage(result.fileName, result.previewDataUrl);

    // Aggiungi risultato al buffer streaming
    window.streamingView.addResult(result);
  }
}

// OLD RESULTS TABLE FUNCTIONS REMOVED - USING STREAMING VIEW ONLY
/*
function initializeResultsTable() {
  // This function is no longer needed - we use streaming view for all batches
  return null;
}
*/

// Initialize auto-scroll functionality
function initAutoScroll() {
  resultsTableContainer = document.getElementById('results-list');
  if (!resultsTableContainer || resultsTableContainer.dataset.autoScrollInitialized) return;

  resultsTableContainer.dataset.autoScrollInitialized = 'true';

  resultsTableContainer.addEventListener('scroll', () => {
    const scrollTop = resultsTableContainer.scrollTop;
    const scrollHeight = resultsTableContainer.scrollHeight;
    const clientHeight = resultsTableContainer.clientHeight;

    // Se l'utente è vicino al fondo (entro 50px), riabilita auto-scroll
    if (scrollHeight - scrollTop - clientHeight < 50) {
      if (!autoScrollEnabled) {
        autoScrollEnabled = true;
        resultsTableContainer.classList.remove('auto-scroll-paused');
      }
    } else {
      // L'utente ha scrollato verso l'alto, disabilita auto-scroll
      if (autoScrollEnabled) {
        autoScrollEnabled = false;
        resultsTableContainer.classList.add('auto-scroll-paused');
      }
    }
  });
}

// Esegue l'auto-scroll se abilitato
function performAutoScroll() {
  if (autoScrollEnabled && resultsTableContainer) {
    resultsTableContainer.scrollTop = resultsTableContainer.scrollHeight;
  }
}

// Display an image result as a table row
async function displayImageCard(imageResult) {

  let { fileName, analysis, previewDataUrl, csvMatch, metatagApplied, imagePath } = imageResult;

  // Check for duplicates FIRST before doing any work
  let existingTableBody = document.getElementById('results-table')?.querySelector('tbody');
  if (existingTableBody) {
    const existingRows = Array.from(existingTableBody.querySelectorAll('tr'));
    const imageResultId = imageResult.imageId || imageResult.imagePath || imageResult.fileName;

    const alreadyDisplayed = existingRows.some(row => {
      const rowId = row.dataset.imageId;
      return rowId === imageResultId ||
             (imageResult.imagePath && rowId === imageResult.imagePath) ||
             (imageResult.fileName && rowId === imageResult.fileName);
    });

    if (alreadyDisplayed) {
      return; // Exit early to prevent duplicate
    }
  }

  // If no previewDataUrl but we have imagePath, load the local image
  if (!previewDataUrl && imagePath && window.api) {
    try {
      previewDataUrl = await window.api.invoke('get-local-image', imagePath);
      if (!previewDataUrl) {

        // Fallback: try to get Supabase URL for already processed images (especially RAW files)
        try {
          const supabaseUrl = await window.api.invoke('get-supabase-image-url', fileName);
          if (supabaseUrl) {
            previewDataUrl = supabaseUrl;
          }
        } catch (supabaseError) {
          console.error('Error getting Supabase URL:', supabaseError);
        }
      }
    } catch (error) {
      console.error('Error loading local image:', error);
    }
  }

  // Get table body or initialize table if it doesn't exist
  let tableBody = document.getElementById('results-table')?.querySelector('tbody');
  if (!tableBody) {
    tableBody = initializeResultsTable();
  }

  // Create a row for this image
  const row = document.createElement('tr');
  // Use image ID if available, otherwise use path or filename
  row.dataset.imageId = imageResult.imageId || imageResult.imagePath || fileName;

  // Extract the first vehicle data (or set to null if no vehicles detected)
  const firstVehicle = analysis && analysis.length > 0 ? analysis[0] : null;

  // Image preview cell with click handler for modal
  let imageCell = '';
  if (previewDataUrl) {
    imageCell = `<img src="${previewDataUrl}" alt="${fileName}" class="clickable-image" data-full-src="${previewDataUrl}" data-filename="${fileName}" data-image-path="${imagePath || ''}" />`;
  } else if (imagePath) {
    imageCell = `<div class="image-placeholder" title="Image: ${fileName}">📷 ${fileName}</div>`;
  } else {
    imageCell = `<div class="image-placeholder">No image</div>`;
  }

  // CSV match cell
  let csvMatchHTML = '';
  if (csvMatch) {
    csvMatchHTML = `
      <div class="csv-match-found">
        <strong>Match trovato!</strong><br>
        Tipo: ${csvMatch.matchType === 'raceNumber' ? 'Numero di gara' : 'Nome pilota'}<br>
        Valore: ${csvMatch.matchedValue}
      </div>
    `;
  } else {
    csvMatchHTML = `
      <div class="csv-match-not-found">Match non trovato</div>
    `;
  }

  // Extract confidence value from analysis (if available)
  let confidenceScore = null;
  if (firstVehicle) {
    confidenceScore = firstVehicle.confidence || null;
  }

  // Create feedback cell content
  const feedbackCellContent = `
    <div class="feedback-options">
      <button class="feedback-btn feedback-correct" title="Corretto">
        <span class="feedback-icon">👍</span>
      </button>
      <button class="feedback-btn feedback-incorrect" title="Non corretto">
        <span class="feedback-icon">👎</span>
      </button>
    </div>
    <div class="feedback-status"></div>
  `;

  // Build the row HTML with all cells
  let rowHTML = `
    <td class="image-cell">${imageCell}</td>
    <td>${fileName}</td>
    <td>${firstVehicle?.raceNumber || 'N/A'}</td>
    <td>${firstVehicle?.drivers && firstVehicle.drivers.length > 0 ? firstVehicle.drivers.join(', ') : 'N/A'}</td>
    <td>${firstVehicle?.otherText && firstVehicle.otherText.length > 0 ? firstVehicle.otherText.join(', ') : 'N/A'}</td>
    <td>${firstVehicle?.teamName || 'N/A'}</td>`;

  // Aggiungi la cella CSV match solo se un CSV è stato caricato
  if (csvLoaded) {
    rowHTML += `<td class="csv-match-cell">${csvMatchHTML}</td>`;
  }

  rowHTML += `<td class="feedback-cell">${feedbackCellContent}</td>`;

  row.innerHTML = rowHTML;

  // Add event listeners for feedback buttons
  const correctBtn = row.querySelector('.feedback-correct');
  const incorrectBtn = row.querySelector('.feedback-incorrect');
  const feedbackStatus = row.querySelector('.feedback-status');

  correctBtn.addEventListener('click', function() {
    submitImageFeedback('correct', confidenceScore);
  });

  incorrectBtn.addEventListener('click', function() {
    submitImageFeedback('incorrect', confidenceScore);
  });

  // Function to submit feedback
  function submitImageFeedback(feedbackType, confidenceScore) {
    if (window.api) {
      window.api.send('submit-feedback', {
        imageId: row.dataset.imageId,
        feedbackType: feedbackType,
        confidenceScore: confidenceScore,
        source: 'desktop'
      });

      // Disable buttons after sending
      correctBtn.disabled = true;
      incorrectBtn.disabled = true;

      // Update status
      feedbackStatus.textContent = 'Grazie!';
      feedbackStatus.className = 'feedback-status success';

      // Highlight selected button
      if (feedbackType === 'correct') {
        correctBtn.classList.add('selected');
        incorrectBtn.classList.add('disabled');
      } else {
        incorrectBtn.classList.add('selected');
        correctBtn.classList.add('disabled');
      }
    }
  }

  // Add the row to the table body
  tableBody.appendChild(row);

  // Perform auto-scroll to keep the latest results visible
  performAutoScroll();

  // Set up feedback confirmation listeners
  window.api.receive('feedback-saved', (result) => {
    if (result.success) {
      feedbackStatus.textContent = 'Salvato!';
      feedbackStatus.className = 'feedback-status success';
    }
  });

  window.api.receive('feedback-error', (error) => {
    feedbackStatus.textContent = `Error!`;
    feedbackStatus.className = 'feedback-status error';

    // Re-enable buttons in case of error
    correctBtn.disabled = false;
    incorrectBtn.disabled = false;
  });
}

// Handle batch processing results (enhanced integration)
async function handleBatchResults(results) {

  // Note: This function is now intercepted by enhanced UX integration

  // End timing and display execution time
  if (analysisStartTime) {
    analysisEndTime = Date.now();
    const executionTime = analysisEndTime - analysisStartTime;
    const seconds = (executionTime / 1000).toFixed(2);
    if (executionTimeValue) {
      executionTimeValue.textContent = `${seconds}s`;
    }
    if (executionTimeDisplay) {
      executionTimeDisplay.style.display = 'block';
    }
  }

  // Preview functionality removed since we only support batch processing
  // Enhanced progress tracking is handled by the EnhancedProcessor instead

  if (!Array.isArray(results) || results.length === 0) {
    showError('No results from batch processing.');
    return;
  }

  // Count total vehicles detected
  let totalVehicles = 0;
  for (const result of results) {
    if (result.analysis && Array.isArray(result.analysis)) {
      totalVehicles += result.analysis.length;
    }
  }

  // OLD CODE: Update the vehicle count - REMOVED FOR STREAMING VIEW
  // vehicleCount.textContent = totalVehicles;

  // REMOVED: No longer adding rows here to prevent duplicates
  // All rows are added in real-time via handleImageProcessed()

  // OLD CODE: Show results container - REMOVED FOR STREAMING VIEW
  // resultsContainer.style.display = 'block';
  // resultsContainer.style.visibility = 'visible';
  // resultsContainer.style.opacity = '1';

  // No longer showing 'no results' message
}

// Show a success/info message
function showMessage(message) {
  const msgElement = document.createElement('div');
  msgElement.className = 'success-message';
  msgElement.textContent = message;

  errorMessage.parentNode.insertBefore(msgElement, errorMessage);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    msgElement.remove();
  }, 5000);
}

// File selection handler removed since we only support folder processing now

// Update upload button state based on folder selection
function updateUploadButtonState() {
  // Get button dynamically (may be created by router)
  const uploadBtn = document.getElementById('upload-button');
  if (!uploadBtn) return;

  if (uploading) {
    uploadBtn.disabled = true;
    return;
  }

  if (selectedFolderPath && selectedFolderImages > 0) {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Analyze Folder';
  } else {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Analyze Folder';
  }
}

// Upload and analyze handler
async function handleUploadAndAnalyze() {
  resetResults();

  // Reset processed image counters
  processedImagesCount = 0;
  totalImagesCount = 0;

  // Start timing
  analysisStartTime = Date.now();
  analysisEndTime = null;

  // Update used model display
  const modelNames = {
    'gemini-2.5-flash-lite-preview-06-17': 'FAST',
    'gemini-2.5-flash-preview-04-17': 'BALANCED',
    'gemini-2.5-pro-preview-05-06': 'ADVANCED'
  };
  // usedModelDisplay.textContent = modelNames[selectedModel] || selectedModel; // Removed

  // Verify token balance if auth system is available
  if (window.authUtils && !window.authUtils.checkTokenBalance(1)) {
    return; // Message will be shown by checkTokenBalance
  }

  // Folder processing only
  if (!selectedFolderPath || selectedFolderImages <= 0) {
    showError('Please select a folder with images first.');
    return;
  }

  handleFolderAnalysis();
}

// ==================== No Preset Warning Modal ====================

/**
 * Show warning modal when starting analysis without a participant preset
 */
function showNoPresetWarning() {
  const modal = document.getElementById('no-preset-warning-modal');
  if (modal) {
    modal.classList.add('show');
    const checkbox = document.getElementById('no-preset-dont-show-again');
    if (checkbox) checkbox.checked = false;
  }
}

/**
 * Close warning modal and cancel analysis
 */
function closeNoPresetWarning() {
  const modal = document.getElementById('no-preset-warning-modal');
  if (modal) {
    modal.classList.remove('show');
  }
  if (noPresetWarningCallback) {
    noPresetWarningCallback(false);
  }
}

/**
 * Continue with analysis despite no preset
 */
function continueWithoutPreset() {
  // Save preference if checkbox is checked
  const checkbox = document.getElementById('no-preset-dont-show-again');
  if (checkbox && checkbox.checked) {
    localStorage.setItem('racetagger-no-preset-warning-dismissed', 'true');
  }

  // Close modal
  const modal = document.getElementById('no-preset-warning-modal');
  if (modal) {
    modal.classList.remove('show');
  }

  // Continue with analysis
  if (noPresetWarningCallback) {
    noPresetWarningCallback(true);
  }
}

/**
 * Open the preset creation guide in external browser
 */
function openPresetGuide() {
  window.api.invoke('open-external-url', 'https://www.racetagger.cloud/blog/3-CSV-Starting-Lists-for-Race-Photography');
}

// Handle folder analysis
async function handleFolderAnalysis() {
  // Check if participant preset is selected - show warning if not
  const hasPreset = window.enhancedFileBrowser?.selectedPreset?.id;
  const dontShowWarning = localStorage.getItem('racetagger-no-preset-warning-dismissed') === 'true';

  console.log('[Analysis] handleFolderAnalysis - hasPreset:', hasPreset, 'selectedPreset:', window.enhancedFileBrowser?.selectedPreset, 'dontShowWarning:', dontShowWarning);

  if (!hasPreset && !dontShowWarning) {
    // Show warning modal and wait for user decision
    return new Promise((resolve) => {
      noPresetWarningCallback = (shouldContinue) => {
        noPresetWarningCallback = null;
        if (shouldContinue) {
          // Continue with analysis
          proceedWithFolderAnalysis();
        }
        resolve();
      };
      showNoPresetWarning();
    });
  }

  // Normal flow - proceed with analysis
  return proceedWithFolderAnalysis();
}

// Actual folder analysis logic (extracted from handleFolderAnalysis)
async function proceedWithFolderAnalysis() {

  // OLD CODE: Show results container - REMOVED FOR STREAMING VIEW
  // resultsContainer.style.display = 'block';
  // resultsContainer.style.visibility = 'visible';
  // resultsContainer.style.opacity = '1';

  // Initialize telemetry immediately with folder count to avoid 0/0 display
  if (selectedFolderImages > 0) {
    startUnifiedTelemetry(selectedFolderImages);
    // Force immediate display update to show 0/6 instead of 0/0
    updateUnifiedTelemetryDisplay();
  }

  // Pre-validation: Check token balance
  try {
    const tokenBalance = await window.api.invoke('get-token-balance');

    if (tokenBalance < selectedFolderImages) {
      const shortfall = selectedFolderImages - tokenBalance;

      // Reset any processing state that might have been set
      setUploading(false);
      resetUI();

      // Show a prominent modal instead of just an error message
      const message = `🚫 **Insufficient Tokens**\n\nYou need **${selectedFolderImages} tokens** but only have **${tokenBalance}** tokens.\n\nYou are **${shortfall} tokens short**.\n\n💡 Please request more tokens before starting the analysis.`;

      // Use alert for now - later can be replaced with a proper modal
      alert(message.replace(/\*\*/g, '').replace(/🚫|💡/g, ''));

      // Highlight the request tokens button
      const requestBtn = document.getElementById('request-tokens-btn');
      if (requestBtn) {
        requestBtn.style.animation = 'pulse 2s infinite';
        requestBtn.scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => {
          if (requestBtn.style) requestBtn.style.animation = '';
        }, 6000);
      }

      // Also show the error message in the UI as backup
      showError(
        `Insufficient tokens! You need ${selectedFolderImages} tokens but only have ${tokenBalance}. ` +
        `You are ${shortfall} tokens short. Please request more tokens before starting the analysis.`
      );

      return;
    }
  } catch (error) {
    console.error('Error checking token balance:', error);
    showError('Unable to verify token balance. Please try again or contact support.');
    return;
  }

  setUploading(true);

  try {
    // Configure batch processing
    const config = {
      folderPath: selectedFolderPath,
      updateExif: false,
      savePreviewImages: true, // Abilita il salvataggio delle preview dei RAW
      previewFolder: 'previews', // Folder to save previews
      model: selectedModel, // Add selected model to request
      category: selectedCategory // Add selected category to request
    };

    // Add CSV data if available
    if (csvLoaded) {
      config.updateExif = true;
    }

    // Add metadata overwrite mode configuration
    const keywordsOverwrite = document.getElementById('keywords-overwrite');
    const descriptionOverwrite = document.getElementById('description-overwrite');

    config.keywordsMode = keywordsOverwrite && keywordsOverwrite.checked ? 'overwrite' : 'append';
    config.descriptionMode = descriptionOverwrite && descriptionOverwrite.checked ? 'overwrite' : 'append';

    // Add user-selected metadata strategy
    const selectedStrategy = document.querySelector('input[name="metadata-strategy"]:checked');
    if (selectedStrategy) {
      config.metadataStrategy = selectedStrategy.value;

      // Se la strategia è "manual", aggiungi anche il valore del metatag
      if (config.metadataStrategy === 'manual' && manualMetatagInput) {
        config.manualMetadataValue = manualMetatagInput.value || '';
      }

      // Always enable EXIF updates when a metadata strategy is selected
      if (config.metadataStrategy !== 'no_metadata') {
        config.updateExif = true;
      }
    }

    // Aggiungi configurazione resize se disponibile
    if (window.desktopUI && window.desktopUI.getResizeConfig) {
      config.resize = window.desktopUI.getResizeConfig();
    } else {
      // Fallback: resize enabled with balanced preset by default
      config.resize = { enabled: true, preset: 'balanced' };
    }

    // Aggiungi configurazione folder organization se disponibile
    if (window.getFolderOrganizationConfig) {
      const folderOrgConfig = window.getFolderOrganizationConfig();
      if (folderOrgConfig && folderOrgConfig.enabled) {
        config.folderOrganization = folderOrgConfig;
      }
    }

    // Aggiungi configurazione visual tagging se disponibile
    if (window.getVisualTaggingConfig) {
      const visualTagConfig = window.getVisualTaggingConfig();
      if (visualTagConfig && visualTagConfig.enabled) {
        config.visualTagging = visualTagConfig;
        console.log('[Renderer] Visual tagging enabled:', visualTagConfig);
      }
    }

    // Add participant preset configuration if available
    const presetSelect = document.getElementById('preset-select');
    if (presetSelect && presetSelect.value) {
      // Get preset data from the enhanced file browser instance if available
      if (window.enhancedFileBrowser && window.enhancedFileBrowser.selectedPreset) {
        config.participantPreset = {
          id: window.enhancedFileBrowser.selectedPreset.id,
          name: window.enhancedFileBrowser.selectedPreset.name,
          participants: window.enhancedFileBrowser.selectedPreset.participants || []
        };
      }
    }

    // Save current analysis settings for next time
    if (typeof window.saveLastAnalysisSettings === 'function') {
      window.saveLastAnalysisSettings();
    }

    // Let main process determine optimal processing mode based on USE_UNIFIED_PROCESSOR flag
    // Send to main process
    if (window.api) {
      window.api.send('analyze-folder', config);
    } else {
      throw new Error('API not available');
    }
  } catch (error) {
    console.error('Error during folder analysis:', error);
    showError(error.message || 'An unexpected error occurred.');
    setUploading(false);
  }
}

// Handle analysis results (enhanced integration)
async function handleAnalysisResults(analysisResults) {

  // Note: This function is now intercepted by enhanced UX integration

  // End timing and display execution time
  if (analysisStartTime) {
    analysisEndTime = Date.now();
    const executionTime = analysisEndTime - analysisStartTime;
    const seconds = (executionTime / 1000).toFixed(2);
    if (executionTimeValue) {
      executionTimeValue.textContent = `${seconds}s`;
    }
    if (executionTimeDisplay) {
      executionTimeDisplay.style.display = 'block';
    }
  }

  if (!Array.isArray(analysisResults)) {
    console.error('Received non-array analysis results:', analysisResults);
    showError('Received unexpected analysis format.');
    return;
  }

  // OLD CODE: Update the vehicle count - REMOVED FOR STREAMING VIEW
  // vehicleCount.textContent = analysisResults.length;

  // Get table body or initialize table if it doesn't exist
  let tableBody = document.getElementById('results-table')?.querySelector('tbody');
  if (!tableBody) {
    tableBody = initializeResultsTable();
  }

  if (analysisResults.length > 0) {
    // Extract imageId from first analysis result if available
    const imageId = analysisResults[0]?.imageId;

    // Create a fake image result for the current file
    const imageResult = {
      fileName: 'Analyzed Image',
      analysis: analysisResults,
      previewDataUrl: null,  // No preview for folder processing
      csvMatch: null,  // No CSV match for direct analysis
      imageId: imageId  // Aggiungi l'imageId se disponibile
    };

    // Display the result in the table
    await displayImageCard(imageResult);

    // OLD CODE: Show results container - REMOVED FOR STREAMING VIEW
    // resultsContainer.style.display = 'block';
    // resultsContainer.style.visibility = 'visible';
    // resultsContainer.style.opacity = '1';

    // Results available, keep container visible
  } else {
    // No vehicles found, but we don't show the "no results" message anymore
    // OLD RESULTS CONTAINER REMOVED - now using streaming view for all batches
  }
}

// Helper: Set uploading state
function setUploading(isUploading) {
  uploading = isUploading;

  // Get elements dynamically (they may be created by router after page load)
  const uploadBtn = document.getElementById('upload-button');
  const progressCont = document.getElementById('progress-container');

  if (isUploading) {
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading... Analyzing...';
    }
    if (progressCont) {
      progressCont.style.display = 'block';
    }
    // Reset progress fill, not the container
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
      progressFill.style.width = '0%';
    }
  } else {
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload and Analyze';
    }
    if (progressCont) {
      progressCont.style.display = 'none';
    }
  }
}

// Helper: Update progress bar
function updateProgress(progress) {
  // Get element dynamically (it may be created by router after page load)
  const pBar = document.getElementById('progress-bar');
  if (pBar) {
    pBar.style.width = `${progress}%`;
  }
}

// Helper: Show error message
function showError(message) {
  // Get element dynamically (it may be created by router after page load)
  const errMsg = document.getElementById('error-message');
  if (!errMsg) {
    console.error('[Renderer] Error:', message);
    return;
  }
  errMsg.textContent = message;
  errMsg.style.display = 'block';
}

// Helper: Reset UI state
function resetUI() {
  // Get element dynamically (it may be created by router after page load)
  const errMsg = document.getElementById('error-message');
  if (errMsg) {
    errMsg.style.display = 'none';
  }
  resetResults();
}

// Helper: Reset results
function resetResults() {
  // OLD RESULTS CONTAINER REMOVED - now using streaming view for all batches
  // OLD RESULTS LIST REMOVED - now using streaming view for all batches

  // Reset timing displays (with null checks)
  if (executionTimeDisplay) {
    executionTimeDisplay.style.display = 'none';
  }
  if (executionTimeValue) {
    executionTimeValue.textContent = '';
  }

  // Keep pipeline telemetry visible
  // hidePipelineTelemetry(); // Removed - keep telemetry visible
}

// Unified processor telemetry functions
function startUnifiedTelemetry(totalFiles) {

  // Don't reset processed count if already counting (prevents conflict with auto-init)
  if (unifiedProcessingStats.isProcessing && unifiedProcessingStats.processed > 0) {
    unifiedProcessingStats.total = totalFiles;
  } else {
    // Reset stats for fresh start
    unifiedProcessingStats = {
      total: totalFiles,
      processed: 0,
      processingTimes: [],
      isProcessing: true,
      startTime: Date.now()
    };
  }

  // Attiva sempre modalità streaming per tutti i batch
  if (window.streamingView) {
    window.streamingView.activate();
  }

  // Show unified telemetry container
  const unifiedTelemetry = document.getElementById('unified-telemetry');
  if (unifiedTelemetry) {
    unifiedTelemetry.style.display = 'block';
  }

  // Show progress bar container
  const progressContainer = document.getElementById('progress-container');
  if (progressContainer) {
    progressContainer.style.display = 'block';
  }

  // Update initial display
  updateUnifiedTelemetryDisplay();
}

function updateUnifiedTelemetry(result) {

  // Initialize telemetry automatically if not started (fixes race condition)
  if (!unifiedProcessingStats.isProcessing && unifiedProcessingStats.total === 0) {

    // Don't use fallback - wait for proper total from events
    let initialTotal = 0;
    if (result.total && result.total > 0) {
      initialTotal = result.total;
    }

    unifiedProcessingStats = {
      total: initialTotal,
      processed: 0,
      processingTimes: [],
      isProcessing: true,
      startTime: Date.now()
    };

    // Show unified telemetry container
    const unifiedTelemetry = document.getElementById('unified-telemetry');
    if (unifiedTelemetry) {
      unifiedTelemetry.style.display = 'block';
    }
  }

  // Update total if we receive a valid one (fixes stuck at 0 issue)
  if (result.total && result.total > 0) {
    if (result.total !== unifiedProcessingStats.total) {
      unifiedProcessingStats.total = result.total;
    }
  }

  // Increment processed count
  unifiedProcessingStats.processed++;

  // Force immediate display update to ensure button shows progress
  updateUnifiedTelemetryDisplay();

  // Add processing time if available
  if (result.processingTimeMs) {
    unifiedProcessingStats.processingTimes.push(result.processingTimeMs);
  }

  // Update display
  updateUnifiedTelemetryDisplay();
}

function completeUnifiedTelemetry() {

  unifiedProcessingStats.isProcessing = false;

  // Se la streaming view è attiva, mostra il pulsante review
  if (window.streamingView && window.streamingView.isActive) {
    window.streamingView.showReviewButton();
  }

  // Update final display
  updateUnifiedTelemetryDisplay();
}

function updateUnifiedTelemetryDisplay() {
  // Use existing telemetry elements or fall back gracefully
  const processingCount = document.getElementById('processing-count'); // Optional legacy element
  const averageTime = document.getElementById('telemetry-average-time'); // Use existing element
  const processingStatus = document.getElementById('processing-status'); // Optional legacy element

  const counterText = `${unifiedProcessingStats.processed}/${unifiedProcessingStats.total}`;

  if (processingCount) {
    processingCount.textContent = counterText;
  }
  // Remove warning since this element is optional

  if (averageTime) {
    if (unifiedProcessingStats.processed > 0 && unifiedProcessingStats.startTime) {
      const elapsedMs = Date.now() - unifiedProcessingStats.startTime;
      const throughput = elapsedMs / unifiedProcessingStats.processed; // ms per image throughput

      if (unifiedProcessingStats.processingTimes.length > 0) {
        const avgProcessingTime = unifiedProcessingStats.processingTimes.reduce((a, b) => a + b, 0) / unifiedProcessingStats.processingTimes.length;
        // Show both throughput and processing time
        const timeText = `${(throughput / 1000).toFixed(1)}s/img (${(avgProcessingTime / 1000).toFixed(1)}s processing)`;
        averageTime.textContent = timeText;

        // Update new telemetry elements
        updateNewTelemetryElements(throughput, avgProcessingTime, elapsedMs);
      } else {
        // Show only throughput if no processing times available
        const timeText = `${(throughput / 1000).toFixed(1)}s/img`;
        averageTime.textContent = timeText;

        // Update new telemetry elements (without processing time)
        updateNewTelemetryElements(throughput, null, elapsedMs);
      }
    } else {
      averageTime.textContent = '-';

      // Reset telemetry elements
      updateNewTelemetryElements(null, null, null);
    }
  }
  // Note: Using telemetry-average-time element which exists in HTML

  if (processingStatus) {
    let statusText = '';
    if (unifiedProcessingStats.isProcessing) {
      if (unifiedProcessingStats.processed === 0) {
        statusText = 'Starting...';
      } else {
        statusText = 'Processing...';
      }
    } else {
      statusText = 'Complete';
    }
    processingStatus.textContent = statusText;
  }
  // Note: processing-status is optional element

  // Update upload button text to show progress
  if (uploadButton) {
    if (unifiedProcessingStats.isProcessing) {
      // Only show counter if we have a valid total, otherwise show status
      if (unifiedProcessingStats.total > 0) {
        uploadButton.textContent = `Processing: ${counterText}`;
      } else {
        uploadButton.textContent = 'Processing: Starting...';
      }
    } else {
      uploadButton.textContent = 'Analyze Folder';
    }
  }

  // Update progress bar fill
  const progressFill = document.getElementById('progress-fill');
  if (progressFill && unifiedProcessingStats.total > 0) {
    const progressPercent = (unifiedProcessingStats.processed / unifiedProcessingStats.total) * 100;
    progressFill.style.width = `${progressPercent}%`;
  }

  // Update all progress container elements
  const currentImageNumber = document.getElementById('current-image-number');
  const totalImages = document.getElementById('total-images');
  const progressPercent = document.getElementById('progress-percent');
  const progressEta = document.getElementById('progress-eta-time');

  if (currentImageNumber) {
    currentImageNumber.textContent = unifiedProcessingStats.processed;
  }
  if (totalImages) {
    totalImages.textContent = unifiedProcessingStats.total;
  }
  if (progressPercent && unifiedProcessingStats.total > 0) {
    const percent = Math.round((unifiedProcessingStats.processed / unifiedProcessingStats.total) * 100);
    progressPercent.textContent = percent;
  }

  // Calculate and update ETA
  if (progressEta && unifiedProcessingStats.processed > 0 && unifiedProcessingStats.startTime) {
    const elapsedMs = Date.now() - unifiedProcessingStats.startTime;
    const msPerImage = elapsedMs / unifiedProcessingStats.processed;
    const remainingImages = unifiedProcessingStats.total - unifiedProcessingStats.processed;
    const remainingMs = remainingImages * msPerImage;

    if (remainingMs > 0) {
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;

      if (minutes > 0) {
        progressEta.textContent = `${minutes}m ${seconds}s`;
      } else {
        progressEta.textContent = `${seconds}s`;
      }
    } else {
      progressEta.textContent = 'Almost done...';
    }
  }
}

// Helper function to update current image with preview
function updateCurrentImageDisplay(imageName, status = '🔄', previewDataUrl = null) {
  const currentImageName = document.getElementById('current-image-name');
  const currentImageStatus = document.getElementById('current-image-status');
  const currentImagePreview = document.getElementById('current-image-preview');

  if (currentImageName) {
    currentImageName.textContent = imageName;
  }

  if (currentImageStatus) {
    currentImageStatus.textContent = status;
  }

  if (currentImagePreview) {
    if (previewDataUrl) {
      currentImagePreview.innerHTML = `<img src="${previewDataUrl}" alt="${imageName}">`;
    } else {
      currentImagePreview.innerHTML = '<div class="processing-image-placeholder">📸</div>';
    }
  }
}

// Helper function to update the new telemetry elements in the progress bar
function updateNewTelemetryElements(throughputMs, avgProcessingTimeMs, elapsedMs) {
  const telemetryAverageTime = document.getElementById('telemetry-average-time');
  const telemetryProcessingTime = document.getElementById('telemetry-processing-time');
  const telemetryThroughput = document.getElementById('telemetry-throughput');

  if (throughputMs === null || elapsedMs === null) {
    // Reset all values
    if (telemetryAverageTime) telemetryAverageTime.textContent = '-';
    if (telemetryProcessingTime) telemetryProcessingTime.textContent = '-';
    if (telemetryThroughput) telemetryThroughput.textContent = '-';
    return;
  }

  // Update average speed (same as throughput)
  if (telemetryAverageTime) {
    telemetryAverageTime.textContent = `${(throughputMs / 1000).toFixed(1)}s/img`;
  }

  // Update processing time (average AI processing time if available)
  if (telemetryProcessingTime && avgProcessingTimeMs !== null) {
    telemetryProcessingTime.textContent = `${(avgProcessingTimeMs / 1000).toFixed(1)}s`;
  } else if (telemetryProcessingTime) {
    telemetryProcessingTime.textContent = '-';
  }

  // Calculate and update images per minute
  if (telemetryThroughput && unifiedProcessingStats.processed > 0) {
    const imagesPerMinute = (60 * 1000) / throughputMs; // 60000ms / ms per image
    telemetryThroughput.textContent = `${imagesPerMinute.toFixed(1)}/min`;
  }
}

// Initialize auto-scroll when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Try to initialize auto-scroll if results container already exists
  setTimeout(() => {
    if (document.getElementById('results-list')) {
      initAutoScroll();
    }
  }, 100);
});

// Load dynamic sport categories with optimized caching
async function loadDynamicCategories(forceRefresh = false) {
  const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  // Get max supported version to include in cache key (ensures cache invalidation on app update)
  let maxSupportedVersion = 5; // fallback default
  try {
    if (window.api) {
      maxSupportedVersion = await window.api.invoke('get-max-supported-edge-function-version');
    }
  } catch (e) {
    // Could not get max supported version for cache key
  }

  // Include version in cache key to auto-invalidate when app is updated
  const CACHE_KEY = `racetagger_sport_categories_v${maxSupportedVersion}`;

  // Check sessionStorage cache first (unless forced refresh)
  if (!forceRefresh) {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        if (age < CACHE_DURATION) {
          populateCategorySelect(data);
          return;
        }
      }
    } catch (error) {
      // Error reading categories cache
    }
  }

  // Load from backend (which has its own cache)
  try {
    if (!window.api) {
      return;
    }

    // Use cached handler with retry logic for race condition
    let result = await window.api.invoke('supabase-get-cached-sport-categories');

    // If cache is empty, retry after a delay (race condition with backend cache)
    if (result.success && (!result.data || result.data.length === 0)) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await window.api.invoke('supabase-get-cached-sport-categories');
    }

    if (result.success && result.data && result.data.length > 0) {

      // Filter categories based on edge_function_version compatibility
      let filteredCategories = result.data;
      try {
        const maxSupportedVersion = await window.api.invoke('get-max-supported-edge-function-version');

        const originalCount = result.data.length;
        filteredCategories = result.data.filter(category => {
          // Categories without edge_function_version are assumed compatible (legacy V2)
          const categoryVersion = category.edge_function_version || 2;
          const isCompatible = categoryVersion <= maxSupportedVersion;

          return isCompatible;
        });
      } catch (versionError) {
        // Could not check version compatibility, showing all categories
      }

      // Save to sessionStorage for future use (save filtered data)
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          data: filteredCategories,
          timestamp: Date.now()
        }));
      } catch (error) {
        // Failed to cache categories to sessionStorage
      }

      populateCategorySelect(filteredCategories);
    }
  } catch (error) {
    console.error('Error loading dynamic categories:', error);
  }
}

// Populate category select with dynamic data
function populateCategorySelect(categories) {
  const categorySelect = document.getElementById('category-select');
  if (!categorySelect) {
    // Element not found - analysis page may not be loaded yet (normal with dynamic routing)
    return;
  }

  // Build category code-to-id mapping for preset filtering
  categoryCodeToIdMap = {};
  categories.forEach(category => {
    categoryCodeToIdMap[category.code] = category.id;
  });
  console.log('[Renderer] Built category mapping:', Object.keys(categoryCodeToIdMap).length, 'categories');

  // Clear existing options (keep current selection if possible)
  const currentValue = categorySelect.value;
  categorySelect.innerHTML = '';

  // Add categories from database
  let hasCurrentValue = false;
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category.code;

    // Create display text with emoji if available
    let displayText = category.name;
    switch(category.code) {
      case 'motorsport':
        displayText = `🏎️ ${category.name}`;
        break;
      case 'running':
        displayText = `🏃 ${category.name}`;
        break;
      case 'cycling':
        displayText = `🚴 ${category.name}`;
        break;
      default:
        displayText = `⚡ ${category.name}`;
    }

    option.textContent = displayText;
    categorySelect.appendChild(option);

    if (category.code === currentValue) {
      hasCurrentValue = true;
    }
  });

  // Restore previous selection or set to first category
  if (hasCurrentValue) {
    categorySelect.value = currentValue;
  } else if (categories.length > 0) {
    categorySelect.value = categories[0].code;
    selectedCategory = categories[0].code;
  }

  // Update category display
  if (categorySelect.value) {
    const selectedOption = categorySelect.options[categorySelect.selectedIndex];
    if (selectedOption && currentCategoryDisplay) {
      currentCategoryDisplay.textContent = selectedOption.textContent.replace(/^[^\s]+\s/, ''); // Remove emoji
    }
  }
}

// Manual refresh function for categories (useful for admin/debug)
async function refreshCategories() {

  try {
    // Clear all versioned sessionStorage caches
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('racetagger_sport_categories')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));

    // Refresh backend cache
    if (window.api) {
      const refreshResult = await window.api.invoke('supabase-refresh-categories-cache');
    }

    // Force reload from backend
    await loadDynamicCategories(true);
  } catch (error) {
    console.error('Error refreshing categories:', error);
  }
}

// Expose refresh function globally for debug/admin use
window.refreshCategories = refreshCategories;

// Expose functions for router/dynamic page initialization
window.handleFolderSelection = handleFolderSelection;
window.handleFolderSelected = handleFolderSelected;
window.toggleAdvancedOptions = toggleAdvancedOptions;
window.loadDynamicCategories = loadDynamicCategories;

/**
 * Load participant presets into the preset selector dropdown
 * Called by router when analysis page loads
 * Filters presets by the currently selected sport category
 */
async function loadPresetsForSelector() {
  try {
    const presetSelect = document.getElementById('preset-select');
    if (!presetSelect) {
      console.log('[Renderer] preset-select element not found');
      return;
    }

    // Check if user is admin to use appropriate endpoint
    let isAdmin = false;
    try {
      const adminCheck = await window.api.invoke('auth-is-admin');
      isAdmin = adminCheck === true || adminCheck?.isAdmin === true;
    } catch (e) {
      console.log('[Renderer] Admin check failed, using regular endpoint');
    }

    // Use appropriate endpoint based on admin status (same logic as participants-manager.js)
    const channel = isAdmin
      ? 'supabase-get-all-participant-presets-admin'
      : 'supabase-get-participant-presets';

    console.log(`[Renderer] Loading presets with channel: ${channel} (isAdmin: ${isAdmin})`);
    const response = await window.api.invoke(channel);

    // API returns { success, data } structure
    if (!response || !response.success || !response.data) {
      console.log('[Renderer] No presets returned from API:', response);
      return;
    }

    // Cache all presets for filtering
    cachedAllPresets = response.data;
    console.log(`[Renderer] Cached ${cachedAllPresets.length} total presets`);

    // Filter and display presets based on selected category
    filterAndDisplayPresets();
  } catch (error) {
    console.error('[Renderer] Error loading presets for selector:', error);
  }
}

/**
 * Filter cached presets by selected sport category and update the dropdown
 */
function filterAndDisplayPresets() {
  const presetSelect = document.getElementById('preset-select');
  if (!presetSelect) {
    return;
  }

  // Get the category ID for the selected category code
  const selectedCategoryId = categoryCodeToIdMap[selectedCategory];

  // Filter presets by category_id
  let filteredPresets = cachedAllPresets;
  if (selectedCategoryId) {
    filteredPresets = cachedAllPresets.filter(preset => preset.category_id === selectedCategoryId);
    console.log(`[Renderer] Filtered presets for category '${selectedCategory}' (${selectedCategoryId}): ${filteredPresets.length}/${cachedAllPresets.length}`);
  } else {
    console.log(`[Renderer] No category mapping for '${selectedCategory}', showing all ${cachedAllPresets.length} presets`);
  }

  // Clear existing options except first placeholder
  while (presetSelect.options.length > 1) {
    presetSelect.remove(1);
  }

  // Reset selection to placeholder
  presetSelect.value = '';

  // Add filtered preset options
  filteredPresets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    const count = preset.participant_count || preset.participants?.length || 0;
    option.textContent = `${preset.name} (${count} participants)`;
    presetSelect.appendChild(option);
  });

  console.log(`[Renderer] Displayed ${filteredPresets.length} presets for category '${selectedCategory}'`);
}

window.loadPresetsForSelector = loadPresetsForSelector;
window.filterAndDisplayPresets = filterAndDisplayPresets;

/**
 * Initialize metadata overwrite options visibility based on preset selection
 */
function initMetadataOverwriteOptions() {
  const descriptionOverwriteContainer = document.getElementById('description-overwrite-container');

  if (!descriptionOverwriteContainer) {
    return;
  }

  // Function to toggle description overwrite visibility
  function updateDescriptionOverwriteVisibility() {
    const presetSelect = document.getElementById('preset-select');
    const hasPresetSelected = presetSelect && presetSelect.value && presetSelect.value !== '';

    if (hasPresetSelected) {
      descriptionOverwriteContainer.style.display = 'block';
    } else {
      descriptionOverwriteContainer.style.display = 'none';
    }
  }

  // Listen for preset selection changes
  window.addEventListener('presetSelected', (event) => {
    updateDescriptionOverwriteVisibility();
  });

  // Listen for direct preset selector changes
  const presetSelect = document.getElementById('preset-select');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      updateDescriptionOverwriteVisibility();
    });
  }

  // Initial visibility check
  updateDescriptionOverwriteVisibility();
}

// Expose for router initialization
window.initMetadataOverwriteOptions = initMetadataOverwriteOptions;
