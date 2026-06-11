/**
 * AF Point Extractor
 *
 * Parses EXIF autofocus point data from multi-brand camera metadata and
 * normalizes it into image-space coordinates 0-1 compatible with our
 * bounding-box system (cropAnalysis[].originalBbox).
 *
 * Supported brands: Canon, Nikon, Sony, Fuji. Falls back to a generic
 * parser that looks for `FocusPixel` / `FocusLocation` for unknown makes.
 *
 * The output is consumed by:
 *   - smart-matcher.ts to apply a scoring bonus to candidates whose bbox
 *     contains the focus point;
 *   - ImageAnalysisModal in the management portal to render a focus point
 *     overlay on top of the analyzed image.
 */
export type AfMode = 'single' | 'multi' | 'auto' | 'tracking' | 'manual' | 'unknown';
export type AfSource = 'canon' | 'nikon' | 'sony' | 'fuji' | 'generic';

export interface AfPointData {
  /** Normalized x coordinate of the AF point/area center, 0 (left) to 1 (right). */
  x: number;
  /** Normalized y coordinate of the AF point/area center, 0 (top) to 1 (bottom). */
  y: number;
  /** Normalized AF area width (0-1) when the AF area is a rectangle. */
  width?: number;
  /** Normalized AF area height (0-1) when the AF area is a rectangle. */
  height?: number;
  /** AF mode classification used to gate reliability. */
  mode: AfMode;
  /**
   * Whether the AF point is a reliable identifier of the photographer's intended subject.
   * False for wide-area/tracking modes where the AF position is not tied to a specific subject,
   * and for manual focus where the reported AF coordinates are stale.
   */
  reliable: boolean;
  /** Brand-specific parser that produced the result. */
  source: AfSource;
  /**
   * Raw camera-reported focus mode string (FocusMode / AFAreaMode / AFMode), kept verbatim
   * for display in the management portal. Examples: "Manual focus", "AI Servo",
   * "Single-point AF", "Wide area AF (S)". Undefined when the camera didn't report it.
   */
  focusMode?: string;
}

/**
 * Coerce ExifTool JSON values that may be scalars or arrays into a flat number array.
 * ExifTool returns `AFAreaXPositions` as either `123` or `[123, -45]` depending on
 * the model. Strings like "123 -45 0" are also handled defensively.
 */
function toNumberArray(value: unknown): number[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (typeof value === 'string') {
    return value
      .split(/[\s,;|]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function detectBrand(make: unknown): AfSource | null {
  if (typeof make !== 'string') return null;
  const m = make.toLowerCase();
  if (m.includes('canon')) return 'canon';
  if (m.includes('nikon')) return 'nikon';
  if (m.includes('sony')) return 'sony';
  if (m.includes('fuji')) return 'fuji';
  return null;
}

/**
 * Pick the first non-empty raw focus-mode string from the EXIF block. Returned
 * verbatim so the management portal can display "AI Servo" / "Manual focus" /
 * "Wide area AF (S)" etc. without re-deriving from our normalized AfMode.
 */
function extractRawFocusMode(exif: Record<string, unknown>): string | undefined {
  const candidates = [exif.AFAreaMode, exif.FocusMode, exif.AFMode, exif.AFAreaSelectMethod];
  for (const raw of candidates) {
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return undefined;
}

/**
 * Classify AF mode from common ExifTool fields. Defaults to 'unknown' when
 * the string is unrecognized so callers can decide their reliability policy.
 *
 * Manual focus is recognized as its own mode: the camera was not autofocusing,
 * so any AF coordinates present are stale (last AF position before switching to MF).
 * Callers treat 'manual' as unreliable but may still surface the info in the UI.
 *
 * Brand abbreviations handled explicitly:
 *   - Nikon: "AF-S" (single), "AF-C" (continuous → tracking), "AF-A" (auto-switch
 *     between S and C → tracking), "AF-F" (full-time AF for movie → tracking),
 *     "MF" (manual)
 *   - Sony:  "AF-S", "AF-C", "AF-A", "DMF" (direct manual focus — body locked AF
 *     first then user tweaked manually, so AF coords are still meaningful → treat
 *     as 'single'), "MF"
 *   - Canon: "One-shot AF" (→ single), "AI Servo AF" (→ tracking), "AI Focus AF"
 *     (auto-switch → tracking), "Manual focus" (→ manual). Handled by substring rules.
 *
 * Word boundaries are enforced via regex for the short abbreviations to avoid
 * false positives like "raft" matching " af " etc.
 */
function classifyMode(exif: Record<string, unknown>): AfMode {
  const fields = [exif.AFAreaMode, exif.FocusMode, exif.AFMode, exif.AFAreaSelectMethod];
  for (const raw of fields) {
    if (typeof raw !== 'string') continue;
    const v = raw.toLowerCase().trim();

    // Manual focus — explicit. Checked first because Sony's FocusMode "Manual"
    // can coexist with stale AFLocation pixels we don't want to trust.
    // Regex matches "mf" as a standalone token (start/end/whitespace/comma boundary)
    // so we don't false-positive on "mffoo" or unrelated text.
    if (v.includes('manual') || /(^|[\s,])mf($|[\s,])/.test(v)) return 'manual';

    // Nikon/Sony short forms — must be checked before generic substring rules
    // because "AF-S" does not contain "single" and "AF-C" does not contain
    // "continuous". Word-boundary regex avoids false positives.
    if (/(^|[\s,])af-s($|[\s,])/.test(v)) return 'single';
    if (/(^|[\s,])af-c($|[\s,])/.test(v) || /(^|[\s,])af-a($|[\s,])/.test(v) || /(^|[\s,])af-f($|[\s,])/.test(v)) {
      return 'tracking';
    }
    // Sony DMF: body autofocuses first then user tweaks manually. The AF coords
    // record where the body locked AF, which is still a reliable subject signal.
    if (/(^|[\s,])dmf($|[\s,])/.test(v)) return 'single';

    if (
      v.includes('single') ||
      v.includes('1-point') ||
      v.includes('1 point') ||
      v.includes('spot') ||
      v.includes('flexible spot') ||
      v.includes('one-shot')
    ) {
      return 'single';
    }
    if (
      v.includes('tracking') ||
      v.includes('servo') ||
      v.includes('ai servo') ||
      v.includes('ai focus') ||
      v.includes('continuous') ||
      v.includes('lock-on') ||
      v.includes('subject detect') ||
      v.includes('face') ||
      v.includes('eye')
    ) {
      // Subject-tracking modes still bind to a specific subject when AF coordinates
      // are populated, so we treat them as reliable downstream (face/eye is a single point).
      return 'tracking';
    }
    if (
      v.includes('wide') ||
      v.includes('auto') ||
      v.includes('zone') ||
      v.includes('group') ||
      v.includes('dynamic') ||
      v.includes('multi')
    ) {
      return v.includes('wide') || v.includes('auto') ? 'auto' : 'multi';
    }
  }
  return 'unknown';
}

/**
 * Canon stores AF coordinates as pixel offsets from the IMAGE CENTER (can be negative),
 * with the AF coordinate space defined by AFImageWidth/AFImageHeight rather than the
 * actual image pixel dimensions.
 *
 * For zone/multi AF, AFAreaXPositions is an array of selected point positions;
 * we average them to obtain the centroid of the active AF region.
 */
function parseCanon(exif: Record<string, unknown>): AfPointData | null {
  const xs = toNumberArray(exif.AFAreaXPositions);
  const ys = toNumberArray(exif.AFAreaYPositions);
  if (xs.length === 0 || ys.length === 0) return null;

  const afWidth = Number(exif.AFImageWidth);
  const afHeight = Number(exif.AFImageHeight);
  if (!Number.isFinite(afWidth) || !Number.isFinite(afHeight) || afWidth <= 0 || afHeight <= 0) {
    return null;
  }

  const cx = average(xs);
  const cy = average(ys);
  if (cx == null || cy == null) return null;

  const x = clamp01((cx + afWidth / 2) / afWidth);
  const y = clamp01((cy + afHeight / 2) / afHeight);

  const widths = toNumberArray(exif.AFAreaWidths);
  const heights = toNumberArray(exif.AFAreaHeights);
  const widthRaw = average(widths);
  const heightRaw = average(heights);

  const mode = classifyMode(exif);
  const reliable =
    mode === 'single' || mode === 'tracking' || (mode === 'multi' && xs.length === 1);

  return {
    x,
    y,
    width: widthRaw != null && widthRaw > 0 ? clamp01(widthRaw / afWidth) : undefined,
    height: heightRaw != null && heightRaw > 0 ? clamp01(heightRaw / afHeight) : undefined,
    mode,
    reliable,
    source: 'canon',
    focusMode: extractRawFocusMode(exif),
  };
}

/**
 * Nikon stores AFAreaXPosition/Y as pixel offset relative to ImageWidth/Height,
 * generally from the top-left corner (positive values). Recent Z bodies provide
 * AFAreaWidth/Height as the area size in pixels.
 */
function parseNikon(exif: Record<string, unknown>): AfPointData | null {
  const imgW = Number(exif.ImageWidth ?? exif.ExifImageWidth);
  const imgH = Number(exif.ImageHeight ?? exif.ExifImageHeight);
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) return null;

  const ax = Number(exif.AFAreaXPosition);
  const ay = Number(exif.AFAreaYPosition);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null;

  const x = clamp01(ax / imgW);
  const y = clamp01(ay / imgH);

  const aw = Number(exif.AFAreaWidth);
  const ah = Number(exif.AFAreaHeight);

  const mode = classifyMode(exif);
  const reliable = mode === 'single' || mode === 'tracking';

  return {
    x,
    y,
    width: Number.isFinite(aw) && aw > 0 ? clamp01(aw / imgW) : undefined,
    height: Number.isFinite(ah) && ah > 0 ? clamp01(ah / imgH) : undefined,
    mode,
    reliable,
    source: 'nikon',
    focusMode: extractRawFocusMode(exif),
  };
}

/**
 * Sony Alpha bodies expose FocusLocation as "ImageWidth ImageHeight FocusX FocusY"
 * (top-left origin, pixels). FocalPlaneAFPointsUsed may give multiple points.
 */
function parseSony(exif: Record<string, unknown>): AfPointData | null {
  const focusLocation = exif.FocusLocation ?? exif.FocusPosition2;
  let imgW: number | null = null;
  let imgH: number | null = null;
  let fx: number | null = null;
  let fy: number | null = null;

  if (typeof focusLocation === 'string') {
    const parts = focusLocation.split(/\s+/).map(Number);
    if (parts.length >= 4 && parts.every((n) => Number.isFinite(n))) {
      [imgW, imgH, fx, fy] = parts;
    }
  } else if (Array.isArray(focusLocation) && focusLocation.length >= 4) {
    const parts = focusLocation.map(Number);
    if (parts.every((n) => Number.isFinite(n))) {
      [imgW, imgH, fx, fy] = parts;
    }
  }

  if (imgW == null || imgH == null || fx == null || fy == null || imgW <= 0 || imgH <= 0) {
    return null;
  }

  const mode = classifyMode(exif);
  const reliable = mode === 'single' || mode === 'tracking';

  return {
    x: clamp01(fx / imgW),
    y: clamp01(fy / imgH),
    mode,
    reliable,
    source: 'sony',
    focusMode: extractRawFocusMode(exif),
  };
}

/**
 * Fuji X-series provides FocusPixel as "x y" (top-left origin) along with the
 * RawImageFullWidth/Height. ExifTool may also expose ImageWidth/Height.
 */
function parseFuji(exif: Record<string, unknown>): AfPointData | null {
  const focusPixel = exif.FocusPixel;
  let fx: number | null = null;
  let fy: number | null = null;

  if (typeof focusPixel === 'string') {
    const parts = focusPixel.split(/\s+/).map(Number);
    if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
      [fx, fy] = parts;
    }
  } else if (Array.isArray(focusPixel) && focusPixel.length >= 2) {
    const parts = focusPixel.map(Number);
    if (parts.every((n) => Number.isFinite(n))) {
      [fx, fy] = parts;
    }
  }

  if (fx == null || fy == null) return null;

  const imgW = Number(exif.ImageWidth ?? exif.RawImageFullWidth ?? exif.ExifImageWidth);
  const imgH = Number(exif.ImageHeight ?? exif.RawImageFullHeight ?? exif.ExifImageHeight);
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) return null;

  const mode = classifyMode(exif);
  const reliable = mode === 'single' || mode === 'tracking';

  return {
    x: clamp01(fx / imgW),
    y: clamp01(fy / imgH),
    mode,
    reliable,
    source: 'fuji',
    focusMode: extractRawFocusMode(exif),
  };
}

/**
 * Last-resort parser: try generic FocusPixel/FocusLocation patterns when the
 * brand isn't recognized but the field happens to be present.
 */
function parseGeneric(exif: Record<string, unknown>): AfPointData | null {
  return parseFuji(exif) ?? parseSony(exif);
}

/**
 * Apply EXIF Orientation to AF coordinates so they match the *displayed* image
 * orientation (after browser/Sharp auto-rotation). AF parsers always return
 * coords in the sensor frame, which is landscape on every camera; this helper
 * rotates them so an overlay placed at (af.x * displayWidth, af.y * displayHeight)
 * lands at the correct visual location even on portrait/rotated shots.
 *
 * EXIF Orientation reference:
 *   1 = no rotation       2 = mirror horizontal      3 = rotate 180
 *   4 = mirror vertical   5 = transpose              6 = rotate 90 CW
 *   7 = transverse        8 = rotate 90 CCW
 */
function applyOrientation(
  pt: { x: number; y: number; width?: number; height?: number },
  orientation: number
): typeof pt {
  switch (orientation) {
    case 2:
      return { ...pt, x: 1 - pt.x };
    case 3:
      return { ...pt, x: 1 - pt.x, y: 1 - pt.y };
    case 4:
      return { ...pt, y: 1 - pt.y };
    case 5:
      return { x: pt.y, y: pt.x, width: pt.height, height: pt.width };
    case 6:
      return { x: 1 - pt.y, y: pt.x, width: pt.height, height: pt.width };
    case 7:
      return { x: 1 - pt.y, y: 1 - pt.x, width: pt.height, height: pt.width };
    case 8:
      return { x: pt.y, y: 1 - pt.x, width: pt.height, height: pt.width };
    case 1:
    default:
      return pt;
  }
}

/**
 * Public entry point.
 *
 * @param exif Raw ExifTool JSON object for a single image (one element of the
 *             top-level JSON array returned by `exiftool -json`).
 * @returns Normalized AF point in *displayed* image coordinates (rotated per
 *          EXIF Orientation), or null when the EXIF lacks usable AF data.
 */
export function extractAfPoint(exif: Record<string, unknown> | null | undefined): AfPointData | null {
  if (!exif) return null;

  const brand = detectBrand(exif.Make);

  let result: AfPointData | null = null;
  switch (brand) {
    case 'canon':
      result = parseCanon(exif);
      break;
    case 'nikon':
      result = parseNikon(exif);
      break;
    case 'sony':
      result = parseSony(exif);
      break;
    case 'fuji':
      result = parseFuji(exif);
      break;
    default:
      result = parseGeneric(exif);
      if (result) result.source = 'generic';
      break;
  }

  // Rotate sensor-frame coords to displayed-image coords so the overlay aligns
  // with the rendered <img> in the management portal. Skip for orientation=1 or
  // when Orientation is missing (most landscape shots) — no-op there.
  if (result) {
    const orientation = typeof exif.Orientation === 'number' ? exif.Orientation : 1;
    if (orientation >= 2 && orientation <= 8) {
      const rotated = applyOrientation(
        { x: result.x, y: result.y, width: result.width, height: result.height },
        orientation
      );
      result.x = rotated.x;
      result.y = rotated.y;
      result.width = rotated.width;
      result.height = rotated.height;
    }
  }

  return result;
}

/**
 * Point-in-bbox test. Both AF point and bbox use normalized 0-1 coordinates with
 * bbox expressed as top-left (x, y) plus (width, height).
 *
 * When the AF area has a known extent (width/height) we also accept overlap
 * (any intersection counts as a hit) — this matches the photographer's intent
 * better than a strict containment test on a 1px center.
 */
export function isAfPointInBbox(
  af: Pick<AfPointData, 'x' | 'y' | 'width' | 'height'>,
  bbox: { x: number; y: number; width: number; height: number }
): boolean {
  if (af.width != null && af.height != null && af.width > 0 && af.height > 0) {
    const afLeft = af.x - af.width / 2;
    const afRight = af.x + af.width / 2;
    const afTop = af.y - af.height / 2;
    const afBottom = af.y + af.height / 2;
    const bbLeft = bbox.x;
    const bbRight = bbox.x + bbox.width;
    const bbTop = bbox.y;
    const bbBottom = bbox.y + bbox.height;
    return !(afRight < bbLeft || afLeft > bbRight || afBottom < bbTop || afTop > bbBottom);
  }
  return (
    af.x >= bbox.x &&
    af.x <= bbox.x + bbox.width &&
    af.y >= bbox.y &&
    af.y <= bbox.y + bbox.height
  );
}
