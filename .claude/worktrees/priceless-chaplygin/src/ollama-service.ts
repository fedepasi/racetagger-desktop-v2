/**
 * Ollama Service - Local AI inference via Ollama
 * Provides GLM-OCR integration for offline race number recognition.
 * Completely optional — silent if Ollama is not installed.
 */

import { DEBUG_MODE } from './config';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const MODEL_NAME = 'glm-ocr';
const INFERENCE_TIMEOUT_MS = 120000; // 2 min for image processing
const STATUS_TIMEOUT_MS = 2000;

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  modelAvailable: boolean;
  modelSize: string | null;
  version: string | null;
}

export interface OllamaInferenceResult {
  vehicles: Array<{
    raceNumber: string;
    confidence: number;
    teamName?: string;
    category?: string;
  }>;
  raw_text: string;
  processing_time_ms: number;
}

class OllamaService {
  private cachedStatus: OllamaStatus | null = null;
  private statusCacheTime = 0;
  private readonly STATUS_CACHE_TTL = 30000; // 30s

  async getStatus(): Promise<OllamaStatus> {
    const now = Date.now();
    if (this.cachedStatus && (now - this.statusCacheTime) < this.STATUS_CACHE_TTL) {
      return this.cachedStatus;
    }

    const status: OllamaStatus = {
      installed: false, running: false, modelAvailable: false,
      modelSize: null, version: null,
    };

    try {
      // Check if Ollama is running
      const versionRes = await this.fetchWithTimeout(`${OLLAMA_BASE_URL}/api/version`, STATUS_TIMEOUT_MS);
      if (versionRes.ok) {
        const data = await versionRes.json();
        status.installed = true;
        status.running = true;
        status.version = data.version || null;

        // Check if model is available
        const tagsRes = await this.fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, STATUS_TIMEOUT_MS);
        if (tagsRes.ok) {
          const tagsData = await tagsRes.json();
          const model = (tagsData.models || []).find((m: any) =>
            m.name === MODEL_NAME || m.name.startsWith(`${MODEL_NAME}:`)
          );
          if (model) {
            status.modelAvailable = true;
            status.modelSize = model.size ? `${(model.size / 1e9).toFixed(1)} GB` : null;
          }
        }
      }
    } catch {
      // Ollama not running or not installed — that's fine
    }

    this.cachedStatus = status;
    this.statusCacheTime = now;
    if (DEBUG_MODE) console.log('[Ollama] Status:', status);
    return status;
  }

  async pullModel(onProgress?: (pct: number) => void): Promise<void> {
    const controller = new AbortController();

    const response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: MODEL_NAME, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Pull failed: ${response.status}`);
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.total && data.completed && onProgress) {
            onProgress(Math.round((data.completed / data.total) * 100));
          }
          if (data.status === 'success') {
            this.cachedStatus = null; // Invalidate cache
            if (onProgress) onProgress(100);
          }
        } catch { /* skip invalid JSON lines */ }
      }
    }
  }

  async analyzeImage(imageBase64: string, customPrompt?: string): Promise<OllamaInferenceResult> {
    const startTime = Date.now();
    const prompt = customPrompt || 'Text Recognition:';

    const response = await this.fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, INFERENCE_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [{
          role: 'user',
          content: prompt,
          images: [imageBase64],
        }],
        stream: false,
        options: { num_ctx: 16384 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Inference failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawText = data.message?.content || '';
    const processingTime = Date.now() - startTime;

    // Parse race numbers from raw text
    const vehicles = this.parseRaceNumbers(rawText);

    if (DEBUG_MODE) {
      console.log(`[Ollama] Inference completed in ${processingTime}ms. Found ${vehicles.length} numbers. Raw: "${rawText.substring(0, 200)}"`);
    }

    return {
      vehicles,
      raw_text: rawText,
      processing_time_ms: processingTime,
    };
  }

  private parseRaceNumbers(text: string): OllamaInferenceResult['vehicles'] {
    if (!text) return [];

    // Extract numbers that look like race numbers (1-4 digits, possibly with # prefix)
    const numberPattern = /(?:#?\b(\d{1,4})\b)/g;
    const matches: string[] = [];
    let match;

    while ((match = numberPattern.exec(text)) !== null) {
      const num = match[1];
      // Filter out common non-race numbers
      const numInt = parseInt(num);
      if (numInt >= 2020 && numInt <= 2030) continue; // Years
      if (numInt === 0) continue;
      if (!matches.includes(num)) {
        matches.push(num);
      }
    }

    return matches.map(num => ({
      raceNumber: num,
      confidence: 0.7, // Default confidence — Ollama doesn't provide this
    }));
  }

  private async fetchWithTimeout(url: string, timeoutMs: number, options?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const ollamaService = new OllamaService();
