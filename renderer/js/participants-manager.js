/**
 * Participants Manager
 * Handles participant preset creation, editing, and management
 */

var currentPreset = null;
var participantsData = [];
var isEditingPreset = false;
var customFolders = []; // Array of folder objects: [{name, path}, ...] or legacy strings
var editingRowIndex = -1; // -1 = new participant, >=0 = editing existing
var currentSortColumn = 0; // Colonna corrente di ordinamento (0 = numero)
var currentSortDirection = 'asc'; // Direzione: 'asc' o 'desc'
var editDriversTags = []; // Array of driver names for tag input
var cachedSportCategories = []; // Cached sport categories for dropdown

/**
 * Initialize participants manager
 */
async function initParticipantsManager() {
  // Setup event listeners
  setupEventListeners();

  // Initialize face manager if available
  if (typeof presetFaceManager !== 'undefined' && presetFaceManager.initialize) {
    presetFaceManager.initialize();
  }

  // Load sport categories for dropdown
  await loadSportCategoriesForDropdown();

  // Load existing presets
  await loadParticipantPresets();
}

/**
 * Load sport categories into the preset editor dropdown
 */
async function loadSportCategoriesForDropdown() {
  try {
    const response = await window.api.invoke('supabase-get-sport-categories');
    if (response.success && response.data) {
      cachedSportCategories = response.data;
      console.log('[Participants] Loaded', cachedSportCategories.length, 'sport categories');
    }
  } catch (error) {
    console.error('[Participants] Error loading sport categories:', error);
  }
}

/**
 * Populate sport category dropdown with cached categories
 * @param {string|null} selectedCategoryId - ID to pre-select
 */
function populateSportCategoryDropdown(selectedCategoryId = null) {
  const dropdown = document.getElementById('preset-sport-category');
  if (!dropdown) return;

  // Clear existing options except placeholder
  dropdown.innerHTML = '<option value="">Select a sport category...</option>';

  // Add categories
  cachedSportCategories.forEach(category => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    if (selectedCategoryId && category.id === selectedCategoryId) {
      option.selected = true;
    }
    dropdown.appendChild(option);
  });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Main buttons
  document.getElementById('create-new-preset-btn')?.addEventListener('click', createNewPreset);
  document.getElementById('import-csv-preset-btn')?.addEventListener('click', openCsvImportModal);
  document.getElementById('import-json-preset-btn')?.addEventListener('click', openJsonImportModal);

  // Setup PDF drop zone
  setupPdfDropZone();

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
 * Normalize custom folders from legacy string[] to new format {name, path}[]
 * Ensures backward compatibility
 */
function normalizeFolders(folders) {
  if (!folders || folders.length === 0) return [];

  // Check if already in new format
  if (typeof folders[0] === 'object' && folders[0].hasOwnProperty('name')) {
    return folders;
  }

  // Convert legacy string[] to new format
  return folders.map(name => ({ name, path: '' }));
}

/**
 * Get folder name from folder object (handles both legacy and new format)
 */
function getFolderName(folder) {
  return typeof folder === 'string' ? folder : folder.name;
}

/**
 * Get folder path from folder object (new format only)
 */
function getFolderPath(folder) {
  return typeof folder === 'object' && folder.path ? folder.path : '';
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
 * Browse for folder path (Add Folder modal)
 */
async function browseFolderPath() {
  try {
    const result = await window.api.invoke('file-select-folder');
    if (result.success && result.path) {
      document.getElementById('folder-path-input').value = result.path;
    }
  } catch (error) {
    console.error('[Participants] Error browsing folder:', error);
  }
}

/**
 * Browse for folder path (Edit Folder modal)
 */
async function browseEditFolderPath() {
  try {
    const result = await window.api.invoke('file-select-folder');
    if (result.success && result.path) {
      document.getElementById('edit-folder-path-input').value = result.path;
    }
  } catch (error) {
    console.error('[Participants] Error browsing folder:', error);
  }
}

/**
 * Setup keyword autocomplete for folder name input
 */
function setupKeywordAutocomplete() {
  const input = document.getElementById('folder-name-input');
  const dropdown = document.getElementById('keyword-dropdown');

  if (!input || !dropdown) {
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
    // Check if user is admin
    const isAdmin = await window.api.invoke('auth-is-admin');

    // Use appropriate endpoint based on admin status
    const channelName = isAdmin
      ? 'supabase-get-all-participant-presets-admin'
      : 'supabase-get-participant-presets';

    const response = await window.api.invoke(channelName);
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
 * Separates official presets from user presets for better organization
 */
function displayParticipantPresets(presets) {
  const container = document.getElementById('presets-list-container');
  const emptyState = document.getElementById('empty-presets-state');

  // Guard: page not loaded yet (dynamic routing)
  if (!container) {
    return;
  }

  if (!presets || presets.length === 0) {
    showEmptyPresetsState();
    return;
  }

  // Hide empty state if it exists
  if (emptyState) {
    emptyState.style.display = 'none';
  }

  // Separate official presets from user presets
  const officialPresets = presets.filter(p => p.is_official === true);
  const userPresets = presets.filter(p => p.is_official !== true);

  // Clear container
  container.innerHTML = '';

  // Display official presets section if there are any
  if (officialPresets.length > 0) {
    const officialSection = document.createElement('div');
    officialSection.className = 'presets-section official-presets-section';
    officialSection.innerHTML = `
      <div class="section-header">
        <h3 class="section-title">
          <span class="official-badge-title">Official RT Presets</span>
        </h3>
        <p class="section-description">Curated presets maintained by RaceTagger. Duplicate to customize.</p>
      </div>
    `;

    const officialGrid = document.createElement('div');
    officialGrid.className = 'presets-grid';
    officialPresets.forEach(preset => {
      const presetCard = createPresetCard(preset);
      officialGrid.appendChild(presetCard);
    });
    officialSection.appendChild(officialGrid);
    container.appendChild(officialSection);
  }

  // Display user presets section
  if (userPresets.length > 0) {
    const userSection = document.createElement('div');
    userSection.className = 'presets-section user-presets-section';
    userSection.innerHTML = `
      <div class="section-header">
        <h3 class="section-title">My Presets</h3>
      </div>
    `;

    const userGrid = document.createElement('div');
    userGrid.className = 'presets-grid';
    userPresets.forEach(preset => {
      const presetCard = createPresetCard(preset);
      userGrid.appendChild(presetCard);
    });
    userSection.appendChild(userGrid);
    container.appendChild(userSection);
  } else if (officialPresets.length > 0) {
    // Show message about creating first preset if only official presets exist
    const userSection = document.createElement('div');
    userSection.className = 'presets-section user-presets-section';
    userSection.innerHTML = `
      <div class="section-header">
        <h3 class="section-title">My Presets</h3>
        <p class="section-description">No personal presets yet. Create your own or duplicate an official preset above.</p>
      </div>
    `;
    container.appendChild(userSection);
  }
}

/**
 * Create a preset card element
 */
function createPresetCard(preset) {
  const card = document.createElement('div');
  const isOfficial = preset.is_official === true;
  card.className = `preset-card${isOfficial ? ' official-preset-card' : ''}`;

  // Generate different actions based on whether preset is official or user-owned
  let actionsHtml;
  if (isOfficial) {
    // Official presets: only allow duplicate and view (no edit/delete)
    actionsHtml = `
      <button class="btn btn-sm btn-primary" onclick="duplicateOfficialPreset('${preset.id}')" title="Duplicate to My Presets">
        <span class="btn-icon">📋</span> Duplicate
      </button>
    `;
  } else {
    // User presets: full edit/delete/export capabilities
    actionsHtml = `
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
      <button class="btn btn-sm btn-secondary" onclick="editPreset('${preset.id}')" title="Edit">
        <span class="btn-icon">✏️</span>
      </button>
      <button class="btn btn-sm btn-danger" onclick="deletePreset('${preset.id}')" title="Delete">
        <span class="btn-icon">🗑️</span>
      </button>
    `;
  }

  card.innerHTML = `
    <div class="preset-header">
      <div class="preset-title">
        ${isOfficial ? '<span class="official-badge" title="Official RT Preset">RT</span>' : ''}
        ${escapeHtml(preset.name)}
      </div>
      <div class="preset-actions">
        ${actionsHtml}
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
      ${!isOfficial && preset.last_used_at ? `
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

  // Add dropdown toggle functionality (only for non-official presets)
  const dropdown = card.querySelector('.export-dropdown');
  if (dropdown) {
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
  }

  return card;
}

/**
 * Show empty presets state
 */
function showEmptyPresetsState() {
  const container = document.getElementById('presets-list-container');
  let emptyState = document.getElementById('empty-presets-state');

  // Guard: page not loaded yet (dynamic routing)
  if (!container) {
    return;
  }

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
  currentPreset = null;
  isEditingPreset = false;
  participantsData = [];
  customFolders = [];

  // Reset form
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-description').value = '';
  document.getElementById('preset-editor-title').textContent = 'New Participant Preset';

  // Populate sport category dropdown (no selection)
  populateSportCategoryDropdown(null);

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

  const pathInput = document.getElementById('folder-path-input');
  if (pathInput) {
    pathInput.value = '';
  }

  // Hide dropdown when closing modal
  hideKeywordDropdown();
}

/**
 * Confirm and add folder
 */
function confirmAddFolder() {
  const folderNameInput = document.getElementById('folder-name-input');
  const folderPathInput = document.getElementById('folder-path-input');
  const folderName = folderNameInput.value.trim();
  const folderPath = folderPathInput ? folderPathInput.value.trim() : '';

  if (!folderName) {
    alert('Please enter a folder name');
    folderNameInput.focus();
    return;
  }

  // Normalize existing folders for comparison
  const normalized = normalizeFolders(customFolders);

  // Check for duplicates by name
  if (normalized.some(f => f.name === folderName)) {
    alert('A folder with this name already exists');
    folderNameInput.focus();
    return;
  }

  // Add folder in new format
  customFolders.push({ name: folderName, path: folderPath || '' });
  renderCustomFolders();
  updateFolderSelects();

  // Close modal
  closeFolderNameModal();
}

/**
 * Open participant edit modal
 * @param {number} rowIndex - Index in participantsData array (-1 for new participant)
 */
async function openParticipantEditModal(rowIndex = -1) {
  editingRowIndex = rowIndex;

  const title = rowIndex === -1 ? 'Add Participant' : 'Edit Participant';
  document.getElementById('participant-edit-title').textContent = title;

  // Get current user ID for face photos
  let currentUserId = null;
  try {
    const sessionResult = await window.api.invoke('auth-get-session');
    if (sessionResult.success && sessionResult.session?.user) {
      currentUserId = sessionResult.session.user.id;
    }
  } catch (e) {
    console.warn('[Participants] Could not get user session for face photos:', e);
  }

  // Initialize tag input for drivers
  initDriversTagInput();

  if (rowIndex >= 0 && participantsData[rowIndex]) {
    // Edit mode: populate form with existing data
    const participant = participantsData[rowIndex];
    document.getElementById('edit-numero').value = participant.numero || '';
    document.getElementById('edit-categoria').value = participant.categoria || '';
    document.getElementById('edit-squadra').value = participant.squadra || '';
    document.getElementById('edit-plate-number').value = participant.plate_number || '';
    document.getElementById('edit-sponsor').value = participant.sponsor || '';
    document.getElementById('edit-metatag').value = participant.metatag || '';

    // Populate drivers tag input - prefer drivers array, fallback to nome/nome_pilota string
    const driversData = participant.drivers || participant.nome || participant.nome_pilota || '';
    setDriversTags(driversData);

    // Populate folder selects
    populateFolderSelects();
    document.getElementById('edit-folder-1').value = participant.folder_1 || '';
    document.getElementById('edit-folder-2').value = participant.folder_2 || '';
    document.getElementById('edit-folder-3').value = participant.folder_3 || '';

    // Load face photos for participant
    if (typeof presetFaceManager !== 'undefined' && currentPreset) {
      const isOfficial = currentPreset.is_official === true;
      // Pass participant.id (may be null for new participants - will show empty state with add button)
      await presetFaceManager.loadPhotos(participant.id || null, currentPreset.id, currentUserId, isOfficial);
    }
  } else {
    // Create mode: clear all fields
    document.getElementById('edit-numero').value = '';
    document.getElementById('edit-categoria').value = '';
    document.getElementById('edit-squadra').value = '';
    document.getElementById('edit-plate-number').value = '';
    document.getElementById('edit-sponsor').value = '';
    document.getElementById('edit-metatag').value = '';

    // Clear drivers tags
    clearDriversTags();

    populateFolderSelects();
    document.getElementById('edit-folder-1').value = '';
    document.getElementById('edit-folder-2').value = '';
    document.getElementById('edit-folder-3').value = '';

    // Show face photos section for new participants (will auto-save when adding photos)
    if (typeof presetFaceManager !== 'undefined' && currentPreset) {
      const isOfficial = currentPreset?.is_official === true;
      await presetFaceManager.loadPhotos(null, currentPreset.id, currentUserId, isOfficial);
    }
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

  // Reset face manager state
  if (typeof presetFaceManager !== 'undefined' && presetFaceManager.reset) {
    presetFaceManager.reset();
  }
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

  const normalized = normalizeFolders(customFolders);

  selects.forEach((select, index) => {
    if (!select) return;

    select.innerHTML = `<option value="">Folder ${index + 1}: None</option>`;
    normalized.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.name;
      option.textContent = folder.name;
      select.appendChild(option);
    });
  });
}

/**
 * Save participant edit
 * @param {boolean} closeAfterSave - Whether to close modal after save (default: true)
 */
async function saveParticipantEdit(closeAfterSave = true) {
  const numero = document.getElementById('edit-numero').value.trim();

  // Get drivers from tag input
  const driversArray = getDriversTagsArray();

  // Validation: at least number OR driver name must be present
  // This allows Team Principal, VIP, mechanics without race numbers
  if (!numero && driversArray.length === 0) {
    alert('Please enter a race number or at least one driver name.\n\nTeam Principal, VIP and mechanics can be added without a number if a name is provided.');
    document.getElementById('edit-numero').focus();
    return;
  }

  // Comma-separated for nome_pilota compatibility
  const nome = driversArray.join(', ');

  const participant = {
    numero,
    nome,
    nome_pilota: nome, // For compatibility
    drivers: driversArray, // New: array of driver names
    categoria: document.getElementById('edit-categoria').value.trim(),
    squadra: document.getElementById('edit-squadra').value.trim(),
    plate_number: document.getElementById('edit-plate-number').value.trim().toUpperCase(),
    sponsor: document.getElementById('edit-sponsor').value.trim(),
    metatag: document.getElementById('edit-metatag').value.trim(),
    folder_1: document.getElementById('edit-folder-1').value,
    folder_2: document.getElementById('edit-folder-2').value,
    folder_3: document.getElementById('edit-folder-3').value
  };

  // Salva il numero per lo scroll successivo
  const participantNumero = numero;

  // Salva l'ordinamento corrente prima di aggiornare
  const sortState = getCurrentSortState();

  // Check if this is a new participant (no existing ID)
  const isNewParticipant = editingRowIndex === -1 || !participantsData[editingRowIndex]?.id;

  if (editingRowIndex === -1) {
    // Add new participant
    participantsData.push(participant);
    editingRowIndex = participantsData.length - 1; // Update index to new position
  } else {
    // Update existing participant - preserve ID if exists
    const existingId = participantsData[editingRowIndex]?.id;
    participantsData[editingRowIndex] = { ...participant, id: existingId };
  }

  // Refresh table display
  loadParticipantsIntoTable(participantsData);

  // Ri-applica l'ordinamento salvato
  if (sortState) {
    applySortState(sortState);
  }

  // Scorri al pilota modificato dopo un breve delay per permettere il re-render
  setTimeout(() => scrollToParticipant(participantNumero), 150);

  if (closeAfterSave) {
    closeParticipantEditModal();
  } else {
    // Update save button to show saved state
    const saveBtn = document.querySelector('#participant-edit-modal .btn-primary');
    if (saveBtn) {
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '✓ Saved';
      saveBtn.disabled = true;
      setTimeout(() => {
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
      }, 1500);
    }
  }
}

/**
 * Save participant and stay in modal (for adding face photos)
 */
async function saveParticipantAndStay() {
  await saveParticipantEdit(false);

  // Now save the preset to database to get participant IDs
  if (!currentPreset?.id) {
    showNotification('Please save the preset first using "Save Preset" button', 'warning');
    return;
  }

  try {
    // Get current user ID for face photos
    let currentUserId = null;
    const sessionResult = await window.api.invoke('auth-get-session');
    if (sessionResult.success && sessionResult.session?.user) {
      currentUserId = sessionResult.session.user.id;
    }

    // Collect and save participants to database
    const participants = participantsData.map((p, index) => ({
      numero: p.numero || '',
      nome: p.nome || '',
      categoria: p.categoria || '',
      squadra: p.squadra || '',
      plate_number: p.plate_number || '',
      sponsor: p.sponsor || '',
      metatag: p.metatag || '',
      folder_1: p.folder_1 || '',
      folder_2: p.folder_2 || '',
      folder_3: p.folder_3 || '',
      sort_order: index
    }));

    const saveResponse = await window.api.invoke('supabase-save-preset-participants', {
      presetId: currentPreset.id,
      participants: participants
    });

    if (!saveResponse.success) {
      throw new Error(saveResponse.error || 'Failed to save participants');
    }

    // Reload the preset to get updated participant IDs
    const presetResponse = await window.api.invoke('supabase-get-participant-preset-by-id', currentPreset.id);
    if (presetResponse.success && presetResponse.data) {
      currentPreset = presetResponse.data;
      participantsData = presetResponse.data.participants || [];

      // Find the participant we just saved by numero
      const savedParticipant = participantsData.find(p => p.numero === document.getElementById('edit-numero').value.trim());

      if (savedParticipant?.id && typeof presetFaceManager !== 'undefined') {
        const isOfficial = currentPreset.is_official === true;
        await presetFaceManager.loadPhotos(savedParticipant.id, currentPreset.id, currentUserId, isOfficial);
        showNotification('Participant saved! You can now add face photos.', 'success');
      }
    }

    // Refresh table with new IDs
    loadParticipantsIntoTable(participantsData);

  } catch (error) {
    console.error('[Participants] Error saving participant for face photos:', error);
    showNotification('Error saving: ' + error.message, 'error');
  }
}

/**
 * Get current sort state from table headers
 * @returns {Object|null} Sort state with columnIndex and direction
 */
function getCurrentSortState() {
  const sortedHeader = document.querySelector('#participants-table th.asc, #participants-table th.desc');
  if (sortedHeader) {
    return {
      columnIndex: sortedHeader.cellIndex,
      direction: sortedHeader.classList.contains('asc') ? 'asc' : 'desc'
    };
  }
  // Default: ordina per numero (prima colonna) in ordine crescente
  return { columnIndex: 0, direction: 'asc' };
}

/**
 * Apply saved sort state to table
 * @param {Object} state - Sort state with columnIndex and direction
 */
function applySortState(state) {
  const table = document.getElementById('participants-table');
  if (!table) return;

  const headers = table.querySelectorAll('th');
  if (!headers || headers.length === 0) return;

  const header = headers[state.columnIndex];
  if (!header) return;

  // Prima rimuovi le classi di ordinamento da tutti gli header
  headers.forEach(h => {
    h.classList.remove('asc', 'desc');
  });

  // Ordina i dati manualmente
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll('tr'));

  rows.sort((rowA, rowB) => {
    const cellA = rowA.querySelectorAll('td')[state.columnIndex];
    const cellB = rowB.querySelectorAll('td')[state.columnIndex];

    if (!cellA || !cellB) return 0;

    const valueA = cellA.getAttribute('data-sort') || cellA.textContent.trim();
    const valueB = cellB.getAttribute('data-sort') || cellB.textContent.trim();

    // Prova a comparare come numeri
    const numA = parseFloat(valueA);
    const numB = parseFloat(valueB);

    let comparison;
    if (!isNaN(numA) && !isNaN(numB)) {
      comparison = numA - numB;
    } else {
      comparison = valueA.localeCompare(valueB, undefined, { numeric: true, sensitivity: 'base' });
    }

    return state.direction === 'asc' ? comparison : -comparison;
  });

  // Ricostruisci il tbody con le righe ordinate
  rows.forEach(row => tbody.appendChild(row));

  // Aggiungi la classe di ordinamento all'header
  header.classList.add(state.direction);
}

/**
 * Scroll to a participant row and highlight it
 * @param {string} numero - The participant number to scroll to
 */
function scrollToParticipant(numero) {
  const tbody = document.getElementById('participants-tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');

  for (const row of rows) {
    const numCell = row.querySelector('td:first-child');
    if (numCell && numCell.textContent.trim() === String(numero)) {
      // Scorri alla riga
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight temporaneo
      row.classList.add('highlight-row');
      setTimeout(() => row.classList.remove('highlight-row'), 2000);
      break;
    }
  }
}

/**
 * Remove a custom folder by index
 */
function removeCustomFolderByIndex(index) {
  if (index >= 0 && index < customFolders.length) {
    customFolders.splice(index, 1);
    renderCustomFolders();
    updateFolderSelects();
  }
}

/**
 * Remove a custom folder by name (legacy support)
 */
function removeCustomFolder(folderName) {
  const normalized = normalizeFolders(customFolders);
  const index = normalized.findIndex(f => f.name === folderName);
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
  const normalized = normalizeFolders(customFolders);
  const folder = normalized[index];

  // Open modal and populate with current name and path
  document.getElementById('edit-folder-name-input').value = folder.name;

  const pathInput = document.getElementById('edit-folder-path-input');
  if (pathInput) {
    pathInput.value = folder.path || '';
  }

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
  const pathInput = document.getElementById('edit-folder-path-input');
  const newFolderPath = pathInput ? pathInput.value.trim() : '';

  if (!newFolderName) {
    alert('Folder name cannot be empty!');
    document.getElementById('edit-folder-name-input').focus();
    return;
  }

  const normalized = normalizeFolders(customFolders);
  const oldFolder = normalized[editingFolderIndex];
  const oldFolderName = oldFolder.name;

  // Check if the new name already exists (and it's not the same folder)
  if (normalized.some((f, i) => f.name === newFolderName && i !== editingFolderIndex)) {
    alert('A folder with this name already exists!');
    document.getElementById('edit-folder-name-input').focus();
    return;
  }

  // Update folder with new name and path
  customFolders[editingFolderIndex] = {
    name: newFolderName,
    path: newFolderPath || ''
  };

  // Update all participants that have this folder assigned (by old name)
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

  // Normalize folders to handle both legacy and new format
  const normalized = normalizeFolders(customFolders);

  // Add folder chips
  normalized.forEach((folder, index) => {
    const chip = document.createElement('div');
    chip.className = 'folder-chip';

    const folderName = folder.name;
    const folderPath = folder.path || '';
    const hasPath = folderPath.length > 0;

    // Show path info if present
    const pathInfo = hasPath
      ? `<small class="folder-chip-path" title="${escapeHtml(folderPath)}" style="display: block; color: #888; font-size: 0.85em; margin-top: 2px;">🗂️ ${escapeHtml(folderPath.length > 30 ? '...' + folderPath.slice(-30) : folderPath)}</small>`
      : '';

    chip.innerHTML = `
      <span class="folder-chip-name">
        📁 ${escapeHtml(folderName)}
        ${pathInfo}
      </span>
      <button type="button" class="folder-chip-edit" onclick="editCustomFolder(${index})" title="Edit folder">
        ✏️
      </button>
      <button type="button" class="folder-chip-remove" onclick="removeCustomFolderByIndex(${index})" title="Remove folder">
        ×
      </button>
    `;
    foldersList.appendChild(chip);
  });

  // Update customFolders with normalized data
  customFolders = normalized;
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

  const normalized = normalizeFolders(customFolders);

  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    const folderSelects = row.querySelectorAll('select[data-field^="folder_"]');
    folderSelects.forEach(select => {
      const currentValue = select.value;

      // Rebuild options
      select.innerHTML = '<option value="">-- None --</option>';
      normalized.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.name;
        option.textContent = folder.name;
        if (currentValue === folder.name) {
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
  try {
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

    // Populate sport category dropdown with current preset's category
    populateSportCategoryDropdown(currentPreset.category_id);

    // Load participants into table
    loadParticipantsIntoTable(participantsData);

    // Show modal
    const modal = document.getElementById('preset-editor-modal');
    if (!modal) {
      console.error('[Participants] Modal element not found in DOM');
      return;
    }
    modal.classList.add('show');

  } catch (error) {
    console.error('[Participants] Error editing preset:', error);
    showNotification('Error loading preset for editing', 'error');
  }
}

/**
 * Duplicate an official preset to create a personal copy
 */
async function duplicateOfficialPreset(presetId) {
  try {
    // Show confirmation
    const confirmed = await showConfirmDialog(
      'Duplicate Official Preset',
      'This will create a personal copy of this official preset that you can customize. Continue?'
    );

    if (!confirmed) return;

    // Show loading state
    showNotification('Duplicating preset...', 'info');

    const response = await window.api.invoke('supabase-duplicate-official-preset', presetId);

    if (response.success && response.data) {
      showNotification(`Created "${response.data.name}" in your presets!`, 'success');
      await loadParticipantPresets(); // Refresh list
    } else {
      showNotification('Error duplicating preset: ' + (response.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('[Participants] Error duplicating official preset:', error);
    showNotification('Error duplicating preset', 'error');
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
 * Note: Sorting is now handled by sortable.js library (client-side table sorting)
 * This keeps participantsData in original order for stable indexing
 */
function loadParticipantsIntoTable(participants) {
  clearParticipantsTable();

  if (!participants || participants.length === 0) {
    return; // Empty table
  }

  // Keep original order - sorting will be handled by sortable.js in the UI
  participantsData = participants;

  participantsData.forEach((participant, index) => {
    addParticipantRow(participant, index);
  });

  // Note: Initial sort is handled by sortable.js with the 'asc' class on the table
  // The table will automatically sort by the first column (Num) in ascending order
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

  // Store original index as data attribute for stable indexing during sorting
  row.setAttribute('data-original-index', rowIndex);

  // Add data-sort attributes for proper sorting by sortable.js
  row.innerHTML = `
    <td data-sort="${numero}"><strong>${numero}</strong></td>
    <td data-sort="${nome}">${nome}</td>
    <td data-sort="${categoria}">${categoryDisplay}</td>
    <td data-sort="${squadra}">${squadra || '<span class="text-muted">-</span>'}</td>
    <td data-sort="${plateNumber}">${plateDisplay}</td>
    <td class="no-sort">
      <button class="btn btn-sm btn-secondary" onclick="duplicateParticipantFromRow(this)" title="Duplicate participant">
        <span class="btn-icon">📋</span>
      </button>
      <button class="btn btn-sm btn-secondary" onclick="openParticipantEditModalFromRow(this)" title="Edit participant">
        <span class="btn-icon">✏️</span>
      </button>
      <button class="btn btn-sm btn-danger" onclick="removeParticipantFromRow(this)" title="Delete participant">
        <span class="btn-icon">🗑️</span>
      </button>
    </td>
  `;

  tbody.appendChild(row);
}

/**
 * Open edit modal from row button (gets index from data attribute)
 * @param {HTMLElement} button - The button element that was clicked
 */
function openParticipantEditModalFromRow(button) {
  const row = button.closest('tr');
  const rowIndex = parseInt(row.getAttribute('data-original-index'), 10);
  openParticipantEditModal(rowIndex);
}

/**
 * Remove participant from row button (gets index from data attribute)
 * @param {HTMLElement} button - The button element that was clicked
 */
function removeParticipantFromRow(button) {
  const row = button.closest('tr');
  const rowIndex = parseInt(row.getAttribute('data-original-index'), 10);
  removeParticipant(rowIndex);
}

/**
 * Duplicate participant from row button (gets index from data attribute)
 * @param {HTMLElement} button - The button element that was clicked
 */
function duplicateParticipantFromRow(button) {
  const row = button.closest('tr');
  const rowIndex = parseInt(row.getAttribute('data-original-index'), 10);
  duplicateParticipant(rowIndex);
}

/**
 * Duplicate a participant by index
 * Creates a copy with the same data (number left as-is for user to modify)
 * @param {number} rowIndex - Index in participantsData array
 */
function duplicateParticipant(rowIndex) {
  if (rowIndex < 0 || rowIndex >= participantsData.length) {
    return;
  }

  const originalParticipant = participantsData[rowIndex];

  // Create a deep copy of the participant
  const duplicatedParticipant = {
    numero: originalParticipant.numero || '',
    nome: originalParticipant.nome || originalParticipant.nome_pilota || '',
    nome_pilota: originalParticipant.nome || originalParticipant.nome_pilota || '',
    drivers: originalParticipant.drivers ? [...originalParticipant.drivers] : [],
    categoria: originalParticipant.categoria || '',
    squadra: originalParticipant.squadra || '',
    plate_number: originalParticipant.plate_number || '',
    sponsor: originalParticipant.sponsor || '',
    metatag: originalParticipant.metatag || '',
    folder_1: originalParticipant.folder_1 || '',
    folder_2: originalParticipant.folder_2 || '',
    folder_3: originalParticipant.folder_3 || ''
  };

  // Add the duplicated participant to the array
  participantsData.push(duplicatedParticipant);

  // Get current sort state
  const sortState = getCurrentSortState();

  // Refresh the table
  loadParticipantsIntoTable(participantsData);

  // Re-apply sort state
  if (sortState) {
    applySortState(sortState);
  }

  // Open edit modal for the new participant so user can modify the number
  const newIndex = participantsData.length - 1;
  setTimeout(() => {
    openParticipantEditModal(newIndex);
    // Focus on the number field so user can quickly change it
    setTimeout(() => {
      const numeroField = document.getElementById('edit-numero');
      if (numeroField) {
        numeroField.focus();
        numeroField.select();
      }
    }, 150);
  }, 100);
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
    const sportCategoryId = document.getElementById('preset-sport-category')?.value || null;

    // Validation
    if (!presetName) {
      showNotification('Please enter a preset name', 'error');
      document.getElementById('preset-name').focus();
      return;
    }

    if (!sportCategoryId) {
      showNotification('Please select a sport category', 'error');
      document.getElementById('preset-sport-category').focus();
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

    // Disable save button during operation
    const saveBtn = document.getElementById('save-preset-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-icon">⏳</span>Saving...';

    let presetId;

    if (isEditingPreset && currentPreset) {
      // Update existing preset
      presetId = currentPreset.id;

      const updateData = {
        name: presetName,
        description: presetDescription,
        category_id: sportCategoryId,
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
      const presetData = {
        name: presetName,
        description: presetDescription,
        category_id: sportCategoryId,
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

    // Only add participant if has at least a number or name
    if (hasData && (participant.numero || participant.nome)) {
      participants.push(participant);
    }
  });

  // Sort participants by number before returning
  const sortedParticipants = sortParticipantsByNumber(participants);

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

// ============================================
// Tag Input Functions for Drivers
// ============================================

/**
 * Initialize tag input for drivers in edit modal
 */
function initDriversTagInput() {
  const container = document.getElementById('edit-drivers-container');
  const tagsContainer = document.getElementById('edit-drivers-tags');
  const input = document.getElementById('edit-drivers-input');
  const hiddenInput = document.getElementById('edit-nome');

  if (!container || !tagsContainer || !input) return;

  // Clear any existing event listeners by cloning and replacing
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  // Handle input events
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const value = newInput.value.trim();
      if (value) {
        addDriverTag(value);
        newInput.value = '';
      }
    } else if (e.key === 'Backspace' && newInput.value === '' && editDriversTags.length > 0) {
      // Remove last tag on backspace when input is empty
      removeDriverTag(editDriversTags.length - 1);
    }
  });

  // Handle blur - add tag if there's content
  newInput.addEventListener('blur', () => {
    const value = newInput.value.trim();
    if (value) {
      addDriverTag(value);
      newInput.value = '';
    }
  });

  // Click on container focuses input
  container.addEventListener('click', (e) => {
    if (e.target === container || e.target === tagsContainer) {
      newInput.focus();
    }
  });

  // Update empty state class
  updateDriversTagsEmptyState();
}

/**
 * Add a driver tag
 * @param {string} name - Driver name to add
 */
function addDriverTag(name) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  // Check for duplicates (case insensitive)
  if (editDriversTags.some(tag => tag.toLowerCase() === trimmedName.toLowerCase())) {
    return;
  }

  editDriversTags.push(trimmedName);
  renderDriversTags();
  syncDriversToHiddenInput();
}

/**
 * Remove a driver tag by index
 * @param {number} index - Index of tag to remove
 */
function removeDriverTag(index) {
  if (index >= 0 && index < editDriversTags.length) {
    editDriversTags.splice(index, 1);
    renderDriversTags();
    syncDriversToHiddenInput();
  }
}

/**
 * Render all driver tags in the container
 */
function renderDriversTags() {
  const tagsContainer = document.getElementById('edit-drivers-tags');
  if (!tagsContainer) return;

  tagsContainer.innerHTML = '';

  editDriversTags.forEach((tag, index) => {
    const tagEl = document.createElement('span');
    tagEl.className = 'tag-item' + (index === 0 ? ' primary-driver' : '');
    tagEl.innerHTML = `
      <span class="tag-text">${escapeHtml(tag)}</span>
      <button type="button" class="tag-remove" onclick="removeDriverTag(${index})" title="Remove">×</button>
    `;
    tagsContainer.appendChild(tagEl);
  });

  updateDriversTagsEmptyState();
}

/**
 * Sync drivers array to hidden input for form submission
 */
function syncDriversToHiddenInput() {
  const hiddenInput = document.getElementById('edit-nome');
  if (hiddenInput) {
    // Join with comma and space for nome_pilota field
    hiddenInput.value = editDriversTags.join(', ');
  }
}

/**
 * Update empty state class on container
 */
function updateDriversTagsEmptyState() {
  const container = document.getElementById('edit-drivers-container');
  if (container) {
    if (editDriversTags.length === 0) {
      container.classList.add('empty');
    } else {
      container.classList.remove('empty');
    }
  }
}

/**
 * Set drivers from existing data (when editing a participant)
 * @param {string|Array} drivers - Either comma-separated string or array of driver names
 */
function setDriversTags(drivers) {
  editDriversTags = [];

  if (Array.isArray(drivers)) {
    // Already an array
    editDriversTags = drivers.filter(d => d && d.trim()).map(d => d.trim());
  } else if (typeof drivers === 'string' && drivers.trim()) {
    // Comma-separated string - split it
    editDriversTags = drivers.split(',').map(d => d.trim()).filter(d => d);
  }

  renderDriversTags();
  syncDriversToHiddenInput();
}

/**
 * Get drivers as array
 * @returns {Array<string>} Array of driver names
 */
function getDriversTagsArray() {
  return [...editDriversTags];
}

/**
 * Clear all driver tags
 */
function clearDriversTags() {
  editDriversTags = [];
  renderDriversTags();
  syncDriversToHiddenInput();
}

// Export for global access
window.removeDriverTag = removeDriverTag;
window.addDriverTag = addDriverTag;
window.clearDriversTags = clearDriversTags;

/**
 * Download CSV template with correct column headers
 */
function downloadCsvTemplate() {
  // Use IPC to show native save dialog and save the CSV template
  window.api.send('download-csv-template');
}

// ============================================
// PDF Import Functions
// ============================================

/** Stores the PDF extraction result for import */
var pdfImportData = null;

/** Interval ID for cycling processing messages */
var processingMessageInterval = null;

/** Fun racing-themed messages for PDF processing */
const PDF_PROCESSING_MESSAGES = [
  "🏎️ Warming up the AI engine...",
  "🔍 Scanning for race numbers...",
  "📊 Analyzing entry list structure...",
  "🏁 Checking starting grid positions...",
  "👀 Looking for driver names...",
  "🏆 Identifying competitors...",
  "📋 Reading team information...",
  "⚡ Processing at full throttle...",
  "🎯 Extracting participant data...",
  "🔧 Fine-tuning the results...",
  "🚀 Almost at the finish line...",
  "📝 Double-checking the data...",
  "🏅 Preparing your entry list..."
];

/**
 * Setup PDF drop zone event listeners
 */
function setupPdfDropZone() {
  const dropZone = document.getElementById('pdf-drop-zone');
  const fileInput = document.getElementById('pdf-file-input');
  const importPdfBtn = document.getElementById('import-pdf-preset-btn');

  if (!dropZone || !fileInput) {
    return;
  }

  // Click to open file browser
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Import PDF button click
  if (importPdfBtn) {
    importPdfBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }

  // File input change
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await processPdfFile(file);
    }
    // Reset input so same file can be selected again
    fileInput.value = '';
  });

  // Drag events
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only remove class if we're leaving the drop zone entirely
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        await processPdfFile(file);
      } else {
        showNotification('Please upload a PDF file', 'error');
      }
    }
  });
}

/**
 * Process the uploaded PDF file
 * @param {File} file - The PDF file to process
 */
async function processPdfFile(file) {
  // Validate file type
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
    showNotification('Please upload a PDF file', 'error');
    return;
  }

  // Validate file size (max 20MB)
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    showNotification('PDF file is too large. Maximum size is 20MB.', 'error');
    return;
  }

  // Show modal with processing state
  openPdfImportModal();
  showPdfProcessingState('📤 Uploading document...', true); // Start cycling messages

  try {
    // Convert file to base64
    const base64 = await fileToBase64(file);

    // Call edge function
    const response = await window.api.invoke('supabase-parse-pdf-entry-list', {
      pdfBase64: base64
    });

    if (!response.success) {
      // Show validation error
      if (response.validation) {
        showPdfValidationError(
          'Document Not Recognized',
          response.error,
          `Type detected: ${response.validation.document_type}\nConfidence: ${(response.validation.confidence * 100).toFixed(1)}%\n\n${response.validation.rejection_reason || ''}`
        );
      } else {
        showPdfValidationError(
          'Processing Error',
          response.error,
          response.details || ''
        );
      }
      return;
    }

    // Store the result
    pdfImportData = response.data;

    // Show preview
    showPdfPreviewState(response.data);

  } catch (error) {
    console.error('[Participants] PDF processing error:', error);
    showPdfValidationError(
      'Processing Error',
      'Failed to process the PDF file',
      error.message || ''
    );
  }
}

/**
 * Convert file to base64
 * @param {File} file - The file to convert
 * @returns {Promise<string>} Base64 string (without data URI prefix)
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove the data URI prefix (data:application/pdf;base64,)
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Open PDF import modal
 */
function openPdfImportModal() {
  const modal = document.getElementById('pdf-import-modal');
  if (modal) {
    modal.classList.add('show');
  }
  // Hide all states initially
  hidePdfStates();
}

/**
 * Close PDF import modal
 */
function closePdfImportModal() {
  const modal = document.getElementById('pdf-import-modal');
  if (modal) {
    modal.classList.remove('show');
  }
  // Reset state
  pdfImportData = null;
  hidePdfStates();
}

/**
 * Reset PDF import to initial state
 */
function resetPdfImport() {
  pdfImportData = null;
  hidePdfStates();
  closePdfImportModal();
}

/**
 * Hide all PDF states
 */
function hidePdfStates() {
  // Stop message cycling
  stopProcessingMessageCycle();

  const states = ['pdf-processing-state', 'pdf-validation-error', 'pdf-preview-state'];
  states.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Reset footer button
  const importBtn = document.getElementById('import-pdf-btn');
  if (importBtn) {
    importBtn.disabled = true;
  }
}

/**
 * Show processing state with animated cycling messages
 * @param {string} status - Initial status message to display
 * @param {boolean} startCycling - Whether to start cycling through fun messages
 */
function showPdfProcessingState(status, startCycling = false) {
  hidePdfStates();
  const processingState = document.getElementById('pdf-processing-state');
  const statusEl = document.getElementById('pdf-processing-status');

  if (processingState) {
    processingState.style.display = 'block';
  }
  if (statusEl) {
    statusEl.textContent = status;
    // Add fade transition class
    statusEl.classList.add('processing-message-animated');
  }

  // Start cycling through fun messages if requested
  if (startCycling) {
    startProcessingMessageCycle();
  }
}

/**
 * Start cycling through fun processing messages
 */
function startProcessingMessageCycle() {
  // Clear any existing interval
  stopProcessingMessageCycle();

  let messageIndex = 0;
  const statusEl = document.getElementById('pdf-processing-status');

  // Change message every 4 seconds
  processingMessageInterval = setInterval(() => {
    if (statusEl) {
      // Fade out
      statusEl.style.opacity = '0';

      setTimeout(() => {
        // Change message and fade in
        statusEl.textContent = PDF_PROCESSING_MESSAGES[messageIndex];
        statusEl.style.opacity = '1';

        // Cycle through messages
        messageIndex = (messageIndex + 1) % PDF_PROCESSING_MESSAGES.length;
      }, 300);
    }
  }, 4000);
}

/**
 * Stop cycling processing messages
 */
function stopProcessingMessageCycle() {
  if (processingMessageInterval) {
    clearInterval(processingMessageInterval);
    processingMessageInterval = null;
  }
}

/**
 * Show validation error state
 * @param {string} title - Error title
 * @param {string} message - Error message
 * @param {string} details - Additional details
 */
function showPdfValidationError(title, message, details) {
  hidePdfStates();
  const errorState = document.getElementById('pdf-validation-error');
  const titleEl = document.getElementById('pdf-error-title');
  const messageEl = document.getElementById('pdf-error-message');
  const detailsEl = document.getElementById('pdf-error-details');

  if (errorState) {
    errorState.style.display = 'block';
  }
  if (titleEl) {
    titleEl.textContent = title;
  }
  if (messageEl) {
    messageEl.textContent = message;
  }
  if (detailsEl) {
    if (details) {
      detailsEl.style.display = 'block';
      detailsEl.textContent = details;
    } else {
      detailsEl.style.display = 'none';
    }
  }
}

/**
 * Show preview state with extracted data
 * @param {Object} data - Extraction result data
 */
function showPdfPreviewState(data) {
  hidePdfStates();
  const previewState = document.getElementById('pdf-preview-state');

  if (!previewState) return;
  previewState.style.display = 'block';

  // Update document info
  const docTypeBadge = document.getElementById('pdf-doc-type-badge');
  const eventNameEl = document.getElementById('pdf-event-name');
  const categoryEl = document.getElementById('pdf-category-name');
  const participantsCountEl = document.getElementById('pdf-participants-count');

  if (docTypeBadge) {
    docTypeBadge.textContent = formatDocumentType(data.validation.document_type);
  }
  if (eventNameEl) {
    eventNameEl.textContent = data.event.name || 'Not detected';
  }
  if (categoryEl) {
    categoryEl.textContent = data.event.category || 'Not detected';
  }
  if (participantsCountEl) {
    participantsCountEl.textContent = data.participants.length;
  }

  // Suggest preset name from event name
  const presetNameInput = document.getElementById('pdf-preset-name');
  if (presetNameInput && data.event.name) {
    presetNameInput.value = data.event.name;
  }

  // Populate preview table
  populatePdfPreviewTable(data.participants);

  // Show extraction warning if needed
  const warningEl = document.getElementById('pdf-extraction-warning');
  const warningMessageEl = document.getElementById('pdf-warning-message');
  if (warningEl && data.notes) {
    warningEl.style.display = 'flex';
    if (warningMessageEl) {
      warningMessageEl.textContent = data.notes;
    }
  } else if (warningEl) {
    warningEl.style.display = 'none';
  }

  // Update preview hint
  const hintEl = document.getElementById('pdf-preview-hint');
  if (hintEl) {
    if (data.participants.length > 10) {
      hintEl.textContent = `Showing first 10 of ${data.participants.length} participants.`;
    } else {
      hintEl.textContent = `Showing all ${data.participants.length} participants.`;
    }
  }

  // Enable import button and update count
  const importBtn = document.getElementById('import-pdf-btn');
  const importCountEl = document.getElementById('pdf-import-count');
  if (importBtn) {
    importBtn.disabled = false;
  }
  if (importCountEl) {
    importCountEl.textContent = data.participants.length;
  }
}

/**
 * Format document type for display
 * @param {string} type - Document type from API
 * @returns {string} Formatted display string
 */
function formatDocumentType(type) {
  const types = {
    'entry_list': 'Entry List',
    'start_list': 'Start List',
    'starting_grid': 'Starting Grid',
    'race_entry': 'Race Entry',
    'participant_list': 'Participant List',
    'competitor_list': 'Competitor List',
    'race_results': 'Race Results',
    'classification': 'Classification',
    'final_results': 'Final Results',
    'other': 'Document'
  };
  return types[type] || type;
}

/**
 * Populate PDF preview table with participants
 * @param {Array} participants - Array of participant objects
 */
function populatePdfPreviewTable(participants) {
  const tbody = document.getElementById('pdf-preview-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  // Show first 10 participants
  const previewParticipants = participants.slice(0, 10);

  previewParticipants.forEach(p => {
    const row = document.createElement('tr');
    // Display drivers as nome_pilota (comma-separated) or fallback to nome
    const driversDisplay = p.nome_pilota || p.nome || '-';
    row.innerHTML = `
      <td><strong>${escapeHtml(p.numero || '-')}</strong></td>
      <td>${escapeHtml(driversDisplay)}</td>
      <td>${escapeHtml(p.squadra || '-')}</td>
      <td>${escapeHtml(p.categoria || '-')}</td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Import the PDF data as a new preset
 */
async function importPdfPreset() {
  if (!pdfImportData || !pdfImportData.participants || pdfImportData.participants.length === 0) {
    showNotification('No data to import', 'error');
    return;
  }

  const presetName = document.getElementById('pdf-preset-name')?.value?.trim();
  if (!presetName) {
    showNotification('Please enter a preset name', 'error');
    document.getElementById('pdf-preset-name')?.focus();
    return;
  }

  // Disable import button
  const importBtn = document.getElementById('import-pdf-btn');
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="btn-icon">⏳</span>Importing...';
  }

  try {
    // Map extracted participants to database format
    // The Edge Function returns drivers as array and nome_pilota as comma-separated string
    // Note: 'drivers' array is NOT saved to database (no column exists) - only used locally for UI
    const participants = pdfImportData.participants.map(p => ({
      numero: p.numero || '',
      nome: p.nome_pilota || p.nome || '', // Use nome_pilota from Edge Function
      categoria: p.categoria || '',
      squadra: p.squadra || '',
      sponsor: Array.isArray(p.sponsors) ? p.sponsors.join(', ') : (p.sponsor || ''),
      metatag: '',
      plate_number: '',
      folder_1: '',
      folder_2: '',
      folder_3: ''
    }));

    // Create preset
    const createResponse = await window.api.invoke('supabase-create-participant-preset', {
      name: presetName,
      description: pdfImportData.event.category
        ? `${pdfImportData.event.category} - Imported from PDF`
        : 'Imported from PDF via AI extraction',
      custom_folders: []
    });

    if (!createResponse.success) {
      throw new Error(createResponse.error || 'Failed to create preset');
    }

    const presetId = createResponse.data.id;

    // Save participants
    const saveResponse = await window.api.invoke('supabase-save-preset-participants', {
      presetId: presetId,
      participants: participants
    });

    if (!saveResponse.success) {
      throw new Error(saveResponse.error || 'Failed to save participants');
    }

    showNotification(`Successfully imported ${participants.length} participants from PDF!`, 'success');
    closePdfImportModal();
    await loadParticipantPresets(); // Refresh list

  } catch (error) {
    console.error('[Participants] PDF import error:', error);
    showNotification('Error importing PDF: ' + error.message, 'error');

    // Re-enable button
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.innerHTML = `<span class="btn-icon">📥</span>Import <span id="pdf-import-count">${pdfImportData.participants.length}</span> Participants`;
    }
  }
}

// Export functions for HTML onclick handlers immediately
window.createNewPreset = createNewPreset;
window.editPreset = editPreset;
window.deletePreset = deletePreset;
window.duplicateOfficialPreset = duplicateOfficialPreset;
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
window.removeCustomFolderByIndex = removeCustomFolderByIndex;
window.closeFolderNameModal = closeFolderNameModal;
window.confirmAddFolder = confirmAddFolder;
window.browseFolderPath = browseFolderPath;
window.browseEditFolderPath = browseEditFolderPath;
window.openParticipantEditModal = openParticipantEditModal;
window.closeParticipantEditModal = closeParticipantEditModal;
window.saveParticipantEdit = saveParticipantEdit;
window.saveParticipantAndStay = saveParticipantAndStay;
window.removeParticipant = removeParticipant;
window.duplicateParticipant = duplicateParticipant;
window.duplicateParticipantFromRow = duplicateParticipantFromRow;

// PDF import functions
window.openPdfImportModal = openPdfImportModal;
window.closePdfImportModal = closePdfImportModal;
window.resetPdfImport = resetPdfImport;
window.importPdfPreset = importPdfPreset;

// Export utility functions for preset management
window.getSelectedPreset = getSelectedPreset;
window.clearSelectedPreset = clearSelectedPreset;

// Initialize participants manager when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Always initialize the participants manager so functions are available
  // even when accessed from other sections (like home page buttons)
  initParticipantsManager();
});

// Initialize when navigating to participants section
document.addEventListener('section-changed', function(event) {
  if (event.detail && event.detail.section === 'participants') {
    initParticipantsManager();
  }
});

// Also initialize when participants section becomes visible
const participantsSectionObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const participantsSection = document.getElementById('section-participants');
      if (participantsSection && participantsSection.classList.contains('active-section')) {
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
    participantsSectionObserver.observe(participantsSection, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  // Listen for CSV template saved event
  window.api.receive('csv-template-saved', (filePath) => {
    showNotification('CSV template saved successfully', 'success');
  });
});