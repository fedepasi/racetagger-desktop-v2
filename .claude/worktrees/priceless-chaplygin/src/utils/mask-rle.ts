/**
 * mask-rle.ts
 *
 * Run-Length Encoding (RLE) utilities for binary segmentation masks.
 * RLE provides efficient compression for binary masks (10-20x vs raw Uint8Array).
 *
 * Format: [startPixel, length, startPixel, length, ...]
 * Each pair represents a "run" of foreground (mask=1) pixels.
 */

// Logger (simple console wrapper)
const log = {
  debug: (msg: string, ...args: any[]) => console.log(`[MaskRLE] ${msg}`, ...args),
  info: (msg: string, ...args: any[]) => console.log(`[MaskRLE] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[MaskRLE] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[MaskRLE] ${msg}`, ...args),
};

/**
 * Encode a binary mask to RLE format
 * @param mask - Binary mask as Uint8Array (values > 127 = foreground)
 * @param width - Image width
 * @param height - Image height
 * @returns RLE encoded array [startIdx, length, startIdx, length, ...]
 */
export function encodeMaskToRLE(mask: Uint8Array, width: number, height: number): number[] {
  const rle: number[] = [];
  let inRun = false;
  let runStart = 0;

  for (let i = 0; i < mask.length; i++) {
    const isForeground = mask[i] > 127;

    if (isForeground && !inRun) {
      // Start of a new run
      runStart = i;
      inRun = true;
    } else if (!isForeground && inRun) {
      // End of current run
      rle.push(runStart, i - runStart);
      inRun = false;
    }
  }

  // Handle case where mask ends with foreground pixels
  if (inRun) {
    rle.push(runStart, mask.length - runStart);
  }

  return rle;
}

/**
 * Decode RLE back to binary mask
 * @param rle - RLE encoded array [startIdx, length, startIdx, length, ...]
 * @param width - Image width
 * @param height - Image height
 * @returns Decoded binary mask as Uint8Array (255 = foreground, 0 = background)
 */
export function decodeMaskFromRLE(rle: number[], width: number, height: number): Uint8Array {
  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);

  for (let i = 0; i < rle.length; i += 2) {
    const start = rle[i];
    const length = rle[i + 1];

    // Bounds checking
    const end = Math.min(start + length, totalPixels);
    for (let j = start; j < end; j++) {
      mask[j] = 255;
    }
  }

  return mask;
}

/**
 * Calculate mask area (number of foreground pixels) from RLE
 * More efficient than decoding the full mask
 * @param rle - RLE encoded array
 * @returns Number of foreground pixels
 */
export function getMaskAreaFromRLE(rle: number[]): number {
  let area = 0;
  for (let i = 1; i < rle.length; i += 2) {
    area += rle[i];
  }
  return area;
}

/**
 * Calculate compression ratio of RLE vs raw mask
 * @param rle - RLE encoded array
 * @param width - Image width
 * @param height - Image height
 * @returns Compression ratio (e.g., 10 means RLE is 10x smaller)
 */
export function getRLECompressionRatio(rle: number[], width: number, height: number): number {
  const rawSize = width * height; // bytes
  const rleSize = rle.length * 4; // 4 bytes per number (assuming 32-bit integers)
  return rawSize / rleSize;
}

/**
 * Validate RLE data structure
 * @param rle - RLE array to validate
 * @param width - Image width
 * @param height - Image height
 * @returns true if valid, false otherwise
 */
export function isValidRLE(rle: number[], width: number, height: number): boolean {
  if (!Array.isArray(rle) || rle.length % 2 !== 0) {
    return false;
  }

  const totalPixels = width * height;

  for (let i = 0; i < rle.length; i += 2) {
    const start = rle[i];
    const length = rle[i + 1];

    // Check bounds
    if (start < 0 || length <= 0 || start + length > totalPixels) {
      log.warn(`[RLE] Invalid run at index ${i}: start=${start}, length=${length}, total=${totalPixels}`);
      return false;
    }

    // Check ordering (runs should not overlap)
    if (i > 0) {
      const prevEnd = rle[i - 2] + rle[i - 1];
      if (start < prevEnd) {
        log.warn(`[RLE] Overlapping runs detected at index ${i}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Find contour points from a binary mask
 * Returns edge pixels where mask transitions from background to foreground
 * @param mask - Binary mask as Uint8Array
 * @param width - Image width
 * @param height - Image height
 * @returns Array of {x, y} contour points
 */
export function findMaskContour(mask: Uint8Array, width: number, height: number): { x: number; y: number }[] {
  const contour: { x: number; y: number }[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const current = mask[idx] > 0;

      if (!current) continue;

      // Check if this is an edge pixel (has at least one background neighbor)
      const left = x > 0 ? mask[idx - 1] > 0 : false;
      const right = x < width - 1 ? mask[idx + 1] > 0 : false;
      const top = y > 0 ? mask[idx - width] > 0 : false;
      const bottom = y < height - 1 ? mask[idx + width] > 0 : false;

      if (!left || !right || !top || !bottom) {
        contour.push({ x, y });
      }
    }
  }

  return contour;
}

/**
 * Sort contour points to form a continuous path
 * Uses nearest-neighbor algorithm for simple contours
 * @param points - Unsorted contour points
 * @returns Sorted points forming a continuous path
 */
export function sortContourPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  const sorted: { x: number; y: number }[] = [];
  const remaining = [...points];

  // Start with the first point
  sorted.push(remaining.shift()!);

  while (remaining.length > 0) {
    const lastPoint = sorted[sorted.length - 1];
    let nearestIdx = 0;
    let nearestDist = Number.MAX_VALUE;

    // Find nearest point
    for (let i = 0; i < remaining.length; i++) {
      const dist = Math.abs(remaining[i].x - lastPoint.x) + Math.abs(remaining[i].y - lastPoint.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }

      // Early exit for adjacent pixels
      if (dist <= 2) break;
    }

    sorted.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return sorted;
}

/**
 * Simplify contour by removing intermediate points on straight lines
 * Reduces number of points while preserving shape
 * @param contour - Sorted contour points
 * @param tolerance - Maximum distance from line to keep point (default: 1)
 * @returns Simplified contour
 */
export function simplifyContour(
  contour: { x: number; y: number }[],
  tolerance: number = 1
): { x: number; y: number }[] {
  if (contour.length <= 3) return contour;

  // Douglas-Peucker algorithm (simplified)
  const simplified: { x: number; y: number }[] = [contour[0]];
  let lastAdded = 0;

  for (let i = 1; i < contour.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const current = contour[i];
    const next = contour[Math.min(i + 1, contour.length - 1)];

    // Calculate perpendicular distance from line (prev -> next)
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) continue;

    const dist = Math.abs(dy * current.x - dx * current.y + next.x * prev.y - next.y * prev.x) / length;

    if (dist > tolerance) {
      simplified.push(current);
      lastAdded = i;
    }
  }

  // Always add last point
  simplified.push(contour[contour.length - 1]);

  return simplified;
}

/**
 * Interface for mask data that will be saved to JSONL
 */
export interface SegmentationMaskData {
  vehicleIndex: number;
  cocoClass: string;
  cocoClassId: number;
  confidence: number;
  mask: {
    rle: number[];
    width: number;
    height: number;
  };
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Create SegmentationMaskData from a raw mask and detection info
 */
export function createSegmentationMaskData(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  vehicleIndex: number,
  cocoClass: string,
  cocoClassId: number,
  confidence: number,
  bbox: { x: number; y: number; width: number; height: number }
): SegmentationMaskData {
  const rle = encodeMaskToRLE(mask, maskWidth, maskHeight);

  log.debug(`[RLE] Encoded mask ${vehicleIndex}: ${mask.length} bytes -> ${rle.length * 4} bytes (${getRLECompressionRatio(rle, maskWidth, maskHeight).toFixed(1)}x compression)`);

  return {
    vehicleIndex,
    cocoClass,
    cocoClassId,
    confidence,
    mask: {
      rle,
      width: maskWidth,
      height: maskHeight
    },
    bbox
  };
}
