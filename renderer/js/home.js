/**
 * RaceTagger Desktop - Home Page Interactive Logic
 * Handles the user-friendly home page functionality
 */

// Home page state
let homePageData = {
  monthlyPhotos: 0,
  completedEvents: 0,
  recentWork: [],
  userName: 'Photographer'
};

// Tips carousel state
let currentTipIndex = 0;
let tipCarouselInterval = null;

/**
 * Initialize home page functionality
 */
function initializeHomePage() {
  console.log('[Home] Initializing home page...');

  // Load user data
  loadHomePageData();

  // Setup tips carousel
  initializeTipsCarousel();

  // Setup navigation functions
  setupNavigationFunctions();

  // Update user name in hero
  updateUserName();

  // Load app version
  loadAppVersion();

  console.log('[Home] Home page initialized');
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

      // Get recent executions
      const recentResult = await window.api.invoke('get-recent-executions');
      if (recentResult.success && recentResult.data) {
        homePageData.recentWork = recentResult.data.slice(0, 6);
        updateRecentWorkGrid();
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
 * Update recent work grid
 */
function updateRecentWorkGrid() {
  const grid = document.getElementById('recent-work-grid');
  const emptyState = document.getElementById('empty-recent-work');

  if (!grid) return;

  if (homePageData.recentWork.length === 0) {
    // Show empty state
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  // Hide empty state
  if (emptyState) emptyState.style.display = 'none';

  // Create execution cards
  const workCardsHTML = homePageData.recentWork.map(execution => {
    // Determine status display
    const statusIcon = execution.status === 'completed' ? '✅' :
                      execution.status === 'processing' ? '🔄' :
                      execution.status === 'failed' ? '❌' : '⏳';

    const statusText = execution.status === 'completed' ? 'Completed' :
                      execution.status === 'processing' ? 'Processing' :
                      execution.status === 'failed' ? 'Failed' : 'Unknown';

    // Get category icon
    const categoryIcon = execution.category === 'motorsport' ? '🏎️' :
                        execution.category === 'running' ? '🏃' :
                        '⚡';

    return `
      <div class="work-card" onclick="viewExecutionResults('${execution.id}')">
        <div class="work-thumbnail">
          ${categoryIcon}
        </div>
        <div class="work-info">
          <h3>${escapeHtml(execution.folder_name)}</h3>
          <div class="work-meta">
            ID: ${execution.id.slice(-8)} • ${statusIcon} ${statusText}
          </div>
          <div class="work-stats">
            <span class="work-stat">📸 ${execution.total_images_processed || execution.total_images_found || 0} images</span>
          </div>
          <div class="work-actions">
            ${execution.status === 'completed' ? `
              <button class="btn btn-primary btn-work" onclick="event.stopPropagation(); viewExecutionResults('${execution.id}')">
                View Results
              </button>
            ` : `
              <button class="btn btn-secondary btn-work" onclick="event.stopPropagation(); rerunExecution('${execution.id}')">
                Run Again
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = workCardsHTML;
}

/**
 * Initialize tips carousel
 */
function initializeTipsCarousel() {
  const indicators = document.querySelectorAll('.indicator');

  // Add click handlers to indicators
  indicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
      showTip(index);
      resetCarouselTimer();
    });
  });

  // Start auto-rotation
  startCarouselTimer();
}

/**
 * Show specific tip
 */
function showTip(index) {
  const tips = document.querySelectorAll('.tip-card');
  const indicators = document.querySelectorAll('.indicator');

  // Hide current tip
  tips.forEach(tip => tip.classList.remove('active'));
  indicators.forEach(indicator => indicator.classList.remove('active'));

  // Show new tip
  if (tips[index]) {
    tips[index].classList.add('active');
  }
  if (indicators[index]) {
    indicators[index].classList.add('active');
  }

  currentTipIndex = index;
}

/**
 * Start carousel auto-rotation
 */
function startCarouselTimer() {
  tipCarouselInterval = setInterval(() => {
    const nextIndex = (currentTipIndex + 1) % 4; // 4 tips total
    showTip(nextIndex);
  }, 5000); // Change every 5 seconds
}

/**
 * Reset carousel timer
 */
function resetCarouselTimer() {
  if (tipCarouselInterval) {
    clearInterval(tipCarouselInterval);
  }
  startCarouselTimer();
}

/**
 * Setup navigation functions
 */
function setupNavigationFunctions() {
  // Make navigation function globally available
  window.navigateToAnalysis = function() {
    console.log('[Home] Navigating to analysis section...');

    // Use existing navigation system
    if (window.navigateToSection) {
      window.navigateToSection('analysis');
    } else {
      // Fallback to direct section switching
      const sections = document.querySelectorAll('.content-section');
      const navItems = document.querySelectorAll('.nav-item');

      sections.forEach(section => section.classList.remove('active-section'));
      navItems.forEach(item => item.classList.remove('active'));

      const analysisSection = document.getElementById('section-analysis');
      const analysisNavItem = document.querySelector('.nav-item[href="#"]:nth-child(2)');

      if (analysisSection) analysisSection.classList.add('active-section');
      if (analysisNavItem) analysisNavItem.classList.add('active');
    }
  };

  // Execution interaction functions
  window.viewExecutionResults = function(executionId) {
    console.log('[Home] Viewing execution results:', executionId);
    // Navigate to results page with execution ID
    window.location.href = `results.html?executionId=${encodeURIComponent(executionId)}`;
  };

  window.rerunExecution = function(executionId) {
    console.log('[Home] Re-running execution:', executionId);
    // Navigate to analysis section to start a new analysis
    window.navigateToAnalysis();
    // Could potentially pre-populate settings from previous execution
  };

  // Participants navigation
  window.navigateToParticipants = function() {
    console.log('[Home] Navigating to participants section...');

    // Use existing navigation system
    if (window.navigateToSection) {
      window.navigateToSection('participants');
    } else {
      // Fallback navigation
      console.log('[Home] Direct navigation to participants');
      showParticipantsSection();
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
    console.log('[Home] Could not load user name, using default');
  }
}

/**
 * Refresh home page data
 */
async function refreshHomePageData() {
  console.log('[Home] Refreshing home page data...');
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
  if (tipCarouselInterval) {
    clearInterval(tipCarouselInterval);
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