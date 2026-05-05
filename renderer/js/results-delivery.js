/**
 * Results Page — Unified Deliver Modal
 *
 * Single "Deliver" button opens a modal with two sections:
 *   1. Send to Gallery (preview images → gallery_images table)
 *   2. Upload HD Originals (full-res → Cloudflare R2, runs in background)
 *
 * Each section is only visible if the user's plan enables it.
 * If only one feature is enabled, the modal shows just that section.
 * The confirm button handles whichever combination is active.
 */
(function () {
  'use strict';

  var planLimits = null;
  var galleries = [];
  var executionId = null;
  // Snapshot of the execution row, populated on modal open.
  // Used to decide whether the preset-rules mode is offered.
  var executionMeta = null; // { project_id, project_name, ... } | null

  // ==================== INIT ====================

  var initAttempts = 0;
  var initInterval = setInterval(function () {
    initAttempts++;
    if (window.logVisualizer && window.logVisualizer.executionId) {
      clearInterval(initInterval);
      executionId = window.logVisualizer.executionId;
      initDeliveryButton();
    } else if (initAttempts > 30) {
      clearInterval(initInterval);
    }
  }, 500);

  async function initDeliveryButton() {
    if (!window.api || !window.api.invoke) return;

    try {
      var result = await window.api.invoke('delivery-get-plan-limits');
      if (!result || !result.success || !result.data) return;
      planLimits = result.data;
    } catch (e) {
      console.warn('[ResultsDelivery] Failed to check plan limits:', e);
      return;
    }

    var hasGallery = !!planLimits.gallery_enabled;
    var hasR2 = !!planLimits.r2_storage_enabled;

    // Show the unified button only if at least one feature is enabled
    if (!hasGallery && !hasR2) return;

    var btnDeliver = document.getElementById('btn-deliver');
    if (btnDeliver) {
      btnDeliver.style.display = '';
      btnDeliver.addEventListener('click', openDeliverModal);
    }

    // Listen for R2 upload events from main process
    if (window.api.receive) {
      window.api.receive('r2-upload-progress', handleR2Progress);
      window.api.receive('r2-upload-complete', handleR2Complete);
    }

    bindModalEvents();
  }

  // ==================== DELIVER MODAL ====================

  async function openDeliverModal() {
    var hasGallery = !!planLimits.gallery_enabled;
    var hasR2 = !!planLimits.r2_storage_enabled;

    // Show/hide sections based on plan
    var gallerySection = document.getElementById('deliver-gallery-section');
    var hdSection = document.getElementById('deliver-hd-section');
    var divider = document.getElementById('deliver-divider');

    if (gallerySection) gallerySection.style.display = hasGallery ? 'block' : 'none';
    if (hdSection) hdSection.style.display = hasR2 ? 'block' : 'none';
    if (divider) divider.style.display = (hasGallery && hasR2) ? 'block' : 'none';

    // Default: HD toggle UNCHECKED. Per product decision (2026-05-04) HD
    // upload must always be an explicit user opt-in for each delivery —
    // never default-on. The user has to flag it intentionally.
    var hdToggle = document.getElementById('deliver-hd-toggle');
    if (hdToggle) hdToggle.checked = false;

    // Reset mode selector state — recomputed below from executionMeta when
    // gallery is enabled and the execution row is loaded.
    var modeSelector = document.getElementById('deliver-mode-selector');
    if (modeSelector) modeSelector.style.display = 'none';
    var modePreset = document.getElementById('deliver-mode-preset');
    if (modePreset) modePreset.checked = true;
    var modeManual = document.getElementById('deliver-mode-manual');
    if (modeManual) modeManual.checked = false;

    // Load galleries if gallery section is visible
    if (hasGallery) {
      try {
        var result = await window.api.invoke('delivery-get-galleries');
        if (result && result.success) galleries = result.data || [];
      } catch (e) {
        galleries = [];
      }

      var select = document.getElementById('results-gallery-select');
      if (select) {
        select.innerHTML = '<option value="">-- Select a gallery --</option>';
        galleries.forEach(function (g) {
          var option = document.createElement('option');
          option.value = g.id;
          option.textContent = g.title + (g.status === 'published' ? ' (published)' : ' (draft)');
          select.appendChild(option);
        });
      }

      var nameInput = document.getElementById('results-new-gallery-name');
      if (nameInput) nameInput.value = '';

      // Show photo count
      var infoDiv = document.getElementById('results-gallery-info');
      if (infoDiv && window.logVisualizer) {
        var total = window.logVisualizer.imageResults ? window.logVisualizer.imageResults.length : 0;
        infoDiv.style.display = 'block';
        infoDiv.innerHTML = '<strong>' + total + ' photos</strong> from this analysis will be delivered.';
      }

      // Load execution metadata to decide whether to offer preset-rules
      // mode. The radio selector appears only when the execution is bound
      // to a client via the participant preset (executions.project_id != null).
      // Without project_id we fall back to the standard manual selector.
      executionMeta = await loadExecutionMeta(executionId);
      applyDeliverMode(executionMeta);
    }

    // Update confirm button text once the mode is known.
    updateConfirmButtonText();

    // Telemetry: DELIVERY_MODAL_OPENED. Premium-feature adoption signal.
    // We always emit this even though it's gated behind feature flags,
    // so we can compute "of users who CAN deliver, how many actually
    // open the modal" — the key conversion funnel for the gallery + R2
    // upgrade tier.
    if (window.logUserAction) {
      window.logUserAction('DELIVERY_MODAL_OPENED', 'VIEW', {
        galleryEnabled: hasGallery,
        r2Enabled: hasR2,
        existingGalleriesCount: galleries.length || 0
      });
    }

    showModal('modal-deliver');
  }

  // ==================== EXECUTION METADATA + DELIVERY MODE ====================

  // Fetch execution metadata via IPC. Returns null on any error so the modal
  // gracefully falls back to the manual selector.
  async function loadExecutionMeta(execId) {
    if (!execId) return null;
    try {
      var res = await window.api.invoke('db-get-execution-by-id', execId);
      if (res && res.success && res.data) return res.data;
    } catch (e) {
      console.warn('[ResultsDelivery] loadExecutionMeta failed:', e);
    }
    return null;
  }

  // Configure visibility of the preset-rules selector based on execution
  // metadata. When project_id is present, show the radio block and default
  // to "preset" mode (manual controls hidden). Otherwise hide the selector
  // and keep the manual controls visible — that's the only path.
  function applyDeliverMode(meta) {
    var modeSelector = document.getElementById('deliver-mode-selector');
    var manualHelp = document.getElementById('deliver-manual-help');
    var manualControls = document.getElementById('deliver-manual-controls');
    var presetInfo = document.getElementById('deliver-preset-info');
    var modePreset = document.getElementById('deliver-mode-preset');
    var modeManual = document.getElementById('deliver-mode-manual');

    var hasProject = !!(meta && meta.project_id);

    if (hasProject) {
      if (modeSelector) modeSelector.style.display = 'block';
      if (presetInfo) {
        var clientLine = meta.project_name
          ? 'Client: <strong>' + escapeHtmlSafe(meta.project_name) + '</strong>. '
          : '';
        presetInfo.innerHTML =
          clientLine +
          'This execution is linked to a client via the preset. Photos will be routed to the matching galleries according to the preset delivery rules.';
      }
      if (modePreset) modePreset.checked = true;
      if (modeManual) modeManual.checked = false;
    } else if (modeSelector) {
      modeSelector.style.display = 'none';
    }

    // Manual controls hidden while preset mode is the active default.
    if (manualHelp) manualHelp.style.display = hasProject ? 'none' : 'block';
    if (manualControls) manualControls.style.display = hasProject ? 'none' : 'flex';
  }

  // Toggle visibility of manual controls when the user switches between the
  // two radios. Called from the radio change handler bound in bindModalEvents.
  function onDeliverModeChange() {
    var manualHelp = document.getElementById('deliver-manual-help');
    var manualControls = document.getElementById('deliver-manual-controls');
    var mode = getDeliverMode();
    var showManual = mode === 'manual';
    if (manualHelp) manualHelp.style.display = showManual ? 'block' : 'none';
    if (manualControls) manualControls.style.display = showManual ? 'flex' : 'none';
    updateConfirmButtonText();
  }

  // Read the currently-selected delivery mode from the radio selector.
  // Returns 'preset' when the preset-rules mode is active, 'manual' otherwise.
  function getDeliverMode() {
    var modeSelector = document.getElementById('deliver-mode-selector');
    if (!modeSelector || modeSelector.style.display === 'none') return 'manual';
    var presetRadio = document.getElementById('deliver-mode-preset');
    return presetRadio && presetRadio.checked ? 'preset' : 'manual';
  }

  // Self-contained HTML escape — keeps the helper module independent of
  // renderer-wide utilities.
  function escapeHtmlSafe(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateConfirmButtonText() {
    var btnConfirm = document.getElementById('btn-deliver-confirm');
    if (!btnConfirm) return;

    var hasGallery = !!planLimits.gallery_enabled;
    var hasR2 = !!planLimits.r2_storage_enabled;
    var hdToggle = document.getElementById('deliver-hd-toggle');
    var hdChecked = hdToggle && hdToggle.checked;
    var mode = getDeliverMode();

    if (hasGallery && mode === 'preset' && hasR2 && hdChecked) {
      btnConfirm.textContent = 'Apply Preset Rules + Upload HD';
    } else if (hasGallery && mode === 'preset') {
      btnConfirm.textContent = 'Apply Preset Rules';
    } else if (hasGallery && hasR2 && hdChecked) {
      btnConfirm.textContent = 'Send to Gallery + Upload HD';
    } else if (hasGallery && (!hasR2 || !hdChecked)) {
      btnConfirm.textContent = 'Send to Gallery';
    } else if (!hasGallery && hasR2) {
      btnConfirm.textContent = 'Upload HD Originals';
    } else {
      btnConfirm.textContent = 'Deliver';
    }
  }

  // ==================== CONFIRM ACTION ====================

  async function handleDeliver() {
    var hasGallery = !!planLimits.gallery_enabled;
    var hasR2 = !!planLimits.r2_storage_enabled;
    var hdToggle = document.getElementById('deliver-hd-toggle');
    var wantsHD = hasR2 && hdToggle && hdToggle.checked;
    var mode = getDeliverMode();
    var usingPresetRules = hasGallery && mode === 'preset';

    // Validate input depending on mode.
    var galleryId = null;
    if (hasGallery && !usingPresetRules) {
      var select = document.getElementById('results-gallery-select');
      galleryId = select ? select.value : '';
      if (!galleryId) {
        alert('Please select a gallery first.');
        return;
      }
    }

    // Preset mode requires the execution to actually have a project_id.
    // Defensive check: this should always be true when the radio is shown,
    // but we re-validate to avoid sending an invalid request.
    if (usingPresetRules && (!executionMeta || !executionMeta.project_id)) {
      alert('This execution is not linked to a client project — cannot apply preset rules.');
      return;
    }

    if (!executionId) {
      alert('No execution found.');
      return;
    }

    var btnConfirm = document.getElementById('btn-deliver-confirm');
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Delivering...';
    }

    var gallerySent = false;
    var hdStarted = false;

    try {
      // Step 1: Send to gallery (if enabled).
      // Two paths:
      //  - Preset mode: invoke `delivery-auto-route` to apply the preset's
      //    delivery_rules. Photos are routed to the matching client galleries
      //    according to the rules attached to the preset.
      //  - Manual mode: invoke `delivery-send-execution-to-gallery` against
      //    the gallery the user picked from the dropdown.
      if (hasGallery && usingPresetRules) {
        var routeResult = await window.api.invoke('delivery-auto-route', {
          projectId: executionMeta.project_id,
          executionId: executionId,
        });

        if (routeResult && routeResult.success && routeResult.data) {
          var routedCount = routeResult.data.routed || 0;
          var galleriesCount = routeResult.data.galleriesCount || 0;
          var unmatched = routeResult.data.unmatched || 0;
          gallerySent = routedCount > 0;

          if (window.logUserAction) {
            window.logUserAction('DELIVERY_PREVIEW_SENT', 'DELIVERY', {
              mode: 'preset_rules',
              projectId: executionMeta.project_id,
              previewImageCount: routedCount,
              galleriesCount: galleriesCount,
              unmatched: unmatched,
              wantsHD: !!wantsHD
            });
          }

          if (routedCount > 0) {
            showToast('Routed ' + routedCount + ' photos to ' + galleriesCount + ' galleries.', 'success');
          } else {
            showToast('No photos matched the preset delivery rules.', 'error');
          }
        } else {
          alert('Error applying preset rules: ' + (routeResult ? routeResult.error : 'Unknown'));
          resetConfirmButton();
          return;
        }
      } else if (hasGallery && galleryId) {
        var galleryResult = await window.api.invoke('delivery-send-execution-to-gallery', {
          galleryId: galleryId,
          executionId: executionId,
        });

        if (galleryResult && galleryResult.success) {
          var added = galleryResult.data ? galleryResult.data.added : 0;
          gallerySent = true;
          // Telemetry: DELIVERY_PREVIEW_SENT. Tracks the conversion from
          // "modal opened" to "gallery actually delivered". galleryId is
          // an opaque ID, NOT the title (which would expose client names).
          if (window.logUserAction) {
            window.logUserAction('DELIVERY_PREVIEW_SENT', 'DELIVERY', {
              mode: 'manual',
              galleryId: galleryId,
              previewImageCount: added,
              wantsHD: !!wantsHD
            });
          }
          showToast('Sent ' + added + ' photos to gallery!', 'success');
        } else {
          alert('Error sending to gallery: ' + (galleryResult ? galleryResult.error : 'Unknown'));
          resetConfirmButton();
          return;
        }
      }

      // Step 2: Start R2 upload in background (if enabled and checked)
      if (wantsHD) {
        var r2Result = await window.api.invoke('delivery-r2-upload-start', executionId);
        if (r2Result && r2Result.success) {
          var queued = r2Result.data ? r2Result.data.queued : 0;
          var r2Error = r2Result.data ? r2Result.data.error : null;
          if (queued > 0) {
            hdStarted = true;
            // Telemetry: R2_UPLOAD_STARTED. The HD upload is async on the
            // main process — completion fires R2_UPLOAD_COMPLETED via
            // handleR2Complete below. Pairing both lets us measure the
            // failure rate and queue-to-completion duration.
            if (window.logUserAction) {
              window.logUserAction('R2_UPLOAD_STARTED', 'DELIVERY', {
                fileCount: queued
              });
            }
            showR2Banner(queued);
          } else if (r2Error) {
            // Source folder missing or files not found — show actionable message
            console.warn('[ResultsDelivery] R2 upload:', r2Error);
            showToast(r2Error, 'error');
          } else {
            showToast('HD originals already uploaded.', 'success');
          }
        } else {
          // Don't block — gallery was already sent successfully
          console.warn('[ResultsDelivery] R2 upload error:', r2Result ? r2Result.error : 'Unknown');
          showToast('Gallery sent, but HD upload failed to start.', 'error');
        }
      }

      // Close modal
      hideModal('modal-deliver');

      // Summary toast if both actions happened
      if (gallerySent && hdStarted) {
        // Gallery toast already shown; R2 progress banner is visible
      }

    } catch (e) {
      alert('Error during delivery.');
      console.error('[ResultsDelivery] Deliver error:', e);
    } finally {
      resetConfirmButton();
    }
  }

  function resetConfirmButton() {
    var btnConfirm = document.getElementById('btn-deliver-confirm');
    if (btnConfirm) {
      btnConfirm.disabled = false;
      updateConfirmButtonText();
    }
  }

  // ==================== GALLERY INLINE CREATE ====================

  async function createGalleryInline() {
    var nameInput = document.getElementById('results-new-gallery-name');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      alert('Please enter a gallery name.');
      return;
    }

    var btnCreate = document.getElementById('btn-results-create-gallery');
    if (btnCreate) {
      btnCreate.disabled = true;
      btnCreate.textContent = 'Creating...';
    }

    try {
      var result = await window.api.invoke('delivery-create-gallery', {
        title: name,
        access_type: 'unrestricted',
        gallery_type: 'open',
      });

      if (result && result.success && result.data) {
        galleries.push(result.data);
        var select = document.getElementById('results-gallery-select');
        if (select) {
          var option = document.createElement('option');
          option.value = result.data.id;
          option.textContent = result.data.title + ' (draft)';
          select.appendChild(option);
          select.value = result.data.id;
        }
        if (nameInput) nameInput.value = '';
        showToast('Gallery "' + name + '" created!', 'success');
      } else {
        alert('Error: ' + (result ? result.error : 'Unknown'));
      }
    } catch (e) {
      alert('Error creating gallery.');
      console.error('[ResultsDelivery] Create gallery error:', e);
    } finally {
      if (btnCreate) {
        btnCreate.disabled = false;
        btnCreate.textContent = '+ Create';
      }
    }
  }

  // ==================== R2 UPLOAD PROGRESS ====================

  function showR2Banner(queued) {
    var banner = document.getElementById('r2-upload-banner');
    if (banner) banner.style.display = 'block';
    var statusEl = document.getElementById('r2-upload-status');
    if (statusEl) statusEl.textContent = queued + ' files queued for upload...';
    var progressBar = document.getElementById('r2-upload-progress-bar');
    if (progressBar) progressBar.style.width = '0%';
  }

  function handleR2Progress(data) {
    if (!data || !data.progress) return;

    var progressBar = document.getElementById('r2-upload-progress-bar');
    var statusEl = document.getElementById('r2-upload-status');

    if (progressBar) {
      progressBar.style.width = data.progress.percentage + '%';
    }
    if (statusEl) {
      statusEl.textContent =
        data.progress.completed + '/' + data.progress.total + ' uploaded' +
        (data.progress.failed > 0 ? ' (' + data.progress.failed + ' failed)' : '');
    }
  }

  function handleR2Complete(data) {
    var progressBar = document.getElementById('r2-upload-progress-bar');
    var statusEl = document.getElementById('r2-upload-status');
    var banner = document.getElementById('r2-upload-banner');

    if (progressBar) progressBar.style.width = '100%';
    if (statusEl) {
      statusEl.textContent =
        'Complete! ' + (data.completed || 0) + ' uploaded' +
        (data.failed > 0 ? ', ' + data.failed + ' failed' : '');
    }

    // Telemetry: R2_UPLOAD_COMPLETED. Pairs with R2_UPLOAD_STARTED to
    // measure the success rate and total-byte/duration distribution of
    // HD uploads — direct input to the R2 storage cost model.
    if (window.logUserAction) {
      window.logUserAction('R2_UPLOAD_COMPLETED', 'DELIVERY', {
        completed: data.completed || 0,
        failed: data.failed || 0,
        totalBytes: typeof data.totalBytes === 'number' ? data.totalBytes : null,
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : null
      });
    }

    showToast((data.completed || 0) + ' HD originals uploaded to cloud!', 'success');

    setTimeout(function () {
      if (banner) banner.style.display = 'none';
    }, 5000);
  }

  // ==================== EVENT BINDING ====================

  function bindModalEvents() {
    // Confirm
    var btnConfirm = document.getElementById('btn-deliver-confirm');
    if (btnConfirm) btnConfirm.addEventListener('click', handleDeliver);

    // Cancel
    var btnCancel = document.getElementById('btn-deliver-cancel');
    if (btnCancel) btnCancel.addEventListener('click', function () { hideModal('modal-deliver'); });

    // Create gallery inline
    var btnCreate = document.getElementById('btn-results-create-gallery');
    if (btnCreate) btnCreate.addEventListener('click', createGalleryInline);

    // HD toggle → update button text
    var hdToggle = document.getElementById('deliver-hd-toggle');
    if (hdToggle) hdToggle.addEventListener('change', updateConfirmButtonText);

    // Mode radios (preset / manual) → toggle visibility of manual controls
    // and refresh the confirm button label.
    var modePreset = document.getElementById('deliver-mode-preset');
    if (modePreset) modePreset.addEventListener('change', onDeliverModeChange);
    var modeManual = document.getElementById('deliver-mode-manual');
    if (modeManual) modeManual.addEventListener('change', onDeliverModeChange);

    // Backdrop close
    var modal = document.getElementById('modal-deliver');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) hideModal('modal-deliver');
      });
    }

    // R2 cancel button (on progress banner)
    var btnR2Cancel = document.getElementById('btn-r2-cancel');
    if (btnR2Cancel) {
      btnR2Cancel.addEventListener('click', function () {
        window.api.invoke('delivery-r2-upload-cancel').catch(function () {});
        var banner = document.getElementById('r2-upload-banner');
        if (banner) banner.style.display = 'none';
      });
    }
  }

  // ==================== UTILS ====================

  function showModal(id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'flex';
  }

  function hideModal(id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'none';
  }

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.style.cssText =
      'position: fixed; top: 24px; right: 24px; z-index: 9999; padding: 12px 20px; ' +
      'border-radius: 10px; font-size: 13px; font-weight: 600; color: white; ' +
      'box-shadow: 0 4px 20px rgba(0,0,0,0.3); transition: opacity 0.3s; ' +
      (type === 'success'
        ? 'background: linear-gradient(135deg, #10b981, #059669);'
        : 'background: linear-gradient(135deg, #ef4444, #dc2626);');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 4000);
  }
})();
