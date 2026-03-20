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
          perNumber.set(numStr, { sponsors: new Map(), teams: new Map(), makes: new Map(), models: new Map(), total: 0 });
        }

        const entry = perNumber.get(numStr);
        entry.total++;

        // Sponsors
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
      const existingSponsors = existingSponsor ? existingSponsor.split(',').map(s => s.trim().toLowerCase()) : [];
      const consistentSponsors = [];
      for (const [sponsor, count] of entry.sponsors) {
        if (count >= threshold && !existingSponsors.includes(sponsor.toLowerCase())) {
          consistentSponsors.push(sponsor);
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
   * @returns {Promise<boolean>} true if user accepted some data
   */
  async show(presetId, executionId) {
    if (!this.aggregatedData || this.aggregatedData.size === 0) {
      return false;
    }

    return new Promise((resolve) => {
      this._createModal(presetId, executionId, resolve);
    });
  }

  /**
   * Create and display the modal DOM
   */
  _createModal(presetId, executionId, resolvePromise) {
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

    // Event listeners
    const closeBtn = modal.querySelector('#learned-data-close');
    const skipBtn = modal.querySelector('#learned-data-skip');
    const acceptBtn = modal.querySelector('#learned-data-accept');

    const dismiss = () => {
      modal.remove();
      this.modalElement = null;
      resolvePromise(false);
    };

    closeBtn.addEventListener('click', dismiss);
    skipBtn.addEventListener('click', dismiss);
    modal.addEventListener('click', (e) => { if (e.target === modal) dismiss(); });

    acceptBtn.addEventListener('click', async () => {
      // Collect accepted fields
      const acceptedData = this._collectAcceptedData(modal);

      if (acceptedData.length === 0) {
        dismiss();
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

          // Clear aggregated data and mark execution as processed
          // so _checkLearnedDataAvailability() won't re-propose the same data
          this.aggregatedData = null;
          this.processedExecutions.add(executionId);

          setTimeout(() => {
            modal.remove();
            this.modalElement = null;
            resolvePromise(true);
          }, 1500);
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
