# Driver Data and Photo Preservation Fix - Implementation Summary

## Problem Fixed

When editing a participant preset and adding multiple drivers with photos, the system was losing all previously saved driver data. Specifically:

1. **First driver (F. Nasr)** saved correctly with photo
2. **Adding second/third drivers** caused **ALL previous data to be lost**
3. **Root cause**: The save function was using a "nuclear delete" approach - deleting all existing participants before inserting new ones, which:
   - Orphaned driver records (preset_participant_drivers)
   - Orphaned face photos (preset_participant_face_photos)
   - Lost previously saved data
   - Created new IDs even for existing participants

## Solution Implemented

### Phase 1: Database Save Logic (UPSERT) ✅

**File**: `src/database-service.ts` (lines 2894-3000)

**Changes**:
- ❌ Removed: Unconditional `DELETE` of all participants (lines 2926-2937)
- ✅ Added: Intelligent UPSERT logic that:
  - **UPDATEs** existing participants (preserves IDs and associated data)
  - **INSERTs** only new participants
  - **DELETEs** only removed participants (surgical delete)

**Key Code**:
```typescript
// Separate participants into existing (have IDs) vs new (no IDs)
const existingParticipants = participants.filter(p => (p as any).id);
const newParticipants = participants.filter(p => !(p as any).id);
const keepIds = new Set(existingParticipants.map(p => (p as any).id));

// Find participants to delete (in DB but not in current list)
const toDelete = [...currentIds].filter(id => !keepIds.has(id));

// 1. UPDATE existing participants (preserves IDs)
for (const participant of existingParticipants) {
  // ... UPDATE logic
}

// 2. INSERT new participants
if (newParticipants.length > 0) {
  // ... INSERT logic
}

// 3. DELETE removed participants (surgical delete)
if (toDelete.length > 0) {
  // ... DELETE logic
}
```

**Benefits**:
- Preserves existing participant IDs → Preserves driver relationships
- Preserves driver records → Preserves face photos
- Surgical deletes → Only removes what's actually removed
- Better logging for debugging

### Phase 2: Driver Sync Timing ✅

**File**: `renderer/js/driver-face-manager.js` (lines 14-180)

**Changes**:
- ✅ Added: `isSyncing` flag to track sync state
- ✅ Added: `waitForSync()` method to wait for driver sync completion
- ✅ Enhanced: Logging in `syncDrivers()` with start/complete markers

**Key Code**:
```javascript
async syncDrivers(driverNames) {
  this.isSyncing = true;
  console.log('[DriverFaceManagerMulti] 🔄 Sync started');

  try {
    // ... sync logic ...
  } finally {
    this.isSyncing = false;
    console.log('[DriverFaceManagerMulti] 🏁 Sync complete');
  }
}

async waitForSync() {
  console.log('[DriverFaceManagerMulti] ⏳ Waiting for sync to complete...');
  let waited = 0;
  const maxWait = 5000; // 5 seconds max

  while (this.isSyncing && waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 100));
    waited += 100;
  }
}
```

**File**: `renderer/js/participants-manager.js` (lines 1087-1101)

**Changes**:
- ✅ Added: Explicit wait for driver sync to complete before allowing photo upload

**Key Code**:
```javascript
// Load the driver face managers (this triggers syncDrivers internally)
await driverFaceManagerMulti.load(savedParticipant.id, currentPreset.id, currentUserId, isOfficial, driverNames);

// ⚠️ CRITICAL FIX: Wait for driver sync to complete
if (driverFaceManagerMulti.isSyncing) {
  console.log('[Participants] ⏳ Driver sync in progress, waiting...');
  await driverFaceManagerMulti.waitForSync();
  console.log('[Participants] ✅ Driver sync complete, IDs ready for photo upload');
}
```

**Benefits**:
- Ensures driver IDs are set before photo upload starts
- Prevents race conditions between sync and photo upload
- Clear logging for debugging timing issues

### Phase 3: Photo Upload Timing ✅

**File**: `renderer/js/preset-face-manager.js` (lines 208-340)

**Changes**:
- ❌ Removed: Arbitrary 500ms timeout (line 239)
- ✅ Added: Proper ID validation with retry logic (up to 2 seconds)
- ✅ Added: Final validation before upload

**Key Code**:
```javascript
// ⚠️ CRITICAL FIX: Replace arbitrary 500ms timeout with proper ID validation
let retries = 0;
const maxRetries = 20; // 2 seconds total
let idsReady = false;

while (retries < maxRetries) {
  if (this.isDriverContext()) {
    // For driver context, retrieve ID from parent manager
    if (window.driverFaceManagerMulti) {
      const parentDriver = window.driverFaceManagerMulti.drivers.find(
        d => d.faceManager === this
      );
      if (parentDriver?.id) {
        this.currentDriverId = parentDriver.id;
        idsReady = true;
        break;
      }
    }
  } else {
    // For participant context, just need participant and preset IDs
    if (this.currentParticipantId && this.currentPresetId) {
      idsReady = true;
      break;
    }
  }

  await new Promise(resolve => setTimeout(resolve, 100));
  retries++;
}

// ⚠️ FINAL VALIDATION: Double-check driver ID exists for driver context
if (this.isDriverContext() && !this.currentDriverId) {
  console.error('[PresetFaceManager] ❌ Final validation failed: Driver ID is null');
  this.showNotification('Driver not ready. Please save the participant first.', 'error');
  return;
}
```

**Benefits**:
- No more arbitrary timeouts
- Polls for IDs with proper error handling
- Fails gracefully if IDs aren't ready after 2 seconds
- Double validation before upload

### Phase 4: Cache Invalidation ✅

**File**: `src/database-service.ts` (lines 2960-2985)

**Changes**:
- ✅ Enhanced: Cache invalidation to force complete reload with driver data
- ✅ Added: Explicit reload after save with complete driver data

**Key Code**:
```typescript
// Invalidate cache to force reload with complete driver data
const cacheIndex = presetsCache.findIndex(p => p.id === presetId);
if (cacheIndex !== -1) {
  presetsCache.splice(cacheIndex, 1);
}
cacheLastUpdated = 0;

// ⚠️ NEW: Reload preset with complete driver data
const { data: reloadedPreset, error: reloadError } = await supabase
  .from('participant_presets')
  .select(`
    *,
    participants:preset_participants(
      *,
      drivers:preset_participant_drivers(*)
    )
  `)
  .eq('id', presetId)
  .single();

if (reloadedPreset?.participants) {
  return reloadedPreset.participants; // Return complete data
}
```

**Benefits**:
- Ensures UI has complete driver data after save
- No stale cache issues
- Consistent data across all UI components

## Testing

### Unit Tests ✅

**File**: `tests/upsert-logic.test.ts`

**Coverage**:
- ✅ Sequential driver addition (preserves first when adding second/third)
- ✅ Editing existing participants (preserves others)
- ✅ Removing participants (surgical delete)
- ✅ Edge cases (empty database, no changes, duplicates)
- ✅ Nuclear delete vs UPSERT comparison

**Results**: All 10 tests passing ✅

```bash
PASS tests/upsert-logic.test.ts
  UPSERT Logic - Participant Preservation
    Sequential Addition
      ✓ should preserve first participant when adding second
      ✓ should preserve all when adding third driver
    Editing
      ✓ should only update edited participant
    Deletion
      ✓ should only delete removed participant
      ✓ should handle deleting all participants
    Edge Cases
      ✓ should handle empty database
      ✓ should handle no changes
      ✓ should not create duplicates
    Comparison: Nuclear Delete vs UPSERT
      ✓ Nuclear delete approach loses IDs
      ✓ UPSERT approach preserves IDs

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

### Manual Testing Checklist

- [ ] Test Case 1: Add first driver (F. Nasr) with photo
- [ ] Verify photo appears and persists after save
- [ ] Test Case 2: Add second driver (L. Hamilton) with photo
- [ ] Verify first driver still exists with photo
- [ ] Verify second driver photo appears
- [ ] Test Case 3: Add third driver with photo
- [ ] Verify all three drivers exist with photos
- [ ] Test Case 4: Edit participant, change driver name
- [ ] Verify other drivers unaffected
- [ ] Test Case 5: Remove one driver
- [ ] Verify other drivers still exist
- [ ] Test Case 6: Check database directly
  ```sql
  SELECT p.numero, p.id, d.driver_name, d.id as driver_id, f.url
  FROM preset_participants p
  LEFT JOIN preset_participant_drivers d ON d.participant_id = p.id
  LEFT JOIN preset_participant_face_photos f ON f.driver_id = d.id
  WHERE p.preset_id = 'YOUR_PRESET_ID'
  ORDER BY p.numero, d.driver_order;
  ```
- [ ] Verify no photos in `userId/presetId/null/` folder (orphaned photos)
- [ ] Verify photos exist at correct driver paths

## Files Modified

1. ✅ `src/database-service.ts` - UPSERT logic, cache invalidation
2. ✅ `renderer/js/driver-face-manager.js` - Sync state tracking, wait method
3. ✅ `renderer/js/participants-manager.js` - Wait for sync before photo upload
4. ✅ `renderer/js/preset-face-manager.js` - Proper ID validation, retry logic
5. ✅ `tests/__mocks__/fs.ts` - Fixed mock to work with Jest
6. ✅ `tests/upsert-logic.test.ts` - Comprehensive unit tests (NEW)

## Success Criteria

- [x] ✅ TypeScript compiles without errors
- [x] ✅ Unit tests pass (10/10)
- [ ] Adding multiple drivers preserves previous driver data
- [ ] Photos upload correctly to all drivers
- [ ] No orphaned photos in database
- [ ] No orphaned photos in storage
- [ ] Edit operation doesn't delete existing participants
- [ ] Cache shows correct data after save
- [ ] Reload page shows all drivers and photos

## Risk Assessment

**Risk Level**: Medium (core data persistence logic)

**Mitigation**:
- Thorough unit testing with 10 test cases ✅
- Clear logging at each step for debugging
- Graceful error handling
- Backward compatible (existing data unaffected)

**Reversibility**: High
- Old logic preserved in comments if needed
- No database migration required
- Can revert by restoring old delete+insert code

## Performance Impact

**Positive**:
- Fewer database operations (update instead of delete+insert)
- Better memory efficiency (no full table scans)
- Reduced network traffic

**Neutral**:
- Slight increase in code complexity
- Additional logging overhead (minimal)

## Next Steps

1. **Deploy to development environment** for manual testing
2. **Perform manual test checklist** with real preset data
3. **Monitor logs** for any unexpected behavior
4. **Verify database consistency** after multiple save operations
5. **Test edge cases** (concurrent edits, network failures)
6. **Roll out to production** after successful testing

## Rollback Plan

If issues occur:

1. **Revert database-service.ts** to old delete+insert logic:
   ```typescript
   // Uncomment old code (preserved in comments)
   // Re-enable nuclear delete
   ```

2. **Revert other files** via git:
   ```bash
   git checkout HEAD~1 -- renderer/js/driver-face-manager.js
   git checkout HEAD~1 -- renderer/js/participants-manager.js
   git checkout HEAD~1 -- renderer/js/preset-face-manager.js
   ```

3. **No database migration needed** (changes are backward compatible)

## Conclusion

The fix replaces the "nuclear delete" approach with intelligent UPSERT logic that:
- ✅ **Preserves existing participant IDs** (UPDATE instead of DELETE+INSERT)
- ✅ **Only deletes removed participants** (surgical delete)
- ✅ **Ensures driver sync completes** before photo upload
- ✅ **Validates IDs exist** with retry logic before proceeding
- ✅ **Adds proper error handling** and comprehensive logging

This prevents data loss when saving multiple drivers and ensures photos stay attached to the correct drivers throughout the edit-save-upload workflow.

---

**Implementation Date**: 2026-01-29
**Implemented By**: Claude Code (AI Assistant)
**Status**: ✅ Code changes complete, awaiting manual testing
