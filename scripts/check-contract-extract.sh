#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-bvrwyuwwxsruihkxeftm}"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — copy .env.example and add your Supabase keys."
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env.local
set +a

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  echo "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local"
  exit 1
fi

url_ref="${VITE_SUPABASE_URL#https://}"
url_ref="${url_ref%%.*}"
if [[ -n "$url_ref" ]]; then
  PROJECT_REF="$url_ref"
fi

SUPABASE_CMD=(npx supabase)
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
fi

echo "Checking Supabase secrets on project ${PROJECT_REF}..."
secrets_json="$("${SUPABASE_CMD[@]}" secrets list --project-ref "${PROJECT_REF}" 2>/dev/null || true)"

if echo "$secrets_json" | grep -q '"name":"OPENAI_API_KEY"'; then
  echo "OK: OPENAI_API_KEY is listed in Supabase edge function secrets."
else
  echo "MISSING: OPENAI_API_KEY is not in Supabase edge function secrets."
  echo "Run: ./scripts/setup-contract-extract.sh"
fi

echo ""
echo "Checking extract-contract status endpoint..."
status_url="${VITE_SUPABASE_URL%/}/functions/v1/extract-contract"
response="$(curl -sS -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}" \
  -d '{"mode":"status"}' \
  "$status_url")"

body="${response%$'\n'*}"
status="${response##*$'\n'}"

echo "HTTP ${status}: ${body}"

if [[ "$status" == "404" ]]; then
  echo ""
  echo "extract-contract is not deployed. Run: ./scripts/setup-contract-extract.sh"
  exit 1
fi

if echo "$body" | grep -q '"configured":true'; then
  echo ""
  echo "OK: AI extraction is configured and reachable."
  echo "Note: only PDF attachments trigger AI read on the Contracts tab (Word/.docx must be exported to PDF)."
  exit 0
fi

echo ""
echo "AI extraction is NOT configured. Set OPENAI_API_KEY:"
echo "  ./scripts/setup-contract-extract.sh"
echo "Or Supabase Dashboard → Edge Functions → Secrets → add OPENAI_API_KEY"
exit 1
