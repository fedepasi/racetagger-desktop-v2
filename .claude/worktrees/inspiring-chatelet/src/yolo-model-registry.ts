/**
 * YOLO Model Registry
 *
 * Centralized registry for YOLO segmentation models.
 * Maps model IDs to configurations including class names and paths.
 *
 * Supports both legacy YOLOv8 COCO models and custom YOLOv11 models.
 */

// ==================== COCO Classes (Legacy YOLOv8) ====================

export const COCO_CLASSES: string[] = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
];

// ==================== Custom YOLOv11 Classes ====================

export const YOLOV11_DETECTOR_V1_CLASSES: string[] = [
  'bib-number',     // 0 - Running/cycling bib numbers
  'helmet',         // 1 - Motorcycle/racing helmets
  'rider',          // 2 - Motorcycle/bicycle riders
  'runner',         // 3 - Running athletes
  'soccer-player',  // 4 - Soccer players
  'vehicle',        // 5 - Cars, motorcycles, karts, etc.
];

// ==================== Model Configuration Interface ====================

export interface YoloModelConfig {
  modelId: string;
  modelType: 'yolov8-seg' | 'yolov11-seg';
  version: string;
  description: string;
  storagePath: string;                    // Path relative to models/ directory
  supabasePath?: string;                  // Path in Supabase storage (for download)
  inputSize: [number, number];            // [height, width]
  classes: string[];                      // Class names array
  numClasses: number;                     // Number of classes
  numMaskCoeffs: number;                  // Mask coefficients (typically 32)
  protoSize: number;                      // Mask prototype resolution (typically 160)
  sizeBytes: number;                      // Approximate file size
  isCustom: boolean;                      // Custom trained vs pretrained
}

// ==================== Model Registry ====================

export const YOLO_MODEL_REGISTRY: Record<string, YoloModelConfig> = {
  // Legacy YOLOv8 COCO model (backward compatibility)
  'yolov8n-seg': {
    modelId: 'yolov8n-seg',
    modelType: 'yolov8-seg',
    version: '1.0',
    description: 'YOLOv8 Nano Segmentation - COCO 80 classes',
    storagePath: 'generic/yolov8n-seg.onnx',
    supabasePath: 'generic/yolov8n-seg.onnx',
    inputSize: [640, 640],
    classes: COCO_CLASSES,
    numClasses: 80,
    numMaskCoeffs: 32,
    protoSize: 160,
    sizeBytes: 14_000_000,  // ~14MB
    isCustom: false,
  },

  'yolov8s-seg': {
    modelId: 'yolov8s-seg',
    modelType: 'yolov8-seg',
    version: '1.0',
    description: 'YOLOv8 Small Segmentation - COCO 80 classes',
    storagePath: 'generic/yolov8s-seg.onnx',
    supabasePath: 'generic/yolov8s-seg.onnx',
    inputSize: [640, 640],
    classes: COCO_CLASSES,
    numClasses: 80,
    numMaskCoeffs: 32,
    protoSize: 160,
    sizeBytes: 45_000_000,  // ~45MB
    isCustom: false,
  },

  // Custom YOLOv11 Sports Detector
  'yolov11-detector-v1': {
    modelId: 'yolov11-detector-v1',
    modelType: 'yolov11-seg',
    version: '1.0',
    description: 'YOLOv11 Sports Detector - Custom 6 classes',
    storagePath: 'detector/weights-detector-v1.onnx',
    supabasePath: 'detector/weights-detector-v1.onnx',
    inputSize: [640, 640],
    classes: YOLOV11_DETECTOR_V1_CLASSES,
    numClasses: 6,
    numMaskCoeffs: 32,
    protoSize: 160,
    sizeBytes: 40_000_000,  // ~40MB
    isCustom: true,
  },
};

// ==================== Helper Functions ====================

/**
 * Get model configuration by ID
 */
export function getModelConfig(modelId: string): YoloModelConfig | undefined {
  return YOLO_MODEL_REGISTRY[modelId];
}

/**
 * Get class ID from class name for a specific model
 */
export function getClassId(modelId: string, className: string): number {
  const config = YOLO_MODEL_REGISTRY[modelId];
  if (!config) return -1;
  return config.classes.indexOf(className);
}

/**
 * Get class name from class ID for a specific model
 */
export function getClassName(modelId: string, classId: number): string {
  const config = YOLO_MODEL_REGISTRY[modelId];
  if (!config || classId < 0 || classId >= config.classes.length) {
    return 'unknown';
  }
  return config.classes[classId];
}

/**
 * Convert class names to class IDs for a specific model
 */
export function classNamesToIds(modelId: string, classNames: string[]): number[] {
  const config = YOLO_MODEL_REGISTRY[modelId];
  if (!config) return [];

  return classNames
    .map(name => config.classes.indexOf(name))
    .filter(id => id >= 0);
}

/**
 * Get all available model IDs
 */
export function getAvailableModels(): string[] {
  return Object.keys(YOLO_MODEL_REGISTRY);
}

/**
 * Get the default model ID
 */
export function getDefaultModelId(): string {
  return 'yolov11-detector-v1';
}

/**
 * Check if model is legacy COCO model
 */
export function isCocoModel(modelId: string): boolean {
  const config = YOLO_MODEL_REGISTRY[modelId];
  return config?.modelType === 'yolov8-seg' && !config.isCustom;
}

/**
 * Get relevant class IDs for sport category
 * Maps sport category codes to appropriate class IDs
 */
export function getRelevantClassesForCategory(
  modelId: string,
  categoryCode: string
): number[] {
  const config = YOLO_MODEL_REGISTRY[modelId];
  if (!config) return [];

  // For COCO models, use legacy mapping
  if (isCocoModel(modelId)) {
    const cocoMapping: Record<string, number[]> = {
      'motorsport': [0, 2, 3, 5, 7],      // person, car, motorcycle, bus, truck
      'motorsport_v2': [0, 2, 3, 5, 7],
      'motocross': [0, 3],                 // person, motorcycle
      'running': [0],                       // person
      'cycling': [0, 1],                    // person, bicycle
      'rally': [0, 2, 3, 5, 7],            // person, car, motorcycle, bus, truck
      'endurance-wec': [0, 2, 5, 7],       // person, car, bus, truck
      'altro': [0, 2, 3, 5, 7],            // all vehicles
    };
    return cocoMapping[categoryCode] || [0, 2, 3];
  }

  // For custom YOLOv11 models
  if (modelId === 'yolov11-detector-v1') {
    const customMapping: Record<string, string[]> = {
      'motorsport': ['vehicle'],
      'motorsport_v2': ['vehicle'],
      'motocross': ['rider', 'helmet'],
      'running': ['runner', 'bib-number'],
      'cycling': ['rider', 'bib-number'],
      'rally': ['vehicle'],
      'endurance-wec': ['vehicle'],
      'altro': ['vehicle', 'rider', 'runner', 'soccer-player'],
    };
    const classNames = customMapping[categoryCode] || ['vehicle', 'rider', 'runner'];
    return classNamesToIds(modelId, classNames);
  }

  return [];
}

// ==================== Segmentation Config Type ====================

/**
 * Segmentation config stored in sport_categories.segmentation_config
 */
export interface SegmentationConfig {
  model_id: string;
  relevant_classes: string[];
  confidence_threshold: number;
  iou_threshold: number;
  max_detections: number;
}

/**
 * Parse segmentation config from database JSONB
 */
export function parseSegmentationConfig(dbConfig: any): SegmentationConfig | null {
  if (!dbConfig || typeof dbConfig !== 'object') {
    return null;
  }

  return {
    model_id: dbConfig.model_id || getDefaultModelId(),
    relevant_classes: Array.isArray(dbConfig.relevant_classes)
      ? dbConfig.relevant_classes
      : [],
    confidence_threshold: typeof dbConfig.confidence_threshold === 'number'
      ? dbConfig.confidence_threshold
      : 0.3,
    iou_threshold: typeof dbConfig.iou_threshold === 'number'
      ? dbConfig.iou_threshold
      : 0.45,
    max_detections: typeof dbConfig.max_detections === 'number'
      ? dbConfig.max_detections
      : 5,
  };
}
