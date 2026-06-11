/*
 * Racetagger Desktop - Delight System Controller
 * Orchestrates delightful experiences across the application
 */

class DelightSystem {
  constructor() {
    this.settings = {
      level: 'full', // minimal, professional, full
      confettiEnabled: false,
      soundEnabled: false, // Future enhancement
      respectsReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
    };
    
    this.loadingMessages = [
      {
        icon: '🏎️',
        title: 'Analyzing race images...',
        subtitle: 'Like a pit crew analyzing telemetry data'
      },
      {
        icon: '🔍',
        title: 'AI vision at work...',
        subtitle: 'Scanning for race numbers with precision'
      },
      {
        icon: '📊',
        title: 'Processing results...',
        subtitle: 'Faster than a Formula 1 tire change'
      },
      {
        icon: '⚡',
        title: 'Almost there...',
        subtitle: 'Final lap, final checks'
      }
    ];
    
    this.funFacts = [
      {
        icon: '🏁',
        text: 'Did you know? The first photo finish in racing was recorded in 1890!'
      },
      {
        icon: '📸',
        text: 'Pro tip: Burst mode can capture the perfect moment as cars cross the finish line.'
      },
      {
        icon: '🎯',
        text: 'Racing photography fact: Panning technique creates that amazing motion blur effect!'
      },
      {
        icon: '⚡',
        text: 'Fun fact: AI can now detect race numbers faster than the human eye!'
      },
      {
        icon: '🏆',
        text: 'Photography tip: Golden hour lighting makes every racing shot look professional!'
      },
      {
        icon: '🏎️',
        text: 'Racing insight: The fastest F1 pit stop on record was just 1.82 seconds!'
      },
      {
        icon: '📊',
        text: 'Photography fact: Sports photographers shoot at 1/1000s to freeze fast action.'
      },
      {
        icon: '🎨',
        text: 'Did you know? Motion blur can make a 20mph go-kart look like a Formula 1 car!'
      },
      {
        icon: '⚡',
        text: 'Pro tip: Back-button focus helps track moving subjects more accurately.'
      },
      {
        icon: '🔥',
        text: 'Racing fact: Tire temperature can affect grip by up to 30% - just like photo quality!'
      },
      {
        icon: '📷',
        text: 'Photography wisdom: The best racing shots happen in the 3 seconds after the checkered flag.'
      },
      {
        icon: '🎯',
        text: 'Fun fact: Rally photographers change positions faster than drivers change gears!'
      },
      {
        icon: '⏱️',
        text: 'Time-saving tip: AI can process 1000 racing photos in the time it takes to drink one coffee!'
      }
    ];
    
    this.errorMessages = {
      'network': {
        icon: '🌐',
        title: 'Connection Timeout',
        message: 'Looks like the connection hit a speed bump!',
        suggestions: [
          'Check your internet connection',
          'Try again in a few moments',
          'Make sure you\'re not in airplane mode'
        ]
      },
      'file_too_large': {
        icon: '📏',
        title: 'Image Too Large',
        message: 'That\'s one massive racing photo!',
        suggestions: [
          'Try using the built-in image resizing option',
          'Compress the image before upload',
          'Use JPEG format for smaller file sizes'
        ]
      },
      'unsupported_format': {
        icon: '🖼️',
        title: 'Unsupported Format',
        message: 'That file format is not supported for analysis.',
        suggestions: [
          'Convert to JPEG, PNG, or WebP',
          'Check if the file is corrupted',
          'Try a different image'
        ]
      },
      'no_images_found': {
        icon: '🔍',
        title: 'No Images in Folder',
        message: 'This folder seems to be empty of racing photos!',
        suggestions: [
          'Select a different folder',
          'Make sure images are in supported formats (JPEG, PNG, WebP)',
          'Check if images are in subfolders'
        ]
      },
      'analysis_failed': {
        icon: '🤖',
        title: 'Analysis Failed',
        message: 'Our AI took a wrong turn on this one.',
        suggestions: [
          'Try a different image',
          'Check image quality and lighting',
          'Retry with a different AI model'
        ]
      },
      'default': {
        icon: '⚠️',
        title: 'Something Went Wrong',
        message: 'We hit an unexpected bump in the road.',
        suggestions: [
          'Try the action again',
          'Restart the application if the problem persists',
          'Check the console for more details'
        ]
      }
    };
    
    this.successMessages = {
      'batch_complete': {
        icon: '🏁',
        title: 'Race Analysis Complete!',
        celebration: 'full'
      },
      'single_complete': {
        icon: '✨',
        title: 'Perfect Shot Analyzed!',
        celebration: 'minimal'
      },
    };
    
    this.init();
  }
  
  init() {
    // Apply delight level classes
    document.body.classList.add(`delight-level-${this.settings.level}`);
    
    if (this.settings.respectsReducedMotion) {
      document.body.classList.add('delight-reduced-motion');
    }
    
    // Bind events
    this.bindEvents();
    
    console.log('🎉 Delight System initialized with level:', this.settings.level);
  }
  
  bindEvents() {
    // Enhanced button interactions
    document.addEventListener('click', (e) => {
      if (e.target.matches('.btn, button')) {
        this.addButtonRipple(e.target, e);
      }
    });
    
    // Enhanced input interactions
    document.addEventListener('input', (e) => {
      if (e.target.matches('input, textarea')) {
        this.handleInputChange(e.target);
      }
    });
    
    // File drop enhancements
    document.addEventListener('dragenter', (e) => {
      if (e.target.closest('.delight-drop-zone')) {
        e.target.closest('.delight-drop-zone').classList.add('active');
      }
    });
    
    document.addEventListener('dragleave', (e) => {
      if (e.target.closest('.delight-drop-zone')) {
        e.target.closest('.delight-drop-zone').classList.remove('active');
      }
    });
  }
  
  // ====================================
  // LOADING & PROGRESS DELIGHT
  // ====================================
  
  showEnhancedLoading(options = {}) {
    const {
      container = document.body,
      totalFiles = 1,
      showFunFacts = true,
      showProgress = true
    } = options;
    
    // Remove any existing loading
    this.hideEnhancedLoading();
    
    const loadingContainer = this.createElement('div', {
      className: 'delight-loading-container delight-bounce-in',
      id: 'delight-loading'
    });
    
    // Get random loading message
    const message = this.getRandomLoadingMessage();
    
    loadingContainer.innerHTML = `
      <div class="delight-loading-race-car">${message.icon}</div>
      <div class="delight-loading-message">${message.title}</div>
      <div class="delight-loading-submessage">${message.subtitle}</div>
      
      ${showProgress ? `
        <div class="delight-progress-track">
          <div class="delight-progress-car" id="delight-progress-bar" style="width: 0%"></div>
        </div>
        <div id="delight-progress-text">Starting analysis...</div>
      ` : ''}
      
      ${showFunFacts ? `
        <div class="delight-processing-fun" id="delight-fun-facts" style="display: none;">
          <div class="delight-fun-fact">
            <span class="delight-fun-icon">💡</span>
            <span id="delight-fun-text">Preparing fun facts...</span>
          </div>
        </div>
      ` : ''}
    `;
    
    container.appendChild(loadingContainer);
    
    // Start fun facts rotation after 3 seconds
    if (showFunFacts) {
      setTimeout(() => {
        this.startFunFactsRotation();
      }, 3000);
    }
    
    // Rotate loading messages
    this.startLoadingMessageRotation();
    
    return loadingContainer;
  }
  
  updateProgress(progress, message = '') {
    const progressBar = document.getElementById('delight-progress-bar');
    const progressText = document.getElementById('delight-progress-text');
    
    if (progressBar) {
      progressBar.style.width = `${Math.min(progress, 100)}%`;
    }
    
    if (progressText && message) {
      progressText.textContent = message;
    }
    
    // Milestone celebrations removed for professional use
  }
  
  // checkMilestones method removed
  
  // showMilestone method removed
  
  hideEnhancedLoading() {
    const existing = document.getElementById('delight-loading');
    if (existing) {
      existing.classList.add('delight-hidden');
      setTimeout(() => existing.remove(), 300);
    }
    
    this.stopLoadingMessageRotation();
    this.stopFunFactsRotation();
  }
  
  startLoadingMessageRotation() {
    let currentIndex = 0;
    this.messageInterval = setInterval(() => {
      const messageEl = document.querySelector('.delight-loading-message');
      const submessageEl = document.querySelector('.delight-loading-submessage');
      const iconEl = document.querySelector('.delight-loading-race-car');
      
      if (!messageEl) return;
      
      currentIndex = (currentIndex + 1) % this.loadingMessages.length;
      const message = this.loadingMessages[currentIndex];
      
      // Smooth transition
      messageEl.style.opacity = '0';
      submessageEl.style.opacity = '0';
      iconEl.style.opacity = '0';
      
      setTimeout(() => {
        messageEl.textContent = message.title;
        submessageEl.textContent = message.subtitle;
        iconEl.textContent = message.icon;
        
        messageEl.style.opacity = '1';
        submessageEl.style.opacity = '1';
        iconEl.style.opacity = '1';
      }, 200);
    }, 4000);
  }
  
  stopLoadingMessageRotation() {
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
      this.messageInterval = null;
    }
  }
  
  startFunFactsRotation() {
    const funFactsContainer = document.getElementById('delight-fun-facts');
    const funTextEl = document.getElementById('delight-fun-text');
    
    if (!funFactsContainer || !funTextEl) return;
    
    funFactsContainer.style.display = 'block';
    
    let factIndex = 0;
    
    const showNextFact = () => {
      const fact = this.funFacts[factIndex];
      const iconEl = funFactsContainer.querySelector('.delight-fun-icon');
      
      // Fade out
      funTextEl.style.opacity = '0';
      iconEl.style.opacity = '0';
      
      setTimeout(() => {
        funTextEl.textContent = fact.text;
        iconEl.textContent = fact.icon;
        
        // Fade in
        funTextEl.style.opacity = '1';
        iconEl.style.opacity = '1';
        
        factIndex = (factIndex + 1) % this.funFacts.length;
      }, 300);
    };
    
    // Show first fact immediately
    showNextFact();
    
    // Rotate facts every 6 seconds
    this.factInterval = setInterval(showNextFact, 6000);
  }
  
  stopFunFactsRotation() {
    if (this.factInterval) {
      clearInterval(this.factInterval);
      this.factInterval = null;
    }
  }
  
  // ====================================
  // ERROR HANDLING DELIGHT
  // ====================================
  
  showFriendlyError(errorType = 'default', customMessage = null, actions = []) {
    const errorData = this.errorMessages[errorType] || this.errorMessages.default;
    
    const errorContainer = this.createElement('div', {
      className: 'delight-error-container delight-slide-up',
      id: 'delight-error'
    });
    
    const actionButtons = actions.map(action => 
      `<button class="${action.primary ? 'delight-retry-btn' : 'delight-help-btn'}" 
               onclick="${action.handler}">
         ${action.text}
       </button>`
    ).join('');
    
    errorContainer.innerHTML = `
      <div class="delight-error-header">
        <div class="delight-error-icon">${errorData.icon}</div>
        <h3 class="delight-error-title">${errorData.title}</h3>
      </div>
      
      <div class="delight-error-message">
        ${customMessage || errorData.message}
      </div>
      
      <div class="delight-error-suggestions">
        <h4>💡 Here's what you can try:</h4>
        <ul>
          ${errorData.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
        </ul>
      </div>
      
      ${actions.length > 0 ? `
        <div class="delight-error-actions">
          ${actionButtons}
        </div>
      ` : ''}
    `;
    
    // Remove existing errors
    const existing = document.getElementById('delight-error');
    if (existing) existing.remove();
    
    // Add to the appropriate container
    const container = document.querySelector('.content-section.active-section') || document.body;
    container.appendChild(errorContainer);
    
    // Auto-remove after 10 seconds unless it has actions
    if (actions.length === 0) {
      setTimeout(() => {
        errorContainer.classList.add('delight-hidden');
        setTimeout(() => errorContainer.remove(), 300);
      }, 10000);
    }
    
    return errorContainer;
  }
  
  hideError() {
    const errorEl = document.getElementById('delight-error');
    if (errorEl) {
      errorEl.classList.add('delight-hidden');
      setTimeout(() => errorEl.remove(), 300);
    }
  }
  
  // ====================================
  // SUCCESS CELEBRATIONS
  // ====================================
  
  showSuccess(type = 'single_complete', stats = {}, duration = 5000) {
    const successData = this.successMessages[type] || this.successMessages.single_complete;
    
    const successContainer = this.createElement('div', {
      className: 'delight-success-container delight-bounce-in',
      id: 'delight-success'
    });
    
    const statsHtml = Object.keys(stats).length > 0 ? `
      <div class="delight-success-stats">
        ${Object.entries(stats).map(([label, value]) => `
          <div class="delight-stat-card">
            <span class="delight-stat-number">${value}</span>
            <span class="delight-stat-label">${label}</span>
          </div>
        `).join('')}
      </div>
    ` : '';
    
    successContainer.innerHTML = `
      <div class="delight-success-header">
        <div class="delight-success-icon">${successData.icon}</div>
        <h3 class="delight-success-title">${successData.title}</h3>
      </div>
      
      ${successData.message ? `
        <div class="delight-success-message">${successData.message}</div>
      ` : ''}
      
      ${statsHtml}
    `;
    
    // Remove existing success messages
    const existing = document.getElementById('delight-success');
    if (existing) existing.remove();
    
    const container = document.querySelector('.content-section.active-section') || document.body;
    container.appendChild(successContainer);
    
    // Confetti removed for professional use
    
    // Auto-remove
    setTimeout(() => {
      successContainer.classList.add('delight-hidden');
      setTimeout(() => successContainer.remove(), 300);
    }, duration);

    return successContainer;
  }

  /**
   * New-style inline completion card.
   *
   * Replaces the big "Race Analysis Complete!" overlay (`showSuccess('batch_complete', ...)`)
   * with a subtle banner + name editor. The caller can save the custom name via the
   * `rename-execution` IPC, which appends an EXECUTION_META_UPDATE event to the JSONL.
   *
   * options:
   *   - executionId   (required) the execution to rename
   *   - stats         object of { label -> value } shown as compact chips
   *   - durationSec   number shown in the banner ("✓ Analysis complete · 52.1s")
   *   - defaultName   prefilled input (usually the auto-generated title)
   *   - sportLabel    optional, used to synthesize chip suggestions
   *   - onDismiss     callback fired when Skip clicked OR Save succeeds
   */
  showAnalysisCompletionCard(options = {}) {
    const {
      executionId,
      stats = {},
      durationSec,
      defaultName = '',
      sportLabel = '',
      onDismiss
    } = options;

    // Remove any existing variants so consecutive runs don't stack.
    const existingSuccess = document.getElementById('delight-success');
    if (existingSuccess) existingSuccess.remove();
    const existingCard = document.getElementById('analysis-completion-card');
    if (existingCard) existingCard.remove();

    const card = this.createElement('div', {
      className: 'analysis-completion-card delight-fade-in',
      id: 'analysis-completion-card'
    });

    const statsHtml = Object.keys(stats).length
      ? `<div class="acc-stats">${Object.entries(stats).map(([label, value]) => `
            <div class="acc-stat"><span class="acc-stat-value">${value}</span><span class="acc-stat-label">${label}</span></div>
          `).join('')}</div>`
      : '';

    // Chip suggestions — synthesized from the current date + sport, no heavy logic.
    const today = new Date();
    const dateLabel = today.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    const chipSource = [
      sportLabel ? `${sportLabel} · ${dateLabel}` : null,
      dateLabel,
      sportLabel ? `${sportLabel} — Morning` : null
    ].filter(Boolean);

    const chipsHtml = chipSource.length
      ? `<div class="acc-chips">${chipSource.map(c =>
          `<button type="button" class="acc-chip" data-chip="${c.replace(/"/g, '&quot;')}">${c}</button>`
        ).join('')}</div>`
      : '';

    const durationLabel = typeof durationSec === 'number'
      ? `${durationSec.toFixed(1)}s`
      : '';

    card.innerHTML = `
      <div class="acc-banner">
        <span class="acc-check">✓</span>
        <span class="acc-banner-text">Analysis complete${durationLabel ? ` · ${durationLabel}` : ''}</span>
      </div>
      <label class="acc-label" for="acc-name-input">Name this analysis (optional)</label>
      <input type="text" id="acc-name-input" class="acc-name-input" maxlength="120"
             placeholder="e.g. Giro di Lombardia 2026 · Start"
             value="${(defaultName || '').replace(/"/g, '&quot;')}">
      ${chipsHtml}
      ${statsHtml}
      <div class="acc-actions">
        <button type="button" class="acc-btn acc-btn-skip">Skip</button>
        <button type="button" class="acc-btn acc-btn-save">Save name</button>
      </div>
    `;

    const container = document.querySelector('.content-section.active-section') || document.body;
    container.appendChild(card);

    const input = card.querySelector('#acc-name-input');
    const saveBtn = card.querySelector('.acc-btn-save');
    const skipBtn = card.querySelector('.acc-btn-skip');

    // Chip clicks prefill the input.
    card.querySelectorAll('.acc-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-chip') || '';
        input.focus();
      });
    });

    const dismiss = () => {
      card.classList.add('delight-hidden');
      setTimeout(() => card.remove(), 300);
      if (typeof onDismiss === 'function') onDismiss();
    };

    skipBtn.addEventListener('click', dismiss);

    const doSave = async () => {
      const name = (input.value || '').trim();
      if (!name || !executionId) {
        dismiss();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        if (window.api && window.api.invoke) {
          await window.api.invoke('rename-execution', executionId, name);
        }
      } catch (err) {
        console.warn('[Delight] rename-execution failed:', err);
      } finally {
        dismiss();
      }
    };

    saveBtn.addEventListener('click', doSave);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      else if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
    });

    // Auto-focus so user can just type + Enter.
    setTimeout(() => input.focus(), 50);

    return card;
  }

  // showConfetti method removed
  
  // showSpecialAchievement method removed
  
  // ====================================
  // EMPTY STATES DELIGHT
  // ====================================
  
  showEmptyState(options = {}) {
    const {
      container,
      icon = '📂',
      title = 'No Content Yet',
      message = 'Get started by adding some content.',
      primaryAction = null,
      secondaryAction = null
    } = options;
    
    const emptyContainer = this.createElement('div', {
      className: 'delight-empty-state delight-fade-in'
    });
    
    const actionsHtml = (primaryAction || secondaryAction) ? `
      <div class="delight-empty-actions">
        ${primaryAction ? `
          <button class="delight-cta-primary" onclick="${primaryAction.handler}">
            ${primaryAction.text}
          </button>
        ` : ''}
        ${secondaryAction ? `
          <button class="delight-cta-secondary" onclick="${secondaryAction.handler}">
            ${secondaryAction.text}
          </button>
        ` : ''}
      </div>
    ` : '';
    
    emptyContainer.innerHTML = `
      <div class="delight-empty-icon">${icon}</div>
      <div class="delight-empty-title">${title}</div>
      <div class="delight-empty-message">${message}</div>
      ${actionsHtml}
    `;
    
    if (container) {
      container.appendChild(emptyContainer);
    }
    
    return emptyContainer;
  }
  
  // ====================================
  // MICRO-INTERACTIONS
  // ====================================
  
  addButtonRipple(button, event) {
    if (!button.classList.contains('delight-button')) {
      button.classList.add('delight-button');
    }
    
    // Create ripple effect
    const rect = button.getBoundingClientRect();
    const ripple = this.createElement('span', {
      className: 'delight-ripple'
    });
    
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    ripple.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: 0;
      height: 0;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.6);
      transform: translate(-50%, -50%);
      animation: ripple 0.6s linear;
      pointer-events: none;
    `;
    
    button.appendChild(ripple);
    
    setTimeout(() => {
      ripple.remove();
    }, 600);
  }
  
  handleInputChange(input) {
    input.classList.add('delight-input');
    
    // Add validation feedback
    if (input.checkValidity()) {
      input.classList.remove('delight-input-invalid');
      input.classList.add('delight-input-valid');
    } else if (input.value !== '') {
      input.classList.remove('delight-input-valid');
      input.classList.add('delight-input-invalid');
    }
  }
  
  animateTableRow(row) {
    row.classList.add('delight-table-row');
  }
  
  enhanceImagePreview(img) {
    img.classList.add('delight-image-preview');
  }
  
  // ====================================
  // UTILITY METHODS
  // ====================================
  
  createElement(tag, attributes = {}) {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'textContent') {
        element.textContent = value;
      } else {
        element.setAttribute(key, value);
      }
    });
    return element;
  }
  
  getRandomLoadingMessage() {
    return this.loadingMessages[Math.floor(Math.random() * this.loadingMessages.length)];
  }
  
  setDelightLevel(level) {
    document.body.classList.remove(`delight-level-${this.settings.level}`);
    this.settings.level = level;
    document.body.classList.add(`delight-level-${level}`);
    
    console.log('🎨 Delight level changed to:', level);
  }
  
  enableProfessionalMode() {
    document.body.classList.add('delight-professional-mode');
    this.setDelightLevel('professional');
  }
  
  disableProfessionalMode() {
    document.body.classList.remove('delight-professional-mode');
    this.setDelightLevel('full');
  }
  
  // toggleConfetti method removed
  
  // ====================================
  // RACING-SPECIFIC DELIGHT MOMENTS
  // ====================================
  
  showProcessingQueue(queueInfo) {
    const { position, estimatedWait, averageProcessingTime } = queueInfo;
    
    const queueContainer = this.createElement('div', {
      className: 'delight-queue-info delight-slide-up',
      id: 'delight-queue'
    });
    
    queueContainer.innerHTML = `
      <div class="delight-queue-content">
        <div class="delight-queue-header">
          <span class="delight-queue-icon">🏁</span>
          <div>
            <div class="delight-queue-title">In the Processing Queue</div>
            <div class="delight-queue-subtitle">Position #${position} • ~${estimatedWait}s wait</div>
          </div>
        </div>
        <div class="delight-queue-progress">
          <div class="delight-queue-cars">
            ${Array.from({length: Math.min(position, 5)}, (_, i) => 
              `<span class="delight-queue-car" style="animation-delay: ${i * 0.2}s">🏎️</span>`
            ).join('')}
          </div>
          <div class="delight-queue-message">Your images are lining up for the starting grid...</div>
        </div>
      </div>
    `;
    
    const container = document.querySelector('.content-section.active-section') || document.body;
    container.appendChild(queueContainer);
    
    return queueContainer;
  }
  
  // showQuickWins method removed
  
  // showQuickWinNotification method removed
  
  showWorkflowTips(context) {
    const tips = {
      'batch_processing': {
        icon: '📚',
        title: 'Batch Processing Tip',
        message: 'While your images process, why not organize tomorrow\'s shoot or review your camera settings?'
      },
      'large_folder': {
        icon: '☕',
        title: 'Coffee Break Time!',
        message: 'Perfect time for a quick break. Large batches give you time to step away and return to finished results.'
      },
      'weekend_processing': {
        icon: '🏁',
        title: 'Race Weekend Workflow',
        message: 'Pro tip: Process practice session photos first to check your settings before the main race!'
      }
    };
    
    const tip = tips[context];
    if (!tip) return;
    
    const tipContainer = this.createElement('div', {
      className: 'delight-workflow-tip delight-fade-in'
    });
    
    tipContainer.innerHTML = `
      <div class="delight-tip-content">
        <div class="delight-tip-header">
          <span class="delight-tip-icon">${tip.icon}</span>
          <strong class="delight-tip-title">${tip.title}</strong>
        </div>
        <p class="delight-tip-message">${tip.message}</p>
      </div>
    `;
    
    // Insert after loading container if it exists
    const loadingContainer = document.getElementById('delight-loading');
    if (loadingContainer && loadingContainer.parentNode) {
      loadingContainer.parentNode.insertBefore(tipContainer, loadingContainer.nextSibling);
    }
  }
  
  showProgressiveDisclosure(stage, info) {
    // Show additional information as processing progresses
    const disclosures = {
      'upload_complete': 'Images uploaded successfully ✓',
      'ai_analysis_start': 'AI vision models activating 🤖',
      'number_detection': `Detecting race numbers... ${info.detected || 0} found so far`,
      'metadata_processing': 'Enriching images with race data 📊',
      'final_checks': 'Running quality checks and finalizing results ✨'
    };
    
    const message = disclosures[stage];
    if (!message) return;
    
    // Update or create progressive disclosure element
    let disclosureEl = document.getElementById('delight-progressive-disclosure');
    
    if (!disclosureEl) {
      disclosureEl = this.createElement('div', {
        className: 'delight-progressive-disclosure',
        id: 'delight-progressive-disclosure'
      });
      
      const loadingContainer = document.getElementById('delight-loading');
      if (loadingContainer && loadingContainer.parentNode) {
        loadingContainer.parentNode.insertBefore(disclosureEl, loadingContainer.nextSibling);
      }
    }
    
    // Add new stage
    const stageEl = this.createElement('div', {
      className: 'delight-disclosure-stage delight-slide-up'
    });
    
    stageEl.innerHTML = `
      <div class="delight-disclosure-content">
        <span class="delight-disclosure-check">✓</span>
        <span class="delight-disclosure-message">${message}</span>
      </div>
    `;
    
    disclosureEl.appendChild(stageEl);
    
    // Auto-scroll to show latest stage
    disclosureEl.scrollTop = disclosureEl.scrollHeight;
  }

  // ====================================
  // INTEGRATION HELPERS
  // ====================================
  
  enhanceExistingElements() {
    // Enhance existing buttons
    document.querySelectorAll('button, .btn').forEach(btn => {
      if (!btn.classList.contains('delight-button')) {
        btn.classList.add('delight-button');
      }
    });
    
    // Enhance existing inputs
    document.querySelectorAll('input, textarea, select').forEach(input => {
      if (!input.classList.contains('delight-input')) {
        input.classList.add('delight-input');
      }
    });
    
    // Enhance existing images
    document.querySelectorAll('img.clickable-image').forEach(img => {
      this.enhanceImagePreview(img);
    });
    
    // Enhance drop zones
    document.querySelectorAll('[data-drop-zone]').forEach(zone => {
      zone.classList.add('delight-drop-zone');
    });
  }
}

// CSS for ripple effect (injected dynamically)
const rippleCSS = `
@keyframes ripple {
  to {
    width: 100px;
    height: 100px;
    opacity: 0;
  }
}
`;

// Inject ripple CSS
if (!document.querySelector('#delight-ripple-styles')) {
  const style = document.createElement('style');
  style.id = 'delight-ripple-styles';
  style.textContent = rippleCSS;
  document.head.appendChild(style);
}

// Initialize global delight system
if (typeof window !== 'undefined') {
  window.delightSystem = new DelightSystem();
  
  // Auto-enhance existing elements when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.delightSystem.enhanceExistingElements();
    });
  } else {
    window.delightSystem.enhanceExistingElements();
  }
  
  console.log('🚀 Racetagger Delight System loaded!');
}