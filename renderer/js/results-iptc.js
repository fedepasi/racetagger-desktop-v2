/**
 * Results IPTC Pro Panel
 *
 * Renders the "IPTC Pro" finalization panel on the results page.
 * When the preset has an IPTC profile configured, the user can review/edit
 * IPTC fields and trigger a batch write to all images.
 */

// ============================================================
// Constants
// ============================================================
const RAW_EXTENSIONS_CLIENT = new Set(['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng']);

function isRawFileClient(filePath) {
  if (!filePath) return false;
  const ext = filePath.split('.').pop().toLowerCase();
  return RAW_EXTENSIONS_CLIENT.has(ext);
}

// ============================================================
// State
// ============================================================
let iptcProModal = null;
let iptcProKeywordsList = [];
let iptcProPresetData = null;
let iptcProIptcMetadata = null;
let iptcProIsWriting = false;

// ============================================================
// Button visibility
// ============================================================
function showIptcProButton() {
  const btn = document.getElementById('btn-iptc-pro');
  if (btn) btn.style.display = '';
}

function hideIptcProButton() {
  const btn = document.getElementById('btn-iptc-pro');
  if (btn) btn.style.display = 'none';
}

/**
 * Called after results page loads to check if IPTC Pro button should show.
 * It checks if the preset used for the execution has iptc_metadata configured.
 */
async function checkIptcProAvailability() {
  try {
    const lv = window.logVisualizer;
    if (!lv || !lv.participantPresetData) return;

    const presetData = lv.participantPresetData;

    // Make preset participants available for multi-match enrichment
    if (presetData.participants) {
      window.currentPresetParticipants = presetData.participants;
    }

    if (presetData.iptc_metadata && Object.keys(presetData.iptc_metadata).length > 0) {
      iptcProPresetData = presetData;
      iptcProIptcMetadata = presetData.iptc_metadata;
      showIptcProButton();
      console.log('[IPTC Pro] Button enabled — preset has IPTC metadata profile');
    } else {
      console.log('[IPTC Pro] No IPTC metadata profile in preset');
    }
  } catch (error) {
    console.error('[IPTC Pro] Error checking availability:', error);
  }
}

// ============================================================
// Modal creation
// ============================================================
function openIptcProModal() {
  if (iptcProIsWriting) return;
  if (!iptcProIptcMetadata) {
    alert('No IPTC metadata profile configured for this preset.');
    return;
  }

  // Save unsaved changes first
  if (window.logVisualizer && window.logVisualizer.hasUnsavedChanges) {
    const confirmed = confirm('You have unsaved corrections. Save them before writing IPTC? (Recommended)');
    if (confirmed) {
      window.logVisualizer.saveAllChanges().then(() => {
        createIptcProModal();
      }).catch(err => {
        console.error('[IPTC Pro] Error saving changes:', err);
        createIptcProModal();
      });
      return;
    }
  }

  createIptcProModal();
}

function createIptcProModal() {
  // Remove existing
  if (iptcProModal) {
    iptcProModal.remove();
    iptcProModal = null;
  }

  const lv = window.logVisualizer;
  const results = lv ? lv.imageResults : [];
  const matchedCount = results.filter(r => r.analysis && r.analysis.length > 0 && r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A')).length;
  const totalCount = results.length;
  const unmatchedCount = totalCount - matchedCount;

  const m = iptcProIptcMetadata;

  // Initialize keywords
  iptcProKeywordsList = m.baseKeywords ? [...m.baseKeywords] : [];

  const overlay = document.createElement('div');
  overlay.className = 'iptc-pro-overlay';
  overlay.innerHTML = `
    <div class="iptc-pro-modal">
      <div class="iptc-pro-header">
        <div class="iptc-pro-header-left">
          <div class="iptc-pro-badge">📋 IPTC PRO</div>
          <h2>IPTC Metadata Finalization</h2>
          <span class="iptc-pro-preset-name">Preset: ${escapeHtml(iptcProPresetData?.name || 'Unknown')}</span>
          <span class="iptc-pro-stats">${totalCount} images (${matchedCount} matched, ${unmatchedCount} unmatched)</span>
        </div>
        <button class="iptc-pro-close" id="iptc-pro-close">&times;</button>
      </div>

      <div class="iptc-pro-body">
        <!-- 4-column grid -->
        <div class="iptc-pro-grid">
          <!-- Credits & Copyright -->
          <div class="iptc-pro-col">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-credits" checked> Credits & Copyright</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="ipf"><label>Credit</label><input type="text" id="ipf-credit" value="${escapeAttr(m.credit)}"></div>
              <div class="ipf"><label>Source</label><input type="text" id="ipf-source" value="${escapeAttr(m.source)}"></div>
              <div class="ipf"><label>Copyright</label><input type="text" id="ipf-copyright" value="${escapeAttr(m.copyright)}"></div>
              <div class="ipf"><label>Owner</label><input type="text" id="ipf-copyright-owner" value="${escapeAttr(m.copyrightOwner)}"></div>
            </div>
          </div>

          <!-- Creator & Contact -->
          <div class="iptc-pro-col">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-creator" checked> Creator & Contact</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="ipf"><label>Creator</label><input type="text" id="ipf-creator" value="${escapeAttr(m.creator)}"></div>
              <div class="ipf"><label>Position</label><input type="text" id="ipf-authors-position" value="${escapeAttr(m.authorsPosition)}"></div>
              <div class="ipf"><label>Email</label><input type="text" id="ipf-contact-email" value="${escapeAttr(m.contactEmail)}"></div>
              <div class="ipf"><label>Phone</label><input type="text" id="ipf-contact-phone" value="${escapeAttr(m.contactPhone)}"></div>
              <div class="ipf"><label>Website</label><input type="text" id="ipf-contact-website" value="${escapeAttr(m.contactWebsite)}"></div>
            </div>
          </div>

          <!-- Event & Caption -->
          <div class="iptc-pro-col">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-event" checked> Event & Caption</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="ipf"><label>Headline</label><input type="text" id="ipf-headline" value="${escapeAttr(m.headlineTemplate)}"></div>
              <div class="ipf"><label>Caption</label><textarea id="ipf-description" rows="2">${escapeHtml(m.descriptionTemplate || '')}</textarea></div>
              <div class="ipf"><label>Event</label><input type="text" id="ipf-event" value="${escapeAttr(m.eventTemplate)}"></div>
              <div class="ipf ipf-row">
                <div class="ipf"><label>Cat</label><input type="text" id="ipf-category" value="${escapeAttr(m.category)}"></div>
                <div class="ipf"><label>Urg</label><input type="text" id="ipf-urgency" value="${escapeAttr(m.urgency)}"></div>
              </div>
            </div>
          </div>

          <!-- Location -->
          <div class="iptc-pro-col">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-location" checked> Location</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="ipf"><label>City</label><input type="text" id="ipf-city" value="${escapeAttr(m.city)}"></div>
              <div class="ipf"><label>Country</label><input type="text" id="ipf-country" value="${escapeAttr(m.country)}"></div>
              <div class="ipf"><label>Code</label><input type="text" id="ipf-country-code" value="${escapeAttr(m.countryCode)}" maxlength="3"></div>
              <div class="ipf"><label>Sub-location</label><input type="text" id="ipf-location" value="${escapeAttr(m.location)}"></div>
              <div class="ipf"><label>State</label><input type="text" id="ipf-province-state" value="${escapeAttr(m.provinceState)}"></div>
              <div class="ipf"><label>Region</label><input type="text" id="ipf-world-region" value="${escapeAttr(m.worldRegion)}"></div>
            </div>
          </div>
        </div>

        <!-- Second row: Keywords + Person + Rights -->
        <div class="iptc-pro-grid iptc-pro-grid-bottom">
          <div class="iptc-pro-col iptc-pro-col-wide">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-keywords" checked> Keywords</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="iptc-pro-tags-wrap" id="iptc-pro-keywords-wrap">
                <span id="iptc-pro-keywords-tags"></span>
                <input type="text" id="iptc-pro-keywords-input" placeholder="Add keyword...">
              </div>
              <div class="ipf-radio-row">
                <label><input type="radio" name="ipf-kw-mode" value="append" ${m.appendKeywords !== false ? 'checked' : ''}> Merge with existing keywords</label>
                <label><input type="radio" name="ipf-kw-mode" value="overwrite" ${m.appendKeywords === false ? 'checked' : ''}> Replace all keywords</label>
              </div>
            </div>
          </div>

          <div class="iptc-pro-col">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-person" checked> Person Shown</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="ipf"><label>Template</label><input type="text" id="ipf-person-shown" value="${escapeAttr(m.personShownTemplate)}"></div>
            </div>
          </div>

          <div class="iptc-pro-col">
            <div class="iptc-pro-col-head">
              <label><input type="checkbox" id="iptc-pro-sec-rights" checked> Rights</label>
            </div>
            <div class="iptc-pro-col-body">
              <div class="ipf"><label>Source Type</label>
                <select id="ipf-digital-source">
                  <option value="">-</option>
                  <option value="digitalCapture" ${m.digitalSourceType === 'digitalCapture' ? 'selected' : ''}>Digital Capture</option>
                </select>
              </div>
              <div class="ipf"><label>Model Release</label>
                <select id="ipf-model-release">
                  <option value="">-</option>
                  <option value="MR-NON" ${m.modelReleaseStatus === 'MR-NON' ? 'selected' : ''}>MR-NON</option>
                  <option value="MR-NAP" ${m.modelReleaseStatus === 'MR-NAP' ? 'selected' : ''}>MR-NAP</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="iptc-pro-footer">
        <div class="iptc-pro-footer-left">
          <label class="ipf-radio-row">
            <input type="radio" name="ipf-scope" value="matched" checked>
            <span>Matched files only (${matchedCount})</span>
          </label>
          <label class="ipf-radio-row">
            <input type="radio" name="ipf-scope" value="all">
            <span>All files (${totalCount})</span>
          </label>
        </div>
        <div class="iptc-pro-footer-right">
          <button class="btn-iptc-cancel" id="iptc-pro-cancel">Cancel</button>
          <button class="btn-iptc-write" id="iptc-pro-write">
            📋 IPTC Pro — Write ${totalCount} files
          </button>
        </div>
      </div>

      <!-- Progress overlay (hidden initially) -->
      <div class="iptc-pro-progress" id="iptc-pro-progress" style="display:none;">
        <h3 id="iptc-pro-progress-title">Writing IPTC metadata...</h3>
        <div class="iptc-pro-progress-bar">
          <div class="iptc-pro-progress-fill" id="iptc-pro-progress-fill"></div>
        </div>
        <p id="iptc-pro-progress-text">0 / 0</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  iptcProModal = overlay;

  // Render keywords
  renderIptcProKeywords();

  // Wire events
  document.getElementById('iptc-pro-close').addEventListener('click', closeIptcProModal);
  document.getElementById('iptc-pro-cancel').addEventListener('click', closeIptcProModal);
  document.getElementById('iptc-pro-write').addEventListener('click', startIptcProWrite);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !iptcProIsWriting) closeIptcProModal();
  });

  // Keywords input
  const kwInput = document.getElementById('iptc-pro-keywords-input');
  if (kwInput) {
    kwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = kwInput.value.replace(/,/g, '').trim();
        if (val && !iptcProKeywordsList.includes(val)) {
          iptcProKeywordsList.push(val);
          renderIptcProKeywords();
        }
        kwInput.value = '';
      }
    });
  }

  // Update write button count based on scope radio
  document.querySelectorAll('input[name="ipf-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const scope = document.querySelector('input[name="ipf-scope"]:checked')?.value;
      const count = scope === 'all' ? totalCount : matchedCount;
      document.getElementById('iptc-pro-write').textContent = `📋 IPTC Pro — Write ${count} files`;
    });
  });
}

function closeIptcProModal() {
  if (iptcProIsWriting) return;
  if (iptcProModal) {
    iptcProModal.remove();
    iptcProModal = null;
  }
}

// ============================================================
// Keywords rendering
// ============================================================
function renderIptcProKeywords() {
  const container = document.getElementById('iptc-pro-keywords-tags');
  if (!container) return;
  container.innerHTML = iptcProKeywordsList.map((kw, i) =>
    `<span class="iptc-pro-tag">${escapeHtml(kw)}<button onclick="removeIptcProKeyword(${i})">&times;</button></span>`
  ).join('');
}

function removeIptcProKeyword(index) {
  iptcProKeywordsList.splice(index, 1);
  renderIptcProKeywords();
}

// ============================================================
// Collect form data and trigger write
// ============================================================
function collectIptcProFormData() {
  const data = {};
  const getValue = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  // Credits
  if (getValue('ipf-credit')) data.credit = getValue('ipf-credit');
  if (getValue('ipf-source')) data.source = getValue('ipf-source');
  if (getValue('ipf-copyright')) data.copyright = getValue('ipf-copyright');
  if (getValue('ipf-copyright-owner')) data.copyrightOwner = getValue('ipf-copyright-owner');

  // Creator
  if (getValue('ipf-creator')) data.creator = getValue('ipf-creator');
  if (getValue('ipf-authors-position')) data.authorsPosition = getValue('ipf-authors-position');
  if (getValue('ipf-contact-email')) data.contactEmail = getValue('ipf-contact-email');
  if (getValue('ipf-contact-phone')) data.contactPhone = getValue('ipf-contact-phone');
  if (getValue('ipf-contact-website')) data.contactWebsite = getValue('ipf-contact-website');

  // Carry over contact fields from original metadata (not editable in finalization panel)
  const orig = iptcProIptcMetadata;
  if (orig.contactAddress) data.contactAddress = orig.contactAddress;
  if (orig.contactCity) data.contactCity = orig.contactCity;
  if (orig.contactRegion) data.contactRegion = orig.contactRegion;
  if (orig.contactPostalCode) data.contactPostalCode = orig.contactPostalCode;
  if (orig.contactCountry) data.contactCountry = orig.contactCountry;
  if (orig.copyrightMarked) data.copyrightMarked = orig.copyrightMarked;
  if (orig.copyrightUrl) data.copyrightUrl = orig.copyrightUrl;
  if (orig.captionWriter) data.captionWriter = orig.captionWriter;

  // Event
  if (getValue('ipf-headline')) data.headlineTemplate = getValue('ipf-headline');
  if (getValue('ipf-description')) data.descriptionTemplate = getValue('ipf-description');
  if (getValue('ipf-event')) data.eventTemplate = getValue('ipf-event');
  if (getValue('ipf-category')) data.category = getValue('ipf-category');
  if (getValue('ipf-urgency')) data.urgency = getValue('ipf-urgency');
  if (orig.intellectualGenre) data.intellectualGenre = orig.intellectualGenre;
  if (orig.dateCreated) data.dateCreated = orig.dateCreated;

  // Location
  if (getValue('ipf-city')) data.city = getValue('ipf-city');
  if (getValue('ipf-country')) data.country = getValue('ipf-country');
  if (getValue('ipf-country-code')) data.countryCode = getValue('ipf-country-code');
  if (getValue('ipf-location')) data.location = getValue('ipf-location');
  if (getValue('ipf-province-state')) data.provinceState = getValue('ipf-province-state');
  if (getValue('ipf-world-region')) data.worldRegion = getValue('ipf-world-region');

  // Keywords
  if (iptcProKeywordsList.length > 0) data.baseKeywords = [...iptcProKeywordsList];
  const kwMode = document.querySelector('input[name="ipf-kw-mode"]:checked')?.value;
  data.appendKeywords = kwMode !== 'overwrite';

  // Person Shown
  if (getValue('ipf-person-shown')) data.personShownTemplate = getValue('ipf-person-shown');

  // Rights
  if (getValue('ipf-digital-source')) data.digitalSourceType = getValue('ipf-digital-source');
  if (getValue('ipf-model-release')) data.modelReleaseStatus = getValue('ipf-model-release');

  return data;
}

function buildResultsForFinalization() {
  const lv = window.logVisualizer;
  if (!lv) return [];

  const scope = document.querySelector('input[name="ipf-scope"]:checked')?.value || 'matched';
  const allResults = lv.imageResults || [];

  // Get current preset participants for enrichment (car_model, nationality, etc.)
  const presetParticipants = window.currentPresetParticipants || [];

  return allResults
    .filter(r => {
      if (scope === 'all') return true;
      // Only matched: has analysis with a real race number
      return r.analysis && r.analysis.length > 0 && r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A');
    })
    .map(r => {
      const filePath = r.originalPath || r.imagePath || '';

      // Collect ALL matched participants from the analysis array
      const allMatchedParticipants = [];

      if (r.analysis && r.analysis.length > 0) {
        for (const vehicle of r.analysis) {
          if (!vehicle.raceNumber || vehicle.raceNumber === 'N/A') continue;

          const participant = {
            name: vehicle.drivers ? vehicle.drivers.join(', ') : '',
            number: vehicle.raceNumber || '',
            team: vehicle.team || ''
          };

          // Enrich from csvMatch (primary match) or preset participants lookup
          const presetMatch = presetParticipants.find(p =>
            p.numero === vehicle.raceNumber
          );

          if (presetMatch) {
            if (!participant.name && presetMatch.nome) participant.name = presetMatch.nome;
            if (presetMatch.car_model) participant.car_model = presetMatch.car_model;
            if (presetMatch.metatag) participant.metatag = presetMatch.metatag;
            if (presetMatch.sponsor) {
              participant.sponsors = typeof presetMatch.sponsor === 'string'
                ? presetMatch.sponsor.split(',').map(s => s.trim())
                : presetMatch.sponsor;
            }

            // Get nationality from first driver record
            if (presetMatch.preset_participant_drivers && presetMatch.preset_participant_drivers.length > 0) {
              const firstDriver = presetMatch.preset_participant_drivers[0];
              if (firstDriver.driver_nationality) {
                participant.nationality = firstDriver.driver_nationality;
              }
            }
          }

          // Also enrich from csvMatch for the primary vehicle
          if (r.csvMatch && vehicle === r.analysis[0]) {
            if (!participant.name && r.csvMatch.nome) participant.name = r.csvMatch.nome;
            if (r.csvMatch.categoria) participant.category = r.csvMatch.categoria;
            if (r.csvMatch.car_model) participant.car_model = r.csvMatch.car_model;
            if (r.csvMatch.sponsor && !participant.sponsors) {
              participant.sponsors = r.csvMatch.sponsor.split(',').map(s => s.trim());
            }
            if (r.csvMatch.metatag && !participant.metatag) participant.metatag = r.csvMatch.metatag;
          }

          allMatchedParticipants.push(participant);
        }
      }

      return {
        imagePath: filePath,
        isRaw: isRawFileClient(filePath),
        matchedParticipant: allMatchedParticipants.length > 0 ? allMatchedParticipants[0] : null,
        allMatchedParticipants: allMatchedParticipants.length > 0 ? allMatchedParticipants : undefined,
        aiKeywords: r.logEvent?.keywords || [],
        visualTags: r.logEvent?.visualTags || r.visualTags || undefined
      };
    })
    .filter(r => r.imagePath); // Skip entries without a file path
}

async function startIptcProWrite() {
  if (iptcProIsWriting) return;

  const iptcMetadata = collectIptcProFormData();
  const results = buildResultsForFinalization();

  if (results.length === 0) {
    alert('No files to process. Check that image paths are available.');
    return;
  }

  iptcProIsWriting = true;

  // Show progress
  const progressEl = document.getElementById('iptc-pro-progress');
  if (progressEl) progressEl.style.display = 'flex';

  // Disable write button
  const writeBtn = document.getElementById('iptc-pro-write');
  if (writeBtn) { writeBtn.disabled = true; writeBtn.textContent = 'Writing...'; }

  // Set up progress listener
  const cleanupProgress = window.api.receive('iptc-finalize-progress', (data) => {
    const { current, total, fileName } = data;
    const fill = document.getElementById('iptc-pro-progress-fill');
    const text = document.getElementById('iptc-pro-progress-text');
    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (text) text.textContent = `${current} / ${total} — ${fileName || ''}`;
  });

  const cleanupError = window.api.receive('iptc-finalize-error', (data) => {
    console.warn('[IPTC Pro] Error on file:', data.fileName, data.error);
  });

  try {
    const kwMode = document.querySelector('input[name="ipf-kw-mode"]:checked')?.value || 'append';

    const response = await window.api.invoke('iptc-finalize-batch', iptcMetadata, results, kwMode);

    if (response.success) {
      const summary = response.data;
      const title = document.getElementById('iptc-pro-progress-title');
      const text = document.getElementById('iptc-pro-progress-text');
      const fill = document.getElementById('iptc-pro-progress-fill');

      if (fill) fill.style.width = '100%';
      if (title) title.textContent = 'IPTC Finalization Complete!';
      if (text) {
        text.textContent = `${summary.successCount} files written successfully` +
          (summary.errorCount > 0 ? `, ${summary.errorCount} errors` : '') +
          ` (${(summary.durationMs / 1000).toFixed(1)}s)`;
      }

      // Wait a moment then close
      setTimeout(() => {
        iptcProIsWriting = false;
        closeIptcProModal();
      }, 2000);
    } else {
      throw new Error(response.error || 'Unknown error');
    }
  } catch (error) {
    console.error('[IPTC Pro] Finalization error:', error);
    const title = document.getElementById('iptc-pro-progress-title');
    if (title) title.textContent = 'Error: ' + error.message;
    iptcProIsWriting = false;
    if (writeBtn) { writeBtn.disabled = false; writeBtn.textContent = 'Retry'; }
  } finally {
    if (cleanupProgress) cleanupProgress();
    if (cleanupError) cleanupError();
  }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Wire button
  const btn = document.getElementById('btn-iptc-pro');
  if (btn) {
    btn.addEventListener('click', openIptcProModal);
  }

  // Check availability after a delay (let results load first)
  setTimeout(() => {
    checkIptcProAvailability();
  }, 3000);

  // Also check when logVisualizer finishes loading
  const origInit = window.ResultsPageManager?.prototype?.loadExecution;
  if (origInit) {
    // Poll for logVisualizer data
    const interval = setInterval(() => {
      if (window.logVisualizer && window.logVisualizer.participantPresetData) {
        clearInterval(interval);
        checkIptcProAvailability();
      }
    }, 500);
    // Stop polling after 30 seconds
    setTimeout(() => clearInterval(interval), 30000);
  }
});
