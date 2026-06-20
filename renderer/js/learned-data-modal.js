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
    if (!this.aggregatedData || this.aggregatedData.size === 0) {
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

    const proposals = Array.from(this.aggregatedData.values());
    const totalFields = proposals.reduce((sum, p) => sum + Object.keys(p.fields).length, 0);

    const modal = document.createElement('div');
    modal.id = 'learned-data-modal';
    modal.className = 'learned-data-overlay';
    modal.innerHTML = `
      <div class="learned-data-container">
        <div class="learned-data-header">
          <div class="learned-data-icon">&#10024;</div>
          <div class="learned-data-title">
            <h3>Useful Data Found</h3>
            <p>Found <strong>${totalFields} data point${totalFields === 1 ? '' : 's'}</strong> for <strong>${proposals.length} participant${proposals.length === 1 ? '' : 's'}</strong> that can improve future recognition accuracy.</p>
          </div>
          <button class="learned-data-close" id="learned-data-close">&times;</button>
        </div>

        <div class="learned-data-body">
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
        fieldTypes: Array.from(__proposedFieldTypes)
      });
    }

    // Event listeners
    const closeBtn = modal.querySelector('#learned-data-close');
    const skipBtn = modal.querySelector('#learned-data-skip');
    const acceptBtn = modal.querySelector('#learned-data-accept');

    const dismiss = (via) => {
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
      // Collect accepted fields
      const acceptedData = this._collectAcceptedData(modal);

      if (acceptedData.length === 0) {
        dismiss('accept-but-empty');
        return;
      }

      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Saving...';

      try {
        const result = await window.api.invoke('save-learned-participant-data', {
          presetId,
          executionId,
          participants: acceptedData,
        });

        if (result.success) {
          // Show brief success feedback
          const count = result.data?.updated || acceptedData.length;
          acceptBtn.textContent = `✅ ${count} participant${count === 1 ? '' : 's'} updated`;
          acceptBtn.classList.add('learned-data-btn-success');

          // Telemetry: LEARNED_DATA_SAVED. This is the heartbeat of the
          // SmartMatcher "learn from corrections" loop — what % of users
          // who SEE the proposal actually accept it.
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

          // Clear aggregated data and mark execution as processed
          // so _checkLearnedDataAvailability() won't re-propose the same data
          this.aggregatedData = null;
          this.processedExecutions.add(executionId);

          // ACC-04 Phase 4: if series-sponsor candidates detected, show confirmation step
          const seriesCandidates = result.data?.seriesCandidates || [];
          const newCandidates = seriesCandidates.filter(c => {
            const key = c.key || c.display?.toLowerCase().replace(/\s+/g, ' ').trim() || '';
            return !existingSeriesIgnore.includes(key);
          });

          if (newCandidates.length > 0) {
            setTimeout(() => {
              this._showSeriesSponsorSection(modal, presetId, newCandidates, resolvePromise, existingSeriesIgnore);
            }, 800);
          } else {
            setTimeout(() => {
              modal.remove();
              this.modalElement = null;
              resolvePromise(true);
            }, 1500);
          }
        } else {
          console.error('[LearnedDataModal] Save failed:', result.error);
          acceptBtn.textContent = '❌ Save failed';
          acceptBtn.disabled = false;
          setTimeout(() => {
            acceptBtn.textContent = 'Update Preset';
          }, 2000);
        }
      } catch (error) {
        console.error('[LearnedDataModal] Error:', error);
        acceptBtn.textContent = '❌ Error';
        acceptBtn.disabled = false;
      }
    });
  }

  /**
   * ACC-04 Phase 4 — second step shown after the preset save succeeds.
   * Replaces the modal body with a checklist of series-level sponsor candidates,
   * pre-checked when coverage ≥ 70%. User can "Add to Ignore List" or "Skip".
   *
   * @param {HTMLElement} modal - The existing modal element (still visible)
   * @param {string} presetId
   * @param {Array} candidates - SeriesSponsorCandidate[] filtered to only new ones
   * @param {Function} resolvePromise
   * @param {string[]} existingSeriesIgnore - already-stored ignore keys
   */
  _showSeriesSponsorSection(modal, presetId, candidates, resolvePromise, existingSeriesIgnore) {
    const body = modal.querySelector('.learned-data-body') || modal;

    const rows = candidates.map((c, i) => {
      const pct = Math.round((c.coverageFraction || 0) * 100);
      const preChecked = pct >= 70 ? 'checked' : '';
      const coverageLabel = pct >= 70
        ? `<span style="color:#10b981;font-size:11px">${pct}% of cars — likely series-wide</span>`
        : `<span style="color:#f59e0b;font-size:11px">${pct}% of cars — possible series sponsor</span>`;
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--rt-border,#2a3551);cursor:pointer">
          <input type="checkbox" data-series-idx="${i}" ${preChecked}
            style="width:16px;height:16px;flex-shrink:0;accent-color:#1a9ee0">
          <span style="flex:1;min-width:0">
            <span style="font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px">${c.display}</span>
            <br>${coverageLabel}
          </span>
        </label>`;
    }).join('');

    body.innerHTML = `
      <div style="padding:4px 0 12px">
        <div style="font-size:13px;font-weight:600;color:var(--rt-text,#f1f4fa);margin-bottom:4px">Series-level sponsors detected</div>
        <div style="font-size:12px;color:var(--rt-text-dim,#9aa5bd);margin-bottom:16px">
          These sponsors appear on most cars in this event — they may be series or venue sponsors
          rather than participant-specific. Add them to the ignore list so future events stay clean.
        </div>
        <div id="series-sponsor-rows">${rows}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--rt-border,#2a3551)">
        <button id="series-sponsor-skip"
          style="padding:8px 16px;border-radius:8px;border:1px solid var(--rt-border-strong,#3a4666);
                 background:var(--rt-panel,#1a2236);color:var(--rt-text,#f1f4fa);font-size:13px;cursor:pointer">
          Skip
        </button>
        <button id="series-sponsor-add"
          style="padding:8px 16px;border-radius:8px;border:none;
                 background:#1a9ee0;color:#fff;font-size:13px;font-weight:600;cursor:pointer">
          Add to Ignore List
        </button>
      </div>`;

    const skipBtn = body.querySelector('#series-sponsor-skip');
    const addBtn = body.querySelector('#series-sponsor-add');

    skipBtn.addEventListener('click', () => {
      modal.remove();
      this.modalElement = null;
      resolvePromise(true);
    });

    addBtn.addEventListener('click', async () => {
      const checked = Array.from(body.querySelectorAll('input[data-series-idx]:checked'));
      const newKeys = checked.map(cb => {
        const idx = parseInt(cb.dataset.seriesIdx, 10);
        const c = candidates[idx];
        return c.key || c.display?.toLowerCase().replace(/\s+/g, ' ').trim() || '';
      }).filter(Boolean);

      if (newKeys.length === 0) {
        modal.remove();
        this.modalElement = null;
        resolvePromise(true);
        return;
      }

      addBtn.disabled = true;
      addBtn.textContent = 'Saving…';

      try {
        const merged = Array.from(new Set([...existingSeriesIgnore, ...newKeys]));
        const updateResult = await window.api.invoke('supabase-update-participant-preset', {
          id: presetId,
          series_sponsor_ignore: merged,
        });

        if (updateResult.success) {
          addBtn.textContent = `✅ ${newKeys.length} added`;
          setTimeout(() => {
            modal.remove();
            this.modalElement = null;
            resolvePromise(true);
          }, 1000);
        } else {
          console.error('[LearnedDataModal] series_sponsor_ignore update failed:', updateResult.error);
          addBtn.textContent = '❌ Save failed';
          addBtn.disabled = false;
        }
      } catch (err) {
        console.error('[LearnedDataModal] Error updating series_sponsor_ignore:', err);
        addBtn.textContent = '❌ Error';
        addBtn.disabled = false;
      }
    });
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
