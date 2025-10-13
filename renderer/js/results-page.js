/**
 * Results Page Handler
 * Gestisce la pagina dedicata dei risultati con cache intelligente e navigation
 */

class ResultsPageManager {
  constructor() {
    this.executionId = null;
    this.execution = null; // Store full execution object
    this.results = [];
    this.cacheManager = null;
    this.logVisualizer = null;

    console.log('[ResultsPage] Initialized');
    this.init();
  }

  /**
   * Inizializza la pagina risultati
   */
  async init() {
    try {
      // Estrai execution ID dall'URL
      this.executionId = this.getExecutionIdFromUrl();

      if (!this.executionId) {
        this.showError('No execution ID provided');
        return;
      }

      console.log(`[ResultsPage] Loading execution: ${this.executionId}`);

      // Forza invalidazione cache per garantire dati aggiornati
      console.log('[ResultsPage] Forcing cache invalidation for fresh data load');

      // Inizializza il cache manager
      this.cacheManager = new SmartCacheManager();

      // Carica i dati dell'execution
      await this.loadExecutionData();

    } catch (error) {
      console.error('[ResultsPage] Initialization failed:', error);
      this.showError(`Failed to initialize: ${error.message}`);
    }
  }

  /**
   * Estrae l'execution ID dall'URL
   */
  getExecutionIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('executionId');
  }

  /**
   * Carica i dati dell'execution
   */
  async loadExecutionData() {
    try {
      // Carica execution info dal database
      const response = await window.api.invoke('db-get-execution-by-id', this.executionId);

      if (!response || !response.success || !response.data) {
        this.showError('Execution not found');
        return;
      }

      this.execution = response.data;

      // Aggiorna header con info execution
      this.updateHeader(this.execution);

      // Carica i risultati (dai log o dal database)
      await this.loadResults();

    } catch (error) {
      console.error('[ResultsPage] Failed to load execution data:', error);
      this.showError(`Failed to load execution: ${error.message}`);
    }
  }

  /**
   * Aggiorna l'header con le informazioni dell'execution
   */
  updateHeader(execution) {
    const badge = document.getElementById('execution-badge');
    const title = document.getElementById('results-title');
    const subtitle = document.getElementById('results-subtitle');

    if (badge && execution.id) {
      badge.textContent = `#${execution.id.slice(-8)}`;
      badge.style.cssText = `
        background: var(--accent-primary);
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      `;
    }

    // Keep the title as "Analysis Complete!" - don't override it
    // Title is set in HTML and should remain static

    if (subtitle) {
      // Show project name, total images, and date
      const projectName = execution.project_name || execution.folder_name || 'Unnamed Project';
      const totalImages = execution.total_images || 0;
      const photosText = totalImages === 1 ? 'photo' : 'photos';

      subtitle.textContent = `${projectName} • ${totalImages} ${photosText} analyzed`;
    }
  }

  /**
   * Carica i risultati dell'analisi
   */
  async loadResults() {
    try {
      // Prima prova a caricare dai log - forza ricarica per evitare cache stale
      console.log(`[ResultsPage] Loading logs for execution: ${this.executionId}`);
      const logResponse = await window.api.invoke('get-execution-log', this.executionId);

      let logData = [];
      if (logResponse && logResponse.success && logResponse.data) {
        logData = logResponse.data;
        console.log(`[ResultsPage] Successfully loaded ${logData.length} log entries`);
      } else if (logResponse && logResponse.data) {
        logData = logResponse.data;
        console.log(`[ResultsPage] Loaded ${logData.length} log entries (no success flag)`);
      } else {
        console.warn('[ResultsPage] No log data received:', logResponse);
      }

      if (logData && logData.length > 0) {
        // Estrai i risultati dai log
        console.log('[ResultsPage] Extracting results from log data...');
        this.results = await this.extractResultsFromLogs(logData);
        console.log(`[ResultsPage] Extracted ${this.results.length} results from logs`);
      } else {
        // Fallback: carica dal database o storage
        console.log('[ResultsPage] No log data available, trying fallback storage');
        this.results = await this.loadResultsFromStorage();
      }

      if (this.results.length === 0) {
        console.warn('[ResultsPage] No results available - showing empty state');
        this.showEmpty();
        return;
      }

      console.log(`[ResultsPage] Successfully loaded ${this.results.length} results with fresh data`);

      // Inizializza cache per le immagini
      await this.cacheManager.initializeForExecution(this.executionId, this.results);

      // Mostra i risultati
      await this.showResults();

    } catch (error) {
      console.error('[ResultsPage] Failed to load results:', error);
      this.showError(`Failed to load results: ${error.message}`);
    }
  }

  /**
   * Estrae i risultati dai log JSONL
   */
  async extractResultsFromLogs(logData) {
    const results = [];

    for (const entry of logData) {
      if (entry.type === 'IMAGE_ANALYSIS' && entry.fileName) {
        // Estrai TUTTI i veicoli dall'aiResponse
        const vehicles = entry.aiResponse?.vehicles || [];
        const analysis = vehicles.map(vehicle => ({
          raceNumber: vehicle.finalResult?.raceNumber || 'N/A',
          team: vehicle.finalResult?.team || null,
          drivers: vehicle.finalResult?.drivers || [],
          confidence: vehicle.confidence || 0,
          matchedBy: vehicle.finalResult?.matchedBy || 'none'
        }));

        // Cerca i path locali delle anteprime usando saved thumbnail paths o search
        let localPaths = { thumbnailPath: null, microThumbPath: null, compressedPath: null };

        // Prima prova ad usare i path delle thumbnail salvati nei log
        if (entry.thumbnailPath || entry.microThumbPath || entry.compressedPath) {
          console.log(`[ResultsPage] Using saved thumbnail paths from log for ${entry.fileName}:`, {
            thumbnailPath: entry.thumbnailPath,
            microThumbPath: entry.microThumbPath,
            compressedPath: entry.compressedPath
          });
          localPaths = {
            thumbnailPath: entry.thumbnailPath || null,
            microThumbPath: entry.microThumbPath || null,
            compressedPath: entry.compressedPath || null
          };
        } else {
          // Fallback alla ricerca se i path non sono salvati nei log
          try {
            // Usa il nuovo formato con originalFileName e originalPath se disponibili
            const searchParams = entry.originalFileName || entry.originalPath ?
              {
                fileName: entry.fileName,
                originalFileName: entry.originalFileName,
                originalPath: entry.originalPath
              } :
              entry.fileName; // Backward compatibility

            const thumbnailResponse = await window.api.invoke('find-local-thumbnails', searchParams);
            if (thumbnailResponse.success && thumbnailResponse.data) {
              localPaths = thumbnailResponse.data;
            }
          } catch (error) {
            const searchTerm = entry.originalFileName ? `${entry.originalFileName} (original) / ${entry.fileName}` : entry.fileName;
            console.warn(`[ResultsPage] Could not find local thumbnails for ${searchTerm}:`, error);
          }
        }

        results.push({
          fileName: entry.fileName,
          originalFileName: entry.originalFileName, // Preserve original filename for thumbnail lookup
          analysis: analysis,
          confidence: vehicles[0]?.confidence || 0,
          csvMatch: (vehicles[0]?.participantMatch && vehicles[0].participantMatch.entry) ? vehicles[0].participantMatch : null,
          imagePath: localPaths.thumbnailPath || entry.supabaseUrl, // Usa path locale o Supabase come fallback
          compressedPath: (localPaths.compressedPath && localPaths.compressedPath !== 'null') ? localPaths.compressedPath : entry.supabaseUrl,
          thumbnailPath: (localPaths.thumbnailPath && localPaths.thumbnailPath !== 'null') ? localPaths.thumbnailPath : entry.supabaseUrl,
          microThumbPath: (localPaths.microThumbPath && localPaths.microThumbPath !== 'null') ? localPaths.microThumbPath : entry.supabaseUrl,
          timestamp: entry.timestamp
        });
      }
    }

    console.log(`[ResultsPage] Extracted ${results.length} results from ${logData.length} log entries`);
    return results;
  }

  /**
   * Carica risultati da storage alternativo
   */
  async loadResultsFromStorage() {
    // Implementazione futura: caricamento da database o cache
    console.log('[ResultsPage] No results found in logs, checking alternative storage...');
    return [];
  }

  /**
   * Mostra i risultati utilizzando il LogVisualizer
   */
  async showResults() {
    // Nascondi loading state
    document.getElementById('results-loading').classList.remove('show');

    // Mostra container risultati (ora basta rimuovere display:none)
    const container = document.getElementById('log-visualizer-container');
    container.style.display = 'block';

    // Crea HTML per il log visualizer
    container.innerHTML = `
      <div id="lv-dashboard" class="lv-dashboard">
        <div id="lv-header" class="lv-header">
          <div class="lv-stats" id="lv-stats">
            <div class="lv-stat-item">
              <span class="lv-stat-value" id="lv-total-images">${this.results.length}</span>
              <span class="lv-stat-label">Images</span>
            </div>
            <div class="lv-stat-item">
              <span class="lv-stat-value" id="lv-successful">${this.getSuccessfulCount()}</span>
              <span class="lv-stat-label">Recognized</span>
            </div>
            <div class="lv-stat-item">
              <span class="lv-stat-value" id="lv-csv-matches">${this.getCsvMatchCount()}</span>
              <span class="lv-stat-label">CSV Match</span>
            </div>
            <div class="lv-stat-item">
              <span class="lv-stat-value" id="lv-avg-confidence">${this.getAvgConfidence()}%</span>
              <span class="lv-stat-label">Confidence</span>
            </div>
          </div>

          <div class="lv-filters" id="lv-filters">
            <div class="lv-search-container">
              <input type="text" id="lv-search" placeholder="Search images..." class="lv-search">
            </div>
            <div class="lv-filter-controls">
              <select id="lv-filter-type" class="lv-filter-select">
                <option value="all">All Images</option>
                <option value="recognized">With Recognition</option>
                <option value="no-recognition">No Recognition</option>
                <option value="csv-match">CSV Match</option>
                <option value="manual-edit">Manual Edits</option>
              </select>
              <button id="lv-clear-filters" class="lv-clear-btn">Clear</button>
            </div>
          </div>
        </div>

        <div class="lv-results-container" id="lv-results-container">
          <div class="lv-results-grid" id="lv-results">
            <div id="lv-spacer-top"></div>
            <div id="lv-visible-items" class="lv-visible-items"></div>
            <div id="lv-spacer-bottom"></div>
          </div>
        </div>
      </div>

      <!-- Gallery Modal -->
      <div id="lv-gallery" class="lv-gallery-modal" style="display: none;">
        <div id="lv-gallery-overlay" class="lv-gallery-overlay"></div>
        <div class="lv-gallery-container">
          <!-- Gallery content sarà gestito dal LogVisualizer -->
        </div>
      </div>
    `;

    // Inizializza LogVisualizer ottimizzato
    await this.initializeLogVisualizer();
  }

  /**
   * Inizializza LogVisualizer con cache ottimizzata
   */
  async initializeLogVisualizer() {
    // Crea LogVisualizer modificato per usare il cache manager
    this.logVisualizer = new LogVisualizer();

    // Override del metodo getThumbnailUrl per usare il cache manager
    const originalGetThumbnailUrl = this.logVisualizer.getThumbnailUrl.bind(this.logVisualizer);
    this.logVisualizer.getThumbnailUrl = (result) => {
      return this.cacheManager.getImageUrl(result);
    };

    // Inizializza con i risultati (pass execution object for folder organization check)
    await this.logVisualizer.init(this.executionId, this.results, this.execution);

    // Render the dashboard
    this.logVisualizer.render('#log-visualizer-container');
  }

  /**
   * Calcola statistiche per l'header
   */
  getSuccessfulCount() {
    return this.results.filter(r => r.analysis && r.analysis.length > 0).length;
  }

  getCsvMatchCount() {
    return this.results.filter(r => r.csvMatch).length;
  }

  getAvgConfidence() {
    const confidences = this.results
      .filter(r => r.analysis && r.analysis.length > 0)
      .map(r => Math.max(...r.analysis.map(a => a.confidence || 0)));

    if (confidences.length === 0) return 0;

    const avg = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    return Math.round(avg * 100);
  }

  /**
   * Mostra stato di errore
   */
  showError(message) {
    document.getElementById('results-loading').classList.remove('show');
    document.getElementById('results-error').classList.add('show');
    document.getElementById('error-message').textContent = message;
  }

  /**
   * Mostra stato vuoto
   */
  showEmpty() {
    document.getElementById('results-loading').classList.remove('show');
    document.getElementById('results-empty').classList.add('show');
  }
}

/**
 * Smart Cache Manager per gestione ottimizzata delle immagini
 */
class SmartCacheManager {
  constructor() {
    this.executionCaches = new Map(); // executionId -> cache
    this.maxExecutions = 3;
    this.maxCacheSize = 50; // Max immagini in memoria
    this.maxAgeMinutes = 30;

    // Error handling and throttling
    this.loggedErrors = new Set(); // Track logged errors to prevent spam
    this.failedImages = new Set(); // Track failed images to avoid retrying

    console.log('[SmartCacheManager] Initialized');
  }

  /**
   * Inizializza cache per una execution
   */
  async initializeForExecution(executionId, results) {
    console.log(`[SmartCacheManager] Initializing cache for execution ${executionId}`);

    // Crea cache per questa execution
    const cache = {
      executionId,
      results,
      memoryCache: new Map(),
      lastAccess: Date.now(),
      status: 'active'
    };

    this.executionCaches.set(executionId, cache);

    // Cleanup vecchie cache se necessario
    this.cleanup();

    // Pre-carica micro-thumbnails per la lista
    await this.preloadMicroThumbnails(cache);
  }

  /**
   * Pre-carica micro-thumbnails (32x32) per visualizzazione immediata
   */
  async preloadMicroThumbnails(cache) {
    console.log(`[SmartCacheManager] Pre-loading micro-thumbnails for ${cache.results.length} images`);

    // Pre-carica solo i primi 20 per non bloccare l'UI
    const batchSize = 20;
    for (let i = 0; i < Math.min(batchSize, cache.results.length); i++) {
      const result = cache.results[i];
      if (result.microThumbPath) {
        this.loadImageToMemory(result.fileName, result.microThumbPath, 'micro');
      }
    }
  }

  /**
   * Ottiene URL dell'immagine con strategia di caricamento intelligente
   */
  getImageUrl(result) {
    console.log(`[SmartCacheManager] getImageUrl for ${result.fileName}:`, {
      thumbnailPath: !!result.thumbnailPath,
      compressedPath: !!result.compressedPath,
      supabaseUrl: !!result.supabaseUrl,
      imagePath: !!result.imagePath,
      microThumbPath: !!result.microThumbPath
    });

    // Prima: controlla cache memoria
    const cached = this.getCachedImage(result.fileName);
    if (cached) {
      console.log(`[SmartCacheManager] Using cached image for ${result.fileName}`);
      return cached.url;
    }

    // Seconda: prova thumbnail locale, ma con fallback a Supabase se non esiste
    if (result.thumbnailPath) {
      // Se è un percorso locale (inizia con /), controlla se è un file locale o una URL
      if (result.thumbnailPath.startsWith('/')) {
        // Percorso locale - verifica esistenza e carica in background
        console.log(`[SmartCacheManager] Using local thumbnailPath for ${result.fileName}`);
        this.loadImageToMemory(result.fileName, result.thumbnailPath, 'thumb');
        return result.thumbnailPath;
      } else if (result.thumbnailPath.startsWith('http')) {
        // URL Supabase - usa direttamente
        console.log(`[SmartCacheManager] Using Supabase thumbnailPath for ${result.fileName}`);
        return result.thumbnailPath;
      }
    }

    // Fallback: usa compressed con stessa logica (priorità alta)
    if (result.compressedPath) {
      if (result.compressedPath.startsWith('/')) {
        console.log(`[SmartCacheManager] Using compressedPath for ${result.fileName}`);
        return result.compressedPath;
      } else if (result.compressedPath.startsWith('http')) {
        console.log(`[SmartCacheManager] Using Supabase compressedPath for ${result.fileName}`);
        return result.compressedPath;
      }
    }

    // Fallback: Supabase URL originale
    if (result.supabaseUrl) {
      console.log(`[SmartCacheManager] Using supabaseUrl for ${result.fileName}`);
      return result.supabaseUrl;
    }

    // Penultimo fallback: imagePath generico
    if (result.imagePath) {
      if (result.imagePath.startsWith('http')) {
        console.log(`[SmartCacheManager] Using imagePath URL for ${result.fileName}`);
        return result.imagePath;
      } else {
        console.log(`[SmartCacheManager] Using local imagePath for ${result.fileName}`);
        return `file://${result.imagePath}`;
      }
    }

    // Ultimo fallback: micro-thumbnail (solo se nient'altro è disponibile)
    if (result.microThumbPath) {
      if (result.microThumbPath.startsWith('/')) {
        console.log(`[SmartCacheManager] Using microThumbPath as last resort for ${result.fileName}`);
        return result.microThumbPath;
      } else if (result.microThumbPath.startsWith('http')) {
        console.log(`[SmartCacheManager] Using Supabase microThumbPath as last resort for ${result.fileName}`);
        return result.microThumbPath;
      }
    }

    console.warn(`[SmartCacheManager] No image source found for ${result.fileName}`, result);
    return this.getPlaceholderUrl();
  }

  /**
   * Carica immagine nella cache memoria
   */
  async loadImageToMemory(fileName, imagePath, type = 'thumb') {
    try {
      // Skip if already failed
      const failKey = `${fileName}:${imagePath}`;
      if (this.failedImages.has(failKey)) {
        return;
      }

      // Gestisci limite cache
      if (this.getMemoryCacheSize() >= this.maxCacheSize) {
        this.evictLeastRecentlyUsed();
      }

      const img = new Image();
      img.onload = () => {
        this.setMemoryCache(fileName, {
          url: imagePath,
          type,
          loadTime: Date.now(),
          size: this.estimateImageSize(img)
        });
      };

      img.onerror = (error) => {
        this.failedImages.add(failKey);
        this.logImageError(fileName, error, `loading ${type}`);
      };

      img.src = imagePath;

    } catch (error) {
      this.logImageError(fileName, error, `initializing ${type}`);
    }
  }

  /**
   * Log image errors with throttling to prevent console spam
   */
  logImageError(fileName, error, context = '') {
    const errorKey = `${fileName}_${context}`;
    if (this.loggedErrors.has(errorKey)) {
      return; // Already logged this specific error
    }

    this.loggedErrors.add(errorKey);
    console.warn(`[SmartCacheManager] Failed to load ${fileName} (${context}):`, error);

    // Clean up logged errors periodically to allow retry after some time
    setTimeout(() => {
      this.loggedErrors.delete(errorKey);
    }, 60000); // 1 minute
  }

  /**
   * Ottiene immagine dalla cache
   */
  getCachedImage(fileName) {
    for (const cache of this.executionCaches.values()) {
      if (cache.memoryCache.has(fileName)) {
        const cached = cache.memoryCache.get(fileName);
        cached.lastAccess = Date.now();
        return cached;
      }
    }
    return null;
  }

  /**
   * Imposta immagine nella cache
   */
  setMemoryCache(fileName, imageData) {
    // Trova cache attiva
    for (const cache of this.executionCaches.values()) {
      if (cache.status === 'active') {
        cache.memoryCache.set(fileName, imageData);
        break;
      }
    }
  }

  /**
   * Calcola dimensione cache memoria
   */
  getMemoryCacheSize() {
    let total = 0;
    for (const cache of this.executionCaches.values()) {
      total += cache.memoryCache.size;
    }
    return total;
  }

  /**
   * Rimuove immagini meno utilizzate (LRU)
   */
  evictLeastRecentlyUsed() {
    let oldestTime = Date.now();
    let oldestKey = null;
    let oldestCache = null;

    for (const cache of this.executionCaches.values()) {
      for (const [key, value] of cache.memoryCache.entries()) {
        if (value.lastAccess < oldestTime) {
          oldestTime = value.lastAccess;
          oldestKey = key;
          oldestCache = cache;
        }
      }
    }

    if (oldestKey && oldestCache) {
      oldestCache.memoryCache.delete(oldestKey);
      console.log(`[SmartCacheManager] Evicted ${oldestKey} from memory cache`);
    }
  }

  /**
   * Cleanup cache generale
   */
  cleanup() {
    // Rimuovi execution più vecchie se supero il limite
    if (this.executionCaches.size > this.maxExecutions) {
      const sortedCaches = Array.from(this.executionCaches.entries())
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

      const toRemove = sortedCaches.slice(0, sortedCaches.length - this.maxExecutions);
      for (const [executionId] of toRemove) {
        this.executionCaches.delete(executionId);
        console.log(`[SmartCacheManager] Removed cache for execution ${executionId}`);
      }
    }

    // Rimuovi cache scadute
    const now = Date.now();
    const maxAge = this.maxAgeMinutes * 60 * 1000;

    for (const [executionId, cache] of this.executionCaches.entries()) {
      if (now - cache.lastAccess > maxAge) {
        this.executionCaches.delete(executionId);
        console.log(`[SmartCacheManager] Expired cache for execution ${executionId}`);
      }
    }
  }

  /**
   * Stima dimensione immagine
   */
  estimateImageSize(img) {
    // Stima approssimativa basata su dimensioni
    return img.width * img.height * 4; // RGBA
  }

  /**
   * URL placeholder per immagini mancanti
   */
  getPlaceholderUrl() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OTk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIG5vdCBhdmFpbGFibGU8L3RleHQ+PC9zdmc+';
  }
}

// Inizializza la pagina quando il DOM è pronto
document.addEventListener('DOMContentLoaded', () => {
  new ResultsPageManager();
});