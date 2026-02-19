/**
 * Racetagger Desktop - Enhanced File Browser
 * Native-feeling file management with drag & drop and previews
 */

class EnhancedFileBrowser {
  constructor() {
    this.selectedFiles = [];
    this.selectedFileObjects = [];
    this.activeFilter = 'all';
    this.supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'];

    this.fileTypeFilters = [
      { id: 'all', label: 'All Files', icon: '📁' },
      { id: 'jpg', label: 'JPEG', icon: '🖼️' },
      { id: 'raw', label: 'RAW', icon: '📸' },
      { id: 'png', label: 'PNG', icon: '🎨' }
    ];

    // Initialize selected preset
    this.selectedPreset = null;
    this.availablePresets = [];
    // Track ongoing preset loading to avoid race conditions
    this.presetLoadingPromise = null;

    this.init();
  }
  
  init() {
    this.replaceOriginalBrowser();
    this.bindEvents();
    this.setupDragAndDrop();
    this.setupPresetListeners();
    this.setupPresetSelector();
    // Load available presets first, then load selected preset
    this.loadAvailablePresets();
  }
  
  replaceOriginalBrowser() {
    // Find the original folder panel
    const folderPanel = document.getElementById('folder-panel');
    const singleFilePanel = document.getElementById('single-file-panel');
    
    if (!folderPanel || !singleFilePanel) return;
    
    // Create enhanced file browser
    const enhancedBrowserHTML = this.createEnhancedBrowserHTML();
    
    // Replace folder panel content
    folderPanel.innerHTML = enhancedBrowserHTML;
    
    // Also update single file panel for consistency
    singleFilePanel.innerHTML = `
      <div class="enhanced-file-browser single-file" id="single-file-browser">
        <div class="browser-header">
          <span class="browser-icon">🖼️</span>
          <h3 class="browser-title">Select Single Image</h3>
          <p class="browser-subtitle">Choose one image file for analysis</p>
        </div>
        
        <div class="browser-actions">
          <button class="browser-action-btn btn-browse-folder" id="browse-single-file">
            <span>📁</span>
            <span>Browse Files</span>
          </button>
        </div>
        
        <div class="supported-formats">
          <div class="formats-label">Supported Formats</div>
          <div class="format-tags">
            <span class="format-tag">JPG</span>
            <span class="format-tag">PNG</span>
            <span class="format-tag">WebP</span>
            <span class="format-tag">NEF</span>
            <span class="format-tag">CR2</span>
            <span class="format-tag">ARW</span>
          </div>
        </div>
        
        <div class="drop-indicator">Drop your image here</div>
        <div class="loading-overlay"><div class="loading-spinner"></div><div class="loading-text">Processing...</div></div>
      </div>
    `;
    
    // Setup single file browser
    this.setupSingleFileBrowser();
  }
  
  createEnhancedBrowserHTML() {
    return `
      <div class="enhanced-file-browser" id="enhanced-file-browser">
        <div class="browser-header">
          <span class="browser-icon">📁</span>
          <h3 class="browser-title">Select Images or Folder</h3>
          <p class="browser-subtitle">Drag and drop files/folders here, or click to browse.<br>Supports batch processing of multiple images.</p>
        </div>
        
        <div class="browser-actions">
          <button class="browser-action-btn btn-browse-folder" id="browse-folder-btn">
            <span>📁</span>
            <span>Browse Folder</span>
          </button>
          <button class="browser-action-btn btn-browse-files" id="browse-files-btn">
            <span>🖼️</span>
            <span>Select Files</span>
          </button>
        </div>
        
        <div class="supported-formats">
          <div class="formats-label">Supported Formats</div>
          <div class="format-tags">
            ${this.supportedFormats.map(format => `<span class="format-tag">${format.toUpperCase()}</span>`).join('')}
          </div>
        </div>
        
        <!-- File Selection Display (hidden initially) -->
        <div class="file-selection-display">
          <div class="selection-summary">
            <div class="summary-info">
              <span class="summary-icon">📊</span>
              <div class="summary-text">
                <div class="summary-title" id="selection-title">0 files selected</div>
                <div class="summary-details" id="selection-details">No files selected</div>
              </div>
            </div>
            <div class="summary-actions">
              <button class="summary-action-btn" id="add-more-files">
                <span>➕</span>
                <span>Add More</span>
              </button>
              <button class="summary-action-btn primary" id="process-selected-files">
                <span>⚡</span>
                <span>Process Selected</span>
              </button>
              <button class="summary-action-btn danger" id="clear-selection">
                <span>🗑️</span>
                <span>Clear All</span>
              </button>
            </div>
          </div>
          
          <!-- File Type Filters -->
          <div class="file-type-filters">
            ${this.fileTypeFilters.map(filter => `
              <button class="file-type-filter ${filter.id === 'all' ? 'active' : ''}" data-filter="${filter.id}">
                <span>${filter.icon}</span>
                <span>${filter.label}</span>
              </button>
            `).join('')}
          </div>
          
          <!-- Files Grid -->
          <div class="files-grid" id="files-grid">
            <!-- Files will be populated here -->
          </div>
        </div>
        
        <!-- Drop Indicator -->
        <div class="drop-indicator">
          <span>📁 Drop files or folders here</span>
        </div>
        
        <!-- Loading Overlay -->
        <div class="loading-overlay">
          <div class="loading-spinner"></div>
          <div class="loading-text">Processing files...</div>
          <div class="loading-subtext">Generating previews and analyzing format</div>
        </div>
      </div>
    `;
  }
  
  bindEvents() {
    // Browse buttons
    document.addEventListener('click', (e) => {
      if (e.target.closest('#browse-folder-btn')) {
        this.browseFolder();
      } else if (e.target.closest('#browse-files-btn')) {
        this.browseFiles();
      } else if (e.target.closest('#add-more-files')) {
        this.addMoreFiles();
      } else if (e.target.closest('#clear-selection')) {
        this.clearSelection();
      } else if (e.target.closest('#process-selected-files')) {
        this.processSelectedFiles();
      }
    });
    
    // File type filters
    document.addEventListener('click', (e) => {
      if (e.target.closest('.file-type-filter')) {
        const filter = e.target.closest('.file-type-filter');
        this.setActiveFilter(filter.dataset.filter);
      }
    });
    
    // File item interactions
    document.addEventListener('click', (e) => {
      if (e.target.closest('.file-item')) {
        const fileItem = e.target.closest('.file-item');
        const fileIndex = parseInt(fileItem.dataset.fileIndex);
        
        if (e.target.closest('.file-action-btn')) {
          this.removeFile(fileIndex);
        } else {
          this.toggleFileSelection(fileIndex);
        }
      }
    });
    
    // Main browser click (when empty)
    document.addEventListener('click', (e) => {
      if (e.target.closest('#enhanced-file-browser') && !e.target.closest('.file-selection-display')) {
        const browser = document.getElementById('enhanced-file-browser');
        if (!browser.classList.contains('has-files')) {
          this.browseFiles();
        }
      }
    });
  }
  
  setupDragAndDrop() {
    const browser = document.getElementById('enhanced-file-browser');
    if (!browser) return;
    
    let dragCounter = 0;
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      browser.addEventListener(eventName, this.preventDefaults, false);
      document.body.addEventListener(eventName, this.preventDefaults, false);
    });
    
    // Highlight drop area
    browser.addEventListener('dragenter', (e) => {
      dragCounter++;
      browser.classList.add('drag-over');
    }, false);

    browser.addEventListener('dragover', (e) => {
      // Keep visual feedback on dragover but don't increment counter
      browser.classList.add('drag-over');
    }, false);

    browser.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter <= 0) {
        browser.classList.remove('drag-over');
        dragCounter = 0;
      }
    }, false);
    
    // Handle dropped files
    browser.addEventListener('drop', (e) => {
      dragCounter = 0;
      browser.classList.remove('drag-over');
      
      const dt = e.dataTransfer;
      const files = dt.files;
      
      this.handleFilesDrop(files);
    }, false);
  }
  
  setupSingleFileBrowser() {
    const singleBrowser = document.getElementById('single-file-browser');
    if (!singleBrowser) return;
    
    // Setup drag and drop for single file browser
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      singleBrowser.addEventListener(eventName, this.preventDefaults, false);
    });
    
    singleBrowser.addEventListener('dragover', () => {
      singleBrowser.classList.add('drag-over');
    });
    
    singleBrowser.addEventListener('dragleave', () => {
      singleBrowser.classList.remove('drag-over');
    });
    
    singleBrowser.addEventListener('drop', (e) => {
      singleBrowser.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        this.handleSingleFileSelection(files[0]);
      }
    });
    
    // Browse button for single file
    document.getElementById('browse-single-file')?.addEventListener('click', () => {
      this.browseSingleFile();
    });
    
    // Click to browse
    singleBrowser.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        this.browseSingleFile();
      }
    });
  }
  
  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  async browseFolder() {
    if (!window.api) {
      // Fallback to original folder selection
      if (window.handleFolderSelection) {
        window.handleFolderSelection();
      }
      return;
    }

    try {
      // First try to use original folder selection method for better compatibility
      if (window.api.send) {
        window.api.send('select-folder');
        return;
      }

      // Fallback to new enhanced method
      const result = await window.api.invoke('dialog-show-open', {
        properties: ['openDirectory'],
        title: 'Select Image Folder'
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        this.showLoading();
        
        try {
          // Get files from folder
          const files = await window.api.invoke('get-folder-files', {
            folderPath,
            extensions: this.supportedFormats
          });
          
          this.hideLoading();
          
          if (files && files.length > 0) {
            this.setSelectedFiles(files, folderPath);
          } else {
            this.showNotification('No supported image files found in selected folder', 'warning');
          }
        } catch (filesError) {
          this.hideLoading();
          // Fallback: just set the folder path without file details
          this.showNotification(`Selected folder: ${folderPath}`, 'info');
          this.notifyFolderSelection(folderPath);
        }
      }
    } catch (error) {
      this.hideLoading();

      // Final fallback to original method
      if (window.api.send) {
        window.api.send('select-folder');
      } else {
        this.showNotification('Error selecting folder - API not available', 'error');
      }
    }
  }
  
  async browseFiles() {
    if (!window.api) {
      this.showNotification('File selection not available', 'error');
      return;
    }
    
    try {
      const result = await window.api.invoke('dialog-show-open', {
        properties: ['openFile', 'multiSelections'],
        title: 'Select Image Files',
        filters: [
          { name: 'Images', extensions: this.supportedFormats },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        this.showLoading();
        
        try {
          // Process selected files
          const fileObjects = await Promise.all(result.filePaths.map(async (filePath) => {
            return await this.createFileObject(filePath);
          }));
          
          this.hideLoading();
          const validFiles = fileObjects.filter(Boolean);
          
          if (validFiles.length > 0) {
            this.setSelectedFiles(validFiles);
            this.showNotification(`Selected ${validFiles.length} file${validFiles.length !== 1 ? 's' : ''}`, 'success');
          } else {
            this.showNotification('No valid image files could be processed', 'warning');
          }
        } catch (processingError) {
          this.hideLoading();
          
          // Fallback: create basic file objects
          const basicFiles = result.filePaths.map(filePath => {
            const extension = filePath.split('.').pop()?.toLowerCase() || '';
            return {
              name: filePath.split('/').pop() || filePath.split('\\').pop(),
              path: filePath,
              size: 0, // Unknown
              extension,
              type: this.getFileType(extension),
              isRaw: this.isRawFormat(extension),
              thumbnail: null
            };
          });
          
          this.setSelectedFiles(basicFiles);
          this.showNotification(`Selected ${basicFiles.length} file${basicFiles.length !== 1 ? 's' : ''} (basic mode)`, 'info');
        }
      }
    } catch (error) {
      this.hideLoading();
      this.showNotification('Error selecting files', 'error');
    }
  }

  async browseSingleFile() {
    if (!window.api) {
      this.showNotification('File selection not available', 'error');
      return;
    }
    
    try {
      const result = await window.api.invoke('dialog-show-open', {
        properties: ['openFile'],
        title: 'Select Image File',
        filters: [
          { name: 'Images', extensions: this.supportedFormats },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        this.handleSingleFileSelection(filePath);
        this.showNotification('File selected successfully', 'success');
      }
    } catch (error) {
      this.showNotification('Error selecting file', 'error');
    }
  }
  
  async handleFilesDrop(files) {
    const fileArray = Array.from(files);
    
    if (fileArray.length === 0) return;
    
    this.showLoading();
    
    try {
      const processedFiles = [];
      
      for (const file of fileArray) {
        if (file.type.startsWith('image/') || this.isValidImageExtension(file.name)) {
          const fileObj = await this.createFileObjectFromFile(file);
          if (fileObj) {
            processedFiles.push(fileObj);
          }
        }
      }
      
      this.hideLoading();
      
      if (processedFiles.length > 0) {
        if (this.selectedFiles.length > 0) {
          // Add to existing selection
          this.addToSelection(processedFiles);
        } else {
          // New selection
          this.setSelectedFiles(processedFiles);
        }
        this.showNotification(`Added ${processedFiles.length} files`, 'success');
      } else {
        this.showNotification('No valid image files found', 'warning');
      }
    } catch (error) {
      this.hideLoading();
      this.showNotification('Error processing files', 'error');
    }
  }
  
  async handleSingleFileSelection(file) {
    if (typeof file === 'string') {
      // File path
      this.updateSingleFileDisplay(file);
      this.triggerOriginalFileSelection(file);
    } else {
      // File object
      this.updateSingleFileDisplay(file.name);
      this.triggerOriginalFileSelection(file);
    }
  }
  
  async createFileObject(filePath) {
    try {
      const stats = await window.api.invoke('get-file-stats', filePath);
      const extension = filePath.split('.').pop()?.toLowerCase() || '';
      
      return {
        name: filePath.split('/').pop() || filePath.split('\\').pop(),
        path: filePath,
        size: stats.size,
        extension,
        type: this.getFileType(extension),
        isRaw: this.isRawFormat(extension),
        thumbnail: await this.generateThumbnail(filePath)
      };
    } catch (error) {
      return null;
    }
  }
  
  async createFileObjectFromFile(file) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    
    return {
      name: file.name,
      path: file.path || file.name,
      size: file.size,
      extension,
      type: this.getFileType(extension),
      isRaw: this.isRawFormat(extension),
      thumbnail: await this.generateThumbnailFromFile(file),
      fileObject: file
    };
  }
  
  async generateThumbnail(filePath) {
    try {
      if (window.api) {
        return await window.api.invoke('generate-thumbnail', filePath);
      }
    } catch (error) {
      // Thumbnail generation failed
    }
    return null;
  }

  async generateThumbnailFromFile(file) {
    try {
      if (file.type.startsWith('image/')) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      }
    } catch (error) {
      // Thumbnail generation failed
    }
    return null;
  }
  
  setSelectedFiles(files, folderPath = null) {
    this.selectedFiles = files;
    this.selectedFileObjects = files.map((file, index) => ({ ...file, index, selected: false }));
    
    this.updateBrowserDisplay();
    this.updateSelectionSummary(folderPath);
    this.renderFilesGrid();
    
    // Notify the main application
    this.notifySelectionChange();
  }
  
  addToSelection(newFiles) {
    const startIndex = this.selectedFiles.length;
    this.selectedFiles = [...this.selectedFiles, ...newFiles];
    this.selectedFileObjects = [
      ...this.selectedFileObjects,
      ...newFiles.map((file, index) => ({ ...file, index: startIndex + index, selected: false }))
    ];
    
    this.updateSelectionSummary();
    this.renderFilesGrid();
    this.notifySelectionChange();
  }
  
  removeFile(index) {
    this.selectedFiles.splice(index, 1);
    this.selectedFileObjects.splice(index, 1);
    
    // Update indices
    this.selectedFileObjects.forEach((file, idx) => {
      file.index = idx;
    });
    
    if (this.selectedFiles.length === 0) {
      this.clearSelection();
    } else {
      this.updateSelectionSummary();
      this.renderFilesGrid();
      this.notifySelectionChange();
    }
  }
  
  clearSelection() {
    this.selectedFiles = [];
    this.selectedFileObjects = [];
    
    const browser = document.getElementById('enhanced-file-browser');
    if (browser) {
      browser.classList.remove('has-files');
    }
    
    this.notifySelectionChange();
    this.showNotification('Selection cleared', 'info');
  }
  
  addMoreFiles() {
    this.browseFiles();
  }
  
  setActiveFilter(filterId) {
    this.activeFilter = filterId;
    
    // Update filter buttons
    document.querySelectorAll('.file-type-filter').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filterId);
    });
    
    this.renderFilesGrid();
  }
  
  toggleFileSelection(index) {
    if (this.selectedFileObjects[index]) {
      this.selectedFileObjects[index].selected = !this.selectedFileObjects[index].selected;
      this.updateFileItemSelection(index);
    }
  }
  
  updateFileItemSelection(index) {
    const fileItem = document.querySelector(`[data-file-index="${index}"]`);
    if (fileItem) {
      fileItem.classList.toggle('selected', this.selectedFileObjects[index]?.selected);
    }
  }
  
  updateBrowserDisplay() {
    const browser = document.getElementById('enhanced-file-browser');
    if (browser && this.selectedFiles.length > 0) {
      browser.classList.add('has-files');
    }
  }
  
  updateSelectionSummary(folderPath = null) {
    const titleEl = document.getElementById('selection-title');
    const detailsEl = document.getElementById('selection-details');
    
    if (!titleEl || !detailsEl) return;
    
    const fileCount = this.selectedFiles.length;
    const totalSize = this.selectedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
    const rawCount = this.selectedFiles.filter(file => file.isRaw).length;
    
    titleEl.textContent = `${fileCount} file${fileCount !== 1 ? 's' : ''} selected`;
    
    let details = this.formatFileSize(totalSize);
    if (rawCount > 0) {
      details += ` • ${rawCount} RAW file${rawCount !== 1 ? 's' : ''}`;
    }
    if (folderPath) {
      details += ` • From: ${folderPath.split('/').pop() || folderPath.split('\\').pop()}`;
    }
    
    detailsEl.textContent = details;
  }
  
  renderFilesGrid() {
    const grid = document.getElementById('files-grid');
    if (!grid) return;
    
    let filesToShow = this.selectedFileObjects;
    
    // Apply filter
    if (this.activeFilter !== 'all') {
      filesToShow = this.selectedFileObjects.filter(file => {
        switch (this.activeFilter) {
          case 'jpg': return ['jpg', 'jpeg'].includes(file.extension);
          case 'raw': return file.isRaw;
          case 'png': return file.extension === 'png';
          default: return true;
        }
      });
    }
    
    grid.innerHTML = filesToShow.map(file => this.createFileItemHTML(file)).join('');
  }
  
  createFileItemHTML(file) {
    return `
      <div class="file-item ${file.selected ? 'selected' : ''}" data-file-index="${file.index}">
        <div class="file-actions">
          <button class="file-action-btn" title="Remove">✕</button>
        </div>
        
        <div class="file-preview ${!file.thumbnail ? 'no-preview' : ''}">
          ${file.thumbnail ? 
            `<img src="${file.thumbnail}" alt="${file.name}">` :
            this.getFileIcon(file.extension)
          }
          <div class="format-badge">${file.extension.toUpperCase()}</div>
        </div>
        
        <div class="file-info">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-size">${this.formatFileSize(file.size)}</div>
        </div>
      </div>
    `;
  }
  
  updateSingleFileDisplay(filename) {
    // Update the original file input display if it exists
    const selectedFolder = document.getElementById('selected-folder');
    const imageCount = document.getElementById('image-count');
    
    if (selectedFolder) {
      selectedFolder.textContent = `Selected: ${filename}`;
    }
    if (imageCount) {
      imageCount.textContent = '1 image selected';
    }
  }
  
  triggerOriginalFileSelection(file) {
    // Trigger the original file selection logic
    const fileInput = document.getElementById('file-upload');
    if (fileInput && typeof file !== 'string') {
      // Create a new FileList for the original input
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Enable upload button
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton) {
      uploadButton.disabled = false;
    }
  }
  
  notifySelectionChange() {
    // Update the original folder selection display
    const selectedFolder = document.getElementById('selected-folder');
    const imageCount = document.getElementById('image-count');
    
    if (selectedFolder && this.selectedFiles.length > 0) {
      if (this.selectedFiles.length === 1) {
        selectedFolder.textContent = `Selected: ${this.selectedFiles[0].name}`;
      } else {
        selectedFolder.textContent = `Selected: ${this.selectedFiles.length} files`;
      }
    } else if (selectedFolder) {
      selectedFolder.textContent = 'No folder selected';
    }
    
    if (imageCount) {
      imageCount.textContent = this.selectedFiles.length > 0 ? 
        `${this.selectedFiles.length} images selected` : 
        'No images selected';
    }
    
    // Update global variables for compatibility
    if (this.selectedFiles.length > 0) {
      window.selectedFolderPath = this.selectedFiles.length > 1 ? 'Multiple Files' : this.selectedFiles[0].path;
      window.selectedFolderImages = this.selectedFiles.length;
    }
    
    // Enable/disable upload button and update state
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton && window.updateUploadButtonState) {
      window.updateUploadButtonState();
    }
    
    // Dispatch custom event for other components
    document.dispatchEvent(new CustomEvent('filesSelected', {
      detail: {
        files: this.selectedFiles,
        count: this.selectedFiles.length
      }
    }));
  }

  notifyFolderSelection(folderPath) {
    // Update the original folder selection display for fallback cases
    const selectedFolder = document.getElementById('selected-folder');
    const imageCount = document.getElementById('image-count');
    
    if (selectedFolder) {
      const folderName = folderPath.split('/').pop() || folderPath.split('\\').pop();
      selectedFolder.textContent = `Selected: ${folderName}`;
    }
    
    if (imageCount) {
      imageCount.textContent = 'Folder selected (processing...)';
    }
    
    // Update global variables for compatibility
    window.selectedFolderPath = folderPath;
    
    // Enable upload button if available
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton && window.updateUploadButtonState) {
      window.updateUploadButtonState();
    }
  }
  
  showLoading() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) {
      overlay.classList.add('visible');
    }
  }
  
  hideLoading() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) {
      overlay.classList.remove('visible');
    }
  }
  
  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `file-browser-notification ${type}`;
    notification.style.cssText = `
      position: fixed;
      top: 2rem;
      right: 2rem;
      background: ${type === 'success' ? 'var(--accent-success)' : type === 'warning' ? 'var(--accent-warning)' : type === 'error' ? 'var(--accent-danger)' : 'var(--accent-primary)'};
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 0.75rem;
      box-shadow: 0 8px 25px rgba(0,0,0,0.3);
      z-index: 2100;
      font-size: 0.875rem;
      font-weight: 500;
      max-width: 300px;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(10px);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 4 seconds
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          document.body.removeChild(notification);
        }
      }, 300);
    }, 4000);
  }
  
  // Utility methods
  isValidImageExtension(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    return this.supportedFormats.includes(ext || '');
  }
  
  isRawFormat(extension) {
    const rawFormats = ['nef', 'arw', 'cr2', 'cr3', 'orf', 'raw', 'rw2', 'dng'];
    return rawFormats.includes(extension.toLowerCase());
  }

  /**
   * Setup preset event listeners
   */
  setupPresetListeners() {
    // Listen for preset selection from participants manager
    window.addEventListener('presetSelected', (event) => {
      this.selectedPreset = event.detail;
      this.updatePresetDisplay();
    });

    // Listen for preset cleared
    window.addEventListener('presetCleared', () => {
      this.selectedPreset = null;
      this.updatePresetDisplay();
    });
  }

  /**
   * Load selected preset from localStorage
   */
  async loadSelectedPreset() {
    try {
      // Note: localStorage persistence removed - presets start unselected each time

      // Fallback to window.getSelectedPreset if available
      if (typeof window.getSelectedPreset === 'function') {
        const legacyPreset = window.getSelectedPreset();
        if (legacyPreset && legacyPreset.id) {
          await this.handlePresetSelection(legacyPreset.id);
        }
      }
    } catch (error) {
      this.selectedPreset = null;
    }
  }

  /**
   * Update preset display in the UI
   */
  updatePresetDisplay() {
    const presetDisplay = document.getElementById('current-preset-display');

    if (!presetDisplay) {
      // Create preset display if it doesn't exist
      this.createPresetDisplay();
      return;
    }

    if (this.selectedPreset) {
      const participantCount = this.selectedPreset.participants ? this.selectedPreset.participants.length : 0;
      presetDisplay.innerHTML = `
        <div class="preset-info">
          <div class="preset-header">
            <span class="preset-icon">👥</span>
            <span class="preset-name">${this.selectedPreset.name}</span>
          </div>
          <div class="preset-details">
            <span class="participant-count">${participantCount} participants</span>
            <button class="btn btn-sm btn-secondary" onclick="window.clearSelectedPreset()">
              <span class="btn-icon">×</span>
            </button>
          </div>
        </div>
      `;
      presetDisplay.style.display = 'block';
    } else {
      presetDisplay.innerHTML = `
        <div class="no-preset">
          <span class="no-preset-text">No participant preset selected</span>
          <button class="btn btn-sm btn-primary" onclick="showSection('participants')">
            Select Preset
          </button>
        </div>
      `;
      presetDisplay.style.display = 'block';
    }
  }

  /**
   * Create preset display element
   */
  createPresetDisplay() {
    const controlsRow = document.querySelector('.enhanced-browser-controls');
    if (!controlsRow) return;

    const presetDisplay = document.createElement('div');
    presetDisplay.id = 'current-preset-display';
    presetDisplay.className = 'preset-display';

    // Insert after controls
    controlsRow.parentNode.insertBefore(presetDisplay, controlsRow.nextSibling);

    this.updatePresetDisplay();
  }
  
  /**
   * Process selected files with intelligent parallel/sequential routing
   */
  async processSelectedFiles() {
    if (!this.selectedFiles || this.selectedFiles.length === 0) {
      this.showNotification('No files selected for processing', 'warning');
      return;
    }

    try {
      
      // Build configuration for processing
      const config = {
        folderPath: this.selectedFiles[0].path ? this.selectedFiles[0].path.split('/').slice(0, -1).join('/') : 'selected-files',
        filePaths: this.selectedFiles.map(file => file.path),
        selectedFiles: this.selectedFiles, // Include file metadata
        selectedModel: 'gemini-2.5-flash-preview-04-17',
        selectedCategory: window.selectedCategory || 'motorsport',
        resize: {
          enabled: document.getElementById('resize-enabled')?.checked || false,
          preset: document.querySelector('[name="resize-preset"]:checked')?.value || 'balanced'
        },
        // Include participant preset data
        participantPreset: this.selectedPreset ? {
          id: this.selectedPreset.presetId || this.selectedPreset.id,
          name: this.selectedPreset.presetName || this.selectedPreset.name,
          participants: this.selectedPreset.participants || []
        } : null
      };
      
      // Show processing notification
      const processingType = 'unified';
      this.showNotification(
        `Starting ${processingType} processing of ${this.selectedFiles.length} file${this.selectedFiles.length > 1 ? 's' : ''}...`,
        'info'
      );

      // Send to main process for analysis
      if (window.api) {
        window.api.send('analyze-folder', config);
        
        // Optional: Clear selection after starting processing
        // this.clearSelection();
        
      } else {
        throw new Error('API not available for file processing');
      }
      
    } catch (error) {
      this.showNotification('Error starting file processing: ' + error.message, 'error');
    }
  }
  
  getFileType(extension) {
    const ext = extension.toLowerCase();
    if (['jpg', 'jpeg'].includes(ext)) return 'JPEG';
    if (ext === 'png') return 'PNG';
    if (ext === 'webp') return 'WebP';
    if (this.isRawFormat(ext)) return 'RAW';
    return ext.toUpperCase();
  }
  
  getFileIcon(extension) {
    if (this.isRawFormat(extension)) return '📸';
    if (['jpg', 'jpeg'].includes(extension)) return '🖼️';
    if (extension === 'png') return '🎨';
    return '📄';
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
  
  // Public API
  getSelectedFiles() {
    return this.selectedFiles;
  }
  
  hasFiles() {
    return this.selectedFiles.length > 0;
  }
  
  getFileCount() {
    return this.selectedFiles.length;
  }
  
  getSelectedIndices() {
    return this.selectedFileObjects
      .filter(file => file.selected)
      .map(file => file.index);
  }

  /**
   * Load available participant presets from the API
   */
  async loadAvailablePresets() {
    try {
      // Check if user is admin
      const isAdmin = await window.api.invoke('auth-is-admin');

      // Use appropriate endpoint based on admin status
      const channelName = isAdmin
        ? 'supabase-get-all-participant-presets-admin'
        : 'supabase-get-participant-presets';

      console.log('[EnhancedFileBrowser] Loading presets via:', channelName);
      const response = await window.api.invoke(channelName);
      console.log('[EnhancedFileBrowser] Response:', response.success, 'presets:', response.data?.length);

      if (response.success && Array.isArray(response.data)) {
        // Debug: log first preset to see structure
        if (response.data.length > 0) {
          const firstPreset = response.data[0];
          console.log('[EnhancedFileBrowser] First preset structure:', {
            id: firstPreset.id,
            name: firstPreset.name,
            hasParticipants: !!firstPreset.participants,
            participantsLength: firstPreset.participants?.length,
            hasPresetParticipants: !!(firstPreset).preset_participants,
            presetParticipantsLength: (firstPreset).preset_participants?.length,
            keys: Object.keys(firstPreset)
          });
        }

        this.availablePresets = response.data.map(preset => {
          // Try both 'participants' and 'preset_participants' in case of mapping issues
          const participants = preset.participants || preset.preset_participants || [];
          return {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            participantCount: participants.length,
            participants: participants
          };
        });

        console.log('[EnhancedFileBrowser] Mapped presets:', this.availablePresets.map(p => `${p.name}: ${p.participantCount}`));

        this.updatePresetSelector();

        // After loading presets, restore the selected one from localStorage
        this.loadSelectedPreset();
      } else {
        console.log('[EnhancedFileBrowser] No presets or invalid response');
        this.availablePresets = [];
      }
    } catch (error) {
      console.error('[EnhancedFileBrowser] Error loading presets:', error);
      this.availablePresets = [];
    }
  }

  /**
   * Setup preset selector event handlers
   */
  setupPresetSelector() {
    const presetSelect = document.getElementById('preset-select');
    if (presetSelect) {
      // Load fresh data when user focuses the select (opens dropdown)
      presetSelect.addEventListener('focus', () => {
        this.loadAvailablePresets();
      });

      presetSelect.addEventListener('change', (e) => {
        this.handlePresetSelection(e.target.value);
      });
    }
  }

  /**
   * Handle preset selection from dropdown
   */
  async handlePresetSelection(presetId) {
    console.log('[EnhancedFileBrowser] handlePresetSelection called with:', presetId);

    if (!presetId) {
      // Clear preset selection
      console.log('[EnhancedFileBrowser] Clearing preset selection');
      this.selectedPreset = null;
      this.presetLoadingPromise = null;
      // Note: localStorage persistence removed - presets are selected fresh each time
      this.updatePresetDetails();
      return;
    }

    // Track this loading operation so other code can await it
    const loadingPromise = this._loadPresetData(presetId);
    this.presetLoadingPromise = loadingPromise;
    return loadingPromise;
  }

  /**
   * Internal: Load preset data from Supabase.
   * Separated to allow tracking via presetLoadingPromise.
   */
  async _loadPresetData(presetId) {
    try {
      // Always load full preset data from server to ensure we have complete participants
      console.log('[EnhancedFileBrowser] Loading preset by ID:', presetId);
      const response = await window.api.invoke('supabase-get-participant-preset-by-id', presetId);
      console.log('[EnhancedFileBrowser] Preset load response:', response.success, response.data?.name, 'participants:', response.data?.participants?.length);

      if (response.success && response.data) {
        this.selectedPreset = {
          id: response.data.id,
          name: response.data.name,
          description: response.data.description,
          participants: response.data.participants || []
        };
        console.log('[EnhancedFileBrowser] selectedPreset set:', this.selectedPreset.id, this.selectedPreset.name);

        // Note: localStorage persistence removed - presets are selected fresh each time

        // Update last used timestamp
        await window.api.invoke('supabase-update-preset-last-used', presetId);

        // Update UI
        this.updatePresetDetails();

        // Show accuracy confirmation message
        this.showAccuracyConfirmation();

        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('presetSelected', {
          detail: this.selectedPreset
        }));
      } else {
        console.log('[EnhancedFileBrowser] Preset load failed or no data');
      }
    } catch (error) {
      console.error('[EnhancedFileBrowser] Error selecting preset:', error);
    }
  }

  /**
   * Update preset selector dropdown options
   */
  updatePresetSelector() {
    const presetSelect = document.getElementById('preset-select');
    if (!presetSelect) return;

    // Clear existing options except the first one
    presetSelect.innerHTML = '<option value="">🎯 Enhance Recognition Accuracy</option>';

    // Add available presets
    this.availablePresets.forEach(preset => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${preset.name} (${preset.participantCount} participants)`;
      presetSelect.appendChild(option);
    });

    // Set current selection if any
    if (this.selectedPreset) {
      presetSelect.value = this.selectedPreset.id;
    }

    // If no selectedPreset but dropdown has a value, try to sync it
    if (!this.selectedPreset && presetSelect.value) {
      const presetId = presetSelect.value;
      this.handlePresetSelection(presetId);
    }
  }

  /**
   * Update preset details display
   */
  updatePresetDetails() {
    const presetDetails = document.getElementById('preset-details');
    const presetParticipantCount = document.getElementById('preset-participant-count');

    if (!presetDetails || !presetParticipantCount) return;

    if (this.selectedPreset) {
      presetDetails.style.display = 'block';
      presetParticipantCount.textContent = this.selectedPreset.participants.length;
    } else {
      presetDetails.style.display = 'none';
    }
  }

  /**
   * Show accuracy-focused confirmation when preset is selected
   */
  showAccuracyConfirmation() {
    if (!this.selectedPreset) return;

    // Create success message for delight system
    const participantCount = this.selectedPreset.participants.length;

    // Try to integrate with delight system if available
    if (window.delightSystem && window.delightSystem.showSuccess) {
      // Use existing success method with custom accuracy messaging
      const stats = {
        'Participants': participantCount,
        'Accuracy Mode': 'Enhanced'
      };

      // Add custom success message to delight system temporarily
      if (!window.delightSystem.successMessages) {
        window.delightSystem.successMessages = {};
      }

      window.delightSystem.successMessages.preset_accuracy = {
        icon: '🎯',
        title: 'Accuracy Enhanced!',
        message: `${participantCount} participants loaded for precise number matching and sponsor detection`
      };

      window.delightSystem.showSuccess('preset_accuracy', stats, 4000);
    } else {
      // Fallback: show simple notification
      const message = `🎯 ${participantCount} participants loaded - Enhanced accuracy active!`;
      this.showSimpleNotification(message, 'success');
    }

    // Add subtle animation to preset selector
    const presetSelector = document.querySelector('.preset-selector-enhanced');
    if (presetSelector) {
      presetSelector.style.animation = 'preset-success-pulse 0.6s ease-out';
      setTimeout(() => {
        presetSelector.style.animation = '';
      }, 600);
    }
  }

  /**
   * Simple notification fallback
   */
  showSimpleNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `preset-notification preset-notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#10b981' : '#3b82f6'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      z-index: 1000;
      font-size: 14px;
      font-weight: 500;
      transform: translateX(100%);
      transition: transform 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);

    // Remove after delay
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

// Initialize enhanced file browser (only if not already initialized by coordinator)
document.addEventListener('DOMContentLoaded', () => {
  // Wait for other scripts and ensure main renderer is ready
  setTimeout(() => {
    // Only initialize if in analysis section and not already initialized
    const analysisSection = document.getElementById('section-analysis');
    if (analysisSection && !window.enhancedFileBrowser) {
      try {
        window.enhancedFileBrowser = new EnhancedFileBrowser();
        analysisSection.classList.add('enhanced-ui-active');
      } catch (error) {
        console.error('Enhanced File Browser initialization failed:', error);
      }
    }
  }, 600); // Slightly later than coordinator to avoid conflicts
});

// Expose class on window for router initialization
window.EnhancedFileBrowser = EnhancedFileBrowser;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedFileBrowser;
}