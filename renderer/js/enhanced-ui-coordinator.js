/**
 * Racetagger Desktop - Enhanced UI Coordinator
 * Coordinates the loading and integration of all enhanced UX components
 */

class EnhancedUICoordinator {
  constructor() {
    this.components = {
      onboardingWizard: false,
      smartPresets: false,
      enhancedProgress: false,
      modernResults: false,
      enhancedFileBrowser: false
    };
    
    this.initialized = false;
    this.initStartTime = Date.now();
    
    this.init();
  }
  
  init() {
    // Set up component loading monitoring
    this.monitorComponentLoading();

    // Start coordinated initialization
    this.coordinateInitialization();
  }
  
  coordinateInitialization() {
    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.startEnhancedUI(), 100);
      });
    } else {
      setTimeout(() => this.startEnhancedUI(), 100);
    }
  }
  
  startEnhancedUI() {
    // Mark body as enhanced UI ready
    document.body.classList.add('enhanced-ui-loading');
    
    // Initialize components in optimal order
    this.initializeSmartPresets();
    this.initializeEnhancedFileBrowser();
    this.initializeEnhancedProgress();
    
    // Monitor completion
    this.waitForAllComponents();
  }
  
  initializeSmartPresets() {
    setTimeout(() => {
      if (window.SmartPresets) {
        if (!window.smartPresets) {
          window.smartPresets = new SmartPresets();
        }
        this.components.smartPresets = true;
      }
    }, 150);
  }
  
  initializeEnhancedFileBrowser() {
    // Wait longer to ensure original renderer is fully loaded
    setTimeout(() => {
      if (window.EnhancedFileBrowser) {
        // Check if the original renderer has finished loading
        const analysisSection = document.getElementById('section-analysis');
        if (analysisSection && !window.enhancedFileBrowser) {
          try {
            window.enhancedFileBrowser = new EnhancedFileBrowser();
            this.components.enhancedFileBrowser = true;
          } catch (error) {
            console.error('Enhanced File Browser initialization failed:', error);
            // Component failed to load, but app should continue working
            this.components.enhancedFileBrowser = false;
          }
        } else if (!analysisSection) {
          this.components.enhancedFileBrowser = false;
        }
      } else {
        this.components.enhancedFileBrowser = false;
      }
    }, 500); // Increased timeout to avoid conflicts
  }
  
  
  initializeEnhancedProgress() {
    setTimeout(() => {
      if (window.EnhancedProgressTracker) {
        if (!window.enhancedProgress) {
          window.enhancedProgress = new EnhancedProgressTracker();
        }
        this.components.enhancedProgress = true;
      }
    }, 300);
  }
  
  
  waitForAllComponents() {
    const checkInterval = setInterval(() => {
      const allReady = Object.values(this.components).every(ready => ready);
      
      if (allReady) {
        clearInterval(checkInterval);
        this.completeInitialization();
      }
      
      // Timeout after 10 seconds
      if (Date.now() - this.initStartTime > 10000) {
        clearInterval(checkInterval);
        this.completeInitialization();
      }
    }, 100);
  }
  
  completeInitialization() {
    this.initialized = true;
    const initTime = Date.now() - this.initStartTime;

    // Mark body as fully ready
    document.body.classList.remove('enhanced-ui-loading');
    document.body.classList.add('enhanced-ui-ready');
    
    // Dispatch ready event
    document.dispatchEvent(new CustomEvent('enhancedUIReady', {
      detail: {
        components: this.components,
        initTime: initTime
      }
    }));
    
    // Show welcome message for first-time users
    this.showWelcomeMessage();
  }
  
  monitorComponentLoading() {
    // Monitor for component scripts being loaded
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SCRIPT') {
            // Script loading monitoring - no logging needed
          }
        });
      });
    });

    observer.observe(document.head, { childList: true });
  }
  
  
  showWelcomeMessage() {
    // Show a subtle welcome message for enhanced UI
    if (this.initialized && !localStorage.getItem('enhanced-ui-welcome-shown')) {
      const welcome = document.createElement('div');
      welcome.className = 'enhanced-ui-welcome';
      welcome.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.75rem;
        box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
        z-index: 1000;
        font-size: 0.875rem;
        font-weight: 500;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        cursor: pointer;
        max-width: 300px;
      `;
      welcome.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 1.2rem;">✨</span>
          <div>
            <div style="font-weight: 600;">Enhanced UI Active</div>
            <div style="font-size: 0.8rem; opacity: 0.9;">Improved workflow and experience</div>
          </div>
        </div>
      `;
      
      document.body.appendChild(welcome);
      
      // Animate in
      setTimeout(() => {
        welcome.style.opacity = '1';
        welcome.style.transform = 'translateX(0)';
      }, 100);
      
      // Auto-remove after 4 seconds or on click
      const remove = () => {
        welcome.style.opacity = '0';
        welcome.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (welcome.parentNode) {
            welcome.parentNode.removeChild(welcome);
          }
        }, 300);
      };
      
      welcome.addEventListener('click', remove);
      setTimeout(remove, 4000);
      
      localStorage.setItem('enhanced-ui-welcome-shown', 'true');
    }
  }
  
  // Public API
  isInitialized() {
    return this.initialized;
  }
  
  getComponents() {
    return this.components;
  }
  
  getComponent(name) {
    return window[name] || null;
  }
}

// Auto-initialize coordinator
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.enhancedUICoordinator = new EnhancedUICoordinator();
  });
} else {
  window.enhancedUICoordinator = new EnhancedUICoordinator();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedUICoordinator;
}