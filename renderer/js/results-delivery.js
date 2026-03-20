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

    // Default: HD toggle checked when available
    var hdToggle = document.getElementById('deliver-hd-toggle');
    if (hdToggle) hdToggle.checked = true;

    // Update confirm button text based on visible options
    updateConfirmButtonText();

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
    }

    showModal('modal-deliver');
  }

  function updateConfirmButtonText() {
    var btnConfirm = document.getElementById('btn-deliver-confirm');
    if (!btnConfirm) return;

    var hasGallery = !!planLimits.gallery_enabled;
    var hasR2 = !!planLimits.r2_storage_enabled;
    var hdToggle = document.getElementById('deliver-hd-toggle');
    var hdChecked = hdToggle && hdToggle.checked;

    if (hasGallery && hasR2 && hdChecked) {
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

    // Validate gallery selection if gallery section is active
    var galleryId = null;
    if (hasGallery) {
      var select = document.getElementById('results-gallery-select');
      galleryId = select ? select.value : '';
      if (!galleryId) {
        alert('Please select a gallery first.');
        return;
      }
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
      // Step 1: Send to gallery (if enabled)
      if (hasGallery && galleryId) {
        var galleryResult = await window.api.invoke('delivery-send-execution-to-gallery', {
          galleryId: galleryId,
          executionId: executionId,
        });

        if (galleryResult && galleryResult.success) {
          var added = galleryResult.data ? galleryResult.data.added : 0;
          gallerySent = true;
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
