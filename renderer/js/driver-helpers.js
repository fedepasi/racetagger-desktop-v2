/**
 * Driver helpers — pure utilities for deriving driver data from preset
 * participants in the renderer.
 *
 * Designed as a dual-export module so the same file is consumed by:
 *   - the renderer (browser global `window.driverHelpers`, loaded via <script>)
 *   - Jest tests (CommonJS `require('.../driver-helpers')`)
 *
 * No external dependencies, no DOM access, no IPC. Keep it that way.
 *
 * Background — why this exists:
 *
 *   The canonical store for per-participant drivers is the
 *   `preset_participant_drivers` table (rows keyed by participant_id, sorted by
 *   driver_order). However, presets imported from PDF (via Gemini extraction)
 *   currently land all driver names in a single comma-separated string on the
 *   `nome` column of `preset_participants`, and rows in
 *   `preset_participant_drivers` are only created when the participant is
 *   opened and saved through the editor.
 *
 *   On a fresh PDF import (e.g. Lisa's Nürburgring 24h preset, 161 entries),
 *   only the participants the user has manually edited end up with driver
 *   records — for every other participant, the export reads zero drivers and
 *   silently drops drivers 2/3/4 from the JSON, even though the names are
 *   visible in the UI grid (which falls back to splitting `nome`).
 *
 *   `synthesizeDriversFromNome` is the export-time fallback that mirrors the
 *   UI's split logic, so an exported preset round-trips with all drivers
 *   intact regardless of whether the user has opened each participant.
 *
 * See PLAN_BULK_FOLDER_ASSIGN.md (PR1) for the full context.
 */
(function (global) {
  'use strict';

  /**
   * Synthesize driver records from a participant's `nome` string.
   *
   * Splitting policy: comma only. Other separators ("/", ";", " and ", etc.)
   * are NOT split — keeping the contract narrow avoids corrupting freeform
   * editorial values like "J. Smith / co-driver TBD". When a "/" is detected
   * we surface a console warning so data-quality issues are visible during
   * future cleanup work, but the value itself is preserved verbatim.
   *
   * @param {string} nome              Raw `nome` field from preset_participants.
   * @param {string} participantNumero Race number, copied onto each emitted
   *                                   driver record (mirrors the shape used
   *                                   by exportPresetJSON's allDrivers array).
   * @returns {Array<Object>} Driver records ready to be pushed into the
   *                          export's top-level `drivers[]` array.
   *                          Empty array for empty / non-string input.
   */
  function synthesizeDriversFromNome(nome, participantNumero) {
    if (typeof nome !== 'string') return [];
    const trimmed = nome.trim();
    if (!trimmed) return [];

    if (trimmed.indexOf('/') !== -1 && typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[driver-helpers] participant ' + participantNumero +
        ': nome contains "/" — kept as-is, only "," is treated as separator. Value: ' +
        JSON.stringify(trimmed)
      );
    }

    const names = trimmed
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    return names.map(function (name, idx) {
      return {
        id: _genId(),
        participant_numero: participantNumero,
        driver_name: name,
        driver_metatag: null,
        driver_nationality: '',
        driver_order: idx
      };
    });
  }

  function _genId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'tmp-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  }

  const api = {
    synthesizeDriversFromNome: synthesizeDriversFromNome
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.driverHelpers = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
