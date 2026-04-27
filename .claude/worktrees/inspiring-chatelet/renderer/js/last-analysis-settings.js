/**
 * Last Analysis Settings Manager
 * Persists and restores analysis settings between sessions
 * Requested by Michele Scudiero (call 8 gen 2026)
 */

const STORAGE_KEY = 'racetagger-last-analysis-settings';

/**
 * Save current analysis settings to localStorage
 */
function saveLastAnalysisSettings() {
  try {
    const settings = {
      // Basic settings
      model: getSelectedModel(),
      category: getSelectedCategory(),
      presetId: getSelectedPresetId(),

      // Folder organization
      folderOrganization: getFolderOrganizationSettings(),

      // Visual tagging
      visualTagging: getVisualTaggingSettings(),

      // Metadata management
      metadata: getMetadataSettings(),

      // Upload optimization
      uploadOptimization: getUploadOptimizationSettings(),

      // Timestamp
      savedAt: Date.now()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    console.log('[LastAnalysisSettings] Settings saved:', settings);

    return true;
  } catch (error) {
    console.error('[LastAnalysisSettings] Error saving settings:', error);
    return false;
  }
}

/**
 * Load and apply last analysis settings from localStorage
 */
function loadLastAnalysisSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.log('[LastAnalysisSettings] No saved settings found');
      return false;
    }

    const settings = JSON.parse(stored);
    console.log('[LastAnalysisSettings] Loading settings:', settings);

    // Apply basic settings
    applyModelSetting(settings.model);
    applyCategorySetting(settings.category);
    applyPresetSetting(settings.presetId);

    // Apply folder organization settings
    if (settings.folderOrganization) {
      applyFolderOrganizationSettings(settings.folderOrganization);
    }

    // Apply visual tagging settings
    if (settings.visualTagging) {
      applyVisualTaggingSettings(settings.visualTagging);
    }

    // Apply metadata settings
    if (settings.metadata) {
      applyMetadataSettings(settings.metadata);
    }

    // Apply upload optimization settings
    if (settings.uploadOptimization) {
      applyUploadOptimizationSettings(settings.uploadOptimization);
    }

    console.log('[LastAnalysisSettings] Settings applied successfully');
    return true;
  } catch (error) {
    console.error('[LastAnalysisSettings] Error loading settings:', error);
    return false;
  }
}

/**
 * Clear saved settings
 */
function clearLastAnalysisSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[LastAnalysisSettings] Settings cleared');
    return true;
  } catch (error) {
    console.error('[LastAnalysisSettings] Error clearing settings:', error);
    return false;
  }
}

// ==================== GETTER FUNCTIONS ====================

function getSelectedModel() {
  const modelSelect = document.getElementById('model-select');
  return modelSelect ? modelSelect.value : 'gemini-2.5-flash-lite-preview-06-17';
}

function getSelectedCategory() {
  const categorySelect = document.getElementById('category-select');
  return categorySelect ? categorySelect.value : 'motorsport';
}

function getSelectedPresetId() {
  const presetSelect = document.getElementById('preset-select');
  return presetSelect && presetSelect.value ? presetSelect.value : null;
}

function getFolderOrganizationSettings() {
  const enabled = document.getElementById('folder-organization-enabled');
  const customDestEnabled = document.getElementById('custom-destination-enabled');
  const customDestPath = document.getElementById('custom-destination-path');
  const orgModeCopy = document.getElementById('org-mode-copy');
  const conflictRename = document.getElementById('conflict-rename');
  const conflictSkip = document.getElementById('conflict-skip');
  const conflictOverwrite = document.getElementById('conflict-overwrite');
  const createUnknown = document.getElementById('create-unknown-folder');
  const includeXmp = document.getElementById('include-xmp-files');

  return {
    enabled: enabled ? enabled.checked : false,
    customDestinationEnabled: customDestEnabled ? customDestEnabled.checked : false,
    customDestinationPath: customDestPath ? customDestPath.value : '',
    orgMode: orgModeCopy && orgModeCopy.checked ? 'copy' : 'move',
    conflictStrategy: conflictRename && conflictRename.checked ? 'rename' :
                      conflictSkip && conflictSkip.checked ? 'skip' : 'overwrite',
    createUnknownFolder: createUnknown ? createUnknown.checked : true,
    includeXmpFiles: includeXmp ? includeXmp.checked : true
  };
}

function getVisualTaggingSettings() {
  const enabled = document.getElementById('visual-tagging-enabled');
  const embedTags = document.getElementById('embed-tags-in-metadata');

  return {
    enabled: enabled ? enabled.checked : false,
    embedTagsInMetadata: embedTags ? embedTags.checked : false
  };
}

function getMetadataSettings() {
  const strategyNo = document.getElementById('metadata-strategy-no');
  const strategyDefault = document.getElementById('metadata-strategy-default');
  const strategyManual = document.getElementById('metadata-strategy-manual');
  const strategyFull = document.getElementById('metadata-strategy-full');
  const manualValue = document.getElementById('manual-metatag');
  const keywordsOverwrite = document.getElementById('keywords-overwrite');
  const descriptionOverwrite = document.getElementById('description-overwrite');

  let strategy = 'no_metadata';
  if (strategyDefault && strategyDefault.checked) strategy = 'default';
  else if (strategyManual && strategyManual.checked) strategy = 'manual';
  else if (strategyFull && strategyFull.checked) strategy = 'full';

  return {
    strategy: strategy,
    manualValue: manualValue ? manualValue.value : '',
    keywordsOverwrite: keywordsOverwrite ? keywordsOverwrite.checked : false,
    descriptionOverwrite: descriptionOverwrite ? descriptionOverwrite.checked : false
  };
}

function getUploadOptimizationSettings() {
  const enabled = document.getElementById('resize-enabled');
  const presetFast = document.getElementById('preset-fast');
  const presetBalanced = document.getElementById('preset-balanced');
  const presetQuality = document.getElementById('preset-quality');

  let preset = 'balanced';
  if (presetFast && presetFast.checked) preset = 'fast';
  else if (presetQuality && presetQuality.checked) preset = 'quality';

  return {
    enabled: enabled ? enabled.checked : false,
    preset: preset
  };
}

// ==================== SETTER FUNCTIONS ====================

function applyModelSetting(model) {
  if (!model) return;

  const modelSelect = document.getElementById('model-select');
  if (modelSelect && modelSelect.value !== model) {
    modelSelect.value = model;

    // Trigger change event to update UI
    const event = new Event('change', { bubbles: true });
    modelSelect.dispatchEvent(event);
  }
}

function applyCategorySetting(category) {
  if (!category) return;

  const categorySelect = document.getElementById('category-select');
  if (categorySelect && categorySelect.value !== category) {
    categorySelect.value = category;

    // Trigger change event to update UI
    const event = new Event('change', { bubbles: true });
    categorySelect.dispatchEvent(event);
  }
}

function applyPresetSetting(presetId) {
  if (!presetId) return;

  const presetSelect = document.getElementById('preset-select');
  if (!presetSelect) return;

  // The preset options are populated asynchronously after category loads.
  // Poll until the option is available (max ~3s).
  let attempts = 0;
  const maxAttempts = 30;

  const tryApply = () => {
    const option = presetSelect.querySelector(`option[value="${presetId}"]`);
    if (option) {
      presetSelect.value = presetId;
      const event = new Event('change', { bubbles: true });
      presetSelect.dispatchEvent(event);
      console.log('[LastAnalysisSettings] Preset restored:', presetId);
      return;
    }
    attempts++;
    if (attempts < maxAttempts) {
      setTimeout(tryApply, 100);
    } else {
      console.warn('[LastAnalysisSettings] Preset option not found after polling:', presetId);
    }
  };

  tryApply();
}

function applyFolderOrganizationSettings(settings) {
  const enabled = document.getElementById('folder-organization-enabled');
  const customDestEnabled = document.getElementById('custom-destination-enabled');
  const customDestPath = document.getElementById('custom-destination-path');
  const orgModeCopy = document.getElementById('org-mode-copy');
  const orgModeMove = document.getElementById('org-mode-move');
  const conflictRename = document.getElementById('conflict-rename');
  const conflictSkip = document.getElementById('conflict-skip');
  const conflictOverwrite = document.getElementById('conflict-overwrite');
  const createUnknown = document.getElementById('create-unknown-folder');
  const includeXmp = document.getElementById('include-xmp-files');

  if (enabled) {
    enabled.checked = settings.enabled;
    // Trigger change to show/hide options
    const event = new Event('change', { bubbles: true });
    enabled.dispatchEvent(event);
  }

  if (customDestEnabled) customDestEnabled.checked = settings.customDestinationEnabled;
  if (customDestPath) customDestPath.value = settings.customDestinationPath || '';

  if (settings.orgMode === 'copy' && orgModeCopy) {
    orgModeCopy.checked = true;
  } else if (settings.orgMode === 'move' && orgModeMove) {
    orgModeMove.checked = true;
  }

  if (settings.conflictStrategy === 'rename' && conflictRename) {
    conflictRename.checked = true;
  } else if (settings.conflictStrategy === 'skip' && conflictSkip) {
    conflictSkip.checked = true;
  } else if (settings.conflictStrategy === 'overwrite' && conflictOverwrite) {
    conflictOverwrite.checked = true;
  }

  if (createUnknown) createUnknown.checked = settings.createUnknownFolder;
  if (includeXmp) includeXmp.checked = settings.includeXmpFiles;
}

function applyVisualTaggingSettings(settings) {
  const enabled = document.getElementById('visual-tagging-enabled');
  const embedTags = document.getElementById('embed-tags-in-metadata');

  if (enabled) {
    enabled.checked = settings.enabled;
    // Trigger change to show/hide options
    const event = new Event('change', { bubbles: true });
    enabled.dispatchEvent(event);
  }

  if (embedTags) embedTags.checked = settings.embedTagsInMetadata;
}

function applyMetadataSettings(settings) {
  const strategyNo = document.getElementById('metadata-strategy-no');
  const strategyDefault = document.getElementById('metadata-strategy-default');
  const strategyManual = document.getElementById('metadata-strategy-manual');
  const strategyFull = document.getElementById('metadata-strategy-full');
  const manualValue = document.getElementById('manual-metatag');
  const keywordsOverwrite = document.getElementById('keywords-overwrite');
  const descriptionOverwrite = document.getElementById('description-overwrite');

  // Set strategy radio
  if (settings.strategy === 'no_metadata' && strategyNo) {
    strategyNo.checked = true;
  } else if (settings.strategy === 'default' && strategyDefault) {
    strategyDefault.checked = true;
  } else if (settings.strategy === 'manual' && strategyManual) {
    strategyManual.checked = true;
    if (manualValue) manualValue.value = settings.manualValue || '';
  } else if (settings.strategy === 'full' && strategyFull) {
    strategyFull.checked = true;
  }

  // Trigger change event to show/hide manual input
  const checkedRadio = document.querySelector('input[name="metadata-strategy"]:checked');
  if (checkedRadio) {
    const event = new Event('change', { bubbles: true });
    checkedRadio.dispatchEvent(event);
  }

  if (keywordsOverwrite) keywordsOverwrite.checked = settings.keywordsOverwrite;
  if (descriptionOverwrite) descriptionOverwrite.checked = settings.descriptionOverwrite;
}

function applyUploadOptimizationSettings(settings) {
  const enabled = document.getElementById('resize-enabled');
  const presetFast = document.getElementById('preset-fast');
  const presetBalanced = document.getElementById('preset-balanced');
  const presetQuality = document.getElementById('preset-quality');

  if (enabled) {
    enabled.checked = settings.enabled;
    // Trigger change to show/hide options
    const event = new Event('change', { bubbles: true });
    enabled.dispatchEvent(event);
  }

  if (settings.preset === 'fast' && presetFast) {
    presetFast.checked = true;
  } else if (settings.preset === 'balanced' && presetBalanced) {
    presetBalanced.checked = true;
  } else if (settings.preset === 'quality' && presetQuality) {
    presetQuality.checked = true;
  }
}

// Expose functions globally
window.saveLastAnalysisSettings = saveLastAnalysisSettings;
window.loadLastAnalysisSettings = loadLastAnalysisSettings;
window.clearLastAnalysisSettings = clearLastAnalysisSettings;
