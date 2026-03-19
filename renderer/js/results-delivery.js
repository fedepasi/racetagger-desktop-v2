/**
 * Results Page — Delivery Integration
 *
 * Adds "Send to Gallery" and "Upload HD" buttons to the results page.
 * Buttons are only visible if the user's plan enables gallery/delivery features.
 * Handles gallery picker modal, inline gallery creation, R2 upload trigger, and progress.
 */
(function () {
  'use strict';

  let planLimits = null;
  let galleries = [];
  let executionId = null;

  // ==================== INIT ====================

  // Wait for results page to be fully loaded (ResultsPageManager sets window.logVisualizer)
  var initAttempts = 0;
  var initInterval = setInterval(function () {
    initAttempts++;
    if (window.logVisualizer && window.logVisualizer.executionId) {
      clearInterval(initInterval);
      executionId = window.logVisualizer.executionId;
      initDeliveryButtons();
    } else if (initAttempts > 30) {
      clearInterval(initInterval); // Give up after 15 seconds
    }
  }, 500);

  async function initDeliveryButtons() {
    if (!window.api || !window.api.invoke) return;

    try {
      var result = await window.api.invoke('delivery-get-plan-limits');
      if (!result || !result.success || !result.data) return;
      planLimits = result.data;
    } catch (e) {
      console.warn('[ResultsDelivery] Failed to check plan limits:', e);
      return;
    }

    // Show "Send to Gallery" if gallery is enabled
    if (planLimits.gallery_enabled) {
      var btnGallery = document.getElementById('btn-send-to-gallery');
      if (btnGallery) {
        btnGallery.style.display = '';
        btnGallery.addEventListener('click', openGalleryModal);
      }
    }

    // Show "Upload HD" if R2 storage is enabled
    if (planLimits.r2_storage_enabled) {
      var btnR2 = document.getElementById('btn-r2-upload');
      if (btnR2) {
        btnR2.style.display = '';
        btnR2.addEventListener('click', startR2Upload);
      }
    }

    // Listen for R2 upload events from main process
    if (window.api.receive) {
      window.api.receive('r2-upload-progress', handleR2Progress);
      window.api.receive('r2-upload-complete', handleR2Complete);
    }

    bindModalEvents();
  }

  // ==================== GALLERY MODAL ====================

  async function openGalleryModal() {
    // Load galleries
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

    // Clear new gallery input
    var nameInput = document.getElementById('results-new-gallery-name');
    if (nameInput) nameInput.value = '';

    // Show total photos count
    var infoDiv = document.getElementById('results-gallery-info');
    if (infoDiv && window.logVisualizer) {
      var total = window.logVisualizer.imageResults ? window.logVisualizer.imageResults.length : 0;
      infoDiv.style.display = 'block';
      infoDiv.innerHTML = '<strong>' + total + ' photos</strong> from this analysis will be sent to the selected gallery.';
    }

    showModal('modal-results-gallery');
  }

  async function sendToGallery() {
    var select = document.getElementById('results-gallery-select');
    var galleryId = select ? select.value : '';

    if (!galleryId) {
      alert('Please select a gallery first.');
      return;
    }

    if (!executionId) {
      alert('No execution found.');
      return;
    }

    var btnSend = document.getElementById('btn-results-gallery-send');
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = 'Sending...';
    }

    try {
      var result = await window.api.invoke('delivery-send-execution-to-gallery', {
        galleryId: galleryId,
        executionId: executionId,
      });

      if (result && result.success) {
        var added = result.data ? result.data.added : 0;
        hideModal('modal-results-gallery');
        showToast('Sent ' + added + ' photos to gallery!', 'success');
      } else {
        alert('Error: ' + (result ? result.error : 'Unknown'));
      }
    } catch (e) {
      alert('Error sending photos to gallery.');
      console.error('[ResultsDelivery] Send error:', e);
    } finally {
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.textContent = 'Send All Photos';
      }
    }
  }

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
        // Add to galleries array and select it
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

  // ==================== R2 UPLOAD ====================

  async function startR2Upload() {
    if (!executionId) {
      alert('No execution found.');
      return;
    }

    var btnR2 = document.getElementById('btn-r2-upload');
    if (btnR2) {
      btnR2.disabled = true;
      btnR2.textContent = '☁️ Uploading...';
    }

    // Show progress banner
    var banner = document.getElementById('r2-upload-banner');
    if (banner) banner.style.display = 'block';

    var statusEl = document.getElementById('r2-upload-status');
    if (statusEl) statusEl.textContent = 'Starting upload...';

    try {
      var result = await window.api.invoke('delivery-r2-upload-start', executionId);
      if (result && result.success) {
        var queued = result.data ? result.data.queued : 0;
        if (queued === 0) {
          if (statusEl) statusEl.textContent = 'No images to upload (already uploaded or not available).';
          if (btnR2) {
            btnR2.disabled = false;
            btnR2.textContent = '☁️ Upload HD';
          }
          setTimeout(function () {
            if (banner) banner.style.display = 'none';
          }, 3000);
        } else {
          if (statusEl) statusEl.textContent = queued + ' files queued for upload...';
        }
      } else {
        alert('Error: ' + (result ? result.error : 'Unknown'));
        if (btnR2) {
          btnR2.disabled = false;
          btnR2.textContent = '☁️ Upload HD';
        }
        if (banner) banner.style.display = 'none';
      }
    } catch (e) {
      alert('Error starting upload.');
      console.error('[ResultsDelivery] R2 upload error:', e);
      if (btnR2) {
        btnR2.disabled = false;
        btnR2.textContent = '☁️ Upload HD';
      }
      if (banner) banner.style.display = 'none';
    }
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
    var btnR2 = document.getElementById('btn-r2-upload');

    if (progressBar) progressBar.style.width = '100%';
    if (statusEl) {
      statusEl.textContent =
        'Complete! ' + (data.completed || 0) + ' uploaded' +
        (data.failed > 0 ? ', ' + data.failed + ' failed' : '');
    }
    if (btnR2) {
      btnR2.disabled = false;
      btnR2.textContent = '☁️ Upload HD';
    }

    showToast((data.completed || 0) + ' HD originals uploaded to cloud!', 'success');

    // Auto-hide banner after 5 seconds
    setTimeout(function () {
      if (banner) banner.style.display = 'none';
    }, 5000);
  }

  // ==================== EVENT BINDING ====================

  function bindModalEvents() {
    var btnSend = document.getElementById('btn-results-gallery-send');
    if (btnSend) btnSend.addEventListener('click', sendToGallery);

    var btnCancel = document.getElementById('btn-results-gallery-cancel');
    if (btnCancel) btnCancel.addEventListener('click', function () { hideModal('modal-results-gallery'); });

    var btnCreate = document.getElementById('btn-results-create-gallery');
    if (btnCreate) btnCreate.addEventListener('click', createGalleryInline);

    // Backdrop close
    var modal = document.getElementById('modal-results-gallery');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) hideModal('modal-results-gallery');
      });
    }

    // R2 cancel button
    var btnR2Cancel = document.getElementById('btn-r2-cancel');
    if (btnR2Cancel) {
      btnR2Cancel.addEventListener('click', function () {
        window.api.invoke('delivery-r2-upload-cancel').catch(function () {});
        var banner = document.getElementById('r2-upload-banner');
        if (banner) banner.style.display = 'none';
        var btnR2 = document.getElementById('btn-r2-upload');
        if (btnR2) {
          btnR2.disabled = false;
          btnR2.textContent = '☁️ Upload HD';
        }
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
    // Simple toast notification
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
