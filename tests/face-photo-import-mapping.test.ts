/**
 * Tests for the pure import-mapping helper (face-photo-export-helpers.js).
 * Dual-export module — require() it directly, no DOM/IPC needed.
 */
import { describe, it, expect } from '@jest/globals';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveFacePhotoTargets } = require('../renderer/js/face-photo-export-helpers');

const participants = [
  { id: 'p-uuid-1', numero: '11' },
  { id: 'p-uuid-2', numero: '7' },
];
const driversByNewId: Record<string, Array<{ id: string; driver_order: number; driver_name: string }>> = {
  'p-uuid-1': [
    { id: 'd-uuid-a', driver_order: 0, driver_name: 'Rossi' },
    { id: 'd-uuid-b', driver_order: 1, driver_name: 'Bianchi' },
  ],
};

function photo(extra: Record<string, unknown>) {
  return {
    participant_numero: '11', driver_order: null, driver_name: null,
    image_base64: 'AAAA', ext: '.jpg', mime: 'image/jpg',
    photo_type: 'reference', is_primary: false, detection_confidence: 0.9,
    ...extra,
  };
}

describe('resolveFacePhotoTargets', () => {
  it('maps a participant-level photo to the participant id', () => {
    const { resolved, skipped } = resolveFacePhotoTargets([photo({})], participants, driversByNewId);
    expect(skipped).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].participantId).toBe('p-uuid-1');
    expect(resolved[0].driverId).toBeNull();
  });

  it('maps a driver-level photo by driver_order to the driver id', () => {
    const { resolved } = resolveFacePhotoTargets(
      [photo({ driver_order: 1, driver_name: 'Bianchi' })], participants, driversByNewId,
    );
    expect(resolved[0].driverId).toBe('d-uuid-b');
    expect(resolved[0].participantId).toBeNull();
  });

  it('matches numero regardless of string/number type', () => {
    const { resolved } = resolveFacePhotoTargets(
      [photo({ participant_numero: 7 })], participants, driversByNewId,
    );
    expect(resolved[0].participantId).toBe('p-uuid-2');
  });

  it('skips a photo whose participant_numero is absent', () => {
    const { resolved, skipped } = resolveFacePhotoTargets(
      [photo({ participant_numero: '999' })], participants, driversByNewId,
    );
    expect(resolved).toEqual([]);
    expect(skipped[0].reason).toBe('participant_not_found');
  });

  it('skips a driver photo whose driver_order has no match', () => {
    const { resolved, skipped } = resolveFacePhotoTargets(
      [photo({ driver_order: 5, driver_name: 'Ghost' })], participants, driversByNewId,
    );
    expect(resolved).toEqual([]);
    expect(skipped[0].reason).toBe('driver_not_found');
  });

  it('handles empty / missing input arrays', () => {
    expect(resolveFacePhotoTargets([], participants, driversByNewId)).toEqual({ resolved: [], skipped: [] });
    expect(resolveFacePhotoTargets(undefined, participants, driversByNewId)).toEqual({ resolved: [], skipped: [] });
  });
});
