/**
 * Prompt Builder Module
 *
 * Costruisce il prompt finale per Gemini combinando:
 * - ai_prompt da sport_categories (base)
 * - Participant context se fornito
 * - Recognition config hints
 */

import { SportCategoryConfig, ParticipantInfo } from '../types/index.ts';
import { LOG_PREFIX } from '../config/constants.ts';

/**
 * Build the complete analysis prompt for Gemini
 *
 * @param config - Sport category configuration with ai_prompt
 * @param cropCount - Number of crop images being analyzed
 * @param hasNegative - Whether a negative/context image is included
 * @param participants - Optional participant list for correlation
 * @param partialFlags - Array indicating which crops are partial (touching frame edge)
 * @returns Complete prompt string for Gemini
 */
export function buildAnalysisPrompt(
  config: SportCategoryConfig,
  cropCount: number,
  hasNegative: boolean,
  participants?: ParticipantInfo[],
  partialFlags?: boolean[]
): string {
  // Start with base prompt from sport_categories
  let prompt = config.aiPrompt;

  // Add image count context
  prompt += `\n\nStai analizzando ${cropCount} immagine/i ritagliate${hasNegative ? ' + 1 immagine di contesto' : ''}.`;

  // Add participant context if available
  if (participants && participants.length > 0) {
    prompt += buildParticipantContext(participants);
  }

  // Add partial image notes if any
  if (partialFlags?.some(p => p)) {
    prompt += '\n\nNOTA: Alcuni ritagli mostrano soggetti parzialmente visibili (tagliati dal bordo della foto). Per questi, indica ciò che riesci a vedere.';
  }

  // Add context image instructions if present
  if (hasNegative) {
    prompt += buildContextImageInstructions(cropCount);
  }

  // Add recognition config hints
  prompt += buildRecognitionHints(config);

  // Add correlation instructions if participants provided
  if (participants && participants.length > 0 && hasNegative) {
    prompt += '\n\nCORRELAZIONE: Se gli sponsor o i colori nel contesto corrispondono a team noti nella lista partecipanti, usa questa informazione per validare o correggere i numeri identificati nei ritagli.';
  }

  // Add JSON response format (with plateNumber fields if detection enabled)
  prompt += buildResponseFormat(hasNegative, config.recognitionConfig.detectPlateNumber);

  console.log(`${LOG_PREFIX} Built prompt: ${prompt.length} chars, ${cropCount} crops, ${participants?.length || 0} participants`);

  return prompt;
}

/**
 * Build participant context section
 */
function buildParticipantContext(participants: ParticipantInfo[]): string {
  const participantLines = participants.map(p => {
    let line = `- Numero ${p.numero || '?'}: ${p.nome || 'N/A'}`;
    if (p.navigatore) line += ` / ${p.navigatore}`;
    if (p.squadra) line += ` (${p.squadra})`;
    if (p.sponsor) line += ` - Sponsor: ${p.sponsor}`;
    return line;
  });

  return `\n\nPartecipanti noti in questa gara:\n${participantLines.join('\n')}`;
}

/**
 * Build context image analysis instructions
 */
function buildContextImageInstructions(cropCount: number): string {
  return `\n\nIMAGINE ${cropCount + 1}: Contesto (soggetti mascherati in nero)
Analizza questa immagine per identificare:
- sponsorVisibili: Array di sponsor/loghi visibili nella scena
- altriNumeri: Altri numeri di gara visibili (per cross-reference)
- categoria: Categoria di gara se identificabile (F1, GT3, MotoGP, ecc.)
- coloriTeam: Colori predominanti che potrebbero identificare il team`;
}

/**
 * Build hints from recognition_config
 */
function buildRecognitionHints(config: SportCategoryConfig): string {
  const hints: string[] = [];
  const rc = config.recognitionConfig;

  if (rc.focusMode === 'foreground') {
    hints.push('Concentrati sui soggetti in primo piano.');
  } else if (rc.focusMode === 'closest') {
    hints.push('Dai priorità ai soggetti più vicini alla fotocamera.');
  }

  if (rc.detectPlateNumber) {
    hints.push('Rileva anche eventuali numeri di targa se visibili.');
  }

  if (rc.ignoreBackground) {
    hints.push('Ignora elementi sullo sfondo.');
  }

  if (rc.prioritizeForeground) {
    hints.push('Dai massima priorità ai soggetti in primo piano rispetto a quelli sullo sfondo.');
  }

  if (hints.length === 0) {
    return '';
  }

  return '\n\n' + hints.join(' ');
}

/**
 * Build JSON response format instructions
 * @param hasNegative - Whether context image is included
 * @param detectPlateNumber - Whether plate number detection is enabled
 */
function buildResponseFormat(hasNegative: boolean, detectPlateNumber: boolean = false): string {
  const contextPart = hasNegative ? `,
  "context": {
    "sponsorVisibili": ["Shell", "Pirelli"],
    "altriNumeri": [],
    "categoria": "Formula 1",
    "coloriTeam": ["rosso", "giallo"]
  }` : '';

  // Include plateNumber fields when detection is enabled
  const plateFields = detectPlateNumber ? ', "plateNumber": "AB123CD", "plateConfidence": 0.85' : '';
  const plateNote = detectPlateNumber ? '\n\nNOTA per targa: Se visibile un numero di targa, includi "plateNumber" (stringa) e "plateConfidence" (0.0-1.0). Estrai SOLO caratteri alfanumerici senza separatori.' : '';

  return `

Rispondi SOLO con un oggetto JSON valido in questo formato esatto:
{
  "crops": [
    {"imageIndex": 1, "raceNumber": "16", "confidence": 0.95, "drivers": ["Charles Leclerc"], "teamName": "Ferrari", "otherText": ["Shell", "Santander"]${plateFields}}
  ]${contextPart}
}${plateNote}`;
}

/**
 * Format a single participant for display in prompt
 */
export function formatParticipant(p: ParticipantInfo): string {
  let result = `#${p.numero || '?'}`;
  if (p.nome) result += ` ${p.nome}`;
  if (p.squadra) result += ` (${p.squadra})`;
  return result;
}
