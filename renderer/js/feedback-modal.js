/**
 * Unified Support Modal (v1.2.0)
 *
 * Single support tool that replaces both "Send Feedback" and "Send Diagnostics".
 * When submitted:
 * 1. Creates GitHub Issue with user feedback + basic diagnostics
 * 2. Background: uploads full diagnostic report (incl. 1000 lines of main process logs)
 *    to Supabase Storage + sends admin email notification
 *
 * User only sees: title + description + type tabs → Submit
 * Full diagnostics are ALWAYS collected and uploaded automatically.
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

    var overlay = document.createElement('div');
    overlay.className = 'feedback-modal-overlay';
    overlay.id = 'feedback-modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    overlay.innerHTML = `
      <div class="feedback-modal">
        <div class="feedback-modal-header">
          <h2>Support</h2>
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
              <label for="feedback-title">Title <span class="feedback-required">*</span></label>
              <input type="text" id="feedback-title" maxlength="${TITLE_MAX}" placeholder="Brief summary of your feedback" required>
              <div class="feedback-char-count" id="feedback-title-count">0 / ${TITLE_MAX}</div>
            </div>

            <div class="feedback-form-group">
              <label for="feedback-description">Description <span class="feedback-required">*</span></label>
              <textarea id="feedback-description" maxlength="${DESC_MAX}" placeholder="Provide details..." required></textarea>
              <div class="feedback-char-count" id="feedback-desc-count">0 / ${DESC_MAX}</div>
            </div>
          </div>

          <!-- Success State -->
          <div id="feedback-success-state" style="display: none;">
            <div class="feedback-result">
              <div class="feedback-result-icon">&#10003;</div>
              <h3>Report Sent</h3>
              <p>Thank you! Your feedback and full system diagnostics have been received.</p>
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
      var tab = e.target.closest('.feedback-tab');
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
      titleInput.classList.remove('feedback-input-error');
    });

    descInput.addEventListener('input', function () {
      updateCharCount('feedback-desc-count', descInput.value.length, DESC_MAX);
      descInput.classList.remove('feedback-input-error');
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

  // ==================== Diagnostics Loading (for GitHub Issue body) ====================

  async function loadDiagnostics() {
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
    } catch (err) {
      console.warn('[Support] Failed to pre-load diagnostics:', err);
      diagnosticsData = null;
    }
  }

  // ==================== Submit ====================

  async function handleSubmit() {
    if (isSubmitting) return;

    var titleInput = document.getElementById('feedback-title');
    var descInput = document.getElementById('feedback-description');
    var submitBtn = document.getElementById('feedback-submit-btn');

    var title = titleInput.value.trim();
    var description = descInput.value.trim();

    // Clear previous validation states
    titleInput.classList.remove('feedback-input-error');
    descInput.classList.remove('feedback-input-error');

    if (!title) {
      titleInput.classList.add('feedback-input-error');
      titleInput.focus();
      return;
    }
    if (!description) {
      descInput.classList.add('feedback-input-error');
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
        includeDiagnostics: true,  // Always include
      };

      // Attach basic diagnostics for GitHub Issue body
      if (diagnosticsData) {
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

    // Reset view states
    resetToForm();

    // Show modal, hide FAB wrapper
    modal.style.display = 'flex';
    var fabWrapper = document.getElementById('feedback-fab-wrapper');
    if (fabWrapper) fabWrapper.style.display = 'none';
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

    // Load basic diagnostics in background (for GitHub Issue body)
    loadDiagnostics();
  }

  function closeModal() {
    if (modal) {
      modal.style.display = 'none';
    }
    var fabWrapper = document.getElementById('feedback-fab-wrapper');
    if (fabWrapper) fabWrapper.style.display = 'flex';
  }

  // ==================== FAB First-Time Tooltip ====================

  function initFabTooltip() {
    var tooltip = document.getElementById('feedback-fab-tooltip');
    var closeBtn = document.getElementById('feedback-fab-tooltip-close');
    if (!tooltip || !closeBtn) return;

    var STORAGE_KEY = 'racetagger_fab_tooltip_dismissed';

    // Check if already dismissed
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch (e) {
      // localStorage not available, show anyway
    }

    // Show tooltip after a short delay (let the app load first)
    setTimeout(function () {
      tooltip.classList.add('visible');
    }, 2000);

    // Dismiss on X click
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dismissTooltip();
    });

    // Also dismiss when FAB is clicked (opening the modal)
    var fab = document.getElementById('feedback-fab');
    if (fab) {
      fab.addEventListener('click', function () {
        dismissTooltip();
      });
    }

    function dismissTooltip() {
      tooltip.classList.remove('visible');
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch (e) {
        // Ignore
      }
    }
  }

  // Init tooltip when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFabTooltip);
  } else {
    initFabTooltip();
  }

  // ==================== Global API ====================

  window.openFeedbackModal = openModal;
  window.closeFeedbackModal = closeModal;
})();
