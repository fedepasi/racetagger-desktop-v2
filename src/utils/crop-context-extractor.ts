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
  minDimension: 640,
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

  // Get image metadata without loading full image
  const metadata = await sharp(originalPath).metadata();
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

  // Extract and compress
  const buffer = await sharp(originalPath)
    .extract({ left: x, top: y, width, height })
    .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: cfg.jpegQuality, mozjpeg: true })
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

  // For multiple bboxes: read original into memory once
  const originalBuffer = await sharp(originalPath).toBuffer();
  const metadata = await sharp(originalBuffer).metadata();
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

        // Extract from in-memory buffer
        const buffer = await sharp(originalBuffer)
          .extract({ left: x, top: y, width, height })
          .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: cfg.jpegQuality, mozjpeg: true })
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

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width!;
  const imageHeight = metadata.height!;

  // Parse mask color
  const maskColorHex = cfg.maskColor.replace('#', '');
  const r = parseInt(maskColorHex.substring(0, 2), 16);
  const g = parseInt(maskColorHex.substring(2, 4), 16);
  const b = parseInt(maskColorHex.substring(4, 6), 16);

  // Create SVG with black rectangles for each bbox
  const rectsSvg = bboxes.map(bbox => {
    const x = Math.round(bbox.x * imageWidth);
    const y = Math.round(bbox.y * imageHeight);
    const w = Math.round(bbox.width * imageWidth);
    const h = Math.round(bbox.height * imageHeight);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${r},${g},${b})"/>`;
  }).join('');

  const svgMask = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">${rectsSvg}</svg>`
  );

  // Composite mask over image, then resize
  const masked = await sharp(imageBuffer)
    .composite([{ input: svgMask, top: 0, left: 0, blend: 'over' }])
    .resize(cfg.maxDimension, cfg.maxDimension, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: cfg.jpegQuality })
    .toBuffer();

  // Get final dimensions
  const finalMetadata = await sharp(masked).metadata();

  log.info(`Negative generated in ${Date.now() - startTime}ms, masked ${bboxes.length} regions, size: ${(masked.length / 1024).toFixed(1)}KB`);

  return {
    buffer: masked,
    maskedRegions: bboxes,
    resolution: { width: finalMetadata.width || 0, height: finalMetadata.height || 0 },
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

  const { width: imageWidth, height: imageHeight } = originalDimensions;
  const cropWidth = Math.floor(cropRegion.width);
  const cropHeight = Math.floor(cropRegion.height);

  // Get crop dimensions
  const cropMetadata = await sharp(cropBuffer).metadata();
  const actualCropWidth = cropMetadata.width!;
  const actualCropHeight = cropMetadata.height!;

  // Scale factor if crop was resized
  const scaleX = actualCropWidth / cropWidth;
  const scaleY = actualCropHeight / cropHeight;

  // Combine other masks into single "mask out" layer
  const combinedOtherMask = new Uint8Array(actualCropWidth * actualCropHeight);

  for (const otherMask of otherMasks) {
    // Extract portion of other mask that falls within crop region
    for (let cy = 0; cy < actualCropHeight; cy++) {
      for (let cx = 0; cx < actualCropWidth; cx++) {
        // Map crop pixel to original image pixel
        const origX = Math.floor(cropRegion.x + cx / scaleX);
        const origY = Math.floor(cropRegion.y + cy / scaleY);

        if (origX >= 0 && origX < otherMask.width &&
            origY >= 0 && origY < otherMask.height) {
          const srcIdx = origY * otherMask.width + origX;
          const dstIdx = cy * actualCropWidth + cx;

          if (otherMask.data[srcIdx] > 128) {
            combinedOtherMask[dstIdx] = 255;
          }
        }
      }
    }
  }

  // Check if any masking is needed
  const hasPixelsToMask = combinedOtherMask.some(v => v > 0);
  if (!hasPixelsToMask) {
    return { buffer: cropBuffer, maskedCount: 0 };
  }

  // Create SVG mask from combined mask
  // Convert to runs for efficient SVG generation
  let svgPaths = '';
  for (let y = 0; y < actualCropHeight; y++) {
    let inRun = false;
    let runStart = 0;

    for (let x = 0; x <= actualCropWidth; x++) {
      const idx = y * actualCropWidth + x;
      const val = x < actualCropWidth ? combinedOtherMask[idx] : 0;

      if (val > 128 && !inRun) {
        inRun = true;
        runStart = x;
      } else if (val <= 128 && inRun) {
        inRun = false;
        // Add rectangle for this run
        svgPaths += `<rect x="${runStart}" y="${y}" width="${x - runStart}" height="1" fill="black"/>`;
      }
    }
  }

  if (!svgPaths) {
    return { buffer: cropBuffer, maskedCount: 0 };
  }

  const svgMask = Buffer.from(
    `<svg width="${actualCropWidth}" height="${actualCropHeight}" xmlns="http://www.w3.org/2000/svg">${svgPaths}</svg>`
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
    // Black masking
    result = await sharp(cropBuffer)
      .composite([
        { input: svgMask, blend: 'over' },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  log.info(`Applied mask to crop, masked ${otherMasks.length} overlapping subjects`);

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

  // Get original dimensions
  const originalMetadata = await sharp(originalPath).metadata();
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

  // Load original image once
  const originalBuffer = await sharp(originalPath).toBuffer();
  const imageWidth = originalDimensions.width;
  const imageHeight = originalDimensions.height;

  // Process each detection
  const crops: MaskedCropResult[] = [];

  for (let i = 0; i < limitedDetections.length; i++) {
    const detection = limitedDetections[i];

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
        continue;
      }

      // Calculate output dimensions
      let outputWidth = width;
      let outputHeight = height;
      if (width > cfg.maxDimension || height > cfg.maxDimension) {
        const scale = Math.min(cfg.maxDimension / width, cfg.maxDimension / height);
        outputWidth = Math.round(width * scale);
        outputHeight = Math.round(height * scale);
      }

      // Extract basic crop
      let cropBuffer = await sharp(originalBuffer)
        .extract({ left: x, top: y, width, height })
        .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: cfg.jpegQuality, mozjpeg: true })
        .toBuffer();

      // Find overlapping detections
      let maskedCount = 0;

      if (maskCfg.enabled && maskCfg.maskOtherSubjects) {
        const overlappingDetections = limitedDetections.filter((d, j) =>
          j !== i && bboxesOverlap(paddedBbox, d.bbox)
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

      crops.push(cropResult);
    } catch (error) {
      log.error(`Failed to extract masked crop for ${detection.detectionId}:`, error);
    }
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
