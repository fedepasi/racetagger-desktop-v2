import {
  isEdgeFunctionRetryable,
  isUploadRetryable,
  isDeferredUploadRetryCandidate,
} from '../src/utils/upload-retry-classifier';

/**
 * Regression coverage for the upload/edge retry classifiers.
 *
 * Focus: Supabase/Postgres connection-pool exhaustion (issues #142, #143, #144 —
 * Gruppe C / Nürburgring 24h batch, v1.1.9). Before the fix the pooler-exhaustion
 * message was NOT matched by any branch, so uploads failed immediately (no retry)
 * and produced ghost images (local:// URLs) + 0 results.
 */
describe('isEdgeFunctionRetryable — connection-pool exhaustion', () => {
  // The exact runtime message from issue #142 (uploadToStorage, line 4230).
  const ISSUE_142_MESSAGE =
    'The database has reached its maximum number of connections. Please try again later.';

  it('treats the issue-142 message as retryable', () => {
    expect(isEdgeFunctionRetryable(ISSUE_142_MESSAGE)).toBe(true);
  });

  it('matches case-insensitively (upper/mixed case)', () => {
    expect(isEdgeFunctionRetryable(ISSUE_142_MESSAGE.toUpperCase())).toBe(true);
    expect(
      isEdgeFunctionRetryable('THE DATABASE HAS REACHED ITS MAXIMUM NUMBER OF CONNECTIONS.')
    ).toBe(true);
  });

  it('matches the other transient pooler-capacity messages', () => {
    const transient = [
      'remaining connection slots are reserved for non-replication superuser connections',
      'FATAL: sorry, too many clients already',
      'too many connections for role "anon"',
      'max client connections reached',
    ];
    for (const msg of transient) {
      expect(isEdgeFunctionRetryable(msg)).toBe(true);
    }
  });

  it('flows through isUploadRetryable as well (upload path)', () => {
    expect(isUploadRetryable(ISSUE_142_MESSAGE)).toBe(true);
  });

  it('stays conservative — non-transient errors are still NOT retryable', () => {
    // No pooler-capacity token present; these must not be falsely retried.
    expect(isEdgeFunctionRetryable('Invalid API key')).toBe(false);
    expect(isEdgeFunctionRetryable('new row violates row-level security policy')).toBe(false);
    expect(isEdgeFunctionRetryable('duplicate key value violates unique constraint')).toBe(false);
    expect(isEdgeFunctionRetryable('successfully established connection to the database')).toBe(false);
  });
});

describe('isEdgeFunctionRetryable — existing behavior preserved', () => {
  it('still retries network + capacity errors', () => {
    expect(isEdgeFunctionRetryable('fetch failed')).toBe(true);
    expect(isEdgeFunctionRetryable('HTTP 429: Resource Exhausted')).toBe(true);
    expect(isEdgeFunctionRetryable('503 Service Unavailable')).toBe(true);
    expect(isEdgeFunctionRetryable('socket hang up')).toBe(true);
  });

  it('isUploadRetryable still catches HTML-gateway JSON parse errors', () => {
    expect(isUploadRetryable("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")).toBe(true);
    expect(isUploadRetryable('502 Bad Gateway')).toBe(true);
  });
});

describe('isDeferredUploadRetryCandidate — end-of-batch drain selection', () => {
  // Exact shape of the Gruppe C hard failure (processImage outer catch return).
  const ISSUE_142_RESULT = {
    success: false,
    error:
      'Upload failed for 24hNbr26_051313070600263GH.jpg: The database has reached its ' +
      'maximum number of connections. Please try again later.',
  };

  it('selects a hard, transient upload failure (the issue-142 signature)', () => {
    expect(isDeferredUploadRetryCandidate(ISSUE_142_RESULT)).toBe(true);
  });

  it('selects other transient upload-stage failures', () => {
    expect(isDeferredUploadRetryCandidate({ success: false, error: 'Upload failed for x.jpg: fetch failed' })).toBe(true);
    expect(isDeferredUploadRetryCandidate({ success: false, error: 'Upload failed for x.jpg: 503 Service Unavailable' })).toBe(true);
  });

  it('does NOT select successful results (scene-skip / defensive-upload ghost) — token-safety', () => {
    // success:true must never be re-run: it was already analyzed (row + token spent).
    expect(isDeferredUploadRetryCandidate({ success: true, error: undefined })).toBe(false);
    expect(isDeferredUploadRetryCandidate({ success: true, error: 'Upload failed for x.jpg: too many connections' })).toBe(false);
  });

  it('does NOT select non-upload failures (analysis-stage errors stay out of scope)', () => {
    expect(isDeferredUploadRetryCandidate({ success: false, error: 'Edge Function returned 500: resource exhausted' })).toBe(false);
    expect(isDeferredUploadRetryCandidate({ success: false, error: 'Processing cancelled by user' })).toBe(false);
    expect(isDeferredUploadRetryCandidate({ success: false, error: 'RAW preview extraction failed' })).toBe(false);
  });

  it('does NOT select a permanent (non-transient) upload failure', () => {
    expect(isDeferredUploadRetryCandidate({ success: false, error: 'Upload failed for x.jpg: 403 Forbidden (invalid key)' })).toBe(false);
  });

  it('handles missing/empty error defensively', () => {
    expect(isDeferredUploadRetryCandidate({ success: false })).toBe(false);
    expect(isDeferredUploadRetryCandidate({ success: false, error: '' })).toBe(false);
    expect(isDeferredUploadRetryCandidate({ success: false, error: null })).toBe(false);
  });
});
