/**
 * Ollama Settings UI
 * Manages the Local AI (Ollama) section in Settings.
 */

(function () {
  'use strict';

  let isDownloading = false;

  // ── DOM refs (resolved lazily after page load) ──────────────────────────────
  function refs() {
    return {
      statusBadge: document.getElementById('ollama-status-badge'),
      versionLabel: document.getElementById('ollama-version-label'),
      modelBadge: document.getElementById('ollama-model-badge'),
      modelSizeLabel: document.getElementById('ollama-model-size-label'),
      progressWrap: document.getElementById('ollama-download-progress-wrap'),
      progressBar: document.getElementById('ollama-download-progress-bar'),
      progressPct: document.getElementById('ollama-download-progress-pct'),
      progressText: document.getElementById('ollama-download-status-text'),
      refreshBtn: document.getElementById('ollama-refresh-btn'),
      downloadBtn: document.getElementById('ollama-download-btn'),
      testBtn: document.getElementById('ollama-test-btn'),
      testResult: document.getElementById('ollama-test-result'),
    };
  }

  // ── Status rendering ─────────────────────────────────────────────────────────
  function applyStatus(status) {
    const r = refs();
    if (!r.statusBadge) return; // Page not loaded yet

    if (!status.running) {
      r.statusBadge.textContent = 'Not running';
      r.statusBadge.className = 'status-badge status-inactive';
      r.versionLabel.textContent = '';
    } else {
      r.statusBadge.textContent = 'Running';
      r.statusBadge.className = 'status-badge status-active';
      r.versionLabel.textContent = status.version ? `v${status.version}` : '';
    }

    if (!status.modelAvailable) {
      r.modelBadge.textContent = 'Not downloaded';
      r.modelBadge.className = 'status-badge status-inactive';
      r.modelSizeLabel.textContent = '';
    } else {
      r.modelBadge.textContent = 'Ready';
      r.modelBadge.className = 'status-badge status-active';
      r.modelSizeLabel.textContent = status.modelSize ? `(${status.modelSize})` : '';
    }

    // Show / hide action buttons
    r.downloadBtn.style.display = (status.running && !status.modelAvailable && !isDownloading) ? '' : 'none';
    r.testBtn.style.display = (status.running && status.modelAvailable) ? '' : 'none';
  }

  // ── Refresh status ───────────────────────────────────────────────────────────
  async function refreshStatus() {
    const r = refs();
    if (!r.statusBadge) return;

    r.statusBadge.textContent = 'Checking...';
    r.statusBadge.className = 'status-badge status-inactive';

    try {
      const res = await window.api.invoke('ollama-get-status');
      if (res && res.success) {
        applyStatus(res.data);
      } else {
        applyStatus({ running: false, modelAvailable: false, version: null, modelSize: null, installed: false });
      }
    } catch (e) {
      console.error('[Ollama] Status check failed:', e);
      applyStatus({ running: false, modelAvailable: false, version: null, modelSize: null, installed: false });
    }
  }

  // ── Download model ───────────────────────────────────────────────────────────
  async function downloadModel() {
    if (isDownloading) return;
    isDownloading = true;

    const r = refs();
    r.downloadBtn.style.display = 'none';
    r.progressWrap.style.display = '';
    r.progressBar.style.width = '0%';
    r.progressPct.textContent = '0%';
    r.progressText.textContent = 'Starting download...';

    // Listen for progress events
    const cleanup = window.api.receive('ollama-pull-progress', ({ percentage }) => {
      const pct = Math.min(100, percentage || 0);
      r.progressBar.style.width = `${pct}%`;
      r.progressPct.textContent = `${pct}%`;
      r.progressText.textContent = pct < 100 ? 'Downloading model...' : 'Finalizing...';
    });

    try {
      const res = await window.api.invoke('ollama-pull-model');
      if (res && res.success) {
        r.progressText.textContent = 'Download complete!';
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        r.progressText.textContent = `Download failed: ${res?.error || 'Unknown error'}`;
      }
    } catch (e) {
      r.progressText.textContent = `Download failed: ${e.message || e}`;
    } finally {
      isDownloading = false;
      r.progressWrap.style.display = 'none';
      cleanup();
      await refreshStatus();
    }
  }

  // ── Test inference ───────────────────────────────────────────────────────────
  async function testInference() {
    const r = refs();
    r.testResult.style.display = '';
    r.testResult.textContent = 'Running test inference with a sample image...';
    r.testBtn.disabled = true;

    try {
      // Use a tiny 1x1 white pixel PNG as the test image
      const testImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';
      const res = await window.api.invoke('ollama-analyze-image', {
        imageBase64: testImage,
        prompt: 'Text Recognition:',
      });

      if (res && res.success) {
        const result = res.data;
        r.testResult.textContent =
          `OK — ${result.processing_time_ms}ms\n` +
          `Numbers found: ${result.vehicles.length}\n` +
          `Raw text: "${result.raw_text.substring(0, 200)}"`;
      } else {
        r.testResult.textContent = `Error: ${res?.error || 'Unknown error'}`;
      }
    } catch (e) {
      r.testResult.textContent = `Error: ${e.message || e}`;
    } finally {
      r.testBtn.disabled = false;
    }
  }

  // ── Wire up event listeners ──────────────────────────────────────────────────
  function wireButtons() {
    const r = refs();
    if (!r.refreshBtn) return;

    r.refreshBtn.addEventListener('click', refreshStatus);
    r.downloadBtn.addEventListener('click', downloadModel);
    r.testBtn.addEventListener('click', testInference);
  }

  // ── Init on settings page load ───────────────────────────────────────────────
  function init() {
    wireButtons();
    refreshStatus();
  }

  // Listen for the settings page being loaded by the router
  document.addEventListener('page-loaded', (e) => {
    if (e.detail && e.detail.page === 'settings') {
      init();
    }
  });

  // Also handle direct load if page is already active
  if (document.getElementById('ollama-status-badge')) {
    init();
  }
})();
