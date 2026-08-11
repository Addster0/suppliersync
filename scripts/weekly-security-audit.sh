#!/usr/bin/env bash
# Weekly security audit for SupplierSync (Alpha).
# Run from repo root: npm run audit:security
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPORT_DIR="$ROOT/security-reports"
mkdir -p "$REPORT_DIR"
STAMP="$(date +%Y-%m-%d)"
REPORT="$REPORT_DIR/audit-$STAMP.txt"

{
  echo "SupplierSync security audit — $STAMP"
  echo "========================================"
  echo

  echo "## npm audit"
  npm audit || true
  echo

  echo "## Hardcoded secret patterns (src + supabase, excluding node_modules)"
  rg -n --hidden -g '!node_modules' -g '!dist' \
    -e 'sk_live_|sk_test_[a-zA-Z0-9]{20,}' \
    -e 'SUPABASE_SERVICE_ROLE' \
    -e 'password\s*=\s*["'"'"'][^'"'"']+["'"'"']' \
    src supabase scripts 2>/dev/null || echo "(no matches or rg not installed)"
  echo

  echo "## XSS sinks"
  rg -n 'dangerouslySetInnerHTML|\.innerHTML|eval\(' src 2>/dev/null || echo "none found"
  echo

  echo "## Tracked env / temp files (should be empty)"
  git ls-files '.env' '.env.local' 'supabase/.temp' 'recovery-codes.txt' 2>/dev/null || true
  echo

  echo "## Dependency drift (latest pins)"
  rg -n '"latest"' package.json 2>/dev/null || echo "no latest pins"
  echo

  echo "Done. Paste this file into Cursor and run /audit-security for code review."
} | tee "$REPORT"

echo
echo "Report saved to $REPORT"
