#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-bvrwyuwwxsruihkxeftm}"

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env.local
  set +a
fi

if [[ -n "${VITE_SUPABASE_URL:-}" ]]; then
  url_ref="${VITE_SUPABASE_URL#https://}"
  url_ref="${url_ref%%.*}"
  if [[ -n "$url_ref" && "$url_ref" != "your-project-ref" ]]; then
    PROJECT_REF="$url_ref"
  fi
fi

SUPABASE_CMD=(npx supabase)
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
fi

echo "SupplierSync — delete-account edge function"
echo ""
echo "Project: ${PROJECT_REF}"
echo ""
echo "Prerequisites:"
echo "  1. Run migration 029_account_and_org_deletion.sql in Supabase SQL Editor"
echo "  2. Link project: supabase link --project-ref ${PROJECT_REF}"
echo ""
echo "Deploying delete-account…"

"${SUPABASE_CMD[@]}" functions deploy delete-account --project-ref "${PROJECT_REF}"

echo ""
echo "Done. Account deletion is available from Account → Danger zone."
echo "Function URL: https://${PROJECT_REF}.supabase.co/functions/v1/delete-account"
