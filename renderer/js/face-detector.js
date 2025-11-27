/**
 * Face Detector - Browser-based face detection using face-api.js
 *
 * This module runs in the Electron renderer process where Canvas API is natively available.
 * It loads face-api.js models and performs face detection/embedding generation.
 *
 * Communication with main process via IPC for matching against known drivers.
 */

// ============================================
// Configuration
// ============================================

const FACE_DETECTOR_CONFIG = {
  // Model paths (relative to app)
  modelsPath: './src/assets/models/face-api',

  // Detection options
  minConfidence: 0.5,
  inputSize: 416,  // 128, 160, 224, 320, 416, 512, 608
  scoreThreshold: 0.5,

  // Descriptor generation
  descriptorSize: 128
};

// ============================================
// Face Detector Class
// ============================================

class FaceDetector {
  constructor() {
    this.isInitialized = false;
    this.faceapi = null;
    this.modelsLoaded = false;
    this.initPromise = null;
  }

  /**
   * Initialize face-api.js and load models
   */
  async initialize() {
    // Prevent multiple initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  async _doInitialize() {
    try {
      console.log('[FaceDetector] Starting initialization...');

      // Check if face-api.js is loaded from script tag
      if (!window.faceapi) {
        console.error('[FaceDetector] face-api.js not loaded. Make sure face-api.min.js is included before face-detector.js');
        throw new Error('face-api.js not available - check script loading order');
      }

      console.log('[FaceDetector] face-api.js found (loaded via script tag)');
      this.faceapi = window.faceapi;

      // Get models path - use relative path from renderer HTML
      // In Electron, window.location.href gives us the path to the HTML file
      // HTML is at renderer/index.html, models are at src/assets/models/face-api
      let modelsPath = '../src/assets/models/face-api';

      // Try to get the actual app path from main process (might not be ready on first load)
      try {
        if (window.api && window.api.invoke) {
          const appPath = await window.api.invoke('get-app-path');
          if (appPath) {
            modelsPath = `file://${appPath}/src/assets/models/face-api`;
            console.log('[FaceDetector] Using app path for models');
          }
        }
      } catch (e) {
        console.log('[FaceDetector] IPC not ready, using relative models path');
      }

      console.log(`[FaceDetector] Loading models from: ${modelsPath}`);

      // Load all required models
      await Promise.all([
        this.faceapi.nets.ssdMobilenetv1.loadFromUri(modelsPath),
        this.faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
        this.faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath)
      ]);

      this.modelsLoaded = true;
      this.isInitialized = true;

      console.log('[FaceDetector] All models loaded successfully');
      return { success: true };

    } catch (error) {
      console.error('[FaceDetector] Initialization failed:', error);
      this.isInitialized = false;
      return { success: false, error: error.message };
    }
  }

  /**
   * Detect faces in an image and generate descriptors
   * @param {string} imagePath - Path to the image file
   * @param {Object} options - Detection options
   * @returns {Object} Detection results with faces and descriptors
   */
  async detectFaces(imagePath, options = {}) {
    if (!this.isInitialized) {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return { success: false, error: 'Face detector not initialized', faces: [] };
      }
    }

    const startTime = Date.now();

    try {
      // Load image into canvas
      const img = await this._loadImage(imagePath);

      // Detect faces with landmarks and descriptors
      const detections = await this.faceapi
        .detectAllFaces(img, new this.faceapi.SsdMobilenetv1Options({
          minConfidence: options.minConfidence || FACE_DETECTOR_CONFIG.minConfidence
        }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Convert to serializable format
      const faces = detections.map((detection, index) => ({
        boundingBox: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height
        },
        landmarks: detection.landmarks.positions.map(pt => [pt.x, pt.y]),
        descriptor: Array.from(detection.descriptor), // Convert Float32Array to regular array
        confidence: detection.detection.score
      }));

      const inferenceTimeMs = Date.now() - startTime;

      console.log(`[FaceDetector] Detected ${faces.length} face(s) in ${inferenceTimeMs}ms`);

      return {
        success: true,
        faces,
        inferenceTimeMs
      };

    } catch (error) {
      console.error('[FaceDetector] Detection failed:', error);
      return {
        success: false,
        error: error.message,
        faces: [],
        inferenceTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Detect single face (best for portraits)
   * Returns only the most prominent face
   */
  async detectSingleFace(imagePath, options = {}) {
    if (!this.isInitialized) {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return { success: false, error: 'Face detector not initialized' };
      }
    }

    const startTime = Date.now();

    try {
      const img = await this._loadImage(imagePath);

      // Detect single best face
      const detection = await this.faceapi
        .detectSingleFace(img, new this.faceapi.SsdMobilenetv1Options({
          minConfidence: options.minConfidence || FACE_DETECTOR_CONFIG.minConfidence
        }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        return {
          success: true,
          face: null,
          inferenceTimeMs: Date.now() - startTime
        };
      }

      const face = {
        boundingBox: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height
        },
        landmarks: detection.landmarks.positions.map(pt => [pt.x, pt.y]),
        descriptor: Array.from(detection.descriptor),
        confidence: detection.detection.score
      };

      const inferenceTimeMs = Date.now() - startTime;
      console.log(`[FaceDetector] Single face detected (${(face.confidence * 100).toFixed(1)}%) in ${inferenceTimeMs}ms`);

      return {
        success: true,
        face,
        inferenceTimeMs
      };

    } catch (error) {
      console.error('[FaceDetector] Single face detection failed:', error);
      return {
        success: false,
        error: error.message,
        face: null,
        inferenceTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Generate face descriptor from an image (for adding new reference photos)
   */
  async generateDescriptor(imagePath) {
    const result = await this.detectSingleFace(imagePath);

    if (!result.success || !result.face) {
      return {
        success: false,
        error: result.error || 'No face detected in image'
      };
    }

    return {
      success: true,
      descriptor: result.face.descriptor,
      confidence: result.face.confidence,
      boundingBox: result.face.boundingBox
    };
  }

  /**
   * Load image from file path into an HTMLImageElement
   * @private
   */
  async _loadImage(imagePath) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error(`Failed to load image: ${imagePath}`));

      // Handle both file:// URLs and regular paths
      if (imagePath.startsWith('file://')) {
        img.src = imagePath;
      } else if (imagePath.startsWith('/') || imagePath.match(/^[A-Z]:\\/i)) {
        // Absolute path
        img.src = `file://${imagePath}`;
      } else {
        img.src = imagePath;
      }
    });
  }

  /**
   * Check if detector is ready
   */
  isReady() {
    return this.isInitialized && this.modelsLoaded;
  }

  /**
   * Get detector status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      modelsLoaded: this.modelsLoaded,
      models: this.modelsLoaded ? {
        ssdMobilenetv1: true,
        faceLandmark68Net: true,
        faceRecognitionNet: true
      } : null
    };
  }
}

// ============================================
// Singleton Instance
// ============================================

let faceDetector = null;

function getFaceDetector() {
  if (!faceDetector) {
    faceDetector = new FaceDetector();
  }
  return faceDetector;
}

// ============================================
// IPC Bridge for Main Process Communication
// ============================================

/**
 * Setup IPC listeners for face detection requests from main process
 */
function setupFaceDetectionIPC() {
  if (!window.api || !window.api.receive) {
    console.warn('[FaceDetector] IPC API not available');
    return;
  }

  // Listen for detection requests from main process
  // Note: receive() callback receives only data, not event object
  window.api.receive('face-detection-request', async (data) => {
    const { requestId, imagePath, options } = data;
    console.log(`[FaceDetector] Received detection request: ${requestId} for ${imagePath}`);

    const detector = getFaceDetector();
    const result = await detector.detectFaces(imagePath, options);

    // Send result back to main process
    window.api.send('face-detection-response', {
      requestId,
      ...result
    });
  });

  // Listen for single face detection requests
  window.api.receive('face-detection-single-request', async (data) => {
    const { requestId, imagePath, options } = data;
    console.log(`[FaceDetector] Received single face detection request: ${requestId} for ${imagePath}`);

    const detector = getFaceDetector();
    const result = await detector.detectSingleFace(imagePath, options);

    window.api.send('face-detection-single-response', {
      requestId,
      ...result
    });
  });

  // Listen for descriptor generation requests
  window.api.receive('face-descriptor-request', async (data) => {
    const { requestId, imagePath } = data;
    console.log(`[FaceDetector] Received descriptor generation request: ${requestId}`);

    const detector = getFaceDetector();
    const result = await detector.generateDescriptor(imagePath);

    window.api.send('face-descriptor-response', {
      requestId,
      ...result
    });
  });

  console.log('[FaceDetector] IPC listeners registered');
}

// ============================================
// Auto-initialize on DOM ready
// ============================================

function initFaceDetector() {
  const detector = getFaceDetector();
  setupFaceDetectionIPC();

  // Pre-initialize models in background
  detector.initialize().then(result => {
    if (result.success) {
      console.log('[FaceDetector] Pre-initialized successfully');
    } else {
      console.warn('[FaceDetector] Pre-initialization failed:', result.error);
    }
  });

  return detector;
}

// ============================================
// Export
// ============================================

if (typeof window !== 'undefined') {
  window.FaceDetector = FaceDetector;
  window.getFaceDetector = getFaceDetector;
  window.initFaceDetector = initFaceDetector;
  window.setupFaceDetectionIPC = setupFaceDetectionIPC;
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFaceDetector);
} else {
  // DOM already loaded
  setTimeout(initFaceDetector, 100);
}
