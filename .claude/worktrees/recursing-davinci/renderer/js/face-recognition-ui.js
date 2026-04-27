/**
 * Face Recognition UI Components
 *
 * Provides visual feedback for face recognition results in the desktop app.
 * Shows person match badges when a face is recognized.
 */

// ============================================
// Face Match Badge Component
// ============================================

/**
 * Create a face match badge element
 * @param {Object} match - Person match data
 * @param {string} match.personName - Person's name
 * @param {string} match.team - Team name
 * @param {string} match.carNumber - Car/race number
 * @param {number} match.confidence - Match confidence (0-1)
 * @param {string} match.referencePhotoUrl - URL to person's reference photo
 * @param {string} match.source - Match source ('global' or 'preset')
 * @returns {HTMLElement} Badge element
 */
function createFaceMatchBadge(match) {
  const badge = document.createElement('div');
  badge.className = 'face-match-badge';

  const confidencePercent = Math.round(match.confidence * 100);
  const confidenceClass = confidencePercent >= 80 ? 'high' : confidencePercent >= 60 ? 'medium' : 'low';

  // Support both personName and driverName for backward compatibility
  const name = match.personName || match.driverName || 'Unknown';

  badge.innerHTML = `
    <div class="face-match-content">
      ${match.referencePhotoUrl ? `
        <img src="${match.referencePhotoUrl}"
             class="face-match-thumb"
             alt="${name}"
             onerror="this.style.display='none'" />
      ` : `
        <div class="face-match-thumb face-match-placeholder">
          <span>${name.charAt(0)}</span>
        </div>
      `}
      <div class="face-match-info">
        <span class="face-match-number">#${match.carNumber}</span>
        <span class="face-match-name">${name}</span>
        <span class="face-match-team">${match.team}</span>
      </div>
      <div class="face-match-confidence ${confidenceClass}">
        <span class="confidence-value">${confidencePercent}%</span>
        <span class="confidence-label">Face Match</span>
      </div>
    </div>
    <div class="face-match-source">
      ${match.source === 'global' ? 'Global DB' : 'Preset'}
    </div>
  `;

  return badge;
}

/**
 * Create a compact inline face indicator
 * @param {Object} match - Person match data
 * @returns {HTMLElement} Inline indicator element
 */
function createFaceMatchInline(match) {
  // Support both personName and driverName for backward compatibility
  const name = match.personName || match.driverName || 'Unknown';

  const indicator = document.createElement('span');
  indicator.className = 'face-match-inline';
  indicator.innerHTML = `
    <span class="face-icon">👤</span>
    <span class="face-name">${name}</span>
    <span class="face-confidence">${Math.round(match.confidence * 100)}%</span>
  `;
  indicator.title = `Face match: ${name} (${match.team}) - ${Math.round(match.confidence * 100)}% confidence`;
  return indicator;
}

// ============================================
// Face Recognition Stats Component
// ============================================

/**
 * Face recognition statistics tracker
 */
class FaceRecognitionStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.totalImages = 0;
    this.facesDetected = 0;
    this.facesMatched = 0;
    this.totalConfidence = 0;
    this.byPerson = {};
    this.inferenceTimeTotal = 0;
  }

  addResult(result) {
    this.totalImages++;

    if (result.faceRecognition) {
      this.facesDetected += result.faceRecognition.facesDetected || 0;
      // Support both matchedPersons and matchedDrivers for backward compatibility
      this.facesMatched += result.faceRecognition.matchedPersons || result.faceRecognition.matchedDrivers || 0;
      this.inferenceTimeTotal += result.faceRecognition.inferenceTimeMs || 0;
    }

    if (result.analysis && result.analysis.length > 0) {
      const firstMatch = result.analysis[0];
      if (firstMatch.source === 'face_recognition') {
        this.totalConfidence += firstMatch.confidence || 0;

        // Support both person_name and driver_name for backward compatibility
        const personName = firstMatch.person_name || firstMatch.driver_name;
        if (personName) {
          this.byPerson[personName] = (this.byPerson[personName] || 0) + 1;
        }
      }
    }
  }

  getStats() {
    return {
      totalImages: this.totalImages,
      facesDetected: this.facesDetected,
      facesMatched: this.facesMatched,
      avgConfidence: this.facesMatched > 0 ? this.totalConfidence / this.facesMatched : 0,
      avgInferenceTime: this.totalImages > 0 ? this.inferenceTimeTotal / this.totalImages : 0,
      topPersons: Object.entries(this.byPerson)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      // Backward compatibility
      topDrivers: Object.entries(this.byPerson)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    };
  }
}

// ============================================
// Face Recognition Service
// ============================================

/**
 * Client-side face recognition service
 */
class FaceRecognitionService {
  constructor() {
    this.isInitialized = false;
    this.descriptorCount = 0;
    this.stats = new FaceRecognitionStats();
  }

  /**
   * Initialize face recognition
   */
  async initialize() {
    try {
      const result = await window.api.invoke('face-recognition-initialize');
      this.isInitialized = result.success;
      return result;
    } catch (error) {
      console.error('[FaceRecognitionService] Init error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Load face descriptors from database
   * @param {Array} descriptors - Array of StoredFaceDescriptor objects
   */
  async loadDescriptors(descriptors) {
    try {
      const result = await window.api.invoke('face-recognition-load-descriptors', descriptors);
      if (result.success) {
        this.descriptorCount = result.count;
      }
      return result;
    } catch (error) {
      console.error('[FaceRecognitionService] Load error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Detect and recognize faces in an image
   * @param {string} imagePath - Path to the image
   * @param {string} context - Face context ('portrait', 'podium', 'auto')
   */
  async detect(imagePath, context = 'auto') {
    try {
      const result = await window.api.invoke('face-recognition-detect', imagePath, context);
      return result;
    } catch (error) {
      console.error('[FaceRecognitionService] Detection error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current status
   */
  async getStatus() {
    try {
      return await window.api.invoke('face-recognition-status');
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear loaded descriptors
   */
  async clear() {
    try {
      const result = await window.api.invoke('face-recognition-clear');
      this.descriptorCount = 0;
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats.reset();
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.stats.getStats();
  }
}

// ============================================
// CSS Styles
// ============================================

const faceRecognitionStyles = `
/* Face Match Badge */
.face-match-badge {
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border-radius: 12px;
  padding: 12px 16px;
  margin-top: 8px;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.face-match-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.face-match-thumb {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.face-match-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  font-size: 20px;
  font-weight: bold;
  color: white;
}

.face-match-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.face-match-number {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.face-match-name {
  font-size: 16px;
  font-weight: 700;
  color: white;
}

.face-match-team {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.face-match-confidence {
  text-align: right;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
}

.face-match-confidence.high {
  background: rgba(34, 197, 94, 0.3);
}

.face-match-confidence.medium {
  background: rgba(234, 179, 8, 0.3);
}

.face-match-confidence.low {
  background: rgba(239, 68, 68, 0.3);
}

.confidence-value {
  display: block;
  font-size: 20px;
  font-weight: bold;
  color: #4ade80;
}

.confidence-label {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.face-match-source {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  text-align: right;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* Inline Face Match Indicator */
.face-match-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(59, 130, 246, 0.2);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: #3b82f6;
}

.face-match-inline .face-icon {
  font-size: 14px;
}

.face-match-inline .face-name {
  font-weight: 500;
}

.face-match-inline .face-confidence {
  opacity: 0.7;
  font-size: 11px;
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .face-match-badge {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
}
`;

// ============================================
// Inject Styles
// ============================================

function injectFaceRecognitionStyles() {
  if (!document.getElementById('face-recognition-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'face-recognition-styles';
    styleEl.textContent = faceRecognitionStyles;
    document.head.appendChild(styleEl);
  }
}

// ============================================
// Initialize
// ============================================

let faceRecognitionService = null;

function initFaceRecognitionUI() {
  injectFaceRecognitionStyles();
  faceRecognitionService = new FaceRecognitionService();
  return faceRecognitionService;
}

// ============================================
// Export
// ============================================

if (typeof window !== 'undefined') {
  window.FaceRecognitionService = FaceRecognitionService;
  window.FaceRecognitionStats = FaceRecognitionStats;
  window.createFaceMatchBadge = createFaceMatchBadge;
  window.createFaceMatchInline = createFaceMatchInline;
  window.initFaceRecognitionUI = initFaceRecognitionUI;
  window.getFaceRecognitionService = () => faceRecognitionService;
}
