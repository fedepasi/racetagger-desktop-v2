/**
 * Preset Face Manager
 *
 * Handles face photo management for participant presets:
 * - Upload face photos with face detection
 * - Display photo grid with actions
 * - Set primary photo
 * - Delete photos
 *
 * Integrates with:
 * - face-detector.js for face detection
 * - Main process IPC handlers for storage and database
 */

class PresetFaceManager {
  constructor() {
    this.currentParticipantId = null;
    this.currentDriverId = null; // NEW: Support for driver-specific photos
    this.currentPresetId = null;
    this.currentUserId = null;
    this.photos = [];
    this.isUploading = false;
    this.isOfficial = false; // Official presets are read-only

    // Face detection instance (from face-detector.js)
    this.faceDetector = null;

    // DOM element references
    this.gridElement = null;
    this.countLabel = null;
    this.addButton = null;
    this.fileInput = null;
    this.section = null;
  }

  /**
   * Initialize the manager with DOM elements
   */
  initialize() {
    this.gridElement = document.getElementById('face-photos-grid');
    this.countLabel = document.getElementById('face-photo-count');
    this.addButton = document.getElementById('add-face-photo-btn');
    this.fileInput = document.getElementById('face-photo-input');
    this.section = document.getElementById('face-photos-section');

    // Initialize face detector if available (use getFaceDetector function)
    if (window.getFaceDetector) {
      this.faceDetector = window.getFaceDetector();
      console.log('[PresetFaceManager] Face detector obtained via getFaceDetector()');
    } else if (window.faceDetector) {
      this.faceDetector = window.faceDetector;
    }

    console.log('[PresetFaceManager] Initialized, faceDetector:', this.faceDetector ? 'available' : 'not available');
  }

  /**
   * Load face photos for a participant or driver
   * @param {string|null} participantId - Participant ID (for backward compatibility)
   * @param {string} presetId - Preset ID
   * @param {string} userId - User ID
   * @param {boolean} isOfficial - Whether preset is official (read-only)
   * @param {string|null} driverId - Driver ID (for per-driver photos)
   */
  async loadPhotos(participantId, presetId, userId, isOfficial = false, driverId = null) {
    console.log('[PresetFaceManager] loadPhotos called:', {
      participantId,
      driverId,
      presetId
    });

    this.currentParticipantId = participantId;
    this.currentDriverId = driverId;
    this.currentPresetId = presetId;
    this.currentUserId = userId;
    this.isOfficial = isOfficial;
    this.photos = [];

    // For new participants/drivers (no ID yet), show section with message
    if (!participantId && !driverId) {
      console.log('[PresetFaceManager] No ID yet, showing empty state');
      this.render(); // Show empty state with add button
      this.showSection();
      return;
    }

    try {
      const params = {};
      if (driverId) {
        params.driverId = driverId;
      } else if (participantId) {
        params.participantId = participantId;
      }

      console.log('[PresetFaceManager] Fetching photos with params:', params);
      const result = await window.api.invoke('preset-face-get-photos', params);

      if (result.success) {
        this.photos = result.photos || [];
        console.log(`[PresetFaceManager] Loaded ${this.photos.length} photos for driver ${driverId || 'N/A'}`);
      } else {
        console.error('[PresetFaceManager] Failed to load photos:', result.error);
        this.photos = [];
      }

      this.render();
      this.showSection();

    } catch (error) {
      console.error('[PresetFaceManager] Error loading photos:', error);
      this.photos = [];
      this.render();
    }
  }

  /**
   * Check if we're in a driver-specific context (per-driver face recognition)
   * @returns {boolean} True if this manager instance is used for per-driver photos
   */
  isDriverContext() {
    // If driverFaceManagerMulti exists and has drivers, we're in driver context
    // In this mode, EVERY face manager instance should have a driver ID
    return window.driverFaceManagerMulti?.drivers?.length > 0;
  }

  /**
   * Reset state (called when closing modal or switching participants)
   */
  reset() {
    this.currentParticipantId = null;
    this.currentDriverId = null;
    this.currentPresetId = null;
    this.photos = [];
    this.isUploading = false;
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
   * Trigger file input for photo upload
   */
  triggerUpload() {
    if (this.isOfficial) {
      this.showNotification('Official presets cannot be modified', 'warning');
      return;
    }

    if (this.photos.length >= 5) {
      this.showNotification('Maximum 5 photos allowed', 'warning');
      return;
    }

    if (this.isUploading) {
      this.showNotification('Upload in progress...', 'info');
      return;
    }

    if (this.fileInput) {
      this.fileInput.click();
    }
  }

  /**
   * Handle file selection for upload
   */
  async handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input for re-selection of same file
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

    await this.uploadPhoto(file);
  }

  /**
   * Upload a photo with face detection
   */
  async uploadPhoto(file) {
    console.log('[PresetFaceManager] Upload started:', {
      participantId: this.currentParticipantId,
      driverId: this.currentDriverId,
      presetId: this.currentPresetId,
      userId: this.currentUserId
    });

    // Auto-save if we don't have the required IDs yet
    // Note: participantId is ALWAYS required (even for drivers)
    // CRITICAL FIX: For per-driver photos, driverId MUST exist before upload
    // Otherwise photos get associated with null driver ID and become orphaned
    // when syncDrivers() creates new drivers with different IDs
    const needsAutoSave = !this.currentParticipantId || !this.currentPresetId ||
                           (this.currentDriverId === null && this.isDriverContext());

    if (needsAutoSave) {
      console.log('[PresetFaceManager] Missing required IDs, triggering auto-save...', {
        hasParticipantId: !!this.currentParticipantId,
        hasPresetId: !!this.currentPresetId,
        hasDriverId: !!this.currentDriverId,
        isDriverContext: this.isDriverContext()
      });
      this.showNotification('Saving participant...', 'info');

      try {
        // Call the global saveParticipantAndStay function which saves to database and updates IDs
        if (typeof window.saveParticipantAndStay === 'function') {
          await window.saveParticipantAndStay();

          // Wait a bit for the IDs to be updated
          await new Promise(resolve => setTimeout(resolve, 500));

          console.log('[PresetFaceManager] After auto-save:', {
            participantId: this.currentParticipantId,
            driverId: this.currentDriverId,
            presetId: this.currentPresetId,
            isDriverContext: this.isDriverContext()
          });

          // Check if we now have the required IDs
          // For driver context, we MUST have a driver ID at this point
          const stillMissingIds = !this.currentParticipantId || !this.currentPresetId ||
                                   (this.isDriverContext() && !this.currentDriverId);

          if (stillMissingIds) {
            console.error('[PresetFaceManager] Still missing IDs after save:', {
              hasParticipantId: !!this.currentParticipantId,
              hasPresetId: !!this.currentPresetId,
              hasDriverId: !!this.currentDriverId,
              needsDriverId: this.isDriverContext()
            });
            this.showNotification('Could not save participant/driver. Please try again.', 'error');
            return;
          }
        } else {
          this.showNotification('Please save the preset first, then try adding photos.', 'warning');
          return;
        }
      } catch (saveError) {
        console.error('[PresetFaceManager] Auto-save failed:', saveError);
        this.showNotification('Failed to save participant: ' + saveError.message, 'error');
        return;
      }
    }

    // Try to get userId if not set
    if (!this.currentUserId) {
      try {
        const sessionResult = await window.api.invoke('auth-get-session');
        if (sessionResult.success && sessionResult.session?.user) {
          this.currentUserId = sessionResult.session.user.id;
          console.log('[PresetFaceManager] Retrieved userId from session:', this.currentUserId);
        }
      } catch (e) {
        console.warn('[PresetFaceManager] Could not get session:', e);
      }
    }

    if (!this.currentUserId) {
      this.showNotification('User session not found. Please log in again.', 'warning');
      return;
    }

    this.isUploading = true;
    this.updateUploadButton(true);

    try {
      // Read file as base64
      const base64Data = await this.readFileAsBase64(file);

      // Detect face using face-detector.js
      let faceDescriptor = null;
      let detectionConfidence = null;

      if (this.faceDetector) {
        try {
          // Ensure face detector is initialized (models loaded)
          if (!this.faceDetector.isInitialized) {
            console.log('[PresetFaceManager] Initializing face detector...');
            const initResult = await this.faceDetector.initialize();
            if (!initResult.success) {
              console.warn('[PresetFaceManager] Face detector initialization failed:', initResult.error);
            }
          }

          if (this.faceDetector.isInitialized) {
            // Pass base64 data URL directly - _loadImage handles data URLs
            const detectionStart = performance.now();
            const result = await this.faceDetector.detectSingleFace(base64Data);
            const detectionTime = (performance.now() - detectionStart).toFixed(0);

            if (result.success && result.face) {
              faceDescriptor = Array.from(result.face.descriptor);
              detectionConfidence = result.face.confidence;
              console.log(`[PresetFaceManager] Face detected in ${detectionTime}ms - confidence: ${(detectionConfidence * 100).toFixed(1)}%`);
            } else if (result.success && !result.face) {
              // No face detected - ask user if they want to continue
              console.log(`[PresetFaceManager] No face detected in ${detectionTime}ms`);
              const confirmed = await this.confirmNoFaceDetected();
              if (!confirmed) {
                this.isUploading = false;
                this.updateUploadButton(false);
                return;
              }
            } else {
              console.warn('[PresetFaceManager] Face detection error:', result.error);
            }
          }
        } catch (detectionError) {
          console.warn('[PresetFaceManager] Face detection failed, continuing without descriptor:', detectionError);
        }
      } else {
        console.log('[PresetFaceManager] Face detector not available, uploading without descriptor');
      }

      // Upload to backend
      const uploadParams = {
        presetId: this.currentPresetId,
        userId: this.currentUserId,
        photoData: base64Data,
        fileName: file.name,
        faceDescriptor: faceDescriptor,
        detectionConfidence: detectionConfidence,
        photoType: 'reference',
        isPrimary: this.photos.length === 0 // First photo is primary
      };

      // Set either participantId or driverId
      if (this.currentDriverId) {
        uploadParams.driverId = this.currentDriverId;
        console.log('[PresetFaceManager] Uploading for driver:', this.currentDriverId);
      } else {
        uploadParams.participantId = this.currentParticipantId;
        console.log('[PresetFaceManager] Uploading for participant:', this.currentParticipantId);
      }

      const result = await window.api.invoke('preset-face-upload-photo', uploadParams);
      console.log('[PresetFaceManager] Upload result:', result);
      console.log('[PresetFaceManager] Upload success:', result.success);
      console.log('[PresetFaceManager] Upload photo data:', result.photo);

      if (result.success) {
        console.log('[PresetFaceManager] Adding photo to array. Current count:', this.photos.length);
        this.photos.push(result.photo);
        console.log('[PresetFaceManager] New photo count:', this.photos.length);
        console.log('[PresetFaceManager] Rendering grid with photos:', this.photos);
        console.log('[PresetFaceManager] Grid element:', this.gridElement);
        this.render();
        this.showNotification('Photo uploaded successfully', 'success');
      } else {
        console.error('[PresetFaceManager] Upload failed:', result.error);
        this.showNotification(`Upload failed: ${result.error}`, 'error');
      }

    } catch (error) {
      console.error('[PresetFaceManager] Upload error:', error);
      this.showNotification(`Upload failed: ${error.message}`, 'error');
    } finally {
      this.isUploading = false;
      this.updateUploadButton(false);
    }
  }

  /**
   * Delete a photo
   */
  async deletePhoto(photoId) {
    if (this.isOfficial) {
      this.showNotification('Official presets cannot be modified', 'warning');
      return;
    }

    const photo = this.photos.find(p => p.id === photoId);
    if (!photo) return;

    // Confirm deletion
    if (!confirm('Delete this face photo?')) {
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
      console.error('[PresetFaceManager] Delete error:', error);
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
        this.photos.forEach(p => {
          p.is_primary = (p.id === photoId);
        });
        this.render();
        this.showNotification('Primary photo updated', 'success');
      } else {
        this.showNotification(`Update failed: ${result.error}`, 'error');
      }

    } catch (error) {
      console.error('[PresetFaceManager] Set primary error:', error);
      this.showNotification(`Update failed: ${error.message}`, 'error');
    }
  }

  /**
   * Render the photo grid
   */
  render() {
    if (!this.gridElement) {
      console.warn('[PresetFaceManager] Cannot render - no grid element');
      return;
    }

    console.log(`[PresetFaceManager] Rendering grid with ${this.photos.length} photos for driver ${this.currentDriverId || 'N/A'}`);

    // Clear grid
    this.gridElement.innerHTML = '';

    // Render existing photos
    this.photos.forEach((photo, index) => {
      const card = this.createPhotoCard(photo, index);
      this.gridElement.appendChild(card);
    });

    // Render empty placeholders
    const remainingSlots = 5 - this.photos.length;
    for (let i = 0; i < remainingSlots; i++) {
      const placeholder = this.createPlaceholder(i === 0 && this.photos.length === 0);
      this.gridElement.appendChild(placeholder);
    }

    // Update count label
    this.updateCountLabel();

    // Update add button state
    this.updateUploadButton(this.isUploading);

    console.log(`[PresetFaceManager] Render complete. Grid element:`, this.gridElement);
  }

  /**
   * Create a photo card element
   */
  createPhotoCard(photo, index) {
    const card = document.createElement('div');
    card.className = 'face-photo-card';
    card.dataset.photoId = photo.id;

    // Image
    const img = document.createElement('img');
    img.src = photo.photo_url;
    img.alt = `Face photo ${index + 1}`;
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
        this.deletePhoto(photo.id);
      };
      actions.appendChild(deleteBtn);

      card.appendChild(actions);
    }

    return card;
  }

  /**
   * Create a placeholder element
   */
  createPlaceholder(isFirst) {
    const placeholder = document.createElement('div');
    placeholder.className = 'face-photo-placeholder';

    if (!this.isOfficial) {
      placeholder.onclick = () => this.triggerUpload();
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
   * Update the photo count label
   */
  updateCountLabel() {
    if (this.countLabel) {
      this.countLabel.textContent = `${this.photos.length}/5 photos`;
    }
  }

  /**
   * Update the upload button state
   */
  updateUploadButton(isLoading) {
    if (!this.addButton) return;

    if (isLoading) {
      this.addButton.disabled = true;
      this.addButton.innerHTML = '<span class="btn-icon">⏳</span> Uploading...';
    } else if (this.photos.length >= 5) {
      this.addButton.disabled = true;
      this.addButton.innerHTML = '<span class="btn-icon">✓</span> Max Photos';
    } else if (this.isOfficial) {
      this.addButton.disabled = true;
      this.addButton.innerHTML = '<span class="btn-icon">🔒</span> Read Only';
    } else {
      this.addButton.disabled = false;
      this.addButton.innerHTML = '<span class="btn-icon">📷</span> Add Photo';
    }
  }

  /**
   * Read a file as base64 data URL
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
   * Load an image element from base64
   */
  loadImage(base64Data) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = base64Data;
    });
  }

  /**
   * Show confirmation dialog when no face is detected
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
   * Show a notification message
   */
  showNotification(message, type = 'info') {
    // Use global notification system if available
    if (typeof showNotification === 'function') {
      showNotification(message, type);
    } else if (typeof showToast === 'function') {
      showToast(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
      // Fallback to alert for important messages
      if (type === 'error') {
        alert(message);
      }
    }
  }
}

// Create global instance
const presetFaceManager = new PresetFaceManager();

// Global functions for HTML onclick handlers
function triggerFacePhotoUpload() {
  presetFaceManager.triggerUpload();
}

function handleFacePhotoSelect(event) {
  presetFaceManager.handleFileSelect(event);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PresetFaceManager, presetFaceManager };
}
