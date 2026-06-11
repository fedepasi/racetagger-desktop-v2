/**
 * toast.js — canonical, app-wide toast notifications.
 *
 * Exposes a single global: window.showToast(message, type, opts)
 *   type : 'success' | 'error' | 'warning' | 'info'   (default 'info')
 *   opts : { duration }  — ms before auto-dismiss (default 4000; 0 = sticky)
 *   returns: a dismiss() function you can call to close it early.
 *
 * Flat and brand-aligned (RaceTagger blue #1a9ee0 + the functional palette),
 * no gradients. Toasts stack top-right, slide in, auto-dismiss, dismiss on click.
 *
 * This replaces the per-file gradient toast that used to live inside
 * results-delivery.js's IIFE (which wasn't actually global, so callers like
 * settings.js / preset-face-manager.js that check `typeof showToast === 'function'`
 * never found it). Now they do.
 */
(function () {
  'use strict';

  // Functional palette (brand-manual.md §3.2). Status === livery-stripe colour.
  var COLORS = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#1a9ee0',
  };

  var CONTAINER_ID = 'rt-toast-container';

  function getContainer() {
    var c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      c.setAttribute('aria-live', 'polite');
      c.style.cssText =
        'position: fixed; top: 20px; right: 20px; z-index: 99999; ' +
        'display: flex; flex-direction: column; gap: 10px; ' +
        'pointer-events: none; max-width: 380px;';
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(message, type, opts) {
    opts = opts || {};
    var accent = COLORS[type] || COLORS.info;
    var duration = typeof opts.duration === 'number' ? opts.duration : 4000;

    var toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.style.cssText =
      'pointer-events: auto; cursor: pointer; display: flex; align-items: center; gap: 10px; ' +
      'background: var(--bg-card, #1e293b); border: 1px solid var(--border-color, #334155); ' +
      'border-left: 3px solid ' + accent + '; border-radius: 10px; padding: 12px 16px; ' +
      'color: var(--text-primary, #f1f4fa); font-size: 13px; line-height: 1.4; ' +
      'box-shadow: 0 12px 32px rgba(0,0,0,0.35); max-width: 380px; ' +
      'transform: translateX(120%); opacity: 0; ' +
      'transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s;';

    var dot = document.createElement('span');
    dot.style.cssText =
      'width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ' + accent + ';';
    toast.appendChild(dot);

    var text = document.createElement('span');
    text.textContent = message == null ? '' : String(message);
    text.style.cssText = 'flex: 1; min-width: 0;';
    toast.appendChild(text);

    getContainer().appendChild(toast);

    // Animate in on the next frame so the transition runs.
    requestAnimationFrame(function () {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });

    var dismissed = false;
    var timer = null;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      if (timer) clearTimeout(timer);
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 240);
    }

    toast.addEventListener('click', dismiss);
    if (duration > 0) timer = setTimeout(dismiss, duration);

    return dismiss;
  }

  // Canonical global. Don't clobber if something already defined a richer one.
  if (typeof window.showToast !== 'function') {
    window.showToast = showToast;
  }
})();
