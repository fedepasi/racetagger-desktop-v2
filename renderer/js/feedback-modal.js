/**
 * Feedback Modal Module
 *
 * IIFE that creates a feedback modal for submitting bug reports,
 * feature requests, and general feedback to GitHub Issues.
 */
(function () {
  'use strict';

  const FEEDBACK_TYPES = {
    bug: { label: 'Bug Report', icon: '!' },
    feature: { label: 'Feature Request', icon: '+' },
    general: { label: 'General Feedback', icon: '?' },
  };

  const TITLE_MAX = 200;
  const DESC_MAX = 5000;

  let modal = null;
  let currentType = 'bug';
  let diagnosticsData = null;
  let isSubmitting = false;

  // ==================== Modal Creation ====================

  function createModal() {
    if (modal) return;

    const overlay = document.createElement('div');
    overlay.className = 'feedback-modal-overlay';
    overlay.id = 'feedback-modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    overlay.innerHTML = `
      <div class="feedback-modal">
        <div class="feedback-modal-header">
          <h2>Send Feedback</h2>
          <button class="feedback-modal-close" id="feedback-close-btn">&times;</button>
        </div>

        <div class="feedback-tabs" id="feedback-tabs">
          <button class="feedback-tab active" data-type="bug">Bug Report</button>
          <button class="feedback-tab" data-type="feature">Feature Request</button>
          <button class="feedback-tab" data-type="general">General</button>
        </div>

        <div class="feedback-modal-body" id="feedback-body">
          <!-- Form State -->
          <div id="feedback-form-state">
            <div class="feedback-form-group">
              <label for="feedback-title">Title</label>
              <input type="text" id="feedback-title" maxlength="${TITLE_MAX}" placeholder="Brief summary of your feedback">
              <div class="feedback-char-count" id="feedback-title-count">0 / ${TITLE_MAX}</div>
            </div>

            <div class="feedback-form-group">
              <label for="feedback-description">Description</label>
              <textarea id="feedback-description" maxlength="${DESC_MAX}" placeholder="Provide details..."></textarea>
              <div class="feedback-char-count" id="feedback-desc-count">0 / ${DESC_MAX}</div>
            </div>

            <div class="feedback-diagnostics-section">
              <label class="feedback-diagnostics-toggle">
                <input type="checkbox" id="feedback-include-diagnostics" checked>
                Include system diagnostics
              </label>
            </div>
          </div>

          <!-- Success State -->
          <div id="feedback-success-state" style="display: none;">
            <div class="feedback-result">
              <div class="feedback-result-icon">&#10003;</div>
              <h3>Feedback Submitted</h3>
              <p>Thank you! Your feedback has been received.</p>
            </div>
          </div>

          <!-- Error State -->
          <div id="feedback-error-state" style="display: none;">
            <div class="feedback-result">
              <div class="feedback-result-icon" style="color: var(--accent-danger, #ef4444);">&#10007;</div>
              <h3>Submission Failed</h3>
              <p class="feedback-result-error" id="feedback-error-message"></p>
            </div>
          </div>

          <!-- Auth Warning -->
          <div id="feedback-auth-warning" style="display: none;">
            <div class="feedback-auth-warning">
              Please log in to submit feedback.
            </div>
          </div>
        </div>

        <div class="feedback-modal-footer" id="feedback-footer">
          <button class="feedback-btn feedback-btn-secondary" id="feedback-cancel-btn">Cancel</button>
          <button class="feedback-btn feedback-btn-primary" id="feedback-submit-btn">Submit</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    modal = overlay;

    // Wire events
    document.getElementById('feedback-close-btn').addEventListener('click', closeModal);
    document.getElementById('feedback-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('feedback-submit-btn').addEventListener('click', handleSubmit);

    // Tabs
    document.getElementById('feedback-tabs').addEventListener('click', function (e) {
      const tab = e.target.closest('.feedback-tab');
      if (!tab || isSubmitting) return;
      document.querySelectorAll('.feedback-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      currentType = tab.dataset.type;
      updatePlaceholders();
    });

    // Character counters
    var titleInput = document.getElementById('feedback-title');
    var descInput = document.getElementById('feedback-description');

    titleInput.addEventListener('input', function () {
      updateCharCount('feedback-title-count', titleInput.value.length, TITLE_MAX);
    });

    descInput.addEventListener('input', function () {
      updateCharCount('feedback-desc-count', descInput.value.length, DESC_MAX);
    });

    // Escape key
    document.addEventListener('keydown', handleEscKey);
  }

  function handleEscKey(e) {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      closeModal();
    }
  }

  // ==================== Helpers ====================

  function updateCharCount(elementId, current, max) {
    var el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = current + ' / ' + max;
    el.className = 'feedback-char-count';
    if (current >= max) {
      el.classList.add('at-limit');
    } else if (current >= max * 0.85) {
      el.classList.add('near-limit');
    }
  }

  function updatePlaceholders() {
    var titleInput = document.getElementById('feedback-title');
    var descInput = document.getElementById('feedback-description');
    if (!titleInput || !descInput) return;

    if (currentType === 'bug') {
      titleInput.placeholder = 'e.g. App crashes when processing RAW files';
      descInput.placeholder = 'What happened? What did you expect? Steps to reproduce...';
    } else if (currentType === 'feature') {
      titleInput.placeholder = 'e.g. Add batch export to Lightroom';
      descInput.placeholder = 'Describe the feature you would like and why it would be useful...';
    } else {
      titleInput.placeholder = 'Brief summary of your feedback';
      descInput.placeholder = 'Share your thoughts, suggestions, or comments...';
    }
  }

  // ==================== Diagnostics Loading ====================

  async function loadDiagnostics() {
    var contentEl = document.getElementById('feedback-diagnostics-content');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="feedback-diagnostics-loading">Loading diagnostics...</div>';

    try {
      var results = await Promise.all([
        window.api.invoke('get-system-diagnostics'),
        window.api.invoke('get-dependency-status'),
        window.api.invoke('get-recent-errors'),
      ]);

      diagnosticsData = {
        system: results[0],
        dependencies: results[1],
        recentErrors: results[2],
      };

      var lines = [];

      // System info
      var sys = diagnosticsData.system;
      lines.push('-- System --');
      lines.push('App: v' + sys.appVersion + '  Electron: ' + sys.electronVersion + '  Node: ' + sys.nodeVersion);
      lines.push('OS: ' + sys.os + ' ' + sys.osVersion + ' (' + sys.arch + ')');
      lines.push('CPU: ' + sys.cpu + ' (' + sys.cpuCores + 'C/' + sys.cpuThreads + 'T)');
      lines.push('RAM: ' + sys.ramAvailable + '/' + sys.ramTotal + ' GB');
      if (sys.gpu) lines.push('GPU: ' + sys.gpu);
      lines.push('Disk: ' + sys.diskType + ' ' + sys.diskAvailable + '/' + sys.diskTotal + ' GB');

      // Dependencies
      lines.push('');
      lines.push('-- Dependencies --');
      diagnosticsData.dependencies.forEach(function (dep) {
        var status = dep.working ? 'OK' : (dep.exists ? 'EXISTS (not working)' : 'MISSING');
        lines.push(dep.name + ': ' + status + (dep.error ? ' [' + dep.error + ']' : ''));
      });

      // Recent errors
      if (diagnosticsData.recentErrors.length > 0) {
        lines.push('');
        lines.push('-- Recent Errors (' + diagnosticsData.recentErrors.length + ') --');
        diagnosticsData.recentErrors.slice(0, 5).forEach(function (err) {
          lines.push('[' + err.severity + '/' + err.category + '] ' + err.message);
        });
      } else {
        lines.push('');
        lines.push('-- No recent errors --');
      }

      contentEl.textContent = lines.join('\n');
    } catch (err) {
      contentEl.textContent = 'Failed to load diagnostics: ' + (err.message || err);
      diagnosticsData = null;
    }
  }

  // ==================== Submit ====================

  async function handleSubmit() {
    if (isSubmitting) return;

    var titleInput = document.getElementById('feedback-title');
    var descInput = document.getElementById('feedback-description');
    var includeDiag = document.getElementById('feedback-include-diagnostics');
    var submitBtn = document.getElementById('feedback-submit-btn');

    var title = titleInput.value.trim();
    var description = descInput.value.trim();

    if (!title) {
      titleInput.focus();
      return;
    }
    if (!description) {
      descInput.focus();
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="feedback-spinner"></span>Submitting...';

    try {
      var submission = {
        type: currentType,
        title: title,
        description: description,
        includeDiagnostics: includeDiag.checked,
      };

      if (includeDiag.checked && diagnosticsData) {
        submission.diagnostics = diagnosticsData;
      }

      var result = await window.api.invoke('submit-support-feedback', submission);

      if (result && result.success) {
        showSuccess();
      } else {
        showError(result ? result.error : 'Unknown error');
      }
    } catch (err) {
      showError(err.message || 'Failed to submit feedback');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  }

  function showSuccess() {
    document.getElementById('feedback-form-state').style.display = 'none';
    document.getElementById('feedback-error-state').style.display = 'none';
    document.getElementById('feedback-success-state').style.display = 'block';

    // Change footer to just a Close button
    var footer = document.getElementById('feedback-footer');
    footer.innerHTML = '<button class="feedback-btn feedback-btn-secondary" onclick="closeFeedbackModal()">Close</button>';
  }

  function showError(message) {
    document.getElementById('feedback-form-state').style.display = 'none';
    document.getElementById('feedback-success-state').style.display = 'none';
    document.getElementById('feedback-error-state').style.display = 'block';

    document.getElementById('feedback-error-message').textContent = message;

    // Change footer to Back + Retry
    var footer = document.getElementById('feedback-footer');
    footer.innerHTML =
      '<button class="feedback-btn feedback-btn-secondary" id="feedback-back-btn">Back</button>' +
      '<button class="feedback-btn feedback-btn-primary" id="feedback-retry-btn">Try Again</button>';

    document.getElementById('feedback-back-btn').addEventListener('click', resetToForm);
    document.getElementById('feedback-retry-btn').addEventListener('click', function () {
      resetToForm();
      handleSubmit();
    });
  }

  function resetToForm() {
    document.getElementById('feedback-form-state').style.display = 'block';
    document.getElementById('feedback-success-state').style.display = 'none';
    document.getElementById('feedback-error-state').style.display = 'none';

    var footer = document.getElementById('feedback-footer');
    footer.innerHTML =
      '<button class="feedback-btn feedback-btn-secondary" id="feedback-cancel-btn">Cancel</button>' +
      '<button class="feedback-btn feedback-btn-primary" id="feedback-submit-btn">Submit</button>';

    document.getElementById('feedback-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('feedback-submit-btn').addEventListener('click', handleSubmit);
  }

  // ==================== Open / Close ====================

  async function openModal() {
    createModal();

    // Reset state
    currentType = 'bug';
    isSubmitting = false;
    diagnosticsData = null;

    // Reset form
    var titleInput = document.getElementById('feedback-title');
    var descInput = document.getElementById('feedback-description');
    if (titleInput) titleInput.value = '';
    if (descInput) descInput.value = '';
    updateCharCount('feedback-title-count', 0, TITLE_MAX);
    updateCharCount('feedback-desc-count', 0, DESC_MAX);

    // Reset tabs
    document.querySelectorAll('.feedback-tab').forEach(function (t) { t.classList.remove('active'); });
    var bugTab = document.querySelector('.feedback-tab[data-type="bug"]');
    if (bugTab) bugTab.classList.add('active');

    // Reset diagnostics checkbox
    var diagCheckbox = document.getElementById('feedback-include-diagnostics');
    if (diagCheckbox) diagCheckbox.checked = true;

    // Reset view states
    resetToForm();

    // Show modal, hide FAB
    modal.style.display = 'flex';
    var fab = document.getElementById('feedback-fab');
    if (fab) fab.style.display = 'none';
    updatePlaceholders();

    // Check auth
    try {
      var authStatus = await window.api.invoke('check-auth-status');
      if (!authStatus || !authStatus.isAuthenticated) {
        document.getElementById('feedback-form-state').style.display = 'none';
        document.getElementById('feedback-auth-warning').style.display = 'block';
        document.getElementById('feedback-submit-btn').disabled = true;
        return;
      }
    } catch (e) {
      // If auth check fails, still allow showing the form
    }

    document.getElementById('feedback-auth-warning').style.display = 'none';
    document.getElementById('feedback-submit-btn').disabled = false;

    // Load diagnostics in background
    loadDiagnostics();
  }

  function closeModal() {
    if (modal) {
      modal.style.display = 'none';
    }
    var fab = document.getElementById('feedback-fab');
    if (fab) fab.style.display = 'flex';
  }

  // ==================== Global API ====================

  window.openFeedbackModal = openModal;
  window.closeFeedbackModal = closeModal;
})();
