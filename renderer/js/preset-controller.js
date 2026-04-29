/**
 * PresetController — single source of truth for participant-preset state on the Analysis page.
 *
 * Why this exists
 * ---------------
 * Before this controller, two modules (`renderer.js` and `enhanced-file-browser.js`)
 * each owned their own copy of the preset list and selection state. They populated the
 * same `<select id="preset-select">` element from parallel IPC fetches, attached event
 * listeners only once during their constructors, and the SPA router rebuilt the page DOM
 * on every navigation — orphaning those listeners. The result: the dropdown UI showed
 * one thing while the in-memory state held another, and `handleFolderAnalysis` accumulated
 * three layers of defensive "force reload" code to paper over the desync.
 *
 * This controller owns the preset list, the selected preset, the in-flight loading
 * promise, the category filter, and the DOM binding. Every other module reads from it
 * and listens to its events. There is no second source of truth.
 *
 * Usage
 * -----
 *   await window.presetController.refresh();
 *   window.presetController.bindToView(pageContainer);   // call on every page-loaded
 *   window.presetController.select(id);
 *   window.presetController.deselect();
 *   window.presetController.applyCategoryFilter(categoryCode);
 *   window.presetController.addEventListener('selection-changed', (e) => { ... });
 *
 * Events
 * ------
 *   'list-changed'      — the visible list changed (after refresh or filter change)
 *   'selection-changed' — the selected preset changed (event.detail = preset|null)
 *   'loading-changed'   — loading state toggled (event.detail = boolean)
 */

(function () {
  'use strict';

  class PresetController extends EventTarget {
    constructor() {
      super();
      // ---- State (private; read via getters) ----
      this._all = [];                       // raw list from IPC
      this._categoryCodeToIdMap = {};       // injected by renderer.js after categories load
      this._categoryFilter = null;          // category code currently selected
      this._selected = null;                // full preset object {id, name, participants, ...}
      this._loading = false;                // listing/selection IPC in flight
      this._listRefreshPromise = null;      // in-flight refresh promise (for dedup)
      this._pendingSelectId = null;         // queued select() called before list is ready
      this._viewAbort = null;               // AbortController for the current DOM binding
      this._selectionRequestId = 0;         // monotonic — drops stale select() responses
    }

    // ============================================================================
    // Public read API
    // ============================================================================

    /** Full unfiltered list. */
    get all() { return this._all.slice(); }

    /** List filtered by current category (or full list if no filter). */
    get visible() { return this._computeVisible(); }

    /** Currently selected preset object, or null. */
    get selected() { return this._selected; }

    /** True while a refresh or selection IPC is in flight. */
    get loading() { return this._loading; }

    /** True if a list refresh is currently in flight. Used by handleFolderAnalysis. */
    get listLoading() { return !!this._listRefreshPromise; }

    /** Resolves when any in-flight list refresh + queued selection have finished. */
    async ready() {
      if (this._listRefreshPromise) {
        try { await this._listRefreshPromise; } catch { /* swallow */ }
      }
    }

    // ============================================================================
    // Public write API
    // ============================================================================

    /**
     * Fetch the preset list from Supabase via IPC and update internal state.
     * Concurrent calls share the same in-flight promise.
     */
    refresh(force = false) {
      if (this._listRefreshPromise && !force) return this._listRefreshPromise;

      const requestPromise = (async () => {
        this._setLoading(true);
        try {
          const isAdmin = await this._safeIsAdmin();
          const channel = isAdmin
            ? 'supabase-get-all-participant-presets-admin'
            : 'supabase-get-participant-presets';
          const response = await window.api.invoke(channel);
          if (response && response.success && Array.isArray(response.data)) {
            this._all = response.data.map((p) => this._normalizeListItem(p));
          } else {
            console.warn('[PresetController] refresh: unexpected response', response);
            this._all = [];
          }
        } catch (err) {
          console.error('[PresetController] refresh failed:', err);
          this._all = [];
        } finally {
          this._setLoading(false);
        }

        // Drain a queued selection (e.g. from last-analysis-settings restore)
        // before notifying listeners — so 'list-changed' and 'selection-changed'
        // arrive in a coherent order.
        if (this._pendingSelectId) {
          const queued = this._pendingSelectId;
          this._pendingSelectId = null;
          // Fire-and-forget; the select() will emit its own selection-changed.
          this.select(queued).catch((e) => console.warn('[PresetController] queued select failed:', e));
        }

        this.dispatchEvent(new CustomEvent('list-changed', { detail: this._computeVisible() }));
      })();

      this._listRefreshPromise = requestPromise.finally(() => {
        // Only clear if we're still the active promise (avoid clobbering a newer refresh)
        if (this._listRefreshPromise === requestPromise) this._listRefreshPromise = null;
      });
      return this._listRefreshPromise;
    }

    /**
     * Select a preset by id. Loads full preset data (with participants) from IPC.
     * If id is falsy, deselects.
     * If the list hasn't been loaded yet, queues the selection until refresh completes.
     */
    async select(presetId) {
      if (!presetId) return this.deselect();

      // If list isn't loaded yet, queue and let refresh() apply this when it resolves.
      if (this._all.length === 0 && this._listRefreshPromise) {
        this._pendingSelectId = presetId;
        return;
      }

      // Race protection: only the most recent select() request gets to set state.
      const myRequestId = ++this._selectionRequestId;
      this._setLoading(true);
      try {
        const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);
        if (myRequestId !== this._selectionRequestId) return; // stale response, drop
        if (response && response.success && response.data) {
          const data = response.data;
          this._selected = {
            id: data.id,
            name: data.name,
            description: data.description,
            participants: data.participants || data.preset_participants || [],
            custom_folders: data.custom_folders || [],
            allow_external_person_recognition: data.allow_external_person_recognition === true,
          };
          // Update last-used timestamp (best-effort, fire-and-forget).
          window.api.invoke('supabase-update-preset-last-used', presetId).catch(() => {});
          this.dispatchEvent(new CustomEvent('selection-changed', { detail: this._selected }));
        } else {
          console.warn('[PresetController] select: unexpected response', response);
          this._selected = null;
          this.dispatchEvent(new CustomEvent('selection-changed', { detail: null }));
        }
      } catch (err) {
        if (myRequestId !== this._selectionRequestId) return;
        console.error('[PresetController] select failed:', err);
        this._selected = null;
        this.dispatchEvent(new CustomEvent('selection-changed', { detail: null }));
      } finally {
        if (myRequestId === this._selectionRequestId) this._setLoading(false);
      }
    }

    /** Clear the current selection. */
    deselect() {
      // Cancel any in-flight selection so it doesn't write back over us.
      this._selectionRequestId++;
      this._pendingSelectId = null;
      if (this._selected !== null) {
        this._selected = null;
        this.dispatchEvent(new CustomEvent('selection-changed', { detail: null }));
      }
    }

    /**
     * Inject the category-code → category-id map. Called by renderer.js once dynamic
     * categories have been loaded. Pure data transfer; doesn't trigger events.
     */
    setCategoryMap(map) {
      this._categoryCodeToIdMap = map || {};
    }

    /**
     * Apply (or change) the visible-list filter to a sport category code.
     * Pass null/undefined to clear the filter and show all presets.
     *
     * Behaviour: if the currently selected preset is filtered out by the new
     * category, it is deselected — matching the legacy `filterAndDisplayPresets`
     * behaviour of resetting `<select>.value = ''` on category change.
     */
    applyCategoryFilter(categoryCode) {
      if (this._categoryFilter === categoryCode) {
        // Still emit list-changed because callers may want to re-render anyway.
      }
      this._categoryFilter = categoryCode || null;
      const visible = this._computeVisible();

      // If the selected preset is no longer in the visible set, drop the selection.
      if (this._selected && !visible.some((p) => p.id === this._selected.id)) {
        this._selected = null;
        this.dispatchEvent(new CustomEvent('selection-changed', { detail: null }));
      }
      this.dispatchEvent(new CustomEvent('list-changed', { detail: visible }));
    }

    // ============================================================================
    // View binding
    // ============================================================================

    /**
     * Wire up the preset UI inside `rootEl` (typically the page container after the
     * router replaces innerHTML). Idempotent: any previous binding is torn down first
     * via its AbortController, so listeners can never accumulate or point at stale nodes.
     *
     * Also kicks off a list refresh if the list is empty.
     */
    bindToView(rootEl) {
      this._unbind();

      const root = rootEl || document;
      const hiddenSelect = root.querySelector('#preset-select');
      const trigger = root.querySelector('#custom-preset-trigger');
      const triggerLabel = root.querySelector('#custom-preset-trigger .cpd-name');
      const dropdown = root.querySelector('#custom-preset-dropdown');
      const menu = root.querySelector('#custom-preset-menu');

      if (!hiddenSelect || !trigger || !dropdown || !menu) {
        // Page DOM not present yet (e.g. user is on a non-analysis page).
        // Nothing to bind; we'll be called again on the next page-loaded.
        return;
      }

      const abort = new AbortController();
      const { signal } = abort;
      this._viewAbort = abort;

      // Cache nodes on the controller so render helpers can find them without re-querying.
      this._view = { hiddenSelect, trigger, triggerLabel, dropdown, menu, root };

      // --- Trigger toggles dropdown open/close ---
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      }, { signal });

      // --- Click outside closes the dropdown ---
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
      }, { signal });

      // --- Escape closes the dropdown ---
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dropdown.classList.contains('open')) {
          dropdown.classList.remove('open');
          trigger.focus();
        }
      }, { signal });

      // --- Direct change on the hidden <select> (e.g. programmatic) ---
      // We intentionally route through select()/deselect() so other code that does
      // `presetSelect.value = id; dispatchEvent('change')` still works.
      hiddenSelect.addEventListener('change', (e) => {
        const value = e.target.value;
        if (value) {
          // Avoid an extra IPC if the same preset is already selected.
          if (this._selected && this._selected.id === value) return;
          this.select(value);
        } else {
          this.deselect();
        }
      }, { signal });

      // --- Listen to our own state changes to keep the UI in sync ---
      this.addEventListener('list-changed', () => this._renderList(), { signal });
      this.addEventListener('selection-changed', () => this._renderSelection(), { signal });

      // Initial render from current state, then trigger refresh if needed.
      this._renderList();
      this._renderSelection();
      if (this._all.length === 0 && !this._listRefreshPromise) {
        this.refresh().then(() => this._renderList());
      }
    }

    /** Tear down the current DOM binding (called automatically by bindToView). */
    _unbind() {
      if (this._viewAbort) {
        try { this._viewAbort.abort(); } catch { /* ignore */ }
        this._viewAbort = null;
      }
      this._view = null;
    }

    // ============================================================================
    // Internal helpers
    // ============================================================================

    /** Normalize a list-API row to a uniform shape (we don't care about full participants here). */
    _normalizeListItem(p) {
      const participants = p.participants || p.preset_participants || [];
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        category_id: p.category_id || null,
        is_official: p.is_official === true,
        participantCount: typeof p.participant_count === 'number'
          ? p.participant_count
          : participants.length,
      };
    }

    /** Apply category filter to the cached list. */
    _computeVisible() {
      if (!this._categoryFilter) return this._all.slice();
      const targetId = this._categoryCodeToIdMap[this._categoryFilter];
      if (!targetId) return this._all.slice();
      return this._all.filter((p) => p.category_id === targetId || !p.category_id);
    }

    _setLoading(value) {
      const next = !!value;
      if (this._loading === next) return;
      this._loading = next;
      this.dispatchEvent(new CustomEvent('loading-changed', { detail: next }));
    }

    async _safeIsAdmin() {
      try {
        const result = await window.api.invoke('auth-is-admin');
        return result === true || (result && result.isAdmin === true);
      } catch {
        return false;
      }
    }

    // ----------------------------------------------------------------------------
    // Rendering — all DOM mutation lives here so the rest of the codebase never
    // touches the preset <select> or the custom dropdown directly.
    // ----------------------------------------------------------------------------

    _renderList() {
      if (!this._view) return;
      const { hiddenSelect, menu } = this._view;
      const visible = this._computeVisible();
      const selectedId = this._selected ? this._selected.id : '';

      // --- Hidden <select> ---
      // Rebuild option list. We keep the placeholder as the first option.
      hiddenSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Enhance Recognition Accuracy';
      hiddenSelect.appendChild(placeholder);
      for (const p of visible) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.participantCount} participants)`;
        hiddenSelect.appendChild(opt);
      }
      // Restore current selection if it survived the filter.
      hiddenSelect.value = visible.some((p) => p.id === selectedId) ? selectedId : '';

      // --- Custom dropdown menu ---
      menu.innerHTML = '';
      // Placeholder ("clear selection") row.
      menu.appendChild(this._buildMenuOption('', 'Enhance Recognition Accuracy', selectedId === ''));
      for (const p of visible) {
        const label = `${p.name} (${p.participantCount} participants)`;
        menu.appendChild(this._buildMenuOption(p.id, label, p.id === selectedId));
      }

      this._renderTriggerLabel();
    }

    _renderSelection() {
      if (!this._view) return;
      const { hiddenSelect, menu } = this._view;
      const selectedId = this._selected ? this._selected.id : '';

      // Update hidden select value (without triggering change).
      if (hiddenSelect.value !== selectedId) {
        hiddenSelect.value = selectedId;
      }

      // Update highlighted option.
      menu.querySelectorAll('.cpd-option').forEach((el) => {
        el.classList.toggle('selected', el.dataset.value === selectedId);
      });

      this._renderTriggerLabel();
      this._renderPresetDetails();
    }

    _renderTriggerLabel() {
      if (!this._view) return;
      const { hiddenSelect, triggerLabel } = this._view;
      if (!triggerLabel) return;
      const opt = hiddenSelect.options[hiddenSelect.selectedIndex];
      triggerLabel.textContent = opt ? opt.textContent : 'Enhance Recognition Accuracy';
    }

    _renderPresetDetails() {
      if (!this._view) return;
      const details = this._view.root.querySelector
        ? this._view.root.querySelector('#preset-details')
        : document.getElementById('preset-details');
      const count = this._view.root.querySelector
        ? this._view.root.querySelector('#preset-participant-count')
        : document.getElementById('preset-participant-count');
      if (!details || !count) return;
      if (this._selected) {
        details.style.display = 'block';
        count.textContent = String((this._selected.participants || []).length);
      } else {
        details.style.display = 'none';
      }
    }

    _buildMenuOption(value, label, selected) {
      const div = document.createElement('div');
      div.className = 'cpd-option' + (selected ? ' selected' : '');
      div.dataset.value = value;
      const span = document.createElement('span');
      span.className = 'cpd-opt-name';
      span.textContent = label;
      div.appendChild(span);
      div.addEventListener('click', () => {
        if (this._view && this._view.dropdown) {
          this._view.dropdown.classList.remove('open');
        }
        if (value) {
          if (!this._selected || this._selected.id !== value) this.select(value);
        } else {
          this.deselect();
        }
      });
      return div;
    }
  }

  // Singleton.
  const controller = new PresetController();
  window.presetController = controller;

  // Convenience global for legacy callers.
  window.PresetController = PresetController;

  // ---- Bridge from the Participants page ----------------------------------
  // participants-manager.js dispatches `presetSelected` / `presetCleared` window
  // events when the user picks (or clears) a preset from that page. We forward
  // those into the controller so the Analysis page reflects the choice the next
  // time the user opens it. Listeners attached once on the window — no DOM
  // dependency, no leak risk.
  window.addEventListener('presetSelected', (e) => {
    const id = e && e.detail && (e.detail.presetId || e.detail.id);
    if (id) controller.select(id).catch(() => {});
  });
  window.addEventListener('presetCleared', () => {
    controller.deselect();
  });
})();
