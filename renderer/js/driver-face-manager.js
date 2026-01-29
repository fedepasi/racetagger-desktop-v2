/**
 * Driver Face Manager - Multi-Driver Support
 *
 * Manages per-driver face recognition and metatags.
 * Creates individual panels for each driver in a participant entry.
 *
 * Architecture:
 * - One panel per driver
 * - Each panel has: driver name, metatag field, 5 photo slots
 * - Syncs with drivers tag input in participant edit modal
 * - Each driver gets their own PresetFaceManager instance
 */

class DriverFaceManagerMulti {
  constructor() {
    this.currentParticipantId = null;
    this.currentPresetId = null;
    this.currentUserId = null;
    this.isOfficial = false;
    this.drivers = []; // Array of { id, name, metatag, order, faceManager }
    this.isSyncing = false; // Track sync state for awaiting completion

    // DOM references
    this.containerElement = null;
    this.emptyStateElement = null;
  }

  /**
   * Initialize the manager with DOM elements
   */
  initialize() {
    this.containerElement = document.getElementById('driver-panels-container');
    this.emptyStateElement = document.getElementById('driver-panels-empty-state');

    console.log('[DriverFaceManagerMulti] Initialized');
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
        order: dbDriver.driver_order,
        faceManager: null
      }));

      console.log(`[DriverFaceManagerMulti] Loaded ${this.drivers.length} existing drivers from DB`);
    } else if (participantId && driverNames.length > 0) {
      // No existing records - sync with backend (create/update/delete as needed)
      console.log('[DriverFaceManagerMulti] No existing records, syncing drivers with backend');
      await this.syncDrivers(driverNames);
    } else {
      // New participant - just create UI skeleton
      this.drivers = driverNames.map((name, index) => ({
        id: null, // Will be created on save
        name: name,
        metatag: '',
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
            existing.order = driver.driver_order;

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
            order: driver.driver_order,
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
   * Show empty state (no drivers)
   */
  showEmptyState() {
    if (this.containerElement) {
      this.containerElement.style.display = 'none';
    }
    if (this.emptyStateElement) {
      this.emptyStateElement.style.display = 'block';
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

    // Initialize face managers AFTER all panels are in DOM
    // Only initialize if face manager doesn't exist yet
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

  /**
   * Create a panel for a single driver
   */
  createDriverPanel(driver, index) {
    const panel = document.createElement('div');
    panel.className = 'driver-panel';
    panel.dataset.driverId = driver.id || `temp-${index}`;

    // Header with driver name
    const header = document.createElement('div');
    header.className = 'driver-panel-header';
    header.innerHTML = `
      <h4 class="driver-panel-title">${this.escapeHtml(driver.name)}</h4>
      <span class="driver-panel-order">Driver ${index + 1}</span>
    `;
    panel.appendChild(header);

    // Metatag input
    const metatagGroup = document.createElement('div');
    metatagGroup.className = 'form-group';
    metatagGroup.innerHTML = `
      <label>
        Driver Meta Tag
        <span class="field-destination">→ IPTC:Keywords (when face recognized)</span>
      </label>
      <input
        type="text"
        class="form-input driver-metatag-input"
        placeholder="Pro Driver, Champion 2024..."
        value="${this.escapeHtml(driver.metatag)}"
        ${this.isOfficial ? 'disabled' : ''}
        data-driver-id="${driver.id || ''}"
      >
      <small class="form-hint">
        Written to IPTC keywords ONLY when THIS driver's face is recognized
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

    // Face photos section
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

    return panel;
  }

  /**
   * Initialize PresetFaceManager for a driver
   */
  async initializeDriverFaceManager(driver, index) {
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
   * Returns: Array of { driverId, metatag }
   */
  getDriverMetatags() {
    return this.drivers.map(driver => ({
      driverId: driver.id,
      driverName: driver.name,
      metatag: driver.metatag
    }));
  }
}

// Create global instance
const driverFaceManagerMulti = new DriverFaceManagerMulti();

// Export for use in participants-manager.js
window.driverFaceManagerMulti = driverFaceManagerMulti;
