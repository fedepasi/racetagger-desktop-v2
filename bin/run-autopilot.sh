#!/usr/bin/env bash
# Manual trigger for the Backlog Autopilot Implement workflow.
#
# Usage:
#   bin/run-autopilot.sh <issue_number> [--dry-run]
#
# Examples:
#   bin/run-autopilot.sh 147               # real run — opens a draft PR if appropriate
#   bin/run-autopilot.sh 147 --dry-run     # dry run — posts a proposal as issue comment, no PR
#
# Requires: gh CLI authenticated with `repo` + `workflow` scope on fedepasi/racetagger-desktop-v2.

set -euo pipefail

ISSUE_NUMBER="${1:-}"
if [ -z "$ISSUE_NUMBER" ]; then
  echo "Usage: $0 <issue_number> [--dry-run]"
  exit 1
fi

DRY_RUN="false"
if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN="true"
fi

REPO="${AUTOPILOT_REPO:-fedepasi/racetagger-desktop-v2}"

echo "→ Dispatching backlog-autopilot-implement on $REPO"
echo "  issue=$ISSUE_NUMBER  dry_run=$DRY_RUN"

gh workflow run backlog-autopilot-implement.yml \
  --repo "$REPO" \
  -f issue_number="$ISSUE_NUMBER" \
  -f dry_run="$DRY_RUN"

echo ""
echo "Dispatched. Watch progress:"
echo "  https://github.com/$REPO/actions/workflows/backlog-autopilot-implement.yml"
echo ""
echo "Tail the latest run (auto-refresh):"
echo "  gh run watch --repo $REPO \$(gh run list --repo $REPO --workflow=backlog-autopilot-implement.yml --limit=1 --json databaseId -q '.[0].databaseId')"
