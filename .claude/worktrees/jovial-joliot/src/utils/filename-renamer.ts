/**
 * Filename Renamer Utility
 *
 * Handles pattern-based filename renaming with placeholders and sequence management.
 * Used by Export Destinations to rename files on export.
 *
 * Placeholders:
 * - {original}     - Original filename without extension
 * - {name}         - Full participant name
 * - {surname}      - Participant surname only
 * - {number}       - Race number
 * - {team}         - Team name
 * - {car_model}    - Car model
 * - {nationality}  - Nationality code
 * - {event}        - Event name
 * - {date}         - Capture date (YYYY-MM-DD)
 * - {date:FORMAT}  - Formatted date (e.g. {date:YYYYMMDD})
 * - {seq}          - Sequence number
 * - {seq:N}        - Sequence with N digits padding
 */

import * as path from 'path';

/**
 * Sequence mode determines how/when the sequence counter resets
 */
export enum SequenceMode {
  GLOBAL = 'global',           // Never resets, continuous 1, 2, 3, 4...
  PER_SUBJECT = 'per_subject', // Resets per participant: Verstappen_1, Leclerc_1, Verstappen_2...
  PER_FOLDER = 'per_folder'    // Resets for each output folder
}

/**
 * Context data for building filenames
 */
export interface RenameContext {
  /** Original filename without extension */
  original: string;
  /** Original file extension including the dot */
  extension: string;
  /** Matched participant data */
  participant?: {
    name?: string;
    surname?: string;
    number?: string | number;
    team?: string;
    car_model?: string;
    nationality?: string;
  };
  /** Event name */
  event?: string;
  /** Capture date */
  date?: Date;
  /** Pre-calculated sequence number */
  sequenceNumber?: number;
  /** Output folder path (for per_folder sequence mode) */
  outputFolder?: string;
}

/**
 * Sequence Manager
 *
 * Manages sequence counters for filename generation.
 * Supports different modes for resetting sequences.
 */
export class SequenceManager {
  private sequences: Map<string, number> = new Map();
  private globalSequence: number = 0;

  /**
   * Get the next sequence number based on mode
   * @param mode - How sequences should be grouped/reset
   * @param key - The grouping key (participant number, folder path, etc.)
   * @param start - Starting number for new sequences
   * @returns The next sequence number
   */
  getNext(mode: SequenceMode, key: string, start: number = 1): number {
    switch (mode) {
      case SequenceMode.GLOBAL:
        this.globalSequence++;
        return this.globalSequence + start - 1;

      case SequenceMode.PER_SUBJECT:
      case SequenceMode.PER_FOLDER:
        const currentKey = `${mode}:${key}`;
        const current = this.sequences.get(currentKey) || (start - 1);
        const next = current + 1;
        this.sequences.set(currentKey, next);
        return next;

      default:
        return start;
    }
  }

  /**
   * Get current sequence value without incrementing
   */
  peek(mode: SequenceMode, key: string, start: number = 1): number {
    switch (mode) {
      case SequenceMode.GLOBAL:
        return this.globalSequence || start;
      case SequenceMode.PER_SUBJECT:
      case SequenceMode.PER_FOLDER:
        const currentKey = `${mode}:${key}`;
        return this.sequences.get(currentKey) || start;
      default:
        return start;
    }
  }

  /**
   * Reset all sequences (called at start of new batch/event)
   */
  reset(): void {
    this.sequences.clear();
    this.globalSequence = 0;
  }

  /**
   * Reset sequences for a specific mode
   */
  resetMode(mode: SequenceMode): void {
    if (mode === SequenceMode.GLOBAL) {
      this.globalSequence = 0;
    } else {
      // Remove all keys matching this mode
      for (const key of this.sequences.keys()) {
        if (key.startsWith(`${mode}:`)) {
          this.sequences.delete(key);
        }
      }
    }
  }
}

/**
 * Extract surname from full name
 * Handles various formats: "Charles Leclerc", "Leclerc, Charles", "Leclerc"
 */
function extractSurname(fullName?: string): string {
  if (!fullName) return '';

  // Handle "Surname, FirstName" format
  if (fullName.includes(',')) {
    return fullName.split(',')[0].trim();
  }

  // Handle "FirstName Surname" format - take last word
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Format date according to pattern
 * @param date - Date to format
 * @param format - Format string (e.g. "YYYYMMDD", "YYYY-MM-DD", "DD-MM-YYYY")
 */
function formatDate(date: Date, format: string): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return format
    .replace(/YYYY/g, year)
    .replace(/YY/g, year.slice(-2))
    .replace(/MM/g, month)
    .replace(/DD/g, day)
    .replace(/HH/g, hours)
    .replace(/mm/g, minutes)
    .replace(/ss/g, seconds);
}

/**
 * Sanitize string for use in filename
 * Removes/replaces characters that are invalid in filenames
 */
function sanitizeForFilename(str: string): string {
  if (!str) return '';

  return str
    // Replace path separators
    .replace(/[\/\\]/g, '-')
    // Replace other invalid characters
    .replace(/[<>:"|?*]/g, '_')
    // Replace multiple spaces/underscores with single
    .replace(/[\s_]+/g, '_')
    // Remove leading/trailing underscores
    .replace(/^_+|_+$/g, '')
    // Trim
    .trim();
}

/**
 * Build filename from pattern and context
 *
 * @param pattern - The filename pattern with placeholders
 * @param context - The context data for replacement
 * @param padding - Default padding for sequence numbers
 * @returns The built filename (without extension)
 */
export function buildFilename(
  pattern: string,
  context: RenameContext,
  padding: number = 3
): string {
  if (!pattern) {
    return context.original;
  }

  let result = pattern;
  const participant = context.participant || {};

  // Build replacement map
  const surname = participant.surname || extractSurname(participant.name);

  const replacements: Record<string, string> = {
    '{original}': context.original || '',
    '{name}': sanitizeForFilename(participant.name || ''),
    '{surname}': sanitizeForFilename(surname),
    '{number}': String(participant.number || ''),
    '{team}': sanitizeForFilename(participant.team || ''),
    '{car_model}': sanitizeForFilename(participant.car_model || ''),
    '{nationality}': sanitizeForFilename(participant.nationality || ''),
    '{event}': sanitizeForFilename(context.event || ''),
  };

  // Simple date placeholder
  if (context.date) {
    replacements['{date}'] = formatDate(context.date, 'YYYY-MM-DD');
  } else {
    replacements['{date}'] = '';
  }

  // Apply simple replacements
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }

  // Handle date with format: {date:FORMAT}
  const dateFormatRegex = /\{date:([^}]+)\}/g;
  result = result.replace(dateFormatRegex, (match, format) => {
    if (context.date) {
      return formatDate(context.date, format);
    }
    return '';
  });

  // Handle sequence with padding: {seq} or {seq:N}
  const seqRegex = /\{seq(?::(\d+))?\}/g;
  result = result.replace(seqRegex, (match, customPadding) => {
    const seqNum = context.sequenceNumber || 1;
    const padLength = customPadding ? parseInt(customPadding, 10) : padding;
    return seqNum.toString().padStart(padLength, '0');
  });

  // Clean up result
  result = result
    // Remove empty parentheses that might result from missing values
    .replace(/\(\s*\)/g, '')
    // Remove double underscores/hyphens
    .replace(/[_-]{2,}/g, '_')
    // Remove leading/trailing underscores/hyphens
    .replace(/^[_-]+|[_-]+$/g, '')
    .trim();

  // If result is empty, fallback to original
  if (!result) {
    return context.original;
  }

  return result;
}

/**
 * Build subfolder path from pattern and context
 * Similar to buildFilename but allows path separators
 */
export function buildSubfolderPath(
  pattern: string,
  context: RenameContext
): string {
  if (!pattern) {
    return '';
  }

  let result = pattern;
  const participant = context.participant || {};
  const surname = participant.surname || extractSurname(participant.name);

  const replacements: Record<string, string> = {
    '{original}': context.original || '',
    '{name}': participant.name || '',
    '{surname}': surname,
    '{number}': String(participant.number || ''),
    '{team}': participant.team || '',
    '{car_model}': participant.car_model || '',
    '{nationality}': participant.nationality || '',
    '{event}': context.event || '',
  };

  // Date
  if (context.date) {
    replacements['{date}'] = formatDate(context.date, 'YYYY-MM-DD');
  } else {
    replacements['{date}'] = '';
  }

  // Apply replacements
  for (const [placeholder, value] of Object.entries(replacements)) {
    // Sanitize each value individually but allow path separators in result
    result = result.split(placeholder).join(sanitizeForFilename(value));
  }

  // Handle date with format
  const dateFormatRegex = /\{date:([^}]+)\}/g;
  result = result.replace(dateFormatRegex, (match, format) => {
    if (context.date) {
      return formatDate(context.date, format);
    }
    return '';
  });

  // Clean up but preserve path separators
  result = result
    .replace(/\(\s*\)/g, '')
    // Normalize path separators
    .replace(/\\/g, '/')
    // Remove duplicate separators
    .replace(/\/+/g, '/')
    // Remove leading/trailing separators
    .replace(/^\/+|\/+$/g, '')
    .trim();

  return result;
}

/**
 * Preview what a filename would look like with sample data
 * Useful for UI preview
 */
export function previewFilename(
  pattern: string,
  sampleParticipant?: {
    name?: string;
    surname?: string;
    number?: string | number;
    team?: string;
    car_model?: string;
    nationality?: string;
  },
  options?: {
    event?: string;
    sequenceNumber?: number;
    padding?: number;
  }
): string {
  // Default sample data if not provided
  const defaultSample = {
    name: 'Max Verstappen',
    surname: 'Verstappen',
    number: '1',
    team: 'Red Bull Racing',
    car_model: 'RB20',
    nationality: 'NED'
  };

  const context: RenameContext = {
    original: 'IMG_1234',
    extension: '.jpg',
    participant: sampleParticipant || defaultSample,
    event: options?.event || 'Monaco_GP_2025',
    date: new Date(),
    sequenceNumber: options?.sequenceNumber || 1
  };

  const filename = buildFilename(pattern, context, options?.padding || 3);
  return filename + context.extension;
}

/**
 * Get the sequence key based on mode and context
 */
export function getSequenceKey(
  mode: SequenceMode,
  context: RenameContext
): string {
  switch (mode) {
    case SequenceMode.GLOBAL:
      return 'global';
    case SequenceMode.PER_SUBJECT:
      return context.participant?.number?.toString() ||
             context.participant?.name ||
             'unknown';
    case SequenceMode.PER_FOLDER:
      return context.outputFolder || 'root';
    default:
      return 'default';
  }
}

/**
 * Validate a filename pattern
 * Returns array of warnings/errors
 */
export function validatePattern(pattern: string): string[] {
  const issues: string[] = [];

  if (!pattern) {
    return issues; // Empty is valid (uses original name)
  }

  // Check for unknown placeholders
  const knownPlaceholders = [
    'original', 'name', 'surname', 'number', 'team',
    'car_model', 'nationality', 'event', 'date', 'seq'
  ];

  const placeholderRegex = /\{([^}:]+)(?::[^}]*)?\}/g;
  let match;
  while ((match = placeholderRegex.exec(pattern)) !== null) {
    const placeholder = match[1];
    if (!knownPlaceholders.includes(placeholder)) {
      issues.push(`Unknown placeholder: {${placeholder}}`);
    }
  }

  // Check for invalid filename characters in static parts
  const staticParts = pattern.replace(/\{[^}]+\}/g, '');
  if (/[<>:"|?*]/.test(staticParts)) {
    issues.push('Pattern contains invalid filename characters: < > : " | ? *');
  }

  // Warn if no sequence and might produce duplicates
  if (!pattern.includes('{seq}') && !pattern.includes('{original}')) {
    issues.push('Warning: Pattern has no {seq} or {original} - may produce duplicate filenames');
  }

  return issues;
}

// Export default sequence manager instance
export const sequenceManager = new SequenceManager();
