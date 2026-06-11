/**
 * Upload Monitor — Cross-page R2 upload progress tracking
 *
 * Runs inside index.html (which hosts the sidebar nav + routed pages).
 * Listens for R2 upload events from the main process and updates:
 *   1. Nav badge (pulsing indicator on Delivery nav item)
 *   2. Mini progress panel (below Delivery nav item)
 *   3. HD Uploads section on the Delivery page (history + active upload)
 *
 * Also polls for active uploads on startup so badge appears even if the
 * user navigated away and came back.
 */
(function () {
  'use strict';

  var isUploading = false;
  var uploadHistory = []; // Stored in memory for session

  // ==================== INIT ====================

  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(initUploadMonitor, 2000); // Wait for app to be ready
  });

  // Re-check when delivery page loads
  window.addEventListener('page-loaded', function (e) {
    if (e.detail && e.detail.page === 'delivery') {
      renderUploadsSection();
    }
  });

  async function initUploadMonitor() {
    if (!window.api || !window.api.invoke) return;

    // Listen for R2 events from main process
    if (window.api.receive) {
      window.api.receive('r2-upload-progress', handleProgress);
      window.api.receive('r2-upload-complete', handleComplete);
    }

    // Check if there's an active upload (user might have reloaded)
    try {
      var result = await window.api.invoke('delivery-r2-upload-progress');
      if (result && result.success && result.data) {
        var p = result.data;
        if (p.total > 0 && p.completed < p.total && p.percentage < 100) {
          isUploading = true;
          showBadge(true);
          updateMiniProgress(p);
          updateActiveCard(p);
        }
      }
    } catch (e) {
      // Silent — upload service may not be initialized yet
    }

    // Load upload history from main process
    try {
      var histResult = await window.api.invoke('delivery-get-upload-history');
      if (histResult && histResult.success && histResult.data) {
        uploadHistory = histResult.data;
        renderUploadsSection();
      }
    } catch (e) {
      // Handler may not exist yet — that's OK
    }
  }

  // ==================== EVENT HANDLERS ====================

  function handleProgress(data) {
    if (!data || !data.progress) return;
    var p = data.progress;

    if (!isUploading) {
      isUploading = true;
      showBadge(true);
    }

    updateMiniProgress(p);
    updateActiveCard(p);
  }

  function handleComplete(data) {
    isUploading = false;
    showBadge(false);
    hideMiniProgress();

    // Add to session history
    if (data) {
      uploadHistory.unshift({
        completed: data.completed || 0,
        failed: data.failed || 0,
        total: data.total || 0,
        timestamp: new Date().toISOString(),
        executionId: data.executionId || null,
      });
    }

    // Update delivery page if visible
    hideActiveCard();
    renderHistoryList();
  }

  // ==================== NAV BADGE ====================

  function showBadge(visible) {
    var badge = document.getElementById('nav-upload-badge');
    if (badge) badge.style.display = visible ? 'flex' : 'none';
  }

  // ==================== MINI PROGRESS ====================

  function updateMiniProgress(p) {
    var container = document.getElementById('nav-upload-mini');
    var fill = document.getElementById('nav-upload-mini-fill');
    var stat = document.getElementById('nav-upload-mini-stat');

    if (container) container.style.display = 'block';
    if (fill) fill.style.width = p.percentage + '%';
    if (stat) {
      var remaining = p.total - p.completed - (p.failed || 0);
      stat.textContent = p.completed + ' / ' + p.total + ' files' +
        (p.failed > 0 ? ' (' + p.failed + ' failed)' : '');
    }
  }

  function hideMiniProgress() {
    var container = document.getElementById('nav-upload-mini');
    if (container) {
      // Keep visible briefly to show completion
      setTimeout(function () {
        if (!isUploading) container.style.display = 'none';
      }, 5000);
    }
  }

  // ==================== DELIVERY PAGE: ACTIVE CARD ====================

  function updateActiveCard(p) {
    var card = document.getElementById('upload-active-card');
    if (!card) return; // Delivery page not loaded

    card.style.display = 'block';

    var progress = document.getElementById('upload-active-progress');
    if (progress) progress.style.width = p.percentage + '%';

    var stats = document.getElementById('upload-active-stats');
    if (stats) {
      stats.innerHTML =
        '<span>📁 ' + p.completed + ' / ' + p.total + ' files</span>' +
        (p.failed > 0 ? '<span style="color: #ef4444;">⚠ ' + p.failed + ' failed</span>' : '');
    }

    var meta = document.getElementById('upload-active-meta');
    if (meta && !meta.textContent) {
      meta.textContent = 'Started just now';
    }

    // Hide empty state
    var empty = document.getElementById('upload-history-empty');
    if (empty) empty.style.display = 'none';

    // Show uploads section (only on home page, not inside client detail)
    var section = document.getElementById('delivery-uploads-section');
    var clientDetail = document.getElementById('delivery-project-detail');
    if (section && !(clientDetail && clientDetail.style.display !== 'none')) {
      section.style.display = 'block';
    }
  }

  function hideActiveCard() {
    var card = document.getElementById('upload-active-card');
    if (card) card.style.display = 'none';
  }

  // ==================== DELIVERY PAGE: HISTORY LIST ====================

  function renderUploadsSection() {
    var section = document.getElementById('delivery-uploads-section');
    if (!section) return; // Delivery page not loaded yet

    // Don't show uploads section when inside client detail view
    var clientDetail = document.getElementById('delivery-project-detail');
    if (clientDetail && clientDetail.style.display !== 'none') {
      section.style.display = 'none';
      return;
    }

    // Show section if R2 is enabled (check plan limits)
    // We show it always when there's history or active upload
    if (isUploading || uploadHistory.length > 0) {
      section.style.display = 'block';
    } else {
      // Check plan limits to decide whether to show empty state
      if (window.api && window.api.invoke) {
        window.api.invoke('delivery-get-plan-limits').then(function (result) {
          if (result && result.success && result.data && result.data.r2_storage_enabled) {
            section.style.display = 'block';
            var empty = document.getElementById('upload-history-empty');
            if (empty) empty.style.display = 'block';
          }
        }).catch(function () {});
      }
      return;
    }

    renderHistoryList();
  }

  function renderHistoryList() {
    var list = document.getElementById('upload-history-list');
    if (!list) return;

    var empty = document.getElementById('upload-history-empty');

    if (uploadHistory.length === 0 && !isUploading) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    var html = '';
    uploadHistory.forEach(function (item) {
      var isFailed = item.failed > 0;
      var isComplete = item.completed === item.total && !isFailed;

      var badgeClass = isFailed ? 'failed' : 'completed';
      var badgeText = isFailed
        ? '⚠ ' + item.failed + ' Failed'
        : '✓ Complete';
      var badgeBg = isFailed
        ? 'rgba(239, 68, 68, 0.15)'
        : 'rgba(16, 185, 129, 0.15)';
      var badgeColor = isFailed ? '#ef4444' : '#10b981';
      var borderColor = isFailed ? 'rgba(239, 68, 68, 0.2)' : 'var(--border-color, #334155)';

      var timeAgo = formatTimeAgo(item.timestamp);

      html += '<div style="background: var(--bg-card, #1e293b); border: 1px solid ' + borderColor + '; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px;">' +
        '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">' +
          '<span style="font-size: 13px; color: var(--text-primary); font-weight: 600;">HD Upload</span>' +
          '<span style="font-size: 10px; padding: 3px 10px; border-radius: 12px; background: ' + badgeBg + '; color: ' + badgeColor + '; font-weight: 600;">' + badgeText + '</span>' +
        '</div>' +
        '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">' + timeAgo + '</div>' +
        '<div style="display: flex; gap: 16px; font-size: 11px; color: var(--text-muted);">' +
          '<span>📁 ' + item.completed + ' / ' + item.total + ' files</span>' +
          (isFailed ? '<span style="color: #ef4444;">' + item.failed + ' files failed</span>' : '') +
        '</div>' +
      '</div>';
    });

    list.innerHTML = html;
  }

  // ==================== UTILS ====================

  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    var now = Date.now();
    var then = new Date(isoString).getTime();
    var diffMs = now - then;
    var diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + ' min ago';
    var diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    var diffDays = Math.floor(diffHours / 24);
    return diffDays + 'd ago';
  }

  // Expose for external use if needed
  window.uploadMonitor = {
    isUploading: function () { return isUploading; },
    getHistory: function () { return uploadHistory; },
  };
})();
