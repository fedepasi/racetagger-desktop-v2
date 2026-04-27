/**
 * Log Visualizer Dashboard
 * Interactive results viewer with manual correction capabilities
 */

class LogVisualizer {
  constructor() {
    this.executionId = null;
    this.execution = null; // Store full execution object
    this.logData = [];
    this.imageResults = [];
    this.filteredResults = [];
    this.currentImageIndex = 0;
    this.isGalleryOpen = false;
    this.zoomController = null;
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
    this.dataUrlCache = new Map(); // Cache IPC data URLs by fileName to survive DOM re-renders

    // Error handling and throttling
    this.loggedErrors = new Set(); // Track logged errors to prevent spam
    this.failedImages = new Set(); // Track failed images to avoid retrying
    this.failedPaths = new Set(); // Track failed file paths to avoid repeated IPC calls

    // Auto-save functionality
    this.autoSaveTimer = null;
    this.hasUnsavedChanges = false;
    this.lastSaveTimestamp = null;

    // Folder organization status
    this.wasAlreadyOrganized = false; // Will be set during init
    this.moveOrganizationCompleted = false; // Tracks if move was already done

    // Participant preset data for autocomplete
    this.participantPresetData = null;
    this.presetParticipants = [];

    console.log('[LogVisualizer] Initialized');
  }

  /**
   * Initialize the visualizer with execution data
   */
  async init(executionId, results, execution = null) {
    this.executionId = executionId;
    this.execution = execution;
    this.imageResults = results || [];
    this.filteredResults = [...this.imageResults];

    console.log(`[LogVisualizer] Initializing with execution ${executionId} and ${results.length} results`);

    // Check if folder organization was already enabled during analysis
    if (execution) {
      this.wasAlreadyOrganized = execution.folder_organization_enabled === true;
      console.log(`[LogVisualizer] Folder organization was ${this.wasAlreadyOrganized ? 'ENABLED' : 'NOT enabled'} during analysis`);
    }

    // Check if a move organization was already completed for this execution
    try {
      const moveStatus = await window.api.invoke('check-organization-move-completed', executionId);
      this.moveOrganizationCompleted = moveStatus?.completed === true;
      if (this.moveOrganizationCompleted) {
        console.log(`[LogVisualizer] Move organization already completed at ${moveStatus.timestamp}`);
      }
    } catch (error) {
      console.warn('[LogVisualizer] Could not check move organization status:', error);
    }

    // Load participant preset data for autocomplete if available
    await this.loadParticipantPresetData();

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

    // Strategy G: Check for learnable data after initial load
    try {
      this._checkLearnedDataAvailability();
    } catch (e) {
      // Non-critical
    }

    console.log('[LogVisualizer] Initialization complete');
  }

  /**
   * Load participant preset data for autocomplete feature
   */
  async loadParticipantPresetData() {
    try {
      // Check if execution has preset information
      if (!this.execution || !this.execution.execution_settings) {
        console.log('[LogVisualizer] No execution settings available for preset data');
        return;
      }

      const executionSettings = this.execution.execution_settings;

      // Check if preset was used during analysis
      // The preset data might be stored in different formats depending on the version
      const presetId = executionSettings.participantPresetId ||
                      executionSettings.preset_id ||
                      (executionSettings.participantPreset && executionSettings.participantPreset.id);

      if (!presetId) {
        console.log('[LogVisualizer] No participant preset was used during this analysis');
        return;
      }

      console.log(`[LogVisualizer] Loading preset data for preset ID: ${presetId}`);

      // Fetch preset data from Supabase
      const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);

      if (response && response.success && response.data) {
        this.participantPresetData = response.data;
        this.presetParticipants = response.data.participants || [];

        console.log(`[LogVisualizer] Loaded ${this.presetParticipants.length} participants for autocomplete`);
      } else {
        console.warn('[LogVisualizer] Could not load preset data:', response);
      }
    } catch (error) {
      console.warn('[LogVisualizer] Error loading participant preset data:', error);
      // Continue without autocomplete - not a critical error
    }
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
              if (field !== 'deleted' && field !== 'deletedAt' && field !== 'originalData' &&
                  field !== 'resolvedFromReview' && field !== 'chosenCandidate') {
                result.analysis[vehicleIndex][field] = value;
              }
            });

            // If this correction was a review resolution, mark the result accordingly
            if (changes.resolvedFromReview) {
              result._reviewResolved = true;
            }

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

    // Strategy G: Check for learnable data after render
    try { this._checkLearnedDataAvailability(); } catch (e) { /* non-critical */ }

    console.log('[LogVisualizer] Dashboard rendered');
  }

  /**
   * Create the main dashboard HTML structure
   */
  createDashboardHTML() {
    return `
      <div id="log-visualizer-container" class="log-visualizer">
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
              <option value="needs-review">⚠️ Needs Review</option>
              <option value="no-match">No Match Only</option>
              <option value="corrected">Manually Corrected</option>
              <option value="high-confidence">High Confidence (>90%)</option>
              <option value="low-confidence">Low Confidence (<70%)</option>
              <option value="no-metadata">No Metadata Written</option>
            </select>

            <button id="lv-clear-filters" class="lv-clear-btn">Clear Filters</button>
          </div>
        </div>

        <!-- Post-Analysis Folder Organization -->
        ${this.shouldShowFolderOrganizationUI() ? `
        <div class="lv-folder-organization-section" id="lv-folder-org-section">
          ${this.moveOrganizationCompleted ? `
          <div class="lv-folder-org-completed">
            <div class="lv-folder-org-completed-icon">✅</div>
            <div class="lv-folder-org-completed-text">
              <h4>Folder Organization Completed</h4>
              <p>Photos have been moved to their organized folders. Since the files were moved (not copied), they are no longer at their original location and this operation cannot be repeated.</p>
            </div>
          </div>
          ` : `
          <div class="lv-folder-org-header">
            <h4>📁 Organize Photos into Folders</h4>
            <p>Automatically sort your analyzed photos into numbered folders — by car number, driver name, or custom structure</p>
          </div>
          <div class="lv-folder-org-content" id="lv-folder-org-content" style="display: none;">
            <!-- Folder organization configuration will be injected here -->
          </div>
          <div class="lv-folder-org-actions">
            <button id="lv-toggle-folder-org" class="lv-action-btn lv-btn-folder-org">
              ⚙️ Configure & Organize
            </button>
            <button id="lv-start-organization" class="lv-action-btn lv-btn-primary" style="display: none;">
              🚀 Start Organization
            </button>
          </div>
          `}
        </div>
        ` : ''}

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
          <button id="lv-export-tags" class="lv-action-btn lv-btn-tags" style="display: none;">
            🏷️ Export Tags
          </button>
          <button id="lv-save-all" class="lv-action-btn lv-btn-primary">
            💾 Save All Changes
          </button>
          <button id="lv-learned-data" class="lv-action-btn lv-btn-learned" style="display: none;" title="AI detected useful data to improve your preset">
            ✨ <span id="lv-learned-data-count"></span> Improve Preset
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

              <!-- Visual Tags Section -->
              <div class="lv-visual-tags-section" id="lv-visual-tags" style="display: none;">
                <h4>🏷️ Visual Tags</h4>
                <div class="lv-tags-container" id="lv-tags-container">
                  <!-- Tags will be populated dynamically -->
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

    // Stat items as filter shortcuts — click a counter to filter by that category
    // Click the active counter again to reset to "All Results"
    const statFilterMap = {
      'lv-total': 'all',
      'lv-matched': 'matched',
      'lv-needs-review': 'needs-review',
      'lv-no-match': 'no-match',
      'lv-corrections': 'corrected'
    };
    Object.entries(statFilterMap).forEach(([elId, filterValue]) => {
      const statEl = document.getElementById(elId);
      const statItem = statEl?.closest('.results-stat-item');
      if (statItem) {
        statItem.style.cursor = 'pointer';
        statItem.addEventListener('click', () => {
          if (filterSelect) {
            // Toggle: if already active, reset to "all"
            const newValue = filterSelect.value === filterValue ? 'all' : filterValue;
            filterSelect.value = newValue;
            this.filterResults();
          }
        });
      }
    });

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
      if (this.hasUnsavedChanges && this.manualCorrections && this.manualCorrections.size > 0) {
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
    if (overlay) overlay.addEventListener('click', async (e) => { if (e.target === overlay) await this.closeGallery(); });

    // Navigation
    const prevBtn = document.getElementById('lv-gallery-prev');
    const nextBtn = document.getElementById('lv-gallery-next');

    if (prevBtn) prevBtn.addEventListener('click', () => this.navigateGallery(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => this.navigateGallery(1));

    // Zoom controller
    this.zoomController = new GalleryZoomController();
    const zoomImg = document.getElementById('lv-gallery-img');
    const zoomContainer = document.querySelector('.lv-gallery-image-container');
    if (zoomImg && zoomContainer) this.zoomController.attach(zoomImg, zoomContainer);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.isGalleryOpen) return;

      const isInputFocused = document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

      if (!isInputFocused && this.zoomController && this.zoomController.handleKeyDown(e)) {
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case 'Escape':
          if (isInputFocused) {
            document.activeElement.blur();
          } else {
            this.closeGallery();
          }
          break;
        case 'ArrowLeft':
          if (!isInputFocused) this.navigateGallery(-1);
          break;
        case 'ArrowRight':
          if (!isInputFocused) this.navigateGallery(1);
          break;
      }
    });
  }

  /**
   * Setup action button listeners
   */
  setupActionButtons() {
    const exportBtn = document.getElementById('lv-export-csv');
    const exportTagsBtn = document.getElementById('lv-export-tags');
    const saveAllBtn = document.getElementById('lv-save-all');

    // Hide Save All button by default (show only when there are unsaved changes)
    if (saveAllBtn) {
      saveAllBtn.style.display = 'none';
      saveAllBtn.addEventListener('click', () => this.saveAllChanges());
    }

    // Strategy G: Learned data button (hidden until data is available)
    const learnedBtn = document.getElementById('lv-learned-data');
    if (learnedBtn) {
      learnedBtn.style.display = 'none';
      learnedBtn.addEventListener('click', () => this._openLearnedDataModal());
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportResults());
    }

    if (exportTagsBtn) {
      exportTagsBtn.addEventListener('click', () => this.exportTagsAsCSV());
    }

    // Post-analysis folder organization buttons
    const toggleFolderOrgBtn = document.getElementById('lv-toggle-folder-org');
    const startOrganizationBtn = document.getElementById('lv-start-organization');
    const folderOrgContent = document.getElementById('lv-folder-org-content');

    if (toggleFolderOrgBtn && folderOrgContent) {
      toggleFolderOrgBtn.addEventListener('click', () => {
        const isVisible = folderOrgContent.style.display !== 'none';

        if (isVisible) {
          // Hide configuration
          folderOrgContent.style.display = 'none';
          startOrganizationBtn.style.display = 'none';
          toggleFolderOrgBtn.textContent = '⚙️ Configure & Organize';
        } else {
          // Show configuration - inject folder organization UI
          this.injectFolderOrganizationUI();
          folderOrgContent.style.display = 'block';
          startOrganizationBtn.style.display = 'inline-flex';
          toggleFolderOrgBtn.textContent = '🔽 Hide Configuration';
        }
      });
    }

    if (startOrganizationBtn) {
      startOrganizationBtn.addEventListener('click', () => {
        this.triggerPostAnalysisOrganization();
      });
    }
  }

  /**
   * Inject folder organization UI from admin-features
   */
  injectFolderOrganizationUI() {
    const contentDiv = document.getElementById('lv-folder-org-content');
    if (!contentDiv) return;

    const hasPreset = this.presetParticipants && this.presetParticipants.length > 0;

    const folderOrgHTML = `
      <div class="folder-org-config">
        <div class="config-section">
          <h5>Operation Mode:</h5>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="post-org-mode" value="copy" checked>
              <div class="radio-content">
                <div class="radio-title">📋 Copy files</div>
                <div class="form-text">Create organized copies, keep originals</div>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="post-org-mode" value="move">
              <div class="radio-content">
                <div class="radio-title">📦 Move files</div>
                <div class="form-text">Move files to organized folders</div>
              </div>
            </label>
          </div>
        </div>

        <div class="config-section">
          <h5>Folder Naming Pattern:</h5>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="post-folder-pattern" value="number" checked>
              <div class="radio-content">
                <div class="radio-title">🔢 Number only</div>
                <div class="form-text">Example: "42"</div>
              </div>
            </label>
            ${hasPreset ? `<label class="radio-option">
              <input type="radio" name="post-folder-pattern" value="number_name">
              <div class="radio-content">
                <div class="radio-title">👤 Number + Name</div>
                <div class="form-text">Example: "42 John Doe"</div>
              </div>
            </label>` : ''}
          </div>
        </div>

        <div class="config-section">
          <h5>Destination:</h5>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="post-destination" value="default" checked>
              <div class="radio-content">
                <div class="radio-title">📂 Source folder</div>
                <div class="form-text">Creates "Organized_Photos" in the same folder as your images</div>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="post-destination" value="custom">
              <div class="radio-content">
                <div class="radio-title">📁 Custom destination</div>
                <div class="form-text">Choose a specific folder for organized photos</div>
              </div>
            </label>
          </div>
          <div id="post-custom-dest-controls" class="lv-dest-controls" style="display: none;">
            <div class="lv-dest-input-row">
              <input type="text" id="post-dest-path" class="lv-dest-input" placeholder="No folder selected" readonly>
              <button type="button" id="post-select-dest-btn" class="lv-action-btn lv-btn-secondary">📁 Browse</button>
            </div>
          </div>
        </div>

        <div class="config-section">
          <h5>File Conflicts:</h5>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="post-conflict-strategy" value="rename" checked>
              <div class="radio-content">
                <div class="radio-title">🔄 Rename automatically</div>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="post-conflict-strategy" value="skip">
              <div class="radio-content">
                <div class="radio-title">⏭️ Skip duplicates</div>
              </div>
            </label>
          </div>
        </div>

        <div class="config-section">
          <h5>Rename Files:</h5>
          <label class="radio-option" style="cursor: pointer;">
            <input type="checkbox" id="post-rename-enabled">
            <div class="radio-content">
              <div class="radio-title">✏️ Rename files using a pattern</div>
              <div class="form-text">Apply a custom filename pattern to organized files</div>
            </div>
          </label>
          <div id="post-rename-options" style="display: none; margin-top: 10px;">
            <div class="lv-rename-pattern-row">
              <input type="text" id="post-rename-pattern" class="lv-rename-input"
                     value="{number}_{name}_{team}-{seq:2}"
                     placeholder="e.g. {number}_{name}_{team}-{seq:2}">
            </div>
            <div class="lv-rename-chips" id="post-rename-chips">
              <span class="lv-rename-chip" data-placeholder="{number}">number</span>
              <span class="lv-rename-chip" data-placeholder="{name}">name</span>
              <span class="lv-rename-chip" data-placeholder="{surname}">surname</span>
              <span class="lv-rename-chip" data-placeholder="{team}">team</span>
              <span class="lv-rename-chip" data-placeholder="{car_model}">car_model</span>
              <span class="lv-rename-chip" data-placeholder="{nationality}">nationality</span>
              <span class="lv-rename-chip" data-placeholder="{event}">event</span>
              <span class="lv-rename-chip" data-placeholder="{date}">date</span>
              <span class="lv-rename-chip" data-placeholder="{seq:2}">seq</span>
              <span class="lv-rename-chip" data-placeholder="{original}">original</span>
            </div>
            <div class="lv-rename-preview" id="post-rename-preview">
              <span class="lv-rename-preview-label">Preview:</span>
              <span class="lv-rename-preview-value" id="post-rename-preview-value">---</span>
            </div>
          </div>
        </div>
      </div>
    `;

    contentDiv.innerHTML = folderOrgHTML;

    // Setup event listeners for the injected UI
    this.setupPostOrganizationListeners();
  }

  /**
   * Setup event listeners for post-organization UI
   */
  setupPostOrganizationListeners() {
    // Destination radio buttons - show/hide custom controls
    const destRadios = document.querySelectorAll('input[name="post-destination"]');
    const customDestControls = document.getElementById('post-custom-dest-controls');

    destRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (customDestControls) {
          customDestControls.style.display = e.target.value === 'custom' ? 'flex' : 'none';
        }
      });
    });

    // Browse destination button
    const selectDestBtn = document.getElementById('post-select-dest-btn');
    if (selectDestBtn) {
      selectDestBtn.addEventListener('click', async () => {
        try {
          const selectedPath = await window.api.invoke('select-organization-destination');
          if (selectedPath) {
            const pathInput = document.getElementById('post-dest-path');
            if (pathInput) {
              pathInput.value = selectedPath;
            }
          }
        } catch (error) {
          console.error('[LogVisualizer] Error selecting destination:', error);
          this.showNotification('❌ Error selecting folder', 'error');
        }
      });
    }

    // Rename toggle - show/hide rename options
    const renameToggle = document.getElementById('post-rename-enabled');
    const renameOptions = document.getElementById('post-rename-options');
    if (renameToggle && renameOptions) {
      renameToggle.addEventListener('change', (e) => {
        renameOptions.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) {
          this.updateRenamePreview();
        }
      });
    }

    // Rename pattern input - live preview
    const renamePatternInput = document.getElementById('post-rename-pattern');
    if (renamePatternInput) {
      renamePatternInput.addEventListener('input', () => {
        this.updateRenamePreview();
      });
    }

    // Rename placeholder chips - click to insert
    const chips = document.querySelectorAll('#post-rename-chips .lv-rename-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const placeholder = chip.getAttribute('data-placeholder');
        if (renamePatternInput && placeholder) {
          const start = renamePatternInput.selectionStart;
          const end = renamePatternInput.selectionEnd;
          const val = renamePatternInput.value;
          renamePatternInput.value = val.substring(0, start) + placeholder + val.substring(end);
          renamePatternInput.focus();
          const newPos = start + placeholder.length;
          renamePatternInput.setSelectionRange(newPos, newPos);
          this.updateRenamePreview();
        }
      });
    });

    // Initial preview update
    if (renameToggle && renameToggle.checked) {
      this.updateRenamePreview();
    }
  }

  /**
   * Get a sample participant for rename preview
   */
  getRenameSampleParticipant() {
    if (this.presetParticipants && this.presetParticipants.length > 0) {
      const p = this.presetParticipants[0];
      return {
        name: p.nome || p.name || 'Driver',
        surname: p.cognome || p.surname || '',
        number: p.numero || p.number || '1',
        team: p.team || p.scuderia || 'Team',
        car_model: p.car_model || p.modello || '',
        nationality: p.nationality || p.nazionalita || ''
      };
    }
    return {
      name: 'Pierre Gasly', surname: 'Gasly', number: '10',
      team: 'Alpine', car_model: 'A524', nationality: 'FRA'
    };
  }

  /**
   * Update the rename pattern preview with sample data
   */
  updateRenamePreview() {
    const patternInput = document.getElementById('post-rename-pattern');
    const previewEl = document.getElementById('post-rename-preview-value');
    if (!patternInput || !previewEl) return;

    const pattern = patternInput.value || '';
    if (!pattern) {
      previewEl.textContent = '---';
      return;
    }

    const sample = this.getRenameSampleParticipant();
    let preview = pattern;
    preview = preview.replace(/\{number\}/g, sample.number);
    preview = preview.replace(/\{name\}/g, sample.name);
    preview = preview.replace(/\{surname\}/g, sample.surname);
    preview = preview.replace(/\{team\}/g, sample.team);
    preview = preview.replace(/\{car_model\}/g, sample.car_model);
    preview = preview.replace(/\{nationality\}/g, sample.nationality);
    preview = preview.replace(/\{event\}/g, 'Monaco_GP_2025');
    preview = preview.replace(/\{date\}/g, new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    preview = preview.replace(/\{seq:\d+\}/g, '01');
    preview = preview.replace(/\{seq\}/g, '001');
    preview = preview.replace(/\{original\}/g, 'IMG_4523');

    previewEl.textContent = preview + '.jpg';
  }

  /**
   * Get post-organization configuration
   */
  getPostOrganizationConfig() {
    const renameEnabled = document.getElementById('post-rename-enabled')?.checked || false;
    const renamePattern = document.getElementById('post-rename-pattern')?.value || '';

    return {
      enabled: true,
      mode: document.querySelector('input[name="post-org-mode"]:checked')?.value || 'copy',
      pattern: document.querySelector('input[name="post-folder-pattern"]:checked')?.value || 'number',
      createUnknownFolder: true,
      unknownFolderName: 'Unknown_Numbers',
      includeXmpFiles: true,
      destinationPath: document.querySelector('input[name="post-destination"]:checked')?.value === 'custom' ?
        document.getElementById('post-dest-path')?.value : undefined,
      conflictStrategy: document.querySelector('input[name="post-conflict-strategy"]:checked')?.value || 'rename',
      renamePattern: renameEnabled && renamePattern ? renamePattern : undefined
    };
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
      // Validate paths before using - only use absolute paths or URLs
      const rawMicroPath = imgElement.dataset.microPath;
      const rawThumbPath = imgElement.dataset.thumbPath;
      const rawCompressedPath = imgElement.dataset.compressedPath;

      const microPath = this.isValidPath(rawMicroPath) ? rawMicroPath : null;
      const thumbPath = this.isValidPath(rawThumbPath) ? rawThumbPath : null;
      const compressedPath = this.isValidPath(rawCompressedPath) ? rawCompressedPath : null;

      // Show loading state only if not already loading
      if (imgElement.style.opacity !== '0.5') {
        imgElement.style.opacity = '0.5';
      }

      // Strategy 1: Try thumbnail first (high quality 280x280) — skip if already known to be missing
      if (thumbPath && !this.failedPaths.has(thumbPath)) {
        try {
          await this.loadImageWithIPC(imgElement, thumbPath);
          this.preloadedImages.add(fileName);
          return;
        } catch (error) {
          this.failedPaths.add(thumbPath);
          this.logImageError(fileName, error, 'thumbnail');
        }
      }

      // Strategy 2: Try compressed (full quality fallback) — skip if already known to be missing
      if (compressedPath && !this.failedPaths.has(compressedPath)) {
        try {
          await this.loadImageWithIPC(imgElement, compressedPath);
          this.preloadedImages.add(fileName);
          return;
        } catch (error) {
          this.failedPaths.add(compressedPath);
          this.logImageError(fileName, error, 'compressed');
        }
      }

      // Strategy 3: Try micro-thumbnail as last resort (32x32 - pixelated)
      if (microPath && !this.failedPaths.has(microPath)) {
        try {
          await this.loadImageWithIPC(imgElement, microPath);
          this.preloadedImages.add(fileName);
          return;
        } catch (error) {
          this.failedPaths.add(microPath);
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

    // Log only once per fileName+context combination — use debug level to reduce noise
    console.debug(`[LogVisualizer] Image fallback for ${fileName}${context ? ` (${context})` : ''}: ${error.message}`);
  }

  /**
   * Load image with IPC for local files or direct loading for URLs
   */
  async loadImageWithIPC(imgElement, src) {
    // Check if this is a local file path
    const isLocalPath = src && src.startsWith('/') && !src.startsWith('http');

    if (isLocalPath) {
      // Use IPC for local file access
      try {
        const dataUrl = await window.api.invoke('get-local-image', src);
        if (dataUrl) {
          imgElement.src = dataUrl;
          imgElement.style.opacity = '1';
          imgElement.style.transition = 'opacity 0.3s ease';
          // Cache the data URL so it survives DOM re-renders (e.g. filter changes)
          const fileName = imgElement.dataset?.fileName;
          if (fileName) {
            this.dataUrlCache.set(fileName, dataUrl);
          }
          return;
        } else {
          throw new Error(`IPC returned null for local image: ${src}`);
        }
      } catch (error) {
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
        // Cache the URL so it survives DOM re-renders
        const fileName = imgElement.dataset?.fileName;
        if (fileName) {
          this.dataUrlCache.set(fileName, src);
        }
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

      // Type filter.
      //
      // B1/B5 — `hasCorrection` is set by extractResultsFromLogs based on
      // MANUAL_CORRECTION events in the JSONL (single source of truth). A
      // photo with a manual correction:
      //   * is a "Correction" (always visible in the corrections filter)
      //   * is NOT a "No Match" (its raceNumber was set by the user)
      //   * IS a "Matched" (manual matches count as matches)
      // Treating in-memory `manualCorrections` as the gate misclassified
      // no-match-corrected and matched-edited photos.
      const hasCorrection = result.hasCorrection === true ||
                            this.manualCorrections.has(result.fileName);

      switch (filterType) {
        case 'matched':
          if (hasCorrection) return true;
          return result.analysis && result.analysis.length > 0 &&
                 !result.analysis.some(v => v.matchStatus === 'needs_review' && !result._reviewResolved);
        case 'no-match':
          if (hasCorrection) return false; // user touched it → no longer no-match
          return !result.analysis || result.analysis.length === 0;
        case 'needs-review':
          return result.analysis && result.analysis.length > 0 &&
                 result.analysis.some(v => v.matchStatus === 'needs_review') && !result._reviewResolved;
        case 'corrected':
          return hasCorrection;
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
    const needsReviewEl = document.getElementById('lv-needs-review');
    const correctionsEl = document.getElementById('lv-corrections');

    // FIXED: Always use imageResults (full dataset) for global counters,
    // not filteredResults which changes with the active filter
    const allResults = this.imageResults || [];
    const total = allResults.length;

    // Per-result helper — same semantics as the filter switch above. Kept
    // local so it stays in lockstep when either side changes.
    const isCorrected = (r) =>
      r.hasCorrection === true || this.manualCorrections.has(r.fileName);

    // Count needs_review: has a match but ambiguous (not yet resolved by user)
    const needsReview = allResults.filter(r => {
      return r.analysis && r.analysis.length > 0 &&
             r.analysis.some(v => v.matchStatus === 'needs_review') &&
             !r._reviewResolved;
    }).length;

    const matched = allResults.filter(r => {
      // Manual correction always counts as matched, regardless of original AI state.
      if (isCorrected(r)) return true;
      if (!r.analysis || r.analysis.length === 0) return false;
      const hasRaceNumber = r.analysis.some(vehicle => vehicle.raceNumber && vehicle.raceNumber !== 'N/A');
      if (!hasRaceNumber) return false;
      // Exclude needs_review (unless resolved)
      const isUnresolvedReview = r.analysis.some(v => v.matchStatus === 'needs_review') && !r._reviewResolved;
      return !isUnresolvedReview;
    }).length;

    const noMatch = total - matched - needsReview;
    // B1/B5 — corrections count derives from the JSONL via `hasCorrection`,
    // with a fallback to the in-session Map for changes not yet flushed.
    const corrections = allResults.filter(isCorrected).length;

    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (matchedEl) matchedEl.textContent = matched.toLocaleString();
    if (noMatchEl) noMatchEl.textContent = noMatch.toLocaleString();
    if (needsReviewEl) needsReviewEl.textContent = needsReview.toLocaleString();
    if (correctionsEl) correctionsEl.textContent = corrections.toLocaleString();

    // Update active state on stat items based on current filter
    const currentFilter = document.getElementById('lv-filter-type')?.value || 'all';
    const filterMap = {
      'all': 'lv-total',
      'matched': 'lv-matched',
      'needs-review': 'lv-needs-review',
      'no-match': 'lv-no-match',
      'corrected': 'lv-corrections'
    };
    document.querySelectorAll('.results-stat-item').forEach(item => {
      item.classList.remove('results-stat-item--active');
    });
    const activeId = filterMap[currentFilter];
    if (activeId) {
      const activeEl = document.getElementById(activeId);
      if (activeEl) activeEl.closest('.results-stat-item')?.classList.add('results-stat-item--active');
    }
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

    // Show Export Tags button only if any result has visual tags
    this.updateExportTagsVisibility();
  }

  /**
   * Show/hide Export Tags button based on visual tags presence
   */
  updateExportTagsVisibility() {
    const exportTagsBtn = document.getElementById('lv-export-tags');
    if (!exportTagsBtn) return;

    const hasVisualTags = this.imageResults.some(r =>
      r.visualTags || r.logEvent?.visualTags
    );

    exportTagsBtn.style.display = hasVisualTags ? 'inline-flex' : 'none';
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

    // Register lazy images with Intersection Observer (skip already-cached ones)
    const lazyImages = resultsContainer.querySelectorAll('.lv-lazy-image');
    lazyImages.forEach(img => {
      const fileName = img.dataset.fileName;
      const alreadyCached = this.preloadedImages.has(fileName) || (this.dataUrlCache && this.dataUrlCache.has(fileName));
      if (this.imageObserver && !alreadyCached) {
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

    // Determine if any vehicle needs review (ambiguous match)
    const needsReview = vehicles.some(v => v.matchStatus === 'needs_review');
    const isResolved = result._reviewResolved === true; // User already chose a candidate

    // Check if we already have a cached image URL for this result
    const cachedImageUrl = this.getCachedImageUrl(result);
    const imageSrc = cachedImageUrl || this.getPlaceholderUrl();

    // Count alternative candidates for needs_review badge
    const altCount = primaryVehicle.alternativeCandidates ? primaryVehicle.alternativeCandidates.length : 0;

    // Issue #104 — aggregate otherPeople across all vehicles (usually empty, unless preset opted in)
    const otherPeople = [];
    for (const v of vehicles) {
      if (Array.isArray(v.otherPeople)) {
        for (const p of v.otherPeople) {
          if (p && p.name) otherPeople.push(p);
        }
      }
    }
    const otherPeopleLabel = otherPeople
      .map(p => p.role ? `${this.escapeHtml(p.name)} (${this.escapeHtml(p.role)})` : this.escapeHtml(p.name))
      .join(', ');

    return `
      <div class="lv-result-card ${isModified ? 'modified' : ''} ${needsReview && !isResolved ? 'needs-review' : ''} ${isResolved ? 'review-resolved' : ''}" data-index="${index}">
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
          ${needsReview && !isResolved ? '<div class="lv-needs-review-badge">⚠️ Review</div>' : ''}
          ${isResolved ? '<div class="lv-resolved-badge">✅ Resolved</div>' : ''}
          ${result.metadataWritten === false ? '<div class="lv-no-metadata-badge">No metadata</div>' : ''}
          ${vehicles.length > 1 ? `<div class="lv-multi-badge">${vehicles.length} vehicles</div>` : ''}
          ${otherPeople.length > 0 ? `<div class="lv-other-people-badge" title="${otherPeopleLabel}">★ ${otherPeople.length} VIP</div>` : ''}
        </div>

        <div class="lv-card-content">
          <div class="lv-card-filename">${this.truncateFilename(result.fileName)}</div>

          <div class="lv-card-recognition">
            ${vehicles.length > 0 ? `
              <div class="lv-race-number">#${primaryVehicle.raceNumber || '?'}</div>
              <div class="lv-team-name">${primaryVehicle.team || 'Unknown Team'}</div>
              ${primaryVehicle.drivers ? `<div class="lv-drivers">${primaryVehicle.drivers.join(', ')}</div>` : ''}
              ${otherPeople.length > 0 ? `<div class="lv-other-people" title="People outside the preset (VIPs/guests)">★ ${otherPeopleLabel}</div>` : ''}
              ${needsReview && !isResolved && altCount > 1 ? `
                <div class="lv-ambiguous-hint">${altCount} candidates — click to choose</div>
              ` : ''}
            ` : `
              <div class="lv-no-match">No recognition</div>
            `}
          </div>

          <div class="lv-card-meta">
            <div class="lv-confidence confidence-${needsReview && !isResolved ? 'review' : confidenceClass}">
              ${needsReview && !isResolved ? '⚠️ Needs review' : `${Math.round(confidence * 100)}% confidence`}
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
   * Build and inject the in-gallery review candidates UI
   * Called by updateVehicleEditor when the current image has matchStatus === 'needs_review'
   * Two placements: sidebar (Option A, >= 900px) and horizontal bar (Option B, < 900px)
   */
  /**
   * Build and inject the in-gallery review candidates panel.
   * ALWAYS shows all candidates — both for unresolved and already-resolved images.
   * Highlights the AI-suggested or user-chosen candidate.
   *
   * @param {object} result - The image result object
   * @param {number} resultIndex - Index in filteredResults
   * @param {object} options - { resolved: boolean } — whether this image was already resolved
   */
  injectReviewCandidatesUI(result, resultIndex, options = {}) {
    // Remove any existing review UIs first
    document.querySelectorAll('.lv-review-panel, .lv-review-bar').forEach(el => el.remove());

    const primaryVehicle = result.analysis?.[0];
    if (!primaryVehicle) return;

    const candidates = primaryVehicle.alternativeCandidates || [];
    if (candidates.length === 0) return;

    const isResolved = options.resolved || false;

    // Determine which candidate is currently active by matching the vehicle's
    // current raceNumber against the candidate list. This works for both:
    // - AI's initial bestMatch (pre-resolution)
    // - User's chosen candidate (post-resolution)
    const currentRaceNumber = String(primaryVehicle.raceNumber || '');
    const isNoneChosen = isResolved &&
      (primaryVehicle.matchedBy === 'none' || currentRaceNumber === 'N/A' || !currentRaceNumber);

    // Find the index of the active candidate by matching raceNumber
    let activeCandidateIndex = -1;
    if (currentRaceNumber && currentRaceNumber !== 'N/A') {
      activeCandidateIndex = candidates.findIndex(c =>
        String(c.participantNumber) === currentRaceNumber
      );
    }

    // Header text and style depend on state
    const headerIcon = isResolved ? '✓' : '⚠️';
    const headerText = isResolved
      ? (isNoneChosen ? 'Resolved: None matched' : `Resolved: #${currentRaceNumber}`)
      : 'Ambiguous Match — Choose the Correct One';
    const panelStateClass = isResolved
      ? (isNoneChosen ? 'lv-review-state-none' : 'lv-review-state-resolved')
      : 'lv-review-state-pending';

    // Build candidate options HTML (shared between both layouts)
    const buildCandidateHTML = (compact = false) => candidates.map((candidate, i) => {
      const isActive = i === activeCandidateIndex;
      const classes = [
        'lv-candidate-option',
        compact ? 'lv-candidate-compact' : '',
        isActive ? 'lv-candidate-active' : ''
      ].filter(Boolean).join(' ');

      return `
        <div class="${classes}" data-candidate-index="${i}" data-result-index="${resultIndex}">
          <div class="lv-candidate-rank">${isActive ? '✓' : (i + 1)}</div>
          <div class="lv-candidate-info">
            <div class="lv-candidate-number">#${candidate.participantNumber || '?'}</div>
            <div class="lv-candidate-name">${candidate.participantName || 'Unknown'}</div>
            ${candidate.team ? `<div class="lv-candidate-team">${candidate.team}</div>` : ''}
          </div>
          <div class="lv-candidate-score">
            ${candidate.score?.toFixed(1) || '?'}
            <span class="lv-candidate-conf">${Math.round((candidate.confidence || 0) * 100)}%</span>
          </div>
        </div>
      `;
    }).join('');

    // === Option A: Sidebar panel ===
    const vehiclesContainer = document.getElementById('lv-vehicles');
    if (vehiclesContainer) {
      const sidebarPanel = document.createElement('div');
      sidebarPanel.className = `lv-review-panel ${panelStateClass}`;
      sidebarPanel.innerHTML = `
        <div class="lv-review-panel-header">
          <span class="lv-review-icon">${headerIcon}</span>
          <span class="lv-review-title">${headerText}</span>
        </div>
        <div class="lv-candidate-list">
          ${buildCandidateHTML(false)}
        </div>
        <div class="lv-review-actions">
          <button class="lv-candidate-btn-none ${isNoneChosen ? 'lv-btn-none-active' : ''}" data-review-action="none" data-result-index="${resultIndex}">✕ None of these</button>
        </div>
      `;
      vehiclesContainer.parentNode.insertBefore(sidebarPanel, vehiclesContainer);
    }

    // === Option B: Horizontal bar ===
    const imageContainer = document.querySelector('.lv-gallery-image-container');
    if (imageContainer) {
      const horizontalBar = document.createElement('div');
      horizontalBar.className = `lv-review-bar ${panelStateClass}`;
      horizontalBar.innerHTML = `
        <div class="lv-review-bar-header">
          <span>${headerIcon} ${isResolved ? headerText : 'Ambiguous Match'}</span>
          <button class="lv-candidate-btn-none lv-review-bar-none ${isNoneChosen ? 'lv-btn-none-active' : ''}" data-review-action="none" data-result-index="${resultIndex}">✕ None</button>
        </div>
        <div class="lv-review-bar-candidates">
          ${buildCandidateHTML(true)}
        </div>
      `;
      imageContainer.parentNode.insertBefore(horizontalBar, imageContainer.nextSibling);
    }

    // Wire up click handlers
    this.setupReviewCandidateListeners(candidates, resultIndex, isResolved);
  }

  /**
   * Wire click handlers for in-gallery review candidate selection.
   * Works both for first-time selection and re-selection on resolved images.
   */
  setupReviewCandidateListeners(candidates, resultIndex, isAlreadyResolved) {
    document.querySelectorAll('.lv-candidate-option[data-result-index]').forEach(option => {
      option.addEventListener('click', async () => {
        const candidateIndex = parseInt(option.dataset.candidateIndex);
        const chosenCandidate = candidates[candidateIndex];

        // Visual feedback: highlight the chosen one across BOTH layouts
        document.querySelectorAll('.lv-candidate-option').forEach(o => {
          o.classList.remove('lv-candidate-active');
          // Update rank display: restore numbers
          const rank = o.querySelector('.lv-candidate-rank');
          if (rank) rank.textContent = String(parseInt(o.dataset.candidateIndex) + 1);
        });
        // Mark the chosen one
        document.querySelectorAll(`.lv-candidate-option[data-candidate-index="${candidateIndex}"]`).forEach(el => {
          el.classList.add('lv-candidate-active');
          const rank = el.querySelector('.lv-candidate-rank');
          if (rank) rank.textContent = '✓';
        });

        // Deactivate "None" button
        document.querySelectorAll('.lv-candidate-btn-none').forEach(b => b.classList.remove('lv-btn-none-active'));

        // Update header to resolved state
        document.querySelectorAll('.lv-review-panel, .lv-review-bar').forEach(panel => {
          panel.classList.remove('lv-review-state-pending', 'lv-review-state-none');
          panel.classList.add('lv-review-state-resolved');
        });
        document.querySelectorAll('.lv-review-title').forEach(t => {
          t.textContent = `Resolved: #${chosenCandidate.participantNumber || '?'}`;
        });
        document.querySelectorAll('.lv-review-icon').forEach(ic => {
          ic.textContent = '✓';
        });

        // Resolve and auto-save
        await this.resolveReview(resultIndex, chosenCandidate);

        // Auto-fill the vehicle editor fields
        this.autoFillVehicleEditorFromCandidate(chosenCandidate);

        // Navigate to next needs_review (only on first resolution, not re-selections)
        if (!isAlreadyResolved) {
          setTimeout(() => {
            this.navigateToNextReview(resultIndex);
          }, 600);
        }
      });
    });

    // "None of these" button
    document.querySelectorAll('[data-review-action="none"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();

        // Deselect all candidates
        document.querySelectorAll('.lv-candidate-option').forEach(o => {
          o.classList.remove('lv-candidate-active');
          const rank = o.querySelector('.lv-candidate-rank');
          if (rank) rank.textContent = String(parseInt(o.dataset.candidateIndex) + 1);
        });
        // Highlight "None" button
        document.querySelectorAll('.lv-candidate-btn-none').forEach(b => b.classList.add('lv-btn-none-active'));

        // Update header
        document.querySelectorAll('.lv-review-panel, .lv-review-bar').forEach(panel => {
          panel.classList.remove('lv-review-state-pending', 'lv-review-state-resolved');
          panel.classList.add('lv-review-state-none');
        });
        document.querySelectorAll('.lv-review-title').forEach(t => {
          t.textContent = 'Resolved: None matched';
        });
        document.querySelectorAll('.lv-review-icon').forEach(ic => {
          ic.textContent = '✕';
        });

        await this.resolveReview(resultIndex, null);

        if (!isAlreadyResolved) {
          setTimeout(() => {
            this.navigateToNextReview(resultIndex);
          }, 600);
        }
      });
    });
  }

  /**
   * B4 — auto-advance to the next image in the active filter context.
   *
   * Strategy: respect the user's current filter and find the next "actionable"
   * photo starting from `currentResultIndex + 1`. Definition of actionable:
   *  - In the "needs-review" filter: a photo that is still un-resolved.
   *  - In any other filter: simply the next photo in `filteredResults`.
   *
   * This is the single source of truth for advance-after-confirmation. Both
   * the candidate picker (`resolveReview`) and the race-number Enter handler
   * (`_handleRaceNumberEnter`) call this so the user has a consistent
   * "confirm → next" cadence regardless of which input triggered the save.
   *
   * When the list is exhausted (no more actionable photos forward of the
   * current one), the modal CLOSES so the user can re-filter or move on,
   * accompanied by a completion toast. This replaces the old behaviour of
   * silently staying on the just-resolved image, which the user reported as
   * "the modal exits by itself" because nothing happened on subsequent
   * keystrokes.
   *
   * @param {number} currentResultIndex Index in filteredResults that we just
   *        acted on — search starts at currentResultIndex + 1, no wrap.
   */
  async navigateToNextReview(currentResultIndex) {
    const total = this.filteredResults.length;
    const filterType = document.getElementById('lv-filter-type')?.value || 'all';
    const wantsUnresolvedReview = filterType === 'needs-review';

    // Search forward only — no wrap-around. Wrapping causes the modal to
    // bounce back to a photo the user already touched in this session, which
    // is confusing.
    for (let idx = currentResultIndex + 1; idx < total; idx++) {
      const r = this.filteredResults[idx];
      if (!r) continue;
      if (wantsUnresolvedReview) {
        if (r._reviewResolved) continue;
        if (r.analysis?.[0]?.matchStatus !== 'needs_review') continue;
      }
      // Found the next actionable photo.
      this.currentImageIndex = idx;
      if (this.zoomController) this.zoomController.reset(false);
      await this.updateGalleryContent();
      console.log(`[LogVisualizer] Auto-advance: filter=${filterType}, index=${idx}`);
      return;
    }

    // Exhausted: nothing more to do in this filter's forward direction.
    if (wantsUnresolvedReview) {
      const resolvedCount = this.filteredResults.filter(r => r._reviewResolved).length;
      this.showNotification(
        `✅ All done! ${resolvedCount} ambiguous match${resolvedCount !== 1 ? 'es' : ''} resolved.`,
        'success'
      );
    } else {
      this.showNotification('✅ Reached the end of the current view', 'info');
    }
    // Close modal — user is done with this batch in this filter.
    await this.closeGallery();
    console.log('[LogVisualizer] No more actionable photos forward — modal closed');
  }

  /**
   * Auto-fill vehicle editor fields from a chosen candidate
   */
  autoFillVehicleEditorFromCandidate(candidate) {
    if (!candidate) return;

    const vehiclesContainer = document.getElementById('lv-vehicles');
    if (!vehiclesContainer) return;

    // Find the first vehicle editor (primary vehicle)
    const editor = vehiclesContainer.querySelector('.lv-vehicle-editor');
    if (!editor) return;

    // Fill in the fields
    const raceNumberInput = editor.querySelector('[data-field="raceNumber"]');
    const teamInput = editor.querySelector('[data-field="team"]');
    const driversInput = editor.querySelector('[data-field="drivers"]');

    if (raceNumberInput && candidate.participantNumber) {
      raceNumberInput.value = String(candidate.participantNumber);
    }
    if (teamInput && candidate.team) {
      teamInput.value = candidate.team;
    }
    if (driversInput && candidate.participantName) {
      driversInput.value = candidate.participantName;
    }

    // Mark the editor as modified visually
    editor.classList.add('modified');
  }

  /**
   * Resolve an ambiguous review by applying the user's choice
   */
  async resolveReview(resultIndex, chosenCandidate) {
    const result = this.filteredResults[resultIndex];
    if (!result || !result.analysis || result.analysis.length === 0) return;

    const primaryVehicle = result.analysis[0];

    if (chosenCandidate) {
      // User chose a candidate — update the vehicle data
      primaryVehicle.raceNumber = String(chosenCandidate.participantNumber || '');
      primaryVehicle.matchedBy = 'user_review';
      primaryVehicle.confidence = chosenCandidate.confidence || primaryVehicle.confidence;
      if (chosenCandidate.participantName) {
        primaryVehicle.drivers = [chosenCandidate.participantName];
      }
      if (chosenCandidate.team) {
        primaryVehicle.team = chosenCandidate.team;
      }
    } else {
      // User said "none" — mark as no match
      primaryVehicle.raceNumber = 'N/A';
      primaryVehicle.matchedBy = 'none';
      primaryVehicle.confidence = 0;
    }

    // Mark status as resolved
    primaryVehicle.matchStatus = 'matched';
    result._reviewResolved = true;

    // Track as a manual correction for saving
    // Include matchStatus and matchedBy so they persist through JSONL refresh
    if (!this.manualCorrections.has(result.fileName)) {
      this.manualCorrections.set(result.fileName, {
        fileName: result.fileName,
        vehicleIndex: 0,
        timestamp: new Date().toISOString(),
        changes: {}
      });
    }

    const correction = this.manualCorrections.get(result.fileName);
    correction.changes.raceNumber = primaryVehicle.raceNumber;
    correction.changes.matchedBy = primaryVehicle.matchedBy;
    correction.changes.matchStatus = 'matched';
    correction.changes.resolvedFromReview = true;
    correction.changes.chosenCandidate = chosenCandidate;
    if (chosenCandidate?.participantName) {
      correction.changes.drivers = [chosenCandidate.participantName];
    }
    if (chosenCandidate?.team) {
      correction.changes.team = chosenCandidate.team;
    }
    this.hasUnsavedChanges = true;

    // Update the card visually
    this.updateResultCard(result.fileName);

    // Refresh statistics
    this.updateStatistics();

    const chosenLabel = chosenCandidate ? `#${chosenCandidate.participantNumber}` : 'None';
    console.log(`[LogVisualizer] Review resolved for ${result.fileName}: chose ${chosenLabel}`);

    // Auto-save immediately — review resolution is an explicit user action, persist right away
    try {
      await this.saveAllChanges();
    } catch (error) {
      console.error('[LogVisualizer] Auto-save after review resolution failed:', error);
      this.showNotification('⚠️ Review choice applied but auto-save failed. Click Save to persist.', 'warning');
    }
  }

  /**
   * Get cached image URL if already loaded
   */
  getCachedImageUrl(result) {
    // First: check if we have a cached data URL from IPC (survives DOM re-renders)
    if (this.dataUrlCache && this.dataUrlCache.has(result.fileName)) {
      return this.dataUrlCache.get(result.fileName);
    }
    if (this.preloadedImages.has(result.fileName)) {
      // Return the best quality URL we know works - validate paths first
      if (this.isValidPath(result.thumbnailPath)) {
        return result.thumbnailPath;
      }
      if (this.isValidPath(result.compressedPath)) {
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
  /**
   * Helper to validate if a path is valid and usable
   * Supports Windows (C:\...), Unix (/...), and URLs (http://...)
   */
  isValidPath(path) {
    if (!path || path === 'null' || path === 'undefined') {
      return false;
    }

    // Check for valid URL
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return true;
    }

    // Check for valid local path (Unix-style or Windows)
    if (path.startsWith('/')) {
      return true; // Unix absolute path
    }

    // Windows absolute path (C:\, D:\, etc.)
    if (/^[A-Z]:\\/i.test(path)) {
      return true;
    }

    return false;
  }

  getGalleryImageUrl(result) {
    // 0. Priorità massima: immagine originale da disco (permette zoom a piena risoluzione)
    if (this.isValidPath(result.originalPath) && !this.failedPaths.has(result.originalPath)) {
      return result.originalPath;
    }

    // 1. Immagine compressa di alta qualità (1080-1920px) - locale
    if (this.isValidPath(result.compressedPath) && !this.failedPaths.has(result.compressedPath)) {
      return result.compressedPath;
    }

    // 2. Supabase URL originale (sempre valida se presente)
    if (this.isValidPath(result.supabaseUrl)) {
      return result.supabaseUrl;
    }

    // 3. imagePath generico
    if (this.isValidPath(result.imagePath) && !this.failedPaths.has(result.imagePath)) {
      return result.imagePath;
    }

    // 4. Ultima risorsa: thumbnail (280x280)
    if (this.isValidPath(result.thumbnailPath) && !this.failedPaths.has(result.thumbnailPath)) {
      return result.thumbnailPath;
    }

    console.warn(`[LogVisualizer] No suitable image URL found for gallery: ${result.fileName}`);
    return null;
  }

  /**
   * Get thumbnail URL for result image
   */
  getThumbnailUrl(result) {
    // 1. Thumbnail ad alta qualità (280x280) — skip if known to be missing
    if (result.thumbnailPath && !this.failedPaths.has(result.thumbnailPath)) {
      if (result.thumbnailPath.startsWith('/') || result.thumbnailPath.startsWith('http')) {
        return result.thumbnailPath;
      }
    }

    // 2. File compresso — skip if known to be missing
    if (result.compressedPath && !this.failedPaths.has(result.compressedPath)) {
      if (result.compressedPath.startsWith('/') || result.compressedPath.startsWith('http')) {
        return result.compressedPath;
      }
    }

    // 3. Supabase URL originale (fallback)
    if (result.supabaseUrl) {
      return result.supabaseUrl;
    }

    // 4. imagePath generico
    if (result.imagePath) {
      return result.imagePath;
    }

    // 5. Micro-thumbnail come ultima opzione
    if (result.microThumbPath && !this.failedPaths.has(result.microThumbPath)) {
      if (result.microThumbPath.startsWith('/') || result.microThumbPath.startsWith('http')) {
        return result.microThumbPath;
      }
    }

    console.warn(`[LogVisualizer] No image source found for ${result.fileName}`);
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
    if (this.zoomController) this.zoomController.reset(false);

    // Restore body scrolling IMMEDIATELY — before any async work that could fail
    document.body.style.overflow = '';

    // Remove any lingering review panels
    document.querySelectorAll('.lv-review-panel, .lv-review-bar').forEach(el => el.remove());

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

    // === Strategy G: Check for learned data after gallery closes ===
    // Don't show modal automatically — just update the badge/button
    try {
      this._checkLearnedDataAvailability();
    } catch (learnError) {
      console.warn('[LogVisualizer] Learned data check failed (non-critical):', learnError);
    }

    const gallery = document.getElementById('lv-gallery');
    if (gallery) {
      gallery.style.display = 'none';
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
    if (this.zoomController) this.zoomController.reset(false);
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
          if (dataUrl) {
            newImg.src = dataUrl;
          } else {
            // File doesn't exist on disk — mark as failed and try next fallback
            this.failedPaths.add(imageUrl);
            const fallbackUrl = this.getGalleryImageUrl(result);
            if (fallbackUrl && fallbackUrl !== imageUrl) {
              // Recursively try next fallback via IPC or direct URL
              if (fallbackUrl.startsWith('/') && !fallbackUrl.startsWith('http')) {
                const fallbackData = await window.api.invoke('get-local-image', fallbackUrl);
                if (fallbackData) {
                  newImg.src = fallbackData;
                } else {
                  this.failedPaths.add(fallbackUrl);
                  // Last resort: try supabase URL directly
                  if (result.supabaseUrl) {
                    newImg.src = result.supabaseUrl;
                  }
                }
              } else {
                newImg.src = fallbackUrl;
              }
            } else if (result.supabaseUrl) {
              newImg.src = result.supabaseUrl;
            }
          }
        } catch (error) {
          this.failedPaths.add(imageUrl);
          // Try fallback after marking failed
          const fallbackUrl = this.getGalleryImageUrl(result);
          if (fallbackUrl && fallbackUrl !== imageUrl) {
            newImg.src = fallbackUrl;
          } else if (result.supabaseUrl) {
            newImg.src = result.supabaseUrl;
          }
        }
      } else if (imageUrl) {
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

    // Auto-focus the Race Number field so the user can immediately type a number
    this._focusFirstRaceNumberInput();

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

    // Preload previous image — use gallery-quality URL (same as what gallery displays)
    if (this.currentImageIndex > 0) {
      const prevResult = this.filteredResults[this.currentImageIndex - 1];
      if (prevResult) {
        await this.preloadImage(this.getGalleryImageUrl(prevResult));
      }
    }

    // Preload next image — use gallery-quality URL (same as what gallery displays)
    if (this.currentImageIndex < this.filteredResults.length - 1) {
      const nextResult = this.filteredResults[this.currentImageIndex + 1];
      if (nextResult) {
        await this.preloadImage(this.getGalleryImageUrl(nextResult));
      }
    }
  }

  /**
   * Preload a single image with IPC support
   */
  async preloadImage(url) {
    if (!url) return;
    if (this.imageCache.has(url)) return;
    // Skip URLs that already failed — prevents retry flood
    if (this.failedPaths && this.failedPaths.has(url)) return;

    const img = new Image();
    img.onload = () => {
      this.imageCache.set(url, img);
    };
    img.onerror = () => {
      // Track failed URL to prevent future retries
      if (!this.failedPaths) this.failedPaths = new Set();
      this.failedPaths.add(url);
    };

    // Use IPC for local images
    if (url.startsWith('/') && !url.startsWith('http')) {
      try {
        const dataUrl = await window.api.invoke('get-local-image', url);
        if (dataUrl) {
          img.src = dataUrl;
        } else {
          // IPC returned null — file doesn't exist, track as failed
          if (!this.failedPaths) this.failedPaths = new Set();
          this.failedPaths.add(url);
        }
      } catch (error) {
        if (!this.failedPaths) this.failedPaths = new Set();
        this.failedPaths.add(url);
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

    // Always remove existing review panels before rebuilding — prevents stale panels
    // from previous images persisting when the new image doesn't need one
    document.querySelectorAll('.lv-review-panel, .lv-review-bar').forEach(el => el.remove());

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

    // Show review candidates panel if this image has/had needs_review status
    const primaryMatchStatus = result.analysis?.[0]?.matchStatus;
    const wasResolvedFromReview = result._reviewResolved ||
      (this.manualCorrections.has(result.fileName) &&
       this.manualCorrections.get(result.fileName)?.changes?.resolvedFromReview);
    const hasAlternatives = (result.analysis?.[0]?.alternativeCandidates || []).length > 0;

    if (hasAlternatives && (primaryMatchStatus === 'needs_review' || wasResolvedFromReview)) {
      const actualIndex = this.filteredResults.indexOf(result);
      if (actualIndex >= 0) {
        this.injectReviewCandidatesUI(result, actualIndex, { resolved: wasResolvedFromReview });
      }
    }

    // Update visual tags section
    this.updateVisualTagsSection(result);

    // Setup event delegation for vehicle editor buttons
    this.setupVehicleEditorEvents();
  }

  /**
   * Update visual tags section in gallery
   */
  updateVisualTagsSection(result) {
    const tagsSection = document.getElementById('lv-visual-tags');
    const tagsContainer = document.getElementById('lv-tags-container');

    if (!tagsSection || !tagsContainer) return;

    // Get visual tags from result (could be in result.visualTags or result.logEvent.visualTags)
    const visualTags = result.visualTags || result.logEvent?.visualTags;

    if (!visualTags || Object.keys(visualTags).length === 0) {
      tagsSection.style.display = 'none';
      return;
    }

    // Check if there are any actual tags
    const hasAnyTags = Object.values(visualTags).some(arr => Array.isArray(arr) && arr.length > 0);
    if (!hasAnyTags) {
      tagsSection.style.display = 'none';
      return;
    }

    tagsSection.style.display = 'block';

    // Category icons and colors
    const categoryConfig = {
      location: { icon: '📍', label: 'Location', color: '#3b82f6' },
      weather: { icon: '🌤️', label: 'Weather', color: '#f59e0b' },
      sceneType: { icon: '👥', label: 'Scene', color: '#8b5cf6' },
      subjects: { icon: '🎯', label: 'Subjects', color: '#10b981' },
      visualStyle: { icon: '🎨', label: 'Style', color: '#ec4899' },
      emotion: { icon: '😊', label: 'Emotion', color: '#f97316' }
    };

    let tagsHTML = '';

    for (const [category, tags] of Object.entries(visualTags)) {
      if (!Array.isArray(tags) || tags.length === 0) continue;

      const config = categoryConfig[category] || { icon: '🏷️', label: category, color: '#6b7280' };

      tagsHTML += `
        <div class="lv-tag-category">
          <div class="lv-tag-category-header">
            <span class="lv-tag-icon">${config.icon}</span>
            <span class="lv-tag-label">${config.label}</span>
          </div>
          <div class="lv-tag-chips">
            ${tags.map(tag => `
              <span class="lv-tag-chip" style="--tag-color: ${config.color}">
                ${tag}
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    tagsContainer.innerHTML = tagsHTML;
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

    // Autocomplete: auto-fill other fields when Race Number or Driver is selected from preset
    if (this.presetParticipants && this.presetParticipants.length > 0) {
      newContainer.addEventListener('input', (event) => {
        const input = event.target;
        if (!input.classList.contains('lv-autocomplete-input')) return;

        const field = input.dataset.field;
        const value = input.value.trim();
        if (!value) return;

        const vehicleEditor = input.closest('.lv-vehicle-editor');
        if (!vehicleEditor) return;

        if (field === 'raceNumber') {
          const participant = this.findParticipantByNumber(value);
          if (participant) {
            this.autoFillFromParticipant(vehicleEditor, participant, 'raceNumber');
          }
        } else if (field === 'drivers') {
          const participant = this.findParticipantByName(value);
          if (participant) {
            this.autoFillFromParticipant(vehicleEditor, participant, 'drivers');
          }
        }
      });
    }

    // Keyboard shortcuts on the Race Number input:
    //   Enter → apply best match (exact or prefix), save async, navigate to next image
    //   Empty Enter → save async, navigate to next image
    newContainer.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const input = event.target;
      if (input.tagName !== 'INPUT' || input.dataset.field !== 'raceNumber') return;

      event.preventDefault();
      this._handleRaceNumberEnter(input);
    });
  }

  /**
   * Find best participant match: exact match first, then prefix match.
   */
  findBestMatchByNumberPrefix(value) {
    if (!this.presetParticipants || !value) return null;
    const needle = String(value).trim();
    if (!needle) return null;

    const exact = this.findParticipantByNumber(needle);
    if (exact) return exact;

    return this.presetParticipants.find(p =>
      p.numero && String(p.numero).trim().startsWith(needle)
    ) || null;
  }

  /**
   * Handle Enter pressed inside a Race Number input.
   * Applies the first useful suggestion (if any), kicks off an async save and
   * advances to the next image so the user keeps moving without waiting.
   */
  _handleRaceNumberEnter(input) {
    const vehicleEditor = input.closest('.lv-vehicle-editor');
    const value = input.value.trim();

    // 1) If the user typed something, apply the first useful match
    if (value && this.presetParticipants && this.presetParticipants.length > 0 && vehicleEditor) {
      const participant = this.findBestMatchByNumberPrefix(value);
      if (participant) {
        if (participant.numero) {
          input.value = String(participant.numero);
        }
        this.autoFillFromParticipant(vehicleEditor, participant, 'raceNumber');
      }
    }

    // 2) Fire-and-forget save for the current vehicle (do not block navigation)
    if (vehicleEditor) {
      const vehicleIndex = parseInt(vehicleEditor.dataset.vehicleIndex, 10);
      const fileName = vehicleEditor.dataset.fileName;
      if (!Number.isNaN(vehicleIndex) && fileName) {
        Promise.resolve(this.saveVehicleChangesByFileName(fileName, vehicleIndex))
          .catch(err => console.error('[LogVisualizer] Async save on Enter failed:', err));
      }
    }

    // 3) Auto-advance using the unified logic. This respects the active
    //    filter (needs-review skips already-resolved photos; other filters
    //    just walk forward) and closes the modal when the list is exhausted
    //    so the user gets explicit completion feedback instead of a silent
    //    stuck-on-the-last-image state.
    this.navigateToNextReview(this.currentImageIndex);
  }

  /**
   * Auto-focus the first Race Number input in the gallery so the user can type
   * a number immediately without clicking. Runs after the editor is rebuilt.
   */
  _focusFirstRaceNumberInput() {
    // Defer so the just-rebuilt DOM is fully attached and visible
    setTimeout(() => {
      if (!this.isGalleryOpen) return;
      const firstInput = document.querySelector('#lv-vehicles [data-field="raceNumber"]');
      if (firstInput) {
        firstInput.focus();
        // Select existing value so typing replaces it
        if (typeof firstInput.select === 'function') firstInput.select();
      }
    }, 50);
  }

  /**
   * Create vehicle editor HTML
   */
  createVehicleEditorHTML(vehicle, vehicleIndex, fileName, imageIndex) {
    const isModified = this.manualCorrections.has(`${fileName}_${vehicleIndex}`);

    const hasPresetData = this.presetParticipants && this.presetParticipants.length > 0;

    // Build datalist options for Race Number and Drivers if preset data is available
    const raceNumberListId = `racenumber-list-${fileName}-${vehicleIndex}`;
    const driverListId = `driver-list-${fileName}-${vehicleIndex}`;

    let raceNumberOptions = '';
    let driverOptions = '';

    if (hasPresetData) {
      // Race Number datalist: value=numero, hint text shows nome + squadra
      raceNumberOptions = this.presetParticipants
        .filter(p => p.numero)
        .map(p => {
          const hint = [p.nome, p.squadra].filter(Boolean).join(' - ');
          return `<option value="${this.escapeHtml(p.numero)}">${this.escapeHtml(hint)}</option>`;
        }).join('');

      // Drivers datalist: value=driver_name, hint text shows #numero + squadra
      // Drivers are stored in preset_participant_drivers array, fallback to nome field
      const driverEntries = [];
      const seenNames = new Set();
      this.presetParticipants.forEach(p => {
        const driverNames = this.getDriverNamesFromParticipant(p);
        driverNames.forEach(name => {
          if (!seenNames.has(name)) {
            seenNames.add(name);
            const hint = [`#${p.numero || '?'}`, p.squadra].filter(Boolean).join(' - ');
            driverEntries.push(`<option value="${this.escapeHtml(name)}">${this.escapeHtml(hint)}</option>`);
          }
        });
      });
      driverOptions = driverEntries.join('');
    }

    return `
      <div class="lv-vehicle-editor ${isModified ? 'modified' : ''}" data-vehicle-index="${vehicleIndex}" data-image-index="${imageIndex}" data-file-name="${fileName}">
        <div class="lv-vehicle-header">
          <h5>Vehicle ${vehicleIndex + 1}</h5>
          ${isModified ? '<span class="lv-modified-indicator">✏️ Modified</span>' : ''}
          ${hasPresetData ? '<span class="lv-autocomplete-indicator" title="Autocomplete enabled from participant preset">🎯</span>' : ''}
          <button class="lv-delete-vehicle" data-action="delete" data-vehicle-index="${vehicleIndex}" data-file-name="${fileName}">🗑️</button>
        </div>

        <div class="lv-editor-fields">
          <div class="lv-field-group">
            <label>Race Number:</label>
            <input type="text"
                   class="lv-edit-input${hasPresetData ? ' lv-autocomplete-input' : ''}"
                   data-field="raceNumber"
                   value="${vehicle.raceNumber || ''}"
                   placeholder="Enter number..."
                   ${hasPresetData ? `list="${raceNumberListId}"` : ''}
                   autocomplete="off" />
            ${hasPresetData ? `<datalist id="${raceNumberListId}">${raceNumberOptions}</datalist>` : ''}
          </div>

          <div class="lv-field-group">
            <label>Team:</label>
            <input type="text"
                   class="lv-edit-input"
                   data-field="team"
                   value="${vehicle.team || ''}"
                   placeholder="Enter team name..."
                   autocomplete="off" />
          </div>

          <div class="lv-field-group">
            <label>Drivers:</label>
            <input type="text"
                   class="lv-edit-input${hasPresetData ? ' lv-autocomplete-input' : ''}"
                   data-field="drivers"
                   value="${(vehicle.drivers || []).join(', ')}"
                   placeholder="Enter driver names..."
                   ${hasPresetData ? `list="${driverListId}"` : ''}
                   autocomplete="off" />
            ${hasPresetData ? `<datalist id="${driverListId}">${driverOptions}</datalist>` : ''}
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

      // Strategy G: Recheck learned data availability after correction
      if (changes.raceNumber) {
        try { this._checkLearnedDataAvailability(); } catch (e) { /* non-critical */ }
      }

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

    // Show Save All button when there are unsaved changes
    const saveAllBtn = document.getElementById('lv-save-all');
    if (saveAllBtn && this.manualCorrections.size > 0) {
      saveAllBtn.style.display = 'inline-flex';
      saveAllBtn.classList.add('btn-pulse');
      console.log('[LogVisualizer] Save All button shown - unsaved changes detected');
    }

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

          // Hide Save All button after auto-save
          const saveAllBtn = document.getElementById('lv-save-all');
          if (saveAllBtn) {
            saveAllBtn.style.display = 'none';
            saveAllBtn.classList.remove('btn-pulse');
          }

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
   * Escape HTML special characters to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Extract driver names from a participant object.
   * Uses preset_participant_drivers array (sorted by driver_order) if available,
   * falls back to parsing the nome field (comma-separated).
   */
  getDriverNamesFromParticipant(participant) {
    if (participant.preset_participant_drivers && Array.isArray(participant.preset_participant_drivers) && participant.preset_participant_drivers.length > 0) {
      return [...participant.preset_participant_drivers]
        .sort((a, b) => (a.driver_order || 0) - (b.driver_order || 0))
        .map(d => d.driver_name)
        .filter(Boolean);
    }
    // Fallback: parse nome field
    const nome = participant.nome || '';
    if (!nome) return [];
    return nome.split(',').map(s => s.trim()).filter(Boolean);
  }

  /**
   * Find a participant from preset by race number (exact match)
   */
  findParticipantByNumber(numero) {
    if (!this.presetParticipants || !numero) return null;
    return this.presetParticipants.find(p =>
      p.numero && p.numero.toString().trim() === numero.toString().trim()
    ) || null;
  }

  /**
   * Find a participant from preset by driver name (exact match)
   */
  findParticipantByName(name) {
    if (!this.presetParticipants || !name) return null;
    const nameLower = name.toLowerCase().trim();
    return this.presetParticipants.find(p => {
      const driverNames = this.getDriverNamesFromParticipant(p);
      return driverNames.some(d => d.toLowerCase().trim() === nameLower);
    }) || null;
  }

  /**
   * Auto-fill Team and Drivers (or Race Number) from a matched participant.
   * sourceField indicates which field triggered the match so we skip overwriting it.
   */
  autoFillFromParticipant(vehicleEditor, participant, sourceField) {
    if (sourceField !== 'raceNumber') {
      const raceInput = vehicleEditor.querySelector('[data-field="raceNumber"]');
      if (raceInput && participant.numero) {
        raceInput.value = participant.numero;
      }
    }

    if (sourceField !== 'team') {
      const teamInput = vehicleEditor.querySelector('[data-field="team"]');
      if (teamInput && participant.squadra) {
        teamInput.value = participant.squadra;
      }
    }

    if (sourceField !== 'drivers') {
      const driversInput = vehicleEditor.querySelector('[data-field="drivers"]');
      if (driversInput) {
        const names = this.getDriverNamesFromParticipant(participant).join(', ');
        if (names) {
          driversInput.value = names;
        }
      }
    }

    console.log(`[LogVisualizer] Auto-filled from preset: #${participant.numero} → ${this.getDriverNamesFromParticipant(participant).join(', ')} / ${participant.squadra || ''}`);
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

        // Hide Save All button after successful save
        const saveAllBtn = document.getElementById('lv-save-all');
        if (saveAllBtn) {
          saveAllBtn.style.display = 'none';
          saveAllBtn.classList.remove('btn-pulse');
          console.log('[LogVisualizer] Save All button hidden - all changes saved');
        }

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
   * Strategy G: Check if there's learnable data available and show the badge/button.
   * Called after gallery closes, after corrections are saved, and during initial render.
   * Does NOT open the modal — just aggregates data and updates the UI badge.
   */
  async _checkLearnedDataAvailability() {
    if (!window.learnedDataModal) return;

    const presetId = this.participantPresetData?.id;
    if (!presetId) return;

    // If this execution was already processed (user accepted learned data),
    // don't re-propose the same data — hide the button and exit early.
    if (window.learnedDataModal.processedExecutions?.has(this.executionId)) {
      const learnedBtn = document.getElementById('lv-learned-data');
      if (learnedBtn) learnedBtn.style.display = 'none';
      return;
    }

    // Persistent check: query DB to see if ANY participant in this preset
    // already has this executionId in custom_fields.learned.source_execution_ids.
    // This survives page reloads (unlike processedExecutions Set) and bypasses cache.
    try {
      const checkResult = await window.api.invoke('check-learned-data-exists', {
        presetId,
        executionId: this.executionId,
      });
      if (checkResult?.success && checkResult.data?.exists) {
        // At least one participant already has learned data from this execution
        console.log(`[LogVisualizer] Execution ${this.executionId} already has learned data saved — hiding button`);
        window.learnedDataModal.processedExecutions.add(this.executionId);
        const learnedBtn = document.getElementById('lv-learned-data');
        if (learnedBtn) learnedBtn.style.display = 'none';
        return;
      }
    } catch (dbCheckErr) {
      // Non-critical, fall through to normal aggregation
      console.warn('[LogVisualizer] DB check for learned data failed (non-critical):', dbCheckErr);
    }

    // Strategy G only applies to Gemini executions — ONNX models don't produce
    // Vehicle DNA (sponsors, team, livery, etc.) so there's nothing to learn from.
    // Check EXECUTION_COMPLETE.recognitionStats.method or individual vehicle modelSource.
    // NOTE: historical 'rf-detr' executions (pre-2026-04-22 cleanup) are also covered
    // so the learned-data button hides for archival ONNX/RF-DETR logs too.
    if (this.logData) {
      const completeEvent = this.logData.find(e => e.type === 'EXECUTION_COMPLETE');
      const method = completeEvent?.recognitionStats?.method;
      if (method === 'local-onnx' || method === 'rf-detr') {
        // Pure local execution (ONNX today, historical RF-DETR logs) — no Vehicle DNA
        const learnedBtn = document.getElementById('lv-learned-data');
        if (learnedBtn) learnedBtn.style.display = 'none';
        return;
      }
    }

    // Reset the modal's aggregated data for fresh calculation
    window.learnedDataModal.aggregatedData = null;

    // Build corrections map from MANUAL_CORRECTION events in logData
    const sessionCorrections = new Map();
    if (this.logData) {
      const manualEvents = this.logData.filter(e => e.type === 'MANUAL_CORRECTION');
      for (const event of manualEvents) {
        const key = `${event.fileName}_${event.vehicleIndex}`;
        sessionCorrections.set(key, {
          fileName: event.fileName,
          vehicleIndex: event.vehicleIndex,
          changes: event.changes || {},
          timestamp: event.timestamp,
        });
      }
    }

    // Also include any still-in-memory corrections
    if (this.manualCorrections && this.manualCorrections.size > 0) {
      for (const [key, correction] of this.manualCorrections) {
        if (!sessionCorrections.has(key)) {
          sessionCorrections.set(key, correction);
        }
      }
    }

    const hasNumberCorrections = Array.from(sessionCorrections.values()).some(c => c.changes?.raceNumber);

    // Aggregate from user corrections
    if (hasNumberCorrections) {
      window.learnedDataModal.aggregateLearnedData(
        this.imageResults,
        sessionCorrections,
        this.presetParticipants
      );
    }

    // Aggregate from consistent auto-detections
    window.learnedDataModal.aggregateConsistentDetections(
      this.imageResults,
      this.presetParticipants,
      5
    );

    const totalProposals = window.learnedDataModal.aggregatedData;
    const learnedBtn = document.getElementById('lv-learned-data');
    const learnedCount = document.getElementById('lv-learned-data-count');

    if (totalProposals && totalProposals.size > 0 && learnedBtn) {
      learnedBtn.style.display = 'inline-flex';
      if (learnedCount) learnedCount.textContent = totalProposals.size;
      console.log(`[LogVisualizer] Learned data available for ${totalProposals.size} participants — badge shown`);
    } else if (learnedBtn) {
      learnedBtn.style.display = 'none';
    }
  }

  /**
   * Strategy G: Open the learned data modal on user request (button click).
   */
  async _openLearnedDataModal() {
    if (!window.learnedDataModal) return;

    const presetId = this.participantPresetData?.id;
    if (!presetId) {
      this.showNotification('No preset loaded', 'warning');
      return;
    }

    const totalProposals = window.learnedDataModal.aggregatedData;
    if (!totalProposals || totalProposals.size === 0) {
      this.showNotification('No learnable data available', 'info');
      return;
    }

    const accepted = await window.learnedDataModal.show(presetId, this.executionId);
    if (accepted) {
      console.log('[LogVisualizer] User accepted learned data updates');
      this.showNotification('✅ Preset updated with learned data', 'success');

      // Hide the button after successful update
      const learnedBtn = document.getElementById('lv-learned-data');
      if (learnedBtn) learnedBtn.style.display = 'none';

      // Refresh preset participants so dedup logic sees saved data
      // (prevents re-proposal if processedExecutions is somehow bypassed)
      try {
        await this.loadParticipantPresetData();
        console.log('[LogVisualizer] Preset participants refreshed after learned data save');
      } catch (e) {
        console.warn('[LogVisualizer] Could not refresh preset participants:', e);
      }
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
        matchedBy: vehicle.finalResult?.matchedBy || 'none',
        matchStatus: vehicle.finalResult?.matchStatus || 'no_match',
        alternativeCandidates: vehicle.finalResult?.alternativeCandidates || null,
        // Issue #104 — extra-preset people (VIPs, team principals, etc.), only populated
        // when the preset has allow_external_person_recognition = true.
        otherPeople: Array.isArray(vehicle.otherPeople) ? vehicle.otherPeople : []
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
        compressedPath: event.compressedPath,
        // Include visual tags if available
        visualTags: event.visualTags || null,
        // Store original log event for additional data access
        logEvent: event
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
            if (field !== 'deleted' && field !== 'deletedAt' && field !== 'originalData' &&
                field !== 'resolvedFromReview' && field !== 'chosenCandidate') {
              result.analysis[vehicleIndex][field] = value;
            }
          });

          // If this correction was a review resolution, mark the result accordingly
          if (changes.resolvedFromReview) {
            result._reviewResolved = true;
          }

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
   * Export visual tags as CSV
   */
  async exportTagsAsCSV() {
    if (!this.executionId) {
      this.showNotification('⚠️ No execution found for tag export', 'warning');
      return;
    }

    try {
      this.showNotification('🏷️ Exporting visual tags...', 'info');

      const result = await window.api.invoke('export-tags-csv', { executionId: this.executionId });

      if (result.success) {
        if (result.count === 0) {
          this.showNotification('⚠️ No visual tags found for this execution', 'warning');
          return;
        }

        const blob = new Blob([result.csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const filename = `racetagger_visual_tags_${new Date().toISOString().split('T')[0]}.csv`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
        this.showNotification(`🏷️ Exported ${result.count} tagged images`, 'success');
      } else {
        this.showNotification(result.error || '❌ Failed to export tags', 'error');
      }
    } catch (error) {
      console.error('[LogVisualizer] Error exporting tags CSV:', error);
      this.showNotification('❌ Failed to export visual tags: ' + error.message, 'error');
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
   * Post-Analysis Folder Organization
   * Trigger folder organization after analysis is complete
   */
  async triggerPostAnalysisOrganization() {
    try {
      console.log('[LogVisualizer] Starting post-analysis folder organization...');

      // Get folder organization config from the post-organization form
      const folderOrgConfig = this.getPostOrganizationConfig();

      if (!folderOrgConfig.enabled) {
        this.showNotification('ℹ️ Please configure folder organization first', 'info');
        return;
      }

      // Warn user before move — this is a one-time operation
      if (folderOrgConfig.mode === 'move') {
        const confirmed = confirm(
          'You selected "Move" mode. This will relocate the original files to organized folders.\n\n' +
          'Once moved, the files will no longer be at their original paths and you will not be able to reorganize them again for this execution.\n\n' +
          'Do you want to continue?'
        );
        if (!confirmed) {
          console.log('[LogVisualizer] User cancelled move organization');
          return;
        }
      }

      // Show inline progress bar in the organization section
      const actionsDiv = document.querySelector('.lv-folder-org-actions');
      const startBtn = document.getElementById('lv-start-organization');
      const toggleBtn = document.getElementById('lv-toggle-folder-org');

      if (startBtn) startBtn.style.display = 'none';
      if (toggleBtn) toggleBtn.style.display = 'none';

      // Create progress bar container
      const progressContainer = document.createElement('div');
      progressContainer.id = 'lv-folder-org-progress';
      progressContainer.className = 'lv-folder-org-progress';
      progressContainer.innerHTML = `
        <div class="lv-folder-org-progress-header">
          <span class="lv-folder-org-progress-label">🔄 Organizing photos into folders...</span>
          <span class="lv-folder-org-progress-count" id="lv-org-progress-count">0%</span>
        </div>
        <div class="lv-folder-org-progress-bar-container">
          <div class="lv-folder-org-progress-bar" id="lv-org-progress-bar" style="width: 0%"></div>
        </div>
        <div class="lv-folder-org-progress-detail" id="lv-org-progress-detail">Preparing...</div>
      `;

      // Insert progress bar before actions or at end of section
      const section = document.getElementById('lv-folder-org-section');
      if (actionsDiv) {
        actionsDiv.parentNode.insertBefore(progressContainer, actionsDiv);
      } else if (section) {
        section.appendChild(progressContainer);
      }

      // Listen for progress events
      const cleanupProgress = window.api.receive('folder-organization-progress', (data) => {
        const bar = document.getElementById('lv-org-progress-bar');
        const count = document.getElementById('lv-org-progress-count');
        const detail = document.getElementById('lv-org-progress-detail');
        if (bar) bar.style.width = `${data.percent}%`;
        if (count) count.textContent = `${data.percent}%`;
        if (detail) detail.textContent = `${data.current} of ${data.total} photos processed`;
      });

      // Call IPC handler
      const response = await window.api.invoke('organize-results-post-analysis', {
        executionId: this.executionId,
        folderOrganizationConfig: folderOrgConfig
      });

      // Clean up progress listener
      if (cleanupProgress) cleanupProgress();

      // Remove progress bar
      const progressEl = document.getElementById('lv-folder-org-progress');
      if (progressEl) progressEl.remove();

      if (response.success) {
        const summary = response.summary;
        const modeLabel = folderOrgConfig.mode === 'move' ? 'moved' : 'copied';

        // Replace the entire section with completion state
        if (section) {
          section.innerHTML = `
            <div class="lv-folder-org-completed">
              <div class="lv-folder-org-completed-icon">✅</div>
              <div class="lv-folder-org-completed-text">
                <h4>Folder Organization Completed</h4>
                <p><strong>${summary.organizedFiles}</strong> photos ${modeLabel} into <strong>${summary.foldersCreated}</strong> folders${summary.skippedFiles > 0 ? `, ${summary.skippedFiles} skipped` : ''}${summary.unknownFiles > 0 ? `, ${summary.unknownFiles} unknown` : ''}</p>
                ${folderOrgConfig.mode === 'move' ? '<p style="margin-top: 6px; opacity: 0.7; font-size: 13px;">Files were moved (not copied) — this operation cannot be repeated.</p>' : `<p style="margin-top: 6px; opacity: 0.7; font-size: 13px;">Files were copied — originals remain in place.</p>`}
              </div>
            </div>
          `;
        }

        if (folderOrgConfig.mode === 'move' && summary.organizedFiles > 0) {
          this.moveOrganizationCompleted = true;
        }

        if (response.errors && response.errors.length > 0) {
          console.warn('[LogVisualizer] Organization completed with errors:', response.errors);
          this.showNotification(`⚠️ ${response.errors.length} files had errors (check console)`, 'warning');
        }
      } else {
        // Restore buttons on error
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (toggleBtn) toggleBtn.style.display = 'inline-flex';
        throw new Error(response.error || 'Organization failed');
      }

    } catch (error) {
      console.error('[LogVisualizer] Error in post-analysis organization:', error);
      this.showNotification(`❌ Organization failed: ${error.message}`, 'error');
      // Restore buttons on error
      const startBtn = document.getElementById('lv-start-organization');
      const toggleBtn = document.getElementById('lv-toggle-folder-org');
      if (startBtn) startBtn.style.display = 'inline-flex';
      if (toggleBtn) toggleBtn.style.display = 'inline-flex';
    }
  }

  /**
   * Check if folder organization UI should be shown
   */
  shouldShowFolderOrganizationUI() {
    // Always show - folder organization is now exclusively a post-analysis action
    return true;
  }

  /**
   * Show notification to user
   */
  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `lv-notification lv-notification-${type}`;
    notification.style.whiteSpace = 'pre-line'; // Allow line breaks
    notification.textContent = message;

    // Add to page
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);

    // Remove after delay
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 5000); // Increased to 5s for longer messages
  }
}

// Global instance
window.logVisualizer = new LogVisualizer();

console.log('[LogVisualizer] Module loaded');