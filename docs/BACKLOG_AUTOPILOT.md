# Backlog Autopilot · operator guide

GitHub Actions–based pipeline that picks one open issue, decides if it's still relevant, and opens a small draft PR (≤50 lines, ≤3 files) with a fix. Always reviewed by a second Claude run (devil-advocate pattern) before being marked ready. Never auto-merges.

**Design doc**: [.studio/state/2026-05-19-backlog-autopilot-build-kickoff.md](../.studio/state/2026-05-19-backlog-autopilot-build-kickoff.md)
**Office hours**: [.studio/office-hours/2026-05-19-backlog-autopilot.md](../.studio/office-hours/2026-05-19-backlog-autopilot.md)

---

## What it does

- **In scope**: open issues with title `[AUTO]` (auto-report crashes) or `[BUG]` (user-feedback) — short, single-file fixes.
- **Out of scope**: `[FEATURE]` requests, refactors, anything touching token logic, migrations, or edge function versions. These are excluded by hard constraints inside the workflow prompt.
- **Workflows**:
  - `backlog-autopilot-implement.yml` — works on ONE issue at a time. Implementer (Opus 4.7) + Reviewer (Sonnet 4.6).
  - `backlog-autopilot-sweep.yml` — selects up to N (default 2) issues from the backlog and dispatches Implement for each. Cron is **disabled by default** — enable only after a trial period.

---

## How to run it manually

### One-off run on a specific issue

```bash
# from racetagger-clean/ root
bin/run-autopilot.sh 147 --dry-run    # safe — posts proposal as issue comment
bin/run-autopilot.sh 147              # real — opens a draft PR
```

Or directly via gh CLI:

```bash
gh workflow run backlog-autopilot-implement.yml \
  -f issue_number=147 \
  -f dry_run=true
```

### Sweep (selector + dispatcher)

```bash
gh workflow run backlog-autopilot-sweep.yml \
  -f max_issues=2 \
  -f dry_run=true
```

Watch the result:

```bash
gh run watch
gh run list --workflow=backlog-autopilot-implement.yml --limit=5
```

---

## Trial period workflow (current state)

1. Pick 1 issue manually, run with `dry_run=true`. Read the proposed comment.
2. If sensible, rerun with `dry_run=false`. Read the draft PR + reviewer comment.
3. If the PR is sensible, mark it ready-for-review (`gh pr ready <N>`) and merge.
4. After **3 consecutive clean manual runs**, uncomment the cron schedule in `backlog-autopilot-sweep.yml`:

   ```yaml
   on:
     schedule:
       - cron: '0 6 * * *'  # daily 06:00 UTC
   ```

   Commit + push to `main`. The daily cron will start dispatching.

5. Watch `agent_decisions` for 4 weeks. Kill the cron (re-comment) at the first sign of widespread regressions.

---

## Audit trail (Supabase `agent_decisions`)

Every run inserts at least one row:

| field | values |
|---|---|
| `agent_name` | `backlog-autopilot-implementer` / `backlog-autopilot-sweep` |
| `agent_run_id` | GitHub Actions run id |
| `decision_type` | `pr_opened`, `issue_marked_resolved`, `issue_skipped_stale`, `attempt_failed`, `sweep_completed` |
| `severity` | `info` (normal), `medium` (PR with no test coverage), `high` (implementer failed or reviewer BLOCK) |
| `action_taken` (jsonb) | `{ issue_number, pr_number, pr_url, branch, dry_run, files_changed, lines_added, lines_removed, run_url }` |
| `result` (jsonb) | `{ implementer_status, reviewer_verdict, test_coverage_present, hard_constraints_pass, block_reason }` |
| `model_used` | `claude-opus-4-7` or `claude-sonnet-4-6` |

Quick query (psql or SQL editor in Supabase):

```sql
SELECT created_at, decision_type, severity, reason,
       action_taken->>'issue_number' AS issue,
       action_taken->>'pr_number'    AS pr,
       result->>'reviewer_verdict'   AS verdict
FROM agent_decisions
WHERE agent_name LIKE 'backlog-autopilot%'
ORDER BY created_at DESC
LIMIT 50;
```

You'll also see these rows in `/management-portal/marketing-cockpit` (it queries `agent_decisions` for the last 7 days without filtering by agent — autopilot decisions show up mixed with marketing ones for now).

---

## Hard constraints encoded in the workflow

The Implementer prompt refuses to modify any of these — escalates to `needs-human-implementation` instead:

- `src/auth-service.ts`, `*token*`, `user_tokens`, `token_transactions`, `batch_token_reservations`
- existing files under `supabase/migrations/` (new migrations OK)
- existing files under `supabase/functions/analyzeImageDesktopV*/` (new version OK)
- code signing / notarization in `package.json` or `electron-builder.yml`
- `src/main.ts` EPIPE protection blocks

Size cap: **>50 added lines** OR **>3 files** → autopilot exits with `issue_skipped_stale` and labels the issue `needs-human-implementation`.

---

## Killing a running pipeline

```bash
# List in-flight runs of the autopilot workflows
gh run list --workflow=backlog-autopilot-implement.yml --status=in_progress
gh run list --workflow=backlog-autopilot-sweep.yml --status=in_progress

# Cancel a specific run
gh run cancel <run_id>
```

The `concurrency.group: backlog-autopilot` setting ensures the Sweep and any Implement runs serialize automatically, so a cancel-all is safe.

---

## Rollback

If a merged autopilot PR causes a regression:

```bash
# revert the autopilot commit
git revert <sha>
git push

# add the issue back open (gh issue reopen) and remove the `backlog-autopilot` label so the
# selector skips it; consider adding `needs-human-implementation` to lock it out permanently
gh issue reopen <issue_number>
gh issue edit <issue_number> --remove-label backlog-autopilot --add-label needs-human-implementation
```

If autopilot is producing low-quality PRs systematically, disable both workflows by adding `if: false` to the top-level `jobs.<name>:` and pushing. This is faster than deleting and is reversible.

---

## Secrets required

| secret | source |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | already configured (used by existing workflows) |
| `SUPABASE_URL` | already configured |
| `SUPABASE_SERVICE_ROLE_KEY` | already configured |
| `GITHUB_TOKEN` | provided automatically by Actions |
