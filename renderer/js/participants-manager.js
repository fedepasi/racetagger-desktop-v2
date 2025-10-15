/**
 * Participants Manager
 * Handles participant preset creation, editing, and management
 */

console.log('🔧 [DEBUG] participants-manager.js is loading...');

var currentPreset = null;
var participantsData = [];
var isEditingPreset = false;
var customFolders = []; // Array di nomi folder personalizzate
var editingRowIndex = -1; // -1 = new participant, >=0 = editing existing

console.log('🔧 [DEBUG] Variables declared:', { currentPreset, participantsData, isEditingPreset, customFolders });

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
  document.getElementById('import-json-preset-btn')?.addEventListener('click', openJsonImportModal);

  // Folder name input - Enter key support and autocomplete
  const folderNameInput = document.getElementById('folder-name-input');
  if (folderNameInput) {
    folderNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmAddFolder();
      }
    });

    // Setup keyword autocomplete
    setupKeywordAutocomplete();
  }

  // Modal close handlers
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      closeAllModals();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
      // Also close any open dropdowns
      document.querySelectorAll('.export-dropdown.open').forEach(dropdown => {
        dropdown.classList.remove('open');
      });
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    // Check if click is outside any dropdown
    if (!e.target.closest('.export-dropdown')) {
      document.querySelectorAll('.export-dropdown.open').forEach(dropdown => {
        dropdown.classList.remove('open');
      });
    }
  });
}

/**
 * Keyword Autocomplete System
 */
const KEYWORDS = [
  { keyword: '{number}', description: 'Race number' },
  { keyword: '{name}', description: 'Driver name' },
  { keyword: '{team}', description: 'Team name' },
  { keyword: '{category}', description: 'Category' },
  { keyword: '{tag}', description: 'Custom tag' }
];

let selectedKeywordIndex = -1;

/**
 * Setup keyword autocomplete for folder name input
 */
function setupKeywordAutocomplete() {
  const input = document.getElementById('folder-name-input');
  const dropdown = document.getElementById('keyword-dropdown');

  if (!input || !dropdown) {
    console.warn('[Autocomplete] Input or dropdown element not found');
    return;
  }

  // Show dropdown when user types '{'
  input.addEventListener('input', (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;

    // Check if user just typed '{'
    if (value[cursorPos - 1] === '{') {
      showKeywordDropdown();
    } else {
      hideKeywordDropdown();
    }
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    if (dropdown.style.display === 'none') return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedKeywordIndex = Math.min(selectedKeywordIndex + 1, KEYWORDS.length - 1);
        updateKeywordSelection();
        break;

      case 'ArrowUp':
        e.preventDefault();
        selectedKeywordIndex = Math.max(selectedKeywordIndex - 1, 0);
        updateKeywordSelection();
        break;

      case 'Enter':
      case 'Tab':
        if (selectedKeywordIndex >= 0) {
          e.preventDefault();
          insertKeywordAtCursor(KEYWORDS[selectedKeywordIndex].keyword);
          hideKeywordDropdown();
        }
        break;

      case 'Escape':
        e.preventDefault();
        hideKeywordDropdown();
        break;
    }
  });

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      hideKeywordDropdown();
    }
  });
}

/**
 * Show keyword autocomplete dropdown
 */
function showKeywordDropdown() {
  const dropdown = document.getElementById('keyword-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '';
  selectedKeywordIndex = 0;

  KEYWORDS.forEach((item, index) => {
    const option = document.createElement('div');
    option.className = 'keyword-option';
    if (index === 0) option.classList.add('selected');

    option.innerHTML = `
      <span class="keyword-option-keyword">${escapeHtml(item.keyword)}</span>
      <span class="keyword-option-description">${escapeHtml(item.description)}</span>
    `;

    option.addEventListener('click', () => {
      insertKeywordAtCursor(item.keyword);
      hideKeywordDropdown();
    });

    option.addEventListener('mouseenter', () => {
      selectedKeywordIndex = index;
      updateKeywordSelection();
    });

    dropdown.appendChild(option);
  });

  dropdown.style.display = 'block';
}

/**
 * Hide keyword autocomplete dropdown
 */
function hideKeywordDropdown() {
  const dropdown = document.getElementById('keyword-dropdown');
  if (!dropdown) return;

  dropdown.style.display = 'none';
  selectedKeywordIndex = -1;
}

/**
 * Update visual selection in dropdown
 */
function updateKeywordSelection() {
  const dropdown = document.getElementById('keyword-dropdown');
  if (!dropdown) return;

  const options = dropdown.querySelectorAll('.keyword-option');
  options.forEach((option, index) => {
    if (index === selectedKeywordIndex) {
      option.classList.add('selected');
      option.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      option.classList.remove('selected');
    }
  });
}

/**
 * Insert keyword at cursor position in input
 */
function insertKeywordAtCursor(keyword) {
  const input = document.getElementById('folder-name-input');
  if (!input) return;

  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;

  // Find the position of the last '{' before cursor
  let bracketPos = start - 1;
  while (bracketPos >= 0 && value[bracketPos] !== '{') {
    bracketPos--;
  }

  if (bracketPos >= 0) {
    // Replace from '{' to cursor with the keyword
    const newValue = value.substring(0, bracketPos) + keyword + value.substring(end);
    input.value = newValue;

    // Set cursor position after the inserted keyword
    const newCursorPos = bracketPos + keyword.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
  }

  input.focus();
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
  console.log('[DEBUG] 🎴 Creating preset card for ID:', preset.id, 'Name:', preset.name);
  const card = document.createElement('div');
  card.className = 'preset-card';
  card.innerHTML = `
    <div class="preset-header">
      <div class="preset-title">${escapeHtml(preset.name)}</div>
      <div class="preset-actions">
        <div class="export-dropdown" data-preset-id="${preset.id}">
          <button class="btn btn-sm btn-secondary dropdown-toggle" title="Export preset">
            <span class="btn-icon">📥</span>
          </button>
          <div class="dropdown-menu">
            <button class="dropdown-item" data-action="csv">
              <span class="item-icon">📄</span>
              <div class="item-content">
                <span class="item-title">Export as CSV</span>
                <small class="item-description">For editing in Excel/Sheets</small>
              </div>
            </button>
            <button class="dropdown-item" data-action="json">
              <span class="item-icon">💾</span>
              <div class="item-content">
                <span class="item-title">Export Complete (JSON)</span>
                <small class="item-description">Full backup with settings</small>
              </div>
            </button>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="console.log('[DEBUG] ✏️ Edit button CLICKED for preset:', '${preset.id}'); editPreset('${preset.id}')" title="Edit">
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

  // Add dropdown toggle functionality
  const dropdown = card.querySelector('.export-dropdown');
  const toggleBtn = dropdown.querySelector('.dropdown-toggle');
  const dropdownItems = dropdown.querySelectorAll('.dropdown-item');

  // Toggle dropdown on button click
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    // Close all other dropdowns first
    document.querySelectorAll('.export-dropdown.open').forEach(other => {
      if (other !== dropdown) {
        other.classList.remove('open');
      }
    });

    // Toggle this dropdown
    dropdown.classList.toggle('open');
  });

  // Handle dropdown item clicks
  dropdownItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.getAttribute('data-action');
      const presetId = dropdown.getAttribute('data-preset-id');

      // Close dropdown
      dropdown.classList.remove('open');

      // Execute action
      if (action === 'csv') {
        exportPresetCSV(presetId);
      } else if (action === 'json') {
        exportPresetJSON(presetId);
      }
    });
  });

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
  customFolders = [];

  // Reset form
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-description').value = '';
  document.getElementById('preset-editor-title').textContent = 'New Participant Preset';

  // Clear custom folders
  clearCustomFolders();

  // Clear participants table
  clearParticipantsTable();
  addParticipantRow(); // Add one empty row

  // Show modal
  const modal = document.getElementById('preset-editor-modal');
  modal.classList.add('show');
}

/**
 * Add a custom folder - Opens modal for input
 */
function addCustomFolder() {
  // Clear previous input
  document.getElementById('folder-name-input').value = '';

  // Show modal
  const modal = document.getElementById('folder-name-modal');
  modal.classList.add('show');

  // Re-setup autocomplete in case elements were recreated
  setupKeywordAutocomplete();

  // Focus input
  setTimeout(() => {
    document.getElementById('folder-name-input').focus();
  }, 100);
}

/**
 * Close folder name modal
 */
function closeFolderNameModal() {
  const modal = document.getElementById('folder-name-modal');
  modal.classList.remove('show');
  document.getElementById('folder-name-input').value = '';

  // Hide dropdown when closing modal
  hideKeywordDropdown();
}

/**
 * Confirm and add folder
 */
function confirmAddFolder() {
  const folderNameInput = document.getElementById('folder-name-input');
  const folderName = folderNameInput.value.trim();

  if (!folderName) {
    alert('Please enter a folder name');
    folderNameInput.focus();
    return;
  }

  // Check for duplicates
  if (customFolders.includes(folderName)) {
    alert('A folder with this name already exists');
    folderNameInput.focus();
    return;
  }

  // Add folder
  customFolders.push(folderName);
  renderCustomFolders();
  updateFolderSelects();

  // Close modal
  closeFolderNameModal();
}

/**
 * Open participant edit modal
 * @param {number} rowIndex - Index in participantsData array (-1 for new participant)
 */
function openParticipantEditModal(rowIndex = -1) {
  editingRowIndex = rowIndex;

  const title = rowIndex === -1 ? 'Add Participant' : 'Edit Participant';
  document.getElementById('participant-edit-title').textContent = title;

  if (rowIndex >= 0 && participantsData[rowIndex]) {
    // Edit mode: populate form with existing data
    const participant = participantsData[rowIndex];
    document.getElementById('edit-numero').value = participant.numero || '';
    document.getElementById('edit-nome').value = participant.nome || participant.nome_pilota || '';
    document.getElementById('edit-categoria').value = participant.categoria || '';
    document.getElementById('edit-squadra').value = participant.squadra || '';
    document.getElementById('edit-plate-number').value = participant.plate_number || '';
    document.getElementById('edit-sponsor').value = participant.sponsor || '';
    document.getElementById('edit-metatag').value = participant.metatag || '';

    // Populate folder selects
    populateFolderSelects();
    document.getElementById('edit-folder-1').value = participant.folder_1 || '';
    document.getElementById('edit-folder-2').value = participant.folder_2 || '';
    document.getElementById('edit-folder-3').value = participant.folder_3 || '';
  } else {
    // Create mode: clear all fields
    document.getElementById('edit-numero').value = '';
    document.getElementById('edit-nome').value = '';
    document.getElementById('edit-categoria').value = '';
    document.getElementById('edit-squadra').value = '';
    document.getElementById('edit-plate-number').value = '';
    document.getElementById('edit-sponsor').value = '';
    document.getElementById('edit-metatag').value = '';

    populateFolderSelects();
    document.getElementById('edit-folder-1').value = '';
    document.getElementById('edit-folder-2').value = '';
    document.getElementById('edit-folder-3').value = '';
  }

  // Show modal
  document.getElementById('participant-edit-modal').classList.add('show');

  // Focus first field
  setTimeout(() => {
    document.getElementById('edit-numero').focus();
  }, 100);
}

/**
 * Close participant edit modal
 */
function closeParticipantEditModal() {
  document.getElementById('participant-edit-modal').classList.remove('show');
  editingRowIndex = -1;
}

/**
 * Populate folder select dropdowns in edit modal
 */
function populateFolderSelects() {
  const selects = [
    document.getElementById('edit-folder-1'),
    document.getElementById('edit-folder-2'),
    document.getElementById('edit-folder-3')
  ];

  selects.forEach((select, index) => {
    if (!select) return;

    select.innerHTML = `<option value="">Folder ${index + 1}: None</option>`;
    customFolders.forEach(folderName => {
      const option = document.createElement('option');
      option.value = folderName;
      option.textContent = folderName;
      select.appendChild(option);
    });
  });
}

/**
 * Save participant edit
 */
function saveParticipantEdit() {
  const numero = document.getElementById('edit-numero').value.trim();
  if (!numero) {
    alert('Number is required');
    document.getElementById('edit-numero').focus();
    return;
  }

  const nome = document.getElementById('edit-nome').value.trim();
  if (!nome) {
    alert('Driver name is required');
    document.getElementById('edit-nome').focus();
    return;
  }

  const participant = {
    numero,
    nome,
    nome_pilota: nome, // For compatibility
    categoria: document.getElementById('edit-categoria').value.trim(),
    squadra: document.getElementById('edit-squadra').value.trim(),
    plate_number: document.getElementById('edit-plate-number').value.trim().toUpperCase(),
    sponsor: document.getElementById('edit-sponsor').value.trim(),
    metatag: document.getElementById('edit-metatag').value.trim(),
    folder_1: document.getElementById('edit-folder-1').value,
    folder_2: document.getElementById('edit-folder-2').value,
    folder_3: document.getElementById('edit-folder-3').value
  };

  if (editingRowIndex === -1) {
    // Add new participant
    participantsData.push(participant);
  } else {
    // Update existing participant
    participantsData[editingRowIndex] = participant;
  }

  // Refresh table display
  loadParticipantsIntoTable(participantsData);

  closeParticipantEditModal();
}

/**
 * Remove a custom folder
 */
function removeCustomFolder(folderName) {
  const index = customFolders.indexOf(folderName);
  if (index > -1) {
    customFolders.splice(index, 1);
    renderCustomFolders();
    updateFolderSelects();
  }
}

/**
 * Edit a custom folder name
 */
let editingFolderIndex = -1;

function editCustomFolder(index) {
  if (index < 0 || index >= customFolders.length) {
    return;
  }

  editingFolderIndex = index;
  const oldFolderName = customFolders[index];

  // Open modal and populate with current name
  document.getElementById('edit-folder-name-input').value = oldFolderName;
  document.getElementById('edit-folder-modal').classList.add('show');

  // Focus on input
  setTimeout(() => {
    const input = document.getElementById('edit-folder-name-input');
    input.focus();
    input.select();
  }, 100);
}

function closeEditFolderModal() {
  document.getElementById('edit-folder-modal').classList.remove('show');
  editingFolderIndex = -1;
}

function saveEditedFolderName() {
  if (editingFolderIndex < 0 || editingFolderIndex >= customFolders.length) {
    return;
  }

  const newFolderName = document.getElementById('edit-folder-name-input').value.trim();

  if (!newFolderName) {
    alert('Folder name cannot be empty!');
    document.getElementById('edit-folder-name-input').focus();
    return;
  }

  const oldFolderName = customFolders[editingFolderIndex];

  // Check if the new name already exists (and it's not the same folder)
  if (customFolders.includes(newFolderName) && newFolderName !== oldFolderName) {
    alert('A folder with this name already exists!');
    document.getElementById('edit-folder-name-input').focus();
    return;
  }

  // Update folder name
  customFolders[editingFolderIndex] = newFolderName;

  // Update all participants that have this folder assigned
  participantsData.forEach(participant => {
    if (participant.folder_1 === oldFolderName) {
      participant.folder_1 = newFolderName;
    }
    if (participant.folder_2 === oldFolderName) {
      participant.folder_2 = newFolderName;
    }
    if (participant.folder_3 === oldFolderName) {
      participant.folder_3 = newFolderName;
    }
  });

  // Re-render everything
  renderCustomFolders();
  updateFolderSelects();
  loadParticipantsIntoTable(participantsData);

  // Close modal
  closeEditFolderModal();
}

/**
 * Render custom folders list
 */
function renderCustomFolders() {
  const foldersList = document.getElementById('custom-folders-list');
  const emptyMessage = document.getElementById('empty-folders-message');

  if (customFolders.length === 0) {
    if (emptyMessage) {
      emptyMessage.style.display = 'block';
    }
    // Clear folder chips
    const existingChips = foldersList.querySelectorAll('.folder-chip');
    existingChips.forEach(chip => chip.remove());
    return;
  }

  if (emptyMessage) {
    emptyMessage.style.display = 'none';
  }

  // Clear existing chips
  const existingChips = foldersList.querySelectorAll('.folder-chip');
  existingChips.forEach(chip => chip.remove());

  // Add folder chips
  customFolders.forEach((folderName, index) => {
    const chip = document.createElement('div');
    chip.className = 'folder-chip';
    chip.innerHTML = `
      <span class="folder-chip-name">📁 ${escapeHtml(folderName)}</span>
      <button type="button" class="folder-chip-edit" onclick="editCustomFolder(${index})" title="Edit folder">
        ✏️
      </button>
      <button type="button" class="folder-chip-remove" onclick="removeCustomFolder('${escapeHtml(folderName)}')" title="Remove folder">
        ×
      </button>
    `;
    foldersList.appendChild(chip);
  });
}

/**
 * Clear all custom folders
 */
function clearCustomFolders() {
  customFolders = [];
  renderCustomFolders();
  updateFolderSelects();
}

/**
 * Update folder selects in participants table
 */
function updateFolderSelects() {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    const folderSelects = row.querySelectorAll('select[data-field^="folder_"]');
    folderSelects.forEach(select => {
      const currentValue = select.value;

      // Rebuild options
      select.innerHTML = '<option value="">-- None --</option>';
      customFolders.forEach(folderName => {
        const option = document.createElement('option');
        option.value = folderName;
        option.textContent = folderName;
        if (currentValue === folderName) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    });
  });
}

/**
 * Edit existing preset
 */
async function editPreset(presetId) {
  console.log('[DEBUG] 🔍 editPreset CALLED! presetId:', presetId);
  console.log('[DEBUG] 🔍 window.editPreset type:', typeof window.editPreset);
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

    // Load custom folders from preset
    customFolders = currentPreset.custom_folders || [];
    renderCustomFolders();

    // Fill form with preset data
    document.getElementById('preset-name').value = currentPreset.name || '';
    document.getElementById('preset-description').value = currentPreset.description || '';
    document.getElementById('preset-editor-title').textContent = 'Edit Participant Preset';

    // Load participants into table
    loadParticipantsIntoTable(participantsData);

    // Show modal
    const modal = document.getElementById('preset-editor-modal');
    console.log('[DEBUG] 🎭 Modal element found:', modal ? 'YES' : 'NO');
    if (!modal) {
      console.error('[DEBUG] ❌ Modal element not found in DOM!');
      return;
    }
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
 * Export complete preset as JSON file (full backup with all settings, English field names)
 */
async function exportPresetJSON(presetId) {
  try {
    console.log('[Participants] Exporting preset as JSON:', presetId);

    // Fetch the complete preset data
    const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);
    if (!response.success || !response.data) {
      showNotification('Error loading preset: ' + (response.error || 'Unknown error'), 'error');
      return;
    }

    const preset = response.data;

    // Prepare export data with English field names
    const exportData = {
      name: preset.name,
      description: preset.description,
      category: preset.category,
      participants: (preset.participants || []).map(p => ({
        number: p.numero,
        driver: p.nome || p.nome_pilota,
        team: p.squadra,
        category: p.categoria,
        plate_number: p.plate_number,
        sponsors: p.sponsor,
        metatag: p.metatag,
        folder_1: p.folder_1,
        folder_2: p.folder_2,
        folder_3: p.folder_3
      })),
      custom_folders: preset.custom_folders || [],
      exported_at: new Date().toISOString(),
      version: '1.0'
    };

    // Convert to JSON
    const jsonString = JSON.stringify(exportData, null, 2);

    // Generate filename
    const sanitizedName = preset.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const defaultFilename = `preset_${sanitizedName}.json`;

    // Ask user where to save
    const saveResult = await window.api.invoke('show-save-dialog', {
      title: 'Export Complete Preset (JSON)',
      defaultPath: defaultFilename,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      console.log('[Participants] Export canceled by user');
      return;
    }

    // Write file
    const writeResult = await window.api.invoke('write-file', {
      path: saveResult.filePath,
      content: jsonString
    });

    if (writeResult.success) {
      showNotification(`Complete preset exported to ${saveResult.filePath}`, 'success');
    } else {
      showNotification('Error writing file: ' + (writeResult.error || 'Unknown error'), 'error');
    }

  } catch (error) {
    console.error('[Participants] Error exporting preset as JSON:', error);
    showNotification('Error exporting preset', 'error');
  }
}

/**
 * Export preset as CSV file (participants only, English column names)
 */
async function exportPresetCSV(presetId) {
  try {
    console.log('[Participants] Exporting preset as CSV:', presetId);

    // Fetch the complete preset data
    const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);
    if (!response.success || !response.data) {
      showNotification('Error loading preset: ' + (response.error || 'Unknown error'), 'error');
      return;
    }

    const preset = response.data;
    const participants = preset.participants || [];

    if (participants.length === 0) {
      showNotification('Preset has no participants to export', 'warning');
      return;
    }

    // CSV Header (English column names)
    const csvHeader = 'Number,Driver,Team,Category,Plate_Number,Sponsors,Metatag,Folder_1,Folder_2,Folder_3';

    // Convert participants to CSV rows
    const csvRows = participants.map(p => {
      // Helper to escape CSV values
      const escapeCSV = (value) => {
        if (!value) return '';
        const str = String(value);
        // If value contains comma, quote, or newline, wrap in quotes and escape quotes
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      return [
        escapeCSV(p.numero || ''),
        escapeCSV(p.nome || p.nome_pilota || ''),
        escapeCSV(p.squadra || ''),
        escapeCSV(p.categoria || ''),
        escapeCSV(p.plate_number || ''),
        escapeCSV(p.sponsor || ''),
        escapeCSV(p.metatag || ''),
        escapeCSV(p.folder_1 || ''),
        escapeCSV(p.folder_2 || ''),
        escapeCSV(p.folder_3 || '')
      ].join(',');
    });

    // Combine header and rows
    const csvContent = [csvHeader, ...csvRows].join('\n');

    // Generate filename
    const sanitizedName = preset.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const defaultFilename = `preset_${sanitizedName}.csv`;

    // Ask user where to save
    const saveResult = await window.api.invoke('show-save-dialog', {
      title: 'Export Preset as CSV',
      defaultPath: defaultFilename,
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      console.log('[Participants] Export canceled by user');
      return;
    }

    // Write file
    const writeResult = await window.api.invoke('write-file', {
      path: saveResult.filePath,
      content: csvContent
    });

    if (writeResult.success) {
      showNotification(`Preset exported as CSV to ${saveResult.filePath}`, 'success');
    } else {
      showNotification('Error writing file: ' + (writeResult.error || 'Unknown error'), 'error');
    }

  } catch (error) {
    console.error('[Participants] Error exporting preset as CSV:', error);
    showNotification('Error exporting preset as CSV', 'error');
  }
}

/**
 * Sort participants by number (ascending order)
 * Handles both numeric and alphanumeric numbers (e.g., "1", "2A", "10", "51")
 */
function sortParticipantsByNumber(participants) {
  return [...participants].sort((a, b) => {
    const numA = a.numero || '';
    const numB = b.numero || '';

    // Try to parse as integers first
    const intA = parseInt(numA, 10);
    const intB = parseInt(numB, 10);

    // If both are valid integers, compare numerically
    if (!isNaN(intA) && !isNaN(intB)) {
      return intA - intB;
    }

    // Otherwise, compare as strings (alphanumeric)
    return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Load participants data into the table
 */
function loadParticipantsIntoTable(participants) {
  clearParticipantsTable();

  if (!participants || participants.length === 0) {
    return; // Empty table
  }

  // Sort participants by number (ascending)
  const sortedParticipants = sortParticipantsByNumber(participants);

  sortedParticipants.forEach((participant, index) => {
    addParticipantRow(participant, index);
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
 * Add a participant row to the table (read-only display)
 * @param {Object} participant - Participant data
 * @param {number} rowIndex - Index in participantsData array
 */
function addParticipantRow(participant, rowIndex) {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) {
    console.error('Cannot find participants-tbody element');
    return;
  }

  const row = document.createElement('tr');

  // Helper function to escape HTML
  const escapeHtml = (str) => {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  const numero = escapeHtml(participant?.numero || '');
  const nome = escapeHtml(participant?.nome || participant?.nome_pilota || '');
  const categoria = participant?.categoria || '';
  const squadra = escapeHtml(participant?.squadra || '');
  const plateNumber = participant?.plate_number || '';

  // Create category badge
  const categoryDisplay = categoria ?
    `<span class="category-badge">${escapeHtml(categoria)}</span>` :
    '<span class="text-muted">-</span>';

  // Create plate badge
  const plateDisplay = plateNumber ?
    `<span class="plate-badge">${escapeHtml(plateNumber)}</span>` :
    '<span class="text-muted">-</span>';

  row.innerHTML = `
    <td><strong>${numero}</strong></td>
    <td>${nome}</td>
    <td>${categoryDisplay}</td>
    <td>${squadra || '<span class="text-muted">-</span>'}</td>
    <td>${plateDisplay}</td>
    <td>
      <button class="btn btn-sm btn-secondary" onclick="openParticipantEditModal(${rowIndex})" title="Edit participant">
        <span class="btn-icon">✏️</span>
      </button>
      <button class="btn btn-sm btn-danger" onclick="removeParticipant(${rowIndex})" title="Delete participant">
        <span class="btn-icon">🗑️</span>
      </button>
    </td>
  `;

  tbody.appendChild(row);
}

/**
 * Remove a participant by index
 * @param {number} rowIndex - Index in participantsData array
 */
function removeParticipant(rowIndex) {
  if (confirm('Remove this participant?')) {
    participantsData.splice(rowIndex, 1);
    loadParticipantsIntoTable(participantsData);
  }
}

/**
 * Remove a participant row (legacy function for compatibility)
 */
function removeParticipantRow(button) {
  const row = button.closest('tr');
  row.remove();
}

/**
 * Clear all participants
 */
function clearAllParticipants() {
  if (participantsData.length > 0) {
    const confirmed = confirm('Are you sure you want to clear all participants?');
    if (confirmed) {
      participantsData = [];
      clearParticipantsTable();
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

    // Use participants data from memory (already updated via modal)
    const participants = participantsData.map(p => ({
      numero: p.numero || '',
      nome: p.nome || p.nome_pilota || '',
      categoria: p.categoria || '',
      squadra: p.squadra || '',
      plate_number: p.plate_number || '',
      sponsor: p.sponsor || '',
      metatag: p.metatag || '',
      folder_1: p.folder_1 || '',
      folder_2: p.folder_2 || '',
      folder_3: p.folder_3 || ''
    }));
    console.log('[Participants] Collected participants:', participants.length, participants);

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
        description: presetDescription,
        custom_folders: customFolders
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
        description: presetDescription,
        custom_folders: customFolders
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
    const selects = row.querySelectorAll('select[data-field]');
    const participant = {};
    let hasData = false;

    // Collect input fields
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

    // Collect folder select fields
    selects.forEach(select => {
      const field = select.dataset.field;
      let value = select.value.trim();

      // Always include the field in the participant object
      participant[field] = value;

      // Folder values are optional, don't count as "hasData"
    });

    console.log('[Participants] Row', index, ':', participant, 'hasData:', hasData);

    // Only add participant if has at least a number or name
    if (hasData && (participant.numero || participant.nome)) {
      participants.push(participant);
      console.log('[Participants] Added participant:', participant);
    }
  });

  console.log('[Participants] Total collected participants:', participants.length);

  // Sort participants by number before returning
  const sortedParticipants = sortParticipantsByNumber(participants);
  console.log('[Participants] Sorted participants by number');

  return sortedParticipants;
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
  closeFolderNameModal();
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
 * Open JSON import modal
 */
function openJsonImportModal() {
  document.getElementById('json-file-input').value = '';
  document.getElementById('json-preview').style.display = 'none';
  document.getElementById('import-json-btn').disabled = true;

  const modal = document.getElementById('json-import-modal');
  modal.classList.add('show');
}

/**
 * Close JSON import modal
 */
function closeJsonImportModal() {
  const modal = document.getElementById('json-import-modal');
  modal.classList.remove('show');
}

/**
 * Preview JSON file content
 */
async function previewJsonFile() {
  const fileInput = document.getElementById('json-file-input');
  const previewDiv = document.getElementById('json-preview');
  const importBtn = document.getElementById('import-json-btn');

  if (!fileInput.files || fileInput.files.length === 0) {
    previewDiv.style.display = 'none';
    importBtn.disabled = true;
    return;
  }

  const file = fileInput.files[0];

  try {
    const jsonText = await readFileAsText(file);
    const presetData = JSON.parse(jsonText);

    // Validate JSON structure
    if (!presetData.name || !presetData.participants || !Array.isArray(presetData.participants)) {
      throw new Error('Invalid preset format. Missing required fields (name, participants).');
    }

    // Store for import
    window.jsonImportData = presetData;

    // Update preview
    document.getElementById('json-preview-name').textContent = presetData.name;
    document.getElementById('json-preview-description').textContent = presetData.description || 'No description';
    document.getElementById('json-preview-participants-count').textContent = presetData.participants.length;

    const folders = presetData.custom_folders && presetData.custom_folders.length > 0
      ? presetData.custom_folders.join(', ')
      : 'None';
    document.getElementById('json-preview-folders').textContent = folders;

    previewDiv.style.display = 'block';
    importBtn.disabled = false;

  } catch (error) {
    console.error('[Participants] Error previewing JSON:', error);
    showNotification('Error reading JSON file: ' + error.message, 'error');
    previewDiv.style.display = 'none';
    importBtn.disabled = true;
  }
}

/**
 * Import preset from JSON file
 */
async function importJsonPreset() {
  try {
    if (!window.jsonImportData) {
      showNotification('No JSON data to import', 'error');
      return;
    }

    const presetData = window.jsonImportData;

    // Disable import button
    const importBtn = document.getElementById('import-json-btn');
    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="btn-icon">⏳</span>Importing...';

    console.log('[Participants] Importing JSON preset:', presetData.name, 'with', presetData.participants.length, 'participants');

    // Map English field names to Italian (database format)
    const participants = presetData.participants.map(p => ({
      numero: p.number || p.numero || '',
      nome: p.driver || p.nome || '',
      categoria: p.category || p.categoria || '',
      squadra: p.team || p.squadra || '',
      plate_number: p.plate_number || '',
      sponsor: p.sponsors || p.sponsor || '',
      metatag: p.metatag || '',
      folder_1: p.folder_1 || '',
      folder_2: p.folder_2 || '',
      folder_3: p.folder_3 || ''
    }));

    // Create preset with Supabase
    const createResponse = await window.api.invoke('supabase-create-participant-preset', {
      name: presetData.name,
      description: presetData.description || '',
      category: presetData.category || 'imported',
      custom_folders: presetData.custom_folders || []
    });

    if (!createResponse.success) {
      throw new Error(createResponse.error || 'Failed to create preset');
    }

    const presetId = createResponse.data.id;

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

    showNotification(`Successfully imported preset "${presetData.name}" with ${participants.length} participants!`, 'success');
    closeJsonImportModal();
    await loadParticipantPresets(); // Refresh list

  } catch (error) {
    console.error('[Participants] Error importing JSON:', error);
    showNotification('Error importing JSON: ' + error.message, 'error');
  } finally {
    // Re-enable import button
    const importBtn = document.getElementById('import-json-btn');
    importBtn.disabled = false;
    importBtn.innerHTML = '<span class="btn-icon">📥</span>Import Preset';
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
    'Team': 'squadra',
    'Category': 'categoria',
    'Plate_Number': 'plate_number',
    'Sponsors': 'sponsor',
    'Metatag': 'metatag',
    'Folder_1': 'folder_1',
    'Folder_2': 'folder_2',
    'Folder_3': 'folder_3'
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
  // Use IPC to show native save dialog and save the CSV template
  window.api.send('download-csv-template');
}

// Export functions for HTML onclick handlers immediately
window.createNewPreset = createNewPreset;
window.editPreset = editPreset;
window.deletePreset = deletePreset;
window.exportPresetJSON = exportPresetJSON;
window.exportPresetCSV = exportPresetCSV;
window.usePreset = usePreset;
window.savePreset = savePreset;
window.closePresetEditor = closePresetEditor;
window.openCsvImportModal = openCsvImportModal;
window.closeCsvImportModal = closeCsvImportModal;
window.openJsonImportModal = openJsonImportModal;
window.closeJsonImportModal = closeJsonImportModal;
window.previewJsonFile = previewJsonFile;
window.importJsonPreset = importJsonPreset;
window.addParticipantRow = addParticipantRow;
window.removeParticipantRow = removeParticipantRow;
window.clearAllParticipants = clearAllParticipants;
window.previewCsvFile = previewCsvFile;
window.importCsvPreset = importCsvPreset;
window.navigateToParticipants = navigateToParticipants;
window.downloadCsvTemplate = downloadCsvTemplate;
window.addCustomFolder = addCustomFolder;
window.removeCustomFolder = removeCustomFolder;
window.closeFolderNameModal = closeFolderNameModal;
window.confirmAddFolder = confirmAddFolder;
window.openParticipantEditModal = openParticipantEditModal;
window.closeParticipantEditModal = closeParticipantEditModal;
window.saveParticipantEdit = saveParticipantEdit;
window.removeParticipant = removeParticipant;

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

  // Listen for CSV template saved event
  window.api.receive('csv-template-saved', (filePath) => {
    console.log('[Participants] CSV template saved to:', filePath);
    showNotification('CSV template saved successfully', 'success');
  });
});