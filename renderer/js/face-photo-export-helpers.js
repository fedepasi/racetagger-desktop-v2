/**
 * Pure helpers for preset face-photo export/import (JSON v3.0).
 *
 * Dual-export: CommonJS for Jest, browser global `window.facePhotoHelpers`
 * for the renderer (loaded via <script> in index.html). No DOM, no IPC, no
 * network — keep it pure so it stays unit-testable.
 */
(function () {
  /**
   * Map exported face_photos[] entries onto freshly-created participant /
   * driver IDs. Participant photos carry driver_order === null and map by
   * participant_numero; driver photos map by (participant_numero, driver_order).
   *
   * @returns {{ resolved: Array<{photo, participantId: (string|null), driverId: (string|null)}>,
   *             skipped: Array<{photo, reason: string}> }}
   */
  function resolveFacePhotoTargets(facePhotos, savedParticipants, driversByNewId) {
    const byNumero = {};
    (savedParticipants || []).forEach(function (p) {
      byNumero[String(p.numero)] = p;
    });

    const resolved = [];
    const skipped = [];

    (facePhotos || []).forEach(function (fp) {
      const participant = byNumero[String(fp.participant_numero)];
      if (!participant) {
        skipped.push({ photo: fp, reason: 'participant_not_found' });
        return;
      }
      if (fp.driver_order === null || fp.driver_order === undefined) {
        resolved.push({ photo: fp, participantId: participant.id, driverId: null });
        return;
      }
      const drivers = driversByNewId[participant.id] || [];
      const driver = drivers.find(function (d) { return d.driver_order === fp.driver_order; });
      if (!driver) {
        skipped.push({ photo: fp, reason: 'driver_not_found' });
        return;
      }
      resolved.push({ photo: fp, participantId: null, driverId: driver.id });
    });

    return { resolved: resolved, skipped: skipped };
  }

  const api = { resolveFacePhotoTargets: resolveFacePhotoTargets };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.facePhotoHelpers = api;
  }
})();
