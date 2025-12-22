/**
 * Tag Normalizer Module
 *
 * Normalizes and validates extracted tags
 */

import { VisualTags } from '../types/index.ts';
import { TAGGING_CONFIG, LOG_PREFIX } from '../config/constants.ts';

/**
 * Normalize a single tag string
 */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')  // Remove special chars except hyphen
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .substring(0, 50);          // Max length
}

/**
 * Filter and normalize tag array
 */
function normalizeTagArray(tags: string[], maxCount: number): string[] {
  if (!Array.isArray(tags)) return [];

  return tags
    .map(normalizeTag)
    .filter(tag => tag.length >= 2)  // Min 2 chars
    .filter((tag, index, self) => self.indexOf(tag) === index)  // Unique
    .slice(0, maxCount);
}

/**
 * Normalize all tags according to config limits
 */
export function normalizeTags(rawTags: VisualTags): VisualTags {
  const normalized: VisualTags = {
    location: normalizeTagArray(rawTags.location, TAGGING_CONFIG.MAX_LOCATION_TAGS),
    weather: normalizeTagArray(rawTags.weather, TAGGING_CONFIG.MAX_WEATHER_TAGS),
    sceneType: normalizeTagArray(rawTags.sceneType, TAGGING_CONFIG.MAX_SCENE_TAGS),
    subjects: normalizeTagArray(rawTags.subjects, TAGGING_CONFIG.MAX_SUBJECT_TAGS),
    visualStyle: normalizeTagArray(rawTags.visualStyle, TAGGING_CONFIG.MAX_STYLE_TAGS),
    emotion: normalizeTagArray(rawTags.emotion, TAGGING_CONFIG.MAX_EMOTION_TAGS)
  };

  const totalBefore = Object.values(rawTags).flat().length;
  const totalAfter = Object.values(normalized).flat().length;

  if (totalBefore !== totalAfter) {
    console.log(`${LOG_PREFIX} Normalized tags: ${totalBefore} -> ${totalAfter}`);
  }

  return normalized;
}

/**
 * Enrich tags with participant data from recognition
 */
export function enrichWithParticipant(
  tags: VisualTags,
  recognitionResult?: {
    raceNumber?: string;
    driverName?: string;
    teamName?: string;
  }
): {
  tags: VisualTags;
  participant?: {
    name: string;
    team: string;
    raceNumber: string;
  };
} {
  if (!recognitionResult) {
    return { tags };
  }

  const { raceNumber, driverName, teamName } = recognitionResult;

  // Add driver/team to subjects if recognized
  const enrichedSubjects = [...tags.subjects];

  if (driverName && !enrichedSubjects.some(s => s.toLowerCase().includes(driverName.toLowerCase()))) {
    enrichedSubjects.push(normalizeTag(driverName));
  }

  if (teamName && !enrichedSubjects.some(s => s.toLowerCase().includes(teamName.toLowerCase()))) {
    enrichedSubjects.push(normalizeTag(teamName));
  }

  // Limit to max
  const finalSubjects = enrichedSubjects.slice(0, TAGGING_CONFIG.MAX_SUBJECT_TAGS + 2);  // Allow +2 for participant

  return {
    tags: {
      ...tags,
      subjects: finalSubjects
    },
    participant: (raceNumber || driverName || teamName) ? {
      name: driverName || '',
      team: teamName || '',
      raceNumber: raceNumber || ''
    } : undefined
  };
}

/**
 * Get all tags as a flat array for IPTC keywords
 */
export function flattenTags(tags: VisualTags): string[] {
  return [
    ...tags.location,
    ...tags.weather,
    ...tags.sceneType,
    ...tags.subjects,
    ...tags.visualStyle,
    ...tags.emotion
  ];
}
