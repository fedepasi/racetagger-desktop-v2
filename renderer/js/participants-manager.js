/**
 * Participants Manager
 * Handles participant preset creation, editing, and management
 */

console.log('🔧 [DEBUG] participants-manager.js is loading...');

var currentPreset = null;
var participantsData = [];
var isEditingPreset = false;

console.log('🔧 [DEBUG] Variables declared:', { currentPreset, participantsData, isEditingPreset });

/**
 * Initialize participants manager
 */
async function initParticipantsManager() {
  console.log('[Participants] Initializing participants manager...');

  // Setup event listeners
  setupEventListeners();

  // Load existing presets
  await loadParticipantPresets();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Main buttons
  document.getElementById('create-new-preset-btn')?.addEventListener('click', createNewPreset);
  document.getElementById('import-csv-preset-btn')?.addEventListener('click', openCsvImportModal);

  // Modal close handlers
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      closeAllModals();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
}

/**
 * Load all participant presets
 */
async function loadParticipantPresets() {
  try {
    console.log('[Participants] Loading participant presets...');

    const response = await window.api.invoke('supabase-get-participant-presets');
    if (response.success && response.data) {
      displayParticipantPresets(response.data);
    } else {
      console.error('[Participants] Error loading presets:', response.error);
      showEmptyPresetsState();
    }
  } catch (error) {
    console.error('[Participants] Error loading presets:', error);
    showEmptyPresetsState();
  }
}

/**
 * Display participant presets in the UI
 */
function displayParticipantPresets(presets) {
  const container = document.getElementById('presets-list-container');
  const emptyState = document.getElementById('empty-presets-state');

  if (!presets || presets.length === 0) {
    showEmptyPresetsState();
    return;
  }

  // Hide empty state if it exists
  if (emptyState) {
    emptyState.style.display = 'none';
  }

  // Create presets grid
  const presetsGrid = document.createElement('div');
  presetsGrid.className = 'presets-grid';
  presetsGrid.innerHTML = '';

  presets.forEach(preset => {
    const presetCard = createPresetCard(preset);
    presetsGrid.appendChild(presetCard);
  });

  // Clear container and add grid
  container.innerHTML = '';
  container.appendChild(presetsGrid);
}

/**
 * Create a preset card element
 */
function createPresetCard(preset) {
  const card = document.createElement('div');
  card.className = 'preset-card';
  card.innerHTML = `
    <div class="preset-header">
      <div class="preset-title">${escapeHtml(preset.name)}</div>
      <div class="preset-actions">
        <button class="btn btn-sm btn-secondary" onclick="editPreset('${preset.id}')" title="Edit">
          <span class="btn-icon">✏️</span>
        </button>
        <button class="btn btn-sm btn-danger" onclick="deletePreset('${preset.id}')" title="Delete">
          <span class="btn-icon">🗑️</span>
        </button>
      </div>
    </div>
    <div class="preset-info">
      <div class="preset-description">${preset.description || 'No description'}</div>
    </div>
    <div class="preset-stats">
      <div class="stat">
        <span class="stat-label">Participants:</span>
        <span class="stat-value">${preset.participants?.length || 0}</span>
      </div>
      ${preset.last_used_at ? `
        <div class="stat">
          <span class="stat-label">Last used:</span>
          <span class="stat-value">${formatDate(preset.last_used_at)}</span>
        </div>
      ` : ''}
    </div>
    <div class="preset-actions-bottom">
      <!-- Use in Analysis button removed - preset selection handled in Analysis tab -->
    </div>
  `;

  return card;
}

/**
 * Show empty presets state
 */
function showEmptyPresetsState() {
  const container = document.getElementById('presets-list-container');
  let emptyState = document.getElementById('empty-presets-state');

  // Clear any existing content
  container.innerHTML = '';

  // Recreate empty state if it doesn't exist (because innerHTML cleared it)
  if (!emptyState) {
    emptyState = document.createElement('div');
    emptyState.id = 'empty-presets-state';
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <div class="empty-icon">👥</div>
      <h3>No participant presets yet</h3>
      <p>Create your first preset to start managing participants efficiently</p>
    `;
  }

  container.appendChild(emptyState);
  emptyState.style.display = 'block';
}

/**
 * Create new preset
 */
function createNewPreset() {
  console.log('[Participants] Creating new preset...');

  currentPreset = null;
  isEditingPreset = false;
  participantsData = [];

  // Reset form
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-description').value = '';
  document.getElementById('preset-editor-title').textContent = 'New Participant Preset';

  // Clear participants table
  clearParticipantsTable();
  addParticipantRow(); // Add one empty row

  // Show modal
  const modal = document.getElementById('preset-editor-modal');
  modal.classList.add('show');
}

/**
 * Edit existing preset
 */
async function editPreset(presetId) {
  try {
    console.log('[Participants] Editing preset:', presetId);

    const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);
    if (!response.success || !response.data) {
      showNotification('Error loading preset: ' + (response.error || 'Unknown error'), 'error');
      return;
    }

    currentPreset = response.data;
    isEditingPreset = true;
    participantsData = currentPreset.participants || [];

    // Fill form with preset data
    document.getElementById('preset-name').value = currentPreset.name || '';
    document.getElementById('preset-description').value = currentPreset.description || '';
    document.getElementById('preset-editor-title').textContent = 'Edit Participant Preset';

    // Load participants into table
    loadParticipantsIntoTable(participantsData);

    // Show modal
    const modal = document.getElementById('preset-editor-modal');
    modal.classList.add('show');

  } catch (error) {
    console.error('[Participants] Error editing preset:', error);
    showNotification('Error loading preset for editing', 'error');
  }
}

/**
 * Delete preset with confirmation
 */
async function deletePreset(presetId) {
  const confirmed = await showConfirmDialog(
    'Delete Preset',
    'Are you sure you want to delete this participant preset? This action cannot be undone.'
  );

  if (!confirmed) return;

  try {
    console.log('[Participants] Deleting preset:', presetId);

    const response = await window.api.invoke('supabase-delete-participant-preset', presetId);
    if (response.success) {
      showNotification('Preset deleted successfully', 'success');
      await loadParticipantPresets(); // Refresh list
    } else {
      showNotification('Error deleting preset: ' + (response.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('[Participants] Error deleting preset:', error);
    showNotification('Error deleting preset', 'error');
  }
}

/**
 * Load participants data into the table
 */
function loadParticipantsIntoTable(participants) {
  clearParticipantsTable();

  if (!participants || participants.length === 0) {
    addParticipantRow();
    return;
  }

  participants.forEach(participant => {
    addParticipantRow(participant);
  });
}

/**
 * Clear participants table
 */
function clearParticipantsTable() {
  const tbody = document.getElementById('participants-tbody');
  tbody.innerHTML = '';
}

/**
 * Add a participant row to the table
 */
function addParticipantRow(participant = null) {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) {
    console.error('Cannot find participants-tbody element');
    return;
  }

  const row = document.createElement('tr');

  // Helper function to escape HTML attributes
  const escapeHtml = (str) => str ? str.replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '';

  const sponsors = escapeHtml(participant?.sponsor || '');
  const numero = escapeHtml(participant?.numero || '');
  const nome = escapeHtml(participant?.nome || '');
  const navigatore = escapeHtml(participant?.navigatore || '');
  const squadra = escapeHtml(participant?.squadra || '');
  const metatag = escapeHtml(participant?.metatag || '');

  row.innerHTML = `
    <td><input type="text" class="form-input-sm" placeholder="1" value="${numero}" data-field="numero"></td>
    <td><input type="text" class="form-input-sm" placeholder="Driver Name" value="${nome}" data-field="nome"></td>
    <td><input type="text" class="form-input-sm" placeholder="Navigator Name" value="${navigatore}" data-field="navigatore"></td>
    <td><input type="text" class="form-input-sm" placeholder="Team Name" value="${squadra}" data-field="squadra"></td>
    <td><input type="text" class="form-input-sm" placeholder="Sponsor1, Sponsor2" value="${sponsors}" data-field="sponsor"></td>
    <td><input type="text" class="form-input-sm" placeholder="Custom tag" value="${metatag}" data-field="metatag"></td>
    <td>
      <button class="btn btn-sm btn-danger" onclick="removeParticipantRow(this)" title="Remove row">
        <span class="btn-icon">×</span>
      </button>
    </td>
  `;

  tbody.appendChild(row);
}

/**
 * Remove a participant row
 */
function removeParticipantRow(button) {
  const row = button.closest('tr');
  row.remove();
}

/**
 * Clear all participants
 */
function clearAllParticipants() {
  if (document.getElementById('participants-tbody').children.length > 0) {
    const confirmed = confirm('Are you sure you want to clear all participants?');
    if (confirmed) {
      clearParticipantsTable();
      addParticipantRow(); // Add one empty row
    }
  }
}

/**
 * Save preset
 */
async function savePreset() {
  try {
    const presetName = document.getElementById('preset-name').value.trim();
    const presetDescription = document.getElementById('preset-description').value.trim();

    // Validation
    if (!presetName) {
      showNotification('Please enter a preset name', 'error');
      document.getElementById('preset-name').focus();
      return;
    }

    // Collect participants data
    const participants = collectParticipantsFromTable();
    console.log('[Participants] Collected participants:', participants.length);

    // Disable save button during operation
    const saveBtn = document.getElementById('save-preset-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-icon">⏳</span>Saving...';

    let presetId;

    if (isEditingPreset && currentPreset) {
      // Update existing preset
      presetId = currentPreset.id;
      console.log('[Participants] Updating existing preset:', presetId);

      const updateData = {
        name: presetName,
        description: presetDescription
      };

      const updateResponse = await window.api.invoke('supabase-update-participant-preset', {
        presetId: presetId,
        updateData: updateData
      });

      if (!updateResponse.success) {
        throw new Error(updateResponse.error || 'Failed to update preset');
      }
    } else {
      // Create new preset
      console.log('[Participants] Creating new preset...');

      const presetData = {
        name: presetName,
        description: presetDescription
      };

      const createResponse = await window.api.invoke('supabase-create-participant-preset', presetData);
      if (!createResponse.success) {
        throw new Error(createResponse.error || 'Failed to create preset');
      }

      presetId = createResponse.data.id;
    }

    // Save participants
    if (participants.length > 0) {
      const saveResponse = await window.api.invoke('supabase-save-preset-participants', {
        presetId: presetId,
        participants: participants
      });

      if (!saveResponse.success) {
        throw new Error(saveResponse.error || 'Failed to save participants');
      }
    }

    showNotification(
      isEditingPreset ? 'Preset updated successfully!' : 'Preset created successfully!',
      'success'
    );

    closePresetEditor();
    await loadParticipantPresets(); // Refresh list

  } catch (error) {
    console.error('[Participants] Error saving preset:', error);
    showNotification('Error saving preset: ' + error.message, 'error');
  } finally {
    // Re-enable save button
    const saveBtn = document.getElementById('save-preset-btn');
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span class="btn-icon">💾</span>Save Preset';
  }
}

/**
 * Collect participants data from table
 */
function collectParticipantsFromTable() {
  const tbody = document.getElementById('participants-tbody');
  const rows = tbody.querySelectorAll('tr');
  const participants = [];

  console.log('[Participants] Collecting participants from', rows.length, 'rows');

  rows.forEach((row, index) => {
    const inputs = row.querySelectorAll('input[data-field]');
    const participant = {};
    let hasData = false;

    inputs.forEach(input => {
      const field = input.dataset.field;
      let value = input.value.trim();

      // Always include the field in the participant object
      participant[field] = value;

      // Check if this field has meaningful data
      if (value && value.length > 0) {
        hasData = true;
      }
    });

    console.log('[Participants] Row', index, ':', participant, 'hasData:', hasData);

    // Only add participant if has at least a number or name
    if (hasData && (participant.numero || participant.nome)) {
      participants.push(participant);
      console.log('[Participants] Added participant:', participant);
    }
  });

  console.log('[Participants] Total collected participants:', participants.length);
  return participants;
}

/**
 * Close preset editor modal
 */
function closePresetEditor() {
  const modal = document.getElementById('preset-editor-modal');
  modal.classList.remove('show');
  currentPreset = null;
  isEditingPreset = false;
  participantsData = [];
}

/**
 * Open CSV import modal
 */
function openCsvImportModal() {
  document.getElementById('csv-preset-name').value = '';
  document.getElementById('csv-file-input').value = '';
  document.getElementById('csv-preview').style.display = 'none';
  document.getElementById('import-csv-btn').disabled = true;

  const modal = document.getElementById('csv-import-modal');
  modal.classList.add('show');
}

/**
 * Close CSV import modal
 */
function closeCsvImportModal() {
  const modal = document.getElementById('csv-import-modal');
  modal.classList.remove('show');
}

/**
 * Close all modals
 */
function closeAllModals() {
  closePresetEditor();
  closeCsvImportModal();
}

/**
 * Preview CSV file content
 */
async function previewCsvFile() {
  const fileInput = document.getElementById('csv-file-input');
  const previewDiv = document.getElementById('csv-preview');
  const importBtn = document.getElementById('import-csv-btn');

  if (!fileInput.files || fileInput.files.length === 0) {
    previewDiv.style.display = 'none';
    importBtn.disabled = true;
    return;
  }

  const file = fileInput.files[0];

  try {
    const csvText = await readFileAsText(file);
    const csvData = parseCSV(csvText);

    if (csvData.length === 0) {
      showNotification('CSV file appears to be empty', 'error');
      return;
    }

    // Show preview of first 5 rows
    const previewData = csvData.slice(0, 5);
    const previewTable = createCsvPreviewTable(previewData);

    document.getElementById('csv-preview-table').innerHTML = '';
    document.getElementById('csv-preview-table').appendChild(previewTable);

    previewDiv.style.display = 'block';
    importBtn.disabled = false;

    // Store CSV data for import
    window.csvImportData = csvData;

  } catch (error) {
    console.error('[Participants] Error previewing CSV:', error);
    showNotification('Error reading CSV file: ' + error.message, 'error');
    previewDiv.style.display = 'none';
    importBtn.disabled = true;
  }
}

/**
 * Create CSV preview table
 */
function createCsvPreviewTable(data) {
  const table = document.createElement('table');
  table.className = 'csv-preview-table';

  if (data.length === 0) {
    table.innerHTML = '<tr><td>No data</td></tr>';
    return table;
  }

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headers = Object.keys(data[0]);
  headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  data.forEach(row => {
    const tr = document.createElement('tr');
    headers.forEach(header => {
      const td = document.createElement('td');
      td.textContent = row[header] || '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

/**
 * Import CSV preset
 */
async function importCsvPreset() {
  try {
    const presetName = document.getElementById('csv-preset-name').value.trim();

    if (!presetName) {
      showNotification('Please enter a preset name', 'error');
      document.getElementById('csv-preset-name').focus();
      return;
    }

    if (!window.csvImportData || window.csvImportData.length === 0) {
      showNotification('No CSV data to import', 'error');
      return;
    }

    // Disable import button
    const importBtn = document.getElementById('import-csv-btn');
    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="btn-icon">⏳</span>Importing...';

    console.log('[Participants] Importing CSV preset:', presetName, 'with', window.csvImportData.length, 'participants');

    const response = await window.api.invoke('supabase-import-participants-from-csv', {
      csvData: window.csvImportData,
      presetName: presetName
    });

    if (response.success) {
      showNotification(`Successfully imported ${window.csvImportData.length} participants!`, 'success');
      closeCsvImportModal();
      await loadParticipantPresets(); // Refresh list
    } else {
      throw new Error(response.error || 'Import failed');
    }

  } catch (error) {
    console.error('[Participants] Error importing CSV:', error);
    showNotification('Error importing CSV: ' + error.message, 'error');
  } finally {
    // Re-enable import button
    const importBtn = document.getElementById('import-csv-btn');
    importBtn.disabled = false;
    importBtn.innerHTML = '<span class="btn-icon">📥</span>Import';
  }
}

/**
 * Use preset in analysis (placeholder for integration)
 */
async function usePreset(presetId) {
  try {
    // Get preset details
    const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);
    if (!response.success || !response.data) {
      throw new Error('Failed to load preset details');
    }

    const preset = response.data;

    // Save selected preset to localStorage
    // Note: localStorage persistence removed - presets are selected fresh each time

    // Update last used timestamp
    await window.api.invoke('supabase-update-preset-last-used', presetId);

    showNotification(`Preset "${preset.name}" selected for analysis!`, 'success');

    // Refresh to update "last used" timestamp
    await loadParticipantPresets();

    // Notify other components that preset selection changed
    window.dispatchEvent(new CustomEvent('presetSelected', {
      detail: {
        presetId: preset.id,
        presetName: preset.name,
        participants: preset.participants || []
      }
    }));

  } catch (error) {
    console.error('[Participants] Error using preset:', error);
    showNotification('Error selecting preset', 'error');
  }
}

/**
 * Get currently selected preset from localStorage
 */
function getSelectedPreset() {
  // Note: localStorage persistence removed - presets are selected fresh each time
  return null;
}

/**
 * Clear selected preset
 */
function clearSelectedPreset() {
  // Note: localStorage persistence removed - presets are selected fresh each time

  // Notify other components that preset selection was cleared
  window.dispatchEvent(new CustomEvent('presetCleared'));
}

/**
 * Navigate to participants section (from home page)
 */
function navigateToParticipants() {
  // Simulate navigation (this would be handled by main navigation system)
  console.log('[Participants] Navigate to participants section');
  showNotification('Participants management opened!', 'info');
}

// Helper functions

/**
 * Read file as text
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = e => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Simple CSV parser
 */
function parseCSV(csvText) {
  const lines = csvText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return [];

  // Parse headers
  const headers = parseCSVLine(lines[0]);
  const data = [];

  // Field mapping from English to database field names
  const fieldMapping = {
    'Number': 'numero',
    'Driver': 'nome',
    'Navigator': 'navigatore',
    'Team': 'squadra',
    'Sponsors': 'sponsor',
    'Metatag': 'metatag'
  };

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        const dbField = fieldMapping[header] || header.toLowerCase();
        row[dbField] = values[index] || '';
      });
      data.push(row);
    }
  }

  return data;
}

// Helper function to parse a CSV line with proper quote handling
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // Handle escaped quotes
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Push the last value
  values.push(current.trim());

  return values;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format date
 */
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

/**
 * Show notification (placeholder - should use existing notification system)
 */
function showNotification(message, type = 'info') {
  console.log(`[Notification ${type.toUpperCase()}]`, message);
  // TODO: Integrate with existing notification system
  alert(`${type.toUpperCase()}: ${message}`);
}

/**
 * Show confirm dialog
 */
function showConfirmDialog(title, message) {
  // TODO: Use better modal dialog
  return Promise.resolve(confirm(`${title}\n\n${message}`));
}

/**
 * Download CSV template with correct column headers
 */
function downloadCsvTemplate() {
  const headers = ['Number', 'Driver', 'Navigator', 'Team', 'Sponsors', 'Metatag'];
  const sampleData = [
    ['1', 'John Doe', 'Jane Smith', 'Racing Team A', 'Sponsor Corp', 'tag1'],
    ['2', 'Mike Johnson', 'Sarah Wilson', 'Speed Team', 'Brand X', 'tag2'],
    ['3', '"Balthasar, Ponzo, Roe"', '', 'Imperiale Racing', '"elea costruzioni, topcon"', 'CIGT - 3']
  ];

  // Create CSV content
  const csvContent = [
    headers.join(','),
    ...sampleData.map(row => row.join(','))
  ].join('\n');

  // Create download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'participants-template.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showNotification('CSV template downloaded successfully', 'success');
}

// Export functions for HTML onclick handlers immediately
window.createNewPreset = createNewPreset;
window.editPreset = editPreset;
window.deletePreset = deletePreset;
window.usePreset = usePreset;
window.savePreset = savePreset;
window.closePresetEditor = closePresetEditor;
window.openCsvImportModal = openCsvImportModal;
window.closeCsvImportModal = closeCsvImportModal;
window.addParticipantRow = addParticipantRow;
window.removeParticipantRow = removeParticipantRow;
window.clearAllParticipants = clearAllParticipants;
window.previewCsvFile = previewCsvFile;
window.importCsvPreset = importCsvPreset;
window.navigateToParticipants = navigateToParticipants;
window.downloadCsvTemplate = downloadCsvTemplate;

// Export utility functions for preset management
window.getSelectedPreset = getSelectedPreset;
window.clearSelectedPreset = clearSelectedPreset;

console.log('🔧 [DEBUG] Functions exported to window:', {
  createNewPreset: window.createNewPreset,
  openCsvImportModal: window.openCsvImportModal
});

// Initialize participants manager when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Participants] DOM loaded, initializing participants manager...');

  // Always initialize the participants manager so functions are available
  // even when accessed from other sections (like home page buttons)
  initParticipantsManager();
});

// Initialize when navigating to participants section
document.addEventListener('section-changed', function(event) {
  if (event.detail && event.detail.section === 'participants') {
    console.log('[Participants] Section changed to participants, initializing...');
    initParticipantsManager();
  }
});

// Also initialize when participants section becomes visible
const participantsSectionObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const participantsSection = document.getElementById('section-participants');
      if (participantsSection && participantsSection.classList.contains('active-section')) {
        console.log('[Participants] Participants section became active, initializing...');
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          initParticipantsManager();
        }, 100);
      }
    }
  });
});

// Start observing the participants section when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  const participantsSection = document.getElementById('section-participants');
  if (participantsSection) {
    console.log('[Participants] Setting up section observer...');
    participantsSectionObserver.observe(participantsSection, {
      attributes: true,
      attributeFilter: ['class']
    });
  }
});