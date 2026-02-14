/**
 * Racetagger Desktop - Desktop UI Interactions
 * Handles desktop-specific UI interactions like window controls and navigation
 */

document.addEventListener('DOMContentLoaded', () => {
  const windowClose = document.querySelector('.window-control.window-close');
  const windowMinimize = document.querySelector('.window-control.window-minimize');
  const windowMaximize = document.querySelector('.window-control.window-maximize');
  const sidebarNavItems = document.querySelectorAll('.nav-item');
  
  // Elementi per la funzionalità di estrazione anteprima RAW
  const extractRawPreviewBtn = document.getElementById('extract-raw-preview-btn');
  const rawPreviewContainer = document.getElementById('raw-preview-container');
  const rawPreviewStatus = document.getElementById('raw-preview-status');
  const rawPreviewImage = document.getElementById('raw-preview-image');
  const rawOriginalFilename = document.getElementById('raw-original-filename');
  const rawPreviewFilename = document.getElementById('raw-preview-filename');
  const rawPreviewPath = document.getElementById('raw-preview-path');
  const rawPreviewError = document.getElementById('raw-preview-error');

  if (windowClose) {
    windowClose.addEventListener('click', () => {
      if (window.api) {
        window.api.send('window-close');
      }
    });
  }
  if (windowMinimize) {
    windowMinimize.addEventListener('click', () => {
      if (window.api) {
        window.api.send('window-minimize');
      }
    });
  }
  if (windowMaximize) {
    windowMaximize.addEventListener('click', () => {
      if (window.api) {
        window.api.send('window-maximize');
      }
    });
  }

  sidebarNavItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Ottieni l'href del link
      const href = item.getAttribute('href');
      
      // Se l'href è un link esterno (.html), consenti il comportamento predefinito
      if (href && (href.endsWith('.html') || href.startsWith('http'))) {
        // Non blocchiamo il comportamento predefinito, lasciamo che il browser gestisca il link
        sidebarNavItems.forEach(navItem => navItem.classList.remove('active'));
        item.classList.add('active');
        return; // Esci dalla funzione per permettere la navigazione predefinita
      }
      
      // Altrimenti gestiamo la navigazione interna
      e.preventDefault();
      sidebarNavItems.forEach(navItem => navItem.classList.remove('active'));
      item.classList.add('active');
      // Use data-section attribute if available, otherwise fall back to nav-text
      const sectionName = item.dataset.section || item.querySelector('.nav-text').textContent.trim().toLowerCase();
      handleNavigation(sectionName);
    });
  });

  
  const activeNavItem = document.querySelector('.sidebar-nav .nav-item.active .nav-text');
  if (activeNavItem) {
    handleNavigation(activeNavItem.textContent.trim().toLowerCase());
  } else {
    handleNavigation('home'); 
  }
  
  // Gestione dell'estrazione delle anteprime RAW
  if (extractRawPreviewBtn && window.api) {
    // Gestione click sul pulsante di conversione RAW
    extractRawPreviewBtn.addEventListener('click', () => {
      // Resetta l'interfaccia
      if (rawPreviewContainer) rawPreviewContainer.style.display = 'none';
      if (rawPreviewError) {
        rawPreviewError.textContent = '';
        rawPreviewError.style.display = 'none';
      }
      
      // Invia la richiesta al main process
      window.api.send('extract-raw-preview');
    });
    
    // Handle status updates
    window.api.receive('raw-preview-status', (status) => {
      if (rawPreviewStatus) {
        let statusText = '';
        
        switch (status.status) {
          case 'selecting':
            statusText = 'Select a RAW file...';
            break;
          case 'extracting':
            statusText = `Estrazione anteprima da ${status.file}...`;
            break;
          case 'canceled':
            statusText = 'Operazione annullata.';
            break;
          default:
            statusText = status.message || 'Processing...';
        }
        
        rawPreviewStatus.textContent = statusText;
      }
    });
    
    // Gestione risultato dell'estrazione
    window.api.receive('raw-preview-extracted', (result) => {
      if (rawPreviewContainer && rawPreviewImage && rawOriginalFilename && rawPreviewFilename && rawPreviewPath) {
        // Popola i dettagli
        rawOriginalFilename.textContent = result.originalFilename;
        rawPreviewFilename.textContent = result.previewFilename;
        rawPreviewPath.textContent = result.previewPath;
        
        // Imposta l'immagine
        rawPreviewImage.src = `data:image/jpeg;base64,${result.previewBase64}`;
        
        // Mostra il container
        rawPreviewContainer.style.display = 'block';
        
        // Update status
        if (rawPreviewStatus) {
          rawPreviewStatus.textContent = 'Preview extracted successfully';
        }
      }
    });
    
    // Gestione errori
    window.api.receive('raw-preview-error', (error) => {
      if (rawPreviewError) {
        rawPreviewError.textContent = error.message || 'An error occurred during preview extraction';
        rawPreviewError.style.display = 'block';
      }
      
      if (rawPreviewStatus) {
        rawPreviewStatus.textContent = 'Error during extraction';
      }
    });
  }
});

function handleNavigation(sectionName) {
  const contentSections = document.querySelectorAll('.content-section');
  contentSections.forEach(section => section.classList.remove('active-section'));

  const targetSectionId = `section-${sectionName}`;
  const targetSection = document.getElementById(targetSectionId);

  if (targetSection) {
    targetSection.classList.add('active-section');

    // Dispatch section-changed event for components that need to react
    document.dispatchEvent(new CustomEvent('section-changed', {
      detail: { section: sectionName }
    }));

    // Section-specific initialization
    if (sectionName === 'home') { loadRecentPresets(); }
    // Settings section is handled via the section-changed event in settings.js
  } else {
    const homeSection = document.getElementById('section-home');
    if (homeSection) {
        homeSection.classList.add('active-section');
    }
  }
}

async function loadRecentPresets() {
  const recentProjectsList = document.getElementById('recent-projects-list');
  if (!recentProjectsList) { return; }

  if (window.api && window.api.invoke) {
    try {
      const result = await window.api.invoke('db-get-participant-presets');

      // Controllo di sicurezza per gestire risposte null o undefined
      if (!result) {
        recentProjectsList.innerHTML = '<li>Errore nel caricamento dei preset partecipanti: risposta non valida.</li>';
        return;
      }

      if (result.success && result.data && result.data.length > 0) {
        // Take the most recent 5 presets
        const recentPresets = result.data.slice(0, 5);
        recentProjectsList.innerHTML = recentPresets.map(preset =>
          `<li><a href="#" data-preset-id="${preset.id}" class="recent-preset-link">${preset.name}</a> (${preset.preset_participants?.length || 0} partecipanti, ${new Date(preset.updated_at || preset.created_at).toLocaleString()})</li>`
        ).join('');
        // TODO: Add event listeners for recent-preset-link to open preset details
      } else {
        recentProjectsList.innerHTML = '<li>Nessun preset di partecipanti trovato.</li>';
      }
    } catch (error) {
      recentProjectsList.innerHTML = '<li>Errore nel caricamento dei preset.</li>';
    }
  } else {
    recentProjectsList.innerHTML = '<li>API non disponibile. Esegui l\'applicazione in Electron per accedere ai preset.</li>';
  }
}

function updateUserInfo(user) {
  const sidebarUserNameElement = document.getElementById('sidebar-user-name'); 
  if (sidebarUserNameElement) {
    if (user && user.email) {
      const username = user.email.split('@')[0];
      sidebarUserNameElement.textContent = username;
      const userAvatar = document.querySelector('.user-avatar');
      if (userAvatar) {
        userAvatar.textContent = username.charAt(0).toUpperCase();
      }
    } else {
      sidebarUserNameElement.textContent = 'Guest';
      const userAvatar = document.querySelector('.user-avatar');
      if (userAvatar) { userAvatar.textContent = 'G'; }
    }
  }
}

// Initialize resize optimization controls
function initializeResizeControls() {
  const resizeEnabledToggle = document.getElementById('resize-enabled');
  const resizePresetsContainer = document.getElementById('resize-presets-container');
  const resizeEstimate = document.getElementById('resize-estimate');
  const sizeReductionEstimate = document.getElementById('size-reduction-estimate');
  const presetRadios = document.querySelectorAll('input[name="resize-preset"]');

  if (!resizeEnabledToggle || !resizePresetsContainer || !resizeEstimate) {
    return;
  }

  // Load saved preferences
  const savedEnabled = localStorage.getItem('resize-enabled') === 'true';
  const savedPreset = localStorage.getItem('resize-preset') || 'balanced';

  resizeEnabledToggle.checked = savedEnabled;
  
  // Initialize visual states
  const toggleContainer = resizeEnabledToggle.closest('.toggle-container');
  if (toggleContainer && savedEnabled) {
    toggleContainer.classList.add('enabled');
  }
  
  // Initialize visibility with proper styling
  if (savedEnabled) {
    resizePresetsContainer.style.display = 'block';
    resizeEstimate.style.display = 'block';
    resizePresetsContainer.style.opacity = '1';
    resizePresetsContainer.style.transform = 'translateY(0)';
    resizeEstimate.style.opacity = '1';
    resizeEstimate.style.transform = 'translateY(0)';
  } else {
    resizePresetsContainer.style.display = 'none';
    resizeEstimate.style.display = 'none';
    resizePresetsContainer.style.opacity = '0';
    resizePresetsContainer.style.transform = 'translateY(-10px)';
    resizeEstimate.style.opacity = '0';
    resizeEstimate.style.transform = 'translateY(-10px)';
  }

  // Set saved preset and initialize visual states
  const savedPresetRadio = document.querySelector(`input[name="resize-preset"][value="${savedPreset}"]`);
  if (savedPresetRadio) {
    savedPresetRadio.checked = true;
  }
  
  // Initialize preset option visual states
  presetRadios.forEach(radio => {
    const presetOption = radio.closest('.preset-option');
    if (presetOption) {
      if (radio.checked) {
        presetOption.classList.add('selected');
      } else {
        presetOption.classList.remove('selected');
      }
    }
  });

  // Update size estimate based on preset
  updateSizeEstimate(savedPreset);

  // Toggle event with smooth animations
  resizeEnabledToggle.addEventListener('change', function() {
    const isEnabled = this.checked;
    
    // Update toggle container styling
    const toggleContainer = this.closest('.toggle-container');
    if (toggleContainer) {
      if (isEnabled) {
        toggleContainer.classList.add('enabled');
      } else {
        toggleContainer.classList.remove('enabled');
      }
    }
    
    // Smooth show/hide animations
    if (isEnabled) {
      resizePresetsContainer.style.display = 'block';
      resizeEstimate.style.display = 'block';
      // Trigger reflow for animation
      resizePresetsContainer.offsetHeight;
      resizePresetsContainer.style.opacity = '1';
      resizePresetsContainer.style.transform = 'translateY(0)';
      resizeEstimate.style.opacity = '1';
      resizeEstimate.style.transform = 'translateY(0)';
    } else {
      resizePresetsContainer.style.opacity = '0';
      resizePresetsContainer.style.transform = 'translateY(-10px)';
      resizeEstimate.style.opacity = '0';
      resizeEstimate.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        resizePresetsContainer.style.display = 'none';
        resizeEstimate.style.display = 'none';
      }, 150);
    }
    
    // Save preference
    localStorage.setItem('resize-enabled', isEnabled.toString());
  });

  // Preset change events with visual feedback
  presetRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) {
        // Update preset option styling for visual feedback
        presetRadios.forEach(r => {
          const presetOption = r.closest('.preset-option');
          if (presetOption) {
            if (r.checked) {
              presetOption.classList.add('selected');
            } else {
              presetOption.classList.remove('selected');
            }
          }
        });
        
        // Save preference
        localStorage.setItem('resize-preset', this.value);

        // Update size estimate
        updateSizeEstimate(this.value);
      }
    });
  });

  function updateSizeEstimate(preset) {
    if (!sizeReductionEstimate) return;
    
    const estimates = {
      'fast': '70-85%',
      'balanced': '60-80%', 
      'quality': '40-70%'
    };
    
    sizeReductionEstimate.textContent = estimates[preset] || '60-80%';
  }
}

// Get current resize configuration
function getResizeConfig() {
  const resizeEnabled = document.getElementById('resize-enabled');
  const selectedPreset = document.querySelector('input[name="resize-preset"]:checked');
  
  if (!resizeEnabled || !resizeEnabled.checked) {
    return { enabled: false, preset: 'balanced' };
  }
  
  return {
    enabled: true,
    preset: selectedPreset ? selectedPreset.value : 'balanced'
  };
}

// Initialize resize controls when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure all elements are in DOM
  setTimeout(initializeResizeControls, 100);

  // Setup model download listeners
  setupModelDownloadListeners();
});

/**
 * Setup IPC listeners for model download progress
 * Shows modal during ONNX model downloads at app startup
 */
function setupModelDownloadListeners() {
  if (!window.api) {
    return;
  }

  const modal = document.getElementById('model-download-modal');
  const progressFill = document.getElementById('download-progress-fill');
  const percentText = document.getElementById('download-percent');
  const currentText = document.getElementById('download-current');
  const totalText = document.getElementById('download-total');
  const funFact = document.getElementById('download-fun-fact');

  if (!modal) {
    return;
  }

  const funFacts = [
    '\u{1F3CE}\uFE0F "Like downloading the latest telemetry data..."',
    '\u{1F3C1} "Preparing your pit crew for race day..."',
    '\u{1F4F8} "Loading high-speed recognition models..."',
    '\u{1F527} "Fine-tuning the detection algorithms..."',
    '\u{1F3C6} "Getting ready to identify champions..."',
    '\u{26A1} "Optimizing for lightning-fast detection..."'
  ];
  let factIndex = 0;
  let factInterval = null;

  window.api.receive('model-download-start', (data) => {
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    if (totalText) totalText.textContent = `${data.totalSizeMB.toFixed(1)} MB`;
    if (currentText) currentText.textContent = '0 MB';
    if (percentText) percentText.textContent = '0%';
    if (progressFill) progressFill.style.width = '0%';

    // Rotate fun facts every 3 seconds
    factInterval = setInterval(() => {
      factIndex = (factIndex + 1) % funFacts.length;
      if (funFact) funFact.textContent = funFacts[factIndex];
    }, 3000);
  });

  window.api.receive('model-download-progress', (data) => {
    const percent = Math.min(100, Math.round((data.downloadedMB / data.totalMB) * 100));
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${percent}%`;
    if (currentText) currentText.textContent = `${data.downloadedMB.toFixed(1)} MB`;
  });

  window.api.receive('model-download-complete', () => {
    if (factInterval) {
      clearInterval(factInterval);
      factInterval = null;
    }
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  });

  window.api.receive('model-download-error', (data) => {
    if (factInterval) {
      clearInterval(factInterval);
      factInterval = null;
    }
    // Show error state - user can close and retry on next app start
    if (funFact) {
      funFact.textContent = '\u{274C} Download failed. Please restart the app to retry.';
      funFact.style.color = 'var(--accent-danger, #ef4444)';
    }
  });
}

window.desktopUI = {
  updateUserInfo,
  getResizeConfig
};
