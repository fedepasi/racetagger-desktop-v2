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
}

// ============================================================
// Keywords tag input
// ============================================================
function initIptcKeywordsInput() {
  const input = document.getElementById('iptc-keywords-input');
  if (!input) return;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const value = input.value.replace(/,/g, '').trim();
      if (value && !iptcKeywordsList.includes(value)) {
        iptcKeywordsList.push(value);
        renderIptcKeywordsTags();
      }
      input.value = '';
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
function initIptcPreviews() {
  const descInput = document.getElementById('iptc-description');
  const personInput = document.getElementById('iptc-person-shown');

  if (descInput) {
    descInput.addEventListener('input', updateCaptionPreview);
  }
  if (personInput) {
    personInput.addEventListener('input', updatePersonPreview);
  }
}

function updateCaptionPreview() {
  const template = document.getElementById('iptc-description')?.value || '';
  const preview = document.getElementById('iptc-caption-preview');
  if (!preview) return;

  if (!template.includes('{')) {
    preview.textContent = '';
    return;
  }

  const resolved = resolveIptcTemplate(template);
  preview.textContent = 'Preview: ' + resolved;
  preview.style.display = 'block';
}

function updatePersonPreview() {
  const template = document.getElementById('iptc-person-shown')?.value || '';
  const preview = document.getElementById('iptc-person-preview');
  if (!preview) return;

  if (!template.includes('{')) {
    preview.textContent = '';
    return;
  }

  const resolved = resolveIptcTemplate(template);
  preview.textContent = 'Preview: ' + resolved;
  preview.style.display = 'block';
}

function resolveIptcTemplate(template) {
  // Use first participant from current preset data as preview, or fallback
  const sampleParticipant = (typeof participantsData !== 'undefined' && participantsData.length > 0)
    ? participantsData[0]
    : { nome: 'Max Verstappen', numero: '1', squadra: 'Red Bull Racing', categoria: 'F1' };

  let driverName = sampleParticipant.nome || 'Person Name';
  if (sampleParticipant.drivers && sampleParticipant.drivers.length > 0) {
    driverName = sampleParticipant.drivers[0];
  }

  return template
    .replace(/\{name\}/gi, driverName)
    .replace(/\{number\}/gi, sampleParticipant.numero || '1')
    .replace(/\{team\}/gi, sampleParticipant.squadra || 'Team Name')
    .replace(/\{category\}/gi, sampleParticipant.categoria || 'Category')
    .replace(/\{nationality\}/gi, sampleParticipant.nationality || '')
    .replace(/\{car_model\}/gi, sampleParticipant.car_model || '')
    .replace(/\{surname\}/gi, driverName.split(' ').pop() || '');
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

  // Person Shown
  setVal('iptc-person-shown', iptcMetadata.personShownTemplate);

  // Rights
  setVal('iptc-digital-source', iptcMetadata.digitalSourceType);
  setVal('iptc-model-release', iptcMetadata.modelReleaseStatus);

  // Update previews
  updateCaptionPreview();
  updatePersonPreview();

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

  // Reset radio to append
  const radio = document.querySelector('input[name="iptc-keywords-mode"][value="append"]');
  if (radio) radio.checked = true;

  // Reset all section checkboxes to checked
  ['iptc-section-credits', 'iptc-section-creator', 'iptc-section-event',
   'iptc-section-location', 'iptc-section-keywords', 'iptc-section-person',
   'iptc-section-rights'].forEach(id => setChecked(id, true));

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

  // Person Shown
  assignIfNotEmpty(data, 'personShownTemplate', getVal('iptc-person-shown'));

  // Rights
  assignIfNotEmpty(data, 'digitalSourceType', getVal('iptc-digital-source'));
  assignIfNotEmpty(data, 'modelReleaseStatus', getVal('iptc-model-release'));

  // Check if there's any actual data
  hasAnyValue = Object.keys(data).some(k => {
    if (k === 'appendKeywords') return false;
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
    const response = await window.api.invoke('preset-iptc-save', {
      presetId: presetId,
      iptcMetadata: iptcData  // null clears it, object saves it
    });

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
// Initialization
// ============================================================
function initIptcEditor() {
  initIptcKeywordsInput();
  initIptcPreviews();
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIptcEditor);
} else {
  // Small delay to ensure DOM elements from page templates are loaded
  setTimeout(initIptcEditor, 200);
}
