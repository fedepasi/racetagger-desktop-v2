/**
 * Preset IPTC Editor
 *
 * Handles the IPTC Metadata section in the preset editor modal.
 * Manages loading, saving, and import of professional IPTC/XMP metadata profiles.
 */

// ============================================================
// State
// ============================================================
let iptcKeywordsList = [];
let iptcSectionExpanded = false;

// ============================================================
// Section toggle
// ============================================================
function toggleIptcSection() {
  iptcSectionExpanded = !iptcSectionExpanded;
  const body = document.getElementById('iptc-section-body');
  const icon = document.getElementById('iptc-toggle-icon');
  if (body && icon) {
    body.style.display = iptcSectionExpanded ? 'block' : 'none';
    icon.textContent = iptcSectionExpanded ? '▼' : '▶';
  }
  // Re-render editable templates when section becomes visible
  if (iptcSectionExpanded) {
    setTimeout(() => {
      document.querySelectorAll('.iptc-editable-template').forEach(editor => {
        const targetId = editor.dataset.target;
        if (targetId) {
          const hidden = document.getElementById(targetId);
          if (hidden && hidden.value) {
            renderEditableHighlights(editor, hidden.value);
          }
        }
      });
    }, 50);
  }
}

// ============================================================
// Keywords tag input
// ============================================================
let keywordsInputDelegationSetup = false;
function initIptcKeywordsInput() {
  // Use event delegation so it works even if the input doesn't exist yet
  if (keywordsInputDelegationSetup) return;
  keywordsInputDelegationSetup = true;

  document.addEventListener('keydown', (e) => {
    const input = e.target;
    if (!input || input.id !== 'iptc-keywords-input') return;

    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const value = input.value.replace(/,/g, '').trim();
      if (value && !iptcKeywordsList.includes(value)) {
        iptcKeywordsList.push(value);
        renderIptcKeywordsTags();
        updateKeywordShortcutStates();
      }
      input.value = '';
    }
  });

  // Setup shortcut buttons for placeholder keywords
  initKeywordShortcutButtons();
}

/**
 * Initialize click handlers on keyword shortcut buttons via event delegation.
 * Uses document-level delegation so it works regardless of when buttons are added to the DOM.
 */
let shortcutDelegationSetup = false;
function initKeywordShortcutButtons() {
  if (shortcutDelegationSetup) return;
  shortcutDelegationSetup = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.keyword-shortcut-btn');
    if (!btn) return;

    const keyword = btn.dataset.keyword;
    if (!keyword) return;

    const existingIndex = iptcKeywordsList.indexOf(keyword);
    if (existingIndex >= 0) {
      // Already added — remove it (toggle behavior)
      iptcKeywordsList.splice(existingIndex, 1);
    } else {
      iptcKeywordsList.push(keyword);
    }
    renderIptcKeywordsTags();
    updateKeywordShortcutStates();
  });
}

/**
 * Initialize click handlers for template shortcut buttons (Caption, Headline, Person Shown).
 * Inserts the placeholder at the cursor position in the target field.
 */
let templateShortcutDelegationSetup = false;
function initTemplateShortcutButtons() {
  if (templateShortcutDelegationSetup) return;
  templateShortcutDelegationSetup = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.template-shortcut-btn');
    if (!btn) return;

    const targetId = btn.dataset.target;
    const placeholder = btn.dataset.placeholder;
    if (!targetId || !placeholder) return;

    // Check for contenteditable editor first
    const editor = document.getElementById(targetId + '-editor');
    if (editor && editor.classList.contains('iptc-editable-template')) {
      insertIntoEditable(editor, placeholder);
      return;
    }

    // Fallback: regular input/textarea
    const field = document.getElementById(targetId);
    if (!field) return;

    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    const before = field.value.substring(0, start);
    const after = field.value.substring(end);
    field.value = before + placeholder + after;

    const newPos = start + placeholder.length;
    field.setSelectionRange(newPos, newPos);
    field.focus();

    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Update visual state of shortcut buttons to reflect which placeholders are already in the keywords list.
 */
function updateKeywordShortcutStates() {
  const buttons = document.querySelectorAll('.keyword-shortcut-btn');
  buttons.forEach(btn => {
    const keyword = btn.dataset.keyword;
    if (iptcKeywordsList.includes(keyword)) {
      btn.classList.add('shortcut-added');
    } else {
      btn.classList.remove('shortcut-added');
    }
  });
}

function renderIptcKeywordsTags() {
  const container = document.getElementById('iptc-keywords-tags');
  if (!container) return;

  container.innerHTML = iptcKeywordsList.map((kw, i) => `
    <span class="iptc-tag">
      ${escapeHtmlIptc(kw)}
      <button class="iptc-tag-remove" onclick="removeIptcKeyword(${i})">&times;</button>
    </span>
  `).join('');

  // Sync shortcut button states
  updateKeywordShortcutStates();
}

function removeIptcKeyword(index) {
  iptcKeywordsList.splice(index, 1);
  renderIptcKeywordsTags();
}

function setIptcKeywords(keywords) {
  iptcKeywordsList = Array.isArray(keywords) ? [...keywords] : [];
  renderIptcKeywordsTags();
}

// ============================================================
// Caption / Person Shown preview
// ============================================================
let previewsDelegationSetup = false;
function initIptcPreviews() {
  if (previewsDelegationSetup) return;
  previewsDelegationSetup = true;

  // Use event delegation for inputs that may not exist yet
  document.addEventListener('input', (e) => {
    if (e.target.id === 'iptc-description') updateCaptionPreview();
    if (e.target.id === 'iptc-person-shown') updatePersonPreview();
  });
}

function updateCaptionPreview() {
  updateTemplatePreview('iptc-description', 'iptc-caption-preview');
}

function updatePersonPreview() {
  updateTemplatePreview('iptc-person-shown', 'iptc-person-preview');
}

/**
 * Shared logic for caption and person-shown previews.
 * Shows the template with highlighted placeholders, plus a resolved example
 * using the first participant in the preset.
 */
function updateTemplatePreview(inputId, previewId) {
  const template = document.getElementById(inputId)?.value || '';
  const preview = document.getElementById(previewId);
  if (!preview) return;

  // No placeholders in template — nothing to preview
  if (!template.includes('{')) {
    preview.innerHTML = '';
    preview.style.display = 'none';
    return;
  }

  const hasParticipants = typeof participantsData !== 'undefined' && participantsData.length > 0;
  let html = '';

  // Show resolved example using first participant
  if (hasParticipants) {
    const resolved = resolveIptcTemplate(template);
    html += '<div class="preview-example"><span class="preview-label">Example:</span> ' + escapeHtmlPreview(resolved) + '</div>';
  } else {
    html += '<div class="preview-example"><span class="preview-hint">Add participants to see a live preview</span></div>';
  }

  preview.innerHTML = html;
  preview.style.display = 'block';
}

function resolveIptcTemplate(template) {
  const hasParticipants = typeof participantsData !== 'undefined' && participantsData.length > 0;
  const sampleParticipant = hasParticipants
    ? participantsData[0]
    : null;

  if (!sampleParticipant) return template;

  let driverName = sampleParticipant.nome || '';
  if (sampleParticipant.drivers && sampleParticipant.drivers.length > 0) {
    driverName = sampleParticipant.drivers[0];
  }

  return template
    .replace(/\{name\}/gi, driverName || '')
    .replace(/\{number\}/gi, sampleParticipant.numero || '')
    .replace(/\{team\}/gi, sampleParticipant.squadra || '')
    .replace(/\{category\}/gi, sampleParticipant.categoria || '')
    .replace(/\{nationality\}/gi, sampleParticipant.nationality || '')
    .replace(/\{car_model\}/gi, sampleParticipant.car_model || '')
    .replace(/\{surname\}/gi, (driverName ? driverName.split(' ').pop() : '') || '')
    .replace(/\{tag\}/gi, sampleParticipant.metatag || '')
    .replace(/\{persons\}/gi, driverName || '')
    .replace(/\{[^}]+\}/g, '')  // Remove any unresolved placeholders
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtmlPreview(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Load IPTC data into form
// ============================================================
function loadIptcDataIntoForm(iptcMetadata) {
  if (!iptcMetadata) {
    clearIptcForm();
    updateIptcToggleStatus(false);
    return;
  }

  // Credits & Copyright
  setVal('iptc-credit', iptcMetadata.credit);
  setVal('iptc-source', iptcMetadata.source);
  setVal('iptc-copyright', iptcMetadata.copyright);
  setVal('iptc-copyright-owner', iptcMetadata.copyrightOwner);
  setChecked('iptc-copyright-marked', iptcMetadata.copyrightMarked);
  setVal('iptc-copyright-url', iptcMetadata.copyrightUrl);

  // Creator & Contact
  setVal('iptc-creator', iptcMetadata.creator);
  setVal('iptc-authors-position', iptcMetadata.authorsPosition);
  setVal('iptc-contact-email', iptcMetadata.contactEmail);
  setVal('iptc-contact-phone', iptcMetadata.contactPhone);
  setVal('iptc-contact-website', iptcMetadata.contactWebsite);
  setVal('iptc-contact-address', iptcMetadata.contactAddress);
  setVal('iptc-contact-city', iptcMetadata.contactCity);
  setVal('iptc-contact-postal-code', iptcMetadata.contactPostalCode);
  setVal('iptc-contact-region', iptcMetadata.contactRegion);
  setVal('iptc-contact-country', iptcMetadata.contactCountry);

  // Event & Caption
  setVal('iptc-headline', iptcMetadata.headlineTemplate);
  setVal('iptc-description', iptcMetadata.descriptionTemplate);
  setVal('iptc-event', iptcMetadata.eventTemplate);
  setVal('iptc-caption-writer', iptcMetadata.captionWriter);
  setVal('iptc-category', iptcMetadata.category);
  setVal('iptc-urgency', iptcMetadata.urgency);
  setVal('iptc-genre', iptcMetadata.intellectualGenre);
  setVal('iptc-date-created', iptcMetadata.dateCreated);

  // Location
  setVal('iptc-city', iptcMetadata.city);
  setVal('iptc-country', iptcMetadata.country);
  setVal('iptc-country-code', iptcMetadata.countryCode);
  setVal('iptc-location', iptcMetadata.location);
  setVal('iptc-province-state', iptcMetadata.provinceState);
  setVal('iptc-world-region', iptcMetadata.worldRegion);

  // Keywords
  setIptcKeywords(iptcMetadata.baseKeywords || []);
  const keywordsMode = iptcMetadata.appendKeywords !== false ? 'append' : 'overwrite';
  const radio = document.querySelector(`input[name="iptc-keywords-mode"][value="${keywordsMode}"]`);
  if (radio) radio.checked = true;
  setChecked('iptc-include-visual-tags', iptcMetadata.includeVisualTags);

  // Person Shown
  setVal('iptc-person-shown', iptcMetadata.personShownTemplate);

  // Rights
  setVal('iptc-digital-source', iptcMetadata.digitalSourceType);
  setVal('iptc-model-release', iptcMetadata.modelReleaseStatus);

  // Update previews
  updateCaptionPreview();
  updatePersonPreview();

  // Initialize and update placeholder highlighting on template fields
  if (typeof initTemplateHighlights === 'function') {
    initTemplateHighlights();
  }

  // Update status badge
  updateIptcToggleStatus(true);
}

function clearIptcForm() {
  const fields = [
    'iptc-credit', 'iptc-source', 'iptc-copyright', 'iptc-copyright-owner',
    'iptc-copyright-url', 'iptc-creator', 'iptc-authors-position',
    'iptc-contact-email', 'iptc-contact-phone', 'iptc-contact-website',
    'iptc-contact-address', 'iptc-contact-city', 'iptc-contact-postal-code',
    'iptc-contact-region', 'iptc-contact-country',
    'iptc-headline', 'iptc-description', 'iptc-event', 'iptc-caption-writer',
    'iptc-category', 'iptc-urgency', 'iptc-genre', 'iptc-date-created',
    'iptc-city', 'iptc-country', 'iptc-country-code', 'iptc-location',
    'iptc-province-state', 'iptc-world-region',
    'iptc-person-shown', 'iptc-digital-source', 'iptc-model-release'
  ];

  fields.forEach(id => setVal(id, ''));
  setChecked('iptc-copyright-marked', false);
  setIptcKeywords([]);

  // Reset radio to append and uncheck visual tags
  const radio = document.querySelector('input[name="iptc-keywords-mode"][value="append"]');
  if (radio) radio.checked = true;
  setChecked('iptc-include-visual-tags', false);

  // Reset all section checkboxes to checked
  ['iptc-section-credits', 'iptc-section-creator', 'iptc-section-event',
   'iptc-section-location', 'iptc-section-keywords', 'iptc-section-person',
   'iptc-section-rights'].forEach(id => setChecked(id, true));

  // Clear contenteditable editors
  document.querySelectorAll('.iptc-editable-template').forEach(el => {
    el.innerHTML = '';
  });

  // Clear previews
  const captionPreview = document.getElementById('iptc-caption-preview');
  const personPreview = document.getElementById('iptc-person-preview');
  if (captionPreview) { captionPreview.textContent = ''; captionPreview.style.display = 'none'; }
  if (personPreview) { personPreview.textContent = ''; personPreview.style.display = 'none'; }

  updateIptcToggleStatus(false);
}

// ============================================================
// Collect IPTC data from form
// ============================================================
function collectIptcDataFromForm() {
  const data = {};
  let hasAnyValue = false;

  // Credits & Copyright
  assignIfNotEmpty(data, 'credit', getVal('iptc-credit'));
  assignIfNotEmpty(data, 'source', getVal('iptc-source'));
  assignIfNotEmpty(data, 'copyright', getVal('iptc-copyright'));
  assignIfNotEmpty(data, 'copyrightOwner', getVal('iptc-copyright-owner'));
  const copyrightMarked = getChecked('iptc-copyright-marked');
  if (copyrightMarked) data.copyrightMarked = true;
  assignIfNotEmpty(data, 'copyrightUrl', getVal('iptc-copyright-url'));

  // Creator & Contact
  assignIfNotEmpty(data, 'creator', getVal('iptc-creator'));
  assignIfNotEmpty(data, 'authorsPosition', getVal('iptc-authors-position'));
  assignIfNotEmpty(data, 'contactEmail', getVal('iptc-contact-email'));
  assignIfNotEmpty(data, 'contactPhone', getVal('iptc-contact-phone'));
  assignIfNotEmpty(data, 'contactWebsite', getVal('iptc-contact-website'));
  assignIfNotEmpty(data, 'contactAddress', getVal('iptc-contact-address'));
  assignIfNotEmpty(data, 'contactCity', getVal('iptc-contact-city'));
  assignIfNotEmpty(data, 'contactPostalCode', getVal('iptc-contact-postal-code'));
  assignIfNotEmpty(data, 'contactRegion', getVal('iptc-contact-region'));
  assignIfNotEmpty(data, 'contactCountry', getVal('iptc-contact-country'));

  // Event & Caption
  assignIfNotEmpty(data, 'headlineTemplate', getVal('iptc-headline'));
  assignIfNotEmpty(data, 'descriptionTemplate', getVal('iptc-description'));
  assignIfNotEmpty(data, 'eventTemplate', getVal('iptc-event'));
  assignIfNotEmpty(data, 'captionWriter', getVal('iptc-caption-writer'));
  assignIfNotEmpty(data, 'category', getVal('iptc-category'));
  assignIfNotEmpty(data, 'urgency', getVal('iptc-urgency'));
  assignIfNotEmpty(data, 'intellectualGenre', getVal('iptc-genre'));
  assignIfNotEmpty(data, 'dateCreated', getVal('iptc-date-created'));

  // Location
  assignIfNotEmpty(data, 'city', getVal('iptc-city'));
  assignIfNotEmpty(data, 'country', getVal('iptc-country'));
  assignIfNotEmpty(data, 'countryCode', getVal('iptc-country-code'));
  assignIfNotEmpty(data, 'location', getVal('iptc-location'));
  assignIfNotEmpty(data, 'provinceState', getVal('iptc-province-state'));
  assignIfNotEmpty(data, 'worldRegion', getVal('iptc-world-region'));

  // Keywords
  if (iptcKeywordsList.length > 0) {
    data.baseKeywords = [...iptcKeywordsList];
  }
  const keywordsMode = document.querySelector('input[name="iptc-keywords-mode"]:checked')?.value;
  data.appendKeywords = keywordsMode !== 'overwrite';
  data.includeVisualTags = getChecked('iptc-include-visual-tags');

  // Person Shown
  assignIfNotEmpty(data, 'personShownTemplate', getVal('iptc-person-shown'));

  // Rights
  assignIfNotEmpty(data, 'digitalSourceType', getVal('iptc-digital-source'));
  assignIfNotEmpty(data, 'modelReleaseStatus', getVal('iptc-model-release'));

  // Check if there's any actual data
  hasAnyValue = Object.keys(data).some(k => {
    if (k === 'appendKeywords' || k === 'includeVisualTags') return false;
    const v = data[k];
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'boolean') return v;
    return v !== undefined && v !== null && v !== '';
  });

  return hasAnyValue ? data : null;
}

// ============================================================
// Import from XMP
// ============================================================
async function importIptcFromXmp() {
  try {
    const response = await window.api.invoke('preset-iptc-import-xmp');
    if (!response.success) {
      if (response.error && !response.error.includes('cancelled')) {
        showNotification('Error importing XMP: ' + response.error, 'error');
      }
      return;
    }

    if (response.data) {
      loadIptcDataIntoForm(response.data);

      // Expand section if collapsed
      if (!iptcSectionExpanded) {
        toggleIptcSection();
      }

      showNotification('IPTC profile imported from XMP file!', 'success');
    }
  } catch (error) {
    console.error('[IPTC Editor] Error importing XMP:', error);
    showNotification('Error importing XMP file', 'error');
  }
}

// ============================================================
// Save IPTC data (called from savePreset)
// ============================================================
async function saveIptcMetadata(presetId) {
  const iptcData = collectIptcDataFromForm();

  try {
    const response = await window.api.invoke('preset-iptc-save', presetId, iptcData);

    if (!response.success) {
      console.error('[IPTC Editor] Error saving IPTC metadata:', response.error);
    }
  } catch (error) {
    console.error('[IPTC Editor] Error saving IPTC metadata:', error);
  }
}

// ============================================================
// Status badge
// ============================================================
function updateIptcToggleStatus(configured) {
  const status = document.getElementById('iptc-toggle-status');
  if (!status) return;

  if (configured) {
    status.textContent = 'Configured';
    status.classList.add('iptc-status-active');
    status.classList.remove('iptc-status-inactive');
  } else {
    status.textContent = 'Not configured';
    status.classList.remove('iptc-status-active');
    status.classList.add('iptc-status-inactive');
  }
}

// ============================================================
// Helpers
// ============================================================
function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
  // Sync to contenteditable editor if one exists
  const editor = document.getElementById(id + '-editor');
  if (editor && editor.classList.contains('iptc-editable-template')) {
    renderEditableHighlights(editor, value || '');
  }
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function assignIfNotEmpty(obj, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    obj[key] = value;
  }
}

function escapeHtmlIptc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Contenteditable template fields with inline highlighting
// ============================================================
let editableDelegationSetup = false;

/**
 * Initialize contenteditable template editors.
 * Sets up input delegation to sync text to hidden fields and re-render highlights.
 */
function initEditableTemplates() {
  if (editableDelegationSetup) return;
  editableDelegationSetup = true;

  // Input handler: sync text to hidden field, debounced re-render with highlights
  let editableRenderTimer = null;
  document.addEventListener('input', (e) => {
    const editor = e.target.closest('.iptc-editable-template');
    if (!editor) return;
    syncEditableToHidden(editor);

    // Debounced highlight re-render (avoids disrupting typing)
    clearTimeout(editableRenderTimer);
    editableRenderTimer = setTimeout(() => {
      const text = getEditableText(editor);
      const offset = saveCursorOffset(editor);
      renderEditableHighlights(editor, text);
      restoreCursorOffset(editor, offset);
    }, 400);
  });

  // Prevent Enter in single-line editables
  document.addEventListener('keydown', (e) => {
    const editor = e.target.closest('.iptc-editable-single');
    if (!editor) return;
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  });

  // Prevent shortcut buttons from stealing focus from contenteditable editors.
  // This keeps the cursor position intact so insertions happen where expected.
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.template-shortcut-btn')) {
      e.preventDefault();
    }
  });

  // Paste: strip formatting, insert plain text
  document.addEventListener('paste', (e) => {
    const editor = e.target.closest('.iptc-editable-template');
    if (!editor) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    // For single-line, remove newlines
    const cleanText = editor.classList.contains('iptc-editable-single')
      ? text.replace(/[\r\n]+/g, ' ')
      : text;
    document.execCommand('insertText', false, cleanText);
  });

  // On blur: re-render highlights (clean up any formatting artifacts)
  document.addEventListener('focusout', (e) => {
    const editor = e.target.closest('.iptc-editable-template');
    if (!editor) return;
    const text = getEditableText(editor);
    renderEditableHighlights(editor, text);
  });
}

/**
 * Get plain text from a contenteditable div.
 * Converts <br> to newlines and strips any HTML.
 */
function getEditableText(editor) {
  // Use innerText which preserves line breaks from <br> and block elements
  return (editor.innerText || '').replace(/\n$/, '');
}

/**
 * Sync the contenteditable editor content to its hidden input/textarea.
 * Also triggers preview update.
 */
function syncEditableToHidden(editor) {
  const targetId = editor.dataset.target;
  if (!targetId) return;
  const hidden = document.getElementById(targetId);
  if (!hidden) return;
  const text = getEditableText(editor);
  hidden.value = text;
  // Trigger preview update
  hidden.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Render highlighted placeholders inside a contenteditable editor.
 * Preserves plain text, wraps valid placeholders in .placeholder-token spans.
 */
function renderEditableHighlights(editor, text) {
  if (!text) {
    editor.innerHTML = '';
    return;
  }

  const validPlaceholders = typeof VALID_PLACEHOLDERS !== 'undefined'
    ? VALID_PLACEHOLDERS
    : ['{name}', '{number}', '{team}', '{car_model}', '{nationality}', '{category}'];

  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  // Split by lines for multiline support
  const lines = text.split('\n');
  const htmlLines = lines.map(line => {
    const regex = /(\{[a-z_]+\})/g;
    let html = '';
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        html += escapeHtml(line.slice(lastIndex, match.index));
      }
      const token = match[1];
      if (validPlaceholders.includes(token)) {
        html += `<span class="placeholder-token">${escapeHtml(token)}</span>`;
      } else {
        html += escapeHtml(token);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) {
      html += escapeHtml(line.slice(lastIndex));
    }
    return html;
  });

  editor.innerHTML = htmlLines.join('<br>');
}

/**
 * Insert text at the current cursor position in a contenteditable editor.
 * After insertion, re-syncs to hidden field and triggers preview update.
 */
function insertIntoEditable(editor, text) {
  editor.focus();

  // If no selection exists inside the editor (e.g. user clicked a button
  // without having previously focused the editor), place cursor at the end
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false); // collapse to end
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Use execCommand for undo-able insertion
  document.execCommand('insertText', false, text);

  // Sync after a tick to ensure DOM is updated
  setTimeout(() => {
    syncEditableToHidden(editor);
    // Re-render on blur will handle highlights; for immediate feedback, do it now
    const fullText = getEditableText(editor);
    const cursorOffset = saveCursorOffset(editor);
    renderEditableHighlights(editor, fullText);
    restoreCursorOffset(editor, cursorOffset);
  }, 0);
}

/**
 * Save cursor offset (character count from start) in a contenteditable element.
 */
function saveCursorOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * Restore cursor to a character offset in a contenteditable element.
 */
function restoreCursorOffset(el, offset) {
  const sel = window.getSelection();
  const range = document.createRange();
  let current = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (current + node.length >= offset) {
      range.setStart(node, offset - current);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    current += node.length;
  }
  // If offset exceeds content, place at end
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ============================================================
// Initialization
// ============================================================
function initIptcEditor() {
  initIptcKeywordsInput();
  initIptcPreviews();
  initTemplateShortcutButtons();
  initEditableTemplates();
  // Initialize placeholder highlighting on template fields
  if (typeof initTemplateHighlights === 'function') {
    initTemplateHighlights();
  }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIptcEditor);
} else {
  // Small delay to ensure DOM elements from page templates are loaded
  setTimeout(initIptcEditor, 200);
}
