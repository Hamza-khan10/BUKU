#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Protect the `main` branch (run ONCE, by a repository admin):
#   • no direct pushes (admins included) — every change arrives via a PR
#   • all CI jobs must pass, and the branch must be up to date with main
#   • linear history, no force-push, no deletion, conversations resolved
#
# Requires the GitHub CLI:  sudo apt install gh && gh auth login
# Note: branch protection on PRIVATE repos needs GitHub Pro/Team; it is free
# for public repositories.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
APPROVALS="${APPROVALS:-0}"   # set to 1 once there is a second engineer

checks=(
  "Lint · Typecheck · Unit tests · Audit"
  "Secret scan (gitleaks)"
  "Integration tests · Migration drift"
  "CodeQL (javascript-typescript)"
)
for svc in auth business billing booking queue notification search ads analytics; do checks+=("Production image ($svc)"); done
contexts=$(printf '%s\n' "${checks[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')

gh api -X PUT "repos/${REPO}/branches/main/protection" --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ${contexts} },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": ${APPROVALS}, "dismiss_stale_reviews": true },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
echo "✔ main is protected on ${REPO}"
