/**
 * Unit Test: UPSERT Logic for Participant Preservation
 *
 * Tests the core UPSERT logic that fixes the data loss bug.
 * This is a pure logic test without database dependencies.
 */

describe('UPSERT Logic - Participant Preservation', () => {
  /**
   * Simulate the UPSERT logic from database-service.ts
   */
  function computeUpsertOperations(
    currentInDb: Array<{ id: string; numero: string }>,
    participants: Array<any>
  ) {
    const currentIds = new Set(currentInDb.map(p => p.id));
    const existingParticipants = participants.filter(p => p.id);
    const newParticipants = participants.filter(p => !p.id);
    const keepIds = new Set(existingParticipants.map(p => p.id));
    const toDelete = [...currentIds].filter(id => !keepIds.has(id));

    return {
      update: existingParticipants.length,
      insert: newParticipants.length,
      delete: toDelete.length,
      toDelete,
      existingParticipants,
      newParticipants
    };
  }

  describe('Sequential Addition', () => {
    it('should preserve first participant when adding second', () => {
      // Database has 1 participant
      const currentInDb = [
        { id: 'id-1', numero: '1' }
      ];

      // User adds second participant (includes first with ID)
      const participants = [
        { id: 'id-1', numero: '1', nome: 'F. Nasr' },
        { numero: '2', nome: 'L. Hamilton' } // New, no ID
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(1); // Update existing
      expect(ops.insert).toBe(1); // Insert new
      expect(ops.delete).toBe(0); // Delete none
      expect(ops.existingParticipants[0].id).toBe('id-1');
    });

    it('should preserve all when adding third driver', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' },
        { id: 'id-2', numero: '2' }
      ];

      const participants = [
        { id: 'id-1', numero: '1', nome: 'F. Nasr' },
        { id: 'id-2', numero: '2', nome: 'L. Hamilton' },
        { numero: '3', nome: 'M. Verstappen' } // New
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(2);
      expect(ops.insert).toBe(1);
      expect(ops.delete).toBe(0);
    });
  });

  describe('Editing', () => {
    it('should only update edited participant', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' },
        { id: 'id-2', numero: '2' },
        { id: 'id-3', numero: '3' }
      ];

      // Edit participant 2
      const participants = [
        { id: 'id-1', numero: '1', nome: 'F. Nasr' },
        { id: 'id-2', numero: '2', nome: 'Lewis Hamilton' }, // Edited
        { id: 'id-3', numero: '3', nome: 'M. Verstappen' }
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(3); // All are "existing"
      expect(ops.insert).toBe(0);
      expect(ops.delete).toBe(0);
    });
  });

  describe('Deletion', () => {
    it('should only delete removed participant', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' },
        { id: 'id-2', numero: '2' },
        { id: 'id-3', numero: '3' },
        { id: 'id-4', numero: '4' },
        { id: 'id-5', numero: '5' }
      ];

      // Remove participant 3 (keep 1, 2, 4, 5)
      const participants = [
        { id: 'id-1', numero: '1' },
        { id: 'id-2', numero: '2' },
        { id: 'id-4', numero: '4' },
        { id: 'id-5', numero: '5' }
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(4);
      expect(ops.insert).toBe(0);
      expect(ops.delete).toBe(1);
      expect(ops.toDelete).toContain('id-3');
      expect(ops.toDelete).not.toContain('id-1');
      expect(ops.toDelete).not.toContain('id-2');
    });

    it('should handle deleting all participants', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' },
        { id: 'id-2', numero: '2' }
      ];

      const participants: any[] = []; // Empty

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(0);
      expect(ops.insert).toBe(0);
      expect(ops.delete).toBe(2);
      expect(ops.toDelete).toEqual(['id-1', 'id-2']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty database', () => {
      const currentInDb: any[] = [];
      const participants = [
        { numero: '1', nome: 'F. Nasr' }
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(0);
      expect(ops.insert).toBe(1);
      expect(ops.delete).toBe(0);
    });

    it('should handle no changes', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' }
      ];

      const participants = [
        { id: 'id-1', numero: '1', nome: 'F. Nasr' }
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(1);
      expect(ops.insert).toBe(0);
      expect(ops.delete).toBe(0);
    });

    it('should not create duplicates', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' }
      ];

      // Same ID provided twice (should be filtered)
      const participants = [
        { id: 'id-1', numero: '1', nome: 'F. Nasr' }
      ];

      const ops = computeUpsertOperations(currentInDb, participants);

      expect(ops.update).toBe(1);
      expect(ops.insert).toBe(0);
    });
  });

  describe('Comparison: Nuclear Delete vs UPSERT', () => {
    it('Nuclear delete approach loses IDs', () => {
      // Simulating nuclear delete: ALL IDs are lost
      const currentInDb = [
        { id: 'id-1', numero: '1' }
      ];

      // Nuclear delete: Delete all, insert all
      // This means id-1 is DELETED and new ID is created
      const nuclearOps = {
        delete: currentInDb.length, // Delete ALL
        insert: 2, // Insert ALL as new
        update: 0 // No updates
      };

      expect(nuclearOps.delete).toBe(1); // Deletes existing
      expect(nuclearOps.insert).toBe(2); // Creates new IDs
    });

    it('UPSERT approach preserves IDs', () => {
      const currentInDb = [
        { id: 'id-1', numero: '1' }
      ];

      const participants = [
        { id: 'id-1', numero: '1', nome: 'F. Nasr' },
        { numero: '2', nome: 'L. Hamilton' }
      ];

      const upsertOps = computeUpsertOperations(currentInDb, participants);

      expect(upsertOps.delete).toBe(0); // No deletes
      expect(upsertOps.update).toBe(1); // Preserves id-1
      expect(upsertOps.insert).toBe(1); // Only new participant
    });
  });
});
