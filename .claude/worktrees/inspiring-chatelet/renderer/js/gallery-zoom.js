/**
 * GalleryZoomController
 * Adds zoom and pan to the gallery modal image.
 * Uses CSS transform: scale() + translate() for GPU-accelerated rendering.
 */
class GalleryZoomController {
  constructor() {
    this.imgEl = null;
    this.containerEl = null;
    this.controlsEl = null;

    // Transform state
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;

    // Zoom limits
    this.minScale = 1;
    this.maxScale = 8;
    this.zoomStep = 0.25;
    this.wheelZoomFactor = 0.002;
    this.dblClickScale = 2.5;

    // Pan state
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panStartTranslateX = 0;
    this.panStartTranslateY = 0;

    // Bound handlers (for removal)
    this._onWheel = this._handleWheel.bind(this);
    this._onDblClick = this._handleDoubleClick.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
  }

  /**
   * Attach zoom controller to an image and its container.
   * Creates the zoom controls UI and wires all events.
   */
  attach(imgEl, containerEl) {
    this.imgEl = imgEl;
    this.containerEl = containerEl;

    // Set transform-origin to top-left; we handle centering via translate
    this.imgEl.style.transformOrigin = '0 0';

    // Create controls UI
    this._createControls();

    // Wire events on the container (not the image) so nav buttons stay clickable
    const imageWrapper = containerEl.querySelector('.lv-gallery-image');
    const target = imageWrapper || containerEl;

    target.addEventListener('wheel', this._onWheel, { passive: false });
    target.addEventListener('dblclick', this._onDblClick);
    target.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);

    this._updateCursor();
  }

  /**
   * Reset zoom to fit (scale=1, translate=0).
   * @param {boolean} animated - Whether to animate the transition.
   */
  reset(animated) {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this._applyTransform(animated);
    this._updateIndicator();
    this._updateCursor();
  }

  /**
   * Handle a keydown event. Returns true if the key was consumed.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  handleKeyDown(e) {
    switch (e.key) {
      case '+':
      case '=':
        this._zoomBy(this.zoomStep * 2, true);
        return true;
      case '-':
        this._zoomBy(-this.zoomStep * 2, true);
        return true;
      case '0':
        this.reset(true);
        return true;
      default:
        return false;
    }
  }

  // ── Private: Event Handlers ──────────────────────────────────

  _handleWheel(e) {
    e.preventDefault();

    const delta = -e.deltaY * this.wheelZoomFactor;
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * (1 + delta)));
    if (newScale === this.scale) return;

    this._zoomToPoint(e.clientX, e.clientY, newScale, false);
  }

  _handleDoubleClick(e) {
    // Don't interfere with nav buttons
    if (e.target.closest('.lv-gallery-nav') || e.target.closest('.lv-zoom-controls')) return;

    if (this.scale > 1.05) {
      this.reset(true);
    } else {
      this._zoomToPoint(e.clientX, e.clientY, this.dblClickScale, true);
    }
  }

  _handleMouseDown(e) {
    // Only pan with left button when zoomed
    if (e.button !== 0 || this.scale <= 1.01) return;
    // Don't interfere with nav buttons or controls
    if (e.target.closest('.lv-gallery-nav') || e.target.closest('.lv-zoom-controls')) return;

    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.panStartTranslateX = this.translateX;
    this.panStartTranslateY = this.translateY;

    this.containerEl.classList.add('lv-grabbing');
    e.preventDefault();
  }

  _handleMouseMove(e) {
    if (!this.isPanning) return;

    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;

    this.translateX = this.panStartTranslateX + dx;
    this.translateY = this.panStartTranslateY + dy;

    this._clampTranslate();
    this._applyTransform(false);
  }

  _handleMouseUp() {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.containerEl.classList.remove('lv-grabbing');
  }

  // ── Private: Transform ───────────────────────────────────────

  /**
   * Get the img element's layout offset relative to the container.
   * Walks offsetParent chain up to the container.
   */
  _getImgOffset() {
    let el = this.imgEl;
    let left = 0, top = 0;
    while (el && el !== this.containerEl) {
      left += el.offsetLeft || 0;
      top += el.offsetTop || 0;
      el = el.offsetParent;
    }
    return { left, top };
  }

  /**
   * Zoom to a specific scale, keeping the point under (clientX, clientY)
   * stationary.
   */
  _zoomToPoint(clientX, clientY, newScale, animated) {
    const containerRect = this.containerEl.getBoundingClientRect();
    const cx = clientX - containerRect.left;
    const cy = clientY - containerRect.top;
    const offset = this._getImgOffset();

    // Local-space point under cursor (in img element coords)
    const lx = (cx - offset.left - this.translateX) / this.scale;
    const ly = (cy - offset.top - this.translateY) / this.scale;

    this.scale = newScale;

    // Solve for new translate so same local point stays under cursor
    this.translateX = cx - offset.left - lx * this.scale;
    this.translateY = cy - offset.top - ly * this.scale;

    this._clampTranslate();
    this._applyTransform(animated);
    this._updateIndicator();
    this._updateCursor();
  }

  /**
   * Clamp translate so the scaled image content doesn't leave gaps.
   *
   * Coordinate system:
   *   img layout position in container: (offsetLeft, offsetTop)
   *   transform: translate(tx, ty) scale(s) with origin 0 0
   *   A local point (lx, ly) in the img box appears in container at:
   *     (offsetLeft + tx + lx*s, offsetTop + ty + ly*s)
   *
   * The visible image pixels (inside object-fit:contain) start at local
   * (padX, padY) with size (contentW, contentH).
   */
  _clampTranslate() {
    if (!this.imgEl || !this.containerEl) return;

    const natW = this.imgEl.naturalWidth;
    const natH = this.imgEl.naturalHeight;
    if (!natW || !natH) return;

    const boxW = this.imgEl.offsetWidth;
    const boxH = this.imgEl.offsetHeight;

    const fitScale = Math.min(boxW / natW, boxH / natH);
    const contentW = natW * fitScale;
    const contentH = natH * fitScale;
    const padX = (boxW - contentW) / 2;
    const padY = (boxH - contentH) / 2;

    const s = this.scale;
    const scaledCW = contentW * s;
    const scaledCH = contentH * s;

    const offset = this._getImgOffset();
    const viewW = this.containerEl.clientWidth;
    const viewH = this.containerEl.clientHeight;

    // Content left edge in container: offset.left + tx + padX*s
    // Content right edge: offset.left + tx + (padX + contentW)*s

    // Horizontal
    if (scaledCW <= viewW) {
      // Center the content in the viewport
      this.translateX = (viewW - scaledCW) / 2 - offset.left - padX * s;
    } else {
      // Left edge must be <= 0, right edge must be >= viewW
      const maxTx = -offset.left - padX * s;
      const minTx = viewW - offset.left - padX * s - scaledCW;
      this.translateX = Math.min(maxTx, Math.max(minTx, this.translateX));
    }

    // Vertical
    if (scaledCH <= viewH) {
      this.translateY = (viewH - scaledCH) / 2 - offset.top - padY * s;
    } else {
      const maxTy = -offset.top - padY * s;
      const minTy = viewH - offset.top - padY * s - scaledCH;
      this.translateY = Math.min(maxTy, Math.max(minTy, this.translateY));
    }
  }

  _applyTransform(animated) {
    if (!this.imgEl) return;

    if (animated) {
      this.imgEl.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)';
      // Remove transition after it completes
      const onEnd = () => {
        this.imgEl.style.transition = '';
        this.imgEl.removeEventListener('transitionend', onEnd);
      };
      this.imgEl.addEventListener('transitionend', onEnd);
    } else {
      this.imgEl.style.transition = '';
    }

    this.imgEl.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;

    // Toggle zoomed class on container
    if (this.scale > 1.01) {
      this.containerEl.classList.add('lv-zoomed');
    } else {
      this.containerEl.classList.remove('lv-zoomed');
    }
  }

  // ── Private: Zoom helpers ────────────────────────────────────

  /**
   * Zoom by a delta amount, centered on the viewport center.
   */
  _zoomBy(delta, animated) {
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale + delta));
    if (newScale === this.scale) return;

    const containerRect = this.containerEl.getBoundingClientRect();
    const cx = containerRect.left + containerRect.width / 2;
    const cy = containerRect.top + containerRect.height / 2;

    this._zoomToPoint(cx, cy, newScale, animated);
  }

  // ── Private: UI ──────────────────────────────────────────────

  _createControls() {
    // Remove any existing controls
    const existing = this.containerEl.querySelector('.lv-zoom-controls');
    if (existing) existing.remove();

    const controls = document.createElement('div');
    controls.className = 'lv-zoom-controls';
    controls.innerHTML = `
      <button class="lv-zoom-btn" data-action="out" title="Zoom out (-)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="7" width="10" height="2" rx="1"/>
        </svg>
      </button>
      <span class="lv-zoom-indicator">100%</span>
      <button class="lv-zoom-btn" data-action="in" title="Zoom in (+)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="7" width="10" height="2" rx="1"/>
          <rect x="7" y="3" width="2" height="10" rx="1"/>
        </svg>
      </button>
      <button class="lv-zoom-btn" data-action="fit" title="Fit to view (0)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 3h4V1H2a1 1 0 00-1 1v5h2V3zM13 3h-4V1h5a1 1 0 011 1v5h-2V3zM3 13h4v2H2a1 1 0 01-1-1v-5h2v4zM13 13h-4v2h5a1 1 0 001-1v-5h-2v4z"/>
        </svg>
      </button>
    `;

    controls.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      switch (btn.dataset.action) {
        case 'in':
          this._zoomBy(this.zoomStep * 2, true);
          break;
        case 'out':
          this._zoomBy(-this.zoomStep * 2, true);
          break;
        case 'fit':
          this.reset(true);
          break;
      }
    });

    this.containerEl.appendChild(controls);
    this.controlsEl = controls;
  }

  _updateIndicator() {
    if (!this.controlsEl) return;
    const indicator = this.controlsEl.querySelector('.lv-zoom-indicator');
    if (indicator) {
      indicator.textContent = Math.round(this.scale * 100) + '%';
    }
  }

  _updateCursor() {
    if (!this.containerEl) return;
    if (this.scale > 1.01) {
      this.containerEl.classList.add('lv-zoomed');
    } else {
      this.containerEl.classList.remove('lv-zoomed');
    }
  }
}

// Expose globally for log-visualizer.js
window.GalleryZoomController = GalleryZoomController;
