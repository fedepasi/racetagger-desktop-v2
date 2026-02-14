/**
 * Remote Diagnostics Module
 *
 * Adds a floating "Send Diagnostics" button (FAB) to the app.
 * When clicked, collects full system diagnostics + main process logs
 * and uploads them to Supabase for the developer to review.
 *
 * The button is always visible (bottom-right corner) so testers
 * can easily send diagnostic reports without any technical knowledge.
 */
(function () {
  'use strict';

  // ==================== State ====================

  let isSending = false;
  let fabButton = null;
  let statusToast = null;

  // ==================== Initialize ====================

  function init() {
    createFabButton();
    createStatusToast();
  }

  // ==================== FAB Button ====================

  function createFabButton() {
    if (fabButton) return;

    fabButton = document.createElement('button');
    fabButton.id = 'diagnostic-fab';
    fabButton.title = 'Send diagnostic report to developer';
    fabButton.innerHTML = `
      <span class="diagnostic-fab-icon">🔧</span>
      <span class="diagnostic-fab-text">Send Diagnostics</span>
    `;
    fabButton.addEventListener('click', handleSendDiagnostics);

    // Styles (inline to avoid needing a separate CSS file)
    fabButton.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: white;
      border: none;
      border-radius: 50px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
      transition: all 0.2s ease;
      opacity: 0.85;
    `;

    fabButton.addEventListener('mouseenter', () => {
      if (!isSending) {
        fabButton.style.opacity = '1';
        fabButton.style.transform = 'scale(1.05)';
      }
    });

    fabButton.addEventListener('mouseleave', () => {
      if (!isSending) {
        fabButton.style.opacity = '0.85';
        fabButton.style.transform = 'scale(1)';
      }
    });

    document.body.appendChild(fabButton);
  }

  // ==================== Status Toast ====================

  function createStatusToast() {
    if (statusToast) return;

    statusToast = document.createElement('div');
    statusToast.id = 'diagnostic-toast';
    statusToast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 20px;
      z-index: 10000;
      padding: 12px 20px;
      background: #1e293b;
      color: white;
      border-radius: 10px;
      font-size: 13px;
      font-family: inherit;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
      pointer-events: none;
      max-width: 320px;
    `;

    document.body.appendChild(statusToast);
  }

  function showToast(message, type) {
    if (!statusToast) return;

    // Color by type
    const colors = {
      info: '#3b82f6',
      success: '#22c55e',
      error: '#ef4444',
      loading: '#f59e0b',
    };

    statusToast.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
    statusToast.textContent = message;
    statusToast.style.opacity = '1';
    statusToast.style.transform = 'translateY(0)';

    if (type !== 'loading') {
      setTimeout(() => {
        statusToast.style.opacity = '0';
        statusToast.style.transform = 'translateY(10px)';
      }, 4000);
    }
  }

  // ==================== Send Diagnostics ====================

  async function handleSendDiagnostics() {
    if (isSending) return;
    isSending = true;

    // Update button state
    fabButton.style.opacity = '0.6';
    fabButton.style.cursor = 'not-allowed';
    fabButton.querySelector('.diagnostic-fab-icon').textContent = '⏳';
    fabButton.querySelector('.diagnostic-fab-text').textContent = 'Collecting...';

    try {
      // Step 1: Collect diagnostics
      showToast('Collecting system diagnostics...', 'loading');
      const report = await window.api.invoke('collect-full-diagnostics');

      if (!report) {
        showToast('Failed to collect diagnostics', 'error');
        resetButton();
        return;
      }

      // Step 2: Upload
      fabButton.querySelector('.diagnostic-fab-text').textContent = 'Uploading...';
      showToast('Uploading diagnostic report...', 'loading');

      const result = await window.api.invoke('upload-diagnostics-remote', report);

      if (result && result.success) {
        showToast('Diagnostic report sent successfully! The developer will review it.', 'success');
        fabButton.querySelector('.diagnostic-fab-icon').textContent = '✅';
        fabButton.querySelector('.diagnostic-fab-text').textContent = 'Sent!';

        // Reset after 3 seconds
        setTimeout(() => resetButton(), 3000);
      } else {
        const errorMsg = result?.error || 'Unknown error';
        console.error('[Diagnostics] Upload failed:', errorMsg);

        // If upload failed, try saving locally
        showToast('Upload failed. Opening log folder for manual sharing...', 'error');
        try {
          await window.api.invoke('open-diagnostic-log-folder');
        } catch (e) {
          // Ignore folder open errors
        }
        resetButton();
      }
    } catch (error) {
      console.error('[Diagnostics] Error:', error);
      showToast('Error: ' + (error.message || 'Failed to send diagnostics'), 'error');
      resetButton();
    }
  }

  function resetButton() {
    isSending = false;
    if (fabButton) {
      fabButton.style.opacity = '0.85';
      fabButton.style.cursor = 'pointer';
      fabButton.querySelector('.diagnostic-fab-icon').textContent = '🔧';
      fabButton.querySelector('.diagnostic-fab-text').textContent = 'Send Diagnostics';
    }
  }

  // ==================== Auto-Initialize ====================

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
