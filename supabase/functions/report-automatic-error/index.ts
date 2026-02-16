// Edge Function: report-automatic-error
// Purpose: Receive automatic error reports, deduplicate via RPC, and create/update GitHub Issues
// Used by: Desktop app ErrorTelemetryService (automatic, not user-initiated)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts';

// ==================== Types ====================

interface ErrorReportRequest {
  fingerprint: string;
  errorType: string;
  severity: string;
  errorMessage: string;
  errorStack?: string;
  executionId?: string;
  batchPhase?: string;
  imageIndex?: number;
  totalImages?: number;
  appVersion?: string;
  os?: string;
  osVersion?: string;
  arch?: string;
  cpuModel?: string;
  ramAvailableGb?: number;
  logSnapshot?: string;
  executionContext?: Record<string, unknown>;
}

// ==================== Rate Limiting ====================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// ==================== GitHub Issue Formatting ====================

function formatNewIssueTitle(errorType: string, errorMessage: string, appVersion: string): string {
  const shortMsg = errorMessage.length > 60
    ? errorMessage.substring(0, 57) + '...'
    : errorMessage;
  return `[AUTO] ${errorType}: ${shortMsg} (v${appVersion})`;
}

function formatNewIssueBody(report: ErrorReportRequest): string {
  let body = `## Errore Automatico\n\n`;
  body += `| Campo | Valore |\n|-------|--------|\n`;
  body += `| **Tipo** | \`${report.errorType}\` |\n`;
  body += `| **Severità** | \`${report.severity}\` |\n`;
  body += `| **Fase pipeline** | \`${report.batchPhase || 'N/A'}\` |\n`;
  body += `| **App version** | v${report.appVersion || 'N/A'} |\n`;
  body += `| **OS** | ${report.os || 'N/A'} ${report.osVersion || ''} (${report.arch || 'N/A'}) |\n`;
  body += `| **CPU** | ${report.cpuModel || 'N/A'} |\n`;
  body += `| **RAM disponibile** | ${report.ramAvailableGb || 'N/A'} GB |\n`;

  if (report.totalImages) {
    body += `| **Batch** | immagine ${report.imageIndex ?? '?'}/${report.totalImages} |\n`;
  }

  body += `\n## Messaggio di Errore\n\n\`\`\`\n${report.errorMessage}\n\`\`\`\n`;

  if (report.errorStack) {
    body += `\n<details>\n<summary>Stack Trace</summary>\n\n\`\`\`\n${report.errorStack}\n\`\`\`\n</details>\n`;
  }

  if (report.executionContext && Object.keys(report.executionContext).length > 0) {
    body += `\n<details>\n<summary>Contesto Esecuzione</summary>\n\n\`\`\`json\n${JSON.stringify(report.executionContext, null, 2)}\n\`\`\`\n</details>\n`;
  }

  if (report.logSnapshot) {
    body += `\n<details>\n<summary>Log Contestuale (~ultimi 30s)</summary>\n\n\`\`\`\n${report.logSnapshot.substring(0, 3000)}\n\`\`\`\n</details>\n`;
  }

  body += `\n---\n`;
  body += `*Report automatico generato da RaceTagger Error Telemetry*\n`;
  body += `*Fingerprint: \`${report.fingerprint}\`*\n`;
  body += `*Utenti affetti: 1*\n`;

  return body;
}

function formatOccurrenceComment(
  report: ErrorReportRequest,
  affectedUserCount: number,
  totalOccurrences: number
): string {
  let comment = `### 🔄 Nuova occorrenza — Utente #${affectedUserCount}\n\n`;
  comment += `| Campo | Valore |\n|-------|--------|\n`;
  comment += `| **App** | v${report.appVersion || 'N/A'} |\n`;
  comment += `| **OS** | ${report.os || 'N/A'} ${report.osVersion || ''} (${report.arch || 'N/A'}) |\n`;
  comment += `| **Fase** | \`${report.batchPhase || 'N/A'}\` |\n`;

  if (report.totalImages) {
    comment += `| **Batch** | immagine ${report.imageIndex ?? '?'}/${report.totalImages} |\n`;
  }

  if (report.logSnapshot) {
    comment += `\n<details>\n<summary>Log Contestuale</summary>\n\n\`\`\`\n${report.logSnapshot.substring(0, 2000)}\n\`\`\`\n</details>\n`;
  }

  comment += `\n*Totale occorrenze: ${totalOccurrences} | Utenti affetti: ${affectedUserCount}*\n`;

  return comment;
}

function getLabels(errorType: string): string[] {
  const labels = ['auto-report'];

  switch (errorType) {
    case 'raw_conversion':
      labels.push('raw-processing');
      break;
    case 'edge_function':
      labels.push('edge-function');
      break;
    case 'onnx_model':
      labels.push('onnx');
      break;
    case 'token_reservation':
      labels.push('tokens');
      break;
    case 'segmentation':
      labels.push('segmentation');
      break;
    case 'zero_results':
      labels.push('zero-results');
      break;
    case 'memory':
      labels.push('memory');
      break;
    case 'uncaught':
      labels.push('crash');
      break;
  }

  return labels;
}

// ==================== Main Handler ====================

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const githubPat = Deno.env.get('GITHUB_PAT');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase environment variables.');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // ---- Authenticate user ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication failed' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- Rate limiting ----
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Rate limit exceeded for automatic error reports.',
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- Parse input ----
    const report: ErrorReportRequest = await req.json();

    if (!report.fingerprint || !report.errorType) {
      return new Response(JSON.stringify({ success: false, error: 'Missing fingerprint or errorType' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- Upsert error report via RPC ----
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('upsert_error_report', {
      p_fingerprint: report.fingerprint,
      p_error_type: report.errorType,
      p_severity: report.severity || 'recoverable',
      p_error_message: (report.errorMessage || '').substring(0, 500),
      p_error_stack: (report.errorStack || '').substring(0, 1000),
      p_user_id: user.id,
      p_execution_id: report.executionId || null,
      p_batch_phase: report.batchPhase || null,
      p_image_index: report.imageIndex ?? null,
      p_total_images: report.totalImages ?? null,
      p_app_version: report.appVersion || null,
      p_os: report.os || null,
      p_os_version: report.osVersion || null,
      p_arch: report.arch || null,
      p_cpu_model: report.cpuModel || null,
      p_ram_available_gb: report.ramAvailableGb ?? null,
      p_log_snapshot: (report.logSnapshot || '').substring(0, 5000),
      p_log_storage_path: null,
      p_execution_context: report.executionContext || null,
    });

    if (rpcError) {
      console.error('[report-automatic-error] RPC error:', rpcError);
      return new Response(JSON.stringify({
        success: false,
        error: `Database error: ${rpcError.message}`,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // RPC returns array with single row
    const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const isNewFingerprint = result?.is_new_fingerprint ?? true;
    const totalOccurrences = result?.total_occurrences ?? 1;
    const affectedUserCount = result?.affected_user_count ?? 1;
    let issueNumber = result?.github_issue_number ?? null;

    // ---- GitHub Integration (only if PAT configured) ----
    if (githubPat) {
      try {
        if (isNewFingerprint) {
          // Create new GitHub issue
          const issueTitle = formatNewIssueTitle(
            report.errorType,
            report.errorMessage || 'Unknown error',
            report.appVersion || 'unknown'
          );
          const issueBody = formatNewIssueBody(report);
          const labels = getLabels(report.errorType);

          const ghResponse = await fetch(
            'https://api.github.com/repos/fedepasi/racetagger-desktop-v2/issues',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${githubPat}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'RaceTagger-ErrorTelemetry',
              },
              body: JSON.stringify({
                title: issueTitle,
                body: issueBody,
                labels,
                assignees: ['fedepasi'],
              }),
            }
          );

          if (ghResponse.ok) {
            const ghData = await ghResponse.json();
            issueNumber = ghData.number;

            // Store issue mapping
            await supabaseAdmin.rpc('update_error_report_issue', {
              p_fingerprint: report.fingerprint,
              p_github_issue_number: ghData.number,
              p_github_issue_url: ghData.html_url,
            });

            console.log(`[report-automatic-error] Created GitHub Issue #${ghData.number}`);
          } else {
            const ghErr = await ghResponse.text();
            console.error(`[report-automatic-error] GitHub API error: ${ghResponse.status}`, ghErr);
          }
        } else if (issueNumber && affectedUserCount > (result?.affected_user_count ?? 1) - 1) {
          // Existing issue + new user affected: add comment
          const comment = formatOccurrenceComment(report, affectedUserCount, totalOccurrences);

          const commentResponse = await fetch(
            `https://api.github.com/repos/fedepasi/racetagger-desktop-v2/issues/${issueNumber}/comments`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${githubPat}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'RaceTagger-ErrorTelemetry',
              },
              body: JSON.stringify({ body: comment }),
            }
          );

          if (commentResponse.ok) {
            console.log(`[report-automatic-error] Added comment to Issue #${issueNumber} (${affectedUserCount} users)`);
          }

          // Add "widespread" label if threshold reached
          if (affectedUserCount >= 5) {
            await fetch(
              `https://api.github.com/repos/fedepasi/racetagger-desktop-v2/issues/${issueNumber}/labels`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${githubPat}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'Content-Type': 'application/json',
                  'User-Agent': 'RaceTagger-ErrorTelemetry',
                },
                body: JSON.stringify({ labels: ['widespread'] }),
              }
            );
          }
        }
      } catch (ghError) {
        // GitHub integration failure is non-critical
        console.error('[report-automatic-error] GitHub integration error:', ghError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      isNewFingerprint,
      issueNumber,
      totalOccurrences,
      affectedUsers: affectedUserCount,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[report-automatic-error] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'An unexpected error occurred.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
