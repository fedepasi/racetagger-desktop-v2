// Snapshot of supabase/functions/run-regression-benchmark/index.ts v8 deployed 2026-05-19.
// Source-of-truth lives in racetagger-app repo (this desktop repo only has a symlink).
// Only diff vs v7: added 'gemini-3.5-flash' to MODEL_PRICING (input 1.50, output 9.00 per 1M tok).
// Kept here so the comparison branch has a verifiable record of what was deployed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, Cache-Control, pragma, Pragma',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

interface BenchmarkVariant {
  test_set_label: string;
  sport_category: string;
  ai_prompt_override?: string;
  ai_model_override?: string;
  notes?: string;
}

interface RegressionCase {
  id: string;
  sport_category: string;
  image_url: string;
  ground_truth_number: string | null;
  difficulty_label: 'easy' | 'hard' | 'edge_case';
  ground_truth_extra: {
    event?: string;
    ground_truth_kind?: 'explicit_manual' | 'tacit_unchanged';
    test_set_labels?: string[];
  } | null;
}

interface PerCaseResult {
  case_id: string;
  predicted: string | null;
  ground_truth: string | null;
  correct: boolean;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  event: string | null;
  difficulty: string;
  gt_kind: string | null;
  error?: string;
}

const SYNC_CASES_HARD_CAP = 100;
const WALL_BUDGET_MS = 4 * 60 * 1000;
const PARALLEL_BATCH_SIZE = 5;
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini 3.5 Flash — GA 2026-05-19 (added in v8)
  'gemini-3.5-flash':              { input: 1.50, output: 9.00 },
  'gemini-3.1-flash-lite':         { input: 0.25, output: 1.50 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview':        { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview':          { input: 2.00, output: 12.00 },
  'gemini-2.5-flash':              { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite':         { input: 0.10, output: 0.40 },
  'gemini-2.5-pro':                { input: 1.25, output: 10.00 },
};

const FALLBACK_PROMPT = `You are a race-bib OCR assistant. Identify the primary race number visible in this image.

Respond with ONLY a JSON object: {"race_number": "<value>"}

Rules:
- The value is the race number as it appears (digits, letters, mixed). Preserve leading zeros.
- If no bib is clearly visible, return {"race_number": "N/A"}.
- Do NOT add commentary, code fences, or any other text outside the JSON.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: 'Supabase env not configured' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const sportFilter = url.searchParams.get('sport') || undefined;
    const inventory = await readInventory(supabase, sportFilter);
    if ('error' in inventory) return jsonResponse({ success: false, error: inventory.error }, 500);
    return jsonResponse({
      success: true,
      version: 'v2',
      inventory,
      capabilities: ['inventory', 'sync_benchmark_up_to_250_cases'],
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured in Supabase secrets' }, 500);
  }

  let body: { variant: BenchmarkVariant; dry_run?: boolean; chunk_offset?: number; chunk_limit?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const validation = validateVariant(body?.variant);
  if (validation) return jsonResponse({ success: false, error: validation }, 400);

  const variant = body.variant;
  const dryRun = body.dry_run === true;
  const chunkOffset = Math.max(0, Math.floor(body.chunk_offset ?? 0));
  const chunkLimitRaw = body.chunk_limit ?? SYNC_CASES_HARD_CAP;
  const chunkLimit = Math.min(SYNC_CASES_HARD_CAP, Math.max(1, Math.floor(chunkLimitRaw)));

  const chunkSuffix = (chunkOffset > 0 || chunkLimit !== SYNC_CASES_HARD_CAP)
    ? ` [chunk offset=${chunkOffset} limit=${chunkLimit}]`
    : '';
  const { data: runRow, error: insertErr } = await supabase
    .from('regression_benchmark_runs')
    .insert({
      variant_test_set_label: variant.test_set_label,
      variant_sport_category: variant.sport_category,
      variant_ai_prompt_override: variant.ai_prompt_override ?? null,
      variant_ai_model_override: variant.ai_model_override ?? null,
      variant_notes: (variant.notes ?? '') + chunkSuffix,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !runRow) {
    return jsonResponse({ success: false, error: `Failed to create benchmark run row: ${insertErr?.message}` }, 500);
  }

  const runId = runRow.id as string;

  const cases = await fetchCases(supabase, variant);
  if ('error' in cases) {
    await supabase.from('regression_benchmark_runs').update({
      status: 'failed', error_message: cases.error, completed_at: new Date().toISOString(),
    }).eq('id', runId);
    return jsonResponse({ success: false, error: cases.error, run_id: runId }, 500);
  }

  if (cases.list.length === 0) {
    await supabase.from('regression_benchmark_runs').update({
      status: 'failed',
      error_message: 'No active cases match test_set_label + sport_category filter',
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
    return jsonResponse({
      success: false,
      error: 'No active cases found for the given test_set_label + sport_category',
      run_id: runId,
    }, 400);
  }

  const casesTotal = cases.list.length;
  const sortedCases = [...cases.list].sort((a, b) => a.id.localeCompare(b.id));
  const casesScoped = sortedCases.slice(chunkOffset, chunkOffset + chunkLimit);

  const promptResolution = await resolvePrompt(supabase, variant);
  if ('error' in promptResolution) {
    await supabase.from('regression_benchmark_runs').update({
      status: 'failed', error_message: promptResolution.error, completed_at: new Date().toISOString(),
    }).eq('id', runId);
    return jsonResponse({ success: false, error: promptResolution.error, run_id: runId }, 500);
  }
  const effectivePrompt = promptResolution.prompt;
  const effectiveModel = variant.ai_model_override || promptResolution.model || DEFAULT_MODEL;

  if (dryRun) {
    await supabase.from('regression_benchmark_runs').update({
      status: 'completed',
      cases_total: casesTotal,
      cases_run: 0,
      cases_skipped: casesScoped.length,
      cases_correct: 0,
      accuracy_pct: 0,
      total_latency_ms: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      error_message: 'dry_run: no Gemini calls executed',
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
    return jsonResponse({
      success: true,
      dry_run: true,
      run_id: runId,
      cases_in_scope: casesScoped.length,
      cases_total: casesTotal,
      effective_model: effectiveModel,
      effective_prompt_preview: effectivePrompt.slice(0, 200),
    });
  }

  const startTime = Date.now();
  const perCase: PerCaseResult[] = [];
  let partial = false;

  for (let i = 0; i < casesScoped.length; i += PARALLEL_BATCH_SIZE) {
    if (Date.now() - startTime > WALL_BUDGET_MS) {
      partial = true;
      break;
    }
    const batch = casesScoped.slice(i, i + PARALLEL_BATCH_SIZE);
    const results = await Promise.all(batch.map((c) => evaluateCase(c, effectivePrompt, effectiveModel, GEMINI_API_KEY)));
    perCase.push(...results);
  }

  const aggregate = aggregate_(perCase, casesTotal, casesScoped.length, partial);

  await supabase.from('regression_benchmark_runs').update({
    status: partial ? 'partial' : 'completed',
    cases_total: casesTotal,
    cases_run: aggregate.cases_run,
    cases_skipped: aggregate.cases_skipped,
    cases_correct: aggregate.cases_correct,
    accuracy_pct: aggregate.accuracy_pct,
    total_latency_ms: aggregate.total_latency_ms,
    total_input_tokens: aggregate.total_input_tokens,
    total_output_tokens: aggregate.total_output_tokens,
    total_cost_usd: aggregate.total_cost_usd,
    per_difficulty: aggregate.per_difficulty,
    per_event: aggregate.per_event,
    per_gt_kind: aggregate.per_gt_kind,
    per_case: perCase.slice(0, 1000),
    completed_at: new Date().toISOString(),
  }).eq('id', runId);

  return jsonResponse({
    success: true,
    run_id: runId,
    partial,
    effective_model: effectiveModel,
    chunk_offset: chunkOffset,
    chunk_limit: chunkLimit,
    cases_total: casesTotal,
    chunk_processed: casesScoped.length,
    has_more: casesTotal > chunkOffset + casesScoped.length,
    next_offset: casesTotal > chunkOffset + casesScoped.length ? chunkOffset + casesScoped.length : null,
    cases_run: aggregate.cases_run,
    cases_skipped: aggregate.cases_skipped,
    cases_correct: aggregate.cases_correct,
    accuracy_pct: aggregate.accuracy_pct,
    total_cost_usd: aggregate.total_cost_usd,
    total_latency_ms: aggregate.total_latency_ms,
    per_difficulty: aggregate.per_difficulty,
    per_event: aggregate.per_event,
    per_gt_kind: aggregate.per_gt_kind,
  });
});

function validateVariant(v: BenchmarkVariant | undefined): string | null {
  if (!v || typeof v !== 'object') return 'Missing variant object';
  if (!v.test_set_label || typeof v.test_set_label !== 'string') return 'variant.test_set_label is required';
  if (!v.sport_category || typeof v.sport_category !== 'string') return 'variant.sport_category is required';
  if (v.ai_prompt_override && v.ai_prompt_override.length > 50_000) return 'variant.ai_prompt_override too long (max 50KB)';
  if (v.ai_model_override && !MODEL_PRICING[v.ai_model_override]) {
    return `variant.ai_model_override "${v.ai_model_override}" unknown. Known: ${Object.keys(MODEL_PRICING).join(', ')}`;
  }
  return null;
}

interface InventoryStats {
  total_active: number;
  total_retired: number;
  by_sport: Record<string, { total: number; by_difficulty: Record<string, number> }>;
}

async function readInventory(
  supabase: ReturnType<typeof createClient>,
  sportFilter?: string
): Promise<InventoryStats | { error: string }> {
  let query = supabase
    .from('regression_test_set')
    .select('sport_category, difficulty_label, is_active')
    .range(0, 9999);
  if (sportFilter) query = query.eq('sport_category', sportFilter);

  const { data, error } = await query;
  if (error) return { error: `Failed to read regression_test_set: ${error.message}` };

  const rows = data ?? [];
  const stats: InventoryStats = { total_active: 0, total_retired: 0, by_sport: {} };
  for (const r of rows as Array<{ sport_category: string; difficulty_label: string; is_active: boolean }>) {
    if (!r.is_active) { stats.total_retired += 1; continue; }
    stats.total_active += 1;
    if (!stats.by_sport[r.sport_category]) stats.by_sport[r.sport_category] = { total: 0, by_difficulty: {} };
    const b = stats.by_sport[r.sport_category];
    b.total += 1;
    b.by_difficulty[r.difficulty_label] = (b.by_difficulty[r.difficulty_label] ?? 0) + 1;
  }
  return stats;
}

async function fetchCases(
  supabase: ReturnType<typeof createClient>,
  variant: BenchmarkVariant
): Promise<{ list: RegressionCase[] } | { error: string }> {
  const { data, error } = await supabase
    .from('regression_test_set')
    .select('id, sport_category, image_url, ground_truth_number, difficulty_label, ground_truth_extra')
    .eq('is_active', true)
    .eq('sport_category', variant.sport_category)
    .filter('ground_truth_extra->test_set_labels', 'cs', `["${variant.test_set_label}"]`)
    .range(0, 1999);

  if (error) return { error: `Failed to fetch cases: ${error.message}` };
  return { list: (data ?? []) as RegressionCase[] };
}

async function resolvePrompt(
  supabase: ReturnType<typeof createClient>,
  variant: BenchmarkVariant
): Promise<{ prompt: string; model: string | null } | { error: string }> {
  if (variant.ai_prompt_override) {
    return { prompt: variant.ai_prompt_override, model: null };
  }

  const { data, error } = await supabase
    .from('sport_categories')
    .select('ai_prompt')
    .eq('code', variant.sport_category)
    .single();

  if (error || !data) {
    return { prompt: FALLBACK_PROMPT, model: null };
  }
  const row = data as { ai_prompt?: string };
  return { prompt: row.ai_prompt || FALLBACK_PROMPT, model: null };
}

async function evaluateCase(
  c: RegressionCase,
  prompt: string,
  model: string,
  geminiKey: string
): Promise<PerCaseResult> {
  const start = Date.now();
  const event = c.ground_truth_extra?.event ?? null;
  const gtKind = c.ground_truth_extra?.ground_truth_kind ?? null;

  try {
    const imgResp = await fetch(c.image_url, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok) throw new Error(`Image fetch failed: HTTP ${imgResp.status}`);
    const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < imgBytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, imgBytes.subarray(i, i + chunk) as unknown as number[]);
    }
    const base64 = btoa(binary);
    const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    const reqBody = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
    };
    const geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(20_000),
    });

    if (!geminiResp.ok) {
      const errText = (await geminiResp.text()).slice(0, 300);
      throw new Error(`Gemini HTTP ${geminiResp.status}: ${errText}`);
    }

    const geminiData = await geminiResp.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no text');

    const tokensIn = geminiData?.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = geminiData?.usageMetadata?.candidatesTokenCount ?? 0;
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];
    const cost = (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;

    const predicted = extractRaceNumber(text);
    const correct = compareNumbers(predicted, c.ground_truth_number);

    return {
      case_id: c.id,
      predicted,
      ground_truth: c.ground_truth_number,
      correct,
      latency_ms: Date.now() - start,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: Number(cost.toFixed(6)),
      event,
      difficulty: c.difficulty_label,
      gt_kind: gtKind,
    };
  } catch (err) {
    return {
      case_id: c.id,
      predicted: null,
      ground_truth: c.ground_truth_number,
      correct: false,
      latency_ms: Date.now() - start,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      event,
      difficulty: c.difficulty_label,
      gt_kind: gtKind,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractRaceNumber(text: string): string | null {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const obj = JSON.parse(cleaned);

    if (Array.isArray(obj) && obj.length > 0) {
      const sorted = [...obj].sort((a, b) => (Number(b?.c) || 0) - (Number(a?.c) || 0));
      for (const subj of sorted) {
        if (subj && typeof subj === 'object') {
          const n = subj.n ?? subj.number ?? subj.race_number ?? subj.bib_number;
          if (typeof n === 'string' && n.trim() !== '') return n.trim();
          if (typeof n === 'number') return String(n);
        }
      }
      const first = obj[0];
      if (typeof first === 'string') return first.trim();
      if (typeof first === 'number') return String(first);
    }

    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const candidates = [
        obj.race_number, obj.raceNumber, obj.bib_number, obj.bibNumber, obj.number, obj.n,
      ];
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim() !== '') return c.trim();
        if (typeof c === 'number') return String(c);
      }
      const lists = [obj.race_numbers, obj.subjects, obj.detections, obj.results];
      for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) {
          const sorted = [...list].sort((a, b) => (Number(b?.c) || 0) - (Number(a?.c) || 0));
          for (const subj of sorted) {
            const n = subj?.n ?? subj?.number ?? subj?.race_number ?? subj?.bib_number;
            if (typeof n === 'string' && n.trim() !== '') return n.trim();
            if (typeof n === 'number') return String(n);
          }
        }
      }
    }
  } catch {
    // not JSON, try regex
  }

  const m = cleaned.match(/"(?:n|race_?number|bib_?number|number)"\s*:\s*"([^"]+)"/i);
  if (m) return m[1].trim();
  const numMatch = cleaned.match(/"(?:n|race_?number|bib_?number|number)"\s*:\s*(\d+)/i);
  if (numMatch) return numMatch[1];
  return null;
}

function compareNumbers(predicted: string | null, groundTruth: string | null): boolean {
  if (predicted === null && groundTruth === null) return true;
  if (predicted === null || groundTruth === null) return false;
  const p = predicted.trim().toLowerCase();
  const g = groundTruth.trim().toLowerCase();
  const isEmpty = (s: string) => s === '' || s === 'n/a' || s === 'na' || s === 'none' || s === 'null';
  if (isEmpty(p) && isEmpty(g)) return true;
  return p === g;
}

interface Aggregate {
  cases_run: number;
  cases_skipped: number;
  cases_correct: number;
  accuracy_pct: number;
  total_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  per_difficulty: Record<string, { n: number; correct: number; pct: number }>;
  per_event: Record<string, { n: number; correct: number; pct: number }>;
  per_gt_kind: Record<string, { n: number; correct: number; pct: number }>;
}

function aggregate_(perCase: PerCaseResult[], casesTotal: number, casesScoped: number, partial: boolean): Aggregate {
  let run = 0, skipped = 0, correct = 0;
  let latency = 0, tokensIn = 0, tokensOut = 0, costUsd = 0;
  const perDifficulty: Record<string, { n: number; correct: number }> = {};
  const perEvent: Record<string, { n: number; correct: number }> = {};
  const perGtKind: Record<string, { n: number; correct: number }> = {};

  for (const c of perCase) {
    if (c.error) {
      skipped += 1;
      continue;
    }
    run += 1;
    if (c.correct) correct += 1;
    latency += c.latency_ms;
    tokensIn += c.tokens_in;
    tokensOut += c.tokens_out;
    costUsd += c.cost_usd;

    const d = c.difficulty;
    perDifficulty[d] = perDifficulty[d] || { n: 0, correct: 0 };
    perDifficulty[d].n += 1;
    if (c.correct) perDifficulty[d].correct += 1;

    if (c.event) {
      perEvent[c.event] = perEvent[c.event] || { n: 0, correct: 0 };
      perEvent[c.event].n += 1;
      if (c.correct) perEvent[c.event].correct += 1;
    }

    if (c.gt_kind) {
      perGtKind[c.gt_kind] = perGtKind[c.gt_kind] || { n: 0, correct: 0 };
      perGtKind[c.gt_kind].n += 1;
      if (c.correct) perGtKind[c.gt_kind].correct += 1;
    }
  }

  if (partial) {
    skipped += casesScoped - perCase.length;
  }

  const withPct = (m: Record<string, { n: number; correct: number }>) => {
    const o: Record<string, { n: number; correct: number; pct: number }> = {};
    for (const [k, v] of Object.entries(m)) {
      o[k] = { n: v.n, correct: v.correct, pct: v.n > 0 ? Number(((100 * v.correct) / v.n).toFixed(2)) : 0 };
    }
    return o;
  };

  return {
    cases_run: run,
    cases_skipped: skipped,
    cases_correct: correct,
    accuracy_pct: run > 0 ? Number(((100 * correct) / run).toFixed(2)) : 0,
    total_latency_ms: latency,
    total_input_tokens: tokensIn,
    total_output_tokens: tokensOut,
    total_cost_usd: Number(costUsd.toFixed(6)),
    per_difficulty: withPct(perDifficulty),
    per_event: withPct(perEvent),
    per_gt_kind: withPct(perGtKind),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
