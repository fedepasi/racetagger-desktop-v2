/**
 * Export Destinations Manager
 *
 * Handles the Export Destinations UI:
 * - CRUD operations for destinations
 * - Tab navigation in editor page
 * - Filename pattern preview
 * - Auto-apply condition toggle
 * - Unsaved changes protection
 */

const ExportDestinationsManager = {
  destinations: [],
  editingDestinationId: null,
  isInitialized: false,
  isDirty: false,
  currentView: 'list', // 'list' | 'editor'

  /**
   * Initialize the Export Destinations manager
   */
  async initialize() {
    if (this.isInitialized) {
      await this.loadDestinations();
      return;
    }

    console.log('[ExportDestinations] Initializing...');

    try {
      this.setupEventListeners();
      await this.loadDestinations();
      this.isInitialized = true;
      console.log('[ExportDestinations] Initialized successfully');
    } catch (error) {
      console.error('[ExportDestinations] Error initializing:', error);
    }
  },

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Add destination buttons (from Destinations page)
    const addBtn = document.getElementById('add-destination-btn');
    const createFirstBtn = document.getElementById('create-first-dest-btn');

    if (addBtn) {
      addBtn.addEventListener('click', () => this.showEditor());
    }

    if (createFirstBtn) {
      createFirstBtn.addEventListener('click', () => this.showEditor());
    }

    // Back and Cancel buttons
    const backBtn = document.getElementById('dest-back-btn');
    const cancelBtn = document.getElementById('dest-cancel-btn');
    const saveBtn = document.getElementById('dest-save-btn');
    const browseFolderBtn = document.getElementById('dest-browse-folder-btn');
    const testFtpBtn = document.getElementById('dest-test-ftp-btn');

    if (backBtn) {
      backBtn.addEventListener('click', () => this.showList());
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.showList());
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveDestination());
    }

    if (browseFolderBtn) {
      browseFolderBtn.addEventListener('click', () => this.selectBaseFolder());
    }

    if (testFtpBtn) {
      testFtpBtn.addEventListener('click', () => this.testFtpConnection());
    }

    // Tab navigation
    document.querySelectorAll('#destinations-editor-view .destination-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    // Auto-apply checkbox toggle
    const autoApplyCheckbox = document.getElementById('dest-auto-apply');
    if (autoApplyCheckbox) {
      autoApplyCheckbox.addEventListener('change', (e) => {
        const conditionGroup = document.getElementById('dest-condition-group');
        if (conditionGroup) {
          conditionGroup.style.display = e.target.checked ? 'block' : 'none';
        }
      });
    }

    // Upload method change
    const uploadMethodSelect = document.getElementById('dest-upload-method');
    if (uploadMethodSelect) {
      uploadMethodSelect.addEventListener('change', (e) => {
        const ftpSettings = document.getElementById('ftp-settings');
        if (ftpSettings) {
          ftpSettings.style.display = e.target.value !== 'local' ? 'block' : 'none';
        }
      });
    }

    // Filename pattern preview
    const filenamePatternInput = document.getElementById('dest-filename-pattern');
    if (filenamePatternInput) {
      filenamePatternInput.addEventListener('input', () => this.updateFilenamePreview());
    }

    // Setup dirty state tracking on all form inputs
    this.setupDirtyTracking();
  },

  /**
   * Setup dirty state tracking for form inputs
   */
  setupDirtyTracking() {
    const editorView = document.getElementById('destinations-editor-view');
    if (!editorView) return;

    editorView.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', () => this.markDirty());
      el.addEventListener('change', () => this.markDirty());
    });
  },

  /**
   * Mark form as having unsaved changes
   */
  markDirty() {
    if (!this.isDirty) {
      this.isDirty = true;
      const indicator = document.getElementById('dest-unsaved-indicator');
      if (indicator) {
        indicator.style.display = 'inline-flex';
      }
    }
  },

  /**
   * Clear dirty state
   */
  clearDirty() {
    this.isDirty = false;
    const indicator = document.getElementById('dest-unsaved-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  },

  /**
   * Show editor view (replaces openModal)
   */
  showEditor(destinationId = null) {
    console.log('[ExportDestinations] showEditor called, destinationId:', destinationId);
    this.editingDestinationId = destinationId;
    this.currentView = 'editor';

    const listView = document.getElementById('destinations-list-view');
    const editorView = document.getElementById('destinations-editor-view');
    const title = document.getElementById('dest-editor-title');

    if (!listView || !editorView) {
      console.error('[ExportDestinations] View elements not found!');
      return;
    }

    // Reset form
    this.resetForm();

    // Set title
    if (title) {
      title.textContent = destinationId ? 'Edit Export Destination' : 'New Export Destination';
    }

    // If editing, populate form
    if (destinationId) {
      const dest = this.destinations.find(d => d.id === destinationId);
      if (dest) {
        this.populateForm(dest);
        if (title) {
          title.textContent = `Edit: ${dest.name}`;
        }
      }
    }

    // Show first tab
    this.switchTab('general');

    // Switch views
    listView.classList.remove('active');
    editorView.classList.add('active');

    // Clear dirty state (form just loaded)
    this.clearDirty();

    // Focus name input
    setTimeout(() => {
      const nameInput = document.getElementById('dest-name');
      if (nameInput) nameInput.focus();
    }, 100);
  },

  /**
   * Show list view (replaces closeModal)
   */
  showList(skipConfirm = false) {
    // Check for unsaved changes
    if (!skipConfirm && this.isDirty) {
      if (!confirm('You have unsaved changes. Are you sure you want to leave?')) {
        return;
      }
    }

    this.currentView = 'list';
    const listView = document.getElementById('destinations-list-view');
    const editorView = document.getElementById('destinations-editor-view');

    if (listView && editorView) {
      editorView.classList.remove('active');
      listView.classList.add('active');
    }

    this.editingDestinationId = null;
    this.clearDirty();
  },

  /**
   * Check if editor is open
   */
  isEditorOpen() {
    return this.currentView === 'editor';
  },

  /**
   * Load destinations from backend
   */
  async loadDestinations() {
    try {
      const result = await window.api.invoke('export-destinations-get-all');
      if (result.success) {
        this.destinations = result.data || [];
        this.renderDestinations();
      } else {
        console.error('[ExportDestinations] Error loading:', result.error);
        this.renderError();
      }
    } catch (error) {
      console.error('[ExportDestinations] Error loading destinations:', error);
      this.renderError();
    }
  },

  /**
   * Render destinations list
   */
  renderDestinations() {
    // Render in Destinations page
    this.renderDestinationsToContainer('destinations-list', 'destinations-empty');
  },

  /**
   * Render destinations to a specific container
   */
  renderDestinationsToContainer(listId, emptyId) {
    const listEl = document.getElementById(listId);
    const emptyEl = document.getElementById(emptyId);

    if (!listEl) return;

    if (this.destinations.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Generate unique IDs for this container to avoid conflicts
    const html = this.destinations.map(dest => this.renderDestinationCard(dest, listId)).join('');
    listEl.innerHTML = html;

    // Add event listeners for action buttons
    this.destinations.forEach(dest => {
      const cardId = `dest-card-${listId}-${dest.id}`;
      const card = document.getElementById(cardId);
      if (card) {
        card.querySelector('.edit-btn')?.addEventListener('click', () => this.editDestination(dest.id));
        card.querySelector('.duplicate-btn')?.addEventListener('click', () => this.duplicateDestination(dest.id));
        card.querySelector('.delete-btn')?.addEventListener('click', () => this.deleteDestination(dest.id));
        card.querySelector('.toggle-active-btn')?.addEventListener('click', () => this.toggleActive(dest.id));
        card.querySelector('.set-default-btn')?.addEventListener('click', () => this.setAsDefault(dest.id));
      }
    });
  },

  /**
   * Render a single destination card
   */
  renderDestinationCard(dest, listId = 'destinations-list') {
    const badges = [];
    if (dest.is_default) badges.push('<span class="badge badge-primary">Default</span>');
    if (!dest.is_active) badges.push('<span class="badge badge-muted">Inactive</span>');
    if (dest.upload_method === 'ftp') badges.push('<span class="badge badge-info">FTP</span>');
    if (dest.upload_method === 'sftp') badges.push('<span class="badge badge-info">SFTP</span>');
    if (dest.auto_apply) badges.push('<span class="badge badge-warning">Auto</span>');

    const hasMetadata = dest.credit || dest.source || dest.copyright;
    const hasPersonShown = dest.person_shown_template;
    const cardId = `dest-card-${listId}-${dest.id}`;

    return `
      <div class="destination-card ${dest.is_active ? '' : 'inactive'}" id="${cardId}">
        <div class="destination-header">
          <div class="destination-name">
            <span class="dest-icon">${dest.upload_method !== 'local' ? '☁️' : '📁'}</span>
            ${dest.name}
          </div>
          <div class="destination-badges">${badges.join(' ')}</div>
        </div>
        <div class="destination-details">
          ${dest.base_folder ? `<div class="detail-row"><span class="detail-label">Folder:</span> ${this.truncatePath(dest.base_folder)}</div>` : ''}
          ${dest.filename_pattern ? `<div class="detail-row"><span class="detail-label">Pattern:</span> <code>${dest.filename_pattern}</code></div>` : ''}
          ${hasMetadata ? `<div class="detail-row"><span class="detail-label">Credits:</span> ${dest.credit || dest.source || '-'}</div>` : ''}
          ${hasPersonShown ? `<div class="detail-row"><span class="detail-label">Person:</span> <code>${dest.person_shown_template}</code></div>` : ''}
        </div>
        <div class="destination-actions">
          <button class="btn btn-icon-sm edit-btn" title="Edit">✏️</button>
          <button class="btn btn-icon-sm duplicate-btn" title="Duplicate">📋</button>
          <button class="btn btn-icon-sm toggle-active-btn" title="${dest.is_active ? 'Deactivate' : 'Activate'}">${dest.is_active ? '👁️' : '👁️‍🗨️'}</button>
          ${!dest.is_default ? '<button class="btn btn-icon-sm set-default-btn" title="Set as Default">⭐</button>' : ''}
          <button class="btn btn-icon-sm delete-btn" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  },

  /**
   * Truncate path for display
   */
  truncatePath(path, maxLength = 40) {
    if (!path || path.length <= maxLength) return path;
    return '...' + path.slice(-maxLength);
  },

  /**
   * Render error state
   */
  renderError() {
    const listEl = document.getElementById('destinations-list');
    if (listEl) {
      listEl.innerHTML = `
        <div class="destinations-error">
          <span class="error-icon">⚠️</span>
          <span>Error loading destinations. Please try again.</span>
          <button class="btn btn-sm btn-secondary" onclick="ExportDestinationsManager.loadDestinations()">Retry</button>
        </div>
      `;
    }
  },

  /**
   * Switch tab
   */
  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('#destinations-editor-view .destination-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('#destinations-editor-view .tab-content').forEach(content => {
      content.classList.toggle('active', content.dataset.tab === tabName);
    });
  },

  /**
   * Reset form to defaults
   */
  resetForm() {
    // General
    this.setInputValue('dest-name', '');
    this.setInputValue('dest-is-default', false);
    this.setInputValue('dest-base-folder', '');
    this.setInputValue('dest-subfolder-pattern', '{team}/{number}');
    this.setInputValue('dest-filename-pattern', '');
    this.setInputValue('dest-seq-mode', 'per_subject');
    this.setInputValue('dest-auto-apply', false);
    this.setInputValue('dest-apply-condition', '');

    // Metadata
    this.setInputValue('dest-credit', '');
    this.setInputValue('dest-source', '');
    this.setInputValue('dest-copyright', '');
    this.setInputValue('dest-copyright-owner', '');
    this.setInputValue('dest-creator', '');
    this.setInputValue('dest-authors-position', '');
    this.setInputValue('dest-contact-email', '');
    this.setInputValue('dest-contact-website', '');
    this.setInputValue('dest-contact-phone', '');
    this.setInputValue('dest-contact-address', '');
    this.setInputValue('dest-contact-city', '');
    this.setInputValue('dest-contact-country', '');

    // Templates
    this.setInputValue('dest-headline-template', '');
    this.setInputValue('dest-event-template', '');
    this.setInputValue('dest-description-template', '');
    this.setInputValue('dest-person-shown-template', '');
    this.setInputValue('dest-city', '');
    this.setInputValue('dest-country', '');
    this.setInputValue('dest-location', '');

    // Keywords
    this.setInputValue('dest-base-keywords', '');
    this.setInputValue('dest-append-keywords', true);

    // FTP
    this.setInputValue('dest-upload-method', 'local');
    this.setInputValue('dest-ftp-host', '');
    this.setInputValue('dest-ftp-port', '21');
    this.setInputValue('dest-ftp-username', '');
    this.setInputValue('dest-ftp-password', '');
    this.setInputValue('dest-ftp-remote-path', '');
    this.setInputValue('dest-ftp-passive', true);
    this.setInputValue('dest-keep-local', true);

    // Hide conditional sections
    const conditionGroup = document.getElementById('dest-condition-group');
    if (conditionGroup) conditionGroup.style.display = 'none';

    const ftpSettings = document.getElementById('ftp-settings');
    if (ftpSettings) ftpSettings.style.display = 'none';

    this.updateFilenamePreview();
  },

  /**
   * Populate form with destination data
   */
  populateForm(dest) {
    // General
    this.setInputValue('dest-name', dest.name);
    this.setInputValue('dest-is-default', dest.is_default);
    this.setInputValue('dest-base-folder', dest.base_folder || '');
    this.setInputValue('dest-subfolder-pattern', dest.subfolder_pattern || '{team}/{number}');
    this.setInputValue('dest-filename-pattern', dest.filename_pattern || '');
    this.setInputValue('dest-seq-mode', dest.filename_sequence_mode || 'per_subject');
    this.setInputValue('dest-auto-apply', dest.auto_apply);
    this.setInputValue('dest-apply-condition', dest.apply_condition || '');

    // Metadata
    this.setInputValue('dest-credit', dest.credit || '');
    this.setInputValue('dest-source', dest.source || '');
    this.setInputValue('dest-copyright', dest.copyright || '');
    this.setInputValue('dest-copyright-owner', dest.copyright_owner || '');
    this.setInputValue('dest-creator', dest.creator || '');
    this.setInputValue('dest-authors-position', dest.authors_position || '');
    this.setInputValue('dest-contact-email', dest.contact_email || '');
    this.setInputValue('dest-contact-website', dest.contact_website || '');
    this.setInputValue('dest-contact-phone', dest.contact_phone || '');
    this.setInputValue('dest-contact-address', dest.contact_address || '');
    this.setInputValue('dest-contact-city', dest.contact_city || '');
    this.setInputValue('dest-contact-country', dest.contact_country || '');

    // Templates
    this.setInputValue('dest-headline-template', dest.headline_template || '');
    this.setInputValue('dest-event-template', dest.event_template || '');
    this.setInputValue('dest-description-template', dest.description_template || '');
    this.setInputValue('dest-person-shown-template', dest.person_shown_template || '');
    this.setInputValue('dest-city', dest.city || '');
    this.setInputValue('dest-country', dest.country || '');
    this.setInputValue('dest-location', dest.location || '');

    // Keywords
    const keywords = Array.isArray(dest.base_keywords) ? dest.base_keywords.join('\n') : '';
    this.setInputValue('dest-base-keywords', keywords);
    this.setInputValue('dest-append-keywords', dest.append_keywords !== false);

    // FTP
    this.setInputValue('dest-upload-method', dest.upload_method || 'local');
    this.setInputValue('dest-ftp-host', dest.ftp_host || '');
    this.setInputValue('dest-ftp-port', dest.ftp_port || '21');
    this.setInputValue('dest-ftp-username', dest.ftp_username || '');
    this.setInputValue('dest-ftp-password', ''); // Never populate password
    this.setInputValue('dest-ftp-remote-path', dest.ftp_remote_path || '');
    this.setInputValue('dest-ftp-passive', dest.ftp_passive_mode !== false);
    this.setInputValue('dest-keep-local', dest.keep_local_copy !== false);

    // Show/hide conditional sections
    const conditionGroup = document.getElementById('dest-condition-group');
    if (conditionGroup) conditionGroup.style.display = dest.auto_apply ? 'block' : 'none';

    const ftpSettings = document.getElementById('ftp-settings');
    if (ftpSettings) ftpSettings.style.display = dest.upload_method !== 'local' ? 'block' : 'none';

    this.updateFilenamePreview();
  },

  /**
   * Helper to set input value
   */
  setInputValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else {
      el.value = value ?? '';
    }
  },

  /**
   * Helper to get input value
   */
  getInputValue(id) {
    const el = document.getElementById(id);
    if (!el) return null;

    if (el.type === 'checkbox') {
      return el.checked;
    }
    return el.value;
  },

  /**
   * Update filename preview
   */
  updateFilenamePreview() {
    const pattern = this.getInputValue('dest-filename-pattern') || '{original}';
    const previewEl = document.getElementById('dest-filename-preview');

    if (!previewEl) return;

    // Simple preview with sample data
    let preview = pattern
      .replace('{original}', 'IMG_1234')
      .replace('{surname}', 'Verstappen')
      .replace('{name}', 'Max_Verstappen')
      .replace('{number}', '1')
      .replace('{team}', 'Red_Bull')
      .replace('{event}', 'Monaco_GP')
      .replace('{date}', '2025-05-25')
      .replace(/{seq:(\d+)}/g, (_, digits) => '1'.padStart(parseInt(digits), '0'))
      .replace('{seq}', '001');

    previewEl.textContent = preview + '.jpg';
  },

  /**
   * Select base folder
   */
  async selectBaseFolder() {
    try {
      const result = await window.api.invoke('dialog-show-open', {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Export Destination Folder'
      });

      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        this.setInputValue('dest-base-folder', result.filePaths[0]);
      }
    } catch (error) {
      console.error('[ExportDestinations] Error selecting folder:', error);
      this.showToast('Error selecting folder', 'error');
    }
  },

  /**
   * Collect form data
   */
  collectFormData() {
    // Parse keywords
    const keywordsText = this.getInputValue('dest-base-keywords') || '';
    const keywords = keywordsText
      .split(/[,\n]/)
      .map(k => k.trim())
      .filter(k => k.length > 0);

    return {
      name: this.getInputValue('dest-name'),
      is_default: this.getInputValue('dest-is-default'),
      base_folder: this.getInputValue('dest-base-folder') || null,
      subfolder_pattern: this.getInputValue('dest-subfolder-pattern') || null,
      filename_pattern: this.getInputValue('dest-filename-pattern') || null,
      filename_sequence_mode: this.getInputValue('dest-seq-mode'),
      auto_apply: this.getInputValue('dest-auto-apply'),
      apply_condition: this.getInputValue('dest-apply-condition') || null,

      // Metadata
      credit: this.getInputValue('dest-credit') || null,
      source: this.getInputValue('dest-source') || null,
      copyright: this.getInputValue('dest-copyright') || null,
      copyright_owner: this.getInputValue('dest-copyright-owner') || null,
      creator: this.getInputValue('dest-creator') || null,
      authors_position: this.getInputValue('dest-authors-position') || null,
      contact_email: this.getInputValue('dest-contact-email') || null,
      contact_website: this.getInputValue('dest-contact-website') || null,
      contact_phone: this.getInputValue('dest-contact-phone') || null,
      contact_address: this.getInputValue('dest-contact-address') || null,
      contact_city: this.getInputValue('dest-contact-city') || null,
      contact_country: this.getInputValue('dest-contact-country') || null,

      // Templates
      headline_template: this.getInputValue('dest-headline-template') || null,
      event_template: this.getInputValue('dest-event-template') || null,
      description_template: this.getInputValue('dest-description-template') || null,
      person_shown_template: this.getInputValue('dest-person-shown-template') || null,
      city: this.getInputValue('dest-city') || null,
      country: this.getInputValue('dest-country') || null,
      location: this.getInputValue('dest-location') || null,

      // Keywords
      base_keywords: keywords.length > 0 ? keywords : null,
      append_keywords: this.getInputValue('dest-append-keywords'),

      // FTP
      upload_method: this.getInputValue('dest-upload-method'),
      ftp_host: this.getInputValue('dest-ftp-host') || null,
      ftp_port: parseInt(this.getInputValue('dest-ftp-port')) || 21,
      ftp_username: this.getInputValue('dest-ftp-username') || null,
      ftp_remote_path: this.getInputValue('dest-ftp-remote-path') || null,
      ftp_passive_mode: this.getInputValue('dest-ftp-passive'),
      keep_local_copy: this.getInputValue('dest-keep-local'),

      is_active: true
    };
  },

  /**
   * Save destination
   */
  async saveDestination() {
    const data = this.collectFormData();

    // Validate
    if (!data.name || !data.name.trim()) {
      this.showToast('Please enter a destination name', 'error');
      return;
    }

    const saveBtn = document.getElementById('dest-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    }

    try {
      let result;

      if (this.editingDestinationId) {
        // Update existing
        result = await window.api.invoke('export-destinations-update', {
          destinationId: this.editingDestinationId,
          updateData: data
        });
      } else {
        // Create new
        result = await window.api.invoke('export-destinations-create', data);
      }

      if (result.success) {
        this.showToast(
          this.editingDestinationId ? 'Destination updated successfully' : 'Destination created successfully',
          'success'
        );
        this.clearDirty();
        await this.loadDestinations();
        this.showList(true); // Skip confirmation since we just saved
      } else {
        throw new Error(result.error || 'Failed to save destination');
      }
    } catch (error) {
      console.error('[ExportDestinations] Error saving:', error);
      this.showToast(error.message || 'Error saving destination', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="btn-icon">💾</span> Save Destination';
      }
    }
  },

  /**
   * Edit destination
   */
  editDestination(id) {
    this.showEditor(id);
  },

  /**
   * Duplicate destination
   */
  async duplicateDestination(id) {
    try {
      const result = await window.api.invoke('export-destinations-duplicate', { destinationId: id });
      if (result.success) {
        this.showToast('Destination duplicated successfully', 'success');
        await this.loadDestinations();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[ExportDestinations] Error duplicating:', error);
      this.showToast('Error duplicating destination', 'error');
    }
  },

  /**
   * Delete destination
   */
  async deleteDestination(id) {
    const dest = this.destinations.find(d => d.id === id);
    if (!dest) return;

    if (!confirm(`Are you sure you want to delete "${dest.name}"?`)) {
      return;
    }

    try {
      const result = await window.api.invoke('export-destinations-delete', id);
      if (result.success) {
        this.showToast('Destination deleted', 'success');
        await this.loadDestinations();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[ExportDestinations] Error deleting:', error);
      this.showToast('Error deleting destination', 'error');
    }
  },

  /**
   * Toggle active status
   */
  async toggleActive(id) {
    try {
      const result = await window.api.invoke('export-destinations-toggle-active', id);
      if (result.success) {
        this.showToast(result.data ? 'Destination activated' : 'Destination deactivated', 'success');
        await this.loadDestinations();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[ExportDestinations] Error toggling active:', error);
      this.showToast('Error updating destination', 'error');
    }
  },

  /**
   * Set as default
   */
  async setAsDefault(id) {
    try {
      const result = await window.api.invoke('export-destinations-set-default', id);
      if (result.success) {
        this.showToast('Default destination updated', 'success');
        await this.loadDestinations();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[ExportDestinations] Error setting default:', error);
      this.showToast('Error updating default', 'error');
    }
  },

  /**
   * Test FTP connection
   */
  async testFtpConnection() {
    this.showToast('FTP testing not yet implemented', 'info');
    // TODO: Implement FTP connection test
  },

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    // Use existing toast system if available
    if (window.showNotification) {
      window.showNotification(message, type);
    } else if (window.DelightSystem && window.DelightSystem.showNotification) {
      window.DelightSystem.showNotification(message, type);
    } else {
      console.log(`[Toast] ${type}: ${message}`);
      alert(message);
    }
  }
};

// Initialize when destinations section becomes active
document.addEventListener('section-changed', (event) => {
  if (event.detail && event.detail.section === 'destinations') {
    ExportDestinationsManager.initialize();
  }
});

// Also initialize on DOMContentLoaded - bind buttons immediately
document.addEventListener('DOMContentLoaded', () => {
  console.log('[ExportDestinations] DOMContentLoaded - binding buttons');

  // Bind "New Destination" buttons in the destinations page immediately
  const addDestBtn = document.getElementById('add-destination-btn');
  const createFirstBtn = document.getElementById('create-first-dest-btn');

  if (addDestBtn) {
    console.log('[ExportDestinations] Binding add-destination-btn');
    addDestBtn.addEventListener('click', () => {
      console.log('[ExportDestinations] Add button clicked');
      ExportDestinationsManager.showEditor();
    });
  }
  if (createFirstBtn) {
    console.log('[ExportDestinations] Binding create-first-dest-btn');
    createFirstBtn.addEventListener('click', () => {
      console.log('[ExportDestinations] Create first button clicked');
      ExportDestinationsManager.showEditor();
    });
  }

  // Initialize if already on destinations section
  const destinationsSection = document.getElementById('section-destinations');
  if (destinationsSection && destinationsSection.classList.contains('active')) {
    ExportDestinationsManager.initialize();
  }
});

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.ExportDestinationsManager = ExportDestinationsManager;
}
