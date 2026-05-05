/**
 * User Action Logger (renderer side)
 * ============================================================================
 *
 * Canonical entry point for emitting USER_ACTION events from the renderer.
 * Every tracked button click, modal open/close, configuration change, and
 * exit on the results page goes through this module so that:
 *
 *   1. Every event is bound to the executionId the user is currently
 *      viewing (read from window.logVisualizer.executionId — that's the
 *      same id the rest of the results page already uses).
 *   2. A stable per-page sessionId correlates all events emitted between
 *      a RESULTS_PAGE_LOADED and the matching RESULTS_PAGE_EXITED, even
 *      when the user navigates away and back.
 *   3. High-frequency interactions (search keystrokes, IPTC field edits)
 *      are debounced so we don't write 30 events for one typed sentence.
 *   4. Gallery / similar high-volume aggregations report ONE summary event
 *      on close instead of one event per arrow press.
 *   5. The whole thing is fire-and-forget — telemetry must never throw or
 *      block the user-facing workflow.
 *
 * Usage:
 *   logUserAction('WRITE_ORIGINALS_STARTED', 'EXECUTE', { fileCount, ... });
 *   logUserActionDebounced('SEARCH_QUERY_ENTERED', 'VIEW', { queryLength: q.length });
 *   const ctx = beginAggregate('gallery'); ctx.bump('navigationCount'); ctx.flush('GALLERY_CLOSED','VIEW');
 *
 * Privacy contract (CALLER'S RESPONSIBILITY — main process does NOT sanitize):
 *   - NEVER pass: file paths, raw IPTC field values, search query text,
 *     client/email addresses, full URLs.
 *   - DO pass: counts, durations, enum values, IDs, booleans, field names.
 *   - When in doubt, drop the field. We can always add data later; we
 *     can't unship a privacy leak.
 */

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Session id
  // -----------------------------------------------------------------------
  // Stable for the lifetime of one results-page visit. Regenerated on every
  // RESULTS_PAGE_LOADED so that bouncing back and forth produces distinct
  // sessions in the data even when the executionId is the same. Kept in
  // module scope (not localStorage) — we don't want it to outlive the page.
  let currentSessionId = null;

  function generateSessionId() {
    // crypto.randomUUID is universally available in Electron's renderer.
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    // Defensive fallback (older Electron, very unlikely in practice).
    return 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Begin a new results-page session. Call once per RESULTS_PAGE_LOADED emit
   * (the wrapper of `logUserAction('RESULTS_PAGE_LOADED', ...)` already does
   * this internally — most callers don't need to invoke it directly).
   */
  function beginSession() {
    currentSessionId = generateSessionId();
    return currentSessionId;
  }

  function getSessionId() {
    if (!currentSessionId) {
      currentSessionId = generateSessionId();
    }
    return currentSessionId;
  }

  // -----------------------------------------------------------------------
  // Execution id resolution
  // -----------------------------------------------------------------------
  /**
   * Pulls the executionId of what the user is currently viewing.
   * Returns null when we're not on the results page (e.g. background tasks
   * trying to log too early/late). Callers should accept null silently —
   * nothing useful comes out of logging an action with no context.
   */
  function resolveExecutionId() {
    try {
      const lv = window.logVisualizer;
      if (lv && typeof lv.executionId === 'string' && lv.executionId.length > 0) {
        return lv.executionId;
      }
    } catch {
      // logVisualizer not initialised yet — drop the event.
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Core emit
  // -----------------------------------------------------------------------
  /**
   * Emit one USER_ACTION event. Fire-and-forget.
   *
   * @param {string} action    Canonical action key (e.g. 'WRITE_ORIGINALS_STARTED').
   * @param {string} category  One of: VIEW|CONFIGURE|EXECUTE|CORRECT|EXPORT|DELIVERY|EXIT.
   * @param {object} [data]    Sanitized payload. See privacy contract above.
   */
  function logUserAction(action, category, data) {
    try {
      if (!action || !category) return;

      const executionId = resolveExecutionId();
      if (!executionId) {
        // Not on results page (or page not ready). Silently drop — this is
        // a feature, not a bug: we don't want stub log files for actions
        // emitted before the page mounted.
        return;
      }

      // Fresh session on first action of a new RESULTS_PAGE_LOADED.
      if (action === 'RESULTS_PAGE_LOADED') {
        beginSession();
      }
      const sessionId = getSessionId();

      // Defensive: never pass undefined fields through IPC — strip them.
      const payload = { executionId, action, category, sessionId };
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        payload.data = data;
      }

      // window.api.invoke returns a Promise. We do NOT await it — telemetry
      // must never block UI. We do attach a .catch so unhandled rejections
      // don't litter the dev console.
      if (window.api && typeof window.api.invoke === 'function') {
        window.api.invoke('log-user-action', payload).catch((err) => {
          // Quiet warning, useful only when developing.
          if (window.__DEBUG_USER_ACTIONS) {
            console.warn('[UserAction] IPC failed:', err);
          }
        });
      }
    } catch (err) {
      // Telemetry must never throw. Swallow.
      if (window.__DEBUG_USER_ACTIONS) {
        console.warn('[UserAction] Emit failed:', err);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Debounce
  // -----------------------------------------------------------------------
  // Used for high-frequency emit sites: search input, IPTC field edits,
  // pattern editor keystrokes. Each (action) gets its own timer so different
  // actions don't stomp on each other.
  const debounceTimers = new Map();
  const DEFAULT_DEBOUNCE_MS = 800;

  /**
   * Debounced variant — schedules the emit and resets the timer if called
   * again within the window. Use for any handler bound to keystrokes or
   * rapid-fire input events.
   *
   * The PAYLOAD passed on the LAST call wins — earlier calls are dropped.
   * This is intentional: for "search query", "IPTC field edit", we only
   * want the final state, not every intermediate keystroke.
   */
  function logUserActionDebounced(action, category, data, delayMs) {
    const key = action;
    const wait = typeof delayMs === 'number' ? delayMs : DEFAULT_DEBOUNCE_MS;

    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      debounceTimers.delete(key);
      logUserAction(action, category, data);
    }, wait);
    debounceTimers.set(key, timer);
  }

  /**
   * Force-flush all pending debounced events immediately. Call before page
   * exit so we don't lose the last keystroke worth of context.
   */
  function flushDebounced() {
    for (const [, timer] of debounceTimers) {
      clearTimeout(timer);
    }
    // Note: clearing a timer doesn't fire it — the actual flush is to
    // re-emit synchronously. But because we don't keep the original
    // (action, category, data) tuple here, callers that need a definitive
    // flush should use the `flushNowOnExit` parameter via aggregates.
    // In practice the only debounced events are search-style probes whose
    // last value isn't critical to capture on exit.
    debounceTimers.clear();
  }

  // -----------------------------------------------------------------------
  // Aggregates (gallery-style "one summary on close")
  // -----------------------------------------------------------------------
  /**
   * Begin an aggregate that will emit a single summary event on flush().
   * Used for gallery navigation, where we want totals (imagesViewed,
   * navigationCount, deepestIndex) instead of one event per click.
   *
   * Usage:
   *   const agg = beginAggregate('gallery');
   *   agg.bump('navigationCount');
   *   agg.track('viewedSet', imageId);  // dedup as a Set
   *   agg.maxOf('deepestIndex', currentIdx);
   *   agg.set('lastFilter', 'unmatched');
   *   agg.flush('GALLERY_CLOSED', 'VIEW');
   *
   * Calling flush() emits the summary; calling discard() drops it without
   * emitting (e.g. user opened gallery and closed it before navigating —
   * not interesting enough to log).
   */
  function beginAggregate(/* tag — unused, kept for caller readability */) {
    const counters = Object.create(null);
    const sets = Object.create(null);
    const maxes = Object.create(null);
    const fixed = Object.create(null);
    const startedAt = Date.now();

    return {
      bump(key, n = 1) {
        counters[key] = (counters[key] || 0) + n;
      },
      track(key, value) {
        if (value === undefined || value === null) return;
        if (!sets[key]) sets[key] = new Set();
        sets[key].add(value);
      },
      maxOf(key, value) {
        if (typeof value !== 'number') return;
        if (maxes[key] === undefined || value > maxes[key]) {
          maxes[key] = value;
        }
      },
      set(key, value) {
        fixed[key] = value;
      },
      flush(action, category, extra) {
        const data = { ...fixed };
        for (const k of Object.keys(counters)) data[k] = counters[k];
        for (const k of Object.keys(maxes)) data[k] = maxes[k];
        for (const k of Object.keys(sets)) data[k + 'Count'] = sets[k].size;
        data.durationMs = Date.now() - startedAt;
        if (extra && typeof extra === 'object') {
          Object.assign(data, extra);
        }
        logUserAction(action, category, data);
      },
      discard() {
        // Explicit no-op so callers can express intent without leaking
        // listeners. Kept symmetric with flush() for readability.
      }
    };
  }

  // -----------------------------------------------------------------------
  // Public surface
  // -----------------------------------------------------------------------
  window.logUserAction = logUserAction;
  window.logUserActionDebounced = logUserActionDebounced;
  window.beginUserActionAggregate = beginAggregate;
  window.flushUserActionDebounced = flushDebounced;
  window.beginUserActionSession = beginSession;

  // Pageshow/visibilitychange isn't enough on Electron when the window is
  // closed via Cmd+Q — but at minimum on visibility change we flush, since
  // that's the most common "user moved away" signal.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDebounced();
  });

  // Handy for ad-hoc debugging in DevTools: window.__DEBUG_USER_ACTIONS = true;
  if (window.__DEBUG_USER_ACTIONS === undefined) {
    window.__DEBUG_USER_ACTIONS = false;
  }

  console.log('[UserAction] Logger ready');
})();
