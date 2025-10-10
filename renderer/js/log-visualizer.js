/**
 * Log Visualizer Dashboard
 * Interactive results viewer with manual correction capabilities
 */

class LogVisualizer {
  constructor() {
    this.executionId = null;
    this.logData = [];
    this.imageResults = [];
    this.filteredResults = [];
    this.currentImageIndex = 0;
    this.isGalleryOpen = false;
    this.manualCorrections = new Map(); // Track manual corrections

    // Auto-save properties
    this.autoSaveTimer = null;
    this.hasUnsavedChanges = false;
    this.lastSaveTimestamp = null;

    // Virtual scrolling
    this.virtualScrollContainer = null;
    this.itemHeight = 280; // Height of each result card
    this.visibleItems = 0;
    this.scrollTop = 0;

    // Performance optimization
    this.renderDebounceTimer = null;
    this.searchDebounceTimer = null;
    this.isScrolling = false;

    // Lazy loading with Intersection Observer
    this.imageObserver = null;
    this.preloadedImages = new Set(); // Track preloaded images

    // Error handling and throttling
    this.loggedErrors = new Set(); // Track logged errors to prevent spam
    this.failedImages = new Set(); // Track failed images to avoid retrying

    // Auto-save functionality
    this.autoSaveTimer = null;
    this.hasUnsavedChanges = false;
    this.lastSaveTimestamp = null;

    console.log('[LogVisualizer] Initialized');
  }

  /**
   * Initialize the visualizer with execution data
   */
  async init(executionId, results) {
    this.executionId = executionId;
    this.imageResults = results || [];
    this.filteredResults = [...this.imageResults];

    console.log(`[LogVisualizer] Initializing with execution ${executionId} and ${results.length} results`);

    // Load detailed log data if available
    if (executionId) {
      try {
        const response = await window.api.invoke('get-execution-log', executionId);
        this.logData = response?.data || [];
        console.log(`[LogVisualizer] Loaded ${this.logData.length} log entries`);

        // Merge log data with results for enhanced details
        this.enrichResultsWithLogData();
      } catch (error) {
        console.warn('[LogVisualizer] Could not load execution log:', error);
        // Continue with results-only data
      }
    }

    // Calculate statistics
    this.updateStatistics();

    console.log('[LogVisualizer] Initialization complete');
  }

  /**
   * Enrich results with detailed log data
   */
  enrichResultsWithLogData() {
    if (!this.logData || !this.logData.length) return;

    // Create lookup map from log data
    const imageAnalysisEvents = this.logData
      .filter(event => event.type === 'IMAGE_ANALYSIS')
      .reduce((map, event) => {
        map[event.fileName] = event;
        return map;
      }, {});

    // Get MANUAL_CORRECTION events
    const manualCorrectionEvents = this.logData.filter(event => event.type === 'MANUAL_CORRECTION');

    // Enrich results with log details
    this.imageResults = this.imageResults.map(result => {
      // Clean the result object to prevent circular references
      const cleanedResult = this.cleanObjectForSerialization(result);

      return {
        ...cleanedResult,
        logEvent: imageAnalysisEvents[result.fileName] || null,
        hasLogData: !!imageAnalysisEvents[result.fileName],
        // Preserve originalFileName from log data if not already present
        originalFileName: result.originalFileName ||
          (imageAnalysisEvents[result.fileName]?.originalFileName)
      };
    });

    // Apply MANUAL_CORRECTION events to enriched results
    if (manualCorrectionEvents.length > 0) {
      console.log(`[LogVisualizer] Applying ${manualCorrectionEvents.length} manual corrections during enrichment`);

      manualCorrectionEvents.forEach(correction => {
        const { fileName, vehicleIndex, changes } = correction;

        // Find the result for this correction
        const result = this.imageResults.find(r => r.fileName === fileName);
        if (!result) {
          console.warn(`[LogVisualizer] No result found for enrichment correction: ${fileName}`);
          return;
        }

        // Apply the correction based on its type
        if (changes && changes.deleted) {
          // Handle deletion: remove the vehicle from analysis
          if (result.analysis && vehicleIndex >= 0 && vehicleIndex < result.analysis.length) {
            console.log(`[LogVisualizer] Applying enrichment deletion: ${fileName} vehicle ${vehicleIndex}`);
            result.analysis.splice(vehicleIndex, 1);
          }
        } else if (changes) {
          // Handle update: modify vehicle properties
          if (result.analysis && result.analysis[vehicleIndex]) {
            console.log(`[LogVisualizer] Applying enrichment update: ${fileName} vehicle ${vehicleIndex}`, changes);

            // Apply each field change
            Object.entries(changes).forEach(([field, value]) => {
              if (field !== 'deleted' && field !== 'deletedAt' && field !== 'originalData') {
                result.analysis[vehicleIndex][field] = value;
              }
            });

            // Set confidence to 100% for manually corrected vehicles
            result.analysis[vehicleIndex].confidence = 1.0;
          }
        }
      });
    }

    this.filteredResults = [...this.imageResults];
    console.log(`[LogVisualizer] Enriched ${this.imageResults.length} results with log data and corrections`);
  }

  /**
   * Render the dashboard in the specified container
   */
  render(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) {
      console.error('[LogVisualizer] Container not found:', containerSelector);
      return;
    }

    // Store container selector for potential re-renders
    this.currentContainer = containerSelector;

    container.innerHTML = this.createDashboardHTML();
    this.setupEventListeners();
    this.setupVirtualScrolling();
    this.setupLazyLoading();
    this.renderResults();
    this.updateStatistics(); // Aggiorna le statistiche dopo il render

    console.log('[LogVisualizer] Dashboard rendered');
  }

  /**
   * Create the main dashboard HTML structure
   */
  createDashboardHTML() {
    return `
      <div id="log-visualizer-container" class="log-visualizer">
        <!-- Header with statistics and filters -->
        <div class="lv-header">
          <div class="lv-header-title">
            <h3>📊 Analysis Results</h3>
            <p class="lv-subtitle">Review and edit recognition results</p>
          </div>

          <div class="lv-stats">
            <div class="lv-stat-item">
              <span class="lv-stat-label">Total Images</span>
              <span class="lv-stat-value" id="lv-total">0</span>
            </div>
            <div class="lv-stat-item">
              <span class="lv-stat-label">Matched</span>
              <span class="lv-stat-value" id="lv-matched">0</span>
            </div>
            <div class="lv-stat-item">
              <span class="lv-stat-label">No Match</span>
              <span class="lv-stat-value" id="lv-no-match">0</span>
            </div>
            <div class="lv-stat-item">
              <span class="lv-stat-label">Manual Corrections</span>
              <span class="lv-stat-value" id="lv-corrections">0</span>
            </div>
          </div>
        </div>

        <!-- Filters and search -->
        <div class="lv-filters">
          <div class="lv-search-container">
            <input type="text" id="lv-search" placeholder="Search by number, team, or filename..." class="lv-search-input" />
            <span class="lv-search-icon">🔍</span>
          </div>

          <div class="lv-filter-controls">
            <select id="lv-filter-type" class="lv-filter-select">
              <option value="all">All Results</option>
              <option value="matched">Matched Only</option>
              <option value="no-match">No Match Only</option>
              <option value="corrected">Manually Corrected</option>
              <option value="high-confidence">High Confidence (>90%)</option>
              <option value="low-confidence">Low Confidence (<70%)</option>
            </select>

            <button id="lv-clear-filters" class="lv-clear-btn">Clear Filters</button>
          </div>
        </div>

        <!-- Results grid without virtual scrolling -->
        <div class="lv-results-container">
          <div class="lv-results-grid" id="lv-results">
            <!-- All items will be rendered here -->
          </div>
        </div>

        <!-- Quick actions -->
        <div class="lv-footer">
          <button id="lv-export-csv" class="lv-action-btn lv-btn-secondary">
            📊 Export Results
          </button>
          <div class="lv-dropdown" style="position: relative; display: inline-block;">
            <button id="lv-export-labels-btn" class="lv-action-btn lv-btn-secondary">
              🏷️ Download Training Labels ▼
            </button>
            <div id="lv-export-labels-menu" class="lv-dropdown-menu" style="display: none; position: absolute; bottom: 100%; left: 0; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); min-width: 200px; z-index: 1000;">
              <button class="lv-dropdown-item" data-format="coco" style="display: block; width: 100%; padding: 8px 12px; text-align: left; border: none; background: transparent; cursor: pointer;">
                📦 COCO JSON
              </button>
              <button class="lv-dropdown-item" data-format="yolo" style="display: block; width: 100%; padding: 8px 12px; text-align: left; border: none; background: transparent; cursor: pointer;">
                📝 YOLO TXT
              </button>
              <button class="lv-dropdown-item" data-format="csv" style="display: block; width: 100%; padding: 8px 12px; text-align: left; border: none; background: transparent; cursor: pointer;">
                📊 CSV
              </button>
            </div>
          </div>
          <button id="lv-view-log" class="lv-action-btn lv-btn-secondary">
            📋 View Full Log
          </button>
          <button id="lv-save-all" class="lv-action-btn lv-btn-primary">
            💾 Save All Changes
          </button>
        </div>
      </div>

      <!-- Gallery Modal -->
      <div class="lv-gallery-modal" id="lv-gallery" style="display: none;">
        <div class="lv-gallery-overlay" id="lv-gallery-overlay"></div>

        <div class="lv-gallery-container">
          <!-- Gallery Header -->
          <div class="lv-gallery-header">
            <div class="lv-gallery-title">
              <span id="lv-gallery-filename">Image</span>
              <span class="lv-gallery-counter">
                <span id="lv-gallery-current">1</span> / <span id="lv-gallery-total">1</span>
              </span>
            </div>
            <button id="lv-gallery-close" class="lv-gallery-close">✕</button>
          </div>

          <!-- Gallery Image -->
          <div class="lv-gallery-image-container">
            <button id="lv-gallery-prev" class="lv-gallery-nav lv-nav-prev">‹</button>
            <div class="lv-gallery-image">
              <img id="lv-gallery-img" alt="Analysis result" />
              <div class="lv-gallery-loading">Loading...</div>
            </div>
            <button id="lv-gallery-next" class="lv-gallery-nav lv-nav-next">›</button>
          </div>

          <!-- Gallery Controls -->
          <div class="lv-gallery-controls">
            <div class="lv-recognition-panel">
              <h4>Recognition Results</h4>

              <div class="lv-vehicles-container" id="lv-vehicles">
                <!-- Vehicle recognition results will be populated here -->
              </div>

              <div class="lv-metadata-info">
                <div class="lv-info-item">
                  <span class="lv-info-label">Confidence:</span>
                  <span id="lv-confidence" class="lv-info-value">-</span>
                </div>
                <div class="lv-info-item">
                  <span class="lv-info-label">Analysis Time:</span>
                  <span id="lv-analysis-time" class="lv-info-value">-</span>
                </div>
                <div class="lv-info-item">
                  <span class="lv-info-label">File Size:</span>
                  <span id="lv-file-size" class="lv-info-value">-</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Setup event listeners for the dashboard
   */
  setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('lv-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.filterResults();
        }, 300);
      });
    }

    // Filter type change
    const filterSelect = document.getElementById('lv-filter-type');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        this.filterResults();
      });
    }

    // Clear filters
    const clearFiltersBtn = document.getElementById('lv-clear-filters');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        searchInput.value = '';
        filterSelect.value = 'all';
        this.filterResults();
      });
    }

    // Gallery navigation
    this.setupGalleryListeners();

    // Action buttons
    this.setupActionButtons();

    // Simple scroll listening (no virtual scrolling)
    const resultsGrid = document.getElementById('lv-results');
    if (resultsGrid) {
      console.log('[LogVisualizer] Simple scrolling enabled (no virtual scrolling)');
    }

    // Setup beforeunload handler for unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (this.manualCorrections && this.manualCorrections.size > 0) {
        const message = 'You have unsaved changes. Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    });

    console.log('[LogVisualizer] Event listeners setup complete');
  }

  /**
   * Setup gallery-specific event listeners
   */
  setupGalleryListeners() {
    // Close gallery
    const closeBtn = document.getElementById('lv-gallery-close');
    const overlay = document.getElementById('lv-gallery-overlay');

    if (closeBtn) closeBtn.addEventListener('click', async () => await this.closeGallery());
    if (overlay) overlay.addEventListener('click', async () => await this.closeGallery());

    // Navigation
    const prevBtn = document.getElementById('lv-gallery-prev');
    const nextBtn = document.getElementById('lv-gallery-next');

    if (prevBtn) prevBtn.addEventListener('click', () => this.navigateGallery(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => this.navigateGallery(1));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.isGalleryOpen) return;

      switch (e.key) {
        case 'Escape':
          this.closeGallery();
          break;
        case 'ArrowLeft':
          this.navigateGallery(-1);
          break;
        case 'ArrowRight':
          this.navigateGallery(1);
          break;
      }
    });
  }

  /**
   * Setup action button listeners
   */
  setupActionButtons() {
    const exportBtn = document.getElementById('lv-export-csv');
    const viewLogBtn = document.getElementById('lv-view-log');
    const saveAllBtn = document.getElementById('lv-save-all');

    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportResults());
    }

    if (viewLogBtn) {
      viewLogBtn.addEventListener('click', () => this.viewFullLog());
    }

    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', () => this.saveAllChanges());
    }

    // Export Training Labels dropdown
    const exportLabelsBtn = document.getElementById('lv-export-labels-btn');
    const exportLabelsMenu = document.getElementById('lv-export-labels-menu');
    const exportLabelsItems = document.querySelectorAll('.lv-dropdown-item');

    if (exportLabelsBtn && exportLabelsMenu) {
      // Toggle dropdown
      exportLabelsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = exportLabelsMenu.style.display === 'block';
        exportLabelsMenu.style.display = isVisible ? 'none' : 'block';
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        exportLabelsMenu.style.display = 'none';
      });

      // Handle format selection
      exportLabelsItems.forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          const format = item.dataset.format;
          exportLabelsMenu.style.display = 'none';
          await this.exportTrainingLabels(format);
        });

        // Hover effects
        item.addEventListener('mouseenter', () => {
          item.style.background = '#f0f0f0';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });
      });
    }
  }

  /**
   * No virtual scrolling needed - keeping method for compatibility
   */
  setupVirtualScrolling() {
    console.log('[LogVisualizer] Virtual scrolling disabled - rendering all items for fluid experience');
  }

  /**
   * Setup Intersection Observer for lazy loading images
   */
  setupLazyLoading() {
    // Cleanup existing observer
    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }

    // Create Intersection Observer for lazy loading
    this.imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const fileName = img.dataset.fileName;

          // Only load if not already preloaded and not already a real image
          if (fileName && !this.preloadedImages.has(fileName)) {
            // Allow loading for placeholders and failed previous attempts
            const isPlaceholder = img.src.includes('data:image/svg') || img.src === this.getPlaceholderUrl();
            const hasRealImage = img.complete && img.naturalWidth > 0 && !isPlaceholder;

            if (!hasRealImage) {
              console.log(`[LogVisualizer] Triggering lazy load for ${fileName}, isPlaceholder: ${isPlaceholder}`);
              this.loadImageLazily(img, fileName);
              // Don't unobserve - keep watching for virtual scroll re-creation
            }
          }
        }
      });
    }, {
      rootMargin: '200px', // Increased margin for better preloading
      threshold: 0.1
    });

    console.log(`[LogVisualizer] Lazy loading setup completed with Intersection Observer`);
  }

  /**
   * Load image lazily using multi-level strategy
   */
  async loadImageLazily(imgElement, fileName) {
    console.log(`[LogVisualizer] loadImageLazily called for ${fileName}`);

    // Skip if already marked as failed
    if (this.failedImages.has(fileName)) {
      console.log(`[LogVisualizer] Skipping failed image: ${fileName}`);
      return;
    }

    // Skip if image is already loaded (not a placeholder)
    const isPlaceholder = imgElement.src.includes('data:image/svg') || imgElement.src === this.getPlaceholderUrl();
    const hasRealImage = imgElement.complete && imgElement.naturalWidth > 0 && !isPlaceholder;

    if (hasRealImage) {
      console.log(`[LogVisualizer] Image ${fileName} already loaded, skipping`);
      this.preloadedImages.add(fileName);
      return;
    }

    try {
      // Get paths directly from dataset (more efficient than searching array)
      const microPath = imgElement.dataset.microPath;
      const thumbPath = imgElement.dataset.thumbPath;
      const compressedPath = imgElement.dataset.compressedPath;

      // Show loading state only if not already loading
      if (imgElement.style.opacity !== '0.5') {
        imgElement.style.opacity = '0.5';
      }

      // Strategy 1: Try thumbnail first (high quality 280x280)
      if (thumbPath) {
        try {
          await this.loadImageWithIPC(imgElement, thumbPath);
          this.preloadedImages.add(fileName);
          return;
        } catch (error) {
          this.logImageError(fileName, error, 'thumbnail');
        }
      }

      // Strategy 2: Try compressed (full quality fallback)
      if (compressedPath) {
        try {
          await this.loadImageWithIPC(imgElement, compressedPath);
          this.preloadedImages.add(fileName);
          return;
        } catch (error) {
          this.logImageError(fileName, error, 'compressed');
        }
      }

      // Strategy 3: Try micro-thumbnail as last resort (32x32 - pixelated)
      if (microPath) {
        try {
          await this.loadImageWithIPC(imgElement, microPath);
          this.preloadedImages.add(fileName);
          console.warn(`[LogVisualizer] Using micro-thumbnail for ${fileName} - quality will be low`);
          return;
        } catch (error) {
          this.logImageError(fileName, error, 'micro-thumbnail');
        }
      }

      // Fallback: Find result and try Supabase URLs
      const result = this.filteredResults.find(r => r.fileName === fileName);
      if (result) {
        // Try Supabase URLs as fallback when local files are missing
        if (result.supabaseUrl) {
          console.log(`[LogVisualizer] Using Supabase fallback for ${fileName}: ${result.supabaseUrl}`);
          await this.loadImageWithIPC(imgElement, result.supabaseUrl);
          this.preloadedImages.add(fileName);
          return;
        }

        // Try other thumbnail generation methods
        const fallbackUrl = this.getThumbnailUrl(result);
        if (fallbackUrl && fallbackUrl !== result.supabaseUrl) {
          await this.loadImageWithIPC(imgElement, fallbackUrl);
          this.preloadedImages.add(fileName);
          return;
        }

        throw new Error('No fallback URL available');
      } else {
        throw new Error('Result not found for fallback');
      }

    } catch (error) {
      this.logImageError(fileName, error, 'main_load');

      // Mark as permanently failed
      this.failedImages.add(fileName);

      // Hide the image container completely instead of showing placeholder
      const cardImageContainer = imgElement.closest('.lv-card-image');
      if (cardImageContainer) {
        cardImageContainer.style.display = 'none';

        // Add a text indicator where the image would be
        const card = cardImageContainer.closest('.lv-result-card');
        if (card && !card.querySelector('.lv-no-image-indicator')) {
          const indicator = document.createElement('div');
          indicator.className = 'lv-no-image-indicator';
          indicator.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #666; border: 1px dashed #ccc; background: #f9f9f9;">
              📷 Image unavailable<br>
              <small>${fileName}</small>
            </div>
          `;
          cardImageContainer.parentNode.insertBefore(indicator, cardImageContainer);
        }
      }
    }
  }

  /**
   * Log error with throttling to prevent console spam
   */
  logImageError(fileName, error, context = '') {
    const errorKey = `${fileName}_${context}`;
    if (this.loggedErrors.has(errorKey)) {
      return; // Already logged this specific error
    }

    this.loggedErrors.add(errorKey);
    this.failedImages.add(fileName);

    // Log only once per fileName+context combination
    console.warn(`[LogVisualizer] Failed to load image ${fileName}${context ? ` (${context})` : ''}:`, error.message);

    // Clear error log after 30 seconds to allow retry logging
    setTimeout(() => {
      this.loggedErrors.delete(errorKey);
    }, 30000);
  }

  /**
   * Load image with IPC for local files or direct loading for URLs
   */
  async loadImageWithIPC(imgElement, src) {
    console.log(`[LogVisualizer] Loading image with IPC support: ${src}`);

    // Check if this is a local file path
    const isLocalPath = src && src.startsWith('/') && !src.startsWith('http');

    if (isLocalPath) {
      // Use IPC for local file access
      try {
        console.log(`[LogVisualizer] Using IPC for local image: ${src}`);
        const dataUrl = await window.api.invoke('get-local-image', src);
        if (dataUrl) {
          imgElement.src = dataUrl;
          imgElement.style.opacity = '1';
          imgElement.style.transition = 'opacity 0.3s ease';
          console.log(`[LogVisualizer] Successfully loaded local image via IPC: ${src}`);
          return;
        } else {
          throw new Error(`IPC returned null for local image: ${src}`);
        }
      } catch (error) {
        console.warn(`[LogVisualizer] IPC failed for local image ${src}:`, error);
        throw new Error(`IPC failed for local image: ${src} - ${error.message}`);
      }
    } else {
      // Use direct loading for URLs (Supabase, etc.)
      return this.loadImageWithFallback(imgElement, src);
    }
  }

  /**
   * Load image with promise wrapper (for URLs only)
   */
  loadImageWithFallback(imgElement, src) {
    return new Promise((resolve, reject) => {
      const tempImg = new Image();
      tempImg.onload = () => {
        imgElement.src = src;
        imgElement.style.opacity = '1';
        imgElement.style.transition = 'opacity 0.3s ease';
        resolve();
      };
      tempImg.onerror = () => {
        // Log enhanced error information for better debugging
        console.warn(`[LogVisualizer] Failed to load image: ${src}`);

        // Check if this is a Supabase 400 error pattern
        const is400Error = src.includes('supabase') && src.includes('.co/storage/v1/object/public/');
        if (is400Error) {
          console.warn(`[LogVisualizer] Detected Supabase 400 error for: ${src}`);
        }

        reject(new Error(`Failed to load image: ${src} ${is400Error ? '(Supabase 400)' : ''}`));
      };
      tempImg.src = src;
    });
  }

  /**
   * Preload higher quality image in background
   */
  async preloadHigherQuality(result) {
    if (result.thumbnailPath && !this.preloadedImages.has(`${result.fileName}_thumb`)) {
      try {
        const img = new Image();
        img.onload = () => {
          this.preloadedImages.add(`${result.fileName}_thumb`);
        };
        img.src = result.thumbnailPath;
      } catch (error) {
        // Silent fail for background preloading
      }
    }
  }

  /**
   * Get placeholder URL for loading state
   */
  getPlaceholderUrl() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjVmNWY1Ii8+PGNpcmNsZSBjeD0iNTAlIiBjeT0iNTAlIiByPSIyMCIgZmlsbD0iI2RkZCIgb3BhY2l0eT0iMC42Ii8+PHRleHQgeD0iNTAlIiB5PSI2NSUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TG9hZGluZy4uLjwvdGV4dD48L3N2Zz4=';
  }

  /**
   * No scroll handling needed without virtual scrolling
   */
  handleScroll() {
    // No action needed - all items are already rendered
  }

  /**
   * Filter results based on search and filter criteria
   */
  filterResults() {
    const searchTerm = document.getElementById('lv-search')?.value.toLowerCase() || '';
    const filterType = document.getElementById('lv-filter-type')?.value || 'all';

    this.filteredResults = this.imageResults.filter(result => {
      // Search filter
      const matchesSearch = !searchTerm ||
        result.fileName.toLowerCase().includes(searchTerm) ||
        this.getSearchableText(result).toLowerCase().includes(searchTerm);

      if (!matchesSearch) return false;

      // Type filter
      switch (filterType) {
        case 'matched':
          return result.analysis && result.analysis.length > 0;
        case 'no-match':
          return !result.analysis || result.analysis.length === 0;
        case 'corrected':
          return this.manualCorrections.has(result.fileName);
        case 'high-confidence':
          return this.getAverageConfidence(result) >= 0.9;
        case 'low-confidence':
          return this.getAverageConfidence(result) < 0.7;
        default:
          return true;
      }
    });

    this.updateStatistics();
    this.renderResults();

    // If gallery is open, refresh the current image in case the filtered results changed
    if (this.isGalleryOpen) {
      this.refreshGalleryAfterFilter();
    }

    console.log(`[LogVisualizer] Filtered to ${this.filteredResults.length} results`);
  }

  /**
   * Get searchable text from result
   */
  getSearchableText(result) {
    let text = result.fileName;

    if (result.analysis) {
      result.analysis.forEach(vehicle => {
        if (vehicle.raceNumber) text += ' ' + vehicle.raceNumber;
        if (vehicle.team) text += ' ' + vehicle.team;
        if (vehicle.drivers) text += ' ' + vehicle.drivers.join(' ');
      });
    }

    if (result.csvMatch) {
      text += ' ' + (result.csvMatch.nome || '');
      text += ' ' + (result.csvMatch.squadra || '');
    }

    return text;
  }

  /**
   * Refresh gallery after filtering to handle cases where current image is no longer in filtered results
   */
  refreshGalleryAfterFilter() {
    if (!this.isGalleryOpen) return;

    // Get current result being displayed in gallery
    const currentResult = this.filteredResults[this.currentImageIndex];

    if (!currentResult) {
      // Current image is no longer in filtered results
      if (this.filteredResults.length > 0) {
        // Show first available result
        this.currentImageIndex = 0;
        this.updateGalleryContent();
      } else {
        // No results available, close gallery
        this.closeGallery();
      }
    } else {
      // Current image is still available, just refresh the vehicle editor
      this.updateVehicleEditor(currentResult, this.currentImageIndex);
    }
  }

  /**
   * Get average confidence for a result
   */
  getAverageConfidence(result) {
    if (!result.analysis || result.analysis.length === 0) return 0;

    const total = result.analysis.reduce((sum, vehicle) => sum + (vehicle.confidence || 0), 0);
    return total / result.analysis.length;
  }

  /**
   * Update statistics display
   */
  updateStatistics() {
    const totalEl = document.getElementById('lv-total');
    const matchedEl = document.getElementById('lv-matched');
    const noMatchEl = document.getElementById('lv-no-match');
    const correctionsEl = document.getElementById('lv-corrections');

    const total = this.filteredResults.length;
    const matched = this.filteredResults.filter(r => {
      return r.analysis && r.analysis.length > 0 &&
             r.analysis.some(vehicle => vehicle.raceNumber && vehicle.raceNumber !== 'N/A');
    }).length;
    const noMatch = total - matched;
    const corrections = this.manualCorrections.size;

    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (matchedEl) matchedEl.textContent = matched.toLocaleString();
    if (noMatchEl) noMatchEl.textContent = noMatch.toLocaleString();
    if (correctionsEl) correctionsEl.textContent = corrections.toLocaleString();
  }

  /**
   * Render all results without virtual scrolling
   */
  renderResults() {
    this.scrollTop = 0;
    const container = document.getElementById('lv-results');
    if (container) {
      container.scrollTop = 0;
    }
    this.renderAllItems(); // Changed from virtual scrolling to render all
  }

  /**
   * Render all items without virtual scrolling for fluid experience
   */
  renderAllItems() {
    const resultsContainer = document.getElementById('lv-results');
    if (!resultsContainer) return;

    // Clear existing content and render all items
    resultsContainer.innerHTML = `
      <div class="lv-results-grid-simple">
        ${this.filteredResults.map((result, index) => this.createResultCardHTML(result, index)).join('')}
      </div>
    `;

    // Register lazy images with Intersection Observer
    const lazyImages = resultsContainer.querySelectorAll('.lv-lazy-image');
    lazyImages.forEach(img => {
      if (this.imageObserver && !this.preloadedImages.has(img.dataset.fileName)) {
        this.imageObserver.observe(img);
      }
    });

    // Setup click listeners for all items
    this.setupResultCardListeners(resultsContainer);
  }

  /**
   * Create HTML for a single result card
   */
  createResultCardHTML(result, index) {
    const isModified = this.manualCorrections.has(result.fileName);
    const confidence = this.getAverageConfidence(result);
    const confidenceClass = confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low';

    const vehicles = result.analysis || [];
    const primaryVehicle = vehicles[0] || {};

    // Check if we already have a cached image URL for this result
    const cachedImageUrl = this.getCachedImageUrl(result);
    const imageSrc = cachedImageUrl || this.getPlaceholderUrl();

    return `
      <div class="lv-result-card ${isModified ? 'modified' : ''}" data-index="${index}">
        <div class="lv-card-image">
          <img src="${imageSrc}"
               alt="${result.fileName}"
               loading="lazy"
               data-file-name="${result.fileName}"
               data-micro-path="${result.microThumbPath || ''}"
               data-thumb-path="${result.thumbnailPath || ''}"
               data-compressed-path="${result.compressedPath || ''}"
               class="lv-lazy-image"
               style="${cachedImageUrl ? 'opacity: 1;' : ''}" />
          ${isModified ? '<div class="lv-modified-badge">✏️ Modified</div>' : ''}
          ${vehicles.length > 1 ? `<div class="lv-multi-badge">${vehicles.length} vehicles</div>` : ''}
        </div>

        <div class="lv-card-content">
          <div class="lv-card-filename">${this.truncateFilename(result.fileName)}</div>

          <div class="lv-card-recognition">
            ${vehicles.length > 0 ? `
              <div class="lv-race-number">#${primaryVehicle.raceNumber || '?'}</div>
              <div class="lv-team-name">${primaryVehicle.team || 'Unknown Team'}</div>
              ${primaryVehicle.drivers ? `<div class="lv-drivers">${primaryVehicle.drivers.join(', ')}</div>` : ''}
            ` : `
              <div class="lv-no-match">No recognition</div>
            `}
          </div>

          <div class="lv-card-meta">
            <div class="lv-confidence confidence-${confidenceClass}">
              ${Math.round(confidence * 100)}% confidence
            </div>
            ${result.csvMatch && result.csvMatch.entry ? '<div class="lv-csv-matched">📊 CSV matched</div>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Update a specific result card in the main container
   */
  updateResultCard(fileName) {
    try {
      // Find the result data
      let results = this.filteredResults.length > 0 ? this.filteredResults : this.imageResults;
      const result = results.find(r => r.fileName === fileName);
      if (!result) {
        console.error(`[LogVisualizer] Result not found for fileName: ${fileName}`);
        return;
      }

      // Find the card element by fileName (using the image's data-file-name attribute)
      const resultContainer = document.querySelector('.lv-results-container');
      if (!resultContainer) {
        console.error('[LogVisualizer] Results container not found');
        return;
      }

      const cardImage = resultContainer.querySelector(`img[data-file-name="${fileName}"]`);
      if (!cardImage) {
        console.error(`[LogVisualizer] Card not found for fileName: ${fileName}`);
        return;
      }

      // Get the card element (parent of the image)
      const card = cardImage.closest('.lv-result-card');
      if (!card) {
        console.error(`[LogVisualizer] Card container not found for fileName: ${fileName}`);
        return;
      }

      // Get the index for the card
      const index = parseInt(card.dataset.index);

      // Update the card's HTML with current data
      const newCardHTML = this.createResultCardHTML(result, index);
      card.outerHTML = newCardHTML;

      // Re-setup click listener for the new card
      const newCard = resultContainer.querySelector(`img[data-file-name="${fileName}"]`)?.closest('.lv-result-card');
      if (newCard) {
        newCard.addEventListener('click', () => {
          this.openGallery(index);
        });
      }

      console.log(`[LogVisualizer] Updated result card for ${fileName}`);
    } catch (error) {
      console.error('[LogVisualizer] Error updating result card:', error);
    }
  }

  /**
   * Setup click listeners for result cards
   */
  setupResultCardListeners(container) {
    const cards = container.querySelectorAll('.lv-result-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const index = parseInt(card.dataset.index);
        this.openGallery(index);
      });
    });
  }

  /**
   * Get cached image URL if already loaded
   */
  getCachedImageUrl(result) {
    if (this.preloadedImages.has(result.fileName)) {
      // Return the best quality URL we know works
      if (result.thumbnailPath && (result.thumbnailPath.startsWith('/') || result.thumbnailPath.startsWith('http'))) {
        return result.thumbnailPath;
      }
      if (result.compressedPath && (result.compressedPath.startsWith('/') || result.compressedPath.startsWith('http'))) {
        return result.compressedPath;
      }
      // Fallback to full URL resolution
      return this.getThumbnailUrl(result);
    }
    return null;
  }

  /**
   * Get large image URL for gallery display
   */
  getGalleryImageUrl(result) {
    console.log(`[LogVisualizer] getGalleryImageUrl for ${result.fileName}:`, {
      thumbnailPath: !!result.thumbnailPath,
      compressedPath: !!result.compressedPath,
      supabaseUrl: !!result.supabaseUrl,
      imagePath: !!result.imagePath
    });

    // 1. Prima: immagine compressa di alta qualità (1080-1920px) - locale o Supabase
    if (result.compressedPath) {
      if (result.compressedPath.startsWith('/')) {
        console.log(`[LogVisualizer] Using local compressedPath for gallery: ${result.fileName}`);
        return result.compressedPath;
      } else if (result.compressedPath.startsWith('http')) {
        console.log(`[LogVisualizer] Using Supabase compressedPath for gallery: ${result.fileName}`);
        return result.compressedPath;
      }
    }

    // 2. Seconda: Supabase URL originale
    if (result.supabaseUrl) {
      console.log(`[LogVisualizer] Using supabaseUrl for gallery: ${result.fileName}`);
      return result.supabaseUrl;
    }

    // 3. Terza: imagePath generico
    if (result.imagePath) {
      if (result.imagePath.startsWith('http')) {
        console.log(`[LogVisualizer] Using remote imagePath for gallery: ${result.fileName}`);
        return result.imagePath;
      } else if (result.imagePath.startsWith('/')) {
        console.log(`[LogVisualizer] Using local imagePath for gallery: ${result.fileName}`);
        return result.imagePath;
      }
    }

    // 4. Ultima risorsa: thumbnail (280x280) - solo se nient'altro è disponibile
    if (result.thumbnailPath) {
      if (result.thumbnailPath.startsWith('/')) {
        console.log(`[LogVisualizer] Using local thumbnailPath as fallback for gallery: ${result.fileName}`);
        return result.thumbnailPath;
      } else if (result.thumbnailPath.startsWith('http')) {
        console.log(`[LogVisualizer] Using Supabase thumbnailPath as fallback for gallery: ${result.fileName}`);
        return result.thumbnailPath;
      }
    }

    console.warn(`[LogVisualizer] No suitable image URL found for gallery: ${result.fileName}`);
    return null;
  }

  /**
   * Get thumbnail URL for result image
   */
  getThumbnailUrl(result) {
    console.log(`[LogVisualizer] getThumbnailUrl for ${result.fileName}:`, {
      thumbnailPath: !!result.thumbnailPath,
      microThumbPath: !!result.microThumbPath,
      compressedPath: !!result.compressedPath,
      supabaseUrl: !!result.supabaseUrl,
      imagePath: !!result.imagePath
    });

    // 1. Prima: thumbnail ad alta qualità (280x280) - locale o Supabase
    if (result.thumbnailPath) {
      if (result.thumbnailPath.startsWith('/')) {
        console.log(`[LogVisualizer] Using local thumbnailPath for ${result.fileName}`);
        return result.thumbnailPath;
      } else if (result.thumbnailPath.startsWith('http')) {
        console.log(`[LogVisualizer] Using Supabase thumbnailPath for ${result.fileName}`);
        return result.thumbnailPath;
      }
    }

    // 2. Seconda: file compresso - locale o Supabase
    if (result.compressedPath) {
      if (result.compressedPath.startsWith('/')) {
        console.log(`[LogVisualizer] Using local compressedPath for ${result.fileName}`);
        return result.compressedPath;
      } else if (result.compressedPath.startsWith('http')) {
        console.log(`[LogVisualizer] Using Supabase compressedPath for ${result.fileName}`);
        return result.compressedPath;
      }
    }

    // 3. Terza: Supabase URL originale (fallback)
    if (result.supabaseUrl) {
      console.log(`[LogVisualizer] Using supabaseUrl for ${result.fileName}`);
      return result.supabaseUrl;
    }

    // 4. Quarta: imagePath generico
    if (result.imagePath) {
      if (result.imagePath.startsWith('http')) {
        console.log(`[LogVisualizer] Using imagePath URL for ${result.fileName}`);
        return result.imagePath;
      } else {
        console.log(`[LogVisualizer] Using local imagePath for ${result.fileName}`);
        return result.imagePath;
      }
    }

    // 5. Ultima opzione: micro-thumbnail (solo se nient'altro è disponibile)
    if (result.microThumbPath) {
      if (result.microThumbPath.startsWith('/')) {
        console.log(`[LogVisualizer] Using local microThumbPath as last resort for ${result.fileName}`);
        return result.microThumbPath;
      } else if (result.microThumbPath.startsWith('http')) {
        console.log(`[LogVisualizer] Using Supabase microThumbPath as last resort for ${result.fileName}`);
        return result.microThumbPath;
      }
    }

    console.warn(`[LogVisualizer] No image source found for ${result.fileName}`, result);
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
  }

  /**
   * Truncate filename for display
   */
  truncateFilename(filename, maxLength = 25) {
    if (filename.length <= maxLength) return filename;
    return filename.substring(0, maxLength - 3) + '...';
  }

  /**
   * Open gallery at specific image index
   */
  async openGallery(index) {
    this.currentImageIndex = index;
    this.isGalleryOpen = true;

    const gallery = document.getElementById('lv-gallery');
    if (gallery) {
      gallery.style.display = 'flex';
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    await this.updateGalleryContent();
    console.log(`[LogVisualizer] Opened gallery at index ${index}`);
  }

  /**
   * Close gallery
   */
  async closeGallery() {
    this.isGalleryOpen = false;

    // Handle unsaved changes before closing
    if (this.hasUnsavedChanges) {
      console.log('[LogVisualizer] Triggering final auto-save before closing gallery');
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }

      try {
        await this.performAutoSave();
      } catch (error) {
        console.error('[LogVisualizer] Error during final auto-save:', error);
        // Continue closing even if auto-save fails
      }
    }

    const gallery = document.getElementById('lv-gallery');
    if (gallery) {
      gallery.style.display = 'none';
      document.body.style.overflow = ''; // Restore scrolling
    }

    // Clear vehicle editor content to prevent stale onclick handlers
    const vehiclesContainer = document.getElementById('lv-vehicles');
    if (vehiclesContainer) {
      vehiclesContainer.innerHTML = '';
    }

    // Update the result card in the main container if we have a current image
    if (this.currentImageIndex !== null && this.currentImageIndex !== undefined) {
      let results = this.filteredResults.length > 0 ? this.filteredResults : this.imageResults;
      if (results && results[this.currentImageIndex]) {
        const currentResult = results[this.currentImageIndex];
        this.updateResultCard(currentResult.fileName);
      }
    }

    // Reset auto-save state
    this.hasUnsavedChanges = false;
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    console.log('[LogVisualizer] Closed gallery and cleared vehicle editor');
  }

  /**
   * Navigate gallery by offset
   */
  async navigateGallery(offset) {
    const newIndex = this.currentImageIndex + offset;

    if (newIndex >= 0 && newIndex < this.filteredResults.length) {
      this.currentImageIndex = newIndex;
      await this.updateGalleryContent();
    }
  }

  /**
   * Update gallery content for current image
   */
  async updateGalleryContent() {
    if (!this.isGalleryOpen || this.currentImageIndex < 0 || this.currentImageIndex >= this.filteredResults.length) {
      return;
    }

    const result = this.filteredResults[this.currentImageIndex];

    // Update image with preloading for smooth transitions
    const img = document.getElementById('lv-gallery-img');
    const loadingDiv = document.querySelector('.lv-gallery-loading');

    if (img) {
      // Show loading state
      img.style.opacity = '0.5';
      if (loadingDiv) {
        loadingDiv.style.display = 'flex';
      }

      const newImg = new Image();
      newImg.onload = () => {
        img.src = newImg.src;
        img.alt = result.fileName;
        img.style.opacity = '1';
        img.style.transition = 'opacity 0.2s ease';
        // Hide loading indicator when image loads successfully
        if (loadingDiv) {
          loadingDiv.style.display = 'none';
        }
      };
      newImg.onerror = () => {
        img.style.opacity = '1';
        // Hide loading indicator even on error
        if (loadingDiv) {
          loadingDiv.style.display = 'none';
        }
        this.logImageError(result.fileName, new Error('Gallery image load failed'), 'gallery');
      };

      // Use IPC for local images in gallery too
      const imageUrl = this.getGalleryImageUrl(result);
      if (imageUrl && imageUrl.startsWith('/') && !imageUrl.startsWith('http')) {
        try {
          const dataUrl = await window.api.invoke('get-local-image', imageUrl);
          newImg.src = dataUrl || imageUrl;
        } catch (error) {
          console.warn(`[LogVisualizer] Gallery IPC failed for ${imageUrl}:`, error);
          newImg.src = imageUrl; // fallback to direct loading
        }
      } else {
        newImg.src = imageUrl;
      }
    }

    // Preload adjacent images for smoother navigation
    await this.preloadAdjacentImages();

    // Update filename
    const filenameEl = document.getElementById('lv-gallery-filename');
    if (filenameEl) {
      filenameEl.textContent = result.fileName;
    }

    // Update counter
    const currentEl = document.getElementById('lv-gallery-current');
    const totalEl = document.getElementById('lv-gallery-total');
    if (currentEl) currentEl.textContent = this.currentImageIndex + 1;
    if (totalEl) totalEl.textContent = this.filteredResults.length;

    // Update vehicle information
    this.updateVehicleEditor(result, this.currentImageIndex);

    // Update navigation buttons
    const prevBtn = document.getElementById('lv-gallery-prev');
    const nextBtn = document.getElementById('lv-gallery-next');
    if (prevBtn) prevBtn.disabled = this.currentImageIndex === 0;
    if (nextBtn) nextBtn.disabled = this.currentImageIndex === this.filteredResults.length - 1;
  }

  /**
   * Preload adjacent images for smoother gallery navigation
   */
  async preloadAdjacentImages() {
    if (!this.imageCache) {
      this.imageCache = new Map();
    }

    // Preload previous image
    if (this.currentImageIndex > 0) {
      const prevResult = this.filteredResults[this.currentImageIndex - 1];
      if (prevResult) {
        await this.preloadImage(this.getThumbnailUrl(prevResult));
      }
    }

    // Preload next image
    if (this.currentImageIndex < this.filteredResults.length - 1) {
      const nextResult = this.filteredResults[this.currentImageIndex + 1];
      if (nextResult) {
        await this.preloadImage(this.getThumbnailUrl(nextResult));
      }
    }
  }

  /**
   * Preload a single image with IPC support
   */
  async preloadImage(url) {
    if (this.imageCache.has(url)) return;

    const img = new Image();
    img.onload = () => {
      this.imageCache.set(url, img);
    };
    img.onerror = () => {
      console.warn(`[LogVisualizer] Failed to preload image: ${url}`);
    };

    // Use IPC for local images
    if (url && url.startsWith('/') && !url.startsWith('http')) {
      try {
        const dataUrl = await window.api.invoke('get-local-image', url);
        img.src = dataUrl || url;
      } catch (error) {
        console.warn(`[LogVisualizer] Preload IPC failed for ${url}:`, error);
        img.src = url; // fallback to direct loading
      }
    } else {
      img.src = url;
    }
  }

  /**
   * Update vehicle editor in gallery
   */
  updateVehicleEditor(result, imageIndex = null) {
    const vehiclesContainer = document.getElementById('lv-vehicles');
    if (!vehiclesContainer || !result) return;

    // Use provided imageIndex or current gallery index
    const actualImageIndex = (imageIndex !== null && imageIndex !== undefined) ? imageIndex : this.currentImageIndex;

    const vehicles = result.analysis || [];
    const confidence = this.getAverageConfidence(result);

    vehiclesContainer.innerHTML = vehicles.length > 0 ?
      vehicles.map((vehicle, index) => this.createVehicleEditorHTML(vehicle, index, result.fileName, actualImageIndex)).join('') :
      `<div class="lv-no-vehicle">
        <p>No vehicles detected in this image</p>
        <button class="lv-add-vehicle-btn" data-action="add" data-file-name="${result.fileName}">
          + Add Manual Recognition
        </button>
      </div>`;

    // Update metadata info
    const confidenceEl = document.getElementById('lv-confidence');
    if (confidenceEl) {
      confidenceEl.textContent = `${Math.round(confidence * 100)}%`;
      confidenceEl.className = `lv-info-value confidence-${confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low'}`;
    }

    // Add timestamp if available from log
    const analysisTimeEl = document.getElementById('lv-analysis-time');
    if (analysisTimeEl && result.logEvent) {
      const timestamp = new Date(result.logEvent.timestamp);
      analysisTimeEl.textContent = timestamp.toLocaleTimeString();
    }

    // Setup event delegation for vehicle editor buttons
    this.setupVehicleEditorEvents();
  }

  /**
   * Setup event delegation for vehicle editor buttons
   */
  setupVehicleEditorEvents() {
    const vehiclesContainer = document.getElementById('lv-vehicles');
    if (!vehiclesContainer) return;

    // Remove previous listeners to avoid duplicates
    vehiclesContainer.replaceWith(vehiclesContainer.cloneNode(true));
    const newContainer = document.getElementById('lv-vehicles');

    // Add event delegation for all vehicle editor buttons
    newContainer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const vehicleIndex = parseInt(button.dataset.vehicleIndex);
      const fileName = button.dataset.fileName;

      console.log(`[LogVisualizer] Button clicked:`, { action, vehicleIndex, fileName });

      switch (action) {
        case 'save':
          this.saveVehicleChangesByFileName(fileName, vehicleIndex);
          break;
        case 'reset':
          this.resetVehicleByFileName(fileName, vehicleIndex);
          break;
        case 'delete':
          this.deleteVehicleByFileName(fileName, vehicleIndex);
          break;
        case 'add':
          this.addVehicleByFileName(fileName);
          break;
      }
    });
  }

  /**
   * Create vehicle editor HTML
   */
  createVehicleEditorHTML(vehicle, vehicleIndex, fileName, imageIndex) {
    const isModified = this.manualCorrections.has(`${fileName}_${vehicleIndex}`);

    return `
      <div class="lv-vehicle-editor ${isModified ? 'modified' : ''}" data-vehicle-index="${vehicleIndex}" data-image-index="${imageIndex}" data-file-name="${fileName}">
        <div class="lv-vehicle-header">
          <h5>Vehicle ${vehicleIndex + 1}</h5>
          ${isModified ? '<span class="lv-modified-indicator">✏️ Modified</span>' : ''}
          <button class="lv-delete-vehicle" data-action="delete" data-vehicle-index="${vehicleIndex}" data-file-name="${fileName}">🗑️</button>
        </div>

        <div class="lv-editor-fields">
          <div class="lv-field-group">
            <label>Race Number:</label>
            <input type="text"
                   class="lv-edit-input"
                   data-field="raceNumber"
                   value="${vehicle.raceNumber || ''}"
                   placeholder="Enter number..." />
          </div>

          <div class="lv-field-group">
            <label>Team:</label>
            <input type="text"
                   class="lv-edit-input"
                   data-field="team"
                   value="${vehicle.team || ''}"
                   placeholder="Enter team name..." />
          </div>

          <div class="lv-field-group">
            <label>Drivers:</label>
            <input type="text"
                   class="lv-edit-input"
                   data-field="drivers"
                   value="${(vehicle.drivers || []).join(', ')}"
                   placeholder="Enter driver names..." />
          </div>

          <div class="lv-field-group">
            <label>Confidence:</label>
            <span class="lv-confidence-display">${Math.round((vehicle.confidence || 0) * 100)}%</span>
          </div>
        </div>

        <div class="lv-editor-actions">
          <button class="lv-save-vehicle" data-action="save" data-vehicle-index="${vehicleIndex}" data-file-name="${fileName}">
            💾 Save Changes
          </button>
          <button class="lv-reset-vehicle" data-action="reset" data-vehicle-index="${vehicleIndex}" data-file-name="${fileName}">
            🔄 Reset
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Get fileName from context when we can't determine imageIndex
   */
  getFileNameFromContext(vehicleEditor) {
    // Try to find fileName from nearby elements or data attributes
    if (vehicleEditor.dataset.fileName) {
      return vehicleEditor.dataset.fileName;
    }

    // Look for fileName in parent containers
    let parent = vehicleEditor.parentElement;
    while (parent) {
      if (parent.dataset.fileName) {
        return parent.dataset.fileName;
      }
      parent = parent.parentElement;
    }

    return null;
  }

  /**
   * Save changes for a specific vehicle
   */
  async saveVehicleChanges(imageIndex, vehicleIndex) {
    try {
      console.log(`[LogVisualizer] saveVehicleChanges called with:`, {
        imageIndex,
        vehicleIndex,
        imageIndexType: typeof imageIndex,
        vehicleIndexType: typeof vehicleIndex,
        filteredResultsLength: this.filteredResults.length,
        isGalleryOpen: this.isGalleryOpen,
        currentImageIndex: this.currentImageIndex
      });

      // Handle undefined/NaN imageIndex by reading from DOM
      if (imageIndex === undefined || isNaN(imageIndex)) {
        const vehicleEditor = document.querySelector(`[data-vehicle-index="${vehicleIndex}"]`);
        console.log(`[LogVisualizer] Looking for vehicleEditor with data-vehicle-index="${vehicleIndex}":`, {
          found: !!vehicleEditor,
          dataImageIndex: vehicleEditor?.dataset?.imageIndex,
          dataFileName: vehicleEditor?.dataset?.fileName
        });

        if (vehicleEditor && vehicleEditor.dataset.imageIndex) {
          const parsedIndex = parseInt(vehicleEditor.dataset.imageIndex);
          console.log(`[LogVisualizer] Parsing data-image-index="${vehicleEditor.dataset.imageIndex}":`, {
            parsedIndex,
            isNaN: isNaN(parsedIndex),
            isValid: !isNaN(parsedIndex) && parsedIndex >= 0
          });

          if (!isNaN(parsedIndex) && parsedIndex >= 0) {
            imageIndex = parsedIndex;
          } else {
            // Fallback: find index by fileName from closest result
            const fileName = this.getFileNameFromContext(vehicleEditor);
            console.log(`[LogVisualizer] Using fileName fallback:`, { fileName });
            if (fileName) {
              imageIndex = this.filteredResults.findIndex(r => r.fileName === fileName);
              console.log(`[LogVisualizer] Found index by fileName:`, { imageIndex });
            }
          }
        }

        if (imageIndex === undefined || isNaN(imageIndex) || imageIndex < 0) {
          throw new Error('Cannot determine valid image index');
        }
      }

      console.log(`[LogVisualizer] Final validation before processing:`, {
        finalImageIndex: imageIndex,
        finalImageIndexType: typeof imageIndex,
        isValid: imageIndex >= 0 && imageIndex < this.filteredResults.length,
        filteredResultsLength: this.filteredResults.length
      });

      if (imageIndex < 0 || imageIndex >= this.filteredResults.length) {
        console.error(`[LogVisualizer] Invalid image index: ${imageIndex} (length: ${this.filteredResults.length})`);
        throw new Error('Invalid image index');
      }

      const result = this.filteredResults[imageIndex];
      if (!result) {
        throw new Error('Image not found at index ' + imageIndex);
      }

      const fileName = result.fileName;
      const vehicleEditor = document.querySelector(`[data-vehicle-index="${vehicleIndex}"]`);
      if (!vehicleEditor) return;

      const inputs = vehicleEditor.querySelectorAll('.lv-edit-input');
      const changes = {};

      inputs.forEach(input => {
        const field = input.dataset.field;
        let value = input.value.trim();

        if (field === 'drivers' && value) {
          value = value.split(',').map(d => d.trim()).filter(d => d);
        }

        changes[field] = value;
      });

      // Store manual correction
      const correctionKey = `${fileName}_${vehicleIndex}`;
      this.manualCorrections.set(correctionKey, {
        fileName,
        vehicleIndex,
        changes,
        timestamp: new Date().toISOString()
      });

      // Update the result data directly (we already have the correct result)
      if (result.analysis && result.analysis[vehicleIndex]) {
        Object.assign(result.analysis[vehicleIndex], changes);

        // Set confidence to 100% for manual corrections
        result.analysis[vehicleIndex].confidence = 1.0;

        // Update UI
        this.updateVehicleEditor(result, imageIndex);
        this.updateStatistics();

        // Show feedback
        this.showNotification('✅ Changes saved successfully', 'success');
        console.log(`[LogVisualizer] Saved manual correction for ${fileName} vehicle ${vehicleIndex}:`, changes);
      } else {
        console.error(`[LogVisualizer] Invalid vehicle index ${vehicleIndex} for ${fileName}`);
        this.showNotification('❌ Invalid vehicle data', 'error');
      }

    } catch (error) {
      console.error('[LogVisualizer] Error saving vehicle changes:', error);
      this.showNotification('❌ Error saving changes', 'error');
    }
  }

  /**
   * Save changes for a specific vehicle using fileName (event delegation version)
   */
  async saveVehicleChangesByFileName(fileName, vehicleIndex) {
    try {
      console.log(`[LogVisualizer] saveVehicleChangesByFileName called with:`, {
        fileName,
        vehicleIndex,
        filteredResultsLength: this.filteredResults.length,
        isGalleryOpen: this.isGalleryOpen
      });

      // If filteredResults is empty, try to work with imageResults directly
      let results = this.filteredResults.length > 0 ? this.filteredResults : this.imageResults;

      // Find the result by fileName
      const result = results.find(r => r.fileName === fileName);
      if (!result) {
        console.error(`[LogVisualizer] Result not found for fileName: ${fileName}`);
        this.showNotification('❌ Image not found', 'error');
        return;
      }

      // Check if vehicle exists
      if (!result.analysis || !result.analysis[vehicleIndex]) {
        console.error(`[LogVisualizer] Vehicle ${vehicleIndex} not found for ${fileName}`);
        this.showNotification('❌ Vehicle not found', 'error');
        return;
      }

      // Get form inputs from the vehicle editor
      const vehicleEditor = document.querySelector(`[data-vehicle-index="${vehicleIndex}"][data-file-name="${fileName}"]`);
      if (!vehicleEditor) {
        console.error(`[LogVisualizer] Vehicle editor not found for ${fileName}_${vehicleIndex}`);
        this.showNotification('❌ Editor not found', 'error');
        return;
      }

      const inputs = vehicleEditor.querySelectorAll('.lv-edit-input');
      const changes = {};

      inputs.forEach(input => {
        const field = input.dataset.field;
        let value = input.value.trim();

        if (field === 'drivers' && value) {
          value = value.split(',').map(d => d.trim()).filter(d => d);
        }

        changes[field] = value;
      });

      // Store manual correction
      const correctionKey = `${fileName}_${vehicleIndex}`;
      this.manualCorrections.set(correctionKey, {
        fileName,
        vehicleIndex,
        changes,
        timestamp: new Date().toISOString()
      });

      // Update the result data directly
      Object.assign(result.analysis[vehicleIndex], changes);

      // Set confidence to 100% for manual corrections
      result.analysis[vehicleIndex].confidence = 1.0;

      // Update UI - find the current index if in gallery
      let currentIndex = -1;
      if (this.isGalleryOpen) {
        currentIndex = this.filteredResults.findIndex(r => r.fileName === fileName);
        if (currentIndex >= 0) {
          this.updateVehicleEditor(result, currentIndex);
        }
      }

      this.updateStatistics();

      // Immediately persist the change to disk
      const persistSuccess = await this.persistSingleCorrection(correctionKey, {
        fileName,
        vehicleIndex,
        changes,
        timestamp: new Date().toISOString()
      });

      // If immediate persistence failed, schedule auto-save as fallback
      if (!persistSuccess) {
        this.scheduleAutoSave();
      }

      // Show feedback
      this.showNotification('✅ Changes saved and persisted', 'success');
      console.log(`[LogVisualizer] Saved and persisted manual correction for ${fileName} vehicle ${vehicleIndex}:`, changes);

    } catch (error) {
      console.error('[LogVisualizer] Error saving vehicle changes by fileName:', error);
      this.showNotification('❌ Error saving changes', 'error');
    }
  }

  /**
   * Persist a single correction immediately to disk
   */
  async persistSingleCorrection(correctionKey, correction) {
    try {
      console.log(`[LogVisualizer] Persisting single correction: ${correctionKey}`);

      // Create a clean copy of the correction to avoid circular references
      const cleanCorrection = {
        fileName: correction.fileName,
        vehicleIndex: correction.vehicleIndex,
        timestamp: correction.timestamp,
        changes: {}
      };

      // Copy changes with only primitive values
      if (correction.changes) {
        for (const [key, value] of Object.entries(correction.changes)) {
          // Only copy primitive values to avoid circular references
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
            cleanCorrection.changes[key] = value;
          }
        }
      }

      // Send single correction to main process for immediate persistence
      const result = await window.api.invoke('update-analysis-log', {
        executionId: this.executionId,
        corrections: [cleanCorrection],
        timestamp: new Date().toISOString()
      });

      if (result.success) {
        console.log(`[LogVisualizer] Successfully persisted correction for ${correction.fileName}_${correction.vehicleIndex}`);
        return true;
      } else {
        console.error(`[LogVisualizer] Failed to persist correction:`, result.error);
        this.showNotification('⚠️ Save successful but persistence failed', 'warning');
        return false;
      }

    } catch (error) {
      console.error('[LogVisualizer] Error persisting single correction:', error);
      this.showNotification('⚠️ Save successful but persistence failed', 'warning');
      return false;
    }
  }

  /**
   * Schedule auto-save with debouncing
   */
  scheduleAutoSave() {
    // Clear existing timer
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Set flag for unsaved changes
    this.hasUnsavedChanges = true;

    // Schedule auto-save after 3 seconds of inactivity
    this.autoSaveTimer = setTimeout(async () => {
      if (this.hasUnsavedChanges && this.manualCorrections.size > 0) {
        console.log('[LogVisualizer] Auto-saving changes...');

        try {
          // Get only corrections that haven't been saved since last auto-save
          const corrections = Array.from(this.manualCorrections.values()).filter(correction => {
            return !this.lastSaveTimestamp || new Date(correction.timestamp) > new Date(this.lastSaveTimestamp);
          });

          if (corrections.length > 0) {
            // Create clean copies of corrections to avoid circular references
            const cleanCorrections = corrections.map(correction => ({
              fileName: correction.fileName,
              vehicleIndex: correction.vehicleIndex,
              timestamp: correction.timestamp,
              changes: correction.changes ? Object.fromEntries(
                Object.entries(correction.changes).filter(([key, value]) =>
                  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)
                )
              ) : {}
            }));

            const result = await window.api.invoke('update-analysis-log', {
              executionId: this.executionId,
              corrections: cleanCorrections,
              timestamp: new Date().toISOString()
            });

            if (result.success) {
              this.lastSaveTimestamp = new Date().toISOString();
              this.hasUnsavedChanges = false;
              this.showNotification(`🔄 Auto-saved ${corrections.length} changes`, 'info');
              console.log(`[LogVisualizer] Auto-saved ${corrections.length} corrections`);
            }
          }
        } catch (error) {
          console.error('[LogVisualizer] Auto-save failed:', error);
        }
      }
    }, 3000); // 3 seconds debounce
  }

  /**
   * Perform auto-save immediately (used by closeGallery)
   */
  async performAutoSave() {
    if (!this.hasUnsavedChanges || this.manualCorrections.size === 0) {
      return;
    }

    console.log('[LogVisualizer] Performing immediate auto-save...');

    try {
      // Get all manual corrections
      const corrections = Array.from(this.manualCorrections.values());

      if (corrections.length > 0) {
        // Create clean copies of corrections to avoid circular references
        const cleanCorrections = corrections.map(correction => ({
          fileName: correction.fileName,
          vehicleIndex: correction.vehicleIndex,
          timestamp: correction.timestamp,
          changes: correction.changes ? Object.fromEntries(
            Object.entries(correction.changes).filter(([key, value]) =>
              typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)
            )
          ) : {}
        }));

        const result = await window.api.invoke('update-analysis-log', {
          executionId: this.executionId,
          corrections: cleanCorrections,
          timestamp: new Date().toISOString()
        });

        if (result.success) {
          this.lastSaveTimestamp = new Date().toISOString();
          this.hasUnsavedChanges = false;
          console.log(`[LogVisualizer] Auto-saved ${corrections.length} corrections immediately`);
        } else {
          console.error('[LogVisualizer] Failed to auto-save:', result.error);
        }
      }
    } catch (error) {
      console.error('[LogVisualizer] Error during immediate auto-save:', error);
    }
  }

  /**
   * Clean an object for JSON serialization, removing circular references
   */
  cleanObjectForSerialization(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.cleanObjectForSerialization(item));
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        cleaned[key] = value;
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        cleaned[key] = value;
      } else if (Array.isArray(value)) {
        cleaned[key] = value.map(item => {
          if (typeof item === 'object' && item !== null) {
            return this.cleanObjectForSerialization(item);
          }
          return item;
        });
      } else if (typeof value === 'object') {
        // Skip properties that might cause circular references
        if (key === 'corrections' || key === 'originalValues') {
          continue;
        }
        cleaned[key] = this.cleanObjectForSerialization(value);
      }
    }
    return cleaned;
  }

  /**
   * Reset vehicle by fileName (event delegation version)
   */
  async resetVehicleByFileName(fileName, vehicleIndex) {
    console.log(`[LogVisualizer] resetVehicleByFileName called:`, { fileName, vehicleIndex });
    // TODO: Implement reset functionality
    this.showNotification('🔄 Reset functionality to be implemented', 'info');
  }

  /**
   * Delete vehicle by fileName (event delegation version)
   */
  async deleteVehicleByFileName(fileName, vehicleIndex) {
    try {
      console.log(`[LogVisualizer] deleteVehicleByFileName called:`, { fileName, vehicleIndex });

      // Ask for confirmation
      const confirmDelete = confirm(`Are you sure you want to delete Vehicle ${vehicleIndex + 1} from ${fileName}?\n\nThis action cannot be undone.`);
      if (!confirmDelete) {
        console.log(`[LogVisualizer] Delete cancelled by user for ${fileName} vehicle ${vehicleIndex}`);
        return;
      }

      // Find the result by fileName
      let results = this.filteredResults.length > 0 ? this.filteredResults : this.imageResults;
      const result = results.find(r => r.fileName === fileName);

      if (!result) {
        console.error(`[LogVisualizer] Result not found for fileName: ${fileName}`);
        this.showNotification('❌ Error: Image not found', 'error');
        return;
      }

      if (!result.analysis || !Array.isArray(result.analysis)) {
        console.error(`[LogVisualizer] No analysis data found for ${fileName}`);
        this.showNotification('❌ Error: No vehicle data found', 'error');
        return;
      }

      if (vehicleIndex < 0 || vehicleIndex >= result.analysis.length) {
        console.error(`[LogVisualizer] Invalid vehicleIndex ${vehicleIndex} for ${fileName} (has ${result.analysis.length} vehicles)`);
        this.showNotification('❌ Error: Invalid vehicle index', 'error');
        return;
      }

      // Save original data for the correction log
      const originalVehicle = { ...result.analysis[vehicleIndex] };
      console.log(`[LogVisualizer] Deleting vehicle:`, originalVehicle);

      // Remove the vehicle from the analysis array
      result.analysis.splice(vehicleIndex, 1);
      console.log(`[LogVisualizer] Vehicle deleted. Remaining vehicles: ${result.analysis.length}`);

      // Update the result in both arrays to maintain consistency
      const mainResult = this.imageResults.find(r => r.fileName === fileName);
      if (mainResult && mainResult !== result) {
        mainResult.analysis = [...result.analysis];
      }

      // Track this as a manual correction
      const correctionKey = `${fileName}_${vehicleIndex}`;
      const changes = {
        deleted: true,
        deletedAt: new Date().toISOString(),
        originalData: originalVehicle
      };

      this.manualCorrections.set(correctionKey, {
        fileName,
        vehicleIndex,
        changes,
        timestamp: new Date().toISOString()
      });

      // Update the UI immediately
      if (this.isGalleryOpen) {
        // If gallery is open, update the vehicle editor
        const currentIndex = this.filteredResults.findIndex(r => r.fileName === fileName);
        if (currentIndex >= 0) {
          this.updateVehicleEditor(result, currentIndex);
        }
      }

      // Re-render the grid to reflect changes
      this.renderResults();

      // Update statistics
      this.updateStatistics();

      // Immediately persist the change to disk
      const persistSuccess = await this.persistSingleCorrection(correctionKey, {
        fileName,
        vehicleIndex,
        changes,
        timestamp: new Date().toISOString()
      });

      // If immediate persistence failed, schedule auto-save as fallback
      if (!persistSuccess) {
        this.scheduleAutoSave();
      }

      // Show feedback
      this.showNotification(`🗑️ Vehicle ${vehicleIndex + 1} deleted successfully`, 'success');
      console.log(`[LogVisualizer] Successfully deleted vehicle ${vehicleIndex} from ${fileName}`);

    } catch (error) {
      console.error('[LogVisualizer] Error deleting vehicle:', error);
      this.showNotification('❌ Error deleting vehicle', 'error');
    }
  }

  /**
   * Add vehicle by fileName (event delegation version)
   */
  async addVehicleByFileName(fileName) {
    try {
      console.log(`[LogVisualizer] addVehicleByFileName called:`, { fileName });

      // Find the result by fileName
      let results = this.filteredResults.length > 0 ? this.filteredResults : this.imageResults;
      const result = results.find(r => r.fileName === fileName);

      if (!result) {
        console.error(`[LogVisualizer] Result not found for fileName: ${fileName}`);
        this.showNotification('❌ Image not found', 'error');
        return;
      }

      if (!result.analysis) result.analysis = [];

      result.analysis.push({
        raceNumber: '',
        team: '',
        drivers: [],
        confidence: 1.0 // Manual additions are 100% confidence
      });

      // Update UI if in gallery
      if (this.isGalleryOpen) {
        const currentIndex = this.filteredResults.findIndex(r => r.fileName === fileName);
        if (currentIndex >= 0) {
          this.updateVehicleEditor(result, currentIndex);
        }
      }

      this.updateStatistics();
      this.showNotification('✅ Vehicle added successfully', 'success');

    } catch (error) {
      console.error('[LogVisualizer] Error adding vehicle by fileName:', error);
      this.showNotification('❌ Error adding vehicle', 'error');
    }
  }

  /**
   * Add a new vehicle recognition
   */
  addVehicle(imageIndex = null) {
    // Use provided imageIndex or current gallery index
    const actualImageIndex = imageIndex !== null ? imageIndex : this.currentImageIndex;

    if (actualImageIndex < 0 || actualImageIndex >= this.filteredResults.length) {
      return;
    }

    const result = this.filteredResults[actualImageIndex];
    if (!result) return;

    if (!result.analysis) result.analysis = [];

    result.analysis.push({
      raceNumber: '',
      team: '',
      drivers: [],
      confidence: 1.0 // Manual additions are 100% confidence
    });

    this.updateVehicleEditor(result, actualImageIndex);
    this.showNotification('✅ New vehicle added', 'success');
  }

  /**
   * Delete a vehicle recognition
   */
  deleteVehicle(imageIndex, vehicleIndex) {
    if (!confirm('Are you sure you want to delete this vehicle recognition?')) {
      return;
    }

    // Handle undefined/NaN imageIndex by reading from DOM
    if (imageIndex === undefined || isNaN(imageIndex)) {
      const vehicleEditor = document.querySelector(`[data-vehicle-index="${vehicleIndex}"]`);
      if (vehicleEditor && vehicleEditor.dataset.imageIndex) {
        const parsedIndex = parseInt(vehicleEditor.dataset.imageIndex);
        if (!isNaN(parsedIndex) && parsedIndex >= 0) {
          imageIndex = parsedIndex;
        } else {
          // Fallback: find index by fileName from closest result
          const fileName = this.getFileNameFromContext(vehicleEditor);
          if (fileName) {
            imageIndex = this.filteredResults.findIndex(r => r.fileName === fileName);
          }
        }
      }

      if (imageIndex === undefined || isNaN(imageIndex) || imageIndex < 0) {
        console.error('Cannot determine valid image index for delete');
        return;
      }
    }

    if (imageIndex < 0 || imageIndex >= this.filteredResults.length) {
      return;
    }

    const result = this.filteredResults[imageIndex];
    if (!result || !result.analysis) return;

    result.analysis.splice(vehicleIndex, 1);

    // Remove from manual corrections if it was modified
    const correctionKey = `${result.fileName}_${vehicleIndex}`;
    this.manualCorrections.delete(correctionKey);

    this.updateVehicleEditor(result, imageIndex);
    this.updateStatistics();
    this.showNotification('✅ Vehicle deleted', 'success');
  }

  /**
   * Reset vehicle to original values
   */
  resetVehicle(imageIndex, vehicleIndex) {
    if (!confirm('Reset this vehicle to original recognition?')) {
      return;
    }

    // Handle undefined/NaN imageIndex by reading from DOM
    if (imageIndex === undefined || isNaN(imageIndex)) {
      const vehicleEditor = document.querySelector(`[data-vehicle-index="${vehicleIndex}"]`);
      if (vehicleEditor && vehicleEditor.dataset.imageIndex) {
        const parsedIndex = parseInt(vehicleEditor.dataset.imageIndex);
        if (!isNaN(parsedIndex) && parsedIndex >= 0) {
          imageIndex = parsedIndex;
        } else {
          // Fallback: find index by fileName from closest result
          const fileName = this.getFileNameFromContext(vehicleEditor);
          if (fileName) {
            imageIndex = this.filteredResults.findIndex(r => r.fileName === fileName);
          }
        }
      }

      if (imageIndex === undefined || isNaN(imageIndex) || imageIndex < 0) {
        console.error('Cannot determine valid image index for reset');
        return;
      }
    }

    if (imageIndex < 0 || imageIndex >= this.filteredResults.length) {
      return;
    }

    const result = this.filteredResults[imageIndex];
    if (!result) return;

    // Remove manual correction to reset to original values
    const correctionKey = `${result.fileName}_${vehicleIndex}`;
    this.manualCorrections.delete(correctionKey);

    // Refresh the UI to show original values
    this.updateVehicleEditor(result, imageIndex);
    this.showNotification('🔄 Vehicle reset to original values', 'success');
  }

  /**
   * Save all manual corrections to log and metadata
   */
  async saveAllChanges() {
    if (this.manualCorrections.size === 0) {
      this.showNotification('ℹ️ No changes to save', 'info');
      return;
    }

    try {
      this.showNotification('💾 Saving all changes...', 'info');

      // Prepare correction data
      const corrections = Array.from(this.manualCorrections.values());

      // Send to main process for log update and metadata writing
      const result = await window.api.invoke('update-analysis-log', {
        executionId: this.executionId,
        corrections,
        timestamp: new Date().toISOString()
      });

      if (result.success) {
        this.showNotification(`✅ Successfully saved ${corrections.length} corrections`, 'success');
        // Clear manual corrections since they're now persisted
        this.manualCorrections.clear();
        // Clear the unsaved changes flag to prevent beforeunload warning
        this.hasUnsavedChanges = false;
        this.updateStatistics();

        // IMPORTANT: Refresh data to show updated results immediately
        await this.refreshDataFromLogs();
        console.log('[LogVisualizer] Data refreshed after successful save');
      } else {
        throw new Error(result.error);
      }

    } catch (error) {
      console.error('[LogVisualizer] Error saving all changes:', error);
      this.showNotification('❌ Error saving changes: ' + error.message, 'error');
    }
  }

  /**
   * Refresh data from updated logs after save
   */
  async refreshDataFromLogs() {
    try {
      console.log('[LogVisualizer] Refreshing data from updated logs...');

      // Reload the log data
      const logData = await window.api.invoke('get-analysis-log', this.executionId);

      if (logData && logData.length > 0) {
        // Re-extract results from logs (like results-page does)
        const updatedResults = await this.extractResultsFromLogs(logData);

        if (updatedResults && updatedResults.length > 0) {
          // Update the internal data
          this.imageResults = updatedResults;
          this.filteredResults = [...this.imageResults];

          // Re-render the interface with updated data
          this.render(this.currentContainer);

          console.log(`[LogVisualizer] Successfully refreshed ${updatedResults.length} results`);
        }
      }
    } catch (error) {
      console.error('[LogVisualizer] Error refreshing data from logs:', error);
      this.showNotification('⚠️ Could not refresh data from logs', 'warning');
    }
  }

  /**
   * Extract results from log data (supporting multiple vehicles)
   */
  async extractResultsFromLogs(logData) {
    const imageAnalysisEvents = logData.filter(event => event.type === 'IMAGE_ANALYSIS');
    const manualCorrectionEvents = logData.filter(event => event.type === 'MANUAL_CORRECTION');

    // First, extract initial results from IMAGE_ANALYSIS events
    let results = imageAnalysisEvents.map(event => {
      // Estrai TUTTI i veicoli dall'aiResponse
      const vehicles = event.aiResponse?.vehicles || [];
      const analysis = vehicles.map(vehicle => ({
        raceNumber: vehicle.finalResult?.raceNumber || 'N/A',
        team: vehicle.finalResult?.team || null,
        drivers: vehicle.finalResult?.drivers || [],
        confidence: vehicle.confidence || 0,
        matchedBy: vehicle.finalResult?.matchedBy || 'none'
      }));

      return {
        fileName: event.fileName,
        analysis: analysis,
        csvMatch: event.csvMatch,
        timestamp: event.timestamp,
        executionId: event.executionId,
        imageId: event.imageId,
        // Include path information if available
        originalPath: event.originalPath,
        thumbnailPath: event.thumbnailPath,
        compressedPath: event.compressedPath
      };
    });

    // Then, apply MANUAL_CORRECTION events
    console.log(`[LogVisualizer] Applying ${manualCorrectionEvents.length} manual corrections to extracted results`);

    manualCorrectionEvents.forEach(correction => {
      const { fileName, vehicleIndex, changes } = correction;

      // Find the result for this correction
      const result = results.find(r => r.fileName === fileName);
      if (!result) {
        console.warn(`[LogVisualizer] No result found for correction: ${fileName}`);
        return;
      }

      // Apply the correction based on its type
      if (changes && changes.deleted) {
        // Handle deletion: remove the vehicle from analysis
        if (result.analysis && vehicleIndex >= 0 && vehicleIndex < result.analysis.length) {
          console.log(`[LogVisualizer] Applying deletion: ${fileName} vehicle ${vehicleIndex}`);
          result.analysis.splice(vehicleIndex, 1);
        }
      } else if (changes) {
        // Handle update: modify vehicle properties
        if (result.analysis && result.analysis[vehicleIndex]) {
          console.log(`[LogVisualizer] Applying update: ${fileName} vehicle ${vehicleIndex}`, changes);

          // Apply each field change
          Object.entries(changes).forEach(([field, value]) => {
            if (field !== 'deleted' && field !== 'deletedAt' && field !== 'originalData') {
              result.analysis[vehicleIndex][field] = value;
            }
          });

          // Set confidence to 100% for manually corrected vehicles
          result.analysis[vehicleIndex].confidence = 1.0;
        }
      }
    });

    console.log(`[LogVisualizer] Extracted ${results.length} results with corrections applied`);
    return results;
  }

  /**
   * Export results to CSV
   */
  async exportResults() {
    try {
      const csvData = this.generateCSVData();
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `racetagger_results_${this.executionId || Date.now()}.csv`;
      a.click();

      URL.revokeObjectURL(url);
      this.showNotification('📊 Results exported successfully', 'success');

    } catch (error) {
      console.error('[LogVisualizer] Export error:', error);
      this.showNotification('❌ Error exporting results', 'error');
    }
  }

  /**
   * Generate CSV data from results
   */
  generateCSVData() {
    const headers = ['Filename', 'Race Number', 'Team', 'Drivers', 'Confidence', 'CSV Match', 'Manual Correction'];
    const rows = [headers.join(',')];

    this.filteredResults.forEach(result => {
      const vehicles = result.analysis || [];

      if (vehicles.length === 0) {
        rows.push([
          `"${result.fileName}"`,
          '""',
          '""',
          '""',
          '0',
          result.csvMatch ? 'Yes' : 'No',
          this.manualCorrections.has(result.fileName) ? 'Yes' : 'No'
        ].join(','));
      } else {
        vehicles.forEach((vehicle, index) => {
          const correctionKey = `${result.fileName}_${index}`;
          rows.push([
            `"${result.fileName}"`,
            `"${vehicle.raceNumber || ''}"`,
            `"${vehicle.team || ''}"`,
            `"${(vehicle.drivers || []).join('; ')}"`,
            Math.round((vehicle.confidence || 0) * 100),
            result.csvMatch ? 'Yes' : 'No',
            this.manualCorrections.has(correctionKey) ? 'Yes' : 'No'
          ].join(','));
        });
      }
    });

    return rows.join('\n');
  }

  /**
   * Export training labels in specified format
   */
  async exportTrainingLabels(format) {
    try {
      if (!this.executionId) {
        this.showNotification('ℹ️ No execution available for export', 'info');
        return;
      }

      const formatLabels = {
        coco: 'COCO JSON',
        yolo: 'YOLO TXT',
        csv: 'CSV'
      };

      this.showNotification(`🏷️ Exporting training labels (${formatLabels[format]})...`, 'info');
      console.log(`[LogVisualizer] Exporting training labels for execution ${this.executionId} in ${format} format`);

      // Get Supabase client from window
      const supabase = window.supabaseClient;
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Call export edge function
      const { data, error } = await supabase.functions.invoke('export-training-labels', {
        body: {
          executionId: this.executionId,
          format: format,
          minConfidence: 0.0
        }
      });

      if (error) {
        console.error('[LogVisualizer] Export error:', error);
        throw error;
      }

      // Handle the response based on format
      let blob;
      let filename;

      if (format === 'coco') {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `training_labels_${this.executionId}_coco.json`;
      } else if (format === 'yolo') {
        // YOLO format returns JSON with file contents
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `training_labels_${this.executionId}_yolo.json`;
      } else if (format === 'csv') {
        blob = new Blob([data], { type: 'text/csv' });
        filename = `training_labels_${this.executionId}.csv`;
      }

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      this.showNotification(`✅ Training labels exported (${formatLabels[format]})`, 'success');

    } catch (error) {
      console.error('[LogVisualizer] Export training labels error:', error);

      if (error.message?.includes('No annotations with bounding boxes found')) {
        this.showNotification('ℹ️ No bounding box data found. Enable Advanced Annotations in settings.', 'info');
      } else {
        this.showNotification('❌ Error exporting training labels', 'error');
      }
    }
  }

  /**
   * View full log data
   */
  async viewFullLog() {
    try {
      if (!this.executionId) {
        this.showNotification('ℹ️ No execution log available', 'info');
        return;
      }

      // Open log viewer (placeholder for now)
      this.showNotification('📋 Full log viewer coming soon', 'info');
      console.log('[LogVisualizer] Full log data:', this.logData);

    } catch (error) {
      console.error('[LogVisualizer] Error viewing log:', error);
      this.showNotification('❌ Error viewing log', 'error');
    }
  }

  /**
   * Show notification to user
   */
  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `lv-notification lv-notification-${type}`;
    notification.textContent = message;

    // Add to page
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);

    // Remove after delay
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Global instance
window.logVisualizer = new LogVisualizer();

console.log('[LogVisualizer] Module loaded');