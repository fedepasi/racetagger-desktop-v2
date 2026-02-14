// Edge Function: submitFeedback
// Purpose: Receive user feedback from desktop app and create GitHub Issues
// Used by: Desktop app support feedback modal

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../shared/cors.ts';

// ==================== Types ====================

interface FeedbackRequest {
  type: 'bug' | 'feature' | 'general';
  title: string;
  description: string;
  includeDiagnostics: boolean;
  diagnosticReportUrl?: string;  // Signed URL to full diagnostic report on Supabase Storage
  diagnostics?: {
    system: Record<string, unknown>;
    dependencies: Array<Record<string, unknown>>;
    recentErrors: Array<Record<string, unknown>>;
  };
}

// ==================== Rate Limiting ====================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
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

function formatIssueTitle(type: string, title: string): string {
  const prefix = type === 'bug' ? '[BUG]' : type === 'feature' ? '[FEATURE]' : '[FEEDBACK]';
  return `${prefix} ${title}`;
}

function getLabels(type: string): string[] {
  if (type === 'bug') return ['bug', 'user-feedback'];
  if (type === 'feature') return ['enhancement', 'user-feedback'];
  return ['user-feedback'];
}

function formatIssueBody(
  description: string,
  userEmail: string,
  diagnostics?: FeedbackRequest['diagnostics'],
  diagnosticReportUrl?: string
): string {
  let body = `## Description\n\n${description}\n\n---\n*Submitted by: ${userEmail}*\n`;

  // Full diagnostic report link (uploaded to Supabase Storage)
  if (diagnosticReportUrl) {
    body += `\n**[View Full Diagnostic Report](${diagnosticReportUrl})** _(includes system info, dependencies, errors, and 1000 lines of main process logs — link valid for 7 days)_\n`;
  }

  if (!diagnostics) return body;

  // System diagnostics
  if (diagnostics.system && Object.keys(diagnostics.system).length > 0) {
    const sys = diagnostics.system;
    body += `\n<details>\n<summary>System Diagnostics</summary>\n\n`;
    body += `| Property | Value |\n|----------|-------|\n`;
    body += `| App Version | ${sys.appVersion || 'N/A'} |\n`;
    body += `| Electron | ${sys.electronVersion || 'N/A'} |\n`;
    body += `| Node.js | ${sys.nodeVersion || 'N/A'} |\n`;
    body += `| OS | ${sys.os || 'N/A'} ${sys.osVersion || ''} |\n`;
    body += `| Arch | ${sys.arch || 'N/A'} |\n`;
    body += `| CPU | ${sys.cpu || 'N/A'} |\n`;
    body += `| CPU Cores/Threads | ${sys.cpuCores || 'N/A'} / ${sys.cpuThreads || 'N/A'} |\n`;
    body += `| RAM Total | ${sys.ramTotal || 'N/A'} GB |\n`;
    body += `| RAM Available | ${sys.ramAvailable || 'N/A'} GB |\n`;
    if (sys.gpu) body += `| GPU | ${sys.gpu} |\n`;
    body += `| Disk Type | ${sys.diskType || 'N/A'} |\n`;
    body += `| Disk Available | ${sys.diskAvailable || 'N/A'} GB |\n`;
    body += `| Disk Total | ${sys.diskTotal || 'N/A'} GB |\n`;
    body += `\n</details>\n`;
  }

  // Dependencies
  if (diagnostics.dependencies && diagnostics.dependencies.length > 0) {
    body += `\n<details>\n<summary>Dependencies</summary>\n\n`;
    body += `| Name | Exists | Working | Native | Path |\n|------|--------|---------|--------|------|\n`;
    for (const dep of diagnostics.dependencies) {
      const mark = (v: unknown) => v ? 'Y' : 'N';
      body += `| ${dep.name || 'N/A'} | ${mark(dep.exists)} | ${mark(dep.working)} | ${dep.native != null ? mark(dep.native) : '-'} | ${dep.path || dep.error || '-'} |\n`;
    }
    body += `\n</details>\n`;
  }

  // Recent errors
  if (diagnostics.recentErrors && diagnostics.recentErrors.length > 0) {
    body += `\n<details>\n<summary>Recent Errors (${diagnostics.recentErrors.length})</summary>\n\n`;
    for (const err of diagnostics.recentErrors.slice(0, 10)) {
      body += `- **[${err.severity}/${err.category}]** ${err.message} _(${err.timestamp})_\n`;
    }
    body += `\n</details>\n`;
  }

  return body;
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

    if (!githubPat) {
      throw new Error('GITHUB_PAT is not configured.');
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

    // ---- Check admin status for rate limit exemption ----
    let isAdmin = false;
    const { data: subscriber } = await supabaseAdmin
      .from('subscribers')
      .select('user_role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (subscriber?.user_role === 'admin') {
      isAdmin = true;
    }

    // ---- Rate limiting (admin exempt) ----
    if (!isAdmin && !checkRateLimit(user.id)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Rate limit exceeded. You can submit up to 5 feedback items per day.',
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- Parse and validate input ----
    const body: FeedbackRequest = await req.json();

    if (!body.type || !['bug', 'feature', 'general'].includes(body.type)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid feedback type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!body.title || body.title.trim().length === 0 || body.title.length > 200) {
      return new Response(JSON.stringify({ success: false, error: 'Title is required (max 200 characters)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!body.description || body.description.trim().length === 0 || body.description.length > 5000) {
      return new Response(JSON.stringify({ success: false, error: 'Description is required (max 5000 characters)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- Create GitHub Issue ----
    const issueTitle = formatIssueTitle(body.type, body.title.trim());
    const issueBody = formatIssueBody(
      body.description.trim(),
      user.email || user.id,
      body.includeDiagnostics ? body.diagnostics : undefined,
      body.diagnosticReportUrl
    );
    const labels = getLabels(body.type);

    const ghResponse = await fetch(
      'https://api.github.com/repos/fedepasi/racetagger-desktop-v2/issues',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'RaceTagger-Desktop',
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: labels,
          assignees: ['fedepasi'],
        }),
      }
    );

    if (!ghResponse.ok) {
      const ghError = await ghResponse.text();
      console.error('[submitFeedback] GitHub API error:', ghResponse.status, ghError);
      let detail = `GitHub API ${ghResponse.status}`;
      try {
        const parsed = JSON.parse(ghError);
        detail = parsed.message || detail;
      } catch (_) { /* ignore parse error */ }
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to create GitHub issue: ${detail}`,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ghData = await ghResponse.json();

    return new Response(JSON.stringify({
      success: true,
      issueNumber: ghData.number,
      issueUrl: ghData.html_url,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[submitFeedback] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'An unexpected error occurred. Please try again later.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
