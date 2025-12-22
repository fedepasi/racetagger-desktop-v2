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

    try {
      await this.loadSettings();
      this.setupEventListeners();
      this.isInitialized = true;
    } catch (error) {
      console.error('[Settings] Error initializing settings:', error);
    }
  },

  /**
   * Load settings data from main process
   */
  async loadSettings() {
    try {
      this.settings = await window.api.invoke('get-full-settings');
      this.renderSettings();
    } catch (error) {
      console.error('[Settings] Error loading settings:', error);
      this.renderError();
    }
  },

  /**
   * Render settings data to the UI
   */
  renderSettings() {
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

    // App version
    this.loadAppVersion();
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

    // Buy tokens button
    const buyTokensBtn = document.getElementById('settings-buy-tokens-btn');
    if (buyTokensBtn) {
      buyTokensBtn.addEventListener('click', () => {
        this.handleBuyTokens();
      });
    }
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
