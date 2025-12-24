/**
 * Response Mapper Module
 *
 * Maps compact Gemini responses (short keys) to expanded format.
 * Supports auto-detection of format for backward compatibility.
 *
 * Compact format saves ~15-20% tokens by using short keys:
 * n=number, d=drivers, t=team, s=sponsors, c=confidence, b=bbox,
 * lv=livery, mk=make, md=model, cat=category, plt=plate, ctx=context
 */

import { LOG_PREFIX } from '../config/constants.ts';

// ==================== COMPACT FORMAT TYPES ====================

/**
 * Compact vehicle response from Gemini (short keys)
 */
export interface CompactVehicleResponse {
  n: string | null;                    // raceNumber
  d: string[];                         // drivers
  t: string | null;                    // teamName
  s: string[];                         // sponsors (otherText)
  c: number;                           // confidence
  b: number[];                         // box_2d [y1,x1,y2,x2]

  // Vehicle DNA fields
  lv: { p: string; s: string[] } | null;  // livery (p=primary, s=secondary)
  mk: string | null;                   // make (manufacturer)
  md: string | null;                   // model
  cat: string | null;                  // category
  plt: string | null;                  // plateNumber
  pltc: number | null;                 // plateConfidence (0.0-1.0)
  ctx: string | null;                  // context (race/pit/podium/portrait)
}

/**
 * Expanded vehicle response (full key names)
 */
export interface ExpandedVehicleResponse {
  raceNumber: string | null;
  drivers: string[];
  teamName: string | null;
  otherText: string[];
  confidence: number;
  box_2d: number[];

  // Vehicle DNA fields
  livery: {
    primary: string;
    secondary: string[];
  } | null;
  make: string | null;
  model: string | null;
  category: string | null;
  plateNumber: string | null;
  plateConfidence: number | null;
  context: string | null;
}

// ==================== FORMAT DETECTION ====================

/**
 * Detect if response is in compact format (short keys)
 * Checks for 'n' key (compact) vs 'raceNumber' key (expanded)
 */
export function isCompactFormat(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;

  // Compact format uses 'n' for number
  // Expanded format uses 'raceNumber'
  return 'n' in obj && !('raceNumber' in obj);
}

/**
 * Detect if the full Gemini response uses compact format
 * Works with both array responses and object with 'crops' key
 */
export function detectResponseFormat(parsed: any): 'compact' | 'expanded' | 'unknown' {
  // Handle array response (new SOTA format)
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return 'unknown';
    return isCompactFormat(parsed[0]) ? 'compact' : 'expanded';
  }

  // Handle object with crops array (V6 format)
  if (parsed.crops && Array.isArray(parsed.crops)) {
    if (parsed.crops.length === 0) return 'unknown';
    return isCompactFormat(parsed.crops[0]) ? 'compact' : 'expanded';
  }

  return 'unknown';
}

// ==================== MAPPING FUNCTIONS ====================

/**
 * Expand a single compact vehicle response to full format
 */
export function expandCompactVehicle(compact: CompactVehicleResponse): ExpandedVehicleResponse {
  return {
    raceNumber: compact.n ?? null,
    drivers: Array.isArray(compact.d) ? compact.d : [],
    teamName: compact.t ?? null,
    otherText: Array.isArray(compact.s) ? compact.s : [],
    confidence: typeof compact.c === 'number' ? compact.c : 0,
    box_2d: Array.isArray(compact.b) ? compact.b : [],

    // Vehicle DNA fields
    livery: compact.lv ? {
      primary: compact.lv.p || '',
      secondary: Array.isArray(compact.lv.s) ? compact.lv.s : []
    } : null,
    make: compact.mk ?? null,
    model: compact.md ?? null,
    category: compact.cat ?? null,
    plateNumber: compact.plt ?? null,
    plateConfidence: typeof compact.pltc === 'number' ? compact.pltc : null,
    context: compact.ctx ?? null
  };
}

/**
 * Normalize any vehicle response to expanded format
 * Auto-detects format and converts if needed
 */
export function normalizeVehicleResponse(vehicle: any): ExpandedVehicleResponse {
  if (isCompactFormat(vehicle)) {
    return expandCompactVehicle(vehicle as CompactVehicleResponse);
  }

  // Already expanded or legacy format - normalize fields
  return {
    raceNumber: vehicle.raceNumber ?? null,
    drivers: Array.isArray(vehicle.drivers) ? vehicle.drivers : [],
    teamName: vehicle.teamName ?? null,
    otherText: Array.isArray(vehicle.otherText) ? vehicle.otherText : [],
    confidence: typeof vehicle.confidence === 'number' ? vehicle.confidence : 0,
    box_2d: Array.isArray(vehicle.box_2d) ? vehicle.box_2d : [],

    // Vehicle DNA fields (may not exist in legacy responses)
    livery: vehicle.livery ?? null,
    make: vehicle.make ?? null,
    model: vehicle.model ?? null,
    category: vehicle.category ?? null,
    plateNumber: vehicle.plateNumber ?? null,
    plateConfidence: typeof vehicle.plateConfidence === 'number' ? vehicle.plateConfidence : null,
    context: vehicle.context ?? null
  };
}

/**
 * Normalize full Gemini response (handles both formats)
 * Returns normalized crops array in expanded format
 */
export function normalizeGeminiResponse(parsed: any): {
  crops: ExpandedVehicleResponse[];
  context?: any;
} {
  const format = detectResponseFormat(parsed);

  if (format !== 'unknown') {
    console.log(`${LOG_PREFIX} Detected ${format} response format`);
  }

  // Handle array response (SOTA format: direct array of vehicles)
  if (Array.isArray(parsed)) {
    return {
      crops: parsed.map(v => normalizeVehicleResponse(v))
    };
  }

  // Handle object with crops (V6 format)
  if (parsed.crops && Array.isArray(parsed.crops)) {
    return {
      crops: parsed.crops.map((v: any) => normalizeVehicleResponse(v)),
      context: parsed.context
    };
  }

  // Fallback: empty
  console.warn(`${LOG_PREFIX} Unknown response format, returning empty crops`);
  return { crops: [] };
}

// ==================== COMPACT KEY REFERENCE ====================

/**
 * Key mapping reference (for documentation)
 */
export const COMPACT_KEY_MAP = {
  n: 'raceNumber',
  d: 'drivers',
  t: 'teamName',
  s: 'otherText (sponsors)',
  c: 'confidence',
  b: 'box_2d',
  lv: 'livery',
  'lv.p': 'livery.primary',
  'lv.s': 'livery.secondary',
  mk: 'make',
  md: 'model',
  cat: 'category',
  plt: 'plateNumber',
  pltc: 'plateConfidence',
  ctx: 'context'
} as const;
