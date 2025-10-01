/**
 * Streaming View - Modalità ottimizzata per grandi batch di foto
 * Mostra solo l'immagine corrente + ultimi risultati invece di accumulare tutto nel DOM
 */

class StreamingView {
  constructor() {
    this.isActive = false;
    this.recentResults = []; // Buffer circolare degli ultimi risultati
    this.maxRecentResults = 10; // Massimo 10 risultati recenti nel DOM
    this.allResults = []; // Tutti i risultati salvati per la review finale
    this.currentImageElement = null;
    this.recentResultsContainer = null;
    this.statsContainer = null;

    console.log('[StreamingView] Initialized');
  }

  /**
   * Attiva la modalità streaming
   */
  activate() {
    if (this.isActive) return;

    console.log('[StreamingView] Activating streaming mode');
    this.isActive = true;

    // Nascondi la tabella risultati normale
    const resultsContainer = document.getElementById('results');
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
    }

    // Crea l'interfaccia streaming
    this.createStreamingInterface();

    // Mostra messaggio informativo
    this.showInfoMessage();
  }

  /**
   * Disattiva la modalità streaming
   */
  deactivate() {
    if (!this.isActive) return;

    console.log('[StreamingView] Deactivating streaming mode');
    this.isActive = false;

    // Rimuovi interfaccia streaming
    this.removeStreamingInterface();

    // Ripristina tabella normale (se serve)
    const resultsContainer = document.getElementById('results');
    if (resultsContainer) {
      resultsContainer.style.display = 'block';
    }
  }

  /**
   * Crea l'interfaccia per la modalità streaming
   */
  createStreamingInterface() {
    // Contenitore principale streaming
    const streamingContainer = document.createElement('div');
    streamingContainer.id = 'streaming-container';
    streamingContainer.className = 'streaming-container';
    streamingContainer.innerHTML = `
      <div class="streaming-header">
        <h3>🚀 Processing Images</h3>
        <p class="streaming-info">Results are displayed in real-time with optimized performance. You can review all results at the end of processing</p>
      </div>

      <div class="streaming-main">
        <div class="current-image-section">
          <div class="current-image-header">
            <h4>📸 Currently Processing</h4>
          </div>
          <div id="current-image-display" class="current-image-display">
            <div class="image-placeholder">⏳ Preparing...</div>
          </div>
        </div>

        <div class="streaming-sidebar">
          <div class="recent-results-section">
            <h4>✨ Recent Results</h4>
            <div id="recent-results-list" class="recent-results-list">
              <div class="no-results-yet">No results yet...</div>
            </div>
          </div>

          <div class="processing-stats-section">
            <h4>📊 Statistics</h4>
            <div id="streaming-stats" class="streaming-stats">
              <div class="stat-item">
                <span class="stat-label">Found matches:</span>
                <span class="stat-value" id="stat-matches">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">No matches:</span>
                <span class="stat-value" id="stat-no-matches">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Errors:</span>
                <span class="stat-value" id="stat-errors">0</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Inserisci prima del container risultati normale
    const resultsContainer = document.getElementById('results');
    if (resultsContainer && resultsContainer.parentNode) {
      resultsContainer.parentNode.insertBefore(streamingContainer, resultsContainer);
    }

    // Salva riferimenti
    this.currentImageElement = document.getElementById('current-image-display');
    this.recentResultsContainer = document.getElementById('recent-results-list');
    this.statsContainer = document.getElementById('streaming-stats');

    console.log('[StreamingView] Streaming interface created');
  }

  /**
   * Rimuove l'interfaccia streaming
   */
  removeStreamingInterface() {
    const streamingContainer = document.getElementById('streaming-container');
    if (streamingContainer) {
      streamingContainer.remove();
    }

    // Reset riferimenti
    this.currentImageElement = null;
    this.recentResultsContainer = null;
    this.statsContainer = null;
  }

  /**
   * Mostra messaggio informativo
   */
  showInfoMessage() {
    // Potrebbero essere già stati mostrati toast, aggiungiamo uno specifico per lo streaming
    console.log('[StreamingView] Large batch detected - switching to streaming mode for optimal performance');
  }

  /**
   * Aggiorna l'immagine corrente in elaborazione
   */
  updateCurrentImage(fileName, previewDataUrl) {
    if (!this.isActive || !this.currentImageElement) return;

    let imageHtml = '';
    if (previewDataUrl) {
      imageHtml = `
        <div class="current-image-wrapper">
          <img src="${previewDataUrl}" alt="${fileName}" class="current-image">
          <div class="current-image-label">${fileName}</div>
        </div>
      `;
    } else {
      imageHtml = `
        <div class="current-image-wrapper">
          <div class="image-placeholder">📷 ${fileName}</div>
        </div>
      `;
    }

    this.currentImageElement.innerHTML = imageHtml;
    console.log('[StreamingView] Updated current image:', fileName);
  }

  /**
   * Aggiungi un nuovo risultato (senza preview pesante)
   */
  addResult(result) {
    if (!this.isActive) return;

    // Salva TUTTI i risultati per la review finale (solo metadati, no preview)
    const lightResult = {
      fileName: result.fileName,
      imagePath: result.imagePath,
      analysis: result.analysis,
      csvMatch: result.csvMatch,
      timestamp: Date.now(),
      success: result.analysis && result.analysis.length > 0
    };

    this.allResults.push(lightResult);

    // Aggiungi ai risultati recenti (buffer circolare)
    this.recentResults.push(lightResult);
    if (this.recentResults.length > this.maxRecentResults) {
      this.recentResults.shift(); // Rimuovi il più vecchio
    }

    // Aggiorna UI
    this.updateRecentResultsList();
    this.updateStats();

    console.log('[StreamingView] Added result:', result.fileName, '- Total results:', this.allResults.length);
  }

  /**
   * Aggiorna la lista dei risultati recenti
   */
  updateRecentResultsList() {
    if (!this.recentResultsContainer) return;

    if (this.recentResults.length === 0) {
      this.recentResultsContainer.innerHTML = '<div class="no-results-yet">No results yet...</div>';
      return;
    }

    // Mostra solo gli ultimi risultati (dal più recente)
    const recentHtml = this.recentResults
      .slice(-this.maxRecentResults)
      .reverse() // Mostra dal più recente
      .map(result => {
        const status = result.success ? '✅' : '❌';
        const summary = result.success && result.analysis.length > 0
          ? `#${result.analysis[0].raceNumber || '?'}`
          : 'No match';

        return `
          <div class="recent-result-item ${result.success ? 'success' : 'no-match'}">
            <span class="result-status">${status}</span>
            <span class="result-filename">${result.fileName}</span>
            <span class="result-summary">${summary}</span>
          </div>
        `;
      })
      .join('');

    this.recentResultsContainer.innerHTML = recentHtml;
  }

  /**
   * Aggiorna le statistiche
   */
  updateStats() {
    if (!this.allResults.length) return;

    const stats = {
      matches: this.allResults.filter(r => r.success).length,
      noMatches: this.allResults.filter(r => !r.success).length,
      errors: 0 // TODO: tracciare errori se necessario
    };

    const matchElement = document.getElementById('stat-matches');
    const noMatchElement = document.getElementById('stat-no-matches');
    const errorElement = document.getElementById('stat-errors');

    if (matchElement) matchElement.textContent = stats.matches;
    if (noMatchElement) noMatchElement.textContent = stats.noMatches;
    if (errorElement) errorElement.textContent = stats.errors;
  }

  /**
   * Ottieni tutti i risultati salvati
   */
  getAllResults() {
    return this.allResults;
  }

  /**
   * Reset per nuovo batch
   */
  reset() {
    this.recentResults = [];
    this.allResults = [];

    if (this.recentResultsContainer) {
      this.recentResultsContainer.innerHTML = '<div class="no-results-yet">No results yet...</div>';
    }

    if (this.currentImageElement) {
      this.currentImageElement.innerHTML = '<div class="image-placeholder">⏳ Preparing...</div>';
    }

    this.updateStats();
    console.log('[StreamingView] Reset completed');
  }

  /**
   * Mostra pulsante di review al termine
   */
  showReviewButton() {
    if (!this.isActive) return;

    const streamingContainer = document.getElementById('streaming-container');
    if (!streamingContainer) return;

    // Aggiungi sezione review se non esiste
    let reviewSection = streamingContainer.querySelector('.review-section');
    if (!reviewSection) {
      reviewSection = document.createElement('div');
      reviewSection.className = 'review-section';
      reviewSection.innerHTML = `
        <div class="review-complete">
          <h3>🎉 Processing Complete!</h3>
          <p>All ${this.allResults.length} images have been processed successfully.</p>
          <button id="btn-review-results" class="btn btn-primary btn-lg review-btn">
            📸 Review Results & Gallery
          </button>
          <p class="review-note">Browse all results, make corrections, and export final data</p>
        </div>
      `;
      streamingContainer.appendChild(reviewSection);

      // Aggiungi listener per il pulsante
      const reviewBtn = document.getElementById('btn-review-results');
      if (reviewBtn) {
        reviewBtn.addEventListener('click', () => {
          this.openReviewGallery();
        });
      }
    }

    console.log('[StreamingView] Review button shown for', this.allResults.length, 'results');
  }

  /**
   * Apre la galleria di review (placeholder per ora)
   */
  openReviewGallery() {
    console.log('[StreamingView] Opening review gallery for', this.allResults.length, 'results');

    // TODO: Implementare galleria review
    // Per ora mostra alert
    alert(`Review Gallery coming soon!\\n\\nProcessed: ${this.allResults.length} images\\nMatches found: ${this.allResults.filter(r => r.success).length}\\n\\nThis will open a gallery to review all results with navigation and editing capabilities.`);
  }
}

// Istanza globale
window.streamingView = new StreamingView();

console.log('[StreamingView] Module loaded');