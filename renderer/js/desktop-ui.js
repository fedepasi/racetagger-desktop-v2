/**
 * Racetagger Desktop - Desktop UI Interactions
 * Handles desktop-specific UI interactions like window controls and navigation
 */

// DOM Elements (globali per questo script)
let projectModal, projectModalTitle, projectForm, projectNameInput, projectCsvInput, projectCsvInfo, projectIdInput, cancelProjectModalBtn, projectModalError;

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

  const createNewProjectBtn = document.getElementById('create-new-project-btn');
  if (createNewProjectBtn) {
    createNewProjectBtn.addEventListener('click', () => openProjectModal('create'));
  }

  projectModal = document.getElementById('project-modal');
  projectModalTitle = document.getElementById('project-modal-title');
  projectForm = document.getElementById('project-form');
  projectNameInput = document.getElementById('project-name-input');
  projectCsvInput = document.getElementById('project-csv-input');
  projectCsvInfo = document.getElementById('project-csv-info');
  projectIdInput = document.getElementById('project-id-input');
  cancelProjectModalBtn = document.getElementById('cancel-project-modal');
  projectModalError = document.getElementById('project-modal-error');

  if (cancelProjectModalBtn && projectModal) {
    cancelProjectModalBtn.addEventListener('click', () => {
      projectModal.style.display = 'none';
    });
  }

  if (projectForm && projectModal && projectNameInput && projectCsvInput && projectIdInput && projectModalTitle && projectModalError && projectCsvInfo) {
    projectForm.addEventListener('submit', handleProjectFormSubmit);
  }
  
  if (projectCsvInput && projectCsvInfo) {
    projectCsvInput.addEventListener('change', () => {
      if (projectCsvInput.files && projectCsvInput.files.length > 0) {
        projectCsvInfo.textContent = `Selected file: ${projectCsvInput.files[0].name}`;
      } else {
        if (!projectIdInput.value) { 
            projectCsvInfo.textContent = '';
        }
      }
    });
  }
  
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

async function handleProjectFormSubmit(e) {
  e.preventDefault();
  projectModalError.style.display = 'none';
  projectModalError.textContent = '';

  const name = projectNameInput.value.trim();
  const csvFile = projectCsvInput.files ? projectCsvInput.files[0] : null;
  const currentProjectId = projectIdInput.value;
  const mode = projectModal.dataset.mode || 'create';

  if (!name) {
    projectModalError.textContent = 'Project name is required.';
    projectModalError.style.display = 'block';
    return;
  }

  if (!window.api || !window.api.invoke) {
    projectModalError.textContent = 'API non disponibile. Esegui l\'applicazione in Electron per creare progetti.';
    projectModalError.style.display = 'block';
    return;
  }

  try {
    let projectDataResult;
    let operationSuccess = false;

    if (mode === 'create') {
      const createResult = await window.api.invoke('db-create-project', { name: name });
      
      // Controllo di sicurezza per gestire risposte null o undefined
      if (!createResult) {
        throw new Error('Invalid response from server during project creation.');
      }
      
      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Error during project creation.');
      }
      projectDataResult = createResult.data;
      alert(`Project "${projectDataResult.name}" created with ID: ${projectDataResult.id}`);
      operationSuccess = true;
      
      if (csvFile && projectDataResult.id) {
        const fileBuffer = await csvFile.arrayBuffer();
        const uploadResult = await window.api.invoke('db-upload-project-csv', {
          projectId: projectDataResult.id,
          csvFileBuffer: new Uint8Array(fileBuffer),
          csvFileName: csvFile.name
        });
        
        // Controllo di sicurezza per gestire risposte null o undefined
        if (!uploadResult) {
          throw new Error('Risposta non valida dal server durante il caricamento del CSV.');
        }
        
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || 'Error during CSV upload.');
        }
        alert(`CSV file "${csvFile.name}" associated with project.`);
        projectDataResult = uploadResult.data; 
      }
    } else if (mode === 'edit' && currentProjectId) {
      const updatePayload = { name: name };
      const updateResult = await window.api.invoke('db-update-project', { id: currentProjectId, projectData: updatePayload });
      
      // Controllo di sicurezza per gestire risposte null o undefined
      if (!updateResult) {
        throw new Error('Risposta non valida dal server durante la modifica del progetto.');
      }
      
      if (!updateResult.success || !updateResult.data) {
        throw new Error(updateResult.error || 'Error during project modification.');
      }
      projectDataResult = updateResult.data;
      alert(`Project "${projectDataResult.name}" modified successfully.`);
      operationSuccess = true;

      if (csvFile) { 
        const fileBuffer = await csvFile.arrayBuffer();
        const uploadResult = await window.api.invoke('db-upload-project-csv', {
          projectId: currentProjectId,
          csvFileBuffer: new Uint8Array(fileBuffer),
          csvFileName: csvFile.name
        });
        
        // Controllo di sicurezza per gestire risposte null o undefined
        if (!uploadResult) {
          throw new Error('Risposta non valida dal server durante l\'aggiornamento del CSV.');
        }
        
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || 'Error during CSV update.');
        }
        alert(`CSV file "${csvFile.name}" updated for project.`);
        projectDataResult = uploadResult.data;
      }
    } else {
      throw new Error('Modalità non valida o ID progetto mancante per la modifica.');
    }
    
    if (operationSuccess) {
      projectModal.style.display = 'none';
      loadAllProjects();
    }
  } catch (error) {
    console.error(`Error saving project (mode: ${mode}):`, error);
    projectModalError.textContent = `Error: ${error.message}`;
    projectModalError.style.display = 'block';
  }
}

function openProjectModal(mode, project = null) {
  if (!projectModal || !projectModalTitle || !projectForm || !projectNameInput || !projectCsvInput || !projectIdInput || !projectModalError || !projectCsvInfo) {
    console.error('Modal elements not found! Make sure the DOM is loaded.');
    return;
  }

  projectModal.dataset.mode = mode;
  projectForm.reset();  // Questa era la riga 145 problematica
  projectCsvInfo.textContent = '';
  projectModalError.style.display = 'none';
  projectModalError.textContent = '';

  if (mode === 'create') {
    projectModalTitle.textContent = 'New Project';
    projectIdInput.value = '';
    projectNameInput.value = '';
  } else if (mode === 'edit' && project) {
    projectModalTitle.textContent = 'Edit Project';
    projectIdInput.value = project.id;
    projectNameInput.value = project.name;
    if (project.base_csv_storage_path) {
      projectCsvInfo.textContent = `CSV attuale: ${project.base_csv_storage_path.split('/').pop()}`;
    } else {
      projectCsvInfo.textContent = 'No base CSV currently associated.';
    }
  }
  projectModal.style.display = 'flex';
}

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
    else if (sectionName === 'progetti') { loadAllProjects(); }
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

async function loadAllProjects() {
  const projectsListContainer = document.getElementById('projects-list-container');
  if (!projectsListContainer) { return; }

  if (window.api && window.api.invoke) {
    try {
      projectsListContainer.innerHTML = '<p>Caricamento progetti...</p>';
      const result = await window.api.invoke('db-get-all-projects');
      
      // Controllo di sicurezza per gestire risposte null o undefined
      if (!result) {
        projectsListContainer.innerHTML = '<p>Errore nel caricamento dei progetti: risposta non valida.</p>';
        return;
      }
      
      if (result.success && result.data && result.data.length > 0) {
        projectsListContainer.innerHTML = `
          <ul class="project-list">
            ${result.data.map(project => `
              <li class="project-list-item" data-project-id="${project.id}">
                <span class="project-name">${project.name}</span>
                <span class="project-date">Ultima modifica: ${new Date(project.updated_at).toLocaleDateString()}</span>
                <div class="project-actions">
                  <button class="btn btn-secondary btn-sm view-project-btn" data-project-id="${project.id}">Apri</button>
                  <button class="btn btn-secondary btn-sm edit-project-btn" data-project-id="${project.id}" data-project-name="${project.name}" data-project-csv="${project.base_csv_storage_path || ''}">Modifica</button>
                  <button class="btn btn-danger btn-sm delete-project-btn" data-project-id="${project.id}">Elimina</button>
                </div>
              </li>
            `).join('')}
          </ul>`;
        addProjectActionListeners();
      } else if (result && result.success) {
        projectsListContainer.innerHTML = '<p>No projects found. Start by creating one!</p>';
      } else {
        projectsListContainer.innerHTML = `<p>Error loading projects: ${result && result.error ? result.error : 'Unknown error'}</p>`;
      }
    } catch (error) {
      projectsListContainer.innerHTML = `<p>Critical error loading projects: ${error.message}</p>`;
    }
  } else {
    projectsListContainer.innerHTML = '<p>API non disponibile. Esegui l\'applicazione in Electron per accedere ai progetti.</p>';
  }
}

function addProjectActionListeners() {
  document.querySelectorAll('.view-project-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const projectId = event.currentTarget.dataset.projectId;
      if (projectId) {
        alert(`TODO: Open project ${projectId}`);
      }
    });
  });

  document.querySelectorAll('.edit-project-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget;
      const projectId = target.dataset.projectId;
      const projectName = target.dataset.projectName;
      const projectCsvAttr = target.dataset.projectCsv;
      const projectCsv = projectCsvAttr && projectCsvAttr !== 'null' && projectCsvAttr !== 'undefined' ? projectCsvAttr : null;

      if (projectId && projectName) {
        openProjectModal('edit', { id: projectId, name: projectName, base_csv_storage_path: projectCsv });
      }
    });
  });

  document.querySelectorAll('.delete-project-btn').forEach(button => {
    button.addEventListener('click', async (event) => {
      const projectId = event.currentTarget.dataset.projectId;
      if (projectId) {
        if (confirm(`Sei sicuro di voler eliminare il progetto ID: ${projectId}? Questa azione è irreversibile.`)) {
          if (window.api && window.api.invoke) {
            try {
              const result = await window.api.invoke('db-delete-project', projectId);
              
              // Controllo di sicurezza per gestire risposte null o undefined
              if (!result) {
                alert(`Error during deletion: invalid server response.`);
                return;
              }
              
              if (result.success) {
                alert(`Project ${projectId} deleted successfully.`);
                loadAllProjects();
              } else {
                alert(`Error during deletion: ${result.error}`);
              }
            } catch (error) {
              alert(`Critical error during deletion: ${error.message}`);
            }
          } else {
            alert('API not available. Run the application in Electron to delete projects.');
          }
        }
      }
    });
  });
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
  openProjectModal,
  getResizeConfig
};
