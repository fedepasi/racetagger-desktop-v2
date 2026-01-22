/**
 * Preset Face Manager V2
 *
 * Handles driver-specific face photo management for participant presets:
 * - Per-driver photo sections (3 photos each)
 * - Driver-specific metatags
 * - Face detection integration
 *
 * Key Changes from V1:
 * - Photos organized by driver instead of global pool
 * - 3 photos per driver (instead of 5 total)
 * - Metatag field per driver integrated into photo section
 */

class PresetFaceManagerV2 {
  constructor() {
    this.currentParticipantId = null;
    this.currentPresetId = null;
    this.currentUserId = null;
    this.drivers = []; // Array of driver names from the "Drivers" field
    this.photos = []; // All photos, keyed by driver_name
    this.driverMetatags = {}; // driver_specific_metatags from database
    this.isUploading = {};  // Track upload state per driver
    this.isOfficial = false;

    // Face detection instance (from face-detector.js)
    this.faceDetector = null;

    // DOM element references
    this.containerElement = null;
    this.section = null;
  }

  /**
   * Initialize the manager
   */
  initialize() {
    this.containerElement = document.getElementById('driver-face-sections-container');
    this.section = document.getElementById('face-photos-section');

    // Initialize face detector
    if (window.getFaceDetector) {
      this.faceDetector = window.getFaceDetector();
    } else if (window.faceDetector) {
      this.faceDetector = window.faceDetector;
    }

    console.log('[PresetFaceManagerV2] Initialized, faceDetector:', this.faceDetector ? 'available' : 'not available');
  }

  /**
   * Load face photos for a participant with multiple drivers
   * @param {string} participantId - Participant ID
   * @param {string} presetId - Preset ID
   * @param {string} userId - User ID
   * @param {Array<string>} drivers - Array of driver names
   * @param {Object} driverMetatags - Driver-specific metatags object
   * @param {boolean} isOfficial - Is this an official preset?
   */
  async loadPhotos(participantId, presetId, userId, drivers = [], driverMetatags = {}, isOfficial = false) {
    this.currentParticipantId = participantId;
    this.currentPresetId = presetId;
    this.currentUserId = userId;
    this.drivers = drivers;
    this.driverMetatags = driverMetatags || {};
    this.isOfficial = isOfficial;
    this.photos = [];

    // For new participants (no ID yet), show section with message
    if (!participantId) {
      this.render();
      this.showSection();
      return;
    }

    try {
      const result = await window.api.invoke('preset-face-get-photos', participantId);

      if (result.success) {
        this.photos = result.photos || [];
      } else {
        console.error('[PresetFaceManagerV2] Failed to load photos:', result.error);
        this.photos = [];
      }

      this.render();
      this.showSection();

    } catch (error) {
      console.error('[PresetFaceManagerV2] Error loading photos:', error);
      this.photos = [];
      this.render();
    }
  }

  /**
   * Reset state
   */
  reset() {
    this.currentParticipantId = null;
    this.currentPresetId = null;
    this.drivers = [];
    this.photos = [];
    this.driverMetatags = {};
    this.isUploading = {};
    this.render();
  }

  /**
   * Show the face photos section
   */
  showSection() {
    if (this.section) {
      this.section.style.display = 'block';
    }
  }

  /**
   * Hide the face photos section
   */
  hideSection() {
    if (this.section) {
      this.section.style.display = 'none';
    }
  }

  /**
   * Get driver-specific metatag (used when getting data for save)
   */
  getDriverMetatags() {
    const metatags = {};
    this.drivers.forEach(driver => {
      const input = document.getElementById(`driver-metatag-${this.sanitizeDriverName(driver)}`);
      if (input && input.value.trim()) {
        metatags[driver] = input.value.trim();
      }
    });
    return metatags;
  }

  /**
   * Main render function - creates driver-specific sections
   */
  render() {
    if (!this.containerElement) return;

    // Clear container
    this.containerElement.innerHTML = '';

    // If no drivers or single driver
    if (this.drivers.length === 0) {
      this.renderLegacySection();
    } else if (this.drivers.length === 1) {
      this.renderSingleDriverSection(this.drivers[0]);
    } else {
      // Multiple drivers - render one section per driver
      this.drivers.forEach(driver => {
        this.renderDriverSection(driver);
      });
    }
  }

  /**
   * Render legacy section (for participants without drivers specified)
   */
  renderLegacySection() {
    const section = document.createElement('div');
    section.className = 'driver-face-section legacy-section';
    section.innerHTML = `
      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div class="info-text">
          Add driver names in the "Drivers" field above to upload face recognition photos.
        </div>
      </div>
    `;
    this.containerElement.appendChild(section);
  }

  /**
   * Render section for single driver
   */
  renderSingleDriverSection(driver) {
    const driverPhotos = this.photos.filter(p => !p.driver_name || p.driver_name === driver);
    const section = this.createDriverSection(driver, driverPhotos, true);
    this.containerElement.appendChild(section);
  }

  /**
   * Render section for one specific driver (multi-driver case)
   */
  renderDriverSection(driver) {
    const driverPhotos = this.photos.filter(p => p.driver_name === driver);
    const section = this.createDriverSection(driver, driverPhotos, false);
    this.containerElement.appendChild(section);
  }

  /**
   * Create a driver-specific section element
   * @param {string} driver - Driver name
   * @param {Array} photos - Photos for this driver
   * @param {boolean} isSingleDriver - Is this the only driver?
   */
  createDriverSection(driver, photos, isSingleDriver) {
    const section = document.createElement('div');
    section.className = 'driver-face-section';
    section.dataset.driver = driver;

    // Driver header (only show for multi-driver)
    if (!isSingleDriver) {
      const header = document.createElement('div');
      header.className = 'driver-face-header';
      header.innerHTML = `
        <h4 class="driver-name">${escapeHtml(driver)}</h4>
        <span class="driver-photo-count">${photos.length}/3 photos</span>
      `;
      section.appendChild(header);

      // Metatag field
      const metatagGroup = document.createElement('div');
      metatagGroup.className = 'form-group driver-metatag-group';
      metatagGroup.innerHTML = `
        <label for="driver-metatag-${this.sanitizeDriverName(driver)}">
          Driver-Specific Metatag
          <span class="field-destination">→ IPTC:Keywords when this driver recognized</span>
        </label>
        <input
          type="text"
          id="driver-metatag-${this.sanitizeDriverName(driver)}"
          class="form-input form-input-metadata driver-metatag-input"
          placeholder="e.g., Ferrari Hypercar Driver, Italian Racing Star"
          value="${escapeHtml(this.driverMetatags[driver] || '')}"
          ${this.isOfficial ? 'disabled' : ''}
        >
        <small class="form-hint">This metatag will be used when this specific driver's face is recognized instead of the general metatag.</small>
      `;
      section.appendChild(metatagGroup);
    }

    // Photo grid
    const grid = document.createElement('div');
    grid.className = 'face-photos-grid driver-photos-grid';
    grid.id = `driver-grid-${this.sanitizeDriverName(driver)}`;

    // Render existing photos
    photos.forEach((photo, index) => {
      const card = this.createPhotoCard(photo, driver, index);
      grid.appendChild(card);
    });

    // Render empty placeholders
    const remainingSlots = 3 - photos.length;
    for (let i = 0; i < remainingSlots; i++) {
      const placeholder = this.createPlaceholder(driver, i === 0 && photos.length === 0);
      grid.appendChild(placeholder);
    }

    section.appendChild(grid);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'face-photos-actions';

    const fileInputId = `face-photo-input-${this.sanitizeDriverName(driver)}`;
    actions.innerHTML = `
      <input type="file" id="${fileInputId}" class="driver-file-input" accept="image/*" style="display: none;" data-driver="${escapeHtml(driver)}">
      <button type="button" class="btn btn-secondary btn-sm driver-add-photo-btn" data-driver="${escapeHtml(driver)}" ${this.isOfficial || photos.length >= 3 ? 'disabled' : ''}>
        <span class="btn-icon">📷</span>
        ${this.isOfficial ? 'Read Only' : photos.length >= 3 ? 'Max Photos' : 'Add Photo'}
      </button>
    `;

    section.appendChild(actions);

    // Setup event listeners for this driver
    this.setupDriverEventListeners(driver, section);

    return section;
  }

  /**
   * Setup event listeners for a driver's section
   */
  setupDriverEventListeners(driver, section) {
    const addBtn = section.querySelector('.driver-add-photo-btn');
    const fileInput = section.querySelector('.driver-file-input');

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (fileInput) {
          fileInput.click();
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFileSelect(e, driver));
    }
  }

  /**
   * Create a photo card element
   */
  createPhotoCard(photo, driver, index) {
    const card = document.createElement('div');
    card.className = 'face-photo-card';
    card.dataset.photoId = photo.id;

    // Image
    const img = document.createElement('img');
    img.src = photo.photo_url;
    img.alt = `${driver} - Photo ${index + 1}`;
    img.loading = 'lazy';
    card.appendChild(img);

    // Primary badge
    if (photo.is_primary) {
      const badge = document.createElement('div');
      badge.className = 'primary-badge';
      badge.textContent = 'Primary';
      card.appendChild(badge);
    }

    // Detection confidence indicator
    if (photo.face_descriptor && photo.detection_confidence) {
      const confidence = document.createElement('div');
      confidence.className = 'confidence-indicator';
      confidence.title = `Face detected (${Math.round(photo.detection_confidence * 100)}% confidence)`;
      confidence.innerHTML = '&#10003;'; // Checkmark
      card.appendChild(confidence);
    } else if (!photo.face_descriptor) {
      const noFace = document.createElement('div');
      noFace.className = 'no-face-indicator';
      noFace.title = 'No face detected in this photo';
      noFace.innerHTML = '&#9888;'; // Warning
      card.appendChild(noFace);
    }

    // Actions (only for non-official presets)
    if (!this.isOfficial) {
      const actions = document.createElement('div');
      actions.className = 'photo-actions';

      // Set as primary button (if not already primary)
      if (!photo.is_primary) {
        const primaryBtn = document.createElement('button');
        primaryBtn.className = 'action-btn primary-btn';
        primaryBtn.title = 'Set as primary';
        primaryBtn.innerHTML = '&#9733;'; // Star
        primaryBtn.onclick = (e) => {
          e.stopPropagation();
          this.setPrimary(photo.id);
        };
        actions.appendChild(primaryBtn);
      }

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete-btn';
      deleteBtn.title = 'Delete photo';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        this.deletePhoto(photo.id, driver);
      };
      actions.appendChild(deleteBtn);

      card.appendChild(actions);
    }

    return card;
  }

  /**
   * Create a placeholder element
   */
  createPlaceholder(driver, isFirst) {
    const placeholder = document.createElement('div');
    placeholder.className = 'face-photo-placeholder';

    if (!this.isOfficial) {
      placeholder.onclick = () => {
        const fileInput = document.getElementById(`face-photo-input-${this.sanitizeDriverName(driver)}`);
        if (fileInput) {
          fileInput.click();
        }
      };
    }

    const content = document.createElement('div');
    content.className = 'placeholder-content';

    const icon = document.createElement('span');
    icon.className = 'placeholder-icon';
    icon.textContent = isFirst ? '📷' : '+';
    content.appendChild(icon);

    if (isFirst) {
      const text = document.createElement('span');
      text.className = 'placeholder-text';
      text.textContent = 'Add Photo';
      content.appendChild(text);
    }

    placeholder.appendChild(content);
    return placeholder;
  }

  /**
   * Handle file selection for upload
   */
  async handleFileSelect(event, driver) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input for re-selection
    event.target.value = '';

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.showNotification('Please select an image file', 'error');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      this.showNotification('Image too large. Maximum 10MB allowed.', 'error');
      return;
    }

    await this.uploadPhoto(file, driver);
  }

  /**
   * Upload a photo for a specific driver
   */
  async uploadPhoto(file, driver) {
    // Auto-save participant if no ID yet
    if (!this.currentParticipantId || !this.currentPresetId) {
      console.log('[PresetFaceManagerV2] No participant ID, triggering auto-save...');
      this.showNotification('Saving participant...', 'info');

      try {
        if (typeof window.saveParticipantAndStay === 'function') {
          await window.saveParticipantAndStay();
          await new Promise(resolve => setTimeout(resolve, 300));

          if (!this.currentParticipantId) {
            this.showNotification('Could not save participant. Please try again.', 'error');
            return;
          }
        } else {
          this.showNotification('Please save the preset first, then try adding photos.', 'warning');
          return;
        }
      } catch (saveError) {
        console.error('[PresetFaceManagerV2] Auto-save failed:', saveError);
        this.showNotification('Failed to save participant: ' + saveError.message, 'error');
        return;
      }
    }

    // Get userId if not set
    if (!this.currentUserId) {
      try {
        const sessionResult = await window.api.invoke('auth-get-session');
        if (sessionResult.success && sessionResult.session?.user) {
          this.currentUserId = sessionResult.session.user.id;
        }
      } catch (e) {
        console.warn('[PresetFaceManagerV2] Could not get session:', e);
      }
    }

    if (!this.currentUserId) {
      this.showNotification('User session not found. Please log in again.', 'warning');
      return;
    }

    // Track upload state
    this.isUploading[driver] = true;
    this.updateDriverButton(driver, true);

    try {
      // Read file as base64
      const base64Data = await this.readFileAsBase64(file);

      // Detect face
      let faceDescriptor = null;
      let detectionConfidence = null;

      if (this.faceDetector) {
        try {
          if (!this.faceDetector.isInitialized) {
            const initResult = await this.faceDetector.initialize();
            if (!initResult.success) {
              console.warn('[PresetFaceManagerV2] Face detector initialization failed:', initResult.error);
            }
          }

          if (this.faceDetector.isInitialized) {
            const result = await this.faceDetector.detectSingleFace(base64Data);
            if (result.success && result.face) {
              faceDescriptor = Array.from(result.face.descriptor);
              detectionConfidence = result.face.confidence;
              console.log(`[PresetFaceManagerV2] Face detected - confidence: ${(detectionConfidence * 100).toFixed(1)}%`);
            } else if (result.success && !result.face) {
              const confirmed = await this.confirmNoFaceDetected();
              if (!confirmed) {
                this.isUploading[driver] = false;
                this.updateDriverButton(driver, false);
                return;
              }
            }
          }
        } catch (detectionError) {
          console.warn('[PresetFaceManagerV2] Face detection failed, continuing without descriptor:', detectionError);
        }
      }

      // Get current photo count for this driver
      const driverPhotos = this.photos.filter(p => p.driver_name === driver);

      // Upload to backend
      const result = await window.api.invoke('preset-face-upload-photo', {
        participantId: this.currentParticipantId,
        presetId: this.currentPresetId,
        userId: this.currentUserId,
        photoData: base64Data,
        fileName: file.name,
        faceDescriptor: faceDescriptor,
        detectionConfidence: detectionConfidence,
        photoType: 'reference',
        isPrimary: driverPhotos.length === 0,
        driverName: driver
      });

      if (result.success) {
        this.photos.push(result.photo);
        this.render();
        this.showNotification(`Photo uploaded for ${driver}`, 'success');
      } else {
        this.showNotification(`Upload failed: ${result.error}`, 'error');
      }

    } catch (error) {
      console.error('[PresetFaceManagerV2] Upload error:', error);
      this.showNotification(`Upload failed: ${error.message}`, 'error');
    } finally {
      this.isUploading[driver] = false;
      this.updateDriverButton(driver, false);
    }
  }

  /**
   * Delete a photo
   */
  async deletePhoto(photoId, driver) {
    if (this.isOfficial) {
      this.showNotification('Official presets cannot be modified', 'warning');
      return;
    }

    const photo = this.photos.find(p => p.id === photoId);
    if (!photo) return;

    if (!confirm(`Delete this photo for ${driver}?`)) {
      return;
    }

    try {
      const result = await window.api.invoke('preset-face-delete-photo', {
        photoId: photo.id,
        storagePath: photo.storage_path
      });

      if (result.success) {
        this.photos = this.photos.filter(p => p.id !== photoId);
        this.render();
        this.showNotification('Photo deleted', 'success');
      } else {
        this.showNotification(`Delete failed: ${result.error}`, 'error');
      }

    } catch (error) {
      console.error('[PresetFaceManagerV2] Delete error:', error);
      this.showNotification(`Delete failed: ${error.message}`, 'error');
    }
  }

  /**
   * Set a photo as primary
   */
  async setPrimary(photoId) {
    if (this.isOfficial) {
      this.showNotification('Official presets cannot be modified', 'warning');
      return;
    }

    try {
      const result = await window.api.invoke('preset-face-set-primary', photoId);

      if (result.success) {
        // Update local state
        const photo = this.photos.find(p => p.id === photoId);
        if (photo) {
          this.photos.forEach(p => {
            p.is_primary = (p.id === photoId && p.driver_name === photo.driver_name);
          });
        }
        this.render();
        this.showNotification('Primary photo updated', 'success');
      } else {
        this.showNotification(`Update failed: ${result.error}`, 'error');
      }

    } catch (error) {
      console.error('[PresetFaceManagerV2] Set primary error:', error);
      this.showNotification(`Update failed: ${error.message}`, 'error');
    }
  }

  /**
   * Update button state for a specific driver
   */
  updateDriverButton(driver, isLoading) {
    const btn = document.querySelector(`.driver-add-photo-btn[data-driver="${driver}"]`);
    if (!btn) return;

    const driverPhotos = this.photos.filter(p => p.driver_name === driver);

    if (isLoading) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span> Uploading...';
    } else if (driverPhotos.length >= 3) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">✓</span> Max Photos';
    } else if (this.isOfficial) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">🔒</span> Read Only';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">📷</span> Add Photo';
    }
  }

  /**
   * Sanitize driver name for use in HTML IDs
   */
  sanitizeDriverName(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }

  /**
   * Read file as base64
   */
  readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Confirm no face detected
   */
  confirmNoFaceDetected() {
    return new Promise((resolve) => {
      const confirmed = confirm(
        'No face was detected in this image.\n\n' +
        'Photos without detected faces won\'t be used for face recognition, ' +
        'but can still be stored as reference images.\n\n' +
        'Do you want to upload anyway?'
      );
      resolve(confirmed);
    });
  }

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    if (typeof showNotification === 'function') {
      showNotification(message, type);
    } else if (typeof showToast === 'function') {
      showToast(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
      if (type === 'error') {
        alert(message);
      }
    }
  }
}

// Create global instance
const presetFaceManagerV2 = new PresetFaceManagerV2();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PresetFaceManagerV2, presetFaceManagerV2 };
}
