/**
 * Racetagger Desktop - Modern Results Display
 * Card-based layout with thumbnails, filtering, and inline editing
 */

class ModernResultsDisplay {
  constructor() {
    this.currentView = 'grid';
    this.results = [];
    this.filteredResults = [];
    this.selectedResults = new Set();
    this.filters = {
      search: '',
      confidence: 'all',
      hasDetections: 'all'
    };
    
    this.init();
  }
  
  init() {
    this.replaceOriginalResults();
    this.bindEvents();
  }
  
  replaceOriginalResults() {
    const originalResultsContainer = document.getElementById('results-container');
    if (!originalResultsContainer) return;
    
    // Mark as original component for CSS hiding
    originalResultsContainer.classList.add('original-component');
    
    // Create modern results HTML
    const modernResultsHTML = this.createModernResultsHTML();
    
    // Insert after original results container
    originalResultsContainer.insertAdjacentHTML('afterend', modernResultsHTML);
  }
  
  createModernResultsHTML() {
    return `
      <div class="modern-results-container" id="modern-results-container" style="display: none;">
        <!-- Results Header -->
        <div class="results-header">
          <div class="results-title-section">
            <h3 class="results-title">Analysis Results</h3>
            <div class="results-summary">
              <span class="summary-badge" id="results-count-badge">0 images</span>
              <span class="summary-detail">
                <span>🎯</span>
                <span id="detections-count">0 detections</span>
              </span>
              <span class="summary-detail">
                <span>⏱️</span>
                <span id="processing-time">--</span>
              </span>
            </div>
          </div>
          
          <div class="view-toggle">
            <button class="view-toggle-btn active" data-view="grid" id="btn-grid-view">
              <span>⊞</span>
              <span>Grid</span>
            </button>
            <button class="view-toggle-btn" data-view="list" id="btn-list-view">
              <span>☰</span>
              <span>List</span>
            </button>
          </div>
        </div>
        
        <!-- Bulk Actions Bar -->
        <div class="bulk-actions-bar" id="bulk-actions-bar">
          <div class="bulk-selection-info">
            <span class="selection-count" id="selection-count">0</span>
            <span>items selected</span>
            <button class="bulk-action-btn" id="btn-select-all">
              <span>☑️</span>
              <span>Select All</span>
            </button>
            <button class="bulk-action-btn" id="btn-clear-selection">
              <span>❌</span>
              <span>Clear</span>
            </button>
          </div>
          
          <div class="bulk-actions">
            <button class="bulk-action-btn" id="btn-bulk-export">
              <span>📤</span>
              <span>Export</span>
            </button>
            <button class="bulk-action-btn" id="btn-bulk-metadata">
              <span>🏷️</span>
              <span>Edit Metadata</span>
            </button>
            <button class="bulk-action-btn danger" id="btn-bulk-delete">
              <span>🗑️</span>
              <span>Remove</span>
            </button>
          </div>
        </div>
        
        <!-- Filters -->
        <div class="results-filters">
          <div class="filter-group">
            <input type="text" class="search-input" id="results-search" placeholder="Search by filename or race number...">
          </div>
          
          <div class="filter-group">
            <label class="filter-label">Confidence:</label>
            <select class="filter-select" id="confidence-filter">
              <option value="all">All Levels</option>
              <option value="high">High (90%+)</option>
              <option value="medium">Medium (70-89%)</option>
              <option value="low">Low (<70%)</option>
            </select>
          </div>
          
          <div class="filter-group">
            <label class="filter-label">Detections:</label>
            <select class="filter-select" id="detections-filter">
              <option value="all">All Images</option>
              <option value="has-detections">With Detections</option>
              <option value="no-detections">No Detections</option>
            </select>
          </div>
          
          <div class="filter-group">
            <button class="bulk-action-btn" id="btn-export-all">
              <span>💾</span>
              <span>Export Results</span>
            </button>
          </div>
        </div>
        
        <!-- Grid View -->
        <div class="results-grid-view" id="results-grid-view">
          <!-- Grid items will be inserted here -->
        </div>
        
        <!-- List View -->
        <div class="results-list-view" id="results-list-view">
          <!-- List items will be inserted here -->
        </div>
        
        <!-- Empty State -->
        <div class="results-empty-state" id="results-empty-state">
          <span class="empty-state-icon">🔍</span>
          <h4 class="empty-state-title">No Results Found</h4>
          <p class="empty-state-message">No analysis results match your current filters. Try adjusting your search criteria or process some images.</p>
        </div>
      </div>
      
      <!-- Enhanced Image Modal -->
      <div class="image-modal-enhanced" id="image-modal-enhanced">
        <div class="modal-content-enhanced" id="modal-content-enhanced">
          <img class="modal-image-enhanced" id="modal-image-enhanced" src="" alt="">
          <div class="modal-details">
            <h4 class="modal-filename" id="modal-filename">--</h4>
            <div class="modal-metadata" id="modal-metadata">
              <!-- Metadata will be populated here -->
            </div>
          </div>
          <button class="card-action-btn" style="position: absolute; top: 1rem; right: 1rem;" onclick="window.modernResults.closeModal()">
            ✕
          </button>
        </div>
      </div>
    `;
  }
  
  bindEvents() {
    // View toggle
    document.addEventListener('click', (e) => {
      if (e.target.closest('.view-toggle-btn')) {
        const btn = e.target.closest('.view-toggle-btn');
        const view = btn.dataset.view;
        this.switchView(view);
      }
    });
    
    // Filters
    const searchInput = document.getElementById('results-search');
    const confidenceFilter = document.getElementById('confidence-filter');
    const detectionsFilter = document.getElementById('detections-filter');
    
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filters.search = e.target.value;
        this.applyFilters();
      });
    }
    
    if (confidenceFilter) {
      confidenceFilter.addEventListener('change', (e) => {
        this.filters.confidence = e.target.value;
        this.applyFilters();
      });
    }
    
    if (detectionsFilter) {
      detectionsFilter.addEventListener('change', (e) => {
        this.filters.hasDetections = e.target.value;
        this.applyFilters();
      });
    }
    
    // Bulk actions
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btn-select-all')) {
        this.selectAll();
      } else if (e.target.closest('#btn-clear-selection')) {
        this.clearSelection();
      } else if (e.target.closest('#btn-bulk-export')) {
        this.bulkExport();
      } else if (e.target.closest('#btn-bulk-metadata')) {
        this.bulkEditMetadata();
      } else if (e.target.closest('#btn-bulk-delete')) {
        this.bulkDelete();
      } else if (e.target.closest('#btn-export-all')) {
        this.exportAllResults();
      }
    });
    
    // Card interactions
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.result-card, .result-list-item');
      
      if (e.target.closest('.card-action-btn, .list-action-btn')) {
        // Handle action buttons
        this.handleActionButton(e);
      } else if (card && (e.ctrlKey || e.metaKey)) {
        // Multi-select with Ctrl/Cmd
        this.toggleSelection(card.dataset.resultId);
      } else if (card) {
        // Single select or view
        if (e.detail === 2) { // Double click
          this.openModal(card.dataset.resultId);
        } else {
          this.selectResult(card.dataset.resultId);
        }
      }
    });
    
    // Modal
    document.addEventListener('click', (e) => {
      if (e.target.id === 'image-modal-enhanced') {
        this.closeModal();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('image-modal-enhanced').classList.contains('visible')) {
        this.closeModal();
      }
    });
  }
  
  show() {
    document.getElementById('modern-results-container').style.display = 'block';
    
    // Scroll to results
    setTimeout(() => {
      document.getElementById('modern-results-container').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 100);
  }
  
  hide() {
    document.getElementById('modern-results-container').style.display = 'none';
  }
  
  updateResults(results, summary = {}) {
    this.results = results || [];
    this.filteredResults = [...this.results];
    this.selectedResults.clear();
    
    // Update summary
    this.updateSummary(summary);
    
    // Apply current filters
    this.applyFilters();
    
    // Show results container
    this.show();
  }
  
  updateSummary(summary) {
    const totalImages = this.results.length;
    const totalDetections = this.results.reduce((sum, result) => sum + (result.detections?.length || 0), 0);
    
    document.getElementById('results-count-badge').textContent = `${totalImages} image${totalImages !== 1 ? 's' : ''}`;
    document.getElementById('detections-count').textContent = `${totalDetections} detection${totalDetections !== 1 ? 's' : ''}`;
    
    if (summary.processingTime) {
      document.getElementById('processing-time').textContent = this.formatTime(summary.processingTime);
    }
  }
  
  applyFilters() {
    let filtered = [...this.results];
    
    // Search filter
    if (this.filters.search) {
      const searchTerm = this.filters.search.toLowerCase();
      filtered = filtered.filter(result => {
        const filename = (result.filename || '').toLowerCase();
        const raceNumbers = result.detections?.map(d => d.raceNumber?.toString().toLowerCase()) || [];
        const participantNames = result.detections?.map(d => d.participantInfo?.nome?.toLowerCase()) || [];
        
        return filename.includes(searchTerm) ||
               raceNumbers.some(num => num && num.includes(searchTerm)) ||
               participantNames.some(name => name && name.includes(searchTerm));
      });
    }
    
    // Confidence filter
    if (this.filters.confidence !== 'all') {
      filtered = filtered.filter(result => {
        const avgConfidence = this.getAverageConfidence(result);
        
        switch (this.filters.confidence) {
          case 'high': return avgConfidence >= 90;
          case 'medium': return avgConfidence >= 70 && avgConfidence < 90;
          case 'low': return avgConfidence < 70;
          default: return true;
        }
      });
    }
    
    // Detections filter
    if (this.filters.hasDetections !== 'all') {
      filtered = filtered.filter(result => {
        const hasDetections = result.detections && result.detections.length > 0;
        
        switch (this.filters.hasDetections) {
          case 'has-detections': return hasDetections;
          case 'no-detections': return !hasDetections;
          default: return true;
        }
      });
    }
    
    this.filteredResults = filtered;
    this.renderResults();
  }
  
  renderResults() {
    if (this.filteredResults.length === 0) {
      // No longer showing empty state for no results
      return;
    }
    
    this.hideEmptyState();
    
    if (this.currentView === 'grid') {
      this.renderGridView();
    } else {
      this.renderListView();
    }
    
    // Update bulk actions visibility
    this.updateBulkActionsBar();
  }
  
  renderGridView() {
    const container = document.getElementById('results-grid-view');
    
    container.innerHTML = this.filteredResults.map(result => this.createResultCard(result)).join('');
  }
  
  renderListView() {
    const container = document.getElementById('results-list-view');
    
    container.innerHTML = this.filteredResults.map(result => this.createResultListItem(result)).join('');
  }
  
  createResultCard(result) {
    const detections = result.detections || [];
    const avgConfidence = this.getAverageConfidence(result);
    const confidenceClass = this.getConfidenceClass(avgConfidence);
    const isSelected = this.selectedResults.has(result.id);
    
    return `
      <div class="result-card ${isSelected ? 'selected' : ''}" data-result-id="${result.id}">
        <div class="card-image-container">
          ${result.thumbnail ? 
            `<img class="card-image" src="${result.thumbnail}" alt="${result.filename}">` :
            `<div class="card-image" style="background: var(--bg-dark); display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--text-muted);">📸</div>`
          }
          <div class="card-overlay">
            <div class="card-filename">${result.filename}</div>
            <div class="card-dimensions">${result.dimensions || '--'}</div>
          </div>
          <div class="card-actions">
            <button class="card-action-btn" data-action="view" title="View Full Size">👁️</button>
            <button class="card-action-btn" data-action="edit" title="Edit Metadata">✏️</button>
            <button class="card-action-btn" data-action="export" title="Export">📤</button>
          </div>
        </div>
        
        <div class="card-content">
          <div class="card-detection-summary">
            <div class="detection-count">
              <span class="detection-icon">${detections.length > 0 ? '🎯' : '❌'}</span>
              <span>${detections.length} detection${detections.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="confidence-badge ${confidenceClass}">
              ${Math.round(avgConfidence)}%
            </div>
          </div>
          
          <div class="card-detections">
            ${detections.slice(0, 3).map(detection => this.createDetectionItem(detection, result.id)).join('')}
            ${detections.length > 3 ? `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem;">+${detections.length - 3} more</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  
  createDetectionItem(detection, resultId) {
    const participantInfo = detection.participantInfo || {};
    
    return `
      <div class="detection-item" data-detection-id="${detection.id}">
        <div class="detection-info">
          <div class="race-number">${detection.raceNumber || '?'}</div>
          <div class="participant-info">
            <div class="participant-name">${participantInfo.nome || 'Unknown'}</div>
            <input type="text" class="edit-input" value="${participantInfo.nome || ''}" style="display: none;">
            <div class="participant-details">
              ${participantInfo.categoria ? `<span class="participant-detail"><span>🏷️</span><span>${participantInfo.categoria}</span></span>` : ''}
              ${participantInfo.squadra ? `<span class="participant-detail"><span>👥</span><span>${participantInfo.squadra}</span></span>` : ''}
            </div>
          </div>
        </div>
        <div class="edit-actions">
          <button class="edit-btn btn-save" data-action="save">✓</button>
          <button class="edit-btn btn-cancel" data-action="cancel">✕</button>
        </div>
      </div>
    `;
  }
  
  createResultListItem(result) {
    const detections = result.detections || [];
    const avgConfidence = this.getAverageConfidence(result);
    const confidenceClass = this.getConfidenceClass(avgConfidence);
    const isSelected = this.selectedResults.has(result.id);
    
    return `
      <div class="result-list-item ${isSelected ? 'selected' : ''}" data-result-id="${result.id}">
        <div class="list-item-thumbnail">
          ${result.thumbnail ? 
            `<img src="${result.thumbnail}" alt="${result.filename}">` :
            `<div style="background: var(--bg-dark); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: var(--text-muted);">📸</div>`
          }
        </div>
        
        <div class="list-item-content">
          <div class="list-item-filename">${result.filename}</div>
          
          <div class="list-item-detections">
            ${detections.map(d => `<span class="mini-race-number">${d.raceNumber || '?'}</span>`).join('')}
            ${detections.length === 0 ? '<span style="color: var(--text-muted); font-size: 0.8rem;">No detections</span>' : ''}
          </div>
          
          <div class="list-item-confidence">
            <div class="confidence-badge ${confidenceClass}">${Math.round(avgConfidence)}%</div>
          </div>
          
          <div class="list-item-actions">
            <button class="list-action-btn" data-action="view" title="View">👁️</button>
            <button class="list-action-btn" data-action="edit" title="Edit">✏️</button>
            <button class="list-action-btn" data-action="export" title="Export">📤</button>
          </div>
        </div>
      </div>
    `;
  }
  
  switchView(view) {
    this.currentView = view;
    
    // Update toggle buttons
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    // Show/hide views
    const gridView = document.getElementById('results-grid-view');
    const listView = document.getElementById('results-list-view');
    
    if (view === 'grid') {
      gridView.style.display = 'grid';
      listView.classList.remove('active');
    } else {
      gridView.style.display = 'none';
      listView.classList.add('active');
    }
    
    this.renderResults();
  }
  
  selectResult(resultId) {
    this.selectedResults.clear();
    this.selectedResults.add(resultId);
    this.updateSelection();
  }
  
  toggleSelection(resultId) {
    if (this.selectedResults.has(resultId)) {
      this.selectedResults.delete(resultId);
    } else {
      this.selectedResults.add(resultId);
    }
    this.updateSelection();
  }
  
  selectAll() {
    this.filteredResults.forEach(result => {
      this.selectedResults.add(result.id);
    });
    this.updateSelection();
  }
  
  clearSelection() {
    this.selectedResults.clear();
    this.updateSelection();
  }
  
  updateSelection() {
    // Update visual selection
    document.querySelectorAll('.result-card, .result-list-item').forEach(item => {
      const resultId = item.dataset.resultId;
      item.classList.toggle('selected', this.selectedResults.has(resultId));
    });
    
    // Update bulk actions bar
    this.updateBulkActionsBar();
  }
  
  updateBulkActionsBar() {
    const bulkBar = document.getElementById('bulk-actions-bar');
    const selectionCount = document.getElementById('selection-count');
    
    if (this.selectedResults.size > 0) {
      bulkBar.classList.add('visible');
      selectionCount.textContent = this.selectedResults.size;
    } else {
      bulkBar.classList.remove('visible');
    }
  }
  
  handleActionButton(e) {
    e.stopPropagation();
    
    const action = e.target.closest('[data-action]').dataset.action;
    const resultItem = e.target.closest('.result-card, .result-list-item');
    const resultId = resultItem?.dataset.resultId;
    
    if (!resultId) return;
    
    switch (action) {
      case 'view':
        this.openModal(resultId);
        break;
      case 'edit':
        this.editResult(resultId);
        break;
      case 'export':
        this.exportResult(resultId);
        break;
    }
  }
  
  openModal(resultId) {
    const result = this.results.find(r => r.id === resultId);
    if (!result) return;
    
    const modal = document.getElementById('image-modal-enhanced');
    const modalImage = document.getElementById('modal-image-enhanced');
    const modalFilename = document.getElementById('modal-filename');
    const modalMetadata = document.getElementById('modal-metadata');
    
    modalImage.src = result.fullImagePath || result.thumbnail || '';
    modalFilename.textContent = result.filename;
    
    // Populate metadata
    const metadata = {
      'File Size': result.fileSize || '--',
      'Dimensions': result.dimensions || '--',
      'Format': result.format || '--',
      'Detections': result.detections?.length || 0,
      'Average Confidence': `${Math.round(this.getAverageConfidence(result))}%`,
      'Processing Time': result.processingTime ? this.formatTime(result.processingTime) : '--'
    };
    
    modalMetadata.innerHTML = Object.entries(metadata).map(([label, value]) => `
      <div class="metadata-item">
        <div class="metadata-label">${label}</div>
        <div class="metadata-value">${value}</div>
      </div>
    `).join('');
    
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  
  closeModal() {
    const modal = document.getElementById('image-modal-enhanced');
    modal.classList.remove('visible');
    document.body.style.overflow = '';
  }
  
  editResult(resultId) {
    // Find the detection items for this result and enable inline editing
    const resultCard = document.querySelector(`[data-result-id="${resultId}"]`);
    if (!resultCard) return;
    
    const detectionItems = resultCard.querySelectorAll('.detection-item');
    detectionItems.forEach(item => {
      if (item.classList.contains('editing')) {
        // Cancel editing
        item.classList.remove('editing');
      } else {
        // Start editing
        item.classList.add('editing');
        const input = item.querySelector('.edit-input');
        if (input) {
          input.focus();
          input.select();
        }
      }
    });
  }
  
  exportResult(resultId) {
    const result = this.results.find(r => r.id === resultId);
    if (!result) return;
    
    // Create export data
    const exportData = {
      filename: result.filename,
      detections: result.detections || [],
      metadata: result.metadata || {},
      timestamp: new Date().toISOString()
    };
    
    // Trigger download
    this.downloadJSON(exportData, `${result.filename.replace(/\.[^/.]+$/, '')}_analysis.json`);
  }
  
  async bulkExport() {
    const selectedResults = Array.from(this.selectedResults).map(id =>
      this.results.find(r => r.id === id)
    ).filter(Boolean);

    if (selectedResults.length === 0) return;

    // Check if there are active export destinations
    try {
      const destResult = await window.api.invoke('export-destinations-get-active');
      if (destResult.success && destResult.data && destResult.data.length > 0) {
        // Export to destinations
        await this.exportToDestinations(selectedResults);
      } else {
        // Fallback to JSON export
        this.exportAsJSON(selectedResults);
      }
    } catch (error) {
      console.error('[ModernResults] Error checking destinations:', error);
      // Fallback to JSON export
      this.exportAsJSON(selectedResults);
    }
  }

  exportAsJSON(results) {
    const exportData = {
      results: results,
      summary: {
        totalImages: results.length,
        totalDetections: results.reduce((sum, r) => sum + (r.detections?.length || 0), 0),
        exportedAt: new Date().toISOString()
      }
    };

    this.downloadJSON(exportData, `racetagger_analysis_${new Date().toISOString().split('T')[0]}.json`);
  }

  async exportToDestinations(results) {
    // Prepare images data for export
    const images = results.map(result => ({
      imagePath: result.imagePath || result.fullImagePath,
      participant: result.csvMatch || result.participant || null
    }));

    // Show progress modal
    this.showExportProgress(images.length);

    // Listen for progress updates
    const progressHandler = window.api.receive('export-progress', (data) => {
      this.updateExportProgress(data.current, data.total, data.lastResult);
    });

    try {
      const result = await window.api.invoke('export-to-destinations', {
        images,
        event: this.eventInfo || null
      });

      // Remove progress listener
      if (progressHandler) progressHandler();

      // Hide progress modal
      this.hideExportProgress();

      if (result.success) {
        this.showNotification(
          `Exported ${result.exported} images to ${result.processedImages} destination(s). ${result.failed > 0 ? `${result.failed} failed.` : ''}`,
          result.failed > 0 ? 'warning' : 'success'
        );
      } else {
        this.showNotification(result.error || 'Export failed', 'error');
      }
    } catch (error) {
      // Remove progress listener
      if (progressHandler) progressHandler();

      // Hide progress modal
      this.hideExportProgress();

      console.error('[ModernResults] Export error:', error);
      this.showNotification('Export failed: ' + error.message, 'error');
    }
  }

  showExportProgress(totalImages) {
    // Create or show export progress modal
    let progressModal = document.getElementById('export-progress-modal');
    if (!progressModal) {
      progressModal = document.createElement('div');
      progressModal.id = 'export-progress-modal';
      progressModal.className = 'modal-overlay';
      progressModal.innerHTML = `
        <div class="modal-content export-progress-content">
          <h3>📤 Exporting Images</h3>
          <div class="export-progress-info">
            <span id="export-progress-current">0</span> / <span id="export-progress-total">${totalImages}</span>
          </div>
          <div class="export-progress-bar">
            <div class="export-progress-fill" id="export-progress-fill"></div>
          </div>
          <div class="export-progress-status" id="export-progress-status">Starting export...</div>
        </div>
      `;
      document.body.appendChild(progressModal);
    } else {
      document.getElementById('export-progress-total').textContent = totalImages;
      document.getElementById('export-progress-current').textContent = '0';
      document.getElementById('export-progress-fill').style.width = '0%';
      document.getElementById('export-progress-status').textContent = 'Starting export...';
    }
    progressModal.classList.add('active');
    progressModal.style.display = 'flex';
  }

  updateExportProgress(current, total, lastResult) {
    const progressFill = document.getElementById('export-progress-fill');
    const progressCurrent = document.getElementById('export-progress-current');
    const progressStatus = document.getElementById('export-progress-status');

    if (progressFill) {
      progressFill.style.width = `${(current / total) * 100}%`;
    }
    if (progressCurrent) {
      progressCurrent.textContent = current;
    }
    if (progressStatus && lastResult) {
      const successCount = lastResult.successfulExports || 0;
      const failCount = lastResult.failedExports || 0;
      progressStatus.textContent = `Last: ${successCount} exported${failCount > 0 ? `, ${failCount} failed` : ''}`;
    }
  }

  hideExportProgress() {
    const progressModal = document.getElementById('export-progress-modal');
    if (progressModal) {
      progressModal.classList.remove('active');
      progressModal.style.display = 'none';
    }
  }
  
  bulkEditMetadata() {
    // Show bulk edit modal (simplified implementation)
    alert('Bulk metadata editing feature coming soon!');
  }
  
  bulkDelete() {
    if (!confirm(`Remove ${this.selectedResults.size} selected results?`)) return;
    
    // Remove from results array
    this.results = this.results.filter(r => !this.selectedResults.has(r.id));
    this.selectedResults.clear();
    
    // Reapply filters and render
    this.applyFilters();
    this.showNotification(`${this.selectedResults.size} results removed`, 'success');
  }
  
  exportAllResults() {
    if (this.results.length === 0) {
      this.showNotification('No results to export', 'warning');
      return;
    }
    
    const exportData = {
      results: this.results,
      summary: {
        totalImages: this.results.length,
        totalDetections: this.results.reduce((sum, r) => sum + (r.detections?.length || 0), 0),
        exportedAt: new Date().toISOString()
      }
    };
    
    this.downloadJSON(exportData, `racetagger_complete_analysis_${new Date().toISOString().split('T')[0]}.json`);
  }
  
  showEmptyState() {
    document.getElementById('results-empty-state').style.display = 'block';
    document.getElementById('results-grid-view').style.display = 'none';
    document.getElementById('results-list-view').classList.remove('active');
  }
  
  hideEmptyState() {
    document.getElementById('results-empty-state').style.display = 'none';
    
    if (this.currentView === 'grid') {
      document.getElementById('results-grid-view').style.display = 'grid';
    } else {
      document.getElementById('results-list-view').classList.add('active');
    }
  }
  
  getAverageConfidence(result) {
    if (!result.detections || result.detections.length === 0) return 0;
    
    const total = result.detections.reduce((sum, d) => sum + (d.confidence || 0), 0);
    return total / result.detections.length;
  }
  
  getConfidenceClass(confidence) {
    if (confidence >= 90) return 'confidence-high';
    if (confidence >= 70) return 'confidence-medium';
    return 'confidence-low';
  }
  
  formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    this.showNotification(`Exported ${filename}`, 'success');
  }
  
  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `modern-results-notification ${type}`;
    notification.style.cssText = `
      position: fixed;
      top: 2rem;
      right: 2rem;
      background: ${type === 'success' ? 'var(--accent-success)' : type === 'warning' ? 'var(--accent-warning)' : 'var(--accent-primary)'};
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
}

// Initialize modern results display
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit to ensure other components are ready
  setTimeout(() => {
    window.modernResults = new ModernResultsDisplay();
  }, 250);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModernResultsDisplay;
}