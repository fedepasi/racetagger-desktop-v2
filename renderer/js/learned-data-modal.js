/**
 * Learned Data Modal
 *
 * After a user makes manual corrections in the results page, this module:
 * 1. Aggregates Vehicle DNA (sponsors, team, make, model, livery, etc.) from corrected images
 * 2. Shows a modal proposing to enrich the participant preset with learned data
 * 3. Writes accepted data to preset_participants.custom_fields via IPC
 *
 * Part of Strategy G (Feedback Learning System) — zero additional token cost.
 */

/**
 * Inline canonical key for sponsor deduplication in the renderer (plain JS, no imports).
 * Mirrors the TypeScript `canonicalKey` in src/matching/sponsor-canonical.ts:
 *   Step 1: expand umlauts to ASCII before NFD strips the combining marks
 *   Step 2: NFD diacritic strip, lowercase, whitespace collapse
 * (Generic suffix strip omitted here — aggregation only; write-time dedup in main.ts handles it.)
 */
function _canonicalKey(raw) {
  if (!raw) return '';
  let s = String(raw)
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'ae').replace(/Ö/g, 'oe').replace(/Ü/g, 'ue').replace(/ß/g, 'ss');
  s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return s;
}

class LearnedDataModal {
  constructor() {
    this.modalElement = null;
    this.aggregatedData = null; // Map<raceNumber, LearnedFields>
    this.processedExecutions = new Set(); // Track executions already saved to prevent re-proposal
    this.seriesSponsorCandidates = []; // SeriesSponsorCandidate[] detected up front for this execution
  }

  /**
   * Per-execution "skipped" flag, persisted in localStorage so it survives page
   * reloads. Deliberately SEPARATE from processedExecutions: accepting data
   * hides the button entirely, but skipping must only stop the *auto*-popup
   * (shown when the user clicks DONE / New Analysis) — the "✨ Improve Preset"
   * button stays available so they can reopen the suggestions on demand.
   */
  _skipKey(executionId) {
    return `rt_learned_skipped_${executionId}`;
  }

  markExecutionSkipped(executionId) {
    if (!executionId) return;
    try { localStorage.setItem(this._skipKey(executionId), '1'); } catch (_) { /* storage disabled — non-critical */ }
  }

  isExecutionSkipped(executionId) {
    if (!executionId) return false;
    try { return localStorage.getItem(this._skipKey(executionId)) === '1'; } catch (_) { return false; }
  }

  /**
   * Build a per-car sponsor frequency map for series-sponsor detection.
   * De-dupes sponsors within a car by canonical key (so a car shown in 30
   * photos counts once), then counts how many distinct cars carry each sponsor.
   * Returns { freq: [[display, carCount], …], totalCars } ready for the
   * detect-series-sponsors IPC.
   */
  _buildSeriesSponsorFrequency(imageResults) {
    const totalCars = new Set();      // every distinct matched race number
    const carSponsorKeys = new Map(); // raceNumber -> Set<canonicalKey>
    const keyDisplay = new Map();     // canonicalKey -> first display seen

    for (const result of imageResults || []) {
      const vehicles = result.logEvent?.aiResponse?.vehicles;
      if (!Array.isArray(vehicles)) continue;
      for (const vehicle of vehicles) {
        const raceNumber = vehicle.finalResult?.raceNumber || vehicle.raceNumber;
        if (!raceNumber || raceNumber === 'N/A') continue;
        const numStr = String(raceNumber);
        totalCars.add(numStr);

        const sponsors = vehicle.otherText || vehicle.sponsors || [];
        if (!Array.isArray(sponsors)) continue;
        if (!carSponsorKeys.has(numStr)) carSponsorKeys.set(numStr, new Set());
        const keysForCar = carSponsorKeys.get(numStr);
        for (const s of sponsors) {
          const display = String(s).trim();
          const key = _canonicalKey(display);
          if (!key || key.length <= 1) continue;
          keysForCar.add(key);
          if (!keyDisplay.has(key)) keyDisplay.set(key, display);
        }
      }
    }

    // One vote per car per sponsor → coverage = carsWith / totalCars
    const freq = new Map();
    for (const keys of carSponsorKeys.values()) {
      for (const key of keys) {
        const display = keyDisplay.get(key) || key;
        freq.set(display, (freq.get(display) || 0) + 1);
      }
    }

    return { freq: Array.from(freq.entries()), totalCars: totalCars.size };
  }

  /**
   * Detect series-wide sponsors for THIS execution, up front (before any save),
   * by reusing the canonical TS detector via IPC (single source of truth — the
   * fuzzy clustering is too involved to mirror in the renderer). Candidates
   * already in the preset's ignore list are filtered out. Result is stored on
   * this.seriesSponsorCandidates so the modal can show a dedicated section.
   */
  async computeSeriesSponsorCandidates(imageResults, existingSeriesIgnore = []) {
    this.seriesSponsorCandidates = [];
    try {
      const { freq, totalCars } = this._buildSeriesSponsorFrequency(imageResults);
      if (freq.length === 0 || totalCars < 4) return this.seriesSponsorCandidates;
      const res = await window.api.invoke('detect-series-sponsors', {
        freq,
        totalCars,
        existingIgnore: existingSeriesIgnore || [],
      });
      if (res?.success && Array.isArray(res.data?.candidates)) {
        this.seriesSponsorCandidates = res.data.candidates;
      }
    } catch (e) {
      console.warn('[LearnedDataModal] series-sponsor detection failed (non-critical):', e);
    }
    return this.seriesSponsorCandidates;
  }

  /**
   * Analyze corrections and determine if there's useful data to propose.
   * Call this after corrections have been saved (saveAllChanges or closeGallery).
   *
   * @param {Array} imageResults - All results with logEvent data
   * @param {Map} manualCorrections - Map of correctionKey -> correction data
   * @param {Array} presetParticipants - Current preset participants for cross-reference
   * @returns {Map|null} aggregated data per race number, or null if nothing useful
   */
  aggregateLearnedData(imageResults, manualCorrections, presetParticipants) {
    if (!manualCorrections || manualCorrections.size === 0) {
      return null;
    }

    // Build a lookup: presetParticipant by number
    const participantByNumber = new Map();
    if (presetParticipants) {
      presetParticipants.forEach(p => {
        const num = p.numero || p.number;
        if (num) participantByNumber.set(String(num), p);
      });
    }

    // Aggregate Vehicle DNA from corrections where the user changed the race number
    // Key insight: when user corrects 41→7, the Vehicle DNA Gemini detected for that
    // image (sponsors, team, etc.) now belongs to participant #7
    const aggregated = new Map(); // raceNumber -> { sponsors: Set, team: Map<string,count>, ... }

    for (const [correctionKey, correction] of manualCorrections) {
      const { fileName, vehicleIndex, changes } = correction;

      // We're primarily interested in raceNumber corrections
      // but also capture data from other field corrections
      const correctedNumber = changes.raceNumber || changes.numero;
      if (!correctedNumber) continue;

      // Find the original log event to extract Vehicle DNA
      const result = imageResults.find(r => r.fileName === fileName);
      if (!result || !result.logEvent) continue;

      const vehicle = result.logEvent?.aiResponse?.vehicles?.[vehicleIndex];
      if (!vehicle) continue;

      // Initialize aggregation for this race number
      if (!aggregated.has(String(correctedNumber))) {
        aggregated.set(String(correctedNumber), {
          raceNumber: String(correctedNumber),
          sponsors: new Map(),     // sponsor -> count
          teams: new Map(),        // team -> count
          makes: new Map(),        // make -> count
          models: new Map(),       // model -> count
          categories: new Map(),   // category -> count
          liveries: [],            // array of {primary, secondary} objects
          plates: new Map(),       // plate -> count
          contexts: [],            // raw context strings
          observationCount: 0,
          sourceImages: [],
        });
      }

      const entry = aggregated.get(String(correctedNumber));
      entry.observationCount++;
      entry.sourceImages.push(fileName);

      // Extract sponsors from otherText (Gemini's sponsor field)
      const sponsors = vehicle.otherText || vehicle.sponsors || [];
      if (Array.isArray(sponsors)) {
        sponsors.forEach(s => {
          const normalized = String(s).trim();
          if (normalized && normalized.length > 1) {
            entry.sponsors.set(normalized, (entry.sponsors.get(normalized) || 0) + 1);
          }
        });
      }

      // Team
      const team = vehicle.teamName || vehicle.team;
      if (team && String(team).trim()) {
        const normalized = String(team).trim();
        entry.teams.set(normalized, (entry.teams.get(normalized) || 0) + 1);
      }

      // Make
      if (vehicle.make && String(vehicle.make).trim()) {
        const normalized = String(vehicle.make).trim();
        entry.makes.set(normalized, (entry.makes.get(normalized) || 0) + 1);
      }

      // Model
      if (vehicle.model && String(vehicle.model).trim()) {
        const normalized = String(vehicle.model).trim();
        entry.models.set(normalized, (entry.models.get(normalized) || 0) + 1);
      }

      // Category
      if (vehicle.category && String(vehicle.category).trim()) {
        const normalized = String(vehicle.category).trim();
        entry.categories.set(normalized, (entry.categories.get(normalized) || 0) + 1);
      }

      // Livery
      if (vehicle.livery && vehicle.livery.primary) {
        entry.liveries.push(vehicle.livery);
      }

      // Plate
      if (vehicle.plateNumber && String(vehicle.plateNumber).trim()) {
        const normalized = String(vehicle.plateNumber).trim();
        entry.plates.set(normalized, (entry.plates.get(normalized) || 0) + 1);
      }

      // Context
      if (vehicle.context && String(vehicle.context).trim()) {
        entry.contexts.push(String(vehicle.context).trim());
      }
    }

    if (aggregated.size === 0) return null;

    // Now process aggregated data: pick the most frequent values and filter
    // against what the participant already has in the preset
    const proposals = new Map();

    for (const [raceNumber, entry] of aggregated) {
      const participant = participantByNumber.get(raceNumber);
      const proposal = {
        raceNumber,
        participantId: participant?.id || null,
        participantName: participant?.nome || participant?.name || null,
        observationCount: entry.observationCount,
        fields: {},
      };

      // Helper: pick most frequent from a Map, only if participant doesn't have it
      const pickBest = (map) => {
        if (map.size === 0) return null;
        let best = null, bestCount = 0;
        for (const [val, count] of map) {
          if (count > bestCount) { best = val; bestCount = count; }
        }
        return best;
      };

      // Sponsors — merge all unique sponsors
      if (entry.sponsors.size > 0) {
        const existingSponsor = participant?.sponsor || '';
        const existingSponsors = existingSponsor ? existingSponsor.split(',').map(s => s.trim().toLowerCase()) : [];
        const newSponsors = [];
        for (const [sponsor] of entry.sponsors) {
          if (!existingSponsors.includes(sponsor.toLowerCase())) {
            newSponsors.push(sponsor);
          }
        }
        if (newSponsors.length > 0) {
          proposal.fields.sponsors = newSponsors;
        }
      }

      // Team — only if participant doesn't have one
      const bestTeam = pickBest(entry.teams);
      if (bestTeam && !(participant?.squadra || participant?.team)) {
        proposal.fields.team = bestTeam;
      }

      // Make — only if not set
      if (!(participant?.car_model)) {
        const bestMake = pickBest(entry.makes);
        const bestModel = pickBest(entry.models);
        if (bestMake || bestModel) {
          const parts = [bestMake, bestModel].filter(Boolean);
          proposal.fields.car_model = parts.join(' ');
        }
      }

      // Category — only if not set
      if (!(participant?.categoria || participant?.category)) {
        const bestCategory = pickBest(entry.categories);
        if (bestCategory) {
          proposal.fields.category = bestCategory;
        }
      }

      // Plate — only if not set
      if (!(participant?.plate_number)) {
        const bestPlate = pickBest(entry.plates);
        if (bestPlate) {
          proposal.fields.plate_number = bestPlate;
        }
      }

      // Livery — aggregate into most common primary color
      if (entry.liveries.length > 0) {
        const primaryColors = new Map();
        entry.liveries.forEach(l => {
          if (l.primary) primaryColors.set(l.primary, (primaryColors.get(l.primary) || 0) + 1);
        });
        const bestPrimary = pickBest(primaryColors);
        const allSecondary = [...new Set(entry.liveries.flatMap(l => l.secondary || []))];
        if (bestPrimary) {
          proposal.fields.livery = { primary: bestPrimary, secondary: allSecondary };
        }
      }

      // Only include the proposal if we have at least one useful field
      if (Object.keys(proposal.fields).length > 0) {
        proposals.set(raceNumber, proposal);
      }
    }

    this.aggregatedData = proposals;
    return proposals.size > 0 ? proposals : null;
  }

  /**
   * Also aggregate data from NON-corrected results — if Gemini consistently
   * detected the same sponsors/team across many images for a given number,
   * we can propose those even without user corrections.
   *
   * @param {Array} imageResults - All results with logEvent data
   * @param {Array} presetParticipants - Current preset participants
   * @param {number} minObservations - Minimum consistent observations to propose (default: 5)
   */
  aggregateConsistentDetections(imageResults, presetParticipants, minObservations = 5) {
    if (!imageResults || imageResults.length === 0) return null;

    const participantByNumber = new Map();
    if (presetParticipants) {
      presetParticipants.forEach(p => {
        const num = p.numero || p.number;
        if (num) participantByNumber.set(String(num), p);
      });
    }

    // Count sponsor/team occurrences per raceNumber across ALL images
    const perNumber = new Map(); // raceNumber -> { sponsors: Map, teams: Map, total: number }

    for (const result of imageResults) {
      if (!result.logEvent?.aiResponse?.vehicles) continue;

      for (const vehicle of result.logEvent.aiResponse.vehicles) {
        const raceNumber = vehicle.finalResult?.raceNumber || vehicle.raceNumber;
        if (!raceNumber || raceNumber === 'N/A') continue;
        const numStr = String(raceNumber);

        if (!perNumber.has(numStr)) {
          perNumber.set(numStr, { sponsors: new Map(), sponsorDisplay: new Map(), teams: new Map(), makes: new Map(), models: new Map(), total: 0 });
        }

        const entry = perNumber.get(numStr);
        entry.total++;

        // Sponsors — aggregate by canonical key to avoid case/umlaut duplicates
        const sponsors = vehicle.otherText || vehicle.sponsors || [];
        if (Array.isArray(sponsors)) {
          sponsors.forEach(s => {
            const display = String(s).trim();
            const key = _canonicalKey(display);
            if (key && key.length > 1) {
              if (!entry.sponsorDisplay.has(key)) entry.sponsorDisplay.set(key, display);
              entry.sponsors.set(key, (entry.sponsors.get(key) || 0) + 1);
            }
          });
        }

        // Team
        const team = vehicle.teamName || vehicle.team;
        if (team && String(team).trim()) {
          entry.teams.set(String(team).trim(), (entry.teams.get(String(team).trim()) || 0) + 1);
        }

        // Make/Model
        if (vehicle.make) entry.makes.set(String(vehicle.make).trim(), (entry.makes.get(String(vehicle.make).trim()) || 0) + 1);
        if (vehicle.model) entry.models.set(String(vehicle.model).trim(), (entry.models.get(String(vehicle.model).trim()) || 0) + 1);
      }
    }

    // Only propose if consistency >= 50% of observations AND >= minObservations
    if (!this.aggregatedData) this.aggregatedData = new Map();

    for (const [raceNumber, entry] of perNumber) {
      if (entry.total < minObservations) continue;
      if (this.aggregatedData.has(raceNumber)) continue; // Already proposed via corrections

      const participant = participantByNumber.get(raceNumber);
      const proposal = {
        raceNumber,
        participantId: participant?.id || null,
        participantName: participant?.nome || participant?.name || null,
        observationCount: entry.total,
        fields: {},
        isAutoDetected: true, // Flag: these are from consistent detection, not user corrections
      };

      const threshold = entry.total * 0.5;

      // Sponsors with >= 50% consistency and not already in preset
      const existingSponsor = participant?.sponsor || '';
      const existingKeys = existingSponsor
        ? new Set(existingSponsor.split(',').map(s => _canonicalKey(s.trim())))
        : new Set();
      const consistentSponsors = [];
      for (const [sponsorKey, count] of entry.sponsors) {
        if (count >= threshold && !existingKeys.has(sponsorKey)) {
          consistentSponsors.push(entry.sponsorDisplay.get(sponsorKey) || sponsorKey);
        }
      }
      if (consistentSponsors.length > 0) proposal.fields.sponsors = consistentSponsors;

      // Team with >= 50% consistency
      if (!(participant?.squadra || participant?.team)) {
        for (const [team, count] of entry.teams) {
          if (count >= threshold) { proposal.fields.team = team; break; }
        }
      }

      // Make + Model
      if (!(participant?.car_model)) {
        let bestMake = null, bestModel = null;
        for (const [make, count] of entry.makes) {
          if (count >= threshold) { bestMake = make; break; }
        }
        for (const [model, count] of entry.models) {
          if (count >= threshold) { bestModel = model; break; }
        }
        if (bestMake || bestModel) {
          proposal.fields.car_model = [bestMake, bestModel].filter(Boolean).join(' ');
        }
      }

      if (Object.keys(proposal.fields).length > 0) {
        this.aggregatedData.set(raceNumber, proposal);
      }
    }

    return this.aggregatedData.size > 0 ? this.aggregatedData : null;
  }

  /**
   * Show the modal with learned data proposals.
   *
   * @param {string} presetId - The preset UUID
   * @param {string} executionId - The execution UUID
   * @param {string[]} existingSeriesIgnore - canonical keys already ignored for series sponsors
   * @returns {Promise<boolean>} true if user accepted some data
   */
  async show(presetId, executionId, existingSeriesIgnore = []) {
    const hasProposals = this.aggregatedData && this.aggregatedData.size > 0;
    const hasSeries = Array.isArray(this.seriesSponsorCandidates) && this.seriesSponsorCandidates.length > 0;
    if (!hasProposals && !hasSeries) {
      return false;
    }

    return new Promise((resolve) => {
      this._createModal(presetId, executionId, resolve, existingSeriesIgnore);
    });
  }

  /**
   * Create and display the modal DOM
   */
  _createModal(presetId, executionId, resolvePromise, existingSeriesIgnore = []) {
    // Remove any existing modal
    const existing = document.getElementById('learned-data-modal');
    if (existing) existing.remove();

    const proposals = this.aggregatedData ? Array.from(this.aggregatedData.values()) : [];
    const totalFields = proposals.reduce((sum, p) => sum + Object.keys(p.fields).length, 0);
    const seriesCandidates = Array.isArray(this.seriesSponsorCandidates) ? this.seriesSponsorCandidates : [];
    const hasSeries = seriesCandidates.length > 0;

    // Adaptive headline — the modal can carry per-participant data, series
    // sponsors, or both.
    let headlineHtml;
    if (proposals.length > 0 && hasSeries) {
      headlineHtml = `Found <strong>${totalFields} data point${totalFields === 1 ? '' : 's'}</strong> for <strong>${proposals.length} participant${proposals.length === 1 ? '' : 's'}</strong>, plus <strong>${seriesCandidates.length} series sponsor${seriesCandidates.length === 1 ? '' : 's'}</strong> to clean up.`;
    } else if (proposals.length > 0) {
      headlineHtml = `Found <strong>${totalFields} data point${totalFields === 1 ? '' : 's'}</strong> for <strong>${proposals.length} participant${proposals.length === 1 ? '' : 's'}</strong> that can improve future recognition accuracy.`;
    } else {
      headlineHtml = `Found <strong>${seriesCandidates.length} series sponsor${seriesCandidates.length === 1 ? '' : 's'}</strong> that appear on most cars — ignoring them keeps matching clean.`;
    }

    const modal = document.createElement('div');
    modal.id = 'learned-data-modal';
    modal.className = 'learned-data-overlay';
    modal.innerHTML = `
      <div class="learned-data-container">
        <div class="learned-data-header">
          <div class="learned-data-icon">&#10024;</div>
          <div class="learned-data-title">
            <h3>Useful Data Found</h3>
            <p>${headlineHtml}</p>
          </div>
          <button class="learned-data-close" id="learned-data-close">&times;</button>
        </div>

        <div class="learned-data-body">
          ${hasSeries ? this._renderSeriesSection(seriesCandidates) : ''}
          ${proposals.map((proposal, idx) => this._renderProposal(proposal, idx)).join('')}
        </div>

        <div class="learned-data-footer">
          <div class="learned-data-footer-info">
            Selected data will be saved to the preset to improve SmartMatcher accuracy.
          </div>
          <div class="learned-data-footer-actions">
            <button class="learned-data-btn learned-data-btn-skip" id="learned-data-skip">Skip</button>
            <button class="learned-data-btn learned-data-btn-accept" id="learned-data-accept">
              Update Preset
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalElement = modal;

    // All checkboxes start checked
    const checkboxes = modal.querySelectorAll('.learned-field-checkbox');
    checkboxes.forEach(cb => cb.checked = true);

    // Telemetry: LEARNED_DATA_PROPOSED — fires when the modal opens with
    // suggestions. Track which fields the system surfaced so we can
    // measure proposal quality vs. acceptance rate (low acceptance =
    // bad proposals = tune the aggregation logic).
    const __proposedFieldTypes = new Set();
    for (const p of proposals) {
      if (p && p.fields && typeof p.fields === 'object') {
        for (const k of Object.keys(p.fields)) __proposedFieldTypes.add(k);
      }
    }
    if (window.logUserAction) {
      window.logUserAction('LEARNED_DATA_PROPOSED', 'CORRECT', {
        proposalCount: proposals.length,
        totalFieldCount: totalFields,
        seriesSponsorCount: seriesCandidates.length,
        fieldTypes: Array.from(__proposedFieldTypes)
      });
    }

    // Event listeners
    const closeBtn = modal.querySelector('#learned-data-close');
    const skipBtn = modal.querySelector('#learned-data-skip');
    const acceptBtn = modal.querySelector('#learned-data-accept');

    const dismiss = (via) => {
      // Remember the skip for this execution so the auto-popup (DONE / New
      // Analysis) won't nag again — the ✨ Improve Preset button still reopens
      // it on demand. Any close-without-save counts (skip, ✕, outside click).
      this.markExecutionSkipped(executionId);

      // Telemetry: LEARNED_DATA_DISMISSED — user closed without accepting.
      // The `via` field lets us distinguish "explicit Skip click" from
      // "clicked the X" from "clicked outside" — different intents.
      if (window.logUserAction) {
        window.logUserAction('LEARNED_DATA_DISMISSED', 'CORRECT', {
          via: via || 'unknown',
          proposalCount: proposals.length,
          totalFieldCount: totalFields
        });
      }
      modal.remove();
      this.modalElement = null;
      resolvePromise(false);
    };

    closeBtn.addEventListener('click', () => dismiss('close-x'));
    skipBtn.addEventListener('click', () => dismiss('skip-button'));
    modal.addEventListener('click', (e) => { if (e.target === modal) dismiss('outside-click'); });

    acceptBtn.addEventListener('click', async () => {
      // Collect both kinds of selection: per-participant learned fields and
      // checked series-wide sponsors. Either (or both) can be saved.
      const acceptedData = this._collectAcceptedData(modal);
      const checkedSeries = this._collectCheckedSeries(modal, seriesCandidates);

      if (acceptedData.length === 0 && checkedSeries.length === 0) {
        dismiss('accept-but-empty');
        return;
      }

      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Saving...';

      try {
        let participantsUpdated = 0;

        // 1) Per-participant learned data (only if any field is checked)
        if (acceptedData.length > 0) {
          const result = await window.api.invoke('save-learned-participant-data', {
            presetId,
            executionId,
            participants: acceptedData,
          });
          if (!result.success) {
            console.error('[LearnedDataModal] Save failed:', result.error);
            acceptBtn.textContent = '❌ Save failed';
            acceptBtn.disabled = false;
            setTimeout(() => { acceptBtn.textContent = 'Update Preset'; }, 2000);
            return;
          }
          participantsUpdated = result.data?.updated || acceptedData.length;
          // Mark execution as processed so the per-participant proposals aren't re-shown
          this.processedExecutions.add(executionId);

          // Telemetry: LEARNED_DATA_SAVED — heartbeat of the "learn from
          // corrections" loop (what % of users who SEE the proposal accept it).
          if (window.logUserAction) {
            const acceptedFieldTypes = new Set();
            for (const p of acceptedData) {
              if (p && p.fields && typeof p.fields === 'object') {
                for (const k of Object.keys(p.fields)) acceptedFieldTypes.add(k);
              }
            }
            window.logUserAction('LEARNED_DATA_SAVED', 'CORRECT', {
              participantCount: acceptedData.length,
              acceptedFieldTypes: Array.from(acceptedFieldTypes),
              proposedCount: proposals.length,
              partialAcceptance: acceptedData.length < proposals.length
            });
          }
        }

        // 2) Series-wide sponsors → preset.series_sponsor_ignore (only if checked)
        if (checkedSeries.length > 0) {
          const newKeys = checkedSeries
            .map(c => c.key || (c.display || '').toLowerCase().replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const merged = Array.from(new Set([...(existingSeriesIgnore || []), ...newKeys]));
          const upd = await window.api.invoke('supabase-update-participant-preset', {
            id: presetId,
            series_sponsor_ignore: merged,
          });
          if (!upd.success) {
            console.error('[LearnedDataModal] series_sponsor_ignore update failed:', upd.error);
            // Any per-participant data is already saved — report partial failure.
            acceptBtn.textContent = participantsUpdated > 0 ? '⚠️ Sponsors not saved' : '❌ Save failed';
            acceptBtn.disabled = false;
            setTimeout(() => { acceptBtn.textContent = 'Update Preset'; }, 2500);
            return;
          }
          if (window.logUserAction) {
            window.logUserAction('SERIES_SPONSOR_IGNORED', 'CORRECT', {
              addedCount: newKeys.length,
              totalAfter: merged.length
            });
          }
        }

        // Success — summarize what was saved
        const bits = [];
        if (participantsUpdated > 0) bits.push(`${participantsUpdated} participant${participantsUpdated === 1 ? '' : 's'}`);
        if (checkedSeries.length > 0) bits.push(`${checkedSeries.length} series sponsor${checkedSeries.length === 1 ? '' : 's'}`);
        acceptBtn.textContent = `✅ ${bits.join(' · ')} saved`;
        acceptBtn.classList.add('learned-data-btn-success');

        this.aggregatedData = null;
        this.seriesSponsorCandidates = [];

        setTimeout(() => {
          modal.remove();
          this.modalElement = null;
          resolvePromise(true);
        }, 1400);
      } catch (error) {
        console.error('[LearnedDataModal] Error:', error);
        acceptBtn.textContent = '❌ Error';
        acceptBtn.disabled = false;
      }
    });
  }

  /**
   * Render the dedicated "Championship / series sponsors" section shown at the
   * TOP of the modal body (ACC-04, surfaced up front). Each candidate is a
   * checkbox; sponsors covering ≥70% of cars are pre-checked (very likely
   * series-wide), lower coverage is suggested but unchecked. Checked entries
   * are saved to the preset's series_sponsor_ignore on Update Preset.
   *
   * @param {Array} candidates - SeriesSponsorCandidate[] (already filtered to new ones)
   * @returns {string} HTML for the section
   */
  _renderSeriesSection(candidates) {
    const rows = candidates.map((c, i) => {
      const pct = Math.round((c.coverageFraction || 0) * 100);
      const preChecked = pct >= 70 ? 'checked' : '';
      const coverageLabel = pct >= 70
        ? `<span style="color:#10b981;font-size:11px">${pct}% of cars — likely series-wide</span>`
        : `<span style="color:#f59e0b;font-size:11px">${pct}% of cars — possible series sponsor</span>`;
      return `
        <label class="learned-series-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color,#2a2a4a);cursor:pointer">
          <input type="checkbox" class="learned-series-checkbox" data-series-idx="${i}" ${preChecked}
            style="width:16px;height:16px;flex-shrink:0;accent-color:#1a9ee0">
          <span style="flex:1;min-width:0">
            <span style="font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;color:var(--text-primary,#e0e0e0)">${c.display}</span>
            <br>${coverageLabel}
          </span>
        </label>`;
    }).join('');

    // Theme-aware: uses the same tokens as the rest of the modal (--text-primary,
    // --text-secondary, --border-color), which resolve light on results.html and
    // dark on the main window — so it never renders white-on-white.
    return `
      <div class="learned-series-section" style="padding:14px;background:rgba(245,158,11,0.08);border:1px solid var(--border-color,#2a2a4a);border-radius:8px;border-top:3px solid #f59e0b">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px">🏁 Championship / series sponsors</div>
        <div style="font-size:12px;color:var(--text-secondary,#888);margin-bottom:12px">
          These appear on most cars in this event — likely series or venue sponsors, not participant-specific.
          Add them to the preset's ignore list so RaceTagger stops matching them to every car.
        </div>
        ${rows}
      </div>`;
  }

  /**
   * Collect the checked series-sponsor candidates from the modal.
   * @returns {Array} the selected SeriesSponsorCandidate objects
   */
  _collectCheckedSeries(modal, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    return Array.from(modal.querySelectorAll('.learned-series-checkbox:checked'))
      .map(cb => candidates[parseInt(cb.dataset.seriesIdx, 10)])
      .filter(Boolean);
  }

  /**
   * Render a single participant proposal card
   */
  _renderProposal(proposal, idx) {
    const source = proposal.isAutoDetected
      ? `<span class="learned-source-auto">auto-detected in ${proposal.observationCount} photo${proposal.observationCount === 1 ? '' : 's'}</span>`
      : `<span class="learned-source-manual">from ${proposal.observationCount} manual correction${proposal.observationCount === 1 ? '' : 's'}</span>`;

    const nameDisplay = proposal.participantName
      ? `#${proposal.raceNumber} — ${proposal.participantName}`
      : `#${proposal.raceNumber}`;

    const fieldRows = [];

    if (proposal.fields.sponsors) {
      fieldRows.push(this._renderField(idx, 'sponsors', 'Sponsor', proposal.fields.sponsors.join(', ')));
    }
    if (proposal.fields.team) {
      fieldRows.push(this._renderField(idx, 'team', 'Team', proposal.fields.team));
    }
    if (proposal.fields.car_model) {
      fieldRows.push(this._renderField(idx, 'car_model', 'Car', proposal.fields.car_model));
    }
    if (proposal.fields.category) {
      fieldRows.push(this._renderField(idx, 'category', 'Category', proposal.fields.category));
    }
    if (proposal.fields.plate_number) {
      fieldRows.push(this._renderField(idx, 'plate_number', 'Plate', proposal.fields.plate_number));
    }
    if (proposal.fields.livery) {
      const liveryText = proposal.fields.livery.primary +
        (proposal.fields.livery.secondary?.length > 0 ? ` + ${proposal.fields.livery.secondary.join(', ')}` : '');
      fieldRows.push(this._renderField(idx, 'livery', 'Livery', liveryText));
    }

    return `
      <div class="learned-proposal-card" data-race-number="${proposal.raceNumber}" data-participant-id="${proposal.participantId || ''}">
        <div class="learned-proposal-header">
          <span class="learned-proposal-number">${nameDisplay}</span>
          ${source}
        </div>
        <div class="learned-proposal-fields">
          ${fieldRows.join('')}
        </div>
      </div>
    `;
  }

  /**
   * Render a single field row with checkbox
   */
  _renderField(proposalIdx, fieldName, label, value) {
    const checkboxId = `learned-field-${proposalIdx}-${fieldName}`;
    return `
      <label class="learned-field-row" for="${checkboxId}">
        <input type="checkbox" class="learned-field-checkbox" id="${checkboxId}"
               data-proposal-idx="${proposalIdx}" data-field="${fieldName}" checked>
        <span class="learned-field-label">${label}</span>
        <span class="learned-field-value">${value}</span>
      </label>
    `;
  }

  /**
   * Collect accepted data from checked checkboxes
   */
  _collectAcceptedData(modal) {
    const proposals = Array.from(this.aggregatedData.values());
    const accepted = [];

    for (let idx = 0; idx < proposals.length; idx++) {
      const proposal = proposals[idx];
      const acceptedFields = {};

      for (const fieldName of Object.keys(proposal.fields)) {
        const checkbox = modal.querySelector(`#learned-field-${idx}-${fieldName}`);
        if (checkbox && checkbox.checked) {
          acceptedFields[fieldName] = proposal.fields[fieldName];
        }
      }

      if (Object.keys(acceptedFields).length > 0) {
        accepted.push({
          raceNumber: proposal.raceNumber,
          participantId: proposal.participantId,
          fields: acceptedFields,
          observationCount: proposal.observationCount,
          isAutoDetected: proposal.isAutoDetected || false,
        });
      }
    }

    return accepted;
  }
}

// Singleton instance
window.learnedDataModal = new LearnedDataModal();
