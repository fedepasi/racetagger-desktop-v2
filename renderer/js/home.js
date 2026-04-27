/**
 * RaceTagger Desktop - Home Page Interactive Logic
 * Handles the user-friendly home page functionality
 */

// Home page state
let homePageData = {
  monthlyPhotos: 0,
  completedEvents: 0,
  userName: 'Photographer'
};

// Announcements carousel state
let announcements = [];
let currentAnnouncementIndex = 0;
let announcementCarouselInterval = null;

/**
 * Initialize home page functionality
 */
function initializeHomePage() {
  // Load user data
  loadHomePageData();

  // Load announcements (will only show if there are any)
  loadAnnouncements();

  // Load recent executions
  loadRecentExecutions();

  // Setup navigation functions
  setupNavigationFunctions();

  // Update user name in hero
  updateUserName();

  // Load app version
  loadAppVersion();

  // Check if we need to navigate to a specific section from results page
  checkNavigationIntent();
}

/**
 * Check if there's a navigation intent from sessionStorage (e.g., from results page)
 */
function checkNavigationIntent() {
  const targetSection = sessionStorage.getItem('navigateToSection');

  if (targetSection) {
    // Clear the flag
    sessionStorage.removeItem('navigateToSection');

    // Navigate to the section after a small delay to ensure DOM is ready
    setTimeout(() => {
      if (window.navigateToSection) {
        window.navigateToSection(targetSection);
      } else if (window.navigateToAnalysis && targetSection === 'analysis') {
        window.navigateToAnalysis();
      }
    }, 100);
  }
}

/**
 * Load home page data from IPC
 */
async function loadHomePageData() {
  try {
    if (window.api && window.api.invoke) {
      // Get home page statistics
      const statsResult = await window.api.invoke('get-home-statistics');
      if (statsResult.success) {
        homePageData = { ...homePageData, ...statsResult.data };
        updateHomePageUI();
      }
    }
  } catch (error) {
    console.error('[Home] Error loading home page data:', error);
    // Show with default values
    updateHomePageUI();
  }
}

/**
 * Update home page UI with loaded data
 */
function updateHomePageUI() {
  // Animate numbers counting up
  animateNumber('monthly-photos', homePageData.monthlyPhotos);
  animateNumber('completed-events', homePageData.completedEvents);
}

/**
 * Animate number counting up
 */
function animateNumber(elementId, targetValue) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const startValue = 0;
  const duration = 1000; // 1 second
  const startTime = Date.now();

  element.classList.add('animate');

  function updateNumber() {
    const currentTime = Date.now();
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function (ease-out)
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.floor(startValue + (targetValue - startValue) * easedProgress);

    element.textContent = currentValue.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(updateNumber);
    }
  }

  requestAnimationFrame(updateNumber);
}

/**
 * Load recent executions from local JSONL files
 */
async function loadRecentExecutions() {
  try {
    const container = document.getElementById('recent-executions-list');
    if (!container) return;

    if (window.api && window.api.invoke) {
      // Use local JSONL files instead of database
      const result = await window.api.invoke('get-local-executions');
      if (result.success && result.data?.length > 0) {
        renderRecentExecutions(result.data);
      } else {
        // Show empty state
        container.innerHTML = `
          <div class="empty-executions">
            <div class="empty-executions-icon">📷</div>
            <h3>No analyses yet</h3>
            <p>Start your first analysis to see your history here</p>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('[Home] Error loading recent executions:', error);
    const container = document.getElementById('recent-executions-list');
    if (container) {
      container.innerHTML = `
        <div class="empty-executions">
          <div class="empty-executions-icon">⚠️</div>
          <h3>Could not load analyses</h3>
          <p>Please try again later</p>
        </div>
      `;
    }
  }
}

/**
 * Human-readable sport label with emoji.
 * Intentionally forgiving — handles the handful of codes the desktop app actually produces
 * and otherwise falls back to a title-cased version of whatever is stored.
 */
function formatSportCategory(raw) {
  if (!raw) return '🏁 Sport';
  const key = String(raw).toLowerCase();
  const table = {
    motorsport:       '🏎️ Motorsport',
    cycling:          '🚴 Cycling',
    running:          '🏃 Running',
    'running-cycling':'🚴 Running & Cycling',
    triathlon:        '🏊 Triathlon',
    motorcycle:       '🏍️ Motorcycle',
    karting:          '🏎️ Karting',
    horse:            '🐎 Horse Racing',
    skiing:           '⛷️ Skiing',
    generic:          '🏁 Generic'
  };
  if (table[key]) return table[key];
  return '🏁 ' + (raw.charAt(0).toUpperCase() + raw.slice(1));
}

/**
 * Compose the delivery-badge HTML for a single execution, gated on the
 * per-user feature flags we got back from the IPC handler.
 * Returns an empty string when the user has no delivery features active
 * (so the row stays clean rather than showing "N/A" pills).
 */
function renderDeliveryBadges(exec) {
  const d = exec.delivery;
  if (!d) return '';
  const flags = d.featureFlags || {};
  const badges = [];

  // --- Gallery badge ---
  if (flags.gallery_enabled) {
    const galleries = Array.isArray(d.galleries) ? d.galleries : [];
    if (galleries.length === 0) {
      badges.push(`<span class="badge-delivery none" title="Not yet delivered to any gallery">📂 Not delivered</span>`);
    } else if (galleries.length === 1) {
      const g = galleries[0];
      const title = g.title || 'Gallery';
      badges.push(
        `<span class="badge-delivery ok" data-gallery-id="${escapeHtml(g.id || '')}" title="Delivered to ${escapeHtml(title)} (${g.count} photos)">✓ ${escapeHtml(title)}</span>`
      );
    } else {
      const names = galleries.slice(0, 3).map(g => g.title).join(', ');
      badges.push(
        `<span class="badge-delivery ok" title="Delivered to: ${escapeHtml(names)}">✓ ${galleries.length} galleries</span>`
      );
    }
  }

  // --- HD (R2) badge ---
  if (flags.r2_storage_enabled) {
    const hd = d.hd || 'none';
    switch (hd) {
      case 'uploaded':
        badges.push(`<span class="badge-delivery ok" title="All ${d.hdTotal} originals uploaded">✓ HD ready</span>`);
        break;
      case 'uploading':
      case 'pending':
      case 'queued':
        badges.push(`<span class="badge-delivery progress" title="HD upload in progress (${d.hdCount}/${d.hdTotal})"><span class="spin-dot"></span> HD uploading</span>`);
        break;
      case 'failed':
        badges.push(`<span class="badge-delivery failed" title="HD upload failed">✕ HD failed</span>`);
        break;
      case 'partial':
        badges.push(`<span class="badge-delivery partial" title="Some originals uploaded (${d.hdCount}/${d.hdTotal})">◐ HD partial</span>`);
        break;
      case 'none':
      default:
        // No-op: don't clutter the row with "HD not uploaded" for every execution.
        // The gallery-less case above already communicates "no delivery happened".
        break;
    }
  }

  return badges.length ? `<span class="delivery-badges">${badges.join('')}</span>` : '';
}

/**
 * Render recent executions as compact rows (.card-b).
 */
function renderRecentExecutions(executions) {
  const container = document.getElementById('recent-executions-list');
  if (!container) return;

  container.innerHTML = executions.map(exec => {
    const date = new Date(exec.createdAt);
    const formattedDate = date.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const successRate = exec.totalImages > 0
      ? Math.round((exec.imagesWithNumbers / exec.totalImages) * 100)
      : 0;

    // Title falls back to a sensible default when the user hasn't renamed the execution.
    const hasCustomName = !!(exec.executionName && String(exec.executionName).trim());
    const displayName = hasCustomName
      ? exec.executionName
      : `${formatSportCategory(exec.sportCategory).replace(/^\S+\s/, '')} — ${formattedDate}`;
    const titleClass = hasCustomName ? 'title' : 'title is-default';

    const preset = exec.participantPreset;
    const presetLabel = preset && preset.name
      ? `🎯 ${escapeHtml(preset.name)}${preset.participantCount ? ` (${preset.participantCount})` : ''}`
      : '';

    const sportLabel = escapeHtml(formatSportCategory(exec.sportCategory));

    const folderPath = exec.folderPath ? escapeHtml(exec.folderPath) : '';
    const folderLine = folderPath
      ? `<div class="folder-line">
           <span class="folder-icon">📂</span>
           <span class="folder-path" title="${folderPath}">${folderPath}</span>
           ${renderDeliveryBadges(exec)}
         </div>`
      : (renderDeliveryBadges(exec)
          ? `<div class="folder-line">${renderDeliveryBadges(exec)}</div>`
          : '');

    const statusLabel = exec.status === 'completed' ? 'Completed'
      : exec.status === 'processing' ? 'Processing'
      : exec.status === 'failed' ? 'Failed'
      : 'Pending';

    return `
      <div class="card-b" data-execution-id="${escapeHtml(exec.id)}">
        <div class="card-b-main">
          <div class="title-row">
            <span class="${titleClass}" data-role="title">${escapeHtml(displayName)}</span>
            <button class="rename-btn" data-role="rename" title="Rename analysis" aria-label="Rename analysis">✏️</button>
          </div>
          <div class="meta-line">
            <span>${escapeHtml(formattedDate)}</span>
            <span class="sep">·</span>
            <span>${sportLabel}</span>
            ${presetLabel ? `<span class="sep">·</span><span class="preset-chip">${presetLabel}</span>` : ''}
          </div>
          ${folderLine}
        </div>
        <div class="card-b-side">
          <div class="mini-stats">
            <div class="mini-stat">
              <span class="mini-stat-value">${exec.totalImages}</span>
              <span class="mini-stat-label">Photos</span>
            </div>
            <div class="mini-stat">
              <span class="mini-stat-value">${exec.imagesWithNumbers}</span>
              <span class="mini-stat-label">Detected</span>
            </div>
            <div class="mini-stat">
              <span class="mini-stat-value success-rate">${successRate}%</span>
              <span class="mini-stat-label">Success</span>
            </div>
          </div>
          <span class="status-pill ${escapeHtml(exec.status || 'pending')}">${statusLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  // Wire up click handlers on each row:
  //   - click row     → open results
  //   - click ✏️      → enter inline rename mode
  //   - click a badge → (reserved) suppress row click so the badge can navigate later
  container.querySelectorAll('.card-b').forEach((row) => {
    const executionId = row.dataset.executionId;

    row.addEventListener('click', (e) => {
      // If user clicked the rename button or an already-open input, ignore.
      const target = e.target;
      if (target.closest('[data-role="rename"]') || target.closest('[data-role="rename-input"]')) return;
      if (target.closest('.badge-delivery')) {
        // Reserved: in the future, clicking a gallery badge can navigate to the gallery
        // detail page. For now we just prevent the row click from firing.
        e.stopPropagation();
        return;
      }
      openExecutionResults(executionId);
    });

    const renameBtn = row.querySelector('[data-role="rename"]');
    if (renameBtn) {
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        enterRenameMode(row, executionId);
      });
    }
  });
}

/**
 * Swap the title <span> for an editable <input> and wire up Enter/Esc/blur.
 */
function enterRenameMode(row, executionId) {
  const titleEl = row.querySelector('[data-role="title"]');
  const renameBtn = row.querySelector('[data-role="rename"]');
  if (!titleEl) return;

  const currentText = titleEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.maxLength = 120;
  input.className = 'rename-input';
  input.setAttribute('data-role', 'rename-input');
  input.setAttribute('aria-label', 'Rename analysis');

  titleEl.replaceWith(input);
  if (renameBtn) renameBtn.style.display = 'none';

  input.focus();
  input.select();

  let finalized = false;
  const restore = (newText, isDefault) => {
    if (finalized) return;
    finalized = true;
    const span = document.createElement('span');
    span.className = isDefault ? 'title is-default' : 'title';
    span.setAttribute('data-role', 'title');
    span.textContent = newText;
    input.replaceWith(span);
    if (renameBtn) renameBtn.style.display = '';
  };

  const commit = async () => {
    const trimmed = input.value.trim();
    if (!trimmed || trimmed === currentText) {
      // No-op: restore previous value with original default-ness.
      restore(currentText, titleEl.classList.contains('is-default'));
      return;
    }
    try {
      const result = await window.api.invoke('rename-execution', executionId, trimmed);
      if (result && result.success) {
        restore(trimmed, false);
      } else {
        console.warn('[Home] rename-execution failed:', result);
        restore(currentText, titleEl.classList.contains('is-default'));
      }
    } catch (err) {
      console.error('[Home] rename-execution error:', err);
      restore(currentText, titleEl.classList.contains('is-default'));
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restore(currentText, titleEl.classList.contains('is-default'));
    }
  });

  input.addEventListener('blur', () => {
    commit();
  });
}

/**
 * Open execution results in the dedicated results page
 */
window.openExecutionResults = function(executionId) {
  console.log('[Home] Opening execution results:', executionId);
  // Navigate to results page with execution ID
  window.location.href = `results.html?executionId=${encodeURIComponent(executionId)}`;
};

/**
 * Load announcements from Supabase
 */
async function loadAnnouncements() {
  try {
    if (window.api && window.api.invoke) {
      const result = await window.api.invoke('get-announcements');
      if (result.success && result.data?.length > 0) {
        announcements = result.data;
        renderAnnouncementsCarousel();
        initializeAnnouncementsCarousel();
        // Show the section only if there are announcements
        const section = document.getElementById('announcements-section');
        if (section) {
          section.style.display = 'block';
        }
      }
      // If no announcements, section stays hidden (display: none)
    }
  } catch (error) {
    // No fallback, section stays hidden
  }
}

/**
 * Render announcements carousel HTML
 */
function renderAnnouncementsCarousel() {
  const carousel = document.getElementById('announcements-carousel');
  const indicators = document.getElementById('announcements-indicators');
  if (!carousel || !announcements.length) return;

  // Add class for multiple announcements (enables carousel positioning)
  if (announcements.length > 1) {
    carousel.classList.add('has-multiple');
  } else {
    carousel.classList.remove('has-multiple');
  }

  carousel.innerHTML = announcements.map((item, i) => `
    <div class="announcement-card ${i === 0 ? 'active' : ''}" data-index="${i}"
         onclick="openAnnouncementLink('${escapeHtml(item.link_url || '')}')">
      ${item.image_url ? `<img class="announcement-image" src="${escapeHtml(item.image_url)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="announcement-content">
        <p class="announcement-title">${escapeHtml(item.title)}</p>
        ${item.description ? `<p class="announcement-description">${escapeHtml(item.description)}</p>` : ''}
        ${item.link_url ? `<span class="announcement-link">Learn more →</span>` : ''}
      </div>
    </div>
  `).join('');

  // Indicators only if more than 1 announcement
  if (announcements.length > 1) {
    indicators.innerHTML = announcements.map((_, i) =>
      `<div class="indicator ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`
    ).join('');
  } else {
    indicators.innerHTML = '';
  }
}

/**
 * Initialize announcements carousel
 */
function initializeAnnouncementsCarousel() {
  if (announcements.length <= 1) return; // No carousel for single announcement

  document.querySelectorAll('#announcements-indicators .indicator').forEach((ind, i) => {
    ind.addEventListener('click', () => {
      showAnnouncement(i);
      resetAnnouncementCarouselTimer();
    });
  });
  startAnnouncementCarouselTimer();
}

/**
 * Show specific announcement
 */
function showAnnouncement(index) {
  document.querySelectorAll('#announcements-carousel .announcement-card').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('#announcements-indicators .indicator').forEach(i => i.classList.remove('active'));

  const card = document.querySelector(`#announcements-carousel .announcement-card[data-index="${index}"]`);
  const indicator = document.querySelector(`#announcements-indicators .indicator[data-index="${index}"]`);

  if (card) card.classList.add('active');
  if (indicator) indicator.classList.add('active');
  currentAnnouncementIndex = index;
}

/**
 * Start announcements carousel auto-rotation
 */
function startAnnouncementCarouselTimer() {
  announcementCarouselInterval = setInterval(() => {
    showAnnouncement((currentAnnouncementIndex + 1) % announcements.length);
  }, 6000); // 6 seconds per announcement
}

/**
 * Reset announcements carousel timer
 */
function resetAnnouncementCarouselTimer() {
  if (announcementCarouselInterval) {
    clearInterval(announcementCarouselInterval);
  }
  startAnnouncementCarouselTimer();
}

/**
 * Open announcement link in external browser
 */
window.openAnnouncementLink = function(url) {
  if (!url) return;
  if (window.api && window.api.invoke) {
    window.api.invoke('open-external-url', url);
  } else {
    window.open(url, '_blank');
  }
};

/**
 * Setup navigation functions
 */
function setupNavigationFunctions() {
  // Make navigation function globally available
  window.navigateToAnalysis = function() {
    // Use hash router
    if (window.router) {
      window.router.navigate('/analysis');
    } else {
      // Fallback to hash navigation
      window.location.hash = '#/analysis';
    }
  };

  // Execution interaction functions
  window.viewExecutionResults = function(executionId) {
    // Navigate to results page with execution ID
    window.location.href = `results.html?executionId=${encodeURIComponent(executionId)}`;
  };

  window.rerunExecution = function(executionId) {
    // Navigate to analysis section to start a new analysis
    window.navigateToAnalysis();
    // Could potentially pre-populate settings from previous execution
  };

  // Participants navigation
  window.navigateToParticipants = function() {
    // Use hash router
    if (window.router) {
      window.router.navigate('/participants');
    } else {
      // Fallback to hash navigation
      window.location.hash = '#/participants';
    }
  };
}

/**
 * Show participants section (fallback navigation)
 */
function showParticipantsSection() {
  // Hide all content sections
  const sections = document.querySelectorAll('.content-section');
  sections.forEach(section => {
    section.classList.remove('active-section');
  });

  // Show participants section
  const participantsSection = document.getElementById('section-participants');
  if (participantsSection) {
    participantsSection.classList.add('active-section');
  }

  // Update navigation
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => item.classList.remove('active'));

  // Find and activate participants nav item
  navItems.forEach(item => {
    const text = item.querySelector('.nav-text');
    if (text && text.textContent.trim() === 'Participants') {
      item.classList.add('active');
    }
  });

  // Initialize participants manager if needed
  if (typeof initParticipantsManager === 'function') {
    initParticipantsManager();
  }
}

/**
 * Update user name in hero section
 */
async function updateUserName() {
  try {
    if (window.api && window.api.invoke) {
      const userInfo = await window.api.invoke('get-user-info');
      if (userInfo && userInfo.name) {
        homePageData.userName = userInfo.name;
        const heroNameElement = document.getElementById('user-name-hero');
        if (heroNameElement) {
          heroNameElement.textContent = homePageData.userName;
        }
      }
    }
  } catch (error) {
    // Using default user name
  }
}

/**
 * Refresh home page data
 */
async function refreshHomePageData() {
  await loadHomePageData();
}

/**
 * Utility function to escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Only initialize if we're on the home section
  const homeSection = document.getElementById('section-home');
  if (homeSection && homeSection.classList.contains('active-section')) {
    initializeHomePage();
  }
});

// Initialize when navigating to home
document.addEventListener('section-changed', function(event) {
  if (event.detail && event.detail.section === 'home') {
    initializeHomePage();
  }
});

/**
 * Load and display app version
 */
async function loadAppVersion() {
  try {
    if (window.api && window.api.invoke) {
      const version = await window.api.invoke('get-app-version');
      const versionElement = document.getElementById('app-version');
      if (versionElement && version) {
        versionElement.textContent = `v${version}`;
      }
    }
  } catch (error) {
    console.error('[Home] Error loading app version:', error);
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
  if (announcementCarouselInterval) {
    clearInterval(announcementCarouselInterval);
  }
});

// Export functions for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initializeHomePage,
    refreshHomePageData,
    loadHomePageData
  };
}