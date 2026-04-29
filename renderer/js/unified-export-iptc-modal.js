/**
 * Unified Export & IPTC Modal
 *
 * Consolidates the old "Export" and "IPTC Pro" modals into a single panel
 * with two modes:
 *   1. "Export to Folder" — copy files to destination + rename + subfolder + write IPTC to copies
 *   2. "Write to Originals" — write IPTC directly to source files (former IPTC Pro)
 *
 * IPTC form is always visible. Export-specific options (destination, rename, subfolder)
 * show/hide based on mode.
 */


// ============================================================
// Constants
// ============================================================
const RAW_EXTENSIONS_UNIFIED = new Set(['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng']);

function isRawFileUnified(filePath) {
  if (!filePath) return false;
  const ext = filePath.split('.').pop().toLowerCase();
  return RAW_EXTENSIONS_UNIFIED.has(ext);
}

// ============================================================
// State
// ============================================================
let unifiedModal = null;
let unifiedIsProcessing = false;
let unifiedPresetData = null;
let unifiedIptcMetadata = null;
let unifiedKeywordsList = [];
let unifiedCurrentMode = 'export'; // 'export' or 'write-originals'

// ============================================================
// Check availability and show button
// ============================================================
function checkUnifiedExportAvailability() {
  try {
    const lv = window.logVisualizer;
    if (!lv || !lv.participantPresetData) return;

    unifiedPresetData = lv.participantPresetData;

    // Make preset participants available for multi-match enrichment
    if (unifiedPresetData.participants) {
      window.currentPresetParticipants = unifiedPresetData.participants;
    }

    unifiedIptcMetadata = (unifiedPresetData.iptc_metadata &&
      Object.keys(unifiedPresetData.iptc_metadata).length > 0)
      ? unifiedPresetData.iptc_metadata
      : null;

    // Always show the unified button — export is useful for all presets
    const btn = document.getElementById('btn-unified-export');
    if (btn) btn.style.display = '';

    console.log('[Unified Export] Button enabled — IPTC profile:',
      unifiedIptcMetadata ? 'YES' : 'NO');
  } catch (error) {
    console.error('[Unified Export] Error checking availability:', error);
  }
}

// ============================================================
// Open modal
// ============================================================
async function openUnifiedExportModal() {
  if (unifiedIsProcessing) return;

  const lv = window.logVisualizer;
  if (!lv) {
    alert('Results not loaded yet. Please wait.');
    return;
  }

  // 1) Save unsaved corrections first (if any) so the user's edits aren't lost
  //    when we refetch the preset and rebuild the form.
  if (lv.hasUnsavedChanges) {
    const confirmed = confirm('You have unsaved corrections. Save them before proceeding? (Recommended)');
    if (confirmed) {
      try {
        await lv.saveAllChanges();
      } catch (err) {
        console.error('[Unified Export] Error saving changes:', err);
        // Continue anyway — the user has been warned.
      }
    }
  }

  // 2) Re-fetch the participant preset from Supabase so the export always uses
  //    the current state of the preset, not the snapshot loaded when the
  //    results page was first opened. This covers cases like:
  //      • the user fixed a driver/team/car_model in the preset after analysis
  //      • the user edited the IPTC profile (Caption template, keywords,
  //        credit, copyright, etc.) after analysis
  //    Without this refetch, those edits would silently be ignored at export
  //    time. Failure here is non-fatal: we fall back to whatever cached data
  //    we already have so the user can still export.
  try {
    if (typeof lv.loadParticipantPresetData === 'function') {
      await lv.loadParticipantPresetData();
    }
  } catch (err) {
    console.warn('[Unified Export] Could not refresh preset data — using cached version:', err);
  }

  // 3) Adopt the (possibly refreshed) preset into the modal's local state.
  if (lv.participantPresetData) {
    unifiedPresetData = lv.participantPresetData;
    unifiedIptcMetadata = (unifiedPresetData.iptc_metadata &&
      Object.keys(unifiedPresetData.iptc_metadata).length > 0)
      ? unifiedPresetData.iptc_metadata
      : null;
    // Keep the window-level participant list in sync so buildUnifiedImages()
    // and getUnifiedSampleParticipant() see the freshest data when they fall
    // back to window.currentPresetParticipants.
    if (Array.isArray(unifiedPresetData.participants)) {
      window.currentPresetParticipants = unifiedPresetData.participants;
    }
  }

  createUnifiedModal();
}

// ============================================================
// Sample participant for preview
// ============================================================
function getUnifiedSampleParticipant() {
  const lv = window.logVisualizer;
  if (!lv) return null;

  const results = lv.imageResults || [];
  for (const r of results) {
    if (r.analysis && r.analysis.length > 0) {
      for (const v of r.analysis) {
        if (v.raceNumber && v.raceNumber !== 'N/A') {
          const presetParticipants = window.currentPresetParticipants ||
            (unifiedPresetData?.participants || []);
          const presetMatch = presetParticipants.find(p => p.numero === v.raceNumber);

          return {
            number: v.raceNumber || '10',
            name: (presetMatch?.nome || (v.drivers ? v.drivers.join(', ') : '')) || 'Pierre Gasly',
            surname: '',
            team: (presetMatch?.squadra || presetMatch?.team || v.team) || 'BWT Alpine F1 Team',
            car_model: (presetMatch?.car_model) || 'Alpine A526',
            nationality: '',
            originalFilename: r.originalPath ? r.originalPath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '') : 'IMG_1234'
          };
        }
      }
    }
  }

  return {
    number: '10', name: 'Pierre Gasly', surname: 'Gasly',
    team: 'BWT Alpine F1 Team', car_model: 'Alpine A526',
    nationality: 'FRA', originalFilename: 'IMG_1234'
  };
}

// ============================================================
// Preview filename from pattern
// ============================================================
function previewUnifiedFilename(pattern) {
  if (!pattern) return '(original filename)';
  const sample = getUnifiedSampleParticipant();
  if (!sample) return pattern;

  const nameParts = sample.name.split(' ');
  const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : sample.name;

  let result = pattern
    .replace(/\{original\}/g, sample.originalFilename || 'IMG_1234')
    .replace(/\{name\}/g, sample.name.replace(/\s+/g, '_'))
    .replace(/\{surname\}/g, surname)
    .replace(/\{number\}/g, sample.number)
    .replace(/\{team\}/g, (sample.team || '').replace(/\s+/g, '_'))
    .replace(/\{car_model\}/g, (sample.car_model || '').replace(/\s+/g, '_'))
    .replace(/\{nationality\}/g, sample.nationality || '')
    .replace(/\{event\}/g, unifiedPresetData?.name?.replace(/\s+/g, '_') || 'Event');

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  result = result.replace(/\{date\}/g, dateStr);
  result = result.replace(/\{date:([^}]+)\}/g, (match, fmt) => {
    return fmt
      .replace(/YYYY/g, String(now.getFullYear()))
      .replace(/YY/g, String(now.getFullYear()).slice(-2))
      .replace(/MM/g, String(now.getMonth()+1).padStart(2,'0'))
      .replace(/DD/g, String(now.getDate()).padStart(2,'0'));
  });
  result = result.replace(/\{seq(?::(\d+))?\}/g, (match, padding) => {
    const pad = padding ? parseInt(padding) : 3;
    return '1'.padStart(pad, '0');
  });
  result = result.replace(/\(\s*\)/g, '').replace(/[_-]{2,}/g, '_').replace(/^[_-]+|[_-]+$/g, '').trim();
  return result || '(empty)';
}

// ============================================================
// Create the modal
// ============================================================
function createUnifiedModal() {
  if (unifiedModal) {
    unifiedModal.remove();
    unifiedModal = null;
  }

  const lv = window.logVisualizer;
  const results = lv ? lv.imageResults : [];
  const matchedCount = results.filter(r => r.analysis && r.analysis.length > 0 &&
    r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A')).length;
  const totalCount = results.length;
  const unmatchedCount = totalCount - matchedCount;

  const m = unifiedIptcMetadata || {};
  unifiedKeywordsList = m.baseKeywords ? [...m.baseKeywords] : [];

  // Determine source folder from first image
  let sourceFolder = '';
  if (results.length > 0) {
    const firstPath = results[0].originalPath || results[0].imagePath || '';
    if (firstPath) {
      const parts = firstPath.replace(/\\/g, '/').split('/');
      parts.pop();
      sourceFolder = parts.join('/');
    }
  }

  const defaultPattern = '{number}_{name}_{nationality}_{team}_{car_model}-{seq:2}';

  const overlay = document.createElement('div');
  overlay.className = 'unified-export-overlay';
  overlay.innerHTML = `
    <div class="unified-export-modal">
      <div class="unified-export-header">
        <div class="unified-export-header-left">
          <div class="unified-export-badge">📤 EXPORT & IPTC</div>
          <h2>Export & IPTC</h2>
          <span class="unified-export-preset-name">Preset: ${escapeHtmlUnified(unifiedPresetData?.name || 'Unknown')}</span>
          <span class="unified-export-stats">${totalCount} images (${matchedCount} matched)</span>
        </div>
        <button class="unified-export-close" id="unified-close">&times;</button>
      </div>

      <div class="unified-export-body">
        <!-- Mode Selector -->
        <div class="unified-mode-selector">
          <label class="unified-mode-option unified-mode-active" id="unified-mode-label-export">
            <input type="radio" name="unified-mode" value="export" checked>
            <span class="unified-mode-icon">📁</span>
            <span class="unified-mode-text">Export to Folder</span>
          </label>
          <label class="unified-mode-option" id="unified-mode-label-write">
            <input type="radio" name="unified-mode" value="write-originals">
            <span class="unified-mode-icon">📋</span>
            <span class="unified-mode-text">Write to Originals</span>
          </label>
        </div>

        <!-- Export-Only Options (hidden in Write to Originals mode) -->
        <div id="unified-export-options">
          <!-- Destination -->
          <div class="export-section">
            <div class="export-section-head">
              <label>📁 Destination Folder</label>
            </div>
            <div class="export-section-body">
              <div class="export-dest-row">
                <input type="text" id="unified-dest-path" class="export-dest-input"
                  placeholder="Select destination folder..." readonly
                  value="${escapeAttrUnified(sourceFolder ? sourceFolder + '/Export' : '')}">
                <button type="button" id="unified-browse-btn" class="export-btn-browse">Browse...</button>
              </div>
            </div>
          </div>

          <!-- Filename Rename -->
          <div class="export-section">
            <div class="export-section-head">
              <label><input type="checkbox" id="unified-chk-rename" checked> ✏️ Rename Files</label>
              <span class="export-section-hint">Pattern-based renaming with participant data</span>
            </div>
            <div class="export-section-body" id="unified-rename-body">
              <div class="ipf">
                <label>Filename Pattern</label>
                <input type="text" id="unified-rename-pattern"
                  value="${escapeAttrUnified(defaultPattern)}"
                  placeholder="{number}_{name}_{team}-{seq:2}">
              </div>
              <div class="export-preview-row">
                <span class="export-preview-label">Preview:</span>
                <span class="export-preview-value" id="unified-preview-filename"></span>
                <span class="export-preview-ext">.jpg</span>
              </div>
              <div class="export-placeholders">
                <span class="export-ph" data-ph="{number}">{number}</span>
                <span class="export-ph" data-ph="{name}">{name}</span>
                <span class="export-ph" data-ph="{surname}">{surname}</span>
                <span class="export-ph" data-ph="{team}">{team}</span>
                <span class="export-ph" data-ph="{car_model}">{car_model}</span>
                <span class="export-ph" data-ph="{nationality}">{nationality}</span>
                <span class="export-ph" data-ph="{event}">{event}</span>
                <span class="export-ph" data-ph="{date}">{date}</span>
                <span class="export-ph" data-ph="{seq:2}">{seq:N}</span>
                <span class="export-ph" data-ph="{original}">{original}</span>
              </div>
            </div>
          </div>

          <!-- Subfolder Organization -->
          <div class="export-section">
            <div class="export-section-head">
              <label><input type="checkbox" id="unified-chk-subfolder"> 📂 Organize in Subfolders</label>
              <span class="export-section-hint">Group files by number, name, or team</span>
            </div>
            <div class="export-section-body" id="unified-subfolder-body" style="display:none;">
              <div class="ipf">
                <label>Subfolder Pattern</label>
                <input type="text" id="unified-subfolder-pattern"
                  value="{number}_{surname}"
                  placeholder="{number}_{name}">
              </div>
              <div class="export-preview-row">
                <span class="export-preview-label">Preview:</span>
                <span class="export-preview-value" id="unified-preview-subfolder"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Write to Originals Warning (hidden by default) -->
        <div class="unified-write-warning" id="unified-write-warning" style="display:none;">
          <span class="unified-write-warning-icon">⚠️</span>
          <div class="unified-write-warning-text">
            <strong>Write to Originals</strong> — This will permanently modify your original source files.
            IPTC metadata will be embedded directly into the images in their current location.
          </div>
        </div>

        <!--
          Write Behavior — explicit toggles for the two conflict scenarios users
          hit on real workflows:
            (a) RE-EXPORTING a session into the same folder. Today we silently
                rename to "_2.jpg" / "_3.jpg" which leaves duplicates on disk.
                Power users want to OVERWRITE in place, or SKIP files already
                exported (e.g. quick incremental re-runs after fixing one match).
            (b) RE-WRITING IPTC into images that already carry metadata from
                another tool (Lightroom, Bridge, Photo Mechanic). Today we
                always merge — Race-Tagger only touches the fields it manages
                and leaves everything else intact. Some workflows want a clean
                slate ("replace all IPTC/XMP, then write only my preset"), e.g.
                when re-licensing a back catalog under a new copyright profile.
        -->
        <div class="export-section" id="unified-write-behavior">
          <div class="export-section-head">
            <label>⚙️ Write Behavior</label>
            <span class="export-section-hint">How to handle files & metadata that already exist</span>
          </div>
          <div class="export-section-body">
            <div class="ipf" id="unified-file-conflict-row">
              <label>If a file with the same name already exists in destination</label>
              <div class="ipf-radio-row">
                <label><input type="radio" name="unified-conflict" value="rename" checked>
                  <span>Auto-rename <em style="color:#94a3b8">(file_2.jpg, file_3.jpg…)</em></span>
                </label>
                <label><input type="radio" name="unified-conflict" value="overwrite">
                  <span>Overwrite <em style="color:#fbbf24">(replace existing file)</em></span>
                </label>
                <label><input type="radio" name="unified-conflict" value="skip">
                  <span>Skip <em style="color:#94a3b8">(leave existing file untouched)</em></span>
                </label>
              </div>
            </div>
            <div class="ipf">
              <label>Existing metadata in target image</label>
              <div class="ipf-radio-row">
                <label><input type="radio" name="unified-meta-strategy" value="merge" checked>
                  <span>Merge <em style="color:#94a3b8">(keep fields not specified here)</em></span>
                </label>
                <label><input type="radio" name="unified-meta-strategy" value="replace">
                  <span>Replace <em style="color:#fbbf24">(clear all IPTC/XMP first, then write only this preset)</em></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- IPTC Metadata (always visible) -->
        <div class="unified-iptc-section">
          <div class="unified-iptc-section-header">
            <h3>📋 IPTC Metadata</h3>
            <span class="unified-iptc-hint">${unifiedIptcMetadata ? 'From preset profile' : 'No preset profile — fill in manually'}</span>
          </div>

          <div class="iptc-pro-grid">
            <!-- Credits & Copyright -->
            <div class="iptc-pro-col">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-credits" checked> Credits & Copyright</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="ipf"><label>Credit</label><input type="text" id="unified-credit" value="${escapeAttrUnified(m.credit)}"></div>
                <div class="ipf"><label>Source</label><input type="text" id="unified-source" value="${escapeAttrUnified(m.source)}"></div>
                <div class="ipf"><label>Copyright</label><input type="text" id="unified-copyright" value="${escapeAttrUnified(m.copyright)}"></div>
                <div class="ipf"><label>Owner</label><input type="text" id="unified-copyright-owner" value="${escapeAttrUnified(m.copyrightOwner)}"></div>
              </div>
            </div>

            <!-- Creator & Contact -->
            <div class="iptc-pro-col">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-creator" checked> Creator & Contact</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="ipf"><label>Creator</label><input type="text" id="unified-creator" value="${escapeAttrUnified(m.creator)}"></div>
                <div class="ipf"><label>Position</label><input type="text" id="unified-authors-position" value="${escapeAttrUnified(m.authorsPosition)}"></div>
                <div class="ipf"><label>Email</label><input type="text" id="unified-contact-email" value="${escapeAttrUnified(m.contactEmail)}"></div>
                <div class="ipf"><label>Phone</label><input type="text" id="unified-contact-phone" value="${escapeAttrUnified(m.contactPhone)}"></div>
                <div class="ipf"><label>Website</label><input type="text" id="unified-contact-website" value="${escapeAttrUnified(m.contactWebsite)}"></div>
                <div class="ipf"><label>Address</label><input type="text" id="unified-contact-address" value="${escapeAttrUnified(m.contactAddress)}"></div>
                <div class="ipf"><label>City</label><input type="text" id="unified-contact-city" value="${escapeAttrUnified(m.contactCity)}"></div>
                <div class="ipf"><label>State</label><input type="text" id="unified-contact-region" value="${escapeAttrUnified(m.contactRegion)}"></div>
                <div class="ipf"><label>Zip</label><input type="text" id="unified-contact-postal-code" value="${escapeAttrUnified(m.contactPostalCode)}"></div>
                <div class="ipf"><label>Country</label><input type="text" id="unified-contact-country" value="${escapeAttrUnified(m.contactCountry)}"></div>
              </div>
            </div>

            <!-- Event & Caption -->
            <div class="iptc-pro-col">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-event" checked> Event & Caption</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="ipf"><label>Headline</label><input type="text" id="unified-headline" value="${escapeAttrUnified(m.headlineTemplate)}"></div>
                <div class="ipf"><label>Caption</label><textarea id="unified-description" rows="2">${escapeHtmlUnified(m.descriptionTemplate || '')}</textarea></div>
                <div class="ipf"><label>Event</label><input type="text" id="unified-event" value="${escapeAttrUnified(m.eventTemplate)}"></div>
                <div class="ipf ipf-row">
                  <div class="ipf"><label>Cat</label><input type="text" id="unified-category" value="${escapeAttrUnified(m.category)}"></div>
                  <div class="ipf"><label>Urg</label><input type="text" id="unified-urgency" value="${escapeAttrUnified(m.urgency)}"></div>
                </div>
              </div>
            </div>

            <!-- Location -->
            <div class="iptc-pro-col">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-location" checked> Location</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="ipf"><label>City</label><input type="text" id="unified-city" value="${escapeAttrUnified(m.city)}"></div>
                <div class="ipf"><label>Country</label><input type="text" id="unified-country" value="${escapeAttrUnified(m.country)}"></div>
                <div class="ipf"><label>Code</label><input type="text" id="unified-country-code" value="${escapeAttrUnified(m.countryCode)}" maxlength="3"></div>
                <div class="ipf"><label>Sub-location</label><input type="text" id="unified-location" value="${escapeAttrUnified(m.location)}"></div>
                <div class="ipf"><label>State</label><input type="text" id="unified-province-state" value="${escapeAttrUnified(m.provinceState)}"></div>
                <div class="ipf"><label>Region</label><input type="text" id="unified-world-region" value="${escapeAttrUnified(m.worldRegion)}"></div>
              </div>
            </div>
          </div>

          <!-- Second row: Keywords + Person + Rights -->
          <div class="iptc-pro-grid iptc-pro-grid-bottom">
            <div class="iptc-pro-col iptc-pro-col-wide">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-keywords" checked> Keywords</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="iptc-pro-tags-wrap" id="unified-keywords-wrap">
                  <span id="unified-keywords-tags"></span>
                  <input type="text" id="unified-keywords-input" placeholder="Type keyword and press Enter to add...">
                </div>
                <div class="ipf-hint" style="font-size:0.7rem; color:#94a3b8; padding:2px 0 0 0;">
                  Press Enter or comma to confirm each keyword. Templates like {number}, {name}, {team} are allowed.
                </div>
                <div class="ipf-radio-row">
                  <label><input type="radio" name="unified-kw-mode" value="append" ${m.appendKeywords !== false ? 'checked' : ''}> Merge with existing keywords</label>
                  <label><input type="radio" name="unified-kw-mode" value="overwrite" ${m.appendKeywords === false ? 'checked' : ''}> Replace all keywords</label>
                </div>
              </div>
            </div>

            <div class="iptc-pro-col">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-person" checked> Person Shown</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="ipf"><label>Format</label>
                  <select id="unified-person-format" onchange="togglePersonShownCustom()">
                    <option value="simple" ${(!m.personShownFormat || m.personShownFormat === 'simple') ? 'selected' : ''}>Name only</option>
                    <option value="extended" ${m.personShownFormat === 'extended' ? 'selected' : ''}>Extended (number, name, nationality, team, car)</option>
                    <option value="custom" ${m.personShownFormat === 'custom' ? 'selected' : ''}>Custom template</option>
                  </select>
                </div>
                <div class="ipf" id="unified-person-custom-row" style="display:${m.personShownFormat === 'custom' ? 'flex' : 'none'}">
                  <label>Template</label>
                  <input type="text" id="unified-person-shown" value="${escapeAttrUnified(m.personShownTemplate)}" placeholder="({number}) {name} ({nationality}) - {team}">
                </div>
                <div class="ipf-hint" id="unified-person-preview" style="font-size:0.75rem; color:#94a3b8; padding:4px 0 0 0;">
                  ${buildPersonPreviewHtml(m.personShownFormat)}
                </div>
              </div>
            </div>

            <div class="iptc-pro-col">
              <div class="iptc-pro-col-head">
                <label><input type="checkbox" id="unified-sec-rights" checked> Rights</label>
              </div>
              <div class="iptc-pro-col-body">
                <div class="ipf"><label>Source Type</label>
                  <select id="unified-digital-source">
                    <option value="">-</option>
                    <option value="digitalCapture" ${m.digitalSourceType === 'digitalCapture' ? 'selected' : ''}>Digital Capture</option>
                  </select>
                </div>
                <div class="ipf"><label>Model Release</label>
                  <select id="unified-model-release">
                    <option value="">-</option>
                    <option value="MR-NON" ${m.modelReleaseStatus === 'MR-NON' ? 'selected' : ''}>MR-NON</option>
                    <option value="MR-NAP" ${m.modelReleaseStatus === 'MR-NAP' ? 'selected' : ''}>MR-NAP</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="unified-export-footer">
        <div class="unified-export-footer-left">
          <label class="ipf-radio-row">
            <input type="radio" name="unified-scope" value="matched" checked>
            <span>Matched only (${matchedCount})</span>
          </label>
          <label class="ipf-radio-row">
            <input type="radio" name="unified-scope" value="all">
            <span>All files (${totalCount})</span>
          </label>
        </div>
        <div class="unified-export-footer-right">
          <button class="btn-iptc-cancel" id="unified-cancel">Cancel</button>
          <button class="unified-btn-start" id="unified-start">
            📤 Export ${matchedCount} files
          </button>
        </div>
      </div>

      <!-- Progress overlay -->
      <div class="unified-progress" id="unified-progress" style="display:none;">
        <h3 id="unified-progress-title">Processing...</h3>
        <div class="iptc-pro-progress-bar">
          <div class="iptc-pro-progress-fill" id="unified-progress-fill"></div>
        </div>
        <p id="unified-progress-text">0 / 0</p>
        <p id="unified-progress-phase" class="export-progress-phase"></p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  unifiedModal = overlay;
  unifiedCurrentMode = 'export';

  // Render keywords + previews
  renderUnifiedKeywords();
  updateUnifiedPreview();

  // Wire events
  wireUnifiedEvents(matchedCount, totalCount);
}

// ============================================================
// Wire events
// ============================================================
function wireUnifiedEvents(matchedCount, totalCount) {
  // Close
  document.getElementById('unified-close').addEventListener('click', closeUnifiedModal);
  document.getElementById('unified-cancel').addEventListener('click', closeUnifiedModal);
  unifiedModal.addEventListener('click', (e) => {
    if (e.target === unifiedModal && !unifiedIsProcessing) closeUnifiedModal();
  });

  // Mode toggle
  document.querySelectorAll('input[name="unified-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = document.querySelector('input[name="unified-mode"]:checked')?.value;
      setUnifiedMode(mode, matchedCount, totalCount);
    });
  });

  // Browse destination
  document.getElementById('unified-browse-btn').addEventListener('click', async () => {
    try {
      const selectedPath = await window.api.invoke('select-organization-destination');
      if (selectedPath) {
        document.getElementById('unified-dest-path').value = selectedPath;
      }
    } catch (err) {
      console.error('[Unified Export] Error selecting destination:', err);
    }
  });

  // Rename pattern → preview
  const patternInput = document.getElementById('unified-rename-pattern');
  if (patternInput) patternInput.addEventListener('input', updateUnifiedPreview);

  // Subfolder pattern → preview
  const subfolderInput = document.getElementById('unified-subfolder-pattern');
  if (subfolderInput) subfolderInput.addEventListener('input', updateUnifiedPreview);

  // Rename checkbox toggle
  const renameChk = document.getElementById('unified-chk-rename');
  if (renameChk) {
    renameChk.addEventListener('change', () => {
      const body = document.getElementById('unified-rename-body');
      if (body) body.style.display = renameChk.checked ? '' : 'none';
    });
  }

  // Subfolder checkbox toggle
  const subfolderChk = document.getElementById('unified-chk-subfolder');
  if (subfolderChk) {
    subfolderChk.addEventListener('change', () => {
      const body = document.getElementById('unified-subfolder-body');
      if (body) body.style.display = subfolderChk.checked ? '' : 'none';
      updateUnifiedPreview();
    });
  }

  // Placeholder chips
  document.querySelectorAll('.export-ph').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('unified-rename-pattern');
      if (input) {
        const pos = input.selectionStart || input.value.length;
        const ph = chip.dataset.ph;
        input.value = input.value.slice(0, pos) + ph + input.value.slice(pos);
        input.focus();
        input.setSelectionRange(pos + ph.length, pos + ph.length);
        updateUnifiedPreview();
      }
    });
  });

  // Keywords input
  const kwInput = document.getElementById('unified-keywords-input');
  if (kwInput) {
    kwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitPendingUnifiedKeyword();
      }
    });
    // Auto-commit on blur (when user clicks elsewhere) so that keywords
    // typed/pasted without pressing Enter are still captured.
    kwInput.addEventListener('blur', () => {
      commitPendingUnifiedKeyword();
    });
  }

  // Scope radio → update button text
  document.querySelectorAll('input[name="unified-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      updateUnifiedButtonText(matchedCount, totalCount);
    });
  });

  // Start
  document.getElementById('unified-start').addEventListener('click', startUnifiedProcess);
}

// ============================================================
// Mode switching
// ============================================================
function setUnifiedMode(mode, matchedCount, totalCount) {
  unifiedCurrentMode = mode;

  const exportOptions = document.getElementById('unified-export-options');
  const writeWarning = document.getElementById('unified-write-warning');
  const labelExport = document.getElementById('unified-mode-label-export');
  const labelWrite = document.getElementById('unified-mode-label-write');
  // The "If file exists in destination" toggle only makes sense in
  // Export-to-Folder mode — Write-to-Originals always operates in place
  // on the user's existing files, so there is no destination collision
  // to resolve.
  const fileConflictRow = document.getElementById('unified-file-conflict-row');

  if (mode === 'export') {
    if (exportOptions) exportOptions.style.display = '';
    if (writeWarning) writeWarning.style.display = 'none';
    if (fileConflictRow) fileConflictRow.style.display = '';
    if (labelExport) labelExport.classList.add('unified-mode-active');
    if (labelWrite) labelWrite.classList.remove('unified-mode-active');
  } else {
    if (exportOptions) exportOptions.style.display = 'none';
    if (writeWarning) writeWarning.style.display = 'flex';
    if (fileConflictRow) fileConflictRow.style.display = 'none';
    if (labelExport) labelExport.classList.remove('unified-mode-active');
    if (labelWrite) labelWrite.classList.add('unified-mode-active');
  }

  updateUnifiedButtonText(matchedCount, totalCount);
}

function updateUnifiedButtonText(matchedCount, totalCount) {
  const scope = document.querySelector('input[name="unified-scope"]:checked')?.value;
  const count = scope === 'all' ? totalCount : matchedCount;
  const btn = document.getElementById('unified-start');
  if (!btn) return;

  if (unifiedCurrentMode === 'export') {
    btn.textContent = `📤 Export ${count} files`;
  } else {
    btn.textContent = `📋 Write IPTC to ${count} files`;
  }
}

// ============================================================
// Preview
// ============================================================
function updateUnifiedPreview() {
  const patternInput = document.getElementById('unified-rename-pattern');
  const previewEl = document.getElementById('unified-preview-filename');
  if (patternInput && previewEl) {
    previewEl.textContent = previewUnifiedFilename(patternInput.value);
  }

  const subfolderInput = document.getElementById('unified-subfolder-pattern');
  const subfolderPreview = document.getElementById('unified-preview-subfolder');
  const subfolderChk = document.getElementById('unified-chk-subfolder');
  if (subfolderInput && subfolderPreview && subfolderChk && subfolderChk.checked) {
    subfolderPreview.textContent = previewUnifiedFilename(subfolderInput.value) + '/';
  }
}

// ============================================================
// Close
// ============================================================
function closeUnifiedModal() {
  if (unifiedIsProcessing) return;
  if (unifiedModal) {
    unifiedModal.remove();
    unifiedModal = null;
  }
}

// ============================================================
// Keywords rendering
// ============================================================
function renderUnifiedKeywords() {
  const container = document.getElementById('unified-keywords-tags');
  if (!container) return;
  container.innerHTML = unifiedKeywordsList.map((kw, i) =>
    `<span class="iptc-pro-tag">${escapeHtmlUnified(kw)}<button onclick="removeUnifiedKeyword(${i})">&times;</button></span>`
  ).join('');
}

function removeUnifiedKeyword(index) {
  unifiedKeywordsList.splice(index, 1);
  renderUnifiedKeywords();
}

/**
 * Commits whatever is currently typed in the keyword input as a single keyword.
 * Used by Enter/comma keypress, blur, and the form data collector as a safety net
 * so that keywords typed (or pasted) without pressing Enter are still captured.
 */
function commitPendingUnifiedKeyword() {
  const kwInput = document.getElementById('unified-keywords-input');
  if (!kwInput) return;
  const val = kwInput.value.replace(/,/g, '').trim();
  if (val && !unifiedKeywordsList.includes(val)) {
    unifiedKeywordsList.push(val);
    renderUnifiedKeywords();
  }
  kwInput.value = '';
}

// ============================================================
// Collect IPTC form data
// ============================================================
function collectUnifiedIptcFormData() {
  // Safety net: commit any pending keyword that was typed/pasted but not
  // confirmed with Enter/comma before the user clicked the action button.
  commitPendingUnifiedKeyword();

  const data = {};
  const getValue = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  // Credits
  if (getValue('unified-credit')) data.credit = getValue('unified-credit');
  if (getValue('unified-source')) data.source = getValue('unified-source');
  if (getValue('unified-copyright')) data.copyright = getValue('unified-copyright');
  if (getValue('unified-copyright-owner')) data.copyrightOwner = getValue('unified-copyright-owner');

  // Creator & Contact
  if (getValue('unified-creator')) data.creator = getValue('unified-creator');
  if (getValue('unified-authors-position')) data.authorsPosition = getValue('unified-authors-position');
  if (getValue('unified-contact-email')) data.contactEmail = getValue('unified-contact-email');
  if (getValue('unified-contact-phone')) data.contactPhone = getValue('unified-contact-phone');
  if (getValue('unified-contact-website')) data.contactWebsite = getValue('unified-contact-website');
  // Address fields are now editable in the form (BUGFIX: previously they were
  // pulled only from `orig` so users couldn't override them at export time and
  // the writer's broken slash syntax made them silently disappear anyway).
  if (getValue('unified-contact-address')) data.contactAddress = getValue('unified-contact-address');
  if (getValue('unified-contact-city')) data.contactCity = getValue('unified-contact-city');
  if (getValue('unified-contact-region')) data.contactRegion = getValue('unified-contact-region');
  if (getValue('unified-contact-postal-code')) data.contactPostalCode = getValue('unified-contact-postal-code');
  if (getValue('unified-contact-country')) data.contactCountry = getValue('unified-contact-country');

  // Carry over fields that don't have an input in this simplified modal.
  // captionWriter and includeVisualTags were missing from this carry-over
  // block and were therefore lost on Export-to-Folder even when configured
  // in the IPTC Pro preset.
  const orig = unifiedIptcMetadata || {};
  if (orig.copyrightMarked) data.copyrightMarked = orig.copyrightMarked;
  if (orig.copyrightUrl) data.copyrightUrl = orig.copyrightUrl;
  if (orig.captionWriter) data.captionWriter = orig.captionWriter;
  if (orig.includeVisualTags) data.includeVisualTags = orig.includeVisualTags;

  // Event
  if (getValue('unified-headline')) data.headlineTemplate = getValue('unified-headline');
  if (getValue('unified-description')) data.descriptionTemplate = getValue('unified-description');
  if (getValue('unified-event')) data.eventTemplate = getValue('unified-event');
  if (getValue('unified-category')) data.category = getValue('unified-category');
  if (getValue('unified-urgency')) data.urgency = getValue('unified-urgency');
  if (orig.intellectualGenre) data.intellectualGenre = orig.intellectualGenre;
  if (orig.dateCreated) data.dateCreated = orig.dateCreated;

  // Location
  if (getValue('unified-city')) data.city = getValue('unified-city');
  if (getValue('unified-country')) data.country = getValue('unified-country');
  if (getValue('unified-country-code')) data.countryCode = getValue('unified-country-code');
  if (getValue('unified-location')) data.location = getValue('unified-location');
  if (getValue('unified-province-state')) data.provinceState = getValue('unified-province-state');
  if (getValue('unified-world-region')) data.worldRegion = getValue('unified-world-region');

  // Keywords
  if (unifiedKeywordsList.length > 0) data.baseKeywords = [...unifiedKeywordsList];
  const kwMode = document.querySelector('input[name="unified-kw-mode"]:checked')?.value;
  data.appendKeywords = kwMode !== 'overwrite';

  // Person Shown
  const personFormat = getValue('unified-person-format') || 'simple';
  data.personShownFormat = personFormat;
  if (personFormat === 'custom' && getValue('unified-person-shown')) {
    data.personShownTemplate = getValue('unified-person-shown');
  } else if (personFormat !== 'custom') {
    // Clear custom template when not in custom mode
    data.personShownTemplate = undefined;
  }

  // Rights
  if (getValue('unified-digital-source')) data.digitalSourceType = getValue('unified-digital-source');
  if (getValue('unified-model-release')) data.modelReleaseStatus = getValue('unified-model-release');

  return data;
}

// ============================================================
// Build images array (shared between both modes)
// ============================================================
function buildUnifiedImages(scope) {
  const lv = window.logVisualizer;
  if (!lv) return [];

  const allResults = lv.imageResults || [];
  const presetParticipants = window.currentPresetParticipants ||
    (unifiedPresetData?.participants || []);

  return allResults
    .filter(r => {
      if (scope === 'all') return true;
      return r.analysis && r.analysis.length > 0 &&
        r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A');
    })
    .map(r => {
      const filePath = r.originalPath || r.imagePath || '';
      if (!filePath) return null;

      const allMatchedParticipants = [];

      if (r.analysis && r.analysis.length > 0) {
        for (const vehicle of r.analysis) {
          if (!vehicle.raceNumber || vehicle.raceNumber === 'N/A') continue;

          const participant = {
            name: vehicle.drivers ? vehicle.drivers.join(', ') : '',
            number: vehicle.raceNumber || '',
            team: vehicle.team || ''
          };

          const presetMatch = presetParticipants.find(p => p.numero === vehicle.raceNumber);
          if (presetMatch) {
            if (!participant.name && presetMatch.nome) participant.name = presetMatch.nome;
            if (presetMatch.car_model) participant.car_model = presetMatch.car_model;
            if (presetMatch.metatag) participant.metatag = presetMatch.metatag;
            if (presetMatch.nationality) participant.nationality = presetMatch.nationality;
            if (!participant.team && presetMatch.squadra) participant.team = presetMatch.squadra;

            if (!participant.nationality && presetMatch.preset_participant_drivers?.length > 0) {
              const firstDriver = presetMatch.preset_participant_drivers[0];
              if (firstDriver.driver_nationality) {
                participant.nationality = firstDriver.driver_nationality;
              }
            }

            if (presetMatch.sponsor) {
              participant.sponsors = typeof presetMatch.sponsor === 'string'
                ? presetMatch.sponsor.split(',').map(s => s.trim())
                : presetMatch.sponsor;
            }
          }

          if (r.csvMatch && vehicle === r.analysis[0]) {
            if (!participant.name && r.csvMatch.nome) participant.name = r.csvMatch.nome;
            if (r.csvMatch.car_model) participant.car_model = r.csvMatch.car_model;
            if (r.csvMatch.categoria) participant.category = r.csvMatch.categoria;
            if (r.csvMatch.metatag && !participant.metatag) participant.metatag = r.csvMatch.metatag;
          }

          allMatchedParticipants.push(participant);
        }
      }

      return {
        imagePath: filePath,
        isRaw: isRawFileUnified(filePath),
        participant: allMatchedParticipants.length > 0 ? allMatchedParticipants[0] : null,
        matchedParticipant: allMatchedParticipants.length > 0 ? allMatchedParticipants[0] : null,
        allMatchedParticipants: allMatchedParticipants.length > 0 ? allMatchedParticipants : undefined,
        aiKeywords: r.logEvent?.keywords || [],
        visualTags: r.logEvent?.visualTags || r.visualTags || undefined
      };
    })
    .filter(r => r !== null);
}

// ============================================================
// Start processing (routes to export or write-originals)
// ============================================================
async function startUnifiedProcess() {
  if (unifiedIsProcessing) return;

  if (unifiedCurrentMode === 'export') {
    await startUnifiedExport();
  } else {
    await startUnifiedWriteOriginals();
  }
}

// ============================================================
// Export to Folder
// ============================================================
async function startUnifiedExport() {
  const destFolder = document.getElementById('unified-dest-path')?.value || '';
  if (!destFolder) {
    alert('Please select a destination folder.');
    return;
  }

  const scope = document.querySelector('input[name="unified-scope"]:checked')?.value || 'matched';
  const images = buildUnifiedImages(scope);
  if (images.length === 0) {
    alert('No files to export.');
    return;
  }

  const renameEnabled = document.getElementById('unified-chk-rename')?.checked;
  const renamePattern = renameEnabled ? (document.getElementById('unified-rename-pattern')?.value || '') : null;
  const subfolderEnabled = document.getElementById('unified-chk-subfolder')?.checked;
  const subfolderPattern = subfolderEnabled ? (document.getElementById('unified-subfolder-pattern')?.value || '') : null;

  // Collect IPTC — check if any IPTC fields have values
  const iptcMetadata = collectUnifiedIptcFormData();
  const hasAnyIptc = Object.keys(iptcMetadata).some(k => k !== 'appendKeywords');
  const writeIptc = hasAnyIptc;
  const kwMode = document.querySelector('input[name="unified-kw-mode"]:checked')?.value || 'append';

  // Write Behavior toggles (file conflicts + metadata strategy). Defaults are
  // backward-compatible with the legacy hard-coded behavior: rename + merge.
  const fileConflictStrategy =
    document.querySelector('input[name="unified-conflict"]:checked')?.value || 'rename';
  const metadataStrategy =
    document.querySelector('input[name="unified-meta-strategy"]:checked')?.value || 'merge';

  // If user picked "Overwrite", confirm — destructive action that nukes the
  // existing copy in destination. We don't confirm "Skip" because it's safe.
  if (fileConflictStrategy === 'overwrite') {
    const ok = confirm(
      `You chose to OVERWRITE existing files in:\n${destFolder}\n\n` +
      `Files in the destination with matching names will be replaced ` +
      `permanently. Continue?`
    );
    if (!ok) return;
  }
  if (metadataStrategy === 'replace') {
    const ok = confirm(
      `You chose to REPLACE existing IPTC/XMP metadata in target images.\n\n` +
      `All IPTC/XMP fields previously written by other tools (Lightroom, ` +
      `Bridge, Photo Mechanic, etc.) will be CLEARED before this preset is ` +
      `written. EXIF camera data is not affected. Continue?`
    );
    if (!ok) return;
  }

  unifiedIsProcessing = true;
  showUnifiedProgress('Exporting files...');

  const cleanupProgress = window.api.receive('unified-export-progress', (data) => {
    const { current, total, phase, fileName } = data;
    const fill = document.getElementById('unified-progress-fill');
    const text = document.getElementById('unified-progress-text');
    const phaseEl = document.getElementById('unified-progress-phase');

    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (text) text.textContent = `${current} / ${total}`;
    if (phaseEl) phaseEl.textContent = phase === 'copy' ? `Copying: ${fileName || ''}` :
      phase === 'iptc' ? `Writing IPTC: ${fileName || ''}` : fileName || '';
  });

  try {
    const response = await window.api.invoke('unified-export', {
      images: images,
      destinationFolder: destFolder,
      renamePattern: renamePattern,
      subfolderPattern: subfolderPattern,
      writeIptc: writeIptc,
      iptcMetadata: writeIptc ? iptcMetadata : null,
      keywordsMode: writeIptc ? kwMode : null,
      eventName: unifiedPresetData?.name || '',
      fileConflictStrategy: fileConflictStrategy,
      metadataStrategy: metadataStrategy
    });

    if (response.success) {
      const summary = response.data;
      showUnifiedSuccess(
        '✅ Export Complete!',
        `${summary.copiedFiles} files exported` +
          (summary.renamedFiles > 0 ? `, ${summary.renamedFiles} renamed` : '') +
          (summary.skippedFiles > 0 ? `, ${summary.skippedFiles} skipped (already existed)` : '') +
          (summary.iptcWritten > 0 ? `, ${summary.iptcWritten} with IPTC` : '') +
          (summary.errors > 0 ? `, ${summary.errors} errors` : ''),
        `Duration: ${(summary.durationMs / 1000).toFixed(1)}s`
      );
      setTimeout(() => { unifiedIsProcessing = false; closeUnifiedModal(); }, 2500);
    } else {
      throw new Error(response.error || 'Unknown error');
    }
  } catch (error) {
    console.error('[Unified Export] Export error:', error);
    showUnifiedError(error.message);
    unifiedIsProcessing = false;
  } finally {
    if (cleanupProgress) cleanupProgress();
  }
}

// ============================================================
// Write to Originals
// ============================================================
async function startUnifiedWriteOriginals() {
  const scope = document.querySelector('input[name="unified-scope"]:checked')?.value || 'matched';
  const results = buildUnifiedImages(scope);

  if (results.length === 0) {
    alert('No files to process. Check that image paths are available.');
    return;
  }

  const iptcMetadata = collectUnifiedIptcFormData();
  const kwMode = document.querySelector('input[name="unified-kw-mode"]:checked')?.value || 'append';

  // Same metadata strategy toggle as Export-to-Folder. The file-conflict
  // toggle is irrelevant here (we always operate on the originals in place),
  // so it's hidden by setUnifiedMode() above.
  const metadataStrategy =
    document.querySelector('input[name="unified-meta-strategy"]:checked')?.value || 'merge';

  // Sanity check: warn the user if the form is essentially empty so we don't
  // silently invoke exiftool with nothing to write (which would look to the
  // user like the feature is broken).
  const hasContent = Object.keys(iptcMetadata).some(k => {
    if (k === 'appendKeywords' || k === 'personShownFormat') return false;
    const v = iptcMetadata[k];
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (!hasContent) {
    alert('No IPTC fields filled in. Please enter at least one field (Headline, Caption, Keywords, Credit, etc.) before writing.');
    return;
  }

  // Replace mode is destructive on the user's original files — confirm.
  if (metadataStrategy === 'replace') {
    const ok = confirm(
      `You chose to REPLACE existing IPTC/XMP metadata in your ORIGINAL files.\n\n` +
      `All IPTC/XMP fields previously written by other tools (Lightroom, ` +
      `Bridge, Photo Mechanic, etc.) will be CLEARED before this preset is ` +
      `written. EXIF camera data is not affected. This cannot be undone. Continue?`
    );
    if (!ok) return;
  }

  unifiedIsProcessing = true;
  showUnifiedProgress('Writing IPTC metadata...', true);

  const cleanupProgress = window.api.receive('iptc-finalize-progress', (data) => {
    const { current, total, fileName } = data;
    const fill = document.getElementById('unified-progress-fill');
    const text = document.getElementById('unified-progress-text');
    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (text) text.textContent = `${current} / ${total} — ${fileName || ''}`;
  });

  const cleanupError = window.api.receive('iptc-finalize-error', (data) => {
    console.warn('[Unified Export] Error on file:', data.fileName, data.error);
  });

  try {
    // IPTC Pro: 3 positional params + 1 options object so older callers
    // remain compatible (the handler defaults metadataStrategy to 'merge'
    // when the options arg is missing).
    const response = await window.api.invoke('iptc-finalize-batch', iptcMetadata, results, kwMode, {
      metadataStrategy
    });

    if (response.success) {
      const summary = response.data;
      showUnifiedSuccess(
        '✅ IPTC Write Complete!',
        `${summary.successCount} files written successfully` +
          (summary.errorCount > 0 ? `, ${summary.errorCount} errors` : ''),
        `Duration: ${(summary.durationMs / 1000).toFixed(1)}s`
      );
      setTimeout(() => { unifiedIsProcessing = false; closeUnifiedModal(); }, 2000);
    } else {
      throw new Error(response.error || 'Unknown error');
    }
  } catch (error) {
    console.error('[Unified Export] Write originals error:', error);
    showUnifiedError(error.message);
    unifiedIsProcessing = false;
  } finally {
    if (cleanupProgress) cleanupProgress();
    if (cleanupError) cleanupError();
  }
}

// ============================================================
// Progress helpers
// ============================================================
function showUnifiedProgress(title, isIptcMode = false) {
  const progressEl = document.getElementById('unified-progress');
  if (progressEl) {
    progressEl.style.display = 'flex';
    if (isIptcMode) {
      progressEl.classList.add('iptc-mode');
    } else {
      progressEl.classList.remove('iptc-mode');
    }
  }
  const titleEl = document.getElementById('unified-progress-title');
  if (titleEl) titleEl.textContent = title;
  const startBtn = document.getElementById('unified-start');
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Processing...'; }
}

function showUnifiedSuccess(title, text, phase) {
  const fill = document.getElementById('unified-progress-fill');
  const titleEl = document.getElementById('unified-progress-title');
  const textEl = document.getElementById('unified-progress-text');
  const phaseEl = document.getElementById('unified-progress-phase');
  if (fill) fill.style.width = '100%';
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
  if (phaseEl) phaseEl.textContent = phase || '';
}

function showUnifiedError(message) {
  const titleEl = document.getElementById('unified-progress-title');
  if (titleEl) titleEl.textContent = '❌ Error: ' + message;
  const startBtn = document.getElementById('unified-start');
  if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Retry'; }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtmlUnified(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttrUnified(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Person Shown format helpers
// ============================================================

/**
 * Toggle visibility of custom template input based on format dropdown.
 */
function togglePersonShownCustom() {
  const format = document.getElementById('unified-person-format')?.value;
  const customRow = document.getElementById('unified-person-custom-row');
  const preview = document.getElementById('unified-person-preview');

  if (customRow) {
    customRow.style.display = format === 'custom' ? 'flex' : 'none';
  }
  if (preview) {
    preview.innerHTML = buildPersonPreviewHtml(format);
  }
}

/**
 * Build a preview example for the selected PersonShown format.
 */
function buildPersonPreviewHtml(format) {
  const examples = {
    simple: '<span style="color:#60a5fa;">Preview:</span> Lando Norris',
    extended: '<span style="color:#60a5fa;">Preview:</span> (1) Lando Norris (GBR) - McLaren Mastercard F1 Team - McLaren MCL40 - Mercedes',
    custom: '<span style="color:#60a5fa;">Placeholders:</span> {number}, {name}, {surname}, {nationality}, {team}, {car_model}',
  };
  return examples[format] || examples.simple;
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-unified-export');
  if (btn) {
    btn.addEventListener('click', openUnifiedExportModal);
  }

  // Check availability after results load
  setTimeout(() => {
    checkUnifiedExportAvailability();
  }, 3500);

  // Poll for logVisualizer
  const interval = setInterval(() => {
    if (window.logVisualizer && window.logVisualizer.participantPresetData) {
      clearInterval(interval);
      checkUnifiedExportAvailability();
    }
  }, 500);
  setTimeout(() => clearInterval(interval), 30000);
});
