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

echo "SupplierSync AI contract extraction setup"
echo ""
echo "Project: ${PROJECT_REF}"
echo "Create an OpenAI API key at https://platform.openai.com/api-keys"
echo "The extract-contract edge function uses gpt-4o-mini to read PDF contracts."
echo ""

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -r -p "Paste OPENAI_API_KEY (sk-...): " OPENAI_API_KEY
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required."
  exit 1
fi

if [[ ! "${OPENAI_API_KEY}" =~ ^sk- ]]; then
  echo "Warning: OPENAI_API_KEY usually starts with sk-. Confirm this is a valid OpenAI API key."
fi

echo ""
echo "Setting Supabase secret OPENAI_API_KEY on project ${PROJECT_REF}..."

"${SUPABASE_CMD[@]}" secrets set "OPENAI_API_KEY=${OPENAI_API_KEY}" --project-ref "${PROJECT_REF}"

echo ""
echo "Deploying extract-contract..."
"${SUPABASE_CMD[@]}" functions deploy extract-contract --project-ref "${PROJECT_REF}"

echo ""
echo "Verifying configuration..."

if [[ -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  echo "Skip live check — VITE_SUPABASE_ANON_KEY not in .env.local."
else
  status_url="https://${PROJECT_REF}.supabase.co/functions/v1/extract-contract"
  response="$(curl -sS \
    -H "Content-Type: application/json" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}" \
    -d '{"mode":"status"}' \
    "$status_url")"

  if echo "$response" | grep -q '"configured":true'; then
    echo "OK: extract-contract reports configured=true."
  else
    echo "FAILED: extract-contract still reports configured=false."
    echo "$response"
    echo ""
    echo "Confirm OPENAI_API_KEY appears under Supabase Dashboard → Edge Functions → Secrets."
    exit 1
  fi
fi

echo ""
echo "Done. Attach a PDF on the Contracts tab — details will pre-fill for review."
