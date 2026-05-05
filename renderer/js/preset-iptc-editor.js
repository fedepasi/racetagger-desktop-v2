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
    if (!targetId) return;

    // Resolve target editor / field once.
    const editor = document.getElementById(targetId + '-editor');
    const isEditable = editor && editor.classList.contains('iptc-editable-template');
    const field = isEditable ? null : document.getElementById(targetId);

    // Action: "wrap" — wrap current selection in `before` … `after` markers.
    // Used by the "Insert per-car block" button to add `[[ ]]` around a
    // selection (or just insert the empty wrapper at cursor if no selection).
    // Configured via `data-action="wrap"` plus `data-wrap-before` / `data-wrap-after`.
    if (btn.dataset.action === 'wrap') {
      const before = btn.dataset.wrapBefore || '';
      const after = btn.dataset.wrapAfter || '';
      if (isEditable) {
        wrapSelectionInEditable(editor, before, after);
      } else if (field) {
        wrapSelectionInField(field, before, after);
      }
      return;
    }

    // Default action: "insert" — insert a placeholder at the cursor position.
    const placeholder = btn.dataset.placeholder;
    if (!placeholder) return;

    if (isEditable) {
      insertIntoEditable(editor, placeholder);
      return;
    }

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
 * Wrap the current selection inside a contenteditable editor with `before`
 * and `after` markers. If nothing is selected, the markers are inserted at
 * the cursor position (with cursor placed between them so the user can type
 * the inner content immediately).
 */
function wrapSelectionInEditable(editor, before, after) {
  editor.focus();

  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    // No active selection in this editor — drop cursor at end and just insert
    // the empty wrapper, then move cursor between markers.
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const selectedText = sel.toString();
  // Use execCommand so the wrap participates in the editor's undo stack.
  document.execCommand('insertText', false, before + selectedText + after);

  // After insertion, move the cursor between `before` and `after` (only
  // meaningful when nothing was selected — when there was selection, the
  // selection is replaced by the wrapped text, cursor lands at the end).
  if (!selectedText) {
    // Move cursor back by `after.length` characters so the user types inside.
    const sel2 = window.getSelection();
    if (sel2.rangeCount > 0) {
      const range = sel2.getRangeAt(0);
      // Walk back across text nodes by `after.length` chars. For our use case
      // (`after = "]]"`, 2 chars) this is fine; selection collapses inside the
      // current text node which is ample.
      try {
        range.setStart(range.endContainer, Math.max(0, range.endOffset - after.length));
        range.collapse(true);
        sel2.removeAllRanges();
        sel2.addRange(range);
      } catch (e) {
        // If anything goes wrong with the range manipulation, leave the
        // cursor where it is — non-blocking, just slightly less ergonomic.
      }
    }
  }

  setTimeout(() => {
    syncEditableToHidden(editor);
    const fullText = getEditableText(editor);
    const cursorOffset = saveCursorOffset(editor);
    renderEditableHighlights(editor, fullText);
    restoreCursorOffset(editor, cursorOffset);
  }, 0);
}

/**
 * Wrap the current selection in a regular <input>/<textarea> field with
 * `before` and `after` markers. Mirrors {@link wrapSelectionInEditable} for
 * the non-contenteditable case.
 */
function wrapSelectionInField(field, before, after) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const selected = field.value.substring(start, end);
  const beforeText = field.value.substring(0, start);
  const afterText = field.value.substring(end);

  field.value = beforeText + before + selected + after + afterText;

  // Cursor / selection placement:
  // - With selection: select the wrapped text (excluding the markers)
  // - Without selection: place cursor between `before` and `after`
  if (selected) {
    field.setSelectionRange(start + before.length, start + before.length + selected.length);
  } else {
    const newPos = start + before.length;
    field.setSelectionRange(newPos, newPos);
  }
  field.focus();
  field.dispatchEvent(new Event('input', { bubbles: true }));
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

  // No placeholders AND no repeat blocks in template — nothing to preview
  const hasPlaceholders = template.includes('{');
  const hasRepeatBlock = template.includes('[[');
  if (!hasPlaceholders && !hasRepeatBlock) {
    preview.innerHTML = '';
    preview.style.display = 'none';
    return;
  }

  const hasParticipants = typeof participantsData !== 'undefined' && participantsData.length > 0;
  let html = '';

  if (!hasParticipants) {
    html += '<div class="preview-example"><span class="preview-hint">Add participants to see a live preview</span></div>';
    preview.innerHTML = html;
    preview.style.display = 'block';
    return;
  }

  // Always render a "single participant" example using the first row.
  const first = normalizeParticipantForTemplate(participantsData[0]);
  const singleResolved = resolveIptcTemplate(template, [first]);
  html += '<div class="preview-example"><span class="preview-label">Example (1 pilot):</span> ' +
    escapeHtmlPreview(singleResolved) + '</div>';

  // If the template uses [[ ]] AND we have at least 2 participants, also render
  // a multi-pilot example so the user can see how the block expands. This is
  // crucial for templates designed to handle multi-match images (e.g. WEC, IMSA,
  // endurance racing where two cars frequently appear in the same frame).
  if (hasRepeatBlock && participantsData.length >= 2) {
    const second = normalizeParticipantForTemplate(participantsData[1]);
    const multiResolved = resolveIptcTemplate(template, [first, second]);
    html += '<div class="preview-example preview-example-multi">' +
      '<span class="preview-label">Example (2 pilots):</span> ' +
      escapeHtmlPreview(multiResolved) + '</div>';
  } else if (hasRepeatBlock && participantsData.length < 2) {
    // Friendly hint for users who used [[ ]] but only have 1 participant in the preset
    html += '<div class="preview-example preview-example-hint">' +
      '<span class="preview-hint">Add a second participant to preview how the [[ ]] block expands across multiple pilots</span></div>';
  }

  preview.innerHTML = html;
  preview.style.display = 'block';
}

/**
 * Convert a row from participantsData (DB-shaped, Italian field names) into
 * the participant shape consumed by template substitution. Centralized here
 * so that the live preview uses the same field mapping as the backend.
 */
function normalizeParticipantForTemplate(row) {
  if (!row) return null;
  let driverName = row.nome || '';
  if (Array.isArray(row.drivers) && row.drivers.length > 0) {
    driverName = row.drivers[0];
  }
  return {
    name: driverName,
    surname: driverName ? driverName.split(' ').pop() : '',
    number: row.numero || '',
    team: row.squadra || '',
    category: row.categoria || '',
    nationality: row.nationality || '',
    car_model: row.car_model || '',
    tag: row.metatag || '',
  };
}

/**
 * Substitute the participant variables in a string using a single participant.
 * Used both inside [[ ]] block iterations and for top-level (non-block) text.
 *
 * Mirrors the renderer subset of the TS helper `renderBlockForParticipant`
 * (with the renderer-specific extras `{category}` and `{tag}`). Unknown
 * placeholders are left untouched for the outer cleanup pass.
 */
function substituteParticipantVarsForPreview(text, p) {
  return text
    .replace(/\{name\}/gi, p.name || '')
    .replace(/\{surname\}/gi, p.surname || '')
    .replace(/\{number\}/gi, p.number || '')
    .replace(/\{team\}/gi, p.team || '')
    .replace(/\{category\}/gi, p.category || '')
    .replace(/\{nationality\}/gi, p.nationality || '')
    .replace(/\{car_model\}/gi, p.car_model || '')
    .replace(/\{tag\}/gi, p.tag || '')
    // {persons} in preview falls back to driver name (the renderer doesn't
    // build the full extended-name string here — keeps the preview light).
    .replace(/\{persons\}/gi, p.name || '');
}

/**
 * Expand `[[ ... ]]` blocks in a template using the provided participant list.
 * JS port of the TypeScript helper {@link expandPerParticipantBlocks} for the
 * live preview. Behavior must stay aligned with the backend: same separator,
 * same emptiness handling, same single-vs-multi semantics.
 */
function expandPerParticipantBlocksForPreview(template, participants, separator = ', ') {
  if (!template || !template.includes('[[')) return template;

  return template.replace(/\[\[([\s\S]*?)\]\]/g, (_match, blockContent) => {
    if (!participants || participants.length === 0) return '';
    return participants
      .map(p => substituteParticipantVarsForPreview(blockContent, p))
      .join(separator);
  });
}

/**
 * Resolve a template string for the preview.
 *
 * - If the template contains `[[ ... ]]` and we have a participant list, the
 *   block is rendered once per provided participant (joined by ", ").
 * - Variables OUTSIDE blocks are substituted with the FIRST participant's
 *   values, mirroring the backend behavior in the single-match path. (For
 *   the multi-pilot variant of the preview the caller passes 2 participants
 *   and uses the first as the "outer" participant to keep the example
 *   readable; this matches the backend's aggregated-participant convention
 *   only approximately, but it's good enough for editor preview purposes.)
 *
 * @param {string} template
 * @param {Array<object>} normalizedParticipants 1 or more normalized participants.
 *        If omitted, falls back to `participantsData[0]` (legacy preview
 *        behavior, single example).
 */
function resolveIptcTemplate(template, normalizedParticipants) {
  // Resolve the participant list to use.
  let list = normalizedParticipants;
  if (!list || list.length === 0) {
    const hasParticipants = typeof participantsData !== 'undefined' && participantsData.length > 0;
    if (!hasParticipants) return template;
    const single = normalizeParticipantForTemplate(participantsData[0]);
    if (!single) return template;
    list = [single];
  }

  // Step 1: expand [[ ]] blocks per participant.
  let result = expandPerParticipantBlocksForPreview(template, list);

  // Step 2: substitute outer variables using the FIRST participant.
  result = substituteParticipantVarsForPreview(result, list[0]);

  // Step 3: cleanup
  return result
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

  // Writing behavior overrides
  setVal('iptc-writing-timing', iptcMetadata.writingTiming || 'default');
  setVal('iptc-face-scope', iptcMetadata.faceScope || 'default');
  updateBehaviorDefaultHints();

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

  // Reset behavior selects to default
  setVal('iptc-writing-timing', 'default');
  setVal('iptc-face-scope', 'default');
  updateBehaviorDefaultHints();

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

  // Writing behavior overrides (only save non-default values)
  const writingTiming = getVal('iptc-writing-timing');
  if (writingTiming && writingTiming !== 'default') {
    data.writingTiming = writingTiming;
  }
  const faceScope = getVal('iptc-face-scope');
  if (faceScope && faceScope !== 'default') {
    data.faceScope = faceScope;
  }

  // Check if there's any actual data
  hasAnyValue = Object.keys(data).some(k => {
    if (k === 'appendKeywords' || k === 'includeVisualTags' || k === 'writingTiming' || k === 'faceScope') return false;
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

// ============================================================
// Behavior default hints
// ============================================================

/**
 * Update the "Use app default" option text to show current default value.
 * Reads from SettingsManager if available, otherwise localStorage directly.
 */
function updateBehaviorDefaultHints() {
  let defaults = { autoWrite: false, faceOnly: true };
  try {
    if (typeof SettingsManager !== 'undefined' && SettingsManager.getIptcProDefaults) {
      defaults = SettingsManager.getIptcProDefaults();
    } else {
      const stored = localStorage.getItem('iptc-pro-defaults');
      if (stored) defaults = JSON.parse(stored);
    }
  } catch (e) { /* use fallback defaults */ }

  // Update writing timing default option text
  const timingSelect = document.getElementById('iptc-writing-timing');
  if (timingSelect) {
    const defaultOption = timingSelect.querySelector('option[value="default"]');
    if (defaultOption) {
      const timingLabel = defaults.autoWrite ? 'Automatic' : 'Manual';
      defaultOption.textContent = `Use app default (${timingLabel})`;
    }
  }

  // Update face scope default option text
  const faceSelect = document.getElementById('iptc-face-scope');
  if (faceSelect) {
    const defaultOption = faceSelect.querySelector('option[value="default"]');
    if (defaultOption) {
      const faceLabel = defaults.faceOnly ? 'Recognized only' : 'All participants';
      defaultOption.textContent = `Use app default (${faceLabel})`;
    }
  }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIptcEditor);
} else {
  // Small delay to ensure DOM elements from page templates are loaded
  setTimeout(initIptcEditor, 200);
}
