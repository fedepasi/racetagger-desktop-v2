/**
 * Driver Face Manager - Multi-Driver Support
 *
 * Manages per-driver metadata (nationality, metatag) and face recognition.
 * Creates individual panels for each driver in a participant entry.
 *
 * Architecture:
 * - One panel per driver/person
 * - Each panel has: driver name, nationality, metatag field
 * - When FACE_RECOGNITION_ENABLED: also has 5 photo slots
 * - Syncs with drivers tag input in participant edit modal
 * - Each driver gets their own PresetFaceManager instance (when face rec enabled)
 */

// Feature flag: loaded from DB via feature_flags table (default: false)
// Enabled per-user by admin via PUT /api/admin/feature-flags/[userId]
// with feature_name: 'face_recognition_enabled'
var FACE_RECOGNITION_ENABLED = false;

// Per-person metadata is always enabled (nationality, metatag)
const PERSON_METADATA_ENABLED = true;

/**
 * Load face recognition feature flag from DB (same pattern as delivery)
 * Uses the existing delivery-get-plan-limits IPC channel which returns getUserPlanLimits()
 */
async function loadFaceRecognitionFlag() {
  try {
    const planLimits = await window.api.invoke('delivery-get-plan-limits');
    if (planLimits.success && planLimits.data) {
      FACE_RECOGNITION_ENABLED = planLimits.data.face_recognition_enabled === true;
      console.log(`[DriverFaceManager] Face recognition feature flag: ${FACE_RECOGNITION_ENABLED}`);
    }
  } catch (error) {
    console.warn('[DriverFaceManager] Could not load face recognition flag:', error.message || error);
    // Default remains false
  }

  // Initialize face detector now that the flag is known
  if (FACE_RECOGNITION_ENABLED && typeof window.initFaceDetector === 'function') {
    window.initFaceDetector();
  }
}

class DriverFaceManagerMulti {
  constructor() {
    this.currentParticipantId = null;
    this.currentPresetId = null;
    this.currentUserId = null;
    this.isOfficial = false;
    this.drivers = []; // Array of { id, name, metatag, nationality, order, faceManager }
    this.isSyncing = false; // Track sync state for awaiting completion

    // DOM references
    this.containerElement = null;
    this.emptyStateElement = null;
  }

  /**
   * Initialize the manager with DOM elements and load feature flag from DB
   */
  async initialize() {
    this.containerElement = document.getElementById('driver-panels-container');
    this.emptyStateElement = document.getElementById('driver-panels-empty-state');

    // Load face recognition flag from DB (non-blocking, same as delivery pattern)
    await loadFaceRecognitionFlag();

    console.log('[DriverFaceManagerMulti] Initialized (face_recognition_enabled:', FACE_RECOGNITION_ENABLED, ')');
  }

  /**
   * Load drivers for a participant
   * @param {string|null} participantId - Participant ID
   * @param {string} presetId - Preset ID
   * @param {string} userId - User ID
   * @param {boolean} isOfficial - Whether preset is official
   * @param {string[]} driverNames - Array of driver names from tag input
   * @param {Array|null} existingDrivers - Existing driver records from DB (optional)
   */
  async load(participantId, presetId, userId, isOfficial, driverNames = [], existingDrivers = null) {
    // Person metadata panels are always available; face recognition requires flag
    if (!PERSON_METADATA_ENABLED && !FACE_RECOGNITION_ENABLED) {
      console.log('[DriverFaceManagerMulti] Both features disabled - skipping load');
      return;
    }

    this.currentParticipantId = participantId;
    this.currentPresetId = presetId;
    this.currentUserId = userId;
    this.isOfficial = isOfficial;

    // Show/hide container based on driver names
    if (!driverNames || driverNames.length === 0) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();

    // If we have existing driver records from DB, use them directly
    if (participantId && existingDrivers && existingDrivers.length > 0) {
      this.drivers = existingDrivers.map(dbDriver => ({
        id: dbDriver.id,              // Use existing ID!
        name: dbDriver.driver_name,
        metatag: dbDriver.driver_metatag || '',
        nationality: dbDriver.driver_nationality || '',
        order: dbDriver.driver_order,
        // v1.1.4 — soft-disable flag. Undefined/null treated as active.
        is_active: dbDriver.is_active !== false,
        faceManager: null
      }));

      console.log(`[DriverFaceManagerMulti] Loaded ${this.drivers.length} existing drivers from DB`);
    } else if (participantId && driverNames.length > 0 && FACE_RECOGNITION_ENABLED) {
      // Sync with backend only when face recognition needs it
      console.log('[DriverFaceManagerMulti] No existing records, syncing drivers with backend');
      await this.syncDrivers(driverNames);
    } else {
      // Create UI skeleton from names (for metadata-only mode or new participant)
      this.drivers = driverNames.map((name, index) => ({
        id: null, // Will be created on save
        name: name,
        metatag: '',
        nationality: '',
        order: index,
        faceManager: null
      }));
    }

    // Render UI
    await this.render();
  }

  /**
   * Sync drivers with backend database
   * Creates/updates/deletes drivers to match the provided names array
   */
  async syncDrivers(driverNames) {
    if (!FACE_RECOGNITION_ENABLED) return;

    if (!this.currentParticipantId) {
      console.warn('[DriverFaceManagerMulti] Cannot sync without participantId');
      return;
    }

    // Set syncing flag to prevent race conditions
    this.isSyncing = true;
    console.log('[DriverFaceManagerMulti] 🔄 Sync started');

    try {
      const result = await window.api.invoke('preset-driver-sync', {
        participantId: this.currentParticipantId,
        driverNames: driverNames
      });

      if (result.success) {
        // Preserve existing face managers when syncing
        const existingDrivers = new Map(this.drivers.map(d => [d.name, d]));

        this.drivers = (result.drivers || []).map(driver => {
          const existing = existingDrivers.get(driver.driver_name);

          // Update existing driver data and preserve face manager
          if (existing) {
            existing.id = driver.id;
            existing.metatag = driver.driver_metatag || '';
            existing.nationality = driver.driver_nationality || '';
            existing.order = driver.driver_order;
            // v1.1.4 — carry the soft-disable flag through the sync.
            existing.is_active = driver.is_active !== false;

            // Update the face manager's driver ID if it exists
            if (existing.faceManager && driver.id) {
              existing.faceManager.currentDriverId = driver.id;
              existing.faceManager.currentParticipantId = this.currentParticipantId;
              console.log(`[DriverFaceManagerMulti]   ✓ Updated driver ID for ${driver.driver_name}: ${driver.id?.substring(0, 8)}...`);
            }

            return existing;
          }

          // New driver
          return {
            id: driver.id,
            name: driver.driver_name,
            metatag: driver.driver_metatag || '',
            nationality: driver.driver_nationality || '',
            order: driver.driver_order,
            // v1.1.4 — soft-disable flag (sync returns DEFAULT TRUE for new rows).
            is_active: driver.is_active !== false,
            faceManager: null
          };
        });

        console.log(`[DriverFaceManagerMulti] ✅ Synced ${this.drivers.length} drivers (created: ${result.created}, updated: ${result.updated}, deleted: ${result.deleted})`);
      } else {
        console.error('[DriverFaceManagerMulti] Sync failed:', result.error);
      }
    } catch (error) {
      console.error('[DriverFaceManagerMulti] Sync error:', error);
    } finally {
      // Always clear syncing flag
      this.isSyncing = false;
      console.log('[DriverFaceManagerMulti] 🏁 Sync complete');
    }
  }

  /**
   * Wait for sync to complete
   * Used by photo upload to ensure driver IDs are ready
   */
  async waitForSync() {
    console.log('[DriverFaceManagerMulti] ⏳ Waiting for sync to complete...');
    let waited = 0;
    const maxWait = 5000; // 5 seconds max
    const checkInterval = 100;

    while (this.isSyncing && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    if (this.isSyncing) {
      console.warn('[DriverFaceManagerMulti] ⚠️  Sync still in progress after', maxWait, 'ms');
    } else {
      console.log('[DriverFaceManagerMulti] ✅ Sync wait complete (waited', waited, 'ms)');
    }
  }

  /**
   * Update driver metatag in database
   */
  async updateDriverMetatag(driverId, metatag) {
    if (!driverId) return; // New driver, not yet saved

    try {
      const result = await window.api.invoke('preset-driver-update', {
        driverId: driverId,
        driverMetatag: metatag
      });

      if (result.success) {
        console.log(`[DriverFaceManagerMulti] Updated metatag for driver ${driverId}`);
      } else {
        console.error('[DriverFaceManagerMulti] Update metatag failed:', result.error);
      }
    } catch (error) {
      console.error('[DriverFaceManagerMulti] Update metatag error:', error);
    }
  }

  /**
   * Update driver nationality in database
   */
  async updateDriverNationality(driverId, nationality) {
    if (!driverId) return; // New driver, not yet saved

    try {
      const result = await window.api.invoke('preset-driver-update', {
        driverId: driverId,
        driverNationality: nationality
      });

      if (result.success) {
        console.log(`[DriverFaceManagerMulti] Updated nationality for driver ${driverId}`);
      } else {
        console.error('[DriverFaceManagerMulti] Update nationality failed:', result.error);
      }
    } catch (error) {
      console.error('[DriverFaceManagerMulti] Update nationality error:', error);
    }
  }

  /**
   * Show empty state (no drivers)
   */
  showEmptyState() {
    if (this.containerElement) {
      this.containerElement.style.display = 'none';
    }
    if (this.emptyStateElement) {
      this.emptyStateElement.style.display = 'block';
      this.emptyStateElement.innerHTML = `
        <div style="text-align: center; padding: 1.5rem; color: var(--text-dark); opacity: 0.6;">
          <p>Add people names above to see per-person metadata fields here.</p>
        </div>
      `;
    }
  }

  /**
   * Hide empty state
   */
  hideEmptyState() {
    if (this.containerElement) {
      this.containerElement.style.display = 'block';
    }
    if (this.emptyStateElement) {
      this.emptyStateElement.style.display = 'none';
    }
  }

  /**
   * Render all driver panels
   */
  async render() {
    if (!this.containerElement) return;

    this.containerElement.innerHTML = '';

    // Create and append all panels first
    this.drivers.forEach((driver, index) => {
      const panel = this.createDriverPanel(driver, index);
      this.containerElement.appendChild(panel);
    });

    // Initialize face managers AFTER all panels are in DOM (only if face rec enabled)
    if (FACE_RECOGNITION_ENABLED) {
      const initPromises = this.drivers.map(async (driver, index) => {
        if (!driver.faceManager) {
          await this.initializeDriverFaceManager(driver, index);
        } else {
          // Re-attach existing face manager to new DOM elements
          driver.faceManager.gridElement = document.getElementById(`driver-photos-grid-${driver.id || index}`);
          driver.faceManager.countLabel = document.getElementById(`driver-photo-count-${driver.id || index}`);

          // CRITICAL: Update driver ID if it was null before (newly created driver)
          if (driver.id && driver.faceManager.currentDriverId !== driver.id) {
            driver.faceManager.currentDriverId = driver.id;
            driver.faceManager.currentParticipantId = this.currentParticipantId;
            console.log(`[DriverFaceManagerMulti] ✓ Updated face manager driver ID: ${driver.id}`);
          }

          // Re-attach button event listener
          const addButton = document.querySelector(`[data-driver-index="${index}"]`);
          if (addButton && driver.faceManager.addButton !== addButton) {
            driver.faceManager.addButton = addButton;
            addButton.addEventListener('click', () => driver.faceManager.triggerUpload());
          }

          // Re-render with updated IDs
          driver.faceManager.render();

          console.log(`[DriverFaceManagerMulti] Re-attached face manager for driver ${index} with ID ${driver.id}`);
        }
      });

      await Promise.all(initPromises);
    }
  }

  /**
   * Create a panel for a single driver
   */
  createDriverPanel(driver, index) {
    const panel = document.createElement('div');
    panel.className = 'driver-panel';
    panel.dataset.driverId = driver.id || `temp-${index}`;

    // v1.1.4 — soft-disable: dim the panel when the driver is inactive
    const driverIsActive = driver.is_active !== false;
    if (!driverIsActive) panel.classList.add('driver-panel-inactive');

    // Header with driver name + per-driver Active toggle (v1.1.4)
    // The toggle is hidden for official presets (read-only) and for drivers
    // that haven't been persisted yet (no id → nothing to toggle in DB).
    const header = document.createElement('div');
    header.className = 'driver-panel-header';
    const canToggleDriver = !this.isOfficial && !!driver.id;
    const driverToggleTitle = this.isOfficial
      ? 'Official preset: duplicate to customize'
      : (driverIsActive
          ? 'Disable this driver from AI matching (face recognition, names)'
          : 'Re-enable this driver for AI matching');
    header.innerHTML = `
      <h4 class="driver-panel-title">${this.escapeHtml(driver.name)}</h4>
      <span class="driver-panel-order">Person ${index + 1}</span>
      ${canToggleDriver ? `
        <label class="active-toggle driver-active-toggle" title="${driverToggleTitle}">
          <input type="checkbox" class="active-toggle-input driver-active-toggle-input"
                 ${driverIsActive ? 'checked' : ''}
                 data-driver-id="${this.escapeHtml(driver.id)}">
          <span class="active-toggle-slider"></span>
        </label>
      ` : ''}
    `;
    panel.appendChild(header);

    // v1.1.4 — wire up the driver toggle (optimistic UI with revert on error)
    if (canToggleDriver) {
      const toggleInput = header.querySelector('.driver-active-toggle-input');
      if (toggleInput) {
        toggleInput.addEventListener('change', async (e) => {
          const newState = !!e.target.checked;
          toggleInput.disabled = true;
          if (newState) {
            panel.classList.remove('driver-panel-inactive');
          } else {
            panel.classList.add('driver-panel-inactive');
          }
          try {
            const res = await window.api.invoke('preset:toggleDriverActive', {
              driverId: driver.id,
              isActive: newState
            });
            if (!res || !res.success) throw new Error(res?.error || 'Error');
            driver.is_active = newState;
            // Nudge the participants table summary in case it's open
            if (typeof updateActiveParticipantsSummary === 'function') {
              updateActiveParticipantsSummary();
            }
            if (typeof showNotification === 'function') {
              showNotification(
                newState ? 'Driver re-enabled' : 'Driver disabled from AI matching',
                'success'
              );
            }
          } catch (err) {
            // Revert
            toggleInput.checked = !newState;
            if (!newState) {
              panel.classList.remove('driver-panel-inactive');
            } else {
              panel.classList.add('driver-panel-inactive');
            }
            console.error('[DriverToggle] failed:', err);
            if (typeof showNotification === 'function') {
              showNotification(`Update failed: ${err.message}`, 'error');
            }
          } finally {
            toggleInput.disabled = false;
          }
        });
      }
    }

    // Nationality input (always visible)
    const nationalityGroup = document.createElement('div');
    nationalityGroup.className = 'form-group';
    nationalityGroup.innerHTML = `
      <label>
        Nationality
        <span class="field-destination field-destination-matching">→ {nationality}</span>
      </label>
      <input
        type="text"
        class="form-input form-input-metadata driver-nationality-input"
        placeholder="e.g. NED, ITA, GBR, Dutch, Italian..."
        value="${this.escapeHtml(driver.nationality)}"
        ${this.isOfficial ? 'disabled' : ''}
        data-driver-id="${driver.id || ''}"
      >
      <small class="form-hint">
        Used as <code>{nationality}</code> in caption and Person Shown templates
      </small>
    `;
    panel.appendChild(nationalityGroup);

    // Setup nationality input event listener
    if (!this.isOfficial) {
      const nationalityInput = nationalityGroup.querySelector('.driver-nationality-input');
      nationalityInput.addEventListener('change', async (e) => {
        const newNationality = e.target.value.trim();
        driver.nationality = newNationality;

        if (driver.id) {
          await this.updateDriverNationality(driver.id, newNationality);
        }
      });
    }

    // Metatag input (always visible)
    const metatagGroup = document.createElement('div');
    metatagGroup.className = 'form-group';
    metatagGroup.innerHTML = `
      <label>
        Person Meta Tag
        <span class="field-destination">→ IPTC:Caption/Description</span>
      </label>
      <input
        type="text"
        class="form-input form-input-metadata driver-metatag-input"
        placeholder="Pro Driver, Champion 2024..."
        value="${this.escapeHtml(driver.metatag)}"
        ${this.isOfficial ? 'disabled' : ''}
        data-driver-id="${driver.id || ''}"
      >
      <small class="form-hint">
        Written to Caption/Description during analysis. Per-person metadata (e.g. titles, championships)
      </small>
    `;
    panel.appendChild(metatagGroup);

    // Setup metatag input event listener
    if (!this.isOfficial) {
      const metatagInput = metatagGroup.querySelector('.driver-metatag-input');
      metatagInput.addEventListener('change', async (e) => {
        const newMetatag = e.target.value.trim();
        driver.metatag = newMetatag;

        if (driver.id) {
          await this.updateDriverMetatag(driver.id, newMetatag);
        }
      });
    }

    // Face photos section (only when face recognition enabled)
    if (FACE_RECOGNITION_ENABLED) {
      const photosSection = document.createElement('div');
      photosSection.className = 'driver-photos-section';
      photosSection.innerHTML = `
        <h5 class="driver-photos-title">Face Recognition Photos</h5>
        <div class="driver-photos-grid" id="driver-photos-grid-${driver.id || index}"></div>
        <div class="driver-photos-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm driver-add-photo-btn"
            data-driver-index="${index}"
            ${this.isOfficial ? 'disabled' : ''}
          >
            <span class="btn-icon">📷</span>
            Add Photo
          </button>
          <span class="driver-photo-count" id="driver-photo-count-${driver.id || index}">0/5 photos</span>
        </div>
      `;
      panel.appendChild(photosSection);
    }

    return panel;
  }

  /**
   * Initialize PresetFaceManager for a driver
   */
  async initializeDriverFaceManager(driver, index) {
    if (!FACE_RECOGNITION_ENABLED) return;

    // Create a new face manager instance for this driver
    const faceManager = new PresetFaceManager();

    // Set custom DOM elements for this driver's panel
    faceManager.gridElement = document.getElementById(`driver-photos-grid-${driver.id || index}`);
    faceManager.countLabel = document.getElementById(`driver-photo-count-${driver.id || index}`);

    // Clean up any existing file input with the same ID
    const existingInput = document.getElementById(`driver-photo-input-${driver.id || index}`);
    if (existingInput && existingInput.parentNode) {
      existingInput.parentNode.removeChild(existingInput);
    }

    // Create custom file input for this driver
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.id = `driver-photo-input-${driver.id || index}`;
    document.body.appendChild(fileInput);
    faceManager.fileInput = fileInput;

    // Setup file input event
    fileInput.addEventListener('change', (e) => faceManager.handleFileSelect(e));

    // Setup add photo button
    const addButton = document.querySelector(`[data-driver-index="${index}"]`);
    if (addButton) {
      faceManager.addButton = addButton;
      addButton.addEventListener('click', () => faceManager.triggerUpload());
    }

    // Initialize face detector reference
    if (window.getFaceDetector) {
      faceManager.faceDetector = window.getFaceDetector();
    }

    // Load photos for this driver (if driver has ID)
    if (driver.id) {
      await faceManager.loadPhotos(
        this.currentParticipantId, // participantId needed even for drivers
        this.currentPresetId,
        this.currentUserId,
        this.isOfficial,
        driver.id // driverId
      );
    } else {
      // New driver - just render empty state but keep participant/preset context
      faceManager.currentParticipantId = this.currentParticipantId;
      faceManager.currentDriverId = null;
      faceManager.currentPresetId = this.currentPresetId;
      faceManager.currentUserId = this.currentUserId;
      faceManager.isOfficial = this.isOfficial;
      faceManager.render();
    }

    // Store reference
    driver.faceManager = faceManager;

    // Debug log
    console.log(`[DriverFaceManagerMulti] Initialized face manager for driver ${index}:`, {
      driverId: driver.id,
      participantId: this.currentParticipantId,
      hasButton: !!addButton,
      hasFileInput: !!fileInput
    });
  }

  /**
   * Reset all state
   */
  reset() {
    // Clean up all face managers
    this.drivers.forEach(driver => {
      if (driver.faceManager) {
        driver.faceManager.reset();

        // Remove custom file input
        const fileInput = driver.faceManager.fileInput;
        if (fileInput && fileInput.parentNode) {
          fileInput.parentNode.removeChild(fileInput);
        }
      }
    });

    this.drivers = [];
    this.currentParticipantId = null;
    this.currentPresetId = null;
    this.currentUserId = null;
    this.isOfficial = false;

    if (this.containerElement) {
      this.containerElement.innerHTML = '';
    }

    this.showEmptyState();
  }

  /**
   * Helper: Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Get current driver metatags (for saving)
   * Returns: Array of { driverId, driverName, metatag, nationality }
   */
  getDriverMetatags() {
    return this.drivers.map(driver => ({
      driverId: driver.id,
      driverName: driver.name,
      metatag: driver.metatag,
      nationality: driver.nationality
    }));
  }
}

// Create global instance
const driverFaceManagerMulti = new DriverFaceManagerMulti();

// Export for use in participants-manager.js
window.driverFaceManagerMulti = driverFaceManagerMulti;
