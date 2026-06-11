/**
 * Crop Context Extractor
 *
 * Extracts high-resolution crops of subjects from ORIGINAL images (before compression)
 * and generates "negative" context images with masked subject regions.
 *
 * Used for improved race number recognition by:
 * 1. Sending high-res crops to Gemini for better OCR accuracy
 * 2. Sending context (negative) for sponsor/team identification
 *
 * IMPORTANT: This module is designed for backward compatibility.
 * If crop_config is null or disabled, the calling code should use existing flow.
 */

import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { MaskCropConfig, DEFAULT_MASK_CROP_CONFIG as CONFIG_DEFAULT_MASK_CROP_CONFIG } from '../config';
import { encodeMaskToRLE, SegmentationMaskData } from './mask-rle';

// Logger (matches existing pattern in codebase)
const log = {
  info: (msg: string, ...args: any[]) => console.log(`[CropContextExtractor] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[CropContextExtractor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[CropContextExtractor] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.log(`[CropContextExtractor] [DEBUG] ${msg}`, ...args),
};

/**
 * Bounding box in normalized 0-1 format (matches ONNX detector output)
 */
export interface BoundingBox {
  x: number;      // Top-left X (normalized 0-1)
  y: number;      // Top-left Y (normalized 0-1)
  width: number;  // Width (normalized 0-1)
  height: number; // Height (normalized 0-1)
}

/**
 * Configuration for crop extraction
 */
export interface CropConfig {
  paddingPercent: number;   // Padding around bbox (0.15 = 15%)
  minPaddingPx: number;     // Minimum padding in pixels (50px)
  minDimension: number;     // Minimum crop dimension (640px)
  maxDimension: number;     // Maximum crop dimension (1024px)
  jpegQuality: number;      // JPEG quality (90)
}

/**
 * Configuration for negative/context image generation
 */
export interface NegativeConfig {
  enabled: boolean;         // Whether to generate negative (default: true)
  maskColor: string;        // Mask color (#000000 for black)
  maxDimension: number;     // Maximum dimension (1440px)
  jpegQuality: number;      // JPEG quality (80)
}

/**
 * Default crop configuration
 */
export const DEFAULT_CROP_CONFIG: CropConfig = {
  paddingPercent: 0.15,
  minPaddingPx: 50,
  minDimension: 256,  // Lowered from 640px to support smaller/distant vehicles (IMSA, endurance racing)
  maxDimension: 1024,
  jpegQuality: 90,
};

/**
 * Default negative configuration
 */
export const DEFAULT_NEGATIVE_CONFIG: NegativeConfig = {
  enabled: true,
  maskColor: '#000000',
  maxDimension: 1440,
  jpegQuality: 80,
};

/**
 * Edge detection flags for partial subjects
 */
export interface EdgeFlags {
  touchesTop: boolean;
  touchesBottom: boolean;
  touchesLeft: boolean;
  touchesRight: boolean;
  isPartial: boolean;
}

/**
 * Result of a single crop extraction
 */
export interface CropResult {
  buffer: Buffer;
  detectionId: string;
  originalBbox: BoundingBox;
  paddedBbox: BoundingBox;
  resolution: { width: number; height: number };
  sizeBytes: number;
  edgeFlags: EdgeFlags;
}

/**
 * Result of negative generation
 */
export interface NegativeResult {
  buffer: Buffer;
  maskedRegions: BoundingBox[];
  resolution: { width: number; height: number };
  sizeBytes: number;
}

/**
 * Combined result for crop + context
 */
export interface CropContextResult {
  crops: CropResult[];
  negative: NegativeResult | null;
  originalDimensions: { width: number; height: number };
  processingTimeMs: number;
}

/**
 * Calculate pixel coordinates from normalized bbox with padding
 */
function calculatePixelRegion(
  bbox: BoundingBox,
  imageWidth: number,
  imageHeight: number,
  config: CropConfig
): { x: number; y: number; width: number; height: number; paddedBbox: BoundingBox; edgeFlags: EdgeFlags } {
  // Convert normalized to pixels
  const bboxPixelX = Math.round(bbox.x * imageWidth);
  const bboxPixelY = Math.round(bbox.y * imageHeight);
  const bboxPixelW = Math.round(bbox.width * imageWidth);
  const bboxPixelH = Math.round(bbox.height * imageHeight);

  // Calculate padding in pixels
  const paddingX = Math.max(
    config.minPaddingPx,
    Math.round(bboxPixelW * config.paddingPercent)
  );
  const paddingY = Math.max(
    config.minPaddingPx,
    Math.round(bboxPixelH * config.paddingPercent)
  );

  // Apply padding, clamping to image bounds
  const x1 = Math.max(0, bboxPixelX - paddingX);
  const y1 = Math.max(0, bboxPixelY - paddingY);
  const x2 = Math.min(imageWidth, bboxPixelX + bboxPixelW + paddingX);
  const y2 = Math.min(imageHeight, bboxPixelY + bboxPixelH + paddingY);

  // Detect edge-touching (partial subjects)
  const edgeFlags: EdgeFlags = {
    touchesTop: bbox.y <= 0.01,
    touchesBottom: bbox.y + bbox.height >= 0.99,
    touchesLeft: bbox.x <= 0.01,
    touchesRight: bbox.x + bbox.width >= 0.99,
    isPartial: false,
  };
  edgeFlags.isPartial = edgeFlags.touchesTop || edgeFlags.touchesBottom ||
                        edgeFlags.touchesLeft || edgeFlags.touchesRight;

  // Calculate padded bbox in normalized coords (for reference)
  const paddedBbox: BoundingBox = {
    x: x1 / imageWidth,
    y: y1 / imageHeight,
    width: (x2 - x1) / imageWidth,
    height: (y2 - y1) / imageHeight,
  };

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    paddedBbox,
    edgeFlags,
  };
}

/**
 * Extract a single crop from the original image
 */
export async function extractSingleCrop(
  originalPath: string,
  bbox: BoundingBox,
  detectionId: string,
  config: Partial<CropConfig> = {}
): Promise<CropResult> {
  const cfg = { ...DEFAULT_CROP_CONFIG, ...config };

  // Reuse Sharp instance for metadata and extraction
  const sharpInstance = sharp(originalPath);
  const metadata = await sharpInstance.metadata();
  const imageWidth = metadata.width!;
  const imageHeight = metadata.height!;

  // Calculate pixel region with padding
  const { x, y, width, height, paddedBbox, edgeFlags } = calculatePixelRegion(
    bbox,
    imageWidth,
    imageHeight,
    cfg
  );

  // Check minimum size
  if (width < cfg.minDimension || height < cfg.minDimension) {
    log.warn(`Crop too small: ${width}x${height}px for detection ${detectionId}`);
  }

  // Calculate output dimensions respecting maxDimension
  let outputWidth = width;
  let outputHeight = height;

  if (width > cfg.maxDimension || height > cfg.maxDimension) {
    const scale = Math.min(cfg.maxDimension / width, cfg.maxDimension / height);
    outputWidth = Math.round(width * scale);
    outputHeight = Math.round(height * scale);
  }

  // Extract and compress (disable mozjpeg for speed - crops sent to AI, not displayed)
  const buffer = await sharp(originalPath)
    .extract({ left: x, top: y, width, height })
    .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: false })
    .toBuffer();

  return {
    buffer,
    detectionId,
    originalBbox: bbox,
    paddedBbox,
    resolution: { width: outputWidth, height: outputHeight },
    sizeBytes: buffer.length,
    edgeFlags,
  };
}

/**
 * Extract multiple crops from the SAME original image efficiently
 * Reads original once, extracts multiple regions
 */
export async function extractCropsFromOriginal(
  originalPath: string,
  bboxes: Array<BoundingBox & { detectionId?: string }>,
  config: Partial<CropConfig> = {},
  maxCrops: number = 5
): Promise<CropResult[]> {
  if (bboxes.length === 0) {
    return [];
  }

  const cfg = { ...DEFAULT_CROP_CONFIG, ...config };
  const startTime = Date.now();

  // Limit number of crops
  const limitedBboxes = bboxes.slice(0, maxCrops);
  if (bboxes.length > maxCrops) {
    log.warn(`Limited crops from ${bboxes.length} to ${maxCrops}`);
  }

  // For single bbox, use simple path
  if (limitedBboxes.length === 1) {
    const result = await extractSingleCrop(
      originalPath,
      limitedBboxes[0],
      limitedBboxes[0].detectionId || 'det_0',
      config
    );
    log.info(`Single crop extracted in ${Date.now() - startTime}ms, size: ${(result.sizeBytes / 1024).toFixed(1)}KB`);
    return [result];
  }

  // For multiple bboxes: read original into memory once and get metadata in parallel
  const sharpInstance = sharp(originalPath);
  const [metadata, originalBuffer] = await Promise.all([
    sharpInstance.metadata(),
    sharpInstance.clone().toBuffer()
  ]);
  const imageWidth = metadata.width!;
  const imageHeight = metadata.height!;

  // Process all bboxes in parallel
  const results = await Promise.all(
    limitedBboxes.map(async (bbox, idx) => {
      try {
        const detectionId = bbox.detectionId || `det_${idx}`;
        const { x, y, width, height, paddedBbox, edgeFlags } = calculatePixelRegion(
          bbox,
          imageWidth,
          imageHeight,
          cfg
        );

        // Skip tiny crops
        if (width < cfg.minDimension / 2 || height < cfg.minDimension / 2) {
          log.warn(`Skipping very small crop: ${width}x${height}px for ${detectionId}`);
          return null;
        }

        // Calculate output dimensions
        let outputWidth = width;
        let outputHeight = height;
        if (width > cfg.maxDimension || height > cfg.maxDimension) {
          const scale = Math.min(cfg.maxDimension / width, cfg.maxDimension / height);
          outputWidth = Math.round(width * scale);
          outputHeight = Math.round(height * scale);
        }

        // Extract from in-memory buffer (disable mozjpeg for speed)
        const buffer = await sharp(originalBuffer)
          .extract({ left: x, top: y, width, height })
          .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: false })
          .toBuffer();

        return {
          buffer,
          detectionId,
          originalBbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
          paddedBbox,
          resolution: { width: outputWidth, height: outputHeight },
          sizeBytes: buffer.length,
          edgeFlags,
        } as CropResult;
      } catch (error) {
        log.error(`Failed to extract crop ${idx}:`, error);
        return null;
      }
    })
  );

  const validResults = results.filter((r): r is CropResult => r !== null);
  const totalSize = validResults.reduce((sum, r) => sum + r.sizeBytes, 0);
  log.info(`Extracted ${validResults.length} crops in ${Date.now() - startTime}ms, total size: ${(totalSize / 1024).toFixed(1)}KB`);

  return validResults;
}

/**
 * Generate a "negative" context image with subject regions masked in black
 */
export async function generateNegativeWithMask(
  imageBuffer: Buffer,
  bboxes: BoundingBox[],
  config: Partial<NegativeConfig> = {}
): Promise<NegativeResult> {
  const cfg = { ...DEFAULT_NEGATIVE_CONFIG, ...config };
  const startTime = Date.now();

  if (bboxes.length === 0) {
    // No subjects to mask, return resized original
    const metadata = await sharp(imageBuffer).metadata();
    const resized = await sharp(imageBuffer)
      .resize(cfg.maxDimension, cfg.maxDimension, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: cfg.jpegQuality })
      .toBuffer();

    return {
      buffer: resized,
      maskedRegions: [],
      resolution: { width: metadata.width || 0, height: metadata.height || 0 },
      sizeBytes: resized.length,
    };
  }

  // Parse mask color
  const maskColorHex = cfg.maskColor.replace('#', '');
  const r = parseInt(maskColorHex.substring(0, 2), 16);
  const g = parseInt(maskColorHex.substring(2, 4), 16);
  const b = parseInt(maskColorHex.substring(4, 6), 16);

  // IMPORTANT: Sharp internally reorders the pipeline and applies resize BEFORE
  // composite, so building an SVG at the original size and chaining .resize()
  // after .composite() fails with "Image to composite must have same dimensions
  // or smaller" whenever the original exceeds cfg.maxDimension.
  //
  // Fix: resize first, then build the SVG at the final canvas dimensions (bboxes
  // are normalized 0..1, so coordinates map cleanly), then composite.
  let resizedBuffer: Buffer;
  let finalWidth: number;
  let finalHeight: number;
  try {
    resizedBuffer = await sharp(imageBuffer)
      .resize(cfg.maxDimension, cfg.maxDimension, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const resizedMeta = await sharp(resizedBuffer).metadata();
    finalWidth = resizedMeta.width!;
    finalHeight = resizedMeta.height!;
  } catch (err) {
    log.error(`generateNegativeWithMask: pre-composite resize failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  // Create SVG with mask rectangles sized to the FINAL canvas
  const rectsSvg = bboxes.map(bbox => {
    const x = Math.round(bbox.x * finalWidth);
    const y = Math.round(bbox.y * finalHeight);
    const w = Math.round(bbox.width * finalWidth);
    const h = Math.round(bbox.height * finalHeight);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${r},${g},${b})"/>`;
  }).join('');

  const svgMask = Buffer.from(
    `<svg width="${finalWidth}" height="${finalHeight}" xmlns="http://www.w3.org/2000/svg">${rectsSvg}</svg>`
  );

  // Composite mask over the already-resized canvas (dimensions now match)
  let masked: Buffer;
  try {
    masked = await sharp(resizedBuffer)
      .composite([{ input: svgMask, top: 0, left: 0, blend: 'over' }])
      .jpeg({ quality: cfg.jpegQuality })
      .toBuffer();
  } catch (err) {
    log.error(`generateNegativeWithMask: composite failed (canvas ${finalWidth}x${finalHeight}, ${bboxes.length} bboxes): ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  log.info(`Negative generated in ${Date.now() - startTime}ms, masked ${bboxes.length} regions, size: ${(masked.length / 1024).toFixed(1)}KB`);

  return {
    buffer: masked,
    maskedRegions: bboxes,
    resolution: { width: finalWidth, height: finalHeight },
    sizeBytes: masked.length,
  };
}

/**
 * Extract crops from original AND generate negative from compressed in one operation
 * This is the main function to call for the crop+context strategy
 */
export async function extractCropContext(
  originalPath: string,
  compressedBuffer: Buffer,
  bboxes: Array<BoundingBox & { detectionId?: string }>,
  cropConfig?: Partial<CropConfig>,
  negativeConfig?: Partial<NegativeConfig>,
  maxCrops: number = 5
): Promise<CropContextResult> {
  const startTime = Date.now();

  // Get original dimensions
  const originalMetadata = await sharp(originalPath).metadata();
  const originalDimensions = {
    width: originalMetadata.width || 0,
    height: originalMetadata.height || 0,
  };

  // Handle no detections case
  if (bboxes.length === 0) {
    log.warn('No bounding boxes provided, returning empty result');
    return {
      crops: [],
      negative: null,
      originalDimensions,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Extract crops from ORIGINAL (high-res)
  const crops = await extractCropsFromOriginal(originalPath, bboxes, cropConfig, maxCrops);

  // Generate negative from COMPRESSED (lower res, context only) - only if enabled
  const negCfg = { ...DEFAULT_NEGATIVE_CONFIG, ...negativeConfig };
  let negative: NegativeResult | null = null;

  if (negCfg.enabled !== false) {
    negative = await generateNegativeWithMask(compressedBuffer, bboxes, negativeConfig);
    log.info(`CropContext complete: ${crops.length} crops + 1 negative in ${Date.now() - startTime}ms`);
  } else {
    log.info(`CropContext complete: ${crops.length} crops (negative disabled) in ${Date.now() - startTime}ms`);
  }

  const processingTimeMs = Date.now() - startTime;

  return {
    crops,
    negative,
    originalDimensions,
    processingTimeMs,
  };
}

/**
 * Utility: Convert crops to base64 for API transmission
 */
export function cropsToBase64(crops: CropResult[]): Array<{ imageData: string; detectionId: string; isPartial: boolean }> {
  return crops.map(crop => ({
    imageData: crop.buffer.toString('base64'),
    detectionId: crop.detectionId,
    isPartial: crop.edgeFlags.isPartial,
  }));
}

/**
 * Utility: Convert negative to base64 for API transmission
 */
export function negativeToBase64(negative: NegativeResult): { imageData: string; maskedRegions: BoundingBox[] } {
  return {
    imageData: negative.buffer.toString('base64'),
    maskedRegions: negative.maskedRegions,
  };
}

// ============================================================================
// SEGMENTATION MASK SUPPORT
// ============================================================================

/**
 * Segmentation mask data from YOLOv8-seg or similar model
 */
export interface SegmentationMask {
  data: Uint8Array;       // Binary mask (0 or 255)
  width: number;          // Mask width (matches original image)
  height: number;         // Mask height (matches original image)
}

// Re-export MaskCropConfig from config.ts for backward compatibility
export { MaskCropConfig } from '../config';
export { SegmentationMaskData } from './mask-rle';

/**
 * Default mask crop configuration (re-exported from config.ts)
 */
export const DEFAULT_MASK_CROP_CONFIG = CONFIG_DEFAULT_MASK_CROP_CONFIG;

/**
 * Extended crop result with mask information
 */
export interface MaskedCropResult extends CropResult {
  maskApplied: boolean;
  maskedSubjectsCount: number;
  // Raw mask data for visualization (optional, enabled via save_segmentation_masks flag)
  segmentationMask?: {
    mask: SegmentationMask;      // Full resolution mask
    cocoClass: string;           // 'car', 'motorcycle', 'person'
    cocoClassId: number;         // COCO class ID
    confidence: number;          // Detection confidence
  };
}

/**
 * Detection with segmentation mask
 */
export interface SegmentedDetection {
  bbox: BoundingBox;
  mask: SegmentationMask;
  confidence: number;
  classId: number;
  className: string;
  detectionId: string;
}

// ==================== SHARPNESS ANALYSIS ====================

/**
 * Configuration for sharpness-based subject filtering
 */
export interface SharpnessFilterConfig {
  enabled: boolean;
  /** Minimum ratio between best and worst sharpness to trigger filtering (e.g., 1.8 = best must be 1.8x sharper) */
  dominanceRatio: number;
  /** If true, log sharpness scores for debugging */
  debug: boolean;
}

export const DEFAULT_SHARPNESS_FILTER_CONFIG: SharpnessFilterConfig = {
  enabled: false,
  dominanceRatio: 1.8,
  debug: true,
};

/**
 * Sharpness score result for a single crop
 *
 * Uses Gradient Decay Ratio: content-independent metric that measures
 * how much edge energy is lost when a known Gaussian blur is applied.
 * Sharp images lose more (high score), blurry images lose little (low score).
 */
export interface SharpnessScore {
  detectionId: string;
  /**
   * Gradient Decay Ratio (0-100 scale).
   * Named 'laplacianVariance' for backward compatibility with existing
   * JSONL logs and management portal modal.
   */
  laplacianVariance: number;
  /** Normalized score 0-1 relative to other crops in the same image */
  normalizedScore: number;
  /** Edge-only gradient ratio (0-100). Content-independent sharpness. */
  edgeOnlyDecay?: number;
  /** Bbox area (0-1 normalized to largest in image). */
  bboxArea?: number;
  /** ONNX detection confidence (0-1). */
  onnxConfidence?: number;
  /**
   * Composite Subject Score (0-100).
   * Weighted combination: 40% edgeOnly + 25% bboxArea + 20% onnxConf + 15% globalDecay
   * Higher = more likely primary subject. Ratio-based filtering on this score.
   */
  compositeScore?: number;
}

/**
 * Calculate sharpness score using the GRADIENT DECAY RATIO method.
 *
 * The previous Laplacian Variance approach measured edge/texture DENSITY,
 * not optical sharpness. A smooth car body in perfect focus could score
 * lower than a textured background car slightly out of focus.
 *
 * The Gradient Decay Ratio is CONTENT-INDEPENDENT:
 * 1. Compute Laplacian variance of the ORIGINAL crop (edge energy)
 * 2. Apply a known Gaussian blur to the crop
 * 3. Compute Laplacian variance of the BLURRED version
 * 4. Score = 1 - (blurred_variance / original_variance)
 *
 * Why this works: A SHARP image has well-defined edges that degrade
 * significantly when blurred → high decay ratio (0.7-0.9).
 * A BLURRY image already lacks high-frequency content, so additional
 * blur barely changes it → low decay ratio (0.1-0.4).
 *
 * The division normalizes out absolute edge density — the score depends
 * only on how "crisp" the edges are, not how many there are.
 *
 * Reference: arxiv.org/abs/2410.10488 (Normalized Gradient Decay metric)
 *
 * Pipeline: crop → center 60% ROI → resize to 512px → grayscale →
 *           {Laplacian variance of original} vs {Laplacian variance of blurred}
 *
 * Typically ~5-12ms per crop (two Laplacian passes).
 */
const SHARPNESS_ANALYSIS_SIZE = 512;  // Fixed size for fair comparison
const SHARPNESS_CENTER_RATIO = 0.6;   // Use center 60% of the crop
const DECAY_BLUR_SIGMA = 2.0;         // Gaussian blur sigma for decay measurement

// Temporary cache to pass edgeOnly scores from calculateSharpnessScore to filterCropsBySharpness
// WeakMap keyed by crop buffer — auto-cleaned when buffer is GC'd
const lastEdgeOnlyScores = new WeakMap<Buffer, number>();

/**
 * Compute Laplacian variance directly from raw pixel buffer.
 *
 * WHY NOT Sharp's .convolve().stats()?
 * Sharp operates on uint8 (0-255) images. The Laplacian kernel [0,1,0,-4,1,0,1,0]
 * produces values from -1020 to +1020. Even with offset=128, extreme values get
 * clamped to [0, 255], DESTROYING the variance calculation. This caused negative
 * decay ratios (blurred variance > original) and incorrect filtering.
 *
 * This function computes the Laplacian using int32 arithmetic — no clamping possible.
 * For a 512x512 image, this is ~260K iterations (~2-4ms on Apple M1).
 *
 * @param pixels Raw grayscale pixel buffer (1 byte per pixel)
 * @param width Image width
 * @param height Image height
 * @returns Laplacian variance (higher = more edges = sharper)
 */
function computeLaplacianVariance(pixels: Buffer, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // Apply Laplacian kernel [0,1,0,1,-4,1,0,1,0] — skip 1px border
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // Laplacian = top + left + right + bottom - 4*center
      const lap = pixels[idx - width]       // top
               + pixels[idx - 1]            // left
               + pixels[idx + 1]            // right
               + pixels[idx + width]        // bottom
               - 4 * pixels[idx];           // center (int32, no clamping)

      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  // Variance = E[X²] - E[X]²
  const mean = sum / count;
  return (sumSq / count) - (mean * mean);
}

/**
 * Compute gradient magnitude for each pixel using Sobel operator.
 * Returns a Float64 array of gradient magnitudes: sqrt(Gx² + Gy²)
 */
function computeGradientMagnitude(pixels: Buffer, width: number, height: number): Float64Array {
  const grad = new Float64Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // Sobel X: [-1,0,1; -2,0,2; -1,0,1]
      const gx = -pixels[idx - width - 1] + pixels[idx - width + 1]
               - 2 * pixels[idx - 1]       + 2 * pixels[idx + 1]
               - pixels[idx + width - 1]   + pixels[idx + width + 1];
      // Sobel Y: [-1,-2,-1; 0,0,0; 1,2,1]
      const gy = -pixels[idx - width - 1] - 2 * pixels[idx - width] - pixels[idx - width + 1]
               + pixels[idx + width - 1]  + 2 * pixels[idx + width]  + pixels[idx + width + 1];

      grad[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return grad;
}

/**
 * Edge-only gradient ratio: simplified Zhuo-Sim defocus estimator.
 *
 * Instead of computing decay globally (which dilutes the signal on smooth surfaces),
 * this method:
 * 1. Computes Sobel gradient magnitude for original and blurred images
 * 2. Identifies "edge pixels" (top percentile of gradient magnitude)
 * 3. Computes the gradient ratio (blurred/original) ONLY at those edge locations
 * 4. Returns median ratio inverted as a score: lower ratio = sharper = higher score
 *
 * This is content-independent: a smooth car body has fewer edges, but each
 * measurable edge reflects the TRUE optical blur. A textured but blurry car
 * will have wide edges (high ratio) regardless of how many edges it has.
 *
 * ~5-8ms per crop on Apple M1 for 512x512.
 */
function computeEdgeOnlyGradientRatio(
  originalPixels: Buffer,
  blurredPixels: Buffer,
  width: number,
  height: number
): number {
  const gradOrig = computeGradientMagnitude(originalPixels, width, height);
  const gradBlur = computeGradientMagnitude(blurredPixels, width, height);

  // Find edge threshold: top 15% of gradient values
  // Using a quick partial sort approach for performance
  const nonZeroGrads: number[] = [];
  for (let i = 0; i < gradOrig.length; i++) {
    if (gradOrig[i] > 5) nonZeroGrads.push(gradOrig[i]); // Skip near-zero (flat areas)
  }
  if (nonZeroGrads.length < 20) return 0; // Not enough edges

  nonZeroGrads.sort((a, b) => b - a);
  const edgeThreshold = nonZeroGrads[Math.floor(nonZeroGrads.length * 0.15)] || 10;

  // Collect gradient ratios at edge locations
  const ratios: number[] = [];
  for (let i = 0; i < gradOrig.length; i++) {
    if (gradOrig[i] >= edgeThreshold) {
      const ratio = gradBlur[i] / (gradOrig[i] + 1e-6);
      ratios.push(ratio);
    }
  }

  if (ratios.length < 10) return 0;

  // Median of ratios (sort and take middle)
  ratios.sort((a, b) => a - b);
  const medianRatio = ratios[Math.floor(ratios.length / 2)];

  // Invert and scale: ratio close to 0 = very sharp, ratio close to 1 = very blurry
  // Score = (1 - medianRatio) * 100 → higher = sharper
  return (1 - medianRatio) * 100;
}

export async function calculateSharpnessScore(cropBuffer: Buffer): Promise<number> {
  try {
    // Get crop dimensions
    const metadata = await sharp(cropBuffer).metadata();
    const w = metadata.width || 512;
    const h = metadata.height || 512;

    // Calculate center ROI (60% of the crop)
    const roiW = Math.round(w * SHARPNESS_CENTER_RATIO);
    const roiH = Math.round(h * SHARPNESS_CENTER_RATIO);
    const roiX = Math.round((w - roiW) / 2);
    const roiY = Math.round((h - roiH) / 2);

    const extractOpts = { left: roiX, top: roiY, width: roiW, height: roiH };
    const SIZE = SHARPNESS_ANALYSIS_SIZE;

    // Get raw grayscale pixels of the ORIGINAL crop
    const originalRaw = await sharp(cropBuffer)
      .extract(extractOpts)
      .resize(SIZE, SIZE, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    // Get raw grayscale pixels of the BLURRED crop
    const blurredRaw = await sharp(cropBuffer)
      .extract(extractOpts)
      .resize(SIZE, SIZE, { fit: 'fill' })
      .grayscale()
      .blur(DECAY_BLUR_SIGMA)
      .raw()
      .toBuffer();

    // Compute Laplacian variance in JavaScript (int32, NO uint8 clamping!)
    const originalVariance = computeLaplacianVariance(originalRaw, SIZE, SIZE);
    const blurredVariance = computeLaplacianVariance(blurredRaw, SIZE, SIZE);

    // Guard: essentially flat crop (no edges at all)
    if (originalVariance < 1) {
      log.debug(`Sharpness: originalVariance=${originalVariance.toFixed(3)} < 1, returning 0 (flat crop)`);
      return 0;
    }

    // Gradient Decay Ratio: how much edge energy is lost by blurring
    // Sharp image: high decay (0.5-0.8) → edges are crisp, blur destroys them
    // Blurry image: low decay (0.05-0.3) → edges already spread, blur changes little
    const decayRatio = 1 - (blurredVariance / originalVariance);
    const globalDecay = decayRatio * 100;

    // EXPERIMENTAL: Edge-only gradient ratio (Zhuo-Sim simplified)
    const edgeOnlyDecay = computeEdgeOnlyGradientRatio(originalRaw, blurredRaw, SIZE, SIZE);

    log.debug(`Sharpness: globalDecay=${globalDecay.toFixed(1)}%, edgeOnly=${edgeOnlyDecay.toFixed(1)}% (origVar=${originalVariance.toFixed(1)}, blurVar=${blurredVariance.toFixed(1)})`);

    // Return global decay as the active score (edgeOnly is logged for comparison)
    // Store edgeOnlyDecay in a module-level cache so filterCropsBySharpness can include it
    lastEdgeOnlyScores.set(cropBuffer, edgeOnlyDecay);

    return globalDecay;
  } catch (error: any) {
    log.warn(`Sharpness calculation failed, returning 0. Error: ${error?.message || error}`, error?.stack ? `\nStack: ${error.stack}` : '');
    return 0;
  }
}

/**
 * Filter crops by sharpness when multiple subjects are detected.
 *
 * IMPORTANT: This filter only activates when there are 2+ crops.
 * With a single crop, it returns it unchanged.
 *
 * Logic:
 * 1. Calculate sharpness score for each crop
 * 2. Find the sharpest crop (likely the in-focus subject)
 * 3. If the sharpness ratio between best and others exceeds dominanceRatio,
 *    filter out the blurry ones (they're background/bokeh subjects)
 * 4. If all crops have similar sharpness, keep them all (no dominant subject)
 *
 * Returns: filtered array of crops + sharpness metadata for logging
 */
export async function filterCropsBySharpness<T extends CropResult>(
  crops: T[],
  config: SharpnessFilterConfig = DEFAULT_SHARPNESS_FILTER_CONFIG
): Promise<{
  filteredCrops: T[];
  sharpnessScores: SharpnessScore[];
  filtered: boolean;
  reason: string;
}> {
  // Bypass: single crop or disabled
  if (!config.enabled || crops.length <= 1) {
    return {
      filteredCrops: crops,
      sharpnessScores: [],
      filtered: false,
      reason: crops.length <= 1 ? 'single_subject' : 'disabled',
    };
  }

  // Calculate sharpness for all crops in parallel
  const startTime = Date.now();
  const rawScores = await Promise.all(
    crops.map(async (crop) => {
      const globalDecay = await calculateSharpnessScore(crop.buffer);
      const edgeOnly = lastEdgeOnlyScores.get(crop.buffer) ?? undefined;
      // Extract ONNX confidence from MaskedCropResult if available
      const onnxConf = (crop as any).segmentationMask?.confidence as number | undefined;
      // Bbox area (normalized 0-1 product of width*height)
      const bboxArea = crop.originalBbox.width * crop.originalBbox.height;
      return {
        detectionId: crop.detectionId,
        laplacianVariance: globalDecay,
        normalizedScore: 0,  // Filled below
        edgeOnlyDecay: edgeOnly,
        bboxArea,
        onnxConfidence: onnxConf,
      };
    })
  );

  // ── Compute Composite Subject Score ──
  // Normalize each signal to 0-1 within this image, then weighted average.
  // This makes the composite purely relative — works for both "single dominant subject"
  // and "starting grid with many equal cars" scenarios.
  const maxEdge = Math.max(...rawScores.map(s => s.edgeOnlyDecay ?? 0), 1);
  const maxArea = Math.max(...rawScores.map(s => s.bboxArea), 0.001);
  const maxGlobal = Math.max(...rawScores.map(s => s.laplacianVariance), 1);

  // Check if ONNX confidence is available for ANY crop
  const hasOnnx = rawScores.some(s => typeof s.onnxConfidence === 'number');
  const maxOnnx = hasOnnx ? Math.max(...rawScores.map(s => s.onnxConfidence ?? 0), 0.01) : 1;

  // Weights — dynamically adjusted when ONNX is not available
  // With ONNX:    40% edge + 25% area + 20% onnx + 15% global = 100%
  // Without ONNX: 50% edge + 30% area + 20% global = 100%
  const W_EDGE   = hasOnnx ? 0.40 : 0.50;
  const W_AREA   = hasOnnx ? 0.25 : 0.30;
  const W_ONNX   = hasOnnx ? 0.20 : 0.00;
  const W_GLOBAL = hasOnnx ? 0.15 : 0.20;

  const sharpnessScores: SharpnessScore[] = rawScores.map(s => {
    const normEdge = (s.edgeOnlyDecay ?? 0) / maxEdge;
    const normArea = s.bboxArea / maxArea;
    const normOnnx = hasOnnx ? (s.onnxConfidence ?? 0) / maxOnnx : 0;
    const normGlobal = s.laplacianVariance / maxGlobal;

    const composite = (W_EDGE * normEdge + W_AREA * normArea + W_ONNX * normOnnx + W_GLOBAL * normGlobal) * 100;

    return {
      ...s,
      compositeScore: composite,
      normalizedScore: 0, // Filled below after we know the max composite
    };
  });

  // Normalize scores relative to the best composite
  const maxComposite = Math.max(...sharpnessScores.map(s => s.compositeScore ?? 0), 1);
  for (const s of sharpnessScores) {
    s.normalizedScore = (s.compositeScore ?? 0) / maxComposite;
    // Keep laplacianVariance as composite for the ratio-based filter logic
    // (backward compat: the ratio filter reads laplacianVariance)
    s.laplacianVariance = s.compositeScore ?? 0;
  }

  // Sort by composite score
  const sortedBySharpness = [...sharpnessScores].sort(
    (a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0)
  );

  const bestScore = sortedBySharpness[0];
  const elapsedMs = Date.now() - startTime;

  if (config.debug) {
    log.info(`[Sharpness] Composite scores (${elapsedMs}ms): ${
      sharpnessScores.map(s =>
        `${s.detectionId}: composite=${s.compositeScore?.toFixed(1)} (edge=${s.edgeOnlyDecay?.toFixed(1)}% area=${((s.bboxArea ?? 0) * 100).toFixed(0)}% onnx=${((s.onnxConfidence ?? 0) * 100).toFixed(0)}% global=${s.laplacianVariance.toFixed(1)})`
      ).join(', ')
    }`);
  }

  // Filter using composite score ratios
  const cropsToKeep: T[] = [];
  const cropsFiltered: string[] = [];

  for (let i = 0; i < crops.length; i++) {
    const score = sharpnessScores.find(s => s.detectionId === crops[i].detectionId);
    if (!score) {
      cropsToKeep.push(crops[i]);
      continue;
    }

    const ratio = (bestScore.compositeScore ?? 1) / Math.max(score.compositeScore ?? 0, 0.001);

    if (ratio >= config.dominanceRatio && score.detectionId !== bestScore.detectionId) {
      cropsFiltered.push(`${score.detectionId} (ratio: ${ratio.toFixed(1)}x)`);
    } else {
      cropsToKeep.push(crops[i]);
    }
  }

  if (cropsFiltered.length > 0) {
    log.info(`[Sharpness] Filtered ${cropsFiltered.length} blurry crop(s): ${cropsFiltered.join(', ')}. Keeping ${cropsToKeep.length} sharp crop(s).`);
    return {
      filteredCrops: cropsToKeep,
      sharpnessScores,
      filtered: true,
      reason: `sharpness_dominance (${cropsFiltered.length} blurry removed)`,
    };
  }

  if (config.debug) {
    log.info(`[Sharpness] All ${crops.length} crops have similar sharpness — keeping all.`);
  }

  return {
    filteredCrops: crops,
    sharpnessScores,
    filtered: false,
    reason: 'similar_sharpness',
  };
}

/**
 * Check if two bounding boxes overlap
 */
function bboxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  const aX2 = a.x + a.width;
  const aY2 = a.y + a.height;
  const bX2 = b.x + b.width;
  const bY2 = b.y + b.height;

  return !(aX2 < b.x || a.x > bX2 || aY2 < b.y || a.y > bY2);
}

/**
 * Extract crop region from a segmentation mask
 */
function extractMaskRegion(
  mask: SegmentationMask,
  cropRegion: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): Buffer {
  // Calculate pixel bounds
  const px1 = Math.floor(cropRegion.x);
  const py1 = Math.floor(cropRegion.y);
  const pw = Math.floor(cropRegion.width);
  const ph = Math.floor(cropRegion.height);

  // Create cropped mask buffer
  const croppedMask = new Uint8Array(pw * ph);

  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const srcX = px1 + x;
      const srcY = py1 + y;

      if (srcX >= 0 && srcX < mask.width && srcY >= 0 && srcY < mask.height) {
        const srcIdx = srcY * mask.width + srcX;
        const dstIdx = y * pw + x;
        croppedMask[dstIdx] = mask.data[srcIdx];
      }
    }
  }

  return Buffer.from(croppedMask);
}

/**
 * Apply segmentation mask to isolate subject in crop
 * Other subjects in the crop area are masked (black or blurred)
 * OPTIMIZED: Uses Sharp native operations instead of pixel-by-pixel loops
 */
export async function applyMaskToCrop(
  cropBuffer: Buffer,
  subjectMask: SegmentationMask,
  otherMasks: SegmentationMask[],
  cropRegion: { x: number; y: number; width: number; height: number },
  originalDimensions: { width: number; height: number },
  config: MaskCropConfig = DEFAULT_MASK_CROP_CONFIG
): Promise<{ buffer: Buffer; maskedCount: number }> {
  if (!config.enabled || otherMasks.length === 0) {
    return { buffer: cropBuffer, maskedCount: 0 };
  }

  const startTime = Date.now();
  const { width: imageWidth, height: imageHeight } = originalDimensions;
  const cropWidth = Math.floor(cropRegion.width);
  const cropHeight = Math.floor(cropRegion.height);

  // Get crop dimensions
  const cropMetadata = await sharp(cropBuffer).metadata();
  const actualCropWidth = cropMetadata.width!;
  const actualCropHeight = cropMetadata.height!;

  // OPTIMIZATION: Use simple bbox rectangles instead of pixel-perfect masks
  // This is 100x faster and visually indistinguishable for most use cases
  const maskRects: string[] = [];

  for (const otherMask of otherMasks) {
    // Calculate bbox of the other mask in crop coordinates
    // We only mask if it significantly overlaps with the crop region

    // Find mask bounds in original image coordinates (fast scan)
    let minX = otherMask.width, maxX = 0, minY = otherMask.height, maxY = 0;
    let hasPixels = false;

    // PERFORMANCE: Downsample mask for faster bbox calculation (sample every 8 pixels = 4x faster)
    const sampleRate = 8; // Increased from 4 to 8 for 4x speedup
    for (let y = 0; y < otherMask.height; y += sampleRate) {
      for (let x = 0; x < otherMask.width; x += sampleRate) {
        const idx = y * otherMask.width + x;
        if (otherMask.data[idx] > 128) {
          hasPixels = true;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!hasPixels) continue;

    // Convert to crop coordinates
    const cropX1 = cropRegion.x;
    const cropY1 = cropRegion.y;
    const cropX2 = cropRegion.x + cropRegion.width;
    const cropY2 = cropRegion.y + cropRegion.height;

    // Check if mask overlaps with crop
    if (maxX < cropX1 || minX > cropX2 || maxY < cropY1 || minY > cropY2) {
      continue; // No overlap
    }

    // Calculate intersection in crop space
    const intersectX1 = Math.max(minX, cropX1) - cropX1;
    const intersectY1 = Math.max(minY, cropY1) - cropY1;
    const intersectX2 = Math.min(maxX, cropX2) - cropX1;
    const intersectY2 = Math.min(maxY, cropY2) - cropY1;

    // Scale to actual crop dimensions
    const scaleX = actualCropWidth / cropWidth;
    const scaleY = actualCropHeight / cropHeight;

    const rectX = Math.floor(intersectX1 * scaleX);
    const rectY = Math.floor(intersectY1 * scaleY);
    const rectW = Math.ceil((intersectX2 - intersectX1) * scaleX);
    const rectH = Math.ceil((intersectY2 - intersectY1) * scaleY);

    if (rectW > 0 && rectH > 0) {
      maskRects.push(`<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" fill="black"/>`);
    }
  }

  if (maskRects.length === 0) {
    return { buffer: cropBuffer, maskedCount: 0 };
  }

  // Create SVG mask (much faster than pixel loops)
  const svgMask = Buffer.from(
    `<svg width="${actualCropWidth}" height="${actualCropHeight}" xmlns="http://www.w3.org/2000/svg">${maskRects.join('')}</svg>`
  );

  // Apply mask based on mode
  let result: Buffer;

  if (config.backgroundMode === 'blur') {
    // Create blurred version
    const blurred = await sharp(cropBuffer)
      .blur(config.blurRadius)
      .toBuffer();

    // Composite: original where subject, blurred where others
    result = await sharp(cropBuffer)
      .composite([
        { input: blurred, blend: 'dest-over' },
        { input: svgMask, blend: 'dest-out' },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  } else {
    // Black masking (fastest path)
    result = await sharp(cropBuffer)
      .composite([
        { input: svgMask, blend: 'over' },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const elapsed = Date.now() - startTime;
  if (elapsed > 100) {
    log.info(`Applied mask to crop in ${elapsed}ms, masked ${otherMasks.length} overlapping subjects`);
  }

  return { buffer: result, maskedCount: otherMasks.length };
}

/**
 * Options for mask extraction
 */
export interface ExtractMaskOptions {
  /** Save raw mask data in results for visualization (increases memory usage) */
  includeRawMaskData?: boolean;
}

/**
 * Extract crops with segmentation masks applied
 * Main function for mask-based crop extraction
 */
export async function extractCropsWithMasks(
  originalPath: string,
  detections: SegmentedDetection[],
  cropConfig: Partial<CropConfig> = {},
  maskConfig: Partial<MaskCropConfig> = {},
  maxCrops: number = 5,
  options: ExtractMaskOptions = {}
): Promise<{
  crops: MaskedCropResult[];
  originalDimensions: { width: number; height: number };
  processingTimeMs: number;
}> {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_CROP_CONFIG, ...cropConfig };
  const maskCfg = { ...DEFAULT_MASK_CROP_CONFIG, ...maskConfig };

  // Load original image and metadata in parallel
  const sharpInstance = sharp(originalPath);
  const [originalMetadata, originalBuffer] = await Promise.all([
    sharpInstance.metadata(),
    sharpInstance.clone().toBuffer()
  ]);

  const originalDimensions = {
    width: originalMetadata.width || 0,
    height: originalMetadata.height || 0,
  };

  if (detections.length === 0) {
    log.warn('No detections provided for masked crop extraction');
    return {
      crops: [],
      originalDimensions,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Limit detections
  const limitedDetections = detections.slice(0, maxCrops);
  if (detections.length > maxCrops) {
    log.warn(`Limited detections from ${detections.length} to ${maxCrops}`);
  }

  const imageWidth = originalDimensions.width;
  const imageHeight = originalDimensions.height;

  // PERFORMANCE: Process crops with controlled concurrency to avoid CPU overload
  const MAX_CONCURRENT_CROPS = 3;
  const crops: MaskedCropResult[] = [];

  // Process in batches of MAX_CONCURRENT_CROPS
  for (let i = 0; i < limitedDetections.length; i += MAX_CONCURRENT_CROPS) {
    const batch = limitedDetections.slice(i, i + MAX_CONCURRENT_CROPS);
    const batchResults = await Promise.all(
      batch.map(async (detection, batchIdx) => {
        const idx = i + batchIdx;
    try {
      // Calculate pixel region with padding
      const { x, y, width, height, paddedBbox, edgeFlags } = calculatePixelRegion(
        detection.bbox,
        imageWidth,
        imageHeight,
        cfg
      );

      // Skip tiny crops
      if (width < cfg.minDimension / 2 || height < cfg.minDimension / 2) {
        log.warn(`Skipping small crop: ${width}x${height}px for ${detection.detectionId}`);
        return null;
      }

      // Calculate output dimensions
      let outputWidth = width;
      let outputHeight = height;
      if (width > cfg.maxDimension || height > cfg.maxDimension) {
        const scale = Math.min(cfg.maxDimension / width, cfg.maxDimension / height);
        outputWidth = Math.round(width * scale);
        outputHeight = Math.round(height * scale);
      }

      // Extract basic crop (disable mozjpeg for speed)
      let cropBuffer = await sharp(originalBuffer)
        .extract({ left: x, top: y, width, height })
        .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: false })
        .toBuffer();

      // Find overlapping detections
      let maskedCount = 0;

      if (maskCfg.enabled && maskCfg.maskOtherSubjects) {
        const overlappingDetections = limitedDetections.filter((d, j) =>
          j !== idx && bboxesOverlap(paddedBbox, d.bbox)
        );

        if (overlappingDetections.length > 0) {
          const result = await applyMaskToCrop(
            cropBuffer,
            detection.mask,
            overlappingDetections.map(d => d.mask),
            { x, y, width, height },
            originalDimensions,
            maskCfg
          );

          cropBuffer = result.buffer;
          maskedCount = result.maskedCount;
        }
      }

      const cropResult: MaskedCropResult = {
        buffer: cropBuffer,
        detectionId: detection.detectionId,
        originalBbox: detection.bbox,
        paddedBbox,
        resolution: { width: outputWidth, height: outputHeight },
        sizeBytes: cropBuffer.length,
        edgeFlags,
        maskApplied: maskedCount > 0,
        maskedSubjectsCount: maskedCount,
      };

      // Include raw mask data if requested (for visualization/debugging)
      if (options.includeRawMaskData && detection.mask) {
        cropResult.segmentationMask = {
          mask: detection.mask,
          cocoClass: detection.className,
          cocoClassId: detection.classId,
          confidence: detection.confidence,
        };
      }

      return cropResult;
    } catch (error) {
      log.error(`Failed to extract masked crop for ${detection.detectionId}:`, error);
      return null;
    }
      })
    );

    // Accumulate results from this batch
    const validResults = batchResults.filter((c): c is MaskedCropResult => c !== null);
    crops.push(...validResults);
  }

  const processingTimeMs = Date.now() - startTime;
  const totalSize = crops.reduce((sum, c) => sum + c.sizeBytes, 0);
  const maskedCrops = crops.filter(c => c.maskApplied).length;

  log.info(
    `Extracted ${crops.length} crops with masks in ${processingTimeMs}ms, ` +
    `${maskedCrops} with overlaps masked, total size: ${(totalSize / 1024).toFixed(1)}KB`
  );

  return {
    crops,
    originalDimensions,
    processingTimeMs,
  };
}

/**
 * Result of maskedCropsToBase64 including optional RLE mask data
 */
export interface MaskedCropBase64Result {
  imageData: string;
  detectionId: string;
  isPartial: boolean;
  originalBbox: BoundingBox;
  maskApplied: boolean;
  /** RLE-encoded mask data for visualization (only present if includeRawMaskData was true) */
  maskData?: SegmentationMaskData;
}

/**
 * Utility: Convert masked crops to base64 for API transmission
 * Optionally includes RLE-encoded mask data for visualization
 */
export function maskedCropsToBase64(
  crops: MaskedCropResult[],
  options?: { includeRawMaskData?: boolean }
): MaskedCropBase64Result[] {
  return crops.map((crop, index) => {
    const result: MaskedCropBase64Result = {
      imageData: crop.buffer.toString('base64'),
      detectionId: crop.detectionId,
      isPartial: crop.edgeFlags.isPartial,
      originalBbox: crop.originalBbox,
      maskApplied: crop.maskApplied,
    };

    // Include RLE-encoded mask data if available and requested
    if (options?.includeRawMaskData && crop.segmentationMask) {
      const { mask, cocoClass, cocoClassId, confidence } = crop.segmentationMask;
      result.maskData = {
        vehicleIndex: index,
        cocoClass,
        cocoClassId,
        confidence,
        mask: {
          rle: encodeMaskToRLE(mask.data, mask.width, mask.height),
          width: mask.width,
          height: mask.height,
        },
        bbox: crop.originalBbox,
      };
    }

    return result;
  });
}
