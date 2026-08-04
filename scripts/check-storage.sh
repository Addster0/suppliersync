#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

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

# Anon key cannot see private bucket metadata. HTTP 404 here does NOT prove the bucket is missing.
url="${VITE_SUPABASE_URL%/}/storage/v1/bucket/organization-files"
response="$(curl -s -w "\n%{http_code}" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}" \
  "$url")"

body="${response%$'\n'*}"
status="${response##*$'\n'}"

if [[ "$status" == "200" ]]; then
  echo "OK: organization-files bucket is visible to the anon key (public or listed)."
  exit 0
fi

echo "INCONCLUSIVE (HTTP $status): private buckets return 404 to the anon key even when they exist."
echo "$body"
echo
echo "Accurate check (requires sign-in):"
echo "  1. Open the app → Account → System status → Refresh"
echo "  2. Document storage must show ✓ (tests read AND upload policies)"
echo
echo "Or confirm in Supabase Dashboard → Storage → Buckets that organization-files exists (private)."
echo
echo "If the bucket exists but uploads fail with permission errors, run Step B from:"
echo "  ./scripts/setup-storage.sh"
echo "  or supabase/STORAGE_SETUP.sql in the SQL Editor."

exit 1
