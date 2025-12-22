// Scene Classification Indicator
// Shows scene classification results during processing

class SceneIndicator {
  constructor() {
    this.isModelLoaded = false;
    this.modelInfo = null;
    this.sceneStats = {
      total: 0,
      byScene: {
        racing_action: 0,
        portrait_paddock: 0,
        podium_celebration: 0,
        garage_pitlane: 0,
        crowd_scene: 0
      },
      avgConfidence: 0,
      totalConfidence: 0,
      skipped: 0
    };

    // Scene category display names and colors
    this.sceneConfig = {
      racing_action: {
        label: 'Racing',
        icon: '🏎️',
        color: '#e74c3c',
        description: 'On-track racing action'
      },
      portrait_paddock: {
        label: 'Portrait',
        icon: '👤',
        color: '#3498db',
        description: 'Portrait/paddock shots'
      },
      podium_celebration: {
        label: 'Podium',
        icon: '🏆',
        color: '#f1c40f',
        description: 'Podium celebrations'
      },
      garage_pitlane: {
        label: 'Garage',
        icon: '🔧',
        color: '#9b59b6',
        description: 'Garage/pitlane scenes'
      },
      crowd_scene: {
        label: 'Crowd',
        icon: '👥',
        color: '#95a5a6',
        description: 'Crowd/spectator shots'
      }
    };

    this.init();
  }

  async init() {
    // Initialize the scene classifier on startup
    try {
      const result = await window.api.invoke('scene-classifier-initialize');
      if (result.success) {
        this.isModelLoaded = true;
        this.modelInfo = result.modelInfo;
      }
    } catch (error) {
      console.error('[SceneIndicator] Failed to initialize scene classifier:', error);
    }
  }

  // Create the scene indicator element
  createIndicatorElement() {
    const container = document.createElement('div');
    container.id = 'scene-indicator-container';
    container.className = 'scene-indicator-container';
    container.innerHTML = `
      <div class="scene-indicator-header">
        <span class="scene-indicator-title">Scene Classification</span>
        <span class="scene-indicator-status" id="scene-model-status">
          ${this.isModelLoaded ? '✓ Ready' : '⏳ Loading...'}
        </span>
      </div>
      <div class="scene-indicator-current" id="scene-current-result">
        <span class="scene-badge scene-badge-idle">Waiting...</span>
      </div>
      <div class="scene-indicator-stats" id="scene-stats-container">
        <div class="scene-stat-row">
          <span class="scene-stat-icon">${this.sceneConfig.racing_action.icon}</span>
          <span class="scene-stat-label">Racing</span>
          <span class="scene-stat-count" id="scene-count-racing">0</span>
        </div>
        <div class="scene-stat-row">
          <span class="scene-stat-icon">${this.sceneConfig.portrait_paddock.icon}</span>
          <span class="scene-stat-label">Portrait</span>
          <span class="scene-stat-count" id="scene-count-portrait">0</span>
        </div>
        <div class="scene-stat-row">
          <span class="scene-stat-icon">${this.sceneConfig.podium_celebration.icon}</span>
          <span class="scene-stat-label">Podium</span>
          <span class="scene-stat-count" id="scene-count-podium">0</span>
        </div>
        <div class="scene-stat-row">
          <span class="scene-stat-icon">${this.sceneConfig.garage_pitlane.icon}</span>
          <span class="scene-stat-label">Garage</span>
          <span class="scene-stat-count" id="scene-count-garage">0</span>
        </div>
        <div class="scene-stat-row">
          <span class="scene-stat-icon">${this.sceneConfig.crowd_scene.icon}</span>
          <span class="scene-stat-label">Crowd</span>
          <span class="scene-stat-count" id="scene-count-crowd">0</span>
        </div>
        <div class="scene-stat-row scene-stat-skipped">
          <span class="scene-stat-icon">⏭️</span>
          <span class="scene-stat-label">Skipped</span>
          <span class="scene-stat-count" id="scene-count-skipped">0</span>
        </div>
      </div>
    `;
    return container;
  }

  // Create a scene badge for a specific category
  createSceneBadge(category, confidence) {
    const config = this.sceneConfig[category] || {
      label: category,
      icon: '❓',
      color: '#666'
    };

    const confidencePercent = Math.round(confidence * 100);
    const badge = document.createElement('span');
    badge.className = `scene-badge scene-badge-${category}`;
    badge.style.backgroundColor = config.color;
    badge.innerHTML = `
      ${config.icon} ${config.label}
      <span class="scene-confidence">${confidencePercent}%</span>
    `;
    badge.title = `${config.description} (${confidencePercent}% confidence)`;

    return badge;
  }

  // Update the current scene display
  updateCurrentScene(classification) {
    const container = document.getElementById('scene-current-result');
    if (!container) return;

    const { category, confidence } = classification;
    container.innerHTML = '';
    container.appendChild(this.createSceneBadge(category, confidence));

    // Update stats
    this.sceneStats.total++;
    this.sceneStats.byScene[category] = (this.sceneStats.byScene[category] || 0) + 1;
    this.sceneStats.totalConfidence += confidence;
    this.sceneStats.avgConfidence = this.sceneStats.totalConfidence / this.sceneStats.total;

    this.updateStatsDisplay();
  }

  // Update stats display
  updateStatsDisplay() {
    const counts = {
      'scene-count-racing': this.sceneStats.byScene.racing_action || 0,
      'scene-count-portrait': this.sceneStats.byScene.portrait_paddock || 0,
      'scene-count-podium': this.sceneStats.byScene.podium_celebration || 0,
      'scene-count-garage': this.sceneStats.byScene.garage_pitlane || 0,
      'scene-count-crowd': this.sceneStats.byScene.crowd_scene || 0,
      'scene-count-skipped': this.sceneStats.skipped || 0
    };

    Object.entries(counts).forEach(([id, count]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    });
  }

  // Mark an image as skipped
  markSkipped() {
    this.sceneStats.skipped++;
    this.updateStatsDisplay();

    const container = document.getElementById('scene-current-result');
    if (container) {
      container.innerHTML = '<span class="scene-badge scene-badge-skipped">⏭️ Skipped</span>';
    }
  }

  // Reset stats
  resetStats() {
    this.sceneStats = {
      total: 0,
      byScene: {
        racing_action: 0,
        portrait_paddock: 0,
        podium_celebration: 0,
        garage_pitlane: 0,
        crowd_scene: 0
      },
      avgConfidence: 0,
      totalConfidence: 0,
      skipped: 0
    };
    this.updateStatsDisplay();

    const container = document.getElementById('scene-current-result');
    if (container) {
      container.innerHTML = '<span class="scene-badge scene-badge-idle">Waiting...</span>';
    }
  }

  // Get current stats
  getStats() {
    return { ...this.sceneStats };
  }

  // Classify a single image (async)
  async classifyImage(imagePath) {
    if (!this.isModelLoaded) {
      return null;
    }

    try {
      const result = await window.api.invoke('scene-classifier-classify', imagePath);
      if (result.success) {
        this.updateCurrentScene(result.result);
        return result.result;
      } else {
        console.error('[SceneIndicator] Classification failed:', result.error);
        return null;
      }
    } catch (error) {
      console.error('[SceneIndicator] Classification error:', error);
      return null;
    }
  }

  // Route an image through smart router
  async routeImage(imagePath) {
    try {
      const result = await window.api.invoke('smart-router-route', imagePath);
      if (result.success) {
        this.updateCurrentScene({
          category: result.decision.sceneCategory,
          confidence: result.decision.sceneConfidence
        });

        if (result.decision.pipeline === 'skip') {
          this.markSkipped();
        }

        return result.decision;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }
}

// CSS Styles for scene indicator
const sceneIndicatorStyles = `
.scene-indicator-container {
  background: rgba(30, 30, 30, 0.95);
  border-radius: 12px;
  padding: 16px;
  margin: 12px 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.scene-indicator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.scene-indicator-title {
  font-weight: 600;
  font-size: 14px;
  color: #fff;
}

.scene-indicator-status {
  font-size: 12px;
  color: #4ade80;
}

.scene-indicator-current {
  margin-bottom: 12px;
  min-height: 32px;
  display: flex;
  align-items: center;
}

.scene-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  transition: all 0.2s ease;
}

.scene-badge-idle {
  background: rgba(100, 100, 100, 0.5);
}

.scene-badge-skipped {
  background: rgba(100, 100, 100, 0.5);
}

.scene-confidence {
  font-size: 11px;
  opacity: 0.8;
  margin-left: 4px;
}

.scene-indicator-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scene-stat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.scene-stat-icon {
  width: 20px;
  text-align: center;
}

.scene-stat-label {
  flex: 1;
}

.scene-stat-count {
  font-weight: 600;
  min-width: 30px;
  text-align: right;
}

.scene-stat-skipped {
  opacity: 0.6;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* Badge colors by scene type */
.scene-badge-racing_action { background: #e74c3c; }
.scene-badge-portrait_paddock { background: #3498db; }
.scene-badge-podium_celebration { background: #f1c40f; color: #000; }
.scene-badge-garage_pitlane { background: #9b59b6; }
.scene-badge-crowd_scene { background: #95a5a6; }
`;

// Inject styles
function injectSceneIndicatorStyles() {
  if (!document.getElementById('scene-indicator-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'scene-indicator-styles';
    styleEl.textContent = sceneIndicatorStyles;
    document.head.appendChild(styleEl);
  }
}

// Initialize on load
let sceneIndicator = null;

function initSceneIndicator() {
  injectSceneIndicatorStyles();
  sceneIndicator = new SceneIndicator();
  return sceneIndicator;
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.SceneIndicator = SceneIndicator;
  window.initSceneIndicator = initSceneIndicator;
  window.getSceneIndicator = () => sceneIndicator;
}
