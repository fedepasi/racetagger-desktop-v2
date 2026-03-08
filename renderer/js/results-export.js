/**
 * Results Export Panel
 *
 * Adaptive export modal that combines:
 * - File copying to destination folder
 * - Pattern-based filename renaming
 * - Optional subfolder organization
 * - Optional IPTC metadata writing (if preset has IPTC profile)
 *
 * Adapts UI based on preset configuration:
 * - BP1 (Multi-client): Destination + folders + rename
 * - BP2 (Editorial): Destination + rename + IPTC metadata
 * - BP3 (Event org): Destination + rename (tags already written)
 */

// ============================================================
// State
// ============================================================
let exportPanelModal = null;
let exportPanelIsExporting = false;
let exportPanelPresetData = null;
let exportPanelHasIptc = false;

// ============================================================
// Check availability and show button
// ============================================================
function checkExportPanelAvailability() {
  try {
    const lv = window.logVisualizer;
    if (!lv || !lv.participantPresetData) return;

    exportPanelPresetData = lv.participantPresetData;
    exportPanelHasIptc = !!(exportPanelPresetData.iptc_metadata &&
      Object.keys(exportPanelPresetData.iptc_metadata).length > 0);

    // Always show export button — it's useful for all buyer personas
    const btn = document.getElementById('btn-export');
    if (btn) btn.style.display = '';

    console.log('[Export Panel] Button enabled — IPTC profile:', exportPanelHasIptc ? 'YES' : 'NO');
  } catch (error) {
    console.error('[Export Panel] Error checking availability:', error);
  }
}

// ============================================================
// Open export modal
// ============================================================
function openExportPanel() {
  if (exportPanelIsExporting) return;

  const lv = window.logVisualizer;
  if (!lv) {
    alert('Results not loaded yet. Please wait.');
    return;
  }

  // Re-read preset data to pick up any IPTC changes saved since page load
  if (lv.participantPresetData) {
    exportPanelPresetData = lv.participantPresetData;
    exportPanelHasIptc = !!(exportPanelPresetData.iptc_metadata &&
      Object.keys(exportPanelPresetData.iptc_metadata).length > 0);
    console.log('[Export Panel] Refreshed preset data — IPTC profile:', exportPanelHasIptc ? 'YES' : 'NO',
      exportPanelHasIptc ? JSON.stringify(Object.keys(exportPanelPresetData.iptc_metadata)) : '');
  }

  // Save unsaved changes first
  if (lv.hasUnsavedChanges) {
    const confirmed = confirm('You have unsaved corrections. Save them before exporting? (Recommended)');
    if (confirmed) {
      lv.saveAllChanges().then(() => {
        createExportPanelModal();
      }).catch(err => {
        console.error('[Export Panel] Error saving changes:', err);
        createExportPanelModal();
      });
      return;
    }
  }

  createExportPanelModal();
}

// ============================================================
// Build sample participant for preview
// ============================================================
function getExportSampleParticipant() {
  const lv = window.logVisualizer;
  if (!lv) return null;

  // Find first matched result for preview
  const results = lv.imageResults || [];
  for (const r of results) {
    if (r.analysis && r.analysis.length > 0) {
      for (const v of r.analysis) {
        if (v.raceNumber && v.raceNumber !== 'N/A') {
          // Try to enrich from preset
          const presetParticipants = window.currentPresetParticipants ||
            (exportPanelPresetData?.participants || []);
          const presetMatch = presetParticipants.find(p => p.numero === v.raceNumber);

          return {
            number: v.raceNumber || '10',
            name: (presetMatch?.nome || (v.drivers ? v.drivers.join(', ') : '')) || 'Pierre Gasly',
            surname: '', // Will be extracted by renamer
            team: (presetMatch?.squadra || presetMatch?.team || v.team) || 'BWT Alpine F1 Team',
            car_model: (presetMatch?.car_model) || 'Alpine A526',
            nationality: '', // extracted from drivers
            originalFilename: r.originalPath ? r.originalPath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '') : 'IMG_1234'
          };
        }
      }
    }
  }

  // Fallback
  return {
    number: '10',
    name: 'Pierre Gasly',
    surname: 'Gasly',
    team: 'BWT Alpine F1 Team',
    car_model: 'Alpine A526',
    nationality: 'FRA',
    originalFilename: 'IMG_1234'
  };
}

// ============================================================
// Preview filename from pattern
// ============================================================
function previewExportFilename(pattern) {
  if (!pattern) return '(original filename)';

  const sample = getExportSampleParticipant();
  if (!sample) return pattern;

  // Extract surname
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
    .replace(/\{event\}/g, exportPanelPresetData?.name?.replace(/\s+/g, '_') || 'Event');

  // Date
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  result = result.replace(/\{date\}/g, dateStr);

  // Date with format
  result = result.replace(/\{date:([^}]+)\}/g, (match, fmt) => {
    return fmt
      .replace(/YYYY/g, String(now.getFullYear()))
      .replace(/YY/g, String(now.getFullYear()).slice(-2))
      .replace(/MM/g, String(now.getMonth()+1).padStart(2,'0'))
      .replace(/DD/g, String(now.getDate()).padStart(2,'0'));
  });

  // Sequence
  result = result.replace(/\{seq(?::(\d+))?\}/g, (match, padding) => {
    const pad = padding ? parseInt(padding) : 3;
    return '1'.padStart(pad, '0');
  });

  // Clean up
  result = result
    .replace(/\(\s*\)/g, '')
    .replace(/[_-]{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .trim();

  return result || '(empty)';
}

// ============================================================
// Create the modal
// ============================================================
function createExportPanelModal() {
  if (exportPanelModal) {
    exportPanelModal.remove();
    exportPanelModal = null;
  }

  const lv = window.logVisualizer;
  const results = lv ? lv.imageResults : [];
  const matchedCount = results.filter(r => r.analysis && r.analysis.length > 0 &&
    r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A')).length;
  const totalCount = results.length;

  const hasIptc = exportPanelHasIptc;
  const iptcMeta = hasIptc ? exportPanelPresetData.iptc_metadata : {};

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

  // Build IPTC summary if available
  let iptcSummaryHtml = '';
  if (hasIptc) {
    const summaryItems = [];
    if (iptcMeta.credit) summaryItems.push(`<span class="export-iptc-tag">Credit: ${escapeHtmlExport(iptcMeta.credit)}</span>`);
    if (iptcMeta.copyright) summaryItems.push(`<span class="export-iptc-tag">© ${escapeHtmlExport(iptcMeta.copyright)}</span>`);
    if (iptcMeta.city) summaryItems.push(`<span class="export-iptc-tag">📍 ${escapeHtmlExport(iptcMeta.city)}${iptcMeta.country ? ', ' + escapeHtmlExport(iptcMeta.country) : ''}</span>`);
    if (iptcMeta.descriptionTemplate) summaryItems.push(`<span class="export-iptc-tag">📝 Caption template</span>`);
    if (iptcMeta.baseKeywords && iptcMeta.baseKeywords.length > 0) summaryItems.push(`<span class="export-iptc-tag">🏷️ ${iptcMeta.baseKeywords.length} keywords</span>`);
    if (iptcMeta.personShownTemplate) summaryItems.push(`<span class="export-iptc-tag">👤 Person shown</span>`);

    iptcSummaryHtml = `
      <div class="export-section" id="export-sec-iptc">
        <div class="export-section-head">
          <label><input type="checkbox" id="export-chk-iptc" checked> 📋 Write IPTC Metadata</label>
          <span class="export-section-hint">Professional metadata from preset profile</span>
        </div>
        <div class="export-section-body">
          <div class="export-iptc-summary">
            ${summaryItems.join('')}
          </div>
          <div class="export-iptc-note">
            <small>Uses full IPTC profile from preset. <a href="#" id="export-open-iptc-pro">Edit fields in IPTC Pro →</a></small>
          </div>
          <div class="ipf-radio-row" style="margin-top: 0.5rem;">
            <label><input type="radio" name="export-kw-mode" value="append" ${iptcMeta.appendKeywords !== false ? 'checked' : ''}> Append keywords</label>
            <label><input type="radio" name="export-kw-mode" value="overwrite" ${iptcMeta.appendKeywords === false ? 'checked' : ''}> Overwrite keywords</label>
          </div>
        </div>
      </div>
    `;
  }

  const defaultPattern = '{number}_{name}_{nationality}_{team}_{car_model}-{seq:2}';

  const overlay = document.createElement('div');
  overlay.className = 'export-panel-overlay';
  overlay.innerHTML = `
    <div class="export-panel-modal">
      <div class="export-panel-header">
        <div class="export-panel-header-left">
          <div class="export-panel-badge">📦 EXPORT</div>
          <h2>Export & Rename</h2>
          <span class="export-panel-stats">${totalCount} images (${matchedCount} matched)</span>
        </div>
        <button class="export-panel-close" id="export-panel-close">&times;</button>
      </div>

      <div class="export-panel-body">
        <!-- Destination -->
        <div class="export-section">
          <div class="export-section-head">
            <label>📁 Destination Folder</label>
          </div>
          <div class="export-section-body">
            <div class="export-dest-row">
              <input type="text" id="export-dest-path" class="export-dest-input"
                placeholder="Select destination folder..." readonly
                value="${escapeAttrExport(sourceFolder ? sourceFolder + '/Export' : '')}">
              <button type="button" id="export-browse-btn" class="export-btn-browse">Browse...</button>
            </div>
          </div>
        </div>

        <!-- Filename Rename -->
        <div class="export-section">
          <div class="export-section-head">
            <label><input type="checkbox" id="export-chk-rename" checked> ✏️ Rename Files</label>
            <span class="export-section-hint">Pattern-based renaming with participant data</span>
          </div>
          <div class="export-section-body" id="export-rename-body">
            <div class="ipf">
              <label>Filename Pattern</label>
              <input type="text" id="export-rename-pattern"
                value="${escapeAttrExport(defaultPattern)}"
                placeholder="{number}_{name}_{team}-{seq:2}">
            </div>
            <div class="export-preview-row">
              <span class="export-preview-label">Preview:</span>
              <span class="export-preview-value" id="export-preview-filename"></span>
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
            <label><input type="checkbox" id="export-chk-subfolder"> 📂 Organize in Subfolders</label>
            <span class="export-section-hint">Group files by number, name, or team</span>
          </div>
          <div class="export-section-body" id="export-subfolder-body" style="display:none;">
            <div class="ipf">
              <label>Subfolder Pattern</label>
              <input type="text" id="export-subfolder-pattern"
                value="{number}_{surname}"
                placeholder="{number}_{name}">
            </div>
            <div class="export-preview-row">
              <span class="export-preview-label">Preview:</span>
              <span class="export-preview-value" id="export-preview-subfolder"></span>
            </div>
          </div>
        </div>

        <!-- IPTC (conditional) -->
        ${iptcSummaryHtml}
      </div>

      <div class="export-panel-footer">
        <div class="export-panel-footer-left">
          <label class="ipf-radio-row">
            <input type="radio" name="export-scope" value="matched" checked>
            <span>Matched only (${matchedCount})</span>
          </label>
          <label class="ipf-radio-row">
            <input type="radio" name="export-scope" value="all">
            <span>All files (${totalCount})</span>
          </label>
        </div>
        <div class="export-panel-footer-right">
          <button class="btn-iptc-cancel" id="export-cancel">Cancel</button>
          <button class="export-btn-start" id="export-start">
            📦 Export ${matchedCount} files
          </button>
        </div>
      </div>

      <!-- Progress overlay -->
      <div class="export-panel-progress" id="export-progress" style="display:none;">
        <h3 id="export-progress-title">Exporting files...</h3>
        <div class="iptc-pro-progress-bar">
          <div class="iptc-pro-progress-fill" id="export-progress-fill"></div>
        </div>
        <p id="export-progress-text">0 / 0</p>
        <p id="export-progress-phase" class="export-progress-phase"></p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  exportPanelModal = overlay;

  // Update preview
  updateExportPreview();

  // Wire events
  wireExportPanelEvents(matchedCount, totalCount);
}

// ============================================================
// Wire events
// ============================================================
function wireExportPanelEvents(matchedCount, totalCount) {
  // Close
  document.getElementById('export-panel-close').addEventListener('click', closeExportPanel);
  document.getElementById('export-cancel').addEventListener('click', closeExportPanel);
  exportPanelModal.addEventListener('click', (e) => {
    if (e.target === exportPanelModal && !exportPanelIsExporting) closeExportPanel();
  });

  // Browse destination
  document.getElementById('export-browse-btn').addEventListener('click', async () => {
    try {
      const selectedPath = await window.api.invoke('select-organization-destination');
      if (selectedPath) {
        document.getElementById('export-dest-path').value = selectedPath;
      }
    } catch (err) {
      console.error('[Export Panel] Error selecting destination:', err);
    }
  });

  // Rename pattern change → update preview
  const patternInput = document.getElementById('export-rename-pattern');
  if (patternInput) {
    patternInput.addEventListener('input', updateExportPreview);
  }

  // Subfolder pattern change → update preview
  const subfolderInput = document.getElementById('export-subfolder-pattern');
  if (subfolderInput) {
    subfolderInput.addEventListener('input', updateExportPreview);
  }

  // Rename checkbox toggle
  const renameChk = document.getElementById('export-chk-rename');
  if (renameChk) {
    renameChk.addEventListener('change', () => {
      const body = document.getElementById('export-rename-body');
      if (body) body.style.display = renameChk.checked ? '' : 'none';
    });
  }

  // Subfolder checkbox toggle
  const subfolderChk = document.getElementById('export-chk-subfolder');
  if (subfolderChk) {
    subfolderChk.addEventListener('change', () => {
      const body = document.getElementById('export-subfolder-body');
      if (body) body.style.display = subfolderChk.checked ? '' : 'none';
      updateExportPreview();
    });
  }

  // Placeholder chips - click to insert into pattern
  document.querySelectorAll('.export-ph').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('export-rename-pattern');
      if (input) {
        const pos = input.selectionStart || input.value.length;
        const ph = chip.dataset.ph;
        input.value = input.value.slice(0, pos) + ph + input.value.slice(pos);
        input.focus();
        input.setSelectionRange(pos + ph.length, pos + ph.length);
        updateExportPreview();
      }
    });
  });

  // IPTC Pro link
  const iptcProLink = document.getElementById('export-open-iptc-pro');
  if (iptcProLink) {
    iptcProLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeExportPanel();
      // Small delay then open IPTC Pro
      setTimeout(() => {
        if (typeof openIptcProModal === 'function') openIptcProModal();
      }, 300);
    });
  }

  // Scope radio → update button text
  document.querySelectorAll('input[name="export-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const scope = document.querySelector('input[name="export-scope"]:checked')?.value;
      const count = scope === 'all' ? totalCount : matchedCount;
      document.getElementById('export-start').textContent = `📦 Export ${count} files`;
    });
  });

  // Start export
  document.getElementById('export-start').addEventListener('click', startExport);
}

// ============================================================
// Update preview
// ============================================================
function updateExportPreview() {
  const patternInput = document.getElementById('export-rename-pattern');
  const previewEl = document.getElementById('export-preview-filename');

  if (patternInput && previewEl) {
    const pattern = patternInput.value;
    previewEl.textContent = previewExportFilename(pattern);
  }

  // Subfolder preview
  const subfolderInput = document.getElementById('export-subfolder-pattern');
  const subfolderPreview = document.getElementById('export-preview-subfolder');
  const subfolderChk = document.getElementById('export-chk-subfolder');

  if (subfolderInput && subfolderPreview && subfolderChk && subfolderChk.checked) {
    subfolderPreview.textContent = previewExportFilename(subfolderInput.value) + '/';
  }
}

// ============================================================
// Close
// ============================================================
function closeExportPanel() {
  if (exportPanelIsExporting) return;
  if (exportPanelModal) {
    exportPanelModal.remove();
    exportPanelModal = null;
  }
}

// ============================================================
// Collect export config
// ============================================================
function collectExportConfig() {
  const config = {};

  // Destination
  config.destinationFolder = document.getElementById('export-dest-path')?.value || '';

  // Rename
  const renameEnabled = document.getElementById('export-chk-rename')?.checked;
  config.renameEnabled = renameEnabled;
  config.renamePattern = renameEnabled ? (document.getElementById('export-rename-pattern')?.value || '') : '';

  // Subfolder
  const subfolderEnabled = document.getElementById('export-chk-subfolder')?.checked;
  config.subfolderEnabled = subfolderEnabled;
  config.subfolderPattern = subfolderEnabled ? (document.getElementById('export-subfolder-pattern')?.value || '') : '';

  // Scope
  config.scope = document.querySelector('input[name="export-scope"]:checked')?.value || 'matched';

  // IPTC
  const iptcChk = document.getElementById('export-chk-iptc');
  config.writeIptc = iptcChk ? iptcChk.checked : false;
  if (config.writeIptc) {
    config.keywordsMode = document.querySelector('input[name="export-kw-mode"]:checked')?.value || 'append';
  }

  return config;
}

// ============================================================
// Build images array for export
// ============================================================
function buildExportImages(scope) {
  const lv = window.logVisualizer;
  if (!lv) return [];

  const allResults = lv.imageResults || [];
  const presetParticipants = window.currentPresetParticipants ||
    (exportPanelPresetData?.participants || []);

  return allResults
    .filter(r => {
      if (scope === 'all') return true;
      return r.analysis && r.analysis.length > 0 &&
        r.analysis.some(v => v.raceNumber && v.raceNumber !== 'N/A');
    })
    .map(r => {
      const filePath = r.originalPath || r.imagePath || '';
      if (!filePath) return null;

      // Collect all matched participants
      const allMatchedParticipants = [];

      if (r.analysis && r.analysis.length > 0) {
        for (const vehicle of r.analysis) {
          if (!vehicle.raceNumber || vehicle.raceNumber === 'N/A') continue;

          const participant = {
            name: vehicle.drivers ? vehicle.drivers.join(', ') : '',
            number: vehicle.raceNumber || '',
            team: vehicle.team || ''
          };

          // Enrich from preset
          const presetMatch = presetParticipants.find(p => p.numero === vehicle.raceNumber);
          if (presetMatch) {
            if (!participant.name && presetMatch.nome) participant.name = presetMatch.nome;
            if (presetMatch.car_model) participant.car_model = presetMatch.car_model;
            if (presetMatch.metatag) participant.metatag = presetMatch.metatag;
            if (presetMatch.nationality) participant.nationality = presetMatch.nationality;
            if (!participant.team && presetMatch.squadra) participant.team = presetMatch.squadra;

            // Get nationality from drivers
            if (!participant.nationality && presetMatch.preset_participant_drivers?.length > 0) {
              const firstDriver = presetMatch.preset_participant_drivers[0];
              if (firstDriver.driver_nationality) {
                participant.nationality = firstDriver.driver_nationality;
              }
            }
          }

          // Enrich from csvMatch
          if (r.csvMatch && vehicle === r.analysis[0]) {
            if (!participant.name && r.csvMatch.nome) participant.name = r.csvMatch.nome;
            if (r.csvMatch.car_model) participant.car_model = r.csvMatch.car_model;
          }

          allMatchedParticipants.push(participant);
        }
      }

      return {
        imagePath: filePath,
        participant: allMatchedParticipants.length > 0 ? allMatchedParticipants[0] : null,
        allMatchedParticipants: allMatchedParticipants.length > 0 ? allMatchedParticipants : undefined,
        aiKeywords: r.logEvent?.keywords || []
      };
    })
    .filter(r => r !== null);
}

// ============================================================
// Start export
// ============================================================
async function startExport() {
  if (exportPanelIsExporting) return;

  const config = collectExportConfig();

  // Validate
  if (!config.destinationFolder) {
    alert('Please select a destination folder.');
    return;
  }

  const images = buildExportImages(config.scope);
  if (images.length === 0) {
    alert('No files to export.');
    return;
  }

  exportPanelIsExporting = true;

  // Show progress
  const progressEl = document.getElementById('export-progress');
  if (progressEl) progressEl.style.display = 'flex';

  const startBtn = document.getElementById('export-start');
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Exporting...'; }

  // Setup progress listener
  const cleanupProgress = window.api.receive('unified-export-progress', (data) => {
    const { current, total, phase, fileName } = data;
    const fill = document.getElementById('export-progress-fill');
    const text = document.getElementById('export-progress-text');
    const phaseEl = document.getElementById('export-progress-phase');

    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (text) text.textContent = `${current} / ${total}`;
    if (phaseEl) phaseEl.textContent = phase === 'copy' ? `Copying: ${fileName || ''}` :
      phase === 'iptc' ? `Writing IPTC: ${fileName || ''}` : fileName || '';
  });

  try {
    // Build IPTC metadata if needed
    let iptcMetadata = null;
    if (config.writeIptc && exportPanelHasIptc) {
      iptcMetadata = exportPanelPresetData.iptc_metadata;
    }

    const response = await window.api.invoke('unified-export', {
      images: images,
      destinationFolder: config.destinationFolder,
      renamePattern: config.renameEnabled ? config.renamePattern : null,
      subfolderPattern: config.subfolderEnabled ? config.subfolderPattern : null,
      writeIptc: config.writeIptc,
      iptcMetadata: iptcMetadata,
      keywordsMode: config.writeIptc ? config.keywordsMode : null,
      eventName: exportPanelPresetData?.name || ''
    });

    if (response.success) {
      const summary = response.data;
      const title = document.getElementById('export-progress-title');
      const text = document.getElementById('export-progress-text');
      const fill = document.getElementById('export-progress-fill');
      const phase = document.getElementById('export-progress-phase');

      if (fill) fill.style.width = '100%';
      if (title) title.textContent = '✅ Export Complete!';
      if (text) {
        text.textContent = `${summary.copiedFiles} files exported` +
          (summary.renamedFiles > 0 ? `, ${summary.renamedFiles} renamed` : '') +
          (summary.iptcWritten > 0 ? `, ${summary.iptcWritten} with IPTC` : '') +
          (summary.errors > 0 ? `, ${summary.errors} errors` : '');
      }
      if (phase) phase.textContent = `Duration: ${(summary.durationMs / 1000).toFixed(1)}s`;

      setTimeout(() => {
        exportPanelIsExporting = false;
        closeExportPanel();
      }, 2500);
    } else {
      throw new Error(response.error || 'Unknown error');
    }
  } catch (error) {
    console.error('[Export Panel] Export error:', error);
    const title = document.getElementById('export-progress-title');
    if (title) title.textContent = '❌ Error: ' + error.message;
    exportPanelIsExporting = false;
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Retry'; }
  } finally {
    if (cleanupProgress) cleanupProgress();
  }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtmlExport(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttrExport(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-export');
  if (btn) {
    btn.addEventListener('click', openExportPanel);
  }

  // Check availability after results load
  setTimeout(() => {
    checkExportPanelAvailability();
  }, 3500);

  // Poll for logVisualizer
  const interval = setInterval(() => {
    if (window.logVisualizer && window.logVisualizer.participantPresetData) {
      clearInterval(interval);
      checkExportPanelAvailability();
    }
  }, 500);
  setTimeout(() => clearInterval(interval), 30000);
});
