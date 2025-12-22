/**
 * Router.js - Hash-based SPA Router using Navigo.js
 *
 * Provides navigation between pages with:
 * - Hash-based routing (#/home, #/analysis, etc.)
 * - Page lazy loading from /pages/*.html
 * - Caching for performance
 * - Integration with existing desktop-ui.js events
 */

// Import Navigo (loaded via script tag before this file)
// Navigo is available as window.Navigo

(function() {
  'use strict';

  // Page cache to avoid re-fetching
  const pageCache = new Map();

  // Page container element
  let pageContainer = null;

  // Track current page for preventing duplicate loads
  let currentPage = null;

  // Pages that have been migrated to the new system
  // All pages migrated!
  const migratedPages = new Set([
    'home',
    'settings',
    'projects',
    'destinations',
    'participants',
    'analysis'
  ]);

  // Legacy pages still using the old section-based system
  // All pages migrated! Empty set kept for potential future use.
  const legacyPages = new Set([
    // 'analysis' - MIGRATED
    // 'participants' - MIGRATED
    // 'destinations' - MIGRATED
    // 'settings' - MIGRATED
    // 'progetti' - MIGRATED (as 'projects')
  ]);

  /**
   * Hide all legacy content sections
   */
  function hideLegacySections() {
    const legacySections = document.querySelectorAll('.content-section');
    legacySections.forEach(section => {
      section.classList.remove('active-section');
    });
  }

  /**
   * Load a page HTML into the container
   * @param {string} pageName - Name of the page to load
   */
  async function loadPage(pageName) {
    if (currentPage === pageName) {
      return;
    }

    // Check if this page has been migrated
    if (!migratedPages.has(pageName)) {
      handleLegacyNavigation(pageName);
      return;
    }

    // Hide all legacy sections
    hideLegacySections();

    // Show and activate page container
    if (pageContainer) {
      pageContainer.style.display = 'block';
      pageContainer.classList.add('active');
      pageContainer.classList.add('page-loading');
    }

    try {
      // Fetch page HTML (with caching)
      let html;
      if (pageCache.has(pageName)) {
        html = pageCache.get(pageName);
      } else {
        const response = await fetch(`pages/${pageName}.html`);
        if (!response.ok) {
          throw new Error(`Failed to load page: ${response.status}`);
        }
        html = await response.text();
        pageCache.set(pageName, html);
      }

      // Insert into container
      if (pageContainer) {
        pageContainer.innerHTML = html;
        currentPage = pageName;

        // Dispatch page-loaded event for initialization
        window.dispatchEvent(new CustomEvent('page-loaded', {
          detail: { page: pageName }
        }));

        // Also dispatch section-changed for backward compatibility
        document.dispatchEvent(new CustomEvent('section-changed', {
          detail: { section: pageName }
        }));

        // Page-specific initialization
        initializePage(pageName);
      }
    } catch (error) {
      console.error('[Router] Error loading page:', error);
      if (pageContainer) {
        pageContainer.innerHTML = `
          <div class="error-page">
            <h2>Error Loading Page</h2>
            <p>Could not load the requested page. Please try again.</p>
            <button onclick="window.router.navigate('/')">Go Home</button>
          </div>
        `;
      }
    } finally {
      if (pageContainer) {
        pageContainer.classList.remove('page-loading');
      }
    }
  }

  /**
   * Handle navigation for pages not yet migrated
   * Uses the existing desktop-ui.js handleNavigation system
   */
  function handleLegacyNavigation(sectionName) {
    // Map route names to section names if different
    const sectionMap = {
      'projects': 'progetti'
    };

    const actualSection = sectionMap[sectionName] || sectionName;

    // Hide the new page container
    if (pageContainer) {
      pageContainer.style.display = 'none';
      pageContainer.classList.remove('active');
      pageContainer.innerHTML = '';
    }

    // Hide all sections first
    const legacySections = document.querySelectorAll('.content-section');
    legacySections.forEach(section => {
      section.classList.remove('active-section');
    });

    // Show the target section
    const targetSection = document.getElementById(`section-${actualSection}`);
    if (targetSection) {
      targetSection.classList.add('active-section');
    }

    // Dispatch section-changed event for backward compatibility
    document.dispatchEvent(new CustomEvent('section-changed', {
      detail: { section: actualSection }
    }));

    // Section-specific initialization
    if (actualSection === 'home' && typeof window.loadRecentPresets === 'function') {
      window.loadRecentPresets();
    } else if (actualSection === 'progetti' && typeof window.loadAllProjects === 'function') {
      window.loadAllProjects();
    }

    currentPage = sectionName;
  }

  /**
   * Page-specific initialization after loading
   */
  function initializePage(pageName) {
    switch (pageName) {
      case 'home':
        // Load recent presets if function exists
        if (typeof window.loadRecentPresets === 'function') {
          window.loadRecentPresets();
        }
        // Load home stats
        if (typeof window.loadHomeStats === 'function') {
          window.loadHomeStats();
        }
        break;

      case 'settings':
        // Settings initialization handled by settings.js via section-changed event
        // Also explicitly call if SettingsManager is available
        if (typeof window.SettingsManager !== 'undefined' && window.SettingsManager.initialize) {
          window.SettingsManager.initialize();
        }
        break;

      case 'projects':
        // Load projects list
        if (typeof window.loadAllProjects === 'function') {
          window.loadAllProjects();
        }
        // Re-attach event listener for create button (dynamically loaded)
        const createBtn = document.getElementById('create-new-project-btn');
        if (createBtn && typeof window.openProjectModal === 'function') {
          createBtn.addEventListener('click', () => window.openProjectModal('create'));
        }
        break;

      case 'destinations':
        // Initialize ExportDestinationsManager if available
        if (typeof window.ExportDestinationsManager !== 'undefined' && window.ExportDestinationsManager.initialize) {
          window.ExportDestinationsManager.initialize();
        }
        break;

      case 'participants':
        // Participants initialization handled by participants-manager.js via section-changed event
        // Re-attach event listeners for dynamically loaded buttons
        const newPresetBtn = document.getElementById('create-new-preset-btn');
        const csvBtn = document.getElementById('import-csv-preset-btn');
        const jsonBtn = document.getElementById('import-json-preset-btn');

        if (newPresetBtn && typeof window.createNewPreset === 'function') {
          newPresetBtn.addEventListener('click', window.createNewPreset);
        }
        if (csvBtn && typeof window.openCsvImportModal === 'function') {
          csvBtn.addEventListener('click', window.openCsvImportModal);
        }
        if (jsonBtn && typeof window.openJsonImportModal === 'function') {
          jsonBtn.addEventListener('click', window.openJsonImportModal);
        }
        break;

      case 'analysis':
        // Analysis page - initialize all dynamic content
        // Re-bind critical event listeners for dynamically loaded elements
        const folderBtn = document.getElementById('folder-select-button');
        const uploadBtn = document.getElementById('upload-button');
        const advToggle = document.getElementById('advanced-toggle');
        const categorySelect = document.getElementById('category-select');

        if (folderBtn && typeof window.handleFolderSelection === 'function') {
          folderBtn.addEventListener('click', window.handleFolderSelection);
        }
        if (uploadBtn && typeof window.handleUploadAndAnalyze === 'function') {
          uploadBtn.addEventListener('click', window.handleUploadAndAnalyze);
        }
        if (advToggle && typeof window.toggleAdvancedOptions === 'function') {
          advToggle.addEventListener('click', window.toggleAdvancedOptions);
        }
        // Bind category selection change handler
        if (categorySelect && typeof window.handleCategorySelection === 'function') {
          categorySelect.addEventListener('change', window.handleCategorySelection);
        }

        // Register IPC listener for folder selection response
        if (window.api && typeof window.handleFolderSelected === 'function') {
          window.api.receive('folder-selected', window.handleFolderSelected);
        }

        // Load dynamic sport categories from database
        if (typeof window.loadDynamicCategories === 'function') {
          window.loadDynamicCategories(false); // use cache if valid
        }

        // Load presets for the preset selector
        if (typeof window.loadPresetsForSelector === 'function') {
          window.loadPresetsForSelector();
        }

        // Initialize metadata overwrite options
        if (typeof window.initMetadataOverwriteOptions === 'function') {
          window.initMetadataOverwriteOptions();
        }
        break;
    }
  }

  /**
   * Update active state in sidebar navigation
   */
  function updateNavActiveState(pageName) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      const section = item.getAttribute('data-section');
      if (section === pageName || (pageName === 'home' && section === 'home')) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  /**
   * Initialize the router
   */
  function initRouter() {
    // Get page container
    pageContainer = document.getElementById('page-content');

    // Check if Navigo is available
    if (typeof Navigo === 'undefined') {
      console.error('[Router] Navigo.js not loaded!');
      return;
    }

    // Create Navigo instance with hash-based routing
    const router = new Navigo('/', { hash: true });

    // Define routes
    router
      .on('/', () => {
        updateNavActiveState('home');
        loadPage('home');
      })
      .on('/home', () => {
        updateNavActiveState('home');
        loadPage('home');
      })
      .on('/analysis', () => {
        updateNavActiveState('analysis');
        loadPage('analysis');
      })
      .on('/participants', () => {
        updateNavActiveState('participants');
        loadPage('participants');
      })
      .on('/destinations', () => {
        updateNavActiveState('destinations');
        loadPage('destinations');
      })
      .on('/projects', () => {
        updateNavActiveState('progetti');
        loadPage('projects');
      })
      .on('/settings', () => {
        updateNavActiveState('settings');
        loadPage('settings');
      })
      .notFound(() => {
        router.navigate('/');
      });

    // Start the router
    router.resolve();

    // Expose router globally for navigation from other scripts
    window.router = router;

    // Override sidebar navigation clicks
    setupSidebarNavigation(router);
  }

  /**
   * Setup sidebar navigation to use the router
   */
  function setupSidebarNavigation(router) {
    const navItems = document.querySelectorAll('.nav-item[data-section]');

    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.getAttribute('data-section');

        // Map section names to routes
        const routeMap = {
          'home': '/',
          'analysis': '/analysis',
          'participants': '/participants',
          'destinations': '/destinations',
          'progetti': '/projects',
          'settings': '/settings'
        };

        const route = routeMap[section] || '/';
        router.navigate(route);
      });
    });
  }

  /**
   * Helper function to navigate programmatically
   */
  function navigateTo(route) {
    if (window.router) {
      window.router.navigate(route);
    }
  }

  // Expose functions globally
  window.navigateTo = navigateTo;
  window.loadPage = loadPage;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouter);
  } else {
    initRouter();
  }

})();
