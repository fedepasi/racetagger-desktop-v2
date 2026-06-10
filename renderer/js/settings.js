/**
 * Settings Page Manager
 *
 * Handles the Settings section UI including:
 * - Account & Profile information display
 * - Privacy & AI consent toggle
 * - App version display
 */

const SettingsManager = {
  settings: null,
  isInitialized: false,

  /**
   * Initialize the Settings page
   * Called when navigating to the settings section
   */
  async initialize() {
    if (this.isInitialized) {
      // Just refresh data if already initialized
      await this.loadSettings();
      return;
    }

    // Set the flag BEFORE the first await to prevent a race condition
    // where two concurrent initialize() calls (e.g. router + section-changed event)
    // both pass the isInitialized check during loadSettings() and end up
    // attaching the change listeners twice — which makes the success modal fire twice.
    this.isInitialized = true;

    try {
      await this.loadSettings();
      this.setupEventListeners();
    } catch (error) {
      // Reset on failure so a retry can succeed
      this.isInitialized = false;
      console.error('[Settings] Error initializing settings:', error);
    }
  },

  /**
   * Load settings data from main process
   */
  async loadSettings() {
    try {
      this.settings = await window.api.invoke('get-full-settings');
      await this.renderSettings();
    } catch (error) {
      console.error('[Settings] Error loading settings:', error);
      this.renderError();
    }
  },

  // ============================================================
  // IPTC Pro Global Defaults (localStorage)
  // ============================================================

  getIptcProDefaults() {
    try {
      const stored = localStorage.getItem('iptc-pro-defaults');
      if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    // Defaults: auto-write OFF (manual), face-only ON
    return { autoWrite: false, faceOnly: true };
  },

  saveIptcProDefaults(defaults) {
    localStorage.setItem('iptc-pro-defaults', JSON.stringify(defaults));
  },

  /**
   * Render settings data to the UI
   */
  async renderSettings() {
    if (!this.settings) {
      this.renderError();
      return;
    }

    const { account, tokens, subscription, privacy } = this.settings;

    // Account info
    this.updateElement('settings-user-email', account.email || 'Not logged in');
    this.updateElement('settings-token-balance', tokens.remaining?.toString() || '0');

    // Subscription status
    const statusEl = document.getElementById('settings-subscription-status');
    if (statusEl) {
      const isActive = subscription.isActive;
      const planName = subscription.plan || 'Active';
      statusEl.innerHTML = `<span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">
        ${isActive ? planName : 'Inactive'}
      </span>`;
    }

    // Privacy - Training consent toggle
    const consentToggle = document.getElementById('settings-training-consent');
    if (consentToggle) {
      consentToggle.checked = privacy.trainingConsent !== false; // Default to true
    }

    // Error telemetry toggle
    const telemetryToggle = document.getElementById('settings-error-telemetry');
    if (telemetryToggle) {
      try {
        const telemetryStatus = await window.api.invoke('get-telemetry-status');
        if (telemetryStatus && telemetryStatus.data) {
          telemetryToggle.checked = telemetryStatus.data.enabled !== false;
        }
      } catch (e) { /* default to checked */ }
    }

    // Consent timestamp
    const timestampEl = document.getElementById('settings-consent-updated');
    if (timestampEl) {
      if (privacy.consentUpdatedAt) {
        const date = new Date(privacy.consentUpdatedAt);
        timestampEl.textContent = `Last updated: ${date.toLocaleDateString()}`;
      } else {
        timestampEl.textContent = '';
      }
    }

    // IPTC Pro defaults
    const iptcDefaults = this.getIptcProDefaults();
    const autoWriteToggle = document.getElementById('settings-iptc-auto-write');
    if (autoWriteToggle) autoWriteToggle.checked = iptcDefaults.autoWrite;
    const faceOnlyToggle = document.getElementById('settings-iptc-face-only');
    if (faceOnlyToggle) faceOnlyToggle.checked = iptcDefaults.faceOnly;

    // Default IPTC template (UX-04) — DB-backed status row.
    await this.refreshIptcTemplateStatus();

    // App version
    this.loadAppVersion();
  },

  // ============================================================
  // Default IPTC template (UX-04) — DB-backed (user_iptc_templates)
  // ============================================================

  /**
   * Summarize a default IPTC template for the status row.
   * @returns {{fields:number, keywords:number}|null} null when effectively empty.
   */
  computeIptcTemplateStatus(template) {
    if (!template || typeof template !== 'object') return null;
    // Behavior flags / per-preset overrides are not content fields.
    const EXCLUDE = new Set(['appendKeywords', 'includeVisualTags', 'writingTiming', 'faceScope']);
    let fields = 0;
    for (const [key, value] of Object.entries(template)) {
      if (EXCLUDE.has(key)) continue;
      if (Array.isArray(value)) { if (value.length > 0) fields++; }
      else if (typeof value === 'boolean') { if (value) fields++; }
      else if (value !== undefined && value !== null && value !== '') fields++;
    }
    if (fields === 0) return null;
    const keywords = Array.isArray(template.baseKeywords) ? template.baseKeywords.length : 0;
    return { fields, keywords };
  },

  /**
   * Fetch the account-level default template and render the status row.
   */
  async refreshIptcTemplateStatus() {
    const statusEl = document.getElementById('settings-iptc-template-status');
    if (!statusEl) return;

    let template = null;
    try {
      const r = await window.api.invoke('iptc-defaults-get');
      if (r && r.success) template = r.data;
    } catch (e) {
      // Offline / IPC failure — show "Not configured" rather than guessing.
    }

    const status = this.computeIptcTemplateStatus(template);
    if (status) {
      statusEl.textContent = `Configured · ${status.fields} fields · ${status.keywords} keywords`;
      statusEl.classList.add('is-configured');
      statusEl.classList.remove('is-empty');
    } else {
      statusEl.textContent = 'Not configured';
      statusEl.classList.remove('is-configured');
      statusEl.classList.add('is-empty');
    }
  },

  /**
   * Import an IPTC profile from an XMP file and save it as the default template.
   * Reuses the main-process PhotoMechanic XMP parser via the IPC channel — does
   * NOT call the renderer importIptcFromXmp() (that one mutates participants-page
   * chrome).
   */
  async handleImportTemplateFromXmp() {
    try {
      const res = await window.api.invoke('preset-iptc-import-xmp');
      if (!res || !res.success) {
        if (res && res.error && !res.error.includes('cancelled')) {
          this.showNotification('Import failed', res.error, 'error');
        }
        return;
      }

      const data = res.data || {};
      // A global template never carries per-preset behavior overrides.
      delete data.writingTiming;
      delete data.faceScope;

      const saveRes = await window.api.invoke('iptc-defaults-save', data);
      if (!saveRes || !saveRes.success) {
        this.showNotification('Error', (saveRes && saveRes.error) || 'Could not save the default template.', 'error');
        return;
      }

      try { localStorage.setItem('iptc-default-template-mirror', JSON.stringify(data)); } catch (e) { /* mirror is best-effort */ }
      await this.refreshIptcTemplateStatus();
      this.showNotification('Default template updated', 'Imported your IPTC profile from the XMP file.', 'success');
    } catch (e) {
      console.error('[Settings] Error importing template from XMP:', e);
      this.showNotification('Error', 'Could not import the XMP file.', 'error');
    }
  },

  /**
   * Clear the account-level default template (with confirmation).
   */
  async handleClearTemplate() {
    const confirmed = confirm('Clear your default IPTC template? New presets will start blank until you set a new default. Existing presets are not affected.');
    if (!confirmed) return;

    try {
      const res = await window.api.invoke('iptc-defaults-save', null);
      if (!res || !res.success) {
        this.showNotification('Error', (res && res.error) || 'Could not clear the default template.', 'error');
        return;
      }
      try { localStorage.removeItem('iptc-default-template-mirror'); } catch (e) { /* best-effort */ }
      await this.refreshIptcTemplateStatus();
      this.showNotification('Default template cleared', 'Your default IPTC template has been removed.', 'success');
    } catch (e) {
      console.error('[Settings] Error clearing default template:', e);
      this.showNotification('Error', 'Could not clear the default template.', 'error');
    }
  },

  /**
   * Open the full IPTC editor modal (Option B). Mounts the shared form markup,
   * then loads the current default into it.
   */
  async openIptcDefaultsModal() {
    const modal = document.getElementById('iptc-defaults-modal');
    const mount = document.getElementById('iptc-defaults-form-mount');
    if (!modal || !mount) return;

    // Mount the shared IPTC form markup BEFORE loading values (ordering is
    // load-bearing — values set on missing elements are silently lost).
    if (typeof ensureIptcFormMarkup === 'function') {
      await ensureIptcFormMarkup(mount);
    }

    let template = null;
    try {
      const r = await window.api.invoke('iptc-defaults-get');
      if (r && r.success) template = r.data;
    } catch (e) {
      // Open with an empty form on failure.
    }

    if (typeof loadIptcDataIntoForm === 'function') {
      loadIptcDataIntoForm(template || null);
    }

    modal.classList.add('show');
  },

  closeIptcDefaultsModal() {
    const modal = document.getElementById('iptc-defaults-modal');
    if (modal) modal.classList.remove('show');
  },

  /**
   * Collect the modal form and save it as the default template.
   * Empty form → "Nothing to save" (never a delete; deletion is only via Clear).
   */
  async saveIptcDefaultsFromModal() {
    if (typeof collectIptcDataFromForm !== 'function') return;

    const data = collectIptcDataFromForm();
    if (data === null) {
      this.showNotification('Nothing to save', 'Fill in at least one IPTC field, or use Clear to remove the default.', 'error');
      return;
    }

    // A global template never carries per-preset behavior overrides.
    delete data.writingTiming;
    delete data.faceScope;

    try {
      const res = await window.api.invoke('iptc-defaults-save', data);
      if (!res || !res.success) {
        this.showNotification('Error', (res && res.error) || 'Could not save the default template.', 'error');
        return;
      }
      try { localStorage.setItem('iptc-default-template-mirror', JSON.stringify(data)); } catch (e) { /* best-effort */ }
      this.closeIptcDefaultsModal();
      await this.refreshIptcTemplateStatus();
      this.showNotification('Default template saved', 'Your default IPTC template has been updated.', 'success');
    } catch (e) {
      console.error('[Settings] Error saving default template:', e);
      this.showNotification('Error', 'Could not save the default template.', 'error');
    }
  },

  /**
   * Load and display app version
   */
  async loadAppVersion() {
    try {
      const version = await window.api.invoke('get-app-version');
      this.updateElement('settings-app-version', `v${version}`);
    } catch (error) {
      this.updateElement('settings-app-version', 'Unknown');
    }
  },

  /**
   * Setup event listeners for settings controls
   */
  setupEventListeners() {
    // Training consent toggle
    const consentToggle = document.getElementById('settings-training-consent');
    if (consentToggle) {
      consentToggle.addEventListener('change', async (e) => {
        await this.handleConsentChange(e.target.checked);
      });
    }

    // Error telemetry toggle
    const telemetryToggle = document.getElementById('settings-error-telemetry');
    if (telemetryToggle) {
      telemetryToggle.addEventListener('change', async (e) => {
        await this.handleTelemetryChange(e.target.checked);
      });
    }

    // Buy tokens button
    const buyTokensBtn = document.getElementById('settings-buy-tokens-btn');
    if (buyTokensBtn) {
      buyTokensBtn.addEventListener('click', () => {
        this.handleBuyTokens();
      });
    }

    // External links (open in default browser)
    const externalLinks = {
      'settings-privacy-policy-link': 'https://www.racetagger.cloud/privacy-policy',
      'about-privacy-policy-link': 'https://www.racetagger.cloud/privacy-policy',
      'settings-terms-link': 'https://www.racetagger.cloud/terms-of-service',
      'about-terms-link': 'https://www.racetagger.cloud/terms-of-service',
      'settings-website-link': 'https://www.racetagger.cloud',
      'about-support-link': 'mailto:info@racetagger.cloud',
    };
    Object.entries(externalLinks).forEach(([id, url]) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          window.api.send('open-external-url', url);
        });
      }
    });

    // IPTC Pro: auto-write toggle
    const autoWriteToggle = document.getElementById('settings-iptc-auto-write');
    if (autoWriteToggle) {
      autoWriteToggle.addEventListener('change', (e) => {
        const defaults = this.getIptcProDefaults();
        defaults.autoWrite = e.target.checked;
        this.saveIptcProDefaults(defaults);
        const msg = e.target.checked
          ? 'Metadata will be written automatically during analysis.'
          : 'Metadata will only be written when you use Export & IPTC.';
        this.showNotification('IPTC Pro Default Updated', msg, 'success');
      });
    }

    // IPTC Pro: face-only toggle
    const faceOnlyToggle = document.getElementById('settings-iptc-face-only');
    if (faceOnlyToggle) {
      faceOnlyToggle.addEventListener('change', (e) => {
        const defaults = this.getIptcProDefaults();
        defaults.faceOnly = e.target.checked;
        this.saveIptcProDefaults(defaults);
        const msg = e.target.checked
          ? 'Portraits will only include the recognized person\'s data.'
          : 'All participants linked to the number will always be included.';
        this.showNotification('IPTC Pro Default Updated', msg, 'success');
      });
    }

    // Default IPTC template (UX-04) — Edit / Import / Clear
    const editTemplateBtn = document.getElementById('settings-iptc-template-edit');
    if (editTemplateBtn) {
      editTemplateBtn.addEventListener('click', () => this.openIptcDefaultsModal());
    }
    const importTemplateBtn = document.getElementById('settings-iptc-template-import');
    if (importTemplateBtn) {
      importTemplateBtn.addEventListener('click', () => this.handleImportTemplateFromXmp());
    }
    const clearTemplateBtn = document.getElementById('settings-iptc-template-clear');
    if (clearTemplateBtn) {
      clearTemplateBtn.addEventListener('click', () => this.handleClearTemplate());
    }

    // Default IPTC template modal controls
    const modalClose = document.getElementById('iptc-defaults-modal-close');
    if (modalClose) modalClose.addEventListener('click', () => this.closeIptcDefaultsModal());
    const modalCancel = document.getElementById('iptc-defaults-cancel');
    if (modalCancel) modalCancel.addEventListener('click', () => this.closeIptcDefaultsModal());
    const modalSave = document.getElementById('iptc-defaults-save');
    if (modalSave) modalSave.addEventListener('click', () => this.saveIptcDefaultsFromModal());
  },

  /**
   * Handle training consent toggle change
   */
  async handleConsentChange(newConsent) {
    const toggle = document.getElementById('settings-training-consent');

    try {
      const result = await window.api.invoke('set-training-consent', newConsent);

      if (result) {
        // Update local state
        if (this.settings) {
          this.settings.privacy.trainingConsent = newConsent;
        }

        // Show success notification
        const message = newConsent
          ? 'Thank you! Your images will help improve AI recognition.'
          : 'Preference saved. Your future images will not be used for training.';
        this.showNotification('Settings Updated', message, 'success');

        // Update timestamp display
        const timestampEl = document.getElementById('settings-consent-updated');
        if (timestampEl) {
          timestampEl.textContent = `Last updated: ${new Date().toLocaleDateString()}`;
        }
      } else {
        // Revert toggle on failure
        if (toggle) toggle.checked = !newConsent;
        this.showNotification('Error', 'Could not save preference. Please try again.', 'error');
      }
    } catch (error) {
      console.error('[Settings] Error saving training consent:', error);
      // Revert toggle on error
      if (toggle) toggle.checked = !newConsent;
      this.showNotification('Error', 'Could not save preference. Please try again.', 'error');
    }
  },

  /**
   * Handle error telemetry toggle change
   */
  async handleTelemetryChange(enabled) {
    const toggle = document.getElementById('settings-error-telemetry');

    try {
      const result = await window.api.invoke('set-telemetry-enabled', enabled);

      if (result && result.success !== false) {
        const message = enabled
          ? 'Automatic error reporting enabled. This helps us improve RaceTagger.'
          : 'Automatic error reporting disabled.';
        this.showNotification('Settings Updated', message, 'success');
      } else {
        if (toggle) toggle.checked = !enabled;
        this.showNotification('Error', 'Could not save preference. Please try again.', 'error');
      }
    } catch (error) {
      console.error('[Settings] Error saving telemetry preference:', error);
      if (toggle) toggle.checked = !enabled;
      this.showNotification('Error', 'Could not save preference. Please try again.', 'error');
    }
  },

  /**
   * Handle buy tokens button click
   */
  handleBuyTokens() {
    // Try to open the token info modal first
    const tokenModal = document.getElementById('token-info-modal');
    if (tokenModal) {
      tokenModal.style.display = 'flex';
    } else {
      // Fallback to opening subscription page
      window.api.send('open-subscription-page');
    }
  },

  /**
   * Show a notification message
   */
  showNotification(title, message, type = 'info') {
    // Try to use existing notification system if available
    if (typeof showNotification === 'function') {
      showNotification(title, message, type);
    } else if (typeof showToast === 'function') {
      showToast(message, type);
    }
  },

  /**
   * Update element text content safely
   */
  updateElement(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
    }
  },

  /**
   * Render error state
   */
  renderError() {
    this.updateElement('settings-user-email', 'Error loading data');
    this.updateElement('settings-token-balance', '-');
    this.updateElement('settings-app-version', '-');
  },

  /**
   * Refresh settings data (called when section becomes visible again)
   */
  async refresh() {
    await this.loadSettings();
  }
};

// Initialize when section becomes active via custom event
document.addEventListener('section-changed', (event) => {
  if (event.detail && event.detail.section === 'settings') {
    SettingsManager.initialize();
  }
});

// Also handle direct navigation via data-section attribute
document.addEventListener('DOMContentLoaded', () => {
  // Check if settings section is clicked
  const settingsNavItem = document.querySelector('[data-section="settings"]');
  if (settingsNavItem) {
    settingsNavItem.addEventListener('click', (e) => {
      e.preventDefault();
      // The navigation will be handled by desktop-ui.js
      // which will dispatch section-changed event
    });
  }
});

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.SettingsManager = SettingsManager;
}
