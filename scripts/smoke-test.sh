#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# FS Suite — consolidated smoke test
#
# Read-only sanity checks across production-facing surfaces:
#   - api        → api.fs-suite.com           (EC2 primary)
#   - candidate  → api-candidate.fs-suite.com (Cloud Run via Worker)
#   - frontend   → fs-suite.com               (Cloudflare Pages)
#
# Usage:
#   ./scripts/smoke-test.sh             # check all three
#   ./scripts/smoke-test.sh api         # check only the primary API
#   ./scripts/smoke-test.sh api candidate
#
# Run after every deploy (post-deploy step in workflows) and once a
# day (smoke-test.yml). Exit code 0 means all selected checks passed;
# non-zero means at least one failed.
#
# This script does NOT touch DB, Redis, or any mutable state. Safe to
# run as often as you want.
# ──────────────────────────────────────────────────────────────

set -uo pipefail

# Total retries per endpoint. Pages/Worker propagation can take a
# moment after a deploy; this gives ~30s of slack.
MAX_ATTEMPTS=6
SLEEP_BETWEEN=5
TIMEOUT_PER_CALL=10

# Each entry: "name|URL|label|expected_status|body_pattern"
# body_pattern is a grep -E regex; pass `.` to skip body check.
ALL_CHECKS=(
  "api|https://api.fs-suite.com/v1/health|api primary (EC2)|200|\"status\":\"ok\""
  "candidate|https://api-candidate.fs-suite.com/v1/health|api candidate (Cloud Run via Worker)|200|\"status\":\"ok\""
  "frontend|https://fs-suite.com/|frontend (Cloudflare Pages)|200|<!DOCTYPE html"
)

# Filter to the requested names (or run all if no args)
if [[ $# -gt 0 ]]; then
  SELECTED=("$@")
else
  SELECTED=(api candidate frontend)
fi

FAILURES=0
RESULTS=()

run_check() {
  local url="$1"
  local label="$2"
  local expected_status="$3"
  local body_pattern="$4"

  local attempt http_code body
  for attempt in $(seq 1 $MAX_ATTEMPTS); do
    body=$(curl -sS -L -m "$TIMEOUT_PER_CALL" \
      -w '\n___HTTP_CODE___%{http_code}' "$url" 2>&1 || true)
    http_code="${body##*___HTTP_CODE___}"
    body="${body%___HTTP_CODE___*}"

    if [[ "$http_code" == "$expected_status" ]]; then
      if [[ "$body_pattern" == "." ]] || \
         echo "$body" | grep -qE "$body_pattern"; then
        RESULTS+=("✓ ${label} → ${http_code}")
        return 0
      fi
      # Right status, wrong body — keep retrying (might be propagating)
    fi

    if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
      sleep "$SLEEP_BETWEEN"
    fi
  done

  RESULTS+=("✗ ${label} → last HTTP ${http_code:-???}, body did not match /${body_pattern}/")
  FAILURES=$((FAILURES + 1))
}

echo "── FS Suite smoke test ──"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Selected: ${SELECTED[*]}"
echo ""

for entry in "${ALL_CHECKS[@]}"; do
  IFS='|' read -r name url label expected_status body_pattern <<< "$entry"

  # Skip if not in selection
  skip=true
  for s in "${SELECTED[@]}"; do
    if [[ "$s" == "$name" ]]; then skip=false; break; fi
  done
  $skip && continue

  echo "Checking ${label}..."
  run_check "$url" "$label" "$expected_status" "$body_pattern"
done

echo ""
echo "── Results ──"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done

echo ""
if [[ ${#RESULTS[@]} -eq 0 ]]; then
  echo "::error::No checks ran. Unknown selection: ${SELECTED[*]}"
  exit 2
fi
if [[ $FAILURES -eq 0 ]]; then
  echo "All checks passed."
  exit 0
else
  echo "::error::${FAILURES} check(s) failed."
  exit 1
fi
