/**
 * Upload / Edge Function retry classifiers.
 *
 * Pure, dependency-free string matchers that decide whether a failed upload or
 * Edge Function call is worth retrying. Extracted from `unified-image-processor.ts`
 * so they can be unit-tested without loading the heavy processing pipeline
 * (sharp / ONNX / native modules).
 *
 * Consumed by `UnifiedImageWorker.uploadToStorage` (MAX_UPLOAD_RETRIES with
 * exponential backoff).
 */

/**
 * Determine if an Edge Function error is retryable.
 * Covers network failures, capacity/rate-limit errors (429, 503), and
 * Supabase/Postgres connection-pool exhaustion.
 * Issues: #55 (timeout), #57 (429 Resource Exhausted), #58 (Failed to send),
 *         #142/#143/#144 (connection-pool exhaustion — Nürburgring 24h batch, v1.1.9)
 */
export function isEdgeFunctionRetryable(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  // Network errors
  if (msg.includes('fetch failed') || msg.includes('econnrefused') ||
      msg.includes('etimedout') || msg.includes('failed to send') ||
      msg.includes('econnreset') || msg.includes('socket hang up') ||
      msg.includes('failed to load image') || msg.includes('error reading a body') ||
      msg.includes('connection error') || msg.includes('connection reset')) {
    return true;
  }
  // HTTP capacity/rate-limit errors
  if (msg.includes('429') || msg.includes('503') ||
      msg.includes('resource exhausted') || msg.includes('resource_exhausted') ||
      msg.includes('overloaded') || msg.includes('quota') ||
      msg.includes('rate limit') || msg.includes('rate_limit') ||
      msg.includes('too many requests') || msg.includes('service unavailable')) {
    return true;
  }
  // Supabase / Postgres connection-pool exhaustion (issues #142, #143, #144).
  // Transient capacity error, same class as 429/503: the pooler (Supavisor /
  // pgbouncer) or Postgres itself rejects new connections when saturated, so a
  // retry after backoff usually lands. `msg` is already lower-cased, so this is
  // case-insensitive. Kept conservative — only clearly-transient pooler-capacity
  // messages, not arbitrary "connection" strings.
  // (Deeper fix — pooler sizing / pgbouncer transaction mode — is server-side.)
  if (msg.includes('maximum number of connections') ||
      msg.includes('too many connections') ||
      msg.includes('remaining connection slots') ||
      msg.includes('max client connections') ||
      msg.includes('too many clients already')) {
    return true;
  }
  // Supabase Edge Function boot timeout (issue #55)
  if (msg.includes('function invocation timeout') || msg.includes('boot error') ||
      msg.includes('worker limit')) {
    return true;
  }
  return false;
}

/**
 * Determine if an upload-to-storage error is retryable.
 * Extends `isEdgeFunctionRetryable` with storage-gateway failures that surface
 * as HTML error pages being parsed as JSON.
 *
 * Issues covered:
 *  - #108, #103, #95  "fetch failed" in UnifiedImageWorker.uploadToStorage
 *  - #107, #106, #100, #98  "Unexpected token '<', \"<!DOCTYPE ...\" is not valid JSON"
 *    (storage/edge gateway returns an HTML error page that the SDK tries to JSON.parse)
 */
export function isUploadRetryable(errorMessage: string): boolean {
  if (isEdgeFunctionRetryable(errorMessage)) return true;
  const msg = errorMessage.toLowerCase();
  // JSON parse errors indicating HTML response from gateway (502/503/504 pages)
  if (msg.includes("unexpected token '<'") ||
      msg.includes('unexpected token <') ||
      msg.includes('<!doctype') ||
      msg.includes('is not valid json') ||
      msg.includes('unexpected end of json input')) {
    return true;
  }
  // Common transient HTTP 5xx/gateway responses
  if (msg.includes('502') || msg.includes('504') ||
      msg.includes('bad gateway') || msg.includes('gateway timeout')) {
    return true;
  }
  return false;
}

/** Minimal shape of a per-image result needed to decide a deferred upload retry. */
export interface DeferredUploadCandidate {
  success?: boolean;
  error?: string | null;
}

/**
 * Decide whether a finished per-image result should be re-tried by the
 * end-of-batch "deferred upload drain".
 *
 * Deliberately CONSERVATIVE — it only matches a HARD upload-stage failure that
 * is also transient (e.g. Supabase connection-pool exhaustion during the
 * high-concurrency pass: `"Upload failed for X: ...maximum number of
 * connections..."`). This is the exact signature of issues #142/#143/#144.
 *
 * Why `success === false` is required (token-safety, do NOT loosen):
 *  - A hard upload failure threw BEFORE `analyzeImage`, so the image was never
 *    analyzed → its pre-authorized token is unspent and re-running charges it
 *    exactly once (never twice), and no `analysis_results` row exists yet.
 *  - `success: true` results — scene-skipped images and the "defensive late
 *    upload" ghost (crop-context V6 analyzes base64 crops even when the
 *    reference upload fails) — ALREADY analyzed and inserted a row. Re-running
 *    those would duplicate the row AND double-charge. They are excluded here on
 *    purpose; the existing ghost-detector + manual resume cover them.
 */
export function isDeferredUploadRetryCandidate(result: DeferredUploadCandidate): boolean {
  if (result.success !== false) return false;
  const err = result.error;
  if (typeof err !== 'string' || err.length === 0) return false;
  // Must be an upload-stage failure (message minted by uploadToStorage) …
  if (!/upload failed for/i.test(err)) return false;
  // … and transient (same classifier the immediate retry loop uses).
  return isUploadRetryable(err);
}
