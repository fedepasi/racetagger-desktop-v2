/**
 * Participants Manager
 * Handles participant preset creation, editing, and management
 */

var currentPreset = null;
var participantsData = [];
var isEditingPreset = false;
var customFolders = []; // Array di nomi folder personalizzate
var editingRowIndex = -1; // -1 = new participant, >=0 = editing existing
var currentSortColumn = 0; // Colonna corrente di ordinamento (0 = numero)
var currentSortDirection = 'asc'; // Direzione: 'asc' o 'desc'

/**
 * Initialize participants manager
 */
async function initParticipantsManager() {
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

  // Person Shown Template - live preview
  document.getElementById('person-shown-template')?.addEventListener('input', updatePersonShownPreview);

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
      ${preset.person_shown_template ? `
        <div class="stat">
          <span class="stat-label">Person Shown:</span>
          <span class="stat-value" title="${escapeHtml(preset.person_shown_template)}">Configured</span>
        </div>
      ` : ''}
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
  document.getElementById('person-shown-template').value = '';
  document.getElementById('preset-editor-title').textContent = 'New Participant Preset';

  // Clear Person Shown preview
  const previewEl = document.getElementById('person-shown-preview');
  if (previewEl) previewEl.textContent = '';

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

  // Salva il numero per lo scroll successivo
  const participantNumero = numero;

  // Salva l'ordinamento corrente prima di aggiornare
  const sortState = getCurrentSortState();

  if (editingRowIndex === -1) {
    // Add new participant
    participantsData.push(participant);
  } else {
    // Update existing participant
    participantsData[editingRowIndex] = participant;
  }

  // Refresh table display
  loadParticipantsIntoTable(participantsData);

  // Ri-applica l'ordinamento salvato
  if (sortState) {
    applySortState(sortState);
  }

  // Scorri al pilota modificato dopo un breve delay per permettere il re-render
  setTimeout(() => scrollToParticipant(participantNumero), 150);

  closeParticipantEditModal();
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
    document.getElementById('person-shown-template').value = currentPreset.person_shown_template || '';
    document.getElementById('preset-editor-title').textContent = 'Edit Participant Preset';

    // Update Person Shown preview
    updatePersonShownPreview();

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
    const personShownTemplate = document.getElementById('person-shown-template').value.trim();

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
        custom_folders: customFolders,
        person_shown_template: personShownTemplate || null
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
        custom_folders: customFolders,
        person_shown_template: personShownTemplate || null
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

/**
 * Update Person Shown template preview with sample data
 */
function updatePersonShownPreview() {
  const templateInput = document.getElementById('person-shown-template');
  const previewEl = document.getElementById('person-shown-preview');

  if (!templateInput || !previewEl) return;

  const template = templateInput.value.trim();

  if (!template) {
    previewEl.textContent = '';
    return;
  }

  // Sample data for preview
  const sampleData = {
    name: 'Charles Leclerc',
    surname: 'Leclerc',
    number: '16',
    team: 'Ferrari',
    car_model: 'SF-25',
    nationality: 'MON'
  };

  // Replace placeholders
  let preview = template;
  preview = preview.replace(/{name}/g, sampleData.name);
  preview = preview.replace(/{surname}/g, sampleData.surname);
  preview = preview.replace(/{number}/g, sampleData.number);
  preview = preview.replace(/{team}/g, sampleData.team);
  preview = preview.replace(/{car_model}/g, sampleData.car_model);
  preview = preview.replace(/{nationality}/g, sampleData.nationality);

  // Clean up empty parentheses and extra spaces
  preview = preview.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

  previewEl.textContent = preview ? `Preview: ${preview}` : '';
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
window.closeFolderNameModal = closeFolderNameModal;
window.confirmAddFolder = confirmAddFolder;
window.openParticipantEditModal = openParticipantEditModal;
window.closeParticipantEditModal = closeParticipantEditModal;
window.saveParticipantEdit = saveParticipantEdit;
window.removeParticipant = removeParticipant;
window.updatePersonShownPreview = updatePersonShownPreview;
window.duplicateParticipant = duplicateParticipant;
window.duplicateParticipantFromRow = duplicateParticipantFromRow;

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