/**
 * Racetagger Desktop - Smart Presets System
 * Simplifies complex configuration with intuitive presets
 */

class SmartPresets {
  constructor() {
    this.selectedPreset = null;
    this.isAdvancedMode = false;
    
    // Hardcoded Fast settings - only Fast mode available
    this.fastSettings = {
      model: 'gemini-2.5-flash-lite',
      // category: removed - preserve user's category selection
      resize: { enabled: true, preset: 'fast' },
      metadata: 'default',
      parallel: true
    };
    
    // No preset selection - Fast mode is always active
    this.selectedPreset = 'race-fast';
    
    this.init();
  }

  init() {
    // Check if we should replace existing advanced options
    this.checkAndReplaceAdvancedOptions();
    this.bindEvents();
    
    // Note: Preset selection is moved to createPresetsInterface() 
    // to ensure it happens after DOM elements are created
  }

  checkAndReplaceAdvancedOptions() {
    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedPanel = document.getElementById('advanced-panel');
    
    if (advancedToggle && advancedPanel) {
      // Wait a bit to ensure DOM is fully loaded
      setTimeout(() => {
        this.createPresetsInterface(advancedToggle, advancedPanel);
      }, 100);
    }
  }

  createPresetsInterface(toggleElement, panelElement) {
    // No preset selection interface - always use Fast settings
    
    // Mark section as enhanced UI active for styling compatibility
    const analysisSection = document.getElementById('section-analysis');
    if (analysisSection) {
      analysisSection.classList.add('enhanced-ui-active');
    }
    
    // Always apply Fast settings immediately
    this.applyFastSettings();
  }

  renderPresetCards() {
    return this.presets.map(preset => `
      <div class="preset-card" data-preset="${preset.id}" id="preset-${preset.id}">
        <div class="preset-header">
          <div class="preset-icon">${preset.icon}</div>
          <div class="preset-info">
            <div class="preset-name">${preset.name}</div>
            <div class="preset-tagline">${preset.tagline}</div>
          </div>
        </div>
        
        <div class="preset-description">${preset.description}</div>
        
        <div class="preset-features">
          ${preset.features.map(feature => `<span class="preset-feature">${feature}</span>`).join('')}
        </div>
        
        <div class="preset-stats">
          <div class="stat-item">
            <div class="stat-value">${preset.stats.speed}</div>
            <div class="stat-label">Speed</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${preset.stats.accuracy}</div>
            <div class="stat-label">Accuracy</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${preset.stats.cost}</div>
            <div class="stat-label">Cost</div>
          </div>
        </div>
        
        <div class="preset-settings">
          <div class="preset-setting">
            <span class="setting-label">AI Model:</span>
            <span class="setting-value">${this.getModelDisplayName(preset.settings.model)}</span>
          </div>
          <div class="preset-setting">
            <span class="setting-label">Optimization:</span>
            <span class="setting-value">${preset.settings.resize?.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div class="preset-setting">
            <span class="setting-label">Metadata:</span>
            <span class="setting-value">${preset.settings.metadata === 'full' ? 'Complete' : 'Basic'}</span>
          </div>
        </div>
        
        <div class="performance-indicator ${preset.performance}"></div>
      </div>
    `).join('');
  }

  bindEvents() {
    // Mode switch toggle
    const modeSwitch = document.getElementById('mode-switch');
    if (modeSwitch) {
      modeSwitch.addEventListener('click', () => this.toggleMode());
    }
    
    // Advanced options toggle
    const advancedToggle = document.getElementById('advanced-options-toggle');
    if (advancedToggle) {
      advancedToggle.addEventListener('click', () => this.toggleAdvancedOptions());
    }
    
    // Preset card selection
    document.addEventListener('click', (e) => {
      const presetCard = e.target.closest('.preset-card');
      if (presetCard) {
        this.selectPreset(presetCard.dataset.preset);
      }
    });
  }

  toggleMode() {
    const modeSwitch = document.getElementById('mode-switch');
    const advancedToggle = document.getElementById('advanced-options-toggle');
    const presetGrid = document.getElementById('preset-cards-grid');
    
    this.isAdvancedMode = !this.isAdvancedMode;
    
    if (this.isAdvancedMode) {
      modeSwitch.classList.add('active');
      advancedToggle.style.display = 'flex';
      presetGrid.style.opacity = '0.6';
      presetGrid.style.pointerEvents = 'none';
    } else {
      modeSwitch.classList.remove('active');
      advancedToggle.style.display = 'none';
      presetGrid.style.opacity = '1';
      presetGrid.style.pointerEvents = 'auto';
      
      // Hide advanced panel if shown
      const advancedPanel = document.getElementById('advanced-panel');
      if (advancedPanel) {
        advancedPanel.classList.remove('advanced-mode');
        advancedPanel.classList.add('preset-mode');
      }
    }
  }

  toggleAdvancedOptions() {
    const advancedPanel = document.getElementById('advanced-panel');
    const originalToggle = document.getElementById('advanced-toggle');
    
    if (advancedPanel) {
      if (advancedPanel.classList.contains('preset-mode')) {
        // Show advanced panel
        advancedPanel.classList.remove('preset-mode');
        advancedPanel.classList.add('advanced-mode');
        
        // Update button text
        const advancedToggle = document.getElementById('advanced-options-toggle');
        if (advancedToggle) {
          advancedToggle.textContent = 'Hide Advanced Options';
        }
        
        // Show original advanced toggle
        if (originalToggle) {
          originalToggle.style.display = 'none'; // Keep hidden, we manage state
        }
      } else {
        // Hide advanced panel
        advancedPanel.classList.remove('advanced-mode');
        advancedPanel.classList.add('preset-mode');
        
        // Update button text
        const advancedToggle = document.getElementById('advanced-options-toggle');
        if (advancedToggle) {
          advancedToggle.textContent = 'Show Advanced Options';
        }
      }
    }
  }

  selectPreset(presetId, applySettings = true) {
    // Remove previous selection
    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.remove('selected');
    });
    
    // Select new preset
    const selectedCard = document.getElementById(`preset-${presetId}`);
    if (selectedCard) {
      selectedCard.classList.add('selected');
      this.selectedPreset = presetId;
      
      if (applySettings) {
        this.applyPresetSettings(presetId);
      }
      
      // Save preference
      localStorage.setItem('racetagger-selected-preset', presetId);
      
      // Add visual feedback
      this.showPresetSelectedFeedback(presetId);
    }
  }

  applyFastSettings() {
    // Apply model selection (Fast AI Model)
    const modelSelect = document.getElementById('model-select');
    if (modelSelect && this.fastSettings.model) {
      modelSelect.value = this.fastSettings.model;
      modelSelect.dispatchEvent(new Event('change'));
    }
    
    // Category selection: preserve user's selection (removed forced 'motorsport')
    // const categorySelect = document.getElementById('category-select');
    // if (categorySelect && this.fastSettings.category) {
    //   categorySelect.value = this.fastSettings.category;
    //   categorySelect.dispatchEvent(new Event('change'));
    // }
    
    // Apply resize settings (fast preset)
    if (this.fastSettings.resize && window.desktopUI) {
      const resizeToggle = document.getElementById('resize-enabled');
      if (resizeToggle) {
        resizeToggle.checked = this.fastSettings.resize.enabled;
        resizeToggle.dispatchEvent(new Event('change'));
        
        if (this.fastSettings.resize.preset) {
          setTimeout(() => {
            const presetRadio = document.getElementById(`preset-${this.fastSettings.resize.preset}`);
            if (presetRadio) {
              presetRadio.checked = true;
              presetRadio.dispatchEvent(new Event('change'));
            }
          }, 100);
        }
      }
    }
    
    // Apply metadata strategy (default)
    if (this.fastSettings.metadata) {
      const metadataRadio = document.querySelector(`input[name="metadata-strategy"][value="${this.fastSettings.metadata}"]`);
      if (metadataRadio) {
        metadataRadio.checked = true;
        metadataRadio.dispatchEvent(new Event('change'));
      }
    }
  }

  showPresetSelectedFeedback(presetId) {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return;
    
    // Create temporary notification
    const notification = document.createElement('div');
    notification.className = 'preset-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <div class="notification-icon">${preset.icon}</div>
        <div class="notification-text">
          <div class="notification-title">${preset.name} Activated</div>
          <div class="notification-subtitle">Configuration applied successfully</div>
        </div>
      </div>
    `;
    
    // Style the notification
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
      z-index: 1000;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 300);
    }, 3000);
  }

  getModelDisplayName(modelId) {
    const modelNames = {
      'gemini-2.5-flash-lite': 'Fast',
      'gemini-2.5-flash-preview-04-17': 'Balanced',
      'gemini-2.5-pro-preview-05-06': 'Pro'
    };
    
    return modelNames[modelId] || 'Unknown';
  }

  // Get current preset settings for external use
  getCurrentPresetSettings() {
    if (!this.selectedPreset) return null;
    
    const preset = this.presets.find(p => p.id === this.selectedPreset);
    return preset ? { ...preset.settings, presetName: preset.name } : null;
  }

  // Method to programmatically change preset (for onboarding etc.)
  setPreset(presetId) {
    this.selectPreset(presetId, true);
  }

  // Get preset info for display
  getPresetInfo(presetId) {
    return this.presets.find(p => p.id === presetId);
  }

  // Export settings for advanced users
  exportPresetSettings() {
    const settings = this.getCurrentPresetSettings();
    if (settings) {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `racetagger-preset-${this.selectedPreset}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // Static method to get instance
  static getInstance() {
    if (!window.smartPresetsInstance) {
      window.smartPresetsInstance = new SmartPresets();
    }
    return window.smartPresetsInstance;
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for other components to initialize first
    setTimeout(() => {
      window.smartPresets = new SmartPresets();
    }, 200);
  });
} else {
  setTimeout(() => {
    window.smartPresets = new SmartPresets();
  }, 200);
}

// Export for global access
window.SmartPresets = SmartPresets;