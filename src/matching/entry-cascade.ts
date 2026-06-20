/**
 * ACC-04: Entry-to-vehicle cascade helper.
 *
 * When a car's identity is resolved (auto match, temporal flip, manual
 * correction, or review accept), ALL fields must derive from the matched
 * preset entry — not from partial AI values or a previously-matched entry.
 *
 * This module exports a single pure function `cascadeEntryToVehicle` that
 * overwrites a vehicle object in-place. All callers (applyCorrectionsToAnalysis,
 * temporal flip, manual correction handler, review accept) use this one path
 * so the field list only needs to be maintained here.
 *
 * Design choices:
 * - NULL / absent entry fields clear the vehicle field to null (not keep stale).
 *   This kills "number+driver right, team wrong" for empty-squadra entries.
 * - The `livery` field is NOT cleared if the entry has no livery, because the
 *   AI-detected livery is useful visual metadata that the entry rarely has.
 * - If the entry field is absent AND the caller passes clearMissing=false,
 *   the vehicle field is left untouched (backward-compat for callers that
 *   want only partial overlay, e.g. the export builder).
 */

import { Participant, getParticipantDriverNames } from './smart-matcher';

export interface CascadeOptions {
  /**
   * When true (default), a field that is absent or empty on the entry will
   * clear the corresponding vehicle field to null/[].
   * When false, absent entry fields are skipped (vehicle value preserved).
   */
  clearMissing?: boolean;

  /** If set, stamp vehicle._cascadedFrom with this string for audit/debug. */
  source?: string;
}

/**
 * Overwrite vehicle fields from the resolved preset entry.
 *
 * Fields cascaded:
 *   raceNumber  ← entry.numero / entry.number
 *   teamName    ← entry.squadra / entry.team         (cleared to null if absent)
 *   drivers     ← getParticipantDriverNames(entry)   (cleared to [] if absent)
 *   category    ← entry.categoria / entry.category   (cleared to null if absent)
 *   make        ← entry.make                         (cleared to null if absent)
 *   model       ← entry.model                        (cleared to null if absent)
 *   sponsors    ← entry.sponsor / entry.sponsors     (cleared to [] if absent)
 *   plateNumber ← entry.plate_number                 (cleared to null if absent)
 *   livery      ← entry.livery                       (preserved if entry absent, see note above)
 *
 * The vehicle object is mutated in place and returned for chaining.
 */
export function cascadeEntryToVehicle(
  vehicle: Record<string, any>,
  entry: Participant | null | undefined,
  opts: CascadeOptions = {}
): Record<string, any> {
  const { clearMissing = true, source } = opts;

  if (!vehicle) return vehicle;
  if (!entry) return vehicle; // null entry = no-op; callers should only pass a resolved entry

  // ── Race number ─────────────────────────────────────────────────────────
  const entryNumber = entry.numero ?? entry.number;
  if (entryNumber != null) {
    const num = String(entryNumber);
    vehicle.raceNumber = num;
    // Keep finalResult in sync if present
    if (vehicle.finalResult) vehicle.finalResult.raceNumber = num;
  }

  // ── Team ────────────────────────────────────────────────────────────────
  const entryTeam = entry.squadra ?? entry.team ?? null;
  if (entryTeam) {
    vehicle.teamName = entryTeam;
    if (vehicle.finalResult) vehicle.finalResult.team = entryTeam;
  } else if (clearMissing) {
    vehicle.teamName = null;
    if (vehicle.finalResult) vehicle.finalResult.team = null;
  }

  // ── Drivers ─────────────────────────────────────────────────────────────
  const entryDrivers = getParticipantDriverNames(entry);
  if (entryDrivers.length > 0) {
    vehicle.drivers = entryDrivers;
    if (vehicle.finalResult) vehicle.finalResult.drivers = entryDrivers;
  } else if (clearMissing) {
    vehicle.drivers = [];
    if (vehicle.finalResult) vehicle.finalResult.drivers = [];
  }

  // ── Category ────────────────────────────────────────────────────────────
  const entryCategory = entry.categoria ?? entry.category ?? null;
  if (entryCategory) {
    vehicle.category = entryCategory;
    if (vehicle.finalResult) vehicle.finalResult.category = entryCategory;
  } else if (clearMissing) {
    vehicle.category = null;
    if (vehicle.finalResult) vehicle.finalResult.category = null;
  }

  // ── Make / Model ─────────────────────────────────────────────────────────
  const entryMake = entry.make ?? null;
  if (entryMake) {
    vehicle.make = entryMake;
    if (vehicle.finalResult) vehicle.finalResult.make = entryMake;
  } else if (clearMissing) {
    vehicle.make = null;
    if (vehicle.finalResult) vehicle.finalResult.make = null;
  }

  const entryModel = entry.model ?? null;
  if (entryModel) {
    vehicle.model = entryModel;
    if (vehicle.finalResult) vehicle.finalResult.model = entryModel;
  } else if (clearMissing) {
    vehicle.model = null;
    if (vehicle.finalResult) vehicle.finalResult.model = null;
  }

  // ── Sponsors ─────────────────────────────────────────────────────────────
  const rawSponsors = entry.sponsors?.length
    ? entry.sponsors
    : Array.isArray(entry.sponsor)
      ? entry.sponsor
      : typeof entry.sponsor === 'string' && entry.sponsor
        ? entry.sponsor.split(',').map((s: string) => s.trim()).filter(Boolean)
        : null;

  if (rawSponsors && rawSponsors.length > 0) {
    vehicle.sponsors = rawSponsors;
    if (vehicle.finalResult) vehicle.finalResult.sponsors = rawSponsors;
  } else if (clearMissing) {
    vehicle.sponsors = [];
    if (vehicle.finalResult) vehicle.finalResult.sponsors = [];
  }

  // ── Plate number ──────────────────────────────────────────────────────────
  const entryPlate = entry.plate_number ?? null;
  if (entryPlate) {
    vehicle.plateNumber = entryPlate;
    if (vehicle.finalResult) vehicle.finalResult.plateNumber = entryPlate;
  } else if (clearMissing) {
    vehicle.plateNumber = null;
    if (vehicle.finalResult) vehicle.finalResult.plateNumber = null;
  }

  // ── Livery: PRESERVED if entry has none (AI livery is useful metadata) ────
  const entryLivery = entry.livery ?? null;
  if (entryLivery) {
    vehicle.livery = entryLivery;
    if (vehicle.finalResult) vehicle.finalResult.livery = entryLivery;
  }
  // (no clearMissing branch for livery — intentional per design doc)

  // ── Metatag ───────────────────────────────────────────────────────────────
  if (entry.metatag) {
    vehicle.metatag = entry.metatag;
    if (vehicle.finalResult) vehicle.finalResult.metatag = entry.metatag;
  } else if (clearMissing) {
    vehicle.metatag = null;
    if (vehicle.finalResult) vehicle.finalResult.metatag = null;
  }

  // ── Provenance stamp ──────────────────────────────────────────────────────
  if (source) {
    vehicle._cascadedFrom = source;
  }

  return vehicle;
}
