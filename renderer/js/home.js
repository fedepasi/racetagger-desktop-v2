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
    // Use existing navigation system
    if (window.navigateToSection) {
      window.navigateToSection('participants');
    } else {
      // Fallback navigation
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