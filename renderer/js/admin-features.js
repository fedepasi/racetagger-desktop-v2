/**
 * FOLDER ORGANIZATION: JavaScript for folder organization functionality
 * 
 * This module handles folder organization features for all authenticated users.
 * TO REMOVE: Simply delete this file and remove the script tag from index.html
 */

class FolderOrganizationManager {
  constructor() {
    this.hasAccess = false;
    this.folderOrgEnabled = false;
    this.folderOrgConfig = null;
    this.initialized = false;
  }

  /**
   * Initialize folder organization system
   */
  async initialize() {
    if (this.initialized) return;

    // Check if user has access and feature is available
    await this.checkAccessStatus();

    // Setup UI elements
    this.setupUI();

    // Setup event listeners
    this.setupEventListeners();

    this.initialized = true;
  }

  /**
   * Check if current user has access and folder organization is available
   */
  async checkAccessStatus() {
    try {
      // Folder organization is now always available as a main feature
      this.folderOrgEnabled = true;
      this.hasAccess = true;

      document.body.classList.add('folder-org-user');
      this.showFolderOrgFeatures();
      
      // Load default configuration or use defaults
      try {
        this.folderOrgConfig = await window.api.invoke('get-folder-organization-config');
      } catch (configError) {
        this.folderOrgConfig = {
          enabled: false,
          mode: 'copy',
          pattern: 'number',
          customPattern: '{number}',
          createUnknownFolder: true,
          unknownFolderName: 'Unknown_Numbers',
          includeXmpFiles: true
        };
      }
    } catch (error) {
      console.error('[Folder Organization] Error checking access status:', error);
      // Even if there's an error, make folder organization available as it's now a main feature
      this.hasAccess = true;
      this.folderOrgEnabled = true;
      this.showFolderOrgFeatures();
    }
  }

  /**
   * Show folder organization features in the UI
   */
  showFolderOrgFeatures() {
    const folderOrgSection = document.getElementById('folder-organization-section');
    if (folderOrgSection) {
      folderOrgSection.style.display = 'block';
    }
  }

  /**
   * Setup UI elements and initial states
   */
  setupUI() {
    // Setup initial visibility for nested options
    const folderOrgOptions = document.getElementById('folder-organization-options');
    const customPatternContainer = document.getElementById('custom-pattern-container');
    
    if (folderOrgOptions) folderOrgOptions.style.display = 'none';
    if (customPatternContainer) customPatternContainer.style.display = 'none';
  }

  /**
   * Setup event listeners for folder organization features
   */
  setupEventListeners() {

    // Main toggle for folder organization
    const folderOrgToggle = document.getElementById('folder-organization-enabled');
    if (folderOrgToggle) {
      folderOrgToggle.addEventListener('change', (e) => {
        this.toggleFolderOrganization(e.target.checked);
      });
    }

    // Folder pattern selection
    const patternRadios = document.querySelectorAll('input[name="folder-pattern"]');
    patternRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.handlePatternChange(e.target.value);
      });
    });

    // Custom pattern input
    const customPatternInput = document.getElementById('custom-pattern-input');
    if (customPatternInput) {
      customPatternInput.addEventListener('input', (e) => {
        this.updateCustomPattern(e.target.value);
      });
    }

    // Operation mode selection (copy/move warning)
    const orgModeRadios = document.querySelectorAll('input[name="org-mode"]');
    orgModeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.handleModeChange(e.target.value);
      });
    });

    // Custom destination toggle
    const customDestToggle = document.getElementById('custom-destination-enabled');
    if (customDestToggle) {
      customDestToggle.addEventListener('change', (e) => {
        this.toggleCustomDestination(e.target.checked);
      });
    }

    // Browse destination folder button
    const selectDestBtn = document.getElementById('select-destination-btn');
    if (selectDestBtn) {
      selectDestBtn.addEventListener('click', () => {
        this.selectDestinationFolder();
      });
    }

    // Conflict strategy selection (warn for overwrite)
    const conflictRadios = document.querySelectorAll('input[name="conflict-strategy"]');
    conflictRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.handleConflictStrategyChange(e.target.value);
      });
    });
  }

  /**
   * Toggle folder organization feature
   */
  toggleFolderOrganization(enabled) {
    const folderOrgOptions = document.getElementById('folder-organization-options');
    if (folderOrgOptions) {
      folderOrgOptions.style.display = enabled ? 'block' : 'none';
    }

    // Update configuration
    if (this.folderOrgConfig) {
      this.folderOrgConfig.enabled = enabled;
    }
  }

  /**
   * Handle folder naming pattern changes
   */
  handlePatternChange(pattern) {
    const customPatternContainer = document.getElementById('custom-pattern-container');
    if (customPatternContainer) {
      customPatternContainer.style.display = pattern === 'custom' ? 'block' : 'none';
    }

    // Update configuration
    if (this.folderOrgConfig) {
      this.folderOrgConfig.pattern = pattern;
    }
  }

  /**
   * Update custom pattern
   */
  updateCustomPattern(pattern) {
    if (this.folderOrgConfig) {
      this.folderOrgConfig.customPattern = pattern || '{number}';
    }
  }

  /**
   * Handle operation mode changes (copy/move)
   */
  handleModeChange(mode) {
    // Show warning for move mode
    if (mode === 'move') {
      this.showMoveWarning();
    }

    // Update configuration
    if (this.folderOrgConfig) {
      this.folderOrgConfig.mode = mode;
    }
  }

  /**
   * Show warning dialog for move mode
   */
  showMoveWarning() {
    const confirmed = confirm(
      '⚠️ WARNING: "Move Files" Mode\n\n' +
      'This mode will move the original files into the organized folders.\n' +
      'There will be no backup copies in the original location.\n\n' +
      'Are you sure you want to proceed with this mode?\n\n' +
      '(We recommend "Copy Files" mode for greater safety)'
    );

    if (!confirmed) {
      // Reset to copy mode
      const copyRadio = document.getElementById('org-mode-copy');
      if (copyRadio) {
        copyRadio.checked = true;
        this.folderOrgConfig.mode = 'copy';
      }
    }
  }

  /**
   * Handle conflict strategy changes
   */
  handleConflictStrategyChange(strategy) {
    // Show warning for overwrite mode
    if (strategy === 'overwrite') {
      const confirmed = confirm(
        '⚠️ WARNING: Overwrite Mode\n\n' +
        'This mode will REPLACE existing files in the destination folders.\n' +
        'Original files will be permanently lost.\n\n' +
        'Are you sure you want to use this mode?\n\n' +
        '(We recommend using "Rename automatically" for safety)'
      );

      if (!confirmed) {
        // Reset to rename mode
        const renameRadio = document.getElementById('conflict-rename');
        if (renameRadio) {
          renameRadio.checked = true;
        }
      }
    }
  }

  /**
   * Toggle custom destination folder controls
   */
  toggleCustomDestination(enabled) {
    const customDestControls = document.getElementById('custom-destination-controls');
    if (customDestControls) {
      customDestControls.style.display = enabled ? 'block' : 'none';
    }

    // Clear path if disabled
    if (!enabled) {
      const pathInput = document.getElementById('custom-destination-path');
      if (pathInput) {
        pathInput.value = '';
        pathInput.placeholder = 'No folder selected';
      }
    }
  }

  /**
   * Select destination folder for organization
   */
  async selectDestinationFolder() {
    try {
      const selectedPath = await window.api.invoke('select-organization-destination');

      if (selectedPath) {
        const pathInput = document.getElementById('custom-destination-path');
        if (pathInput) {
          pathInput.value = selectedPath;
        }
      }
    } catch (error) {
      console.error('[Folder Organization] Error selecting destination folder:', error);
      alert('Error selecting folder. Please try again.');
    }
  }

  /**
   * Get current folder organization configuration
   */
  getFolderOrganizationConfig() {

    // Collect current UI state
    const enabled = document.getElementById('folder-organization-enabled')?.checked || false;
    const mode = document.querySelector('input[name="org-mode"]:checked')?.value || 'copy';
    const pattern = document.querySelector('input[name="folder-pattern"]:checked')?.value || 'number';
    const customPattern = document.getElementById('custom-pattern-input')?.value || '{number}';
    const createUnknownFolder = document.getElementById('create-unknown-folder')?.checked || true;
    const includeXmpFiles = document.getElementById('include-xmp-files')?.checked !== false;

    // Custom destination path
    const customDestEnabled = document.getElementById('custom-destination-enabled')?.checked || false;
    const customDestPath = document.getElementById('custom-destination-path')?.value || '';

    // Conflict strategy
    const conflictStrategy = document.querySelector('input[name="conflict-strategy"]:checked')?.value || 'rename';

    return {
      enabled,
      mode,
      pattern,
      customPattern: pattern === 'custom' ? customPattern : undefined,
      createUnknownFolder,
      unknownFolderName: 'Unknown_Numbers',
      includeXmpFiles,
      destinationPath: customDestEnabled && customDestPath ? customDestPath : undefined,
      conflictStrategy
    };
  }


  /**
   * Add folder organization info to upload button
   */
  updateUploadButtonText() {

    const config = this.getFolderOrganizationConfig();
    if (config && config.enabled) {
      const uploadButton = document.getElementById('upload-button');
      if (uploadButton) {
        const originalText = uploadButton.textContent.replace(' + Organize', '');
        uploadButton.textContent = originalText + ' + Organize';
      }
    } else {
      const uploadButton = document.getElementById('upload-button');
      if (uploadButton) {
        uploadButton.textContent = uploadButton.textContent.replace(' + Organize', '');
      }
    }
  }

  /**
   * Show access status in console (for debugging)
   */
  logAccessStatus() {
    // Intentionally empty - for debugging only
  }
}

// Global folder organization manager instance
window.folderOrganization = new FolderOrganizationManager();

// Maintain backward compatibility
window.adminFeatures = window.folderOrganization;

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure other systems are initialized first
  setTimeout(() => {
    window.folderOrganization.initialize();
  }, 500);
});

// Integration with auth system - reinitialize when auth state changes
document.addEventListener('auth-state-changed', () => {
  window.folderOrganization.initialized = false;
  window.folderOrganization.initialize();
});

// Reinitialize when analysis page loads (SPA navigation)
window.addEventListener('page-loaded', (e) => {
  if (e.detail?.page === 'analysis') {
    window.folderOrganization.initialized = false;
    window.folderOrganization.initialize();
  }
});

// Also listen for section-changed (backward compatibility)
document.addEventListener('section-changed', (e) => {
  if (e.detail?.section === 'analysis') {
    window.folderOrganization.initialized = false;
    window.folderOrganization.initialize();
  }
});

// Helper function for other scripts to check folder organization access
window.hasFolderOrganizationAccess = () => {
  return window.folderOrganization && window.folderOrganization.hasAccess;
};

// Maintain backward compatibility
window.isAdminUser = () => {
  return window.folderOrganization && window.folderOrganization.hasAccess;
};

// Helper function to get folder organization config
window.getFolderOrganizationConfig = () => {
  return window.folderOrganization ? window.folderOrganization.getFolderOrganizationConfig() : null;
};