/**
 * Visual Tagging Manager
 *
 * Manages the visual tagging feature UI and configuration.
 * Handles toggle state, options, and provides config to renderer.js
 *
 * NOTE: Config is NOT persisted - defaults to false on every app start
 */

class VisualTaggingManager {
  constructor() {
    this.config = {
      enabled: false,
      embedInMetadata: false
    };

    this.initialized = false;
  }

  /**
   * Initialize the manager - call after DOM is ready
   */
  init() {
    if (this.initialized) return;

    this.setupEventListeners();
    this.initialized = true;

    console.log('[VisualTagging] Manager initialized');
  }

  /**
   * Setup event listeners for toggle and options
   */
  setupEventListeners() {
    // Main toggle
    const mainToggle = document.getElementById('visual-tagging-enabled');
    if (mainToggle) {
      mainToggle.addEventListener('change', (e) => {
        this.toggleVisualTagging(e.target.checked);
      });
    }

    // Embed in metadata toggle
    const embedToggle = document.getElementById('embed-tags-in-metadata');
    if (embedToggle) {
      embedToggle.addEventListener('change', (e) => {
        this.config.embedInMetadata = e.target.checked;
      });
    }
  }

  /**
   * Toggle visual tagging on/off
   */
  toggleVisualTagging(enabled) {
    this.config.enabled = enabled;

    // When enabling, set embedInMetadata to true by default
    if (enabled) {
      this.config.embedInMetadata = true;
      const embedToggle = document.getElementById('embed-tags-in-metadata');
      if (embedToggle) {
        embedToggle.checked = true;
      }
    }

    // Show/hide options panel
    const optionsPanel = document.getElementById('visual-tagging-options');
    if (optionsPanel) {
      optionsPanel.style.display = enabled ? 'block' : 'none';
    }

    console.log(`[VisualTagging] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig() {
    this.config = {
      enabled: false,
      embedInMetadata: false
    };

    // Reset UI
    const mainToggle = document.getElementById('visual-tagging-enabled');
    if (mainToggle) {
      mainToggle.checked = false;
    }

    const embedToggle = document.getElementById('embed-tags-in-metadata');
    if (embedToggle) {
      embedToggle.checked = false;
    }

    const optionsPanel = document.getElementById('visual-tagging-options');
    if (optionsPanel) {
      optionsPanel.style.display = 'none';
    }
  }
}

// Create global instance
window.visualTaggingManager = new VisualTaggingManager();

// Global getter for renderer.js integration
window.getVisualTaggingConfig = function() {
  if (window.visualTaggingManager) {
    return window.visualTaggingManager.getConfig();
  }
  return { enabled: false, embedInMetadata: false };
};

// Initialize on page load or section change
// Reset initialized flag to re-bind event listeners on dynamic page loads
document.addEventListener('page-loaded', (e) => {
  if (e.detail?.page === 'analysis') {
    window.visualTaggingManager.initialized = false;
    window.visualTaggingManager.init();
  }
});

document.addEventListener('section-changed', (e) => {
  if (e.detail?.section === 'analysis') {
    window.visualTaggingManager.initialized = false;
    window.visualTaggingManager.init();
  }
});

// Also try to init on DOMContentLoaded for non-SPA scenarios
document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on analysis page
  const analysisSection = document.getElementById('section-analysis');
  if (analysisSection) {
    window.visualTaggingManager.init();
  }
});

console.log('[VisualTagging] Manager script loaded');
